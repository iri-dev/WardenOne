/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const { tls } = require('./browser-media-security.js');
const ROOT = path.resolve(__dirname, '..');
const HOSTS = { page: 'shop.trowow.de', known: 'a.trowow.de', unknown: 'unlisted.trowow.de',
  child: 'child.a.trowow.de', lookalike: 'a.trowow.de.invalid.test', api: 'api.shop.trowow.de', auth: 'accounts.google.com', payment: 'checkout.stripe.com' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
function args(argv) {
  const options = { runs: 5 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2), value = argv[i + 1];
    if (!['browser', 'candidate', 'reference', 'out', 'runs'].includes(key) || !value) throw new Error('Expected paired browser/candidate/reference/out/runs options');
    options[key] = key === 'runs' ? Number(value) : path.resolve(value);
  }
  if (!options.browser || !options.candidate || !options.reference || !options.out || !Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) throw new Error('Browser, candidate, reference, output and 1..10 runs required');
  return options;
}
async function evaluate(cdp, session, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function browserCpu(cdp) {
  const process = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(row => row.type === 'browser');
  return { id: process.id, ms: process.cpuTime * 1000 };
}
async function runOne(build, run, options, server, hits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-cname-'));
  const port = await profile.freePort(), started = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json')));
  let cdp, workerSession;
  const result = { build: build.label, run, scenarios: [], complete: false };
  try {
    const resolver = Object.values(HOSTS).flatMap(host => [host, host + '.']).map(host => 'MAP ' + host + ' 127.0.0.1')
      .concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ');
    const browser = await profile.launch(options.browser, 'on', build.directory, port, dir,
      ['--host-resolver-rules=' + resolver, '--ignore-certificate-errors', '--disable-features=TrackingProtection3pcd,CalculateNativeWinOcclusion']);
    result.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    result.consoleErrors = [];
    cdp.on(message => {
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        result.consoleErrors.push(message.params.args.map(arg => arg.description || arg.value).join(' ').slice(0, 2000));
      }
    });
    const extension = await profile.extensionReady(cdp, port, manifest.version);
    workerSession = extension.attachedSession;
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const dedicated = await worker('Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG,"blockCnameTrackers")');
    result.defaultEnabled = dedicated && await worker('DEFAULT_CONFIG.blockCnameTrackers===true');
    const policyKey = dedicated ? 'blockCnameTrackers' : 'blockFirstPartyTrackers';
    result.policyKey = policyKey;
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'reconciliation');
    await quiet();
    result.startupMs = Date.now() - started;
    const setConfig = async patch => {
      const before = await browserCpu(cdp), start = Date.now();
      await worker('updateStoredConfig(cfg=>{Object.assign(cfg,' + JSON.stringify(patch) + ');}).then(()=>true)');
      await sleep(100); await quiet();
      const after = await browserCpu(cdp);
      assert.equal(before.id, after.id);
      return { wallMs: Date.now() - start, browserCpuMs: after.ms - before.ms };
    };
    const origin = host => 'https://' + host + ':' + server.address().port;
    const { targetId } = await cdp.send('Target.createTarget', { url: origin(HOSTS.page) + '/' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId); await cdp.send('Network.enable', {}, sessionId);
    await until(() => evaluate(cdp, sessionId, 'document.readyState==="complete"&&location.hostname===' + JSON.stringify(HOSTS.page)), 'fixture page');
    const createRequestWorld = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
      return (await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'cname-native-network' }, sessionId)).executionContextId;
    };
    let context = await createRequestWorld(), serial = 0;
    await worker('globalThis.__cnameMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info=>{if(info.request.url.includes("/probe?"))__cnameMatches.push({url:info.request.url,rule:info.rule});});true');
    const request = async (name, host, expected) => {
      const token = build.label + '-' + run + '-' + (++serial), url = origin(host) + '/probe?token=' + token;
      await cdp.send('Network.deleteCookies', { name: 'cname_new', url: origin(host) + '/' }, sessionId);
      await cdp.send('Network.setCookie', { name: 'cname_old', value: 'fixed', url: origin(host) + '/', secure: true, sameSite: 'None' }, sessionId);
      const before = await browserCpu(cdp), start = Date.now();
      const response = await evaluate(cdp, sessionId, '(async()=>{try{const r=await fetch(' + JSON.stringify(url) + ',{credentials:"include",signal:AbortSignal.timeout(5000)});return {ok:r.ok};}catch(e){return {error:String(e)};}})()', context);
      const latencyMs = Date.now() - start, after = await browserCpu(cdp);
      const receipt = hits.find(hit => hit.token === token);
      await sleep(50);
      const matches = await worker('__cnameMatches.filter(info=>info.url.includes(' + JSON.stringify('token=' + token) + '))');
      const cnameBlock = matches.some(match => match.rule.rulesetId === '_dynamic' && match.rule.ruleId >= 730000 && match.rule.ruleId < 730300);
      const status = receipt ? 'allowed' : cnameBlock ? 'blocked' : 'error';
      const row = { name, host, expected, status, receipt: receipt || null, matches, latencyMs, browserCpuMs: after.ms - before.ms, response };
      if (name === 'auth-negative' || name === 'payment-negative') {
        const cookies = await cdp.send('Network.getCookies', { urls: [origin(host) + '/'] }, sessionId);
        row.newCookieStored = cookies.cookies.some(cookie => cookie.name === 'cname_new' && cookie.value === 'fixed');
        assert(receipt?.cookie.includes('cname_old=fixed') && row.newCookieStored, name + ' cookie flow must remain usable');
      }
      result.scenarios.push(row); assert.equal(status, expected, JSON.stringify(row));
      return row;
    };
    await request('known-default-policy', HOSTS.known, result.defaultEnabled ? 'blocked' : 'allowed');
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapDefaultAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    if (dedicated) {
      await setConfig({ blockCnameTrackers: false });
      await request('explicit-off', HOSTS.known, 'allowed');
      await setConfig({ blockFirstPartyTrackers: true });
      await request('legacy-first-party-does-not-enable-cname', HOSTS.known, 'allowed');
      await setConfig({ blockFirstPartyTrackers: false });
    }
    result.enableCost = await setConfig({ [policyKey]: true });
    await request('known-alias-enabled', HOSTS.known, dedicated || build.label === 'candidate' ? 'blocked' : 'allowed');
    await request('known-alias-trailing-dot', HOSTS.known + '.', dedicated || build.label === 'candidate' ? 'blocked' : 'allowed');
    const socketToken = build.label + '-' + run + '-websocket';
    const socketUrl = 'wss://' + HOSTS.known + ':' + server.address().port + '/probe?token=' + socketToken;
    await evaluate(cdp, sessionId, 'new Promise(resolve=>{const socket=new WebSocket(' + JSON.stringify(socketUrl)
      + ');socket.onerror=()=>resolve("closed");socket.onopen=()=>{socket.close();resolve("opened");};setTimeout(()=>{socket.close();resolve("timeout");},5000);})', context);
    await sleep(50);
    const socketReceipt = hits.find(hit => hit.token === socketToken);
    const socketMatches = await worker('__cnameMatches.filter(info=>info.url.includes(' + JSON.stringify('token=' + socketToken) + '))');
    const socketStatus = socketReceipt ? 'allowed' : socketMatches.some(match => match.rule.rulesetId === '_dynamic'
      && match.rule.ruleId >= 730000 && match.rule.ruleId < 730300) ? 'blocked' : 'error';
    result.scenarios.push({ name: 'known-alias-websocket', status: socketStatus, receipt: socketReceipt || null, matches: socketMatches });
    assert.equal(socketStatus, dedicated || build.label === 'candidate' ? 'blocked' : 'allowed');
    for (const key of ['unknown', 'child', 'lookalike', 'api', 'auth', 'payment']) await request(key + '-negative', HOSTS[key], 'allowed');
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapOptInAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    assert.equal(await evaluate(cdp, sessionId, 'document.querySelector("input").value="edited"'), 'edited');
    if (build.label === 'candidate') {
      result.classification = await worker('JSON.stringify(resolveKnownAlias(' + JSON.stringify(HOSTS.known) + '))').then(JSON.parse);
      assert.equal(result.classification.requestedHost, HOSTS.known);
      assert.equal(result.classification.canonicalTarget, 'customer.etracker.com');
      const rules = await worker('chrome.declarativeNetRequest.getDynamicRules().then(rows=>rows.filter(r=>r.id>=CNAME_RULE_BASE&&r.id<CNAME_RULE_BASE+CNAME_RULES_BUDGET))');
      assert(rules.length > 0 && rules.length <= 300);
      assert(rules.every(rule => rule.action.type === 'block'));
      const checks = await worker('Promise.all(' + JSON.stringify(rules.map(rule => rule.condition.regexFilter)) + '.map(regex=>chrome.declarativeNetRequest.isRegexSupported({regex,isCaseSensitive:false})))');
      assert(checks.every(check => check.isSupported), 'every installed exact-host regex must be supported');
      result.ruleCount = rules.length;
      result.coveredAliases = rules.reduce((total, rule) => total + rule.condition.requestDomains.length, 0);
      if (dedicated) {
        const waitPolicy = enabled => until(() => worker(`Promise.all([localGet('wardenone_config'),chrome.declarativeNetRequest.getDynamicRules()]).then(([stored,rows])=>
          stored.wardenone_config.blockCnameTrackers===${enabled}&&rows.filter(r=>r.id>=CNAME_RULE_BASE&&r.id<CNAME_RULE_BASE+CNAME_RULES_BUDGET).length===${enabled ? rules.length : 0}
          &&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer)`), 'CNAME toggle application');
        for (const surface of ['popup', 'settings']) {
          const url = 'chrome-extension://' + extension.id + '/' + surface + '.html' + (surface === 'settings' ? '#page=privacy' : '');
          const { targetId: uiId } = await cdp.send('Target.createTarget', { url });
          const { sessionId: uiSession } = await cdp.send('Target.attachToTarget', { targetId: uiId, flatten: true });
          await cdp.send('Runtime.enable', {}, uiSession);
          const selector = surface === 'popup' ? 'input[data-key="blockCnameTrackers"]' : '[data-key="blockCnameTrackers"] [role="switch"]';
          await until(() => evaluate(cdp, uiSession, 'document.readyState==="complete"&&!!document.querySelector(' + JSON.stringify(selector) + ')'
            + (surface === 'settings' ? '&&loaded' : '')), surface + ' CNAME control');
          await sleep(100);
          if (surface === 'settings') assert.equal(await evaluate(cdp, uiSession, 'PROTECTION_TOTAL'),
            await worker('HEALTH_SHIELD_KEYS.length+WATCH_ONLY_GUARDS.length'));
          await evaluate(cdp, uiSession, 'document.querySelector(' + JSON.stringify(selector) + ').click();true');
          await waitPolicy(false); await request(surface + '-toggle-off', HOSTS.known, 'allowed');
          await evaluate(cdp, uiSession, 'document.querySelector(' + JSON.stringify(selector) + ').click();true');
          await waitPolicy(true); await request(surface + '-toggle-on', HOSTS.known, 'blocked');
          await cdp.send('Target.closeTarget', { targetId: uiId });
        }
        result.independentUiToggles = true;
      }
      for (const key of ['auth', 'payment']) {
        await cdp.send('Page.navigate', { url: origin(HOSTS[key]) + '/' }, sessionId);
        await until(() => evaluate(cdp, sessionId, 'location.hostname===' + JSON.stringify(HOSTS[key]) + '&&document.readyState==="complete"'), key + ' fixture');
        context = await createRequestWorld();
        await request(key + '-initiated-alias', HOSTS.known, 'allowed');
      }
      await cdp.send('Page.navigate', { url: origin(HOSTS.page) + '/' }, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.hostname===' + JSON.stringify(HOSTS.page) + '&&document.readyState==="complete"'), 'return from authentication fixture');
      context = await createRequestWorld();
      const rejected = await worker('(async()=>{const cfg={...(await localGet("wardenone_config")).wardenone_config};cfg.siteOverrides={' + JSON.stringify(HOSTS.page) + ':{' + JSON.stringify(policyKey) + ':false}};return await applyCnameRules(cfg,change=>chrome.declarativeNetRequest.updateDynamicRules({...change,addRules:[{...change.addRules[0],condition:{regexFilter:"["}}]}))===false;})()');
      assert(rejected);
      assert.deepEqual(await worker('chrome.declarativeNetRequest.getDynamicRules().then(rows=>rows.filter(r=>r.id>=CNAME_RULE_BASE&&r.id<CNAME_RULE_BASE+CNAME_RULES_BUDGET))'), rules);
      await request('last-known-good-after-rejection', HOSTS.known, 'blocked');
      result.rejectedUpdatePreservedRules = true;
      await setConfig({ siteOverrides: { [HOSTS.page]: { [policyKey]: false } } });
      await request('per-site-policy-off', HOSTS.known, 'allowed');
      await setConfig({ siteOverrides: { [HOSTS.page]: { blockTrackers: false } } });
      await request('per-site-trackers-off', HOSTS.known, dedicated ? 'blocked' : 'allowed');
      if (dedicated) {
        await setConfig({ siteOverrides: {}, blockTrackers: false, blockFirstPartyTrackers: false });
        await request('independent-of-other-tracker-controls', HOSTS.known, 'blocked');
        await setConfig({ blockTrackers: true });
      }
      await setConfig({ siteOverrides: {}, allowlist: [HOSTS.page] });
      await request('site-pause-without-reload', HOSTS.known, 'allowed');
      await setConfig({ allowlist: [], enabled: false });
      await request('master-off', HOSTS.known, 'allowed');
      await setConfig({ enabled: true });
      await cdp.send('Page.reload', {}, sessionId); await sleep(200); context = await createRequestWorld();
      await request('re-enabled', HOSTS.known, 'blocked');
      await cdp.send('Page.navigate', { url: origin(HOSTS.known) + '/' }, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.hostname===' + JSON.stringify(HOSTS.known) + '&&!!document.querySelector("input")'), 'direct navigation to alias');
      result.directAliasNavigation = 'allowed';
      result.storageBytes = await worker('Promise.all([chrome.storage.local.getBytesInUse(null),chrome.storage.session.getBytesInUse(null)]).then(([local,session])=>({local,session}))');
    }
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    result.complete = true;
  } catch (error) {
    result.error = String(error.stack || error);
    if (workerSession) result.diagnostics = await evaluate(cdp, workerSession,
      '({last:__refreshExtensionStateLastKey,inFlight:__refreshExtensionStateInFlightKey,queued:__refreshExtensionStateQueued,timer:!!__refreshExtensionStateTimer})').catch(() => null);
  }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-cname-')) throw new Error('Unexpected fixture profile path');
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { result.cleanupWarning = String(error.message); }
  }
  return result;
}
async function main(options) {
  const builds = ['reference', 'candidate'].map(label => ({ label, directory: options[label], fingerprint: identity.fingerprint(options[label]).sha256 }));
  const report = { createdAt: new Date().toISOString(), toolSha256: identity.sha256(fs.readFileSync(__filename)), machine: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: process.platform, release: os.release() },
    browserSha256: identity.sha256(fs.readFileSync(options.browser)), builds, runs: options.runs, fixture: HOSTS, results: [], completed: false };
  const hits = [], server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    if (url.pathname === '/probe') hits.push({ token: url.searchParams.get('token'), host: req.headers.host, cookie: req.headers.cookie || '' });
    if (url.pathname === '/probe') res.setHeader('Set-Cookie', 'cname_new=fixed; SameSite=None; Secure; Path=/');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Cache-Control', 'no-store');
    res.end(url.pathname === '/probe' ? 'fixture' : '<!doctype html><title>CNAME fixture</title><input value="editable">');
  });
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, 'https://' + request.headers.host);
    hits.push({ token: url.searchParams.get('token'), host: request.headers.host, cookie: request.headers.cookie || '', transport: 'websocket' });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const save = () => { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2)); };
  try {
    for (let run = 1; run <= options.runs; run++) for (const build of run % 2 ? builds : [...builds].reverse()) {
      console.log('CNAME browser ' + build.label + ' ' + run + '/' + options.runs);
      const result = await runOne(build, run, options, server, hits); report.results.push(result); save();
      if (!result.complete) throw new Error(result.error);
    }
    for (const build of builds) assert.equal(identity.fingerprint(build.directory).sha256, build.fingerprint, 'measured source changed');
    report.completed = true;
  } finally { save(); await new Promise(resolve => server.close(resolve)); }
  console.log('[ok] real CNAME hostname, exact matching, native DNR evidence, negative cases, overrides and rollback');
}
if (require.main === module) profile.mustFinish(() => main(args(process.argv.slice(2))), 'CNAME browser regression')
  .catch(error => { console.error(error); process.exitCode = 1; });

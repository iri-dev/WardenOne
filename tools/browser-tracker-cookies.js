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
const HOSTS = { page: 'shop.trowow.de', tracker: 'g.doubleclick.net', alias: 'a.trowow.de', unlistedParent: 'doubleclick.net',
  unknown: 'cdn.cookie-fixture.example.net', same: 'api.shop.trowow.de', unknownAlias: 'unlisted.trowow.de',
  auth: 'accounts.google.com', payment: 'checkout.stripe.com', media: 'fixture.googlevideo.com' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
function args(argv) {
  const result = { runs: 5 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].slice(2), value = argv[i + 1];
    if (!['browser', 'candidate', 'reference', 'out', 'runs'].includes(key) || !value) throw new Error('Expected paired browser/candidate/reference/out/runs options');
    result[key] = key === 'runs' ? Number(value) : path.resolve(value);
  }
  if (!result.browser || !result.candidate || !result.reference || !result.out || !Number.isInteger(result.runs) || result.runs < 1 || result.runs > 10) throw new Error('All paths and 1..10 runs required');
  return result;
}
async function runOne(build, run, options, server, hits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-tracker-cookies-'));
  let port = await profile.freePort();
  const origin = host => 'https://' + host + ':' + server.address().port;
  let cdp;
  const result = { build: build.label, run, scenarios: [], complete: false };
  try {
    const resolver = Object.values(HOSTS).map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ');
    const started = Date.now();
    const browser = await profile.launch(options.browser, 'on', build.directory, port, dir,
      ['--host-resolver-rules=' + resolver, '--ignore-certificate-errors', '--disable-features=TrackingProtection3pcd,CalculateNativeWinOcclusion']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json')));
    let extension = await profile.extensionReady(cdp, port, manifest.version);
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'reconciliation');
    await quiet(); result.startupMs = Date.now() - started; result.browser = browser.Browser;
    result.supported = await worker('typeof TRACKER_COOKIE_ALIAS_RULE_BASE!=="undefined"');
    result.serviceIsolation = await worker('typeof COOKIE_SERVICE_POLICIES!=="undefined"');
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const setConfig = async patch => {
      await worker('updateStoredConfig(cfg=>{Object.assign(cfg,' + JSON.stringify(patch) + ');}).then(()=>true)');
      await sleep(100); await quiet();
    };
    await setConfig({ enabled: true, adShield: false, blockTrackers: false, blockCnameTrackers: false, blockThirdPartyCookies: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: origin(HOSTS.page) + '/' });
    let { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId); await cdp.send('Network.enable', {}, sessionId);
    let context;
    const requestWorld = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
      context = (await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'native-cookie-fixture' }, sessionId)).executionContextId;
    };
    const navigate = async host => {
      await cdp.send('Page.navigate', { url: origin(host) + '/' }, sessionId);
      await until(() => evaluate(cdp, sessionId, 'document.readyState==="complete"&&location.hostname===' + JSON.stringify(host)), 'fixture page');
      await requestWorld();
    };
    await navigate(HOSTS.page);
    const watchMatches = () => worker('globalThis.__cookieMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info=>{if(/\\/(probe|redirect|pixel)\\?/.test(info.request.url))__cookieMatches.push({url:info.request.url,rule:info.rule});});true');
    await watchMatches();
    const seed = async host => {
      for (const name of ['cookie_old', 'cookie_new', 'cookie_redirect']) await cdp.send('Network.deleteCookies', { name, url: origin(host) + '/' }, sessionId);
      await cdp.send('Network.setCookie', { name: 'cookie_old', value: 'fixed', url: origin(host) + '/', secure: true, sameSite: 'None' }, sessionId);
    };
    let serial = 0;
    const request = async (name, host, expected, route = 'probe') => {
      await seed(host);
      if (route === 'redirect') await seed(HOSTS.alias);
      const token = build.label + '-' + run + '-' + (++serial), url = origin(host) + '/' + route + '?token=' + token;
      const start = Date.now();
      const expression = route === 'pixel'
        ? `new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({ok:true});image.onerror=()=>resolve({ok:false});image.src=${JSON.stringify(url)};setTimeout(()=>resolve({error:'image timeout'}),5000);})`
        : `(async()=>{try{const r=await fetch(${JSON.stringify(url)},{credentials:'include',headers:{'If-None-Match':'fixture'},signal:AbortSignal.timeout(5000)});return {ok:r.ok,etag:r.headers.get('etag')};}catch(e){return {error:String(e)};}})()`;
      const response = await evaluate(cdp, sessionId, expression, context);
      const latencyMs = Date.now() - start;
      const receipt = hits.find(hit => hit.token === token);
      assert(receipt && response.ok, name + ': resource must load: ' + JSON.stringify({ receipt, response }));
      const cookies = await cdp.send('Network.getCookies', { urls: [origin(host) + '/'] }, sessionId);
      const sent = receipt.cookie.includes('cookie_old=fixed'), stored = cookies.cookies.some(cookie => cookie.name === (route === 'redirect' ? 'cookie_redirect' : 'cookie_new'));
      await sleep(30);
      const matches = await worker('__cookieMatches.filter(info=>info.url.includes(' + JSON.stringify('token=' + token) + '))');
      const row = { name, host, sent, stored, receipt, response, latencyMs, matches };
      result.scenarios.push(row);
      if (expected) { assert.equal(sent, expected[0], name + ': outgoing cookie'); assert.equal(stored, expected[1], name + ': incoming cookie'); }
      if (route === 'redirect') {
        const hop = hits.find(hit => hit.token === token + '-hop');
        const hopCookies = await cdp.send('Network.getCookies', { urls: [origin(HOSTS.alias) + '/'] }, sessionId);
        row.redirect = { receipt: hop, stored: hopCookies.cookies.some(cookie => cookie.name === 'cookie_new') };
        assert(hop && !hop.cookie.includes('cookie_old=fixed') && !row.redirect.stored, 'redirect must not reuse or store tracker cookies');
      }
      return row;
    };
    await request('existing-cookie-policy', HOSTS.tracker, result.supported ? [false, false] : [true, false]);
    await request('same-site-confirmed-alias', HOSTS.alias, result.supported ? [false, false] : [true, true]);
    for (const key of ['unknown', 'same', 'unknownAlias', 'unlistedParent', 'auth', 'payment', 'media']) {
      const service = result.serviceIsolation && ['auth', 'payment'].includes(key);
      await request(key + '-default-policy', HOSTS[key], service ? [false, false] : [true, true]);
    }
    await request('unknown-pixel-keeps-legacy-response-policy', HOSTS.unknown, [true, false], 'pixel');
    if (build.label === 'candidate') {
      assert(result.supported);
      const rules = await worker('chrome.declarativeNetRequest.getSessionRules().then(rows=>rows.filter(r=>r.id===TRACKER_COOKIE_RULE_ID||(r.id>=TRACKER_COOKIE_ALIAS_RULE_BASE&&r.id<TRACKER_COOKIE_ALIAS_RULE_BASE+TRACKER_COOKIE_ALIAS_RULES_BUDGET)))');
      result.ruleCount = rules.length; assert(rules.length > 1 && rules.every(rule => rule.action.requestHeaders && rule.action.responseHeaders));
      for (const surface of ['popup', 'settings']) {
        const { targetId: uiId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/' + surface + '.html' + (surface === 'settings' ? '#page=privacy' : '') });
        const { sessionId: ui } = await cdp.send('Target.attachToTarget', { targetId: uiId, flatten: true });
        const selector = surface === 'popup' ? 'input[data-key="blockThirdPartyCookies"]' : '[data-key="blockThirdPartyCookies"] [role="switch"]';
        await until(() => evaluate(cdp, ui, 'document.readyState==="complete"&&!!document.querySelector(' + JSON.stringify(selector) + ')' + (surface === 'settings' ? '&&loaded' : '')), surface);
        assert.equal(await evaluate(cdp, ui, '!!document.querySelector(' + JSON.stringify('[data-key="isolateTrackerCookies"]') + ')'), false);
        for (const enabled of [false, true]) {
          await evaluate(cdp, ui, 'document.querySelector(' + JSON.stringify(selector) + ').click();true');
          await until(() => worker('localGet("wardenone_config").then(r=>r.wardenone_config.blockThirdPartyCookies===' + enabled + '&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer)'), 'cookie switch');
          await request(surface + '-' + enabled, HOSTS.tracker, enabled ? [false, false] : [true, true]);
          await request(surface + '-service-' + enabled, HOSTS.auth, enabled ? [false, false] : [true, true]);
        }
        await cdp.send('Target.closeTarget', { targetId: uiId });
      }
      await request('redirect-cookie-reuse', HOSTS.tracker, [false, false], 'redirect');
      await setConfig({ trackerCacheProtection: true });
      const headers = await request('header-shield-coexists', HOSTS.tracker, [false, false]);
      assert(!headers.receipt.etagRequest && !headers.response.etag);
      await setConfig({ trackerCacheProtection: false });
      for (const key of ['auth', 'payment', 'media']) {
        await navigate(HOSTS[key]);
        const expected = key === 'media' ? [true, true] : [false, false];
        await request(key + '-initiated-tracker', HOSTS.tracker, expected);
        await request(key + '-initiated-alias', HOSTS.alias, expected);
        await request(key + '-own-session', HOSTS[key], [true, true]);
      }
      await navigate(HOSTS.page);
      const firewall = async cells => {
        const matrix = cells ? { [HOSTS.page]: { [HOSTS.tracker]: cells } } : {};
        assert.equal(await worker('(async()=>{const m=' + JSON.stringify(matrix) + ';const r=await applyFirewallRulesFrom(firewallRulesFrom(m));if(!r.ok)throw new Error(r.error);await localSet({[FIREWALL_KEY]:m});return true;})()'), true);
      };
      await firewall({ all: 'allow' }); await request('firewall-allow-wins', HOSTS.tracker, [true, true]);
      await firewall({ all: 'allow', cookie: 'strip' }); await request('manual-cookie-still-outgoing-only', HOSTS.tracker, [false, true]);
      await firewall({ all: 'block', xhr: 'noop' }); await request('firewall-noop-uses-automatic-policy', HOSTS.tracker, [false, false]);
      await firewall(null);
      const automaticAllow = { id: 1999999, priority: 1999, action: { type: 'allow' }, condition: { requestDomains: [HOSTS.tracker], resourceTypes: ['xmlhttprequest'] } };
      await worker('chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1999999],addRules:[' + JSON.stringify(automaticAllow) + ']}).then(()=>true)');
      await request('automatic-allow-does-not-suppress-isolation', HOSTS.tracker, [false, false]);
      await worker('chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1999999],addRules:[]}).then(()=>true)');
      const rejected = await worker(`(async()=>{const original=writeSessionRules;writeSessionRules=change=>chrome.declarativeNetRequest.updateSessionRules({...change,addRules:[{...change.addRules[0],condition:{regexFilter:'['}}]});try{return await applyTrackerCookieRule(true,{siteOverrides:{${JSON.stringify(HOSTS.page)}:{blockThirdPartyCookies:false}}})===false;}finally{writeSessionRules=original;}})()`);
      assert(rejected);
      assert.deepEqual(await worker('chrome.declarativeNetRequest.getSessionRules().then(rows=>rows.filter(r=>r.id===TRACKER_COOKIE_RULE_ID||(r.id>=TRACKER_COOKIE_ALIAS_RULE_BASE&&r.id<TRACKER_COOKIE_ALIAS_RULE_BASE+TRACKER_COOKIE_ALIAS_RULES_BUDGET)))'), rules);
      await request('last-known-good-after-native-rejection', HOSTS.tracker, [false, false]);
      await setConfig({ siteOverrides: { [HOSTS.page]: { blockThirdPartyCookies: false } } });
      await request('site-exception-without-reload', HOSTS.tracker, [true, true]);
      await request('alias-site-exception-without-reload', HOSTS.alias, [true, true]);
      await request('site-exception-includes-passive-pixels', HOSTS.unknown, [true, true], 'pixel');
      await request('site-exception-restores-service-cookies', HOSTS.auth, [true, true]);
      await setConfig({ siteOverrides: {}, allowlist: [HOSTS.page] });
      await request('site-pause-without-reload', HOSTS.tracker, [true, true]);
      await request('site-pause-restores-service-cookies', HOSTS.payment, [true, true]);
      await setConfig({ allowlist: [], enabled: false }); await request('master-off', HOSTS.tracker, [true, true]);
      await setConfig({ enabled: true }); await request('master-reenabled', HOSTS.tracker, [false, false]);
      await seed(HOSTS.tracker);
      await cdp.send('Page.navigate', { url: origin(HOSTS.tracker) + '/probe?token=direct-' + run }, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.hostname===' + JSON.stringify(HOSTS.tracker) + '&&document.readyState==="complete"'), 'direct navigation');
      assert(hits.find(hit => hit.token === 'direct-' + run)?.cookie.includes('cookie_old=fixed'));
      const directCookies = await cdp.send('Network.getCookies', { urls: [origin(HOSTS.tracker) + '/'] }, sessionId);
      assert(directCookies.cookies.some(cookie => cookie.name === 'cookie_new'), 'top-level navigation keeps cookies');
      result.directNavigation = true;
      await profile.killBrowser(cdp, port); cdp.close();
      port = await profile.freePort();
      const restarted = await profile.launch(options.browser, 'on', build.directory, port, dir,
        ['--host-resolver-rules=' + resolver, '--ignore-certificate-errors', '--disable-features=TrackingProtection3pcd,CalculateNativeWinOcclusion']);
      cdp = new profile.Cdp(restarted.webSocketDebuggerUrl); await cdp.connect();
      extension = await profile.extensionReady(cdp, port, manifest.version);
      await quiet();
      await profile.closeExtensionTabs(cdp, port, extension.id);
      const newPage = await cdp.send('Target.createTarget', { url: origin(HOSTS.page) + '/' });
      sessionId = (await cdp.send('Target.attachToTarget', { targetId: newPage.targetId, flatten: true })).sessionId;
      await cdp.send('Page.enable', {}, sessionId); await cdp.send('Network.enable', {}, sessionId);
      await navigate(HOSTS.page);
      await watchMatches();
      await request('browser-restart-restores-policy', HOSTS.tracker, [false, false]);
      await request('browser-restart-restores-alias-policy', HOSTS.alias, [false, false]);
      await request('browser-restart-restores-service-policy', HOSTS.auth, [false, false]);
      await request('browser-restart-negative-control', HOSTS.unknown, [true, true]);
      result.browserRestart = true;
    }
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    result.complete = true;
  } catch (error) { result.error = String(error.stack || error); }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-tracker-cookies-')) throw new Error('Unexpected profile path');
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { result.cleanupWarning = String(error.message); }
  }
  return result;
}
async function main(options) {
  const builds = ['reference', 'candidate'].map(label => ({ label, directory: options[label], fingerprint: identity.fingerprint(options[label]).sha256 }));
  const report = { createdAt: new Date().toISOString(), toolSha256: identity.sha256(fs.readFileSync(__filename)), builds,
    browserSha256: identity.sha256(fs.readFileSync(options.browser)), machine: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: process.platform, release: os.release() }, results: [], completed: false };
  const hits = [], server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'If-None-Match'); res.setHeader('Access-Control-Expose-Headers', 'ETag');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('ETag', 'fixture');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (['/probe', '/redirect', '/pixel'].includes(url.pathname)) {
      hits.push({ token: url.searchParams.get('token'), host: req.headers.host, cookie: req.headers.cookie || '', etagRequest: req.headers['if-none-match'] || '' });
      res.setHeader('Set-Cookie', (url.pathname === '/redirect' ? 'cookie_redirect' : 'cookie_new') + '=fixed; SameSite=None; Secure; Path=/');
      if (url.pathname === '/redirect') { res.writeHead(302, { Location: 'https://' + HOSTS.alias + ':' + server.address().port + '/probe?token=' + url.searchParams.get('token') + '-hop' }); res.end(); return; }
      if (url.pathname === '/pixel') { res.setHeader('Content-Type', 'image/gif'); res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')); return; }
      res.end('fixture');
    } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Cookie fixture</title><input value="editable">'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const save = () => { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2)); };
  try {
    for (let run = 1; run <= options.runs; run++) for (const build of run % 2 ? builds : [...builds].reverse()) {
      console.log('Tracker cookies ' + build.label + ' ' + run + '/' + options.runs);
      const row = await runOne(build, run, options, server, hits); report.results.push(row); save();
      if (!row.complete) throw new Error(row.error);
    }
    for (const build of builds) assert.equal(identity.fingerprint(build.directory).sha256, build.fingerprint, 'measured source changed');
    report.completed = true;
  } finally { save(); await new Promise(resolve => server.close(resolve)); }
  console.log('[ok] native sent/stored cookies, aliases, compatibility, priorities, UI, exceptions and atomic recovery');
}
if (require.main === module) profile.mustFinish(() => main(args(process.argv.slice(2))), 'tracker cookie browser checks')
  .catch(error => { console.error(error); process.exitCode = 1; });

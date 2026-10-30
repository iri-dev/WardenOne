/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Native CNAME catalog check: real DNR matching against the packaged ruleset, its cookie-only
   tier, compatibility initiators, site exceptions, pauses and the toggle, in a disposable profile.
   node tools/browser-cname-protection.js --browser <chrome> --extension <unpacked dir> --out <report.json> */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const { tls } = require('./browser-media-security.js');
const { helpers } = require('./build-cname-data.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
function args(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2), value = argv[i + 1];
    if (!['browser', 'extension', 'out'].includes(key) || !value) throw new Error('Expected --browser, --extension and --out');
    options[key] = path.resolve(value);
  }
  if (!options.browser || !options.extension || !options.out) throw new Error('Browser, extension and output required');
  return options;
}
async function evaluate(cdp, session, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

/* Real catalog hosts, chosen from the packaged rules so the fixture follows the data. */
function fixtureHosts(extension) {
  const { siteIdentity } = helpers();
  const rules = JSON.parse(fs.readFileSync(path.join(extension, 'rules-cname.json'), 'utf8'));
  const simple = host => siteIdentity(host).split('.').length === 2;
  const exact = rule => !/,\}/.test(rule.condition.regexFilter);
  const cookie = rules.find(rule => rule.action.type === 'modifyHeaders' && exact(rule)).condition.requestDomains.find(simple);
  const hostedRule = rules.find(rule => rule.action.type === 'block' && exact(rule) && rule.condition.excludedInitiatorDomains.includes(rule.condition.requestDomains[0]));
  const hosted = hostedRule.condition.requestDomains.find(simple);
  return { page: 'shop.trowow.de', known: 'a.trowow.de', child: 'child.a.trowow.de', unknown: 'unlisted.trowow.de',
    stapePage: 'www.avmarket.rs', stape: '0.avmarket.rs', familyPage: 'www.home24.de', familyChild: 'x1.net.home24.de', familyParent: 'net.home24.de',
    cookiePage: 'www.' + siteIdentity(cookie), cookie, hostedPage: 'www.' + siteIdentity(hosted), hosted, auth: 'accounts.google.com' };
}

async function run(options, server, hits, HOSTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-cname-'));
  const port = await profile.freePort(), started = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(options.extension, 'manifest.json')));
  let cdp;
  const result = { scenarios: [], complete: false };
  try {
    const resolver = Object.values(HOSTS).flatMap(host => [host, host + '.']).map(host => 'MAP ' + host + ' 127.0.0.1')
      .concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ');
    const browser = await profile.launch(options.browser, 'on', options.extension, port, dir,
      ['--host-resolver-rules=' + resolver, '--ignore-certificate-errors', '--disable-features=TrackingProtection3pcd,CalculateNativeWinOcclusion']);
    result.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, manifest.version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'reconciliation');
    await quiet();
    result.startupMs = Date.now() - started;
    result.enabledRulesets = await worker('chrome.declarativeNetRequest.getEnabledRulesets()');
    assert(result.enabledRulesets.includes('cname_trackers'), 'the catalog ruleset is enabled by default');
    const setConfig = async patch => {
      await worker('updateStoredConfig(cfg=>{Object.assign(cfg,' + JSON.stringify(patch) + ');}).then(()=>true)');
      await sleep(100); await quiet();
    };
    const origin = host => 'https://' + host + ':' + server.address().port;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId); await cdp.send('Network.enable', {}, sessionId);
    let context;
    const open = async host => {
      await cdp.send('Page.navigate', { url: origin(host) + '/' }, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.hostname===' + JSON.stringify(host) + '&&document.readyState==="complete"'), host + ' page');
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
      context = (await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'cname-native-network' }, sessionId)).executionContextId;
    };
    await worker('globalThis.__cnameMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info=>{if(info.request.url.includes("/probe?"))__cnameMatches.push({url:info.request.url,rule:info.rule});});true');
    let serial = 0;
    const request = async (name, host, expected) => {
      const token = 'cname-' + (++serial), url = origin(host) + '/probe?token=' + token;
      await cdp.send('Network.deleteCookies', { name: 'cname_new', url: origin(host) + '/' }, sessionId);
      await cdp.send('Network.setCookie', { name: 'cname_old', value: 'fixed', url: origin(host) + '/', secure: true, sameSite: 'None' }, sessionId);
      const start = Date.now();
      const response = await evaluate(cdp, sessionId, '(async()=>{try{const r=await fetch(' + JSON.stringify(url) + ',{credentials:"include",signal:AbortSignal.timeout(5000)});return {ok:r.ok};}catch(e){return {error:String(e)};}})()', context);
      const latencyMs = Date.now() - start;
      await sleep(50);
      const receipt = hits.find(hit => hit.token === token) || null;
      const matches = await worker('__cnameMatches.filter(info=>info.url.includes(' + JSON.stringify('token=' + token) + '))');
      const catalog = matches.filter(match => match.rule.rulesetId === 'cname_trackers');
      const cookies = await cdp.send('Network.getCookies', { urls: [origin(host) + '/'] }, sessionId);
      const stored = cookies.cookies.some(cookie => cookie.name === 'cname_new');
      /* Tracker cookie isolation may also strip an allowed request's cookies; that is a separate protection. */
      let status = 'error';
      if (!receipt && catalog.length) status = 'blocked';
      else if (receipt && catalog.length && !receipt.cookie.includes('cname_old') && !stored) status = 'cookies-stripped';
      else if (receipt && !catalog.length) status = 'allowed';
      const row = { name, host, expected, status, receipt, cookieStored: stored, matches, latencyMs, response };
      result.scenarios.push(row);
      assert.equal(status, expected, JSON.stringify(row));
      return row;
    };
    await open(HOSTS.page);
    await request('exact-alias', HOSTS.known, 'blocked');
    await request('exact-alias-trailing-dot', HOSTS.known + '.', 'blocked');
    await request('child-of-exact-alias', HOSTS.child, 'allowed');
    await request('unlisted-same-site', HOSTS.unknown, 'allowed');
    await open(HOSTS.stapePage);
    await request('server-side-tag-manager-alias', HOSTS.stape, 'blocked');
    await open(HOSTS.familyPage);
    await request('wildcard-family-child', HOSTS.familyChild, 'blocked');
    await request('wildcard-family-parent', HOSTS.familyParent, 'allowed');
    await open(HOSTS.cookiePage);
    await request('cookie-only-provider', HOSTS.cookie, 'cookies-stripped');
    await open(HOSTS.hostedPage);
    await request('hosted-provider-from-site', HOSTS.hosted, 'blocked');
    await open(HOSTS.hosted);
    await request('hosted-provider-own-page', HOSTS.hosted, 'allowed');
    await open(HOSTS.auth);
    await request('login-initiator', HOSTS.known, 'allowed');
    await open(HOSTS.page);
    await setConfig({ siteOverrides: { [HOSTS.page]: { blockCnameTrackers: false } } });
    result.exceptionRules = await worker('chrome.declarativeNetRequest.getDynamicRules().then(rows=>rows.filter(r=>r.id>=CNAME_RULE_BASE&&r.id<CNAME_RULE_BASE+CNAME_RULES_BUDGET))');
    assert(result.exceptionRules.length === 1 && result.exceptionRules[0].action.type === 'allow');
    await request('site-exception-without-reload', HOSTS.known, 'allowed');
    await open(HOSTS.stapePage);
    await request('other-site-unaffected-by-exception', HOSTS.stape, 'blocked');
    await open(HOSTS.page);
    await setConfig({ siteOverrides: {}, allowlist: [HOSTS.page] });
    await request('site-pause-without-reload', HOSTS.known, 'allowed');
    await setConfig({ allowlist: [] });
    await request('pause-lifted', HOSTS.known, 'blocked');
    await setConfig({ blockCnameTrackers: false });
    assert(!(await worker('chrome.declarativeNetRequest.getEnabledRulesets()')).includes('cname_trackers'));
    await request('switched-off', HOSTS.known, 'allowed');
    await setConfig({ blockCnameTrackers: true });
    await request('switched-on', HOSTS.known, 'blocked');
    await setConfig({ enabled: false });
    await request('master-off', HOSTS.known, 'allowed');
    await setConfig({ enabled: true });
    await request('master-on', HOSTS.known, 'blocked');
    await open(HOSTS.known);
    result.directAliasNavigation = 'loaded';
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    result.complete = true;
  } catch (error) {
    result.error = String(error.stack || error);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-cname-')) throw new Error('Unexpected fixture profile path');
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { result.cleanupWarning = String(error.message); }
  }
  return result;
}

async function main(options) {
  const HOSTS = fixtureHosts(options.extension);
  const report = { createdAt: new Date().toISOString(), toolSha256: identity.sha256(fs.readFileSync(__filename)),
    machine: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: process.platform, release: os.release() },
    browserSha256: identity.sha256(fs.readFileSync(options.browser)), extensionFingerprint: identity.fingerprint(options.extension).sha256, fixture: HOSTS };
  const hits = [], server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    if (url.pathname === '/probe') {
      hits.push({ token: url.searchParams.get('token'), host: req.headers.host, cookie: req.headers.cookie || '' });
      res.setHeader('Set-Cookie', 'cname_new=fixed; SameSite=None; Secure; Path=/');
    }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Cache-Control', 'no-store');
    res.end(url.pathname === '/probe' ? 'fixture' : '<!doctype html><title>CNAME fixture</title><input value="editable">');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { Object.assign(report, await run(options, server, hits, HOSTS)); }
  finally {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2));
    await new Promise(resolve => server.close(resolve));
  }
  if (!report.complete) throw new Error(report.error);
  console.log('[ok] CNAME catalog: exact, family, cookie-only, hosted and compatibility cases; exceptions, pause and switches without reload');
}
if (require.main === module) profile.mustFinish(() => main(args(process.argv.slice(2))), 'CNAME browser regression')
  .catch(error => { console.error(error); process.exitCode = 1; });

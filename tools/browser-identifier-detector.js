/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), assert = require('assert/strict');
const profile = require('./perf-profile.js');
const { tls } = require('./browser-media-security.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const { fingerprint, sha256 } = require('./lib/privacy-baseline.js');
const { validateEntries } = require('./check-package-archive.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await sleep(100); }
  throw Error('Timed out: ' + label);
}
async function run() {
  const [extensionArg, browserArg, out] = process.argv.slice(2);
  if (!out || !out.endsWith('.json')) throw Error('Usage: browser-identifier-detector.js frozen-runtime browser.exe new-report.json');
  if (fs.existsSync(out)) throw Error('Preserve existing native report');
  const source = path.resolve(extensionArg);
  if (fs.existsSync(path.join(source, '.git')) || fs.existsSync(path.join(source, 'tools'))) throw Error('Use a frozen release snapshot');
  const identity = fingerprint(source), problems = validateEntries(identity.files.map(f => f.path));
  if (problems.length) throw Error(problems.join('\n'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-identifiers-runtime-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-identifiers-profile-'));
  fs.cpSync(source, runtime, { recursive: true });
  const report = { date: new Date().toISOString(), runtimeFingerprint: identity.sha256,
    harnessSha256: sha256(fs.readFileSync(__filename)), checks: [], complete: false };
  const hits = [], value = 'z7A4nP9rT2mX8qL5vB1kD6sH3wF0cY9u';
  const server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/landing' + url.search }); res.end(); return; }
    hits.push({ host: req.headers.host.split(':')[0], path: url.pathname, fields: Object.fromEntries(url.searchParams) });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Identifier fixture</title><input id="editor" value="works"><main>Fixture ready</main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = await profile.freePort(), origins = ['one', 'two', 'three'].map(n => 'https://article.identifier-' + n + '.test:' + server.address().port);
  const collector = 'https://stats.identifier-fixture.test:' + server.address().port;
  let cdp, worker, ruleInstalled = false;
  const ruleId = 999991;
  try {
    const native = await profile.launch(path.resolve(browserArg), 'on', runtime, port, dir, ['--ignore-certificate-errors',
      '--host-resolver-rules=MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    report.browser = native.Browser;
    cdp = new profile.Cdp(native.webSocketDebuggerUrl); await cdp.connect();
    const ext = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version, undefined, 100);
    worker = expression => evaluate(cdp, ext.attachedSession, expression);
    await until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'), 'policy reconcile');
    await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    await profile.closeExtensionTabs(cdp, port, ext.id);
    const attach = async url => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.enable', {}, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.href===' + JSON.stringify(url) + '&&document.readyState==="complete"'), 'fixture load');
      return { targetId, sessionId };
    };
    const pages = [];
    for (const origin of origins) {
      const page = await attach(origin + '/article'); pages.push(page);
      await until(() => evaluate(cdp, page.sessionId, '!!window.__wardenOneReadyVersion'), 'page engine');
    }
    await until(() => worker('chrome.declarativeNetRequest.getSessionRules().then(r=>(r.find(x=>x.id===INTRANET_NET_RULE_BASE)?.condition.excludedTabIds?.length||0)>=3)'), 'loopback compatibility');
    await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    await worker('clearProtectionHistory(true).then(()=>true)');
    const rules = () => worker('Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.declarativeNetRequest.getEnabledRulesets()])');
    const before = await rules(), permissions = await worker('chrome.permissions.getAll()');
    const config = await worker("chrome.storage.local.get('wardenone_config')");
    const findings = () => worker('flushHistory();WO_HISTORY.drain().then(()=>chrome.storage.local.get("wardenone_history")).then(s=>(s.wardenone_history||[]).filter(e=>e.type==="warned_tracking_identifier"))');
    const fetchFrom = (page, url) => evaluate(cdp, page.sessionId, 'fetch(' + JSON.stringify(url) + ',{cache:"no-store"}).then(r=>r.ok)');
    for (let i = 0; i < 3; i++) {
      assert(await fetchFrom(pages[i], collector + '/collect?novel' + i + '=' + value + '&attempt=1'));
      if (i < 2) { await sleep(1100); assert(await fetchFrom(pages[i], collector + '/collect?novel' + i + '=' + value + '&attempt=2')); }
      assert.equal((await findings()).length, 0, 'insufficient evidence must stay quiet');
    }
    await sleep(1100); assert(await fetchFrom(pages[2], collector + '/collect?novel2=' + value + '&attempt=2'));
    let observed;
    await until(async () => { observed = await findings(); return observed.length === 1; }, 'suspected identifier finding');
    assert.equal(observed[0].detail.enforcement, 'detection-only');
    const receipts = hits.filter(h => h.path === '/collect');
    assert.equal(receipts.length, 6);
    assert(receipts.every(h => Object.values(h.fields).includes(value)), 'unfamiliar values arrive intact');
    assert(!JSON.stringify(observed).includes(value));
    assert(!origins.some(origin => JSON.stringify(observed).includes(new URL(origin).hostname)));
    report.network = { repeatedRequestsReceived: receipts.length, unfamiliarValuePreserved: true, suspectedFindings: observed.length };
    report.checks.push('Six real HTTPS requests across three verified sites create one detection-only finding; receiver gets the original value');
    await worker('clearProtectionHistory(true).then(()=>true)');
    for (const page of pages) {
      for (const route of ['/oauth/callback?state=safe&novel=', '/signed?signature=safe&novel=', '/download?novel=', '/api/collect?novel=']) {
        assert(await fetchFrom(page, collector + route + value)); await sleep(1050);
        assert(await fetchFrom(page, collector + route + value));
      }
    }
    assert.equal((await findings()).length, 0);
    assert(await fetchFrom(pages[0], collector + '/redirect?novel=' + value));
    const redirected = hits.find(h => h.path === '/landing'); assert.equal(redirected.fields.novel, value);
    const clean = await evaluate(cdp, pages[0].sessionId, 'window.__wardenOneCleanCopyUrl(' + JSON.stringify(origins[0] + '/article?utm_source=fixture&novel=' + value) + ')');
    assert(!new URL(clean).searchParams.has('utm_source')); assert.equal(new URL(clean).searchParams.get('novel'), value);
    report.checks.push('OAuth, signed URLs, downloads, APIs and redirects retain their parameters; familiar copy cleanup still works');
    await worker('chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:' + ruleId + ',priority:999999,action:{type:"redirect",redirect:{transform:{queryTransform:{removeParams:["fixture_marker"]}}}},condition:{urlFilter:"/dnr-probe?",resourceTypes:["xmlhttprequest"]}}]}).then(()=>true)');
    ruleInstalled = true;
    assert(await fetchFrom(pages[0], collector + '/dnr-probe?fixture_marker=private&keep=ok'));
    const transformed = hits.find(h => h.path === '/dnr-probe'); assert.deepEqual(transformed.fields, { keep: 'ok' });
    await worker('chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[' + ruleId + ']}).then(()=>true)'); ruleInstalled = false;
    report.checks.push('An isolated test-only explicit-name DNR query transform removes its marker before server receipt; the temporary rule is removed');
    assert.deepEqual(await rules(), before); assert.deepEqual(await worker('chrome.permissions.getAll()'), permissions);
    assert.deepEqual(await worker("chrome.storage.local.get('wardenone_config')"), config);
    report.checks.push('Shipped rules, configuration and permissions remain unchanged; no identifier-enforcement rule is created');
    const activity = await attach('chrome-extension://' + ext.id + '/history.html');
    await until(() => evaluate(cdp, activity.sessionId, '!!document.getElementById("tracker-catalog-status").textContent'), 'Activity ready');
    // This known fixture row exercises the final Activity label after the exclusion tests cleared evidence.
    await worker('queueHistory(' + JSON.stringify(observed[0]) + ');flushHistory();WO_HISTORY.drain().then(()=>true)');
    await evaluate(cdp, activity.sessionId, 'load();true');
    await until(() => evaluate(cdp, activity.sessionId, 'document.body.textContent.includes("Suspected identifier · detection only")'), 'Activity detection label');
    fs.writeFileSync(out.replace(/\.json$/, '.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' }, activity.sessionId)).data, 'base64'));
    report.checks.push('Activity labels suspected identifier evidence separately from known tracker attribution and blocking');
    report.complete = true;
  } catch (error) { report.error = error.stack || String(error); throw error; }
  finally {
    if (ruleInstalled && worker) await worker('chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[' + ruleId + ']}).then(()=>true)').catch(() => {});
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); await sleep(1000);
    cleanupProfile(dir, 'wo-identifiers-profile-'); cleanupProfile(runtime, 'wo-identifiers-runtime-');
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('[ok] ' + report.browser + ': ' + report.checks.length + ' native identifier, compatibility and pre-egress API checks');
}
profile.mustFinish(run, 'browser-identifier-detector').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

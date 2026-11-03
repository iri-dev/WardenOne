/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { tls } = require('./browser-media-security.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const HOST = 'www.ga-fixture.example.org', SUBDOMAIN = 'metrics.ga-fixture.example.org', THIRD = 'collector.ga-control.example.net';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(75); }
  throw Error('Timed out: ' + label);
}
async function run() {
  const [runtimeArg, browserArg, reportArg] = process.argv.slice(2);
  if (!reportArg || fs.existsSync(reportArg)) throw Error('Usage: browser-first-party-ga.js runtime browser.exe new-report.json');
  const runtime = path.resolve(runtimeArg), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-first-party-ga-'));
  const rule = JSON.parse(fs.readFileSync(path.join(runtime, 'rules-trackers.json'))).find(row => row.condition.domainType === 'firstParty' && row.condition.regexFilter);
  assert(rule);
  const receipts = [], report = { createdAt: new Date().toISOString(), checks: [], complete: false };
  const server = https.createServer(tls, (request, response) => {
    const url = new URL(request.url, 'https://' + request.headers.host);
    if (url.searchParams.has('probe')) receipts.push({ probe: url.searchParams.get('probe'), method: request.method });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin || '*');
    if (url.pathname === '/worker.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end('self.onmessage=async event=>{try{const r=await fetch(event.data);self.postMessage({ok:r.ok});}catch(error){self.postMessage({error:String(error)});}};');
    } else if (url.searchParams.has('pixel')) {
      response.setHeader('Content-Type', 'image/gif');
      response.end(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'));
    } else if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>First-party GA fixture</title><input id="editor" value="works"><main>Readable content</main>');
    } else { response.setHeader('Content-Type', 'text/plain'); response.end('fixture'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = host => 'https://' + host + ':' + server.address().port;
  let cdp, port;
  try {
    port = await profile.freePort();
    const browser = await profile.launch(path.resolve(browserArg), 'on', runtime, port, directory,
      ['--ignore-certificate-errors', '--host-resolver-rules=' + [HOST, SUBDOMAIN, THIRD].map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ')]);
    report.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version);
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'policy reconciliation');
    await quiet(); await profile.closeExtensionTabs(cdp, port, extension.id);
    report.defaults = await worker('localGet("wardenone_config").then(row=>({enabled:row.wardenone_config.enabled,blockTrackers:row.wardenone_config.blockTrackers,blockFirstPartyTrackers:row.wardenone_config.blockFirstPartyTrackers}))');
    assert.equal(report.defaults.blockTrackers, true); assert.equal(report.defaults.blockFirstPartyTrackers, false);
    assert((await worker('chrome.declarativeNetRequest.isRegexSupported(' + JSON.stringify({ regex: rule.condition.regexFilter, isCaseSensitive: true }) + ')')).isSupported);
    await worker('globalThis.__gaFixtureMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info=>{if(info.rule.rulesetId==="trackers"&&info.rule.ruleId===' + rule.id + ')__gaFixtureMatches.push(info.request.url);});true');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const page = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, page);
    const navigate = async () => {
      await cdp.send('Page.navigate', { url: origin(HOST) + '/' }, page);
      await until(() => evaluate(cdp, page, 'document.readyState==="complete"&&!!document.getElementById("editor")'), 'fixture page');
    };
    await navigate();
    let serial = 0;
    const request = async (route, { kind = 'fetch', method = 'GET', host = HOST, blocked = false } = {}) => {
      const probe = 'ga-' + ++serial, url = new URL(origin(host) + route);
      url.searchParams.set('probe', probe); if (kind === 'image') url.searchParams.set('pixel', '1');
      const address = JSON.stringify(url.href);
      const expression = kind === 'beacon' ? '({queued:navigator.sendBeacon(' + address + ',"fixture")})'
        : kind === 'image' ? 'new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({ok:true});image.onerror=()=>resolve({error:"image failed"});image.src=' + address + ';})'
          : kind === 'xhr' ? 'new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open(' + JSON.stringify(method) + ',' + address + ');xhr.onload=()=>resolve({ok:xhr.status===200});xhr.onerror=()=>resolve({error:"XHR failed"});xhr.send();})'
            : kind === 'worker' ? 'new Promise(resolve=>{const worker=new Worker("/worker.js");worker.onmessage=event=>{worker.terminate();resolve(event.data);};worker.onerror=()=>{worker.terminate();resolve({error:"worker failed"});};worker.postMessage(' + address + ');})'
              : 'fetch(' + address + ',{method:' + JSON.stringify(method) + ',signal:AbortSignal.timeout(5000)}).then(r=>({ok:r.ok}),error=>({error:String(error)}))';
      const result = await evaluate(cdp, page, expression);
      if (blocked) {
        await until(() => worker('__gaFixtureMatches.some(url=>url.includes(' + JSON.stringify('probe=' + probe) + '))'), kind + ' owned block');
        await sleep(100);
        assert(!receipts.some(row => row.probe === probe), 'blocked request reached the server: ' + route);
        if (kind !== 'beacon') assert(result.error, kind + ' must fail at the network layer');
      } else {
        await until(() => receipts.some(row => row.probe === probe), 'allowed server receipt: ' + route);
        assert(kind === 'beacon' ? result.queued : result.ok, JSON.stringify(result));
      }
    };
    for (const [kind, method] of [['fetch', 'GET'], ['fetch', 'POST'], ['xhr', 'GET'], ['xhr', 'POST'], ['beacon', 'POST'], ['image', 'GET'], ['worker', 'GET']]) {
      await request('/g/collect?v=2&tid=G-FIXTURE123&en=page_view', { kind, method, blocked: true });
    }
    await request('/metrics/g/collect?v=2&tid=G-FIXTURE123', { blocked: true });
    await request('/g/collect?v=2&tid=G-FIXTURE123', { host: SUBDOMAIN, blocked: true });
    report.checks.push('same-origin, same-site subdomain and prefixed GA4 hits never reach the server through fetch, XHR, beacon, image or worker');
    for (const route of ['/collect?tid=G-FIXTURE123', '/api/collect?tid=G-FIXTURE123', '/g/collect?v=2', '/g/collect?not_tid=G-FIXTURE123',
      '/g/collect?note=tid=G-FIXTURE123', '/g/collector?tid=G-FIXTURE123', '/api/data?next=/g/collect?tid=G-FIXTURE123']) await request(route);
    await request('/g/collect?tid=G-FIXTURE123', { method: 'HEAD' });
    await request('/g/collect?tid=G-FIXTURE123', { host: THIRD });
    assert.equal(await evaluate(cdp, page, 'document.getElementById("editor").value'), 'works');
    report.checks.push('unrelated endpoints, parameters, methods, third-party context and ordinary page controls keep working');
    for (const type of ['main_frame', 'sub_frame', 'script', 'stylesheet', 'font', 'media', 'websocket']) {
      const matches = await worker('chrome.declarativeNetRequest.testMatchOutcome(' + JSON.stringify({ url: origin(HOST) + '/g/collect?tid=G-FIXTURE123', initiator: origin(HOST), type }) + ')');
      assert(!matches.matchedRules.some(row => row.rulesetId === 'trackers' && row.ruleId === rule.id), type);
    }
    const setConfig = async patch => {
      const before = await worker('__refreshExtensionStateGeneration');
      await worker('updateStoredConfig(cfg=>Object.assign(cfg,' + JSON.stringify(patch) + ')).then(()=>true)');
      await until(() => worker('__refreshExtensionStateGeneration>' + before), 'updated policy generation');
      await quiet();
    };
    for (const patch of [{ blockTrackers: false }, { blockTrackers: true }, { enabled: false }, { enabled: true }]) {
      await setConfig(patch);
      await request('/g/collect?v=2&tid=G-FIXTURE123', { blocked: patch.blockTrackers === true || patch.enabled === true });
    }
    report.checks.push('tracker and master switches release and restore native blocks without reloading the page');
    await setConfig({ allowlist: ['ga-fixture.example.org'] }); await navigate();
    await request('/g/collect?v=2&tid=G-FIXTURE123');
    await setConfig({ allowlist: [] }); await navigate();
    await request('/g/collect?v=2&tid=G-FIXTURE123', { blocked: true });
    report.checks.push('site pause permits collection and unpausing restores the narrow rule');
    report.complete = true;
  } catch (error) { report.error = String(error.stack || error); throw error; }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); cleanupProfile(directory, 'wo-first-party-ga-');
    fs.mkdirSync(path.dirname(path.resolve(reportArg)), { recursive: true });
    fs.writeFileSync(reportArg, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('[ok] first-party GA4: ' + report.checks.join('; '));
}
if (require.main === module) profile.mustFinish(run, 'first-party GA4').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

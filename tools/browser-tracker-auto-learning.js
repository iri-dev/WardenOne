/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Native check for Learn trackers automatically: a tracker that sets a real cross-site ID cookie, which
   Block third-party cookies keeps out of the jar, learned from three sites in one browser session,
   then durable blocking, history, and unblock controls.
   node tools/browser-tracker-auto-learning.js --browser <chrome> --extension <unpacked dir> --out <report.json> */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const { tls } = require('./browser-media-security.js');
const SITES = ['alpha.auto-one.test', 'beta.auto-two.test', 'gamma.auto-three.test'];
const TRACKER = 'px.autotrack.test';
const RUNTIME = { canvas: 'frame.canvasprobe.test', storage: 'frame.storageprobe.test', url: 'frame.urlprobe.test', innocent: 'frame.innocentprobe.test' };
const ID = 'k3Jx9pQmZ0rT5vLs8nYw2bC4AHWqTU';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if (await check()) return; }
    catch (error) { if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find context/.test(String(error))) throw error; }
    await sleep(50);
  }
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

async function run(options, server, hits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-auto-learning-'));
  const origin = host => 'https://' + host + ':' + server.address().port;
  const resolver = [...SITES, TRACKER, ...Object.values(RUNTIME)].map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ');
  const flags = ['--host-resolver-rules=' + resolver, '--ignore-certificate-errors', '--disable-features=TrackingProtection3pcd,CalculateNativeWinOcclusion'];
  const manifest = JSON.parse(fs.readFileSync(path.join(options.extension, 'manifest.json')));
  const result = { checks: [], complete: false };
  let port, cdp, extension, page, context;
  const worker = expression => evaluate(cdp, extension.attachedSession, expression);
  try {
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'reconciliation');
    const launch = async () => {
      port = await profile.freePort();
      const browser = await profile.launch(options.browser, 'on', options.extension, port, dir, flags);
      cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
      extension = await profile.extensionReady(cdp, port, manifest.version); await quiet();
      await profile.closeExtensionTabs(cdp, port, extension.id); result.browser = browser.Browser;
      const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
      page = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
      await cdp.send('Page.enable', {}, page); await cdp.send('Network.enable', {}, page);
    };
    const setConfig = async patch => {
      await worker('updateStoredConfig(cfg=>{Object.assign(cfg,' + JSON.stringify(patch) + ');}).then(()=>true)');
      await sleep(100); await quiet();
    };
    const navigate = async host => {
      await cdp.send('Page.navigate', { url: origin(host) + '/' }, page);
      await until(() => evaluate(cdp, page, 'document.readyState==="complete"&&location.hostname===' + JSON.stringify(host)), host + ' page');
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, page);
      context = (await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'auto-learning' }, page)).executionContextId;
    };
    let serial = 0;
    const request = async (blocked = false) => {
      const token = 'auto-' + (++serial), url = origin(TRACKER) + '/probe?token=' + token;
      const response = await evaluate(cdp, page, `(async()=>{try{const r=await fetch(${JSON.stringify(url)},{credentials:'include',signal:AbortSignal.timeout(5000)});return {ok:r.ok};}catch(e){return {error:String(e)};}})()`, context);
      await sleep(75);
      const receipt = hits.find(row => row.token === token);
      if (blocked) {
        assert(!receipt && response.error, 'blocked request never reaches the server: ' + JSON.stringify({ receipt, response }));
        return { blocked: true };
      }
      assert(receipt && response.ok, 'allowed request reaches the server: ' + JSON.stringify(response));
      const jar = await cdp.send('Network.getCookies', { urls: [origin(TRACKER) + '/'] }, page);
      return { cookieSent: receipt.cookie.includes('tid=' + ID), stored: jar.cookies.some(cookie => cookie.name === 'tid') };
    };
    /* A tracking pixel. Block third-party cookies strips Set-Cookie from third-party images and pings,
       so this is the case where the jar never holds the ID. */
    const pixel = async () => {
      const token = 'auto-' + (++serial), url = origin(TRACKER) + '/probe?token=' + token;
      const loaded = await evaluate(cdp, page, `new Promise(done=>{const img=new Image();img.onload=img.onerror=()=>done(true);img.src=${JSON.stringify(url)};setTimeout(()=>done(false),5000)})`, context);
      await sleep(75);
      const receipt = hits.find(row => row.token === token);
      assert(loaded && receipt, 'the pixel reaches the server');
      const jar = await cdp.send('Network.getCookies', { urls: [origin(TRACKER) + '/'] }, page);
      return { cookieSent: receipt.cookie.includes('tid=' + ID), stored: jar.cookies.some(cookie => cookie.name === 'tid') };
    };
    const entry = () => worker('TRACKER_LEARNER.domains["autotrack.test"]||null');
    const blockRule = () => worker('getDynamicRulesInBand(TRACKER_RULE_BASE,TRACKER_RULE_MAX).then(rows=>rows.find(row=>row.action.type==="block")||null)');
    const unblockRule = () => worker('getDynamicRulesInBand(TRACKER_RULE_BASE,TRACKER_RULE_MAX).then(rows=>rows.find(row=>row.action.type==="allow"&&row.priority===1900&&row.condition.requestDomains.includes("autotrack.test"))||null)');

    await launch();
    const defaults = await worker('readFeedConfig().then(cfg=>({enabled:cfg.enabled,trackerLearner:cfg.trackerLearner,trackerLearnerAuto:cfg.trackerLearnerAuto,trackerCacheProtection:cfg.trackerCacheProtection,openPhish:cfg.openPhish,blockSponsoredSearchResults:cfg.blockSponsoredSearchResults,elementZapper:cfg.elementZapper}))');
    assert(Object.values(defaults).every(value => value === true), 'fresh install protections are enabled: ' + JSON.stringify(defaults));
    result.defaults = defaults;
    result.checks.push('fresh install enables the reviewed protection defaults');
    assert(await worker('chrome.webRequest.onBeforeRequest.hasListener(trackerCookieListener)'), 'the cookie observer follows the switch');
    assert(await worker('chrome.webRequest.onHeadersReceived.hasListener(trackerSetCookieListener)'), 'the Set-Cookie observer follows the switch');
    assert(await worker('chrome.declarativeNetRequest.getSessionRules().then(rows=>rows.some(row=>row.id===THIRD_PARTY_COOKIE_RULE_ID))'), 'Block third-party cookies is on');
    await worker(`(async()=>{const data={version:TRACKER_LEARNER_STORE_VERSION,salt:'00112233445566778899aabbccddeeff',domains:{},siteControls:{}};
      await localSet({[TRACKER_LEARNER_KEY]:data});TRACKER_LEARNER=trackerStoreShape(data);__initTrackerLearner=Promise.resolve(TRACKER_LEARNER);
      await chrome.storage.session.remove('wardenone_tracker_session');__trackerSession=null;return true;})()`);

    /* The tracker's own response sets the ID; nothing is planted in the jar. */
    for (const host of SITES.slice(0, 2)) {
      await navigate(host);
      const seen = await pixel();
      assert(!seen.cookieSent && !seen.stored, 'the ID never reaches the jar or the tracker while the learner watches: ' + JSON.stringify(seen));
    }
    await until(async () => (await entry())?.sites === 2, 'two sites in session one');
    assert.equal((await entry()).state, 'candidate');
    assert.equal(await blockRule(), null, 'two sites are not enough');
    result.checks.push('two sites learn from stripped Set-Cookie without storing a cookie or blocking yet');
    await navigate(SITES[2]);
    const third = await pixel();
    assert(!third.cookieSent && !third.stored, 'still no ID in the jar on the third site: ' + JSON.stringify(third));
    await until(async () => (await entry())?.automatic === 'block', 'automatic decision in the same session');
    await until(async () => !!(await blockRule()), 'native tracker block');
    result.entry = await entry(); result.rule = await blockRule();
    assert.equal(result.entry.state, 'learned');
    assert.equal(result.entry.sessions, 1);
    assert.deepEqual(result.rule.condition.requestDomains, ['autotrack.test']);
    assert.deepEqual(result.rule.condition.excludedResourceTypes, ['main_frame']);
    await navigate(SITES[0]); await request(true);
    for (const type of ['script', 'sub_frame', 'image', 'stylesheet', 'font', 'media', 'object', 'xmlhttprequest', 'ping', 'websocket', 'other', 'main_frame']) {
      const matches = await worker('chrome.declarativeNetRequest.testMatchOutcome(' + JSON.stringify({ url: origin(TRACKER) + '/probe', initiator: origin(SITES[0]), type }) + ')');
      assert.equal(matches.matchedRules.some(row => row.ruleId >= 720000 && row.ruleId < 721000), type !== 'main_frame', type);
    }
    result.checks.push('learned tracker requests never reach the server; all embedded resource types match, direct visits do not');
    await worker('(async()=>{TRACKER_LEARNER.domains["autotrack.test"].lastSeen=trackerDay(Date.now()-366*86400000);await saveTrackerLearner(true);return true;})()');
    await profile.killBrowser(cdp, port); cdp.close();
    await launch(); await navigate(SITES[0]); await request(true);
    assert.equal((await entry()).state, 'learned');
    result.checks.push('a year-old learned block survives pruning and a browser restart');

    const { targetId: popupId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
    const ui = (await cdp.send('Target.attachToTarget', { targetId: popupId, flatten: true })).sessionId;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 348, height: 820, deviceScaleFactor: 1, mobile: false }, ui);
    await until(() => evaluate(cdp, ui, '!!document.getElementById("tracker-learner-proposals")?.textContent.includes("autotrack.test")'), 'popup lists recent block');
    result.popupText = await evaluate(cdp, ui, 'document.getElementById("tracker-proposals-row").textContent.trim()');
    assert(/blocked automatically/.test(result.popupText) && /View learned tracker history/.test(result.popupText), result.popupText);
    assert(await evaluate(cdp, ui, 'document.querySelectorAll("#tracker-learner-controls input[type=checkbox]").length===1 && document.getElementById("tracker-learning-mode").value==="true"'), 'one learner switch and selected automatic mode');
    const chooseMode = async value => evaluate(cdp, ui, '(()=>{const select=document.getElementById("tracker-learning-mode");select.value=' + JSON.stringify(value) + ';select.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
    await chooseMode('false');
    await until(() => worker('localGet("wardenone_config").then(row=>row.wardenone_config.trackerLearnerAuto===false)'), 'review mode saved');
    await request(true);
    const popupEpoch = await evaluate(cdp, ui, 'performance.timeOrigin');
    await cdp.send('Page.enable', {}, ui); await cdp.send('Page.reload', {}, ui);
    await until(() => evaluate(cdp, ui, 'performance.timeOrigin>' + popupEpoch + ' && document.readyState==="complete" && document.getElementById("tracker-learning-mode")?.value==="false" && document.getElementById("tracker-proposals-desc")?.textContent.includes("learned tracker block")'), 'review mode persists while saved blocks stay');
    await chooseMode('true');
    await until(() => worker('localGet("wardenone_config").then(row=>row.wardenone_config.trackerLearnerAuto===true)'), 'automatic mode saved');
    await evaluate(cdp, ui, 'document.querySelector("input[data-key=trackerLearner]").click();true');
    await until(async () => !(await blockRule()), 'learner switch pauses rules');
    await request();
    assert(await evaluate(cdp, ui, 'document.getElementById("tracker-learning-mode").disabled && document.getElementById("tracker-learning-mode").value==="true"'));
    await evaluate(cdp, ui, 'document.querySelector("input[data-key=trackerLearner]").click();true');
    await until(async () => !!(await blockRule()), 'learner switch restores blocks');
    await request(true);
    const clip = await evaluate(cdp, ui, '(()=>{const r=document.getElementById("tracker-learner-controls").getBoundingClientRect();return {x:0,y:Math.max(0,Math.floor(r.top+scrollY)-12),width:348,height:Math.ceil(r.height)+24,scale:1};})()');
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip }, ui);
    result.popupScreenshot = options.out.replace(/.json$/i, '') + '-popup.png';
    fs.writeFileSync(result.popupScreenshot, Buffer.from(screenshot.data, 'base64'));
    result.checks.push('mode persists; review keeps learned blocks; learner master pauses and restores them');

    await evaluate(cdp, ui, 'document.getElementById("tracker-history-open").click();true');
    const historyUrl = 'chrome-extension://' + extension.id + '/settings.html#page=learned-trackers';
    await until(async () => (await cdp.send('Target.getTargets')).targetInfos.some(info => info.url === historyUrl), 'history opens from popup');
    const historyTarget = (await cdp.send('Target.getTargets')).targetInfos.find(info => info.url === historyUrl);
    const manager = (await cdp.send('Target.attachToTarget', { targetId: historyTarget.targetId, flatten: true })).sessionId;
    const manage = expression => evaluate(cdp, manager, expression);
    const unblockButton = '[...document.querySelectorAll("[data-act=tracker-unblock]")].find(button=>button.dataset.domain==="autotrack.test")';
    const reblockButton = '[...document.querySelectorAll("[data-act=tracker-reblock]")].find(button=>button.dataset.domain==="autotrack.test")';
    await until(() => manage('!!' + unblockButton), 'history lists learned tracker');
    await manage(unblockButton + '.click();true');
    await until(async () => (await entry())?.state === 'unblocked', 'unblock from history');
    await until(async () => !!(await unblockRule()), 'native unblock rule');
    await request();
    await until(() => manage('!!' + reblockButton), 'history offers Block again');
    await manage(reblockButton + '.click();true');
    await until(async () => (await entry())?.state === 'learned', 'block again from history');
    await until(async () => !!(await blockRule()), 'native reblock rule');
    await request(true);
    await until(() => manage('!!' + unblockButton), 'reblocked row');
    await manage(unblockButton + '.click();true');
    await until(async () => (await entry())?.state === 'unblocked', 'unblock for persistence');
    await until(async () => !!(await unblockRule()), 'native unblock restored');
    result.checks.push('history Unblock and Block again change real network behavior');
    await worker('(async()=>{for(let i=0;i<60;i++){const name="archive-"+String(i).padStart(3,"0")+".test",day=trackerDay(Date.now()-366*86400000);TRACKER_LEARNER.domains[name]={state:"learned",automatic:"block",fullBlock:true,approvedAt:day,learnedAt:day,firstSeen:day,lastSeen:day,hits:3,sites:3,sessions:2,reason:"History fixture <img src=x onerror=window.__trackerInjected=true>"};}await saveTrackerLearner(true);return true;})()');
    await until(() => manage('trackerHistoryState.data?.total===61 && document.querySelectorAll(".tracker-history-entry").length===25'), 'history paginates sixty-one entries');
    await manage('document.querySelector("[data-act=tracker-history-next]").click();true');
    await until(() => manage('trackerHistoryState.data?.page===1 && document.querySelectorAll(".tracker-history-entry").length===25'), 'second page');
    await manage('document.getElementById("tracker-history-search").value="archive-005";document.getElementById("tracker-history-search").dispatchEvent(new Event("input",{bubbles:true}));true');
    await until(() => manage('trackerHistoryState.data?.total===1 && document.querySelector(".tracker-history-entry")?.textContent.includes("archive-005.test")'), 'search finds an older learned tracker');
    assert(await manage('!document.querySelector(".tracker-history-entry img") && !window.__trackerInjected'), 'stored evidence is escaped');
    await until(() => evaluate(cdp, ui, 'document.querySelectorAll("#tracker-learner-proposals .perm-row").length===5'), 'popup stays at five recent entries');
    await cdp.send('Page.enable', {}, manager);
    await manage('document.getElementById("tracker-history-search").value="";document.getElementById("tracker-history-search").dispatchEvent(new Event("input",{bubbles:true}));true');
    await until(() => manage('trackerHistoryState.data?.total===61'), 'history search cleared');
    const historyScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, manager);
    result.historyScreenshot = options.out.replace(/.json$/i, '') + '-history.png';
    fs.writeFileSync(result.historyScreenshot, Buffer.from(historyScreenshot.data, 'base64'));
    result.checks.push('long-term history is searchable and paginated, stored evidence is escaped, popup stays compact');
    await profile.killBrowser(cdp, port); cdp.close(); await launch();
    await navigate(SITES[1]); await request();
    assert.equal((await entry()).state, 'unblocked');
    await navigate(SITES[2]); await request();
    assert.equal((await entry()).state, 'unblocked', 'automatic learning respects durable unblock choice');
    result.checks.push('unblock survives restart and repeated browser observations');

    const runtimeEntry = kind => worker('TRACKER_LEARNER.domains[' + JSON.stringify(RUNTIME[kind].split('.').slice(-2).join('.')) + ']||null');
    const runtimePage = async (host, kind) => {
      await cdp.send('Page.navigate', { url: origin(host) + '/runtime?kind=' + kind }, page);
      await until(() => evaluate(cdp, page, 'document.readyState==="complete"&&location.hostname===' + JSON.stringify(host)), kind + ' fixture');
    };
    for (const kind of ['canvas', 'storage']) {
      for (const [i, host] of SITES.entries()) {
        await runtimePage(host, kind);
        await until(async () => (await runtimeEntry(kind))?.evidence[kind === 'canvas' ? 'canvas-fingerprint' : 'local-storage'] >= i + 1, kind + ' evidence on ' + host);
      }
      const learned = await runtimeEntry(kind);
      assert.equal(learned.automatic, 'block', kind + ' native observer learned a block');
      assert.equal(learned.sessions, 1);
      assert.equal(learned.trustedSites[kind === 'canvas' ? 'canvas-fingerprint' : 'local-storage'].sites, 3);
      result.checks.push(kind + ' observations learn from three real third-party frames in one session');
    }
    await runtimePage(SITES[0], 'url');
    await until(async () => (await runtimeEntry('url'))?.evidence['local-storage'] === 1, 'URL storage seed');
    for (const [i, host] of SITES.entries()) {
      await navigate(host);
      await evaluate(cdp, page, 'fetch(' + JSON.stringify(origin(RUNTIME.url) + '/identifier?visitor_id=' + ID) + ').catch(()=>null).then(()=>true)');
      await until(async () => (await runtimeEntry('url'))?.evidence['url-id'] >= i + 1, 'native URL-ID evidence');
    }
    assert.equal((await runtimeEntry('url')).automatic, 'block');
    result.checks.push('native URL IDs must match an isolated-world storage observation');
    for (const host of SITES) {
      await navigate(host);
      await evaluate(cdp, page, 'fetch(' + JSON.stringify(origin(RUNTIME.innocent) + '/identifier?visitor_id=' + ID) + ').catch(()=>null).then(()=>true)');
    }
    assert.equal(await runtimeEntry('innocent'), null, 'fabricated URL IDs cannot accuse another domain');
    const metadata = await evaluate(cdp, page, 'navigator.userAgentData.getHighEntropyValues(["architecture","bitness","platformVersion","model","fullVersionList"])');
    assert.equal(metadata.platformVersion, ''); assert.equal(metadata.model, '');
    assert(metadata.architecture && metadata.bitness, 'download selection fields stay available');
    assert(metadata.fullVersionList.every(row => /^\d+\.0\.0\.0$/.test(row.version)));
    assert(await evaluate(cdp, page, '!window.__wardenOneRealm.noise'), 'broad fingerprint noise remains off by default');
    result.clientHints = metadata;
    result.checks.push('default JavaScript hints reduce metadata while preserving download architecture and leaving broad noise off');

    const stored = await worker('localGet(TRACKER_LEARNER_KEY).then(row=>JSON.stringify(row[TRACKER_LEARNER_KEY]))');
    for (const value of [...SITES, ID]) assert(!stored.includes(value), 'durable learner holds ' + value);
    result.checks.push('no site names or cookie values stored');
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    result.complete = true;
  } catch (error) {
    result.error = String(error.stack || error);
    if (extension && cdp) result.rulesOnFailure = await worker('getDynamicRulesInBand(TRACKER_RULE_BASE,TRACKER_RULE_MAX)').catch(() => null);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-auto-learning-')) throw new Error('Unexpected fixture profile path');
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { result.cleanupWarning = String(error.message); }
  }
  return result;
}

async function main(options) {
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  const report = { createdAt: new Date().toISOString(), toolSha256: identity.sha256(fs.readFileSync(__filename)),
    browserSha256: identity.sha256(fs.readFileSync(options.browser)), extensionFingerprint: identity.fingerprint(options.extension).sha256 };
  const hits = [], server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    if (url.pathname === '/probe') {
      hits.push({ token: url.searchParams.get('token'), cookie: req.headers.cookie || '' });
      res.setHeader('Set-Cookie', 'tid=' + ID + '; SameSite=None; Secure; Path=/; Max-Age=31536000');
    }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Cache-Control', 'no-store');
    const kind = url.searchParams.get('kind');
    if (url.pathname === '/runtime' && Object.hasOwn(RUNTIME, kind)) {
      res.setHeader('Content-Type', 'text/html');
      const host = url.hostname;
      if (SITES.includes(host)) {
        const src = 'https://' + RUNTIME[kind] + ':' + server.address().port + '/runtime?kind=' + kind;
        res.end('<!doctype html><title>Runtime learning fixture</title><iframe src="' + src + '"></iframe>');
      } else {
        const script = kind === 'canvas' ? 'const canvas=document.createElement("canvas");canvas.width=200;canvas.height=40;const ctx=canvas.getContext("2d");ctx.fillText("Canvas tracking fixture",0,20);window.fixtureExport=canvas.toDataURL();'
          : 'localStorage.setItem("visitor_id",' + JSON.stringify(ID) + ');';
        res.end('<!doctype html><title>Tracker fixture</title><script>' + script + '</script>');
      }
    } else res.end(url.pathname === '/probe' ? 'fixture' : '<!doctype html><title>Automatic learning fixture</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { Object.assign(report, await run(options, server, hits)); }
  finally {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2));
    await new Promise(resolve => server.close(resolve));
  }
  if (!report.complete) throw new Error(report.error);
  console.log('[ok] automatic tracker learning: ' + report.checks.join('; '));
}
if (require.main === module) profile.mustFinish(() => main(args(process.argv.slice(2))), 'automatic tracker learning')
  .catch(error => { console.error(error); process.exitCode = 1; });

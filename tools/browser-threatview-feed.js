/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), os = require('os'), https = require('https');
const profile = require('./perf-profile.js');
const { tls } = require('./browser-media-security.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(check, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { if (!/context|navigat/i.test(String(error))) throw error; }
    await sleep(75);
  }
  throw Error('Timed out: ' + label);
}
async function run() {
  const [runtimeArg, browserArg, snapshotArg, output, liteArg] = process.argv.slice(2);
  if (!output || fs.existsSync(output)) throw Error('Usage: browser-threatview-feed.js runtime browser.exe snapshot.txt new-report.json');
  const runtime = path.resolve(runtimeArg), snapshot = fs.readFileSync(snapshotArg, 'utf8');
  const liteSnapshot = liteArg ? fs.readFileSync(liteArg, 'utf8') : null;
  const liteUrl = 'https://raw.githubusercontent.com/badmojr/1Hosts/master/Lite/adblock.txt';
  const liteProbe = '0-1.ir';
  const feed = 'https://threatview.io/Downloads/DOMAIN-High-Confidence-Feed.txt';
  const scamFeed = 'https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt';
  const gameHosts = ['gamedrive.org', 'www.gamedrive.org', 'bad.gamedrive.org', 'gamedrive.org.attacker.net'];
  const blocked = '00000001gogoli.info', publisher = 'publisher.threatview-fixture.net', fileHost = 'fileditch.com';
  assert(snapshot.split(/\r?\n/).includes(blocked), 'fixture probe must be present in the supplied feed');
  if (liteSnapshot) assert(liteSnapshot.includes('||' + liteProbe + '^') && !snapshot.split(/\r?\n/).includes(liteProbe));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-threatview-'));
  const receipts = [], report = { createdAt: new Date().toISOString(), checks: [], complete: false };
  const media = fs.readFileSync(path.join(runtime, 'spotify-silent-1s.mp4'));
  const server = https.createServer(tls, (request, response) => {
    const url = new URL(request.url, 'https://' + request.headers.host);
    receipts.push({ host: url.hostname, path: url.pathname, probe: url.searchParams.get('probe') });
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/media.mp4') { response.setHeader('Content-Type', 'video/mp4'); response.end(media); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>ThreatView fixture</title><input id="editor" value="works"><button id="play">Play</button><video id="player" muted loop controls src="/media.mp4"></video><script>document.getElementById("play").onclick=()=>document.getElementById("player").play();</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = host => 'https://' + host + ':' + server.address().port;
  const gameSnapshot = gameHosts.map(host => '0.0.0.0 ' + host).concat(
    '||gamedrive.org:' + server.address().port + '/blocked-payload$xmlhttprequest').join('\n');
  let cdp, port, page;
  try {
    port = await profile.freePort();
    const browser = await profile.launch(path.resolve(browserArg), 'on', runtime, port, directory,
      ['--ignore-certificate-errors', '--host-resolver-rules=' + [blocked, publisher, fileHost, liteProbe, ...gameHosts].map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ')]);
    report.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version);
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'policy reconciliation');
    await quiet(); await profile.closeExtensionTabs(cdp, port, extension.id);
    await worker('globalThis.__tvSnapshot=' + JSON.stringify(snapshot) + ';globalThis.__tvFetches=0;globalThis.__tvMatches=[];globalThis.__tvNativeFetch=fetch;globalThis.__tvSources=new Set(REMOTE_LISTS.concat(TOKEN_AND_SCAM_LISTS,MALWARE_LISTS,TRACKER_LISTS,ADSHIELD_NET_LISTS,ADSHIELD_COSMETIC_LISTS,SUPPLEMENTAL_LIST_SOURCES.map(s=>s.url)));globalThis.fetch=async function(input,options){const url=String(input);if(__tvSources.has(url)){if(url===' + JSON.stringify(feed) + '){__tvFetches++;return new Response(__tvSnapshot,{status:200});}return new Response("other-source.threatview-fixture.net",{status:200});}return __tvNativeFetch(input,options);};chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info=>{if(info.request.url.includes("probe=tv-")&&info.rule.rulesetId==="_dynamic")__tvMatches.push({url:info.request.url,id:info.rule.ruleId});});true');
    await worker('globalThis.__gamePreviousFetch=fetch;globalThis.fetch=async function(input,options){return String(input)==='
      + JSON.stringify(scamFeed) + '?new Response(' + JSON.stringify(gameSnapshot) + ',{status:200}):__gamePreviousFetch(input,options);};true');
    if (liteSnapshot) await worker('globalThis.__liteSnapshot=' + JSON.stringify(liteSnapshot) + ';globalThis.__liteFetches=0;globalThis.__litePreviousFetch=fetch;globalThis.fetch=async function(input,options){if(String(input)===' + JSON.stringify(liteUrl) + '){__liteFetches++;return new Response(__liteSnapshot,{status:200});}return __litePreviousFetch(input,options);};true');
    await worker('(async()=>{if(__remoteListUpdateInFlight)await __remoteListUpdateInFlight.catch(()=>{});return true;})()');
    const setConfig = async patch => {
      const generation = await worker('__refreshExtensionStateGeneration');
      await worker('updateStoredConfig(cfg=>Object.assign(cfg,' + JSON.stringify(patch) + ')).then(()=>true)');
      await until(() => worker('__refreshExtensionStateGeneration>' + generation), 'new policy generation'); await quiet();
    };
    await setConfig({ autoUpdateLists: false, blockTrackers: false, adShield: false, blockMalwareSites: true });
    const update = () => worker('updateRemoteListsCore("manual").then(result=>({ok:result.ok,error:result.error,source:result.meta?.feedDomainCounts?.find(s=>s.url===' + JSON.stringify(feed) + ')}))');
    report.source = await update();
    assert.equal(report.source.ok, true, report.source.error);
    assert(report.source.source.activeCount > 500000);
    report.parser = await worker('({accepted:parseList(__tvSnapshot).filter(host=>remoteListBlockAllowed(host,"","security",' + JSON.stringify(feed) + ')).length,idnaProbe:parseList("anakhaled20.xn--noip-h8f6471b.biz")})');
    assert.equal(report.source.source.listedCount, report.parser.accepted);
    report.native = await worker('getDynamicRulesInBand(DYNAMIC_RULE_BASE,LIST_DOMAIN_RULES_MAX).then(rules=>({rules:rules.length,maxDomains:Math.max(...rules.map(r=>r.condition.requestDomains?.length||0)),probe:rules.some(r=>r.priority===3000&&r.condition.requestDomains.includes(' + JSON.stringify(blocked) + '))}))');
    assert.equal(report.native.probe, true); assert(report.native.maxDomains <= 50000);
    report.checks.push('the full cleaned feed compiles into native security rules and reports its accepted and unique counts');
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    page = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, page);
    let revision = 0, probe = 0;
    const navigate = async () => {
      await cdp.send('Page.navigate', { url: origin(publisher) + '/?revision=' + ++revision }, page);
      await until(() => evaluate(cdp, page, 'document.readyState==="complete"&&!!document.getElementById("editor")'), 'publisher page');
    };
    const request = async (shouldBlock, host = blocked, pathname = '/payload') => {
      const id = 'tv-' + ++probe, url = origin(host) + pathname + '?probe=' + id;
      const result = await evaluate(cdp, page, 'fetch(' + JSON.stringify(url) + ',{signal:AbortSignal.timeout(5000)}).then(r=>({ok:r.ok}),e=>({error:String(e)}))');
      if (shouldBlock) {
        assert(result.error, host + pathname + ': expected a blocked request');
        await until(() => worker('__tvMatches.some(match=>match.url.includes(' + JSON.stringify('probe=' + id) + '))'), 'owned native security block');
        assert(!receipts.some(row => row.probe === id));
      } else {
        assert(result.ok); await until(() => receipts.some(row => row.probe === id), 'allowed fixture request');
      }
    };
    await navigate(); await request(true);
    for (const host of gameHosts) await request(host !== 'gamedrive.org' && host !== 'www.gamedrive.org', host);
    await request(true, 'gamedrive.org', '/blocked-payload');
    const gameDocument = origin('gamedrive.org') + '/?probe=game-document';
    assert.equal((await cdp.send('Page.navigate', { url: gameDocument }, page)).errorText, undefined);
    await until(() => evaluate(cdp, page, 'location.hostname==="gamedrive.org"&&!!document.getElementById("editor")'), 'GameDrive fixture document');
    assert(receipts.some(row => row.probe === 'game-document'));
    report.checks.push('GameDrive apex and www load, while listed children, lookalikes and same-source targeted payloads remain blocked');
    await navigate();
    assert(await evaluate(cdp, page, 'fetch(' + JSON.stringify(origin(fileHost) + '/download?probe=filehost') + ').then(r=>r.ok,()=>false)'), 'the feed must not block the whole FileDitch service');
    const match = await worker('chrome.declarativeNetRequest.testMatchOutcome(' + JSON.stringify({ url: origin(blocked) + '/payload', type: 'main_frame' }) + ')');
    assert(match.matchedRules.some(rule => rule.rulesetId === '_dynamic' && rule.ruleId >= 10000 && rule.ruleId < 10120));
    const point = await evaluate(cdp, page, '(()=>{const r=document.getElementById("play").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, page);
    await until(() => evaluate(cdp, page, 'document.getElementById("player").currentTime>0.1&&!document.getElementById("player").paused'), 'trusted ordinary media playback');
    assert.equal(await evaluate(cdp, page, 'document.getElementById("editor").value'), 'works');
    report.checks.push('native resource blocking reaches no server while ordinary page controls and trusted media playback work');
    await setConfig({ allowlist: [publisher] }); await navigate(); await request(false);
    await setConfig({ allowlist: [] }); await navigate(); await request(true);
    report.checks.push('site pause permits the request and unpausing restores protection');
    await setConfig({ blockMalwareSites: false });
    const fetches = await worker('__tvFetches');
    const off = await update(); assert.equal(off.ok, true, off.error); assert.equal(off.source, undefined);
    assert.equal(await worker('__tvFetches'), fetches); await request(false);
    await setConfig({ blockMalwareSites: true }); assert.equal((await update()).ok, true); await request(true);
    if (liteSnapshot) {
      await setConfig({ adShield: true }); assert.equal((await update()).ok, true);
      report.lite = await worker('getListMeta().then(meta=>meta.feedDomainCounts.find(source=>source.url===' + JSON.stringify(liteUrl) + '))');
      assert(report.lite.listedCount > 90000); await request(true, liteProbe);
      const liteRules = await worker('getDynamicRulesInBand(DYNAMIC_RULE_BASE,LIST_DOMAIN_RULES_MAX).then(rules=>rules.filter(rule=>rule.condition.requestDomains.includes(' + JSON.stringify(liteProbe) + ')).map(rule=>({priority:rule.priority,domainType:rule.condition.domainType,types:rule.condition.resourceTypes})))');
      assert(liteRules.some(rule=>rule.priority===1000&&rule.domainType==='thirdParty'&&!rule.types.includes('main_frame')));
      await setConfig({ adShield: false });
      const liteFetches = await worker('__liteFetches'); assert.equal((await update()).ok, true);
      assert.equal(await worker('__liteFetches'), liteFetches); await request(false, liteProbe);
      report.checks.push('the full 1Hosts Lite feed uses third-party resource rules, and AdShield off stops its downloads and releases its requests');
    }
    await setConfig({ enabled: false }); await request(false);
    report.checks.push('malware and master switches release native blocking, and the malware switch stops downloading ThreatView');
    report.complete = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (cdp && page) report.failurePage = await evaluate(cdp, page, '({url:location.href,text:document.body?.innerText})').catch(()=>null);
    throw error;
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(()=>{}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); cleanupProfile(directory, 'wo-threatview-');
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n');
  }
  console.log('[ok] ThreatView native integration: ' + report.source.source.listedCount + ' domains; ' + report.checks.join('; '));
}
if (require.main === module) profile.mustFinish(run, 'ThreatView native feed integration').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

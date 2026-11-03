/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs'), https = require('https'), os = require('os'), path = require('path');
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
  const end = Date.now() + 30000;
  while (Date.now() < end) { try { if (await check()) return; } catch (error) { if (!/context|navigat/i.test(String(error))) throw error; } await sleep(75); }
  throw Error('Timed out: ' + label);
}
async function run() {
  const [runtimeArg, browserArg, output] = process.argv.slice(2);
  if (!output || fs.existsSync(output)) throw Error('Usage: browser-tracking-redirects.js runtime browser.exe new-report.json');
  const runtime = path.resolve(runtimeArg), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-tracking-redirects-'));
  const catalog = require(path.join(runtime, 'tracking-redirects.js'));
  const paths = { google: '/url', 'google-ads': '/pagead/aclk', youtube: '/redirect', facebook: '/l.php', reddit: '/t3_fixture', linkedin: '/safety/go',
    duckduckgo: '/l/', bing: '/ck/a', awin: '/cread.php', cj: '/click-1-2', rakuten: '/deeplink', skimlinks: '/', sovrn: '/',
    'skimlinks-legacy': '/', shareasale: '/r.cfm', tradedoubler: '/click', impact: '/c/1/2/3', clickserve: '/link/click',
    partnerize: '/click/camref:fixture/destination:', ebay: '/rover/1/2/3' };
  const destination = 'merchant.redirect-fixture.example.org', publisher = 'publisher.redirect-fixture.example.net', threat = 'threat.redirect-fixture.example.com';
  const receipts = [], report = { createdAt: new Date().toISOString(), cases: [], checks: [], complete: false };
  let port, cdp, browserTab, worker;
  const server = https.createServer(tls, (request, response) => {
    const url = new URL(request.url, 'https://' + request.headers.host);
    receipts.push({ host: url.hostname, path: url.pathname, query: url.search });
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'text/html');
    if (url.hostname === destination) { response.end('<!doctype html><title>Destination</title><input id="editor" value="works"><p>Destination</p>'); return; }
    if (url.hostname === publisher) { response.end('<!doctype html><a id="go" href="' + (url.searchParams.get('go') || '#').replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">Open destination</a>'); return; }
    response.writeHead(302, { Location: 'https://' + destination + ':' + server.address().port + '/fallback' }); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = host => 'https://' + host + ':' + server.address().port;
  const wrapped = (entry, target) => {
    if (entry.pathTarget) return origin(entry.hosts[0]) + paths[entry.id] + encodeURIComponent(target);
    const url = new URL(origin(entry.hosts[0]) + paths[entry.id]);
    url.searchParams.set(entry.keys[0], entry.base64 ? 'a1' + Buffer.from(target).toString('base64url') : target);
    return url.href;
  };
  try {
    port = await profile.freePort();
    const hosts = [...new Set(catalog.profiles.flatMap(entry => entry.hosts).concat(destination, publisher, threat))];
    const browser = await profile.launch(path.resolve(browserArg), 'on', runtime, port, directory,
      ['--ignore-certificate-errors', '--host-resolver-rules=' + hosts.map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ')]);
    report.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version);
    worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'policy reconciliation');
    await quiet(); await profile.closeExtensionTabs(cdp, port, extension.id);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    browserTab = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, browserTab);
    const navigate = async url => { await cdp.send('Page.navigate', { url }, browserTab); };
    const pageURL = () => evaluate(cdp, browserTab, 'location.href');
    const clickLink = async () => {
      const point = await evaluate(cdp, browserTab, '(()=>{const box=document.getElementById("go").getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})()');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, browserTab);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, browserTab);
    };
    for (const entry of catalog.profiles) {
      const url = origin(destination) + '/product?case=' + entry.id + '&signature=KEEP%2FTHIS#section';
      const before = receipts.length;
      await navigate(wrapped(entry, url));
      await until(async () => await pageURL() === url, entry.id + ' destination');
      assert(!receipts.slice(before).some(row => entry.hosts.includes(row.host)), entry.id + ' contacted the redirector');
      assert.equal(await evaluate(cdp, browserTab, 'document.getElementById("editor")?.value'), 'works');
      report.cases.push({ provider: entry.id, skipped: true });
    }
    report.checks.push('every reviewed provider reaches the exact signed destination without contacting its redirector');
    const rawPathTarget = origin(destination) + '/raw?signature=KEEP%2FTHIS';
    let rawBefore = receipts.length;
    await navigate(origin('prf.hn') + paths.partnerize + rawPathTarget);
    await until(async () => await pageURL() === rawPathTarget, 'raw Partnerize destination query');
    assert(!receipts.slice(rawBefore).some(row => row.host === 'prf.hn'));
    const awin = catalog.profiles.find(entry => entry.id === 'awin'), skim = catalog.profiles.find(entry => entry.id === 'skimlinks');
    const final = origin(destination) + '/nested?signature=KEEP%2FTHIS#keep';
    let before = receipts.length;
    await navigate(wrapped(awin, wrapped(skim, final)));
    await until(async () => await pageURL() === final, 'nested destination');
    assert(!receipts.slice(before).some(row => [awin.hosts[0], skim.hosts[0]].includes(row.host)));
    report.checks.push('nested redirectors resolve locally');
    const continueOriginal = async url => {
      before = receipts.length; await navigate(url);
      await until(async () => await pageURL() === origin(destination) + '/fallback', 'original redirect continuation');
      assert(receipts.slice(before).some(row => row.host === awin.hosts[0]));
    };
    await continueOriginal(origin(awin.hosts[0]) + paths.awin + '?campaign=OPAQUE');
    await continueOriginal(wrapped(awin, final) + '&signature=SIGNED');
    await continueOriginal(wrapped(awin, final) + '&ued=' + encodeURIComponent(origin(destination) + '/different'));
    await until(() => worker('chrome.declarativeNetRequest.getSessionRules().then(rules=>!rules.some(rule=>rule.id>=TRACKING_REDIRECT_FALLBACK_BASE&&rule.id<TRACKING_REDIRECT_FALLBACK_BASE+TRACKING_REDIRECT_FALLBACK_BUDGET))'), 'continuation allowance cleanup');
    report.checks.push('opaque, signed and ambiguous wrappers retain normal behavior and temporary allowances are removed');
    await worker('writeDynamicRules({removeRuleIds:[6000001],addRules:[{id:6000001,priority:1000,action:{type:"block"},condition:{requestDomains:["awin1.com"],resourceTypes:["main_frame"]}}]}).then(()=>true)');
    before = receipts.length; await navigate(wrapped(awin, final));
    await until(async () => await pageURL() === final, 'tracker block replaced by skip');
    assert(!receipts.slice(before).some(row => row.host === awin.hosts[0]));
    await worker('writeDynamicRules({removeRuleIds:[6000001]}).then(()=>true)');
    report.checks.push('a tracker-only block becomes a working destination instead of an error page');
    const setConfig = async patch => {
      const generation = await worker('__refreshExtensionStateGeneration');
      await worker('updateStoredConfig(cfg=>Object.assign(cfg,' + JSON.stringify(patch) + ')).then(()=>true)');
      await until(() => worker('__refreshExtensionStateGeneration>' + generation), 'new policy generation'); await quiet();
    };
    await setConfig({ unshimLinks: false }); await continueOriginal(wrapped(awin, final));
    await setConfig({ unshimLinks: true, allowlist: ['awin1.com'] }); await continueOriginal(wrapped(awin, final));
    await setConfig({ allowlist: [], siteOverrides: { 'awin1.com': { unshimLinks: false } } }); await continueOriginal(wrapped(awin, final));
    await setConfig({ siteOverrides: {} });
    const linkPage = origin(publisher) + '/?go=' + encodeURIComponent(wrapped(awin, final));
    await navigate(linkPage);
    await until(async () => await pageURL() === linkPage, 'publisher page');
    before = receipts.length;
    await clickLink();
    await until(async () => await pageURL() === final, 'clicked link destination');
    assert(!receipts.slice(before).some(row => row.host === awin.hosts[0]));
    const history = await cdp.send('Page.getNavigationHistory', {}, browserTab);
    await cdp.send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1].id }, browserTab);
    await until(async () => await pageURL() === linkPage, 'back returns to publisher');
    await setConfig({ siteOverrides: { [publisher]: { unshimLinks: false } } });
    before = receipts.length;
    await clickLink();
    await until(async () => await pageURL() === origin(destination) + '/fallback', 'publisher override');
    assert(receipts.slice(before).some(row => row.host === awin.hosts[0]));
    await setConfig({ siteOverrides: {} });
    report.checks.push('real link clicks skip the host, Back returns to the publisher and initiating-site overrides retain the original route');
    report.checks.push('the unshim switch, site pause and site override release the skip rules');
    assert(await worker('getDynamicRulesInBand(TRACKING_REDIRECT_RULE_BASE,TRACKING_REDIRECT_RULES_BUDGET).then(rules=>rules.every(rule=>!rule.condition.excludedRequestDomains))'), 'unpausing removes the native skip exclusions');
    before = receipts.length;
    await navigate(wrapped(awin, 'https://127.0.0.1:' + server.address().port + '/private'));
    await until(() => evaluate(cdp, browserTab, 'document.getElementById("status")?.textContent==="This link could not be opened safely"'), 'unsafe target refusal');
    assert(!receipts.slice(before).some(row => row.path === '/private' || row.host === awin.hosts[0]));
    await worker('writeDynamicRules({removeRuleIds:[6000002],addRules:[{id:6000002,priority:3000,action:{type:"block"},condition:{requestDomains:[' + JSON.stringify(threat) + '],resourceTypes:["main_frame"]}}]}).then(()=>true)');
    before = receipts.length; await navigate(wrapped(awin, origin(threat) + '/malware'));
    await until(async () => (await pageURL()).includes('/malware') || (await pageURL()).startsWith('chrome-error:'), 'threat destination blocked');
    await sleep(300);
    assert(!receipts.slice(before).some(row => row.host === threat || row.host === awin.hosts[0]));
    report.checks.push('private destinations are refused and final-destination threat blocking remains enforced');
    report.complete = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (cdp && browserTab) report.failurePage = await evaluate(cdp, browserTab, '({url:location.href,text:document.body?.innerText})').catch(() => null);
    throw error;
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); cleanupProfile(directory, 'wo-tracking-redirects-');
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('[ok] tracking redirects: ' + report.cases.length + ' providers; ' + report.checks.join('; '));
}
if (require.main === module) profile.mustFinish(run, 'tracking redirects').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

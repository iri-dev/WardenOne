/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), assert = require('assert/strict');
const profile = require('./perf-profile.js'), { tls } = require('./browser-media-security.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js'), { fingerprint, sha256 } = require('./lib/privacy-baseline.js');
const { validateEntries } = require('./check-package-archive.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression, options = {}) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...options }, session);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(check, label) {
  const end = Date.now() + 30000; while (Date.now() < end) { if (await check()) return; await sleep(100); }
  throw Error('Timed out: ' + label);
}
const variants = {
  onetrust: { container: 'onetrust-banner-sdk', reject: 'onetrust-reject-all-handler', cookie: 'OptanonConsent', value: 'groups=C0001:1,C0002:0,C0003:0,C0004:0' },
  cookiebot: { container: 'CybotCookiebotDialog', reject: 'CybotCookiebotDialogBodyButtonDecline', cookie: 'CookieConsent',
    value: "{stamp:'fixture',necessary:true,preferences:false,statistics:false,marketing:false,method:'explicit',ver:1,utc:123}" },
  trustarc: { container: 'truste-consent-content', reject: 'truste-consent-required', cookie: 'notice_gdpr_prefs', value: '0::expressed,eu' },
};
function fixture(url) {
  const [kind, option] = url.pathname.split('/').filter(Boolean), v = variants[kind];
  const head = '<!doctype html><meta charset="utf-8"><script>window.earlyGpc=navigator.globalPrivacyControl===true;window.earlyDnt=navigator.doNotTrack;if(window!==window.top)parent.postMessage({fixtureEarlyGpc:window.earlyGpc},"*");</script><title>Consent fixture</title>';
  if (!v) return head + '<input id="editor" value="works"><main>' + 'Readable article text. '.repeat(180) + '</main>';
  const label = option === 'protected' ? 'Confirm payment and reject all cookies' : 'Cookie consent choices. Reject optional tracking or accept all cookies.';
  if (option === 'settings') {
    const pane = '<section id="onetrust-pc-sdk" role="dialog" style="position:fixed;top:30px;left:30px;width:600px;height:260px;background:white;color:black;z-index:999999"><p>Cookie consent preferences</p><label>Strictly necessary cookies<input type="checkbox" checked disabled></label><label>Analytics<input id="analytics" type="checkbox" checked></label><label>Marketing<input id="marketing" type="checkbox" checked></label><button class="save-preference-btn-handler">Save preferences</button></section>';
    return head + '<main>' + 'Readable article. '.repeat(200) + '</main><section id="onetrust-banner-sdk" role="dialog" style="position:fixed;top:30px;left:30px;width:600px;height:220px;background:white;color:black;z-index:999999"><p>Cookie consent options</p><button id="onetrust-pc-btn-handler">Manage cookie preferences</button></section><script>window.fixtureClicks=0;document.getElementById("onetrust-pc-btn-handler").onclick=()=>{window.fixtureClicks++;document.getElementById("onetrust-banner-sdk").outerHTML='
      + JSON.stringify(pane) + ';document.querySelector(".save-preference-btn-handler").onclick=()=>{window.fixtureClicks++;window.optionalOff=!document.getElementById("analytics").checked&&!document.getElementById("marketing").checked;document.cookie="OptanonConsent="+encodeURIComponent("groups=C0001:1,C0002:"+(document.getElementById("analytics").checked?1:0)+",C0004:"+(document.getElementById("marketing").checked?1:0))+"; path=/; Secure; SameSite=Lax";};};</script>';
  }
  const banner = '<section id="' + v.container + '" role="dialog" style="position:fixed;top:30px;left:30px;width:600px;height:220px;background:white;color:black;z-index:999999"><p>'
    + label + '</p><button id="' + v.reject + '">Reject all</button><button>Accept all</button>'
    + (option === 'protected' ? '<input type="password" aria-label="Account password">' : '') + '</section>';
  return head + '<input id="editor" value="works"><main>' + 'Readable article text. '.repeat(180) + '</main><script>'
    + 'window.fixtureClicks=0;setTimeout(()=>{const holder=document.createElement("div");holder.id="fixture-shadow-root";'
    + (option === 'shadow' ? 'const root=holder.attachShadow({mode:"open"});' : 'const root=holder;')
    + 'root.innerHTML=' + JSON.stringify(banner) + ';document.body.append(holder);const button=root.querySelector(' + JSON.stringify('#' + v.reject) + ');'
    + 'button.addEventListener("click",()=>{window.fixtureClicks++;'
    + (option === 'unverified' ? 'root.querySelector("section").remove();' : 'document.cookie=' + JSON.stringify(v.cookie + '=' + encodeURIComponent(v.value) + '; path=/; SameSite=Lax; Secure') + ';')
    + '});},' + (option === 'late' ? 4200 : 200) + ');</script>';
}
async function run() {
  const [extensionArg, browserArg, out] = process.argv.slice(2);
  if (!out || !out.endsWith('.json')) throw Error('Usage: browser-consent-gpc.js frozen-runtime browser.exe new-report.json');
  if (fs.existsSync(out)) throw Error('Preserve prior native evidence');
  const source = path.resolve(extensionArg);
  if (fs.existsSync(path.join(source, '.git')) || fs.existsSync(path.join(source, 'tools'))) throw Error('Use a frozen runtime');
  const identity = fingerprint(source), errors = validateEntries(identity.files.map(f => f.path)); if (errors.length) throw Error(errors.join('\n'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-consent-runtime-')), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-consent-profile-'));
  fs.cpSync(source, runtime, { recursive: true });
  const report = { date: new Date().toISOString(), runtimeFingerprint: identity.sha256, harnessSha256: sha256(fs.readFileSync(__filename)), checks: [], cases: [], complete: false };
  const hits = [], server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    hits.push({ host: url.hostname, path: url.pathname, gpc: req.headers['sec-gpc'] || '', dnt: req.headers.dnt || '' });
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/media-ok.mp4') { res.setHeader('Content-Type', 'video/mp4'); res.end(fs.readFileSync(path.join(source, 'spotify-silent-1s.mp4'))); return; }
    res.end(fixture(url));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = await profile.freePort(), origin = host => 'https://' + host + ':' + server.address().port;
  let cdp, serial = 0;
  try {
    const native = await profile.launch(path.resolve(browserArg), 'on', runtime, port, dir, ['--ignore-certificate-errors',
      '--host-resolver-rules=MAP *.test 127.0.0.1, MAP *.example.org 127.0.0.1, MAP *.example.net 127.0.0.1, MAP fixture.googlevideo.com 127.0.0.1, MAP accounts.google.com 127.0.0.1, MAP www.youtube.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    report.browser = native.Browser; cdp = new profile.Cdp(native.webSocketDebuggerUrl); await cdp.connect();
    const ext = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version, undefined, 100);
    const worker = expression => evaluate(cdp, ext.attachedSession, expression);
    const settled = async () => {
      await until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'), 'policy settle');
      await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    };
    await settled(); await profile.closeExtensionTabs(cdp, port, ext.id);
    const configBefore = await worker("chrome.storage.local.get('wardenone_config')"), permissions = await worker('chrome.permissions.getAll()');
    const configure = async changes => {
      await worker('updateStoredConfig(cfg=>Object.assign(cfg,' + JSON.stringify(changes) + ')).then(()=>true)');
      await worker('refreshExtensionState();true'); await settled();
    };
    const attach = async (host, route = '/') => {
      const url = origin(host) + route, { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.enable', {}, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.href===' + JSON.stringify(url) + '&&document.readyState==="complete"'), 'page ready');
      return { targetId, sessionId, host, route };
    };
    const outcomes = async () => worker('flushHistory();WO_HISTORY.drain().then(()=>chrome.storage.local.get("wardenone_history")).then(s=>(s.wardenone_history||[]).filter(e=>e.type==="consent_outcome"))');
    for (const [kind, option] of [['onetrust', 'normal'], ['cookiebot', 'late'], ['trustarc', 'shadow'], ['onetrust', 'settings']]) {
      await worker('clearProtectionHistory().then(()=>true)');
      const host = kind + '-' + option + '-consent.test', page = await attach(host, '/' + kind + '/' + option);
      let events;
      try { await until(async () => { events = await outcomes(); return events.some(e => e.detail.status === 'rejected'); }, kind + ' saved opt-out'); }
      catch (error) {
        report.consentDiagnostics = { kind, option, events, page: await evaluate(cdp, page.sessionId,
          '({clicks:window.fixtureClicks,hasCookie:document.cookie.includes(' + JSON.stringify(variants[kind].cookie + '=') + '),shadow:document.getElementById("fixture-shadow-root")?.shadowRoot?.innerHTML,containers:[...document.querySelectorAll("section")].map(x=>x.id)})') };
        throw error;
      }
      const clicks = await evaluate(cdp, page.sessionId, 'window.fixtureClicks'); assert.equal(clicks, option === 'settings' ? 2 : 1);
      if (option === 'settings') assert.equal(await evaluate(cdp, page.sessionId, 'window.optionalOff'), true);
      const saved = await evaluate(cdp, page.sessionId, 'document.cookie'); assert(saved.includes(variants[kind].cookie + '='));
      assert(!JSON.stringify(events).includes(variants[kind].value));
      const visible = await evaluate(cdp, page.sessionId, option === 'shadow'
        ? '!!document.getElementById("fixture-shadow-root")?.shadowRoot.querySelector("section")' : '!!document.querySelector("section")');
      assert(visible, 'saved state, rather than disappearance, establishes the result');
      report.cases.push({ cmp: kind, variant: option, clicks, status: 'rejected', savedStateReadInBrowser: true, bannerStillPresent: true });
      await cdp.send('Target.closeTarget', { targetId: page.targetId });
    }
    report.checks.push('OneTrust direct/settings, late Cookiebot and open-shadow TrustArc fixtures save required-only browser cookies; verification succeeds while banners remain present');
    await worker('clearProtectionHistory().then(()=>true)');
    const noState = await attach('unverified-consent.test', '/onetrust/unverified');
    let unverified;
    await until(async () => { unverified = await outcomes(); return unverified.some(e => e.detail.status === 'unverified'); }, 'unverified disappearance');
    assert(!unverified.some(e => e.detail.status === 'rejected'));
    report.checks.push('A dispatched click that removes a banner without saving state remains unverified');
    const erased = await attach('erased-consent.test', '/onetrust/unverified');
    await until(() => evaluate(cdp, erased.sessionId, 'window.fixtureClicks===1'), 'pending consent action');
    await worker('clearProtectionHistory().then(()=>true)'); await sleep(2800);
    assert.equal((await outcomes()).length, 0);
    report.checks.push('Clearing history revokes pending page verification and prevents an erased action from reappearing');
    const protectedPage = await attach('protected-consent.test', '/onetrust/protected'); await sleep(3000);
    assert.equal(await evaluate(cdp, protectedPage.sessionId, 'window.fixtureClicks'), 0);
    assert(await evaluate(cdp, protectedPage.sessionId, '!!document.querySelector("input[type=password]")'));
    report.checks.push('A payment/account/password consent lookalike receives no automatic click');
    const signalCase = async (label, changes, host, expected) => {
      await configure(changes);
      const route = '/signal-' + (++serial), page = await attach(host, route);
      const early = await evaluate(cdp, page.sessionId, '({gpc:window.earlyGpc,dnt:window.earlyDnt||"",current:navigator.globalPrivacyControl===true})');
      const receipt = hits.find(h => h.host === host && h.path === route); assert(receipt);
      if (receipt.gpc !== (expected ? '1' : '')) report.signalDiagnostics = { label, early, receipt,
        rules: await worker('chrome.declarativeNetRequest.getSessionRules().then(r=>r.filter(x=>x.id>=900000&&x.id<=900010))'),
        degraded: await worker('chrome.storage.session.get("wardenone_reconcile_degraded")') };
      assert.equal(early.gpc, expected, label + ' early JavaScript'); assert.equal(early.current, expected, label + ' settled JavaScript');
      assert.equal(receipt.gpc, expected ? '1' : '', label + ' navigation header');
      report.cases.push({ label, early, receiver: receipt }); return page;
    };
    const active = await signalCase('enabled', { enabled: true, sendPrivacySignals: true, allowlist: [], siteOverrides: {} }, 'active-signals.example.org', true);
    await configure({ sendPrivacySignals: false });
    assert.equal(await evaluate(cdp, active.sessionId, 'navigator.globalPrivacyControl===true'), false, 'toggle restores an existing page');
    await signalCase('disabled', { sendPrivacySignals: false }, 'active-signals.example.org', false);
    await signalCase('paused', { enabled: false, sendPrivacySignals: true }, 'active-signals.example.org', false);
    await signalCase('allowlisted', { enabled: true, allowlist: ['except-signals.example.net'] }, 'except-signals.example.net', false);
    await signalCase('site override', { allowlist: [], siteOverrides: { 'except-signals.example.net': { sendPrivacySignals: false } } }, 'except-signals.example.net', false);
    const resumed = await signalCase('resumed', { siteOverrides: {} }, 'active-signals.example.org', true);
    await signalCase('login compatibility', {}, 'accounts.google.com', true);
    await signalCase('media compatibility', {}, 'www.youtube.com', true);
    const allowId = await worker('Promise.resolve(ALLOWLIST_RULE_BASE+999)');
    await worker('chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:' + allowId + ',priority:100000,action:{type:"allowAllRequests"},condition:{requestDomains:["request-allowed.example.org"],resourceTypes:["main_frame","sub_frame"]}}]}).then(()=>true)');
    await signalCase('explicit request allowance', {}, 'request-allowed.example.org', true);
    await worker('chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[' + allowId + ']}).then(()=>true)');
    await configure({ siteOverrides: { 'except-signals.example.net': { sendPrivacySignals: false } } });
    const probe = '/probe-' + (++serial);
    await until(() => worker('chrome.declarativeNetRequest.getSessionRules().then(r=>(r.find(x=>x.id===INTRANET_NET_RULE_BASE)?.condition.excludedTabIds?.length||0)>0)'), 'loopback tab scope');
    assert(await evaluate(cdp, resumed.sessionId, 'fetch(' + JSON.stringify(origin('except-signals.example.net') + probe) + ').then(r=>r.ok)'));
    assert.equal(hits.find(h => h.path === probe)?.gpc, '1', 'subrequests follow their active initiating document rather than destination exemptions');
    await evaluate(cdp, resumed.sessionId, 'window.frameSignals=[];window.addEventListener("message",e=>{if(e.data&&typeof e.data.fixtureEarlyGpc==="boolean")window.frameSignals.push(e.data.fixtureEarlyGpc)});const frame=document.createElement("iframe");frame.src=' + JSON.stringify(origin('except-signals.example.net') + '/frame-exempt') + ';document.body.append(frame);true');
    await until(() => evaluate(cdp, resumed.sessionId, 'window.frameSignals.length===1'), 'cross-origin GPC frame');
    assert.equal(await evaluate(cdp, resumed.sessionId, 'window.frameSignals[0]'), false);
    assert.equal(hits.find(h => h.path === '/frame-exempt')?.gpc, '');
    await cdp.send('Page.bringToFront', {}, resumed.sessionId);
    await evaluate(cdp, resumed.sessionId, 'const player=document.createElement("video");player.id="player";player.style.cssText="position:fixed;top:10px;left:10px;width:320px;height:180px;z-index:999999";player.muted=true;player.controls=true;player.loop=true;player.src=' + JSON.stringify(origin('fixture.googlevideo.com') + '/media-ok.mp4') + ';document.body.append(player);player.play().then(()=>true)', { userGesture: true });
    const playStart = await evaluate(cdp, resumed.sessionId, 'document.getElementById("player").currentTime');
    await until(() => evaluate(cdp, resumed.sessionId, 'document.getElementById("player").readyState>=2&&!document.getElementById("player").paused&&document.getElementById("player").currentTime!==' + playStart), 'real video playback');
    assert.equal(hits.find(h => h.path === '/media-ok.mp4')?.gpc, '1');
    report.checks.push('GPC agrees at the first inline script and navigation receiver for enabled, disabled, paused, allowlisted, site-exempt and resumed documents; live toggle restoration and cross-host subrequests agree');
    report.checks.push('A cross-origin exempt iframe has no early GPC or navigation signal; a real HTML5 video loads and plays with GPC on its media request');
    await worker('updateStoredConfig(()=>(' + JSON.stringify(configBefore.wardenone_config || {}) + ')).then(()=>true)');
    await worker('refreshExtensionState();true'); await settled();
    assert.deepEqual(await worker("chrome.storage.local.get('wardenone_config')"), configBefore);
    assert.deepEqual(await worker('chrome.permissions.getAll()'), permissions);
    report.checks.push('Original user configuration is restored and granted permissions are unchanged');
    const activity = await attach('active-signals.example.org', '/');
    assert(await evaluate(cdp, activity.sessionId, 'document.getElementById("editor").value==="works"'));
    report.complete = true;
  } catch (error) { report.error = error.stack || String(error); throw error; }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); await sleep(1000);
    cleanupProfile(dir, 'wo-consent-profile-'); cleanupProfile(runtime, 'wo-consent-runtime-');
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('[ok] ' + report.browser + ': ' + report.checks.length + ' native consent and GPC checks');
}
profile.mustFinish(run, 'browser-consent-gpc').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https');
const profile = require('./perf-profile.js'), { tls } = require('./browser-media-security.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cases = [
  { name: 'plain-reject', label: 'Reject all', expected: ['reject'] },
  { name: 'late-reject', label: 'Reject all', delay: 4300, expected: ['reject'] },
  { name: 'nested-shadow', label: 'Reject all', shadow: 2, expected: ['reject'] },
  { name: 'italian-reject', label: 'Rifiuta tutti', expected: ['reject'] },
  { name: 'german-reject', label: 'Alle ablehnen', expected: ['reject'] },
  { name: 'french-reject', label: 'Tout refuser', expected: ['reject'] },
  { name: 'spanish-reject', label: 'Rechazar todo', expected: ['reject'] },
  { name: 'misleading-test-id', label: 'Accept all', attrs: 'data-testid="reject-all"', action: 'accept', expected: [] },
  { name: 'misleading-class', label: 'Accept all', attrs: 'class="reject-all"', action: 'accept', expected: [] },
  { name: 'disabled-reject', label: 'Reject all', attrs: 'disabled', expected: [] },
  { name: 'enabled-later', label: 'Reject all', attrs: 'disabled', enableLater: true, expected: ['reject'] },
  { name: 'aria-disabled-reject', label: 'Reject all', attrs: 'aria-disabled="true"', expected: [] },
  { name: 'payment-dialog', label: 'Reject all', sensitive: true, expected: [] },
  { name: 'accept-only', label: 'Accept all', action: 'accept', expected: [] },
  { name: 'external-link', label: 'Reject all', link: true, expected: [] },
  { name: 'preferences-already-off', settings: 'off', expected: ['settings', 'save'] },
  { name: 'preferences-required-mixed', settings: 'mixed', expected: ['settings'] },
  { name: 'preferences-hidden-marketing', settings: 'hidden', expected: ['settings'] },
  { name: 'preferences-normal', settings: 'on', expected: ['settings', 'save'] },
];
function fixture(test) {
  const bannerStyle = 'position:fixed;inset:40px auto auto 40px;width:650px;min-height:180px;background:white;color:black;z-index:99999;padding:20px';
  const control = test.link ? '<a href="https://unrelated.invalid/" target="_blank" id="choice">Reject all</a>'
    : '<button id="choice" ' + (test.attrs || '') + '>' + test.label + '</button>';
  const banner = '<section id="onetrust-banner-sdk" role="dialog" style="' + bannerStyle + '"><p>We use cookies for analytics and advertising. Choose your cookie preferences.</p>'
    + (test.sensitive ? '<input type="password" aria-label="Account password"><p>Confirm payment</p>' : '')
    + (test.settings ? '<button id="onetrust-pc-btn-handler">Manage cookie preferences</button>' : control) + '</section>';
  const toggles = test.settings === 'hidden' ? '<label>Necessary<input type="checkbox" checked disabled></label><label hidden>Marketing<input type="checkbox" checked></label>' : test.settings === 'mixed'
    ? '<label>Necessary marketing<input type="checkbox" checked disabled></label>'
    : '<label>Necessary<input type="checkbox" checked disabled></label><label>Analytics<input type="checkbox" ' + (test.settings === 'on' ? 'checked' : '') + '></label><label>Marketing<input type="checkbox" ' + (test.settings === 'on' ? 'checked' : '') + '></label>';
  const pane = '<section id="onetrust-pc-sdk" role="dialog" style="' + bannerStyle + '"><p>Cookie preferences</p>' + toggles + '<button class="save-preference-btn-handler">Save preferences</button></section>';
  return '<!doctype html><meta charset="utf-8"><title>Consent stress: ' + test.name + '</title><input id="editor" value="works"><main>' + 'A readable article. '.repeat(120)
    + '</main><script>window.fixtureActions=[];window.fixtureReady=false;setTimeout(()=>{let root=document.body;'
    + 'for(let i=0;i<' + (test.shadow || 0) + ';i++){const host=document.createElement("div");root.append(host);root=host.attachShadow({mode:"open"});}'
    + 'const holder=document.createElement("div");holder.innerHTML=' + JSON.stringify(banner) + ';root.append(holder);'
    + (test.settings
      ? 'holder.querySelector("button").onclick=()=>{fixtureActions.push("settings");holder.innerHTML=' + JSON.stringify(pane) + ';holder.querySelector(".save-preference-btn-handler").onclick=()=>{fixtureActions.push("save");window.fixtureOptionalOn=[...holder.querySelectorAll("input")].some(x=>x.checked&&/analytics|marketing/i.test(x.parentElement.textContent));document.cookie="OptanonConsent="+encodeURIComponent("groups=C0001:1,C0002:"+(fixtureOptionalOn?1:0))+"; Secure; path=/; SameSite=Lax";holder.remove();};};'
      : 'holder.querySelector("#choice").onclick=e=>{e.preventDefault();fixtureActions.push(' + JSON.stringify(test.action || 'reject') + ');document.cookie="OptanonConsent="+encodeURIComponent(' + JSON.stringify('groups=C0001:1,C0002:' + (test.action === 'accept' ? '1' : '0')) + ')+"; Secure; path=/; SameSite=Lax";holder.remove();};')
    + (test.enableLater ? 'setTimeout(()=>{holder.querySelector("#choice").disabled=false;},900);' : '')
    + 'window.fixtureReady=true;},' + (test.delay || 200) + ');</script>';
}
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
  const [runtimeArg, browserArg, output] = process.argv.slice(2);
  if (!output || fs.existsSync(output)) throw Error('Usage: browser-consent-stress.js frozen-runtime browser.exe new-report.json');
  const runtime = path.resolve(runtimeArg), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-consent-stress-'));
  const report = { date: new Date().toISOString(), cases: [], complete: false };
  const server = https.createServer(tls, (req, res) => {
    const test = cases.find(c => '/' + c.name === req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    res.end(test ? fixture(test) : '<!doctype html><title>Not a fixture</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = await profile.freePort(); let cdp;
  try {
    const browser = await profile.launch(path.resolve(browserArg), 'on', runtime, port, dir,
      ['--ignore-certificate-errors', '--host-resolver-rules=MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    report.browser = browser.Browser; cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const ext = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version);
    const worker = expression => evaluate(cdp, ext.attachedSession, expression);
    await until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'policy settle');
    await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    await profile.closeExtensionTabs(cdp, port, ext.id);
    report.config = await worker('chrome.storage.local.get("wardenone_config").then(s=>({enabled:s.wardenone_config.enabled,autoRejectConsent:s.wardenone_config.autoRejectConsent}))');
    for (const test of cases) {
      const url = 'https://' + test.name + '.test:' + server.address().port + '/' + test.name;
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
      await until(() => evaluate(cdp, sessionId, 'window.fixtureReady===true'), 'fixture ' + test.name);
      await sleep(test.settings ? 4000 : 2000);
      const state = await evaluate(cdp, sessionId, '({actions:window.fixtureActions,cookie:document.cookie,optionalOn:window.fixtureOptionalOn,editor:document.getElementById("editor").value})');
      const passed = JSON.stringify(state.actions) === JSON.stringify(test.expected) && state.editor === 'works' && !(state.actions.includes('save') && state.optionalOn);
      report.cases.push({ name: test.name, expected: test.expected, ...state, passed });
      console.log((passed ? '[ok] ' : '[FAIL] ') + test.name + ': ' + JSON.stringify(state.actions));
      await cdp.send('Target.closeTarget', { targetId });
    }
    report.complete = true;
  } catch (error) { report.error = String(error.stack || error); throw error; }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); await sleep(600); cleanupProfile(dir, 'wo-consent-stress-');
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  if (report.cases.some(test => !test.passed)) process.exitCode = 1;
}
if (require.main === module) profile.mustFinish(run, 'browser-consent-stress').catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { cases, fixture };

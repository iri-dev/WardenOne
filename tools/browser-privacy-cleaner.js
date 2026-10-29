/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>Cleaner fixture</title><h1>Cleaner fixture</h1><video muted autoplay></video><canvas width="32" height="32"></canvas>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixturePort = server.address().port;
  const keep = 'http://keep.test:' + fixturePort, wipe = 'http://wipe.test:' + fixturePort;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-cleaner-'));
  let cdp, port = await profile.freePort();
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, directory,
      ['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server', '--unsafely-treat-insecure-origin-as-secure=' + keep + ',' + wipe]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'))).version;
    const extension = await profile.extensionReady(cdp, port, version);
    async function page(url) {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId); await sleep(600);
      return sessionId;
    }
    async function evaluate(sessionId, expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text);
      return result.result && result.result.value;
    }
    const a = await page(keep), b = await page(wipe), popup = await page('chrome-extension://' + extension.id + '/popup.html');
    const send = request => evaluate(popup, 'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')');
    async function until(expression, label) {
      for (let i = 0; i < 100; i++) { if (await evaluate(popup, expression)) return; await sleep(100); }
      throw Error('Timed out: ' + label);
    }
    await until('!!document.getElementById("cl-run")&&!document.getElementById("cl-run").disabled', 'cleaner ready');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 348, height: 800, deviceScaleFactor: 1, mobile: false }, popup);
    await evaluate(popup, `(()=>{const root=document.getElementById('privacy-cleaner');for(let p=root.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;root.scrollIntoView({block:'start'})})()`);
    const layout = await evaluate(popup, `(()=>{const root=document.getElementById('privacy-cleaner');return {
      tabs:root.querySelectorAll('[role=tab]').length, expanded:root.querySelectorAll(':scope > details[open]').length,
      common:[...document.querySelectorAll('.cleaner-choices input')].filter(p=>p.getBoundingClientRect().height>0).length,
      advanced:document.getElementById('cl-advanced').open, defaultHeight:root.getBoundingClientRect().height,
      preset:document.getElementById('cl-mode').value, overflow:root.scrollWidth>root.clientWidth,
      appearance:getComputedStyle(document.getElementById('cl-mode')).appearance}})()`);
    assert.equal(layout.tabs, 0); assert.equal(layout.expanded, 1); assert.equal(layout.common, 4);
    assert.equal(layout.advanced, false); assert.equal(layout.preset, 'quick'); assert.equal(layout.overflow, false);
    assert(layout.defaultHeight < 560, 'default cleaner must fit a compact panel: ' + JSON.stringify(layout));
    assert.equal(layout.appearance, 'none', 'dropdowns use WardenOne styling');
    await cdp.send('Page.bringToFront', {}, popup);
    const scrollChecks = [];
    async function toggleWithoutJump(selector) {
      await evaluate(popup, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await sleep(150);
      const before = await evaluate(popup, `(()=>{const s=document.querySelector(${JSON.stringify(selector)}),r=s.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scrollY,top:r.top,open:s.parentElement.open}})()`);
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:before.x,y:before.y,button:'left',clickCount:1},popup);
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:before.x,y:before.y,button:'left',clickCount:1},popup);
      await until(`document.querySelector(${JSON.stringify(selector)}).parentElement.open===${!before.open}`, 'dropdown toggle');
      await sleep(150);
      const after = await evaluate(popup, `({scrollY,top:document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top})`);
      scrollChecks.push({selector,opening:!before.open,scrollDelta:after.scrollY-before.scrollY,headingDelta:after.top-before.top});
      assert(Math.abs(after.scrollY-before.scrollY)<=2 && Math.abs(after.top-before.top)<=2,
        'dropdown must keep the page and clicked heading still: ' + JSON.stringify(scrollChecks.at(-1)));
    }
    for (const section of ['auto', 'protected', 'history']) {
      await toggleWithoutJump('#cl-section-' + section + ' > summary');
      assert.equal(await evaluate(popup, 'document.getElementById("cl-section-now").open'), true, 'other dropdowns must not close the main cleaner');
      await toggleWithoutJump('#cl-section-' + section + ' > summary');
    }
    for (const selector of ['#cl-advanced > summary', '#cl-preset-tools > summary', '#cl-record-tools > summary']) {
      await toggleWithoutJump(selector);
    }
    for (const selector of ['#cl-record-tools > summary', '#cl-preset-tools > summary', '#cl-advanced > summary']) {
      await toggleWithoutJump(selector);
    }
    await toggleWithoutJump('#cl-section-now > summary');
    assert.equal(await evaluate(popup, 'document.getElementById("cl-section-now").open'), false, 'the default-open cleaner is user-collapsible');
    await toggleWithoutJump('#cl-section-auto > summary');
    assert.equal(await evaluate(popup, 'document.getElementById("cl-section-now").open'), false, 'opening another dropdown must respect a manually closed cleaner');
    await toggleWithoutJump('#cl-section-auto > summary'); await toggleWithoutJump('#cl-section-now > summary');
    await evaluate(popup, `document.querySelector('#cl-section-auto > summary').focus()`);
    await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13},popup);
    await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},popup);
    await until(`document.getElementById('cl-section-auto').open&&document.getElementById('cl-section-now').open`, 'independent keyboard expansion');
    await evaluate(popup, `document.querySelector('#cl-section-auto > summary').click()`);
    await until(`document.getElementById('cl-section-now').open&&!document.getElementById('cl-section-auto').open`, 'cleaning section');
    await evaluate(popup, `document.querySelector('[aria-controls="cl-help-cookies"]').click()`);
    assert.equal(await evaluate(popup, 'document.getElementById("cl-help-cookies").hidden'), false);
    assert.equal(await evaluate(popup, 'document.getElementById("cl-cookies").checked'), false, 'asking for help must not select deletion');
    await evaluate(popup, `document.querySelector('[aria-controls="cl-help-cookies"]').click()`);
    async function screenshot(theme, suffix = theme) {
      if (!process.env.WARDENONE_CLEANER_SCREENSHOT) return;
      await evaluate(popup, 'chrome.storage.local.set({wardenone_theme:' + JSON.stringify(theme) + '})');
      await until('document.documentElement.dataset.wardenoneThemeResolved===' + JSON.stringify(theme), 'theme');
      await evaluate(popup, 'document.activeElement.blur()');
      await evaluate(popup, 'document.getElementById("privacy-cleaner").scrollIntoView({block:"center"})');
      await sleep(250);
      const shot = await cdp.send('Page.captureScreenshot', { format:'png',captureBeyondViewport:false },popup);
      fs.writeFileSync(process.env.WARDENONE_CLEANER_SCREENSHOT.replace(/\.png$/, '-' + suffix + '.png'),Buffer.from(shot.data,'base64'));
    }
    await screenshot('light'); await screenshot('dark');
    for (const session of [a, b]) await evaluate(session, `(async () => {
      localStorage.setItem('cleaner-sentinel', 'retained'); document.cookie='cleaner_cookie=retained; path=/';
      document.cookie='_ga=disposable; path=/'; document.cookie='sessionid=auth; path=/';
      const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('cleaner-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('items');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      db.close(); await (await caches.open('cleaner-fixture')).put('/resource',new Response('offline'));
      const video=document.querySelector('video'), canvas=document.querySelector('canvas');
      video.srcObject=canvas.captureStream(10); setInterval(()=>{const ctx=canvas.getContext('2d');ctx.fillStyle='hsl('+Date.now()%360+' 100% 50%)';ctx.fillRect(0,0,32,32)},100); await video.play(); return true;
    })()`);
    await sleep(1500);
    let info = await send({ kind: 'privacy-cleaner-get' }); assert(info.ok);
    assert.deepEqual(Object.keys(info.config.manualTypes).filter(key => info.config.manualTypes[key]), ['cache']);
    info.config.protectedOrigins = [keep];
    info = await send({ kind: 'privacy-cleaner-save', settings: info.config }); assert(info.ok);
    const consentPreview = await send({ kind: 'clean-browser-preview', request: { scope: 'all', sinceMs: 0, types: { consentCookies: true } } });
    const consentResult = await send({ kind: 'clean-browser', previewId: consentPreview.previewId });
    assert.equal(consentResult.ok, true, JSON.stringify(consentResult)); assert.equal(consentResult.consent.removed, 1);
    assert((await evaluate(a, 'document.cookie')).includes('_ga=disposable'));
    const remainingCookies = await evaluate(b, 'document.cookie');
    assert(!remainingCookies.includes('_ga=disposable')); assert(remainingCookies.includes('sessionid=auth'));
    await evaluate(popup, `chrome.storage.local.set({wardenone_script_drift_baselines:{sentinel:{hash:'keep'}},wardenone_tracker_learner:{sentinel:'keep'}})`);
    const preview = await send({ kind: 'clean-browser-preview', request: { scope: 'all', sinceMs: 0,
      types: { cookies: true, storage: true, cacheStorage: true, history: true } } });
    assert(preview.ok); assert(preview.warnings.some(warning => warning.includes('Browsing history')));
    const result = await send({ kind: 'clean-browser', previewId: preview.previewId }); assert.equal(result.ok, true, JSON.stringify(result));
    const storage = session => evaluate(session, `(async()=>({local:localStorage.getItem('cleaner-sentinel'),cookies:document.cookie,
      databases:(await indexedDB.databases()).map(item=>item.name),caches:await caches.keys(),playing:document.querySelector('video').currentTime>0&&!document.querySelector('video').paused}))()`);
    const retained = await storage(a), deleted = await storage(b);
    assert.equal(retained.local, 'retained'); assert(retained.cookies.includes('cleaner_cookie=retained'));
    assert(retained.databases.includes('cleaner-fixture')); assert(retained.caches.includes('cleaner-fixture'));
    assert.equal(deleted.local, null); assert(!deleted.cookies.includes('cleaner_cookie'));
    assert(!deleted.databases.includes('cleaner-fixture')); assert(!deleted.caches.includes('cleaner-fixture'));
    assert(retained.playing && deleted.playing, 'media fixture keeps playing after cleanup: ' + JSON.stringify({retained, deleted}));
    const own = await evaluate(popup, 'chrome.storage.local.get(["wardenone_script_drift_baselines","wardenone_tracker_learner"])');
    assert(own.wardenone_script_drift_baselines.sentinel); assert(own.wardenone_tracker_learner.sentinel);
    assert.equal((await send({ kind: 'clean-browser', previewId: preview.previewId })).ok, false);
    await evaluate(popup, `(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===${JSON.stringify(wipe + '/')});await chrome.tabs.update(tab.id,{active:true})})()`);
    const scoped = await send({ kind: 'clean-browser-preview', request: { scope: 'site', origin: wipe, sinceMs: 0, types: { storage: true } } });
    assert.equal(scoped.ok, true, JSON.stringify(scoped));
    const blocked = await send({ kind: 'clean-browser-preview', request: { scope: 'site', origin: keep, sinceMs: 0, types: { storage: true } } });
    assert.equal(blocked.ok, false);
    info = await send({ kind: 'privacy-cleaner-get' });
    info.config.automatic.enabled = true;
    info = await send({ kind: 'privacy-cleaner-save', settings: info.config }); assert(info.ok);
    await evaluate(popup, `(async()=>{const key='wardenone_cleaner_state';const s=(await chrome.storage.local.get(key))[key];s.nextRun=Date.now()-1000;await chrome.storage.local.set({[key]:s});await chrome.alarms.create('wardenone-privacy-cleaning',{when:Date.now()+1000})})()`);
    let scheduled;
    for (let i = 0; i < 80; i++) {
      await sleep(500); scheduled = await send({ kind: 'privacy-cleaner-get' });
      if (scheduled.history.some(item => item.source === 'scheduled')) break;
    }
    assert(scheduled.history.some(item => item.source === 'scheduled' && item.ok), 'native alarm completes a scheduled cleanup');
    await sleep(1200);
    assert.equal((await send({ kind: 'privacy-cleaner-get' })).history.filter(item => item.source === 'scheduled').length, 1);
    await evaluate(popup, 'location.reload()');
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      if (await evaluate(popup, 'document.readyState==="complete"&&!!document.getElementById("cl-run")&&!document.getElementById("cl-run").disabled')) break;
    }
    await evaluate(popup, `(()=>{document.getElementById('cl-advanced').open=true;document.getElementById('cl-preset-tools').open=true;document.getElementById('cl-preset-name').value='Cache routine';document.getElementById('cl-save-preset').click()})()`);
    let presetSaved = false;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      if ((await send({ kind: 'privacy-cleaner-get' })).config.presets.some(item => item.name === 'Cache routine')) { presetSaved = true; break; }
    }
    assert(presetSaved, 'Popup preset save: ' + await evaluate(popup, 'document.getElementById("cl-result").textContent'));
    const manualBefore = (await send({ kind: 'privacy-cleaner-get' })).history.filter(item => item.source === 'manual').length;
    await evaluate(popup, `(()=>{globalThis.confirm=()=>true;document.getElementById('cl-mode').value='quick';document.getElementById('cl-mode').dispatchEvent(new Event('change'));document.getElementById('cl-run').click()})()`);
    await until('!!document.getElementById("cl-confirm-clean")&&!document.getElementById("cl-preview").hidden', 'inline cleanup preview');
    assert.equal((await send({ kind: 'privacy-cleaner-get' })).history.filter(item => item.source === 'manual').length, manualBefore, 'preview does not delete data');
    await evaluate(popup, 'document.getElementById("cl-cancel-preview").click()');
    assert.equal(await evaluate(popup, 'document.getElementById("cl-choices").hidden'), false);
    await evaluate(popup, 'document.getElementById("cl-cookies").checked=true;document.getElementById("cl-run").click()');
    await until('!!document.getElementById("cl-confirm-clean")&&!document.getElementById("cl-preview").hidden', 'cookie warning preview');
    assert(await evaluate(popup, '[...document.querySelectorAll("#cl-preview .cleaner-warning")].some(p=>p.textContent.includes("sign you out")&&p.getBoundingClientRect().height>0)'));
    await screenshot('dark', 'review');
    await evaluate(popup, 'document.getElementById("cl-confirm-clean").click()');
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      if ((await send({ kind: 'privacy-cleaner-get' })).history.filter(item => item.source === 'manual').length > manualBefore) break;
    }
    assert.equal((await send({ kind: 'privacy-cleaner-get' })).history.filter(item => item.source === 'manual').length, manualBefore + 1);
    assert((await evaluate(popup, 'document.getElementById("cl-preview").textContent')).includes(keep));
    await evaluate(popup, `(()=>{document.getElementById('cl-advanced').open=false;document.querySelector('#cl-section-auto > summary').click();document.getElementById('cl-auto-options').open=true;document.querySelector('#cl-auto-options-list [data-category="storage"]').click()})()`);
    assert.equal(await evaluate(popup, 'document.getElementById("cl-auto-warning").hidden'), false, 'automatic destructive choices are explained');
    await evaluate(popup, 'document.getElementById("cl-auto-use-selection").click();document.getElementById("cl-section-auto").open=false');
    const errors = await evaluate(popup, `({ready:!document.getElementById('cl-run').disabled,
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
    assert(errors.ready); assert.equal(errors.overflow, false);
    info = await send({ kind: 'privacy-cleaner-get' }); info.config.automatic.onStartup = true;
    assert((await send({ kind: 'privacy-cleaner-save', settings: info.config })).ok);
    const automaticBefore = info.history.filter(item => item.source !== 'manual').length;
    await evaluate(popup, `(async()=>{const key='wardenone_cleaner_state';const state=(await chrome.storage.local.get(key))[key];state.nextRun=Date.now()-1000;await chrome.storage.local.set({[key]:state})})()`);
    await profile.killBrowser(cdp, port); cdp.close(); cdp = null;
    port = await profile.freePort();
    const restarted = await profile.launch(profile.edgePath(), 'on', ROOT, port, directory);
    cdp = new profile.Cdp(restarted.webSocketDebuggerUrl); await cdp.connect();
    const fresh = await profile.extensionReady(cdp, port, version);
    const reopened = await page('chrome-extension://' + fresh.id + '/popup.html');
    let startup;
    for (let i = 0; i < 120; i++) {
      await sleep(250); startup = await evaluate(reopened, 'chrome.runtime.sendMessage({kind:"privacy-cleaner-get"})');
      if (startup.history.filter(item => item.source !== 'manual').length > automaticBefore) break;
    }
    assert.equal(startup.history.filter(item => item.source !== 'manual' && item.ok).length, automaticBefore + 1, 'browser restart catches up one overdue cleanup');
    assert.equal(startup.config.automatic.onStartup, true, 'startup choice survives browser restart');
    await sleep(1200);
    startup = await evaluate(reopened, 'chrome.runtime.sendMessage({kind:"privacy-cleaner-get"})');
    assert.equal(startup.history.filter(item => item.source !== 'manual').length, automaticBefore + 1);
    const evidence = { protectedOriginRetained: retained, unprotectedOriginCleaned: deleted,
      browserHistoryPreservedWardenOneRecords: true, recognizedCookieExclusions: true, singleUsePreview: true, siteScopeVerified: true,
      nativeAlarm: true, browserRestartCatchup: true, startupCallbackCoverage: 'worker harness; startup-only native event unverified',
      duplicateScheduledRuns: false, popupPresetAndCleanup: true, popup: errors,
      layout, scrollChecks, keyboardSections: true, inlinePreviewDoesNotDelete: true, visibleDestructiveWarnings: true };
    fs.writeFileSync(path.join(ROOT, 'docs/privacy-cleaner-browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('[ok] disposable Edge: protected cookies/storage/IndexedDB/caches, scoped preview, independent observations, playing media, real alarm, restart catch-up and popup controls/layout');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve)); cleanupProfile(directory, 'wo-cleaner-');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

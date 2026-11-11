/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const root = path.resolve(__dirname, '..');
  const evidence = path.join(root, '.private-review', 'context-menu');
  fs.mkdirSync(evidence, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-context-menu-'));
  const port = await profile.freePort();
  let cdp;
  const host = 'menu.wardenone-audit.net';
  const server = http.createServer((request, response) => {
    if (request.url === '/pixel.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'");
    response.end('<!doctype html><title>WardenOne context controls</title><style>body{font:18px system-ui;padding:30px}p{margin:24px 0}#picture{width:150px;height:100px;background:#daf url(/pixel.png)}textarea{display:block;width:550px;height:70px}iframe{width:300px;height:80px}</style><h1>Right-click controls</h1><p id="selection">example.com</p><p id="prose">Ordinary words are not a reputation indicator.</p><p><a id="link" href="https://nfsu2.xyz/?utm_source=fixture&amp;keep=yes">Copy this clean link</a></p><div id="picture">Background image</div><p id="empty">No image here</p><textarea id="paste" aria-label="Copied address"></textarea><iframe srcdoc="<p id=inner>Embedded frame</p>"></iframe>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://' + host + ':' + server.address().port + '/';
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP ' + host + ' 127.0.0.1', '--unsafely-treat-insecure-origin-as-secure=' + url,
        ...(process.argv.includes('--interactive') ? ['--window-position=80,80'] : [])]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, require('../manifest.json').version);
    const worker = extension.attachedSession;
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (work, label, timeout = 15000) => {
      for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(75)) if (await work()) return;
      throw Error('Timed out: ' + label);
    };
    await profile.closeExtensionTabs(cdp, port, extension.id);
    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,elementZapper:true,showToasts:false,silentMode:true,memoryNeverForms:true})).then(()=>true)');
    const open = async address => {
      const { targetId } = await cdp.send('Target.createTarget', { url: address });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.enable', {}, sessionId);
      await until(() => evaluate(sessionId, 'document.readyState==="complete"&&!!document.getElementById("empty")').catch(() => false), address);
      const tab = await evaluate(worker, `chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(address)}))`);
      return { targetId, sessionId, tab };
    };
    const source = await open(url);
    const action = (id, info = {}, tab = source.tab) => evaluate(worker,
      `runWardenMenuAction(${JSON.stringify({ menuItemId: 'wardenone-' + id, pageUrl: url, ...info })},${JSON.stringify(tab)}).then(()=>true)`);
    const result = () => evaluate(worker, `chrome.scripting.executeScript({target:{tabId:${source.tab.id},frameIds:[0]},func:()=>({title:window.__wardenOneManualResult?.title.textContent,body:window.__wardenOneManualResult?.body.textContent})}).then(rows=>rows[0].result)`);
    await action('check-selection');
    assert.match((await result()).title, /No text selected/);
    await action('check-selection', { selectionText: 'ordinary words' });
    assert.match((await result()).body, /No common scam instructions/);
    assert.match((await result()).body, /not sent to an external service/);
    await action('check-selection', { selectionText: 'Verify you are human. Press Win+R and paste this command into PowerShell.' });
    assert.match((await result()).body, /Possible ClickFix/);
    await evaluate(worker, `var contextLookups={urlReputationConfig,urlReputationLookupUrl,lookupDomainAge};
      urlReputationConfig=async()=>({enabled:true});
      urlReputationLookupUrl=async()=>new Promise(resolve=>{globalThis.contextSlowLookup=resolve});
      lookupDomainAge=async()=>({ok:true,ageDays:4});
      void runWardenMenuAction({menuItemId:'wardenone-check-selection',selectionText:'example.com'},${JSON.stringify(source.tab)});true`);
    await until(async () => /only 4 days/.test((await result()).body || ''), 'partial result before slow provider', 5000);
    assert.match((await result()).body, /URL reputation: checking/);
    await evaluate(worker, 'contextSlowLookup({ok:true,hit:false});true');
    await until(async () => /Not on any reputation list/.test((await result()).body || ''), 'completed provider result');
    await evaluate(worker, 'urlReputationConfig=contextLookups.urlReputationConfig;urlReputationLookupUrl=contextLookups.urlReputationLookupUrl;lookupDomainAge=contextLookups.lookupDomainAge;true');
    await action('check-selection', { selectionText: '192.168.1.1' });
    assert.match((await result()).body, /private or reserved/);
    await action('check-media');
    assert.match((await result()).body, /no image, video or audio/);
    await action('frame', { frameId: 0 });
    assert.match((await result()).title, /Main page/);
    await action('frame', { frameId: 1, frameUrl: 'about:srcdoc' });
    assert.match((await result()).body, /supplied by the containing page/);
    assert(await evaluate(source.sessionId, '(()=>{const host=document.querySelector("[data-wardenone-manual-result]");return !!host&&host.shadowRoot===null&&getComputedStyle(host).display!=="none"&&window.__wardenOneManualResult===undefined})()'));
    console.log('[ok] prose and scam-text results, independent lookup progress, strict CSP, muted notifications and missing targets');

    await evaluate(source.sessionId, 'document.addEventListener("copy",e=>{document.body.dataset.copyHijack="yes";e.clipboardData.setData("text/plain","about:blank");e.preventDefault()},true)');
    await action('copy-clean-link', { linkUrl: 'https://nfsu2.xyz/?utm_source=fixture&keep=yes' });
    assert.match((await result()).body, /https:\/\/nfsu2.xyz\/\?keep=yes/);
    await cdp.send('Browser.grantPermissions', { origin: url, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await cdp.send('Page.bringToFront', {}, source.sessionId);
    assert.equal(await evaluate(source.sessionId, 'navigator.clipboard.readText()'), 'https://nfsu2.xyz/?keep=yes');
    assert.equal(await evaluate(source.sessionId, 'document.body.dataset.copyHijack'), undefined);
    await action('copy-clean-link', { linkUrl: 'about:blank', frameUrl: 'about:blank' });
    assert((await result()).body.includes(url), 'blank embedded targets fall back to the real page');
    console.log('[ok] actual clipboard contains the cleaned nfsu2.xyz address; page copy hijacker never runs; blank targets fall back');

    await evaluate(worker, `chrome.scripting.executeScript({target:{tabId:${source.tab.id},frameIds:[0]},func:()=>{window.__wardenOneLocalNotice=undefined}}).then(()=>true)`);
    await action('check-selection', { selectionText: '10.0.0.1' });
    assert.match((await result()).body, /private or reserved/);
    const rightClick = async id => {
      await cdp.send('Page.bringToFront', {}, source.sessionId);
      await evaluate(source.sessionId, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
      const point = await evaluate(source.sessionId, `(()=>{const box=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:box.x+20,y:box.y+20}})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'right', clickCount: 1 }, source.sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 }, source.sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 }, source.sessionId);
    };
    await rightClick('picture');
    await action('check-media');
    assert((await result()).body.includes('Served by the site you are on.'), JSON.stringify(await result()));
    await rightClick('empty');
    await action('check-media');
    assert.match((await result()).body, /no image, video or audio/, 'a later empty click does not reuse an old image');
    console.log('[ok] trusted right-click captures CSS image sources and clears stale targets; replies survive a missing page bridge');

    const sleeper = await open(url + '?sleep');
    await action('sleep-tab', {}, sleeper.tab);
    assert(await evaluate(worker, `chrome.tabs.query({}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(url + '?sleep')}&&tab.discarded))`));
    const closer = await open(url + '?close');
    await action('close-tab', {}, closer.tab);
    assert(await evaluate(worker, `chrome.tabs.query({}).then(tabs=>!tabs.some(tab=>tab.id===${closer.tab.id}))`));
    console.log('[ok] active-tab Sleep really discards and Close really removes its target');

    const block = await open(url + '?block');
    const blockHost = await evaluate(worker, `wardenSiteHostFromTab(${JSON.stringify(block.tab)})`);
    const started = Date.now();
    await action('block-site', {}, block.tab);
    await until(() => evaluate(block.sessionId, 'document.documentURI.startsWith("chrome-error:")').catch(() => false), 'blocked page');
    assert(await evaluate(worker, `wardenBlockRuleLive(${JSON.stringify(blockHost)})`));
    console.log('[ok] site block reaches the browser blocked page in ' + (Date.now() - started) + ' ms after rule verification');
    await evaluate(worker, `delete LEARNED[${JSON.stringify(blockHost)}];localSet({wardenone_learned:LEARNED}).then(()=>applyLearnedRules()).then(()=>true)`);
    await cdp.send('Page.navigate', { url }, source.sessionId);
    await until(() => evaluate(source.sessionId, '!!document.getElementById("selection")').catch(() => false), 'restored fixture');
    if (process.argv.includes('--interactive')) {
      await cdp.send('Page.bringToFront', {}, source.sessionId);
      fs.writeFileSync(path.join(evidence, 'interactive.json'), JSON.stringify({ port, browser, extension, source }, null, 2));
      console.log('[interactive] Native menu fixture ready. Send a newline to finish.');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 120000);
        const done = () => { clearTimeout(timer); resolve(); };
        process.stdin.once('data', done);
        process.stdin.once('end', done);
        process.stdin.resume();
      });
    }
    await action('frame', { frameId: 0 });
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, source.sessionId);
    fs.writeFileSync(path.join(evidence, 'context-controls.png'), Buffer.from(screenshot.data, 'base64'));
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve));
    await sleep(2000);
    cleanupProfile(dir, 'wo-context-menu-');
  }
}
if (require.main === module) profile.mustFinish(run, 'browser-context-menu').catch(error => { console.error(error); process.exitCode = 1; });

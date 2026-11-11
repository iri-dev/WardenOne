/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const { loadThemeCSS } = require('./test-eyeshield-spotify.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
function fixture() {
  const icon = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 3L21 12L6 21Z"/></svg>';
  return '<!doctype html><html class="spotify__container--is-web"><title>Spotify control contrast</title><style>'
    + ':root{--background-base:#121212;--background-highlight:#282828;--background-press:#000;--text-base:#fff;--essential-base:#fff}'
    + '.encore-inverted-light-set{--background-base:#fff;--background-highlight:#f0f0f0;--background-press:#c7c7c7;--text-base:#000;--essential-base:#000}'
    + '.encore-inverted-dark-set{--background-base:#000;--background-highlight:#1f1f1f;--background-press:#303030;--text-base:#fff;--essential-base:#fff}'
    + '.encore-bright-accent-set{--background-base:#1ed760;--background-highlight:#3be477;--background-press:#1abc54;--text-base:#000;--essential-base:#000}'
    + 'body{margin:24px;font:16px system-ui;background:#121212;color:#fff}button{font:700 14px system-ui;cursor:pointer;border:0;padding:0;background:transparent;color:var(--text-base)}'
    + '.primary>span,.direct{display:inline-flex;gap:8px;align-items:center;padding:12px 20px;border-radius:28px;background:var(--background-base);color:var(--text-base)}'
    + '.primary:hover>span,.direct:hover{background:var(--background-highlight)}.primary:active>span,.direct:active{background:var(--background-press)}'
    + '.normal{padding:12px;background:var(--background-highlight);color:var(--text-base);border-radius:24px}button:disabled{opacity:.35;cursor:not-allowed}.row{display:flex;align-items:center;gap:14px;margin:24px 0}svg{fill:currentColor}'
    + '</style><div id="main"><nav data-testid="global-nav-bar" class="row">'
    + '<button id="premium" class="primary" data-encore-id="buttonPrimary"><span class="encore-inverted-light-set"><span data-encore-id="text">Explore Premium</span></span></button>'
    + '<button id="normal" class="normal">Install app</button></nav><main class="main-view-container"><div class="row">'
    + '<button id="filter" aria-pressed="true" class="direct encore-inverted-light-set"><span data-encore-id="text">All</span></button>'
    + '<button id="filter-inner" class="primary" aria-pressed="true"><span class="encore-inverted-light-set"><span data-encore-id="text">Music</span></span></button>'
    + '<button id="dark" class="primary"><span class="encore-inverted-dark-set"><span data-encore-id="text">Dark pill</span></span></button>'
    + '<button id="disabled" class="primary" disabled><span class="encore-inverted-light-set"><span data-encore-id="text">Disabled</span></span></button></div>'
    + '<button id="green" class="primary"><span class="encore-bright-accent-set"><span>' + icon + '</span><span data-encore-id="text">Play preview</span></span></button>'
    + '</main><footer data-testid="now-playing-bar" class="row"><button id="play" class="primary"><span class="encore-inverted-light-set"><span>' + icon + '</span><span data-encore-id="text">Play</span></span></button></footer></div>'
    + '<audio id="preview" src="/tone.wav" muted preload="auto"></audio><script>window.clicks={};document.querySelectorAll("button").forEach(button=>button.addEventListener("click",event=>{if(!event.isTrusted)return;clicks[button.id]=(clicks[button.id]||0)+1;if(button.id==="play"||button.id==="green"){const audio=document.getElementById("preview");if(audio.paused)audio.play();else audio.pause()}}));</script>';
}
function audioFixture() {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  return bytes;
}
async function run() {
  const evidence = path.join(root, '.private-review', 'spotify-controls'); fs.mkdirSync(evidence, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-spotify-controls-'));
  const port = await profile.freePort(); let cdp;
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/tone.wav' ? 'audio/wav' : 'text/html');
    response.end(request.url === '/tone.wav' ? audioFixture() : fixture());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir, []);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, require('../manifest.json').version); const worker = extension.attachedSession;
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (work, label, timeout = 15000) => {
      for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(75)) if (await work().catch(() => false)) return;
      throw Error('Timed out: ' + label);
    };
    await profile.closeExtensionTabs(cdp, port, extension.id);
    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:false,eyeShield:false,eyeShieldMode:"off"})).then(()=>true)');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page); await cdp.send('Page.enable', {}, page); await cdp.send('DOM.enable', {}, page); await cdp.send('CSS.enable', {}, page);
    await until(() => evaluate(page, '!!document.getElementById("premium")&&document.readyState==="complete"'), 'control fixture');
    const metrics = `(()=>{
      const rgb=value=>(value.match(/[\\d.]+/g)||[]).map(Number);
      const luminance=color=>{const c=rgb(color).slice(0,3).map(value=>{const x=value/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
      const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const bg=node=>{for(let el=node;el;el=el.parentElement){const s=getComputedStyle(el),c=rgb(s.backgroundColor);if(c.length===3||c[3]>.99)return s.backgroundColor}return 'rgb(255,255,255)'};
      return Array.from(document.querySelectorAll('button')).map(button=>{const label=button.querySelector('[data-encore-id="text"]')||button.querySelector('span')||button;const cs=getComputedStyle(label),icon=button.querySelector('svg');return{id:button.id,color:cs.color,paint:cs.webkitTextFillColor,bg:bg(label),contrast:ratio(cs.webkitTextFillColor||cs.color,bg(label)),iconContrast:icon?ratio(getComputedStyle(icon).fill,bg(icon)):null,disabled:button.disabled,opacity:getComputedStyle(button).opacity,pointer:getComputedStyle(button).pointerEvents}})
    })()`;
    const { root: documentNode } = await cdp.send('DOM.getDocument', {}, page);
    const nodes = {};
    for (const id of ['premium', 'filter', 'filter-inner', 'green', 'dark', 'play']) nodes[id] = (await cdp.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#' + id }, page)).nodeId;
    const click = async id => {
      await cdp.send('Page.bringToFront', {}, page);
      const point = await evaluate(page, `(()=>{const box=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2}})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, page);
    };
    const results = [];
    const theme = loadThemeCSS();
    for (const mode of ['light', 'dark', 'ultra']) {
      await evaluate(page, `(()=>{let style=document.getElementById('eye-test');if(!style){style=document.createElement('style');style.id='eye-test';document.head.append(style)}style.textContent=${JSON.stringify(theme(mode))}})()`);
      for (const state of ['normal', 'hover', 'active', 'focus-visible']) {
        for (const nodeId of Object.values(nodes)) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state === 'normal' ? [] : state === 'active' ? ['hover', 'active'] : [state] }, page);
        const rows = await evaluate(page, metrics);
        for (const row of rows.filter(row => !row.disabled)) {
          assert(row.contrast >= 4.5, mode + '/' + state + ': ' + JSON.stringify(row));
          if (row.iconContrast !== null) assert(row.iconContrast >= 3, mode + '/' + state + ': icon ' + JSON.stringify(row));
        }
        assert.equal(rows.find(row => row.id === 'disabled').opacity, '0.35');
        results.push({ mode, state, rows });
      }
      for (const nodeId of Object.values(nodes)) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, page);
      await click('premium'); await click('filter');
      await evaluate(page, 'document.getElementById("preview").currentTime=0');
      await click('play');
      await until(() => evaluate(page, '!document.getElementById("preview").paused&&document.getElementById("preview").currentTime>.05'), mode + ' preview playback');
      await click('play');
      await click('disabled');
      assert.equal(await evaluate(page, 'clicks.disabled||0'), 0);
    }
    await evaluate(page, 'document.getElementById("eye-test").remove()');
    const restored = await evaluate(page, metrics);
    assert(restored.filter(row => !row.disabled).every(row => row.contrast >= 4.5));
    console.log('[ok] real CSS: Premium, selected filters, white/black pills and green play controls have readable text and icons in every mode/state; clicks, disabled controls, audio playback and Off restoration work');
    fs.writeFileSync(path.join(evidence, 'fixture-results.json'), JSON.stringify(results, null, 2));

    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,eyeShield:true,eyeShieldMode:"dark"})).then(()=>localGet("wardenone_config")).then(x=>reconcileEyeShieldInjection(x.wardenone_config)).then(()=>true)');
    const liveTarget = await cdp.send('Target.createTarget', { url: 'https://open.spotify.com/' });
    const { sessionId: live } = await cdp.send('Target.attachToTarget', { targetId: liveTarget.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, live); await cdp.send('Page.enable', {}, live);
    await until(() => evaluate(live, 'document.querySelectorAll(".encore-inverted-light-set,.encore-bright-accent-set").length>2&&!!document.getElementById("wardenone-eyeshield-theme")'), 'live Spotify controls', 35000);
    const liveResults = [];
    const liveTab = await evaluate(worker, 'chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url==="https://open.spotify.com/"))');
    for (const mode of ['dark', 'light', 'ultra']) {
      await evaluate(worker, `chrome.scripting.executeScript({target:{tabId:${liveTab.id}},func:mode=>window.__wardenOneEyeShieldApplyConfig({enabled:true,eyeShield:true,eyeShieldMode:mode}),args:[${JSON.stringify(mode)}]}).then(()=>true)`);
      await until(() => evaluate(live, `document.getElementById("wardenone-eyeshield-theme")?.getAttribute("data-wo-eyeshield-mode")===${JSON.stringify(mode)}`), mode + ' on Spotify');
      const rows = await evaluate(live, `Array.from(document.querySelectorAll('button .encore-inverted-light-set,button .encore-bright-accent-set')).slice(0,12).map(el=>{const s=getComputedStyle(el),label=el.querySelector('svg')||el;return{text:(el.innerText||el.closest('button').getAttribute('aria-label')||'').slice(0,80),color:getComputedStyle(label).color,paint:getComputedStyle(label).webkitTextFillColor,bg:s.backgroundColor,textBase:s.getPropertyValue('--text-base')}})`);
      assert(rows.length > 1);
      for (const row of rows) assert.equal(row.color, 'rgb(0, 0, 0)', mode + ': ' + JSON.stringify(row));
      liveResults.push({ mode, rows });
      await cdp.send('Page.bringToFront', {}, live);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, live);
      fs.writeFileSync(path.join(evidence, 'live-' + mode + '.png'), Buffer.from(screenshot.data, 'base64'));
    }
    fs.writeFileSync(path.join(evidence, 'live-results.json'), JSON.stringify(liveResults, null, 2));
    console.log('[ok] actual signed-out Spotify: white primary-button text and green play icons retain their native black foreground in Dark, Light and Ultra');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await sleep(2000); cleanupProfile(dir, 'wo-spotify-controls-');
  }
}
if (require.main === module) profile.mustFinish(run, 'browser-eyeshield-spotify').catch(error => { console.error(error); process.exitCode = 1; });

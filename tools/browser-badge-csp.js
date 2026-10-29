/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const { tls } = require('./browser-media-security.js');
const root = path.resolve(process.env.WARDENONE_EXTENSION_DIR || path.join(__dirname, '..'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const policies = {
    nonce: "default-src 'self'; style-src 'self' 'nonce-wardenonefixture'; style-src-attr 'unsafe-inline'",
    none: "default-src 'self'; style-src 'none'",
    elements: "default-src 'self'; style-src 'self'; style-src-elem 'none'; style-src-attr 'none'",
    ordinary: '',
  };
  const html = '<!doctype html><title>Badge policy fixture</title><link rel="stylesheet" href="/fixture.css">'
    + '<main><h1>Page content</h1><p class="panel">Site panel</p>'
    + '<button id="play">Play fixture</button><video id="player" muted controls loop src="/media.mp4"></video></main>'
    + '<script src="/fixture.js"></script>';
  const server = https.createServer(tls, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/media.mp4') {
      response.setHeader('Content-Type', 'video/mp4');
      response.end(fs.readFileSync(path.join(root, 'spotify-silent-1s.mp4')));
    } else if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('window.fixtureViolations=[];document.addEventListener("securitypolicyviolation",e=>'
        + 'fixtureViolations.push(e.effectiveDirective));document.getElementById("play").onclick=()=>'
        + 'document.getElementById("player").play();window.fixtureReady=true;');
    } else if (request.url === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end('body{margin:24px;min-height:1800px}.panel{color:rgb(10,20,30)}'
        + 'video{display:block;width:160px;height:90px}'
        + '#rg-badge-host{transform:translate(100px,100px)!important;contain:paint!important}');
    } else {
      const name = request.url.slice(1);
      if (policies[name]) response.setHeader('Content-Security-Policy', policies[name]);
      response.setHeader('Content-Type', 'text/html');
      response.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-badge-csp-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--ignore-certificate-errors', '--host-resolver-rules=MAP badge.wardenone-compat.example.net 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, require('../manifest.json').version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (session, expression) => {
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await sleep(100)) {
        if (await evaluate(session, expression).catch(() => false)) return;
      }
      throw Error('Timed out: ' + expression);
    };
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page);
    await cdp.send('Page.enable', {}, page);
    const state = `(() => {
      const host=document.getElementById('rg-badge-host'),root=host?.shadowRoot;
      const badge=root?.getElementById('rg-b'),panel=root?.getElementById('rg-p');
      return {count:document.querySelectorAll('#rg-badge-host').length,
        sheets:root?.adoptedStyleSheets.length,inline:root?.querySelectorAll('style').length,
        host:host&&{position:getComputedStyle(host).position,width:getComputedStyle(host).width,
          height:getComputedStyle(host).height,pointer:getComputedStyle(host).pointerEvents,
          transform:getComputedStyle(host).transform,contain:getComputedStyle(host).contain},
        badge:badge&&getComputedStyle(badge).position,panel:panel&&getComputedStyle(panel).display,
        bodyWidth:document.body.getBoundingClientRect().width,scrollWidth:document.documentElement.scrollWidth,
        pagePanel:getComputedStyle(document.querySelector('main .panel')).display};
    })()`;
    const click = async (selector) => {
      const point = await evaluate(page, `(() => {const e=${selector};const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, page);
      }
    };
    for (const name of Object.keys(policies)) {
      const url = 'https://badge.wardenone-compat.example.net:' + server.address().port + '/' + name;
      await cdp.send('Page.navigate', { url }, page);
      await until(page, 'window.fixtureReady&&document.getElementById("rg-badge-host")?.shadowRoot?.getElementById("rg-b")');
      const before = await evaluate(page, state);
      assert.equal(before.badge, 'fixed', name);
      assert.equal(before.panel, 'none', name);
      assert.equal(before.sheets, 1, name);
      assert.equal(before.inline, 0, name);
      assert.equal(before.count, 1, name);
      assert.deepEqual(before.host, { position: 'fixed', width: '0px', height: '0px',
        pointer: 'none', transform: 'none', contain: 'none' }, name + ' host isolation');
      assert.equal(before.pagePanel, 'block', 'badge styles must not hide the page panel');
      assert.equal(await evaluate(page, 'document.adoptedStyleSheets.length'), 0);
      await click('document.getElementById("rg-badge-host").shadowRoot.getElementById("rg-b")');
      assert.equal((await evaluate(page, state)).panel, 'block', name + ' opens');
      await click('document.getElementById("rg-badge-host").shadowRoot.getElementById("rg-b")');
      assert.equal((await evaluate(page, state)).panel, 'none', name + ' closes');
      const dimensions = await evaluate(page, state);
      assert.equal(dimensions.bodyWidth, before.bodyWidth);
      assert.equal(dimensions.scrollWidth, before.scrollWidth);
      await click('document.getElementById("play")');
      await until(page, 'document.getElementById("player").currentTime>0.05&&!document.getElementById("player").paused');
      assert(!(await evaluate(page, 'fixtureViolations')).includes('style-src-attr'), name + ' adds no inline attribute violations');
      if (name === 'nonce') {
        const violationsBeforeLegacy = await evaluate(page, 'fixtureViolations.length');
        await evaluate(page, `(() => {
          const h=document.createElement('div'),r=h.attachShadow({mode:'open'}),s=document.createElement('style');
          s.textContent='.legacy{position:fixed}.legacy-panel{display:none}';
          const b=document.createElement('div');b.className='legacy';
          const p=document.createElement('div');p.className='legacy-panel';
          r.append(s,b,p);document.body.append(h);
          window.legacyProbe={badge:getComputedStyle(b).position,panel:getComputedStyle(p).display};h.remove();
        })()`);
        assert.deepEqual(await evaluate(page, 'legacyProbe'), { badge: 'static', panel: 'block' });
        await until(page, 'fixtureViolations.length>' + violationsBeforeLegacy + '&&fixtureViolations.includes("style-src-elem")');
      }
      assert.equal(await evaluate(page, 'document.querySelector("main h1").textContent'), 'Page content');
      console.log('[ok] ' + name + ': badge toggle, layout isolation, playback and policy enforcement');
    }
    if (process.env.WARDENONE_BADGE_REAL_SITE === '1') {
      await cdp.send('Page.navigate', { url: 'https://nightmareproject.com/' }, page);
      await until(page, 'document.getElementById("rg-badge-host")?.shadowRoot?.getElementById("rg-b")');
      const real = await evaluate(page, `(() => {
        const r=document.getElementById('rg-badge-host').shadowRoot;
        return {badge:getComputedStyle(r.getElementById('rg-b')).position,
          panel:getComputedStyle(r.getElementById('rg-p')).display,
          heading:document.querySelector('h1')?.textContent};
      })()`);
      assert.equal(real.badge, 'fixed');
      assert.equal(real.panel, 'none');
      assert.match(real.heading, /Stay a little/);
      const out = process.env.WARDENONE_BADGE_SCREENSHOT;
      if (out) {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, page);
        fs.writeFileSync(out, Buffer.from(data, 'base64'));
      }
      console.log('[ok] Nightmare Project: live page loads with a styled badge and hidden panel');
    }
    console.log('[ok] badge CSP compatibility in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise((resolve) => server.close(resolve));
    cleanupProfile(dir, 'wo-badge-csp-');
  }
}

if (require.main === module) profile.mustFinish(run, 'browser-badge-csp')
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

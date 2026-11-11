/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */

/* Drives the Anti-Adblock Shield in a real browser: it has to lift a wall that is in the way,
   leave an access gate of the same shape alone, and put a wall back when the page turns out
   to be empty behind it.
   Run: node tools/browser-anti-adblock.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const host = 'adwall.wardenone-audit.net';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SHEET = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;background:#111;color:#fff';
const ARTICLE = '<h1>A long read</h1>' + '<p>'.concat('Body copy that gives the page something to be. '.repeat(60), '</p>').repeat(4);

const PAGES = {
  /* A wall in the way, with a real article behind it and the page held still. */
  '/wall': '<style>body{overflow:hidden;margin:0}</style><div id="wall" style="' + SHEET + '">'
    + '<p>Please disable your ad blocker to continue reading.</p></div><main>' + ARTICLE + '</main>',
  /* Same geometry and the same words, but it is a bot check: nobody removes this. */
  '/gate': '<style>body{overflow:hidden;margin:0}</style><div id="wall" style="' + SHEET + '">'
    + '<p>Ad blockers are not allowed here. Sign in to confirm you are not a bot.</p></div><main>' + ARTICLE + '</main>',
  /* A wall with nothing behind it. Lifting this one leaves a blank page, so it goes back. */
  '/empty': '<style>body{overflow:hidden;margin:0}</style><div id="wall" style="' + SHEET + '">'
    + '<p>Please disable your ad blocker to continue reading.</p></div>',
};

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-adwall-'));
  const port = await profile.freePort();
  let cdp, server, browser;
  try {
    server = http.createServer((request, response) => {
      const body = PAGES[new URL(request.url, 'http://x').pathname];
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Anti-adblock fixture</title>' + (body || 'no fixture'));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP ' + host + ' 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const extension = await profile.extensionReady(cdp, port, manifest.version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = extension.attachedSession;

    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };

    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,antiAdblockShield:true})).then(()=>true)');
    await evaluate(worker, 'reconcileAntiAdblockShieldInjection({enabled:true,antiAdblockShield:true}).then(()=>true)');
    const registered = await evaluate(worker,
      "chrome.scripting.getRegisteredContentScripts({ids:['wo-anti-adblock-shield']}).then(r=>r.length===1&&r[0].matches.join())");
    assert.equal(registered, '<all_urls>', 'the shield is registered for every site');

    const base = 'http://' + host + ':' + server.address().port;
    const visit = async (route) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: base + route });
      const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, page);
      /* The shield asks the worker for its switches, then measures the page a beat after it
         hides anything, so settle for longer than that before reading the result. */
      for (const deadline = Date.now() + 10000; Date.now() < deadline; await sleep(100)) {
        if (await evaluate(page, "document.readyState==='complete'")) break;
      }
      const timeline = [];
      for (let i = 0; i < 16; i++) { await sleep(500); timeline.push(await evaluate(page, "(()=>{const w=document.getElementById('wall');return w?getComputedStyle(w).display:'gone'})()")); }
      if (process.env.WO_DEBUG) console.log(route, timeline.join(' '));
      const state = await evaluate(page, `(() => {
        const wall = document.getElementById('wall');
        return {
          hidden: !wall || getComputedStyle(wall).display === 'none',
          scrolls: getComputedStyle(document.body).overflow !== 'hidden',
        };
      })()`);
      await cdp.send('Target.closeTarget', { targetId });
      return state;
    };

    const wall = await visit('/wall');
    assert(wall.hidden, 'an ad-block wall in the way is lifted');
    assert(wall.scrolls, 'and the page it was holding still can scroll again');

    const gate = await visit('/gate');
    assert(!gate.hidden, 'a bot check wearing the same words is left exactly where it is');

    const empty = await visit('/empty');
    assert(!empty.hidden, 'a wall with nothing behind it is put back');

    console.log('[ok] anti-adblock shield: wall lifted, access gate untouched, empty page rolled back');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (server) await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-adwall-')) throw new Error('Unexpected temporary profile');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

profile.mustFinish(run, 'browser-anti-adblock').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

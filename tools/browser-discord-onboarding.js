/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Manual browser check: a disposable Edge profile loads a local fixture as the
   Discord app origin. No Discord account, server or live page is touched. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Discord onboarding fixture</title></head>
<body style="margin:0;background:#313338;color:#fff;font:16px system-ui"><main><h1>Server setup</h1></main>
<script>
function step(id, label, next) {
  const box = document.createElement('div');
  box.id = id;
  box.style.cssText = 'position:fixed;z-index:1000;top:35%;left:35%;width:320px;height:160px;background:#26282d;padding:20px';
  box.innerHTML = '<h2>' + label + '</h2><button>Continue</button>';
  box.querySelector('button').onclick = () => { box.remove(); if (next) next(); };
  document.body.appendChild(box);
}
setTimeout(() => step('roles', 'Choose your roles', () => step('pronouns', 'Pick your pronouns')), 400);
</script></body></html>`;

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-discord-onboarding-'));
  let cdp = null;
  let off = null;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    if (!extension.id) throw new Error('WardenOne did not load');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://discord.com/channels/*', requestStage: 'Request' }] }, sessionId);
    off = cdp.on((msg) => {
      if (msg.sessionId !== sessionId || msg.method !== 'Fetch.requestPaused') return;
      cdp.send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(fixture).toString('base64'),
      }, sessionId).catch(() => {});
    });
    await cdp.send('Page.navigate', { url: 'https://discord.com/channels/123456789/987654321' }, sessionId);
    let result = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const reply = await cdp.send('Runtime.evaluate', {
        expression: `({ ready: window.__wardenOneReadyVersion || '',
          host: location.hostname, role: !!document.getElementById('roles'),
          shown: !!document.getElementById('roles') && getComputedStyle(document.getElementById('roles')).display !== 'none' })`,
        returnByValue: true,
      }, sessionId);
      result = reply.result && reply.result.value;
      if (result && result.ready === version && result.role) break;
    }
    if (!result || result.ready !== version || result.host !== 'discord.com' || !result.shown) {
      throw new Error('Role picker was not visible with the extension loaded: ' + JSON.stringify(result));
    }
    await sleep(2200);
    const still = await cdp.send('Runtime.evaluate', {
      expression: `({ role: !!document.getElementById('roles'),
        shown: !!document.getElementById('roles') && getComputedStyle(document.getElementById('roles')).display !== 'none',
        undo: !!document.getElementById('rg-undo-chip') })`,
      returnByValue: true,
    }, sessionId);
    if (!still.result.value.role || !still.result.value.shown || still.result.value.undo) {
      throw new Error('The role picker was removed or hidden: ' + JSON.stringify(still.result.value));
    }
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#roles button').click()` }, sessionId);
    await sleep(1800);
    const next = await cdp.send('Runtime.evaluate', {
      expression: `({ pronouns: !!document.getElementById('pronouns'),
        shown: !!document.getElementById('pronouns') && getComputedStyle(document.getElementById('pronouns')).display !== 'none',
        undo: !!document.getElementById('rg-undo-chip') })`,
      returnByValue: true,
    }, sessionId);
    if (!next.result.value.pronouns || !next.result.value.shown || next.result.value.undo) {
      throw new Error('The pronoun picker was removed or hidden: ' + JSON.stringify(next.result.value));
    }
    console.log('[ok] Edge kept Discord role and pronoun pickers visible with WardenOne loaded');
  } finally {
    if (off) off();
    if (cdp) { try { await profile.killBrowser(cdp, port); } catch (_) {} cdp.close(); }
    const resolved = path.resolve(dir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
      && path.basename(resolved).startsWith('wo-discord-onboarding-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

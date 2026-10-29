/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Manual real-browser check for PRIV-11. Uses a disposable Edge profile only. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');

const ROOT = path.resolve(process.env.WARDENONE_EXTENSION_DIR || path.join(__dirname, '..'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  let port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-erase-'));
  let cdp = null;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const waitPopupReady = async (session) => {
      for (let i = 0; i < 80; i++) {
        const result = await cdp.send('Runtime.evaluate', { expression: 'document.readyState==="complete"&&!!(globalThis.chrome&&chrome.storage&&chrome.storage.local)', returnByValue: true }, session);
        if (result.result && result.result.value) return;
        await sleep(250);
      }
      throw new Error('Extension popup did not become ready');
    };
    const { targetId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await waitPopupReady(sessionId);
    const evaluate = async (expression, target = sessionId) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target);
      if (value.exceptionDetails) throw new Error((value.exceptionDetails.exception && value.exceptionDetails.exception.description) || value.exceptionDetails.text);
      return value.result && value.result.value;
    };
    await evaluate(`chrome.storage.local.set({wardenone_history:[{url:'https://erase-sentinel.example/',at:Date.now()}],
      wardenone_erase_sentinel_local:{site:'erase-sentinel.example'},
      wardenone_config:{enabled:true,downloadSafeBrowsingKey:'erase-test-secret',siteOverrides:{'erase-sentinel.example':{adShield:false}}}})`);
    await evaluate(`chrome.storage.session.set({wardenone_erase_sentinel_session:{site:'erase-sentinel.example'}})`);
    await evaluate(`localStorage.setItem('erase-sentinel-dom','erase-sentinel.example')`);
    await evaluate(`noteForgetTabHost(9999,'erase-sentinel.example');noteServiceWorkerRegistration('https://erase-sentinel.example/')`, extension.attachedSession);
    const before = await evaluate(`new Promise(r=>chrome.runtime.sendMessage({kind:'privacy-data-inspect'},r))`);
    if (!before || !before.ok || !before.records.some((x) => x.key === 'wardenone_history')) throw new Error('Seeded history was absent from preview');
    const erased = await evaluate(`new Promise(r=>chrome.runtime.sendMessage({kind:'privacy-data-erase',mode:'settings'},r))`);
    if (!erased || !erased.ok) throw new Error('Erasure failed: ' + JSON.stringify(erased));
    await sleep(1600);
    const reloaded = await profile.extensionReady(cdp, port, version);
    if (reloaded.id !== extension.id) throw new Error('Extension identity changed after erase');
    const next = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: next.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, attached.sessionId);
    await waitPopupReady(attached.sessionId);
    const after = await evaluate(`Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)]).then(([x,s])=>({
      sentinel:JSON.stringify(x).includes('erase-sentinel.example')||JSON.stringify(s).includes('erase-sentinel.example'),
      key:x.wardenone_config&&x.wardenone_config.downloadSafeBrowsingKey,
      enabled:x.wardenone_config&&x.wardenone_config.enabled,
      keys:Object.keys(x).length,dom:localStorage.getItem('erase-sentinel-dom')}))`, attached.sessionId);
    console.log(JSON.stringify({ beforeDatasets: before.records.length, after }));
    if (!after || after.sentinel || after.key || after.dom || after.enabled !== true) throw new Error('Erase left sentinel, key, UI cache, or lost global switch');
    console.log('[ok] real-browser erase removed browsing records, site exceptions, UI DOM cache and key while retaining global switch');
    await profile.killBrowser(cdp, port);
    cdp.close();
    cdp = null;
    port = await profile.freePort();
    const restarted = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(restarted.webSocketDebuggerUrl);
    await cdp.connect();
    const afterRestart = await profile.extensionReady(cdp, port, version);
    const reopened = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + afterRestart.id + '/popup.html' });
    const fresh = await cdp.send('Target.attachToTarget', { targetId: reopened.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, fresh.sessionId);
    await waitPopupReady(fresh.sessionId);
    const durable = await evaluate(`chrome.storage.local.get(null).then(x=>({
      sentinel:JSON.stringify(x).includes('erase-sentinel.example'),
      key:x.wardenone_config&&x.wardenone_config.downloadSafeBrowsingKey,
      enabled:x.wardenone_config&&x.wardenone_config.enabled}))`, fresh.sessionId);
    if (!durable || durable.sentinel || durable.key || durable.enabled !== true) {
      throw new Error('Erase did not survive a full browser restart: ' + JSON.stringify(durable));
    }
    console.log('[ok] erase remains effective after a full browser restart');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    cleanupProfile(dir, 'wo-erase-');
  }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

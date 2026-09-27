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

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  let port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-erase-'));
  let cdp = null;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await sleep(500);
    const evaluate = async (expression, target = sessionId) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target);
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
      return value.result && value.result.value;
    };
    await evaluate(`chrome.storage.local.set({wardenone_history:[{url:'https://erase-sentinel.example/',at:Date.now()}],
      wardenone_config:{enabled:true,downloadSafeBrowsingKey:'erase-test-secret',siteOverrides:{'erase-sentinel.example':{adShield:false}}}})`);
    const before = await evaluate(`new Promise(r=>chrome.runtime.sendMessage({kind:'privacy-data-inspect'},r))`);
    if (!before || !before.ok || !before.records.some((x) => x.key === 'wardenone_history')) throw new Error('Seeded history was absent from preview');
    const erased = await evaluate(`new Promise(r=>chrome.runtime.sendMessage({kind:'privacy-data-erase',mode:'settings'},r))`);
    if (!erased || !erased.ok) throw new Error('Erasure failed: ' + JSON.stringify(erased));
    await sleep(1600);
    const next = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: next.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, attached.sessionId);
    await sleep(500);
    const after = await evaluate(`chrome.storage.local.get(null).then(x=>({
      sentinel:JSON.stringify(x).includes('erase-sentinel.example'),
      key:x.wardenone_config&&x.wardenone_config.downloadSafeBrowsingKey,
      enabled:x.wardenone_config&&x.wardenone_config.enabled,
      keys:Object.keys(x).length}))`, attached.sessionId);
    console.log(JSON.stringify({ beforeDatasets: before.records.length, after }));
    if (!after || after.sentinel || after.key || after.enabled !== true) throw new Error('Erase left sentinel, key, or lost global switch');
    console.log('[ok] real-browser erase removed browsing records, site exceptions and key while retaining global switch');
    await profile.killBrowser(cdp, port);
    cdp.close();
    cdp = null;
    port = await profile.freePort();
    const restarted = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(restarted.webSocketDebuggerUrl);
    await cdp.connect();
    const afterRestart = await profile.extensionReady(cdp, port, version);
    const reopened = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + afterRestart.id + '/popup.html' });
    const fresh = await cdp.send('Target.attachToTarget', { targetId: reopened.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, fresh.sessionId);
    await sleep(500);
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
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot)) throw new Error('Refusing to remove a profile outside temp');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

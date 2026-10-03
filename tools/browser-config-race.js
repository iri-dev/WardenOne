/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Three writers of wardenone_config at the same moment, in Edge: Settings turns a switch, the
   popup turns another, and the worker mutes a notification type. Before the config lock
   (config-lock.js) the Settings change was lost in 20 of 40 tries, the popup's in 3 and the
   worker's in 34. Every change must now survive every try.
   Run: node tools/browser-config-race.js
   It drives the unpacked extension in Edge (tools/perf-profile.js), so it runs in CI's
   real-settings-regression job rather than the local gate; tools/test-config-write-lock.js,
   which checks every write holds the lock, is in the gate. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRIALS = Number(process.env.WARDENONE_RACE_TRIALS || 40);
/* Mute types are letters and underscores only. */
const muteType = (i) => 'race_' + i.toString(26).split('').map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('');

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-config-race-'));
  let cdp;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', root, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (sessionId, expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ' -> ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const open = async (file) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/${file}` });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    };
    const until = async (sessionId, expression, label) => {
      for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(100)) {
        try { if (await evaluate(sessionId, expression)) return; } catch (_) {}
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const settings = await open('settings.html');
    const popup = await open('popup.html');
    await until(settings, "typeof loaded !== 'undefined' && loaded === true", 'Settings to load');
    await until(popup, "typeof persistConfig === 'function' && typeof config === 'object'", 'the popup to load');
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workerTarget = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extension.id}/background.js`);
    assert(workerTarget, 'the WardenOne service worker');
    const { sessionId: worker } = await cdp.send('Target.attachToTarget', { targetId: workerTarget.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, worker);
    assert.equal(await evaluate(worker, 'typeof updateStoredConfig'), 'function', 'the worker has its config write path');

    const lost = { settings: [], popup: [], worker: [] };
    for (let i = 0; i < TRIALS; i++) {
      const want = i % 2 === 0;
      /* Sent back to back, so the three reads overlap the way a real clash would. */
      await Promise.all([
        evaluate(settings, `writeConfig({ deAmp: ${want} }).then(() => true)`),
        evaluate(popup, `new Promise((resolve) => { config.capReferrer = ${want}; persistConfig(() => resolve(true), () => resolve(false)); })`),
        evaluate(worker, `muteToastType('${muteType(i)}', 60).then(() => true)`),
      ]);
      const cfg = await evaluate(settings, "new Promise((r) => chrome.storage.local.get('wardenone_config', (d) => r(d.wardenone_config)))");
      if (cfg.deAmp !== want) lost.settings.push(i);
      if (cfg.capReferrer !== want) lost.popup.push(i);
      if (!(cfg.toastMutes && cfg.toastMutes[muteType(i)])) lost.worker.push(i);
    }
    assert.deepEqual(lost, { settings: [], popup: [], worker: [] }, 'a change made at the same moment as another was lost, by trial: ' + JSON.stringify(lost));
    console.log('[ok] config writes from Settings, the popup and the worker all survived ' + TRIALS + ' simultaneous tries in Edge');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-config-race-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

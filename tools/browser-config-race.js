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
   Then the same with a private window: split incognito mode gives it its own worker and pages, with
   their own Web Locks, over the same storage. There the save record and its check (config-lock.js)
   are what keep a change: without them a regular Settings change was lost in 19 of 40 tries.
   The final case pauses a private Settings save through Erase All and checks storage after reload.
   A deterministic same-key case also holds an older private write until a later regular edit has
   completed, then proves the later user edit is recovered after the stale write lands. Another
   lands a private write 2.1 s late, after the regular write's own checks are over, and requires
   the final stored config to keep both changes.
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
const PRIVATE_TRIALS = Number(process.env.WARDENONE_PRIVATE_RACE_TRIALS || 15);
/* Mute types are letters and underscores only. */
const muteType = (i) => 'race_' + i.toString(26).split('').map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('');

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-config-race-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    let extension = await profile.extensionReady(cdp, port, version);
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
    console.log('[ok] config writes from Settings, the popup and the worker all survived ' + TRIALS + ' simultaneous tries in ' + browser.Browser);

    /* ---- A private window ----
       A DevTools browser context is an off-the-record profile, as a private window's is, and
       WardenOne runs there once it is allowed in incognito: its own worker, its own pages, the same
       storage. Allowing it goes through the browser's own extensions page, and reloads WardenOne. */
    const attach = async (targetId) => {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    };
    const { targetId: extensionsPage } = await cdp.send('Target.createTarget', { url: 'chrome://extensions/' });
    const extensionsSession = await attach(extensionsPage);
    await until(extensionsSession, "!!(chrome.developerPrivate && chrome.developerPrivate.updateExtensionConfiguration)", 'the extensions page');
    assert.equal(await evaluate(extensionsSession, `new Promise((resolve) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(extension.id)}, incognitoAccess: true }, () => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'allowed')))`),
      'allowed', 'WardenOne allowed in incognito');
    await cdp.send('Target.closeTarget', { targetId: extensionsPage });
    await sleep(2000);
    extension = await profile.extensionReady(cdp, port, version);
    const { browserContextId: privateContext } = await cdp.send('Target.createBrowserContext', {});
    const { targetId: privateSettingsId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/settings.html`, browserContextId: privateContext });
    const regularSettings = await open('settings.html');
    const privateSettings = await attach(privateSettingsId);
    await until(regularSettings, "typeof loaded !== 'undefined' && loaded === true", 'regular Settings to load');
    await until(privateSettings, "typeof loaded !== 'undefined' && loaded === true", 'private Settings to load');
    assert.equal(await evaluate(regularSettings, 'chrome.extension.inIncognitoContext'), false, 'the regular page is not incognito');
    assert.equal(await evaluate(privateSettings, 'chrome.extension.inIncognitoContext'), true, 'the private page runs in WardenOne\'s incognito context');
    let privateWorker = null;
    for (const deadline = Date.now() + 15000; !privateWorker && Date.now() < deadline; await sleep(200)) {
      privateWorker = (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker'
        && t.url === `chrome-extension://${extension.id}/background.js` && t.browserContextId === privateContext) || null;
    }
    assert(privateWorker, 'the private window has its own WardenOne worker');
    const privateWorkerSession = await attach(privateWorker.targetId);
    await evaluate(regularSettings, "new Promise((r) => chrome.storage.local.set({ wardenone_race_probe: 'regular' }, r))");
    assert.equal(await evaluate(privateSettings, "new Promise((r) => chrome.storage.local.get('wardenone_race_probe', (d) => r(d.wardenone_race_probe)))"), 'regular',
      'the private window shares the regular storage, which is what makes this a race');
    await evaluate(regularSettings, "new Promise((r) => chrome.storage.local.remove('wardenone_race_probe', r))");

    const lostPrivate = { regular: [], privatePage: [], privateWorker: [] };
    for (let i = 0; i < PRIVATE_TRIALS; i++) {
      const want = i % 2 === 0;
      const type = muteType(1000 + i);
      await Promise.all([
        evaluate(regularSettings, `writeConfig({ deAmp: ${want} }).then(() => true)`),
        evaluate(privateSettings, `writeConfig({ capReferrer: ${want} }).then(() => true)`),
        evaluate(privateWorkerSession, `muteToastType('${type}', 60).then(() => true)`),
      ]);
      /* Long enough for each write's two checks, and a write made again if one was lost. */
      await sleep(2500);
      const cfg = await evaluate(regularSettings, "new Promise((r) => chrome.storage.local.get('wardenone_config', (d) => r(d.wardenone_config)))");
      if (cfg.deAmp !== want) lostPrivate.regular.push(i);
      if (cfg.capReferrer !== want) lostPrivate.privatePage.push(i);
      if (!(cfg.toastMutes && cfg.toastMutes[type])) lostPrivate.privateWorker.push(i);
    }
    assert.deepEqual(lostPrivate, { regular: [], privatePage: [], privateWorker: [] },
      'a change made at the same moment as one in a private window was lost, by trial: ' + JSON.stringify(lostPrivate));
    console.log('[ok] config writes from regular Settings, private Settings and the private window\'s worker all survived '
      + PRIVATE_TRIALS + ' simultaneous tries in ' + browser.Browser);
    await evaluate(regularSettings, 'writeConfig({ deAmp: false, capReferrer: false }).then(() => true)');
    await evaluate(privateSettings, "chrome.storage.local.get(['wardenone_config', WO_CONFIG_WRITES_KEY]).then((got) => { globalThis.__woStale = got; return true; })");
    await evaluate(regularSettings, 'writeConfig({ deAmp: true }).then(() => true)');
    await evaluate(privateSettings, "(() => { const got = __woStale; const stamp = stampConfigWrite(got[WO_CONFIG_WRITES_KEY], ['deAmp']); return localWrite({ wardenone_config: Object.assign({}, got.wardenone_config, { deAmp: false }), [WO_CONFIG_WRITES_KEY]: stamp.record }).then(() => true); })()");
    await sleep(1500);
    assert.equal(await evaluate(privateSettings, "chrome.storage.local.get('wardenone_config').then((got) => got.wardenone_config.deAmp)"), false,
      'the last completed same-setting edit wins over an earlier reconciliation');
    console.log('[ok] a later private edit to the same setting wins');

    await evaluate(regularSettings, 'writeConfig({ deAmp: false }).then(() => true)');
    await evaluate(privateSettings, `(() => {
      const area = chrome.storage.local;
      const originalSet = area.set.bind(area);
      let held = false;
      area.set = (items, callback) => {
        if (!held && Object.prototype.hasOwnProperty.call(items, 'wardenone_config')) {
          held = true;
          globalThis.__resumeOlderSameKeyWrite = () => { area.set = originalSet; originalSet(items, callback); };
          return;
        }
        return originalSet(items, callback);
      };
      globalThis.__olderSameKeyWrite = writeConfig({ deAmp: true });
      return true;
    })()`);
    await until(privateSettings, "typeof __resumeOlderSameKeyWrite === 'function'", 'older private same-key write to pause after stamping');
    await evaluate(regularSettings, 'writeConfig({ deAmp: false }).then(() => true)');
    assert.equal(await evaluate(privateSettings, "(__resumeOlderSameKeyWrite(), __olderSameKeyWrite.then(() => true))"), true,
      'the older private same-key write completed after the later regular edit');
    await sleep(2100);
    assert.equal(await evaluate(regularSettings, "chrome.storage.local.get('wardenone_config').then((got) => got.wardenone_config.deAmp)"), false,
      'the later regular same-key edit was discarded by the delayed older write');
    console.log('[ok] a later same-setting edit is recovered after an older private write lands late');

    await evaluate(regularSettings, 'writeConfig({ deAmp: false, capReferrer: false }).then(() => true)');
    await evaluate(privateSettings, "chrome.storage.local.get(['wardenone_config', WO_CONFIG_WRITES_KEY]).then((got) => { globalThis.__woStale = got; return true; })");
    await evaluate(regularSettings, 'writeConfig({ deAmp: true }).then(() => true)');
    await sleep(2100);
    await evaluate(privateSettings, "(() => { const got = __woStale; const stamp = stampConfigWrite(got[WO_CONFIG_WRITES_KEY], ['capReferrer']); return localWrite({ wardenone_config: Object.assign({}, got.wardenone_config, { capReferrer: true }), [WO_CONFIG_WRITES_KEY]: stamp.record }).then(() => true); })()");
    await sleep(1500);
    const late = await evaluate(privateSettings, "chrome.storage.local.get('wardenone_config').then((got) => ({ deAmp: got.wardenone_config.deAmp, capReferrer: got.wardenone_config.capReferrer }))");
    /* Before repairOverwrittenConfig this ended { deAmp: false, capReferrer: true }: both of the
       regular write's checks had passed, and the late private write took its change away for good. */
    assert.deepEqual(late, { deAmp: true, capReferrer: true },
      'a regular change to another setting was lost to a private write that landed 2.1 s late: ' + JSON.stringify(late));
    console.log('[ok] a private write that lands 2.1 s late keeps the regular change to another setting');

    const erasedKey = 'erase-race-synthetic-api-key';
    const erasedSite = 'erase-race-probe.example';
    await evaluate(regularSettings, `writeConfig({
      deAmp: false, capReferrer: false, downloadSafeBrowsingKey: ${JSON.stringify(erasedKey)},
      allowlist: [${JSON.stringify(erasedSite)}],
      siteOverrides: { [${JSON.stringify(erasedSite)}]: { adShield: false } },
    }).then(() => true)`);
    const stale = await evaluate(privateSettings, "chrome.storage.local.get(['wardenone_config', WO_CONFIG_WRITES_KEY])");
    assert.equal(stale.wardenone_config.downloadSafeBrowsingKey, erasedKey);
    assert(stale.wardenone_config.allowlist.includes(erasedSite));
    assert.equal(stale.wardenone_config.siteOverrides[erasedSite].adShield, false);
    await evaluate(privateSettings, `(() => {
      const area = chrome.storage.local;
      const originalSet = area.set.bind(area);
      let held = false;
      area.set = (items, callback) => {
        if (!held && Object.prototype.hasOwnProperty.call(items, 'wardenone_config')) {
          held = true;
          globalThis.__resumePrivateWrite = () => { area.set = originalSet; originalSet(items, callback); };
          return;
        }
        return originalSet(items, callback);
      };
      globalThis.__privateWriteDone = writeConfig({ capReferrer: true });
      return true;
    })()`);
    await until(privateSettings, "typeof __resumePrivateWrite === 'function'", 'private Settings save paused after its read');
    assert.equal((await evaluate(regularSettings, "new Promise((r) => chrome.runtime.sendMessage({kind:'privacy-data-erase',mode:'all'},r))")).ok, true);
    assert.equal(await evaluate(privateSettings, "(__resumePrivateWrite(), __privateWriteDone.then(() => true))"), true,
      'the paused private Settings save completed after Erase all');
    await sleep(2100);
    extension = await profile.extensionReady(cdp, port, version);
    const { browserContextId: afterResetContext } = await cdp.send('Target.createBrowserContext', {});
    const { targetId: afterResetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/settings.html`, browserContextId: afterResetContext });
    const afterReset = await attach(afterResetId);
    await until(afterReset, "typeof stampConfigWrite === 'function' && typeof localWrite === 'function'", 'private extension page after erase');
    assert.equal(await evaluate(afterReset, 'chrome.extension.inIncognitoContext'), true);
    const cleanStorage = `chrome.storage.local.get(null).then((items) => {
      const cfg = items.wardenone_config || {};
      const text = JSON.stringify(items);
      return {
        apiKey: cfg.downloadSafeBrowsingKey === ${JSON.stringify(erasedKey)},
        allowlisted: Array.isArray(cfg.allowlist) && cfg.allowlist.includes(${JSON.stringify(erasedSite)}),
        siteException: !!(cfg.siteOverrides && cfg.siteOverrides[${JSON.stringify(erasedSite)}]),
        elsewhere: text.includes(${JSON.stringify(erasedKey)}) || text.includes(${JSON.stringify(erasedSite)}),
        epochValid: !!(items[WO_CONFIG_RESET_KEY] && items[WO_CONFIG_WRITES_KEY]
          && items[WO_CONFIG_WRITES_KEY].epoch === items[WO_CONFIG_RESET_KEY].epoch),
      };
    })`;
    const expectedClean = { apiKey: false, allowlisted: false, siteException: false, elsewhere: false, epochValid: true };
    const cleanPredicate = `(${cleanStorage}).then((state) => !state.apiKey && !state.allowlisted && !state.siteException && !state.elsewhere && state.epochValid)`;
    await until(afterReset, cleanPredicate, 'paused private Settings save to be removed after reload');
    assert.deepEqual(await evaluate(afterReset, cleanStorage), expectedClean, 'Erase all must survive the paused private Settings save and reload');
    await evaluate(afterReset, `(() => { const old = ${JSON.stringify(stale)}; const stamp = stampConfigWrite(old[WO_CONFIG_WRITES_KEY], ['capReferrer']); return localWrite({ wardenone_config: Object.assign({}, old.wardenone_config, { capReferrer: true }), [WO_CONFIG_WRITES_KEY]: stamp.record }).then(() => true); })()`);
    await until(afterReset, cleanPredicate,
      'pre-reset private write to be removed');
    await sleep(1300);
    assert.deepEqual(await evaluate(afterReset, cleanStorage), expectedClean,
      'a delayed pre-reset private snapshot must not restore the API key or site exceptions');
    console.log('[ok] Erase all survives a paused private Settings save and a delayed private replay after reload');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-config-race-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
profile.mustFinish(run, 'browser-config-race').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

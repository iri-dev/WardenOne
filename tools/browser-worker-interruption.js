/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-interruption-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    let extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (expression, session = extension.attachedSession) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (check, label) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) { if (await check()) return; await sleep(80); }
      throw Error('Timed out: ' + label);
    };
    await evaluate(`updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,autoUpdateLists:false,capReferrer:false}))`);
    await until(() => evaluate(`!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey
      &&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer`), 'baseline reconciliation');
    assert.equal(await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]}).then(r=>r.length)`), 0);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/permissions.html' });
    const page = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page.sessionId);
    const versions = new Map();
    const off = cdp.on((message) => {
      if (message.method !== 'ServiceWorker.workerVersionUpdated') return;
      for (const item of message.params.versions) versions.set(item.versionId, item);
    });
    await cdp.send('ServiceWorker.enable', {}, page.sessionId);
    await until(async () => Array.from(versions.values()).some((item) => item.scriptURL === 'chrome-extension://' + extension.id + '/background.js'
      && item.runningStatus === 'running'), 'service worker version');
    const workerVersion = Array.from(versions.values()).find((item) => item.scriptURL === 'chrome-extension://' + extension.id + '/background.js'
      && item.runningStatus === 'running');

    await evaluate(`(async()=>{
      applyHeaderShieldRules=async()=>{globalThis.__interruptionReached=true;await new Promise(()=>{});};
      await updateStoredConfig(cfg=>Object.assign(cfg,{capReferrer:true}));
    })()`);
    await until(() => evaluate('globalThis.__interruptionReached===true'), 'held rule owner');
    const pending = () => evaluate(`chrome.storage.session.get('wardenone_reconcile_pending')
      .then(s=>!!s.wardenone_reconcile_pending)`, page.sessionId);
    assert.equal(await pending(), true, 'intent is durable while an owner is still pending');
    assert.equal(await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]}).then(r=>r.length)`), 0);

    const oldTarget = extension.workerTargetId;
    await cdp.send('ServiceWorker.stopWorker', { versionId: workerVersion.versionId }, page.sessionId);
    await until(async () => !(await cdp.send('Target.getTargets')).targetInfos.some((item) => item.targetId === oldTarget), 'forced worker termination');
    assert.equal(await pending(), true, 'termination must not erase unfinished intent');
    await evaluate(`chrome.runtime.sendMessage({kind:'worker-interruption-test-wake'}).then(()=>true,()=>true)`, page.sessionId);
    extension = await profile.extensionReady(cdp, port, version);
    // Chrome can reuse a worker target ID; its private heap must still have been discarded.
    assert.equal(await evaluate('typeof globalThis.__interruptionReached'), 'undefined', 'recovery must run in a fresh worker realm');
    await until(async () => !await pending() && await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]})
      .then(r=>r.length===1)`), 'latest setting restored by the new worker');
    off();
    console.log('[ok] forced worker termination preserves intent and resumes the latest rule setting in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('wo-interruption-')) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
profile.mustFinish(run, 'browser-worker-interruption').catch((error) => { console.error(error); process.exitCode = 1; });

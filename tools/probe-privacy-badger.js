/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const { fingerprint } = require('./lib/privacy-baseline.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(cdp, timeout = 30000) {
  const end = Date.now() + timeout;
  let sessionId, target;
  while (Date.now() < end) {
    if (!sessionId) {
      target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.endsWith('/js/background.js'));
      if (target) sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    }
    if (sessionId) {
      const out = await cdp.send('Runtime.evaluate', { expression: 'globalThis.badger?.INITIALIZED===true', returnByValue: true }, sessionId);
      if (out.result?.value) return { attachedSession: sessionId, workerTargetId: target.targetId, id: new URL(target.url).host };
    }
    await sleep(100);
  }
  throw Error('Privacy Badger did not initialize');
}
async function run() {
  const directory = path.resolve(process.argv[2] || 'tmp/release-phase09/privacybadger-chromium');
  const port = await profile.freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-badger-probe-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', directory, port, dir, ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const ext = await ready(cdp);
    const response = await cdp.send('Runtime.evaluate', { expression: `(async()=>({version:chrome.runtime.getManifest().version,initialized:badger.INITIALIZED,
      actions:Object.keys(badger.storage.getStore('action_map').getItemClones()).length,settings:badger.getSettings().getItemClones(),
      rules:await chrome.declarativeNetRequest.getDynamicRules().then(r=>r.length)}))()`, awaitPromise: true, returnByValue: true }, ext.attachedSession);
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    const result = { date: new Date().toISOString(), browser: browser.Browser, fingerprint: fingerprint(directory).sha256, ...response.result.value };
    fs.writeFileSync('tmp/release-phase09/privacy-badger-probe.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    cleanupProfile(dir, 'wo-badger-probe-');
  }
}
module.exports = { ready };
if (require.main === module) profile.mustFinish(run, 'probe-privacy-badger').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

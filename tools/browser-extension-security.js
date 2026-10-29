/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const ROOT = path.resolve(__dirname, '..');
const CLAUDE = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const BUSTER = 'mpbjkejclgfgadiemmefgebjfooflfhl';
const UNKNOWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HARMFUL = 'klbibkeccnjlkjkiokjodocebajanakg';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-extension-security-'));
  const port = await profile.freePort();
  let cdp;
  try {
    const version = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(version.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'))).version);
    const evaluate = async (expression, sessionId) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const worker = (expression) => evaluate(expression, extension.attachedSession);
    const base = { type: 'extension', version: '1.0.0', enabled: true, mayDisable: true,
      disabledReason: '', installType: 'normal', permissions: ['storage'], hostPermissions: [] };
    const fixtures = [
      { ...base, id: CLAUDE, name: 'Claude', permissions: ['storage', 'debugger', 'scripting', 'nativeMessaging', 'identity'], hostPermissions: ['<all_urls>'] },
      { ...base, id: BUSTER, name: 'Buster: Captcha Solver for Humans', enabled: false,
        permissions: ['storage', 'nativeMessaging', 'webRequest', 'scripting'], hostPermissions: ['<all_urls>'] },
      { ...base, id: UNKNOWN, name: 'Uncatalogued Helper', permissions: ['storage', 'debugger'], hostPermissions: ['<all_urls>'] },
      { ...base, id: HARMFUL, name: 'The Great Suspender (legacy listing)', enabled: false },
    ];
    /* Override inventory only inside this disposable worker; use the real report, storage and UI. */
    await worker(`(async () => {
      globalThis.__extensionSecurityFixtures = ${JSON.stringify(fixtures)};
      getAllExtensions = async () => __extensionSecurityFixtures;
      const stored = await localGet('wardenone_config');
      await localSet({ wardenone_config: { ...stored.wardenone_config, enabled: true, watchExtensionPermissions: true, silentMode: true } });
      await snapshotExtensionBaseline();
    })()`);
    const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/extensions.html` });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    const page = (expression) => evaluate(expression, sessionId);
    const until = async (expression, label) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await page(expression)) return;
        await sleep(100);
      }
      throw Error('Timed out waiting for ' + label);
    };
    await until("document.readyState === 'complete' && typeof centreState !== 'undefined' && centreState.report && !centreState.busy", 'initial security report');
    const card = (id) => `document.querySelector('[data-extension-id="${id}"]')`;
    const verdict = (id) => page(`${card(id)}.querySelector('.verdict').textContent`);
    assert.equal(await verdict(CLAUDE), 'Review permission');
    assert.equal(await verdict(BUSTER), 'Disabled');
    assert.equal(await verdict(UNKNOWN), 'Powerful permissions');
    assert.equal(await verdict(HARMFUL), 'Security incident');
    assert.equal(await page("document.getElementById('sum-attention').textContent"), '2');
    assert(await page(`${card(BUSTER)}.textContent.includes('optional desktop client')`));
    assert(await page(`${card(UNKNOWN)}.textContent.includes('Permission exposure: Extensive')`));
    await page(`${card(CLAUDE)}.querySelector('[data-action="review"]').click()`);
    await until(`${card(CLAUDE)}.querySelector('.verdict').textContent === 'Reviewed snapshot'`, 'snapshot acknowledgment');
    assert.equal(await page("document.getElementById('sum-attention').textContent"), '1');
    assert.equal(await verdict(HARMFUL), 'Security incident');
    assert(await page(`${card(CLAUDE)}.textContent.includes('account sign-in tokens')`));
    await worker(`__extensionSecurityFixtures.find((item) => item.id === '${CLAUDE}').version = '2.0.0'`);
    await page('scanExtensions(true)');
    assert.equal(await verdict(CLAUDE), 'Reviewed snapshot');
    await worker(`__extensionSecurityFixtures.find((item) => item.id === '${CLAUDE}').permissions.push('proxy')`);
    await page('scanExtensions(true)');
    assert.equal(await verdict(CLAUDE), 'Review permission');
    assert.equal(await page("document.getElementById('sum-attention').textContent"), '2');
    await worker(`__extensionSecurityFixtures.find((item) => item.id === '${BUSTER}').enabled = true`);
    await page('scanExtensions(true)');
    assert.equal(await verdict(BUSTER), 'Recognized');
    const report = await page('centreState.report');
    assert.equal(report.extensions.find((item) => item.id === BUSTER).latestChange.severity, 'low');
    await page("document.querySelector('[data-filter=changed]').click()");
    assert.equal(await page(`${card(BUSTER)} === null`), true);
    assert.equal(await page(`${card(CLAUDE)} !== null`), true);
    await page("document.querySelector('[data-filter=all]').click()");
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    assert(await page('document.documentElement.scrollWidth <= innerWidth'), 'security cards must fit a narrow viewport');
    if (process.env.WARDENONE_EXTENSION_SECURITY_SCREENSHOT) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
      fs.writeFileSync(process.env.WARDENONE_EXTENSION_SECURITY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    console.log('[ok] real Extension Security Centre: exposure, Buster, Claude review, material changes, incidents, filters and narrow layout');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    cleanupProfile(dir, 'wo-extension-security-');
  }
}

profile.mustFinish(run, 'browser-extension-security').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

/* Exercise the actual popup and extracted modules in a disposable Edge profile. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-popup-regression-'));
  let cdp;
  let page;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs?.(cdp, port, extension.id);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

    async function openPopup() {
      const { targetId } = await cdp.send('Target.createTarget', {
        url: `chrome-extension://${extension.id}/popup.html`,
      });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      page = { targetId, sessionId };
      await until("document.readyState === 'complete' && !!document.getElementById('wo-settings-search')", 'popup load');
      return page;
    }
    async function value(expression) {
      const result = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      }, page.sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result && result.result.value;
    }
    async function until(expression, label, timeout = 15000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await value(expression)) return;
        await sleep(100);
      }
      throw new Error(`Timed out waiting for ${label}`);
    }
    async function search(query) {
      await value(`(() => { const el = document.getElementById('wo-settings-search'); el.value = ${JSON.stringify(query)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    }
    async function visible(selector) {
      return value(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.closest('.wo-hidden') && getComputedStyle(el).display !== 'none'; })()`);
    }

    await openPopup();
    const searches = [
      ['WebAssembly', '#js-shield .row'],
      ['brightness', '#eyeshield-panel'],
      ['Sleep inactive tabs', 'input[data-key="memoryShield"]'],
      ['fake phishing', 'input[data-key="detectPhishing"]'],
      ['forced popups', 'input[data-key="blockForcedPopups"]'],
    ];
    for (const [query, selector] of searches) {
      await search(query);
      assert(await visible(selector), `${query} must reveal ${selector}`);
    }
    await search('WebAssembly startup');
    assert(await visible('#js-shield'), 'a matching Script Shield row must keep its section visible');
    assert(await visible('#js-shield .row'), 'the matching Script Shield row must stay visible');
    assert(!(await visible('#js-shield .script-trust-row')), 'an unrelated Script Shield row may hide');
    await value("document.getElementById('wo-search-clear').click()");
    assert(await visible('#js-shield') && await visible('#eyeshield-panel')
      && await visible('input[data-key="memoryShield"]'), 'clearing search must restore the main sections');
    assert.equal(await value("document.getElementById('wo-settings-search').value"), '');

    await value("document.querySelector('#protection-health-panel summary').click()");
    await until("document.getElementById('health-status-title').textContent !== 'Checking protection'", 'Protection Health');
    assert(await value("document.getElementById('protection-health-panel').open"), 'Protection Health must open');
    await value("document.getElementById('diagnostics-prepare').click()");
    await until("document.getElementById('diagnostics-preview').textContent.includes('WardenOne diagnostics')", 'diagnostics preview');
    assert(!(await value("document.getElementById('diagnostics-download').disabled")), 'diagnostics download must enable');
    await value("document.getElementById('diagnostics-download').click()");
    const download = path.join(dir, 'wardenone-diagnostics.txt');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(download) && Date.now() < deadline) await sleep(100);
    assert(fs.existsSync(download), 'diagnostics download must save a file');
    assert(fs.readFileSync(download, 'utf8').includes('WardenOne diagnostics'));

    await search('WebAssembly');
    await until("new Promise(resolve => chrome.storage.session.get('wardenone_popup_search_memory', data => resolve(data.wardenone_popup_search_memory?.q === 'WebAssembly')))", 'saved search');
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
    await openPopup();
    await until("document.getElementById('wo-settings-search').value === 'WebAssembly'", 'restored search');
    assert(await visible('#js-shield'), 'restored search must keep Script Shield visible');
    await value("document.getElementById('wo-search-clear').click()");

    await value("(() => { const el = document.getElementById('enabled'); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await until("new Promise(resolve => chrome.storage.local.get('wardenone_config', data => resolve(data.wardenone_config?.enabled === false)))", 'saved master switch');
    assert(await value("document.getElementById('eyeshield-panel').classList.contains('is-disabled')"));
    assert(await value("document.getElementById('js-global-wrap').classList.contains('disabled')"));
    const notDimmed = await value("[...document.querySelectorAll('.group .tg')].filter(el => !el.classList.contains('disabled')).map(el => el.querySelector('input')?.id || el.querySelector('input')?.dataset.key || 'unnamed')");
    assert.deepEqual(notDimmed, [], `master-off controls are not dimmed: ${notDimmed.join(', ')}`);
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
    await openPopup();
    await until("document.getElementById('enabled').checked === false", 'restored master switch');
    await value("(() => { const el = document.getElementById('enabled'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await until("new Promise(resolve => chrome.storage.local.get('wardenone_config', data => resolve(data.wardenone_config?.enabled === true)))", 'restored enabled config');
    assert(await value("[...document.querySelectorAll('.group .tg')].every(el => !el.classList.contains('disabled'))"));
    console.log('[ok] real popup search, health, diagnostics, reopen and master-switch checks passed');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('wo-popup-regression-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

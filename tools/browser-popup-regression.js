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
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', ROOT, port, dir);
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
    const browserName = process.env.WARDENONE_BROWSER_NAME || 'Microsoft Edge';
    const expectedBrowser = { 'Microsoft Edge': 'Edge', 'Google Chrome': 'Chrome' }[browserName] || browserName;
    await until(`document.getElementById('ug-name').textContent === ${JSON.stringify(expectedBrowser)}`, 'Update Guardian browser detection');
    assert.equal(await value("document.getElementById('ug-btn').textContent"), `Check ${expectedBrowser} updates`);
    const cardText = await value("document.querySelector('.update-guardian').textContent");
    if (expectedBrowser === 'Edge') assert(!/Brave/.test(cardText), 'Edge must not show Brave release wording');
    if (expectedBrowser === 'Brave') assert(!/Edge/.test(cardText), 'Brave must not show Edge release wording');
    assert(await value("(() => { const button = document.getElementById('ug-btn'); const text = document.createRange(); text.selectNodeContents(button); const box = button.getBoundingClientRect(); const label = text.getBoundingClientRect(); return Math.abs((box.left + box.right - label.left - label.right) / 2) < 2; })()"),
      'the update button label should be centered');
    assert(await value("document.getElementById('ug-refresh').getAttribute('aria-label') === 'Check again'"));
    assert(!(await value("document.getElementById('ug-note').textContent.includes('hidden from extensions')")));
    assert(await value("(() => { const select = document.getElementById('privacy-data-mode'); const row = select.closest('.row'); return select.getBoundingClientRect().width > 250 && select.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1; })()"),
      'the reset choice should fit across the popup');
    assert.equal(await value("document.getElementById('privacy-data-erase').textContent"), 'Reset WardenOne');
    await value("(() => { const select = document.getElementById('privacy-data-mode'); select.value = 'settings'; select.dispatchEvent(new Event('change')); })()");
    assert.equal(await value("document.getElementById('privacy-data-erase').textContent"), 'Clear records and API keys');
    await value("(() => { const select = document.getElementById('privacy-data-mode'); select.value = 'all'; select.dispatchEvent(new Event('change')); })()");
    if (process.env.WARDENONE_PRIVACY_SCREENSHOT) {
      await value("document.getElementById('privacy-data-mode').closest('.row').scrollIntoView({block:'center'})");
      await cdp.send('Page.bringToFront', {}, page.sessionId);
      await sleep(300);
      const top = await value("document.getElementById('privacy-data-mode').closest('.row').getBoundingClientRect().top + scrollY");
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: Math.max(0, top - 45), width: 348, height: 400, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_PRIVACY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    if (process.env.WARDENONE_POPUP_SCREENSHOT) {
      await until("document.getElementById('ug-status').dataset.state !== 'checking'", 'Update Guardian status', 15000);
      await value("document.querySelector('.update-guardian').scrollIntoView({block:'center'})");
      await cdp.send('Page.bringToFront', {}, page.sessionId);
      await sleep(300);
      const top = await value("document.querySelector('.update-guardian').getBoundingClientRect().top + scrollY");
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: Math.max(0, top - 120), width: 348, height: 450, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_POPUP_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
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
    const healthSummary = await value("document.getElementById('health-status-detail').textContent");
    assert(!/engine check|No issue found in what could be checked/i.test(healthSummary),
      'the closed health card should use plain language');
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
    try { await until("document.getElementById('wo-settings-search').value === 'WebAssembly'", 'restored search', 30000); }
    catch (error) {
      const state = await value("new Promise(resolve => chrome.storage.session.get('wardenone_popup_search_memory', data => resolve({ saved: data.wardenone_popup_search_memory, current: document.getElementById('wo-settings-search').value })))");
      throw new Error(error.message + ': ' + JSON.stringify(state));
    }
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
    /* Midway down, and the wheel turned toward the larger gap: a saved position past the end
       clamps to it, and a wheel pointed into an end does not move the page at all. */
    const maxScroll = await value('document.scrollingElement.scrollHeight - innerHeight');
    assert(maxScroll > 200, 'the popup is too short to test scroll restoration: ' + maxScroll);
    const savedY = Math.floor(maxScroll / 2);
    await value(`new Promise(resolve => chrome.storage.session.set({wardenone_popup_scroll_memory:{y:${savedY},at:Date.now()}},resolve))`);
    await value("scrollTo(0,0); restorePopupScrollPosition()");
    await until(`Math.abs(scrollY - ${savedY}) < 2`, 'saved popup scroll position');
    const restoredY = await value('scrollY');
    const wheelDelta = maxScroll - restoredY >= restoredY ? 420 : -420;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 300, deltaX: 0, deltaY: wheelDelta }, page.sessionId);
    /* The wheel lands asynchronously; compare from where it landed, not from a fixed delay. */
    await until(`scrollY !== ${restoredY}`, 'the wheel scroll to land');
    const userScrollY = await value('scrollY');
    await sleep(600);
    assert(Math.abs((await value('scrollY')) - userScrollY) < 5, 'restoration must not pull against user scrolling');
    console.log('[ok] real popup search, health, diagnostics, updates, scroll, reopen and master-switch checks passed');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('wo-popup-regression-')) {
      /* Edge's helper processes can hold profile files briefly after the DevTools endpoint closes. */
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn('[warn] could not remove the temporary profile: ' + error.message); }
    }
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

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
    const dashboardState = await value(`(() => {
      const base = { host: 'youtube.com', web: true, since: Date.now(), total: 0,
        cats: Object.fromEntries(SITE_DASH_CATEGORIES.map(c => [c.id, 0])), noticed: 0,
        net: { available: true, sources: [] }, events: [], tallies: [], typeCounts: {},
        recent: { day: {}, week: {} }, retained: { total: 0 } };
      renderSiteDashboard(base);
      const zero = {
        label: document.getElementById('site-dash-label').textContent,
        categoriesHidden: getComputedStyle(document.getElementById('site-dash-cats')).display === 'none',
        sourcesHidden: getComputedStyle(document.getElementById('site-dash-sources')).display === 'none',
        protections: document.querySelectorAll('#site-dash-protections .site-dash-check').length,
        note: document.getElementById('site-dash-note').textContent,
      };
      renderSiteDashboard({ ...base, total: 3, cats: { ...base.cats, trackers: 2, ads: 1 },
        net: { available: true, sources: [{ name: 'Tracker list', count: 2 }, { name: 'AdShield', count: 1 }] } });
      const active = {
        categories: document.querySelectorAll('#site-dash-cats .site-dash-line').length,
        sources: [...document.querySelectorAll('#site-dash-sources .site-dash-line')].map(el => el.textContent),
        logger: document.getElementById('site-dash-logger').textContent,
      };
      renderSiteDashboard(base);
      return { zero, active };
    })()`);
    assert.equal(dashboardState.zero.label, 'no WardenOne actions recorded');
    assert(dashboardState.zero.categoriesHidden && dashboardState.zero.sourcesHidden,
      'zero activity must not become rows of zero counts');
    assert(dashboardState.zero.protections > 0, 'zero activity should still show protection status');
    assert.match(dashboardState.zero.note, /does not say the page had nothing to block/);
    assert.equal(dashboardState.active.categories, 2);
    assert.deepEqual(dashboardState.active.sources, ['Tracker list2', 'AdShield1']);
    assert.equal(dashboardState.active.logger, 'Inspect new requests');
    if (process.env.WARDENONE_DASHBOARD_SCREENSHOT) {
      await value("document.getElementById('site-dash').hidden = false; document.body.classList.add('wo-site-view'); scrollTo(0, 0)");
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 348, height: 800, deviceScaleFactor: 1, mobile: false }, page.sessionId);
      await sleep(300);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, width: 348, height: 1000, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_DASHBOARD_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      await value("document.body.classList.remove('wo-site-view'); document.getElementById('site-dash').hidden = true");
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, page.sessionId);
    }
    await value("document.getElementById('arrange-open').click()");
    const initialArrangeOrder = await value("[...document.querySelectorAll('#arrange-list .arrange-item')].map(el => el.dataset.id)");
    assert(initialArrangeOrder.length > 2, 'arrange view should list sections');
    await value("document.querySelector('#arrange-list .arrange-item .arrange-move[data-dir=\"1\"]').click()");
    const arrowOrder = await value("[...document.querySelectorAll('#arrange-list .arrange-item')].map(el => el.dataset.id)");
    assert.deepEqual(arrowOrder.slice(0, 2), initialArrangeOrder.slice(0, 2).reverse(),
      'the down arrow still moves one section');
    await value(`document.querySelector('#arrange-list .arrange-item[data-id=${JSON.stringify(initialArrangeOrder[0])}] .arrange-move[data-dir="-1"]').click()`);
    const rowPoints = await value(`(() => {
      const rows = [...document.querySelectorAll('#arrange-list .arrange-item')];
      const name = rows[0].querySelector('.arrange-name').getBoundingClientRect();
      const next = rows[1].getBoundingClientRect();
      return { x: Math.round(name.left + name.width / 2), from: Math.round(name.top + name.height / 2), to: Math.round(next.bottom - 5) };
    })()`);
    await cdp.send('Page.bringToFront', {}, page.sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rowPoints.x, y: rowPoints.from, button: 'left', buttons: 1, clickCount: 1 }, page.sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowPoints.x, y: rowPoints.to, button: 'left', buttons: 1 }, page.sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rowPoints.x, y: rowPoints.to, button: 'left', buttons: 0, clickCount: 1 }, page.sessionId);
    await until(`document.querySelector('#arrange-list .arrange-item').dataset.id === ${JSON.stringify(initialArrangeOrder[1])}`,
      'immediate row drag to reorder');
    await value("document.getElementById('arrange-reset').click()");
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, page.sessionId);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rowPoints.x, y: rowPoints.from, id: 1 }] }, page.sessionId);
    await sleep(140);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rowPoints.x, y: rowPoints.to, id: 1 }] }, page.sessionId);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sessionId);
    await until(`document.querySelector('#arrange-list .arrange-item').dataset.id === ${JSON.stringify(initialArrangeOrder[1])}`,
      'held touch drag to reorder');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, page.sessionId);
    await value("document.getElementById('arrange-reset').click(); document.getElementById('arrange-done').click()");
    /* The card is shown in each layout the way the popup shows it: layout set while hidden, then
       shown, and measured on the next frame. Edge 153 can leave the toggle's style on the old
       layout when the layout attribute changes on a card already on screen. */
    const nextFrame = () => value("new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve('frame'))); setTimeout(() => resolve('timer'), 250); })");
    const showCard = async (layout) => {
      await value("(() => { const section = document.getElementById('site-card'); section.hidden = true; void section.offsetHeight;"
        + " section.dataset.layout = " + JSON.stringify(layout) + "; section.hidden = false; return true; })()");
      await nextFrame();
    };
    const cardBox = "(() => { const section = document.getElementById('site-card'); const fold = document.getElementById('site-card-fold');"
      + " const top = section.getBoundingClientRect().top; const row = section.querySelector('.site-card-top').getBoundingClientRect(); const toggle = fold.getBoundingClientRect();"
      + " return { offset: Math.abs((toggle.top + toggle.bottom - row.top - row.bottom) / 2), row: [row.top - top, row.height], toggle: [toggle.top - top, toggle.height],"
      + " top: getComputedStyle(fold).top, layout: section.dataset.layout, folded: section.classList.contains('is-folded') }; })()";
    await value("(() => { const section = document.getElementById('site-card'); if (section.classList.contains('is-folded')) document.getElementById('site-card-fold').click();"
      + " document.getElementById('site-card-stats').hidden = false; const caption = document.getElementById('site-card-caption'); caption.hidden = false;"
      + " caption.textContent = 'Recent site activity'; return true; })()");
    await showCard('B');
    const cardGeometry = await value(`(() => {
      const section = document.getElementById('site-card');
      const stats = document.getElementById('site-card-stats');
      const caption = document.getElementById('site-card-caption');
      const expanded = section.getBoundingClientRect().height;
      document.getElementById('site-card-fold').click();
      const folded = section.getBoundingClientRect().height;
      const countsHidden = getComputedStyle(stats).display === 'none'
        && getComputedStyle(caption).display === 'none';
      const shield = document.querySelector('.head .shield').getBoundingClientRect();
      const header = document.querySelector('.head').getBoundingClientRect();
      return { expanded, folded, countsHidden, logoTop: shield.top - header.top, browser: navigator.userAgent.replace(/^.*\\) /, '') };
    })()`);
    assert(cardGeometry.expanded - cardGeometry.folded > 40, 'folded counts card should lose its counts and caption');
    await showCard('A');
    const oneLine = await value(cardBox);
    assert(await value("getComputedStyle(document.getElementById('site-card-state')).display !== 'none'") && cardGeometry.countsHidden,
      'folded card should keep the site status');
    assert(oneLine.offset < 2, 'fold toggle should be centered on the one-line row: ' + JSON.stringify(Object.assign({ browser: cardGeometry.browser }, oneLine)));
    assert(Math.abs(cardGeometry.logoTop - 19) < 1, 'header logo should sit 19px from its top');
    await until("new Promise(resolve => chrome.storage.local.get('wardenone_site_card_folded', data => resolve(data.wardenone_site_card_folded === true)))", 'saved site card fold');
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
    await openPopup();
    await until("document.getElementById('site-card').classList.contains('is-folded')", 'restored site card fold');
    await value("document.getElementById('site-card-fold').click()");
    const onboardingTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/onboarding.html` });
    const onboarding = await cdp.send('Target.attachToTarget', { targetId: onboardingTarget.targetId, flatten: true });
    await cdp.send('Page.enable', {}, onboarding.sessionId);
    await cdp.send('Runtime.enable', {}, onboarding.sessionId);
    const onboardingValue = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, onboarding.sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result && result.result.value;
    };
    const onboardingReady = Date.now() + 10000;
    while (!(await onboardingValue("document.readyState === 'complete' && !!document.querySelector('[data-site-card-layout=B]')"))) {
      if (Date.now() > onboardingReady) throw new Error('Onboarding did not load');
      await sleep(100);
    }
    await onboardingValue("document.querySelector('[data-go=\"3\"]').click()");
    assert.equal(await onboardingValue('document.body.dataset.step'), 'explore', 'site card choice belongs on Explore');
    if (process.env.WARDENONE_ONBOARDING_SCREENSHOT) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false }, onboarding.sessionId);
      await sleep(600);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, onboarding.sessionId);
      fs.writeFileSync(process.env.WARDENONE_ONBOARDING_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false }, onboarding.sessionId);
    const narrow = await onboardingValue(`(() => {
      const first = document.querySelector('[data-site-card-layout=A]').getBoundingClientRect();
      const second = document.querySelector('[data-site-card-layout=B]').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, stacked: second.top >= first.bottom };
    })()`);
    assert(!narrow.overflow && narrow.stacked, 'site card previews should stack without horizontal overflow on narrow windows');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false }, onboarding.sessionId);
    await onboardingValue("document.querySelector('[data-site-card-layout=B]').click()");
    await until("document.querySelector('[data-site-card-layout=B]').getAttribute('aria-pressed') === 'true'", 'popup follows onboarding site card choice');
    await cdp.send('Page.reload', {}, onboarding.sessionId);
    const savedChoice = Date.now() + 10000;
    while (!(await onboardingValue("document.readyState === 'complete' && document.querySelector('[data-site-card-layout=B]')?.getAttribute('aria-pressed') === 'true'"))) {
      if (Date.now() > savedChoice) throw new Error('Onboarding did not restore the site card choice');
      await sleep(100);
    }
    await onboardingValue("document.querySelector('[data-go=\"1\"]').click()");
    assert.equal(await onboardingValue("!!document.querySelector('.pin-arrow')"), false,
      'pin guidance should not guess the toolbar icon position');
    const pinSettings = await onboardingValue("typeof chrome.action.getUserSettings === 'function' ? chrome.action.getUserSettings() : null");
    if (pinSettings && typeof pinSettings.isOnToolbar === 'boolean') {
      const pinReady = Date.now() + 10000;
      while (!(await onboardingValue(`document.getElementById('pin-steps').hidden === ${pinSettings.isOnToolbar}`))) {
        if (Date.now() > pinReady) throw new Error('Pin guidance did not follow the browser state');
        await sleep(100);
      }
    }
    if (process.env.WARDENONE_PIN_SCREENSHOT) {
      await sleep(600);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, onboarding.sessionId);
      fs.writeFileSync(process.env.WARDENONE_PIN_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    await cdp.send('Target.closeTarget', { targetId: onboardingTarget.targetId });
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
    /* Count the popup's own scroll writes. Comparing scrollY alone flaked on CI: sections such as
       Script Shield and the extension alerts fill in from async data for seconds after load, and
       when one grows above the viewport the browser's scroll anchoring moves scrollY to keep the
       view still. That is not restoration pulling back, and no script writes it. */
    await value(`(() => {
      window.__woScrollWrites = 0;
      const count = (target, name) => {
        const original = target[name];
        target[name] = function () { window.__woScrollWrites++; return original.apply(this, arguments); };
      };
      for (const name of ['scrollTo', 'scroll', 'scrollBy']) { count(window, name); count(Element.prototype, name); }
      count(Element.prototype, 'scrollIntoView');
      const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true, get: top.get, set(v) { window.__woScrollWrites++; top.set.call(this, v); },
      });
      return true;
    })()`);
    const wheelDelta = maxScroll - restoredY >= restoredY ? 420 : -420;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 300, deltaX: 0, deltaY: wheelDelta }, page.sessionId);
    /* The wheel lands asynchronously; count from where it landed, not from a fixed delay. */
    await until(`scrollY !== ${restoredY}`, 'the wheel scroll to land');
    const writesAtLanding = await value('window.__woScrollWrites');
    await sleep(600);
    const writesAfter = await value('window.__woScrollWrites');
    assert.equal(writesAfter, writesAtLanding,
      `restoration must not pull against user scrolling: the popup scrolled itself ${writesAfter - writesAtLanding} time(s) after the wheel`);
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

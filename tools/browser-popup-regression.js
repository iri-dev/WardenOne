/* Exercise the actual popup and extracted modules in a disposable Edge profile. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(process.env.WARDENONE_EXTENSION_DIR || path.join(__dirname, '..'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const sitePort = await profile.freePort();
  const siteServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Memory site</title><p>Open tab</p>');
  });
  await new Promise((resolve) => siteServer.listen(sitePort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-popup-regression-'));
  let cdp;
  let page;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', ROOT, port, dir,
      ['--host-resolver-rules=MAP music-site.wardenone-smoke.com 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs?.(cdp, port, extension.id);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

    async function openPopup(storageDelay = 0) {
      const { targetId } = await cdp.send('Target.createTarget', {
        url: 'about:blank',
      });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      page = { targetId, sessionId };
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        const original = chrome.storage.session.get.bind(chrome.storage.session);
        chrome.storage.session.get = (keys, callback) => {
          if (${storageDelay} && Array.isArray(keys) && keys.includes('wardenone_popup_scroll_memory')) {
            setTimeout(() => original(keys, callback), ${storageDelay});
          } else return original(keys, callback);
        };
        const getLocal = chrome.storage.local.get.bind(chrome.storage.local);
        chrome.storage.local.get = (keys, callback) => {
          if (${storageDelay} && typeof callback === 'function' &&
              (keys === 'wardenone_config' || keys === 'wardenone_popup_section_order')) {
            setTimeout(() => getLocal(keys, callback), ${storageDelay});
          } else return getLocal(keys, callback);
        };
        window.__woPopupFrames = [];
        const sample = () => {
          if (document.body) {
            const saved = JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory') || 'null');
            const anchor = saved?.anchor;
            const anchored = anchor && (anchor.id ? document.getElementById(anchor.id) : document.querySelector('[data-key="' + anchor.key + '"]'));
            const frame = {
              y: scrollY, visible: getComputedStyle(document.body).visibility === 'visible',
              search: document.getElementById('wo-settings-search')?.value,
              providers: document.querySelector('.advanced-providers')?.open,
              anchor: anchored ? { id: anchor.id, key: anchor.key, offset: anchored.getBoundingClientRect().top } : null,
            };
            if (window.__woPopupFrames.length < 30 || frame.visible) window.__woPopupFrames.push(frame);
            if (frame.visible) return;
          }
          if (performance.now() < 10000) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })();` }, sessionId);
      await cdp.send('Page.navigate', { url: `chrome-extension://${extension.id}/popup.html` }, sessionId);
      await cdp.send('Page.bringToFront', {}, sessionId);
      try {
        await until("document.readyState === 'complete' && !!document.getElementById('wo-settings-search')", 'popup load', 30000);
      } catch (error) {
        const state = await value("({ url: location.href, readyState: document.readyState, hasSearch: !!document.getElementById('wo-settings-search') })").catch(() => null);
        throw new Error(error.message + ': ' + JSON.stringify(state));
      }
      return page;
    }
    async function value(expression) {
      const result = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      }, page.sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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
    function samePosition(saved, actual) {
      if (!saved.anchor) return Math.abs(actual.y - saved.y) < 2;
      return actual.anchor && actual.anchor.id === saved.anchor.id && actual.anchor.key === saved.anchor.key
        && Math.abs(actual.anchor.offset - saved.anchor.offset) < 2;
    }

    await openPopup();
    const reopenY = 3200;
    await value(`(() => {
      document.querySelector('.advanced-providers').open = true;
      scrollTo(0, ${reopenY});
    })()`);
    await until(`JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory'))?.y === ${reopenY} && JSON.parse(localStorage.getItem('wardenone_advanced_providers_open'))?.open`, 'scroll and disclosure recorded by their events');
    const reopenPosition = await value("JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory'))");
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
    await openPopup(1200);
    try { await until('window.__woPopupFrames.some(frame => frame.visible)', 'first visible popup frame'); }
    catch (error) {
      throw new Error(error.message + ': ' + JSON.stringify(await value("({ frames: window.__woPopupFrames, classes: document.documentElement.className, visibility: getComputedStyle(document.body).visibility, state: document.readyState, y: scrollY })")));
    }
    const firstFrames = await value('window.__woPopupFrames');
    assert(firstFrames.every(frame => frame.visible), 'delayed storage must never hide the controls');
    const firstVisible = firstFrames.find(frame => frame.visible);
    assert(samePosition(reopenPosition, firstVisible),
      'the first visible frame must show the saved position: ' + JSON.stringify({ saved: reopenPosition, frames: firstFrames }));
    assert.equal(firstVisible.providers, true, 'provider disclosure should restore before the first visible frame');
    await value("document.querySelector('.advanced-providers').open = false; scrollTo(0, 0)");
    for (const id of ['tl-max', 'tl-idle']) {
      const inspectNumber = () => value(`(() => {
        const input = document.getElementById(${JSON.stringify(id)});
        const style = getComputedStyle(input);
        const box = input.getBoundingClientRect();
        const row = input.closest('.row').getBoundingClientRect();
        return { visible: input.type === 'number'
            && style.display !== 'none' && style.visibility !== 'hidden'
            && box.width >= 65 && box.height >= 25
            && box.left >= row.left - 1 && box.right <= row.right + 1,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          row: { x: row.x, y: row.y, width: row.width, height: row.height },
          display: style.display, visibility: style.visibility,
          scrollY, innerHeight };
      })()`);
      let inspection;
      const deadline = Date.now() + 5000;
      do {
        await value(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' })`);
        inspection = await inspectNumber();
        if (inspection.visible) break;
        await sleep(100);
      } while (Date.now() < deadline);
      assert(inspection.visible, `${id} must be a visible, reachable number input inside its row: ${JSON.stringify(inspection)}`);
    }
    if (process.env.WARDENONE_MEMORY_SCREENSHOT) {
      const top = await value("document.querySelector('h2[data-feature=memoryShield]').getBoundingClientRect().top + scrollY");
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: Math.max(0, top - 5), width: 348, height: 1120, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_MEMORY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    await value("(() => { const input = document.getElementById('tl-max'); input.value = '27'; input.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config?.tabLimitMax === 27)))", 'maximum tabs to save');
    await value("(() => { const input = document.getElementById('tl-idle'); input.value = '45'; input.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config?.tabLimitMinIdleMinutes === 45)))", 'minimum inactive time to save');
    const sitePanel = await value(`(() => {
      const section = document.getElementById('site-controls-group');
      return {
        heading: section.querySelector('h2')?.textContent,
        beforeFooter: section.nextElementSibling?.classList.contains('foot'),
        inDashboard: document.getElementById('site-dash').contains(section),
        pauseChoices: [...section.querySelectorAll('.site-pause-actions button')].map((button) => button.textContent),
        override: !!section.querySelector('#site-off-pick'),
      };
    })()`);
    assert.deepEqual(sitePanel, {
      heading: 'This site', beforeFooter: true, inDashboard: false,
      pauseChoices: ['15m', '1h', '8h'], override: true,
    }, 'the bottom popup panel should offer the per-site controls directly');
    await value("eyeShieldHost = 'example.com'; paintEyeShield(); true");
    assert.equal(await value("document.querySelector('#eyeshield-scope-label').textContent"), 'All sites');
    assert.equal(await value("document.querySelector('#eyeshield-controls').hidden"), false);
    assert.equal(await value("document.querySelector('#eyeshield-host').textContent"), 'All sites brightness');
    if (process.env.WARDENONE_EYESHIELD_SCREENSHOT) {
      await value("document.getElementById('eyeshield-panel').scrollIntoView({block:'center'}); true");
      await cdp.send('Page.bringToFront', {}, page.sessionId);
      const top = await value("document.getElementById('eyeshield-title').getBoundingClientRect().top + scrollY");
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: Math.max(0, top - 6), width: 348, height: 215, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_EYESHIELD_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    assert.equal(await value("document.querySelector('.eyeshield-site-choice')"), null);
    assert.equal(await value("document.querySelector('#save')"), null);
    await value("(() => { document.querySelector('[data-eyeshield-mode=light]').click(); const range = document.querySelector('#eyeshield-brightness'); range.value = '95'; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldMode === 'light' && d.wardenone_config.eyeShieldBrightness === 95 && !d.wardenone_config.eyeShieldSites?.['example.com'])))", 'popup global controls autosaved');
    const globalEyeShield = await value("JSON.stringify({ mode: config.eyeShieldMode, brightness: config.eyeShieldBrightness, warmth: config.eyeShieldWarmth, contrast: config.eyeShieldContrast })");
    await value("document.querySelector('#eyeshield-scope-button').click(); true");
    assert.equal(await value("document.querySelector('#eyeshield-scope-menu').hidden"), false);
    if (process.env.WARDENONE_EYESHIELD_MENU_SCREENSHOT) {
      await cdp.send('Page.bringToFront', {}, page.sessionId);
      const top = await value("document.getElementById('eyeshield-title').getBoundingClientRect().top + scrollY");
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: Math.max(0, top - 6), width: 348, height: 235, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_EYESHIELD_MENU_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    await value("document.querySelector('[data-eyeshield-site=custom]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldSites?.['example.com']?.mode === 'custom')))", 'popup site Custom saved');
    assert.equal(await value("document.querySelector('#eyeshield-controls').hidden"), false);
    assert.equal(await value("document.querySelector('#eyeshield-scope-label').textContent"), 'example.com');
    assert.equal(await value("document.querySelector('#eyeshield-host').textContent"), 'example.com brightness');
    await value("(() => { document.querySelector('[data-eyeshield-mode=dark]').click(); const range = document.querySelector('#eyeshield-brightness'); range.value = '85'; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true })); const warmth = document.querySelector('#eyeshield-warmth'); warmth.value = '20'; warmth.dispatchEvent(new Event('input', { bubbles: true })); warmth.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldSites?.['example.com']?.theme === 'dark' && d.wardenone_config.eyeShieldSites['example.com'].eyeShieldBrightness === 85 && d.wardenone_config.eyeShieldSites['example.com'].eyeShieldWarmth === 20)))", 'popup custom controls autosaved');
    assert.equal(await value("JSON.stringify({ mode: config.eyeShieldMode, brightness: config.eyeShieldBrightness, warmth: config.eyeShieldWarmth, contrast: config.eyeShieldContrast })"), globalEyeShield);
    await until("document.querySelector('#eyeshield-site-status').textContent === 'Saved for example.com ✓'", 'popup site save confirmation');
    await value("document.querySelector('#eyeshield-scope-button').click(); true");
    await value("document.querySelector('[data-eyeshield-site=off]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(d.wardenone_config.eyeShieldSites?.['example.com']?.mode === 'off')))", 'popup site Off saved');
    assert.equal(await value("document.querySelector('#eyeshield-controls').hidden"), true);
    assert.equal(await value("document.querySelector('#eyeshield-off-summary').hidden"), false);
    assert.equal(await value("document.querySelector('#eyeshield-scope-label').textContent"), 'Off on example.com');
    await value("document.querySelector('#eyeshield-scope-button').click(); true");
    await value("document.querySelector('[data-eyeshield-site=inherit]').click(); true");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(!d.wardenone_config.eyeShieldSites?.['example.com'])))", 'popup site Global restored');
    assert.equal(await value("document.querySelector('#eyeshield-controls').hidden"), false);
    assert.equal(await value("document.querySelector('#eyeshield-host').textContent"), 'All sites brightness');
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
    /* Set the layout while hidden, then show and measure next frame for Edge 153. Set the popup preference too so
       concurrent repaints cannot restore layout A. */
    const nextFrame = () => value("new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve('frame'))); setTimeout(() => resolve('timer'), 250); })");
    const showCard = async (layout) => {
      await value("(() => { const section = document.getElementById('site-card'); siteCardLayout = " + JSON.stringify(layout) + ";"
        + " section.hidden = true; void section.offsetHeight;"
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
    const freshB = await value(cardBox);
    assert(freshB.layout === 'B', 'the fresh layout B card was measured in another layout: ' + JSON.stringify(freshB));
    /* Opened, filled and measured in one task. The card is repainted from storage -- a site-card
       refresh a second after any config or history change, the stored fold state on arrival --
       and on a slow runner one landed between the steps above and this measurement, hiding the
       counts again or folding the card, so the fold had nothing left to take away. */
    const cardGeometry = await value(`(() => {
      const section = document.getElementById('site-card');
      const stats = document.getElementById('site-card-stats');
      const caption = document.getElementById('site-card-caption');
      if (section.classList.contains('is-folded')) document.getElementById('site-card-fold').click();
      stats.hidden = false;
      caption.hidden = false;
      caption.textContent = 'Recent site activity';
      const expanded = section.getBoundingClientRect().height;
      document.getElementById('site-card-fold').click();
      const folded = section.getBoundingClientRect().height;
      const countsHidden = getComputedStyle(stats).display === 'none'
        && getComputedStyle(caption).display === 'none';
      const shield = document.querySelector('.head .shield').getBoundingClientRect();
      const header = document.querySelector('.head').getBoundingClientRect();
      return { expanded, folded, countsHidden, layout: section.dataset.layout, logoTop: shield.top - header.top, browser: navigator.userAgent.replace(/^.*\\) /, '') };
    })()`);
    assert(cardGeometry.expanded - cardGeometry.folded > 40,
      'folded counts card should lose its counts and caption: ' + JSON.stringify(cardGeometry));
    await showCard('A');
    const oneLine = await value(cardBox);
    assert(oneLine.layout === 'A', 'the fresh layout A card was measured in another layout: ' + JSON.stringify(oneLine));
    assert(await value("getComputedStyle(document.getElementById('site-card-state')).display !== 'none'") && cardGeometry.countsHidden,
      'folded card should keep the site status');
    assert(oneLine.offset < 2, 'fold toggle should be centered on the one-line row: ' + JSON.stringify(Object.assign({ browser: cardGeometry.browser }, oneLine)));
    /* The popup also switches layout with the card on screen, from Interface > Site card. Through
       that control, the toggle has to land where a card shown fresh in the layout has it. */
    await until('siteDashLast !== null', 'the site card summary');
    for (const [layout, fresh] of [['B', freshB], ['A', oneLine]]) {
      await value(`document.querySelector('[data-site-card-layout=${layout}]').click(); true`);
      await nextFrame();
      const live = await value(cardBox);
      assert(live.layout === layout && Math.abs(live.toggle[0] - fresh.toggle[0]) < 0.5,
        'switching to layout ' + layout + ' on screen should put the fold toggle where a fresh card has it: '
        + JSON.stringify({ browser: cardGeometry.browser, live, fresh }));
    }
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
    await value("document.getElementById('cl-section-now').open = true; document.getElementById('cl-advanced').open = true; document.getElementById('cl-record-tools').open = true;");
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
      ['Maximum tabs', '#tl-max'],
      ['Minimum inactive time', '#tl-idle'],
      ['fake phishing', 'input[data-key="detectPhishing"]'],
      ['forced popups', 'input[data-key="blockForcedPopups"]'],
    ];
    for (const [query, selector] of searches) {
      await search(query);
      assert(await visible(selector), `${query} must reveal ${selector}`);
      const hiddenControls = await value(`[...document.querySelectorAll('.row')]
        .filter(row => !row.closest('#site-dash, .wo-hidden'))
        .flatMap(row => [...row.querySelectorAll('input, select, textarea, button, [role="switch"]')]
          .filter(control => control.closest('.wo-hidden'))
          .map(control => control.id || control.getAttribute('data-key') || control.tagName))`);
      assert.deepEqual(hiddenControls, [], `${query} must keep every matching row's controls visible`);
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
    await until('window.__woPopupFrames.some(frame => frame.visible)', 'restored search first paint');
    assert.equal(await value('window.__woPopupFrames.find(frame => frame.visible).search'), 'WebAssembly',
      'the saved search must apply before controls first appear');
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
    await value(`scrollTo(0, ${Math.floor(maxScroll / 2)})`);
    await until("scrollY > 0 && JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory'))?.y === Math.round(scrollY)", 'scrolled position to record');
    const savedPosition = await value("JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory'))");
    await cdp.send('Target.closeTarget', { targetId: page.targetId });
    await openPopup();
    await until('window.__woPopupFrames.some(frame => frame.visible)', 'saved popup position first frame');
    const savedFrame = await value('window.__woPopupFrames.find(frame => frame.visible)');
    assert(samePosition(savedPosition, savedFrame),
      'the recorded position must restore before the first frame: ' + JSON.stringify({ savedPosition, savedFrame }));
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
    await value(`chrome.tabs.create({ url: 'http://music-site.wardenone-smoke.com:${sitePort}/', active: true }).then(tab => tab.id)`);
    assert.equal(await value("document.querySelectorAll('.memory-group-heading, #mem-site-never').length"), 0,
      'Memory Shield should not recreate the former mini-headings or large current-site toggle');
    await value("document.getElementById('mem-sites').open = true");
    await until("!document.getElementById('mem-site-add-current').disabled && document.getElementById('mem-site-add-current').title === 'music-site.wardenone-smoke.com'", 'current-site add action');
    await value("document.getElementById('mem-site-add-current').click()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r((d.wardenone_config?.memoryNeverSleepHosts || []).includes('music-site.wardenone-smoke.com'))))", 'site kept awake');
    await until("[...document.querySelectorAll('#mem-site-list .memory-sites-list-item')].some(row => row.textContent.includes('music-site.wardenone-smoke.com'))", 'saved site in popup manager');
    await value("[...document.querySelectorAll('#mem-site-list .memory-sites-list-item')].find(row => row.textContent.includes('music-site.wardenone-smoke.com')).querySelector('button').click()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r(!(d.wardenone_config?.memoryNeverSleepHosts || []).includes('music-site.wardenone-smoke.com'))))", 'site allowed to sleep again');
    await until("!document.getElementById('mem-site-add').disabled", 'never-sleep manager to finish removing the site');
    await value("document.getElementById('mem-site-input').value = 'https://www.youtube.com/watch?v=abc'; document.getElementById('mem-site-add').click()");
    await until("new Promise(r => chrome.storage.local.get('wardenone_config', d => r((d.wardenone_config?.memoryNeverSleepHosts || []).includes('youtube.com'))))", 'typed URL normalised to its saved host');
    await until("document.getElementById('mem-site-status').textContent.includes('youtube.com')", 'the manager to show the host it actually saved');
    assert(await value("document.getElementById('wo-build-update').hidden"), 'source copies do not show a stale-build warning');
    await value(`(() => {
      woSourceCommit = () => '${'a'.repeat(40)}';
      fetch = async (url) => ({
        ok: true, url, headers: new Headers(),
        text: async () => JSON.stringify(url.includes('/compare/')
          ? { status: 'ahead', ahead_by: 1, behind_by: 0,
              base_commit: { sha: '${'a'.repeat(40)}' }, merge_base_commit: { sha: '${'a'.repeat(40)}' } }
          : { tag_name: 'build-${'b'.repeat(40)}', target_commitish: '${'b'.repeat(40)}',
              draft: false, prerelease: false, published_at: '2026-10-10T04:01:09Z',
              assets: [{ name: 'WardenOne-latest.zip', state: 'uploaded', size: 1000 },
                { name: 'WardenOne-latest.zip.sha256', state: 'uploaded', size: 87 }] }),
      });
      return WO_BUILD_UPDATE.renderPopup();
    })()`);
    await until("!document.getElementById('wo-build-update').hidden", 'old-build popup notice');
    assert(await value("document.getElementById('wo-build-update-detail').textContent.includes('Installed aaaaaaa · Latest bbbbbbb')"));
    assert(await value("document.getElementById('wo-build-update-open').textContent.includes('update steps')"));
    if (process.env.WARDENONE_BUILD_UPDATE_SCREENSHOT) {
      await cdp.send('Page.bringToFront', {}, page.sessionId);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, width: 348, height: 280, scale: 1 }, captureBeyondViewport: true,
      }, page.sessionId);
      fs.writeFileSync(process.env.WARDENONE_BUILD_UPDATE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    if (process.env.WARDENONE_HEADLESS !== '1') {
      const previousPopup = page;
      const { targetId: focusTarget } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId: focusSession } = await cdp.send('Target.attachToTarget', { targetId: focusTarget, flatten: true });
      await cdp.send('Target.closeTarget', { targetId: previousPopup.targetId });
      const popupTab = { targetId: focusTarget, sessionId: focusSession };
      page = popupTab;
      async function openToolbarPopup() {
        await cdp.send('Page.bringToFront', {}, focusSession);
        const existing = new Set((await cdp.send('Target.getTargets')).targetInfos.map(target => target.targetId));
        const result = await cdp.send('Runtime.evaluate', {
          expression: 'chrome.action.openPopup().then(() => true)', awaitPromise: true, userGesture: true,
        }, extension.attachedSession);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        const deadline = Date.now() + 10000;
        let target;
        while (!target && Date.now() < deadline) {
          target = (await cdp.send('Target.getTargets')).targetInfos.find(item =>
            !existing.has(item.targetId) && item.url === `chrome-extension://${extension.id}/popup.html`);
          if (!target) await sleep(20);
        }
        assert(target, 'the native toolbar popup must open');
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        page = { targetId: target.targetId, sessionId };
        await until("document.readyState === 'complete' && !!document.getElementById('wo-settings-search')", 'native toolbar popup');
        assert.equal(await value('getComputedStyle(document.body).visibility'), 'visible');
      }
      async function dismissToolbarPopup() {
        const closing = page;
        await value('window.close()').catch(() => {});
        await cdp.send('Target.detachFromTarget', { sessionId: closing.sessionId }).catch(() => {});
        page = popupTab;
        await cdp.send('Page.bringToFront', {}, focusSession);
        const deadline = Date.now() + 5000;
        while ((await cdp.send('Target.getTargets')).targetInfos.some(target => target.targetId === closing.targetId)) {
          assert(Date.now() < deadline, 'the dismissed toolbar popup must close');
          await sleep(20);
        }
      }
      await openToolbarPopup();
      for (const targetY of [2800, 0]) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }, page.sessionId);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }, page.sessionId);
        await value(`chrome.storage.session.set = () => Promise.resolve(); scrollTo(0, ${targetY})`);
        await until(`JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory'))?.y === Math.round(scrollY) && ${targetY === 0 ? 'scrollY === 0' : 'scrollY > 0'}`, 'native scroll to record before dismissal');
        const remembered = await value("JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory'))");
        await dismissToolbarPopup();
        await openToolbarPopup();
        const reopened = await value(`(() => {
          const anchor = ${JSON.stringify(remembered.anchor)};
          const el = anchor && (anchor.id ? document.getElementById(anchor.id) : document.querySelector('[data-key="' + anchor.key + '"]'));
          return { y:scrollY, anchor:el ? {id:anchor.id,key:anchor.key,offset:el.getBoundingClientRect().top} : null,
            memory:JSON.parse(localStorage.getItem('wardenone_popup_scroll_memory')) };
        })()`);
        assert(samePosition(remembered, reopened),
          'native dismissal must retain the same setting in view even when asynchronous writes do not complete: ' + JSON.stringify({ remembered, reopened }));
        console.log('[ok] native toolbar popup retains scroll ' + targetY + ' after dismissal with pending storage writes');
      }
      await dismissToolbarPopup();
    } else console.log('[info] native toolbar checks require a headed browser');
    console.log('[ok] real popup controls, immediate cached rendering, search, health, diagnostics, updates and master-switch checks passed');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    siteServer.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('wo-popup-regression-')) {
      /* Edge's helper processes can hold profile files briefly after the DevTools endpoint closes. */
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn('[warn] could not remove the temporary profile: ' + error.message); }
    }
  }
}

profile.mustFinish(run, 'browser-popup-regression').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

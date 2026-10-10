/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The Settings page in Edge: the popup's section order (shared with the popup), saved sites,
   the recent-site card, and the Help and About pages.
   Run: node tools/browser-settings-arrange.js
   Like tools/browser-settings-data.js it drives Edge, so it runs in CI's real-settings-regression
   job rather than the local gate. */
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-settings-arrange-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs?.(cdp, port, extension.id);
    async function open(file) {
      const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/${file}` });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      return { targetId, sessionId };
    }
    async function value(page, expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page.sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function until(page, expression, label) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await value(page, expression)) return;
        await sleep(80);
      }
      throw new Error(`Timed out waiting for ${label}`);
    }
    const settings = await open('settings.html');
    await until(settings, "document.readyState === 'complete' && !!document.querySelector('#nav [data-go=arrange]')", 'Settings sidebar');
    assert(await value(settings, "document.querySelector('#nav [data-go=arrange]').textContent.includes('Arrange sections')"));
    await value(settings, "document.querySelector('#nav [data-go=arrange]').click()");
    await until(settings, "!!document.querySelector('#pane #ord-list')", 'Arrange page');
    if (process.env.WARDENONE_SETTINGS_ARRANGE_SCREENSHOT) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false }, settings.sessionId);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, settings.sessionId);
      fs.writeFileSync(process.env.WARDENONE_SETTINGS_ARRANGE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }
    assert(await value(settings, "document.querySelector('#nav [data-go=arrange]').getAttribute('aria-current') === 'page'"));
    const defaults = await value(settings, "[...document.querySelectorAll('#ord-list .ord-item')].map(el => el.dataset.id)");
    const popup = await open('popup.html');
    await until(popup, "document.readyState === 'complete' && !!document.getElementById('arrange-open')", 'popup');
    const popupDefaults = await value(popup, 'POPUP_SECTION_DEFAULT');
    assert.deepEqual(defaults, popupDefaults, 'Settings lists the popup sections in the same default order');
    await value(settings, "document.querySelector('#ord-list .ord-item .ord-move[data-dir=\"1\"]').click()");
    const swapped = [defaults[1], defaults[0], ...defaults.slice(2)];
    assert.deepEqual(await value(settings, "[...document.querySelectorAll('#ord-list .ord-item')].map(el => el.dataset.id)"), swapped);
    await until(settings, `new Promise(resolve => chrome.storage.local.get('wardenone_popup_section_order', data => resolve(data.wardenone_popup_section_order?.[0] === ${JSON.stringify(defaults[1])})))`, 'saved arrow move');
    const popupEpoch = await value(popup, 'performance.timeOrigin');
    await cdp.send('Page.reload', {}, popup.sessionId);
    /* The popup lays out its default order first and applies the saved one when storage answers;
       on a slow runner the list was opened before it had. */
    await until(popup, `performance.timeOrigin > ${popupEpoch} && document.readyState === 'complete' && !!document.getElementById('arrange-open')`
      + ` && popupSectionRuns()[0] && popupSectionRuns()[0].id === ${JSON.stringify(defaults[1])}`, 'reopened popup in the saved order');
    await value(popup, "document.getElementById('arrange-open').click()");
    assert.equal(await value(popup, "document.querySelector('#arrange-list .arrange-item').dataset.id"), defaults[1], 'popup follows Settings order');
    const settingsEpoch = await value(settings, 'performance.timeOrigin');
    await cdp.send('Page.reload', {}, settings.sessionId);
    await until(settings, `performance.timeOrigin > ${settingsEpoch} && document.readyState === 'complete' && !!document.querySelector('#nav [data-go=arrange]')`, 'reopened Settings');
    assert.equal(await value(settings, "document.querySelector('#nav [aria-current=page]')?.dataset.go"), 'arrange', 'reload keeps the selected Settings page');
    await value(settings, "document.querySelector('#nav [data-go=arrange]').click()");
    await until(settings, `document.querySelector('#ord-list .ord-item')?.dataset.id === ${JSON.stringify(defaults[1])}`, 'restored Settings order');
    await value(settings, "document.getElementById('ord-reset').click()");
    const points = await value(settings, `(() => {
      const rows = [...document.querySelectorAll('#ord-list .ord-item')];
      const name = rows[0].querySelector('.ord-name').getBoundingClientRect();
      const next = rows[1].getBoundingClientRect();
      return { x: Math.round(name.left + name.width / 2), from: Math.round(name.top + name.height / 2), to: Math.round(next.bottom - 3) };
    })()`);
    await cdp.send('Page.bringToFront', {}, settings.sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.x, y: points.from, button: 'left', buttons: 1, clickCount: 1 }, settings.sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.x, y: points.to, button: 'left', buttons: 1 }, settings.sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.x, y: points.to, button: 'left', buttons: 0, clickCount: 1 }, settings.sessionId);
    await until(settings, `document.querySelector('#ord-list .ord-item').dataset.id === ${JSON.stringify(defaults[1])}`, 'mouse row drag');
    await value(settings, "document.getElementById('ord-reset').click()");
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, settings.sessionId);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points.x, y: points.from, id: 1 }] }, settings.sessionId);
    await sleep(140);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: points.x, y: points.to, id: 1 }] }, settings.sessionId);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, settings.sessionId);
    await until(settings, `document.querySelector('#ord-list .ord-item').dataset.id === ${JSON.stringify(defaults[1])}`, 'touch row drag');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, settings.sessionId);
    await value(settings, "document.getElementById('ord-reset').click()");
    await until(settings, "new Promise(resolve => chrome.storage.local.get('wardenone_popup_section_order', data => resolve(!data.wardenone_popup_section_order)))", 'reset order');
    await value(settings, "document.querySelector('#nav [data-go=help]').click()");
    assert(await value(settings, "document.querySelector('#nav [data-go=help]').getAttribute('aria-current') === 'page'"));
    assert(await value(settings, "document.querySelector('#pane h2').textContent === 'Help & feedback'"));
    assert(await value(settings, "document.querySelector('#pane h3').textContent === 'How can I help?'"));
    const helpEpoch = await value(settings, 'performance.timeOrigin');
    await cdp.send('Page.reload', {}, settings.sessionId);
    await until(settings, `performance.timeOrigin > ${helpEpoch} && document.readyState === 'complete' && document.querySelector('#nav [aria-current=page]')?.dataset.go === 'help'`, 'Help page reload');
    assert(await value(settings, "document.querySelector('#pane h3').textContent === 'How can I help?'"));
    assert.equal(await value(settings, "[...document.querySelectorAll('#pane a.info-link')].filter(a => a.href.includes('issues/new?template=')).length"), 2,
      'bug and feature actions open their own guided forms');
    assert(await value(settings, "[...document.querySelectorAll('#pane a.info-link:not([href^=\"mailto:\"])')].every(a => a.target === '_blank' && a.rel.includes('noopener'))"));
    assert.equal(await value(settings, "document.querySelector('#pane a[href^=\"mailto:\"]').href"), 'mailto:iri.devsupport@gmail.com');
    assert.equal(await value(settings, "document.querySelector('[data-copy-discord]').dataset.copyDiscord"), 'iri.dev');
    if (process.env.WARDENONE_SETTINGS_INFO_DIR) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, settings.sessionId);
      fs.writeFileSync(path.join(process.env.WARDENONE_SETTINGS_INFO_DIR, 'help-preview.png'), Buffer.from(shot.data, 'base64'));
    }
    await value(settings, "document.querySelector('#nav [data-go=about]').click()");
    assert(await value(settings, "document.querySelector('#nav [data-go=about]').getAttribute('aria-current') === 'page'"));
    const aboutEpoch = await value(settings, 'performance.timeOrigin');
    await cdp.send('Page.reload', {}, settings.sessionId);
    await until(settings, `performance.timeOrigin > ${aboutEpoch} && document.readyState === 'complete' && document.querySelector('#nav [aria-current=page]')?.dataset.go === 'about'`, 'About page reload');
    const reopened = await open('settings.html');
    await until(reopened, "document.readyState === 'complete' && document.querySelector('#nav [aria-current=page]')?.dataset.go === 'about'", 'new Settings tab restores About');
    await cdp.send('Target.closeTarget', { targetId: reopened.targetId });
    assert.equal(await value(settings, "document.querySelector('.about-version').textContent"), `Version ${version}`);
    assert(await value(settings, "document.querySelector('.about-maker').textContent.includes('Built by iri.dev')"));
    const aboutLinks = await value(settings, "[...document.querySelectorAll('#pane .info-link')].map(a => a.href)");
    for (const file of ['PRIVACY.md', 'LICENSE', 'CREDITS.md']) assert(aboutLinks.some((href) => href.endsWith('/' + file)), file + ' link');
    assert.equal(await value(settings, "document.querySelector('.about-maker a').href"), 'https://github.com/iri-dev');
    assert(await value(settings, "document.querySelector('.about-page').textContent.includes('phishing and scams')"));
    await until(settings, "document.querySelector('#wo-build-status')?.dataset.state === 'local'", 'local source build status');
    assert.equal(await value(settings, "document.querySelector('#wo-build-status').textContent"), 'Local source copy');
    assert(await value(settings, "document.querySelector('#wo-build-check').disabled"));
    assert.equal(await value(settings, "document.querySelector('.about-build-actions a').href"), 'https://github.com/iri-dev/WardenOne/releases/latest');
    assert.equal(await value(settings, "document.querySelectorAll('.about-build-steps li').length"), 3);
    if (process.env.WARDENONE_SETTINGS_INFO_DIR) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, settings.sessionId);
      fs.writeFileSync(path.join(process.env.WARDENONE_SETTINGS_INFO_DIR, 'about-preview.png'), Buffer.from(shot.data, 'base64'));
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false }, settings.sessionId);
    const narrow = await value(settings, "({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute').slice(0, 8).map(el => ({ tag: el.tagName, className: el.getAttribute('class'), right: Math.round(el.getBoundingClientRect().right) })) })");
    assert(narrow.scroll <= narrow.width + 1, 'About page fits a narrow window: ' + JSON.stringify(narrow));
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, settings.sessionId);
    await value(settings, "document.querySelector('#nav [data-go=sites]').click()");
    await until(settings, "!siteState.loading", 'saved site lists');
    if (process.env.WARDENONE_SETTINGS_FIX_DIR) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, settings.sessionId);
      fs.writeFileSync(path.join(process.env.WARDENONE_SETTINGS_FIX_DIR, 'sites-current.png'), Buffer.from(shot.data, 'base64'));
    }
    assert(await value(settings, "document.querySelector('#pane').textContent.includes('No sites blocked by you.')"));
    assert(await value(settings, "!document.querySelector('#pane').textContent.includes('example-casino.net')"));
    assert(await value(settings, "!document.querySelector('#pane').textContent.includes('bank.co.uk')"));
    await value(settings, "backgroundCall({ kind: 'blocklist-add', pattern: 'tiktok.com', scope: 'forever' })");
    await value(settings, "loadSites()");
    assert(await value(settings, "document.querySelector('#pane').textContent.includes('tiktok.com')"));
    await value(settings, "document.querySelector('#pane [data-site-source=blocked][data-site-action=remove]').click()");
    await until(settings, "!document.querySelector('#pane').textContent.includes('tiktok.com')", 'blocked site removal');
    await value(settings, "backgroundCall({ kind: 'script-trust-add', host: 'example.com' })");
    await value(settings, "loadSites()");
    assert(await value(settings, "document.querySelector('#pane').textContent.includes('example.com')"));
    await value(settings, "document.querySelector('#pane [data-site-source=trusted][data-site-action=remove]').click()");
    await until(settings, "document.querySelector('#pane').textContent.includes('No trusted script sites saved.')", 'trusted site removal');
    await value(settings, "(async () => { const stored = await localRead('wardenone_config'); await localWrite({ wardenone_config: { ...(stored.wardenone_config || {}), allowlist: ['example.com'] } }); await loadSites(); })()");
    await until(settings, "document.querySelector('#pane [data-site-source=paused]')?.dataset.siteId === 'example.com'", 'paused site row');
    await value(settings, "document.querySelector('#pane [data-site-source=paused][data-site-action=remove]').click()");
    await until(settings, "document.querySelector('#pane').textContent.includes('No sites paused.')", 'paused site removal');
    const website = await cdp.send('Target.createTarget', { url: 'https://www.twitch.tv/' });
    await until(settings, "chrome.tabs.query({}).then(tabs => tabs.some(tab => String(tab.url).includes('twitch.tv')))", 'Twitch tab URL');
    await cdp.send('Page.bringToFront', {}, settings.sessionId);
    await value(settings, "loadPreview()");
    await until(settings, "previewState.status === 'ready' && previewState.host.includes('twitch.tv')", 'Twitch preview');
    assert(await value(settings, "document.querySelector('#rail').textContent.includes('twitch.tv')"));
    assert(await value(settings, "!document.querySelector('#rail').textContent.includes('youtube.com')"));
    assert(await value(settings, "[...document.querySelectorAll('#rail .stat b')].every((el, i) => Number(el.textContent) === [previewState.activity.trackers, previewState.activity.ads, previewState.activity.other][i])"));
    if (process.env.WARDENONE_SETTINGS_FIX_DIR) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, settings.sessionId);
      fs.writeFileSync(path.join(process.env.WARDENONE_SETTINGS_FIX_DIR, 'preview-current.png'), Buffer.from(shot.data, 'base64'));
    }
    await cdp.send('Target.closeTarget', { targetId: website.targetId });
    console.log('[ok] Settings uses saved sites and recent website activity; Help and About work in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('wo-settings-arrange-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
profile.mustFinish(run, 'browser-settings-arrange').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

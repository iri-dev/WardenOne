/* The real Edge content-script boundary, with local generic-preview and YouTube fixtures. */
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-resource-saver-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--autoplay-policy=no-user-gesture-required']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const extTarget = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/popup.html` });
    const ext = await cdp.send('Target.attachToTarget', { targetId: extTarget.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, ext.sessionId);
    const pageTarget = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const page = await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
    await cdp.send('Page.enable', {}, page.sessionId);
    await cdp.send('Runtime.enable', {}, page.sessionId);

    async function value(expression, sessionId = page.sessionId) {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    async function until(expression, label) {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        try { if (await value(expression)) return; } catch (_) {}
        await sleep(80);
      }
      const state = await value("({ url: location.href, generic: !!window.__woGenericFixture, youtube: !!window.__woYouTubeFixture, ambient: document.querySelector('#cinematics') && getComputedStyle(document.querySelector('#cinematics')).display, blur: document.querySelector('#frosted-glass') && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter, preview: document.querySelector('ytd-video-preview') && getComputedStyle(document.querySelector('ytd-video-preview')).display, previewPaused: document.querySelector('#preview-video') && document.querySelector('#preview-video').paused, cardPaused: document.querySelector('#card-preview') && document.querySelector('#card-preview').paused })").catch(() => null);
      const config = await value("chrome.storage.local.get('wardenone_config').then(data => ({ enabled: data.wardenone_config?.enabled, ambient: data.wardenone_config?.disableYouTubeAmbientMode, previews: data.wardenone_config?.stopAnimatedVideoPreviews }))", ext.sessionId).catch(() => null);
      throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify({ state, config }));
    }
    const setPreferences = (ambient, previews, master = true) => value(`chrome.storage.local.get('wardenone_config').then(data =>
      chrome.storage.local.set({ wardenone_config: { ...data.wardenone_config, enabled: ${master}, disableYouTubeAmbientMode: ${ambient}, stopAnimatedVideoPreviews: ${previews} } }).then(() => true))`, ext.sessionId);
    await until.call(null, "document.readyState === 'complete'", 'blank page');
    await setPreferences(true, true);

    const video = fs.readFileSync(path.join(root, 'spotify-silent-1s.mp4')).toString('base64');
    const genericFixture = '<!doctype html><title>General preview fixture</title><a href="/opened"><video id="card-preview" muted autoplay playsinline src="data:video/mp4;base64,' + video + '"></video></a>'
      + '<div class="video-player"><video id="normal-player" muted controls loop src="data:video/mp4;base64,' + video + '"></video></div>'
      + '<a href="/audible"><video id="audible-card" autoplay playsinline src="data:video/mp4;base64,' + video + '"></video></a>'
      + '<a href="/manual"><video id="manual-card" muted src="data:video/mp4;base64,' + video + '"></video></a><script>window.__woGenericFixture = true</script>';
    const youtubeFixture = '<!doctype html><title>YouTube resource fixture</title><ytd-app style="--yt-spec-base-background:#17131c"><div id="frosted-glass" style="background:rgba(15,15,15,.8);backdrop-filter:blur(48px)"></div><ytd-watch-flexy><div id="cinematics"></div></ytd-watch-flexy><ytd-video-preview-loader><ytd-video-preview><ytd-player id="inline-player" context="WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_INLINE_PREVIEW">'
      + '<video id="preview-video" muted loop autoplay src="data:video/mp4;base64,' + video + '"></video></ytd-player></ytd-video-preview></ytd-video-preview-loader>'
      + '<div id="player"><video id="watch-video" muted loop controls src="data:video/mp4;base64,' + video + '"></video></div></ytd-app><script>window.__woYouTubeFixture = true</script>';
    const off = cdp.on((event) => {
      if (event.sessionId !== page.sessionId || event.method !== 'Fetch.requestPaused') return;
      const fixture = event.params.request.url.includes('www.youtube.com') ? youtubeFixture : genericFixture;
      void cdp.send('Fetch.fulfillRequest', {
        requestId: event.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(fixture).toString('base64'),
      }, page.sessionId);
    });
    await cdp.send('Fetch.enable', { patterns: [
      { urlPattern: '*://preview.example/*', resourceType: 'Document' },
      { urlPattern: '*://www.youtube.com/*', resourceType: 'Document' },
    ] }, page.sessionId);

    await cdp.send('Page.navigate', { url: 'https://preview.example/feed' }, page.sessionId);
    await until("window.__woGenericFixture && document.querySelector('#card-preview').paused", 'a general muted card preview to stop');
    assert.equal(await value("document.querySelector('#normal-player').play().then(() => true, () => false)"), true,
      'a normal player with controls can start');
    await until("!document.querySelector('#normal-player').paused", 'normal controlled playback');
    assert.equal(await value("document.querySelector('#audible-card').play().then(() => true, () => false)"), true,
      'an audible inline video is not guessed to be a preview');
    await until("!document.querySelector('#audible-card').paused", 'audible inline playback');
    assert.equal(await value("document.querySelector('#manual-card').play().then(() => true, () => false)"), true,
      'a manually started card video is left alone');
    await until("!document.querySelector('#manual-card').paused", 'manual card playback');
    await setPreferences(true, false);
    await until("document.querySelector('#card-preview').play().then(() => new Promise(resolve => setTimeout(() => resolve(!document.querySelector('#card-preview').paused), 120)), () => false)",
      'general preview playback after live reversal');
    await setPreferences(true, true);
    await value("document.querySelector('#card-preview').play().catch(() => {})");
    await until("document.querySelector('#card-preview').paused", 'the general preview control to return live');

    await cdp.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=wardenone-test' }, page.sessionId);
    await until("window.__woYouTubeFixture && getComputedStyle(document.querySelector('#cinematics')).display === 'none' && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter === 'none' && getComputedStyle(document.querySelector('ytd-video-preview')).display === 'none'", 'YouTube resource styles');
    assert.equal(await value("getComputedStyle(document.querySelector('#frosted-glass')).backgroundColor"), 'rgb(23, 19, 28)',
      'the frosted header follows the active YouTube or EyeShield background');
    assert.equal(await value("document.querySelector('#watch-video').play().then(() => true, () => false)"), true,
      'the watch-page video still plays');
    await until("!document.querySelector('#watch-video').paused", 'watch-page playback');
    await value("document.querySelector('#preview-video').play().catch(() => {})");
    await until("document.querySelector('#preview-video').paused", 'an inline preview play attempt to be stopped');

    await setPreferences(false, false);
    await until("getComputedStyle(document.querySelector('#cinematics')).display !== 'none' && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter !== 'none'", 'YouTube Ambient Mode styles to return');
    await until("getComputedStyle(document.querySelector('ytd-video-preview')).display !== 'none'", 'the preview layer to return when its setting is off');
    assert.equal(await value("document.querySelector('#preview-video').play().then(() => true, () => false)"), true,
      'preview playback can resume when the setting is off');
    await until("!document.querySelector('#preview-video').paused", 'preview playback after live reversal');
    await setPreferences(true, true, false);
    await until("getComputedStyle(document.querySelector('#cinematics')).display !== 'none' && getComputedStyle(document.querySelector('ytd-video-preview')).display !== 'none'", 'the disabled master switch to leave YouTube unchanged');
    await setPreferences(true, true, true);
    await until("getComputedStyle(document.querySelector('#cinematics')).display === 'none' && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter === 'none' && getComputedStyle(document.querySelector('ytd-video-preview')).display === 'none'", 'the master switch to restore both resource controls');
    assert.equal(await value("!document.querySelector('#watch-video').paused"), true,
      'the ordinary watch player remains active through resource-setting changes');
    off();
    console.log('[ok] Edge Resource Saver fixture: general previews, player compatibility, YouTube Ambient Mode and live reversal');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('wo-resource-saver-')) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

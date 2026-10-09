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
    /* A timeout reports where a settings change stopped: when the test wrote it, what the worker
       saw and sent (and to which tabs), and whether the page applied anything. */
    const marks = [];
    const mark = (label) => marks.push([Date.now() % 100000, label]);
    async function workerValue(expression) {
      if (!extension.attachedSession) return 'no worker session';
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, extension.attachedSession);
      if (result.exceptionDetails) return 'worker error: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    mark('instrument ' + await workerValue(`(() => {
      const log = self.__woRsDiag = [];
      const now = () => Date.now() % 100000;
      const push = (entry) => { log.push(entry); if (log.length > 80) log.shift(); };
      const send = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = function (tabId, message, ...rest) {
        if (message && message.kind === 'resource-saver-update') {
          const entry = { t: now(), send: tabId, previews: message.previews };
          push(entry);
          const last = rest.length - 1;
          if (last >= 0 && typeof rest[last] === 'function') {
            const callback = rest[last];
            rest[last] = function () { entry.done = now(); entry.error = chrome.runtime.lastError ? chrome.runtime.lastError.message : ''; return callback.apply(this, arguments); };
          }
        }
        return send.call(this, tabId, message, ...rest);
      };
      const query = chrome.tabs.query;
      chrome.tabs.query = function (filter, callback) {
        const note = (tabs) => push({ t: now(), query: (tabs || []).map((tab) => tab.id + ' ' + String(tab.url || '').slice(0, 40) + ' ' + tab.status) });
        if (typeof callback === 'function') return query.call(this, filter, (tabs) => { note(tabs); return callback(tabs); });
        return query.call(this, filter).then((tabs) => { note(tabs); return tabs; });
      };
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.wardenone_config) return;
        const before = changes.wardenone_config.oldValue || {};
        const after = changes.wardenone_config.newValue || {};
        const record = changes.wardenone_config_writes && changes.wardenone_config_writes.newValue;
        push({ t: now(), change: [before.stopAnimatedVideoPreviews, after.stopAnimatedVideoPreviews], by: record ? record.keys : 'unrecorded' });
      });
      return 'ok';
    })()`).catch((error) => 'failed ' + error.message));
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
      const state = await value("({ url: location.href, generic: !!window.__woGenericFixture, youtube: !!window.__woYouTubeFixture, frames: !!window.__woFrameFixture, ambient: document.querySelector('#cinematics') && getComputedStyle(document.querySelector('#cinematics')).display, blur: document.querySelector('#frosted-glass') && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter, preview: document.querySelector('ytd-video-preview') && getComputedStyle(document.querySelector('ytd-video-preview')).display, previewPaused: document.querySelector('#preview-video') && document.querySelector('#preview-video').paused, cardPaused: document.querySelector('#card-preview') && document.querySelector('#card-preview').paused, cardAutoplay: document.querySelector('#card-preview') && document.querySelector('#card-preview').autoplay, cardAutoplayAttribute: document.querySelector('#card-preview') && document.querySelector('#card-preview').hasAttribute('autoplay'), cardEnded: document.querySelector('#card-preview') && document.querySelector('#card-preview').ended, blankFramePaused: document.querySelector('#blank-frame')?.contentDocument?.querySelector('#frame-preview')?.paused, srcdocFramePaused: document.querySelector('#srcdoc-frame')?.contentDocument?.querySelector('#frame-preview')?.paused })").catch(() => null);
      const config = await value("chrome.storage.local.get('wardenone_config').then(data => ({ enabled: data.wardenone_config?.enabled, ambient: data.wardenone_config?.disableYouTubeAmbientMode, previews: data.wardenone_config?.stopAnimatedVideoPreviews }))", ext.sessionId).catch(() => null);
      const pageStyle = await value("!!document.querySelector('style[data-wardenone-resource-saver=\"previews\"]')").catch(() => null);
      const worker = await workerValue('JSON.stringify(self.__woRsDiag || null)').catch((error) => 'unreadable ' + error.message);
      const tabs = await workerValue("chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id + ' ' + String(tab.url || '').slice(0, 40) + ' ' + tab.status)).then(JSON.stringify)").catch(() => null);
      mark('timeout');
      throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify({ state, config, pageStyle, marks, tabs, worker }));
    }
    /* Saved the way every WardenOne surface saves: under the config lock, with its save record.
       Written straight to storage, the change raced the extension's own locked saves and could be
       wiped 18 ms later by one that had read before it. */
    for (const deadline = Date.now() + 12000; Date.now() < deadline; await sleep(80)) {
      if (await value("document.readyState === 'complete' && typeof withConfigLock === 'function' && typeof stampConfigWrite === 'function'", ext.sessionId).catch(() => false)) break;
    }
    const setPreferences = (ambient, previews, master = true) => {
      mark('set previews=' + previews);
      return value(`withConfigLock(async () => {
        const data = await chrome.storage.local.get(['wardenone_config', WO_CONFIG_WRITES_KEY]);
        const stamp = stampConfigWrite(data[WO_CONFIG_WRITES_KEY], ['enabled', 'disableYouTubeAmbientMode', 'stopAnimatedVideoPreviews']);
        await chrome.storage.local.set({ wardenone_config: { ...data.wardenone_config, enabled: ${master}, disableYouTubeAmbientMode: ${ambient}, stopAnimatedVideoPreviews: ${previews} },
          [WO_CONFIG_WRITES_KEY]: stamp.record });
        return true;
      })`, ext.sessionId);
    };
    await until.call(null, "document.readyState === 'complete'", 'blank page');
    await setPreferences(true, true);

    const video = fs.readFileSync(path.join(root, 'spotify-silent-1s.mp4')).toString('base64');
    const childFixture = '<!doctype html><a href="/child"><video id="frame-preview" muted autoplay loop playsinline src="data:video/mp4;base64,' + video + '"></video></a>';
    const escapedChildFixture = childFixture.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const frameFixture = '<!doctype html><title>Inherited frame fixture</title><iframe id="blank-frame" src="about:blank"></iframe><iframe id="srcdoc-frame" srcdoc="' + escapedChildFixture + '"></iframe><script>'
      + 'const frame=document.querySelector("#blank-frame");setTimeout(()=>{const doc=frame.contentDocument;const link=doc.createElement("a");link.href="/child";const preview=doc.createElement("video");preview.id="frame-preview";preview.muted=true;preview.autoplay=true;preview.loop=true;preview.playsInline=true;preview.src=' + JSON.stringify('data:video/mp4;base64,' + video) + ';link.appendChild(preview);doc.body.appendChild(link);window.__woBlankReady=true},250);window.__woFrameFixture=true;</script>';
    const genericFixture = '<!doctype html><title>General preview fixture</title><a href="/opened"><video id="card-preview" muted autoplay loop playsinline src="data:video/mp4;base64,' + video + '"></video></a>'
      + '<div class="video-player"><video id="normal-player" muted controls loop src="data:video/mp4;base64,' + video + '"></video></div>'
      + '<a href="/audible"><video id="audible-card" autoplay playsinline src="data:video/mp4;base64,' + video + '"></video></a>'
      + '<a href="/manual"><video id="manual-card" muted src="data:video/mp4;base64,' + video + '"></video></a>'
      + '<a href="/manual-inline"><video id="manual-inline-card" muted playsinline src="data:video/mp4;base64,' + video + '"></video></a>'
      + '<a href="/manual-loop"><video id="manual-loop-card" muted loop src="data:video/mp4;base64,' + video + '"></video></a><script>window.__woGenericFixture = true</script>';
    const youtubeFixture = '<!doctype html><title>YouTube resource fixture</title><ytd-app style="--yt-spec-base-background:#17131c"><div id="frosted-glass" style="background:rgba(15,15,15,.8);backdrop-filter:blur(48px)"></div><ytd-watch-flexy><div id="cinematics-container"><div id="cinematics"></div></div></ytd-watch-flexy><ytd-video-preview-loader><ytd-video-preview><ytd-player id="inline-player" context="WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_INLINE_PREVIEW">'
      + '<video id="preview-video" muted loop autoplay src="data:video/mp4;base64,' + video + '"></video></ytd-player></ytd-video-preview></ytd-video-preview-loader>'
      + '<div id="player"><video id="watch-video" muted loop controls src="data:video/mp4;base64,' + video + '"></video></div></ytd-app><script>window.__woYouTubeFixture = true</script>';
    const off = cdp.on((event) => {
      if (event.sessionId !== page.sessionId || event.method !== 'Fetch.requestPaused') return;
      const requestUrl = event.params.request.url;
      const fixture = requestUrl.includes('www.youtube.com') ? youtubeFixture
        : requestUrl.includes('frames.example') ? frameFixture : genericFixture;
      void cdp.send('Fetch.fulfillRequest', {
        requestId: event.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(fixture).toString('base64'),
      }, page.sessionId);
    });
    await cdp.send('Fetch.enable', { patterns: [
      { urlPattern: '*://preview.example/*', resourceType: 'Document' },
      { urlPattern: '*://frames.example/*', resourceType: 'Document' },
      { urlPattern: '*://www.youtube.com/*', resourceType: 'Document' },
    ] }, page.sessionId);

    await sleep(1500);
    await cdp.send('Page.navigate', { url: 'https://frames.example/children' }, page.sessionId);
    await until("window.__woFrameFixture && window.__woBlankReady && document.querySelector('#blank-frame').contentDocument.querySelector('#frame-preview').paused && !document.querySelector('#blank-frame').contentDocument.querySelector('#frame-preview').autoplay && !document.querySelector('#blank-frame').contentDocument.querySelector('#frame-preview').hasAttribute('autoplay') && document.querySelector('#srcdoc-frame').contentDocument.querySelector('#frame-preview').paused && !document.querySelector('#srcdoc-frame').contentDocument.querySelector('#frame-preview').autoplay && !document.querySelector('#srcdoc-frame').contentDocument.querySelector('#frame-preview').hasAttribute('autoplay')", 'about:blank and srcdoc frames to receive their initial Resource Saver state');
    await setPreferences(true, false);
    await cdp.send('Page.navigate', { url: 'https://preview.example/feed' }, page.sessionId);
    await until("window.__woGenericFixture && !document.querySelector('#card-preview').paused && document.querySelector('#card-preview').autoplay && document.querySelector('#card-preview').hasAttribute('autoplay')", 'the original general preview to autoplay');
    await setPreferences(true, true);
    await until("document.querySelector('#card-preview').paused && !document.querySelector('#card-preview').autoplay && !document.querySelector('#card-preview').hasAttribute('autoplay')", 'a general muted card preview to stop');
    assert.equal(await value("document.querySelector('#normal-player').play().then(() => true, () => false)"), true,
      'a normal player with controls can start');
    await until("!document.querySelector('#normal-player').paused", 'normal controlled playback');
    assert.equal(await value("document.querySelector('#audible-card').play().then(() => true, () => false)"), true,
      'an audible inline video is not guessed to be a preview');
    await until("!document.querySelector('#audible-card').paused", 'audible inline playback');
    assert.equal(await value("document.querySelector('#manual-card').play().then(() => true, () => false)"), true,
      'a manually started card video is left alone');
    await until("!document.querySelector('#manual-card').paused", 'manual card playback');
    assert.equal(await value("document.querySelector('#manual-inline-card').play().then(() => true, () => false)"), true,
      'playsinline alone does not make a user-started card video a preview');
    await until("!document.querySelector('#manual-inline-card').paused", 'manual playsinline card playback');
    assert.equal(await value("document.querySelector('#manual-loop-card').play().then(() => true, () => false)"), true,
      'loop alone does not make a user-started card video a preview');
    await until("!document.querySelector('#manual-loop-card').paused", 'manual looping card playback');
    await setPreferences(true, false);
    await until("document.querySelector('#card-preview').autoplay && document.querySelector('#card-preview').hasAttribute('autoplay') && !document.querySelector('#card-preview').paused",
      'the general preview autoplay state to restore without page help');
    await setPreferences(true, true);
    await value("document.querySelector('#card-preview').play().catch(() => {})");
    await until("document.querySelector('#card-preview').paused", 'the general preview control to return live');

    await cdp.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=wardenone-test' }, page.sessionId);
    await until("window.__woYouTubeFixture && getComputedStyle(document.querySelector('#cinematics')).display === 'none' && getComputedStyle(document.querySelector('#cinematics-container')).display === 'none' && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter === 'none' && getComputedStyle(document.querySelector('ytd-video-preview')).display === 'none'", 'YouTube resource styles');
    assert.equal(await value("getComputedStyle(document.querySelector('#frosted-glass')).backgroundColor"), 'rgb(23, 19, 28)',
      'the frosted header follows the active YouTube or EyeShield background');
    assert.equal(await value("document.querySelector('#watch-video').play().then(() => true, () => false)"), true,
      'the watch-page video still plays');
    await until("!document.querySelector('#watch-video').paused", 'watch-page playback');
    await value("document.querySelector('#preview-video').play().catch(() => {})");
    await until("document.querySelector('#preview-video').paused", 'an inline preview play attempt to be stopped');

    assert.equal(await value("(() => { const active = document.querySelector('style[data-wardenone-resource-saver=\"ambient\"]'); if (!active) return false; const legacy = active.cloneNode(true); legacy.removeAttribute('data-wardenone-resource-saver'); const duplicate = active.cloneNode(true); document.documentElement.append(legacy, duplicate); window.__woLegacyAmbientStyle = legacy; window.__woDuplicateAmbientStyle = duplicate; return true; })()"), true,
      'the active Ambient Mode rule is marked for reliable live removal');
    await setPreferences(false, false);
    await until("getComputedStyle(document.querySelector('#cinematics')).display !== 'none' && getComputedStyle(document.querySelector('#cinematics-container')).display !== 'none' && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter !== 'none' && !window.__woLegacyAmbientStyle.isConnected && !window.__woDuplicateAmbientStyle.isConnected && !document.querySelector('style[data-wardenone-resource-saver=\"ambient\"]')", 'all YouTube Ambient Mode styles to be removed and the original styling to return');
    await until("getComputedStyle(document.querySelector('ytd-video-preview')).display !== 'none'", 'the preview layer to return when its setting is off');
    await until("document.querySelector('#preview-video').autoplay && document.querySelector('#preview-video').hasAttribute('autoplay') && !document.querySelector('#preview-video').paused",
      'YouTube preview playback and autoplay state to restore without page help');
    await setPreferences(true, true, false);
    await until("getComputedStyle(document.querySelector('#cinematics')).display !== 'none' && getComputedStyle(document.querySelector('ytd-video-preview')).display !== 'none'", 'the disabled master switch to leave YouTube unchanged');
    await setPreferences(true, true, true);
    await until("getComputedStyle(document.querySelector('#cinematics')).display === 'none' && getComputedStyle(document.querySelector('#frosted-glass')).backdropFilter === 'none' && getComputedStyle(document.querySelector('ytd-video-preview')).display === 'none'", 'the master switch to restore both resource controls');
    assert.equal(await value("!document.querySelector('#watch-video').paused"), true,
      'the ordinary watch player remains active through resource-setting changes');
    off();
    if (process.env.WO_RS_DIAG === '1') {
      console.log(JSON.stringify({ marks, worker: await workerValue('JSON.stringify(self.__woRsDiag || null)') }));
    }
    console.log('[ok] Edge Resource Saver fixture: inherited frames, general previews, player compatibility, YouTube Ambient Mode and live reversal');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('wo-resource-saver-')) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('resource-saver.js');
const manifest = JSON.parse(read('manifest.json'));
const entry = manifest.content_scripts.find((script) => (script.js || []).includes('resource-saver.js'));
assert(entry && entry.run_at === 'document_start' && entry.all_frames === true && entry.world !== 'MAIN',
  'preview saving must run early in the isolated world of every page frame');
assert.deepEqual(entry.matches, ['<all_urls>']);
assert.equal(entry.match_origin_as_fallback, true);
assert.equal(entry.match_about_blank, true);

let reply;
let update;
let stateRequests = 0;
const listeners = {};
const styles = [];
const makeVideo = (kind, options = {}) => ({
  tagName: 'VIDEO', paused: false, autoplay: options.autoplay !== false, loop: !!options.loop,
  playsInline: !!options.playsInline, muted: options.muted !== false, defaultMuted: false,
  controls: !!options.controls, pauses: 0, removed: [], attrs: new Set(options.attrs || ['autoplay', 'muted']),
  closest(selector) {
    if (kind === 'explicit' && selector.includes('ytd-video-preview')) return {};
    if (kind === 'player' && selector.includes('ytd-watch-flexy #player')) return {};
    if (kind === 'card' && selector.includes('a[href]')) return {};
    return null;
  },
  hasAttribute(name) { return this.attrs.has(name); },
  removeAttribute(name) { this.removed.push(name); this.attrs.delete(name); },
  pause() { this.paused = true; this.pauses++; },
});
const youtubePreview = makeVideo('explicit');
const cardPreview = makeVideo('card', { playsInline: true });
const watchVideo = makeVideo('player', { controls: true });
const audibleCardVideo = makeVideo('card', { muted: false, attrs: ['autoplay'] });
const manualCardVideo = makeVideo('card', { autoplay: false, muted: true, attrs: ['muted'] });
const document = {
  documentElement: { appendChild(node) { node.isConnected = true; styles.push(node); } },
  createElement(tag) {
    assert.equal(tag, 'style');
    return { isConnected: false, textContent: '', remove() { this.isConnected = false; } };
  },
  addEventListener(type, callback) { listeners[type] = callback; },
  querySelectorAll(selector) {
    assert.equal(selector, 'video');
    return [youtubePreview, cardPreview, watchVideo, audibleCardVideo, manualCardVideo];
  },
};
const chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      assert.deepEqual(JSON.parse(JSON.stringify(message)), { kind: 'resource-saver-state' });
      stateRequests++;
      reply = callback;
    },
    onMessage: { addListener(callback) { update = callback; } },
  },
};
vm.runInNewContext(source, { chrome, document, String });
assert.equal(styles.length, 0, 'nothing changes before the worker answers');
reply({ ok: true, ambient: false, previews: false });
assert.equal(styles.length, 0, 'the preview control defaults to leaving pages alone');

update({ kind: 'resource-saver-update', ambient: true, previews: true });
assert.equal(styles.length, 2);
assert.match(styles[0].textContent, /ytd-watch-flexy #cinematics \{ display: none !important; \}/,
  'the watch-page Ambient Mode glow is hidden');
assert.match(styles[0].textContent, /#frosted-glass \{[^}]*backdrop-filter: none !important;/,
  'the home header stops blurring thumbnail colours');
assert.match(styles[0].textContent, /background-color: var\(--yt-spec-base-background, #fff\)/,
  'the cleared header follows the active YouTube or EyeShield background');
assert.match(styles[0].textContent, /:root\[dark\][^}]*#0f0f0f/,
  'native dark mode has a safe background fallback');
assert.equal(styles[1].textContent, 'ytd-video-preview,ytd-video-preview-loader { display: none !important; }',
  'the preview layer is hidden while static thumbnails remain outside it');
assert.equal(youtubePreview.pauses, 1, 'an existing YouTube inline preview is stopped');
assert.equal(cardPreview.pauses, 1, 'a muted automatic preview inside a navigation card is stopped');
assert.equal(youtubePreview.autoplay, false);
assert.deepEqual(youtubePreview.removed, ['autoplay']);
assert.equal(watchVideo.pauses, 0, 'a normal player is not stopped');
assert.equal(audibleCardVideo.pauses, 0, 'an audible inline video is not guessed to be a preview');
assert.equal(manualCardVideo.pauses, 0, 'a manually started card video is left alone');

const replay = makeVideo('card', { playsInline: true });
listeners.play({ target: replay });
assert.equal(replay.pauses, 1, 'a later preview or restart is paused from its play event');
watchVideo.paused = false;
listeners.play({ target: watchVideo });
assert.equal(watchVideo.pauses, 0, 'a normal YouTube video play event passes through');

update({ kind: 'resource-saver-update', ambient: false, previews: false });
assert.equal(styles[0].isConnected, false, 'turning Ambient Mode blocking off restores YouTube styling immediately');
assert.equal(styles[1].isConnected, false, 'turning preview blocking off restores the preview layer immediately');
const restored = makeVideo('card', { playsInline: true });
listeners.play({ target: restored });
assert.equal(restored.pauses, 0, 'preview playback is left alone again after live reversal');
update({ kind: 'unrelated', ambient: true, previews: true });
assert.equal(styles[0].isConnected, false, 'unrelated worker messages are ignored');
assert.equal(stateRequests, 1, 'the runtime reads trusted state once and receives later changes from the worker');

const background = read('background.js');
const popup = read('popup.html') + read('popup.js');
const settings = read('settings.js');
const profile = read('build-profile.js');
assert(/stopAnimatedVideoPreviews: false/.test(background), 'the worker default is off');
assert(/disableYouTubeAmbientMode: false/.test(background), 'the Ambient Mode control defaults off');
assert(/kind === 'resource-saver-state'/.test(background) && /disableYouTubeAmbientMode === true/.test(background) && /stopAnimatedVideoPreviews === true/.test(background),
  'the worker derives both resource preferences from trusted storage');
assert(/data-key="disableYouTubeAmbientMode"/.test(popup), 'the popup exposes the Ambient Mode control');
assert(/data-key="stopAnimatedVideoPreviews"/.test(popup), 'the popup exposes the general preview control');
assert(/sw\([^\n]+disableYouTubeAmbientMode[^\n]+stopAnimatedVideoPreviews/.test(settings), 'Settings exposes both resource controls');
assert(profile.includes("'disableYouTubeAmbientMode'") && profile.includes("'stopAnimatedVideoPreviews'") && profile.includes("'resource-saver.js'"),
  'the Store profile carries both settings and their runtime');
assert(!/HTMLMediaElement\.prototype/.test(source), 'the targeted feature does not replace the global media API');
assert(!/MutationObserver/.test(source), 'the saver does not trade previews for a page-wide DOM observer');

console.log('[ok] Resource Saver preview detection and playback compatibility tests passed');

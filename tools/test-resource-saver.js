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
let videoQueries = 0;
let nextTimerId = 1;
let previewStates = null;
const listeners = {};
const styles = [];
const timers = new Map();
class PreviewStateMap extends Map {
  constructor() {
    super();
    previewStates = this;
  }
}
function runTimer(delay) {
  const found = Array.from(timers.entries()).find((entry) => entry[1].active && entry[1].delay === delay);
  assert(found, 'expected a pending ' + delay + 'ms timer');
  found[1].active = false;
  found[1].callback();
}
const makeStyle = () => ({
  isConnected: false,
  textContent: '',
  attrs: new Map(),
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; },
  setAttribute(name, value) { this.attrs.set(name, String(value)); },
  remove() { this.isConnected = false; },
});
const makeVideo = (kind, options = {}) => ({
  tagName: 'VIDEO', paused: options.paused === true, autoplay: options.autoplay !== false, loop: !!options.loop,
  playsInline: !!options.playsInline, muted: options.muted !== false, defaultMuted: false,
  controls: !!options.controls, isConnected: options.isConnected !== false, pauses: 0, plays: 0,
  removed: [], attrs: new Map((options.attrs || ['autoplay', 'muted']).map((name) => [name, ''])),
  closest(selector) {
    if (kind === 'explicit' && selector.includes('ytd-video-preview')) return {};
    if (kind === 'player' && selector.includes('ytd-watch-flexy #player')) return {};
    if (kind === 'card' && selector.includes('a[href]')) return {};
    return null;
  },
  hasAttribute(name) { return this.attrs.has(name); },
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; },
  setAttribute(name, value) { this.attrs.set(name, String(value)); },
  removeAttribute(name) { this.removed.push(name); this.attrs.delete(name); },
  pause() { this.paused = true; this.pauses++; },
  play() { this.paused = false; this.plays++; return Promise.resolve(); },
});
const youtubePreview = makeVideo('explicit');
const cardPreview = makeVideo('card', { playsInline: true });
const watchVideo = makeVideo('player', { controls: true });
const audibleCardVideo = makeVideo('card', { muted: false, attrs: ['autoplay'] });
const manualCardVideo = makeVideo('card', { autoplay: false, muted: true, attrs: ['muted'] });
const manualInlineCardVideo = makeVideo('card', { autoplay: false, muted: true, paused: true, playsInline: true, attrs: ['muted', 'playsinline'] });
const manualLoopCardVideo = makeVideo('card', { autoplay: false, muted: true, paused: true, loop: true, attrs: ['muted', 'loop'] });
const queuedCardPreview = makeVideo('card', { playsInline: true, paused: true });
const document = {
  documentElement: { appendChild(node) { node.isConnected = true; styles.push(node); } },
  createElement(tag) {
    assert.equal(tag, 'style');
    return makeStyle();
  },
  addEventListener(type, callback) { listeners[type] = callback; },
  querySelectorAll(selector) {
    if (selector === 'style') return styles.filter((style) => style.isConnected);
    assert.equal(selector, 'video');
    videoQueries++;
    return [youtubePreview, cardPreview, watchVideo, audibleCardVideo, manualCardVideo,
      manualInlineCardVideo, manualLoopCardVideo, queuedCardPreview];
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
vm.runInNewContext(source, {
  chrome,
  document,
  Map: PreviewStateMap,
  String,
  setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay, active: true });
    return id;
  },
  clearTimeout(id) {
    const timer = timers.get(id);
    if (timer) timer.active = false;
  },
});
assert.equal(styles.length, 0, 'nothing changes before the worker answers');
update({ kind: 'resource-saver-update', ambient: true, previews: true });
assert.equal(styles.length, 2);
reply({ ok: true, ambient: false, previews: false });
assert.equal(styles[0].isConnected, true, 'a stale initial reply cannot undo a newer Ambient Mode update');
assert.equal(styles[1].isConnected, true, 'a stale initial reply cannot undo newer preview blocking');
assert.equal(cardPreview.paused, true, 'a stale initial reply cannot restore a preview stopped by the live update');
assert.equal(videoQueries, 1, 'a stale initial reply is discarded without another document sweep');
assert.match(styles[0].textContent, /ytd-watch-flexy #cinematics,ytd-watch-flexy #cinematics-container \{ display: none !important; \}/,
  'the watch-page Ambient Mode glow is hidden');
assert.match(styles[0].textContent, /#frosted-glass \{[^}]*backdrop-filter: none !important;/,
  'the home header stops blurring thumbnail colours');
assert.match(styles[0].textContent, /background-color: var\(--yt-spec-base-background, #fff\)/,
  'the cleared header follows the active YouTube or EyeShield background');
assert.match(styles[0].textContent, /:root\[dark\][^}]*#0f0f0f/,
  'native dark mode has a safe background fallback');
assert.equal(styles[0].getAttribute('data-wardenone-resource-saver'), 'ambient',
  'the Ambient Mode style is identifiable for complete live removal');
assert.equal(styles[1].getAttribute('data-wardenone-resource-saver'), 'previews',
  'the preview style is identifiable for complete live removal');
assert.equal(styles[1].textContent, 'ytd-video-preview,ytd-video-preview-loader { display: none !important; }',
  'the preview layer is hidden while static thumbnails remain outside it');
assert.equal(videoQueries, 1, 'enabling preview blocking performs one document video sweep');
update({ kind: 'resource-saver-update', ambient: true, previews: true });
assert.equal(videoQueries, 1, 'reliable duplicate broadcasts do not repeat the document video sweep');
assert.equal(youtubePreview.pauses, 1, 'an existing YouTube inline preview is stopped');
assert.equal(cardPreview.pauses, 1, 'a muted automatic preview inside a navigation card is stopped');
assert.equal(youtubePreview.autoplay, false);
assert.equal(youtubePreview.hasAttribute('autoplay'), false);
assert.deepEqual(youtubePreview.removed, ['autoplay']);
assert.equal(watchVideo.pauses, 0, 'a normal player is not stopped');
assert.equal(audibleCardVideo.pauses, 0, 'an audible inline video is not guessed to be a preview');
assert.equal(manualCardVideo.pauses, 0, 'a manually started card video is left alone');
manualInlineCardVideo.play();
listeners.play({ target: manualInlineCardVideo });
assert.equal(manualInlineCardVideo.paused, false, 'playsinline alone does not turn a user-started card video into a preview');
assert.equal(manualInlineCardVideo.pauses, 0);
manualLoopCardVideo.play();
listeners.play({ target: manualLoopCardVideo });
assert.equal(manualLoopCardVideo.paused, false, 'loop alone does not turn a user-started card video into a preview');
assert.equal(manualLoopCardVideo.pauses, 0);
assert.equal(queuedCardPreview.pauses, 0, 'a preview that was already paused is not paused again');
assert.equal(queuedCardPreview.autoplay, false, 'a queued autoplay preview is still neutralised');
cardPreview.play();
listeners.play({ target: cardPreview });
assert.equal(cardPreview.paused, true, 'a recognised preview stays blocked after WardenOne removes its autoplay marker');
assert.equal(cardPreview.pauses, 2);

const replay = makeVideo('card', { playsInline: true });
listeners.play({ target: replay });
assert.equal(replay.pauses, 1, 'a later preview or restart is paused from its play event');

const detachedPreviews = Array.from({ length: 8 }, () => makeVideo('card'));
const retainedBeforeDetach = previewStates.size;
detachedPreviews.forEach((video) => {
  listeners.play({ target: video });
  video.isConnected = false;
});
assert.equal(previewStates.size, retainedBeforeDetach + 8, 'the fixture records each changed detached preview before cleanup');
runTimer(15000);
assert(detachedPreviews.every((video) => video.autoplay && video.hasAttribute('autoplay')),
  'periodic cleanup restores and releases detached preview videos without waiting for more insertions');
assert.equal(previewStates.size, retainedBeforeDetach, 'detached preview references are removed by the scheduled cleanup');
watchVideo.paused = false;
listeners.play({ target: watchVideo });
assert.equal(watchVideo.pauses, 0, 'a normal YouTube video play event passes through');

const legacyAmbientStyle = makeStyle();
legacyAmbientStyle.textContent = styles[0].textContent.replace(
  'ytd-watch-flexy #cinematics,ytd-watch-flexy #cinematics-container',
  'ytd-watch-flexy #cinematics',
);
document.documentElement.appendChild(legacyAmbientStyle);
const duplicateAmbientStyle = makeStyle();
duplicateAmbientStyle.textContent = 'stale Ambient Mode rule';
duplicateAmbientStyle.setAttribute('data-wardenone-resource-saver', 'ambient');
document.documentElement.appendChild(duplicateAmbientStyle);
update({ kind: 'resource-saver-update', ambient: false, previews: false });
assert.equal(styles[0].isConnected, false, 'turning Ambient Mode blocking off restores YouTube styling immediately');
assert.equal(legacyAmbientStyle.isConnected, false, 'the off path removes an unmarked legacy copy of WardenOne\'s exact Ambient Mode rule');
assert.equal(duplicateAmbientStyle.isConnected, false, 'the off path removes duplicate marked Ambient Mode rules');
assert.equal(styles[1].isConnected, false, 'turning preview blocking off restores the preview layer immediately');
assert.equal(youtubePreview.autoplay, true, 'the original autoplay property is restored');
assert.equal(youtubePreview.hasAttribute('autoplay'), true, 'the original autoplay attribute is restored');
assert.equal(youtubePreview.paused, false, 'a preview WardenOne stopped resumes without a page reload');
assert.equal(youtubePreview.plays, 1, 'a stopped preview is resumed once');
assert.equal(cardPreview.autoplay, true);
assert.equal(cardPreview.paused, false);
assert.equal(replay.autoplay, true);
assert.equal(replay.paused, false, 'a later preview stopped from its play event is restored too');
assert.equal(queuedCardPreview.autoplay, true, 'a paused preview regains its original autoplay configuration');
assert.equal(queuedCardPreview.hasAttribute('autoplay'), true);
assert.equal(queuedCardPreview.paused, true, 'a preview that was already paused is not unexpectedly started');
assert.equal(queuedCardPreview.plays, 0);
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
const resourceStateHandler = background.slice(
  background.indexOf("if (msg && msg.kind === 'resource-saver-state'"),
  background.indexOf("if (msg && msg.kind === 'content-config-get'"),
);
assert(/stopAnimatedVideoPreviews: false/.test(background), 'the worker default is off');
assert(/disableYouTubeAmbientMode: false/.test(background), 'the Ambient Mode control defaults off');
assert(/kind === 'resource-saver-state'/.test(background) && /disableYouTubeAmbientMode === true/.test(background) && /stopAnimatedVideoPreviews === true/.test(background),
  'the worker derives both resource preferences from trusted storage');
assert(/messageSenderIsTab\(sender\)/.test(resourceStateHandler) && !/sender\.url|page\.protocol/.test(resourceStateHandler),
  'trusted content scripts in inherited and non-HTTP frames receive the initial Resource Saver state');
assert(/'resource-saver-state': \{ max: 500, windowMs: 60000 \}/.test(background),
  'the per-tab limit leaves room for frame-heavy pages to read their initial state');
{
  const listener = background.slice(background.indexOf('chrome.storage.onChanged.addListener'));
  assert(listener.indexOf('broadcastResourceSaverState(afterResourceSaver)') >= 0
    && listener.indexOf('broadcastResourceSaverState(afterResourceSaver)') < listener.indexOf('scheduleContentConfigRefresh()'),
    'live Resource Saver state is sent before unrelated refresh work can fail on an older browser');
}
assert(/data-key="disableYouTubeAmbientMode"/.test(popup), 'the popup exposes the Ambient Mode control');
assert(/data-key="stopAnimatedVideoPreviews"/.test(popup), 'the popup exposes the general preview control');
assert(/sw\([^\n]+disableYouTubeAmbientMode[^\n]+stopAnimatedVideoPreviews/.test(settings), 'Settings exposes both resource controls');
assert(profile.includes("'disableYouTubeAmbientMode'") && profile.includes("'stopAnimatedVideoPreviews'") && profile.includes("'resource-saver.js'"),
  'the Store profile carries both settings and their runtime');
assert(!read('eyeshield-sites.js').includes('#cinematics-container'),
  'EyeShield leaves Ambient Mode ownership to the dedicated Resource Saver control');
assert(!/HTMLMediaElement\.prototype/.test(source), 'the targeted feature does not replace the global media API');
assert(!/MutationObserver/.test(source), 'the saver does not trade previews for a page-wide DOM observer');

console.log('[ok] Resource Saver preview detection and playback compatibility tests passed');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  let ambientStyle = null;
  let previewStyle = null;
  let ambientEnabled = false;
  let previewsEnabled = false;
  let refreshNumber = 0;

  const EXPLICIT_PREVIEW = [
    'ytd-video-preview',
    'ytd-player#inline-player',
    'ytd-player[context*="INLINE_PREVIEW"]',
    '[data-video-preview]',
    '[data-preview-video]',
    '[class*="video-preview" i]',
    '[class*="video_preview" i]',
    '[class*="videopreview" i]',
    '[class*="animated-thumbnail" i]',
    '[class*="hover-video" i]',
    '[id*="video-preview" i]',
    '[aria-label*="video preview" i]',
  ].join(',');
  const FULL_PLAYER = [
    'ytd-watch-flexy #player',
    '#movie_player',
    'video-js',
    'media-player',
    '[class*="video-player" i]',
    '[class*="video_player" i]',
    '[id*="video-player" i]',
    '[role="dialog"]',
  ].join(',');

  function attachStyle(current, css) {
    const root = document.documentElement;
    if (!root) return current;
    let style = current;
    if (!style) {
      style = document.createElement('style');
      style.textContent = css;
    }
    if (!style.isConnected) root.appendChild(style);
    return style;
  }

  function previewVideo(video) {
    if (!video || String(video.tagName || '').toUpperCase() !== 'VIDEO') return false;
    try {
      if (video.closest(EXPLICIT_PREVIEW)) return true;
      if (video.controls || video.closest(FULL_PLAYER)) return false;
      const muted = video.muted || video.defaultMuted || video.hasAttribute('muted');
      const automatic = video.autoplay || video.loop || video.playsInline
        || video.hasAttribute('autoplay') || video.hasAttribute('loop') || video.hasAttribute('playsinline');
      return !!(muted && automatic && video.closest('a[href],button,[role="link"],[role="button"]'));
    } catch (_) { return false; }
  }

  function stopPreviewVideo(video) {
    if (!previewsEnabled || !previewVideo(video)) return;
    try { video.autoplay = false; } catch (_) {}
    try { video.removeAttribute('autoplay'); } catch (_) {}
    try { if (!video.paused && typeof video.pause === 'function') video.pause(); } catch (_) {}
  }

  function sweepPreviews(root) {
    if (!previewsEnabled || !root) return;
    if (String(root.tagName || '').toUpperCase() === 'VIDEO') stopPreviewVideo(root);
    try { root.querySelectorAll('video').forEach(stopPreviewVideo); } catch (_) {}
  }

  function paintPreviews() {
    if (!previewsEnabled) {
      if (previewStyle) previewStyle.remove();
      return;
    }
    previewStyle = attachStyle(previewStyle,
      'ytd-video-preview,ytd-video-preview-loader { display: none !important; }');
    sweepPreviews(document);
  }

  function paintAmbient() {
    if (!ambientEnabled) {
      if (ambientStyle) ambientStyle.remove();
      return;
    }
    ambientStyle = attachStyle(ambientStyle,
      'ytd-watch-flexy #cinematics { display: none !important; }'
      + 'ytd-app #frosted-glass { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; background-color: var(--yt-spec-base-background, #fff) !important; }'
      + ':root[dark] ytd-app #frosted-glass { background-color: var(--yt-spec-base-background, #0f0f0f) !important; }');
  }

  function apply(state) {
    ambientEnabled = !!state && state.ambient === true;
    previewsEnabled = !!state && state.previews === true;
    paintAmbient();
    paintPreviews();
  }

  function refresh() {
    const number = ++refreshNumber;
    chrome.runtime.sendMessage({ kind: 'resource-saver-state' }, (result) => {
      if (number !== refreshNumber) return;
      apply(!chrome.runtime.lastError && result && result.ok === true ? result : null);
    });
  }

  document.addEventListener('DOMContentLoaded', () => { paintAmbient(); paintPreviews(); }, { once: true });
  document.addEventListener('play', (event) => stopPreviewVideo(event && event.target), true);
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.kind !== 'resource-saver-update') return;
    refreshNumber++;
    apply(message);
  });
  refresh();
})();

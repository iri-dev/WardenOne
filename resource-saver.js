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
  let stateApplied = false;
  let refreshNumber = 0;
  let previewCleanupTimer = null;
  const changedPreviews = new Map();
  const PREVIEW_CLEANUP_MS = 15000;
  const STYLE_MARKER = 'data-wardenone-resource-saver';
  const LEGACY_AMBIENT_CSS = 'ytd-watch-flexy #cinematics { display: none !important; }'
    + 'ytd-app #frosted-glass { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; background-color: var(--yt-spec-base-background, #fff) !important; }'
    + ':root[dark] ytd-app #frosted-glass { background-color: var(--yt-spec-base-background, #0f0f0f) !important; }';
  const AMBIENT_CSS = 'ytd-watch-flexy #cinematics,ytd-watch-flexy #cinematics-container { display: none !important; }'
    + 'ytd-app #frosted-glass { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; background-color: var(--yt-spec-base-background, #fff) !important; }'
    + ':root[dark] ytd-app #frosted-glass { background-color: var(--yt-spec-base-background, #0f0f0f) !important; }';
  const PREVIEW_CSS = 'ytd-video-preview,ytd-video-preview-loader { display: none !important; }';

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

  function matchingStyles(kind, css) {
    const matches = [];
    try {
      document.querySelectorAll('style').forEach((style) => {
        const marker = typeof style.getAttribute === 'function' ? style.getAttribute(STYLE_MARKER) : '';
        const text = String(style.textContent || '');
        if (marker === kind || text === css || (kind === 'ambient' && text === LEGACY_AMBIENT_CSS)) matches.push(style);
      });
    } catch (_) {}
    return matches;
  }

  function removeStyles(current, kind, css) {
    const matches = matchingStyles(kind, css);
    if (current && !matches.includes(current)) matches.push(current);
    matches.forEach((style) => {
      try { style.remove(); } catch (_) {}
    });
    return null;
  }

  function attachStyle(current, kind, css) {
    const root = document.documentElement;
    if (!root) return current;
    const matches = matchingStyles(kind, css);
    let style = current && current.isConnected ? current : matches.shift();
    if (!style) {
      style = document.createElement('style');
    }
    try { style.setAttribute(STYLE_MARKER, kind); } catch (_) {}
    style.textContent = css;
    matches.filter((candidate) => candidate !== style).forEach((candidate) => {
      try { candidate.remove(); } catch (_) {}
    });
    if (!style.isConnected) root.appendChild(style);
    return style;
  }

  function previewVideo(video, remembered) {
    if (!video || String(video.tagName || '').toUpperCase() !== 'VIDEO') return false;
    try {
      if (video.closest(EXPLICIT_PREVIEW)) return true;
      if (video.controls || video.closest(FULL_PLAYER)) return false;
      const muted = video.muted || video.defaultMuted || video.hasAttribute('muted');
      const automatic = remembered || video.autoplay || video.hasAttribute('autoplay');
      return !!(muted && automatic && video.closest('a[href],button,[role="link"],[role="button"]'));
    } catch (_) { return false; }
  }

  function cleanDetachedPreviews() {
    changedPreviews.forEach((state, video) => {
      if (video.isConnected !== false) return;
      changedPreviews.delete(video);
      restorePreview(video, state);
    });
  }

  function schedulePreviewCleanup() {
    if (previewCleanupTimer !== null || !previewsEnabled || !changedPreviews.size) return;
    previewCleanupTimer = setTimeout(() => {
      previewCleanupTimer = null;
      cleanDetachedPreviews();
      schedulePreviewCleanup();
    }, PREVIEW_CLEANUP_MS);
  }

  function stopPreviewCleanup() {
    if (previewCleanupTimer === null) return;
    clearTimeout(previewCleanupTimer);
    previewCleanupTimer = null;
  }

  function stopPreviewVideo(video) {
    let original = changedPreviews.get(video);
    if (!previewsEnabled || !previewVideo(video, !!original)) return;
    if (!original) {
      let hadAutoplayAttribute = false;
      let autoplayAttribute = '';
      try {
        hadAutoplayAttribute = video.hasAttribute('autoplay');
        if (hadAutoplayAttribute) autoplayAttribute = video.getAttribute('autoplay') || '';
      } catch (_) {}
      original = {
        autoplay: !!video.autoplay,
        hadAutoplayAttribute,
        autoplayAttribute,
        wasPlaying: video.paused === false,
      };
      changedPreviews.set(video, original);
      schedulePreviewCleanup();
    } else if (video.paused === false) {
      original.wasPlaying = true;
    }
    try { video.autoplay = false; } catch (_) {}
    try { video.removeAttribute('autoplay'); } catch (_) {}
    try { if (!video.paused && typeof video.pause === 'function') video.pause(); } catch (_) {}
  }

  function restorePreview(video, original) {
    try { video.autoplay = original.autoplay; } catch (_) {}
    try {
      if (original.hadAutoplayAttribute) video.setAttribute('autoplay', original.autoplayAttribute);
      else video.removeAttribute('autoplay');
    } catch (_) {}
    if (!original.wasPlaying || video.isConnected === false || typeof video.play !== 'function') return;
    try {
      const started = video.play();
      if (started && typeof started.catch === 'function') started.catch(() => {});
    } catch (_) {}
  }

  function restorePreviews() {
    stopPreviewCleanup();
    const changed = Array.from(changedPreviews.entries());
    changedPreviews.clear();
    changed.forEach(([video, original]) => restorePreview(video, original));
  }

  function sweepPreviews(root) {
    if (!previewsEnabled || !root) return;
    if (String(root.tagName || '').toUpperCase() === 'VIDEO') stopPreviewVideo(root);
    try { root.querySelectorAll('video').forEach(stopPreviewVideo); } catch (_) {}
  }

  function paintPreviews() {
    if (!previewsEnabled) {
      previewStyle = removeStyles(previewStyle, 'previews', PREVIEW_CSS);
      restorePreviews();
      return;
    }
    previewStyle = attachStyle(previewStyle, 'previews', PREVIEW_CSS);
    sweepPreviews(document);
  }

  function paintAmbient() {
    if (!ambientEnabled) {
      ambientStyle = removeStyles(ambientStyle, 'ambient', AMBIENT_CSS);
      return;
    }
    ambientStyle = attachStyle(ambientStyle, 'ambient', AMBIENT_CSS);
  }

  function apply(state) {
    const nextAmbient = !!state && state.ambient === true;
    const nextPreviews = !!state && state.previews === true;
    const firstState = !stateApplied;
    const ambientChanged = nextAmbient !== ambientEnabled;
    const previewsChanged = nextPreviews !== previewsEnabled;
    stateApplied = true;
    ambientEnabled = nextAmbient;
    previewsEnabled = nextPreviews;
    if (firstState || ambientChanged) paintAmbient();
    if (firstState || previewsChanged) paintPreviews();
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

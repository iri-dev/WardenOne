/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Spotify Web Player ad blocker.
 *
 * Spotify serves songs and audio ads through overlapping first-party media
 * infrastructure. Blocking those hosts outright can stop the player at the
 * next ad break, so this module follows the Chromium-safe technique maintained
 * by uBlock Origin's uAssets: only tracks whose own playback metadata identifies
 * a spotify:ad URI have their MP3 candidates replaced with a short silent MP4.
 * Ordinary tracks, episodes and podcast media are never classified by hostname
 * or duration. A current-player DOM signal supplies a mute-only fail-safe if the
 * response shape changes before the filter can be updated.
 */
(function wardenOneSpotifyAdblock() {
  'use strict';

  const VERSION = '1.0.1';
  const SPOTIFY_HOST_RE = /^open\.spotify\.com$/i;
  if (!SPOTIFY_HOST_RE.test(String(location.hostname || ''))) return;
  if (window.__wardenOneSpotifyAdblockReady === VERSION) return;
  if (window.__wardenOneSpotifyAdblockReady) {
    try {
      if (typeof window.__wardenOneSpotifyAdblockDispose === 'function') {
        window.__wardenOneSpotifyAdblockDispose();
      }
    } catch (_) {}
  }

  const SILENT_MP4 = 'data:video/mp4;base64,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';
  const TRACK_PLAYBACK_RE = /\/track-playback(?:\/|[?#]|$)/i;
  const AD_URI_RE = /^spotify:ad:/i;
  const ACTIVE_AD_SELECTOR = [
    '[data-testid="context-item-info-ad-subtitle"]',
    '[data-testid="now-playing-bar"] a[data-context-item-type="ad"]',
    '[data-testid="now-playing-widget"] a[data-context-item-type="ad"]'
  ].join(',');
  const AD_COSMETIC_SELECTOR = [
    '#leaderboard-ad-element',
    'a[data-context-item-type="ad"]',
    'div[aria-label="Advertisement"]',
    '[data-testid="context-item-info-ad-subtitle"]',
    '[data-testid="ad-banner"]',
    '[data-testid="billboard-ad"]'
  ].join(',');

  const nativeFetch = window.fetch;
  const nativeRegExpTest = RegExp.prototype.test;
  const NativeHeaders = window.Headers;
  const NativeResponse = window.Response;
  let enabled = true;
  let disposed = false;
  let bridgeToken = '';
  let observer = null;
  let muteTimer = 0;
  const listeners = [];
  const mutedAudio = new Set();
  const audioState = new WeakMap();

  const style = document.createElement('style');
  style.id = 'wo-spotify-adblock-css';
  style.textContent = AD_COSMETIC_SELECTOR +
    '{display:none!important;visibility:hidden!important;pointer-events:none!important;}';

  function on(target, type, listener, options) {
    try {
      target.addEventListener(type, listener, options);
      listeners.push([target, type, listener, options]);
    } catch (_) {}
  }

  function mountStyle() {
    if (disposed || style.isConnected) return;
    try {
      const root = document.head || document.documentElement;
      if (root) root.appendChild(style);
    } catch (_) {}
  }

  function requestUrl(input) {
    try {
      return typeof input === 'string' ? input : String(input && input.url || input || '');
    } catch (_) {
      return '';
    }
  }

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function isAdTrack(track) {
    try {
      return isObject(track) && isObject(track.metadata) &&
        AD_URI_RE.test(String(track.metadata.uri || ''));
    } catch (_) {
      return false;
    }
  }

  function rewriteAdTrack(track) {
    if (!isAdTrack(track)) return false;
    let changed = false;
    try {
      const manifest = track.manifest;
      const candidates = manifest && manifest.file_urls_mp3;
      if (!Array.isArray(candidates)) return false;
      for (const candidate of candidates) {
        if (!isObject(candidate)) continue;
        if (candidate.file_id !== 1) {
          candidate.file_id = 1;
          changed = true;
        }
        if (candidate.file_url !== SILENT_MP4) {
          candidate.file_url = SILENT_MP4;
          changed = true;
        }
      }
    } catch (_) {}
    return changed;
  }

  function rewriteTrackPlayback(payload) {
    try {
      const stateMachine = payload && payload.state_machine;
      const tracks = stateMachine && stateMachine.tracks;
      if (!isObject(tracks)) return false;
      const values = Array.isArray(tracks) ? tracks : Object.keys(tracks).map((key) => tracks[key]);
      let changed = false;
      for (const track of values) changed = rewriteAdTrack(track) || changed;
      return changed;
    } catch (_) {
      return false;
    }
  }

  async function rewriteResponse(response) {
    if (!enabled || !response || typeof response.clone !== 'function') return response;
    try {
      const payload = await response.clone().json();
      if (!enabled || disposed) return response;
      const changed = rewriteTrackPlayback(payload);
      if (!changed) return response;
      const headers = new NativeHeaders(response.headers || undefined);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new NativeResponse(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    } catch (_) {
      return response;
    }
  }

  function spotifyFetch(input) {
    const url = requestUrl(input);
    const promise = Reflect.apply(nativeFetch, this, arguments);
    if (!enabled || !TRACK_PLAYBACK_RE.test(url)) return promise;
    return Promise.resolve(promise).then(rewriteResponse);
  }

  function spotifyRegExpTest(value) {
    const args = Array.from(arguments);
    if (enabled && args[0] === SILENT_MP4) args[0] = 'https://';
    return Reflect.apply(nativeRegExpTest, this, args);
  }

  function restoreMutedAudio() {
    for (const audio of Array.from(mutedAudio)) {
      try {
        const state = audioState.get(audio);
        if (state && audio.muted === true) audio.muted = state.muted;
      } catch (_) {}
      mutedAudio.delete(audio);
    }
  }

  function activeAdIsPlaying() {
    if (!enabled) return false;
    try {
      return !!document.querySelector(ACTIVE_AD_SELECTOR);
    } catch (_) {
      return false;
    }
  }

  function syncAdMute() {
    muteTimer = 0;
    if (enabled) mountStyle();
    if (disposed || !activeAdIsPlaying()) {
      restoreMutedAudio();
      return;
    }
    try {
      const players = document.querySelectorAll('audio');
      for (const audio of players) {
        if (!audioState.has(audio)) audioState.set(audio, { muted: audio.muted === true });
        mutedAudio.add(audio);
        audio.muted = true;
      }
    } catch (_) {}
  }

  function scheduleAdMute() {
    if (disposed || muteTimer) return;
    muteTimer = setTimeout(syncAdMute, 80);
  }

  function setEnabled(next) {
    enabled = next !== false;
    style.disabled = !enabled;
    if (!enabled) restoreMutedAudio();
    else {
      mountStyle();
      scheduleAdMute();
    }
  }

  window.fetch = spotifyFetch;
  RegExp.prototype.test = spotifyRegExpTest;
  mountStyle();
  on(document, 'readystatechange', mountStyle);
  on(document, 'play', scheduleAdMute, true);
  on(document, 'loadedmetadata', scheduleAdMute, true);
  on(document, 'emptied', scheduleAdMute, true);
  on(window, 'message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.source === 'wardenone-handshake' && typeof message.token === 'string' && !bridgeToken) {
      bridgeToken = message.token;
      return;
    }
    if (message.source !== 'wardenone' || message.kind !== 'config' ||
        !bridgeToken || message.token !== bridgeToken) return;
    const config = message.overrides || {};
    setEnabled(config.enabled !== false && config.adShield !== false);
  });

  try {
    observer = new MutationObserver(scheduleAdMute);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'data-context-item-type']
    });
  } catch (_) {}
  scheduleAdMute();

  window.__wardenOneSpotifyAdblockDispose = function disposeSpotifyAdblock() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    if (muteTimer) {
      try { clearTimeout(muteTimer); } catch (_) {}
      muteTimer = 0;
    }
    try { if (observer) observer.disconnect(); } catch (_) {}
    observer = null;
    for (const entry of listeners.splice(0, listeners.length)) {
      try { entry[0].removeEventListener(entry[1], entry[2], entry[3]); } catch (_) {}
    }
    restoreMutedAudio();
    try { if (style.parentNode) style.parentNode.removeChild(style); } catch (_) {}
    try { if (window.fetch === spotifyFetch) window.fetch = nativeFetch; } catch (_) {}
    try {
      if (RegExp.prototype.test === spotifyRegExpTest) RegExp.prototype.test = nativeRegExpTest;
    } catch (_) {}
  };
  window.__wardenOneSpotifyAdblockReady = VERSION;
})();

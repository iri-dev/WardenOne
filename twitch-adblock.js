/*
 * WardenOne Twitch ad blocker.
 *
 * Installs before Twitch's player and handles both server-side HLS ads and the
 * current display/audio-ad shells. The clean-stream strategy is informed by
 * the MIT-licensed TwitchAdSolutions VAFT and TTV-AB projects, but is
 * deliberately smaller:
 * no React internals, no player/page reloads, no polling watchdog, and no
 * remote proxy. If Twitch offers no clean alternate playlist, confirmed ad
 * media is represented with standard HLS gaps so no synthetic bytes enter
 * Twitch's decoder.
 */
(function wardenOneTwitchAdblock() {
  'use strict';

  const VERSION = '1.0.0';
  // Hook-status chatter is opt-in: it printed into every twitch.tv page console
  // on every load. Ad-time logging stays on, since that is what makes a missed
  // ad diagnosable after the fact.
  const WO_TWITCH_DEBUG = false;
  const TWITCH_HOST_RE = /(^|\.)twitch\.tv$/i;
  const GQL_URL_RE = /^https:\/\/gql\.twitch\.tv\/gql(?:[?#]|$)/i;
  const MASTER_URL_RE = /\/api\/channel\/hls\/[^/?#]+\.m3u8/i;
  const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const MESSAGE_FLAG = '__woTwitchAdblock';
  const STREAM_DISPLAY_AD_IDENTITY_RE = /(?:stream-display-ad|vertical-video-ad|sda-wrapper|ad-banner-(?:default|top)|video-ad-(?:label|countdown)|ad-countdown-timer|tw-ad-(?:label|countdown)|player-twitch-ad-header)/i;
  const STREAM_DISPLAY_AD_SIGNAL_SELECTOR = [
    '[data-test-selector="sda-wrapper"]:not([class*="wrapper-hidden" i]):not([aria-hidden="true"])',
    '[data-test-selector="ad-banner-default-container"]',
    '[data-test-selector="ad-banner-top"]',
    '[data-test-selector="unmuted-ads-text"]',
    '[data-test-selector="muted-ads-text"]',
    '[data-a-target="video-ad-label"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="ad-countdown-timer"]',
    '[data-a-target*="vertical-video-ad" i]',
    '[data-a-target="video-ad"]',
    '[class*="stream-display-ad__wrapper" i]:not([class*="wrapper-hidden" i]):not([aria-hidden="true"])',
    '[class*="vertical-video-ad" i]:not([class*="hidden" i]):not([aria-hidden="true"])',
    '.player-twitch-ad-header',
    '.tw-ad-label',
    '.tw-ad-countdown'
  ].join(',');

  if (!TWITCH_HOST_RE.test(location.hostname)) return;
  if (window.top !== window) {
    const embedFrame = /^(?:player|embed)\.twitch\.tv$/i.test(location.hostname) ||
      /^\/embed\//i.test(location.pathname || '');
    if (!embedFrame) return;
  }
  if (/^clips\.twitch\.tv$/i.test(location.hostname) || /^\/[^/]+\/clip\//i.test(location.pathname || '')) return;
  if (window.__wardenOneTwitchAdblockReady) return;
  window.__wardenOneTwitchAdblockReady = VERSION;

  let enabled = true;
  let bridgeToken = '';
  let revision = 0;
  const workers = new Set();
  const independentAdVideos = new Map();
  let primaryLiveVideo = null;
  let independentAdObserver = null;
  let independentAdPruneTimer = 0;
  // Recovery is deliberately short and intervention-scoped. A blanket 30-second
  // pass-through made a decoder/network error look fixed by simply allowing the
  // rest of the current ad pod to play. Only failures immediately following one
  // of our playlist interventions enter recovery, and native playback can end the
  // window early once it is playing again.
  const PLAYBACK_FAIL_OPEN_MS = 8 * 1000;
  const PLAYBACK_FAIL_OPEN_SETTLE_MS = 1200;
  const PLAYBACK_INTERVENTION_ERROR_WINDOW_MS = 15 * 1000;
  const PLAYBACK_FAIL_OPEN_STORAGE_KEY = '__woTwitchFailOpenUntil';
  let playbackFailOpenUntil = loadPlaybackFailOpenUntil();
  let playbackFailOpenTimer = 0;
  let playbackFailOpenResumeTimer = 0;
  let playbackFailOpenResumeVideo = null;
  let playbackFailOpenResumeSource = '';
  let lastStreamInterventionAt = 0;

  const nativeFetch = window.fetch;
  const NativeWorker = window.Worker;

  function createEphemeralDeviceId() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
      }
    } catch (_) {}
    let value = '';
    for (let index = 0; index < 32; index++) value += alphabet[Math.floor(Math.random() * alphabet.length)];
    return value;
  }

  const clientState = {
    clientId: DEFAULT_CLIENT_ID,
    // Anonymous/pre-roll sessions do not always expose a page GQL request before
    // the first ad. Twitch expects a device id on alternate token requests, so use
    // a page-scoped fallback until the real player header is observed.
    deviceId: createEphemeralDeviceId(),
    clientVersion: '',
    clientSession: '',
    clientIntegrity: '',
    authorization: '',
    tokenHash: TOKEN_HASH,
    tokenTemplate: null
  };

  const adCss = document.createElement('style');
  adCss.id = 'wo-twitch-adblock-css';
  adCss.textContent = [
    '[aria-label="Advertisement"]',
    '#player-ads',
    '[data-test-selector="sda-wrapper"]',
    '[data-test-selector="ad-banner-default-container"]',
    '[data-test-selector="ad-banner-top"]',
    '[data-test-selector="unmuted-ads-text"]',
    '[data-test-selector="muted-ads-text"]',
    '[data-a-target="video-ad"]',
    '[data-a-target="video-ad-label"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="ad-countdown-timer"]',
    '[data-test-selector="sad-overlay"]',
    'video[data-wo-twitch-independent-ad="true"]',
    '[class*="stream-display-ad__wrapper"]',
    '[class*="stream-display-ad__container"]',
    '[class*="stream-display-ad__frame"]',
    '[class*="stream-display-ad__iframe"]',
    '[class*="stream-display-ad__creative"]',
    '[class*="vertical-video-ad__wrapper"]',
    '[class*="vertical-video-ad__container"]',
    '[class*="vertical-video-ad__frame"]',
    '[class*="vertical-video-ad__iframe"]',
    '[class*="vertical-video-ad__creative"]',
    '.player-twitch-ad-header',
    '.tw-ad-label',
    '.tw-ad-countdown',
    '.audio-ax-overlay-base',
    'button[aria-label="Learn more about this ad"]'
  ].join(',') + '{display:none!important;visibility:hidden!important;pointer-events:none!important;}\n' +
    '[class*="video-player--stream-display-ad" i],' +
    '[class*="video-player"][class*="display-ad" i],' +
    '[class*="video-player"][class*="vertical-video-ad" i],' +
    '[class*="video-player"][class*="pushdown-sda" i]{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;inset:0!important;transform:none!important;}';

  function mountCss() {
    if (adCss.isConnected) return;
    const root = document.head || document.documentElement;
    if (root) root.appendChild(adCss);
  }

  mountCss();
  if (!adCss.isConnected) document.addEventListener('readystatechange', mountCss, { once: true });

  function restoreInlineStyle(video, property, state) {
    if (state.value) video.style.setProperty(property, state.value, state.priority);
    else video.style.removeProperty(property);
  }

  function restoreIndependentAdVideo(video) {
    const state = independentAdVideos.get(video);
    if (!state) return;
    try {
      restoreInlineStyle(video, 'display', state.display);
      restoreInlineStyle(video, 'visibility', state.visibility);
      restoreInlineStyle(video, 'pointer-events', state.pointerEvents);
      video.defaultMuted = state.defaultMuted;
      video.muted = state.muted;
      video.volume = state.volume;
      video.removeAttribute('data-wo-twitch-independent-ad');
    } catch (_) {}
    independentAdVideos.delete(video);
  }

  function videoMediaSource(video) {
    return String(video && (video.currentSrc || video.getAttribute('src')) || '');
  }

  function primaryPlayerVideo() {
    try {
      const allVideos = document.querySelectorAll('video');
      // Twitch exposes two stable identities for the genuine live element. Use
      // them before DOM order: current SDA/vertical creatives can also be blob
      // videos and may be inserted before the live player in the tree.
      for (const video of allVideos) {
        if (!(video instanceof HTMLVideoElement) || !video.isConnected || !videoMediaSource(video).startsWith('blob:')) continue;
        const label = String(video.getAttribute('aria-label') || '').trim().toLowerCase();
        const parentTarget = String(video.parentElement && video.parentElement.getAttribute('data-a-target') || '').toLowerCase();
        if (label === 'twitch video player' || parentTarget === 'video-ref') {
          primaryLiveVideo = video;
          return video;
        }
      }
      if (primaryLiveVideo instanceof HTMLVideoElement && primaryLiveVideo.isConnected &&
          videoMediaSource(primaryLiveVideo).startsWith('blob:') && !independentAdVideos.has(primaryLiveVideo)) {
        return primaryLiveVideo;
      }
      primaryLiveVideo = null;
      const players = document.querySelectorAll('[data-a-target="video-player"] video, .video-player video');
      for (const video of players) {
        if (video instanceof HTMLVideoElement && video.isConnected && videoMediaSource(video).startsWith('blob:')) {
          primaryLiveVideo = video;
          return video;
        }
      }
      for (const video of allVideos) {
        if (video instanceof HTMLVideoElement && video.isConnected && videoMediaSource(video).startsWith('blob:')) {
          primaryLiveVideo = video;
          return video;
        }
      }
    } catch (_) {}
    return null;
  }

  function streamDisplayAdSignalPresent() {
    try {
      return !!document.querySelector(STREAM_DISPLAY_AD_SIGNAL_SELECTOR);
    } catch (_) {
      try { return document.querySelectorAll(STREAM_DISPLAY_AD_SIGNAL_SELECTOR).length > 0; } catch (_) {}
    }
    return false;
  }

  function nodeOwnIdentityTouchesStreamDisplayAdShell(node) {
    if (!(node instanceof Element)) return false;
    try {
      const identity = [
        node.getAttribute('class'),
        node.getAttribute('id'),
        node.getAttribute('data-a-target'),
        node.getAttribute('data-test-selector'),
        node.getAttribute('aria-label')
      ].filter(Boolean).join(' ').toLowerCase();
      return STREAM_DISPLAY_AD_IDENTITY_RE.test(identity);
    } catch (_) {}
    return false;
  }

  function subtreeTouchesStreamDisplayAdShell(node) {
    if (!(node instanceof Element)) return false;
    if (nodeOwnIdentityTouchesStreamDisplayAdShell(node)) return true;
    try {
      return !!node.querySelector(STREAM_DISPLAY_AD_SIGNAL_SELECTOR);
    } catch (_) {
      try { return node.querySelectorAll(STREAM_DISPLAY_AD_SIGNAL_SELECTOR).length > 0; } catch (_) {}
    }
    return false;
  }

  function knownIndependentAdVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    const sources = [video.currentSrc, video.getAttribute('src')];
    try {
      for (const source of video.querySelectorAll('source[src]')) sources.push(source.getAttribute('src'));
    } catch (_) {}
    for (const source of sources) {
      if (!source) continue;
      try {
        const host = new URL(source, location.href).hostname.toLowerCase();
        if (host === 'media-amazon.com' || host.endsWith('.media-amazon.com')) return true;
      } catch (_) {}
    }
    const label = String(video.getAttribute('aria-label') || '').trim().toLowerCase();
    const mediaSource = videoMediaSource(video);
    const primary = primaryPlayerVideo();
    if (!mediaSource || !primary || primary === video) return false;
    if (label === 'video advertisement' || label.startsWith('this advertisement')) return true;
    // Stream Display/vertical ads can use a separate first-party or MediaSource
    // video without the old media-amazon host or aria label. Only classify the
    // extra video while Twitch's own ad shell is present; the first blob-backed
    // live player remains untouched and is restored to full size by the CSS.
    return streamDisplayAdSignalPresent();
  }

  function clearIndependentAdPruneTimer() {
    if (independentAdPruneTimer) clearTimeout(independentAdPruneTimer);
    independentAdPruneTimer = 0;
  }

  function pruneIndependentAdVideos() {
    clearIndependentAdPruneTimer();
    const now = Date.now();
    let nextDelay = 0;
    for (const [video, state] of Array.from(independentAdVideos.entries())) {
      if (video.isConnected) {
        state.detachedAt = 0;
        continue;
      }
      if (!state.detachedAt) state.detachedAt = now;
      const remaining = 10000 - (now - state.detachedAt);
      if (remaining > 0) {
        nextDelay = nextDelay ? Math.min(nextDelay, remaining) : remaining;
        continue;
      }
      // Detached ads cannot advance their on-page lifecycle and must not regain
      // audio while being discarded.
      try { video.pause(); } catch (_) {}
      restoreIndependentAdVideo(video);
    }
    if (nextDelay) independentAdPruneTimer = setTimeout(pruneIndependentAdVideos, nextDelay);
  }

  function guardIndependentAdVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    if (!enabled || !knownIndependentAdVideo(video)) {
      restoreIndependentAdVideo(video);
      return false;
    }
    try {
      if (!independentAdVideos.has(video)) {
        independentAdVideos.set(video, {
          display: { value: video.style.getPropertyValue('display'), priority: video.style.getPropertyPriority('display') },
          visibility: { value: video.style.getPropertyValue('visibility'), priority: video.style.getPropertyPriority('visibility') },
          pointerEvents: { value: video.style.getPropertyValue('pointer-events'), priority: video.style.getPropertyPriority('pointer-events') },
          defaultMuted: video.defaultMuted,
          muted: video.muted,
          volume: video.volume,
          detachedAt: 0
        });
      }
      video.style.setProperty('display', 'none', 'important');
      video.style.setProperty('visibility', 'hidden', 'important');
      video.style.setProperty('pointer-events', 'none', 'important');
      if (!video.defaultMuted) video.defaultMuted = true;
      if (!video.muted) video.muted = true;
      if (video.volume !== 0) video.volume = 0;
      video.setAttribute('data-wo-twitch-independent-ad', 'true');
      return true;
    } catch (_) {
      restoreIndependentAdVideo(video);
      return false;
    }
  }

  function guardIndependentAdsForNode(node) {
    if (node instanceof HTMLVideoElement) return guardIndependentAdVideo(node) ? 1 : 0;
    if (!(node instanceof Element)) return 0;
    let guarded = 0;
    const parent = node.closest('video');
    if (parent instanceof HTMLVideoElement && guardIndependentAdVideo(parent)) guarded++;
    try {
      for (const video of node.querySelectorAll('video')) {
        if (guardIndependentAdVideo(video)) guarded++;
      }
    } catch (_) {}
    return guarded;
  }

  function guardIndependentAdForAttributeTarget(node) {
    if (node instanceof HTMLVideoElement) return guardIndependentAdVideo(node) ? 1 : 0;
    if (!(node instanceof Element)) return 0;
    try {
      const video = node.closest('video');
      return video instanceof HTMLVideoElement && guardIndependentAdVideo(video) ? 1 : 0;
    } catch (_) {}
    return 0;
  }

  function installIndependentAdObserver() {
    if (independentAdObserver || typeof MutationObserver !== 'function') return;
    try {
      independentAdObserver = new MutationObserver((records) => {
        let streamDisplayShellChanged = false;
        for (const record of records) {
          if (record.type === 'attributes') {
            // Attribute records are the hot path on Twitch. Inspect only the
            // target (or its containing video); never traverse an unrelated
            // chat/player subtree because a class or aria-hidden value changed.
            guardIndependentAdForAttributeTarget(record.target);
            if (nodeOwnIdentityTouchesStreamDisplayAdShell(record.target) ||
                STREAM_DISPLAY_AD_IDENTITY_RE.test(String(record.oldValue || ''))) {
              streamDisplayShellChanged = true;
            }
            continue;
          }
          for (const node of record.addedNodes) {
            guardIndependentAdsForNode(node);
            if (subtreeTouchesStreamDisplayAdShell(node)) streamDisplayShellChanged = true;
          }
          for (const node of record.removedNodes || []) {
            if (subtreeTouchesStreamDisplayAdShell(node)) streamDisplayShellChanged = true;
          }
        }
        if (streamDisplayShellChanged) {
          try {
            for (const video of document.querySelectorAll('video')) guardIndependentAdVideo(video);
          } catch (_) {}
        }
        pruneIndependentAdVideos();
      });
      independentAdObserver.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['aria-label', 'src', 'class', 'aria-hidden', 'data-a-target', 'data-test-selector']
      });
    } catch (_) {
      independentAdObserver = null;
    }
  }

  function setIndependentAdGuardEnabled(nextEnabled) {
    if (!nextEnabled) {
      if (independentAdObserver) independentAdObserver.disconnect();
      independentAdObserver = null;
      clearIndependentAdPruneTimer();
      for (const video of Array.from(independentAdVideos.keys())) {
        if (!video.isConnected) {
          try { video.pause(); } catch (_) {}
          restoreIndependentAdVideo(video);
        } else {
          restoreIndependentAdVideo(video);
        }
      }
      return;
    }
    installIndependentAdObserver();
    try {
      for (const video of document.querySelectorAll('video')) guardIndependentAdVideo(video);
    } catch (_) {}
  }

  for (const eventName of ['loadstart', 'loadedmetadata', 'play', 'playing', 'volumechange']) {
    document.addEventListener(eventName, (event) => guardIndependentAdVideo(event.target), true);
  }

  function streamInterceptionEnabled() {
    return enabled && Date.now() >= playbackFailOpenUntil;
  }

  function loadPlaybackFailOpenUntil() {
    try {
      const stored = Number(sessionStorage.getItem(PLAYBACK_FAIL_OPEN_STORAGE_KEY) || 0);
      if (Number.isFinite(stored) && stored > Date.now()) {
        // Page storage is forgeable from Twitch's MAIN world. Clamp it so a stale
        // or hostile value cannot silently disable interception for the session.
        return Math.min(stored, Date.now() + PLAYBACK_FAIL_OPEN_MS);
      }
      sessionStorage.removeItem(PLAYBACK_FAIL_OPEN_STORAGE_KEY);
    } catch (_) {}
    return 0;
  }

  function persistPlaybackFailOpenUntil() {
    try {
      if (playbackFailOpenUntil > Date.now()) {
        sessionStorage.setItem(PLAYBACK_FAIL_OPEN_STORAGE_KEY, String(playbackFailOpenUntil));
      } else {
        sessionStorage.removeItem(PLAYBACK_FAIL_OPEN_STORAGE_KEY);
      }
    } catch (_) {}
  }

  function broadcastStreamConfig() {
    const workerEnabled = streamInterceptionEnabled();
    for (const worker of workers) {
      try {
        worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'config', enabled: workerEnabled });
      } catch (_) {}
    }
  }

  function clearPlaybackFailOpenResumeTimer() {
    if (playbackFailOpenResumeTimer) clearTimeout(playbackFailOpenResumeTimer);
    playbackFailOpenResumeTimer = 0;
    playbackFailOpenResumeVideo = null;
    playbackFailOpenResumeSource = '';
  }

  function resumeStreamInterception() {
    if (playbackFailOpenTimer) clearTimeout(playbackFailOpenTimer);
    playbackFailOpenTimer = 0;
    clearPlaybackFailOpenResumeTimer();
    playbackFailOpenUntil = 0;
    persistPlaybackFailOpenUntil();
    try { document.documentElement.removeAttribute('data-wo-twitch-fail-open'); } catch (_) {}
    broadcastStreamConfig();
  }

  function finishPlaybackFailOpen() {
    playbackFailOpenTimer = 0;
    const remaining = playbackFailOpenUntil - Date.now();
    if (remaining > 0) {
      playbackFailOpenTimer = setTimeout(finishPlaybackFailOpen, remaining);
      return;
    }
    resumeStreamInterception();
  }

  function primaryPlaybackVideoFailed(event) {
    const video = event && event.target;
    if (video === playbackFailOpenResumeVideo) clearPlaybackFailOpenResumeTimer();
    if (!enabled || !(video instanceof HTMLVideoElement) || !video.isConnected) return;
    if (independentAdVideos.has(video) || video.getAttribute('data-wo-twitch-independent-ad') === 'true') return;
    const errorCode = Number(video.error && video.error.code || 0);
    if (errorCode !== 2 && errorCode !== 3) return;
    if (!videoMediaSource(video).startsWith('blob:') || primaryPlayerVideo() !== video) return;

    // Do not blame arbitrary CDN/offline/player failures on the blocker. Turning
    // interception off for unrelated errors exposes prerolls and midrolls while
    // doing nothing to repair the underlying network failure.
    const now = Date.now();
    if (!lastStreamInterventionAt || now - lastStreamInterventionAt > PLAYBACK_INTERVENTION_ERROR_WINDOW_MS) return;
    // A second error cancels an optimistic early-resume check without extending
    // the original bounded deadline.
    if (playbackFailOpenUntil > now) return;

    playbackFailOpenUntil = now + PLAYBACK_FAIL_OPEN_MS;
    persistPlaybackFailOpenUntil();
    if (playbackFailOpenTimer) clearTimeout(playbackFailOpenTimer);
    clearPlaybackFailOpenResumeTimer();
    playbackFailOpenTimer = setTimeout(finishPlaybackFailOpen, PLAYBACK_FAIL_OPEN_MS);
    try {
      document.documentElement.setAttribute('data-wo-twitch-fail-open', errorCode === 2 ? 'network' : 'decode');
    } catch (_) {}
    // Let Twitch's existing player recovery retry its untouched stream. This is
    // deliberately worker-scoped and temporary: user configuration is never
    // changed, no page reload is initiated, and the current setting is restored.
    broadcastStreamConfig();
  }

  function primaryPlaybackVideoRecovered(event) {
    if (!enabled || playbackFailOpenUntil <= Date.now() || playbackFailOpenResumeTimer) return;
    const video = event && event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return;
    if (!videoMediaSource(video).startsWith('blob:') || primaryPlayerVideo() !== video) return;
    if (video.error || video.paused === true || Number(video.readyState || 0) < 2) return;
    // Give Twitch's untouched MediaSource a brief stable-playback window, then
    // resume blocking instead of leaving the rest of an ad pod unfiltered.
    playbackFailOpenResumeVideo = video;
    playbackFailOpenResumeSource = videoMediaSource(video);
    playbackFailOpenResumeTimer = setTimeout(() => {
      playbackFailOpenResumeTimer = 0;
      const expectedVideo = playbackFailOpenResumeVideo;
      const expectedSource = playbackFailOpenResumeSource;
      playbackFailOpenResumeVideo = null;
      playbackFailOpenResumeSource = '';
      if (!enabled || playbackFailOpenUntil <= Date.now() || expectedVideo !== video ||
          !video.isConnected || videoMediaSource(video) !== expectedSource || primaryPlayerVideo() !== video ||
          video.error || video.paused === true || Number(video.readyState || 0) < 2) return;
      resumeStreamInterception();
    }, PLAYBACK_FAIL_OPEN_SETTLE_MS);
  }

  function primaryPlaybackVideoUnstable(event) {
    if (event && event.target === playbackFailOpenResumeVideo) clearPlaybackFailOpenResumeTimer();
  }

  document.addEventListener('error', primaryPlaybackVideoFailed, true);
  document.addEventListener('playing', primaryPlaybackVideoRecovered, true);
  for (const eventName of ['waiting', 'stalled', 'pause', 'emptied']) {
    document.addEventListener(eventName, primaryPlaybackVideoUnstable, true);
  }
  if (playbackFailOpenUntil > Date.now()) {
    try { document.documentElement.setAttribute('data-wo-twitch-fail-open', 'recovery'); } catch (_) {}
    playbackFailOpenTimer = setTimeout(finishPlaybackFailOpen, playbackFailOpenUntil - Date.now());
  }

  function updateEnabled() {
    const config = window.__WO_CONFIG__;
    enabled = !config || (config.enabled !== false && config.twitchAdBlock !== false);
    adCss.disabled = !enabled;
    setIndependentAdGuardEnabled(enabled);
    broadcastStreamConfig();
  }

  document.addEventListener('wo-config-change', updateEnabled);
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.source === 'wardenone-handshake' && typeof message.token === 'string' && !bridgeToken) {
      bridgeToken = message.token;
      return;
    }
    if (message.source !== 'wardenone' || message.kind !== 'config' || !bridgeToken || message.token !== bridgeToken) return;
    const config = message.overrides || {};
    enabled = config.enabled !== false && config.twitchAdBlock !== false;
    adCss.disabled = !enabled;
    setIndependentAdGuardEnabled(enabled);
    broadcastStreamConfig();
  });

  function requestUrl(input) {
    try {
      return typeof input === 'string' ? input : String(input && input.url || input || '');
    } catch (_) {
      return '';
    }
  }

  function copyHeaders(input, init) {
    const out = new Headers();
    try {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        input.headers.forEach((value, key) => out.set(key, value));
      }
    } catch (_) {}
    try {
      if (init && init.headers) new Headers(init.headers).forEach((value, key) => out.set(key, value));
    } catch (_) {}
    return out;
  }

  function setState(key, value) {
    if (typeof value !== 'string' || !value || clientState[key] === value) return false;
    clientState[key] = value;
    return true;
  }

  function tokenOperation(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const vars = entry.variables;
    return !!(vars && vars.isLive === true && vars.isVod !== true &&
      typeof vars.login === 'string' && 'playerType' in vars &&
      (/PlaybackAccessToken/i.test(String(entry.operationName || '')) || !entry.operationName));
  }

  function captureTokenTemplate(parsed) {
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const token = list.find(tokenOperation);
    if (!token) return false;
    try {
      const next = JSON.parse(JSON.stringify(token));
      const hash = next && next.extensions && next.extensions.persistedQuery && next.extensions.persistedQuery.sha256Hash;
      if (typeof hash === 'string' && hash) clientState.tokenHash = hash;
      clientState.tokenTemplate = next;
      broadcastState();
      return true;
    } catch (_) {
      return false;
    }
  }

  function patchTokenBody(body) {
    if (typeof body !== 'string' || body.length > 1024 * 1024) return body;
    try {
      const parsed = JSON.parse(body);
      captureTokenTemplate(parsed);
      // Capture only. The native token's playerType/platform belong to Twitch's
      // current player session; alternate identities are confined to backups.
      return body;
    } catch (_) {
      return body;
    }
  }

  function captureClientState(input, init) {
    let changed = false;
    const headers = copyHeaders(input, init);
    changed = setState('clientId', headers.get('Client-ID') || '') || changed;
    changed = setState('deviceId', headers.get('X-Device-Id') || headers.get('Device-ID') || '') || changed;
    changed = setState('clientVersion', headers.get('Client-Version') || '') || changed;
    changed = setState('clientSession', headers.get('Client-Session-Id') || '') || changed;
    changed = setState('clientIntegrity', headers.get('Client-Integrity') || '') || changed;
    changed = setState('authorization', headers.get('Authorization') || '') || changed;
    if (changed) broadcastState();
  }

  function publicClientState() {
    return {
      tokenHash: clientState.tokenHash,
      tokenTemplate: clientState.tokenTemplate
    };
  }

  function broadcastState() {
    revision++;
    const state = publicClientState();
    for (const worker of workers) {
      try {
        worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'client-state', revision: revision, state: state });
      } catch (_) {}
    }
  }

  function pageChannelName() {
    try {
      const match = /^\/([^/?#]+)/.exec(location.pathname || '');
      return match ? decodeURIComponent(match[1]).toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  let lastMaster = null;

  function broadcastMaster(url, text) {
    if (!text) return;
    const channel = pageChannelName();
    // On a fresh load the master is fetched before the player creates its worker,
    // so a live broadcast alone would reach nobody. Keep the last one and replay
    // it on handshake -- that is precisely the pre-roll case.
    lastMaster = { url: url, text: text, channel: channel, at: Date.now() };
    for (const worker of workers) {
      try {
        worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'master', url: url, text: text, channel: channel });
      } catch (_) {}
    }
  }

  function installFetchHook() {
    if (typeof nativeFetch !== 'function' || nativeFetch.__woTwitchCurrent) return;
    function twitchFetch(input, init) {
      const url = requestUrl(input);
      // The player fetches the master on the page, then hands media URLs to a
      // worker created afterwards. That worker never sees the master, so its
      // media map stays empty, every lookup misses, and the whole clean-backup
      // path is skipped -- which is why ads used to fall through to the gapper
      // and stay visible. Mirror the master into the workers, passively.
      if (enabled && MASTER_URL_RE.test(url)) {
        const pending = nativeFetch.apply(this, arguments);
        try {
          Promise.resolve(pending).then((response) => {
            try {
              if (!response || !response.ok) return;
              response.clone().text().then(
                (text) => broadcastMaster(response.url || url, text),
                () => {},
              );
            } catch (_) {}
          }, () => {});
        } catch (_) {}
        return pending;
      }
      // Token/header capture is passive and byte-preserving, so keep it alive
      // during the short media recovery window. Otherwise the replacement worker
      // resumes with stale identity state and every clean-token attempt can fail.
      if (!enabled || !GQL_URL_RE.test(url)) return nativeFetch.apply(this, arguments);
      captureClientState(input, init);
      if (init && typeof init.body === 'string') {
        const patched = patchTokenBody(init.body);
        if (patched !== init.body) init = Object.assign({}, init, { body: patched });
      } else if (!init && typeof Request !== 'undefined' && input instanceof Request &&
                 String(input.method || '').toUpperCase() === 'POST') {
        const context = this;
        return input.clone().text().then((body) => {
          const patched = patchTokenBody(body);
          if (patched === body) return nativeFetch.call(context, input);
          return nativeFetch.call(context, new Request(input, { body: patched }));
        }, () => nativeFetch.call(context, input));
      }
      return nativeFetch.call(this, input, init);
    }
    try {
      Object.defineProperty(twitchFetch, '__woTwitchCurrent', { value: VERSION });
      Object.defineProperty(twitchFetch, 'name', { value: 'fetch' });
      Object.defineProperty(twitchFetch, 'length', { value: 1 });
      twitchFetch.toString = Function.prototype.toString.bind(nativeFetch);
    } catch (_) {}
    window.fetch = twitchFetch;
  }

  // Swapping the video does not change what Twitch's own player believes: it still
  // reads the ad markers in the native playlist, so it keeps showing the "Ad" badge
  // and opens its picture-by-picture "watch while the ad plays" window over a
  // stream that is already ad-free. Hide that chrome only while a swap is actually
  // active, keyed off the state attribute.
  //
  // Injected exactly once and never from a MutationObserver: a callback that writes
  // to the DOM it observes re-triggers itself and pins a renderer core.
  let adChromeCssInstalled = false;
  function installAdChromeCss() {
    if (adChromeCssInstalled) return;
    try {
      const root = document.documentElement;
      if (!root) return;
      adChromeCssInstalled = true;
      const style = document.createElement('style');
      style.id = 'wo-twitch-ad-chrome';
      const gate = 'html[data-wo-twitch-adblock^="blocked-"] ';
      style.textContent = [
        '[data-a-target="video-ad-label"]',
        '[data-a-target="video-ad-countdown"]',
        '[data-a-target="video-ad-countdown-container"]',
        '[data-test-selector="sad-overlay"]',
        '.video-player__ad-info-container',
        '[data-a-target="pbyp-player-instance"]',
        '.picture-by-picture-player',
      ].map((sel) => gate + sel).join(',') + '{display:none!important;}';
      root.appendChild(style);
    } catch (_) {}
  }

  async function proxyWorkerGql(worker, message) {
    const id = String(message.id || '');
    const fail = (error) => {
      try {
        worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'gql-response', id: id, error: String(error || 'GQL request failed') });
      } catch (_) {}
    };
    const body = message.body;
    const variables = body && body.variables;
    const playerType = String(variables && variables.playerType || '');
    if (!id || !tokenOperation(body) || !variables ||
        !/^[a-z0-9_]{1,25}$/i.test(String(variables.login || '')) ||
        !['site', 'popout', 'mobile_web', 'embed'].includes(playerType)) {
      fail('Rejected invalid GQL proxy request');
      return;
    }
    let timer = 0;
    let controller = null;
    try {
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) timer = setTimeout(() => controller.abort(), 3500);
      const headers = {
        'Client-ID': clientState.clientId || DEFAULT_CLIENT_ID,
        'Content-Type': 'application/json'
      };
      if (clientState.deviceId) headers['X-Device-Id'] = clientState.deviceId;
      if (clientState.clientVersion) headers['Client-Version'] = clientState.clientVersion;
      if (clientState.clientSession) headers['Client-Session-Id'] = clientState.clientSession;
      if (clientState.clientIntegrity) headers['Client-Integrity'] = clientState.clientIntegrity;
      if (clientState.authorization) headers.Authorization = clientState.authorization;
      // NOTE: credentials must be 'omit', not 'include'. gql.twitch.tv now returns
      // Access-Control-Allow-Origin: * , which the browser refuses to combine with
      // credentialed requests ("Failed to fetch"). Auth rides on the Authorization
      // header (captured from the page), so cookies are unnecessary anyway.
      const request = (requestHeaders) => nativeFetch.call(window, 'https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: controller ? controller.signal : undefined
      });
      let response = await request(headers);
      if ((response.status === 401 || response.status === 403) && (headers.Authorization || headers['Client-Integrity'])) {
        delete headers.Authorization;
        delete headers['Client-Integrity'];
        clientState.authorization = '';
        clientState.clientIntegrity = '';
        response = await request(headers);
      }
      const responseBody = await response.text();
      const responseHeaders = [];
      response.headers.forEach((value, key) => responseHeaders.push([key, value]));
      worker.postMessage({
        [MESSAGE_FLAG]: VERSION,
        type: 'gql-response',
        id: id,
        response: { status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseBody }
      });
    } catch (error) {
      fail(error && error.message || error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function workerOriginIsTwitch(rawUrl) {
    try {
      const url = new URL(String(rawUrl), location.href);
      return TWITCH_HOST_RE.test(url.hostname) || /(^|\.)twitch\.tv$/i.test(new URL(url.origin).hostname);
    } catch (_) {
      return false;
    }
  }

  function readWorkerSource(url) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', String(url), false);
      xhr.overrideMimeType('text/javascript');
      xhr.send();
      return typeof xhr.responseText === 'string' ? xhr.responseText : '';
    } catch (_) {
      return '';
    }
  }

  function twitchWorkerRuntime(originalSource, initialState, runtimeVersion, initiallyEnabled) {
    'use strict';

    const FLAG = '__woTwitchAdblock';
    // Twitch's current manifests use both the longer twitch-stitched-ad class
    // and shorter stitched identifiers. Match the signifier as a token so a
    // marker-only spelling change cannot turn the entire ad pod into clean media.
    const AD_MARKER_RE = /\bstitched\b|#EXT-X-CUE-OUT|CLASS="twitch-maf-ad"|CLASS="twitch-trigger"/i;
    const STRONG_AD_METADATA_RE = /X-TV-TWITCH-AD-(?:RADS-TOKEN|ROLL-TYPE|POD-|ADVERTISER|CREATIVE|LINE-ITEM|ORDER-ID)/i;
    const AD_URI_RE = /\/(?:adsquared|_404)\/|\/stitched-ad(?:[-_.\/]|$)/i;
    const LOW_LATENCY_TAG_RE = /^#EXT-X-(?:SERVER-CONTROL|PART-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SKIP|TWITCH-PREFETCH)\b/i;
    const GQL_RE = /^https:\/\/gql\.twitch\.tv\/gql(?:[?#]|$)/i;
    const MEDIA_TTL = 5 * 60 * 1000;
    const BACKUP_TTL = 2 * 60 * 1000;
    const NEGATIVE_TTL = 30 * 1000;
    const MEDIA_MAX = 128;
    const BACKUP_MAX = 12;
    const BACKUP_WAIT_MS = 900;
    const BACKUP_POLL_TIMEOUT_MS = 650;
    const CLEAN_NATIVE_TTL = 2500;
    const NATIVE_RELEASE_POLLS = 3;
    const AD_QUARANTINE_MAX_MS = 45 * 1000;
    const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
    const EMPTY_STATE = {
      tokenHash: TOKEN_HASH,
      tokenTemplate: null
    };

    // A replacement player worker can be created while the page-level recovery
    // circuit is active. Start that worker in pass-through mode immediately;
    // waiting for its asynchronous ready/config handshake leaves a race where its
    // first playlist request can repeat the transform that just failed.
    let active = initiallyEnabled !== false;
    let client = Object.assign({}, EMPTY_STATE, initialState || {});
    const realFetch = self.fetch.bind(self);
    const media = new Map();
    const backups = new Map();
    const pendingBackups = new Map();
    const pendingBackupPolls = new Map();
    const pendingGql = new Map();

    function post(type, extra) {
      try {
        self.postMessage(Object.assign({ [FLAG]: runtimeVersion, type: type }, extra || {}));
      } catch (_) {}
    }

    function wlog(m) { post('log', { m: m }); }

    // Ad state was only ever reported while blocking, never cleared, so the page
    // attribute stayed pinned to the last blocked value for the rest of the
    // session. Anything keyed off it (such as hiding Twitch's own ad chrome) would
    // therefore stay applied long after the break ended. Report transitions only,
    // including the return to clean playback.
    let lastAdStateSent = '';
    function setAdState(state, channel) {
      if (state === lastAdStateSent) return;
      lastAdStateSent = state;
      post('ad-state', { state: state, channel: channel || '' });
    }

    function urlOf(input) {
      try {
        return typeof input === 'string' ? input : String(input && input.url || input || '');
      } catch (_) {
        return '';
      }
    }

    function canonical(url) {
      try {
        const value = new URL(url);
        value.search = '';
        value.hash = '';
        return value.href;
      } catch (_) {
        return String(url || '').split('?')[0];
      }
    }

    function playlistUrl(url) {
      try {
        const value = new URL(String(url || ''));
        return /\.m3u8$/i.test(value.pathname);
      } catch (_) {
        return /\.m3u8(?:[?#]|$)/i.test(String(url || ''));
      }
    }

    function twitchMediaUrl(url) {
      try {
        const value = new URL(String(url || ''));
        return /(^|\.)ttvnw\.net$/i.test(value.hostname) && /\.m3u8$/i.test(value.pathname);
      } catch (_) {
        return false;
      }
    }

    function masterPlaylistUrl(url) {
      try {
        const value = new URL(String(url || ''));
        return /(^|\.)ttvnw\.net$/i.test(value.hostname) &&
          /\/api\/(?:v2\/)?channel\/hls\/[^/]+\.m3u8$/i.test(value.pathname);
      } catch (_) {
        return false;
      }
    }

    function withoutLowLatencyQuery(url) {
      try {
        const value = new URL(String(url || ''));
        let changed = false;
        for (const key of Array.from(value.searchParams.keys())) {
          if (!/^_hls_(?:msn|part|skip)$/i.test(key)) continue;
          value.searchParams.delete(key);
          changed = true;
        }
        return changed ? value.href : String(url || '');
      } catch (_) {
        return String(url || '');
      }
    }

    function nativeMediaInput(input, url, info) {
      if (!info || (!info.adActive && !info.backupActive)) return input;
      const ordinaryUrl = withoutLowLatencyQuery(url);
      if (!ordinaryUrl || ordinaryUrl === url) return input;
      if (typeof input === 'string') return ordinaryUrl;
      try {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          // Playlist requests are GETs. Constructing from the original Request
          // preserves its headers, credentials and linked abort signal while only
          // removing blocking LL-HLS cursor parameters during an intervention.
          return new Request(ordinaryUrl, input);
        }
      } catch (_) {}
      return input;
    }

    function prune(map, max, ttl) {
      const now = Date.now();
      for (const [key, value] of map) {
        if (value && value.ts && now - value.ts > ttl) map.delete(key);
      }
      while (map.size > max) {
        const first = map.keys().next().value;
        if (first === undefined) break;
        map.delete(first);
      }
    }

    function responseWithText(response, text, contentType) {
      try {
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        if (contentType) headers.set('content-type', contentType);
        const replacement = new Response(text, {
          status: response.status || 200,
          statusText: response.statusText || 'OK',
          headers: headers
        });
        try {
          Object.defineProperty(replacement, 'url', { value: response.url || '', configurable: true });
          Object.defineProperty(replacement, 'redirected', { value: !!response.redirected, configurable: true });
          Object.defineProperty(replacement, 'type', { value: response.type || 'basic', configurable: true });
        } catch (_) {}
        return replacement;
      } catch (_) {
        try {
          return new Response(text, {
            status: 200,
            headers: { 'content-type': contentType || 'application/vnd.apple.mpegurl' }
          });
        } catch (_) {
          // Response construction is part of the optional intervention. If a
          // browser/polyfill rejects both construction paths, preserve the valid
          // native response instead of turning playback into a rejected fetch.
          return response;
        }
      }
    }

    function parseAttributes(line) {
      const output = {};
      const source = String(line || '').replace(/^[^:]*:/, '');
      for (const match of source.matchAll(/(?:^|,)([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi)) {
        let value = match[2] || '';
        if (value[0] === '"' && value[value.length - 1] === '"') value = value.slice(1, -1);
        output[match[1].toUpperCase()] = value;
      }
      return output;
    }

    function codecSignature(codecs) {
      return String(codecs || '')
        .split(',')
        .map((codec) => codec.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join(',');
    }

    function resolutionArea(resolution) {
      const match = /^(\d+)x(\d+)$/i.exec(String(resolution || ''));
      return match ? Number(match[1]) * Number(match[2]) : 0;
    }

    function parseMaster(text, baseUrl) {
      const lines = String(text || '').replace(/\r/g, '').split('\n');
      const variants = [];
      for (let index = 0; index < lines.length - 1; index++) {
        if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue;
        const attributes = parseAttributes(lines[index]);
        const rawUrl = String(lines[index + 1] || '').trim();
        if (!rawUrl || rawUrl[0] === '#') continue;
        let absolute = rawUrl;
        try { absolute = new URL(rawUrl, baseUrl).href; } catch (_) {}
        variants.push({
          url: absolute,
          resolution: attributes.RESOLUTION || '',
          fps: Number(attributes['FRAME-RATE'] || 0),
          codecs: attributes.CODECS || '',
          video: attributes.VIDEO || '',
          audio: attributes.AUDIO || '',
          subtitles: attributes.SUBTITLES || '',
          bandwidth: Number(attributes.BANDWIDTH || 0)
        });
      }
      return variants;
    }

    function chooseVariant(variants, wanted) {
      if (!variants || !variants.length) return null;
      const wantedCodecs = codecSignature(wanted && wanted.codecs);
      // The replacement is returned through the already-open media playlist URL,
      // so Twitch does not recreate its MediaSource/SourceBuffer. A merely similar
      // codec family is not safe here: changing H.264 profile/level or the audio
      // codec mid-buffer is a common Chromium MEDIA_ERR_DECODE / Twitch #3000 path.
      if (!wantedCodecs) return null;
      let pool = variants.filter((variant) => codecSignature(variant.codecs) === wantedCodecs);
      if (!pool.length) return null;
      const groupCompatible = pool.filter((variant) =>
        (!wanted.audio || !variant.audio || variant.audio === wanted.audio) &&
        (!wanted.subtitles || !variant.subtitles || variant.subtitles === wanted.subtitles));
      if (groupCompatible.length) pool = groupCompatible;
      return pool.find((variant) => variant.video && variant.video === wanted.video) ||
        pool.find((variant) => variant.resolution === wanted.resolution && (!wanted.fps || variant.fps === wanted.fps)) ||
        pool.find((variant) => variant.resolution === wanted.resolution) ||
        pool.reduce((best, variant) => {
          if (!best) return variant;
          const target = resolutionArea(wanted.resolution);
          return Math.abs(resolutionArea(variant.resolution) - target) < Math.abs(resolutionArea(best.resolution) - target) ? variant : best;
        }, null);
    }

    function absoluteUrl(rawUrl, baseUrl) {
      const value = String(rawUrl || '').trim();
      if (!value || /^(?:data|blob):/i.test(value)) return value;
      try { return new URL(value, baseUrl).href; } catch (_) { return value; }
    }

    function absolutizeMediaPlaylist(text, baseUrl) {
      const lines = String(text || '').replace(/\r/g, '').split('\n');
      return lines.map((line) => {
        if (!line) return line;
        if (line[0] !== '#') return absoluteUrl(line, baseUrl);
        if (/^#EXT-X-TWITCH-PREFETCH:/i.test(line)) {
          const raw = line.replace(/^#EXT-X-TWITCH-PREFETCH:/i, '').trim();
          return '#EXT-X-TWITCH-PREFETCH:' + absoluteUrl(raw, baseUrl);
        }
        return line.replace(/\bURI="([^"]+)"/gi, (match, uri) => 'URI="' + absoluteUrl(uri, baseUrl) + '"');
      }).join('\n');
    }

    function taggedUri(line) {
      const match = /\bURI="([^"]+)"/i.exec(String(line || ''));
      return match ? match[1] : '';
    }

    function extinfDuration(line) {
      const match = /^#EXTINF:([0-9.]+)/i.exec(String(line || ''));
      return match ? Number(match[1]) || 0 : 0;
    }

    function cueDuration(line) {
      const source = String(line || '');
      const named = /(?:DURATION=)?([0-9]+(?:\.[0-9]+)?)/i.exec(source.replace(/^#EXT-X-CUE-OUT:?/i, ''));
      return named ? Number(named[1]) || 0 : 0;
    }

    function nextMediaUri(lines, startIndex) {
      for (let index = startIndex; index < lines.length; index++) {
        const line = String(lines[index] || '').trim();
        if (!line) continue;
        if (line[0] !== '#') return { index: index, uri: line };
        if (/^#EXTINF:|^#EXT-X-PART:/i.test(line)) break;
      }
      return null;
    }

    function timedAdRanges(lines) {
      const ranges = [];
      for (const line of lines) {
        if (!/^#EXT-X-DATERANGE:/i.test(line) ||
            (!AD_MARKER_RE.test(line) && !STRONG_AD_METADATA_RE.test(line) && !/\bSCTE35-OUT=/i.test(line))) continue;
        const attrs = parseAttributes(line);
        const start = Date.parse(String(attrs['START-DATE'] || ''));
        if (!Number.isFinite(start)) continue;
        let end = Date.parse(String(attrs['END-DATE'] || ''));
        if (!Number.isFinite(end)) {
          const duration = Number(attrs.DURATION || attrs['PLANNED-DURATION'] || 0);
          if (duration > 0) end = start + duration * 1000;
        }
        if (Number.isFinite(end) && end > start) ranges.push({ start: start, end: end });
      }
      return ranges;
    }

    function advertisedAdDuration(lines, ranges) {
      let duration = 0;
      for (const range of ranges) duration = Math.max(duration, (range.end - range.start) / 1000);
      for (const line of lines) {
        if (/^#EXT-X-CUE-OUT/i.test(line)) {
          duration = Math.max(duration, cueDuration(line));
          continue;
        }
        if (!/^#EXT-X-DATERANGE:/i.test(line) ||
            (!AD_MARKER_RE.test(line) && !STRONG_AD_METADATA_RE.test(line) && !/\bSCTE35-OUT=/i.test(line))) continue;
        const attrs = parseAttributes(line);
        duration = Math.max(duration, Number(attrs.DURATION || attrs['PLANNED-DURATION'] || 0) || 0);
      }
      return duration;
    }

    function overlapsTimedAd(ranges, start, durationSeconds) {
      if (!Number.isFinite(start) || !(durationSeconds > 0)) return false;
      const end = start + durationSeconds * 1000;
      return ranges.some((range) => start < range.end && end > range.start);
    }

    function playlistEvidence(text) {
      const source = String(text || '');
      const lines = source.replace(/\r/g, '').split('\n');
      // Twitch also emits the compact DATERANGE spelling CLASS="stitched" (and
      // occasionally ID="stitched") with blank EXTINF titles and generic media
      // paths. Treat the exact attribute value as strong evidence; the explicit
      // `live` title check below still protects stale markers on live segments.
      const exactStitchedRange = lines.some((line) => {
        if (!/^#EXT-X-DATERANGE:/i.test(line)) return false;
        try {
          const attrs = parseAttributes(line);
          return /^stitched$/i.test(String(attrs.CLASS || '')) || /^stitched$/i.test(String(attrs.ID || ''));
        } catch (_) {
          return false;
        }
      });
      const strongMetadata = STRONG_AD_METADATA_RE.test(source) || /stitched-ad/i.test(source) || exactStitchedRange;
      const ranges = timedAdRanges(lines);
      const hasMarker = AD_MARKER_RE.test(source) || strongMetadata || ranges.length > 0;
      const hasLiveTitle = lines.some((line) => /^#EXTINF:.*?,\s*live\s*$/i.test(line));
      const sequenceLine = lines.find((line) => /^#EXT-X-MEDIA-SEQUENCE:/i.test(line));
      const targetLine = lines.find((line) => /^#EXT-X-TARGETDURATION:/i.test(line));
      const mediaSequence = Number(String(sequenceLine || '').replace(/^#EXT-X-MEDIA-SEQUENCE:/i, ''));
      const targetDuration = Number(String(targetLine || '').replace(/^#EXT-X-TARGETDURATION:/i, '')) || 2;
      const fullAds = new Set();
      const inlineAds = new Set();
      let playable = 0;
      let fullPlayable = 0;
      let explicitLive = 0;
      let confirmed = 0;
      let cueActive = false;
      let cueRemaining = 0;
      let programTime = NaN;

      for (let index = 0; index < lines.length; index++) {
        const line = String(lines[index] || '');
        if (/^#EXT-X-PROGRAM-DATE-TIME:/i.test(line)) {
          programTime = Date.parse(line.replace(/^#EXT-X-PROGRAM-DATE-TIME:/i, '').trim());
          continue;
        }
        if (/^#EXT-X-CUE-IN/i.test(line)) {
          cueActive = false;
          cueRemaining = 0;
          continue;
        }
        if (/^#EXT-X-CUE-OUT/i.test(line)) {
          cueActive = true;
          cueRemaining = cueDuration(line);
          continue;
        }
        if (/^#EXTINF:/i.test(line) && index + 1 < lines.length) {
          const mediaUri = nextMediaUri(lines, index + 1);
          if (!mediaUri) continue;
          const uri = mediaUri.uri;
          playable++;
          fullPlayable++;
          const duration = extinfDuration(line);
          const comma = line.indexOf(',');
          const title = comma >= 0 ? line.slice(comma + 1).trim().toLowerCase() : '';
          const isLiveTitle = title === 'live';
          if (isLiveTitle) explicitLive++;
          const explicitlyNonLive = !!title && !isLiveTitle;
          const markerScoped = hasMarker && !isLiveTitle &&
            (explicitlyNonLive || hasLiveTitle || (strongMetadata && !hasLiveTitle));
          if (AD_URI_RE.test(uri) || cueActive || markerScoped || overlapsTimedAd(ranges, programTime, duration)) {
            fullAds.add(index);
            confirmed++;
          }
          if (cueActive && cueRemaining > 0) {
            cueRemaining -= duration;
            if (cueRemaining <= 0.001) {
              cueActive = false;
              cueRemaining = 0;
            }
          }
          if (Number.isFinite(programTime) && duration > 0) programTime += duration * 1000;
          continue;
        }
        if (/^#EXT-X-PART:/i.test(line)) {
          playable++;
          const uri = taggedUri(line);
          const partDuration = Number(parseAttributes(line).DURATION || 0);
          if (AD_URI_RE.test(uri) || cueActive || (hasMarker && strongMetadata && !hasLiveTitle) ||
              overlapsTimedAd(ranges, programTime, partDuration)) {
            inlineAds.add(index);
            confirmed++;
          }
          if (Number.isFinite(programTime) && partDuration > 0) programTime += partDuration * 1000;
          continue;
        }
        if (/^#EXT-X-PRELOAD-HINT:/i.test(line)) {
          const uri = taggedUri(line);
          if (AD_URI_RE.test(uri) || cueActive || (hasMarker && strongMetadata && !hasLiveTitle)) {
            playable++;
            confirmed++;
            inlineAds.add(index);
          }
          continue;
        }
        if (/^#EXT-X-TWITCH-PREFETCH:/i.test(line)) {
          const uri = line.replace(/^#EXT-X-TWITCH-PREFETCH:/i, '').trim();
          if (AD_URI_RE.test(uri) || cueActive || (hasMarker && strongMetadata && !hasLiveTitle)) {
            playable++;
            confirmed++;
            inlineAds.add(index);
          }
        }
      }
      return {
        lines: lines,
        hasMarker: hasMarker,
        strongMetadata: strongMetadata,
        playable: playable,
        fullPlayable: fullPlayable,
        explicitLive: explicitLive,
        confirmed: confirmed,
        mediaSequence: Number.isFinite(mediaSequence) ? mediaSequence : NaN,
        targetDuration: targetDuration,
        advertisedDuration: advertisedAdDuration(lines, ranges),
        fullAds: fullAds,
        inlineAds: inlineAds
      };
    }

    function beginAdQuarantine(info, evidence) {
      if (!info) return;
      const now = Date.now();
      const target = Math.max(1, Number(evidence.targetDuration) || 2);
      const advertised = Math.max(target * 3, Number(evidence.advertisedDuration) || 0);
      const boundedDuration = Math.min(AD_QUARANTINE_MAX_MS / 1000, advertised);
      info.adActive = true;
      info.lastConfirmedAdAt = now;
      info.cleanNativePolls = 0;
      if (Number.isFinite(evidence.mediaSequence)) {
        const until = evidence.mediaSequence + Math.max(3, Math.ceil(boundedDuration / target));
        info.adUntilSequence = Math.max(Number(info.adUntilSequence) || 0, until);
      }
    }

    function nativeAdQuarantineState(info, evidence) {
      if (!info || !info.adActive) return { active: false, release: false };
      const markerFree = !evidence.hasMarker && !evidence.strongMetadata;
      const explicitlyLive = markerFree && evidence.fullPlayable > 0 &&
        evidence.explicitLive === evidence.fullPlayable;
      info.cleanNativePolls = explicitlyLive ? (Number(info.cleanNativePolls) || 0) + 1 : 0;
      const sequencePast = Number.isFinite(evidence.mediaSequence) && Number(info.adUntilSequence) > 0 &&
        evidence.mediaSequence > Number(info.adUntilSequence);
      const timedOut = Date.now() - (Number(info.lastConfirmedAdAt) || 0) >= AD_QUARANTINE_MAX_MS;
      const release = info.cleanNativePolls >= NATIVE_RELEASE_POLLS || sequencePast || timedOut;
      if (release) {
        info.adActive = false;
        info.adUntilSequence = 0;
        info.cleanNativePolls = 0;
      }
      return { active: !release, release: release };
    }

    function hasAds(text) {
      return playlistEvidence(text).confirmed > 0;
    }

    // Twitch serves low-latency HLS: the player issues blocking playlist reloads
    // (_HLS_msn/_HLS_part) and expects the parts advertised by EXT-X-PART-INF /
    // EXT-X-SERVER-CONTROL to keep arriving. Any playlist we synthesize or swap in
    // during an ad break cannot honour that contract -- ad parts are removed, and a
    // backup comes from a different session with its own sequence numbering -- so a
    // player left in low-latency mode blocks on a part that never comes and surfaces
    // it as network "Error #2000". Dropping the low-latency tags for the duration of
    // the intervention makes the player fall back to ordinary polling, which costs a
    // couple of seconds of latency during the break instead of killing playback.
    function stripLowLatency(text) {
      const lines = String(text || '').replace(/\r/g, '').split('\n');
      const out = [];
      for (const line of lines) {
        if (LOW_LATENCY_TAG_RE.test(line.trim())) continue;
        out.push(line);
      }
      return out.join('\n');
    }

    function ordinaryMediaPlaylist(text) {
      const stripped = stripLowLatency(text);
      const lines = stripped.replace(/\r/g, '').split('\n');
      const first = lines.find((line) => String(line || '').trim());
      if (String(first || '').trim().replace(/^\uFEFF/, '') !== '#EXTM3U') return '';
      if (!lines.some((line) => /^#EXT-X-TARGETDURATION:/i.test(String(line || '').trim()))) return '';
      if (lines.some((line) => /^#EXT-X-STREAM-INF:/i.test(String(line || '').trim()))) return '';
      if (playlistEvidence(stripped).fullPlayable < 1) return '';
      return stripped;
    }

    function mediaPlaylistEnvelope(text) {
      const lines = String(text || '').replace(/\r/g, '').split('\n');
      const first = lines.find((line) => String(line || '').trim());
      if (String(first || '').trim().replace(/^\uFEFF/, '') !== '#EXTM3U') return false;
      if (lines.some((line) => /^#EXT-X-STREAM-INF:/i.test(String(line || '').trim()))) return false;
      return lines.some((line) => /^#EXTINF:|^#EXT-X-(?:PART|PRELOAD-HINT|TWITCH-PREFETCH):/i.test(String(line || '').trim()));
    }

    function mediaContainer(text) {
      const source = String(text || '');
      if (/^#EXT-X-MAP:/im.test(source)) return 'fmp4';
      const lines = source.replace(/\r/g, '').split('\n');
      const mediaUris = [];
      for (let index = 0; index < lines.length; index++) {
        if (!/^#EXTINF:/i.test(String(lines[index] || '').trim())) continue;
        const next = nextMediaUri(lines, index + 1);
        if (next && next.uri) mediaUris.push(next.uri);
      }
      if (mediaUris.some((uri) => /\.(?:m4s|mp4|cmfv|cmfa)(?:[?#]|$)/i.test(uri))) return 'fmp4';
      if (mediaUris.some((uri) => /\.ts(?:[?#]|$)/i.test(uri))) return 'mpegts';
      return '';
    }

    function stripAdPlaylist(text, forceAll) {
      const evidence = playlistEvidence(text);
      if (!evidence.confirmed && !forceAll) return String(text || '');
      // A part-only delta response cannot be converted into a valid ordinary HLS
      // playlist without inventing media. Passing it through is safer than feeding
      // an empty/synthetic playlist to Twitch's decoder; the next complete reload
      // will be handled with normal EXT-X-GAP tags.
      if (evidence.fullPlayable < 1) return String(text || '');
      const output = [];
      for (let index = 0; index < evidence.lines.length; index++) {
        let line = String(evidence.lines[index] || '');
        if (/^#EXT-X-CUE-(?:OUT|IN)/i.test(line)) continue;
        // Removing only the ad parts would leave a hole in the part sequence an
        // LL-HLS player is still blocking on, so drop low-latency signalling wholesale.
        if (LOW_LATENCY_TAG_RE.test(line)) continue;
        if (evidence.inlineAds.has(index)) continue;
        if ((AD_MARKER_RE.test(line) || STRONG_AD_METADATA_RE.test(line) || /\bSCTE35-OUT=/i.test(line)) &&
            /^#EXT-X-(?:DATERANGE|TWITCH-)/i.test(line)) continue;
        line = line
          .replace(/(X-TV-TWITCH-AD-URL=")[^"]*(")/gi, '$1https://twitch.tv$2')
          .replace(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/gi, '$1https://twitch.tv$2');
        output.push(line);
        if ((forceAll && /^#EXTINF:/i.test(line)) || evidence.fullAds.has(index)) {
          // EXT-X-GAP advances the native HLS timeline without fetching or appending
          // the ad segment. Keeping the original URI, sequence, container and codec
          // metadata is intentional: a local MP4 placeholder can poison an existing
          // MPEG-TS/CMAF SourceBuffer and surfaces as Twitch Error #3000.
          if (!/^#EXT-X-GAP$/i.test(String(evidence.lines[index + 1] || '').trim())) output.push('#EXT-X-GAP');
        }
      }
      return output.join('\n');
    }

    function rememberVariant(url, info) {
      if (!url) return;
      info.ts = Date.now();
      media.set(url, info);
      media.set(canonical(url), info);
      prune(media, MEDIA_MAX, MEDIA_TTL);
    }

    // The master is what maps a media URL to the channel/codec profile a backup
    // stream has to match. Shared by the worker's own master fetch and by masters
    // the page forwards, because a freshly created worker never sees the master
    // the page already fetched and would otherwise have an empty map.
    function mapMasterVariants(text, masterUrl, responseUrl, channel) {
      const name = String(channel || '').trim().toLowerCase();
      if (!name || !text) return 0;
      let count = 0;
      for (const variant of parseMaster(text, responseUrl || masterUrl)) {
        rememberVariant(variant.url, {
          channel: name,
          resolution: variant.resolution,
          fps: variant.fps,
          codecs: variant.codecs,
          video: variant.video,
          audio: variant.audio,
          subtitles: variant.subtitles,
          bandwidth: variant.bandwidth,
          master: masterUrl,
          ts: Date.now()
        });
        count++;
      }
      return count;
    }

    function channelFromMaster(url) {
      const match = /\/hls\/([^./?]+)\.m3u8/i.exec(String(url || ''));
      if (!match) return '';
      try { return decodeURIComponent(match[1]).toLowerCase(); } catch (_) { return match[1].toLowerCase(); }
    }

    function operationIsToken(entry) {
      if (!entry || typeof entry !== 'object') return false;
      const vars = entry.variables;
      return !!(vars && vars.isLive === true && vars.isVod !== true &&
        typeof vars.login === 'string' && 'playerType' in vars &&
        (/PlaybackAccessToken/i.test(String(entry.operationName || '')) || !entry.operationName));
    }

    function patchGqlInit(input, init) {
      if (!init || typeof init.body !== 'string' || init.body.length > 1024 * 1024) return init;
      try {
        const parsed = JSON.parse(init.body);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const template = list.find(operationIsToken);
        if (template) {
          client.tokenTemplate = JSON.parse(JSON.stringify(template));
          const hash = template.extensions && template.extensions.persistedQuery && template.extensions.persistedQuery.sha256Hash;
          if (hash) client.tokenHash = hash;
        }
        // Preserve the native request byte-for-byte. A token minted for another
        // shell can fail at the next native playlist refresh with Error #2000.
        return init;
      } catch (_) {
        return init;
      }
    }

    function tokenBody(channel, playerType) {
      let body = null;
      try { body = client.tokenTemplate ? JSON.parse(JSON.stringify(client.tokenTemplate)) : null; } catch (_) {}
      if (!body || !operationIsToken(body)) {
        body = {
          operationName: 'PlaybackAccessToken',
          variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: playerType, platform: 'web' },
          extensions: { persistedQuery: { version: 1, sha256Hash: client.tokenHash || TOKEN_HASH } }
        };
      }
      body.operationName = body.operationName || 'PlaybackAccessToken';
      body.variables = Object.assign({}, body.variables || {}, {
        isLive: true,
        login: channel,
        isVod: false,
        vodID: '',
        playerType: playerType,
        platform: 'web'
      });
      body.extensions = body.extensions || {};
      body.extensions.persistedQuery = body.extensions.persistedQuery || { version: 1, sha256Hash: client.tokenHash || TOKEN_HASH };
      if (!body.extensions.persistedQuery.sha256Hash) body.extensions.persistedQuery.sha256Hash = client.tokenHash || TOKEN_HASH;
      return body;
    }

    function proxyGql(body) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const timer = setTimeout(() => {
          pendingGql.delete(id);
          reject(new Error('GQL timeout'));
        }, 3800);
        pendingGql.set(id, { resolve: resolve, reject: reject, timer: timer });
        post('gql-request', { id: id, body: body });
      });
    }

    function findToken(value, depth) {
      if (!value || depth > 8) return null;
      if (typeof value === 'object') {
        const signature = value.signature || value.sig;
        const tokenValue = value.value || value.token;
        if (typeof signature === 'string' && signature && typeof tokenValue === 'string' && tokenValue) {
          return { signature: signature, value: tokenValue, authorization: value.authorization || null };
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = findToken(item, depth + 1);
            if (found) return found;
          }
        } else {
          for (const key of Object.keys(value)) {
            const found = findToken(value[key], depth + 1);
            if (found) return found;
          }
        }
      }
      return null;
    }

    async function accessToken(channel, playerType) {
      const response = await proxyGql(tokenBody(channel, playerType));
      if (!response.ok) throw new Error('token http ' + response.status);
      const parsed = await response.json();
      const token = findToken(parsed, 0);
      if (!token || !token.value || !token.signature) throw new Error('missing access token');
      if (token.authorization && token.authorization.isForbidden) throw new Error('forbidden access token');
      return token;
    }

    async function fetchTextWithTimeout(url, timeoutMs) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer = 0;
      try {
        if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await realFetch(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) throw new Error('http ' + response.status);
        return { response: response, text: await response.text() };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function backupAttempt(info, playerType) {
      const token = await accessToken(info.channel, playerType);
      const masterUrl = new URL(info.master);
      masterUrl.searchParams.set('sig', token.signature);
      masterUrl.searchParams.set('token', token.value);
      masterUrl.searchParams.delete('parent_domains');
      const master = await fetchTextWithTimeout(masterUrl.href, 1800);
      const selected = chooseVariant(parseMaster(master.text, masterUrl.href), info);
      if (!selected) throw new Error('no codec-compatible variant');
      const mediaResult = await fetchTextWithTimeout(selected.url, 1800);
      const normalized = ordinaryMediaPlaylist(absolutizeMediaPlaylist(mediaResult.text, selected.url));
      if (!normalized || hasAds(normalized)) throw new Error('backup is not a clean complete media playlist');
      const replacementContainer = mediaContainer(normalized);
      if (info.mediaContainer && replacementContainer !== info.mediaContainer) {
        throw new Error('backup changes media container');
      }
      return { url: selected.url, text: normalized, playerType: playerType, ts: Date.now() };
    }

    function raceBackupTypes(info, types) {
      return new Promise((resolve) => {
        let remaining = types.length;
        let settled = false;
        const done = (value) => {
          if (settled) return;
          if (value) {
            settled = true;
            resolve(value);
            return;
          }
          remaining--;
          if (remaining <= 0) resolve(null);
        };
        for (const type of types) backupAttempt(info, type).then(done, (e) => {
          wlog('  backup[' + type + '] failed: ' + ((e && e.message) || e));
          done(null);
        });
      });
    }

    // Source-capable web player types are raced once per playback context. The
    // Android/autoplay type is not committed because current players can stick at
    // 360p or fail to transition back to the native stream after an ad break.
    function firstCleanBackup(info) {
      return raceBackupTypes(info, ['site', 'popout', 'mobile_web', 'embed']);
    }

    function backupKey(info) {
      return [info.channel, info.resolution, info.fps, codecSignature(info.codecs), info.video,
        info.audio, info.subtitles, info.mediaContainer || ''].join('|');
    }

    function getBackup(info, full) {
      const key = backupKey(info);
      prune(backups, BACKUP_MAX, BACKUP_TTL);
      if (!full && Number(info.warmRetryAt || 0) > Date.now()) return Promise.resolve(null);
      const cached = backups.get(key);
      if (cached && cached.failed) {
        if (Date.now() - cached.ts < NEGATIVE_TTL) return Promise.resolve(null);
        backups.delete(key);
      }
      if (cached && !cached.failed && Date.now() - cached.ts < BACKUP_TTL) return Promise.resolve(cached);
      const fullKey = key + '|full';
      const warmKey = key + '|warm';
      if (pendingBackups.has(fullKey)) return pendingBackups.get(fullKey);
      if (!full && pendingBackups.has(warmKey)) return pendingBackups.get(warmKey);
      if (full && pendingBackups.has(warmKey)) {
        // Reuse a successful warm attempt, but do not let a failing single-type
        // prewarm suppress the full four-identity attempt once an ad is present.
        return pendingBackups.get(warmKey).then((value) => value || getBackup(info, true));
      }
      const pendingKey = full ? fullKey : warmKey;
      const attempt = full
        ? firstCleanBackup(info)
        : backupAttempt(info, 'popout').catch(() => null);
      const pending = attempt.then((value) => {
        if (value) {
          info.warmRetryAt = 0;
          backups.set(key, value);
          prune(backups, BACKUP_MAX, BACKUP_TTL);
        } else if (full) {
          // Only a full (ad-time) attempt that exhausted every player type sets the
          // negative sentinel; a light pre-warm failing must not block the ad-time try.
          backups.set(key, { failed: true, ts: Date.now() });
        } else {
          info.warmRetryAt = Date.now() + 60 * 1000;
        }
        return value;
      }, () => null).finally(() => pendingBackups.delete(pendingKey));
      pendingBackups.set(pendingKey, pending);
      return pending;
    }

    function pollCachedBackup(cached) {
      const url = String(cached && cached.url || '');
      if (!url) return Promise.resolve(null);
      if (pendingBackupPolls.has(url)) return pendingBackupPolls.get(url);
      const pending = fetchTextWithTimeout(withoutLowLatencyQuery(url), BACKUP_POLL_TIMEOUT_MS)
        .then((current) => {
          const normalized = ordinaryMediaPlaylist(absolutizeMediaPlaylist(current.text, url));
          if (!normalized || hasAds(normalized)) return null;
          return { text: normalized, container: mediaContainer(normalized) };
        }, () => null)
        .finally(() => pendingBackupPolls.delete(url));
      pendingBackupPolls.set(url, pending);
      return pending;
    }

    async function cachedBackupResponse(info, originalResponse, activate) {
      const key = backupKey(info);
      const cached = backups.get(key);
      if (cached && !cached.failed && Date.now() - cached.ts < BACKUP_TTL) {
        try {
          const current = await pollCachedBackup(cached);
          if (current && (!info.mediaContainer || current.container === info.mediaContainer)) {
            cached.ts = Date.now();
            if (activate !== false) {
              info.backupActive = true;
              info.cleanNativePolls = 0;
            }
            wlog('  clean stream via cached playerType=' + (cached.playerType || '?'));
            return responseWithText(originalResponse, current.text, 'application/vnd.apple.mpegurl');
          }
          backups.delete(key);
        } catch (_) {
          backups.delete(key);
        }
      }
      return null;
    }

    async function cleanBackupResponse(info, originalResponse) {
      const startedAt = Date.now();
      const cachedResponse = await cachedBackupResponse(info, originalResponse);
      if (cachedResponse) return cachedResponse;
      const candidatePromise = getBackup(info, true);
      if (info.lastCleanNative && Date.now() - info.lastCleanNativeAt <= CLEAN_NATIVE_TTL) {
        const bridge = ordinaryMediaPlaylist(info.lastCleanNative);
        const bridgeContainer = mediaContainer(bridge);
        if (bridge && (!info.mediaContainer || bridgeContainer === info.mediaContainer)) {
          candidatePromise.catch(() => {});
          wlog('  bridging with fresh clean native snapshot');
          return responseWithText(originalResponse, bridge, 'application/vnd.apple.mpegurl');
        }
      }
      const remainingWait = Math.max(0, BACKUP_WAIT_MS - (Date.now() - startedAt));
      if (!remainingWait) {
        candidatePromise.catch(() => {});
        return null;
      }
      const candidate = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), remainingWait);
        candidatePromise.then((value) => {
          clearTimeout(timer);
          resolve(value);
        }, () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
      if (!candidate) return null;
      info.backupActive = true;
      info.cleanNativePolls = 0;
      wlog('  clean stream via playerType=' + (candidate.playerType || '?'));
      return responseWithText(originalResponse, candidate.text, 'application/vnd.apple.mpegurl');
    }

    async function handleMaster(input, init, url) {
      // The player's own master request is compatibility-critical. In particular,
      // embed sessions use parent_domains as part of their authorization context.
      // Alternate-token experiments happen only in backupAttempt; the native
      // request must retain its exact URL, Request object, init and abort semantics.
      const response = await realFetch(input, init);
      if (!response.ok) return response;
      try {
        const text = await response.clone().text();
        mapMasterVariants(text, url, response.url || url, channelFromMaster(url));
      } catch (_) {}
      return response;
    }

    // During an ad break Twitch serves a media playlist URL that is not one of the
    // master's variant URLs, so an exact-URL lookup misses even though the channel
    // and codec profile are already known. That is precisely when the backup is
    // needed, and a miss skipped the whole clean-backup path. backupAttempt only
    // needs the profile, not the ad URL, so fall back to the freshest known variant
    // and bind it to this URL so later polls stay on one consistent state object.
    function fallbackVariant() {
      let best = null;
      for (const candidate of media.values()) {
        if (!best || (candidate.ts || 0) > (best.ts || 0)) best = candidate;
      }
      if (!best || Date.now() - (best.ts || 0) > MEDIA_TTL) return null;
      return best;
    }

    async function handleMedia(input, init, url) {
      prune(media, MEDIA_MAX, MEDIA_TTL);
      let info = media.get(url) || media.get(canonical(url));
      if (!info) {
        const profile = fallbackVariant();
        if (profile) {
          info = Object.assign({}, profile, { backupActive: false, cleanNativePolls: 0 });
          rememberVariant(url, info);
          wlog('  bound ad media url to known profile ch=' + (info.channel || '?'));
        }
      }
      // Once an intervention is active, do not issue blocking reloads for a native
      // LL-HLS sequence/part that the returned ordinary/backup playlist cannot
      // satisfy. The linked Request signal is preserved for Request inputs.
      const response = await realFetch(nativeMediaInput(input, url, info), init);
      if (!response.ok) return response;
      let text = '';
      try { text = await response.clone().text(); } catch (_) { return response; }
      // A CDN challenge, gateway page or empty 200 is not a media playlist. Never
      // remember or replay it as a clean bridge; that turns a transient network
      // response into a deterministic Twitch #2000/#3000 failure on the next ad.
      if (!mediaPlaylistEnvelope(text)) return response;
      if (info) {
        const observedContainer = mediaContainer(text);
        if (observedContainer) info.mediaContainer = observedContainer;
      }
      let evidence;
      try { evidence = playlistEvidence(text); } catch (_) { return response; }
      if (!evidence.confirmed) {
        const quarantine = nativeAdQuarantineState(info, evidence);
        if (quarantine.active) {
          // Twitch media playlists are sliding windows. An ad marker can vanish
          // one refresh before its generic/untitled media segments do, so never
          // learn or return that refresh as clean. Keep serving the clean backup
          // when available; otherwise gap its native media until the clean boundary.
          try {
            const held = await cachedBackupResponse(info, response, false);
            if (held) return held;
          } catch (_) {}
          try { getBackup(info, false); } catch (_) {}
          wlog('  ad marker slid out; holding native stream until clean boundary');
          setAdState('blocked-hold', info && info.channel || '');
          return responseWithText(response, stripAdPlaylist(text, true), 'application/vnd.apple.mpegurl');
        }
        if (quarantine.release && info) info.backupActive = false;
        if (info && !evidence.hasMarker && !evidence.strongMetadata) {
          const cleanNative = ordinaryMediaPlaylist(absolutizeMediaPlaylist(text, url));
          if (cleanNative) {
            info.lastCleanNative = cleanNative;
            info.lastCleanNativeAt = Date.now();
          }
          if (info.backupActive) {
            info.cleanNativePolls = (Number(info.cleanNativePolls) || 0) + 1;
            if (info.cleanNativePolls < NATIVE_RELEASE_POLLS) {
              try {
                const held = await cachedBackupResponse(info, response, false);
                if (held) return held;
              } catch (_) {}
            }
            info.backupActive = false;
            info.cleanNativePolls = 0;
          }
        } else if (info && (evidence.hasMarker || evidence.strongMetadata)) {
          // Marker-only CSAI snapshots are not destroyed, but a replacement is
          // probed in the background in case confirmed ad media follows next poll.
          try { getBackup(info, false); } catch (_) {}
        }
        // Once token identity is available, keep one lightweight popout backup
        // warm during normal playback. Waiting for the first ad marker guarantees
        // a visible beat of preroll/midroll while alternate tokens and Usher are
        // still cold. The full four-type race remains reserved for ad time;
        // getBackup de-duplicates by profile and backs off a failed warm attempt.
        if (info && client.tokenTemplate) { try { getBackup(info, false); } catch (_) {} }
        setAdState('clear', (info && info.channel) || '');
        return response;
      }
      beginAdQuarantine(info, evidence);
      wlog('AD detected ' + url.slice(-40));
      if (!info) wlog('  no variant info (master not mapped for this media url)');
      if (info) {
        try {
          const replacement = await cleanBackupResponse(info, response);
          if (replacement) {
            wlog('  -> swapped to CLEAN backup');
            setAdState('blocked-clean', info.channel);
            return replacement;
          }
        } catch (e) { wlog('  backup swap error: ' + (e && e.message || e)); }
      }
      if (info) {
        info.backupActive = false;
        info.cleanNativePolls = 0;
      }
      wlog('  -> no clean backup; replacing confirmed ad media');
      setAdState('blocked-gap', info && info.channel || '');
      return responseWithText(response, stripAdPlaylist(text, false), 'application/vnd.apple.mpegurl');
    }

    self.addEventListener('message', (event) => {
      const message = event && event.data;
      if (!message || message[FLAG] !== runtimeVersion) return;
      try { if (event.stopImmediatePropagation) event.stopImmediatePropagation(); } catch (_) {}
      if (message.type === 'config') {
        active = message.enabled !== false;
      } else if (message.type === 'client-state' && message.state) {
        client = Object.assign({}, client, message.state);
      } else if (message.type === 'master') {
        try {
          const url = String(message.url || '');
          mapMasterVariants(String(message.text || ''), url, url,
            channelFromMaster(url) || message.channel);
        } catch (_) {}
      } else if (message.type === 'gql-response') {
        const pending = pendingGql.get(String(message.id || ''));
        if (!pending) return;
        pendingGql.delete(String(message.id || ''));
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error));
          return;
        }
        const data = message.response || {};
        pending.resolve(new Response(data.body || '', {
          status: Number(data.status || 500),
          statusText: data.statusText || '',
          headers: data.headers || []
        }));
      }
    });

    self.fetch = async function twitchWorkerFetch(input, init) {
      if (!active) return realFetch(input, init);
      const url = urlOf(input);
      if (GQL_RE.test(url)) {
        if (!init && typeof Request !== 'undefined' && input instanceof Request &&
            String(input.method || '').toUpperCase() === 'POST') {
          try {
            const body = await input.clone().text();
            const patched = patchGqlInit(input, { body: body });
            if (patched && patched.body !== body) return realFetch(input, { body: patched.body });
          } catch (_) {}
          return realFetch(input);
        }
        return realFetch(input, patchGqlInit(input, init));
      }
      if (playlistUrl(url)) {
        if (masterPlaylistUrl(url)) return handleMaster(input, init, url);
        if (twitchMediaUrl(url) || media.has(url) || media.has(canonical(url))) {
          return handleMedia(input, init, url);
        }
      }
      return realFetch(input, init);
    };

    try {
      Object.defineProperty(self.fetch, 'name', { value: 'fetch' });
      Object.defineProperty(self.fetch, 'length', { value: 1 });
      self.fetch.toString = Function.prototype.toString.bind(realFetch);
    } catch (_) {}

    post('ready');
  }

  function installWorkerHook() {
    if (typeof NativeWorker !== 'function' || NativeWorker.__woTwitchCurrent) return;

    let workerDelegate = NativeWorker;
    let workerDelegateDepth = 0;

    function constructWorker(scriptUrl, options) {
      const Delegate = workerDelegate;
      if (workerDelegateDepth || typeof Delegate !== 'function' ||
          Delegate === TwitchWorker || Delegate === NativeWorker) {
        return new NativeWorker(scriptUrl, options);
      }
      workerDelegateDepth++;
      try {
        return new Delegate(scriptUrl, options);
      } finally {
        workerDelegateDepth--;
      }
    }

    function TwitchWorker(scriptUrl, options) {
      // A compatible late wrapper may call a cached copy of this constructor (or
      // window.Worker) as its delegate. Bypass our hook only for that nested call
      // so wrappers compose without recursively re-wrapping the Twitch blob.
      if (workerDelegateDepth) return new NativeWorker(scriptUrl, options);
      let protocol = '';
      try { protocol = new URL(String(scriptUrl), location.href).protocol; } catch (_) {}
      // Twitch can create either classic or module blob workers. The bootstrap is
      // valid in both worker modes and the original options are preserved, so
      // skipping module workers silently bypasses every playlist interception.
      var woTwitchBlob = protocol === 'blob:' && workerOriginIsTwitch(scriptUrl);
      if (!enabled || !woTwitchBlob) {
        if (WO_TWITCH_DEBUG && woTwitchBlob) { try { console.log('[WO-Twitch] worker skipped (adblock disabled)'); } catch (_) {} }
        return constructWorker(scriptUrl, options);
      }
      const originalSource = readWorkerSource(scriptUrl);
      if (WO_TWITCH_DEBUG && !originalSource) { try { console.log('[WO-Twitch] worker NOT hooked: blob source unreadable'); } catch (_) {} return constructWorker(scriptUrl, options); }

      let wrapperUrl = '';
      try {
        const bootstrap = '(' + twitchWorkerRuntime.toString() + ')(' +
          'null,' + JSON.stringify(publicClientState()) + ',' + JSON.stringify(VERSION) + ',' +
          JSON.stringify(streamInterceptionEnabled()) + ');\n';
        wrapperUrl = URL.createObjectURL(new Blob([bootstrap, originalSource], { type: 'application/javascript' }));
        const worker = constructWorker(wrapperUrl, options);
        if (WO_TWITCH_DEBUG) { try { console.log('[WO-Twitch] worker HOOKED — ad interception active'); } catch (_) {} }
        workers.add(worker);
        let revokeTimer = setTimeout(() => {
          try { URL.revokeObjectURL(wrapperUrl); } catch (_) {}
          revokeTimer = 0;
        }, 10000);

        worker.addEventListener('message', (event) => {
          const message = event && event.data;
          if (!message || message[MESSAGE_FLAG] !== VERSION) return;
          try { if (event.stopImmediatePropagation) event.stopImmediatePropagation(); } catch (_) {}
          if (message.type === 'ready') {
            if (revokeTimer) clearTimeout(revokeTimer);
            revokeTimer = 0;
            try { URL.revokeObjectURL(wrapperUrl); } catch (_) {}
            try {
              worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'config', enabled: streamInterceptionEnabled() });
              worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'client-state', revision: revision, state: publicClientState() });
              if (lastMaster && Date.now() - lastMaster.at < 120000) {
                worker.postMessage({
                  [MESSAGE_FLAG]: VERSION, type: 'master',
                  url: lastMaster.url, text: lastMaster.text, channel: lastMaster.channel,
                });
              }
            } catch (_) {}
          } else if (message.type === 'gql-request') {
            proxyWorkerGql(worker, message);
          } else if (message.type === 'ad-state') {
            try {
              const state = String(message.state || 'active');
              const blocking = /^blocked-/.test(state);
              if (blocking) lastStreamInterventionAt = Date.now();
              installAdChromeCss();
              if (blocking) document.documentElement.setAttribute('data-wo-twitch-adblock', state);
              else document.documentElement.removeAttribute('data-wo-twitch-adblock');
            } catch (_) {}
          } else if (message.type === 'log') {
            try { console.log('[WO-Twitch]', message.m); } catch (_) {}
          }
        });
        worker.addEventListener('error', () => workers.delete(worker), { once: true });
        return worker;
      } catch (_) {
        if (wrapperUrl) {
          try { URL.revokeObjectURL(wrapperUrl); } catch (_) {}
        }
        return constructWorker(scriptUrl, options);
      }
    }

    try {
      TwitchWorker.prototype = NativeWorker.prototype;
      Object.setPrototypeOf(TwitchWorker, NativeWorker);
      Object.defineProperty(TwitchWorker, '__woTwitchCurrent', { value: VERSION });
      Object.defineProperty(TwitchWorker, 'name', { value: 'Worker' });
      TwitchWorker.toString = Function.prototype.toString.bind(NativeWorker);
    } catch (_) {}
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'Worker');
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        enumerable: descriptor ? !!descriptor.enumerable : true,
        get() { return TwitchWorker; },
        // Cached native/current assignments must not bypass the Twitch hook.
        // Preserve compatible late wrappers as a mutable delegate, with the
        // recursion guard above handling wrappers that call window.Worker again.
        set(value) {
          if (value === TwitchWorker || value === NativeWorker) return;
          if (typeof value === 'function') workerDelegate = value;
        }
      });
    } catch (_) {
      window.Worker = TwitchWorker;
    }
  }

  updateEnabled();
  installWorkerHook();
  installFetchHook();
})();

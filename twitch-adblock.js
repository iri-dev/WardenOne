/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Twitch ad blocker.
 *
 * Installs before Twitch's player and handles both server-side HLS ads and the
 * current display/audio-ad shells. The clean-stream strategy is informed by
 * the MIT-licensed TwitchAdSolutions, scamorza/TwitchAdBlock, and GosuDRM/TTV-AB
 * projects. Its exact Turbo/allow-ads cosmetic rule is adapted from GPLv3-licensed
 * uBlock Origin uAssets. This implementation is deliberately smaller: no React
 * internals, no player/page reloads, no synthetic media, and no remote proxy. If
 * Twitch offers no clean alternate playlist, native playback fails open instead
 * of starving the decoder.
 */
(function wardenOneTwitchAdblock() {
  'use strict';

  const VERSION = '1.0.1';
  // Hook-status chatter is opt-in: it printed into every twitch.tv page console
  // on every load. Ad-time logging stays on, since that is what makes a missed
  // ad diagnosable after the fact.
  const WO_TWITCH_DEBUG = false;
  const TWITCH_HOST_RE = /(^|\.)twitch\.tv$/i;
  const GQL_URL_RE = /^https:\/\/gql\.twitch\.tv\/gql(?:[?#]|$)/i;
  const MASTER_URL_RE = /\/api\/(?:v2\/)?channel\/hls\/[^/?#]+\.m3u8/i;
  // Pre-rolls are not in the stream. Twitch's player carries two ad paths and
  // names them itself -- stitchedAdMetadata for the SSAI break spliced into the
  // manifest, and clientSideAdMetadata for a creative it requests and renders
  // over the video -- so gapping an entire playlist never touches a pre-roll.
  // The creative comes from its ad SDK: AdRequestBuilder starts on the Amazon
  // bid host but withAdFormat() repoints it at edge.ads.twitch.tv, taking
  // /ads/format for a standard video ad and /ads for the outstream and pause
  // formats.
  const AD_SERVICE_URL_RE =
    /^https:\/\/(?:edge\.ads\.twitch\.tv\/(?:ads|2018-01-01\/(?:3p\/)?ads)(?:[/?#]|$)|vaes\.amazon-adsystem\.com(?:[/?#]|$))/i;
  const VIDEO_AD_SERVICE_URL_RE =
    /^https:\/\/(?:edge\.ads\.twitch\.tv\/(?:ads\/format|2018-01-01\/(?:3p\/)?ads)(?:[/?#]|$)|vaes\.amazon-adsystem\.com(?:[/?#]|$))/i;
  const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const MESSAGE_FLAG = '__woTwitchAdblock';
  const STREAM_DISPLAY_AD_IDENTITY_RE = /(?:stream-display-ad|vertical-video-ad|sda-(?:wrapper|container|transform|frame|iframe)|outstream-ad|companion-ad|ad-banner-(?:default|top)|video-ad-(?:label|countdown)|ad-countdown-timer|tw-ad-(?:label|countdown)|player-twitch-ad-header)/i;
  const STREAM_DISPLAY_AD_SIGNAL_SELECTOR = [
    '[data-test-selector="sda-wrapper"]:not([class*="wrapper-hidden" i]):not([aria-hidden="true"])',
    '[data-test-selector="sda-container"]',
    '[data-test-selector="sda-transform"]',
    '[data-test-selector="sda-frame"]',
    '[data-test-selector^="sda-iframe"]',
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
  const TWITCH_TURBO_OVERLAY_SELECTOR =
    '.video-player__overlay .player-overlay-background:has(> div[class^="Layout-"] > div[class^="Layout-"]' +
    ' > div[class^="Layout-"] > a:is([href*="/how-to-allow-ads-browser"],' +
    '[href="https://www.twitch.tv/turbo"]))';

  if (!TWITCH_HOST_RE.test(location.hostname)) return;
  if (window.top !== window) {
    const embedFrame = /^(?:player|embed)\.twitch\.tv$/i.test(location.hostname) ||
      /^\/embed\//i.test(location.pathname || '');
    if (!embedFrame) return;
  }
  if (/^clips\.twitch\.tv$/i.test(location.hostname) || /^\/[^/]+\/clip\//i.test(location.pathname || '')) return;
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOneTwitchAdblockReady === VERSION) return;
  if (window.__wardenOneTwitchAdblockReady) {
    try {
      if (typeof window.__wardenOneTwitchAdblockDispose === 'function') window.__wardenOneTwitchAdblockDispose();
    } catch (_) {}
  }
  window.__wardenOneTwitchAdblockReady = VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  window.__wardenOneTwitchAdblockDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
  };

  let enabled = true;
  let bridgeToken = '';
  let revision = 0;
  const workers = new Set();
  const blockingWorkers = new Set();
  const workerAdStates = new Map();
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
  const NativeXMLHttpRequest = typeof XMLHttpRequest === 'function' ? XMLHttpRequest : null;
  const nativeXhrOpen = NativeXMLHttpRequest && NativeXMLHttpRequest.prototype &&
    NativeXMLHttpRequest.prototype.open;

  function pageActuallyHidden() {
    try {
      return document.hidden === true || document.webkitHidden === true ||
        document.visibilityState === 'hidden';
    } catch (_) {}
    return false;
  }

  let visibilityGuardEnabled = false;
  let visibilityWasPlaying = false;
  let visibilityPath = '';
  let visibilitySource = '';

  function setTwitchVisibilityGuardEnabled(nextEnabled) {
    visibilityGuardEnabled = nextEnabled === true;
    if (!visibilityGuardEnabled) {
      visibilityWasPlaying = false;
      visibilityPath = '';
      visibilitySource = '';
    }
  }

  function twitchVisibilityChanged() {
    if (!enabled || !visibilityGuardEnabled) return;
    try {
      const hidden = pageActuallyHidden();
      const video = primaryPlayerVideo();
      if (hidden) {
        const nextPath = location.pathname || '';
        const nextSource = video ? videoMediaSource(video) : '';
        const playing = !!(video && !video.paused && !video.ended);
        if (!visibilityPath || visibilityPath !== nextPath ||
            (visibilitySource && nextSource && visibilitySource !== nextSource)) {
          visibilityWasPlaying = playing;
          visibilityPath = nextPath;
          visibilitySource = nextSource;
        } else {
          visibilityWasPlaying = visibilityWasPlaying || playing;
          if (!visibilitySource && nextSource) visibilitySource = nextSource;
        }
      } else {
        const currentSource = video ? videoMediaSource(video) : '';
        const shouldResume = visibilityWasPlaying && visibilityPath === (location.pathname || '') &&
          visibilitySource && currentSource === visibilitySource && video && video.isConnected && video.paused === true &&
          !video.ended && !video.error;
        visibilityWasPlaying = false;
        visibilityPath = '';
        visibilitySource = '';
        if (shouldResume) {
          const resumed = video.play();
          if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
        }
      }
    } catch (_) {}
  }

  for (const eventName of ['visibilitychange', 'webkitvisibilitychange']) {
    woOn(document, eventName, twitchVisibilityChanged);
  }

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
    '[data-test-selector="sda-container"]',
    '[data-test-selector="sda-transform"]',
    '[data-test-selector="sda-frame"]',
    '[data-test-selector^="sda-iframe"]',
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
    'button[aria-label="Learn more about this ad"]',
    TWITCH_TURBO_OVERLAY_SELECTOR,
    '.stream-display-ad__wrapper + div > div[style^="position:"] > div[class^="Layout-sc-"]:has(video[src^="https://m.media-amazon.com"])',
    '.chat-shell > div[class^="Layout-sc-"] > div[style^="transition:"]:has(video[src^="https://m.media-amazon.com"])'
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
  if (!adCss.isConnected) woOn(document, 'readystatechange', mountCss, { once: true });

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
    if (nextDelay) independentAdPruneTimer = woTimeout(pruneIndependentAdVideos, nextDelay);
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
      independentAdObserver = woObserver((records) => {
        mountCss();
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
    woOn(document, eventName, (event) => guardIndependentAdVideo(event.target), true);
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
      playbackFailOpenTimer = woTimeout(finishPlaybackFailOpen, remaining);
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
    playbackFailOpenTimer = woTimeout(finishPlaybackFailOpen, PLAYBACK_FAIL_OPEN_MS);
    try {
      document.documentElement.setAttribute('data-wo-twitch-fail-open', errorCode === 2 ? 'network' : 'decode');
    } catch (_) {}
    blockingWorkers.clear();
    workerAdStates.clear();
    try { document.documentElement.removeAttribute('data-wo-twitch-adblock'); } catch (_) {}
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
    playbackFailOpenResumeTimer = woTimeout(() => {
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

  woOn(document, 'error', primaryPlaybackVideoFailed, true);
  woOn(document, 'playing', primaryPlaybackVideoRecovered, true);
  for (const eventName of ['waiting', 'stalled', 'pause', 'emptied']) {
    woOn(document, eventName, primaryPlaybackVideoUnstable, true);
  }
  if (playbackFailOpenUntil > Date.now()) {
    try { document.documentElement.setAttribute('data-wo-twitch-fail-open', 'recovery'); } catch (_) {}
    playbackFailOpenTimer = woTimeout(finishPlaybackFailOpen, playbackFailOpenUntil - Date.now());
  }

  function updateEnabled() {
    const config = window.__WO_CONFIG__;
    enabled = !config || (config.enabled !== false && config.twitchAdBlock !== false);
    adCss.disabled = !enabled;
    setIndependentAdGuardEnabled(enabled);
    setTwitchVisibilityGuardEnabled(enabled);
    if (!enabled) {
      blockingWorkers.clear();
      workerAdStates.clear();
      try { document.documentElement.removeAttribute('data-wo-twitch-adblock'); } catch (_) {}
    }
    syncAdManagerDecline();
    broadcastStreamConfig();
  }

  woOn(document, 'wo-config-change', updateEnabled);
  woOn(window, 'message', (event) => {
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
    setTwitchVisibilityGuardEnabled(enabled);
    if (!enabled) {
      blockingWorkers.clear();
      workerAdStates.clear();
      try { document.documentElement.removeAttribute('data-wo-twitch-adblock'); } catch (_) {}
    }
    syncAdManagerDecline();
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
    // Twitch's player asks for the templated operation, PlaybackAccessToken_Template.
    // Capturing that and replaying it for a backup stream sends that name alongside a
    // persisted-query hash, and Twitch refuses the pair outright:
    //   no operation with name "PlaybackAccessToken_Template"
    // It answers HTTP 200 while doing so, so the failure surfaces only as a null token
    // and kills every clean-backup route at exactly the moment a pre-roll needs one --
    // the one break with no warm stream to fall back on. Adopt a template only when it
    // names the operation the hash actually resolves to; otherwise leave both unset so
    // the built-in PlaybackAccessToken request is used, which mints tokens reliably.
    if (!/^PlaybackAccessToken$/i.test(String(token.operationName || 'PlaybackAccessToken'))) return false;
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

  const PRIMARY_PLAYER_TYPE = 'popout';

  function deniedPlaybackTokenEntry() {
    return { data: { streamPlaybackAccessToken: null, videoPlaybackAccessToken: null } };
  }

  function playbackTokenPlan(body) {
    if (typeof body !== 'string' || !body || body.length > 1024 * 1024 ||
        body.indexOf('PlaybackAccessToken') < 0) return null;
    try {
      const parsed = JSON.parse(body);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      if (!entries.length || !entries.some(tokenOperation)) return null;
      captureTokenTemplate(parsed);
      const pipMask = entries.map((entry) => tokenOperation(entry) &&
        /picture-by-picture/i.test(String(entry.variables && entry.variables.playerType || '')));
      const currentChannel = pageChannelName();
      const forwarded = [];
      let rewritten = false;
      for (let index = 0; index < entries.length; index++) {
        if (pipMask[index]) continue;
        const entry = entries[index];
        if (tokenOperation(entry)) {
          const variables = entry.variables;
          const login = validChannelName(variables.login);
          const playerType = String(variables.playerType || '');
          const primary = !!currentChannel && login === currentChannel &&
            !/(?:embed|preview|picture-by-picture)/i.test(playerType);
          if (primary && (variables.playerType !== PRIMARY_PLAYER_TYPE || variables.platform !== 'web')) {
            variables.playerType = PRIMARY_PLAYER_TYPE;
            variables.platform = 'web';
            rewritten = true;
          }
        }
        forwarded.push(entry);
      }
      const hasPip = pipMask.some(Boolean);
      return {
        batch: Array.isArray(parsed),
        pipMask: pipMask,
        hasPip: hasPip,
        allPip: hasPip && forwarded.length === 0,
        body: forwarded.length ? JSON.stringify(Array.isArray(parsed) ? forwarded : forwarded[0]) : '',
        changed: hasPip || rewritten
      };
    } catch (_) {
      return null;
    }
  }

  function deniedPlaybackTokenResponse(plan) {
    const payload = plan.batch ? plan.pipMask.map(() => deniedPlaybackTokenEntry()) : deniedPlaybackTokenEntry();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async function spliceDeniedPlaybackTokens(response, plan) {
    if (!plan || !plan.hasPip || plan.allPip || !response || !response.ok) return null;
    try {
      const parsed = JSON.parse(await response.clone().text());
      const forwarded = Array.isArray(parsed) ? parsed : [parsed];
      const expected = plan.pipMask.filter((blocked) => !blocked).length;
      if (forwarded.length !== expected) return null;
      const rebuilt = [];
      let cursor = 0;
      for (const blocked of plan.pipMask) {
        rebuilt.push(blocked ? deniedPlaybackTokenEntry() : forwarded[cursor++]);
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(plan.batch ? rebuilt : rebuilt[0]), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    } catch (_) {
      return null;
    }
  }

  function fetchAdsRequestInfo(body) {
    if (typeof body !== 'string' || !body || body.length > 1024 * 1024) return null;
    try {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (!list.length) return null;
      const mask = list.map((entry) => !!entry && typeof entry === 'object' &&
        entry.operationName === 'FetchAdsService_FetchAds');
      if (!mask.some(Boolean)) return null;
      return { batch: Array.isArray(parsed), mask: mask, all: mask.every(Boolean) };
    } catch (_) {
      return null;
    }
  }

  function videoAdDeclineRequestInfo(body) {
    if (typeof body !== 'string' || !body || body.length > 1024 * 1024) return null;
    try {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (!list.length) return null;
      const mask = list.map((entry) => !!entry && typeof entry === 'object' &&
        entry.operationName === 'VideoAdRequestDecline');
      if (!mask.some(Boolean)) return null;
      return { batch: Array.isArray(parsed), mask: mask, all: mask.every(Boolean) };
    } catch (_) {
      return null;
    }
  }

  function fetchAdsNoFillEntry() {
    return { data: { fetchAds: { ads: null, error: null } } };
  }

  function fetchAdsNoFillResponse(info) {
    const payload = info.batch ? info.mask.map(() => fetchAdsNoFillEntry()) : fetchAdsNoFillEntry();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function videoAdDeclineEntry() {
    return {
      data: {
        adContext: {
          id: '0',
          radToken: null,
          declineState: { reason: 'reason_ratelimit', shouldDecline: true }
        }
      }
    };
  }

  function videoAdDeclineResponse(info) {
    const payload = info.batch ? info.mask.map(() => videoAdDeclineEntry()) : videoAdDeclineEntry();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async function redactFetchAdsResponse(response, info) {
    if (!response || !response.ok || !info || info.all) return response;
    try {
      const payload = JSON.parse(await response.clone().text());
      if (!info.batch || !Array.isArray(payload) || payload.length !== info.mask.length) return response;
      for (let index = 0; index < info.mask.length; index++) {
        if (info.mask[index]) payload[index] = fetchAdsNoFillEntry();
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    } catch (_) {
      return response;
    }
  }

  async function redactVideoAdDeclineResponse(response, info) {
    if (!response || !response.ok || !info || info.all) return response;
    try {
      const payload = JSON.parse(await response.clone().text());
      if (!info.batch || !Array.isArray(payload) || payload.length !== info.mask.length) return response;
      for (let index = 0; index < info.mask.length; index++) {
        if (info.mask[index]) payload[index] = videoAdDeclineEntry();
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    } catch (_) {
      return response;
    }
  }

  function settleGqlFetch(pending, adInfo) {
    if (!adInfo) return pending;
    if (adInfo.all) {
      try { return Promise.resolve(fetchAdsNoFillResponse(adInfo)); } catch (_) { return pending; }
    }
    return Promise.resolve(pending).then((response) => redactFetchAdsResponse(response, adInfo));
  }

  function settleVideoAdDecline(pending, declineInfo) {
    if (!declineInfo) return pending;
    if (declineInfo.all) {
      try { return Promise.resolve(videoAdDeclineResponse(declineInfo)); } catch (_) { return pending; }
    }
    return Promise.resolve(pending).then((response) => redactVideoAdDeclineResponse(response, declineInfo));
  }

  // Twitch's own player must know a break is coming to render its ad countdown,
  // and it asks the ad service over GQL -- traffic the page hook already sees.
  // That lands earlier than the playlist admits anything, and the residual leak is
  // precisely the segments fetched before the playlist confesses.
  function validChannelName(value) {
    const channel = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_]{1,25}$/i.test(channel) ? channel : '';
  }

  function announceAdImminent(channelHint) {
    lastAdImminentAt = Date.now();
    const channel = validChannelName(channelHint) || pageChannelName();
    lastAdImminentChannel = channel;
    for (const worker of workers) {
      try { worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'ad-imminent', channel: channel }); } catch (_) {}
    }
  }

  function noteAdServiceBody(body) {
    try {
      if (typeof body !== 'string' || !body) return;
      const names = new Set();
      let channel = '';
      try {
        const parsed = JSON.parse(body);
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue;
          const name = String(entry.operationName || '');
          if (name) names.add(name);
          if (name !== 'FetchAdsService_FetchAds' && !/^Ads?_|^AdRequest|^AdContext/.test(name)) continue;
          const variables = entry.variables || {};
          const input = variables.input && typeof variables.input === 'object' ? variables.input : {};
          const inputChannel = input.channel && typeof input.channel === 'object' ? input.channel : {};
          channel = channel || validChannelName(variables.channelLogin || variables.login ||
            variables.channel || variables.channelName || input.channelLogin || input.login ||
            inputChannel.login || input.channelName);
        }
      } catch (_) {}
      const re = /"operationName"\s*:\s*"([A-Za-z0-9_]+)"/g;
      let m;
      while ((m = re.exec(body))) names.add(m[1]);
      // Anchored, not substring: 'Broadcaster', 'GlobalBadges' and 'IsAdult' all
      // contain "ad" and fire constantly. These four are the player actually
      // transacting with the ad service.
      const interesting = Array.from(names).filter((n) =>
        n === 'FetchAdsService_FetchAds' || n === 'VideoAdRequestDecline' ||
        /^Ads?_|^AdRequest|^AdContext/.test(n));
      if (!interesting.length) return;
      // A pre-roll on a channel switch fires this while the player is still
      // rebuilding its worker, so a live broadcast alone reaches nobody. Record it
      // and replay on handshake, exactly as the master is replayed.
      announceAdImminent(channel);
    } catch (_) {}
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
      if (match) return decodeURIComponent(match[1]).toLowerCase();
      const queryChannel = new URL(location.href).searchParams.get('channel') || '';
      return /^[a-z0-9_]{1,25}$/i.test(queryChannel) ? queryChannel.toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  function channelFromMasterUrl(url) {
    const match = /\/api\/(?:v2\/)?channel\/hls\/([^/?#]+)\.m3u8/i.exec(String(url || ''));
    if (!match) return '';
    try { return decodeURIComponent(match[1]).toLowerCase(); } catch (_) { return match[1].toLowerCase(); }
  }

  let lastMaster = null;
  const masterSnapshots = new Map();
  let lastAdImminentAt = 0;
  let lastAdImminentChannel = '';

  function broadcastMaster(url, text) {
    if (!text) return;
    const fetchedChannel = channelFromMasterUrl(url);
    const currentChannel = pageChannelName();
    const channel = fetchedChannel || currentChannel;
    if (!channel) return;
    const snapshot = { url: url, text: text, channel: channel, at: Date.now() };
    masterSnapshots.delete(channel);
    masterSnapshots.set(channel, snapshot);
    for (const [name, cached] of masterSnapshots) {
      if (!cached || Date.now() - cached.at >= 120000) masterSnapshots.delete(name);
    }
    while (masterSnapshots.size > 6) masterSnapshots.delete(masterSnapshots.keys().next().value);
    const current = !currentChannel || currentChannel === channel;
    // On a fresh load the master is fetched before the player creates its worker,
    // so a live broadcast alone would reach nobody. Keep the last one and replay
    // it on handshake -- that is precisely the pre-roll case. A SPA can fetch the
    // next channel before location.pathname changes, so cache/map that master too
    // without activating it over the stream that is still current.
    if (current) lastMaster = snapshot;
    for (const worker of workers) {
      try {
        worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'master', url: url, text: text,
          channel: channel, current: current });
      } catch (_) {}
    }
  }

  function currentMasterSnapshot() {
    const currentChannel = pageChannelName();
    if (currentChannel) {
      const cached = masterSnapshots.get(currentChannel);
      if (cached && Date.now() - cached.at < 120000) return cached;
      if (lastMaster && currentChannel === lastMaster.channel) return lastMaster;
      return null;
    }
    if (!lastMaster) return null;
    if (!currentChannel && Date.now() - lastMaster.at < 120000) return lastMaster;
    return null;
  }

  function currentAdWarningSnapshot() {
    if (!lastAdImminentAt || Date.now() - lastAdImminentAt >= 12000) return null;
    const currentChannel = pageChannelName();
    if (lastAdImminentChannel && currentChannel && lastAdImminentChannel !== currentChannel) return null;
    return { at: lastAdImminentAt, channel: lastAdImminentChannel || currentChannel || '' };
  }

  // Refusing the ad request is what strands a break. The player will not leave
  // its ad state until that request settles, so a blocked one leaves the picture
  // frozen behind an ad that never arrives -- which is what the media
  // compatibility rules mean by needing to "advance the ad lifecycle", and why
  // this is answered on the page rather than blocked at the network layer.
  //
  // 204 specifically, because that is Twitch's OWN no-fill path rather than a
  // convention we hope it honours. Its ad SDK branches on the status first:
  // 204 resolves the request immediately with an empty result and reports
  // available_impressions: 0, while any 200 is content-type sniffed, parsed and
  // run through a bid validator that throws on anything it does not recognise.
  // So a 204 is the one answer that cannot become an exception, and it carries
  // no body to get the shape wrong with. Answering here also means the request
  // is never issued, so there is no CORS surface and no extension resource for
  // a page to probe.
  //
  // Fetch can be settled locally with a real Response. XHR is deliberately left
  // native below because throwing from open() strands the SDK lifecycle, while a
  // partial synthetic XHR is observably incompatible with Twitch's player.
  function emptyAdResponse() {
    return new Response(null, { status: 204, statusText: 'No Content' });
  }

  function forwardPageGql(context, input, init, body, requestBody) {
    noteAdServiceBody(body);
    const tokenPlan = playbackTokenPlan(body);
    if (tokenPlan && tokenPlan.allPip) {
      try { return Promise.resolve(deniedPlaybackTokenResponse(tokenPlan)); } catch (_) {}
    }
    const forwardedBody = tokenPlan && tokenPlan.changed ? tokenPlan.body : body;
    const adInfo = fetchAdsRequestInfo(forwardedBody);
    const declineInfo = videoAdDeclineRequestInfo(forwardedBody);
    let pending = null;
    if (adInfo && adInfo.all) {
      pending = settleGqlFetch(null, adInfo);
    } else if (declineInfo && declineInfo.all) {
      pending = settleVideoAdDecline(null, declineInfo);
    } else {
      let forwardedInput = input;
      let forwardedInit = init;
      if (tokenPlan && tokenPlan.changed) {
        if (requestBody) {
          forwardedInput = new Request(input, Object.assign({}, init || {}, { body: forwardedBody }));
        } else {
          forwardedInit = Object.assign({}, init || {}, { body: forwardedBody });
        }
      }
      pending = nativeFetch.call(context, forwardedInput, forwardedInit);
      pending = settleVideoAdDecline(settleGqlFetch(pending, adInfo), declineInfo);
    }
    if (!tokenPlan || !tokenPlan.hasPip) return pending;
    return Promise.resolve(pending).then(async (response) => {
      const rebuilt = await spliceDeniedPlaybackTokens(response, tokenPlan);
      return rebuilt || response;
    });
  }

  function installFetchHook() {
    if (typeof nativeFetch !== 'function' || nativeFetch.__woTwitchCurrent) return;
    function twitchFetch(input, init) {
      const url = requestUrl(input);
      if (enabled && AD_SERVICE_URL_RE.test(url)) {
        if (VIDEO_AD_SERVICE_URL_RE.test(url)) announceAdImminent();
        try { return Promise.resolve(emptyAdResponse()); } catch (_) {}
      }
      // The player fetches the master on the page, then hands media URLs to a
      // worker created afterwards. That worker never sees the master, so its
      // media map stays empty, every lookup misses, and the whole clean-backup
      // path is skipped -- which is why ads used to fall through to the gapper
      // and stay visible. Mirror the master into the workers, passively.
      if (enabled && MASTER_URL_RE.test(url)) {
        const pending = nativeFetch.apply(this, arguments);
        try {
          return Promise.resolve(pending).then(async (response) => {
            try {
              if (response && response.ok) {
                const text = await response.clone().text();
                broadcastMaster(response.url || url, text);
              }
            } catch (_) {}
            return response;
          });
        } catch (_) {}
        return pending;
      }
      // Token/header capture is passive and byte-preserving, so keep it alive
      // during the short media recovery window. Otherwise the replacement worker
      // resumes with stale identity state and every clean-token attempt can fail.
      if (!enabled || !GQL_URL_RE.test(url)) return nativeFetch.apply(this, arguments);
      captureClientState(input, init);
      if (init && typeof init.body === 'string') {
        return forwardPageGql(this, input, init, init.body, false);
      } else if (typeof Request !== 'undefined' && input instanceof Request &&
                 String(init && init.method || input.method || '').toUpperCase() === 'POST') {
        const context = this;
        const originalInit = init;
        return input.clone().text().then((body) => {
          return forwardPageGql(context, input, originalInit, body, true);
        }, () => nativeFetch.call(context, input, originalInit));
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

  function installXhrHook() {
    if (typeof nativeXhrOpen !== 'function' || nativeXhrOpen.__woTwitchCurrent) return;
    function twitchXhrOpen(method, url) {
      const target = String(url || '');
      if (enabled && AD_SERVICE_URL_RE.test(target)) {
        if (VIDEO_AD_SERVICE_URL_RE.test(target)) announceAdImminent();
      }
      return nativeXhrOpen.apply(this, arguments);
    }
    try {
      Object.defineProperty(twitchXhrOpen, '__woTwitchCurrent', { value: VERSION });
      twitchXhrOpen.toString = Function.prototype.toString.bind(nativeXhrOpen);
      NativeXMLHttpRequest.prototype.open = twitchXhrOpen;
    } catch (_) {}
  }

  const adManagerState = {
    attempts: 0,
    timer: 0,
    manager: null,
    declinedByWarden: false
  };

  function twitchWebpackRequires() {
    const runtimes = [];
    try {
      const keys = Object.keys(window).filter((name) => /^webpackChunk/i.test(name));
      for (const key of keys) {
        try {
          const queue = window[key];
          if (!queue || typeof queue.push !== 'function') continue;
          let requireFn = null;
          const entry = [[Symbol('wardenone-twitch')], {}, (runtimeRequire) => { requireFn = runtimeRequire; }];
          queue.push(entry);
          if (!requireFn) {
            const index = queue.indexOf(entry);
            if (index !== -1) queue.splice(index, 1);
          } else if (!runtimes.includes(requireFn)) {
            runtimes.push(requireFn);
          }
        } catch (_) {}
      }
    } catch (_) {}
    return runtimes;
  }

  function findTwitchAdManager(requireFns) {
    for (const requireFn of requireFns || []) {
      const factories = requireFn && requireFn.m || {};
      for (const id of Object.keys(factories)) {
        let source = '';
        try { source = Function.prototype.toString.call(factories[id]); } catch (_) { continue; }
        if (source.indexOf('startProcessingRequests') < 0 || source.indexOf('declineReason') < 0) continue;
        let exports = null;
        try { exports = requireFn(id); } catch (_) { continue; }
        if (!exports) continue;
        for (const name of Object.keys(exports)) {
          let candidate = null;
          try { candidate = exports[name]; } catch (_) { continue; }
          if (typeof candidate === 'function' && typeof candidate.startProcessingRequests === 'function' &&
              typeof candidate.decline === 'function') return candidate;
        }
      }
    }
    return null;
  }

  function releaseAdManagerDecline() {
    if (adManagerState.timer) clearTimeout(adManagerState.timer);
    adManagerState.timer = 0;
    adManagerState.attempts = 0;
    if (adManagerState.declinedByWarden && adManagerState.manager) {
      try {
        if (String(adManagerState.manager.declineReason || '') === 'player_size') {
          adManagerState.manager.declineReason = null;
        }
      } catch (_) {}
    }
    adManagerState.declinedByWarden = false;
  }

  function syncAdManagerDecline() {
    if (!enabled) {
      releaseAdManagerDecline();
      return;
    }
    if (adManagerState.declinedByWarden || adManagerState.timer) return;
    const attempt = () => {
      adManagerState.timer = 0;
      if (!enabled || adManagerState.declinedByWarden) return;
      adManagerState.attempts++;
      try {
        const manager = findTwitchAdManager(twitchWebpackRequires());
        if (manager) {
          adManagerState.manager = manager;
          if (!manager.declineReason) {
            manager.decline('player_size', { sendEvent: false });
            adManagerState.declinedByWarden = String(manager.declineReason || '') === 'player_size';
          }
          if (manager.declineReason) return;
        }
      } catch (_) {}
      if (adManagerState.attempts < 240) adManagerState.timer = woTimeout(attempt, 500);
    };
    attempt();
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
      const gate = 'html[data-wo-twitch-adblock="blocked-clean"] ';
      // Honest status of this list: the exact-match badge selectors that used to
      // live here were byte-identical to ungated rules in adCss above, and the
      // badge was still visible during a live swap, so they demonstrably no
      // longer match anything. What follows is a better-evidenced replacement,
      // NOT a verified fix. Neither reported symptom is confirmed closed: the
      // "Ad" badge is still guesswork, and the "Commercial break in progress"
      // placeholder is identified by its text, which CSS cannot match at all --
      // only the Turbo/allow-ads link inside the same overlay is addressable.
      //
      // Structural rule for everything below: a selector that can match an
      // ANCESTOR of the live <video> carries a :not(:has(video)) guard, because
      // display:none on an ancestor blanks the whole picture for the break --
      // far worse than the chrome it was meant to hide.
      //
      // Leaf-shaped ad markers only. Kept free of :has() so an engine without it
      // still applies them.
      const leafSelectors = [
        '[data-a-target*="ad-countdown" i]',
        '[class*="circle-countdown" i]'
      ];
      // Substring supersets of markers Twitch has used, plus the aria-labelled
      // chrome. Each of these can name a wrapper as easily as a badge, so none of
      // them is allowed to match an element that contains a video. The :where()
      // list additionally spares the player's own identities by name.
      const wrapperSelectors = [
        '[data-a-target*="video-ad" i]',
        '[aria-label*="advertisement" i]',
        '.video-player__ad-info-container'
      ];
      const notPlayer = ':not(:has(video))' +
        ':not(:where(video,.video-player,.video-player__container,[data-a-target="video-player"],[data-a-target="video-ref"]))';
      // The picture-by-picture "watch while the ad plays" box. Twitch sometimes
      // wraps the GENUINE live stream in it, and hiding it then blanks the player
      // -- src/content.js:9068 refuses the same box for the same reason, using
      // the video container identity that is included here as the third test.
      const pbypBoxes = ['.picture-by-picture-player', '[data-a-target="pbyp-player-instance"]'];
      const notLiveBox = ':not(:has(video[aria-label="Twitch video player" i]))' +
        ':not(:has([data-a-target="video-ref"]))' +
        ':not(:has([data-test-selector="video-player__video-container"]))';
      style.textContent = leafSelectors.map((sel) => gate + sel).join(',') + '{display:none!important;}\n' +
        wrapperSelectors.map((sel) => gate + sel + notPlayer).join(',') + '{display:none!important;}\n' +
        pbypBoxes.map((sel) => gate + sel + notLiveBox).join(',') + '{display:none!important;}\n' +
        // Scoped under an ad box on purpose. The reference implementation hides
        // this overlay only once a non-live pbyp box was actually found
        // (src/content.js:9087); hiding it unconditionally would strip the chrome
        // off the very box the rule above deliberately spares.
        pbypBoxes.map((sel) => gate + sel + notLiveBox + ' .picture-by-picture-overlay').join(',') +
        '{display:none!important;}\n' +
        // The purple full-player "allow ads / get Turbo" gate. Matched by content
        // rather than by class, because the wrapper classes also back the pause,
        // loading and mature-content screens.
        gate + TWITCH_TURBO_OVERLAY_SELECTOR + '{display:none!important;}';
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
        !['mobile_feed', 'popout', 'autoplay', 'site', 'mobile_web', 'embed'].includes(playerType)) {
      fail('Rejected invalid GQL proxy request');
      return;
    }
    let timer = 0;
    let controller = null;
    try {
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) timer = woTimeout(() => controller.abort(), 3500);
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

  function applyWorkerAdState(worker, state) {
    const blocking = state === 'blocked-clean';
    if (blocking) {
      blockingWorkers.add(worker);
      workerAdStates.set(worker, state);
      lastStreamInterventionAt = Date.now();
      installAdChromeCss();
    } else {
      blockingWorkers.delete(worker);
      workerAdStates.delete(worker);
    }
    const stillBlocking = blockingWorkers.size > 0;
    try {
      if (stillBlocking) {
        const visibleState = workerAdStates.values().next().value || 'blocked-clean';
        document.documentElement.setAttribute('data-wo-twitch-adblock', visibleState);
      } else {
        document.documentElement.removeAttribute('data-wo-twitch-adblock');
      }
    } catch (_) {}
  }

  function releaseWorkerAdState(worker) {
    const wasBlocking = blockingWorkers.has(worker);
    blockingWorkers.delete(worker);
    workerAdStates.delete(worker);
    if (!wasBlocking) return;
    if (blockingWorkers.size === 0) {
      try { document.documentElement.removeAttribute('data-wo-twitch-adblock'); } catch (_) {}
    } else {
      try {
        const visibleState = workerAdStates.values().next().value || 'blocked-clean';
        document.documentElement.setAttribute('data-wo-twitch-adblock', visibleState);
      } catch (_) {}
    }
  }

  function twitchWorkerRuntime(originalSource, initialState, runtimeVersion, initiallyEnabled,
      initialMaster, initialAdWarning) {
    'use strict';

    const FLAG = '__woTwitchAdblock';
    // Twitch's current manifests use both the longer twitch-stitched-ad class
    // and shorter stitched identifiers. Match the signifier as a token so a
    // marker-only spelling change cannot turn the entire ad pod into clean media.
    const AD_MARKER_RE = /\bstitched\b|#EXT-X-CUE-OUT|CLASS="twitch-maf-ad"|CLASS="twitch-trigger"/i;
    const STRONG_AD_METADATA_RE = /(?:X-TV-TWITCH-AD-(?:RADS-TOKEN|ROLL-TYPE|POD-|ADVERTISER|CREATIVE|LINE-ITEM|ORDER-ID)|X-TTV-MAF-AD-[A-Z0-9-]+)/i;
    // Twitch's own player has to know a break is coming in order to render its
    // countdown, and it asks over GQL -- which the page already sees. That is
    // earlier than the playlist admits anything, and the front-of-break leak is
    // exactly the segments fetched before the playlist confesses. Treat the ad
    // service call as the warning it is.
    const AD_IMMINENT_MS = 12000;
    let genericAdImminentUntil = 0;
    const adImminentByChannel = new Map();
    const AD_URI_RE = /\/(?:adsquared|_404)\/|\/stitched-ad(?:[-_.\/]|$)/i;
    const LOW_LATENCY_TAG_RE = /^#EXT-X-(?:SERVER-CONTROL|PART-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SKIP|TWITCH-PREFETCH)\b/i;
    const GQL_RE = /^https:\/\/gql\.twitch\.tv\/gql(?:[?#]|$)/i;
    const MEDIA_TTL = 5 * 60 * 1000;
    const BACKUP_TTL = 2 * 60 * 1000;
    const BACKUP_STALE_MS = 8 * 1000;
    // A warning-time playlist refresh can finish just before the native ad poll.
    // Keep that already-validated body only long enough to bridge the two requests;
    // older media is polled and validated again before it can be served.
    const BACKUP_PRIME_MS = 2 * 1000;
    const BACKUP_SEARCH_TIMEOUT_MS = 2400;
    const NEGATIVE_TTL = 30 * 1000;
    const MEDIA_MAX = 128;
    const BACKUP_MAX = 12;
    const BACKUP_WAIT_MS = 900;
    // A pre-roll is the one break where nothing is playing yet, so holding the
    // first media playlist costs start-up latency instead of freezing video the
    // viewer is already watching. A cold pre-roll loses the 900ms race by only a
    // few hundred ms -- every leg is cold because there is no preceding clean
    // poll to have warmed anything -- so give just that case a longer budget. A
    // mid-roll keeps the short one on purpose.
    const PREROLL_BACKUP_WAIT_MS = 2500;
    // Clean alternate media legs on distant Twitch regions can take 700-900ms
    // while cold. A 650ms abort discarded a valid popout/mobile stream before
    // the 2.5s pre-roll budget could use it. This remains below that outer budget
    // and does not delay mid-roll fallback, whose own wait stays bounded at 900ms.
    const BACKUP_POLL_TIMEOUT_MS = 1500;
    const COMPLETE_MEDIA_RETRY_MS = 650;
    const NATIVE_RELEASE_POLLS = 3;
    const AD_QUARANTINE_MAX_MS = 120 * 1000;
    const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
    const TOKEN_QUERY = 'query PlaybackAccessToken($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {' +
      ' streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature }' +
      ' videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature }' +
      ' }';
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
    const backupControllers = new Set();
    const sequenceStates = new Map();
    let backupEpoch = 0;
    let activeChannel = '';
    let activeMediaProfile = null;
    let activeMasterGeneration = 0;
    let activeMasterUrl = '';
    let activeMasterText = '';

    function invalidateBackupWork(clearSequences) {
      backupEpoch++;
      for (const controller of Array.from(backupControllers)) {
        try { controller.abort(); } catch (_) {}
      }
      backupControllers.clear();
      for (const pending of pendingGql.values()) {
        try { clearTimeout(pending.timer); } catch (_) {}
        try { pending.reject(new Error('backup session changed')); } catch (_) {}
      }
      pendingGql.clear();
      backups.clear();
      pendingBackups.clear();
      pendingBackupPolls.clear();
      if (clearSequences) sequenceStates.clear();
    }

    function interventionCurrent(info, epoch) {
      if (!active || epoch !== backupEpoch) return false;
      return !info || !info.masterGeneration ||
        Number(info.masterGeneration) === Number(activeMasterGeneration);
    }

    function post(type, extra) {
      try {
        self.postMessage(Object.assign({ [FLAG]: runtimeVersion, type: type }, extra || {}));
      } catch (_) {}
    }

    function wlog(m) { post('log', { m: m }); }

    function workerChannelName(value) {
      const channel = String(value || '').trim().toLowerCase();
      return /^[a-z0-9_]{1,25}$/i.test(channel) ? channel : '';
    }

    function adWarningActive(channel) {
      const now = Date.now();
      if (genericAdImminentUntil > now) return true;
      const wanted = workerChannelName(channel);
      return !!wanted && Number(adImminentByChannel.get(wanted) || 0) > now;
    }

    function armAdWarning(channel, notifyPage) {
      const wanted = workerChannelName(channel);
      const until = Date.now() + AD_IMMINENT_MS;
      if (wanted) adImminentByChannel.set(wanted, until);
      else genericAdImminentUntil = until;
      if (notifyPage) post('ad-imminent', { channel: wanted });
      try {
        const profile = fallbackVariant(activeChannel);
        if (profile && adWarningActive(profile.channel)) {
          const pending = primeBackupForAd(profile);
          if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        }
      } catch (_) {}
    }

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
      // Cursor removal is needed only while this channel/session is returning an
      // ordinary alternate playlist that cannot satisfy the native part cursor.
      const state = sequenceStateFor(info);
      if (!state || !state.backupActive) return input;
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

    function clearNativeIntervention(info) {
      const state = sequenceStateFor(info);
      if (state) state.backupActive = false;
    }

    async function fetchNativeMedia(input, init, url, info) {
      const forwarded = nativeMediaInput(input, url, info);
      const changed = urlOf(forwarded) !== url;
      try {
        const response = await realFetch(forwarded, init);
        if (!changed || (response && response.ok)) return { response: response, changed: changed };
      } catch (error) {
        if (!changed) throw error;
      }
      clearNativeIntervention(info);
      setAdState('clear', info && info.channel || '');
      return { response: await realFetch(input, init), changed: false, retriedExact: true };
    }

    async function retryCompleteMediaPlaylist(input, init, url) {
      const ordinaryUrl = withoutLowLatencyQuery(url);
      if (!ordinaryUrl || ordinaryUrl === url || typeof AbortController !== 'function') return null;
      const controller = new AbortController();
      const linkedSignals = [];
      const relayAbort = () => {
        try { controller.abort(); } catch (_) {}
      };
      try {
        if (init && init.signal) linkedSignals.push(init.signal);
        if (typeof Request !== 'undefined' && input instanceof Request && input.signal &&
            !linkedSignals.includes(input.signal)) linkedSignals.push(input.signal);
      } catch (_) {}
      for (const signal of linkedSignals) {
        try {
          if (signal.aborted) relayAbort();
          else signal.addEventListener('abort', relayAbort, { once: true });
        } catch (_) {}
      }
      let timer = 0;
      try {
        timer = setTimeout(relayAbort, COMPLETE_MEDIA_RETRY_MS);
        let retryInput = ordinaryUrl;
        try {
          if (typeof Request !== 'undefined' && input instanceof Request) {
            retryInput = new Request(ordinaryUrl, input);
          }
        } catch (_) {
          retryInput = ordinaryUrl;
        }
        const retryInit = Object.assign({}, init || {}, { signal: controller.signal });
        const response = await realFetch(retryInput, retryInit);
        if (!response || !response.ok) return null;
        const text = await response.clone().text();
        if (!mediaPlaylistEnvelope(text)) return null;
        const evidence = playlistEvidence(text);
        if (evidence.fullPlayable < 1) return null;
        return { response: response, text: text, evidence: evidence };
      } catch (_) {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
        for (const signal of linkedSignals) {
          try { signal.removeEventListener('abort', relayAbort); } catch (_) {}
        }
      }
    }

    function mediaRequestAborted(input, init) {
      try {
        if (init && init.signal && init.signal.aborted) return true;
        return typeof Request !== 'undefined' && input instanceof Request &&
          input.signal && input.signal.aborted;
      } catch (_) {
        return false;
      }
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

    function videoCodecFamily(codecs) {
      const first = String(codecs || '').split(',')[0].trim().toLowerCase().split('.')[0];
      if (first === 'hev1' || first === 'hvc1') return 'hevc';
      if (first === 'avc1' || first === 'avc3') return 'avc';
      if (first === 'av01') return 'av1';
      return first;
    }

    function audioCodecFamily(codecs) {
      const values = String(codecs || '').split(',').slice(1)
        .map((codec) => codec.trim().toLowerCase().split('.')[0]).filter(Boolean);
      return values.sort().join(',');
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

    function rankVariants(variants, wanted) {
      if (!variants || !variants.length) return null;
      const wantedCodecs = codecSignature(wanted && wanted.codecs);
      const wantedVideoFamily = videoCodecFamily(wanted && wanted.codecs);
      const wantedAudioFamily = audioCodecFamily(wanted && wanted.codecs);
      // The existing SourceBuffer can accept another rendition in the same video
      // decoder family, but not an AVC/HEVC/AV1 switch. Audio families must also
      // agree; the later media-container probe rejects MPEG-TS/CMAF crossings.
      if (!wantedVideoFamily) return null;
      let pool = variants.filter((variant) =>
        videoCodecFamily(variant.codecs) === wantedVideoFamily &&
        (!wantedAudioFamily || !audioCodecFamily(variant.codecs) ||
          audioCodecFamily(variant.codecs) === wantedAudioFamily));
      if (!pool.length) return null;
      if (wanted && wanted.audio) pool = pool.filter((variant) => variant.audio === wanted.audio);
      if (wanted && wanted.subtitles) pool = pool.filter((variant) => variant.subtitles === wanted.subtitles);
      if (!pool.length) return null;
      const targetArea = resolutionArea(wanted && wanted.resolution);
      return pool.slice().sort((left, right) => {
        const score = (variant) => {
          const exactCodecs = codecSignature(variant.codecs) === wantedCodecs ? 0 : 1;
          const exactVideo = variant.video && variant.video === wanted.video ? 0 : 1;
          const exactResolution = variant.resolution === wanted.resolution ? 0 : 1;
          const exactFps = !wanted.fps || variant.fps === wanted.fps ? 0 : 1;
          return [exactCodecs, exactVideo, exactResolution, exactFps,
            Math.abs(resolutionArea(variant.resolution) - targetArea),
            Math.abs(Number(variant.bandwidth || 0) - Number(wanted.bandwidth || 0))];
        };
        const a = score(left);
        const b = score(right);
        for (let index = 0; index < a.length; index++) {
          if (a[index] !== b[index]) return a[index] - b[index];
        }
        return 0;
      });
    }

    function chooseVariant(variants, wanted) {
      const ranked = rankVariants(variants, wanted);
      return ranked && ranked[0] || null;
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
      const authoritativeAdMetadata = STRONG_AD_METADATA_RE.test(source);
      const strongMetadata = authoritativeAdMetadata || /stitched-ad/i.test(source) || exactStitchedRange;
      const ranges = timedAdRanges(lines);
      const hasMarker = AD_MARKER_RE.test(source) || strongMetadata || ranges.length > 0;
      const explicitPreroll = /X-(?:TV-TWITCH|TTV-MAF)-AD-ROLL-TYPE\s*=\s*"?PREROLL"?/i.test(source);
      const hasLiveTitle = lines.some((line) => /^#EXTINF:.*?,\s*live\s*$/i.test(line));
      const sequenceLine = lines.find((line) => /^#EXT-X-MEDIA-SEQUENCE:/i.test(line));
      const targetLine = lines.find((line) => /^#EXT-X-TARGETDURATION:/i.test(line));
      const mediaSequence = Number(String(sequenceLine || '').replace(/^#EXT-X-MEDIA-SEQUENCE:/i, ''));
      const targetDuration = Number(String(targetLine || '').replace(/^#EXT-X-TARGETDURATION:/i, '')) || 2;
      const advertisedDuration = advertisedAdDuration(lines, ranges);
      const fullAds = new Set();
      const inlineAds = new Set();
      let playable = 0;
      let fullPlayable = 0;
      let explicitLive = 0;
      let confirmed = 0;
      let cueActive = false;
      let cueRemaining = 0;
      let authoritativeRemaining = authoritativeAdMetadata
        ? Math.max(advertisedDuration, targetDuration)
        : 0;
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
          const authoritativeScoped = authoritativeRemaining > 0 &&
            (!Number.isFinite(programTime) || !ranges.length);
          const markerScoped = hasMarker && !isLiveTitle &&
            (explicitlyNonLive || hasLiveTitle || (strongMetadata && !hasLiveTitle));
          if (AD_URI_RE.test(uri) || cueActive || markerScoped || authoritativeScoped ||
              overlapsTimedAd(ranges, programTime, duration)) {
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
          if (authoritativeRemaining > 0 && duration > 0) {
            authoritativeRemaining = Math.max(0, authoritativeRemaining - duration);
          }
          if (Number.isFinite(programTime) && duration > 0) programTime += duration * 1000;
          continue;
        }
        if (/^#EXT-X-PART:/i.test(line)) {
          playable++;
          const uri = taggedUri(line);
          const partDuration = Number(parseAttributes(line).DURATION || 0);
          const authoritativeScoped = authoritativeRemaining > 0 &&
            (!Number.isFinite(programTime) || !ranges.length);
          if (AD_URI_RE.test(uri) || cueActive || (hasMarker && strongMetadata && !hasLiveTitle) ||
              authoritativeScoped || overlapsTimedAd(ranges, programTime, partDuration)) {
            inlineAds.add(index);
            confirmed++;
          }
          if (authoritativeRemaining > 0 && partDuration > 0) {
            authoritativeRemaining = Math.max(0, authoritativeRemaining - partDuration);
          }
          if (Number.isFinite(programTime) && partDuration > 0) programTime += partDuration * 1000;
          continue;
        }
        if (/^#EXT-X-PRELOAD-HINT:/i.test(line)) {
          const uri = taggedUri(line);
          const authoritativeScoped = authoritativeRemaining > 0 &&
            (!Number.isFinite(programTime) || !ranges.length);
          if (AD_URI_RE.test(uri) || cueActive || (hasMarker && strongMetadata && !hasLiveTitle) ||
              authoritativeScoped) {
            playable++;
            confirmed++;
            inlineAds.add(index);
          }
          continue;
        }
        if (/^#EXT-X-TWITCH-PREFETCH:/i.test(line)) {
          const uri = line.replace(/^#EXT-X-TWITCH-PREFETCH:/i, '').trim();
          const authoritativeScoped = authoritativeRemaining > 0 &&
            (!Number.isFinite(programTime) || !ranges.length);
          if (AD_URI_RE.test(uri) || cueActive || (hasMarker && strongMetadata && !hasLiveTitle) ||
              authoritativeScoped) {
            playable++;
            confirmed++;
            inlineAds.add(index);
            authoritativeRemaining = Math.max(0, authoritativeRemaining - targetDuration);
          }
        }
      }
      return {
        lines: lines,
        hasMarker: hasMarker,
        strongMetadata: strongMetadata,
        explicitPreroll: explicitPreroll,
        playable: playable,
        fullPlayable: fullPlayable,
        explicitLive: explicitLive,
        confirmed: confirmed,
        mediaSequence: Number.isFinite(mediaSequence) ? mediaSequence : NaN,
        targetDuration: targetDuration,
        // Wall clock of the end of the playlist, walked forward from the last
        // PROGRAM-DATE-TIME. NaN when the manifest carries no date at all, which
        // is a refusal upstream rather than a zero.
        edgeWall: Number.isFinite(programTime) ? programTime : NaN,
        advertisedDuration: advertisedDuration,
        fullAds: fullAds,
        inlineAds: inlineAds
      };
    }

    const SEQUENCE_TAG = '#EXT-X-MEDIA-SEQUENCE:';
    const SEQUENCE_STEP_TOLERANCE = 6;

    function sequenceStateFor(info) {
      const channel = workerChannelName(info && info.channel) || channelFromMaster(info && info.master);
      if (!channel) return null;
      const key = channel + '|' + Number(info && info.masterGeneration || activeMasterGeneration || 0);
      let state = sequenceStates.get(key);
      if (!state) {
        state = {
          seqOffset: 0,
          seqBackupOffset: 0,
          seqHeads: Object.create(null),
          seqSnapshots: Object.create(null),
          nativeObserved: Object.create(null),
          seqServedHead: null,
          seqInBreak: false,
          seqSource: null,
          seqServedPdt: undefined,
          seqServedNumber: undefined,
          backupActive: false,
          adActive: false,
          lastConfirmedAdAt: 0,
          adUntilSequence: 0,
          adSequenceUrl: '',
          cleanNativePolls: 0,
          cleanCandidateUrl: '',
          cleanCandidateSequence: null,
          cleanCandidatePdt: null,
          lastNativeText: '',
          lastNativeUrl: '',
          lastBridgeKey: ''
        };
        sequenceStates.set(key, state);
        while (sequenceStates.size > 8) sequenceStates.delete(sequenceStates.keys().next().value);
      }
      return state;
    }

    function sequenceRead(text) {
      const source = String(text || '');
      const at = source.indexOf(SEQUENCE_TAG);
      if (at < 0) return null;
      const end = source.indexOf('\n', at);
      const value = parseInt(source.substring(at + SEQUENCE_TAG.length, end < 0 ? source.length : end), 10);
      return Number.isFinite(value) ? value : null;
    }

    function sequenceWrite(text, value) {
      const source = String(text || '');
      const at = source.indexOf(SEQUENCE_TAG);
      if (at < 0 || !Number.isFinite(value) || value < 0) return null;
      let end = source.indexOf('\n', at);
      if (end < 0) end = source.length;
      if (end > 0 && source.charAt(end - 1) === '\r') end--;
      return source.substring(0, at) + SEQUENCE_TAG + Math.round(value) + source.substring(end);
    }

    function sequenceSegments(text) {
      const segments = [];
      let pdt = null;
      for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
        if (line.indexOf('#EXT-X-PROGRAM-DATE-TIME:') === 0) {
          pdt = Date.parse(line.slice(25));
        } else if (line.indexOf('#EXTINF:') === 0) {
          const duration = parseFloat(line.slice(8)) || 0;
          segments.push({ pdt: Number.isFinite(pdt) ? pdt : null, duration: duration });
          if (Number.isFinite(pdt) && duration > 0) pdt += duration * 1000;
        }
      }
      return segments;
    }

    function sequenceSkippedSegments(text) {
      let found = false;
      let value = 0;
      for (const rawLine of String(text || '').replace(/\r/g, '').split('\n')) {
        const line = String(rawLine || '').trim();
        if (line.toUpperCase().indexOf('#EXT-X-SKIP:') !== 0) continue;
        if (found) return null;
        found = true;
        const attributes = line.replace(/^[^:]*:/, '');
        const occurrences = attributes.match(/(?:^|,)SKIPPED-SEGMENTS=/gi);
        if (!occurrences || occurrences.length !== 1) return null;
        const skipped = Number(parseAttributes(line)['SKIPPED-SEGMENTS']);
        if (!Number.isSafeInteger(skipped) || skipped < 0) return null;
        value = skipped;
      }
      return found ? value : 0;
    }

    function sequenceTail(text) {
      const sequence = sequenceRead(text);
      const segments = sequenceSegments(text);
      const last = segments[segments.length - 1];
      if (sequence === null || !last || !Number.isFinite(last.pdt)) return null;
      /* EXT-X-SKIP replaces earlier segment entries but not their logical media
         sequence numbers. Count them for timeline math while preserving the
         original delta playlist bytes and MEDIA-SEQUENCE value. */
      const skipped = sequenceSkippedSegments(text);
      if (skipped === null) return null;
      const count = skipped + segments.length;
      return {
        number: sequence + count - 1,
        pdt: last.pdt,
        sequence: sequence,
        count: count,
        duration: last.duration || 2
      };
    }

    function sequenceNumberAt(text, pdt) {
      const sequence = sequenceRead(text);
      const segments = sequenceSegments(text);
      if (sequence === null || segments.length < 2 || !Number.isFinite(segments[0].pdt) ||
          !Number.isFinite(segments[segments.length - 1].pdt) || !Number.isFinite(pdt)) return null;
      const skipped = sequenceSkippedSegments(text);
      if (skipped === null) return null;
      const firstNumber = sequence + skipped;
      const first = segments[0].pdt;
      const last = segments[segments.length - 1].pdt;
      if (!(last > first)) return null;
      if (pdt >= first && pdt <= last) {
        let at = first;
        for (let index = 0; index < segments.length - 1; index++) {
          const nextPdt = segments[index + 1].pdt;
          const duration = nextPdt !== null && nextPdt !== undefined
            ? nextPdt - at
            : (segments[index].duration || 0) * 1000;
          if (!(duration > 0)) continue;
          if (pdt <= at + duration) return firstNumber + index + (pdt - at) / duration;
          at += duration;
        }
        return firstNumber + segments.length - 1;
      }
      const step = (last - first) / (segments.length - 1);
      if (!(step > 0)) return null;
      const slack = last - first;
      if (pdt < first - slack || pdt > last + slack) return null;
      return firstNumber + (pdt - first) / step;
    }

    function sequenceServe(state, url, text, sequence, field) {
      if (!state || sequence === null) return text;
      const renditionKey = canonical(url);
      const last = state.seqHeads[renditionKey];
      const floor = Math.max(0, last === null || last === undefined ? 0 : last);
      const head = sequence + Number(state[field] || 0);
      if (head < floor) return null;
      state.seqHeads[renditionKey] = head;
      state.seqServedHead = head;
      if (head === sequence) return text;
      return sequenceWrite(text, head) || text;
    }

    function sequenceApplyNative(state, url, text) {
      const served = sequenceServe(state, url, text, sequenceRead(text), 'seqOffset');
      if (served === null) return null;
      sequenceRecordServed(state, url, text, served);
      return served;
    }

    function sequenceProposedOffset(state, text) {
      if (!state || state.seqServedPdt === undefined || state.seqServedNumber === undefined) return false;
      const here = sequenceNumberAt(text, state.seqServedPdt);
      if (here === null) return null;
      return Math.round(state.seqServedNumber - here);
    }

    function sequenceRecordServed(state, url, sourceText, servedText) {
      if (!state) return;
      const tail = sequenceTail(sourceText);
      if (tail && state.seqServedHead !== null && state.seqServedHead !== undefined) {
        state.seqServedPdt = tail.pdt;
        state.seqServedNumber = state.seqServedHead + tail.count - 1;
      }
      state.seqSnapshots[canonical(url)] = servedText;
    }

    function sequenceObserveNative(state, url, text) {
      if (!state) return { key: canonical(url), stale: false, tail: null };
      const key = canonical(url);
      const tail = sequenceTail(text);
      if (!tail) return { key: key, stale: false, tail: null };
      const previous = state.nativeObserved[key];
      const stale = !!previous && (tail.pdt < previous.pdt ||
        (tail.pdt === previous.pdt && tail.number < previous.number));
      if (!stale && (!previous || tail.pdt > previous.pdt || tail.number > previous.number)) {
        state.nativeObserved[key] = { pdt: tail.pdt, number: tail.number };
      }
      return { key: key, stale: stale, tail: tail };
    }

    function sequenceObservationCurrent(state, observation) {
      if (!state || !observation || !observation.tail) return true;
      const latest = state.nativeObserved[observation.key];
      return !!latest && latest.pdt === observation.tail.pdt && latest.number === observation.tail.number;
    }

    function sequenceStaleResponse(state, observation, response) {
      return response;
    }

    function sequenceResetToNative(state, url, text) {
      if (!state) return;
      state.seqOffset = 0;
      state.seqBackupOffset = 0;
      state.seqHeads = Object.create(null);
      state.seqSnapshots = Object.create(null);
      state.seqServedHead = null;
      state.seqServedPdt = undefined;
      state.seqServedNumber = undefined;
      state.seqInBreak = false;
      state.seqSource = null;
      state.backupActive = false;
      const sequence = sequenceRead(text);
      if (sequence === null) return;
      state.seqHeads[canonical(url)] = sequence;
      state.seqServedHead = sequence;
      sequenceRecordServed(state, url, text, text);
    }

    function oneShotNativeBridge(state, url, evidence) {
      if (!state || !state.lastNativeText) return '';
      let cleanEvidence = null;
      try { cleanEvidence = playlistEvidence(state.lastNativeText); } catch (_) {}
      if (!cleanEvidence || cleanEvidence.confirmed > 0 || cleanEvidence.fullPlayable < 1) return '';
      const key = canonical(url) + '|' + String(Number.isFinite(evidence && evidence.mediaSequence)
        ? evidence.mediaSequence : 'parts');
      if (state.lastBridgeKey === key) return '';
      state.lastBridgeKey = key;
      return state.lastNativeText;
    }

    function sequenceNativeBreak(state, url, text) {
      if (!state) return text;
      const previousOffset = state.seqOffset;
      const previousSource = state.seqSource;
      const previousBreak = state.seqInBreak;
      if (state.seqInBreak && state.seqSource !== 'native') {
        const proposed = sequenceProposedOffset(state, text);
        if (proposed === null || proposed === false) return null;
        state.seqOffset = proposed;
      }
      state.seqInBreak = true;
      state.seqSource = 'native';
      const served = sequenceApplyNative(state, url, text);
      if (served === null) {
        state.seqOffset = previousOffset;
        state.seqSource = previousSource;
        state.seqInBreak = previousBreak;
      }
      return served;
    }

    function sequenceOutsideBreak(state, url, text, release) {
      if (!state) return text;
      if (state.seqInBreak && release) {
        const previous = state.seqOffset;
        let proposed = previous;
        if (state.seqSource !== 'native') {
          proposed = sequenceProposedOffset(state, text);
          if (proposed === null || proposed === false) return null;
        }
        const head = sequenceRead(text);
        const tail = sequenceTail(text);
        if (head === null || !tail || state.seqServedNumber === undefined ||
            state.seqServedPdt === undefined) return null;
        const expected = (tail.pdt - state.seqServedPdt) / ((tail.duration || 2) * 1000);
        const actual = head + proposed + tail.count - 1 - state.seqServedNumber;
        if (Math.abs(actual - expected) > SEQUENCE_STEP_TOLERANCE) return null;
        state.seqOffset = proposed;
        state.seqInBreak = false;
        state.seqSource = 'native';
        const served = sequenceApplyNative(state, url, text);
        if (served === null) {
          state.seqOffset = previous;
          state.seqInBreak = true;
          return null;
        }
        return served;
      }
      return sequenceApplyNative(state, url, text);
    }

    function sequenceInsideBreak(state, url, nativeText, cleanText, source) {
      if (!state) return cleanText;
      const backup = sequenceTail(cleanText);
      if (!backup) return null;
      const sourceName = 'backup:' + String(source || '?');
      const previousOffset = state.seqBackupOffset;
      const previousSource = state.seqSource;
      const previousBreak = state.seqInBreak;
      if (!state.seqInBreak && state.seqServedPdt !== undefined && backup.pdt <= state.seqServedPdt) {
        return null;
      }
      if (state.seqInBreak && state.seqSource !== sourceName) {
        const proposed = sequenceProposedOffset(state, cleanText);
        if (proposed === null || proposed === false) return null;
        state.seqBackupOffset = proposed;
        state.seqSource = sourceName;
      }
      if (!state.seqInBreak) {
        state.seqInBreak = true;
        state.seqSource = sourceName;
        if (state.seqServedHead === null || state.seqServedHead === undefined) {
          state.seqBackupOffset = 0;
        } else {
          const proposed = sequenceProposedOffset(state, cleanText);
          if (proposed === null || proposed === false) {
            state.seqInBreak = previousBreak;
            state.seqSource = previousSource;
            return null;
          }
          state.seqBackupOffset = proposed;
        }
      }
      const served = sequenceServe(state, url, cleanText, backup.sequence, 'seqBackupOffset');
      if (served === null) {
        state.seqBackupOffset = previousOffset;
        state.seqSource = previousSource;
        state.seqInBreak = previousBreak;
        return null;
      }
      sequenceRecordServed(state, url, cleanText, served);
      return served;
    }

    function beginAdQuarantine(info, evidence, url) {
      const state = sequenceStateFor(info);
      if (!state) return;
      const now = Date.now();
      const target = Math.max(1, Number(evidence.targetDuration) || 2);
      const advertised = Math.max(target * 3, Number(evidence.advertisedDuration) || 0);
      const boundedDuration = Math.min(AD_QUARANTINE_MAX_MS / 1000, advertised);
      state.adActive = true;
      state.lastConfirmedAdAt = now;
      state.cleanNativePolls = 0;
      state.cleanCandidateUrl = '';
      state.cleanCandidateSequence = null;
      state.cleanCandidatePdt = null;
      state.adSequenceUrl = canonical(url);
      if (Number.isFinite(evidence.mediaSequence)) {
        const until = evidence.mediaSequence + Math.max(3, Math.ceil(boundedDuration / target));
        state.adUntilSequence = Math.max(Number(state.adUntilSequence) || 0, until);
      }
    }

    function nativeAdQuarantineState(info, evidence, url) {
      const state = sequenceStateFor(info);
      if (!state || !state.adActive) return { active: false, release: false, state: state };
      const markerFree = !evidence.hasMarker && !evidence.strongMetadata;
      const explicitlyLive = markerFree && evidence.fullPlayable > 0 &&
        evidence.explicitLive === evidence.fullPlayable;
      const tail = explicitlyLive ? sequenceTail(evidence.lines.join('\n')) : null;
      if (explicitlyLive && tail) {
        const candidateUrl = canonical(url);
        if (candidateUrl !== state.cleanCandidateUrl) {
          state.cleanCandidateUrl = candidateUrl;
          state.cleanCandidateSequence = tail.number;
          state.cleanCandidatePdt = tail.pdt;
          state.cleanNativePolls = 1;
        } else if (tail.number > Number(state.cleanCandidateSequence) &&
                   tail.pdt > Number(state.cleanCandidatePdt)) {
          state.cleanCandidateSequence = tail.number;
          state.cleanCandidatePdt = tail.pdt;
          state.cleanNativePolls = (Number(state.cleanNativePolls) || 0) + 1;
        } else if (tail.number < Number(state.cleanCandidateSequence) ||
                   tail.pdt < Number(state.cleanCandidatePdt)) {
          state.cleanCandidateSequence = tail.number;
          state.cleanCandidatePdt = tail.pdt;
          state.cleanNativePolls = 1;
        }
      } else {
        state.cleanCandidateUrl = '';
        state.cleanCandidateSequence = null;
        state.cleanCandidatePdt = null;
        state.cleanNativePolls = 0;
      }
      const sequencePast = markerFree && Number.isFinite(evidence.mediaSequence) &&
        canonical(url) === state.adSequenceUrl && Number(state.adUntilSequence) > 0 &&
        evidence.mediaSequence >= Number(state.adUntilSequence);
      const timedOut = Date.now() - (Number(state.lastConfirmedAdAt) || 0) >= AD_QUARANTINE_MAX_MS;
      const release = state.cleanNativePolls >= NATIVE_RELEASE_POLLS || sequencePast || timedOut;
      if (release) {
        state.adActive = false;
        state.adUntilSequence = 0;
        state.cleanNativePolls = 0;
        state.cleanCandidateUrl = '';
        state.cleanCandidateSequence = null;
        state.cleanCandidatePdt = null;
        state.adSequenceUrl = '';
      }
      return { active: !release, release: release, state: state };
    }

    // A clean backup is a different HLS session and cannot honour the native
    // session's blocking part cursor. Serve it as ordinary HLS for the break.
    // Colon-anchored so part-only ad deltas can be recognized without also
    // matching EXT-X-PART-INF, which is configuration rather than media.
    const AD_PART_TAG_RE = /^#EXT-X-PART:/i;

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
      if (lines.some((line) => /^#EXT-X-ENDLIST\b/i.test(String(line || '').trim()))) return '';
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

    function rememberVariant(url, info) {
      if (!url) return;
      info.ts = Date.now();
      media.set(url, info);
      media.set(canonical(url), info);
      prune(media, MEDIA_MAX, MEDIA_TTL);
    }

    function touchMediaProfile(info) {
      if (!info) return null;
      info.ts = Date.now();
      if (info.channel && String(info.channel).toLowerCase() === activeChannel &&
          Number(info.masterGeneration || 0) === activeMasterGeneration) {
        activeMediaProfile = info;
      }
      return info;
    }

    function activateMasterChannel(name, masterUrl, masterText) {
      const channel = String(name || '').trim().toLowerCase();
      if (!channel) return 0;
      const url = String(masterUrl || '');
      const text = String(masterText || '');
      if (activeChannel === channel && activeMasterUrl === url && activeMasterText === text) {
        return activeMasterGeneration;
      }
      invalidateBackupWork(true);
      activeMasterGeneration++;
      activeChannel = channel;
      activeMediaProfile = null;
      activeMasterUrl = url;
      activeMasterText = text;
      return activeMasterGeneration;
    }

    // The master is what maps a media URL to the channel/codec profile a backup
    // stream has to match. Shared by the worker's own master fetch and by masters
    // the page forwards, because a freshly created worker never sees the master
    // the page already fetched and would otherwise have an empty map.
    function mapMasterVariants(text, masterUrl, responseUrl, channel, makeActive) {
      const name = String(channel || '').trim().toLowerCase();
      if (!name || !text) return 0;
      let generation = 0;
      if (makeActive === true || !activeChannel) generation = activateMasterChannel(name, masterUrl, text);
      else if (activeChannel === name) generation = activeMasterGeneration;
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
           masterGeneration: generation,
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
        // Same rule as the page-side capture: PlaybackAccessToken_Template cannot be
        // replayed with a persisted-query hash, so never adopt it as the template or
        // let its hash overwrite the working one.
        if (template && /^PlaybackAccessToken$/i.test(String(template.operationName || 'PlaybackAccessToken'))) {
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

    function workerFetchAdsRequestInfo(body) {
      if (typeof body !== 'string' || !body || body.length > 1024 * 1024) return null;
      try {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (!list.length) return null;
        const mask = list.map((entry) => !!entry && typeof entry === 'object' &&
          entry.operationName === 'FetchAdsService_FetchAds');
        if (!mask.some(Boolean)) return null;
        let channel = '';
        for (let index = 0; index < list.length; index++) {
          if (!mask[index]) continue;
          const variables = list[index].variables || {};
          const input = variables.input && typeof variables.input === 'object' ? variables.input : {};
          const inputChannel = input.channel && typeof input.channel === 'object' ? input.channel : {};
          channel = channel || workerChannelName(variables.channelLogin || variables.login ||
            variables.channel || variables.channelName || input.channelLogin || input.login ||
            inputChannel.login || input.channelName);
        }
        return { batch: Array.isArray(parsed), mask: mask, all: mask.every(Boolean), channel: channel };
      } catch (_) {
        return null;
      }
    }

    function workerVideoAdDeclineRequestInfo(body) {
      if (typeof body !== 'string' || !body || body.length > 1024 * 1024) return null;
      try {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (!list.length) return null;
        const mask = list.map((entry) => !!entry && typeof entry === 'object' &&
          entry.operationName === 'VideoAdRequestDecline');
        if (!mask.some(Boolean)) return null;
        return { batch: Array.isArray(parsed), mask: mask, all: mask.every(Boolean) };
      } catch (_) {
        return null;
      }
    }

    function workerFetchAdsNoFillEntry() {
      return { data: { fetchAds: { ads: null, error: null } } };
    }

    function workerFetchAdsNoFillResponse(info) {
      const payload = info.batch
        ? info.mask.map(() => workerFetchAdsNoFillEntry())
        : workerFetchAdsNoFillEntry();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    function workerVideoAdDeclineEntry() {
      return {
        data: {
          adContext: {
            id: '0',
            radToken: null,
            declineState: { reason: 'reason_ratelimit', shouldDecline: true }
          }
        }
      };
    }

    function workerVideoAdDeclineResponse(info) {
      const payload = info.batch
        ? info.mask.map(() => workerVideoAdDeclineEntry())
        : workerVideoAdDeclineEntry();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    async function redactWorkerFetchAdsResponse(response, info) {
      if (!response || !response.ok || !info || info.all) return response;
      try {
        const payload = JSON.parse(await response.clone().text());
        if (!info.batch || !Array.isArray(payload) || payload.length !== info.mask.length) return response;
        for (let index = 0; index < info.mask.length; index++) {
          if (info.mask[index]) payload[index] = workerFetchAdsNoFillEntry();
        }
        return responseWithText(response, JSON.stringify(payload), 'application/json');
      } catch (_) {
        return response;
      }
    }

    async function redactWorkerVideoAdDeclineResponse(response, info) {
      if (!response || !response.ok || !info || info.all) return response;
      try {
        const payload = JSON.parse(await response.clone().text());
        if (!info.batch || !Array.isArray(payload) || payload.length !== info.mask.length) return response;
        for (let index = 0; index < info.mask.length; index++) {
          if (info.mask[index]) payload[index] = workerVideoAdDeclineEntry();
        }
        return responseWithText(response, JSON.stringify(payload), 'application/json');
      } catch (_) {
        return response;
      }
    }

    async function handleWorkerGql(input, init) {
      let body = init && typeof init.body === 'string' ? init.body : '';
      let requestBody = false;
      if (!body && typeof Request !== 'undefined' && input instanceof Request &&
          String(input.method || '').toUpperCase() === 'POST') {
        try {
          body = await input.clone().text();
          requestBody = true;
        } catch (_) {}
      }
      const adInfo = workerFetchAdsRequestInfo(body);
      const declineInfo = workerVideoAdDeclineRequestInfo(body);
      if (adInfo || declineInfo) {
        armAdWarning(adInfo && adInfo.channel, true);
        if (adInfo && adInfo.all) return workerFetchAdsNoFillResponse(adInfo);
        if (declineInfo && declineInfo.all) return workerVideoAdDeclineResponse(declineInfo);
      }
      let response;
      if (requestBody) {
        patchGqlInit(input, { body: body });
        response = await realFetch(input, init);
      } else {
        response = await realFetch(input, patchGqlInit(input, init));
      }
      response = await redactWorkerFetchAdsResponse(response, adInfo);
      return redactWorkerVideoAdDeclineResponse(response, declineInfo);
    }

    function tokenBody(channel, playerType) {
      const platform = playerType === 'mobile_feed' || playerType === 'autoplay' ? 'android' : 'web';
      let body = null;
      try { body = client.tokenTemplate ? JSON.parse(JSON.stringify(client.tokenTemplate)) : null; } catch (_) {}
      if (!body || !operationIsToken(body)) {
        body = {
          operationName: 'PlaybackAccessToken',
          variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: playerType, platform: platform },
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
        platform: platform
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
      const body = tokenBody(channel, playerType);
      let response = await proxyGql(body);
      let parsed = null;
      if (response.ok) {
        try { parsed = await response.json(); } catch (_) {}
      }
      let token = findToken(parsed, 0);
      const persisted = !!(body.extensions && body.extensions.persistedQuery);
      if ((!response.ok || !token || !token.value || !token.signature) && persisted) {
        const fullBody = JSON.parse(JSON.stringify(body));
        delete fullBody.extensions;
        fullBody.query = TOKEN_QUERY;
        response = await proxyGql(fullBody);
        if (!response.ok) throw new Error('full token http ' + response.status);
        parsed = await response.json();
        token = findToken(parsed, 0);
      } else if (!response.ok) {
        throw new Error('token http ' + response.status);
      }
      if (!token || !token.value || !token.signature) {
        // Twitch refuses a token with HTTP 200 and an error in the body, so the
        // status tells you nothing and the reason is the only way to tell a bad
        // login from a refused identity. Carry it into the message the backup
        // failure already logs rather than discarding it.
        let why = '';
        try {
          const first = parsed && parsed.errors && parsed.errors[0];
          why = String((first && first.message) || '').slice(0, 60);
        } catch (_) {}
        throw new Error('missing access token' + (why ? ' (' + why + ')' : ''));
      }
      if (token.authorization && token.authorization.isForbidden) throw new Error('forbidden access token');
      return token;
    }

    function abortControllerGroup(group) {
      if (!group) return;
      for (const controller of Array.from(group)) {
        try { controller.abort(); } catch (_) {}
      }
      group.clear();
    }

    async function fetchTextWithTimeout(url, timeoutMs, group) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer = 0;
      try {
        if (controller) {
          backupControllers.add(controller);
          if (group) group.add(controller);
        }
        if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await realFetch(url, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) throw new Error('http ' + response.status);
        return { response: response, text: await response.text() };
      } finally {
        if (timer) clearTimeout(timer);
        if (controller) {
          backupControllers.delete(controller);
          if (group) group.delete(controller);
        }
      }
    }

    async function backupAttempt(info, playerType, controllers) {
      const epoch = backupEpoch;
      // A pre-roll is decided before the master has necessarily been mapped, so
      // info.channel can still be empty or malformed on the very first poll. The
      // token request then goes out with an unusable login and Twitch answers
      // HTTP 200 carrying a null token, which surfaces as "missing access token"
      // and loses every clean-backup route for the one break that needs it most.
      // The master URL the worker already holds carries the channel, so recover
      // it from there rather than asking for a token we know cannot be minted.
      const channel = workerChannelName(info.channel) || channelFromMaster(info.master);
      const token = await accessToken(channel, playerType);
      if (!active || epoch !== backupEpoch) throw new Error('stale backup session');
      const masterUrl = new URL(info.master);
      masterUrl.searchParams.set('sig', token.signature);
      masterUrl.searchParams.set('token', token.value);
      if (playerType === 'embed') masterUrl.searchParams.set('parent_domains', 'twitchplayer');
      else masterUrl.searchParams.delete('parent_domains');
      const master = await fetchTextWithTimeout(masterUrl.href, 1800, controllers);
      if (!active || epoch !== backupEpoch) throw new Error('stale backup session');
      const candidates = rankVariants(parseMaster(master.text, masterUrl.href), info);
      if (!candidates || !candidates.length) throw new Error('no codec-compatible variant');
      return new Promise((resolve, reject) => {
        let settled = false;
        let nextIndex = 0;
        let running = 0;
        let completed = 0;
        let secondTimer = 0;
        let lastError = null;
        const fail = (error) => {
          lastError = error;
          running--;
          completed++;
          if (settled) return;
          if (nextIndex < candidates.length) launchNext();
          else if (running <= 0 && completed >= candidates.length) {
            reject(lastError || new Error('backup has no clean codec-compatible rendition'));
          }
        };
        const launchNext = () => {
          if (settled || nextIndex >= candidates.length) return;
          const selected = candidates[nextIndex++];
          running++;
          fetchTextWithTimeout(selected.url, 1800, controllers).then((mediaResult) => {
            if (!active || epoch !== backupEpoch) throw new Error('stale backup session');
            const normalized = ordinaryMediaPlaylist(absolutizeMediaPlaylist(mediaResult.text, selected.url));
            const backupEvidence = normalized ? playlistEvidence(normalized) : null;
            const tail = normalized ? sequenceTail(normalized) : null;
            if (!normalized || !backupEvidence || backupEvidence.confirmed > 0) {
              throw new Error('backup rendition contains ads');
            }
            if (!tail) throw new Error('backup rendition has no live timing anchor');
            const replacementContainer = mediaContainer(normalized);
            if (info.mediaContainer && replacementContainer !== info.mediaContainer) {
              throw new Error('backup rendition changes media container');
            }
            if (settled) return;
            settled = true;
            if (secondTimer) clearTimeout(secondTimer);
            const createdAt = Date.now();
            resolve({ url: selected.url, text: normalized, playerType: playerType,
              resolution: selected.resolution, ts: createdAt, createdAt: createdAt,
              masterGeneration: Number(info.masterGeneration || 0), edgeWall: backupEvidence.edgeWall,
              lastTail: tail, lastAdvanceAt: createdAt });
          }).catch(fail);
        };
        launchNext();
        if (candidates.length > 1) {
          secondTimer = setTimeout(() => {
            secondTimer = 0;
            if (!settled && running < 2) launchNext();
          }, 60);
        }
      });
    }

    async function orderedBackupTypes(info, types, controllers) {
      for (const type of types) {
        try {
          const value = await backupAttempt(info, type, controllers);
          if (value) return value;
        } catch (error) {
          wlog('  backup[' + type + '] ch=' +
            (workerChannelName(info.channel) || channelFromMaster(info.master) || '(none)') +
            ' failed: ' + ((error && error.message) || error));
        }
      }
      return null;
    }

    // mobile_feed/android normally supplies the full same-codec ladder. At ad time
    // popout/web and autoplay/android start alongside it: serial token + master +
    // rendition walks cannot fit the player's 900ms media deadline. The first
    // proven clean, codec-compatible live result wins and the losing media probes
    // are aborted.
    async function firstCleanBackup(info, pendingWarm) {
      const controllers = new Set();
      return new Promise((resolve) => {
        let done = false;
        let remaining = 3;
        const startTimers = [];
        const stop = () => {
          clearTimeout(deadlineTimer);
          for (const timer of startTimers) clearTimeout(timer);
          abortControllerGroup(controllers);
        };
        const finish = (value) => {
          if (done) return;
          if (value) {
            done = true;
            stop();
            resolve(value);
            return;
          }
          remaining--;
          if (remaining <= 0) {
            done = true;
            stop();
            resolve(null);
          }
        };
        const start = (type, delay) => {
          const run = () => {
            if (done) return;
            orderedBackupTypes(info, [type], controllers).then(finish, () => finish(null));
          };
          if (delay > 0) startTimers.push(setTimeout(run, delay));
          else run();
        };
        const deadlineTimer = setTimeout(() => {
          if (done) return;
          done = true;
          stop();
          resolve(null);
        }, BACKUP_SEARCH_TIMEOUT_MS);
        if (pendingWarm) Promise.resolve(pendingWarm).then(finish, () => finish(null));
        else start('mobile_feed', 0);
        start('popout', pendingWarm ? 50 : 75);
        start('autoplay', 150);
      });
    }

    function backupKey(info) {
      return [Number(info.masterGeneration || 0), info.channel, info.resolution, info.fps,
        codecSignature(info.codecs), info.video,
        info.audio, info.subtitles].join('|');
    }

    function getBackup(info, full) {
      if (!active) return Promise.resolve(null);
      const epoch = backupEpoch;
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
      const pendingWarm = full ? pendingBackups.get(warmKey) : null;
      const pendingKey = full ? fullKey : warmKey;
      const warmControllers = full ? null : new Set();
      const attempt = full
        ? firstCleanBackup(info, pendingWarm)
        : orderedBackupTypes(info, ['mobile_feed'], warmControllers)
          .finally(() => abortControllerGroup(warmControllers));
      const pending = attempt.then((value) => {
        if (!active || epoch !== backupEpoch) return null;
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
      }, () => null).finally(() => {
        if (pendingBackups.get(pendingKey) === pending) pendingBackups.delete(pendingKey);
      });
      pendingBackups.set(pendingKey, pending);
      return pending;
    }

    function pollCachedBackup(cached) {
      const url = String(cached && cached.url || '');
      if (!url) return Promise.resolve(null);
      if (Date.now() - Number(cached.createdAt || cached.ts || 0) >= BACKUP_TTL) return Promise.resolve(null);
      if (pendingBackupPolls.has(url)) return pendingBackupPolls.get(url);
      const pending = fetchTextWithTimeout(withoutLowLatencyQuery(url), BACKUP_POLL_TIMEOUT_MS)
        .then((current) => {
          const normalized = ordinaryMediaPlaylist(absolutizeMediaPlaylist(current.text, url));
          if (!normalized) return null;
          const evidence = playlistEvidence(normalized);
          if (evidence.confirmed > 0) return null;
          const tail = sequenceTail(normalized);
          if (!tail) return null;
          const previous = cached.lastTail;
          if (previous && (tail.number < previous.number || tail.pdt < previous.pdt)) return null;
          if (!previous || tail.number > previous.number || tail.pdt > previous.pdt) {
            cached.lastTail = tail;
            cached.lastAdvanceAt = Date.now();
          } else if (Date.now() - Number(cached.lastAdvanceAt || cached.createdAt || cached.ts || 0) >=
                     BACKUP_STALE_MS) {
            return null;
          }
          return { text: normalized, container: mediaContainer(normalized), edgeWall: evidence.edgeWall,
            tail: tail };
        }, () => null)
        .finally(() => {
          if (pendingBackupPolls.get(url) === pending) pendingBackupPolls.delete(url);
        });
      pendingBackupPolls.set(url, pending);
      return pending;
    }

    function takeRecentPrimedBackup(cached) {
      if (!cached || !cached.primed ||
          Date.now() - Number(cached.primedAt || 0) > BACKUP_PRIME_MS) {
        if (cached) {
          cached.primed = null;
          cached.primedAt = 0;
        }
        return null;
      }
      const primed = cached.primed;
      cached.primed = null;
      cached.primedAt = 0;
      return primed;
    }

    function primeBackupForAd(info) {
      if (!active || !info) return Promise.resolve(null);
      const epoch = backupEpoch;
      return getBackup(info, true).then((cached) => {
        if (!interventionCurrent(info, epoch) || !cached || cached.failed) return null;
        if (cached.primed &&
            Date.now() - Number(cached.primedAt || 0) <= BACKUP_PRIME_MS) return cached.primed;
        return pollCachedBackup(cached).then((current) => {
          if (!interventionCurrent(info, epoch) || !current ||
              (info.mediaContainer && current.container !== info.mediaContainer)) return null;
          cached.primed = current;
          cached.primedAt = Date.now();
          return current;
        }, () => null);
      }, () => null);
    }

    async function cachedBackupResponse(info, originalResponse, activate, nativeText, nativeUrl, observation) {
      if (!active) return null;
      const epoch = backupEpoch;
      const key = backupKey(info);
      const cached = backups.get(key);
      if (cached && !cached.failed && Date.now() - cached.ts < BACKUP_TTL) {
        try {
          let current = takeRecentPrimedBackup(cached);
          if (!current) {
            current = await pollCachedBackup(cached);
            if (cached.primed === current) {
              cached.primed = null;
              cached.primedAt = 0;
            }
          }
          if (!interventionCurrent(info, epoch)) return null;
          if (current && (!info.mediaContainer || current.container === info.mediaContainer)) {
            info.servedBackupEdge = current.edgeWall;
            wlog('  clean stream via cached playerType=' + (cached.playerType || '?'));
            const state = sequenceStateFor(info);
            if (observation && !sequenceObservationCurrent(state, observation)) return null;
            const aligned = sequenceInsideBreak(state, nativeUrl || cached.url,
              nativeText || '', current.text, (cached.playerType || '?') + ':' + cached.url);
            if (aligned === null) return null;
            if (activate !== false && state) state.backupActive = true;
            return responseWithText(originalResponse, aligned, 'application/vnd.apple.mpegurl');
          }
          backups.delete(key);
        } catch (_) {
          backups.delete(key);
        }
      }
      return null;
    }

    async function cleanBackupResponse(info, originalResponse, explicitPreroll, nativeText, nativeUrl, observation) {
      if (!active) return null;
      const epoch = backupEpoch;
      const startedAt = Date.now();
      const cachedResponse = await cachedBackupResponse(info, originalResponse, true, nativeText, nativeUrl,
        observation);
      if (!interventionCurrent(info, epoch)) return null;
      if (cachedResponse) return cachedResponse;
      const candidatePromise = getBackup(info, true);
      const preroll = explicitPreroll === true || !(info && info.servedClean);
      const waitBudget = preroll ? PREROLL_BACKUP_WAIT_MS : BACKUP_WAIT_MS;
      const remainingWait = Math.max(0, waitBudget - (Date.now() - startedAt));
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
      if (!interventionCurrent(info, epoch)) return null;
      wlog('  wait=' + waitBudget + 'ms preroll=' + (preroll ? 'YES' : 'no')
        + ' result=' + (candidate ? 'HIT' : 'MISS'));
      if (!candidate) return null;
      info.servedBackupEdge = candidate.edgeWall;
      wlog('  clean stream via playerType=' + (candidate.playerType || '?'));
      const state = sequenceStateFor(info);
      if (observation && !sequenceObservationCurrent(state, observation)) return null;
      const aligned = sequenceInsideBreak(state, nativeUrl || candidate.url,
        nativeText || '', candidate.text, (candidate.playerType || '?') + ':' + candidate.url);
      if (aligned === null) return null;
      if (state) state.backupActive = true;
      return responseWithText(originalResponse, aligned, 'application/vnd.apple.mpegurl');
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
        mapMasterVariants(text, url, response.url || url, channelFromMaster(url), true);
      } catch (_) {}
      return response;
    }

    // During an ad break Twitch serves a media playlist URL that is not one of the
    // master's variant URLs, so an exact-URL lookup misses even though the channel
    // and codec profile are already known. That is precisely when the backup is
    // needed, and a miss skipped the whole clean-backup path. backupAttempt only
    // needs the profile, not the ad URL, so fall back to the active profile or the
    // best video/source variant and bind it to this URL. Never let a last-listed
    // audio-only rendition become the detached video's replacement profile.
    function fallbackProfileScore(candidate) {
      const codecs = String(candidate && candidate.codecs || '');
      const hasVideoCodec = /(?:avc1|av01|hev1|hvc1|vp0?9)/i.test(codecs) ? 1 : 0;
      const sourceGroup = /(?:chunked|source)/i.test(String(candidate && candidate.video || '')) ? 1 : 0;
      return hasVideoCodec * 1e15 + sourceGroup * 1e14 +
        resolutionArea(candidate && candidate.resolution) * 1000 +
        Number(candidate && candidate.bandwidth || 0) + Number(candidate && candidate.fps || 0);
    }

    function fallbackVariant(channel) {
      const wantedChannel = String(channel || activeChannel || '').toLowerCase();
      if (!wantedChannel) return null;
      if (activeMediaProfile && activeMediaProfile.channel === wantedChannel &&
          Number(activeMediaProfile.masterGeneration || 0) === activeMasterGeneration &&
          Date.now() - (activeMediaProfile.ts || 0) <= MEDIA_TTL) return activeMediaProfile;
      let best = null;
      let bestScore = -1;
      const seen = new Set();
      for (const candidate of media.values()) {
        if (!candidate || seen.has(candidate) || candidate.channel !== wantedChannel ||
            Number(candidate.masterGeneration || 0) !== activeMasterGeneration) continue;
        seen.add(candidate);
        const score = fallbackProfileScore(candidate);
        if (!best || score > bestScore ||
            (score === bestScore && (candidate.ts || 0) > (best.ts || 0))) {
          best = candidate;
          bestScore = score;
        }
      }
      if (!best || Date.now() - (best.ts || 0) > MEDIA_TTL) return null;
      return best;
    }

    function mediaProfileForUrl(url) {
      let info = media.get(url) || media.get(canonical(url));
      if (info) return touchMediaProfile(info);
      prune(media, MEDIA_MAX, MEDIA_TTL);
      const profile = fallbackVariant(activeChannel);
      if (!profile) return null;
      info = Object.assign({}, profile);
      rememberVariant(url, info);
      touchMediaProfile(info);
      wlog('  bound ad media url to known profile ch=' + (info.channel || '?'));
      return info;
    }

    function startEarlyCleanBackup(info) {
      if (!info) return;
      const imminent = adWarningActive(info.channel);
      const firstPollWarm = !info.servedClean && !!client.tokenTemplate;
      if (!imminent && !firstPollWarm) return;
      try {
        const pending = imminent ? primeBackupForAd(info) : getBackup(info, false);
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (_) {}
    }

    async function handleMedia(input, init, url) {
      let info = mediaProfileForUrl(url);
      let operationEpoch = backupEpoch;
      // A clean request already in flight when the warning arrives belongs to the
      // pre-break timeline. Do not let its later response consume the one-shot
      // warning prime intended for the first request that actually sees the break.
      const warningActiveAtRequestStart = adWarningActive(info && info.channel || activeChannel);
      startEarlyCleanBackup(info);
      // Once an intervention is active, do not issue blocking reloads for a native
      // LL-HLS sequence/part that the returned ordinary/backup playlist cannot
      // satisfy. The linked Request signal is preserved for Request inputs.
      const nativeResult = await fetchNativeMedia(input, init, url, info);
      let response = nativeResult.response;
      if (!response.ok) return response;
      if (nativeResult.retriedExact) return response;
      if (!interventionCurrent(info, operationEpoch) && !info && active) {
        info = mediaProfileForUrl(url);
        if (info) {
          operationEpoch = backupEpoch;
          startEarlyCleanBackup(info);
        }
      }
      if (!interventionCurrent(info, operationEpoch)) return response;
      if (!info) {
        info = mediaProfileForUrl(url);
        startEarlyCleanBackup(info);
      } else {
        touchMediaProfile(info);
      }
      let text = '';
      try { text = await response.clone().text(); } catch (_) { return response; }
      if (!interventionCurrent(info, operationEpoch)) return response;
      // A CDN challenge, gateway page or empty 200 is not a media playlist. Never
      // remember or replay it as a clean bridge; that turns a transient network
      // response into a deterministic Twitch #2000/#3000 failure on the next ad.
      if (!mediaPlaylistEnvelope(text)) return response;
      /* EXT-X-SKIP is singular and requires one non-negative safe-integer count.
         A malformed delta cannot be aligned safely, so leave it entirely native. */
      if (sequenceSkippedSegments(text) === null) return response;
      if (info) {
        const observedContainer = mediaContainer(text);
        if (observedContainer) info.mediaContainer = observedContainer;
      }
      let evidence;
      try { evidence = playlistEvidence(text); } catch (_) { return response; }
      let sequenceState = sequenceStateFor(info);
      let nativeObservation = sequenceObserveNative(sequenceState, url, text);
      if (nativeObservation.stale) return sequenceStaleResponse(sequenceState, nativeObservation, response);
      if (sequenceState && evidence.fullPlayable > 0) {
        sequenceState.lastNativeText = text;
        sequenceState.lastNativeUrl = url;
      }
      const confirmedPartOnlyDelta = evidence.confirmed > 0 && evidence.fullPlayable < 1 &&
        evidence.lines.some((line) => AD_PART_TAG_RE.test(String(line || '').trim()));
      if (confirmedPartOnlyDelta) {
        const deltaResponse = response;
        beginAdQuarantine(info, evidence, url);
        const complete = await retryCompleteMediaPlaylist(input, init, url);
        if (!interventionCurrent(info, operationEpoch) && !info && active) {
          info = mediaProfileForUrl(url);
          if (info) {
            operationEpoch = backupEpoch;
            sequenceState = sequenceStateFor(info);
            nativeObservation = sequenceObserveNative(sequenceState, url, text);
            startEarlyCleanBackup(info);
          }
        }
        if (!interventionCurrent(info, operationEpoch) ||
            !sequenceObservationCurrent(sequenceState, nativeObservation)) {
          return sequenceStaleResponse(sequenceState, nativeObservation, deltaResponse);
        }
        if (!info) {
          info = mediaProfileForUrl(url);
          startEarlyCleanBackup(info);
        }
        if (!complete) {
          wlog('  part-only ad delta; ordinary retry unavailable');
          if (mediaRequestAborted(input, init)) {
            setAdState('clear', info && info.channel || '');
            return deltaResponse;
          }
          sequenceState = sequenceStateFor(info);
          const bridge = oneShotNativeBridge(sequenceState, url, evidence);
          if (bridge) {
            try { if (info) getBackup(info, true); } catch (_) {}
            setAdState('blocked-clean', info && info.channel || '');
            return responseWithText(deltaResponse, bridge, 'application/vnd.apple.mpegurl');
          }
          if (info) {
            try {
              sequenceState = sequenceStateFor(info);
              const nativeAnchor = sequenceState && sequenceState.lastNativeText || text;
              const replacement = await cleanBackupResponse(info, deltaResponse, evidence.explicitPreroll,
                nativeAnchor, url, nativeObservation);
              if (!interventionCurrent(info, operationEpoch) ||
                  !sequenceObservationCurrent(sequenceState, nativeObservation)) {
                return sequenceStaleResponse(sequenceState, nativeObservation, deltaResponse);
              }
              if (replacement) {
                setAdState('blocked-clean', info.channel);
                return replacement;
              }
            } catch (_) {}
          }
          sequenceState = sequenceStateFor(info);
          if (sequenceState) sequenceState.backupActive = false;
          const nativeText = sequenceNativeBreak(sequenceState, url, text);
          if (nativeText === null) {
            sequenceResetToNative(sequenceState, url, text);
            setAdState('clear', info && info.channel || '');
            return deltaResponse;
          }
          wlog('  -> no clean backup; passing native media through');
          setAdState('clear', info && info.channel || '');
          return nativeText !== text
            ? responseWithText(deltaResponse, nativeText, 'application/vnd.apple.mpegurl')
            : deltaResponse;
        }
        response = complete.response;
        text = complete.text;
        evidence = complete.evidence;
        if (info) {
          const observedContainer = mediaContainer(text);
          if (observedContainer) info.mediaContainer = observedContainer;
          sequenceState = sequenceStateFor(info);
          if (sequenceState && evidence.fullPlayable > 0) {
            sequenceState.lastNativeText = text;
            sequenceState.lastNativeUrl = url;
          }
        }
        nativeObservation = sequenceObserveNative(sequenceState, url, text);
        if (nativeObservation.stale) return sequenceStaleResponse(sequenceState, nativeObservation, response);
      }
      if (!evidence.confirmed) {
        const warningActive = adWarningActive(info && info.channel);
        if (info && warningActive && warningActiveAtRequestStart) {
          try {
            const early = await cleanBackupResponse(info, response, false, text, url, nativeObservation);
            if (!interventionCurrent(info, operationEpoch) ||
                !sequenceObservationCurrent(sequenceState, nativeObservation)) {
              return sequenceStaleResponse(sequenceState, nativeObservation, response);
            }
            if (early) {
              setAdState('blocked-clean', info.channel);
              return early;
            }
          } catch (_) {}
        }
        const quarantine = nativeAdQuarantineState(info, evidence, url);
        sequenceState = quarantine.state || sequenceStateFor(info);
        if (quarantine.active) {
          // Twitch media playlists are sliding windows. An ad marker can vanish
          // one refresh before its generic/untitled media segments do, so never
          // learn that refresh as clean. Keep serving the clean backup when it is
          // available; otherwise fail open on native media without starving MSE.
          try {
            const held = await cachedBackupResponse(info, response, true, text, url, nativeObservation);
            if (!interventionCurrent(info, operationEpoch) ||
                !sequenceObservationCurrent(sequenceState, nativeObservation)) {
              return sequenceStaleResponse(sequenceState, nativeObservation, response);
            }
            if (held) {
              setAdState('blocked-clean', info && info.channel || '');
              return held;
            }
          } catch (_) {}
          try { getBackup(info, false); } catch (_) {}
          if (sequenceState) sequenceState.backupActive = false;
          const nativeText = sequenceNativeBreak(sequenceState, url, text);
          if (nativeText === null) {
            sequenceResetToNative(sequenceState, url, text);
            setAdState('clear', info && info.channel || '');
            return response;
          }
          wlog('  ad marker slid out; no clean backup, passing native media through');
          setAdState('clear', info && info.channel || '');
          return nativeText !== text
            ? responseWithText(response, nativeText, 'application/vnd.apple.mpegurl')
            : response;
        }
        if (quarantine.release && sequenceState) sequenceState.backupActive = false;
        if (info && (evidence.hasMarker || evidence.strongMetadata)) {
          // Marker-only CSAI snapshots are not destroyed, but a replacement is
          // probed in the background in case confirmed ad media follows next poll.
          try { getBackup(info, false); } catch (_) {}
        }
        // Keep mobile_feed/android warm during normal playback. The other two
        // identities join only if an ad-time attempt needs them.
        if (info && client.tokenTemplate) { try { getBackup(info, false); } catch (_) {} }
        if (info) info.servedClean = true;
        sequenceState = sequenceState || sequenceStateFor(info);
        if (sequenceState && sequenceState.backupActive && warningActive) {
          try {
            const held = await cachedBackupResponse(info, response, true, text, url, nativeObservation);
            if (!interventionCurrent(info, operationEpoch) ||
                !sequenceObservationCurrent(sequenceState, nativeObservation)) {
              return sequenceStaleResponse(sequenceState, nativeObservation, response);
            }
            if (held) {
              setAdState('blocked-clean', info.channel);
              return held;
            }
          } catch (_) {}
          sequenceState.backupActive = false;
        }
        let aligned = text;
        if (sequenceState && sequenceState.seqInBreak && warningActive) {
          aligned = sequenceNativeBreak(sequenceState, url, text);
        } else {
          const release = !!(quarantine.release || (sequenceState && sequenceState.seqInBreak &&
            !sequenceState.adActive && !warningActive));
          aligned = sequenceOutsideBreak(sequenceState, url, text, release);
        }
        if (aligned === null && sequenceState && sequenceState.seqInBreak) {
          try {
            const held = await cachedBackupResponse(info, response, true, text, url, nativeObservation);
            if (!interventionCurrent(info, operationEpoch) ||
                !sequenceObservationCurrent(sequenceState, nativeObservation)) {
              return sequenceStaleResponse(sequenceState, nativeObservation, response);
            }
            if (held) {
              setAdState('blocked-clean', info && info.channel || '');
              return held;
            }
          } catch (_) {}
        }
        if (aligned === null) {
          sequenceResetToNative(sequenceState, url, text);
          aligned = text;
        }
        setAdState('clear', (info && info.channel) || '');
        return aligned !== text
          ? responseWithText(response, aligned, 'application/vnd.apple.mpegurl')
          : response;
      }
      beginAdQuarantine(info, evidence, url);
      wlog('AD detected ' + url.slice(-40));
      wlog('  preroll=' + ((info && !info.servedClean) ? 'YES' : 'no')
        + ' prefetch=' + ((/#EXT-X-TWITCH-PREFETCH/i.test(text) ? 'Y' : 'n')
        + (/#EXT-X-PRELOAD-HINT/i.test(text) ? 'P' : 'n')
        + (/#EXT-X-PART[:\s]/i.test(text) ? 'T' : 'n'))
        + ' confirmed=' + evidence.confirmed + ' full=' + evidence.fullPlayable);
      if (!info) wlog('  no variant info (master not mapped for this media url)');
      if (info) {
        try {
          const replacement = await cleanBackupResponse(info, response, evidence.explicitPreroll, text, url,
            nativeObservation);
          if (!interventionCurrent(info, operationEpoch) ||
              !sequenceObservationCurrent(sequenceState, nativeObservation)) {
            return sequenceStaleResponse(sequenceState, nativeObservation, response);
          }
          if (replacement) {
            wlog('  -> swapped to CLEAN backup');
            setAdState('blocked-clean', info.channel);
            return replacement;
          }
        } catch (e) { wlog('  backup swap error: ' + (e && e.message || e)); }
      }
      sequenceState = sequenceStateFor(info);
      if (sequenceState) sequenceState.backupActive = false;
      const nativeText = sequenceNativeBreak(sequenceState, url, text);
      if (nativeText === null) {
        sequenceResetToNative(sequenceState, url, text);
        setAdState('clear', info && info.channel || '');
        return response;
      }
      wlog('  -> no clean backup; passing native ad media through');
      setAdState('clear', info && info.channel || '');
      return nativeText !== text
        ? responseWithText(response, nativeText, 'application/vnd.apple.mpegurl')
        : response;
    }

    try {
      if (initialMaster && initialMaster.url && initialMaster.text) {
        mapMasterVariants(String(initialMaster.text), String(initialMaster.url), String(initialMaster.url),
          channelFromMaster(initialMaster.url) || initialMaster.channel, true);
      }
    } catch (_) {}
    try {
      const warningAt = Number(initialAdWarning && initialAdWarning.at || 0);
      const warningChannel = workerChannelName(initialAdWarning && initialAdWarning.channel);
      if (warningAt > 0 && Date.now() - warningAt < AD_IMMINENT_MS) {
        if (warningChannel) adImminentByChannel.set(warningChannel, warningAt + AD_IMMINENT_MS);
        else genericAdImminentUntil = warningAt + AD_IMMINENT_MS;
      }
    } catch (_) {}

    self.addEventListener('message', (event) => {
      const message = event && event.data;
      if (!message || message[FLAG] !== runtimeVersion) return;
      try { if (event.stopImmediatePropagation) event.stopImmediatePropagation(); } catch (_) {}
      if (message.type === 'config') {
        const nextActive = message.enabled !== false;
        if (nextActive !== active) lastAdStateSent = '';
        active = nextActive;
        if (!nextActive) {
          genericAdImminentUntil = 0;
          adImminentByChannel.clear();
          invalidateBackupWork(true);
        }
      } else if (message.type === 'client-state' && message.state) {
        client = Object.assign({}, client, message.state);
      } else if (message.type === 'ad-imminent') {
        armAdWarning(message.channel, false);
      } else if (message.type === 'master') {
        try {
          const url = String(message.url || '');
          const mapped = mapMasterVariants(String(message.text || ''), url, url,
            channelFromMaster(url) || message.channel, message.current === true);
          if (mapped && adWarningActive(message.channel || activeChannel)) {
            const profile = fallbackVariant(activeChannel);
            if (profile) {
              const pending = primeBackupForAd(profile);
              if (pending && typeof pending.catch === 'function') pending.catch(() => {});
            }
          }
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
        return handleWorkerGql(input, init);
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
      if (!originalSource) {
        if (WO_TWITCH_DEBUG) { try { console.log('[WO-Twitch] worker NOT hooked: blob source unreadable'); } catch (_) {} }
        return constructWorker(scriptUrl, options);
      }

      let wrapperUrl = '';
      try {
        const initialMaster = currentMasterSnapshot();
        const initialAdWarning = currentAdWarningSnapshot();
        const bootstrap = '(' + twitchWorkerRuntime.toString() + ')(' +
          'null,' + JSON.stringify(publicClientState()) + ',' + JSON.stringify(VERSION) + ',' +
          JSON.stringify(streamInterceptionEnabled()) + ',' + JSON.stringify(initialMaster) + ',' +
          JSON.stringify(initialAdWarning) + ');\n';
        wrapperUrl = URL.createObjectURL(new Blob([bootstrap, originalSource], { type: 'application/javascript' }));
        const worker = constructWorker(wrapperUrl, options);
        if (WO_TWITCH_DEBUG) { try { console.log('[WO-Twitch] worker HOOKED — ad interception active'); } catch (_) {} }
        workers.add(worker);
        let workerCleaned = false;
        const cleanupWorker = () => {
          if (workerCleaned) return;
          workerCleaned = true;
          workers.delete(worker);
          releaseWorkerAdState(worker);
        };
        try {
          const nativeTerminate = worker.terminate;
          if (typeof nativeTerminate === 'function') {
            worker.terminate = function terminate() {
              cleanupWorker();
              return nativeTerminate.apply(this, arguments);
            };
          }
        } catch (_) {}
        let revokeTimer = woTimeout(() => {
          try { URL.revokeObjectURL(wrapperUrl); } catch (_) {}
          revokeTimer = 0;
        }, 10000);

        woOn(worker, 'message', (event) => {
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
              const warning = currentAdWarningSnapshot();
              if (warning) {
                worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'ad-imminent', channel: warning.channel });
              }
              const master = currentMasterSnapshot();
              if (master) {
                worker.postMessage({
                  [MESSAGE_FLAG]: VERSION, type: 'master',
                  url: master.url, text: master.text, channel: master.channel, current: true,
                });
              }
            } catch (_) {}
          } else if (message.type === 'ad-imminent') {
            announceAdImminent(message.channel);
          } else if (message.type === 'gql-request') {
            proxyWorkerGql(worker, message);
          } else if (message.type === 'ad-state') {
            try {
              const state = String(message.state || 'active');
              applyWorkerAdState(worker, state);
            } catch (_) {}
          } else if (message.type === 'log') {
            // Gated on the receiving side too. The worker only sends these when debugging, so this
            // was relying on the sender never getting it wrong -- which is not a guarantee, and the
            // cost of it being wrong is log spam in the console of a site we do not own.
            if (WO_TWITCH_DEBUG) { try { console.log('[WO-Twitch]', message.m); } catch (_) {} }
          }
        });
        woOn(worker, 'error', cleanupWorker, { once: true });
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
  installXhrHook();
})();

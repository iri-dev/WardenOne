/*
 * WebWarden Twitch ad blocker.
 *
 * Installs before Twitch's player and handles both server-side HLS ads and the
 * current display/audio-ad shells. The clean-stream strategy is informed by
 * the MIT-licensed TwitchAdSolutions VAFT and TTV-AB projects, but is
 * deliberately smaller:
 * no React internals, no player/page reloads, no polling watchdog, and no
 * remote proxy. If Twitch offers no clean alternate playlist, confirmed ad
 * media is replaced with standard HLS gaps or a local silent hold segment.
 */
(function webWardenTwitchAdblock() {
  'use strict';

  const VERSION = '1.0.0';
  const TWITCH_HOST_RE = /(^|\.)twitch\.tv$/i;
  const GQL_URL_RE = /^https:\/\/gql\.twitch\.tv\/gql(?:[?#]|$)/i;
  const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
  const DEFAULT_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const MESSAGE_FLAG = '__wwTwitchAdblock';

  if (!TWITCH_HOST_RE.test(location.hostname)) return;
  if (window.top !== window) {
    const embedFrame = /^(?:player|embed)\.twitch\.tv$/i.test(location.hostname) ||
      /^\/embed\//i.test(location.pathname || '');
    if (!embedFrame) return;
  }
  if (/^clips\.twitch\.tv$/i.test(location.hostname) || /^\/[^/]+\/clip\//i.test(location.pathname || '')) return;
  if (window.__webWardenTwitchAdblockReady) return;
  window.__webWardenTwitchAdblockReady = VERSION;

  let enabled = true;
  let bridgeToken = '';
  let revision = 0;
  const workers = new Set();
  const independentAdVideos = new Map();
  let independentAdObserver = null;
  let independentAdPruneTimer = 0;

  const nativeFetch = window.fetch;
  const NativeWorker = window.Worker;
  const clientState = {
    clientId: DEFAULT_CLIENT_ID,
    deviceId: '',
    clientVersion: '',
    clientSession: '',
    clientIntegrity: '',
    authorization: '',
    tokenHash: TOKEN_HASH,
    tokenTemplate: null
  };

  const adCss = document.createElement('style');
  adCss.id = 'ww-twitch-adblock-css';
  adCss.textContent = [
    '[aria-label="Advertisement"]',
    '#player-ads',
    '[data-test-selector="sda-wrapper"]',
    '[data-a-target="video-ad-label"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="ad-countdown-timer"]',
    '[data-test-selector="sad-overlay"]',
    'video[data-ww-twitch-independent-ad="true"]',
    '[class*="stream-display-ad__wrapper"]',
    '[class*="stream-display-ad__container"]',
    '[class*="stream-display-ad__iframe"]',
    '[class*="pushdown-sda"]',
    '.audio-ax-overlay-base',
    'button[aria-label="Learn more about this ad"]'
  ].join(',') + '{display:none!important;visibility:hidden!important;pointer-events:none!important;}\n' +
    '[class*="video-player--stream-display-ad"]{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;inset:0!important;transform:none!important;}';

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
      video.removeAttribute('data-ww-twitch-independent-ad');
    } catch (_) {}
    independentAdVideos.delete(video);
  }

  function videoMediaSource(video) {
    return String(video && (video.currentSrc || video.getAttribute('src')) || '');
  }

  function primaryPlayerVideo() {
    try {
      const players = document.querySelectorAll('[data-a-target="video-player"] video, .video-player video');
      for (const video of players) {
        if (video instanceof HTMLVideoElement && video.isConnected && videoMediaSource(video).startsWith('blob:')) return video;
      }
      for (const video of document.querySelectorAll('video')) {
        if (video instanceof HTMLVideoElement && video.isConnected && videoMediaSource(video).startsWith('blob:')) return video;
      }
    } catch (_) {}
    return null;
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
    if (!mediaSource || mediaSource.startsWith('blob:') ||
        (label !== 'video advertisement' && !label.startsWith('this advertisement'))) return false;
    const primary = primaryPlayerVideo();
    return !!primary && primary !== video;
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
      video.setAttribute('data-ww-twitch-independent-ad', 'true');
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

  function installIndependentAdObserver() {
    if (independentAdObserver || typeof MutationObserver !== 'function') return;
    try {
      independentAdObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes') {
            guardIndependentAdsForNode(record.target);
            continue;
          }
          for (const node of record.addedNodes) guardIndependentAdsForNode(node);
        }
        pruneIndependentAdVideos();
      });
      independentAdObserver.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label', 'src']
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

  function updateEnabled() {
    const config = window.__WW_CONFIG__;
    enabled = !config || (config.enabled !== false && config.twitchAdBlock !== false);
    adCss.disabled = !enabled;
    setIndependentAdGuardEnabled(enabled);
    for (const worker of workers) {
      try {
        worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'config', enabled: enabled });
      } catch (_) {}
    }
  }

  document.addEventListener('ww-config-change', updateEnabled);
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.source === 'webwarden-handshake' && typeof message.token === 'string' && !bridgeToken) {
      bridgeToken = message.token;
      return;
    }
    if (message.source !== 'webwarden' || message.kind !== 'config' || !bridgeToken || message.token !== bridgeToken) return;
    const config = message.overrides || {};
    enabled = config.enabled !== false && config.twitchAdBlock !== false;
    adCss.disabled = !enabled;
    setIndependentAdGuardEnabled(enabled);
    for (const worker of workers) {
      try { worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'config', enabled: enabled }); } catch (_) {}
    }
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
      const list = Array.isArray(parsed) ? parsed : [parsed];
      let changed = false;
      for (const entry of list) {
        if (!tokenOperation(entry) || !entry.variables) continue;
        if (entry.variables.playerType !== 'popout') {
          entry.variables.playerType = 'popout';
          changed = true;
        }
        if (entry.variables.platform && entry.variables.platform !== 'web') {
          entry.variables.platform = 'web';
          changed = true;
        }
      }
      return changed ? JSON.stringify(parsed) : body;
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

  function installFetchHook() {
    if (typeof nativeFetch !== 'function' || nativeFetch.__wwTwitchCurrent) return;
    function twitchFetch(input, init) {
      const url = requestUrl(input);
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
      Object.defineProperty(twitchFetch, '__wwTwitchCurrent', { value: VERSION });
      Object.defineProperty(twitchFetch, 'name', { value: 'fetch' });
      Object.defineProperty(twitchFetch, 'length', { value: 1 });
      twitchFetch.toString = Function.prototype.toString.bind(nativeFetch);
    } catch (_) {}
    window.fetch = twitchFetch;
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

  function twitchWorkerRuntime(originalSource, initialState, runtimeVersion) {
    'use strict';

    const FLAG = '__wwTwitchAdblock';
    const AD_MARKER_RE = /stitched-ad|#EXT-X-CUE-OUT|twitch-stitched|CLASS="twitch-maf-ad"|CLASS="twitch-trigger"/i;
    const STRONG_AD_METADATA_RE = /X-TV-TWITCH-AD-(?:RADS-TOKEN|ROLL-TYPE|POD-|ADVERTISER|CREATIVE|LINE-ITEM|ORDER-ID)/i;
    const AD_URI_RE = /\/(?:adsquared|_404)\/|\/stitched-ad(?:[-_.\/]|$)/i;
    const GQL_RE = /^https:\/\/gql\.twitch\.tv\/gql(?:[?#]|$)/i;
    const MASTER_RE = /usher\.ttvnw\.net|\/api\/(?:v2\/)?channel\/hls\//i;
    const MEDIA_TTL = 5 * 60 * 1000;
    const BACKUP_TTL = 2 * 60 * 1000;
    const NEGATIVE_TTL = 30 * 1000;
    const MEDIA_MAX = 128;
    const BACKUP_MAX = 12;
    const BACKUP_WAIT_MS = 900;
    const CLEAN_NATIVE_TTL = 2500;
    const NATIVE_RELEASE_POLLS = 3;
    const AD_QUARANTINE_MAX_MS = 45 * 1000;
    // Valid silent MP4 used by the MIT-licensed TTV-AB recovery design. It
    // advances HLS media sequence without downloading or decoding ad media.
    const EMPTY_SEGMENT_URL = 'data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA';
    const TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
    const EMPTY_STATE = {
      tokenHash: TOKEN_HASH,
      tokenTemplate: null
    };

    let active = true;
    let adsSeen = false;
    let client = Object.assign({}, EMPTY_STATE, initialState || {});
    const realFetch = self.fetch.bind(self);
    const media = new Map();
    const backups = new Map();
    const pendingBackups = new Map();
    const pendingGql = new Map();

    function post(type, extra) {
      try {
        self.postMessage(Object.assign({ [FLAG]: runtimeVersion, type: type }, extra || {}));
      } catch (_) {}
    }

    function wlog(m) { post('log', { m: m }); }

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
        return new Response(text, { status: 200, headers: { 'content-type': contentType || 'application/vnd.apple.mpegurl' } });
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

    function codecFamily(codecs) {
      const value = String(codecs || '').toLowerCase();
      if (value.includes('av01')) return 'av1';
      if (value.includes('hvc1') || value.includes('hev1')) return 'hevc';
      if (value.includes('avc1')) return 'h264';
      return '';
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
      const wantedFamily = codecFamily(wanted && wanted.codecs);
      let pool = wantedFamily ? variants.filter((variant) => codecFamily(variant.codecs) === wantedFamily) : variants.slice();
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
      const strongMetadata = STRONG_AD_METADATA_RE.test(source) || /stitched-ad/i.test(source);
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

    function holdPlaylist(evidence, info) {
      const headers = [];
      let sourceSequence = 0;
      for (const rawLine of evidence.lines) {
        const line = String(rawLine || '').trim();
        if (!line) continue;
        if (/^#EXTINF:|^#EXT-X-(?:PART|PRELOAD-HINT|TWITCH-PREFETCH|PROGRAM-DATE-TIME|ENDLIST)/i.test(line)) break;
        if (/^#EXT-X-(?:DATERANGE|CUE-|KEY|MAP)/i.test(line) || AD_MARKER_RE.test(line) || STRONG_AD_METADATA_RE.test(line)) continue;
        const sequence = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/i.exec(line);
        if (sequence) sourceSequence = Number(sequence[1]) || 0;
        headers.push(line);
      }
      if (!headers.includes('#EXTM3U')) headers.unshift('#EXTM3U');
      if (!headers.some((line) => /^#EXT-X-VERSION:/i.test(line))) headers.splice(1, 0, '#EXT-X-VERSION:7');
      if (!headers.some((line) => /^#EXT-X-TARGETDURATION:/i.test(line))) headers.push('#EXT-X-TARGETDURATION:1');
      const previous = Math.max(0, Number(info && info.holdSequence) || 0);
      const sequence = Math.max(sourceSequence + 1, previous + 1);
      if (info) info.holdSequence = sequence;
      const at = headers.findIndex((line) => /^#EXT-X-MEDIA-SEQUENCE:/i.test(line));
      if (at >= 0) headers[at] = '#EXT-X-MEDIA-SEQUENCE:' + sequence;
      else headers.push('#EXT-X-MEDIA-SEQUENCE:' + sequence);
      return headers.concat([
        '#EXT-X-DISCONTINUITY',
        '#EXT-X-KEY:METHOD=NONE',
        '#EXTINF:1.000,live',
        EMPTY_SEGMENT_URL
      ]).join('\n');
    }

    function stripAdPlaylist(text, info) {
      const evidence = playlistEvidence(text);
      if (!evidence.confirmed) return String(text || '');
      if (evidence.playable > 0 && evidence.confirmed >= evidence.playable) return holdPlaylist(evidence, info);
      const output = [];
      for (let index = 0; index < evidence.lines.length; index++) {
        let line = String(evidence.lines[index] || '');
        if (/^#EXT-X-CUE-(?:OUT|IN)/i.test(line)) continue;
        if (evidence.inlineAds.has(index)) continue;
        if ((AD_MARKER_RE.test(line) || STRONG_AD_METADATA_RE.test(line) || /\bSCTE35-OUT=/i.test(line)) &&
            /^#EXT-X-(?:DATERANGE|TWITCH-)/i.test(line)) continue;
        line = line
          .replace(/(X-TV-TWITCH-AD-URL=")[^"]*(")/gi, '$1https://twitch.tv$2')
          .replace(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/gi, '$1https://twitch.tv$2');
        output.push(line);
        if (evidence.fullAds.has(index)) output.push('#EXT-X-GAP');
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
        let changed = false;
        for (const entry of list) {
          if (!operationIsToken(entry) || !entry.variables) continue;
          if (entry.variables.playerType !== 'popout') {
            entry.variables.playerType = 'popout';
            changed = true;
          }
          if (entry.variables.platform && entry.variables.platform !== 'web') {
            entry.variables.platform = 'web';
            changed = true;
          }
        }
        return changed ? Object.assign({}, init, { body: JSON.stringify(parsed) }) : init;
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
      const normalized = absolutizeMediaPlaylist(mediaResult.text, selected.url);
      if (!/(?:#EXTINF:|#EXT-X-PART:)/i.test(normalized) || hasAds(normalized)) throw new Error('backup contains ads');
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
        for (const type of types) backupAttempt(info, type).then(done, () => done(null));
      });
    }

    // Source-capable web player types are raced once per playback context. The
    // Android/autoplay type is not committed because current players can stick at
    // 360p or fail to transition back to the native stream after an ad break.
    function firstCleanBackup(info) {
      return raceBackupTypes(info, ['site', 'popout', 'mobile_web', 'embed']);
    }

    function backupKey(info) {
      return [info.channel, info.resolution, info.fps, codecFamily(info.codecs), info.video, info.audio, info.subtitles].join('|');
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
      if (pendingBackups.has(key)) return pendingBackups.get(key);
      const pending = firstCleanBackup(info).then((value) => {
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
      }, () => null).finally(() => pendingBackups.delete(key));
      pendingBackups.set(key, pending);
      return pending;
    }

    async function cachedBackupResponse(info, originalResponse, activate) {
      const key = backupKey(info);
      const cached = backups.get(key);
      if (cached && !cached.failed && Date.now() - cached.ts < BACKUP_TTL) {
        try {
          const current = await fetchTextWithTimeout(cached.url, 1200);
          const normalized = absolutizeMediaPlaylist(current.text, cached.url);
          if (/(?:#EXTINF:|#EXT-X-PART:)/i.test(normalized) && !hasAds(normalized)) {
            cached.ts = Date.now();
            if (activate !== false) {
              info.backupActive = true;
              info.cleanNativePolls = 0;
            }
            wlog('  clean stream via cached playerType=' + (cached.playerType || '?'));
            return responseWithText(originalResponse, normalized, 'application/vnd.apple.mpegurl');
          }
          backups.delete(key);
        } catch (_) {
          backups.delete(key);
        }
      }
      return null;
    }

    async function cleanBackupResponse(info, originalResponse) {
      const cachedResponse = await cachedBackupResponse(info, originalResponse);
      if (cachedResponse) return cachedResponse;
      const candidatePromise = getBackup(info, true);
      if (info.lastCleanNative && Date.now() - info.lastCleanNativeAt <= CLEAN_NATIVE_TTL) {
        candidatePromise.catch(() => {});
        wlog('  bridging with fresh clean native snapshot');
        return responseWithText(originalResponse, info.lastCleanNative, 'application/vnd.apple.mpegurl');
      }
      const candidate = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), BACKUP_WAIT_MS);
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
      let target = input;
      if (typeof input === 'string') {
        try {
          const parsed = new URL(input);
          parsed.searchParams.delete('parent_domains');
          target = parsed.href;
        } catch (_) {}
      }
      let response = await realFetch(target, init);
      if (!response.ok && target !== input) response = await realFetch(input, init);
      try {
        const text = await response.clone().text();
        const channel = channelFromMaster(url);
        if (channel) {
          for (const variant of parseMaster(text, url)) {
            rememberVariant(variant.url, {
              channel: channel,
              resolution: variant.resolution,
              fps: variant.fps,
              codecs: variant.codecs,
              video: variant.video,
              audio: variant.audio,
              subtitles: variant.subtitles,
              bandwidth: variant.bandwidth,
              master: url,
              ts: Date.now()
            });
          }
        }
      } catch (_) {}
      return response;
    }

    async function handleMedia(input, init, url) {
      const response = await realFetch(input, init);
      if (!response.ok) return response;
      let text = '';
      try { text = await response.clone().text(); } catch (_) { return response; }
      prune(media, MEDIA_MAX, MEDIA_TTL);
      const info = media.get(url) || media.get(canonical(url));
      const evidence = playlistEvidence(text);
      if (!evidence.confirmed) {
        const quarantine = nativeAdQuarantineState(info, evidence);
        if (quarantine.active) {
          // Twitch media playlists are sliding windows. An ad marker can vanish
          // one refresh before its generic/untitled media segments do, so never
          // learn or return that refresh as clean. Keep serving the clean backup
          // when available; otherwise advance with a local silent hold segment.
          try {
            const held = await cachedBackupResponse(info, response, false);
            if (held) return held;
          } catch (_) {}
          try { getBackup(info, false); } catch (_) {}
          wlog('  ad marker slid out; holding native stream until clean boundary');
          post('ad-state', { state: 'blocked-hold', channel: info && info.channel || '' });
          return responseWithText(response, holdPlaylist(evidence, info), 'application/vnd.apple.mpegurl');
        }
        if (quarantine.release && info) info.backupActive = false;
        if (info && !evidence.hasMarker && !evidence.strongMetadata) {
          info.lastCleanNative = absolutizeMediaPlaylist(text, url);
          info.lastCleanNativeAt = Date.now();
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
        // Once this stream/account is known to serve ads, keep a clean backup
        // warm during ad-free playback so the next break can swap instantly
        // instead of leaking a beat of ad before the swap catches up.
        if (adsSeen && info) { try { getBackup(info, false); } catch (_) {} }
        return response;
      }
      adsSeen = true;
      beginAdQuarantine(info, evidence);
      wlog('AD detected ' + url.slice(-40));
      if (!info) wlog('  no variant info (master not mapped for this media url)');
      if (info) {
        try {
          const replacement = await cleanBackupResponse(info, response);
          if (replacement) {
            wlog('  -> swapped to CLEAN backup');
            post('ad-state', { state: 'blocked-clean', channel: info.channel });
            return replacement;
          }
        } catch (e) { wlog('  backup swap error: ' + (e && e.message || e)); }
      }
      if (info) {
        info.backupActive = false;
        info.cleanNativePolls = 0;
      }
      wlog('  -> no clean backup; replacing confirmed ad media');
      post('ad-state', { state: 'blocked-gap', channel: info && info.channel || '' });
      return responseWithText(response, stripAdPlaylist(text, info), 'application/vnd.apple.mpegurl');
    }

    self.addEventListener('message', (event) => {
      const message = event && event.data;
      if (!message || message[FLAG] !== runtimeVersion) return;
      try { if (event.stopImmediatePropagation) event.stopImmediatePropagation(); } catch (_) {}
      if (message.type === 'config') {
        active = message.enabled !== false;
      } else if (message.type === 'client-state' && message.state) {
        client = Object.assign({}, client, message.state);
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
      if (MASTER_RE.test(url) && url.includes('.m3u8')) return handleMaster(input, init, url);
      if (url.includes('.m3u8')) return handleMedia(input, init, url);
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
    if (typeof NativeWorker !== 'function' || NativeWorker.__wwTwitchCurrent) return;

    function TwitchWorker(scriptUrl, options) {
      let protocol = '';
      try { protocol = new URL(String(scriptUrl), location.href).protocol; } catch (_) {}
      var wwTwitchBlob = protocol === 'blob:' && !(options && options.type === 'module') && workerOriginIsTwitch(scriptUrl);
      if (!enabled || !wwTwitchBlob) {
        if (wwTwitchBlob) { try { console.log('[WW-Twitch] worker skipped (adblock disabled)'); } catch (_) {} }
        return new NativeWorker(scriptUrl, options);
      }
      const originalSource = readWorkerSource(scriptUrl);
      if (!originalSource) { try { console.log('[WW-Twitch] worker NOT hooked: blob source unreadable'); } catch (_) {} return new NativeWorker(scriptUrl, options); }

      let wrapperUrl = '';
      try {
        const bootstrap = '(' + twitchWorkerRuntime.toString() + ')(' +
          'null,' + JSON.stringify(publicClientState()) + ',' + JSON.stringify(VERSION) + ');\n';
        wrapperUrl = URL.createObjectURL(new Blob([bootstrap, originalSource], { type: 'application/javascript' }));
        const worker = new NativeWorker(wrapperUrl, options);
        try { console.log('[WW-Twitch] worker HOOKED — ad interception active'); } catch (_) {}
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
              worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'config', enabled: enabled });
              worker.postMessage({ [MESSAGE_FLAG]: VERSION, type: 'client-state', revision: revision, state: publicClientState() });
            } catch (_) {}
          } else if (message.type === 'gql-request') {
            proxyWorkerGql(worker, message);
          } else if (message.type === 'ad-state') {
            try {
              document.documentElement.setAttribute('data-ww-twitch-adblock', String(message.state || 'active'));
            } catch (_) {}
          } else if (message.type === 'log') {
            try { console.log('[WW-Twitch]', message.m); } catch (_) {}
          }
        });
        worker.addEventListener('error', () => workers.delete(worker), { once: true });
        return worker;
      } catch (_) {
        if (wrapperUrl) {
          try { URL.revokeObjectURL(wrapperUrl); } catch (_) {}
        }
        return new NativeWorker(scriptUrl, options);
      }
    }

    try {
      TwitchWorker.prototype = NativeWorker.prototype;
      Object.setPrototypeOf(TwitchWorker, NativeWorker);
      Object.defineProperty(TwitchWorker, '__wwTwitchCurrent', { value: VERSION });
      Object.defineProperty(TwitchWorker, 'name', { value: 'Worker' });
      TwitchWorker.toString = Function.prototype.toString.bind(NativeWorker);
    } catch (_) {}
    window.Worker = TwitchWorker;
  }

  updateEnabled();
  installWorkerHook();
  installFetchHook();
})();

/*
 * WardenOne -- bridge (ISOLATED world)
 * ====================================
 * The MAIN-world content script (content.js) does the actual blocking, but it
 * can't talk to the extension's background service worker directly. This bridge
 * runs in the ISOLATED world (same page, but with access to chrome.* APIs) and
 * relays two things:
 *   1. block/detection events from the main world -> background (for the badge)
 *   2. config overrides from background -> main world (via window.postMessage)
 */
(function () {
  'use strict';

  const BRIDGE_VERSION = '1.0.0';
  if (window.__wardenOneBridgeVersion === BRIDGE_VERSION) {
    try {
      if (typeof window.__wardenOneBridgeReplay === 'function') {
        window.__wardenOneBridgeReplay();
        return;
      }
    } catch (_) {}
  }
  window.__wardenOneBridgeVersion = BRIDGE_VERSION;

  // A per-page-load routing token. It keeps accidental/cross-extension messages
  // out, but the MAIN-world page can observe window messages, so background-side
  // handlers still treat token-bearing page events as forgeable and constrain the
  // dangerous paths with sender checks, rate limits, and sanitized inputs.
  const TOKEN = (function () {
    try {
      const a = new Uint32Array(4); crypto.getRandomValues(a);
      return Array.from(a, (n) => n.toString(36)).join('');
    } catch (_) { return String(Math.random()) + Date.now().toString(36); }
  })();
  const BRIDGE_RATE = Object.create(null);
  function bridgeRateOk(bucket, max, windowMs) {
    const key = String(bucket || 'message');
    const now = Date.now();
    const start = now - (Number(windowMs) || 60000);
    const hits = Array.isArray(BRIDGE_RATE[key]) ? BRIDGE_RATE[key].filter((t) => t > start) : [];
    if (hits.length >= (Number(max) || 60)) {
      BRIDGE_RATE[key] = hits;
      return false;
    }
    hits.push(now);
    BRIDGE_RATE[key] = hits;
    return true;
  }

  // MAIN-world events are visible to the page and must be treated as untrusted.
  // Keep useful diagnostics, but never let a page enqueue megabytes of nested
  // data into extension messaging/history storage.
  function boundedBridgeDetail(value) {
    const seen = new WeakSet();
    const budget = { chars: 0 };
    const copy = (input, depth) => {
      if (input == null || typeof input === 'boolean') return input;
      if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
      if (typeof input === 'string') {
        const text = input.slice(0, 600);
        budget.chars += text.length;
        return budget.chars <= 6000 ? text : '';
      }
      if (depth >= 2 || (typeof input !== 'object' && !Array.isArray(input))) return undefined;
      if (seen.has(input)) return undefined;
      seen.add(input);
      if (Array.isArray(input)) {
        const out = [];
        for (let i = 0; i < input.length && i < 16 && budget.chars <= 6000; i++) {
          const item = copy(input[i], depth + 1);
          if (item !== undefined) out.push(item);
        }
        return out;
      }
      const out = {};
      let count = 0;
      for (const key of Object.keys(input)) {
        if (count++ >= 24 || budget.chars > 6000) break;
        const cleanKey = String(key).slice(0, 80);
        budget.chars += cleanKey.length;
        let item;
        try { item = copy(input[key], depth + 1); } catch (_) { item = undefined; }
        if (item !== undefined) out[cleanKey] = item;
      }
      return out;
    };
    try { return copy(value, 0); } catch (_) { return null; }
  }

  function pageTargetOrigin() {
    try {
      if ((location.protocol === 'http:' || location.protocol === 'https:') && location.origin && location.origin !== 'null') {
        return location.origin;
      }
    } catch (_) {}
    return '*';
  }

  function postToPage(message) {
    try { window.postMessage(message, pageTargetOrigin()); } catch (_) {}
  }

  function publicSafeBrowsingResult(res) {
    const r = res && typeof res === 'object' ? res : { ok: false, error: 'No Safe Browsing response' };
    return {
      ok: !!r.ok,
      enabled: !!r.enabled,
      hit: !!r.hit,
      warning: !!r.warning,
      cached: !!r.cached,
      timeout: !!r.timeout,
      error: r.error ? String(r.error).slice(0, 120) : '',
    };
  }

  const WO_MODAL = {
    overlay: (align) => 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(61,42,82,.48)!important;color:#3d2a52!important;padding:24px!important;font-family:Nunito,system-ui,sans-serif!important;text-align:' + (align || 'left') + '!important;backdrop-filter:blur(10px) saturate(1.2)!important;-webkit-backdrop-filter:blur(10px) saturate(1.2)!important;',
    panel: (width, gap) => 'all:initial!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;gap:' + (gap || '13px') + '!important;max-width:' + (width || '680px') + '!important;width:min(' + (width || '680px') + ',calc(100vw - 32px))!important;border:1px solid rgba(176,106,212,.34)!important;border-left:4px solid #9d54c9!important;border-radius:16px!important;background:linear-gradient(135deg,#faf2fe,#f4e9fb)!important;color:#3d2a52!important;padding:22px!important;box-shadow:0 24px 90px rgba(120,55,160,.32)!important;font-family:Nunito,system-ui,sans-serif!important;',
    title: 'all:initial!important;color:#3d2a52!important;font:800 18px/1.25 Nunito,system-ui,sans-serif!important;',
    body: 'all:initial!important;color:#5f456f!important;font:600 14px/1.5 Nunito,system-ui,sans-serif!important;',
    meta: 'all:initial!important;color:#7a5f93!important;font:700 12px/1.45 Nunito,system-ui,sans-serif!important;background:#ede1f8!important;border:1px solid rgba(176,106,212,.22)!important;border-radius:9px!important;padding:9px 10px!important;word-break:break-word!important;',
    actions: (justify) => 'all:initial!important;display:flex!important;gap:9px!important;justify-content:' + (justify || 'flex-end') + '!important;flex-wrap:wrap!important;font-family:Nunito,system-ui,sans-serif!important;',
    status: 'all:initial!important;color:#7a5f93!important;font:700 12px/1.4 Nunito,system-ui,sans-serif!important;min-height:16px!important;',
    tag: (risk) => 'all:initial!important;align-self:flex-start!important;border-radius:999px!important;background:' + (/^high$/i.test(String(risk || '')) ? 'linear-gradient(135deg,#d868a2,#9d54c9)' : 'linear-gradient(135deg,#b06ad4,#e07ab0)') + '!important;color:#fff!important;padding:4px 9px!important;font:800 11px/1 Nunito,system-ui,sans-serif!important;box-shadow:0 6px 16px rgba(157,84,201,.22)!important;',
    button: (primary, size) => 'all:initial!important;box-sizing:border-box!important;border:' + (primary ? 'none' : '1px solid rgba(176,106,212,.38)') + '!important;background:' + (primary ? 'linear-gradient(135deg,#b06ad4,#e07ab0)' : 'rgba(61,42,82,.06)') + '!important;color:' + (primary ? '#fff' : '#5f456f') + '!important;cursor:pointer!important;border-radius:9px!important;padding:10px 14px!important;font:800 ' + (size || '12px') + '/1 Nunito,system-ui,sans-serif!important;box-shadow:' + (primary ? '0 8px 20px rgba(157,84,201,.26)' : 'none') + '!important;',
  };

  function bridgePrivateOrLocalHost(host) {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h || h.includes('%')) return true;
    if (/^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){0,3}|::1)$/i.test(h)) return true;
    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const a = Number(ipv4[1]), b = Number(ipv4[2]), c = Number(ipv4[3]), d = Number(ipv4[4]);
      if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true;
      if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a === 192 && b === 0 && c === 2) return true;
      if (a === 198 && (b === 18 || b === 19)) return true;
      if (a === 198 && b === 51 && c === 100) return true;
      if (a === 203 && b === 0 && c === 113) return true;
      return false;
    }
    if (h.includes(':')) return true;
    if (!h.includes('.')) return true;
    const tld = h.split('.').pop();
    return /^(local|localhost|lan|home|internal|intranet|corp|test|invalid|example)$/i.test(tld);
  }

  // normalizeBridgeHost is pure, and its cost is dominated by the new URL() it builds.
  // sendConfig runs it over the same host lists more than once per call and again on
  // every config change, so the answers are memoised. Bounded because a hostile page
  // cannot reach this, but a very large user-supplied list could otherwise grow it
  // without limit.
  const NORMALIZED_HOST_CACHE = new Map();
  const NORMALIZED_HOST_CACHE_MAX = 12000;
  function normalizeBridgeHost(value) {
    const key = typeof value === 'string' ? value : String(value || '');
    const cached = NORMALIZED_HOST_CACHE.get(key);
    if (cached !== undefined) return cached;
    const computed = normalizeBridgeHostUncached(value);
    if (NORMALIZED_HOST_CACHE.size >= NORMALIZED_HOST_CACHE_MAX) NORMALIZED_HOST_CACHE.clear();
    NORMALIZED_HOST_CACHE.set(key, computed);
    return computed;
  }

  function normalizeBridgeHostUncached(value) {
    let raw = String(value || '').trim();
    if (!raw || raw.length > 512) return '';
    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        raw = u.hostname;
      } else {
        raw = new URL('https://' + raw).hostname;
      }
    } catch (_) {
      if (/[/?#]/.test(raw)) return '';
    }
    const h = raw.toLowerCase().replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
    if (!h || h.length > 253 || h.includes('*') || h.includes('%') || h.includes('/') || h.includes('\\')) return '';
    if (!/^[a-z0-9.-]+$/i.test(h) || h.includes('..') || bridgePrivateOrLocalHost(h)) return '';
    const labels = h.split('.');
    if (labels.length < 2) return '';
    if (labels.some((label) => !label || label.length > 63 || /^-|-$/.test(label))) return '';
    return h;
  }

  function sanitizeBridgeHostList(list, limit) {
    const out = [];
    const seen = new Set();
    const max = Math.max(1, Math.min(Number(limit) || 1000, 5000));
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (out.length >= max) return;
      const h = normalizeBridgeHost(item);
      if (!h || seen.has(h)) return;
      seen.add(h);
      out.push(h);
    });
    return out;
  }

  // Hand the token to the main world once, immediately. content.js captures the
  // first token it sees at document_start and locks it in.
  postToPage({ source: 'wardenone-handshake', token: TOKEN });

  let learnedGrabberDomains = [];
  let supplementalLists = { adultDomainsExtra: [], grabberDomainsExtra: [], trustedPaymentHostsExtra: [] };
  let bridgeConfig = {};
  let bridgeConfigReady = false;

  // ---- Shared DOM watcher ----
  // Smart Script Shield, Script Drift and the Login Page Age check each ran their
  // own whole-document subtree MutationObserver, two of them for a full 60 seconds
  // on every top-level page. That fired three separate extension callbacks for every
  // mutation batch during the busiest minute of a page's life -- all to answer the
  // same question: did the DOM change?
  //
  // They share one observer now. Subscribers are deliberately independent: one
  // unsubscribing must never stop the others, so the observer is disconnected only
  // when the LAST subscriber leaves, and reconnected if one arrives afterwards
  // (Smart Script Shield re-arms on popstate/hashchange, long after the others are
  // finished). Records are passed through because Script Drift reads addedNodes.
  const domWatchers = new Set();
  let domObserver = null;
  let domWatchPending = false;

  function domWatchStart() {
    if (domObserver || !domWatchers.size) return;
    const root = document.documentElement;
    if (!root) {
      // A document whose element is not up yet at document_start. Try once more.
      if (domWatchPending) return;
      domWatchPending = true;
      try {
        document.addEventListener('DOMContentLoaded', () => {
          domWatchPending = false;
          domWatchStart();
        }, { once: true });
      } catch (_) { domWatchPending = false; }
      return;
    }
    try {
      domObserver = new MutationObserver((records) => {
        // Snapshot the set: a subscriber may unsubscribe from inside its own
        // callback (the login-age watcher does), and one throwing must not stop the
        // rest from being told.
        for (const fn of Array.from(domWatchers)) {
          try { fn(records); } catch (_) {}
        }
      });
      domObserver.observe(root, { childList: true, subtree: true });
    } catch (_) {
      domObserver = null;
    }
  }

  function domWatchStop() {
    if (!domObserver) return;
    try { domObserver.disconnect(); } catch (_) {}
    domObserver = null;
  }

  // Returns an unsubscribe function. Safe to call more than once.
  function domWatch(fn) {
    if (typeof fn !== 'function') return function () {};
    domWatchers.add(fn);
    domWatchStart();
    let released = false;
    return function () {
      if (released) return;
      released = true;
      domWatchers.delete(fn);
      if (!domWatchers.size) domWatchStop();
    };
  }

  // WardenOne's warnings, and its one privileged control, used to be ordinary elements in the
  // page's DOM that we found again by id or CSS selector. Both halves of that were page-owned
  // data:
  //
  //   * Any page can build an element matching a selector. The cookie escape hatch identified
  //     its own button with closest('#rg-reload-loop [data-wo-cookie-allow="1"]'), so a page
  //     could plant that exact structure, label it "Play video", and turn one genuine user click
  //     into contentSettings.cookies -> allow for itself. The trusted-click check passed, because
  //     the click really was the user's -- what was forged was the element, not the gesture.
  //   * Any page can delete an element by id. The login-age warning exists to say "this site is
  //     probably phishing", and the site it accuses could remove it with one call.
  //
  // Both are answered by owning the nodes instead of describing them. A CLOSED shadow root's
  // handle exists only here, in the isolated world: `host.shadowRoot` is null from the page, so
  // the page cannot read the contents, inject into them, or hand us a lookalike. And because we
  // keep direct references to what we built, "is this ours?" is an object comparison instead of a
  // selector match, and listeners bind to the exact node rather than to the document.
  //
  // The host still carries an id and data-wo-ui="1". Those are labels, not credentials -- the
  // engine's overlay cleaner and EyeShield both skip WardenOne's own UI by them, and that has to
  // keep working. Nothing trusts them any more.
  const WO_OWNED_HOST_STYLE = 'all:initial!important;position:fixed!important;inset:auto!important;'
    + 'z-index:2147483647!important;';

  function woOwnedOverlay(id) {
    let host = null;
    let shadow = null;
    let unwatch = null;
    let gone = false;

    const container = () => document.body || document.documentElement || null;

    function build() {
      host = document.createElement('div');
      try {
        host.id = id;
        host.setAttribute('data-wo-ui', '1');
        host.setAttribute('style', WO_OWNED_HOST_STYLE);
      } catch (_) {}
      // If attachShadow is unavailable or the page has broken it, fall back to rendering into
      // the host directly. That is the old, weaker arrangement rather than no warning at all --
      // for the interstitials, being removable beats being invisible.
      try {
        shadow = host.attachShadow({ mode: 'closed' });
      } catch (_) {
        shadow = host;
      }
      return shadow;
    }

    function place() {
      const parent = container();
      if (!parent || !host) return false;
      try {
        if (host.parentNode !== parent) parent.appendChild(host);
        return true;
      } catch (_) {
        return false;
      }
    }

    return {
      // The shadow root to render into. Built on first use.
      root() { return shadow || build(); },
      // The node identity check: only nodes we created live in our shadow root.
      owns(node) {
        if (!node || !shadow) return false;
        try {
          // getRootNode() on a node inside a closed shadow root returns that root, and a page
          // cannot obtain it -- so a decoy in the page's DOM can never satisfy this.
          return node.getRootNode() === shadow;
        } catch (_) {
          return false;
        }
      },
      mount() {
        if (gone) return false;
        if (!shadow) build();
        const placed = place();
        // Self-healing. A page that removes the host gets it put straight back; the warning it
        // is trying to delete is about that page. Re-placing is cheap because the node and its
        // shadow tree are kept, so nothing is rebuilt.
        if (placed && !unwatch) {
          unwatch = domWatch(() => {
            if (gone || !host) return;
            try {
              if (!host.isConnected) place();
            } catch (_) {}
          });
        }
        return placed;
      },
      destroy() {
        gone = true;
        if (unwatch) { try { unwatch(); } catch (_) {} unwatch = null; }
        try { if (host) host.remove(); } catch (_) {}
        host = null;
        shadow = null;
      },
      // Only for our own bookkeeping; conveys no trust.
      hostNode() { return host; },
    };
  }

  // Handles for the three interstitials, so replacing one destroys the overlay we built rather
  // than whatever the page currently has under that id.
  let scriptDriftOverlay = null;
  let permChainOverlay = null;
  let loginAgeOverlay = null;

  // Smart Script Shield recovery is deliberately driven by this isolated-world
  // signal, not by a page-visible CustomEvent. The evidence is intentionally
  // narrow: an actual video, a recognised player library root, or a media-route
  // page containing a fullscreen/autoplay embed. Background still requires a
  // matching third-party script ERR_BLOCKED_BY_CLIENT before changing any rule.
  let smartPlayerEvidence = '';
  let smartPlayerLastSignalAt = 0;
  let smartPlayerScanCount = 0;
  let smartPlayerScanTimer = null;
  let smartPlayerUnwatch = null;
  let smartPlayerObserverGeneration = 0;
  let smartPlayerHeartbeat = null;
  const SMART_PLAYER_HEARTBEAT_MAX = 15;
  function stopSmartPlayerHeartbeat() {
    if (!smartPlayerHeartbeat) return;
    try { clearInterval(smartPlayerHeartbeat); } catch (_) {}
    smartPlayerHeartbeat = null;
  }
  function smartPlayerRoute(rawUrl) {
    try {
      const url = rawUrl ? new URL(String(rawUrl), location.href) : new URL(location.href);
      return /(?:^|\/)(?:watch|episode|episodes|stream|streaming|video|videos|play|player|embed)(?:\/|$|[-_?])/i.test(url.pathname + url.search);
    } catch (_) { return false; }
  }
  function smartPlayerStrongEvidence() {
    try {
      const scopedPlayerContext = smartPlayerRoute() || window.top !== window;
      if (scopedPlayerContext && document.querySelector('.video-js,.jwplayer,.plyr,.dplayer,.art-video-player,.clappr-container,.shaka-video-container,[data-shaka-player-container]')) {
        return 'known-player-root';
      }
      if (window.top !== window && document.querySelector([
        'script[src*="video.js"]', 'script[src*="video.min.js"]', 'script[src*="jwplayer"]',
        'script[src*="hls.js"]', 'script[src*="shaka-player"]', 'script[src*="dash.all"]',
        'script[src*="clappr"]', 'script[src*="plyr"]',
      ].join(','))) return 'known-player-root';
      // A nested embed frame is a player context in its own right, even when its
      // URL does not look like a watch/embed route -- intermediate embed hosts
      // often use opaque paths. Being a subframe is already the scoping signal.
      if (scopedPlayerContext) {
        if (document.querySelector('video')) return 'route-video';
        if (document.querySelector([
          'iframe[allowfullscreen]', 'iframe[allow*="autoplay"]', 'iframe[allow*="fullscreen"]',
          'iframe[allow*="picture-in-picture"]', 'iframe[allow*="encrypted-media"]',
        ].join(','))) return 'media-embed';
      }
    } catch (_) {}
    return '';
  }
  function sendSmartPlayerContext(force) {
    const now = Date.now();
    const evidence = smartPlayerStrongEvidence();
    if (!evidence) return false;
    smartPlayerEvidence = evidence;
    if (!force && now - smartPlayerLastSignalAt < 45000) return true;
    if (!bridgeRateOk('smart-player-context', 4, 120000)) return true;
    smartPlayerLastSignalAt = now;
    try { chrome.runtime.sendMessage({ kind: 'smart-player-context', evidence }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    if (smartPlayerUnwatch) {
      smartPlayerUnwatch();
      smartPlayerUnwatch = null;
    }
    if (!smartPlayerHeartbeat) {
      // Bounded on purpose. bridge.js runs in EVERY frame, so an unbounded beat
      // meant one permanent wakeup per frame that ever saw a player, for the life
      // of the frame. That is the same cost the Browser Abuse Guard was removed to
      // avoid. Stop once the evidence is gone, once the context is established
      // long enough to be acted on, or as soon as the frame goes away.
      let beats = 0;
      smartPlayerHeartbeat = setInterval(() => {
        if (!smartPlayerEvidence || ++beats > SMART_PLAYER_HEARTBEAT_MAX) {
          stopSmartPlayerHeartbeat();
          return;
        }
        sendSmartPlayerContext(true);
      }, 60000);
    }
    return true;
  }
  function scheduleSmartPlayerScan(delay) {
    if (smartPlayerEvidence || smartPlayerScanCount >= 48 || smartPlayerScanTimer) return;
    smartPlayerScanTimer = setTimeout(() => {
      smartPlayerScanTimer = null;
      smartPlayerScanCount += 1;
      sendSmartPlayerContext(false);
    }, Math.max(0, Number(delay) || 0));
  }
  function armSmartPlayerObservation() {
    if (!bridgeRateOk('smart-player-rearm', 16, 60000)) return false;
    smartPlayerEvidence = '';
    smartPlayerLastSignalAt = 0;
    smartPlayerScanCount = 0;
    scheduleSmartPlayerScan(0);
    if (smartPlayerUnwatch) {
      smartPlayerUnwatch();
      smartPlayerUnwatch = null;
    }
    const generation = ++smartPlayerObserverGeneration;
    smartPlayerUnwatch = domWatch(() => scheduleSmartPlayerScan(120));
    setTimeout(() => {
      // The generation check keeps a stale timer from tearing down the subscription
      // a later re-arm just created.
      if (generation !== smartPlayerObserverGeneration || !smartPlayerUnwatch) return;
      smartPlayerUnwatch();
      smartPlayerUnwatch = null;
    }, 20000);
    return true;
  }
  let smartPlayerTrustedIntentAt = 0;
  function smartPlayerIntentTarget(rawTarget) {
    try {
      const target = rawTarget && rawTarget.closest ? rawTarget : null;
      if (!target) return false;
      if (target.closest([
        'video', '.video-js', '.jwplayer', '.plyr', '.dplayer', '.art-video-player',
        '.clappr-container', '.shaka-video-container', '[data-shaka-player-container]',
        'iframe[allowfullscreen]', 'iframe[allow*="autoplay"]', 'iframe[allow*="fullscreen"]',
        'iframe[allow*="picture-in-picture"]', 'iframe[allow*="encrypted-media"]',
      ].join(','))) return true;
      // When the player UI is itself built by the third-party script Smart Script
      // Shield blocked, none of the checks above can ever match: no <video>, no
      // player root, and no labelled control is ever created. The recovery gesture
      // then becomes unreachable and the page sits on a dead spinner forever --
      // clicking the player is also invisible here, because a click inside a
      // cross-origin embed never reaches this document. Once this frame has
      // produced strong player evidence, treat any trusted click in it as player
      // intent. A page can fake the evidence DOM, but it cannot fake a trusted
      // user gesture, and that gesture is the property the recovery gate relies on.
      if (smartPlayerEvidence && (window.top !== window || smartPlayerRoute())) return true;
      if (!smartPlayerRoute()) return false;
      const control = target.closest('button,[role="button"],[data-episode],[data-server],a[href]');
      if (!control) return false;
      const label = String(control.textContent || control.getAttribute('aria-label')
        || control.getAttribute('title') || control.getAttribute('data-episode')
        || control.getAttribute('data-server') || '').slice(0, 160);
      return /(?:play|watch|server|episode|stream)/i.test(label);
    } catch (_) {
      return false;
    }
  }
  function sendSmartPlayerIntent() {
    if (!bridgeRateOk('smart-player-intent', 12, 60000)) return false;
    try { chrome.runtime.sendMessage({ kind: 'smart-player-intent' }, () => { void chrome.runtime.lastError; }); } catch (_) { return false; }
    return true;
  }
  function noteSmartPlayerIntent(event) {
    if (!event || event.isTrusted !== true) return;
    if (event.type === 'keydown' && !/^(?:Enter| |Spacebar|k|K|MediaPlayPause)$/.test(String(event.key || ''))) return;
    const target = event.type === 'keydown' && document.activeElement ? document.activeElement : event.target;
    if (!smartPlayerIntentTarget(target)) return;
    const now = Date.now();
    if (now - smartPlayerTrustedIntentAt < 400) return;
    smartPlayerTrustedIntentAt = now;
    sendSmartPlayerIntent();
  }
  try {
    window.addEventListener('pagehide', stopSmartPlayerHeartbeat, { once: true });
    armSmartPlayerObservation();
    document.addEventListener('DOMContentLoaded', () => scheduleSmartPlayerScan(0), { once: true });
    window.addEventListener('load', () => scheduleSmartPlayerScan(0), { once: true });
    window.addEventListener('popstate', () => armSmartPlayerObservation());
    window.addEventListener('hashchange', () => armSmartPlayerObservation());
    document.addEventListener('pointerdown', noteSmartPlayerIntent, true);
    document.addEventListener('click', noteSmartPlayerIntent, true);
    document.addEventListener('keydown', noteSmartPlayerIntent, true);
    document.addEventListener('click', (event) => {
      if (!event || event.isTrusted === false) return;
      const target = event.target && event.target.closest
        ? event.target.closest('a[href],button,[role="button"],[data-episode]')
        : null;
      if (!target) return;
      const href = target.href || '';
      const label = String(target.textContent || target.getAttribute('aria-label') || target.getAttribute('data-episode') || '').slice(0, 160);
      if (!smartPlayerRoute(href) && !/(?:watch|episode|stream|play|server)/i.test(label)) return;
      setTimeout(() => armSmartPlayerObservation(), 0);
    }, true);
    [30000, 90000, 180000].forEach((delay) => {
      setTimeout(() => {
        if (!smartPlayerEvidence && smartPlayerRoute()) armSmartPlayerObservation();
      }, delay);
    });
  } catch (_) {}

  function setLearnedGrabberDomains(learned) {
    try {
      // Both stages happen here now, at the storage boundary, so the merge in
      // sendConfig can trust the result instead of redoing the second one on every
      // page load in every frame.
      //
      // The order is load-bearing and matches what the two places used to do between
      // them. The bare-hostname regex runs FIRST and is the stricter of the two: it
      // rejects anything carrying a scheme, port or edge dots, which the shared gate
      // would otherwise happily parse a blockable hostname out of. Sanitising first
      // would turn a malformed learned key like "https://sub.example.co.uk/p" into a
      // live auto-block rather than discarding it -- blocking more than before, which
      // is the direction that breaks working sites.
      learnedGrabberDomains = sanitizeBridgeHostList(
        Object.keys(learned || {})
          .map((d) => String(d || '').replace(/^www\./, '').toLowerCase())
          .filter((d) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d)),
        1000);
    } catch (_) {
      learnedGrabberDomains = [];
    }
  }

  function setSupplementalLists(raw) {
    const lists = raw && typeof raw === 'object' ? raw : {};
    supplementalLists = {
      adultDomainsExtra: sanitizeBridgeHostList(lists.adultDomainsExtra, 3000),
      grabberDomainsExtra: sanitizeBridgeHostList(lists.grabberDomainsExtra, 1500),
      trustedPaymentHostsExtra: sanitizeBridgeHostList(lists.trustedPaymentHostsExtra, 300),
    };
  }

  function mergeBridgeHostLists(limit, ...lists) {
    const out = [];
    const seen = new Set();
    const max = Math.max(1, Math.min(Number(limit) || 1000, 5000));
    for (const list of lists) {
      for (const item of (Array.isArray(list) ? list : [])) {
        if (out.length >= max) return out;
        const h = normalizeBridgeHost(item);
        if (!h || seen.has(h)) continue;
        seen.add(h);
        out.push(h);
      }
    }
    return out;
  }

  // Dedupe and cap, without re-normalising. Only safe for lists that already came out
  // of sanitizeBridgeHostList: normalizeBridgeHost is idempotent and that function's
  // output is a fixed point, so a second pass over it cannot change an entry -- it can
  // only cost time. Anything user- or remote-supplied must still go through
  // mergeBridgeHostLists.
  function mergeNormalizedHostLists(limit, ...lists) {
    const out = [];
    const seen = new Set();
    const max = Math.max(1, Math.min(Number(limit) || 1000, 5000));
    for (const list of lists) {
      for (const item of (Array.isArray(list) ? list : [])) {
        if (out.length >= max) return out;
        if (!item || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  }

  function permissionChainGuardOn() {
    return bridgeConfigReady && bridgeConfig.enabled !== false && bridgeConfig.permissionChainGuard !== false && !bridgeHostAllowedByUser();
  }

  function scriptDriftGuardOn() {
    return bridgeConfigReady && bridgeConfig.enabled !== false && bridgeConfig.scriptDriftGuard !== false && !bridgeHostAllowedByUser();
  }

  function loginAgeGuardOn() {
    return bridgeConfigReady && bridgeConfig.enabled !== false && bridgeConfig.loginAgeCheck !== false && !bridgeHostAllowedByUser();
  }

  function bridgeSilentModeOn() {
    return bridgeConfigReady && bridgeConfig.silentMode === true;
  }

  function bridgeCleanHost(value) {
    return String(value || '').replace(/^www\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
  }

  function bridgeHostMatchesList(host, list) {
    const h = bridgeCleanHost(host);
    if (!h || !Array.isArray(list)) return false;
    return list.some((item) => {
      const d = bridgeCleanHost(item);
      return !!(d && (h === d || h.endsWith('.' + d)));
    });
  }

  function bridgeHostAllowedByUser() {
    return bridgeHostMatchesList(location.hostname, bridgeConfig.allowlist || []);
  }

  const SEARCH_AI_PREPAINT_CSS = [
    ':is(.MjjYud,div[data-hveid],div[jscontroller],div[jsname],g-section-with-header,section,aside):has(#m-x-content):not(:has(#rso,#search,#res,#center_col,.related-question-pair))',
    ':is(#m-x-content):not(:has(#rso,#search,#res,#center_col))',
    '#llm-answer,.llm-answer,[data-testid="llm-answer"],[data-testid="ai-answer"],[data-testid="answer-with-ai"]',
  ].join(',') + '{display:none!important;visibility:hidden!important;pointer-events:none!important;}' +
    ':is(html,#rso,#search,#res,#center_col) .related-question-pair #m-x-content{display:block!important;visibility:visible!important;pointer-events:auto!important;}';
  const SEARCH_SPONSORED_PREPAINT_CSS = [
    '#tads,#tadsb,#bottomads,#taw,#tvcap,.commercial-unit-desktop-top,.commercial-unit-desktop-rhs,.commercial-unit-mobile-top,.pla-unit,.uEierd,[data-text-ad],[data-pla],[data-google-query-id],div[aria-label="Ads"],div[aria-label="Sponsored"]',
    '[data-testid="ad"],[data-testid="ad-result"],[data-testid="sponsored-result"],.ad-result,.sponsored-result',
  ].join(',') + '{display:none!important;visibility:hidden!important;pointer-events:none!important;}' +
    ':is(html,#rso,#search,#res,#center_col) .related-question-pair :is(div[aria-label="Sponsored"],div[aria-label="Ads"]){display:block!important;visibility:visible!important;pointer-events:auto!important;}';

  function bridgeIsSearchResults() {
    try {
      return (/(^|\.)google\.[a-z.]+$/i.test(location.hostname) && /^\/(search|webhp)?$/i.test(location.pathname || '/'))
        || (location.hostname === 'search.brave.com' && /^\/search$/i.test(location.pathname || '/'));
    } catch (_) {
      return false;
    }
  }

  function bridgeSearchAiCleanupOn() {
    return bridgeConfigReady
      && bridgeConfig.enabled !== false
      && (bridgeConfig.blockSearchAiAnswers === true || bridgeConfig.googleSearchResultCleanup === true)
      && !bridgeHostAllowedByUser();
  }

  function bridgeSearchSponsoredCleanupOn() {
    return bridgeConfigReady
      && bridgeConfig.enabled !== false
      && (bridgeConfig.blockSponsoredSearchResults === true || bridgeConfig.googleSearchResultCleanup === true)
      && !bridgeHostAllowedByUser();
  }

  function bridgeSyncGoogleCleanupCss() {
    try {
      if (!bridgeIsSearchResults()) return;
      const syncOne = (id, on, css) => {
        const existing = document.getElementById(id);
        if (!on) {
          if (existing) existing.remove();
          return;
        }
        if (existing) return;
        const s = document.createElement('style');
        s.id = id;
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      };
      syncOne('wo-search-ai-cleanup-prepaint-css', bridgeSearchAiCleanupOn(), SEARCH_AI_PREPAINT_CSS);
      syncOne('wo-search-sponsored-cleanup-prepaint-css', bridgeSearchSponsoredCleanupOn(), SEARCH_SPONSORED_PREPAINT_CSS);
    } catch (_) {}
  }

  const SAFE_BROWSING_INTENT_TTL_MS = 8000;
  const safeBrowsingIntentUrls = [];
  let safeBrowsingTrustedAt = 0;
  function safeBrowsingCanonicalUrl(raw) {
    try {
      const u = new URL(String(raw || ''), location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      u.hash = '';
      return u.href;
    } catch (_) {
      return '';
    }
  }
  function rememberSafeBrowsingIntent(raw) {
    const href = safeBrowsingCanonicalUrl(raw);
    if (!href) return;
    const now = Date.now();
    safeBrowsingIntentUrls.push({ href, at: now });
    while (safeBrowsingIntentUrls.length > 40) safeBrowsingIntentUrls.shift();
  }
  function rememberSafeBrowsingRedirectTargets(raw) {
    try {
      const href = safeBrowsingCanonicalUrl(raw);
      if (!href) return;
      const u = new URL(href);
      ['url', 'u', 'q', 'adurl', 'target', 'dest', 'destination', 'redirect', 'redirect_url', 'to'].forEach((key) => {
        const v = u.searchParams.get(key);
        if (/^https?:\/\//i.test(String(v || ''))) rememberSafeBrowsingIntent(v);
      });
    } catch (_) {}
  }
  function markTrustedSafeBrowsingEvent(e) {
    if (!e || e.isTrusted === false) return false;
    safeBrowsingTrustedAt = Date.now();
    return true;
  }
  function safeBrowsingFormAction(form) {
    try {
      return form && (form.getAttribute('action') || form.action) || location.href;
    } catch (_) {
      return location.href;
    }
  }
  function safeBrowsingIntentAllowed(rawUrl, context) {
    const href = safeBrowsingCanonicalUrl(rawUrl);
    if (!href) return false;
    const now = Date.now();
    for (let i = safeBrowsingIntentUrls.length - 1; i >= 0; i--) {
      if (now - safeBrowsingIntentUrls[i].at > SAFE_BROWSING_INTENT_TTL_MS) safeBrowsingIntentUrls.splice(i, 1);
    }
    const current = safeBrowsingCanonicalUrl(location.href);
    if (href === current) return true;
    if (safeBrowsingIntentUrls.some((item) => item.href === href)) return true;
    // Payment guards can use fetch/XHR after the click/input event that submitted
    // the checkout. There may be no DOM form action to bind to, so keep this short.
    return context === 'form' && now - safeBrowsingTrustedAt <= 2500;
  }
  try {
    document.addEventListener('click', (e) => {
      if (!markTrustedSafeBrowsingEvent(e)) return;
      const target = e.target;
      const link = target && target.closest ? target.closest('a[href],area[href]') : null;
      if (link) {
        rememberSafeBrowsingIntent(link.href || link.getAttribute('href'));
        rememberSafeBrowsingRedirectTargets(link.href || link.getAttribute('href'));
      }
      const form = target && target.closest ? target.closest('form') : null;
      if (form) rememberSafeBrowsingIntent(safeBrowsingFormAction(form));
    }, true);
    document.addEventListener('submit', (e) => {
      if (!markTrustedSafeBrowsingEvent(e)) return;
      rememberSafeBrowsingIntent(location.href);
      rememberSafeBrowsingIntent(safeBrowsingFormAction(e.target));
    }, true);
    document.addEventListener('paste', (e) => {
      if (!markTrustedSafeBrowsingEvent(e)) return;
      rememberSafeBrowsingIntent(location.href);
      const target = e.target;
      const form = target && target.closest ? target.closest('form') : null;
      if (form) rememberSafeBrowsingIntent(safeBrowsingFormAction(form));
    }, true);
    document.addEventListener('input', (e) => {
      const target = e && e.target;
      if (!markTrustedSafeBrowsingEvent(e) || !target) return;
      const hay = String((target.name || '') + ' ' + (target.id || '') + ' ' + (target.autocomplete || '') + ' ' + (target.placeholder || '')).toLowerCase();
      if (/cc-|card|credit|debit|cardnumber|ccnum|pan|cvc|cvv|security.?code/.test(hay)) {
        rememberSafeBrowsingIntent(location.href);
        const form = target.closest ? target.closest('form') : null;
        if (form) rememberSafeBrowsingIntent(safeBrowsingFormAction(form));
      }
    }, true);
  } catch (_) {}

  const sendConfig = (overrides) => {
    const raw = (overrides && typeof overrides === 'object') ? overrides : {};
    bridgeConfig = Object.assign({}, bridgeConfig, raw);
    bridgeConfig.allowlist = sanitizeBridgeHostList(bridgeConfig.allowlist, 1000);
    bridgeConfig.forgetMeList = sanitizeBridgeHostList(bridgeConfig.forgetMeList, 1000);
    bridgeConfigReady = true;
    bridgeSyncGoogleCleanupCss();
    const clean = Object.assign({}, raw);
    // Provider API keys must never reach the MAIN world, where any page script can
    // read them. Strip by pattern rather than by name: a hand-written delete list
    // silently leaks the day someone adds an eighth provider. Anything ending in
    // "Key" is treated as a secret, and tools/test-secret-hygiene.js fails if a
    // secret-shaped field in DEFAULT_CONFIG is not covered here.
    for (const field of Object.keys(clean)) {
      if (/Key$/.test(field)) delete clean[field];
    }
    delete clean.forgetMeAllConfirmedAt;
    clean.allowlist = sanitizeBridgeHostList(clean.allowlist, 1000);
    clean.forgetMeList = sanitizeBridgeHostList(clean.forgetMeList, 1000);
    // The stored `raw.*Extra` lists are user/remote supplied and still need the full
    // gate. learnedGrabberDomains and supplementalLists.* already came out of it at the
    // storage boundary, so they are merged by identity -- re-normalising them was the
    // bulk of the per-frame cost, paid again on every page load in every frame.
    const grabberExtras = mergeNormalizedHostLists(1500,
      sanitizeBridgeHostList(raw.grabberDomainsExtra, 1500),
      learnedGrabberDomains,
      supplementalLists.grabberDomainsExtra);
    if (grabberExtras.length) clean.grabberDomainsExtra = grabberExtras;
    else delete clean.grabberDomainsExtra;
    const adultExtras = mergeNormalizedHostLists(3000,
      sanitizeBridgeHostList(raw.adultDomainsExtra, 3000),
      supplementalLists.adultDomainsExtra);
    if (adultExtras.length) clean.adultDomainsExtra = adultExtras;
    else delete clean.adultDomainsExtra;
    const paymentExtras = mergeNormalizedHostLists(300,
      sanitizeBridgeHostList(raw.trustedPaymentHostsExtra, 300),
      supplementalLists.trustedPaymentHostsExtra);
    if (paymentExtras.length) clean.trustedPaymentHostsExtra = paymentExtras;
    else delete clean.trustedPaymentHostsExtra;
    postToPage({ source: 'wardenone', kind: 'config', token: TOKEN, overrides: clean });
    try { document.dispatchEvent(new CustomEvent('wo-bridge-config-ready')); } catch (_) {}
  };
  try {
    window.__wardenOneBridgeReplay = () => {
      postToPage({ source: 'wardenone-handshake', token: TOKEN });
      if (bridgeConfigReady) sendConfig(bridgeConfig);
    };
  } catch (_) {}

  // 1. Listen for the custom events the main-world trap dispatches on document,
  //    and forward block/detection counts to the background for the toolbar badge.
  document.addEventListener('wo-event', (e) => {
    const d = (e && e.detail) || {};
    // Route only token-bearing events. The token is not treated as a true secret;
    // background learning and privileged actions are separately constrained.
    if (d.token !== TOKEN) return;
    const type = d.type || '';
    if (/^blocked_|^detected_|^gated_|^warned_/.test(type)) {
      if (!bridgeRateOk('wo-event', 240, 60000)) return;
      try {
        chrome.runtime.sendMessage({ kind: 'rg-block', type, detail: boundedBridgeDetail(d.detail) }, () => { void chrome.runtime.lastError; });
      } catch (_) {
        // background may be asleep; it's fine, the badge is best-effort
      }
      // silent === true means the hardener kept the user on their page (forced
      // redirect / popunder / overlay click) — no interstitial, just the badge.
      if (type === 'blocked_gestureless_nav' && d.detail && d.detail.url && d.detail.why !== 'no recent user gesture' && d.detail.silent !== true) {
        try {
          chrome.runtime.sendMessage({ kind: 'redirect-warning', detail: boundedBridgeDetail(d.detail) }, () => { void chrome.runtime.lastError; });
        } catch (_) {}
      }
    }
  });

  // 2. Pull any saved config overrides and hand them to the main world.
  //    The main-world script reads window.__WO_CONFIG__ at install; we also
  //    support a late override via postMessage for when settings change.
  try {
    chrome.storage?.local?.get(['wardenone_config', 'wardenone_learned', 'wardenone_aux_lists'], (res) => {
      setLearnedGrabberDomains(res && res.wardenone_learned);
      setSupplementalLists(res && res.wardenone_aux_lists);
      const overrides = res && res.wardenone_config;
      sendConfig(overrides || {});
    });
  } catch (_) {}

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local') return;
      const learnedChanged = !!changes.wardenone_learned;
      if (learnedChanged) setLearnedGrabberDomains(changes.wardenone_learned.newValue);
      const supplementalChanged = !!changes.wardenone_aux_lists;
      if (supplementalChanged) setSupplementalLists(changes.wardenone_aux_lists.newValue);
      if (changes.wardenone_config) {
        sendConfig(changes.wardenone_config.newValue || {});
      } else if (learnedChanged || supplementalChanged) {
        chrome.storage.local.get('wardenone_config', (res) => {
          const overrides = res && res.wardenone_config;
          sendConfig(overrides || {});
        });
      }
    });
  } catch (_) {}

  // Relay live config changes (from the options/popup page) into the page.
  try {
    const smartFrameReloadedUrls = new Set();
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.kind === 'config-update' && msg.overrides) sendConfig(msg.overrides);
      if (msg && msg.kind === 'smart-script-route-changed') {
        smartFrameReloadedUrls.clear();
        armSmartPlayerObservation();
        if (Date.now() - smartPlayerTrustedIntentAt <= 3000) sendSmartPlayerIntent();
        try { sendResponse({ ok: true }); } catch (_) {}
        return true;
      }
      if (msg && msg.kind === 'smart-script-reload-frame') {
        let expected = '';
        let current = '';
        // Player embeds routinely rewrite their own URL (query/token churn) between
        // the blocked request and this message arriving. Requiring an exact match
        // rejected the reload and stranded the recovery, so match on same-origin
        // plus same path instead -- still never reloads a frame that has navigated
        // somewhere else, which is what this guard exists to prevent.
        let sameFrame = false;
        const failedHost = String(msg.failedHost || '').replace(/^\.+|\.+$/g, '').toLowerCase();
        const recoveryStage = Number(msg.recoveryStage);
        try {
          const expectedUrl = new URL(String(msg.expectedUrl || ''));
          const currentUrl = new URL(location.href);
          expectedUrl.hash = '';
          currentUrl.hash = '';
          expected = expectedUrl.href;
          current = currentUrl.href;
          sameFrame = expected === current
            || (expectedUrl.origin === currentUrl.origin && expectedUrl.pathname === currentUrl.pathname);
        } catch (_) {}
        const reloadKey = expected + '|' + failedHost + '|stage-' + String(recoveryStage);
        if (!expected || !sameFrame || !failedHost || !failedHost.includes('.')
          || !/^[a-z0-9.-]+$/i.test(failedHost) || failedHost.includes('..')
          || (recoveryStage !== 1 && recoveryStage !== 2)
          || smartFrameReloadedUrls.has(reloadKey)) {
          try { sendResponse({ ok: false }); } catch (_) {}
          return true;
        }
        smartFrameReloadedUrls.add(reloadKey);
        if (smartFrameReloadedUrls.size > 16) smartFrameReloadedUrls.delete(smartFrameReloadedUrls.values().next().value);
        try { sendResponse({ ok: true }); } catch (_) {}
        setTimeout(() => { try { location.reload(); } catch (_) {} }, 0);
        return true;
      }
    });
  } catch (_) {}

  // Safe Browsing relay: MAIN-world guards ask for a URL reputation verdict, but
  // only the background worker can read the saved API key. Results are posted
  // back with the same per-load token used by config messages.
  try {
    const SAFE_BROWSING_CONTEXTS = new Set(['link', 'paste', 'form']);
    document.addEventListener('wo-safe-browsing-check', (e) => {
      const d = (e && e.detail) || {};
      const id = String(d.id || '');
      const url = String(d.url || '');
      const context = String(d.context || '').slice(0, 24);
      if (d.token !== TOKEN) return;
      if (!id || !/^https?:\/\//i.test(url)) return;
      if (url.length > 2048 || !SAFE_BROWSING_CONTEXTS.has(context)) return;
      if (!safeBrowsingIntentAllowed(url, context)) {
        postToPage({
          source: 'wardenone-safe-browsing',
          token: TOKEN,
          id,
          result: { ok: false, error: 'No recent user intent for this reputation check.' },
        });
        return;
      }
      if (!bridgeRateOk('safe-browsing-check', 45, 60000)) {
        postToPage({
          source: 'wardenone-safe-browsing',
          token: TOKEN,
          id,
          result: { ok: false, error: 'Rate limited by WardenOne.' },
        });
        return;
      }
      chrome.runtime.sendMessage({ kind: 'safe-browsing-check', url, context }, (res) => { void chrome.runtime.lastError;
        postToPage({
          source: 'wardenone-safe-browsing',
          token: TOKEN,
          id,
          result: publicSafeBrowsingResult(res),
        });
      });
    }, true);
  } catch (_) {}

  // Narrow MAIN-world -> background relay. content.js runs in the page's MAIN
  // world so it cannot rely on chrome.runtime directly; only these vetted message
  // kinds are forwarded through the isolated bridge.
  try {
    const relayPageHost = () => String(location.hostname || '').replace(/^www\./, '').toLowerCase();
    const relaySamePageHost = (host) => {
      const clean = String(host || '').replace(/^www\./, '').toLowerCase();
      const here = relayPageHost();
      return !!(clean && here && clean === here);
    };
    const relayAllowedMessage = (raw) => {
      const msg = Object.assign({}, raw || {});
      if (msg.kind === 'adshield-cosmetic') {
        const hostname = String(msg.hostname || '').replace(/^www\./, '').toLowerCase();
        if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) return null;
        if (!relaySamePageHost(hostname)) return null;
        return { kind: 'adshield-cosmetic', hostname, playerPage: msg.playerPage === true };
      }
      if (msg.kind === 'domain-age') {
        const domain = String(msg.domain || '').replace(/^www\./, '').toLowerCase();
        if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return null;
        if (!relaySamePageHost(domain)) return null;
        return { kind: 'domain-age', domain };
      }
      return null;
    };
    document.addEventListener('wo-background-message', (e) => {
      const d = (e && e.detail) || {};
      const id = String(d.id || '');
      if (d.token !== TOKEN || !id) return;
      const message = relayAllowedMessage(d.message);
      if (!message) return;
      if (!bridgeRateOk('background-relay-' + message.kind, 20, 60000)) {
        postToPage({
          source: 'wardenone-bg-response',
          token: TOKEN,
          id,
          result: { ok: false, error: 'Rate limited by WardenOne.' },
        });
        return;
      }
      chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError;
        postToPage({
          source: 'wardenone-bg-response',
          token: TOKEN,
          id,
          result: res || { ok: false, error: 'No WardenOne response' },
        });
      });
    }, true);
  } catch (_) {}

  // Cookie reload-loop escape. The bridge now BUILDS this notice rather than watching the page
  // for one, because the previous arrangement could not tell WardenOne's button from a copy of
  // it. The engine detects the loop -- it is the side that sees the navigations -- but it runs in
  // world MAIN, which is the page's own JS context, so anything it creates is indistinguishable
  // from something the page created. Only the isolated world can own a node the page cannot
  // reach, and only the owner of the node can safely act on a click on it.
  //
  // Honest about what this does and does not close: a page can still observe the token and ask
  // for the notice to be shown, because the token is not a secret. What it can no longer do is
  // control the words next to the button, or collect the click. The user sees WardenOne's own
  // text, saying cookies are blocked and that allowing them applies to this site -- and the
  // permission changes only on a trusted click on a node inside our closed shadow root.
  try {
    const cookieStopKey = () => '__wo_rlstop_' + String(location.hostname || '');
    let cookieOverlay = null;
    let cookieAllowInFlight = false;

    const showReloadLoopNotice = () => {
      if (cookieOverlay) { cookieOverlay.mount(); return; }
      cookieOverlay = woOwnedOverlay('rg-reload-loop');
      const root = cookieOverlay.root();
      if (!root) { cookieOverlay = null; return; }

      const panel = document.createElement('div');
      panel.setAttribute('style', 'all:initial!important;position:fixed!important;left:50%!important;'
        + 'bottom:24px!important;transform:translateX(-50%)!important;max-width:440px!important;'
        + 'width:calc(100vw - 32px)!important;box-sizing:border-box!important;'
        + 'background:rgba(250,243,253,.97)!important;backdrop-filter:blur(16px)!important;'
        + '-webkit-backdrop-filter:blur(16px)!important;border:1px solid rgba(176,106,212,.3)!important;'
        + 'border-radius:16px!important;padding:16px 18px!important;'
        + 'box-shadow:0 16px 48px rgba(80,30,110,.35)!important;'
        + 'font-family:Nunito,system-ui,sans-serif!important;');

      const title = document.createElement('div');
      title.setAttribute('style', 'all:initial!important;display:block!important;'
        + 'font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;'
        + 'font-size:14px!important;color:#2d1b40!important;margin:0 0 5px 0!important;');
      title.textContent = 'Stopped a reload loop';
      panel.appendChild(title);

      const body = document.createElement('div');
      body.setAttribute('style', 'all:initial!important;display:block!important;'
        + 'font-size:12.5px!important;color:#6a5685!important;line-height:1.5!important;'
        + 'margin:0 0 12px 0!important;font-family:Nunito,system-ui,sans-serif!important;');
      body.textContent = "This site keeps reloading because WardenOne is blocking its cookies and it can't"
        + ' start a session. Cookies are still blocked. You can allow cookies just for this site to'
        + ' use it normally.';
      panel.appendChild(body);

      const row = document.createElement('div');
      row.setAttribute('style', 'all:initial!important;display:flex!important;gap:8px!important;'
        + 'flex-wrap:wrap!important;');

      const allow = document.createElement('button');
      allow.setAttribute('style', 'all:initial!important;flex:none!important;cursor:pointer!important;'
        + 'background:linear-gradient(135deg,#b06ad4,#e07ab0)!important;color:#fff!important;'
        + 'border-radius:10px!important;padding:9px 15px!important;'
        + 'font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;'
        + 'font-size:12.5px!important;');
      allow.textContent = 'Allow cookies here';
      // Bound to this exact node, not to the document. There is no selector to match and no
      // element to forge: a page cannot obtain a reference to a node in a closed shadow root, so
      // it cannot dispatch on it either. owns() is belt and braces for the fallback path where
      // attachShadow was unavailable.
      allow.addEventListener('click', (e) => {
        if (cookieAllowInFlight || !e || e.isTrusted === false) return;
        if (!cookieOverlay || !cookieOverlay.owns(allow)) return;
        cookieAllowInFlight = true;
        try { allow.disabled = true; allow.textContent = 'Allowing...'; } catch (_) {}
        chrome.runtime.sendMessage({ kind: 'set-site-permission', url: location.href, key: 'cookies', setting: 'allow' }, (res) => {
          void chrome.runtime.lastError;
          if (chrome.runtime.lastError || !res || res.ok === false) {
            cookieAllowInFlight = false;
            try { allow.disabled = false; allow.textContent = 'Allow cookies here'; } catch (_) {}
            return;
          }
          try { sessionStorage.removeItem(cookieStopKey()); } catch (_) {}
          try { location.reload(); } catch (_) {}
        });
      });
      row.appendChild(allow);

      const dismiss = document.createElement('button');
      dismiss.setAttribute('style', 'all:initial!important;flex:none!important;cursor:pointer!important;'
        + 'border:1px solid rgba(176,106,212,.3)!important;background:rgba(176,106,212,.1)!important;'
        + 'color:#7a5f93!important;border-radius:10px!important;padding:9px 15px!important;'
        + 'font-family:Quicksand,system-ui,sans-serif!important;font-weight:700!important;'
        + 'font-size:12.5px!important;');
      dismiss.textContent = 'Keep blocked';
      // Dismiss stops the self-healing too, or the notice would reappear immediately.
      dismiss.addEventListener('click', (e) => {
        if (!e || e.isTrusted === false) return;
        const overlay = cookieOverlay;
        cookieOverlay = null;
        try { if (overlay) overlay.destroy(); } catch (_) {}
      });
      row.appendChild(dismiss);

      panel.appendChild(row);
      root.appendChild(panel);
      cookieOverlay.mount();
    };

    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data) return;
      if (e.data.source !== 'wardenone-reload-loop' || e.data.token !== TOKEN) return;
      showReloadLoopNotice();
    });
  } catch (_) {}

  // ---- Memory Shield: form-dirty + active-media tracking ----
  // So Memory Shield never sleeps a tab where the user has typed into a form (and
  // would lose their input on discard+reload), we watch for input on form fields
  // and answer a background query about whether this page has unsaved form data.
  // We ALSO track whether the page is actively using the camera/microphone, so a
  // video-call / recording tab is never slept out from under the user.
  let formDirty = false;
  let mediaActive = false;
  const markDirty = (e) => {
    try {
      const t = e && e.target;
      if (!t) return;
      const tag = (t.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
        const type = (t.type || '').toLowerCase();
        if (type === 'submit' || type === 'button' || type === 'hidden') return;
        if ((t.value && String(t.value).length > 0) || t.isContentEditable) formDirty = true;
      }
    } catch (_) {}
  };
  try {
    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);
  } catch (_) {}
  // Detect active camera/mic by wrapping getUserMedia in THIS (isolated) world.
  // Note: page scripts call getUserMedia in the MAIN world; to catch that too we
  // also listen for a signal Media Shield can post. As a robust fallback, we check
  // navigator.mediaDevices for active tracks periodically isn't possible, so we
  // rely on the wrap + the MAIN-world relay below.
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = function (...args) {
        return orig(...args).then((stream) => {
          mediaActive = true;
          try {
            stream.getTracks().forEach((tr) => tr.addEventListener('ended', () => {
              // if no live tracks remain, clear the flag
              setTimeout(() => {
                try {
                  // best-effort: we can't enumerate all streams, so just clear after a track ends
                  mediaActive = stream.getTracks().some((x) => x.readyState === 'live');
                } catch (_) { mediaActive = false; }
              }, 0);
            }));
          } catch (_) {}
          return stream;
        });
      };
    }
  } catch (_) {}
  // MAIN-world (content.js Media Shield) can tell us media went active/inactive.
  // Token-gated like every other page-message path here. Without it any page could
  // post {source:'wardenone-media', active:false} and clear this flag, and the flag
  // is answered back to Memory Shield in the memory-form-check reply -- so a page
  // holding a live camera or microphone could present itself as idle and become
  // eligible to be slept or discarded. As elsewhere in this file the token is not
  // treated as a true secret, since a page script can observe it; it keeps a page
  // from forging this state casually and matches how config, permission-chain and
  // the other relays already validate.
  try {
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data && e.data.source === 'wardenone-media'
        && e.data.token === TOKEN) {
        mediaActive = !!e.data.active;
      }
    });
  } catch (_) {}
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.kind === 'memory-form-check') { sendResponse({ formDirty, mediaActive }); return true; }
      if (msg && msg.kind === 'memory-throttle') {
        const host = String(location.hostname || '').replace(/^www\./, '').toLowerCase();
        if (host === 'twitch.tv' || host.endsWith('.twitch.tv')
          || host === 'youtube.com' || host.endsWith('.youtube.com')
          || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
          || host === 'youtu.be') {
          sendResponse({ ok: true, skipped: 'video-platform' });
          return true;
        }
        // Pause autoplaying audio/video in this (inactive) tab to cut CPU before a
        // possible later discard. We only pause media that is actually playing and
        // NOT user-initiated muted background players are left alone. Honest scope:
        // this reduces CPU from media; it cannot flush the tab's RAM cache.
        try {
          let paused = 0;
          document.querySelectorAll('video, audio').forEach((m) => {
            try { if (!m.paused && !m.ended) { m.pause(); paused++; } } catch (_) {}
          });
          sendResponse({ ok: true, paused });
        } catch (_) { sendResponse({ ok: false }); }
        return true;
      }
    });
  } catch (_) {}

  // ---- Script Drift Guard ----
  // Baselines third-party script hashes in the background and warns if the same
  // URL later serves different bytes with new suspicious behavior/hosts.
  try {
    if (window.top === window && /^https?:$/.test(location.protocol)) {
      let scriptDriftTimer = 0;
      let scriptDriftLastRun = 0;
      let scriptDriftWarnedKey = '';
      const cleanHost = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
      const regSite = (h) => {
        const parts = cleanHost(h).split('.').filter(Boolean);
        if (parts.length <= 2) return parts.join('.');
        const last2 = parts.slice(-2).join('.');
        return /^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/i.test(last2) ? parts.slice(-3).join('.') : last2;
      };
      const collectScriptUrls = () => {
        const pageSite = regSite(location.hostname);
        const seen = new Set();
        const out = [];
        try {
          const scripts = document.scripts || [];
          for (let i = 0; i < scripts.length && out.length < 20; i++) {
            const s = scripts[i];
            const src = s && s.src;
            if (!src) continue;
            let u;
            try { u = new URL(src, location.href); } catch (_) { continue; }
            if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
            if (u.protocol === 'http:' && location.protocol === 'https:') continue;
            const scriptSite = regSite(u.hostname);
            if (!scriptSite || scriptSite === pageSite) continue;
            u.hash = '';
            const href = u.href.slice(0, 900);
            if (seen.has(href)) continue;
            seen.add(href);
            out.push({ url: href });
          }
        } catch (_) {}
        return out;
      };
      const showScriptDriftWarning = (warning) => {
        if (!scriptDriftGuardOn() || bridgeSilentModeOn()) return;
        const w = warning && typeof warning === 'object' ? warning : {};
        const key = String(w.script || '') + ':' + String(w.newHash || '');
        if (key && key === scriptDriftWarnedKey) return;
        scriptDriftWarnedKey = key;
        try {
          /* Owned, not described: rendered into a closed shadow root, so the page this warns
             about cannot read it, reach into it, or delete it. Replacing an existing warning
             destroys the overlay WE built rather than searching the page for an element by id --
             the page could have planted that. */
          if (scriptDriftOverlay) { try { scriptDriftOverlay.destroy(); } catch (_) {} }
          scriptDriftOverlay = woOwnedOverlay('wo-script-drift');
          const root = scriptDriftOverlay.root();
          if (!root) return;
          const wrap = document.createElement('div');
          wrap.id = 'wo-script-drift';
          wrap.setAttribute('style', WO_MODAL.overlay('left'));
          const box = document.createElement('div');
          box.setAttribute('style', WO_MODAL.panel('700px'));
          const tag = document.createElement('div');
          const risk = String(w.risk || 'Medium');
          tag.setAttribute('style', WO_MODAL.tag(risk));
          tag.textContent = risk + ' script drift';
          const title = document.createElement('div');
          title.setAttribute('style', WO_MODAL.title);
          title.textContent = 'A third-party script changed unexpectedly';
          const body = document.createElement('div');
          body.setAttribute('style', WO_MODAL.body);
          const newBits = [];
          if (Array.isArray(w.newIndicators) && w.newIndicators.length) newBits.push('new behavior: ' + w.newIndicators.slice(0, 3).join(', '));
          if (Array.isArray(w.newHosts) && w.newHosts.length) newBits.push('new hosts: ' + w.newHosts.slice(0, 3).join(', '));
          body.textContent = 'WardenOne has seen this script URL before, but it now serves different code. ' + (newBits.length ? newBits.join('. ') + '. ' : '') + 'That can happen during normal deploys, but it is also how CDN/supply-chain compromises show up.';
          const meta = document.createElement('div');
          meta.setAttribute('style', WO_MODAL.meta);
          meta.textContent = 'Script: ' + String(w.script || w.scriptHost || 'third-party script').slice(0, 220) + ' | Hash ' + String(w.previousHash || '').slice(0, 8) + ' -> ' + String(w.newHash || '').slice(0, 8);
          const actions = document.createElement('div');
          actions.setAttribute('style', WO_MODAL.actions('flex-end'));
          const mkBtn = (label, primary) => {
            const btn = document.createElement('button');
            btn.setAttribute('style', WO_MODAL.button(primary, '12px'));
            btn.textContent = label;
            return btn;
          };
          const leave = mkBtn('Leave site', true);
          leave.addEventListener('click', (e) => {
            if (e && e.isTrusted === false) return;
            try { if (history.length > 1) history.back(); else location.href = 'about:blank'; } catch (_) { try { location.href = 'about:blank'; } catch (_) {} }
          });
          const dismiss = mkBtn('Dismiss', false);
          dismiss.addEventListener('click', (e) => { if (e && e.isTrusted === false) return; try { wrap.remove(); } catch (_) {} });
          actions.appendChild(leave);
          actions.appendChild(dismiss);
          box.appendChild(tag);
          box.appendChild(title);
          box.appendChild(body);
          box.appendChild(meta);
          box.appendChild(actions);
          wrap.appendChild(box);
          root.appendChild(wrap);
          /* Mounted only once the contents exist, so a half-built warning is never on screen. */
          if (scriptDriftOverlay) scriptDriftOverlay.mount();
        } catch (_) {}
      };
      const runScriptDriftScan = () => {
        if (!scriptDriftGuardOn()) return;
        const now = Date.now();
        if (now - scriptDriftLastRun < 15000) return;
        scriptDriftLastRun = now;
        const scripts = collectScriptUrls();
        if (!scripts.length) return;
        try {
          chrome.runtime.sendMessage({ kind: 'script-drift-scan', scripts }, (res) => {
            if (chrome.runtime.lastError || !res || !res.ok || !Array.isArray(res.warnings) || !res.warnings.length) return;
            showScriptDriftWarning(res.warnings[0]);
          });
        } catch (_) {}
      };
      const scheduleScriptDriftScan = (delay) => {
        if (scriptDriftTimer) clearTimeout(scriptDriftTimer);
        scriptDriftTimer = setTimeout(() => {
          scriptDriftTimer = 0;
          runScriptDriftScan();
        }, Number(delay) || 1200);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scheduleScriptDriftScan(1500), { once: true });
      else scheduleScriptDriftScan(1000);
      document.addEventListener('wo-bridge-config-ready', () => scheduleScriptDriftScan(300), { once: true });
      try {
        const driftUnwatch = domWatch((muts) => {
          if (!scriptDriftGuardOn()) return;
          for (const mut of muts || []) {
            const added = (mut && mut.addedNodes) || [];
            for (let i = 0; i < added.length; i++) {
              const n = added[i];
              if (n && n.nodeType === 1 && ((n.tagName || '').toUpperCase() === 'SCRIPT' || (n.querySelector && n.querySelector('script[src]')))) {
                scheduleScriptDriftScan(2500);
                return;
              }
            }
          }
        });
        setTimeout(driftUnwatch, 60000);
      } catch (_) {}
    }
  } catch (_) {}

  // ---- Permission Chain Guard ----
  // A site asking for one capability is often normal. A site asking for several
  // sensitive capabilities in one visit can be a scam chain, so MAIN-world API
  // hooks report coarse request events here and the background scores the combo.
  try {
    if (window.top === window && /^https?:$/.test(location.protocol)) {
      const PERM_KEYS = new Set([
        'notifications', 'camera', 'microphone', 'screen', 'clipboard-read',
        'clipboard-write', 'location', 'file-open', 'file-save', 'directory',
        'file-upload', 'automatic-downloads',
      ]);
      const PERM_ACTIONS = new Set(['request', 'granted', 'denied', 'selected', 'used', 'error']);
      let permChainShownAt = 0;
      let permChainShownKey = '';

      const cleanPermSignal = (raw) => {
        const d = raw && typeof raw === 'object' ? raw : {};
        const permission = String(d.permission || '').toLowerCase().replace(/_/g, '-').trim();
        if (!PERM_KEYS.has(permission)) return null;
        const action = String(d.action || 'request').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        return {
          permission,
          action: PERM_ACTIONS.has(action) ? action : 'request',
          result: String(d.result || '').slice(0, 40),
          userGesture: !!d.userGesture,
        };
      };

      const textList = (items, empty) => {
        const arr = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
        return arr.length ? arr.join(', ') : empty;
      };

      const showPermissionChainWarning = (verdict) => {
        if (!permissionChainGuardOn() || bridgeSilentModeOn()) return;
        const v = verdict && typeof verdict === 'object' ? verdict : {};
        const risk = String(v.risk || 'Medium');
        const key = risk + ':' + textList(v.permissions, '');
        const now = Date.now();
        if (key === permChainShownKey && now - permChainShownAt < 10 * 60 * 1000) return;
        permChainShownKey = key;
        permChainShownAt = now;
        try {
          /* Owned, not described: rendered into a closed shadow root, so the page this warns
             about cannot read it, reach into it, or delete it. Replacing an existing warning
             destroys the overlay WE built rather than searching the page for an element by id --
             the page could have planted that. */
          if (permChainOverlay) { try { permChainOverlay.destroy(); } catch (_) {} }
          permChainOverlay = woOwnedOverlay('wo-permission-chain');
          const root = permChainOverlay.root();
          if (!root) return;
          const wrap = document.createElement('div');
          wrap.id = 'wo-permission-chain';
          wrap.setAttribute('style', WO_MODAL.overlay('left'));
          const box = document.createElement('div');
          box.setAttribute('style', WO_MODAL.panel('680px'));
          const tag = document.createElement('div');
          tag.setAttribute('style', WO_MODAL.tag(risk));
          tag.textContent = risk + ' permission chain';
          const title = document.createElement('div');
          title.setAttribute('style', WO_MODAL.title);
          title.textContent = 'This site is asking for a lot of power';
          const body = document.createElement('div');
          body.setAttribute('style', WO_MODAL.body);
          body.textContent = 'WardenOne saw a chain of sensitive permission requests from this site: ' + textList(v.permissions, 'multiple permissions') + '. ' + (Array.isArray(v.reasons) && v.reasons.length ? v.reasons[0] + '. ' : '') + 'You may want to set unused permissions back to Ask or Block.';
          const allowed = document.createElement('div');
          allowed.setAttribute('style', WO_MODAL.meta);
          allowed.textContent = 'Currently allowed here: ' + textList(v.allowed, 'none detected by Chrome settings');
          const actions = document.createElement('div');
          actions.setAttribute('style', WO_MODAL.actions('flex-end'));
          const status = document.createElement('div');
          status.setAttribute('style', WO_MODAL.status);

          const mkBtn = (label, primary) => {
            const btn = document.createElement('button');
            btn.setAttribute('style', WO_MODAL.button(primary, '12px'));
            btn.textContent = label;
            return btn;
          };
          const reset = mkBtn('Reset site permissions', true);
          reset.addEventListener('click', (e) => {
            if (e && e.isTrusted === false) return;
            reset.disabled = true;
            status.textContent = 'Resetting permissions for this site...';
            try {
              chrome.runtime.sendMessage({ kind: 'reset-site-permissions', url: location.href }, (res) => {
                if (chrome.runtime.lastError || !res || !res.ok) {
                  status.textContent = 'Could not reset automatically. Open Chrome settings and set unused permissions to Ask or Block.';
                  reset.disabled = false;
                  return;
                }
                status.textContent = 'Reset supported permissions. Reload this site if it still behaves oddly.';
                reset.textContent = 'Reset done';
              });
            } catch (_) {
              status.textContent = 'Could not reset automatically.';
              reset.disabled = false;
            }
          });
          const settings = mkBtn('Open Chrome settings', false);
          settings.addEventListener('click', (e) => {
            if (e && e.isTrusted === false) return;
            try {
              chrome.runtime.sendMessage({ kind: 'open-site-settings', url: location.href }, () => { void chrome.runtime.lastError; });
              status.textContent = 'Chrome settings opened. Set unused permissions to Ask or Block.';
            } catch (_) {}
          });
          const dismiss = mkBtn('Dismiss', false);
          dismiss.addEventListener('click', (e) => { if (e && e.isTrusted === false) return; try { wrap.remove(); } catch (_) {} });
          actions.appendChild(reset);
          actions.appendChild(settings);
          actions.appendChild(dismiss);
          box.appendChild(tag);
          box.appendChild(title);
          box.appendChild(body);
          box.appendChild(allowed);
          box.appendChild(status);
          box.appendChild(actions);
          wrap.appendChild(box);
          root.appendChild(wrap);
          /* Mounted only once the contents exist, so a half-built warning is never on screen. */
          if (permChainOverlay) permChainOverlay.mount();
        } catch (_) {}
      };

      document.addEventListener('wo-permission-signal', (e) => {
        const d = (e && e.detail) || {};
        if (d.token !== TOKEN || !permissionChainGuardOn()) return;
        const signal = cleanPermSignal(d);
        if (!signal) return;
        if (!bridgeRateOk('permission-chain-' + signal.permission, 10, 60000)) return;
        try {
          chrome.runtime.sendMessage(Object.assign({ kind: 'permission-chain' }, signal), (res) => {
            if (chrome.runtime.lastError || !res || !res.ok || !res.warn) return;
            showPermissionChainWarning(res.verdict || {});
          });
        } catch (_) {}
      }, true);
    }
  } catch (_) {}

  // ---- Browser Abuse Guard: REMOVED (perf, weak machines) ----
  // The 1s main-thread-lag setInterval + longtask PerformanceObserver were
  // removed. They ran on every top-level page forever, could not stop a true
  // hard-freeze (the renderer locks before any extension code runs), only
  // produced a best-effort "leave?" nag on soft pulsing-freeze pages the user
  // can already close, and false-fired on heavy legit apps. Net win: one fewer
  // permanent per-tab CPU wakeup and observer.

  // ---- Login Page Age Check ----
  // A password field on a brand-new domain is a strong phishing signal. We detect the
  // password field here (the ISOLATED world has both the DOM and chrome.*), ask the
  // background for the domain's registration age (keyless RDAP, cached), and if the
  // domain is very new we warn BEFORE the user types a password. Top frame only, once.
  try {
    if (window.top === window && /^https?:$/.test(location.protocol)) {
      let laChecked = false, laShown = false;
      const laVisiblePassword = () => {
        const fields = document.querySelectorAll('input[type="password" i]');
        for (const f of fields) {
          try {
            if (f.disabled || f.readOnly) continue;
            const r = f.getBoundingClientRect ? f.getBoundingClientRect() : null;
            if ((r && r.width > 0 && r.height > 0) || f.offsetParent !== null) return true;
          } catch (_) {}
        }
        return false;
      };
      const laInterstitial = (verdict) => {
        if (laShown || !loginAgeGuardOn() || bridgeSilentModeOn()) return;
        laShown = true;
        try {
          if (loginAgeOverlay) return;
          if (!document.body && !document.documentElement) return;
          const reasons = Array.isArray(verdict && verdict.reasons) ? verdict.reasons : [];
          const domain = String((verdict && verdict.domain) || location.hostname || '');
          const ageDays = typeof (verdict && verdict.ageDays) === 'number' ? verdict.ageDays : null;
          const wrap = document.createElement('div');
          wrap.id = 'wo-login-age';
          wrap.setAttribute('style', WO_MODAL.overlay('center') + 'flex-direction:column!important;gap:12px!important;');
          const txt = document.createElement('div');
          txt.setAttribute('style', WO_MODAL.panel('620px', '12px') + 'text-align:center!important;font:700 15px/1.5 Nunito,system-ui,sans-serif!important;');
          const riskSummary = reasons.length ? ' Signals: ' + reasons.slice(0, 4).join('; ') + '.' : '';
          const ageText = typeof ageDays === 'number' ? (ageDays <= 1 ? ' registered today' : ' registered ' + ageDays + ' day(s) ago') : '';
          txt.textContent = 'Do not enter your password here. WardenOne found phishing-risk signals for ' + domain + (ageText ? ' (' + ageText.trim() + ')' : '') + '.' + riskSummary;
          const x = document.createElement('button');
          x.setAttribute('style', WO_MODAL.button(false, '12px'));
          x.textContent = 'Dismiss warning';
          x.addEventListener('click', (e) => { if (e && e.isTrusted === false) return; try { wrap.remove(); } catch (_) {} });
          const leave = document.createElement('button');
          leave.setAttribute('style', WO_MODAL.button(true, '12px'));
          leave.textContent = 'Leave site';
          leave.addEventListener('click', (e) => {
            if (e && e.isTrusted === false) return;
            try { if (history.length > 1) history.back(); else location.href = 'about:blank'; } catch (_) { try { location.href = 'about:blank'; } catch (_) {} }
          });
          wrap.appendChild(txt); wrap.appendChild(leave); wrap.appendChild(x);
          /* The highest-stakes warning WardenOne produces -- it says this site is probably
             phishing -- and the site it accuses could delete it with a single call. A closed
             shadow root puts it out of reach, and the mount re-places the host if the page
             removes it anyway. */
          loginAgeOverlay = woOwnedOverlay('wo-login-age');
          const laRoot = loginAgeOverlay.root();
          if (!laRoot) return;
          laRoot.appendChild(wrap);
          loginAgeOverlay.mount();
        } catch (_) {}
      };
      const laCheck = () => {
        if (laChecked || laShown || !loginAgeGuardOn() || !laVisiblePassword()) return;
        laChecked = true;
        try {
          chrome.runtime.sendMessage({ kind: 'login-domain-age', domain: location.hostname, url: location.href }, (res) => {
            if (chrome.runtime.lastError || !res || !res.ok) return;
            if (res.hardBlock || res.isNew) laInterstitial(res);
          });
        } catch (_) {}
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', laCheck, { once: true });
      else laCheck();
      document.addEventListener('wo-bridge-config-ready', laCheck, { once: true });
      try {
        let laP = false;
        // PERF (weak machines): a login form appears within the first seconds of
        // load, so once we've checked (or shown a warning) stop watching. Releasing
        // this subscription no longer stops the other guards -- the shared observer
        // stays connected while anyone else is still listening.
        const laUnwatch = domWatch(() => {
          if (laChecked || laShown) { laUnwatch(); return; }
          if (laP) return;
          laP = true;
          setTimeout(() => { laP = false; laCheck(); }, 600);
        });
        setTimeout(laUnwatch, 60000);
      } catch (_) {}
    }
  } catch (_) {}
  try { window.__wardenOneBridgeReadyVersion = BRIDGE_VERSION; } catch (_) {}
})();

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
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

  const BRIDGE_VERSION = '1.0.1';
  if (window.__wardenOneBridgeVersion === BRIDGE_VERSION) {
    /* Same version: this document already has a current bridge. Let it re-run its replay,
       then stop -- unconditionally. The return used to sit INSIDE the typeof check, so a
       bridge whose replay had not been assigned yet (it is set 840 lines below this point, so
       anything throwing in between left the flag set and the replay missing), or whose replay
       a page had overwritten with a non-function, fell through and installed a SECOND complete
       bridge over the first: another 36 listeners, another observer, another runtime listener.
       A page could force that on demand with window.__wardenOneBridgeReplay = 1. */
    try {
      if (typeof window.__wardenOneBridgeReplay === 'function') window.__wardenOneBridgeReplay();
    } catch (_) {}
    return;
  }
  if (window.__wardenOneBridgeVersion) {
    /* A different version means this document holds an older bridge -- after an extension
       update, or after Repair marked it stale so it could re-arm the tab. Release what that
       copy holds before installing over it, or both stay live and both are charged for every
       event the page produces. */
    try {
      if (typeof window.__wardenOneBridgeDispose === 'function') window.__wardenOneBridgeDispose();
    } catch (_) {}
  }
  window.__wardenOneBridgeVersion = BRIDGE_VERSION;

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
  // Chrome's extension events are not DOM events: they are not covered by the abort signal above
  // and they have no equivalent of removeEventListener-by-signal. Repair reinstalls bridge.js in
  // every frame, so a listener registered here and never removed accumulates one more copy per
  // Repair -- and every copy answers, so old and new bridges race on form and media health.
  //
  // The exact callback reference has to be kept, because removeListener matches by identity.
  const woChromeListeners = [];
  const woOnMessage = (fn) => {
    try {
      chrome.runtime.onMessage.addListener(fn);
      woChromeListeners.push([chrome.runtime.onMessage, fn]);
    } catch (_) {}
    return fn;
  };

  /* Overlays this copy currently has on screen. Bridge-only, like the Chrome listeners above, so
     it lives outside the registry core the other nine guards share.
     destroy() is the only thing that releases the keyboard trap, hands focus back, stops the
     self-healing watcher and removes the host -- and dispose has to be able to reach them. Every
     button inside a warning is registered through woOn, so it rides the abort signal; the trap is
     a raw listener on the host and does not. A bridge replaced while a warning is up therefore
     used to abort every button and leave the dialog on the page with nothing able to close it.
     That is not a rare path: Repair deliberately stamps this file's version flag stale and
     re-injects (background.js REPAIR_COMPONENTS), and people press Repair precisely when something
     looks wrong -- which is when a warning is most likely to be showing. */
  const woOverlays = new Set();

  window.__wardenOneBridgeDispose = () => {
    /* Before anything is torn down, while focus restoration can still land somewhere real.
       Each destroy() deregisters itself, so the set is drained rather than iterated in place. */
    const overlays = Array.from(woOverlays);
    woOverlays.clear();
    for (const overlay of overlays) {
      try { overlay.destroy(); } catch (_) {}
    }
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
    const chromeHeld = woChromeListeners.splice(0, woChromeListeners.length);
    for (const [event, fn] of chromeHeld) {
      try { event.removeListener(fn); } catch (_) {}
    }
  };

  // A per-page-load routing token. It keeps accidental/cross-extension messages
  // out, but the MAIN-world page can observe window messages, so background-side
  // handlers still treat token-bearing page events as forgeable and constrain the
  // dangerous paths with sender checks, rate limits, and sanitized inputs.
  // A ROUTING NONCE, not a secret (M27).
  //
  // This value is broadcast into the page with postMessage so the MAIN-world scripts can tag their
  // traffic back. The page shares that world, so any script listening early enough holds it as
  // well. It exists to tell WardenOne's messages apart from every other postMessage on a busy
  // page, and to stop stale traffic from a previous bridge being answered -- nothing more.
  //
  // Checking `d.token === TOKEN` therefore proves the message is addressed to this bridge. It does
  // NOT prove who sent it. Anything arriving over a page-visible channel must be treated as a
  // claim, and must not be sufficient on its own to change trusted state: the permission-chain
  // path now requires corroboration the worker gathered itself before it will warn or write
  // history. Add a new inbound signal here and the same rule applies to it.
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
        woOn(document, 'DOMContentLoaded', () => {
          domWatchPending = false;
          domWatchStart();
        }, { once: true });
      } catch (_) { domWatchPending = false; }
      return;
    }
    try {
      domObserver = woObserver((records) => {
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

  // The focus ring, painted inline rather than declared in a stylesheet.
  //
  // The warnings reset their buttons with `all:initial!important` in the style attribute to strip
  // page CSS, and that takes the focus ring with it, so a keyboard user cannot see which action is
  // selected. The obvious repair -- a `:focus-visible` rule in the overlay's own stylesheet -- does
  // not work, and it is not a specificity problem to out-specify: an important declaration in a
  // style attribute beats an important rule from any stylesheet, shadow root included. Measured in
  // Chromium, every button still computed to `outline-style:none`, so the ring the code claimed to
  // restore never drew.
  //
  // Setting the property inline puts it in the same declaration block as the reset, where the later
  // declaration wins. An outline in `currentColor` is what forced-colors mode honours; a coloured
  // box-shadow is discarded there.
  //
  // `scope` must be the node the focus events reach WITHOUT being retargeted -- the shadow root for
  // an owned overlay, the host itself only in the light-DOM fallback. Bound on the host instead,
  // every focusin from inside a closed shadow root arrives reporting the host as its target, so the
  // ring would follow nothing and land on nothing. Measured: Tab moved between buttons and no ring
  // was drawn at all.
  function woFocusRing(scope) {
    let painted = null;
    const drop = () => {
      if (!painted) return;
      try {
        painted.style.removeProperty('outline');
        painted.style.removeProperty('outline-offset');
      } catch (_) {}
      painted = null;
    };
    const paint = (el) => {
      drop();
      if (!el || !el.style) return;
      try {
        el.style.setProperty('outline', '3px solid currentColor', 'important');
        el.style.setProperty('outline-offset', '2px', 'important');
        painted = el;
      } catch (_) {}
    };
    // :focus-visible is the browser's own answer to "did a keyboard put focus here?", so ask it
    // rather than reimplementing the heuristic. A mouse click should not leave a ring behind.
    const onIn = (e) => {
      const target = e && e.target;
      let visible = true;
      try { visible = !target.matches || target.matches(':focus-visible'); } catch (_) {}
      if (visible) paint(target);
      else drop();
    };
    const onOut = () => drop();
    try {
      scope.addEventListener('focusin', onIn, true);
      scope.addEventListener('focusout', onOut, true);
    } catch (_) {}
    return {
      paint,
      release() {
        drop();
        try {
          scope.removeEventListener('focusin', onIn, true);
          scope.removeEventListener('focusout', onOut, true);
        } catch (_) {}
      },
    };
  }

  function woOwnedOverlay(id) {
    let host = null;
    let shadow = null;
    let unwatch = null;
    let gone = false;
    let restoreFocusTo = null;
    let trapHandler = null;
    let focusRing = null;

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

    const api = {
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
      // Make this overlay behave as the modal it already looks like (M20).
      //
      // Called after the contents exist, because the accessible name has to point at a heading that
      // is already there. The W3C pattern is explicit that aria-modal must not be set on something
      // that does not actually behave modally, so the semantics and the keyboard containment are
      // applied together here rather than separately.
      dialog(opts) {
        const o = opts || {};
        if (!shadow || !host) return false;
        try {
          const box = document.createElement('div');
          box.setAttribute('role', 'alertdialog');
          box.setAttribute('aria-modal', 'true');
          if (o.label) box.setAttribute('aria-label', String(o.label));
          if (o.description) box.setAttribute('aria-description', String(o.description));
          box.setAttribute('style', 'all:initial!important;display:block!important;');
          // Re-parent what the caller already rendered, so callers keep building their own markup
          // and gain the semantics without knowing about them.
          while (shadow.firstChild) box.appendChild(shadow.firstChild);
          shadow.appendChild(box);
          // The shadow root, not the host: focus events are retargeted as they leave a closed
          // shadow tree, so a listener on the host only ever sees the host.
          focusRing = woFocusRing(shadow);

          const focusables = () => {
            try {
              return Array.prototype.slice.call(box.querySelectorAll(
                'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
              )).filter((n) => n.offsetParent !== null || n === box);
            } catch (_) { return []; }
          };

          // Remember where focus was so it can be handed back. A warning that steals focus and
          // never returns it leaves a keyboard user stranded on a page they were reading.
          try { restoreFocusTo = document.activeElement; } catch (_) { restoreFocusTo = null; }

          // Focus the safest action if the caller named one, otherwise the container. Never the
          // destructive action -- a warning that opens with "continue anyway" focused is a warning
          // that can be dismissed by a reflexive Enter.
          try {
            host.setAttribute('tabindex', '-1');
            const first = (o.focus && box.querySelector(o.focus)) || focusables()[0] || box;
            if (first && first.focus) first.focus();
            // The dialog took focus without being asked to, so show where it went. From here on the
            // ring follows :focus-visible, which is what keeps a mouse click from leaving one.
            if (first && first !== box) focusRing.paint(first);
          } catch (_) {}

          // Contain Tab inside the dialog. Bound on the host, not the document, and removed in
          // destroy() below -- a trap that outlives its dialog breaks the page it was warning about.
          trapHandler = (e) => {
            if (gone || !e || e.key !== 'Tab') return;
            const list = focusables();
            if (!list.length) { e.preventDefault(); return; }
            const firstEl = list[0];
            const lastEl = list[list.length - 1];
            let active = null;
            try { active = shadow.activeElement || null; } catch (_) {}
            if (e.shiftKey && (active === firstEl || !active)) {
              e.preventDefault();
              try { lastEl.focus(); } catch (_) {}
            } else if (!e.shiftKey && active === lastEl) {
              e.preventDefault();
              try { firstEl.focus(); } catch (_) {}
            }
          };
          host.addEventListener('keydown', trapHandler, true);
          return true;
        } catch (_) {
          return false;
        }
      },
      destroy() {
        // Idempotent, and always deregisters: dispose drains the set and a caller may destroy
        // the same overlay first, so neither may depend on being the one that got there.
        woOverlays.delete(api);
        gone = true;
        if (unwatch) { try { unwatch(); } catch (_) {} unwatch = null; }
        // Before the host goes: release the keyboard and hand focus back. Both must happen on
        // every close path, which is why they live here rather than in each caller's dismiss
        // handler -- there are more close paths than dismiss buttons.
        if (trapHandler && host) {
          try { host.removeEventListener('keydown', trapHandler, true); } catch (_) {}
        }
        trapHandler = null;
        if (focusRing) { try { focusRing.release(); } catch (_) {} focusRing = null; }
        try { if (host) host.remove(); } catch (_) {}
        if (restoreFocusTo && restoreFocusTo.focus && restoreFocusTo.isConnected) {
          try { restoreFocusTo.focus(); } catch (_) {}
        }
        restoreFocusTo = null;
        host = null;
        shadow = null;
      },
      // Only for our own bookkeeping; conveys no trust.
      hostNode() { return host; },
    };
    woOverlays.add(api);
    return api;
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
  // The deadlock (H13). Every signal smartPlayerStrongEvidence() looks for -- a player root, a
  // <video>, a library script tag -- is built by the page's own JavaScript, which is precisely what
  // Smart Script Shield just blocked. On a site that constructs its player entirely in script none
  // of them ever appears, so the evidence test never passes, the recovery never runs, and the player
  // area stays empty with nothing naming the cause.
  //
  // Reporting the *absence* breaks the circle. This is deliberately not evidence of a player, and
  // background does not treat it as any: it acts only where it has independently observed a blocked
  // script in this frame, which comes from webRequest and no page can manufacture. A page may put
  // itself on a watch route and render nothing -- that earns it a look, not an allowance. And
  // recovery still refuses hosts known for tracking or fingerprinting, so tripping this on purpose
  // cannot un-block anything a page would want un-blocked.
  //
  // What makes it a deadlock report rather than an impatience report is elapsed time, and it must
  // be time rather than a scan count. smartPlayerScanCount only climbs when domWatch fires, and
  // domWatch fires on DOM mutations -- which are produced by the very scripts that were blocked. A
  // scan-count threshold would therefore never be reached on precisely the pages this exists for:
  // the same circular dependency H13 describes, one level up. A timer does not ask the page's
  // permission to advance.
  const SMART_PLAYER_DEADLOCK_MS = 4000;
  let smartPlayerDeadlockDue = false;
  function smartPlayerDeadlock() {
    if (!smartPlayerDeadlockDue) return '';
    // A watch-shaped route, or a subframe, which is a player context in its own right.
    if (smartPlayerRoute() || window.top !== window) return 'route-blocked';
    // An ordinary top-level page that painted nothing is the OTHER shape this happens in, and it
    // used to get no recovery at all -- the scoping here said such a page "gains nothing", which
    // was true when the only thing recovery could rescue was a player. A site whose own
    // application code sits on a separate registrable domain has it refused as third-party and
    // then never paints, which is H13, M35, and a black page reported from live use.
    //
    // It earns a look, not an allowance. Nothing here decides anything: background acts only where
    // webRequest independently observed a blocked third-party script in this exact frame, which no
    // page can manufacture, and recovery still refuses hosts known for tracking or fingerprinting.
    // Blankness alone, on a page that blocked nothing, does nothing at all.
    return smartPageIsBlank() ? 'page-blocked' : '';
  }
  function sendSmartPlayerContext(force) {
    const now = Date.now();
    const evidence = smartPlayerStrongEvidence() || smartPlayerDeadlock();
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
      smartPlayerHeartbeat = woInterval(() => {
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
    smartPlayerScanTimer = woTimeout(() => {
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
    // The deadlock check has to drive itself. On the pages it exists for nothing else will call
    // sendSmartPlayerContext again -- there are no mutations to schedule a scan, because the
    // scripts that would cause them were blocked.
    smartPlayerDeadlockDue = false;
    woTimeout(() => {
      if (generation !== smartPlayerObserverGeneration) return;
      if (smartPlayerEvidence) return;
      smartPlayerDeadlockDue = true;
      sendSmartPlayerContext(true);
    }, SMART_PLAYER_DEADLOCK_MS);
    woTimeout(() => {
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
    // Not { once: true }: a page restored from the back/forward cache fires pagehide AGAIN, and a
    // one-shot listener has already been spent by then -- so a heartbeat started after the restore
    // ran until the tab closed. stopSmartPlayerHeartbeat is idempotent, so firing it more than once
    // costs nothing.
    woOn(window, 'pagehide', stopSmartPlayerHeartbeat);
    armSmartPlayerObservation();
    woOn(document, 'DOMContentLoaded', () => scheduleSmartPlayerScan(0), { once: true });
    woOn(window, 'load', () => scheduleSmartPlayerScan(0), { once: true });
    woOn(window, 'popstate', () => armSmartPlayerObservation());
    woOn(window, 'hashchange', () => armSmartPlayerObservation());
    woOn(document, 'pointerdown', noteSmartPlayerIntent, true);
    woOn(document, 'click', noteSmartPlayerIntent, true);
    woOn(document, 'keydown', noteSmartPlayerIntent, true);
    woOn(document, 'click', (event) => {
      if (!event || event.isTrusted === false) return;
      const target = event.target && event.target.closest
        ? event.target.closest('a[href],button,[role="button"],[data-episode]')
        : null;
      if (!target) return;
      const href = target.href || '';
      const label = String(target.textContent || target.getAttribute('aria-label') || target.getAttribute('data-episode') || '').slice(0, 160);
      if (!smartPlayerRoute(href) && !/(?:watch|episode|stream|play|server)/i.test(label)) return;
      woTimeout(() => armSmartPlayerObservation(), 0);
    }, true);
    [30000, 90000, 180000].forEach((delay) => {
      woTimeout(() => {
        if (!smartPlayerEvidence && smartPlayerRoute()) armSmartPlayerObservation();
      }, delay);
    });
  } catch (_) {}

  // M36. When Smart Script Shield is the reason a page is broken, say so.
  //
  // Refusing third-party scripts is what the shield is for, and on nearly every page it is right
  // and invisible. When it is wrong the page simply fails -- a black player, a splash screen that
  // never advances -- and the only route out is to already suspect the extension, find the Script
  // Shield panel and trust the site by hand. Three separate findings had that shape and each was
  // diagnosed only because someone happened to test with the extension off.
  //
  // Two conditions, evaluated where each is knowable: the page decides whether it looks broken,
  // background decides whether we refused anything on this navigation. Neither alone is worth
  // showing -- a refusal happens on almost every page, and a slow page is not our doing.
  let smartScriptNoticeOverlay = null;
  let smartScriptNoticeShown = false;
  let smartScriptNoticeAsked = false;

  function smartScriptNoticeAllowed() {
    return bridgeConfigReady
      && bridgeConfig.enabled !== false
      && !bridgeSilentModeOn()
      && !bridgeHostAllowedByUser()
      && window.top === window;
  }

  // Why the page looks broken, or '' if it does not.
  //
  // These three are the shapes the known reports actually had, and they are deliberately narrow.
  // A detector broad enough to catch "one widget on an otherwise working page did not render"
  // would fire on working pages, and a notice that cries wolf is worse than the silence it
  // replaces -- people learn to dismiss it and then it is there for nothing.
  // "This page painted nothing." One definition, two callers with different patience: the recovery
  // signal above asks at four seconds and needs only this, while the notice below waits until the
  // page has had every chance and also counts a page that never finished loading. Two separate
  // notions of blank would drift into disagreeing about the same page.
  function smartPageIsBlank() {
    try {
      if (document.prerendering) return false;
      // A canvas or a video IS the content on plenty of pages, and neither carries text.
      if (document.querySelector('video,canvas')) return false;
      const text = String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
      return text.length <= 200;
    } catch (_) {
      return false;
    }
  }

  function smartScriptPageStalled() {
    try {
      if (document.prerendering) return '';
      if (document.readyState !== 'complete') return 'the page never finished loading';
      // A watch or embed route that painted no player: loaded, but the one thing it exists to
      // show is missing.
      if (smartPlayerRoute() && !document.querySelector('video')) return 'the player never appeared';
      return smartPageIsBlank() ? 'nothing rendered' : '';
    } catch (_) {
      return '';
    }
  }

  function showSmartScriptNotice(info, reason) {
    if (smartScriptNoticeShown) return;
    smartScriptNoticeShown = true;
    let ring = null;
    try {
      /* Owned, not described. A page that has just had its scripts refused is not a trustworthy
         host for the explanation, and the button below changes a setting -- so it lives in a
         closed shadow root the page cannot read, reach into or dispatch on. */
      if (smartScriptNoticeOverlay) { try { smartScriptNoticeOverlay.destroy(); } catch (_) {} }
      smartScriptNoticeOverlay = woOwnedOverlay('wo-script-shield-notice');
      const root = smartScriptNoticeOverlay.root();
      if (!root) return;
      const panel = document.createElement('div');
      /* A status region, not a dialog. It does not cover the page and does not demand an answer,
         so it announces politely and never takes focus (M20). */
      panel.setAttribute('role', 'status');
      panel.setAttribute('style', 'all:initial!important;position:fixed!important;left:16px!important;'
        + 'bottom:16px!important;box-sizing:border-box!important;display:flex!important;'
        + 'flex-direction:column!important;gap:9px!important;max-width:380px!important;'
        + 'width:calc(100vw - 32px)!important;border:1px solid rgba(176,106,212,.34)!important;'
        + 'border-left:4px solid #9d54c9!important;border-radius:14px!important;'
        + 'background:linear-gradient(135deg,#faf2fe,#f4e9fb)!important;color:#3d2a52!important;'
        + 'padding:16px!important;box-shadow:0 18px 60px rgba(120,55,160,.3)!important;'
        + 'font-family:Nunito,system-ui,sans-serif!important;');
      const title = document.createElement('div');
      title.setAttribute('style', WO_MODAL.title);
      title.textContent = 'This page may be broken by WardenOne';
      const body = document.createElement('div');
      body.setAttribute('style', WO_MODAL.body);
      const count = Number(info && info.refused) || 0;
      body.textContent = 'Smart Script Shield blocked ' + count + ' third-party '
        + (count === 1 ? 'script' : 'scripts') + ' here, and ' + reason
        + '. That is usually right. If this site needs them, you can allow them and reload.';
      const meta = document.createElement('div');
      meta.setAttribute('style', WO_MODAL.meta);
      const hosts = Array.isArray(info && info.hosts) ? info.hosts.slice(0, 3) : [];
      meta.textContent = 'Blocked: ' + (hosts.length ? hosts.join(', ') : 'third-party scripts')
        + (count > hosts.length ? ' and ' + (count - hosts.length) + ' more' : '');
      const actions = document.createElement('div');
      actions.setAttribute('style', WO_MODAL.actions('flex-start'));
      const mkBtn = (label, primary) => {
        const btn = document.createElement('button');
        btn.setAttribute('style', WO_MODAL.button(primary, '12px'));
        btn.textContent = label;
        return btn;
      };
      const trust = mkBtn('Allow scripts here', true);
      let trustInFlight = false;
      /* Bound to this exact node. There is no selector to match and no element to forge: a page
         cannot obtain a reference to a node in a closed shadow root, so it cannot dispatch on it
         either. Background refuses the change unless it genuinely refused a script on this tab's
         current navigation, and reads the host from the sender rather than the message. */
      woOn(trust, 'click', (e) => {
        if (trustInFlight || !e || e.isTrusted === false) return;
        if (!smartScriptNoticeOverlay || !smartScriptNoticeOverlay.owns(trust)) return;
        trustInFlight = true;
        try { trust.disabled = true; trust.textContent = 'Allowing...'; } catch (_) {}
        try {
          chrome.runtime.sendMessage({ kind: 'smart-script-trust-site' }, (res) => {
            void chrome.runtime.lastError;
            if (chrome.runtime.lastError || !res || res.ok === false) {
              trustInFlight = false;
              try { trust.disabled = false; trust.textContent = 'Allow scripts here'; } catch (_) {}
              return;
            }
            try { location.reload(); } catch (_) {}
          });
        } catch (_) {
          trustInFlight = false;
        }
      });
      const dismiss = mkBtn('Dismiss', false);
      woOn(dismiss, 'click', (e) => {
        if (e && e.isTrusted === false) return;
        if (ring) { try { ring.release(); } catch (_) {} ring = null; }
        try { smartScriptNoticeOverlay.destroy(); } catch (_) {}
        smartScriptNoticeOverlay = null;
      });
      actions.appendChild(trust);
      actions.appendChild(dismiss);
      panel.appendChild(title);
      panel.appendChild(body);
      panel.appendChild(meta);
      panel.appendChild(actions);
      root.appendChild(panel);
      smartScriptNoticeOverlay.mount();
      /* No dialog() and no focus trap -- but the buttons still need a visible ring, and
         all:initial strips the one the browser would have drawn. Bound on the shadow root, where
         the focus events still name the button they came from. */
      ring = woFocusRing(root);
    } catch (_) {}
  }

  function checkSmartScriptNotice() {
    if (smartScriptNoticeAsked || smartScriptNoticeShown) return;
    if (!smartScriptNoticeAllowed()) return;
    const reason = smartScriptPageStalled();
    if (!reason) return;
    // Asked at most once per navigation, and only from here -- the page having already failed its
    // own check is what earns the question.
    smartScriptNoticeAsked = true;
    if (!bridgeRateOk('smart-script-status', 2, 60000)) return;
    try {
      chrome.runtime.sendMessage({ kind: 'smart-script-status' }, (res) => {
        void chrome.runtime.lastError;
        if (chrome.runtime.lastError || !res || !res.ok || !Number(res.refused)) return;
        showSmartScriptNotice(res, reason);
      });
    } catch (_) {}
  }

  try {
    // Two chances, both bounded. Five seconds after load is late enough that a merely slow page
    // has settled; the twenty-second timer is for the pages where load never fires at all, which
    // is one of the failure shapes this exists to catch.
    woOn(window, 'load', () => woTimeout(checkSmartScriptNotice, 5000), { once: true });
    woTimeout(checkSmartScriptNotice, 20000);
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

  // A host is allowlisted if it is on the permanent list, or if it holds a
  // temporary pass that has not lapsed yet. Expired entries simply stop counting;
  // pruning them from storage is the popup's job, not something to do on a hot
  // path in every frame.
  function bridgeActiveAllowlist(config) {
    const base = Array.isArray(config && config.allowlist) ? config.allowlist.slice(0, 1000) : [];
    const until = config && config.allowlistUntil;
    if (!until || typeof until !== 'object') return base;
    const now = Date.now();
    let added = 0;
    for (const host of Object.keys(until)) {
      if (added >= 200) break;
      const at = Number(until[host]);
      if (Number.isFinite(at) && at > now) { base.push(host); added++; }
    }
    return base;
  }

  // Which individual protections the user switched off for the page we are on.
  // Only ever turns something OFF: a site cannot enable a protection the user
  // disabled globally, so a stored true is ignored.
  function bridgeSiteOverridesFor(config, host) {
    const out = {};
    try {
      const rules = config && config.siteOverrides;
      if (!rules || typeof rules !== 'object') return out;
      const h = bridgeCleanHost(host);
      if (!h) return out;
      for (const pattern of Object.keys(rules)) {
        const d = bridgeCleanHost(pattern);
        if (!d || !(h === d || h.endsWith('.' + d))) continue;
        const entry = rules[pattern];
        if (!entry || typeof entry !== 'object') continue;
        for (const key of Object.keys(entry)) {
          if (entry[key] === false && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) out[key] = false;
        }
      }
    } catch (_) {}
    return out;
  }

  function bridgeHostAllowedByUser() {
    return bridgeHostMatchesList(location.hostname, bridgeActiveAllowlist(bridgeConfig));
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
    woOn(document, 'click', (e) => {
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
    woOn(document, 'submit', (e) => {
      if (!markTrustedSafeBrowsingEvent(e)) return;
      rememberSafeBrowsingIntent(location.href);
      rememberSafeBrowsingIntent(safeBrowsingFormAction(e.target));
    }, true);
    woOn(document, 'paste', (e) => {
      if (!markTrustedSafeBrowsingEvent(e)) return;
      rememberSafeBrowsingIntent(location.href);
      const target = e.target;
      const form = target && target.closest ? target.closest('form') : null;
      if (form) rememberSafeBrowsingIntent(safeBrowsingFormAction(form));
    }, true);
    woOn(document, 'input', (e) => {
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
    // Everything downstream reads clean.allowlist and never learns that a pass
    // was temporary, which is the point: one resolution, no second opinion.
    clean.allowlist = sanitizeBridgeHostList(bridgeActiveAllowlist(clean), 1000);
    delete clean.allowlistUntil;
    // Per-site switches are applied here rather than shipped as data, so no
    // downstream script has to remember to consult them.
    const siteOff = bridgeSiteOverridesFor(clean, location.hostname);
    for (const key of Object.keys(siteOff)) {
      if (typeof clean[key] === 'boolean') clean[key] = false;
    }
    clean.siteOverridesApplied = Object.keys(siteOff).filter((k) => typeof clean[k] === 'boolean');
    delete clean.siteOverrides;
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
  const bridgeReplay = () => {
    postToPage({ source: 'wardenone-handshake', token: TOKEN });
    if (bridgeConfigReady) sendConfig(bridgeConfig);
  };
  try {
    window.__wardenOneBridgeReplay = bridgeReplay;
  } catch (_) {}

  // The same replay, reachable from the MAIN world.
  //
  // `window` is not shared: this file runs in ISOLATED, so the global above is on a window the
  // main world can never see. cryptominer-detect.js runs in MAIN and asked for a replay through
  // it, which meant its `typeof ... === 'function'` test was false every single time and the
  // request silently did nothing -- so a detector injected after the one-time handshake never got
  // a token, rejected the config that followed, and sat on confirmed detections forever.
  //
  // `document` IS shared, and is already how the main world talks to this one. A page can dispatch
  // this too, and gains nothing by it: a replay re-sends the same handshake and the same sanitized
  // config the page has already been posted. It is rate-limited so it cannot be used to spam.
  woOn(document, 'wo-bridge-replay', () => {
    if (!bridgeRateOk('wo-bridge-replay', 8, 60000)) return;
    try { bridgeReplay(); } catch (_) {}
  });

  // 1. Listen for the custom events the main-world trap dispatches on document,
  //    and forward block/detection counts to the background for the toolbar badge.
  /* ---- engine watchdog -------------------------------------------------------------
     The MAIN-world engine shares its world with the page, so a page can call its dispose
     and switch it off. That is a known limit of MAIN-world injection and cannot be
     prevented from inside that world -- the page owns it. The engine already answers it
     halfway: disposing clears its own ready markers, so the tab stops claiming to be
     protected and a fresh injection can take hold. The comment there says the point is
     that "the bypass has to be repeated rather than done once and left".
     It was not, though, because nothing ever re-injected. One call at document_start
     switched the engine off for the life of the page and no one found out.
     This half closes that. It runs in the ISOLATED world, which the page cannot reach or
     read, so a page can silence the engine but cannot silence the thing that notices. If
     the engine never announced itself, or announced itself and then went quiet, the worker
     is asked to look and put it back.
     A page can still spoof the marker to look installed. That is a much higher bar than
     one call, and it is the honest limit of what this can do. */
  let bridgeEngineSeen = false;
  let bridgeEngineChecks = 0;
  const bridgeCheckEngine = (why) => {
    if (bridgeEngineChecks++ > 4) return;   // never a loop, whatever the page does
    try {
      chrome.runtime.sendMessage({ kind: 'wo-engine-check', why: String(why || '').slice(0, 40) },
        () => { void chrome.runtime.lastError; });
    } catch (_) { /* worker asleep; the next trigger will try again */ }
  };
  try {
    if (window.top === window && /^https?:$/.test(location.protocol)) {
      /* Long enough that a slow page has finished installing, short enough to matter. */
      woTimeout(() => { if (!bridgeEngineSeen) bridgeCheckEngine('never-announced'); }, 6000);
      /* Coming back to a tab is a free moment to re-check, and it is when a page that
         switched the engine off after load would otherwise keep the benefit. */
      woOn(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible' && !bridgeEngineSeen) bridgeCheckEngine('still-absent');
      });
    }
  } catch (_) {}

  woOn(document, 'wo-event', (e) => {
    const d = (e && e.detail) || {};
    // Route only token-bearing events. The token is not treated as a true secret;
    // background learning and privileged actions are separately constrained.
    if (d.token !== TOKEN) return;
    const type = d.type || '';
    if (type === 'installed') bridgeEngineSeen = true;
    const securitySignal = type === 'behavioral_risk'
      || /^warned_(?:potential_)?xss_|^warned_potential_(?:dom_xss|xss_)|^warned_clickfix_|^warned_command_paste$/.test(type);
    if (/^blocked_|^detected_|^gated_|^warned_/.test(type) || type === 'behavioral_risk') {
      if (!bridgeRateOk(securitySignal ? 'wo-security-event' : 'wo-event', securitySignal ? 12 : 240, 60000)) return;
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

  // Navigation attribution signals. Deliberately NOT routed through the wo-event
  // path above: they are not findings, must never reach the history or the badge,
  // and are far too frequent for the security-event budget.
  woOn(document, 'wo-nav-signal', (e) => {
    const d = (e && e.detail) || {};
    if (d.token !== TOKEN) return;
    const kind = d.kind === 'player-gesture' || d.kind === 'top-nav-authorized' || d.kind === 'gesture'
      ? d.kind : '';
    if (!kind) return;
    if (!bridgeRateOk('wo-nav-signal', 180, 60000)) return;
    try {
      chrome.runtime.sendMessage({ kind: 'wo-nav-signal', signal: kind }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
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
    woOnMessage((msg, _sender, sendResponse) => {
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
        woTimeout(() => { try { location.reload(); } catch (_) {} }, 0);
        return true;
      }
    });
  } catch (_) {}

  // Safe Browsing relay: MAIN-world guards ask for a URL reputation verdict, but
  // only the background worker can read the saved API key. Results are posted
  // back with the same per-load token used by config messages.
  try {
    const SAFE_BROWSING_CONTEXTS = new Set(['link', 'paste', 'form']);
    woOn(document, 'wo-safe-browsing-check', (e) => {
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
      /* Silencing one kind of notice. The page can only name a warning TYPE and
         a duration -- never a host, never a setting -- so the worst a hostile
         page can do with this channel is quieten a card about itself, which it
         could already achieve by not triggering one. */
      /* 'I showed this one.' Same narrow shape as the mute: a type and nothing
         else. The host is taken from the sending tab by the worker, never from
         the page, so a page cannot claim to have shown a notice on someone
         else's site and silence it there. */
      if (msg.kind === 'toast-shown') {
        const type = String(msg.type || '');
        if (!/^[a-z_]{3,60}$/.test(type)) return null;
        return { kind: 'toast-shown', type };
      }
      if (msg.kind === 'mute-toast') {
        const type = String(msg.type || '');
        if (!/^[a-z_]{3,60}$/.test(type)) return null;
        const minutes = Number(msg.minutes);
        if (![60, 120, 480, 0].includes(minutes)) return null;
        return { kind: 'mute-toast', type, minutes };
      }
      if (msg.kind === 'domain-age') {
        const domain = String(msg.domain || '').replace(/^www\./, '').toLowerCase();
        if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return null;
        if (!relaySamePageHost(domain)) return null;
        return { kind: 'domain-age', domain };
      }
      return null;
    };
    woOn(document, 'wo-background-message', (e) => {
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
      woOn(allow, 'click', (e) => {
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
      woOn(dismiss, 'click', (e) => {
        if (!e || e.isTrusted === false) return;
        const overlay = cookieOverlay;
        cookieOverlay = null;
        try { if (overlay) overlay.destroy(); } catch (_) {}
      });
      row.appendChild(dismiss);

      panel.appendChild(row);
      root.appendChild(panel);
      cookieOverlay.dialog({ label: 'WardenOne: this page is reloading repeatedly',
        description: 'A choice is needed before the page can settle.' });
      cookieOverlay.mount();
    };

    woOn(window, 'message', (e) => {
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
  // Computed at query time, never latched. The old version set a boolean the first time anything
  // was typed into any field -- a site search box counted -- and nothing ever set it false again:
  // not submit, not navigation, not clearing the field. On a single-page app the document lives
  // for the whole session, so one keystroke exempted the tab from Memory Shield permanently and
  // the feature quietly stopped working the more the browser was used.
  //
  // Scanning when asked is affordable because Memory Shield only asks when it is considering this
  // tab, not on every keystroke. Every uncertain answer here resolves to "dirty": this guard is
  // what stops the extension throwing away a tab holding unsaved work, so being wrong in the
  // permissive direction costs the user their typing, while being wrong the other way costs some
  // memory that was not reclaimed.
  const FORM_SCAN_CAP = 4000;

  // A field counts as edited only if it differs from what the markup shipped with -- otherwise
  // every page with a pre-filled form would look dirty before the user touched anything.
  const fieldIsEdited = (el) => {
    const tag = (el.tagName || '').toUpperCase();
    if (el.isContentEditable) return String(el.textContent || '').trim().length > 0;
    if (tag === 'SELECT') {
      const opts = el.options || [];
      for (let i = 0; i < opts.length; i++) {
        if (opts[i].selected !== opts[i].defaultSelected) return true;
      }
      return false;
    }
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset'
        || type === 'image' || type === 'hidden') return false;
      // Checkboxes and radios always carry a value, so compare state rather than value. The old
      // code read el.value here, which is "on" for an untouched checkbox -- so merely having one
      // on the page could mark the tab dirty.
      if (type === 'checkbox' || type === 'radio') return el.checked !== el.defaultChecked;
      if (type === 'file') return !!(el.files && el.files.length);
    }
    const value = String(el.value == null ? '' : el.value);
    if (!value.length) return false;
    if (typeof el.defaultValue === 'string' && value === el.defaultValue) return false;
    return true;
  };

  const pageHasUnsavedInput = () => {
    try {
      const fields = document.querySelectorAll(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      const limit = Math.min(fields.length, FORM_SCAN_CAP);
      for (let i = 0; i < limit; i++) {
        try {
          if (fieldIsEdited(fields[i])) return true;
        } catch (_) {
          return true;
        }
      }
      // More fields than we were willing to scan: unknown, so protect the tab.
      if (fields.length > limit) return true;
      return false;
    } catch (_) {
      return true;
    }
  };
  // Detect active camera/mic by wrapping getUserMedia in THIS (isolated) world.
  // Note: page scripts call getUserMedia in the MAIN world; to catch that too we
  // also listen for a signal Media Shield can post. As a robust fallback, we check
  // navigator.mediaDevices for active tracks periodically isn't possible, so we
  // rely on the wrap + the MAIN-world relay below.
  // Streams captured in THIS world, asked about their own state rather than tracked by a flag.
  // MediaStreamTrack.stop() does not dispatch 'ended' -- per spec -- so the old listener-only
  // clear never ran for the ordinary case of a page stopping its own capture, and the flag stayed
  // true for the life of the page.
  const liveStreams = new Set();

  const pageHasLiveCapture = () => {
    let live = false;
    for (const stream of Array.from(liveStreams)) {
      let any = false;
      try {
        any = stream.getTracks().some((t) => t.readyState === 'live');
      } catch (_) {
        any = false;
      }
      if (any) live = true;
      // Prune as we go, so a long call that starts and stops capture repeatedly cannot grow
      // this set without bound.
      else liveStreams.delete(stream);
    }
    return live;
  };

  // Honest scope: page scripts call getUserMedia in the MAIN world and never reach this wrapper,
  // so in practice the set above stays empty and the MAIN-world relay below is what reports a
  // page's camera or microphone. The wrapper is kept because it costs nothing and does catch
  // capture started from this world, but it is not the mechanism that matters.
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = function (...args) {
        return orig(...args).then((stream) => {
          try { liveStreams.add(stream); } catch (_) {}
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
  let relayMediaActive = false;
  try {
    woOn(window, 'message', (e) => {
      if (e.source === window && e.data && e.data.source === 'wardenone-media'
        && e.data.token === TOKEN) {
        relayMediaActive = !!e.data.active;
      }
    });
  } catch (_) {}
  try {
    woOnMessage((msg, sender, sendResponse) => {
      // Both answers are computed here rather than read from a flag set earlier. The reply shape
      // is unchanged, so background needs no change.
      if (msg && msg.kind === 'memory-form-check') {
        sendResponse({
          formDirty: pageHasUnsavedInput(),
          mediaActive: pageHasLiveCapture() || relayMediaActive,
        });
        return true;
      }
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
          woOn(leave, 'click', (e) => {
            if (e && e.isTrusted === false) return;
            try { if (history.length > 1) history.back(); else location.href = 'about:blank'; } catch (_) { try { location.href = 'about:blank'; } catch (_) {} }
          });
          const dismiss = mkBtn('Dismiss', false);
          woOn(dismiss, 'click', (e) => {
            if (e && e.isTrusted === false) return;
            const overlay = scriptDriftOverlay;
            scriptDriftOverlay = null;
            try { if (overlay) overlay.destroy(); } catch (_) {}
          });
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
          if (scriptDriftOverlay) scriptDriftOverlay.dialog({
            label: 'WardenOne security warning: this site changed its code after loading',
            description: 'Review this before continuing.' });
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
        scriptDriftTimer = woTimeout(() => {
          scriptDriftTimer = 0;
          runScriptDriftScan();
        }, Number(delay) || 1200);
      };
      if (document.readyState === 'loading') woOn(document, 'DOMContentLoaded', () => scheduleScriptDriftScan(1500), { once: true });
      else scheduleScriptDriftScan(1000);
      woOn(document, 'wo-bridge-config-ready', () => scheduleScriptDriftScan(300), { once: true });
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
        woTimeout(driftUnwatch, 60000);
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
          woOn(reset, 'click', (e) => {
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
          woOn(settings, 'click', (e) => {
            if (e && e.isTrusted === false) return;
            try {
              chrome.runtime.sendMessage({ kind: 'open-site-settings', url: location.href }, () => { void chrome.runtime.lastError; });
              status.textContent = 'Chrome settings opened. Set unused permissions to Ask or Block.';
            } catch (_) {}
          });
          const dismiss = mkBtn('Dismiss', false);
          woOn(dismiss, 'click', (e) => {
            if (e && e.isTrusted === false) return;
            const overlay = permChainOverlay;
            permChainOverlay = null;
            try { if (overlay) overlay.destroy(); } catch (_) {}
          });
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
          if (permChainOverlay) permChainOverlay.dialog({
            label: 'WardenOne security warning: this site requested several sensitive permissions',
            description: 'Review what this site is asking for.' });
          if (permChainOverlay) permChainOverlay.mount();
        } catch (_) {}
      };

      woOn(document, 'wo-permission-signal', (e) => {
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
          /* laShown above is what stops this warning returning, so clearing the handle here
             costs nothing and keeps all three interstitials closing the same way. */
          woOn(x, 'click', (e) => {
            if (e && e.isTrusted === false) return;
            const overlay = loginAgeOverlay;
            loginAgeOverlay = null;
            try { if (overlay) overlay.destroy(); } catch (_) {}
          });
          const leave = document.createElement('button');
          leave.setAttribute('style', WO_MODAL.button(true, '12px'));
          leave.textContent = 'Leave site';
          woOn(leave, 'click', (e) => {
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
          loginAgeOverlay.dialog({
            label: 'WardenOne phishing warning: this sign-in page is on a brand-new domain',
            description: 'Do not enter a password until you have checked the address.' });
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
      if (document.readyState === 'loading') woOn(document, 'DOMContentLoaded', laCheck, { once: true });
      else laCheck();
      woOn(document, 'wo-bridge-config-ready', laCheck, { once: true });
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
          woTimeout(() => { laP = false; laCheck(); }, 600);
        });
        woTimeout(laUnwatch, 60000);
      } catch (_) {}
    }
  } catch (_) {}
  try { window.__wardenOneBridgeReadyVersion = BRIDGE_VERSION; } catch (_) {}
})();

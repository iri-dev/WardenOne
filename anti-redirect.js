/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne anti-redirect hardener
 * --------------------------------
 * The main content guard already blocks gestureless redirects. This layer is
 * stricter, with different rules per navigation shape:
 *
 *  - SAME-TAB cross-site redirects (assign/replace/href): a user gesture alone
 *    is NEVER enough. The click must have targeted that site (a real link),
 *    the destination must be a known login/payment provider, or the clicked
 *    control must clearly read as a login/checkout action. This is what stops
 *    "click play on a video -> tab is forced to another site".
 *  - POPUPS (window.open): a fresh gesture on a plain element still allows ONE
 *    popup to a non-suspicious target (keeps legit "open dashboard/maps/app"
 *    buttons working), but strict mode does not let a media-player gesture
 *    authorize a popup. The generic allowance is single-use and briefly
 *    suspended after a confirmed hijack attempt.
 *  - CLICK LAYER: page-generated (untrusted) clicks on cross-site links,
 *    invisible cross-site links, page-covering overlay links, links layered
 *    over the video player, and mousedown->click href bait-and-switch are all
 *    cancelled directly -- these navigate natively and never reach the JS
 *    hooks above.
 *
 * Forced-redirect blocks are silent (the user stays on the page they were
 * using). The redirect-warning interstitial is only raised for ambiguous
 * same-tab cases where the user may genuinely want to continue.
 */
(function () {
  'use strict';

  const WO_GUARD_VERSION = '1.0.1';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOneAntiRedirectHardener === WO_GUARD_VERSION) return;
  if (window.__wardenOneAntiRedirectHardener) {
    try {
      if (typeof window.__wardenOneAntiRedirectDispose === 'function') window.__wardenOneAntiRedirectDispose();
    } catch (_) {}
  }
  window.__wardenOneAntiRedirectHardener = WO_GUARD_VERSION;

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
  window.__wardenOneAntiRedirectDispose = () => {
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

  let token = null;
  let queuedEvents = [];
  let guardConfig = {
    __configReady: false,
    enabled: true,
    blockGesturelessNav: true,
    blockForcedPopups: true,
    strictPopupShield: true,
    blockPopupTricks: true,
    blockTokenExfil: true,
    detectSkimmers: true,
    paymentCardGuard: true,
    gestureWindowMs: 2400,
  };
  let lastGestureAt = 0;
  let intendedHost = '';
  let intentWasExplicit = false;
  let lastIntentText = '';
  let lastIntentStructural = false;
  // True when the current gesture landed on/over actual media/embed content.
  // Strict popup mode treats that signal as tainted; ordinary native player
  // controls and same-tab navigation remain untouched.
  let lastGestureTainted = false;
  // The lenient "gesture on a plain element may open one popup" allowance is
  // single-use per gesture (kills popunder chains)...
  let nonExplicitPopupSpent = false;
  // ...and is temporarily revoked after a hijack attempt. A short TTL stops
  // retry bursts without permanently breaking a site's later legitimate UI.
  let pageHostileUntil = 0;
  // Snapshot of the link under the pointer at press time, to catch pages that
  // swap a link's destination between mousedown and click.
  let pressAnchor = null;
  let pressAnchorHost = '';
  let pressAnchorHref = '';

  const DEFAULT_WINDOW_MS = 2400;
  const HOSTILE_TTL_MS = 3000;
  const TOP_FRAME = (function () {
    try { return window.top === window.self; } catch (_) { return false; }
  }());
  const TRUSTED_BASE_DOMAINS = new Set([
    'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'recaptcha.net',
    'hcaptcha.com', 'facebook.com', 'fbcdn.net', 'apple.com', 'cdn-apple.com', 'icloud.com',
    'microsoft.com', 'microsoftonline.com', 'msauth.net', 'msftauth.net', 'live.com', 'office.com',
    'paypal.com', 'paypalobjects.com', 'stripe.com', 'stripe.network', 'braintreegateway.com',
    'braintreepayments.com', 'adyen.com', 'adyenpayments.com', 'twitter.com', 'x.com', 't.co',
    'linkedin.com', 'github.com', 'gitlab.com', 'amazon.com', 'amazoncognito.com',
    'spotify.com', 'youtube.com', 'googlevideo.com', 'ytimg.com', 'twitch.tv', 'ttvnw.net',
    'jtvnw.net', 'twitchcdn.net', 'zoom.us', 'slack.com', 'dropbox.com', 'okta.com',
    'oktacdn.com', 'oktapreview.com', 'okta-emea.com', 'auth0.com', 'onelogin.com',
    'duosecurity.com', 'pingidentity.com', 'pingone.com', 'pingone.eu', 'pingone.asia',
    'pingone.ca', 'forgerock.io', 'forgerock.com', 'jumpcloud.com', 'miniorange.com',
    'b2clogin.com', 'ciamlogin.com', 'workos.com', 'frontegg.com', 'descope.com', 'stytch.com',
    'openathens.net', 'shibboleth.net', 'cloudflare.com',
  ]);

  function cfg() {
    return guardConfig;
  }

  function configReady() {
    return cfg().__configReady === true;
  }

  // Every other guard honours the user's allowlist; this one never did. It is a
  // separate <all_urls> content script, statically declared, so it cannot be
  // skipped per host at injection time -- and the bridge hands it the raw toggles
  // rather than the allowlist-gated ones the main engine computes for itself. The
  // result was that "allow this site" left forced-popup, gestureless-navigation
  // and meta-refresh blocking running there anyway. The allowlist travels with
  // the config, so the check belongs here.
  function hostAllowedByUser() {
    try {
      const list = cfg().allowlist;
      if (!Array.isArray(list) || !list.length) return false;
      const host = String(location.hostname || '').replace(/^www\./, '').toLowerCase();
      if (!host) return false;
      return list.some((item) => hostMatchesSite(host, item));
    } catch (_) {
      return false;
    }
  }

  function masterEnabled() {
    const c = cfg();
    return configReady() && c.enabled !== false && !hostAllowedByUser();
  }

  function navigationEnabled() {
    return TOP_FRAME && masterEnabled() && cfg().blockGesturelessNav !== false;
  }

  // A cross-origin iframe navigating the TOP window is invisible from in here.
  // Setting top.location from another origin goes through Chrome's cross-origin
  // path, which never invokes the accessor this file installs on the top frame's
  // own location object -- and the hooks below are top-frame-only anyway. The
  // service worker CAN see the resulting navigation, but not who caused it, so
  // these two signals give it the missing half: "the click landed on a player and
  // targeted nothing", and "this frame authorised the navigation itself".
  // Did the click land on something laid OVER the page rather than in it? A fake
  // "Please confirm to continue" dialog exists to collect exactly one trusted
  // click, because that click is what lets the page open a popup or move the tab.
  // Counting it as the user authorising a jump is the entire mechanism of the bait,
  // and it is how a page walks straight past the forced-redirect check.
  function gestureOnOverlay(target) {
    try {
      for (let el = target, depth = 0; el && el.nodeType === 1 && depth < 10; el = el.parentElement, depth++) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        const z = parseInt(cs.zIndex, 10);
        if (!(z >= 1000)) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= 160 && r.height >= 80) return el;
      }
    } catch (_) {}
    return null;
  }

  // A dialog that asks you to confirm without ever saying what. Real confirmations
  // name the thing: an amount, a file, an account, a site. "Attention / Please
  // confirm to continue" names nothing because there is nothing -- the click IS the
  // product. Kept deliberately narrow, and it only ever warns.
  // A generic action with no object. Not "Download report.pdf" -- just "DOWNLOAD".
  const BAIT_CONTROL = /^(?:continue|ok|okay|confirm|proceed|yes|allow|start|go|next|watch|play|download|install|get|open|view|claim|unlock|access|resume|stream|free|enter|i\s*am|i['\u2019]m)\b/i;

  // Two lists, because they are doing two different jobs.
  //
  // HARD names something being transacted: money, a file, a credential, a deletion.
  // These always exclude, wherever the box came from, because a mistake there costs
  // the user something real.
  //
  // SOFT names something being CLAIMED as a reason -- your age, cookies, terms,
  // your account. These are the excuses bait borrows, which is exactly why they
  // only exclude when the box is part of the page itself. A site's own age gate is
  // drawn by the site; it does not arrive in an anonymous injected frame, so inside
  // one the excuse carries no weight. Getting this split wrong in the other
  // direction is what let a payment dialog become eligible the moment it appeared
  // in a frame.
  const BAIT_SUBJECT_HARD = new RegExp([
    '[£$\\u20ac]\\s?\\d',
    '\\b\\d+(?:\\.\\d+)?\\s?(?:kb|mb|gb|bytes)\\b',
    '\\b[\\w-]+\\.(?:pdf|zip|docx?|xlsx?|csv|png|jpe?g|mp4|mp3|exe|dmg|apk|txt)\\b',
    '\\bpayment', '\\bpassword', '\\bsign\\s?in', '\\blog\\s?in', '\\bdelete',
    '\\bcancel\\s+your', '\\bsubscription', '\\border\\b',
  ].join('|'), 'i');

  const BAIT_SUBJECT_SOFT = new RegExp([
    '\\bcookie', '\\bconsent', '\\bage\\b', '\\b18\\b', '\\bolder\\b', '\\badult',
    '\\bverify', '\\bterms\\b', '\\bprivacy\\b', '\\bemail\\b', '\\baccount\\b',
    '\\bversion\\b', '\\bupdate\\s+to\\b',
  ].join('|'), 'i');

  function overlayControls(el) {
    const out = [];
    const push = (node) => {
      const text = String((node && node.innerText) || (node && node.value) || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 24) {
        out.push({ text: text, href: node.getAttribute ? node.getAttribute('href') : null });
      }
    };
    try {
      const nodes = el.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]');
      for (let i = 0; i < nodes.length && out.length < 8; i++) push(nodes[i]);
      if (out.length) return out;
      // Nothing in there calls itself a button. That is not unusual and it is not
      // an accident -- there is no reason for this markup to be honest, and a
      // dialog built out of plain divs and spans was reaching this function and
      // leaving with an empty list, which failed on the very first rail. So fall
      // back to leaf elements carrying a short label of their own: whatever the tag
      // says, a leaf with "OK" in it is the thing being clicked.
      const all = el.querySelectorAll('*');
      for (let i = 0; i < all.length && i < 400 && out.length < 8; i++) {
        const node = all[i];
        if (node.children && node.children.length) continue;
        push(node);
      }
    } catch (_) {}
    return out;
  }

  // Judged on shape. The previous version still required a confirmation PHRASE, and
  // that was the same mistake in a smaller font: the wording changed three times --
  // "Please confirm to continue", "Continue now?", "The file is ready to download"
  // -- and every rewrite walked past a list of phrases. There is no sentence to
  // match on, so nothing here matches one.
  //
  // What the box cannot do without is the shape: it appears over the page after
  // load, it is too short to say what it wants, it names no subject, it asks for
  // nothing (a box with a real field is asking for something real), and its
  // affirmative control leads nowhere -- because the click is the product, and a
  // control that actually went somewhere would have to say where.
  // Making access to the page conditional on clicking the BROWSER's own Allow
  // button. That is the notification-permission scam, and it is worth its own rule
  // because it defeats the subject exclusion below on purpose: this one announced
  // "OVER 18" precisely because age is the one subject that excuses anything, and
  // the exclusion that exists to protect real age gates would have waved it
  // straight through.
  // A real age gate never mentions Allow -- it has no reason to know what the
  // browser's permission dialog says. And a site that legitimately asks for
  // notifications does not hold the content hostage to them; it is the coupling of
  // "click Allow" to "to view / to continue" that makes this what it is.
  const BAIT_PERMISSION_COERCION = /\b(?:click|press|tap|choose|select|hit)\s*(?:on\s*)?["'\u2018\u2019\u201c\u201d]?allow["'\u2018\u2019\u201c\u201d]?[^.]{0,40}?\b(?:to\s+)?(?:view|continue|watch|access|enter|download|proceed|see|play)\b/i;

  // anonymousFrame means this box arrived in a frame the page BUILT -- no address
  // of its own, nothing for a filter list to match. That matters because it is the
  // only thing separating this from a real age gate.
  //
  // The box that forced this said "I AM 18" and "EXIT", which is exactly what a
  // genuine age gate says, and the age exclusion exists precisely so genuine ones
  // are never touched. There is no wording that tells them apart, and pretending
  // otherwise would mean breaking real age gates to catch fake ones.
  //
  // But a site's own age gate is part of its own page. It does not arrive in an
  // anonymous injected frame, because it has no reason to -- the site could just
  // draw it. So inside such a frame the subject exclusions do not apply: the
  // provenance has already answered the question the words cannot. Anything in the
  // page itself keeps the full protection.
  function confirmBaitOverlay(overlay, anonymousFrame) {
    try {
      if (!overlay) return false;
      const text = String(overlay.innerText || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 140 && BAIT_PERMISSION_COERCION.test(text)) {
        // The words are the whole tell here, so the controls are not asked to
        // identify themselves -- this one's buttons were a red cross and a green
        // tick with no text in them at all, which no label-matching would ever see.
        let clickable = false;
        try {
          clickable = !!(overlay.querySelector
            && overlay.querySelector('a,button,[role="button"],img,svg,input,[onclick]'));
        } catch (_) {
          clickable = false;
        }
        if (clickable) return true;
        // No real control in there, so fall through and let the ordinary rules
        // judge it on its labels. This branch only ever adds a way to say yes.
      }
      // Explaining takes room. The four seen so far are 51, 43, 55 and 39 characters.
      if (!text || text.length > 140) return false;
      if (BAIT_SUBJECT_HARD.test(text)) return false;
      if (!anonymousFrame && BAIT_SUBJECT_SOFT.test(text)) return false;
      // A box with somewhere to type is collecting something, not just a click.
      try {
        if (overlay.querySelector('input[type="text"],input[type="email"],input[type="password"],input[type="search"],input:not([type]),textarea,select')) return false;
      } catch (_) {}
      const controls = overlayControls(overlay);
      if (!controls.length || controls.length > 4) return false;
      const affirmative = controls.filter((c) => BAIT_CONTROL.test(c.text));
      if (!affirmative.length) return false;
      // A control that genuinely goes somewhere says where. These never do.
      return !affirmative.some((c) => c.href);
    } catch (_) {
      return false;
    }
  }

  // Deliberately NOT top-frame only. These boxes are injected into a third-party
  // frame, which is the whole trick: from the top frame elementFromPoint returns the
  // <iframe> element, and an iframe has no innerText, so the shape test looked at an
  // empty string and said "not bait" every single time. The guard has to run where
  // the box actually is. This script already runs in every frame; only this check
  // was refusing to.
  function confirmBaitEnabled() {
    const c = cfg();
    // Deliberately NOT gated on configReady(), unlike everything else here. The
    // config arrives by message, and in a third-party frame that message may never
    // arrive at all -- there is no reason to assume the bridge completed a handshake
    // inside somebody else's ad frame. Waiting for it there means never running.
    // The cost of that asymmetry is small and one-directional: every default in
    // this file is already "on", so acting before the config lands only ever does
    // what the config would have said anyway, and if it lands saying otherwise the
    // next sweep honours it. The allowlist check still applies, and reads as
    // "not allowed" while the list is absent, which is the same answer it gives on
    // any site the user has not allowed.
    return c.enabled !== false && c.blockPopupTricks !== false && !hostAllowedByUser();
  }

  // Waiting for the click was the flaw in warning about this: by the time it fired
  // the page already had what it wanted. These are removed on sight instead.
  // Only nodes the page ADDS are examined -- scanning the document on every
  // mutation would cost more than the thing it is looking for -- and the check is
  // deferred a moment because a dialog is usually inserted before it is filled in.
  // The cap is a runaway brake, not a budget. A page that keeps putting these back
  // should keep having them taken away; what must not happen is an unbounded
  // remove/reinsert loop.
  const BAIT_REMOVE_CAP = 25;
  let baitRemoved = 0;
  const baitPending = new Set();

  // These boxes lock the page behind them, and removing the box without releasing the lock
  // leaves a page nobody can scroll.
  //
  // This used to clear an inline overflow and nothing else, which missed almost every real
  // one. Measured across a 101-site sweep of full-screen overlays: the lock is normally a
  // CLASS on <html> or <body> (sp-message-open, modal-open, a plain noScroll), so there is no
  // inline style to clear -- and the modern form is position:fixed on the body, which takes it
  // out of flow and collapses the document to one viewport, something clearing overflow cannot
  // undo at all. On one site that left a page reporting 900px of scroll height instead of
  // 27,967px.
  //
  // Cheapest tier first, and each tier only runs if the page is still stuck: removing the
  // class leaves no trace of ours behind, whereas the !important fallback does.
  const BAIT_LOCK_CLASS_RE = /^(?:modal-open|no-?scroll|noscroll|scroll-?lock(?:ed)?|is-?locked|body-?lock(?:ed)?|overflow-?hidden|is-clipped|ReactModal__Body--open|prevent-?scroll|disable-?scroll|fixed-?body|popup-?open|sp-message-open)$/i;
  function baitPageStuck() {
    // scrollHeight stays at its full value while the page is frozen, so it cannot answer this.
    // Asking the page to scroll and reading the offset back can.
    try {
      const y = window.scrollY;
      if (y > 50) return false;
      window.scrollTo(0, 700);
      const moved = window.scrollY > 50;
      window.scrollTo(0, y);
      return !moved;
    } catch (_) { return false; }
  }
  function releaseBaitLock() {
    try {
      const html = document.documentElement;
      const body = document.body;
      if (!html || !body || !baitPageStuck()) return;
      // The parked scroll offset. These boxes set body top to minus the offset to hold the
      // reader's place; clearing it without reading it back drops them at the top of the page.
      let parked = 0;
      try { parked = Math.abs(parseInt(getComputedStyle(body).top, 10) || 0); } catch (_) {}

      for (const el of [html, body]) {
        try {
          for (const cls of Array.from(el.classList)) {
            if (BAIT_LOCK_CLASS_RE.test(cls)) el.classList.remove(cls);
          }
        } catch (_) {}
      }
      if (baitPageStuck()) {
        for (const el of [html, body]) {
          for (const prop of ['position', 'top', 'left', 'width', 'height', 'overflow', 'overflow-y']) {
            try { el.style.removeProperty(prop); } catch (_) {}
          }
        }
      }
      if (baitPageStuck()) {
        try {
          body.style.setProperty('position', 'static', 'important');
          body.style.setProperty('overflow', 'visible', 'important');
          body.style.setProperty('height', 'auto', 'important');
          html.style.setProperty('overflow', 'visible', 'important');
        } catch (_) {}
      }
      if (parked) { try { window.scrollTo(0, parked); } catch (_) {} }
    } catch (_) {}
  }
  /* One pending sweep at a time. Both schedulers below fire from a
     MutationObserver, and neither checked whether a sweep was already queued --
     so a page whose DOM churns (dragging a video timeline churns it constantly)
     queued a fresh timer per mutation batch, tens per second, each running the
     whole sweep. Coalescing means the churn costs one sweep, not one per batch. */
  let baitSweepTimer = 0;
  function scheduleConfirmBaitSweep(delay) {
    if (baitSweepTimer) return;
    baitSweepTimer = woTimeout(() => { baitSweepTimer = 0; sweepConfirmBait(); }, delay);
  }

  function sweepConfirmBait() {
    const nodes = Array.from(baitPending);
    baitPending.clear();
    if (!confirmBaitEnabled() || baitRemoved >= BAIT_REMOVE_CAP) return;
    const candidates = [];
    for (const node of nodes) {
      try {
        if (!node.isConnected) continue;
        const box = gestureOnOverlay(node) || (isOverlayBox(node) ? node : null);
        if (box && candidates.indexOf(box) === -1) candidates.push(box);
      } catch (_) {}
    }
    for (const box of boxesInTheWay()) {
      if (candidates.indexOf(box) === -1) candidates.push(box);
    }
    for (const entry of sameOriginFrameBoxes()) {
      try {
        if (!entry.frame.isConnected) continue;
        if (overlayAdFramesEnabled() && !confirmBaitOverlay(entry.body, entry.anonymous)
            && overlayAdFrame(entry.frame, entry.body)) {
          if (baitRemoved >= BAIT_REMOVE_CAP) break;
          baitRemoved++;
          try { entry.frame.remove(); } catch (_) {}
          emit('blocked_overlay_ad_frame', { matched: 'script-built frame, no address', silent: true, quiet: true });
          continue;
        }
        if (!confirmBaitOverlay(entry.body, entry.anonymous)) continue;
        if (baitRemoved >= BAIT_REMOVE_CAP) break;
        baitRemoved++;
        const label = String(entry.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        try { entry.frame.remove(); } catch (_) {}
        // A bait box framed from the same origin locks the host page exactly as an inline
        // one does, so it needs the same release.
        releaseBaitLock();
        emit('blocked_confirm_bait', { matched: label, silent: true, quiet: true });
      } catch (_) {}
    }
    for (const overlay of candidates) {
      try {
        if (!overlay.isConnected || !confirmBaitOverlay(overlay)) continue;
        baitRemoved++;
        const label = String(overlay.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        try { overlay.remove(); } catch (_) {}
        releaseBaitLock();
        emit('blocked_confirm_bait', { matched: label, silent: true, quiet: true });
      } catch (_) {}
    }
  }

  function isOverlayBox(el) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 80) return false;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'absolute' || cs.position === 'sticky') return true;
      // Inside a frame the FRAME is the thing sitting over the page, so the box in
      // it has no reason to be positioned at all -- and requiring it to be was the
      // second half of why this never fired. A box filling most of a small frame is
      // what that frame is for.
      if (!TOP_FRAME) {
        const w = window.innerWidth || 0;
        const h = window.innerHeight || 0;
        return w > 0 && h > 0 && r.width >= w * 0.6 && r.height >= h * 0.4;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  // Whatever the browser paints on top IS the thing in the way -- no z-index
  // threshold to guess at, no stacking context to reason about, and nothing for a
  // page to sidestep by picking a different number.
  //
  // Sampled across a grid rather than straight down the middle. Three points on the
  // centre line found the centred dialogs and missed the one that moved to the top
  // right corner, which is exactly the kind of thing that moves. A grid costs the
  // same order of work and does not care where the box sits.
  //
  // elementFromPoint forces layout, so this is rate-limited: on a page whose DOM
  // churns constantly the mutation path would otherwise run it several times a
  // second for nothing.
  let lastGridAt = 0;
  const GRID_MIN_MS = 500;
  const GRID_MAX_MS = 8000;
  let gridInterval = GRID_MIN_MS;
  function boxesInTheWay() {
    const found = [];
    try {
      const w = window.innerWidth || 0;
      const h = window.innerHeight || 0;
      if (w < 150 || h < 120) return found;   // an ad frame is smaller than a page
      const now = Date.now();
      /* Each point below is an elementFromPoint, and each forces layout. On a
         page being actively dragged the layout is never clean, so all 25 flush
         for real, twice a second, for a box that is almost never there. The
         interval stretches while the grid keeps coming back empty and snaps
         back the moment it finds something, so a real overlay is still caught
         promptly and an ordinary page stops paying for the search. */
      if (now - lastGridAt < gridInterval) return found;
      lastGridAt = now;
      const fractions = [0.15, 0.3, 0.5, 0.7, 0.85];
      for (let a = 0; a < fractions.length; a++) {
        for (let b = 0; b < fractions.length; b++) {
          if (found.length >= 6) return found;
          let el = document.elementFromPoint(Math.floor(w * fractions[a]), Math.floor(h * fractions[b]));
          // Walk up to the box itself rather than the label inside it.
          for (let i = 0; el && el.nodeType === 1 && i < 8; i++) {
            if (isOverlayBox(el)) { if (found.indexOf(el) === -1) found.push(el); break; }
            el = el.parentElement;
          }
        }
      }
    } catch (_) {}
    gridInterval = found.length
      ? GRID_MIN_MS
      : Math.min(GRID_MAX_MS, Math.round(gridInterval * 1.6));
    return found;
  }

  // Where the box actually turned out to be. Reported live from the page: every
  // frame on it was src=about:blank or had no src at all, and every one was
  // position:static with z-index:auto. Both halves of that mattered.
  //
  // Static and unpositioned means the frame is not an "overlay" by any measure this
  // file had -- elementFromPoint lands on its container, the container holds an
  // iframe and therefore has no innerText, and the shape test read an empty string
  // and said "not bait". Every wording fix was being applied to something that was
  // never reached.
  //
  // about:blank / no src means the frame was built by script and is SAME-ORIGIN, so
  // its document can simply be read from here. That is the opening: the box inside
  // is judged by exactly the same seven rails as any other, and if it is bait the
  // FRAME goes, because the frame is the thing that would otherwise redraw it.
  // A cross-origin frame throws on contentDocument and is skipped -- that case
  // belongs to the copy of this script running inside it.
  // These frames are inserted empty and filled a moment later, so a sweep that
  // arrives between the two finds an empty body, decides it is not bait, and does
  // not look again until the next scheduled pass -- which is why the box was
  // visible for about a second before going. Watching each frame's own document
  // means the sweep happens the instant it is filled, rather than whenever the
  // next timer happens to land.
  const watchedFrameDocs = new WeakSet();
  function watchFrameDocument(doc) {
    try {
      if (!doc || watchedFrameDocs.has(doc)) return;
      watchedFrameDocs.add(doc);
      const observer = woObserver(() => { scheduleConfirmBaitSweep(30); });
      observer.observe(doc.documentElement || doc, { childList: true, subtree: true });
    } catch (_) {}
  }

  // A different animal from the confirm box, and judged separately because it is
  // not pretending to be anything: no sentence, no confirmation, no impersonated
  // prompt -- just a graphic with a call to action. The confirm-box rule reads text
  // and correctly refuses to touch this, and widening THAT rule to cover a picture
  // would take real widgets with it.
  //
  // What marks it out is the frame rather than the artwork. It has no address at
  // all: script built it, so there is nothing for a filter list to match on. And it
  // is sandboxed with popups allowed, which is an odd thing to want unless clicking
  // is meant to open something. Every legitimate embed of this shape -- payment
  // forms, captchas, players, maps -- is loaded from a real src. Together with
  // "holds a clickable thing and says almost nothing", that is specific enough to
  // act on, and it has its own switch because it is a judgement call.
  function overlayAdFrame(frame, body) {
    try {
      const src = String(frame.getAttribute('src') || '').trim().toLowerCase();
      if (src && src !== 'about:blank') return false;
      const sandbox = String(frame.getAttribute('sandbox') || '').toLowerCase();
      if (!sandbox || sandbox.indexOf('allow-popups') === -1) return false;
      const text = String(body.innerText || '').replace(/\s+/g, ' ').trim();
      // Anything that explains itself is not a bare creative.
      if (text.length > 40) return false;
      return !!body.querySelector('a,img,button,[onclick]');
    } catch (_) {
      return false;
    }
  }

  function overlayAdFramesEnabled() {
    const c = cfg();
    return c.enabled !== false && c.blockPopupTricks !== false && !hostAllowedByUser();
  }

  function sameOriginFrameBoxes() {
    const out = [];
    try {
      const frames = document.querySelectorAll('iframe');
      for (let i = 0; i < frames.length && out.length < 8; i++) {
        const frame = frames[i];
        let doc = null;
        try { doc = frame.contentDocument; } catch (_) { doc = null; }
        if (!doc) continue;
        // Watched whatever size it is RIGHT NOW, before the size test below. A
        // frame that starts 0x0 and is grown and filled later would otherwise never
        // be watched at all: the size test skipped it, so nothing was listening to
        // its document, and growing it changes no childList in the parent for the
        // outer observer to see either. The timed sweeps cover the first few
        // seconds; this covers the rest of the page's life.
        watchFrameDocument(doc);
        const r = frame.getBoundingClientRect();
        if (r.width < 160 || r.height < 80) continue;
        if (!doc.body) continue;
        const src = String(frame.getAttribute('src') || '').trim().toLowerCase();
        out.push({ frame: frame, body: doc.body, anonymous: !src || src === 'about:blank' });
      }
    } catch (_) {}
    return out;
  }

  function frameTopRedirectEnabled() {
    return TOP_FRAME && masterEnabled() && cfg().blockPopupTricks !== false;
  }

  let lastGestureBeacon = 0;
  function signal(kind, extra) {
    if (!token) return;
    // The gesture beacon fires on every click and keypress. The worker only needs
    // to know one happened recently, so twice a second is plenty and keeps this
    // well inside the bridge budget.
    if (kind === 'gesture') {
      const now = Date.now();
      if (now - lastGestureBeacon < 500) return;
      lastGestureBeacon = now;
    }
    try {
      document.dispatchEvent(new CustomEvent('wo-nav-signal', {
        detail: Object.assign({ token, kind }, extra || {}),
      }));
    } catch (_) {}
  }

  function popupEnabled() {
    return masterEnabled() && cfg().blockForcedPopups !== false;
  }

  function strictPopupEnabled() {
    return popupEnabled() && cfg().strictPopupShield === true;
  }

  function playerDocument() {
    try {
      const path = String(location.pathname || '').toLowerCase();
      if (/(?:^|[\/_-])(?:watch|episodes?|streams?|videos?|embed|player)(?:[\/_.-]|$)/i.test(path)) return true;
      return !!document.querySelector('video,audio,embed,object,[data-player],[data-video],.video-js,.jwplayer,.plyr,[data-plyr-provider],.shaka-video-container,.dplayer,.art-video-player,.clappr-container,#player,iframe[allow*="autoplay" i],iframe[allowfullscreen],iframe[src*="/embed/" i],iframe[src*="/player/" i]');
    } catch (_) {
      return false;
    }
  }

  function pageHostile() {
    return Date.now() < pageHostileUntil;
  }

  function markHostile() {
    pageHostileUntil = Date.now() + HOSTILE_TTL_MS;
  }

  function gestureWindowMs() {
    const n = Number(cfg().gestureWindowMs);
    return Number.isFinite(n) && n > 0 ? Math.max(n, DEFAULT_WINDOW_MS) : DEFAULT_WINDOW_MS;
  }

  function regHost(host) {
    return String(host || '').replace(/^www\./, '').toLowerCase();
  }

  function isTrustedHost(host) {
    host = regHost(host);
    if (!host) return false;
    for (const base of TRUSTED_BASE_DOMAINS) {
      if (hostMatchesSite(host, base)) return true;
    }
    return false;
  }

  function isGoogleAppSurface(host) {
    return /^(drive|docs|mail|calendar|classroom|meet|chat|myaccount)\.google\.com$/i.test(regHost(host));
  }

  function isUcasHost(host) {
    host = regHost(host);
    return host === 'ucas.com' || host.endsWith('.ucas.com') || host === 'ucas.ac.uk' || host.endsWith('.ucas.ac.uk');
  }

  function isEducationPortalHost(host) {
    host = regHost(host);
    if (!host) return false;
    if (/\.edu$/i.test(host)) return true;
    if (/\.(?:ac|edu|sch)\.[a-z]{2}$/i.test(host)) return true;
    if (/\.k12\.[a-z]{2}\.us$/i.test(host)) return true;
    return /\.(?:university|college|academy|school|education)$/i.test(host);
  }

  function federationUrlShape(rawTarget) {
    try {
      const u = new URL(String(rawTarget || ''), location.href);
      if (!/^https?:$/i.test(u.protocol)) return false;
      const host = regHost(u.hostname);
      const path = String(u.pathname || '').toLowerCase();
      const tail = (path + ' ' + String(u.search || '') + ' ' + String(u.hash || '')).toLowerCase();
      const params = new Set();
      u.searchParams.forEach((_value, key) => params.add(String(key || '').toLowerCase()));
      const has = (key) => params.has(key);

      // SAML browser POST/Redirect bindings and Shibboleth/ADFS endpoints.
      if ((has('samlrequest') || has('samlresponse')) && (has('relaystate') || /saml|shibboleth|adfs|sso/.test(path))) return true;
      if (/(?:^|\/)(?:shibboleth\.sso|saml2?|adfs\/ls)(?:\/|$)/i.test(path)
          && /(sso|acs|consume|post|redirect|login|auth|callback|\/ls)/i.test(path)) return true;

      // OAuth/OIDC authorization requests and their state-bound callbacks.
      if (has('client_id') && has('redirect_uri') && has('response_type')
          && /oauth|oidc|openid-connect|connect\/authorize|\/authorize(?:\/|$)|auth\/realms/.test(path)) return true;
      if (has('state') && (has('code') || has('id_token') || has('access_token') || has('error'))
          && /oauth|oidc|openid|callback|signin|login/.test(tail)) return true;

      // CAS (Apereo/Jasig) is the dominant university/enterprise SSO. Its /cas/
      // endpoints and service=/ticket= params are distinctive enough not to be a
      // generic redirect bypass, so recognise them on any host.
      if (/(?:^|\/)cas\/(?:login|logout|oidc|oauth2(?:\.0)?|saml(?:validate)?|idp)(?:\/|$)/i.test(path)) return true;
      if ((has('service') || has('ticket') || has('gateway') || has('renew')) && /(?:^|\/)cas(?:\/|$)/i.test(path)) return true;

      // Identity hosts (login/auth/accounts/sso/idp/adfs/cas/...) that ALSO carry a
      // federation path or query. Host signal alone is deliberately never enough --
      // the tail must read as auth -- mirroring the trusted isFederatedAuthTarget
      // form-sensitivity check, so this is not a generic login.* host bypass. Custom
      // Shibboleth/OpenAthens IdPs often live on a university/customer domain, not
      // the vendor's.
      const identitySurface = /(^|[.-])(openathens|shibboleth|shib|sso|idp|identity|login|logon|signin|auth|accounts?|sts|adfs|cas|wayf|idpselect|fedauth)([.-]|$)/i.test(host)
        || /(?:^|\/)(?:openathens|shibboleth|adfs|cas|simplesaml|oidc)(?:\/|$)/i.test(path);
      return identitySurface && /auth|login|logon|signin|sso|saml|oauth|oidc|openid|federat|wayf|discovery|redirect|authorize|realms|connect|accountchooser|idp|ticket/.test(tail);
    } catch (_) {
      return false;
    }
  }

  function isLoginCompatibilityPage() {
    const host = regHost(location.hostname);
    const path = String(location.pathname || '').toLowerCase();
    // These are complex first-party applications and education/federation
    // surfaces. Leave their SDK-owned navigation primitives completely native.
    if (isGoogleAppSurface(host) || isUcasHost(host) || isEducationPortalHost(host)) return true;
    if (/^(accounts\.google\.com|oauth2\.googleapis\.com|apis\.google\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|firebaseappcheck\.googleapis\.com|clientservices\.googleapis\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|appleid\.cdn-apple\.com|cdn\.auth0\.com|accounts\.spotify\.com|login\.spotify\.com|login5\.spotify\.com|challenges\.cloudflare\.com|turnstile\.cloudflare\.com)$/.test(host)) return true;
    if (/(^|\.)(okta\.com|oktacdn\.com|oktapreview\.com|okta-emea\.com|auth0\.com|onelogin\.com|duosecurity\.com|hcaptcha\.com|recaptcha\.net|amazoncognito\.com|pingidentity\.com|pingone\.com|pingone\.eu|pingone\.asia|pingone\.ca|forgerock\.io|forgerock\.com|jumpcloud\.com|miniorange\.com|b2clogin\.com|ciamlogin\.com|msauth\.net|msftauth\.net|workos\.com|frontegg\.com|descope\.com|stytch\.com|openathens\.net|shibboleth\.net)$/.test(host)) return true;
    if (host === 'github.com' && path.indexOf('/login/oauth') === 0) return true;
    if ((host === 'discord.com' || host === 'discordapp.com') && /^\/(api\/)?oauth2\//.test(path)) return true;
    if ((host === 'facebook.com' || host === 'www.facebook.com') && path.indexOf('/dialog/oauth') === 0) return true;
    if ((host === 'paypal.com' || host === 'www.paypal.com') && /\/(signin|checkout)\b/.test(path)) return true;
    if (host === 'shopify.com' || host.endsWith('.shopify.com')) return true;
    if (federationUrlShape(location.href)) return true;
    return false;
  }

  if (isLoginCompatibilityPage()) return;

  // One window.open hook owns all popup decisions. AdShield scriptlets register
  // URL matchers here instead of stacking more wrappers around the page API.
  const popupMatcherEntries = new Map();
  const CORE_MATCHER_PREFIX = 'core:';
  const popupMatcherApi = Object.freeze({
    version: 1,
    register(id, matcher) {
      id = String(id || '').slice(0, 160);
      // This API is necessarily visible in MAIN world. Never let page code
      // replace the built-in policy by claiming its reserved identifier.
      if (!id || id.indexOf(CORE_MATCHER_PREFIX) === 0 || typeof matcher !== 'function') return function () {};
      if (!popupMatcherEntries.has(id) && popupMatcherEntries.size >= 160) return function () {};
      popupMatcherEntries.set(id, matcher);
      return function unregisterMatcher() {
        if (popupMatcherEntries.get(id) === matcher) popupMatcherEntries.delete(id);
      };
    },
    unregister(id) {
      id = String(id || '').slice(0, 160);
      if (!id || id.indexOf(CORE_MATCHER_PREFIX) === 0) return false;
      return popupMatcherEntries.delete(id);
    },
    match(url, context) {
      const value = String(url == null ? '' : url);
      for (const [id, matcher] of popupMatcherEntries) {
        try {
          const result = matcher(value, context || {});
          if (result) return { id, reason: typeof result === 'string' ? result : id };
        } catch (_) {
          // A malformed remote matcher must never break the native popup path.
        }
      }
      return null;
    },
  });
  try {
    Object.defineProperty(window, '__wardenOnePopupMatchers', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: popupMatcherApi,
    });
  } catch (_) {}

  function hostOf(url) {
    try {
      const u = new URL(String(url || ''), location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return regHost(u.hostname);
    } catch (_) {
      return '';
    }
  }

  function baseDomain(host) {
    /* domain-utils.js is injected immediately before this script in the same MAIN
       world. Keeping the wrapper makes every existing navigation/storage caller use
       the shared private-suffix policy without retaining a second reducer here. */
    try { return registrableDomain(host); } catch (_) { return regHost(host); }
  }

  function sameParty(a, b) {
    a = regHost(a);
    b = regHost(b);
    return !!(a && b && (
      hostMatchesSite(a, b)
      || hostMatchesSite(b, a)
      || sameSiteDomain(a, b)
    ));
  }

  function decodedUrlishText(value) {
    let out = String(value || '');
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(out.replace(/\+/g, ' '));
        if (next === out) break;
        out = next;
      } catch (_) {
        break;
      }
    }
    return out;
  }

  function redirectWrapperPointsAt(sourceHref, targetHref) {
    try {
      const target = new URL(String(targetHref || ''), location.href);
      const targetHost = regHost(target.hostname);
      if (!targetHost || !/^https?:$/i.test(target.protocol)) return false;
      const source = new URL(String(sourceHref || ''), location.href);
      if (!/^https?:$/i.test(source.protocol)) return false;
      const keys = ['url', 'u', 'q', 'to', 'target', 'dest', 'destination', 'redirect', 'redirect_url', 'redirect_uri', 'go', 'link'];
      for (const key of keys) {
        const values = source.searchParams.getAll(key);
        for (let i = 0; i < values.length; i++) {
          const decoded = decodedUrlishText(values[i]);
          try {
            const nested = new URL(decoded, location.href);
            if (sameParty(nested.hostname, targetHost)) return true;
          } catch (_) {}
          if (decoded.toLowerCase().indexOf(targetHost) >= 0) return true;
        }
      }
      const haystack = decodedUrlishText((source.search || '') + ' ' + (source.hash || '')).toLowerCase();
      return haystack.indexOf(targetHost) >= 0;
    } catch (_) {
      return false;
    }
  }

  function sameSiteTarget(rawTarget) {
    const targetHost = hostOf(rawTarget);
    return !targetHost || sameParty(targetHost, location.hostname);
  }

  function blankPopupTarget(rawTarget) {
    const s = String(rawTarget == null ? '' : rawTarget).trim();
    return !s || /^about:(blank|srcdoc)(?:[?#]|$)/i.test(s);
  }

  // A non-reserved target can name an iframe/frame that already belongs to the
  // current document. Navigating that browsing context is not a popup: video
  // sites commonly use it to switch streaming providers. Keep the lookup
  // bounded and attribute-based so unusual target names never become selectors.
  function existingNamedFrameTarget(rawName) {
    const name = String(rawName == null ? '' : rawName).trim();
    if (!name || /^_(?:blank|self|parent|top)$/i.test(name)) return false;
    for (const tag of ['iframe', 'frame']) {
      let frames;
      try { frames = document.getElementsByTagName(tag); } catch (_) { continue; }
      const max = Math.min((frames && frames.length) || 0, 200);
      for (let i = 0; i < max; i++) {
        const frame = frames[i];
        try {
          if (frame && frame.isConnected !== false
              && String((frame.getAttribute && frame.getAttribute('name')) || frame.name || '') === name) {
            return true;
          }
        } catch (_) {}
      }
    }
    return false;
  }

  function openerIsolationRequested(rawValue) {
    const features = String(rawValue || '');
    const token = /(?:^|[\s,])(noopener|noreferrer)(?:\s*=\s*([^\s,]*))?(?=$|[\s,])/ig;
    let match;
    while ((match = token.exec(features))) {
      const value = match[2];
      if (value == null || value === '' || !/^(?:0|false|no|off)$/i.test(value)) return true;
    }
    return false;
  }

  // The "your browser is out of date -- install this one to keep watching" funnel.
  // It is an affiliate page, not malware, but it is reached by force and it exists
  // to get software installed, so it is a destination no click ever really asked
  // for. Two shapes, both distinctive:
  //   - a "preland"/"prelander" path. That is ad-industry jargon for the page shown
  //     before the real offer; ordinary sites do not serve anything called that.
  //   - a hostname that is itself a sales pitch for a browser.
  function fakeInstallLander(host, raw) {
    let path = '';
    try { path = new URL(String(raw || ''), location.href).pathname.toLowerCase(); } catch (_) { path = ''; }
    if (/(?:^|\/)pre-?land(?:er|ing)?(?:\/|$)/.test(path)) return true;
    return /(?:^|[.-])(?:boost|speed|fast|turbo|update|install|get|download|secure|safe|best|new)[-_]?(?:you|your|my|the)?[-_]?browsers?(?:[.-]|$)/i
      .test(String(host || ''));
  }

  function suspiciousRedirectTarget(rawTarget) {
    const targetHost = hostOf(rawTarget);
    if (!targetHost) return false;
    const raw = String(rawTarget || '');
    if (/^xn--/i.test(targetHost) || /^\d{1,3}(\.\d{1,3}){3}$/.test(targetHost)) return true;
    // Abuse-prone TLD set -- kept a SUPERSET of the download-guard throwaway list (background.js)
    // and content.min.js's chain heuristic so the outer popup/redirect shield never lags behind
    // the inner layers. .zip/.mov are filename-confusable; the rest are bulk-registered malvertising/
    // malware TLDs.
    if (/\.(zip|mov|cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|mom|hair|tattoo|skin|beauty|makeup|bond|autos|boats|christmas)$/i.test(targetHost)) return true;
    if (/(^|\.)(popads|popcash|propellerads|adsterra|hilltopads|exoclick|juicyads|trafficjunky|mgid|revcontent|adcash|clickadu|ad-maven|admaven|onclickads|onclicka|popmyads|adnxs|popunder[a-z]*|bidvertiser|clickaine|adskeeper|galaksion|coinzilla|adexchangeprime|hookgate|adventurefeeds)\.[a-z.]+$/i.test(targetHost)) return true;
    // A redirect that carries its real destination as a parameter arrives percent-
    // encoded, so "utm_source%3Dads" never matched "utm_source=ad" and neither did
    // an encoded aff_id or clickid. That is the ORDINARY shape of an ad hop, not an
    // edge case, so the decoded form has to be tested as well as the raw one.
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (_) { decoded = raw; }
    if (/(adurl|popunder|onclickad|campaign|aff_id|affiliate|clickid|utm_source=ad|doubleclick|adservice|taboola|outbrain)/i.test(raw + ' ' + decoded)) return true;
    if (fakeInstallLander(targetHost, raw)) return true;
    return false;
  }

  function freshGesture() {
    return Date.now() - lastGestureAt < gestureWindowMs();
  }

  function blankPopupAllowanceAvailable(requireAuthIntent) {
    if (!freshGesture() || lastGestureTainted || nonExplicitPopupSpent) return false;
    if (requireAuthIntent && !authIntentAllows()) return false;
    return true;
  }

  function consumeBlankPopupAllowance(requireAuthIntent) {
    if (!blankPopupAllowanceAvailable(requireAuthIntent)) return false;
    nonExplicitPopupSpent = true;
    return true;
  }

  function explicitUrlFromElement(el) {
    if (!el || !el.closest) return '';
    const a = el.closest('a[href],area[href]');
    if (a) {
      const href = String(a.getAttribute('href') || '').trim();
      if (href && !/^(#|javascript:|void\()/i.test(href)) return a.href || href;
    }
    const submitter = el.closest('button,input');
    if (submitter) {
      const formaction = String(submitter.getAttribute('formaction') || '').trim();
      if (formaction) return submitter.formAction || formaction;
    }
    const form = el.closest('form[action]');
    if (form) {
      const action = String(form.getAttribute('action') || '').trim();
      if (action) return form.action || action;
    }
    return '';
  }

  function coordsOf(event) {
    if (!event) return null;
    if (typeof event.clientX === 'number' && (event.clientX !== 0 || event.clientY !== 0)) {
      return { x: event.clientX, y: event.clientY };
    }
    const t = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    if (t && typeof t.clientX === 'number') return { x: t.clientX, y: t.clientY };
    return null;
  }

  // Is this viewport point inside a rendered media/player surface? Runs only on
  // pointer gestures (never keystrokes). Prefer the actual hit stack and only
  // fall back to native media/embed rectangles; class names such as "player"
  // and "stream" are far too broad to authorize cancelling a real click.
  function pointOnVideo(x, y) {
    try {
      if (typeof document.elementsFromPoint === 'function') {
        const stack = document.elementsFromPoint(x, y).slice(0, 16);
        for (const el of stack) {
          if (!el || !el.tagName) continue;
          if (/^(VIDEO|IFRAME|EMBED|OBJECT)$/.test(el.tagName)) return true;
          if (el.closest && el.closest('video,iframe,embed,object')) return true;
        }
      }
    } catch (_) {}
    const tags = ['video', 'iframe', 'embed', 'object'];
    for (let t = 0; t < tags.length; t++) {
      let els;
      try { els = document.getElementsByTagName(tags[t]); } catch (_) { continue; }
      const max = Math.min(els.length || 0, 12);
      for (let i = 0; i < max; i++) {
        let r;
        try { r = els[i].getBoundingClientRect(); } catch (_) { continue; }
        if (r && r.width > 80 && r.height > 60 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
    }
    return false;
  }

  function markIntent(event) {
    if (event && event.isTrusted === false) return;
    // Plain typing keystrokes don't start navigations/popups — skip the expensive
    // closest()/text intent computation (innerText forced a layout reflow per keystroke).
    if (event && event.type === 'keydown') {
      const k = event.key;
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
      // Keyboard activation is a new, untainted gesture with a fresh popup allowance.
      lastGestureTainted = false;
      nonExplicitPopupSpent = false;
    }
    lastGestureAt = Date.now();
    const target = event && event.target && event.target.nodeType === 1 ? event.target : document.activeElement;
    const isPress = !!event && (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'touchstart');
    if (isPress) {
      nonExplicitPopupSpent = false;
      pressAnchor = target && target.closest ? target.closest('a[href],area[href]') : null;
      pressAnchorHost = '';
      pressAnchorHref = '';
      if (pressAnchor) {
        try {
          pressAnchorHref = String(pressAnchor.href || pressAnchor.getAttribute('href') || '');
          pressAnchorHost = hostOf(pressAnchorHref);
        } catch (_) {}
      }
    }
    const pt = coordsOf(event);
    if (pt) {
      let onPlayer = false;
      try { onPlayer = !!(target && target.closest && target.closest('video,audio')); } catch (_) {}
      lastGestureTainted = onPlayer || pointOnVideo(pt.x, pt.y);
    }
    const explicitUrl = explicitUrlFromElement(target);
    intendedHost = explicitUrl ? hostOf(explicitUrl) : regHost(location.hostname);
    intentWasExplicit = !!(explicitUrl && intendedHost);
    // Only when the click landed on a player AND targeted no URL of its own. A
    // thumbnail that is genuinely a link around an iframe sets intentWasExplicit,
    // so it never raises this -- which is the whole reason the worker can act on
    // it without cancelling ordinary navigation.
    if (frameTopRedirectEnabled()) {
      if (lastGestureTainted && !intentWasExplicit) signal('player-gesture');
      // Separately, and regardless of what was clicked: the worker cannot tell a
      // forced redirect from one the user asked for, and "did anything at all
      // happen in this tab just now" is the difference.
      //
      // Except when the click was harvested. A click on a bare overlay control with
      // no destination of its own is exactly what a fake confirm dialog is built to
      // collect, so it does not get to authorise a cross-site jump. A real link or
      // button inside an overlay still does, because it names where it goes -- and
      // a genuine navigation the page drives still announces itself separately
      // through top-nav-authorized, so nothing legitimate depends on this beacon.
      const overlay = intentWasExplicit ? null : gestureOnOverlay(target);
      if (!overlay) signal('gesture');
      else if (confirmBaitOverlay(overlay)) {
        emit('warned_confirm_bait', {
          matched: String(lastIntentText || '').slice(0, 40),
          silent: true,
        });
      }
    }
    lastIntentStructural = false;
    try {
      const el = target && target.closest ? target.closest('a,button,input,[role="button"],[tabindex]') : target;
      lastIntentText = [
        el && (el.textContent || ''),
        el && el.getAttribute && el.getAttribute('aria-label'),
        el && el.getAttribute && el.getAttribute('title'),
        el && el.getAttribute && el.getAttribute('value'),
        el && el.id,
        el && typeof el.className === 'string' ? el.className : '',
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 240);
      // Structural login intent covers icon-only controls that carry no login
      // text: a control inside a form with a password field, or an OAuth
      // "sign in with X" button recognisable from its OWN attributes (never the
      // destination URL). Icon-only login buttons were the remaining same-tab
      // SSO false-positive after the federationUrlShape widening.
      const form = el && el.closest ? el.closest('form') : null;
      if (form && form.querySelector('input[type="password"]')) {
        lastIntentStructural = true;
      } else {
        const hint = [
          el && typeof el.className === 'string' ? el.className : '',
          el && el.getAttribute && el.getAttribute('data-provider'),
          el && el.getAttribute && el.getAttribute('data-testid'),
          el && el.getAttribute && el.getAttribute('data-a-target'),
        ].filter(Boolean).join(' ').toLowerCase();
        lastIntentStructural = /(oauth|openid|\bsso\b|saml|federat|\bidp\b|(?:sign|log)[ -]?in|social-?login|\bauth\b)/.test(hint)
          && /(google|microsoft|azure|apple|github|gitlab|facebook|okta|auth0|onelogin|ping|shibboleth|\bcas\b|saml|oidc|\bsso\b)/.test(hint);
      }
    } catch (_) {
      lastIntentText = '';
      lastIntentStructural = false;
    }
  }

  // Did the user click a control that clearly reads as a login/checkout action?
  // Matches the clicked element's own text/labels or login STRUCTURE (password
  // form / OAuth provider button) -- NEVER the target URL (ad URLs literally
  // contain words like "redirect"/"continue").
  function intentTextAllows() {
    return lastIntentStructural
      || /\b(log[ -]?in|sign[ -]?in|sign[ -]?up|register|oauth|sso|account|verify|verification|checkout|pay|payment|billing|subscribe|donate|authorize|continue)\b/i.test(lastIntentText);
  }

  function authIntentAllows() {
    return lastIntentStructural
      || /\b(log[ -]?in|sign[ -]?in|sign[ -]?up|register|oauth|sso|account|verify|verification|checkout|pay|payment|billing|authorize)\b/i.test(lastIntentText);
  }

  function navigationTargetAllowed(rawTarget) {
    const targetHost = hostOf(rawTarget);
    if (!targetHost) return true;
    if (sameParty(targetHost, location.hostname)) return true;
    // Distinctive SAML/OIDC/CAS plumbing may redirect without an immediately
    // visible click. A brand-like hostname alone is not enough for that bypass.
    if (federationUrlShape(rawTarget)) return true;
    if (!freshGesture()) return false;
    if (isTrustedHost(targetHost)) return true;
    if (lastGestureTainted) return false;
    if (intentWasExplicit && intendedHost && sameParty(targetHost, intendedHost)) return true;
    if (suspiciousRedirectTarget(rawTarget)) return false;
    // Same-tab redirects (and cross-window form posts): a gesture on a plain
    // element is NOT enough -- the control must clearly read as login/checkout.
    return !intentWasExplicit && !pageHostile() && intentTextAllows();
  }

  function emit(type, detail) {
    const payload = { type, detail: detail || {}, at: Date.now() };
    if (!token) {
      queuedEvents.push(payload);
      if (queuedEvents.length > 8) queuedEvents.shift();
      return;
    }
    try {
      document.dispatchEvent(new CustomEvent('wo-event', {
        detail: Object.assign({ token }, payload),
      }));
    } catch (_) {}
  }

  function flushEvents() {
    if (!token || !queuedEvents.length) return;
    const events = queuedEvents.slice();
    queuedEvents = [];
    events.forEach((event) => emit(event.type, event.detail));
  }

  function blockNavigation(rawTarget, kind) {
    // Reaching this function at all means the TOP frame drove the navigation, so
    // every path that lets one through has to say so -- otherwise the worker sees
    // a top-frame navigation it cannot attribute and treats ours as a hijack.
    if (!navigationEnabled()) {
      if (!sameSiteTarget(rawTarget)) signal('top-nav-authorized');
      return false;
    }
    if (sameSiteTarget(rawTarget)) return false;
    if (navigationTargetAllowed(rawTarget)) {
      signal('top-nav-authorized');
      return false;
    }
    markHostile();
    const targetHost = hostOf(rawTarget);
    const gestured = freshGesture();
    const sameTabKind = kind === 'assign' || kind === 'replace' || kind === 'href';
    // Silent = the user keeps the page they were on. The interstitial (raised
    // by the bridge when silent is false) is reserved for ambiguous same-tab
    // cases where "Continue" might genuinely be wanted.
    const silent = !gestured || !sameTabKind || lastGestureTainted || suspiciousRedirectTarget(rawTarget);
    emit('blocked_gestureless_nav', {
      kind,
      url: String(rawTarget || '').slice(0, 500),
      matched: targetHost,
      why: gestured
        ? (intentWasExplicit ? 'click did not target this site' : 'forced redirect after a click')
        : 'no recent user gesture',
      silent,
    });
    return true;
  }

  function corePopupPolicy(rawTarget, context) {
    if (!popupEnabled()) return false;
    if (blankPopupTarget(rawTarget)) {
      // Real OAuth/SSO SDKs reserve a blank WindowProxy synchronously from a
      // recognisable auth/payment control. A generic click gets an inert handle
      // instead, so it cannot be navigated to an ad after this hook returns.
      return blankPopupAllowanceAvailable(true) ? false : 'non-auth staged blank popup';
    }
    const targetHost = hostOf(rawTarget);
    if (!freshGesture()) return 'no recent user gesture';
    if (!targetHost || sameParty(targetHost, location.hostname)) return false;
    if (suspiciousRedirectTarget(rawTarget)) return 'confirmed suspicious popup target';
    if (intentWasExplicit && intendedHost && sameParty(targetHost, intendedHost)) return false;
    if ((isTrustedHost(targetHost) || federationUrlShape(rawTarget)) && authIntentAllows()) return false;
    if (strictPopupEnabled()) {
      if (lastGestureTainted && !authIntentAllows()) return 'popup triggered by a player/media click';
      // Ad-supported embeds often attach a popup to an otherwise legitimate
      // server/play control.  The popup must be blocked without treating that
      // control as permission to open an unrelated site.
      if (playerDocument() && !authIntentAllows()) return 'cross-site popup triggered by a player page';
      if (pageHostile() && !authIntentAllows()) return 'popup retry after a blocked hijack';
    }
    if (!intentWasExplicit) {
      if (nonExplicitPopupSpent) return 'more than one popup from one gesture';
    }
    return false;
  }

  // Install the protected core entry directly. Public register/unregister calls
  // cannot replace it, even when the guarded page is actively adversarial.
  popupMatcherEntries.set('core:popup-policy', corePopupPolicy);

  function popupBlockMatch(rawTarget) {
    if (!masterEnabled()) return null;
    const match = popupMatcherApi.match(rawTarget, {
      topFrame: TOP_FRAME,
      freshGesture: freshGesture(),
      strict: strictPopupEnabled(),
      playerGesture: lastGestureTainted,
      explicitIntent: intentWasExplicit,
      intendedHost,
      authIntent: authIntentAllows(),
    });
    if (match) return match;

    // Registry matching is public and therefore deliberately side-effect-free.
    // Spend the single-use allowance only when our own window.open hook is
    // actually about to hand a real popup through to the native implementation.
    if (popupEnabled()) {
      if (blankPopupTarget(rawTarget)) {
        consumeBlankPopupAllowance(true);
      } else {
        const targetHost = hostOf(rawTarget);
        if (targetHost && !sameParty(targetHost, location.hostname) && !intentWasExplicit) {
          nonExplicitPopupSpent = true;
        }
      }
    }
    return null;
  }

  function noteBlockedPopup(rawTarget, match) {
    markHostile();
    emit('blocked_popup', {
      kind: 'open',
      url: String(rawTarget || '').slice(0, 500),
      matched: hostOf(rawTarget),
      why: (match && match.reason) || 'popup policy',
      matcher: match && match.id,
      silent: true,
    });
  }

  function inertWindowFacade(temporarilyOpen) {
    const openedAt = Date.now();
    let explicitlyClosed = !temporarilyOpen;
    const documentFacade = {
      body: null,
      documentElement: null,
      open() { return this; },
      close() {},
      write() {},
      writeln() {},
    };
    const locationFacade = {
      assign() {},
      replace() {},
      reload() {},
      toString() { return 'about:blank'; },
    };
    try {
      Object.defineProperty(locationFacade, 'href', {
        configurable: false,
        enumerable: true,
        get() { return 'about:blank'; },
        set(_value) {},
      });
    } catch (_) {}
    const facade = {
      opener: null,
      length: 0,
      location: locationFacade,
      document: documentFacade,
      close() { explicitlyClosed = true; },
      focus() {},
      blur() {},
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    };
    try {
      Object.defineProperty(facade, 'location', {
        configurable: false,
        enumerable: true,
        get() { return locationFacade; },
        set(_value) {},
      });
    } catch (_) {}
    try {
      Object.defineProperty(facade, 'closed', {
        configurable: false,
        enumerable: true,
        // A short-lived open-looking handle prevents ad-gated players from
        // aborting on `!popup || popup.closed`.  It never owns a real browsing
        // context and every navigation/document method above remains inert.
        get() { return explicitlyClosed || (temporarilyOpen && Date.now() - openedAt > 1500); },
      });
    } catch (_) {
      facade.closed = !temporarilyOpen;
    }
    facade.window = facade;
    facade.self = facade;
    facade.top = facade;
    facade.parent = facade;
    facade.frames = facade;
    try { Object.defineProperty(facade, Symbol.toStringTag, { value: 'Window' }); } catch (_) {}
    return facade;
  }

  function popupAnchorOwnsPlayer(anchor) {
    try {
      return !!(anchor && anchor.querySelector && anchor.querySelector('video,audio,iframe,embed,object'));
    } catch (_) {
      return false;
    }
  }

  function neutralizePopupOverlay(anchor, event) {
    if (!anchor) return;
    try {
      if (anchor.style && anchor.style.setProperty) anchor.style.setProperty('pointer-events', 'none', 'important');
      if (anchor.setAttribute) anchor.setAttribute('data-wardenone-blocked-popup-overlay', 'true');
    } catch (_) {}

    // When the ad link sat over a real control, preserve this same activation
    // instead of making the user click twice.  Links/iframes are deliberately
    // excluded: only an underlying button or native media element is invoked.
    const pt = coordsOf(event);
    if (!pt || typeof document.elementsFromPoint !== 'function') return;
    let stack = [];
    try { stack = document.elementsFromPoint(pt.x, pt.y).slice(0, 16); } catch (_) { return; }
    for (const el of stack) {
      if (!el || el === anchor) continue;
      try { if (anchor.contains && anchor.contains(el)) continue; } catch (_) {}
      let control = null;
      try {
        control = el.closest ? el.closest('button,[role="button"],video,audio,[tabindex]') : null;
      } catch (_) {}
      if (!control || control === anchor || typeof control.click !== 'function') continue;
      try { control.click(); } catch (_) {}
      break;
    }
  }

  ['pointerdown', 'mousedown', 'click', 'auxclick', 'keydown', 'touchstart', 'touchend'].forEach((name) => {
    try { woOn(window, name, markIntent, true); } catch (_) {}
  });

  // Click-layer guard: cancels hijack clicks whose default action navigates
  // natively (so the window.open/location hooks below never see them).
  function guardClick(event) {
    if (!masterEnabled()) return;
    const el = event && event.target && event.target.nodeType === 1 ? event.target : null;
    const a = el && el.closest ? el.closest('a[href],area[href]') : null;
    if (!a) return;
    let raw = '';
    try { raw = String(a.href || a.getAttribute('href') || ''); } catch (_) {}
    let opensPopup = false;
    let namedFrameNavigation = false;
    try {
      const rawTargetName = String((a.getAttribute && a.getAttribute('target')) || a.target || '').trim();
      const t = rawTargetName.toLowerCase();
      const rel = String((a.getAttribute && a.getAttribute('rel')) || a.rel || '');
      namedFrameNavigation = existingNamedFrameTarget(rawTargetName) && !openerIsolationRequested(rel);
      opensPopup = !!(t && t !== '_self' && t !== '_top' && t !== '_parent');
    } catch (_) {}
    // Let a real, already-present player frame receive its provider switch.
    // Missing custom targets and `_blank` continue through popup scrutiny.
    if (namedFrameNavigation) return;
    const host = hostOf(raw);
    const cancel = (why, silent, popupClick) => {
      try { event.preventDefault(); } catch (_) {}
      // A hijack click means hostile page: taint the gesture and drop any
      // "explicit intent" markIntent derived from the hijacking link, so the
      // page can't replay the same destination through window.open/assign.
      markHostile();
      lastGestureTainted = true;
      intentWasExplicit = false;
      intendedHost = regHost(location.hostname);
      emit(popupClick ? 'blocked_popup' : 'blocked_gestureless_nav', {
        kind: 'click',
        url: raw.slice(0, 500),
        matched: host,
        why,
        silent: !!silent,
      });
    };

    // Native target=_blank anchors do not pass through window.open. Keep this
    // branch popup-only, and never consume the underlying media/iframe click.
    if (opensPopup) {
      if (!host && blankPopupTarget(raw)) {
        if (!popupEnabled()) return;
        if (event.isTrusted !== false && consumeBlankPopupAllowance(false)) return;
        return cancel('blank popup opened from the page', true, true);
      }
      if (!host || sameParty(host, location.hostname)) return;
      if ((isTrustedHost(host) || federationUrlShape(raw)) && authIntentAllows()) return;
      const pt = coordsOf(event);
      const coversPlayer = !!(strictPopupEnabled() && pt && pointOnVideo(pt.x, pt.y) && !popupAnchorOwnsPlayer(a));
      const matcherHit = popupMatcherApi.match(raw, {
        nativeAnchor: true,
        topFrame: TOP_FRAME,
        freshGesture: freshGesture(),
        strict: strictPopupEnabled(),
        playerGesture: lastGestureTainted,
        explicitIntent: true,
        intendedHost: host,
        authIntent: authIntentAllows(),
      });
      if (matcherHit) {
        if (coversPlayer) {
          try { event.stopImmediatePropagation(); } catch (_) {}
          neutralizePopupOverlay(a, event);
        }
        return cancel('popup matcher: ' + matcherHit.reason, true, true);
      }
      if (!popupEnabled()) return;
      if (event.isTrusted === false) {
        let isDownload = false;
        try { isDownload = !!(a.hasAttribute && a.hasAttribute('download')); } catch (_) {}
        if (isDownload && !suspiciousRedirectTarget(raw)) return;
        return cancel('page-generated popup link', true, true);
      }
      if (!strictPopupEnabled()) return;
      if (coversPlayer) {
        try { event.stopImmediatePropagation(); } catch (_) {}
        neutralizePopupOverlay(a, event);
        return cancel('a cross-site popup link was layered over the video player', true, true);
      }
      let rect = null;
      let opacity = 1;
      try { rect = a.getBoundingClientRect(); } catch (_) {}
      try {
        const cs = getComputedStyle(a);
        const own = Number(cs && cs.opacity);
        if (own >= 0) opacity = own;
        const p = a.parentElement;
        if (p) {
          const po = Number(getComputedStyle(p).opacity);
          if (po >= 0) opacity = Math.min(opacity, po);
        }
      } catch (_) {}
      if (suspiciousRedirectTarget(raw)) return cancel('confirmed suspicious popup link', true, true);
      if (opacity < 0.05) return cancel('invisible cross-site popup link', true, true);
      if (rect && rect.width > 0 && rect.height > 0) {
        const vw = Math.max(1, window.innerWidth || 1);
        const vh = Math.max(1, window.innerHeight || 1);
        const cover = (Math.min(rect.width, vw) * Math.min(rect.height, vh)) / (vw * vh);
        if (cover >= 0.6) return cancel('a popup link was covering the page', true, true);
      }
      return;
    }

    // Same-tab anchor scrutiny belongs only to the top-frame redirect feature.
    // Subframes keep all of their own location, form, and media navigation native.
    if (!navigationEnabled()) return;
    if (!host || sameParty(host, location.hostname) || isTrustedHost(host) || federationUrlShape(raw)) return;
    if (event.isTrusted === false) {
      let isDownload = false;
      try { isDownload = !!(a.hasAttribute && a.hasAttribute('download')); } catch (_) {}
      if (isDownload && !suspiciousRedirectTarget(raw)) return;
      return cancel('page-generated click on a cross-site link', true, false);
    }
    // Bait-and-switch: the link under the pointer changed destination between
    // press and click.
    // Bait-and-switch is only a hijack if BOTH the shown and the swapped-to hosts are
    // external to the current page. Search engines / social sites legitimately rewrite
    // outbound links around mousedown for click tracking -- either wrapping the real URL
    // in a same-origin redirector (google.com/url?q=, bing.com/ck/a, duckduckgo.com/l/,
    // l.facebook.com, linkedin.com/redir) or un-wrapping it back to the real destination
    // on press. Either side being same-party with the current page = tracking, not a
    // hijack, so don't cancel it (this was eating the FIRST click on search results).
    if (pressAnchor && a === pressAnchor && pressAnchorHost && host !== pressAnchorHost
        && !sameParty(host, pressAnchorHost)
        && !sameParty(host, location.hostname) && !sameParty(pressAnchorHost, location.hostname)
        && !redirectWrapperPointsAt(pressAnchorHref, raw)
        && !redirectWrapperPointsAt(raw, pressAnchorHref)) {
      return cancel('link changed destination after you pressed it', false, false);
    }
    let rect = null;
    let opacity = 1;
    try { rect = a.getBoundingClientRect(); } catch (_) {}
    try {
      const cs = getComputedStyle(a);
      const own = Number(cs && cs.opacity);
      if (own >= 0) opacity = own;
      const p = a.parentElement;
      if (p) {
        const po = Number(getComputedStyle(p).opacity);
        if (po >= 0) opacity = Math.min(opacity, po);
      }
    } catch (_) {}
    const suspicious = suspiciousRedirectTarget(raw);
    if (opacity < 0.05) return cancel('invisible cross-site link', true, false);
    if (rect && rect.width > 0 && rect.height > 0) {
      const vw = Math.max(1, window.innerWidth || 1);
      const vh = Math.max(1, window.innerHeight || 1);
      const cover = (Math.min(rect.width, vw) * Math.min(rect.height, vh)) / (vw * vh);
      if (cover >= 0.6) return cancel('a link covering the page pointed at a different site', false, false);
      const pt = coordsOf(event);
      if (pt && suspicious && pointOnVideo(pt.x, pt.y)) {
        return cancel('a suspicious link was layered over the video player', true, false);
      }
    }
  }
  try { woOn(window, 'click', guardClick, true); } catch (_) {}
  try { woOn(window, 'auxclick', guardClick, true); } catch (_) {}

  try {
    const realOpen = window.open;
    window.open = function (url, name, features) {
      const rawTarget = url || 'about:blank';
      if (existingNamedFrameTarget(name) && !openerIsolationRequested(features)) {
        return realOpen.apply(this, arguments);
      }
      const match = popupBlockMatch(rawTarget);
      if (match) {
        noteBlockedPopup(rawTarget, match);
        return inertWindowFacade(playerDocument());
      }
      return realOpen.apply(this, arguments);
    };
  } catch (_) {}

  if (TOP_FRAME) try {
    const proto = Location.prototype;
    const realAssign = proto.assign;
    const realReplace = proto.replace;
    proto.assign = function (url) {
      if (blockNavigation(url, 'assign')) return undefined;
      return realAssign.call(this, url);
    };
    proto.replace = function (url) {
      if (blockNavigation(url, 'replace')) return undefined;
      return realReplace.call(this, url);
    };
    const hrefDesc = Object.getOwnPropertyDescriptor(window.location, 'href') || Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (hrefDesc && hrefDesc.set) {
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        enumerable: true,
        get() { return hrefDesc.get ? hrefDesc.get.call(this) : String(location); },
        set(value) {
          if (blockNavigation(value, 'href')) return;
          hrefDesc.set.call(this, value);
        },
      });
    }
  } catch (_) {}

  // A normal same-tab, top-frame form POST (login -> SSO/auth, multi-step checkout, search)
  // navigates THIS tab and is legitimate -- silently cancelling it broke niche SSO/payment flows.
  // The actual threats here are popunder window.open and gestureless cross-site redirects, NOT a
  // top-frame form the user submitted. So we no longer block same-tab top-frame submits; only
  // top-frame forms that open a NEW window (target=_blank / an unresolved named target) keep scrutiny.
  // Child-frame forms are deliberately left native by this lightweight popup-only layer.
  function formStaysInTab(form) {
    try {
      if (window.top !== window.self) return false;
      const rawTargetName = String((form && form.getAttribute && form.getAttribute('target')) || (form && form.target) || '').trim();
      const t = rawTargetName.toLowerCase();
      if (t && t !== '_self' && t !== '_top' && t !== '_parent') {
        const rel = String((form && form.getAttribute && form.getAttribute('rel')) || (form && form.rel) || '');
        if (!existingNamedFrameTarget(rawTargetName) || openerIsolationRequested(rel)) return false;
      }
      return true;
    } catch (_) { return false; }
  }

  function isFederationForm(form) {
    try {
      if (!form || !form.querySelector) return false;
      return !!form.querySelector('input[name="SAMLRequest"],input[name="SAMLResponse"],input[name="RelayState"],input[name="client_id"],input[name="response_type"]');
    } catch (_) {
      return false;
    }
  }
  if (TOP_FRAME) try {
    const realSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      const action = this && this.action ? this.action : location.href;
      if (!formStaysInTab(this) && !isFederationForm(this) && blockNavigation(action, 'form-submit')) return undefined;
      return realSubmit.apply(this, arguments);
    };
    woOn(window, 'submit', (event) => {
      const form = event && event.target;
      if (formStaysInTab(form) || isFederationForm(form)) return; // native same-tab and federation POSTs
      const action = form && form.action ? form.action : location.href;
      if (!blockNavigation(action, 'submit-event')) return;
      try {
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch (_) {}
    }, true);
  } catch (_) {}

  try {
    const baitObserver = woObserver((records) => {
      if (!confirmBaitEnabled() || baitRemoved >= BAIT_REMOVE_CAP) return;
      let queued = false;
      for (const rec of records) {
        const added = rec.addedNodes || [];
        for (let i = 0; i < added.length && baitPending.size < 40; i++) {
          const node = added[i];
          if (node && node.nodeType === 1) { baitPending.add(node); queued = true; }
        }
      }
      if (queued) scheduleConfirmBaitSweep(60);
    });
    baitObserver.observe(document.documentElement || document, { childList: true, subtree: true });
    // The observer alone was not enough, for two reasons that both bite once.
    // The config arrives by message AFTER this script starts, and until it does
    // masterEnabled() is false -- so a box inserted early was seen, refused, and
    // never looked at again, because insertion only happens once. And a box that is
    // hidden and re-shown adds no nodes at all. A short bounded schedule covers
    // both without an interval running for the life of the page.
    for (const delay of [120, 350, 800, 2000, 4000, 8000, 15000]) {
      woTimeout(() => { baitPending.clear(); sweepConfirmBait(); }, delay);
    }
  } catch (_) {}

  /* CREDENTIAL_FRAME_GUARD_START
     The full protection engine stays in the top frame: parsing all of it into every
     advertising, media and application frame would be a large permanent cost. This
     narrow layer runs only in child frames and owns the credential-facing boundary
     the top document cannot see. It remembers bounded card/password/token values in
     this realm and blocks an exact value when it is sent to an unrelated destination.
     No value is emitted, persisted or handed to the isolated bridge. */
  const CREDENTIAL_FRAME_VALUE_LIMIT = 80;
  const CREDENTIAL_FRAME_TRUSTED_BASES = new Set([
    'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
    'microsoft.com', 'microsoftonline.com', 'msauth.net', 'msftauth.net', 'live.com',
    'apple.com', 'icloud.com', 'cdn-apple.com', 'paypal.com', 'paypalobjects.com',
    'stripe.com', 'stripe.network', 'braintreegateway.com', 'braintreepayments.com',
    'braintree-api.com', 'adyen.com', 'adyenpayments.com', 'checkout.com',
    'hcaptcha.com', 'recaptcha.net', 'arkoselabs.com', 'funcaptcha.com',
  ]);
  const credentialFrameValues = new Map();
  const credentialFrameXhrs = new WeakMap();
  let credentialFrameLastFieldScan = 0;
  let credentialFrameBlocked = 0;
  let credentialFrameTokensSeeded = false;

  function credentialFrameEnabled(key) {
    const c = cfg();
    return !TOP_FRAME
      && window.__wardenOneAntiRedirectHardener === WO_GUARD_VERSION
      && c.enabled !== false
      && c[key] !== false
      && !hostAllowedByUser();
  }

  function credentialFrameBaseUrl() {
    const candidates = [];
    try { candidates.push(document.baseURI); } catch (_) {}
    try { candidates.push(location.href); } catch (_) {}
    try { candidates.push(document.referrer); } catch (_) {}
    for (const candidate of candidates) {
      try {
        const parsed = new URL(String(candidate || ''));
        if (/^https?:$/.test(parsed.protocol)) return parsed.href;
      } catch (_) {}
    }
    return '';
  }

  function credentialFrameSourceHost() {
    try { return regHost(new URL(credentialFrameBaseUrl()).hostname); } catch (_) { return ''; }
  }

  function credentialFrameTarget(rawTarget) {
    try {
      const base = credentialFrameBaseUrl();
      if (!base) return null;
      const parsed = new URL(String(rawTarget || base), base);
      if (!/^(?:https?|wss?):$/.test(parsed.protocol)) return null;
      const sourceHost = credentialFrameSourceHost();
      const targetHost = regHost(parsed.hostname);
      if (!sourceHost || !targetHost || sameParty(sourceHost, targetHost)) return null;
      return { url: parsed, host: targetHost, sourceHost };
    } catch (_) {
      return null;
    }
  }

  function credentialFrameTrustedHost(host) {
    const clean = regHost(host);
    if (!clean) return false;
    for (const base of CREDENTIAL_FRAME_TRUSTED_BASES) {
      if (hostMatchesSite(clean, base)) return true;
    }
    return false;
  }

  function credentialFrameLuhn(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = Number(digits.charAt(i));
      if (!Number.isFinite(n)) return false;
      if (alternate) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  function credentialFrameFieldKind(field) {
    try {
      if (!field || !/^(?:INPUT|TEXTAREA)$/.test(String(field.tagName || '').toUpperCase())) return '';
      const type = String(field.type || '').toLowerCase();
      const hint = [field.name, field.id, field.autocomplete, field.placeholder,
        field.getAttribute && field.getAttribute('aria-label')].join(' ').toLowerCase();
      if (type === 'password') return 'password';
      if (/cc-|card|credit|debit|cardnumber|ccnum|(?:^|\W)pan(?:\W|$)|cvc|cvv|security.?code/.test(hint)) return 'card';
    } catch (_) {}
    return '';
  }

  function credentialFrameRemember(value, kind) {
    try {
      let clean = String(value == null ? '' : value).trim();
      if (!clean || clean.length > 2048) return;
      if (kind === 'card') {
        clean = clean.replace(/\D/g, '');
        if (!credentialFrameLuhn(clean)) return;
      } else if (kind === 'password') {
        if (clean.length < 6 || clean.length > 512) return;
      } else if (kind === 'token') {
        clean = clean.replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '');
        if (clean.length < 16 || clean.length > 1024) return;
      } else {
        return;
      }
      if (credentialFrameValues.has(clean)) credentialFrameValues.delete(clean);
      credentialFrameValues.set(clean, kind);
      while (credentialFrameValues.size > CREDENTIAL_FRAME_VALUE_LIMIT) {
        credentialFrameValues.delete(credentialFrameValues.keys().next().value);
      }
    } catch (_) {}
  }

  function credentialFrameRememberField(field) {
    const kind = credentialFrameFieldKind(field);
    if (!kind) return;
    if (kind === 'password' && !credentialFrameEnabled('detectSkimmers')) return;
    if (kind === 'card' && !credentialFrameEnabled('detectSkimmers')
        && !credentialFrameEnabled('paymentCardGuard')) return;
    credentialFrameRemember(field.value, kind);
  }

  function credentialFrameScanFields(root, force) {
    try {
      const now = Date.now();
      if (!force && now - credentialFrameLastFieldScan < 250) return;
      credentialFrameLastFieldScan = now;
      const fields = (root && root.querySelectorAll ? root : document).querySelectorAll('input,textarea');
      const max = Math.min((fields && fields.length) || 0, 120);
      for (let i = 0; i < max; i++) credentialFrameRememberField(fields[i]);
    } catch (_) {}
  }

  function credentialFrameSensitiveKey(key) {
    const normalized = String(key || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    if (!normalized || /(?:captcha|challenge|human|verification)_?(?:response|answer)?$/.test(normalized)) return false;
    return /(^|_)(?:token|auth|authorization|session|sess|jwt|bearer|secret|credential|password|passwd)(?:_|$)/.test(normalized)
      || /(^|_)(?:api|private|csrf|xsrf|access|refresh|identity|client)_(?:key|token|secret|id)(?:_|$)/.test(normalized);
  }

  function credentialFrameRememberTokenText(value, key) {
    try {
      const text = String(value == null ? '' : value).trim();
      if (!text || text.length > 8192) return;
      if (credentialFrameSensitiveKey(key)) credentialFrameRemember(text, 'token');
      const matches = text.match(/\b(?:ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/g) || [];
      for (let i = 0; i < Math.min(matches.length, 12); i++) credentialFrameRemember(matches[i], 'token');
    } catch (_) {}
  }

  function credentialFrameSeedTokens() {
    if (credentialFrameTokensSeeded || !credentialFrameEnabled('blockTokenExfil')) return;
    credentialFrameTokensSeeded = true;
    try {
      for (const store of [window.localStorage, window.sessionStorage]) {
        if (!store) continue;
        const max = Math.min(Number(store.length) || 0, 160);
        for (let i = 0; i < max; i++) {
          const key = store.key(i);
          credentialFrameRememberTokenText(store.getItem(key), key);
        }
      }
    } catch (_) {}
    try {
      const cookies = String(document.cookie || '').split(';').slice(0, 160);
      for (const cookie of cookies) {
        const at = cookie.indexOf('=');
        if (at > 0) credentialFrameRememberTokenText(cookie.slice(at + 1), cookie.slice(0, at));
      }
    } catch (_) {}
  }

  function credentialFrameDataText(data) {
    try {
      if (data == null) return '';
      if (typeof data === 'string') return data.slice(0, 1048576);
      if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return data.toString().slice(0, 1048576);
      if (typeof FormData !== 'undefined' && data instanceof FormData) {
        const parts = [];
        data.forEach((value, key) => {
          if (parts.length < 160 && typeof value !== 'object') parts.push(String(key) + '=' + String(value));
        });
        return parts.join('&').slice(0, 1048576);
      }
      if (typeof Headers !== 'undefined' && data instanceof Headers) {
        const parts = [];
        data.forEach((value, key) => { if (parts.length < 160) parts.push(String(key) + ': ' + String(value)); });
        return parts.join('\n').slice(0, 1048576);
      }
      if (typeof ArrayBuffer !== 'undefined' && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
        if ((data.byteLength || 0) > 524288 || typeof TextDecoder === 'undefined') return '';
        return new TextDecoder('utf-8').decode(data).slice(0, 1048576);
      }
      if (typeof data === 'object') return JSON.stringify(data).slice(0, 1048576);
      return String(data).slice(0, 1048576);
    } catch (_) {
      return '';
    }
  }

  function credentialFrameHeadersText(headers) {
    try {
      if (Array.isArray(headers)) return headers.map(credentialFrameHeadersText).join('\n').slice(0, 1048576);
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const parts = [];
        headers.forEach((value, key) => { if (parts.length < 160) parts.push(String(key) + ': ' + String(value)); });
        return parts.join('\n').slice(0, 1048576);
      }
      if (headers && typeof headers === 'object') {
        return Object.keys(headers).slice(0, 160)
          .map((key) => String(key) + ': ' + String(headers[key])).join('\n').slice(0, 1048576);
      }
      return credentialFrameDataText(headers);
    } catch (_) {
      return '';
    }
  }

  function credentialFrameHasToken(text) {
    const haystack = String(text || '');
    if (haystack.length < 16) return false;
    if (/\b(?:ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/.test(haystack)) return true;
    const pair = /(?:^|[?&\n{,;])\s*['"]?([A-Za-z0-9_-]{1,64})['"]?\s*(?:=|:)\s*['"]?(?:Bearer\s+)?([A-Za-z0-9_.-]{16,})/gi;
    let match;
    while ((match = pair.exec(haystack))) {
      if (credentialFrameSensitiveKey(match[1])) return true;
    }
    for (const [value, kind] of credentialFrameValues) {
      if (kind === 'token' && value.length >= 16
          && (haystack.indexOf(value) >= 0 || haystack.indexOf(encodeURIComponent(value)) >= 0)) return true;
    }
    return false;
  }

  function credentialFrameHasRemembered(text, wantedKind) {
    const haystack = String(text || '');
    if (!haystack) return false;
    let decoded = haystack;
    try { decoded = decodeURIComponent(haystack.replace(/\+/g, ' ')); } catch (_) {}
    let digitHaystack = '';
    for (const [value, kind] of credentialFrameValues) {
      if (kind !== wantedKind) continue;
      if (wantedKind === 'card') {
        if (!digitHaystack) digitHaystack = decoded.replace(/\D/g, '');
        if (digitHaystack.indexOf(value) >= 0) return true;
      } else if (haystack.indexOf(value) >= 0 || decoded.indexOf(value) >= 0
          || haystack.indexOf(encodeURIComponent(value)) >= 0) {
        return true;
      }
      try {
        for (let padding = 0; padding < 3; padding++) {
          const core = btoa('xx'.slice(0, padding) + value).slice(4, -4);
          if (core.length >= 10 && haystack.indexOf(core) >= 0) return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function credentialFramePaymentRisk(target) {
    try {
      const host = target.host;
      const label = host.split('.')[0] || '';
      const rawIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-f:]+\]$/i.test(host);
      const odd = /^xn--/i.test(host)
        || /\.(?:cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol)$/.test(host)
        || /^[a-f0-9]{12,}$/i.test(label);
      return target.url.protocol !== 'https:' && target.url.protocol !== 'wss:' || rawIp || odd;
    } catch (_) {
      return false;
    }
  }

  function credentialFrameNoteBlock(type, target, channel) {
    if (++credentialFrameBlocked > 40) return;
    emit(type, {
      dest: String(target && target.host || '').slice(0, 120),
      channel: String(channel || '').slice(0, 24),
      frame: true,
    });
  }

  function credentialFrameBlocks(rawTarget, data, headers, channel) {
    const target = credentialFrameTarget(rawTarget);
    if (!target) return false;
    credentialFrameScanFields(document, false);
    credentialFrameSeedTokens();
    const text = String(rawTarget || '') + '\n' + credentialFrameDataText(data)
      + '\n' + credentialFrameHeadersText(headers);
    const trusted = credentialFrameTrustedHost(target.host);
    if (credentialFrameEnabled('blockTokenExfil') && !trusted && credentialFrameHasToken(text)) {
      credentialFrameNoteBlock('blocked_token_exfil', target, channel);
      return true;
    }
    const hasCard = credentialFrameHasRemembered(text, 'card');
    const hasPassword = credentialFrameHasRemembered(text, 'password');
    if (hasCard && credentialFrameEnabled('paymentCardGuard') && credentialFramePaymentRisk(target)) {
      credentialFrameNoteBlock('blocked_payment_card_submit', target, channel);
      return true;
    }
    if ((hasCard || hasPassword) && credentialFrameEnabled('detectSkimmers') && !trusted) {
      credentialFrameNoteBlock('blocked_skimmer_exfil', target, channel);
      return true;
    }
    return false;
  }

  function credentialFrameFormData(form) {
    try { return new FormData(form); } catch (_) {}
    try {
      const pairs = [];
      const fields = form && form.querySelectorAll ? form.querySelectorAll('input,textarea,select') : [];
      const max = Math.min((fields && fields.length) || 0, 160);
      for (let i = 0; i < max; i++) pairs.push(String(fields[i].name || '') + '=' + String(fields[i].value || ''));
      return pairs.join('&');
    } catch (_) {
      return '';
    }
  }

  function credentialFrameFailXhr(xhr) {
    woTimeout(() => {
      try {
        const shadow = (name, value) => {
          try { Object.defineProperty(xhr, name, { configurable: true, value }); } catch (_) {}
        };
        shadow('readyState', 4);
        shadow('status', 0);
        shadow('statusText', '');
        shadow('responseURL', '');
        const makeEvent = (type) => {
          try { return new ProgressEvent(type); } catch (_) {
            try { return new Event(type); } catch (_) { return { type }; }
          }
        };
        for (const type of ['readystatechange', 'error', 'loadend']) {
          try { xhr.dispatchEvent(makeEvent(type)); } catch (_) {}
        }
      } catch (_) {}
    }, 0);
  }

  function installCredentialFrameGuard() {
    if (TOP_FRAME) return;
    woOn(document, 'input', (event) => {
      try { credentialFrameRememberField(event && event.target); } catch (_) {}
    }, true);

    try {
      if (typeof window.fetch === 'function') {
        const realFetch = window.fetch;
        window.fetch = function credentialFrameFetch(input, init) {
          try {
            const url = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
            const body = init && init.body !== undefined ? init.body : input && input.body;
            const headers = [input && input.headers, init && init.headers];
            if (credentialFrameBlocks(url, body, headers, 'fetch')) {
              return Promise.reject(new DOMException('Blocked by WardenOne credential guard', 'SecurityError'));
            }
          } catch (_) {}
          return realFetch.apply(this, arguments);
        };
      }
    } catch (_) {}

    try {
      if (navigator && typeof navigator.sendBeacon === 'function') {
        const realBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function credentialFrameBeacon(url, data) {
          if (credentialFrameBlocks(url, data, null, 'beacon')) return false;
          return realBeacon(url, data);
        };
      }
    } catch (_) {}

    try {
      if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
        const realOpen = XMLHttpRequest.prototype.open;
        const realSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        const realSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function credentialFrameXhrOpen(method, url) {
          credentialFrameXhrs.set(this, { url, headers: [] });
          return realOpen.apply(this, arguments);
        };
        if (typeof realSetHeader === 'function') {
          XMLHttpRequest.prototype.setRequestHeader = function credentialFrameXhrHeader(name, value) {
            try {
              const state = credentialFrameXhrs.get(this);
              if (state && state.headers.length < 80) state.headers.push(String(name) + ': ' + String(value));
            } catch (_) {}
            return realSetHeader.apply(this, arguments);
          };
        }
        XMLHttpRequest.prototype.send = function credentialFrameXhrSend(body) {
          const state = credentialFrameXhrs.get(this) || { url: '', headers: [] };
          if (credentialFrameBlocks(state.url, body, state.headers, 'xhr')) {
            credentialFrameFailXhr(this);
            return undefined;
          }
          return realSend.apply(this, arguments);
        };
      }
    } catch (_) {}

    try {
      if (window.WebSocket && WebSocket.prototype && typeof WebSocket.prototype.send === 'function') {
        const realWebSocketSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function credentialFrameWebSocketSend(data) {
          if (credentialFrameBlocks(this && this.url, data, null, 'websocket')) return undefined;
          return realWebSocketSend.apply(this, arguments);
        };
      }
    } catch (_) {}

    try {
      if (window.Storage && Storage.prototype && typeof Storage.prototype.setItem === 'function') {
        const realStorageSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function credentialFrameStorageSetItem(key, value) {
          if (credentialFrameEnabled('blockTokenExfil')) credentialFrameRememberTokenText(value, key);
          return realStorageSetItem.apply(this, arguments);
        };
      }
    } catch (_) {}

    try {
      if (window.HTMLFormElement && HTMLFormElement.prototype) {
        const realFrameSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function credentialFrameSubmit() {
          credentialFrameScanFields(this, true);
          const action = this && this.action ? this.action : credentialFrameBaseUrl();
          if (credentialFrameBlocks(action, credentialFrameFormData(this), null, 'form')) return undefined;
          return realFrameSubmit.apply(this, arguments);
        };
      }
    } catch (_) {}

    woOn(document, 'submit', (event) => {
      try {
        const form = event && event.target;
        if (!form) return;
        credentialFrameScanFields(form, true);
        const action = form.action || credentialFrameBaseUrl();
        if (!credentialFrameBlocks(action, credentialFrameFormData(form), null, 'form')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch (_) {}
    }, true);
  }

  installCredentialFrameGuard();
  /* CREDENTIAL_FRAME_GUARD_END */

  // ---------------------------------------------------------------------------
  // Tracker-frame cookie and storage guard.
  //
  // "Block third-party cookies" has a network half and an in-page half. The
  // network half is a declarativeNetRequest rule that is deliberately limited to
  // image and ping responses: sign-in and federation set their cookies on
  // frames, scripts and XHR, and stripping those signs people out. Covering the
  // frame case was the in-page half's job -- but that code lived in the main
  // engine, which the manifest injects with all_frames:false, so its "am I a
  // cross-origin subframe" test could never be true and the frame half had never
  // run once. Same story for the blockSupercookies storage sweep. This file is
  // the one MAIN-world script that does run in every frame at document_start, so
  // the frame half belongs here.
  //
  // Scope stays deliberately narrow: a fixed list of hosts that exist only to
  // track. Anything broader is a login-compat incident waiting to happen, which
  // is the whole reason the network half is narrow too.
  const TRACKER_FRAME_HOSTS = [
    'scorecardresearch.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
    'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googletagmanager.com',
    'quantserve.com', 'adsrvr.org', 'adnxs.com', 'rubiconproject.com', 'openx.net',
    'pubmatic.com', 'bluekai.com', 'demdex.net', 'everesttech.net', 'hotjar.com',
    'fullstory.com', 'mouseflow.com',
  ];

  function isTrackerHost(host) {
    host = String(host || '').toLowerCase();
    while (host.charAt(host.length - 1) === '.') host = host.slice(0, -1);
    return TRACKER_FRAME_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  }

  // A host framing itself is first-party to itself. What matters is cross-SITE
  // storage, so the embedder has to be a different site. If reading top is
  // refused, that refusal IS the cross-origin answer.
  function isCrossSiteFrame() {
    try {
      if (TOP_FRAME) return false;
      try {
        return baseDomain(window.top.location.hostname) !== baseDomain(location.hostname);
      } catch (_) {
        return true;
      }
    } catch (_) {
      return false;
    }
  }

  function isTrackerFrame() {
    return isCrossSiteFrame() && isTrackerHost(location.hostname);
  }

  function trackerCookiesBlocked() {
    try { return masterEnabled() && !!cfg().blockThirdPartyCookies; } catch (_) { return false; }
  }

  // The activity log has always had a name for this -- history.js calls it
  // "Third-party cookie blocked" and the worker keeps it off the red badge on
  // purpose, since it is routine rather than alarming. Nothing had ever emitted
  // it: the only sender lived in the main engine's dead subframe branch. Moving
  // the behaviour here without the reporting would have left the feature working
  // and invisible, which is its own kind of broken.
  //
  // Capped, because a tracker frame writes cookies in a loop and fifty identical
  // entries teach nobody anything.
  let trackerCookieLogged = 0;

  function noteTrackerCookieBlocked() {
    if (trackerCookieLogged >= 50) return;
    trackerCookieLogged++;
    try {
      emit('blocked_thirdparty_cookie', {
        scope: String(location.hostname || '').slice(0, 200),
        why: 'a known tracker in an embedded frame tried to store a cross-site cookie',
      });
    } catch (_) {}
  }

  let trackerStorageCleared = false;

  function clearTrackerFrameStorage() {
    if (trackerStorageCleared) return;
    try { if (!masterEnabled() || !cfg().blockSupercookies) return; } catch (_) { return; }
    if (!isTrackerFrame()) return;
    trackerStorageCleared = true;
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    try { window.name = ''; } catch (_) {}
    try {
      String(document.cookie || '').split(';').forEach((pair) => {
        const name = pair.split('=')[0].trim();
        if (!name) return;
        const dead = '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        try { document.cookie = name + dead; } catch (_) {}
        try { document.cookie = name + dead + ';domain=.' + baseDomain(location.hostname); } catch (_) {}
      });
    } catch (_) {}
    try {
      if (indexedDB && typeof indexedDB.databases === 'function') {
        indexedDB.databases().then((dbs) => {
          (dbs || []).forEach((db) => {
            try { if (db && db.name) indexedDB.deleteDatabase(db.name); } catch (_) {}
          });
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Installed at document_start so it beats the frame's own scripts. Config
  // arrives later over postMessage, so the decision is made per access rather
  // than at install time -- before config lands, and whenever the feature is
  // off, both accessors fall straight through to the real cookie jar.
  if (isTrackerFrame()) {
    try {
      const native = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      if (native && typeof native.get === 'function' && typeof native.set === 'function') {
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          enumerable: true,
          get() { return trackerCookiesBlocked() ? '' : native.get.call(document); },
          set(v) {
            if (!trackerCookiesBlocked()) { native.set.call(document, v); return; }
            noteTrackerCookieBlocked();
          },
        });
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Storage Access API.
  //
  // document.requestStorageAccess() is how an embedded third party asks for its
  // unpartitioned cookies back. It is the sanctioned route around the very
  // partitioning the rest of this extension leans on, and nothing in Chromium
  // exposes it to an extension: there is no contentSettings type for storage
  // access, declarativeNetRequest cannot see a JavaScript call, and a grant
  // produces no request that looks different from any other. The page API is the
  // only lever there is.
  //
  // Which decides where this lives. The caller is by definition inside the
  // cross-origin frame, and permission-chain.js -- the natural home for it on
  // paper -- is injected all_frames:false. A hook there could never once fire.
  //
  // Refusing everything is not the goal and would be a login-compat incident:
  // this is the mechanism behind embedded sign-in, embedded checkout and comment
  // logins. Known trackers are refused, everything else is recorded so it can be
  // seen at all, and blanket refusal is a switch someone can choose.
  const SAA_DENIED = 'Storage access refused by WardenOne';

  function storageAccessEnabled() {
    try { return masterEnabled() && cfg().storageAccessGuard !== false; } catch (_) { return false; }
  }

  function refuseEveryStorageAccess() {
    try { return masterEnabled() && cfg().blockAllStorageAccess === true; } catch (_) { return false; }
  }

  // Inside its own frame a hidden embed still reports its layout size, so this
  // needs no access to the parent. A frame with no area is not showing anyone a
  // sign-in button.
  function frameHasNoArea() {
    try { return window.innerWidth <= 2 || window.innerHeight <= 2; } catch (_) { return false; }
  }

  // Chrome's storage-access heuristics grant without ever prompting when the
  // embedded site was used first-party recently, so "the user must have seen a
  // prompt" is not true. A request with no transient activation behind it is the
  // interesting case, not the normal one. Absent API means no opinion, not
  // suspicion -- guessing wrong here produces a warning on every ordinary embed.
  function hasTransientActivation() {
    try {
      const ua = navigator.userActivation;
      return !ua || typeof ua.isActive !== 'boolean' ? true : ua.isActive;
    } catch (_) {
      return true;
    }
  }

  function storageAccessSuspicions() {
    const out = [];
    try {
      if (isTrackerHost(location.hostname)) out.push('it belongs to a known tracker');
      if (!hasTransientActivation()) out.push('nothing was clicked or typed first');
      if (frameHasNoArea()) out.push('the frame is invisible');
    } catch (_) {}
    return out;
  }

  function noteStorageAccess(method, refused, why) {
    const detail = {
      // The embedded origin is the whole point of recording this: it is the one
      // party the top page cannot see and the user was never shown.
      host: String(location.hostname || '').slice(0, 200),
      method,
      why: why.join(', ') || 'an embedded third party asked for its cross-site cookies',
    };
    if (refused) emit('blocked_storage_access', detail);
    else if (why.length) emit('warned_storage_access', detail);
    else emit('detected_storage_access', detail);
  }

  function installStorageAccessGuard() {
    let proto;
    try { proto = window.Document && Document.prototype; } catch (_) { return; }
    if (!proto) return;

    // The embedded-frame side. Cross-site only: a same-site frame asking for its
    // own storage is not a third party by any definition that matters.
    if (isCrossSiteFrame() && typeof proto.requestStorageAccess === 'function') {
      const realRequest = proto.requestStorageAccess;
      proto.requestStorageAccess = function requestStorageAccess(...args) {
        if (!storageAccessEnabled()) return realRequest.apply(this, args);
        const why = storageAccessSuspicions();
        const refused = refuseEveryStorageAccess() || isTrackerHost(location.hostname);
        noteStorageAccess('requestStorageAccess', refused, why);
        // A rejected promise is the shape every caller already handles, because
        // the user has always been able to decline. Throwing synchronously, or
        // resolving with nothing, is not a refusal any page understands.
        if (refused) return Promise.reject(new DOMException(SAA_DENIED, 'NotAllowedError'));
        return realRequest.apply(this, args);
      };
    }

    // hasStorageAccess() takes no gesture and shows no prompt, so it is a silent
    // probe whose answer is itself a cross-site signal: it tells an embed whether
    // it has been granted before. Worth recording even when nothing is requested.
    if (isCrossSiteFrame() && typeof proto.hasStorageAccess === 'function') {
      const realHas = proto.hasStorageAccess;
      proto.hasStorageAccess = function hasStorageAccess(...args) {
        if (!storageAccessEnabled()) return realHas.apply(this, args);
        const refused = refuseEveryStorageAccess() || isTrackerHost(location.hostname);
        noteStorageAccess('hasStorageAccess', refused, refused ? ['it belongs to a known tracker'] : []);
        // Under refusal the honest answer is the one an ungranted frame gets.
        if (refused) return Promise.resolve(false);
        return realHas.apply(this, args);
      };
    }

    // The other direction, and the one that is easy to forget: the TOP page can
    // ask on an embed's behalf. Same grant, same consequence, opposite caller.
    if (TOP_FRAME && typeof proto.requestStorageAccessFor === 'function') {
      const realFor = proto.requestStorageAccessFor;
      proto.requestStorageAccessFor = function requestStorageAccessFor(origin, ...rest) {
        if (!storageAccessEnabled()) return realFor.call(this, origin, ...rest);
        let host = '';
        try { host = new URL(String(origin)).hostname; } catch (_) { host = String(origin || '').slice(0, 200); }
        const tracker = isTrackerHost(host);
        const refused = refuseEveryStorageAccess() || tracker;
        const why = tracker ? ['it belongs to a known tracker'] : [];
        if (!hasTransientActivation()) why.push('nothing was clicked or typed first');
        const detail = {
          host: String(host || '').slice(0, 200),
          method: 'requestStorageAccessFor',
          why: why.join(', ') || 'this page asked for an embedded third party to get its cross-site cookies',
        };
        if (refused) emit('blocked_storage_access', detail);
        else if (why.length) emit('warned_storage_access', detail);
        else emit('detected_storage_access', detail);
        if (refused) return Promise.reject(new DOMException(SAA_DENIED, 'NotAllowedError'));
        return realFor.call(this, origin, ...rest);
      };
    }
  }

  // Installed at document_start, before the frame's own scripts run. The config
  // arrives later over postMessage, so every decision is made per call and the
  // wrappers fall straight through until it lands.
  installStorageAccessGuard();

  woOn(window, 'message', (event) => {
    if (event.source !== window) return;
    const msg = event.data || {};
    if (msg.source === 'wardenone-handshake' && typeof msg.token === 'string' && !token) {
      token = msg.token;
      flushEvents();
      return;
    }
    if (msg.source === 'wardenone' && msg.kind === 'config' && token && msg.token === token
        && msg.overrides && typeof msg.overrides === 'object') {
      guardConfig = Object.assign({
        enabled: true,
        blockGesturelessNav: true,
        blockForcedPopups: true,
        strictPopupShield: true,
        blockPopupTricks: true,
        blockTokenExfil: true,
        detectSkimmers: true,
        paymentCardGuard: true,
        gestureWindowMs: DEFAULT_WINDOW_MS,
      }, msg.overrides, { __configReady: true });
      clearTrackerFrameStorage();
    }
  }, true);
}());

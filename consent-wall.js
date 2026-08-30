/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */

/*
 * Full-screen consent walls.
 *
 * Auto-reject (consent-reject.js) answers a banner by clicking its "reject" control.
 * When a banner offers no way to say no -- consent-or-pay, or "accept to continue" --
 * there is nothing to click, and the page sits behind a sheet that covers the viewport
 * and freezes the scroll. This lifts that sheet without answering it. Nothing is
 * consented to, and no consent cookie is written, because nothing is clicked.
 *
 * Everything below is shaped by a 101-site live sweep (85 measured). The findings that
 * matter, in the order they bite:
 *
 * 1. SIZE ALONE IS DESTRUCTIVE. Matching on "covers the viewport" took out 84 elements
 *    on one site, and still ate a site's own hero carousel at a correct viewport. The
 *    carousel is absolutely positioned and full-bleed but sits at z-index auto. Adding
 *    a z-index floor of 100000 cut it to exactly the real wall on every site tested.
 *
 * 2. NEVER ACT WITHOUT A MATCH. An earlier build released the scroll lock unconditionally
 *    and unlocked etsy.com -- which runs no consent manager at all -- by stripping the
 *    site's own wt-html-no-scroll. Releasing the lock is a consequence of having removed
 *    a wall, never an independent step.
 *
 * 3. THE LOCK IS A CLASS ON <html>, NOT AN INLINE STYLE. Sourcepoint uses
 *    html.sp-message-open, Didomi didomi-popup-open, others a plain noScroll. Clearing
 *    body.style.overflow does nothing against any of them, because there was never an
 *    inline style to clear. Removing the class restored one site from a collapsed 900px
 *    to its real 27,967px. Of the sites that were locked: 16 needed the class removed,
 *    1 needed !important, and the rest were never locked at all.
 *
 * 4. SOMETIMES THE PAGE IS NOT BEHIND THE WALL. On derstandard.at the sheet lifts
 *    cleanly and leaves 334 characters and zero articles -- the article HTML was never
 *    sent. Removing the wall there hands someone a blank page, which is worse than the
 *    wall. So the page is measured after removal and the wall goes back if there is
 *    nothing behind it. Text length alone cannot make that call: vg.no reads as 1,819
 *    characters and is a complete, healthy front page of short Norwegian headlines.
 *    Scroll height separates them cleanly -- ~1 viewport against tens of thousands.
 *
 * 5. IDENTITY IS OFTEN NOT IN id OR class. Six of the walls found carried nothing
 *    matchable there and every one was real: an iframe title="Consent window", a parent
 *    div#appconsent, an obfuscated class="o6ugt3n" identifiable only by its Polish body
 *    text. So identity is read from the whole element -- title, src, srcdoc, parent --
 *    and a wall that is still anonymous is accepted only when a consent manager is
 *    demonstrably running on the page.
 *
 * Not reachable from here, and not attempted: sites that navigate to a consent gate on
 * another origin before rendering anything (the DPG Media group does this), and managers
 * that render inside a closed shadow root.
 */
(function () {
  'use strict';

  const CONSENT_WALL_VERSION = '1.0.0';
  if (window.__wardenOneConsentWallReadyVersion === CONSENT_WALL_VERSION) return;
  /* A different version means this frame holds an older copy -- after an update, or because
     Repair reinstalled over it. Release what that copy held first, or both stay live and both
     act on the same wall. */
  if (window.__wardenOneConsentWallReadyVersion) {
    try {
      if (typeof window.__wardenOneConsentWallDispose === 'function') window.__wardenOneConsentWallDispose();
    } catch (_) {}
  }
  window.__wardenOneConsentWallVersion = CONSENT_WALL_VERSION;

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
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  // Chrome's extension events are not DOM events: the abort signal does not cover them and
  // there is no removeEventListener-by-signal. Repair reinstalls this script, so a listener
  // registered here and never removed accumulates one more copy per Repair. removeListener
  // matches by identity, so the exact callback reference has to be kept.
  const woChromeListeners = [];
  const woOnMessage = (fn) => {
    try {
      chrome.runtime.onMessage.addListener(fn);
      woChromeListeners.push([chrome.runtime.onMessage, fn]);
    } catch (_) {}
    return fn;
  };
  const woOnStorage = (fn) => {
    try {
      chrome.storage.onChanged.addListener(fn);
      woChromeListeners.push([chrome.storage.onChanged, fn]);
    } catch (_) {}
    return fn;
  };

  window.__wardenOneConsentWallDispose = () => {
    try { restoreAll('dispose'); } catch (_) {}
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

  const DEFAULTS = {
    enabled: true,
    removeConsentWalls: false,
    allowlist: [],
  };

  // A wall inside a subframe is that frame's own business; the sheet covering the page is
  // always an element of the top document, even when the sheet itself is an iframe.
  const isTopFrame = (() => {
    try { return window.top === window; } catch (_) { return false; }
  })();
  if (!isTopFrame) return;

  // Mirrors the sign-in, captcha and payment origins consent-reject stays off. A full-viewport
  // high-z element on an OAuth or checkout page is the flow itself, not a wall.
  const HOST_BLOCK_RE = /(^|\.)(accounts\.google\.com|oauth2\.googleapis\.com|apis\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|okta\.com|oktacdn\.com|auth0\.com|onelogin\.com|duosecurity\.com|hcaptcha\.com|recaptcha\.net|challenges\.cloudflare\.com|turnstile\.cloudflare\.com|amazoncognito\.com|github\.com|shopify\.com|paypal\.com|stripe\.com|checkout\.com|adyen\.com|braintreepayments\.com|braintreegateway\.com|klarna\.com|squareup\.com|cash\.app)$/i;
  const BLOCKED_HOST = (() => {
    try { return HOST_BLOCK_RE.test(String(location.hostname || '')); } catch (_) { return false; }
  })();
  if (BLOCKED_HOST) return;

  /* ---- what counts as a wall ------------------------------------------------------- */

  // The z-index floor is the whole discriminator. Page furniture that fills the viewport --
  // hero carousels, sticky mastheads, parallax backdrops -- sits at auto or in the low
  // thousands. Consent managers reach for the top of the stacking context; the ones measured
  // used 2147483647, 2147483307 and similar. 100000 sits above any real layout and below all
  // of them.
  const Z_FLOOR = 100000;
  // A sheet has to actually cover the viewport. 0.98 rather than 1.0 because a wall that
  // leaves a hairline at one edge is still a wall.
  const COVER = 0.98;

  // Two regexes rather than one, because \b is wrong for half of these. Vendor containers
  // join their words with underscores -- sp_message_container_1426772, CybotCookiebotDialog,
  // CookieConsent__root -- and an underscore is a word character, so \bsp_message\b matches
  // none of them. That silently killed the primary signal for the most common manager in the
  // sweep. Identifiers are matched as substrings; only the generic English words that could
  // turn up in an unrelated class name keep their boundaries.
  //
  // Being generous here is safe: nothing reaches this test until it already covers the whole
  // viewport at the top of the stacking context, and identity only corroborates that.
  const CMP_ID_RE = /(sp_message|sp_choice|sourcepoint|onetrust|optanon|didomi|usercentrics|trustarc|quantcast|qc-cmp|iubenda|cookiebot|cookieyes|cookielaw|cookiehub|cookiescript|cookie[-_]?consent|consent[-_]?manager|privacy[-_]?manager|privacy[-_]?cp[-_]?wall|appconsent|fc-consent|contentpass|crownpeak|axeptio|osano|termly|cmpbox|ketch-|gdpr)/i;
  const CMP_WORD_RE = /\b(cookie|cookies|consent|ccpa|cpra|cmp|truste|civic)\b/i;
  const looksLikeCmp = (blob) => CMP_ID_RE.test(blob) || CMP_WORD_RE.test(blob);
  // The wall's own words, when its markup gives nothing away. One site's only usable
  // signal was Polish body copy under an obfuscated class name.
  const CONSENT_TEXT_RE = /\b(cookie|consent|privacy|gdpr|personal(?:ised|ized) ads?|legitimate interest|vendors?|partners?|accept all|reject all|manage (?:options|choices)|prywatno|zgod|datenschutz|einwilligung|zustimm|confidentialit|consentement|privacidad|consentimiento|privacy e cookie|consenso|persoonsgegevens|toestemming|integritet|samtycke|personvern|yksityisyy|soukrom|souhlas)\b/i;

  // Consent managers that announce themselves on the page. When the sheet itself is
  // anonymous -- a cross-origin iframe with no title, an obfuscated class -- this is what
  // says a consent manager is running here at all, and without it an anonymous sheet is
  // left alone.
  function cmpOnPage() {
    try {
      if (window.__tcfapi || window.__cmp || window.Didomi || window.OneTrust || window.Optanon
          || window.Cookiebot || window.CookieConsent || window._sp_ || window._iub || window.UC_UI
          || window.Osano || window.Sourcepoint || window.ketch) return true;
    } catch (_) {}
    try {
      return !!document.querySelector(
        '[id^="sp_message_container"],[id^="sp_message_id"],#didomi-host,.didomi-popup,'
        + '#onetrust-consent-sdk,#onetrust-banner-sdk,#CybotCookiebotDialog,[id^="iubenda-cs"],'
        + '#usercentrics-root,#usercentrics-cmp-ui,[class*="qc-cmp"],.fc-consent-root,'
        + '#appconsent,[class*="ketch-"],[id^="cmpbox"],#cookiescript_injected',
      );
    } catch (_) { return false; }
  }

  // Everything about an element that might name it, not just id and class. Six of the walls
  // in the sweep were identifiable only from here: an iframe title, its src, a parent's id.
  function identity(el) {
    const bits = [];
    try {
      bits.push(el.id || '');
      bits.push(typeof el.className === 'string' ? el.className : '');
      for (const attr of ['title', 'src', 'name', 'aria-label', 'data-testid', 'data-nosnippet']) {
        try { bits.push(el.getAttribute(attr) || ''); } catch (_) {}
      }
      // srcdoc can be a whole document; its opening tags carry the identity.
      try { bits.push(String(el.getAttribute('srcdoc') || '').slice(0, 400)); } catch (_) {}
      const parent = el.parentElement;
      if (parent) {
        bits.push(parent.id || '');
        bits.push(typeof parent.className === 'string' ? parent.className : '');
      }
    } catch (_) {}
    return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 600);
  }

  function visibleText(el) {
    try { return String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200); } catch (_) { return ''; }
  }

  // A wall holds a notice and a couple of buttons. Anything holding a front page's worth of
  // links and headings is the page, whatever its z-index says, and is never touched. The
  // measure-and-restore pass below would catch this too, but not before the content flickered.
  function looksLikeContent(el) {
    try {
      return el.querySelectorAll('a[href]').length >= 25
        && el.querySelectorAll('h1,h2,h3').length >= 8;
    } catch (_) { return false; }
  }

  function coversViewport(el) {
    try {
      const r = el.getBoundingClientRect();
      return r.width >= window.innerWidth * COVER && r.height >= window.innerHeight * COVER;
    } catch (_) { return false; }
  }

  // Hit-testing a few points beats walking every element twice over: it asks the engine what
  // is actually on top instead of re-deriving it, and it does not force style resolution on a
  // whole document. Walking body * and serialising outerHTML is what hung the renderer on a
  // heavy news front page during the sweep, badly enough to need the tab reset.
  function candidates() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const seen = new Set();
    for (const [x, y] of [[vw / 2, vh / 2], [vw * 0.2, vh * 0.3], [vw * 0.8, vh * 0.7]]) {
      try {
        for (const el of document.elementsFromPoint(x, y)) seen.add(el);
      } catch (_) {}
    }
    const hits = [];
    for (const el of seen) {
      try {
        if (!el || el === document.body || el === document.documentElement) continue;
        if (!el.isConnected || el.nodeType !== 1) continue;
        const s = getComputedStyle(el);
        if (s.position !== 'fixed' && s.position !== 'absolute') continue;
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
        if (!(parseInt(s.zIndex, 10) >= Z_FLOOR)) continue;
        if (!coversViewport(el)) continue;
        if (looksLikeContent(el)) continue;
        hits.push(el);
      } catch (_) {}
    }
    // A wall is often a container holding a backdrop holding a frame, and all three pass the
    // test. Removing the outermost takes the rest with it; removing an inner one first would
    // orphan the parent and leave the page still covered.
    return hits.filter((el) => !hits.some((other) => other !== el && other.contains(el)));
  }

  function isWall(el) {
    const blob = identity(el);
    if (looksLikeCmp(blob)) return true;
    if (CONSENT_TEXT_RE.test(visibleText(el))) return true;
    // Anonymous: no name, no readable words -- typically a cross-origin consent iframe. Only
    // acceptable when something else on the page proves a consent manager is running.
    return cmpOnPage();
  }

  /* ---- the scroll lock ------------------------------------------------------------- */

  // Class names that mean "the page is held still behind a modal". Kept narrow on purpose:
  // these are removed from html and body, and a loose pattern here is how the etsy failure
  // happened in the first place.
  const LOCK_CLASS_RE = /^(?:sp-message-open|didomi-popup-open|didomi-lock|onetrust-pc-dark-filter|ot-overflow-hidden|modal-open|no-?scroll|noscroll|scroll-?lock|scroll-?locked|is-?locked|body-?lock(?:ed)?|overflow-?hidden|is-clipped|ReactModal__Body--open|cmp-?open|consent-?open|cookie-?open|gdpr-?open|prevent-?scroll|disable-?scroll|fixed-?body)$/i;

  function lockedNow() {
    // scrollHeight stays at its full value while the page is frozen, so it cannot answer
    // this. Asking the page to scroll and reading the offset back can.
    try {
      const y = window.scrollY;
      if (y > 50) return false;
      window.scrollTo(0, 700);
      const moved = window.scrollY > 50;
      window.scrollTo(0, y);
      return !moved;
    } catch (_) { return false; }
  }

  // Undone in reverse if the page turns out to be empty, so every step records what it did.
  function releaseLock(undo) {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    // Tier 1: the class. This is what actually holds most of them, and it is the only tier
    // that leaves no trace of ours on the page afterwards.
    for (const el of [html, body]) {
      try {
        for (const cls of Array.from(el.classList)) {
          if (!LOCK_CLASS_RE.test(cls)) continue;
          el.classList.remove(cls);
          undo.classes.push([el, cls]);
        }
      } catch (_) {}
    }
    if (!lockedNow()) return;

    // Tier 2: an inline style set by the manager's own script.
    for (const el of [html, body]) {
      for (const prop of ['position', 'top', 'left', 'width', 'height', 'overflow', 'overflow-y']) {
        try {
          const had = el.style.getPropertyValue(prop);
          if (!had) continue;
          undo.inline.push([el, prop, had, el.style.getPropertyPriority(prop)]);
          el.style.removeProperty(prop);
        } catch (_) {}
      }
    }
    if (!lockedNow()) return;

    // Tier 3: a stylesheet rule we cannot edit, so it gets outranked. Last resort -- it
    // leaves our own declarations on the page, which is why it is not tier 1.
    for (const [el, prop, value] of [
      [body, 'position', 'static'], [body, 'overflow', 'visible'], [body, 'height', 'auto'],
      [html, 'overflow', 'visible'],
    ]) {
      try {
        undo.forced.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
        el.style.setProperty(prop, value, 'important');
      } catch (_) {}
    }
  }

  /* ---- act ------------------------------------------------------------------------- */

  let config = Object.assign({}, DEFAULTS);
  let active = false;
  let observer = null;
  let scanQueued = false;
  let started = false;
  // Each entry is one removal, with everything needed to put it back.
  const undone = [];
  // A page that keeps re-drawing its wall is a page we are not going to win against, and
  // trying forever means a mutation storm. Three passes, then leave it alone.
  const PASS_CAP = 3;
  let passes = 0;
  let reported = false;

  // A one-way latch. Some pages teach us, at runtime, that taking their wall out is the
  // wrong move: the page turns out to be empty behind it, or the site puts the wall
  // straight back. Once that is known there is nothing to gain from trying again, and
  // quite a lot to lose -- the retry is what the reader sees as flickering.
  let stoodDown = false;

  // Our own writes are mutations too, and the observer cannot tell them from the site's.
  // Removing the wall fires it, and so does putting the wall back, so a page we decided to
  // restore immediately looked like a page with a fresh wall on it. That loop -- remove,
  // measure, restore, observe our own restore, remove again -- is the flicker, and it ran
  // as fast as the debounce allowed until the pass cap stopped it.
  let selfWriting = false;

  // What we have already taken out once. A wall that comes back is a site that intends to
  // keep it, and the second removal starts a fight that renders as a strobe.
  const removedOnce = new Set();

  function cleanHost(value) {
    return String(value || '').trim().toLowerCase().replace(/^www\./, '');
  }

  function hostAllowed() {
    const host = cleanHost(location.hostname);
    const list = Array.isArray(config.allowlist) ? config.allowlist : [];
    return list.some((item) => {
      const d = cleanHost(item);
      return d && (host === d || host.endsWith('.' + d));
    });
  }

  function updateActive() {
    const on = config.removeConsentWalls === true
      || config.removeConsentWalls === 'true'
      || config.removeConsentWalls === 1;
    active = config.enabled !== false && on && !hostAllowed();
  }

  function loadConfig(done) {
    try {
      chrome.storage.local.get('wardenone_config', (res) => {
        config = Object.assign({}, DEFAULTS, (res && res.wardenone_config) || {});
        updateActive();
        if (typeof done === 'function') done();
      });
    } catch (_) {
      updateActive();
      if (typeof done === 'function') done();
    }
  }

  // Did lifting the wall actually reveal a page? derstandard.at answers no: the sheet comes
  // off and what is behind it is a copyright line. Scroll height is the reliable half of
  // this -- a real front page runs to tens of thousands of pixels, a gate to about one
  // viewport. Text length is the corroborating half and cannot lead, because a healthy front
  // page of short headlines reads as under 2,000 characters.
  function pageHasContent() {
    try {
      const tall = document.documentElement.scrollHeight > window.innerHeight * 1.4;
      if (tall) return true;
      const text = String(document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim();
      return text.length >= 3000;
    } catch (_) { return true; }
  }

  function restoreAll(why) {
    // Putting the wall back is a burst of DOM writes, and the observer treats them exactly
    // like a site drawing a fresh wall. Without this the restore schedules the next scan.
    selfWriting = true;
    try {
      while (undone.length) {
        const entry = undone.pop();
        try {
          for (const [el, prop, value, priority] of entry.forced.reverse()) {
            if (value) el.style.setProperty(prop, value, priority || '');
            else el.style.removeProperty(prop);
          }
          for (const [el, prop, value, priority] of entry.inline.reverse()) {
            el.style.setProperty(prop, value, priority || '');
          }
          for (const [el, cls] of entry.classes.reverse()) el.classList.add(cls);
          // Back exactly where each one was: before the sibling it used to precede, or at
          // the end of the parent if it was last. Reversed, so that stacked walls go back
          // in the order they came out and land in their original order.
          for (const rec of (entry.nodes || []).slice().reverse()) {
            if (!rec.parent || !rec.parent.isConnected) continue;
            if (rec.next && rec.next.isConnected && rec.next.parentNode === rec.parent) {
              rec.parent.insertBefore(rec.node, rec.next);
            } else {
              rec.parent.appendChild(rec.node);
            }
          }
        } catch (_) {}
      }
    } finally { selfWriting = false; }
    if (why === 'empty') {
      // Say so. A wall that comes back looks like the feature failing, and the reason it
      // came back is worth more to someone than silence.
      report('kept', 'page is empty behind the wall — put it back');
    }
  }

  function report(kind, detail) {
    if (reported && kind !== 'kept') return;
    reported = true;
    try {
      chrome.runtime.sendMessage({
        kind: 'rg-block',
        type: 'blocked_overlay',
        detail: {
          matched: 'consent wall: ' + String(detail || '').slice(0, 80),
          why: kind === 'kept'
            ? 'consent wall left in place — nothing behind it'
            : 'removed a full-screen consent wall without consenting',
        },
      });
    } catch (_) {}
  }

  // Stop, and mean it. Disconnecting matters as much as the flag: left connected, the
  // observer keeps waking on every mutation of a busy page for the rest of the visit to
  // decide each time that it is not allowed to do anything.
  function standDown(why) {
    if (stoodDown) return;
    stoodDown = true;
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
    void why;
  }

  function scan() {
    scanQueued = false;
    if (stoodDown || !active || !document.body) return;
    // The cap is a backstop now rather than the only brake, and reaching it is itself a
    // signal: three walls in one visit is a page that is regenerating them.
    if (passes >= PASS_CAP) { standDown('pass cap'); return; }

    const found = candidates().filter(isWall);
    if (!found.length) return;
    passes++;

    const wasLocked = lockedNow();
    const entry = { node: null, nodes: [], classes: [], inline: [], forced: [] };
    // The parked scroll position. Managers set body top to minus the offset to hold the
    // reader's place; clearing it without reading it back drops them at the top of the page.
    let parked = 0;
    try { parked = Math.abs(parseInt(getComputedStyle(document.body).top, 10) || 0); } catch (_) {}

    const label = (identity(found[0]) || visibleText(found[0]) || found[0].tagName).slice(0, 80);

    // A wall we have already removed once has been put back by the site. Removing it again
    // is the start of a fight we cannot win -- the site re-renders, we remove, it renders
    // again -- and the reader watches the page strobe while it happens. Leave it.
    const returning = found.filter((el) => removedOnce.has(identity(el) || visibleText(el).slice(0, 80)));
    if (returning.length) { standDown('the wall came back'); return; }

    // Every removal is recorded, not just the first. Restoring one node out of three is
    // not a restore: it is the page left in a state neither we nor the site chose, and
    // "put it back" has to mean all of it or it should not be offered.
    selfWriting = true;
    try {
      for (const el of found) {
        try {
          entry.nodes.push({ node: el, parent: el.parentNode, next: el.nextSibling });
          removedOnce.add(identity(el) || visibleText(el).slice(0, 80));
          el.remove();
        } catch (_) {}
      }
    } finally { selfWriting = false; }
    if (!entry.nodes.length) return;
    entry.node = entry.nodes[0].node;

    // Only now, and only because something came out. This ordering is the etsy fix: a page
    // that never had a wall never reaches here, so its own scroll lock is never touched.
    if (wasLocked) releaseLock(entry);
    undone.push(entry);
    if (parked) { try { window.scrollTo(0, parked); } catch (_) {} }

    // Layout needs a beat to settle before the page can be measured honestly.
    woTimeout(() => {
      if (!pageHasContent()) {
        // The answer for this page is now known, and it will not change by asking again.
        // Standing down here is the whole fix for the flicker: before, the restore woke
        // the observer, the next scan found the wall we had just put back, and the page
        // strobed until the pass cap happened to stop it.
        restoreAll('empty');
        standDown('nothing behind the wall');
      } else report('removed', label);
    }, 400);
  }

  function queueScan(delay) {
    if (stoodDown || selfWriting || scanQueued) return;
    scanQueued = true;
    woTimeout(scan, typeof delay === 'number' ? delay : 60);
  }

  function start() {
    if (started || !active || !document.documentElement) return;
    started = true;
    // Managers inject late and often re-render once after they load, so a single pass at
    // ready would miss most of them.
    for (const delay of [0, 400, 1200, 2600]) woTimeout(scan, delay);
    observer = woObserver(() => queueScan(120));
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    woOn(window, 'resize', () => queueScan(200));
  }

  function stop() {
    started = false;
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
    restoreAll('off');
  }

  woOnStorage((changes, area) => {
    if (area !== 'local' || !changes || !changes.wardenone_config) return;
    loadConfig(() => {
      if (active) start();
      else if (started) stop();
    });
  });

  woOnMessage((msg) => {
    if (!msg || msg.type !== 'config-updated') return;
    loadConfig(() => {
      if (active) start();
      else if (started) stop();
    });
  });

  loadConfig(() => {
    if (!active) return;
    if (document.readyState === 'loading') {
      woOn(document, 'DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  });

  window.__wardenOneConsentWallReadyVersion = CONSENT_WALL_VERSION;
})();

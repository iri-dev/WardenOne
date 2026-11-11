/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */

/* Lift the "turn off your ad blocker" wall so the page reads normally.

   Detection itself is already answered by the filter lists the engine carries: uBO's
   filters/unbreak/quick-fixes and AdGuard Base bring the bab-defuser, fuckadblock-defuser,
   set-constant and abort-on-property-read rules that stop most sites concluding anything,
   and the redirect resources hand bait requests a working stub instead of a failure. This
   file is only for what gets through that: a wall already drawn on the page.

   What it will not do: guess. A wall has to be obstructing -- covering the viewport high in
   the stacking context, or holding a modal scroll lock -- before its words are even read, so
   an article about ad blockers has nothing for this to act on. When the page turns out to be
   empty behind the wall the wall goes back, and the worker pauses the shield for that site. */
(function () {
  'use strict';

  const ANTI_ADBLOCK_VERSION = '1.0.3';

  /* Wall wording, in the languages the sweep covered. Matching the noun is the cheap half;
     `ASK_RE` is what separates a wall from a page that merely says the word. */
  const ADBLOCK_RE = new RegExp([
    'ad\\s?-?\\s?block(?:er|ers|ing)?\\b', '\\badblock\\b', '\\bublock\\b',
    'werbeblocker', 'anzeigenblocker', 'adblocker',
    'bloqueur\\s+de\\s+(?:publicit|pub)', 'bloqueador\\s+de\\s+(?:anuncios|anúncios|publicidad)',
    'blocco\\s+(?:degli\\s+)?annunci', 'advertentieblokkeerder', 'annonsblockerare',
    'annonceblokker', 'mainosten\\s?est', 'blokad\\w*\\s+reklam', 'reklam\\s+engelleyici',
    'блокировщик\\s+рекламы',
    '广告拦截', '廣告攔截', '広告ブロック', '광고\\s?차단',
  ].join('|'), 'i');

  /* The wall is asking the reader to do something about it. Stems, not whole words: a wall
     says "disabled" and "allowlisted" as often as it says "disable". */
  const ASK_RE = new RegExp([
    'disabl', 'turn\\s+off', 'switch\\s+off', '\\bpaus', 'deactivat', 'whitelist', 'allowlist', 'unblock',
    'deaktivier', 'ausschalten', 'désactiv', 'desactiv', 'disattiv', 'uitschakel',
    'stäng\\s+av', 'wyłącz', 'отключ', 'devre\\s+dışı',
    '关闭', '解除', '無効',
  ].join('|'), 'i');

  /* Or telling the reader what it is withholding until they do. */
  const WITHHOLD_RE = /\b(?:not allowed|aren['’]?t allowed|is blocked|be blocked|blocked after|cannot continue|can['’]?t continue)\b/i;

  /* A sign-in, age, bot or members gate is the site deciding who may watch, not an ad wall,
     and it is removed by nobody. Checked before the wall test so a gate that happens to
     mention ad blocking is still left exactly where it is. */
  const ACCESS_RE = /\b(?:sign in to (?:confirm|watch)|verify (?:that )?you|captcha|members only|subscribe to (?:continue|watch)|log in to continue)\b/i;

  /* Player walls that never say "ad blocker" in the sentence that matters. Concrete enough to
     stand in for the noun; anything vaguer belongs in ADBLOCK_RE with the obstruction test. */
  const PLAYER_WALL_RE = /\b(?:video player will be blocked after \d+ videos?|ad blockers? violate .{0,30}terms of service)\b/i;

  /* Admiral's anti-adblock loader hosts. See the publisher fallback below. */
  const LOADER_HOSTS = ['html-load.com', 'content-loader.com'];

  /* Vendors whose wall carries no usable words -- an opaque frame, an obfuscated class. */
  const VENDOR_RE = /(blockadblock|fuckadblock|babasbm|adblock[-_]?detect|antiadb|anti[-_]?adblock|admiral|html-load|adbdetect|detectadblock|adblockkey)/i;

  const api = {
    version: ANTI_ADBLOCK_VERSION,
    /* The worker validates a report against the same policy the page used. */
    activeForHost(cfg, host) {
      const config = cfg && typeof cfg === 'object' ? cfg : {};
      if (config.enabled === false || config.antiAdblockShield === false) return false;
      const name = String(host || '').trim().toLowerCase().replace(/^www\./, '');
      if (!name) return false;
      const covers = (item) => {
        const d = String(item || '').trim().toLowerCase().replace(/^www\./, '');
        return !!d && (name === d || name.endsWith('.' + d));
      };
      if ((Array.isArray(config.allowlist) ? config.allowlist : []).some(covers)) return false;
      const overrides = config.siteOverrides && typeof config.siteOverrides === 'object' ? config.siteOverrides : {};
      for (const pattern of Object.keys(overrides)) {
        const entry = overrides[pattern];
        if (!covers(pattern) || !entry || typeof entry !== 'object') continue;
        if (entry.enabled === false || entry.antiAdblockShield === false) return false;
      }
      return true;
    },
    looksLikeWall(text, covering) {
      const blob = String(text || '').replace(/\s+/g, ' ');
      if (blob.length > 4096 || ACCESS_RE.test(blob)) return false;
      if (!ADBLOCK_RE.test(blob) && !PLAYER_WALL_RE.test(blob)) return false;
      return covering === true || ASK_RE.test(blob) || WITHHOLD_RE.test(blob);
    },
    looksLikeVendor(identity) {
      return VENDOR_RE.test(String(identity || ''));
    },
    /* Only the browser's own load failure of a loader script counts; a page cannot dispatch a
       trusted event, and every other script or resource error passes untouched. */
    isLoaderError(event, ScriptElement) {
      const target = event && event.target;
      if (!event || event.isTrusted !== true || !ScriptElement || !(target instanceof ScriptElement)) return false;
      let host = '';
      try { host = new URL(target.src).hostname.toLowerCase(); } catch (_) { return false; }
      return LOADER_HOSTS.some((d) => host === d || host.endsWith('.' + d));
    },
  };

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = Object.freeze(api);
    else globalThis.WOAntiAdblockShield = Object.freeze(api);
    return;
  }

  if (window.__wardenOneAntiAdblockReadyVersion === ANTI_ADBLOCK_VERSION) return;
  if (window.__wardenOneAntiAdblockReadyVersion) {
    try {
      if (typeof window.__wardenOneAntiAdblockDispose === 'function') window.__wardenOneAntiAdblockDispose();
    } catch (_) {}
  }
  window.__wardenOneAntiAdblockVersion = ANTI_ADBLOCK_VERSION;

  const isTopFrame = (() => { try { return window.top === window; } catch (_) { return false; } })();
  if (!isTopFrame) return;

  /* A full-viewport sheet on a sign-in, captcha or checkout page is the flow the reader came
     for. Mirrors the consent-wall list for the same reason. */
  const HOST_BLOCK_RE = /(^|\.)(accounts\.google\.(?:com|co\.uk)|auth\.openai\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|okta\.com|auth0\.com|onelogin\.com|duosecurity\.com|hcaptcha\.com|recaptcha\.net|challenges\.cloudflare\.com|turnstile\.cloudflare\.com|paypal\.com|stripe\.com|checkout\.com|adyen\.com|klarna\.com)$/i;
  try { if (HOST_BLOCK_RE.test(String(location.hostname || ''))) return; } catch (_) {}

  /* Admiral's loader blanks the publisher's page from its own script error handler when the
     loader is blocked (TechRadar, Tom's Hardware and Mirror rendered 0 characters). Stopping that
     native error in the capture phase keeps the loader blocked and the page readable. It has to
     be installed now, before page scripts and before the switches arrive, so it starts on. */
  let loaderGuardOff = false;
  let loaderHandled = false;
  try {
    window.addEventListener('error', (event) => {
      if (loaderGuardOff || !api.isLoaderError(event, HTMLScriptElement)) return;
      event.stopImmediatePropagation();
      if (loaderHandled) return;
      loaderHandled = true;
      const settle = () => later(() => report(pageHasContent() ? 'restored' : 'rollback'), 2000);
      if (document.readyState === 'complete') settle();
      else window.addEventListener('load', settle, { once: true });
    }, true);
  } catch (_) {}

  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };

  const Z_FLOOR = 100000;
  const COVER = 0.98;
  const PASS_CAP = 3;

  let config = { enabled: true, antiAdblockShield: true, allowlist: [] };
  let active = false;
  let observer = null;
  let scanQueued = false;
  let stoodDown = false;
  let selfWriting = false;
  let passes = 0;
  let reported = false;
  /* Each entry undoes one hidden wall: property writes only, so nothing leaves the DOM. */
  const undone = [];

  function visibleText(el) {
    try { return String(el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1600); } catch (_) { return ''; }
  }

  function identity(el) {
    const bits = [];
    try {
      bits.push(el.id || '');
      bits.push(typeof el.className === 'string' ? el.className : '');
      for (const attr of ['title', 'src', 'name', 'aria-label', 'data-testid']) {
        try { bits.push(el.getAttribute(attr) || ''); } catch (_) {}
      }
      const parent = el.parentElement;
      if (parent) {
        bits.push(parent.id || '');
        bits.push(typeof parent.className === 'string' ? parent.className : '');
      }
    } catch (_) {}
    return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 600);
  }

  /* A front page's worth of links and headings is the page, whatever its stacking order. */
  function looksLikeContent(el) {
    try {
      return el.querySelectorAll('a[href]').length >= 25 && el.querySelectorAll('h1,h2,h3').length >= 8;
    } catch (_) { return false; }
  }

  function coversViewport(el) {
    try {
      const r = el.getBoundingClientRect();
      return r.width >= window.innerWidth * COVER && r.height >= window.innerHeight * COVER;
    } catch (_) { return false; }
  }

  const LOCK_CLASS_RE = /^(?:modal-open|no-?scroll|noscroll|scroll-?lock(?:ed)?|is-?locked|body-?lock(?:ed)?|overflow-?hidden|is-clipped|ReactModal__Body--open|prevent-?scroll|disable-?scroll|fixed-?body|adblock-?open|blocked)$/i;

  function scrollLocked() {
    try {
      for (const el of [document.documentElement, document.body]) {
        if (!el) continue;
        const s = getComputedStyle(el);
        if (s.overflow === 'hidden' || s.overflowY === 'hidden' || s.position === 'fixed') return true;
      }
    } catch (_) {}
    return false;
  }

  /* Hit-testing a few points asks the engine what is on top instead of walking the document,
     which is what made the consent sweep hang a heavy front page. */
  function candidates() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const seen = new Set();
    for (const [x, y] of [[vw / 2, vh / 2], [vw * 0.2, vh * 0.3], [vw * 0.8, vh * 0.7]]) {
      try { for (const el of document.elementsFromPoint(x, y)) seen.add(el); } catch (_) {}
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
        if (looksLikeContent(el)) continue;
        hits.push({ el, covering: coversViewport(el) });
      } catch (_) {}
    }
    return hits.filter((hit) => !hits.some((other) => other.el !== hit.el && other.el.contains(hit.el)));
  }

  /* Obstruction first, words second: an element that is not in the reader's way is not a wall
     however it is worded. */
  function isWall(hit) {
    if (!hit.covering && !scrollLocked()) return false;
    if (api.looksLikeWall(visibleText(hit.el), hit.covering)) return true;
    return api.looksLikeVendor(identity(hit.el)) && hit.covering;
  }

  function force(entry, el, prop, value) {
    try {
      entry.forced.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
      el.style.setProperty(prop, value, 'important');
    } catch (_) {}
  }

  function releaseLock(entry) {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      try {
        const s = getComputedStyle(el);
        if (s.overflow === 'hidden' || s.overflowY === 'hidden') force(entry, el, 'overflow', 'visible');
        if (s.position === 'fixed') {
          force(entry, el, 'position', 'static');
          force(entry, el, 'top', 'auto');
          force(entry, el, 'height', 'auto');
        }
        for (const cls of Array.from(el.classList || [])) {
          if (!LOCK_CLASS_RE.test(cls)) continue;
          entry.classes.push([el, cls]);
          el.classList.remove(cls);
        }
      } catch (_) {}
    }
  }

  function restoreAll(why) {
    selfWriting = true;
    try {
      while (undone.length) {
        const entry = undone.pop();
        try {
          for (const [el, prop, value, priority] of entry.forced.reverse()) {
            if (value) el.style.setProperty(prop, value, priority || '');
            else el.style.removeProperty(prop);
          }
          for (const [el, cls] of entry.classes.reverse()) el.classList.add(cls);
        } catch (_) {}
      }
    } finally { selfWriting = false; }
    if (why === 'empty') report('rollback', 'nothing behind the wall — put it back');
  }

  /* Scroll height leads; text length only corroborates, because a headline-heavy page is short. */
  function pageHasContent() {
    try {
      const tall = document.documentElement.scrollHeight > window.innerHeight * 1.4;
      const text = String(document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim();
      return (tall && text.length >= 120) || text.length >= 3000;
    } catch (_) { return false; }
  }

  function report(outcome, detail) {
    if (reported && outcome !== 'rollback') return;
    reported = true;
    try {
      chrome.runtime.sendMessage({ kind: 'anti-adblock-result', outcome }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
    void detail;
  }

  function standDown() {
    stoodDown = true;
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
  }

  function scan() {
    scanQueued = false;
    if (stoodDown || !active || !document.body) return;
    if (passes >= PASS_CAP) { standDown(); return; }

    const found = candidates().filter(isWall);
    if (!found.length) return;
    passes++;

    const entry = { forced: [], classes: [] };
    selfWriting = true;
    try {
      for (const hit of found) force(entry, hit.el, 'display', 'none');
      releaseLock(entry);
    } finally { selfWriting = false; }
    undone.push(entry);

    /* Measure after a frame or two: the page needs to reflow before "is anything behind this"
       can be answered, and a site that redraws its wall does it in about that time. */
    later(() => {
      if (!active) return;
      if (!pageHasContent()) { restoreAll('empty'); standDown(); return; }
      report('restored', 'hid an ad-block wall');
    }, 400);
  }

  function queueScan(delay) {
    if (scanQueued || stoodDown || !active) return;
    scanQueued = true;
    later(scan, delay || 150);
  }

  function askContentConfig(need, cb) {
    try {
      const viaBridge = window.__wardenOneContentConfigRequest;
      if (typeof viaBridge === 'function') { viaBridge(need, cb); return; }
    } catch (_) {}
    try {
      chrome.runtime.sendMessage({ kind: 'content-config-get', need }, cb);
    } catch (_) { try { cb(null); } catch (__) {} }
  }

  function start() {
    if (observer || stoodDown) return;
    observer = new MutationObserver(() => { if (!selfWriting) queueScan(150); });
    try {
      observer.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
      });
    } catch (_) {}
    queueScan(300);
  }

  window.__wardenOneAntiAdblockDispose = () => {
    try { restoreAll('dispose'); } catch (_) {}
    standDown();
    timers.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    timers.clear();
  };

  askContentConfig(['overrides'], (res) => {
    void chrome.runtime.lastError;
    const overrides = (!chrome.runtime.lastError && res && res.ok && res.overrides) || {};
    config = Object.assign({}, config, overrides);
    active = api.activeForHost(config, location.hostname);
    if (!active) { loaderGuardOff = true; return; }
    window.__wardenOneAntiAdblockReadyVersion = ANTI_ADBLOCK_VERSION;
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
})();

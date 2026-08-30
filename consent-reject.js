/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  const CONSENT_REJECT_VERSION = '1.0.1';
  if (window.__wardenOneConsentRejectReadyVersion === CONSENT_REJECT_VERSION) return;
  /* A different version means this frame holds an older copy -- after an update, or because
     Repair reinstalled over it. Release what that copy held first, or both stay live and both
     answer. */
  if (window.__wardenOneConsentRejectReadyVersion) {
    try {
      if (typeof window.__wardenOneConsentRejectDispose === 'function') window.__wardenOneConsentRejectDispose();
    } catch (_) {}
  }
  window.__wardenOneConsentRejectVersion = CONSENT_REJECT_VERSION;

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
  // and they have no equivalent of removeEventListener-by-signal. Repair reinstalls this script in
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

  window.__wardenOneConsentRejectDispose = () => {
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

  /* chrome.storage.onChanged is not one of the events woOnMessage covers, but it lands in the
     same registry, so the dispose above releases it with everything else. */
  const woOnStorage = (fn) => {
    try {
      chrome.storage.onChanged.addListener(fn);
      woChromeListeners.push([chrome.storage.onChanged, fn]);
    } catch (_) {}
    return fn;
  };

  const DEFAULTS = {
    enabled: true,
    autoRejectConsent: true,
    allowlist: [],
  };
  const COMPAT_ALLOWLIST = ['shopify.com'];

  const CONSENT_FRAME_HINT_RE = /\b(cookie|consent|privacy|gdpr|ccpa|cpra|cmp|onetrust|didomi|usercentrics|trustarc|truste|sourcepoint|quantcast|iubenda|cookiebot|cookieyes|osano|termly|axeptio|civic|crownpeak|cookielaw|cookiehub|ketch|privacy-manager|consent-manager|sp_message|sp_choice|qc-cmp|ot-sdk|cky)\b/i;
  const isTopFrame = (() => {
    try { return window.top === window; } catch (_) { return false; }
  })();
  const compatibilityHost = String(location.hostname || '').toLowerCase();
  if (/^(drive|docs|mail|calendar|classroom|meet|chat|myaccount)\.google\.com$/i.test(compatibilityHost)
      || /(^|\.)ucas\.com$/i.test(compatibilityHost)
      || /\.ac\.uk$|\.edu$|\.edu\.au$|\.ac\.nz$|\.ac\.za$|\.ac\.in$|\.edu\.sg$|\.edu\.hk$/i.test(compatibilityHost)
      || /(^|\.)github\.com$/i.test(compatibilityHost)
      || /(^|\.)(openathens\.net|shibboleth\.net)$/i.test(compatibilityHost)) return;
  if (!isTopFrame && !CONSENT_FRAME_HINT_RE.test(String(location.hostname || '') + ' ' + String(location.pathname || ''))) {
    return;
  }

  let config = Object.assign({}, DEFAULTS);
  let active = false;
  let observer = null;
  let scanQueued = false;
  let started = false;
  let openSettingsUntil = 0;
  let lastLogAt = 0;

  const clicked = new WeakSet();
  const opened = new WeakSet();

  const CONTAINER_SELECTOR = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    'dialog',
    '[id*="cookie" i]',
    '[class*="cookie" i]',
    '[id*="consent" i]',
    '[class*="consent" i]',
    '[id*="privacy" i]',
    '[class*="privacy" i]',
    '[id*="gdpr" i]',
    '[class*="gdpr" i]',
    '[id*="cmp" i]',
    '[class*="cmp" i]',
    '[id*="onetrust" i]',
    '[class*="onetrust" i]',
    '[id*="didomi" i]',
    '[class*="didomi" i]',
    '[id*="usercentrics" i]',
    '[class*="usercentrics" i]',
    '[id*="trustarc" i]',
    '[class*="trustarc" i]',
    '[id*="sourcepoint" i]',
    '[class*="sourcepoint" i]',
    '[id*="qc-cmp" i]',
    '[class*="qc-cmp" i]',
    '[id*="cookieyes" i]',
    '[class*="cookieyes" i]',
    '[id*="cky" i]',
    '[class*="cky" i]',
    '[id*="osano" i]',
    '[class*="osano" i]',
    '[id*="termly" i]',
    '[class*="termly" i]',
    '[id*="axeptio" i]',
    '[class*="axeptio" i]',
    '[id*="truste" i]',
    '[class*="truste" i]',
    '[id*="cookielaw" i]',
    '[class*="cookielaw" i]',
    '[id*="cookiehub" i]',
    '[class*="cookiehub" i]',
    '[id*="privacy-manager" i]',
    '[class*="privacy-manager" i]',
    '[aria-label*="cookie" i]',
    '[aria-label*="consent" i]',
    '[aria-label*="privacy" i]',
    '[data-testid*="cookie" i]',
    '[data-testid*="consent" i]',
    '[data-testid*="privacy" i]',
  ].join(',');

  const CONTROL_SELECTOR = [
    'button',
    'a[href]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="checkbox"]',
    'input[type="radio"]',
    'label',
    '[role="button"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[aria-checked]',
    '[tabindex]',
    '[onclick]',
    '[data-action]',
    '[data-testid]',
    '[data-test]',
    '[data-cy]',
  ].join(',');

  const STRONG_CONSENT_TEXT_RE = /\b(cookie|cookies|consent|gdpr|ccpa|cpra|cmp|onetrust|didomi|usercentrics|trustarc|truste|sourcepoint|quantcast|iubenda|cookiebot|cookieyes|osano|termly|axeptio|civic|crownpeak|cookielaw|cookiehub|ketch|advertising choices|personal(?:ized|ised) ads?|legitimate interest|vendors?|partners?|tracking|do not sell|do not share)\b/i;
  const WEAK_CONSENT_TEXT_RE = /\b(privacy|preferences?)\b/i;
  const CONSENT_ACTION_TEXT_RE = /\b(reject(?:\s+all)?|decline(?:\s+all)?|deny(?:\s+all)?|refuse(?:\s+all)?|accept(?:\s+all)?|manage(?:\s+(?:options|choices|settings|privacy|consent))?|cookie\s+settings|privacy\s+settings|necessary\s+only|essential\s+only|opt\s*out|object\s+to\s+all|do\s+not\s+(?:sell|share|consent)|don'?t\s+consent|vendors?|partners?|tracking|advertising choices?|alle ablehnen|tout refuser|rechazar todo|rifiuta|afwijzen|weigeren|odrzu|rejeitar)\b/i;
  const REJECT_RE = /\b(reject(?:\s+all)?|reject\s+optional|decline(?:\s+all)?|deny(?:\s+all)?|refuse(?:\s+all)?|disagree|do\s+not\s+(?:accept|agree|consent|sell|share)|don'?t\s+consent|(?:strictly\s+)?(?:necessary|essential|required)(?:\s+cookies?)?\s+only|only\s+(?:strictly\s+)?(?:necessary|essential|required)(?:\s+cookies?)?|use\s+(?:strictly\s+)?(?:necessary|essential|required)(?:\s+cookies?)?|save\s+without\s+accepting|continue\s+without\s+accepting|opt\s*out|object\s+to\s+all|disable\s+all|turn\s+off\s+all|withdraw\s+consent|alle ablehnen|tout refuser|rechazar todo|rifiuta tutt|afwijzen|alles weigeren|odrzu|rejeitar tudo|avvisa alla)\b/i;
  const OPEN_SETTINGS_RE = /\b(customi[sz]e|manage(?:\s+(?:options|choices|settings|privacy|consent|preferences))?|cookie\s+settings|privacy\s+settings|privacy\s+choices|preferences?|settings|options|choices|more\s+options|configure|set\s+preferences)\b/i;
  const SAVE_CHOICES_RE = /\b(save|confirm|apply|submit|store|update|finish|done)\b.*\b(choices?|preferences?|settings?|selection|privacy|consent)\b|\b(confirm|save|apply)\s+my\s+choices?\b|\b(save|confirm|apply)\s+selection\b|\bclose\s+and\s+save\b/i;
  const OPTIONAL_PURPOSE_RE = /\b(advertis(?:e|ing|ement)|marketing|personal(?:ization|isation|ized|ised)|target(?:ed|ing)?|analytics?|statistics?|measurement|performance|social\s+media|social\s+networks?|vendors?|partners?|third[\s-]?part(?:y|ies)|legitimate\s+interest|profiling|sale|share|tracking|remarketing|recommendations?|experiments?|audience|commercial|optional|non[\s-]?essential)\b/i;
  const REQUIRED_PURPOSE_RE = /\b(strictly\s+necessary|necessary|essential|required|security|fraud|authentication|session|login|sign[\s-]?in|payment|billing|checkout|cart|basket|order|functional|preferences?\s+only)\b/i;
  const ACCEPT_RE = /\b(accept(?:\s+all)?|agree|allow(?:\s+all)?|ok(?:ay)?|got\s+it|yes|enable(?:\s+all)?|i\s+understand)\b/i;
  // Account / login / payment / destructive-action context. We NEVER synthesize a click on a
  // control OR inside a container whose own text matches this -- even if it also looks like a
  // consent banner (e.g. an account "Privacy settings" modal that happens to carry a "Disable
  // all" toggle, a checkout step, or a "Sign in to manage" prompt). Checked against the
  // element's OWN text only, never the page-wide body (almost every site's header says "Sign
  // in"/"Account"). Erring toward NOT clicking is the safe direction for an automated click.
  const PROTECT_RE = /\b(sign[\s-]?in|signed[\s-]?in|sign[\s-]?out|signed[\s-]?out|log[\s-]?in|log[\s-]?on|log[\s-]?out|logged[\s-]?out|logout|sign[\s-]?up|register|create\s+account|account\s+settings|your\s+account|my\s+account|profile|subscription|wallet|bank\s+account|sort\s+code|routing\s+number|iban|transfer|withdraw|deposit|password|passcode|2fa|two[\s-]?factor|verification\s+code|one[\s-]?time\s+code|payment|billing|checkout|secure\s+checkout|purchase|place\s+order|buy\s+now|pay\s+now|donate|card\s+number|shipping|delivery\s+address|refund|delete\s+account|deactivate|close\s+account|unsubscribe|confirm\s+your)\b/i;
  // A consent surface may contain an unrelated account link in its header. Treating that one
  // label as the context of the entire dialog causes an otherwise unambiguous reject/accept
  // choice to be missed. High-risk account, payment, and destructive language remains a hard
  // veto. Authentication-only language is ignored only when the same bounded surface exposes
  // an explicit reject/accept pair and strong consent language.
  const HARD_PROTECT_RE = /\b(create\s+account|account\s+settings|(?:account|user)\s+profile|profile\s+settings|subscription\s+(?:settings|plan)|wallet|bank\s+account|sort\s+code|routing\s+number|iban|(?:bank|wire)\s+transfer|transfer\s+(?:funds|money)|withdraw\s+(?:funds|money|cash)|deposit\s+(?:funds|money|cash)|password|passcode|2fa|two[\s-]?factor|verification\s+code|one[\s-]?time\s+code|payment|billing|checkout|secure\s+checkout|purchase|place\s+order|buy\s+now|pay\s+now|donate|card\s+number|shipping|delivery\s+address|refund|delete\s+account|deactivate|close\s+account|unsubscribe|confirm\s+your\s+(?:order|purchase|payment|account|identity|password|email|address))\b/i;
  const EXPLICIT_REJECT_RE = /^\s*(?:reject|decline|deny|refuse)(?:\s+(?:all|optional))?[.!]?\s*$/i;
  const EXPLICIT_ACCEPT_RE = /^\s*(?:accept|allow)(?:\s+all)?[.!]?\s*$/i;
  const INFO_LINK_RE = /\b(cookie\s+choices?|cookie\s+notice|cookie\s+policy|privacy\s+(?:notice|policy|choices?)|legal|terms|learn\s+more)\b/i;

  function cleanHost(value) {
    return String(value || '').replace(/^www\./i, '').toLowerCase();
  }

  function hostAllowed() {
    const host = cleanHost(location.hostname);
    const list = COMPAT_ALLOWLIST.concat(Array.isArray(config.allowlist) ? config.allowlist : []);
    return list.some((item) => {
      const d = cleanHost(item);
      return d && (host === d || host.endsWith('.' + d));
    });
  }

  function updateActive() {
    const rejectOn = config.autoRejectConsent === true || config.autoRejectConsent === 'true' || config.autoRejectConsent === 1;
    active = config.enabled !== false && rejectOn && !hostAllowed();
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

  function elementText(el) {
    try {
      const bits = [
        el.innerText,
        el.textContent,
        el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title'),
        el.getAttribute && el.getAttribute('value'),
        el.getAttribute && el.getAttribute('data-testid'),
        el.getAttribute && el.getAttribute('data-test'),
        el.getAttribute && el.getAttribute('data-cy'),
        el.getAttribute && el.getAttribute('data-action'),
        el.getAttribute && el.getAttribute('data-consent-action'),
        el.getAttribute && el.getAttribute('aria-checked'),
        el.id,
        typeof el.className === 'string' ? el.className : '',
        el.name,
      ];
      return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    } catch (_) {
      return '';
    }
  }

  function isUnsafeAutoClickLink(el) {
    try {
      if (!el || String(el.tagName || '').toLowerCase() !== 'a') return false;
      const raw = String(el.getAttribute('href') || '').trim();
      if (!raw || raw === '#' || raw[0] === '#' || /^javascript:/i.test(raw)) return false;
      const target = String(el.getAttribute('target') || '').toLowerCase();
      const url = new URL(raw, location.href);
      if (target === '_blank') return true;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
      if (url.origin !== location.origin) return true;
      if (url.pathname !== location.pathname) return true;
      if (INFO_LINK_RE.test(elementText(el) + ' ' + raw)) return true;
      return false;
    } catch (_) {
      return true;
    }
  }

  function isVisible(el) {
    try {
      if (!el || !el.isConnected) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    } catch (_) {
      return false;
    }
  }

  function collectRoots(root) {
    const roots = [root];
    try {
      const start = root && root.nodeType === 9 ? root.documentElement : root;
      if (!start) return roots;
      let seen = 0;
      const addShadow = (el) => { if (el && el.shadowRoot) roots.push(el.shadowRoot); };
      if (start.nodeType === 1) { addShadow(start); seen++; }
      const walker = document.createTreeWalker(start, 1);
      let el;
      while (seen < 1800 && (el = walker.nextNode())) {
        seen++;
        addShadow(el);
      }
    } catch (_) {}
    return roots;
  }

  function hasConsentLanguage(text) {
    text = String(text || '');
    return STRONG_CONSENT_TEXT_RE.test(text) || (WEAK_CONSENT_TEXT_RE.test(text) && CONSENT_ACTION_TEXT_RE.test(text));
  }

  function hasStrongConsentLanguage(text) {
    return STRONG_CONSENT_TEXT_RE.test(String(text || ''));
  }

  function explicitConsentDecisionPair(container, rejectControl) {
    try {
      if (!container || !hasStrongConsentLanguage(elementText(container))) return false;
      let reject = rejectControl && isVisible(rejectControl) && EXPLICIT_REJECT_RE.test(controlLabel(rejectControl));
      let accept = false;
      const roots = [container].concat(collectRoots(container));
      const seen = new Set();
      let inspected = 0;
      for (const root of roots) {
        const list = root && root.querySelectorAll ? root.querySelectorAll(CONTROL_SELECTOR) : [];
        for (let i = 0; i < list.length && inspected < 120; i++) {
          const el = list[i];
          if (seen.has(el)) continue;
          seen.add(el);
          inspected++;
          if (!isVisible(el) || isUnsafeAutoClickLink(el)) continue;
          const label = controlLabel(el);
          if (EXPLICIT_REJECT_RE.test(label)) reject = true;
          if (EXPLICIT_ACCEPT_RE.test(label)) accept = true;
          if (reject && accept) return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function protectedContainerContext(container, rejectControl) {
    const text = elementText(container);
    if (!PROTECT_RE.test(text)) return false;
    if (HARD_PROTECT_RE.test(text)) return true;
    return !explicitConsentDecisionPair(container, rejectControl);
  }

  function looksLikeConsentContainer(el) {
    if (!el || !isVisible(el)) return false;
    const text = elementText(el);
    if (protectedContainerContext(el, null)) return false;
    if (hasConsentLanguage(text)) return true;
    try {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const fixedBanner = /^(fixed|sticky)$/i.test(style.position) && box.width > Math.min(320, innerWidth * 0.45) && box.height > 45;
      return fixedBanner && hasStrongConsentLanguage((document.body && document.body.innerText || '').slice(0, 4000));
    } catch (_) {
      return false;
    }
  }

  function containerScore(el) {
    try {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      const position = getComputedStyle(el).position;
      let score = 0;
      if (/^(fixed|sticky)$/i.test(position)) score += 30;
      if (area > 25000) score += 20;
      if (/\b(dialog|banner|modal|cookie|consent|privacy|cmp|gdpr)\b/i.test(elementText(el))) score += 30;
      return score;
    } catch (_) {
      return 0;
    }
  }

  function getContainers() {
    const out = [];
    const roots = collectRoots(document);
    roots.forEach((root) => {
      try {
        const list = root.querySelectorAll(CONTAINER_SELECTOR);
        for (let i = 0; i < list.length; i++) {
          const el = list[i];
          if (looksLikeConsentContainer(el)) out.push(el);
        }
      } catch (_) {}
    });
    return Array.from(new Set(out)).sort((a, b) => containerScore(b) - containerScore(a)).slice(0, 20);
  }

  function getControls(container) {
    const roots = [container].concat(collectRoots(container));
    const out = [];
    const seen = new Set();
    for (let r = 0; r < roots.length && out.length < 240; r++) {
      const root = roots[r];
      try {
        const list = root.querySelectorAll(CONTROL_SELECTOR);
        for (let i = 0; i < list.length && out.length < 240; i++) {
          const el = list[i];
          if (!seen.has(el) && isVisible(el)) {
            seen.add(el);
            out.push(el);
          }
        }
      } catch (_) {}
    }
    return out;
  }

  function controlLabel(el) {
    try {
      const bits = [
        el.innerText,
        el.textContent,
        el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title'),
        el.getAttribute && el.getAttribute('value'),
        el.getAttribute && el.getAttribute('data-testid'),
        el.getAttribute && el.getAttribute('data-test'),
        el.getAttribute && el.getAttribute('data-cy'),
        el.getAttribute && el.getAttribute('data-action'),
      ];
      for (const bit of bits) {
        const text = String(bit || '').replace(/\s+/g, ' ').trim();
        if (text) return text;
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function associatedText(el, container) {
    try {
      const bits = [elementText(el)];
      const id = el && el.id;
      if (id) {
        try {
          document.querySelectorAll('label[for="' + CSS.escape(id) + '"]').forEach((label) => bits.push(elementText(label)));
        } catch (_) {}
      }
      if (el && el.closest) {
        const label = el.closest('label');
        if (label) bits.push(elementText(label));
      }
      let n = el && el.parentElement;
      for (let i = 0; n && n !== container && n !== document.body && i < 3; i++, n = n.parentElement) {
        bits.push(elementText(n).slice(0, 700));
      }
      return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1800);
    } catch (_) {
      return elementText(el);
    }
  }

  function isConsentToggle(el) {
    try {
      if (!el) return false;
      const tag = String(el.tagName || '').toLowerCase();
      const type = String(el.type || el.getAttribute && el.getAttribute('type') || '').toLowerCase();
      const role = String(el.getAttribute && el.getAttribute('role') || '').toLowerCase();
      return (tag === 'input' && /^(checkbox|radio)$/.test(type)) || role === 'switch' || role === 'checkbox' || el.hasAttribute && el.hasAttribute('aria-checked');
    } catch (_) {
      return false;
    }
  }

  function toggleIsOn(el) {
    try {
      if (!el) return false;
      if (typeof el.checked === 'boolean') return el.checked;
      const aria = el.getAttribute && el.getAttribute('aria-checked');
      if (/^(true|mixed)$/i.test(String(aria || ''))) return true;
      if (/^(false)$/i.test(String(aria || ''))) return false;
      const blob = elementText(el);
      return /\b(on|enabled|active|checked|selected|allow(?:ed)?|accept(?:ed)?|consent(?:ed)?)\b/i.test(blob)
        && !/\b(off|disabled|inactive|unchecked|denied|rejected|opted\s*out)\b/i.test(blob);
    } catch (_) {
      return false;
    }
  }

  function optionalToggleCandidate(el, container) {
    if (!isConsentToggle(el) || !toggleIsOn(el)) return false;
    if (clicked.has(el)) return false;
    const label = associatedText(el, container);
    if (!label || PROTECT_RE.test(label)) return false;
    if (REQUIRED_PURPOSE_RE.test(label) && !OPTIONAL_PURPOSE_RE.test(label)) return false;
    return OPTIONAL_PURPOSE_RE.test(label) && hasConsentLanguage(elementText(container));
  }

  function turnOffOptionalToggles(container) {
    let changed = 0;
    try {
      const roots = [container].concat(collectRoots(container));
      const seen = new Set();
      for (const root of roots) {
        const list = root.querySelectorAll && root.querySelectorAll('input[type="checkbox"],input[type="radio"],[role="switch"],[role="checkbox"],[aria-checked]');
        if (!list) continue;
        for (let i = 0; i < list.length && changed < 18; i++) {
          const el = list[i];
          if (seen.has(el) || !isVisible(el)) continue;
          seen.add(el);
          if (!optionalToggleCandidate(el, container)) continue;
          if (clickControl(el)) changed++;
        }
      }
    } catch (_) {}
    return changed;
  }

  function saveChoicesCandidate(el, container, changed) {
    const label = elementText(el);
    if (!changed || !label || !SAVE_CHOICES_RE.test(label)) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    if (PROTECT_RE.test(label)) return false;
    if (!hasConsentLanguage(elementText(container))) return false;
    if (ACCEPT_RE.test(label) && !/without\s+accepting|reject|decline|deny|refuse|necessary|essential|required|opt\s*out|save|confirm|apply/i.test(label)) return false;
    return true;
  }

  function visibleControlsInDocument() {
    const out = [];
    const seen = new Set();
    const roots = collectRoots(document);
    for (let r = 0; r < roots.length && out.length < 500; r++) {
      const root = roots[r];
      try {
        const list = root.querySelectorAll(CONTROL_SELECTOR);
        for (let i = 0; i < list.length && out.length < 500; i++) {
          const el = list[i];
          if (!seen.has(el) && isVisible(el)) {
            seen.add(el);
            out.push(el);
          }
        }
      } catch (_) {}
    }
    return out;
  }

  function tryTwitchReject() {
    try {
      if (!/(^|\.)twitch\.tv$/i.test(location.hostname)) return false;
      const pageText = ((document.body && document.body.innerText) || document.documentElement.innerText || '').slice(0, 8000);
      if (!/Cookies and Advertising Choices|Twitch uses personal data|trusted third party partners/i.test(pageText)) return false;
      const buttons = visibleControlsInDocument();
      const reject = buttons.find((el) => /^reject(?:\s+all)?$/i.test(controlLabel(el)) && !isUnsafeAutoClickLink(el));
      if (reject && clickControl(reject)) {
        releasePageLock();
        woTimeout(releasePageLock, 250);
        woTimeout(releasePageLock, 900);
        logAction('reject', 'Twitch cookie banner: Reject');
        woTimeout(queueScan, 250);
        woTimeout(queueScan, 900);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function safeRejectCandidate(el) {
    const label = elementText(el);
    if (!label) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    if (!REJECT_RE.test(label)) return false;
    if (PROTECT_RE.test(label)) return false; // never click a control that is also an account/payment/destructive action
    if (ACCEPT_RE.test(label) && !/without\s+accepting|do\s+not\s+consent|don'?t\s+consent|reject|decline|deny|refuse|disable|turn\s+off|opt\s*out/i.test(label)) return false;
    return true;
  }

  // Walk up from a reject control looking for an ancestor that plainly reads as a cookie/consent
  // banner (strong consent language, not an account/payment surface, banner-sized). Lets us trust
  // a reject click on sites whose banner carries no cookie/consent id/class/role attribute.
  function consentBannerAncestor(el) {
    try {
      let n = el && el.parentElement;
      for (let depth = 0; n && n !== document.body && n !== document.documentElement && depth < 9; depth++, n = n.parentElement) {
        if (!isVisible(n)) continue;
        const own = elementText(n);
        if (!hasStrongConsentLanguage(own) || protectedContainerContext(n, el)) continue;
        const rect = n.getBoundingClientRect();
        const area = rect.width * rect.height;
        const viewport = Math.max(1, innerWidth * innerHeight);
        const positioned = /^(fixed|sticky|absolute)$/i.test(getComputedStyle(n).position);
        const bannerSized = area <= viewport * 0.75 && rect.width >= 200 && rect.height >= 40;
        if (bannerSized || (positioned && rect.height >= 40 && rect.height <= viewport * 0.75)) return n;
      }
    } catch (_) {}
    return null;
  }

  // Fallback for consent bars that expose no cookie/consent id/class/role (e.g. X/Twitter's
  // obfuscated `css-*` "BottomBar", where getContainers() finds nothing): scan visible controls
  // document-wide for a genuine reject button sitting inside a real consent banner. The
  // safeRejectCandidate + strong-consent-language + PROTECT guards keep this from firing on
  // unrelated "Decline"/"Deny" buttons, and it never clicks an accept-only control.
  function tryGenericReject() {
    try {
      const controls = visibleControlsInDocument();
      for (const el of controls) {
        if (clicked.has(el)) continue;
        if (!safeRejectCandidate(el)) continue;
        if (!consentBannerAncestor(el)) continue;
        if (clickControl(el)) {
          releasePageLock();
          woTimeout(releasePageLock, 250);
          woTimeout(releasePageLock, 900);
          logAction('reject', elementText(el));
          woTimeout(queueScan, 250);
          woTimeout(queueScan, 900);
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function settingsCandidate(el, container) {
    const label = elementText(el);
    if (!label || !OPEN_SETTINGS_RE.test(label)) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    if (PROTECT_RE.test(label)) return false; // don't open an account/billing "settings" control
    if (!hasConsentLanguage(elementText(container))) return false;
    if (/^\s*(settings|preferences?|privacy)\s*$/i.test(controlLabel(el)) && !hasStrongConsentLanguage(elementText(container))) return false;
    return !ACCEPT_RE.test(label);
  }

  function clickControl(el) {
    if (!el || clicked.has(el)) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    clicked.add(el);
    try { el.focus({ preventScroll: true }); } catch (_) {}
    try { el.click(); } catch (_) {}
    return true;
  }

  function releasePageLock() {
    return;
    try {
      const unlock = (el) => {
        if (!el) return;
        try { el.style.setProperty('overflow', 'auto', 'important'); } catch (_) {}
        try { el.style.setProperty('pointer-events', 'auto', 'important'); } catch (_) {}
        try {
          ['modal-open', 'no-scroll', 'noscroll', 'overflow-hidden', 'is-clipped', 'ReactModal__Body--open']
            .forEach((cls) => el.classList && el.classList.remove(cls));
        } catch (_) {}
      };
      unlock(document.documentElement);
      unlock(document.body);

      const visibleModal = Array.from(document.querySelectorAll('[aria-modal="true"],dialog[open]')).some((el) => isVisible(el));
      document.querySelectorAll('[inert]').forEach((el) => {
        try { el.removeAttribute('inert'); } catch (_) {}
      });
      if (!visibleModal) {
        document.querySelectorAll('body > [aria-hidden="true"],main[aria-hidden="true"],#root[aria-hidden="true"],#app[aria-hidden="true"],[data-reactroot][aria-hidden="true"]').forEach((el) => {
          try { el.removeAttribute('aria-hidden'); } catch (_) {}
        });
      }

      document.querySelectorAll('body > .modal-backdrop,body > [class*="backdrop" i],body > [id*="backdrop" i],body > [class*="overlay" i],body > [id*="overlay" i],body > [class*="scrim" i],body > [id*="scrim" i],body > [class*="veil" i],body > [id*="veil" i]').forEach((el) => {
        try {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const text = String(el.innerText || el.textContent || '').trim();
          const blob = text + ' ' + String(el.id || '') + ' ' + String(el.className || '');
          const full = rect.width >= innerWidth * 0.7 && rect.height >= innerHeight * 0.7 && rect.left <= innerWidth * 0.18 && rect.top <= innerHeight * 0.18;
          const fixed = /^(fixed|absolute|sticky)$/i.test(style.position);
          const backdrop = /backdrop|overlay|scrim|veil|modal|cookie|consent|cmp|onetrust|didomi|trustarc|truste|usercentrics|sourcepoint|quantcast|iubenda|cookiebot|cookieyes|osano|termly|axeptio|civic|crownpeak|cookielaw|cookiehub|ketch|privacy-manager/i.test(blob);
          if (fixed && full && (backdrop || text.length < 60)) {
            el.style.setProperty('display', 'none', 'important');
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  // The one case auto-reject cannot help with: a banner offering no way to say no,
  // where the user clicks Accept themselves to get at the page. Noting that lets the
  // worker tidy up after them when they leave. Only a real click counts -- a
  // synthetic one is the page consenting on its own behalf, which is not consent.
  let acceptReported = false;
  woOn(document, 'click', (event) => {
    try {
      if (acceptReported || !event || event.isTrusted !== true) return;
      const el = event.target && event.target.closest
        ? event.target.closest('button,[role="button"],a,input[type="button"],input[type="submit"]')
        : null;
      if (!el) return;
      const label = elementText(el);
      if (!label || !ACCEPT_RE.test(label)) return;
      if (REJECT_RE.test(label)) return;
      if (!consentBannerAncestor(el)) return;
      acceptReported = true;
      chrome.runtime.sendMessage({ kind: 'consent-accepted' }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }, true);

  // Clearing the tracking IDs a site keeps in localStorage, on the way out.
  //
  // This is where the tracking went when third-party cookies started dying: the
  // analytics vendors keep their client id here now, and nothing was touching it.
  // It is also where most sites keep the session token, so this can only ever work
  // by name -- never a wholesale wipe, which is all the browsingData API can do for
  // an origin and which would sign the user out of everything they visited.
  //
  // Three ideas make it safe enough to run unattended:
  //
  // 1. Only VENDOR namespaces. A key is removed because it belongs to a company
  //    whose entire business is measurement, not because it looks tracker-ish. That
  //    is why the guard below is a list of prefixes rather than a pattern: "_hj"
  //    is Hotjar's whole namespace and nothing else lives there, whereas anything
  //    matching /track|analytics|id/ would eventually eat somebody's app state.
  // 2. Vendor names win over the session guard, deliberately. Several of these
  //    read as credentials -- _hjSessionUser, _uetsid, ajs_user_id -- and a blanket
  //    "never touch anything with session in it" rule would quietly cancel the
  //    feature for exactly the vendors it exists for. They are safe because the
  //    namespace is known, not because the name looks harmless.
  // 3. Two vetoes that apply even to a vendor match: a value shaped like a JWT is
  //    a credential whatever its key is called, and a value over a kilobyte is
  //    application state rather than an id. Either one and the key is left alone.
  //
  // Analytics libraries regenerate a missing client id on their next call -- it is
  // their ordinary first-visit path -- so this cannot break a page that is still
  // open in another tab.
  const LS_VENDOR_PREFIX = [
    '_ga', '_gid', '_gat', '__utm',      // Google Analytics, past and present
    '_hj',                                // Hotjar
    '_uet',                               // Microsoft UET
    '_clck', '_clsk',                     // Microsoft Clarity
    'amp_', 'amplitude_',                 // Amplitude
    'mp_', 'mixpanel',                    // Mixpanel
    'ajs_',                               // Segment
    'optimizely',                         // Optimizely
    'ym_', '_ym_',                        // Yandex Metrica
    '_fbp', '_fbc',                       // Meta
    'euconsent', 'addtl_consent', 'usprivacy',
    'OptanonConsent', 'OptanonAlertBoxClosed', 'didomi_', 'CookieConsent',
    'cookieconsent_status',
  ];
  const LS_JWT_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
  const LS_MAX_VALUE = 1024;
  const LS_MAX_KEYS = 40;

  function trackingStorageKey(key, value) {
    const k = String(key || '');
    if (!k) return false;
    const lower = k.toLowerCase();
    if (!LS_VENDOR_PREFIX.some((p) => lower.startsWith(p.toLowerCase()))) return false;
    const v = String(value == null ? '' : value);
    if (v.length > LS_MAX_VALUE) return false;
    if (LS_JWT_RE.test(v.trim())) return false;
    return true;
  }

  function clearTrackingStorage() {
    let removed = 0;
    try {
      if (config.clearCookiesOnLeave !== true) return 0;
      const doomed = [];
      for (let i = 0; i < localStorage.length && doomed.length < LS_MAX_KEYS; i++) {
        const key = localStorage.key(i);
        let value = '';
        try { value = localStorage.getItem(key); } catch (_) { continue; }
        if (trackingStorageKey(key, value)) doomed.push(key);
      }
      for (const key of doomed) {
        try { localStorage.removeItem(key); removed++; } catch (_) {}
      }
    } catch (_) {
      // Storage can be unavailable entirely (a sandboxed frame, or the user has
      // site data switched off). Nothing to do and nothing to report.
      return 0;
    }
    return removed;
  }

  let storageCleared = false;
  function sweepStorageOnLeave() {
    if (storageCleared || !acceptReported) return;
    storageCleared = true;
    const removed = clearTrackingStorage();
    if (!removed) return;
    try {
      chrome.runtime.sendMessage({ kind: 'consent-accepted', clearedStorage: removed },
        () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  woOn(window, 'pagehide', sweepStorageOnLeave, true);

  function logAction(kind, label) {
    const now = Date.now();
    if (now - lastLogAt < 1200) return;
    lastLogAt = now;
    try {
      chrome.runtime.sendMessage({
        kind: 'rg-block',
        type: 'blocked_overlay',
        detail: {
          matched: 'cookie consent: ' + String(label || kind).slice(0, 80),
          why: kind === 'reject' ? 'auto-rejected consent prompt' : 'opened consent choices to reject tracking',
        },
      });
    } catch (_) {}
  }

  function scan() {
    scanQueued = false;
    if (!active || !document.documentElement) return;

    if (tryTwitchReject()) return;

    const containers = getContainers();
    for (const container of containers) {
      const controls = getControls(container);
      const reject = controls.find(safeRejectCandidate);
      if (reject && clickControl(reject)) {
        releasePageLock();
        woTimeout(releasePageLock, 250);
        woTimeout(releasePageLock, 900);
        logAction('reject', elementText(reject));
        woTimeout(queueScan, 250);
        woTimeout(queueScan, 900);
        return;
      }
    }

    if (tryGenericReject()) return;

    for (const container of containers) {
      const changed = turnOffOptionalToggles(container);
      if (!changed) continue;
      const save = getControls(container).find((el) => saveChoicesCandidate(el, container, changed));
      if (save && clickControl(save)) {
        releasePageLock();
        woTimeout(releasePageLock, 250);
        woTimeout(releasePageLock, 900);
        logAction('reject', 'disabled optional consent choices');
        woTimeout(queueScan, 250);
        woTimeout(queueScan, 900);
        return;
      }
      woTimeout(queueScan, 220);
      woTimeout(queueScan, 800);
      return;
    }

    if (Date.now() < openSettingsUntil) return;
    for (const container of containers) {
      if (opened.has(container)) continue;
      const settings = getControls(container).find((el) => settingsCandidate(el, container));
      if (settings && clickControl(settings)) {
        opened.add(container);
        openSettingsUntil = Date.now() + 900;
        logAction('settings', elementText(settings));
        woTimeout(queueScan, 180);
        woTimeout(queueScan, 700);
        woTimeout(queueScan, 1600);
        return;
      }
    }
  }

  function queueScan() {
    if (scanQueued || !active) return;
    scanQueued = true;
    try { requestAnimationFrame(scan); } catch (_) { woTimeout(scan, 40); }
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = woObserver(queueScan);
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'inert', 'open'] });
    } catch (_) {}
    woTimeout(() => {
      try { observer.disconnect(); } catch (_) {}
      observer = null;
    }, 120000);
  }

  function start() {
    if (started) return;
    started = true;
    loadConfig(() => {
      if (!active) return;
      startObserver();
      // Dismiss banners the instant they become clickable so they barely flash. The
      // MutationObserver catches DOM insertions, but a banner that mounts at opacity:0 and
      // CSS-fades in produces no further mutations while it animates -- so without polling we
      // would not act until the next sparse tick (the ~1s "banner shows for a second" lag on
      // Twitch/X). A short high-frequency burst for the first ~2.4s closes that gap; a few
      // sparse late passes still catch slow or deferred banners.
      [0, 50, 140, 260].forEach((ms) => woTimeout(queueScan, ms));
      let fastPolls = 0;
      const fastTimer = woInterval(() => {
        if (!active || fastPolls++ >= 24) { clearInterval(fastTimer); return; }
        queueScan();
      }, 95);
      [3000, 4500, 7000, 11000].forEach((ms) => woTimeout(queueScan, ms));
    });
  }

  try {
    woOnStorage((changes, area) => {
      if (area !== 'local' || !changes.wardenone_config) return;
      config = Object.assign({}, DEFAULTS, changes.wardenone_config.newValue || {});
      const wasActive = active;
      updateActive();
      if (active) {
        startObserver();
        queueScan();
      } else if (wasActive && observer) {
        try { observer.disconnect(); } catch (_) {}
        observer = null;
      }
    });
  } catch (_) {}

  if (document.documentElement) start();
  else woOn(document, 'DOMContentLoaded', start, { once: true });
  window.__wardenOneConsentRejectReadyVersion = CONSENT_REJECT_VERSION;
})();

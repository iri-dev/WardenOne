/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  const CONSENT_REJECT_VERSION = '1.0.3';
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
  /* Preserve the native timer callback’s this binding. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  // Chrome events ignore AbortSignal; retain callback identities for removeListener during disposal.
  const woChromeListeners = [];
  const woOnMessage = (fn) => {
    try {
      chrome.runtime.onMessage.addListener(fn);
      woChromeListeners.push([chrome.runtime.onMessage, fn]);
    } catch (_) {}
    return fn;
  };

  window.__wardenOneConsentRejectDispose = () => {
    outcomeGeneration++;
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
  let scanFinished = false;
  let needsTimedScan = true;
  let outcomeGeneration = 0;

  const clicked = new WeakSet();
  const opened = new WeakSet();
  const changedChoices = new WeakSet();

  // Broad substrings cover cookieyes/cookielaw/cookiehub, qc-cmp and privacy-manager.
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
    '[id="cky" i]',
    '[id^="cky-" i]',
    '[class~="cky" i]',
    '[class^="cky-" i]',
    '[class*=" cky-" i]',
    '[id*="osano" i]',
    '[class*="osano" i]',
    '[id*="termly" i]',
    '[class*="termly" i]',
    '[id*="axeptio" i]',
    '[class*="axeptio" i]',
    '[id*="truste" i]',
    '[class*="truste" i]',
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
  const REJECT_RE = /\b(reject(?:\s+all)?|reject\s+optional|decline(?:\s+all)?|deny(?:\s+all)?|refuse(?:\s+all)?|disagree|do\s+not\s+(?:accept|agree|consent|sell|share)|don'?t\s+consent|(?:strictly\s+)?(?:necessary|essential|required)(?:\s+cookies?)?\s+only|only\s+(?:strictly\s+)?(?:necessary|essential|required)(?:\s+cookies?)?|use\s+(?:strictly\s+)?(?:necessary|essential|required)(?:\s+cookies?)?|save\s+without\s+accepting|continue\s+without\s+accepting|opt\s*out|object\s+to\s+all|disable\s+all|turn\s+off\s+all|withdraw\s+consent|alle ablehnen|tout refuser|rechazar todo|rifiuta(?:\s+tutt[oi])?|afwijzen|alles weigeren|odrzu|rejeitar tudo|avvisa alla)\b/i;
  const OPEN_SETTINGS_RE = /\b(customi[sz]e|manage(?:\s+(?:options|choices|settings|privacy|consent|preferences))?|cookie\s+settings|privacy\s+settings|privacy\s+choices|preferences?|settings|options|choices|more\s+options|configure|set\s+preferences)\b/i;
  const SAVE_CHOICES_RE = /\b(save|confirm|apply|submit|store|update|finish|done)\b.*\b(choices?|preferences?|settings?|selection|privacy|consent)\b|\b(confirm|save|apply)\s+my\s+choices?\b|\b(save|confirm|apply)\s+selection\b|\bclose\s+and\s+save\b/i;
  const OPTIONAL_PURPOSE_RE = /\b(advertis(?:e|ing|ement)|marketing|personal(?:ization|isation|ized|ised)|target(?:ed|ing)?|analytics?|statistics?|measurement|performance|social\s+media|social\s+networks?|vendors?|partners?|third[\s-]?part(?:y|ies)|legitimate\s+interest|profiling|sale|share|tracking|remarketing|recommendations?|experiments?|audience|commercial|optional|non[\s-]?essential)\b/i;
  const REQUIRED_PURPOSE_RE = /\b(strictly\s+necessary|necessary|essential|required|security|fraud|authentication|session|login|sign[\s-]?in|payment|billing|checkout|cart|basket|order|functional|preferences?\s+only)\b/i;
  const ACCEPT_RE = /\b(accept(?:\s+all)?|agree|allow(?:\s+all)?|ok(?:ay)?|got\s+it|yes|enable(?:\s+all)?|i\s+understand)\b/i;
  // Veto account, payment and destructive contexts using bounded element text, never the whole page. Automated clicks must
  // fail toward leaving the control alone.
  const PROTECT_RE = /\b(sign[\s-]?in|signed[\s-]?in|sign[\s-]?out|signed[\s-]?out|log[\s-]?in|log[\s-]?on|log[\s-]?out|logged[\s-]?out|logout|sign[\s-]?up|register|create\s+account|account\s+settings|your\s+account|my\s+account|profile|subscription|wallet|bank\s+account|sort\s+code|routing\s+number|iban|transfer|withdraw|deposit|password|passcode|2fa|two[\s-]?factor|verification\s+code|one[\s-]?time\s+code|payment|billing|checkout|secure\s+checkout|purchase|place\s+order|buy\s+now|pay\s+now|donate|card\s+number|shipping|delivery\s+address|refund|delete\s+account|deactivate|close\s+account|unsubscribe|confirm\s+your)\b/i;
  // An unrelated sign-in link may coexist with consent controls. Ignore authentication-only text only with strong consent
  // language and an explicit reject/accept pair; retain high-risk vetoes.
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

  /* The settings snapshot, asked for through the bridge when it has run here (MV3-04). The
     isolated bridge owns acquisition: it retries when the worker dies mid-reply and answers from
     the snapshot it already holds when only the switches are needed, so this makes a one-shot
     request of its own only when no bridge is present in this frame. */
  function askContentConfig(need, cb) {
    try {
      const viaBridge = window.__wardenOneContentConfigRequest;
      if (typeof viaBridge === 'function') { viaBridge(need, cb); return; }
    } catch (_) {}
    try { chrome.runtime.sendMessage({ kind: 'content-config-get', need: need }, cb); } catch (_) { try { cb(null); } catch (__) {} }
  }

  function validConsentConfig(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.enabled === 'boolean'
      && [true, false, 'true', 'false', 1, 0].includes(value.autoRejectConsent);
  }
  function loadConfig(done) {
    askContentConfig(['overrides'], (res) => {
      void chrome.runtime.lastError;
      if (chrome.runtime.lastError || !res || res.ok !== true || !validConsentConfig(res.overrides)) {
        active = false; outcomeGeneration++;
        if (typeof done === 'function') done();
        return;
      }
      config = Object.assign({}, DEFAULTS, res.overrides);
      updateActive();
      if (!active) outcomeGeneration++;
      if (typeof done === 'function') done();
    });
  }

  function elementText(el) {
    try {
      const bits = [
        // Use textContent here to avoid layout; joined labels normalize the same whitespace. controlLabel retains innerText
        // because its first-truthy selection differs.
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
      // Reject off-screen rectangles before getComputedStyle; both checks remain required for visible candidates.
      const rect = el.getBoundingClientRect();
      if (!(rect.width >= 8 && rect.height >= 8 && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth)) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    } catch (_) {
      return false;
    }
  }

  function collectRoots(root) {
    const roots = [root];
    try {
      let seen = 0;
      for (let index = 0; index < roots.length && seen < 1800; index++) {
        const part = roots[index], start = part && part.nodeType === 9 ? part.documentElement : part;
        if (!start) continue;
        const addShadow = (el) => { if (el && el.shadowRoot) roots.push(el.shadowRoot); };
        if (start.nodeType === 1) { addShadow(start); seen++; }
        const walker = document.createTreeWalker(start, 1);
        let el;
        while (seen < 1800 && (el = walker.nextNode())) {
          seen++;
          addShadow(el);
        }
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
      const roots = collectRoots(container);
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
    try {
      if (container.querySelector('input[type="password"],input[autocomplete="current-password"],input[autocomplete="one-time-code"],input[autocomplete^="cc-"]')) return true;
    } catch (_) {}
    const text = elementText(container);
    if (!PROTECT_RE.test(text)) return false;
    if (HARD_PROTECT_RE.test(text)) return true;
    return !explicitConsentDecisionPair(container, rejectControl);
  }

  function looksLikeConsentContainer(el) {
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

  function getContainers(roots, noteCandidate) {
    const out = [];
    roots.forEach((root) => {
      try {
        const list = root.querySelectorAll(CONTAINER_SELECTOR);
        for (let i = 0; i < list.length; i++) {
          const el = list[i];
          const box = el.getBoundingClientRect();
          const bannerSized = box.width >= Math.min(200, innerWidth * 0.65) && box.height >= 40;
          const hasAction = !bannerSized && CONSENT_ACTION_TEXT_RE.test(elementText(el));
          if (!isVisible(el)) {
            const inViewport = !box.width || !box.height || (box.bottom > 0 && box.right > 0
              && box.top < innerHeight && box.left < innerWidth);
            if (noteCandidate && (bannerSized || hasAction || inViewport)) noteCandidate();
            continue;
          }
          if (!bannerSized && !hasAction) continue;
          if (looksLikeConsentContainer(el)) {
            if (noteCandidate) noteCandidate();
            out.push(el);
          }
        }
      } catch (_) {}
    });
    return Array.from(new Set(out)).sort((a, b) => containerScore(b) - containerScore(a)).slice(0, 20);
  }

  function getControls(container, includeHidden) {
    const roots = collectRoots(container);
    const out = [];
    const seen = new Set();
    for (let r = 0; r < roots.length && out.length < 240; r++) {
      const root = roots[r];
      try {
        const list = root.querySelectorAll(CONTROL_SELECTOR);
        for (let i = 0; i < list.length && out.length < 240; i++) {
          const el = list[i];
          if (!seen.has(el) && (includeHidden || isVisible(el))) {
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
      const roots = collectRoots(container);
      const seen = new Set();
      for (const root of roots) {
        const list = root.querySelectorAll && root.querySelectorAll('input[type="checkbox"],input[type="radio"],[role="switch"],[role="checkbox"],[aria-checked]');
        if (!list) continue;
        for (let i = 0; i < list.length && changed < 18; i++) {
          const el = list[i];
          if (seen.has(el) || !isVisible(el)) continue;
          seen.add(el);
          if (!optionalToggleCandidate(el, container)) continue;
          if (clickControl(el) && !toggleIsOn(el)) changed++;
        }
      }
    } catch (_) {}
    if (changed) changedChoices.add(container);
    return changed;
  }

  function saveChoicesCandidate(el, container, changed) {
    const label = controlLabel(el);
    if (!changed || !label || !SAVE_CHOICES_RE.test(label)) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    if (PROTECT_RE.test(elementText(el))) return false;
    if (!hasConsentLanguage(elementText(container))) return false;
    if (ACCEPT_RE.test(label) && !/without\s+accepting|reject|decline|deny|refuse|necessary|essential|required|opt\s*out|save|confirm|apply/i.test(label)) return false;
    return true;
  }

  function choicesAreOff(container) {
    return !getControls(container, true).some(el => {
      if (!isConsentToggle(el) || !toggleIsOn(el)) return false;
      const label = associatedText(el, container);
      return !REQUIRED_PURPOSE_RE.test(label) || OPTIONAL_PURPOSE_RE.test(label);
    });
  }

  function choicesReadyToSave(container, changed) {
    return (changed || (openSettingsUntil > 0 && getControls(container).some(isConsentToggle))) && choicesAreOff(container);
  }

  function visibleControlsInDocument(roots, candidate) {
    const out = [];
    const seen = new Set();
    roots = roots || collectRoots(document);
    for (let r = 0; r < roots.length && out.length < 500; r++) {
      const root = roots[r];
      try {
        const list = root.querySelectorAll(CONTROL_SELECTOR);
        for (let i = 0; i < list.length && out.length < 500; i++) {
          const el = list[i];
          if (!seen.has(el) && (!candidate || candidate(el)) && isVisible(el)) {
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
      if (reject && performChoice(reject, consentBannerAncestor(reject))) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function safeRejectCandidate(el) {
    const label = controlLabel(el);
    if (!label) return false;
    if (!REJECT_RE.test(label)) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    if (PROTECT_RE.test(elementText(el))) return false; // never click a control that is also an account/payment/destructive action
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

  // For banners with obfuscated identifiers, find reject controls through strong consent language and existing safety
  // vetoes. Never click accept-only controls.
  function tryGenericReject(roots, noteCandidate) {
    try {
      const controls = visibleControlsInDocument(roots, (el) => {
        if (clicked.has(el) || !safeRejectCandidate(el)) return false;
        if (noteCandidate) noteCandidate();
        return true;
      });
      for (const el of controls) {
        const container = consentBannerAncestor(el);
        if (!container) continue;
        if (performChoice(el, container)) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function settingsCandidate(el, container) {
    const label = controlLabel(el);
    if (!label || !OPEN_SETTINGS_RE.test(label)) return false;
    if (SAVE_CHOICES_RE.test(label)) return false;
    if (isUnsafeAutoClickLink(el)) return false;
    if (PROTECT_RE.test(elementText(el))) return false; // don't open an account/billing "settings" control
    if (!hasConsentLanguage(elementText(container))) return false;
    if (/^\s*(settings|preferences?|privacy)\s*$/i.test(controlLabel(el)) && !hasStrongConsentLanguage(elementText(container))) return false;
    return !ACCEPT_RE.test(label);
  }

  function clickControl(el) {
    if (!el || clicked.has(el)) return false;
    if (el.disabled || el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (isUnsafeAutoClickLink(el)) return false;
    clicked.add(el);
    try { el.focus({ preventScroll: true }); } catch (_) {}
    try { el.click(); return true; } catch (_) { return false; }
  }

  function consentCookie(profile) {
    try { return profile && typeof WOConsentState !== 'undefined' ? WOConsentState.cookie(document.cookie, profile.cookie) : ''; }
    catch (_) { return ''; }
  }
  function profileFor(container) {
    if (typeof WOConsentState === 'undefined') return null;
    for (const profile of WOConsentState.profiles) {
      try { if (container.matches(profile.container) || container.querySelector(profile.container)) return profile; } catch (_) {}
    }
    return null;
  }
  function reportOutcome(status, action, profile) {
    everActed = true;
    try {
      chrome.runtime.sendMessage({ kind: 'rg-block', type: 'consent_outcome', detail: {
        status, action, cmp: profile ? profile.name : 'Generic consent banner',
        evidence: status === 'rejected' ? 'changed-saved-cookie-state' : 'none',
        why: status === 'rejected' ? 'The consent manager saved a state with optional categories off.'
          : status === 'failed' ? 'The consent control could not be clicked.'
          : action === 'settings' ? 'Consent settings opened; no opt-out is verified.' : 'Consent action dispatched; saved opt-out is unverified.',
      } });
    } catch (_) {}
  }
  function performChoice(el, container, profile) {
    if (!el || clicked.has(el)) return false;
    profile ||= profileFor(container);
    const before = consentCookie(profile), generation = outcomeGeneration;
    if (!clickControl(el)) { reportOutcome('failed', 'reject', profile); return false; }
    finishConsentWork();
    const check = final => {
      if (!active || generation !== outcomeGeneration) return;
      if (profile && WOConsentState.verify(profile, before, consentCookie(profile))) {
        outcomeGeneration++; reportOutcome('rejected', 'reject', profile);
      } else if (final) { outcomeGeneration++; reportOutcome('unverified', 'reject', profile); }
    };
    check(false);
    if (generation === outcomeGeneration) for (const ms of [100, 400, 1200, 2500]) woTimeout(() => check(ms === 2500), ms);
    return true;
  }
  function tryKnownCmp(roots) {
    if (typeof WOConsentState === 'undefined') return false;
    for (const profile of WOConsentState.profiles) for (const root of roots) {
      let containers = [];
      try { containers = root.querySelectorAll(profile.container); } catch (_) {}
      for (const container of containers) {
        if (!isVisible(container) || !looksLikeConsentContainer(container) || protectedContainerContext(container, null)) continue;
        const find = selector => {
          for (const part of collectRoots(container)) {
            let list = []; try { list = part.querySelectorAll(selector); } catch (_) {}
            for (const el of list) if (isVisible(el) && !clicked.has(el)) return el;
          }
          return null;
        };
        const reject = find(profile.reject);
        if (reject && safeRejectCandidate(reject) && performChoice(reject, container, profile)) return true;
        const changed = turnOffOptionalToggles(container) || changedChoices.has(container), save = find(profile.save);
        const selectionSave = save && profile.id === 'cookiebot' && /^(?:allow|use)\s+selection$/i.test(controlLabel(save))
          && !isUnsafeAutoClickLink(save) && !PROTECT_RE.test(elementText(save));
        if (save && choicesReadyToSave(container, changed) && (selectionSave || saveChoicesCandidate(save, container, true))
          && performChoice(save, container, profile)) return true;
        const settings = find(profile.settings);
        if (!opened.has(container) && settings && settingsCandidate(settings, container) && clickControl(settings)) {
          opened.add(container); openSettingsUntil = Date.now() + 900;
          reportOutcome('dispatched', 'settings', profile);
          for (const ms of [180, 700, 1600]) woTimeout(queueScan, ms);
          return true;
        }
      }
    }
    return false;
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

  // Clear only known analytics namespaces on exit, never heuristic key matches.
  // Vendor keys may contain "session", but JWT-like or large values remain vetoes
  // because they may be credentials or application state.
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
    // Set before the rate limit below, which is about log noise rather than whether
    // anything happened. This is what tells scan() the page really does have a banner,
    // so it must not be skipped by a coalesced log.
    everActed = true;
    const now = Date.now();
    if (now - lastLogAt < 1200) return;
    lastLogAt = now;
    try {
      reportOutcome('dispatched', 'settings', null);
    } catch (_) {}
  }

  function scan() {
    scanQueued = false;
    if (scanFinished || !active || !document.documentElement) return;

    // Stop mutation-driven scans after the no-banner deadline. Keep timed passes for late banners
    // and continue unfinished settings flows until their final save.
    if (!firstScanAt) firstScanAt = Date.now();
    if (!everActed && observer && Date.now() - firstScanAt > SCAN_GIVE_UP_MS) {
      try { observer.disconnect(); } catch (_) {}
      observer = null;
      // Slow polling covers late and inline-style reveals after observation quiets down. Retain the same 120s deadline.
      if (!slowTimer) {
        slowTimer = woInterval(() => {
          if (!active || everActed || Date.now() - firstScanAt > OBSERVER_LIFETIME_MS) {
            clearInterval(slowTimer);
            slowTimer = null;
            return;
          }
          // Schedule full scans in idle time to avoid frame hitches during interaction; a timeout bounds starvation.
          idleScan();
        }, SLOW_SCAN_MS);
      }
    }

    if (tryTwitchReject()) return;

    let possibleSurface = everActed || /(^|\.)twitch\.tv$/i.test(location.hostname);
    const noteCandidate = () => { possibleSurface = true; };
    const roots = collectRoots(document);
    if (observer) for (const root of roots) if (root !== document) {
      try { observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden', 'inert', 'open'] }); } catch (_) {}
    }
    if (tryKnownCmp(roots)) return;
    const containers = getContainers(roots, noteCandidate);
    for (const container of containers) {
      const controls = getControls(container);
      const reject = controls.find(safeRejectCandidate);
      if (reject && performChoice(reject, container)) {
        return;
      }
    }

    if (tryGenericReject(roots, noteCandidate)) return;
    /* Keep polling hidden candidates for CSS-only reveals; DOM arrivals wake the observer. */
    needsTimedScan = possibleSurface;

    for (const container of containers) {
      const changed = turnOffOptionalToggles(container) || changedChoices.has(container);
      if (!choicesReadyToSave(container, changed)) continue;
      const save = getControls(container).find((el) => saveChoicesCandidate(el, container, true));
      if (save && performChoice(save, container)) {
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

  // Throttle mutation scans and defer rather than drop work inside the gap.
  // Timed passes retain their cadence because CSS fade-ins may emit no mutations.
  const SCAN_MIN_GAP_MS = 250;
  // How long a page gets to produce a banner before mutation-driven scanning steps down
  // to the slow poll below. Not a give-up: coverage is preserved, only the cost changes.
  const SCAN_GIVE_UP_MS = 20000;
  const SLOW_SCAN_MS = 2500;
  // The same deadline the observer already had, so stepping down never outlives it.
  const OBSERVER_LIFETIME_MS = 120000;
  let lastScanAt = 0;
  let scanDeferred = null;
  let firstScanAt = 0;
  let everActed = false;
  let slowTimer = null;

  /* Stop observing after rejection or saving disabled choices. Opening Settings is nonterminal and must keep scanning for
     Save. */
  function finishConsentWork() {
    scanFinished = true;
    scanQueued = false;
    if (scanDeferred) {
      try { clearTimeout(scanDeferred); } catch (_) {}
      woPending.delete(scanDeferred);
      scanDeferred = null;
    }
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
      observer = null;
    }
    if (slowTimer) {
      try { clearInterval(slowTimer); } catch (_) {}
      slowTimer = null;
    }
  }

  // Scan during an idle gap rather than on the next frame. Used by the slow poll, where
  // being a few hundred milliseconds late costs nothing and blocking a frame costs a
  // visible stutter. requestIdleCallback is not universal, hence the fallback.
  function idleScan() {
    if (scanQueued || !active) return;
    scanQueued = true;
    const run = () => { try { scan(); } catch (_) { scanQueued = false; } };
    try {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
      else woTimeout(run, 0);
    } catch (_) { woTimeout(run, 0); }
  }

  function queueScan(throttled) {
    if (scanFinished || scanQueued || !active) return;
    if (throttled !== true && !needsTimedScan) return;
    if (throttled === true) {
      const since = Date.now() - lastScanAt;
      if (since < SCAN_MIN_GAP_MS) {
        if (!scanDeferred) {
          scanDeferred = woTimeout(() => { scanDeferred = null; queueScan(true); }, SCAN_MIN_GAP_MS - since);
        }
        return;
      }
    }
    scanQueued = true;
    lastScanAt = Date.now();
    try { requestAnimationFrame(scan); } catch (_) { woTimeout(scan, 40); }
  }

  // Wake the full scanner only for nodes with plausible consent identity, wording or controls.
  // Test identity fields separately to avoid allocations on every added node.
  function mutationNodeMayAffectConsent(node, nested, fullText, batch) {
    try {
      if (!node) return false;
      if (node.nodeType === 3) return hasConsentLanguage(String(node.nodeValue || ''));
      if (node.nodeType !== 1) return false;
      if (node.shadowRoot && node.shadowRoot.querySelector(CONTAINER_SELECTOR)) return true;
      const attributed = typeof node.hasAttributes !== 'function' || node.hasAttributes();
      const read = attributed && !!node.getAttribute;
      const role = read ? node.getAttribute('role') : null;
      const id = attributed ? node.id : '', cls = attributed ? node.className : '';
      let aria, test;
      if (attributed && (consentHint(id)
          || consentHint(typeof cls === 'string' ? cls : '')
          || consentHint(role)
          || (read && (consentHint(aria = node.getAttribute('aria-label'))
            || consentHint(test = node.getAttribute('data-testid'))
            || consentHint(node.getAttribute('data-test')))))) return true;
      if (String(node.tagName || '').toLowerCase() === 'dialog' || role === 'dialog'
          || (read && node.getAttribute('aria-modal') === 'true')) return true;
      if (nested && batch) {
        if (node.localName === 'dialog') return true;
        if (read && (consentContainerNamesMatch(id, typeof cls === 'string' ? cls : node.getAttribute('class'))
            || (aria && CONTAINER_LABEL_RE.test(aria)) || (test && CONTAINER_LABEL_RE.test(test)))) return true;
      }
      if (!nested && node.matches && node.matches(CONTAINER_SELECTOR)) return true;
      let text;
      if (nested && node.childNodes) {
        text = '';
        let count = 0;
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (child.nodeType === 3) text += (count++ ? ' ' : '') + (child.nodeValue || '');
        }
      } else {
        const all = String(node.textContent || '');
        text = fullText ? all : all.slice(0, 2400);
      }
      if (hasConsentLanguage(text)) return true;
      if (CONSENT_ACTION_TEXT_RE.test(text)) {
        const parentText = String(node.parentElement && node.parentElement.textContent || '').slice(0, 2400);
        if (hasConsentLanguage(parentText)) return true;
      }
      return !nested && descendantMayMatchConsentContainer(node, batch);
    } catch (_) {
      return false;
    }
  }

  function consentHint(value) {
    return !!value && CONSENT_FRAME_HINT_RE.test(value);
  }

  // The CSS union stays for full scans; a direct walk is cheaper on mutation roots.
  // Keep these terms aligned with CONTAINER_SELECTOR.
  const CONTAINER_ID_CLASS_RE = /cookie|consent|privacy|gdpr|cmp|onetrust|didomi|usercentrics|trustarc|sourcepoint|osano|termly|axeptio|truste/i;
  const CONTAINER_LABEL_RE = /cookie|consent|privacy/i;
  const CONTAINER_CKY_CLASS_RE = /(?:^|[ \t\n\r\f])cky(?:$|[ \t\n\r\f])/i;
  function consentContainerNamesMatch(id, cls) {
    return !!((id && (CONTAINER_ID_CLASS_RE.test(id) || /^cky(?:-|$)/i.test(id)))
      || (cls && (CONTAINER_ID_CLASS_RE.test(cls) || /^cky-/i.test(cls) || / cky-/i.test(cls)
        || CONTAINER_CKY_CLASS_RE.test(cls))));
  }

  function descendantMayMatchConsentContainer(node, batch) {
    if (!node.getElementsByTagName) return !!(node.querySelector && node.querySelector(CONTAINER_SELECTOR));
    const descendants = node.getElementsByTagName('*');
    for (let i = 0; i < descendants.length; i++) {
      const el = descendants[i];
      // Added descendants receive the same container check alongside their hint/text pass.
      if (batch && batch.has(el)) continue;
      if (el.localName === 'dialog') return true;
      if (consentContainerNamesMatch(el.getAttribute('id'), el.getAttribute('class'))) return true;
      if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') return true;
      const aria = el.getAttribute('aria-label');
      if (aria && CONTAINER_LABEL_RE.test(aria)) return true;
      const test = el.getAttribute('data-testid');
      if (test && CONTAINER_LABEL_RE.test(test)) return true;
    }
    return false;
  }

  function mutationsMayAffectConsent(records) {
    try {
      const added = [];
      for (const record of records || []) {
        if (record.type === 'attributes') {
          if (mutationNodeMayAffectConsent(record.target)) return true;
          continue;
        }
        for (const node of record.addedNodes || []) added.push(node);
      }
      if (added.length === 1) return mutationNodeMayAffectConsent(added[0], false, true);
      if (!added.length) return false;
      const batch = new Set(added);
      const clear = new Set();
      const chain = [];
      for (const node of added) {
        let ancestor = node.parentNode || node.parentElement;
        let nested = false;
        chain.length = 0;
        while (ancestor) {
          if (batch.has(ancestor)) { nested = true; break; }
          if (clear.has(ancestor)) break;
          chain.push(ancestor);
          ancestor = ancestor.parentNode || ancestor.parentElement;
        }
        if (!nested) for (const parent of chain) clear.add(parent);
        if (mutationNodeMayAffectConsent(node, nested, !nested, batch)) return true;
      }
    } catch (_) {}
    return false;
  }

  function startObserver() {
    if (scanFinished || observer || !document.documentElement) return;
    // Explicitly flagged as mutation-driven: a MutationObserver hands its callback
    // (records, observer), and a records array is truthy, so the throttle has to be
    // asked for by identity rather than inferred from the argument.
    observer = woObserver((records) => {
      if (scanFinished || scanQueued || scanDeferred || !active) return;
      if (mutationsMayAffectConsent(records)) queueScan(true);
    });
    try {
      // Do not watch style: animations and sliders rewrite it every frame.
      // Timed passes cover style-only/CSS fade-ins; class, aria-hidden, inert and open cover other reveals.
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden', 'inert', 'open'] });
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
      // Short startup polling catches controls fading into visibility without mutations. Sparse follow-ups cover late
      // banners.
      [0, 50, 140, 260].forEach((ms) => woTimeout(queueScan, ms));
      /* An open shadow root can attach without a document mutation after the first scan. */
      woTimeout(() => queueScan(true), 800);
      let fastPolls = 0;
      const fastTimer = woInterval(() => {
        if (!active || scanFinished || fastPolls++ >= 24) { clearInterval(fastTimer); return; }
        queueScan();
      }, 95);
      [3000, 4500, 7000, 11000].forEach((ms) => woTimeout(() => queueScan(ms === 4500), ms));
    });
  }

  const refreshConfigState = (overrides) => {
      if (!validConsentConfig(overrides)) { active = false; outcomeGeneration++; return; }
      config = Object.assign({}, DEFAULTS, overrides || {});
      const wasActive = active;
      updateActive();
      if (!active) outcomeGeneration++;
      if (active) {
        if (!wasActive) {
          scanFinished = false;
          everActed = false;
          firstScanAt = 0;
        }
        needsTimedScan = true;
        startObserver();
        queueScan();
      } else if (wasActive && observer) {
        try { observer.disconnect(); } catch (_) {}
        observer = null;
      }
  };

  try {
    woOnMessage((msg) => {
      if (!msg) return;
      if (msg.kind === 'consent-reset') { outcomeGeneration++; return; }
      if (msg.kind === 'config-update') refreshConfigState(msg.overrides);
      if (msg.kind === 'content-config-refresh') loadConfig(() => {
        if (active) {
          needsTimedScan = true;
          startObserver();
          queueScan();
        } else if (observer) {
          try { observer.disconnect(); } catch (_) {}
          observer = null;
        }
      });
    });
  } catch (_) {}

  if (document.documentElement) start();
  else woOn(document, 'DOMContentLoaded', start, { once: true });
  window.__wardenOneConsentRejectReadyVersion = CONSENT_REJECT_VERSION;
})();

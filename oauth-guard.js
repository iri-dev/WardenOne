/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne OAuth Grant Guard (ISOLATED world)
 * Scores OAuth consent grants from major identity providers. The provider can be
 * legitimate while the requested grant is dangerous.
 */
(function () {
  'use strict';

  const WO_GUARD_VERSION = '1.0.0';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOneOAuthGuardInstalled === WO_GUARD_VERSION) return;
  if (window.__wardenOneOAuthGuardInstalled) {
    try {
      if (typeof window.__wardenOneOAuthGuardDispose === 'function') window.__wardenOneOAuthGuardDispose();
    } catch (_) {}
  }
  window.__wardenOneOAuthGuardInstalled = WO_GUARD_VERSION;

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
  window.__wardenOneOAuthGuardDispose = () => {
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
  function woFocusRing(host) {
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
      host.addEventListener('focusin', onIn, true);
      host.addEventListener('focusout', onOut, true);
    } catch (_) {}
    return {
      paint,
      release() {
        drop();
        try {
          host.removeEventListener('focusin', onIn, true);
          host.removeEventListener('focusout', onOut, true);
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
          focusRing = woFocusRing(host);

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
  }

  /* The handle for the OAuth warning, so replacing or disposing it destroys the overlay this
     copy built rather than whatever the page currently has under that id. */
  let oauthOverlay = null;

  let config = { enabled: true, oauthGuard: true, silentMode: false };
  let configLoaded = false;
  let lastGrantKey = '';
  let lastWarnAt = 0;

  const WO_MODAL = {
    overlay: 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(61,42,82,.48)!important;color:#3d2a52!important;padding:24px!important;font-family:Nunito,system-ui,sans-serif!important;text-align:left!important;backdrop-filter:blur(10px) saturate(1.2)!important;-webkit-backdrop-filter:blur(10px) saturate(1.2)!important;',
    panel: 'all:initial!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;gap:13px!important;max-width:700px!important;width:min(700px,calc(100vw - 32px))!important;border:1px solid rgba(176,106,212,.34)!important;border-left:4px solid #9d54c9!important;border-radius:16px!important;background:linear-gradient(135deg,#faf2fe,#f4e9fb)!important;color:#3d2a52!important;padding:22px!important;box-shadow:0 24px 90px rgba(120,55,160,.32)!important;font-family:Nunito,system-ui,sans-serif!important;',
    tag: (risk) => 'all:initial!important;align-self:flex-start!important;border-radius:999px!important;background:' + (/^high$/i.test(String(risk || '')) ? 'linear-gradient(135deg,#d868a2,#9d54c9)' : 'linear-gradient(135deg,#b06ad4,#e07ab0)') + '!important;color:#fff!important;padding:4px 9px!important;font:800 11px/1 Nunito,system-ui,sans-serif!important;box-shadow:0 6px 16px rgba(157,84,201,.22)!important;',
    title: 'all:initial!important;color:#3d2a52!important;font:800 18px/1.25 Nunito,system-ui,sans-serif!important;',
    body: 'all:initial!important;color:#5f456f!important;font:600 14px/1.5 Nunito,system-ui,sans-serif!important;',
    meta: 'all:initial!important;color:#7a5f93!important;font:700 12px/1.45 Nunito,system-ui,sans-serif!important;background:#ede1f8!important;border:1px solid rgba(176,106,212,.22)!important;border-radius:9px!important;padding:9px 10px!important;word-break:break-word!important;',
    status: 'all:initial!important;color:#7a5f93!important;font:700 12px/1.4 Nunito,system-ui,sans-serif!important;min-height:16px!important;',
    actions: 'all:initial!important;display:flex!important;gap:9px!important;justify-content:flex-end!important;flex-wrap:wrap!important;font-family:Nunito,system-ui,sans-serif!important;',
    button: (primary) => 'all:initial!important;box-sizing:border-box!important;border:' + (primary ? 'none' : '1px solid rgba(176,106,212,.38)') + '!important;background:' + (primary ? 'linear-gradient(135deg,#b06ad4,#e07ab0)' : 'rgba(61,42,82,.06)') + '!important;color:' + (primary ? '#fff' : '#5f456f') + '!important;cursor:pointer!important;border-radius:9px!important;padding:10px 13px!important;font:800 12px/1 Nunito,system-ui,sans-serif!important;box-shadow:' + (primary ? '0 8px 20px rgba(157,84,201,.26)' : 'none') + '!important;',
  };

  const PROVIDERS = [
    {
      id: 'google',
      name: 'Google',
      hosts: ['accounts.google.com'],
      settings: 'https://myaccount.google.com/permissions',
      likely: (u) => /\/o\/oauth2|\/signin\/oauth|\/oauth/i.test(u.pathname) || (u.searchParams.has('client_id') && (u.searchParams.has('scope') || u.searchParams.has('redirect_uri'))),
    },
    {
      id: 'microsoft',
      name: 'Microsoft',
      hosts: ['login.microsoftonline.com', 'login.live.com'],
      settings: 'https://account.live.com/consent/Manage',
      likely: (u) => /oauth2|authorize|consent/i.test(u.pathname) || (u.searchParams.has('client_id') && (u.searchParams.has('scope') || u.searchParams.has('redirect_uri'))),
    },
    {
      id: 'github',
      name: 'GitHub',
      hosts: ['github.com'],
      settings: 'https://github.com/settings/applications',
      likely: (u) => /^\/login\/oauth\/authorize/i.test(u.pathname) || (u.searchParams.has('client_id') && u.searchParams.has('scope')),
    },
    {
      id: 'discord',
      name: 'Discord',
      hosts: ['discord.com', 'discordapp.com'],
      settings: 'https://discord.com/settings/authorized-apps',
      likely: (u) => /\/(api\/)?oauth2\/authorize/i.test(u.pathname) || (u.searchParams.has('client_id') && (u.searchParams.has('scope') || u.searchParams.has('permissions'))),
    },
  ];

  function oauthOn() {
    return configLoaded && config.enabled !== false && config.oauthGuard !== false && !hostAllowedByUser();
  }

  function silentModeOn() {
    return configLoaded && config.silentMode === true;
  }

  try {
    chrome.storage?.local?.get('wardenone_config', (res) => {
      config = Object.assign({}, config, (res && res.wardenone_config) || {});
      configLoaded = true;
      woTimeout(scanOAuthGrant, 150);
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes.wardenone_config) {
        config = Object.assign({}, config, changes.wardenone_config.newValue || {});
        configLoaded = true;
      }
    });
  } catch (_) {
    configLoaded = true;
    try { woTimeout(scanOAuthGrant, 150); } catch (_) {}
  }

  function cleanHost(host) {
    return String(host || '').replace(/^www\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
  }

  function hostAllowedByUser() {
    const host = cleanHost(location.hostname);
    const list = Array.isArray(config.allowlist) ? config.allowlist : [];
    return list.some((item) => {
      const d = cleanHost(item);
      return !!(d && (host === d || host.endsWith('.' + d)));
    });
  }

  function providerForUrl(u) {
    const host = cleanHost(u.hostname);
    return PROVIDERS.find((p) => p.hosts.some((h) => host === h || host.endsWith('.' + h))) || null;
  }

  function splitScopes(raw) {
    return Array.from(new Set(String(raw || '')
      .replace(/\+/g, ' ')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50)));
  }

  function bodyText() {
    try {
      return String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 12000);
    } catch (_) {
      return '';
    }
  }

  function consentActionText() {
    try {
      const labels = [];
      document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]').forEach((el) => {
        const label = String(
          (el && (el.innerText || el.textContent || el.value))
          || (el && el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')))
          || ''
        ).replace(/\s+/g, ' ').trim();
        if (label) labels.push(label);
      });
      return labels.join(' | ').slice(0, 3000);
    } catch (_) {
      return '';
    }
  }

  function isConsentGrantSurface(provider, u) {
    const text = bodyText();
    if (!text) return false;
    const actions = consentActionText();
    const hasGrantAction = /\b(allow|accept|authorize|approve|grant|continue)\b/i.test(actions);
    if (!hasGrantAction) return false;

    let positive = false;
    if (provider.id === 'google') {
      positive = /wants (?:to )?(?:access|use)[^.]{0,120}(?:google account|account data)|(?:choose|select) what [^.]{0,100} can access|this will allow [^.]{0,100} to|already has (?:some )?access/i.test(text);
    } else if (provider.id === 'microsoft') {
      positive = /permissions requested|would like to(?: access|:)|accepting these permissions|maintain access to data you have given it access to|consent on behalf of/i.test(text);
    } else if (provider.id === 'github') {
      positive = /would like permission to|wants to access|review and authorize|requesting access to|authorize [^.]{0,100}(?:application|app)/i.test(text);
    } else if (provider.id === 'discord') {
      positive = /wants to access your discord account|this will allow [^.]{0,120}(?:discord|server|account)|authorize [^.]{0,100}(?:bot|app|application)/i.test(text);
    }

    // Provider markup changes occasionally. Keep a narrow generic fallback for
    // explicit consent/grant routes, but still require permission language and
    // an affirmative grant control in the rendered page.
    if (!positive && /(?:^|\/)(?:consent|grant|permissions?)(?:\/|$)/i.test(u.pathname || '')) {
      positive = /\b(permission|scope|access to|can read|can edit|can manage|can send)\b/i.test(text);
    }
    if (!positive) return false;

    // Account selection, credential entry and account recovery are not grant
    // decisions. A strong consent phrase above wins only when the same rendered
    // surface also has a grant action.
    const accountOnly = /choose an account|pick an account|select an account|use another account|enter (?:your )?(?:email|password)|forgot (?:email|password)|create (?:an )?account|verify it(?:'|’)s you|stay signed in/i.test(text);
    return !accountOnly || positive;
  }

  function cleanText(value, max) {
    return String(value || '').replace(/\s+/g, ' ').replace(/[<>{}[\]\\]/g, '').trim().slice(0, max || 100);
  }

  function appNameFromDom(provider) {
    try {
      const candidates = [];
      document.querySelectorAll('h1,h2,h3,[role="heading"],title').forEach((el) => {
        const txt = cleanText(el.textContent || '', 90);
        if (txt) candidates.push(txt);
      });
      const joined = candidates.join(' | ');
      const cleaned = joined
        .replace(/wants to access your .*$/i, '')
        .replace(/sign in with .*$/i, '')
        .replace(new RegExp(provider.name, 'ig'), '')
        .replace(/\s+\|\s+/g, ' ')
        .trim();
      return cleanText(cleaned, 80);
    } catch (_) {
      return '';
    }
  }

  function redirectInfo(u) {
    const raw = u.searchParams.get('redirect_uri') || u.searchParams.get('redirect_url') || u.searchParams.get('return_to') || '';
    if (!raw) return { raw: '', host: '', scheme: '' };
    try {
      const ru = new URL(raw);
      return { raw: ru.href.slice(0, 300), host: cleanHost(ru.hostname), scheme: ru.protocol.replace(':', '') };
    } catch (_) {
      return { raw: cleanText(raw, 220), host: '', scheme: raw.split(':')[0].slice(0, 20).toLowerCase() };
    }
  }

  function addRisk(risks, label, scope, weight, reason) {
    const key = label + '|' + scope;
    if (risks.some((r) => r.key === key)) return;
    risks.push({ key, label, scope, weight, reason });
  }

  function matchScope(scope, re) {
    return re.test(String(scope || ''));
  }

  function scoreScope(provider, scope, risks) {
    const s = String(scope || '');
    if (!s) return;
    if (provider.id === 'google') {
      if (matchScope(s, /mail\.google\.com|gmail\.(modify|readonly|send|compose|insert|labels|settings)/i)) addRisk(risks, 'Gmail access', s, 6, 'can read, modify, or send email');
      else if (matchScope(s, /gmail\.metadata/i)) addRisk(risks, 'Gmail metadata', s, 3, 'can inspect mailbox metadata');
      if (matchScope(s, /contacts|peopleapi|people\.readonly|contacts\.readonly/i)) addRisk(risks, 'Contacts access', s, 4, 'can read contacts');
      if (matchScope(s, /drive(?!\.appdata)|docs|spreadsheets|presentations/i)) addRisk(risks, 'Drive/files access', s, /drive\.file/i.test(s) ? 3 : 5, 'can access files in Google Drive');
      if (matchScope(s, /calendar/i)) addRisk(risks, 'Calendar access', s, 3, 'can read or change calendar data');
      if (matchScope(s, /cloud-platform|admin\.directory|apps\.groups|gmail\.settings/i)) addRisk(risks, 'Admin/cloud access', s, 6, 'can reach admin or cloud-management APIs');
    } else if (provider.id === 'microsoft') {
      if (matchScope(s, /Mail\.(ReadWrite|Read|Send)|IMAP\.AccessAsUser|SMTP\.Send/i)) addRisk(risks, 'Email access', s, /ReadWrite|Send/i.test(s) ? 6 : 5, 'can read, modify, or send mail');
      if (matchScope(s, /Contacts\.Read|People\.Read/i)) addRisk(risks, 'Contacts access', s, 4, 'can read contacts or people data');
      if (matchScope(s, /Files\.ReadWrite|Files\.Read\.All|Sites\.ReadWrite|Sites\.Read\.All|SharePoint/i)) addRisk(risks, 'Files/SharePoint access', s, /ReadWrite/i.test(s) ? 6 : 4, 'can access OneDrive or SharePoint files');
      if (matchScope(s, /Directory\.ReadWrite|Directory\.AccessAsUser|User\.ReadWrite|Group\.ReadWrite|RoleManagement/i)) addRisk(risks, 'Directory/admin access', s, 7, 'can read or change tenant directory data');
      if (matchScope(s, /\.default$/i)) addRisk(risks, 'Preconfigured app permissions', s, 5, 'uses whatever permissions the app has preconfigured');
    } else if (provider.id === 'github') {
      if (s === 'repo') addRisk(risks, 'Private repository access', s, 7, 'can access private repositories');
      if (matchScope(s, /^repo:/i)) addRisk(risks, 'Repository write/admin access', s, /delete|admin|deploy|hook|invite/i.test(s) ? 6 : 4, 'can manage repository data or hooks');
      if (s === 'workflow') addRisk(risks, 'GitHub Actions workflow access', s, 6, 'can modify automation that runs code');
      if (s === 'delete_repo') addRisk(risks, 'Repository deletion', s, 8, 'can delete repositories');
      if (matchScope(s, /^admin:/i)) addRisk(risks, 'Organization/admin access', s, 7, 'can administer orgs, keys, or hooks');
      if (s === 'write:packages' || s === 'delete:packages') addRisk(risks, 'Package publishing access', s, 5, 'can publish or delete packages');
      if (s === 'gist') addRisk(risks, 'Gist access', s, 3, 'can create or modify gists');
    } else if (provider.id === 'discord') {
      if (s === 'bot') addRisk(risks, 'Bot installation', s, 4, 'can add a bot to a server');
      if (s === 'guilds.join') addRisk(risks, 'Join servers for you', s, 4, 'can add your account to servers');
      if (s === 'webhook.incoming') addRisk(risks, 'Webhook access', s, 4, 'can create incoming webhooks');
      if (s === 'messages.read') addRisk(risks, 'Message access', s, 5, 'can read messages where authorized');
      if (s === 'connections' || s === 'email') addRisk(risks, 'Profile/contact data', s, 2, 'can read personal account details');
    }
    if (/offline_access/i.test(s)) addRisk(risks, 'Offline access', s, 3, 'can keep access after you leave');
  }

  function addDomRisks(provider, risks) {
    const txt = bodyText();
    if (!txt) return;
    const rules = [
      { re: /read[^.]{0,80}(email|mail|gmail)|send[^.]{0,80}(email|mail)|compose[^.]{0,80}(email|mail)/i, label: 'Email access', weight: 5, reason: 'consent text mentions email access' },
      { re: /read[^.]{0,80}contacts|access[^.]{0,80}contacts/i, label: 'Contacts access', weight: 4, reason: 'consent text mentions contacts' },
      { re: /manage[^.]{0,80}repositories|private repositories|delete repositories|repository data/i, label: 'Repository access', weight: 6, reason: 'consent text mentions repository control' },
      { re: /read[^.]{0,80}(files|drive|onedrive|sharepoint)|edit[^.]{0,80}(files|drive|onedrive|sharepoint)/i, label: 'Files access', weight: 5, reason: 'consent text mentions file access' },
      { re: /administrator|administer|manage your organization|directory data/i, label: 'Admin access', weight: 7, reason: 'consent text mentions administrative access' },
    ];
    rules.forEach((r) => {
      if (r.re.test(txt)) addRisk(risks, r.label, 'consent text', r.weight, r.reason);
    });
    if (provider.id === 'discord' && /administrator/i.test(txt)) {
      addRisk(risks, 'Discord administrator permission', 'permissions', 8, 'bot permissions include administrator');
    }
  }

  function addDiscordPermissionRisks(u, risks) {
    if (!u.searchParams.has('permissions')) return;
    try {
      const value = BigInt(String(u.searchParams.get('permissions') || '0'));
      const has = (bit) => (value & BigInt(bit)) !== 0n;
      if (has(0x8)) addRisk(risks, 'Discord administrator permission', 'permissions=ADMINISTRATOR', 8, 'bot can administer the server');
      if (has(0x20) || has(0x10)) addRisk(risks, 'Discord server/channel management', 'permissions=MANAGE_SERVER_CHANNELS', 5, 'bot can manage server or channels');
      if (has(0x10000000) || has(0x20000000)) addRisk(risks, 'Discord role/webhook management', 'permissions=MANAGE_ROLES_WEBHOOKS', 6, 'bot can manage roles or webhooks');
      if (has(0x4) || has(0x2)) addRisk(risks, 'Discord moderation power', 'permissions=BAN_KICK', 4, 'bot can kick or ban members');
      if (has(0x2000) || has(0x20000)) addRisk(risks, 'Discord message abuse power', 'permissions=MANAGE_MESSAGES_MENTION', 3, 'bot can manage messages or mention everyone');
    } catch (_) {}
  }

  function scoreGrant(provider, u) {
    const rawScopes = splitScopes(u.searchParams.get('scope') || '');
    const risks = [];
    rawScopes.forEach((s) => scoreScope(provider, s, risks));
    if (provider.id === 'discord') addDiscordPermissionRisks(u, risks);
    addDomRisks(provider, risks);

    const redirect = redirectInfo(u);
    const reasons = [];
    let score = risks.reduce((sum, r) => sum + r.weight, 0);
    const critical = risks.some((r) => r.weight >= 6);
    if (rawScopes.length >= 5) { score += 2; reasons.push('many OAuth scopes requested at once'); }
    if (u.searchParams.get('access_type') === 'offline' || rawScopes.some((s) => /offline_access/i.test(s))) {
      score += 2;
      reasons.push('requests offline/refresh-token access');
    }
    if (redirect.raw && redirect.scheme === 'http' && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(redirect.host)) {
      score += 5;
      reasons.push('redirect URI is not HTTPS');
    }
    if (redirect.host && (/^\d{1,3}(\.\d{1,3}){3}$/.test(redirect.host) || /^xn--/i.test(redirect.host))) {
      score += 2;
      reasons.push('redirect host looks unusual');
    }
    risks.forEach((r) => { if (r.reason && !reasons.includes(r.reason)) reasons.push(r.reason); });

    let risk = 'Low';
    if (critical || score >= 8) risk = 'High';
    else if (score >= 4) risk = 'Medium';
    return {
      provider: provider.id,
      providerName: provider.name,
      risk,
      score,
      scopes: rawScopes.slice(0, 20),
      riskyScopes: Array.from(new Set(risks.map((r) => r.label))).slice(0, 10),
      reasons: reasons.slice(0, 8),
      redirectHost: redirect.host,
      redirectScheme: redirect.scheme,
      appName: appNameFromDom(provider),
      clientIdHint: cleanText((u.searchParams.get('client_id') || '').slice(0, 6) + (u.searchParams.get('client_id') ? '...' : ''), 12),
      settings: provider.settings,
    };
  }

  function grantKey(grant) {
    return [
      grant.provider,
      grant.clientIdHint,
      grant.redirectHost,
      grant.scopes.join('|'),
      grant.riskyScopes.join('|'),
    ].join('::');
  }

  function textList(items, empty) {
    const arr = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
    return arr.length ? arr.join(', ') : empty;
  }

  function showOAuthWarning(grant) {
    if (silentModeOn()) return;
    const now = Date.now();
    const key = grantKey(grant);
    if (key === lastGrantKey && now - lastWarnAt < 10 * 60 * 1000) return;
    lastGrantKey = key;
    lastWarnAt = now;
    try {
      /* Replacing destroys the overlay this copy built. Looking the old one up by id would find
         whatever the page happens to have under that id, which the page chooses. */
      if (oauthOverlay) { try { oauthOverlay.destroy(); } catch (_) {} oauthOverlay = null; }
      oauthOverlay = woOwnedOverlay('wo-oauth-guard');
      /* Handed to the shared registry as something with a disconnect(), because that is the one
         thing its teardown loop knows how to call. This is why the dispose above stays byte-for-byte
         identical to the other eight copies: the overlay hooks into it instead of editing it.
         destroy() releases its own DOM-watch subscription, so the ordering inside woKeep is not
         load-bearing. */
      woHold({ disconnect() { try { if (oauthOverlay) oauthOverlay.destroy(); } catch (_) {} } });
      const shadow = oauthOverlay.root();
      if (!shadow) return;
      /* The host carries the id and the fixed positioning; this is the backdrop inside it. */
      const wrap = document.createElement('div');
      wrap.setAttribute('style', WO_MODAL.overlay);
      const box = document.createElement('div');
      box.setAttribute('style', WO_MODAL.panel);
      const tag = document.createElement('div');
      tag.setAttribute('style', WO_MODAL.tag(grant.risk));
      tag.textContent = grant.risk + ' OAuth grant';
      const title = document.createElement('div');
      title.setAttribute('style', WO_MODAL.title);
      title.textContent = grant.providerName + ' is real, but this app is asking for powerful access';
      const body = document.createElement('div');
      body.setAttribute('style', WO_MODAL.body);
      const app = grant.appName ? ('App: ' + grant.appName + '. ') : '';
      body.textContent = app + 'Requested access includes: ' + textList(grant.riskyScopes, 'sensitive OAuth scopes') + '. ' + (grant.reasons.length ? grant.reasons[0] + '. ' : '') + 'Do not approve unless you recognize this app and truly need these permissions.';
      const meta = document.createElement('div');
      meta.setAttribute('style', WO_MODAL.meta);
      meta.textContent = 'Redirect host: ' + (grant.redirectHost || 'not visible') + ' | Scopes: ' + textList(grant.scopes, 'not visible in URL');
      const status = document.createElement('div');
      status.setAttribute('style', WO_MODAL.status);
      const actions = document.createElement('div');
      actions.setAttribute('style', WO_MODAL.actions);
      const mkBtn = (label, primary) => {
        const btn = document.createElement('button');
        btn.setAttribute('style', WO_MODAL.button(primary));
        btn.textContent = label;
        return btn;
      };
      const leave = mkBtn('Leave page', true);
      /* isTrusted proves the click was the user's. owns() proves the thing they clicked is ours:
         a page can build a button matching any description, so the gesture being genuine is not
         enough on its own. Only nodes inside our closed shadow root satisfy this. */
      woOn(leave, 'click', (e) => {
        if (e && e.isTrusted === false) return;
        if (!oauthOverlay || !oauthOverlay.owns(leave)) return;
        try { if (history.length > 1) history.back(); else location.href = grant.settings || 'about:blank'; } catch (_) { try { location.href = 'about:blank'; } catch (_) {} }
      });
      const settings = mkBtn('Manage existing apps', false);
      woOn(settings, 'click', (e) => {
        if (e && e.isTrusted === false) return;
        if (!oauthOverlay || !oauthOverlay.owns(settings)) return;
        try { window.open(grant.settings, '_blank', 'noopener'); status.textContent = 'Opened the provider app-access page.'; } catch (_) { try { location.href = grant.settings; } catch (_) {} }
      });
      const dismiss = mkBtn('Review anyway', false);
      woOn(dismiss, 'click', (e) => {
        if (e && e.isTrusted === false) return;
        if (!oauthOverlay || !oauthOverlay.owns(dismiss)) return;
        try { oauthOverlay.destroy(); } catch (_) {}
        oauthOverlay = null;
      });
      actions.appendChild(leave);
      actions.appendChild(settings);
      actions.appendChild(dismiss);
      box.appendChild(tag);
      box.appendChild(title);
      box.appendChild(body);
      box.appendChild(meta);
      box.appendChild(status);
      box.appendChild(actions);
      wrap.appendChild(box);
      shadow.appendChild(wrap);
      oauthOverlay.dialog({
        label: 'WardenOne security warning: this app is requesting powerful account access',
        description: 'Review the requested permissions before approving.' });
      oauthOverlay.mount();
    } catch (_) {}
  }

  function reportGrant(grant) {
    try {
      chrome.runtime.sendMessage({ kind: 'oauth-grant', grant }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  function scanOAuthGrant() {
    if (!oauthOn()) return;
    let u;
    try { u = new URL(location.href); } catch (_) { return; }
    const provider = providerForUrl(u);
    if (!provider || !provider.likely(u)) return;
    if (!isConsentGrantSurface(provider, u)) return;
    const grant = scoreGrant(provider, u);
    if (grant.risk === 'Low') return;
    showOAuthWarning(grant);
    reportGrant(grant);
  }

  if (document.readyState === 'loading') woOn(document, 'DOMContentLoaded', scanOAuthGrant, { once: true });
  else woTimeout(scanOAuthGrant, 100);
  try {
    let pending = false;
    const mo = woObserver(() => {
      if (pending || !oauthOn()) return;
      pending = true;
      woTimeout(() => {
        pending = false;
        scanOAuthGrant();
      }, 900);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    woTimeout(() => { try { scanOAuthGrant(); } catch (_) {} }, 2500);
    woTimeout(() => { try { mo.disconnect(); } catch (_) {} }, 30000);
  } catch (_) {}
})();

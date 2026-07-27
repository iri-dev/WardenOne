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
 *    buttons working), but never when the gesture landed on/over a video
 *    player, never twice per gesture, and never once the page has already
 *    tried a hijack (hostile-page latch).
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

  if (window.__wardenOneAntiRedirectHardener) return;
  window.__wardenOneAntiRedirectHardener = true;

  let token = null;
  let queuedEvents = [];
  let lastGestureAt = 0;
  let intendedHost = '';
  let intentWasExplicit = false;
  let lastIntentText = '';
  let lastIntentStructural = false;
  // True when the current gesture landed on/over a video player -- such a
  // gesture never authorizes any cross-site popup or redirect.
  let lastGestureTainted = false;
  // The lenient "gesture on a plain element may open one popup" allowance is
  // single-use per gesture (kills popunder chains)...
  let nonExplicitPopupSpent = false;
  // ...and is revoked for the rest of the page's life after the first hijack
  // attempt we block (shady pages retry constantly; legit pages never trip it).
  let pageHostile = false;
  // Snapshot of the link under the pointer at press time, to catch pages that
  // swap a link's destination between mousedown and click.
  let pressAnchor = null;
  let pressAnchorHost = '';
  let pressAnchorHref = '';

  const DEFAULT_WINDOW_MS = 2400;
  const KNOWN_GOOD = /(^|\.)(google|gstatic|googleusercontent|accounts\.google|recaptcha|hcaptcha|facebook|connect\.facebook|fbcdn|apple|cdn-apple|icloud|microsoft|microsoftonline|msauth|msftauth|live|office|paypal|paypalobjects|stripe|stripe\.network|checkout\.stripe|braintreegateway|braintreepayments|adyen|adyenpayments|twitter|x|linkedin|github|gitlab|amazon|amazonaws|amazoncognito|spotify|accounts\.spotify|login\.spotify|youtube|googlevideo|ytimg|twitch|ttvnw|jtvnw|twitchcdn|zoom|slack|dropbox|okta|oktacdn|oktapreview|okta-emea|auth0|onelogin|duosecurity|pingidentity|pingone|forgerock|jumpcloud|miniorange|b2clogin|ciamlogin|workos|frontegg|descope|stytch|openathens|shibboleth|cloudflare)\.[a-z.]+$|(^|\.)t\.co$/i;

  function cfg() {
    return window.__WO_CONFIG__ || {};
  }

  function enabled() {
    const c = cfg();
    return c.enabled !== false && c.blockGesturelessNav !== false;
  }

  function gestureWindowMs() {
    const n = Number(cfg().gestureWindowMs);
    return Number.isFinite(n) && n > 0 ? Math.max(n, DEFAULT_WINDOW_MS) : DEFAULT_WINDOW_MS;
  }

  function regHost(host) {
    return String(host || '').replace(/^www\./, '').toLowerCase();
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
    const parts = regHost(host).split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const last2 = parts.slice(-2).join('.');
    // Multi-label public suffixes (co.uk, com.au, gov.uk, ...) keep a third label so
    // two unrelated sites under the same suffix are NOT treated as the same party.
    // Mirrors the canonical registrableDomain() heuristic in domain-utils.js.
    return /^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/.test(last2) ? parts.slice(-3).join('.') : last2;
  }

  function sameParty(a, b) {
    a = regHost(a);
    b = regHost(b);
    return !!(a && b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a) || baseDomain(a) === baseDomain(b)));
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
    if (/(adurl|popunder|onclickad|campaign|aff_id|affiliate|clickid|utm_source=ad|doubleclick|adservice|taboola|outbrain)/i.test(raw)) return true;
    return false;
  }

  function freshGesture() {
    return Date.now() - lastGestureAt < gestureWindowMs();
  }

  function consumeBlankPopupAllowance() {
    if (!freshGesture() || lastGestureTainted || nonExplicitPopupSpent) return false;
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
  // pointer gestures (never keystrokes) and reads a small bounded set of rects.
  function pointOnVideo(x, y) {
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
    let surfaces;
    try {
      surfaces = document.querySelectorAll('[class*="player"],[id*="player"],[class*="video"],[id*="video"],[class*="stream"],[id*="stream"],[data-player],[data-video]');
    } catch (_) {
      surfaces = null;
    }
    if (surfaces) {
      const max = Math.min(surfaces.length || 0, 24);
      for (let i = 0; i < max; i++) {
        let r;
        try { r = surfaces[i].getBoundingClientRect(); } catch (_) { continue; }
        if (r && r.width > 120 && r.height > 80 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
    }
    return false;
  }

  function markIntent(event) {
    if (event && event.isTrusted === false) return;
    lastGestureAt = Date.now();
    // Plain typing keystrokes don't start navigations/popups — skip the expensive
    // closest()/text intent computation (innerText forced a layout reflow per keystroke).
    if (event && event.type === 'keydown') {
      const k = event.key;
      if (k && k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
      // Keyboard activation is a new, untainted gesture with a fresh popup allowance.
      lastGestureTainted = false;
      nonExplicitPopupSpent = false;
    }
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

  function targetAllowed(rawTarget, kind) {
    const targetHost = hostOf(rawTarget);
    if (!targetHost) {
      if (kind === 'open' && blankPopupTarget(rawTarget)) {
        // OAuth/SSO SDKs synchronously reserve a real blank window during the
        // trusted click, then navigate that handle after async discovery.
        return consumeBlankPopupAllowance();
      }
      return true;
    }
    if (sameParty(targetHost, location.hostname)) return true;
    if (KNOWN_GOOD.test(targetHost)) return true;
    if (federationUrlShape(rawTarget)) return true;
    if (!freshGesture()) return false;
    if (lastGestureTainted) return false;
    if (intentWasExplicit && intendedHost && sameParty(targetHost, intendedHost)) return true;
    if (suspiciousRedirectTarget(rawTarget)) return false;
    if (kind === 'open') {
      // One popup per plain-element gesture, and none once the page has shown
      // hostility. Keeps legit "open dashboard / maps / app / share" buttons
      // working (the v3.22.31 false-positive fix) without leaving popunder
      // chains open.
      if (intentWasExplicit || nonExplicitPopupSpent || pageHostile) return false;
      nonExplicitPopupSpent = true;
      return true;
    }
    // Same-tab redirects (and cross-window form posts): a gesture on a plain
    // element is NOT enough -- the control must clearly read as login/checkout.
    return !intentWasExplicit && !pageHostile && intentTextAllows();
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

  function block(rawTarget, kind) {
    if (!enabled()) return false;
    const blankOpen = kind === 'open' && blankPopupTarget(rawTarget);
    if (!blankOpen && sameSiteTarget(rawTarget)) return false;
    if (targetAllowed(rawTarget, kind)) return false;
    pageHostile = true;
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

  ['pointerdown', 'mousedown', 'click', 'auxclick', 'keydown', 'touchstart', 'touchend'].forEach((name) => {
    try { window.addEventListener(name, markIntent, true); } catch (_) {}
  });

  // Click-layer guard: cancels hijack clicks whose default action navigates
  // natively (so the window.open/location hooks below never see them).
  function guardClick(event) {
    if (!enabled()) return;
    const el = event && event.target && event.target.nodeType === 1 ? event.target : null;
    const a = el && el.closest ? el.closest('a[href],area[href]') : null;
    if (!a) return;
    let raw = '';
    try { raw = String(a.href || a.getAttribute('href') || ''); } catch (_) {}
    let opensPopup = false;
    try {
      const t = String((a.getAttribute && a.getAttribute('target')) || a.target || '').trim().toLowerCase();
      opensPopup = !!(t && t !== '_self' && t !== '_top' && t !== '_parent');
    } catch (_) {}
    const host = hostOf(raw);
    const cancel = (why, silent) => {
      try { event.preventDefault(); } catch (_) {}
      // A hijack click means hostile page: taint the gesture and drop any
      // "explicit intent" markIntent derived from the hijacking link, so the
      // page can't replay the same destination through window.open/assign.
      pageHostile = true;
      lastGestureTainted = true;
      intentWasExplicit = false;
      intendedHost = regHost(location.hostname);
      emit('blocked_gestureless_nav', {
        kind: 'click',
        url: raw.slice(0, 500),
        matched: host,
        why,
        silent: !!silent,
      });
    };
    if (!host && blankPopupTarget(raw) && opensPopup) {
      if (consumeBlankPopupAllowance()) return;
      return cancel('blank popup opened from the page', true);
    }
    if (!host || sameParty(host, location.hostname) || KNOWN_GOOD.test(host) || federationUrlShape(raw)) return;
    if (event.isTrusted === false) {
      let isDownload = false;
      try { isDownload = !!(a.hasAttribute && a.hasAttribute('download')); } catch (_) {}
      if (isDownload && !suspiciousRedirectTarget(raw)) return;
      return cancel('page-generated click on a cross-site link', true);
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
      return cancel('link changed destination after you pressed it', false);
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
    if (opacity < 0.05) return cancel('invisible cross-site link', true);
    if (rect && rect.width > 0 && rect.height > 0) {
      const vw = Math.max(1, window.innerWidth || 1);
      const vh = Math.max(1, window.innerHeight || 1);
      const cover = (Math.min(rect.width, vw) * Math.min(rect.height, vh)) / (vw * vh);
      if (cover >= 0.6) return cancel('a link covering the page pointed at a different site', false);
      const pt = coordsOf(event);
      if (pt && pointOnVideo(pt.x, pt.y)) {
        return cancel('a link was layered over the video player', true);
      }
    }
  }
  try { window.addEventListener('click', guardClick, true); } catch (_) {}
  try { window.addEventListener('auxclick', guardClick, true); } catch (_) {}

  try {
    const realOpen = window.open;
    window.open = function (url, name, features) {
      const rawTarget = url || 'about:blank';
      if (block(rawTarget, 'open')) return null;
      return realOpen.apply(this, arguments);
    };
  } catch (_) {}

  try {
    const proto = Location.prototype;
    const realAssign = proto.assign;
    const realReplace = proto.replace;
    proto.assign = function (url) {
      if (block(url, 'assign')) return undefined;
      return realAssign.call(this, url);
    };
    proto.replace = function (url) {
      if (block(url, 'replace')) return undefined;
      return realReplace.call(this, url);
    };
    const hrefDesc = Object.getOwnPropertyDescriptor(window.location, 'href') || Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (hrefDesc && hrefDesc.set) {
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        enumerable: true,
        get() { return hrefDesc.get ? hrefDesc.get.call(this) : String(location); },
        set(value) {
          if (block(value, 'href')) return;
          hrefDesc.set.call(this, value);
        },
      });
    }
  } catch (_) {}

  // A normal same-tab, top-frame form POST (login -> SSO/auth, multi-step checkout, search)
  // navigates THIS tab and is legitimate -- silently cancelling it broke niche SSO/payment flows.
  // The actual threats here are popunder window.open and gestureless cross-site redirects, NOT a
  // top-frame form the user submitted. So we no longer block same-tab top-frame submits; forms
  // that open a NEW window (target=_blank / a named target) or live in a sub-frame keep scrutiny.
  function formStaysInTab(form) {
    try {
      if (window.top !== window.self) return false;
      const t = String((form && form.getAttribute && form.getAttribute('target')) || (form && form.target) || '').trim().toLowerCase();
      if (t && t !== '_self' && t !== '_top' && t !== '_parent') return false;
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
  try {
    const realSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      const action = this && this.action ? this.action : location.href;
      if (!formStaysInTab(this) && !isFederationForm(this) && block(action, 'form-submit')) return undefined;
      return realSubmit.apply(this, arguments);
    };
    window.addEventListener('submit', (event) => {
      const form = event && event.target;
      if (formStaysInTab(form) || isFederationForm(form)) return; // native same-tab and federation POSTs
      const action = form && form.action ? form.action : location.href;
      if (!block(action, 'submit-event')) return;
      try {
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch (_) {}
    }, true);
  } catch (_) {}

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data || {};
    if (msg.source === 'wardenone-handshake' && typeof msg.token === 'string' && !token) {
      token = msg.token;
      flushEvents();
    }
  }, true);
}());

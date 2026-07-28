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

  if (window.__wardenOneAntiRedirectHardener) return;
  window.__wardenOneAntiRedirectHardener = true;

  let token = null;
  let queuedEvents = [];
  let guardConfig = {
    __configReady: false,
    enabled: true,
    blockGesturelessNav: true,
    blockForcedPopups: true,
    strictPopupShield: true,
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
    'linkedin.com', 'github.com', 'gitlab.com', 'amazon.com', 'amazonaws.com', 'amazoncognito.com',
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

  function masterEnabled() {
    const c = cfg();
    return configReady() && c.enabled !== false;
  }

  function navigationEnabled() {
    return TOP_FRAME && masterEnabled() && cfg().blockGesturelessNav !== false;
  }

  function popupEnabled() {
    return masterEnabled() && cfg().blockForcedPopups !== false;
  }

  function strictPopupEnabled() {
    return popupEnabled() && cfg().strictPopupShield === true;
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
      if (host === base || host.endsWith('.' + base)) return true;
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
    if (!navigationEnabled()) return false;
    if (sameSiteTarget(rawTarget)) return false;
    if (navigationTargetAllowed(rawTarget)) return false;
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

  function inertWindowFacade() {
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
      closed: true,
      opener: null,
      length: 0,
      location: locationFacade,
      document: documentFacade,
      close() {},
      focus() {},
      blur() {},
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    };
    facade.window = facade;
    facade.self = facade;
    facade.top = facade;
    facade.parent = facade;
    facade.frames = facade;
    try { Object.defineProperty(facade, Symbol.toStringTag, { value: 'Window' }); } catch (_) {}
    return facade;
  }

  ['pointerdown', 'mousedown', 'click', 'auxclick', 'keydown', 'touchstart', 'touchend'].forEach((name) => {
    try { window.addEventListener(name, markIntent, true); } catch (_) {}
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
    try {
      const t = String((a.getAttribute && a.getAttribute('target')) || a.target || '').trim().toLowerCase();
      opensPopup = !!(t && t !== '_self' && t !== '_top' && t !== '_parent');
    } catch (_) {}
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
      if (matcherHit) return cancel('popup matcher: ' + matcherHit.reason, true, true);
      if (!popupEnabled()) return;
      if (event.isTrusted === false) {
        let isDownload = false;
        try { isDownload = !!(a.hasAttribute && a.hasAttribute('download')); } catch (_) {}
        if (isDownload && !suspiciousRedirectTarget(raw)) return;
        return cancel('page-generated popup link', true, true);
      }
      if (!strictPopupEnabled()) return;
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
  try { window.addEventListener('click', guardClick, true); } catch (_) {}
  try { window.addEventListener('auxclick', guardClick, true); } catch (_) {}

  try {
    const realOpen = window.open;
    window.open = function (url, name, features) {
      const rawTarget = url || 'about:blank';
      const match = popupBlockMatch(rawTarget);
      if (match) {
        noteBlockedPopup(rawTarget, match);
        return inertWindowFacade();
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
  // top-frame forms that open a NEW window (target=_blank / a named target) keep scrutiny.
  // Child-frame forms are deliberately left native by this lightweight popup-only layer.
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
  if (TOP_FRAME) try {
    const realSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      const action = this && this.action ? this.action : location.href;
      if (!formStaysInTab(this) && !isFederationForm(this) && blockNavigation(action, 'form-submit')) return undefined;
      return realSubmit.apply(this, arguments);
    };
    window.addEventListener('submit', (event) => {
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

  window.addEventListener('message', (event) => {
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
        gestureWindowMs: DEFAULT_WINDOW_MS,
      }, msg.overrides, { __configReady: true });
    }
  }, true);
}());

/*
 * Regression harness for compatibility-sensitive navigation and form flows.
 *
 * This intentionally exercises the shipped runtime (content.min.js and
 * anti-redirect.js), not a reimplementation of its policy.  It covers the
 * failure shapes reported on Google Drive, UCAS and university SSO portals:
 *
 *   node tools/test-site-compatibility.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const ANTI_REDIRECT = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function pageParts(raw) {
  const u = new URL(raw);
  return {
    href: u.href,
    hostname: u.hostname,
    pathname: u.pathname,
    protocol: u.protocol,
    origin: u.origin,
  };
}

function makeElement(props) {
  props = props || {};
  const attrs = Object.assign({}, props.attrs || {});
  const el = {
    nodeType: 1,
    tagName: String(props.tag || 'DIV').toUpperCase(),
    textContent: props.text || '',
    id: props.id || '',
    className: props.className || '',
    href: props.href,
    action: props.action,
    formAction: props.formAction,
    target: props.target || '',
    parentElement: props.parent || null,
    style: props.style || {},
    getAttribute(name) { return attrs[name] == null ? null : attrs[name]; },
    hasAttribute(name) { return attrs[name] != null; },
    getBoundingClientRect() {
      return props.rect || { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
    },
    querySelector(sel) { return sel === 'video' && props.hasVideo ? makeElement({ tag: 'video' }) : null; },
    querySelectorAll() { return []; },
    closest(selector) {
      let node = this;
      while (node) {
        const tag = String(node.tagName || '').toUpperCase();
        if (selector === 'video,audio' && (tag === 'VIDEO' || tag === 'AUDIO')) return node;
        if (selector === 'a[href],area[href]' && (tag === 'A' || tag === 'AREA') && node.href) return node;
        if (selector === 'form[action]' && tag === 'FORM' && node.action) return node;
        if (selector === 'button,input' && (tag === 'BUTTON' || tag === 'INPUT')) return node;
        if (selector === 'a,button,input,[role="button"],[tabindex]'
            && (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT')) return node;
        if (selector === "a,button,input,[role='button'],[tabindex]"
            && (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT')) return node;
        if (selector === 'a[href]' && tag === 'A' && node.href) return node;
        node = node.parentElement;
      }
      return null;
    },
  };
  return el;
}

function makeBrowserSandbox(rawPageUrl) {
  const state = {
    opened: [],
    popupNavigations: [],
    assigned: [],
    replaced: [],
    hrefSets: [],
    submitted: [],
    requestSubmits: [],
    logs: [],
    emitted: [],
  };
  const listeners = Object.create(null);
  const page = pageParts(rawPageUrl);

  function NativeLocation() {}
  NativeLocation.prototype.assign = function assign(url) { state.assigned.push(String(url)); };
  NativeLocation.prototype.replace = function replace(url) { state.replaced.push(String(url)); };
  const location = Object.create(NativeLocation.prototype);
  Object.assign(location, page);
  let locationHref = page.href;
  Object.defineProperty(location, 'href', {
    configurable: true,
    enumerable: true,
    get() { return locationHref; },
    set(value) { state.hrefSets.push(String(value)); },
  });

  function NativeForm() {}
  NativeForm.prototype.submit = function submit() { state.submitted.push(this); };
  NativeForm.prototype.requestSubmit = function requestSubmit(submitter) {
    state.requestSubmits.push({ form: this, submitter: submitter || null });
  };

  function nativeOpen(url, name, features) {
    const href = String(url == null || url === '' ? 'about:blank' : url);
    state.opened.push({ href, name: name || '', features: features || '' });
    const popupLocation = {
      assign(value) { state.popupNavigations.push(String(value)); },
      replace(value) { state.popupNavigations.push(String(value)); },
      reload() {},
    };
    let popupHref = href;
    Object.defineProperty(popupLocation, 'href', {
      configurable: true,
      enumerable: true,
      get() { return popupHref; },
      set(value) { popupHref = String(value); state.popupNavigations.push(popupHref); },
    });
    return { closed: false, location: popupLocation, close() { this.closed = true; } };
  }

  const sandbox = {
    URL,
    Date,
    Math,
    Number,
    Object,
    String,
    Set,
    WeakSet,
    Promise,
    BigInt,
    Location: NativeLocation,
    HTMLFormElement: NativeForm,
    location,
    innerWidth: 1280,
    innerHeight: 800,
    open: nativeOpen,
    setTimeout,
    clearTimeout,
    getComputedStyle(el) {
      return { opacity: String(el && el.style && el.style.opacity == null ? 1 : el.style.opacity) };
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.self = sandbox;
  sandbox.addEventListener = (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  };
  sandbox.document = {
    activeElement: null,
    addEventListener() {},
    dispatchEvent(event) { if (event && event.type === 'ww-event') state.emitted.push(event.detail); },
    getElementsByTagName() { return []; },
    querySelectorAll() { return []; },
  };
  sandbox.WW = {
    enabled: true,
    strictPopupShield: true,
    blockGesturelessNav: true,
    blockForcedPopups: true,
    oneOpenPerGesture: true,
    blockMetaRefresh: false,
    __frozen: false,
  };
  sandbox.regDomain = (host) => String(host || '').replace(/^www\./, '').toLowerCase();
  sandbox.stripTracking = (url) => String(url == null ? '' : url);
  sandbox.log = (type, detail) => state.logs.push({ type, detail });

  const originals = {
    open: nativeOpen,
    assign: NativeLocation.prototype.assign,
    replace: NativeLocation.prototype.replace,
    submit: NativeForm.prototype.submit,
    requestSubmit: NativeForm.prototype.requestSubmit,
  };
  vm.createContext(sandbox);
  const innerWindow = vm.runInContext('window', sandbox);

  function fire(type, supplied) {
    const event = Object.assign({
      type,
      isTrusted: true,
      target: makeElement(),
      clientX: 5,
      clientY: 5,
      defaultPrevented: false,
      propagationStopped: false,
      immediateStopped: false,
    }, supplied || {});
    event.preventDefault = event.preventDefault || function preventDefault() { this.defaultPrevented = true; };
    event.stopPropagation = event.stopPropagation || function stopPropagation() { this.propagationStopped = true; };
    event.stopImmediatePropagation = event.stopImmediatePropagation || function stopImmediatePropagation() {
      this.propagationStopped = true;
      this.immediateStopped = true;
    };
    for (const fn of (listeners[type] || [])) {
      fn(event);
      if (event.immediateStopped) break;
    }
    return event;
  }

  return { sandbox, state, listeners, originals, innerWindow, fire };
}

function installContentNavigationHarness(pageUrl) {
  const h = makeBrowserSandbox(pageUrl);

  // Pull in the real sameSite helper used by the shipped gate.  Keeping this
  // separate makes cross-subdomain regressions visible (the old helper compared
  // exact hostnames even though its name promised site-level matching).
  const helperStart = CONTENT.indexOf('toURL=(h,b)=>');
  const helperEnd = CONTENT.indexOf(',COPY_CLEAN_GLOBAL=', helperStart);
  if (helperStart >= 0 && helperEnd > helperStart) {
    vm.runInContext('const ' + CONTENT.slice(helperStart, helperEnd) + ';', h.sandbox, {
      filename: 'content.min.js:same-site-helper',
    });
  } else {
    h.sandbox.sameSite = (a, b) => {
      const site = (raw) => {
        const labels = new URL(raw).hostname.toLowerCase().split('.');
        return labels.length > 2 && /^(ac|co|com|edu|gov|net|org)\.[a-z]{2}$/.test(labels.slice(-2).join('.'))
          ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
      };
      return site(a) === site(b);
    };
  }

  // This is the default navigation/form guard. If it has been removed in
  // favour of compatibility-safe event/DNR checks, native behavior is already
  // represented by the untouched sandbox and the tests below still apply.
  const startMarker = 'let lastGestureAt=0,gestureSpent=!1,lastLoginIntentAt=0;';
  const endMarker = 'if(WW.blockMetaRefresh){';
  const start = CONTENT.indexOf(startMarker);
  const end = CONTENT.indexOf(endMarker, start);
  if (start >= 0 && end > start) {
    vm.runInContext(CONTENT.slice(start, end), h.sandbox, {
      filename: 'content.min.js:navigation-compatibility',
    });
    h.navigationGuardPresent = true;
  } else {
    h.navigationGuardPresent = false;
  }
  return h;
}

function installAntiRedirect(pageUrl) {
  const h = makeBrowserSandbox(pageUrl);
  vm.runInContext(ANTI_REDIRECT, h.sandbox, { filename: 'anti-redirect.js' });
  h.fire('message', {
    source: h.innerWindow,
    data: { source: 'webwarden-handshake', token: 'compat-test-token' },
  });
  return h;
}

function makeForm(h, options) {
  options = options || {};
  const form = Object.create(h.sandbox.HTMLFormElement.prototype);
  form.tagName = 'FORM';
  form.nodeType = 1;
  form.action = options.action || h.sandbox.location.href;
  form.target = options.target || '';
  form.method = options.method || 'post';
  form.fields = options.fields || [];
  form.getAttribute = function getAttribute(name) {
    if (name === 'action') return this.action;
    if (name === 'target') return this.target || null;
    if (name === 'method') return this.method || null;
    return null;
  };
  form.querySelector = function querySelector(selector) {
    if (selector === 'input[type="password"]') return this.fields.find((field) => field.type === 'password') || null;
    return null;
  };
  form.querySelectorAll = function querySelectorAll(selector) {
    if (selector === 'input[name]') return this.fields.filter((field) => field.name);
    if (selector === 'input, textarea, select') return this.fields.slice();
    return [];
  };
  return form;
}

function extractArrayLiteral(source, constName) {
  const marker = 'const ' + constName;
  const at = source.indexOf(marker);
  if (at < 0) throw new Error('missing ' + constName);
  const start = source.indexOf('[', at + marker.length);
  if (start < 0) throw new Error('missing array for ' + constName);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      return vm.runInNewContext('(' + source.slice(start, i + 1) + ')');
    }
  }
  throw new Error('unterminated array for ' + constName);
}

function installActualSameSiteHelper(sandbox) {
  const helperStart = CONTENT.indexOf('toURL=(h,b)=>');
  const helperEnd = CONTENT.indexOf(',COPY_CLEAN_GLOBAL=', helperStart);
  if (helperStart >= 0 && helperEnd > helperStart) {
    vm.runInContext('const ' + CONTENT.slice(helperStart, helperEnd) + ';', sandbox, {
      filename: 'content.min.js:same-site-helper',
    });
    return;
  }
  sandbox.sameSite = (a, b) => new URL(a).hostname === new URL(b).hostname;
}

function makeAttributeElement(tag, initial, rect) {
  const attrs = Object.assign({}, initial || {});
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    attrs,
    getAttribute(name) { return this.attrs[name] == null ? null : this.attrs[name]; },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === 'src') this.src = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
      if (name === 'src') this.src = '';
    },
    getBoundingClientRect() {
      return rect || { top: 0, bottom: 20, left: 0, right: 20, width: 20, height: 20 };
    },
  };
  if (attrs.src) el.src = attrs.src;
  return el;
}

function runReloadLoopProbe(sharedStorage, isTopFrame, counters) {
  const start = CONTENT.indexOf('!function(){try{const host=location.hostname;');
  const end = CONTENT.indexOf('}();const TRACKING_PARAMS=', start);
  if (start < 0 || end <= start) return;
  const storage = {
    getItem(key) { return sharedStorage.has(key) ? sharedStorage.get(key) : null; },
    setItem(key, value) { sharedStorage.set(key, String(value)); },
    removeItem(key) { sharedStorage.delete(key); },
  };
  const sandbox = {
    Date,
    JSON,
    performance: { getEntriesByType(type) { return type === 'navigation' ? [{ type: 'reload' }] : []; } },
    location: { hostname: 'student.example.ac.uk', protocol: 'https:' },
    sessionStorage: storage,
    document: {
      body: null,
      documentElement: {},
      getElementById() { return null; },
      addEventListener() {},
    },
    log(type) { counters.logs.push(type); },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = isTopFrame ? sandbox : { location: { hostname: 'student.example.ac.uk' } };
  sandbox.WW_TOP = isTopFrame;
  sandbox.stop = () => { counters.stops++; };
  vm.createContext(sandbox);
  vm.runInContext(CONTENT.slice(start, end + 4), sandbox, {
    filename: 'content.min.js:reload-loop-compatibility',
  });
}

test('Drive can programmatically hand an unauthenticated user to Google Account Chooser', () => {
  const h = installContentNavigationHarness('https://drive.google.com/drive/u/0/my-drive');
  h.sandbox.Location.prototype.assign.call(
    h.sandbox.location,
    'https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fdrive.google.com%2F',
  );
  if (h.state.assigned.length !== 1) {
    throw new Error('navigation was intercepted: ' + JSON.stringify(h.state.logs));
  }
});

test('UCAS cross-subdomain navigation is treated as same-party', () => {
  const h = installContentNavigationHarness('https://apply.ucas.com/courses/search');
  h.sandbox.Location.prototype.replace.call(
    h.sandbox.location,
    'https://accounts.ucas.com/account/login?returnUrl=https%3A%2F%2Fapply.ucas.com%2F',
  );
  if (h.state.replaced.length !== 1) {
    throw new Error('cross-subdomain navigation was intercepted: ' + JSON.stringify(h.state.logs));
  }
});

test('university portal can perform a third-party SSO redirect without a synthetic click', () => {
  const h = installContentNavigationHarness('https://student.example.ac.uk/login');
  h.sandbox.Location.prototype.assign.call(
    h.sandbox.location,
    'https://login.microsoftonline.com/common/saml2?SAMLRequest=test&RelayState=portal',
  );
  if (h.state.assigned.length !== 1) {
    throw new Error('SSO navigation was intercepted: ' + JSON.stringify(h.state.logs));
  }
});

test('staged blank university SSO popup keeps its real window and can reach the IdP', () => {
  const h = installContentNavigationHarness('https://student.example.ac.uk/login');
  const button = makeElement({ tag: 'button', text: 'Sign in with your university' });
  h.fire('pointerdown', { target: button });
  h.fire('click', { target: button });
  const popup = h.sandbox.open('about:blank', 'institution-sso', 'popup');
  if (!popup || !popup.location) throw new Error('blank SSO popup was replaced or suppressed');
  popup.location.href = 'https://login.openathens.net/auth?return=https%3A%2F%2Fstudent.example.ac.uk%2F';
  if (!h.state.popupNavigations.some((url) => /openathens\.net/.test(url))) {
    throw new Error('popup navigation did not reach OpenAthens');
  }
});

test('anti-redirect layer allows Drive, UCAS and university SSO compatibility flows', () => {
  const drive = installAntiRedirect('https://drive.google.com/drive/my-drive');
  drive.sandbox.Location.prototype.assign.call(drive.sandbox.location, 'https://accounts.google.com/AccountChooser');
  if (drive.state.assigned.length !== 1) throw new Error('anti-redirect blocked Drive account switching');

  const ucas = installAntiRedirect('https://apply.ucas.com/');
  ucas.sandbox.Location.prototype.assign.call(ucas.sandbox.location, 'https://accounts.ucas.com/login');
  if (ucas.state.assigned.length !== 1) throw new Error('anti-redirect blocked a UCAS sibling host');

  const portal = installAntiRedirect('https://student.example.ac.uk/login');
  portal.sandbox.Location.prototype.assign.call(portal.sandbox.location, 'https://login.openathens.net/auth');
  if (portal.state.assigned.length !== 1) throw new Error('anti-redirect blocked OpenAthens SSO');
});

test('ordinary login pages retain native navigation and form API identities', () => {
  for (const pageUrl of [
    'https://drive.google.com/drive/my-drive',
    'https://apply.ucas.com/',
    'https://student.example.ac.uk/login',
  ]) {
    const h = installAntiRedirect(pageUrl);
    const changed = [];
    if (h.sandbox.open !== h.originals.open) changed.push('window.open');
    if (h.sandbox.Location.prototype.assign !== h.originals.assign) changed.push('Location.assign');
    if (h.sandbox.Location.prototype.replace !== h.originals.replace) changed.push('Location.replace');
    if (h.sandbox.HTMLFormElement.prototype.submit !== h.originals.submit) changed.push('form.submit');
    if (changed.length) throw new Error(pageUrl + ' replaced ' + changed.join(', '));
  }
});

test('clean sensitive login submit keeps the original submitter and page handlers', async () => {
  const h = makeBrowserSandbox('https://student.example.ac.uk/login');
  const pageSubmitters = [];
  const originalSubmit = h.sandbox.HTMLFormElement.prototype.submit;
  const originalRequestSubmit = h.sandbox.HTMLFormElement.prototype.requestSubmit;
  const field = {
    type: 'password', name: 'password', id: 'password', autocomplete: 'current-password',
    placeholder: '', getAttribute() { return ''; },
  };
  const form = makeForm(h, { action: 'https://student.example.ac.uk/session', fields: [field] });
  const defaultButton = { id: 'cancel' };
  const chosenButton = { id: 'continue', formAction: form.action };
  form.defaultSubmitter = defaultButton;

  const dispatchSubmit = (submitter) => {
    const event = h.fire('submit', { target: form, submitter });
    if (!event.propagationStopped) pageSubmitters.push(event.submitter);
    return event;
  };
  h.sandbox.HTMLFormElement.prototype.requestSubmit = function requestSubmit(submitter) {
    h.state.requestSubmits.push({ form: this, submitter: submitter || null });
    dispatchSubmit(submitter || this.defaultSubmitter || null);
  };
  h.originals.requestSubmit = h.sandbox.HTMLFormElement.prototype.requestSubmit;
  h.sandbox.urlReputationOn = () => true;
  h.sandbox.safeBrowsingCheck = () => Promise.resolve({ ok: true, hit: false, warning: false });
  h.sandbox.showSafeBrowsingPanel = () => {};
  h.sandbox.reputationWarningType = () => 'warning';
  h.sandbox.logReputationWarning = () => {};
  h.sandbox.urlReputationProvider = () => 'test';
  // Avoid keeping Node alive for the guard's WeakSet cleanup timer.
  h.sandbox.setTimeout = (fn, ms) => (Number(ms) >= 2000 ? 0 : setTimeout(fn, ms));

  const start = CONTENT.indexOf('if(urlReputationOn())try{const allowedForms=new WeakSet');
  const end = CONTENT.indexOf('if(WW.formTrapDetector)try{', start);
  if (start >= 0 && end > start) {
    vm.runInContext(CONTENT.slice(start, end), h.sandbox, {
      filename: 'content.min.js:safe-browsing-form-compatibility',
    });
  }

  const firstEvent = dispatchSubmit(chosenButton);
  const synchronousHandlerCount = pageSubmitters.length;
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  if (h.sandbox.HTMLFormElement.prototype.submit !== originalSubmit) {
    throw new Error('HTMLFormElement.prototype.submit was globally replaced');
  }
  if (h.sandbox.HTMLFormElement.prototype.requestSubmit !== h.originals.requestSubmit) {
    throw new Error('HTMLFormElement.prototype.requestSubmit was globally replaced');
  }
  if (firstEvent.defaultPrevented || firstEvent.propagationStopped) {
    throw new Error('clean login submit was intercepted before the page handler');
  }
  if (synchronousHandlerCount !== 1 || pageSubmitters[0] !== chosenButton) {
    throw new Error('page handler did not receive the original submitter');
  }
  if (h.state.requestSubmits.length !== 0 || pageSubmitters.length !== 1) {
    throw new Error('clean submit was replayed (possibly with the wrong submitter)');
  }
  // Keep the pre-install reference live so an accidental assignment cannot be
  // hidden by an equivalent-looking replacement function.
  if (typeof originalRequestSubmit !== 'function') throw new Error('native requestSubmit missing from harness');
});

test('reload-loop detector counts top-level loads, not same-page frames', () => {
  const sharedStorage = new Map();
  const counters = { stops: 0, logs: [] };
  runReloadLoopProbe(sharedStorage, true, counters);
  for (let i = 0; i < 8; i++) runReloadLoopProbe(sharedStorage, false, counters);
  if (counters.stops || counters.logs.includes('reload_loop_broken')) {
    throw new Error('subframes falsely tripped the reload-loop breaker');
  }
  const raw = sharedStorage.get('__ww_rl_student.example.ac.uk') || '[]';
  const hits = JSON.parse(raw);
  if (hits.length !== 1) throw new Error('expected one top-frame hit, got ' + hits.length);
});

test('offscreen authentication iframe keeps its src', () => {
  const start = CONTENT.indexOf('if(WW.lazyLoadMedia)try{');
  const end = CONTENT.indexOf('let socialWidgetGuardInstalled=!1;', start);
  if (start < 0 || end <= start) return;
  const iframe = makeAttributeElement(
    'iframe',
    { src: 'https://accounts.google.com/gsi/fedcm/listaccounts' },
    { top: 1800, bottom: 1850, left: 0, right: 1, width: 1, height: 50 },
  );
  const observed = [];
  const sandbox = {
    WW: { lazyLoadMedia: true },
    innerHeight: 800,
    document: {
      documentElement: {},
      querySelectorAll(selector) { return selector === 'img,iframe' ? [iframe] : []; },
    },
    IntersectionObserver: class IntersectionObserver {
      constructor(callback) { this.callback = callback; }
      observe(el) { observed.push(el); }
      unobserve() {}
    },
    wwObserve() {},
    log() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CONTENT.slice(start, end), sandbox, {
    filename: 'content.min.js:auth-iframe-compatibility',
  });
  if (!iframe.getAttribute('src') || iframe.getAttribute('data-ww-src')) {
    throw new Error('lazy-media guard detached the hidden Google auth iframe (observed=' + observed.length + ')');
  }
});

test('generic SAML meta refresh remains available to the browser', () => {
  const start = CONTENT.indexOf('if(WW.blockMetaRefresh){');
  const end = CONTENT.indexOf('if(WW.detectRedirectChains){', start);
  if (start < 0 || end <= start) return;
  const original = '0; url=https://idp.identity.example/saml/login?SAMLRequest=test&RelayState=portal';
  const meta = makeAttributeElement('meta', { content: original, 'http-equiv': 'refresh' });
  const sandbox = {
    URL,
    location: {
      href: 'https://student.example.ac.uk/sso/start',
      hostname: 'student.example.ac.uk',
    },
    WW: { blockMetaRefresh: true, __frozen: false },
    regDomain: (host) => String(host || '').replace(/^www\./, '').toLowerCase(),
    document: {
      querySelectorAll(selector) { return selector.includes('meta') ? [meta] : []; },
    },
    wwObserve() {},
    log() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  installActualSameSiteHelper(sandbox);
  vm.runInContext(CONTENT.slice(start, end), sandbox, {
    filename: 'content.min.js:saml-meta-refresh-compatibility',
  });
  if (meta.getAttribute('content') !== original) {
    throw new Error('SAML meta refresh was disabled as a generic cross-site redirect');
  }
});

test('same-party subdomain iframe is not classified as a third-party cookie frame', () => {
  const start = CONTENT.indexOf('let cookieBlockerInstalled=!1,cookieBlockerOriginalOwnDesc=null,cookieBlockLogCount=0;');
  const end = CONTENT.indexOf('let supercookieGuardInstalled=!1;', start);
  if (start < 0 || end <= start) return;
  const document = {
    cookie: 'ucas_session=present',
    referrer: 'https://apply.ucas.com/application',
    addEventListener() {},
  };
  const inaccessibleTop = {};
  Object.defineProperty(inaccessibleTop, 'location', {
    get() { throw new Error('cross-origin WindowProxy'); },
  });
  const sandbox = {
    Object,
    URL,
    document,
    location: {
      href: 'https://accounts.ucas.com/login',
      hostname: 'accounts.ucas.com',
      ancestorOrigins: ['https://apply.ucas.com'],
    },
    WW: { blockThirdPartyCookies: true },
    log() {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = inaccessibleTop;
  vm.createContext(sandbox);
  vm.runInContext(CONTENT.slice(start, end), sandbox, {
    filename: 'content.min.js:cookie-party-compatibility',
  });
  if (document.__wwCookieBlockerActive || document.cookie === '') {
    throw new Error('accounts.ucas.com iframe was treated as third-party to apply.ucas.com');
  }
});

test('background does not close a university portal staged blank popup', async () => {
  const start = BACKGROUND.indexOf('function isBlankPopupUrl');
  const end = BACKGROUND.indexOf('function chainAbuseTld', start);
  // Removing the blanket closer is a valid (and most compatibility-safe) fix.
  if (start < 0 || end <= start || !BACKGROUND.slice(start, end).includes('maybeCloseBlankPopupTarget')) return;
  const removed = [];
  const tabs = {
    11: { id: 11, url: 'https://portal.example.ac.uk/dashboard' },
    12: { id: 12, url: 'about:blank' },
  };
  const sandbox = {
    URL,
    Date,
    Promise,
    Object,
    DEFAULT_CONFIG: { enabled: true, blockForcedPopups: true },
    localGet: async () => ({ webwarden_config: {} }),
    counts: Object.create(null),
    setBadge() {},
    queueHistory() {},
    setTimeout(fn) { fn(); return 1; },
    chrome: {
      runtime: { lastError: null },
      tabs: {
        get(id, callback) { callback(tabs[id] || null); },
        remove(id, callback) { removed.push(id); callback(); },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    BACKGROUND.slice(start, end) + ';globalThis.__closeBlank=maybeCloseBlankPopupTarget;',
    sandbox,
    { filename: 'background.js:blank-popup-compatibility' },
  );
  sandbox.__closeBlank({ tabId: 12, sourceTabId: 11, url: 'about:blank' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  if (removed.includes(12)) throw new Error('background closed the portal SSO popup before it navigated');
});

test('login compatibility DNR covers Google and university federation plumbing', () => {
  const filters = extractArrayLiteral(BACKGROUND, 'LOGIN_COMPAT_FILTERS').map(String);
  const neverBlock = extractArrayLiteral(BACKGROUND, 'LOGIN_COMPAT_NEVER_BLOCK_DOMAINS').map(String);
  for (const token of ['accounts.google.com', 'oauth2.googleapis.com', 'apis.google.com', 'gstatic.com']) {
    if (!filters.some((value) => value.includes(token)) && !neverBlock.some((value) => value.includes(token))) {
      throw new Error('Google auth compatibility is missing ' + token);
    }
  }
  for (const token of ['openathens.net', 'shibboleth']) {
    if (!filters.some((value) => value.includes(token))) {
      throw new Error('login allow rules are missing ' + token);
    }
    if (!neverBlock.some((value) => value.includes(token))) {
      throw new Error('third-party cookie exclusion is missing ' + token);
    }
  }
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed++;
      console.log('  ok  - ' + item.name);
    } catch (error) {
      failed++;
      console.error('  FAIL - ' + item.name + ' :: ' + (error && error.message ? error.message : error));
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

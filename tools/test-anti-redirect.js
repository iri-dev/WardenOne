/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Node harness for anti-redirect.js — loads the hardener into a stub DOM (vm
 * sandbox) and drives synthetic gestures + navigation attempts through the
 * real hooks. Run: node tools/test-anti-redirect.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const woAuth = require('./lib/wo-auth');
/* This suite lifts a guard's source and runs it in a hand-built sandbox. The guards now use
 * AbortController to release their listeners on teardown, which a bare vm context does not have. */
const { installPlatformGlobals } = require('./lib/engine-ambient.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'anti-redirect.js'), 'utf8');
const DOMAIN_UTILS = fs.readFileSync(path.join(__dirname, '..', 'domain-utils.js'), 'utf8');

const PREDS = {
  'a[href],area[href]': (el) => (el.tagName === 'A' || el.tagName === 'AREA') && (el.attrs.href != null || el.href),
  'button,input': (el) => el.tagName === 'BUTTON' || el.tagName === 'INPUT',
  'form[action]': (el) => el.tagName === 'FORM' && el.attrs.action != null,
  'a,button,input,[role="button"],[tabindex]': (el) => ['A', 'BUTTON', 'INPUT'].indexOf(el.tagName) >= 0 || el.attrs.role === 'button' || el.attrs.tabindex != null,
  'video,audio': (el) => el.tagName === 'VIDEO' || el.tagName === 'AUDIO',
  '[role="slider"],input[type="range"],.jw-slider-time,.vjs-progress-control,.plyr__progress,.dplayer-bar,.art-progress': (el) => el.attrs.role === 'slider' || (el.tagName === 'INPUT' && el.attrs.type === 'range') || /\b(?:jw-slider-time|vjs-progress-control|plyr__progress|dplayer-bar|art-progress)\b/.test(el.className),
  '.video-js,.jwplayer,.plyr,[data-player],#player': (el) => /\bvideo-js\b|\bjwplayer\b|\bplyr\b/.test(el.className) || el.id === 'player' || el.attrs['data-player'] != null,
  '.video-js,.jwplayer,.plyr,.dplayer,.art-video-player,.shaka-video-container,video': (el) => /\b(?:video-js|jwplayer|plyr|dplayer|art-video-player|shaka-video-container)\b/.test(el.className) || el.tagName === 'VIDEO',
  'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="tab"],input[type="button"],input[type="submit"],[onclick],[data-link],[data-src],[data-server],[data-embed]': (el) =>
    el.tagName === 'BUTTON' || ['button', 'menuitem', 'menuitemradio', 'option', 'tab'].includes(el.attrs.role)
      || (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.attrs.type))
      || ['onclick', 'data-link', 'data-src', 'data-server', 'data-embed'].some((a) => el.attrs[a] != null),
  'a[href],area[href],form,input:not([type="range"]),textarea,select': (el) => ((el.tagName === 'A' || el.tagName === 'AREA') && (el.attrs.href != null || el.href)) || el.tagName === 'FORM' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.attrs.type !== 'range'),
};

function makeEl(props) {
  props = props || {};
  const el = {
    nodeType: 1,
    tagName: String(props.tag || 'DIV').toUpperCase(),
    attrs: props.attrs || {},
    parent: props.parent || null,
    parentElement: props.parent || null,
    textContent: props.text || '',
    id: props.id || '',
    className: props.className || '',
    href: props.href,
    formAction: props.formAction,
    action: props.action,
    target: props.target || '',
    duration: props.duration,
    currentTime: props.currentTime || 0,
    style: Object.assign({
      /* A plain assignment (style['pointer-events'] = 'auto'), like the CSSOM one a page makes,
         replaces the declaration and its !important; setProperty records the priority. */
      setProperty(name, value, priority) {
        this[name] = value;
        Object.defineProperty(this, '__val_' + name, { value, writable: true, configurable: true });
        Object.defineProperty(this, '__prio_' + name, { value: priority || '', writable: true, configurable: true });
      },
      getPropertyValue(name) { return this[name] || ''; },
      getPropertyPriority(name) { return this[name] === this['__val_' + name] ? (this['__prio_' + name] || '') : ''; },
      removeProperty(name) { delete this[name]; },
    }, props.style || {}),
    children: props.children || [],
    childNodes: props.childNodes || [],
    rect: props.rect || { left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 },
    containsVideo: !!props.containsVideo,
    getAttribute(n) { return this.attrs[n] != null ? this.attrs[n] : null; },
    hasAttribute(n) { return this.attrs[n] != null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
    removeAttribute(n) { delete this.attrs[n]; },
    get attributes() { return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] })); },
    getElementsByTagName(tag) {
      const out = [];
      (function walk(list) { for (const c of list) { if (tag === '*' || c.tagName === String(tag).toUpperCase()) out.push(c); walk(c.children || []); } })(this.children);
      return out;
    },
    getBoundingClientRect() { return this.rect; },
    querySelector(sel) {
      const parts = String(sel).split(',').map((p) => p.trim());
      if (parts.includes('a[href]')) {
        const link = this.getElementsByTagName('A').find((c) => c.href || c.attrs.href != null);
        if (link) return link;
      }
      return parts.includes('video') && this.containsVideo ? makeEl({ tag: 'video' }) : null;
    },
    click() { if (props.onClick) props.onClick(); },
    play() { if (props.onPlay) return props.onPlay(); },
    closest(sel) {
      const p = PREDS[sel];
      let e = this;
      while (e) {
        if (p && p(e)) return e;
        e = e.parent || null;
      }
      return null;
    },
  };
  return el;
}

function build(opts) {
  opts = opts || {};
  const state = { opened: [], popupNavigations: [], handles: [], assigned: [], replaced: [], hrefSets: [], submitted: [], emits: [], navSignals: [] };
  const listeners = {};
  const sandbox = {};
  let clockNow = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();
  class HarnessDate extends Date {}
  HarnessDate.now = () => clockNow;
  sandbox.window = sandbox;
  sandbox.top = opts.framed ? {} : sandbox;
  sandbox.self = sandbox;
  sandbox.innerWidth = 1000;
  sandbox.innerHeight = 800;
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const nativeOpen = function (u) {
    const initial = String(u == null ? 'about:blank' : u);
    state.opened.push(initial);
    let popupHref = initial;
    const popupLocation = {
      assign(v) { this.href = v; },
      replace(v) { this.href = v; },
    };
    Object.defineProperty(popupLocation, 'href', {
      configurable: true,
      enumerable: true,
      get() { return popupHref; },
      set(v) {
        popupHref = String(v);
        state.popupNavigations.push(popupHref);
      },
    });
    const handle = {
      __nativeWindow: true,
      closed: false,
      location: popupLocation,
      close() { this.closed = true; },
    };
    state.handles.push(handle);
    return handle;
  };
  sandbox.open = nativeOpen;
  sandbox.URL = URL;
  sandbox.Date = opts.fakeClock ? HarnessDate : Date;
  sandbox.Number = Number;
  sandbox.Object = Object;
  sandbox.String = String;
  sandbox.Math = Math;
  sandbox.CustomEvent = class CustomEvent { constructor(t, i) { this.type = t; this.detail = i && i.detail; } };
  sandbox.getComputedStyle = (el) => ({
    opacity: String(el && el.style && el.style.opacity != null ? el.style.opacity : '1'),
    position: String(el && el.style && el.style.position || 'static'),
    zIndex: String(el && el.style && el.style.zIndex || 'auto'),
    backgroundColor: String(el && el.style && el.style.backgroundColor || 'rgba(0, 0, 0, 0)'),
    backgroundImage: String(el && el.style && el.style.backgroundImage || 'none'),
  });
  /* The Navigation API, so the player-frame guard can be handed navigate events. */
  const navListeners = [];
  if (opts.navigationApi !== false) {
    sandbox.navigation = { addEventListener(type, fn) { if (type === 'navigate') navListeners.push(fn); } };
  }
  const timers = [];
  if (opts.timers) sandbox.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  /* Child frames as the top frame sees them: same-origin ones carry the published press time. */
  if (opts.childFrames) sandbox.frames = opts.childFrames;
  /* And the parent, as a child frame sees it. */
  if (opts.parentFrame) sandbox.parent = opts.parentFrame;
  /* A MutationObserver the test can fire by hand. */
  const observers = [];
  if (opts.mutationObserver) {
    sandbox.MutationObserver = class {
      constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); }
      observe(target) { this.targets.push(target); }
      disconnect() { this.targets = []; }
    };
  }
  sandbox.Location = function Location() {};
  const nativeAssign = function (u) { state.assigned.push(String(u)); };
  const nativeReplace = function (u) { state.replaced.push(String(u)); };
  sandbox.Location.prototype.assign = nativeAssign;
  sandbox.Location.prototype.replace = nativeReplace;
  sandbox.HTMLFormElement = function HTMLFormElement() {};
  const nativeSubmit = function () { state.submitted.push(1); };
  sandbox.HTMLFormElement.prototype.submit = nativeSubmit;

  const videos = (opts.videoRects || []).map((r) => makeEl({ tag: 'video', rect: r }));
  const iframes = (opts.iframeRects || []).map((r) => makeEl({ tag: 'iframe', rect: r }));
  const playerSurfaces = (opts.playerRects || []).map((r) => makeEl({ tag: 'div', className: 'video-player', rect: r }));
  const loc = {};
  let hrefVal = opts.href || 'https://videosite.com/page';
  const nativeHrefGet = function () { return hrefVal; };
  const nativeHrefSet = function (v) { state.hrefSets.push(String(v)); };
  Object.defineProperty(loc, 'href', {
    configurable: true, enumerable: true,
    get: nativeHrefGet,
    set: nativeHrefSet,
  });
  loc.hostname = opts.hostname || 'videosite.com';
  loc.pathname = opts.pathname || '/page';
  sandbox.location = loc;
  sandbox.document = {
    body: opts.bodyChildren || opts.htmlChildren ? { nodeType: 1, tagName: 'BODY', children: opts.bodyChildren || [] } : undefined,
    documentElement: opts.bodyChildren || opts.htmlChildren ? { nodeType: 1, tagName: 'HTML', children: opts.htmlChildren || [] } : undefined,
    activeElement: null,
    elementsFromPoint: opts.elementStack ? () => opts.elementStack : undefined,
    dispatchEvent(ev) {
      if (ev && ev.type === 'wo-event') state.emits.push(ev.detail);
      if (ev && ev.type === 'wo-nav-signal') state.navSignals.push(ev.detail);
    },
    getElementsByTagName(tag) {
      tag = String(tag || '').toLowerCase();
      if (tag === 'video') return videos;
      if (tag === 'iframe') return iframes;
      return [];
    },
    querySelector(selector) {
      const selectors = String(selector || '').split(',').map((part) => part.trim());
      if (opts.playerSelector && selectors.indexOf(opts.playerSelector) >= 0) return makeEl({ tag: 'div' });
      if (selectors.indexOf('video') >= 0 && videos.length) return videos[0];
      if (selectors.some((part) => /^iframe/.test(part)) && iframes.length) return iframes[0];
      return null;
    },
    querySelectorAll(sel) {
      return String(sel || '').indexOf('player') >= 0 || String(sel || '').indexOf('video') >= 0 ? playerSurfaces : [];
    },
  };

  /* The key arrives on the document (SEC-01), so its listeners must be real. */
  const dispatchDoc = woAuth.documentEvents(sandbox.document);
  installPlatformGlobals(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(DOMAIN_UTILS, sandbox);
  vm.runInContext(SRC, sandbox);
  // Inside the vm, `window` resolves to the contextified global proxy, not the
  // raw sandbox object — the handshake's `event.source !== window` check needs
  // the inner identity.
  const innerWindow = vm.runInContext('window', sandbox);

  const api = {
    state,
    sandbox,
    videos,
    iframes,
    playerSurfaces,
    nativeApisUntouched() {
      const hrefDesc = Object.getOwnPropertyDescriptor(loc, 'href');
      return sandbox.open === nativeOpen
        && sandbox.Location.prototype.assign === nativeAssign
        && sandbox.Location.prototype.replace === nativeReplace
        && sandbox.HTMLFormElement.prototype.submit === nativeSubmit
        && hrefDesc && hrefDesc.get === nativeHrefGet && hrefDesc.set === nativeHrefSet;
    },
    fire(type, ev) {
      ev = ev || {};
      ev.type = type;
      if (ev.isTrusted === undefined) ev.isTrusted = true;
      ev.defaultPrevented = false;
      ev.immediatePropagationStopped = false;
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      ev.stopImmediatePropagation = () => { ev.immediatePropagationStopped = true; };
      ev.stopPropagation = () => { ev.propagationStopped = true; };
      (listeners[type] || []).forEach((fn) => fn(ev));
      return ev;
    },
    userClick(el, x, y) {
      api.fire('pointerdown', { target: el, clientX: x, clientY: y });
      return api.fire('click', { target: el, clientX: x, clientY: y });
    },
    navListeners,
    /* A navigate event the way Chrome builds one; returns it so a test can read defaultPrevented. */
    navigate(url, extra) {
      const ev = Object.assign({
        cancelable: true, hashChange: false, downloadRequest: null, navigationType: 'push',
        userInitiated: false, sourceElement: null, destination: { url },
        defaultPrevented: false,
      }, extra || {});
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      navListeners.forEach((fn) => fn(ev));
      return ev;
    },
    runTimers() { while (timers.length) timers.shift()(); },
    /* Fire every observer watching this node, the way a mutation inside it would. */
    mutate(node) { observers.filter((o) => o.targets.includes(node)).forEach((o) => o.fn([{ addedNodes: [] }])); },
    open(u, name, features) { return sandbox.open(u, name, features); },
    advanceTime(ms) { clockNow += Number(ms) || 0; },
    assign(u) { sandbox.Location.prototype.assign.call(loc, u); },
    setHref(u) { loc.href = u; },
    submit(form) { sandbox.HTMLFormElement.prototype.submit.call(form); },
    lastEmit() { return state.emits[state.emits.length - 1] || null; },
    handshake(config) {
      if (!api.link) api.link = woAuth.handshake(dispatchDoc, (data) => api.fire('message', { source: innerWindow, data }));
      if (config !== false) {
        api.link.sendConfig(Object.assign({
          enabled: true,
          blockGesturelessNav: true,
          blockForcedPopups: true,
          strictPopupShield: true,
          gestureWindowMs: 2400,
        }, config || opts.config || {}));
      }
    },
    sendBootstrap(overrides) {
      const data = api.link.sign('redirect-bootstrap', JSON.stringify(overrides), {
        source: 'wardenone', kind: 'redirect-bootstrap', token: api.link.token, overrides,
      });
      api.fire('message', { source: innerWindow, data });
    },
    forgeBootstrap(overrides) {
      api.fire('message', { source: innerWindow, data: {
        source: 'wardenone', kind: 'redirect-bootstrap', token: api.link.token,
        overrides, seq: 999, mac: 'f'.repeat(64),
      } });
    },
    /* A page's attempt: the same message without a valid signature. */
    forgeConfig(overrides) {
      api.fire('message', { source: innerWindow, data: { source: 'wardenone', kind: 'config', token: api.link ? api.link.token : 'tok', overrides, seq: 999, mac: 'f'.repeat(64) } });
    },
  };
  api.handshake(opts.deferConfig ? false : undefined);
  return api;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else {
    fail++;
    let detail = '';
    if (extra) {
      try { detail = ' :: ' + JSON.stringify(extra); } catch (_) { detail = ' :: [non-serializable value]'; }
    }
    console.log('  FAIL - ' + name + detail);
  }
}

// T1: gestureless popup blocked
{
  const t = build();
  t.open('https://ads1-example.com/x');
  check('T1 gestureless popup blocked', t.state.opened.length === 0, t.state);
  const pop = t.open('https://ads2-example.com/y');
  check('T1b blocked popup returns inert closed facade', !!pop && pop.closed === true && pop.document && typeof pop.document.write === 'function', pop);
}

// T2: plain-element gesture allows ONE non-suspicious popup, second is blocked
{
  const t = build();
  const div = makeEl({});
  t.userClick(div, 50, 50);
  t.open('https://randomapp.com/dash');
  t.open('https://randomapp2.com/dash');
  check('T2a first gesture popup allowed', t.state.opened.length === 1, t.state.opened);
  check('T2b second popup same gesture blocked (popunder chain)', t.state.opened.length === 1, t.state.opened);
  const e = t.lastEmit();
  check('T2c popup block is silent', !!e && e.detail.silent === true, e);
}

// T3: gesture ON the video never allows a cross-site popup
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  t.userClick(t.videos[0], 300, 300);
  t.open('https://randomapp.com/dash');
  check('T3 popup from video click blocked', t.state.opened.length === 0, t.state.opened);
}

{
  const t = build({ framed: true,
    videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  t.userClick(t.videos[0], 300, 300);
  check('T3 child-frame player click reports the signed attribution needed by the top-navigation backstop',
    t.state.navSignals.some((entry) => entry.kind === 'player-gesture'), t.state.navSignals);
  check('T3 child frames cannot grant general top-navigation authorization',
    !t.state.navSignals.some((entry) => entry.kind === 'gesture'), t.state.navSignals);
}

// A cold worker must not leave the first player click unguarded. The bridge
// sends a signed, storage-backed popup bootstrap before the full snapshot.
{
  const t = build({ deferConfig: true,
    videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  t.sendBootstrap({ enabled: true, blockForcedPopups: true, strictPopupShield: true, allowlist: [] });
  t.userClick(t.videos[0], 300, 300);
  t.open('https://newsboydurance.cfd/ad');
  check('T3 cold-start popup bootstrap blocks an ad on the first click', t.state.opened.length === 0);
  t.handshake({ enabled: false });
  t.open('https://newsboydurance.cfd/ad');
  check('T3 full disabled config replaces the bootstrap', t.state.opened.length === 1);
}
{
  const t = build({ deferConfig: true });
  t.forgeBootstrap({ enabled: true, blockForcedPopups: true, strictPopupShield: true });
  t.open('https://newsboydurance.cfd/ad');
  check('T3 forged bootstrap cannot enable the guard', t.state.opened.length === 1);
}

// T3b: gesture on a div that OVERLAYS the video (coords inside video rect)
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  const overlay = makeEl({});
  t.userClick(overlay, 300, 300);
  t.open('https://randomapp.com/dash');
  check('T3b popup from overlay-on-video click blocked', t.state.opened.length === 0, t.state.opened);
}

// T3c: a transparent cross-site link and anonymous click square over the Play
// button lose pointer access; the real player control gets one activation.
{
  const player = makeEl({ className: 'video-js' });
  let plays = 0;
  const button = makeEl({ tag: 'button', parent: player, onClick: () => { plays++; } });
  const video = makeEl({ tag: 'video', onPlay: () => { plays++; return Promise.resolve(); } });
  const cover = makeEl({ style: { position: 'fixed', opacity: '0.01', zIndex: '2147483647' },
    rect: { left: 0, top: 0, width: 1000, height: 800 } });
  const link = makeEl({ tag: 'a', parent: cover, href: 'https://wearadmiration.com/ads', attrs: { href: 'https://wearadmiration.com/ads' } });
  const square = makeEl({ style: { position: 'fixed', zIndex: '2147483647' },
    rect: { left: 240, top: 240, width: 120, height: 120 }, text: '' });
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }],
    elementStack: [square, link, cover, button, video] });
  const press = t.fire('pointerdown', { target: square, clientX: 300, clientY: 300 });
  check('T3c layered ad press is cancelled and the play control activates', press.defaultPrevented && plays === 1, { press: press.defaultPrevented, plays });
  check('T3c both ad layers lose pointer access', square.style['pointer-events'] === 'none' && cover.style['pointer-events'] === 'none');
  const click = t.fire('click', { target: makeEl({}), clientX: 300, clientY: 300 });
  check('T3c follow-up trusted click cannot launch the ad', click.defaultPrevented);
}
{
  const player = makeEl({ className: 'video-js' });
  const button = makeEl({ tag: 'button', parent: player });
  const cover = makeEl({ style: { position: 'fixed', opacity: '1', zIndex: '2147483647' },
    rect: { left: 0, top: 0, width: 1000, height: 800 } });
  const link = makeEl({ tag: 'a', parent: cover, href: 'https://example.com/guide', attrs: { href: 'https://example.com/guide' } });
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }],
    elementStack: [link, cover, button] });
  const press = t.fire('pointerdown', { target: link, clientX: 300, clientY: 300 });
  check('T3c visible linked player control is left alone', !press.defaultPrevented && cover.style['pointer-events'] !== 'none');
}

// T4: same-tab redirect from a plain-element gesture is blocked (interstitial)
{
  const t = build();
  const div = makeEl({});
  t.userClick(div, 50, 50);
  t.assign('https://randomsite.com/lander');
  check('T4a same-tab forced redirect blocked', t.state.assigned.length === 0, t.state.assigned);
  const e = t.lastEmit();
  check('T4b non-silent (interstitial offers Continue)', !!e && e.detail.silent === false && e.detail.why === 'forced redirect after a click', e);
}

// T5: same-tab redirect from a video click is blocked SILENTLY
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  t.userClick(t.videos[0], 300, 300);
  t.setHref('https://randomsite.com/lander');
  check('T5a href redirect from video click blocked', t.state.hrefSets.length === 0, t.state.hrefSets);
  const e = t.lastEmit();
  check('T5b block is silent (user keeps watching)', !!e && e.detail.silent === true, e);
}

// T6: real link click to dest.com allows same-tab nav to dest.com
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://dest.com/page', attrs: { href: 'https://dest.com/page' } });
  t.userClick(a, 50, 50);
  t.assign('https://dest.com/other');
  check('T6 explicit link click allows matching-site nav', t.state.assigned.length === 1, t.state);
}

// T7: real link click to dest.com does NOT allow nav to evil.com
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://dest.com/page', attrs: { href: 'https://dest.com/page' } });
  t.userClick(a, 50, 50);
  t.assign('https://evil-lander.com/x');
  check('T7a mismatched nav blocked', t.state.assigned.length === 0, t.state.assigned);
  const e = t.lastEmit();
  check('T7b why = click did not target this site', !!e && e.detail.why === 'click did not target this site' && e.detail.silent === false, e);
}

// T8: labeled login button allows same-tab nav to an SSO host
{
  const t = build();
  const btn = makeEl({ tag: 'button', text: 'Sign in' });
  t.userClick(btn, 50, 50);
  t.assign('https://sso.identityprovider.com/auth');
  check('T8 login-labeled button allows SSO redirect', t.state.assigned.length === 1, t.state);
}

// T9: page-generated (untrusted) click on a cross-site link is cancelled
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://adnetwork-lander.com/z', attrs: { href: 'https://adnetwork-lander.com/z' } });
  const ev = t.fire('click', { target: a, isTrusted: false });
  check('T9 synthetic cross-site anchor click cancelled', ev.defaultPrevented === true, ev);
}

// T10: bait-and-switch href swap between press and click
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://goodshop.com/x', attrs: { href: 'https://goodshop.com/x' } });
  t.fire('pointerdown', { target: a, clientX: 50, clientY: 50 });
  a.href = 'https://sneakylander.com/z';
  a.attrs.href = 'https://sneakylander.com/z';
  const ev = t.fire('click', { target: a, clientX: 50, clientY: 50 });
  check('T10a swapped link click cancelled', ev.defaultPrevented === true, ev);
  t.open('https://sneakylander.com/z');
  check('T10b follow-up popup to swap target blocked', t.state.opened.length === 0, t.state.opened);
}

// T10c: search-engine tracking rewrite (same-origin redirector <-> real destination
// swapped around mousedown, e.g. google.com/url?q=) is NOT a bait-and-switch hijack,
// so the FIRST click must NOT be cancelled. Regression for the "2 clicks to open a
// search result" bug.
{
  const t = build(); // page host = videosite.com
  const a = makeEl({ tag: 'a', href: 'https://videosite.com/redir?u=gamedrive.org', attrs: { href: 'https://videosite.com/redir?u=gamedrive.org' } });
  t.fire('pointerdown', { target: a, clientX: 50, clientY: 50 });
  // page un-wraps its own same-origin tracking link to the real external destination
  a.href = 'https://gamedrive.org/game';
  a.attrs.href = 'https://gamedrive.org/game';
  const ev = t.fire('click', { target: a, clientX: 50, clientY: 50 });
  check('T10c same-origin tracking rewrite NOT cancelled', ev.defaultPrevented !== true, ev);
}

// T10d: third-party redirector wrappers that visibly carry the final URL are
// also normal tracking/unshim behavior, not a bait-and-switch hijack.
{
  const t = build();
  const wrapped = 'https://outbound.example/track?url=https%3A%2F%2Fgamedrive.org%2Fgame';
  const a = makeEl({ tag: 'a', href: wrapped, attrs: { href: wrapped } });
  t.fire('pointerdown', { target: a, clientX: 50, clientY: 50 });
  a.href = 'https://gamedrive.org/game';
  a.attrs.href = 'https://gamedrive.org/game';
  const ev = t.fire('click', { target: a, clientX: 50, clientY: 50 });
  check('T10d third-party redirect wrapper to final URL NOT cancelled', ev.defaultPrevented !== true, ev);
}

// T10e: some sites rewrite in the other direction for click accounting.
{
  const t = build();
  const wrapped = 'https://outbound.example/track?url=https%3A%2F%2Frexagames.com%2Ftopic%2F123';
  const a = makeEl({ tag: 'a', href: 'https://rexagames.com/topic/123', attrs: { href: 'https://rexagames.com/topic/123' } });
  t.fire('pointerdown', { target: a, clientX: 50, clientY: 50 });
  a.href = wrapped;
  a.attrs.href = wrapped;
  const ev = t.fire('click', { target: a, clientX: 50, clientY: 50 });
  check('T10e final URL to third-party redirect wrapper NOT cancelled', ev.defaultPrevented !== true, ev);
}

// T11: same-tab nav to a KNOWN_GOOD host from a plain gesture still works
{
  const t = build();
  const div = makeEl({});
  t.userClick(div, 50, 50);
  t.assign('https://accounts.google.com/signin');
  check('T11 known-good (login provider) nav allowed', t.state.assigned.length === 1, t.state);
}

// T12: invisible cross-site link click cancelled
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://lander-xyz.com/a', attrs: { href: 'https://lander-xyz.com/a' }, style: { opacity: '0' } });
  const ev = t.userClick(a, 50, 50);
  check('T12 invisible cross-site link cancelled', ev.defaultPrevented === true, ev);
}

// T13: page-covering cross-site link cancelled (non-silent)
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://lander-xyz.com/a', attrs: { href: 'https://lander-xyz.com/a' }, rect: { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } });
  const ev = t.userClick(a, 400, 400);
  check('T13a page-covering link cancelled', ev.defaultPrevented === true, ev);
  const e = t.lastEmit();
  check('T13b non-silent (Continue available)', !!e && e.detail.silent === false, e);
}

// T13c: a normal same-tab link over the player remains native. Popup overlays
// are handled only when target=_blank and confirmed/suspicious.
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  const a = makeEl({ tag: 'a', href: 'https://lander-xyz.com/a', attrs: { href: 'https://lander-xyz.com/a' }, rect: { left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 } });
  const ev = t.userClick(a, 300, 300);
  check('T13c ordinary same-tab link over video player stays native', ev.defaultPrevented === false, ev);
}

// T13d: a normal link wrapping media is likewise left native.
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  const a = makeEl({ tag: 'a', href: 'https://adult-lander.com/a', attrs: { href: 'https://adult-lander.com/a' }, rect: { left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }, containsVideo: true });
  const ev = t.userClick(a, 300, 300);
  check('T13d ordinary link wrapping video player stays native', ev.defaultPrevented === false, ev);
}

// T13e: a script cannot reuse an explicit video-link destination for same-tab redirect
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  const a = makeEl({ tag: 'a', href: 'https://adult-lander.com/a', attrs: { href: 'https://adult-lander.com/a' }, rect: { left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }, containsVideo: true });
  t.fire('pointerdown', { target: a, clientX: 300, clientY: 300 });
  t.assign('https://adult-lander.com/a');
  check('T13e video click does not authorize scripted redirect', t.state.assigned.length === 0, t.state.assigned);
}

// T13f: an iframe/media rectangle alone is not proof that a real link is an ad.
{
  const t = build({ iframeRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  const a = makeEl({ tag: 'a', href: 'https://adult-lander.com/a', attrs: { href: 'https://adult-lander.com/a' }, rect: { left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 } });
  const ev = t.userClick(a, 300, 300);
  check('T13f ordinary link over iframe player stays native', ev.defaultPrevented === false, ev);
}

// T13g: Playmogo's timeline layer uses an ordinary same-tab link, then opens
// the advert from its click handler. Stop that handler and retain the seek.
{
  const video = makeEl({ tag: 'video', duration: 600, rect: { left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 } });
  const slider = makeEl({ attrs: { role: 'slider' }, rect: { left: 100, top: 440, width: 600, height: 20, right: 700, bottom: 460 } });
  const a = makeEl({ tag: 'a', href: 'https://dadgah.org/4/52106d0b?sub3=invoke_layer', attrs: { href: 'https://dadgah.org/4/52106d0b?sub3=invoke_layer' } });
  const t = build({ elementStack: [a, slider, video] });
  const ev = t.userClick(a, 400, 450);
  check('T13g timeline advertising layer is cancelled before its click handler runs',
    ev.defaultPrevented && ev.immediatePropagationStopped && a.style['pointer-events'] === 'none', ev);
  check('T13g the same timeline press still seeks the underlying video', video.currentTime === 300, video.currentTime);
}

// T13h-T13p: Playmogo's player, measured live (2026-10-08). Monetag's "invoke layer" is a
// position:fixed, inset:0, z-index 2147483647, opacity 0.01 box holding one target=_blank link to
// the ad; beside it sit an empty 120x120 square over the big play button and a hidden
// full-frame box. Every press on the player landed on one of them instead of the control.
const FULL = { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 };
const VIDEO_RECT = { left: 0, top: 0, width: 1000, height: 560, right: 1000, bottom: 560 };
function invokeLayer(href) {
  const link = makeEl({ tag: 'a', href, attrs: { href, target: '_blank' }, target: '_blank', rect: FULL });
  const cover = makeEl({ id: 'khz2y9w', style: { position: 'fixed', zIndex: '2147483647', opacity: '0.01' }, rect: FULL, children: [link] });
  link.parent = cover;
  link.parentElement = cover;
  return { link, cover };
}
const MONETAG = 'https://dadgah.org/4/52106d0b?refer=https%3A%2F%2Fplaymogo.com%2Fd%2F7qftyd95nnrj&sub3=invoke_layer';
{
  const { link, cover } = invokeLayer(MONETAG);
  const square = makeEl({ style: { position: 'fixed', zIndex: '2147483647' }, rect: { left: 440, top: 220, width: 120, height: 120, right: 560, bottom: 340 } });
  const t = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [cover, square] });
  check('T13h the invisible ad layer is made click-through before anyone presses it',
    cover.style['pointer-events'] === 'none' && link.style['pointer-events'] === 'none', cover.style);
  check('T13h it is reported once, silently, as a blocked popup',
    t.state.emits.some((e) => e.type === 'blocked_popup' && e.detail.kind === 'click-layer' && e.detail.silent === true), t.state.emits);
  check('T13h the empty square over the play button goes with it once the layer is confirmed',
    square.style['pointer-events'] === 'none', square.style);
}
{
  /* A trap that arrived before the layer is caught by the follow-up sweep. */
  const { cover } = invokeLayer(MONETAG);
  const hidden = makeEl({ style: { position: 'fixed', zIndex: '9999999' }, rect: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 } });
  const t = build({ framed: true, timers: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [hidden, cover] });
  check('T13i a trap seen before the layer is not judged on its own', hidden.style['pointer-events'] !== 'none', hidden.style);
  t.runTimers();
  check('T13i the follow-up sweep disarms it once the layer has shown what the page is',
    hidden.style['pointer-events'] === 'none' && cover.style['pointer-events'] === 'none', hidden.style);
}
{
  /* Without a confirmed layer an empty max-z box is left alone: on its own the shape proves little. */
  const square = makeEl({ style: { position: 'fixed', zIndex: '2147483647' }, rect: { left: 440, top: 220, width: 120, height: 120, right: 560, bottom: 340 } });
  build({ framed: true, timers: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [square] });
  check('T13j an empty box with no ad layer beside it stays as the page drew it', square.style['pointer-events'] !== 'none', square.style);
}
{
  /* A visible link, a same-site layer, and a page with no player are not this shape. */
  const visible = makeEl({ tag: 'a', href: MONETAG, attrs: { href: MONETAG }, rect: FULL });
  const box = makeEl({ style: { position: 'fixed', zIndex: '2147483647', opacity: '1' }, rect: FULL, children: [visible] });
  visible.parent = box; visible.parentElement = box;
  const same = invokeLayer('https://playmogo.com/d/other');
  const t = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [box, same.cover] });
  check('T13k a visible cross-site banner and a same-site layer are left alone',
    box.style['pointer-events'] !== 'none' && same.cover.style['pointer-events'] !== 'none', [box.style, same.cover.style]);
  const off = invokeLayer(MONETAG);
  build({ framed: true, hostname: 'example-news.com', bodyChildren: [off.cover] });
  check('T13k a page with no player is not touched', off.cover.style['pointer-events'] !== 'none', off.cover.style);
  const strictOff = invokeLayer(MONETAG);
  build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [strictOff.cover], config: { strictPopupShield: false } });
  check('T13k it follows the strict ad-popup shield switch', strictOff.cover.style['pointer-events'] !== 'none', strictOff.cover.style);
}
{
  /* The press-time path: disarming only the link left its box catching the next press. */
  const video = makeEl({ tag: 'video', duration: 600, rect: VIDEO_RECT });
  const slider = makeEl({ attrs: { role: 'slider' }, rect: { left: 0, top: 520, width: 1000, height: 20, right: 1000, bottom: 540 } });
  const { link, cover } = invokeLayer(MONETAG);
  const t = build({ hostname: 'playmogo.com', elementStack: [link, cover, slider, video], deferConfig: true });
  t.handshake();
  const ev = t.userClick(link, 250, 530);
  check('T13l a pressed ad link disarms its transparent box as well as itself',
    ev.defaultPrevented && link.style['pointer-events'] === 'none' && cover.style['pointer-events'] === 'none', cover.style);
  check('T13l and the press still seeks', video.currentTime === 150, video.currentTime);
}
{
  /* A press on the layer over the timeline is answered with the seek it was meant to be. */
  const video = makeEl({ tag: 'video', duration: 1200, rect: VIDEO_RECT });
  const player = makeEl({ className: 'video-js', rect: VIDEO_RECT });
  const holder = makeEl({ className: 'vjs-progress-holder vjs-slider', attrs: { role: 'slider' }, parent: player, rect: { left: 100, top: 520, width: 800, height: 12, right: 900, bottom: 532 } });
  const played = makeEl({ className: 'vjs-play-progress', parent: holder, rect: holder.rect });
  const { link, cover } = invokeLayer(MONETAG);
  const t = build({ hostname: 'playmogo.com', videoRects: [VIDEO_RECT], elementStack: [link, cover, played, holder, video] });
  const ev = t.fire('pointerdown', { target: link, clientX: 700, clientY: 526 });
  check('T13m the layered press is stopped before the ad script sees it', ev.defaultPrevented && ev.immediatePropagationStopped, ev);
  check('T13m and becomes a seek to that point of the timeline', video.currentTime === 900, video.currentTime);
  check('T13m the box is click-through for every press after it', cover.style['pointer-events'] === 'none', cover.style);
}
{
  /* The volume bar is a slider too; a press there is not a seek. */
  const video = makeEl({ tag: 'video', duration: 600, currentTime: 42, rect: VIDEO_RECT });
  const volume = makeEl({ className: 'vjs-volume-bar vjs-slider-bar vjs-slider', attrs: { role: 'slider', 'aria-label': 'Volume Level' }, rect: { left: 100, top: 520, width: 80, height: 12, right: 180, bottom: 532 } });
  const { link, cover } = invokeLayer(MONETAG);
  const t = build({ hostname: 'playmogo.com', elementStack: [link, cover, volume, video] });
  t.userClick(link, 150, 526);
  check('T13n a press on the volume bar under the layer does not move the video', video.currentTime === 42, video.currentTime);
}
{
  /* The player frame replaced by an advert: a press on the video, then the frame's own script
     sends the frame to another site (dd.gillyspencie.com -> newsboydurance.cfd on Playmogo). */
  const HOP = 'https://newsboydurance.cfd/iHLdjudwSFBYBrucp/70849/?scontext_r=Gi&nrb=1&param_3=nortb_fallback';
  const t = build({ framed: true, fakeClock: true, hostname: 'playmogo.com', pathname: '/e/7qftyd95nnrj', videoRects: [VIDEO_RECT] });
  check('T13o the guard listens for navigations of a child frame', t.navListeners.length === 1, t.navListeners.length);
  t.userClick(t.videos[0], 500, 280);
  t.advanceTime(800);
  const ev = t.navigate(HOP);
  check('T13o a script sending the player frame to another site after a press on the video is cancelled', ev.defaultPrevented === true, ev);
  check('T13o it is recorded as a silent forced-redirect block',
    t.state.emits.some((e) => e.type === 'blocked_gestureless_nav' && e.detail.kind === 'frame' && e.detail.silent === true), t.state.emits);
  check('T13o replace() is the same navigation', t.navigate(HOP, { navigationType: 'replace' }).defaultPrevented === true);
  check('T13o the player frame may still move within its own site', t.navigate('https://playmogo.com/e/other').defaultPrevented === false);
  check('T13o and to a trusted sign-in host', t.navigate('https://accounts.google.com/signin').defaultPrevented === false);
  check('T13o a reload or back/forward is never touched',
    t.navigate(HOP, { navigationType: 'reload' }).defaultPrevented === false
      && t.navigate(HOP, { navigationType: 'traverse' }).defaultPrevented === false);
  check('T13o a navigation the browser will not let anyone cancel is left alone', t.navigate(HOP, { cancelable: false }).defaultPrevented === false);
  t.advanceTime(6500);
  check('T13o long after the press, a frame moving itself is an embed switching mirror, not this', t.navigate(HOP).defaultPrevented === false);
}
{
  /* Before the full config. Measured on a slow runner: a press on the player a moment after the
     frame loaded was counted as one, and the frame's own script still sent it to the advert half
     a second later -- the guard was waiting for the full config. The popup switches the bridge
     sends first decide until it arrives, as they do for the popup guards. */
  const HOP = 'https://newsboydurance.cfd/iHLdjudwSFBYBrucp/70849/';
  const boot = { enabled: true, blockForcedPopups: true, strictPopupShield: true, blockPopupTricks: true, allowlist: [] };
  const frame = (bootstrap, forged) => {
    const t = build({ framed: true, fakeClock: true, deferConfig: true, hostname: 'playmogo.com', pathname: '/e/7qftyd95nnrj', videoRects: [VIDEO_RECT] });
    if (bootstrap && forged) t.forgeBootstrap(bootstrap);
    else if (bootstrap) t.sendBootstrap(bootstrap);
    t.userClick(t.videos[0], 500, 280);
    t.advanceTime(500);
    return t;
  };
  const early = frame(boot);
  check('T13r a frame hijack right after load is cancelled on the switches the bridge sends first',
    early.navigate(HOP).defaultPrevented === true);
  check('T13r with nothing from the bridge yet, the frame still fails open', frame(null).navigate(HOP).defaultPrevented === false);
  check('T13r the popup-tricks switch turned off is honoured before the full config',
    frame(Object.assign({}, boot, { blockPopupTricks: false })).navigate(HOP).defaultPrevented === false);
  check('T13r a bootstrap that does not carry the switch does not arm the guard',
    frame({ enabled: true, blockForcedPopups: true, strictPopupShield: true, allowlist: [] }).navigate(HOP).defaultPrevented === false);
  check('T13r an allowed site is left alone before the full config',
    frame(Object.assign({}, boot, { allowlist: ['playmogo.com'] })).navigate(HOP).defaultPrevented === false);
  check('T13r the master switch off is left alone before the full config',
    frame(Object.assign({}, boot, { enabled: false })).navigate(HOP).defaultPrevented === false);
  check('T13r a bootstrap the page forged does not arm the guard', frame(boot, true).navigate(HOP).defaultPrevented === false);
  early.handshake({ blockPopupTricks: false });
  check('T13r the full config replaces the bootstrap', early.navigate(HOP).defaultPrevented === false);
}
{
  const HOP = 'https://deforcejackmen.qpon/lp/PyGaSbyv2lFDFbqG';
  /* No press at all: a redirect an embed does on its own (mirror, region, expiry) is not judged here. */
  const quiet = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  check('T13p a player frame moving itself with no press in it fails open', quiet.navigate(HOP).defaultPrevented === false);
  /* A press beside the video (a server list under the player) is the reader choosing, not the trap. */
  const beside = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  beside.userClick(makeEl({ tag: 'button' }), 500, 700);
  check('T13p a press outside the video does not arm the guard', beside.navigate(HOP).defaultPrevented === false);
  /* A visible link in the player that names where it goes. */
  const linked = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  const visible = makeEl({ tag: 'a', href: 'https://mirror-host.example/e/7qftyd95nnrj', attrs: { href: 'https://mirror-host.example/e/7qftyd95nnrj' }, rect: { left: 10, top: 10, width: 200, height: 40, right: 210, bottom: 50 } });
  linked.userClick(visible, 50, 30);
  check('T13p a real press on a visible link over the video still goes where it says',
    linked.navigate('https://mirror-host.example/e/7qftyd95nnrj', { userInitiated: true, sourceElement: visible }).defaultPrevented === false);
  check('T13p but that press cannot carry a script to a different site',
    linked.navigate(HOP, { userInitiated: false }).defaultPrevented === true);
  /* The top frame, a page with no player, and the switch. */
  const top = build({ hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  top.userClick(top.videos[0], 500, 280);
  check('T13p the child-frame guard never judges the top frame\'s own navigations',
    top.navListeners.length === 1 && top.navigate(HOP).defaultPrevented === false, top.navListeners.length);
  const noPlayer = build({ framed: true, hostname: 'example-news.com' });
  noPlayer.userClick(makeEl({}), 500, 280);
  check('T13p a frame with no player is not judged', noPlayer.navigate(HOP).defaultPrevented === false);
  const off = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], config: { blockPopupTricks: false } });
  off.userClick(off.videos[0], 500, 280);
  check('T13p it follows "Block popup and redirect tricks"', off.navigate(HOP).defaultPrevented === false);
  const yt = build({ framed: true, hostname: 'www.youtube.com', pathname: '/embed/abc', videoRects: [VIDEO_RECT] });
  check('T13p media apps are not wired in at all', yt.navListeners.length === 0, yt.navListeners.length);
  const old = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], navigationApi: false });
  old.userClick(old.videos[0], 500, 280);
  check('T13p a browser without the Navigation API keeps every other guard', old.navListeners.length === 0 && typeof old.open === 'function');
}
{
  /* Once a layer has been confirmed, a press on the player carries the beacon the worker uses to
     close the blank popunder the page then opens (it used to ride the press on the layer). */
  const { cover } = invokeLayer(MONETAG);
  const t = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [cover] });
  t.userClick(t.videos[0], 500, 280);
  check('T13q a press on the player of a confirmed ad page reports the overlay beacon',
    t.state.navSignals.some((s) => s.kind === 'popup-overlay'), t.state.navSignals);
  const clean = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  clean.userClick(clean.videos[0], 500, 280);
  check('T13q an ordinary player page does not', !clean.state.navSignals.some((s) => s.kind === 'popup-overlay'), clean.state.navSignals);
}

{
  /* The interstitial shell on <html> whose advert never arrived: fixed, inset 0, z-index
     2147483647, holding only empty boxes and a <style>. Over the player iframe it took every press. */
  const IFRAME_RECT = { left: 65, top: 32, width: 1110, height: 624, right: 1175, bottom: 656 };
  const shellOf = (style, kidsText) => {
    const inner = makeEl({ className: 'notranslate', childNodes: kidsText ? [{ nodeType: 3, nodeValue: kidsText }] : [] });
    const box = makeEl({ className: 'D1BnW', children: [inner] });
    inner.parent = inner.parentElement = box;
    const sheet = makeEl({ tag: 'style', childNodes: [{ nodeType: 3, nodeValue: '.D1BnW { position: relative }' }] });
    const shell = makeEl({ attrs: { 'data-shb': '1', dir: 'ltr' }, style: Object.assign({ position: 'fixed', zIndex: '2147483647' }, style || {}), rect: FULL, children: [box, sheet] });
    box.parent = box.parentElement = shell;
    sheet.parent = sheet.parentElement = shell;
    return shell;
  };
  const shell = shellOf();
  const t = build({ hostname: 'playmogo.com', iframeRects: [IFRAME_RECT], htmlChildren: [shell], mutationObserver: true });
  check('T13w an empty full-screen shell over the player frame is made click-through on its shape alone',
    shell.style['pointer-events'] === 'none', shell.style);
  const painted = shellOf({ backgroundColor: 'rgba(0, 0, 0, 0.5)' });
  const low = shellOf({ zIndex: '1300' });
  const worded = shellOf(null, 'Sign in to keep watching');
  build({ hostname: 'playmogo.com', iframeRects: [IFRAME_RECT], htmlChildren: [painted, low, worded] });
  check('T13w a dimmed backdrop, a framework-level one and one that says something are left alone',
    [painted, low, worded].every((s) => s.style['pointer-events'] !== 'none'), [painted.style, low.style, worded.style]);
  const nothingToCover = shellOf();
  build({ hostname: 'example-news.com', htmlChildren: [nothingToCover] });
  check('T13w with no player under it, an empty box is the page\'s own business', nothingToCover.style['pointer-events'] !== 'none');
  /* An app that mounts into a full-screen root gets its presses back once it has content. */
  shell.children[0].children[0].childNodes.push({ nodeType: 3, nodeValue: 'Now showing' });
  t.mutate(shell);
  check('T13w the moment the shell holds something, it is given its presses back',
    shell.style['pointer-events'] === undefined && shell.attrs['data-wardenone-blocked-popup-overlay'] === undefined, shell.style);
}
{
  /* A neutralized layer the ad script hands its presses back, on the same DOM node. Remembering
     the node as done skipped it from then on, so the next press landed on the advert again. */
  const { link, cover } = invokeLayer(MONETAG);
  const t = build({ framed: true, fakeClock: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [cover], mutationObserver: true });
  const neutral = (el) => el.style['pointer-events'] === 'none' && el.style.getPropertyPriority('pointer-events') === 'important';
  check('T13z the layer starts neutralized', neutral(cover) && neutral(link), cover.style);
  cover.style['pointer-events'] = 'auto';
  t.mutate(cover);
  check('T13z style.pointerEvents = "auto" on the same node is undone', neutral(cover), cover.style);
  link.style['pointer-events'] = 'auto';
  t.mutate(cover);
  check('T13z and so is re-arming the link inside it', neutral(link), link.style);
  delete cover.style['pointer-events'];
  t.mutate(cover);
  check('T13z and a cssText rewrite that drops the declaration', neutral(cover), cover.style);
  check('T13z the layer coming back is reported once, not each time',
    t.state.emits.filter((e) => e.type === 'blocked_popup' && e.detail.kind === 'click-layer').length === 1, t.state.emits);
  for (let i = 0; i < 25; i++) { cover.style['pointer-events'] = 'auto'; t.mutate(cover); }
  check('T13z a page that fights back in a tight loop is left to the press-time guards, not fought forever',
    cover.style['pointer-events'] === 'auto', cover.style);
  t.advanceTime(5000);
  t.handshake();
  check('T13z a later look at the page takes the node up again', neutral(cover), cover.style);
}
{
  /* Without an observer to see the style change, the next look at the page judges the node on its
     actual state rather than on having been seen before. */
  const { link, cover } = invokeLayer(MONETAG);
  const t = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [cover] });
  cover.style['pointer-events'] = 'auto';
  link.style['pointer-events'] = 'auto';
  t.handshake();
  check('T13z a re-armed node is neutralized again when it is looked at again',
    cover.style['pointer-events'] === 'none' && link.style['pointer-events'] === 'none', [cover.style, link.style]);
}
{
  /* The site's own controls over the video. A visible "Switch server" button that moves the
     player with location.assign is the reader's choice; the hijack it resembles is not. */
  const SERVER2 = 'https://another-video-server.example/embed/123';
  const HOP = 'https://newsboydurance.cfd/iXnuzrgAKPULKgXUy/70849/';
  const button = (props) => makeEl(Object.assign({ tag: 'button', rect: { left: 860, top: 12, width: 120, height: 32, right: 980, bottom: 44 } }, props));
  const pressAndClick = (t, el, during) => {
    t.fire('pointerdown', { target: el, clientX: 900, clientY: 28 });
    let navigated = null;
    if (during) t.sandbox.addEventListener('click', () => { navigated = navigated || t.navigate(during); });
    t.fire('click', { target: el, clientX: 900, clientY: 28 });
    return navigated;
  };
  const switchServer = button({ text: 'Switch server' });
  const t = build({ framed: true, timers: true, fakeClock: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  const ev = pressAndClick(t, switchServer, SERVER2);
  check('T13y a visible server switch over the video may move the player from its own click', ev && ev.defaultPrevented === false, ev);
  check('T13y and that press is not published as a press on the video', vm.runInContext('window.__wardenOnePlayerPressAt', t.sandbox) === 0);
  t.runTimers();
  t.advanceTime(400);
  check('T13y a timer that sends the player elsewhere after it is still stopped', t.navigate(HOP).defaultPrevented === true);

  const named = button({ text: 'Server 2', attrs: { 'data-link': SERVER2 } });
  const tn = build({ framed: true, timers: true, fakeClock: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  pressAndClick(tn, named);
  tn.runTimers();
  tn.advanceTime(700);
  check('T13y a control that names its destination may be followed there a moment later', tn.navigate(SERVER2).defaultPrevented === false);
  check('T13y but not anywhere else', tn.navigate(HOP).defaultPrevented === true);

  for (const [label, el] of [
    ['the player\'s own play button', button({ className: 'vjs-big-play-button', text: 'Play Video', attrs: { title: 'Play Video' } })],
    ['a control whose label is a media action', button({ text: 'Mute' })],
    ['a bare bait word', button({ text: 'Continue' })],
    ['an icon-only control', button({ text: '' })],
    ['a control too small to see', button({ text: 'Switch server', rect: { left: 900, top: 20, width: 4, height: 4, right: 904, bottom: 24 } })],
  ]) {
    const tb = build({ framed: true, timers: true, fakeClock: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
    check('T13y ' + label + ' grants nothing: the player frame is still not sent away', pressAndClick(tb, el, HOP).defaultPrevented === true);
  }
  const ghost = button({ text: 'Switch server' });
  const veil = makeEl({ style: { opacity: '0.01' }, children: [ghost] });
  ghost.parent = ghost.parentElement = veil;
  const tg = build({ framed: true, timers: true, fakeClock: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  check('T13y nor does one the reader could not see', pressAndClick(tg, ghost, HOP).defaultPrevented === true);
}
{
  /* The player frame publishes when the video was pressed, read-only, for the top frame. */
  const t = build({ framed: true, fakeClock: true, now: 5000000, hostname: 'playmogo.com', videoRects: [VIDEO_RECT] });
  const read = () => vm.runInContext('window.__wardenOnePlayerPressAt', t.sandbox);
  check('T13u nothing is published before a press', read() === 0, read());
  t.userClick(t.videos[0], 500, 280);
  check('T13u a press on the video is published', read() === 5000000, read());
  vm.runInContext('try { window.__wardenOnePlayerPressAt = 1; } catch (e) {} try { Object.defineProperty(window, "__wardenOnePlayerPressAt", { value: 1 }); } catch (e) {}', t.sandbox);
  check('T13u and the page cannot rewrite it', read() === 5000000, read());
  t.userClick(makeEl({ tag: 'button' }), 500, 700);
  check('T13u a press beside the video does not move it', read() === 5000000, read());
}
{
  /* The press the page took: on some loads the same network's scripts in the page laid a box over
     the player frame, the press landed in the page, and the page sent the player frame away. */
  const HOP = 'https://newsboydurance.cfd/ilJqwqXxBqPOXyrOWWzAzor/70849/?scontext_r=G';
  const NOW = 7000000;
  const page = build({ fakeClock: true, now: NOW, hostname: 'playmogo.com', iframeRects: [{ left: 65, top: 32, width: 1110, height: 624, right: 1175, bottom: 656 }] });
  page.userClick(makeEl({}), 600, 340);
  check('T13x a press the page took over its player frame is published by the page',
    vm.runInContext('window.__wardenOnePlayerPressAt', page.sandbox) === NOW);
  page.userClick(makeEl({ tag: 'button' }), 600, 720);
  check('T13x a press beside the player frame is not', vm.runInContext('window.__wardenOnePlayerPressAt', page.sandbox) === NOW);
  const child = (parentAt, extra) => build(Object.assign({ framed: true, fakeClock: true, now: NOW, hostname: 'playmogo.com', pathname: '/e/7qftyd95nnrj',
    videoRects: [VIDEO_RECT], parentFrame: { __wardenOnePlayerPressAt: parentAt } }, extra || {}));
  check('T13x the player frame treats that press as its own and refuses to be sent away', child(NOW - 900).navigate(HOP).defaultPrevented === true);
  check('T13x a press long ago in the page does not count', child(NOW - 9000).navigate(HOP).defaultPrevented === false);
  check('T13x nor does a page that never pressed anything', child(0).navigate(HOP).defaultPrevented === false);
  const crossOriginParent = build({ framed: true, fakeClock: true, now: NOW, hostname: 'playmogo.com', videoRects: [VIDEO_RECT],
    parentFrame: Object.defineProperty({}, '__wardenOnePlayerPressAt', { get() { throw new Error('SecurityError'); } }) });
  check('T13x a cross-origin parent, which cannot be read, arms nothing', crossOriginParent.navigate(HOP).defaultPrevented === false);
}
{
  /* The top frame: an ad SDK in a same-origin player frame (tsyndicate engine.js on Playmogo)
     answers the press on play by sending the whole tab to an ad click broker. */
  const BROKER = 'https://tsyndicate.com/api/v1/direct/ed85951b219e49ffa74b7b74a3c8089c?param3=p.js';
  const NOW = 9000000;
  const make = (pressedAgo, extra) => build(Object.assign({ fakeClock: true, now: NOW, hostname: 'playmogo.com',
    childFrames: [{ __wardenOnePlayerPressAt: pressedAgo == null ? 0 : NOW - pressedAgo }] }, extra || {}));
  const t = make(700);
  const ev = t.navigate(BROKER);
  check('T13v a script sending the whole tab away just after a press in the player frame is cancelled', ev.defaultPrevented === true, ev);
  check('T13v it is recorded silently',
    t.state.emits.some((e) => e.type === 'blocked_gestureless_nav' && e.detail.kind === 'frame-top' && e.detail.silent === true), t.state.emits);
  check('T13v a real link press in the page is still the reader\'s choice', make(700).navigate(BROKER, { userInitiated: true }).defaultPrevented === false);
  check('T13v the tab may still move within its own site', make(700).navigate('https://playmogo.com/d/other').defaultPrevented === false);
  check('T13v and to a trusted sign-in host', make(700).navigate('https://accounts.google.com/o/oauth2/auth').defaultPrevented === false);
  check('T13v with no press in any player frame, the top frame\'s navigations are untouched', make(null).navigate(BROKER).defaultPrevented === false);
  check('T13v long after the press it is untouched too', make(7000).navigate(BROKER).defaultPrevented === false);
  const pressedTop = make(700);
  pressedTop.userClick(makeEl({ tag: 'button' }), 50, 50);
  check('T13v a press in the top document leaves the decision where it was', pressedTop.navigate(BROKER).defaultPrevented === false);
  const crossOrigin = build({ fakeClock: true, now: NOW, hostname: 'playmogo.com',
    childFrames: [Object.defineProperty({}, '__wardenOnePlayerPressAt', { get() { throw new Error('SecurityError'); } })] });
  check('T13v a cross-origin frame, which cannot be read, changes nothing', crossOrigin.navigate(BROKER).defaultPrevented === false);
  check('T13v it follows "Block popup and redirect tricks"', make(700, { config: { blockPopupTricks: false } }).navigate(BROKER).defaultPrevented === false);
  check('T13v reload and back/forward are never touched',
    make(700).navigate(BROKER, { navigationType: 'reload' }).defaultPrevented === false
      && make(700).navigate(BROKER, { navigationType: 'traverse' }).defaultPrevented === false);
}
{
  /* The transparent full-frame box at z-index 300000 that took the first press of every visit
     covers the whole frame and paints nothing, so it goes on its shape. The 120x120 square over
     the play button does not prove itself that way: on a load with no link layer it is armed by
     the first popup a press on the player tried to open. */
  const box = makeEl({ style: { position: 'fixed', zIndex: '300000' }, rect: FULL });
  const square = makeEl({ style: { position: 'fixed', zIndex: '2147483647' }, rect: { left: 440, top: 220, width: 120, height: 120, right: 560, bottom: 340 } });
  const t = build({ framed: true, timers: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [box, square] });
  t.runTimers();
  check('T13r the full-frame box is made click-through as soon as it is seen', box.style['pointer-events'] === 'none', box.style);
  check('T13r the small square is not judged before the page has shown anything', square.style['pointer-events'] !== 'none', square.style);
  t.userClick(t.videos[0], 500, 280);
  t.open('https://deforcejackmen.qpon/lp/x');
  t.runTimers();
  check('T13r once a press on the player has been spent on a popup, the square goes too',
    square.style['pointer-events'] === 'none', square.style);
}
{
  /* The press itself. dd.gillyspencie.com listens at the top of the document and calls
     preventDefault and stopImmediatePropagation on every mousedown and click, so video.js
     (seek on mousedown, play on click) never heard it. Here a listener at the top of the
     document is modelled by calling the event's methods with it as currentTarget, in capture. */
  const player = makeEl({ className: 'video-js', rect: VIDEO_RECT });
  const holder = makeEl({ className: 'vjs-progress-holder', attrs: { role: 'slider' }, parent: player, rect: { left: 100, top: 520, width: 800, height: 12, right: 900, bottom: 532 } });
  const { cover } = invokeLayer(MONETAG);
  const t = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [cover] });
  const harvest = (ev) => {
    ev.eventPhase = 1;
    ev.currentTarget = t.sandbox.document;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    return ev;
  };
  const down = harvest(t.fire('mousedown', { target: holder, clientX: 500, clientY: 526 }));
  check('T13s a listener at the top of the document can no longer stop a press on the player\'s timeline',
    down.immediatePropagationStopped === false && down.defaultPrevented === false, down);
  const click = harvest(t.fire('click', { target: holder, clientX: 500, clientY: 526 }));
  check('T13s nor the click that follows it', click.immediatePropagationStopped === false && click.defaultPrevented === false, click);
  const own = t.fire('click', { target: holder, clientX: 500, clientY: 526 });
  own.eventPhase = 3;
  own.currentTarget = holder;
  own.stopImmediatePropagation();
  own.preventDefault();
  check('T13s the player\'s own handlers, down the tree, keep every power they had',
    own.immediatePropagationStopped === true && own.defaultPrevented === true, own);
  const link = makeEl({ tag: 'a', href: 'https://elsewhere.example/', attrs: { href: 'https://elsewhere.example/' }, parent: player });
  const onLink = harvest(t.fire('mousedown', { target: link, clientX: 20, clientY: 20 }));
  check('T13s a link inside the player is left to the guards that stop links on purpose', onLink.immediatePropagationStopped === true, onLink);
  const page = harvest(t.fire('mousedown', { target: makeEl({}), clientX: 500, clientY: 700 }));
  check('T13s a press outside the player is untouched', page.immediatePropagationStopped === true && page.defaultPrevented === true, page);
  const synthetic = harvest(t.fire('mousedown', { target: holder, isTrusted: false, clientX: 500, clientY: 526 }));
  check('T13s and so is a press the page made up', synthetic.immediatePropagationStopped === true, synthetic);
}
{
  /* Without any sign the page spends presses on adverts, a page keeps its listeners' powers:
     a first-party login or age gate may stop a press on purpose. */
  const player = makeEl({ className: 'video-js', rect: VIDEO_RECT });
  const button = makeEl({ tag: 'button', className: 'vjs-big-play-button', parent: player, rect: { left: 440, top: 240, width: 120, height: 80, right: 560, bottom: 320 } });
  const t = build({ framed: true, hostname: 'example-video.com', videoRects: [VIDEO_RECT] });
  const ev = t.fire('click', { target: button, clientX: 500, clientY: 280 });
  ev.eventPhase = 1;
  ev.currentTarget = t.sandbox.document;
  ev.stopImmediatePropagation();
  check('T13t an ordinary player page keeps its own capture listeners as they were', ev.immediatePropagationStopped === true, ev);
  const off = build({ framed: true, hostname: 'playmogo.com', videoRects: [VIDEO_RECT], bodyChildren: [invokeLayer(MONETAG).cover], config: { strictPopupShield: false } });
  const ev2 = off.fire('click', { target: button, clientX: 500, clientY: 280 });
  ev2.eventPhase = 1;
  ev2.currentTarget = off.sandbox.document;
  ev2.stopImmediatePropagation();
  check('T13t and it follows the strict ad-popup shield switch', ev2.immediatePropagationStopped === true, ev2);
}

// T14: same-site nav always allowed, even gestureless
{
  const t = build();
  t.assign('https://videosite.com/next-episode');
  check('T14 same-site nav allowed', t.state.assigned.length === 1, t.state);
}

// T15: gestureless cross-site redirect blocked with the right reason
{
  const t = build();
  t.assign('https://randomsite.com/lander');
  const e = t.lastEmit();
  check('T15 gestureless redirect blocked', t.state.assigned.length === 0 && !!e && e.detail.why === 'no recent user gesture', e);
}

// T16: synthetic click on a cross-site download link is allowed
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://cdn.somefilehost.com/file.bin', attrs: { href: 'https://cdn.somefilehost.com/file.bin', download: '' } });
  const ev = t.fire('click', { target: a, isTrusted: false });
  check('T16 synthetic download anchor allowed', ev.defaultPrevented === false, ev);
}

// T17: hostile-page latch — after one blocked hijack, gesture popups are gone
{
  const t = build();
  t.open('https://ads1-example.com/x'); // gestureless -> blocked, page marked hostile
  const div = makeEl({});
  t.userClick(div, 50, 50);
  t.open('https://randomapp.com/dash');
  check('T17 hostile page loses the gesture-popup allowance', t.state.opened.length === 0, t.state.opened);
}

// T18: normal same-tab top-frame form submit untouched
{
  const t = build();
  const form = makeEl({ tag: 'form', attrs: { action: 'https://searchpartner.com/q' }, action: 'https://searchpartner.com/q' });
  const ev = t.fire('submit', { target: form });
  check('T18 same-tab top-frame form submit allowed', ev.defaultPrevented === false, ev);
}

// T19: keyboard activation (Enter on a focused link) works as explicit intent
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://dest.com/page', attrs: { href: 'https://dest.com/page' } });
  t.sandbox.document.activeElement = a;
  t.fire('keydown', { key: 'Enter', target: a });
  t.assign('https://dest.com/other');
  check('T19 Enter on link allows matching-site nav', t.state.assigned.length === 1, t.state);
}

// T20: suspicious target from a plain gesture is blocked silently
{
  const t = build();
  const div = makeEl({});
  t.userClick(div, 50, 50);
  t.setHref('https://tracker.popads.net/go');
  const e = t.lastEmit();
  check('T20 flagged ad-network target blocked silently', t.state.hrefSets.length === 0 && !!e && e.detail.silent === true, e);
}

// T21: a generic gesture cannot reserve a navigable blank popup.
{
  const t = build();
  const btn = makeEl({ tag: 'button', text: 'Yes, please' });
  t.userClick(btn, 50, 50);
  const pop = t.open('about:blank');
  check('T21 non-auth blank popup is contained by an inert facade', t.state.opened.length === 0 && pop && pop.closed === true && pop.document && typeof pop.document.write === 'function', t.state);
}

// T22: native target=_blank is likewise allowed under the fresh gesture
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'about:blank', attrs: { href: 'about:blank', target: '_blank' }, target: '_blank', text: 'Resume video' });
  const ev = t.userClick(a, 50, 50);
  check('T22 blank target popup link not cancelled', ev.defaultPrevented === false, ev);
}

// T23: login-labeled blank popup still works for OAuth-style flows
{
  const t = build();
  const btn = makeEl({ tag: 'button', text: 'Sign in' });
  t.userClick(btn, 50, 50);
  const pop = t.open('about:blank');
  check('T23 login-labeled about:blank returns real handle', t.state.opened.length === 1 && pop === t.state.handles[0], t.state.opened);
}

// T24: an auth-labelled staged popup remains the real handle when the SDK navigates it
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://gamedrive.org/game', attrs: { href: 'https://gamedrive.org/game' }, text: 'Sign in with GameDrive' });
  t.userClick(a, 50, 50);
  const pop = t.open('about:blank');
  pop.location.href = 'https://gamedrive.org/game';
  check('T24 staged popup navigates through real handle', t.state.opened.length === 1 && t.state.opened[0] === 'about:blank' && pop.location.href === 'https://gamedrive.org/game', t.state);
}

// T25: a generic staged popup cannot navigate its inert handle to an ad.
{
  const t = build();
  const a = makeEl({ tag: 'a', href: 'https://gamedrive.org/game', attrs: { href: 'https://gamedrive.org/game' }, text: 'Open GameDrive' });
  t.userClick(a, 50, 50);
  const pop = t.open('about:blank');
  pop.location.href = 'https://adnetwork-lander.com/pop';
  check('T25 generic blank popup cannot be navigated to an ad', t.state.opened.length === 0 && pop && pop.closed === true && String(pop.location.href) === 'about:blank', t.state);
}

// T26: a generic button does not receive OAuth/SSO blank-window compatibility
{
  const t = build();
  const btn = makeEl({ tag: 'button', text: 'Open' });
  t.userClick(btn, 50, 50);
  const pop = t.open('about:blank');
  pop.location.assign('https://gamedrive.org/game');
  check('T26 plain-button staged blank popup stays inert', t.state.opened.length === 0 && pop && pop.closed === true && String(pop.location.href) === 'about:blank', t.state);
}

// T27: even an auth blank-window allowance remains single-use per gesture
{
  const t = build();
  const btn = makeEl({ tag: 'button', text: 'Sign in' });
  t.userClick(btn, 50, 50);
  const first = t.open('about:blank');
  const second = t.open('about:blank');
  check('T27 only one real auth blank popup per gesture', !!first && first.__nativeWindow === true && second && second.closed === true && t.state.opened.length === 1, t.state);
}

// T28: do not overwrite a page/identity SDK wrapper on the next gesture
{
  const t = build();
  const sdkOpen = function () { return 'sdk-open'; };
  const sdkAssign = function () { return 'sdk-assign'; };
  t.sandbox.open = sdkOpen;
  t.sandbox.Location.prototype.assign = sdkAssign;
  t.userClick(makeEl({ tag: 'button', text: 'Continue' }), 50, 50);
  check('T28 SDK navigation wrappers stay installed', t.sandbox.open === sdkOpen && t.sandbox.Location.prototype.assign === sdkAssign);
}

// T29: native navigation primitives stay entirely untouched on compatibility surfaces
{
  const surfaces = [
    ['drive.google.com', '/drive/my-drive'],
    ['docs.google.com', '/document/d/1/edit'],
    ['mail.google.com', '/mail/u/0/'],
    ['calendar.google.com', '/calendar/u/0/r'],
    ['classroom.google.com', '/u/0/h'],
    ['meet.google.com', '/abc-defg-hij'],
    ['chat.google.com', '/u/0/'],
    ['myaccount.google.com', '/security'],
    ['apply.ucas.com', '/account/login'],
    ['portal.example.ac.uk', '/sso'],
    ['student.example.edu', '/login'],
  ];
  const broken = surfaces.filter(([hostname, pathname]) => !build({ hostname, pathname, href: 'https://' + hostname + pathname }).nativeApisUntouched());
  check('T29 compatibility surfaces retain native APIs', broken.length === 0, broken);
}

// T30: high-confidence custom federation endpoints work without a recent gesture
{
  const t = build();
  t.assign('https://idp.customer.example/Shibboleth.sso/SAML2/Redirect/SSO');
  t.assign('https://login.partner.example/oauth2/authorize?client_id=client&redirect_uri=https%3A%2F%2Fportal.example%2Fcallback&response_type=code');
  t.assign('https://auth.customer.example/openathens/login?return=https%3A%2F%2Fportal.example%2F');
  check('T30 custom Shibboleth, OIDC and OpenAthens destinations allowed', t.state.assigned.length === 3, t.state);
}

// T31: a framed SAML browser-POST keeps native form submission semantics
{
  const t = build({ framed: true });
  const form = makeEl({ tag: 'form', action: 'https://service.example/consume', attrs: { action: 'https://service.example/consume', target: '_top' } });
  form.querySelector = (selector) => String(selector).indexOf('SAMLResponse') >= 0 ? makeEl({ tag: 'input' }) : null;
  t.submit(form);
  const ev = t.fire('submit', { target: form });
  check('T31 hidden SAML response form is not blocked', t.state.submitted.length === 1 && ev.defaultPrevented === false, { state: t.state, event: ev });
}

// T32: CAS + identity-host SSO (login./auth./sso.) redirects work gestureless
{
  const t = build();
  t.assign('https://idp.university.example/cas/login?service=https%3A%2F%2Fportal.university.example%2F');
  t.assign('https://login.company.example/oauth/authorize?next=%2Fhome');
  t.assign('https://auth.college.example/simplesaml/saml2/idp/SSOService.php?spentityid=x');
  check('T32 CAS / login-host OAuth / SimpleSAMLphp redirects allowed', t.state.assigned.length === 3, t.state);
}

// T33: widening did NOT open a generic bypass -- a plain host still needs a real
// federation shape, not just auth-ish words in the path.
{
  const t = build();
  t.assign('https://promo.example/login/continue?redirect=https%3A%2F%2Fspam.example');
  check('T33 auth words on a non-identity host stay blocked', t.state.assigned.length === 0, t.state);
}

// T34: an icon-only "sign in with X" button allows its own same-tab login redirect
{
  const t = build();
  const btn = makeEl({ tag: 'button', className: 'btn social-login-google', text: '' });
  t.userClick(btn, 50, 50);
  t.assign('https://portal.someschool.example/start/session');
  check('T34 icon-only OAuth button allows its same-tab redirect', t.state.assigned.length === 1, t.state);
}

// T35: a plain icon button (no login text/structure) does NOT
{
  const t = build();
  const btn = makeEl({ tag: 'button', className: 'btn', text: '' });
  t.userClick(btn, 50, 50);
  t.assign('https://portal.someschool.example/start/session');
  check('T35 plain icon button does not open a same-tab cross-site redirect', t.state.assigned.length === 0, t.state);
}

// T36: an existing named frame is a navigation destination, not a popup.
// Unresolved names and reserved _blank must still pass through popup blocking.
{
  const t = build({ href: 'https://videosite.com/watch/episode', pathname: '/watch/episode' });
  t.iframes.push(makeEl({ tag: 'iframe', attrs: { name: 'MediaFrame' } }));
  // Even a hostile-looking destination is legitimate when it is loaded into
  // a frame already owned by the current page.
  const named = t.open('https://embed.example/player/episode', 'MediaFrame');
  const missing = t.open('https://popads.example/embed/episode', 'MissingPlayer');
  const blank = t.open('https://popads.example/embed/episode', '_blank');
  check('T36 existing named frame stays native', !!named && named.__nativeWindow === true && t.state.opened.length === 1, t.state);
  check('T36b unresolved named target stays blocked', !!missing && !missing.__nativeWindow && t.state.opened.length === 1, t.state);
  check('T36c _blank stays blocked', !!blank && !blank.__nativeWindow && t.state.opened.length === 1, t.state);
}

// T37: native anchor navigation follows the same exact-name rule. Rel-based
// opener isolation deliberately opts out of reusing a named frame.
{
  const t = build({ href: 'https://videosite.com/watch/episode', pathname: '/watch/episode' });
  t.iframes.push(makeEl({ tag: 'iframe', attrs: { name: 'MediaFrame' } }));
  const link = (target, rel) => makeEl({
    tag: 'a',
    href: 'https://popads.example/embed/episode',
    target,
    attrs: { href: 'https://popads.example/embed/episode', target, ...(rel ? { rel } : {}) },
  });
  const named = t.userClick(link('MediaFrame'), 50, 50);
  const wrongCase = t.userClick(link('mediaframe'), 50, 50);
  const isolated = t.userClick(link('MediaFrame', 'noopener'), 50, 50);
  check('T37 existing named-frame anchor stays native', named.defaultPrevented === false, named);
  check('T37b named-frame matching remains case-sensitive', wrongCase.defaultPrevented === true, wrongCase);
  check('T37c noopener named target stays under popup scrutiny', isolated.defaultPrevented === true, isolated);
}

// T38: disabled WindowFeatures values do not isolate an existing named frame.
// Bare/true values still force the request through popup scrutiny.
{
  const t = build({ href: 'https://videosite.com/watch/episode', pathname: '/watch/episode' });
  t.iframes.push(makeEl({ tag: 'iframe', attrs: { name: 'MediaFrame' } }));
  const numericFalse = t.open('https://embed.example/player/episode', 'MediaFrame', 'width=800,noopener=0,noreferrer=false');
  const wordFalse = t.open('https://embed.example/player/episode', 'MediaFrame', 'noopener=no noreferrer=off');
  const isolated = t.open('https://embed.example/player/episode', 'MediaFrame', 'width=800,noopener=yes');
  check('T38 false-valued opener features reuse the named frame', !!numericFalse && numericFalse.__nativeWindow === true && !!wordFalse && wordFalse.__nativeWindow === true && t.state.opened.length === 2, t.state);
  check('T38b true-valued opener feature does not reuse the named frame', !!isolated && !isolated.__nativeWindow && t.state.opened.length === 2, t.state);
}

// T39: form targets use the same exact named-frame and opener-isolation rules.
{
  const t = build({ href: 'https://videosite.com/watch/episode', pathname: '/watch/episode' });
  t.iframes.push(makeEl({ tag: 'iframe', attrs: { name: 'MediaFrame' } }));
  const form = (rel) => makeEl({
    tag: 'form',
    action: 'https://popads.example/embed/episode',
    target: 'MediaFrame',
    attrs: { action: 'https://embed.example/player/episode', target: 'MediaFrame', ...(rel ? { rel } : {}) },
  });
  const nativeForm = form('');
  const falseIsolation = form('noopener=0 noreferrer=false');
  const isolated = form('noopener');
  t.submit(nativeForm);
  t.submit(falseIsolation);
  t.submit(isolated);
  const nativeEvent = t.fire('submit', { target: nativeForm });
  const isolatedEvent = t.fire('submit', { target: isolated });
  check('T39 named-frame forms without isolation remain native', t.state.submitted.length === 2 && nativeEvent.defaultPrevented === false, { state: t.state, event: nativeEvent });
  check('T39b rel-isolated named-frame form stays under navigation scrutiny', isolatedEvent.defaultPrevented === true, isolatedEvent);
}

// T40: common player signatures receive compatibility facades, while broad
// class-name fragments do not turn an ordinary document into a player page.
{
  const signatures = [
    '.video-js',
    '.jwplayer',
    '.plyr',
    '[data-plyr-provider]',
    '.shaka-video-container',
    '.dplayer',
    '.art-video-player',
    '.clappr-container',
    '#player',
    'iframe[src*="/embed/" i]',
    'iframe[src*="/player/" i]',
  ];
  let allRecognized = true;
  for (const playerSelector of signatures) {
    const t = build({ playerSelector, href: 'https://videosite.com/home', pathname: '/home' });
    const blocked = t.open('https://popads.net/landing');
    allRecognized = allRecognized && !!blocked && blocked.closed === false && t.state.opened.length === 0;
  }
  const broadFragments = ['.video-player-ad', '.dplayer-ad', '.art-video-player-shell', '.clappr-container-ad'];
  let broadRejected = true;
  for (const playerSelector of broadFragments) {
    const broad = build({ playerSelector, href: 'https://videosite.com/home', pathname: '/home' });
    const broadPopup = broad.open('https://popads.net/landing');
    broadRejected = broadRejected && !!broadPopup && broadPopup.closed === true;
  }
  check('T40 bounded common player signatures are recognized', allRecognized, signatures);
  check('T40b broad player-like class fragments are not recognized', broadRejected, broadFragments);
}

// T41: a blocked player popup looks open only for the bounded compatibility
// window, and page code cannot swap in a navigable location object.
{
  const t = build({ href: 'https://videosite.com/player/episode', pathname: '/player/episode', fakeClock: true, now: 1000 });
  const blocked = t.open('https://popads.net/landing');
  const inertLocation = blocked && blocked.location;
  const descriptor = blocked && Object.getOwnPropertyDescriptor(blocked, 'location');
  let redefineBlocked = false;
  try { Object.defineProperty(blocked, 'location', { value: { href: 'https://popads.net/retry' } }); } catch (_) { redefineBlocked = true; }
  blocked.location = { href: 'https://popads.net/second-hop' };
  blocked.location.href = 'https://popads.net/third-hop';
  check('T41 inert facade location is non-replaceable', descriptor && descriptor.configurable === false && typeof descriptor.get === 'function' && typeof descriptor.set === 'function' && redefineBlocked && blocked.location === inertLocation && blocked.location.href === 'about:blank', descriptor);
  check('T41b player facade starts open-looking', blocked.closed === false, blocked);
  t.advanceTime(1501);
  check('T41c player facade automatically closes after its grace period', blocked.closed === true, blocked);
}

// T42: the user's allowlist reaches this guard too.
//
// Every other guard honours it. This one is a separate <all_urls> content script,
// statically declared so it cannot be skipped per host at injection time, and the
// bridge hands it the raw toggles rather than the allowlist-gated ones the main
// engine computes for itself. "Allow this site" therefore left forced-popup,
// gestureless-navigation and meta-refresh blocking running there anyway.
{
  const t = build({ hostname: 'videosite.com', href: 'https://videosite.com/page', config: { allowlist: ['videosite.com'] } });
  t.open('https://ads1-example.com/x');
  check('T42 allowlisted host may open a popup without a gesture', t.state.opened.length === 1, t.state);
}

{
  const t = build({ hostname: 'sub.videosite.com', href: 'https://sub.videosite.com/page', config: { allowlist: ['videosite.com'] } });
  t.open('https://ads1-example.com/x');
  check('T42b the allowlist covers subdomains', t.state.opened.length === 1, t.state);
}

{
  const t = build({ hostname: 'www.videosite.com', href: 'https://www.videosite.com/page', config: { allowlist: ['www.videosite.com'] } });
  t.open('https://ads1-example.com/x');
  check('T42c www is normalised on both sides', t.state.opened.length === 1, t.state);
}

{
  const t = build({ hostname: 'videosite.com', href: 'https://videosite.com/page', config: { allowlist: ['othersite.com'] } });
  t.open('https://ads1-example.com/x');
  check('T42d an unrelated allowlist entry protects nothing', t.state.opened.length === 0, t.state);
}

{
  // A suffix match must be on a label boundary: notvideosite.com is not videosite.com.
  const t = build({ hostname: 'notvideosite.com', href: 'https://notvideosite.com/page', config: { allowlist: ['videosite.com'] } });
  t.open('https://ads1-example.com/x');
  check('T42e a lookalike host is not allowlisted', t.state.opened.length === 0, t.state);
}

{
  const t = build({ hostname: 'videosite.com', href: 'https://videosite.com/page', config: { allowlist: [] } });
  t.open('https://ads1-example.com/x');
  check('T42f an empty allowlist changes nothing', t.state.opened.length === 0, t.state);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

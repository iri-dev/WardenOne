/*
 * Node harness for anti-redirect.js — loads the hardener into a stub DOM (vm
 * sandbox) and drives synthetic gestures + navigation attempts through the
 * real hooks. Run: node tools/test-anti-redirect.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'anti-redirect.js'), 'utf8');

const PREDS = {
  'a[href],area[href]': (el) => (el.tagName === 'A' || el.tagName === 'AREA') && (el.attrs.href != null || el.href),
  'button,input': (el) => el.tagName === 'BUTTON' || el.tagName === 'INPUT',
  'form[action]': (el) => el.tagName === 'FORM' && el.attrs.action != null,
  'a,button,input,[role="button"],[tabindex]': (el) => ['A', 'BUTTON', 'INPUT'].indexOf(el.tagName) >= 0 || el.attrs.role === 'button' || el.attrs.tabindex != null,
  'video,audio': (el) => el.tagName === 'VIDEO' || el.tagName === 'AUDIO',
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
    style: props.style || {},
    rect: props.rect || { left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 },
    containsVideo: !!props.containsVideo,
    getAttribute(n) { return this.attrs[n] != null ? this.attrs[n] : null; },
    hasAttribute(n) { return this.attrs[n] != null; },
    getBoundingClientRect() { return this.rect; },
    querySelector(sel) { return sel === 'video' && this.containsVideo ? makeEl({ tag: 'video' }) : null; },
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
  const state = { opened: [], popupNavigations: [], handles: [], assigned: [], replaced: [], hrefSets: [], submitted: [], emits: [] };
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
  sandbox.getComputedStyle = (el) => ({ opacity: String(el && el.style && el.style.opacity != null ? el.style.opacity : '1') });
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
    activeElement: null,
    addEventListener() {},
    dispatchEvent(ev) { if (ev && ev.type === 'wo-event') state.emits.push(ev.detail); },
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

  vm.createContext(sandbox);
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
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      ev.stopImmediatePropagation = () => {};
      (listeners[type] || []).forEach((fn) => fn(ev));
      return ev;
    },
    userClick(el, x, y) {
      api.fire('pointerdown', { target: el, clientX: x, clientY: y });
      return api.fire('click', { target: el, clientX: x, clientY: y });
    },
    open(u, name, features) { return sandbox.open(u, name, features); },
    advanceTime(ms) { clockNow += Number(ms) || 0; },
    assign(u) { sandbox.Location.prototype.assign.call(loc, u); },
    setHref(u) { loc.href = u; },
    submit(form) { sandbox.HTMLFormElement.prototype.submit.call(form); },
    lastEmit() { return state.emits[state.emits.length - 1] || null; },
    handshake(config) {
      api.fire('message', { source: innerWindow, data: { source: 'wardenone-handshake', token: 'tok' } });
      if (config !== false) {
        api.fire('message', {
          source: innerWindow,
          data: {
            source: 'wardenone',
            kind: 'config',
            token: 'tok',
            overrides: Object.assign({
              enabled: true,
              blockGesturelessNav: true,
              blockForcedPopups: true,
              strictPopupShield: true,
              gestureWindowMs: 2400,
            }, config || opts.config || {}),
          },
        });
      }
    },
  };
  api.handshake();
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

// T3b: gesture on a div that OVERLAYS the video (coords inside video rect)
{
  const t = build({ videoRects: [{ left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500 }] });
  const overlay = makeEl({});
  t.userClick(overlay, 300, 300);
  t.open('https://randomapp.com/dash');
  check('T3b popup from overlay-on-video click blocked', t.state.opened.length === 0, t.state.opened);
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

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

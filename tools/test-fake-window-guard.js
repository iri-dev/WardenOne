/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Browser-in-the-Browser.
 *
 * The page draws a window inside itself -- title bar, close button, an address bar
 * reading accounts.google.com -- and puts its own sign-in form in it. No window
 * ever opens, so nothing watching window.open sees anything and the popup blocker
 * has nothing to block. It is the standard way OAuth sign-in is phished.
 *
 * The tell is a window-shaped container whose TITLE STRIP carries a domain the page
 * does not own. That is not enough on its own: online IDEs frame their preview pane
 * exactly like this and design tools draw browser mockups, so somewhere to type a
 * password has to be inside the same container. An embedded frame substitutes only
 * when the strip names a real identity provider.
 *
 * Most of this file is the second half of that: the legitimate things that look
 * similar and must come through untouched.
 *
 * Run: node tools/test-fake-window-guard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

const START = 'if(WO.fakeWindowGuard&&WO_TOP&&!trustedMediaHost&&';
const END = 'if(WO.fullscreenGuard&&WO_TOP&&!trustedMediaHost)try{';
const from = CONTENT.indexOf(START);
const to = CONTENT.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the shipped fake-window guard markers are missing');
const RAW = CONTENT.slice(from, to);
/* Rebuilt whole, header included, so the host exclusions and the toggle are the
   real ones. Running only the body would quietly pass every exemption test. */
const GUARD = RAW.replace(/\s*$/, '');

const VIEWPORT = { width: 1440, height: 900 };
const WINDOW_BOX = { top: 120, bottom: 620, left: 300, right: 1140, width: 840, height: 500 };

function node(options) {
  const o = options || {};
  const self = {
    tagName: String(o.tag || 'div').toUpperCase(),
    firstChild: null,
    _rect: o.rect || WINDOW_BOX,
    _kids: o.kids || [],
    _password: !!o.password,
    _iframe: !!o.iframe,
    getBoundingClientRect() { return this._rect; },
    querySelectorAll() { return this._kids; },
    querySelector(selector) {
      const want = String(selector);
      if (/password/.test(want)) return this._password ? { tagName: 'INPUT' } : null;
      if (/iframe/.test(want)) return this._iframe ? { tagName: 'IFRAME' } : null;
      return null;
    },
  };
  if (o.text) self.firstChild = { nodeType: 3, nodeValue: o.text, nextSibling: null };
  return self;
}

/* A strip inside the container's top 72px, where a window's title bar lives. */
function titleStrip(text) {
  return node({ text, rect: { top: 128, bottom: 160, left: 300, right: 1140, width: 840, height: 32 } });
}
function bodyStrip(text) {
  return node({ text, rect: { top: 300, bottom: 332, left: 300, right: 1140, width: 840, height: 32 } });
}

function run(options) {
  const o = options || {};
  const logs = [];
  const appended = [];
  const timers = [];
  const container = node({
    rect: o.containerRect || WINDOW_BOX,
    kids: o.kids || [],
    password: o.password,
    iframe: o.iframe,
  });
  const body = {
    appendChild(child) { appended.push(child); return child; },
    querySelectorAll() { return o.containers === undefined ? [container] : o.containers; },
    querySelector() { return null; },
  };
  const sandbox = {
    WO: { fakeWindowGuard: o.enabled !== false },
    WO_TOP: true,
    trustedMediaHost: !!o.trustedMediaHost,
    regDomain: (h) => String(h || '').replace(/^www\./, '').toLowerCase().split('.').slice(-2).join('.'),
    location: { hostname: o.hostname || 'deals-login.example' },
    window: { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height },
    getComputedStyle: () => ({ position: o.position || 'fixed' }),
    document: {
      body,
      documentElement: body,
      createElement: () => {
        const el = node({});
        el.setAttribute = () => {};
        el.addEventListener = () => {};
        el.appendChild = (child) => child;
        el.remove = () => {};
        return el;
      },
    },
    __woWarn: { seen: new Map(), up() { return false; }, mark() {} },
    log(type, detail) { logs.push({ type, detail }); },
    woOn() {},
    __woObserver: () => ({ observe() {}, disconnect() {} }),
    setTimeout(fn) { timers.push(fn); return timers.length; },
    Set, Map, Math, String, Number, Object, Array, RegExp, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'fake-window-guard-slice.js' });
  while (timers.length) {
    const fn = timers.shift();
    if (typeof fn === 'function') fn();
  }
  return { logs, appended };
}

let passed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// The attack
// ---------------------------------------------------------------------------
{
  const r = run({
    kids: [titleStrip('×  \u{1F512} https://accounts.google.com')],
    password: true,
  });
  check('a drawn window with a Google address bar and a password field is caught',
    r.logs.length === 1, r.logs);
  if (r.logs.length) {
    const d = r.logs[0].detail;
    check('it names the provider the window claimed to be', d.shown === 'accounts.google.com', d);
    check('it does not claim to have removed anything', /Warned only/.test(d.outcome), d.outcome);
    check('it explains that no window actually opened', /no window opened/i.test(d.why), d.why);
    check('it tells you what to do instead', /new tab/i.test(d.action), d.action);
    check('it puts a warning on the page', r.appended.length === 1);
  }
}

{
  const r = run({
    kids: [titleStrip('✕ − □   login.microsoftonline.com')],
    password: true,
  });
  check('minimise and maximise glyphs count as window controls', r.logs.length === 1, r.logs);
}

{
  const r = run({
    kids: [titleStrip('×  appleid.apple.com')],
    password: false,
    iframe: true,
  });
  check('an identity provider around an embedded frame counts without a password field',
    r.logs.length === 1, r.logs);
}

// ---------------------------------------------------------------------------
// Things that look similar and must come through untouched
// ---------------------------------------------------------------------------
{
  const r = run({ kids: [titleStrip('×  Sign in to continue')], password: true });
  check('an ordinary login modal with a close button is not a fake window',
    r.logs.length === 0, r.logs);
}

{
  const r = run({
    hostname: 'shop.example',
    kids: [titleStrip('×  shop.example')],
    password: true,
  });
  check("a modal showing the page's OWN domain is not spoofing", r.logs.length === 0, r.logs);
}

{
  const r = run({ kids: [titleStrip('accounts.google.com')], password: true });
  check('a domain with no window controls is not a drawn window', r.logs.length === 0, r.logs);
}

{
  const r = run({ kids: [titleStrip('×  accounts.google.com')], password: false, iframe: false });
  check('window controls and a domain with nowhere to type are not enough',
    r.logs.length === 0, r.logs);
}

{
  const r = run({
    kids: [titleStrip('×  preview.example.com')],
    password: false,
    iframe: true,
  });
  check('a framed preview that is not an identity provider is left alone',
    r.logs.length === 0, r.logs,
    'this is the shape every online IDE renders');
}

{
  const r = run({ kids: [bodyStrip('×  \u{1F512} accounts.google.com')], password: true });
  check('a domain in the body rather than the title strip is not an address bar',
    r.logs.length === 0, r.logs);
}

{
  const r = run({
    containerRect: { top: 0, bottom: 890, left: 0, right: 1430, width: 1430, height: 890 },
    kids: [titleStrip('×  \u{1F512} accounts.google.com')],
    password: true,
  });
  check('a container the size of the page is the page, not a window', r.logs.length === 0, r.logs);
}

{
  const r = run({
    containerRect: { top: 120, bottom: 240, left: 300, right: 500, width: 200, height: 120 },
    kids: [titleStrip('×  \u{1F512} accounts.google.com')],
    password: true,
  });
  check('something too small to be a sign-in window is ignored', r.logs.length === 0, r.logs);
}

{
  const r = run({
    position: 'static',
    kids: [titleStrip('×  \u{1F512} accounts.google.com')],
    password: true,
  });
  check('an element in normal flow is not a floating window', r.logs.length === 0, r.logs);
}

{
  const r = run({
    hostname: 'codesandbox.io',
    kids: [titleStrip('×  \u{1F512} accounts.google.com')],
    password: true,
  });
  check('online IDEs are excluded outright', r.logs.length === 0, r.logs,
    'their whole product is a browser frame around a preview');
}

{
  const r = run({ trustedMediaHost: true, kids: [titleStrip('×  accounts.google.com')], password: true });
  check('the established media hosts are exempt here too', r.logs.length === 0, r.logs);
}

{
  const r = run({ enabled: false, kids: [titleStrip('×  accounts.google.com')], password: true });
  check('turning the guard off silences it', r.logs.length === 0, r.logs);
}

{
  const r = run({
    containers: [
      node({ rect: WINDOW_BOX, kids: [titleStrip('×  accounts.google.com')], password: true }),
      node({ rect: WINDOW_BOX, kids: [titleStrip('×  accounts.google.com')], password: true }),
    ],
  });
  check('one warning, not one per matching container', r.logs.length === 1, r.logs);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
{
  check('it ships on by default', /fakeWindowGuard:!0/.test(SOURCE));
  check('the toggle is gated by the master switch', /fakeWindowGuard:gate\(cfg\.fakeWindowGuard\)/.test(SOURCE));
  check('media hosts use the established exemption', /fakeWindowGuard&&WO_TOP&&!trustedMediaHost/.test(SOURCE));
  check('the popup can turn it off', /data-key="fakeWindowGuard"/.test(POPUP_HTML));
  check('Activity Center has a name for it', /warned_fake_window: '/.test(HISTORY));
  check('the in-page notice explains itself', /warned_fake_window:\{/.test(SOURCE));
  check('only the claimed domain is recorded, never the page text',
    !/innerText|textContent\.slice|pageText/.test(GUARD.slice(0, GUARD.indexOf('fwWarn='))),
    'logging what the page rendered would put page content into history');
  check('the scan is bounded so a big page cannot be walked forever',
    /looked<500/.test(GUARD) && /fwRuns>40/.test(GUARD));
  check('the observer is disconnected rather than left running',
    /observer\.disconnect\(\)/.test(GUARD));
}

if (process.exitCode) console.error('\nfake-window guard checks failed');
else console.log('\n' + passed + ' fake-window guard checks passed.');

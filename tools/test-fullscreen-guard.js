/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Full-screen address-bar spoofing.
 *
 * In full screen the browser's own address bar is gone, so a page can paint one of
 * its own -- padlock, reload arrow, a domain it does not own -- and ask for a
 * password with nothing on screen to check it against. Chrome's "press Esc" hint
 * fades after a couple of seconds and the attack is timed around it.
 *
 * The thing that separates this from a slide deck is a domain the page does NOT own
 * drawn in the top strip of the screen, arriving together with either browser
 * furniture or somewhere to type a password. Everything legitimate about full
 * screen -- video, games, presentations, maps -- has to come through untouched,
 * which is most of what this file checks.
 *
 * Run: node tools/test-fullscreen-guard.js
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

const START = 'if(WO.fullscreenGuard&&WO_TOP&&!trustedMediaHost)try{';
const END = 'if(WO.removeOverlays&&';
const from = CONTENT.indexOf(START);
const to = CONTENT.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the shipped full-screen guard markers are missing');
/* The slice ends with the block's own }catch(_){} -- the whole tail has to come
   off, or the fragment is left with an unbalanced brace. */
const RAW = CONTENT.slice(from + START.length, to);
const BODY = RAW.replace(/\}\s*catch\(_\)\{\s*\}\s*$/, '');
assert(BODY.length < RAW.length, 'the guard slice no longer ends in its own catch');
/* Rebuilt WITH its header, so WO.fullscreenGuard and trustedMediaHost are the real
   ones. Running only the body would quietly pass every exemption test. */
const GUARD = START + BODY + '}catch(_){}';

const VIEWPORT = { width: 1280, height: 800 };

/* A node only carries the text it owns; the guard reads it that way on purpose, so
   an article that merely mentions a URL is not read as an address bar. */
function el(options) {
  const o = options || {};
  const node = {
    tagName: String(o.tag || 'div').toUpperCase(),
    firstChild: null,
    _rect: Object.assign({ top: 0, bottom: 24, width: 900, height: 24 }, o.rect || {}),
    getBoundingClientRect() { return this._rect; },
    querySelector() { return o.media || null; },
  };
  if (o.text) node.firstChild = { nodeType: 3, nodeValue: o.text, nextSibling: null };
  return node;
}

function run(options) {
  const o = options || {};
  const logs = [];
  const listeners = Object.create(null);
  const timers = [];
  const appended = [];

  const body = {
    appendChild(child) { appended.push(child); return child; },
    querySelectorAll() { return o.nodes || []; },
    querySelector(selector) {
      return /password/.test(String(selector)) && o.passwordField ? { tagName: 'INPUT' } : null;
    },
  };
  const sandbox = {
    WO: { fullscreenGuard: o.enabled !== false },
    WO_TOP: true,
    trustedMediaHost: !!o.trustedMediaHost,
    regDomain: (h) => String(h || '').replace(/^www\./, '').toLowerCase().split('.').slice(-2).join('.'),
    location: { hostname: o.hostname || 'evil-login.example' },
    window: { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height },
    document: {
      body,
      documentElement: body,
      fullscreenElement: o.fullscreenElement === undefined ? el({}) : o.fullscreenElement,
      createElement: (tag) => {
        const node = el({ tag });
        node.setAttribute = () => {};
        node.addEventListener = () => {};
        node.appendChild = (child) => { (node.kids = node.kids || []).push(child); return child; };
        node.remove = () => {};
        return node;
      },
      exitFullscreen() { sandbox.__exited = true; },
      // The guard looks for a credential field on the document, not the body.
      querySelector(selector) {
        return /password/.test(String(selector)) && o.passwordField ? { tagName: 'INPUT' } : null;
      },
      querySelectorAll() { return o.nodes || []; },
    },
    __woWarn: { seen: new Map(), up() { return false; }, mark() {} },
    log(type, detail) { logs.push({ type, detail }); },
    woOn(target, type, fn) { listeners[type] = fn; },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    Set, Map, Math, String, Number, Object, Array, RegExp, Date,
  };
  sandbox.window.innerWidth = VIEWPORT.width;
  sandbox.window.innerHeight = VIEWPORT.height;
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'fullscreen-guard-slice.js' });

  if (listeners.fullscreenchange) listeners.fullscreenchange();
  while (timers.length) {
    const fn = timers.shift();
    if (typeof fn === 'function') fn();
  }
  return { logs, appended, exited: !!sandbox.__exited };
}

let passed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

const TOP = { top: 8, bottom: 40, width: 1100, height: 32 };
const MIDDLE = { top: 400, bottom: 430, width: 900, height: 30 };

// ---------------------------------------------------------------------------
// The attack
// ---------------------------------------------------------------------------
{
  const r = run({
    hostname: 'evil-login.example',
    nodes: [el({ text: '\u{1F512} https://accounts.google.com', rect: TOP })],
    passwordField: true,
  });
  check('a fake address bar with a padlock and a password field is caught', r.logs.length === 1, r.logs);
  if (r.logs.length) {
    check('it names the domain the page pretended to be', r.logs[0].detail.shown === 'google.com', r.logs[0].detail);
    check('it does not claim to have blocked anything',
      /Warned only/.test(r.logs[0].detail.outcome), r.logs[0].detail.outcome);
    check('it says why the browser cannot be checked against',
      /address bar is hidden/i.test(r.logs[0].detail.why), r.logs[0].detail.why);
    check('it warns rather than exiting full screen for you', r.exited === false);
    check('it puts a warning on the page', r.appended.length === 1);
  }
}

{
  const r = run({
    nodes: [el({ text: '↻ ← →  paypal.com', rect: TOP })],
    passwordField: false,
  });
  check('browser furniture alone is enough without a password field', r.logs.length === 1, r.logs);
}

{
  const r = run({
    nodes: [el({ text: 'signin.example-bank.com', rect: TOP })],
    passwordField: true,
  });
  check('a foreign domain plus a password field is enough without furniture', r.logs.length === 1, r.logs);
}

// ---------------------------------------------------------------------------
// Everything legitimate about full screen has to survive
// ---------------------------------------------------------------------------
{
  const r = run({ nodes: [el({ text: 'accounts.google.com \u{1F512}', rect: TOP })], passwordField: false });
  check('a padlock beside a foreign domain is furniture enough', r.logs.length === 1, r.logs);
}

{
  const r = run({ nodes: [el({ text: 'https://accounts.google.com', rect: TOP })], passwordField: false });
  check('a bare URL with no furniture and no password field is left alone', r.logs.length === 0, r.logs);
}

{
  const r = run({
    hostname: 'docs.example.com',
    nodes: [el({ text: '\u{1F512} https://docs.example.com/guide', rect: TOP })],
    passwordField: true,
  });
  check("a page showing its OWN domain is not spoofing itself", r.logs.length === 0, r.logs);
}

{
  const r = run({
    nodes: [el({ text: '\u{1F512} https://accounts.google.com', rect: MIDDLE })],
    passwordField: true,
  });
  check('a URL in the middle of the page is not an address bar', r.logs.length === 0, r.logs);
}

{
  const video = { tagName: 'VIDEO', getBoundingClientRect: () => ({ width: 1280, height: 800 }) };
  const r = run({
    fullscreenElement: el({ tag: 'video' }),
    nodes: [el({ text: '\u{1F512} youtube.com', rect: TOP })],
    passwordField: false,
    media: video,
  });
  check('a video in full screen is never inspected', r.logs.length === 0, r.logs);
}

{
  const player = el({ tag: 'div' });
  player.querySelector = () => ({
    tagName: 'VIDEO',
    getBoundingClientRect: () => ({ width: 1280, height: 780 }),
  });
  const r = run({
    fullscreenElement: player,
    nodes: [el({ text: '\u{1F512} netflix.com', rect: TOP })],
    passwordField: false,
  });
  check('a player wrapper whose video owns the screen is left alone', r.logs.length === 0, r.logs);
}

{
  const r = run({ trustedMediaHost: true, nodes: [el({ text: '\u{1F512} google.com', rect: TOP })], passwordField: true });
  check('the established media hosts are exempt outright', r.logs.length === 0, r.logs);
}

{
  const r = run({ fullscreenElement: null, nodes: [el({ text: '\u{1F512} google.com', rect: TOP })], passwordField: true });
  check('nothing happens when the page is not full screen at all', r.logs.length === 0, r.logs);
}

{
  const r = run({
    nodes: [
      el({ text: '\u{1F512} https://accounts.google.com', rect: TOP }),
      el({ text: '\u{1F512} https://accounts.google.com', rect: TOP }),
    ],
    passwordField: true,
  });
  check('one warning per pretended domain, not one per element', r.logs.length === 1, r.logs);
}

{
  const r = run({ enabled: false, nodes: [el({ text: '\u{1F512} google.com', rect: TOP })], passwordField: true });
  check('turning the guard off silences it', r.logs.length === 0, r.logs);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
{
  check('the guard is off-limits to media hosts by the established list',
    /WO\.fullscreenGuard&&WO_TOP&&!trustedMediaHost/.test(SOURCE),
    'a new host list would drift from the one every other media exemption uses');
  check('it ships on by default', /fullscreenGuard:!0/.test(SOURCE));
  check('the toggle is gated by the master switch', /fullscreenGuard:gate\(cfg\.fullscreenGuard\)/.test(SOURCE));
  check('the popup can turn it off', /data-key="fullscreenGuard"/.test(POPUP_HTML));
  check('Activity Center has a name for it', /warned_fullscreen_spoof: '/.test(HISTORY));
  check('the in-page notice explains itself', /warned_fullscreen_spoof:\{/.test(SOURCE));
  check('the warning offers the one action that helps',
    /textContent="Leave full screen"/.test(SOURCE));
  check('the payload is never the page text, only the domain',
    !/pageText|innerText|textContent\.slice/.test(GUARD.slice(0, GUARD.indexOf('fsWarn='))),
    'logging what the page rendered would put page content into history');
}

if (process.exitCode) console.error('\nfull-screen guard checks failed');
else console.log('\n' + passed + ' full-screen guard checks passed.');

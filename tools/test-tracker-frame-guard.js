/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Node harness for the tracker-frame cookie and storage guard in
 * anti-redirect.js. Run: node tools/test-tracker-frame-guard.js
 *
 * Why this suite exists. "Block third-party cookies" is two halves. The network
 * half strips Set-Cookie and is deliberately limited to image and ping
 * responses, because sign-in and federation set their cookies on frames,
 * scripts and XHR. Covering the frame case was the in-page half's job -- but
 * that code sat in the main engine, which is injected with all_frames:false, so
 * its "am I a cross-origin subframe" test could never once be true. The feature
 * had a frame-shaped hole for as long as it had existed and nothing failed,
 * because unreachable code does not fail. This suite pins both directions: the
 * guard fires inside real tracker frames, and it stays out of the way
 * everywhere else -- above all in the sign-in frames the narrow network rule
 * exists to protect.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installPlatformGlobals } = require('./lib/engine-ambient.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* One frame. `hostname` is the frame's own host, `topHostname` the embedder's.
 * Omitting topHostname models a cross-origin parent, where reading top.location
 * throws — the common real case, which must still count as cross-site. */
function build(opts) {
  opts = opts || {};
  const jar = { value: opts.cookie || '' };
  const listeners = {};
  const state = { storage: {}, session: {}, name: 'frame-name', deletedDbs: [] };
  const sandbox = { console };
  sandbox.window = sandbox;

  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  sandbox.removeEventListener = () => {};

  sandbox.Document = function Document() {};
  Object.defineProperty(sandbox.Document.prototype, 'cookie', {
    configurable: true,
    enumerable: true,
    get() { return jar.value; },
    set(v) { jar.value = jar.value ? jar.value + '; ' + String(v) : String(v); },
  });

  const doc = Object.create(sandbox.Document.prototype);
  doc.activeElement = null;
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.dispatchEvent = () => {};
  doc.getElementsByTagName = () => [];
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  sandbox.document = doc;

  const host = opts.hostname || 'scorecardresearch.com';
  sandbox.location = { href: 'https://' + host + '/beacon', hostname: host, pathname: '/beacon' };

  sandbox.localStorage = {
    clear() { state.storage = {}; },
    setItem(k, v) { state.storage[k] = String(v); },
    getItem(k) { return Object.prototype.hasOwnProperty.call(state.storage, k) ? state.storage[k] : null; },
  };
  sandbox.sessionStorage = {
    clear() { state.session = {}; },
    setItem(k, v) { state.session[k] = String(v); },
    getItem(k) { return Object.prototype.hasOwnProperty.call(state.session, k) ? state.session[k] : null; },
  };
  sandbox.indexedDB = {
    databases() { return Promise.resolve((opts.dbs || []).map((n) => ({ name: n }))); },
    deleteDatabase(n) { state.deletedDbs.push(n); },
  };

  installPlatformGlobals(sandbox);
  vm.createContext(sandbox);
  const innerWindow = vm.runInContext('window', sandbox);

  /* TOP_FRAME is `window.top === window.self`, so both have to be real here or
   * every frame in this harness would read as top-level and the suite would
   * pass for the wrong reason. */
  Object.defineProperty(sandbox, 'self', { configurable: true, get() { return innerWindow; } });
  if (opts.topFrame) {
    Object.defineProperty(sandbox, 'top', { configurable: true, get() { return innerWindow; } });
  } else if (opts.topHostname) {
    Object.defineProperty(sandbox, 'top', { configurable: true, get() { return { location: { hostname: opts.topHostname } }; } });
  } else {
    Object.defineProperty(sandbox, 'top', {
      configurable: true,
      get() { return { get location() { throw new Error('cross-origin'); } }; },
    });
  }
  Object.defineProperty(sandbox, 'name', {
    configurable: true,
    get() { return state.name; },
    set(v) { state.name = String(v); },
  });

  vm.runInContext(SRC, sandbox);

  function fire(data) {
    const ev = { type: 'message', data, source: innerWindow, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
    (listeners.message || []).forEach((fn) => fn(ev));
  }

  return {
    state, jar, sandbox,
    read() { return sandbox.document.cookie; },
    write(v) { sandbox.document.cookie = v; },
    sendConfig(overrides) {
      fire({ source: 'wardenone-handshake', token: 'tok' });
      fire({ source: 'wardenone', kind: 'config', token: 'tok', overrides: Object.assign({ enabled: true }, overrides || {}) });
    },
  };
}

// --- the frame case that used to be unreachable -----------------------------

(function trackerFrameBlocksWrites() {
  const t = build({ hostname: 'scorecardresearch.com', topHostname: 'news.example' });
  t.sendConfig({ blockThirdPartyCookies: true });
  t.write('id=abc123; path=/');
  check('tracker frame: write is swallowed', t.jar.value === '', 'jar=' + JSON.stringify(t.jar.value));
  check('tracker frame: read is empty', t.read() === '', 'read=' + JSON.stringify(t.read()));
}());

(function trackerFrameHidesPreExistingCookies() {
  const t = build({ hostname: 'criteo.com', topHostname: 'news.example', cookie: 'uid=old-tracking-id' });
  t.sendConfig({ blockThirdPartyCookies: true });
  check('tracker frame: cookie set before injection is hidden', t.read() === '', 'read=' + JSON.stringify(t.read()));
}());

(function subdomainOfTrackerIsCovered() {
  const t = build({ hostname: 'sb.scorecardresearch.com', topHostname: 'news.example' });
  t.sendConfig({ blockThirdPartyCookies: true });
  t.write('id=abc');
  check('tracker subdomain is covered', t.jar.value === '', 'jar=' + JSON.stringify(t.jar.value));
}());

(function crossOriginTopCountsAsThirdParty() {
  const t = build({ hostname: 'doubleclick.net' });
  t.sendConfig({ blockThirdPartyCookies: true });
  t.write('id=abc');
  check('unreadable cross-origin top counts as third-party', t.jar.value === '', 'jar=' + JSON.stringify(t.jar.value));
}());

// --- everything the guard must keep its hands off ---------------------------

(function loginFramesUntouched() {
  /* This is why the network rule refuses sub_frame outright. If this block ever
   * fails, signing in is broken somewhere. */
  ['accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com', 'js.stripe.com'].forEach((host) => {
    const t = build({ hostname: host, topHostname: 'shop.example' });
    t.sandbox.localStorage.setItem('sess', 'keep');
    t.sendConfig({ blockThirdPartyCookies: true, blockSupercookies: true });
    t.write('session=keepme');
    check('login frame cookie untouched: ' + host, t.jar.value === 'session=keepme', 'jar=' + JSON.stringify(t.jar.value));
    check('login frame storage untouched: ' + host, t.sandbox.localStorage.getItem('sess') === 'keep');
  });
}());

(function lookalikeHostsNotCovered() {
  /* The list is anchored at both ends, so neither a host that merely ends with
   * the same letters nor one that wears the name as a prefix may match. */
  [['notdoubleclick.net', 'suffix lookalike'], ['doubleclick.net.evil.example', 'prefix lookalike']].forEach((pair) => {
    const t = build({ hostname: pair[0], topHostname: 'news.example' });
    t.sendConfig({ blockThirdPartyCookies: true });
    t.write('id=abc');
    check('lookalike not covered (' + pair[1] + '): ' + pair[0], t.jar.value === 'id=abc', 'jar=' + JSON.stringify(t.jar.value));
  });
}());

(function featureOffPassesThrough() {
  const t = build({ hostname: 'scorecardresearch.com', topHostname: 'news.example' });
  t.sendConfig({ blockThirdPartyCookies: false });
  t.write('id=abc123');
  check('feature off: write reaches the jar', t.jar.value === 'id=abc123', 'jar=' + JSON.stringify(t.jar.value));
}());

(function beforeConfigPassesThrough() {
  /* document_start beats the config message over postMessage. Failing closed in
   * that window would break frames before anyone had asked for anything, so the
   * accessors decide per call and fall through until config lands. */
  const t = build({ hostname: 'scorecardresearch.com', topHostname: 'news.example' });
  t.write('id=early');
  check('before config: write reaches the jar', t.jar.value === 'id=early', 'jar=' + JSON.stringify(t.jar.value));
}());

(function masterOffPassesThrough() {
  const t = build({ hostname: 'scorecardresearch.com', topHostname: 'news.example' });
  t.sendConfig({ enabled: false, blockThirdPartyCookies: true });
  t.write('id=abc');
  check('master switch off: write reaches the jar', t.jar.value === 'id=abc', 'jar=' + JSON.stringify(t.jar.value));
}());

(function allowlistedEmbedderPassesThrough() {
  const t = build({ hostname: 'scorecardresearch.com', topHostname: 'news.example' });
  t.sendConfig({ blockThirdPartyCookies: true, allowlist: ['scorecardresearch.com'] });
  t.write('id=abc');
  check('allowlisted host: write reaches the jar', t.jar.value === 'id=abc', 'jar=' + JSON.stringify(t.jar.value));
}());

(function topFrameUntouched() {
  const t = build({ hostname: 'scorecardresearch.com', topFrame: true });
  t.sendConfig({ blockThirdPartyCookies: true });
  t.write('id=abc');
  check('tracker host as top frame: not third-party, write allowed', t.jar.value === 'id=abc', 'jar=' + JSON.stringify(t.jar.value));
}());

(function selfFramedTrackerUntouched() {
  const t = build({ hostname: 'criteo.com', topHostname: 'criteo.com' });
  t.sendConfig({ blockThirdPartyCookies: true });
  t.write('id=abc');
  check('tracker framing itself: first-party to itself, write allowed', t.jar.value === 'id=abc', 'jar=' + JSON.stringify(t.jar.value));
}());

// --- the supercookie sweep, which had the same dead gate --------------------

const sweepDone = (function supercookieSweepClearsStorage() {
  const t = build({ hostname: 'demdex.net', topHostname: 'news.example', dbs: ['tracker-db'] });
  t.sandbox.localStorage.setItem('uid', 'persist-me');
  t.sandbox.sessionStorage.setItem('sid', 'persist-me');
  t.sendConfig({ blockSupercookies: true });
  check('supercookie sweep: localStorage cleared', t.sandbox.localStorage.getItem('uid') === null);
  check('supercookie sweep: sessionStorage cleared', t.sandbox.sessionStorage.getItem('sid') === null);
  check('supercookie sweep: window.name cleared', t.state.name === '', 'name=' + JSON.stringify(t.state.name));
  return new Promise((resolve) => setTimeout(() => {
    check('supercookie sweep: indexedDB deleted', t.state.deletedDbs.indexOf('tracker-db') >= 0, 'deleted=' + JSON.stringify(t.state.deletedDbs));
    resolve();
  }, 10));
}());

(function supercookieSweepOffLeavesStorage() {
  const t = build({ hostname: 'demdex.net', topHostname: 'news.example' });
  t.sandbox.localStorage.setItem('uid', 'keep');
  t.sendConfig({ blockSupercookies: false });
  check('supercookie sweep off: storage untouched', t.sandbox.localStorage.getItem('uid') === 'keep');
  check('supercookie sweep off: window.name untouched', t.state.name === 'frame-name');
}());

(function supercookieSweepSkipsNonTrackerFrame() {
  const t = build({ hostname: 'shop.example', topHostname: 'news.example' });
  t.sandbox.localStorage.setItem('cart', 'keep');
  t.sendConfig({ blockSupercookies: true });
  check('supercookie sweep skips ordinary frame', t.sandbox.localStorage.getItem('cart') === 'keep');
}());

// --- structural: the guard must live somewhere that runs in frames ----------

(function guardLivesInAnAllFramesScript() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const entryFor = (file) => (manifest.content_scripts || []).find((cs) => (cs.js || []).indexOf(file) >= 0);

  const host = entryFor('anti-redirect.js');
  check('guard host runs in all frames', !!host && host.all_frames === true);
  check('guard host runs in the MAIN world', !!host && host.world === 'MAIN');
  check('guard host runs at document_start', !!host && host.run_at === 'document_start');
  check('guard source lives in the all-frames script', /TRACKER_FRAME_HOSTS/.test(SRC));

  /* The original bug, as one assertion. The main engine is top-frame only, so
   * any subframe branch inside it is dead on arrival. If injection ever widens,
   * this fails, and whoever widened it gets to re-read the login-compat story
   * before shipping. */
  const engine = entryFor('content.min.js');
  check('main engine is still top-frame only', !!engine && engine.all_frames !== true,
    'content.min.js all_frames=' + (engine && engine.all_frames));

  /* These branches used to sit in the engine, annotated as unreachable. They are
     gone now: an untested second copy that cannot run is not a reference
     implementation, it is something to keep in step with for no benefit. If one
     reappears, so does the thing this whole suite exists to catch. */
  const engineSrc = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
  check('the dead cookie blocker is gone from the engine',
    engineSrc.indexOf('applyCookieBlocker') < 0);
  check('the dead supercookie sweep is gone from the engine',
    engineSrc.indexOf('installSupercookieGuard') < 0);
  check('the note records where they went',
    /Both now live in anti-redirect\.js/.test(engineSrc));
  /* SessionShield's storage watcher reads this flag to avoid wrapping
     document.cookie twice. Deleting it with the rest would turn that read into a
     ReferenceError swallowed by a try/catch, taking the watcher down in silence. */
  check('the flag SessionShield still reads survived the deletion',
    /let cookieBlockerInstalled=!1;/.test(engineSrc) && /!cookieBlockerInstalled&&cookieDesc/.test(engineSrc));
}());

sweepDone.then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('tracker-frame guard: ' + pass + ' checks passed');
});

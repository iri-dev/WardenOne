/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Storage Access API guard. Run: node tools/test-storage-access-guard.js
 *
 * requestStorageAccess() is how an embedded third party asks for its
 * unpartitioned cookies back — the sanctioned route around the partitioning the
 * rest of the extension depends on. No extension API can see it: there is no
 * contentSettings type for storage access, declarativeNetRequest cannot observe
 * a JavaScript call, and a grant produces no distinguishable request. The page
 * API is the only lever.
 *
 * Which is what decides where the guard lives, and what most of this suite is
 * about. The caller is by definition inside the cross-origin frame, and
 * permission-chain.js — the obvious home for it — is injected all_frames:false.
 * A hook there could not fire once. That mistake has already shipped three times
 * in this codebase, so it is asserted here rather than remembered.
 *
 * The other half is restraint. This is the mechanism behind embedded sign-in,
 * embedded checkout and comment logins, so refusing everything by default would
 * be a login-compat incident wearing a privacy hat. Known trackers are refused,
 * everything else is recorded, and blanket refusal is a switch someone chooses.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installPlatformGlobals } = require('./lib/engine-ambient.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const DOMAIN_UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* One frame, with the real guard loaded into it. Omitting topHostname models a
   cross-origin parent, where reading top.location throws. */
function build(opts) {
  opts = opts || {};
  const listeners = {};
  const events = [];
  const calls = { request: 0, has: 0, requestFor: 0 };
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  sandbox.removeEventListener = () => {};

  sandbox.Document = function Document() {};
  const proto = sandbox.Document.prototype;
  if (opts.saaAvailable !== false) {
    proto.requestStorageAccess = function () { calls.request++; return Promise.resolve('real-grant'); };
    proto.hasStorageAccess = function () { calls.has++; return Promise.resolve(true); };
    proto.requestStorageAccessFor = function () { calls.requestFor++; return Promise.resolve('real-grant'); };
  }

  const doc = Object.create(proto);
  doc.activeElement = null;
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.getElementsByTagName = () => [];
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.dispatchEvent = (ev) => {
    if (ev && ev.type === 'wo-event' && ev.detail) events.push(ev.detail);
    return true;
  };
  sandbox.document = doc;

  const host = opts.hostname || 'comments.example';
  sandbox.location = { href: 'https://' + host + '/embed', hostname: host, pathname: '/embed' };
  sandbox.innerWidth = opts.width === undefined ? 640 : opts.width;
  sandbox.innerHeight = opts.height === undefined ? 480 : opts.height;
  sandbox.navigator = opts.noUserActivationApi
    ? {}
    : { userActivation: { isActive: opts.activated !== false } };
  sandbox.DOMException = function DOMException(message, name) {
    const e = new Error(message);
    e.name = name || 'Error';
    return e;
  };
  sandbox.URL = URL;
  /* emit() builds a CustomEvent. Without it the dispatch throws into emit's
     own catch and every recording check fails while the refusals still pass —
     which reads exactly like "logging is broken" rather than "the harness is". */
  sandbox.CustomEvent = CustomEvent;

  installPlatformGlobals(sandbox);
  vm.createContext(sandbox);
  const innerWindow = vm.runInContext('window', sandbox);
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

  vm.runInContext(DOMAIN_UTILS, sandbox);
  vm.runInContext(SRC, sandbox);

  function fire(data) {
    const ev = { type: 'message', data, source: innerWindow, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
    (listeners.message || []).forEach((fn) => fn(ev));
  }

  return {
    sandbox, events, calls,
    doc,
    sendConfig(overrides) {
      fire({ source: 'wardenone-handshake', token: 'tok' });
      fire({ source: 'wardenone', kind: 'config', token: 'tok', overrides: Object.assign({ enabled: true }, overrides || {}) });
    },
    async request() {
      try { return { ok: true, value: await sandbox.document.requestStorageAccess() }; }
      catch (e) { return { ok: false, error: e }; }
    },
    async has() {
      try { return { ok: true, value: await sandbox.document.hasStorageAccess() }; }
      catch (e) { return { ok: false, error: e }; }
    },
    async requestFor(origin) {
      try { return { ok: true, value: await sandbox.document.requestStorageAccessFor(origin) }; }
      catch (e) { return { ok: false, error: e }; }
    },
    typed(type) { return this.events.filter((e) => e.type === type); },
  };
}

const pending = [];

// --- the reason it lives where it lives -------------------------------------

(function itIsInAFrameCapableScript() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const entryFor = (file) => (manifest.content_scripts || []).find((cs) => (cs.js || []).indexOf(file) >= 0);

  const host = entryFor('anti-redirect.js');
  check('the guard lives in a script that runs in every frame', !!host && host.all_frames === true);
  check('it runs in the MAIN world, where the page API lives', !!host && host.world === 'MAIN');
  check('it runs at document_start, before the frame\'s own scripts', !!host && host.run_at === 'document_start');
  check('the guard source is in that script', /requestStorageAccess/.test(SRC));

  /* The mistake this asserts against: permission-chain.js is the natural home on
     paper and cannot work, because the caller is inside the frame and that file
     never reaches one. */
  const chain = entryFor('permission-chain.js');
  check('permission-chain.js is still top-frame only', !!chain && chain.all_frames !== true);
  const chainSrc = fs.readFileSync(path.join(ROOT, 'permission-chain.js'), 'utf8');
  check('the guard was not put in the top-frame-only script',
    chainSrc.indexOf('requestStorageAccess') < 0);
}());

(function eventsCanActuallyReachTheLog() {
  /* bridge.js forwards only these prefixes. An event named anything else is
     dispatched into nothing, which looks exactly like working. */
  check('bridge forwards the prefixes the guard uses',
    /\^blocked_\|\^detected_\|\^gated_\|\^warned_/.test(BRIDGE.replace(/\s/g, '')),
    'bridge prefix filter changed');
  ['blocked_storage_access', 'warned_storage_access', 'detected_storage_access'].forEach((t) => {
    check('event type ' + t + ' matches a forwarded prefix', /^(blocked|detected|gated|warned)_/.test(t));
    check('the guard emits ' + t, SRC.indexOf(t) >= 0);
  });
}());

// --- what gets refused ------------------------------------------------------

pending.push((async function trackerFramesAreRefused() {
  const t = build({ hostname: 'doubleclick.net', topHostname: 'news.example' });
  t.sendConfig({ storageAccessGuard: true });
  const r = await t.request();
  check('a known tracker frame is refused', !r.ok, JSON.stringify(r.value));
  check('the refusal is a rejected promise, the shape callers already handle',
    !r.ok && r.error && r.error.name === 'NotAllowedError', r.ok ? 'resolved' : r.error && r.error.name);
  check('the real API is never reached', t.calls.request === 0);
  const logged = t.typed('blocked_storage_access');
  check('the refusal is recorded', logged.length === 1);
  check('the embedded origin is recorded by name',
    logged.length === 1 && logged[0].detail.host === 'doubleclick.net', JSON.stringify(logged[0] && logged[0].detail));
}()));

pending.push((async function hasStorageAccessIsAnsweredHonestlyUnderRefusal() {
  const t = build({ hostname: 'criteo.com', topHostname: 'news.example' });
  t.sendConfig({ storageAccessGuard: true });
  const r = await t.has();
  check('hasStorageAccess resolves false under refusal, as an ungranted frame sees',
    r.ok && r.value === false, JSON.stringify(r));
  check('the real API is never reached', t.calls.has === 0);
  check('the silent probe is still recorded', t.typed('blocked_storage_access').length === 1);
}()));

pending.push((async function blanketRefusalStopsEveryone() {
  const t = build({ hostname: 'comments.example', topHostname: 'news.example' });
  t.sendConfig({ storageAccessGuard: true, blockAllStorageAccess: true });
  const r = await t.request();
  check('with blanket refusal on, an ordinary embed is refused too', !r.ok);
  check('and it is recorded as blocked', t.typed('blocked_storage_access').length === 1);
}()));

// --- what gets recorded but allowed ----------------------------------------

pending.push((async function ordinaryEmbeddedSignInStillWorks() {
  /* The case that decides whether this feature is shippable. A comment box the
     user clicked is exactly what this API is for. */
  const t = build({ hostname: 'comments.example', topHostname: 'news.example' });
  t.sendConfig({ storageAccessGuard: true });
  const r = await t.request();
  check('an ordinary embed is allowed through', r.ok && r.value === 'real-grant', JSON.stringify(r));
  check('the real API is reached', t.calls.request === 1);
  const seen = t.typed('detected_storage_access');
  check('it is still recorded, because nobody could see it before', seen.length === 1);
  check('nothing is warned about', t.typed('warned_storage_access').length === 0);
  check('the embedded origin is named', seen.length === 1 && seen[0].detail.host === 'comments.example');
}()));

pending.push((async function suspiciousShapesAreWarnedNotBlocked() {
  const cases = [
    [{ activated: false }, 'nothing was clicked or typed first'],
    [{ width: 1, height: 1 }, 'the frame is invisible'],
  ];
  for (const pair of cases) {
    const t = build(Object.assign({ hostname: 'comments.example', topHostname: 'news.example' }, pair[0]));
    t.sendConfig({ storageAccessGuard: true });
    const r = await t.request();
    check('suspicious but not a tracker: still allowed (' + pair[1] + ')', r.ok, JSON.stringify(r));
    const warned = t.typed('warned_storage_access');
    check('suspicious shape is warned: ' + pair[1], warned.length === 1);
    check('the reason says why: ' + pair[1],
      warned.length === 1 && warned[0].detail.why.indexOf(pair[1]) >= 0,
      warned.length === 1 ? warned[0].detail.why : 'no warning');
  }
}()));

pending.push((async function missingUserActivationApiIsNotSuspicion() {
  /* No opinion is not the same as suspicion. Guessing wrong here puts a warning
     on every ordinary embed, which is how a signal becomes noise. */
  const t = build({ hostname: 'comments.example', topHostname: 'news.example', noUserActivationApi: true });
  t.sendConfig({ storageAccessGuard: true });
  await t.request();
  check('an absent userActivation API produces no warning', t.typed('warned_storage_access').length === 0,
    JSON.stringify(t.typed('warned_storage_access')));
  check('it is still recorded', t.typed('detected_storage_access').length === 1);
}()));

// --- what must be left alone ------------------------------------------------

pending.push((async function sameSiteFramesAreNotThirdParties() {
  const t = build({ hostname: 'shop.example', topHostname: 'shop.example' });
  t.sendConfig({ storageAccessGuard: true });
  const r = await t.request();
  check('a same-site frame is untouched', r.ok && t.calls.request === 1);
  check('and nothing is recorded for it', t.events.length === 0, JSON.stringify(t.events));
}()));

pending.push((async function theTopFrameIsNotAnEmbed() {
  const t = build({ hostname: 'news.example', topFrame: true });
  t.sendConfig({ storageAccessGuard: true });
  const r = await t.request();
  check('the top frame asking for itself is untouched', r.ok && t.calls.request === 1);
}()));

pending.push((async function switchesAreHonoured() {
  for (const over of [{ storageAccessGuard: false }, { enabled: false }, { allowlist: ['doubleclick.net'] }]) {
    const t = build({ hostname: 'doubleclick.net', topHostname: 'news.example' });
    t.sendConfig(Object.assign({ storageAccessGuard: true }, over));
    const r = await t.request();
    check('a tracker is allowed through when ' + Object.keys(over)[0] + ' says so', r.ok, JSON.stringify(r));
    check('and nothing is recorded when ' + Object.keys(over)[0] + ' says so', t.events.length === 0);
  }
}()));

pending.push((async function beforeConfigArrivesNothingIsRefused() {
  /* document_start beats the config message. Failing closed in that window would
     break embedded sign-in before anyone asked for anything. */
  const t = build({ hostname: 'doubleclick.net', topHostname: 'news.example' });
  const r = await t.request();
  check('before config lands, the call falls straight through', r.ok && t.calls.request === 1, JSON.stringify(r));
}()));

pending.push((async function absentApiIsNotAnError() {
  let threw = false;
  try {
    const t = build({ hostname: 'comments.example', topHostname: 'news.example', saaAvailable: false });
    t.sendConfig({ storageAccessGuard: true });
  } catch (_) { threw = true; }
  check('a browser without the Storage Access API is handled without throwing', !threw);
}()));

// --- the other direction ----------------------------------------------------

pending.push((async function theTopLevelVariantIsCoveredToo() {
  /* requestStorageAccessFor lets the TOP page ask on an embed's behalf. Same
     grant, same consequence, opposite caller — and easy to miss. */
  const t = build({ hostname: 'news.example', topFrame: true });
  t.sendConfig({ storageAccessGuard: true });
  const bad = await t.requestFor('https://doubleclick.net/');
  check('a top page asking on a tracker\'s behalf is refused', !bad.ok, JSON.stringify(bad.value));
  const blocked = t.typed('blocked_storage_access');
  check('the tracker it asked for is recorded by name',
    blocked.length === 1 && blocked[0].detail.host === 'doubleclick.net',
    JSON.stringify(blocked[0] && blocked[0].detail));

  const t2 = build({ hostname: 'news.example', topFrame: true });
  t2.sendConfig({ storageAccessGuard: true });
  const fine = await t2.requestFor('https://comments.example/');
  check('a top page asking for an ordinary embed is allowed', fine.ok && t2.calls.requestFor === 1);
  check('and recorded', t2.typed('detected_storage_access').length === 1);
}()));

// --- wiring and copy --------------------------------------------------------

(function wiredEverywhere() {
  check('popup exposes the watch toggle', /data-key="storageAccessGuard"/.test(POPUP_HTML));
  check('popup exposes the blanket refusal toggle', /data-key="blockAllStorageAccess"/.test(POPUP_HTML));
  check('watching defaults on', /storageAccessGuard: true/.test(POPUP_JS) && /storageAccessGuard: true/.test(BG));
  check('blanket refusal defaults off', /blockAllStorageAccess: false/.test(POPUP_JS) && /blockAllStorageAccess: false/.test(BG));
  check('both count as protections',
    /'storageAccessGuard'/.test(BG.slice(BG.indexOf('HEALTH_SHIELD_KEYS')))
      && /'blockAllStorageAccess'/.test(BG.slice(BG.indexOf('HEALTH_SHIELD_KEYS'))));

  /* Blanket refusal breaks embedded sign-in, so it must not be swept on by a
     button whose whole promise is that it is safe to press. */
  const manual = POPUP_JS.slice(POPUP_JS.indexOf('MANUAL_ONLY_TOGGLES'));
  check('"Turn everything on" does not reach blanket refusal',
    manual.slice(0, manual.indexOf(']')).indexOf('blockAllStorageAccess') >= 0);

  /* Same reasoning for the Maximum Privacy bundle, which is built to be a
     superset of Recommended without the footguns. */
  const bundle = BG.slice(BG.indexOf('const ONBOARDING_RECOMMENDED'), BG.indexOf('const REMOTE_LISTS'));
  check('the Maximum Privacy bundle does not turn on blanket refusal',
    bundle.indexOf('blockAllStorageAccess') < 0);

  const row = POPUP_HTML.slice(POPUP_HTML.indexOf('Refuse every cross-site cookie request'));
  const desc = row.slice(0, row.indexOf('</div></div>'));
  check('the copy says plainly what blanket refusal breaks',
    /sign(ing)? in|checkout|comment login/i.test(desc), desc.slice(0, 140));
}());

// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('storage access guard: ' + pass + ' checks passed');
});

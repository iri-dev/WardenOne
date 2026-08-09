/*
 * Node harness for Location Privacy / blockGeolocation.
 * Runs the shipped content.min.js guard slice in a vm sandbox and asserts:
 *   - geolocation calls are denied while the toggle is on
 *   - already-live watches are cleared when blocking begins
 *   - permissions.query/request/revoke report geolocation as denied
 *   - page-visible language + timezone hints are masked
 *   - turning the toggle off falls through to the real browser methods
 *
 * Run: node tools/test-location-guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const MIN = fs.readFileSync(path.join(__dirname, '..', 'content.min.js'), 'utf8');
const START = MIN.indexOf('try{let locationEventCount=0;const locationPrivacyOn=');
const END = MIN.indexOf('if(WO.mediaShield)try{', START);
if (START < 0 || END < 0 || END <= START) {
  console.error('FATAL: location guard markers not found in content.min.js');
  process.exit(1);
}
const SLICE = MIN.slice(START, END);

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); return; }
  fail++;
  console.log('  FAIL - ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

function makeSandbox(blocked) {
  const logs = [];
  const cleared = [];
  let successCalls = 0;
  let errorCalls = 0;
  let watchCalls = 0;

  function Navigator() {}
  Object.defineProperty(Navigator.prototype, 'language', {
    configurable: true,
    enumerable: true,
    get() { return 'en-GB'; },
  });
  Object.defineProperty(Navigator.prototype, 'languages', {
    configurable: true,
    enumerable: true,
    get() { return ['en-GB', 'en']; },
  });

  const navigator = new Navigator();
  navigator.geolocation = {
    getCurrentPosition(success) {
      successCalls++;
      if (typeof success === 'function') success({ coords: { latitude: 51.5, longitude: -0.1 } });
    },
    watchPosition(success) {
      watchCalls++;
      if (typeof success === 'function') success({ coords: { latitude: 51.5, longitude: -0.1 } });
      return 42;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };
  navigator.permissions = {
    query(desc) { return Promise.resolve({ name: desc && desc.name, state: 'prompt' }); },
    request(desc) { return Promise.resolve({ name: desc && desc.name, state: 'granted' }); },
    revoke(desc) { return Promise.resolve({ name: desc && desc.name, state: 'prompt' }); },
  };

  const listeners = {};
  const sandbox = {
    WO: { blockGeolocation: !!blocked },
    log(type, detail) { logs.push({ type, detail }); },
    location: { hostname: 'example.test' },
    navigator,
    Navigator,
    document: {
      addEventListener(name, cb) { listeners[name] = cb; },
    },
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    Promise,
    Object,
    String,
    Set,
    Array,
  };
  sandbox.__state = {
    logs,
    cleared,
    listeners,
    get successCalls() { return successCalls; },
    get errorCalls() { return errorCalls; },
    get watchCalls() { return watchCalls; },
    incError() { errorCalls++; },
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(SLICE, sandbox);
  return sandbox;
}

(async () => {
  const s = makeSandbox(true);
  let deniedCode = 0;
  s.navigator.geolocation.getCurrentPosition(
    () => { throw new Error('blocked getCurrentPosition called success'); },
    (err) => { deniedCode = err && err.code; s.__state.incError(); },
  );
  const fakeWatch = s.navigator.geolocation.watchPosition(
    () => { throw new Error('blocked watchPosition called success'); },
    (err) => { deniedCode = err && err.code; s.__state.incError(); },
  );

  check('blocked get/watch report permission denied', deniedCode === 1 && s.__state.errorCalls === 2,
    { deniedCode, errorCalls: s.__state.errorCalls });
  check('blocked watchPosition returns a synthetic negative id', fakeWatch < 0, fakeWatch);
  check('blocked geolocation calls are logged', s.__state.logs.filter((l) => l.type === 'blocked_geolocation').length === 2,
    s.__state.logs);

  const q = await s.navigator.permissions.query({ name: 'geolocation' });
  const r = await s.navigator.permissions.request({ name: 'geolocation' });
  const v = await s.navigator.permissions.revoke({ name: 'geolocation' });
  check('permission APIs report geolocation denied', q.state === 'denied' && r.state === 'denied' && v.state === 'denied',
    { query: q.state, request: r.state, revoke: v.state });
  check('navigator language hints are generic', s.navigator.language === 'en-US' && s.navigator.languages.join(',') === 'en-US,en',
    { language: s.navigator.language, languages: s.navigator.languages });
  const tz = vm.runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', s);
  const offset = vm.runInContext('new Date().getTimezoneOffset()', s);
  check('timezone hints are neutralized', tz === 'UTC' && offset === 0, { tz, offset });

  const s2 = makeSandbox(false);
  const realWatch = s2.navigator.geolocation.watchPosition(() => {});
  s2.WO.blockGeolocation = true;
  s2.navigator.geolocation.getCurrentPosition(() => {}, () => {});
  check('turning blocking on clears a previously-live watch', realWatch === 42 && s2.__state.cleared.includes(42),
    { realWatch, cleared: s2.__state.cleared });

  const s3 = makeSandbox(false);
  let realSuccess = false;
  s3.navigator.geolocation.getCurrentPosition(() => { realSuccess = true; }, () => {});
  const realPermission = await s3.navigator.permissions.query({ name: 'geolocation' });
  check('when toggle is off, real geolocation and permission methods still run',
    realSuccess && realPermission.state === 'prompt' && s3.navigator.language === 'en-GB',
    { realSuccess, permission: realPermission.state, language: s3.navigator.language });

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});

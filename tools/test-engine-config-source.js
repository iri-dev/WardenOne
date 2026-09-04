/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Where the engine's config comes FROM (H16).
 *
 * test-engine-config-ownership.js pins that the engine no longer returns the page-owned global as
 * its config object. That closed direct mutation and nothing else, because the refresh still READ
 * window.__WO_CONFIG__ -- and wo-config-change is an ordinary DOM event on document, which the
 * page can dispatch. So a page did not need to own the object:
 *
 *     window.__WO_CONFIG__ = { enabled:false, paymentCardGuard:false, ... };
 *     document.dispatchEvent(new CustomEvent('wo-config-change'));
 *
 * and the engine copied that in. An empty object was worse than a false one: the refresh drops
 * keys the incoming config no longer carries, so it deleted every setting. Both guard idioms in
 * the engine fall to an explicitly-false config -- `if (WO.x)` and `if (false !== WO.x)` -- so a
 * page could switch off Payment Card Guard, skimmer detection and the phishing blocker together.
 *
 * The source of truth is __woConfigStore now, written only by the token-checked config handler.
 * window.__WO_CONFIG__ is kept as a copy so twitch-adblock.js and debugging can read it, and
 * writing to that copy must not reach the engine.
 *
 * These tests drive the REAL __woSyncConfig lifted from src/content.js, because the interesting
 * behaviour is the key-dropping refresh, and a description of it here would be testing itself.
 *
 * Run: node tools/test-engine-config-source.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Lift the real binding rather than restating the derivation rules, which would drift.
// The chain now begins with the named YouTube pause list, which the derivation
// below reads -- slicing from `const WO={}` would leave it undefined.
const FROM = '    const YT_COMPAT_PAUSED=[';
const TO = '    WO_TOP=window===window.top,';
const from = SRC.indexOf(FROM);
const to = SRC.indexOf(TO);
if (from < 0 || to <= from) throw new Error('engine config binding markers not found');
const snippet = SRC.slice(from, to).replace(/,\s*$/, ';');

function runEngine(storeSeed, pageGlobalSeed, hostname) {
  const listeners = [];
  const sandbox = {
    location: { hostname: hostname || 'example.com' },
    window: {},
    document: {
      addEventListener: (type, fn) => listeners.push([type, fn]),
    },
    Object,
    String,
    Number,
    Array,
    console,
  };
  sandbox.window.top = sandbox.window;
  sandbox.window.__WO_CONFIG__ = pageGlobalSeed;
  vm.createContext(sandbox);
  // The lifted region uses the engine's ambient helpers (__woConfigStore, __woAmazonHost, woOn)
  // but declares none of them. installEngineAmbient is the one place that answers for those, and
  // it lifts __woAmazonHost from the engine itself -- so this suite exercises the real host
  // derivation rather than a copy of it. Seed the store AFTER, since the shim declares it empty.
  installEngineAmbient(sandbox);
  Object.assign(sandbox.__woConfigStore, storeSeed);
  // `const WO` is a lexical declaration, so it never becomes a property of the sandbox global.
  // Hand it out explicitly rather than reaching for sandbox.WO, which is silently undefined.
  vm.runInContext(snippet + '\nglobalThis.__woTestWO=WO;', sandbox);
  return {
    WO: sandbox.__woTestWO,
    sandbox,
    fireConfigChange() {
      for (const [type, fn] of listeners) if (type === 'wo-config-change') fn({});
    },
  };
}

// removeOverlays is carried so the YouTube pause below is observable: it is the
// one key here that YT_COMPAT_PAUSED names.
const REAL = { enabled: true, detectPhishing: true, paymentCardGuard: true, detectSkimmers: true, blockTokenExfil: true, removeOverlays: true };

// ---------------------------------------------------------------------------
// 1. A page that replaces the global and fires the event changes nothing.
//
// Both hostile shapes are exercised. The empty object is the more damaging of the two, because
// the refresh deletes keys the incoming config omits.
// ---------------------------------------------------------------------------
{
  for (const [label, hostile] of [
    ['an empty object', {}],
    ['an all-false config', { enabled: false, detectPhishing: false, paymentCardGuard: false, detectSkimmers: false, blockTokenExfil: false }],
    ['a config that re-enables things the user turned off', { enabled: true, blockAllCookies: true }],
  ]) {
    const run = runEngine(REAL, null, 'example.com');
    check('engine starts from the store, not the page (' + label + ')', run.WO.paymentCardGuard === true);
    run.sandbox.window.__WO_CONFIG__ = hostile;
    run.fireConfigChange();
    check('page writing the global + firing wo-config-change is inert (' + label + ')',
      run.WO.enabled === true && run.WO.paymentCardGuard === true && run.WO.detectPhishing === true,
      'engine adopted the page config: ' + JSON.stringify(run.WO));
  }
}

// ---------------------------------------------------------------------------
// 2. The legitimate path still works, including the key-dropping the design depends on.
//
// A setting turned off upstream must not survive in the engine, or the refresh would be a
// one-way ratchet. This is the behaviour the fix had to preserve while closing the hole.
// ---------------------------------------------------------------------------
{
  const run = runEngine(REAL, null, 'example.com');
  check('legitimate start reflects the store', run.WO.detectSkimmers === true);

  // What the token-checked handler does: mutate the store in place, then notify.
  run.sandbox.__woConfigStore.paymentCardGuard = false;
  run.fireConfigChange();
  check('a real config change reaches the engine', run.WO.paymentCardGuard === false);

  delete run.sandbox.__woConfigStore.blockTokenExfil;
  run.fireConfigChange();
  check('a key dropped upstream is dropped in the engine', !('blockTokenExfil' in run.WO));
}

// ---------------------------------------------------------------------------
// 3. The compatibility derivations still key off the real host, not a page-supplied one.
// ---------------------------------------------------------------------------
{
  // The Amazon exit is gone; only YouTube pauses anything now, and only by name.
  const amazon = runEngine(REAL, null, 'www.amazon.co.uk');
  check('a real Amazon storefront gets the ordinary config', amazon.WO.enabled === true);

  const yt = runEngine(REAL, null, 'www.youtube.com');
  check('the YouTube derivation still keys off the real host',
    yt.WO.enabled === true && yt.WO.removeOverlays === false);

  const spoof = runEngine(REAL, null, 'youtube.com.evil.tld');
  check('the YouTube derivation does not apply to a look-alike host',
    spoof.WO.removeOverlays === true);
}

// ---------------------------------------------------------------------------
// 4. Static shape: no engine read of the global survives, in source or in the shipped build.
//
// Comments quote the global deliberately, so they are stripped before looking.
// ---------------------------------------------------------------------------
{
  const codeOf = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [label, text] of [['source', SRC], ['shipped build', MIN]]) {
    const hits = [...codeOf(text).matchAll(/window\.__WO_CONFIG__/g)].length;
    check('only the two mirror writes touch the global in the ' + label, hits === 2, 'found ' + hits);
  }
  check('the refresh reads the private store', /__woSyncConfig=\(\)=>\{\s*const cfg=__woConfigStore,/.test(codeOf(MIN)));
  check('the store is declared once', (SRC.match(/const __woConfigStore=\{\};/g) || []).length === 1);
}

if (failed) { console.error('\n' + failed + ' config-source check(s) failed'); process.exit(1); }
console.log('\nthe engine takes its config only from the token-checked store');

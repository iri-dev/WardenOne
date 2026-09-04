/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Who owns the engine's config (H10).
 *
 * The engine runs in the MAIN world, which it shares with the page. Its authoritative config used
 * to BE window.__WO_CONFIG__ -- returned by reference on every site except Amazon and YouTube,
 * which take derived copies and were insulated by accident. So a page could run
 * Object.assign(window.__WO_CONFIG__, { enabled: false }) and switch the running engine off.
 *
 * The fix is not a snapshot. The start path has a 1500ms fallback that fires whether or not the
 * config has arrived, so Object.assign({}, cfg) at bind time would freeze the placeholder defaults
 * on exactly the slow tabs least able to report it -- a silent, worse bug. The config is a private
 * object refreshed IN PLACE from the global instead, which keeps both the isolation and the
 * late-arrival recovery. These tests pin both halves, because a fix for one that breaks the other
 * would look correct in isolation.
 *
 * Run: node tools/test-engine-config-ownership.js
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

// Lift the config binding itself rather than describing it here. A second copy of the derivation
// rules would drift from the engine's, and then this suite would be testing its own opinion.
// The chain now begins with the named YouTube pause list, which the derivation
// below reads -- slicing from `const WO={}` would leave it undefined.
const from = SRC.indexOf('    const YT_COMPAT_PAUSED=[');
const to = SRC.indexOf('    WO_TOP=window===window.top,');
if (from < 0 || to <= from) throw new Error('engine config binding markers not found');
const chain = SRC.slice(from, to).replace(/,\s*$/, ';');

function boot(hostname) {
  const listeners = {};
  const box = { console, Object, String, RegExp };
  box.window = box;
  box.self = box;
  box.globalThis = box;
  box.location = { hostname };
  box.document = { addEventListener: (e, f) => { (listeners[e] = listeners[e] || []).push(f); } };
  vm.createContext(box);
  installEngineAmbient(box);
  vm.runInContext(
    chain + '\nglobalThis.__WO=WO;',
    box,
    { filename: 'src/content.js' },
  );
  return {
    WO: box.__WO,
    box,
    configChanged: () => (listeners['wo-config-change'] || []).forEach((f) => f()),
    listenerCount: (listeners['wo-config-change'] || []).length,
  };
}

// The token-checked handler writes the private store and then notifies. It always writes a full
// config (buildConfig fills every key), so seeding clears first -- a merge would leave keys the
// new config dropped, and the 'removed upstream' check below would pass for the wrong reason.
function seed(t, config) {
  const store = t.box.__woConfigStore;
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, config);
  t.configChanged();
}

// ---------------------------------------------------------------------------
// 1. The bypass itself.
// ---------------------------------------------------------------------------
{
  const t = boot('example.test');
  seed(t, { enabled: true, removeOverlays: true, __configReady: true });
  check('the engine picks up a real config', t.WO.enabled === true);

  // Exactly what the finding describes a hostile page doing -- including dispatching
  // wo-config-change itself, which is an ordinary DOM event and was the other half of H16.
  t.box.__WO_CONFIG__ = { enabled: false, removeOverlays: false };
  t.configChanged();
  check('a page mutating the global cannot disable the engine',
    t.WO.enabled === true, 'WO.enabled became ' + t.WO.enabled);
  check('a page mutating the global cannot turn off individual protections',
    t.WO.removeOverlays === true);

  // Replacing the global wholesale is the other obvious attempt.
  t.box.__WO_CONFIG__ = { enabled: false };
  t.configChanged();
  check('a page replacing the global outright does not take effect either',
    t.WO.enabled === true);
}

// ---------------------------------------------------------------------------
// 2. The regression a naive snapshot would have caused. This is the half that makes the
//    obvious one-line fix wrong, so it is pinned as hard as the bypass.
// ---------------------------------------------------------------------------
{
  const t = boot('example.test');
  check('binding before the config exists does not throw', typeof t.WO === 'object');
  check('no config yet means no settings, not defaults invented here',
    t.WO.enabled === undefined);

  // The 1500ms fallback can start the runtime before the config lands. A frozen snapshot would
  // never see this.
  seed(t, { enabled: true, removeOverlays: true, __configReady: true });
  check('a config arriving AFTER bind is still picked up',
    t.WO.enabled === true && t.WO.removeOverlays === true,
    'a snapshot would have frozen the placeholder here');

  // And a setting genuinely turned off upstream must not survive in the private copy.
  seed(t, { enabled: true, __configReady: true });
  check('a key removed upstream is dropped rather than lingering',
    t.WO.removeOverlays === undefined);
}

// ---------------------------------------------------------------------------
// 3. Identity. WO is a const captured by closures throughout the engine, so the refresh has to
//    mutate the same object; reassigning would leave every captured reference stale.
// ---------------------------------------------------------------------------
{
  const t = boot('example.test');
  const held = t.WO;
  seed(t, { enabled: true, __configReady: true });
  check('the refresh mutates in place rather than rebinding', held === t.WO);
  check('a closure that captured the object early sees the update', held.enabled === true);
  check('the engine subscribes to config changes exactly once', t.listenerCount === 1);
}

// ---------------------------------------------------------------------------
// 4. The derived per-site configs must be rebuilt on every sync, or they go stale the moment the
//    config changes -- the failure mode that trades one bug for another.
// ---------------------------------------------------------------------------
{
  // Carries one setting from each side of the YouTube carve-out: removeOverlays
  // and blockAutoplay are paused there by name, the rest must come through.
  const full = { enabled: true, showBadge: true, showToasts: true, adShield: true, scriptletEngine: true, removeOverlays: true, blockAutoplay: true, cleanCopyLinks: true, detectPhishing: true, sessionShield: true, __configReady: true };

  // Amazon and Shopify used to take a whole-engine exit: the runtime returned
  // before installing anything and this derivation turned every boolean off,
  // while both still stamped __wardenOneInstalled so the tab reported itself
  // protected. Removed -- YouTube is now the only host that pauses anything, and
  // it pauses only the names in YT_COMPAT_PAUSED.
  const az = boot('www.amazon.co.uk');
  seed(az, full);
  check('Amazon gets the ordinary config like any other site',
    az.WO.enabled === true && az.WO.removeOverlays === true
      && az.WO.__amazonCompatibilityMode === undefined,
    'a site-wide off switch is what this check exists to prevent coming back');

  // The YouTube carve-out names what it pauses. It used to turn every boolean
  // off and switch two back on, which paused 64 default-on protections while the
  // popup still showed them as enabled -- and it set enabled:false, which killed
  // through scriptletRuntimeOn the very adShield/scriptletEngine it had just
  // restored. Both directions are pinned here: what stays on, and what stays off.
  const yt = boot('www.youtube.com');
  seed(yt, full);
  check('YouTube carve-outs survive the rewrite',
    yt.WO.enabled === true && yt.WO.adShield === true && yt.WO.scriptletEngine === true,
    'enabled:false silently disabled the ad blocking this branch tries to keep');
  check('the YouTube carve-out pauses only what it names',
    yt.WO.removeOverlays === false && yt.WO.blockAutoplay === false
      && yt.WO.cleanCopyLinks === true && yt.WO.detectPhishing === true
      && yt.WO.sessionShield === true,
    'see tools/test-youtube-compat.js for the full list and the reasoning');

  // Re-deriving is the point: a config change on a carve-out site must re-apply the carve-out.
  seed(yt, Object.assign({}, full, { adShield: false }));
  check('a carve-out site re-derives on every config change',
    yt.WO.adShield === false && yt.WO.removeOverlays === false,
    'derived config went stale');
}

// ---------------------------------------------------------------------------
// 5. Source shape, and the shipped build. The build is generated, so a source-only fix that never
//    reached it would be invisible everywhere else.
// ---------------------------------------------------------------------------
{
  check('the engine no longer returns the page-owned global as its config',
    !/\)\)return cfg;/.test(SRC), 'the bare `return cfg` path is back');
  check('the config is refreshed in place, not reassigned',
    /Object\.assign\(WO,next\)/.test(SRC));
  check('the shipped build carries the same ownership',
    MIN.includes('Object.assign(WO,next)') && !/\)\)return cfg;/.test(MIN));
}

if (failed) { console.error('\n' + failed + ' config-ownership check(s) failed'); process.exit(1); }
console.log('\nengine config ownership holds');

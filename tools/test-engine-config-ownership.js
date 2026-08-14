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
const from = SRC.indexOf('    const WO={},');
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
  vm.runInContext(
    'const woOn=(t,e,f)=>t.addEventListener(e,f);\n' + chain + '\nglobalThis.__WO=WO;',
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

// ---------------------------------------------------------------------------
// 1. The bypass itself.
// ---------------------------------------------------------------------------
{
  const t = boot('example.test');
  t.box.__WO_CONFIG__ = { enabled: true, removeOverlays: true, __configReady: true };
  t.configChanged();
  check('the engine picks up a real config', t.WO.enabled === true);

  // Exactly what the finding describes a hostile page doing.
  Object.assign(t.box.__WO_CONFIG__, { enabled: false, removeOverlays: false });
  check('a page mutating the global cannot disable the engine',
    t.WO.enabled === true, 'WO.enabled became ' + t.WO.enabled);
  check('a page mutating the global cannot turn off individual protections',
    t.WO.removeOverlays === true);

  // Replacing the global wholesale is the other obvious attempt.
  t.box.__WO_CONFIG__ = { enabled: false };
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
  t.box.__WO_CONFIG__ = { enabled: true, removeOverlays: true, __configReady: true };
  t.configChanged();
  check('a config arriving AFTER bind is still picked up',
    t.WO.enabled === true && t.WO.removeOverlays === true,
    'a snapshot would have frozen the placeholder here');

  // And a setting genuinely turned off upstream must not survive in the private copy.
  t.box.__WO_CONFIG__ = { enabled: true, __configReady: true };
  t.configChanged();
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
  t.box.__WO_CONFIG__ = { enabled: true, __configReady: true };
  t.configChanged();
  check('the refresh mutates in place rather than rebinding', held === t.WO);
  check('a closure that captured the object early sees the update', held.enabled === true);
  check('the engine subscribes to config changes exactly once', t.listenerCount === 1);
}

// ---------------------------------------------------------------------------
// 4. The derived per-site configs must be rebuilt on every sync, or they go stale the moment the
//    config changes -- the failure mode that trades one bug for another.
// ---------------------------------------------------------------------------
{
  const full = { enabled: true, showBadge: true, showToasts: true, adShield: true, scriptletEngine: true, removeOverlays: true, __configReady: true };

  const az = boot('www.amazon.co.uk');
  az.box.__WO_CONFIG__ = Object.assign({}, full);
  az.configChanged();
  check('Amazon compatibility mode survives the rewrite',
    az.WO.enabled === false && az.WO.__amazonCompatibilityMode === true && az.WO.removeOverlays === false);

  const yt = boot('www.youtube.com');
  yt.box.__WO_CONFIG__ = Object.assign({}, full);
  yt.configChanged();
  check('YouTube carve-outs survive the rewrite',
    yt.WO.enabled === false && yt.WO.adShield === true && yt.WO.scriptletEngine === true);

  // Re-deriving is the point: a config change on a carve-out site must re-apply the carve-out.
  yt.box.__WO_CONFIG__ = Object.assign({}, full, { adShield: false });
  yt.configChanged();
  check('a carve-out site re-derives on every config change',
    yt.WO.adShield === false && yt.WO.enabled === false,
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

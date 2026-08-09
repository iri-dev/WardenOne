/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * json-prune scriptlets used to stack. runScriptlets dedupes on name + args, so the same filter
 * runs once -- but two DIFFERENT json-prune filters for one host are two keys and two calls, and
 * each call replaced JSON.parse and Response.prototype.json around the previous wrapper. Four
 * filters meant four nested wrappers, each running its own 20,000-node walk on every parse, and
 * JSON.parse is on the critical path of essentially every modern web app. Multiple json-prune
 * rules per host are ordinary in real filter lists, so this was a silent, list-driven cliff.
 *
 * The hook is installed once now and the rules accumulate into a list the single wrapper walks.
 * This file drives the real lifted code: it counts how many times JSON.parse is replaced, and
 * checks every rule still applies.
 *
 * Run with:
 *   node tools/test-json-prune-stacking.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// Lift the walker, the budget and the prune scriptlet as one unit.
function liftPruneRuntime() {
  const from = SRC.indexOf('      scWalkBudget={');
  assert(from >= 0, 'scWalkBudget not found');
  const marker = '      scJsonPrune=(remove,';
  const at = SRC.indexOf(marker, from);
  assert(at > from, 'scJsonPrune not found');
  let depth = 0;
  let end = -1;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert(end > at, 'could not brace-match scJsonPrune');
  // The chain begins mid-declaration, so give it a `const` and terminate it.
  return 'const ' + SRC.slice(from, end + 1).replace(/^\s+/, '') + ';';
}

const RUNTIME = liftPruneRuntime();

function load(options) {
  const opts = options || {};
  const sandbox = {
    JSON: { parse: (text) => JSON.parse(text) },
    Object,
    String,
    Array,
    Number,
    Boolean,
    console,
    Response: { prototype: { json() { return Promise.resolve({}); } } },
    // The two gates the scriptlet consults.
    pageMutationScriptletRuntimeOn: () => opts.runtimeOn !== false,
    adShieldVideoPlatform: opts.videoPlatform === true,
    __replacements: 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(RUNTIME, sandbox, { filename: 'content.js:json-prune' });

  // Count every time JSON.parse is replaced -- that is the stacking this finding is about.
  vm.runInContext(`
    var __current = JSON.parse;
    Object.defineProperty(JSON, 'parse', {
      configurable: true,
      get: function () { return __current; },
      set: function (v) { __replacements++; __current = v; },
    });
  `, sandbox);

  return {
    sandbox,
    addRule: (remove, required) => vm.runInContext(
      'scJsonPrune(' + JSON.stringify(remove) + ',' + JSON.stringify(required || '') + ')', sandbox),
    replacements: () => vm.runInContext('__replacements', sandbox),
    parse: (obj) => {
      sandbox.__input = JSON.stringify(obj);
      return vm.runInContext('JSON.parse(__input)', sandbox);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. One hook, however many rules.
// ---------------------------------------------------------------------------
{
  const rt = load();
  rt.addRule('ads');
  check('the first rule installs the hook', rt.replacements() === 1, 'replacements=' + rt.replacements());
  rt.addRule('tracking');
  rt.addRule('promos');
  rt.addRule('adPlacements');
  check('three more rules do not wrap JSON.parse again',
    rt.replacements() === 1, 'replacements=' + rt.replacements());
}

// ---------------------------------------------------------------------------
// 2. All the rules still apply. Stacking was the cost; correctness has to survive removing it.
// ---------------------------------------------------------------------------
{
  const rt = load();
  rt.addRule('ads');
  rt.addRule('tracking');
  rt.addRule('promos');
  const out = rt.parse({ ads: 1, tracking: 2, promos: 3, content: 'keep' });
  check('every accumulated rule is applied',
    out.ads === undefined && out.tracking === undefined && out.promos === undefined,
    JSON.stringify(out));
  check('unrelated data is untouched', out.content === 'keep', JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 3. The `required` gate stays per-rule: a rule whose condition is absent must not fire, and must
//    not stop the others. Under the old nesting each wrapper gated itself, so this must not change.
// ---------------------------------------------------------------------------
{
  const rt = load();
  rt.addRule('ads', 'playerResponse');
  rt.addRule('tracking');
  const out = rt.parse({ ads: 1, tracking: 2 });
  check('a rule whose required path is missing does not remove anything',
    out.ads === 1, JSON.stringify(out));
  check('...and does not stop the other rules', out.tracking === undefined, JSON.stringify(out));

  const rt2 = load();
  rt2.addRule('ads', 'playerResponse');
  const out2 = rt2.parse({ ads: 1, playerResponse: { x: 1 } });
  check('a rule whose required path is present does remove',
    out2.ads === undefined, JSON.stringify(out2));
}

// ---------------------------------------------------------------------------
// 4. The guards. The video-platform bail is what keeps the known player hang away, and the
//    runtime gate must still short-circuit the walk.
// ---------------------------------------------------------------------------
{
  check('the video-platform guard is still in the scriptlet',
    /if\(adShieldVideoPlatform\)return;/.test(SRC) && MIN.includes('if(adShieldVideoPlatform)return;'));

  const rt = load({ videoPlatform: true });
  rt.addRule('adPlacements');
  check('on a video platform no hook is installed at all',
    rt.replacements() === 0, 'replacements=' + rt.replacements());

  const off = load({ runtimeOn: false });
  off.addRule('ads');
  const out = off.parse({ ads: 1 });
  check('with the runtime gate off the object is returned untouched', out.ads === 1, JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 5. The walk budget is reset once per parse, not once per rule. Four nested wrappers each reset
//    it, so four filters were allowed four times the walking on one object.
// ---------------------------------------------------------------------------
{
  const resets = (SRC.match(/scWalkBudget\.n=2e4;/g) || []).length;
  check('there is exactly one budget reset', resets === 1, resets + ' found');

  const rt = load();
  rt.addRule('a');
  rt.addRule('b');
  rt.addRule('c');
  // Instrument the budget so we can see how often it is reset during a single parse.
  vm.runInContext(`
    var __resets = 0, __n = 0;
    Object.defineProperty(scWalkBudget, 'n', {
      configurable: true,
      get: function () { return __n; },
      set: function (v) { if (v === 20000) __resets++; __n = v; },
    });
  `, rt.sandbox);
  rt.parse({ a: 1, b: 2, c: 3 });
  check('one parse resets the budget once regardless of rule count',
    vm.runInContext('__resets', rt.sandbox) === 1,
    'resets=' + vm.runInContext('__resets', rt.sandbox));
}

// ---------------------------------------------------------------------------
// 6. Response.prototype.json is hooked once too, and only alongside JSON.parse.
// ---------------------------------------------------------------------------
{
  const live = SRC.slice(SRC.indexOf('      scJsonPruneRules=['));
  const scriptlet = live.slice(0, live.indexOf('\n      sc') > 0 ? undefined : undefined);
  void scriptlet;
  check('Response.prototype.json is assigned once in the scriptlet',
    (SRC.match(/Response\.prototype\.json=function\(\)/g) || []).length === 1);
  check('...and guarded by the same install-once check',
    /if\(scJsonPruneRules\.length>1\)return;[\s\S]{0,500}Response\.prototype\.json=/.test(SRC));
  check('the shipped runtime wraps JSON.parse in exactly one place',
    (MIN.match(/JSON\.parse=function\(\)/g) || []).length === 1,
    (MIN.match(/JSON\.parse=function\(\)/g) || []).length + ' found');
}

if (failures) {
  console.error('[fail] json-prune stacking tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] json-prune stacking tests passed');

'use strict';

// Smart Script Shield, Script Drift and the Login Page Age check used to run three
// separate whole-document subtree MutationObservers on every top-level page, two of
// them for a full 60 seconds. They now share one.
//
// The bug that sharing invites is one subscriber's teardown killing the others: the
// login-age watcher unsubscribes from inside its own callback as soon as it has
// checked, and Script Drift unsubscribes on a 60s timer, but Smart Script Shield
// re-arms on popstate long afterwards and must still get its notifications. Most of
// this file exists to pin that.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

function lift(name) {
  const re = new RegExp('^\\s*(?:async )?function ' + name + '\\(', 'm');
  const m = re.exec(BRIDGE);
  assert(m, 'bridge.js no longer declares ' + name);
  const start = m.index + m[0].indexOf('function');
  let depth = 0;
  let seen = false;
  for (let i = start; i < BRIDGE.length; i++) {
    const ch = BRIDGE[i];
    if (ch === '{') { depth++; seen = true; } else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return BRIDGE.slice(start, i + 1);
    }
  }
  assert.fail('could not find the end of ' + name);
}

// The watcher constructs its observer through the bridge's teardown registry now, so the real
// registry is lifted in alongside it. Shimming woObserver would work, but a shim can agree with a
// broken implementation -- and the registry is small and self-contained enough to just include.
const REGISTRY_SRC = (function () {
  const from = BRIDGE.indexOf('  /* Everything this copy holds');
  const to = BRIDGE.indexOf('  // A per-page-load routing token.');
  if (from < 0 || to <= from) throw new Error('could not lift the bridge teardown registry');
  return BRIDGE.slice(from, to);
}());

const WATCHER_SRC = [
  REGISTRY_SRC,
  'const domWatchers = new Set();',
  'let domObserver = null;',
  'let domWatchPending = false;',
  lift('domWatchStart'),
  lift('domWatchStop'),
  lift('domWatch'),
].join('\n');

// A MutationObserver stand-in that records connect/disconnect and lets the test
// deliver batches by hand.
function makeSandbox() {
  const log = { constructed: 0, observed: 0, disconnected: 0, targets: [], options: [] };
  let live = null;

  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; log.constructed++; }
    observe(target, options) {
      log.observed++; log.targets.push(target); log.options.push(options);
      live = this;
    }
    disconnect() { log.disconnected++; if (live === this) live = null; }
  }

  const listeners = {};
  const sandbox = {
    console, Set, Array, Object, String, Number, Boolean, Error, JSON, setTimeout, clearTimeout,
    // Needed by the lifted teardown registry.
    AbortController,
    setInterval: () => 0,
    clearInterval() {},
    window: {},
    MutationObserver: FakeMutationObserver,
    document: {
      documentElement: { tag: 'HTML' },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    },
    __log: log,
    __fire(records) { if (live) live.cb(records || [{ addedNodes: [] }]); },
    __isConnected() { return !!live; },
    __dispatch(type) { (listeners[type] || []).forEach((f) => f()); },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(WATCHER_SRC, ctx);
  return { ctx, sandbox, log, run: (src) => vm.runInContext(src, ctx) };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// ---------------------------------------------------------------------------
// 1. One observer serves every subscriber.
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.hits = [0,0,0];');
  h.run('globalThis.u1 = domWatch(() => hits[0]++);');
  h.run('globalThis.u2 = domWatch(() => hits[1]++);');
  h.run('globalThis.u3 = domWatch(() => hits[2]++);');
  check('three subscribers construct ONE observer', h.log.constructed === 1, 'constructed ' + h.log.constructed);
  check('...and call observe() once', h.log.observed === 1, 'observed ' + h.log.observed);
  h.sandbox.__fire();
  check('one batch reaches all three', h.run('hits.join(",")') === '1,1,1', h.run('hits.join(",")'));
  check('observes the document element', h.log.targets[0] && h.log.targets[0].tag === 'HTML');
  check('with childList + subtree', h.log.options[0].childList === true && h.log.options[0].subtree === true);
}

// ---------------------------------------------------------------------------
// 2. THE regression the audit called out: one leaving must not stop the others.
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.hits = [0,0,0];');
  h.run('globalThis.u1 = domWatch(() => hits[0]++);');
  h.run('globalThis.u2 = domWatch(() => hits[1]++);');
  h.run('globalThis.u3 = domWatch(() => hits[2]++);');
  h.run('u2();');
  check('one unsubscribing does NOT disconnect the observer', h.sandbox.__isConnected() === true);
  check('...and does not disconnect at all', h.log.disconnected === 0, 'disconnected ' + h.log.disconnected);
  h.sandbox.__fire();
  check('the remaining two still receive batches', h.run('hits.join(",")') === '1,0,1', h.run('hits.join(",")'));
  h.run('u1();');
  h.sandbox.__fire();
  check('the last one still receives batches', h.run('hits.join(",")') === '1,0,2', h.run('hits.join(",")'));
  h.run('u3();');
  check('the LAST subscriber leaving disconnects it', h.log.disconnected === 1 && h.sandbox.__isConnected() === false);
}

// ---------------------------------------------------------------------------
// 3. Re-subscribing after everyone left reconnects (Smart Script Shield re-arms
//    on popstate, long after the other two are finished).
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.n = 0; globalThis.u = domWatch(() => n++);');
  h.run('u();');
  check('disconnected when the only subscriber left', h.sandbox.__isConnected() === false);
  h.run('globalThis.u2 = domWatch(() => n++);');
  check('a later subscriber reconnects', h.sandbox.__isConnected() === true);
  check('...constructing a second observer, not reusing a dead one', h.log.constructed === 2, 'constructed ' + h.log.constructed);
  h.sandbox.__fire();
  check('the re-armed subscriber receives batches', h.run('n') === 1, 'n=' + h.run('n'));
}

// ---------------------------------------------------------------------------
// 4. Unsubscribing from inside a callback (what the login-age watcher does).
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.a = 0; globalThis.b = 0;');
  h.run('globalThis.ua = domWatch(() => { a++; ua(); });');
  h.run('globalThis.ub = domWatch(() => b++);');
  h.sandbox.__fire();
  check('a self-unsubscribing callback runs once', h.run('a') === 1, 'a=' + h.run('a'));
  check('...and its neighbour was still called in the same batch', h.run('b') === 1, 'b=' + h.run('b'));
  check('...and the observer stays connected for the neighbour', h.sandbox.__isConnected() === true);
  h.sandbox.__fire();
  check('the self-unsubscribed one is not called again', h.run('a') === 1, 'a=' + h.run('a'));
  check('the neighbour keeps receiving', h.run('b') === 2, 'b=' + h.run('b'));
}

// ---------------------------------------------------------------------------
// 5. A throwing subscriber must not starve the rest.
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.ok = 0;');
  h.run('domWatch(() => { throw new Error("subscriber blew up"); });');
  h.run('domWatch(() => ok++);');
  h.sandbox.__fire();
  check('a throwing subscriber does not stop the others', h.run('ok') === 1, 'ok=' + h.run('ok'));
  check('...and does not disconnect the observer', h.sandbox.__isConnected() === true);
}

// ---------------------------------------------------------------------------
// 6. Double-unsubscribe is safe (both the 60s timer and the in-callback bail can
//    fire for the same subscription).
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.n = 0; globalThis.u = domWatch(() => n++); globalThis.keep = domWatch(() => {});');
  h.run('u(); u(); u();');
  check('calling unsubscribe three times disconnects nothing extra', h.log.disconnected === 0);
  check('...and the other subscriber survives', h.sandbox.__isConnected() === true);
  h.run('keep();');
  check('...then the last one disconnects exactly once', h.log.disconnected === 1, 'disconnected ' + h.log.disconnected);
}

// ---------------------------------------------------------------------------
// 7. Records are passed through -- Script Drift reads addedNodes.
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('globalThis.seen = null; domWatch((recs) => { seen = recs; });');
  h.sandbox.__fire([{ addedNodes: [{ nodeType: 1, tagName: 'SCRIPT' }] }]);
  check('mutation records reach the subscriber', h.run('Array.isArray(seen) && seen.length === 1'));
  check('...with addedNodes intact', h.run('seen[0].addedNodes[0].tagName') === 'SCRIPT');
}

// ---------------------------------------------------------------------------
// 8. No document element yet: defer, then start on DOMContentLoaded.
// ---------------------------------------------------------------------------
{
  const h = makeSandbox();
  h.run('document.documentElement = null;');
  h.run('globalThis.n = 0; domWatch(() => n++);');
  check('nothing is observed while there is no document element', h.log.observed === 0);
  h.run('document.documentElement = { tag: "HTML" };');
  h.sandbox.__dispatch('DOMContentLoaded');
  check('observation starts once the element exists', h.log.observed === 1, 'observed ' + h.log.observed);
  h.sandbox.__fire();
  check('...and the subscriber receives batches', h.run('n') === 1);
}

// ---------------------------------------------------------------------------
// 9. Source-level guards against the three observers coming back.
// ---------------------------------------------------------------------------
{
  const count = (BRIDGE.match(/new MutationObserver/g) || []).length;
  check('bridge.js constructs exactly one MutationObserver', count === 1, 'found ' + count);
  const subs = (BRIDGE.match(/domWatch\(/g) || []).length;
  check('all three guards subscribe through domWatch', subs >= 4, 'domWatch( occurrences: ' + subs);
  check('the smart-player guard no longer holds its own observer', !/smartPlayerObserver\b/.test(BRIDGE));
  check('the login-age guard no longer holds its own observer', !/laMo\b/.test(BRIDGE));
  check('domWatchStop only runs when the set is empty',
    /if \(!domWatchers\.size\) domWatchStop\(\)/.test(BRIDGE));
}

if (failures) {
  console.error('[fail] shared DOM watcher tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] shared DOM watcher tests');

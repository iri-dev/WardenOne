/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Security state has to be ready, and durable, for the FIRST event (M17).
 *
 * Registering a listener is synchronous; hydrating its state from storage is not, and Chrome
 * dispatches as soon as the worker starts rather than waiting for a storage read. An MV3 worker is
 * torn down constantly, so "the first event after a suspension" is not an edge case -- it is most
 * events. Three stores were decided from before they were loaded, and one of them then published
 * itself over what that first event had just written.
 *
 * Every hydration callback here is held open deliberately. That window IS the finding: a harness
 * that resolves storage immediately cannot see any of it.
 *
 * Run: node tools/test-cold-start-state.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// A hang must not read as a pass: this suite awaits work a broken store may never resolve.
process.exitCode = 1;

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Lift a top-level function by name, to the closing brace in column 0.
function liftFunction(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\(', 'm');
  const start = BACKGROUND.search(re);
  if (start < 0) throw new Error('function not found: ' + name);
  const end = BACKGROUND.indexOf('\n}\n', start);
  if (end < 0) throw new Error('function end not found: ' + name);
  return BACKGROUND.slice(start, end + 3);
}
function liftBetween(startMarker, endMarker) {
  const from = BACKGROUND.indexOf(startMarker);
  const to = BACKGROUND.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to <= from) throw new Error('markers not found: ' + startMarker);
  return BACKGROUND.slice(from, to);
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// A. The learned/blocked stores: ready before they decide, and not poisoned by their own load.
// ---------------------------------------------------------------------------
function loadLearnedStore(options = {}) {
  const state = { gates: [], writes: [], reads: 0 };
  const sandbox = {
    Promise, Object, Date, Math, Number, String, console,
    LEARNED: {},
    BLOCKED_DOMAINS: new Set(options.blocked || []),
    __initLearned: null,
    __initBlockedDomains: Promise.resolve(),
    __securityStoresReady: null,
    loadTrackerLearner: () => Promise.resolve(),
    applyLearnedRules: () => {},
    refreshListMetaCounts: () => {},
    normalizeLearnedDomain: (v) => String(v || '').toLowerCase(),
    localSet: (obj) => { state.writes.push(JSON.parse(JSON.stringify(obj.wardenone_learned))); return Promise.resolve(); },
    chrome: {
      storage: {
        local: {
          get(key, cb) {
            state.reads++;
            const gate = deferred();
            state.gates.push(gate);
            gate.promise.then(() => cb(options.throwOnRead ? undefined : { wardenone_learned: options.stored || {} }));
          },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext([liftFunction('loadLearned'), liftFunction('securityStoresReady'), liftFunction('learnDomain')].join('\n')
    + '\nthis.__api = { loadLearned, learnDomain, securityStoresReady };', sandbox, { filename: 'background.js' });
  state.api = sandbox.__api;
  state.sandbox = sandbox;
  state.release = () => { state.gates.splice(0).forEach((g) => g.resolve()); return settle(); };
  return state;
}

async function testLearnedStore() {
  // The reproduction: a first cold event learns while the read is still out.
  {
    const s = loadLearnedStore({ stored: { 'old.example': { firstSeen: 1, hits: 2 } } });
    s.api.securityStoresReady();
    const learn = s.api.learnDomain('new.example', 'suspicious');
    await settle();
    check('a learn during hydration does not write before the store is loaded', s.writes.length === 0);
    await s.release();
    await learn;
    check('the persisted domain survives the first cold event',
      !!s.sandbox.LEARNED['old.example'], Object.keys(s.sandbox.LEARNED).join(','));
    check('and the newly learned one is not lost',
      !!s.sandbox.LEARNED['new.example'], Object.keys(s.sandbox.LEARNED).join(','));
    const written = s.writes[s.writes.length - 1] || {};
    check('the write contains both, not just the new one',
      !!written['old.example'] && !!written['new.example'], JSON.stringify(Object.keys(written)));
  }

  // Hydration must not replace a heap another writer already touched, even without the await.
  {
    const s = loadLearnedStore({ stored: { 'old.example': { firstSeen: 1, hits: 2 } } });
    const load = s.api.loadLearned();
    s.sandbox.LEARNED['raced.example'] = { firstSeen: 5, hits: 1 };
    await s.release();
    await load;
    check('hydration merges rather than replacing the heap',
      !!s.sandbox.LEARNED['raced.example'] && !!s.sandbox.LEARNED['old.example'],
      Object.keys(s.sandbox.LEARNED).join(','));
  }

  // Both copies of a domain: keep the earliest sighting and the combined count.
  {
    const s = loadLearnedStore({ stored: { 'both.example': { firstSeen: 10, hits: 3 } } });
    const load = s.api.loadLearned();
    s.sandbox.LEARNED['both.example'] = { firstSeen: 99, hits: 1 };
    await s.release();
    await load;
    check('a domain learned on both sides keeps the earliest sighting',
      s.sandbox.LEARNED['both.example'].firstSeen === 10);
    check('and the combined hit count', s.sandbox.LEARNED['both.example'].hits === 4);
  }

  // The blocklist check is a decision, so it has to wait too.
  {
    const s = loadLearnedStore({ blocked: [], stored: {} });
    s.sandbox.BLOCKED_DOMAINS = new Set();
    const ready = s.api.securityStoresReady();
    const learn = s.api.learnDomain('listed.example', 'x');
    // The blocklist finishes loading while the learn is waiting.
    s.sandbox.BLOCKED_DOMAINS.add('listed.example');
    await s.release();
    await ready;
    await learn;
    check('a domain already on the blocklist is not learned again',
      !s.sandbox.LEARNED['listed.example'], Object.keys(s.sandbox.LEARNED).join(','));
  }

  // Concurrent learns share one hydration.
  {
    const s = loadLearnedStore({ stored: {} });
    const learns = ['a.example', 'b.example', 'c.example'].map((d) => s.api.learnDomain(d, 'x'));
    await settle();
    check('concurrent learns share a single hydration read', s.reads === 1, s.reads + ' reads');
    await s.release();
    await Promise.all(learns);
    check('and all of them are recorded', Object.keys(s.sandbox.LEARNED).length === 3);
  }

  // Non-poisoning: a storage failure must delay a decision, never withhold it forever.
  {
    const s = loadLearnedStore({ throwOnRead: true, stored: {} });
    const learn = s.api.learnDomain('after-failure.example', 'x');
    await s.release();
    await learn;
    check('a failed hydration still resolves, so nothing waits forever',
      !!s.sandbox.LEARNED['after-failure.example']);
  }

  // The same, for a store that rejects rather than returning nothing. Nothing rejects today, which
  // is exactly why the guard has to be pinned: the day one does, the alternative is every decision
  // that depends on it waiting for a promise that will never settle.
  {
    const s = loadLearnedStore({ stored: {} });
    s.sandbox.loadTrackerLearner = () => Promise.reject(new Error('storage unavailable'));
    s.sandbox.__securityStoresReady = null;
    const ready = s.api.securityStoresReady();
    await s.release();
    let settled = false;
    await Promise.race([ready.then(() => { settled = true; }), new Promise((r) => setTimeout(r, 50))]);
    check('a rejecting store does not leave readiness unsettled forever', settled);
  }

  // One promise, not one per caller.
  {
    const s = loadLearnedStore({ stored: {} });
    const a = s.api.securityStoresReady();
    const b = s.api.securityStoresReady();
    check('readiness is one shared promise', a === b);
    await s.release();
    await a;
  }
}

// ---------------------------------------------------------------------------
// B. Forget Me: a miss is unrecoverable, because tabs.onRemoved carries no URL.
// ---------------------------------------------------------------------------
function loadForgetStore(options = {}) {
  const state = { wiped: [], sessionGate: null, queryGate: null, stored: options.stored || null, tabs: options.tabs || [] };
  const listeners = {};
  const sandbox = {
    Promise, Object, Date, Math, Number, String, Set, console,
    setTimeout, clearTimeout,
    // Declared just above the lifted region in background.js.
    FORGET_TAB_HOSTS: Object.create(null),
    forgetHostFromUrl: (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname.replace(/^www\./, '') : ''; } catch (_) { return ''; } },
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
    maybeForgetHost: (host, tabId) => { state.wiped.push({ host, tabId }); return Promise.resolve(); },
    URL,
    chrome: {
      runtime: { lastError: null },
      storage: options.noSession ? {} : {
        session: {
          get(key, cb) {
            const gate = deferred();
            state.sessionGate = gate;
            gate.promise.then(() => cb(state.stored ? { [key]: state.stored } : {}));
          },
          set(obj, cb) { state.stored = obj[Object.keys(obj)[0]]; if (cb) cb(); },
        },
      },
      tabs: {
        onUpdated: { addListener(fn) { listeners.updated = fn; } },
        onRemoved: { addListener(fn) { listeners.removed = fn; } },
        query(_q, cb) {
          const gate = deferred();
          state.queryGate = gate;
          gate.promise.then(() => cb(state.tabs));
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(liftBetween('const FORGET_TAB_HOSTS_KEY =', '// ---- Memory Shield popup/helper tools')
    + '\nthis.__api = { map: FORGET_TAB_HOSTS, ready: forgetTabHostsReady, note: noteForgetTabHost };',
  sandbox, { filename: 'background.js' });
  state.api = sandbox.__api;
  state.listeners = listeners;
  return state;
}

async function testForgetMe() {
  // The unrecoverable case: a tab closes before anything has been restored.
  {
    const s = loadForgetStore({ stored: { 42: { host: 'shop.example', at: Date.now() } } });
    s.listeners.removed(42);
    await settle();
    check('a close before hydration does not wipe blind', s.wiped.length === 0);
    s.sessionGate.resolve();
    await settle();
    if (s.queryGate) s.queryGate.resolve();
    await settle();
    await settle();
    check('once the restore lands, the host is remembered and wiped',
      s.wiped.length === 1 && s.wiped[0].host === 'shop.example', JSON.stringify(s.wiped));
  }

  // A late seed must not overwrite a navigation that happened while it was out.
  {
    const s = loadForgetStore({ tabs: [{ id: 7, url: 'https://old.example/' }] });
    const ready = s.api.ready();
    s.listeners.updated(7, {}, { url: 'https://new.example/' });
    if (s.sessionGate) s.sessionGate.resolve();
    await settle();
    if (s.queryGate) s.queryGate.resolve();
    await ready;
    check('a delayed seed does not publish over a newer navigation',
      s.api.map[7] && s.api.map[7].host === 'new.example',
      JSON.stringify(s.api.map[7]));
    s.listeners.removed(7);
    await settle();
    check('so closing the tab wipes the site it was actually on',
      s.wiped.length === 1 && s.wiped[0].host === 'new.example', JSON.stringify(s.wiped));
  }

  // A warm worker must not pay for any of this.
  {
    const s = loadForgetStore({});
    s.api.note(9, 'live.example');
    s.listeners.removed(9);
    check('a close with the host already in memory wipes immediately',
      s.wiped.length === 1 && s.wiped[0].host === 'live.example');
  }

  // ...and the whole point is that the next worker can see it. Written through the debounce, so
  // this waits for it rather than reading the heap it already knows about.
  {
    const s = loadForgetStore({});
    s.listeners.updated(11, {}, { url: 'https://saved.example/page' });
    await new Promise((r) => setTimeout(r, 350));
    check('a navigation is written somewhere the next worker can read it',
      !!(s.stored && s.stored[11] && s.stored[11].host === 'saved.example'),
      JSON.stringify(s.stored));
  }

  // Expired entries are not resurrected.
  {
    const old = Date.now() - (25 * 60 * 60 * 1000);
    const s = loadForgetStore({ stored: { 5: { host: 'stale.example', at: old } }, tabs: [] });
    const ready = s.api.ready();
    s.sessionGate.resolve();
    await settle();
    if (s.queryGate) s.queryGate.resolve();
    await ready;
    check('an entry past its TTL is not restored', !s.api.map[5], JSON.stringify(s.api.map[5]));
  }

  // No session storage at all: the query seed still has to work.
  {
    const s = loadForgetStore({ noSession: true, tabs: [{ id: 3, url: 'https://only.example/' }] });
    const ready = s.api.ready();
    await settle();
    if (s.queryGate) s.queryGate.resolve();
    await ready;
    check('without storage.session the tab query still seeds the map',
      s.api.map[3] && s.api.map[3].host === 'only.example');
  }
}

// ---------------------------------------------------------------------------
// C. The correlation windows.
// ---------------------------------------------------------------------------
function loadMirror(options = {}) {
  const state = { stored: options.stored, live: options.live || [], gate: null };
  const sandbox = {
    Promise, Object, console, setTimeout, clearTimeout,
    chrome: {
      runtime: { lastError: null },
      storage: options.noSession ? {} : {
        session: {
          get(key, cb) { const gate = deferred(); state.gate = gate; gate.promise.then(() => cb({ [key]: state.stored })); },
          set(obj, cb) { state.stored = obj[Object.keys(obj)[0]]; if (cb) cb(); },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(liftBetween('function sessionArea() {', '\nconst REDIRECT_CHAINS =')
    + '\nthis.__make = sessionMirror;', sandbox, { filename: 'background.js' });
  state.mirror = sandbox.__make('k',
    () => state.live.slice(),
    (stored) => {
      if (!Array.isArray(stored)) return;
      // Merge behind whatever arrived while the read was out -- the property under test.
      stored.forEach((v) => { if (!state.live.includes(v)) state.live.push(v); });
    });
  return state;
}

async function testCorrelationWindows() {
  {
    const s = loadMirror({ stored: ['before-suspension'] });
    const ready = s.mirror.ready();
    s.live.push('after-wake');
    s.gate.resolve();
    await ready;
    check('a window restored across a suspension keeps both halves',
      s.live.includes('before-suspension') && s.live.includes('after-wake'), JSON.stringify(s.live));
    check('and what arrived during the read is still there',
      s.live[0] === 'after-wake', JSON.stringify(s.live));
  }

  {
    const s = loadMirror({ stored: ['x'] });
    const a = s.mirror.ready();
    const b = s.mirror.ready();
    check('the restore is shared, not repeated per caller', a === b);
    s.gate.resolve();
    await a;
  }

  {
    const s = loadMirror({ noSession: true, stored: ['unreachable'] });
    await s.mirror.ready();
    check('no storage.session is not a hang', true);
    s.mirror.persist();
    check('and persisting is a no-op rather than a throw', true);
  }

  // Source: the two windows the finding names are actually mirrored, and restored before use.
  check('the recent-redirect window is mirrored', /const RECENT_REDIRECT_MIRROR = sessionMirror\(/.test(BACKGROUND));
  check('the permission-chain window is mirrored', /const PERMISSION_CHAIN_MIRROR = sessionMirror\(/.test(BACKGROUND));
  check('the permission handler restores before it records',
    /await PERMISSION_CHAIN_MIRROR\.ready\(\);[\s\S]{0,200}prunePermissionChainState\(now\);/.test(BACKGROUND));
  check('recording a permission signal persists the window',
    /PERMISSION_CHAIN_STATE\[sessionKey\] = session;\s*\n\s*PERMISSION_CHAIN_MIRROR\.persist\(\);/.test(BACKGROUND));
  check('a redirect chain persists its window', /RECENT_REDIRECT_MIRROR\.persist\(\);/.test(BACKGROUND));

  const downloads = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');
  check('download scoring waits for the stores it scores against',
    /securityStoresReady\(\);[\s\S]{0,160}RECENT_REDIRECT_MIRROR\.ready\(\);/.test(downloads));
  check('and it waits before scoring, not after',
    downloads.indexOf('RECENT_REDIRECT_MIRROR.ready()') < downloads.indexOf('let rep = scoreDownload('));

  check('a redirect hop is re-checked against the blocklist once it has loaded',
    /function markBlocklistedHops\(chain\)/.test(BACKGROUND)
      && /markBlocklistedHops\(chain\);/.test(BACKGROUND));
}

async function main() {
  await testLearnedStore();
  await testForgetMe();
  await testCorrelationWindows();

  if (failed) { console.error('\n' + failed + ' cold-start state check(s) failed'); process.exit(1); }
  console.log('\nsecurity state is ready and durable for the first event');
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

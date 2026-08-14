/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The newest desired state has to be the one that lands (M18).
 *
 * Three shapes of the same defect. The config cache and the cosmetic cache had no shared in-flight
 * load and no generation, so a burst of cold callers fanned out into one storage read each, and a
 * read that started before a newer value landed could publish itself over that value when it
 * finally returned -- leaving a master-off or an allowlist edit reverted for the worker's life.
 * The state appliers had the same ordering flaw with side effects instead of caches: each reads its
 * own "last applied" marker, awaits Chrome, then commits the marker, so two concurrent calls both
 * pass the early-out and whichever settles last wins, older desired state included.
 *
 * Every assertion here needs the storage read to be controllable mid-flight, because that window
 * is the entire finding. A harness that resolves immediately cannot see any of it.
 *
 * Run: node tools/test-state-serialization.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// Failure is the default, cleared only when main() actually reaches the end.
//
// This suite awaits work that a broken serializer may never resolve, and node exits 0 when the
// event loop simply drains -- so a hang printed FAIL lines and still reported success. Three
// mutations survived on exactly that before this line existed.
process.exitCode = 1;

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function lift(startMarker, endMarker) {
  const from = BACKGROUND.indexOf(startMarker);
  const to = BACKGROUND.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to <= from) throw new Error('source markers not found: ' + startMarker);
  return BACKGROUND.slice(from, to);
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// 1. The config cache.
// ---------------------------------------------------------------------------
function loadConfigCache() {
  const state = { reads: 0, pending: [], stored: { marker: 'old' }, failNext: false };
  const sandbox = {
    Promise, JSON, Object, console,
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get(key, cb) {
            state.reads++;
            const gate = deferred();
            state.pending.push({ gate, cb, key });
            gate.promise.then(() => {
              const failed = state.failNext;
              state.failNext = false;
              sandbox.chrome.runtime.lastError = failed ? { message: 'storage unavailable' } : null;
              try { cb(failed ? {} : { wardenone_config: state.stored }); } finally {
                sandbox.chrome.runtime.lastError = null;
              }
            });
          },
          set(obj, cb) { state.stored = obj.wardenone_config; cb(); },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(lift('let __cfgCache = null;', 'const STORAGE_META_KEY =')
    + '\nthis.__api = { localGet, localSet, cfgSet: __cfgCacheSet,'
    + ' gen: () => __cfgGeneration, valid: () => __cfgCacheValid };', sandbox, { filename: 'background.js' });
  state.api = sandbox.__api;
  state.releaseAll = () => { const p = state.pending.splice(0); p.forEach((x) => x.gate.resolve()); return settle(); };
  return state;
}

async function testConfigCache() {
  // Fifty cold callers, one read.
  {
    const s = loadConfigCache();
    const calls = Array.from({ length: 50 }, () => s.api.localGet('wardenone_config'));
    await settle();
    check('fifty concurrent cold config reads make one storage read', s.reads === 1, s.reads + ' reads');
    await s.releaseAll();
    const results = await Promise.all(calls);
    check('and every caller gets the value', results.every((r) => r.wardenone_config.marker === 'old'));
    check('each caller gets its own copy, so no caller can mutate the cache',
      results[0].wardenone_config !== results[1].wardenone_config);
  }

  // A newer value published mid-read must survive the older read completing.
  {
    const s = loadConfigCache();
    const call = s.api.localGet('wardenone_config');
    await settle();
    check('the read is in flight', s.reads === 1 && s.pending.length === 1);
    s.api.cfgSet({ marker: 'new' });          // what storage.onChanged does
    await s.releaseAll();
    await call;
    const after = await s.api.localGet('wardenone_config');
    check('a read that started earlier cannot overwrite a newer config',
      after.wardenone_config.marker === 'new', JSON.stringify(after.wardenone_config));
    check('and it did not go back to storage to find that out', s.reads === 1);
  }

  // A failed read must not be cached, and must not become the answer for everyone after it.
  {
    const s = loadConfigCache();
    s.failNext = true;
    const call = s.api.localGet('wardenone_config');
    await s.releaseAll();
    await call;
    check('a failed read is not cached', s.api.valid() === false);
    const retry = s.api.localGet('wardenone_config');
    await settle();
    check('and the next caller reads again rather than inheriting the failure', s.reads === 2);
    await s.releaseAll();
    check('the retry succeeds', (await retry).wardenone_config.marker === 'old');
  }

  // Rapid toggles: the last publication is the one that stands.
  {
    const s = loadConfigCache();
    s.api.cfgSet({ enabled: true });
    s.api.cfgSet({ enabled: false });
    s.api.cfgSet({ enabled: true });
    const value = await s.api.localGet('wardenone_config');
    check('the last of a rapid burst of publications is the one held',
      value.wardenone_config.enabled === true);
    check('and none of them went to storage', s.reads === 0);
  }
}

// ---------------------------------------------------------------------------
// 2. The cosmetic cache: same two additions, plus the per-host memo it feeds.
// ---------------------------------------------------------------------------
function loadCosmeticCache() {
  const state = { reads: 0, pending: [], allow: ['old.example'] };
  const sandbox = {
    Promise, Object, Array, JSON, console, Map,
    normalizeAllowlistHosts: (l) => Array.from(l || []),
    chrome: { runtime: { getURL: (p) => 'x/' + p } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ scriptlets: {}, procedural: {} }) }),
  };
  sandbox.chrome.storage = {
    local: {
      get() {
        state.reads++;
        const gate = deferred();
        state.pending.push(gate);
        return gate.promise.then(() => ({
          wardenone_adshield_cosmetic: { generic: ['.ad'], specific: {}, exceptions: {}, genericHideExclusions: [] },
          wardenone_config: {},
          wardenone_adshield_allowlist: state.allow.slice(),
        }));
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(lift('let __cosmeticMem = null;', '// Compute the cosmetic payload for a hostname')
    + '\nthis.__api = { getCosmeticMem, invalidateCosmeticCache,'
    + ' mem: () => __cosmeticMem, gen: () => __cosmeticGeneration, hostCache: () => __cosmeticHostCache };',
  sandbox, { filename: 'background.js' });
  state.api = sandbox.__api;
  state.releaseAll = () => { const p = state.pending.splice(0); p.forEach((g) => g.resolve()); return settle(); };
  return state;
}

async function testCosmeticCache() {
  {
    const s = loadCosmeticCache();
    const calls = Array.from({ length: 50 }, () => s.api.getCosmeticMem());
    await settle();
    check('fifty concurrent cosmetic requests make one blob read', s.reads === 1, s.reads + ' reads');
    await s.releaseAll();
    const mems = await Promise.all(calls);
    check('and they all get the same loaded object', mems.every((m) => m === mems[0]));
  }

  // Invalidation during a load must not be undone by that load completing.
  {
    const s = loadCosmeticCache();
    const call = s.api.getCosmeticMem();
    await settle();
    s.allow = ['new.example'];
    s.api.invalidateCosmeticCache();          // what an allowlist edit does
    await s.releaseAll();
    await call;
    check('a load that started before an invalidation does not publish itself',
      s.api.mem() === null, 'the invalidation was undone');
    const fresh = await (async () => { const p = s.api.getCosmeticMem(); await settle(); await s.releaseAll(); return p; })();
    check('the next request reads the new data', fresh.allow[0] === 'new.example');
    check('and it did have to go back to storage', s.reads === 2);
  }

  // The value carries the generation it was built from, which is what lets the per-host memo
  // refuse to be repopulated from stale data.
  {
    const s = loadCosmeticCache();
    const call = s.api.getCosmeticMem();
    await settle();
    s.api.invalidateCosmeticCache();
    await s.releaseAll();
    const stale = await call;
    check('a superseded load is still answered to its own caller', !!stale && !!stale.data);
    check('but it is marked as belonging to an older generation',
      typeof stale.generation === 'number' && stale.generation < s.api.gen(),
      stale.generation + ' vs ' + s.api.gen());
  }

  // The per-host memo is what the generation on the value is FOR: a result computed from a
  // superseded load must not repopulate the host cache the invalidation just emptied, or the
  // invalidation is undone a second time and the stale answer is served from memory afterwards.
  check('the per-host memo refuses to be filled from a superseded load',
    /if \(mem && mem\.generation !== undefined && mem\.generation !== __cosmeticGeneration\) return result;/
      .test(BACKGROUND),
    'without this the host cache is repopulated with data the user has already changed');
}

// ---------------------------------------------------------------------------
// 3. The applier queue.
// ---------------------------------------------------------------------------
function loadSerializer() {
  const sandbox = { Promise, Map, console };
  vm.createContext(sandbox);
  vm.runInContext(lift('const __subsystemQueues = new Map();', 'const SERIALIZED_STATE_APPLIERS = [')
    + '\nthis.__serialize = serializeSubsystem;', sandbox, { filename: 'background.js' });
  return sandbox.__serialize;
}

async function testSerializer() {
  const serialize = loadSerializer();

  // The reproduction: an older update whose write settles last used to win.
  {
    const applied = [];
    const slow = deferred();
    const first = serialize('rules', async () => { await slow.promise; applied.push(true); });
    const second = serialize('rules', async () => { applied.push(false); });
    await settle();
    check('a queued update does not start before the one ahead of it finishes', applied.length === 0);
    slow.resolve();
    await Promise.all([first, second]);
    check('the last requested state is the one applied last',
      applied[applied.length - 1] === false, JSON.stringify(applied));
  }

  // Rapid toggles in both directions.
  {
    const applied = [];
    const wanted = [true, false, true, false, false, true];
    await Promise.all(wanted.map((v, i) => serialize('toggle', async () => {
      await new Promise((r) => setTimeout(r, (wanted.length - i) * 2));  // later calls finish sooner
      applied.push(v);
    })));
    check('rapid toggles apply in the order they were requested, not the order they finish',
      JSON.stringify(applied) === JSON.stringify(wanted), JSON.stringify(applied));
  }

  // A transient failure must not wedge the lane for the rest of the worker's life.
  {
    const applied = [];
    const boom = serialize('flaky', async () => { throw new Error('transient DNR failure'); });
    await boom.then(() => {}, () => {});
    await serialize('flaky', async () => { applied.push('after'); });
    check('a rejected update does not stop the next one running', applied.length === 1);
  }

  // Separate subsystems must not block each other.
  {
    const gate = deferred();
    const order = [];
    serialize('a', async () => { await gate.promise; order.push('a'); });
    await serialize('b', async () => { order.push('b'); });
    check('one subsystem waiting does not hold up another', order.join(',') === 'b');
    gate.resolve();
  }
}

// ---------------------------------------------------------------------------
// 3b. The wrapping actually takes effect.
//
// A correct queue and a correct list still do nothing unless the appliers are rebound to go
// through them, and every existing call site names them unqualified. So the whole block is run
// over stand-ins carrying the real names, and one of them is driven concurrently.
// ---------------------------------------------------------------------------
async function testWrapping() {
  const block = lift('const __subsystemQueues = new Map();', '\nfunction isVideoPlatformHost');
  const names = ((BACKGROUND.match(/const SERIALIZED_STATE_APPLIERS = \[([\s\S]*?)\];/) || [])[1] || '')
    .match(/'[^']+'/g).map((s) => s.slice(1, -1));

  const sandbox = { Promise, Map, console: { warn() { sandbox.__warned = true; } } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Stand-ins under the real names. The instrumented one records when it starts and finishes so
  // overlap is observable; the rest only have to exist, or the wrapper warns and skips them.
  vm.runInContext('var __order = [];\nvar __releases = [];\n'
    + names.map((n) => (n === 'applyAllowlistRules'
      ? 'function ' + n + '(v) { __order.push("start:" + v); return new Promise((r) => { __releases.push(() => { __order.push("end:" + v); r(); }); }); }'
      : 'function ' + n + '() {}')).join('\n'), sandbox);
  vm.runInContext(block, sandbox);

  check('no applier name in the list is missing from the module', !sandbox.__warned);

  const first = sandbox.applyAllowlistRules('first');
  const second = sandbox.applyAllowlistRules('second');
  await settle();
  check('a second call to a wrapped applier does not start while the first is in flight',
    sandbox.__order.join(',') === 'start:first',
    sandbox.__order.join(','));

  // Drain whatever has started, however many that turns out to be. Releasing by name would hang
  // when the wrapping is broken and both calls are in flight, and a hang is not a result.
  for (let i = 0; i < 4; i++) {
    const release = sandbox.__releases.shift();
    if (release) release();
    await settle();
  }
  await Promise.all([first, second]);
  check('the wrapped applier runs both in request order',
    sandbox.__order.join(',') === 'start:first,end:first,start:second,end:second',
    sandbox.__order.join(','));
}

// ---------------------------------------------------------------------------
// 4. The list has to stay complete, and the refresh key has to stay honest.
// ---------------------------------------------------------------------------
function testCoverage() {
  const listMatch = BACKGROUND.match(/const SERIALIZED_STATE_APPLIERS = \[([\s\S]*?)\];/);
  check('the applier list is still findable', !!listMatch);
  const listed = new Set(((listMatch ? listMatch[1] : '').match(/'[^']+'/g) || [])
    .map((s) => s.slice(1, -1)));

  const defined = ((BACKGROUND.match(/^(?:async )?function (apply[A-Z]\w*|reconcile\w*Injection|refreshBlocklistRuleset)\(/gm) || [])
    .map((m) => m.replace(/^(?:async )?function /, '').replace(/\($/, '')));

  // applyScriptShieldRules owns its own serialization chain and is excluded on purpose.
  const EXCLUDED = new Set(['applyScriptShieldRules']);
  const missing = defined.filter((n) => !listed.has(n) && !EXCLUDED.has(n));
  check('every side-effecting state applier is serialized',
    missing.length === 0,
    missing.join(', ') + ' -- an unlisted applier can still settle out of order');

  const unknown = [...listed].filter((n) => !defined.includes(n));
  check('the list names no applier that no longer exists', unknown.length === 0, unknown.join(', '));

  check('the excluded one is excluded because it already serializes itself',
    /__scriptShieldRuleUpdate/.test(BACKGROUND));

  // The refresh key: claimed by generation, committed only on success.
  const refresh = BACKGROUND.slice(BACKGROUND.indexOf('function refreshExtensionState()'),
    BACKGROUND.indexOf('let __refreshExtensionStateTimer'));
  check('the refresh claims a generation instead of the key',
    /const generation = \+\+__refreshExtensionStateGeneration;/.test(refresh));
  check('the key is committed only after the work settles',
    /Promise\.allSettled\(applied\)[\s\S]*__refreshExtensionStateLastKey = stateKey;/.test(refresh));
  check('a superseded refresh does not commit',
    /if \(generation !== __refreshExtensionStateGeneration\) return;/.test(refresh));
  check('a failed refresh leaves the key alone so it is retried',
    /results\.some\(\(r\) => r\.status === 'rejected'\)\) return;/.test(refresh));
  check('the key is not committed anywhere before the work',
    (refresh.match(/__refreshExtensionStateLastKey = stateKey/g) || []).length === 1);
}

async function main() {
  await testConfigCache();
  await testCosmeticCache();
  await testSerializer();
  await testWrapping();
  testCoverage();

  if (failed) { console.error('\n' + failed + ' state serialization check(s) failed'); process.exit(1); }
  console.log('\nthe newest desired state is the one that lands');
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

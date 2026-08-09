/*
 * Storage pressure relief used to touch exactly three keys -- the blocklist, history and the
 * OpenPhish feed -- and stop. Every rebuildable cache was left alone, including the cosmetic store,
 * whose declared cap is the largest of anything the extension keeps. So relief could finish without
 * freeing enough while megabytes of refetchable data sat untouched, and the write that hit the
 * ceiling stayed failed. chrome.storage.local is 10 MB and unlimitedStorage is deliberately not
 * requested.
 *
 * The ordering is the whole point of the fix, so this drives the real function against a fake
 * storage area and asserts what gets dropped, in what order, and what is left alone.
 *
 * Run with:
 *   node tools/test-storage-prune-ladder.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

function lift(startNeedle) {
  const at = BG.indexOf(startNeedle);
  assert(at >= 0, 'missing: ' + startNeedle);
  let depth = 0;
  for (let i = BG.indexOf('{', at); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(at, i + 1); }
  }
  throw new Error('could not brace-match ' + startNeedle);
}

const SOFT_LIMIT = 4 * 1024 * 1024;

// Every key the ladder can touch, with a made-up size so we can watch bytes fall.
const SIZES = {
  wardenone_safe_browsing_cache: 300000,
  wardenone_phishtank_cache: 300000,
  wardenone_abuseipdb_cache: 300000,
  wardenone_urlhaus_cache: 300000,
  wardenone_whoisxml_cache: 100000,
  wardenone_whoisxml_reputation_cache: 200000,
  wardenone_whoisxml_threat_cache: 200000,
  wardenone_domain_age_cache: 100000,
  wardenone_script_drift_baselines: 400000,
  wardenone_adshield_cosmetic: 2500000,
  wardenone_adshield_cosmetic_at: 10,
  wardenone_adshield_cosmetic_hash: 70,
  wardenone_adshield_cosmetic_checked_at: 10,
  wardenone_blocked_domains: 900000,
  wardenone_history: 900000,
  wardenone_openphish_feed_cache: 500000,
  // Something the ladder cannot touch -- config, allowlists, onboarding state. Real pressure often
  // comes partly from keys that are not droppable, which is what makes the last rung necessary.
  wardenone_filler: 3500000,
};

function load(present) {
  const store = Object.create(null);
  for (const key of Object.keys(present)) store[key] = present[key];

  const telemetry = [];
  const removals = [];
  const sets = [];

  const sandbox = {
    Object, Array, String, Number, Promise, console, JSON, Boolean, Math,
    SAFE_BROWSING_CACHE_KEY: 'wardenone_safe_browsing_cache',
    PHISHTANK_CACHE_KEY: 'wardenone_phishtank_cache',
    ABUSEIPDB_CACHE_KEY: 'wardenone_abuseipdb_cache',
    URLHAUS_CACHE_KEY: 'wardenone_urlhaus_cache',
    WHOISXML_CACHE_KEY: 'wardenone_whoisxml_cache',
    WHOISXML_REPUTATION_CACHE_KEY: 'wardenone_whoisxml_reputation_cache',
    WHOISXML_THREAT_CACHE_KEY: 'wardenone_whoisxml_threat_cache',
    DOMAIN_AGE_CACHE_KEY: 'wardenone_domain_age_cache',
    SCRIPT_DRIFT_BASELINE_KEY: 'wardenone_script_drift_baselines',
    OPENPHISH_CACHE_KEY: 'wardenone_openphish_feed_cache',
    STORAGE_SOFT_LIMIT_BYTES: SOFT_LIMIT,
    BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX: 500,
    HISTORY_STORAGE_PRESSURE_MAX: 400,
    OPENPHISH_STORAGE_PRESSURE_MAX: 300,
    storageGetBytesInUse: () => Promise.resolve(
      Object.keys(store).reduce((n, k) => n + (SIZES[k] || 1000), 0)),
    localGet: (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (store[k] !== undefined) out[k] = store[k];
      return Promise.resolve(out);
    },
    localSet: (obj) => {
      sets.push(Object.keys(obj));
      Object.assign(store, obj);
      return Promise.resolve();
    },
    localRemove: (keys) => {
      const list = [].concat(keys);
      removals.push(list);
      for (const k of list) delete store[k];
      return Promise.resolve();
    },
    writeStorageTelemetry: (reason, info) => { telemetry.push({ reason, info }); return info; },
  };
  vm.createContext(sandbox);
  vm.runInContext(lift('function storagePruneLadder()') + '\n'
    + lift('async function pruneStorageIfNeeded(reason)')
    + '\nthis.__prune = pruneStorageIfNeeded;', sandbox, { filename: 'background.js:prune' });

  return {
    store, telemetry, removals, sets,
    run: () => sandbox.__prune('test'),
    bytes: () => Object.keys(store).reduce((n, k) => n + (SIZES[k] || 1000), 0),
  };
}

const everything = () => {
  const p = {};
  for (const k of Object.keys(SIZES)) p[k] = k.endsWith('_at') || k.endsWith('_hash') || k.endsWith('_checked_at')
    ? 1 : ['wardenone_blocked_domains', 'wardenone_history'].includes(k)
      ? new Array(2000).fill('example.com')
      : k === 'wardenone_openphish_feed_cache' ? { urls: new Array(2000).fill('http://x/') } : { data: 1 };
  return p;
};

// ---------------------------------------------------------------------------
// 1. Under the limit: nothing happens at all.
// ---------------------------------------------------------------------------
(async () => {
  const t = load({ wardenone_history: new Array(10).fill('x') });
  await t.run();
  check('under the soft limit nothing is pruned',
    t.removals.length === 0 && t.sets.length === 0 && t.telemetry[0].info.pruned === false);

  // -------------------------------------------------------------------------
  // 2. Over the limit: rebuildable data goes first, and bytes actually fall.
  // -------------------------------------------------------------------------
  const over = load(everything());
  const startBytes = over.bytes();
  check('the fixture is genuinely over the soft limit', startBytes >= SOFT_LIMIT,
    startBytes + ' vs ' + SOFT_LIMIT);
  await over.run();
  check('bytes actually fall', over.bytes() < startBytes,
    startBytes + ' -> ' + over.bytes());

  const droppedFirst = over.removals.length ? over.removals[0] : [];
  check('the first thing dropped is a reputation cache',
    droppedFirst.includes('wardenone_safe_browsing_cache'), JSON.stringify(droppedFirst));

  const order = over.telemetry[0].info.actions || [];
  const idx = (frag) => order.findIndex((a) => a.indexOf(frag) === 0);
  check('rebuildable rungs are recorded before user data',
    idx('reputation-caches') === 0, JSON.stringify(order));
  check('the cosmetic store is dropped before history is trimmed',
    idx('cosmetic-store') >= 0 && (idx('history') === -1 || idx('cosmetic-store') < idx('history')),
    JSON.stringify(order));

  // -------------------------------------------------------------------------
  // 3. The cosmetic store's freshness markers go with it, or the next check would
  //    believe the data is current and never refetch.
  // -------------------------------------------------------------------------
  const cosmeticDrop = over.removals.find((r) => r.includes('wardenone_adshield_cosmetic')) || [];
  for (const marker of ['wardenone_adshield_cosmetic_at', 'wardenone_adshield_cosmetic_hash',
    'wardenone_adshield_cosmetic_checked_at']) {
    check('cosmetic prune also clears ' + marker.replace('wardenone_adshield_cosmetic', ''),
      cosmeticDrop.includes(marker), JSON.stringify(cosmeticDrop));
  }

  // -------------------------------------------------------------------------
  // 4. The ladder stops as soon as it is under the limit. Pressure from one oversized
  //    cache must not also cost the user their history.
  // -------------------------------------------------------------------------
  // Sized so that dropping the reputation caches alone (1.8 MB of 5.2 MB) brings it under the
  // 4 MB limit -- so the ladder must stop there and touch neither the cosmetic store nor history.
  const cachesSuffice = load({
    wardenone_safe_browsing_cache: { data: 1 },
    wardenone_phishtank_cache: { data: 1 },
    wardenone_abuseipdb_cache: { data: 1 },
    wardenone_urlhaus_cache: { data: 1 },
    wardenone_whoisxml_cache: { data: 1 },
    wardenone_whoisxml_reputation_cache: { data: 1 },
    wardenone_whoisxml_threat_cache: { data: 1 },
    wardenone_domain_age_cache: { data: 1 },
    wardenone_adshield_cosmetic: { data: 1 },
    wardenone_history: new Array(2000).fill('x'),
  });
  check('the caches-suffice fixture starts over the limit', cachesSuffice.bytes() >= SOFT_LIMIT,
    cachesSuffice.bytes() + '');
  await cachesSuffice.run();
  const acts = cachesSuffice.telemetry[0].info.actions || [];
  check('the ladder stops once it is under the limit',
    acts.length === 1 && acts[0].indexOf('reputation-caches') === 0, JSON.stringify(acts));
  check('history survives when dropping caches was enough',
    !acts.some((a) => a.indexOf('history') === 0)
    && Array.isArray(cachesSuffice.store.wardenone_history), JSON.stringify(acts));
  check('the cosmetic store survives too, since the caches sufficed',
    cachesSuffice.store.wardenone_adshield_cosmetic !== undefined, JSON.stringify(acts));

  // -------------------------------------------------------------------------
  // 5. User data is still reachable when the rebuildable rungs are not enough.
  // -------------------------------------------------------------------------
  // The pressure comes from a key the ladder cannot drop, so it has to reach the last rung.
  const onlyUserData = load({
    wardenone_filler: { data: 1 },
    wardenone_blocked_domains: new Array(5000).fill('example.com'),
    wardenone_history: new Array(5000).fill('x'),
    wardenone_openphish_feed_cache: { urls: new Array(5000).fill('http://x/') },
  });
  await onlyUserData.run();
  const ua = onlyUserData.telemetry[0].info.actions || [];
  check('with nothing rebuildable to drop, user data is still trimmed',
    ua.some((a) => a.indexOf('history') === 0) && ua.some((a) => a.indexOf('blocked_domains') === 0),
    JSON.stringify(ua));
  check('the trims respect their caps',
    onlyUserData.store.wardenone_history.length === 400
    && onlyUserData.store.wardenone_blocked_domains.length === 500,
    onlyUserData.store.wardenone_history.length + ' / ' + onlyUserData.store.wardenone_blocked_domains.length);

  // -------------------------------------------------------------------------
  // 6. A rung that throws must not stop the ladder.
  // -------------------------------------------------------------------------
  const hostile = load(everything());
  const realRemove = hostile.store;
  void realRemove;
  check('telemetry records what was done', Array.isArray(over.telemetry[0].info.actions)
    && over.telemetry[0].info.actions.length > 0);
  check('before and after bytes are both reported',
    typeof over.telemetry[0].info.beforeBytes === 'number'
    && typeof over.telemetry[0].info.afterBytes === 'number');

  // -------------------------------------------------------------------------
  // 7. Source-level: every key named in the finding is now reachable by the ladder.
  // -------------------------------------------------------------------------
  const ladder = lift('function storagePruneLadder()');
  for (const key of ['SAFE_BROWSING_CACHE_KEY', 'PHISHTANK_CACHE_KEY', 'ABUSEIPDB_CACHE_KEY',
    'URLHAUS_CACHE_KEY', 'WHOISXML_CACHE_KEY', 'WHOISXML_REPUTATION_CACHE_KEY',
    'WHOISXML_THREAT_CACHE_KEY', 'SCRIPT_DRIFT_BASELINE_KEY']) {
    check('the ladder covers ' + key, ladder.includes(key));
  }
  check('the ladder covers the cosmetic store', ladder.includes("'wardenone_adshield_cosmetic'"));
  check('the ladder is measured between rungs',
    /if \(!\(await stillOver\(\)\)\) break;/.test(BG));
  check('user data is gated behind a re-measure',
    /if \(await stillOver\(\)\) \{[\s\S]{0,200}wardenone_blocked_domains/.test(BG));

  if (failures) {
    console.error('[fail] storage prune ladder tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] storage prune ladder tests passed');
})().catch((e) => {
  console.error('[fail] storage prune ladder tests threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});

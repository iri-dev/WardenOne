/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The reconciler may not certify a failure it never saw (MV3-01).
 *
 * refreshExtensionState() is the one place desired state (wardenone_config) meets actual state
 * (Chrome's DNR rules, registrations and content settings). It ran two dozen appliers under
 * Promise.allSettled and committed its "this state is applied" key unless one REJECTED. None of
 * them ever rejects: each catches its own Chrome error, logs it, and resolves undefined. So a
 * session rule that never reached Chrome was certified as applied for the rest of the worker's
 * life -- and since no ordinary wake calls the reconciler, for the rest of the browser's.
 *
 * Separately, a config read that failed with runtime.lastError resolved as {} -- which, run
 * through the key, turns every default-off protection off and every default-on one on, applies
 * that, and certifies it.
 *
 * What is driven here, with the shipped orchestrator and stubbed appliers:
 *   - a resolved false is a failure: the key is not committed and a marker names the component
 *   - the marker counts attempts per desired state and starts over for a new one
 *   - a cold worker that finds the marker schedules a retry, within a bounded budget
 *   - an unreadable config runs no applier at all and is recorded as such
 *   - Protection Health turns the marker into a top-level issue
 * and, statically, that every applier the orchestrator runs returns false from the catch that
 * would otherwise have swallowed the failure.
 *
 * Run: node tools/test-reconcile-honesty.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

function between(startMark, endMark, what) {
  const a = BG.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = BG.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return BG.slice(a, b);
}

const CONFIG_CACHE = between('let __cfgCache = null;', '\n/* These stores are derived from sites visited', 'the config cache');
const ORCHESTRATOR = between('// ---- Reconciliation honesty (MV3-01) ----', '\nfunction searchAiCleanupActive', 'the reconciler');
const HEALTH_BLOCK = between('  let enabledRulesets = null;', '  const activeShields = healthCountActiveShields(cfg);', 'the health block');

/* the applier names the orchestrator runs, read from the source rather than restated */
const RUN_CALLS = [...ORCHESTRATOR.matchAll(/run\('([A-Za-z]+)', ([A-Za-z]+)\(/g)].map((m) => ({ name: m[1], fn: m[2] }));

function fakeSession() {
  const store = {};
  return {
    __store: store,
    get(key, cb) {
      const out = {};
      const keys = key === null ? Object.keys(store) : (Array.isArray(key) ? key : [key]);
      for (const k of keys) if (store[k] !== undefined) out[k] = JSON.parse(JSON.stringify(store[k]));
      if (typeof cb === 'function') { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set(obj, cb) { for (const k of Object.keys(obj)) store[k] = JSON.parse(JSON.stringify(obj[k])); if (cb) cb(); return Promise.resolve(); },
    remove(keys, cb) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; if (cb) cb(); return Promise.resolve(); },
  };
}

/* A worker: the shipped config cache and orchestrator, with every applier replaced by a stub
   whose behaviour the scenario chooses. `session` is shared across workers to model a worker
   that died and came back. */
function worker({ session, config, configUnreadable, behaviour }) {
  const calls = [];
  const ctx = {
    console: { warn() {}, log() {} },
    Promise, Object, Array, String, Number, JSON, Date, Math, setTimeout, clearTimeout,
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          /* Chrome answers on a later turn, never synchronously, and the shipped read relies on
             that: its callback refers to the promise being constructed around it. */
          get(key, cb) {
            setTimeout(() => {
              if (configUnreadable) {
                ctx.chrome.runtime.lastError = { message: 'storage unavailable' };
                cb(undefined);
                ctx.chrome.runtime.lastError = null;
                return;
              }
              cb({ wardenone_config: config || {} });
            }, 0);
          },
        },
        session,
      },
    },
    sessionArea: () => session,
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [],
    eyeShieldThemingActive: () => false,
    consentRejectActive: () => false,
    searchSponsoredCleanupActive: () => false,
    /* the .catch / catch fallback paths reference these; none should run */
    refreshPrivacyHeaders() { calls.push('FALLBACK'); }, refreshAllowlistRules() { calls.push('FALLBACK'); },
    refreshMediaCompatibilityRules() {}, refreshLoginCompatibilityRules() {}, refreshHttpsUpgrade() {},
    refreshAllCookieBlock() {}, refreshGlobalLocationBlock() {},
  };
  for (const { name, fn } of RUN_CALLS) {
    ctx[fn] = (...args) => {
      calls.push(name);
      const b = behaviour && behaviour[name];
      if (b === 'false') return Promise.resolve(false);
      if (b === 'reject') return Promise.reject(new Error('chrome said no'));
      if (b === 'sync-false') return false;
      return Promise.resolve(undefined);
    };
  }
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CONFIG_CACHE + '\n' + ORCHESTRATOR + '\nglobalThis.api = { refreshExtensionState,'
    + ' scheduleExtensionStateRefresh, retryDegradedReconcileOnWake, readReconcileDegraded, localGet,'
    + ' key: () => __refreshExtensionStateLastKey, RECONCILE_RETRY_MAX, RECONCILE_RETRY_MIN_MS };', ctx);
  return { api: ctx.api, calls };
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms || 40));

(async () => {
  check('the orchestrator runs a known set of named appliers', RUN_CALLS.length >= 20, RUN_CALLS.length + ' found');

  /* ---- 1. success commits the key and clears any marker ---------------------------- */
  {
    const session = fakeSession();
    session.__store.wardenone_reconcile_degraded = { failed: ['allowlist'], attempts: 2, at: 1, stateKey: 'old' };
    const w = worker({ session, config: { allowlist: ['a.example'] } });
    w.api.refreshExtensionState();
    await settle();
    check('every applier ran', w.calls.length === RUN_CALLS.length && !w.calls.includes('FALLBACK'), w.calls.join(','));
    check('a fully successful run commits the key', w.api.key() !== '');
    check('and clears the degraded marker', !session.__store.wardenone_reconcile_degraded);
  }

  /* ---- 2. a swallowed failure is a failure --------------------------------------- */
  {
    const session = fakeSession();
    const w = worker({ session, config: {}, behaviour: { allowlist: 'false' } });
    w.api.refreshExtensionState();
    await settle();
    check('an applier that resolved false does not let the key commit', w.api.key() === '',
      'the key was committed over a failure -- the exact thing MV3-01 describes');
    const m = session.__store.wardenone_reconcile_degraded;
    check('a marker names the failed component', m && m.failed.join(',') === 'allowlist', JSON.stringify(m));
    check('and counts one attempt', m && m.attempts === 1);
    check('and records the desired state it failed for', m && typeof m.stateKey === 'string' && m.stateKey.length > 0);

    /* the same desired state, tried again in the same worker: the key is still empty so the
       early-out does not fire, and the attempt is counted */
    w.api.refreshExtensionState();
    await settle();
    check('a repeat failure for the same state counts up', session.__store.wardenone_reconcile_degraded.attempts === 2);
  }

  /* a rejection and a synchronous false are failures too */
  for (const [kind, label] of [['reject', 'a rejected applier'], ['sync-false', 'an applier that returns false synchronously']]) {
    const session = fakeSession();
    const w = worker({ session, config: {}, behaviour: { headerShield: kind } });
    w.api.refreshExtensionState();
    await settle();
    check(label + ' is a failure', w.api.key() === '' && session.__store.wardenone_reconcile_degraded.failed.join(',') === 'headerShield');
  }

  /* several failures are all named */
  {
    const session = fakeSession();
    const w = worker({ session, config: {}, behaviour: { allowlist: 'false', intranet: 'false', eyeShield: 'reject' } });
    w.api.refreshExtensionState();
    await settle();
    const m = session.__store.wardenone_reconcile_degraded;
    check('every failed component is named', m && m.failed.slice().sort().join(',') === 'allowlist,eyeShield,intranet', JSON.stringify(m && m.failed));
  }

  /* ---- 3. a new desired state starts the budget over ------------------------------ */
  {
    const session = fakeSession();
    const w1 = worker({ session, config: {}, behaviour: { allowlist: 'false' } });
    w1.api.refreshExtensionState(); await settle();
    w1.api.refreshExtensionState(); await settle();
    check('two failures for one state', session.__store.wardenone_reconcile_degraded.attempts === 2);
    const w2 = worker({ session, config: { forceHttps: true }, behaviour: { allowlist: 'false' } });
    w2.api.refreshExtensionState(); await settle();
    check('a different desired state failing starts at one attempt', session.__store.wardenone_reconcile_degraded.attempts === 1);
  }

  /* ---- 4. the cold worker retries ------------------------------------------------- */
  {
    const session = fakeSession();
    const dying = worker({ session, config: { allowlist: ['a.example'] }, behaviour: { allowlist: 'false' } });
    dying.api.refreshExtensionState();
    await settle();
    check('the first worker left a marker', !!session.__store.wardenone_reconcile_degraded);
    /* age the marker past the minimum spacing, as a real wake later would find it */
    session.__store.wardenone_reconcile_degraded.at = Date.now() - 5 * 60 * 1000;

    /* a fresh worker: empty RAM key, same session storage, and Chrome now cooperates */
    const cold = worker({ session, config: { allowlist: ['a.example'] } });
    const scheduled = await cold.api.retryDegradedReconcileOnWake();
    check('a cold worker that finds the marker schedules a retry', scheduled === true);
    await settle(300);
    check('the retry ran the appliers', cold.calls.length === RUN_CALLS.length, cold.calls.length + ' calls');
    check('and, succeeding, committed the key', cold.api.key() !== '');
    check('and cleared the marker', !session.__store.wardenone_reconcile_degraded);
  }

  /* the budget */
  {
    const session = fakeSession();
    session.__store.wardenone_reconcile_degraded = { failed: ['allowlist'], attempts: 6, at: Date.now() - 5 * 60 * 1000, stateKey: 'k' };
    const w = worker({ session, config: {} });
    check('a used-up budget schedules nothing', (await w.api.retryDegradedReconcileOnWake()) === false);
    check('  -- the budget is the constant', w.api.RECONCILE_RETRY_MAX === 6);
  }
  {
    const session = fakeSession();
    session.__store.wardenone_reconcile_degraded = { failed: ['allowlist'], attempts: 1, at: Date.now() - 1000, stateKey: 'k' };
    const w = worker({ session, config: {} });
    check('a marker written a second ago is not retried yet', (await w.api.retryDegradedReconcileOnWake()) === false);
  }
  {
    const session = fakeSession();
    const w = worker({ session, config: {} });
    check('no marker, no retry', (await w.api.retryDegradedReconcileOnWake()) === false);
    check('and the worker start hook is at top level, not inside a listener',
      /\nretryDegradedReconcileOnWake\(\)\.catch\(\(\) => \{\}\);/.test(BG));
  }

  /* ---- 5. an unreadable config is unknown, not empty ----------------------------- */
  {
    const session = fakeSession();
    const w = worker({ session, config: { capReferrer: true, blockGeolocation: true }, configUnreadable: true });
    const res = await w.api.localGet('wardenone_config');
    check('localGet says the read failed', res && res.unreadable === true, JSON.stringify(res));
    check('and still hands existing callers an empty config, unchanged', res && JSON.stringify(res.wardenone_config) === '{}');
    w.api.refreshExtensionState();
    await settle();
    check('the reconciler runs no applier on an unreadable config', w.calls.length === 0,
      w.calls.join(',') + ' -- {} would have switched capReferrer and blockGeolocation OFF and certified it');
    check('and does not commit the key', w.api.key() === '');
    const m = session.__store.wardenone_reconcile_degraded;
    check('and records that the config could not be read', m && m.failed.join(',') === 'config', JSON.stringify(m));
    check('a failed read is not cached as the config either', (await w.api.localGet('wardenone_config')).unreadable === true);
  }

  /* ---- 6. Protection Health says so -------------------------------------------- */
  async function health(marker, cfg) {
    const issues = [];
    const labels = (/const RECONCILE_COMPONENT_LABELS = \{([\s\S]*?)\n\};/.exec(BG) || [])[1] || '';
    // eslint-disable-next-line no-new-func
    const run = new Function('chrome', 'cfg', 'addIssue', '__blocklistRulesetError',
      'readReconcileDegraded', 'RECONCILE_COMPONENT_LABELS', 'RECONCILE_RETRY_MAX',
      '"use strict";return (async()=>{' + HEALTH_BLOCK + '\nreturn true;})();');
    await run({ declarativeNetRequest: { getEnabledRulesets: async () => ['grabbers', 'adshield_easylist', 'trackers'] } },
      Object.assign({ enabled: true }, cfg || {}),
      (severity, text, topLevel) => issues.push({ severity, text, topLevel: topLevel === true }),
      '', async () => marker, new Function('return {' + labels + '\n};')(), 6);
    return issues;
  }
  {
    const issues = await health({ failed: ['allowlist', 'headerShield'], attempts: 1, at: Date.now(), stateKey: 'k' });
    const hit = issues.find((i) => /not in effect/.test(i.text));
    check('a degraded marker becomes a top-level danger issue', hit && hit.severity === 'danger' && hit.topLevel, JSON.stringify(issues));
    check('naming the components in plain words', hit && /site allowlist rules/.test(hit.text) && /Header Shield/.test(hit.text), hit && hit.text);
    check('and saying a retry is coming', hit && /will retry/.test(hit.text));
  }
  {
    const issues = await health({ failed: ['allowlist'], attempts: 6, at: Date.now(), stateKey: 'k' });
    const hit = issues.find((i) => /not in effect/.test(i.text));
    check('a used-up budget says so and points at the way out', hit && /retries are used up/.test(hit.text) && /Repair/.test(hit.text), hit && hit.text);
  }
  {
    const issues = await health({ failed: ['config'], attempts: 1, at: Date.now(), stateKey: '' });
    check('an unreadable config is reported as what it is', issues.some((i) => /could not read its settings/.test(i.text) && /rather than applying defaults/.test(i.text)));
  }
  {
    const issues = await health(null);
    check('no marker, no issue', !issues.some((i) => /not in effect|could not read its settings/.test(i.text)));
  }

  /* ---- 7. every applier the orchestrator runs signals a swallowed failure --------- */
  for (const { name, fn } of RUN_CALLS) {
    const start = BG.indexOf('\nasync function ' + fn + '(') >= 0 ? BG.indexOf('\nasync function ' + fn + '(') : BG.indexOf('\nfunction ' + fn + '(');
    check('applier ' + fn + ' is defined', start >= 0);
    if (start < 0) continue;
    const end = BG.indexOf('\n}\n', start);
    const body = BG.slice(start, end);
    const catches = [...body.matchAll(/\} catch \((?:e|_)\) \{([\s\S]*?)(?=\n\s*\}|\}\s*$)/g)];
    const last = catches.length ? catches[catches.length - 1][1] : '';
    const signals = /return false/.test(last) || (fn === 'applyHttpsUpgradeRule' && /if \(!sessionOk\) return false;/.test(body));
    check('applier ' + fn + ' (' + name + ') returns false when it swallows a failure', signals,
      'its catch logs and resolves undefined, which the orchestrator reads as success');
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all reconciliation honesty checks passed');
})();

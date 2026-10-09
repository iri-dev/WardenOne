/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The reconciler has one list of components, and a failure never switches a protection off.
 * Run: node tools/test-reconcile-one-list.js
 *
 * refreshExtensionState() had a success path of 24 appliers and two fallback paths -- a .catch
 * and an outer catch -- meant to express the same desired state. They did not: the .catch left
 * out Header Shield and both cookie rules, the outer catch left out those and three more, both
 * called several appliers with a hard false or {enabled:false}, and two calls were pasted twice
 * (BUG-08). Reached, they would have answered an unknown configuration by switching six
 * protections off and leaving three at whatever Chrome happened to hold.
 *
 * Now there is one list. Each component is run through a thunk, so an applier that throws
 * synchronously fails as THAT component and the rest still run; the two fallback paths touch no
 * component at all -- an error before or around the list means the desired state is unknown, and
 * unknown means leave Chrome's state alone and record the reconcile as degraded, exactly the
 * MV3-01 contract, whose marker and wake-time retry then run the whole list again. The shipped
 * orchestrator is driven here with every applier stubbed, on all three paths.
 *
 * Control: WARDENONE_BACKGROUND points at a pre-fix copy of the worker.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(process.env.WARDENONE_BACKGROUND || path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
let passes = 0;
function check(label, condition, extra) {
  if (condition) { passes++; console.log('  ok  ' + label); return; }
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
function balancedFrom(src, start) {
  let depth = 0; let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated block');
}

const CONFIG_CACHE = between('let __cfgCache = null;', '\n/* These stores are derived from sites visited', 'the config cache');
const BAND_READ = between('async function getDynamicRulesInBand(', '\nconst MEDIA_COMPAT_RULE_BASE', 'the band read');
/* The dynamic readers and the band each asks for, as the real appliers do. */
const DYNAMIC_BANDS = { fingerprintScripts: [931500, 80], searchSponsoredAllow: [931700, 20] };
const ORCHESTRATOR = between('const RECONCILE_DEGRADED_KEY = ', '\nfunction searchAiCleanupActive', 'the reconciler');
const REFRESH = balancedFrom(ORCHESTRATOR, ORCHESTRATOR.indexOf('function refreshExtensionState() {'));

/* The one list, read from the source: run('name', () => applier(...)) or the older run('name', applier(...)). */
const RUN_CALLS = [...REFRESH.matchAll(/run\('([A-Za-z]+)', (?:\(\) => )?([A-Za-z]+)\(/g)].map((m) => ({ name: m[1], fn: m[2] }));
const APPLIER_FNS = [...new Set(RUN_CALLS.map((r) => r.fn))];
/* Every function the two fallback paths used to call by other names. */
const LEGACY_FALLBACK_FNS = ['refreshPrivacyHeaders', 'refreshAllowlistRules', 'refreshMediaCompatibilityRules', 'refreshLoginCompatibilityRules',
  'refreshHttpsUpgrade', 'refreshAllCookieBlock', 'refreshGlobalLocationBlock'];

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

/* A worker with every applier stubbed to record its arguments. `fault` chooses the failure:
   'then-throws' makes the .then body throw before the list, 'applier-throws:<name>' makes one
   applier throw synchronously, 'outer-throws' makes localGet itself throw. */
function worker({ session, config, fault }) {
  const calls = [];
  const dnrReads = { dynamic: 0, unfiltered: 0, session: 0 };
  let releaseDeferred = null;
  const ctx = {
    console: { warn() {}, log() {} },
    Promise, Object, Array, String, Number, JSON, Date, Math, setTimeout, clearTimeout, Error,
    chrome: {
      runtime: { lastError: null },
      declarativeNetRequest: {
        getDynamicRules(filter) { dnrReads.dynamic++; if (!filter || !Array.isArray(filter.ruleIds)) dnrReads.unfiltered++; return Promise.resolve([]); },
        getSessionRules() { dnrReads.session++; return Promise.resolve([]); },
      },
      storage: {
        local: { get(key, cb) { setTimeout(() => cb({ wardenone_config: config || {} }), 0); } },
        session,
      },
    },
    sessionArea: () => session,
    activeAllowlist: (cfg) => { if (fault === 'then-throws') throw new Error('malformed allowlist'); return (cfg && cfg.allowlist) || []; },
    locationExemptHosts: (cfg) => (cfg && cfg.allowlist) || [],
    scheduleSitePauseExpiry: () => {},
    eyeShieldThemingActive: () => false,
    eyeShieldPreloadFile: () => '',
    eyeShieldRegistrationScope: () => ({ matches: ['<all_urls>'], excludeMatches: [] }),
    eyeShieldUsesBootstrap: () => false,
    eyeShieldActiveProfileHosts: () => [],
    consentRejectActive: () => false,
    searchSponsoredCleanupActive: () => false,
  };
  for (const fn of LEGACY_FALLBACK_FNS) ctx[fn] = (...args) => { calls.push({ name: 'LEGACY:' + fn, args }); };
  for (const { name, fn } of RUN_CALLS) {
    ctx[fn] = (...args) => {
      calls.push({ name, fn, args });
      if (fault === 'snapshot' && ['allowlist', 'mediaCompatibility', 'loginCompatibility', 'fingerprintScripts', 'searchSponsoredAllow', 'searchParams'].includes(name)) {
        const readRules = args.find((arg) => typeof arg === 'function');
        const band = DYNAMIC_BANDS[name];
        /* Twice: a second read of the same band must reuse the first. */
        return band ? readRules(...band).then(() => readRules(...band)) : readRules();
      }
      if (fault === 'applier-throws:' + name) throw new Error(name + ' threw synchronously');
      if (fault === 'defer:' + name && !releaseDeferred) {
        return new Promise((resolve) => { releaseDeferred = () => resolve(); });
      }
      return Promise.resolve(undefined);
    };
  }
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CONFIG_CACHE + '\n' + BAND_READ + '\n' + ORCHESTRATOR + '\nglobalThis.api = { refreshExtensionState,'
    + ' scheduleExtensionStateRefresh, retryDegradedReconcileOnWake, readReconcileDegraded, localGet,'
    + ' key: () => __refreshExtensionStateLastKey, publishConfig: __cfgCacheSet };', ctx);
  if (fault === 'outer-throws') ctx.localGet = () => { throw new Error('storage bridge missing'); };
  return { api: ctx.api, calls, dnrReads, byName: (n) => calls.filter((c) => c.name === n),
    releaseDeferred: () => { if (releaseDeferred) releaseDeferred(); } };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 60));
const names = (w) => w.calls.map((c) => c.name);
const offSwitching = (w) => w.calls.filter((c) => c.name.indexOf('LEGACY:') === 0 || (c.args.length && (c.args[0] === false || (c.args[0] && typeof c.args[0] === 'object' && c.args[0].enabled === false))));

(async () => {
  check('the list is where the suite expects it, with its named appliers', RUN_CALLS.length >= 24, RUN_CALLS.length + ' found');

  /* ---- 1. statically: one list, no fallback lists, no duplicates ---------------------- */
  {
    const catchBodies = [...REFRESH.matchAll(/\}\)\.catch\(\(([a-z_]*)\) => \{([\s\S]*?)\n    \}\);/g)].map((m) => m[2])
      .concat([...REFRESH.matchAll(/\n  \} catch \(([a-z_]*)\) \{([\s\S]*?)\n  \}\n\}?$/g)].map((m) => m[2]));
    check('both failure paths were found', catchBodies.length === 2, catchBodies.length + ' found');
    const applierCallsInCatches = catchBodies.map((b) => (b.match(/\b(apply|refresh|reconcile)[A-Za-z]*\(/g) || []).filter((c) => !/^refreshExtensionState/.test(c)));
    check('neither failure path calls an applier', applierCallsInCatches.every((c) => c.length === 0), JSON.stringify(applierCallsInCatches));
    check('neither failure path hard-codes a protection off', !catchBodies.some((b) => /\(false\b|\{ enabled: false \}/.test(b)));
    check('both failure paths record the reconcile as degraded', catchBodies.every((b) => /noteReconcileDegraded\(\['reconcile'\]/.test(b)));
    const lines = REFRESH.split('\n').map((l) => l.trim()).filter(Boolean);
    const dupes = lines.filter((l, i) => i > 0 && l === lines[i - 1] && /\(/.test(l));
    check('no call is written twice in a row', dupes.length === 0, dupes.join(' | '));
    check('the legacy fallback helpers are not called from the reconciler at all', !LEGACY_FALLBACK_FNS.some((fn) => new RegExp('\\b' + fn + '\\(').test(REFRESH)));
    const namedOnce = RUN_CALLS.map((r) => r.name);
    check('every component is named once', new Set(namedOnce).size === namedOnce.length);
    check('each component runs through a thunk, so one throwing does not skip the rest',
      RUN_CALLS.length > 0 && (REFRESH.match(/run\('[A-Za-z]+', \(\) => /g) || []).length === RUN_CALLS.length);
    check('the degraded labels know the reconcile itself as a component', /reconcile: '/.test(ORCHESTRATOR));
  }

  /* ---- 2. the success path addresses every component with the config's arguments ----- */
  {
    const session = fakeSession();
    const w = worker({ session, config: { enabled: true, intranetProtection: true, intranetNetworkRules: true, sendPrivacySignals: true } });
    w.api.refreshExtensionState(); await settle();
    check('every component is addressed once', names(w).filter((n) => n.indexOf('LEGACY') < 0).length === RUN_CALLS.length && new Set(names(w)).size === RUN_CALLS.length, names(w).join(','));
    check('with the arguments the desired state implies', w.byName('privacyHeaders')[0].args[0] === true && w.byName('intranet')[0].args[0] === true);
    check('and no legacy fallback helper', !names(w).some((n) => n.indexOf('LEGACY') === 0));
    check('the key is committed', w.api.key() !== '');
  }
  {
    const session = fakeSession();
    const w = worker({ session, config: { enabled: false } });
    w.api.refreshExtensionState(); await settle();
    check('the master switch off reaches every component as the config says, not as a fallback guess', names(w).length === RUN_CALLS.length && w.byName('privacyHeaders')[0].args[0] === false && w.byName('intranet')[0].args[0] === false);
  }
  {
    const session = fakeSession();
    const config = { enabled: true, safeSearch: false, blockSearchAiAnswers: false, intranetProtection: true };
    const w = worker({ session, config });
    w.api.refreshExtensionState(); await settle();
    config.blockSearchAiAnswers = true;
    w.api.publishConfig(config);
    w.api.refreshExtensionState(); await settle();
    check('a search-appearance change skips unrelated stable DNR owners',
      w.byName('privacyHeaders').length === 1 && w.byName('headerShield').length === 1
        && w.byName('searchParams').length === 1 && w.byName('allowlist').length === 1);
    config.safeSearch = true;
    w.api.publishConfig(config);
    w.api.refreshExtensionState(); await settle();
    check('a SafeSearch change runs its DNR owner but not unrelated owners',
      w.byName('searchParams').length === 2 && w.byName('privacyHeaders').length === 1);
    config.intranetProtection = false;
    w.api.publishConfig(config);
    w.api.refreshExtensionState(); await settle();
    check('intranet setting is represented in the state key', w.byName('intranet').length >= 2);
  }
  {
    const w = worker({ session: fakeSession(), config: { enabled: true }, fault: 'snapshot' });
    w.api.refreshExtensionState(); await settle();
    check('one generation reads each dynamic band once and shares one session snapshot among readers',
      w.dnrReads.dynamic === Object.keys(DYNAMIC_BANDS).length && w.dnrReads.session === 1,
      JSON.stringify(w.dnrReads));
    /* Unfiltered, the read is every dynamic rule (~22,000), built on the browser's UI thread. */
    check('no dynamic read asks for every rule', w.dnrReads.unfiltered === 0, JSON.stringify(w.dnrReads));
  }

  /* ---- 3. the .then body throws before the list: nothing is touched, the reconcile is degraded ---- */
  {
    const session = fakeSession();
    const w = worker({ session, config: { enabled: true }, fault: 'then-throws' });
    w.api.refreshExtensionState(); await settle();
    check('an error before the list runs no applier', w.calls.length === 0, names(w).join(','));
    check('and switches nothing off', offSwitching(w).length === 0, JSON.stringify(offSwitching(w).map((c) => c.name)));
    const marker = session.__store.wardenone_reconcile_degraded;
    check('the reconcile is recorded as degraded so the wake retry runs the list again', !!marker && marker.failed.includes('reconcile'), JSON.stringify(marker));
    check('the key is not committed', w.api.key() === '');
  }

  /* ---- 4. one applier throws synchronously: it fails alone, the rest still run ------------- */
  {
    const session = fakeSession();
    const w = worker({ session, config: { enabled: true }, fault: 'applier-throws:headerShield' });
    w.api.refreshExtensionState(); await settle();
    check('the other components are still addressed', names(w).filter((n) => n.indexOf('LEGACY') < 0).length === RUN_CALLS.length, names(w).length + ' calls');
    check('and no fallback list switches anything off', offSwitching(w).filter((c) => c.name !== 'headerShield').every((c) => c.name.indexOf('LEGACY') < 0) && !names(w).some((n) => n.indexOf('LEGACY') === 0),
      names(w).filter((n) => n.indexOf('LEGACY') === 0).join(','));
    const marker = session.__store.wardenone_reconcile_degraded;
    check('the thrower is the degraded component, by name', !!marker && marker.failed.length === 1 && marker.failed[0] === 'headerShield', JSON.stringify(marker));
    check('the key is not committed', w.api.key() === '');
  }

  /* ---- 5. the outer catch: localGet itself throws ------------------------------------------ */
  {
    const session = fakeSession();
    const w = worker({ session, config: { enabled: true }, fault: 'outer-throws' });
    w.api.refreshExtensionState(); await settle();
    check('a throw before the read runs no applier and switches nothing off', w.calls.length === 0, names(w).join(','));
    const marker = session.__store.wardenone_reconcile_degraded;
    check('and is recorded as a degraded reconcile', !!marker && marker.failed.includes('reconcile'), JSON.stringify(marker));
  }

  /* ---- 6. the retry after such a failure runs the one list ------------------------------- */
  {
    const session = fakeSession();
    const dying = worker({ session, config: { enabled: true }, fault: 'then-throws' });
    dying.api.refreshExtensionState(); await settle();
    check('the failed reconcile left a marker for the next wake', !!session.__store.wardenone_reconcile_degraded);
    if (session.__store.wardenone_reconcile_degraded) session.__store.wardenone_reconcile_degraded.at = Date.now() - 5 * 60 * 1000;
    const cold = worker({ session, config: { enabled: true } });
    const scheduled = await cold.api.retryDegradedReconcileOnWake();
    await settle(300);
    check('a cold worker retries and runs every component', scheduled === true && names(cold).length === RUN_CALLS.length, names(cold).length + ' calls');
    check('and, succeeding, clears the marker', !session.__store.wardenone_reconcile_degraded && cold.api.key() !== '');
  }

  /* An in-flight generation holds the next one until it settles. Repeated requests
     for the same desired state do not launch another 24-applier fan-out. */
  {
    const w = worker({ session: fakeSession(), config: { enabled: true, safeSearch: false },
      fault: 'defer:headerShield' });
    w.api.refreshExtensionState(); await settle();
    w.api.refreshExtensionState(); await settle();
    check('same-state refresh does not duplicate an in-flight fan-out',
      w.calls.length === RUN_CALLS.length, w.calls.length + ' calls');
    w.api.publishConfig({ enabled: true, safeSearch: true });
    w.api.refreshExtensionState(); await settle();
    check('new settings wait for the first generation',
      w.calls.length === RUN_CALLS.length, w.calls.length + ' calls');
    w.releaseDeferred(); await settle(140);
    check('the queued settings run once after the first generation',
      w.byName('blocklistRulesets').length === 2
        && w.byName('searchParams').length === 2
        && w.byName('privacyHeaders').length === 1
        && w.byName('searchParams')[1].args[0].safeSearch === true,
      w.calls.length + ' calls');
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed, ' + passes + ' passed'); process.exit(1); }
  console.log('  ok  ' + passes + ' checks: one list, and a failure leaves Chrome\'s state alone');
})().catch((e) => { console.error(e); process.exit(1); });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A worker that wakes to unchanged state writes nothing.
 * Run: node tools/test-cold-wake-writes.js
 *
 * A service worker starts on any message, tab event or alarm, and every start used to redo
 * maintenance that nothing had asked for (PERF-05): four dynamic-rule bands removed and
 * re-added in full -- never-block allows, the reader's blocklist, the grabber feed of up to
 * a thousand rules, the miner feed -- the context menu torn down and its thirteen entries
 * created again, and the installed extensions enumerated twice, once by the watcher and once
 * inside the security report. All of it browser-process work, serialised on every wake.
 *
 * Now each band is compared with what Chrome holds and written only when it differs; the
 * menu is rebuilt only when the fingerprint of its definition (the item table, the switch,
 * the version) is not the one this browser session already built; and the worker-start
 * extension scan is one coalesced job, once per browser session. This suite is the card's
 * own verification, modelled: the real appliers, menu installer and scan gate run fifty
 * times against a browser whose rules, menus and storage.session persist between wakes (a
 * wake is a fresh module realm), counting writes. Then every way state can change is
 * exercised to prove the skip is a comparison and not a memory: external loss of a band,
 * a corrupted rule, a list that grew, the switch turning, an install, a browser restart.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(ROOT, 'background-extension-watch.js'), 'utf8');
const REP = fs.readFileSync(path.join(ROOT, 'background-extension-reputation.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function grabFn(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'missing ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}
function between(src, a, b, what) {
  const i = src.indexOf(a);
  assert(i >= 0, 'missing ' + what);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end of ' + what);
  return src.slice(i, j + b.length);
}
/* Functions the fix introduced. On the pre-fix source each is absent, and the control run
   should show the old cost rather than the lift crashing: the stand-ins reproduce what the
   old worker did on every start -- no comparison, and both extension scans. */
const has = (src, name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(src);
const orElse = (src, name, fallback) => (has(src, name) ? grabFn(src, name) : fallback);
const CONSTS = [...BG.matchAll(/^const (WO_MENU_[A-Z_]+ = '[^']+');/gm)].map((m) => 'const ' + m[1] + ';').join('\n');
const LIFTED = [
  CONSTS,
  BG.includes('const WO_MENU_ITEMS = [') ? between(BG, 'const WO_MENU_ITEMS = [', '\n];', 'the menu table') : 'const WO_MENU_ITEMS = [];',
  orElse(BG, 'wardenMenuFingerprint', 'function wardenMenuFingerprint() { return ""; }'),
  orElse(BG, 'wardenMenuBuiltRead', 'function wardenMenuBuiltRead() { return Promise.resolve(""); }'),
  orElse(BG, 'wardenMenuBuiltWrite', 'function wardenMenuBuiltWrite() {}'),
  grabFn(BG, 'installWardenContextMenu'),
  orElse(BG, 'dnrValueMatches', 'function dnrValueMatches() { return false; }'),
  orElse(BG, 'dnrBandUnchanged', 'function dnrBandUnchanged() { return false; }'),
  /* The feed appliers read their switch through these since LIFE-02; older sources read it inline. */
  orElse(BG, 'readFeedConfig', "async function readFeedConfig() { const s = await localGet('wardenone_config'); return Object.assign({}, DEFAULT_CONFIG, (s && s.wardenone_config) || {}); }"),
  orElse(BG, 'grabberFeedDisabled', 'function grabberFeedDisabled(cfg) { return cfg.enabled === false || (cfg.blockGrabberResources === false && cfg.warnGrabberDomains === false && cfg.blockMalwareSites === false); }'),
  orElse(BG, 'minerFeedDisabled', 'function minerFeedDisabled(cfg) { return cfg.enabled === false || cfg.blockCryptominers === false; }'),
  grabFn(BG, 'applyNeverBlockAllowRules'), grabFn(BG, 'applyUserBlocklistRules'), grabFn(BG, 'applyGrabberFeedRules'), grabFn(BG, 'applyMinerFeedRules'),
  "var EXT_SCAN_SESSION_KEY = '__wardenone_ext_scan_done';",
  orElse(WATCH, 'extensionScanDoneThisSession', 'function extensionScanDoneThisSession() { return Promise.resolve(false); }'),
  orElse(WATCH, 'markExtensionScanDoneThisSession', 'function markExtensionScanDoneThisSession() {}'),
  orElse(WATCH, 'extensionScanOnWorkerStart', "async function extensionScanOnWorkerStart() { await reconcileExtensionChanges('worker-start'); await buildExtensionSecurityReport({ trigger: 'worker-start', includePermissionWarnings: false }); return true; }"),
].join('\n');

/* ---- the browser, persistent across wakes ------------------------------------------ */
function browser() {
  const state = {
    dynamic: new Map(), menus: [], local: { wardenone_config: { enabled: true, elementZapper: true } }, session: {},
    counts: { dnrWrites: 0, dnrRulesWritten: 0, removeAll: 0, creates: 0, inventories: 0, reports: 0 },
    blocklist: [{ domain: 'bad.example', scope: 'permanent' }],
    grabberDomains: ['grab1.example', 'grab2.example', 'grab3.example'],
    minerHosts: ['miner1.example', 'miner2.example'],
    minerPools: ['pool1.example'],
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const chrome = {
    runtime: { lastError: null, id: 'self', getManifest: () => ({ version: '1.0.1' }) },
    declarativeNetRequest: {
      getDynamicRules: async () => [...state.dynamic.values()].map(clone),
      updateDynamicRules: async (u) => {
        state.counts.dnrWrites++;
        for (const id of (u.removeRuleIds || [])) state.dynamic.delete(id);
        for (const r of (u.addRules || [])) { state.counts.dnrRulesWritten++; state.dynamic.set(r.id, clone(r)); }
      },
    },
    contextMenus: {
      removeAll: (cb) => { state.counts.removeAll++; state.menus = []; cb && cb(); },
      create: (opts, cb) => { state.counts.creates++; state.menus.push(opts); cb && cb(); },
    },
    storage: {
      local: {
        get: (keys, cb) => { const out = {}; for (const k of (Array.isArray(keys) ? keys : [keys])) if (state.local[k] !== undefined) out[k] = clone(state.local[k]); cb(out); },
        set: (items, cb) => { Object.assign(state.local, clone(items)); cb && cb(); },
      },
      session: {
        get: (key, cb) => cb(state.session[key] === undefined ? {} : { [key]: state.session[key] }),
        set: (items, cb) => { Object.assign(state.session, items); cb && cb(); },
      },
    },
  };
  return { state, chrome, clone };
}

/* ---- one wake: a fresh realm, the same browser --------------------------------------- */
async function wake(b, opts) {
  const o = opts || {};
  const sandbox = {
    chrome: b.chrome, console: { warn() {}, log() {} }, Promise, Map, Set, Array, Object, String, Number, Boolean, JSON, Date, Error, RegExp,
    setTimeout, clearTimeout,
    localGet: (keys) => new Promise((r) => b.chrome.storage.local.get(keys, r)),
    localSet: (items) => new Promise((r) => b.chrome.storage.local.set(items, r)),
    DEFAULT_CONFIG: { enabled: true, blockGrabberResources: true, warnGrabberDomains: true, blockMalwareSites: true, blockCryptominers: true, elementZapper: true },
    masterSwitchOn: async () => b.state.local.wardenone_config.enabled !== false,
    NEVER_BLOCK_DOMAINS: new Set(['figma.com', 'notion.so', 'slack.com', 'google.com']),
    NEVER_BLOCK_ALLOW_EXCLUDE: new Set(['google.com']),
    NEVER_BLOCK_ALLOW_RULE_BASE: 745000, NEVER_BLOCK_ALLOW_MAX: 200,
    USER_BLOCKLIST_RULE_BASE: 970000, USER_BLOCKLIST_RULES_BUDGET: 64, USER_BLOCKLIST_KEY: 'wardenone_blocklist',
    readUserBlocklist: async () => b.clone(b.state.blocklist),
    pruneExpiredBlocks: (entries) => ({ live: entries, lapsed: [] }),
    userBlockRulesFrom: (entries) => entries.map((e, i) => ({ id: 970000 + i, priority: 99000, action: { type: 'block' }, condition: { requestDomains: [e.domain], resourceTypes: ['main_frame'] } })),
    GRABBER_FEED_RULE_BASE: 740000, GRABBER_FEED_MAX: 1000, GRABBER_FEED_DOMAINS: new Set(b.state.grabberDomains),
    MINER_FEED_RULE_BASE: 742000, MINER_FEED_MAX: 1000, MINER_POOL_RULE_OFFSET: 700,
    MINER_HOSTS: new Set(b.state.minerHosts), MINER_POOL_HOSTS: new Set(b.state.minerPools),
    MINER_RESOURCE_TYPES: ['script', 'xmlhttprequest'], MINER_POOL_RESOURCE_TYPES: ['websocket'],
    reconcileExtensionChanges: async () => { b.state.counts.inventories++; return []; },
    buildExtensionSecurityReport: async (options) => { b.state.counts.reports++; if (!options || options.reconcileWatch !== false) b.state.counts.inventories++; return null; },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { applyNeverBlockAllowRules, applyUserBlocklistRules, applyGrabberFeedRules, applyMinerFeedRules, installWardenContextMenu, extensionScanOnWorkerStart, wardenMenuFingerprint };', ctx, { filename: 'worker-wake.js' });
  const before = Object.assign({}, b.state.counts);
  const api = sandbox.api;
  await api.applyNeverBlockAllowRules();
  await api.applyUserBlocklistRules();
  await api.applyGrabberFeedRules();
  await api.applyMinerFeedRules();
  await api.installWardenContextMenu(o.reason || 'wake');
  await api.extensionScanOnWorkerStart();
  const after = b.state.counts;
  const delta = {};
  for (const k of Object.keys(after)) delta[k] = after[k] - before[k];
  return { delta, api };
}
const quiet = (d) => d.dnrWrites === 0 && d.removeAll === 0 && d.creates === 0 && d.inventories === 0 && d.reports === 0;

(async () => {
  /* ---- fifty wakes, nothing changed ---------------------------------------------------- */
  const b = browser();
  const first = await wake(b);
  check('the first wake of a session installs every band once and builds the menu once',
    first.delta.dnrWrites === 4 && first.delta.removeAll === 1 && first.delta.creates === 14 && first.delta.inventories === 1 && first.delta.reports === 1,
    JSON.stringify(first.delta));
  check('the bands hold what was written', b.state.dynamic.size === 1 + 1 + 3 + 3, String(b.state.dynamic.size));
  const rulesAfterFirst = JSON.stringify([...b.state.dynamic.values()]);
  let quietWakes = 0;
  let noisy = null;
  for (let i = 0; i < 50; i++) {
    const w = await wake(b);
    if (quiet(w.delta)) quietWakes++; else if (!noisy) noisy = { at: i + 2, delta: w.delta };
  }
  check('fifty further wakes to unchanged state write nothing: no DNR write, no menu rebuild, no inventory', quietWakes === 50, JSON.stringify(noisy));
  check('and leave the rules exactly as they were', JSON.stringify([...b.state.dynamic.values()]) === rulesAfterFirst);
  check('the menu Chrome holds is still the full menu', b.state.menus.length === 14 && b.state.menus[0].id === 'wardenone-root');

  /* ---- the skip is a comparison, not a memory ------------------------------------------ */
  {
    /* External loss: something removed the grabber band from Chrome. */
    for (const id of [...b.state.dynamic.keys()]) if (id >= 740000 && id < 741000) b.state.dynamic.delete(id);
    const w = await wake(b);
    check('a band that went missing outside WardenOne is put back on the next wake, and nothing else is touched',
      w.delta.dnrWrites === 1 && w.delta.dnrRulesWritten === 3 && b.state.dynamic.size === 8 && w.delta.removeAll === 0 && w.delta.inventories === 0, JSON.stringify(w.delta));
    check('the wake after that is quiet again', quiet((await wake(b)).delta));
  }
  {
    /* Corruption: one installed rule differs in a field this code sets. */
    const r = b.state.dynamic.get(745000);
    r.priority = 1;
    const w = await wake(b);
    check('a rule whose field differs from the desired one makes exactly that band rewrite', w.delta.dnrWrites === 1 && b.state.dynamic.get(745000).priority === 3000, JSON.stringify(w.delta));
    /* A field Chrome added that this code never set is not a difference. */
    b.state.dynamic.get(745000).condition.isUrlFilterCaseSensitive = false;
    check('a field Chrome adds on its own does not count as a change', quiet((await wake(b)).delta));
  }
  {
    /* A list grew. */
    b.state.grabberDomains.push('grab4.example');
    const w = await wake(b);
    check('a feed that gained a domain is written once, as the whole band', w.delta.dnrWrites === 1 && w.delta.dnrRulesWritten === 4, JSON.stringify(w.delta));
    check('and is quiet again after', quiet((await wake(b)).delta));
  }
  {
    /* The master switch. */
    b.state.local.wardenone_config.enabled = false;
    const off = await wake(b);
    check('the master switch going off empties the bands it governs and rebuilds the menu once (switch fingerprint changed)',
      off.delta.dnrWrites >= 1 && off.delta.removeAll === 1 && off.delta.creates === 0
        && ![...b.state.dynamic.keys()].some((id) => id >= 970000 && id < 970064), JSON.stringify(off.delta));
    check('and stays quiet while off', quiet((await wake(b)).delta));
    b.state.local.wardenone_config.enabled = true;
    const on = await wake(b);
    check('the switch coming back writes the bands once and rebuilds the menu once', on.delta.dnrWrites >= 1 && on.delta.removeAll === 1 && on.delta.creates === 14, JSON.stringify(on.delta));
    check('and is quiet after', quiet((await wake(b)).delta));
  }
  {
    /* A settings save that did not move the menu's switch rebuilds nothing; one that did, does. */
    const { api } = await wake(b);
    const c0 = Object.assign({}, b.state.counts);
    await api.installWardenContextMenu('config');
    check('a settings save that left the switch alone rebuilds no menu', b.state.counts.removeAll === c0.removeAll);
    b.state.local.wardenone_config.elementZapper = false;
    await api.installWardenContextMenu('config');
    check('turning the tools off removes the menu once', b.state.counts.removeAll === c0.removeAll + 1 && b.state.menus.length === 0);
    await api.installWardenContextMenu('config');
    check('and a second save with it off does nothing more', b.state.counts.removeAll === c0.removeAll + 1);
    b.state.local.wardenone_config.elementZapper = true;
    await api.installWardenContextMenu('config');
    check('turning them back on builds it once', b.state.counts.removeAll === c0.removeAll + 2 && b.state.menus.length === 14);
  }
  {
    /* Install and browser start always rebuild, even when the fingerprint matches. */
    const { api } = await wake(b);
    const c0 = Object.assign({}, b.state.counts);
    await api.installWardenContextMenu('installed');
    await api.installWardenContextMenu('startup');
    check('install and browser start rebuild the menu whatever the session remembers', b.state.counts.removeAll === c0.removeAll + 2);
  }
  {
    /* A browser restart clears storage.session: one rebuild, one scan, no rule writes. */
    b.state.session = {};
    const w = await wake(b);
    check('after a browser restart the menu is built once and the extensions scanned once, and the unchanged rules are not rewritten',
      w.delta.removeAll === 1 && w.delta.inventories === 1 && w.delta.reports === 1 && w.delta.dnrWrites === 0, JSON.stringify(w.delta));
    check('the scan is one coalesced job: the report is told not to repeat the inventory', b.state.counts.inventories === b.state.counts.reports);
    check('and the next wake is quiet', quiet((await wake(b)).delta));
  }

  /* ---- the source: what the gate covers, and what it must not ------------------------- */
  check('every band applier compares before it writes',
    ['applyNeverBlockAllowRules', 'applyUserBlocklistRules', 'applyGrabberFeedRules', 'applyMinerFeedRules']
      .every((name) => /dnrBandUnchanged\(mine, addRules\)/.test(grabFn(BG, name))));
  check('the installed rules are still read on every wake, so external loss is still seen', /const existing = await chrome\.declarativeNetRequest\.getDynamicRules\(\);\s*const mine = /.test(grabFn(BG, 'applyGrabberFeedRules')));
  check('the worker-start scan is the only gated one; every management event still reconciles',
    /chrome\.management\.onInstalled\.addListener\(\(\) => scheduleExtensionReconcile\('installed'\)\)/.test(WATCH)
      && /setTimeout\(\(\) => \{ extensionScanOnWorkerStart\(\)\.catch/.test(WATCH)
      && !/setTimeout\(\(\) => \{ reconcileExtensionChanges\('worker-start'\)/.test(WATCH));
  check('the reputation module no longer starts its own worker-start report', !/scheduleExtensionSecurityReport\('worker-start'\), 1250/.test(REP)
    && /chrome\.alarms\.onAlarm\.addListener\(\(alarm\) => \{\s*if \(alarm && alarm\.name === 'wardenone-extension-watch'\) scheduleExtensionSecurityReport\('alarm'\)/.test(REP));
  check('the fifteen-minute alarm remains as the bounded check', /var EXT_WATCH_INTERVAL_MINUTES = 15;/.test(WATCH) && /function ensureExtensionWatchAlarm\(\)/.test(WATCH));
  check('the menu fingerprint covers the table, the switch and the version', /return version \+ '\|' \+ \(on \? 'on' : 'off'\) \+ '\|' \+ WO_MENU_ITEMS\.map/.test(BG));
  check('the top-level menu call is the wake path, and install/startup are the forced ones',
    /^installWardenContextMenu\('wake'\);/m.test(BG) && /onInstalled\.addListener\(\(\) => \{ installWardenContextMenu\('installed'\); \}\)/.test(BG)
      && /onStartup\.addListener\(\(\) => \{ installWardenContextMenu\('startup'\); \}\)/.test(BG)
      && /changes\.wardenone_config\) installWardenContextMenu\('config'\)/.test(BG));

  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  console.log('  ok  ' + pass + ' checks: fifty wakes to unchanged state wrote nothing, and every change still converged');
})().catch((e) => { console.error(e); process.exit(1); });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A DNR rule is replaced in one call, never removed in one and added in the next.
 * Run: node tools/test-dnr-atomic-replace.js
 *
 * Chrome ends a service worker whenever it likes; an update or a reload ends it too.
 * An applier that clears a rule with one updateSessionRules call and installs the
 * replacement with a second has a gap between the two awaits, and a worker that dies
 * in that gap leaves the durable setting saying "on" with no rule behind it -- DNT/GPC
 * headers, location-header minimisation, tracking-cookie stripping or Force HTTPS
 * silently off until the next startup refresh. Chrome applies one call carrying both
 * removeRuleIds and addRules as a single transaction, so the shape is the fix.
 *
 * Two readings. The first walks every updateSessionRules / updateDynamicRules call in
 * background.js and requires the argument to carry both keys (a helper whose whole job
 * is removal is named). The second runs the four appliers the audit named against a
 * modelled rule store that snapshots itself after every call resolves -- each snapshot is
 * a place the worker could have died -- and asserts the rule is there in every one of
 * them while the setting is on.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resourceTypes = require('./lib/resource-types.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ---- 1. every replacement in the file is one call ---------------------------------- */
/* Helpers whose purpose is to take rules away, with nothing to put back. */
const REMOVAL_ONLY = new Set(['removeWardenOneDynamicRules']);
function enclosingFunction(source, index) {
  const names = [...source.slice(0, index).matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)];
  return names.length ? names[names.length - 1][1] : '';
}
{
  const re = /chrome\.declarativeNetRequest\.update(Session|Dynamic)Rules\(/g;
  let m;
  let calls = 0;
  const offenders = [];
  while ((m = re.exec(BG))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let j = i;
    while (j < BG.length && depth > 0) {
      if (BG[j] === '(') depth++;
      else if (BG[j] === ')') depth--;
      j++;
    }
    const arg = BG.slice(i, j - 1);
    const fn = enclosingFunction(BG, m.index);
    calls++;
    if (REMOVAL_ONLY.has(fn)) {
      if (/addRules/.test(arg)) offenders.push(fn + ' is listed as removal-only but adds rules');
      continue;
    }
    if (!/removeRuleIds/.test(arg) || !/addRules/.test(arg)) {
      offenders.push(fn + ' @' + BG.slice(0, m.index).split('\n').length + ': ' + arg.replace(/\s+/g, ' ').slice(0, 60));
    }
  }
  check('background.js has DNR update calls to read', calls > 20, String(calls));
  check('every rule replacement carries removeRuleIds and addRules in the same call', offenders.length === 0, offenders.join(' | '));
}

/* ---- 2. the four appliers, run against a store that remembers every boundary ------- */
function slice(startMarker, endMarker) {
  const from = BG.indexOf(startMarker);
  assert(from >= 0, 'missing ' + startMarker);
  const to = BG.indexOf(endMarker, from);
  assert(to > from, 'missing end for ' + startMarker);
  return BG.slice(from, to);
}
function fnSlice(name) {
  const from = BG.indexOf('async function ' + name + '(');
  assert(from >= 0, 'missing ' + name);
  const to = BG.indexOf('\n}\n', from);
  return BG.slice(from, to + 3);
}
const APPLIERS = slice("let __privacyHeaderRuleEnabled = null;", "let __ipLookupBlockRulesEnabled = null;")
  + "let __thirdPartyCookieRuleEnabled = null;\n" + fnSlice('applyThirdPartyCookieRule')
  + slice("const HTTPS_UPGRADE_RULE_ID = 910000;", "function refreshHttpsUpgrade()");

/* Chrome's store, as far as these appliers can tell: a map per store, a call applied as
   one transaction (removals first, then additions, a duplicate id rejected as a whole),
   and a snapshot of both stores taken the moment each call resolves. */
function harness(options) {
  const opts = options || {};
  const stores = { session: new Map(), dynamic: new Map() };
  for (const [store, rules] of Object.entries(opts.seed || {})) for (const rule of rules) stores[store].set(rule.id, rule);
  const log = [];
  const snapshots = [];
  const failing = new Set(opts.fail || []);
  function apply(store, update) {
    const name = store === 'session' ? 'updateSessionRules' : 'updateDynamicRules';
    log.push({ store, update: JSON.parse(JSON.stringify(update)) });
    if (failing.has(store)) return Promise.reject(new Error('Internal error while updating ' + name));
    const map = stores[store];
    const next = new Map(map);
    for (const id of (update.removeRuleIds || [])) next.delete(id);
    for (const rule of (update.addRules || [])) {
      if (next.has(rule.id)) return Promise.reject(new Error('Rule with id ' + rule.id + ' does not have a unique ID.'));
      next.set(rule.id, rule);
    }
    stores[store] = next;
    snapshots.push({ store, session: [...stores.session.values()], dynamic: [...stores.dynamic.values()] });
    return Promise.resolve();
  }
  const warnings = [];
  const sandbox = Object.assign({
    console: { warn: (...args) => warnings.push(args.join(' ')), log() {}, error() {} },
    Promise, Map, Set, Array, Object, String, Number, Boolean, JSON, Error,
    PRIVACY_HEADER_RULE_ID: 900000,
    THIRD_PARTY_COOKIE_RULE_ID: 900001,
    LOCATION_PRIVACY_HEADER_RULE_ID: 900002,
    THIRD_PARTY_COOKIE_RESOURCE_TYPES: ['image', 'ping'],
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com', 'login.microsoftonline.com'],
    chrome: {
      declarativeNetRequest: {
        updateSessionRules: (update) => apply('session', update),
        updateDynamicRules: (update) => apply('dynamic', update),
      },
    },
  }, resourceTypes.resolveAll(BG));
  vm.createContext(sandbox);
  vm.runInContext(APPLIERS + '\nthis.__api = { applyPrivacyHeaderRule, applyLocationPrivacyHeaderRule, applyThirdPartyCookieRule, applyHttpsUpgradeRule, httpsUpgradeRule, __updateSessionRules: chrome.declarativeNetRequest.updateSessionRules };',
    sandbox, { filename: 'background.js' });
  return { api: sandbox.__api, stores: () => stores, log, snapshots, warnings };
}

const SINGLE_STORE = [
  ['applyPrivacyHeaderRule', 900000, (r) => r.action.type === 'modifyHeaders' && r.action.requestHeaders.some((h) => h.header === 'Sec-GPC' && h.value === '1')],
  ['applyLocationPrivacyHeaderRule', 900002, (r) => r.action.requestHeaders.some((h) => h.header === 'X-Geo' && h.operation === 'remove')],
  ['applyThirdPartyCookieRule', 900001, (r) => r.action.responseHeaders[0].header === 'set-cookie' && r.condition.domainType === 'thirdParty'],
];

(async () => {
  for (const [name, id, looksRight] of SINGLE_STORE) {
    /* Cold worker, empty store: one call installs it. */
    {
      const h = harness();
      await h.api[name](true);
      const rule = h.stores().session.get(id);
      check(name + ': enabling from empty installs the rule in one call', h.log.length === 1 && !!rule && looksRight(rule));
      await h.api[name](true);
      check(name + ': a same-state refresh makes no call', h.log.length === 1);
    }
    /* Cold worker, rule already installed (the case the audit traced): the refresh must
       leave a rule in the store at every point the worker could die. */
    {
      const seeded = harness();
      await seeded.api[name](true);
      const existing = seeded.stores().session.get(id);
      const h = harness({ seed: { session: [existing] } });
      await h.api[name](true);
      const everyBoundary = h.snapshots.length > 0 && h.snapshots.every((s) => s.session.some((r) => r.id === id));
      check(name + ': a refresh over an installed rule never passes through an empty store', everyBoundary,
        h.snapshots.map((s) => s.session.map((r) => r.id).join(',') || '(empty)').join(' -> '));
      check(name + ': the refresh is one transaction', h.log.length === 1 && (h.log[0].update.removeRuleIds || []).includes(id) && (h.log[0].update.addRules || []).length === 1);
      check(name + ': the store ends with exactly one copy', h.stores().session.size === 1);
    }
    /* Switching off removes it, and adds nothing. */
    {
      const h = harness();
      await h.api[name](true);
      await h.api[name](false);
      check(name + ': switching off empties the store with no add', h.stores().session.size === 0 &&
        (h.log[1].update.addRules || []).length === 0 && (h.log[1].update.removeRuleIds || []).includes(id));
    }
    /* A rejected transaction changes nothing and stays retryable. */
    {
      const h = harness({ fail: ['session'] });
      const result = await h.api[name](true);
      check(name + ': a rejected update reports failure and leaves the store as it was', result === false && h.stores().session.size === 0 && h.warnings.length === 1);
      const again = harness({ fail: [] });
      check(name + ': the failure is not remembered as success', (await again.api[name](true)) !== false && again.stores().session.size === 1);
    }
  }

  /* Force HTTPS keeps a persistent copy and a session copy. Each store is replaced in
     one call, the persistent one first; neither is ever empty while the setting is on. */
  {
    const h = harness();
    await h.api.applyHttpsUpgradeRule(true);
    check('Force HTTPS: enabling installs the persistent copy, then the session copy',
      h.log.length === 2 && h.log[0].store === 'dynamic' && h.log[1].store === 'session' &&
      h.stores().dynamic.has(910001) && h.stores().session.has(910000));
    const rule = h.stores().session.get(910000);
    check('Force HTTPS: the rule upgrades top-level http navigations only and spares local hosts',
      rule.action.type === 'upgradeScheme' && rule.condition.regexFilter === '^http://' &&
      rule.condition.resourceTypes.join() === 'main_frame' && rule.condition.excludedRequestDomains.includes('localhost'));
    const seeded = harness({ seed: { session: [h.stores().session.get(910000)], dynamic: [h.stores().dynamic.get(910001)] } });
    await seeded.api.applyHttpsUpgradeRule(true);
    const everyBoundary = seeded.snapshots.length === 2 && seeded.snapshots.every((s) =>
      s.session.some((r) => r.id === 910000) && s.dynamic.some((r) => r.id === 910001));
    check('Force HTTPS: a refresh over installed copies never leaves either store empty', everyBoundary,
      seeded.snapshots.map((s) => 'session=' + s.session.length + ' dynamic=' + s.dynamic.length).join(' -> '));
    check('Force HTTPS: each store is replaced in one transaction',
      seeded.log.every((entry) => (entry.update.removeRuleIds || []).length === 1 && (entry.update.addRules || []).length === 1));
    await seeded.api.applyHttpsUpgradeRule(false);
    check('Force HTTPS: switching off clears both stores with no add',
      seeded.stores().session.size === 0 && seeded.stores().dynamic.size === 0 &&
      seeded.log.slice(2).every((entry) => (entry.update.addRules || []).length === 0));
  }
  {
    const h = harness({ fail: ['dynamic'] });
    const result = await h.api.applyHttpsUpgradeRule(true);
    check('Force HTTPS: a failed persistent copy still leaves the session copy in force',
      result !== false && h.stores().session.has(910000) && h.warnings.some((w) => /persistent/.test(w)));
    const s = harness({ fail: ['session'] });
    const r2 = await s.api.applyHttpsUpgradeRule(true);
    check('Force HTTPS: a failed session copy is reported as failure', r2 === false && s.stores().dynamic.has(910001));
  }

  /* The old two-call shape is what this suite exists to refuse. Run it by hand through
     the same store model and show the boundary it leaves empty, so a green run above
     means the shape was checked and not that the model cannot see the fault. */
  {
    const seed = { id: 900000, priority: 1, action: { type: 'modifyHeaders' }, condition: {} };
    const model = harness({ seed: { session: [seed] } });
    /* Through the same entry point the appliers use. */
    const legacy = async () => {
      await model.api.__updateSessionRules({ removeRuleIds: [seed.id] });
      await model.api.__updateSessionRules({ addRules: [seed] });
    };
    await legacy();
    check('the model catches the old remove-then-add shape at its empty boundary',
      model.snapshots.length === 2 && model.snapshots[0].session.length === 0 && model.snapshots[1].session.length === 1,
      model.snapshots.map((s) => s.session.length).join(' -> '));
  }

  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  console.log('  ok  ' + pass + ' checks: every DNR rule replacement is one transaction, and no boundary leaves a store empty');
})().catch((e) => { console.error(e); process.exit(1); });

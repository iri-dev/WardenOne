/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const dynamicIo = require('./lib/dynamic-rule-io.js');
process.exitCode = 1;
const background = fs.readFileSync('background.js', 'utf8');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function between(start, end) {
  const from = background.indexOf(start), to = background.indexOf(end, from);
  assert(from >= 0 && to > from, start);
  return background.slice(from, to);
}
function lift(name) {
  const start = background.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const end = background.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, name);
  return background.slice(start, end + 3);
}
function constant(name) {
  const match = background.match(new RegExp('^const ' + name + ' = [^;]+;', 'm'));
  assert(match, name);
  return match[0];
}
const constants = ['DYNAMIC_RULE_BASE', 'MAX_DYNAMIC', 'OPTION_RULE_BASE', 'OPTION_RULES_MAX',
  'TRACKER_RULES_BUDGET', 'USER_RULES_BUDGET', 'FIREWALL_RULES_BUDGET', 'FIREWALL_SESSION_RULES_BUDGET',
  'USER_BLOCKLIST_RULES_BUDGET', 'NEVER_BLOCK_ALLOW_RULE_BASE', 'NEVER_BLOCK_ALLOW_MAX',
  'SCRIPT_SHIELD_RULE_BASE', 'SCRIPT_SHIELD_RULE_MAX', 'FINGERPRINT_SCRIPT_RULE_BASE', 'FINGERPRINT_SCRIPT_RULE_MAX',
  'GOOGLE_SEARCH_ALLOW_RULE_BASE', 'GOOGLE_SEARCH_ALLOW_RULE_MAX', 'LEARNED_RULE_BASE', 'LEARNED_MAX',
  'GRABBER_FEED_RULE_BASE', 'GRABBER_FEED_MAX', 'GRABBER_NAV_RULE_ID', 'GRABBER_MALWARE_NAV_RULE_ID',
  'TRACKER_RULE_BASE', 'TRACKER_RULE_MAX', 'USER_RULE_BASE', 'USER_RULE_MAX', 'USER_BLOCKLIST_RULE_BASE',
  'FIREWALL_RULE_BASE', 'FIREWALL_RULE_MAX', 'ADSHIELD_STATIC_RULESET_ID', 'SPOTIFY_MEDIA_RULESET_ID',
  'TRACKERS_STATIC_RULESET_ID', 'EASYPRIVACY_STATIC_RULESET_ID'];
const orchestrator = between('const RECONCILE_DEGRADED_KEY = ', '\nfunction searchAiCleanupActive');
const health = between('  let enabledRulesets = null;', "  // The tab the popup is open on, asked rather than assumed (FEAT-02).");
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for reconciliation');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function world(options = {}) {
  const state = { config: { enabled: false }, dynamic: [], enabled: [], writes: 0, staticWrites: 0,
    failWrites: 0, failReads: 0, failStatic: 0, warnings: [], session: options.session || {}, reads: 0 };
  const session = {
    async get(key) { return { [key]: clone(state.session[key]) }; },
    async set(value) { Object.assign(state.session, clone(value)); },
    async remove(key) { delete state.session[key]; },
  };
  const box = {
    state, setTimeout, clearTimeout,
    console: { warn: (...args) => state.warnings.push(args.map(String).join(' ')) },
    chrome: { declarativeNetRequest: {
      async updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }) {
        state.staticWrites++;
        if (state.failStatic-- > 0) throw new Error('static update rejected');
        state.enabled = [...new Set(state.enabled.filter(id => !disableRulesetIds.includes(id)).concat(enableRulesetIds))];
      },
      async getEnabledRulesets() { return state.enabled; },
      async getDynamicRules() {
        if (state.failReads-- > 0) throw new Error('dynamic read rejected');
        return clone(state.dynamic);
      },
      async updateDynamicRules({ removeRuleIds, addRules }) {
        state.writes++;
        if (state.hold) await state.hold;
        if (state.failWrites-- > 0) throw new Error('dynamic removal rejected');
        state.dynamic = state.dynamic.filter(rule => !(removeRuleIds || []).includes(rule.id)).concat(clone(addRules || []));
      },
    } },
    sessionArea: () => session,
    localGet: async () => { state.reads++; return { wardenone_config: clone(state.config) }; },
    activeAllowlist: () => [], locationExemptHosts: () => [], scheduleSitePauseExpiry() {},
    eyeShieldThemingActive: () => false, eyeShieldUsesBootstrap: () => false,
    eyeShieldActiveProfileHosts: () => [], eyeShieldPreloadFile: () => '',
    eyeShieldRegistrationScope: () => ({ matches: [], excludeMatches: [] }),
    resourceSaverScriptFiles: () => [], consentRejectActive: () => false, searchSponsoredCleanupActive: () => false,
    LISTENERS_NOT_REGISTERED: [],
    ADSHIELD_STATIC_ACTIVE: true,
    __subsystemQueues: new Map(),
    applyLearnedRules: async () => state.learnedResult,
    applyTrackerLearnerRules: async () => { if (state.trackerHold) await state.trackerHold; return state.trackerResult; },
  };
  for (const match of orchestrator.matchAll(/run\('[A-Za-z]+', \((?:submitRules)?\) => ([A-Za-z]+)\(/g)) {
    box[match[1]] = async () => {};
  }
  vm.createContext(box);
  vm.runInContext(constants.map(constant).join('\n') + '\n'
    + dynamicIo.prelude(background) + '\n'
    + ['isWardenOneDynamicRuleId', 'removeWardenOneDynamicRules', 'serializeSubsystem'].map(lift).join('\n') + '\n'
    + between('let __blocklistRulesetStateKey = ', '\nconst ALL_COOKIES_BACKUP_KEY') + '\n' + orchestrator
    + '\nconst originalRefresh=refreshBlocklistRuleset;'
    + '\nrefreshBlocklistRuleset=(...args)=>serializeSubsystem("refreshBlocklistRuleset",()=>originalRefresh(...args));'
    + '\nthis.api={blocklist:refreshBlocklistRuleset,refresh:refreshExtensionState,retry:retryDegradedReconcileOnWake,'
    + 'ownId:DYNAMIC_RULE_BASE,cache:()=>__blocklistRulesetStateKey,error:()=>__blocklistRulesetError,'
    + 'key:()=>__refreshExtensionStateLastKey,inFlight:()=>__refreshExtensionStateInFlightKey,'
    + 'health:async()=>{const issues=[],cfg=state.config;const addIssue=(severity,text)=>issues.push({severity,text});'
    + health + '\nreturn issues;}};', box);
  state.dynamic = [{ id: box.api.ownId, priority: 3000, action: { type: 'block' }, condition: { requestDomains: ['blocked.test'] } },
    { id: 9000000, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['other.test'] } }];
  return { api: box.api, state };
}
async function refresh(w) {
  const reads = w.state.reads;
  w.api.refresh();
  await tick();
  await until(() => w.state.reads > reads && !w.api.inFlight());
}
async function run() {
  for (const failure of ['failWrites', 'failReads', 'failStatic']) {
    const w = world();
    w.state[failure] = 1;
    assert.equal(await w.api.blocklist({ enabled: false }), false, failure);
    assert.equal(w.api.cache(), '');
    assert(w.api.error().includes('rejected'));
    assert(w.state.dynamic.some(rule => rule.id === w.api.ownId));
    await w.api.blocklist({ enabled: false });
    assert(w.api.cache().startsWith('0|'));
    assert.equal(w.api.error(), '');
    assert.deepEqual(w.state.dynamic.map(rule => rule.id), [9000000]);
    const writes = w.state.writes, statics = w.state.staticWrites;
    await w.api.blocklist({ enabled: false });
    assert.equal(w.state.writes, writes, 'a completed shutdown remains cached');
    assert.equal(w.state.staticWrites, statics);
    if (failure === 'failWrites') assert.equal(writes, 2, 'failed removal retries the same disabled request');
  }
  {
    const w = world();
    let release;
    w.state.hold = new Promise(resolve => { release = resolve; });
    const pending = w.api.blocklist({ enabled: false });
    await tick();
    assert.equal(w.state.writes, 1);
    assert.equal(w.api.cache(), '', 'an in-flight removal is not a completed shutdown');
    release();
    await pending;
    assert(w.api.cache().startsWith('0|'));
  }
  {
    const w = world();
    await w.api.blocklist({ enabled: false });
    w.state.failStatic = 1;
    assert.equal(await w.api.blocklist({ enabled: true }), false);
    assert.equal(w.api.cache(), '', 'failure invalidates a previous applied-state cache');
    const statics = w.state.staticWrites;
    await w.api.blocklist({ enabled: false });
    assert.equal(w.state.staticWrites, statics + 1, 'returning to an older state still reconciles');
  }
  for (const [field, result] of [['learnedResult', { ok: false, error: 'learned update rejected' }], ['trackerResult', false]]) {
    const w = world();
    w.state[field] = result;
    assert.equal(await w.api.blocklist({ enabled: true }), false);
    assert.equal(w.api.cache(), '');
    w.state[field] = undefined;
    await w.api.blocklist({ enabled: true });
    assert(w.api.cache().startsWith('1|'));
  }
  {
    const w = world();
    let release;
    w.state.trackerHold = new Promise(resolve => { release = resolve; });
    const pending = w.api.blocklist({ enabled: true });
    await tick();
    assert.equal(w.api.cache(), '', 'enable waits for tracker rule application too');
    release();
    await pending;
    assert(w.api.cache().startsWith('1|'));
  }
  {
    const w = world();
    w.state.config.enabled = true;
    await refresh(w);
    assert(w.api.key());
    w.state.config.enabled = false;
    w.state.failWrites = 1;
    await refresh(w);
    assert.equal(w.api.key(), '');
    assert.equal(w.api.cache(), '');
    assert.deepEqual(w.state.session.wardenone_reconcile_degraded.failed, ['blocklistRulesets']);
    assert((await w.api.health()).some(issue => /could not finish switching off/.test(issue.text)));
    await refresh(w);
    assert(w.api.key() && w.api.cache().startsWith('0|'));
    assert(!w.state.session.wardenone_reconcile_degraded);
    assert(!w.state.dynamic.some(rule => rule.id === w.api.ownId));
    assert(!(await w.api.health()).some(issue => /could not finish switching off/.test(issue.text)));
  }
  {
    const w = world();
    await refresh(w);
    assert(w.api.key());
    w.state.config.enabled = true;
    w.state.learnedResult = { ok: false, error: 'learned update rejected' };
    await refresh(w);
    assert.equal(w.api.key(), '');
    assert(w.state.enabled.length > 0, 'a failed enable can leave static rules partially applied');
    w.state.config.enabled = false;
    w.state.learnedResult = undefined;
    const statics = w.state.staticWrites;
    await refresh(w);
    assert.equal(w.state.staticWrites, statics + 1, 'the reconciler cannot reuse the earlier disabled cache');
    assert.equal(w.state.enabled.length, 0);
    assert(!w.state.session.wardenone_reconcile_degraded);
  }
  {
    const w = world();
    w.state.failWrites = 1;
    await refresh(w);
    w.state.session.wardenone_reconcile_degraded.at = Date.now() - 120000;
    const cold = world({ session: w.state.session });
    await until(() => !!cold.api.key());
    assert(cold.api.cache().startsWith('0|'));
    assert.equal(cold.state.writes, 1, 'a cold wake repairs the failed shutdown');
    assert(!cold.state.session.wardenone_reconcile_degraded);
  }
  console.log('blocklist shutdown retry: rejected reads/writes, state changes, health reporting and cold-wake recovery passed');
  process.exitCode = 0;
}
run().catch(error => { console.error(error); process.exitCode = 1; });

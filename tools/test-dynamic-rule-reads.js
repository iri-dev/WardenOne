/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Share filtered dynamic-rule reads across appliers and skip writes when the installed bands match.
   Run: node tools/test-dynamic-rule-reads.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(process.env.WARDENONE_BACKGROUND || path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
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
  return src.slice(i, j);
}
const has = (name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(BG);
/* On the pre-fix source the helpers the fix introduced are absent; the stand-ins are what the
   old worker did, so a control run reports the old cost instead of a missing symbol. */
const orElse = (name, fallback) => (has(name) ? grabFn(BG, name) : fallback);
function constLine(name) {
  const m = new RegExp('^(?:const|let) ' + name + ' = [^;]+;', 'm').exec(BG);
  assert(m, 'missing const ' + name);
  return m[0];
}

const BAND_CONSTS = [
  'CNAME_RULE_BASE', 'CNAME_RULES_BUDGET',
  'TRACKER_RULES_BUDGET', 'USER_RULES_BUDGET', 'FIREWALL_RULES_BUDGET', 'USER_BLOCKLIST_RULES_BUDGET',
  'DYNAMIC_RULE_BASE', 'MAX_DYNAMIC', 'OPTION_RULE_BASE', 'OPTION_RULES_MAX',
  'LEARNED_RULE_BASE', 'LEARNED_MAX', 'TRACKER_RULE_BASE', 'TRACKER_RULE_MAX',
  'GRABBER_FEED_RULE_BASE', 'GRABBER_FEED_MAX', 'GRABBER_NAV_RULE_ID', 'GRABBER_MALWARE_NAV_RULE_ID',
  'MINER_FEED_RULE_BASE', 'MINER_FEED_MAX', 'MINER_POOL_RULE_OFFSET',
  'NEVER_BLOCK_ALLOW_RULE_BASE', 'NEVER_BLOCK_ALLOW_MAX', 'USER_RULE_BASE', 'USER_RULE_MAX',
  'FIREWALL_RULE_BASE', 'FIREWALL_RULE_MAX', 'USER_BLOCKLIST_RULE_BASE',
  'FINGERPRINT_SCRIPT_RULE_BASE', 'FINGERPRINT_SCRIPT_RULE_MAX', 'GOOGLE_SEARCH_ALLOW_RULE_BASE', 'GOOGLE_SEARCH_ALLOW_RULE_MAX',
  'SCRIPT_SHIELD_RULE_BASE', 'SCRIPT_SHIELD_RULE_MAX',
  'HTTPS_UPGRADE_RULE_ID', 'HTTPS_UPGRADE_DYNAMIC_RULE_ID', 'HTTPS_UPGRADE_RESOURCE_TYPES', 'HTTPS_UPGRADE_EXCLUDED_DOMAINS',
  'ADSHIELD_STATIC_RULESET_ID', 'SPOTIFY_MEDIA_RULESET_ID', 'TRACKERS_STATIC_RULESET_ID', 'EASYPRIVACY_STATIC_RULESET_ID',
  'CNAME_STATIC_RULESET_ID',
];
/* The shared read, from the band read to the next declaration after it. */
const BAND_READ = between(BG, 'async function getDynamicRulesInBand(', '\nconst MEDIA_COMPAT_RULE_BASE', 'the band read');
const ORCHESTRATOR = between(BG, 'const RECONCILE_DEGRADED_KEY = ', '\nfunction searchAiCleanupActive', 'the reconciler');
const SERIALIZE = between(BG, 'const __subsystemQueues = new Map();', '/* Boot-time appliers run only now', 'the applier queues');
/* What the reconcile runs, by component and function: the dynamic owners below are the real
   code; everything else it runs is a no-op here, as none of it touches dynamic rules. */
const RUN_CALLS = [...ORCHESTRATOR.matchAll(/run\('([A-Za-z]+)', (?:\((?:submitRules)?\) => )?([A-Za-z]+)\(/g)].map((m) => ({ name: m[1], fn: m[2] }));
const REAL = [
  'dnrValueMatches', 'dnrBandUnchanged',
  'readFeedConfig', 'grabberFeedDisabled', 'minerFeedDisabled', 'masterSwitchOn',
  'applyNeverBlockAllowRules', 'applyUserBlocklistRules', 'applyGrabberFeedRules', 'applyMinerFeedRules',
  'applyLearnedRules', 'applyTrackerLearnerRules', 'wardenBlockRuleLive',
  'httpsUpgradeRule', 'applyHttpsUpgradeRule', 'applyScriptShieldRules',
  'applyFingerprintScriptRules', 'applyGoogleSearchSponsoredAllowRules',
  'applyUserFilterRulesFrom', 'applyUserFilterRules', 'applyFirewallRulesFrom', 'applyFirewallRules',
  'userFilterBandStep', 'firewallBandStep', 'userBlocklistBandStep', 'refreshBlocklistRuleset',
];
const LIFTED = [
  fs.readFileSync(path.join(ROOT, 'background-cname.js'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'network-policy.js'), 'utf8'),
  BAND_CONSTS.map(constLine).join('\n'),
  'let __httpsUpgradeRuleEnabled = null; let __scriptShieldRuleUpdate = Promise.resolve();',
  "let __blocklistRulesetStateKey = ''; let __blocklistRulesetError = ''; let ADSHIELD_STATIC_ACTIVE = true;",
  constLine('bandOutcome'),
  orElse('ownDynamicRuleBands', 'function ownDynamicRuleBands() { return []; }'),
  BAND_READ,
  orElse('writeDynamicRules', 'function writeDynamicRules(change) { return chrome.declarativeNetRequest.updateDynamicRules(change); }'),
  REAL.map((name) => grabFn(BG, name)).join('\n'),
  ORCHESTRATOR,
  SERIALIZE,
].join('\n');

/* ---- the browser: its rules persist across wakes -------------------------------------- */
const REMOTE_RULES = 3000;
function browser() {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const state = {
    dynamic: new Map(), session: new Map(), enabledRulesets: new Set(),
    config: { enabled: true, trackerLearner: true, forceHttps: false },
    learned: { 'tracked.example': { hits: 3, firstSeen: 1, reason: 'learned' } },
    tracker: { domains: { 'pixel.example': { state: 'learned', hits: 4 } }, siteControls: {} },
    blocklist: [{ domain: 'blocked.example', scope: 'permanent' }],
    userRules: [],
    firewall: {},
    session_storage: {},
    counts: { reads: 0, unfiltered: 0, remoteRead: 0, writes: 0, emptyWrites: 0, idsAsked: 0 },
    failNextRead: false,
    failNextWrite: false,
    holdReads: false, held: [], holdWrites: false, heldWrites: [],
    clock: 1e12,
  };
  /* The remote lists: dynamic rules no band reads. */
  for (let i = 0; i < REMOTE_RULES; i++) {
    const id = 10000 + i;
    state.dynamic.set(id, { id, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['list' + i + '.example'] } });
  }
  const isRemote = (id) => (id >= 10000 && id < 28000) || (id >= 600000 && id < 604000);
  const answerRead = (filter) => {
    const ids = filter && Array.isArray(filter.ruleIds) ? new Set(filter.ruleIds) : null;
    const out = [...state.dynamic.values()].filter((r) => !ids || ids.has(r.id));
    state.counts.remoteRead += out.filter((r) => isRemote(r.id)).length;
    return out.map(clone);
  };
  const chrome = {
    runtime: { lastError: null, id: 'self' },
    declarativeNetRequest: {
      getDynamicRules(filter) {
        state.counts.reads++;
        if (!filter || !Array.isArray(filter.ruleIds)) state.counts.unfiltered++;
        else state.counts.idsAsked = Math.max(state.counts.idsAsked, filter.ruleIds.length);
        if (state.failNextRead) {
          state.failNextRead = false;
          return Promise.reject(new Error('Internal error while reading dynamic rules.'));
        }
        /* A held read is answered later with what Chrome held when it took the call. */
        const answer = answerRead(filter);
        if (state.holdReads) return new Promise((resolve) => state.held.push(() => resolve(answer)));
        return Promise.resolve(answer);
      },
      updateDynamicRules(change) {
        state.counts.writes++;
        if (!(change.removeRuleIds || []).length && !(change.addRules || []).length) state.counts.emptyWrites++;
        if (state.failNextWrite) {
          state.failNextWrite = false;
          return Promise.reject(new Error('Internal error while updating dynamic rules.'));
        }
        const apply = () => {
          for (const id of (change.removeRuleIds || [])) state.dynamic.delete(id);
          for (const r of (change.addRules || [])) state.dynamic.set(r.id, clone(r));
        };
        /* A held write lands only when released: a read Chrome answers meanwhile predates it. */
        if (state.holdWrites) return new Promise((resolve) => state.heldWrites.push(() => { apply(); resolve(); }));
        apply();
        return Promise.resolve();
      },
      getSessionRules(filter) {
        const ids = filter && Array.isArray(filter.ruleIds) ? new Set(filter.ruleIds) : null;
        return Promise.resolve([...state.session.values()].filter((r) => !ids || ids.has(r.id)).map(clone));
      },
      updateSessionRules(change) {
        for (const id of (change.removeRuleIds || [])) state.session.delete(id);
        for (const r of (change.addRules || [])) state.session.set(r.id, clone(r));
        return Promise.resolve();
      },
      updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }) {
        for (const id of disableRulesetIds) state.enabledRulesets.delete(id);
        for (const id of enableRulesetIds) state.enabledRulesets.add(id);
        return Promise.resolve();
      },
    },
  };
  const sessionArea = {
    get: (key) => Promise.resolve(state.session_storage[key] === undefined ? {} : { [key]: clone(state.session_storage[key]) }),
    set: (items) => { Object.assign(state.session_storage, clone(items)); return Promise.resolve(); },
    remove: (keys) => { for (const k of [].concat(keys)) delete state.session_storage[k]; return Promise.resolve(); },
  };
  return { state, chrome, clone, sessionArea, isRemote };
}

/* ---- one worker life: a fresh realm on the same browser --------------------------------- */
function worker(b) {
  const { state, clone } = b;
  class ClockDate extends Date { static now() { return state.clock; } }
  const warnings = [];
  const sandbox = {
    chrome: b.chrome, console: { warn: (...a) => warnings.push(a.join(' ')), log() {} },
    Promise, Map, Set, Array, Object, String, Number, Boolean, JSON, Math, Error, RegExp, Date: ClockDate,
    setTimeout, clearTimeout,
    localGet: async (key) => (key === 'wardenone_config' ? { wardenone_config: clone(state.config) } : {}),
    localSet: async () => {},
    sessionArea: () => b.sessionArea,
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true, blockGrabberResources: true, warnGrabberDomains: true, blockMalwareSites: true, blockCryptominers: true },
    NEVER_BLOCK_DOMAINS: new Set(['figma.com', 'notion.so', 'slack.com']),
    NEVER_BLOCK_ALLOW_EXCLUDE: new Set(['google.com']),
    USER_BLOCKLIST_KEY: 'wardenone_blocklist',
    readUserBlocklist: async () => clone(state.blocklist),
    pruneExpiredBlocks: (entries) => ({ live: entries, lapsed: [] }),
    userBlockRulesFrom: (entries) => entries.map((e, i) => ({ id: 970000 + i, priority: 99000, action: { type: 'block' }, condition: { requestDomains: [e.domain], resourceTypes: ['main_frame'] } })),
    GRABBER_FEED_DOMAINS: new Set(['grab1.example', 'grab2.example']), GRABBER_FEED_RULE_HOSTS: new Map(),
    __grabberFeedReady: true, __minerFeedReady: true,
    MINER_HOSTS: new Set(['miner.example']), MINER_POOL_HOSTS: new Set(['pool.example']),
    MINER_RESOURCE_TYPES: ['script'], MINER_POOL_RESOURCE_TYPES: ['websocket'],
    LEARNED: clone(state.learned),
    normalizeLearnedDomain: (d) => String(d || '').toLowerCase(), normalizeUserBlockDomain: (d) => String(d || '').toLowerCase(),
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [], hostMatchesAllowlist: () => false,
    TRACKER_LEARNER: clone(state.tracker), normalizeTrackerDomain: (d) => String(d || '').toLowerCase(), TRACKER_RESOURCE_TYPES: ['script', 'image'],
    hydrateSmartScriptRecoveryTabs: async () => true, getScriptShieldMode: async () => 'smart', getTrustedScriptHosts: async () => [],
    resetSmartScriptRecoveryState: () => {}, smartScriptRecoveredTabEntries: () => [],
    buildScriptShieldRulePlan: () => ({ dynamicRules: [], sessionRules: [{ id: 930000, priority: 1000, action: { type: 'block' }, condition: { resourceTypes: ['script'] } }] }),
    FINGERPRINT_LIBRARY_DOMAIN_FILTERS: ['fpjs.example'], FRAUD_VENDOR_DOMAIN_FILTERS: ['fraud.example'],
    FINGERPRINT_LIBRARY_URL_FILTERS: ['/fp.min.js'], FRAUD_VENDOR_URL_FILTERS: ['/fraud.js'],
    FINGERPRINT_SCRIPT_RESOURCE_TYPES: ['script'], LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.example'],
    GOOGLE_SEARCH_SPONSORED_DOMAINS: ['ads.example'], GOOGLE_SEARCH_SPONSORED_PATH_FILTERS: ['/aclk'],
    GOOGLE_SEARCH_INITIATOR_DOMAINS: ['google.com'], RESOURCE_TYPES: ['script', 'image'],
    userFilterBundle: async () => ({ network: clone(state.userRules), cosmetic: [], errors: [] }),
    readFirewall: async () => clone(state.firewall),
    firewallRulesFrom: (matrix) => Object.keys(matrix).map((site, i) => ({ id: 950000 + i, priority: 97000, action: { type: 'block' }, condition: { requestDomains: [matrix[site]], initiatorDomains: [site] } })),
    firewallClearSession: async () => ({ ok: true }), firewallErrorText: (e) => String(e),
    removeWardenOneDynamicRules: async () => {},
    locationExemptHosts: () => [], scheduleSitePauseExpiry: () => {},
    eyeShieldThemingActive: () => false, eyeShieldPreloadFile: () => '', eyeShieldUsesBootstrap: () => false,
    resourceSaverScriptFiles: () => [],
    eyeShieldActiveProfileHosts: () => [], eyeShieldRegistrationScope: () => ({ matches: [], excludeMatches: [] }),
    consentRejectActive: () => false, searchSponsoredCleanupActive: () => false,
  };
  const realNames = new Set(REAL.concat(['createReconcileDnrBatch', 'refreshExtensionState']));
  for (const { fn } of RUN_CALLS) if (!realNames.has(fn) && !(fn in sandbox)) sandbox[fn] = () => Promise.resolve(undefined);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nglobalThis.api = { getDynamicRulesInBand, writeDynamicRules, refreshExtensionState,'
    + ' wake: () => Promise.all([applyNeverBlockAllowRules(), applyUserBlocklistRules(), applyGrabberFeedRules(),'
    + ' applyMinerFeedRules(), applyLearnedRules(), applyTrackerLearnerRules()]),'
    + ' applyLearnedRules: (...a) => applyLearnedRules(...a), wardenBlockRuleLive, applyScriptShieldRules: () => applyScriptShieldRules() };',
  sandbox, { filename: 'worker.js' });
  return { api: sandbox.api, sandbox, warnings };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 30));
function counting(b, task) {
  const before = Object.assign({}, b.state.counts);
  return Promise.resolve(task()).then(() => settle()).then(() => {
    const d = {};
    for (const k of Object.keys(b.state.counts)) d[k] = b.state.counts[k] - (k === 'idsAsked' ? 0 : before[k]);
    return d;
  });
}
/* A browser start: the six appliers every wake runs, plus what onStartup adds -- Script Shield
   and the reconcile, which runs every component once in a fresh worker. */
function startup(b) {
  const w = worker(b);
  return { w, run: () => Promise.all([w.api.wake(), w.api.applyScriptShieldRules(), Promise.resolve(w.api.refreshExtensionState())]).then(() => settle(80)) };
}

(async () => {
  check('the reconcile list is where the suite expects it', RUN_CALLS.length >= 24 && RUN_CALLS.some((r) => r.fn === 'applyHttpsUpgradeRule'), String(RUN_CALLS.length));

  /* ---- 1. the first browser start installs; every one after reads once and writes nothing */
  const b = browser();
  const first = startup(b);
  const install = await counting(b, first.run);
  const installed = [...b.state.dynamic.keys()].filter((id) => !b.isRemote(id)).length;
  check('the first start installs the bands', installed >= 8 && b.state.dynamic.has(741000) && b.state.dynamic.has(745000), installed + ' band rules');
  check('no read asks for every dynamic rule, even on the first start', install.unfiltered === 0, JSON.stringify(install));

  const second = await counting(b, startup(b).run);
  check('a browser start to unchanged state reads the dynamic rules once', second.reads === 1, JSON.stringify(second));
  check('and writes none: no rewritten band, no empty write', second.writes === 0 && second.emptyWrites === 0, JSON.stringify(second));
  check('and is handed none of the remote-list rules', second.remoteRead === 0, second.remoteRead + ' remote rules read');

  let quietWakes = 0;
  let noisy = null;
  for (let i = 0; i < 20; i++) {
    const d = await counting(b, () => worker(b).api.wake());
    if (d.reads === 1 && d.writes === 0 && d.unfiltered === 0 && d.remoteRead === 0) quietWakes++;
    else if (!noisy) noisy = d;
  }
  check('twenty cold wakes each read the dynamic rules once and write nothing', quietWakes === 20, JSON.stringify(noisy));

  {
    /* The appliers on a wake do not ask in one tick: storage, packaged files and the queue spread
       them out. Run one after another, they still share the read. */
    const w = worker(b);
    const d = await counting(b, async () => {
      for (const name of ['applyNeverBlockAllowRules', 'applyUserBlocklistRules', 'applyGrabberFeedRules', 'applyMinerFeedRules', 'applyLearnedRules', 'applyTrackerLearnerRules']) {
        await vm.runInContext(name + '()', w.sandbox);
        await settle(5);
      }
    });
    check('appliers that ask one after another on a wake still share one read', d.reads === 1, JSON.stringify(d));
  }
  {
    const ids = b.state.counts.idsAsked;
    check('the shared read asks for WardenOne\'s own bands only, by id', ids > 0 && ids < 10000, ids + ' ids');
  }

  /* ---- 2. a change is still seen and written --------------------------------------------- */
  {
    b.state.blocklist.push({ domain: 'second.example', scope: 'permanent' });
    const d = await counting(b, startup(b).run);
    check('a band that changed is written once on the next start', d.writes === 1 && b.state.dynamic.has(970001), JSON.stringify(d));
    const after = await counting(b, () => worker(b).api.wake());
    check('and the wake after it is quiet again', after.reads === 1 && after.writes === 0, JSON.stringify(after));
  }
  {
    /* External loss: the grabber band went missing outside the worker. */
    for (const id of [...b.state.dynamic.keys()]) if (id >= 740000 && id <= 741001) b.state.dynamic.delete(id);
    const d = await counting(b, () => worker(b).api.wake());
    check('a band lost outside WardenOne is put back on the next wake', d.writes === 1 && b.state.dynamic.has(741000), JSON.stringify(d));
  }
  {
    b.state.config.forceHttps = true;
    const d = await counting(b, startup(b).run);
    check('Force HTTPS turned on writes its persistent rule', b.state.dynamic.has(910001) && d.writes >= 1, JSON.stringify(d));
    const again = await counting(b, startup(b).run);
    check('and the next start leaves it in place without writing', again.writes === 0 && b.state.dynamic.has(910001), JSON.stringify(again));
    b.state.config.forceHttps = false;
    await counting(b, startup(b).run);
    check('turned off, it is removed', !b.state.dynamic.has(910001));
  }
  {
    /* My Rules: an edit that drops an option keeps every field the new rule sets. */
    b.state.userRules = [{ id: 750000, priority: 97000, action: { type: 'block' }, condition: { urlFilter: '||ads.example^', resourceTypes: ['script'], domainType: 'thirdParty' } }];
    await counting(b, startup(b).run);
    check('a reader rule is installed', !!b.state.dynamic.get(750000) && b.state.dynamic.get(750000).condition.domainType === 'thirdParty');
    b.state.userRules = [{ id: 750000, priority: 97000, action: { type: 'block' }, condition: { urlFilter: '||ads.example^', resourceTypes: ['script'] } }];
    const w = worker(b);
    const res = await vm.runInContext('applyUserFilterRules()', w.sandbox);
    check('an edit that only drops a field from a reader rule is still written', res && res.ok === true && !('domainType' in b.state.dynamic.get(750000).condition), JSON.stringify(b.state.dynamic.get(750000)));
    const quiet = await counting(b, startup(b).run);
    check('and an unchanged reader band is not rewritten at the next start', quiet.writes === 0, JSON.stringify(quiet));
  }

  /* ---- 3. the shared read is never stale --------------------------------------------------- */
  {
    const w = worker(b);
    b.state.learned['newly.example'] = { hits: 9, firstSeen: 2, userBlocked: true };
    w.sandbox.LEARNED = b.clone(b.state.learned);
    const before = await w.api.wardenBlockRuleLive('newly.example');
    const applied = await w.api.applyLearnedRules();
    const live = await w.api.wardenBlockRuleLive('newly.example');
    check('a rule written on this wake is seen by the next read: "Block this site" verifies against Chrome, not the old read',
      before === false && applied && applied.ok === true && live === true, JSON.stringify({ before, applied, live }));
  }
  {
    /* A read in flight while a write is sent may predate it; a caller after the write must not get it. */
    const w = worker(b);
    b.state.holdReads = true;
    const early = w.api.getDynamicRulesInBand(700000, 2000);
    const write = w.api.writeDynamicRules({ removeRuleIds: [700500], addRules: [{ id: 700500, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['late.example'] } }] });
    await write;
    const late = w.api.getDynamicRulesInBand(700000, 2000);
    b.state.holdReads = false;
    for (const release of b.state.held.splice(0)) release();
    const [earlyRules, lateRules] = await Promise.all([early, late]);
    check('a caller after a write gets a read made after it, not the one in flight when it was sent', lateRules.some((r) => r.id === 700500), JSON.stringify(lateRules.map((r) => r.id)));
    check('and the earlier caller still gets its own answer, from before the write', !earlyRules.some((r) => r.id === 700500));
    await w.api.writeDynamicRules({ removeRuleIds: [700500], addRules: [] });
  }
  {
    /* The other order: a read made while a write is still in flight, which Chrome may answer
       from before the write. Once the write settles, that read must not be reused. */
    const w = worker(b);
    b.state.holdWrites = true;
    const write = w.api.writeDynamicRules({ removeRuleIds: [], addRules: [{ id: 700600, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['pending.example'] } }] });
    const during = await w.api.getDynamicRulesInBand(700000, 2000);
    b.state.holdWrites = false;
    for (const release of b.state.heldWrites.splice(0)) release();
    await write;
    const after = await w.api.getDynamicRulesInBand(700000, 2000);
    check('a read made while a write was in flight is dropped when the write settles',
      !during.some((r) => r.id === 700600) && after.some((r) => r.id === 700600), JSON.stringify({ during: during.map((r) => r.id), after: after.map((r) => r.id) }));
    await w.api.writeDynamicRules({ removeRuleIds: [700600], addRules: [] });
  }
  {
    const w = worker(b);
    b.state.failNextRead = true;
    const d = await counting(b, async () => {
      let failed = false;
      try { await w.api.getDynamicRulesInBand(745000, 200); } catch (_) { failed = true; }
      check('a failed shared read reaches its caller as a failure', failed);
      await w.api.getDynamicRulesInBand(745000, 200);
    });
    check('is not kept, and is asked again filtered, never as a read of every rule', d.reads === 2 && d.unfiltered === 0, JSON.stringify(d));
  }
  {
    const w = worker(b);
    const before = JSON.stringify([...b.state.dynamic]);
    const change = { removeRuleIds: [], addRules: [{ id: 700700, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['retry.example'] } }] };
    const d = await counting(b, async () => {
      await w.api.getDynamicRulesInBand(700000, 2000);
      b.state.failNextWrite = true;
      await assert.rejects(w.api.writeDynamicRules(change), /updating dynamic rules/);
      check('a rejected write leaves the installed rules authoritative', JSON.stringify([...b.state.dynamic]) === before);
      const after = await w.api.getDynamicRulesInBand(700000, 2000);
      check('a rejected write does not publish the desired rule as applied', !after.some((rule) => rule.id === 700700));
    });
    check('a rejected write invalidates the shared read and the next read asks Chrome again', d.reads === 2 && d.writes === 1, JSON.stringify(d));
    await w.api.writeDynamicRules(change);
    const retried = await w.api.getDynamicRulesInBand(700000, 2000);
    check('the same worker can retry a rejected write and verify the installed rule', retried.some((rule) => rule.id === 700700));
    await w.api.writeDynamicRules({ removeRuleIds: [700700], addRules: [] });
  }
  {
    const w = worker(b);
    const d = await counting(b, async () => {
      await w.api.getDynamicRulesInBand(745000, 200);
      await w.api.getDynamicRulesInBand(970000, 64);
      b.state.clock += 60 * 1000;
      await w.api.getDynamicRulesInBand(745000, 200);
    });
    check('a long-lived worker does not answer from a minute-old read', d.reads === 2, JSON.stringify(d));
  }
  {
    const w = worker(b);
    const d = await counting(b, () => w.api.getDynamicRulesInBand(500000, 10));
    check('a band nobody listed is read on its own, filtered', d.reads === 1 && d.unfiltered === 0 && d.remoteRead === 0, JSON.stringify(d));
  }

  /* ---- 4. the source ----------------------------------------------------------------------- */
  {
    const listed = has('ownDynamicRuleBands') ? vm.runInNewContext(BAND_CONSTS.map(constLine).join('\n') + '\n' + grabFn(BG, 'ownDynamicRuleBands') + '\nownDynamicRuleBands();') : [];
    const covered = (base, size) => listed.some(([first, count]) => base >= first && base + size <= first + count);
    const consts = vm.runInNewContext(BAND_CONSTS.map(constLine).join('\n') + '\n({' + BAND_CONSTS.join(',') + '})');
    const calls = [...BG.matchAll(/getDynamicRulesInBand\(([A-Z_]+), ([A-Z_0-9]+)\)/g)].map((m) => ({ text: m[0], base: consts[m[1]], size: /^\d+$/.test(m[2]) ? Number(m[2]) : consts[m[2]] }));
    const passed = [...BG.matchAll(/\(readRules \|\| getDynamicRulesInBand\)\(([A-Z_]+), ([A-Z_]+)\)/g)].map((m) => ({ text: m[0], base: consts[m[1]], size: consts[m[2]] }));
    const all = calls.concat(passed);
    check('the source has the band reads the suite expects', all.length >= 14, String(all.length));
    const unlisted = all.filter((c) => !Number.isInteger(c.base) || !Number.isInteger(c.size) || !covered(c.base, c.size));
    check('every band the worker reads is in the shared read, so none costs a parse of its own', unlisted.length === 0, unlisted.map((c) => c.text).join(' | '));
    const remote = listed.filter(([first, count]) => first < consts.DYNAMIC_RULE_BASE + consts.MAX_DYNAMIC && first + count > consts.DYNAMIC_RULE_BASE
      || first < consts.OPTION_RULE_BASE + consts.OPTION_RULES_MAX && first + count > consts.OPTION_RULE_BASE);
    check('the shared read never asks for the remote lists', listed.length > 0 && remote.length === 0, JSON.stringify(remote));
  }
  {
    const direct = [...BG.matchAll(/chrome\.declarativeNetRequest\.updateDynamicRules\(/g)].map((m) => BG.slice(0, m.index).split('\n').length);
    const inHelper = has('writeDynamicRules') ? grabFn(BG, 'writeDynamicRules') : '';
    check('every dynamic-rule write goes through writeDynamicRules, which drops the shared read',
      direct.length === 1 && /chrome\.declarativeNetRequest\.updateDynamicRules\(/.test(inHelper), 'direct writes at lines ' + direct.join(', '));
    check('the helper drops the read when the write is sent and again when it settles',
      /__ownDynamicRulesRead = null;\s*WONetworkPolicy\.validate\(change, 'dynamic'\);/.test(inHelper)
      && /const forget = \(\) => \{\s*__ownDynamicRulesRead = null;/.test(inHelper) && /then\(forget, forget\)/.test(inHelper));
    const others = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js') && f !== 'background.js')
      .concat(fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f))
      .filter((f) => /updateDynamicRules\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    check('nothing else in the extension writes dynamic rules, so only the worker can make the read stale', others.length === 0, others.join(', '));
  }
  {
    const band = BAND_READ;
    check('neither the band read nor the shared read ever asks for every rule', !/getDynamicRules\(\)/.test(band) && /getDynamicRules\(\{ ruleIds: __ownDynamicRuleIds \}\)/.test(band));
    check('a failed shared read is dropped, not answered with a wider read', /\.catch\(\(\) => \{ if \(__ownDynamicRulesRead === entry\) __ownDynamicRulesRead = null; \}\)/.test(band));
    check('the reconcile reads its dynamic bands through the shared read', /applyFingerprintScriptRules\([^\n]*getDynamicRulesInBand, submitRules\)/.test(ORCHESTRATOR)
      && /applyGoogleSearchSponsoredAllowRules\([^\n]*getDynamicRulesInBand, submitRules\)/.test(ORCHESTRATOR));
  }

  console.log('');
  if (failures.length) {
    console.log(failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  console.log('  ok  ' + pass + ' checks: one dynamic-rule read per wake and per browser start, no write that changes nothing, and the shared read is never stale');
})().catch((e) => { console.error(e); process.exit(1); });

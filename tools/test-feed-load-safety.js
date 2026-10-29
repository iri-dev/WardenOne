/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Incomplete feed loads must retain installed rules and retry without publishing a partial set. (LIFE-02)
   Run: node tools/test-feed-load-safety.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dynamicRuleIo = require('./lib/dynamic-rule-io.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished: something never answered'); });

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
const has = (src, name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(src);
/* On the pre-fix source the helpers the fix introduced are absent; the stand-ins reproduce what
   the old loaders did, so a control run reports the old behaviour instead of a missing symbol. */
const orElse = (name, fallback) => (has(BG, name) ? grabFn(BG, name) : fallback);
const constLine = (name, fallback) => { const m = new RegExp('^const ' + name + ' = [^;]+;', 'm').exec(BG); return m ? m[0] : fallback; };

const LIFTED = [
  constLine('GRABBER_FEED_RULE_BASE'), constLine('GRABBER_FEED_MAX'), constLine('GRABBER_NAV_RULE_ID'),
  constLine('GRABBER_MALWARE_NAV_RULE_ID'),
  constLine('MINER_FEED_RULE_BASE'), constLine('MINER_FEED_MAX'), constLine('MINER_POOL_RULE_OFFSET'),
  constLine('SUPPLEMENTAL_LIST_STORAGE_KEY'),
  BG.slice(BG.indexOf('const FEED_LOAD_RETRY_MS = '), BG.indexOf('/* In place: readers hold the Set itself')),
  'const GRABBER_FEED_DOMAINS = new Set(); const GRABBER_FEED_RULE_HOSTS = new Map(); const MINER_HOSTS = new Set(); const MINER_POOL_HOSTS = new Set();',
  grabFn(BG, 'dnrValueMatches'), grabFn(BG, 'dnrBandUnchanged'),
  has(BG, 'getDynamicRulesInBand') ? dynamicRuleIo.prelude(BG, [[740000, 1000], [741000, 1], [741001, 1], [742000, 1000]])
    : 'async function getDynamicRulesInBand() { return chrome.declarativeNetRequest.getDynamicRules(); }',
  orElse('localGetStrict', 'function localGetStrict(keys) { return localGet(keys); }'),
  orElse('replaceFeedSet', 'function replaceFeedSet(t, n) { t.clear(); for (const v of n) t.add(v); }'),
  orElse('readFeedConfig', "async function readFeedConfig() { const s = await localGet('wardenone_config'); return Object.assign({}, DEFAULT_CONFIG, (s && s.wardenone_config) || {}); }"),
  orElse('grabberFeedDisabled', 'function grabberFeedDisabled(cfg) { return cfg.enabled === false || (cfg.blockGrabberResources === false && cfg.warnGrabberDomains === false && cfg.blockMalwareSites === false); }'),
  orElse('minerFeedDisabled', 'function minerFeedDisabled(cfg) { return cfg.enabled === false || cfg.blockCryptominers === false; }'),
  grabFn(BG, 'addGrabberFeedDomains'), grabFn(BG, 'applyGrabberFeedRules'), grabFn(BG, 'loadGrabberFeed'),
  grabFn(BG, 'addMinerDomains'), grabFn(BG, 'applyMinerFeedRules'), grabFn(BG, 'loadMinerFeed'),
].join('\n');

/* ---- the browser: rules, storage and the packaged files persist; a worker realm does not ---- */
function browser() {
  const state = {
    dynamic: new Map(),
    local: {
      wardenone_grabber_domains: ['grab3.example'],
      wardenone_aux_lists: { grabberDomainsExtra: ['grab4.example'] },
      wardenone_cryptominer_domains: { minerHosts: ['m2.example'], poolHosts: [] },
    },
    config: { enabled: true, blockGrabberResources: true, warnGrabberDomains: true, blockMalwareSites: true, blockCryptominers: true },
    packaged: {
      'grabber-extra.json': { domains: ['grab1.example', 'grab2.example'] },
      'cryptominer-domains.json': { minerHosts: ['m1.example'], poolHosts: ['p1.example'] },
    },
    packagedFails: false, storageFails: false,
    counts: { writes: 0, warns: 0 },
    timers: [], timerId: 0, alarms: new Map(), session: {}, now: Date.now(),
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const chrome = {
    runtime: { lastError: null, getURL: (p) => 'chrome-extension://wo/' + p },
    storage: {
      session: {
        async get(keys) {
          if (state.checkpointReadFails) throw Error('checkpoint read');
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in state.session).map((key) => [key, clone(state.session[key])]));
        },
        async set(values) {
          if (state.checkpointWriteFails) throw Error('checkpoint write');
          Object.assign(state.session, clone(values));
          if (state.holdCheckpointAck) await state.holdCheckpointAck(values);
        },
        async remove(key) {
          if (state.checkpointRemoveFails) throw Error('checkpoint remove');
          if (state.holdCleanup) await state.holdCleanup(key);
          delete state.session[key];
        },
      },
      local: {
        get(keys, cb) {
          if (state.storageFails) {
            /* As Chrome reports a failed read: lastError set, the callback handed nothing. */
            chrome.runtime.lastError = { message: 'IO error' };
            try { cb(undefined); } finally { chrome.runtime.lastError = null; }
            return;
          }
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) if (state.local[k] !== undefined) out[k] = clone(state.local[k]);
          cb(out);
        },
      },
    },
    alarms: {
      get: async (name) => state.alarms.get(name),
      create: async (name, details) => state.alarms.set(name, { name, scheduledTime: details.when }),
      clear: async (name) => state.alarms.delete(name),
    },
    declarativeNetRequest: {
      getDynamicRules: async (filter) => {
        const ids = filter && Array.isArray(filter.ruleIds) ? new Set(filter.ruleIds) : null;
        return [...state.dynamic.values()].filter((rule) => !ids || ids.has(rule.id)).map(clone);
      },
      updateDynamicRules: async (u) => {
        if (state.ruleWriteFails) throw Error('DNR rejected');
        state.counts.writes++;
        for (const id of (u.removeRuleIds || [])) state.dynamic.delete(id);
        for (const r of (u.addRules || [])) state.dynamic.set(r.id, clone(r));
        if (state.holdRuleAck) await state.holdRuleAck(u);
      },
    },
  };
  const band = (base, max) => [...state.dynamic.keys()].filter((id) => id >= base && id < base + max).sort((a, b) => a - b);
  return {
    state, chrome,
    grabberBand: () => band(740000, 1000),
    minerBand: () => band(742000, 1000),
    grabberDomains: () => band(740000, 1000).map((id) => state.dynamic.get(id).condition.requestDomains[0]).sort(),
    minerDomains: () => band(742000, 1000).map((id) => state.dynamic.get(id).condition.requestDomains[0]).sort(),
  };
}

/* ---- one cold start: a fresh realm on the same browser ------------------------------------- */
function wake(b) {
  const state = b.state;
  const sandbox = {
    chrome: b.chrome,
    console: { warn() { state.counts.warns++; }, log() {}, error() {} },
    Promise, Object, Array, String, Number, Boolean, Set, Map, JSON, Math, Error, TypeError, RegExp,
    Date: class extends Date { static now() { return state.now; } },
    setTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
    fetch: async (url) => {
      state.fetches = (state.fetches || 0) + 1;
      if (state.holdFetch) await state.holdFetch(url);
      if (state.packagedFails) throw new TypeError('Failed to fetch');
      const file = String(url).split('/').pop();
      const data = state.packaged[file];
      return { ok: data !== undefined, status: data !== undefined ? 200 : 404, json: async () => JSON.parse(JSON.stringify(data)) };
    },
    /* localGet as the worker has it: the config from its cache, any other key straight from
       Chrome's callback -- which, on a failed read, is nothing. */
    localGet: (key) => (key === 'wardenone_config'
      && state.configFails ? Promise.resolve({ unreadable: true }) : key === 'wardenone_config'
      ? Promise.resolve({ wardenone_config: JSON.parse(JSON.stringify(state.config)) })
      : new Promise((resolve) => b.chrome.storage.local.get(key, resolve))),
    DEFAULT_CONFIG: { enabled: true, blockGrabberResources: true, warnGrabberDomains: true, blockMalwareSites: true, blockCryptominers: true },
    readReconcileDegraded: async () => null,
    scheduleExtensionStateRefresh() {},
    registrableDomainBg: (host) => { const p = String(host || '').toLowerCase().split('.'); return p.length >= 2 ? p.slice(-2).join('.') : String(host || ''); },
    isNeverBlockDomain: (d) => d === 'google.com',
    isUnsafeFeedBlockTarget: (d) => d === 'co.uk',
    SECURITY_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'],
    MINER_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'],
    MINER_POOL_RESOURCE_TYPES: ['sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'],
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { loadGrabberFeed, loadMinerFeed, applyGrabberFeedRules, applyMinerFeedRules, GRABBER_FEED_DOMAINS, MINER_HOSTS, MINER_POOL_HOSTS };', ctx, { filename: 'feed-wake.js' });
  b.api = sandbox.api;
  return sandbox.api;
}
async function coldStart(b) {
  const api = wake(b);
  await api.loadGrabberFeed();
  await api.loadMinerFeed();
  return api;
}
async function fire(b) {
  b.state.now = Math.min(...Array.from(b.state.alarms.values(), (alarm) => alarm.scheduledTime));
  const due = [...b.state.alarms.values()].filter((alarm) => alarm.scheduledTime <= b.state.now);
  for (const alarm of due) b.state.alarms.delete(alarm.name);
  await Promise.all(due.map((alarm) => alarm.name.endsWith('-grabber') ? b.api.loadGrabberFeed(true) : b.api.loadMinerFeed(true)));
}

(async () => {
  /* ---- a good start builds both bands -------------------------------------------------------- */
  const b = browser();
  const w1 = await coldStart(b);
  check('a complete load builds the grabber band from every source',
    b.grabberDomains().join(',') === 'grab1.example,grab2.example,grab3.example,grab4.example', b.grabberDomains().join(','));
  check('the navigation rule follows the same complete feed',
    b.state.dynamic.get(741000).action.redirect.extensionPath === '/ip-logger-warning.html'
      && b.state.dynamic.get(741000).condition.requestDomains.length === 4);
  check('and the cryptominer band, miners at the head and pools at the tail',
    b.minerDomains().join(',') === 'm1.example,m2.example,p1.example' && b.minerBand().join(',') === '742000,742001,742700',
    b.minerBand().join(','));
  check('the live sets hold what the band holds', w1.GRABBER_FEED_DOMAINS.size === 4 && w1.MINER_HOSTS.size === 2 && w1.MINER_POOL_HOSTS.size === 1);
  check('nothing was logged and no retry is pending', b.state.counts.warns === 0 && b.state.timers.length === 0);
  const goodGrabber = b.grabberDomains().join(',');
  const goodMiner = b.minerDomains().join(',');
  const writesAfterGood = b.state.counts.writes;

  /* ---- an identical start writes nothing ---------------------------------------------------- */
  await coldStart(b);
  check('a second start to the same sources writes nothing', b.state.counts.writes === writesAfterGood, (b.state.counts.writes - writesAfterGood) + ' write(s)');

  /* ---- the card's three failures, each on a cold start ---------------------------------------- */
  const failing = [
    ['the packaged fetch fails', { packagedFails: true, storageFails: false }],
    ['the storage read fails', { packagedFails: false, storageFails: true }],
    ['both fail', { packagedFails: true, storageFails: true }],
  ];
  for (const [label, flags] of failing) {
    Object.assign(b.state, flags);
    b.state.timers = [];
    const warnsBefore = b.state.counts.warns;
    const writesBefore = b.state.counts.writes;
    const api = await coldStart(b);
    check('a cold start where ' + label + ' leaves the grabber band exactly as it was',
      b.grabberDomains().join(',') === goodGrabber, b.grabberBand().length + ' rule(s) left of 4');
    check('and the cryptominer band', b.minerDomains().join(',') === goodMiner, b.minerBand().length + ' rule(s) left of 3');
    check('with no write to Chrome at all', b.state.counts.writes === writesBefore, (b.state.counts.writes - writesBefore) + ' write(s)');
    check('it says so', b.state.counts.warns - warnsBefore === 2, (b.state.counts.warns - warnsBefore) + ' warning(s)');
    check('and each feed schedules one browser retry at the supported minimum',
      b.state.alarms.size === 2 && [...b.state.alarms.values()].every((alarm) => alarm.scheduledTime === b.state.now + 30000));
    check('both retries survive discarding worker timers', b.state.alarms.size === 2);
    check('both failed loads leave durable recovery intent',
      !!b.state.session.wardenone_feed_load_grabber && !!b.state.session.wardenone_feed_load_miner);
    check('unreadable sources retain membership reconstructed from installed rules',
      flags.storageFails && flags.packagedFails ? [...api.GRABBER_FEED_DOMAINS].sort().join(',') === goodGrabber : true);
  }

  /* ---- the retry repopulates without a browser restart ---------------------------------------- */
  {
    Object.assign(b.state, { packagedFails: true, storageFails: true });
    b.state.timers = [];
    b.state.counts.warns = 0;
    const api = await coldStart(b);
    check('setup: an incomplete start, two retries pending', b.state.alarms.size === 2);
    Object.assign(b.state, { packagedFails: false, storageFails: false });
    b.state.local.wardenone_grabber_domains = ['grab3.example', 'grab5.example'];
    await fire(b);
    check('when the sources come back the retry rebuilds the band, including what changed meanwhile',
      b.grabberDomains().join(',') === 'grab1.example,grab2.example,grab3.example,grab4.example,grab5.example', b.grabberDomains().join(','));
    check('and fills the live set', api.GRABBER_FEED_DOMAINS.has('grab5.example') && api.MINER_HOSTS.size === 2);
    check('a success clears the retry and checkpoint', b.state.alarms.size === 0 && Object.keys(b.state.session).length === 0);
    b.state.local.wardenone_grabber_domains = ['grab3.example'];
    await coldStart(b);
    check('a complete load that legitimately shrank the list shrinks the band -- that is a change, not a failure',
      b.grabberDomains().join(',') === goodGrabber, b.grabberDomains().join(','));
  }

  /* ---- the retry is bounded ----------------------------------------------------------------- */
  {
    Object.assign(b.state, { packagedFails: true, storageFails: true });
    b.state.timers = [];
    b.state.counts.warns = 0;
    await coldStart(b);
    const delays = [];
    for (let i = 0; i < 3; i++) {
      delays.push(Math.min(...Array.from(b.state.alarms.values(), (alarm) => alarm.scheduledTime)) - b.state.now);
      await fire(b);
    }
    check('three rapid retries back off before a daily cooldown', delays.join(',') === '30000,120000,600000'
      && Object.values(b.state.session).every((item) => item.failures === 4 && item.phase === 'cooldown'
        && item.retryAt === b.state.now + 86400000));
    check('the band is still exactly what it was through all of it', b.grabberDomains().join(',') === goodGrabber && b.minerDomains().join(',') === goodMiner);
    const cooldown = JSON.stringify(b.state.session);
    b.state.alarms.clear();
    const fresh = wake(b);
    await Promise.all([fresh.loadGrabberFeed(true), fresh.loadMinerFeed(true)]);
    check('a worker restart retains the cooldown and its bounded two-record journal', JSON.stringify(b.state.session) === cooldown
      && Object.keys(b.state.session).length === 2 && b.state.alarms.size === 2);
    check('missing cooldown alarms restore their daily deadline instead of a 30-second wake loop',
      [...b.state.alarms.values()].every((alarm) => alarm.scheduledTime === b.state.now + 86400000));
    for (const alarm of b.state.alarms.values()) alarm.scheduledTime = b.state.now + 30000;
    const earlyAlarm = wake(b);
    await Promise.all([earlyAlarm.loadGrabberFeed(true), earlyAlarm.loadMinerFeed(true)]);
    check('an interrupted backoff update repairs an alarm left earlier than its checkpoint',
      [...b.state.alarms.values()].every((alarm) => alarm.scheduledTime === b.state.now + 86400000));
    Object.assign(b.state, { packagedFails: false, storageFails: false });
    await fire(b);
    check('the daily recovery eventually retries without a settings change', b.state.alarms.size === 0 && Object.keys(b.state.session).length === 0);
  }

  /* ---- the one case where an empty band is right ---------------------------------------------- */
  {
    Object.assign(b.state, { packagedFails: true, storageFails: true });
    b.state.timers = [];
    b.state.config.blockCryptominers = false;
    b.state.config.blockGrabberResources = false;
    b.state.config.warnGrabberDomains = false;
    b.state.config.blockMalwareSites = false;
    await coldStart(b);
    check('a feature that is off empties its band even when the load could not complete',
      b.grabberBand().length === 0 && !b.state.dynamic.has(741000) && b.minerBand().length === 0,
      b.grabberBand().length + ' / ' + b.minerBand().length + ' rule(s)');
    b.state.config.blockCryptominers = true;
    b.state.config.blockGrabberResources = true;
    b.state.config.warnGrabberDomains = true;
    b.state.config.blockMalwareSites = true;
    Object.assign(b.state, { packagedFails: false, storageFails: false });
    b.state.timers = [];
    await coldStart(b);
    check('and switching it back on with the sources readable rebuilds it', b.grabberDomains().join(',') === goodGrabber && b.minerDomains().join(',') === goodMiner);
  }

  /* ---- a reload inside one worker life keeps the last complete load ---------------------------- */
  {
    const api = await coldStart(b);
    check('setup: the live set is full', api.GRABBER_FEED_DOMAINS.size === 4);
    b.state.storageFails = true;
    await api.loadGrabberFeed();
    check('a reload that cannot read storage keeps the live set, so readers keep their answers',
      api.GRABBER_FEED_DOMAINS.size === 4 && api.GRABBER_FEED_DOMAINS.has('grab3.example'), String(api.GRABBER_FEED_DOMAINS.size));
    check('and the band', b.grabberDomains().join(',') === goodGrabber);
    b.state.storageFails = false;
    b.state.timers = [];
  }

  /* ---- the source, for the shape the card asked for ------------------------------------------- */
  {
    const recovery = browser();
    await coldStart(recovery);
    const validRules = JSON.stringify([...recovery.state.dynamic]);
    recovery.state.packagedFails = true;
    await coldStart(recovery);
    const checkpoint = JSON.stringify(recovery.state.session);
    const fetches = recovery.state.fetches;
    recovery.state.alarms.clear();
    const fresh = wake(recovery);
    await Promise.all([fresh.loadGrabberFeed(true), fresh.loadMinerFeed(true)]);
    check('a new realm restores missing alarms without resetting backoff or rereading early', recovery.state.alarms.size === 2
      && JSON.stringify(recovery.state.session) === checkpoint && recovery.state.fetches === fetches);
    check('a failed cold load reconstructs enforced domain membership without marking a partial set complete',
      [...fresh.GRABBER_FEED_DOMAINS].sort().join(',') === recovery.grabberDomains().join(',')
      && fresh.MINER_HOSTS.has('m1.example') && fresh.MINER_POOL_HOSTS.has('p1.example'));
    const deadline = [...recovery.state.alarms.values()].map((alarm) => alarm.scheduledTime).join(',');
    recovery.state.now += 25000;
    const nearDeadline = wake(recovery);
    await Promise.all([nearDeadline.loadGrabberFeed(true), nearDeadline.loadMinerFeed(true)]);
    check('a cold wake near the deadline does not postpone an existing retry alarm',
      [...recovery.state.alarms.values()].map((alarm) => alarm.scheduledTime).join(',') === deadline);
    for (const alarm of recovery.state.alarms.values()) alarm.scheduledTime = recovery.state.now + 86400000;
    const lateAlarm = wake(recovery);
    await Promise.all([lateAlarm.loadGrabberFeed(true), lateAlarm.loadMinerFeed(true)]);
    check('a stale later alarm cannot suppress a checkpoint whose retry is due sooner',
      [...recovery.state.alarms.values()].every((alarm) => alarm.scheduledTime === recovery.state.now + 30000));
    check('cold reconciliation cannot replace valid rules with an unhydrated empty set',
      await fresh.applyGrabberFeedRules() === false && await fresh.applyMinerFeedRules() === false
      && JSON.stringify([...recovery.state.dynamic]) === validRules);
    recovery.state.packagedFails = false;
    await fire(recovery);
    check('the restored browser alarm recovers both feeds in the fresh realm', Object.keys(recovery.state.session).length === 0
      && recovery.state.alarms.size === 0 && lateAlarm.GRABBER_FEED_DOMAINS.size === 4 && lateAlarm.MINER_HOSTS.size === 2);
  }
  for (const boundary of ['holdCheckpointAck', 'holdRuleAck', 'holdCleanup']) {
    const recovery = browser();
    let reached = false;
    recovery.state[boundary] = () => { reached = true; return new Promise(() => {}); };
    const interrupted = wake(recovery);
    interrupted.loadGrabberFeed();
    for (let i = 0; i < 30 && !reached; i++) await new Promise((resolve) => setImmediate(resolve));
    check(boundary + ': intent and a browser wake exist before interruption', reached
      && !!recovery.state.session.wardenone_feed_load_grabber && recovery.state.alarms.size === 1);
    recovery.state[boundary] = null;
    const writes = recovery.state.counts.writes;
    const fresh = wake(recovery);
    await fresh.loadGrabberFeed(true);
    check(boundary + ': fresh realm finishes and clears intent', recovery.grabberBand().length === 4
      && recovery.state.alarms.size === 0 && !recovery.state.session.wardenone_feed_load_grabber);
    if (boundary !== 'holdCheckpointAck') check(boundary + ': replay is idempotent after native commit', recovery.state.counts.writes === writes);
  }
  for (const [setting, id] of [['blockGrabberResources', 740000], ['warnGrabberDomains', 741000], ['blockMalwareSites', 741001]]) {
    const recovery = browser();
    await coldStart(recovery);
    recovery.state.config[setting] = false;
    recovery.state.packagedFails = true;
    const fresh = wake(recovery);
    await fresh.loadGrabberFeed();
    check(setting + ': explicit off removes its rules even when another grabber feature stays on and data is unavailable',
      !recovery.state.dynamic.has(id) && [740000, 741000, 741001].filter((other) => other !== id).every((other) => recovery.state.dynamic.has(other)));
  }
  {
    const recovery = browser();
    await coldStart(recovery);
    const validRules = JSON.stringify([...recovery.state.dynamic]);
    recovery.state.local.wardenone_grabber_domains = ['new.example'];
    recovery.state.ruleWriteFails = true;
    const fresh = wake(recovery);
    const result = await fresh.loadGrabberFeed();
    check('DNR rejection retains old rules and durable retry instead of certifying success', result.ok === false
      && JSON.stringify([...recovery.state.dynamic]) === validRules
      && recovery.state.session.wardenone_feed_load_grabber.failed.includes('rules'));
    recovery.state.ruleWriteFails = false;
    await fire(recovery);
    check('a failed DNR replacement recovers on its alarm', recovery.grabberDomains().includes('new.example') && recovery.state.alarms.size === 0);
  }
  for (const flag of ['checkpointReadFails', 'checkpointWriteFails', 'checkpointRemoveFails', 'configFails']) {
    const recovery = browser();
    recovery.state[flag] = true;
    const fresh = wake(recovery);
    const result = await fresh.loadGrabberFeed();
    check(flag + ': failure is visible and keeps a browser-owned retry', result.ok === false && recovery.state.alarms.size === 1);
    recovery.state[flag] = false;
    wake(recovery);
    await fire(recovery);
    check(flag + ': a fresh worker can recover', recovery.grabberBand().length === 4 && recovery.state.alarms.size === 0);
  }
  {
    const recovery = browser();
    let release, reached = false;
    recovery.state.holdFetch = () => { reached = true; return new Promise((resolve) => { release = resolve; }); };
    const fresh = wake(recovery);
    const oldLoad = fresh.loadGrabberFeed();
    for (let i = 0; i < 20 && !reached; i++) await new Promise((resolve) => setImmediate(resolve));
    check('alarm delivery joins an in-flight load', fresh.loadGrabberFeed(true) === oldLoad);
    recovery.state.holdFetch = null;
    recovery.state.local.wardenone_grabber_domains = ['newer.example'];
    const newer = fresh.loadGrabberFeed();
    release();
    check('a superseded read cannot publish its set', (await oldLoad).superseded === true && fresh.GRABBER_FEED_DOMAINS.size === 0);
    await newer;
    check('the queued load publishes the newest sources once', recovery.grabberDomains().includes('newer.example') && recovery.state.counts.writes === 1);
  }
  {
    const recovery = browser();
    await coldStart(recovery);
    recovery.state.config.enabled = false;
    recovery.state.packagedFails = true;
    const fetches = recovery.state.fetches;
    await coldStart(recovery);
    check('global off clears bands and recovery metadata without reading failed sources', recovery.grabberBand().length === 0
      && recovery.minerBand().length === 0 && recovery.state.alarms.size === 0
      && Object.keys(recovery.state.session).length === 0 && recovery.state.fetches === fetches);
    recovery.state.config.enabled = true;
    recovery.state.packagedFails = false;
    recovery.state.session.wardenone_feed_load_grabber = { version: 1, failures: 999, phase: 'retry', retryAt: Number.MAX_SAFE_INTEGER, failed: [] };
    const fresh = wake(recovery);
    await fresh.loadGrabberFeed(true);
    check('malformed checkpoints cannot defer protection indefinitely', recovery.grabberBand().length === 4 && recovery.state.alarms.size === 0);
  }
  check('the loaders no longer clear their set before reading',
    !/async function loadGrabberFeed\(\) \{\s*GRABBER_FEED_DOMAINS\.clear\(\);/.test(BG) && !/async function loadMinerFeed\(\) \{\s*MINER_HOSTS\.clear\(\);/.test(BG));
  check('they read storage through a read that reports failure', (BG.match(/await localGetStrict\(\[/g) || []).length >= 2);
  check('a packaged response that is not ok is a failed source, not an empty one',
    (BG.match(/if \(!res \|\| !res\.ok\) throw new Error\('http ' \+ \(res \? res\.status : '\?'\)\);/g) || []).length >= 2);
  check('the swap happens only on a complete current load', /if \(!current\(\)\) return \{ ok: false, superseded: true \};\s*if \(complete\) \{\s*replaceFeedSet\(GRABBER_FEED_DOMAINS, next\);/.test(BG)
    && /if \(complete\) \{\s*replaceFeedSet\(MINER_HOSTS, miners\);\s*replaceFeedSet\(MINER_POOL_HOSTS, pools\);/.test(BG));
  check('both loaders still run at start and both appliers are still serialized',
    /^loadGrabberFeed\(true\);$/m.test(BG) && /^loadMinerFeed\(true\);$/m.test(BG)
      && /'applyGrabberFeedRules',\s*'applyMinerFeedRules',/.test(BG));
  check('supplemental list writes await one Grabber refresh without a storage-listener duplicate',
    /await localSet\(\{ \[SUPPLEMENTAL_LIST_STORAGE_KEY\]: lists, \[SUPPLEMENTAL_LIST_META_KEY\]: meta \}\);\s*try \{ await loadGrabberFeed\(\);/.test(BG)
      && /if \(area === 'local' && changes\.wardenone_grabber_domains\) \{\s*loadGrabberFeed\(\);/.test(BG));

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: a feed load that cannot complete leaves the rules Chrome enforces exactly as they were');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });

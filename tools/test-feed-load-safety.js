/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A feed load that cannot complete leaves the rules Chrome is enforcing exactly as they are.
 * Run: node tools/test-feed-load-safety.js
 *
 * The IP-grabber feed (up to 1,000 dynamic rules at 740000) and the cryptominer feed (up to
 * 1,000 at 742000) are each assembled from a packaged JSON plus a storage key the daily update
 * maintains, on every cold start. The loaders used to empty their in-memory set first, read what
 * they could inside try/catch, and hand the applier whatever was left; the applier then replaced
 * the whole band with it. So a packaged fetch that failed -- an extension update replaces the
 * files under a running worker -- or a storage read that failed deleted live blocking rules from
 * Chrome, on a start nothing had asked for, with nothing logged and no retry before the next cold
 * start, while the popup went on reporting both protections as on (LIFE-02).
 *
 * Now a loader builds into a local set and replaces the live one only when every source read
 * completed; an incomplete load leaves the set and the band alone, says so, and retries on a
 * short bounded schedule. This suite is the card's own harness: the real loaders and appliers run
 * against a stubbed Chrome whose dynamic rules persist between "cold starts" (fresh realms), with
 * the packaged fetch failing, the storage read failing, and both -- and the band is never smaller
 * after a run than before it unless the owning setting is off, which is the one case where an
 * empty band is the right answer.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  constLine('GRABBER_FEED_RULE_BASE'), constLine('GRABBER_FEED_MAX'),
  constLine('MINER_FEED_RULE_BASE'), constLine('MINER_FEED_MAX'), constLine('MINER_POOL_RULE_OFFSET'),
  constLine('SUPPLEMENTAL_LIST_STORAGE_KEY'),
  constLine('FEED_LOAD_RETRY_MS', 'const FEED_LOAD_RETRY_MS = [];'),
  constLine('__feedLoadRetries', 'const __feedLoadRetries = new Map();'),
  'const GRABBER_FEED_DOMAINS = new Set(); const MINER_HOSTS = new Set(); const MINER_POOL_HOSTS = new Set();',
  grabFn(BG, 'dnrValueMatches'), grabFn(BG, 'dnrBandUnchanged'),
  orElse('localGetStrict', 'function localGetStrict(keys) { return localGet(keys); }'),
  orElse('scheduleFeedLoadRetry', 'function scheduleFeedLoadRetry() { return false; }'),
  orElse('clearFeedLoadRetry', 'function clearFeedLoadRetry() {}'),
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
    timers: [], timerId: 0,
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const chrome = {
    runtime: { lastError: null, getURL: (p) => 'chrome-extension://wo/' + p },
    storage: {
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
    declarativeNetRequest: {
      getDynamicRules: async () => [...state.dynamic.values()].map(clone),
      updateDynamicRules: async (u) => {
        state.counts.writes++;
        for (const id of (u.removeRuleIds || [])) state.dynamic.delete(id);
        for (const r of (u.addRules || [])) state.dynamic.set(r.id, clone(r));
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
    setTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
    fetch: async (url) => {
      if (state.packagedFails) throw new TypeError('Failed to fetch');
      const file = String(url).split('/').pop();
      const data = state.packaged[file];
      return { ok: data !== undefined, status: data !== undefined ? 200 : 404, json: async () => JSON.parse(JSON.stringify(data)) };
    },
    /* localGet as the worker has it: the config from its cache, any other key straight from
       Chrome's callback -- which, on a failed read, is nothing. */
    localGet: (key) => (key === 'wardenone_config'
      ? Promise.resolve({ wardenone_config: JSON.parse(JSON.stringify(state.config)) })
      : new Promise((resolve) => b.chrome.storage.local.get(key, resolve))),
    DEFAULT_CONFIG: { enabled: true, blockGrabberResources: true, warnGrabberDomains: true, blockMalwareSites: true, blockCryptominers: true },
    registrableDomainBg: (host) => { const p = String(host || '').toLowerCase().split('.'); return p.length >= 2 ? p.slice(-2).join('.') : String(host || ''); },
    isNeverBlockDomain: (d) => d === 'google.com',
    SECURITY_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'],
    MINER_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'],
    MINER_POOL_RESOURCE_TYPES: ['sub_frame', 'script', 'xmlhttprequest', 'websocket', 'other'],
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { loadGrabberFeed, loadMinerFeed, applyGrabberFeedRules, applyMinerFeedRules, GRABBER_FEED_DOMAINS, MINER_HOSTS, MINER_POOL_HOSTS };', ctx, { filename: 'feed-wake.js' });
  return sandbox.api;
}
async function coldStart(b) {
  const api = wake(b);
  await api.loadGrabberFeed();
  await api.loadMinerFeed();
  return api;
}
async function fire(b) {
  const due = b.state.timers.splice(0);
  for (const t of due) t.fn();
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
}

(async () => {
  /* ---- a good start builds both bands -------------------------------------------------------- */
  const b = browser();
  const w1 = await coldStart(b);
  check('a complete load builds the grabber band from every source',
    b.grabberDomains().join(',') === 'grab1.example,grab2.example,grab3.example,grab4.example', b.grabberDomains().join(','));
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
    check('and each feed schedules one retry, soon',
      b.state.timers.length === 2 && b.state.timers.every((t) => t.ms === 5000), JSON.stringify(b.state.timers.map((t) => t.ms)));
    check('a set that was not filled is left empty rather than partial, so no reader is told a half-truth',
      flags.storageFails && flags.packagedFails ? api.GRABBER_FEED_DOMAINS.size === 0 : true);
  }

  /* ---- the retry repopulates without a browser restart ---------------------------------------- */
  {
    Object.assign(b.state, { packagedFails: true, storageFails: true });
    b.state.timers = [];
    b.state.counts.warns = 0;
    const api = await coldStart(b);
    check('setup: an incomplete start, two retries pending', b.state.timers.length === 2);
    Object.assign(b.state, { packagedFails: false, storageFails: false });
    b.state.local.wardenone_grabber_domains = ['grab3.example', 'grab5.example'];
    await fire(b);
    check('when the sources come back the retry rebuilds the band, including what changed meanwhile',
      b.grabberDomains().join(',') === 'grab1.example,grab2.example,grab3.example,grab4.example,grab5.example', b.grabberDomains().join(','));
    check('and fills the live set', api.GRABBER_FEED_DOMAINS.has('grab5.example') && api.MINER_HOSTS.size === 2);
    check('a success clears the retry: nothing further is pending', b.state.timers.length === 0, b.state.timers.length + ' timer(s)');
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
    for (let i = 0; i < 6; i++) {
      if (!b.state.timers.length) break;
      delays.push(b.state.timers[0].ms);
      await fire(b);
    }
    check('retries back off and stop: three attempts after the first, then the next start is the retry',
      delays.join(',') === '5000,30000,120000' && b.state.timers.length === 0, JSON.stringify(delays) + ' then ' + b.state.timers.length + ' pending');
    check('the band is still exactly what it was through all of it', b.grabberDomains().join(',') === goodGrabber && b.minerDomains().join(',') === goodMiner);
    Object.assign(b.state, { packagedFails: false, storageFails: false });
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
      b.grabberBand().length === 0 && b.minerBand().length === 0, b.grabberBand().length + ' / ' + b.minerBand().length + ' rule(s)');
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
  check('the loaders no longer clear their set before reading',
    !/async function loadGrabberFeed\(\) \{\s*GRABBER_FEED_DOMAINS\.clear\(\);/.test(BG) && !/async function loadMinerFeed\(\) \{\s*MINER_HOSTS\.clear\(\);/.test(BG));
  check('they read storage through a read that reports failure', (BG.match(/await localGetStrict\(\[/g) || []).length >= 2);
  check('a packaged response that is not ok is a failed source, not an empty one',
    (BG.match(/if \(!res \|\| !res\.ok\) throw new Error\('http ' \+ \(res \? res\.status : '\?'\)\);/g) || []).length >= 2);
  check('the swap happens only on a complete load', /const complete = failed\.length === 0;\s*if \(complete\) \{\s*replaceFeedSet\(GRABBER_FEED_DOMAINS, next\);/.test(BG)
    && /if \(complete\) \{\s*replaceFeedSet\(MINER_HOSTS, miners\);\s*replaceFeedSet\(MINER_POOL_HOSTS, pools\);/.test(BG));
  check('both loaders still run at start and both appliers are still serialized',
    /^loadGrabberFeed\(\);$/m.test(BG) && /^loadMinerFeed\(\);$/m.test(BG)
      && /'applyGrabberFeedRules',\s*'applyMinerFeedRules',/.test(BG));

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

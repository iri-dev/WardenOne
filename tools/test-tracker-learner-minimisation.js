/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The tracker learner keeps evidence, not a browsing graph (PRIV-01).
 * Run: node tools/test-tracker-learner-minimisation.js
 *      WARDENONE_BACKGROUND=<older background.js> node tools/test-tracker-learner-minimisation.js
 *
 * The durable store used to hold, per tracker, up to 80 named first-party sites with hit counts
 * and exact times, plus the raw ids of the browser sessions that saw it: at the cap, 48,000 named
 * site-to-tracker edges in chrome.storage.local with no expiry. That is browsing history whatever
 * the key is called, and it was reconstructable by anyone holding the profile.
 *
 * The learner's purpose needs three distinct sites and two sessions per tracker, so that is what
 * the store may say now: a count of sites and a 32-bit keyed sketch that answers only "already
 * counted this site?", gone the moment the tracker leaves 'candidate'; a count of sessions, never
 * an id; times to the day; a thirty-day expiry on observations. The popup's "seen on this site"
 * list and the once-per-session count live in storage.session and die with the browser. Clean
 * browsing data with History ticked now really does clear the observations, as PRIVACY.md said.
 * The real store shape, observation path, pruning, status, decisions and reset are lifted from
 * background.js and driven here with fake storage, a fake clock and both kinds of restart.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG_PATH = process.env.WARDENONE_BACKGROUND ? path.resolve(process.env.WARDENONE_BACKGROUND) : path.join(ROOT, 'background.js');
const BG = fs.readFileSync(BG_PATH, 'utf8');
const DOMAIN_UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const PRIVACY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const GATE = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function lift(name) {
  let start = BG.indexOf('function ' + name + '(');
  if (start < 0) return null;
  if (BG.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0;
  for (let i = BG.indexOf('{', start); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(start, i + 1); }
  }
  return null;
}
const PIECES = ['normalizeTrackerDomain', 'registrableDomainBg', 'trackerStoreShape', 'trackerDistinctSiteCount',
  'trackerDistinctSessionCount', 'trackerDay', 'trackerNewSalt', 'trackerSaltShape', 'trackerLearnerSalt',
  'trackerMarkPositions', 'trackerMarkHas', 'trackerMarkAdd', 'trackerSessionState', 'noteTrackerSessionSeen',
  'noteTrackerSiteView', 'trackerSiteViewFor', 'resetTrackerSessionState', 'isProtectedTrackerDomain',
  'looksLikeKnownTrackerHost', 'ownProviderDomains', 'loadTrackerLearner', 'noteTrackerObservation',
  'trackerControlledDomains', 'pruneTrackerLearnerStore', 'saveTrackerLearner', 'trackerLearnerProposals',
  'decideTrackerProposal', 'trackerLearnerStatus', 'setTrackerLearnerSiteMode', 'clearTrackerLearnerObservations'];
/* Present on the pre-fix worker only; lifted when found so a control run exercises the old code. */
const OPTIONAL = ['trackerLearnerSessionId'];
const missing = PIECES.filter((p) => !lift(p));
check('every piece of the learner is present', missing.length === 0, 'missing: ' + missing.join(', '));
const API_NAMES = { load: 'loadTrackerLearner', note: 'noteTrackerObservation', shape: 'trackerStoreShape', proposals: 'trackerLearnerProposals',
  decide: 'decideTrackerProposal', status: 'trackerLearnerStatus', setMode: 'setTrackerLearnerSiteMode', clear: 'clearTrackerLearnerObservations',
  save: 'saveTrackerLearner', norm: 'normalizeTrackerDomain', markHas: 'trackerMarkHas', positions: 'trackerMarkPositions' };
const apiSource = 'globalThis.api = { ' + Object.keys(API_NAMES).map((k) => k + ': (typeof ' + API_NAMES[k] + ' === "function" ? ' + API_NAMES[k] + ' : null)').join(', ')
  + ', learner: () => TRACKER_LEARNER, workerRestart: () => { __trackerSession = null; __initTrackerLearner = null; __trackerSessionId = ""; } };';
const constStart = BG.indexOf('const TRACKER_LEARNER_KEY =');
const constEnd = BG.indexOf('\n', BG.indexOf('const TRACKER_RESOURCE_TYPES'));
const CONSTS = constStart >= 0 && constEnd > constStart ? BG.slice(constStart, constEnd) : '';

const DAY = 86400000;
const SITES = ['news-alpha.example', 'shop-beta.example', 'forum-gamma.example'];
const TRACKER = 'beacon-collector.net';

/* A worker with fake storage. `raw` is what chrome.storage.local holds for the learner key. */
function rig(options) {
  const o = options || {};
  const state = { written: [], history: [], sessionStore: {}, local: o.raw === undefined ? {} : { wardenone_tracker_learner: o.raw }, now: o.now || 1758240000000 };
  const sandbox = {
    console: { warn() {}, log() {} }, Math, Object, Array, Set, Map, Number, String, URL, JSON, isNaN, Promise, Uint8Array,
    /* A fixed key. The sketch is two bits per site in a 32-bit word, and a fresh random key puts
       the third fixture site on already-set bits about once in sixty runs -- the documented
       "one more observation" -- which a fixed-count check would read as a failure. The fixture
       sites are known not to collide under the first key a realm mints; later keys differ by a
       counter, so the check that two installs get different keys still holds. */
    crypto: { getRandomValues: (bytes) => { state.salts = (state.salts || 0) + 1; for (let i = 0; i < bytes.length; i++) bytes[i] = ((i * 0x11) + state.salts - 1) & 0xff; return bytes; } },
    Date: Object.assign(function FakeDate(...a) { return a.length ? new Date(...a) : new Date(state.now); }, { now: () => state.now }),
    TRACKER_RULES_BUDGET: 300,
    TRACKER_PROTECTED_DOMAINS: new Set(['stripe.com']),
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: [],
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true },
    localGet: async () => ({ wardenone_config: { enabled: true, trackerLearner: true } }),
    localSet: async (obj) => { state.written.push(JSON.parse(JSON.stringify(obj))); Object.assign(state.local, JSON.parse(JSON.stringify(obj))); },
    queueHistory: (e) => state.history.push(e),
    applyTrackerLearnerRules: async () => {},
    /* The real mirror coalesces on a timer; this one writes at once, into a store the suite can
       empty (a browser restart) or keep (a worker restart). */
    sessionMirror: (key, snapshot, restore) => ({
      ready: async () => { restore(state.sessionStore[key] ? JSON.parse(JSON.stringify(state.sessionStore[key])) : null); },
      persist: () => { state.sessionStore[key] = JSON.parse(JSON.stringify(snapshot())); },
    }),
    chrome: {
      runtime: { getManifest: () => MANIFEST, lastError: null },
      storage: {
        local: { get: (key, cb) => { cb({ [key]: state.local[key] }); } },
        session: {},
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(DOMAIN_UTILS + '\nvar __ownProviderDomains=null;var __trackerSession=null;var __initTrackerLearner=null;var __trackerSessionId="";\n'
    + 'var TRACKER_LEARNER = { domains: {}, siteControls: {} };\n' + CONSTS + '\n'
    + PIECES.concat(OPTIONAL).map(lift).filter(Boolean).join('\n')
    + '\n' + apiSource, sandbox);
  const api = sandbox.api;
  return {
    api, state,
    entry: (d) => (api.learner().domains || {})[api.norm(d)],
    json: () => JSON.stringify(api.learner()),
    lastWritten: () => JSON.stringify(state.written[state.written.length - 1] || {}),
    observe: (site, domain) => api.note('https://' + site + '/page?x=1', { domain: domain || TRACKER, signal: 'tracking-path' }),
    /* The worker is torn down but the browser stays: storage.session survives. */
    workerRestart: () => { api.workerRestart(); },
    /* The browser is closed: storage.session is gone with it. */
    browserRestart: () => { api.workerRestart(); state.sessionStore = {}; },
    advance: (ms) => { state.now += ms; },
  };
}
const dayAligned = (n) => Number(n) > 0 && Number(n) % DAY === 0;
const namesIn = (text) => SITES.filter((s) => text.includes(s));

const sections = [];
function section(name, fn) { sections.push([name, fn]); }

(async () => {
  console.log('\ntracker learner minimisation\n');

  /* ---- 1. what the store says after ordinary observation ------------------------------- */
  section('what the store says after ordinary observation', async () => {
    const r = rig();
    await r.observe(SITES[0]);
    await r.observe(SITES[1]);
    r.browserRestart();
    await r.observe(SITES[1]);
    const e = r.entry(TRACKER);
    check('the store names no first-party site', namesIn(r.json()).length === 0 && namesIn(r.lastWritten()).length === 0, namesIn(r.lastWritten()));
    check('sites is a count', e && e.sites === 2, e && e.sites);
    check('the sketch is one 32-bit number', e && typeof e.marks === 'number' && e.marks >= 0 && e.marks <= 0xffffffff, e && e.marks);
    check('sessions is a count, and no session id is stored', e && e.sessions === 2 && !/__wo_tracker_session|sessionId|"sessions":\[/.test(r.lastWritten()), e && e.sessions);
    check('times are to the day', e && dayAligned(e.firstSeen) && dayAligned(e.lastSeen), e && [e.firstSeen, e.lastSeen]);
    check('the store carries its version and a 32-hex key', /"version":2/.test(r.lastWritten()) && /"salt":"[0-9a-f]{32}"/.test(r.lastWritten()));
    check('no per-site hit counts or per-site times exist anywhere', !/"lastSeen":\{|"hits":\{/.test(r.lastWritten()) && !r.lastWritten().includes('siteHits'));
  });

  /* ---- 2. the evidence still adds up ------------------------------------------------- */
  section('the evidence still adds up (1)', async () => {
    const r = rig();
    await r.observe(SITES[0]);
    await r.observe(SITES[1]);
    r.browserRestart();
    await r.observe(SITES[2]);
    const e = r.entry(TRACKER);
    check('three sites across two sessions still reach a proposal', e && e.state === 'proposed', e);
    check('...with the same explanation as before', e && /3 different sites/.test(e.reason) && r.state.history.some((h) => h.type === 'proposed_tracker_domain' && h.detail.sites === 3));
    check('...and the sketch is dropped the moment its job is done', e && !('marks' in e), e);
    check('the popup is told counts, not names', r.api.proposals()[0] && r.api.proposals()[0].sites === 3 && r.api.proposals()[0].sessions === 2, r.api.proposals());
    check('proposedAt is to the day', e && dayAligned(e.proposedAt));
  });
  section('the evidence still adds up (2)', async () => {
    /* One site, many times, many sessions: never three sites. */
    const r = rig();
    for (let s = 0; s < 3; s++) { await r.observe(SITES[0]); await r.observe(SITES[0]); r.browserRestart(); }
    const e = r.entry(TRACKER);
    check('the same site again is still one site, across three browser restarts (the keyed sketch survives them)', e && e.sites === 1 && e.state === 'candidate' && e.hits === 6, e);
    check('...and the sessions counted are the real ones', e && e.sessions === 3);
  });
  section('the evidence still adds up (3)', async () => {
    /* A worker restart inside one browser session must not count the session twice. */
    const r = rig();
    await r.observe(SITES[0]);
    r.workerRestart();
    await r.observe(SITES[1]);
    const e = r.entry(TRACKER);
    check('a worker restart in the same browser session counts one session', e && e.sessions === 1 && e.sites === 2, e);
    check('the once-per-session record lives in storage.session', JSON.stringify(r.state.sessionStore).includes(TRACKER) && !r.lastWritten().includes('"counted"'));
  });
  section('the evidence still adds up (4)', async () => {
    /* Three sites in one session is not enough; the second session is. */
    const r = rig();
    for (const site of SITES) await r.observe(site);
    check('three sites in one session: still a candidate', r.entry(TRACKER).state === 'candidate' && r.entry(TRACKER).sites === 3);
    r.browserRestart();
    await r.observe(SITES[0]);
    check('one more sighting in a second session proposes it', r.entry(TRACKER).state === 'proposed');
  });

  /* ---- 3. what the popup sees for this site ----------------------------------------- */
  section('what the popup sees for this site', async () => {
    const r = rig();
    await r.observe(SITES[0]);
    await r.observe(SITES[0]);
    await r.observe(SITES[1], 'other-pixel.net');
    const a = await r.api.status('https://' + SITES[0] + '/x');
    const b = await r.api.status('https://' + SITES[1] + '/x');
    check('this site lists the tracker it saw, with this session\'s count', a.items.length === 1 && a.items[0].domain === TRACKER && a.items[0].siteHits === 2, a.items);
    check('another site does not see it', b.items.length === 1 && b.items[0].domain === 'other-pixel.net', b.items);
    check('the status carries size and age for the popup', a.watchingCount === 2 && a.ttlDays === 30 && a.oldestDays === 0, [a.watchingCount, a.ttlDays, a.oldestDays]);
    r.browserRestart();
    const c = await r.api.status('https://' + SITES[0] + '/x');
    check('after the browser closes the per-site view is gone with it', c.items.length === 0, c.items);
    check('...while the tracker itself is still known, as a count', r.entry(TRACKER) && r.entry(TRACKER).sites === 1);
    /* A per-site decision keeps its row without any observation behind it. */
    await r.api.setMode('https://' + SITES[2] + '/', TRACKER, 'allow');
    const d = await r.api.status('https://' + SITES[2] + '/');
    check('a per-site allow is listed on that site as a manual rule', d.items.length === 1 && d.items[0].mode === 'allow' && d.items[0].siteHits === 0, d.items);
    check('...and the decision names the site in siteControls only (the reader\'s setting), never in the tracker entry', r.json().includes('"siteControls":{"' + SITES[2] + '"') && !JSON.stringify(r.entry(TRACKER)).includes(SITES[2]));
  });

  /* ---- 4. expiry -------------------------------------------------------------------- */
  section('expiry', async () => {
    const now = 1758240000000;
    const old = now - 31 * DAY;
    const raw = { version: 2, salt: 'a'.repeat(32), domains: {
      'stale-candidate.net': { state: 'candidate', hits: 2, sites: 1, marks: 5, sessions: 1, firstSeen: old, lastSeen: old },
      'stale-proposal.net': { state: 'proposed', proposedAt: old, hits: 4, sites: 3, sessions: 2, firstSeen: old, lastSeen: old },
      'stale-dismissed.net': { state: 'dismissed', dismissedAt: old, hits: 4, sites: 3, sessions: 2, firstSeen: old, lastSeen: old },
      'approved-rule.net': { state: 'learned', approvedAt: old, hits: 4, sites: 3, sessions: 2, firstSeen: old, lastSeen: old },
      'controlled.net': { state: 'candidate', hits: 0, sites: 0, sessions: 0, firstSeen: old, lastSeen: old },
      'fresh.net': { state: 'candidate', hits: 1, sites: 1, marks: 3, sessions: 1, firstSeen: now - DAY, lastSeen: now - DAY },
    }, siteControls: { 'news-alpha.example': { allow: { 'controlled.net': old }, block: {} } } };
    const r = rig({ raw, now });
    await r.api.load();
    await r.api.save(false);
    const kept = Object.keys(r.api.learner().domains).sort();
    check('observations older than thirty days are gone: candidate, proposal and dismissal', !kept.includes('stale-candidate.net') && !kept.includes('stale-proposal.net') && !kept.includes('stale-dismissed.net'), kept);
    check('an approved rule and a per-site decision stay', kept.includes('approved-rule.net') && kept.includes('controlled.net'), kept);
    check('a fresh candidate stays, with its sketch', kept.includes('fresh.net') && r.entry('fresh.net').marks === 3);
    r.advance(31 * DAY);
    await r.api.save(false);
    check('...and expires in its turn', !Object.keys(r.api.learner().domains).includes('fresh.net'));
    check('the sketch is stripped from anything that is not gathering sites', !('marks' in r.entry('approved-rule.net')));
  });

  /* ---- 5. what an earlier build left behind ------------------------------------------ */
  section('what an earlier build left behind', async () => {
    const now = 1758240000000;
    const raw = { domains: {
      'legacy-watch.net': { state: 'candidate', hits: 2, firstSeen: now - 3 * DAY - 12345, lastSeen: now - 12345, sites: { 'news-alpha.example': { hits: 1, lastSeen: now - 12345 }, 'shop-beta.example': { hits: 1, lastSeen: now - 99999 } }, sessions: ['s1', 's1', 's2'] },
      'legacy-rule.net': { state: 'learned', approvedAt: now - 5 * DAY - 777, hits: 9, firstSeen: now - 9 * DAY, lastSeen: now - 777, sites: { 'news-alpha.example': { hits: 3 }, 'shop-beta.example': { hits: 3 }, 'forum-gamma.example': { hits: 3 } }, sessions: ['s1', 's2'] },
    } };
    const r = rig({ raw, now });
    const learner = await r.api.load();
    const w = r.entry('legacy-watch.net');
    const l = r.entry('legacy-rule.net');
    check('named sites fold into a count', w && w.sites === 2 && l && l.sites === 3, [w && w.sites, l && l.sites]);
    check('...and into the sketch, so counting continues where it left off', w && r.api.markHas(w.marks, learner.salt, 'news-alpha.example') && r.api.markHas(w.marks, learner.salt, 'shop-beta.example') && !r.api.markHas(w.marks, learner.salt, 'forum-gamma.example'));
    check('session ids fold into a distinct count', w && w.sessions === 2 && l && l.sessions === 2);
    check('exact times fold to the day', w && dayAligned(w.firstSeen) && dayAligned(w.lastSeen) && l && dayAligned(l.approvedAt));
    check('the names are written back out of the store at once, without waiting for an observation', r.state.written.length === 1 && namesIn(r.lastWritten()).length === 0 && /"version":2/.test(r.lastWritten()), r.state.written.length);
    await r.observe('shop-beta.example', 'legacy-watch.net');
    check('a folded site is not counted again', r.entry('legacy-watch.net').sites === 2);
    await r.observe('forum-gamma.example', 'legacy-watch.net');
    check('a new one is', r.entry('legacy-watch.net').sites === 3);
    const r2 = rig({ raw: JSON.parse(r.lastWritten()).wardenone_tracker_learner, now });
    await r2.api.load();
    check('a current store is not rewritten on load', r2.state.written.length === 0, r2.state.written.length);
  });

  /* ---- 6. the reset PRIVACY.md promised --------------------------------------------- */
  section('the reset PRIVACY.md promised', async () => {
    const r = rig();
    await r.observe(SITES[0]);
    await r.observe(SITES[1]);
    await r.observe(SITES[2], 'decided-later.net');
    r.browserRestart();
    for (const site of SITES) await r.observe(site, 'decided-later.net');
    await r.api.decide('decided-later.net', 'block');
    await r.api.setMode('https://' + SITES[0] + '/', 'allowed-here.net', 'allow');
    const res = await r.api.clear();
    const kept = Object.keys(r.api.learner().domains).sort();
    check('clearing observations drops candidates and proposals', res.ok && !kept.includes(TRACKER), kept);
    check('...keeps the approved rule and the per-site decision', kept.includes('decided-later.net') && kept.includes('allowed-here.net') && r.api.learner().siteControls[SITES[0]].allow['allowed-here.net'] > 0, kept);
    check('...zeroes what a kept entry remembered', r.entry('decided-later.net').sites === 0 && r.entry('decided-later.net').sessions === 0 && !('marks' in r.entry('decided-later.net')));
    const st = await r.api.status('https://' + SITES[0] + '/');
    check('...and empties this session\'s view', st.items.every((i) => i.siteHits === 0) && st.watchingCount === 0, st.items);
    const handler = BG.slice(BG.indexOf("msg.kind === 'clean-browser'"), BG.indexOf("msg.kind === 'clean-browser'") + 3200);
    check('Clean browsing data with History ticked runs it', /if \(t\.history\) \{[\s\S]{0,400}clearTrackerLearnerObservations\(\)/.test(handler));
    check('...and drops the Script Drift baselines with it', /if \(t\.history\) \{[\s\S]{0,600}chrome\.storage\.local\.remove\(SCRIPT_DRIFT_BASELINE_KEY\)/.test(handler));
  });

  /* ---- 7. edges --------------------------------------------------------------------- */
  section('edges', async () => {
    const r = rig();
    await r.api.note('chrome://newtab/', { domain: TRACKER, signal: 'tracking-path' });
    await r.api.note('file:///C:/page.html', { domain: TRACKER, signal: 'tracking-path' });
    await r.api.note('chrome-extension://abc/popup.html', { domain: TRACKER, signal: 'tracking-path' });
    check('non-web first parties are not sites the learner knows', !r.entry(TRACKER), r.entry(TRACKER));
    const a = r.api.shape({}).salt;
    const b = r.api.shape({}).salt;
    check('each install mints its own key', /^[0-9a-f]{32}$/.test(a) && /^[0-9a-f]{32}$/.test(b) && a !== b);
    const differs = SITES.some((s) => r.api.positions(a, s).join() !== r.api.positions(b, s).join());
    check('the same site marks different bits under different keys', differs);
    check('the learner store is not persisted in a private window', /INCOGNITO_EPHEMERAL_LOCAL_KEYS = new Set\(\[[^\]]*'wardenone_tracker_learner'/.test(BG));
  });

  /* ---- 8. what the reader is told ---------------------------------------------------- */
  check('PRIVACY.md no longer describes named sites per tracker', !/up to\s+80 sites per tracker/.test(PRIVACY));
  check('...and describes the count, the sketch, the expiry and the clear', /three\b[\s\S]{0,200}sites[\s\S]{0,400}30 days/i.test(PRIVACY.slice(PRIVACY.indexOf('tracker learner'), PRIVACY.indexOf('tracker learner') + 2200)) && /Clean\s+browsing data/.test(PRIVACY));
  check('the cleaner\'s History box says WardenOne\'s own records go with it', /id="cl-history"[^\n]*WardenOne/.test(POPUP_HTML) || /cl-history[\s\S]{0,300}WardenOne['\u2019]s own/.test(POPUP_HTML));
  check('the popup says how much is held and for how long', /watchingCount/.test(POPUP_JS) && /ttlDays/.test(POPUP_JS));
  check('the popup calls this session\'s count what it is', /this session/.test(POPUP_JS.slice(POPUP_JS.indexOf('const siteHits = Number(item.siteHits'), POPUP_JS.indexOf('const siteHits = Number(item.siteHits') + 300)));
  check('this suite is wired into the gate', /test-tracker-learner-minimisation\.js/.test(GATE));

  for (const [name, fn] of sections) {
    try { await fn(); } catch (e) { check(name, false, 'could not run: ' + (e && e.message || e)); }
  }

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the learner keeps counts and a sketch, and nothing that names a site');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });

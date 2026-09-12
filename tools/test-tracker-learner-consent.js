/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The tracker learner may suggest; only the reader decides (SEC-04).
 *
 * Every input the learner sees -- the third-party domain, the signal, the first-party site --
 * arrives in a page-supplied event relayed by the bridge. Three sites, three hits and two
 * browser sessions used to promote a domain to 'learned' and emit a priority-1800 block rule
 * against it, browser-wide, with no initiator constraint, persisting across sessions and
 * upgrades. The thresholds make forgery slower; they do not make the evidence trustworthy, and
 * the learner's own harness showed the record's attack reaching 'learned'.
 *
 * Now meeting the thresholds makes a PROPOSAL. It waits in the popup, and a block rule exists
 * only for a domain the reader approved: 'learned' carries an approval stamp the store shape
 * requires, and a 'learned' entry from an earlier build without one comes back as a proposal.
 * This drives the real functions -- observation, store shape, decision, rule builder --
 * against a fake DNR, with both sessions' signals forged, exactly as the record's verification
 * asked, and requires that nothing the page does creates a rule.
 *
 * Run: node tools/test-tracker-learner-consent.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const DOMAIN_UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
function lift(name) {
  let start = BG.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('background.js no longer declares ' + name);
  if (BG.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0;
  for (let i = BG.indexOf('{', start); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(start, i + 1); }
  }
  throw new Error(name + ' is unterminated');
}
const PIECES = ['normalizeTrackerDomain', 'registrableDomainBg', 'trackerStoreShape', 'trackerDistinctSiteCount',
  'trackerDistinctSessionCount', 'trackerLearnerSessionId', 'isProtectedTrackerDomain', 'looksLikeKnownTrackerHost',
  'ownProviderDomains', 'noteTrackerObservation', 'pruneTrackerLearnerStore', 'saveTrackerLearner',
  'applyTrackerLearnerRules', 'trackerLearnerProposals', 'decideTrackerProposal', 'decideAllTrackerProposals',
  'trackerLearnerStatus'];
const CONSTS = BG.slice(BG.indexOf('const TRACKER_LEARNER_KEY ='), BG.indexOf('\n', BG.indexOf('const TRACKER_RESOURCE_TYPES')));

function rig(options) {
  const o = options || {};
  const state = { history: [], written: [], dnr: [], updates: [], session: o.session || 'session-A', learner: null };
  const sandbox = {
    console: { warn() {}, log() {} }, Math, Date, Object, Array, Set, Map, Number, String, URL, JSON, isNaN, Promise,
    TRACKER_RULES_BUDGET: 300,
    TRACKER_PROTECTED_DOMAINS: new Set(['stripe.com', 'okta.com']),
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: [],
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true },
    localGet: async () => ({ wardenone_config: { enabled: true, trackerLearner: true } }),
    localSet: async (obj) => { state.written.push(JSON.parse(JSON.stringify(obj))); },
    queueHistory: (e) => state.history.push(e),
    chrome: {
      runtime: { getManifest: () => MANIFEST },
      storage: { session: { get: async () => ({ __wo_tracker_session: state.session }), set: async () => {} } },
      declarativeNetRequest: {
        getDynamicRules: async () => state.dnr.slice(),
        updateDynamicRules: async ({ removeRuleIds, addRules }) => {
          state.updates.push({ removeRuleIds: (removeRuleIds || []).slice(), addRules: JSON.parse(JSON.stringify(addRules || [])) });
          state.dnr = state.dnr.filter((r) => !(removeRuleIds || []).includes(r.id)).concat(JSON.parse(JSON.stringify(addRules || [])));
        },
      },
    },
  };
  vm.createContext(sandbox);
  /* trackerStoreShape must run before TRACKER_LEARNER is assigned, so declare the pieces first. */
  vm.runInContext(DOMAIN_UTILS + '\nvar __trackerSessionId="";var __ownProviderDomains=null;\n' + CONSTS + '\n' + PIECES.map(lift).join('\n')
    + '\nvar TRACKER_LEARNER = trackerStoreShape(' + JSON.stringify(o.store || {}) + ');'
    + '\nvar loadTrackerLearner = async () => TRACKER_LEARNER;'
    + '\nglobalThis.api = { note: noteTrackerObservation, shape: trackerStoreShape, proposals: trackerLearnerProposals,'
    + ' decide: decideTrackerProposal, decideAll: decideAllTrackerProposals, apply: applyTrackerLearnerRules,'
    + ' status: trackerLearnerStatus, norm: normalizeTrackerDomain, learner: () => TRACKER_LEARNER,'
    + ' newSession: () => { __trackerSessionId = ""; } };', sandbox);
  return { api: sandbox.api, state, entry: (d) => (sandbox.api.learner().domains || {})[sandbox.api.norm(d)] || {} };
}
/* A hostile page forging the event, exactly as bridge.js would relay it. */
const forge = (r, site, domain) => r.api.note('https://' + site + '/', { domain, signal: 'tracking-path' });
let attacks = 0;
/* Three attacker sites, then a browser restart, then the same three again. Each attack uses two
   fresh session ids, so several attacks in one rig each count two sessions of their own. */
async function attack(r, domain) {
  attacks += 1;
  r.state.session = 'session-' + attacks + '-A'; r.api.newSession();
  for (const site of ['attacker-one.example', 'attacker-two.example', 'attacker-three.example']) await forge(r, site, domain);
  r.state.session = 'session-' + attacks + '-B'; r.api.newSession();
  for (const site of ['attacker-one.example', 'attacker-two.example', 'attacker-three.example']) await forge(r, site, domain);
}
const rulesFor = (r, domain) => r.state.dnr.filter((x) => x.condition && (x.condition.requestDomains || []).includes(r.api.norm(domain)));

(async () => {
  console.log('\ntracker learner consent\n');

  /* ---- 1. the record's attack, both sessions forged ---------------------------------- */
  {
    const r = rig();
    await attack(r, 'victim-api.net');
    check('three forged sites across two forged sessions reach a PROPOSAL, not a rule', r.entry('victim-api.net').state === 'proposed', r.entry('victim-api.net'));
    check('the proposal is stamped and explained', r.entry('victim-api.net').proposedAt > 0 && /3 different sites/.test(r.entry('victim-api.net').reason));
    await r.api.apply();
    check('the rule builder writes nothing for it', rulesFor(r, 'victim-api.net').length === 0 && r.state.dnr.length === 0, r.state.dnr);
    check('it is recorded as noticed, waiting for the reader', r.state.history.some((h) => h.type === 'proposed_tracker_domain' && /Nothing is blocked until you say so/.test(h.detail.why)) && !r.state.history.some((h) => h.type === 'learned_tracker_domain'));
    const listed = r.api.proposals();
    check('the popup is told about it', listed.length === 1 && listed[0].domain === 'victim-api.net' && listed[0].sites === 3 && listed[0].sessions === 2 && listed[0].legacy === false, listed);
    const before = r.state.history.length;
    await attack(r, 'victim-api.net');
    check('more forged evidence cannot move it past the proposal, or re-raise it', r.entry('victim-api.net').state === 'proposed' && r.state.history.length === before);
    check('the status the popup reads counts it as waiting', (await r.api.status('https://attacker-one.example/')).proposedCount === 1 && (await r.api.status('https://attacker-one.example/')).learnedCount === 0);
  }

  /* ---- 2. the reader ignores it --------------------------------------------------- */
  {
    const r = rig();
    await attack(r, 'victim-api.net');
    const res = await r.api.decide('victim-api.net', 'ignore');
    check('ignore dismisses the proposal', res.ok && res.state === 'dismissed' && r.entry('victim-api.net').state === 'dismissed' && r.entry('victim-api.net').dismissedAt > 0, res);
    await attack(r, 'victim-api.net');
    check('a dismissed domain is never proposed again, however much the page insists', r.entry('victim-api.net').state === 'dismissed' && r.api.proposals().length === 0);
    await r.api.apply();
    check('and still gets no rule', r.state.dnr.length === 0);
  }

  /* ---- 3. the reader approves it -------------------------------------------------- */
  {
    const r = rig();
    await attack(r, 'victim-api.net');
    check('a domain not waiting cannot be decided', (await r.api.decide('other-thing.net', 'block')).ok === false && (await r.api.decide('attacker-one.example', 'block')).ok === false);
    check('a decision must be block or ignore', (await r.api.decide('victim-api.net', 'nuke')).ok === false && r.entry('victim-api.net').state === 'proposed');
    const res = await r.api.decide('victim-api.net', 'block');
    const e = r.entry('victim-api.net');
    check('block makes it learned, with the approval stamped', res.ok && e.state === 'learned' && e.approvedAt > 0 && e.legacy === false, e);
    check('and only then is a rule written', rulesFor(r, 'victim-api.net').length === 1, r.state.dnr);
    const rule = rulesFor(r, 'victim-api.net')[0];
    check('the rule is the bounded third-party block the learner always meant', rule.priority === 1800 && rule.action.type === 'block' && rule.condition.domainType === 'thirdParty'
      && JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(['image', 'xmlhttprequest', 'ping', 'webtransport']) && !rule.condition.initiatorDomains, rule);
    check('the approval is recorded as the reader\'s', r.state.history.some((h) => h.type === 'learned_tracker_domain' && /You approved/.test(h.detail.why)));
    check('the store was persisted with the stamp', r.state.written.some((w) => w.wardenone_tracker_learner && w.wardenone_tracker_learner.domains['victim-api.net'].approvedAt > 0));
    check('deciding it again is refused', (await r.api.decide('victim-api.net', 'ignore')).ok === false && r.entry('victim-api.net').state === 'learned');
  }

  /* ---- 4. deciding everything at once --------------------------------------------- */
  {
    const r = rig();
    await attack(r, 'one-tracker.net');
    await attack(r, 'two-tracker.net');
    check('two proposals are waiting', r.api.proposals().length === 2);
    const res = await r.api.decideAll('block');
    check('block all approves both', res.ok && res.decided === 2 && r.entry('one-tracker.net').state === 'learned' && r.entry('two-tracker.net').state === 'learned', res);
    check('and both are rules now', r.state.dnr.length === 2);
    const r2 = rig();
    await attack(r2, 'one-tracker.net');
    await attack(r2, 'two-tracker.net');
    const res2 = await r2.api.decideAll('ignore');
    check('ignore all dismisses both, and writes no rule', res2.ok && res2.decided === 2 && r2.api.proposals().length === 0 && r2.state.dnr.length === 0, res2);
  }

  /* ---- 5. what an earlier build left behind --------------------------------------- */
  {
    const store = { domains: {
      'old-auto.net': { state: 'learned', hits: 9, firstSeen: 1, lastSeen: 2, sites: { 'x.example': { hits: 3 }, 'y.example': { hits: 3 }, 'z.example': { hits: 3 } }, sessions: ['s1', 's2'] },
      'approved.net': { state: 'learned', approvedAt: 1700000000000, hits: 4, firstSeen: 1, lastSeen: 2, sites: { 'x.example': { hits: 4 } } },
      'declined.net': { state: 'dismissed', dismissedAt: 1700000000000, hits: 4, firstSeen: 1, lastSeen: 2, sites: { 'x.example': { hits: 4 } } },
      'watching.net': { state: 'candidate', hits: 2, firstSeen: 1, lastSeen: 2, sites: { 'x.example': { hits: 2 } }, sessions: ['s1'] },
    } };
    const r = rig({ store });
    check('a learned entry with no approval behind it comes back as a proposal, marked legacy',
      r.entry('old-auto.net').state === 'proposed' && r.entry('old-auto.net').legacy === true && r.entry('old-auto.net').proposedAt > 0, r.entry('old-auto.net'));
    check('an approved entry stays learned', r.entry('approved.net').state === 'learned' && r.entry('approved.net').approvedAt === 1700000000000);
    check('a dismissed entry stays dismissed', r.entry('declined.net').state === 'dismissed');
    check('a candidate keeps the sessions it has seen -- the shape used to drop them, so a second session could never be counted after a worker restart',
      JSON.stringify(r.entry('watching.net').sessions) === JSON.stringify(['s1']) && JSON.stringify(r.entry('old-auto.net').sessions) === JSON.stringify(['s1', 's2']));
    await r.api.apply();
    check('after the migration only the approved entry has a rule', r.state.dnr.length === 1 && rulesFor(r, 'approved.net').length === 1, r.state.dnr);
    const listed = r.api.proposals();
    check('the popup is told which proposals are legacy', listed.length === 1 && listed[0].domain === 'old-auto.net' && listed[0].legacy === true);
    /* a candidate that finishes its evidence after a restart */
    r.state.session = 's2';
    await forge(r, 'y.example', 'watching.net');
    await forge(r, 'z.example', 'watching.net');
    check('a candidate reaches the proposal across a restart, because its sessions survived the reload', r.entry('watching.net').state === 'proposed', r.entry('watching.net'));
  }

  /* ---- 6. the wiring: handlers, popup, labels ------------------------------------- */
  check('the worker answers the popup\'s three questions', ["msg.kind === 'tracker-learner-proposals'", "msg.kind === 'tracker-learner-decide'", "msg.kind === 'tracker-learner-decide-all'"].every((k) => BG.indexOf(k) !== -1));
  const tabAllowed = BG.slice(BG.indexOf('const TAB_CONTEXT_ALLOWED_MESSAGES = new Set(['), BG.indexOf(']);', BG.indexOf('const TAB_CONTEXT_ALLOWED_MESSAGES = new Set([')));
  check('none of them can be sent by a page', !/tracker-learner/.test(tabAllowed));
  check('the learner no longer promotes to learned on its own', !/entry\.state = 'learned';\s*entry\.reason = strongHost/.test(BG) && /entry\.state = 'proposed';\s*entry\.proposedAt = now;/.test(BG));
  check('an observation never applies rules', /\/\/ A proposal changes no rule, so nothing is applied here; only a decision does that\.\s*await saveTrackerLearner\(false\);/.test(BG));
  check('the rule builder still keys on learned alone', /\.filter\(\(domain\) => TRACKER_LEARNER\.domains\[domain\] && TRACKER_LEARNER\.domains\[domain\]\.state === 'learned'\)/.test(BG));
  check('the popup shows the proposals with a decision beside each',
    /id="tracker-learner-proposals"/.test(POPUP_HTML) && /id="tracker-proposals-row"/.test(POPUP_HTML)
    && /kind: 'tracker-learner-proposals'/.test(POPUP_JS) && /kind: 'tracker-learner-decide', domain, decision/.test(POPUP_JS) && /kind: 'tracker-learner-decide-all', decision/.test(POPUP_JS));
  check('the popup says nothing is blocked until the reader says so', /Nothing is blocked until you say so/.test(POPUP_HTML));
  check('the popup names a legacy proposal for what it is', /Learned automatically by an earlier version; approve it to keep blocking it\./.test(POPUP_JS));
  check('the Activity Centre labels both moments', /proposed_tracker_domain: 'Tracker noticed, waiting for your decision'/.test(HISTORY) && /learned_tracker_domain: 'Tracker blocked everywhere, on your approval'/.test(HISTORY));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('the learner suggests; the reader decides');
})().catch((e) => { console.error(e); process.exit(1); });

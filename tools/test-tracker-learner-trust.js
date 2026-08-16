/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Who decides what the Tracker Learner blocks (M42)?
 *
 * A `learned` entry becomes a dynamic DNR rule with no initiatorDomains, so it blocks that domain
 * as a third party on EVERY site the user visits, rebuilt from storage on every worker start. The
 * only thing that feeds the learner is noteTrackerObservation, reached from the rg-block listener
 * -- and rg-block arrives over a forgeable MAIN-world event. The file says the rule fifteen lines
 * earlier: "a malicious page can FORGE them. Never learn an attacker-supplied domain." learnDomain
 * obeys it; this path did not, taking the third-party domain straight from `detail.domain`.
 *
 * Two things made that cheap to exploit:
 *
 *   1. looksLikeKnownTrackerHost dropped the thresholds to 1 hit / 1 site. It matches on the NAME
 *      -- anything under analytics., metrics., telemetry., beacon., adservice. -- and the name is
 *      a page-supplied string. One forged event naming analytics.<anything> was enough.
 *   2. The "three different sites" corroboration is counted with a two-label registrable-domain
 *      heuristic that is not public-suffix aware, so three free subdomains on three shared hosts
 *      are three distinct keys at no cost, reachable in a single visit through two redirects.
 *
 * The fix keeps the learner but takes the shortcut away and adds an axis the claimant does not
 * control: distinct browser sessions. It also protects the extension's own provider hosts, derived
 * from the manifest -- learning a block rule against our own reputation or breach endpoints would
 * let a page switch off the checks that protect the user.
 *
 * The real function is lifted from background.js and driven with forged events.
 *
 * Run: node tools/test-tracker-learner-trust.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
// registrableDomainBg delegates to registrableDomain, which the worker pulls in from this file.
// Without it normalizeTrackerDomain throws and returns '', and isProtectedTrackerDomain reads ''
// as PROTECTED -- so every check in this suite would pass while testing nothing.
const DOMAIN_UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function lift(name, kind) {
  const head = (kind || 'function ') + name + '(';
  let start = BG.indexOf(head);
  if (start < 0) return null;
  // `function X(` also matches inside `async function X(`. Lifting from there drops the `async`
  // and the body then fails to parse on its first await -- so look back for it.
  if (BG.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0;
  for (let i = BG.indexOf('{', start); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(start, i + 1); }
  }
  return null;
}

const PIECES = ['noteTrackerObservation', 'isProtectedTrackerDomain', 'looksLikeKnownTrackerHost',
  'trackerDistinctSiteCount', 'trackerDistinctSessionCount', 'ownProviderDomains',
  'trackerLearnerSessionId', 'normalizeTrackerDomain', 'registrableDomainBg'];

const missing = PIECES.filter((p) => !lift(p) && !lift(p, 'async function '));
check('every piece of the learner is present', missing.length === 0, 'missing: ' + missing.join(', '));

function build(sessionId) {
  const state = { learner: { domains: {} }, saved: 0, applied: 0, session: sessionId };
  const sandbox = {
    console, Math, Date, Object, Array, Set, Map, Number, String, URL, JSON, isNaN,
    TRACKER_PROTECTED_DOMAINS: new Set(['stripe.com', 'okta.com']),
    TRACKER_LEARNER: state.learner,
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true },
    localGet: async () => ({ wardenone_config: { enabled: true, trackerLearner: true } }),
    loadTrackerLearner: async () => {},
    saveTrackerLearner: async () => { state.saved++; },
    applyTrackerLearnerRules: () => { state.applied++; },
    pruneTrackerLearnerStore: () => {},
    queueHistory: () => {},
    chrome: {
      runtime: { getManifest: () => MANIFEST },
      storage: { session: { get: async () => ({ __wo_tracker_session: state.session }), set: async () => {} } },
    },
  };
  vm.createContext(sandbox);
  // The module-level state these functions close over. Lifting by function name alone leaves them
  // undeclared, and the failure is silent rather than loud: trackerLearnerSessionId swallows the
  // ReferenceError in its own try/catch and returns '', so no session is ever recorded and the
  // learner simply stops learning -- which looks exactly like the fix having broken the feature.
  const src = DOMAIN_UTILS + '\nvar __trackerSessionId="";var __ownProviderDomains=null;\n'
    + BG.slice(BG.indexOf('const TRACKER_LEARN_MIN_SITES'),
      BG.indexOf('\n', BG.indexOf('const TRACKER_LEARN_MIN_HITS')))
    + '\n' + PIECES.map((p) => lift(p) || lift(p, 'async function ')).filter(Boolean).join('\n')
    + '\nglobalThis.__note=noteTrackerObservation;'
    + 'globalThis.__prot=isProtectedTrackerDomain;globalThis.__norm=normalizeTrackerDomain;'
    // A browser restart, from the inside: __trackerSessionId is a lexical binding in the lifted
    // source, so it can only be cleared by code that shares that scope.
    + 'globalThis.__newSession=function(){__trackerSessionId="";};';
  vm.runInContext(src, sandbox);
  return { sandbox, state, note: sandbox.__note, protectedFn: sandbox.__prot, norm: sandbox.__norm };
}

// A hostile page forging the event, exactly as bridge.js would relay it.
async function forge(rig, site, domain, signal) {
  await rig.note('https://' + site + '/', { domain, signal: signal || 'tracking-path' });
}
// The learner keys on the REGISTRABLE domain, not the host it was told about -- so a report
// naming analytics.victim-bank.com is stored, and would be blocked, as victim-bank.com. Look the
// entry up the way the learner files it, or this suite asks about a key that never exists and
// every 'not learned' assertion passes for free.
const learned = (rig, d) => ((rig.state.learner.domains || {})[rig.norm(d)] || {}).state === 'learned';

// Anti-vacuity guard. normalizeTrackerDomain returns '' on any internal error, and
// isProtectedTrackerDomain reads '' as PROTECTED -- so a missing dependency makes every check in
// this file pass while testing nothing at all. That is exactly what happened when
// registrableDomainBg was left out of PIECES. Prove the rig can tell the two apart before
// trusting anything below.
{
  const rig = build('session-A');
  check('the rig can see an ordinary domain as unprotected',
    rig.protectedFn('telemetry.example.org') === false,
    'normalizeTrackerDomain is failing, so every check here is vacuous');
}

(async () => {
  // -------------------------------------------------------------------------
  // 1. The one-message kill: a name matching the "known tracker" pattern.
  // -------------------------------------------------------------------------
  {
    const rig = build('session-A');
    await forge(rig, 'attacker.example', 'analytics.victim-bank.com');
    check('a single forged event cannot learn a domain, even a tracker-shaped one',
      !learned(rig, 'analytics.victim-bank.com'),
      'one message still produces a browser-wide block rule');
  }

  // -------------------------------------------------------------------------
  // 2. Three free hosts in one visit -- the corroboration the attacker supplies for free.
  // -------------------------------------------------------------------------
  {
    const rig = build('session-A');
    for (const site of ['a.pages.dev', 'b.netlify.app', 'c.github.io']) {
      for (let i = 0; i < 3; i++) await forge(rig, site, 'telemetry.example.org');
    }
    check('three attacker-controlled sites in ONE session are not enough',
      !learned(rig, 'telemetry.example.org'),
      'a single visit still poisons the block list');
  }

  // -------------------------------------------------------------------------
  // 3. The genuine case must still work: seen widely, across more than one session.
  // -------------------------------------------------------------------------
  {
    const rig = build('session-A');
    for (const site of ['news.example', 'shop.example', 'forum.example']) {
      for (let i = 0; i < 3; i++) await forge(rig, site, 'telemetry.example.org');
    }
    check('one session alone still does not learn', !learned(rig, 'telemetry.example.org'));

    // A browser restart: new session id, and the cached one released. __trackerSessionId is a
    // lexical binding inside the lifted source, so it cannot be reset from the sandbox object.
    rig.state.session = 'session-B';
    rig.sandbox.__newSession();
    for (const site of ['news.example', 'shop.example', 'forum.example']) {
      await forge(rig, site, 'telemetry.example.org');
    }
    check('a real tracker seen across two sessions is still learned',
      learned(rig, 'telemetry.example.org'),
      'the learner stopped working entirely');
    // applyTrackerLearnerRules is called BY saveTrackerLearner, which this rig stubs, so the
    // observable here is the persist -- that is what carries the new state to the rule builder.
    check('and learning it persists the new state', rig.state.saved > 0);
  }

  // -------------------------------------------------------------------------
  // 4. The extension's own providers can never be learned, however much evidence is forged.
  // -------------------------------------------------------------------------
  {
    const rig = build('session-A');
    const ours = ['abuse.ch', 'virustotal.com', 'haveibeenpwned.com', 'pwnedpasswords.com',
      'phishtank.com', 'abuseipdb.com', 'rdap.org', 'whoisxmlapi.com', 'safebrowsing.googleapis.com'];
    for (const d of ours) {
      check('the extension\'s own provider is protected: ' + d, rig.protectedFn(d) === true,
        'a page could block the checks that protect the user');
    }
    for (const d of ours) {
      for (const site of ['a.example', 'b.example', 'c.example']) {
        for (let i = 0; i < 3; i++) await forge(rig, site, d);
      }
    }
    check('and none of them entered the learner at all',
      ours.every((d) => !(rig.state.learner.domains || {})[d]));
  }

  // -------------------------------------------------------------------------
  // 5. Guards that already held must keep holding.
  // -------------------------------------------------------------------------
  {
    const rig = build('session-A');
    check('a brand on the protected list is still refused', rig.protectedFn('stripe.com') === true);
    await forge(rig, 'a.example', 'plain.example.org', 'resource-url');
    check('mere DOM discovery is still refused as evidence',
      !(rig.state.learner.domains || {})['plain.example.org']);
  }

  // -------------------------------------------------------------------------
  // 6. Shape: the name-pattern shortcut is gone from the thresholds for good.
  // -------------------------------------------------------------------------
  {
    const fn = lift('noteTrackerObservation', 'async function ') || '';
    const code = fn.replace(/\/\/[^\n]*/g, '');
    check('the thresholds no longer bend for a page-supplied name',
      !/minHits = strongHost/.test(code) && !/minSites = strongHost/.test(code),
      'the 1-hit / 1-site shortcut is back');
    check('sessions are part of the learn condition', /TRACKER_LEARN_MIN_SESSIONS/.test(code));
  }

  if (failed) { console.error('\n' + failed + ' tracker-learner-trust check(s) failed'); process.exit(1); }
  console.log('\nthe page can report, but it cannot decide what gets blocked');
})().catch((e) => { console.error('tracker-learner suite threw: ' + e.message); process.exit(1); });

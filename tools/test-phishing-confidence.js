/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What "high confidence" is allowed to mean.
 * Run: node tools/test-phishing-confidence.js
 *
 * blockHighConfidencePhishing turns a warning into a block, so the tier it reads
 * is load-bearing in a way the other tiers are not: a wrong "high" takes a site
 * away from someone with no way round it.
 *
 * It was not safe to switch on. Run against real hostnames, the old rule rated
 * nine of fifteen ordinary sites high -- apple.stackexchange.com, sony.co.uk,
 * crypto.stanford.edu, target.scene7.com -- for two reasons:
 *
 *   1. the registrable label was taken as "second from the right", which has no
 *      idea what a public suffix is, so sony.co.uk read as sld="co" and Sony's
 *      own site looked like a Sony subdomain spoof
 *   2. a brand word anywhere left of the registrable domain was rated high on
 *      its own, and most short brand names are also ordinary words
 *
 * So this suite is a corpus, not a set of assertions about code shape. The rule
 * may be rewritten however anyone likes; what it may not do is start blocking
 * the left-hand column.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const lines = SRC.split('\n');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* The real detector, lifted. A restatement would agree with itself. */
function loadDetector() {
  const start = lines.findIndex((l) => l.indexOf('const BRANDS={') >= 0);
  const endMark = lines.findIndex((l, i) => i > start && l.indexOf('phishHit.confidence="high"),') >= 0);
  assert(start >= 0 && endMark > start, 'the phishing detector has moved');

  /* SITE_BOUNDARY lives far above the detector and the detector depends on it.
     Left out, every case dies with "not defined" -- which on a pass/fail count
     reads exactly like "nothing is flagged any more", i.e. like success. */
  const sbStart = lines.findIndex((l) => l.indexOf('SITE_BOUNDARY=(()=>{') >= 0);
  const sbEnd = lines.findIndex((l, i) => i > sbStart && l.indexOf('VERIFICATION_FLOW_POLICY=(()=>{') >= 0);
  assert(sbStart >= 0 && sbEnd > sbStart, 'SITE_BOUNDARY has moved');
  const boundary = 'const ' + lines.slice(sbStart, sbEnd).join('\n').replace(/,\s*$/, ';');

  let body = boundary + '\n' + lines.slice(start, endMark + 1).join('\n');
  // The slice stops mid-expression, at the punycode upgrade. Close it off.
  body = body.replace(
    /if\(phishHit&&isPuny&&\(phishHit\.kind="homograph",\s*phishHit\.confidence="high"\),\s*$/,
    'if(phishHit&&isPuny){phishHit.kind="homograph";phishHit.confidence="high";}',
  );

  return (hostname) => {
    const sandbox = {
      location: { hostname },
      WO: {},
      Object, Set, Math, String, Array, Number, JSON,
      __result: null,
    };
    vm.createContext(sandbox);
    vm.runInContext('(function(){' + body + '__result=phishHit;})();', sandbox, { timeout: 5000 });
    return sandbox.__result;
  };
}

const verdict = loadDetector();

/* Ordinary sites. Every one of these is real, and every one contains a brand
   name somewhere in the hostname -- which is the whole difficulty. */
const ORDINARY = [
  'apple.stackexchange.com',
  'sony.co.uk',
  'wise.edu.au',
  'crypto.stanford.edu',
  'steam.oxfordjournals.org',
  'target.scene7.com',
  'chase.pgatour.com',
  'square.github.io',
  'uber.github.io',
  'gemini.google.com',
  'signal.org',
  'discord.com',
  'developer.apple.com',
  'support.google.com',
];

/* Shapes that really are phishing. Blocking has to survive, or the tier is
   worthless and the switch may as well not exist. */
const PHISHING = [
  'paypal.tk',
  'paypa1.com',
  'apple.secure-login.tk',
];

(function highIsNeverSpentOnAnOrdinarySite() {
  const wrong = [];
  ORDINARY.forEach((host) => {
    let v = null;
    try { v = verdict(host); } catch (e) { failures.push(host + ' threw: ' + e.message); return; }
    if (v && v.confidence === 'high') wrong.push(host + ' (' + v.kind + '/' + v.brand + ')');
  });
  check('no ordinary site is rated high', wrong.length === 0,
    'these would be BLOCKED for anyone with the switch on: ' + wrong.join(', '));
}());

(function theTwoThatWereWrongForStructuralReasons() {
  /* Kept by name because they failed for a cause a corpus alone would not
     explain: the public suffix. If the registrable label goes back to being
     counted from the right, these two come back first. */
  ['sony.co.uk', 'wise.edu.au'].forEach((host) => {
    const v = verdict(host);
    check(host + ' is not flagged at all', !v,
      v && (v.confidence + '/' + v.kind + ' — the registrable label is being counted, not resolved'));
  });
}());

(function realPhishingIsStillCaught() {
  PHISHING.forEach((host) => {
    const v = verdict(host);
    check(host + ' is still rated high', !!v && v.confidence === 'high',
      v ? v.confidence + '/' + v.kind : 'not flagged at all');
  });
}());

(function aBrandSubdomainAloneIsNotEnough() {
  /* The specific demotion. A brand word left of the registrable domain is the
     weakest signal here and was the only one rated high; it now needs a
     phishing word or a throwaway TLD beside it. Both halves are checked, so
     "demote everything" cannot pass this. */
  const bare = verdict('apple.stackexchange.com');
  check('a bare brand subdomain is a warning, not a block',
    !!bare && bare.confidence === 'medium', bare && bare.confidence);
  const corroborated = verdict('apple.secure-login.tk');
  check('the same shape with a phishing word beside it is still high',
    !!corroborated && corroborated.confidence === 'high', corroborated && corroborated.confidence);
}());

(function theBlockIsReachableFromAGuidedPath() {
  /* The switch existed and did something useful and no guided path ever set it,
     so in practice it protected nobody. It is in the maximum-privacy bundle
     rather than the recommended one because blocking is the one action here a
     reader cannot work around. */
  const at = BG.indexOf('const ONBOARDING_MAX_PRIVACY');
  const bundle = BG.slice(at, BG.indexOf('\n});', at));
  check('maximum privacy switches the block on',
    /blockHighConfidencePhishing:\s*true/.test(bundle),
    'the strongest anti-phishing action is unreachable from onboarding again');

  /* And the warning stays unconditional, for everyone, whatever the bundle. */
  check('the warning does not depend on the block being on',
    /log\("warned_phishing"/.test(SRC) && !/blockHighConfidencePhishing&&.*log\("warned_phishing"/.test(SRC),
    'the warning has been folded behind the block switch');
}());

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('phishing confidence: ' + pass + ' checks passed');

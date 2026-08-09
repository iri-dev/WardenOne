/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * SafeSearch enforcement (toggle: safeSearch, OFF by default).
 *
 * The rules are a redirect that adds the engine's SafeSearch parameter plus a
 * higher-priority allow that matches once the parameter is present. That allow
 * is the ONLY thing stopping an infinite redirect loop -- lose it, or let its
 * priority drop below the redirect's, and every search on those engines becomes
 * ERR_TOO_MANY_REDIRECTS. So the regexes are built here and run against real
 * URLs rather than eyeballed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
  assert(cond, name + (extra ? ' :: ' + extra : ''));
  console.log('  ok  - ' + name);
  passed++;
}

function num(name) {
  const m = BG.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)\\s*;'));
  assert(m, 'missing constant ' + name);
  return Number(m[1]);
}

/* Run the shipped engine table for real. */
const tableSrc = BG.slice(BG.indexOf('const SAFE_SEARCH_ENGINES = ['), BG.indexOf('];', BG.indexOf('const SAFE_SEARCH_ENGINES = [')) + 2);
const ENGINES = new Function(tableSrc + '; return SAFE_SEARCH_ENGINES;')();

check('every major engine is covered', ENGINES.length >= 5, ENGINES.length + ' engines');
check('defaults OFF in background', /safeSearch:\s*false/.test(BG));
check('defaults OFF in popup', /safeSearch:\s*false/.test(POPUP_JS));
check('popup exposes the toggle', /data-key="safeSearch"/.test(POPUP_HTML));
check('popup says it is off by default and why',
  /Off by default: it changes what search will show you/i.test(POPUP_HTML));

/* The rule band must not collide with its neighbours. */
const base = num('SAFE_SEARCH_RULE_BASE');
const max = num('SAFE_SEARCH_RULE_MAX');
const budget = num('SAFE_SEARCH_RULES_BUDGET');
const minerBase = num('MINER_FEED_RULE_BASE');
const minerMax = num('MINER_FEED_MAX');
const neverBlock = num('NEVER_BLOCK_ALLOW_RULE_BASE');
check('band starts after the cryptominer feed', base >= minerBase + minerMax);
check('band ends before the never-block allow rules', base + max <= neverBlock);
check('declared budget matches the band', budget === max);
check('the rules fit the band', ENGINES.length * 2 + 1 <= max,
  (ENGINES.length * 2 + 1) + ' rules vs ' + max);

/* Loop safety: the allow must outrank the redirect. */
const applyFn = BG.slice(BG.indexOf('async function applySearchParamRules'));
const applyBody = applyFn.slice(0, applyFn.indexOf('\n}\n'));
const allowPriorities = [...applyBody.matchAll(/push\((\d+),\s*allow\(\)/g)].map((m) => Number(m[1]));
const redirectPriorities = [...applyBody.matchAll(/push\((\d+),\s*addParams\(/g)].map((m) => Number(m[1]));
check('every allow rule outranks every redirect rule (this is the loop guard)',
  allowPriorities.length > 0 && redirectPriorities.length > 0
    && Math.min(...allowPriorities) > Math.max(...redirectPriorities),
  'allow=[' + allowPriorities.join(',') + '] redirect=[' + redirectPriorities.join(',') + ']');
// Every allow/redirect goes through push(), which hardcodes main_frame. The
// YouTube rule is a header edit, not an allow, so its wider resource types are
// deliberate and are asserted separately below.
check('the allow/redirect builder is scoped to main_frame, so subresources stay blockable',
  /const push = \([\s\S]{0,400}?condition: \{ regexFilter, resourceTypes: \['main_frame'\] \}/.test(applyBody));

/* Behaviour, per engine, against real URLs. */
const SAMPLES = {
  google: 'https://www.google.com/search?q=test',
  bing: 'https://www.bing.com/search?q=test',
  duckduckgo: 'https://duckduckgo.com/?q=test',
  brave: 'https://search.brave.com/search?q=test',
  yahoo: 'https://uk.search.yahoo.com/search?p=test',
};

for (const engine of ENGINES) {
  const url = SAMPLES[engine.label];
  check('a sample URL exists for ' + engine.label, !!url);
  const redirectRe = new RegExp(engine.match);
  const allowRe = new RegExp(engine.allow);

  check(engine.label + ': the redirect rule matches a plain search', redirectRe.test(url));
  check(engine.label + ': the allow rule does NOT match a plain search', !allowRe.test(url));

  // What the URL looks like after Chrome applies addOrReplaceParams.
  const after = url + '&' + engine.param + '=' + engine.value;
  check(engine.label + ': the allow rule matches the redirected URL (loop terminates)',
    allowRe.test(after), after);

  // ...and if the engine put the param first.
  const firstParam = url.replace('?', '?' + engine.param + '=' + engine.value + '&');
  check(engine.label + ': the allow rule matches when the parameter comes first',
    allowRe.test(firstParam), firstParam);
}

/* The redirect must not fire on things that are not searches. */
const googleEngine = ENGINES.find((e) => e.label === 'google');
const googleRe = new RegExp(googleEngine.match);
check('google rule ignores non-search pages',
  !googleRe.test('https://mail.google.com/mail/u/0/') && !googleRe.test('https://drive.google.com/drive/my-drive'));
check('google rule covers country domains', googleRe.test('https://www.google.co.uk/search?q=test'));
check('duckduckgo rule ignores the homepage without a query',
  !new RegExp(ENGINES.find((e) => e.label === 'duckduckgo').match).test('https://duckduckgo.com/'));

/* YouTube uses a request header, not a parameter. */
check('YouTube is restricted via its documented request header',
  /header:\s*'YouTube-Restrict',\s*operation:\s*'set',\s*value:\s*'Strict'/.test(applyBody));
check('YouTube rule targets the youtube domains',
  /SAFE_SEARCH_YT_DOMAINS\s*=\s*\['youtube\.com',\s*'youtube-nocookie\.com'\]/.test(BG));

/* ---- Google "Web results only" (udm=14) ----------------------------------
 * Google's Images/Videos/News tabs are udm values too, so a rule that replaced
 * udm would trap the user in Web mode permanently. Absence of a parameter is not
 * expressible in a DNR condition, so it is handled with rule priority instead.
 * These run the shipped regexes against the real tab URLs.                    */
// These constants are defined in terms of each other, so they have to be
// evaluated together rather than one at a time.
const GOOGLE_CONST_NAMES = ['GOOGLE_SEARCH_MATCH', 'GOOGLE_UDM_PRESENT', 'GOOGLE_SAFE_PRESENT', 'GOOGLE_UDM_AND_SAFE_PRESENT'];
const googleConstSrc = GOOGLE_CONST_NAMES.map((name) => {
  const m = BG.match(new RegExp('const\\s+' + name + '\\s*=\\s*([\\s\\S]*?);\\n'));
  assert(m, 'missing regex constant ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
}).join('\n');
const G = new Function(googleConstSrc + '\nreturn {' + GOOGLE_CONST_NAMES.join(',') + '};')();
const G_MATCH = new RegExp(G.GOOGLE_SEARCH_MATCH);
const UDM_PRESENT = new RegExp(G.GOOGLE_UDM_PRESENT);
const SAFE_PRESENT = new RegExp(G.GOOGLE_SAFE_PRESENT);
const BOTH_PRESENT = new RegExp(G.GOOGLE_UDM_AND_SAFE_PRESENT);

const PLAIN = 'https://www.google.com/search?q=test';
const IMAGES = 'https://www.google.com/search?q=test&udm=2';
const VIDEOS = 'https://www.google.com/search?q=test&udm=7';
const WEBBED = 'https://www.google.com/search?q=test&udm=14';

check('web-only defaults OFF in background', /googleWebResultsOnly:\s*false/.test(BG));
check('web-only defaults OFF in popup', /googleWebResultsOnly:\s*false/.test(POPUP_JS));
check('popup exposes the web-only toggle', /data-key="googleWebResultsOnly"/.test(POPUP_HTML));

check('web-only alone: a plain search gets redirected', G_MATCH.test(PLAIN) && !UDM_PRESENT.test(PLAIN));
check('web-only alone: the redirected URL is then allowed (loop terminates)', UDM_PRESENT.test(WEBBED));
check('web-only alone: the Images tab is allowed through untouched', UDM_PRESENT.test(IMAGES));
check('web-only alone: the Videos tab is allowed through untouched', UDM_PRESENT.test(VIDEOS));

/* Both features on. The higher-priority rule claims every URL that already has a
   udm, so the lower one only ever sees URLs without one. */
const IMAGES_SAFE = IMAGES + '&safe=active';
const PLAIN_BOTH = PLAIN + '&safe=active&udm=14';
const PLAIN_BOTH_REVERSED = 'https://www.google.com/search?udm=14&q=test&safe=active';

check('both on: a plain search satisfies neither guard yet', !BOTH_PRESENT.test(PLAIN));
check('both on: the Images tab is claimed by the has-udm rule, not the add-both rule',
  UDM_PRESENT.test(IMAGES) && !BOTH_PRESENT.test(IMAGES));
check('both on: Images plus SafeSearch then terminates', BOTH_PRESENT.test(IMAGES_SAFE));
check('both on: a fully-transformed plain search terminates', BOTH_PRESENT.test(PLAIN_BOTH));
check('both on: termination does not depend on parameter order', BOTH_PRESENT.test(PLAIN_BOTH_REVERSED));
check('both on: safe present but udm missing does NOT terminate (udm still gets added)',
  SAFE_PRESENT.test(PLAIN + '&safe=active') && !BOTH_PRESENT.test(PLAIN + '&safe=active'));

/* The has-udm rule must outrank the add-both rule, or Images breaks. */
const bothBlock = applyBody.slice(applyBody.indexOf('if (safeOn && webOnly)'), applyBody.indexOf('} else if (safeOn)'));
const prios = [...bothBlock.matchAll(/push\((\d+),/g)].map((m) => Number(m[1]));
check('both-on rules are ordered allow > has-udm > add-both',
  prios.length === 3 && prios[0] > prios[1] && prios[1] > prios[2], prios.join(' > '));
check('the has-udm rule adds only SafeSearch, never udm',
  /push\(12050, addParams\(\[SAFE\]\), GOOGLE_UDM_PRESENT\)/.test(applyBody));

check('non-search Google pages are untouched by the web-only rule',
  !G_MATCH.test('https://mail.google.com/mail/u/0/')
    && !G_MATCH.test('https://www.google.com/maps'));

/* Wiring. */
check('rules are re-applied when either toggle changes',
  /o\.safeSearch\s*!==\s*n\.safeSearch/.test(BG)
    && /o\.googleWebResultsOnly\s*!==\s*n\.googleWebResultsOnly/.test(BG));
check('rules are cleared when the extension is switched off',
  /applySearchParamRules\(\{ enabled: false \}\)/.test(BG));
check('rules use session storage, not dynamic',
  /getSessionRules\(\)/.test(applyBody) && /updateSessionRules/.test(applyBody));

console.log('\n' + passed + ' passed, 0 failed');

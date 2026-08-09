/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Search-junk marker (toggle: flagSearchJunk, OFF by default).
 *
 * The property that matters is that it MARKS and never removes. Search filtering
 * fails invisibly -- drop the one result that answered the question and the user
 * never learns it existed -- so "there is always a way to see the result" is a
 * correctness requirement here, not a nicety.
 *
 * The host-matching logic is pulled out of search-junk.js and executed, because a
 * registrable-domain bug is how a blocklist starts dimming the wrong sites.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'search-junk.js'), 'utf8');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-junk-domains.json'), 'utf8'));
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
  assert(cond, name + (extra ? ' :: ' + extra : ''));
  console.log('  ok  - ' + name);
  passed++;
}

/* ---- seed list ---- */
check('seed list is populated', Array.isArray(SEED.scraperHosts) && SEED.scraperHosts.length >= 15,
  (SEED.scraperHosts || []).length + ' hosts');
const badSeed = SEED.scraperHosts.filter((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) || d.includes('..'));
check('every seed entry is a well-formed domain', badSeed.length === 0, badSeed.join(', '));
check('no duplicate seed entries', new Set(SEED.scraperHosts).size === SEED.scraperHosts.length);

/* Dimming a real source would be the whole feature backfiring. */
const MUST_NOT_MARK = [
  'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com',
  'askubuntu.com', 'github.com', 'developer.mozilla.org', 'wikipedia.org',
  'python.org', 'nodejs.org', 'reddit.com', 'medium.com', 'w3schools.com',
];
const collisions = MUST_NOT_MARK.filter((safe) =>
  SEED.scraperHosts.some((d) => d === safe || d.endsWith('.' + safe)));
check('no upstream source is in the seed list', collisions.length === 0, collisions.join(', '));

/* ---- host matching, executed ---- */
const sandbox = new Function(
  'var hosts = Object.create(null);\n'
  + SCRIPT.slice(SCRIPT.indexOf('function registrable'), SCRIPT.indexOf('function ensureStyle'))
  + '\nreturn { hosts, registrable, isJunkHost, addHosts };'
)();
sandbox.addHosts(SEED.scraperHosts);

check('a seed host matches', sandbox.isJunkHost('9to5answer.com'));
check('a www. prefix still matches', sandbox.isJunkHost('www.9to5answer.com'));
check('a subdomain of a seed host matches', sandbox.isJunkHost('cdn.9to5answer.com'));
check('an unrelated host does not match', !sandbox.isJunkHost('stackoverflow.com'));
check('a host that merely ENDS with a seed name does not match',
  !sandbox.isJunkHost('notqastack.net') && !sandbox.isJunkHost('fixes.pub.example.com'));
check('registrable domain handles a two-part public suffix',
  sandbox.registrable('foo.bar.co.uk') === 'bar.co.uk');
check('malformed entries are dropped rather than stored', (function () {
  const before = Object.keys(sandbox.hosts).length;
  sandbox.addHosts(['not a domain', '..bad..', '', 'http://x', null]);
  return Object.keys(sandbox.hosts).length === before;
})());

/* ---- it must never remove a result ---- */
check('nothing is removed from the results DOM',
  !/\.remove\(\)\s*;?\s*$/m.test(SCRIPT.replace(/strip\.remove\(\);/g, ''))
    && !/display\s*:\s*none/.test(SCRIPT)
    && !/\.hidden\s*=\s*true/.test(SCRIPT),
  'the marker must dim, never hide');
check('every marked result keeps a way to see it', /Show anyway/.test(SCRIPT));
check('the dim is reversible in place', /setAttribute\(MARK_ATTR, '0'\)/.test(SCRIPT));
check('marking is bounded per page', /MAX_MARKS/.test(SCRIPT) && /marked >= MAX_MARKS/.test(SCRIPT));
check('a result is only marked once', /block\.hasAttribute\(MARK_ATTR\)/.test(SCRIPT));

/* ---- safety rails ---- */
check('the results container itself can never be marked',
  /node !== root && root\.contains\(node\)/.test(SCRIPT),
  'a bad selector match would otherwise dim the whole page');
check('an unknown search engine marks nothing', /if \(!engine\) return;/.test(SCRIPT));
check('an allowlisted search engine is skipped entirely',
  /cfg\.allowlist/.test(SCRIPT) && /host === a \|\| host\.endsWith\('\.' \+ a\)/.test(SCRIPT));
check('it does nothing while the toggle is off',
  /cfg\.flagSearchJunk !== true/.test(SCRIPT));
check('it runs in the top frame only', /window\.top !== window/.test(SCRIPT));

/* ---- wiring ---- */
check('defaults OFF in background', /flagSearchJunk:\s*false/.test(BG));
check('defaults OFF in popup', /flagSearchJunk:\s*false/.test(POPUP_JS));
check('popup exposes the toggle', /data-key="flagSearchJunk"/.test(POPUP_HTML));
check('popup copy promises it never removes results',
  /never removes them/i.test(POPUP_HTML));
check('it is not a static content script (would defeat lazy loading)',
  !/search-junk\.js/.test(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')));

const reconcile = BG.slice(BG.indexOf('async function reconcileSearchJunkInjection'));
const reconcileBody = reconcile.slice(0, reconcile.indexOf('\n}\n'));
check('registered only when the toggle is explicitly on',
  /flagSearchJunk === true/.test(reconcileBody));
check('unregistered when the toggle goes off', /unregisterContentScripts/.test(reconcileBody));
check('scoped to search engines, never <all_urls>',
  /SEARCH_JUNK_MATCHES/.test(reconcileBody)
    && !/'<all_urls>'/.test(BG.slice(BG.indexOf('const SEARCH_JUNK_MATCHES'), BG.indexOf('async function reconcileSearchJunkInjection'))));

/* ---- the auto-updating bucket ---- */
check('a supplemental bucket exists with a cap', /searchJunkDomainsExtra:\s*\d+/.test(BG));
check('the bucket has drift protection like the others',
  /searchJunkDomainsExtra:\s*\{\s*minBaseline/.test(BG));
check('the bucket is in the empty-list shape', /searchJunkDomainsExtra:\s*\[\]/.test(BG));
check('a subscribed manifest can name the bucket',
  /searchjunkdomains\|searchjunkdomainsextra/.test(BG));
check('the script reads the bucket at runtime', /searchJunkDomainsExtra/.test(SCRIPT));

/* The feed. Its bare-domains output is what parseList() understands; the same
   project's uBlock-syntax outputs would parse to nothing, because parseList
   rejects `||host^$all` and skips every cosmetic rule. Pointing the source at
   one of those would silently yield an empty list. */
const sourcesBlock = BG.slice(BG.indexOf('const SUPPLEMENTAL_LIST_SOURCES'), BG.indexOf('const SUPPLEMENTAL_BUNDLED_MANIFEST_PATH'));
check('a maintained feed is wired to the bucket',
  /bucket:\s*'searchJunkDomainsExtra'/.test(sourcesBlock));
check('the feed is the bare-domains output, not the filter-syntax one',
  /other_format\/domains\/all\.txt/.test(sourcesBlock),
  'parseList cannot read the uBlock-syntax variants');
check('the feed is attributed in CREDITS',
  /uBlock-Origin-dev-filter/.test(fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8')));

/* parseList is what turns the feed into hosts, so its guards matter here. */
const parseListSrc = BG.slice(BG.indexOf('function parseList(text)'), BG.indexOf('\n}\n', BG.indexOf('function parseList(text)')));
check('the parser refuses never-block domains, so a bad feed cannot dim GitHub',
  /isNeverBlockDomain\(line\)/.test(parseListSrc));
check('the parser skips comment lines the feed header uses',
  /startsWith\('#'\)/.test(parseListSrc));

console.log('\n' + passed + ' passed, 0 failed');

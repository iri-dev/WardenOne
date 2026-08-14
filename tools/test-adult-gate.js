/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Runs against shipped content.min.js and checks the adult-site gate domain list.
 *
 * Run: node tools/test-adult-gate.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const MIN = fs.readFileSync('content.min.js', 'utf8');
const marker = 'ADULT_DOMAINS=';
const start = MIN.indexOf(marker);
if (start < 0) {
  console.error('FATAL: ADULT_DOMAINS marker not found in content.min.js');
  process.exit(2);
}
const arrayStart = MIN.indexOf('[', start);
const arrayEnd = MIN.indexOf('],DEFAULTS=', arrayStart);
if (arrayStart < 0 || arrayEnd < arrayStart) {
  console.error('FATAL: ADULT_DOMAINS array bounds not found in content.min.js');
  process.exit(2);
}

const domains = vm.runInNewContext('(' + MIN.slice(arrayStart, arrayEnd + 1) + ')');
const set = new Set(domains);

function normalized(host) {
  return String(host || '').replace(/^www\./, '').toLowerCase();
}

function matches(host) {
  const h = normalized(host);
  return domains.some((d) => h === d || h.endsWith('.' + d));
}

function check(name, fn) {
  try {
    fn();
    console.log('  ok  - ' + name);
    check.pass++;
  } catch (e) {
    console.error('FAIL - ' + name);
    console.error(e && e.stack || e);
    check.fail++;
  }
}
check.pass = 0;
check.fail = 0;

check('adult domain list is substantially expanded', () => {
  assert(domains.length >= 130, 'expected >= 130 domains, got ' + domains.length);
});

check('adult domain list has no duplicates', () => {
  assert.strictEqual(set.size, domains.length);
});

check('adult domain list entries are safe domain literals', () => {
  for (const d of domains) {
    assert.strictEqual(d, d.toLowerCase(), d + ' should be lowercase');
    assert(!/^\./.test(d), d + ' should not start with a dot');
    assert(!/[*:/?#]/.test(d), d + ' should be a domain, not a URL/filter');
    assert(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d), d + ' should look like a domain');
  }
});

check('representative expanded adult domains are present', () => {
  [
    'camsoda.com',
    'clips4sale.com',
    'manyvids.com',
    'redgifs.com',
    'literotica.com',
    'javlibrary.com',
    'rule34.paheal.net',
    'thothub.to',
    'xlovecam.com',
  ].forEach((d) => assert(set.has(d), d + ' missing'));
});

check('known adult domains and their subdomains match', () => {
  [
    'www.camsoda.com',
    'live.camsoda.com',
    'thumbzilla.com',
    'cdn.rule34.paheal.net',
    'videos.redgifs.com',
  ].forEach((h) => assert(matches(h), h + ' should match adult gate'));
});

check('common non-adult lookalike hosts stay out of the static list', () => {
  [
    'cambridge.ac.uk',
    'essex.ac.uk',
    'sexeducationforum.org.uk',
    'adultlearning.example',
    'webcam-driver.example',
  ].forEach((h) => assert(!matches(h), h + ' should not match adult gate static list'));
});

// ---------------------------------------------------------------------------
// The heuristic half: what the gate decides when a host is NOT on the list.
//
// Reported from live use: searching for an explicit word put the gate on the search results page,
// before going anywhere. The title check was worth the whole threshold on its own, so any page
// whose TITLE carried one of those words was gated -- and a results page is titled with whatever
// was typed into the box.
//
// The real scoring block is lifted out of src/content.js and run against hostname/title pairs, so
// this measures the shipped decision rather than a restatement of it.
const SRC = fs.readFileSync('src/content.js', 'utf8');

function decide(hostname, title) {
  const from = SRC.indexOf('      if(WO.adultHeuristics&&!onList){');
  const to = SRC.indexOf('\n      let adultReaskForceHeuristic', from);
  if (from < 0 || to <= from) throw new Error('adult heuristic source markers not found');
  const body = SRC.slice(SRC.indexOf('{', from) + 1, to).replace(/\}\s*$/, '');
  const sandbox = {
    WO: { adultHeuristics: true, __adultGateShown: false },
    onList: false,
    here: String(hostname).replace(/^www\./, ''),
    heuristicHit: false,
    heuristicReasons: [],
    location: { hostname },
    document: { title },
    maybeGateAdult() { sandbox.heuristicHit = true; },   // the deferred path gates too
    woOn(_target, _type, fn) { sandbox.__deferred = fn; },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext('let heuristicHit=false;const heuristicReasons=[];' + body
    + '\nthis.__hit = heuristicHit; this.__run = () => { if (this.__deferred) this.__deferred(); };',
  sandbox, { filename: 'src/content.js' });
  if (sandbox.__hit) return true;
  sandbox.__run();                       // whatever DOMContentLoaded would have done
  return !!sandbox.__hit || !!sandbox.heuristicHit;
}

check('a search results page is never gated, whatever was searched for', () => {
  [
    ['www.google.com', 'porn - Google Search'],
    ['www.google.co.uk', 'free porn videos - Google Search'],
    ['duckduckgo.com', 'xxx at DuckDuckGo'],
    ['search.brave.com', 'nsfw - Brave Search'],
    ['www.bing.com', 'hentai - Bing'],
  ].forEach(([host, title]) => assert(!decide(host, title), host + ' should not gate a results page'));
});

check('a results page stays exempt even when its own domain scores', () => {
  // Constructed to reach the exemption rather than to describe a real deployment: the TLD rule
  // scores any host ending in .cam, so a search engine on such a TLD would otherwise clear the
  // bar with an explicit query in its title. This is the case that makes the exemption
  // load-bearing rather than a second way of saying "the title cannot decide alone".
  assert(!decide('google.cam', 'porn - Google Search'), 'a results page must never be gated');
});

check('an ordinary page is not gated just for its title', () => {
  [
    ['en.wikipedia.org', 'Pornography - Wikipedia'],
    ['www.bbc.co.uk', 'The porn industry, explained - BBC News'],
    ['www.reddit.com', 'nsfw thread : r/AskReddit'],
  ].forEach(([host, title]) => assert(!decide(host, title), host + ' should not gate on title alone'));
});

check('an explicit domain is still gated', () => {
  [
    ['xvideos.example', 'home'],
    ['some-hentai-site.example', 'home'],
    ['freeporn.example', 'home'],
  ].forEach(([host, title]) => assert(decide(host, title), host + ' should still gate'));
});

check('a suggestive domain plus an explicit title still reaches the bar together', () => {
  assert(decide('cam-girls.example', 'live cams'), 'corroborated signal should still gate');
});

check('a suggestive domain with an innocent title does not gate on its own', () => {
  // 'adult-' is a soft signal worth 1, nowhere near the bar by itself. (A domain containing
  // 'camgirl' is a STRONG term and does gate alone, which is why it is not the example here.)
  assert(!decide('adult-learning.example', 'Adult learning courses'), 'soft host alone should not gate');
});

if (check.fail) {
  console.error('\n' + check.pass + ' passed, ' + check.fail + ' failed');
  process.exit(1);
}
console.log('\n' + check.pass + ' passed, 0 failed');

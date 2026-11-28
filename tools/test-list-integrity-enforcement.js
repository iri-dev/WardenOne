/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const start = BG.indexOf('const LIST_SEMANTIC_SKETCH_SIZE');
const end = BG.indexOf('function totalListDriftReason', start);
assert(start >= 0 && end > start, 'list integrity helpers moved in background.js');

const sandbox = {
  LIST_SOURCE_MIN_BASELINE: 50,
  LIST_SOURCE_DROP_RATIO: 0.35,
  LIST_SOURCE_SPIKE_RATIO: 2.5,
  LIST_SOURCE_SPIKE_FLOOR: 1000,
  LIST_INTEGRITY_KEY: 'wardenone_list_integrity',
  listSourceByteLimit: () => 18 * 1024 * 1024,
  localGet: async () => ({}),
  localSet: async () => {},
  queueHistory: () => {},
  crypto: require('crypto').webcrypto,
  Uint8Array,
  Array, Set, Object, String, Number, Math, Date, JSON, Promise, console,
};
vm.createContext(sandbox);
vm.runInContext(BG.slice(start, end) + '\nglobalThis.__integrity = { listIntegritySeed, listSemanticSketch, semanticSketchOverlap, evaluateListSourceIntegrity };', sandbox,
  { filename: 'background.js:list-integrity' });

const api = sandbox.__integrity;
const seed = '0123456789abcdef0123456789abcdef';
const domains = (prefix, count) => Array.from({ length: count }, (_, i) => prefix + i + '.example');
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  - ' + name);
  } catch (e) {
    console.error('  FAIL - ' + name);
    throw e;
  }
}

const baselineDomains = domains('stable-', 200);
const baseline = api.evaluateListSourceIntegrity('https://feed.invalid/list', null, 'hash-a', 500000, baselineDomains, [], seed);

check('a first observation establishes a bounded keyed semantic baseline', () => {
  assert.strictEqual(baseline.ok, true);
  assert.strictEqual(baseline.record.semanticSketch.length, 128);
  assert(baseline.record.semanticSketch.every(Number.isInteger));
  assert(!JSON.stringify(baseline.record).includes('stable-0.example'), 'raw domains must not be stored in integrity metadata');
});

check('ordinary list churn remains compatible', () => {
  const next = baselineDomains.slice(0, 180).concat(domains('new-', 20));
  const verdict = api.evaluateListSourceIntegrity('https://feed.invalid/list', baseline.record, 'hash-b', 500000, next, [], seed);
  assert.strictEqual(verdict.ok, true, verdict.reason);
});

check('same-size content substitution is rejected when the hash changes', () => {
  const replacement = domains('substituted-', 200);
  const verdict = api.evaluateListSourceIntegrity('https://feed.invalid/list', baseline.record, 'hash-c', 500000, replacement, [], seed);
  assert.strictEqual(verdict.ok, false);
  assert(/content overlap fell/i.test(verdict.reason), verdict.reason);
});

check('option-rule-only feeds are covered by the semantic sketch', () => {
  const rules = Array.from({ length: 80 }, (_, i) => ({ action: { type: 'block' }, condition: { urlFilter: 'ad' + i + '.invalid' } }));
  const first = api.evaluateListSourceIntegrity('https://feed.invalid/options', null, 'options-a', 100000, [], rules, seed);
  const replacement = rules.map((_, i) => ({ action: { type: 'allow' }, condition: { urlFilter: 'safe' + i + '.invalid' } }));
  const next = api.evaluateListSourceIntegrity('https://feed.invalid/options', first.record, 'options-b', 100000, [], replacement, seed);
  assert.strictEqual(next.ok, false);
  assert(/content overlap fell/i.test(next.reason), next.reason);
});

/* 2026-11-26: on 21 November TweetFeed began to be read for its IP addresses only (17% of the file). Every later
   copy failed the overlap test against the baseline read the old way, and each refusal held back all 32 feeds. */
check('a source read a new way is re-baselined on bytes, then judged normally', () => {
  const url = 'https://raw.githubusercontent.com/0xDanielLopez/TweetFeed/master/month.csv';
  const names = (prefix, from, count) => Array.from({ length: count }, (_, i) => prefix + (from + i) + '.example');
  const oldReading = api.evaluateListSourceIntegrity(url, null, 'tf-a', 1138229, names('ioc-', 0, 2440), [], seed);
  assert.strictEqual(oldReading.record.entryReader, 'list', 'records carry how they were read');
  const ipsOnly = names('ip-', 0, 1200);
  const sameReader = api.evaluateListSourceIntegrity(url, oldReading.record, 'tf-b', 1001333, ipsOnly, [], seed);
  assert.strictEqual(sameReader.ok, false, 'without the new reader this is exactly the refusal seen in the field');
  const switched = api.evaluateListSourceIntegrity(url, oldReading.record, 'tf-b', 1001333, ipsOnly, [], seed, 0, 'tweetfeed-ip');
  assert.strictEqual(switched.ok, true, switched.reason);
  assert.strictEqual(switched.record.entryReader, 'tweetfeed-ip');
  const shrunk = api.evaluateListSourceIntegrity(url, oldReading.record, 'tf-c', 1200, ipsOnly, [], seed, 0, 'tweetfeed-ip');
  assert.strictEqual(shrunk.ok, false, 'a collapsed file is still refused when the reader changes');
  assert(/byte size dropped/.test(shrunk.reason), shrunk.reason);
  const swapped = api.evaluateListSourceIntegrity(url, switched.record, 'tf-d', 1001333, names('swap-', 0, 1200), [], seed, 0, 'tweetfeed-ip');
  assert.strictEqual(swapped.ok, false, 'once re-baselined, a substituted copy fails the overlap test again');
  const legacy = Object.assign({}, oldReading.record);
  delete legacy.entryReader;
  const unchanged = api.evaluateListSourceIntegrity('https://feed.invalid/list', legacy, 'x-b', 1138229, ipsOnly, [], seed);
  assert.strictEqual(unchanged.ok, false, 'a stored record from before this field still counts as the ordinary reader');
});

/* 2026-11-26: a refusal threw the whole refresh away, so one feed froze all 32 for six days. A refused feed is now
   set aside alone; tools/test-list-refusal-isolation.js runs that end to end. These pin the two halves of it. */
check('a refused feed is set aside before it can give a domain or a baseline, and the refresh goes on', () => {
  const from = BG.indexOf('async function updateRemoteListsCore');
  const to = BG.indexOf('async function updateRemoteLists(reason)', from);
  const body = BG.slice(from, to);
  assert(!/if \(rejectedSources\) \{/.test(body), 'a refusal must not end the whole refresh');
  const refused = body.indexOf('if (!result.ok) {');
  const skip = body.indexOf('continue;', refused);
  assert(refused > 0 && skip > refused && skip < body.indexOf('acceptedIntegrityRecords[result.url] = result.integrityRecord'),
    'a refused copy is skipped before its record could be accepted');
  assert(skip < body.indexOf('merged.add(d)'), 'and before any of its domains could be');
});

check('a refused page list keeps its previous copy while the others update', () => {
  const from = BG.indexOf('async function updateSupplementalLists');
  const to = BG.indexOf('async function attachSupplementalListUpdate', from);
  const body = BG.slice(from, to);
  assert(!/if \(rejectedSources\) \{/.test(body), 'a refusal must not end the whole page list update');
  const refused = body.indexOf('if (!result.ok) {');
  const skip = body.indexOf('continue;', refused);
  assert(refused > 0 && skip > refused && skip < body.indexOf('touchedBuckets[bucket] = true'),
    'a refused list never touches its bucket, so the merge keeps the previous copy');
  assert(/const acceptedRecords = Object\.assign\(\{\}, previousRecords\);/.test(body), 'and its last accepted record stays');
});

check('the popup names a held back feed plainly and counts it apart from unreachable ones', () => {
  const HEALTH = fs.readFileSync(path.join(ROOT, 'popup-health.js'), 'utf8');
  const render = HEALTH.slice(HEALTH.indexOf('function renderListMeta'), HEALTH.indexOf('function renderListMeta') + 4000);
  assert(/held \? held \+ ' held back' : ''/.test(render) && /\(Number\(s\.failed\) \|\| 0\) - held/.test(render));
  assert(/name\.textContent = listFeedName\(f\.url\)/.test(render) && /f\.rejected \? 'Held back:/.test(render));
});

console.log('[ok] list integrity enforcement checks passed (' + passed + ' checks)');

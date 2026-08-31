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

check('an integrity rejection aborts the network-list refresh before DNR replacement', () => {
  const from = BG.indexOf('async function updateRemoteListsCore');
  const to = BG.indexOf('async function updateRemoteLists(reason)', from);
  const body = BG.slice(from, to);
  const quarantine = body.indexOf("if (rejectedSources) {");
  const commit = body.indexOf('commitRemoteListRules');
  assert(quarantine >= 0 && commit > quarantine, 'quarantine must precede the DNR commit');
  assert(/saveListIntegrity\(integrity, \{\}, integrityAlerts/.test(body.slice(quarantine, commit)), 'rejected records must not replace accepted baselines');
});

check('an integrity rejection also preserves the previous supplemental lists', () => {
  const from = BG.indexOf('async function updateSupplementalLists');
  const to = BG.indexOf('async function attachSupplementalListUpdate', from);
  const body = BG.slice(from, to);
  const quarantine = body.indexOf("if (rejectedSources) {");
  const listWrite = body.indexOf("[SUPPLEMENTAL_LIST_STORAGE_KEY]: lists");
  assert(quarantine >= 0 && listWrite > quarantine, 'supplemental quarantine must precede the list write');
  const quarantineBody = body.slice(quarantine, listWrite);
  assert(!quarantineBody.includes('[SUPPLEMENTAL_LIST_STORAGE_KEY]'), 'quarantine may update metadata, never the active lists');
});

console.log('[ok] list integrity enforcement checks passed (' + passed + ' checks)');

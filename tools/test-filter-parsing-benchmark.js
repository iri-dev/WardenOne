/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeParser, sourceSnapshot } = require('./build-cosmetics.js');
const bench = require('./bench-filter-parsing.js');
const background = fs.readFileSync(path.resolve(__dirname, '../background.js'), 'utf8');
const parse = makeParser(background).parseCosmeticFilters;
const plain = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

assert.deepStrictEqual(bench.parseArgs([]), { runs: 3, out: null, cacheDir: null });
for (const args of [['--runs', '0'], ['--runs', '11'], ['--runs', '1.5'], ['--runs', 'NaN'], ['--out'], ['--unknown', 'x'], ['--cache-dir', '--out']]) {
  assert.throws(() => bench.parseArgs(args));
}
const imported = spawnSync(process.execPath, ['-e', 'require("./tools/build-cosmetics.js")'], { encoding: 'utf8' });
assert.strictEqual(imported.status, 0, imported.stderr);
assert.strictEqual(imported.stdout, '', 'importing the compiler must not build, fetch or exit through its CLI');

const accepted = [
  ['##.ad', 'generic'], ['site.example##.ad', 'specific'],
  ['site.example#@#.ad', 'exceptions'], ['@@||site.example^$generichide', 'genericHideExclusions'],
  ['site.example#?#.ad:has-text(sponsor)', 'procedural'],
  ['site.example#$#.ad { display: none; }', 'procedural'],
  ['site.example##+js(acs, key)', 'scriptlets'],
  ['site.example#%#//scriptlet("abort-on-property-read", "key")', 'scriptlets'],
];
for (const [line, bucket] of accepted) assert.strictEqual(bench.countCosmetics(parse(line))[bucket], 1, line);
const rejected = ['##.ad:has-text(sponsor)', 'site.example##+js(unknown-scriptlet, key)',
  'site.example##+js(set-cookie, consent, yes)', 'site.example##+js(set-local-storage-item, key, yes)',
  'site.example#$# log', 'site.example##<script>', '||network.example^$script'];
for (const line of rejected) assert(Object.values(bench.countCosmetics(parse(line))).every((count) => count === 0), line);
const coverage = bench.lineCoverage([{ text: ['! comment', '', ...accepted.map(([line]) => line), ...rejected].join('\n') }], parse);
assert.deepStrictEqual(coverage, { records: accepted.length + rejected.length,
  acceptedStandalone: accepted.length, nonEmittingStandalone: rejected.length });
assert.deepStrictEqual(plain(parse(['##.global\r\nsite.example##.one', 'site.example#@#.one\n'])),
  plain(parse('##.global\r\nsite.example##.one\nsite.example#@#.one\n')));

const network = bench.loadNetworkParser(background);
const rules = plain(network.parseNetworkRules([
  '||ads.example^$script,third-party', '@@||cdn.example^$xhr,domain=site.example|~private.site.example',
  '@@||broad.example^$script', '||unsupported.example^$redirect=noopjs', '||negated.example^$~script',
  '||conflict.example^$first-party,third-party', 'site.example##.ad',
].join('\n'), 100, 20));
assert.deepStrictEqual(rules, [
  { id: 100, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||ads.example^', resourceTypes: ['script'], domainType: 'thirdParty' } },
  { id: 101, priority: 2, action: { type: 'allow' }, condition: { urlFilter: '||cdn.example^', resourceTypes: ['xmlhttprequest'],
    initiatorDomains: ['site.example'], excludedInitiatorDomains: ['private.site.example'] } },
]);
assert.deepStrictEqual(plain(network.parseList('github.io\nco.uk\ntenant.github.io\n0.0.0.0 malicious.example\n||path.example/a^$script')),
  ['tenant.github.io', 'malicious.example']);

const trace = '[1:abc:0] 9 ms: gc=s start_object_size=999 end_object_size=900\n'
  + '[1:abc:0] 12 ms: gc=s start_object_size=500 end_object_size=300\n'
  + '[1:abc:0] 18 ms: gc=mc total_size_before=700 total_size_after=400\n'
  + '[1:abc:0] 22 ms: gc=mc start_object_size=2000 end_object_size=1000\n';
assert.deepStrictEqual(bench.traceMetrics(trace, 10, 20), { tracedGcEvents: 2, gcHeapHighWaterBytes: 700 });
assert.deepStrictEqual(bench.traceMetrics('', 10, 20), { tracedGcEvents: 0, gcHeapHighWaterBytes: 0 });
assert.throws(() => bench.traceMetrics('[1:abc:0] 12 ms: gc=s changed_heap_field=9', 10, 20), /heap counters/);
assert.throws(() => bench.traceMetrics(trace, NaN, 20), /boundaries/);
assert.throws(() => bench.traceMetrics(trace, 20, 10), /boundaries/);

const snapshot = sourceSnapshot();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-parser-'));
const cacheFile = path.join(temporary, crypto.createHash('sha1').update(snapshot.sources[0].url).digest('hex') + '.txt');
try {
  fs.writeFileSync(cacheFile, 'wrong source bytes');
  assert.throws(() => bench.loadCorpus(temporary), /Full source hash mismatch/);
} finally { fs.unlinkSync(cacheFile); fs.rmdirSync(temporary); }
const corpus = bench.loadCorpus(null);
const chunks = corpus.sources.map((source) => source.text);
const parsed = parse(chunks);
const packaged = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../cosmetic-rules.json'), 'utf8'));
assert.strictEqual(hash(parsed.scriptlets), hash(packaged.scriptlets), 'scriptlet source provenance changed');
assert.strictEqual(hash(parsed.procedural), hash(packaged.procedural), 'procedural source provenance changed');
assert.strictEqual(hash(parsed), hash(parse(chunks.join('\n'))), 'recorded source chunks changed parser decisions');
const sample = bench.runSample({ kind: 'cosmetics', joined: false, cacheDir: null });
assert.strictEqual(sample.outputSha256, hash(parsed), 'measured output differs from verified output');
for (const key of ['elapsedMs', 'cpuMs', 'heapBeforeBytes', 'heapAtReturnBytes', 'observedPeakHeapBytes', 'retainedHeapBytes', 'gcEvents', 'gcDurationMs']) {
  assert(Number.isFinite(sample[key]), 'missing measurement: ' + key);
}
assert(sample.observedPeakHeapBytes >= sample.heapBeforeBytes && sample.observedPeakHeapBytes >= sample.heapAtReturnBytes);
console.log('[ok] parser benchmark validates source bytes, command provenance, rule authority, output parity and GC accounting');

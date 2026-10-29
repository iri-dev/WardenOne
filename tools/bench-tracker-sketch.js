/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');
const sketch = require('../tracker-learner-utils.js');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function corpus() {
  return Array.from({ length: 10000 }, (_, i) => [
    'news-' + i + '.example', 'shop-' + (i * 17 + 3) + '.example', 'forum-' + (i * 31 + 7) + '.example',
  ]).concat(Array.from({ length: 10000 }, (_, i) => [
    'tenant-' + i.toString(36) + '.pages.dev', 'customer-' + i.toString(36) + '.github.io', new URL('https://bücher-' + i + '.test').hostname,
  ]));
}
function legacyImplementation(source) {
  const pieces = ['trackerMarkPositions', 'trackerMarkHas', 'trackerMarkAdd'].map(name => {
    const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start);
    if (start < 0 || end < 0) throw new Error('Missing legacy sketch function ' + name);
    return source.slice(start, end + 2);
  });
  return Function(pieces.join('\n') + '\nreturn {positions:trackerMarkPositions,has:trackerMarkHas,add:trackerMarkAdd};')();
}
function collisions(legacy, salt, count = 100) {
  const buckets = new Map(), triples = [];
  for (let i = 0; i < 100000 && triples.length < count; i++) {
    const site = 'chosen-' + i + '.example', key = [...legacy.positions(salt, site)].sort((a, b) => a - b).join(',');
    const bucket = buckets.get(key) || [];
    bucket.push(site); buckets.set(key, bucket);
    if (bucket.length === 3) triples.push(bucket);
  }
  if (triples.length !== count) throw new Error('Collision corpus incomplete');
  return triples;
}
function measure(bits, triples, salts, legacy = sketch) {
  const implementation = bits === 32 ? legacy : sketch;
  let missed = 0, duplicateOvercounts = 0, samples = 0;
  const start = performance.now();
  for (const salt of salts) for (const sites of triples) {
    let marks = bits === 32 ? 0 : undefined, count = 0;
    for (const site of sites) {
      if (!implementation.has(marks, salt, site)) { marks = implementation.add(marks, salt, site); count++; }
      if (!implementation.has(marks, salt, site)) duplicateOvercounts++;
    }
    if (count < 3) missed++;
    samples++;
  }
  return { bits, samples, missed, missedPercent: missed * 100 / samples, duplicateOvercounts,
    elapsedMs: performance.now() - start, candidateMarksBytes: Buffer.byteLength(JSON.stringify(bits === 32 ? 0xffffffff : 'f'.repeat(32))) };
}
function main(baseline, out) {
  if (!baseline || !out) throw new Error('Use <baseline background.js> <output.json>');
  const source = fs.readFileSync(path.resolve(baseline), 'utf8'), legacy = legacyImplementation(source);
  const triples = corpus(), salts = Array.from({ length: 8 }, (_, i) => hash('tracker-sketch-salt-' + i).slice(0, 32));
  for (const sites of triples) for (const site of sites) if (new URL('https://' + site).hostname !== site) throw new Error('Noncanonical corpus hostname');
  if (typeof legacy.add(0, salts[0], triples[0][0]) !== 'number') throw new Error('Expected the pre-migration numeric sketch');
  const report = { createdAt: new Date().toISOString(), workload: 'three unique sites, repeated membership checks; ordinary and structured hostnames',
    corpusSha256: hash(JSON.stringify(triples)), salts, baselineSha256: hash(source), toolSha256: hash(fs.readFileSync(__filename)),
    implementationSha256: hash(fs.readFileSync(path.join(__dirname, '../tracker-learner-utils.js'))),
    node: process.version, cpu: os.cpus()[0].model, platform: os.platform() + ' ' + os.release(), realm: 'same Node realm for both algorithms', runs: [] };
  const attacks = salts.map(salt => ({ salt, triples: collisions(legacy, salt) }));
  report.adversarial = { assumption: 'profile key known; not claimed accessible to a website', corpusSha256: hash(JSON.stringify(attacks)), results: [] };
  for (const bits of [32, 128]) {
    const rows = attacks.map(({ salt, triples: attack }) => measure(bits, attack, [salt], legacy));
    report.adversarial.results.push({ bits, samples: rows.reduce((sum, row) => sum + row.samples, 0), missed: rows.reduce((sum, row) => sum + row.missed, 0) });
  }
  for (let run = 0; run < 5; run++) for (const bits of run % 2 ? [128, 32] : [32, 128]) report.runs.push({ run: run + 1, ...measure(bits, triples, salts, legacy) });
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report.runs.map(({ run, bits, samples, missed, missedPercent, duplicateOvercounts, elapsedMs, candidateMarksBytes }) =>
    ({ run, bits, samples, missed, missedPercent, duplicateOvercounts, elapsedMs: +elapsedMs.toFixed(2), candidateMarksBytes })), null, 2));
}
module.exports = { corpus, measure, legacyImplementation, collisions };
if (require.main === module) main(process.argv[2], process.argv[3]);

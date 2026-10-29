/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), { performance } = require('perf_hooks'), { webcrypto } = require('crypto');
const identifiers = require('../identifier-detector.js');
const root = path.resolve(__dirname, '..'), context = vm.createContext({ URL });
for (const file of ['domain-utils.js', 'psl-private.js', 'cname-utils.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const identity = vm.runInContext('h=>WOCname.normalizeHost(h)?siteIdentity(h):""', context);
async function run() {
  const sample = (count, action) => {
    const start = performance.now(); for (let i = 0; i < count; i++) action(i);
    return { iterations: count, totalMs: performance.now() - start };
  };
  const rejected = sample(20000, i => identifiers.requestValues('https://cdn.example.org/assets/image?v=' + i));
  const candidate = sample(20000, () => identifiers.requestValues('https://metrics.collector.test/collect?novel=z7A4nP9rT2mX8qL5vB1kD6sH3wF0cY9u'));
  let now = Date.now(); const detector = identifiers.create({ siteIdentity: identity, crypto: webcrypto, now: () => now });
  const start = performance.now();
  for (let i = 0; i < 120; i++) await detector.observe({ method: 'GET', type: 'image', topUrl: 'https://first.example/',
    url: 'https://metrics.collector.test/collect?novel=z7A4nP9rT2mX8qL5vB1kD6sH3wF0cY9u' + i });
  const hmac = { iterations: 120, totalMs: performance.now() - start, maxCandidatesPerRequest: identifiers.LIMITS.values,
    stats: detector.stats() };
  now += identifiers.LIMITS.ttlMs;
  const report = { node: process.version, rejected, candidate, hmac, afterExpiry: detector.stats(), limits: identifiers.LIMITS,
    scope: 'Development microbenchmark on this machine; not a browser or Ghostery performance comparison.' };
  const out = process.argv[2]; if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });

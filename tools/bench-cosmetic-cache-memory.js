/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Isolated V8 heap check for retained cosmetic host responses. This is not a browser RAM test.
   Run with node --expose-gc tools/bench-cosmetic-cache-memory.js [commit-sha|working]. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const harness = require('./lib/cosmetic-cache-harness.js');
const { execFileSync } = require('child_process');

if (typeof global.gc !== 'function') throw new Error('run with --expose-gc');
const root = path.resolve(__dirname, '..');
const revision = process.argv[2] || 'working';
if (revision !== 'working' && !/^[a-f0-9]{7,40}$/i.test(revision)) throw new Error('expected a commit SHA or working');
const source = revision !== 'working'
  ? execFileSync('git', ['show', revision + ':background.js'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  : fs.readFileSync(path.join(root, 'background.js'), 'utf8');
function measure(kind) {
  const api = harness.load(source);
  let mem = harness.fixture(api, kind);
  const heap = () => { global.gc(); return process.memoryUsage().heapUsed; };
  const before = heap();
  const samples = [];
  const sample = (label) => samples.push({ label, retainedHeapMiB: Math.round((heap() - before) / 1048576 * 100) / 100, ...harness.stats(api) });
  const fill = (count, tag) => {
    for (let i = 0; i < count; i++) api.compute(tag + '-' + i + '.example.test', mem, false);
  };
  fill(api.cap, 'initial');
  sample('capacity');
  fill(api.cap * 4, 'churn');
  sample('four-capacities-of-new-hosts');
  for (let i = 0; i < 5; i++) {
    api.invalidate();
    mem = harness.fixture(api, kind, 16000, 'replacement-' + i);
    fill(api.cap, 'generation-' + i);
    sample('replacement-' + (i + 1));
  }
  api.invalidate();
  mem = null;
  sample('invalidated-and-released');
  return { kind, cap: api.cap, selectorsPerHost: 16000, samples };
}

console.log(JSON.stringify({ revision, backgroundSha256: crypto.createHash('sha256').update(source).digest('hex'),
  note: 'Isolated Node V8 retention after GC; not browser process memory. Fixture strings are included in replacement deltas.',
  scenarios: ['generic', 'specific', 'exceptions'].map(measure) }));

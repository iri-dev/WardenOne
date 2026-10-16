/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Isolated V8 heap check for retained cosmetic host responses. This is not a browser RAM test.
   Run with node --expose-gc tools/bench-cosmetic-cache-memory.js [commit-sha|working]. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

if (typeof global.gc !== 'function') throw new Error('run with --expose-gc');
const root = path.resolve(__dirname, '..');
const revision = process.argv[2] || 'working';
if (revision !== 'working' && !/^[a-f0-9]{7,40}$/i.test(revision)) throw new Error('expected a commit SHA or working');
const source = revision !== 'working'
  ? execFileSync('git', ['show', revision + ':background.js'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  : fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const start = source.indexOf('function computeCosmeticForHost(');
const end = source.indexOf('// Dynamic rule IDs live', start);
if (start < 0 || end < 0) throw new Error('cosmetic function markers are missing');
const sandbox = {
  __cosmeticHostCache: new Map(),
  __cosmeticGenericSelectors: new WeakMap(),
  __cosmeticGeneration: 0,
  COSMETIC_HOST_CACHE_MAX: 256,
  normalizeAllowlistHost: (value) => String(value || '').toLowerCase(),
  isVideoPlatformHost: () => false,
  isXPlatformHost: () => false,
  hostMatchesCosmeticDomainList: () => false,
  isSafeVideoPlatformCosmeticSelector: () => true,
  scriptletMayRunOnHost: () => true,
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + '\nthis.compute = computeCosmeticForHost;', sandbox);

const selectors = Array.from({ length: 16000 }, (_, i) => '.generic-ad-' + i);
const mem = {
  cfg: { adShield: true, scriptletEngine: true },
  data: { generic: selectors, specific: {}, exceptions: {},
    genericHideExclusions: [], procedural: {}, scriptlets: {} },
};
global.gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 256; i++) sandbox.compute('host-' + i + '.example', mem, false);
global.gc();
const after = process.memoryUsage().heapUsed;
const cached = Array.from(sandbox.__cosmeticHostCache.values());
console.log(JSON.stringify({ revision, hosts: cached.length, selectorsPerHost: selectors.length,
  distinctSelectorArrays: new Set(cached.map((row) => row.selectors)).size,
  retainedHeapMiB: Math.round((after - before) / 1048576 * 100) / 100 }));

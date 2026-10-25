/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert');
const vm = require('vm');

function load(source) {
  const start = source.indexOf('let __cosmeticMem = null;');
  const end = source.indexOf('// Dynamic rule IDs live', start);
  assert(start >= 0 && end > start, 'cosmetic cache source markers are missing');
  const context = {
    normalizeAllowlistHost: (value) => String(value || '').toLowerCase(),
    isVideoPlatformHost: (host) => host === 'youtube.com',
    isXPlatformHost: (host) => host === 'x.com',
    hostMatchesCosmeticDomainList: (host, domains) => domains.some((d) => host === d || host.endsWith('.' + d)),
    isSafeVideoPlatformCosmeticSelector: () => true,
    scriptletMayRunOnHost: () => true,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nthis.api = { compute: computeCosmeticForHost, invalidate: invalidateCosmeticCache,'
    + ' generation: () => __cosmeticGeneration, cache: () => __cosmeticHostCache, cap: COSMETIC_HOST_CACHE_MAX,'
    + ' memo: mem => typeof __cosmeticSelectorMemo === "undefined" ? null : __cosmeticSelectorMemo.get(mem) };', context);
  return context.api;
}

function fixture(api, kind = 'generic', size = 16000, tag = 'initial') {
  const generic = Array.from({ length: size }, (_, i) => '.' + tag + '-ad-' + i);
  return {
    generation: api.generation(), cfg: { adShield: true, scriptletEngine: true },
    data: { generic,
      specific: kind === 'specific' ? { 'example.test': ['.' + tag + '-specific'] } : {},
      exceptions: kind === 'exceptions' ? { 'example.test': [generic[0]] } : {},
      genericHideExclusions: [], procedural: {}, scriptlets: {} },
  };
}

function stats(api) {
  const rows = [...api.cache().values()];
  return { hosts: rows.length, distinctSelectorArrays: new Set(rows.map((row) => row.selectors)).size,
    selectorReferences: rows.reduce((sum, row) => sum + row.selectors.length, 0) };
}

module.exports = { load, fixture, stats };

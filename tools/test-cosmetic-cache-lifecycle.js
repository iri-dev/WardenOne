/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { load, fixture, stats } = require('./lib/cosmetic-cache-harness.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const { argsOf } = require('./browser-cosmetic-memory.js');
assert.strictEqual(argsOf(['--cycles', '3']).cycles, 3);
for (const args of [['--cycles', '0'], ['--cycles', '11'], ['--cycles', '1.5'], ['--extension'], ['toString', 'x']]) assert.throws(() => argsOf(args));

for (const kind of ['generic', 'specific', 'exceptions']) {
  const api = load(source);
  let mem = fixture(api, kind, 100);
  const host = (i) => 'host-' + i + '.example.test';
  for (let i = 0; i < api.cap; i++) api.compute(host(i), mem);
  const first = api.compute(host(0), mem);
  api.compute(host(api.cap), mem);
  assert(api.cache().has(host(0) + '|page'), kind + ': a cache hit refreshes LRU recency');
  assert(!api.cache().has(host(1) + '|page'), kind + ': the oldest unvisited host is evicted');
  for (let i = api.cap + 1; i < api.cap * 8; i++) api.compute(host(i), mem);
  assert.strictEqual(api.cache().size, api.cap, kind + ': long navigation sequences stay bounded');
  assert(!api.cache().has(host(0) + '|page'));
  const reloaded = api.compute(host(0), mem);
  assert.notStrictEqual(reloaded, first, kind + ': an evicted response is recomputed');
  assert.deepStrictEqual([...reloaded.selectors], [...first.selectors], kind + ': eviction retains coverage');
  const current = stats(api);
  assert.strictEqual(current.distinctSelectorArrays, 1,
    kind + ': sharing never drops host-specific selectors or exceptions');
  if (kind === 'specific') assert(reloaded.selectors.includes('.initial-specific'));
  if (kind === 'exceptions') assert(!reloaded.selectors.includes('.initial-ad-0'));

  for (let generation = 0; generation < 8; generation++) {
    const stale = mem;
    api.invalidate();
    assert.strictEqual(api.cache().size, 0, kind + ': invalidation empties every host response');
    api.compute('stale.example.test', stale);
    assert.strictEqual(api.cache().size, 0, kind + ': stale computations cannot repopulate the cache');
    mem = fixture(api, kind, 100, 'new-' + generation);
    const result = api.compute(host(0), mem);
    assert(result.selectors.some((selector) => selector.startsWith('.new-' + generation)));
    assert(!result.selectors.some((selector) => selector.startsWith('.initial-')));
    assert.notStrictEqual(result.selectors, first.selectors, kind + ': replacement cannot reuse an old shared array');
    const player = api.compute(host(0), mem, true);
    assert.strictEqual(player.selectors.length, 0, kind + ': player responses remain separate');
    assert.strictEqual(api.compute(host(0), mem).selectors, result.selectors);
  }
}
{
  const api = load(source);
  const mem = fixture(api, 'specific', 20);
  mem.data.specific['extra.example.test'] = ['.extra-only'];
  mem.data.exceptions['except.example.test'] = ['.initial-ad-0'];
  mem.data.procedural['one.example.test'] = ['.one:remove()'];
  mem.data.scriptlets['one.example.test'] = [{ name: 'json-prune', args: ['one'] }];
  mem.data.genericHideExclusions = ['hidden.example.test'];
  const one = api.compute('one.example.test', mem);
  const two = api.compute('two.example.test', mem);
  assert.notStrictEqual(one, two);
  assert.strictEqual(one.selectors, two.selectors, 'only selector inputs determine selector sharing');
  assert.strictEqual(one.procedural.length, 1);
  assert.strictEqual(two.procedural.length, 0);
  assert.strictEqual(one.scriptlets.length, 1);
  assert.strictEqual(two.scriptlets.length, 0);
  const extra = api.compute('extra.example.test', mem);
  const except = api.compute('except.example.test', mem);
  const hidden = api.compute('hidden.example.test', mem);
  assert.notStrictEqual(extra.selectors, one.selectors);
  assert(extra.selectors.includes('.extra-only'));
  assert.notStrictEqual(except.selectors, one.selectors);
  assert(!except.selectors.includes('.initial-ad-0'));
  assert.deepStrictEqual([...hidden.selectors], ['.initial-specific']);
  const replacement = fixture(api, 'specific', 20, 'replacement');
  assert(api.compute('new.example.test', replacement).selectors.includes('.replacement-specific'), 'list objects cannot share scoped arrays');
  assert.deepStrictEqual([...api.compute('youtube.com', mem).selectors], [], 'video-platform selector handling stays separate');
}
{
  const api = load(source);
  const mem = fixture(api, 'generic', 20010);
  mem.data.exceptions[''] = ['.initial-ad-1'];
  for (let i = 0; i < 300; i++) {
    const parent = 'parent-' + i % 6 + '.example.test';
    mem.data.specific[parent] = ['.parent-' + i % 6];
    mem.data.exceptions[parent] = ['.initial-ad-' + (i % 6 + 3)];
    const host = 'child-' + i + '.' + parent;
    mem.data.specific[host] = ['.unique-' + i];
    const candidates = [host, parent, 'example.test'];
    const expected = new Set(mem.data.generic);
    for (const d of candidates) for (const selector of mem.data.specific[d] || []) expected.add(selector);
    for (const d of [...candidates, '']) for (const selector of mem.data.exceptions[d] || []) expected.delete(selector);
    assert.deepStrictEqual([...api.compute(host, mem).selectors], [...expected].slice(0, 20000),
      'unique selector buckets retain ordering, exceptions and the response cap');
  }
  assert.strictEqual(stats(api).distinctSelectorArrays, api.cap, 'unmatched scopes never share an array');
  assert.strictEqual(api.memo(mem).scopes.size, api.cap, 'the scope index cannot grow past the host cap');
}
{
  const api = load(source);
  const oldList = fixture(api, 'specific', 20, 'old');
  api.compute('first.example.test', oldList);
  api.cache().clear();
  const newList = fixture(api, 'specific', 20, 'new');
  api.compute('first.example.test', newList);
  const result = api.compute('second.example.test', oldList);
  assert(result.selectors.includes('.old-specific'), 'a stale host-key index cannot cross loaded-list ownership');
  assert(!result.selectors.includes('.new-specific'));
}
console.log('[ok] cosmetic LRU bounds, recency, eviction coverage, generation isolation and player separation');

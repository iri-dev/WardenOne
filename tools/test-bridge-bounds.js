/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Regression checks for forgeable MAIN-world event payload bounds. */
'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('bridge.js', 'utf8');
const start = source.indexOf('function boundedBridgeDetail(value)');
const end = source.indexOf('\n\n  function pageTargetOrigin()', start);
if (start < 0 || end <= start) throw new Error('boundedBridgeDetail source markers not found');

const context = { WeakSet, Object, Array, Number, String };
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.boundedBridgeDetail = boundedBridgeDetail;', context);

const huge = { matched: 'x'.repeat(100000), nested: {}, list: [] };
for (let i = 0; i < 100; i++) {
  huge['key-' + i] = 'value-' + i;
  huge.list.push('item-' + i);
}
huge.nested.deep = { secret: 'must not survive depth cap' };
huge.circular = huge;

const out = context.boundedBridgeDetail(huge);
if (!out || typeof out !== 'object') throw new Error('sanitizer did not return an object');
if (out.matched.length !== 600) throw new Error('long diagnostic string was not capped');
if (!Array.isArray(out.list) || out.list.length > 16) throw new Error('array cap failed');
if (Object.keys(out).length > 24) throw new Error('object-key cap failed');
if (out.circular !== undefined) throw new Error('cycle was retained');
if (out.nested && out.nested.deep !== undefined) throw new Error('nested depth cap failed');
if (JSON.stringify(out).length > 8000) throw new Error('sanitized payload remains too large');
if (!source.includes("detail: boundedBridgeDetail(d.detail)")) throw new Error('rg-block relay does not use bounded detail');
if (!source.includes("kind: 'redirect-warning', detail: boundedBridgeDetail(d.detail)")) throw new Error('redirect relay does not use bounded detail');
if (!source.includes("return { kind: 'adshield-cosmetic', hostname, playerPage: msg.playerPage === true }")) {
  throw new Error('adshield relay does not preserve playerPage with strict boolean semantics');
}
if (/playerPage:\s*msg\.playerPage(?!\s*===\s*true)/.test(source)) {
  throw new Error('adshield relay accepts a truthy non-boolean playerPage value');
}

console.log('[ok] bridge event payload bounds passed');

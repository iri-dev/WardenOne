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

console.log('[ok] bridge event payload bounds passed');

/* Structural package metrics and threshold comparison. */
'use strict';
const assert = require('assert');
const { summarizeMetrics, budgetFailures } = require('./check-performance-budget.js');

const files = new Map([
  ['content.js', { size: 10 }],
  ['background.js', { size: 20 }],
  ['background-memory.js', { size: 30 }],
  ['rules.json', { size: 5 }],
]);
const manifest = {
  content_scripts: [{ js: ['content.js'] }, { js: ['content.js'] }],
  declarative_net_request: { rule_resources: [{ path: 'rules.json', enabled: true }] },
};
const metrics = summarizeMetrics(42, files, manifest, () => 3);
assert.deepStrictEqual(metrics, {
  stagedZipBytes: 42, unpackedBytes: 65, staticDnrRules: 3,
  manifestScriptEntries: 2, manifestScriptFiles: 1, manifestScriptBytes: 10,
  workerSourceBytes: 50,
});
assert.deepStrictEqual(budgetFailures(metrics, { stagedZipBytes: 42, staticDnrRules: 3 }), []);
assert.deepStrictEqual(budgetFailures(metrics, { stagedZipBytes: 41 }), ['stagedZipBytes: 42 > 41']);
console.log('Performance budget metric tests passed');

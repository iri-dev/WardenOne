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
const withDisabled = {
  ...manifest,
  declarative_net_request: { rule_resources: [
    { path: 'rules.json', enabled: true }, { path: 'optional.json', enabled: false },
  ] },
};
const optionalMetrics = summarizeMetrics(42, files, withDisabled,
  (name) => name === 'optional.json' ? 28998 : 3);
assert.equal(optionalMetrics.staticDnrRules, 29001);
const reviewedBudget = require('../docs/perf/static-budget.json').maximum;
for (const [count, passes] of [[29000, true], [29001, false]]) {
  assert.equal(budgetFailures({ staticDnrRules: count },
    { staticDnrRules: reviewedBudget.staticDnrRules }).length === 0, passes);
}
assert.deepStrictEqual(budgetFailures(optionalMetrics, { staticDnrRules: reviewedBudget.staticDnrRules }),
  ['staticDnrRules: 29001 > 29000']);
console.log('Performance budget metric tests passed');

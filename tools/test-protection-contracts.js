/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const {generate, output} = require('./audit-protection-contracts.js');
const inventory = generate();
assert.equal(fs.readFileSync(output, 'utf8'), JSON.stringify(inventory, null, 2) + '\n', 'Regenerate protection contracts after changing enforcement sources or settings');
assert.equal(new Set(inventory.protections.map(p => p.key)).size, inventory.protections.length);
for (const p of inventory.protections) {
  assert(p.contract.length > 20 && p.references.some(r => r.file === p.owner), p.key);
  assert.equal(typeof p.default, 'boolean', p.key + ' default must be explicit');
}
for (const name of ['CNAME_RULE_BASE','TRACKER_COOKIE_ALIAS_RULE_BASE','TOTAL_DYNAMIC_BUDGET','TOTAL_SESSION_BUDGET']) assert(inventory.ruleAllocations.constants.some(r => r.name === name), name);
const coverage = JSON.parse(fs.readFileSync('docs/protection-regressions.json'));
assert.deepEqual(coverage.dimensions, ['success','falsePositive','breakageException','disabled','siteOverride','workerRestart','ruleCapacity','upgradeMigration','invalidInput','dataErasure']);
const gate = fs.readFileSync('tools/check-maintainability.js', 'utf8');
for (const feature of coverage.features) {
  assert.deepEqual(Object.keys(feature.dimensions), coverage.dimensions);
  for (const [dimension, cell] of Object.entries(feature.dimensions)) {
    assert(!!cell.tests !== !!cell.notApplicable, feature.feature + ':' + dimension);
    if (cell.notApplicable) { assert(cell.notApplicable.length > 40); continue; }
    assert(cell.tests.length && cell.scope.length > 20);
    for (const test of cell.tests) {
      assert(/^tools\/test-[a-z0-9-]+\.js$/.test(test) && fs.existsSync(test), test);
      assert(gate.includes("['" + test + "']"), test + ' must execute in the gate');
    }
  }
}
console.log('[ok] owner/schema/manifest/rule/log inventory and ten-dimension regression contracts');

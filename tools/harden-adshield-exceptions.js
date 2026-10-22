/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const policy = require('./lib/network-policy.js');
const file = 'rules-adshield.json';
const original = fs.readFileSync(file, 'utf8');
const rules = JSON.parse(original);
let changed = 0;
for (const rule of rules) {
  if ((rule.action.type === 'allow' || rule.action.type === 'allowAllRequests') && rule.priority >= policy.securityMin) {
    rule.priority = 1900;
    changed++;
  }
}
policy.validate({ addRules: rules }, 'static');
if (process.argv.includes('--check')) {
  assert.equal(changed, 0, 'packaged ad exceptions must remain below security rules');
} else if (changed) {
  fs.writeFileSync(file, JSON.stringify(rules));
}
console.log('[ok] packaged ad exceptions preserve security precedence');

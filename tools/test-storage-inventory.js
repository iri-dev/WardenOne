/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const assert = require('assert/strict');
const audit = require('./audit-storage.js');
const actual = audit.generate();
assert.deepEqual(actual.unregistered, [], 'all runtime keys need a registered policy');
assert.equal(new Set(actual.entries.map(entry => entry.key)).size, actual.entries.length);
assert.equal(fs.readFileSync(audit.output, 'utf8'), JSON.stringify(actual, null, 2) + '\n');
for (const entry of actual.entries) for (const field of ['owner', 'sensitivity', 'area', 'retention', 'incognito', 'fullErase'])
  assert(entry[field], entry.key + ' missing ' + field);
assert(actual.entries.find(entry => entry.key === 'wardenone_warning').maxItems === actual.declaredLimits.WARNING_RECORD_MAX.value);
console.log('[ok] per-key storage ownership, retention, limits, erase/private behavior and source census');

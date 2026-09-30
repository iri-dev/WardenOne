/* The release command refuses mixed worktree bytes and writes a standard checksum. */
'use strict';
const assert = require('assert');
const { requireCleanStatus, checksumLine } = require('./check-store-release.js');

assert.doesNotThrow(() => requireCleanStatus(''));
assert.throws(() => requireCleanStatus(' M background.js\n'), /clean checkout/);
assert.throws(() => requireCleanStatus('?? docs/new.md\n'), /clean checkout/);
assert.strictEqual(checksumLine({ zipSha256: 'a'.repeat(64), zipName: 'candidate.zip' }),
  'a'.repeat(64) + '  candidate.zip\n');
console.log('Store release gate: clean commit and checksum required');

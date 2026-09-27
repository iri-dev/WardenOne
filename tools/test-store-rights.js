/* Release rights gate rejects any unreviewed runtime or redistributed input. */
'use strict';
const assert = require('assert');
const { unresolvedRights } = require('./check-store-rights.js');
const approved = { licence: 'MIT', licenceVerified: true };
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', ...approved }],
  generated: [{ file: 'rules.json', ...approved }],
}), []);
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', licence: '', licenceVerified: false }],
  generated: [{ file: 'rules.json', licence: 'MIT', licenceVerified: false }],
}), ['https://example.test/a', 'rules.json']);
console.log('Store rights gate: unresolved inputs block submission');

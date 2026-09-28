/* Release rights gate rejects any unreviewed runtime or redistributed input. */
'use strict';
const assert = require('assert');
const { unresolvedRights } = require('./check-store-rights.js');
const hash = 'a'.repeat(64);
const review = {
  reviewer: 'release owner', reviewedAt: '2026-09-28',
  evidenceUrl: 'https://example.test/terms/commit/123', termsRevision: '123',
  noticeDisposition: 'included', noticeFiles: ['NOTICE'],
};
const approved = { licence: 'Example licence', licenceVerified: true };
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', ...approved,
    rightsReview: { ...review, approvedUse: 'runtime-fetch' } }],
  generated: [{ file: 'rules.json', ...approved,
    rightsReview: { ...review, approvedUse: 'redistribution', artifactSha256: hash } }],
}, () => hash), []);
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', licence: '', licenceVerified: false }],
  generated: [{ file: 'rules.json', licence: 'MIT', licenceVerified: false }],
}), ['https://example.test/a', 'rules.json']);
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', ...approved }],
  generated: [{ file: 'rules.json', ...approved }],
}), ['https://example.test/a', 'rules.json']);
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', ...approved,
    rightsReview: { ...review, approvedUse: 'redistribution' } }],
  generated: [{ file: 'rules.json', ...approved,
    rightsReview: { ...review, approvedUse: 'redistribution', artifactSha256: hash } }],
}, () => 'b'.repeat(64)), ['https://example.test/a', 'rules.json']);
assert.deepStrictEqual(unresolvedRights({
  sources: [{ url: 'https://example.test/a', ...approved,
    rightsReview: { ...review, approvedUse: 'runtime-fetch', noticeDisposition: 'included', noticeFiles: [] } }],
  generated: [{ file: 'rules.json', ...approved,
    rightsReview: { ...review, approvedUse: 'redistribution', artifactSha256: hash } }],
}, () => hash), ['https://example.test/a']);
assert.deepStrictEqual(unresolvedRights({ sources: [], generated: [] }), ['(source inventory missing or empty)']);
console.log('Store rights gate: evidence, use, notice and artifact digest required');

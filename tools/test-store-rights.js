/* Scoped permission and license evidence must survive the release decision. */
'use strict';
const assert = require('assert');
const { unresolvedRights } = require('./check-store-rights.js');
const hash = 'a'.repeat(64);
const source = {
  url: 'https://example.test/feed', name: 'Example', publisher: 'Example authors', checkedAt: '2026-10-19',
  license: { type: 'published-license', id: 'MIT', url: 'https://example.test/LICENSE' },
  permission: { status: 'not-required' }, attribution: 'Example authors',
  evidence: [{ url: 'https://example.test/LICENSE', finding: 'Applicable license for the exact feed.' }],
  compliance: { status: 'implemented', conditions: ['Retain notice.'], implementation: ['Notice included.'], noticeFiles: ['NOTICE'], issueIds: [] },
};
const artifact = { file: 'rules.json', sha256: hash, license: 'MIT', provenance: 'Example', modifications: 'Converted to DNR.', compliance: { status: 'implemented', noticeFiles: ['NOTICE'], issueIds: [] } };
const inv = (entry = source, generated = artifact) => ({ schemaVersion: 2, sources: [entry], buildSources: [], generated: [generated] });
assert.deepStrictEqual(unresolvedRights(inv(), () => hash), []);
const grant = { status: 'granted', date: '2026-10', scope: 'Direct runtime use only.', evidenceRef: 'owner-record', evidence: 'Original retained privately.' };
assert.deepStrictEqual(unresolvedRights(inv({ ...source, license: { type: 'written-permission' }, permission: grant }), () => hash), []);
for (const change of [
  { permission: { status: 'contacted-awaiting-response' }, license: { type: 'usage-terms' } },
  { license: { type: 'written-permission' }, permission: { ...grant, scope: '' } },
  { compliance: { ...source.compliance, issueIds: ['OP-1'] } },
  { compliance: { ...source.compliance, status: 'clarification-required' } },
  { evidence: [] }, { compliance: { ...source.compliance, noticeFiles: [] } },
]) assert.deepStrictEqual(unresolvedRights(inv({ ...source, ...change }), () => hash), [source.url]);
assert.deepStrictEqual(unresolvedRights(inv(), () => 'b'.repeat(64)), ['rules.json']);
assert.deepStrictEqual(unresolvedRights({ ...inv(), buildSources: [{ ...source, url: 'https://example.test/historical', evidence: [] }] }, () => hash), ['https://example.test/historical']);
assert.deepStrictEqual(unresolvedRights({ sources: [], generated: [] }), ['(source inventory missing, empty or obsolete)']);
console.log('Store rights gate: license grants, scoped permission, pending contact, upstream exceptions, notices and artifact integrity checked');

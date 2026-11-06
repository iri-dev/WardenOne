'use strict';
const assert = require('assert');
const { forbiddenPaths, publicContract, check } = require('./check-repository-hygiene.js');

for (const name of ['.vscode/launch.json', '.idea/workspace.xml', '.publish/manifest.json',
  '.workspace-state/session.json', '.env', '.env.local', '.netrc', '.workspace-session.json',
  '.private-review/report.md', 'docs/fresh-audit.md', 'docs/review-evidence.json',
  'docs/renamed-report.md', 'docs/unknown.json', 'DOCS/SOURCE-INVENTORY.JSON',
  'docs\\new-audit.md', 'nested/CWS-SUBMISSION.md', 'nested/MAINTAINABILITY.md',
  'AUDIT-2026-11-05.html', 'nested/THEFT-EVIDENCE.md', 'tools/contracts/private.json',
  'tools/fixtures/browser-evidence.json', 'tools/fixtures/unknown.json']) {
  assert.deepStrictEqual(forbiddenPaths([name]), [name], 'private path accepted: ' + name);
}
/* The repository's own hidden files and directory stay tracked; a dot further down is not local state. */
assert.deepStrictEqual(forbiddenPaths(['README.md', '.github/workflows/gate.yml', '.gitattributes',
  '.gitignore', '.node-version', 'site/.well-known/x.txt', 'tools/audit-storage.js']), []);
assert.deepStrictEqual(forbiddenPaths([
  'docs/store-rights-research.md', 'docs/store-submission.md',
  'docs/perf/profile-current.json', 'docs/perf/profile-current.md',
  'docs/perf/README.md', 'docs/perf/static-budget.json',
  'docs/perf/reconcile-near-limit-2026-09-27.md'
]), [
  'docs/store-rights-research.md', 'docs/store-submission.md',
  'docs/perf/profile-current.json', 'docs/perf/profile-current.md',
  'docs/perf/reconcile-near-limit-2026-09-27.md'
]);
const policy = require('./publication-policy.json');
assert.deepStrictEqual(forbiddenPaths([...policy.publicDocuments, ...policy.publicTestContracts,
  ...policy.publicTestFixtures]), []);
for (const name of ['docs/new-audit.md', '.private-review/report.json', 'tools/contracts/measurement.json']) {
  assert.deepStrictEqual(forbiddenPaths([name, 'manifest.json']), [name]);
}
const digest = { schemaVersion: 1, sha256: 'a'.repeat(64) };
assert(publicContract('tools/contracts/storage-inventory.json', digest));
for (const value of [{ schemaVersion: 1, entries: [{ secret: 'fixture' }] },
  { ...digest, entries: [] }, { ...digest, sha256: 'invalid' }, { ...digest, schemaVersion: 2 }]) {
  assert(!publicContract('tools/contracts/storage-inventory.json', value));
}
const matrix = require('./contracts/protection-regressions.json');
assert(publicContract('tools/contracts/protection-regressions.json', matrix));
assert(!publicContract('tools/contracts/protection-regressions.json', { ...matrix, scope: 'private fixture' }));
check();
console.log('Repository hygiene tests passed');

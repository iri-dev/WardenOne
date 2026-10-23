'use strict';
const assert = require('assert');
const { forbiddenPaths, check } = require('./check-repository-hygiene.js');

assert.deepStrictEqual(forbiddenPaths(['README.md', '.vscode/launch.json', '.idea/workspace.xml', '.publish/manifest.json']),
  ['.vscode/launch.json', '.idea/workspace.xml', '.publish/manifest.json']);
/* The repository's own hidden files and directory stay tracked; a dot further down is not local state. */
assert.deepStrictEqual(forbiddenPaths(['.github/workflows/gate.yml', '.gitattributes', '.node-version', 'site/.well-known/x.txt']), []);
assert.deepStrictEqual(forbiddenPaths([
  'docs/store-rights-research.md', 'docs/store-submission.md',
  'docs/perf/profile-current.json', 'docs/perf/profile-current.md',
  'docs/perf/README.md', 'docs/perf/static-budget.json',
  'docs/perf/reconcile-near-limit-2026-09-27.md'
]), [
  'docs/store-rights-research.md', 'docs/store-submission.md',
  'docs/perf/profile-current.json', 'docs/perf/profile-current.md'
]);
check();
console.log('Repository hygiene tests passed');

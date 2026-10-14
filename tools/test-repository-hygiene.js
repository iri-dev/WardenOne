'use strict';
const assert = require('assert');
const { forbiddenPaths, check } = require('./check-repository-hygiene.js');

assert.deepStrictEqual(forbiddenPaths(['README.md', '.claude/launch.json', '.claude/settings.json']),
  ['.claude/launch.json', '.claude/settings.json']);
assert.deepStrictEqual(forbiddenPaths(['docs/claude.md']), []);
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

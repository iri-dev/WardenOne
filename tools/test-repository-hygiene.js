'use strict';
const assert = require('assert');
const { forbiddenPaths, check } = require('./check-repository-hygiene.js');

assert.deepStrictEqual(forbiddenPaths(['README.md', '.claude/launch.json', '.claude/settings.json']),
  ['.claude/launch.json', '.claude/settings.json']);
assert.deepStrictEqual(forbiddenPaths(['docs/claude.md']), []);
check();
console.log('Repository hygiene tests passed');

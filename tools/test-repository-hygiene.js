'use strict';
const assert = require('assert');
const { forbiddenPaths, check } = require('./check-repository-hygiene.js');

assert.deepStrictEqual(forbiddenPaths(['README.md', '.vscode/launch.json', '.idea/workspace.xml']),
  ['.vscode/launch.json', '.idea/workspace.xml']);
assert.deepStrictEqual(forbiddenPaths(['docs/notes.md']), []);
check();
console.log('Repository hygiene tests passed');

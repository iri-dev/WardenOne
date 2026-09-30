/* Local editor state must never be tracked, regardless of personal ignore rules. */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function forbiddenPaths(paths) {
  return paths.filter((name) => name === '.claude' || name.startsWith('.claude/'));
}

function check() {
  const result = spawnSync('git', ['ls-files', '--cached', '-z'],
    { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot read the staged file inventory');
  const forbidden = forbiddenPaths(result.stdout.split('\0').filter(Boolean));
  if (forbidden.length) throw new Error('Remove local Claude files from the index: ' + forbidden.join(', '));
  console.log('Repository hygiene: no local Claude files staged');
}

module.exports = { forbiddenPaths, check };
if (require.main === module) {
  try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

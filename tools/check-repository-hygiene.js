/* Unknown root dotfiles and hidden directories can contain credentials or private workspace state.
   Only the repository's declared hidden files and directories may be tracked. */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TRACKED_HIDDEN_DIRS = ['.github'];
const TRACKED_HIDDEN_FILES = ['.gitattributes', '.gitignore', '.node-version'];

function localStatePath(name) {
  const top = name.split('/')[0];
  if (!top.startsWith('.')) return false;
  return name.includes('/') ? !TRACKED_HIDDEN_DIRS.includes(top) : !TRACKED_HIDDEN_FILES.includes(top);
}

function forbiddenPaths(paths) {
  return paths.filter((name) => localStatePath(name)
    || name === 'docs/store-rights-research.md' || name === 'docs/store-submission.md'
    || (/^docs\/perf\/[^/]+\.(?:md|json)$/.test(name)
      && !['docs/perf/README.md', 'docs/perf/reconcile-near-limit-2026-09-27.md',
        'docs/perf/static-budget.json'].includes(name)));
}

function check() {
  const result = spawnSync('git', ['ls-files', '--cached', '-z'],
    { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot read the staged file inventory');
  const forbidden = forbiddenPaths(result.stdout.split('\0').filter(Boolean));
  if (forbidden.length) throw new Error('Remove private files from the index: ' + forbidden.join(', '));
  console.log('Repository hygiene: no private files staged');
}

module.exports = { forbiddenPaths, localStatePath, check };
if (require.main === module) {
  try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

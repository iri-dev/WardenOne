/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const { spawnSync } = require('child_process');

function git(cwd, args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error('git ' + args[0] + ' failed: ' + (result.stderr || result.error?.message || '').trim());
  }
  return result;
}

function releaseChanges(previousTag, cwd = process.cwd()) {
  let previous = '';
  if (/^build-[0-9a-f]{40}$/.test(previousTag || '')) {
    const found = git(cwd, ['rev-parse', '-q', '--verify', 'refs/tags/' + previousTag + '^{commit}'], true);
    if (found.status === 0) previous = found.stdout.trim();
  }

  // A rewritten tag can exist locally without belonging to the current history.
  const related = previous && git(cwd, ['merge-base', '--is-ancestor', previous, 'HEAD'], true).status === 0;
  const span = related ? [previous + '..HEAD'] : ['-1', 'HEAD'];
  const log = git(cwd, ['log', '--no-merges', '--format=- %s', ...span]);
  const lines = log.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return '- Repackaged with no code changes\n';
  if (lines.length > 25) return lines.slice(0, 25).join('\n') + '\n- ...and ' + (lines.length - 25) + ' more changes\n';
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  try { process.stdout.write(releaseChanges(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { releaseChanges };

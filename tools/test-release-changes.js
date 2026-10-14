/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { releaseChanges } = require('./release-changes.js');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'gate.yml'), 'utf8');
assert.match(workflow, /node tools\/release-changes\.js "\$PREV_TAG" > changes\.txt/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-release-notes-'));
function git(...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

try {
  git('init', '-b', 'main');
  git('-c', 'user.name=iri', '-c', 'user.email=iri@example.invalid', 'commit', '--allow-empty', '-m', 'Previous build');
  const previous = 'build-' + git('rev-parse', 'HEAD');
  git('tag', previous);
  git('-c', 'user.name=iri', '-c', 'user.email=iri@example.invalid', 'commit', '--allow-empty', '-m', 'New protection');
  assert.strictEqual(releaseChanges(previous, dir), '- New protection\n');

  git('checkout', '--orphan', 'rewritten');
  git('-c', 'user.name=iri', '-c', 'user.email=iri@example.invalid', 'commit', '--allow-empty', '-m', 'Rewritten base');
  git('-c', 'user.name=iri', '-c', 'user.email=iri@example.invalid', 'commit', '--allow-empty', '-m', 'Privacy cleanup');
  assert.strictEqual(releaseChanges(previous, dir), '- Privacy cleanup\n');
  assert.strictEqual(releaseChanges('', dir), '- Privacy cleanup\n');
  console.log('Release change notes tests passed');
} finally {
  if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup path');
  fs.rmSync(dir, { recursive: true, force: true });
}

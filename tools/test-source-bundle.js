'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { zipEntries } = require('./check-package-archive.js');
const { assertClean, parseArgs, buildSourceBundle } = require('./build-source-bundle.js');
const { forbiddenPaths } = require('./check-repository-hygiene.js');

assert.throws(() => assertClean(' M README.md', false), /Local changes would be omitted/);
assert.doesNotThrow(() => assertClean(' M README.md', true));
assert.deepStrictEqual(parseArgs(['--committed', '--output', 'review.zip']),
  { committed: true, output: 'review.zip' });
assert.throws(() => parseArgs(['--unknown']), /Usage:/);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-source-test-'));
const root = path.join(temporary, 'repository');
const output = path.join(temporary, 'source.zip');
const inheritedIndex = process.env.GIT_INDEX_FILE;
delete process.env.GIT_INDEX_FILE;
fs.mkdirSync(root);
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, String(result.stderr || result.error || 'git failed'));
  return result.stdout;
};
try {
  git('init', '-q');
  git('config', 'user.name', 'iri');
  git('config', 'user.email', '294003935+iri-dev@users.noreply.github.com');
  const requiredFiles = ['.gitattributes', '.node-version', 'README.md', 'PRIVACY.md',
    'docs/permissions.md', 'src/content.js', 'tools/check-maintainability.js', 'manifest.json'];
  for (const file of requiredFiles) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file === '.gitattributes' ? 'docs/ export-ignore\nsrc/ export-ignore\n' : 'public fixture\n');
  }
  git('add', '--all');
  git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(temporary, 'hooks'),
    'commit', '-qm', 'Add public source fixture');
  const result = buildSourceBundle({ root, output, committed: true });
  const entries = zipEntries(fs.readFileSync(output));
  for (const required of requiredFiles) {
    assert(entries.includes(required), 'missing tracked source: ' + required);
  }
  assert.deepStrictEqual(forbiddenPaths(entries), [], 'private material reached the bundle');
  assert.strictEqual(result.files, entries.length);
  assert.throws(() => buildSourceBundle({ root, output, committed: true }), /Output already exists/);
  fs.mkdirSync(path.join(root, 'tools/contracts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/contracts/storage-inventory.json'),
    JSON.stringify({ schemaVersion: 1, entries: [{ private: 'fixture' }] }));
  git('add', '--all');
  git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(temporary, 'hooks'),
    'commit', '-qm', 'Add invalid contract fixture');
  assert.throws(() => buildSourceBundle({ root, output: path.join(temporary, 'invalid.zip'), committed: true }),
    /Committed public contract contains a full report/);
  git('rm', '--', 'tools/contracts/storage-inventory.json');
  fs.writeFileSync(path.join(root, 'docs/local-audit.md'), 'private fixture\n');
  git('add', '--all');
  git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(temporary, 'hooks'),
    'commit', '-qm', 'Add private report fixture');
  assert.throws(() => buildSourceBundle({ root, output: path.join(temporary, 'rejected.zip'), committed: true }),
    /Committed private files.*docs\/local-audit\.md/);
} finally {
  if (inheritedIndex === undefined) delete process.env.GIT_INDEX_FILE;
  else process.env.GIT_INDEX_FILE = inheritedIndex;
  if (path.dirname(temporary) !== path.resolve(os.tmpdir())
    || !path.basename(temporary).startsWith('wardenone-source-test-')) throw new Error('Unexpected fixture path');
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('source bundle tests passed');

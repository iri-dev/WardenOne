/* The proposed Store ZIP is tied to one commit and checked byte for byte.
   Run: node tools/test-store-candidate.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { createCandidate, verifyCandidate } = require('./build-store-candidate.js');
const { loadProfile, storeOmitted } = require('./build-store-package.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-candidate-test-'));
try {
  /* The gate runs before a commit. Build a temporary, unreachable commit from the staged tree
     so the candidate under test is exactly what would be committed. No branch or tag moves. */
  const cwd = path.resolve(__dirname, '..');
  const tree = spawnSync('git', ['write-tree'], { cwd, encoding: 'utf8' });
  assert.strictEqual(tree.status, 0, tree.stderr);
  const parent = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  assert.strictEqual(parent.status, 0, parent.stderr);
  const identity = {
    GIT_AUTHOR_NAME: 'iri', GIT_AUTHOR_EMAIL: '294003935+iri-dev@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'iri', GIT_COMMITTER_EMAIL: '294003935+iri-dev@users.noreply.github.com',
  };
  const testObject = spawnSync('git', ['commit-tree', tree.stdout.trim(), '-p', parent.stdout.trim()],
    { cwd, encoding: 'utf8', input: 'Store candidate test\n', env: { ...process.env, ...identity } });
  assert.strictEqual(testObject.status, 0, testObject.stderr);
  const testCommit = testObject.stdout.trim();
  const first = createCandidate(dir, testCommit);
  assert.strictEqual(verifyCandidate(first.jsonPath).record.zipSha256, first.record.zipSha256);
  assert(first.record.files.some((f) => f.name === 'manifest.json'));
  assert(first.record.files.some((f) => f.name === 'PRIVACY.md'), 'Store ZIP carries its reviewed privacy copy');
  assert(!first.record.files.some((f) => f.name === '.gitattributes'));
  assert(!first.record.files.some((f) => f.name.startsWith('tools/')));
  const committedProfile = spawnSync('git', ['show', first.record.commit + ':build-profile.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(committedProfile.status, 0);
  const { build } = loadProfile(committedProfile.stdout);
  const omitted = new Set(storeOmitted(build));
  const names = new Set(first.record.files.map((f) => f.name));
  for (const [id, feature] of Object.entries(build.features)) {
    for (const file of feature.files) assert.strictEqual(names.has(file), !omitted.has(id));
  }
  const second = createCandidate(dir, testCommit);
  assert.strictEqual(second.record.zipSha256, first.record.zipSha256);
  const bytes = fs.readFileSync(first.zipPath);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  fs.writeFileSync(first.zipPath, bytes);
  assert.throws(() => verifyCandidate(first.jsonPath), /digest differs/);
  console.log('Store candidate: reproducible ZIP, inventory and tamper check passed');
} finally {
  const resolved = path.resolve(dir);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
    && path.basename(resolved).startsWith('wardenone-candidate-test-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

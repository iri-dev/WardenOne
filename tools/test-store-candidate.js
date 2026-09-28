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
  const first = createCandidate(dir);
  assert.strictEqual(verifyCandidate(first.jsonPath).record.zipSha256, first.record.zipSha256);
  assert(first.record.files.some((f) => f.name === 'manifest.json'));
  assert(!first.record.files.some((f) => f.name.startsWith('tools/')));
  const committedProfile = spawnSync('git', ['show', first.record.commit + ':build-profile.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(committedProfile.status, 0);
  const { build } = loadProfile(committedProfile.stdout);
  const omitted = new Set(storeOmitted(build));
  const names = new Set(first.record.files.map((f) => f.name));
  for (const [id, feature] of Object.entries(build.features)) {
    for (const file of feature.files) assert.strictEqual(names.has(file), !omitted.has(id));
  }
  const second = createCandidate(dir);
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

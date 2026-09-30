/* One release check for the exact Store ZIP produced from a clean commit. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCandidate, verifyCandidate } = require('./build-store-candidate.js');

const ROOT = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8',
    stdio: options.stdio || 'inherit' });
  if (result.status !== 0) throw new Error(command + ' ' + args.join(' ') + ' failed');
  return result.stdout || '';
}

function requireCleanStatus(status) {
  if (String(status || '').trim()) {
    throw new Error('Commit the intended files first, then run the Store release gate from a clean checkout.');
  }
}

function checksumLine(record) {
  return record.zipSha256 + '  ' + record.zipName + '\n';
}

function checkStoreRelease(outDir = path.join(ROOT, '.store-candidates')) {
  requireCleanStatus(run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { stdio: 'pipe' }));
  run(process.execPath, ['tools/check-maintainability.js']);
  run(process.execPath, ['tools/check-store-rights.js']);
  const candidate = createCandidate(outDir);
  const verified = verifyCandidate(candidate.jsonPath);
  const checksumPath = candidate.zipPath + '.sha256';
  const checksum = checksumLine(verified.record);
  if (fs.existsSync(checksumPath)) {
    if (fs.readFileSync(checksumPath, 'utf8') !== checksum) throw new Error('Existing checksum differs');
  } else fs.writeFileSync(checksumPath, checksum, { flag: 'wx' });
  console.log('Store ZIP ready for upload: ' + candidate.zipPath);
  console.log('SHA-256: ' + verified.record.zipSha256);
  console.log('Inventory: ' + verified.record.files.length + ' files audited against commit ' + verified.record.commit);
  return { ...candidate, checksumPath };
}

module.exports = { requireCleanStatus, checksumLine, checkStoreRelease };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--out-dir' || !args[1])) {
      throw new Error('Usage: node tools/check-store-release.js [--out-dir DIR]');
    }
    checkStoreRelease(args.length ? path.resolve(args[1]) : undefined);
  } catch (error) { console.error('Store release blocked: ' + error.message); process.exitCode = 1; }
}

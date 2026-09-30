/* Build and verify the exact Store ZIP proposed for review (CWS-05).
   node tools/build-store-candidate.js --out-dir .store-candidates
   node tools/build-store-candidate.js --verify .store-candidates/<name>.json */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { buildStoreTree, writeZip } = require('./build-store-package.js');

const ROOT = path.resolve(__dirname, '..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + String(result.stderr || '').slice(0, 300));
  return result.stdout;
}
function zipFiles(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('ZIP bytes required');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      eocd = i; break;
    }
  }
  if (eocd < 0) throw new Error('ZIP footer missing');
  const count = bytes.readUInt16LE(eocd + 10);
  const size = bytes.readUInt32LE(eocd + 12);
  const offset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff || offset + size !== eocd) {
    throw new Error('ZIP directory invalid or ZIP64');
  }
  const files = new Map();
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('ZIP entry invalid');
    const method = bytes.readUInt16LE(at + 10);
    const packedSize = bytes.readUInt32LE(at + 20);
    const plainSize = bytes.readUInt32LE(at + 24);
    const nameSize = bytes.readUInt16LE(at + 28);
    const extraSize = bytes.readUInt16LE(at + 30);
    const commentSize = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const next = at + 46 + nameSize + extraSize + commentSize;
    if (next > eocd) throw new Error('ZIP entry bounds invalid');
    const name = bytes.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    if (!name.endsWith('/')) {
      if (!name || name.startsWith('/') || name.includes('..') || files.has(name)) throw new Error('ZIP path invalid');
      if (localAt + 30 > offset || bytes.readUInt32LE(localAt) !== 0x04034b50) throw new Error('ZIP local header invalid');
      const dataAt = localAt + 30 + bytes.readUInt16LE(localAt + 26) + bytes.readUInt16LE(localAt + 28);
      if (dataAt + packedSize > offset) throw new Error('ZIP data bounds invalid');
      const packed = bytes.subarray(dataAt, dataAt + packedSize);
      const plain = method === 0 ? packed : method === 8 ? zlib.inflateRawSync(packed, { maxOutputLength: plainSize + 1 }) : null;
      if (!plain || plain.length !== plainSize) throw new Error('ZIP content invalid: ' + name);
      files.set(name, { size: plain.length, sha256: sha256(plain) });
    }
    at = next;
  }
  if (at !== eocd) throw new Error('ZIP trailing directory data');
  return files;
}
function manifestFiles(files) {
  return [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, detail]) => ({ name, ...detail }));
}
function expectedFiles(commit) {
  const profileSource = git(['show', commit + ':build-profile.js']).toString('utf8');
  const tree = buildStoreTree({ treeish: commit, profileSource });
  if (tree.dangling.length || tree.stray.length || tree.deadRewind.length) {
    throw new Error('Store source tree has dangling, omitted or replay references');
  }
  const files = new Map();
  for (const entry of tree.kept) {
    const bytes = tree.rewritten.has(entry.path)
      ? Buffer.from(tree.rewritten.get(entry.path), 'utf8')
      : git(['cat-file', 'blob', entry.oid]);
    files.set(entry.path, { size: bytes.length, sha256: sha256(bytes) });
  }
  return { tree, files: manifestFiles(files) };
}
function verifyCandidate(attestationPath) {
  const record = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
  if (record.schema !== 1 || !/^[0-9a-f]{40}$/.test(record.commit)
    || !/^[0-9a-f]{64}$/.test(record.zipSha256) || !Array.isArray(record.files)) {
    throw new Error('Candidate attestation malformed');
  }
  const zipPath = path.join(path.dirname(attestationPath), record.zipName);
  const bytes = fs.readFileSync(zipPath);
  if (sha256(bytes) !== record.zipSha256 || bytes.length !== record.zipBytes) throw new Error('Candidate ZIP digest differs');
  const actual = manifestFiles(zipFiles(bytes));
  if (JSON.stringify(actual) !== JSON.stringify(record.files)) throw new Error('Candidate file inventory differs');
  const expected = expectedFiles(record.commit);
  if (JSON.stringify(actual) !== JSON.stringify(expected.files)) {
    const actualByName = new Map(actual.map((file) => [file.name, file]));
    const expectedByName = new Map(expected.files.map((file) => [file.name, file]));
    const missing = expected.files.filter((file) => !actualByName.has(file.name)).map((file) => file.name);
    const extra = actual.filter((file) => !expectedByName.has(file.name)).map((file) => file.name);
    const changed = expected.files.filter((file) => actualByName.has(file.name)
      && (actualByName.get(file.name).sha256 !== file.sha256 || actualByName.get(file.name).size !== file.size))
      .map((file) => file.name);
    throw new Error('Candidate ZIP differs from its reviewed source tree: missing [' + missing.join(', ')
      + '], extra [' + extra.join(', ') + '], changed [' + changed.slice(0, 5).join(', ') + ']'
      + (changed.length ? ' first ' + JSON.stringify(actualByName.get(changed[0]))
        + ' expected ' + JSON.stringify(expectedByName.get(changed[0])) : ''));
  }
  if (record.version !== expected.tree.manifest.version || record.profile !== 'store') {
    throw new Error('Candidate manifest or build profile differs');
  }
  return { record, zipPath };
}
function createCandidate(outDir, testCommit) {
  const commit = testCommit || git(['rev-parse', 'HEAD']).toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Candidate commit must be a full Git object ID');
  const profileSource = git(['show', commit + ':build-profile.js']).toString('utf8');
  const tree = buildStoreTree({ treeish: commit, profileSource });
  if (tree.dangling.length || tree.stray.length || tree.deadRewind.length) throw new Error('Store tree has dangling, omitted or replay references');
  fs.mkdirSync(outDir, { recursive: true });
  const temp = path.join(os.tmpdir(), 'wardenone-store-candidate-' + process.pid + '.zip');
  try {
    const built = writeZip(tree, temp);
    const bytes = fs.readFileSync(temp);
    const zipSha256 = sha256(bytes);
    const stem = 'WardenOne-store-' + commit.slice(0, 12) + '-' + zipSha256.slice(0, 12);
    const zipName = stem + '.zip';
    const zipPath = path.join(outDir, zipName);
    const jsonPath = path.join(outDir, stem + '.json');
    const record = {
      schema: 1,
      commit,
      tree: built.treeId,
      version: tree.manifest.version,
      profile: 'store',
      zipName,
      zipBytes: bytes.length,
      zipSha256,
      files: manifestFiles(zipFiles(bytes)),
    };
    if (fs.existsSync(zipPath) && sha256(fs.readFileSync(zipPath)) !== zipSha256) throw new Error('Existing candidate ZIP differs');
    if (fs.existsSync(jsonPath) && fs.readFileSync(jsonPath, 'utf8') !== JSON.stringify(record, null, 2) + '\n') {
      throw new Error('Existing candidate attestation differs');
    }
    if (!fs.existsSync(zipPath)) fs.copyFileSync(temp, zipPath, fs.constants.COPYFILE_EXCL);
    if (!fs.existsSync(jsonPath)) fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    verifyCandidate(jsonPath);
    return { record, zipPath, jsonPath };
  } finally { try { fs.unlinkSync(temp); } catch (_) {} }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const verifyAt = args.indexOf('--verify');
    const result = verifyAt >= 0
      ? verifyCandidate(path.resolve(args[verifyAt + 1]))
      : createCandidate(path.resolve(args[args.indexOf('--out-dir') + 1] || path.join(ROOT, '.store-candidates')));
    console.log('Store candidate verified: ' + result.record.commit.slice(0, 12)
      + ', ' + result.record.files.length + ' files, SHA-256 ' + result.record.zipSha256);
    console.log(result.zipPath);
  } catch (error) { console.error('Store candidate failed: ' + error.message); process.exitCode = 1; }
}
module.exports = { zipFiles, createCandidate, verifyCandidate };

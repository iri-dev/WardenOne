/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Verify the actual release ZIP against an explicit reviewed file inventory (REL-02).
   node tools/check-package-archive.js WardenOne-latest.zip
   node tools/check-package-archive.js --staged */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED = require('./package-allowlist.json');

function zipEntries(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('ZIP bytes are required');
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP end-of-central-directory is missing');
  const count = buf.readUInt16LE(end + 10);
  const size = buf.readUInt32LE(end + 12);
  const start = buf.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Error('ZIP64 requires a separate review');
  if (start + size > end) throw new Error('ZIP central-directory bounds are invalid');
  const entries = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || buf.readUInt32LE(at) !== 0x02014b50) throw new Error('ZIP central-directory entry is invalid');
    const flags = buf.readUInt16LE(at + 8);
    if (flags & 1) throw new Error('Encrypted ZIP entry is not allowed');
    const nameSize = buf.readUInt16LE(at + 28);
    const extraSize = buf.readUInt16LE(at + 30);
    const commentSize = buf.readUInt16LE(at + 32);
    const next = at + 46 + nameSize + extraSize + commentSize;
    if (next > end) throw new Error('ZIP entry exceeds central directory');
    const name = buf.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    if (!name.endsWith('/')) entries.push(name);
    at = next;
  }
  if (at !== start + size) throw new Error('ZIP central-directory size disagrees with its entries');
  return entries;
}

function validateEntries(entries, expected = EXPECTED) {
  const problems = [];
  if (new Set(entries).size !== entries.length) problems.push('duplicate archive paths');
  const forbidden = entries.filter((name) =>
    name.split('/').some((part) => part.startsWith('_') || part === '..' || part === '.' || part === '.git')
    || /\.zip$/i.test(name)
    || /(?:^|\/)(?:cws-submission|maintainability)\.md$/i.test(name));
  if (forbidden.length) problems.push('forbidden paths: ' + forbidden.join(', '));
  const wanted = new Set(expected);
  const actual = new Set(entries);
  const extra = [...actual].filter((name) => !wanted.has(name)).sort();
  const missing = [...wanted].filter((name) => !actual.has(name)).sort();
  if (extra.length) problems.push('unexpected files: ' + extra.join(', '));
  if (missing.length) problems.push('missing files: ' + missing.join(', '));
  return problems;
}

function stagedZip() {
  const tree = spawnSync('git', ['write-tree'], { cwd: ROOT, encoding: 'utf8' });
  if (tree.status !== 0) throw new Error('git write-tree failed: ' + String(tree.stderr || '').trim());
  const archive = spawnSync('git', ['archive', '--format=zip', tree.stdout.trim()], {
    cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error('git archive failed: ' + String(archive.stderr || '').trim());
  return archive.stdout;
}

function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('pass a ZIP path or --staged');
  const bytes = arg === '--staged' ? stagedZip() : fs.readFileSync(path.resolve(arg));
  const entries = zipEntries(bytes);
  const problems = validateEntries(entries);
  if (problems.length) throw new Error(problems.join('\n'));
  console.log('release ZIP clean: ' + entries.length + ' reviewed files');
}

module.exports = { zipEntries, validateEntries, stagedZip };
if (require.main === module) {
  try { main(); } catch (e) { console.error('release ZIP rejected: ' + e.message); process.exit(1); }
}

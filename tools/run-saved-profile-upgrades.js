/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readZip, extract } = require('./lib/review-archive.js');

const root = path.resolve(__dirname, '..');
const oldestRef = '42448d1823c0de7c35884c772af9a68012b3ba71';
const publishedRef = '273c43a0051d6c3fe12c6871944ed7e8822d8af3';
const outAt = process.argv.indexOf('--out');
const refAt = process.argv.indexOf('--candidate-ref');
const out = path.resolve(outAt >= 0 ? process.argv[outAt + 1] : path.join(root, 'tmp', 'saved-profile-upgrades'));
const candidateRef = refAt >= 0 ? process.argv[refAt + 1] : 'HEAD';
const relative = path.relative(path.join(root, 'tmp'), out);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Output must be below tmp/');
if (fs.existsSync(out)) throw Error('Choose a new output directory');
fs.mkdirSync(out, { recursive: true });

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw Error(command + ' ' + args.join(' ') + '\n' + result.stdout + result.stderr);
  return result.stdout.trim();
}
function unpack(zip, name) {
  const directory = path.join(out, name);
  extract(readZip(fs.readFileSync(zip)), directory);
  return directory;
}
function full(ref, name) {
  const zip = path.join(out, name + '.zip');
  run('git', ['archive', '--format=zip', '--output=' + zip, ref]);
  return unpack(zip, name);
}
function store(ref, name) {
  const zip = path.join(out, name + '.zip');
  const env = { ...process.env, GIT_INDEX_FILE: path.join(out, name + '.index') };
  run('git', ['read-tree', ref], env);
  run(process.execPath, ['tools/build-store-package.js', '--staged', '--out', zip], env);
  return unpack(zip, name);
}

const oldest = full(oldestRef, 'oldest-full');
const published = full(publishedRef, 'published-full');
const publishedStore = store(publishedRef, 'published-store');
const candidate = full(candidateRef, 'candidate-full');
const candidateStore = store(candidateRef, 'candidate-store');
run(process.execPath, ['tools/check-package-archive.js', path.join(out, 'candidate-full.zip')]);
for (const [lane, before, after] of [['oldest', oldest, candidate], ['published', published, candidate],
  ['store', publishedStore, candidateStore]]) {
  const report = path.join(out, lane + '.json');
  console.log(run(process.execPath, ['tools/browser-saved-profile-upgrade.js', '--old', before,
    '--candidate', after, '--lane', lane, '--out', report]));
}
console.log('Saved-profile upgrade lanes passed: ' + out);

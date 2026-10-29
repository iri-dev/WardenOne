/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'docs/cname-source-snapshot.json.gz');
const OUT = path.join(ROOT, 'cname-trackers.json');
const CNAME_SOURCE_URL = 'https://github.com/AdguardTeam/cname-trackers';
const FILES = ['eulerian', 'etracker', 'webtrekk', 'at-internet-(formerly-xiti)'].map(name => 'data/trackers/' + name + '.json');
const LICENSE_HASH = 'e23d10fa7c575455386707b4a176c82f24bb5e2f';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const licenseHash = text => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');

function helpers() {
  const context = vm.createContext({ URL, console });
  for (const file of ['domain-utils.js', 'psl-private.js', 'cname-utils.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
  return vm.runInContext('({WOCname, siteIdentity})', context);
}

function build(snapshot) {
  if (!snapshot || snapshot.schema !== 1 || !/^[0-9a-f]{40}$/.test(snapshot.revision || '')
      || typeof snapshot.license !== 'string' || licenseHash(snapshot.license) !== LICENSE_HASH
      || snapshot.files?.length !== FILES.length) throw new Error('Invalid source snapshot');
  const rows = [], omitted = [];
  const { WOCname, siteIdentity } = helpers();
  for (let i = 0; i < FILES.length; i++) {
    const file = snapshot.files[i];
    if (file.path !== FILES[i] || sha256(file.text) !== file.sha256) throw new Error('CNAME source hash mismatch');
    const records = JSON.parse(file.text);
    if (!records || Array.isArray(records) || typeof records !== 'object') throw new Error('Invalid source mapping');
    for (const [rawAlias, rawTarget] of Object.entries(records)) {
      const alias = WOCname.normalizeHost(rawAlias), target = WOCname.normalizeHost(rawTarget);
      if (!alias || !target) throw new Error('Malformed source hostname: ' + rawAlias);
      if (alias === siteIdentity(alias)) { omitted.push(alias); continue; }
      rows.push([alias, target]);
    }
  }
  const entries = [...WOCname.validateEntries(rows)];
  const data = { schema: 1, source: 'AdGuard CNAME trackers', revision: snapshot.revision,
    updatedAt: snapshot.updatedAt, license: 'MIT', entries, omittedApexHosts: [...new Set(omitted)].sort() };
  WOCname.validateData(data);
  return data;
}

async function readRemote(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error('CNAME source HTTP ' + response.status);
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > maxBytes) throw new Error('CNAME source size exceeded');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function refresh() {
  const repository = new URL(CNAME_SOURCE_URL).pathname;
  const ref = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/ref/heads/master', 16 * 1024));
  const revision = ref.object?.sha;
  if (!/^[0-9a-f]{40}$/.test(revision || '')) throw new Error('Missing source revision');
  const commit = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/commits/' + revision, 64 * 1024));
  const prefix = 'https://raw.githubusercontent.com' + repository + '/' + revision + '/';
  const license = await readRemote(prefix + 'LICENSE', 4096);
  if (licenseHash(license) !== LICENSE_HASH) throw new Error('Upstream license changed; review before updating');
  const files = [];
  for (const file of FILES) {
    const text = await readRemote(prefix + file, 256 * 1024);
    files.push({ path: file, text, sha256: sha256(text) });
  }
  const snapshot = { schema: 1, revision, updatedAt: commit.committer.date, license, files };
  const output = JSON.stringify(build(snapshot)) + '\n';
  fs.writeFileSync(SNAPSHOT, zlib.gzipSync(JSON.stringify(snapshot), { level: 9 }));
  fs.writeFileSync(OUT, output);
}

async function main(args) {
  if (args.length !== 1 || !['--check', '--build', '--refresh'].includes(args[0])) throw new Error('Use --check, --build or --refresh');
  if (args[0] === '--refresh') await refresh();
  const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(SNAPSHOT), { maxOutputLength: 2 * 1024 * 1024 }));
  const output = JSON.stringify(build(snapshot)) + '\n';
  if (args[0] === '--build') fs.writeFileSync(OUT, output);
  else if (fs.readFileSync(OUT, 'utf8') !== output) throw new Error('CNAME mapping differs from its source snapshot');
  console.log('[ok] CNAME mapping matches its pinned, licensed source');
}
module.exports = { build, helpers, FILES, sha256 };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });

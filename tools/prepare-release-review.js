/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {readZip, extract} = require('./lib/review-archive.js');
const {fingerprint, sha256} = require('./lib/privacy-baseline.js');
const {validateEntries} = require('./check-package-archive.js');
const {forbiddenPaths} = require('./check-repository-hygiene.js');
const root = path.resolve(__dirname, '..');
function compareArchives(source, runtime) {
  const errors = [];
  for (const [name, bytes] of runtime) if (!source.has(name) || !source.get(name).equals(bytes)) errors.push('source/runtime mismatch: ' + name);
  for (const name of ['manifest.json','LICENSE','NOTICE','CREDITS.md','THIRD_PARTY_NOTICES.html']) if (!runtime.has(name)) errors.push('missing release evidence: ' + name);
  for (const name of ['src/content.js','tools/build-content.js','.gitattributes']) if (!source.has(name)) errors.push('missing development source: ' + name);
  const manifest = runtime.has('manifest.json') ? JSON.parse(runtime.get('manifest.json')) : {};
  const rulesets = (manifest.declarative_net_request?.rule_resources || []).map(entry => {
    const bytes = runtime.get(entry.path.replace(/^\//, ''));
    if (!bytes) { errors.push('missing ruleset: ' + entry.path); return entry; }
    const rules = JSON.parse(bytes);
    if (!Array.isArray(rules) || new Set(rules.map(r => r.id)).size !== rules.length) errors.push('invalid/duplicate rule IDs: ' + entry.path);
    return {...entry, count: rules.length, bytes: bytes.length, sha256: sha256(bytes)};
  });
  const forbidden = forbiddenPaths([...source.keys()]);
  errors.push(...forbidden.map(file => 'private source path: ' + file));
  for (const [name, bytes] of source) {
    if (/(?:^|\/)(?:tmp|node_modules|\.publish|\.git|\.codex)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i.test(name)) errors.push('local/credential file: ' + name);
    if (!/\.(?:js|json|md|html|yml|toml|txt)$/.test(name)) continue;
    const text = bytes.toString('utf8');
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35})\b/.test(text)) errors.push('credential-shaped value: ' + name);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) && name !== 'tools/browser-media-security.js') errors.push('private key: ' + name);
  }
  return {errors, rulesets, sourceFiles: source.size, runtimeFiles: runtime.size, runtimeBytes: [...runtime.values()].reduce((n, b) => n + b.length, 0),
    licensing: [...runtime].filter(([name]) => name.startsWith('licenses/') || ['LICENSE','NOTICE','CREDITS.md','THIRD_PARTY_NOTICES.html'].includes(name)).map(([name, bytes]) => ({name, sha256:sha256(bytes)})),
    secretScan: 'Hidden/local/credential paths, selected credential token formats and private-key headers. Public throwaway loopback TLS key permitted only in tools/browser-media-security.js. This is a bounded scan, not proof that arbitrary secrets cannot exist.'};
}
function prepare({out, browser, privacyBadger, crx}) {
  out = path.resolve(out);
  if (fs.existsSync(out)) throw Error('Choose a new immutable review directory');
  const relative = path.relative(path.join(root, 'tmp'), out);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Review snapshots must be below gitignored tmp/');
  const git = (args, env = process.env) => {
    const result = spawnSync('git', args, {cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
    if (result.status !== 0) throw Error('git ' + args[0] + ': ' + result.stderr);
    return result.stdout.trim();
  };
  fs.mkdirSync(out, {recursive: true});
  const env = {...process.env, GIT_INDEX_FILE: path.join(out, 'candidate.index')};
  git(['read-tree', 'HEAD'], env); git(['add', '-A', '--', '.'], env);
  const tree = git(['write-tree'], env), head = git(['rev-parse', 'HEAD']);
  const bare = path.join(out, 'source-repo.git'); git(['init', '--bare', bare]);
  fs.writeFileSync(path.join(bare, 'objects/info/alternates'), path.resolve(root, git(['rev-parse','--git-path','objects'])).replace(/\\/g, '/') + '\n');
  fs.writeFileSync(path.join(bare, 'info/attributes'), '* -export-ignore\n');
  const builds = [];
  for (const [label, revision, kind] of [['committed',head,'commit'],['candidate',tree,'uncommitted-tree']]) {
    const archive = path.join(out, label + '-runtime.zip'), sourceArchive = path.join(out, label + '-source.zip');
    git(['archive','--format=zip','--output=' + archive,revision]);
    git(['--git-dir=' + bare,'archive','--format=zip','--output=' + sourceArchive,revision]);
    const runtime = readZip(fs.readFileSync(archive)), source = readZip(fs.readFileSync(sourceArchive));
    const review = compareArchives(source, runtime);
    if (label === 'candidate') review.errors.push(...validateEntries([...runtime.keys()]));
    if (review.errors.length) throw Error(review.errors.join('\n'));
    const directory = path.join(out, label), sourceDirectory = path.join(out, label + '-source');
    extract(runtime, directory); extract(source, sourceDirectory);
    const generated = [];
    for (const args of [['tools/build-content.js','--check'],['tools/build-settings-data.js','--check']]) {
      const result = spawnSync(process.execPath, args, {cwd: sourceDirectory, encoding:'utf8'});
      if (result.status !== 0) throw Error(label + ' generated provenance: ' + result.stderr + result.stdout);
      generated.push({command: args.join(' '), result: 'pass'});
    }
    const manifest = JSON.parse(runtime.get('manifest.json')), identity = fingerprint(directory);
    fs.writeFileSync(path.join(out, label + '-files.json'), JSON.stringify(identity,null,2) + '\n');
    builds.push({label, product:'wardenone', revisionKind:kind, revision, baseCommit:head, directory, archive, sourceArchive,
      archiveSha256:sha256(fs.readFileSync(archive)), sourceArchiveSha256:sha256(fs.readFileSync(sourceArchive)),
      version:manifest.version, manifestVersion:manifest.manifest_version, fingerprint:identity.sha256, review:{...review, generated}});
  }
  const identity = fingerprint(privacyBadger), manifest = JSON.parse(fs.readFileSync(path.join(privacyBadger,'manifest.json')));
  builds.push({label:'privacybadger',product:'privacybadger',directory:path.resolve(privacyBadger),version:manifest.version,manifestVersion:manifest.manifest_version,
    fingerprint:identity.sha256,archiveSha256:sha256(fs.readFileSync(crx)),fileCount:identity.files.length});
  const referenceFile = path.join(root,'tmp/privacy-baseline-2026-10-26/snapshots.json');
  if (fs.existsSync(referenceFile)) builds.push({...JSON.parse(fs.readFileSync(referenceFile)).builds.find(b=>b.label==='reference')});
  const snapshots = {createdAt:new Date().toISOString(),browserPath:path.resolve(browser),browserSha256:sha256(fs.readFileSync(browser)),builds};
  fs.writeFileSync(path.join(out,'snapshots.json'),JSON.stringify(snapshots,null,2)+'\n');
  return snapshots;
}
module.exports = {compareArchives, prepare};
if (require.main === module) {
  try {
    const [out,browser,privacyBadger,crx] = process.argv.slice(2);
    if (!out || !browser || !privacyBadger || !crx) throw Error('Usage: prepare-release-review.js tmp/new-review browser.exe privacybadger-directory official.crx');
    const result=prepare({out,browser,privacyBadger,crx}); console.log(JSON.stringify(result.builds.map(({label,revision,fingerprint,review})=>({label,revision,fingerprint,review})),null,2));
  } catch(error) {console.error(error.stack||error);process.exitCode=1;}
}

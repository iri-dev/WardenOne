/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fingerprint, sha256 } = require('./lib/privacy-baseline.js');
const ROOT = path.resolve(__dirname, '..');

function parseArgs(args) {
  const options = {};
  const flags = new Map([['--out', 'out'], ['--reference', 'reference'], ['--privacy-badger', 'privacyBadger'], ['--browser', 'browser']]);
  for (let i = 0; i < args.length; i += 2) {
    const key = flags.get(args[i]), value = args[i + 1];
    if (!key || !value || value.startsWith('--')) throw new Error('expected --out directory --reference commit --privacy-badger archive.zip --browser executable');
    options[key] = key === 'reference' ? value : path.resolve(value);
  }
  if (flags.size !== Object.keys(options).length || !/^[a-f0-9]{7,40}$/i.test(options.reference || '')) throw new Error('All four options and an immutable reference SHA are required');
  return options;
}

function git(args, env = process.env, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw new Error('git ' + args[0] + ': ' + (result.error || result.stderr));
  return allowFailure ? result.status : result.stdout.trim();
}

function extract(archive, directory) {
  if (fs.existsSync(directory)) throw new Error('Preserve the existing snapshot: ' + directory);
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $snapshotTarget = [System.IO.Path]::GetFullPath($env:WARDEN_BASELINE_DEST)
    $snapshotArchive = [System.IO.Compression.ZipFile]::OpenRead($env:WARDEN_BASELINE_ZIP)
    try {
      $snapshotTotal = 0L
      foreach ($snapshotEntry in $snapshotArchive.Entries) {
        $snapshotTotal += $snapshotEntry.Length
        if ($snapshotTotal -gt 134217728) { throw 'Archive exceeds the baseline extraction limit' }
        $snapshotEntryPath = [System.IO.Path]::GetFullPath((Join-Path $snapshotTarget $snapshotEntry.FullName))
        if (-not $snapshotEntryPath.StartsWith($snapshotTarget + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
          throw 'Archive entry leaves the snapshot directory'
        }
      }
      [System.IO.Compression.ZipFileExtensions]::ExtractToDirectory($snapshotArchive, $snapshotTarget)
    } finally { $snapshotArchive.Dispose() }
  `;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', env: { ...process.env, WARDEN_BASELINE_ZIP: archive, WARDEN_BASELINE_DEST: directory },
  });
  if (result.status !== 0) throw new Error('Snapshot extraction failed: ' + (result.error || result.stderr));
}

function prepare(options) {
  if (fs.existsSync(options.out)) throw new Error('Choose a new output directory; existing snapshots are immutable');
  const relative = path.relative(ROOT, options.out);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)
      && git(['check-ignore', '--quiet', '--', path.join(options.out, 'snapshot-marker')], process.env, true) !== 0) {
    throw new Error('Use a gitignored output directory such as tmp/privacy-baseline');
  }
  fs.accessSync(options.privacyBadger, fs.constants.R_OK);
  fs.accessSync(options.browser, fs.constants.R_OK);
  const reference = git(['rev-parse', '--verify', options.reference + '^{commit}']);
  fs.mkdirSync(options.out, { recursive: true });
  const referenceZip = path.join(options.out, 'reference.zip'), candidateZip = path.join(options.out, 'candidate.zip');
  git(['archive', '--format=zip', '--output=' + referenceZip, reference]);
  const env = { ...process.env, GIT_INDEX_FILE: path.join(options.out, 'candidate.index') };
  git(['read-tree', 'HEAD'], env);
  git(['add', '-A', '--', '.'], env);
  const tree = git(['write-tree'], env);
  git(['archive', '--format=zip', '--output=' + candidateZip, tree], env);
  const referenceDir = path.join(options.out, 'reference'), candidateDir = path.join(options.out, 'candidate'), competitorDir = path.join(options.out, 'privacybadger');
  extract(referenceZip, referenceDir);
  extract(candidateZip, candidateDir);
  extract(options.privacyBadger, competitorDir);
  const sourceRoots = [];
  if (fs.existsSync(path.join(competitorDir, 'manifest.json'))) sourceRoots.push(competitorDir);
  for (const entry of fs.readdirSync(competitorDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(competitorDir, entry.name, 'src/manifest.json'))) {
      sourceRoots.push(path.join(competitorDir, entry.name, 'src'));
    }
  }
  if (sourceRoots.length !== 1) throw new Error('Cannot identify one competitor extension root');
  const builds = [
    { label: 'reference', product: 'wardenone', commit: reference, directory: referenceDir, archive: referenceZip },
    { label: 'candidate', product: 'wardenone', baseCommit: git(['rev-parse', 'HEAD']), tree, directory: candidateDir, archive: candidateZip },
    { label: 'privacybadger', product: 'privacybadger', directory: sourceRoots[0], archive: options.privacyBadger },
  ];
  for (const build of builds) {
    const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json')));
    const identity = fingerprint(build.directory);
    Object.assign(build, { version: manifest.version, manifestVersion: manifest.manifest_version,
      fingerprint: identity.sha256, fileCount: identity.files.length, archiveSha256: sha256(fs.readFileSync(build.archive)) });
    fs.writeFileSync(path.join(options.out, build.label + '-files.json'), JSON.stringify(identity, null, 2));
  }
  const snapshots = { createdAt: new Date().toISOString(), browserPath: options.browser,
    browserSha256: sha256(fs.readFileSync(options.browser)), builds };
  fs.writeFileSync(path.join(options.out, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
  return snapshots;
}

module.exports = { parseArgs, prepare };
if (require.main === module) {
  try { const result = prepare(parseArgs(process.argv.slice(2))); console.log(JSON.stringify(result, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

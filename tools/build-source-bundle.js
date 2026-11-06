/* A review ZIP of one committed source tree, including files excluded from release ZIPs. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { zipEntries } = require('./check-package-archive.js');
const { forbiddenPaths, publicContract } = require('./check-repository-hygiene.js');

const ROOT = path.resolve(__dirname, '..');

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error('git ' + args[0] + ' failed: ' + String(result.stderr || '').trim());
  return result.stdout;
}

function assertClean(status, committed) {
  if (status.trim() && !committed) {
    throw new Error('Local changes would be omitted. Commit them first, or use --committed to bundle HEAD explicitly.');
  }
}

function parseArgs(args) {
  const options = { committed: false, output: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--committed') options.committed = true;
    else if (args[i] === '--output' && args[i + 1]) options.output = args[++i];
    else throw new Error('Usage: node tools/build-source-bundle.js [--output FILE.zip] [--committed]');
  }
  return options;
}

function buildSourceBundle(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const sourceGit = (args, settings = {}) => git(args, { cwd: root, ...settings });
  const status = sourceGit(['status', '--porcelain=v1', '--untracked-files=all']);
  assertClean(status, options.committed === true);
  const commit = sourceGit(['rev-parse', 'HEAD']).trim();
  const tracked = sourceGit(['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean).sort();
  const local = forbiddenPaths(tracked);
  if (local.length) throw new Error('Committed private files must be removed before bundling: ' + local.join(', '));
  for (const file of tracked.filter(name => name.startsWith('tools/contracts/'))) {
    let valid = false;
    try { valid = publicContract(file, JSON.parse(sourceGit(['show', commit + ':' + file]))); } catch (_) {}
    if (!valid) throw new Error('Committed public contract contains a full report or invalid data: ' + file);
  }

  const output = path.resolve(options.output || path.join(path.dirname(root), 'WardenOne-source-' + commit.slice(0, 12) + '.zip'));
  const relative = path.relative(root, output);
  if (relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('Write the source bundle outside the repository');
  }
  if (!output.toLowerCase().endsWith('.zip')) throw new Error('Source bundle output must end in .zip');
  if (!fs.existsSync(path.dirname(output))) throw new Error('Output directory does not exist');
  if (fs.existsSync(output)) throw new Error('Output already exists: ' + output);

  const temporaryRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-source-repo-'));
  const temporaryOutput = output + '.' + process.pid + '.tmp';
  try {
    sourceGit(['init', '--bare', temporaryRepo]);
    const objects = path.resolve(root, sourceGit(['rev-parse', '--git-path', 'objects']).trim());
    fs.writeFileSync(path.join(temporaryRepo, 'objects', 'info', 'alternates'), objects.replace(/\\/g, '/') + '\n');
    fs.writeFileSync(path.join(temporaryRepo, 'info', 'attributes'), '* -export-ignore\n');
    sourceGit(['--git-dir=' + temporaryRepo, 'archive', '--format=zip', '--output=' + temporaryOutput, commit]);
    const actual = zipEntries(fs.readFileSync(temporaryOutput)).sort();
    if (actual.length !== tracked.length || actual.some((name, index) => name !== tracked[index])) {
      const found = new Set(actual);
      const expected = new Set(tracked);
      const missing = tracked.filter((name) => !found.has(name)).slice(0, 8);
      const extra = actual.filter((name) => !expected.has(name)).slice(0, 8);
      throw new Error('Source ZIP differs from the committed file inventory (' + actual.length + '/' + tracked.length
        + ' files; missing: ' + missing.join(', ') + '; extra: ' + extra.join(', ') + ')');
    }
    fs.renameSync(temporaryOutput, output);
    return { output, commit, files: actual.length, omittedLocalChanges: !!status.trim() };
  } finally {
    if (fs.existsSync(temporaryOutput)) fs.unlinkSync(temporaryOutput);
    if (path.dirname(temporaryRepo) !== path.resolve(os.tmpdir())
      || !path.basename(temporaryRepo).startsWith('wardenone-source-repo-')) {
      throw new Error('Refusing to remove an unexpected temporary repository path');
    }
    fs.rmSync(temporaryRepo, { recursive: true, force: true });
  }
}

module.exports = { assertClean, parseArgs, buildSourceBundle };
if (require.main === module) {
  try {
    const result = buildSourceBundle(parseArgs(process.argv.slice(2)));
    console.log('Source bundle: ' + result.output);
    console.log('Commit: ' + result.commit + ' (' + result.files + ' tracked files)');
    if (result.omittedLocalChanges) console.log('Local changes were omitted by --committed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

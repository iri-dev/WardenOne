/* The GitHub ZIP carries its source commit without changing the manifest version. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const profile = fs.readFileSync(path.join(root, 'build-profile.js'), 'utf8');
const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
assert(/^build-profile\.js export-subst$/m.test(attributes));
assert(profile.includes("const WARDENONE_SOURCE_COMMIT = '$Format:%H$';"));

function sourceCommit(source) {
  const context = {};
  vm.runInNewContext(source + '\nthis.commit = woSourceCommit();', context);
  return context.commit;
}
assert.equal(sourceCommit(profile), '', 'an unpacked source tree has no GitHub build ID');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-build-identity-'));
let archiveCommit = '';
function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: dir, encoding, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return result.stdout;
}
function zipFile(bytes, wanted) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  }
  assert(end >= 0, 'git archive ZIP has a central directory');
  let at = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const nameSize = bytes.readUInt16LE(at + 28);
    const extraSize = bytes.readUInt16LE(at + 30);
    const commentSize = bytes.readUInt16LE(at + 32);
    const name = bytes.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    if (name === wanted) {
      const local = bytes.readUInt32LE(at + 42);
      assert.equal(bytes.readUInt32LE(local), 0x04034b50);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(start, start + bytes.readUInt32LE(at + 20));
      const method = bytes.readUInt16LE(at + 10);
      assert(method === 0 || method === 8, 'supported ZIP compression');
      return (method === 8 ? zlib.inflateRawSync(compressed) : compressed).toString('utf8');
    }
    at += 46 + nameSize + extraSize + commentSize;
  }
  throw new Error(wanted + ' missing from git archive');
}
try {
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'build-profile.js export-subst\n');
  fs.writeFileSync(path.join(dir, 'build-profile.js'), profile);
  git(['init', '-q']);
  git(['add', '.gitattributes', 'build-profile.js']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', 'test archive substitution']);
  const commit = git(['rev-parse', 'HEAD']).trim();
  archiveCommit = commit;
  const archive = git(['archive', '--format=zip', 'HEAD', 'build-profile.js'], 'buffer');
  assert.equal(sourceCommit(zipFile(archive, 'build-profile.js')), commit,
    'the packaged script must name the exact commit that git archive exported');
} finally {
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('wo-build-identity-')) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const settings = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const diagnostics = fs.readFileSync(path.join(root, 'popup-diagnostics.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const aboutStart = settings.indexOf('function aboutPage() {');
const aboutEnd = settings.indexOf('\n/* Beside a category', aboutStart);
assert(aboutStart > 0 && aboutEnd > aboutStart);
const aboutSource = settings.slice(aboutStart, aboutEnd);
function aboutHtml(commit) {
  const context = {
    woSourceCommit: () => commit, extensionVersion: () => '1.0.2',
    esc: String, PROJECT_LINKS: { maker: 'https://example.test' }, infoLink: () => '',
  };
  vm.runInNewContext(aboutSource + '\nthis.html = aboutPage();', context);
  return context.html;
}
assert(aboutHtml(archiveCommit).includes('Version 1.0.2 · Build ' + archiveCommit.slice(0, 7)));
assert(aboutHtml('').includes('Version 1.0.2</p>'), 'unidentified local copies show only the version');
assert(diagnostics.includes("build: typeof woSourceCommit === 'function' ? woSourceCommit() : ''"));
assert(background.includes("build: typeof woSourceCommit === 'function' ? woSourceCommit() : ''"));
console.log('[ok] archived build identity reaches About, diagnostics and Verify & Repair');

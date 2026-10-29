/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const baseline = require('./lib/privacy-baseline.js');
const snapshots = require('./prepare-privacy-baseline.js');

const options = baseline.parseArgs(['--snapshots', 'snapshots.json', '--out', 'report.json', '--runs', '5', '--builds', 'off,reference,candidate']);
assert.strictEqual(options.runs, 5);
assert.deepStrictEqual(options.builds, ['off', 'reference', 'candidate']);
assert.strictEqual(options.snapshots, path.resolve('snapshots.json'));
for (const args of [[], ['--runs', '0'], ['--runs', '11'], ['--runs', 'NaN'], ['--unknown', 'x'], ['--out'], ['--out', '--snapshots']]) {
  assert.throws(() => baseline.parseArgs(args));
}
const snapshotArgs = ['--out', 'tmp/baseline', '--reference', '123abcd', '--privacy-badger', 'source.zip', '--browser', 'chrome.exe'];
assert.strictEqual(snapshots.parseArgs(snapshotArgs).reference, '123abcd');
assert.strictEqual(snapshots.parseArgs(snapshotArgs).out, path.resolve('tmp/baseline'));
assert.throws(() => snapshots.parseArgs(snapshotArgs.map(value => value === '123abcd' ? 'main' : value)), /immutable reference SHA/);
assert.throws(() => snapshots.parseArgs(snapshotArgs.slice(0, -2)), /All four options/);
for (const [input, expected] of [
  [{ received: false }, 'error'],
  [{ received: false, blockedEvidence: true }, 'blocked'],
  [{ received: false, blockedEvidence: true, error: 'bad observation' }, 'error'],
  [{ received: true }, 'allowed'],
  [{ received: true, detected: true }, 'detected-but-not-blocked'],
  [{ received: true, unsupported: true }, 'unsupported'],
  [{ received: true, cookieBefore: true, cookieAtServer: false }, 'stripped'],
  [{ received: true, cookieStoredAfter: false }, 'stripped'],
  [{ received: true, cookieBefore: true, cookieAtServer: true, cookieStoredAfter: true }, 'allowed'],
]) assert.strictEqual(baseline.requestStatus(input), expected);
const summary = baseline.summarize([{ build: 'off', scenarios: [
  { name: 'fixture', profile: 'default', status: 'allowed', latencyMs: 10, extensionHeapBytes: null },
  { name: 'fixture', profile: 'default', status: 'allowed', latencyMs: 20, extensionHeapBytes: null },
] }]);
assert.strictEqual(summary[0].n, 2);
assert.strictEqual(summary[0].latencyMs.median, 15);
assert.strictEqual(summary[0].extensionHeapBytes.n, 0, 'unavailable heap cannot become a zero-byte sample');
assert.throws(() => baseline.summarize([{ build: 'fixture', scenarios: [{ status: 'protected' }] }]), /Unknown result status/);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-baseline-identity-'));
try {
  fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify({ version: '1.2.3', manifest_version: 3 }));
  fs.writeFileSync(path.join(temporary, 'worker.js'), 'source');
  const identity = baseline.fingerprint(temporary);
  const build = { label: 'fixture', directory: temporary, fingerprint: identity.sha256, version: '1.2.3', manifestVersion: 3 };
  baseline.verifyBuild(build);
  fs.mkdirSync(path.join(temporary, '_metadata'));
  fs.writeFileSync(path.join(temporary, '_metadata', 'generated'), 'browser output');
  assert.strictEqual(baseline.fingerprint(temporary).sha256, identity.sha256);
  fs.writeFileSync(path.join(temporary, 'worker.js'), 'changed source');
  assert.throws(() => baseline.verifyBuild(build), /Snapshot changed/);
} finally {
  fs.unlinkSync(path.join(temporary, '_metadata', 'generated'));
  fs.rmdirSync(path.join(temporary, '_metadata'));
  fs.unlinkSync(path.join(temporary, 'manifest.json'));
  fs.unlinkSync(path.join(temporary, 'worker.js'));
  fs.rmdirSync(temporary);
}
const imported = spawnSync(process.execPath, ['-e', 'require("./tools/browser-media-security.js");require("./tools/browser-privacy-baseline.js");require("./tools/prepare-privacy-baseline.js")'], { encoding: 'utf8' });
assert.strictEqual(imported.status, 0, imported.stderr);
assert.strictEqual(imported.stdout, '', 'importing fixture helpers cannot launch browsers');
console.log('[ok] privacy baseline refuses ambiguous blocking, preserves unavailable metrics and verifies immutable source identities');

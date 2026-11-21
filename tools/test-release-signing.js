#!/usr/bin/env node
'use strict';

/* Owner signatures for release ZIPs: keys stay outside the repository, a ZIP is signed only after its published
   checksum matches, tampering and wrong keys fail, and no workflow ever sees the private key. */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tool = require('./release-signing.js');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const throwsWith = (fn, re, msg) => { let e = null; try { fn(); } catch (err) { e = err; } ok(e && re.test(String(e.message)), msg + (e ? ' (' + e.message + ')' : ' (did not throw)')); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-release-sign-'));
try {
  /* 1. Keys are made outside the repository only. */
  throwsWith(() => tool.keygen(path.join(ROOT, 'docs', 'keys')), /inside the repository/, 'no private key inside the repository');
  throwsWith(() => tool.keygen(), /--out/, 'keygen needs a folder');
  const made = tool.keygen(path.join(tmp, 'keys'));
  ok(fs.existsSync(made.privatePath) && /BEGIN PUBLIC KEY/.test(made.publicPem), 'a key pair is written');
  throwsWith(() => tool.keygen(path.join(tmp, 'keys')), /already exists/, 'an existing key is never overwritten');

  /* 2. Signing and checking, with the published key not committed yet. */
  const zip = path.join(tmp, 'WardenOne-latest.zip');
  fs.writeFileSync(zip, crypto.randomBytes(4096));
  const pub = path.join(tmp, 'keys', 'release-signing-key.pem');
  const committed = fs.existsSync(tool.PUBLIC_KEY_PATH);
  if (!committed) {
    const sig = tool.sign(zip, made.privatePath);
    ok(fs.readFileSync(sig, 'utf8').trim().length === 88, 'a 64 byte signature in base64');
    ok(tool.verify(zip, sig, pub), 'the signature checks with the matching public key');
    fs.appendFileSync(zip, Buffer.from([1]));
    throwsWith(() => tool.verify(zip, sig, pub), /does not match/, 'a changed ZIP fails');
    const other = tool.keygen(path.join(tmp, 'other'));
    fs.writeFileSync(zip, crypto.randomBytes(4096));
    tool.sign(zip, other.privatePath);
    throwsWith(() => tool.verify(zip, sig, pub), /does not match/, 'another key\'s signature fails');
    fs.writeFileSync(sig, 'bm90IGEgc2lnbmF0dXJl\n');
    throwsWith(() => tool.verify(zip, sig, pub), /does not match/, 'a malformed signature fails');
    throwsWith(() => tool.verify(zip, undefined), /no published release key/, 'without a published key nothing is claimed');
  }
  throwsWith(() => tool.sign(zip, path.join(ROOT, 'docs', 'x.key')), /inside the repository/, 'a key stored in the repository is refused');
  throwsWith(() => tool.sign(zip), /--key/, 'signing needs a key file');
  fs.writeFileSync(path.join(tmp, 'not-a-key'), 'hello');
  throwsWith(() => tool.sign(zip, path.join(tmp, 'not-a-key')), /could not read/, 'a file that is not a key is refused');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(path.join(tmp, 'rsa.key'), rsa);
  throwsWith(() => tool.sign(zip, path.join(tmp, 'rsa.key')), /Ed25519/, 'only Ed25519 keys');

  /* 3. The release flow checks the checksum before signing and never uploads on a mismatch. */
  if (!committed) throwsWith(() => tool.release('build-abc', made.privatePath, { run: () => {} }), /commit docs\/release-signing-key\.pem/, 'release waits for the public key to be committed');
  throwsWith(() => tool.release('build abc; rm -rf /', made.privatePath, { run: () => {} }), /release tag/, 'tags are checked before any command runs');
  {
    /* A fake gh: download copies the release's two files into the folder it is given; upload is recorded. */
    const published = path.join(tmp, 'published');
    fs.mkdirSync(published);
    const body = crypto.randomBytes(8192);
    fs.writeFileSync(path.join(published, 'WardenOne-latest.zip'), body);
    const sum = crypto.createHash('sha256').update(body).digest('hex');
    const uploads = [];
    const gh = (sumText) => (args) => {
      if (args[0] === 'release' && args[1] === 'download') {
        const dir = args[args.indexOf('--dir') + 1];
        fs.copyFileSync(path.join(published, 'WardenOne-latest.zip'), path.join(dir, 'WardenOne-latest.zip'));
        fs.writeFileSync(path.join(dir, 'WardenOne-latest.zip.sha256'), sumText + '  WardenOne-latest.zip\n');
      } else if (args[0] === 'release' && args[1] === 'upload') {
        uploads.push({ tag: args[2], sig: fs.readFileSync(args[3], 'utf8').trim(), repo: args[args.indexOf('--repo') + 1] });
      }
    };
    const done = tool.release('build-abc123', made.privatePath, { run: gh(sum), publicKeyPath: pub });
    ok(done.sha256 === sum, 'the checksum is checked first');
    ok(uploads.length === 1 && uploads[0].tag === 'build-abc123' && uploads[0].repo === 'iri-dev/WardenOne', 'the signature is uploaded to that release');
    fs.writeFileSync(path.join(tmp, 'check.zip'), body);
    fs.writeFileSync(path.join(tmp, 'check.zip.sig'), uploads[0].sig + '\n');
    ok(tool.verify(path.join(tmp, 'check.zip'), undefined, pub), 'what was uploaded checks against the public key');
    throwsWith(() => tool.release('build-abc123', made.privatePath, { run: gh('0'.repeat(64)), publicKeyPath: pub }), /does not match its published checksum/, 'a ZIP that does not match its checksum is never signed');
    ok(uploads.length === 1, 'and nothing is uploaded for it');
    const other = path.join(tmp, 'other2');
    const otherKey = tool.keygen(other);
    throwsWith(() => tool.release('build-abc123', otherKey.privatePath, { run: gh(sum), publicKeyPath: pub }), /does not match docs\/release-signing-key\.pem/, 'a key that does not match the published one is refused');
  }

  /* 4. No workflow holds a signing key. */
  const workflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).map((f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8')).join('\n');
  ok(!/RELEASE_KEY|release-signing\.js sign/.test(workflows), 'CI never signs, so a takeover of the GitHub account cannot reach the key');
  /* Releases are not signed yet, so the README must not offer a signature to check. */
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok(!/WardenOne-latest\.zip\.sig\b/.test(readme), 'the README promises no signature while releases are unsigned');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('[ok] release signing checks passed (' + checks + ')');

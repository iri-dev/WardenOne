#!/usr/bin/env node
/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Owner signatures for release ZIPs. The checksum and the build attestation both come from the same GitHub account as
   the ZIP, so a takeover of that account could replace all three together. This key never touches GitHub, not even
   as a secret, because a workflow can read secrets: the owner keeps it on her own machine and signs a release after
   checking it. Only the public half lives in the repository, as docs/release-signing-key.pem.

     node tools/release-signing.js keygen --out <folder outside this repository>
     node tools/release-signing.js release <tag> --key <private key>   (download, check the checksum, sign, upload)
     node tools/release-signing.js sign <file> --key <private key>
     node tools/release-signing.js verify <file> [<file>.sig] [--key <public key>] */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_KEY_PATH = path.join(ROOT, 'docs', 'release-signing-key.pem');
const REPO = 'iri-dev/WardenOne';
const ASSET = 'WardenOne-latest.zip';

class SigningError extends Error {}
const fail = (message) => { throw new SigningError(message); };

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function ed25519Public(pem) {
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') fail('the release key must be Ed25519');
  return key;
}
const publicPem = (key) => key.export({ type: 'spki', format: 'pem' }).toString();

/* The private key is never written or read inside the repository, so it cannot be committed by accident. */
function keygen(out) {
  if (!out) fail('give --out, a folder outside this repository');
  const dir = path.resolve(out);
  if (inside(dir, ROOT)) fail('refusing to write the private key inside the repository: ' + dir);
  fs.mkdirSync(dir, { recursive: true });
  const privatePath = path.join(dir, 'wardenone-release-signing.key');
  if (fs.existsSync(privatePath)) fail('a key already exists at ' + privatePath + '; move it away first');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pub = publicPem(publicKey);
  fs.writeFileSync(path.join(dir, 'release-signing-key.pem'), pub);
  return { privatePath, publicPem: pub };
}

function loadPrivateKey(keyFile, publicKeyPath) {
  const pubPath = publicKeyPath || PUBLIC_KEY_PATH;
  if (!keyFile) fail('give --key, the private key file');
  if (inside(keyFile, ROOT)) fail('refusing to use a private key stored inside the repository');
  let key;
  try { key = crypto.createPrivateKey(fs.readFileSync(keyFile)); } catch (_) { fail('could not read a private key from ' + keyFile); }
  if (key.asymmetricKeyType !== 'ed25519') fail('the release key must be Ed25519');
  /* A key that does not match the published public key would make signatures nobody can check. */
  if (fs.existsSync(pubPath)
    && publicPem(crypto.createPublicKey(key)) !== publicPem(ed25519Public(fs.readFileSync(pubPath, 'utf8')))) {
    fail('this key does not match docs/release-signing-key.pem');
  }
  return key;
}

function sign(file, keyFile, publicKeyPath) {
  const key = loadPrivateKey(keyFile, publicKeyPath);
  const signature = crypto.sign(null, fs.readFileSync(file), key).toString('base64');
  fs.writeFileSync(file + '.sig', signature + '\n');
  return file + '.sig';
}

function verify(file, sigFile, keyFile) {
  const keyPath = keyFile || PUBLIC_KEY_PATH;
  if (!fs.existsSync(keyPath)) fail('no published release key at ' + keyPath);
  const sigPath = sigFile || file + '.sig';
  if (!fs.existsSync(sigPath)) fail('no signature file at ' + sigPath);
  const signature = Buffer.from(fs.readFileSync(sigPath, 'utf8').trim(), 'base64');
  if (signature.length !== 64 || !crypto.verify(null, fs.readFileSync(file), ed25519Public(fs.readFileSync(keyPath, 'utf8')), signature)) {
    fail('the signature does not match ' + path.basename(file));
  }
  return true;
}

/* The checksum is checked before anything is signed, so a ZIP that does not match its release is never vouched for. */
function release(tag, keyFile, opts) {
  opts = opts || {};
  if (!/^[A-Za-z0-9._-]+$/.test(String(tag || ''))) fail('give the release tag, for example build-<commit>');
  const pubPath = opts.publicKeyPath || PUBLIC_KEY_PATH;
  loadPrivateKey(keyFile, pubPath);
  if (!fs.existsSync(pubPath)) fail('commit docs/release-signing-key.pem first, so people can check the signature');
  const gh = opts.gh || process.env.GH_PATH || 'gh';
  const run = opts.run || ((args) => execFileSync(gh, args, { stdio: ['ignore', 'pipe', 'inherit'] }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-sign-'));
  try {
    run(['release', 'download', tag, '--repo', opts.repo || REPO, '--pattern', ASSET, '--pattern', ASSET + '.sha256', '--dir', dir]);
    const zip = path.join(dir, ASSET);
    const listed = fs.readFileSync(zip + '.sha256', 'utf8').trim().split(/\s+/)[0].toLowerCase();
    const actual = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(listed) || listed !== actual) fail('the downloaded ZIP does not match its published checksum; nothing was signed');
    const sigPath = sign(zip, keyFile, pubPath);
    verify(zip, sigPath, pubPath);
    if (!opts.noUpload) run(['release', 'upload', tag, sigPath, '--repo', opts.repo || REPO, '--clobber']);
    return { sha256: actual, signature: fs.readFileSync(sigPath, 'utf8').trim() };
  } finally {
    if (!opts.keep) fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (command === 'keygen') {
      const made = keygen(flag('out'));
      console.log('Private key: ' + made.privatePath + '\nKeep it somewhere safe and never add it to GitHub.');
      console.log('Public key, to commit as docs/release-signing-key.pem:\n' + made.publicPem);
    } else if (command === 'release') {
      const done = release(rest[0], flag('key'), { noUpload: rest.includes('--no-upload') });
      console.log('[release-signing] ' + rest[0] + ': checksum ' + done.sha256 + ' matched, signed' + (rest.includes('--no-upload') ? '' : ' and uploaded'));
    } else if (command === 'sign') {
      console.log('[release-signing] wrote ' + sign(rest[0], flag('key')));
    } else if (command === 'verify') {
      verify(rest[0], rest[1] && !rest[1].startsWith('--') ? rest[1] : undefined, flag('key'));
      console.log('[release-signing] ' + path.basename(rest[0]) + ' is signed by the release key');
    } else {
      fail('usage: keygen --out <folder> | release <tag> --key <key> | sign <file> --key <key> | verify <file> [sig] [--key <pem>]');
    }
  } catch (error) {
    console.error('[release-signing] ' + (error instanceof SigningError ? error.message : String(error && error.message || error)));
    process.exit(1);
  }
}

module.exports = { keygen, sign, verify, release, PUBLIC_KEY_PATH, SigningError };

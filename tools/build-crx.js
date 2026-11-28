#!/usr/bin/env node
/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Packs the release ZIP as a CRX3 file for phone browsers that install .crx files, such as Aerium.
   The CRX wraps the ZIP's exact bytes, so both downloads carry the same build.

     node tools/build-crx.js keygen --out <folder outside this repository>
     node tools/build-crx.js pack WardenOne-latest.zip --out WardenOne-phone.crx   (key from WARDENONE_CRX_KEY or --key)
     node tools/build-crx.js verify WardenOne-phone.crx [--zip WardenOne-latest.zip] */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IDENTITY_PATH = path.join(ROOT, 'tools', 'crx-identity.json');
const KEY_ENV = 'WARDENONE_CRX_KEY';
const MAGIC = Buffer.from('Cr24', 'latin1');
const SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'latin1');
/* The size Chromium's own packer uses. */
const KEY_BITS = 2048;

class CrxError extends Error {}
const fail = (message) => { throw new CrxError(message); };

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
const shown = (file) => (inside(file, ROOT) ? path.relative(ROOT, file).split(path.sep).join('/') : file);

/* Just enough protobuf for crx3.proto: varints and length-delimited fields. */
function varint(n) {
  const out = [];
  while (n > 0x7f) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return Buffer.from(out);
}
const field = (number, bytes) => Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);

function readFields(buf) {
  const fields = [];
  let at = 0;
  const readVarint = () => {
    let value = 0;
    let scale = 1;
    let byte;
    do {
      if (at >= buf.length) fail('the CRX header is truncated');
      byte = buf[at++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
      if (scale > 2 ** 49) fail('the CRX header has an oversized number');
    } while (byte & 0x80);
    return value;
  };
  while (at < buf.length) {
    const key = readVarint();
    const number = Math.floor(key / 8);
    const type = key % 8;
    if (type === 2) {
      const length = readVarint();
      if (at + length > buf.length) fail('the CRX header is truncated');
      fields.push({ number, bytes: buf.subarray(at, at + length) });
      at += length;
    } else if (type === 0) readVarint();
    else if (type === 1) at += 8;
    else if (type === 5) at += 4;
    else fail('the CRX header uses an unknown field type');
  }
  if (at !== buf.length) fail('the CRX header is truncated');
  return fields;
}

/* Chromium's extension ID: the first 16 bytes of SHA-256 over the public key, written with the letters a to p. */
const crxIdOf = (publicKeyDer) => crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
const extensionId = (publicKeyDer) => [...crxIdOf(publicKeyDer).toString('hex')]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

function signedMessage(signedHeaderData, archive) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length);
  return Buffer.concat([SIGNED_DATA_PREFIX, length, signedHeaderData, archive]);
}

/* Fields in number order, as protobuf serialises them, so the bytes match Chromium's own packer. */
function encodeHeader(publicKeyDer, signature, crxId) {
  return Buffer.concat([
    field(2, Buffer.concat([field(1, publicKeyDer), field(2, signature)])),
    field(10000, field(1, crxId)),
  ]);
}

function rsaKey(key) {
  if (key.asymmetricKeyType !== 'rsa') fail('the CRX key must be an RSA key');
  return key;
}
const publicDer = (key) => crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });

function pack(archive, privateKey) {
  rsaKey(privateKey);
  if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) fail('the archive to pack is not a ZIP');
  const der = publicDer(privateKey);
  const crxId = crxIdOf(der);
  const signedHeaderData = field(1, crxId);
  const signature = crypto.sign('sha256', signedMessage(signedHeaderData, archive), privateKey);
  const header = encodeHeader(der, signature, crxId);
  const prefix = Buffer.alloc(12);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, archive]);
}

function parse(crx) {
  if (crx.length < 12 || !crx.subarray(0, 4).equals(MAGIC)) fail('this is not a CRX file');
  if (crx.readUInt32LE(4) !== 3) fail('only CRX3 files are supported');
  const headerSize = crx.readUInt32LE(8);
  if (12 + headerSize > crx.length) fail('the CRX header runs past the end of the file');
  const header = crx.subarray(12, 12 + headerSize);
  const rsaProofs = [];
  let ecdsaProofs = 0;
  let signedHeaderData = null;
  for (const f of readFields(header)) {
    if (f.number === 2) {
      const proof = {};
      for (const p of readFields(f.bytes)) {
        if (p.number === 1) proof.publicKey = p.bytes;
        else if (p.number === 2) proof.signature = p.bytes;
      }
      rsaProofs.push(proof);
    } else if (f.number === 3) ecdsaProofs++;
    else if (f.number === 10000) signedHeaderData = f.bytes;
  }
  let crxId = null;
  if (signedHeaderData) for (const f of readFields(signedHeaderData)) if (f.number === 1) crxId = f.bytes;
  return { header, archive: crx.subarray(12 + headerSize), rsaProofs, ecdsaProofs, signedHeaderData, crxId };
}

/* Mirrors Chromium's CRX3 check for the one shape we publish: a single RSA proof whose key names the ID. */
function verify(crx, expect = {}) {
  const parsed = parse(crx);
  if (!parsed.signedHeaderData || !parsed.crxId || parsed.crxId.length !== 16) fail('the CRX does not name its extension ID');
  if (parsed.rsaProofs.length !== 1 || parsed.ecdsaProofs) fail('the CRX must carry exactly one RSA signature');
  const proof = parsed.rsaProofs[0];
  if (!proof.publicKey || !proof.signature) fail('the CRX signature is incomplete');
  if (!crxIdOf(proof.publicKey).equals(parsed.crxId)) fail('the CRX names a different extension ID than its key gives');
  let key;
  try { key = crypto.createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' }); } catch (_) { fail('the CRX public key is unreadable'); }
  if (!crypto.verify('sha256', signedMessage(parsed.signedHeaderData, parsed.archive), rsaKey(key), proof.signature)) {
    fail('the CRX signature does not match its contents');
  }
  if (expect.publicKey && !proof.publicKey.equals(expect.publicKey)) fail('the CRX is signed with a different key than WardenOne\'s');
  const id = extensionId(proof.publicKey);
  if (expect.extensionId && id !== expect.extensionId) fail('the CRX installs as ' + id + ', not ' + expect.extensionId);
  if (expect.zip && !parsed.archive.equals(expect.zip)) fail('the packed archive differs from the release ZIP');
  return { extensionId: id, archive: parsed.archive, publicKey: proof.publicKey };
}

function readIdentity(file = IDENTITY_PATH) {
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { fail(shown(file) + ' is not valid JSON'); }
  const der = Buffer.from(String(data.publicKey || ''), 'base64');
  let ok = false;
  try { ok = rsaKey(crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })) && extensionId(der) === data.extensionId; } catch (_) { ok = false; }
  if (!ok) fail(shown(file) + ' is inconsistent: its public key does not give its extension ID');
  return { extensionId: data.extensionId, publicKey: der };
}

/* The key comes from the environment in CI. A key file is accepted only from outside the repository. */
function loadPrivateKey({ keyFile, env = process.env } = {}) {
  let pem;
  if (keyFile) {
    if (inside(keyFile, ROOT)) fail('refusing to use a private key stored inside the repository');
    try { pem = fs.readFileSync(keyFile, 'utf8'); } catch (_) { fail('could not read the key file ' + keyFile); }
  } else if (env[KEY_ENV]) {
    pem = env[KEY_ENV];
  } else {
    fail('no CRX key: set ' + KEY_ENV + ' or pass --key <file outside this repository>');
  }
  let key;
  try { key = crypto.createPrivateKey(pem); } catch (_) { fail('could not read a private key from ' + (keyFile ? keyFile : KEY_ENV)); }
  return rsaKey(key);
}

function packFile(zipPath, outPath, opts = {}) {
  const identityPath = opts.identityPath || IDENTITY_PATH;
  const identity = readIdentity(identityPath);
  if (!identity) fail('no ' + shown(identityPath) + ' yet: run keygen first');
  const key = loadPrivateKey(opts);
  if (!publicDer(key).equals(identity.publicKey)) {
    fail('this key does not match ' + shown(identityPath) + ', so the CRX would install as a different extension');
  }
  const zip = fs.readFileSync(zipPath);
  const crx = pack(zip, key);
  verify(crx, { publicKey: identity.publicKey, extensionId: identity.extensionId, zip });
  fs.writeFileSync(outPath, crx);
  return { extensionId: identity.extensionId, bytes: crx.length };
}

/* A new key means a new extension ID, and every CRX install would become a separate extension without its settings. */
function keygen(out, opts = {}) {
  const identityPath = opts.identityPath || IDENTITY_PATH;
  if (!out) fail('give --out, a folder outside this repository');
  const dir = path.resolve(out);
  if (inside(dir, ROOT)) fail('refusing to write the private key inside the repository: ' + dir);
  if (fs.existsSync(identityPath)) {
    fail(shown(identityPath) + ' already exists. A new key would change WardenOne\'s extension ID for everyone who installed the CRX.');
  }
  fs.mkdirSync(dir, { recursive: true });
  const privatePath = path.join(dir, 'wardenone-crx.key');
  if (fs.existsSync(privatePath)) fail('a key already exists at ' + privatePath + '; move it away first');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: KEY_BITS });
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const identity = {
    about: 'The extension ID of WardenOne-phone.crx. Changing the key changes the ID, and installed copies would not update.',
    extensionId: extensionId(der),
    publicKey: der.toString('base64'),
  };
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2) + '\n');
  return { privatePath, identityPath, extensionId: identity.extensionId };
}

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : undefined; };
  const identityPath = flag('identity') ? path.resolve(flag('identity')) : undefined;
  try {
    if (command === 'keygen') {
      const made = keygen(flag('out'), { identityPath });
      console.log('Private key: ' + made.privatePath);
      console.log('Extension ID: ' + made.extensionId + ' (written to ' + shown(made.identityPath) + ')');
      console.log('Add the key as the GitHub secret ' + KEY_ENV + ', keep a private backup, and never put it in this folder.');
    } else if (command === 'pack') {
      if (!rest[0] || !flag('out')) fail('usage: pack <zip> --out <crx> [--key <file>] [--identity <file>]');
      const done = packFile(path.resolve(rest[0]), path.resolve(flag('out')), { keyFile: flag('key'), identityPath });
      console.log('[build-crx] wrote ' + flag('out') + ' (' + done.bytes + ' bytes) for extension ' + done.extensionId);
    } else if (command === 'verify') {
      if (!rest[0]) fail('usage: verify <crx> [--zip <zip>] [--identity <file>]');
      const identity = readIdentity(identityPath);
      const zip = flag('zip') ? fs.readFileSync(path.resolve(flag('zip'))) : undefined;
      const done = verify(fs.readFileSync(path.resolve(rest[0])), Object.assign({ zip }, identity || {}));
      console.log('[build-crx] ' + path.basename(rest[0]) + ' is a valid CRX3 for extension ' + done.extensionId
        + (identity ? ', signed with WardenOne\'s key' : '') + (zip ? ', carrying the release ZIP unchanged' : ''));
    } else {
      fail('usage: keygen --out <folder> | pack <zip> --out <crx> | verify <crx> [--zip <zip>]');
    }
  } catch (error) {
    console.error('[build-crx] ' + (error instanceof CrxError ? error.message : String(error && error.message || error)));
    process.exit(1);
  }
}

module.exports = {
  pack, parse, verify, packFile, keygen, readIdentity, loadPrivateKey, encodeHeader, extensionId,
  IDENTITY_PATH, KEY_ENV, CrxError,
};

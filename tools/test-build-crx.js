#!/usr/bin/env node
'use strict';

/* The phone CRX: Chromium's format byte for byte, one pinned key and extension ID, the release ZIP carried
   unchanged, the key kept out of the repository and handed to one workflow step only. */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tool = require('./build-crx.js');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const throwsWith = (fn, re, msg) => { let e = null; try { fn(); } catch (err) { e = err; } ok(e && re.test(String(e.message)), msg + (e ? ' (' + e.message + ')' : ' (did not throw)')); };

/* Packed by Edge's own --pack-extension from a one-file test extension. Its throwaway key was deleted. */
const EDGE_TINY_CRX = Buffer.from('Q3IyNAMAAABFAgAAEqwECqYCMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArNIoRXIpL3weFAfIG4dgzPbUWb9wlqpoPwJwNGqxLziBp2MG/UUwuriI1/u8eJ2IgDXlYA6NCRYbgR/GDtnhIkIfA2tozvwlS6FVakUNX1S0XyUV/9k37Aka4Hf5zLbkiwDYhAUwL16Kgk1bJmMqH+jz74f0hUlk9E3HAP9O6d0VrvNmWUOgJUB+9xKykG2iVVXGMU8ALILWqOLnHDhovOQwn+0L1jotSTkJfuTxfw+d6Gj/B2hv5O7sVOOB7h5opNUGz5VIJbjjFRGElz4RP49oBbkiVbbahSsGgp+KD6GUMc5iNhmT/4TZkPnGwRgMJUm8czF95v3q9YktkvkiTQIDAQABEoACXSW9I2N530TkXPqfdOEyrIi4YuveCHgYsNpWx9XR3Fb1bYcpjiiMhKyugpLDRSgOXuFISRYSnJrNhaQN8Gr7pNY2xQC7T7An5rAwH1s3rp+tTpTD8DjIa5U2U6rVFuGY56J0Dpqtj4F5nmPQfVJ3XWAeKAmN3QuD+yqcJDtxVtj5qYAi4kUY1gxQ//dAbZBsiS/bJRYSDeSrGrPP4y5Qe3X5ZX88uBS37xnEb7TKu0l1885Xy5dhtwuo2lEPz5zQPsDMmzLl7CN3EpTqy1qn0ZXs1aRRYPxR+FWoAaaciej1SM879maHckf75AMBJ3lQl+r74NmIM0bnBkWT2s8M/ILxBBIKEDT5nWunObGQHC/9Go4dRsVQSwMELQAACAgAMFF8XTGDZVc2AAAAOwAAAA0AFABtYW5pZmVzdC5qc29uAQAQAAAAAAAAAAAAAAAAAAAAAACrVspNzMtMSy0uiS9LLSrOzM9TsjLWUcpLzE1VslJyDopQSMusKCktSlXSUYIrUDLUM1CqBQBQSwECAAAUAAAICAAwUXxdMYNlVzYAAAA7AAAADQAAAAAAAAABAAAAAAAAAAAAbWFuaWZlc3QuanNvblBLBQYAAAAAAQABADsAAAB1AAAAAAA=', 'base64');
/* The public key of a test CRX that Aerium, a Chromium browser, installed as difafjcfojcemaomacepcdigkfdnblap. */
const AERIUM_TEST_KEY = Buffer.from('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzQRlwEZT+8VHG5lTNHvE3eJLjLLWPxVdWWQalgdkg9AQv98gkQU3XpQTWermq88MhIFg0WQLT4hplN8QhR1n/x76fEEKS8EfFRdmrCzpsJN2OrEFdkUufW5uaBDMFNMwFBkuvJRnaBPMfzlJvovRxiOMbwl4NDFe45xmpqQ1Ui44pynwlUk5Jy+Jc8W8qI2uH7CW8F4kJNnqG+/+fvHxx/UbLa7Yi61h13sh3zC9wgRm4eELR8HBKpkMlKVvgr+UDgJbazd4yRK5r7/ka/XqAZMNlRGo/LT2nTN3Qf0MSlHnmri+M+hT5ax7gC2Ykcc33lMwW++04GUKk2j65COK6wIDAQAB', 'base64');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-crx-'));
try {
  /* 1. Chromium's ID and file format. */
  ok(tool.extensionId(AERIUM_TEST_KEY) === 'difafjcfojcemaomacepcdigkfdnblap', 'the extension ID is the one a real Chromium browser gave the same key');
  const edge = tool.verify(EDGE_TINY_CRX);
  ok(edge.archive.readUInt32LE(0) === 0x04034b50 && /^[a-p]{32}$/.test(edge.extensionId), 'a CRX packed by Chromium itself verifies and carries a ZIP');
  const parsedEdge = tool.parse(EDGE_TINY_CRX);
  const proof = parsedEdge.rsaProofs[0];
  ok(tool.encodeHeader(proof.publicKey, proof.signature, parsedEdge.crxId).equals(parsedEdge.header), 'the header is encoded byte for byte as Chromium writes it');

  /* 2. A key made here packs the ZIP unchanged, the same way every time. */
  const identityPath = path.join(tmp, 'crx-identity.json');
  const made = tool.keygen(path.join(tmp, 'keys'), { identityPath });
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  ok(fs.existsSync(made.privatePath) && /^[a-p]{32}$/.test(identity.extensionId) && identity.extensionId === made.extensionId, 'keygen writes the key outside and pins its extension ID');
  ok(!/PRIVATE/.test(fs.readFileSync(identityPath, 'utf8')), 'the identity file holds only the public key');
  const zipPath = path.join(tmp, 'WardenOne-latest.zip');
  fs.writeFileSync(zipPath, edge.archive);
  const zip = fs.readFileSync(zipPath);
  const outA = path.join(tmp, 'a.crx');
  const outB = path.join(tmp, 'b.crx');
  tool.packFile(zipPath, outA, { keyFile: made.privatePath, identityPath });
  const crxA = fs.readFileSync(outA);
  const checked = tool.verify(crxA, { zip, extensionId: made.extensionId, publicKey: Buffer.from(identity.publicKey, 'base64') });
  ok(checked.archive.equals(zip), 'the CRX carries the release ZIP byte for byte');
  tool.packFile(zipPath, outB, { env: { [tool.KEY_ENV]: fs.readFileSync(made.privatePath, 'utf8') }, identityPath });
  ok(fs.readFileSync(outB).equals(crxA), 'packing again, with the key from the environment, gives the identical file');

  /* 3. Anything changed after signing fails. */
  const flip = (buf, at) => { const copy = Buffer.from(buf); copy[at] ^= 1; return copy; };
  throwsWith(() => tool.verify(flip(crxA, crxA.length - 30)), /signature does not match/, 'a changed archive fails');
  const parsedA = tool.parse(crxA);
  const sigAt = 12 + parsedA.header.indexOf(parsedA.rsaProofs[0].signature) + 10;
  throwsWith(() => tool.verify(flip(crxA, sigAt)), /signature does not match/, 'a changed signature fails');
  throwsWith(() => tool.verify(crxA, { zip: Buffer.concat([zip, Buffer.from([0])]) }), /differs from the release ZIP/, 'a CRX that does not carry this ZIP fails');
  throwsWith(() => tool.verify(crxA.subarray(0, 40)), /past the end/, 'a truncated CRX fails');
  const crx2 = Buffer.from(crxA); crx2.writeUInt32LE(2, 4);
  throwsWith(() => tool.verify(crx2), /CRX3/, 'an old CRX2 file is refused');
  throwsWith(() => tool.verify(Buffer.from('PK\x03\x04 not a crx')), /not a CRX/, 'a plain ZIP is not a CRX');
  throwsWith(() => tool.pack(Buffer.from('hello world'), crypto.createPrivateKey(fs.readFileSync(made.privatePath))), /not a ZIP/, 'only a ZIP is packed');

  /* Another key: a header naming the wrong ID fails, and a valid CRX from that key fails the pinned check. */
  const other = tool.keygen(path.join(tmp, 'other'), { identityPath: path.join(tmp, 'other-identity.json') });
  const otherCrx = tool.pack(zip, crypto.createPrivateKey(fs.readFileSync(other.privatePath)));
  const op = tool.parse(otherCrx);
  const mixedHeader = tool.encodeHeader(op.rsaProofs[0].publicKey, op.rsaProofs[0].signature, parsedA.crxId);
  const prefix = Buffer.alloc(12); prefix.write('Cr24', 0, 'latin1'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(mixedHeader.length, 8);
  throwsWith(() => tool.verify(Buffer.concat([prefix, mixedHeader, zip])), /different extension ID/, 'a header naming another extension ID fails');
  ok(tool.verify(otherCrx).extensionId === other.extensionId, 'a CRX from another key is valid on its own');
  throwsWith(() => tool.verify(otherCrx, { publicKey: Buffer.from(identity.publicKey, 'base64') }), /different key/, 'but not as WardenOne');

  /* 4. The key stays out of the repository and out of error messages. */
  throwsWith(() => tool.keygen(path.join(ROOT, 'tools', 'keys'), { identityPath: path.join(tmp, 'x.json') }), /inside the repository/, 'no private key is written inside the repository');
  throwsWith(() => tool.keygen(undefined, { identityPath: path.join(tmp, 'x.json') }), /--out/, 'keygen needs a folder');
  throwsWith(() => tool.keygen(path.join(tmp, 'again'), { identityPath }), /already exists/, 'a pinned identity is never replaced by a new key');
  throwsWith(() => tool.packFile(zipPath, outA, { keyFile: path.join(ROOT, 'tools', 'wardenone-crx.key'), identityPath }), /inside the repository/, 'a key stored in the repository is refused');
  throwsWith(() => tool.packFile(zipPath, outA, { env: {}, identityPath }), new RegExp(tool.KEY_ENV), 'packing without a key says which secret is missing');
  throwsWith(() => tool.packFile(zipPath, outA, { keyFile: other.privatePath, identityPath }), /does not match/, 'a key that does not match the pinned identity is refused');
  throwsWith(() => tool.packFile(zipPath, outA, { keyFile: made.privatePath, identityPath: path.join(tmp, 'none.json') }), /run keygen first/, 'nothing is packed before an identity is pinned');
  const ed = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  throwsWith(() => tool.loadPrivateKey({ env: { [tool.KEY_ENV]: ed } }), /RSA/, 'only RSA keys');
  const secretish = '-----BEGIN PRIVATE KEY-----\nSECRETMARKER\n-----END PRIVATE KEY-----\n';
  throwsWith(() => tool.loadPrivateKey({ env: { [tool.KEY_ENV]: secretish } }), /^(?![\s\S]*SECRETMARKER)[\s\S]*could not read/, 'an unreadable key is never echoed back');
  fs.writeFileSync(path.join(tmp, 'broken.json'), JSON.stringify(Object.assign({}, identity, { extensionId: 'a'.repeat(32) })));
  throwsWith(() => tool.readIdentity(path.join(tmp, 'broken.json')), /inconsistent/, 'an identity whose key and ID disagree is refused');

  /* 5. The repository: the pinned identity is consistent, and the README offers a CRX only once one can be built. */
  const pinned = tool.readIdentity();
  if (pinned) ok(/^[a-p]{32}$/.test(pinned.extensionId), 'tools/crx-identity.json pins a well formed extension ID');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok(!/WardenOne-phone\.crx\b/.test(readme) || !!pinned, 'the README links the CRX only after tools/crx-identity.json is committed');
  /* .gitignore is local only, so ask git what it actually tracks. */
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
  ok(tracked.length > 100 && !tracked.some((f) => /\.(pem|key|crx)$/i.test(f)), 'no key file or built CRX is tracked');

  /* 6. The workflow builds, attests, uploads and checks the CRX, and only one step ever sees the key. */
  const workflowDir = path.join(ROOT, '.github', 'workflows');
  const workflows = fs.readdirSync(workflowDir).map((f) => fs.readFileSync(path.join(workflowDir, f), 'utf8')).join('\n');
  const gate = fs.readFileSync(path.join(workflowDir, 'gate.yml'), 'utf8');
  const rolling = gate.split(/\n  rolling-build:\n/)[1] || '';
  const steps = rolling.split(/\n      - /);
  const step = (name) => steps.find((s) => s.startsWith('name: ' + name + '\n')) || '';
  const order = ['Write and verify the ZIP checksum', 'Pack the CRX for phone browsers', 'Attest the ZIP build provenance',
    'Attest the CRX build provenance', 'Write the notes', 'Prepare the commit release as a draft', 'Verify both assets before publication',
    'Make the complete release Latest'].map((n) => steps.findIndex((s) => s.startsWith('name: ' + n + '\n')));
  ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'the CRX is packed and attested after the ZIP checks and before anything is uploaded');
  const packStep = step('Pack the CRX for phone browsers');
  ok(/if \[ ! -f tools\/crx-identity\.json \]; then[\s\S]*?exit 0\n\s*fi\n/.test(packStep)
    && /node tools\/build-crx\.js pack WardenOne-latest\.zip --out WardenOne-phone\.crx\n/.test(packStep)
    && /node tools\/build-crx\.js verify WardenOne-phone\.crx --zip WardenOne-latest\.zip\n/.test(packStep)
    && /sha256sum WardenOne-phone\.crx > WardenOne-phone\.crx\.sha256\n\s*sha256sum --check WardenOne-phone\.crx\.sha256/.test(packStep),
  'the CRX is packed from the checked ZIP, verified against it and given a checksum');
  const secretUses = workflows.match(/secrets\.WARDENONE_CRX_KEY/g) || [];
  ok(secretUses.length === 1 && /env:\n\s*WARDENONE_CRX_KEY: \$\{\{ secrets\.WARDENONE_CRX_KEY \}\}\n\s*run: \|/.test(packStep),
    'the key reaches the packing step alone, through its environment');
  ok(!/\$\{\{\s*secrets\./.test(packStep.split(/\n\s*run: \|/)[1] || ''), 'no secret is pasted into the shell script itself');
  ok(/if: hashFiles\('WardenOne-phone\.crx'\) != ''/.test(step('Attest the CRX build provenance'))
    && /uses: actions\/attest@[0-9a-f]{40}/.test(step('Attest the CRX build provenance'))
    && /subject-path: WardenOne-phone\.crx\n/.test(step('Attest the CRX build provenance')), 'the CRX gets its own pinned build attestation');
  const prepare = step('Prepare the commit release as a draft');
  ok(/if \[ -f WardenOne-phone\.crx \]; then CRX_ASSETS='WardenOne-phone\.crx WardenOne-phone\.crx\.sha256'; fi/.test(prepare)
    && /gh release create "\$BUILD_TAG" WardenOne-latest\.zip WardenOne-latest\.zip\.sha256 \$CRX_ASSETS \\/.test(prepare)
    && /gh release upload "\$BUILD_TAG" WardenOne-latest\.zip WardenOne-latest\.zip\.sha256 --clobber \$CRX_ASSETS\n/.test(prepare)
    && /cmp -s WardenOne-phone\.crx existing-assets\/WardenOne-phone\.crx/.test(prepare), 'a built CRX and its checksum go on the draft with the ZIP');
  const verifyStep = step('Verify both assets before publication');
  ok(/if \[ -f WardenOne-phone\.crx \]; then\n\s*gh release download "\$BUILD_TAG" --pattern 'WardenOne-phone\.crx\*' --dir downloaded-release \|\| return 1\n\s*cmp WardenOne-phone\.crx downloaded-release\/WardenOne-phone\.crx \|\| return 1\n\s*cmp WardenOne-phone\.crx\.sha256 downloaded-release\/WardenOne-phone\.crx\.sha256 \|\| return 1\n\s*\(cd downloaded-release && sha256sum --check WardenOne-phone\.crx\.sha256\) \|\| return 1\n\s*fi/.test(verifyStep),
    'the uploaded CRX is downloaded and compared before the release goes Latest');
  const notes = step('Write the notes');
  ok(/if \[ -f WardenOne-phone\.crx \]; then\n\s*echo '\*\*On an Android phone\?\*\* \*\*WardenOne-phone\.crx\*\*/.test(notes)
    && /if \[ -f WardenOne-phone\.crx \]; then\n\s*echo "CRX SHA-256:/.test(notes), 'the notes mention the CRX only when one was built');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('[ok] CRX packing checks passed (' + checks + ')');

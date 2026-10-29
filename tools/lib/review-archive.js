/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function crxZip(bytes) {
  if (bytes.length < 16 || bytes.subarray(0, 4).toString() !== 'Cr24') throw Error('Not a CRX package');
  const version = bytes.readUInt32LE(4);
  const offset = version === 3 ? 12 + bytes.readUInt32LE(8) : version === 2 ? 16 + bytes.readUInt32LE(8) + bytes.readUInt32LE(12) : 0;
  if (!offset || offset > 1024 * 1024 || offset + 22 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw Error('Invalid CRX header');
  return bytes.subarray(offset);
}
function readZip(bytes, { maxTotal = 512 * 1024 * 1024, maxFile = 64 * 1024 * 1024 } = {}) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--)
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  if (end < 0) throw Error('Missing ZIP directory');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== count || count === 65535 || size === 0xffffffff || start === 0xffffffff || count > 10000 || start + size > end) throw Error('Unsupported ZIP directory bounds');
  const files = new Map(), windowsNames = new Set(); let cursor = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > start + size || bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid ZIP entry');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), length = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42), attributes = bytes.readUInt32LE(cursor + 38);
    const next = cursor + 46 + nameSize + extra + comment;
    if (next > start + size || (flags & 1) || bytes.readUInt16LE(cursor + 34) !== 0 || ![0, 8].includes(method) || ((attributes >>> 16) & 0xf000) === 0xa000) throw Error('Unsafe ZIP entry');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8');
    if (!name || /[\\:\x00-\x1f<>"|?*]/.test(name) || name.startsWith('/') || name.replace(/\/$/, '').split('/').some(part => !part || part === '..' || part === '.' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error('Unsafe ZIP path');
    cursor = next;
    if (name.endsWith('/')) continue;
    if (windowsNames.has(name.toLowerCase()) || length > maxFile || (total += length) > maxTotal) throw Error('ZIP duplicate or size limit');
    windowsNames.add(name.toLowerCase());
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw Error('Invalid local ZIP entry');
    const localNameSize = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const offset = local + 30 + localNameSize + localExtra;
    if (bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== name || offset + compressed > start) throw Error('ZIP local/central mismatch');
    const raw = bytes.subarray(offset, offset + compressed);
    const content = method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(maxFile, length)) });
    if (content.length !== length || crc32(content) !== crc) throw Error('ZIP content integrity mismatch');
    files.set(name, content);
  }
  if (cursor !== start + size) throw Error('ZIP directory size mismatch');
  return files;
}
function extract(files, directory) {
  const root = path.resolve(directory);
  if (fs.existsSync(root)) throw Error('Preserve existing snapshot: ' + root);
  fs.mkdirSync(root, { recursive: true });
  for (const [name, content] of files) {
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw Error('Archive escaped snapshot');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  }
}
module.exports = { crc32, crxZip, readZip, extract };

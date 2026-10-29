/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const zlib = require('zlib');
const {readZip, crxZip, crc32} = require('./lib/review-archive.js');
function zip(entries) {
  const locals = [], directory = []; let offset = 0;
  for (const [name, text, method = 8] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(text), raw = method === 8 ? zlib.deflateRawSync(data) : data;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, raw); directory.push(central, filename); offset += local.length + filename.length + raw.length;
  }
  const body = Buffer.concat(locals), central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, end]);
}
assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
const valid = zip([['manifest.json', '{"version":"1"}'], ['src/a.js', 'const x=1;', 0]]);
assert.equal(readZip(valid).get('src/a.js').toString(), 'const x=1;');
for (const name of ['../evil', '/absolute', 'a/../evil', 'a\\evil', 'C:evil', './evil', 'a\0evil','a.','a ','NUL.txt','con/x','a//b','a?b','a\nb']) assert.throws(() => readZip(zip([[name, 'x']])), /Unsafe ZIP path/);
assert.throws(() => readZip(zip([['same', 'x'], ['same', 'y']])), /duplicate/);
assert.throws(() => readZip(zip([['Same', 'x'], ['same', 'y']])), /duplicate/);
assert.throws(() => readZip(valid, {maxFile: 2}), /size limit/);
assert.throws(() => readZip(valid, {maxTotal: 2}), /size limit/);
assert.throws(() => readZip(valid.subarray(0, valid.length - 1)), /Missing ZIP/);
for (const mutation of [b => b.writeUInt16LE(1, b.length - 18), b => b.writeUInt32LE(0xffffffff, b.length - 6), b => b.writeUInt16LE(1, 6)]) {
  const damaged = Buffer.from(valid); mutation(damaged); assert.throws(() => readZip(damaged));
}
const corrupt = zip([['a', 'hello', 0]]); corrupt[31] ^= 1; assert.throws(() => readZip(corrupt), /integrity/);
for (const value of [Buffer.alloc(0), Buffer.from('Cr24'), Buffer.alloc(16)]) assert.throws(() => crxZip(value));
const header = Buffer.alloc(16); header.write('Cr24'); header.writeUInt32LE(3, 4); header.writeUInt32LE(4, 8);
assert.deepEqual(crxZip(Buffer.concat([header, valid])), valid);
console.log('[ok] ZIP/CRX path, bounds, CRC, duplicate, encryption and size boundaries');

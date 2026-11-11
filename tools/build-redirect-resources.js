/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The inert files a $redirect rule serves in place of a blocked request. Everything here is
   generated from this script rather than copied from a filter-list project, so the bytes are
   reviewable and reproducible -- the one exception is the silent clip, which is uBlock Origin's
   noop-1s.mp4 and is already tracked as spotify-silent-1s.mp4 (see CREDITS.md).

   A blocked request fails; a redirected one succeeds with nothing in it. That difference is the
   whole point: a script tag that 404s can trip an anti-adblock check or leave a loader waiting,
   while an empty 200 lets the page carry on.

   Run: node tools/build-redirect-resources.js [--build|--check] */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'redirect-resources');
const SILENT_CLIP = path.join(ROOT, 'spotify-silent-1s.mp4');

/* ---------------------------------------------------------------------------
   PNG. A transparent image of an exact size, because a page that lays out to a
   placeholder's intrinsic dimensions moves if the size is wrong.
   --------------------------------------------------------------------------- */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function transparentPng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 8 bits per channel
  ihdr[9] = 6;   // truecolour with alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  /* One filter byte per scanline, then width * RGBA zero bytes: fully transparent black. */
  const raw = Buffer.alloc(height * (1 + width * 4), 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* A 1x1 fully transparent GIF87a -- the shortest valid image a tracking pixel can be answered
   with, and the one shape every browser has decoded for thirty years. */
function transparentGif() {
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,             // GIF89a
    0x01, 0x00, 0x01, 0x00,                         // 1x1
    0x80, 0x00, 0x00,                               // global colour table, 2 entries
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,             // black, white
    0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // graphic control: colour 0 transparent
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
    0x02, 0x02, 0x44, 0x01, 0x00,                   // LZW: one pixel
    0x3b,                                           // trailer
  ]);
}

/* ---------------------------------------------------------------------------
   Silent MP3. MPEG-1 Layer III frames whose side info and main data are zero
   decode to silence, so a fixed header repeated with a zeroed payload is a
   valid, silent stream without carrying an encoder's output around.
   Header byte 0-1: 0xFF 0xFB = MPEG-1 Layer III, no CRC.
   Byte 2: 0x10 = bitrate index 1 (32 kbit/s), sampling index 0 (44.1 kHz), no padding. The
   sampling index has to agree with the frame length below -- index 1 is 48 kHz, and a 48 kHz
   header on 104-byte frames is the one combination Chrome's demuxer refuses to open.
   Byte 3: 0xC0 = single channel.
   Frame length = 144 * 32000 / 44100 = 104.
   --------------------------------------------------------------------------- */
const MP3_SAMPLE_RATE = 44100;
const MP3_BITRATE = 32000;
const MP3_SAMPLES_PER_FRAME = 1152;

function silentMp3(seconds) {
  const FRAME = Math.floor(144 * MP3_BITRATE / MP3_SAMPLE_RATE);
  const framesPerSecond = MP3_SAMPLE_RATE / MP3_SAMPLES_PER_FRAME;
  const count = Math.max(1, Math.round(seconds * framesPerSecond));
  const frame = Buffer.alloc(FRAME, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x10;
  frame[3] = 0xc0;
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

const VAST = (version) => '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<VAST version="' + version + '"></VAST>\n';

const VMAP = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>\n';

/* The published name on the left is what a filter list writes; "aliases" are the other spellings
   the same resource answers to. Keep this in step with REDIRECT_RESOURCES in background.js --
   tools/test-redirect-resources.js fails if they drift. */
const RESOURCES = [
  { file: 'noop.js', type: 'application/javascript', aliases: ['noopjs'],
    body: () => Buffer.from('(function(){})();\n', 'utf8') },
  { file: 'noop.txt', type: 'text/plain', aliases: ['nooptext', 'empty'],
    body: () => Buffer.alloc(0) },
  { file: 'noop.css', type: 'text/css', aliases: ['noopcss'],
    body: () => Buffer.alloc(0) },
  { file: 'noop.json', type: 'application/json', aliases: ['noopjson'],
    body: () => Buffer.from('{}\n', 'utf8') },
  { file: 'noop.html', type: 'text/html', aliases: ['noopframe'],
    body: () => Buffer.from('<!doctype html>\n<title></title>\n', 'utf8') },
  { file: 'noop-1x1.gif', type: 'image/gif', aliases: ['1x1.gif', '1x1-transparent.gif'],
    body: () => transparentGif() },
  { file: 'noop-2x2.png', type: 'image/png', aliases: ['2x2.png', '2x2-transparent.png'],
    body: () => transparentPng(2, 2) },
  { file: 'noop-3x2.png', type: 'image/png', aliases: ['3x2.png', '3x2-transparent.png'],
    body: () => transparentPng(3, 2) },
  { file: 'noop-32x32.png', type: 'image/png', aliases: ['32x32.png', '32x32-transparent.png'],
    body: () => transparentPng(32, 32) },
  { file: 'noop-0.1s.mp3', type: 'audio/mpeg', aliases: ['noopmp3-0.1s'],
    body: () => silentMp3(0.1) },
  { file: 'noop-0.5s.mp3', type: 'audio/mpeg', aliases: [],
    body: () => silentMp3(0.5) },
  { file: 'noop-1s.mp4', type: 'video/mp4', aliases: ['noopmp4-1s'],
    body: () => fs.readFileSync(SILENT_CLIP) },
  { file: 'noop-vast2.xml', type: 'text/xml', aliases: ['noopvast-2.0'],
    body: () => Buffer.from(VAST('2.0'), 'utf8') },
  { file: 'noop-vast3.xml', type: 'text/xml', aliases: ['noopvast-3.0'],
    body: () => Buffer.from(VAST('3.0'), 'utf8') },
  { file: 'noop-vast4.xml', type: 'text/xml', aliases: ['noopvast-4.0'],
    body: () => Buffer.from(VAST('4.0'), 'utf8') },
  { file: 'noop-vmap1.xml', type: 'text/xml', aliases: ['noopvmap-1.0', 'noop-vmap1.0.xml'],
    body: () => Buffer.from(VMAP, 'utf8') },
];

function names() {
  const map = new Map();
  for (const resource of RESOURCES) {
    map.set(resource.file, resource.file);
    for (const alias of resource.aliases) map.set(alias, resource.file);
  }
  return map;
}

function build() {
  fs.mkdirSync(DIR, { recursive: true });
  const written = [];
  for (const resource of RESOURCES) {
    const bytes = resource.body();
    fs.writeFileSync(path.join(DIR, resource.file), bytes);
    written.push({ file: resource.file, bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) });
  }
  for (const row of written) {
    console.log('  ' + row.file.padEnd(18) + String(row.bytes).padStart(7) + ' bytes  ' + row.sha256);
  }
  console.log('[ok] ' + written.length + ' redirect resources, ' + names().size + ' filter-list names');
}

function check() {
  let failed = 0;
  for (const resource of RESOURCES) {
    const file = path.join(DIR, resource.file);
    if (!fs.existsSync(file)) {
      console.error('[fail] missing redirect resource: ' + resource.file);
      failed++;
      continue;
    }
    if (!fs.readFileSync(file).equals(resource.body())) {
      console.error('[fail] ' + resource.file + ' does not match what this script generates;'
        + ' run: node tools/build-redirect-resources.js --build');
      failed++;
    }
  }
  const extra = fs.readdirSync(DIR).filter((f) => !RESOURCES.some((r) => r.file === f));
  for (const file of extra) {
    console.error('[fail] redirect-resources/' + file + ' is not declared in this script');
    failed++;
  }
  if (failed) process.exit(1);
  console.log('[ok] ' + RESOURCES.length + ' redirect resources match their generator');
}

module.exports = { RESOURCES, names, transparentPng, transparentGif, silentMp3, DIR };

if (require.main === module) {
  const arg = process.argv[2] || '--build';
  if (arg === '--check') check();
  else if (arg === '--build') build();
  else {
    console.error('usage: node tools/build-redirect-resources.js [--build|--check]');
    process.exit(2);
  }
}

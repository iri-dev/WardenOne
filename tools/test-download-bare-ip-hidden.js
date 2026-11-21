/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* A file with no extension from a public bare IP is held for review, whatever MIME type the server sends.
   Loader stages and IoT droppers arrive that way (/i, /spim, /bins/x86) with application/octet-stream.
   Run: node tools/test-download-bare-ip-hidden.js */
'use strict';
const assert = require('assert/strict');
const { loadDownloadGuard } = require('./test-download-guard.js');

const { guard } = loadDownloadGuard();
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const score = (url, name, mime = 'application/octet-stream') => {
  const rep = guard.scoreDownload(url, '', name, mime, [], '');
  return { rep, review: guard.shouldReviewDownload(rep) };
};

for (const [url, name] of [['http://37.44.238.88/spim', 'spim'], ['http://190.198.218.210:1171/i', 'i'],
  ['http://93.184.216.34/l7vmra', 'l7vmra'], ['https://93.184.216.34/get', 'get']]) {
  const { rep, review } = score(url, name);
  ok(review, 'held for review: ' + url);
  ok(rep.reviewEvidence.hiddenProgram && rep.reviewEvidence.activeContent, 'marked as a possible hidden program: ' + url);
  ok(rep.reasons.some((r) => /no extension served straight from a raw IP/.test(r)), 'says why: ' + url);
}
for (const [url, name, why] of [
  ['http://192.168.1.20/firmware', 'firmware', 'a file on your own network'],
  ['http://10.0.0.5/backup', 'backup', 'a private address'],
  ['http://93.184.216.34/report.pdf', 'report.pdf', 'a named document'],
  ['https://example.com/download', 'download', 'a named site (other checks decide)'],
]) {
  const { rep } = score(url, name);
  ok(!rep.reasons.some((r) => /no extension served straight from a raw IP/.test(r)), 'not this rule: ' + why);
}
console.log('[ok] bare IP files with no extension: ' + checks + ' checks');

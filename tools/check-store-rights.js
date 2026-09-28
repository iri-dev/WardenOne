/* Release-only gate: do not submit a Store ZIP while upstream rights are unreviewed.
   This is intentionally separate from the ordinary development gate. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');

function reviewed(entry, use, fileHash) {
  const review = entry && entry.rightsReview;
  if (!entry || entry.licenceVerified !== true || !String(entry.licence || '').trim()
    || !review || review.approvedUse !== use || !String(review.reviewer || '').trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(review.reviewedAt || ''))
    || !/^https:\/\//.test(String(review.evidenceUrl || ''))
    || !String(review.termsRevision || '').trim()
    || !['not-required', 'included'].includes(review.noticeDisposition)) return false;
  if (review.noticeDisposition === 'included'
    && (!Array.isArray(review.noticeFiles) || !review.noticeFiles.length
      || review.noticeFiles.some((name) => !['NOTICE', 'CREDITS.md', 'LICENSE'].includes(name)))) return false;
  if (use === 'redistribution') {
    if (!/^[0-9a-f]{64}$/.test(String(review.artifactSha256 || ''))) return false;
    try { if (fileHash(entry.file) !== review.artifactSha256) return false; }
    catch (_) { return false; }
  }
  return true;
}

function unresolvedRights(inventory, fileHash = (file) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, file))).digest('hex')) {
  const issues = [];
  if (!inventory || !Array.isArray(inventory.sources) || !inventory.sources.length
    || !Array.isArray(inventory.generated) || !inventory.generated.length) {
    return ['(source inventory missing or empty)'];
  }
  for (const source of inventory.sources || []) {
    if (!source || !source.url || !reviewed(source, 'runtime-fetch', fileHash)) {
      issues.push(source && source.url || '(unnamed source)');
    }
  }
  for (const derived of inventory.generated || []) {
    if (!derived || !derived.file || !reviewed(derived, 'redistribution', fileHash)) {
      issues.push(derived && derived.file || '(unnamed generated file)');
    }
  }
  return issues;
}
if (require.main === module) {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'source-inventory.json'), 'utf8'));
  const issues = unresolvedRights(inventory);
  if (issues.length) {
    console.error('Store submission blocked: ' + issues.length + ' upstream or derived inputs await a release-owner rights decision.');
    issues.forEach((item) => console.error('  ' + item));
    process.exitCode = 1;
  } else console.log('Store rights review complete for every inventoried input');
}
module.exports = { unresolvedRights };

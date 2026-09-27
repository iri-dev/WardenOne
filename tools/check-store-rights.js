/* Release-only gate: do not submit a Store ZIP while upstream rights are unreviewed.
   This is intentionally separate from the ordinary development gate. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function unresolvedRights(inventory) {
  const issues = [];
  for (const source of inventory.sources || []) {
    if (!source || !source.url || source.licenceVerified !== true || !String(source.licence || '').trim()) {
      issues.push(source && source.url || '(unnamed source)');
    }
  }
  for (const derived of inventory.generated || []) {
    if (!derived || !derived.file || derived.licenceVerified !== true || !String(derived.licence || '').trim()) {
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

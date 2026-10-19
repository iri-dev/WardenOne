/* Release gate: published licenses and scoped grants count; specific exceptions block submission. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GRANT_DATE = /^\d{4}-\d{2}(?:-\d{2})?$/;

function documented(source) {
  if (!source || !source.name || !source.publisher || !/^https:\/\//.test(source.url || '')
    || !DATE.test(source.checkedAt || '') || !source.attribution
    || !source.evidence?.length || !source.evidence.every((e) => e.finding && (e.reference || /^https:\/\//.test(e.url || '')))
    || !source.compliance?.conditions?.length || !source.compliance.implementation?.length
    || !source.compliance.noticeFiles?.length || !Array.isArray(source.compliance.issueIds)) return false;
  const license = source.license, permission = source.permission;
  if (!license || !permission) return false;
  const published = license.type === 'published-license' && license.id && /^https:\/\//.test(license.url || '');
  const granted = permission.status === 'granted' && GRANT_DATE.test(permission.date || '')
    && permission.scope && permission.evidenceRef && permission.evidence;
  return !!(published || granted);
}

function unresolvedRights(inventory, fileHash = (file) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, file))).digest('hex')) {
  if (inventory?.schemaVersion !== 2 || !inventory.sources?.length || !inventory.generated?.length
    || !Array.isArray(inventory.buildSources)) return ['(source inventory missing, empty or obsolete)'];
  const issues = [];
  for (const source of [...inventory.sources, ...inventory.buildSources]) {
    if (!documented(source) || source.compliance.status !== 'implemented' || source.compliance.issueIds.length) {
      issues.push(source.url || '(unnamed source)');
    }
  }
  for (const artifact of inventory.generated) {
    let matches = false;
    try { matches = /^[0-9a-f]{64}$/.test(artifact.sha256 || '') && fileHash(artifact.file) === artifact.sha256; } catch (_) {}
    if (!matches || !artifact.license || !artifact.provenance || !artifact.modifications
      || artifact.compliance?.status !== 'implemented' || !artifact.compliance.noticeFiles?.length
      || !Array.isArray(artifact.compliance.issueIds) || artifact.compliance.issueIds.length) issues.push(artifact.file || '(unnamed artifact)');
  }
  return issues;
}
if (require.main === module) {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/source-inventory.json'), 'utf8'));
  const issues = unresolvedRights(inventory);
  if (issues.length) {
    console.error('Store submission blocked by ' + issues.length + ' specific source exception(s). See docs/source-rights-review.md.');
    issues.forEach((item) => console.error('  ' + item));
    process.exitCode = 1;
  } else console.log('Source license/permission conditions implemented for all inventoried inputs');
}
module.exports = { documented, unresolvedRights };

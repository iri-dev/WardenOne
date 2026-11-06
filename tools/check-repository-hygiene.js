/* Private reports and workspace state are excluded from public source distribution.
   Documents and regression data require explicit publication entries. */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TRACKED_HIDDEN_DIRS = ['.github'];
const TRACKED_HIDDEN_FILES = ['.gitattributes', '.gitignore', '.node-version'];
const PUBLICATION_POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/publication-policy.json'), 'utf8'));
if (PUBLICATION_POLICY.schemaVersion !== 1) throw new Error('Unsupported publication policy');
const PUBLIC_DOCUMENTS = new Set(PUBLICATION_POLICY.publicDocuments);
const PUBLIC_CONTRACTS = new Set(PUBLICATION_POLICY.publicTestContracts);
const PUBLIC_FIXTURES = new Set(PUBLICATION_POLICY.publicTestFixtures);
const PRIVATE_NAMES = new Set(['cws-submission.md', 'maintainability.md']);

for (const [prefix, names] of [['docs/', PUBLICATION_POLICY.publicDocuments],
  ['tools/contracts/', PUBLICATION_POLICY.publicTestContracts],
  ['tools/fixtures/', PUBLICATION_POLICY.publicTestFixtures]]) {
  if (!Array.isArray(names) || new Set(names).size !== names.length
    || names.some(name => !name.startsWith(prefix) || name.includes('\\')
      || name.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('Invalid public file inventory: ' + prefix);
  }
}

function localStatePath(name) {
  const top = name.split('/')[0];
  if (!top.startsWith('.')) return false;
  return name.includes('/') ? !TRACKED_HIDDEN_DIRS.includes(top) : !TRACKED_HIDDEN_FILES.includes(top);
}

function forbiddenPaths(paths) {
  return paths.filter((name) => {
    const normalized = name.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();
    const base = path.posix.basename(lower);
    return localStatePath(normalized) || PRIVATE_NAMES.has(base)
      || /^(?:audit-|theft-)/.test(base) && /\.(?:md|html?|json)$/.test(base)
      || /(?:^|[-_])audit(?:[-_.]|$)/.test(base) && /\.(?:md|html?|json)$/.test(base)
      || /(?:^|[-_])evidence(?:[-_.]|$)/.test(base) && /\.json$/.test(base)
        && !PUBLIC_FIXTURES.has(normalized)
      || lower.startsWith('docs/') && !PUBLIC_DOCUMENTS.has(normalized)
      || lower.startsWith('tools/contracts/') && !PUBLIC_CONTRACTS.has(normalized)
      || lower.startsWith('tools/fixtures/') && !PUBLIC_FIXTURES.has(normalized);
  });
}

function publicContract(name, value) {
  const keys = (object, expected) => object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).sort().join('\n') === [...expected].sort().join('\n');
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const digest = value => keys(value, ['characters', 'sha256'])
    && Number.isSafeInteger(value.characters) && value.characters >= 0 && hash(value.sha256);
  if (name !== 'tools/contracts/protection-regressions.json') {
    return keys(value, ['schemaVersion', 'sha256']) && value.schemaVersion === 1 && hash(value.sha256);
  }
  return keys(value, ['schemaVersion', 'dimensions', 'scope', 'features']) && value.schemaVersion === 1
    && digest(value.scope) && Array.isArray(value.dimensions) && value.dimensions.length > 0
    && value.dimensions.every(name => typeof name === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(name))
    && Array.isArray(value.features) && value.features.length > 0 && value.features.every(feature =>
      keys(feature, ['feature', 'dimensions']) && typeof feature.feature === 'string'
      && /^[a-z][a-zA-Z0-9]*$/.test(feature.feature) && keys(feature.dimensions, value.dimensions)
      && Object.values(feature.dimensions).every(cell => keys(cell, ['notApplicable'])
        ? digest(cell.notApplicable)
        : keys(cell, ['tests', 'scope']) && digest(cell.scope) && Array.isArray(cell.tests)
          && cell.tests.length > 0 && cell.tests.every(test => /^tools\/test-[a-z0-9-]+\.js$/.test(test))));
}

function check() {
  const result = spawnSync('git', ['ls-files', '--cached', '-z'],
    { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot read the staged file inventory');
  const tracked = result.stdout.split('\0').filter(Boolean);
  const forbidden = forbiddenPaths(tracked);
  if (forbidden.length) throw new Error('Remove private files from the index: ' + forbidden.join(', '));
  for (const file of tracked.filter(name => PUBLIC_CONTRACTS.has(name))) {
    const content = spawnSync('git', ['show', ':' + file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 });
    let valid = false;
    try { valid = content.status === 0 && publicContract(file, JSON.parse(content.stdout)); } catch (_) {}
    if (!valid) throw new Error('Public contract must contain hashes and test mappings, not a full report: ' + file);
  }
  console.log('Repository hygiene: no private files staged');
}

module.exports = { forbiddenPaths, localStatePath, publicContract, check };
if (require.main === module) {
  try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

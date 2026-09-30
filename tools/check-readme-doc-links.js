/* Catch README links to docs that exist locally but were not staged for GitHub. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function linkedDocs(readme) {
  const links = new Set();
  const re = /(?:\]\(\s*<?|(?:href|src)\s*=\s*["'])(docs\/[^\s)>"']+)/g;
  for (const match of readme.matchAll(re)) {
    const target = decodeURIComponent(match[1].split(/[?#]/)[0]);
    if (target.startsWith('docs/')) links.add(target);
  }
  return [...links].sort();
}

function missingLinkedDocs(readme, tracked, exists) {
  return linkedDocs(readme).filter((target) => target.endsWith('/')
    ? ![...tracked].some((name) => name.startsWith(target)) || !exists(target)
    : !tracked.has(target) || !exists(target));
}

function check() {
  const listing = spawnSync('git', ['ls-files', '--cached', '-z', '--', 'docs'],
    { cwd: ROOT, encoding: 'utf8' });
  if (listing.status !== 0) throw new Error('Cannot read the staged document inventory');
  const tracked = new Set(listing.stdout.split('\0').filter(Boolean));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const missing = missingLinkedDocs(readme, tracked,
    (target) => fs.existsSync(path.join(ROOT, target)));
  if (missing.length) throw new Error('README links to missing or untracked docs: ' + missing.join(', '));
  console.log('README document links: ' + linkedDocs(readme).length + ' tracked targets');
}

module.exports = { linkedDocs, missingLinkedDocs, check };
if (require.main === module) {
  try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

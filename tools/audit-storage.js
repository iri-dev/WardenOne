/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/storage-inventory.json');
function generate() {
  const scripts = fs.readdirSync(root).filter(f => f.endsWith('.js')).sort();
  const sources = Object.fromEntries(scripts.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const source = sources['background.js'];
  const start = source.indexOf('const PRIVACY_STORE_POLICY = '), end = source.indexOf('const PRIVACY_STORE_BY_KEY', start);
  if (start < 0 || end < start) throw Error('Missing privacy store policy');
  const policies = vm.runInNewContext(source.slice(start, end) + ';JSON.stringify(PRIVACY_STORE_POLICY)');
  const entries = JSON.parse(policies).flatMap(policy => policy.keys.map(key => ({ key, ...policy, keys: undefined,
    includes: policy.sensitivity, byteLimit: 'No universal per-key byte cap; inspect reports current UTF-8 JSON bytes. Feature count and body limits apply.',
    incognito: ['browsing records', 'derived browsing evidence', 'derived script evidence', 'browsing-derived cache', 'security records'].includes(policy.sensitivity)
      ? 'Persistent writes suppressed in split private worker; Activity and notifications are also suppressed in session storage.'
      : 'Shared settings/public intelligence where applicable; session-only operation state belongs to its worker context.',
    fullErase: 'Cleared by Reset WardenOne; selected primitive settings may be preserved by explicit reset mode.', references: [] })));
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const unregistered = new Set(), browserStorageSites = [], declaredLimits = {};
  for (const [file, text] of Object.entries(sources)) {
    const seen = new Set();
    for (const match of text.matchAll(/\b(?:__)?wardenone_[a-z0-9_]+\b/g)) {
      const entry = byKey.get(match[0]);
      if (!entry) unregistered.add(match[0]);
      else if (!seen.has(match[0])) { entry.references.push({ file, line: text.slice(0, match.index).split('\n').length }); seen.add(match[0]); }
    }
    for (const match of text.matchAll(/\b(?:(?:localStorage|sessionStorage)\.(?:setItem|getItem|removeItem|clear)|indexedDB\.(?:open|deleteDatabase)|caches\.(?:open|delete)|chrome\.storage\.sync\.(?:get|set|remove|clear))\s*\(/g))
      browserStorageSites.push({ file, line: text.slice(0, match.index).split('\n').length,
        operation: match[0].replace(/\s*\($/, ''), expression: text.slice(match.index, Math.min(text.length, match.index + 160)).split('\n')[0] });
    for (const match of text.matchAll(/(?:const|var) ([A-Z_]*(?:TTL_MS|CACHE_MS|CACHE_MAX|RETENTION_MS|HISTORY_CAP|MAX_ITEMS|MAX_SITES|MAX_DOMAINS|RECORD_MAX|REVIEW_MAX)) = ([\d\s*+.-]+);/g)) {
      const value = vm.runInNewContext(match[2]);
      if (Number.isFinite(value)) declaredLimits[match[1]] = { value, file };
    }
  }
  const cache = (key, maxItems, reuse) => Object.assign(byKey.get(key), { maxItems, reuse,
    retention: 'Expired cache entries are not reused. Pruned on cache maintenance/write or explicit erasure; no exact idle-profile deletion deadline.' });
  cache('wardenone_domain_age_cache', 100, '7 days');
  cache('wardenone_whoisxml_cache', 250, '7 days');
  cache('wardenone_safe_browsing_cache', 800, 'Clean 15 minutes; hit 5 minutes');
  cache('wardenone_phishtank_cache', 1200, 'Clean 20 minutes; hit 6 hours');
  cache('wardenone_abuseipdb_cache', 1200, 'Clean 12 hours; warning/hit 4 hours');
  cache('wardenone_urlhaus_cache', 1200, 'Clean 1 hour; hit 12 hours');
  cache('wardenone_whoisxml_reputation_cache', 800, 'Clean 12 hours; warning/hit 6 hours');
  cache('wardenone_whoisxml_threat_cache', 800, 'Clean 12 hours; hit 6 hours');
  cache('wardenone_breach_cache', null, '12 hours; no explicit global entry cap');
  return { schemaVersion: 1, entries: entries.sort((a, b) => a.key.localeCompare(b.key)),
    unregistered: [...unregistered].sort(), browserStorageSites, declaredLimits,
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, crypto.createHash('sha256').update(text).digest('hex')])),
    dynamicKeys: [{ prefix: 'wardenone_warning:', policy: 'wardenone_warning', contains: 'Exact destination URL needed for current warning navigation; random handle in page URL.' }],
    scope: 'Extension datasets plus a census of DOM storage/IndexedDB/cache operations. Page-storage hooks that inspect or clear website-owned data are not extension datasets. See docs/data-minimisation-audit.md.' };
}
if (require.main === module) {
  const data = generate();
  if (data.unregistered.length) throw Error('Unregistered stores: ' + data.unregistered.join(', '));
  const json = JSON.stringify(data, null, 2) + '\n';
  if (process.argv.includes('--write')) fs.writeFileSync(output, json);
  else if (fs.readFileSync(output, 'utf8') !== json) throw Error('Storage inventory is stale; run tools/audit-storage.js --write');
  console.log('[ok] ' + data.entries.length + ' registered storage keys and ' + data.browserStorageSites.length + ' DOM storage sites inventoried');
}
module.exports = { generate, output };

/* Inventory drift and trust-boundary metadata regressions. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build, runtimeFeeds } = require('./build-source-inventory.js');
const { documented, unresolvedRights } = require('./check-store-rights.js');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const bg = read('background.js');
const inventory = JSON.parse(read('docs/source-inventory.json'));
const metadata = JSON.parse(read('docs/source-licensing.json'));
assert.deepStrictEqual(build(), inventory);

/* Independently inspect every URL in the feed declaration region, including future arrays. */
const declaration = bg.slice(bg.indexOf('const REMOTE_LISTS = ['), bg.indexOf('// ======================= AdShield cosmetic engine'));
const expected = new Set([...declaration.matchAll(/^\s*(?:url:\s*)?'(https:\/\/[^']+)'/gm)].map((m) => m[1]));
for (const m of bg.matchAll(/^const \w*(?:FEED_URL|LIST_URL|MANIFEST_URL) = '(https:\/\/[^']+)';/gm)) expected.add(m[1]);
assert.deepStrictEqual(new Set(inventory.sources.map((s) => s.url)), expected);
assert.strictEqual(inventory.summary.runtimeFeeds, expected.size);
assert.strictEqual(inventory.sources.length, expected.size);
assert.deepStrictEqual(new Set(runtimeFeeds(bg).map((s) => s.url)), expected);
const extra = bg.replace('const REMOTE_LISTS = [', "const REMOTE_LISTS = [\n  'https://example.test/undocumented.txt',");
assert.throws(() => build(metadata, extra), /Document the exact new source/);
const changed = bg.replace(inventory.sources[0].url, 'https://example.test/replacement.txt');
assert.throws(() => build(metadata, changed), /Document the exact new source/);
const duplicate = JSON.parse(JSON.stringify(metadata));
duplicate.profiles.adaway.urls.push(duplicate.profiles.blocklist.urls[0]);
assert.throws(() => build(duplicate), /Duplicate source policy/);
const stale = JSON.parse(JSON.stringify(metadata));
stale.profiles.adaway.urls.push('https://example.test/retired.txt');
assert.throws(() => build(stale), /Stale policy URL/);
assert.throws(() => runtimeFeeds(bg + '\nconst NEW_LISTS = [];'), /Register the new feed array/);
assert.throws(() => runtimeFeeds(bg.replace('const REMOTE_LISTS = [', 'const REMOTE_LISTS = [\n  ...generatedFeeds,')), /document dynamic generation/);
const undated = JSON.parse(JSON.stringify(metadata));
delete undated.profiles.adaway.checkedAt;
assert.throws(() => build(undated), /Missing source review date/);

const statuses = new Set(['implemented','clarification-required','restricted-or-incompatible']);
for (const source of [...inventory.sources, ...inventory.buildSources]) {
  assert(statuses.has(source.compliance.status), source.url);
  assert(source.evidence.length && source.evidence.every((e) => e.finding && (e.reference || /^https:\/\//.test(e.url))), source.url);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt));
  assert(source.license && source.permission && source.attribution && source.compliance.conditions.length);
  if (source.compliance.status === 'implemented') assert(documented(source), source.url);
  else assert(source.compliance.issueIds.length, source.url);
  assert(!('licenceVerified' in source), 'Unrelated decisions must not collapse into a boolean');
  assert(read('THIRD_PARTY_NOTICES.html').includes(source.name.replace(/&/g,'&amp;').replace(/’/g,'’')));
}
const grants = inventory.sources.filter((s) => s.permission.status === 'granted');
assert.strictEqual(grants.length, 7);
for (const [id, date, scope] of [['discord','2026-10-15','Direct runtime'],['peter','2026-10','direct pgl'],['army','2026-10','Chrome Web Store'],['flinteger','2026-10-16','upstream'],['hagezi','2026-10-20','GPLv3']]) {
  const source = grants.find((s) => s.policyId === id);
  assert(source && source.permission.date === date && source.permission.scope.includes(scope), id);
}
const hagezi = inventory.sources.filter((s) => s.policyId === 'hagezi');
assert.strictEqual(hagezi.length, metadata.profiles.hagezi.urls.length);
assert(hagezi.every((s) => s.license.type === 'published-license' && s.license.id === 'GPL-3.0'
  && s.permission.status === 'granted' && s.permission.evidenceRef === 'permission-hagezi-2026-10-20'
  && s.compliance.status === 'implemented' && s.compliance.issueIds.length === 0));
assert.deepStrictEqual(inventory.sources.find((s) => s.policyId === 'peter').toggles.sort(), ['adShield','blockTrackers']);
const snapshot = JSON.parse(read('cosmetic-rules.json'));
const all = new Set([...inventory.sources, ...inventory.buildSources].map((s) => s.url));
for (const input of snapshot.sources) assert(all.has(input.url), input.url);
for (const artifact of inventory.generated) {
  assert(fs.existsSync(path.join(ROOT, artifact.file)));
  if (artifact.builtBy) assert(fs.existsSync(path.join(ROOT, artifact.builtBy)));
  for (const file of artifact.sourceFiles) assert(fs.existsSync(path.join(ROOT, file)));
}
const manifest = JSON.parse(read('manifest.json'));
for (const rule of manifest.declarative_net_request.rule_resources) assert(inventory.generated.some((a) => a.file === rule.path), rule.path);
const credits = read('CREDITS.md');
for (const entry of ['- **AdGuard Filters**','- **TwitchAdSolutions** (pixeltris)','- **EasyList & EasyPrivacy**','- **uBlock-Origin-dev-filter** (quenhus)']) assert(credits.includes(entry));
assert(credits.includes('<!-- BEGIN GENERATED SOURCE INVENTORY -->'));
assert(!/not yet verified|terms under review|blank licence|review .*still open/i.test(credits));
for (const file of metadata.licenseFiles) assert(read('THIRD_PARTY_NOTICES.html').includes(path.basename(file)));
assert(/credits: 'THIRD_PARTY_NOTICES.html'/.test(read('settings.js')));
assert(!require('./build-store-package.js').NON_RUNTIME.some((re) => re.test('CREDITS.md')));
assert(!require('./build-store-package.js').NON_RUNTIME.some((re) => re.test('THIRD_PARTY_NOTICES.html')));
const exceptions = inventory.sources.filter((s) => s.compliance.status !== 'implemented').map((s) => s.url).sort();
assert.deepStrictEqual(unresolvedRights(inventory).sort(), exceptions);
console.log('Source inventory: runtime/build coverage, exact URL matching, scoped grants, offline notices and specific release exceptions verified');

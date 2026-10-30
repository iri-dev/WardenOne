/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'docs/cname-source-snapshot.json.gz');
const OUT = path.join(ROOT, 'cname-trackers.json');
const CATALOG = path.join(ROOT, 'rules-cname.json');
const CNAME_SOURCE_URL = 'https://github.com/AdguardTeam/cname-trackers';
const TRACKERS = 'data/trackers/';
/* The small runtime mapping keeps its reviewed four-provider scope for logging and learning. */
const FILES = ['eulerian', 'etracker', 'webtrekk', 'at-internet-(formerly-xiti)'].map(name => TRACKERS + name + '.json');
/* Every AdGuard tracker provider, reviewed. 'hosted' providers also serve landing pages and forms
   from their aliases, so those aliases stay usable as initiators. 'cookies' providers carry a
   user-facing function (fraud checks at sign-in, tag and consent managers WardenOne does not block
   as third parties), so their aliases lose cookies instead of being blocked. */
const PROVIDERS = Object.freeze({
  '2cnt_net': 'block', 'a8_net': 'block', 'act-on': 'hosted', 'actioniq': 'block', 'actionlink_jp': 'block',
  'acweb-inc': 'block', 'ad-ebis': 'block', 'adobe-experience-cloud-(formerly-omniture)': 'block', 'affilbox_cz': 'block',
  'at-internet-(formerly-xiti)': 'block', 'commanders-act': 'cookies', 'content-ignite': 'block', 'criteo': 'block',
  'customerlabs': 'block', 'datafast': 'block', 'dataunlocker': 'block', 'edgetag': 'block', 'ensighten': 'block',
  'etracker': 'block', 'eulerian': 'block', 'fathom': 'block', 'geniee': 'block', 'gmo-internet-group': 'block',
  'goatcounter': 'block', 'infonline': 'block', 'ingenious-technologies': 'block', 'keyade': 'block', 'kib_hu': 'block',
  'lead-forensics': 'block', 'lexisnexis-risk-solutions': 'cookies', 'np6': 'hosted', 'otto-group': 'block',
  'parse_ly': 'block', 'piwik-pro': 'block', 'plausible-analytics': 'block', 'proxyhog': 'block', 'redtrack': 'block',
  'stape': 'block', 'truedata': 'block', 'utiq': 'block', 'webtrekk': 'block', 'wecantrack': 'block', 'wizaly': 'block',
});
/* At least this many distinct listed children under one non-site parent is wildcard DNS evidence. */
const FAMILY_MIN = 20;
const CATALOG_LIMITS = Object.freeze({ rules: 120, regexRules: 1000, hosts: 250000, bytes: 6 * 1024 * 1024 });
const COOKIE_ACTION = Object.freeze({ type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'remove' }],
  responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] });
const LICENSE_HASH = 'e23d10fa7c575455386707b4a176c82f24bb5e2f';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const licenseHash = text => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');

function helpers() {
  const context = vm.createContext({ URL, console });
  for (const file of ['domain-utils.js', 'psl-private.js', 'cname-utils.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
  return vm.runInContext('({WOCname, siteIdentity, normalizeSiteTarget})', context);
}

function shippedLiteral(source, pattern, name) {
  const match = source.match(pattern);
  if (!match) throw new Error('Missing ' + name + ' in background.js');
  return vm.runInNewContext(match[1]);
}

/* Mirrors isProtectedTrackerDomain and isMediaCompatDomain; tools/test-cname-catalog.js runs the
   shipped functions over the output to catch drift. */
function compatibility({ normalizeSiteTarget }) {
  const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const login = shippedLiteral(background, /const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = (\[[\s\S]*?\]);/, 'login compatibility hosts');
  const media = shippedLiteral(background, /const MEDIA_COMPAT_DOMAINS = new Set\((\[[\s\S]*?\])\);/, 'media compatibility hosts');
  const sites = new Set(shippedLiteral(background, /const TRACKER_PROTECTED_DOMAINS = new Set\((\[[\s\S]*?\])\);/, 'protected tracker sites'));
  const own = shippedLiteral(background, /function ownProviderDomains\(\) \{[\s\S]*?for \(const host of (\[[\s\S]*?\])\)/, 'own provider hosts');
  for (const host of login) sites.add(normalizeSiteTarget(host) || host);
  for (const host of own) { const site = normalizeSiteTarget(host); if (site) sites.add(site); }
  const isMedia = host => media.some(domain => host === domain || host.endsWith('.' + domain));
  const isProtected = (host, site = normalizeSiteTarget(host)) =>
    !site || sites.has(site) || /(^|\.)((gov|edu|mil)\.[a-z]{2}|gov|edu|mil)$/i.test(site) || isMedia(host);
  return { isProtected, excludedInitiatorDomains: [...new Set([...login, ...media])].sort() };
}

function checkSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== 2 || !/^[0-9a-f]{40}$/.test(snapshot.revision || '')
      || typeof snapshot.license !== 'string' || licenseHash(snapshot.license) !== LICENSE_HASH
      || !Array.isArray(snapshot.files) || !snapshot.files.length) throw new Error('Invalid source snapshot');
  const paths = snapshot.files.map(file => file.path);
  if (paths.join('\n') !== [...paths].sort().join('\n') || new Set(paths).size !== paths.length) throw new Error('Unordered source snapshot');
  for (const file of snapshot.files) {
    if (!file.path.startsWith(TRACKERS) || !file.path.endsWith('.json') || sha256(file.text) !== file.sha256) throw new Error('CNAME source hash mismatch');
    const stem = file.path.slice(TRACKERS.length, -5);
    if (!Object.hasOwn(PROVIDERS, stem)) throw new Error('Unreviewed CNAME provider: ' + stem);
  }
  for (const stem of Object.keys(PROVIDERS)) if (!paths.includes(TRACKERS + stem + '.json')) throw new Error('Reviewed CNAME provider missing upstream: ' + stem);
}

function records(file) {
  const parsed = JSON.parse(file.text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid source mapping: ' + file.path);
  return Object.entries(parsed);
}

function runtimeMapping(snapshot, { WOCname, siteIdentity }) {
  const rows = [], omitted = [];
  for (const name of FILES) {
    const file = snapshot.files.find(entry => entry.path === name);
    if (!file) throw new Error('Missing runtime CNAME provider ' + name);
    for (const [rawAlias, rawTarget] of records(file)) {
      const alias = WOCname.normalizeHost(rawAlias), target = WOCname.normalizeHost(rawTarget);
      if (!alias || !target) throw new Error('Malformed source hostname: ' + rawAlias);
      if (alias === siteIdentity(alias)) { omitted.push(alias); continue; }
      rows.push([alias, target]);
    }
  }
  return { entries: [...WOCname.validateEntries(rows)], omittedApexHosts: [...new Set(omitted)].sort() };
}

function catalog(snapshot, tools) {
  const { WOCname, siteIdentity } = tools;
  const { isProtected, excludedInitiatorDomains } = compatibility(tools);
  const skipped = { malformed: 0, apex: 0, sameSite: 0, protected: 0, conflicting: 0 };
  const hosts = new Map(), providers = {};
  /* Targets repeat heavily; public-suffix lookups dominate the build otherwise. */
  const targets = new Map();
  const targetOf = raw => {
    if (!targets.has(raw)) {
      const host = WOCname.normalizeHost(raw), site = host && siteIdentity(host);
      targets.set(raw, host && { site, protected: isProtected(host, site) });
    }
    return targets.get(raw);
  };
  for (const file of snapshot.files) {
    const stem = file.path.slice(TRACKERS.length, -5), tier = PROVIDERS[stem];
    const count = providers[stem] = { tier, listed: 0, hosts: 0, families: 0 };
    for (const [rawAlias, rawTarget] of records(file)) {
      count.listed++;
      const alias = WOCname.normalizeHost(rawAlias), target = targetOf(rawTarget);
      if (!alias || !target) { skipped.malformed++; continue; }
      const site = siteIdentity(alias);
      if (alias === site) { skipped.apex++; continue; }
      if (site === target.site) { skipped.sameSite++; continue; }
      if (isProtected(alias, site) || target.protected) { skipped.protected++; continue; }
      const prior = hosts.get(alias);
      if (prior && prior.stem !== stem) skipped.conflicting++;
      /* A host listed by two providers takes the gentler treatment. */
      if (!prior || rank(tier) < rank(prior.tier)) hosts.set(alias, { stem, tier });
    }
  }
  const children = new Map();
  for (const [alias, { stem, tier }] of hosts) {
    const key = stem + ' ' + alias.slice(alias.indexOf('.') + 1);
    if (!children.has(key)) children.set(key, { stem, tier, parent: key.slice(stem.length + 1), count: 0 });
    children.get(key).count++;
  }
  const families = new Map();
  for (const { stem, tier, parent, count } of children.values()) {
    if (count >= FAMILY_MIN && siteIdentity(parent) !== parent && !isProtected(parent)) families.set(parent, { stem, tier });
  }
  const ancestorFamily = host => {
    for (let h = host.slice(host.indexOf('.') + 1); h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (families.has(h)) return families.get(h);
    return null;
  };
  for (const parent of [...families.keys()]) if (ancestorFamily(parent)?.tier === families.get(parent).tier) families.delete(parent);
  const groups = new Map();
  const add = (host, { stem, tier }, kind) => {
    const depth = host.split('.').length, key = [rank(tier), tier, kind, String(depth).padStart(3, '0')].join('|');
    if (!groups.has(key)) groups.set(key, { tier, kind, depth, hosts: [] });
    groups.get(key).hosts.push(host);
    providers[stem][kind === 'family' ? 'families' : 'hosts']++;
  };
  for (const [parent, entry] of families) add(parent, entry, 'family');
  for (const [alias, entry] of hosts) if (ancestorFamily(alias)?.tier !== entry.tier) add(alias, entry, 'exact');
  const rules = [...groups.keys()].sort().map((key, index) => {
    const { tier, kind, depth, hosts: list } = groups.get(key);
    list.sort();
    const excluded = tier === 'hosted' ? [...new Set([...excludedInitiatorDomains, ...list])].sort() : excludedInitiatorDomains;
    return { id: index + 1, priority: WOCname.rulePriority, action: tier === 'cookies' ? COOKIE_ACTION : { type: 'block' },
      condition: { requestDomains: list, regexFilter: kind === 'family' ? WOCname.descendantRegex(depth) : WOCname.exactHostRegex(depth),
        resourceTypes: WOCname.resourceTypes, excludedInitiatorDomains: excluded } };
  });
  const text = JSON.stringify(rules) + '\n';
  const count = action => rules.filter(rule => (rule.action.type === 'block') === action)
    .reduce((total, rule) => total + rule.condition.requestDomains.length, 0);
  const summary = { sha256: sha256(text), rules: rules.length, blockedHosts: count(true), cookieHosts: count(false), families: families.size };
  if (rules.length > CATALOG_LIMITS.rules || summary.blockedHosts + summary.cookieHosts > CATALOG_LIMITS.hosts
      || Buffer.byteLength(text) > CATALOG_LIMITS.bytes) throw new Error('CNAME catalog exceeds its budget');
  return { rules, text, summary, report: { revision: snapshot.revision, skipped, providers } };
}

function rank(tier) { return tier === 'cookies' ? 0 : tier === 'hosted' ? 1 : 2; }

function buildAll(snapshot) {
  checkSnapshot(snapshot);
  const tools = helpers();
  const result = catalog(snapshot, tools);
  const runtime = runtimeMapping(snapshot, tools);
  const data = { schema: 1, source: 'AdGuard CNAME trackers', revision: snapshot.revision, updatedAt: snapshot.updatedAt,
    license: 'MIT', entries: runtime.entries, omittedApexHosts: runtime.omittedApexHosts, catalog: result.summary };
  tools.WOCname.validateData(data);
  return { data, catalogText: result.text, report: result.report };
}

function build(snapshot) { return buildAll(snapshot).data; }

async function readRemote(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error('CNAME source HTTP ' + response.status);
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > maxBytes) throw new Error('CNAME source size exceeded');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function refresh() {
  const repository = new URL(CNAME_SOURCE_URL).pathname;
  const ref = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/ref/heads/master', 16 * 1024));
  const revision = ref.object?.sha;
  if (!/^[0-9a-f]{40}$/.test(revision || '')) throw new Error('Missing source revision');
  const commit = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/commits/' + revision, 64 * 1024));
  const tree = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/trees/' + revision + '?recursive=1', 4 * 1024 * 1024));
  if (tree.truncated) throw new Error('Truncated source tree');
  const paths = tree.tree.filter(entry => entry.type === 'blob' && /^data\/trackers\/[^/]+\.json$/.test(entry.path)).map(entry => entry.path).sort();
  if (!paths.length || paths.length > 200) throw new Error('Unexpected CNAME provider count');
  const prefix = 'https://raw.githubusercontent.com' + repository + '/' + revision + '/';
  const license = await readRemote(prefix + 'LICENSE', 4096);
  if (licenseHash(license) !== LICENSE_HASH) throw new Error('Upstream license changed; review before updating');
  const files = [];
  let total = 0;
  for (const file of paths) {
    const text = await readRemote(prefix + encodeURI(file), 32 * 1024 * 1024);
    total += text.length;
    if (total > 96 * 1024 * 1024) throw new Error('CNAME source size exceeded');
    files.push({ path: file, text, sha256: sha256(text) });
  }
  const snapshot = { schema: 2, revision, updatedAt: commit.committer.date, license, files };
  const built = buildAll(snapshot);
  fs.writeFileSync(SNAPSHOT, zlib.gzipSync(JSON.stringify(snapshot), { level: 9 }));
  fs.writeFileSync(OUT, JSON.stringify(built.data) + '\n');
  fs.writeFileSync(CATALOG, built.catalogText);
}

function readSnapshot() {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(SNAPSHOT), { maxOutputLength: 128 * 1024 * 1024 }));
}

async function main(args) {
  if (args.length !== 1 || !['--check', '--build', '--refresh', '--report'].includes(args[0])) throw new Error('Use --check, --build, --refresh or --report');
  if (args[0] === '--refresh') await refresh();
  const built = buildAll(readSnapshot());
  const output = JSON.stringify(built.data) + '\n';
  if (args[0] === '--report') { console.log(JSON.stringify({ ...built.report, catalog: built.data.catalog }, null, 2)); return; }
  if (args[0] === '--build') { fs.writeFileSync(OUT, output); fs.writeFileSync(CATALOG, built.catalogText); }
  else if (fs.readFileSync(OUT, 'utf8') !== output || fs.readFileSync(CATALOG, 'utf8') !== built.catalogText) throw new Error('CNAME data differs from its source snapshot');
  console.log('[ok] CNAME mapping and catalog match their pinned, licensed source');
}
module.exports = { build, buildAll, helpers, readSnapshot, compatibility, FILES, PROVIDERS, FAMILY_MIN, sha256 };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });

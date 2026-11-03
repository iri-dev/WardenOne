/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Privacy Badger's pre-trained tracker list (EFF, GPL-3.0-or-later) as the static ruleset
   rules-badger.json, applied the way Privacy Badger applies it: third-party requests only, sister
   sites of one owner exempt, and cookie-only, DNT-policy, yellowlisted, surrogate and widget hosts
   left loading because WardenOne has no stand-in for them.
   node tools/build-badger-dnr.js --check | --build | --refresh | --report */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { helpers, compatibility, sha256 } = require('./build-cname-data.js');
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'docs/badger-source-snapshot.json.gz');
const RULESET = path.join(ROOT, 'rules-badger.json');
const SITES = path.join(ROOT, 'first-party-sites.json');
const BADGER_SOURCE_URL = 'https://github.com/EFForg/privacybadger';
const FILES = Object.freeze(['LICENSE', 'src/data/pbconfig.json', 'src/data/seed.json', 'src/data/socialwidgets.json',
  'src/data/surrogates.js', 'src/js/multiDomainFirstParties.js']);
const LICENSE_HASH = '26d6112b2f632f5ee9a6df568b7eb15f250d3f47';
/* Same types and priority as rules-easyprivacy.json, so the 1900 compatibility allows outrank it. */
const RESOURCE_TYPES = Object.freeze(['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']);
const PRIORITY = 1000;
const BATCH = 1000;
const LIMITS = Object.freeze({ rules: 200, hosts: 6000, bytes: 640 * 1024 });
const licenseHash = text => require('crypto').createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');

function checkSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== 1 || !/^[0-9a-f]{40}$/.test(snapshot.revision || '') || !Array.isArray(snapshot.files)
      || JSON.stringify(snapshot.files.map(file => file.path)) !== JSON.stringify(FILES)) throw new Error('Invalid Privacy Badger snapshot');
  for (const file of snapshot.files) if (sha256(file.text) !== file.sha256) throw new Error('Privacy Badger source hash mismatch: ' + file.path);
  if (licenseHash(text(snapshot, 'LICENSE')) !== LICENSE_HASH) throw new Error('Privacy Badger license changed; review before updating');
}

function text(snapshot, name) { return snapshot.files.find(file => file.path === name).text; }

function upstream(snapshot, normalizeHost) {
  const seed = JSON.parse(text(snapshot, 'src/data/seed.json')).action_map;
  const yellowlist = JSON.parse(text(snapshot, 'src/data/pbconfig.json')).yellowlist;
  const widgets = JSON.parse(text(snapshot, 'src/data/socialwidgets.json'));
  const surrogates = text(snapshot, 'src/data/surrogates.js');
  const table = /const hostnames = \{([\s\S]*?)\n\};/.exec(surrogates);
  const entities = /let multiDomainFirstPartiesArray = (\[[\s\S]*?\n\]);/.exec(text(snapshot, 'src/js/multiDomainFirstParties.js'));
  if (!seed || !Array.isArray(yellowlist) || !table || !entities) throw new Error('Unexpected Privacy Badger data layout');
  const hosts = list => list.map(raw => normalizeHost(String(raw).replace(/^\*\./, ''))).filter(Boolean);
  const blocked = [], spared = new Map();
  const spare = (list, reason) => { for (const host of hosts(list)) if (!spared.has(host)) spared.set(host, reason); };
  for (const [domain, entry] of Object.entries(seed)) {
    if (entry.dnt) spare([domain], 'dnt');
    else if (entry.heuristicAction === 'cookieblock') spare([domain], 'cookieblock');
    else if (entry.heuristicAction === 'block') blocked.push(domain);
  }
  spare(yellowlist, 'yellowlist');
  spare([...table[1].matchAll(/^ {2}'([^']+)': \{/gm)].map(match => match[1]), 'surrogate');
  spare(Object.values(widgets).flatMap(widget => [widget.domain, ...(widget.domains || []),
    ...((widget.replacementButton && widget.replacementButton.unblockDomains) || [])].filter(Boolean)), 'widget');
  /* Site fixes: "ignore" and "yellowlist" both stop a tracker being blocked on the named sites. */
  const fixes = new Map();
  const sitefixes = JSON.parse(text(snapshot, 'src/data/pbconfig.json')).sitefixes || {};
  for (const kind of ['ignore', 'yellowlist']) {
    for (const [pattern, sites] of Object.entries(sitefixes[kind] || {})) {
      const host = normalizeHost(pattern);
      if (!host) continue;
      if (!fixes.has(host)) fixes.set(host, new Set());
      for (const site of hosts(sites)) fixes.get(host).add(site);
    }
  }
  return { blocked, spared, fixes, entities: vm.runInNewContext(entities[1]) };
}

function ancestors(host) {
  const out = [];
  for (let h = host.slice(host.indexOf('.') + 1); h.includes('.'); h = h.slice(h.indexOf('.') + 1)) out.push(h);
  return out;
}

function catalog(snapshot, tools) {
  const { WOCname, siteIdentity } = tools;
  const { isProtected, excludedInitiatorDomains } = compatibility(tools);
  const { blocked, spared, fixes, entities } = upstream(snapshot, WOCname.normalizeHost);
  const skipped = { malformed: 0, dnt: 0, cookieblock: 0, yellowlist: 0, surrogate: 0, widget: 0, protected: 0, covered: 0 };
  const candidates = new Set();
  for (const raw of blocked) {
    const host = WOCname.normalizeHost(raw);
    if (!host) { skipped.malformed++; continue; }
    /* Privacy Badger ranks cookie-only and DNT above block at every level of a name. */
    const reason = [host, ...ancestors(host)].map(h => spared.get(h)).find(Boolean);
    if (reason) { skipped[reason]++; continue; }
    if (isProtected(host)) { skipped.protected++; continue; }
    candidates.add(host);
  }
  const kept = [...candidates].filter(host => {
    const covered = ancestors(host).some(h => candidates.has(h));
    if (covered) skipped.covered++;
    return !covered;
  }).sort();
  const keptSet = new Set(kept);
  const chain = host => [host, ...ancestors(host)];
  /* A fixed tracker gets its own rule that skips the fixed sites, including fixes on its parents. */
  const fixed = [...fixes.keys()].filter(host => chain(host).some(h => keptSet.has(h)) && !chain(host).some(h => spared.has(h))).sort();
  const fixedSet = new Set(fixed);
  const owner = new Map();
  entities.forEach((list, index) => { for (const site of list) owner.set(site, index); });
  const entityOf = host => owner.has(siteIdentity(host)) ? owner.get(siteIdentity(host)) : -1;
  /* Hosts under this rule's blocks that stay loading: spared, separately fixed, or WardenOne's sign-in and media hosts. */
  const below = (list) => {
    const inList = new Set(list);
    return [...new Set([...[...spared.keys(), ...fixed].filter(host => ancestors(host).some(h => inList.has(h))),
      ...excludedInitiatorDomains.filter(host => chain(host).some(h => inList.has(h)))])].sort();
  };
  const rules = [];
  const push = (requestDomains, initiators, leftLoading) => {
    const condition = { requestDomains, domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES,
      excludedInitiatorDomains: [...new Set([...initiators, ...excludedInitiatorDomains])].sort() };
    if (leftLoading.length) condition.excludedRequestDomains = leftLoading;
    rules.push({ id: rules.length + 1, priority: PRIORITY, action: { type: 'block' }, condition });
  };
  const groups = new Map();
  for (const host of kept) {
    if (fixedSet.has(host)) continue;
    const entity = entityOf(host);
    if (!groups.has(entity)) groups.set(entity, []);
    groups.get(entity).push(host);
  }
  for (const entity of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(entity);
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      push(chunk, entity < 0 ? [] : entities[entity], below(chunk));
    }
  }
  for (const host of fixed) {
    const sites = chain(host).flatMap(h => [...(fixes.get(h) || [])]);
    push([host], entityOf(host) < 0 ? sites : [...sites, ...entities[entityOf(host)]], below([host]));
  }
  const ruleText = JSON.stringify(rules) + '\n';
  const summary = { sha256: sha256(ruleText), rules: rules.length, blockedHosts: rules.reduce((n, rule) => n + rule.condition.requestDomains.length, 0),
    ownerGroups: [...groups.keys()].filter(entity => entity >= 0).length, siteFixRules: fixed.length };
  if (rules.length > LIMITS.rules || summary.blockedHosts > LIMITS.hosts || Buffer.byteLength(ruleText) > LIMITS.bytes) {
    throw new Error('Privacy Badger ruleset exceeds its budget: ' + rules.length + ' rules, ' + summary.blockedHosts + ' hosts, ' + Buffer.byteLength(ruleText) + ' bytes');
  }
  /* Sister sites of one owner, for Smart Script Shield: a site's own CDN on another domain is not a stranger. */
  const sites = { schema: 1, source: BADGER_SOURCE_URL, revision: snapshot.revision,
    entities: entities.map((list) => [...new Set(list.map(WOCname.normalizeHost).filter(Boolean))].sort()).filter((list) => list.length > 1) };
  return { rules, text: ruleText, sitesText: JSON.stringify(sites) + '\n', summary,
    report: { revision: snapshot.revision, updatedAt: snapshot.updatedAt, trained: blocked.length, skipped } };
}

function buildAll(snapshot) {
  checkSnapshot(snapshot);
  return catalog(snapshot, helpers());
}

async function readRemote(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error('Privacy Badger source HTTP ' + response.status);
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > maxBytes) throw new Error('Privacy Badger source size exceeded');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function refresh() {
  const repository = new URL(BADGER_SOURCE_URL).pathname;
  const ref = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/ref/heads/master', 16 * 1024));
  const revision = ref.object && ref.object.sha;
  if (!/^[0-9a-f]{40}$/.test(revision || '')) throw new Error('Missing source revision');
  const commit = JSON.parse(await readRemote('https://api.github.com/repos' + repository + '/git/commits/' + revision, 64 * 1024));
  const prefix = 'https://raw.githubusercontent.com' + repository + '/' + revision + '/';
  const files = [];
  for (const file of FILES) {
    const body = await readRemote(prefix + file, 16 * 1024 * 1024);
    files.push({ path: file, text: body, sha256: sha256(body) });
  }
  const snapshot = { schema: 1, revision, updatedAt: commit.committer.date, files };
  const built = buildAll(snapshot);
  fs.writeFileSync(SNAPSHOT, zlib.gzipSync(JSON.stringify(snapshot), { level: 9 }));
  fs.writeFileSync(RULESET, built.text);
  fs.writeFileSync(SITES, built.sitesText);
}

function readSnapshot() {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(SNAPSHOT), { maxOutputLength: 64 * 1024 * 1024 }));
}

async function main(args) {
  if (args.length !== 1 || !['--check', '--build', '--refresh', '--report'].includes(args[0])) throw new Error('Use --check, --build, --refresh or --report');
  if (args[0] === '--refresh') await refresh();
  const built = buildAll(readSnapshot());
  if (args[0] === '--report') { console.log(JSON.stringify({ ...built.report, ruleset: built.summary }, null, 2)); return; }
  if (args[0] === '--build') { fs.writeFileSync(RULESET, built.text); fs.writeFileSync(SITES, built.sitesText); }
  else if (fs.readFileSync(RULESET, 'utf8') !== built.text || fs.readFileSync(SITES, 'utf8') !== built.sitesText) {
    throw new Error('rules-badger.json or first-party-sites.json differs from its source snapshot');
  }
  console.log('[ok] Privacy Badger trained ruleset matches its pinned, licensed source');
}
module.exports = { buildAll, readSnapshot, upstream, ancestors, FILES, RESOURCE_TYPES, PRIORITY, LIMITS, BADGER_SOURCE_URL };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });

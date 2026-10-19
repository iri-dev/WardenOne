/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const stable = (value) => JSON.stringify(value, null, 2) + '\n';
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const ARRAYS = {
  REMOTE_LISTS: ['IP-logger and grabber domains', 'blockGrabberResources'],
  TOKEN_AND_SCAM_LISTS: ['Web3 wallet drainers and social scams', 'blockMalwareSites'],
  MALWARE_LISTS: ['Malware and phishing domains', 'blockMalwareSites'],
  TRACKER_LISTS: ['Tracking and telemetry domains', 'blockTrackers'],
  ADSHIELD_NET_LISTS: ['Network-level ad filtering', 'adShield'],
  ADSHIELD_COSMETIC_LISTS: ['Cosmetic (element-hiding) filtering', 'adShield'],
  SUPPLEMENTAL_LIST_SOURCES: ['Supplemental domain lists', 'always'],
};
const DIRECT = {
  OPENPHISH_FEED_URL: ['Optional phishing intelligence', 'openPhish'],
  REMOTE_LIST_URL: ['Additional logger list', 'blockGrabberResources'],
  SUPPLEMENTAL_MANIFEST_URL: ['Publisher supplemental manifest', 'always'],
};
const BEGIN = '<!-- BEGIN GENERATED SOURCE INVENTORY -->';
const END = '<!-- END GENERATED SOURCE INVENTORY -->';

function runtimeFeeds(background) {
  for (const match of background.matchAll(/^const ([A-Z0-9_]*(?:_LISTS|_LIST_SOURCES)) = \[/gm)) {
    if (!(match[1] in ARRAYS)) throw new Error('Register the new feed array in the inventory: ' + match[1]);
  }
  const found = new Map();
  const add = (url, purpose, toggle) => {
    if (!found.has(url)) found.set(url, { url, purposes: [], toggles: [], kind: 'fetched' });
    const entry = found.get(url);
    if (!entry.purposes.includes(purpose)) entry.purposes.push(purpose);
    if (!entry.toggles.includes(toggle)) entry.toggles.push(toggle);
  };
  for (const [name, [purpose, toggle]] of Object.entries(ARRAYS)) {
    const match = background.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n\\];'));
    if (!match) throw new Error('Missing runtime source array: ' + name);
    const body = match[1].replace(/^\s*\/\*[\s\S]*?\*\//gm, '');
    for (const line of body.split('\n')) {
      const url = line.match(/^\s*(?:url:\s*)?'(https:\/\/[^']+)'\s*(?:,|$)/);
      if ((!url && /^\s*url:/.test(line))
        || (name !== 'SUPPLEMENTAL_LIST_SOURCES' && line.trim() && !/^\s*\/\//.test(line) && !url)) {
        throw new Error('Feed discovery requires literal HTTPS addresses; document dynamic generation explicitly: ' + name);
      }
      if (url) add(url[1], purpose, toggle);
    }
  }
  for (const [name, [purpose, toggle]] of Object.entries(DIRECT)) {
    const match = background.match(new RegExp('const ' + name + " = '([^']*)';"));
    if (!match) throw new Error('Missing runtime source constant: ' + name);
    if (match[1]) add(match[1], purpose, toggle);
  }
  return [...found.values()];
}

function build(metadata = JSON.parse(read('docs/source-licensing.json')), background = read('background.js')) {
  const bindings = new Map();
  for (const [id, profile] of Object.entries(metadata.profiles)) {
    for (const url of profile.urls) {
      if (bindings.has(url)) throw new Error('Duplicate source policy: ' + url);
      bindings.set(url, { id, profile });
    }
  }
  const used = new Set();
  const policy = (entry) => {
    const binding = bindings.get(entry.url);
    if (!binding) throw new Error('Document the exact new source in docs/source-licensing.json: ' + entry.url);
    used.add(entry.url);
    const { urls, ...profile } = binding.profile;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.checkedAt || '')) throw new Error('Missing source review date: ' + binding.id);
    return { ...entry, policyId: binding.id, ...profile };
  };
  const sources = runtimeFeeds(background).map(policy).sort((a, b) => a.url.localeCompare(b.url));
  const runtimeUrls = new Set(sources.map((s) => s.url));
  const cosmetic = JSON.parse(read('cosmetic-rules.json'));
  const inputs = cosmetic.sources.map((s) => ({ url: s.url, purpose: 'Packaged cosmetic rules', artifact: 'cosmetic-rules.json', inputSha256: s.sha256 }));
  for (const input of metadata.buildInputs) {
    const code = read(input.builtBy);
    const match = code.match(new RegExp('const ' + input.constant + " = '(https://[^']+)';"));
    if (!match) throw new Error('Build URL constant missing: ' + input.builtBy + ':' + input.constant);
    inputs.push({ url: match[1], purpose: input.purpose, artifact: input.artifact });
  }
  const buildSources = inputs.filter((s) => !runtimeUrls.has(s.url)).map((s) => policy({ ...s, kind: 'build-input' }));
  for (const url of bindings.keys()) if (!used.has(url)) throw new Error('Stale policy URL; remove or record it as retired: ' + url);
  const generated = metadata.artifacts.map((entry) => ({ ...entry, kind: 'redistributed', sha256: hash(entry.file) }));
  const unresolved = sources.filter((s) => s.compliance.status !== 'implemented');
  return {
    schemaVersion: 2,
    note: 'Generated from runtime constants, embedded build provenance and docs/source-licensing.json. Edit policy metadata, not this file. Counts include optional configured feeds; license and permission counts can overlap.',
    checkedAt: metadata.checkedAt,
    summary: {
      runtimeFeeds: sources.length,
      publishers: new Set(sources.map((s) => s.publisher)).size,
      publishedLicenseCoveredFeeds: sources.filter((s) => s.license.type === 'published-license' && s.compliance.status === 'implemented').length,
      writtenPermissionFeeds: sources.filter((s) => s.permission.status === 'granted').length,
      resolvedFeeds: sources.length - unresolved.length,
      unresolvedFeeds: unresolved.length,
      buildOnlyInputs: buildSources.length,
      redistributedArtifacts: generated.length,
    },
    sources, buildSources, generated,
    externalServices: metadata.externalServices,
    retired: metadata.retired,
  };
}

function basis(source) {
  const parts = [];
  if (source.license.id) parts.push(source.license.id);
  if (source.permission.status === 'granted') parts.push('Written permission (' + source.permission.date + ')');
  if (source.compliance.issueIds.length) parts.push('Specific upstream/use-scope exception — see source review');
  return parts.join('; ');
}

function creditsBlock(inv) {
  const groups = new Map();
  for (const s of inv.sources) {
    if (!groups.has(s.policyId)) groups.set(s.policyId, { source: s, count: 0 });
    groups.get(s.policyId).count++;
  }
  const lines = [BEGIN, '',
    'WardenOne uses independently maintained protection lists. Their maintainers retain ownership and credit.',
    'Published licenses and written permissions are separate permission grants; no personal reply is needed when the applicable license covers the use.',
    'The inventory records exact addresses, local processing, evidence and any specific scope exception.',
    '',
    '[' + inv.sources.length + ' runtime feeds](https://github.com/iri-dev/WardenOne/blob/main/docs/source-inventory.json) · [Packaged notices](https://github.com/iri-dev/WardenOne/blob/main/THIRD_PARTY_NOTICES.html) · [Review and exceptions](https://github.com/iri-dev/WardenOne/blob/main/docs/source-rights-review.md)',
    '', '| Source | Runtime feeds | License or permission |', '| --- | --- | --- |'];
  for (const { source, count } of groups.values()) lines.push('| [' + source.name + '](' + source.home + ') | ' + count + ' | ' + basis(source) + ' |');
  lines.push('', 'Build-only inputs (not daily runtime downloads):', '');
  for (const source of inv.buildSources) lines.push('- [' + source.name + '](' + source.url + ') → `' + source.artifact + '` (' + source.license.id + ').');
  lines.push('', 'Bundled and derived material:', '', '| File | Provenance | Distribution terms |', '| --- | --- | --- |');
  for (const entry of inv.generated) lines.push('| `' + entry.file + '` | ' + entry.provenance + ' | ' + entry.license + ' |');
  lines.push('', END);
  return lines.join('\n');
}

function credits(inv) {
  const current = read('CREDITS.md');
  const start = current.indexOf(BEGIN), end = current.indexOf(END);
  if (start < 0 || end < start) throw new Error('Missing CREDITS inventory markers');
  return current.slice(0, start) + creditsBlock(inv) + current.slice(end + END.length);
}

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function notices(inv) {
  const profiles = [...new Map([...inv.sources, ...inv.buildSources].map((s) => [s.policyId, s])).values()];
  const lines = ['<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WardenOne — Third-party notices</title><style>body{max-width:70rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.65 system-ui;color:#172033;background:#fafbff}a{color:#1548a5}section{border-top:1px solid #ccc;padding:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace}h1,h2{line-height:1.2}</style></head><body>',
    '<h1>Third-party protection sources</h1>',
    '<p>WardenOne uses independently maintained filtering and threat-intelligence lists to identify advertisements, trackers, phishing sites, scams and malicious domains. These sources remain the work of their respective maintainers; WardenOne does not claim ownership of their data.</p>',
    '<p>Published licenses and separate written permissions provide the bases described below. Specific scope exceptions remain for OpenPhish and aggregators that include it; the <a href="https://github.com/iri-dev/WardenOne/blob/main/docs/source-rights-review.md">source review</a> explains them. Those feeds remain configured. This notice does not describe them as cleared for redistribution.</p>',
    '<p>Runtime lists are downloaded directly by your browser and parsed, normalized, deduplicated and capped into local domain, URL or selector rules. They are not bundled as raw feeds. Packaged rules are selected, converted and supplemented by WardenOne. Attribution does not imply endorsement. Review date: ' + esc(inv.checkedAt) + '.</p>',
    '<p><a href="CREDITS.md">Additional code, media and data credits</a> · <a href="LICENSE">WardenOne GPL license</a> · <a href="https://github.com/iri-dev/WardenOne">Source, build scripts and filter-source snapshots</a></p>'];
  for (const s of profiles) {
    lines.push('<section><h2>' + esc(s.name) + '</h2><p><a href="' + esc(s.home) + '">' + esc(s.publisher) + '</a> — ' + esc(basis(s)) + '</p>',
      '<p>' + esc(s.attribution) + '</p>',
      '<p>Terms: <a href="' + esc(s.license.url || s.home) + '">' + esc(s.license.id || 'Publisher permission') + '</a>. ' + esc(s.compliance.conditions.join(' ')) + '</p>');
    if (s.upstream?.length) lines.push('<p>Upstream contributions: ' + s.upstream.map((u) => '<a href="' + esc(u.url) + '">' + esc(u.name) + '</a> (' + esc(u.license) + ')').join('; ') + '.</p>');
    lines.push('</section>');
  }
  lines.push('<section><h2>Bundled data and modifications</h2>');
  for (const artifact of inv.generated) lines.push('<p><strong>' + esc(artifact.file) + '</strong>: ' + esc(artifact.provenance) + '. ' + esc(artifact.license) + '. ' + esc(artifact.modifications) + '</p>');
  lines.push('<p>Have I Been Pwned breach information: <a href="https://haveibeenpwned.com">Troy Hunt / Have I Been Pwned</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Optional breach responses are selected and formatted for local display; no breach database is packaged.</p></section>');
  for (const file of JSON.parse(read('docs/source-licensing.json')).licenseFiles) lines.push('<section><h2>' + esc(file) + '</h2><pre>' + esc(read(file)) + '</pre></section>');
  lines.push('</body></html>\n');
  return lines.join('\n');
}

function main() {
  const inv = build();
  for (const [file, text] of [['docs/source-inventory.json', stable(inv)], ['CREDITS.md', credits(inv)], ['THIRD_PARTY_NOTICES.html', notices(inv)]]) {
    if (process.argv.includes('--check')) {
      if (!fs.existsSync(path.join(ROOT, file)) || read(file) !== text) throw new Error(file + ' is stale; run tools/build-source-inventory.js');
    } else fs.writeFileSync(path.join(ROOT, file), text);
  }
  console.log('[ok] source inventory and notices: ' + JSON.stringify(inv.summary));
}
module.exports = { runtimeFeeds, build, basis, creditsBlock, notices };
if (require.main === module) {
  try { main(); } catch (error) { console.error('[fail] ' + error.message); process.exitCode = 1; }
}

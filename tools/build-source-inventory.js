/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Generates the upstream source inventory from the code, not from memory (L20).
 *
 * CREDITS.md substantively credited four groupings while the runtime referenced more than fifteen
 * more. A hand-written attribution file drifts the moment a list is added, which is exactly how
 * that gap opened -- so the inventory is derived from the constants that actually drive the
 * fetches, and tools/check-maintainability.js fails when a source has no record.
 *
 * What this asserts and what it deliberately does not: it records provenance -- project, owner,
 * exact URL, what it feeds, which toggle gates it, and whether the bytes are fetched at runtime or
 * redistributed inside the package. It does NOT decide licence compatibility. Every record carries
 * a licence field the release owner fills in and a verified flag; nothing here is legal advice and
 * no licence is asserted from guesswork.
 *
 *   node tools/build-source-inventory.js            # rewrite docs/source-inventory.json
 *   node tools/build-source-inventory.js --check    # fail if it is out of date
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'source-inventory.json');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// Which array feeds what, and which setting gates it. Keyed by the constant name so a renamed or
// deleted array is a loud failure rather than a silently empty section.
const ARRAYS = [
  { name: 'REMOTE_LISTS', purpose: 'IP-logger and grabber domains', toggle: 'blockGrabberResources' },
  { name: 'TOKEN_AND_SCAM_LISTS', purpose: 'Web3 wallet drainers and social scams', toggle: 'blockMalwareSites' },
  { name: 'MALWARE_LISTS', purpose: 'Malware and phishing domains', toggle: 'blockMalwareSites' },
  { name: 'TRACKER_LISTS', purpose: 'Tracking and telemetry domains', toggle: 'blockTrackers' },
  { name: 'ADSHIELD_NET_LISTS', purpose: 'Network-level ad filtering', toggle: 'adShield' },
  { name: 'ADSHIELD_COSMETIC_LISTS', purpose: 'Cosmetic (element-hiding) filtering', toggle: 'adShield' },
];

// Generated rulesets that ship inside the package. These are redistribution rather than fetching,
// so they are listed separately and carry their build input.
const GENERATED = [
  { file: 'rules-adshield.json', builtBy: 'tools/build-adshield-dnr.js', from: 'ADSHIELD_NET_LISTS' },
  { file: 'rules-easyprivacy.json', builtBy: 'tools/build-easyprivacy-dnr.js', from: 'ADSHIELD_NET_LISTS' },
  { file: 'cosmetic-rules.json', builtBy: 'tools/build-cosmetics.js', from: 'ADSHIELD_COSMETIC_LISTS' },
];

function arrayEntries(name) {
  const start = BACKGROUND.indexOf('const ' + name + ' = [');
  if (start < 0) throw new Error('source array not found in background.js: ' + name);
  const end = BACKGROUND.indexOf('\n];', start);
  if (end < 0) throw new Error('source array has no end: ' + name);
  const block = BACKGROUND.slice(start, end);
  const out = [];
  let comment = '';
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//')) {
      const text = line.replace(/^\/\/\s?/, '').trim();
      comment = comment ? comment + ' ' + text : text;
      continue;
    }
    const m = line.match(/^'(https?:\/\/[^']+)'/);
    if (m) { out.push({ url: m[1], note: comment }); comment = ''; }
  }
  return out;
}

function objectEntries(name) {
  const start = BACKGROUND.indexOf('const ' + name + ' = [');
  if (start < 0) throw new Error('source array not found in background.js: ' + name);
  const end = BACKGROUND.indexOf('\n];', start);
  const block = BACKGROUND.slice(start, end);
  const out = [];
  const re = /url:\s*'(https?:\/\/[^']+)'[\s\S]{0,120}?label:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) out.push({ url: m[1], note: m[2] });
  return out;
}

// Owner and project from the URL, so the inventory cannot disagree with the fetch.
function identify(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const gh = host === 'raw.githubusercontent.com' ? u.pathname.split('/').filter(Boolean) : null;
  if (gh && gh.length >= 2) {
    return { owner: gh[0], project: gh[1], home: 'https://github.com/' + gh[0] + '/' + gh[1] };
  }
  if (host.endsWith('github.io')) {
    const owner = host.split('.')[0];
    const project = u.pathname.split('/').filter(Boolean)[0] || owner;
    return { owner, project, home: 'https://github.com/' + owner + '/' + project };
  }
  if (host.endsWith('gitlab.io')) {
    const owner = host.split('.')[0];
    return { owner, project: owner, home: 'https://gitlab.com/' + owner };
  }
  return { owner: host, project: host, home: u.origin + '/' };
}

function build() {
  const sources = [];
  const seen = new Map();
  const add = (url, note, purpose, toggle, kind) => {
    const id = identify(url);
    const key = url;
    if (seen.has(key)) {
      const prior = seen.get(key);
      if (!prior.purposes.includes(purpose)) prior.purposes.push(purpose);
      return;
    }
    const record = {
      owner: id.owner,
      project: id.project,
      home: id.home,
      url,
      purposes: [purpose],
      toggle,
      kind,                       // 'fetched' = bytes arrive at runtime
      note: note || '',
      licence: '',                // filled in by the release owner
      licenceVerified: false,
    };
    seen.set(key, record);
    sources.push(record);
  };

  for (const group of ARRAYS) {
    for (const entry of arrayEntries(group.name)) {
      add(entry.url, entry.note, group.purpose, group.toggle, 'fetched');
    }
  }
  for (const entry of objectEntries('SUPPLEMENTAL_LIST_SOURCES')) {
    add(entry.url, entry.note, 'Supplemental domain lists', 'always', 'fetched');
  }

  const generated = GENERATED.map((g) => ({
    file: g.file,
    builtBy: g.builtBy,
    derivedFrom: g.from,
    kind: 'redistributed',       // these bytes ship inside the package
    licence: '',
    licenceVerified: false,
  }));

  sources.sort((a, b) => (a.owner + a.project + a.url).localeCompare(b.owner + b.project + b.url));
  return {
    note: 'Generated by tools/build-source-inventory.js. Do not hand-edit the source list; edit the '
      + 'constants in background.js. licence/licenceVerified are the fields a release owner fills '
      + 'in after reviewing each project\'s terms -- nothing here asserts a licence or its '
      + 'compatibility.',
    sources,
    generated,
  };
}

function stable(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

// The human-facing half. CREDITS.md keeps its hand-written sections -- they say things a table
// cannot -- and gains a generated block that cannot fall behind the code, because it is written
// from the same inventory.
const CREDITS = path.join(ROOT, 'CREDITS.md');
const BEGIN = '<!-- BEGIN GENERATED SOURCE INVENTORY -->';
const END = '<!-- END GENERATED SOURCE INVENTORY -->';

function creditsBlock(inv) {
  const byOwner = new Map();
  for (const s of inv.sources) {
    const key = s.owner + '/' + s.project;
    if (!byOwner.has(key)) byOwner.set(key, { owner: s.owner, project: s.project, home: s.home, purposes: new Set(), urls: [], licence: s.licence, verified: s.licenceVerified });
    const e = byOwner.get(key);
    s.purposes.forEach((p) => e.purposes.add(p));
    e.urls.push(s.url);
  }
  const lines = [BEGIN, '',
    '_Generated by `tools/build-source-inventory.js` from the source constants in `background.js`._',
    '_Do not edit this block by hand; the release gate rebuilds and checks it._',
    '_Machine-readable form, including per-source URLs: `docs/source-inventory.json`._',
    '',
    'Every upstream list the default runtime can reach. **Licence column blank means the terms have',
    'not yet been confirmed by a release owner** — that is a documentation gap being tracked, not a',
    'claim that a licence is absent or that any use is or is not permitted.',
    '',
    '| Project | Feeds | Files | Licence |',
    '| --- | --- | --- | --- |'];
  [...byOwner.values()]
    .sort((a, b) => (a.owner + a.project).toLowerCase().localeCompare((b.owner + b.project).toLowerCase()))
    .forEach((e) => {
      lines.push('| [' + e.owner + '/' + e.project + '](' + e.home + ') | '
        + [...e.purposes].join('; ') + ' | ' + e.urls.length + ' | '
        + (e.verified && e.licence ? e.licence : '_not yet verified_') + ' |');
    });
  lines.push('', 'Rulesets compiled from the above and **redistributed inside the package**:', '');
  lines.push('| File | Built by | From |', '| --- | --- | --- |');
  inv.generated.forEach((g) => lines.push('| `' + g.file + '` | `' + g.builtBy + '` | `' + g.derivedFrom + '` |'));
  lines.push('', END);
  return lines.join('\n');
}

function writeCredits(inv) {
  const text = fs.readFileSync(CREDITS, 'utf8');
  const block = creditsBlock(inv);
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from >= 0 && to > from) {
    return text.slice(0, from) + block + text.slice(to + END.length);
  }
  // First run: insert ahead of the closing Notes section so the prose still reads last.
  const anchor = text.indexOf('## Notes');
  if (anchor < 0) return text.trimEnd() + '\n\n## Upstream source inventory\n\n' + block + '\n';
  return text.slice(0, anchor) + '## Upstream source inventory\n\n' + block + '\n\n' + text.slice(anchor);
}

const inventory = build();
const arg = process.argv[2] || '--build';
if (arg === '--check') {
  const problems = [];
  let current = '';
  try { current = fs.readFileSync(OUT, 'utf8'); } catch (_) {}
  if (current !== stable(inventory)) problems.push('docs/source-inventory.json is out of date');
  if (fs.readFileSync(CREDITS, 'utf8') !== writeCredits(inventory)) problems.push('the CREDITS.md inventory block is out of date');
  // The requirement this finding asks the release to enforce: a record for every source.
  const orphan = inventory.sources.filter((s) => !s.owner || !s.project || !s.url || !s.purposes.length);
  if (orphan.length) problems.push(orphan.length + ' source(s) have an incomplete record');
  if (problems.length) {
    problems.forEach((p) => console.error('[fail] ' + p));
    console.error('[info] run: node tools/build-source-inventory.js');
    process.exit(1);
  }
  const unverified = inventory.sources.filter((s) => !s.licenceVerified).length;
  console.log('[ok] every upstream source has an inventory record ('
    + inventory.sources.length + ' fetched, ' + inventory.generated.length + ' redistributed)');
  if (unverified) {
    console.log('[info] ' + unverified + ' source(s) still await release-owner licence confirmation '
      + '(recorded in docs/source-inventory.json, shown as "not yet verified" in CREDITS.md)');
  }
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stable(inventory), 'utf8');
  fs.writeFileSync(CREDITS, writeCredits(inventory), 'utf8');
  console.log('[ok] wrote docs/source-inventory.json and the CREDITS.md block ('
    + inventory.sources.length + ' fetched sources, ' + inventory.generated.length + ' redistributed rulesets)');
}

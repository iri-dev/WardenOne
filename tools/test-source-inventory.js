/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Every upstream source has a provenance record (L20).
 *
 * CREDITS.md substantively credited four groupings while the default runtime reached more than
 * fifteen further projects. A hand-written attribution file drifts the moment a list is added,
 * which is how that gap opened -- so the inventory is generated from the constants that drive the
 * fetches, and this fails when anything the runtime can reach has no record.
 *
 * It checks provenance, not permission. Licence terms are a release-owner judgement recorded in
 * the inventory; nothing here asserts a licence or its compatibility.
 *
 * Run: node tools/test-source-inventory.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const CREDITS = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'source-inventory.json'), 'utf8'));

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Every https URL the source arrays actually carry, read straight out of the file rather than
// from the generator -- so a generator that silently skipped an array would be caught here.
function urlsInSourceArrays() {
  const names = ['REMOTE_LISTS', 'TOKEN_AND_SCAM_LISTS', 'MALWARE_LISTS', 'TRACKER_LISTS',
    'ADSHIELD_NET_LISTS', 'ADSHIELD_COSMETIC_LISTS', 'SUPPLEMENTAL_LIST_SOURCES'];
  const urls = new Set();
  for (const name of names) {
    const start = BACKGROUND.indexOf('const ' + name + ' = [');
    if (start < 0) { check('source array ' + name + ' still exists', false); continue; }
    const end = BACKGROUND.indexOf('\n];', start);
    const block = BACKGROUND.slice(start, end);
    (block.match(/'https?:\/\/[^']+'/g) || []).forEach((q) => urls.add(q.slice(1, -1)));
  }
  return urls;
}

const declared = urlsInSourceArrays();
const recorded = new Set(INVENTORY.sources.map((s) => s.url));

check('the source arrays are still findable', declared.size > 20, declared.size + ' urls');

const missing = [...declared].filter((u) => !recorded.has(u));
check('every list the runtime fetches has an inventory record',
  missing.length === 0,
  missing.join(', ') + ' -- add it by running: node tools/build-source-inventory.js');

const stale = [...recorded].filter((u) => !declared.has(u));
check('the inventory records nothing the runtime no longer fetches', stale.length === 0, stale.join(', '));

// A record is only useful if it says who and what.
const incomplete = INVENTORY.sources.filter((s) => !s.owner || !s.project || !s.home
  || !Array.isArray(s.purposes) || !s.purposes.length || s.kind !== 'fetched');
check('every record names an owner, a project, a home and what it feeds',
  incomplete.length === 0, incomplete.map((s) => s.url).join(', '));

// Redistribution is a different obligation from fetching, so it is recorded separately.
check('the rulesets that ship inside the package are recorded as redistributed',
  INVENTORY.generated.length >= 3 && INVENTORY.generated.every((g) => g.kind === 'redistributed' && g.file && g.builtBy),
  JSON.stringify(INVENTORY.generated.map((g) => g.file)));
INVENTORY.generated.forEach((g) => {
  check('the redistributed ' + g.file + ' is actually in the package',
    fs.existsSync(path.join(ROOT, g.file)));
  check('and its build script exists', fs.existsSync(path.join(ROOT, g.builtBy)));
});

// The gap this finding is about: CREDITS.md must name everything, not a subset.
//
// Matched on the table row rather than anywhere in the file. A bare includes() also matches the
// project's own URL inside the link href, so a row whose visible name had been changed still
// passed -- the check read as covering the reader-facing text while only ever seeing the link.
const ownersInCredits = INVENTORY.sources.filter((s) => !CREDITS.includes('| [' + s.owner + '/' + s.project + ']'));
check('CREDITS.md names every project the runtime reaches',
  ownersInCredits.length === 0,
  [...new Set(ownersInCredits.map((s) => s.owner + '/' + s.project))].join(', '));

check('the CREDITS block is marked generated, so it is not hand-edited into drift',
  CREDITS.includes('<!-- BEGIN GENERATED SOURCE INVENTORY -->')
    && CREDITS.includes('tools/build-source-inventory.js'));

// Provenance, not permission. An unverified licence has to READ as unverified rather than blank.
const asserted = INVENTORY.sources.filter((s) => s.licence && !s.licenceVerified);
check('no licence is recorded as fact without being marked verified',
  asserted.length === 0, asserted.map((s) => s.project).join(', '));
check('unverified terms are visible in CREDITS rather than silently empty',
  !INVENTORY.sources.some((s) => !s.licenceVerified) || /_not yet verified_/.test(CREDITS));

// The hand-written sections say things a table cannot -- what was re-implemented rather than
// copied, and why. The generator inserts around them, so they have to be checked for survival.
//
// Matched on the entry line, not on the name appearing anywhere: these projects are named several
// times each in the surrounding prose, so a bare includes() stayed true even with the entry gone.
[
  '- **AdGuard Filters**',
  '- **TwitchAdSolutions** (pixeltris)',
  '- **EasyList & EasyPrivacy**',
  '- **uBlock-Origin-dev-filter** (quenhus)',
].forEach((entry) => {
  check('the written credit entry ' + entry.replace('- **', '').replace('**', '') + ' survives',
    CREDITS.includes(entry));
});

if (failed) { console.error('\n' + failed + ' source inventory check(s) failed'); process.exit(1); }
console.log('\nevery upstream source the runtime reaches has a provenance record');

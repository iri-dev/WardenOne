/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The offerable filter lists: shape, transport, honesty of the copy, and that nothing in the
   catalogue is subscribed to on its own. Addresses are checked against the network by
   tools/check-filter-catalog.js, which is not part of this offline gate.
   Run: node tools/test-filter-catalog.js */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'filter-list-catalog.json'), 'utf8'));
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SETTINGS = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
const PRIVACY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
const ALLOWLIST = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'package-allowlist.json'), 'utf8')));

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

// ---------------------------------------------------------------------------
// Shape.
// ---------------------------------------------------------------------------
check('the catalogue declares groups', Array.isArray(CATALOG.groups) && CATALOG.groups.length > 0);
check('the catalogue declares lists', Array.isArray(CATALOG.lists) && CATALOG.lists.length > 0);
check('the catalogue records when its addresses were last checked',
  /^\d{4}-\d{2}-\d{2}$/.test(String(CATALOG.checkedAt || '')), String(CATALOG.checkedAt));

const groupIds = new Set(CATALOG.groups.map((g) => g.id));
for (const group of CATALOG.groups) {
  check('group "' + group.id + '" has a title', !!group.title);
  check('group "' + group.id + '" explains itself', String(group.detail || '').length > 20);
}

const ids = new Set();
const urls = new Set();
for (const entry of CATALOG.lists) {
  const label = entry && entry.id ? entry.id : JSON.stringify(entry).slice(0, 40);
  check('"' + label + '" has an id', !!entry.id && /^[a-z0-9-]+$/.test(entry.id));
  check('"' + label + '" has a unique id', !ids.has(entry.id));
  ids.add(entry.id);
  check('"' + label + '" names a group that exists', groupIds.has(entry.group), String(entry.group));
  check('"' + label + '" has a title', !!entry.title);
  check('"' + label + '" names who maintains it', !!entry.publisher,
    'the reader is being asked to trust someone else\'s list; say whose');
  check('"' + label + '" explains what it is for', String(entry.detail || '').length > 10);
  /* The subscription fetcher refuses http:// outright, so an http entry would be an offer that
     cannot work. */
  check('"' + label + '" is served over https', /^https:\/\//.test(String(entry.url || '')), String(entry.url));
  check('"' + label + '" has a unique address', !urls.has(String(entry.url).toLowerCase()));
  urls.add(String(entry.url).toLowerCase());
  check('"' + label + '" has no query string or fragment',
    !/[?#]/.test(String(entry.url || '')), 'an address with parameters is harder to audit');
}

// ---------------------------------------------------------------------------
// It must fit, and it must not duplicate what is already bundled.
// ---------------------------------------------------------------------------
{
  const max = Number((BG.match(/const CUSTOM_LIST_MAX = (\d+)/) || [])[1]);
  check('CUSTOM_LIST_MAX is readable from background.js', max > 0);
  const mirrored = Number((SETTINGS.match(/const CUSTOM_LIST_MAX = (\d+)/) || [])[1]);
  check('the settings page mirrors the same subscription limit', mirrored === max,
    'settings says ' + mirrored + ', background says ' + max);
  /* Offering more than fits is fine -- the reader picks -- but the page has to say so rather than
     letting an add fail, which is what the "No room" state is for. */
  check('the page handles having no room left', SETTINGS.includes('No room'));

  const bundled = new Set();
  for (const block of BG.match(/const [A-Z0-9_]*(?:_LISTS|_LIST_SOURCES) = \[[\s\S]*?\];/g) || []) {
    for (const m of block.matchAll(/'(https:\/\/[^']+)'/g)) bundled.add(m[1].toLowerCase());
  }
  check('bundled feed addresses were readable', bundled.size > 5, bundled.size + ' found');
  for (const entry of CATALOG.lists) {
    check('"' + entry.id + '" is not already bundled', !bundled.has(String(entry.url).toLowerCase()),
      'offering a list WardenOne already applies spends one of the reader\'s slots on nothing');
  }
}

// ---------------------------------------------------------------------------
// Nothing is fetched until the reader asks.
// ---------------------------------------------------------------------------
{
  check('the catalogue carries no enabled flag',
    CATALOG.lists.every((entry) => entry.enabled === undefined && entry.default === undefined),
    'an entry that looks default-on would be a subscription nobody chose');
  check('the page reads the catalogue from the package, not the network',
    SETTINGS.includes("chrome.runtime.getURL('filter-list-catalog.json')"));
  check('adding one goes through the ordinary subscription path',
    SETTINGS.includes("kind: 'custom-list-add'") && SETTINGS.includes("act === 'sub-catalog-add'"));
  check('the page refuses a catalogue entry that is not https',
    /sub-catalog-add[\s\S]{0,400}\^https:\\\/\\\//.test(SETTINGS)
    || /sub-catalog-add[\s\S]{0,400}https:\\\/\\\//.test(SETTINGS),
    'the button must not be able to hand an http address to the fetcher');
  check('no background code subscribes to a catalogue entry',
    !BG.includes('filter-list-catalog.json') || !/filter-list-catalog\.json[\s\S]{0,200}fetchCustomListText/.test(BG));
}

// ---------------------------------------------------------------------------
// Disclosure and packaging.
// ---------------------------------------------------------------------------
{
  check('the release package carries the catalogue', ALLOWLIST.has('filter-list-catalog.json'));
  check('the runtime file census carries the catalogue', BG.includes("'filter-list-catalog.json'"));
  check('PRIVACY.md names the catalogue file', PRIVACY.includes('filter-list-catalog.json'),
    'a new shipped file that lists third-party hosts has to be disclosed');
  check('PRIVACY.md says reading it contacts nothing',
    /catalogue[\s\S]{0,400}contacts nothing/i.test(PRIVACY));
  check('PRIVACY.md says nothing in it is on by default',
    /Nothing in the catalogue is subscribed to by default/i.test(PRIVACY));
}

if (failed) {
  console.error('[fail] ' + failed + ' filter catalogue check(s) failed');
  process.exit(1);
}
console.log('[ok] filter list catalogue: ' + CATALOG.lists.length + ' lists in ' + CATALOG.groups.length
  + ' groups, all https, none bundled, none default-on, disclosed and packaged');

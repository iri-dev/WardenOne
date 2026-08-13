/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Chrome's Manifest V3 rules require extension logic to be self-contained, and name "building an
 * interpreter to run complex commands fetched from a remote source, even if those commands are
 * fetched as data" as a violation. WardenOne's cosmetic feeds used to supply exactly that:
 * ##+js(...) scriptlet records and procedural (:remove(), :style(), :xpath()) rules, fetched daily
 * and dispatched by the content engine.
 *
 * Those are compiled at release time now and shipped inside the reviewed package. The daily
 * refresh keeps updating passive selectors only. This file pins that split, because it is the kind
 * of boundary that erodes silently -- one convenient line reintroducing `parsed` where `passive`
 * belongs and the extension is back in violation with nothing failing.
 *
 * Run with:
 *   node tools/test-cosmetic-provenance.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const RULES = path.join(ROOT, 'cosmetic-rules.json');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// ---------------------------------------------------------------------------
// 1. The packaged file exists, carries rules, and says where it came from.
// ---------------------------------------------------------------------------
check('cosmetic-rules.json is present', fs.existsSync(RULES));

let doc = null;
if (fs.existsSync(RULES)) {
  try { doc = JSON.parse(fs.readFileSync(RULES, 'utf8')); } catch (e) { void e; }
}
check('it is valid JSON', !!doc);

if (doc) {
  const scriptletDomains = Object.keys(doc.scriptlets || {}).length;
  const proceduralDomains = Object.keys(doc.procedural || {}).length;
  check('it carries scriptlet rules', scriptletDomains > 100, scriptletDomains + ' domains');
  check('it carries procedural rules', proceduralDomains > 100, proceduralDomains + ' domains');

  // Provenance is what makes this reviewable: a reviewer can see which upstream lists produced
  // the packaged commands and verify the bytes that were compiled.
  check('it records when it was built', typeof doc.builtAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.builtAt),
    String(doc.builtAt));
  check('it records its sources', Array.isArray(doc.sources) && doc.sources.length >= 5,
    (doc.sources || []).length + ' sources');
  check('every source has a URL and a hash',
    (doc.sources || []).every((s) => s && typeof s.url === 'string' && /^[0-9a-f]{64}$/.test(s.sha256 || '')));
}

// ---------------------------------------------------------------------------
// 2. The refresh path stores passive data only.
// ---------------------------------------------------------------------------
{
  // The write must use the passive projection, not the whole parse result.
  check('the refresh writes a passive-only projection',
    /wardenone_adshield_cosmetic: passive,/.test(BG));
  check('it no longer writes the raw parse result',
    !/wardenone_adshield_cosmetic: parsed,/.test(BG));

  const m = BG.match(/const passive = \{([\s\S]{0,320}?)\};/);
  check('the projection is defined', !!m);
  if (m) {
    const body = m[1];
    check('it carries no scriptlets key', !/\bscriptlets\b/.test(body), body.replace(/\s+/g, ' ').slice(0, 90));
    check('it carries no procedural key', !/\bprocedural\b/.test(body));
    for (const key of ['generic', 'specific', 'exceptions', 'genericHideExclusions']) {
      check('it keeps ' + key, new RegExp('\\b' + key + '\\b').test(body));
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Behaviour: a cache written by an older build cannot supply commands.
//    This is the migration path -- an upgrade keeps whatever was already in storage.
// ---------------------------------------------------------------------------
{
  const from = BG.indexOf('let __packagedCosmetics = null;');
  const at = BG.indexOf('async function getCosmeticMem()');
  const to = BG.indexOf('\n}', at) + 2;
  assert(from >= 0 && at > from && to > at, 'could not lift the cosmetic memo');
  const lifted = BG.slice(from, to);

  const STALE = {
    generic: ['.ad'],
    specific: { 'example.com': ['.banner'] },
    exceptions: {},
    genericHideExclusions: [],
    // What an older build would have left behind.
    scriptlets: { 'evil.example': [{ name: 'json-prune', args: ['everything'] }] },
    procedural: { 'evil.example': ['.x:remove()'] },
  };
  const PACKAGED = {
    scriptlets: { 'good.example': [{ name: 'set-constant', args: ['x', '1'] }] },
    procedural: { 'good.example': ['.y:remove()'] },
  };

  const sandbox = {
    Object, Array, Promise, JSON, console,
    normalizeAllowlistHosts: (l) => Array.from(l || []),
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://x/' + p },
      storage: { local: { get: () => Promise.resolve({ wardenone_adshield_cosmetic: STALE, wardenone_config: {}, wardenone_adshield_allowlist: [] }) } },
    },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(PACKAGED) }),
    __cosmeticMem: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(lifted + '\nthis.__get = getCosmeticMem;', sandbox, { filename: 'background.js:cosmetic-mem' });

  return sandbox.__get().then((mem) => {
    check('passive selectors still come from the stored cache',
      JSON.stringify(mem.data.generic) === JSON.stringify(['.ad']));
    check('scriptlets come from the package, not the stale cache',
      !!mem.data.scriptlets['good.example'] && !mem.data.scriptlets['evil.example'],
      JSON.stringify(Object.keys(mem.data.scriptlets)));
    check('procedural comes from the package, not the stale cache',
      !!mem.data.procedural['good.example'] && !mem.data.procedural['evil.example'],
      JSON.stringify(Object.keys(mem.data.procedural)));
    finish();
  });
}

function finish() {
  if (failures) {
    console.error('[fail] cosmetic provenance tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] cosmetic provenance tests passed');
}

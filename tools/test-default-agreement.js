/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Compare stored, popup and worker defaults so each shipped switch has one effective default.
   Run: node tools/test-default-agreement.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* Booleans only. The tables also carry strings, numbers and arrays, and those
   legitimately differ (a placeholder key is '' in one and absent in another).
   Booleans are the ones that mean "is this protection on", and a disagreement
   there is always a bug. */
function booleanTable(file, marker, endMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = src.indexOf(marker);
  assert(at >= 0, marker + ' not found in ' + file);
  const end = src.indexOf(endMark, at);
  assert(end > at, 'could not find the end of ' + marker + ' in ' + file);
  const seg = src.slice(at, end);
  const out = new Map();
  for (const m of seg.matchAll(/(\w+)\s*:\s*(!0|!1|true|false)\b/g)) {
    out.set(m[1], m[2] === '!0' || m[2] === 'true');
  }
  return out;
}

const TABLES = [
  ['background', booleanTable('background.js', 'const DEFAULT_CONFIG = {', '\n};')],
  ['popup', booleanTable('popup.js', 'const DEFAULTS =', '\n};')],
  ['engine', booleanTable('src/content.js', 'DEFAULTS={', '\n  };')],
];

TABLES.forEach(([name, t]) => {
  check(name + ' defaults were read', t.size > 50, t.size + ' boolean keys');
});

/* The assertion. Any key in two or more tables must read the same in all of
   them; a key in only one table is that context's own business. */
(function everySharedKeyAgrees() {
  const names = new Set();
  TABLES.forEach(([, t]) => t.forEach((v, k) => names.add(k)));

  const disagreements = [];
  for (const key of names) {
    const seen = TABLES
      .map(([name, t]) => [name, t.has(key) ? t.get(key) : undefined])
      .filter(([, v]) => v !== undefined);
    if (seen.length < 2) continue;
    if (new Set(seen.map(([, v]) => v)).size > 1) {
      disagreements.push(key + ' (' + seen.map(([n, v]) => n + '=' + v).join(', ') + ')');
    }
  }
  check('every default that is written down twice is written down the same',
    disagreements.length === 0,
    'a reader is being shown one value and saved another: ' + disagreements.join('; '));
}());

(function theOneThatDrifted() {
  /* Named, because it is the case that proved the general check was needed and
     the one most likely to come back: forceHttps is read by nothing in the
     engine, so nothing there fails when it is wrong. */
  const [, bg] = TABLES[0];
  const [, pop] = TABLES[1];
  const [, eng] = TABLES[2];
  check('forceHttps still exists to be checked', bg.has('forceHttps'));
  check('forceHttps agrees across all three',
    bg.get('forceHttps') === pop.get('forceHttps')
      && pop.get('forceHttps') === eng.get('forceHttps'),
    'background=' + bg.get('forceHttps') + ' popup=' + pop.get('forceHttps') + ' engine=' + eng.get('forceHttps'));
}());

(function theTablesHaveNotQuietlyEmptied() {
  /* A parse that stops finding keys passes this suite forever. The counts are
     checked above; this checks that they overlap, which a broken marker would
     not survive even if each table parsed to something. */
  const [, bg] = TABLES[0];
  const [, pop] = TABLES[1];
  const [, eng] = TABLES[2];
  const shared = [...bg.keys()].filter((k) => pop.has(k) || eng.has(k));
  check('the tables still describe the same settings', shared.length > 40,
    'only ' + shared.length + ' keys are shared — a marker probably moved');
}());

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('default agreement: ' + pass + ' checks passed');

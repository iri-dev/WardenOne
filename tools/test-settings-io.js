/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Settings export/import.
 *
 * An imported file is untrusted input that gets written straight into the config
 * the whole extension runs on, so the sanitizer is not checked by reading it --
 * it is pulled out of popup.js, executed, and fed hostile files.
 *
 * The secret-stripping rules are asserted in test-secret-hygiene.js, which owns
 * that subject. This file owns the shape validation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
  assert(cond, name + (extra ? ' :: ' + extra : ''));
  console.log('  ok  - ' + name);
  passed++;
}

/* Pull a brace-balanced declaration out of popup.js so we can run it here. */
function extractBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, 'could not find ' + startMarker + ' in popup.js');
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail('unbalanced braces after ' + startMarker);
}

const defaultsSrc = extractBlock(POPUP_JS, 'const DEFAULTS = {');
const sanitizeSrc = extractBlock(POPUP_JS, 'function sanitizeImportedSettings');
const exportableSrc = extractBlock(POPUP_JS, 'function exportableSettings');

const sandbox = new Function(
  defaultsSrc + ';\n'
  + 'const SECRET_FIELD_RE = /Key$/;\n'
  + sanitizeSrc + ';\n'
  + exportableSrc + ';\n'
  + 'return { DEFAULTS, sanitizeImportedSettings, exportableSettings };'
)();

const { DEFAULTS, sanitizeImportedSettings, exportableSettings } = sandbox;

check('DEFAULTS carries the full settings surface', Object.keys(DEFAULTS).length > 100,
  Object.keys(DEFAULTS).length + ' keys');

/* ---- export ---- */
const exported = exportableSettings(Object.assign({}, DEFAULTS, {
  downloadVirusTotalKey: 'SECRET-VT', whoisXmlKey: 'SECRET-WHOIS', blockMalwareSites: true,
}));
check('export keeps ordinary settings', exported.blockMalwareSites === true);
check('export drops every provider key',
  !Object.keys(exported).some((k) => /Key$/.test(k)),
  Object.keys(exported).filter((k) => /Key$/.test(k)).join(', '));
check('no secret value survives the export',
  !JSON.stringify(exported).includes('SECRET-'));

/* ---- import: the good case ---- */
const good = sanitizeImportedSettings({ blockMalwareSites: false, memoryMode: 'aggressive', loginAgeMaxDays: 30 });
check('import accepts a valid boolean', good.settings.blockMalwareSites === false);
check('import accepts a valid string', good.settings.memoryMode === 'aggressive');
check('import accepts a valid number', good.settings.loginAgeMaxDays === 30);

/* ---- import: hostile input ---- */
const hostile = sanitizeImportedSettings({
  blockMalwareSites: 'yes-please',          // wrong type
  notARealSetting: true,                    // unknown key
  downloadVirusTotalKey: 'INJECTED',        // secret injection
  whoisXmlKey: 'INJECTED',
  loginAgeMaxDays: 'tomorrow',              // wrong type
  memoryMode: 'x'.repeat(5000),             // oversized string
  allowlist: new Array(9000).fill('evil.example'),
  eyeShieldBrightnessByHost: { 'a.example': 50, 'b.example': { nested: 'object' } },
});
check('wrong-typed boolean is rejected', !('blockMalwareSites' in hostile.settings));
check('unknown key is rejected', !('notARealSetting' in hostile.settings));
check('a provider key in the file is never imported',
  !('downloadVirusTotalKey' in hostile.settings) && !('whoisXmlKey' in hostile.settings));
check('wrong-typed number is rejected', !('loginAgeMaxDays' in hostile.settings));
check('oversized string is rejected', !('memoryMode' in hostile.settings));
check('oversized list is capped', hostile.settings.allowlist.length === 1000,
  'got ' + hostile.settings.allowlist.length);
check('per-host map keeps scalars and drops nested objects',
  hostile.settings.eyeShieldBrightnessByHost['a.example'] === 50
    && !('b.example' in hostile.settings.eyeShieldBrightnessByHost));
check('rejected entries are counted, not silently dropped', hostile.ignored >= 5,
  'ignored=' + hostile.ignored);

/* ---- import: prototype pollution ---- */
/* `'__proto__' in obj` is true for any object -- it is an inherited accessor on
   Object.prototype -- so own-property checks are the only meaningful ones here. */
const polluted = sanitizeImportedSettings(JSON.parse('{"__proto__":{"pwned":true},"constructor":{"pwned":true}}'));
check('__proto__ from a crafted file is not carried into the result',
  !Object.prototype.hasOwnProperty.call(polluted.settings, '__proto__'));
check('constructor from a crafted file is not carried into the result',
  !Object.prototype.hasOwnProperty.call(polluted.settings, 'constructor'));
check('no prototype was polluted', ({}).pwned === undefined && Object.prototype.pwned === undefined);
check('a crafted file applies nothing at all', Object.keys(polluted.settings).length === 0);

/* ---- round trip ---- */
const round = sanitizeImportedSettings(JSON.parse(JSON.stringify(exportableSettings(DEFAULTS))));
check('a freshly exported file imports cleanly with nothing ignored', round.ignored === 0,
  'ignored=' + round.ignored);
check('a round trip preserves the non-secret surface',
  Object.keys(round.settings).length === Object.keys(DEFAULTS).filter((k) => !/Key$/.test(k)).length,
  Object.keys(round.settings).length + ' of ' + Object.keys(DEFAULTS).filter((k) => !/Key$/.test(k)).length);

console.log('\n' + passed + ' passed, 0 failed');

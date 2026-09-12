/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A settings backup restores what it recorded (PI-03, PI-04).
 *
 * The importer validated each value against the shape of the popup's default. siteOverrides maps
 * a host to an object of feature keys; the generic map branch keeps only scalar values, so every
 * host failed and the key came back as {} -- counted as applied, then written over the reader's
 * stored overrides. "Applied 160 settings" with every per-site exception gone. Separately, the
 * exporter writes the worker's table and the importer checked the popup's, so five of WardenOne's
 * own exported settings came back as "unrecognised".
 *
 * This lifts the shipped exporter and importer, runs a configuration carrying every shape in the
 * schema through them, and requires deep equality with the original minus secrets. No key may
 * ever be applied as an empty object when the file held entries for it, and every key the
 * worker's DEFAULT_CONFIG has must be importable.
 *
 * Run: node tools/test-settings-roundtrip.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return src.slice(a, b);
}
function grabFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('no ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(name + ' unterminated');
}

/* the popup's tables and the two functions, as shipped */
const TABLES = between(POPUP, 'const DEFAULTS = {', '\n// cryptominerCpuWatch is here', 'the popup tables');
const SECRET = between(POPUP, 'const SECRET_FIELD_RE', '\n', 'the secret pattern');
const ctx = { Object, Array, Number, String, JSON, RegExp };
vm.createContext(ctx);
vm.runInContext(TABLES + '\n' + SECRET + '\n' + grabFn(POPUP, 'sanitizeSiteOverrides') + '\n' + grabFn(POPUP, 'exportableSettings') + '\n'
  + grabFn(POPUP, 'sanitizeImportedSettings') + '\nglobalThis.api = { DEFAULTS, IMPORT_SCHEMA, IMPORT_ONLY_DEFAULTS, exportableSettings, sanitizeImportedSettings, sanitizeSiteOverrides };', ctx);
const api = ctx.api;

/* the worker's table, as shipped */
const bgCtx = {};
vm.createContext(bgCtx);
vm.runInContext(between(BG, 'const DEFAULT_CONFIG = {', '\n};', 'the worker defaults') + '\n};\nglobalThis.D = DEFAULT_CONFIG;', bgCtx);
const WORKER_DEFAULTS = bgCtx.D;

/* a configuration carrying every shape: boolean, number, string, array, host->scalar map and the
   one host->object map, plus a secret that must not travel */
const live = Object.assign({}, WORKER_DEFAULTS, {
  enabled: true,
  blockPopupTricks: false,
  gestureWindowMs: 3200,
  memoryNeverSleepHosts: ['music.example', 'docs.example'],
  allowlist: ['paused.example'],
  allowlistUntil: { 'paused.example': 1800000000000 },
  siteOverrides: { 'shop.example': { mediaShield: false, blockPopupTricks: false }, 'bank.example': { detectSkimmers: false } },
  downloadSafeBrowsingKey: 'sb-secret-key',
  logThirdPartyBeacons: false,
  downloadHashCheck: false,
});
/* only feature keys that exist as booleans in the popup table can be overridden; keep the fixture honest */
for (const host of Object.keys(live.siteOverrides)) {
  for (const k of Object.keys(live.siteOverrides[host])) {
    if (typeof api.DEFAULTS[k] !== 'boolean') throw new Error('fixture uses a key the popup has no boolean for: ' + k);
  }
}

console.log('\nsettings round trip\n');

const exported = api.exportableSettings(live);
check('secrets do not travel', !('downloadSafeBrowsingKey' in exported) && !Object.keys(exported).some((k) => /Key$/.test(k)));
const back = api.sanitizeImportedSettings(exported);
const expected = Object.assign({}, live);
Object.keys(expected).filter((k) => /Key$/.test(k)).forEach((k) => { delete expected[k]; });
check('everything the exporter wrote comes back, nothing counted unrecognised', back.ignored === 0, 'ignored ' + back.ignored);
check('the import equals the export, deeply', JSON.stringify(back.settings) === JSON.stringify(exported),
  Object.keys(exported).filter((k) => JSON.stringify(back.settings[k]) !== JSON.stringify(exported[k])).join(', '));
check('the import equals the live configuration minus secrets', JSON.stringify(back.settings) === JSON.stringify(expected),
  Object.keys(expected).filter((k) => JSON.stringify(back.settings[k]) !== JSON.stringify(expected[k])).join(', '));
check('the per-site overrides survive intact (PI-03)', JSON.stringify(back.settings.siteOverrides) === JSON.stringify(live.siteOverrides), back.settings.siteOverrides);
check('the worker-only keys are applied, not refused (PI-04)', back.settings.logThirdPartyBeacons === false && back.settings.downloadHashCheck === false
  && JSON.stringify(back.settings.memoryNeverSleepHosts) === JSON.stringify(['music.example', 'docs.example']));

/* the schema contract: every worker key is importable; every popup key is a worker key */
const notImportable = Object.keys(WORKER_DEFAULTS).filter((k) => !/Key$/.test(k) && !Object.prototype.hasOwnProperty.call(api.IMPORT_SCHEMA, k));
check('every key the worker exports is a key the importer accepts', notImportable.length === 0, notImportable.join(', '));
const notWorker = Object.keys(api.IMPORT_SCHEMA).filter((k) => !Object.prototype.hasOwnProperty.call(WORKER_DEFAULTS, k));
check('and the importer accepts nothing the worker does not have', notWorker.length === 0, notWorker.join(', '));
const wrongDefault = Object.keys(api.IMPORT_ONLY_DEFAULTS).filter((k) => JSON.stringify(api.IMPORT_ONLY_DEFAULTS[k]) !== JSON.stringify(WORKER_DEFAULTS[k]));
check('the import-only defaults match the worker\'s', wrongDefault.length === 0, wrongDefault.join(', '));

/* never applied as an empty object when the file held entries */
{
  const junk = api.sanitizeImportedSettings({ siteOverrides: { 'shop.example': { mediaShield: true }, 'x.example': 'nope' } });
  check('overrides that hold nothing usable are ignored, not applied as {}', !('siteOverrides' in junk.settings) && junk.ignored === 1, junk);
  const empty = api.sanitizeImportedSettings({ siteOverrides: {} });
  check('an honestly empty override map restores as empty', JSON.stringify(empty.settings.siteOverrides) === '{}' && empty.ignored === 0, empty);
  const mixed = api.sanitizeImportedSettings({ siteOverrides: { 'shop.example': { mediaShield: false, notAFeature: false, blockPopupTricks: true }, 'bank.example': [] } });
  check('inside a host only real feature keys turned off are kept', JSON.stringify(mixed.settings.siteOverrides) === JSON.stringify({ 'shop.example': { mediaShield: false } }), mixed.settings.siteOverrides);
  const notObj = api.sanitizeImportedSettings({ siteOverrides: 'shop.example' });
  check('a non-object is ignored', !('siteOverrides' in notObj.settings) && notObj.ignored === 1);
  const exportedJunk = api.exportableSettings({ siteOverrides: { 'shop.example': { mediaShield: false, sneaky: true } } });
  check('the exporter writes only what the importer can read back', JSON.stringify(exportedJunk.siteOverrides) === JSON.stringify({ 'shop.example': { mediaShield: false } }));
}

/* the status line can no longer report a blanked map as applied */
check('the importer reports what it ignored', /ignored ' \+ result\.ignored \+ ' unrecognised/.test(POPUP));

console.log('');
if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
console.log('a backup restores what it recorded');

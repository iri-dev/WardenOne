/*
 * Provider API keys must not leak out of extension storage.
 *
 * These are the only real secrets WardenOne holds. They are optional, user-supplied,
 * and belong to third-party accounts, so a leak costs the user something concrete.
 * The rules checked here are the ones that can be checked statically:
 *
 *   - never reach the MAIN world, where any page script could read them
 *   - never written into the activity history
 *   - masked in the interface
 *   - dropped when their provider is switched off
 *
 * Run: node tools/test-secret-hygiene.js
 */
'use strict';

const fs = require('fs');

const background = fs.readFileSync('background.js', 'utf8');
const bridge = fs.readFileSync('bridge.js', 'utf8');
const popupJs = fs.readFileSync('popup.js', 'utf8');
const popupHtml = fs.readFileSync('popup.html', 'utf8');

let failed = 0;
function check(name, ok, extra) {
  if (ok) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* Every secret-shaped field in the shipped defaults. Discovered, not hard-coded,
   so adding an eighth provider is covered automatically. */
const keys = [...new Set([...background.matchAll(/^\s*([a-zA-Z]+Key):\s*''/gm)].map((m) => m[1]))];
check('found the provider key fields', keys.length >= 7, keys.length + ' found: ' + keys.join(', '));

/* 1. Never into the MAIN world. */
const sendConfig = bridge.slice(bridge.indexOf('const sendConfig ='), bridge.indexOf("kind: 'config'"));
check('bridge strips secrets by pattern, not a hand-written list',
  /for \(const field of Object\.keys\(clean\)\)/.test(sendConfig) && /\/Key\$\/\.test\(field\)/.test(sendConfig),
  'a per-name delete list silently leaks when a provider is added');
for (const key of keys) {
  check('pattern covers ' + key, /Key$/.test(key), key + ' would not be stripped by the /Key$/ rule');
}
check('no secret is sent to the page by name anywhere in bridge.js',
  !keys.some((k) => new RegExp('overrides\\.' + k + '|clean\\.' + k + '\\s*=').test(bridge)));

/* 2. Never into the activity history. */
const historyWrites = [...background.matchAll(/queueHistory\(\{[\s\S]{0,400}?\}\)/g)].map((m) => m[0]);
const leaky = historyWrites.filter((w) => keys.some((k) => w.includes(k)));
check('no queueHistory call carries a provider key', leaky.length === 0, leaky.slice(0, 1).join(''));

/* 3. Masked in the interface. */
for (const key of keys) {
  const field = new RegExp('<input[^>]*data-config-text="' + key + '"', 'i');
  const match = popupHtml.match(field);
  if (!match) { check('input exists for ' + key, false, 'no popup field found'); continue; }
  check(key + ' input is masked', /type="password"/i.test(match[0]), match[0].slice(0, 80));
}

/* 4. Dropped when the provider is switched off. */
check('popup clears keys for disabled providers on save',
  /dropKeysForDisabledProviders\(config\);/.test(popupJs)
    && /function dropKeysForDisabledProviders/.test(popupJs));
const map = popupJs.slice(popupJs.indexOf('const PROVIDER_KEY_FIELDS'), popupJs.indexOf('function dropKeysForDisabledProviders'));
for (const key of keys) {
  check('clear-on-disable covers ' + key, map.includes(key), 'missing from PROVIDER_KEY_FIELDS');
}

/* 5. The settings export must not carry them.
      This slot used to assert that no export existed at all. One exists now, so the
      guard is stronger rather than gone: the export has to strip secrets by PATTERN
      (a hand-written list silently leaks the day an eighth provider is added), and
      the import has to refuse them too, so a hand-edited file cannot inject a key
      into someone's config. */
const exportFn = popupJs.slice(popupJs.indexOf('function exportableSettings'), popupJs.indexOf('function exportSettings'));
check('export exists and strips secrets by pattern, not a hand-written list',
  /SECRET_FIELD_RE\.test\(key\)/.test(exportFn) && /return;/.test(exportFn),
  'export must drop every /Key$/ field');
check('the export pattern is the same /Key$/ rule bridge.js uses',
  /const SECRET_FIELD_RE = \/Key\$\//.test(popupJs));
for (const key of keys) {
  check('export pattern covers ' + key, /Key$/.test(key), key + ' would survive the export filter');
}
const importFn = popupJs.slice(popupJs.indexOf('function sanitizeImportedSettings'), popupJs.indexOf('function importSettingsFromFile'));
check('import refuses to set any secret field',
  /SECRET_FIELD_RE\.test\(key\)/.test(importFn),
  'a hand-edited file could otherwise inject a provider key');
check('import only accepts keys that exist in the shipped defaults',
  /hasOwnProperty\.call\(DEFAULTS, key\)/.test(importFn));
check('no exported settings payload is built in the background worker',
  !/kind === '(export|export-settings|backup)'/.test(background),
  'export lives in the popup, which already holds the config; a background message would be a new surface');

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nsecret hygiene checks passed (' + keys.length + ' provider keys audited)');

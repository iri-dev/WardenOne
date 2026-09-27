/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
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
 *   - read by something: a key the worker never consults is a secret kept for a
 *     capability that does not exist (BUG-09), and the popup may only offer a
 *     field for a key the worker has
 *   - purged from stored config when a build stops having a use for one
 *
 * Run: node tools/test-secret-hygiene.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const background = fs.readFileSync(process.env.WARDENONE_BACKGROUND || 'background.js', 'utf8');
const bridge = fs.readFileSync('bridge.js', 'utf8');
const popupJs = fs.readFileSync(process.env.WARDENONE_POPUP || 'popup.js', 'utf8');
const popupHtml = fs.readFileSync(process.env.WARDENONE_POPUP_HTML || 'popup.html', 'utf8');
/* Every file that runs in the worker: a key is "read" only if one of these reads it. */
const workerFiles = fs.readdirSync('.').filter((f) => /^background(-[a-z-]+)?\.js$/.test(f) || f === 'network.js').sort();
const worker = workerFiles.map((f) => ({ file: f, text: f === 'background.js' ? background : fs.readFileSync(f, 'utf8') }));

let failed = 0;
function check(name, ok, extra) {
  if (ok) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* Every secret-shaped field in the shipped defaults. Discovered, not hard-coded,
   so adding an eighth provider is covered automatically. */
const keys = [...new Set([...background.matchAll(/^\s*([a-zA-Z]+Key):\s*''/gm)].map((m) => m[1]))];
check('found the provider key fields', keys.length >= 6, keys.length + ' found: ' + keys.join(', '));
check('the worker files were found', workerFiles.length >= 6 && workerFiles.includes('background-downloads.js'), workerFiles.join(', '));

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

/* 4. Keys remain available for explicit manual checks when automatic lookups are off. */
check('popup normalizes saved provider keys without clearing disabled ones',
  /normalizeStoredProviderKeys\(config\);/.test(popupJs)
    && /function normalizeStoredProviderKeys/.test(popupJs)
    && !/dropKeysForDisabledProviders/.test(popupJs));
const map = popupJs.slice(popupJs.indexOf('const PROVIDER_KEY_FIELDS'), popupJs.indexOf('function normalizeStoredProviderKeys'));
for (const key of keys) {
  check('manual-check key inventory covers ' + key, map.includes(key), 'missing from PROVIDER_KEY_FIELDS');
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
check('import only accepts keys that exist in the shipped schema (the popup table plus the worker-only keys, PI-04)',
  /hasOwnProperty\.call\(IMPORT_SCHEMA, key\)/.test(importFn)
  && /const IMPORT_SCHEMA = Object\.assign\(\{\}, IMPORT_ONLY_DEFAULTS, DEFAULTS\);/.test(popupJs));
check('no exported settings payload is built in the background worker',
  !/kind === '(export|export-settings|backup)'/.test(background),
  'export lives in the popup, which already holds the config; a background message would be a new surface');

/* 6. Read by something (BUG-09).
      The popup accepted an "Optional OpenPhish token", persisted it in config.openPhishKey and
      kept it for as long as OpenPhish stayed on -- and nothing read it. The community feed takes
      no key, and the one place that said so was the result of a Test button a reader who pastes
      and saves never presses. A secret-shaped default that no worker file reads as a property is
      a credential kept for a capability that does not exist, and it fails here. The default
      line itself is not a read, and neither is a shorthand `key,` in an object literal. */
function readsKey(text, key) {
  const read = new RegExp('[.\\[]\\s*[\'"]?' + key + '\\b');
  const own = new RegExp('^\\s*' + key + ":\\s*''");
  return text.split('\n').some((line) => read.test(line) && !own.test(line));
}
for (const key of keys) {
  const readers = worker.filter((w) => readsKey(w.text, key)).map((w) => w.file);
  check(key + ' is read by the worker', readers.length > 0, 'no worker file reads it: a stored credential nothing consults');
}

/* 7. The popup offers a field only for a key the worker has, and OpenPhish has none.
      A field with no default behind it is how an unused token gets stored in the first place.
      (Section 3 already checks the other direction: every default has a masked field.) */
const fields = [...popupHtml.matchAll(/data-config-text="([a-zA-Z]+Key)"/g)].map((m) => m[1]);
check('found the popup key fields', fields.length >= 6, fields.length + ' found: ' + fields.join(', '));
for (const field of fields) {
  check('popup field ' + field + ' has a worker default', keys.includes(field), 'a field the worker has no setting for');
}
check('OpenPhish, whose community feed takes no key, offers no token field and keeps no token',
  !/openPhishKey/.test(popupHtml) && !/openPhishKey/.test(popupJs) && !/^\s*openPhishKey:\s*''/m.test(background),
  'the field stored a token nothing read, and only the Test result admitted it (BUG-09)');
const openPhishProvider = (popupJs.match(/\{ key: 'openPhish',[^\n]*/) || [''])[0];
check('the OpenPhish provider row is keyless by declaration, not by an undefined field',
  /noKey: true/.test(openPhishProvider) && !/keyField/.test(openPhishProvider), openPhishProvider.slice(0, 120));
check('the OpenPhish feed test takes no token, and no longer tells the reader one was saved',
  /=== 'openPhish'\) return testOpenPhishKey\(\);/.test(background)
  && /async function testOpenPhishKey\(\) \{/.test(background) && !/Token saved/.test(background));

/* 8. A token an earlier build stored is purged on update.
      Removing the field leaves every token already pasted sitting in chrome.storage.local, so the
      update migration deletes, by pattern, every secret-shaped field this build has no default
      for -- and leaves the keys the build does have alone. Driven for real: the shipped
      onInstalled handler runs against a scripted storage. */
function runUpdate(initial) {
  const start = background.indexOf('chrome.runtime.onInstalled.addListener');
  const end = background.indexOf('chrome.runtime.onStartup', start);
  if (start < 0 || end < 0) return null;
  const defAt = background.indexOf('const DEFAULT_CONFIG = {');
  const defaults = vm.runInNewContext('(' + background.slice(defAt + 'const DEFAULT_CONFIG = '.length, background.indexOf('\n};', defAt) + 2) + ')', Object.create(null));
  const writes = [];
  let stored = initial;
  let handler = null;
  const resolved = { catch() { return resolved; } };
  const sandbox = {
    DEFAULT_CONFIG: defaults, Object, RegExp, String, Array,
    chrome: {
      runtime: { onInstalled: { addListener(fn) { handler = fn; } }, getURL: (v) => 'chrome-extension://test/' + v },
      storage: { local: { get(_k, cb) { cb({ wardenone_config: stored }); } } },
      tabs: { create() {} },
    },
    localSet(value) { writes.push(value); if (value && value.wardenone_config) stored = value.wardenone_config; return resolved; },
    markBrowserSessionStart() {}, scheduleUpdates() {}, pruneStorageIfNeeded() { return resolved; },
    updateRemoteListsWithRetry() {}, applyScriptShieldRules() {}, refreshExtensionState() {},
  };
  vm.runInNewContext(background.slice(start, end), sandbox, { filename: 'background.js:onInstalled' });
  if (typeof handler !== 'function') return null;
  handler({ reason: 'update' });
  return { stored, writes };
}
/* A config every earlier migration has already touched, so the only reason to write is ours. */
const settled = { __locationPrivacyV344Enabled: true, googleSearchResultCleanup: false, phishTank: true, phishTankKey: 'keep-me', openPhish: true };
{
  const r = runUpdate(Object.assign({}, settled, { openPhishKey: 'pasted-once-never-read' }));
  check('the update handler could be driven', !!r);
  check('a stored OpenPhish token is deleted on update', !!r && !('openPhishKey' in r.stored), r && JSON.stringify(Object.keys(r.stored)));
  check('a key the build does use is left alone', !!r && r.stored.phishTankKey === 'keep-me' && r.stored.phishTank === true);
  check('the purge is written back to storage', !!r && r.writes.length === 1 && r.writes[0].wardenone_config && !('openPhishKey' in r.writes[0].wardenone_config));
}
{
  const r = runUpdate(Object.assign({}, settled, { someFutureProviderKey: 'orphan', legitimateKey: 'x' }));
  check('the purge is by pattern: any secret-shaped field without a default goes',
    !!r && !('someFutureProviderKey' in r.stored) && !('legitimateKey' in r.stored), r && JSON.stringify(Object.keys(r.stored)));
}
{
  const r = runUpdate(Object.assign({}, settled));
  check('a config with nothing to purge is not rewritten', !!r && r.writes.length === 0, r && r.writes.length + ' writes');
}
{
  const r = runUpdate(Object.assign({}, settled, { openPhishKey: '' }));
  check('an empty leftover field is removed too', !!r && !('openPhishKey' in r.stored));
}

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nsecret hygiene checks passed (' + keys.length + ' provider keys audited)');

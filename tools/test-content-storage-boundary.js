/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const directStorageReaders = [
  'bridge.js',
  'eyeshield.js',
  'consent-wall.js',
  'consent-reject.js',
  'search-junk.js',
  'oauth-guard.js',
  'twitch-rewind.js',
  'twitch-vod-rewind.js',
];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  - ' + name);
  } catch (e) {
    console.error('  FAIL - ' + name);
    throw e;
  }
}

check('local and session storage are restricted to trusted extension contexts', () => {
  const block = BG.slice(BG.indexOf('function restrictStorageToTrustedContexts'), BG.indexOf('// Chrome storage.local'));
  assert(/chrome\.storage && chrome\.storage\.local/.test(block));
  assert(/chrome\.storage && chrome\.storage\.session/.test(block));
  assert(/setAccessLevel\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/.test(block));
  assert(/restrictStorageToTrustedContexts\(\);/.test(block));
});

const configStart = BG.indexOf('const DEFAULT_CONFIG =');
const configEnd = BG.indexOf('// ---- Onboarding protection bundles', configStart);
assert(configStart >= 0 && configEnd > configStart, 'content config sanitizer moved in background.js');
const sandbox = { Set, Object, String, Number, Array, JSON, Promise, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(BG.slice(configStart, configEnd) + '\nglobalThis.__configBoundary = { DEFAULT_CONFIG, sanitizeContentConfig };', sandbox,
  { filename: 'background.js:content-config' });

const api = sandbox.__configBoundary;
const secretFields = Object.keys(api.DEFAULT_CONFIG).filter((key) => /Key$/.test(key));

check('the worker sanitizer preserves protection settings but rejects secrets and arbitrary fields', () => {
  assert(secretFields.length >= 7, 'expected the provider credential fields in DEFAULT_CONFIG');
  const raw = {
    enabled: false,
    blockTokenExfil: true,
    allowlist: ['example.com'],
    rebindQuarantine: ['rebound.invalid'],
    forgetMeAllConfirmedAt: 123,
    internalBrowsingRecord: { url: 'https://private.invalid/' },
  };
  for (const key of secretFields) raw[key] = 'must-not-leave-storage';
  const clean = api.sanitizeContentConfig(raw);
  assert.strictEqual(clean.enabled, false);
  assert.strictEqual(clean.blockTokenExfil, true);
  assert.deepStrictEqual(Array.from(clean.allowlist), ['example.com']);
  assert.deepStrictEqual(Array.from(clean.rebindQuarantine), ['rebound.invalid']);
  assert(!Object.prototype.hasOwnProperty.call(clean, 'forgetMeAllConfirmedAt'));
  assert(!Object.prototype.hasOwnProperty.call(clean, 'internalBrowsingRecord'));
  for (const key of secretFields) assert(!Object.prototype.hasOwnProperty.call(clean, key), key + ' escaped the sanitizer');
});

check('every former content-script storage reader now uses the sanitized worker channel', () => {
  for (const file of directStorageReaders) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert(!/chrome\.storage(?:\?|)\.(?:local|onChanged)|chrome\.storage\?\.local/.test(source), file + ' still touches extension storage');
    assert(source.includes("kind: 'content-config-get'"), file + ' does not request the bounded snapshot');
  }
});

check('the content configuration channel is tab-only, rate-limited, and handled', () => {
  assert(BG.includes("'content-config-get',"), 'message is absent from the tab allowlist');
  assert(/'content-config-get': \{ max: \d+, windowMs: 60000 \}/.test(BG), 'message has no tab rate limit');
  assert(/msg\.kind === 'content-config-get' && messageSenderIsTab\(sender\)/.test(BG), 'handler does not require a tab sender');
  assert(/respond\(buildContentConfigSnapshot\(\), sendResponse\)/.test(BG), 'handler does not use the sanitizer snapshot');
});

check('all manifest isolated-world scripts remain free of direct storage access', () => {
  const isolated = new Set();
  for (const entry of MANIFEST.content_scripts || []) {
    if (entry.world === 'MAIN') continue;
    for (const file of entry.js || []) isolated.add(file);
  }
  for (const file of isolated) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert(!/chrome\.storage(?:\?|)\.(?:local|onChanged)|chrome\.storage\?\.local/.test(source), file + ' bypasses the trusted worker');
  }
});

console.log('[ok] content storage boundary checks passed (' + passed + ' checks)');

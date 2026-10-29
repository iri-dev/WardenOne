/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { migrateStoredConfig } = require('../upgrade-config.js');

const defaults = { phishTankKey: '', blockGeolocation: true };
const legacy = {
  blockGeolocation: false, googleSearchResultCleanup: true,
  stopYouTubeVideoPreviews: true, retiredProviderKey: 'synthetic', phishTankKey: 'kept',
};
const migrated = structuredClone(legacy);
assert.equal(migrateStoredConfig(migrated, defaults), migrated);
assert.equal(migrated.blockGeolocation, false);
assert.equal(migrated.__locationPrivacyV344Enabled, true);
assert.equal(migrated.blockSearchAiAnswers, true);
assert.equal(migrated.blockSponsoredSearchResults, true);
assert.equal(migrated.googleSearchResultCleanup, false);
assert.equal(migrated.stopAnimatedVideoPreviews, true);
assert.equal('stopYouTubeVideoPreviews' in migrated, false);
assert.equal('retiredProviderKey' in migrated, false);
assert.equal(migrated.phishTankKey, 'kept');
assert.equal(migrateStoredConfig(migrated, defaults), false);

const source = fs.readFileSync('background.js', 'utf8');
assert.match(source, /importScripts\('upgrade-config\.js'\)/);
assert.match(source, /CORE_FILES\.push\([^;]*'upgrade-config\.js'/);
assert(require('./package-allowlist.json').includes('upgrade-config.js'));
const start = source.indexOf('function runStoredConfigMigration()');
const end = source.indexOf('\n}\n', start);
assert(start >= 0 && end > start);
assert.match(source.slice(end, source.indexOf('chrome.runtime.onInstalled', end)), /runStoredConfigMigration\(\)\.catch/);

let stored = structuredClone(legacy);
let failNextWrite = true;
const sandbox = {
  DEFAULT_CONFIG: defaults, migrateStoredConfig,
  updateStoredConfig: async mutate => {
    const candidate = structuredClone(stored);
    const result = mutate(candidate, stored);
    if (result === false) return null;
    if (failNextWrite) { failNextWrite = false; throw Error('synthetic storage write failure'); }
    stored = candidate;
    return candidate;
  },
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end + 3) + '\nthis.runMigration = runStoredConfigMigration;', sandbox);

(async () => {
  await assert.rejects(sandbox.runMigration(), /synthetic storage write failure/);
  assert.deepEqual(stored, legacy, 'failed write left the old stored state intact');
  await sandbox.runMigration();
  assert.equal(stored.stopAnimatedVideoPreviews, true);
  assert.equal('stopYouTubeVideoPreviews' in stored, false);
  assert.equal('retiredProviderKey' in stored, false);
  assert.equal(await sandbox.runMigration(), null, 'repeated startup did not write again');

  let interruptedStore = structuredClone(legacy);
  let reachedWrite = false;
  const interrupted = { DEFAULT_CONFIG: defaults, migrateStoredConfig,
    updateStoredConfig: mutate => {
      const candidate = structuredClone(interruptedStore);
      mutate(candidate, interruptedStore);
      reachedWrite = true;
      return new Promise(() => {});
    } };
  vm.createContext(interrupted);
  vm.runInContext(source.slice(start, end + 3) + '\nthis.runMigration = runStoredConfigMigration;', interrupted);
  interrupted.runMigration();
  assert.equal(reachedWrite, true);
  assert.deepEqual(interruptedStore, legacy, 'interrupted worker committed no partial migration');

  const recovered = { DEFAULT_CONFIG: defaults, migrateStoredConfig,
    updateStoredConfig: async mutate => {
      const candidate = structuredClone(interruptedStore);
      const result = mutate(candidate, interruptedStore);
      if (result === false) return null;
      interruptedStore = candidate;
      return candidate;
    } };
  vm.createContext(recovered);
  vm.runInContext(source.slice(start, end + 3) + '\nthis.runMigration = runStoredConfigMigration;', recovered);
  await recovered.runMigration();
  assert.equal(interruptedStore.stopAnimatedVideoPreviews, true);
  assert.equal('stopYouTubeVideoPreviews' in interruptedStore, false);
  console.log('upgrade config migration checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

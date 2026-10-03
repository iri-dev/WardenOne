/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Settings page's "Recently changed" list.
 * Run: node tools/test-settings-change-log.js
 *
 * The worker records every switch that changes, from whichever page changed it. The list is
 * shown to the reader, so it must never hold an API key, a host map or a timestamp field, and it
 * must not fill with "changes" nobody made: a fresh install, the write after an erase, or a
 * missing key being filled in with its default.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  assert(a >= 0 && b > a, 'missing boundary: ' + start);
  return src.slice(a, b);
}

function harness(stored) {
  const store = Object.assign({}, stored || {});
  const ctx = {
    DEFAULT_CONFIG: { enabled: true, blockTrackers: true, capReferrer: false, deAmp: false, forgetMeMode: 'off', urlHausKey: '' },
    localGet: async (key) => ({ [key]: store[key] }),
    localSet: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
    Date, Promise, Set, Array, Object, Number, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(between(background, 'const SETTINGS_RECENT_KEY', '\n// Re-apply when the user changes settings')
    + '\nglobalThis.__api = { settingsChangesBetween, recordSettingsChanges, SETTINGS_RECENT_KEY, SETTINGS_RECENT_MAX };', ctx);
  return { api: ctx.__api, store };
}

let checks = 0;
function check(label, ok) {
  checks++;
  assert(ok, label);
}

(async () => {
  const { api } = harness();
  const at = 1760000000000;
  const before = { enabled: true, blockTrackers: true, capReferrer: false, urlHausKey: '', forgetMeMode: 'off', allowlist: [] };

  const flipped = api.settingsChangesBetween(before, Object.assign({}, before, { capReferrer: true }), at);
  check('a flipped switch is recorded with where it came from',
    flipped.length === 1 && flipped[0].key === 'capReferrer' && flipped[0].from === false && flipped[0].to === true && flipped[0].at === at);

  const secrets = api.settingsChangesBetween(before, Object.assign({}, before, {
    urlHausKey: 'secret-key', forgetMeAllConfirmedAt: at, allowlist: ['example.com'],
    allowlistUntil: { 'example.com': at }, __locationPrivacyV344Enabled: true, tabLimitMax: 30,
  }), at);
  check('keys, timestamps, host lists, numbers and migration flags are never recorded', secrets.length === 0);
  check('no API key value can reach the list', !JSON.stringify(secrets).includes('secret-key'));

  const choice = api.settingsChangesBetween(before, Object.assign({}, before, { forgetMeMode: 'all' }), at);
  check('a named choice is recorded', choice.length === 1 && choice[0].key === 'forgetMeMode' && choice[0].to === 'all');

  check('a fresh install records nothing', api.settingsChangesBetween(undefined, before, at).length === 0);
  check('an erase records nothing', api.settingsChangesBetween(before, undefined, at).length === 0);

  const filled = api.settingsChangesBetween({ enabled: true }, { enabled: true, blockTrackers: true, deAmp: true }, at);
  check('a missing key arriving at its default is not a change, but one arriving changed is',
    filled.length === 1 && filled[0].key === 'deAmp' && filled[0].from === false);

  check('bookkeeping the popup rewrites on every save is left out',
    api.settingsChangesBetween({ antiFingerprint: true, googleSearchResultCleanup: true }, { antiFingerprint: false, googleSearchResultCleanup: false }, at).length === 0);

  const h = harness({ wardenone_settings_recent: [
    { key: 'deAmp', from: false, to: true, at: Date.now() - 1000 },
    { key: 'capReferrer', from: false, to: true, at: Date.now() - 2000 },
    { key: 'blockTrackers', from: true, to: false, at: Date.now() - 31 * 24 * 60 * 60 * 1000 },
  ] });
  await h.api.recordSettingsChanges([{ key: 'capReferrer', from: true, to: false, at: Date.now() }]);
  const list = h.store.wardenone_settings_recent;
  check('newest first, one entry per setting', list[0].key === 'capReferrer' && list[0].to === false
    && list.filter((entry) => entry.key === 'capReferrer').length === 1 && list[1].key === 'deAmp');
  check('entries older than 30 days are dropped', !list.some((entry) => entry.key === 'blockTrackers'));

  const many = Array.from({ length: 60 }, (_, i) => ({ key: 'switch' + i, from: false, to: true, at: Date.now() }));
  await h.api.recordSettingsChanges(many);
  check('the list keeps at most ' + h.api.SETTINGS_RECENT_MAX + ' entries', h.store.wardenone_settings_recent.length === h.api.SETTINGS_RECENT_MAX);

  const c = harness();
  await Promise.all([
    c.api.recordSettingsChanges([{ key: 'a', from: false, to: true, at: Date.now() }]),
    c.api.recordSettingsChanges([{ key: 'b', from: false, to: true, at: Date.now() }]),
  ]);
  check('two quick changes are both kept', c.store.wardenone_settings_recent.map((entry) => entry.key).join() === 'b,a');

  const listener = between(background, '// Re-apply when the user changes settings', '\n});\n');
  check('the storage listener records config and Script Shield changes',
    /settingsChangesBetween\(config\.oldValue, config\.newValue, at\)/.test(listener)
      && listener.includes('changes[SCRIPT_SHIELD_MODE_KEY]') && listener.includes('recordSettingsChanges(entries)'));

  const policy = between(background, 'const PRIVACY_STORE_POLICY', '\nconst PRIVACY_STORE_BY_KEY');
  check('the change list is in the storage inventory with its limits',
    /owner: 'Settings change list'[^\n]*maxAgeDays: 30, maxItems: 40[^\n]*siteErase: 'keep'/.test(policy)
      && policy.includes("'wardenone_settings_recent'"));
  check('favourites are in the storage inventory', policy.includes("'wardenone_settings_favorites'"));

  console.log('settings change log: ' + checks + ' checks passed');
})().catch((error) => { console.error('FAIL - ' + (error && error.message || error)); process.exit(1); });

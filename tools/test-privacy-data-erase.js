/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const start = bg.indexOf('function privacyStoreTimestamp(');
const end = bg.indexOf('\nchrome.runtime.onMessage.addListener(', start);
assert(start >= 0 && end > start, 'privacy erase functions exist');

function harness(initialLocal, initialSession, options = {}) {
  const local = Object.assign({}, initialLocal);
  const session = Object.assign({}, initialSession);
  const dynamic = [{ id: 100 }, { id: 101 }];
  const sessionRules = [{ id: 200 }];
  const timers = [];
  let reloaded = false;
  const area = (state) => ({
    async get() { return Object.assign({}, state); },
    async clear() { for (const key of Object.keys(state)) delete state[key]; },
    async remove(key) { delete state[key]; },
    async set(values) {
      Object.assign(state, values);
      if (state === local && options.staleDuringMarker && values.wardenone_config_reset) {
        state.wardenone_config = options.staleDuringMarker;
        state.wardenone_config_writes = { ids: ['pre-reset'] };
      }
    },
  });
  const sandbox = {
    chrome: {
      storage: { local: area(local), session: area(session), onChanged: { addListener() {} } },
      declarativeNetRequest: {
        async getDynamicRules() { return dynamic.slice(); },
        async getSessionRules() { return sessionRules.slice(); },
        async updateDynamicRules({ removeRuleIds }) {
          if (options.failDynamicRules) throw new Error('DNR update failed');
          for (const id of removeRuleIds) dynamic.splice(dynamic.findIndex((r) => r.id === id), 1);
        },
        async updateSessionRules({ removeRuleIds }) {
          for (const id of removeRuleIds) sessionRules.splice(sessionRules.findIndex((r) => r.id === id), 1);
        },
      },
      runtime: { reload() { reloaded = true; } },
    },
    TextEncoder,
    Date, URL,
    siteIdentityBg(host) { return host.endsWith('.webflow.io') ? host : host.split('.').slice(-2).join('.'); },
    setTimeout: (fn) => { timers.push(fn); },
  };
  vm.createContext(sandbox);
  /* The reset clears and rewrites the config under the config lock (config-lock.js). */
  vm.runInContext(require('./config-write-harness.js').LOCK_SOURCE + '\n'
    + 'const DEFAULT_CONFIG = { enabled: true, downloadSafeBrowsingKey: "", siteOverrides: {}, allowlist: [] };'
    + 'const PRIVACY_ERASE_REBUILD_KEY = "wardenone_erase_rebuild";'
    + 'let __privacyEraseInProgress = false;' + bg.slice(start, end)
    + '\nglobalThis.__api = { inspectWardenOneData, eraseWardenOneData, eraseWardenOneSite, repairConfigAfterReset, preservedPrivacyConfig, policy: PRIVACY_STORE_POLICY };', sandbox);
  return { api: sandbox.__api, local, session, dynamic, sessionRules, timers, reloaded: () => reloaded };
}

(async () => {
  let h = harness({ wardenone_history: [{ at: Date.now() - 86400000 }] }, {});
  const inventory = await h.api.inspectWardenOneData();
  assert.strictEqual(inventory.ok, true);
  assert.strictEqual(inventory.records.length, 1);
  assert(inventory.records[0].bytes > 0 && inventory.records[0].oldestKnownAt);
  assert.strictEqual(inventory.records[0].retention, '30 days; latest 200 events');

  const policies = h.api.policy;
  const registered = policies.flatMap((policy) => Array.from(policy.keys));
  assert.strictEqual(new Set(registered).size, registered.length, 'store registry has duplicate keys');
  for (const key of ['wardenone_notifications', 'wardenone_tracker_learner', 'wardenone_script_drift_baselines']) {
    const policy = policies.find((entry) => entry.keys.includes(key));
    assert.strictEqual(policy.maxAgeDays, null, key + ' has no global maximum age');
  }
  const runtime = fs.readdirSync(root).filter((name) => name.endsWith('.js')
    && name !== 'content.min.js' && name !== 'fingerprint-realm.js');
  const named = new Set();
  for (const name of runtime) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of source.matchAll(/\b(?:__)?wardenone_[a-z0-9_]+\b/g)) named.add(match[0]);
  }
  assert.deepStrictEqual([...named].filter((key) => !registered.includes(key)).sort(), [],
    'new WardenOne stores need owner, sensitivity, retention, limits and site-erase policy');
  const oldAt = Date.now() - 90 * 86400000;
  h = harness({ wardenone_history: Array.from({ length: 120 }, (_, i) => ({ at: i === 119 ? oldAt : Date.now() - 86400000 })) }, {});
  const largeInventory = await h.api.inspectWardenOneData();
  assert.strictEqual(largeInventory.records[0].oldestKnownAt, oldAt, 'preview must inspect past the first hundred records');

  const cfg = { enabled: false, downloadSafeBrowsingKey: 'secret', siteOverrides: { 'example.test': { adShield: false } }, allowlist: ['example.test'] };
  assert.strictEqual(h.api.preservedPrivacyConfig(cfg, 'all'), null);
  assert.deepStrictEqual(Object.keys(h.api.preservedPrivacyConfig(cfg, 'settings')).sort(), ['enabled']);
  assert.deepStrictEqual(Object.keys(h.api.preservedPrivacyConfig(cfg, 'settings-and-keys')).sort(), ['downloadSafeBrowsingKey', 'enabled']);

  h = harness({ wardenone_pending_downloads: { abc: { downloadId: 5 } }, wardenone_config: cfg }, {});
  assert.strictEqual((await h.api.eraseWardenOneData('all')).ok, false);
  assert(h.local.wardenone_pending_downloads && h.dynamic.length === 2);

  h = harness({ wardenone_history: [1], wardenone_config: cfg }, { wardenone_badge_counts: { 1: 2 } });
  assert.strictEqual((await h.api.eraseWardenOneData('settings')).ok, true);
  assert.deepStrictEqual(Object.keys(h.local), ['wardenone_config']);
  assert.strictEqual(h.local.wardenone_config.enabled, false);
  assert.strictEqual(h.local.wardenone_config.downloadSafeBrowsingKey, undefined);
  assert.strictEqual(h.local.wardenone_config.siteOverrides, undefined);
  assert.deepStrictEqual(Object.keys(h.session), ['wardenone_erase_rebuild']);
  assert.strictEqual(h.dynamic.length + h.sessionRules.length, 0);

  h = harness({
    wardenone_history: [{ url: 'https://erase.example/one' }, { url: 'https://keep.example/two' }],
    wardenone_config: { enabled: false, downloadSafeBrowsingKey: 'secret',
      allowlist: ['erase.example', 'keep.example'],
      siteOverrides: { 'erase.example': { adShield: false }, 'keep.example': { adShield: true } } },
    wardenone_safe_browsing_cache: { opaqueHash: { hit: true } },
    wardenone_script_drift_baselines: { opaqueHash: { hash: 'digest' } },
    wardenone_blocklist: ['erase.example', 'keep.example'],
    wardenone_cryptominer_domains: { minerHosts: ['erase.example', 'public.example'], poolHosts: [] },
    wardenone_user_rules: { text: '||erase.example^\n||keep.example^\nerase.example,keep.example##.banner', updatedAt: Date.now() },
    wardenone_unusual_record: { items: [{ site: 'erase.example', at: Date.now() }, { site: 'keep.example', at: Date.now() }] },
  }, { wardenone_startup_report: { hosts: ['erase.example', 'keep.example'] } });
  const sitePlan = await h.api.eraseWardenOneSite('erase.example', true);
  assert.strictEqual(sitePlan.ok, true);
  assert(sitePlan.affected.some((entry) => entry.key === 'wardenone_safe_browsing_cache'));
  assert.strictEqual(h.local.wardenone_history.length, 2, 'dry run must not change storage');
  const siteErased = await h.api.eraseWardenOneSite('erase.example', false);
  assert.strictEqual(siteErased.ok, true);
  assert(!JSON.stringify(Object.entries(h.local).filter(([key]) => key !== 'wardenone_cryptominer_domains')).includes('erase.example')
    && !JSON.stringify(h.session).includes('erase.example'));
  assert(JSON.stringify(h.local).includes('keep.example') && JSON.stringify(h.session).includes('keep.example'));
  assert.deepStrictEqual(Array.from(h.local.wardenone_blocklist), ['keep.example'], 'user blocklist loses only this site');
  assert.deepStrictEqual(Array.from(h.local.wardenone_cryptominer_domains.minerHosts), ['erase.example', 'public.example'], 'public list remains intact');
  assert.strictEqual(h.local.wardenone_user_rules.text, '||keep.example^\nkeep.example##.banner',
    'site erase keeps unrelated user rules and the other half of a cosmetic rule');
  assert.strictEqual(h.local.wardenone_config.enabled, false);
  assert.strictEqual(h.local.wardenone_config.downloadSafeBrowsingKey, 'secret');
  assert.strictEqual(h.local.wardenone_safe_browsing_cache, undefined);
  assert.strictEqual(h.local.wardenone_script_drift_baselines, undefined);
  assert.strictEqual(h.dynamic.length + h.sessionRules.length, 0);
  h.timers[0]();
  assert.strictEqual(h.reloaded(), true);

  h = harness({ wardenone_history: [{ url: 'https://erase.example/' }] }, {}, { failDynamicRules: true });
  const partial = await h.api.eraseWardenOneSite('erase.example', false);
  assert.strictEqual(partial.ok, false);
  assert(partial.error.includes('restarting') && partial.error.includes('retry'));
  assert.strictEqual(h.local.wardenone_history.length, 0, 'completed storage writes remain erased');
  h.timers[0]();
  assert.strictEqual(h.reloaded(), true, 'partial failure restarts before stale state can repopulate storage');

  h = harness({ wardenone_history: [{ url: 'https://alice.webflow.io/' }, { url: 'https://bob.webflow.io/' }] }, {});
  assert.strictEqual((await h.api.eraseWardenOneSite('alice.webflow.io', false)).ok, true);
  assert.strictEqual(h.local.wardenone_history.length, 1);
  assert.strictEqual(h.local.wardenone_history[0].url, 'https://bob.webflow.io/');
  h.timers[0]();
  assert.strictEqual(h.reloaded(), true);

  h = harness({ wardenone_history: [1], wardenone_config: cfg }, {});
  assert.strictEqual((await h.api.eraseWardenOneData('settings-and-keys')).ok, true);
  assert.strictEqual(h.local.wardenone_config.downloadSafeBrowsingKey, 'secret');
  assert.strictEqual(h.local.wardenone_config.siteOverrides, undefined);

  h = harness({ wardenone_config: cfg, wardenone_config_writes: { ids: ['old'] } }, {});
  assert.strictEqual((await h.api.eraseWardenOneData('all')).ok, true);
  assert.strictEqual(h.local.wardenone_config, undefined);
  assert.strictEqual(typeof h.local.wardenone_config_reset.epoch, 'string');
  assert.strictEqual(h.local.wardenone_config_writes.epoch, h.local.wardenone_config_reset.epoch);
  h = harness({ wardenone_config: cfg }, {}, { staleDuringMarker: cfg });
  assert.strictEqual((await h.api.eraseWardenOneData('all')).ok, true);
  assert.strictEqual(h.local.wardenone_config, undefined, 'a stale write during marker installation is erased');
  assert.strictEqual(h.local.wardenone_config_writes.epoch, h.local.wardenone_config_reset.epoch);
  h = harness({ wardenone_config: cfg, wardenone_config_writes: { ids: ['old'] } }, {});
  assert.strictEqual((await h.api.eraseWardenOneData('all')).ok, true);
  await h.api.repairConfigAfterReset();
  h.local.wardenone_config = cfg;
  h.local.wardenone_config_writes = { ids: ['old'] };
  await h.api.repairConfigAfterReset();
  assert.strictEqual(h.local.wardenone_config, undefined, 'a pre-reset writer cannot restore erased settings');
  assert.strictEqual(h.local.wardenone_config_writes.epoch, h.local.wardenone_config_reset.epoch);
  const savedAfterReset = { enabled: true, deAmp: true };
  const lineageAfterReset = { epoch: h.local.wardenone_config_reset.epoch, ids: ['new'] };
  h.local.wardenone_config = cfg;
  h.local.wardenone_config_writes = { ids: ['old'] };
  await h.api.repairConfigAfterReset({ wardenone_config: { oldValue: savedAfterReset },
    wardenone_config_writes: { oldValue: lineageAfterReset } });
  assert.strictEqual(h.local.wardenone_config.deAmp, true, 'repair restores a valid post-reset edit');
  assert.strictEqual(h.local.wardenone_config.downloadSafeBrowsingKey, undefined);

  /* Seed every WardenOne-named runtime storage key found in the shipped scripts.
     This catches an erase implementation that switches from a full store clear to a
     hand-maintained list and accidentally leaves one feature's records behind. */
  const ownedKeys = new Set();
  for (const name of runtime) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of source.matchAll(/\bwardenone_[a-z0-9_]+\b/g)) ownedKeys.add(match[0]);
  }
  assert(ownedKeys.size >= 40, 'the all-store sentinel census unexpectedly shrank');
  const localSentinels = {};
  const sessionSentinels = {};
  for (const key of ownedKeys) {
    localSentinels[key] = { sentinel: 'local:' + key };
    sessionSentinels[key] = { sentinel: 'session:' + key };
  }
  localSentinels.wardenone_config = cfg;
  localSentinels.wardenone_pending_downloads = {};
  sessionSentinels.wardenone_pending_downloads = {};
  h = harness(localSentinels, sessionSentinels);
  const census = await h.api.inspectWardenOneData();
  assert.strictEqual(census.records.length, ownedKeys.size * 2);
  assert.strictEqual((await h.api.eraseWardenOneData('settings-and-keys')).ok, true);
  assert.deepStrictEqual(Object.keys(h.local), ['wardenone_config']);
  assert.deepStrictEqual(Object.keys(h.session), ['wardenone_erase_rebuild']);
  assert.strictEqual(h.local.wardenone_config.downloadSafeBrowsingKey, 'secret');
  assert.strictEqual(h.local.wardenone_config.siteOverrides, undefined);
  assert.strictEqual(h.dynamic.length + h.sessionRules.length, 0);

  assert(html.includes('id="privacy-data-inspect"') && html.includes('id="privacy-data-erase"'));
  assert(popup.includes("ask({ kind: 'privacy-data-inspect' })") && popup.includes("ask({ kind: 'privacy-data-erase', mode: choice })"));
  assert(bg.includes("msg.kind === 'privacy-data-erase' && messageSenderIsExtensionPage(sender)"));
  assert(bg.includes("msg.kind === 'privacy-data-erase-site' && messageSenderIsExtensionPage(sender)"));
  assert(html.includes('id="privacy-data-erase-site"') && popup.includes("kind: 'privacy-data-erase-site'"));
  console.log('[ok] privacy data inspection and erase tests');
})().catch((error) => { console.error(error); process.exitCode = 1; });

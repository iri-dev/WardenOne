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

function harness(initialLocal, initialSession) {
  const local = Object.assign({}, initialLocal);
  const session = Object.assign({}, initialSession);
  const dynamic = [{ id: 100 }, { id: 101 }];
  const sessionRules = [{ id: 200 }];
  const timers = [];
  let reloaded = false;
  const area = (state) => ({
    async get() { return Object.assign({}, state); },
    async clear() { for (const key of Object.keys(state)) delete state[key]; },
    async set(values) { Object.assign(state, values); },
  });
  const sandbox = {
    chrome: {
      storage: { local: area(local), session: area(session) },
      declarativeNetRequest: {
        async getDynamicRules() { return dynamic.slice(); },
        async getSessionRules() { return sessionRules.slice(); },
        async updateDynamicRules({ removeRuleIds }) {
          for (const id of removeRuleIds) dynamic.splice(dynamic.findIndex((r) => r.id === id), 1);
        },
        async updateSessionRules({ removeRuleIds }) {
          for (const id of removeRuleIds) sessionRules.splice(sessionRules.findIndex((r) => r.id === id), 1);
        },
      },
      runtime: { reload() { reloaded = true; } },
    },
    TextEncoder,
    Date,
    setTimeout: (fn) => { timers.push(fn); },
  };
  vm.createContext(sandbox);
  vm.runInContext('const DEFAULT_CONFIG = { enabled: true, downloadSafeBrowsingKey: "", siteOverrides: {}, allowlist: [] };'
    + 'const PRIVACY_ERASE_REBUILD_KEY = "wardenone_erase_rebuild";'
    + 'let __privacyEraseInProgress = false;' + bg.slice(start, end)
    + '\nglobalThis.__api = { inspectWardenOneData, eraseWardenOneData, preservedPrivacyConfig };', sandbox);
  return { api: sandbox.__api, local, session, dynamic, sessionRules, timers, reloaded: () => reloaded };
}

(async () => {
  let h = harness({ wardenone_history: [{ at: Date.now() - 86400000 }] }, {});
  const inventory = await h.api.inspectWardenOneData();
  assert.strictEqual(inventory.ok, true);
  assert.strictEqual(inventory.records.length, 1);
  assert(inventory.records[0].bytes > 0 && inventory.records[0].oldestKnownAt);
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
  h.timers[0]();
  assert.strictEqual(h.reloaded(), true);

  h = harness({ wardenone_history: [1], wardenone_config: cfg }, {});
  assert.strictEqual((await h.api.eraseWardenOneData('settings-and-keys')).ok, true);
  assert.strictEqual(h.local.wardenone_config.downloadSafeBrowsingKey, 'secret');
  assert.strictEqual(h.local.wardenone_config.siteOverrides, undefined);

  assert(html.includes('id="privacy-data-inspect"') && html.includes('id="privacy-data-erase"'));
  assert(popup.includes("ask({ kind: 'privacy-data-inspect' })") && popup.includes("ask({ kind: 'privacy-data-erase', mode: choice })"));
  assert(bg.includes("msg.kind === 'privacy-data-erase' && messageSenderIsExtensionPage(sender)"));
  console.log('[ok] privacy data inspection and erase tests');
})().catch((error) => { console.error(error); process.exitCode = 1; });

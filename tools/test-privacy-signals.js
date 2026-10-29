/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..'), helper = fs.readFileSync(path.join(root, 'privacy-signals.js'), 'utf8');
function realm(native = {}) {
  function Navigator() {}
  for (const [key, value] of Object.entries(native)) Object.defineProperty(Navigator.prototype, key, { get: () => value, configurable: true });
  const navigator = new Navigator(), window = {}, context = vm.createContext({ Navigator, navigator, window });
  vm.runInContext(helper, context);
  return { Navigator, navigator, window, control: window.__wardenOnePrivacySignals, context };
}
{
  const r = realm({ doNotTrack: '0' });
  assert.equal(r.navigator.globalPrivacyControl, true); assert.equal(r.navigator.doNotTrack, '1');
  vm.runInContext(helper, r.context); r.control.set(false);
  assert.equal(r.navigator.globalPrivacyControl, undefined); assert.equal(r.navigator.doNotTrack, '0');
  assert(!Object.hasOwn(r.navigator, 'globalPrivacyControl'));
  r.control.set(true); assert.equal(r.navigator.globalPrivacyControl, true); r.control.set(false);
  assert.equal(r.navigator.doNotTrack, '0');
}
{
  const r = realm({ globalPrivacyControl: true }); r.control.set(false); assert.equal(r.navigator.globalPrivacyControl, true, 'native preference survives extension pause');
  r.control.set(true); Object.defineProperty(r.navigator, 'globalPrivacyControl', { value: false, configurable: true });
  r.control.set(false); assert.equal(r.navigator.globalPrivacyControl, false, 'a later page-owned descriptor is preserved');
}
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const a = bg.indexOf('function privacySignalExclusions('), b = bg.indexOf('let __locationPrivacyHeaderRuleEnabled', a);
assert(a >= 0 && b > a);
const writes = [], scripts = [], executions = [];
const context = vm.createContext({ console, URL, Set, Object, JSON,
  activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: value => /^[a-z0-9.-]+$/.test(value) ? value : '',
  hostMatchesAllowlist: (h, list) => list.some(d => h === d || h.endsWith('.' + d)),
  PRIVACY_HEADER_RULE_ID: 900000, PRIVACY_HEADER_NAV_RULE_ID: 900008, ALL_DNR_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'image', 'xmlhttprequest', 'font', 'media'],
  writeSessionRules: async change => { if (context.rejectRules) throw Error('Native failure'); writes.push(JSON.parse(JSON.stringify(change))); },
  wardenOneSetPrivacySignals() {}, chrome: { scripting: {
    getRegisteredContentScripts: async () => scripts,
    registerContentScripts: async rows => scripts.push(...rows), updateContentScripts: async rows => scripts.splice(0, scripts.length, ...rows),
    unregisterContentScripts: async () => scripts.splice(0), executeScript: async command => executions.push(command),
  }, tabs: { query: async () => [{ id: 1, url: 'https://except.example/' }, { id: 2, url: 'https://other.example/' }] },
  webNavigation: { getAllFrames: async ({ tabId }) => [{ documentId: 'doc-' + tabId, documentLifecycle: 'active', url: tabId === 1 ? 'https://child.example/' : 'https://other.example/' }] } },
});
vm.runInContext(bg.slice(a, b) + '\nthis.api={applyPrivacyHeaderRule,reconcilePrivacySignalsInjection,privacySignalExclusions};', context);
async function main() {
  const cfg = { enabled: true, allowlist: ['except.example'], siteOverrides: { 'paused.example': { sendPrivacySignals: false } } };
  await context.api.reconcilePrivacySignalsInjection(true, cfg);
  assert.equal(writes.length, 1); assert.equal(writes[0].addRules.length, 2);
  const nav = writes[0].addRules.find(r => r.id === 900008), sub = writes[0].addRules.find(r => r.id === 900000);
  assert(nav.priority > 100000 && sub.priority > 100000, 'configured signals survive compatibility and explicit request allowances');
  for (const rule of writes[0].addRules) assert.deepEqual(rule.action, { type: 'modifyHeaders', requestHeaders: [
    { header: 'DNT', operation: 'set', value: '1' }, { header: 'Sec-GPC', operation: 'set', value: '1' },
  ] }, 'the high-priority signal owner can only set the two preference headers');
  assert(sub.condition.resourceTypes.includes('media') && sub.condition.resourceTypes.includes('font'));
  assert.deepEqual(nav.condition.resourceTypes, ['main_frame', 'sub_frame']);
  assert.deepEqual(nav.condition.excludedRequestDomains, ['except.example', 'paused.example']); assert(!nav.condition.excludedInitiatorDomains);
  assert.deepEqual(sub.condition.excludedInitiatorDomains, ['except.example', 'paused.example']); assert(!sub.condition.excludedRequestDomains);
  assert.equal(scripts[0].world, 'MAIN'); assert.equal(scripts[0].runAt, 'document_start'); assert(scripts[0].allFrames);
  assert(scripts[0].excludeMatches.includes('https://*.paused.example/*'));
  assert.equal(executions.find(e => e.target.tabId === 1).args[0], true, 'embedded documents use their own hostname policy, matching DNR initiators');
  assert.equal(executions.find(e => e.target.tabId === 2).args[0], true);
  await context.api.applyPrivacyHeaderRule(true, cfg); assert.equal(writes.length, 1, 'same scope coalesces');
  await context.api.applyPrivacyHeaderRule(true, { allowlist: ['changed.example'] }); assert.equal(writes.length, 2, 'scope changes rebuild atomically');
  await context.api.reconcilePrivacySignalsInjection(false, cfg);
  assert.equal(scripts.length, 0); assert.equal(writes.at(-1).addRules.length, 0);
  assert.deepEqual(writes.at(-1).removeRuleIds, [900000, 900008]);
  context.rejectRules = true; assert.equal(await context.api.applyPrivacyHeaderRule(true, cfg), false);
  context.rejectRules = false; await context.api.applyPrivacyHeaderRule(true, cfg); assert.equal(writes.at(-1).addRules.length, 2, 'failed writes remain retryable');
  console.log('[ok] early GPC descriptors, native restoration, navigation/initiator scope, registrations, toggles and atomic retries');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

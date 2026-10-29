/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { helpers, build } = require('./build-cname-data.js');
const { WOCname } = helpers();
function shippedFunction(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  const end = source.indexOf('\n}', start);
  assert(end > start, name + ' closing brace');
  return (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + source.slice(start, end + 2);
}

async function explicitChoiceTests() {
  const metadata = vm.runInNewContext(fs.readFileSync('settings-data.js', 'utf8') + '\nSETTINGS_DATA');
  assert.equal(metadata.defaults.blockCnameTrackers, true);
  assert.equal(metadata.popupDefaults.blockCnameTrackers, true);
  assert(!('blockCnameTrackers' in metadata.recommended) && !('blockCnameTrackers' in metadata.maxAdds));
  assert(metadata.shieldKeys.includes('blockCnameTrackers') && metadata.siteOverrideScope.network.includes('blockCnameTrackers'));
  const popup = fs.readFileSync('popup.js', 'utf8');
  const manual = popup.match(/const MANUAL_ONLY_TOGGLES = new Set\(\[[^\]]*\]\);/)[0];
  for (const initial of [false, true]) {
    const inputs = [{ key: 'blockCnameTrackers', checked: initial }, { key: 'blockFirstPartyTrackers', checked: false }];
    for (const input of inputs) input.getAttribute = () => input.key;
    const context = vm.createContext({ document: { querySelector: () => null, querySelectorAll: () => inputs }, $: () => ({}),
      readFromUI() {}, applyToUI() {}, saveConfig() {}, reloadActiveHttpTab() {}, showLeftOffNote() {} });
    vm.runInContext(manual + '\n' + shippedFunction('popup.js', 'turnEverythingOn') + '\nturnEverythingOn();', context);
    assert.equal(inputs[0].checked, initial, 'Enable everything preserves the explicit CNAME choice');
    assert.equal(inputs[1].checked, true);
    for (const preset of ['rec', 'max']) {
      const target = preset === 'max';
      const writes = [];
      const state = { blockCnameTrackers: initial, blockFirstPartyTrackers: !target };
      const settings = vm.createContext({ loaded: true, state, ALL_KEYS: Object.keys(state),
        MAX: { blockCnameTrackers: true, blockFirstPartyTrackers: true }, REC: { blockCnameTrackers: true, blockFirstPartyTrackers: false },
        hasKeyFor: () => true, info: key => ({ name: key }), plural: n => String(n), confirm: () => true,
        FIELD_OF: {}, writeConfig: async patch => { writes.push(patch); Object.assign(state, patch); }, paint() {}, toast() {} });
      vm.runInContext(shippedFunction('settings.js', 'applyPreset') + '\nthis.apply=applyPreset;', settings);
      await settings.apply(preset);
      assert.equal(state.blockCnameTrackers, initial, preset + ' preserves the explicit CNAME choice');
      assert.equal(state.blockFirstPartyTrackers, target);
      assert(writes.every(patch => !('blockCnameTrackers' in patch)));
    }
  }
}
for (const [input, expected] of [['METRICS.Example.COM.', 'metrics.example.com'], ['métrics.example.com', 'xn--mtrics-bva.example.com'],
  ['*.example.com', ''], ['example.com:443', ''], ['evil@example.com', ''], ['co.uk', ''], ['github.io', ''], ['127.0.0.1', ''],
  ['a..example.com', ''], ['a.example.com..', ''], ['example.com/path', '']]) assert.equal(WOCname.normalizeHost(input), expected, input);
const pairs = [['metrics.shop.example.org', 'edge.etracker.com'], ['edge.etracker.com', 'collector.etracker.com']];
const mapping = WOCname.validateEntries(pairs.concat([pairs[0]]));
assert.equal(mapping.get('metrics.shop.example.org'), 'collector.etracker.com');
assert.equal(WOCname.resolve(mapping, 'Metrics.Shop.Example.Org.', 'fixture').canonicalTarget, 'collector.etracker.com');
assert.equal(WOCname.resolve(mapping, 'child.metrics.shop.example.org', 'fixture'), null);
for (const rows of [[['example.org', 'tracker.example.net']], [['a.github.io', 'tracker.example.net']],
  [['a.example.org', 'a.example.org']], [['a.example.org', 'b.example.org'], ['b.example.org', 'a.example.org']],
  [['a.example.org', 'x.example.net'], ['A.EXAMPLE.ORG', 'y.example.net']]]) assert.throws(() => WOCname.validateEntries(rows));
const longChain = Array.from({ length: 9 }, (_, i) => ['h' + i + '.example.org', 'h' + (i + 1) + '.example.org']);
assert.throws(() => WOCname.validateEntries(longChain), /depth/);
const rules = WOCname.compile(mapping, { base: 730000, excludedInitiatorDomains: ['accounts.google.com'], protectedHost: () => false });
assert(rules.length > 0 && rules.length <= WOCname.maxRules);
assert(!rules.some(rule => 'domainType' in rule.condition));
const expression = new RegExp(rules[0].condition.regexFilter, 'i');
for (const scheme of ['ws', 'wss']) assert(expression.test(scheme + '://metrics.shop.example.org/probe'), scheme + ' tracker transport');
for (const url of ['https://metrics.shop.example.org/probe', 'http://metrics.shop.example.org:8443/probe', 'https://metrics.shop.example.org./probe']) assert(expression.test(url));
for (const url of ['https://child.metrics.shop.example.org/probe', 'https://metrics.shop.example.org.evil.test/probe', 'https://evil.test/metrics.shop.example.org', 'https://metrics.shop.example.org@evil.test/probe']) assert(!expression.test(url));
assert.deepEqual(Array.from(rules[0].condition.excludedInitiatorDomains), ['accounts.google.com']);
assert(!rules[0].condition.resourceTypes.includes('main_frame') && !rules[0].condition.resourceTypes.includes('media'));
const matches = (rule, raw) => {
  const host = new URL(raw).hostname.replace(/\.$/, '');
  return rule.condition.requestDomains.some(domain => host === domain || host.endsWith('.' + domain))
    && new RegExp(rule.condition.regexFilter, 'i').test(raw);
};
const mixed = WOCname.validateEntries([['a.example.org', 'collector.etracker.com'], ['nested.b.example.org', 'collector.etracker.com']]);
const scoped = WOCname.compile(mixed, { base: 730000, excludedInitiatorDomains: [], protectedHost: () => false });
for (const [host, expected] of [['a.example.org', true], ['nested.b.example.org', true], ['child.a.example.org', false],
  ['child.nested.b.example.org', false], ['unlisted.example.org', false], ['a.example.org.evil.test', false]]) {
  assert.equal(scoped.some(rule => matches(rule, 'https://' + host + '/probe')), expected, host);
}
assert.equal(WOCname.compile(mixed, { base: 730000, excludedInitiatorDomains: [], protectedHost: host => host === 'collector.etracker.com' }).length, 0);
const protectedAliasRules = WOCname.compile(mixed, { base: 730000, excludedInitiatorDomains: [], protectedHost: host => host === 'a.example.org' });
assert(protectedAliasRules.every(rule => !rule.condition.requestDomains.includes('a.example.org')));
for (const target of ['cdn.example.net', 'smoxycdn.net', 'emailretargeting.com', 'etracker.com.evil.test', 'shared.amazonaws.com']) {
  const unknownTarget = WOCname.validateEntries([['metrics.example.org', target]]);
  assert.equal(WOCname.resolve(unknownTarget, 'metrics.example.org', 'fixture'), null);
  assert.equal(WOCname.compile(unknownTarget, { base: 730000, excludedInitiatorDomains: [], protectedHost: () => false }).length, 0);
}
const source = JSON.parse(require('zlib').gunzipSync(fs.readFileSync('docs/cname-source-snapshot.json.gz')));
assert.throws(() => build({ ...source, license: 'different terms' }), /snapshot/);
assert.throws(() => build({ ...source, files: source.files.map((file, i) => i ? file : { ...file, text: '{}' }) }), /hash mismatch/);
assert.deepEqual(JSON.parse(JSON.stringify(build(source))), JSON.parse(fs.readFileSync('cname-trackers.json')));

async function policyTests() {
  const data = JSON.parse(fs.readFileSync('cname-trackers.json'));
  let installed = [], writes = 0, fetches = 0, fail = false, unavailable = false, invalid = false;
  const context = vm.createContext({ console: { warn() {} }, WOCname, CNAME_RULE_BASE: 730000, CNAME_RULES_BUDGET: 300,
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com'], MEDIA_COMPAT_DOMAINS: new Set(['googlevideo.com']),
    activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: WOCname.normalizeHost, isProtectedTrackerDomain: () => false, isMediaCompatDomain: () => false,
    chrome: { runtime: { getURL: name => 'chrome-extension://fixture/' + name } },
    fetch: async url => { fetches++; assert.equal(url, 'chrome-extension://fixture/cname-trackers.json'); return { ok: !unavailable, text: async () => JSON.stringify(invalid ? { ...data, entries: [['example.org', 'tracker.example.net']] } : data) }; },
    getDynamicRulesInBand: async () => installed, dnrBandUnchanged: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    writeDynamicRules: async change => { writes++; if (fail) throw new Error('native write rejected'); installed = change.addRules; },
  });
  vm.runInContext(fs.readFileSync('background-cname.js', 'utf8') + '\nthis.api={apply:applyCnameRules,resolve:resolveKnownAlias,load:loadKnownAliases};', context);
  await context.api.apply({ blockCnameTrackers: false }); assert.equal(writes, 0, 'explicit off does not write or fetch data');
  assert.equal(fetches, 0);
  unavailable = true;
  assert.equal(await context.api.apply({}), false);
  assert.equal(installed.length, 0, 'failed initial classification invents no enforcement');
  assert.equal(writes, 0);
  unavailable = false; fetches = 0;
  installed = JSON.parse(JSON.stringify(rules));
  const priorDataRules = JSON.stringify(installed);
  await context.api.apply({ blockCnameTrackers: false, blockFirstPartyTrackers: true }); assert.equal(fetches, 0, 'legacy first-party choice never opts into CNAME');
  assert.equal(installed.length, 0, 'explicit off clears old CNAME enforcement');
  installed = JSON.parse(priorDataRules); writes = 0;
  unavailable = true; assert.equal(await context.api.apply({ blockCnameTrackers: true }), false); assert.equal(writes, 0);
  assert.equal(JSON.stringify(installed), priorDataRules, 'unavailable data preserves previously installed protection');
  unavailable = false; invalid = true; assert.equal(await context.api.apply({ blockCnameTrackers: true }), false); assert.equal(writes, 0);
  assert.equal(JSON.stringify(installed), priorDataRules, 'invalid data preserves previously installed protection');
  invalid = false;
  await context.api.apply({ blockFirstPartyTrackers: false, blockTrackers: false }); assert(installed.length > 0); const previous = JSON.stringify(installed);
  await context.api.apply({ blockCnameTrackers: true }); assert.equal(writes, 1, 'unchanged policy skips native rewrite');
  fail = true; assert.equal(await context.api.apply({ blockCnameTrackers: true, siteOverrides: { 'shop.example.org': { blockCnameTrackers: false } } }), false);
  assert.equal(JSON.stringify(installed), previous, 'rejected replacement preserves installed rules');
  fail = false; await context.api.apply({ blockCnameTrackers: true, siteOverrides: { 'shop.example.org': { blockCnameTrackers: false } } });
  assert(installed.every(rule => rule.condition.excludedInitiatorDomains.includes('shop.example.org')), 'failed policy remains eligible for retry');
  await context.api.apply({ allowlist: ['paused.example.org'] });
  assert(installed.every(rule => rule.condition.excludedInitiatorDomains.includes('paused.example.org')), 'site pause excludes subsequent requests without a navigation');
  assert(installed.every(rule => rule.condition.excludedInitiatorDomains.includes('accounts.google.com')), 'authentication stays exempt');
  const aliases = installed.flatMap(rule => Array.from(rule.condition.requestDomains));
  assert.equal(aliases.length, 1663, 'only aliases ending at reviewed dedicated tracker domains qualify');
  await context.api.apply({ allowlist: Array.from({ length: 1000 }, (_, i) => 'paused' + i + '.example.org'),
    siteOverrides: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['except' + i + '.example.org', { blockCnameTrackers: false }])) });
  assert(installed.every(rule => rule.condition.excludedInitiatorDomains.length === 1502), 'supported pause and site-exception limits coexist');
  await context.api.apply({ enabled: false, blockCnameTrackers: true }); assert.equal(installed.length, 0);
  await context.api.apply({ blockCnameTrackers: false, blockFirstPartyTrackers: true }); assert.equal(installed.length, 0);
  assert.equal(context.api.resolve('unknown.shop.example.org'), null);
}
Promise.all([policyTests(), explicitChoiceTests()]).then(() => console.log('[ok] exact CNAME scope, default-on policy, presets, exceptions and atomic retry'))
  .catch(error => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { helpers, build, readSnapshot, sha256 } = require('./build-cname-data.js');
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
/* Output parity with the snapshot is the gate's build-cname-data.js --check. */
const source = readSnapshot();
assert.throws(() => build({ ...source, license: 'different terms' }), /snapshot/);
assert.throws(() => build({ ...source, files: source.files.map((file, i) => i ? file : { ...file, text: '{}' }) }), /hash mismatch/);
assert.throws(() => build({ ...source, files: source.files.filter(file => !file.path.endsWith('/stape.json')) }), /missing upstream: stape/);
const extra = { path: 'data/trackers/zz-new-provider.json', text: '{}' };
assert.throws(() => build({ ...source, files: source.files.concat({ ...extra, sha256: sha256(extra.text) }) }), /Unreviewed CNAME provider: zz-new-provider/);

async function policyTests() {
  const data = JSON.parse(fs.readFileSync('cname-trackers.json'));
  const catalogText = fs.readFileSync('rules-cname.json', 'utf8');
  let installed = [], writes = 0, fetches = [], fail = false, unavailable = false, invalid = false, session = {};
  const context = vm.createContext({ console: { warn() {} }, WOCname, CNAME_RULE_BASE: 730000, CNAME_RULES_BUDGET: 300,
    activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: WOCname.normalizeHost,
    chrome: { runtime: { getURL: name => 'chrome-extension://fixture/' + name },
      storage: { session: { get: async key => ({ [key]: session[key] }), set: async patch => { Object.assign(session, JSON.parse(JSON.stringify(patch))); } } } },
    fetch: async url => {
      const name = url.replace('chrome-extension://fixture/', '');
      fetches.push(name);
      assert(['cname-trackers.json', 'rules-cname.json'].includes(name));
      const text = name === 'rules-cname.json' ? (invalid ? '[]' : catalogText) : JSON.stringify(data);
      return { ok: !unavailable, text: async () => text };
    },
    getDynamicRulesInBand: async () => installed, dnrBandUnchanged: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    writeDynamicRules: async change => { writes++; if (fail) throw new Error('native write rejected'); installed = change.addRules; },
  });
  vm.runInContext(fs.readFileSync('background-cname.js', 'utf8') + '\nthis.api={apply:applyCnameRules,resolve:resolveKnownAlias,load:loadKnownAliases};', context);
  const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
  const except = site => ({ siteOverrides: { [site]: { blockCnameTrackers: false } } });
  installed = JSON.parse(JSON.stringify(rules));
  await context.api.apply({});
  same(installed, [], 'upgrading removes the old dynamic block band; the packaged ruleset enforces');
  same(fetches, [], 'no exception reads neither the mapping nor the catalog');
  await context.api.apply({ allowlist: ['paused.example.org'] });
  same(installed, [], 'a site with no listed aliases needs no exception rule');
  await context.api.apply(except('shop.trowow.de'));
  assert.equal(installed.length, 1);
  const [rule] = installed;
  same([rule.action.type, rule.priority, rule.condition.initiatorDomains], ['allow', 900, ['shop.trowow.de']]);
  assert(rule.condition.requestDomains.includes('a.trowow.de') && rule.condition.requestDomains.every(host => host.endsWith('.trowow.de')),
    'an exception allows only that site\'s own catalog hosts');
  assert(!('domainType' in rule.condition) && !rule.condition.resourceTypes.includes('main_frame'));
  const reads = fetches.filter(name => name === 'rules-cname.json').length, written = writes;
  await context.api.apply(except('shop.trowow.de'));
  assert.equal(fetches.filter(name => name === 'rules-cname.json').length, reads, 'a worker wake reuses the session cache instead of re-reading the catalog');
  assert.equal(writes, written, 'unchanged exceptions skip the native rewrite');
  installed = [];
  await context.api.apply(except('shop.trowow.de'));
  assert.equal(installed.length, 1, 'externally lost exception rules are restored from the cache');
  const previous = JSON.stringify(installed);
  unavailable = true;
  assert.equal(await context.api.apply(except('www.trowow.de')), false);
  assert.equal(JSON.stringify(installed), previous, 'unavailable data preserves installed exceptions');
  unavailable = false; invalid = true;
  assert.equal(await context.api.apply(except('www.trowow.de')), false);
  assert.equal(JSON.stringify(installed), previous, 'a catalog that does not match its summary is refused');
  invalid = false; fail = true;
  assert.equal(await context.api.apply(except('www.trowow.de')), false);
  assert.equal(JSON.stringify(installed), previous, 'rejected replacement preserves installed rules');
  fail = false;
  await context.api.apply(except('www.trowow.de'));
  same(installed[0].condition.initiatorDomains, ['www.trowow.de'], 'failed policy remains eligible for retry');
  await context.api.apply({ blockCnameTrackers: false, ...except('www.trowow.de') });
  same(installed, [], 'explicit off clears exceptions; the ruleset itself is disabled separately');
  await context.api.apply({ enabled: false, ...except('www.trowow.de') }); same(installed, []);
  const many = { allowlist: Array.from({ length: 1000 }, (_, i) => 'paused' + i + '.example.org'),
    siteOverrides: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['except' + i + '.example.org', { blockCnameTrackers: false }])) };
  assert.notEqual(await context.api.apply(many), false, 'supported pause and site-exception limits coexist');
  assert.equal(context.api.resolve('unknown.shop.example.org'), null);
}
Promise.all([policyTests(), explicitChoiceTests()]).then(() => console.log('[ok] exact CNAME scope, default-on policy, presets, exceptions and atomic retry'))
  .catch(error => { console.error(error); process.exitCode = 1; });

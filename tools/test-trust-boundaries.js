/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const auth = require('./lib/wo-auth.js');
const io = require('./lib/dynamic-rule-io.js');
const read = file => fs.readFileSync(file, 'utf8');
const background = read('background.js');
const source = read('src/content.js');
const policy = read('network-policy.js');
const domain = read('domain-utils.js');
const box = vm.createContext({ URL });
vm.runInContext(domain + '\n' + policy, box);
const api = vm.runInContext('({ normalizeSiteHost, normalizeSiteTarget, hostMatchesSite, policy: WONetworkPolicy })', box);

function lift(text, name) {
  const start = text.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const end = text.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, name);
  return text.slice(start, end + 3);
}
function number(name) {
  const match = background.match(new RegExp('^const ' + name + ' = (\\w+);', 'm'));
  assert(match, name);
  return /^\d+$/.test(match[1]) ? Number(match[1]) : number(match[1]);
}

for (const [left, right, parent] of [
  ['alice.webflow.io', 'bob.webflow.io', 'webflow.io'],
  ['alice.github.io', 'bob.github.io', 'github.io'],
  ['alice.foo.ck', 'bob.foo.ck', 'foo.ck'],
  ['alice.or.jp', 'bob.or.jp', 'or.jp'],
  ['alice.k12.ca.us', 'bob.k12.ca.us', 'k12.ca.us'],
  ['alice.compute.amazonaws.com', 'bob.compute.amazonaws.com', 'compute.amazonaws.com'],
]) {
  assert.equal(api.normalizeSiteTarget('https://analytics.' + left + '/'), left.includes('compute.amazonaws.com') ? 'analytics.' + left : left);
  assert.equal(api.normalizeSiteHost(parent), '', parent);
  assert.equal(api.hostMatchesSite(left, parent), false);
  assert.equal(api.hostMatchesSite(parent, parent), false);
  assert.equal(api.hostMatchesSite(left, right), false);
}
assert.equal(api.normalizeSiteTarget('https://user:password@example.com/'), '');
assert.equal(api.normalizeSiteTarget('ftp://example.com/'), '');
assert.equal(api.normalizeSiteTarget('https://analytics.alice.webflow.io/'), 'alice.webflow.io');
assert.equal(api.normalizeSiteHost('www.webflow.io'), 'www.webflow.io');
assert.equal(api.normalizeSiteTarget('bucket.s3.eu-west-2.amazonaws.com'), 'bucket.s3.eu-west-2.amazonaws.com');
assert.equal(api.hostMatchesSite('analytics.alice.webflow.io', 'alice.webflow.io'), true);

for (const file of ['popup.js', 'settings.js']) {
  const world = vm.createContext({ URL, DEFAULTS: { blockClickfix: true }, POPUP_DEFAULTS: { blockClickfix: true },
    isObj: value => value && typeof value === 'object' && !Array.isArray(value) });
  vm.runInContext(domain + '\n' + lift(read(file), 'sanitizeSiteOverrides'), world);
  const result = vm.runInContext('sanitizeSiteOverrides({"co.uk":{blockClickfix:false},"webflow.io":{blockClickfix:false},"ALICE.webflow.io":{blockClickfix:false}})', world);
  assert.deepEqual(Object.keys(result.map), ['alice.webflow.io'], file);
  assert.equal(result.dropped, 2, file);
}

for (const [name, store, base, size] of [
  ['userFilter', 'dynamic', 'USER_RULE_BASE', 'USER_RULE_MAX'],
  ['trackerSiteControl', 'dynamic', 'TRACKER_RULE_BASE', 'TRACKER_RULE_MAX'],
  ['firewall', 'dynamic', 'FIREWALL_RULE_BASE', 'FIREWALL_RULE_MAX'],
  ['firewallOnce', 'session', 'FIREWALL_SESSION_RULE_BASE', 'FIREWALL_SESSION_RULE_MAX'],
  ['sitePause', 'session', 'ALLOWLIST_RULE_BASE', null],
]) {
  const owner = api.policy.explicitOwners.find(entry => entry.name === name);
  assert.equal(owner.store, store);
  assert.equal(owner.base, number(base));
  assert.equal(owner.size, size ? number(size) : 1000);
}
assert(api.policy.automaticExceptionMax < api.policy.securityMin);
const allow = (id, priority, action = 'allow') => ({ id, priority, action: { type: action },
  condition: { requestDomains: ['alice.webflow.io'], resourceTypes: ['main_frame', 'sub_frame'] } });
for (const store of ['dynamic', 'session']) {
  api.policy.validate({ addRules: [allow(42, 1900)] }, store);
  api.policy.validate({ addRules: [allow(42, 1900, 'allowAllRequests')] }, store);
  for (const rule of [allow(42, 2000), allow(42, 3000), allow(42, 95000)]) {
    assert.throws(() => api.policy.validate({ addRules: [rule] }, store), /authority/);
  }
}
api.policy.validate({ addRules: [allow(number('ALLOWLIST_RULE_BASE'), 100000, 'allowAllRequests')] }, 'session');
for (const host of ['co.uk', 'github.io', 'webflow.io', 'amazonaws.com']) {
  const rule = allow(number('ALLOWLIST_RULE_BASE'), 100000, 'allowAllRequests');
  rule.condition.requestDomains = [host];
  assert.throws(() => api.policy.validate({ addRules: [rule] }, 'session'), /document exception/);
}
for (const ruleset of JSON.parse(read('manifest.json')).declarative_net_request.rule_resources) {
  const rules = JSON.parse(read(ruleset.path));
  api.policy.validate({ addRules: rules }, 'static');
  if (ruleset.path.startsWith('rules-grabber-') && ruleset.id !== 'grabber_compat') {
    assert(rules.every(rule => rule.priority >= api.policy.securityMin), ruleset.path + ' security floor');
  }
}
for (const kind of ['Dynamic', 'Session']) {
  const writes = [...background.matchAll(new RegExp('chrome\\.declarativeNetRequest\\.update' + kind + 'Rules\\(', 'g'))];
  assert.equal(writes.length, 1, kind + ' writes must use the shared boundary');
  assert(lift(background, 'write' + kind + 'Rules').includes('WONetworkPolicy.validate'));
}

const start = source.indexOf('/* AUTH-BEGIN');
const end = source.indexOf('/* AUTH-END */', start) + '/* AUTH-END */'.length;
assert(start >= 0 && end > start);
const authSource = source.slice(start, end);
const authBox = vm.createContext({});
vm.runInContext(authSource + '\nthis.auth = __woAuth;', authBox);
const key = auth.newKey(), token = 'trusted-fixture';
const doc = { readyState: 'loading', body: null, documentElement: null };
const win = {};
const receiver = authBox.auth.configReceiver();
const signer = new auth.Signer(key);
const send = message => receiver.read({ source: win, data: message }, win);
assert.equal(send({ source: 'wardenone', kind: 'config', token, overrides: { enabled: false } }), null);
assert.equal(receiver.acceptKey({ token, key }, doc), true);
const disable = auth.configMessage(signer, token, { enabled: false });
assert.equal(send({ ...disable, mac: undefined }), null);
assert.equal(send({ ...disable, mac: '0'.repeat(64) }), null);
assert.equal(send({ ...disable, overrides: { enabled: true } }), null);
assert.equal(send(disable).enabled, false);
assert.equal(send(disable), null);
assert.equal(receiver.acceptKey({ token, key: auth.newKey() }, doc), false);
assert.equal(send(auth.configMessage(signer, token, { enabled: true })).enabled, true);
const changing = auth.configMessage(signer, token, { enabled: false });
let reads = 0;
Object.defineProperty(changing, 'overrides', { get: () => ++reads === 1 ? { enabled: false } : { enabled: true } });
assert.equal(send(changing).enabled, false);
assert.equal(reads, 1, 'only the verified snapshot is consumed');
for (const change of [{ readyState: 'complete' }, { body: {} },
  { documentElement: { getElementsByTagName: () => [{ localName: 'script' }], attributes: [] } }]) {
  assert.equal(authBox.auth.configReceiver().acceptKey({ token, key }, { ...doc, ...change }), false);
}
for (const file of ['anti-redirect.js', 'permission-chain.js', 'cryptominer-detect.js', 'spotify-adblock.js',
  'yt-adblock.js', 'twitch-adblock.js', 'src/fingerprint-realm.js', 'src/content.js']) {
  assert.match(read(file), /__woAuth\.(?:config\(|configReceiver\()/, file + ' must use the shared configuration verifier');
}

process.exitCode = 1;
(async () => {
  const calls = [];
  let fail = true;
  const ioBox = vm.createContext({ URL, chrome: { declarativeNetRequest: {
    updateDynamicRules: async change => { calls.push(change); if (fail) { fail = false; throw new Error('browser rejected update'); } },
    updateSessionRules: async change => { calls.push(change); },
  } } });
  vm.runInContext(domain + '\n' + io.prelude(background) + '\nthis.write = writeDynamicRules;', ioBox);
  assert.throws(() => ioBox.write({ addRules: [allow(42, 95000)] }), /authority/);
  assert.equal(calls.length, 0, 'invalid policy never reaches Chrome');
  await assert.rejects(ioBox.write({ removeRuleIds: [42] }), /browser rejected/);
  await ioBox.write({ removeRuleIds: [42] });
  assert.equal(calls.length, 2, 'browser failures propagate and permit retry');
  console.log('trust boundary contracts passed');
  process.exitCode = 0;
})().catch(error => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Public suffixes must never become whole-site network exceptions. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const bg = read('background.js');
function lift(source, name) {
  const at = source.search(new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm'));
  assert(at >= 0, name);
  let depth = 0;
  let opened = false;
  for (let i = at; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}' && --depth === 0 && opened) return source.slice(at, i + 1);
  }
  throw new Error('Unterminated ' + name);
}
const box = vm.createContext({ URL, console });
vm.runInContext(read('domain-utils.js') + '\n' + read('psl-private.js') + '\n' + read('config-lock.js'), box);
for (const name of ['ipv4FromMappedIpv6', 'canonicalIpv6', 'ipv6Range', 'normalizeIpLiteral', 'isLocalOrPrivateHost', 'normalizeAllowlistHost', 'normalizeAllowlistHosts', 'activeAllowlist', 'hostMatchesAllowlist', 'applyAllowlistRules']) {
  vm.runInContext(lift(bg, name), box);
}
vm.runInContext("let __allowlistRulesKey = null; const ALLOWLIST_RULE_BASE = 710000;", box);
const api = vm.runInContext('({ normalizeAllowlistHost, activeAllowlist, hostMatchesAllowlist, applyAllowlistRules, validateAllowlistConfigUpdate })', box);
const rejected = ['co.uk', 'com.au', 'github.io', 'webflow.io', 'appspot.com', 's3.amazonaws.com',
  'foo.ck', 'foo.kawasaki.jp', 'kawasaki.jp', 'sch.uk', 'compute.amazonaws.com', 'eu-west-1.compute.amazonaws.com', 'xn--55qx5d.cn', 'com',
  'CO.UK.', 'https://github.io/path', 'https://公司.cn/'];
const accepted = ['healthy-college.co.uk', 'alice.github.io', 'alice.webflow.io', 'alice.appspot.com',
  'bucket.s3.amazonaws.com', 'www.ck', 'city.kawasaki.jp', 'alice.foo.ck', 'alice.foo.kawasaki.jp',
  'alice.eu-west-1.compute.amazonaws.com', 'www.github.io', 'www.webflow.io', 'www.co.uk', 'example.com', '8.8.8.8'];
for (const host of rejected) {
  assert.equal(api.normalizeAllowlistHost(host), '', host);
  for (const patch of [{ allowlist: [host] }, { allowlistUntil: { [host]: Date.now() + 60000 } }]) {
    assert.throws(() => api.validateAllowlistConfigUpdate(patch), /public suffix/, host);
  }
}
for (const host of accepted) {
  assert.equal(api.normalizeAllowlistHost(host), host, host);
  api.validateAllowlistConfigUpdate({ allowlist: [host], allowlistUntil: { [host]: Date.now() + 60000 } });
}
api.validateAllowlistConfigUpdate({ enabled: false });
const noData = vm.createContext({ URL });
vm.runInContext(read('config-lock.js'), noData);
assert.throws(() => noData.validateAllowlistConfigUpdate({ allowlist: ['example.com'] }), /boundary list could not load/);
vm.runInContext(read('domain-utils.js'), noData);
noData.validateAllowlistConfigUpdate({ allowlist: ['alice.webflow.io'] });
assert.throws(() => noData.validateAllowlistConfigUpdate({ allowlist: ['webflow.io'] }), /public suffix/);
assert.deepEqual(Array.from(api.activeAllowlist({ allowlist: rejected.concat('example.com'),
  allowlistUntil: { 'co.uk': Date.now() + 60000, 'alice.github.io': Date.now() + 60000 } })), ['example.com', 'alice.github.io']);
assert.equal(api.hostMatchesAllowlist('healthy-college.co.uk', ['co.uk']), false);
assert.equal(api.hostMatchesAllowlist('bob.github.io', ['github.io', 'alice.github.io']), false);
assert.equal(api.hostMatchesAllowlist('cdn.alice.github.io', ['alice.github.io']), true);
assert.equal(api.hostMatchesAllowlist('www.ck', ['www.ck']), true);
box.contentConfigFieldAllowed = (field) => ['allowlist', 'allowlistUntil'].includes(field);
box.REPUTATION_PROVIDERS = [];
box.WOEyeShieldProfiles = { forHost: () => ({}) };
vm.runInContext(lift(bg, 'sanitizeContentConfig') + '\n' + lift(read('popup.js'), 'publicConfig'), box);
const legacy = { allowlist: rejected.concat('alice.webflow.io'),
  allowlistUntil: { 'co.uk': Date.now() + 60000, 'webflow.io': Date.now() + 60000, 'www.ck': Date.now() + 60000 } };
for (const name of ['sanitizeContentConfig', 'publicConfig']) {
  const clean = box[name](legacy, 'https://example.com');
  assert.deepEqual(Array.from(clean.allowlist), ['alice.webflow.io'], name + ' filters legacy permanent pauses');
  assert.deepEqual(Object.keys(clean.allowlistUntil), ['www.ck'], name + ' filters legacy timed pauses');
}
const frame = vm.createContext({ URL });
vm.runInContext(read('domain-utils.js') + '\nconst NORMALIZED_HOST_CACHE=new Map(); const NORMALIZED_HOST_CACHE_MAX=12000;', frame);
for (const name of ['bridgePrivateOrLocalHost', 'hostParsesAsItself', 'normalizeBridgeHostUncached', 'normalizeBridgeHost', 'sanitizeBridgeHostList', 'bridgeCleanHost', 'bridgeHostMatchesList']) {
  vm.runInContext(lift(read('bridge.js'), name), frame);
}
assert.deepEqual(Array.from(frame.sanitizeBridgeHostList(['www.ck', 'www.co.uk'], 1000)), ['www.ck', 'www.co.uk']);
assert.equal(frame.bridgeHostMatchesList('www.ck', ['www.ck']), true);
assert.equal(frame.bridgeHostMatchesList('other.ck', ['www.ck']), false);
// Sweep both complete sections, including wildcard expansions and exception rules.
const rules = vm.runInContext('(WARDENONE_PSL_ICANN_RULES + "\\n" + WARDENONE_PSL_PRIVATE_RULES).split("\\n")', box);
let swept = 0;
for (const rule of rules) {
  if (!rule) continue;
  const host = rule.replace(/^!/, '').replace(/^\*\./, 'boundary.');
  if (rule[0] === '!') assert.equal(api.normalizeAllowlistHost(host), host, rule);
  else assert.equal(api.normalizeAllowlistHost(host), '', rule);
  if (rule.startsWith('*.')) assert.equal(api.normalizeAllowlistHost(rule.slice(2)), '', 'wildcard root: ' + rule);
  swept++;
}
assert(swept > 10000, 'the full PSL, including private rules, is exercised');
// Exercise the real writer functions: rejection must precede the first storage write.
async function checkWriters() {
  for (const [file, name, declarations, invoke] of [
    ['background.js', 'updateStoredConfig', 'function __cfgClone(c){return {...c}}; function storedConfigChangedKeys(a,b){return Object.keys(b)};', 'updateStoredConfig(c => ({...c,...patch}))'],
    ['settings.js', 'writeConfig', 'let writeChain=Promise.resolve(); const CONFIG_KEY="wardenone_config"; function isObj(x){return !!x}; function tidyConfig(){}; function adoptConfig(){};', 'writeConfig(patch)'],
    ['popup.js', 'persistConfig', 'const DEFAULTS={}; let config={}; let savedConfigSnapshot={}; function normalizeStoredProviderKeys(){}; function configValuesDiffer(){return false};', 'new Promise((resolve,reject)=>persistConfig(resolve,reject,{changes:patch,left:0}))'],
  ]) {
    let writes = 0;
    const realm = vm.createContext({ URL, console,
      localGetStrict: async () => ({ wardenone_config: {} }), localSet: async () => { writes++; },
      localRead: async () => ({ wardenone_config: {} }), localWrite: async () => { writes++; },
      chrome: { runtime: {}, storage: { local: { get: (keys, cb) => cb({ wardenone_config: {} }), set: (value, cb) => { writes++; cb(); } } } },
    });
    vm.runInContext(read('domain-utils.js') + '\n' + read('psl-private.js') + '\n' + read('config-lock.js') + '\n' + declarations + '\n' + lift(read(file), name), realm);
    for (const patch of [{ allowlist: ['co.uk'] }, { allowlistUntil: { 'github.io': Date.now() + 60000 } }]) {
      realm.patch = patch;
      await assert.rejects(vm.runInContext(invoke, realm), /public suffix/, file);
      assert.equal(writes, 0, file + ' rejects before writing');
    }
  }
}
(async () => {
  await checkWriters();
  let submitted;
  await api.applyAllowlistRules(rejected.concat(accepted), async () => [
    { id: 710000, condition: { requestDomains: ['co.uk'] } }, { id: 99 },
  ], async (change) => { submitted = change; });
  assert.deepEqual(Array.from(submitted.removeRuleIds), [710000], 'unsafe legacy rule removed atomically');
  assert.deepEqual(Array.from(submitted.addRules, (r) => r.condition.requestDomains[0]), accepted);
  await api.applyAllowlistRules(rejected, async () => submitted.addRules, async (change) => { submitted = change; });
  assert.equal(submitted.addRules.length, 0, 'only unsafe entries leave no exception');
  assert.equal(submitted.removeRuleIds.length, accepted.length, 'all previous pause rules removed');
  console.log('[ok] public-suffix pauses rejected at all writers and DNR; ' + swept + ' PSL rules checked');
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });

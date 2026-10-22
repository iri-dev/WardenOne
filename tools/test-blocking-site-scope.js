/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
process.exitCode = 1;
const background = fs.readFileSync('background.js', 'utf8');
const domain = fs.readFileSync('domain-utils.js', 'utf8');
const psl = fs.readFileSync('psl-private.js', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function lift(name) {
  const start = background.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const end = background.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, name);
  return background.slice(start, end + 3);
}
function set(name) {
  const start = background.indexOf('const ' + name + ' = ');
  const end = background.indexOf(';', start);
  assert(start >= 0 && end > start, name);
  return background.slice(start, end + 1);
}
function world(stored = {}, existing = []) {
  const state = { stored: clone(stored), rules: clone(existing), writes: [] };
  const box = {
    URL, console,
    __subsystemQueues: new Map(),
    LEARNED: {}, __initLearned: null, __initBlockedDomains: Promise.resolve(),
    BLOCKED_DOMAINS: new Set(), SECURITY_DOMAINS: new Set(),
    LEARNED_RULE_BASE: 700000, LEARNED_MAX: 2000,
    USER_BLOCKLIST_RULE_BASE: 970000, USER_BLOCKLIST_RULES_BUDGET: 64,
    USER_BLOCKLIST_DOMAINS_PER_RULE: 100,
    ALL_DNR_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'script', 'image', 'xmlhttprequest', 'media'],
    DEFAULT_CONFIG: {},
    activeAllowlist: () => [], hostMatchesAllowlist: () => false,
    securityStoresReady: async () => {}, refreshListMetaCounts: () => {},
    localGet: async () => ({ wardenone_config: state.config || {} }),
    localSet: async value => {
      state.stored = clone(value.wardenone_learned);
      state.writes.push(state.stored);
    },
    getDynamicRulesInBand: async () => clone(state.rules),
    writeDynamicRules: async ({ removeRuleIds, addRules }) => {
      state.rules = state.rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(clone(addRules));
    },
    dnrBandUnchanged: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    chrome: { storage: { local: { get: (key, callback) => {
      assert.equal(key, 'wardenone_learned');
      queueMicrotask(() => callback({ [key]: clone(state.stored) }));
    } } } },
  };
  vm.createContext(box);
  const neverStart = background.indexOf('const NEVER_BLOCK_DOMAINS');
  const neverEnd = background.indexOf('const NEVER_BLOCK_ALLOW_EXCLUDE', neverStart);
  assert(neverStart >= 0 && neverEnd > neverStart);
  const names = ['regDomainBg', 'registrableDomainBg', 'siteIdentityBg', 'ipv4FromMappedIpv6',
    'canonicalIpv6', 'ipv6Range', 'normalizeIpLiteral', 'isLocalOrPrivateHost', 'normalizeAllowlistHost',
    'normalizeUserBlockDomain', 'normalizeLearnedDomain', 'loadLearned', 'applyLearnedRules',
    'learnDomain', 'sanitizeLearnedForContent', 'wardenSiteHostFromTab', 'parseBlockPattern',
    'userBlockRulesFrom', 'locallyBlockedReputationHost', 'serializeSubsystem'];
  vm.runInContext(domain + '\n' + psl + '\n'
    + set('LOGIN_COMPAT_NEVER_BLOCK_DOMAINS') + '\n' + set('X_APP_COMPAT_DOMAINS') + '\n'
    + background.slice(neverStart, neverEnd) + '\n' + names.map(lift).join('\n')
    + '\nconst originalApply=applyLearnedRules;'
    + '\napplyLearnedRules=function(){return serializeSubsystem("applyLearnedRules",originalApply);};'
    + '\nthis.api={manual:normalizeUserBlockDomain,learned:normalizeLearnedDomain,load:loadLearned,'
    + 'apply:applyLearnedRules,learn:learnDomain,snapshot:sanitizeLearnedForContent,'
    + 'tab:wardenSiteHostFromTab,parse:parseBlockPattern,build:userBlockRulesFrom,'
    + 'local:locallyBlockedReputationHost,suffix:wardenOneIsPublicSuffix};', box);
  return { state, box, api: box.api };
}
const pairs = [
  ['alice.webflow.io', 'bob.webflow.io'],
  ['alice.github.io', 'bob.github.io'],
  ['alice.netlify.app', 'bob.netlify.app'],
  ['alice.vercel.app', 'bob.vercel.app'],
  ['alice.herokuapp.com', 'bob.herokuapp.com'],
  ['alice.pages.dev', 'bob.pages.dev'],
  ['alice.eu-west-1.compute.amazonaws.com', 'bob.eu-west-1.compute.amazonaws.com'],
  ['alice.or.jp', 'bob.or.jp'],
  ['alice.k12.ca.us', 'bob.k12.ca.us'],
];
async function run() {
  const w = world();
  for (const [alice, bob] of pairs) {
    for (const host of [alice, bob]) {
      assert.equal(w.api.manual(host), host, 'manual: ' + host);
      assert.equal(w.api.learned(host), host, 'learned: ' + host);
      assert.equal(w.api.tab({ url: 'https://' + host + '/page' }), host);
    }
    w.box.LEARNED = { [w.api.manual(alice)]: { userBlocked: true, hits: 1 } };
    await w.api.apply();
    assert.deepEqual(w.state.rules.map(rule => rule.condition.requestDomains), [[alice]]);
    assert(!w.state.rules.some(rule => rule.condition.requestDomains.some(d => bob === d || bob.endsWith('.' + d))));
    w.box.LEARNED = {};
    await w.api.learn(alice, 'known IP-grabber behavior');
    await w.api.apply();
    assert.deepEqual(w.state.rules.map(rule => rule.condition.requestDomains), [[alice]]);
    assert.equal(await w.api.local(bob), '');
  }
  for (const host of ['webflow.io', 'github.io', 'co.uk', 'com.au', 's3.amazonaws.com',
    'eu-west-1.compute.amazonaws.com']) {
    assert(w.api.suffix(host), host);
    assert.equal(w.api.manual(host), '');
    assert.equal(w.api.learned(host), '');
    assert.deepEqual(clone(w.api.snapshot({ [host]: { reason: 'known IP-grabber behavior' } })), {});
  }
  for (const [host, target] of [
    ['cdn.alice.webflow.io', 'alice.webflow.io'],
    ['www.alice.github.io', 'alice.github.io'],
    ['www.webflow.io', 'www.webflow.io'],
    ['shop.example.com', 'example.com'],
    ['shop.example.co.uk', 'example.co.uk'],
    ['www.city.kawasaki.jp', 'city.kawasaki.jp'],
    ['alice.s3.amazonaws.com', 'alice.s3.amazonaws.com'],
  ]) {
    assert.equal(w.api.manual(host), target, host);
    assert.equal(w.api.learned(host), target, host);
  }
  assert.equal(w.api.manual('https://cdn.alice.webflow.io/path'), 'alice.webflow.io');
  assert.deepEqual(Object.keys(w.api.snapshot({ 'www.webflow.io': true })), ['www.webflow.io']);
  assert.equal(w.api.manual('youtube.com'), 'youtube.com');
  assert.equal(w.api.learned('youtube.com'), '');
  assert.equal(w.api.learned('github-cloud.s3.amazonaws.com'), '');
  for (const host of ['', '8.8.8.8', 'localhost', 'https://[::1]/', '*.webflow.io']) {
    assert.equal(w.api.manual(host), '', host);
    assert.equal(w.api.learned(host), '', host);
  }
  for (const pattern of ['cdn.alice.webflow.io', '*.alice.webflow.io',
    'https://alice.webflow.io/private/*']) {
    const parsed = w.api.parse(pattern);
    assert(parsed.ok, pattern);
    const rule = w.api.build([parsed])[0];
    if (parsed.kind === 'url') assert.equal(rule.condition.urlFilter, '|https://alice.webflow.io/private/');
    else assert.deepEqual(clone(rule.condition.requestDomains), [pattern.replace(/^\*\./, '')]);
  }
  assert.equal(w.api.tab({ url: 'https://cdn.alice.webflow.io/page' }), 'alice.webflow.io');

  for (const userBlocked of [false, true]) {
    const old = { 'webflow.io': { userBlocked, hits: 10 }, 'github.io': { userBlocked, hits: 2 },
      'co.uk': { userBlocked, hits: 1 },
      'alice.webflow.io': { userBlocked, firstSeen: 20, hits: 3 },
      'bob.webflow.io': { userBlocked, firstSeen: 30, hits: 2 },
      'example.com': { userBlocked, firstSeen: 40, hits: 1 },
      'youtube.com': { userBlocked: true, firstSeen: 50, hits: 1 } };
    const m = world(old, [{ id: 700000, priority: 2000, action: { type: 'block' },
      condition: { requestDomains: ['webflow.io'], resourceTypes: ['main_frame'] } }]);
    await m.api.load();
    await m.api.apply();
    const expected = ['alice.webflow.io', 'bob.webflow.io', 'example.com', 'youtube.com'];
    assert.deepEqual(Object.keys(m.state.stored).sort(), expected.sort());
    assert.deepEqual(m.state.rules.flatMap(rule => rule.condition.requestDomains).sort(), expected.sort());
    assert.equal(m.state.stored['alice.webflow.io'].hits, 3);
    assert.equal(m.state.stored['bob.webflow.io'].firstSeen, 30);
    assert.deepEqual(Object.keys(m.api.snapshot(old)).sort(), userBlocked ? [] : ['alice.webflow.io', 'bob.webflow.io', 'example.com']);
    if (userBlocked) {
      assert.equal(await m.api.local('cdn.alice.webflow.io'), 'user');
      assert.equal(await m.api.local('charlie.webflow.io'), '');
    }
    const restart = world(m.state.stored, m.state.rules);
    await restart.api.load();
    await restart.api.apply();
    assert.deepEqual(Object.keys(restart.box.LEARNED).sort(), expected.sort());
    assert.equal(restart.state.writes.length, 0, 'clean storage needs no migration write');
  }
  const merged = world({ 'www.alice.webflow.io': { firstSeen: 10, hits: 3 } });
  const loaded = merged.api.load();
  merged.box.LEARNED['alice.webflow.io'] = { firstSeen: 20, hits: 2 };
  await loaded;
  assert.equal(merged.state.stored['alice.webflow.io'].firstSeen, 10);
  assert.equal(merged.state.stored['alice.webflow.io'].hits, 5);
  assert.deepEqual(Object.keys(merged.state.stored), ['alice.webflow.io']);
  console.log('blocking site scope: tenant rules, explicit patterns, compatibility and stored-target migration passed');
  process.exitCode = 0;
}
run().catch(error => { console.error(error); process.exitCode = 1; });

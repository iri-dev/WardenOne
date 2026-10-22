/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { installSessionIo } = require('./lib/dynamic-rule-io.js');
const resourceTypes = require('./lib/resource-types.js');
process.exitCode = 1;
const background = fs.readFileSync('background.js', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function between(start, end) {
  const from = background.indexOf(start), to = background.indexOf(end, from);
  assert(from >= 0 && to > from, start);
  return background.slice(from, to);
}
function lift(name) {
  const start = background.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const end = background.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, name);
  return background.slice(start, end + 3);
}
function constant(name) {
  const match = background.match(new RegExp('^const ' + name + ' = [^;]+;', 'm'));
  assert(match, name);
  return match[0];
}
async function run() {
  const state = { rules: [], session: [], writes: 0 };
  const box = {
    URL, console, setTimeout,
    SECURITY_RESOURCE_TYPES: resourceTypes.resolve('SECURITY_RESOURCE_TYPES', background),
    RESOURCE_TYPES: resourceTypes.resolve('RESOURCE_TYPES', background),
    LOGIN_COMPAT_RESOURCE_TYPES: resourceTypes.resolve('LOGIN_COMPAT_RESOURCE_TYPES', background),
    getDynamicRulesInBand: async () => clone(state.rules),
    writeDynamicRules: async ({ removeRuleIds, addRules }) => {
      state.writes++;
      if (state.failWrite) { state.failWrite = false; throw new Error('injected compatibility write failure'); }
      state.rules = state.rules.filter(rule => !removeRuleIds.includes(rule.id)).concat(clone(addRules));
    },
    __loginCompatibilityRulesEnabled: null,
    chrome: { declarativeNetRequest: {
      getSessionRules: async () => clone(state.session),
      updateSessionRules: async ({ removeRuleIds, addRules }) => {
        state.session = state.session.filter(rule => !removeRuleIds.includes(rule.id)).concat(clone(addRules));
      },
    } },
  };
  vm.createContext(box);
  installSessionIo(box);
  vm.runInContext(fs.readFileSync('domain-utils.js', 'utf8') + '\n' + fs.readFileSync('psl-private.js', 'utf8')
    + '\n' + ['LOGIN_COMPAT_NEVER_BLOCK_DOMAINS', 'LOGIN_COMPAT_FILTERS', 'LOGIN_COMPAT_RULE_BASE',
      'NEVER_BLOCK_ALLOW_RULE_BASE', 'NEVER_BLOCK_ALLOW_MAX'].map(constant).join('\n')
    + '\n' + between('const MEDIA_COMPAT_DOMAINS', '// Compatibility safeguards')
    + '\n' + between('const NEVER_BLOCK_DOMAINS', 'async function applyNeverBlockAllowRules')
    + '\n' + between('const UBO_TYPE_MAP', 'function getListMeta')
    + '\n' + ['dnrValueMatches', 'dnrBandUnchanged', 'applyNeverBlockAllowRules', 'isMediaCompatFilter',
      'loginCompatibilityRuleCondition', 'applyLoginCompatibilityRules', 'domainToRule',
      'finalizeOptionRule', 'remoteRuleSourceKind', 'addGrabberFeedDomains', 'addMinerDomains',
      'packagedGrabberDomainsFrom'].map(lift).join('\n')
    + '\nthis.api={parse:parseList,sliced:parseListInSlices,network:parseNetworkRules,allowed:remoteListBlockAllowed,'
    + 'host:networkRulePatternHost,domain:domainToRule,finalize:finalizeOptionRule,'
    + 'infra:applyNeverBlockAllowRules,login:applyLoginCompatibilityRules,grabber:addGrabberFeedDomains,'
    + 'miner:addMinerDomains,packaged:packagedGrabberDomainsFrom};', box);
  const api = box.api;
  const hosts = ['raw.githubusercontent.com', 'objects.githubusercontent.com', 'github.com',
    'github-cloud.s3.amazonaws.com', 'accounts.google.com', 'login.live.com', 'youtube.com', 'realfraud.test'];
  for (const text of [hosts.join('\n'), hosts.map(host => '0.0.0.0 ' + host).join('\n'),
    hosts.map(host => '||' + host + '^').join('\n'), JSON.stringify({ blocklist: hosts })]) {
    assert.deepEqual(clone(api.parse(text)), hosts);
    assert.deepEqual(clone(await api.sliced(text)), hosts);
  }
  const long = Array.from({ length: 4100 }, (_, i) => 'bad' + i + '.com').concat(hosts).join('\n');
  assert.deepEqual(clone(await api.sliced(long)), clone(api.parse(long)));
  const rejected = ['co.uk', 'github.io', 'webflow.io', 'githubusercontent.com', 'amazonaws.com'];
  assert.deepEqual(clone(api.parse(rejected.join('\n'))), []);
  assert.deepEqual(clone(api.parse('alice.webflow.io\nbob.webflow.io')), ['alice.webflow.io', 'bob.webflow.io']);
  for (const kind of ['security', 'tracker', 'adshield']) {
    for (const host of hosts.slice(0, -1)) {
      assert.equal(api.allowed(host, '', kind), kind === 'security', host + ': ' + kind);
      const pattern = '||' + host + '/attacker/payload.js';
      const parsed = api.network(pattern + '$script,xmlhttprequest', 0, 10);
      assert.equal(parsed.length, 1);
      assert.equal(api.allowed(api.host(pattern), pattern, kind), kind === 'security');
      const rule = api.finalize(parsed[0], 100001, kind);
      assert.equal(rule.action.type, 'block');
      if (kind === 'security') assert.equal(rule.priority, 3000);
    }
    assert(api.allowed('realfraud.test', '', kind));
    assert(api.allowed('github.com.attacker.test', '', kind));
  }
  for (const build of [api.grabber, api.miner]) {
    const target = new Set();
    build(hosts.concat(rejected), target);
    assert.deepEqual([...target], hosts, 'confirmed feed entries retain infrastructure targets');
  }
  const packaged = api.packaged(hosts.concat(rejected).map(host => ({ action: { type: 'block' },
    condition: { requestDomains: [host], resourceTypes: ['main_frame'] } })));
  assert.deepEqual([...packaged], hosts);
  state.rules = [{ id: vm.runInContext('NEVER_BLOCK_ALLOW_RULE_BASE', box), priority: 3000, action: { type: 'allow' },
    condition: { requestDomains: ['raw.githubusercontent.com'], resourceTypes: ['script'] } }];
  await api.infra();
  assert(state.rules.length > 0);
  assert(state.rules.every(rule => rule.action.type === 'allow' && rule.priority === 1900));
  assert(state.rules.some(rule => rule.condition.requestDomains.includes('raw.githubusercontent.com')));
  const writes = state.writes;
  await api.infra();
  assert.equal(state.writes, writes, 'unchanged compatibility needs no rewrite');
  await api.login(true);
  assert(state.session.length > 0 && state.session.every(rule => rule.priority === 1900 && rule.action.type === 'allow'));
  const staticRules = JSON.parse(fs.readFileSync('rules-grabber-compat.json', 'utf8')).filter(rule => rule.id >= 164 && rule.id <= 167);
  assert.equal(staticRules.length, 4);
  for (const allowance of state.rules.concat(state.session, staticRules)) {
    assert(api.domain('raw.githubusercontent.com', 100000, 'security').priority > allowance.priority);
    assert(2000 > allowance.priority, 'known-logger/miner resource blocks must win');
    assert(allowance.priority > api.domain('raw.githubusercontent.com', 100000, 'adshield').priority);
  }
  const core = lift('updateRemoteListsCore');
  assert(core.includes("remoteListBlockAllowed(d, '', sourceKind)"));
  assert(core.includes("r.action.type !== 'allow' && !remoteListBlockAllowed(patternHost, pattern, sourceKind)"));
  await api.login(false);
  assert.equal(state.session.length, 0);
  const beforeFailure = clone(state.rules);
  state.failWrite = true;
  assert.equal(await api.infra(false), false, 'a rejected compatibility update propagates failure');
  assert.deepEqual(clone(state.rules), beforeFailure, 'failed writes preserve the installed band');
  await api.infra(false);
  assert.equal(state.rules.length, 0, 'the same shutdown request retries successfully');
  console.log('infrastructure threat precedence: security feeds, scoped resources, compatibility ordering and legacy replacement passed');
  process.exitCode = 0;
}
run().catch(error => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const reconcileStart = bg.indexOf('function refreshExtensionState()');
const stateKeyStart = bg.indexOf('const stateKey = [', reconcileStart);
const stateKeyEnd = bg.indexOf("].join('|')", stateKeyStart);
assert(reconcileStart >= 0 && stateKeyStart > reconcileStart && stateKeyEnd > stateKeyStart);
for (const key of ['blockGrabberResources', 'warnGrabberDomains', 'blockMalwareSites']) {
  assert(bg.slice(stateKeyStart, stateKeyEnd).includes('cfg.' + key),
    key + ' alone must trigger reconciliation');
}
const packs = Object.fromEntries(manifest.declarative_net_request.rule_resources
  .filter((entry) => ['grabbers', 'grabber_navigation', 'grabber_malware_navigation', 'grabber_compat'].includes(entry.id))
  .map((entry) => [entry.id, JSON.parse(fs.readFileSync(path.join(root, entry.path), 'utf8'))]));

function lift(name) {
  const start = bg.search(new RegExp('^async function ' + name + '\\(', 'm'));
  assert(start >= 0, name + ' is missing');
  let depth = 0;
  for (let i = bg.indexOf('{', start); i < bg.length; i++) {
    if (bg[i] === '{') depth++;
    if (bg[i] === '}' && --depth === 0) return bg.slice(start, i + 1);
  }
  throw new Error(name + ' is unterminated');
}

assert.deepEqual(Object.keys(packs).sort(),
  ['grabber_compat', 'grabber_malware_navigation', 'grabber_navigation', 'grabbers']);
assert(packs.grabbers.every((rule) => rule.action.type === 'block'
  && !rule.condition.resourceTypes.includes('main_frame')));
assert(packs.grabber_navigation.every((rule) => rule.action.type === 'redirect'
  && rule.condition.resourceTypes.join(',') === 'main_frame'));
assert(packs.grabber_malware_navigation.every((rule) => rule.action.type === 'block'
  && rule.condition.resourceTypes.join(',') === 'main_frame'));
assert(packs.grabber_compat.every((rule) => rule.action.type === 'allow'));
for (const id of [168, 171]) {
  const warning = packs.grabber_navigation.find((rule) => rule.id === id);
  const site = packs.grabber_malware_navigation.find((rule) => rule.id === id);
  assert(warning && site && warning.priority > site.priority);
  assert.deepEqual(warning.condition, site.condition);
}

async function check(master, resources, warnings, malware) {
  let cfg = { enabled: true, blockGrabberResources: true, warnGrabberDomains: true,
    blockMalwareSites: true, adShield: true, blockTrackers: true };
  const enabled = new Set();
  const dynamic = new Map();
  const hosts = new Map();
  const chrome = { declarativeNetRequest: {
    updateEnabledRulesets: async ({ enableRulesetIds, disableRulesetIds }) => {
      for (const id of disableRulesetIds) enabled.delete(id);
      for (const id of enableRulesetIds) enabled.add(id);
    },
    getDynamicRules: async ({ ruleIds }) => ruleIds.map((id) => dynamic.get(id)).filter(Boolean),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      for (const id of removeRuleIds) dynamic.delete(id);
      for (const rule of addRules) dynamic.set(rule.id, rule);
    },
  } };
  const context = { chrome, console, Map, Set, Date, Number, Object, Array, String, Promise,
    ADSHIELD_STATIC_RULESET_ID: 'adshield_easylist', SPOTIFY_MEDIA_RULESET_ID: 'spotify_media',
    TRACKERS_STATIC_RULESET_ID: 'trackers', EASYPRIVACY_STATIC_RULESET_ID: 'easyprivacy',
    GRABBER_FEED_RULE_BASE: 740000, GRABBER_FEED_MAX: 1000,
    GRABBER_NAV_RULE_ID: 741000, GRABBER_MALWARE_NAV_RULE_ID: 741001,
    GRABBER_FEED_DOMAINS: new Set(['feedlogger.example']), GRABBER_FEED_RULE_HOSTS: hosts,
    __grabberFeedReady: true,
    readFeedConfig: async () => cfg,
    getDynamicRulesInBand: async (base, count) => [...dynamic.values()]
      .filter((rule) => rule.id >= base && rule.id < base + count),
    writeDynamicRules: (change) => chrome.declarativeNetRequest.updateDynamicRules(change),
    dnrBandUnchanged: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    grabberFeedDisabled: (value) => value.enabled === false || (value.blockGrabberResources === false
      && value.warnGrabberDomains === false && value.blockMalwareSites === false),
    removeWardenOneDynamicRules: async () => {}, applyLearnedRules() {}, applyTrackerLearnerRules() {},
  };
  vm.runInNewContext("let __blocklistRulesetStateKey = ''; let __blocklistRulesetError = '';"
    + ' let ADSHIELD_STATIC_ACTIVE = true;\n' + lift('refreshBlocklistRuleset') + '\n'
    + lift('applyGrabberFeedRules')
    + '\nthis.api = { staticRules: refreshBlocklistRuleset, feedRules: applyGrabberFeedRules };', context);

  await context.api.staticRules(cfg);
  await context.api.feedRules();
  cfg = { ...cfg, enabled: master, blockGrabberResources: resources,
    warnGrabberDomains: warnings, blockMalwareSites: malware };
  await context.api.staticRules(cfg);
  await context.api.feedRules();

  const resourceOn = master && resources;
  const warningOn = master && warnings;
  const siteOn = master && malware;
  const label = JSON.stringify([master, resources, warnings, malware]);
  for (const [id, expected] of Object.entries({ grabbers: resourceOn,
    grabber_navigation: warningOn, grabber_malware_navigation: siteOn,
    grabber_compat: master })) {
    assert.equal(enabled.has(id), expected, label + ' static ' + id);
  }
  assert.equal(dynamic.has(740000), resourceOn, label + ' feed image block');
  assert.equal(dynamic.has(741000), warningOn, label + ' feed page warning');
  assert.equal(dynamic.has(741001), siteOn, label + ' feed site block');
  assert.equal(hosts.has(740000), resourceOn, label + ' attribution map');
  if (resourceOn) assert(!dynamic.get(740000).condition.resourceTypes.includes('main_frame'));
  if (warningOn && siteOn) assert(dynamic.get(741000).priority > dynamic.get(741001).priority);
}

async function checkLearnedScope() {
  const learned = { 'iplogger.icu': { reason: 'known IP-grabber behavior', hits: 1 } };
  const config = { enabled: true, blockGrabberResources: true,
    warnGrabberDomains: true, blockMalwareSites: true };
  let installed = [];
  const context = { LEARNED: learned, LEARNED_RULE_BASE: 700000, LEARNED_MAX: 2000,
    DEFAULT_CONFIG: config, Object, Array, String, Number, Date, console,
    localGet: async () => ({ wardenone_config: config }), localSet: async () => {},
    activeAllowlist: () => [], hostMatchesAllowlist: () => false,
    normalizeLearnedDomain: (host) => host, normalizeUserBlockDomain: (host) => host,
    getDynamicRulesInBand: async () => installed,
    dnrBandUnchanged: () => false,
    writeDynamicRules: async ({ addRules }) => { installed = addRules; },
  };
  vm.runInNewContext(lift('applyLearnedRules') + '\nthis.apply = applyLearnedRules;', context);
  const variants = [
    { resources: false, warnings: false, malware: false, types: [], priority: 2000 },
    { resources: true, warnings: false, malware: false,
      types: ['sub_frame', 'image', 'xmlhttprequest', 'script', 'ping', 'websocket'], priority: 2000 },
    { resources: false, warnings: true, malware: false, types: [], priority: 2000 },
    { resources: false, warnings: false, malware: true, types: ['main_frame'], priority: 2000 },
    { resources: true, warnings: true, malware: true,
      types: ['sub_frame', 'image', 'xmlhttprequest', 'script', 'ping', 'websocket', 'main_frame'], priority: 2000 },
  ];
  for (const state of variants) {
    Object.assign(config, { blockGrabberResources: state.resources,
      warnGrabberDomains: state.warnings, blockMalwareSites: state.malware });
    assert.equal((await context.apply()).ok, true);
    assert.equal(installed.length, state.types.length ? 1 : 0, JSON.stringify(state));
    if (state.types.length) {
      assert.deepEqual(Array.from(installed[0].condition.resourceTypes), state.types);
      assert.equal(installed[0].priority, state.priority);
    }
  }
  learned['iplogger.icu'].userBlocked = true;
  Object.assign(config, { blockGrabberResources: false, warnGrabberDomains: false,
    blockMalwareSites: false });
  await context.apply();
  assert.equal(installed.length, 1, 'an explicit user block still applies');
  assert.equal(installed[0].priority, 99000);
  assert(installed[0].condition.resourceTypes.includes('main_frame')
    && installed[0].condition.resourceTypes.includes('image'));
}

(async () => {
  for (const master of [false, true])
    for (const resources of [false, true])
      for (const warnings of [false, true])
        for (const malware of [false, true]) await check(master, resources, warnings, malware);
  await checkLearnedScope();
  console.log('[ok] all 16 master/resource/warning/malware DNR switch combinations');
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

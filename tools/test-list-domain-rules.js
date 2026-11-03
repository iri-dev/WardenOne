/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Downloaded lists: every domain becomes enforced, packed into a few large rules, and the list band is
   replaced by id without being read back. Until 2026-10-31 each domain was its own rule and only 18,000 of
   about 1.49 million downloaded domains were enforced (2,000 of them from the tracker feeds).
   node tools/test-list-domain-rules.js */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resourceTypes = require('./lib/resource-types.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const fn = (name) => {
  const start = BG.search(new RegExp('\\n(?:async )?function ' + name + '\\('));
  assert(start >= 0, 'missing ' + name);
  return BG.slice(start, BG.indexOf('\n}\n', start) + 3);
};
const constant = (name) => {
  const m = new RegExp('\\nconst ' + name + ' = ([^;]+);').exec(BG);
  assert(m, 'missing ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
};

function load(overrides = {}) {
  let yields = 0;
  const sandbox = { TextEncoder, crypto: globalThis.crypto, Uint8Array, Array, Set, Map, JSON, Promise, Number, String, Object,
    setTimeout: (callback) => { yields++; setImmediate(callback); }, installed: [] };
  sandbox.chrome = { declarativeNetRequest: { getDynamicRules: async ({ ruleIds }) => sandbox.installed.filter((rule) => ruleIds.includes(rule.id)) } };
  const consts = ['DYNAMIC_RULE_BASE', 'MAX_DYNAMIC', 'LIST_DOMAINS_PER_RULE', 'LIST_DOMAIN_RULES_MAX', 'OPTION_RULE_BASE', 'OPTION_RULES_MAX']
    .map((name) => overrides[name] !== undefined ? 'const ' + name + ' = ' + overrides[name] + ';' : constant(name));
  vm.createContext(sandbox);
  vm.runInContext(resourceTypes.prelude(BG) + '\n' + consts.join('\n') + '\n'
    + ['sha256TextHex', 'remoteRuleSourceKind', 'domainToRule', 'remoteDomainRuleSourceKind', 'listDomainRules', 'listDomainRuleCoverage',
      'remoteListRuleIds', 'remoteListFingerprint', 'remoteListRulesInstalled'].map(fn).join('\n')
    + '\nthis.api = { listDomainRules, listDomainRuleCoverage, remoteListRuleIds, remoteListFingerprint, remoteListRulesInstalled, domainToRule,'
    + ' SECURITY_RESOURCE_TYPES, RESOURCE_TYPES, LIST_RESOURCE_TYPES, DYNAMIC_RULE_BASE, LIST_DOMAINS_PER_RULE, LIST_DOMAIN_RULES_MAX };', sandbox);
  return { api: sandbox.api, sandbox, yields: () => yields };
}

const parents = (host) => { const out = []; for (let h = host.slice(host.indexOf('.') + 1); h.includes('.'); h = h.slice(h.indexOf('.') + 1)) out.push(h); return out; };
/* Chrome's requestDomains matching: the name or any parent listed in the rule. */
function enforcedBy(rules, host) {
  const index = enforcedBy.cache.get(rules) || new Map();
  if (!enforcedBy.cache.has(rules)) { for (const rule of rules) for (const d of rule.condition.requestDomains) index.set(d, rule); enforcedBy.cache.set(rules, index); }
  return [host, ...parents(host)].map((h) => index.get(h)).filter(Boolean);
}
enforcedBy.cache = new WeakMap();

(async () => {
  const { api, sandbox, yields } = load();
  const strongest = (found) => found.reduce((best, rule) => (!best || rule.priority > best.priority ? rule : best), null);

  /* ---- shape and strength on a small mixed list ------------------------------------------------- */
  const buckets = {
    security: new Set(['bad.example', 'phish.tracker.example', 'evil.test']),
    adshield: new Set(['ads.example', 'x.ads.example', 'banner.cdn.example']),
    tracker: new Set(['tracker.example', 'pixel.tracker.example', 'sub.bad.example', 'metrics.site.example']),
  };
  const merged = new Set([...buckets.security, ...buckets.adshield, ...buckets.tracker, 'unlisted-kind.example']);
  const small = await api.listDomainRules(buckets, merged);
  const rules = small.rules;
  ok(small.complete && rules.length === 3, 'one rule per kind for a small list');
  ok(rules.every((rule, i) => rule.id === api.DYNAMIC_RULE_BASE + i), 'ids are contiguous from the band base');
  const security = rules.filter((rule) => rule.priority === 3000), other = rules.filter((rule) => rule.priority === 1000);
  ok(security.every((rule) => JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(api.SECURITY_RESOURCE_TYPES)), 'security rules cover every request type');
  ok(other.every((rule) => JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(api.LIST_RESOURCE_TYPES)), 'ad and tracker rules keep the narrower types');
  /* HaGeZi Pro lists stripchat.com whole: an ad or tracker list may not stop the page itself or a site's own requests. */
  ok(other.every((rule) => rule.condition.domainType === 'thirdParty' && !rule.condition.resourceTypes.includes('main_frame')),
    'ad and tracker lists block only what other sites load, never the page being opened');
  ok(security.every((rule) => !rule.condition.domainType && rule.condition.resourceTypes.includes('main_frame')), 'malware and phishing lists still block the page itself');
  const listed = rules.flatMap((rule) => rule.condition.requestDomains);
  ok(new Set(listed).size === listed.length, 'no domain is listed twice');
  ok(!listed.includes('sub.bad.example') && !listed.includes('x.ads.example') && !listed.includes('pixel.tracker.example'),
    'a name a parent of equal or stronger kind covers is left out');
  ok(security.some((rule) => rule.condition.requestDomains.includes('phish.tracker.example')), 'a malware name under a tracker parent keeps its own security rule');
  ok(security.some((rule) => rule.condition.requestDomains.includes('unlisted-kind.example')), 'a domain no feed kind claims is treated as security, as before');
  for (const kind of ['security', 'adshield', 'tracker']) {
    for (const host of buckets[kind]) {
      const rule = strongest(enforcedBy(rules, host));
      ok(rule && rule.priority === (kind === 'security' ? 3000 : 1000) || (kind !== 'security' && rule && rule.priority === 3000),
        host + ' is enforced at its own strength or stronger');
    }
  }
  ok(JSON.stringify(api.domainToRule('one.example', 7, 'tracker').condition.requestDomains) === '["one.example"]', 'single-domain callers still work');

  /* ---- a full-size list -------------------------------------------------------------------------- */
  const big = { security: new Set(), adshield: new Set(), tracker: new Set() };
  const bigMerged = new Set();
  for (let i = 0; i < 1200000; i++) {
    const host = (i % 3 ? 'h' : 'ads.h') + i.toString(36) + (i % 7 ? '.example' : '.test');
    const kind = i % 4 === 0 ? 'tracker' : i % 4 === 1 ? 'adshield' : 'security';
    big[kind].add(host); bigMerged.add(host);
  }
  const started = Date.now();
  const before = yields();
  const full = await api.listDomainRules(big, bigMerged);
  const elapsed = Date.now() - started;
  ok(full.complete, 'every one of 1.2 million domains fits');
  ok(full.rules.length <= Math.ceil(1200000 / api.LIST_DOMAINS_PER_RULE) + 3 && full.rules.every((rule) => rule.condition.requestDomains.length <= api.LIST_DOMAINS_PER_RULE),
    'packed into ' + full.rules.length + ' rules of at most ' + api.LIST_DOMAINS_PER_RULE);
  ok(yields() - before >= 20, 'the pass yields to the worker while it runs');
  ok(elapsed < 15000, 'packing 1.2 million domains took ' + elapsed + ' ms');
  const coverage = await api.listDomainRuleCoverage(full, big, bigMerged);
  ok(coverage.total === bigMerged.size && coverage.tracker === big.tracker.size, 'all downloaded domains count as enforced');
  const missing = [...bigMerged].filter((host, i) => i % 997 === 0 && !enforcedBy(full.rules, host).length);
  ok(missing.length === 0, 'sampled domains are all enforced: ' + missing.slice(0, 3).join(', '));

  /* ---- a list past the ceiling: security first, and the count stays honest ----------------------------- */
  const capped = load({ LIST_DOMAINS_PER_RULE: 2, LIST_DOMAIN_RULES_MAX: 2 }).api;
  const cut = await capped.listDomainRules(buckets, merged);
  ok(!cut.complete && cut.rules.length === 2 && cut.rules.every((rule) => rule.priority === 3000), 'the ceiling keeps malware and phishing first');
  const cutCoverage = await capped.listDomainRuleCoverage(cut, buckets, merged);
  /* sub.bad.example sits in a tracker list but under a kept security parent, so it is still enforced. */
  ok(JSON.stringify(cutCoverage) === JSON.stringify({ total: 5, security: 3, adshield: 0, tracker: 1 }), 'a cut list counts only what its rules enforce: ' + JSON.stringify(cutCoverage));
  const sourceCounts = [
    { url: 'https://security.example/list', count: 3 },
    { url: 'https://ads.example/list', count: 3 },
    { url: 'https://trackers.example/list', count: 4 },
    { url: 'https://overlap.example/list', count: 0 },
    { url: 'https://other.example/list', count: 1 },
  ];
  const fullSources = await api.listDomainRuleCoverage(small, buckets, merged, sourceCounts);
  ok(JSON.stringify(fullSources.bySource.map((source) => source.activeCount)) === '[3,3,4,0,1]',
    'complete coverage attributes each unique address to its contributing feed');
  const cutSources = await capped.listDomainRuleCoverage(cut, buckets, merged, sourceCounts);
  ok(JSON.stringify(cutSources.bySource.map((source) => source.activeCount)) === '[3,0,1,0,1]',
    'partial coverage counts kept addresses and covered subdomains against the correct feed, skipping empty spans');
  ok(cutSources.bySource.reduce((sum, source) => sum + source.activeCount, 0) === cutSources.total,
    'feed contributions add up to enforced coverage even at the rule ceiling');

  /* ---- replace by id, skip an unchanged write ----------------------------------------------------- */
  const ids = api.remoteListRuleIds();
  ok(ids.includes(api.DYNAMIC_RULE_BASE) && ids.length === 18000 + 4000, 'the removal covers the whole list band and the option band');
  const option = [{ id: 600000, priority: 1100, action: { type: 'block' }, condition: { urlFilter: '||x.example/ad' } }];
  const fp = await api.remoteListFingerprint(rules.concat(option));
  ok(/^[0-9a-f]{64}$/.test(fp) && fp === await api.remoteListFingerprint(JSON.parse(JSON.stringify(rules.concat(option)))), 'the fingerprint is stable');
  const changed = JSON.parse(JSON.stringify(rules)); changed[0].condition.requestDomains.push('new.example');
  ok(fp !== await api.remoteListFingerprint(changed.concat(option)), 'a new domain changes the fingerprint');
  ok(fp !== await api.remoteListFingerprint(rules.concat([{ ...option[0], priority: 2000 }])), 'an option rule change changes it too');
  sandbox.installed = rules.concat(option);
  ok(await api.remoteListRulesInstalled(rules.length, 1), 'an installed band is recognised');
  sandbox.installed = rules.slice(0, 1);
  ok(!await api.remoteListRulesInstalled(rules.length, 1), 'a band missing its last rules is rewritten');
  sandbox.installed = rules.concat(option, [{ id: api.DYNAMIC_RULE_BASE + rules.length, priority: 1000, action: { type: 'block' }, condition: { requestDomains: ['legacy.example'] } }]);
  ok(!await api.remoteListRulesInstalled(rules.length, 1), 'an older build\'s one-domain rules past the end force a rewrite');

  /* ---- the worker never reads the list band back ---------------------------------------------- */
  const update = fn('updateRemoteListsCore');
  ok(!/getDynamicRules\(\)/.test(update) && /commitRemoteListRules\(remoteListRuleIds\(\), desiredRules, unchanged\)/.test(update),
    'the list update replaces the band by id without reading every rule');
  ok(/rulesFingerprint: fingerprint/.test(update) && /activeRuleCount: coverage\.total/.test(update), 'the stored count is what the rules enforce');
  ok(/removeRuleIds: remoteListRuleIds\(\) \}\);\s*const existing = await chrome\.declarativeNetRequest\.getDynamicRules\(\);/.test(fn('removeWardenOneDynamicRules')),
    'switching off removes the lists by id before reading the rest');
  ok((BG.match(/await writeDynamicRules\(\{ removeRuleIds: remoteListRuleIds\(\), addRules: \[\] \}\);\n {4}const \[dynamic, sessionRules\] = await Promise\.all/g) || []).length === 2,
    'both erase paths remove the lists by id before reading the rest');
  const unfiltered = [...BG.matchAll(/getDynamicRules\(\)/g)].map((m) => BG.slice(0, m.index).split('\n').length);
  ok(unfiltered.length === 3, 'only the three paths above still read every rule, after the lists are gone: lines ' + unfiltered.join(', '));
  ok(!/prioritizedDomainRuleDomains|ACTIVE_DOMAIN_RULE_BUDGETS/.test(BG), 'the per-kind truncation is gone');

  /* 2026-11-01: "Blocking N domains" added the packaged rulesets' RULE counts to the feeds' DOMAIN count,
     omitted three rulesets outright, and counted the overlap twice -- three of four packaged addresses are
     already in a feed. It counts addresses now, once each. */
  {
    const box = { Set, Object, Array, String, Number, Promise, JSON,
      chrome: { runtime: { getURL: (f) => f } },
      fetch: async (f) => ({ json: async () => box.files[f] || [] }) };
    box.files = {
      'rules.json': [{ condition: { requestDomains: ['base-only.example', 'in-feed.example'] } }],
      'rules-adshield.json': [{ condition: { urlFilter: '||ads-only.example^' } },
        { condition: { requestDomains: ['in-feed.example', 'sub.in-feed.example', 'base-only.example'] } }],
      'rules-trackers.json': [], 'rules-easyprivacy.json': [], 'rules-badger.json': [],
      'rules-cname.json': [{ condition: { requestDomains: ['cname-only.example'] } }],
    };
    vm.createContext(box);
    vm.runInContext([constant('ADSHIELD_STATIC_RULESET_ID'), constant('TRACKERS_STATIC_RULESET_ID'),
      constant('EASYPRIVACY_STATIC_RULESET_ID'), constant('BADGER_STATIC_RULESET_ID'), constant('CNAME_STATIC_RULESET_ID'),
      constant('PACKAGED_RULESET_FILES'), fn('domainCoveredBy'), fn('packagedRulesetDomains'), fn('packagedRulesetDomainStats'),
      'this.stats = packagedRulesetDomainStats; this.ids = { adshield: ADSHIELD_STATIC_RULESET_ID, cname: CNAME_STATIC_RULESET_ID };'].join('\n'), box);
    const stats = await box.stats(new Set(['in-feed.example']));
    const counts = stats.contributions;
    ok(counts.base === 1, 'an address a feed already names is not counted again: base ' + counts.base);
    ok(counts[box.ids.adshield] === 1,
      'nor one under it, nor one an earlier ruleset claimed: adshield ' + counts[box.ids.adshield]);
    ok(counts[box.ids.cname] === 1, 'a ruleset the old figure left out is counted');
    ok(stats.listed.base === 2 && stats.listed[box.ids.adshield] === 4,
      'full list sizes retain overlap while the unique contributions remain unchanged');
    const meta = BG.slice(BG.indexOf('function buildListMeta('), BG.indexOf('function refreshListMetaCounts('));
    ok(!/ADSHIELD_STATIC_RULE_COUNT|STATIC_RULE_COUNT \+/.test(meta), 'the figure no longer adds rule counts to domain counts');
    ok(/if \(STATIC_RULESET_ACTIVE\[id\]\) packagedActive \+= n;/.test(meta), 'a ruleset switched off adds nothing to it');
  }

  console.log('[ok] downloaded lists: ' + checks + ' checks; 1.2 million domains packed into ' + full.rules.length
    + ' rules in ' + elapsed + ' ms, every domain enforced, the list band replaced by id and never read back');
})().catch((error) => { console.error(error); process.exit(1); });

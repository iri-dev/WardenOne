/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Feed provenance and the Dangerous Site page for WardenOne's own list blocks. Each packed rule records where
   every feed's run starts; a membership filter per security rule finds the rule that holds a blocked host
   without the browser's rate-limited feedback; the page also appears after the worker slept, and Continue
   gets the person past the network block for that tab and site. Packing itself is unchanged.
   node tools/test-feed-provenance.js */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resourceTypes = require('./lib/resource-types.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const eq = (a, b, message) => { assert.equal(JSON.stringify(a), JSON.stringify(b), message); checks++; };
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

/* A tiny Cache Storage that keeps real Response bodies. */
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(key) { const body = store.get(key); return body ? new Response(body) : undefined; },
        async put(key, res) { store.set(key, new Uint8Array(await res.arrayBuffer())); },
      };
    },
    async delete(name) { return stores.delete(name); },
  };
}

function load(overrides = {}) {
  const sandbox = { Array, Set, Map, JSON, Promise, Number, String, Object, URL, Math, decodeURIComponent, Uint8Array, DataView,
    TextEncoder, TextDecoder, Response, setTimeout: (callback) => setImmediate(callback),
    installed: [], session: {}, sessionRules: [], meta: null, history: [], updates: [], tabs: new Map(), config: { enabled: true, blockMalwareSites: true },
    localBlock: () => '', pages: [] };
  sandbox.caches = fakeCaches();
  sandbox.chrome = { declarativeNetRequest: {
    getDynamicRules: async ({ ruleIds }) => { sandbox.reads = (sandbox.reads || 0) + 1; return sandbox.installed.filter((rule) => ruleIds.includes(rule.id)); },
    getSessionRules: async () => sandbox.sessionRules.map((rule) => JSON.parse(JSON.stringify(rule))),
  } };
  sandbox.evidence = { ok: false, reason: 'unset' };
  sandbox.readMatchedRuleEvidence = async () => sandbox.evidence;
  sandbox.localGet = async (key) => (key === 'wardenone_config' ? { wardenone_config: sandbox.config } : { wardenone_list_meta: sandbox.meta });
  sandbox.sessionArea = () => ({ get: async (key) => ({ [key]: sandbox.session[key] }), set: async (obj) => Object.assign(sandbox.session, obj) });
  sandbox.DEFAULT_CONFIG = { enabled: true, blockMalwareSites: true };
  sandbox.normalizeSafeBrowsingUrl = (raw) => { try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol)) return ''; u.hash = ''; return u.href; } catch (_) { return ''; } };
  sandbox.trustHostFromUrl = (raw) => { try { return new URL(raw).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  sandbox.isLocalTrustHost = (h) => /^(?:localhost|127\.)/.test(h);
  sandbox.locallyBlockedReputationHost = async (h) => sandbox.localBlock(h);
  sandbox.tabsGet = async (id) => ({ id, ...(sandbox.tabs.get(id) || {}) });
  sandbox.tabsUpdate = async (id, props) => { sandbox.updates.push([id, props]); };
  sandbox.bumpBadge = () => {};
  sandbox.queueHistory = (entry) => sandbox.history.push(entry);
  sandbox.safeBrowsingThreatLabel = () => 'malware or scam';
  sandbox.safeBrowsingBlockPageUrl = async (info) => { sandbox.pages.push(info); return 'chrome-extension://x/safe-browsing-block.html?w=' + 'c'.repeat(32); };
  sandbox.serializeSubsystem = (_name, task) => task();
  /* Every write passes the real network policy, the boundary that refused the first version of the allow. */
  sandbox.writeSessionRules = async (change) => {
    sandbox.__policy.validate(change, 'session');
    sandbox.sessionRules = sandbox.sessionRules.filter((rule) => !change.removeRuleIds.includes(rule.id)).concat(change.addRules);
  };
  sandbox.registerListener = () => {};
  const consts = ['DYNAMIC_RULE_BASE', 'LIST_DOMAINS_PER_RULE', 'LIST_DOMAIN_RULES_MAX', 'WARNING_RECORD_PREFIX', 'LIST_RULE_INDEX_CACHE',
    'LIST_RULE_INDEX_KEY', 'LIST_RULE_INDEX_BITS', 'LIST_RULE_INDEX_HASHES', 'LIST_RULE_INDEX_MAX_READS', 'LOCAL_LIST_PROVIDER',
    'LIST_ONCE_RULE_BASE', 'LIST_ONCE_PRIORITY', 'LIST_ONCE_RULES_BUDGET', 'OPTION_RULE_BASE', 'OPTION_RULES_MAX', 'LIST_OPTION_RULES_REUSE_MS']
    .map((name) => overrides[name] !== undefined ? 'const ' + name + ' = ' + overrides[name] + ';' : constant(name));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'network-policy.js'), 'utf8') + '\nthis.__policy = WONetworkPolicy;\n'
    + resourceTypes.prelude(BG) + '\n' + consts.join('\n') + '\nconst LIST_BLOCK_SETTLE_MS = 0;\n'
    + 'let LIST_RULE_SOURCES = null;\nlet listRuleSourcesLoad = null;\nlet LIST_RULE_INDEX = null;\nlet listRuleIndexLoad = null;\n'
    + 'let LIST_ONCE_ACTIVE = null;\nconst LIST_WARNINGS_SHOWN = new Map();\nlet LIST_OPTION_SOURCES = null;\nlet LIST_OPTION_PAGE_RULES = null;\n'
    + ['remoteRuleSourceKind', 'domainToRule', 'remoteDomainRuleSourceKind', 'listDomainRules', 'validListRuleSources', 'listRuleSources',
      'listFeedLabel', 'listRuleFeedUrls', 'listHostNames', 'listIndexHashes', 'listIndexHas', 'buildListRuleIndex', 'encodeListRuleIndex',
      'decodeListRuleIndex', 'loadListRuleIndex', 'persistListRuleIndex', 'listRuleHostMatch', 'findListRuleForHost', 'listFeedForRuleHost',
      'noteListProvenance', 'noteWarningShown', 'warningRecentlyShown', 'tabStillOnNavigation', 'showListBlockPageForError',
      'listOnceRule', 'allowListBlockOnce', 'clearListBlockOnce', 'optionRuleProvenance', 'validOptionSources', 'optionRuleFeed',
      'dnrUrlFilterRegExp', 'dnrHostListed', 'listOptionPageRules', 'findListOptionRuleForUrl', 'findListRuleViaFeedback'].map(fn).join('\n')
    + '\nthis.api = { listDomainRules, validListRuleSources, listRuleSources, listFeedLabel, listRuleFeedUrls, listFeedForRuleHost,'
    + ' listIndexHas, buildListRuleIndex, encodeListRuleIndex, decodeListRuleIndex, loadListRuleIndex, persistListRuleIndex, findListRuleForHost,'
    + ' noteListProvenance, noteWarningShown, showListBlockPageForError, allowListBlockOnce, clearListBlockOnce,'
    + ' optionRuleProvenance, dnrUrlFilterRegExp, findListOptionRuleForUrl, forgetOptionRules: () => { LIST_OPTION_PAGE_RULES = null; LIST_OPTION_SOURCES = null; },'
    + ' forgetIndex: () => { LIST_RULE_INDEX = null; }, DYNAMIC_RULE_BASE, LIST_ONCE_RULE_BASE, LIST_ONCE_PRIORITY, SECURITY_RESOURCE_TYPES };', sandbox);
  return { api: sandbox.api, sandbox };
}

/* A seeded generator, so a failure names a case that can be run again. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n); };
}

/* Build an update the way updateRemoteLists does: feeds in order, each adds its new hosts to merged. */
function simulate(r, feedsN, perFeed) {
  const buckets = { security: new Set(), adshield: new Set(), tracker: new Set() };
  const merged = new Set();
  const first = new Map();
  const counts = [];
  const pool = [];
  for (let f = 0; f < feedsN; f++) {
    const kind = ['security', 'security', 'adshield', 'tracker'][r(4)];
    const before = merged.size;
    for (let i = 0; i < perFeed; i++) {
      /* Reuse an earlier host sometimes, so later feeds list hosts an earlier feed added. */
      const host = pool.length && r(4) === 0 ? pool[r(pool.length)] : (r(5) === 0 && pool.length ? 'sub' + r(9) + '.' + pool[r(pool.length)] : 'h' + f + '-' + i + '.example');
      if (!merged.has(host)) { merged.add(host); first.set(host, f); pool.push(host); }
      buckets[kind].add(host);
    }
    counts.push({ url: 'https://feeds.example/list-' + f + '.txt', count: merged.size - before });
  }
  return { buckets, merged, counts, first };
}

/* A small installed list: two feeds sharing the first rule, a second security rule and an ad rule. */
async function smallWorld(overrides) {
  const { api, sandbox } = load(Object.assign({ LIST_DOMAINS_PER_RULE: '4' }, overrides || {}));
  const merged = new Set(['one.example', 'two.example', 'three.example', 'four.example', 'five.example', 'ads.example']);
  const buckets = { security: new Set(['one.example', 'two.example', 'three.example', 'four.example', 'five.example']), adshield: new Set(['ads.example']), tracker: new Set() };
  const counts = [{ url: 'https://raw.githubusercontent.com/o/a/main/a.txt', count: 3 }, { url: 'https://feeds.example/b.txt', count: 3 }];
  const out = await api.listDomainRules(buckets, merged, counts);
  out.sources.fingerprint = 'fp-1';
  sandbox.installed = out.rules;
  sandbox.meta = { ruleSources: out.sources };
  return { api, sandbox, out, counts, base: api.DYNAMIC_RULE_BASE };
}

(async () => {
  /* 1. Every packed host maps to the feed that first listed it, across randomised updates. */
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    const per = 5 + r(25);
    const { api } = load({ LIST_DOMAINS_PER_RULE: String(3 + r(12)), LIST_DOMAIN_RULES_MAX: '400' });
    const { buckets, merged, counts, first } = simulate(r, 2 + r(8), per);
    const out = await api.listDomainRules(buckets, merged, counts);
    const plain = await api.listDomainRules(buckets, merged);
    eq(out.rules, plain.rules, 'seed ' + seed + ': provenance leaves the packed rules exactly as they were');
    ok(out.sources && out.sources.rules.length === out.rules.length && out.sources.kinds.length === out.rules.length, 'seed ' + seed + ': one entry per rule');
    for (let k = 0; k < out.rules.length; k++) {
      const own = out.sources.rules[k];
      const domains = out.rules[k].condition.requestDomains;
      ok(own[0][0] === 0, 'seed ' + seed + ': a rule starts with a mark');
      for (let at = 0; at < domains.length; at++) {
        let mark = own[0];
        for (const m of own) if (m[0] <= at) mark = m;
        if (out.sources.urls[mark[1]] !== counts[first.get(domains[at])].url) {
          assert.fail('seed ' + seed + ' rule ' + k + ' position ' + at + ': ' + domains[at] + ' credited to ' + out.sources.urls[mark[1]]);
        }
      }
      checks++;
    }
  }
  /* 2. No counts, no provenance; counts that run short never crash or credit a wrong feed. */
  {
    const { api } = load();
    const merged = new Set(['a.example', 'b.example', 'c.example']);
    const buckets = { security: new Set(merged), adshield: new Set(), tracker: new Set() };
    eq((await api.listDomainRules(buckets, merged)).sources, null, 'no counts gives no provenance');
    const short = await api.listDomainRules(buckets, merged, [{ url: 'https://feeds.example/one.txt', count: 1 }]);
    eq(short.sources.rules[0], [[0, 0], [1, -1]], 'hosts past the counted feeds carry no feed');
  }
  /* 3. Labels from the feed's own address. */
  {
    const { api } = load();
    eq(api.listFeedLabel('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.txt'), 'hagezi/dns-blocklists tif.txt', 'GitHub label');
    eq(api.listFeedLabel('https://phishing.army/download/phishing-army-domains.txt'), 'phishing.army phishing-army-domains.txt', 'host label');
    eq(api.listFeedLabel('https://www.example.org/'), 'example.org', 'bare host label');
    eq(api.listFeedLabel('not a url'), '', 'bad address gives no label');
  }
  /* 4. Naming the feed for a blocked host, confirmed against the installed rule. */
  {
    const { api, sandbox, out, counts, base } = await smallWorld();
    eq(await api.listFeedForRuleHost(base, 'two.example'), counts[0].url, 'host in the first run');
    eq(await api.listFeedForRuleHost(base, 'four.example'), counts[1].url, 'host in the second run of a shared rule');
    eq(await api.listFeedForRuleHost(base, 'www.two.example'), counts[0].url, 'a subdomain is credited through its listed parent');
    eq(await api.listFeedForRuleHost(base + 1, 'five.example'), counts[1].url, 'a later rule');
    eq(await api.listFeedForRuleHost(base, 'five.example'), '', 'a rule that does not hold the host names nothing');
    eq(await api.listFeedForRuleHost(base + 2, 'ads.example'), '', 'ad and tracker rules are not named on a security block page');
    eq(await api.listFeedForRuleHost(base + 9, 'one.example'), '', 'an unknown rule names nothing');
    sandbox.installed = [];
    eq(await api.listFeedForRuleHost(base, 'one.example'), '', 'a rule that is no longer installed names nothing');
    sandbox.installed = out.rules;
    eq(api.listRuleFeedUrls(out.sources, base), [counts[0].url, counts[1].url], 'logger sees both feeds of a shared rule');
    eq(api.validListRuleSources({ urls: [], rules: [[]], kinds: [] }), null, 'malformed provenance is ignored');
  }
  /* 5. The membership filters: every listed name hits, about 1% of others do, and they survive storage. */
  {
    const { api } = load();
    const names = Array.from({ length: 20000 }, (_, i) => 'listed-' + i + '.example');
    const rules = [{ id: 10000, condition: { requestDomains: names } }, { id: 10001, condition: { requestDomains: ['ad.example'] } }];
    const sources = { base: 10000, urls: ['https://feeds.example/a.txt'], rules: [[[0, 0]], [[0, 0]]], kinds: ['security', 'adshield'], fingerprint: 'fp-x' };
    const index = await api.buildListRuleIndex(rules, sources);
    eq(index.parts.map((p) => p.id), [10000], 'only security rules get a filter');
    ok(names.every((n) => api.listIndexHas(index.parts[0], n)), 'no listed name is ever missed');
    let chance = 0;
    for (let i = 0; i < 20000; i++) if (api.listIndexHas(index.parts[0], 'other-' + i + '.example')) chance++;
    ok(chance / 20000 < 0.02, 'names not listed match by chance under 2% (' + (chance / 200).toFixed(2) + '%)');
    const back = api.decodeListRuleIndex(api.encodeListRuleIndex(index));
    ok(back && back.fingerprint === 'fp-x' && back.parts.length === 1 && names.slice(0, 500).every((n) => api.listIndexHas(back.parts[0], n)), 'round trip keeps the filter');
    const bytes = new Uint8Array(api.encodeListRuleIndex(index));
    eq(api.decodeListRuleIndex(bytes.slice(0, 20).buffer), null, 'a cut file is refused');
    eq(api.decodeListRuleIndex(new Uint8Array([0, 0, 0, 2, 123, 125]).buffer), null, 'a file without parts is refused');
    eq(api.decodeListRuleIndex(new ArrayBuffer(0)), null, 'an empty file is refused');
    const r = rng(7);
    const big = Array.from({ length: 3 }, (_, k) => ({ id: 10000 + k, condition: { requestDomains: Array.from({ length: 3000 }, () => 'x' + r(1e9) + '.t' + k + '.example') } }));
    const bigIndex = await api.buildListRuleIndex(big, { kinds: ['security', 'security', 'security'], fingerprint: 'f' });
    ok(big.every((rule, k) => rule.condition.requestDomains.every((n) => api.listIndexHas(bigIndex.parts[k], n))), 'every rule finds all its own names');
  }
  /* 6. Finding the rule for a host: confirmed, fingerprint bound, and cheap on a miss. */
  {
    const { api, sandbox, out, counts, base } = await smallWorld();
    ok(await api.persistListRuleIndex(out.rules, out.sources), 'index stored');
    api.forgetIndex();
    eq(await api.findListRuleForHost('four.example'), { ruleId: base, feed: counts[1].url }, 'found from the stored index after a restart');
    eq(await api.findListRuleForHost('login.five.example'), { ruleId: base + 1, feed: counts[1].url }, 'a subdomain finds its listed parent');
    sandbox.reads = 0;
    eq(await api.findListRuleForHost('not-listed.example'), null, 'an unlisted host finds nothing');
    ok(sandbox.reads <= 1, 'an unlisted host costs at most one chance rule read (' + sandbox.reads + ')');
    eq(await api.findListRuleForHost('ads.example'), null, 'ad rules never answer for a security block');
    sandbox.meta = { ruleSources: Object.assign({}, out.sources, { fingerprint: 'fp-2' }) };
    await api.listRuleSources();
    const fresh = load({ LIST_DOMAINS_PER_RULE: '4' });
    fresh.sandbox.caches = sandbox.caches;
    fresh.sandbox.installed = out.rules;
    fresh.sandbox.meta = { ruleSources: Object.assign({}, out.sources, { fingerprint: 'fp-2' }) };
    eq(await fresh.api.findListRuleForHost('four.example'), null, 'an index for other rules is not trusted');
    const before = sandbox.caches.stores.get('wardenone-list-rule-index').get('https://wardenone.invalid/list-rule-index');
    await api.persistListRuleIndex(out.rules, out.sources);
    ok(sandbox.caches.stores.get('wardenone-list-rule-index').get('https://wardenone.invalid/list-rule-index') === before, 'same rules, no rebuild');
  }
  /* 7. The warning record gets the feed from the index, for its own tab only. */
  {
    const { api, sandbox, out, counts } = await smallWorld();
    await api.persistListRuleIndex(out.rules, out.sources);
    const handle = 'a'.repeat(32);
    const key = 'wardenone_warning:' + handle;
    const page = 'chrome-extension://x/safe-browsing-block.html?w=' + handle;
    sandbox.session[key] = { kind: 'safe-browsing', tabId: 7, url: 'https://four.example/' };
    await api.noteListProvenance({ tabId: 7 }, 'four.example', page);
    eq(sandbox.session[key].listedBy, { url: counts[1].url, name: 'feeds.example b.txt' }, 'record names the feed, no feedback quota involved');
    sandbox.session[key] = { kind: 'safe-browsing', tabId: 8, url: 'https://four.example/' };
    await api.noteListProvenance({ tabId: 7 }, 'four.example', page);
    eq(sandbox.session[key].listedBy, undefined, 'another tab\'s record is left alone');
    sandbox.session[key] = { kind: 'safe-browsing', tabId: 7 };
    await api.noteListProvenance({ tabId: 7 }, 'nowhere.example', page);
    eq(sandbox.session[key].listedBy, undefined, 'an unlisted host names nothing');
    await api.noteListProvenance({ tabId: 7 }, 'two.example', 'chrome-extension://x/safe-browsing-block.html?w=../etc');
    ok(true, 'a malformed handle is ignored');
  }
  /* 8. The Dangerous Site page from a blocked request, after the worker slept. */
  {
    const block = (sandbox, url, extra) => ({ tabId: 7, frameId: 0, type: 'main_frame', url, error: 'net::ERR_BLOCKED_BY_CLIENT', ...(extra || {}) });
    const world = async () => {
      const w = await smallWorld();
      await w.api.persistListRuleIndex(w.out.rules, w.out.sources);
      w.api.forgetIndex();
      w.sandbox.tabs.set(7, { url: 'https://previous.example/' });
      return w;
    };
    let w = await world();
    ok(await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/x')), 'listed host past the stored prefix gets the page');
    eq(w.sandbox.pages[0], { url: 'https://four.example/x', tabId: 7, provider: 'WardenOne local malware and scam list', threats: 'MALWARE_OR_SCAM',
      context: 'page', listBlock: true, listedBy: w.counts[1].url }, 'page names the list and marks a list block');
    eq(w.sandbox.history[0].type, 'blocked_safe_browsing_page', 'activity records it');
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/x')), 'never twice for one visit');
    w = await world();
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://elsewhere.example/')), 'a page another extension blocked keeps the browser\'s message');
    w = await world();
    w.sandbox.localBlock = () => 'user';
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/')), 'the person\'s own block list keeps its own page');
    w = await world();
    w.sandbox.localBlock = () => 'security';
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/')), 'hosts the page check can see are left to it');
    w = await world();
    w.api.noteWarningShown(7, 'https://four.example/');
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/')), 'a page the page check already showed is not shown again');
    w = await world();
    w.sandbox.config = { enabled: true, blockMalwareSites: false };
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/')), 'malware list switch off, no page');
    w = await world();
    w.sandbox.config = { enabled: false };
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/')), 'WardenOne off, no page');
    w = await world();
    const pending = w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/'));
    w.sandbox.tabs.set(7, { url: 'https://next.example/' });
    ok(!await pending, 'a tab that moved on is left alone');
    w = await world();
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'https://four.example/', { tabId: -1 })), 'no tab, no page');
    ok(!await w.api.showListBlockPageForError(block(w.sandbox, 'chrome://settings/')), 'browser pages are ignored');
    eq(w.sandbox.updates.length, 0, 'none of the near misses moved a tab');
  }
  /* 9. Continue anyway: one tab, one site, above the list and below the person's own blocks. */
  {
    const { api, sandbox } = load();
    ok(await api.allowListBlockOnce(7, 'https://login.bad.example/path?x=1'), 'allow added');
    eq(sandbox.sessionRules.length, 1, 'one rule');
    const rule = sandbox.sessionRules[0];
    eq(rule.condition.tabIds, [7], 'only this tab');
    eq(rule.condition.requestDomains, ['login.bad.example'], 'only this site, not its listed parent');
    eq(rule.action.type, 'allow', 'an allow');
    ok(rule.priority > 3000 && rule.priority < 97000, 'above the security lists, below the firewall and the person\'s own blocks');
    eq(rule.condition.resourceTypes, api.SECURITY_RESOURCE_TYPES, 'the page and what it loads from that site');
    ok(await api.allowListBlockOnce(7, 'https://other.bad.example/'), 'a second continue in the same tab');
    eq(sandbox.sessionRules.map((r) => r.condition.requestDomains[0]), ['other.bad.example'], 'replaces the tab\'s earlier allow');
    await api.allowListBlockOnce(8, 'https://bad.example/');
    await api.clearListBlockOnce(7, 'cdn.other.bad.example');
    eq(sandbox.sessionRules.length, 2, 'staying on the site keeps it');
    await api.clearListBlockOnce(7, 'news.example');
    eq(sandbox.sessionRules.map((r) => r.condition.tabIds[0]), [8], 'leaving the site removes only that tab\'s allow');
    await api.clearListBlockOnce(8);
    eq(sandbox.sessionRules.length, 0, 'closing the tab removes it');
    await api.clearListBlockOnce(8, 'x.example');
    ok(true, 'nothing left, nothing read');
    ok(!await api.allowListBlockOnce(-1, 'https://bad.example/'), 'no tab, no allow');
    ok(!await api.allowListBlockOnce(7, 'javascript:alert(1)'), 'only web addresses');
    for (let i = 0; i < 20; i++) await api.allowListBlockOnce(100 + i, 'https://t' + i + '.example/');
    ok(sandbox.sessionRules.length <= 16, 'the band never grows past its budget');
  }
  /* 9a. No current index (a private window, or just after a list update): the browser's record of the rule is the fallback. */
  {
    const { api, sandbox, counts, base } = await smallWorld();
    const visit = { tabId: 7, timeStamp: 1000 };
    eq(await api.findListRuleForHost('four.example'), null, 'without an index or a visit there is nothing to go on');
    sandbox.evidence = { ok: true, matches: [{ rule: { ruleId: base, rulesetId: '_dynamic' }, tabId: -1, timeStamp: 1001 }] };
    eq(await api.findListRuleForHost('four.example', visit), { ruleId: base, feed: counts[1].url }, 'a match filed under tab -1 is confirmed and named');
    sandbox.evidence = { ok: true, matches: [{ rule: { ruleId: base, rulesetId: '_dynamic' }, tabId: 9, timeStamp: 1001 }] };
    eq(await api.findListRuleForHost('four.example', visit), null, 'another tab\'s match is not used');
    sandbox.evidence = { ok: true, matches: [{ rule: { ruleId: base + 1, rulesetId: '_dynamic' }, tabId: 7, timeStamp: 1001 }] };
    eq(await api.findListRuleForHost('two.example', visit), null, 'a rule that does not hold the host is not credited');
    sandbox.evidence = { ok: true, matches: [{ rule: { ruleId: base + 2, rulesetId: '_dynamic' }, tabId: 7, timeStamp: 1001 }] };
    eq(await api.findListRuleForHost('ads.example', visit), null, 'ad rules never stand for a security block');
    sandbox.evidence = { ok: false, reason: 'quota' };
    eq(await api.findListRuleForHost('four.example', visit), null, 'out of quota, nothing is claimed');
  }
  /* 9b. Page-level list rules: the URL filter matcher, the lookup, provenance and near misses. */
  {
    const { api, sandbox } = load({ OPTION_RULES_MAX: '40' });
    const re = (f, cs) => api.dnrUrlFilterRegExp(f, cs);
    ok(re('||01net.com/telecharger/').test('https://www.01net.com/telecharger/windows/x.html'), '|| matches a subdomain');
    ok(re('||01net.com/telecharger/').test('https://01net.com/telecharger/'), '|| matches the host itself');
    ok(!re('||01net.com/telecharger/').test('https://not01net.com/telecharger/'), '|| needs a label boundary');
    ok(!re('||01net.com/telecharger/').test('https://evil.example/?u=https://01net.com/telecharger/'), '|| is anchored to the host, not anywhere');
    ok(re('||moviesboys.com/*.shtml').test('https://moviesboys.com/a/b.shtml?x=1'), '* matches anything');
    ok(re('||bad.example^').test('https://bad.example/') && re('||bad.example^').test('https://bad.example'), '^ matches a separator or the end');
    ok(!re('||bad.example^').test('https://bad.example.com/'), '^ does not match a dot');
    ok(re('|https://x.example/a|').test('https://x.example/a') && !re('|https://x.example/a|').test('https://x.example/ab'), '| anchors both ends');
    ok(re('||x.example/Path').test('https://x.example/path') && !re('||x.example/Path', true).test('https://x.example/path'), 'case follows the rule');
    ok(re('||a.example/(x)[y]+?').test('https://a.example/(x)[y]+?') , 'regex characters are literal');
    const base = Number(sandbox.OPTION_RULE_BASE || 590000);
    const rule = (i, condition, extra) => Object.assign({ id: 590000 + i, priority: 3000, action: { type: 'block' }, condition }, extra || {});
    sandbox.installed = [
      rule(0, { urlFilter: '||01net.com/telecharger/', resourceTypes: ['main_frame'] }),
      rule(1, { urlFilter: '||ads.example/doc', resourceTypes: ['main_frame'] }, { priority: 1100 }),
      rule(2, { urlFilter: '||scripts.example/x', resourceTypes: ['script'] }),
      rule(3, { urlFilter: '||gated.example/page', resourceTypes: ['main_frame'], initiatorDomains: ['other.example'] }),
      rule(4, { requestDomains: ['shop.example'], excludedRequestDomains: ['safe.shop.example'], urlFilter: '/checkout/fake', resourceTypes: ['main_frame'] }),
      rule(5, { regexFilter: '^https://re\\.example/p/[0-9]+$', resourceTypes: ['main_frame', 'sub_frame'] }),
    ];
    const prov = api.optionRuleProvenance([
      { __woSourceKind: 'security', __woSourceUrl: 'https://ublockorigin.github.io/uAssets/filters/badware.txt' },
      { __woSourceKind: 'adshield', __woSourceUrl: 'https://easylist.to/easylist/easylist.txt' },
      { __woSourceKind: 'security', __woSourceUrl: 'https://feeds.example/sec.txt' },
      { __woSourceKind: 'security', __woSourceUrl: 'https://feeds.example/sec.txt' },
      { __woSourceKind: 'security', __woSourceUrl: 'https://feeds.example/shop.txt' },
      { __woSourceKind: 'security' },
    ]);
    eq(prov.urls, ['https://ublockorigin.github.io/uAssets/filters/badware.txt', 'https://feeds.example/sec.txt', 'https://feeds.example/shop.txt'], 'only security feeds are recorded, once each');
    eq(prov.rules, [[0, 0], [2, 1], [3, 1], [4, 2]], 'rule positions point at their feeds');
    sandbox.meta = { optionSources: prov };
    eq(await api.findListOptionRuleForUrl('https://www.01net.com/telecharger/windows/x.html'),
      { ruleId: 590000, feed: 'https://ublockorigin.github.io/uAssets/filters/badware.txt' }, 'a page-level block is found and named');
    eq(await api.findListOptionRuleForUrl('https://www.01net.com/actualites/'), null, 'another page on that site is not blocked');
    eq(await api.findListOptionRuleForUrl('https://ads.example/doc'), null, 'ad list rules are not security blocks');
    eq(await api.findListOptionRuleForUrl('https://scripts.example/x'), null, 'rules that never block a page are ignored');
    eq(await api.findListOptionRuleForUrl('https://gated.example/page'), null, 'rules that depend on where the visit came from are not guessed');
    eq((await api.findListOptionRuleForUrl('https://www.shop.example/checkout/fake')).ruleId, 590004, 'request domains and a path filter together');
    eq(await api.findListOptionRuleForUrl('https://safe.shop.example/checkout/fake'), null, 'an excluded domain is honoured');
    eq((await api.findListOptionRuleForUrl('https://re.example/p/123')).ruleId, 590005, 'regex rules match');
    eq(await api.findListOptionRuleForUrl('https://re.example/p/12a'), null, 'regex rules do not match other pages');
    sandbox.reads = 0;
    await api.findListOptionRuleForUrl('https://www.01net.com/telecharger/a');
    eq(sandbox.reads, 0, 'the page-level rules are read once and reused');
    api.forgetOptionRules();
    sandbox.installed = [];
    eq(await api.findListOptionRuleForUrl('https://www.01net.com/telecharger/a'), null, 'after an update without the rule, nothing is claimed');
    void base;
  }
  /* 9c. The blocked-request page uses a page-level rule when no packed rule holds the host. */
  {
    const w = await smallWorld({ OPTION_RULES_MAX: '10' });
    await w.api.persistListRuleIndex(w.out.rules, w.out.sources);
    w.sandbox.installed = w.out.rules.concat([{ id: 590000, priority: 3000, action: { type: 'block' },
      condition: { urlFilter: '||01net.com/telecharger/', resourceTypes: ['main_frame'] } }]);
    w.sandbox.meta = { ruleSources: w.out.sources, optionSources: { base: 590000, urls: ['https://ublockorigin.github.io/uAssets/filters/badware.txt'], rules: [[0, 0]] } };
    w.sandbox.tabs.set(7, { url: 'https://previous.example/' });
    ok(await w.api.showListBlockPageForError({ tabId: 7, frameId: 0, type: 'main_frame', url: 'https://www.01net.com/telecharger/x', error: 'net::ERR_BLOCKED_BY_CLIENT' }),
      'a page-level block gets the Dangerous Site page');
    eq(w.sandbox.pages[0].listedBy, 'https://ublockorigin.github.io/uAssets/filters/badware.txt', 'and names its list');
    ok(!await w.api.showListBlockPageForError({ tabId: 8, frameId: 0, type: 'main_frame', url: 'https://www.01net.com/actualites/', error: 'net::ERR_BLOCKED_BY_CLIENT' }),
      'a page the rule does not cover keeps the browser\'s message');
  }
  /* 10. The block page shows the feed and puts its address in the report. */
  {
    const els = {};
    const el = (id) => els[id] || (els[id] = { id, textContent: '', hidden: id === 'listed-by-row', attrs: {}, listeners: {},
      addEventListener(type, cb) { this.listeners[type] = cb; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      hasAttribute(k) { return k in this.attrs; }, focus() {} });
    let changed = null;
    let opened = '';
    const record = { kind: 'safe-browsing', url: 'https://bad.example/', shown: 'bad.example/', provider: 'WardenOne local malware and scam list', threats: 'MALWARE_OR_SCAM', context: 'page' };
    const ctx = vm.createContext({
      document: { title: '', getElementById: el }, location: { search: '?w=' + 'b'.repeat(32), href: '' }, history: { length: 1, back() {} }, window: {},
      URL, URLSearchParams, String, Promise, Array, setInterval() {}, clearInterval() {}, encodeURIComponent,
      chrome: { runtime: { lastError: null, getURL: (f) => f, sendMessage() {} }, tabs: { create: (o) => { opened = o.url; } },
        storage: { session: { get: (key, cb) => cb({ [key]: record }) }, onChanged: { addListener: (cb) => { changed = cb; } } } },
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'safe-browsing-block.js'), 'utf8'), ctx);
    await new Promise((resolve) => setImmediate(resolve));
    ok(el('listed-by-row').hidden === true, 'no feed yet, no row');
    ok(typeof changed === 'function', 'the page listens for the feed');
    changed({ ['wardenone_warning:' + 'b'.repeat(32)]: { newValue: Object.assign({}, record, { listedBy: { url: 'javascript:alert(1)', name: 'x' } }) } }, 'session');
    ok(el('listed-by-row').hidden === true, 'a non web feed address is never shown');
    changed({ ['wardenone_warning:' + 'b'.repeat(32)]: { newValue: Object.assign({}, record, { listedBy: { url: 'https://phishing.army/download/phishing-army-domains.txt', name: 'phishing.army phishing-army-domains.txt' } }) } }, 'session');
    ok(el('listed-by-row').hidden === false && el('listed-by').textContent === 'phishing.army phishing-army-domains.txt', 'feed shown');
    els.report.listeners.click();
    ok(decodeURIComponent(opened).includes('Listed by: https://phishing.army/download/phishing-army-domains.txt'), 'report names the feed address');
  }
  /* 11. Wiring. */
  {
    ok(/listDomainRules\(domainBuckets, merged, feedDomainCounts\)/.test(BG), 'the update passes the feed spans');
    ok(/ruleSources: listRules\.sources/.test(BG), 'provenance is saved with the list meta');
    ok(/if \(listRules\.sources\) listRules\.sources\.fingerprint = fingerprint;/.test(BG), 'provenance is tied to the installed rules');
    ok(/LIST_RULE_SOURCES = validListRuleSources\(listRules\.sources\);[\s\S]{0,300}persistListRuleIndex\(addRules, listRules\.sources\)/.test(BG), 'the index follows a committed update');
    ok(/LIST_OPTION_PAGE_RULES = null;/.test(BG) && /optionSources: optionRuleProvenance\(optionSelection\.rules\)/.test(BG), 'page-level rule provenance follows a committed update');
    ok(/if \(!r\.__woSourceUrl\) r\.__woSourceUrl = result\.url;/.test(BG), 'each collected page-level rule remembers its feed');
    ok(/await findListRuleForHost\(host, details\) \|\| await findListOptionRuleForUrl\(url\)/.test(fn('showListBlockPageForError')), 'the blocked-request page also tries page-level rules');
    ok(/findListRuleForHost\(host, details\)/.test(fn('noteListProvenance')), 'provenance passes the visit along for the fallback');
    const nav = fn('handleSafeBrowsingNavigation');
    ok(/noteWarningShown\(details\.tabId, blockUrl\);\n\s*await tabsUpdate/.test(nav), 'the page check records its warning before showing it');
    ok(/listBlock: verdict\.listBlock === true/.test(nav) && /if \(verdict\.listBlock === true\) noteListProvenance/.test(nav), 'list blocks are marked and named');
    ok(!/state\.enabled\) return;\s*\/\/ The address-level/.test(nav) && /state\.cfg\.blockMalwareSites !== false/.test(nav), 'the local list page follows its own switch, not the providers');
    ok(!/readMatchedRuleEvidence/.test(fn('noteListProvenance')), 'provenance no longer spends the feedback quota');
    ok(/rec\.listBlock === true && !await allowListBlockOnce\(tabId, rec\.url\)/.test(fn('addSafeBrowsingBypass')), 'Continue opens the network block');
    ok(/details\.type !== 'main_frame' \|\| !\/BLOCKED_BY_CLIENT\/i\.test/.test(BG), 'only blocked page loads reach the error path');
    ok(/caches\.delete\(LIST_RULE_INDEX_CACHE\)/.test(BG), 'a full erase drops the index');
    ok(/base === DYNAMIC_RULE_BASE && LIST_RULE_SOURCES/.test(fn('logRuleSource')), 'the network logger names feeds');
    ok(/\+ IP_PROGRAM_ONCE_RULES_BUDGET \+ LIST_ONCE_RULES_BUDGET;/.test(BG), 'the allow band is in the session budget');
    const html = fs.readFileSync(path.join(ROOT, 'safe-browsing-block.html'), 'utf8');
    ok(/id="listed-by-row" hidden/.test(html), 'the row starts hidden');
  }
  console.log('[ok] feed provenance checks passed (' + checks + ')');
})().catch((error) => { console.error(error); process.exit(1); });

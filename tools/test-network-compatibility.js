/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Network-policy regressions for login and portal compatibility.
 *
 * Run with:
 *   node tools/test-network-compatibility.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resourceTypes = require('./lib/resource-types.js');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sourceBetween(start, end) {
  const from = BACKGROUND.indexOf(start);
  const to = BACKGROUND.indexOf(end, from + start.length);
  assert(from !== -1, 'missing source marker: ' + start);
  assert(to !== -1, 'missing source marker: ' + end);
  return BACKGROUND.slice(from, to);
}

function arrayConstant(name) {
  /* Resource-type lists derive from a shared inventory now rather than being
     array literals, so a regex for "const X = [...]" no longer finds them. Ask
     the resolver for those, and keep the regex for every other constant. */
  if (/RESOURCE_TYPES$/.test(name)) return resourceTypes.resolve(name, BACKGROUND);
  const match = BACKGROUND.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\]);'));
  assert(match, 'missing array constant: ' + name);
  return vm.runInNewContext(match[1]);
}

function loadNetworkParsers(realMedia = false) {
  const yields = { count: 0 };
  const sandbox = {
    URL,
    isMediaCompatFilter: () => false,
    isNeverBlockDomain: () => false,
    setTimeout(callback, ms) {
      yields.count++;
      return setTimeout(callback, ms);
    },
  };
  if (!realMedia) sandbox.isMediaCompatDomainLowercase = () => false;
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  if (realMedia) {
    vm.runInContext(sourceBetween('const MEDIA_COMPAT_DOMAINS', '\n// Globally-trusted')
      + '\nthis.__media = { domains: Array.from(MEDIA_COMPAT_DOMAINS), isMediaCompatDomain, isMediaCompatDomainLowercase };', sandbox);
  }
  vm.runInContext(
    sourceBetween('const UBO_TYPE_MAP', '\nfunction getListMeta')
      + '\nthis.__api = { parseList, parseListInSlices, parseNetworkRules };',
    sandbox,
  );
  return Object.assign({ yields, media: sandbox.__media }, sandbox.__api);
}

function loadRedirectPolicy() {
  const sandbox = {
    isLoginCompatibilityUrl: (url) => String(url).includes('auth.example'),
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('function redirectChainContainsKnownAuth', '\nasync function evaluateRedirectChain')
      + '\nthis.__api = { redirectChainContainsKnownAuth, redirectChainShouldInterrupt };',
    sandbox,
  );
  return sandbox.__api;
}

function loadMediaCompatibilityRules() {
  const state = {
    rules: [{
      id: 806000, priority: 95000, action: { type: 'allowAllRequests' },
      condition: { requestDomains: ['youtube.com'], resourceTypes: ['main_frame', 'sub_frame'] },
    }, {
      id: 806090,
      priority: 99000,
      action: { type: 'block' },
      condition: { urlFilter: '||edge.ads.twitch.tv^', resourceTypes: ['media'] },
    }],
    updates: [],
  };
  const declarativeNetRequest = {
    async getSessionRules() {
      return state.rules.slice();
    },
    async updateSessionRules(update) {
      const removeRuleIds = Array.from(update.removeRuleIds || []);
      const removeSet = new Set(removeRuleIds);
      const addRules = Array.from(update.addRules || []);
      state.updates.push({ removeRuleIds, addRules });
      state.rules = state.rules.filter((rule) => !removeSet.has(rule.id)).concat(addRules);
    },
  };
  const sandbox = Object.assign({
    MEDIA_COMPAT_RULE_BASE: 806000,
    chrome: { declarativeNetRequest },
    console,
  }, resourceTypes.resolveAll(BACKGROUND));
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('let __mediaCompatibilityRulesEnabled', '\nlet __loginCompatibilityRulesEnabled')
      + sourceBetween('function domainToRule(', '\nfunction isWardenOneDynamicRuleId(')
      + '\nthis.__applyMediaCompatibilityRules = applyMediaCompatibilityRules;',
    sandbox,
  );
  return { apply: sandbox.__applyMediaCompatibilityRules, securityRule: sandbox.domainToRule, state };
}

function loadRemoteListCommitGuard(options = {}) {
  const state = {
    config: { enabled: true },
    updates: [],
    removeAllCalls: 0,
  };
  const sandbox = {
    localGet: async () => ({ wardenone_config: Object.assign({}, state.config) }),
    removeWardenOneDynamicRules: async () => { state.removeAllCalls += 1; },
    writeDynamicRules: async (update) => {
      state.updates.push(update);
      if (typeof options.onUpdate === 'function') await options.onUpdate(state);
    },
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('async function commitRemoteListRules', '\nlet __remoteListUpdateInFlight')
      + '\nthis.__commitRemoteListRules = commitRemoteListRules;',
    sandbox,
  );
  return { commit: sandbox.__commitRemoteListRules, state };
}

function runStoredConfigUpdateMigration(config) {
  const sandbox = { cfg: Object.assign({}, config || {}) };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    'let changed = false;\n'
      + sourceBetween("if (cfg.__locationPrivacyV344Enabled !== true)", '\n      return changed ? cfg : false;')
      + '\nthis.__result = { cfg, changed };',
    sandbox,
  );
  return sandbox.__result;
}

function loadExactDomainRuleHelpers() {
  /* Seed every resource-type list rather than naming the two this happened to
     need. domainToRule started reading a third the day security rules widened,
     and a sandbox that stubs a hand-picked subset fails as a ReferenceError at
     the moment the code under test grows, not at the moment it goes wrong. */
  const sandbox = Object.assign({}, resourceTypes.resolveAll(BACKGROUND));
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('function domainToRule', '\nfunction isWardenOneDynamicRuleId')
      + '\n'
      + sourceBetween('function loginCompatibilityRuleCondition', '\nasync function applyLoginCompatibilityRules')
      + '\nthis.__api = { domainToRule, loginCompatibilityRuleCondition };',
    sandbox,
  );
  return sandbox.__api;
}

// Mirrors declarativeNetRequest requestDomains matching: an entry covers the
// named host and its subdomains, but cannot match a hostname merely because it
// begins with the same text.
function requestDomainsMatchHost(condition, rawHost) {
  const host = String(rawHost || '').replace(/^\.+|\.+$/g, '').toLowerCase();
  return Array.from((condition && condition.requestDomains) || []).some((rawDomain) => {
    const domain = String(rawDomain || '').replace(/^\.+|\.+$/g, '').toLowerCase();
    return host === domain || host.endsWith('.' + domain);
  });
}

test('simple-list parser accepts only unambiguous whole hosts', () => {
  const { parseList } = loadNetworkParsers();
  const parsed = Array.from(parseList([
    'plain.example',
    'www.keep.example',
    '0.0.0.0 hosts-one.example hosts-two.example',
    '127.0.0.1 localhost',
    '::1 ipv6-hosts.example',
    '||exact-abp.example^',
    'commented.example # trailing comment',
    'b\u00fccher.example',
    'https://url.example/path',
    '||path-filter.example/tracker.js$script',
    '||option-filter.example^$script',
    '@@||exception.example^',
    '*.wildcard.example',
    'two.example domains.example',
    'comma.example,second.example',
  ].join('\n')));

  assert.deepStrictEqual(parsed, [
    'plain.example',
    'www.keep.example',
    'hosts-one.example',
    'hosts-two.example',
    'ipv6-hosts.example',
    'exact-abp.example',
    'commented.example',
    'xn--bcher-kva.example',
  ]);
});

test('media-domain suffix matching preserves exact, child, case, and deceptive-host behavior', () => {
  const real = loadNetworkParsers(true);
  const unfiltered = loadNetworkParsers();
  const known = new Set(real.media.domains);
  const previous = (raw) => {
    const d = String(raw || '').replace(/^www\./, '').toLowerCase();
    if (!d) return false;
    if (known.has(d)) return true;
    for (let dot = d.indexOf('.'); dot !== -1; dot = d.indexOf('.', dot + 1)) {
      if (known.has(d.slice(dot + 1))) return true;
    }
    return false;
  };
  const entries = [];
  for (const domain of known) {
    entries.push([domain, true], [domain.toUpperCase(), true],
      ['www.' + domain, true], ['WWW.' + domain.toUpperCase(), true],
      ['a.' + domain, true], ['a.b.' + domain, true],
      ['not' + domain, previous('not' + domain)], [domain + '.evil.example', false],
      [domain + '-evil.example', false]);
  }
  entries.push(['', false], ['googlevideo.com.evil', false], ['googlevideo-com.example', false],
    ['a.googlevideo.com.evil.example', false], ['a.youtubei.googleapis.com', true]);
  for (const [host, expected] of entries) {
    assert.strictEqual(real.media.isMediaCompatDomain(host), previous(host), 'old/new mismatch: ' + host);
    assert.strictEqual(real.media.isMediaCompatDomain(host), expected, 'unexpected media verdict: ' + host);
    assert.strictEqual(real.media.isMediaCompatDomainLowercase(host.toLowerCase()), expected,
      'normalized path mismatch: ' + host);
  }
  const feed = entries.filter(([host]) => host).map(([host]) => '0.0.0.0 ' + host).join('\n');
  const expectedFeed = Array.from(unfiltered.parseList(feed)).filter((host) => !previous(host));
  assert.deepStrictEqual(Array.from(real.parseList(feed)), expectedFeed,
    'the full feed parser changed which media and deceptive hosts it keeps');
});

/* Reported 2026-10-02: Google results for SteamRIP said "On a malware and scam blocklist", and the
   site itself was blocked. Only one of the sixteen security feeds lists steamrip.com; the fakes
   that copy its name are listed by others. The site and its www. host come out however a feed
   writes them. Nothing wider does: any other subdomain a feed lists stays blockable, and the
   copies go on being blocked. */
test('a single-feed listing is dropped for the domain and www only, and everything else is kept', () => {
  const { parseList } = loadNetworkParsers();
  const parsed = Array.from(parseList([
    'steamrip.com',
    'www.steamrip.com',
    '0.0.0.0 steamrip.com',
    '||steamrip.com^',
    '||www.steamrip.com^',
    'STEAMRIP.COM',
    'evil.steamrip.com',
    '0.0.0.0 login.steamrip.com',
    '||cdn.www.steamrip.com^',
    'www2.steamrip.com',
    'steamrip-en.pages.dev',
    '||steamrip.us.com^',
    'steamripzone.com',
    'notsteamrip.com',
  ].join('\n')));
  assert.deepStrictEqual(parsed, [
    'evil.steamrip.com',
    'login.steamrip.com',
    'cdn.www.steamrip.com',
    'www2.steamrip.com',
    'steamrip-en.pages.dev',
    'steamrip.us.com',
    'steamripzone.com',
    'notsteamrip.com',
  ]);

  const fromJson = Array.from(parseList(JSON.stringify({ blocklist: ['steamrip.com', 'steamrip.us.com'] })));
  assert.deepStrictEqual(fromJson, ['steamrip.us.com']);
});

/* Reported 2026-10-17: Google results for support.metamask.io said "On a malware and scam
   blocklist". Two causes. MetaMask's own phishing config keeps the real sites its look-alike
   matching protects under "fuzzylist", and the parser read that key as blocks, so metamask.io,
   etherscan.io and opensea.io were listed by the very feed that protects them. And one feed,
   HaGeZi's threat intelligence list, names the help centre itself. */
test('a feed\'s fuzzylist is never read as blocks, and the MetaMask help centre comes out alone', () => {
  const { parseList } = loadNetworkParsers();
  const config = {
    version: 2,
    tolerance: 1,
    fuzzylist: ['metamask.io', 'etherscan.io', 'opensea.io', 'launchpad.ethereum.org'],
    whitelist: ['metamask.io', 'opensea.io'],
    blacklist: ['metamask.io-token.vip', 'app-metamask.io', 'etherscan-io.com'],
  };
  assert.deepStrictEqual(Array.from(parseList(JSON.stringify(config))),
    ['metamask.io-token.vip', 'app-metamask.io', 'etherscan-io.com']);
  assert.deepStrictEqual(Array.from(parseList(JSON.stringify({
    FuzzyList: ['metamask.io'],
    list: { fuzzy_list: ['opensea.io'], blocked: ['opensea-io.com'] },
  }))), ['opensea-io.com']);

  const parsed = Array.from(parseList([
    '||support.metamask.io^',
    '0.0.0.0 www.support.metamask.io',
    'SUPPORT.METAMASK.IO',
    '||metamask.io.in^',
    'metamask.io-token.vip',
    'app-metamask.io',
    'support-metamask.io',
    'fake.support.metamask.io',
  ].join('\n')));
  assert.deepStrictEqual(parsed, [
    'metamask.io.in',
    'metamask.io-token.vip',
    'app-metamask.io',
    'support-metamask.io',
    'fake.support.metamask.io',
  ]);
});

/* Parsing a whole feed in one task held the service worker for seconds after a fresh install, and
   a settings change made meanwhile reached open tabs only after it. The update path now parses a
   feed in slices of lines and gives the worker back between them; what comes out must be exactly
   parseList's answer, including repeats that straddle a slice and slices that open with "[". */
test('a long feed parsed in slices gives the worker back and yields exactly parseList\'s hosts', async () => {
  const { parseList, parseListInSlices, yields } = loadNetworkParsers();
  const lines = ['﻿[Adblock Plus 2.0]', '! Title: fixture feed'];
  for (let i = 0; i < 12000; i++) {
    if (i === 3998) lines.push('[section opening the second slice]');
    else if (i === 7998) lines.push('{"looks":"like json"}');
    else if (i % 997 === 0) lines.push('0.0.0.0 hosts-' + i + '.example hosts-b' + i + '.example');
    else if (i % 499 === 0) lines.push('||abp-' + i + '.example^');
    else if (i % 333 === 0) lines.push('https://url-' + i + '.example/path');
    else if (i % 101 === 0) lines.push('repeat-' + (i % 7) + '.example');
    else lines.push('host-' + i + '.example # trailing comment');
  }
  const text = lines.join('\n');
  yields.count = 0;
  const sliced = Array.from(await parseListInSlices(text));
  assert(yields.count >= 3, 'a 12,000-line feed was parsed without giving the worker back: ' + yields.count + ' yields');
  assert.deepStrictEqual(sliced, Array.from(parseList(text)), 'slicing changed the hosts or their order');
  assert(sliced.includes('hosts-b997.example') && sliced.includes('repeat-0.example'), 'fixture hosts were not parsed');

  yields.count = 0;
  const json = JSON.stringify({ blocklist: ['json-a.example', 'json-b.example'] });
  assert.deepStrictEqual(Array.from(await parseListInSlices(json)), Array.from(parseList(json)), 'a JSON feed changed');
  /* Pretty-printed, a JSON feed runs to thousands of lines, and cut at a line it is not JSON. */
  const longJson = JSON.stringify({ blocklist: Array.from({ length: 6000 }, (_, i) => 'json-' + i + '.example') }, null, 1);
  const longJsonHosts = Array.from(await parseListInSlices(longJson));
  assert.deepStrictEqual(longJsonHosts, Array.from(parseList(longJson)), 'a long JSON feed was cut into lines');
  assert.strictEqual(longJsonHosts.length, 6000, 'the long JSON fixture did not parse');
  const short = 'one.example\ntwo.example';
  assert.deepStrictEqual(Array.from(await parseListInSlices(short)), Array.from(parseList(short)), 'a short feed changed');
  assert.strictEqual(yields.count, 0, 'a JSON or short feed was sliced');
});

test('line scanning preserves slice boundaries, CRLF, and a trailing empty line', async () => {
  const { parseList, parseListInSlices, yields } = loadNetworkParsers();
  const hosts = Array.from({ length: 4000 }, (_, i) => 'host-' + i + '.example');
  yields.count = 0;
  const exact = hosts.join('\r\n');
  assert.deepStrictEqual(Array.from(await parseListInSlices(exact)), Array.from(parseList(exact)));
  assert.strictEqual(yields.count, 0, 'exactly 4000 lines should stay on the short-list path');

  const over = hosts.join('\r\n') + '\r\n';
  yields.count = 0;
  assert.deepStrictEqual(Array.from(await parseListInSlices(over)), Array.from(parseList(over)));
  assert.strictEqual(yields.count, 2, 'the trailing empty line is the 4001st line');

  const boundary = hosts.join('\r\n') + '\r\n[section] CRLF boundary\r\nlast.example';
  yields.count = 0;
  assert.deepStrictEqual(Array.from(await parseListInSlices(boundary)), Array.from(parseList(boundary)));
  assert.strictEqual(yields.count, 2);
});

test('network-rule line scanning keeps order, scope, cap, and final unterminated line', () => {
  const { parseNetworkRules } = loadNetworkParsers();
  const feed = [
    '! heading',
    '||first.example^$script,third-party',
    '||ignored.example^$script,redirect=noop',
    '@@||allowed.example^$script,domain=site.example',
    '||last.example^$image,first-party',
  ].join('\r\n');
  const full = Array.from(parseNetworkRules(feed, 700, 10));
  assert.deepStrictEqual(full.map((rule) => rule.id), [700, 701, 702]);
  assert.deepStrictEqual(full.map((rule) => rule.condition.urlFilter), [
    '||first.example^', '||allowed.example^', '||last.example^',
  ]);
  assert.deepStrictEqual(full.map((rule) => rule.condition.domainType), [
    'thirdParty', undefined, 'firstParty',
  ]);
  assert.strictEqual(full[1].action.type, 'allow');
  assert.deepStrictEqual(Array.from(parseNetworkRules(feed + '\r\n', 700, 2)), full.slice(0, 2));
});

test('JSON list parsing does not broaden URLs, options, or allowlist entries', () => {
  const { parseList } = loadNetworkParsers();
  const parsed = Array.from(parseList(JSON.stringify({
    blocklist: ['json.example', 'https://reject.example/path', '||scoped.example^$script'],
    allowlist: ['safe.example'],
  })));
  assert.deepStrictEqual(parsed, ['json.example']);
});

test('network parser preserves first/third-party and resource-type scope', () => {
  const { parseNetworkRules } = loadNetworkParsers();
  const third = parseNetworkRules('||cdn.example/ads.js$script,third-party', 100, 10);
  assert.strictEqual(third.length, 1);
  assert.deepStrictEqual(Array.from(third[0].condition.resourceTypes), ['script']);
  assert.strictEqual(third[0].condition.domainType, 'thirdParty');

  const first = parseNetworkRules('||cdn.example/ads.js$script,first-party', 110, 10);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].condition.domainType, 'firstParty');

  const negatedThird = parseNetworkRules('||cdn.example/ads.js$script,~third-party', 120, 10);
  assert.strictEqual(negatedThird.length, 1);
  assert.strictEqual(negatedThird[0].condition.domainType, 'firstParty');

  assert.strictEqual(parseNetworkRules('||cdn.example^$~image', 130, 10).length, 0);
});

test('unsupported popup and strict-party options are dropped, not broadened', () => {
  const { parseNetworkRules } = loadNetworkParsers();
  for (const option of ['popup', 'popunder', 'strict1p', 'strict3p']) {
    assert.strictEqual(
      parseNetworkRules('||target.example^$' + option, 200, 10).length,
      0,
      option + ' must be rejected',
    );
  }
});

test('redirect length alone is log-only and known auth chains are never interrupted', () => {
  const { redirectChainShouldInterrupt } = loadRedirectPolicy();
  const manyHarmlessHops = {
    hops: Array.from({ length: 12 }, (_, i) => ({ to: 'https://hop' + i + '.example/' })),
    flagged: true,
    maxed: true,
  };
  assert.strictEqual(redirectChainShouldInterrupt(manyHarmlessHops, 'https://portal.example/'), false);
  assert.strictEqual(redirectChainShouldInterrupt({ blocklisted: true, hops: [] }, 'https://evil.example/'), true);
  assert.strictEqual(redirectChainShouldInterrupt({ abuseTld: true, hops: [] }, 'https://evil.example/'), true);
  assert.strictEqual(
    redirectChainShouldInterrupt(
      { blocklisted: true, hops: [{ to: 'https://auth.example/saml/callback' }] },
      'https://portal.example/',
    ),
    false,
  );
});

test('third-party cookie stripping cannot touch navigation or application traffic', () => {
  const types = Array.from(arrayConstant('THIRD_PARTY_COOKIE_RESOURCE_TYPES'));
  assert.deepStrictEqual(types, ['image', 'ping']);
  for (const sensitive of ['main_frame', 'sub_frame', 'xmlhttprequest', 'script']) {
    assert(!types.includes(sensitive), sensitive + ' must retain Set-Cookie headers');
  }
});

test('HTTPS upgrade is opt-in, top-level-only, and excludes local callbacks', () => {
  assert(/forceHttps:\s*false/.test(BACKGROUND), 'forceHttps must default off');
  assert(!/applyHttpsUpgradeRule\(on\s*&&\s*cfg\.forceHttps\s*!==\s*false\)/.test(BACKGROUND));
  assert.deepStrictEqual(Array.from(arrayConstant('HTTPS_UPGRADE_RESOURCE_TYPES')), ['main_frame']);
  const excluded = Array.from(arrayConstant('HTTPS_UPGRADE_EXCLUDED_DOMAINS'));
  assert(excluded.includes('localhost'));
  assert(excluded.includes('127.0.0.1'));
});

test('remote-list commit cannot reinstall DNR rules after the master switch turns off', async () => {
  const beforeCommit = loadRemoteListCommitGuard();
  let releaseFetch;
  const simulatedFetch = new Promise((resolve) => { releaseFetch = resolve; });
  const refresh = (async () => {
    await simulatedFetch;
    return beforeCommit.commit([10000], [{ id: 10000, action: { type: 'block' }, condition: { urlFilter: '||bad.example^' } }]);
  })();
  beforeCommit.state.config.enabled = false;
  releaseFetch();
  const result = await refresh;
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.disabled, true);
  assert.strictEqual(beforeCommit.state.updates.length, 0,
    'stale refresh reinstalled rules after the master switch turned off');
  assert.strictEqual(beforeCommit.state.removeAllCalls, 1,
    'disabled commit did not reconcile stale WardenOne rules');

  const duringCommit = loadRemoteListCommitGuard({
    onUpdate: async (state) => { state.config.enabled = false; },
  });
  const raced = await duringCommit.commit([], [{ id: 10001, action: { type: 'block' }, condition: { urlFilter: '||bad2.example^' } }]);
  assert.strictEqual(raced.applied, false);
  assert.strictEqual(raced.disabled, true);
  assert.strictEqual(duringCommit.state.updates.length, 1);
  assert.strictEqual(duringCommit.state.removeAllCalls, 1,
    'post-commit master check did not remove rules from a commit-boundary race');

  const unchanged = loadRemoteListCommitGuard();
  const stable = await unchanged.commit([10002], [{ id: 10002 }], true);
  assert.strictEqual(stable.applied, true);
  assert.strictEqual(stable.unchanged, true);
  assert.strictEqual(unchanged.state.updates.length, 0,
    'identical remote-list rules caused an unnecessary Chrome transaction');
  assert(/commitRemoteListRules\(removeIds, desiredRules, dnrBandUnchanged\(mine, desiredRules\)\)/.test(BACKGROUND),
    'remote-list planner did not pass a byte-equivalent band comparison to the guarded commit');
});

test('location-privacy update migration preserves an explicit disabled setting', () => {
  const explicitOff = runStoredConfigUpdateMigration({ blockGeolocation: false });
  assert.strictEqual(explicitOff.cfg.blockGeolocation, false,
    'migration silently re-enabled location blocking');
  assert.strictEqual(explicitOff.cfg.__locationPrivacyV344Enabled, true);
  assert.strictEqual(explicitOff.changed, true);

  const missing = runStoredConfigUpdateMigration({});
  assert.strictEqual(missing.cfg.blockGeolocation, true,
    'migration did not supply the default for a genuinely missing setting');
  assert.strictEqual(missing.cfg.__locationPrivacyV344Enabled, true);
});

test('whole-domain DNR generators use bounded requestDomains conditions', () => {
  const { domainToRule, loginCompatibilityRuleCondition } = loadExactDomainRuleHelpers();
  const blockRule = domainToRule('blocked.example', 12345);
  assert.deepStrictEqual(Array.from(blockRule.condition.requestDomains || []), ['blocked.example']);
  assert(!Object.prototype.hasOwnProperty.call(blockRule.condition, 'urlFilter'));
  assert(requestDomainsMatchHost(blockRule.condition, 'blocked.example'));
  assert(requestDomainsMatchHost(blockRule.condition, 'cdn.blocked.example'));
  assert(!requestDomainsMatchHost(blockRule.condition, 'blocked.example.evil'),
    'whole-domain block escaped into a hostile suffix');

  const exactLogin = loginCompatibilityRuleCondition('||accounts.google.com');
  assert.deepStrictEqual(Array.from(exactLogin.requestDomains || []), ['accounts.google.com']);
  assert(!Object.prototype.hasOwnProperty.call(exactLogin, 'urlFilter'));
  assert(requestDomainsMatchHost(exactLogin, 'accounts.google.com'));
  assert(!requestDomainsMatchHost(exactLogin, 'accounts.google.com.evil'),
    'whole-domain allow escaped into a hostile suffix');

  const pathLogin = loginCompatibilityRuleCondition('||accounts.google.com/gsi/');
  assert.strictEqual(pathLogin.urlFilter, '||accounts.google.com/gsi/');
  assert(!Object.prototype.hasOwnProperty.call(pathLogin, 'requestDomains'),
    'path-scoped login rule was incorrectly broadened into a domain allow');

  const facebookOAuth = loginCompatibilityRuleCondition({
    requestDomains: ['facebook.com'],
    urlFilter: '/dialog/oauth',
  });
  assert.deepStrictEqual(Array.from(facebookOAuth.requestDomains || []), ['facebook.com']);
  assert.strictEqual(facebookOAuth.urlFilter, '/dialog/oauth');
  assert(requestDomainsMatchHost(facebookOAuth, 'www.facebook.com'));
  assert(requestDomainsMatchHost(facebookOAuth, 'm.facebook.com'));
  assert(!requestDomainsMatchHost(facebookOAuth, 'unrelated.example'),
    'an OAuth-looking query on an unrelated host matched the Facebook allowance');
  assert(new URL('https://www.facebook.com/v24.0/dialog/oauth?client_id=client').pathname.includes(facebookOAuth.urlFilter),
    'Facebook\'s versioned OAuth path is not covered by the bounded rule');

  assert(!/urlFilter:\s*['"]\|\|['"]\s*\+/.test(BACKGROUND),
    'a generated whole-domain rule still uses an unbounded ||domain URL filter');
});

test('background no longer closes blank login popups or blocks client-cert prompts', () => {
  assert(!BACKGROUND.includes('maybeCloseBlankPopupTarget'));
  assert(!BACKGROUND.includes('tabsRemoveSafe'));
  const sandbox = {
    trustHostFromUrl: () => 'portal.example',
    recentlyForcedFromHttp: () => null,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('function classifyTrustError', '\nasync function trustErrorPageUrl')
      + '\nthis.__classifyTrustError = classifyTrustError;',
    sandbox,
  );
  assert.strictEqual(
    sandbox.__classifyTrustError(
      'net::ERR_SSL_CLIENT_AUTH_CERT_NEEDED',
      'https://portal.example/',
      { forceHttps: false },
      1,
    ),
    null,
  );
});

test('media compatibility removes stale edge-ad blocks while retaining Twitch media allows', async () => {
  const { apply, state } = loadMediaCompatibilityRules();
  await apply(true);
  assert(state.updates[0].removeRuleIds.includes(806090),
    'media compatibility did not remove the formerly installed edge-ad rule');
  assert(!state.rules.some((rule) =>
    rule.condition && rule.condition.urlFilter === '||edge.ads.twitch.tv^'),
  'edge.ads.twitch.tv must not be blocked by DNR');

  const broadTwitchAllow = state.rules.find((rule) =>
    rule.condition && Array.from(rule.condition.requestDomains || []).includes('twitch.tv'));
  assert(broadTwitchAllow, 'missing broad Twitch compatibility allow');
  assert.strictEqual(broadTwitchAllow.action.type, 'allow');
  assert(broadTwitchAllow.priority > 1100 && broadTwitchAllow.priority < 2000,
    'Twitch compatibility must stay above ordinary ad rules and below security blocks');
  assert(!Object.prototype.hasOwnProperty.call(broadTwitchAllow.condition, 'urlFilter'),
    'Twitch compatibility allow must use a bounded requestDomains condition');
  assert(!requestDomainsMatchHost(broadTwitchAllow.condition, 'twitch.tv.evil'),
    'Twitch compatibility allow escaped into a hostile suffix');
  assert(Array.from(broadTwitchAllow.condition.resourceTypes || []).includes('media'),
    'Twitch compatibility allow no longer covers media');

  const updateCount = state.updates.length;
  await apply(true);
  assert.strictEqual(state.updates.length, updateCount,
    'unchanged media compatibility state performed a redundant DNR update');
});

test('media compatibility replaces legacy frame exemptions without overriding security rules', async () => {
  const { apply, securityRule, state } = loadMediaCompatibilityRules();
  await apply(true);
  assert(state.updates[0].removeRuleIds.includes(806000), 'the legacy frame exemption must be removed');
  assert(state.rules.every((rule) => rule.action.type === 'allow'), 'media compatibility must never exempt descendants');
  for (const domain of ['youtube.com', 'youtube-nocookie.com', 'youtu.be']) {
    const frame = state.rules.find((rule) => rule.condition.requestDomains.includes(domain)
      && rule.condition.resourceTypes.includes('main_frame'));
    assert(frame, domain + ' retains its frame-navigation compatibility rule');
    assert.deepStrictEqual(Array.from(frame.condition.resourceTypes), ['main_frame', 'sub_frame']);
  }
  for (const rule of state.rules) {
    const domains = Array.from(rule.condition.requestDomains || []);
    assert(domains.length > 0, 'every media exception must name a destination');
    if (!rule.condition.resourceTypes.includes('main_frame')) {
      assert(rule.condition.initiatorDomains.length > 0, 'subresource exceptions must name initiators');
    }
    const security = securityRule(domains[0], 6000001, 'security');
    assert(security.priority > rule.priority, 'security blocks must outrank media exceptions for ' + domains[0]);
  }
  await apply(false);
  assert.equal(state.rules.length, 0, 'disabling compatibility clears the entire old and new band');
});

test('X application-family DNR allows are first-party scoped and keep ping blocking intact', async () => {
  const { apply, state } = loadMediaCompatibilityRules();
  await apply(true);
  const expectedInitiators = ['twitter.com', 'x.com'];
  for (const domain of ['x.com', 'twitter.com', 'twimg.com']) {
    const rule = state.rules.find((candidate) =>
      candidate.condition && Array.from(candidate.condition.requestDomains || []).includes(domain));
    assert(rule, 'missing X application-family allow for ' + domain);
    assert.strictEqual(rule.action.type, 'allow', domain + ' must use a scoped allow, not allowAllRequests');
    assert(rule.priority > 1100 && rule.priority < 2000, domain + ' must retain the security priority boundary');
    assert.deepStrictEqual(
      Array.from(rule.condition.initiatorDomains || []).sort(),
      expectedInitiators,
      domain + ' must only be allowed for X/Twitter initiators',
    );
    const types = Array.from(rule.condition.resourceTypes || []);
    for (const required of ['script', 'stylesheet', 'image', 'font', 'xmlhttprequest', 'media', 'websocket']) {
      assert(types.includes(required), domain + ' compatibility is missing ' + required);
    }
    assert(!types.includes('ping'), domain + ' compatibility must not unblock tracking pings');
    assert(!rule.condition.urlFilter, domain + ' compatibility must use exact requestDomains, not a prefix URL filter');
  }
  assert(!state.rules.some((rule) =>
    rule.action && rule.action.type === 'allowAllRequests'
      && rule.condition
      && /(?:x|twitter|twimg)\.com/.test(String(rule.condition.urlFilter || ''))),
  'X compatibility must not use a blanket allowAllRequests rule');
});

test('X compatibility does not globally exempt Twitter tracking infrastructure', () => {
  const protectedMatch = BACKGROUND.match(/const\s+TRACKER_PROTECTED_DOMAINS\s*=\s*new Set\((\[[\s\S]*?\])\);/);
  const neverBlockMatch = BACKGROUND.match(/const\s+NEVER_BLOCK_DOMAINS\s*=\s*new Set\((\[[\s\S]*?\])\);/);
  assert(protectedMatch && neverBlockMatch, 'missing tracker or never-block domain set');
  const protectedDomains = Array.from(vm.runInNewContext(protectedMatch[1]));
  const neverBlockDomains = Array.from(vm.runInNewContext(neverBlockMatch[1]));
  for (const domain of ['x.com', 'twitter.com', 'twimg.com']) {
    assert(!protectedDomains.includes(domain), domain + ' was globally exempted from tracker learning');
  }
  for (const domain of ['x.com', 'twitter.com', 'twimg.com']) {
    assert(!neverBlockDomains.includes(domain), domain + ' was globally exempted from downloaded network filters');
  }
  const trackerIgnoreLine = /TRACKER_IGNORE=\/([^\n]+)\/i/.exec(CONTENT);
  assert(trackerIgnoreLine, 'missing tracker-ignore policy in shipped content');
  for (const token of ['x\\.com', 'twitter\\.com', 'twimg\\.com']) {
    assert(!trackerIgnoreLine[1].includes(token), token + ' was globally ignored by tracker observation');
  }
});

test('a trusted app keeps its functional socket, not just its xhr', () => {
  /* A downloaded rule that names no resourceTypes matches EVERY type. Allowing
     xhr but not websocket on the same host lets the fetch through and drops the
     socket, which does not read as a block -- it reads as a feature quietly not
     working. Reported as: the Spotify web player plays fine but Discord never
     shows what you are listening to, because the player publishes that state
     over a socket. */
  const fnStart = BACKGROUND.indexOf('async function applyNeverBlockAllowRules');
  const fnEnd = BACKGROUND.indexOf('function isMediaCompatFilter');
  assert(fnStart > 0 && fnEnd > fnStart, 'the never-block allow builder moved');
  const typesMatch = BACKGROUND.slice(fnStart, fnEnd).match(/resourceTypes:\s*(\[[^\]]*\])/);
  assert(typesMatch, 'the never-block allow rule no longer names its resource types');
  const types = vm.runInNewContext(typesMatch[1]);
  for (const type of ['script', 'stylesheet', 'font', 'xmlhttprequest', 'websocket', 'sub_frame']) {
    assert(types.includes(type), type + ' is functional infrastructure and must survive a false positive');
  }
  /* And the property this rule has always had, which the fix must not trade away:
     a pixel served from a trusted domain stays blockable. */
  for (const type of ['image', 'ping']) {
    assert(!types.includes(type), type + ' must stay blockable so tracking pixels are not exempted');
  }
});

test('trusted infrastructure covers hosts that are not siblings of the apex', () => {
  /* isNeverBlockDomain matches by suffix, so a host on a different registrable
     domain is never covered by the app it belongs to. Each of these serves a
     listed app and would not be protected by that app's entry. */
  const start = BACKGROUND.indexOf('const NEVER_BLOCK_DOMAINS');
  const end = BACKGROUND.indexOf('async function applyNeverBlockAllowRules');
  assert(start > 0 && end > start, 'the never-block domain region moved');
  const region = BACKGROUND.slice(start, end);
  for (const [domain, why] of [
    ['discord.gg', 'gateway.discord.gg carries every message and presence update'],
    ['scdn.co', 'i.scdn.co is where Spotify artwork comes from'],
    ['spotifycdn.com', 'Spotify player assets'],
  ]) {
    assert(region.includes("'" + domain + "'"), domain + ' is unprotected: ' + why);
  }
});

void (async () => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log('ok - ' + item.name);
    } catch (error) {
      failures += 1;
      console.error('not ok - ' + item.name);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  if (failures) process.exitCode = 1;
  else console.log('\n' + tests.length + ' network compatibility tests passed.');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

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
  const match = BACKGROUND.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\]);'));
  assert(match, 'missing array constant: ' + name);
  return vm.runInNewContext(match[1]);
}

function loadNetworkParsers() {
  const sandbox = {
    URL,
    isMediaCompatFilter: () => false,
    isMediaCompatDomain: () => false,
    isNeverBlockDomain: () => false,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('const UBO_TYPE_MAP', '\nfunction getListMeta')
      + '\nthis.__api = { parseList, parseNetworkRules };',
    sandbox,
  );
  return sandbox.__api;
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
  const sandbox = {
    MEDIA_COMPAT_RULE_BASE: 806000,
    chrome: { declarativeNetRequest },
    console,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween('let __mediaCompatibilityRulesEnabled', '\nlet __loginCompatibilityRulesEnabled')
      + '\nthis.__applyMediaCompatibilityRules = applyMediaCompatibilityRules;',
    sandbox,
  );
  return { apply: sandbox.__applyMediaCompatibilityRules, state };
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
    chrome: {
      declarativeNetRequest: {
        updateDynamicRules: async (update) => {
          state.updates.push(update);
          if (typeof options.onUpdate === 'function') await options.onUpdate(state);
        },
      },
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
      + sourceBetween("if (cfg.__locationPrivacyV344Enabled !== true)", '\n      if (changed) localSet')
      + '\nthis.__result = { cfg, changed };',
    sandbox,
  );
  return sandbox.__result;
}

function loadExactDomainRuleHelpers() {
  const sandbox = {
    RESOURCE_TYPES: Array.from(arrayConstant('RESOURCE_TYPES')),
    LOGIN_COMPAT_RESOURCE_TYPES: Array.from(arrayConstant('LOGIN_COMPAT_RESOURCE_TYPES')),
  };
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
    sourceBetween('function classifyTrustError', '\nfunction trustErrorPageUrl')
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
  assert.strictEqual(broadTwitchAllow.priority, 90000);
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

test('X application-family DNR allows are first-party scoped and keep ping blocking intact', async () => {
  const { apply, state } = loadMediaCompatibilityRules();
  await apply(true);
  const expectedInitiators = ['twitter.com', 'x.com'];
  for (const domain of ['x.com', 'twitter.com', 'twimg.com']) {
    const rule = state.rules.find((candidate) =>
      candidate.condition && Array.from(candidate.condition.requestDomains || []).includes(domain));
    assert(rule, 'missing X application-family allow for ' + domain);
    assert.strictEqual(rule.action.type, 'allow', domain + ' must use a scoped allow, not allowAllRequests');
    assert.strictEqual(rule.priority, 90000, domain + ' compatibility priority changed');
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

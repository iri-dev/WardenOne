/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Track the shipped cap instead of restating it, so raising the production bound
// re-exercises these tests at the new value rather than silently disagreeing.
const RECOVERY_MAX_HOSTS_PER_TAB = Number(
  (BACKGROUND.match(/SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB = (\d+)/) || [])[1],
);
assert(Number.isInteger(RECOVERY_MAX_HOSTS_PER_TAB) && RECOVERY_MAX_HOSTS_PER_TAB > 0,
  'could not read SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB from background.js');

function sourceBetween(start, end) {
  const from = BACKGROUND.indexOf(start);
  const to = BACKGROUND.indexOf(end, from + start.length);
  assert(from >= 0, 'missing source marker: ' + start);
  assert(to > from, 'missing end marker: ' + end);
  return BACKGROUND.slice(from, to);
}

function simpleHost(raw) {
  try {
    const value = String(raw || '').includes('://') ? new URL(String(raw)).hostname : String(raw || '');
    const host = value.replace(/^www\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) && host.includes('.') ? host : '';
  } catch (_) {
    return '';
  }
}

function createHarness(options = {}) {
  const state = {
    mode: options.mode || 'smart',
    enabled: options.enabled !== false,
    trusted: Array.from(options.trusted || []),
    dynamicRules: Array.from(options.dynamicRules || [
      { id: 930000, priority: 1000, action: { type: 'block' }, condition: { domainType: 'thirdParty', resourceTypes: ['script'] } },
      { id: 930001, priority: 1002, action: { type: 'allow' }, condition: { requestDomains: ['old-trusted.example'], resourceTypes: ['script'] } },
      { id: 41000, priority: 1100, action: { type: 'block' }, condition: { requestDomains: ['tracker.example'] } },
      { id: 42000, priority: 3000, action: { type: 'block' }, condition: { requestDomains: ['security.example'] } },
    ]),
    sessionRules: Array.from(options.sessionRules || []),
    dynamicUpdates: [],
    sessionUpdates: [],
    reloadCalls: [],
    reloadResponse: options.reloadResponse || { ok: true },
    errorObserver: null,
    modeReadGate: null,
  };
  state.holdNextModeRead = () => {
    let release;
    let entered;
    const wait = new Promise((resolve) => { release = resolve; });
    const enteredPromise = new Promise((resolve) => { entered = resolve; });
    state.modeReadGate = { wait, release, entered };
    return { entered: enteredPromise, release };
  };
  const replaceRules = (rules, update) => {
    const removed = new Set(Array.from(update.removeRuleIds || []));
    return rules.filter((rule) => !removed.has(rule.id)).concat(Array.from(update.addRules || []));
  };
  const chrome = {
    declarativeNetRequest: {
      async getDynamicRules() { return state.dynamicRules.slice(); },
      async getSessionRules() { return state.sessionRules.slice(); },
      async updateDynamicRules(update) {
        state.dynamicUpdates.push(update);
        state.dynamicRules = replaceRules(state.dynamicRules, update);
      },
      async updateSessionRules(update) {
        state.sessionUpdates.push(update);
        state.sessionRules = replaceRules(state.sessionRules, update);
      },
    },
    webRequest: {
      onErrorOccurred: {
        addListener(listener, filter) {
          state.errorObserver = { listener, filter };
        },
      },
    },
    tabs: {
      sendMessage(tabId, message, optionsArg, callback) {
        state.reloadCalls.push({ tabId, message, options: optionsArg });
        callback(state.reloadResponse);
      },
    },
    runtime: { lastError: null },
  };
  const sandbox = {
    URL,
    Map,
    Set,
    Promise,
    Date,
    console,
    chrome,
    DEFAULT_CONFIG: { enabled: true },
    SCRIPT_SHIELD_RULE_BASE: 930000,
    SCRIPT_SHIELD_RULE_MAX: 1000,
    SMART_SCRIPT_REPLACEMENT_RULE_OFFSET: 1,
    SMART_SCRIPT_STAGE_TWO_RULE_OFFSET: 100,
    SMART_SCRIPT_STAGE_TWO_RULE_PRIORITY: 1900,
    SCRIPT_SHIELD_MODE_KEY: 'wardenone_script_shield_mode',
    SCRIPT_TRUSTED_KEY: 'wardenone_script_trusted_hosts',
    SMART_SCRIPT_RECOVERY_MAX_TABS: 32,
    SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB: RECOVERY_MAX_HOSTS_PER_TAB,
    SMART_SCRIPT_PLAYER_CONTEXT_MAX: 256,
    SMART_SCRIPT_PLAYER_INTENT_MAX: 256,
    SMART_SCRIPT_PENDING_MAX: 128,
    SMART_SCRIPT_RETRY_MAX: 128,
    SMART_SCRIPT_PLAYER_CONTEXT_TTL_MS: 90000,
    SMART_SCRIPT_PLAYER_INTENT_TTL_MS: 15000,
    SMART_SCRIPT_PENDING_TTL_MS: 45000,
    SMART_SCRIPT_RETRY_TTL_MS: 600000,
    SMART_SCRIPT_TOP_RELOAD_TTL_MS: 8000,
    BLOCKED_DOMAINS: new Set(options.blocked || ['security.example']),
    GRABBER_FEED_DOMAINS: new Set(options.grabbers || ['grabber.example']),
    FINGERPRINT_SCRIPT_DOMAIN_FILTERS: Array.from(options.fingerprintDomains || ['fingerprint.example']),
    FINGERPRINT_SCRIPT_URL_FILTERS: Array.from(options.fingerprintPaths || ['fingerprintjs']),
    normalizeAllowlistHost: simpleHost,
    normalizeAllowlistHosts(list, limit) {
      return Array.from(new Set(Array.from(list || []).map(simpleHost).filter(Boolean))).slice(0, limit || 500);
    },
    registrableDomainBg(host) {
      const parts = simpleHost(host).split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : '';
    },
    async localGet(key) {
      if (key === 'wardenone_script_shield_mode') {
        const gate = state.modeReadGate;
        if (gate) {
          state.modeReadGate = null;
          gate.entered();
          await gate.wait;
        }
        return { wardenone_script_shield_mode: state.mode };
      }
      if (key === 'wardenone_script_trusted_hosts') return { wardenone_script_trusted_hosts: state.trusted.slice() };
      if (key === 'wardenone_config') return { wardenone_config: { enabled: state.enabled } };
      return {};
    },
    async localSet(value) {
      if (value.wardenone_script_trusted_hosts) state.trusted = value.wardenone_script_trusted_hosts.slice();
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween('function normalizeScriptShieldMode', '\nconst FINGERPRINT_SCRIPT_RESOURCE_TYPES')
      + '\nthis.__api = {'
      + 'applyScriptShieldRules, buildScriptShieldRulePlan, handleSmartScriptFailure, '
      + 'handleSmartScriptPlayerContext, handleSmartScriptPlayerIntent, clearSmartScriptRecoveryForTab, handleSmartScriptTopNavigation, '
      + 'normalizeSmartScriptFailure, SMART_SCRIPT_PLAYER_CONTEXTS, SMART_SCRIPT_PENDING_ERRORS, '
      + 'SMART_SCRIPT_PLAYER_INTENTS, SMART_SCRIPT_RECOVERED_TABS, SMART_SCRIPT_RETRY_KEYS, SMART_SCRIPT_NAVIGATION_EPOCHS, '
      + 'SCRIPT_SHIELD_PLAYER_INFRA_HOSTS, SCRIPT_SHIELD_FIRST_PARTY_APP_HOSTS};',
    sandbox,
  );
  return { api: sandbox.__api, state };
}

// Hosts Smart mode never blanket-blocks: player/CDN infrastructure plus the asset
// domains sites use to serve their own app code. Both are exempt by construction,
// so recovery assertions care only about what is exempted BEYOND them.
function alwaysExempt(api) {
  return api.SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.concat(api.SCRIPT_SHIELD_FIRST_PARTY_APP_HOSTS);
}

function smartRule(state) {
  return state.sessionRules.find((rule) => rule.id === 930000);
}

async function testModesAndTrustScope() {
  const { api, state } = createHarness({ trusted: ['trusted.example'] });
  assert.strictEqual(await api.applyScriptShieldRules('smart'), true);
  assert(!state.dynamicRules.some((rule) => rule.id >= 930000 && rule.id < 931000),
    'stale dynamic Smart block/allow rules survived migration');
  const rule = smartRule(state);
  assert(rule && rule.action.type === 'block', 'Smart session block was not installed');
  assert.strictEqual(rule.condition.domainType, 'thirdParty');
  assert.deepStrictEqual(Array.from(rule.condition.resourceTypes || []), ['script']);
  assert.deepStrictEqual(Array.from(rule.condition.excludedInitiatorDomains || []), ['trusted.example']);
  assert(!Object.prototype.hasOwnProperty.call(rule.condition, 'requestDomains'),
    'trusting a site globally allowed that request host');
  assert(state.dynamicRules.some((candidate) => candidate.id === 41000 && candidate.action.type === 'block'),
    'ordinary tracker block disappeared for a trusted site');
  assert(state.dynamicRules.some((candidate) => candidate.id === 42000 && candidate.priority === 3000),
    'security block disappeared for a trusted site');

  api.SMART_SCRIPT_RECOVERED_TABS.set(55, { at: Date.now(), failedHosts: ['cdn.player.example'] });
  await api.applyScriptShieldRules('smart');
  assert(Array.from((smartRule(state).condition.excludedTabIds || [])).includes(55));
  await api.applyScriptShieldRules('normal');
  assert(!smartRule(state), 'normal mode retained the Smart blanket block');
  await api.applyScriptShieldRules('smart');
  assert(!Array.from((smartRule(state).condition.excludedTabIds || [])).length,
    'Smart -> normal -> Smart resurrected a stale recovered-tab exclusion');
  await api.applyScriptShieldRules('lockdown');
  assert(!smartRule(state), 'lockdown mode retained a separate Smart DNR block');

  const disabled = createHarness({ enabled: false, trusted: ['trusted.example'] });
  await disabled.api.applyScriptShieldRules('smart');
  assert(!smartRule(disabled.state), 'master-off state installed Smart DNR');
}

async function testRecoveryAndRetryBound() {
  const { api, state } = createHarness();
  await api.applyScriptShieldRules('smart');
  const sender = {
    tab: { id: 4, url: 'https://stream.example/watch/show/1' },
    frameId: 0,
    url: 'https://stream.example/watch/show/1',
  };
  await api.handleSmartScriptPlayerContext(sender, { evidence: 'media-embed' });
  await api.handleSmartScriptPlayerIntent(sender);
  const failure = {
    type: 'script',
    error: 'net::ERR_BLOCKED_BY_CLIENT',
    tabId: 4,
    frameId: 3,
    parentFrameId: 0,
    url: 'https://cdn.media.example/player-module.js?build=1',
    documentUrl: 'https://embed.player.test/e/1',
    initiator: 'https://embed.player.test',
  };
  assert.strictEqual(await api.handleSmartScriptFailure(failure), true);
  assert.deepStrictEqual(Array.from(smartRule(state).condition.excludedTabIds || []), [4],
    'confirmed player tab was not removed from the blanket rule');
  const tabRule = state.sessionRules.find((rule) =>
    rule.condition && Array.from(rule.condition.tabIds || []).includes(4));
  assert(tabRule && tabRule.action.type === 'block', 'recovered tab has no replacement Smart block');
  assert.strictEqual(tabRule.condition.domainType, 'thirdParty');
  assert.deepStrictEqual(
    Array.from(tabRule.condition.excludedRequestDomains || [])
      .filter((host) => !alwaysExempt(api).includes(host)),
    ['cdn.media.example'],
    'replacement rule did not exempt only the failed request-domain family');
  alwaysExempt(api).forEach((host) => {
    assert(Array.from(tabRule.condition.excludedRequestDomains || []).includes(host),
      'replacement rule dropped the always-allowed host ' + host);
  });
  assert(!state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'recovery installed an allow action');
  assert.strictEqual(state.reloadCalls.length, 1, 'failing frame was not reloaded exactly once');
  assert.strictEqual(state.reloadCalls[0].tabId, 4);
  assert.strictEqual(state.reloadCalls[0].options.frameId, 3);
  assert.strictEqual(state.reloadCalls[0].message.expectedUrl, failure.documentUrl);
  assert.strictEqual(state.reloadCalls[0].message.failedHost, 'cdn.media.example');
  assert.strictEqual(state.reloadCalls[0].message.recoveryStage, 1);
  assert(!state.dynamicRules.some((rule) => rule.id >= 930000 && rule.id < 931000),
    'recovery installed a broad dynamic allow rule');
  assert(state.dynamicRules.some((rule) => rule.id === 41000), 'recovery removed the tracker fixture');
  assert(state.dynamicRules.some((rule) => rule.id === 42000), 'recovery removed the security fixture');

  assert.strictEqual(await api.handleSmartScriptFailure(failure), false,
    'stage two reused the player gesture consumed by stage one');
  await api.handleSmartScriptPlayerContext(sender, { evidence: 'media-embed' });
  assert.strictEqual(state.reloadCalls.length, 1, 'second-stage retry ran without a new player interaction');
  assert(!state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'stage two installed an allow before a fresh interaction');

  const secondIntent = await api.handleSmartScriptPlayerIntent(sender);
  assert.strictEqual(secondIntent.recovered, true, 'fresh player intent did not activate the bounded second stage');
  assert.strictEqual(state.reloadCalls.length, 2, 'second-stage exact script retry did not run once');
  assert.strictEqual(state.reloadCalls[1].message.recoveryStage, 2);
  const allowRule = state.sessionRules.find((rule) => rule.action && rule.action.type === 'allow');
  assert(allowRule, 'second correlated failure did not emit a session allow rule');
  assert.strictEqual(allowRule.priority, 1900);
  assert.deepStrictEqual(Array.from(allowRule.condition.tabIds || []), [4]);
  assert.deepStrictEqual(Array.from(allowRule.condition.requestDomains || []), ['cdn.media.example']);
  assert.deepStrictEqual(Array.from(allowRule.condition.initiatorDomains || []), ['embed.player.test']);
  assert.deepStrictEqual(Array.from(allowRule.condition.resourceTypes || []), ['script']);
  assert.strictEqual(allowRule.condition.isUrlFilterCaseSensitive, true);
  const exactPath = new RegExp(allowRule.condition.regexFilter);
  assert(exactPath.test('https://cdn.media.example/player-module.js?build=2'),
    'stage-two rule did not tolerate a cache-busting query on the exact path');
  assert(!exactPath.test('https://cdn.media.example/other-module.js?build=2'),
    'stage-two rule escaped to another script path on the same host');
  assert(!exactPath.test('https://sub.cdn.media.example/player-module.js'),
    'stage-two request-domain family was not narrowed back to the exact request host');

  const sameHostSecondPath = Object.assign({}, failure, {
    url: 'https://cdn.media.example/other-module.js',
  });
  await api.handleSmartScriptPlayerIntent(sender);
  assert.strictEqual(await api.handleSmartScriptFailure(sameHostSecondPath), true,
    'a distinct bootstrap path on the recovered host did not receive its own stage-one observation');
  assert.strictEqual(state.reloadCalls.length, 3, 'distinct same-host path did not receive one stage-one reload');
  assert.strictEqual(state.reloadCalls[2].message.recoveryStage, 1);
  assert.strictEqual(state.sessionRules.filter((rule) => rule.action && rule.action.type === 'allow').length, 1,
    'new same-host path skipped directly to stage two');
  assert.deepStrictEqual(
    Array.from(api.SMART_SCRIPT_RECOVERED_TABS.get(4).failedHosts || []),
    ['cdn.media.example'],
    'same-host path created a duplicate request-domain family exclusion',
  );
  assert.strictEqual(Array.from(api.SMART_SCRIPT_RECOVERED_TABS.get(4).stageOne || []).length, 2,
    'same-host bootstrap paths were not tracked as separate bounded stage-one entries');

  assert.strictEqual(await api.handleSmartScriptFailure(sameHostSecondPath), false,
    'second path reused the gesture consumed by its stage-one retry');
  const secondPathIntent = await api.handleSmartScriptPlayerIntent(sender);
  assert.strictEqual(secondPathIntent.recovered, true,
    'fresh intent did not escalate the independently observed second path');
  assert.strictEqual(state.reloadCalls.length, 4, 'second path did not receive one bounded stage-two reload');
  const sameHostAllows = state.sessionRules.filter((rule) => rule.action && rule.action.type === 'allow');
  assert.strictEqual(sameHostAllows.length, 2, 'same host did not retain separate exact-path allow rules');
  const secondPathAllow = sameHostAllows.find((rule) => new RegExp(rule.condition.regexFilter)
    .test('https://cdn.media.example/other-module.js'));
  assert(secondPathAllow, 'second same-host path did not emit its own exact-path rule');
  assert(!new RegExp(secondPathAllow.condition.regexFilter).test('https://cdn.media.example/third-module.js'),
    'second same-host path rule broadened to another path');

  const secondHost = Object.assign({}, failure, {
    url: 'https://modules.media.example/player-addon.js',
  });
  await api.handleSmartScriptPlayerIntent(sender);
  assert.strictEqual(await api.handleSmartScriptFailure(secondHost), true,
    'second required host in the same frame/document was rejected as a duplicate');
  const updatedTabRule = state.sessionRules.find((rule) =>
    rule.condition && Array.from(rule.condition.tabIds || []).includes(4));
  assert.deepStrictEqual(
    Array.from(updatedTabRule.condition.excludedRequestDomains || [])
      .filter((host) => !alwaysExempt(api).includes(host)),
    ['cdn.media.example', 'modules.media.example'],
    'bounded per-tab rule did not retain both failed request-domain families',
  );
  assert.strictEqual(state.reloadCalls.length, 5, 'second request-domain family did not receive its one bounded retry');
  await api.handleSmartScriptFailure(secondHost);
  assert.strictEqual(state.reloadCalls.length, 5, 'same host/route retried without a new player interaction');

  const cleanup = api.clearSmartScriptRecoveryForTab(4);
  assert(!api.SMART_SCRIPT_RECOVERED_TABS.has(4),
    'navigation cleanup left the tab recovered until an asynchronous DNR read completed');
  await cleanup;
  assert(!Array.from((smartRule(state).condition.excludedTabIds || [])).includes(4),
    'tab lifecycle cleanup left a Smart exclusion behind');
  assert(!state.sessionRules.some((rule) => rule.condition && Array.from(rule.condition.tabIds || []).includes(4)),
    'tab lifecycle cleanup left its replacement block behind');
}

async function testSyntheticAndNonPlayerRejection() {
  const { api, state } = createHarness();
  await api.applyScriptShieldRules('smart');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(await api.handleSmartScriptPlayerContext(
      { tab: { id: 8, url: 'https://plain.example/' }, frameId: 0, url: 'https://plain.example/' },
      { evidence: 'page-says-player' },
    ))),
    { ok: false },
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(await api.handleSmartScriptPlayerContext(
      { tab: { id: 8, url: 'https://plain.example/' }, frameId: 0, url: 'https://plain.example/' },
      { evidence: 'video-element' },
    ))),
    { ok: false },
    'an uncorroborated raw video was accepted as strong player evidence',
  );
  const unrelated = {
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 8, frameId: 0, parentFrameId: -1,
    url: 'https://cdn.media.example/app.js', documentUrl: 'https://plain.example/', initiator: 'https://plain.example',
  };
  assert.strictEqual(await api.handleSmartScriptFailure(unrelated), false);
  assert.strictEqual(state.reloadCalls.length, 0, 'non-player error triggered recovery');
  assert(!Array.from((smartRule(state).condition.excludedTabIds || [])).includes(8));

  await api.handleSmartScriptPlayerContext(
    { tab: { id: 9, url: 'https://video.example/watch/1' }, frameId: 0, url: 'https://video.example/watch/1' },
    { evidence: 'video-element' },
  );
  const sameParty = Object.assign({}, unrelated, {
    tabId: 9,
    url: 'https://cdn.video.example/app.js',
    documentUrl: 'https://video.example/watch/1',
    initiator: 'https://video.example',
  });
  assert.strictEqual(api.normalizeSmartScriptFailure(sameParty), null,
    'same-party block was misattributed to Smart third-party blocking');
  assert.strictEqual(await api.handleSmartScriptFailure(sameParty), false);
  assert.strictEqual(state.reloadCalls.length, 0);

  const wrongParent = createHarness();
  await wrongParent.api.applyScriptShieldRules('smart');
  await wrongParent.api.handleSmartScriptPlayerContext(
    { tab: { id: 10, url: 'https://stream.example/watch/3' }, frameId: 0, url: 'https://stream.example/watch/3' },
    { evidence: 'media-embed' },
  );
  assert.strictEqual(await wrongParent.api.handleSmartScriptFailure({
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 10, frameId: 4, parentFrameId: 2,
    url: 'https://cdn.media.example/player.js', documentUrl: 'https://embed.player.test/e/3', initiator: 'https://embed.player.test',
  }), false, 'a top-frame signal recovered a child whose exact parent was different');
  assert.strictEqual(wrongParent.state.reloadCalls.length, 0);

  for (const type of ['main_frame', 'image', 'ping']) {
    assert.strictEqual(api.normalizeSmartScriptFailure(Object.assign({}, unrelated, { type })), null,
      type + ' was accepted by the script-only recovery observer');
  }
  const longPath = 'x'.repeat(950) + '.js';
  assert.strictEqual(api.normalizeSmartScriptFailure(Object.assign({}, unrelated, {
    url: 'https://cdn.media.example/' + longPath,
  })), null, 'an overlong exact-path rule candidate was accepted');
}

async function testSecurityAndFingerprintTargetsNeverEscalate() {
  const cases = [
    { url: 'https://security.example/player.js', label: 'security domain' },
    { url: 'https://grabber.example/player.js', label: 'grabber domain' },
    { url: 'https://fingerprint.example/player.js', label: 'fingerprint domain' },
    { url: 'https://cdn.media.example/fingerprintjs-loader.js', label: 'fingerprint path' },
  ];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    const { api, state } = createHarness();
    await api.applyScriptShieldRules('smart');
    const sender = {
      tab: { id: 100 + index, url: 'https://watch.example/watch/security-boundary' },
      frameId: 0,
      url: 'https://watch.example/watch/security-boundary',
    };
    const failure = {
      type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 100 + index,
      frameId: 0, parentFrameId: -1, url: item.url,
      documentUrl: sender.url, initiator: 'https://watch.example',
    };
    await api.handleSmartScriptPlayerContext(sender, { evidence: 'known-player-root' });
    await api.handleSmartScriptPlayerIntent(sender);
    assert.strictEqual(await api.handleSmartScriptFailure(failure), true,
      item.label + ' did not receive the harmless stage-one Smart-only retry');
    await api.handleSmartScriptPlayerIntent(sender);
    assert.strictEqual(await api.handleSmartScriptFailure(failure), false,
      item.label + ' escaped into the stronger second stage');
    assert(!state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
      item.label + ' produced a compatibility allow rule');
    assert.strictEqual(state.reloadCalls.length, 1, item.label + ' received a second reload');
  }
}

async function testRejectedReloadRollsBackExclusion() {
  const { api, state } = createHarness({ reloadResponse: { ok: false } });
  await api.applyScriptShieldRules('smart');
  await api.handleSmartScriptPlayerContext(
    { tab: { id: 14, url: 'https://stream.example/watch/2' }, frameId: 0, url: 'https://stream.example/watch/2' },
    { evidence: 'media-embed' },
  );
  await api.handleSmartScriptPlayerIntent(
    { tab: { id: 14, url: 'https://stream.example/watch/2' }, frameId: 0, url: 'https://stream.example/watch/2' },
  );
  const failure = {
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 14, frameId: 2, parentFrameId: 0,
    url: 'https://cdn.media.example/player.js', documentUrl: 'https://embed.player.test/e/2', initiator: 'https://embed.player.test',
  };
  assert.strictEqual(await api.handleSmartScriptFailure(failure), false,
    'bridge rejection was treated as a successful reload');
  assert(!Array.from((smartRule(state).condition.excludedTabIds || [])).includes(14),
    'failed frame delivery stranded a tab exclusion');
  assert(!api.SMART_SCRIPT_RECOVERED_TABS.has(14), 'failed frame delivery stranded in-memory recovery state');
  state.reloadResponse = { ok: true };
  assert.strictEqual(await api.handleSmartScriptFailure(failure), true,
    'rolled-back retry could not recover after bridge delivery resumed');
  assert.strictEqual(state.reloadCalls.length, 2);
}

async function testTrustedIntentGateAndStaleness() {
  const { api, state } = createHarness();
  await api.applyScriptShieldRules('smart');
  const sender = {
    tab: { id: 21, url: 'https://stream.example/watch/intent' },
    frameId: 0,
    url: 'https://stream.example/watch/intent',
  };
  const failure = {
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 21, frameId: 0, parentFrameId: -1,
    url: 'https://exact.cdn.example/player.js',
    documentUrl: sender.url,
    initiator: 'https://stream.example',
  };
  // A blocked script with no player context at all must never recover: evidence is
  // what scopes this to real players, and without it there is nothing to act on.
  assert.strictEqual(await api.handleSmartScriptFailure(failure), false,
    'a blocked script recovered with no player evidence for the frame');
  assert.strictEqual(state.reloadCalls.length, 0);

  // Verified player evidence alone drives stage one. This is deliberate: when the
  // player UI is built by the blocked script, no clickable player element ever
  // exists, so a gesture requirement here can never be satisfied. Stage one only
  // drops Smart's heuristic for this host in this tab and emits no allow rule.
  await api.handleSmartScriptPlayerContext(sender, { evidence: 'known-player-root' });
  assert.strictEqual(state.reloadCalls.length, 1,
    'verified player evidence did not release the pending failed script');
  assert.strictEqual(state.reloadCalls[0].message.recoveryStage, 1);
  assert(!state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'evidence-only stage one installed an allow rule');

  // Stage two emits a real allow rule, so it still requires a fresh trusted gesture
  // and evidence alone must never reach it.
  assert.strictEqual(await api.handleSmartScriptFailure(failure), false,
    'evidence alone escaped into the stronger second stage');
  assert.strictEqual(state.reloadCalls.length, 1, 'stage two ran without a player interaction');
  assert(!state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'stage two installed an allow before a trusted interaction');
  const intentResult = await api.handleSmartScriptPlayerIntent(sender);
  assert.strictEqual(intentResult.recovered, true, 'trusted player intent did not activate the second stage');
  assert.strictEqual(state.reloadCalls.length, 2);
  assert.strictEqual(state.reloadCalls[1].message.recoveryStage, 2);

  // A stale gesture must not authorize stage two either.
  const stale = createHarness();
  await stale.api.applyScriptShieldRules('smart');
  const staleSender = {
    tab: { id: 22, url: 'https://stream.example/watch/stale' }, frameId: 0,
    url: 'https://stream.example/watch/stale',
  };
  const staleFailure = Object.assign({}, failure, {
    tabId: 22,
    documentUrl: staleSender.url,
    initiator: 'https://stream.example',
  });
  await stale.api.handleSmartScriptPlayerContext(staleSender, { evidence: 'route-video' });
  await stale.api.handleSmartScriptPlayerIntent(staleSender);
  assert.strictEqual(await stale.api.handleSmartScriptFailure(staleFailure), true);
  assert.strictEqual(stale.state.reloadCalls.length, 1);
  // Stage one consumed that gesture. Register another, then age it past its TTL.
  await stale.api.handleSmartScriptPlayerIntent(staleSender);
  stale.api.SMART_SCRIPT_PLAYER_INTENTS.get('22:0').at = Date.now() - 15001;
  assert.strictEqual(await stale.api.handleSmartScriptFailure(staleFailure), false,
    'stale player intent authorized the stronger second stage');
  assert.strictEqual(stale.state.reloadCalls.length, 1);
  assert(!stale.state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'stale player intent produced a compatibility allow rule');
}

async function testNavigationEpochCancelsInFlightRecovery() {
  const { api, state } = createHarness();
  await api.applyScriptShieldRules('smart');
  const sender = {
    tab: { id: 31, url: 'https://stream.example/watch/race' }, frameId: 0,
    url: 'https://stream.example/watch/race',
  };
  const failure = {
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 31, frameId: 0, parentFrameId: -1,
    url: 'https://race.cdn.example/player.js', documentUrl: sender.url, initiator: 'https://stream.example',
  };
  await api.handleSmartScriptPlayerContext(sender, { evidence: 'route-video' });
  await api.handleSmartScriptPlayerIntent(sender);
  const gate = state.holdNextModeRead();
  const recovery = api.handleSmartScriptFailure(failure);
  await gate.entered;
  const cleanup = api.clearSmartScriptRecoveryForTab(31);
  assert.strictEqual(api.SMART_SCRIPT_NAVIGATION_EPOCHS.get(31).epoch, 1,
    'navigation did not synchronously invalidate the recovery epoch');
  assert(!api.SMART_SCRIPT_RECOVERED_TABS.has(31));
  const newSender = {
    tab: { id: 31, url: 'https://stream.example/watch/race-new' }, frameId: 0,
    url: 'https://stream.example/watch/race-new',
  };
  const newFailure = Object.assign({}, failure, {
    url: 'https://new-route.cdn.example/player.js',
    documentUrl: newSender.url,
  });
  await api.handleSmartScriptPlayerContext(newSender, { evidence: 'route-video' });
  await api.handleSmartScriptPlayerIntent(newSender);
  assert.strictEqual(await api.handleSmartScriptFailure(newFailure), true,
    'new navigation epoch was rejected by the canceled old in-flight recovery');
  gate.release();
  assert.strictEqual(await recovery, false, 'pre-navigation recovery survived the epoch change');
  await cleanup;
  assert.strictEqual(state.reloadCalls.length, 1, 'old frame was reloaded in addition to the new route');
  assert.strictEqual(state.reloadCalls[0].message.failedHost, 'new-route.cdn.example');
  const tabRule = state.sessionRules.find((rule) =>
    rule.condition && Array.from(rule.condition.tabIds || []).includes(31));
  assert(tabRule, 'new epoch replacement rule was lost when the old recovery finished');
  assert.deepStrictEqual(
    Array.from(tabRule.condition.excludedRequestDomains || [])
      .filter((host) => !alwaysExempt(api).includes(host)),
    ['new-route.cdn.example'],
    'old recovery host leaked into the new navigation epoch');
}

async function testRestartRehydrationAndCaps() {
  const persisted = createHarness({
    sessionRules: [{
      id: 930000,
      priority: 1000,
      action: { type: 'block' },
      condition: { domainType: 'thirdParty', resourceTypes: ['script'], excludedTabIds: [77] },
    }],
  });
  assert.strictEqual(persisted.api.SMART_SCRIPT_RECOVERED_TABS.size, 0,
    'test must begin with empty in-memory recovery state');
  await persisted.api.clearSmartScriptRecoveryForTab(77);
  assert(!Array.from((smartRule(persisted.state).condition.excludedTabIds || [])).includes(77),
    'service-worker restart left a persisted excludedTabId after navigation cleanup');

  const rehydrated = createHarness({
    sessionRules: [
      {
        id: 930000, priority: 1000, action: { type: 'block' },
        condition: { domainType: 'thirdParty', resourceTypes: ['script'], excludedTabIds: [88] },
      },
      {
        id: 930001, priority: 1000, action: { type: 'block' },
        condition: {
          domainType: 'thirdParty', resourceTypes: ['script'], tabIds: [88],
          excludedRequestDomains: ['exact.cdn.example'],
        },
      },
      {
        id: 930100, priority: 1900, action: { type: 'allow' },
        condition: {
          tabIds: [88], requestDomains: ['exact.cdn.example'],
          initiatorDomains: ['embed.player.test'], resourceTypes: ['script'],
          regexFilter: '^https://exact\\.cdn\\.example/player\\.js(?:\\?[^#]*)?$',
          isUrlFilterCaseSensitive: true,
        },
      },
    ],
  });
  await rehydrated.api.applyScriptShieldRules('smart');
  assert.deepStrictEqual(
    Array.from(rehydrated.api.SMART_SCRIPT_RECOVERED_TABS.get(88).failedHosts || []),
    ['exact.cdn.example'],
    'cold worker did not rehydrate the least-privilege per-tab host state',
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(rehydrated.api.SMART_SCRIPT_RECOVERED_TABS.get(88).stageTwo || [])),
    [{
      requestHost: 'exact.cdn.example', initiatorHost: 'embed.player.test',
      resourceType: 'script', requestPath: 'https://exact.cdn.example/player.js',
    }],
    'cold worker did not rehydrate the exact-path second-stage state',
  );
  const rehydratedAllow = rehydrated.state.sessionRules.find((rule) => rule.action && rule.action.type === 'allow');
  assert(rehydratedAllow && rehydratedAllow.condition.regexFilter === '^https://exact\\.cdn\\.example/player\\.js(?:\\?[^#]*)?$',
    'reconciliation dropped or broadened the persisted exact-path allow');

  const hostOnly = createHarness({
    sessionRules: [
      {
        id: 930000, priority: 1000, action: { type: 'block' },
        condition: { domainType: 'thirdParty', resourceTypes: ['script'], excludedTabIds: [89] },
      },
      {
        id: 930001, priority: 1000, action: { type: 'block' },
        condition: {
          domainType: 'thirdParty', resourceTypes: ['script'], tabIds: [89],
          excludedRequestDomains: ['exact.cdn.example'],
        },
      },
    ],
  });
  await hostOnly.api.applyScriptShieldRules('smart');
  const sender = {
    tab: { id: 89, url: 'https://watch.example/watch/cold-route' }, frameId: 0,
    url: 'https://watch.example/watch/cold-route',
  };
  await hostOnly.api.handleSmartScriptPlayerContext(sender, { evidence: 'known-player-root' });
  await hostOnly.api.handleSmartScriptPlayerIntent(sender);
  const coldPath = {
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 89, frameId: 0, parentFrameId: -1,
    url: 'https://exact.cdn.example/different-path.js', documentUrl: sender.url,
    initiator: 'https://watch.example',
  };
  assert.strictEqual(await hostOnly.api.handleSmartScriptFailure(coldPath), true,
    'cold host-only state did not rebuild exact-path stage-one evidence');
  assert.strictEqual(hostOnly.state.reloadCalls[0].message.recoveryStage, 1,
    'cold host-only state skipped directly to stage two');
  assert(!hostOnly.state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'cold host-only state emitted a stage-two allow without persisted path evidence');
  assert.strictEqual(await hostOnly.api.handleSmartScriptFailure(coldPath), false,
    'cold exact-path observation reused the gesture consumed by stage one');
  assert(!hostOnly.state.sessionRules.some((rule) => rule.action && rule.action.type === 'allow'),
    'cold exact-path observation escalated without a new trusted interaction');

  const pathCapped = createHarness();
  await pathCapped.api.applyScriptShieldRules('smart');
  const capSender = {
    tab: { id: 90, url: 'https://watch.example/watch/path-cap' }, frameId: 0,
    url: 'https://watch.example/watch/path-cap',
  };
  await pathCapped.api.handleSmartScriptPlayerContext(capSender, { evidence: 'known-player-root' });
  const pathFailure = (index) => ({
    type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 90, frameId: 0, parentFrameId: -1,
    url: 'https://shared.cdn.example/bootstrap-' + index + '.js',
    documentUrl: capSender.url, initiator: 'https://watch.example',
  });
  for (let index = 1; index <= RECOVERY_MAX_HOSTS_PER_TAB; index++) {
    await pathCapped.api.handleSmartScriptPlayerIntent(capSender);
    assert.strictEqual(await pathCapped.api.handleSmartScriptFailure(pathFailure(index)), true,
      'bounded same-host stage-one path ' + index + ' was rejected early');
  }
  await pathCapped.api.handleSmartScriptPlayerIntent(capSender);
  assert.strictEqual(await pathCapped.api.handleSmartScriptFailure(pathFailure(RECOVERY_MAX_HOSTS_PER_TAB + 1)), false,
    'exact path past the per-tab recovery cap was still recovered');
  assert.strictEqual(pathCapped.api.SMART_SCRIPT_RECOVERED_TABS.get(90).stageOne.length, RECOVERY_MAX_HOSTS_PER_TAB,
    'exact-path stage-one state exceeded the per-tab cap');
  assert.deepStrictEqual(Array.from(pathCapped.api.SMART_SCRIPT_RECOVERED_TABS.get(90).failedHosts || []),
    ['shared.cdn.example'], 'same-host path cap duplicated the request-domain family');
  assert.strictEqual(pathCapped.state.reloadCalls.length, RECOVERY_MAX_HOSTS_PER_TAB,
    'same-host path past the cap received a recovery reload');

  const capped = createHarness();
  for (let id = 1; id <= 60; id++) {
    capped.api.SMART_SCRIPT_RECOVERED_TABS.set(id, {
      at: Date.now(),
      failedHosts: Array.from(
        { length: RECOVERY_MAX_HOSTS_PER_TAB + 1 },
        (_unused, index) => 'host-' + index + '-' + id + '.cdn.example',
      ),
    });
  }
  await capped.api.applyScriptShieldRules('smart');
  assert.strictEqual(Array.from(smartRule(capped.state).condition.excludedTabIds || []).length, 32,
    'Smart recovery tab exclusions exceeded the fixed cap');
  assert.strictEqual(capped.state.sessionRules.filter((rule) => rule.condition && rule.condition.tabIds).length, 32,
    'per-tab Smart replacement rule count exceeded the fixed cap');
  for (const rule of capped.state.sessionRules.filter((candidate) => candidate.condition && candidate.condition.tabIds)) {
    assert.strictEqual(
      Array.from(rule.condition.excludedRequestDomains || [])
        .filter((host) => !alwaysExempt(capped.api).includes(host)).length,
      RECOVERY_MAX_HOSTS_PER_TAB,
      'request-domain family exclusions exceeded the per-tab cap');
  }
}

// H13. The evidence test asked for artefacts the blocking removes, so a player built entirely in
// script could never satisfy it -- a deadlock, not a missing selector. 'route-blocked' reports the
// absence instead. The whole safety of that rests on it granting nothing by itself, so that is the
// first thing asserted here.
async function testDeadlockReportGrantsNothingAlone() {
  // 1. The security boundary. A page on a watch route that renders nothing can say so, and it must
  //    change absolutely nothing unless webRequest independently saw a script blocked in that frame.
  {
    const { api, state } = createHarness();
    await api.applyScriptShieldRules('smart');
    const before = JSON.stringify(smartRule(state));
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(await api.handleSmartScriptPlayerContext(
        { tab: { id: 21, url: 'https://forge.example/watch/1' }, frameId: 0, url: 'https://forge.example/watch/1' },
        { evidence: 'route-blocked' },
      ))),
      { ok: true },
      'the deadlock report was rejected outright, so a genuine deadlock cannot be reported either',
    );
    assert.strictEqual(state.reloadCalls.length, 0,
      'a deadlock report with no observed block triggered recovery -- any page could lift script blocking on itself');
    assert.strictEqual(JSON.stringify(smartRule(state)), before,
      'a deadlock report with no observed block changed the blocking rule');
    assert(!Array.from(smartRule(state).condition.excludedTabIds || []).includes(21));
  }

  // 2. The deadlock itself. Same report, but this time the extension really did block a script in
  //    that frame -- which is the case H13 describes, and the one that used to hang forever.
  {
    const { api, state } = createHarness();
    await api.applyScriptShieldRules('smart');
    await api.handleSmartScriptPlayerContext(
      { tab: { id: 22, url: 'https://anime.example/watch/9' }, frameId: 0, url: 'https://anime.example/watch/9' },
      { evidence: 'route-blocked' },
    );
    assert.strictEqual(await api.handleSmartScriptFailure({
      type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 22, frameId: 0, parentFrameId: -1,
      url: 'https://cdn.player.test/hls.js', documentUrl: 'https://anime.example/watch/9', initiator: 'https://anime.example',
    }), true, 'a script-built player on a blocked route still could not recover');
    assert.strictEqual(state.reloadCalls.length, 1, 'recovery did not reload the deadlocked frame');
  }

  // 3. Reporting the deadlock must not become a way to un-block a tracker. This is the case a page
  //    would actually want: reference something known-bad, claim the player is broken, get it back.
  {
    const { api, state } = createHarness();
    await api.applyScriptShieldRules('smart');
    await api.handleSmartScriptPlayerContext(
      { tab: { id: 23, url: 'https://anime.example/watch/9' }, frameId: 0, url: 'https://anime.example/watch/9' },
      { evidence: 'route-blocked' },
    );
    for (const host of ['security.example', 'grabber.example', 'fingerprint.example']) {
      await api.handleSmartScriptFailure({
        type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 23, frameId: 0, parentFrameId: -1,
        url: 'https://' + host + '/track.js', documentUrl: 'https://anime.example/watch/9', initiator: 'https://anime.example',
      });
    }
    const stageTwo = state.dynamicRules.concat(state.sessionRules)
      .filter((rule) => rule.action && rule.action.type === 'allow');
    for (const host of ['security.example', 'grabber.example', 'fingerprint.example']) {
      assert(!JSON.stringify(stageTwo).includes(host),
        host + ' was allowed through a deadlock report');
    }
  }

  // 4. 'media-embed' may match a pending error in a *parent* frame, because an embed chain reports
  //    from the outer frame. A deadlock report gets no such reach: its own frame or nothing.
  {
    const { api, state } = createHarness();
    await api.applyScriptShieldRules('smart');
    await api.handleSmartScriptPlayerContext(
      { tab: { id: 24, url: 'https://anime.example/watch/9' }, frameId: 0, url: 'https://anime.example/watch/9' },
      { evidence: 'route-blocked' },
    );
    assert.strictEqual(await api.handleSmartScriptFailure({
      type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 24, frameId: 5, parentFrameId: 0,
      url: 'https://cdn.player.test/hls.js', documentUrl: 'https://embed.player.test/e/9', initiator: 'https://embed.player.test',
    }), false, 'a deadlock report in the top frame recovered a child frame, which only media-embed may do');
    assert.strictEqual(state.reloadCalls.length, 0);

    // And the other arrival order, which is where the parent-frame fallback actually lives: the
    // child's block is already pending when the parent reports. Only 'media-embed' may reach across
    // frames like that. Asserting one order alone leaves this path untested -- it was, until a
    // mutation that widened the fallback to 'route-blocked' went unnoticed.
    const reverse = createHarness();
    await reverse.api.applyScriptShieldRules('smart');
    assert.strictEqual(await reverse.api.handleSmartScriptFailure({
      type: 'script', error: 'net::ERR_BLOCKED_BY_CLIENT', tabId: 25, frameId: 5, parentFrameId: 0,
      url: 'https://cdn.player.test/hls.js', documentUrl: 'https://embed.player.test/e/9', initiator: 'https://embed.player.test',
    }), false, 'a child-frame block recovered with no player context at all');
    await reverse.api.handleSmartScriptPlayerContext(
      { tab: { id: 25, url: 'https://anime.example/watch/9' }, frameId: 0, url: 'https://anime.example/watch/9' },
      { evidence: 'route-blocked' },
    );
    assert.strictEqual(reverse.state.reloadCalls.length, 0,
      'a deadlock report adopted a child frame\'s pending block, which only media-embed may do');
  }

  // 5. The bridge half: reporting is scoped and bounded, so this is a deadlock report and not an
  //    impatience report. A page whose player works has had a dozen scans to render it.
  {
    // sourceBetween() reads background.js; this half lives in the bridge, so slice it here.
    const from = BRIDGE.indexOf('  const SMART_PLAYER_DEADLOCK_MS');
    const to = BRIDGE.indexOf('  function sendSmartPlayerContext');
    assert(from >= 0 && to > from, 'the bridge no longer defines the deadlock reporter');
    const src = BRIDGE.slice(from, to);

    // THE regression, and the reason this group exists in this shape. The first version of this fix
    // gated on smartPlayerScanCount, which only climbs when domWatch fires -- and domWatch fires on
    // DOM mutations, produced by the scripts that were blocked. It could never fire on the pages it
    // was written for: H13's own circular dependency, one level up. Tested live, still black.
    // Anything the reporter waits for must not be something the page has to do.
    assert(!/smartPlayerScanCount/.test(src),
      'the deadlock reporter depends on the scan count again, which the blocking itself prevents from climbing');
    assert(/woTimeout\(/.test(BRIDGE.slice(BRIDGE.indexOf('function armSmartPlayerObservation'), from + 4000))
      || /woTimeout\(/.test(BRIDGE.slice(BRIDGE.indexOf('smartPlayerDeadlockDue = false'))),
      'nothing drives the deadlock check, so on a page with no mutations it is never evaluated');
    // It must also send for itself: on a deadlocked page nothing else calls sendSmartPlayerContext.
    const armStart = BRIDGE.indexOf('function armSmartPlayerObservation');
    const armEnd = BRIDGE.indexOf('\n  }\n', BRIDGE.indexOf('SMART_PLAYER_DEADLOCK_MS', armStart));
    assert(/sendSmartPlayerContext\(/.test(BRIDGE.slice(armStart, armEnd)),
      'the deadlock timer never reports, so reaching the deadline changes nothing');

    const mk = (due, href, isTop) => {
      const sandbox = { location: { href }, window: {}, URL };
      sandbox.window.top = isTop ? sandbox.window : {};
      vm.createContext(sandbox);
      vm.runInContext(
        'const smartPlayerRoute = (raw) => /(?:^|\\/)(?:watch|episode|stream|video|play|player|embed)(?:\\/|$|[-_?])/i'
          + '.test(new URL(raw || location.href).pathname);\n'
          + src + '\nsmartPlayerDeadlockDue = ' + String(due) + ';\nthis.out = smartPlayerDeadlock();',
        sandbox,
      );
      return sandbox.out;
    };
    assert.strictEqual(mk(false, 'https://anime.example/watch/9', true), '',
      'the deadlock was reported before the deadline elapsed');
    assert.strictEqual(mk(true, 'https://anime.example/watch/9', true), 'route-blocked',
      'a watch route still rendering nothing at the deadline reported nothing');
    assert.strictEqual(mk(true, 'https://plain.example/about', true), '',
      'an ordinary top-level page reported a player deadlock');
    assert.strictEqual(mk(true, 'https://opaque.test/x7f2', false), 'route-blocked',
      'a subframe is a player context in its own right and should still report');
  }

  // 6. And the string has to be one the background actually accepts, or none of the above runs.
  assert(/SMART_SCRIPT_PLAYER_EVIDENCE = new Set\(\[[^\]]*'route-blocked'/.test(BACKGROUND),
    'the bridge reports route-blocked but background does not accept it');
}

// Office on the web. word.cloud.microsoft serves every one of its scripts from res.cdn.office.net,
// which shares no registrable domain with the page, so Smart Script Shield read first-party
// application code as third-party and refused it. Word stopped on its splash icon and named nothing.
// These hosts must be excluded by the BASE rule, not merely reachable through recovery -- recovery
// needs an observed block first, which means the app has already failed to start once.
async function testFirstPartyAppHostsAreExcludedUpFront() {
  const { api, state } = createHarness();
  await api.applyScriptShieldRules('smart');
  const excluded = Array.from(smartRule(state).condition.excludedRequestDomains || []);
  for (const host of ['office.net', 'officeapps.live.com', 'tiktokcdn-eu.com', 'ttwstatic.com']) {
    assert(excluded.includes(host),
      host + ' is not excluded by the base smart rule, so that site loads nothing before any recovery can run');
  }
  // The exclusion must be a listed first-party app host, not a side effect of some broader wildcard
  // that would also spare unrelated third parties.
  assert(!excluded.includes('microsoft.com'),
    'the exclusion list has grown a whole brand domain, which is wider than first-party app hosts');
  assert(!excluded.some((h) => h === 'akamaized.net' || h === 'azureedge.net'),
    'a shared CDN was added to the first-party list, which would spare every tenant on it');
}

function testRegistrationAndBridgeBounds() {
  assert(/chrome\.webRequest\?\.onErrorOccurred\?\.addListener\([\s\S]*types:\s*\['script'\]/.test(BACKGROUND),
    'script errors are not observed with a script-only webRequest filter');
  // Matched on intent -- a direct chrome.runtime.sendMessage from the bridge carrying
  // the signal -- rather than on the exact argument list, so adding a callback that
  // reads runtime.lastError does not read as the signal being relayed via the page.
  assert(/chrome\.runtime\.sendMessage\(\{\s*kind:\s*'smart-player-context',\s*evidence\s*\}/.test(BRIDGE),
    'player signal is not sent directly from the isolated bridge');
  assert(BRIDGE.includes('const smartFrameReloadedUrls = new Set()'), 'bridge retry is not URL/host-bounded');
  assert(BRIDGE.includes("const reloadKey = expected + '|' + failedHost + '|stage-'"),
    'bridge retry does not distinguish exact failed hosts and recovery stages');
  assert(BRIDGE.includes('smartFrameReloadedUrls.clear()'), 'SPA route change does not reset bounded reload keys');
  assert(BRIDGE.includes("msg.kind === 'smart-script-reload-frame'"), 'bridge lacks frame reload receiver');
  assert(!BRIDGE.includes("if (document.querySelector('video')) return 'video-element'"),
    'an uncorroborated raw video still creates player evidence');
  assert(BRIDGE.includes("if (document.querySelector('video')) return 'route-video'"),
    'route-corroborated video evidence is missing');
  assert(BRIDGE.includes('const scopedPlayerContext = smartPlayerRoute() || window.top !== window'),
    'known player roots are not route/frame corroborated');
  assert(BRIDGE.includes("return 'media-embed'"), 'bridge lacks strong media-embed evidence');
  /* Matched on the events, not on the registration call: the bridge's listeners go through its
     teardown registry now, which changed nothing about when it rescans. */
  assert(/'popstate'/.test(BRIDGE), 'bridge does not rescan after SPA history navigation');
  assert(/'hashchange'/.test(BRIDGE), 'bridge does not rescan after hash-route navigation');
  assert(BACKGROUND.includes('chrome.webNavigation?.onHistoryStateUpdated?.addListener'),
    'recovered tabs are not cleaned up on SPA history navigation');
  assert(BACKGROUND.includes("kind: 'smart-script-route-changed'"),
    'pushState/replaceState changes do not re-arm the isolated bridge');
  assert(BRIDGE.includes('[30000, 90000, 180000]'),
    'delayed player startup has no bounded rescan windows');
  assert(BRIDGE.includes("bridgeRateOk('smart-player-rearm', 16, 60000)"),
    'SPA/delayed player rescans are not rate bounded');
  assert(BRIDGE.includes('if (!event || event.isTrusted !== true) return;'),
    'player intent does not require an explicitly trusted browser event');
  assert(/chrome\.runtime\.sendMessage\(\{\s*kind:\s*'smart-player-intent'\s*\}/.test(BRIDGE),
    'trusted player intent is not sent directly from the isolated bridge');
  assert(BACKGROUND.includes('SMART_SCRIPT_PLAYER_INTENT_TTL_MS = 15000'),
    'generic host recovery intent is not short-lived');
  assert(BACKGROUND.includes('SMART_SCRIPT_PENDING_TTL_MS = 45000'),
    'pending player failures do not survive long enough for a bounded user click');
  const bridgeRegistration = (MANIFEST.content_scripts || []).find((entry) =>
    Array.isArray(entry.js) && entry.js.includes('bridge.js'));
  assert(bridgeRegistration && bridgeRegistration.all_frames === true && bridgeRegistration.world === 'ISOLATED',
    'player context bridge is not isolated and all-frame');
  assert(!(MANIFEST.permissions || []).includes('declarativeNetRequestFeedback'),
    'recovery added a new feedback permission');
  assert(BACKGROUND.includes("'smart-player-context': { max: 8, windowMs: 60000 }"),
    'background player signals are not rate-limited');
  assert(BACKGROUND.includes('SMART_SCRIPT_RECOVERY_MAX_TABS = 32'),
    'recovered-tab exclusions are not capped');
  assert(BACKGROUND.includes('const SCRIPT_SHIELD_RULES_BUDGET = 161;'),
    'rule budget does not reserve blanket, replacement, and bounded stage-two rules');
  assert(BACKGROUND.includes('const SMART_SCRIPT_STAGE_TWO_RULE_OFFSET = 100;'),
    'stage-two rule band is not separated from per-tab replacement rules');
  assert(BRIDGE.includes("return { kind: 'adshield-cosmetic', hostname, playerPage: msg.playerPage === true }"),
    'isolated relay does not forward playerPage with strict boolean semantics');
}

// Regression: Smart mode blocks third-party scripts, but plenty of large sites serve
// their OWN application code from a separate registrable domain. Pinterest ships every
// .mjs bundle from pinimg.com while the page is pinterest.com, so the blanket rule
// blocked the entire app and the page rendered blank with React never hydrating.
// Recovery could not save it either -- that only engages on video-player pages.
async function testFirstPartyAppCdnsStayLoadable() {
  const { api, state } = createHarness();
  await api.applyScriptShieldRules('smart');
  const blanket = smartRule(state);
  assert(blanket && blanket.action.type === 'block', 'Smart mode installed no blanket rule');
  const exempt = Array.from(blanket.condition.excludedRequestDomains || []);

  // The reported breakage, stated as the site that broke.
  assert(exempt.includes('pinimg.com'),
    'Pinterest app bundles (pinimg.com) are still caught by the blanket third-party script block');

  // Its peers fail identically: same shape, different domain.
  ['twimg.com', 'fbcdn.net', 'licdn.com', 'redditstatic.com', 'gstatic.com'].forEach((host) => {
    assert(exempt.includes(host), 'first-party app CDN is still blanket-blocked: ' + host);
  });

  // The exemption must stay narrow. Multi-tenant CDNs host arbitrary third parties,
  // so exempting them would hand any attacker a free pass through Smart mode.
  ['cloudfront.net', 'azureedge.net', 'akamaized.net', 'herokuapp.com'].forEach((host) => {
    assert(!exempt.includes(host), 'multi-tenant CDN must not be exempt from Smart mode: ' + host);
  });

  // Exemption is from the heuristic only -- it must never become an allow rule,
  // or ad/tracker/learned/security rules would stop applying to these hosts.
  assert(!state.sessionRules.concat(state.dynamicRules).some((rule) =>
    rule.action && rule.action.type === 'allow'
    && Array.from((rule.condition && rule.condition.requestDomains) || []).includes('pinimg.com')),
  'first-party CDN exemption leaked into an allow rule');
}

void (async () => {
  await testModesAndTrustScope();
  console.log('ok - Smart modes migrate stale rules and trust only the initiating site');
  await testFirstPartyAppCdnsStayLoadable();
  console.log('ok - sites serving their own app code from a separate CDN still load');
  await testRecoveryAndRetryBound();
  console.log('ok - confirmed player recovery excludes one tab and retries one frame once');
  await testSyntheticAndNonPlayerRejection();
  console.log('ok - synthetic, non-player, and same-party failures are rejected');
  await testSecurityAndFingerprintTargetsNeverEscalate();
  console.log('ok - security, grabber, and fingerprint targets never enter stage two');
  await testRejectedReloadRollsBackExclusion();
  console.log('ok - rejected frame reload rolls back the temporary tab exclusion');
  await testTrustedIntentGateAndStaleness();
  console.log('ok - generic recovery requires fresh trusted player intent');
  await testNavigationEpochCancelsInFlightRecovery();
  console.log('ok - navigation epoch cancels an in-flight old-frame recovery');
  await testRestartRehydrationAndCaps();
  console.log('ok - restart lifecycle cleanup and exclusion caps hold');
  await testDeadlockReportGrantsNothingAlone();
  console.log('ok - a deadlock report grants nothing without an observed block');
  await testFirstPartyAppHostsAreExcludedUpFront();
  console.log('ok - first-party app hosts are excluded before any block is needed');
  testRegistrationAndBridgeBounds();
  console.log('ok - observer, isolated bridge, rate, and permission bounds hold');
  console.log('\n12 Smart Script Shield recovery test groups passed.');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

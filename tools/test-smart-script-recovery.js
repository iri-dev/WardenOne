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
      + 'SCRIPT_SHIELD_PLAYER_INFRA_HOSTS};',
    sandbox,
  );
  return { api: sandbox.__api, state };
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
      .filter((host) => !api.SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.includes(host)),
    ['cdn.media.example'],
    'replacement rule did not exempt only the failed request-domain family');
  api.SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.forEach((host) => {
    assert(Array.from(tabRule.condition.excludedRequestDomains || []).includes(host),
      'replacement rule dropped the always-allowed player infrastructure host ' + host);
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
      .filter((host) => !api.SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.includes(host)),
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
      .filter((host) => !api.SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.includes(host)),
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
        .filter((host) => !capped.api.SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.includes(host)).length,
      RECOVERY_MAX_HOSTS_PER_TAB,
      'request-domain family exclusions exceeded the per-tab cap');
  }
}

function testRegistrationAndBridgeBounds() {
  assert(/chrome\.webRequest\?\.onErrorOccurred\?\.addListener\([\s\S]*types:\s*\['script'\]/.test(BACKGROUND),
    'script errors are not observed with a script-only webRequest filter');
  assert(BRIDGE.includes("chrome.runtime.sendMessage({ kind: 'smart-player-context', evidence })"),
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
  assert(BRIDGE.includes("window.addEventListener('popstate'"), 'bridge does not rescan after SPA history navigation');
  assert(BRIDGE.includes("window.addEventListener('hashchange'"), 'bridge does not rescan after hash-route navigation');
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
  assert(BRIDGE.includes("chrome.runtime.sendMessage({ kind: 'smart-player-intent' })"),
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

void (async () => {
  await testModesAndTrustScope();
  console.log('ok - Smart modes migrate stale rules and trust only the initiating site');
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
  testRegistrationAndBridgeBounds();
  console.log('ok - observer, isolated bridge, rate, and permission bounds hold');
  console.log('\n9 Smart Script Shield recovery test groups passed.');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

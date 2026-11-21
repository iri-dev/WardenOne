/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync('background.js', 'utf8');
const start = source.indexOf('const TRACKING_REDIRECT_RULE_BASE ='), end = source.indexOf('// ---- Bare IP program guard', start);
assert(start > 0 && end > start);
function rig() {
  const state = { session: [], dynamic: [], cfg: { enabled: true, unshimLinks: true }, current: '', alarms: [], writes: 0, warnings: [] };
  const change = (name, update) => { state[name] = state[name].filter(rule => !(update.removeRuleIds || []).includes(rule.id)).concat(update.addRules || []); state.writes++; };
  const context = vm.createContext({ URL, Date, Object, Set, Number, JSON, RegExp, console: { warn: (...args) => state.warnings.push(args) },
    WOTrackingRedirects: require('../tracking-redirects.js'), TRACKING_REDIRECT_RULES_BUDGET: 32, TRACKING_REDIRECT_FALLBACK_BUDGET: 64,
    DEFAULT_CONFIG: {}, serializeSubsystem: (_name, task) => task(), registerListener: (_name, register) => register(),
    normalizeAllowlistHost: host => /^(?:localhost|127\.|192\.168\.|10\.)/.test(host) || /\.(?:local|test|invalid)$/.test(host) ? '' : host,
    activeAllowlist: cfg => cfg.allowlist || [], hostMatchesSite: (host, domain) => host === domain || host.endsWith('.' + domain),
    localGet: async () => { if (state.onRead) state.onRead(); return { wardenone_config: state.cfg, unreadable: state.unreadable }; },
    getDynamicRulesInBand: async () => state.dynamic, dnrBandUnchanged: (a, b, exact) => {
      assert.equal(exact, true, 'removing pause exclusions must replace the installed rule');
      return JSON.stringify(a) === JSON.stringify(b);
    },
    writeDynamicRules: async update => { if (state.rejectDynamic) throw Error('native write failed'); change('dynamic', update); },
    writeSessionRules: async update => change('session', update),
    messageSenderIsExtensionOrigin: sender => sender.id === 'fixture' && sender.url.startsWith('chrome-extension://fixture/'),
    messageSenderStillCurrent: async sender => sender.documentId === 'document' && sender.tab.id === 1 && state.current === sender.url,
    chrome: { runtime: { getURL: file => 'chrome-extension://fixture/' + file },
      declarativeNetRequest: { getSessionRules: async () => state.session, isRegexSupported: async () => ({ isSupported: true }) },
      alarms: { create: async (...args) => { if (state.rejectAlarm) throw Error('alarm failed'); state.alarms.push(args); }, onAlarm: { addListener(listener) { state.expire = listener; } } },
      tabs: { onRemoved: { addListener() {} } }, webNavigation: { onCommitted: { addListener() {} } } },
  });
  vm.runInContext(source.slice(start, end) + ';this.api={rules:trackingRedirectRules,resolve:resolveTrackingRedirect,clear:clearTrackingRedirectFallback,apply:applyTrackingRedirectRules};', context);
  function sender(original) {
    const url = 'chrome-extension://fixture/tracking-redirect.html#' + original;
    state.current = url;
    return { id: 'fixture', url, documentId: 'document', frameId: 0, tab: { id: 1 } };
  }
  return { state, context, api: context.api, sender };
}
async function run() {
  const target = 'https://merchant.example.org/item?signature=UNCHANGED%2FVALUE#section';
  const original = 'https://www.awin1.com/cread.php?ued=' + encodeURIComponent(target);
  const r = rig(), rules = r.api.rules(r.state.cfg);
  assert(rules.length >= 18 && rules.length <= 32);
  for (const rule of rules) {
    assert(rule.priority > 1900 && rule.priority < 2000, 'only reviewed paths outrank broad compatibility and stay below threat blocks');
    assert.equal(JSON.stringify(rule.condition.resourceTypes), '["main_frame"]');
    assert.equal(JSON.stringify(rule.condition.requestMethods), '["get"]');
    assert(rule.condition.requestDomains.length);
    assert(rule.action.redirect.regexSubstitution.endsWith('#\\0'));
  }
  assert.equal(r.api.rules({ enabled: false }).length, 0); assert.equal(r.api.rules({ unshimLinks: false }).length, 0);
  for (const [host, path, key] of [['steamcommunity.com', '/linkfilter/', 'url'], ['t.umblr.com', '/redirect', 'z']]) {
    const rule = rules.find(rule => rule.condition.requestDomains.includes(host));
    const pattern = new RegExp(rule.condition.regexFilter, 'i');
    const query = '?' + key + '=' + encodeURIComponent(target);
    assert(pattern.test('https://' + host + ':8443' + path + query));
    assert(!pattern.test('https://unrelated.' + host + path + query));
    assert(!pattern.test('https://' + host + '/unrelated' + path + query));
  }
  const except = r.api.rules({ allowlist: ['publisher.example.org'], siteOverrides: { 'shop.example.org': { unshimLinks: false } } })[0].condition;
  assert(except.excludedInitiatorDomains.includes('publisher.example.org') && except.excludedRequestDomains.includes('shop.example.org'));
  assert.equal((await r.api.resolve(r.sender(original))).url, target);
  assert.equal(r.state.session.length, 0, 'successful skipping needs no network allowance');
  await r.api.apply({ allowlist: ['awin1.com'] });
  assert(r.state.dynamic[0].condition.excludedRequestDomains.includes('awin1.com'));
  await r.api.apply({});
  assert(!r.state.dynamic[0].condition.excludedRequestDomains, 'unpausing restores redirect skipping');
  r.state.rejectDynamic = true;
  assert.equal(await r.api.apply({ unshimLinks: false }), false, 'failed writes remain retryable');
  r.state.rejectDynamic = false;
  assert.equal(await r.api.apply({ unshimLinks: false }), true);
  assert.equal(r.state.dynamic.length, 0);
  r.state.unreadable = true;
  assert.equal((await r.api.resolve(r.sender(original))).ok, false, 'unknown configuration grants no continuation');
  r.state.unreadable = false;
  for (const patch of [{ id: 'foreign' }, { frameId: 1 }, { documentId: 'stale' }, { tab: { id: 2 } },
    { url: 'chrome-extension://fixture/ip-logger-warning.html#' + original }]) {
    assert.equal((await r.api.resolve({ ...r.sender(original), ...patch })).ok, false, JSON.stringify(patch));
  }
  const privateLink = 'https://www.awin1.com/cread.php?ued=' + encodeURIComponent('http://127.0.0.1/admin');
  assert.equal((await r.api.resolve(r.sender(privateLink))).ok, false);
  assert.equal(r.state.session.length, 0, 'unsafe targets never grant fallback permission');
  const signed = original + '&signature=SIGNED';
  assert.equal((await r.api.resolve(r.sender(signed))).url, signed);
  assert.equal(r.state.session.length, 1);
  const allowance = r.state.session[0];
  assert(allowance.priority > rules[0].priority && allowance.priority < 2000);
  assert.equal(JSON.stringify(allowance.condition.tabIds), '[1]');
  assert.equal(JSON.stringify(allowance.condition.resourceTypes), '["main_frame"]');
  assert.equal(JSON.stringify(allowance.condition.requestMethods), '["get"]');
  assert.equal(JSON.stringify(allowance.condition.requestDomains), '["www.awin1.com"]');
  assert(new RegExp(allowance.condition.regexFilter).test(signed));
  assert(!new RegExp(allowance.condition.regexFilter).test(original));
  assert(r.state.alarms[0][1].when <= Date.now() + 30000);
  assert(r.state.alarms[0][0].endsWith(':1'), 'expiry is independent for each tab');
  r.state.expire({ name: r.state.alarms[0][0] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.state.session.length, 0);
  r.state.onRead = () => { r.state.current = 'https://different.example.org'; };
  assert.equal((await r.api.resolve(r.sender(original))).ok, false, 'navigation races revoke a pending reply');
  r.state.onRead = null; r.state.rejectAlarm = true;
  assert.equal((await r.api.resolve(r.sender(signed))).ok, false, 'a failed expiry alarm revokes the allowance');
  assert.equal(r.state.session.length, 0);
  console.log('[ok] tracking redirect authority: native scope/priorities, exact broker document, stale/foreign frames, unsafe targets, isolated fallback and expiry rollback');
}

async function checkLinkReputationResume() {
  const content = fs.readFileSync('src/content.js', 'utf8');
  const start = content.indexOf('const REDIRECT_PARAMS=');
  const end = content.indexOf('!0),\n      WO.monitorLoggerApi)', start);
  assert(start >= 0 && end > start);
  const handler = content.slice(start, end).replace('if(woOn(window,"click",', 'woOn(window,"click",');
  const sourcePage = 'https://publisher.example.net/';
  const target = 'https://destination.example.org/';
  const wrapper = 'https://out.reddit.com/t3_fixture?url=' + encodeURIComponent(target);
  for (const scenario of ['clean', 'hit', 'changed href', 'detached', 'different page', 'changed target', 'no referrer', 'blocked click', 'scripted click']) {
    let listener, synthetic = 0, warning = 0;
    const lookups = [], location = { href: sourcePage, hostname: 'publisher.example.net' };
    const attributes = new Set();
    const link = { href: wrapper, rel: scenario === 'no referrer' ? 'nofollow NoReferrer' : '', isConnected: true,
      getAttribute: name => name === 'href' ? link.href : null, hasAttribute: name => attributes.has(name), click: () => { synthetic++; } };
    vm.runInNewContext(handler + '!0);', {
      Date, setTimeout() {}, WO: { warnRedirectParams: true }, location, window: {}, document: { querySelector: () => null },
      woOn: (_window, _event, onClick) => { listener = onClick; }, u2: url => new URL(url), regDom: host => host,
      log() {}, urlReputationOn: () => true, safeBrowsingCheck: async url => {
        lookups.push(url);
        return { ok: true, hit: scenario === 'hit' };
      }, urlReputationProvider() {}, safeBrowsingThreatText() {}, showSafeBrowsingPanel: () => { warning++; },
    });
    const event = { target: { closest: () => link }, button: 0, isTrusted: scenario !== 'scripted click',
      defaultPrevented: scenario === 'blocked click', preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    listener(event);
    if (scenario === 'changed href') link.href = target;
    if (scenario === 'detached') link.isConnected = false;
    if (scenario === 'different page') location.href = sourcePage + '#new';
    if (scenario === 'changed target') attributes.add('target');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(synthetic, scenario === 'no referrer' ? 1 : 0, scenario);
    assert.equal(warning, scenario === 'hit' ? 1 : 0, scenario);
    assert.equal(location.href, scenario === 'clean' ? wrapper : scenario === 'different page' ? sourcePage + '#new' : sourcePage, scenario);
    assert.deepEqual(lookups, ['blocked click', 'scripted click'].includes(scenario) ? [] : [wrapper, target], scenario);
  }
  console.log('[ok] trusted redirect click resumes the checked address without a synthetic click');
}
run().then(checkLinkReputationResume).catch(error => { console.error(error); process.exitCode = 1; });

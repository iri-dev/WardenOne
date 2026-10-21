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
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules-trackers.json'), 'utf8'));
const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'bridge.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'notification-schema.js'), 'utf8');
const start = source.indexOf('const FRAME_ACTION_NOTICE_TYPES = new Set([');
const end = source.indexOf('async function maybeCloseMismatchedLinkPopup(details) {', start);
assert(start >= 0 && end > start, 'targeted notice implementation is present');
assert(!content.includes('detected_ad_loader_failure'), 'failed ad loaders do not create page-load toasts');
assert(!content.includes('blocked_ad_resource'), 'ad resource history is not an action toast');
assert(!/LOCAL_NOTICE_TYPES = new Set\(\[[^\]]*'blocked_ad_resource'/.test(bridge), 'the bridge rejects passive resource notices');
assert(/relayFrameBlockNotice\(tabId, Number\(sender\.frameId\), normalized\)/.test(source),
  'the worker forwards signed child-frame blocks to the top page');
for (const type of ['blocked_popup', 'blocked_gestureless_nav', 'blocked_meta_refresh', 'blocked_redirect_chain']) {
  assert(bridge.includes("'" + type + "'"), 'the bridge can sign the ' + type + ' top-page notice');
}
assert(/tracker\|ad_resource\|beacon/.test(schema), 'confirmed resource blocks use the routine Activity category');
for (const [id, site] of [[48, 'playmogo.com'], [49, 'pawchive.pw']]) {
  const rule = rules.find((entry) => entry.id === id);
  assert(rule && rule.action.type === 'block' && rule.condition.initiatorDomains.includes(site),
    'the noticed rule is still a block scoped to ' + site);
}

const earlyStart = content.indexOf('let __woToastReady=!1;');
const earlyEnd = content.indexOf('function __woEmit(detail){', earlyStart);
assert(earlyStart >= 0 && earlyEnd > earlyStart, 'early toast queue is present');
let earlyListener;
const early = { woOn: (_target, _type, fn) => { earlyListener = fn; }, document: {},
  __woEventTrusted: (d) => d.trusted === true };
vm.createContext(early);
vm.runInContext(content.slice(earlyStart, earlyEnd), early);
earlyListener({ detail: { src: 'bridge', type: 'blocked_popup', detail: { matched: 'example.org' }, trusted: true } });
earlyListener({ detail: { src: 'bridge', type: 'blocked_popup', detail: {}, trusted: false } });
assert.strictEqual(vm.runInContext('__woToastPending.length', early), 1, 'early trusted bridge notices wait for the toast UI');
vm.runInContext('__woToastReady=!0', early);
earlyListener({ detail: { src: 'bridge', type: 'blocked_popup', detail: {}, trusted: true } });
assert.strictEqual(vm.runInContext('__woToastPending.length', early), 1, 'ready notices are left for the live toast listener');

async function world(debug, matches = [], delayRules = false) {
  const sent = [], history = [], timers = [];
  let releaseRules;
  const pendingRules = new Promise((resolve) => { releaseRules = resolve; });
  let tabUrl = 'https://pawchive.pw/patreon/user/4618037';
  let debugListener, errorListener, errorFilter;
  const sandbox = {
    URL, Date, Number, String, Map, Set,
    setTimeout: (fn) => { timers.push(fn); },
    fetch: () => delayRules ? pendingRules : Promise.resolve({ json: async () => rules }),
    hostMatchesSite: (host, site) => host === site || host.endsWith('.' + site),
    queueHistory: (entry) => history.push(entry),
    readMatchedRuleEvidence: async () => ({ ok: true, matches }),
    chrome: {
      tabs: {
        get: async () => ({ url: tabUrl }),
        sendMessage: (id, message, options) => sent.push({ id, message, options }),
      },
      runtime: { getURL: (name) => name },
      declarativeNetRequest: { onRuleMatchedDebug: { addListener(fn) {
        if (!debug) throw new Error('packaged build');
        debugListener = fn;
      } } },
      webRequest: { onErrorOccurred: { addListener(fn, filter) { errorListener = fn; errorFilter = filter; } } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  vm.runInContext('attachTargetedAdNoticeListeners()', sandbox);
  assert.strictEqual(typeof errorListener, 'function', 'the error listener registers before startup yields');
  if (!delayRules) await vm.runInContext('targetedAdRules()', sandbox);
  return { sent, history, sites: Array.from(vm.runInContext('TARGETED_AD_SITES', sandbox)),
    debug: (info) => debugListener(info), error: (info) => errorListener(info), filter: () => errorFilter,
    loadRules: async () => {
      releaseRules({ json: async () => rules });
      await vm.runInContext('targetedAdRules()', sandbox);
    },
    relay: (tabId, frameId, finding) => sandbox.relayFrameBlockNotice(tabId, frameId, finding),
    setTabUrl: (value) => { tabUrl = value; },
    flush: async () => { while (timers.length) await timers.shift()(); } };
}

(async () => {
  const frame = await world(false);
  /* The synchronous filter must stay narrow and match the packaged rule data. */
  const filter = frame.filter();
  assert(filter && Array.isArray(filter.urls) && !filter.urls.includes('<all_urls>'), 'the listener no longer hears every blocked request in the browser');
  const targeted = rules.filter((rule) => rule.action.type === 'block' && rule.condition.initiatorDomains
    && rule.condition.initiatorDomains.some((site) => frame.sites.includes(site)));
  for (const rule of targeted) for (const domain of rule.condition.requestDomains) {
    assert(filter.urls.includes('*://*.' + domain + '/*'), 'the listener covers ' + domain);
  }
  assert.strictEqual(filter.urls.length, new Set(targeted.flatMap((rule) => rule.condition.requestDomains)).size, 'and nothing else');
  assert.deepStrictEqual(Array.from(filter.types), ['script', 'sub_frame']);
  assert(!/TARGETED_AD_RULE_SITES|\[\[48,|\[49,/.test(source.slice(start, end)), 'no rule number is named in the worker');
  assert(/\nattachTargetedAdNoticeListeners\(\);\n/.test(source), 'startup invokes the registration at top level');
  for (let restart = 0; restart < 2; restart++) {
    const cold = await world(false, [], true);
    cold.error({ tabId: 11, timeStamp: Date.now(), error: 'net::ERR_BLOCKED_BY_CLIENT',
      initiator: 'https://pawchive.pw/post', url: 'https://phonydepth.com/popup.js' });
    await new Promise(setImmediate);
    assert.strictEqual(cold.history.length, 0, 'cold-worker events wait for their rule evidence');
    await cold.loadRules();
    await new Promise(setImmediate);
    await cold.flush();
    assert.strictEqual(cold.history.length, 1, 'the first event survives delayed rule loading after restart ' + restart);
    assert.match(cold.history[0].detail.why, /^The browser blocked/);
  }
  for (const type of ['blocked_popup', 'blocked_gestureless_nav', 'blocked_meta_refresh', 'blocked_redirect_chain']) {
    frame.relay(11, 2, { type, detail: { matched: 'example.org', why: 'A frame action was stopped.' } });
  }
  assert.deepStrictEqual(frame.sent.map((entry) => entry.message.type),
    ['blocked_popup', 'blocked_gestureless_nav', 'blocked_meta_refresh', 'blocked_redirect_chain'],
    'all child-frame popup and redirect blocks reach the top-page bridge');
  assert(frame.sent.every((entry) => entry.options.frameId === 0), 'the child-frame notices target frame zero');
  frame.relay(11, 0, { type: 'blocked_popup', detail: {} });
  frame.relay(11, 2, { type: 'warned_tracker', detail: {} });
  assert.strictEqual(frame.sent.length, 4, 'top-frame and unrelated findings do not add duplicate cards');

  const w = await world(true);
  const pawMatch = { rule: { rulesetId: 'trackers', ruleId: 49 },
    request: { tabId: 11, requestId: 'paw-1', url: 'https://phonydepth.com/popup.js' } };
  w.debug(pawMatch);
  await w.flush();
  assert.strictEqual(w.sent.length, 0, 'a rule match without a blocked request does not claim success');
  w.error({ tabId: 11, requestId: 'paw-1', error: 'net::ERR_BLOCKED_BY_CLIENT',
    url: 'https://phonydepth.com/popup.js', initiator: 'https://pawchive.pw/' });
  await w.flush();
  assert.strictEqual(w.sent.length, 0, 'a confirmed resource block does not show a page-load toast');
  assert.strictEqual(w.history[0].type, 'blocked_ad_resource');
  assert.strictEqual(w.history[0].detail.matched, 'phonydepth.com');
  w.debug({ ...pawMatch, request: { ...pawMatch.request, requestId: 'paw-2' } });
  w.error({ tabId: 11, requestId: 'paw-2', error: 'net::ERR_BLOCKED_BY_CLIENT',
    url: 'https://phonydepth.com/popup.js', initiator: 'https://pawchive.pw/' });
  await w.flush();
  assert.strictEqual(w.history.length, 1, 'repeat resource matches do not flood Activity');
  w.debug({ ...pawMatch, rule: { rulesetId: 'trackers', ruleId: 47 } });
  await w.flush();
  assert.strictEqual(w.history.length, 1, 'an unrelated rule never claims this block');
  w.setTabUrl('https://playmogo.com/d/gk49gvu4can6');
  w.debug({ rule: { rulesetId: 'trackers', ruleId: 48 },
    request: { tabId: 11, requestId: 'play-1', url: 'https://dnhfi5nn2dt67.cloudfront.net/ad.js' } });
  w.error({ tabId: 11, requestId: 'play-1', error: 'net::ERR_BLOCKED_BY_CLIENT',
    url: 'https://dnhfi5nn2dt67.cloudfront.net/ad.js', initiator: 'https://playmogo.com/' });
  await w.flush();
  assert.strictEqual(w.history.length, 2, 'Playmogo gets its own Activity entry');
  assert.strictEqual(w.sent.length, 0, 'neither site shows a passive resource toast');

  const at = Date.now();
  const packaged = await world(false, [{ tabId: 11, timeStamp: at,
    rule: { rulesetId: 'trackers', ruleId: 49 } }]);
  packaged.error({ tabId: 11, timeStamp: at, error: 'net::ERR_BLOCKED_BY_CLIENT',
    initiator: 'https://pawchive.pw/post', url: 'https://phonydepth.com/popup.js' });
  await new Promise(setImmediate);
  await packaged.flush();
  assert.strictEqual(packaged.history.length, 1, 'a packaged build records matched-rule evidence');
  assert.match(packaged.history[0].detail.why, /^WardenOne blocked/);
  assert.strictEqual(packaged.sent.length, 0, 'packaged builds do not show a resource toast');
  const otherBlocker = await world(false);
  otherBlocker.error({ tabId: 11, timeStamp: at, error: 'net::ERR_BLOCKED_BY_CLIENT',
    initiator: 'https://pawchive.pw/post', url: 'https://phonydepth.com/popup.js' });
  await new Promise(setImmediate);
  await otherBlocker.flush();
  assert.strictEqual(otherBlocker.history.length, 1, 'a confirmed browser block on the observed ad host is recorded');
  assert.match(otherBlocker.history[0].detail.why, /^The browser blocked/,
    'a block without WardenOne evidence is not attributed to WardenOne');
  assert.strictEqual(otherBlocker.sent.length, 0, 'another blocker does not cause a WardenOne action toast');
  const unrelated = await world(false);
  unrelated.error({ tabId: 11, timeStamp: at, error: 'net::ERR_BLOCKED_BY_CLIENT',
    initiator: 'https://pawchive.pw/post', url: 'https://example.org/app.js' });
  await new Promise(setImmediate);
  await unrelated.flush();
  assert.strictEqual(unrelated.history.length, 0, 'a browser block outside the observed ad hosts stays quiet');
  console.log('targeted ad activity and action notice tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('background.js', 'utf8');
const shared = fs.readFileSync('site-dashboard-shared.js', 'utf8');
const registry = fs.readFileSync('protection-event-settings.js', 'utf8');
const from = source.indexOf('function badgeActivitySnapshot('), until = source.indexOf('async function siteRecoveryAction(', from);
assert.ok(from >= 0 && until > from);
function report() {
  return { ok: true, web: true, host: 'source.example', since: 1800000000000,
    url: 'https://user:SECRET@source.example/private?token=SECRET',
    network: { available: true, byCategory: { trackers: 7, ads: 5, security: 3 }, sources: [{ name: 'AdShield', count: 5 }] },
    page: { typeCounts: { blocked_popup: 2, detected_beacon: 1 }, events: [{ detail: { token: 'SECRET' } }] },
    recent: { day: { 'net:trackers': 41, 'net:ads': 39, 'net:other': 10, detected_beacon: 1 },
      week: { 'net:trackers': 177, 'net:ads': 265, 'net:other': 37 } } };
}
function build({ staleAt = 0 } = {}) {
  const state = { reads: [], created: [], pushed: [], checks: 0, writes: 0 };
  const tab = { id: 7, url: 'https://source.example/page?token=SECRET' };
  const sender = { id: 'test', url: tab.url, frameId: 0, documentId: 'current-document', tab: { id: 7 } };
  const context = { URL, __privacyEraseInProgress: false, DEFAULT_CONFIG: {},
    messageSenderIsTab: value => value?.id === 'test' && Number.isInteger(value.tab?.id),
    messageSenderStillCurrent: async (value, exact) => { assert.equal(exact, true); return !!value.documentId && ++state.checks !== staleAt; },
    tabsGet: async id => { state.reads.push(id); return tab; },
    buildSiteDashboard: async value => { assert.equal(value.id, 7); return report(); },
    badgeBeaconChoicesForReport: async () => [],
    updateStoredConfig: () => { state.writes++; throw Error('reads must not mutate settings'); },
    chrome: { runtime: { getURL: path => 'chrome-extension://test/' + path, lastError: null },
      tabs: { create: async value => state.created.push(value),
        sendMessage: (id, message, options, callback) => { state.pushed.push({ id, message, options }); callback(); } } } };
  vm.createContext(context);
  vm.runInContext(shared + '\n' + registry + '\n' + source.slice(from, until)
    + '\nthis.api={badgeActivitySnapshot,publishBadgeActivity,badgeRuleAction};', context);
  return { context, state, sender, tab, api: context.api };
}
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('[ok] ' + name); }
(async () => {
  await check('page and network totals use the popup classifier while observations stay out of blocks', () => {
    const t = build(), value = plain(t.api.badgeActivitySnapshot(report()));
    assert.deepEqual(value.current, { total: 17, trackers: 7, ads: 5, other: 5, observed: 1, networkAvailable: true });
    assert.equal(value.since, 1800000000000, 'document timestamps must not be clamped like event counts');
    assert.equal(value.recent, undefined, 'site history stays in the extension Activity page');
    assert.equal(value.sources, undefined);
    assert.equal(value.events.find(entry => entry.type === 'detected_beacon').kind, 'noticed');
    assert.ok(!JSON.stringify(value).includes('SECRET'));
    assert.ok(!JSON.stringify(value).includes('https://'));
  });
  await check('partial native counts remain explicitly unavailable and no history becomes a current-page count', () => {
    const t = build(), input = report(); input.network = { available: false }; input.page.typeCounts = {};
    const value = plain(t.api.badgeActivitySnapshot(input));
    assert.equal(value.current.total, 0); assert.equal(value.current.networkAvailable, false);
    assert.equal(value.recent, undefined);
    assert.equal(t.api.badgeActivitySnapshot({ ok: true, web: false }).ok, false);
  });
  await check('retained beacon details expose only bounded hostnames for the current page', () => {
    const t = build(), input = report();
    input.page.events = [
      { type: 'detected_beacon', detail: { host: 'COLLECTOR.EXAMPLE.NET', url: 'https://SECRET/path', payload: 'SECRET' } },
      { type: 'detected_beacon', detail: { host: 'collector.example.net' } },
      ...['https://secret.example/private?token=SECRET', 'user@private.example', '<img src=x>', 'x'.repeat(64) + '.example']
        .map(host => ({ type: 'detected_beacon', detail: { host } })),
      ...Array.from({ length: 10 }, (_, i) => ({ type: 'detected_beacon', detail: { host: 'host' + i + '.example' } })),
      { type: 'blocked_popup', detail: { host: 'unrelated.example' } },
    ];
    const value = plain(t.api.badgeActivitySnapshot(input));
    assert.deepEqual(value.events.find(entry => entry.type === 'detected_beacon').destinations,
      ['collector.example.net', 'host0.example', 'host1.example', 'host2.example', 'host3.example']);
    assert.equal(value.events.find(entry => entry.type === 'blocked_popup').destinations, undefined);
    assert.ok(!/SECRET|private\.example|<img|unrelated\.example/.test(JSON.stringify(value)));
    assert.equal(value.current.total, 17, 'observation detail cannot add blocks');
  });
  await check('the read command selects only the current browser-owned sender tab', async () => {
    const t = build(); const value = await t.api.badgeRuleAction({ kind: 'badge-activity' }, t.sender);
    assert.equal(value.ok, true); assert.deepEqual(t.state.reads, [7]); assert.equal(t.state.writes, 0);
    for (const field of ['tabId', 'url', 'site', 'type', 'key']) {
      assert.equal((await t.api.badgeRuleAction({ kind: 'badge-activity', [field]: 'attacker' }, t.sender)).ok, false);
    }
  });
  await check('frames, stale documents, missing identities and privacy erasure cannot read activity', async () => {
    for (const override of [{ frameId: 1 }, { documentId: '' }, { id: 'other' }, { url: 'chrome-extension://test/options.html' }]) {
      const t = build(); assert.equal((await t.api.badgeRuleAction({ kind: 'badge-activity' }, { ...t.sender, ...override })).ok, false);
      assert.deepEqual(t.state.reads, []);
    }
    const stale = build({ staleAt: 2 });
    assert.equal((await stale.api.badgeRuleAction({ kind: 'badge-activity' }, stale.sender)).ok, false);
    const erased = build(); erased.context.__privacyEraseInProgress = true;
    assert.equal((await erased.api.badgeRuleAction({ kind: 'badge-activity' }, erased.sender)).ok, false);
    assert.deepEqual(erased.state.reads, []);
  });
  await check('opening Activity uses a fixed extension page and accepts no caller destination', async () => {
    const t = build(); assert.equal((await t.api.badgeRuleAction({ kind: 'badge-open-activity' }, t.sender)).ok, true);
    assert.deepEqual(plain(t.state.created), [{ url: 'chrome-extension://test/history.html', active: true }]);
    assert.equal((await t.api.badgeRuleAction({ kind: 'badge-open-activity', url: 'https://evil.example/' }, t.sender)).ok, false);
    assert.equal(t.state.created.length, 1);
  });
  await check('popup reads publish only a summary to the same tab and top frame', () => {
    const t = build(); t.api.publishBadgeActivity(t.tab, report());
    const value = plain(t.state.pushed[0]);
    assert.equal(value.id, 7); assert.deepEqual(value.options, { frameId: 0 });
    assert.equal(value.message.kind, 'badge-activity-update');
    assert.equal(value.message.snapshot.since, 1800000000000);
    assert.ok(!JSON.stringify(value).includes('SECRET'));
  });
  await check('unknown native categories and malformed event IDs never become UI fields', () => {
    const t = build(), input = report();
    input.recent.day['net:__proto__'] = 99; input.recent.day['net:attacker'] = 99;
    input.page.typeCounts['<img src=x>'] = 1;
    const value = plain(t.api.badgeActivitySnapshot(input));
    assert.ok(!JSON.stringify(value).includes('<img'));
    assert.ok(!JSON.stringify(value).includes('attacker'));
    assert.equal(value.recent, undefined);
  });
  await check('the badge pill uses the canonical total and adds only page actions arriving afterwards', () => {
    const content = fs.readFileSync('src/content.js', 'utf8');
    const from = content.indexOf('const shown=activityTotal==='), until = content.indexOf('const keys=Object.keys(counts)', from);
    assert.ok(from >= 0 && until > from);
    const context = { activityTotal: 17, activityPageBase: 9, total: 9, activityComplete: true,
      bEl: { classList: { toggle() {} } }, counts: {}, nEl: {} };
    const text = () => { vm.runInNewContext('{' + content.slice(from, until) + '}', context); return context.nEl.textContent; };
    assert.equal(text(), '17 blocked'); context.total = 11;
    assert.equal(text(), '19 blocked'); context.activityComplete = false;
    assert.equal(text(), '19+ blocked');
    context.activityTotal = null; context.total = 0; context.counts.detected_beacon = 1;
    assert.equal(text(), '1 beacon'); context.counts.detected_beacon = 2;
    assert.equal(text(), '2 beacons'); context.activityTotal = 0;
    assert.equal(text(), '2 beacons', 'an empty native snapshot cannot hide recorded beacons');
    context.activityPageBase = 0; context.total = 1; assert.equal(text(), '1+ blocked');
  });
  await check('count refreshes preserve the settled fade while new blocks briefly brighten the badge', () => {
    const content = fs.readFileSync('src/content.js', 'utf8'), classes = new Set(), timers = [];
    const from = content.indexOf('settleBadge=()=>{', content.indexOf('/* Decay the transient hot highlight'));
    const until = content.indexOf('const LABELS={', from);
    const classList = { add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value),
      toggle(value, on) { if (on) classes.add(value); else classes.delete(value); } };
    const context = { bEl: { classList }, BADGE_FADE_MS: 1110, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
      activityTotal: 3, activityPageBase: 0, total: 0, activityComplete: true, counts: {}, nEl: {} };
    vm.runInNewContext('var settleBadge,brightenBadge,fadeT;' + content.slice(from, until)
      + ';this.mood={settleBadge,brightenBadge};', context);
    context.mood.brightenBadge(); assert.ok(classes.has('hot') && classes.has('show'));
    timers.at(-1)(); assert.equal(classes.has('hot') || classes.has('show'), false);
    const renderFrom = content.indexOf('const shown=activityTotal==='), renderUntil = content.indexOf('const keys=Object.keys(counts)', renderFrom);
    vm.runInNewContext('{' + content.slice(renderFrom, renderUntil) + '}', context);
    assert.equal(context.nEl.textContent, '3 blocked'); assert.equal(classes.has('hot'), false);
    context.mood.brightenBadge(); timers.at(-1)(); assert.equal(classes.has('show'), false);
    classes.add('damaged'); context.mood.brightenBadge(); timers.at(-1)(); assert.ok(classes.has('show'));
  });
  await check('signed YouTube removals update the live badge using the same bounded ad count as the dashboard', () => {
    const content = fs.readFileSync('src/content.js', 'utf8');
    const from = content.indexOf('const NO_BADGE_TYPES='), until = content.indexOf('\n            }\n            WO.__damaged', from);
    assert.ok(from >= 0 && until > from);
    let findingListener;
    const context = { document: {}, WO: {}, badgePanel: null, renderBadge() {}, pulseBadge() {}, brightenBadge() {},
      __woEventTrusted: value => value.authenticated === true,
      woOn(target, type, listener) { assert.equal(type, 'wo-event'); findingListener = listener; } };
    vm.runInNewContext('let total=0;const counts={};' + content.slice(from, until) + ';this.read=()=>({total,counts});', context);
    const emit = (count, authenticated = true) => findingListener({ detail: { type: 'youtube_ads_removed', detail: { count }, authenticated } });
    emit(2, false); assert.equal(context.read().total, 0);
    emit(2); assert.equal(context.read().total, 2); assert.equal(context.read().counts.youtube_ads_removed, 2);
    emit(100); assert.equal(context.read().total, 22);
  });
  await check('authenticated beacons immediately render, pulse and brighten without adding a false block', () => {
    const content = fs.readFileSync('src/content.js', 'utf8');
    const from = content.indexOf('const NO_BADGE_TYPES='), until = content.indexOf('\n            }\n            WO.__damaged', from);
    let listener; const calls = [];
    const context = { document: {}, WO: {}, badgePanel: null,
      renderBadge: () => calls.push('render'), pulseBadge: () => calls.push('pulse'), brightenBadge: () => calls.push('brighten'),
      __woEventTrusted: value => value.authenticated === true, woOn(_target, _type, callback) { listener = callback; } };
    vm.runInNewContext('let total=0;const counts={};' + content.slice(from, until) + ';this.read=()=>({total,counts});', context);
    listener({ detail: { type: 'detected_beacon', authenticated: false } }); assert.deepEqual(calls, []);
    listener({ detail: { type: 'detected_beacon', authenticated: true } });
    assert.deepEqual(calls, ['render', 'pulse', 'brighten']); assert.equal(context.read().total, 0); assert.equal(context.read().counts.detected_beacon, 1);
    listener({ detail: { type: 'blocked_popup', authenticated: true } });
    assert.equal(context.read().total, 1); assert.deepEqual(calls.slice(-3), ['render', 'pulse', 'brighten']);
  });
  await check('the MAIN badge caches authenticated appearance before runtime startup without consuming count updates', () => {
    const content = fs.readFileSync('src/content.js', 'utf8');
    const from = content.indexOf('let __woBadgeThemeDark='), until = content.indexOf('let __woToastReady=', from);
    assert.ok(from >= 0 && until > from && until < content.indexOf('const __woStartRuntime='));
    let listener, changed = 0, verified = 0;
    const context = { document: {}, changed() { changed++; },
      woOn(target, type, callback) { assert.equal(type, 'wo-badge-activity'); listener = callback; },
      __woEventTrusted(value) { verified++; return value.authenticated === true; } };
    vm.runInNewContext(content.slice(from, until) + ';this.readTheme=()=>__woBadgeThemeDark;__woBadgeThemeChanged=changed;', context);
    const send = (overrides = {}) => listener({ detail: { type: 'badge_theme', src: 'bridge', detail: { dark: true }, authenticated: true, ...overrides } });
    send({ type: 'badge_activity' }); assert.equal(verified, 0);
    send({ src: 'engine' }); send({ detail: { dark: 'dark' } }); send({ authenticated: false });
    assert.equal(context.readTheme(), false); assert.equal(changed, 0);
    send(); assert.equal(context.readTheme(), true); assert.equal(changed, 1);
    send({ detail: { dark: false } }); assert.equal(context.readTheme(), false);
  });
  console.log(passed + ' badge activity checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

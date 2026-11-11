/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Automatic tracker learning: cross-site ID cookies seen by the browser, in the jar or in a
   Set-Cookie that cookie blocking strips; durable resource blocking; every decision reversible. */
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const WOLearner = require('../tracker-learner-utils.js');
const { create } = require('./lib/tracker-learner-harness.js');

const NOW = Date.UTC(2026, 9, 26);
const DAY = 86400000;
const id = (overrides = {}) => ({ name: 'IDE', value: 'AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4', domain: '.tracker.example', sameSite: 'no_restriction',
  secure: true, session: false, expirationDate: (NOW + 400 * DAY) / 1000, ...overrides });
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

function cookiePredicate() {
  assert(WOLearner.identifyingCookie(id(), NOW), 'a long-lived cross-site random ID');
  assert(WOLearner.identifyingCookie(id({ name: 'uuid2', value: '8746381230984561234' }), NOW), 'a long numeric ID');
  for (const [label, cookie] of [
    ['first-party or Lax', id({ sameSite: 'lax' })], ['no SameSite attribute', id({ sameSite: 'unspecified' })],
    ['session cookie', id({ session: true, expirationDate: undefined })], ['a week-long cookie', id({ expirationDate: (NOW + 7 * DAY) / 1000 })],
    ['partitioned', id({ partitionKey: { topLevelSite: 'https://site.example' } })],
    ['load balancer', id({ name: 'AWSALBCORS' })], ['bot check', id({ name: '__cf_bm' })], ['consent record', id({ name: 'euconsent-v2' })],
    ['flag', id({ value: 'true' })], ['short', id({ value: 'abc123' })], ['timestamp', id({ value: '1730300000000' })],
    ['low variety', id({ value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaab' })], ['not an object', null],
  ]) assert(!WOLearner.identifyingCookie(cookie, NOW), label);
  assert(WOLearner.signals.includes('tracking-cookie') && !Object.hasOwn(WOLearner.pageSignals, 'tracking-cookie'),
    'cookie evidence has no page entry point');
  assert.equal(WOLearner.pageEvidence({ signal: 'tracking-cookie', domain: 'tracker.example' }), null);
}


async function followAcross(rig, host = 'px.tracker.example', sites = ['one.example', 'two.example', 'three.example']) {
  await rig.cookieRequest(sites[0], host);
  await rig.cookieRequest(sites[1], host);
  rig.browserRestart(); rig.api.forgetCookieVerdicts();
  await rig.cookieRequest(sites[2], host);
}
function rig(auto = true, extra = {}) {
  const r = create();
  r.state.local.wardenone_config = { enabled: true, trackerLearner: true, trackerLearnerAuto: auto, ...extra };
  r.state.cookies['tracker.example'] = [id()];
  return r;
}
const blockRule = r => r.state.rules.find(rule => rule.action.type === 'block' && rule.condition.requestDomains.includes('tracker.example'));
const decision = (extra = {}) => ({ state: 'learned', automatic: 'block', fullBlock: true, approvedAt: NOW, learnedAt: NOW,
  firstSeen: NOW, lastSeen: NOW, hits: 3, sites: 3, sessions: 2, ...extra });

async function promotion() {
  const background = fs.readFileSync('background.js', 'utf8');
  const defaults = vm.runInNewContext(background.slice(background.indexOf('const DEFAULT_CONFIG = {'),
    background.indexOf('\n};', background.indexOf('const DEFAULT_CONFIG = {')) + 3) + '\nDEFAULT_CONFIG');
  for (const stored of [undefined, {}, { trackerLearnerAuto: false }]) {
    const fresh = rig();
    fresh.context.DEFAULT_CONFIG = defaults;
    fresh.state.local.wardenone_config = stored;
    await followAcross(fresh);
    assert.equal(fresh.api.learner().domains['tracker.example']?.state, stored?.trackerLearnerAuto === false ? undefined : 'learned',
      'fresh and missing settings learn automatically; an explicit Review choice stays in review');
  }
  const r = rig();
  await followAcross(r);
  const entry = r.api.learner().domains['tracker.example'];
  assert.equal(entry.state, 'learned');
  assert.equal(entry.automatic, 'block');
  assert(entry.fullBlock && entry.approvedAt > 0 && entry.evidence['tracking-cookie'] === 3 && entry.evidence.network === 3);
  const rule = blockRule(r);
  same(rule.condition.requestDomains, ['tracker.example']);
  assert.equal(rule.condition.domainType, 'thirdParty');
  same(rule.condition.excludedResourceTypes, ['main_frame'], 'all embedded resource types are blocked, direct visits stay available');
  assert.equal(rule.condition.resourceTypes, undefined);
  assert.equal(rule.priority, 1800);
  assert(!r.state.rules.some(rule => rule.action.type === 'modifyHeaders'));
  assert(r.state.history.some(h => h.type === 'auto_blocked_tracker_domain' && /stay blocked until you unblock/.test(h.detail.why) && !h.url));
  assert(!JSON.stringify(r.state.local).includes('one.example') && !JSON.stringify(r.state.local).includes(id().value));
  same(r.api.proposals().map(p => [p.domain, p.automatic]), [['tracker.example', 'block']]);
  assert.equal((await r.api.status('https://three.example/')).items[0].automatic, 'block');

  const off = rig(false);
  await followAcross(off);
  assert.equal(off.api.learner().domains['tracker.example'], undefined);
  const page = rig();
  for (let session = 0; session < 2; session++) {
    for (const site of ['one.example', 'two.example', 'three.example']) await page.api.note('https://' + site + '/', { domain: 'tracker.example', signal: 'tracking-path' });
    page.browserRestart();
  }
  assert.equal(page.api.learner().domains['tracker.example'].state, 'proposed', 'page evidence alone never creates a rule');
  assert.equal(page.state.rules.length, 0);
  const benign = rig();
  benign.state.cookies['tracker.example'] = [id({ name: 'AWSALBCORS' }), id({ sameSite: 'lax' })];
  await followAcross(benign);
  assert.equal(benign.api.learner().domains['tracker.example'], undefined);
  const sameSite = rig();
  for (const site of ['one.example', 'two.example']) await sameSite.cookieRequest(site, 'px.tracker.example', { initiator: 'https://www.tracker.example' });
  assert.equal(sameSite.api.learner().domains['tracker.example'], undefined);
  for (const host of ['accounts.google.com', 'video.googlevideo.com', 'cdn.ttvnw.net']) {
    const safe = rig();
    const site = safe.context.registrableDomain(host);
    safe.state.cookies[site] = [id({ domain: '.' + site })];
    await followAcross(safe, host);
    assert.equal(safe.api.learner().domains[site], undefined, 'protected service: ' + host);
  }
  const allowed = rig();
  allowed.state.local.wardenone_tracker_learner = { version: 5, salt: '0'.repeat(32), domains: {}, siteControls: { 'one.example': { allow: { 'tracker.example': NOW }, block: {} } } };
  await allowed.api.load();
  await followAcross(allowed);
  assert.notEqual(allowed.api.learner().domains['tracker.example']?.automatic, 'block');
  for (const failure of ['rejectNative', 'rejectStorage']) {
    const failing = rig();
    await failing.cookieRequest('one.example', 'px.tracker.example');
    await failing.cookieRequest('two.example', 'px.tracker.example');
    failing.browserRestart(); failing.api.forgetCookieVerdicts();
    failing.state[failure] = true;
    await failing.cookieRequest('three.example', 'px.tracker.example');
    assert.notEqual(failing.api.learner().domains['tracker.example'].state, 'learned', failure);
    assert(!failing.state.history.some(h => h.type === 'auto_blocked_tracker_domain'));
  }
}

async function persistenceAndUnblock() {
  const r = rig();
  await followAcross(r);
  r.state.local.wardenone_config.trackerLearnerAuto = false;
  await r.api.rules();
  assert(blockRule(r), 'review mode stops new decisions and keeps existing blocks');
  r.state.local.wardenone_config.trackerLearner = false;
  await r.api.rules();
  assert.equal(r.state.rules.length, 0, 'the learner master switch pauses blocks and exceptions');
  r.state.local.wardenone_config.trackerLearner = true;
  await r.api.rules();
  assert(blockRule(r));
  r.state.now += 366 * DAY;
  await r.api.save(true);
  assert.equal(r.api.learner().domains['tracker.example'].state, 'learned', 'a year without sightings never expires a block');
  r.browserRestart(); await r.api.load(); await r.api.rules();
  assert(blockRule(r), 'browser restart restores the durable rule');
  const originalLearned = r.api.learner().domains['tracker.example'].learnedAt;
  assert.equal((await r.api.decide('tracker.example', 'unblock')).state, 'unblocked');
  assert.equal(blockRule(r), undefined);
  const allow = r.state.rules.find(rule => rule.action.type === 'allow');
  assert(allow && allow.priority === 1900 && allow.priority < 2000, 'tracker unblock stays below security enforcement');
  same(allow.condition.excludedResourceTypes, ['main_frame']);
  r.state.local.wardenone_config.trackerLearnerAuto = true;
  r.api.forgetCookieVerdicts();
  await followAcross(r, 'px.tracker.example', ['four.example', 'five.example', 'six.example']);
  assert.equal(r.api.learner().domains['tracker.example'].state, 'unblocked');
  r.state.now += 366 * DAY;
  await r.api.save(true);
  r.browserRestart(); await r.api.load(); await r.api.rules();
  assert.equal(r.api.learner().domains['tracker.example'].state, 'unblocked', 'unblock choices also survive a year and a restart');
  assert.equal((await r.api.decide('tracker.example', 'block')).state, 'learned');
  assert(blockRule(r));
  assert.equal(r.api.learner().domains['tracker.example'].learnedAt, originalLearned, 'reblocking retains the original learning date');
  await r.api.setMode('https://one.example/', 'tracker.example', 'allow');
  const siteAllow = r.state.rules.find(rule => rule.priority === 2600);
  same(siteAllow.condition.excludedResourceTypes, ['main_frame'], 'Allow here also covers scripts and frames');
  const masterOff = rig(true, { enabled: false });
  await followAcross(masterOff);
  assert.equal(masterOff.state.rules.length, 0);
  const many = rig();
  many.state.cookies['second.example'] = [id({ domain: '.second.example' })];
  await followAcross(many);
  many.api.forgetCookieVerdicts();
  await followAcross(many, 'px.second.example', ['four.example', 'five.example', 'six.example']);
  same(blockRule(many).condition.requestDomains, ['second.example', 'tracker.example']);
  const before = many.state.ruleWrites;
  same(await many.api.decideAll('undo').then(x => [x.ok, x.decided, x.state]), [true, 2, 'unblocked']);
  assert.equal(many.state.ruleWrites, before + 1);
  assert.equal(blockRule(many), undefined);
  assert.equal((await many.api.decideAll('block')).decided, 0);
  const rejected = rig(); await followAcross(rejected);
  rejected.state.rejectNative = true;
  assert.equal((await rejected.api.decide('tracker.example', 'unblock')).ok, false);
  assert.equal(rejected.api.learner().domains['tracker.example'].state, 'learned');
  const paused = rig(true, { allowlist: ['paused.example'], siteOverrides: { 'except.example': { trackerLearner: false } } });
  await followAcross(paused);
  same(blockRule(paused).condition.excludedInitiatorDomains, ['except.example', 'paused.example']);
}

async function historyAndCapacity() {
  const r = rig();
  r.state.local.wardenone_tracker_learner = { version: 5, salt: '0'.repeat(32), siteControls: {}, domains:
    Object.fromEntries(Array.from({ length: 105 }, (_, i) => ['auto' + String(i).padStart(3, '0') + '.example', decision()])) };
  await r.api.load(); await r.api.rules();
  assert.equal(r.state.rules.length, 2, '105 domains fit in two native rules');
  await r.api.decide('auto000.example', 'unblock');
  const first = await r.api.history({ page: 0, pageSize: 25 });
  const second = await r.api.history({ page: 1, pageSize: 25 });
  same([first.total, first.items.length, first.counts.blocked, first.counts.unblocked], [105, 25, 104, 1]);
  assert(!first.items.some(item => second.items.some(other => item.domain === other.domain)));
  same((await r.api.history({ query: 'auto000', filter: 'unblocked' })).items.map(item => [item.domain, item.state]), [['auto000.example', 'unblocked']]);
  assert.equal((await r.api.history({ query: 'not-present' })).items.length, 0);
  assert.equal((await r.api.history({ page: 100000 })).page, 4);
  for (const invalid of [null, [], { page: -1 }, { page: 1.2 }, { pageSize: 10000 }, { filter: 'anything' }, { query: 5 }, { query: 'a'.repeat(201) }]) {
    assert.equal((await r.api.history(invalid)).ok, false, JSON.stringify(invalid));
  }
  const full = rig();
  full.state.local.wardenone_tracker_learner = { version: 5, salt: '0'.repeat(32), siteControls: {}, domains:
    Object.fromEntries(Array.from({ length: 10000 }, (_, i) => ['auto' + i + '.example', decision({ approvedAt: NOW - DAY })])) };
  await full.api.load();
  await followAcross(full);
  assert.equal(full.api.learner().domains['tracker.example'].state, 'proposed');
  assert.equal((await full.api.history()).capacityReached, true);
  assert.equal((await full.api.decide('tracker.example', 'block')).ok, false);
  await full.api.save(true);
  assert.equal(Object.values(full.api.learner().domains).filter(entry => entry.state === 'learned').length, 10000, 'capacity never evicts a saved block');
  assert.equal(full.state.rules.length, 100, 'ten thousand blocks fit the existing rule band');
}

async function dailyCapAndMigration() {
  const r = rig();
  r.state.local.wardenone_tracker_learner = { version: 5, salt: '0'.repeat(32), siteControls: {}, domains:
    Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['auto' + i + '.example', decision()])) };
  await r.api.load(); await followAcross(r);
  assert.equal(r.api.learner().domains['tracker.example'].state, 'proposed');
  r.state.now += DAY; r.browserRestart(); r.api.forgetCookieVerdicts();
  await r.cookieRequest('seven.example', 'px.tracker.example');
  assert.equal(r.api.learner().domains['tracker.example'].automatic, 'block');
  const migrated = rig();
  migrated.state.local.wardenone_tracker_learner = { version: 4, salt: '0'.repeat(32), siteControls: {}, domains: {
    'tracker.example': { ...decision({ automatic: 'cookies' }), evidence: { network: 3, 'tracking-cookie': 3 } },
    'manual.example': decision({ automatic: undefined, fullBlock: undefined }),
    'legacy.example': { state: 'learned', hits: 4 },
  } };
  await migrated.api.load(); await migrated.api.rules();
  assert.equal(migrated.api.learner().domains['tracker.example'].state, 'proposed', 'old cookie rules do not silently become full blocks');
  assert.equal(migrated.api.learner().domains['manual.example'].state, 'learned');
  assert.equal(migrated.api.learner().domains['legacy.example'].state, 'proposed');
  await migrated.cookieRequest('new-site.example', 'px.tracker.example');
  assert.notEqual(migrated.api.learner().domains['tracker.example'].automatic, 'block', 'legacy counters cannot stand in for verified site evidence');
  await migrated.cookieRequest('four.example', 'px.tracker.example');
  await migrated.cookieRequest('five.example', 'px.tracker.example');
  assert.equal(migrated.api.learner().domains['tracker.example'].automatic, 'block', 'three freshly verified sites can promote the migrated candidate');
  const cleared = rig(); await followAcross(cleared);
  await cleared.api.clear(); cleared.browserRestart(); await cleared.api.load(); await cleared.api.rules();
  assert(blockRule(cleared), 'clearing observations preserves decisions');
  assert.equal(Object.keys(cleared.api.learner().domains['tracker.example'].evidence).length, 0);
}

/* Block third-party cookies strips a tracker's Set-Cookie before the jar stores it, so in the
   championship run the learner saw no evidence at all and learned nothing. The response header is
   the evidence now, judged by the same rule as a jar cookie. */
const ID_HEADER = 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure; Path=/; Max-Age=31536000';
function setCookieHeaders() {
  const judge = header => WOLearner.identifyingCookie(WOLearner.setCookieShape(header, NOW), NOW);
  assert(judge(ID_HEADER), 'a year-long cross-site random ID');
  assert(judge('uid=8746381230984561234abcDEF; Expires=' + new Date(NOW + 400 * DAY).toUTCString() + '; secure; samesite=none'), 'Expires and lower-case attributes');
  for (const [label, header] of [
    ['no Secure (the browser refuses it)', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Max-Age=31536000'],
    ['no SameSite', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; Secure; Max-Age=31536000'],
    ['Lax', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=Lax; Secure; Max-Age=31536000'],
    ['partitioned', ID_HEADER + '; Partitioned'],
    ['session cookie', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure'],
    ['ten minutes', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure; Max-Age=600'],
    ['Max-Age wins over Expires', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure; Max-Age=600; Expires=' + new Date(NOW + 400 * DAY).toUTCString()],
    ['deletion', 'tid=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure; Max-Age=0'],
    ['consent record', 'euconsent-v2=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure; Max-Age=31536000'],
    ['low-entropy value', 'lang=en-GB; SameSite=None; Secure; Max-Age=31536000'],
    ['no name', '=AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4; SameSite=None; Secure; Max-Age=31536000'], ['empty', ''],
  ]) assert(!judge(header), label);
}
async function strippedCookieLearning() {
  /* The jar stays empty throughout, exactly as with the cookie protection on. */
  const r = rig(); r.state.cookies = {};
  await r.setCookieResponse('one.example', 'px.tracker.example', ID_HEADER);
  await r.setCookieResponse('one.example', 'px.tracker.example', ID_HEADER, { type: 'script' });
  assert.equal(r.api.learner().domains['tracker.example'].evidence['tracking-cookie'], 1, 'one count per page');
  await r.setCookieResponse('two.example', 'px.tracker.example', ID_HEADER);
  assert.equal(r.api.learner().domains['tracker.example'].state, 'candidate', 'two sites are not enough');
  await r.setCookieResponse('three.example', 'px.tracker.example', ID_HEADER);
  const entry = r.api.learner().domains['tracker.example'];
  assert.equal(entry.state, 'learned', 'learned from response headers alone');
  assert(entry.evidence['tracking-cookie'] === 3 && entry.evidence.network === 3 && /tracking-cookie/.test(entry.reason));
  assert.equal(entry.sessions, 1, 'trusted observations can learn in one browser session');
  assert(blockRule(r), 'and the learned block is enforced');
  assert(!JSON.stringify(r.state.local).includes('AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4'), 'the cookie value is never stored');

  const off = rig(false); off.state.cookies = {};
  await followHeaders(off);
  assert.equal(off.api.learner().domains['tracker.example'], undefined, 'review mode does not learn from headers');
  const weak = rig(); weak.state.cookies = {};
  await followHeaders(weak, 'lang=en; SameSite=None; Secure; Max-Age=31536000');
  assert.equal(weak.api.learner().domains['tracker.example'], undefined, 'a non-identifying cookie is not evidence');
  const own = rig(); own.state.cookies = {};
  for (const site of ['www.tracker.example', 'shop.tracker.example']) await own.setCookieResponse(site, 'px.tracker.example', ID_HEADER);
  assert.equal(own.api.learner().domains['tracker.example'], undefined, 'a first-party cookie is not evidence');
  const none = rig(); none.state.cookies = {};
  await none.api.setCookie({ tabId: 1, frameId: 0, documentId: 'doc-x', initiator: 'https://one.example', url: 'https://px.tracker.example/p', type: 'image' });
  assert.equal(none.api.learner().domains['tracker.example'], undefined, 'a response without headers is not evidence');

  const listen = rig();
  listen.api.observe(true);
  const header = listen.state.listeners.onHeadersReceived;
  assert(header && header.fn === listen.api.listeners.header, 'automatic mode reads response headers');
  same(header.spec, ['responseHeaders', 'extraHeaders'], 'extraHeaders, without which Set-Cookie is hidden');
  assert(header.filter.urls.includes('https://*/*') && header.filter.types.includes('image') && !header.filter.types.includes('main_frame'));
  assert.equal(listen.state.listeners.onBeforeRequest.fn, listen.api.listeners.jar, 'the jar observer is kept');
  listen.api.observe(false);
  assert(!listen.state.listeners.onHeadersReceived && !listen.state.listeners.onBeforeRequest, 'both observers follow the switch off');
}
async function followHeaders(r, header = ID_HEADER) {
  await r.setCookieResponse('one.example', 'px.tracker.example', header);
  await r.setCookieResponse('two.example', 'px.tracker.example', header);
  r.browserRestart(); r.api.forgetCookieVerdicts();
  await r.setCookieResponse('three.example', 'px.tracker.example', header);
}

function wiring() {
  const background = fs.readFileSync('background.js', 'utf8');
  assert(/\n  trackerLearnerAuto: true,\n/.test(background));
  assert(/trackerLearnerAuto: 'trackerLearner',/.test(background));
  const popup = fs.readFileSync('popup.js', 'utf8'), html = fs.readFileSync('popup.html', 'utf8');
  assert(/<select[^>]*data-key="trackerLearnerAuto"[^>]*data-config-bool/.test(html));
  assert(!/<input[^>]*data-key="trackerLearnerAuto"/.test(html));
  assert(html.includes('Automatic tracker protection') && html.includes('tracker-history-open'));
  assert(popup.includes("pageSize: 5"), 'popup stays compact');
  assert(/auto_blocked_tracker_domain: 'Tracker blocked automatically'/.test(fs.readFileSync('history.js', 'utf8')));
  const start = popup.indexOf('function trackerModeLabel('), end = popup.indexOf('\nfunction renderTrackerLearner', start);
  for (const [config, expected] of [
    [{ enabled: true, trackerLearner: true, trackerLearnerAuto: true }, 'Blocked automatically'],
    [{ enabled: true, trackerLearner: true, trackerLearnerAuto: false }, 'Blocked automatically'],
    [{ enabled: true, trackerLearner: false, trackerLearnerAuto: true }, 'Block paused'],
    [{ enabled: false, trackerLearner: true, trackerLearnerAuto: true }, 'Block paused'],
  ]) {
    const label = vm.runInNewContext(popup.slice(start, end) + '\ntrackerModeLabel', { config });
    assert.equal(label({ state: 'learned', automatic: 'block' }), expected);
    assert.equal(label({ state: 'unblocked' }), 'Unblocked by you');
    assert.equal(label({ state: 'proposed' }), 'Suggestion to review');
  }
}
(async () => {
  cookiePredicate();
  setCookieHeaders();
  await promotion();
  await strippedCookieLearning();
  await persistenceAndUnblock();
  await historyAndCapacity();
  await dailyCapAndMigration();
  wiring();
  console.log('[ok] automatic tracker protection: browser evidence, durable blocks, durable unblock choices, paginated history, migration, capacity and rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });

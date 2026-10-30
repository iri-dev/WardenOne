/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Opt-in automatic tracker learning: browser-held cross-site cookies, durable resource blocking,
   and every automatic decision reversible. */
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
  assert.equal(migrated.api.learner().domains['tracker.example'].automatic, 'block', 'fresh browser evidence can promote the migrated candidate');
  const cleared = rig(); await followAcross(cleared);
  await cleared.api.clear(); cleared.browserRestart(); await cleared.api.load(); await cleared.api.rules();
  assert(blockRule(cleared), 'clearing observations preserves decisions');
  assert.equal(Object.keys(cleared.api.learner().domains['tracker.example'].evidence).length, 0);
}

function wiring() {
  const background = fs.readFileSync('background.js', 'utf8');
  assert(/\n  trackerLearnerAuto: false,\n/.test(background));
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
  await promotion();
  await persistenceAndUnblock();
  await historyAndCapacity();
  await dailyCapAndMigration();
  wiring();
  console.log('[ok] automatic tracker protection: browser evidence, durable blocks, durable unblock choices, paginated history, migration, capacity and rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });

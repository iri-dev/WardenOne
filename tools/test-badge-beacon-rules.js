/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('background.js', 'utf8');
const shared = fs.readFileSync('site-dashboard-shared.js', 'utf8');
const policy = require('./lib/network-policy.js');
const plain = value => JSON.parse(JSON.stringify(value));
const firewallStart = source.indexOf('const FIREWALL_RULE_BASE =');
const firewallEnd = source.indexOf('async function applyFirewallRules()', firewallStart);
const matrixStart = source.indexOf('function firewallMatrixWith(');
const matrixEnd = source.indexOf('// Session allowances expire', matrixStart);
const start = source.indexOf('function badgeBeaconHost('), end = source.indexOf('function publishBadgeActivity(', start);
assert(start >= 0 && end > start);

function world(options = {}) {
  const state = { matrix: plain(options.matrix || {}), cfg: { enabled: true, ...(options.cfg || {}) }, native: [],
    writes: [], saves: [], tabs: [], checks: 0, reports: [] };
  let queue = Promise.resolve();
  const report = { ok: true, web: true, host: 'github.com', since: 1800000000000,
    page: { typeCounts: { detected_beacon: 2 }, events: (options.observed || ['collector.github.com', 'stats.doubleclick.net'])
      .map(host => ({ type: 'detected_beacon', detail: { host } })) }, network: { available: true } };
  const ctx = { URL, console, __privacyEraseInProgress: false, DEFAULT_CONFIG: { enabled: true },
    FIREWALL_RULES_BUDGET: Number(source.match(/const FIREWALL_RULES_BUDGET = (\d+)/)[1]),
    FIREWALL_SESSION_RULES_BUDGET: Number(source.match(/const FIREWALL_SESSION_RULES_BUDGET = (\d+)/)[1]),
    messageSenderIsTab: sender => sender?.id === 'test' && Number.isInteger(sender.tab?.id),
    messageSenderStillCurrent: async () => ++state.checks !== options.staleAt,
    tabsGet: async id => ({ id, url: 'https://github.com/iri-dev' }), buildSiteDashboard: async (_tab, withNetwork) => {
      state.reports.push(withNetwork); assert.equal(withNetwork, false, 'beacon decisions must not wait for native activity counts'); return report;
    },
    activeAllowlist: cfg => cfg.allowlist || [], hostMatchesSite: (host, pattern) => host === pattern || host.endsWith('.' + pattern),
    isProtectedTrackerDomain: host => host === 'accounts.google.com', isMediaCompatDomain: host => host === 'youtube.com',
    WO_TRACKER_NETWORK_DATA: { trackerHosts: ['doubleclick.net'] },
    masterSwitchOn: async () => !options.masterDrops && state.cfg.enabled !== false,
    localGet: async () => options.unreadable ? { unreadable: true } : { wardenone_firewall: plain(state.matrix), wardenone_config: plain(state.cfg) },
    localSet: async value => {
      if (options.failSave) throw Error('write refused');
      state.matrix = plain(value.wardenone_firewall); state.saves.push(plain(state.matrix));
    },
    storeTransaction: (_key, task) => { const work = queue.then(task); queue = work.catch(() => {}); return work; },
    firewallSessionRules: async () => options.sessionRules || [],
    getDynamicRulesInBand: async () => plain(state.native), dnrBandUnchanged: (before, after) => JSON.stringify(before) === JSON.stringify(after),
    writeDynamicRules: async change => {
      if (options.failNative) throw Error('native refused');
      policy.validate(change, 'dynamic'); state.writes.push(plain(change)); state.native = plain(change.addRules);
    },
    chrome: { runtime: { getURL: path => 'chrome-extension://test/' + path }, declarativeNetRequest: { updateDynamicRules() {} },
      tabs: { create: async value => state.tabs.push(plain(value)) } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('domain-utils.js', 'utf8') + '\n' + fs.readFileSync('psl-private.js', 'utf8')
    + '\n' + require('./lib/resource-types.js').prelude(source) + '\n' + shared + '\n'
    + source.slice(firewallStart, firewallEnd) + '\n' + source.slice(matrixStart, matrixEnd) + '\n'
    + source.slice(start, end) + '\nthis.api={badgeBeaconAction,badgeBeaconChoicesForReport,firewallCompile};', ctx);
  const sender = { id: 'test', frameId: 0, documentId: 'current', url: 'https://github.com/iri-dev', tab: { id: 7 } };
  return { state, ctx, report, sender, set: (destination, blocked, override = {}) => ctx.api.badgeBeaconAction(
    { kind: 'badge-beacon-set', destination, blocked }, { ...sender, ...override }) };
}

(async () => {
  let count = 0;
  async function check(name, run) { await run(); count++; console.log('[ok] ' + name); }
  await check('a saved beacon block stops only ping requests to that destination from that site', async () => {
    const w = world({ matrix: { 'other.example': { 'cdn.example': { script: 'block' } } } });
    const result = await w.set('stats.doubleclick.net', true);
    assert.equal(result.ok, true); assert.equal(result.blocked, true);
    assert.equal(w.state.matrix['github.com']['stats.doubleclick.net'].beacon, 'block');
    const rule = w.state.native.find(row => row.condition.requestDomains.includes('stats.doubleclick.net'));
    assert.deepEqual(rule.condition, { initiatorDomains: ['github.com'], requestDomains: ['stats.doubleclick.net'], resourceTypes: ['ping'] });
    assert.equal(rule.action.type, 'block'); assert.equal(w.state.matrix['other.example']['cdn.example'].script, 'block');
    assert.deepEqual(w.state.reports, [false]);
    assert.ok(!rule.condition.resourceTypes.includes('xmlhttprequest') && !rule.condition.resourceTypes.includes('main_frame'));
  });
  await check('saved decisions survive a fresh worker and unblock stays reversible without an allow rule', async () => {
    const w = world(); await w.set('collector.github.com', true);
    const fresh = world({ matrix: w.state.matrix, observed: [] });
    assert.equal((await fresh.ctx.api.badgeBeaconChoicesForReport(fresh.report))[0].blocked, true);
    assert.equal((await fresh.set('collector.github.com', false)).ok, true);
    assert.equal(fresh.state.matrix['github.com']['collector.github.com'].beacon, 'noop');
    assert.equal(fresh.state.native.length, 0);
    assert.equal((await fresh.ctx.api.badgeBeaconChoicesForReport(fresh.report))[0].blocked, false);
    assert.equal((await fresh.set('collector.github.com', true)).ok, true);
    assert.ok(fresh.state.native.every(rule => rule.action.type !== 'allow'));
  });
  await check('a www beacon decision never expands to the apex or its other subdomains', async () => {
    const w = world({ observed: ['www.telemetry.example.net'] });
    assert.equal((await w.set('www.telemetry.example.net', true)).ok, true);
    assert.deepEqual(w.state.native[0].condition.requestDomains, ['www.telemetry.example.net']);
    assert.equal(w.state.matrix['github.com']['www.telemetry.example.net'].beacon, 'block');
  });
  await check('recommendations use site ownership and known tracker data, not just the existence of a beacon', async () => {
    const w = world({ observed: ['collector.github.com', 'stats.doubleclick.net', 'unknown.example', 'accounts.google.com', 'youtube.com'] });
    const choices = plain(await w.ctx.api.badgeBeaconChoicesForReport(w.report));
    for (const [host, expected] of [['collector.github.com', 'keep'], ['stats.doubleclick.net', 'block'], ['unknown.example', 'unknown'],
      ['accounts.google.com', 'keep'], ['youtube.com', 'keep']]) assert.equal(choices.find(row => row.host === host).recommendation, expected, host);
  });
  await check('saved beacon reads return current-site choices without history or native activity reads', async () => {
    const w = world({ matrix: { 'github.com': { 'saved.example': { beacon: 'block' } }, 'other.example': { 'private.example': { beacon: 'block' } } } });
    const result = await w.ctx.api.badgeBeaconAction({ kind: 'badge-beacon-state', destinations: ['COLLECTOR.GITHUB.COM'] }, w.sender);
    assert.equal(result.ok, true); assert.deepEqual(w.state.reports, []); assert.deepEqual(w.state.writes, []); assert.deepEqual(w.state.saves, []);
    assert.deepEqual(plain(result.beacons).map(row => row.host), ['saved.example', 'collector.github.com']);
    assert.equal(result.beacons[0].blocked, true); assert.equal(result.beacons[1].recommendation, 'keep');
  });
  await check('fast beacon reads reject foreign authority, malformed hosts and stale pages', async () => {
    for (const message of [ { kind: 'badge-beacon-state' }, { kind: 'badge-beacon-state', destinations: 'collector.github.com' },
      { kind: 'badge-beacon-state', destinations: ['https://collector.github.com/path'] },
      { kind: 'badge-beacon-state', destinations: Array(6).fill('collector.github.com') },
      { kind: 'badge-beacon-state', destinations: [], site: 'other.example' } ]) {
      const w = world(); assert.equal((await w.ctx.api.badgeBeaconAction(message, w.sender)).ok, false);
    }
    for (const override of [{ id: 'foreign' }, { frameId: 1 }, { tab: { id: 7, incognito: true } }]) {
      const w = world(); assert.equal((await w.ctx.api.badgeBeaconAction({ kind: 'badge-beacon-state', destinations: [] }, { ...w.sender, ...override })).ok, false);
    }
    for (const staleAt of [1, 2]) {
      const w = world({ staleAt }); assert.equal((await w.ctx.api.badgeBeaconAction({ kind: 'badge-beacon-state', destinations: [] }, w.sender)).ok, false);
    }
  });
  await check('unobserved hosts, URL payloads and extra authority fields cannot create a block', async () => {
    const w = world();
    for (const host of ['other.example', 'https://collector.github.com/path', 'user@collector.github.com', '<img src=x>', '__proto__', 'x'.repeat(64) + '.com'])
      assert.equal((await w.set(host, true)).ok, false);
    for (const extra of [{ site: 'other.example' }, { key: 'enabled' }, { tabId: 99 }, { url: 'https://evil.example' }])
      assert.equal((await w.ctx.api.badgeBeaconAction({ kind: 'badge-beacon-set', destination: 'collector.github.com', blocked: true, ...extra }, w.sender)).ok, false);
    assert.equal(w.state.saves.length, 0); assert.equal(w.state.writes.length, 0);
  });
  await check('foreign, framed, private and stale documents cannot save beacon rules', async () => {
    for (const override of [{ id: 'foreign' }, { frameId: 1 }, { tab: { id: 7, incognito: true } }, { url: 'https://user:secret@github.com/' }]) {
      const w = world(); assert.equal((await w.set('collector.github.com', true, override)).ok, false); assert.equal(w.state.saves.length, 0);
    }
    for (const staleAt of [1, 2, 3]) {
      const w = world({ staleAt }); assert.equal((await w.set('collector.github.com', true)).ok, false); assert.equal(w.state.saves.length, 0);
    }
    const erased = world(); erased.ctx.__privacyEraseInProgress = true;
    assert.equal((await erased.set('collector.github.com', true)).ok, false);
  });
  await check('native failure and unreadable state never claim a saved block; failed storage restores prior native rules', async () => {
    for (const options of [{ failNative: true }, { unreadable: true }, { failSave: true }, { masterDrops: true }]) {
      const w = world(options); assert.equal((await w.set('collector.github.com', true)).ok, false); assert.equal(w.state.saves.length, 0);
      if (options.failSave) assert.equal(w.state.native.length, 0);
    }
    const corrupt = world(); corrupt.ctx.localGet = async () => ({ wardenone_firewall: null });
    assert.equal((await corrupt.set('collector.github.com', true)).ok, false); assert.equal(corrupt.state.saves.length, 0);
  });
  await check('a full firewall refuses a new beacon decision without displacing existing rules', async () => {
    const w = world();
    w.state.matrix['github.com'] = Object.fromEntries(Array.from({ length: 250 }, (_, i) => ['host' + i + '.example', { beacon: 'noop' }]));
    assert.equal((await w.set('collector.github.com', true)).ok, false);
    assert.equal(w.state.writes.length, 0); assert.equal(w.state.saves.length, 0);
    assert.equal(Object.keys(w.state.matrix['github.com']).length, 250);
  });
  await check('master-off, site allowlisting and temporary ping allowances cannot produce false block success', async () => {
    for (const options of [{ cfg: { enabled: false } }, { cfg: { allowlist: ['github.com'] } },
      { sessionRules: [{ condition: { initiatorDomains: ['github.com'], requestDomains: ['collector.github.com'], resourceTypes: ['ping'] } }] }]) {
      const w = world(options); assert.equal((await w.set('collector.github.com', true)).ok, false); assert.equal(w.state.saves.length, 0);
    }
  });
  await check('concurrent badge changes preserve the other saved choices', async () => {
    const w = world(); await Promise.all(['collector.github.com', 'stats.doubleclick.net'].map(host => w.set(host, true)));
    assert.equal(Object.keys(w.state.matrix['github.com']).length, 2);
  });
  await check('saved-block management opens a fixed extension route for the current sending site', async () => {
    const w = world(); assert.equal((await w.ctx.api.badgeBeaconAction({ kind: 'badge-beacon-settings' }, w.sender)).ok, true);
    assert.deepEqual(w.state.tabs, [{ url: 'chrome-extension://test/firewall.html?tab=7&site=github.com', active: true }]);
    assert.equal((await w.ctx.api.badgeBeaconAction({ kind: 'badge-beacon-settings', site: 'other.example' }, w.sender)).ok, false);
  });
  console.log(count + ' saved beacon rule checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

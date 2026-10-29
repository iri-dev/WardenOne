/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm'), path = require('path');
const { webcrypto } = require('crypto');
const WOIdentifiers = require('../identifier-detector.js');
const root = path.resolve(__dirname, '..');
const domain = vm.createContext({ URL });
for (const file of ['domain-utils.js', 'psl-private.js', 'cname-utils.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), domain);
const siteIdentity = vm.runInContext('host => WOCname.normalizeHost(host) ? siteIdentity(host) : ""', domain);
const value = 'z7A4nP9rT2mX8qL5vB1kD6sH3wF0cY9u';
const request = 'https://metrics.collector.test/collect?unfamiliar=' + value;
const sites = ['https://first.example/', 'https://second.example/', 'https://third.example/'];
function rig(crypto = webcrypto) {
  let time = 2000000000000;
  return { engine: WOIdentifiers.create({ siteIdentity, crypto, now: () => time }), tick: ms => { time += ms; },
    observe(topUrl, url = request, extra = {}) { return this.engine.observe({ url, topUrl, method: 'GET', type: 'image', ...extra }); } };
}
async function qualify(r, urls = sites) {
  let finding;
  for (const site of urls) {
    assert.equal(await r.observe(site), null);
    r.tick(1000); finding = await r.observe(site);
  }
  return finding;
}
async function detector() {
  const r = rig(), finding = await qualify(r);
  assert.equal(finding?.confidence, 'suspected-identifier');
  assert.equal(finding.enforcement, 'detection-only');
  assert.equal(finding.contexts, 3);
  assert(!JSON.stringify(finding).includes(value));
  assert(!sites.some(s => JSON.stringify(finding).includes(new URL(s).hostname)));
  assert.equal(await r.observe(sites[2]), null, 'a sketch reports once');
  const once = rig();
  for (const site of sites) assert.equal(await once.observe(site), null, 'one observation per site is insufficient');
  const same = rig();
  for (let i = 0; i < 20; i++) { same.tick(1000); assert.equal(await same.observe('https://sub' + i + '.first.example/'), null); }
  assert.equal(same.engine.stats().entries, 1, 'subdomains of one site cannot inflate context count');
  assert(await qualify(rig(), ['https://one.github.io/', 'https://two.github.io/', 'https://three.github.io/']), 'PSL tenants are independent');
  const renamed = rig();
  for (let i = 0; i < 3; i++) {
    const url = request.replace('unfamiliar=', 'field' + i + '=');
    assert.equal(await renamed.observe(sites[i], url), null); renamed.tick(1000);
    const found = await renamed.observe(sites[i], url); assert.equal(!!found, i === 2);
  }
  const expire = rig();
  for (const site of sites.slice(0, 2)) { await expire.observe(site); expire.tick(1000); await expire.observe(site); }
  expire.tick(WOIdentifiers.LIMITS.ttlMs); assert.equal(expire.engine.stats().entries, 0);
  assert.equal(await expire.observe(sites[2]), null, 'expired evidence never qualifies');
  expire.engine.clear(); assert.equal(expire.engine.stats().entries, 0);
  const backwards = rig(); await backwards.observe(sites[0]); backwards.tick(-1); assert.equal(backwards.engine.stats().entries, 0);
  for (const bad of ['a'.repeat(32), '12345678901234567890123456789012', 'deadbeef', 'welcome-to-the-document', value + '.jwt.payload']) assert(!WOIdentifiers.highEntropy(bad));
  for (const input of ['https://collector.test/a?unfamiliar=' + value,
    'https://collector.test/a?unfamiliar=' + value + '&field=' + value]) assert(WOIdentifiers.requestValues(input));
  const urls = [
    ...['token', 'client_id', 'clientId', 'appId', 'csrf', 'session', 'state', 'signature', 'X-Amz-Credential', 'redirect_uri', 'applicationId', 'orderId', 'document', 'email', 'nonce'].map(k => request + '&' + k + '=safe'),
    ...['login', 'oauth/callback', '%256cogin', 'checkout', 'download', 'api/collect', 'assets', 'file.pdf', 'graphql', 'password/reset'].map(p => request.replace('/collect?', '/' + p + '?')),
    request.replace('https:', 'http:'), request.replace('metrics.', 'user:pass@metrics.'), request + '#fragment',
    request + '&Unfamiliar=' + value, request + '&nested=https%3A%2F%2Fexample.org', request + '&x=%25FF',
    request.replace(value, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'),
    request + '&' + Array.from({ length: 21 }, (_, i) => 'p' + i + '=1').join('&'), 'https://collector.test/' + 'x'.repeat(8193),
    request.replace('unfamiliar', 'utm_source'), request.replace('unfamiliar', 'fbclid'),
  ];
  for (const url of urls) assert.equal(WOIdentifiers.requestValues(url), null, url.slice(0, 110));
  const excluded = rig();
  for (const [top, url, extra] of [
    [sites[0], request, { method: 'POST' }], [sites[0], request, { type: 'main_frame' }],
    ['https://metrics.collector.test/', request, {}], ['https://first.example/login', request, {}],
    [sites[0], 'https://127.0.0.1/collect?unfamiliar=' + value, {}],
  ]) assert.equal(await excluded.observe(top, url, extra), null);
  assert.equal(excluded.engine.stats().entries, 0);
  const cap = rig();
  for (let i = 0; i < 400; i++) { cap.tick(1000); await cap.observe(sites[0], request + i); }
  assert.equal(cap.engine.stats().entries, WOIdentifiers.LIMITS.entries);
  let release;
  const held = rig({ getRandomValues: a => webcrypto.getRandomValues(a), subtle: {
    importKey: (...a) => new Promise(resolve => { release = () => resolve(webcrypto.subtle.importKey(...a)); }),
    sign: (...a) => webcrypto.subtle.sign(...a),
  } });
  const work = Array.from({ length: 20 }, () => held.observe(sites[0]));
  assert.equal(held.engine.stats().pending, WOIdentifiers.LIMITS.pending);
  held.engine.clear(); release(); await Promise.all(work);
  assert.equal(held.engine.stats().entries, 0, 'in-flight cryptography cannot restore cleared evidence');
  const fail = rig({ getRandomValues() { throw Error('RNG unavailable'); } });
  assert.equal(await fail.observe(sites[0]), null);
  const rate = rig(); for (let i = 0; i < 130; i++) await rate.observe(sites[0], request + i);
  assert.equal(rate.engine.stats().entries, WOIdentifiers.LIMITS.requestsPerMinute);
}
function observerRig(config = {}, privateContext = false) {
  let serial = 0;
  const state = { config, frames: {}, history: [], pending: [], time: 2000000000000, listeners: new Set() };
  const context = vm.createContext({ WOIdentifiers, URL, TextEncoder, Uint8Array, crypto: webcrypto, INCOGNITO_CONTEXT: privateContext,
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true }, __privacyEraseInProgress: false,
    localGet: async () => ({ wardenone_config: state.config }),
    trackerRequestTopFrame: async d => {
      if (state.frameBarrier) await state.frameBarrier;
      const f = state.frames[d.tabId];
      return f && f.documentId === d.documentId && d.initiator === new URL(f.url).origin && d.frameId === 0
        ? { ...f, tabId: d.tabId } : null;
    },
    isProtectedTrackerDomain: host => host.endsWith('stripe.com'), isMediaCompatDomain: host => host.endsWith('youtube.com'),
    activeAllowlist: cfg => cfg.allowlist || [], hostMatchesAllowlist: (h, list) => list.some(d => h === d || h.endsWith('.' + d)),
    hostMatchesSite: (h, d) => h === d || h.endsWith('.' + d), queueHistory: e => state.history.push(e),
    chrome: { storage: { onChanged: { addListener: f => state.change = f } },
      webNavigation: { getFrame: async d => state.frames[d.tabId] }, webRequest: { onBeforeRequest: {
        addListener: f => state.listeners.add(f), removeListener: f => state.listeners.delete(f), hasListener: f => state.listeners.has(f),
      } } },
  });
  for (const file of ['domain-utils.js', 'psl-private.js', 'cname-utils.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  // The real helper and wiring share the same adjustable clock in this trust-boundary fixture.
  context.WOIdentifiers = { ...WOIdentifiers, create: options => WOIdentifiers.create({ ...options, now: () => state.time }) };
  vm.runInContext(fs.readFileSync(path.join(root, 'background-identifiers.js'), 'utf8') + '\nthis.observer=WOIdentifierObserver;', context);
  return { state, context, async send(site, extra = {}) {
    const tabId = 1, documentId = 'doc-' + site;
    state.frames[tabId] = { url: site, documentId, documentLifecycle: 'active' };
    const details = { tabId, frameId: 0, documentId, initiator: new URL(site).origin, requestId: String(++serial), url: request, method: 'GET', type: 'image', ...extra };
    for (const listener of state.listeners) listener(details);
    await new Promise(resolve => setTimeout(resolve, 20)); state.time += 1000;
  } };
}
async function observer() {
  const enabled = observerRig(); for (const site of sites) { await enabled.send(site); await enabled.send(site); }
  assert.equal(enabled.state.history.length, 1);
  const event = JSON.parse(JSON.stringify(enabled.state.history[0]));
  assert.equal(event.type, 'warned_tracking_identifier'); assert(!event.url);
  assert(!JSON.stringify(event).includes(value)); assert.equal(event.detail.enforcement, 'detection-only');
  for (const config of [{ enabled: false }, { trackerLearner: false }, { historyMode: 'off' }, { allowlist: ['collector.test'] },
    { allowlist: ['second.example'] }, { siteOverrides: { 'first.example': { trackerLearner: false } } }]) {
    const r = observerRig(config); for (const site of sites) { await r.send(site); await r.send(site); } assert.equal(r.state.history.length, 0);
  }
  for (const extra of [{ documentId: 'old' }, { initiator: 'https://forged.example' }, { method: 'POST' }, { frameId: 3 },
    { url: request.replace('metrics.collector.test', 'stripe.com') }, { requestId: 'duplicate' }]) {
    const r = observerRig(); for (const site of sites) { await r.send(site, extra); await r.send(site, extra); } assert.equal(r.state.history.length, 0);
  }
  const privateRig = observerRig({}, true); for (const site of sites) { await privateRig.send(site); await privateRig.send(site); } assert.equal(privateRig.state.history.length, 0);
  const reset = observerRig(); for (const site of sites.slice(0, 2)) { await reset.send(site); await reset.send(site); }
  reset.state.change({ wardenone_config: {} }, 'local'); await reset.send(sites[2]); await reset.send(sites[2]); assert.equal(reset.state.history.length, 0);
  reset.context.observer.reconcile(false); assert.equal(reset.state.listeners.size, 0);
  const pending = observerRig(); let resumeFrame;
  pending.state.frameBarrier = new Promise(resolve => { resumeFrame = resolve; });
  const old = pending.send(sites[0]);
  await new Promise(resolve => setTimeout(resolve, 0));
  pending.context.observer.clear(); resumeFrame(); await old;
  pending.state.frameBarrier = null;
  await pending.send(sites[0]);
  for (const site of sites.slice(1)) { await pending.send(site); await pending.send(site); }
  assert.equal(pending.state.history.length, 0, 'an old browser-frame lookup cannot seed evidence after clear');
  const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  for (const name of ['clearProtectionHistory', 'clearTrackerLearnerObservations', 'eraseWardenOneSite', 'eraseWardenOneData']) {
    const start = bg.indexOf('async function ' + name + '('), end = bg.indexOf('\nasync function ', start + 1);
    assert(bg.slice(start, end < 0 ? undefined : end).includes('WOIdentifierObserver.clear()'), name + ' revokes ephemeral evidence');
  }
}
async function main() { await detector(); await observer(); console.log('[ok] bounded HMAC identifier reuse, sensitive-flow exclusions, expiration, verified-context policy and erase boundaries'); }
main().catch(error => { console.error(error); process.exitCode = 1; });

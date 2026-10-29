/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('crypto');
const source = fs.readFileSync('background.js', 'utf8');
const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const HANDLE = 'a'.repeat(32);
const URL_A = 'https://shared.example.com/tenant-a?token=secret-value';
function region(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function world(store = {}) {
  let now = 1700000000000;
  const activeTabs = new Map();
  const calls = [], updates = [], history = [];
  const session = {
    async get(key) { return structuredClone({ [key]: store[key] }); },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(key) { delete store[key]; },
  };
  const box = {
    URL, TextEncoder, Uint8Array, crypto: webcrypto, console,
    Date: class extends Date { static now() { return now; } },
    chrome: { storage: { session }, runtime: { id: ORIGIN.split('/')[2], getURL: p => ORIGIN + p,
      getContexts: async () => [...activeTabs].map(([tabId, tab]) => ({ ...tab, tabId, frameId: 0,
        documentUrl: tab.url, contextType: 'TAB' })) },
      webNavigation: { getFrame: async ({ tabId }) => ({ documentId: activeTabs.get(tabId)?.documentId }) } },
    INCOGNITO_CONTEXT: false,
    isLocalOrPrivateHost: host => host === '127.0.0.1' || host === 'localhost' || host.endsWith('.local'),
    isLocalTrustHost: () => false,
    trustHostFromUrl: raw => new URL(raw).hostname,
    queueHistory: entry => history.push(entry),
    urlReputationConfig: async () => ({ enabled: true }),
    locallyBlockedReputationHost: async () => '',
    urlReputationLookupUrl: async url => { calls.push(url); return { ok: true, hit: true, threats: ['MALWARE'] }; },
    tabsGet: async id => ({ id, ...activeTabs.get(id) }), tabsUpdate: async (...args) => updates.push(args),
    bumpBadge() {}, safeBrowsingThreatLabel: () => 'malware',
    safeBrowsingBlockPageUrl: async () => ORIGIN + 'safe-browsing-block.html?w=' + HANDLE,
  };
  vm.createContext(box);
  vm.runInContext([
    region('function normalizeSafeBrowsingUrl(url)', '\n// PRIV-03'),
    region('const WARNING_RECORD_PREFIX = ', '\nfunction warningRecordHandle'),
    'const safeBrowsingNavigationChecks = new Set();',
    region('const SAFE_BROWSING_BYPASS_KEY = ', '\nasync function checkVirusTotalUrl'),
    region('async function messageSenderStillCurrent(', '\nfunction messageCleanHost('),
    'globalThis.api = { addSafeBrowsingBypass, consumeSafeBrowsingBypass, clearSafeBrowsingBypass, handleSafeBrowsingNavigation, key: SAFE_BROWSING_BYPASS_KEY };',
  ].join('\n'), box);
  const sender = (tabId = 7, handle = HANDLE) => ({
    id: box.chrome.runtime.id, frameId: 0, documentId: 'document-a', tab: { id: tabId }, url: ORIGIN + 'safe-browsing-block.html?w=' + handle,
  });
  const seed = (tabId = 7, url = URL_A, handle = HANDLE, fields = {}) => {
    activeTabs.set(tabId, { url: ORIGIN + 'safe-browsing-block.html?w=' + handle, documentId: 'document-a', incognito: false });
    store['wardenone_warning:' + handle] = { kind: 'safe-browsing', context: 'page', tabId, url, at: now, ...fields };
    return sender(tabId, handle);
  };
  const navigate = (tabId = 7, url = URL_A, frameId = 0) => {
    if (frameId === 0) activeTabs.set(tabId, { url, documentId: 'document-a', incognito: false });
    return box.api.handleSafeBrowsingNavigation({ tabId, url, frameId });
  };
  return { ...box.api, store, session, seed, sender, navigate, calls, updates, history, advance(ms) { now += ms; },
    active(url, document = 'document-a', privateTab = false) { activeTabs.set(7, { url, documentId: document, incognito: privateTab }); } };
}
async function grant(w, tabId = 7, url = URL_A, handle = HANDLE) {
  assert.equal((await w.addSafeBrowsingBypass(handle, w.seed(tabId, url, handle))).ok, true);
}
async function run() {
  for (const [url, document, privateTab] of [['https://elsewhere.example/', 'document-a', false],
    [ORIGIN + 'safe-browsing-block.html?w=' + HANDLE, 'document-b', false],
    [ORIGIN + 'safe-browsing-block.html?w=' + HANDLE, 'document-a', true]]) {
    const w = world(), sender = w.seed();
    w.active(url, document, privateTab);
    assert.equal((await w.addSafeBrowsingBypass(HANDLE, sender)).ok, false, 'a stale or cross-context warning cannot issue a grant');
    assert(!w.store[w.key]);
  }
  {
    const w = world(); await grant(w);
    assert(!w.store['wardenone_warning:' + HANDLE]);
    assert(!JSON.stringify(w.store).includes('secret-value'), 'grant stores a digest, not the address');
    assert(!JSON.stringify(w.history).includes('secret-value'));
    assert.equal(w.history[0].detail.uses, 1);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A + '#section'), true);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), false);
    assert(!w.store[w.key]);
  }
  for (const url of [
    'https://shared.example.com/tenant-b?token=secret-value',
    URL_A + '-changed', URL_A.replace('https:', 'http:'),
    URL_A.replace('.com/', '.com:8443/'), URL_A.replace('shared.', 'other.'), 'about:blank',
  ]) {
    const w = world(); await grant(w);
    assert.equal(await w.consumeSafeBrowsingBypass(7, url), false, url);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), false, 'another navigation cancels the grant');
  }
  {
    const w = world(); await grant(w);
    assert.equal(await w.consumeSafeBrowsingBypass(8, URL_A), false);
    await w.navigate(7, URL_A, 2);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), true, 'another tab or subframe cannot consume it');
  }
  for (const elapsed of [59999, 60000, 60001]) {
    const w = world(); await grant(w); w.advance(elapsed);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), elapsed < 60000, 'expiry at ' + elapsed);
  }
  {
    const w = world(); await grant(w);
    const outcomes = await Promise.all([w.consumeSafeBrowsingBypass(7, URL_A), w.consumeSafeBrowsingBypass(7, URL_A)]);
    assert.equal(outcomes.filter(Boolean).length, 1, 'concurrent navigation checks cannot reuse a grant');
    const sender = w.seed();
    const replays = await Promise.all([w.addSafeBrowsingBypass(HANDLE, sender), w.addSafeBrowsingBypass(HANDLE, sender)]);
    assert.equal(replays.filter(r => r.ok).length, 1, 'the warning record can only grant once');
  }
  {
    const w = world();
    await Promise.all([grant(w), grant(w, 8, URL_A, 'b'.repeat(32))]);
    await w.clearSafeBrowsingBypass(7);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), false);
    assert.equal(await w.consumeSafeBrowsingBypass(8, URL_A), true, 'concurrent grants retain separate tabs');
  }
  {
    const w = world(); await grant(w);
    const restarted = world(w.store);
    assert.equal(await restarted.consumeSafeBrowsingBypass(7, URL_A), true, 'worker restart preserves unused grant');
    assert.equal(await world(w.store).consumeSafeBrowsingBypass(7, URL_A), false, 'restart cannot restore consumed grant');
    const legacy = world({ __wardenone_sb_bypass: { 'shared.example.com': Date.now() + 1800000 } });
    assert.equal(await legacy.consumeSafeBrowsingBypass(7, URL_A), false, 'legacy host grants have no authority');
  }
  const forged = [
    s => ({ ...s, id: 'other-extension' }), s => ({ ...s, frameId: 1 }),
    s => ({ ...s, url: 'https://evil.example/' }), s => ({ ...s, url: ORIGIN + 'popup.html' }),
    s => ({ ...s, url: s.url + '&other=1' }), s => ({ ...s, tab: { id: 8 } }),
    s => ({ ...s, tab: undefined }), s => ({ ...s, frameId: undefined }),
    s => ({ ...s, documentId: undefined }), s => ({ ...s, documentId: 'replaced-document' }),
  ];
  for (const change of forged) {
    const w = world();
    assert.equal((await w.addSafeBrowsingBypass(HANDLE, change(w.seed()))).ok, false);
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), false);
  }
  for (const fields of [
    { kind: 'redirect' }, { context: 'download' }, { tabId: '7' }, { at: 1 },
    { at: 1700000000001 }, { at: '1700000000000' }, { url: 'file:///secret' }, { url: 'http://127.0.0.1/' },
  ]) {
    const w = world();
    assert.equal((await w.addSafeBrowsingBypass(HANDLE, w.seed(7, URL_A, HANDLE, fields))).ok, false, JSON.stringify(fields));
  }
  {
    const w = world();
    assert.equal((await w.addSafeBrowsingBypass(HANDLE, w.sender())).ok, false);
    assert.equal((await w.addSafeBrowsingBypass('../key', w.seed())).ok, false);
    const sender = w.seed();
    w.session.set = async () => { throw Error('storage unavailable'); };
    assert.equal((await w.addSafeBrowsingBypass(HANDLE, sender)).ok, false);
    assert(!w.store['wardenone_warning:' + HANDLE], 'failed persistence does not leave a replayable warning');
  }
  {
    const w = world(); await grant(w);
    w.session.remove = async () => { throw Error('storage unavailable'); };
    assert.equal(await w.consumeSafeBrowsingBypass(7, URL_A), false, 'failed consumption cannot authorize navigation');
  }
  {
    const w = world(); await grant(w);
    await w.navigate(); assert.equal(w.calls.length, 0); assert.equal(w.updates.length, 0);
    await w.navigate(); await w.navigate();
    assert.equal(w.calls.length, 2); assert.equal(w.updates.length, 2, 'even immediate repeated visits are blocked');
    await grant(w);
    await w.navigate();
    await w.navigate(7, 'https://shared.example.com/tenant-b');
    assert.equal(w.calls.at(-1), 'https://shared.example.com/tenant-b', 'redirect destination is checked');
    assert.equal(w.updates.length, 3);
  }
  assert(source.includes('respond(addSafeBrowsingBypass(msg.handle, sender), sendResponse)'));
  assert(source.includes('void clearSafeBrowsingBypass(tabId)'));
  assert(source.includes("if ((details.transitionQualifiers || []).includes('server_redirect')) handleSafeBrowsingNavigation(details)"));
  assert.match(fs.readFileSync('safe-browsing-block.html', 'utf8'), /exact address once, in this tab/);
  console.log('[ok] reputation grants: exact URL, one use, original tab, expiry, replay/race/storage failures, worker restart and navigation checks');
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { loadDownloadGuard } = require('./test-download-guard.js');

function page() {
  const events = new Map();
  const offers = [];
  let query;
  const box = {
    Date, URL, WeakSet, decodeURIComponent,
    window: {}, location: new URL('https://shop.example/download/game'),
    bridgeConfigReady: true, bridgeConfig: { enabled: true },
    bridgeHostAllowedByUser: () => false,
    bridgeOwnHost: () => 'shop.example', bridgeTopHost: () => 'shop.example',
    bridgeSiteOverridesFor: (cfg, host) => cfg.siteOverrides && cfg.siteOverrides[host] || {},
    getComputedStyle: control => ({ display: control.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    WO_MODAL: { panel: () => '', button: () => '' },
    document: {
      querySelector: () => ({ textContent: box.heading || 'Download' }),
      createElement: tag => ({ tag, children: [], setAttribute() {}, append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); }, click() { box.allowedHref = this.href; }, remove() {} }),
      body: { appendChild() {} },
    },
    chrome: { runtime: { id: 'wardenone' } },
    woOn: (target, type, fn) => {
      if (target === box.window) events.set(type, fn);
      else target[type] = fn;
    },
    woOnMessage: fn => { query = fn; },
    woOwnedOverlay: () => {
      const root = { appendChild: child => offers.push(child) };
      return { root: () => root, mount() {}, dialog() {}, destroy() {} };
    },
  };
  vm.createContext(box);
  const source = fs.readFileSync('bridge.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('  /* Download intent stays'), source.indexOf('  const FRAME_CONFIG_FIELDS')), box);
  const control = (label, href, extra = {}) => Object.assign({
    innerText: label, href, isConnected: true, hidden: false,
    closest() { return this; }, getBoundingClientRect: () => ({ width: 100, height: 40 }),
    getAttribute(name) { return name === 'download' ? this.claimed || '' : ''; },
    hasAttribute(name) { return name === 'download' && this.claimed !== undefined; },
  }, extra);
  const click = (element, trusted = true, type = 'click') => {
    const event = { target: element, composedPath: () => [element], isTrusted: trusted, type,
      preventDefault() { this.stopped = true; }, stopImmediatePropagation() {} };
    events.get(type)(event);
    return event;
  };
  const snapshot = (sender = { id: 'wardenone' }) => {
    let response;
    query({ kind: 'download-intent-query', filename: 'setup.exe' }, sender, value => { response = value; });
    return response;
  };
  return { box, offers, control, click, snapshot, events };
}

async function run() {
  for (const [label, href, trusted, extra, blocked] of [
    ['Download', 'https://cdn.example/setup.exe', true, {}, false],
    ['Windows', 'https://cdn.example/setup.exe', true, {}, false],
    ['Export report', 'https://shop.example/report.csv', true, {}, false],
    ['Play video', 'https://cdn.example/setup.exe?token=1', true, {}, true],
    ['Play video', 'https://cdn.example/setup.exe', true, { claimed: 'setup.exe' }, true],
    ['Download', 'https://cdn.example/setup.exe', false, {}, true],
    ['', 'https://cdn.example/file.pdf', false, { claimed: 'file.pdf', hidden: true }, true],
    ['Read more', 'https://shop.example/article', true, {}, false],
    ['Download', 'https://cdn.example/setup.exe', true, { hidden: true }, true],
  ]) {
    const p = page();
    assert.equal(!!p.click(p.control(label, href, extra), trusted).stopped, blocked, label + ' ' + href);
  }
  {
    const p = page();
    p.box.heading = 'GTA VI Grand Theft Auto 6';
    assert(p.click(p.control('Download for Windows', 'https://cdn.example/avast_secure_browser_setup.exe')).stopped);
    const offer = p.offers[0];
    assert(offer.children[1].textContent.includes('does not match'));
    const allow = offer.children[2];
    allow.click({ isTrusted: false }); assert.equal(p.box.allowedHref, undefined);
    allow.click({ isTrusted: true }); assert.equal(p.box.allowedHref, 'https://cdn.example/avast_secure_browser_setup.exe');
    assert.equal(p.snapshot().gesture.label, 'Download once');
  }
  {
    const p = page();
    p.click(p.control('Export report', ''));
    assert(!p.click(p.control('', 'blob:https://shop.example/data', { claimed: 'report.csv', hidden: true }), false).stopped,
      'a real export may use a detached or hidden synthetic link');
    assert.equal(p.snapshot({ id: 'foreign' }), undefined);
    assert.equal(p.snapshot({ id: 'wardenone', tab: { id: 1 } }), undefined);
    assert.equal(p.snapshot().gesture.requested, true);
  }
  for (const config of [ { enabled: false }, { forcedDownloadProtection: false },
    { siteOverrides: { 'shop.example': { forcedDownloadProtection: false } } } ]) {
    const p = page(); p.box.bridgeConfig = config;
    assert(!p.click(p.control('Play', 'https://cdn.example/setup.exe')).stopped);
    assert.equal(p.snapshot().enabled, false);
  }
  {
    const p = page(); p.box.bridgeConfigReady = false;
    assert(!p.click(p.control('', 'https://cdn.example/setup.exe'), false).stopped);
    p.click(p.control('Download', 'https://cdn.example/setup.exe'), true, 'contextmenu');
    assert.equal(p.snapshot().gesture.requested, true);
  }
  {
    const p = page();
    const oversized = 'data:application/octet-stream,' + 'a'.repeat(9000);
    assert(!p.click(p.control('', oversized, { claimed: 'export.bin' }), false).stopped,
      'an oversized destination is left intact rather than replayed as a truncated file');
  }
  const now = Date.now();
  const item = { id: 501, url: 'https://cdn.example/get', finalUrl: 'https://cdn.example/get',
    filename: 'C:\\Downloads\\setup.exe', referrer: 'https://shop.example/page', state: 'in_progress',
    startTime: new Date(now).toISOString(), mime: 'application/octet-stream', danger: '' };
  const context = { ok: true, enabled: true, url: item.referrer, startedAt: now - 10000, hadGesture: false, gesture: null };
  function worker() {
    const h = loadDownloadGuard();
    h.sandbox.messageSenderIsTab = () => false;
    h.sandbox.tabsQuery = async () => [{ id: 7, url: item.referrer }];
    h.sandbox.chrome.tabs.sendMessage = (_id, _message, _options, callback) => callback(context);
    return h;
  }
  {
    const { guard, sandbox } = worker();
    sandbox.store.wardenone_config.downloadReputation = false;
    sandbox.downloadItems.push({ ...item });
    await guard.handleDownloadCreated(item);
    assert(sandbox.calls.some(call => call[0] === 'pause'), 'automatic installer pauses with Download Shield off');
    await guard.runDownloadGuardScan(item.id, item, 'created');
    const review = sandbox.store.wardenone_pending_downloads['501'];
    assert.equal(review.status, 'Unexpected download');
    assert.equal(review.reviewEvidence.unexpectedDownload, true);
    assert.equal(review.blockRequired, false, 'unrequested does not mean malware');
    assert.equal(review.trustAllowed, false);
    vm.runInContext('FORCED_DOWNLOAD_CONTEXT.clear(); FORCED_DOWNLOAD_REASONS.clear();', sandbox);
    await guard.runDownloadGuardScan(item.id, item, 'worker-recovery');
    assert.equal(sandbox.store.wardenone_pending_downloads['501'].reviewEvidence.unexpectedDownload, true,
      'persisted intent evidence survives losing worker memory');
    const result = await guard.handleDownloadDecision('501', 'continue', {});
    assert.equal(result.ok, true);
    assert(sandbox.calls.some(call => call[0] === 'resume'));
  }
  {
    const { guard, sandbox } = worker();
    sandbox.chrome.tabs.sendMessage = (_a, _b, _c, callback) => callback({ ...context, hadGesture: true,
      gesture: { at: now, requested: false, label: 'Play video' } });
    sandbox.store.wardenone_config.downloadReputation = false;
    const unnamed = { ...item, filename: '' };
    sandbox.downloadItems.push(unnamed);
    await guard.handleDownloadCreated(unnamed);
    await guard.runDownloadGuardScan(item.id, unnamed, 'created');
    assert(!sandbox.calls.some(call => call[0] === 'pause'), 'the generic endpoint alone is inconclusive');
    unnamed.filename = 'C:\\Downloads\\file.exe';
    guard.handleDownloadChanged({ id: item.id, filename: { current: unnamed.filename } });
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    assert(sandbox.calls.some(call => call[0] === 'pause'), 'the later active filename is checked after the first scan');
    await guard.runDownloadGuardScan(item.id, unnamed, 'filename');
    assert(sandbox.store.wardenone_pending_downloads['501'].reviewEvidence.unexpectedDownload);
  }
  for (const [name, change] of [
    ['toggle off', h => { h.sandbox.store.wardenone_config.forcedDownloadProtection = false; }],
    ['master off', h => { h.sandbox.store.wardenone_config.enabled = false; }],
    ['another extension', h => { h.sandbox.chrome.tabs.sendMessage = () => { throw new Error('must not query'); }; }],
    ['ambiguous tabs', h => { h.sandbox.tabsQuery = async () => [{ url: item.referrer }, { url: item.referrer }]; }],
    ['replaced document', h => { h.sandbox.chrome.tabs.sendMessage = (_a, _b, _c, cb) => cb({ ...context, url: 'https://elsewhere.example/' }); }],
  ]) {
    const h = worker(); change(h);
    await h.guard.handleDownloadCreated({ ...item, ...(name === 'another extension' ? { byExtensionId: 'other' } : {}) });
    assert(!h.sandbox.calls.some(call => call[0] === 'pause'), name);
  }
  {
    const { sandbox } = worker();
    const reason = vm.runInContext('unexpectedDownloadReason', sandbox);
    for (const [label, patch, filename, expected] of [
      ['explicit CDN download', { gesture: { at: now, requested: true } }, 'setup.exe', false],
      ['ordinary document after a button', { gesture: { at: now, requested: false } }, 'report.pdf', false],
      ['active file from Play', { gesture: { at: now, requested: false } }, 'setup.exe', true],
      ['mislabelled document', { gesture: { at: now, requested: true, claimed: 'report.pdf' } }, 'setup.exe', true],
      ['bound one-time choice', { gesture: { at: now, requested: true, label: 'Download once', href: item.url } }, 'setup.exe', false],
      ['unrelated one-time choice', { gesture: { at: now, requested: true, label: 'Download once', href: 'https://other.example/file.exe' } }, 'setup.exe', true],
      ['delayed export', { hadGesture: true }, 'setup.exe', false],
    ]) assert.equal(!!reason({ ...item, filename }, { ...context, ...patch }), expected, label);
    const observe = vm.runInContext('observeForcedDownloadRequest', sandbox);
    for (let i = 0; i < 180; i++) observe({ url: 'https://cdn.example/' + i, tabId: 7, frameId: 0 });
    assert.equal(vm.runInContext('FORCED_DOWNLOAD_REQUESTS.size', sandbox), 128);
    assert.equal(await vm.runInContext('forcedDownloadContext', sandbox)({ ...item, referrer: '' }), null,
      'address-bar downloads have no page authority');
    observe({ url: item.url, tabId: 7, frameId: 0, initiator: 'https://shop.example' });
    observe({ url: item.url, tabId: 8, frameId: 0, initiator: 'https://shop.example' });
    assert.equal(await vm.runInContext('forcedDownloadContext', sandbox)(item), null, 'concurrent sources cannot borrow another tab’s click');
  }
  console.log('[ok] forced download intent, page interception, independent switches, review continuation and source boundaries');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

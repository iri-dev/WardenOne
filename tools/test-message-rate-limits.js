'use strict';

// test-message-hardening.js asserts on the SOURCE of the rate-limit tables. That is
// why the double-charge bug lived here undetected: the tables were correct, the
// allowlist was correct, every kind had an entry -- and yet rg-block's real ceiling was
// half its documented one, because two separate listeners each charged the same bucket
// for the same message. Reading the source can never catch that.
//
// So this file loads background.js for real, behind a mocked chrome.*, and drives
// messages through chrome.runtime.onMessage the way a content script would. It counts
// what actually gets through rather than what the table says should.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function ev() {
  const l = [];
  return { _l: l, addListener: (f) => l.push(f), removeListener: () => {}, hasListener: () => false };
}
function area() {
  const data = Object.create(null);
  const api = {
    get(keys, cb) {
      const out = {};
      if (keys == null) Object.assign(out, data);
      else if (typeof keys === 'string') { if (keys in data) out[keys] = data[keys]; }
      else if (Array.isArray(keys)) keys.forEach((k) => { if (k in data) out[k] = data[k]; });
      else if (typeof keys === 'object') Object.keys(keys).forEach((k) => { out[k] = (k in data) ? data[k] : keys[k]; });
      if (cb) { setImmediate(() => cb(out)); return undefined; }
      return Promise.resolve(out);
    },
    set(items, cb) { Object.assign(data, items || {}); if (cb) { setImmediate(cb); return undefined; } return Promise.resolve(); },
    remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete data[k]); if (cb) { setImmediate(cb); return undefined; } return Promise.resolve(); },
    clear(cb) { Object.keys(data).forEach((k) => delete data[k]); if (cb) setImmediate(cb); return Promise.resolve(); },
    getBytesInUse(k, cb) { const b = Buffer.byteLength(JSON.stringify(data)); if (cb) { setImmediate(() => cb(b)); return undefined; } return Promise.resolve(b); },
    setAccessLevel() { return Promise.resolve(); },
    _data: data,
  };
  return api;
}

function loadBackground() {
  const badge = [];
  const chrome = {
    runtime: {
      id: 'ratelimittestid',
      getURL: (p) => 'chrome-extension://ratelimittestid/' + String(p || '').replace(/^\/+/, ''),
      getManifest: () => JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')),
      lastError: undefined,
      onMessage: ev(), onInstalled: ev(), onStartup: ev(), onSuspend: ev(),
      sendMessage: (m, cb) => { if (cb) setImmediate(() => cb(undefined)); },
      setUninstallURL: () => {},
    },
    storage: { local: area(), session: area(), sync: area(), onChanged: ev() },
    tabs: {
      query: (q, cb) => { if (cb) { setImmediate(() => cb([])); return undefined; } return Promise.resolve([]); },
      get: (id) => Promise.resolve({ id, url: 'https://example.com/' }),
      update: () => Promise.resolve({}), remove: () => Promise.resolve(), discard: () => Promise.resolve({}),
      sendMessage: (id, m, cb) => { if (cb) setImmediate(() => cb(undefined)); return Promise.resolve(undefined); },
      onUpdated: ev(), onRemoved: ev(), onCreated: ev(), onActivated: ev(), onReplaced: ev(),
    },
    tabGroups: { query: () => Promise.resolve([]), update: () => Promise.resolve({}), onUpdated: ev(), TAB_GROUP_ID_NONE: -1 },
    windows: { getAll: () => Promise.resolve([]), get: () => Promise.resolve({}), onRemoved: ev(), onCreated: ev(), onFocusChanged: ev(), WINDOW_ID_NONE: -1 },
    action: {
      setBadgeText: (o) => badge.push(o),
      setBadgeBackgroundColor: () => {}, setTitle: () => {}, setIcon: () => {}, onClicked: ev(),
    },
    alarms: { create: () => {}, clear: () => Promise.resolve(true), clearAll: () => Promise.resolve(true), get: () => Promise.resolve(null), getAll: () => Promise.resolve([]), onAlarm: ev() },
    webNavigation: { onBeforeNavigate: ev(), onCommitted: ev(), onCompleted: ev(), onCreatedNavigationTarget: ev(), onHistoryStateUpdated: ev(), onErrorOccurred: ev(), onDOMContentLoaded: ev(), getAllFrames: () => Promise.resolve([]) },
    webRequest: { onBeforeRedirect: ev(), onErrorOccurred: ev(), onCompleted: ev(), onBeforeRequest: ev(), onHeadersReceived: ev() },
    declarativeNetRequest: {
      getDynamicRules: () => Promise.resolve([]), getSessionRules: () => Promise.resolve([]),
      updateDynamicRules: () => Promise.resolve(), updateSessionRules: () => Promise.resolve(),
      updateEnabledRulesets: () => Promise.resolve(), getEnabledRulesets: () => Promise.resolve([]),
      getAvailableStaticRuleCount: () => Promise.resolve(1000), setExtensionActionOptions: () => Promise.resolve(),
      isRegexSupported: () => Promise.resolve({ isSupported: true }), onRuleMatchedDebug: ev(),
    },
    scripting: {
      registerContentScripts: () => Promise.resolve(), unregisterContentScripts: () => Promise.resolve(),
      updateContentScripts: () => Promise.resolve(), getRegisteredContentScripts: () => Promise.resolve([]),
      executeScript: () => Promise.resolve([{ result: null }]), insertCSS: () => Promise.resolve(), removeCSS: () => Promise.resolve(),
    },
    cookies: { getAll: () => Promise.resolve([]), remove: () => Promise.resolve(null), set: () => Promise.resolve(null), onChanged: ev() },
    browsingData: { remove: () => Promise.resolve(), removeCache: () => Promise.resolve() },
    history: { search: () => Promise.resolve([]), deleteUrl: () => Promise.resolve(), deleteRange: () => Promise.resolve(), onVisited: ev() },
    downloads: { onCreated: ev(), onChanged: ev(), onDeterminingFilename: ev(), search: () => Promise.resolve([]), cancel: () => Promise.resolve(), erase: () => Promise.resolve([]), removeFile: () => Promise.resolve(), acceptDanger: () => Promise.resolve(), download: () => Promise.resolve(1) },
    notifications: { create: () => {}, clear: () => {}, onClicked: ev(), onButtonClicked: ev(), onClosed: ev(), getAll: (cb) => cb && cb({}) },
    management: { getAll: () => Promise.resolve([]), get: () => Promise.resolve({}), setEnabled: () => Promise.resolve(), onInstalled: ev(), onEnabled: ev(), onDisabled: ev(), onUninstalled: ev(), getSelf: () => Promise.resolve({ id: 'ratelimittestid' }) },
    contentSettings: {},
    permissions: { contains: () => Promise.resolve(true), getAll: () => Promise.resolve({ permissions: [], origins: [] }) },
    idle: { queryState: (n, cb) => cb && cb('active'), onStateChanged: ev(), setDetectionInterval: () => {} },
    system: { memory: { getInfo: () => Promise.resolve({ capacity: 8e9, availableCapacity: 4e9 }) } },
  };
  for (const k of ['cookies', 'javascript', 'location', 'camera', 'microphone', 'notifications', 'popups', 'automaticDownloads', 'images', 'plugins']) {
    chrome.contentSettings[k] = {
      get: (d, cb) => { if (cb) { setImmediate(() => cb({ setting: 'allow' })); return undefined; } return Promise.resolve({ setting: 'allow' }); },
      set: (d, cb) => { if (cb) { setImmediate(cb); return undefined; } return Promise.resolve(); },
      clear: (d, cb) => { if (cb) { setImmediate(cb); return undefined; } return Promise.resolve(); },
    };
  }

  const sandbox = {
    chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob,
    crypto: require('crypto').webcrypto, performance, structuredClone,
    Response: global.Response, Request: global.Request, Headers: global.Headers,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: { onLine: true, userAgent: 'test', deviceMemory: 8, hardwareConcurrency: 8 },
    location: { href: 'chrome-extension://ratelimittestid/background.js', origin: 'chrome-extension://ratelimittestid' },
    fetch: async () => { throw new Error('network disabled in this test'); },
    importScripts(...files) {
      for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.self = globalThis;', ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  return { chrome, badge, ctx };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

const H = loadBackground();
const listeners = H.chrome.runtime.onMessage._l;
check('background registers its message listeners', listeners.length >= 2, listeners.length + ' listeners');

// Read the declared ceiling out of the source: the test asserts the code honours its
// own table, not a number copied into this file that could drift from it.
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const tableBlock = bg.slice(bg.indexOf('const TAB_CONTEXT_RATE_LIMITS = {'), bg.indexOf('\n};', bg.indexOf('const TAB_CONTEXT_RATE_LIMITS = {')));
function declaredMax(kind) {
  const m = new RegExp("'" + kind + "':\\s*\\{\\s*max:\\s*(\\d+)").exec(tableBlock);
  assert(m, 'TAB_CONTEXT_RATE_LIMITS has no max for ' + kind);
  return Number(m[1]);
}

function deliver(msg, sender) {
  let refused = false;
  listeners.forEach((fn) => {
    try {
      fn(msg, sender, (resp) => { if (resp && resp.ok === false && /rate limit/i.test(String(resp.error || ''))) refused = true; });
    } catch (_) { /* a throwing listener is a separate concern */ }
  });
  return refused;
}
function drive(kind, tabId, count, extra) {
  const sender = { tab: { id: tabId, url: 'https://ad-heavy.example/p' }, url: 'https://ad-heavy.example/p', frameId: 0 };
  let refusals = 0;
  for (let i = 0; i < count; i++) {
    if (deliver(Object.assign({ kind }, extra || {}), sender)) refusals++;
  }
  return refusals;
}
function badgeCountFor(tabId) {
  const last = H.badge.filter((b) => b.tabId === tabId).pop();
  return last ? Number(last.text || 0) : 0;
}

// ---------------------------------------------------------------------------
// 1. rg-block: every message must cost exactly ONE slot, so the badge reaches the
//    table's ceiling. While two listeners shared a bucket it stopped at half.
// ---------------------------------------------------------------------------
{
  const max = declaredMax('rg-block');
  const refusals = drive('rg-block', 7001, max + 100, { type: 'blocked_ad_request' });
  const reached = badgeCountFor(7001);
  check('rg-block reaches its declared ceiling of ' + max + ', not half of it',
    reached === max, 'badge reached ' + reached);
  check('rg-block refuses exactly the overflow', refusals === 100, refusals + ' refusals');
}

// ---------------------------------------------------------------------------
// 2. Per-tab isolation: one noisy tab must not spend another tab's budget.
// ---------------------------------------------------------------------------
{
  const max = declaredMax('rg-block');
  drive('rg-block', 7002, max + 50, { type: 'blocked_ad_request' });
  const fresh = drive('rg-block', 7003, 10, { type: 'blocked_ad_request' });
  check('a fresh tab is unaffected by another tab hitting its ceiling',
    fresh === 0 && badgeCountFor(7003) === 10, 'refusals=' + fresh + ' badge=' + badgeCountFor(7003));
}

// ---------------------------------------------------------------------------
// 3. No other tab-reachable kind is double-charged either. Each is driven to one
//    under its ceiling and must not be refused.
// ---------------------------------------------------------------------------
{
  const kinds = [...tableBlock.matchAll(/'([a-z0-9-]+)':\s*\{\s*max:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]);
  check('found the rate-limit table', kinds.length >= 10, kinds.length + ' kinds');
  const doubled = [];
  let tab = 7100;
  for (const [kind, max] of kinds) {
    if (kind === 'rg-block') continue;           // covered above
    tab += 1;
    const refusals = drive(kind, tab, max, { type: 'blocked_x', domain: 'ad-heavy.example', hostname: 'ad-heavy.example', url: 'https://ad-heavy.example/p', context: 'link' });
    if (refusals > 0) doubled.push(kind + ' refused ' + refusals + ' of ' + max);
  }
  check('no kind is refused before reaching its declared ceiling', doubled.length === 0, doubled.join(' | '));
}

// ---------------------------------------------------------------------------
// 4. Guard the shape of the fix, so a future edit cannot silently re-share buckets.
// ---------------------------------------------------------------------------
{
  check("the router namespaces its gate bucket away from handler limiters",
    /allowTabMessageRate\(sender\.tab\.id, 'gate:' \+ msg\.kind/.test(bg));
  check('the rg-block handler reads its ceiling from the table, not a literal',
    /TAB_CONTEXT_RATE_LIMITS\['rg-block'\]/.test(bg));
  check('no call site hardcodes a second rg-block ceiling',
    !/allowTabMessageRate\([^)]*'rg-block',\s*\d+/.test(bg));
}

setTimeout(() => {
  if (failures) {
    console.error('[fail] message rate limit tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] message rate limit tests');
}, 150);

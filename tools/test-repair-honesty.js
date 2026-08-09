'use strict';

// Verify & Repair used to report "Re-armed full protection on N open tab(s)" for any tab
// where chrome.scripting.executeScript merely RESOLVED. Every content script early-returns
// when its re-injection guard matches, and that early return looks identical to a fresh
// install from the background's side -- so a tab still holding an orphaned copy from before
// an extension reload was counted as re-armed. For a recovery button on a security
// extension, reporting success while doing nothing is the worst way to be wrong.
//
// It now asks the tab. The MAIN-world engine publishes its version when it installs, and
// the ISOLATED bridge answers a cheap message only while it belongs to the CURRENT
// extension context -- an orphaned bridge's listener died with the context that registered
// it. This drives verify-repair against three tabs that behave like the real cases and
// checks what it says about each.

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
  return {
    _data: data,
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
    getBytesInUse(k, cb) { const b = 1024; if (cb) { setImmediate(() => cb(b)); return undefined; } return Promise.resolve(b); },
    setAccessLevel() { return Promise.resolve(); },
  };
}

// Three tabs standing in for the three real outcomes.
const TABS = [
  { id: 1, url: 'https://healthy.example/', engine: '1.0.0', bridgeAlive: true },   // freshly armed
  { id: 2, url: 'https://orphan.example/', engine: '1.0.0', bridgeAlive: false },   // guard blocked re-arm
  { id: 3, url: 'https://gone.example/', engine: null, bridgeAlive: false },        // not scriptable
];

function load() {
  const chrome = {
    runtime: {
      id: 'repairhonestytestid',
      getURL: (p) => 'chrome-extension://repairhonestytestid/' + String(p || '').replace(/^\/+/, ''),
      getManifest: () => JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')),
      lastError: undefined,
      onMessage: ev(), onInstalled: ev(), onStartup: ev(), onSuspend: ev(),
      sendMessage: (m, cb) => { if (cb) setImmediate(() => cb(undefined)); },
      setUninstallURL: () => {},
    },
    storage: { local: area(), session: area(), sync: area(), onChanged: ev() },
    tabs: {
      query: (q, cb) => {
        const r = TABS.map((t) => ({ id: t.id, url: t.url }));
        if (cb) { setImmediate(() => cb(r)); return undefined; }
        return Promise.resolve(r);
      },
      get: (id) => Promise.resolve(TABS.find((t) => t.id === id) || { id }),
      // Only a bridge belonging to the current extension context answers.
      sendMessage: (tabId, msg, opts, cb) => {
        const fn = typeof opts === 'function' ? opts : cb;
        const t = TABS.find((x) => x.id === tabId);
        const answer = (t && t.bridgeAlive && msg && msg.kind === 'memory-form-check')
          ? { formDirty: false, mediaActive: false } : undefined;
        if (fn) { setImmediate(() => fn(answer)); return undefined; }
        return Promise.resolve(answer);
      },
      update: () => Promise.resolve({}), remove: () => Promise.resolve(), discard: () => Promise.resolve({}),
      onUpdated: ev(), onRemoved: ev(), onCreated: ev(), onActivated: ev(), onReplaced: ev(),
    },
    tabGroups: { query: () => Promise.resolve([]), update: () => Promise.resolve({}), onUpdated: ev(), TAB_GROUP_ID_NONE: -1 },
    windows: { getAll: () => Promise.resolve([]), get: () => Promise.resolve({}), onRemoved: ev(), onCreated: ev(), onFocusChanged: ev(), WINDOW_ID_NONE: -1 },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {}, setIcon: () => {}, onClicked: ev() },
    alarms: { create: () => {}, clear: () => Promise.resolve(true), clearAll: () => Promise.resolve(true), get: () => Promise.resolve(null), getAll: () => Promise.resolve([]), onAlarm: ev() },
    webNavigation: {
      onBeforeNavigate: ev(), onCommitted: ev(), onCompleted: ev(), onCreatedNavigationTarget: ev(),
      onHistoryStateUpdated: ev(), onErrorOccurred: ev(), onDOMContentLoaded: ev(),
      // getRepairFramesForTab uses the CALLBACK form, so support both or the repair
      // chain simply never resolves.
      getAllFrames: ({ tabId }, cb) => {
        const frames = [{ frameId: 0, url: (TABS.find((t) => t.id === tabId) || {}).url || '' }];
        if (cb) { setImmediate(() => cb(frames)); return undefined; }
        return Promise.resolve(frames);
      },
    },
    webRequest: { onBeforeRedirect: ev(), onErrorOccurred: ev(), onCompleted: ev(), onBeforeRequest: ev(), onHeadersReceived: ev() },
    declarativeNetRequest: {
      getDynamicRules: () => Promise.resolve([{ id: 10000 }]), getSessionRules: () => Promise.resolve([]),
      updateDynamicRules: () => Promise.resolve(), updateSessionRules: () => Promise.resolve(),
      updateEnabledRulesets: () => Promise.resolve(), getEnabledRulesets: () => Promise.resolve(['grabbers']),
      getAvailableStaticRuleCount: () => Promise.resolve(1000), setExtensionActionOptions: () => Promise.resolve(),
      isRegexSupported: () => Promise.resolve({ isSupported: true }), onRuleMatchedDebug: ev(),
    },
    scripting: {
      registerContentScripts: () => Promise.resolve(), unregisterContentScripts: () => Promise.resolve(),
      updateContentScripts: () => Promise.resolve(), getRegisteredContentScripts: () => Promise.resolve([]),
      insertCSS: () => Promise.resolve(), removeCSS: () => Promise.resolve(),
      executeScript: ({ target, func }) => {
        const t = TABS.find((x) => x.id === target.tabId);
        if (!t) return Promise.reject(new Error('no such tab'));
        // A tab that cannot be scripted rejects, exactly as Chrome does.
        if (t.engine === null) return Promise.reject(new Error('Cannot access contents'));
        // The version probe reads what the tab is actually running.
        if (typeof func === 'function') return Promise.resolve([{ result: t.engine }]);
        // A file injection resolves whether or not the guard let it install -- the
        // behaviour that made the old success count meaningless.
        return Promise.resolve([{ result: null }]);
      },
    },
    cookies: { getAll: () => Promise.resolve([]), remove: () => Promise.resolve(null), set: () => Promise.resolve(null), onChanged: ev() },
    browsingData: { remove: () => Promise.resolve(), removeCache: () => Promise.resolve() },
    history: { search: () => Promise.resolve([]), deleteUrl: () => Promise.resolve(), deleteRange: () => Promise.resolve(), onVisited: ev() },
    downloads: { onCreated: ev(), onChanged: ev(), onDeterminingFilename: ev(), search: () => Promise.resolve([]), cancel: () => Promise.resolve(), erase: () => Promise.resolve([]), removeFile: () => Promise.resolve(), acceptDanger: () => Promise.resolve(), download: () => Promise.resolve(1) },
    notifications: { create: () => {}, clear: () => {}, onClicked: ev(), onButtonClicked: ev(), onClosed: ev(), getAll: (cb) => cb && cb({}) },
    management: { getAll: () => Promise.resolve([]), get: () => Promise.resolve({}), setEnabled: () => Promise.resolve(), onInstalled: ev(), onEnabled: ev(), onDisabled: ev(), onUninstalled: ev(), getSelf: () => Promise.resolve({ id: 'repairhonestytestid' }) },
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
    location: { href: 'chrome-extension://repairhonestytestid/background.js', origin: 'chrome-extension://repairhonestytestid' },
    fetch: async (u) => {
      const m = String(u).match(/^chrome-extension:\/\/repairhonestytestid\/(.*)$/);
      if (m) {
        const txt = fs.readFileSync(path.join(ROOT, decodeURIComponent(m[1])), 'utf8');
        return { ok: true, status: 200, headers: new Map(), text: async () => txt, json: async () => JSON.parse(txt), clone() { return this; } };
      }
      throw new Error('network disabled');
    },
    importScripts(...files) { for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.self = globalThis;', ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  return chrome;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// verify-repair is a long async chain. Without this, a rejection anywhere inside it just
// means "no response", which says nothing about where it stopped.
process.on('unhandledRejection', (e) => console.error('  [async error] ' + ((e && e.stack) || e)));

const chrome = load();
const EXT = { id: 'repairhonestytestid', url: 'chrome-extension://repairhonestytestid/popup.html' };

new Promise((resolve) => {
  let answered = false;
  chrome.runtime.onMessage._l.forEach((fn) => {
    try {
      const kept = fn({ kind: (process.env.WO_KIND||'verify-repair') }, EXT, (report) => { answered = true; resolve(report); });
      void kept;
    } catch (e) { console.error('  listener threw: ' + e.message); }
  });
  setTimeout(() => { if (!answered) resolve(null); }, 4000);
}).then((report) => {
  check('verify-repair answers', !!report, 'no response');
  if (!report) { process.exit(1); }

  const lines = (report.repaired || []).join(' | ');
  const tabCheck = (report.checks || []).find((c) => /Open tabs re-armed/.test(c.name || ''));

  check('the healthy tab is counted as re-armed', / 1 open tab\(s\)/.test(lines) && /Re-armed full protection on 1 /.test(lines), lines);
  check('the orphaned tab is NOT counted as re-armed', !/Re-armed full protection on 2 /.test(lines) && !/Re-armed full protection on 3 /.test(lines), lines);
  check('the orphaned tab is reported as needing a reload', /1 open tab\(s\) still run an older copy/.test(lines), lines);
  check('the unscriptable tab is not reported either way', !/2 open tab\(s\) still run/.test(lines), lines);
  check('the tab check names the reload count', !!tabCheck && /need a reload/.test(tabCheck.name), tabCheck && tabCheck.name);
  check('the tab check does NOT pass while a tab still needs a reload', !!tabCheck && tabCheck.ok === false,
    tabCheck && ('ok=' + tabCheck.ok));

  // Source guards against the old assume-success shape returning.
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  check('success is no longer inferred from executeScript alone',
    /__wardenOneReadyVersion/.test(bg) && /bridgeAnswers/.test(bg));
  check('the bridge probe is side-effect free', /kind: 'memory-form-check' \}/.test(bg));

  if (failures) {
    console.error('[fail] repair honesty tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] repair honesty tests');
  process.exit(0);
});

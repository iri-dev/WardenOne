/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// Verify & Repair used to report "Re-armed full protection on N open tab(s)" for any tab
// where chrome.scripting.executeScript merely RESOLVED, and then to read a MAIN-world version
// marker back to decide it had worked -- a marker the page can write (SEC-03). For a recovery
// button on a security extension, reporting success while doing nothing is the worst way to
// be wrong.
//
// It now asks the tab's ISOLATED bridge, which holds the key the engine was handed at
// document_start, whether the engine answers a signed challenge. A tab that answers is left
// as it is. A tab that does not -- the engine is gone, or the bridge belongs to a previous
// extension lifetime and cannot answer at all -- is reloaded, which is a fresh document_start
// hand-off; nothing is injected into a live document any more, because no channel into one is
// private. This drives verify-repair against tabs that behave like the real cases and checks
// what it says about each.

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
// The engine version is read from the manifest rather than written out, because the scenario is
// "this tab is running the shipped version" -- not "this tab is running 1.0.0". Hardcoding it
// meant every version bump broke this suite for no reason at all.
const SHIPPED_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const TABS = [
  { id: 1, url: 'https://healthy.example/', bridgeAlive: true, alive: true },     // answers the challenge
  { id: 2, url: 'https://orphan.example/', bridgeAlive: false },                  // bridge from a previous lifetime
  { id: 3, url: 'https://gone.example/', bridgeAlive: false, reloadFails: true }, // closed between query and reload
  { id: 4, url: 'https://disposed.example/', bridgeAlive: true, alive: false },   // the page switched the engine off
  { id: 5, url: 'https://mail.google.com/mail/u/0/', bridgeAlive: false },       // the manifest excludes the engine here
  { id: 6, url: 'https://sleeping.example/', bridgeAlive: false, discarded: true }, // reloads itself when shown
];
const RELOADED = [];
const INJECTED = [];

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
        const r = TABS.map((t) => ({ id: t.id, url: t.url, discarded: !!t.discarded }));
        if (cb) { setImmediate(() => cb(r)); return undefined; }
        return Promise.resolve(r);
      },
      get: (id) => Promise.resolve(TABS.find((t) => t.id === id) || { id }),
      // Only a bridge belonging to the current extension context answers, and it answers
      // with the signed challenge's verdict.
      sendMessage: (tabId, msg, opts, cb) => {
        const fn = typeof opts === 'function' ? opts : cb;
        const t = TABS.find((x) => x.id === tabId);
        const answer = (t && t.bridgeAlive && msg && msg.kind === 'wo-engine-status')
          ? { ok: true, alive: !!t.alive, seen: !!t.alive, fresh: true } : undefined;
        if (fn) { setImmediate(() => fn(answer)); return undefined; }
        return Promise.resolve(answer);
      },
      reload: (tabId) => {
        const t = TABS.find((x) => x.id === tabId);
        if (!t || t.reloadFails) return Promise.reject(new Error('No tab with id'));
        RELOADED.push(tabId);
        return Promise.resolve();
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
      // Repair must not execute anything into a live tab any more; record it if it does.
      executeScript: (args) => { INJECTED.push(args); return Promise.resolve([{ result: null }]); },
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
  const tabCheck = (report.checks || []).find((c) => /Open tabs verified/.test(c.name || ''));

  check('the healthy tab is left exactly as it is', !RELOADED.includes(1) && /1 open tab\(s\) answered the engine check/.test(lines), lines);
  check('the orphaned tab, whose bridge cannot answer, is reloaded', RELOADED.includes(2), JSON.stringify(RELOADED));
  check('the tab whose engine stopped answering is reloaded', RELOADED.includes(4), JSON.stringify(RELOADED));
  check('the page the manifest excludes the engine from is left alone', !RELOADED.includes(5), JSON.stringify(RELOADED));
  check('the sleeping tab is left alone', !RELOADED.includes(6), JSON.stringify(RELOADED));
  check('the report counts what was reloaded and what was left', /Reloaded 2 open tab\(s\) whose engine did not answer/.test(lines) && /Left 2 tab\(s\) alone/.test(lines), lines);
  check('nothing was injected into any live tab', INJECTED.filter((a) => a && a.files).length === 0, JSON.stringify(INJECTED.map((a) => a && a.files)));
  check('the tab check names live, reloaded and failed counts', !!tabCheck && /1 live, 2 reloaded, 1 could not be reloaded/.test(tabCheck.name), tabCheck && tabCheck.name);
  check('the tab check does NOT pass while a tab could not be reloaded', !!tabCheck && tabCheck.ok === false, tabCheck && ('ok=' + tabCheck.ok));

  // Source guards against the old assume-success shape returning.
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  check('success is decided by the bridge\'s signed challenge, not a MAIN-world marker',
    /\{ kind: 'wo-engine-status' \}/.test(bg) && !/engineVersionInTab/.test(bg) && !/markWardenOneCopiesStale/.test(bg));
  check('the worker never executes a MAIN-world file into a live tab', !/executeScript\(\{ target, world: 'MAIN', files/.test(bg));

  if (failures) {
    console.error('[fail] repair honesty tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] repair honesty tests');
  process.exit(0);
});

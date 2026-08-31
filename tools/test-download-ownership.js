/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Nothing WardenOne paused may lose its owner (M25).
 *
 * Three ways it could. The pending and handled stores are whole-object read/modify/writes, so two
 * legitimate scans could both read the same starting state and the second write would drop the
 * first record. runtime.onInstalled stamped a new browser session for every reason including
 * 'update', so a background extension update reclassified a download from minutes earlier as
 * belonging to a previous session and closed its review. And the early pause happens before the
 * review record exists, so a worker death in that gap left a file paused with nothing pointing at
 * it.
 *
 * No file is corrupted by any of this. What is lost is ownership of a paused download -- the
 * review panel that explains it and offers to resume or cancel it -- which is the part that has to
 * be recoverable.
 *
 * Run: node tools/test-download-ownership.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const DOWNLOADS = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');

process.exitCode = 1;

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function liftFunction(source, name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\(', 'm');
  const start = source.search(re);
  if (start < 0) throw new Error('function not found: ' + name);
  const end = source.indexOf('\n}\n', start);
  if (end < 0) throw new Error('function end not found: ' + name);
  return source.slice(start, end + 3);
}
function liftBetween(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  const to = source.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to <= from) throw new Error('markers not found: ' + startMarker);
  return source.slice(from, to);
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

// ---------------------------------------------------------------------------
// The stores, with storage that can be held open mid-write.
// ---------------------------------------------------------------------------
function loadStores(options = {}) {
  const state = {
    storage: Object.assign({ wardenone_config: { enabled: true, downloadReputation: true } }, options.storage || {}),
    writes: [],
    gates: [],
    hold: false,
    scans: [],
    items: options.items || [],
    sessionStartedAt: options.sessionStartedAt || 0,
  };
  const sandbox = {
    console, Date, Object, Number, String, Set, Promise, Map, URL,
    setTimeout, clearTimeout,
    PENDING_DOWNLOADS: Object.create(null),
    DOWNLOAD_PENDING_KEY: 'wardenone_pending_downloads',
    DOWNLOAD_HANDLED_KEY: 'wardenone_download_handled',
    DOWNLOAD_HANDLED_TTL_MS: 60 * 60 * 1000,
    scheduleDownloadGuardScan: (id, item, reason) => { state.scans.push({ id, reason }); },
    downloadSearch: async () => state.items.slice(),
    localGet: async (key) => {
      const read = () => (Array.isArray(key)
        ? key.reduce((out, k) => Object.assign(out, { [k]: state.storage[k] }), {})
        : { [key]: state.storage[key] });
      if (!state.hold) return read();
      const gate = deferred();
      state.gates.push(gate);
      await gate.promise;
      return read();
    },
    localSet: async (obj) => {
      if (options.failWrites) throw new Error('storage unavailable');
      state.writes.push(JSON.parse(JSON.stringify(obj)));
      Object.assign(state.storage, obj);
    },
  };
  sandbox.downloadStateGet = sandbox.localGet;
  sandbox.downloadStateSet = sandbox.localSet;
  vm.createContext(sandbox);
  vm.runInContext([
    liftBetween(BACKGROUND, 'const __subsystemQueues = new Map();', 'const SERIALIZED_STATE_APPLIERS = ['),
    liftFunction(DOWNLOADS, 'withDownloadStore'),
    liftFunction(DOWNLOADS, 'rememberPendingDownload'),
    liftFunction(DOWNLOADS, 'getPendingDownload'),
    liftFunction(DOWNLOADS, 'removePendingDownload'),
    liftFunction(DOWNLOADS, 'readHandledDownloads'),
    liftFunction(DOWNLOADS, 'getHandledDownloads'),
    liftFunction(DOWNLOADS, 'isDownloadHandled'),
    liftFunction(DOWNLOADS, 'rememberHandledDownload'),
    liftFunction(DOWNLOADS, 'downloadStartedBeforeSession'),
    liftFunction(DOWNLOADS, 'recoverStrandedPausedDownloads'),
  ].join('\n')
    + '\nvar SESSION_STARTED_AT = ' + state.sessionStartedAt + ';'
    + '\nthis.__api = { rememberPendingDownload, getPendingDownload, removePendingDownload,'
    + ' getHandledDownloads, isDownloadHandled, rememberHandledDownload, recoverStrandedPausedDownloads };',
  sandbox, { filename: 'background-downloads.js' });
  state.api = sandbox.__api;
  state.sandbox = sandbox;
  state.release = () => { state.gates.splice(0).forEach((g) => g.resolve()); return settle(); };
  return state;
}

const review = (id) => ({ id: String(id), downloadId: Number(id), createdAt: Date.now() });
const pendingStore = (s) => s.storage.wardenone_pending_downloads || {};
const handledStore = (s) => s.storage.wardenone_download_handled || {};

async function testStoreOwnership() {
  // The reproduction: two adds whose reads overlap. Both must survive.
  {
    const s = loadStores();
    s.hold = true;
    const a = s.api.rememberPendingDownload(review(1));
    const b = s.api.rememberPendingDownload(review(2));
    await settle();
    check('a second add does not read the store while the first is mid-write', s.gates.length === 1,
      s.gates.length + ' concurrent reads');
    s.hold = false;
    await s.release();
    await Promise.all([a, b]);
    check('both concurrent reviews are persisted, not just the last one',
      !!pendingStore(s)['1'] && !!pendingStore(s)['2'], JSON.stringify(Object.keys(pendingStore(s))));
  }

  // Add then remove: the remove must win, and must not resurrect the add.
  {
    const s = loadStores();
    await s.api.rememberPendingDownload(review(1));
    const add = s.api.rememberPendingDownload(review(2));
    const remove = s.api.removePendingDownload('1');
    await Promise.all([add, remove]);
    check('an interleaved add and remove both take effect',
      !pendingStore(s)['1'] && !!pendingStore(s)['2'], JSON.stringify(Object.keys(pendingStore(s))));
  }

  // The handled store has the same shape and the same race.
  {
    const s = loadStores();
    await Promise.all([
      s.api.rememberHandledDownload('7', 'allowed'),
      s.api.rememberHandledDownload('8', 'blocked'),
    ]);
    check('two handled records written at once both survive',
      !!handledStore(s)['7'] && !!handledStore(s)['8'], JSON.stringify(Object.keys(handledStore(s))));
  }

  // Pending and handled are separate lanes, so one cannot block the other. Observed by holding
  // storage open: on one shared lane only the first would have reached its read.
  {
    const s = loadStores();
    s.hold = true;
    const p = s.api.rememberPendingDownload(review(3));
    const h = s.api.rememberHandledDownload('9', 'x');
    await settle();
    check('a pending write and a handled write do not queue behind each other',
      s.gates.length === 2, s.gates.length + ' of 2 reads in flight');
    s.hold = false;
    await s.release();
    await Promise.all([p, h]);
    check('and both land', !!pendingStore(s)['3'] && !!handledStore(s)['9']);
  }

  // getHandledDownloads prunes and writes; rememberHandledDownload calls into the same lane.
  // Nesting those would deadlock, which is why the read half is separate.
  {
    const s = loadStores({ storage: { wardenone_download_handled: { old: { at: 1, decision: 'x' } } } });
    const done = await Promise.race([
      s.api.rememberHandledDownload('10', 'allowed').then(() => 'done'),
      new Promise((r) => setTimeout(() => r('deadlock'), 200)),
    ]);
    check('recording a decision does not deadlock against the prune', done === 'done');
    check('and the expired record is pruned', !handledStore(s).old, JSON.stringify(handledStore(s)));
  }

  // A failing write must not wedge the lane for every later mutation.
  {
    const s = loadStores({ failWrites: true });
    await s.api.rememberPendingDownload(review(1)).catch(() => {});
    s.sandbox.localSet = async (obj) => { s.writes.push(obj); Object.assign(s.storage, obj); };
    s.sandbox.downloadStateSet = s.sandbox.localSet;
    const done = await Promise.race([
      s.api.rememberPendingDownload(review(2)).then(() => 'done'),
      new Promise((r) => setTimeout(() => r('wedged'), 200)),
    ]);
    check('a storage failure does not wedge the store for the next write', done === 'done');
  }
}

// ---------------------------------------------------------------------------
// A stranded paused download has to be found again.
// ---------------------------------------------------------------------------
const pausedItem = (id, extra) => Object.assign({ id, state: 'in_progress', paused: true, startTime: new Date().toISOString() }, extra || {});

async function testStrandedRecovery() {
  {
    const s = loadStores({ items: [pausedItem(11)] });
    const n = await s.api.recoverStrandedPausedDownloads();
    check('a paused download with no record at all is picked back up', n === 1 && s.scans.length === 1,
      JSON.stringify(s.scans));
    check('and it is scheduled as a recovery', s.scans[0] && s.scans[0].reason === 'recover');
  }

  {
    const s = loadStores({ items: [pausedItem(12)] });
    await s.api.rememberHandledDownload('12', 'allowed');
    const n = await s.api.recoverStrandedPausedDownloads();
    check('one the user already decided about is left alone', n === 0 && s.scans.length === 0);
  }

  {
    const s = loadStores({ items: [pausedItem(13)] });
    await s.api.rememberPendingDownload(review(13));
    const n = await s.api.recoverStrandedPausedDownloads();
    check('one that still has its review is not reviewed twice', n === 0 && s.scans.length === 0);
  }

  {
    const old = new Date(Date.now() - 60000).toISOString();
    const s = loadStores({ items: [pausedItem(14, { startTime: old })], sessionStartedAt: Date.now() });
    const n = await s.api.recoverStrandedPausedDownloads();
    check('one from before this browser session is not reopened', n === 0 && s.scans.length === 0);
  }

  {
    const s = loadStores({ items: [pausedItem(15)], storage: { wardenone_config: { enabled: true, downloadReputation: false } } });
    const n = await s.api.recoverStrandedPausedDownloads();
    check('nothing is recovered while the guard is off', n === 0 && s.scans.length === 0);
  }

  {
    const s = loadStores({ items: [pausedItem(16)], storage: { wardenone_config: { enabled: false, downloadReputation: true } } });
    check('nothing is recovered while WardenOne is off', (await s.api.recoverStrandedPausedDownloads()) === 0);
  }

  // Recovery re-reviews; it never resumes. A risky file stays paused until the user says otherwise.
  check('the recovery path does not resume anything',
    !/resume/.test(liftFunction(DOWNLOADS, 'recoverStrandedPausedDownloads')),
    'recovery must not silently continue a download the guard paused');
}

// ---------------------------------------------------------------------------
// An extension update is not a new browser session.
// ---------------------------------------------------------------------------
function loadInstalledListener() {
  const state = { stamps: 0, onboarding: 0 };
  const sandbox = {
    console, Object, Date,
    DEFAULT_CONFIG: {},
    localSet: async () => {},
    markBrowserSessionStart: () => { state.stamps++; },
    scheduleUpdates: () => {},
    pruneStorageIfNeeded: async () => {},
    updateRemoteListsWithRetry: () => {},
    applyScriptShieldRules: () => {},
    refreshExtensionState: () => {},
    chrome: {
      runtime: {
        getURL: (p) => p,
        onInstalled: { addListener(fn) { state.fire = fn; } },
      },
      storage: { local: { get(_key, cb) { cb({ wardenone_config: { enabled: true } }); } } },
      tabs: { create() { state.onboarding++; } },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(liftBetween(BACKGROUND, 'chrome.runtime.onInstalled.addListener((details) => {', '\nchrome.runtime.onStartup'),
    sandbox, { filename: 'background.js' });
  return state;
}

function testSessionStamp() {
  for (const reason of ['update', 'chrome_update', 'shared_module_update']) {
    const s = loadInstalledListener();
    s.fire({ reason });
    check('a ' + reason.replace(/_/g, ' ') + ' does not declare a new browser session', s.stamps === 0,
      s.stamps + ' stamps');
  }
  {
    const s = loadInstalledListener();
    s.fire({ reason: 'install' });
    check('a first install does stamp one', s.stamps === 1);
    check('and still opens onboarding', s.onboarding === 1);
  }
  check('a real browser start still stamps a session',
    /onStartup\?\.addListener\(\(\) => \{[\s\S]{0,400}markBrowserSessionStart\(\)/.test(DOWNLOADS),
    'without this the session boundary would never move');
}

async function main() {
  await testStoreOwnership();
  await testStrandedRecovery();
  testSessionStamp();

  if (failed) { console.error('\n' + failed + ' download ownership check(s) failed'); process.exit(1); }
  console.log('\nno paused download loses its owner');
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

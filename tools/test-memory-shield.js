/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function addListener() {}

// Everything the two M19 failures need to be observable: which tabs were discarded or closed, what
// the alarm was told, and a bridge whose reply can be made to fail in each of the ways a real one
// does. The old harness answered every live check with a clean reply, which is precisely the case
// where the bug was invisible.
function loadMemoryShield(options = {}) {
  const state = {
    tabs: Array.from(options.tabs || []),
    config: Object.assign({}, options.config || {}),
    discarded: [],
    removed: [],
    alarmsCreated: [],
    alarmsCleared: [],
    liveReply: options.liveReply || (() => ({ formDirty: false, mediaActive: false })),
    history: [],
    // Captured rather than discarded: what counts as "activity" is a listener decision, and a
    // harness that throws the listener away can only assert it from source.
    listeners: { onUpdated: [], onActivated: [], onCreated: [], onRemoved: [] },
  };
  const capture = (bucket) => ({ addListener(fn) { state.listeners[bucket].push(fn); } });
  const sandbox = {
    console,
    Date,
    URL,
    setTimeout,
    clearTimeout,
    Number,
    Math,
    Object,
    Array,
    Promise,
    String,
    __WARDENONE_TEST__: true,
    globalThis: null,
    chrome: {
      alarms: {
        create(name, info) { state.alarmsCreated.push({ name, info }); },
        async clear(name) { state.alarmsCleared.push(name); return true; },
      },
      runtime: { lastError: null },
      tabs: {
        onActivated: capture('onActivated'),
        onUpdated: capture('onUpdated'),
        onCreated: capture('onCreated'),
        onRemoved: capture('onRemoved'),
        query: async () => state.tabs.slice(),
        discard: async (id) => { state.discarded.push(id); },
        remove: async (id) => { state.removed.push(id); },
        sendMessage(tabId, _msg, callback) {
          const reply = state.liveReply(tabId);
          // `undefined` models a bridge that never answers: the callback simply never runs and the
          // timeout is what resolves it, which is the shape a hung tab actually has.
          if (reply === undefined) return;
          if (reply && reply.__lastError) {
            sandbox.chrome.runtime.lastError = { message: reply.__lastError };
            try { if (callback) callback(undefined); } finally { sandbox.chrome.runtime.lastError = null; }
            return;
          }
          if (reply && reply.__throw) throw new Error('send failed');
          if (callback) callback(reply);
        },
      },
      windows: {
        WINDOW_ID_NONE: -1,
        onFocusChanged: { addListener },
        get: async () => ({ type: 'normal' }),
        getAll: async () => [],
      },
      notifications: { create() {} },
    },
    localGet: async () => ({ wardenone_config: state.config }),
    normalizeAllowlistHosts(list) {
      return Array.isArray(list) ? list.map((h) => String(h).toLowerCase()) : [];
    },
    hostMatchesAllowlist(host, list) {
      const h = String(host || '').toLowerCase();
      return (list || []).some((item) => h === item || h.endsWith('.' + item));
    },
    isVideoPlatformHost(host) {
      const h = String(host || '').replace(/^www\./, '').toLowerCase();
      return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'twitch.tv' || h.endsWith('.twitch.tv');
    },
    queueHistory(entry) { state.history.push(entry); },
    tabsGet: async (id) => state.tabs.find((t) => t.id === id) || null,
    extensionUiAllowed: async () => true,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('background-memory.js', 'utf8'), sandbox, { filename: 'background-memory.js' });
  return { memory: sandbox.__woMemoryTest, sandbox, state };
}

async function main() {
  const { memory, sandbox } = loadMemoryShield();
  assert(memory, 'test hooks should be exposed');
  [
    'getMemoryConfig',
    'memorySweep',
    'freeRamNow',
    'findDuplicateTabs',
    'closeDuplicateTabs',
    'memoryScore',
    'listHeavyTabs',
    'listMemoryTabs',
    'listZombieTabs',
    'sleepIdleGroups',
    'throttleInactiveTabs',
    'memoryActOnTab',
  ].forEach((name) => {
    assert.strictEqual(typeof sandbox[name], 'function', name + ' should be available to background.js');
  });

  const cfg = Object.assign({}, memory.MEMORY_DEFAULTS, {
    _allowlist: ['trusted.example'],
    _minutes: 30,
    _mode: 'balanced',
  });

  assert.strictEqual(memory.tabKeepReason({ id: 1, active: true, url: 'https://example.com' }, cfg), 'active tab');
  assert.strictEqual(memory.tabKeepReason({ id: 2, pinned: true, url: 'https://example.com' }, cfg), 'pinned');
  assert.strictEqual(memory.tabKeepReason({ id: 3, audible: true, url: 'https://example.com' }, cfg), 'playing audio');
  assert.strictEqual(memory.tabKeepReason({ id: 4, url: 'chrome://extensions' }, cfg), 'browser/internal page');
  assert.strictEqual(memory.tabKeepReason({ id: 5, url: 'https://bank.example/login' }, cfg), 'login/payment page');
  assert.strictEqual(memory.tabKeepReason({ id: 6, url: 'https://app.trusted.example/work' }, cfg), 'allowlisted');
  assert.strictEqual(memory.tabKeepReason({ id: 7, url: 'https://www.youtube.com/watch?v=abc' }, cfg), 'video/live playback site');
  assert.strictEqual(memory.tabKeepReason({ id: 8, url: 'https://ordinary.example/page' }, cfg), null);

  const now = Date.now();
  const pressure = memory.tabMemoryPressure({
    id: 9,
    windowId: 1,
    url: 'https://docs.google.com/document/d/123',
    title: 'Project doc',
    lastAccessed: now - 2 * 60 * 60 * 1000,
  }, cfg, now);
  assert.strictEqual(pressure.sleepable, true);
  assert.strictEqual(pressure.impact, 'High');
  assert(pressure.reasons.includes('known heavy site'));

  let active = 0;
  let maxActive = 0;
  const values = Array.from({ length: 12 }, (_, i) => i + 1);
  const doubled = await memory.mapLimited(values, 4, async (value) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  assert.deepStrictEqual(Array.from(doubled), values.map((value) => value * 2));
  assert(maxActive <= 4, 'mapLimited should cap active workers at 4');

  await testRecencySurvivesRestart();
  await testUnknownLiveStateKeepsTheTab();
  await testSweepAlarmFollowsTheSetting();

  console.log('[ok] memory shield tests passed');
}

// ---------------------------------------------------------------------------
// M19 failure 1 -- scheduled ageing used to restart from "now".
//
// tabActivity is heap-only and MV3 restarts the worker constantly; the sweep alarm is itself what
// wakes a fresh one. Reading only that map meant a cold sweep saw nothing, assumed every tab had
// just been used, and never reached the threshold -- while returning {ok:true, slept:0}, so it
// looked like there was simply nothing to do.
// ---------------------------------------------------------------------------
const MINUTE = 60000;

function sleepableTab(id, ageMinutes, extra) {
  return Object.assign({
    id,
    url: 'https://ordinary.example/page' + id,
    windowId: 1,
    lastAccessed: Date.now() - ageMinutes * MINUTE,
  }, extra || {});
}

async function testRecencySurvivesRestart() {
  const enabled = { memoryShield: true, memoryMode: 'balanced' };

  // A cold worker: nothing in tabActivity at all, a tab last touched two hours ago.
  const cold = loadMemoryShield({ config: enabled, tabs: [sleepableTab(1, 120)] });
  assert.deepStrictEqual(Object.keys(cold.memory.tabActivity), [],
    'the harness should start with an empty in-memory activity map, like a fresh worker');
  const swept = await cold.sandbox.memorySweep('alarm');
  assert.strictEqual(swept.ok, true);
  assert.strictEqual(swept.slept, 1,
    'a cold sweep did not sleep a tab that Chrome says was last used two hours ago');
  assert.deepStrictEqual(Array.from(cold.state.discarded), [1]);

  // A recently used tab must still be left alone.
  const fresh = loadMemoryShield({ config: enabled, tabs: [sleepableTab(2, 3)] });
  assert.strictEqual((await fresh.sandbox.memorySweep('alarm')).slept, 0,
    'a tab used three minutes ago was slept under a thirty-minute threshold');

  // In-memory activity that is NEWER than Chrome's must win. Chrome does not count a background
  // navigation as an access, so preferring lastAccessed outright would sleep a tab being used.
  const busy = loadMemoryShield({ config: enabled, tabs: [sleepableTab(3, 120)] });
  busy.memory.tabActivity[3] = Date.now() - 2 * MINUTE;
  assert.strictEqual((await busy.sandbox.memorySweep('alarm')).slept, 0,
    'in-memory activity newer than tab.lastAccessed was ignored');

  // ...and the reverse: a stale in-memory stamp must not shield a tab Chrome knows is old.
  const stale = loadMemoryShield({ config: enabled, tabs: [sleepableTab(4, 120)] });
  stale.memory.tabActivity[4] = Date.now() - 200 * MINUTE;
  assert.strictEqual((await stale.sandbox.memorySweep('alarm')).slept, 1,
    'the newer of the two timestamps was not used');

  // The helper itself, stated directly.
  const now = Date.now();
  assert.strictEqual(cold.memory.tabLastUsedOrNull({ id: 999 }), null,
    'a tab with no timestamp anywhere should report unknown, not a number');
  assert.strictEqual(cold.memory.tabLastUsed({ id: 999 }, now), now,
    'unknown age should fall back to now, so an unknown tab is never slept for being old');
  assert.strictEqual(cold.memory.tabLastUsed({ id: 999, lastAccessed: now - 5000 }, now), now - 5000);

  // A tab that only changed its title must not have its age erased. Plenty of background tabs
  // retitle themselves on a timer, and the old seed fired once per service-worker restart -- and
  // because the seed is the newer of the two values, it beat Chrome's real answer.
  const seeded = loadMemoryShield({ config: enabled, tabs: [sleepableTab(5, 120)] });
  assert(seeded.state.listeners.onUpdated.length, 'no onUpdated listener was registered');
  seeded.state.listeners.onUpdated.forEach((fn) => fn(5, { title: 'New messages (3)' }));
  assert.strictEqual((await seeded.sandbox.memorySweep('alarm')).slept, 1,
    'a title change re-aged a tab that was never actually used');

  // A real navigation still counts as activity, or the fix would have removed the signal instead
  // of the noise.
  const navigated = loadMemoryShield({ config: enabled, tabs: [sleepableTab(6, 120)] });
  navigated.state.listeners.onUpdated.forEach((fn) => fn(6, { status: 'loading' }));
  assert.strictEqual((await navigated.sandbox.memorySweep('alarm')).slept, 0,
    'a navigation in a background tab was not treated as activity');
}

// ---------------------------------------------------------------------------
// M19 failure 2 -- an unavailable bridge used to be classified as a clean tab.
//
// Every way of failing resolved to {formDirty:false, mediaActive:false}, which every caller read as
// "checked it, and it is safe". Discarding reloads a tab, so that is how unsaved work is lost, and
// the popup promises without qualification that such tabs are never touched.
// ---------------------------------------------------------------------------
const UNREACHABLE = { __lastError: 'Could not establish connection. Receiving end does not exist.' };
const NEVER_ANSWERS = undefined;
const MALFORMED = 'not an object';
const THROWS = { __throw: true };

async function testUnknownLiveStateKeepsTheTab() {
  const enabled = { memoryShield: true, memoryMode: 'balanced' };
  const cases = [
    ['the receiving end does not exist', () => UNREACHABLE],
    ['the tab never answers', () => NEVER_ANSWERS],
    ['the reply is malformed', () => MALFORMED],
    ['sending throws', () => THROWS],
  ];

  for (const [label, liveReply] of cases) {
    const sweep = loadMemoryShield({ config: enabled, tabs: [sleepableTab(1, 120)], liveReply });
    assert.strictEqual((await sweep.sandbox.memorySweep('alarm')).slept, 0,
      'the scheduled sweep discarded a tab when ' + label);
    assert.deepStrictEqual(Array.from(sweep.state.discarded), [],
      'the scheduled sweep discarded a tab when ' + label);

    const free = loadMemoryShield({ config: enabled, tabs: [sleepableTab(1, 120)], liveReply });
    const freed = await free.sandbox.freeRamNow();
    assert.strictEqual(freed.slept, 0, 'Free RAM Now discarded a tab when ' + label);
    assert.strictEqual(freed.kept, 1, 'Free RAM Now did not report the tab it kept when ' + label);
    assert(Object.keys(freed.keptReasons).some((r) => /check/i.test(r)),
      'Free RAM Now kept the tab without saying it could not check it: ' + JSON.stringify(freed.keptReasons));

    const group = loadMemoryShield({
      config: enabled,
      tabs: [sleepableTab(1, 120, { groupId: 7 }), sleepableTab(2, 120, { groupId: 7 })],
      liveReply,
    });
    group.sandbox.chrome.tabGroups = {};
    assert.strictEqual((await group.sandbox.sleepIdleGroups()).sleptTabs, 0,
      'group sleeping discarded a tab when ' + label);

    const manual = loadMemoryShield({ config: enabled, tabs: [sleepableTab(1, 600)], liveReply });
    const acted = await manual.sandbox.memoryActOnTab(1, 'close');
    assert.strictEqual(acted.ok, false, 'a manual close went ahead when ' + label);
    assert(/check/i.test(acted.error || ''), 'the refusal did not say why: ' + acted.error);
    assert.deepStrictEqual(Array.from(manual.state.removed), [],
      'a manual close removed the tab when ' + label);
  }

  // The other half of the contract: a tab that answers cleanly must still be slept, or the fix
  // would have "worked" by disabling the feature.
  const clean = loadMemoryShield({
    config: enabled,
    tabs: [sleepableTab(1, 120)],
    liveReply: () => ({ formDirty: false, mediaActive: false }),
  });
  assert.strictEqual((await clean.sandbox.memorySweep('alarm')).slept, 1,
    'a verified-clean tab was not slept');

  // And the answers that mean "keep" still mean keep.
  for (const [why, reply] of [
    ['unsaved form input', { formDirty: true, mediaActive: false }],
    ['camera or mic in use', { formDirty: false, mediaActive: true }],
  ]) {
    const held = loadMemoryShield({ config: enabled, tabs: [sleepableTab(1, 120)], liveReply: () => reply });
    assert.strictEqual((await held.sandbox.memorySweep('alarm')).slept, 0, 'slept a tab with ' + why);
  }

  // The shape itself, so a caller cannot mistake "no answer" for "clean" again.
  const probe = loadMemoryShield({ config: enabled, liveReply: () => UNREACHABLE });
  const unknownState = await probe.memory.tabLiveState(1);
  assert.strictEqual(unknownState.ok, false, 'an unreachable bridge reported a successful check');
  const okState = await loadMemoryShield({ liveReply: () => ({ formDirty: true, mediaActive: false }) })
    .memory.tabLiveState(1);
  assert.strictEqual(okState.ok, true);
  assert.strictEqual(okState.formDirty, true);
}

// ---------------------------------------------------------------------------
// The five-minute wake-up should exist only while the feature that needs it does.
// ---------------------------------------------------------------------------
async function testSweepAlarmFollowsTheSetting() {
  const on = loadMemoryShield({ config: { memoryShield: true } });
  on.state.alarmsCreated.length = 0;
  assert.strictEqual(await on.memory.reconcileMemorySweepAlarm(), true);
  assert(on.state.alarmsCreated.some((a) => a.name === on.memory.MEMORY_SWEEP_ALARM),
    'the sweep alarm was not created while Memory Shield is on');

  const off = loadMemoryShield({ config: { memoryShield: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Loading is itself a reconcile, which is what clears an alarm left behind by a previous run.
  assert(off.state.alarmsCleared.includes(off.memory.MEMORY_SWEEP_ALARM),
    'starting up with Memory Shield off did not clear a leftover sweep alarm');
  off.state.alarmsCreated.length = 0;
  off.state.alarmsCleared.length = 0;
  assert.strictEqual(await off.memory.reconcileMemorySweepAlarm(), false);
  assert.deepStrictEqual(Array.from(off.state.alarmsCleared), [off.memory.MEMORY_SWEEP_ALARM],
    'turning Memory Shield off left the five-minute wake-up running');
  assert(!off.state.alarmsCreated.some((a) => a.name === off.memory.MEMORY_SWEEP_ALARM),
    'the sweep alarm was created even though Memory Shield is off');

  // An unreadable config must not quietly uninstall a feature the user turned on.
  const broken = loadMemoryShield({ config: { memoryShield: true } });
  broken.sandbox.localGet = async () => { throw new Error('storage unavailable'); };
  broken.state.alarmsCleared.length = 0;
  assert.strictEqual(await broken.memory.reconcileMemorySweepAlarm(), true);
  assert.deepStrictEqual(Array.from(broken.state.alarmsCleared), [],
    'a storage failure cleared the sweep alarm');

  // background.js must actually re-run this when the setting changes, or the reconcile only ever
  // happens at start-up and toggling the feature off does nothing until the next restart.
  const background = fs.readFileSync('background.js', 'utf8');
  assert(/o\.memoryShield !== n\.memoryShield[\s\S]{0,160}reconcileMemorySweepAlarm\(\)/.test(background),
    'background.js does not reconcile the sweep alarm when the setting changes');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

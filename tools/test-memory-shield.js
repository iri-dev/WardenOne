const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function addListener() {}

function loadMemoryShield() {
  const sandbox = {
    console,
    Date,
    URL,
    setTimeout,
    clearTimeout,
    __WEBWARDEN_TEST__: true,
    globalThis: null,
    chrome: {
      alarms: { create() {} },
      runtime: { lastError: null },
      tabs: {
        onActivated: { addListener },
        onUpdated: { addListener },
        onCreated: { addListener },
        onRemoved: { addListener },
        query: async () => [],
        discard: async () => {},
        remove: async () => {},
        sendMessage(_tabId, _msg, callback) {
          if (callback) callback({ formDirty: false, mediaActive: false });
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
    localGet: async () => ({ webwarden_config: {} }),
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
    queueHistory() {},
    tabsGet: async () => null,
    extensionUiAllowed: async () => true,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('background-memory.js', 'utf8'), sandbox, { filename: 'background-memory.js' });
  return { memory: sandbox.__wwMemoryTest, sandbox };
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

  console.log('[ok] memory shield tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

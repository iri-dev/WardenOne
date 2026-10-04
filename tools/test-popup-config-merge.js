/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// The popup holds its own copy of the config for as long as it is open. It used to
// write that whole copy back on every save, so anything another surface changed in
// the meantime was silently reverted -- and the shortest path to it was entirely
// inside one surface: open the popup, run Repair (background writes a cleaned,
// defaults-restored config), then flip any switch and the repair was gone.
//
// These tests drive the real popup.js functions against a fake chrome.storage so the
// merge behaviour is asserted, not just the presence of a read-modify-write.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

// popup.js is a top-level script that wires itself to the DOM on load. We only want
// its config-merge core, so lift the functions under test plus the two declarations
// they close over, and run them in isolation.
function lift(names) {
  const out = [];
  for (const name of names) {
    const patterns = [
      new RegExp('^function ' + name + '\\(', 'm'),
      new RegExp('^let ' + name + '\\b', 'm'),
      new RegExp('^const ' + name + '\\b', 'm'),
    ];
    let start = -1;
    for (const re of patterns) {
      const m = re.exec(POPUP_JS);
      if (m) { start = m.index; break; }
    }
    assert(start >= 0, 'popup.js no longer declares ' + name);
    if (!/^function /.test(POPUP_JS.slice(start))) {
      // simple declaration: take through the end of the statement
      const end = POPUP_JS.indexOf('\n', start);
      out.push(POPUP_JS.slice(start, end));
      continue;
    }
    let depth = 0;
    let seen = false;
    for (let i = start; i < POPUP_JS.length; i++) {
      const ch = POPUP_JS[i];
      if (ch === '{') { depth++; seen = true; } else if (ch === '}') {
        depth--;
        if (seen && depth === 0) { out.push(POPUP_JS.slice(start, i + 1)); break; }
      }
    }
  }
  return out.join('\n\n');
}

const LIFTED = lift([
  'configClone',
  'configValuesDiffer',
  'popupChangedKeys',
  'persistConfig',
  'adoptExternalConfigChange',
]);

// The shipped DEFAULTS, so the merge is exercised against the real key set.
const defaultsStart = POPUP_JS.indexOf('const DEFAULTS = {');
assert(defaultsStart >= 0, 'popup.js no longer declares DEFAULTS');
let depth = 0;
let defaultsEnd = -1;
for (let i = defaultsStart; i < POPUP_JS.length; i++) {
  const ch = POPUP_JS[i];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { defaultsEnd = i + 1; break; } }
}
const DEFAULTS_SRC = POPUP_JS.slice(defaultsStart, defaultsEnd) + ';';

function makeHarness(storedConfig) {
  const store = { wardenone_config: storedConfig ? JSON.parse(JSON.stringify(storedConfig)) : undefined };
  const pending = [];
  const chrome = {
    runtime: { lastError: undefined, id: 'x' },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach((k) => { if (store[k] !== undefined) out[k] = JSON.parse(JSON.stringify(store[k])); });
          pending.push(() => cb(out));
        },
        set(items, cb) {
          Object.keys(items).forEach((k) => { store[k] = JSON.parse(JSON.stringify(items[k])); });
          pending.push(() => cb && cb());
        },
      },
    },
  };
  const sandbox = {
    chrome, console, JSON, Object, Array, Set, String, Number, Boolean,
    // popup.js's real helper; disabled providers retain keys for explicit manual checks.
    normalizeStoredProviderKeys(cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      const map = {
        downloadSafeBrowsing: 'downloadSafeBrowsingKey',
        downloadVirusTotal: 'downloadVirusTotalKey',
        urlHaus: 'urlHausKey',
        abuseIpDb: 'abuseIpDbKey',
        phishTank: 'phishTankKey',
        whoisXml: 'whoisXmlKey',
      };
      for (const provider of Object.keys(map)) {
        cfg[map[provider]] = String(cfg[map[provider]] || '').trim();
      }
    },
    // adoptExternalConfigChange touches the DOM only to find text fields; there are
    // none in this harness, so every non-text key is eligible.
    document: { querySelectorAll: () => [] },
    KEYS: [],
    repaintExternalConfigKeys: () => {},
    updateMasterState: () => {},
    reflectMasterDisable: () => {},
    reflectSilentMode: () => {},
    syncBreachVisibility: () => {},
    $: () => null,
  };
  const ctx = vm.createContext(sandbox);
  /* A synchronous stand-in for withConfigLock (config-lock.js): this suite runs storage callbacks
     by hand, and what it tests is the merge. It counts every take and release, so a save that
     keeps the lock shows up below. The real lock, across pages and the worker, is exercised in
     Edge by tools/browser-config-race.js. */
  /* The real save record (stampConfigWrite, WO_CONFIG_WRITES_KEY) from config-lock.js; the lock and
     the later check are stand-ins, the check recording what it was asked so a test can run it. */
  vm.runInContext(require('./config-write-harness.js').LOCK_SOURCE, ctx, { filename: 'config-lock.js' });
  vm.runInContext('globalThis.__lock = { taken: 0, released: 0 };'
    + 'function withConfigLock(task) { __lock.taken++; const held = task(); held.then(() => { __lock.released++; }); return held; }'
    + 'globalThis.__confirms = []; function confirmConfigWrite(id, again, left) { __confirms.push({ id, again, left }); }', ctx);
  vm.runInContext(DEFAULTS_SRC + '\nlet config = Object.assign({}, DEFAULTS);\nlet savedConfigSnapshot;\n' + LIFTED, ctx);
  // Mirror load(): config is DEFAULTS + stored, and the snapshot is what storage holds.
  vm.runInContext(
    'if (' + JSON.stringify(!!storedConfig) + ') config = Object.assign({}, DEFAULTS, ' + JSON.stringify(storedConfig || {}) + ');'
    + '\nsavedConfigSnapshot = configClone(config);',
    ctx
  );
  const drain = () => { while (pending.length) pending.shift()(); };
  return {
    ctx, store, drain,
    run: (src) => vm.runInContext(src, ctx),
    get config() { return vm.runInContext('config', ctx); },
  };
}

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name);
}

// ---------------------------------------------------------------------------
// 1. The reported bug: an external write landing while the popup is open must
//    survive the popup's next save.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ blockTrackers: false, adShield: false, forceHttps: false });

  // Another surface (Repair / onboarding / the options page) turns two things on.
  h.store.wardenone_config = Object.assign({}, h.store.wardenone_config, {
    blockTrackers: true,
    forceHttps: true,
  });

  // The user flips one unrelated switch in the popup and it auto-saves.
  h.run('config.adShield = true; persistConfig(function (adopted) { globalThis.__adopted = adopted; });');
  h.drain(); h.drain();

  const stored = h.store.wardenone_config;
  check('the popup\'s own change is written', stored.adShield === true);
  check('a concurrent writer\'s blockTrackers survives', stored.blockTrackers === true);
  check('a concurrent writer\'s forceHttps survives', stored.forceHttps === true);
  const adopted = h.run('globalThis.__adopted');
  check('the adopted keys are reported back to the caller',
    adopted.indexOf('blockTrackers') >= 0 && adopted.indexOf('forceHttps') >= 0);
  check('config now matches storage, so the next save is not stale',
    h.config.blockTrackers === true && h.config.forceHttps === true && h.config.adShield === true);
}

// ---------------------------------------------------------------------------
// 2. A second save must not resurrect the pre-merge snapshot.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ blockTrackers: false, adShield: false });
  h.store.wardenone_config = Object.assign({}, h.store.wardenone_config, { blockTrackers: true });
  h.run('config.adShield = true; persistConfig(function () {});');
  h.drain(); h.drain();
  h.run('config.removeOverlays = false; persistConfig(function () {});');
  h.drain(); h.drain();
  check('blockTrackers still true after a second save', h.store.wardenone_config.blockTrackers === true);
  check('the second change is written', h.store.wardenone_config.removeOverlays === false);
}

// ---------------------------------------------------------------------------
// 3. The user's own edit must win over a concurrent writer touching the same key.
//    Losing the change the user just made would be a worse bug than the one fixed.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ blockTrackers: true });
  h.run('config.blockTrackers = false;');            // user turns it off, not yet saved
  h.store.wardenone_config = { blockTrackers: true }; // external writer turns it on
  h.run('persistConfig(function () {});');
  h.drain(); h.drain();
  check('the user\'s pending change beats the concurrent writer',
    h.store.wardenone_config.blockTrackers === false);
}

// ---------------------------------------------------------------------------
// 4. Missing defaults are still restored, so the stored object stays complete.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ blockTrackers: true });
  h.run('config.adShield = true; persistConfig(function () {});');
  h.drain(); h.drain();
  const stored = h.store.wardenone_config;
  const defaults = h.run('DEFAULTS');
  const missing = Object.keys(defaults).filter((k) => !(k in stored));
  check('every default key is present in the written config (' + Object.keys(defaults).length + ' keys)',
    missing.length === 0);
}

// ---------------------------------------------------------------------------
// 5. A write failure must leave the snapshot alone, so the pending change is
//    retried rather than treated as saved.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ adShield: false });
  h.run('chrome.storage.local.set = function (items, cb) { chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" }; cb(); chrome.runtime.lastError = undefined; };');
  h.run('config.adShield = true; globalThis.__err = null; persistConfig(function () { globalThis.__saved = true; }, function (e) { globalThis.__err = e; });');
  h.drain(); h.drain();
  check('the error callback fires on a failed write', !!h.run('globalThis.__err'));
  check('onSaved does not fire on a failed write', h.run('globalThis.__saved') === undefined);
  check('the change is still pending after a failed write',
    h.run('popupChangedKeys().indexOf("adShield") >= 0'));
}

// ---------------------------------------------------------------------------
// 6. Corrupted storage must not be merged in as-is.
// ---------------------------------------------------------------------------
{
  for (const junk of ['not-an-object', 42, ['a', 'b'], null]) {
    const h = makeHarness({ adShield: false });
    h.store.wardenone_config = junk;
    h.run('config.adShield = true; persistConfig(function () {});');
    h.drain(); h.drain();
    const stored = h.store.wardenone_config;
    check('corrupted storage (' + JSON.stringify(junk) + ') is replaced with defaults + the change',
      stored && typeof stored === 'object' && !Array.isArray(stored) && stored.adShield === true);
  }
}

// ---------------------------------------------------------------------------
// 7. adoptExternalConfigChange keeps config honest without eating pending edits.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ blockTrackers: false, adShield: false });
  h.run('config.adShield = true;'); // pending, unsaved
  h.run('adoptExternalConfigChange({ blockTrackers: true, adShield: false });');
  check('an untouched key is adopted from the external change', h.config.blockTrackers === true);
  check('a pending edit is not overwritten by the external change', h.config.adShield === true);
  check('the adopted key is no longer reported as a popup change',
    h.run('popupChangedKeys().indexOf("blockTrackers") < 0'));
  check('the pending edit is still reported as a popup change',
    h.run('popupChangedKeys().indexOf("adShield") >= 0'));
  h.run('adoptExternalConfigChange("junk"); adoptExternalConfigChange(null); adoptExternalConfigChange([1,2]);');
  check('malformed external values are ignored', h.config.blockTrackers === true);
}

// ---------------------------------------------------------------------------
// 8. Object and array values must diff by content, not identity, or host-scoped
//    EyeShield maps and the allowlist would be written on every single save.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ allowlist: ['a.com'], eyeShieldBrightnessByHost: { 'a.com': 80 } });
  check('an unchanged array is not reported as a change',
    h.run('popupChangedKeys().indexOf("allowlist") < 0'));
  check('an unchanged object is not reported as a change',
    h.run('popupChangedKeys().indexOf("eyeShieldBrightnessByHost") < 0'));
  h.run('config.allowlist = config.allowlist.concat(["b.com"]);');
  check('a mutated array is reported as a change',
    h.run('popupChangedKeys().indexOf("allowlist") >= 0'));
  h.run('persistConfig(function () {});');
  h.drain(); h.drain();
  check('the allowlist change is written',
    h.store.wardenone_config.allowlist.join(',') === 'a.com,b.com');
  check('the snapshot is a copy, not a live reference to config',
    h.run('config.allowlist.push("c.com"), savedConfigSnapshot.allowlist.length === 2'));
}

// ---------------------------------------------------------------------------
// 9. Guard against a regression to the whole-object write.
// ---------------------------------------------------------------------------
{
  const writes = POPUP_JS.match(/storage\.local\.set\(\{\s*wardenone_config:/g) || [];
  check('exactly one place writes wardenone_config (inside persistConfig)', writes.length === 1);
  check('and it reads and writes under the config lock',
    /function persistConfig[\s\S]{0,900}withConfigLock\(/.test(POPUP_JS));
  check('that write uses the merged object, not the popup\'s copy, with its save record beside it',
    /storage\.local\.set\(\{\s*wardenone_config:\s*next,\s*\[WO_CONFIG_WRITES_KEY\]:\s*stamp\.record\s*\}/.test(POPUP_JS));
  check('and asks to be confirmed once the lock is let go',
    /release\(\);\s*\}\s*if \(typeof onSaved === 'function'\) onSaved\(adopted\);\s*confirmConfigWrite\(writeId,/.test(POPUP_JS));
  check('persistConfig re-reads storage before writing',
    /function persistConfig[\s\S]{0,1500}storage\.local\.get\(\['wardenone_config'/.test(POPUP_JS));
  check('saveConfig routes through persistConfig',
    /function saveConfig[\s\S]{0,200}persistConfig\(/.test(POPUP_JS));
  check('the popup adopts external config changes',
    /changes\.wardenone_config\)\s*adoptExternalConfigChange/.test(POPUP_JS));
}


// ---------------------------------------------------------------------------
// 11. A private window has its own lock, so a save there can land over this one without having
//     read it. The save is then made again: the same keys and values, on what is stored now, and
//     the popup's own copy -- which already counts them as saved -- is left alone.
// ---------------------------------------------------------------------------
{
  const h = makeHarness({ adShield: false, blockTrackers: true });
  h.run('config.adShield = true; persistConfig(function () {});');
  h.drain(); h.drain();
  check('a save asks to be confirmed, with its own id',
    h.run('__confirms.length === 1 && typeof __confirms[0].again === "function" && /^[0-9a-z]{8,}$/.test(__confirms[0].id)'));
  check('and records that id beside the config',
    !!h.store.wardenone_config_writes && h.store.wardenone_config_writes.ids[0] === h.run('__confirms[0].id'));
  /* A private window writes over it without having read it, then the popup gets a new pending edit. */
  h.store.wardenone_config = Object.assign({}, h.store.wardenone_config, { adShield: false, forceHttps: true });
  h.store.wardenone_config_writes = { ids: ['someone-else'] };
  h.run('config.removeOverlays = false;');
  h.run('__confirms[0].again(1);');
  h.drain(); h.drain();
  check('the retry makes the same change again', h.store.wardenone_config.adShield === true);
  check('on top of what the other window wrote', h.store.wardenone_config.forceHttps === true);
  check('and only that change, not an edit made since', h.store.wardenone_config.removeOverlays !== false);
  check('it is recorded as following the other window\'s save', h.store.wardenone_config_writes.ids[1] === 'someone-else');
  check('and asks to be confirmed in turn, with one try fewer', h.run('__confirms.length === 2 && __confirms[1].left === 1'));
  check('the popup\'s own copy is left alone by the retry', h.run('config.removeOverlays === false'));
}

// ---------------------------------------------------------------------------
// 10. A read that fails is not an empty config: nothing is written, the caller hears of it, and
//     the change stays pending. Every save, whatever happens, lets the config lock go.
// ---------------------------------------------------------------------------
const lockChecks = (async () => {
  const harnesses = [];
  {
    const h = makeHarness({ adShield: false, blockTrackers: true });
    harnesses.push(['a save that writes', h]);
    h.run('config.adShield = true; persistConfig(function () {});');
    h.drain(); h.drain();
  }
  {
    const h = makeHarness({ adShield: false });
    harnesses.push(['a save whose write fails', h]);
    h.run('chrome.storage.local.set = function (items, cb) { chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" }; cb(); chrome.runtime.lastError = undefined; };');
    h.run('config.adShield = true; persistConfig(function () {}, function () {});');
    h.drain(); h.drain();
  }
  {
    const h = makeHarness({ adShield: false, blockTrackers: true });
    harnesses.push(['a save whose read fails', h]);
    h.run('chrome.storage.local.get = function (keys, cb) { chrome.runtime.lastError = { message: "read failed" }; cb(undefined); chrome.runtime.lastError = undefined; };');
    h.run('globalThis.__err = null; globalThis.__wrote = false; var __set = chrome.storage.local.set; chrome.storage.local.set = function (i, cb) { globalThis.__wrote = true; __set(i, cb); };');
    h.run('config.adShield = true; persistConfig(function () { globalThis.__saved = true; }, function (e) { globalThis.__err = e; });');
    h.drain(); h.drain();
    check('a failed read writes nothing over the stored config', h.run('globalThis.__wrote') === false && h.store.wardenone_config.blockTrackers === true);
    check('and the caller is told', !!h.run('globalThis.__err') && h.run('globalThis.__saved') === undefined);
    check('and the change is still pending', h.run('popupChangedKeys().indexOf("adShield") >= 0'));
  }
  {
    const h = makeHarness({ adShield: false });
    harnesses.push(['a save that throws while merging', h]);
    h.run('normalizeStoredProviderKeys = function () { throw new Error("boom"); }; globalThis.__err = null;');
    h.run('config.adShield = true; persistConfig(function () {}, function (e) { globalThis.__err = e; });');
    h.drain(); h.drain();
    check('a merge that throws is reported, not swallowed', !!h.run('globalThis.__err'));
  }
  await new Promise((resolve) => setImmediate(resolve));
  for (const [name, h] of harnesses) {
    const lock = h.run('__lock');
    check(name + ' lets the config lock go (' + lock.taken + ' taken, ' + lock.released + ' released)', lock.taken === 1 && lock.released === 1);
  }
})();

lockChecks.then(() => {
  if (failures) {
    console.error('[fail] popup config merge tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] popup config merge tests');
}, (error) => { console.error(error); process.exit(1); });

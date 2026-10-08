/* Every write of wardenone_config holds the config lock (config-lock.js).

   Writers used to read, merge and write on their own, and two that read at the same moment wrote
   over each other: fired together in Edge, a Settings change was lost in 20 of 40 tries and a
   notification mute in the worker in 34 of 40. Each write now sits inside withConfigLock(...),
   directly or through the worker's updateStoredConfig, whose own write is inside one. This finds
   every write of the config in every shipped script and fails on one outside the lock, so a new
   writer cannot quietly reopen the race. tools/browser-config-race.js proves the lock in Edge. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
const check = (label, ok) => { checks++; assert(ok === true, label); };

/* The source with comments and string, template and regex contents blanked to spaces, so brackets
   inside them cannot unbalance the count below. Offsets are kept, so positions still line up. */
function codeOnly(src) {
  const out = src.split('');
  let i = 0;
  let prevSignificant = '';
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const end = src.indexOf('\n', i); const to = end < 0 ? src.length : end; blank(i, to); i = to; continue; }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); const to = end < 0 ? src.length : end + 2; blank(i, to); i = to; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      blank(i + 1, k);
      i = k + 1; prevSignificant = c; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(prevSignificant)) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length && (inClass || src[k] !== '/') && src[k] !== '\n') {
        if (src[k] === '\\') k++;
        else if (src[k] === '[') inClass = true;
        else if (src[k] === ']') inClass = false;
        k++;
      }
      blank(i + 1, k);
      i = k + 1; prevSignificant = '/'; continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}


/* [start, end) of each withConfigLock( ... ) call's arguments. */
function lockedRanges(code) {
  const ranges = [];
  for (const m of code.matchAll(/\bwithConfigLock\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let k = open; k < code.length; k++) {
      if (code[k] === '(') depth++;
      else if (code[k] === ')' && --depth === 0) { ranges.push([open, k]); break; }
    }
  }
  return ranges;
}

const WRITE_RE = /\b(?:set|localSet|storageSet|localWrite|checkedLocalSet)\s*\(\s*\{\s*(?:wardenone_config|\[CONFIG_KEY\])\s*:/g;

/* The argument text of the call whose name ends at `at`. */
function callArgs(code, at) {
  const open = code.indexOf('(', at);
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '(') depth++;
    else if (code[k] === ')' && --depth === 0) return code.slice(open, k + 1);
  }
  return '';
}

function unlockedWrites(src) {
  const code = codeOnly(src);
  const ranges = lockedRanges(code);
  const writes = [];
  for (const m of code.matchAll(WRITE_RE)) {
    const line = code.slice(0, m.index).split('\n').length;
    writes.push({
      line,
      locked: ranges.some(([a, b]) => m.index > a && m.index < b),
      /* The save record goes in the same set() as the config, or a private window's write over it
         could not be told from one that saw it. The partial reset follows clear() directly. */
      stamped: /\bWO_CONFIG_WRITES_KEY\b/.test(callArgs(code, m.index)),
      afterClear: /storage\.local\.clear\(\)[\s\S]{0,400}$/.test(code.slice(Math.max(0, m.index - 400), m.index)),
    });
  }
  return writes;
}

/* The scanner itself: a locked write passes, an unlocked one is caught, and brackets in strings,
   comments and regexes do not hide one. */
{
  const locked = unlockedWrites("withConfigLock(async () => { const s = ')'; /* ) */ await localSet({ wardenone_config: c }); });");
  check('a write inside withConfigLock counts as locked', locked.length === 1 && locked[0].locked);
  const open = unlockedWrites("withConfigLock(() => x(/\\)/)); chrome.storage.local.set({ wardenone_config: next }, cb);");
  check('a write after the lock is let go is caught', open.length === 1 && !open[0].locked);
  const configKey = unlockedWrites('await localWrite({ [CONFIG_KEY]: next });');
  check('a write by the Settings key constant is found too', configKey.length === 1 && !configKey[0].locked);
  const bare = unlockedWrites('withConfigLock(async () => { await localSet({ wardenone_config: c }); });');
  const recorded = unlockedWrites('withConfigLock(async () => { await localSet({ wardenone_config: c, [WO_CONFIG_WRITES_KEY]: s.record }); });');
  check('a write without its save record is told from one with it', bare[0].stamped === false && recorded[0].stamped === true);
}

const packaged = JSON.parse(fs.readFileSync(path.join(root, 'tools/package-allowlist.json'), 'utf8'))
  .filter((f) => /\.js$/.test(f) && f !== 'content.min.js');
const found = [];
for (const file of packaged.concat(['src/content.js'])) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const w of unlockedWrites(fs.readFileSync(full, 'utf8'))) found.push(Object.assign({ file }, w));
}
const byFile = (name) => found.filter((w) => w.file === name).length;
/* The writers there are today, so a scanner that stopped seeing them fails instead of passing
   empty. The worker writes through updateStoredConfig and reset; config-lock.js repairs old saves
   after an erase and saves written over by a private window. */
for (const [file, count] of [['background.js', 2], ['config-lock.js', 2], ['settings.js', 1], ['popup.js', 1], ['history.js', 1], ['notifications.js', 1], ['onboarding.js', 1]]) {
  check(file + ' has its ' + count + ' config write(s) found, not ' + byFile(file), byFile(file) === count);
}
const updates = ['background.js', 'background-memory.js']
  .map((f) => (fs.readFileSync(path.join(root, f), 'utf8').match(/\bupdateStoredConfig\(/g) || []).length - (f === 'background.js' ? 1 : 0))
  .reduce((a, b) => a + b, 0);
check('the worker changes the config through updateStoredConfig (' + updates + ' callers)', updates >= 9);
const open = found.filter((w) => !w.locked);
check('every write of wardenone_config holds the config lock: '
  + (open.map((w) => w.file + ':' + w.line).join(', ') || 'none outside'), open.length === 0);

let overwriteChecks = Promise.resolve();

/* The lock does not reach a private window, so every write also records itself and checks back. */
const unstamped = found.filter((w) => !w.stamped && !w.afterClear);
check('every write stores its save record in the same set(): '
  + (unstamped.map((w) => w.file + ':' + w.line).join(', ') || 'all do'), unstamped.length === 0);
check('only the partial reset writes without a save record, straight after clearing the store',
  found.filter((w) => w.afterClear).map((w) => w.file).join() === 'background.js');
for (const file of ['background.js', 'settings.js', 'popup.js', 'history.js', 'notifications.js', 'onboarding.js']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const asks = (codeOnly(src).match(/\bconfirmConfigWrite\(/g) || []).length;
  check(file + ' checks back after its writes (' + asks + ')', asks >= 1);
}
{
  const lock = fs.readFileSync(path.join(root, 'config-lock.js'), 'utf8');
  check('config-lock.js records saves beside the config, not in it',
    /const WO_CONFIG_WRITES_KEY = 'wardenone_config_writes';/.test(lock) && /function stampConfigWrite\(/.test(lock) && /function confirmConfigWrite\(/.test(lock));
  check('every context that loads config-lock.js repairs a write that landed over another',
    /onChanged\.addListener\([\s\S]*?repairOverwrittenConfig\(changes\)/.test(lock));
  check('save ancestry keeps delayed confirmations long enough to repair',
    /const WO_CONFIG_WRITES_KEPT = (\d+);/.test(lock) && Number(lock.match(/const WO_CONFIG_WRITES_KEPT = (\d+);/)[1]) >= 256);

  const orderStart = lock.indexOf("const WO_CONFIG_WRITES_KEY = 'wardenone_config_writes';");
  const orderEnd = lock.indexOf('/* A full erase leaves a random epoch.', orderStart);
  check('the ordering harness can lift the shipped confirmation functions', orderStart >= 0 && orderEnd > orderStart);
  const lifted = lock.slice(orderStart, orderEnd);
  function confirmation(ownOrder, currentRecord, ownKeys) {
    const timers = [];
    const retries = [];
    const sandbox = {
      Array, Date, Math, Number, Object, String, Uint8Array,
      crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1; return bytes; } },
      setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
      chrome: {
        runtime: { lastError: null },
        storage: { local: { get(_key, callback) { callback({ wardenone_config_writes: currentRecord }); } } },
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(lifted + '\nthis.__api={stampConfigWrite,confirmConfigWrite};', sandbox);
    const stamp = sandbox.__api.stampConfigWrite({ ids: [] }, ownKeys, ownOrder);
    sandbox.__api.confirmConfigWrite(stamp.id, (left) => retries.push(left), 2, ownKeys, stamp.order);
    check('a confirmation schedules its first ancestry check', timers.length === 1 && timers[0].delay === 300);
    timers.shift().fn();
    return { retries, stamp };
  }

  const delayedOlder = confirmation(200, { ids: ['older'], keys: ['deAmp'], order: 100 }, ['deAmp']);
  check('a delayed older same-key write cannot discard the newer edit',
    delayedOlder.retries.length === 1 && delayedOlder.retries[0] === 1);
  check('the supplied operation order is kept in the write record',
    delayedOlder.stamp.order === 200 && delayedOlder.stamp.record.order === 200);
  const genuinelyLater = confirmation(100, { ids: ['later'], keys: ['deAmp'], order: 200 }, ['deAmp']);
  check('a genuinely later same-key edit is not overwritten by reconciliation', genuinelyLater.retries.length === 0);
  const unrelated = confirmation(100, { ids: ['other'], keys: ['capReferrer'], order: 200 }, ['deAmp']);
  check('a missing edit is still recovered when the current write changed another key', unrelated.retries.length === 1);

  /* A write that lands after both looks are over. Held 2.1 s in Edge, a private write that had
     read before a regular change to another setting wrote that change away for good; the final
     stored config is what is checked here, not the record. */
  function overwriteHarness() {
    const state = { stored: {}, sets: 0, written: [] };
    let calls = 0;
    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
    const sandbox = {
      crypto: { getRandomValues(bytes) { calls++; for (let i = 0; i < bytes.length; i++) bytes[i] = (calls * 31 + i * 7) & 255; return bytes; } },
      setTimeout() { return 0; },
      /* No mutual exclusion here, which is what two lock domains (regular and private) give. */
      withConfigLock: (task) => Promise.resolve().then(task),
      chrome: { runtime: { lastError: null }, storage: { local: {
        async get(keys) {
          const out = {};
          for (const key of [].concat(keys)) if (key in state.stored) out[key] = clone(state.stored[key]);
          return out;
        },
        async set(items) { state.sets++; state.written.push(clone(items)); Object.assign(state.stored, clone(items)); },
      } } },
    };
    vm.createContext(sandbox);
    vm.runInContext(lifted + '\nthis.__api={stampConfigWrite,configOverwritePlan,repairOverwrittenConfig};', sandbox);
    const api = sandbox.__api;
    const read = () => ({ config: clone(state.stored.wardenone_config), record: clone(state.stored.wardenone_config_writes) });
    /* A writer's read-modify-write, made from `base` (what it read) and landed whenever it is. */
    const write = (base, keys, patch, order) => {
      const stamp = api.stampConfigWrite(base.record, keys, order);
      return { config: Object.assign({}, base.config, patch), record: clone(stamp.record) };
    };
    const land = (written) => {
      const changes = {
        wardenone_config: { oldValue: clone(state.stored.wardenone_config), newValue: clone(written.config) },
        wardenone_config_writes: { oldValue: clone(state.stored.wardenone_config_writes), newValue: clone(written.record) },
      };
      state.stored.wardenone_config = clone(written.config);
      state.stored.wardenone_config_writes = clone(written.record);
      return changes;
    };
    const plan = (changes) => {
      const p = api.configOverwritePlan(changes.wardenone_config_writes.oldValue, changes.wardenone_config_writes.newValue,
        changes.wardenone_config.oldValue, changes.wardenone_config.newValue);
      return p ? Array.from(p.restore) : null;
    };
    return { api, state, read, write, land, plan, config: () => state.stored.wardenone_config };
  }
  const json = (value) => JSON.stringify(value);

  overwriteChecks = Promise.resolve().then(async () => {
    {
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false, capReferrer: false } }, ['deAmp', 'capReferrer'], {}, 100));
      const stale = h.read();
      h.land(h.write(h.read(), ['deAmp'], { deAmp: true }, 200));
      const changes = h.land(h.write(stale, ['capReferrer'], { capReferrer: true }, 300));
      check('the late private write is caught with the regular change it wrote away', json(h.plan(changes)) === json(['deAmp']));
      await h.api.repairOverwrittenConfig(changes);
      check('a regular change to another setting survives a private write that lands after both looks',
        json(h.config()) === json({ deAmp: true, capReferrer: true }));
      const record = h.state.stored.wardenone_config_writes;
      check('the repaired config descends from both writes, so neither check-back replays',
        record.ids.includes(changes.wardenone_config_writes.oldValue.ids[0]) && record.ids.includes(changes.wardenone_config_writes.newValue.ids[0]));

      const beforeRepair = { config: changes.wardenone_config.newValue, record: changes.wardenone_config_writes.newValue };
      const over = h.land(h.write(beforeRepair, ['allowlist'], { allowlist: ['example.com'] }, 400));
      check('a write over the repair itself is caught in turn', json(h.plan(over)) === json(['deAmp']));
      await h.api.repairOverwrittenConfig(over);
      check('the restored change survives a second stale write',
        json(h.config()) === json({ deAmp: true, capReferrer: true, allowlist: ['example.com'] }));
      const sets = h.state.sets;
      await h.api.repairOverwrittenConfig(over);
      check('a repair already made is not made again', h.state.sets === sets);
    }
    {
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false } }, ['deAmp'], {}, 100));
      const stale = h.read();
      h.land(h.write(h.read(), ['deAmp'], { deAmp: true }, 300));
      const olderLanding = h.land(h.write(stale, ['deAmp'], { deAmp: false }, 200));
      check('a later edit to the same setting is put back over an older one that landed late', json(h.plan(olderLanding)) === json(['deAmp']));
      await h.api.repairOverwrittenConfig(olderLanding);
      check('the later same-setting edit is what stays stored', h.config().deAmp === true);
    }
    {
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false } }, ['deAmp'], {}, 100));
      const stale = h.read();
      h.land(h.write(h.read(), ['deAmp'], { deAmp: true }, 200));
      const laterLanding = h.land(h.write(stale, ['deAmp'], { deAmp: false }, 300));
      await h.api.repairOverwrittenConfig(laterLanding);
      check('a genuinely later edit to the same setting is not undone', json(h.plan(laterLanding)) === json([]) && h.config().deAmp === false);
    }
    {
      /* Three sides: the overwriting side has a change the overwritten one never saw. Only what
         the overwritten writes changed goes back; the rest of the overwriting side stands. */
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false, capReferrer: false, allowlist: [] } }, ['deAmp', 'capReferrer', 'allowlist'], {}, 100));
      const base = h.read();
      const sideways = h.write(base, ['allowlist'], { allowlist: ['kept.example'] }, 150);
      h.land(h.write(base, ['deAmp'], { deAmp: true }, 200));
      const changes = h.land(h.write(sideways, ['capReferrer'], { capReferrer: true }, 300));
      await h.api.repairOverwrittenConfig(changes);
      check('a change only the overwriting side made is not undone',
        json(h.config()) === json({ deAmp: true, capReferrer: true, allowlist: ['kept.example'] }));
    }
    {
      /* The overwriting side changed the same key later than the overwritten write did, in a write
         before the one that landed; and it carries a value neither side's writes listed (a page
         filling in its defaults). Both stand. */
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false, capReferrer: false } }, ['deAmp', 'capReferrer'], {}, 100));
      const base = h.read();
      h.land(h.write(base, ['deAmp'], { deAmp: true }, 200));
      const laterSameKey = h.write(base, ['deAmp'], { deAmp: false }, 250);
      const changes = h.land(h.write(laterSameKey, ['capReferrer'], { capReferrer: true, filledDefault: true }, 300));
      await h.api.repairOverwrittenConfig(changes);
      check('a same-key change made later on the overwriting side, and an unlisted default, both stand',
        json(h.config()) === json({ deAmp: false, capReferrer: true, filledDefault: true }));
    }
    {
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false, capReferrer: false } }, ['deAmp', 'capReferrer'], {}, 100));
      const stale = h.read();
      h.land(h.write(h.read(), ['deAmp'], { deAmp: true }, 200));
      const changes = h.land(h.write(stale, ['capReferrer'], { capReferrer: true }, 300));
      h.land(h.write(h.read(), ['deAmp'], { deAmp: false }, 400));
      await h.api.repairOverwrittenConfig(changes);
      check('a key changed again after the overwrite keeps that later change', h.config().deAmp === false);
    }
    {
      /* A regular and a private worker repairing at once, each under its own lock. */
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false, capReferrer: false } }, ['deAmp', 'capReferrer'], {}, 100));
      const stale = h.read();
      h.land(h.write(h.read(), ['deAmp'], { deAmp: true }, 200));
      const changes = h.land(h.write(stale, ['capReferrer'], { capReferrer: true }, 300));
      await Promise.all([h.api.repairOverwrittenConfig(changes), h.api.repairOverwrittenConfig(changes)]);
      check('two repairs at once both land the same config',
        h.state.sets === 2 && json(h.config()) === json({ deAmp: true, capReferrer: true }));
      const [first, second] = h.state.written;
      const again = h.api.configOverwritePlan(first.wardenone_config_writes, second.wardenone_config_writes,
        first.wardenone_config, second.wardenone_config);
      check('one repair landing over the other finds nothing to put back, so they cannot chase each other',
        again !== null && again.restore.length === 0);
    }
    {
      const h = overwriteHarness();
      h.land(h.write({ config: { deAmp: false, capReferrer: false } }, ['deAmp', 'capReferrer'], {}, 100));
      const stale = h.read();
      const many = Array.from({ length: 40 }, (_, i) => 'k' + i);
      h.land(h.write(h.read(), many.concat('deAmp'), { deAmp: true }, 200));
      const cut = h.land(h.write(stale, ['capReferrer'], { capReferrer: true }, 300));
      check('a write whose key list was cut short is left to the check-backs, not guessed at', h.plan(cut) === null);

      /* A save from before per-write keys were kept, as a page still open across an update makes. */
      const legacy = overwriteHarness();
      legacy.land({ config: { deAmp: false, capReferrer: false }, record: { epoch: '', ids: ['old'], keys: [], order: 1 } });
      const legacyStale = legacy.read();
      legacy.land({ config: { deAmp: true, capReferrer: false }, record: { epoch: '', ids: ['unlisted', 'old'], keys: ['deAmp'], order: 200 } });
      const fromLegacy = legacy.land(legacy.write(legacyStale, ['capReferrer'], { capReferrer: true }, 300));
      check('a record without per-write keys is left alone', legacy.plan(fromLegacy) === null);

      const epochs = overwriteHarness();
      epochs.land(epochs.write({ config: { deAmp: true } }, ['deAmp'], {}, 100));
      const preReset = epochs.read();
      epochs.land({ config: {}, record: { epoch: 'fresh', ids: [] } });
      epochs.land(epochs.write(epochs.read(), ['deAmp'], { deAmp: false }, 200));
      const across = epochs.land(epochs.write(preReset, ['capReferrer'], { capReferrer: true }, 300));
      check('a write across an erase is left to the reset guard', epochs.plan(across) === null);

      const ordinary = overwriteHarness();
      ordinary.land(ordinary.write({ config: { deAmp: false } }, ['deAmp'], {}, 100));
      const descends = ordinary.land(ordinary.write(ordinary.read(), ['deAmp'], { deAmp: true }, 200));
      check('an ordinary write that read the one before it is not touched', ordinary.plan(descends) === null);
    }
  });
}

const pages = ['settings.html', 'popup.html', 'history.html', 'notifications.html', 'onboarding.html'];
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  const own = page.replace(/\.html$/, '.js');
  check(page + ' loads config-lock.js before ' + own, scripts.indexOf('config-lock.js') >= 0 && scripts.indexOf('config-lock.js') < scripts.indexOf(own));
}
check('the worker imports config-lock.js', /importScripts\('config-lock\.js'\)/.test(fs.readFileSync(path.join(root, 'background.js'), 'utf8')));
check('config-lock.js ships', packaged.includes('config-lock.js'));

overwriteChecks.then(() => {
  console.log('[ok] config write lock: ' + checks + ' checks, ' + found.length + ' config writes found, all locked');
}).catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

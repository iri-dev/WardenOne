/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* One change to wardenone_config at a time, across the service worker and every extension page.

   Every writer re-reads the stored config and merges into it before writing, but a merge cannot
   help two writers that read at the same moment: Settings reads, the popup reads, Settings writes
   its change, the popup writes its own over it without Settings'. Fired together in Edge, the
   Settings change was lost in 20 of 40 tries and a notification mute in the worker in 34 of 40.

   A Web Lock is shared by every context of the extension's origin, so a writer that holds this one
   from its read to the end of its write makes the next writer read the result. Hold it only
   around the read and the write, never around a wait on something that may itself want the lock:
   locks do not nest, and the second request would wait for ever. Where the browser has no Web
   Locks, the task simply runs, as before.

   The lock does not reach a private window. In split incognito mode the private window has its own
   worker and pages with their own Web Locks, but the same storage, so a write there can still read
   before a write here and land after it: fired together in Edge, a regular Settings change was lost
   in 19 of 40 tries against an incognito one. So each write also leaves a record of which writes
   the stored config descends from (stampConfigWrite, written in the same set() as the config), and
   checks a moment later that it is still in there (confirmConfigWrite). A writer that never saw it
   leaves it out; the change is then made again on what is stored now. One that lands after those
   checks are over is caught as it lands, and what it wrote away put back (repairOverwrittenConfig). */
function withConfigLock(task) {
  try {
    const locks = typeof navigator !== 'undefined' && navigator.locks;
    if (locks && typeof locks.request === 'function') return locks.request('wardenone_config', () => task());
  } catch (_) {}
  return Promise.resolve().then(task);
}

/* Beside the config, not in it: the config reaches page worlds through the bridge, and a list of
   write ids there would only be something for a page to read. */
const WO_CONFIG_WRITES_KEY = 'wardenone_config_writes';
const WO_CONFIG_RESET_KEY = 'wardenone_config_reset';
/* Keep enough ancestry for delayed confirmation callbacks on slower browsers. The record is
   tiny compared with the storage quota, while a short list can evict a write before its second
   check gets a chance to repair a cross-context overwrite. */
const WO_CONFIG_WRITES_KEPT = 256;
/* The newest writes also keep what they changed and when, so a write that landed on top of them
   without having read them can be undone key by key (repairOverwrittenConfig). */
const WO_CONFIG_RECENT_KEPT = 64;
let __woConfigWriteOrder = 0;

function configWriteOrder() {
  let now = Date.now();
  try {
    if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
        && typeof performance.now === 'function') now = performance.timeOrigin + performance.now();
  } catch (_) {}
  __woConfigWriteOrder = Math.max(Number.isFinite(now) ? now : Date.now(), __woConfigWriteOrder + 0.001);
  return __woConfigWriteOrder;
}

function configWriteId() {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
  } catch (_) {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/* A new write's id, and the record to store with it: that id, then the ids the stored config
   already descends from. `stored` is what was read for WO_CONFIG_WRITES_KEY with the config. */
function stampConfigWrite(stored, changedKeys, operationOrder) {
  const epoch = stored && typeof stored.epoch === 'string' ? stored.epoch : '';
  const id = (epoch ? epoch + ':' : '') + configWriteId();
  const prior = stored && Array.isArray(stored.ids) ? stored.ids.filter((x) => typeof x === 'string') : [];
  const listed = Array.isArray(changedKeys) ? changedKeys.filter((key) => typeof key === 'string') : null;
  const keys = listed ? listed.slice(0, 32) : [];
  const supplied = Number(operationOrder);
  const order = Number.isFinite(supplied) && supplied > 0 ? supplied : configWriteOrder();
  /* A write whose keys are unknown or cut short cannot be undone key by key, and says so. */
  const entry = { id, keys, order };
  if (!listed || listed.length > keys.length) entry.partial = true;
  const recent = [entry].concat(configRecentWrites(stored)).slice(0, WO_CONFIG_RECENT_KEPT);
  return { id, order, record: { epoch, ids: [id].concat(prior).slice(0, WO_CONFIG_WRITES_KEPT), keys, order, recent } };
}

function configRecentWrites(record) {
  return record && Array.isArray(record.recent)
    ? record.recent.filter((entry) => entry && typeof entry.id === 'string' && Array.isArray(entry.keys))
    : [];
}

function woConfigValuesDiffer(a, b) {
  if (a === b) return false;
  try { return JSON.stringify(a) !== JSON.stringify(b); } catch (_) { return true; }
}

/* After the lock is let go: is the stored config still descended from this write? Checked twice,
   since a writer elsewhere may be slower than the first look. A later write that read this one
   carries its id; one that read before it does not, and wrote over it. Then `again` makes the
   change once more on what is stored now, and confirms that write in turn -- at most twice in all.
   A new reset epoch stops any pre-reset retry. For the same key, the operation order tells a
   delayed older write from a later user edit; retries retain their original order. */
function confirmConfigWrite(id, again, triesLeft, changedKeys, operationOrder) {
  if (!id || typeof again !== 'function' || typeof setTimeout !== 'function') return;
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  const left = triesLeft === undefined ? 2 : triesLeft;
  const look = (delay, last) => setTimeout(() => {
    try {
      chrome.storage.local.get(WO_CONFIG_WRITES_KEY, (got) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const record = got && got[WO_CONFIG_WRITES_KEY];
        const ids = record && record.ids;
        if (!Array.isArray(ids)) return;
        if ((record.epoch || '') !== (id.includes(':') ? id.slice(0, id.indexOf(':')) : '')) return;
        if (ids.includes(id)) {
          if (!last) look(1200, true);
          return;
        }
        if (Array.isArray(changedKeys) && changedKeys.length === 1
            && Array.isArray(record.keys) && record.keys.includes(changedKeys[0])) {
          const ours = Number(operationOrder);
          const current = Number(record.order);
          if (!Number.isFinite(ours) || !Number.isFinite(current) || current >= ours) return;
        }
        if (left > 0) {
          try { again(left - 1); } catch (_) {}
        }
      });
    } catch (_) {}
  }, delay);
  look(300, false);
}

/* The two looks above end 1.5 s after a write. A private write that read before it and lands
   later still writes it away, and nothing looks again: held 2.1 s in Edge, a regular change to
   another setting was gone for good. But storage hands every listener the config and record a
   write replaced, and the records say which writes each side descends from and what those
   changed. So when a write lands that never saw the one before it, the writes it wrote away are
   known, and so are their keys: each goes back unless the overwriting side changed that key
   later. This plans that from the change alone; null when nothing was lost or the records cannot
   say (a key list cut short, a write too old to be listed), which leaves it to the looks above. */
function configOverwritePlan(oldRecord, newRecord, oldConfig, newConfig) {
  const isRecord = (record) => !!record && typeof record === 'object' && Array.isArray(record.ids);
  const isConfig = (config) => !!config && typeof config === 'object' && !Array.isArray(config);
  if (!isRecord(oldRecord) || !isRecord(newRecord) || !isConfig(oldConfig) || !isConfig(newConfig)) return null;
  if ((oldRecord.epoch || '') !== (newRecord.epoch || '')) return null;
  const oldIds = oldRecord.ids;
  const newIds = newRecord.ids;
  if (!oldIds.length || !newIds.length || newIds.includes(oldIds[0])) return null;
  /* Newest first, back to the last write both sides descend from; with none, both whole lists,
     provided neither was cut short. */
  const since = (ids, other) => {
    const at = ids.findIndex((id) => other.includes(id));
    if (at >= 0) return ids.slice(0, at);
    return ids.length < WO_CONFIG_WRITES_KEPT ? ids.slice() : null;
  };
  const lost = since(oldIds, newIds);
  const kept = since(newIds, oldIds);
  if (!lost || !kept) return null;
  const entries = new Map();
  for (const entry of configRecentWrites(newRecord).concat(configRecentWrites(oldRecord))) {
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }
  const latestByKey = (ids) => {
    const byKey = new Map();
    for (const id of ids) {
      const entry = entries.get(id);
      const order = entry ? Number(entry.order) : NaN;
      if (!entry || entry.partial || !Number.isFinite(order)) return null;
      for (const key of entry.keys) if (!(byKey.get(key) >= order)) byKey.set(key, order);
    }
    return byKey;
  };
  const lostKeys = latestByKey(lost);
  const keptKeys = latestByKey(kept);
  if (!lostKeys || !keptKeys) return null;
  const restore = [];
  const orders = new Map();
  for (const [key, order] of lostKeys) {
    if (keptKeys.has(key) && keptKeys.get(key) >= order) continue;
    if (!woConfigValuesDiffer(oldConfig[key], newConfig[key])) continue;
    restore.push(key);
    orders.set(key, order);
  }
  return { restore, orders, lost, lostEntries: lost.map((id) => entries.get(id)) };
}

/* Under the lock, on what is stored now: only while the config still stands on the overwriting
   write and nobody has put it right yet (here, or in a private window's own worker), and never
   over a key changed again since. The repair lists the writes it restores, newest first, so it
   can be put right in turn if it is written over itself. */
async function repairOverwrittenConfig(changes) {
  const records = changes && changes[WO_CONFIG_WRITES_KEY];
  const configs = changes && changes.wardenone_config;
  if (!records || !configs) return;
  const plan = configOverwritePlan(records.oldValue, records.newValue, configs.oldValue, configs.newValue);
  if (!plan || !plan.restore.length) return;
  const overwriter = records.newValue.ids[0];
  const overwritten = records.oldValue.ids[0];
  await withConfigLock(async () => {
    const stored = await chrome.storage.local.get(['wardenone_config', WO_CONFIG_WRITES_KEY]);
    const record = stored[WO_CONFIG_WRITES_KEY];
    const current = stored.wardenone_config;
    if (!record || !Array.isArray(record.ids) || (record.epoch || '') !== (records.newValue.epoch || '')) return;
    if (!record.ids.includes(overwriter) || record.ids.includes(overwritten)) return;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return;
    /* What was written since the overwrite, by intent: a key set again -- even back to the stale
       value -- is a later change, and stands. A write since then that cannot say what it changed
       leaves the whole repair alone. */
    const recentById = new Map(configRecentWrites(record).map((entry) => [entry.id, entry]));
    const changedSince = new Set();
    for (const id of record.ids.slice(0, record.ids.indexOf(overwriter))) {
      const entry = recentById.get(id);
      if (!entry || entry.partial) return;
      entry.keys.forEach((key) => changedSince.add(key));
    }
    const next = Object.assign({}, current);
    const restored = [];
    for (const key of plan.restore) {
      if (changedSince.has(key) || woConfigValuesDiffer(current[key], configs.newValue[key])) continue;
      if (configs.oldValue[key] === undefined) delete next[key];
      else next[key] = configs.oldValue[key];
      restored.push(key);
    }
    if (!restored.length) return;
    const stamp = stampConfigWrite(record, []);
    const ids = [stamp.id].concat(plan.lost.filter((id) => !record.ids.includes(id)), record.ids)
      .slice(0, WO_CONFIG_WRITES_KEPT);
    const listed = new Set(configRecentWrites(record).map((entry) => entry.id));
    const recent = [stamp.record.recent[0]].concat(plan.lostEntries.filter((entry) => !listed.has(entry.id)),
      configRecentWrites(record)).slice(0, WO_CONFIG_RECENT_KEPT);
    const order = Math.max.apply(null, restored.map((key) => plan.orders.get(key)));
    await chrome.storage.local.set({ wardenone_config: next,
      [WO_CONFIG_WRITES_KEY]: { epoch: stamp.record.epoch, ids, keys: restored, order, recent } });
  });
}

/* A full erase leaves a random epoch. Old private writes can still land after clear(),
   even after the worker reloads, so every live config context checks the shared store. */
async function repairConfigAfterReset(changes) {
  const marker = await chrome.storage.local.get(WO_CONFIG_RESET_KEY);
  if (!marker[WO_CONFIG_RESET_KEY] || typeof marker[WO_CONFIG_RESET_KEY].epoch !== 'string') return;
  await withConfigLock(async () => {
    const stored = await chrome.storage.local.get([WO_CONFIG_RESET_KEY, WO_CONFIG_WRITES_KEY, 'wardenone_config']);
    const guard = stored[WO_CONFIG_RESET_KEY];
    const epoch = guard && guard.epoch;
    if (typeof epoch !== 'string' || !epoch) return;
    const record = stored[WO_CONFIG_WRITES_KEY];
    if (record && record.epoch === epoch) return;
    const priorRecord = changes && changes[WO_CONFIG_WRITES_KEY] && changes[WO_CONFIG_WRITES_KEY].oldValue;
    const priorConfig = changes && changes.wardenone_config && changes.wardenone_config.oldValue;
    if (priorRecord && priorRecord.epoch === epoch && priorConfig !== undefined) {
      await chrome.storage.local.set({ wardenone_config: priorConfig, [WO_CONFIG_WRITES_KEY]: priorRecord });
    } else {
      await chrome.storage.local.remove('wardenone_config');
      await chrome.storage.local.set({ [WO_CONFIG_WRITES_KEY]: { epoch, ids: [] } });
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.wardenone_config && !changes[WO_CONFIG_WRITES_KEY])) return;
    repairConfigAfterReset(changes).catch(() => {});
    repairOverwrittenConfig(changes).catch(() => {});
  });
  repairConfigAfterReset().catch(() => {});
}

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
   leaves it out; the change is then made again on what is stored now. */
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
const WO_CONFIG_WRITES_KEPT = 64;

function configWriteId() {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
  } catch (_) {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

/* A new write's id, and the record to store with it: that id, then the ids the stored config
   already descends from. `stored` is what was read for WO_CONFIG_WRITES_KEY with the config. */
function stampConfigWrite(stored) {
  const id = configWriteId();
  const prior = stored && Array.isArray(stored.ids) ? stored.ids.filter((x) => typeof x === 'string') : [];
  return { id, record: { ids: [id].concat(prior).slice(0, WO_CONFIG_WRITES_KEPT) } };
}

/* After the lock is let go: is the stored config still descended from this write? Checked twice,
   since a writer elsewhere may be slower than the first look. A later write that read this one
   carries its id; one that read before it does not, and wrote over it. Then `again` makes the
   change once more on what is stored now, and confirms that write in turn -- at most twice in all.
   No record at all means the store has been reset since: there is nothing to put back. */
function confirmConfigWrite(id, again, triesLeft) {
  if (!id || typeof again !== 'function' || typeof setTimeout !== 'function') return;
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  const left = triesLeft === undefined ? 2 : triesLeft;
  const look = (delay, last) => setTimeout(() => {
    try {
      chrome.storage.local.get(WO_CONFIG_WRITES_KEY, (got) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const ids = got && got[WO_CONFIG_WRITES_KEY] && got[WO_CONFIG_WRITES_KEY].ids;
        if (!Array.isArray(ids)) return;
        if (ids.includes(id)) {
          if (!last) look(1200, true);
          return;
        }
        if (left > 0) {
          try { again(left - 1); } catch (_) {}
        }
      });
    } catch (_) {}
  }, delay);
  look(300, false);
}

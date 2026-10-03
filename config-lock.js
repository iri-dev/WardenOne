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
   Locks, the task simply runs, as before. In split incognito mode a private window's worker has its
   own locks, so the few writes it makes are not ordered against these. */
function withConfigLock(task) {
  try {
    const locks = typeof navigator !== 'undefined' && navigator.locks;
    if (locks && typeof locks.request === 'function') return locks.request('wardenone_config', () => task());
  } catch (_) {}
  return Promise.resolve().then(task);
}

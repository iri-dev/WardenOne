/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Deferred and render-blocking in popup.html, so the first frame waits for the parse and the saved
   search and position it restores, instead of painting controls mid-parse. Nothing is hidden. */
if (typeof popupMemoryLayoutReady !== 'undefined' && !popupMemoryLayoutReady
  && typeof restorePopupMemoryLayout === 'function') restorePopupMemoryLayout();
/* popup.js runs after the restore and can resize rows above the saved anchor. */
if (typeof adjustPopupScrollAnchor === 'function') adjustPopupScrollAnchor();

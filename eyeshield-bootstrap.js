/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
(() => {
  'use strict';
  try { chrome.runtime.sendMessage({ kind: 'eyeshield-bootstrap' }, () => { void chrome.runtime.lastError; }); } catch (_) {}
})();

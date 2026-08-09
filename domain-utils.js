/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne -- shared registrable-domain (eTLD+1) helpers.
 * ======================================================
 * Loaded by BOTH the background service worker (via importScripts) and the popup/options
 * pages (via a <script> tag) so the two can never disagree about what "this site" is for
 * Forget-Me, allowlisting, and breach lookups. This is the single source of truth -- do
 * NOT re-implement the algorithm in popup.js or background.js.
 *
 * It is a small heuristic, NOT the full Public Suffix List: strip a leading "www.",
 * lowercase, then keep the last two labels -- or the last three when the second-to-last
 * label looks like a country-code second-level domain (co.uk, com.au, gov.uk, ...).
 */

function regDomain(host) {
  return String(host || '').replace(/^www\./, '').toLowerCase();
}

function registrableDomain(host) {
  const h = regDomain(host);
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  const multi = /^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/;
  return multi.test(last2) ? parts.slice(-3).join('.') : last2;
}

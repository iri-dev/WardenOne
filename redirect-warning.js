/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  // This page's URL carries one thing: a handle. The addresses it is about live in a
  // storage.session record the worker wrote just before sending the tab here, so they never
  // enter the tab's URL -- and from there browser history, session restore or a screenshot.
  // The record is read directly, without the worker, so it works after a worker eviction; it
  // is consumed when the reader continues, and a page whose record is gone offers only the
  // way back (PRIV-04).
  const handle = new URLSearchParams(location.search || '').get('w') || '';
  const RECORD_KEY = /^[0-9a-f]{32}$/.test(handle) ? 'wardenone_warning:' + handle : '';

  function loadRecord() {
    return new Promise((resolve) => {
      if (!RECORD_KEY) { resolve(null); return; }
      try {
        chrome.storage.session.get(RECORD_KEY, (res) => {
          void chrome.runtime.lastError;
          const rec = res && res[RECORD_KEY];
          resolve(rec && rec.kind === 'redirect' ? rec : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  // One remove, then go. The record is its own storage key, so consuming it cannot race
  // with anything else being written; the timer only guards against a callback that
  // never fires.
  function consumeRecord(then) {
    let done = false;
    const go = () => { if (!done) { done = true; then(); } };
    try { chrome.storage.session.remove(RECORD_KEY, go); } catch (_) { go(); }
    setTimeout(go, 800);
  }

  // Only http(s) is ever navigated to, whatever the record says.
  function safeUrl(raw) {
    try {
      const u = new URL(String(raw || ''));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
  }

  loadRecord().then((rec) => {
    const target = safeUrl(rec && rec.url);
    const source = safeUrl(rec && rec.sourceUrl);
    const why = (rec && rec.why) || 'This click did not target the destination site.';

    if (!rec) {
      text('to-host', 'This warning has expired');
      text('to-url', 'The address it was about is no longer held. Go back to where you were.');
      text('from-host', 'Previous page');
      text('reason', 'A warning only keeps its destination for a while, and never in the address bar.');
      const cont = document.getElementById('continue');
      if (cont) cont.hidden = true;
    } else {
      // What is painted is the display form the worker built: host and path, no query.
      text('to-host', target ? target.hostname.replace(/^www\./, '') : 'Unknown destination');
      text('to-url', rec.shown || '');
      text('from-host', source ? source.hostname.replace(/^www\./, '') : 'Previous page');
      text('from-url', rec.sourceShown || '');
      text('reason', why);
    }

    document.getElementById('back')?.addEventListener('click', () => {
      if (source) {
        location.href = source.href;
        return;
      }
      if (history.length > 1) history.back();
      else location.href = 'about:blank';
    });

    document.getElementById('continue')?.addEventListener('click', () => {
      if (!target) return;
      consumeRecord(() => { location.href = target.href; });
    });
  });
}());

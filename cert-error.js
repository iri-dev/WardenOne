/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  // This page's URL carries one thing: a handle. The failed address lives in a
  // storage.session record the worker wrote just before sending the tab here, so it never
  // enters the tab's URL -- and from there browser history, session restore or a screenshot.
  // The record is read directly, without the worker, so it works after a worker eviction; it
  // is consumed when the reader retries, and a page whose record is gone offers only the way
  // back (PRIV-04).
  const handle = new URLSearchParams(location.search || '').get('w') || '';
  const RECORD_KEY = /^[0-9a-f]{32}$/.test(handle) ? 'wardenone_warning:' + handle : '';

  function loadRecord() {
    return new Promise((resolve) => {
      if (!RECORD_KEY) { resolve(null); return; }
      try {
        chrome.storage.session.get(RECORD_KEY, (res) => {
          void chrome.runtime.lastError;
          const rec = res && res[RECORD_KEY];
          resolve(rec && rec.kind === 'trust' ? rec : null);
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

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
  }

  function safeHttpUrl(raw) {
    try {
      const u = new URL(String(raw || ''));
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (_) {
      return '';
    }
  }

  loadRecord().then((rec) => {
    const kind = (rec && rec.trustKind) || 'blocked_certificate';
    const problem = (rec && rec.problem) || 'Invalid security certificate';
    const why = (rec && rec.why) || 'The website security certificate is invalid.';
    const risk = (rec && rec.risk) || 'Attackers may be able to intercept information sent to this website.';
    const error = (rec && rec.error) || '';
    const retryUrl = safeHttpUrl(rec && rec.url);

    text('title', kind === 'blocked_http_only' ? 'Secure Connection Required' : 'Connection Not Trusted');
    // What is painted is the display form the worker built: host and path, no query.
    text('site', rec ? (rec.shown || '') : 'This warning has expired');
    text('reason', rec
      ? problem + (why ? '. ' + why : '')
      : 'The address this warning was about is no longer held. Go back to where you were.');
    text('risk', rec ? risk : '');
    text('error', error ? error.replace(/^net::/i, '') : 'Certificate or TLS trust check failed');
    text('status', 'Blocked by WardenOne');

    const retry = document.getElementById('retry');
    if (retry && !retryUrl) retry.hidden = true;

    document.getElementById('back')?.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.href = 'about:blank';
    });

    retry?.addEventListener('click', () => {
      if (retryUrl) consumeRecord(() => { location.href = retryUrl; });
    });

    document.getElementById('activity')?.addEventListener('click', () => {
      location.href = chrome.runtime.getURL('history.html');
    });
  });
})();

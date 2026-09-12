/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  // This page's URL carries one thing: a handle. The blocked address lives in a
  // storage.session record the worker wrote just before sending the tab here, so it never
  // enters the tab's URL -- and from there browser history, session restore or a screenshot.
  // The record is read directly, without the worker, so it works after a worker eviction; it
  // is consumed when the reader continues anyway, and a page whose record is gone offers only
  // the way back (PRIV-04).
  const handle = new URLSearchParams(location.search || '').get('w') || '';
  const RECORD_KEY = /^[0-9a-f]{32}$/.test(handle) ? 'wardenone_warning:' + handle : '';

  function loadRecord() {
    return new Promise((resolve) => {
      if (!RECORD_KEY) { resolve(null); return; }
      try {
        chrome.storage.session.get(RECORD_KEY, (res) => {
          void chrome.runtime.lastError;
          const rec = res && res[RECORD_KEY];
          resolve(rec && rec.kind === 'safe-browsing' ? rec : null);
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

  // Validate the scheme here rather than relying on a check in another file. The worker only
  // stores http(s), but the guarantee that this page never navigates anywhere else rests here,
  // the same way it does in its siblings.
  function safeHttpUrl(raw) {
    try {
      const u = new URL(String(raw || ''));
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (_) {
      return '';
    }
  }

  loadRecord().then((rec) => {
    const url = safeHttpUrl(rec && rec.url);
    const provider = (rec && rec.provider) || 'URL reputation';
    const threats = String((rec && rec.threats) || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.replace(/_/g, ' ').toLowerCase());

    // What is painted is the display form the worker built: host and path, no query.
    const site = document.getElementById('site');
    if (site) site.textContent = rec ? (rec.shown || '') : 'This warning has expired';

    const providerEl = document.getElementById('provider');
    if (providerEl) providerEl.textContent = 'Blocked by WardenOne + ' + provider;

    const reason = document.getElementById('reason');
    if (reason) {
      reason.textContent = !rec
        ? 'The address this warning was about is no longer held. Go back to where you were.'
        : (threats.length
          ? provider + ' flagged this URL as ' + threats.join(', ') + '.'
          : provider + ' flagged this URL as dangerous.');
    }

    document.getElementById('back')?.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.href = 'about:blank';
    });

    document.getElementById('activity')?.addEventListener('click', () => {
      location.href = chrome.runtime.getURL('history.html');
    });

    let host = '';
    try { host = new URL(url).hostname; } catch (_) {}

    const escapePanel = document.getElementById('escape');
    const proceed = document.getElementById('proceed');
    const foot = document.getElementById('foot');
    const escapeHost = document.getElementById('escape-host');
    if (escapeHost) escapeHost.textContent = host || 'this site';

    // The escape route is revealed rather than shown, and the button that uses it stays
    // disabled for a few seconds. Someone who genuinely knows this site is a false
    // positive will wait; someone clicking through a malware warning on reflex will not.
    // No safe destination means there is nothing to continue TO, so the escape hatch is not offered
    // at all rather than being offered and then failing at the last step.
    if (!url) {
      const wrongBtn = document.getElementById('wrong');
      if (wrongBtn) wrongBtn.hidden = true;
    }

    document.getElementById('wrong')?.addEventListener('click', () => {
      if (!escapePanel || !url) return;
      escapePanel.hidden = false;
      if (foot) foot.hidden = true;
      document.getElementById('wrong')?.setAttribute('disabled', 'disabled');
      let left = 5;
      if (proceed) {
        proceed.textContent = 'Continue anyway (' + left + ')';
        const tick = setInterval(() => {
          left--;
          if (left > 0) { proceed.textContent = 'Continue anyway (' + left + ')'; return; }
          clearInterval(tick);
          proceed.textContent = 'Continue anyway';
          proceed.removeAttribute('disabled');
        }, 1000);
      }
    });

    document.getElementById('report')?.addEventListener('click', () => {
      const title = 'False positive: ' + (host || 'site blocked');
      const body = [
        'A site was blocked that I believe is safe.',
        '',
        'Site: ' + (host || '(unknown)'),
        'Reported by: ' + provider,
        'Flagged as: ' + (threats.length ? threats.join(', ') : '(not stated)'),
        '',
        'Why I think this is wrong:',
        '',
      ].join('\n');
      const target = 'https://github.com/iri-dev/WardenOne/issues/new'
        + '?title=' + encodeURIComponent(title)
        + '&body=' + encodeURIComponent(body);
      try { chrome.tabs.create({ url: target }); } catch (_) { window.open(target, '_blank'); }
    });

    proceed?.addEventListener('click', () => {
      if (proceed.hasAttribute('disabled') || !url) return;
      proceed.setAttribute('disabled', 'disabled');
      proceed.textContent = 'Continuing…';
      chrome.runtime.sendMessage({ kind: 'safe-browsing-allow-once', host: host }, (res) => { void chrome.runtime.lastError;
        if (res && res.ok) { consumeRecord(() => { location.href = url; }); return; }
        proceed.textContent = 'Could not continue';
      });
    });
  });
})();

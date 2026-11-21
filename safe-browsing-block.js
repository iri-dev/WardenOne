/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  // PRIV-04: keep the blocked URL in storage.session behind an opaque handle. Read without the worker, consume on Continue,
  // and offer only Back if missing.
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

    // WardenOne's own checks name themselves, so "WardenOne + WardenOne ..." never appears.
    const local = /^WardenOne\b/.test(provider);
    const program = !!rec && rec.ipProgram === true;
    const providerEl = document.getElementById('provider');
    if (providerEl) providerEl.textContent = local ? 'Blocked by ' + provider : 'Blocked by WardenOne + ' + provider;

    const reason = document.getElementById('reason');
    if (reason) {
      reason.textContent = !rec
        ? 'The address this warning was about is no longer held. Go back to where you were.'
        : program && rec.ipProgramKind === 'repo'
          ? 'This link downloads a program stored straight in a GitHub repository, not published as a release. Malware is often handed out this way, while real projects usually ship through their Releases page.'
        : program
          ? 'This link downloads a program straight from a bare IP address, with no website name behind it. Malware is often handed out this way.'
          : (threats.length
            ? provider + ' flagged this URL as ' + threats.join(', ') + '.'
            : provider + ' flagged this URL as dangerous.');
    }
    if (program) {
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set('title', 'Program Download Stopped');
      set('risk', rec.ipProgramBeforeSending === true
        ? 'Nothing was downloaded. WardenOne stopped the request before it was sent.'
        : 'WardenOne stopped this page. If a download had already started, Download Shield holds it for review.');
      set('escape-text', (rec.ipProgramKind === 'repo' ? 'Some projects do share programs this way, but most publish them as releases. '
        : 'Some honest servers do share programs this way, but it is rare. ')
        + 'If you were not expecting a download, or you came here from a link, an email or an advert, please go back. '
        + 'If you continue, Download Shield still checks the file before you can open it.');
      document.title = 'Program download stopped';
    }
    if (rec && local) {
      const foot = document.getElementById('foot');
      if (foot) foot.textContent = 'WardenOne’s own check matched this address, so it was stopped before anything loaded. '
        + 'You are not trapped here. If you think it is wrong, use “This looks wrong”.';
    }

    // The worker adds the feed a moment after the block, once the browser has recorded which rule fired.
    let listedBy = null;
    const showListedBy = (value) => {
      const name = value && typeof value.name === 'string' ? value.name.slice(0, 120) : '';
      const feedUrl = value ? safeHttpUrl(value.url) : '';
      if (!name || !feedUrl) return;
      listedBy = { name, url: feedUrl };
      const el = document.getElementById('listed-by');
      if (el) el.textContent = name;
      const row = document.getElementById('listed-by-row');
      if (row) row.hidden = false;
    };
    showListedBy(rec && rec.listedBy);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'session' || !RECORD_KEY || !changes[RECORD_KEY]) return;
        const next = changes[RECORD_KEY].newValue;
        if (next && next.kind === 'safe-browsing') showListedBy(next.listedBy);
      });
    } catch (_) {}

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

    // Reveal and delay the bypass to discourage reflex clicks. Offer it only when a safe continuation destination exists.
    if (!url) {
      const wrongBtn = document.getElementById('wrong');
      if (wrongBtn) wrongBtn.hidden = true;
    }

    document.getElementById('wrong')?.addEventListener('click', () => {
      if (!escapePanel || !url) return;
      escapePanel.hidden = false;
      if (foot) foot.hidden = true;
      document.getElementById('wrong')?.setAttribute('disabled', 'disabled');
      document.getElementById('escape-title')?.focus();
      let left = 5;
      if (proceed) {
        proceed.textContent = 'Continue anyway (' + left + ')';
        const tick = setInterval(() => {
          left--;
          if (left > 0) { proceed.textContent = 'Continue anyway (' + left + ')'; return; }
          clearInterval(tick);
          proceed.textContent = 'Continue anyway';
          proceed.removeAttribute('disabled');
          const ready = document.getElementById('escape-ready');
          if (ready) ready.textContent = 'Continue anyway is now available.';
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
        ...(listedBy ? ['Listed by: ' + listedBy.url] : []),
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
      chrome.runtime.sendMessage({ kind: 'safe-browsing-allow-once', handle }, (res) => { void chrome.runtime.lastError;
        if (res && res.ok) { location.href = url; return; }
        proceed.textContent = 'Could not continue';
        const ready = document.getElementById('escape-ready');
        if (ready) ready.textContent = 'Could not continue. Go back or open activity.';
      });
    });
  });
})();

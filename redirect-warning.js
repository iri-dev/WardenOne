/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search || '');
  const targetUrl = params.get('to') || '';
  const sourceUrl = params.get('from') || '';
  const why = params.get('why') || 'This click did not target the destination site.';

  function safeUrl(raw) {
    try {
      const u = new URL(String(raw || ''));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  const target = safeUrl(targetUrl);
  const source = safeUrl(sourceUrl);

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '';
  }

  text('to-host', target ? target.hostname.replace(/^www\./, '') : 'Unknown destination');
  text('to-url', target ? target.href : targetUrl);
  text('from-host', source ? source.hostname.replace(/^www\./, '') : 'Previous page');
  text('from-url', source ? source.href : sourceUrl);
  text('reason', why);

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
    location.href = target.href;
  });
}());

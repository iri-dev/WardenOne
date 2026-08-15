/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search || '');
  // Validate the scheme here rather than relying on a check in another file.
  //
  // Nothing reachable proved exploitable: an empty hostname fails addSafeBrowsingBypass, the
  // manifest declares no web_accessible_resources so no page can navigate here, and the pages CSP
  // blocks javascript: anyway. But this was the only one of the three interstitials that did not
  // validate -- redirect-warning.js and cert-error.js both do -- so the guarantee rested on code
  // somewhere else. It rests here now, the same way it does in its siblings.
  function safeHttpUrl(raw) {
    try {
      const u = new URL(String(raw || ''));
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (_) {
      return '';
    }
  }
  const requestedUrl = params.get('u') || '';
  const url = safeHttpUrl(requestedUrl);
  const provider = params.get('p') || 'URL reputation';
  const threats = String(params.get('t') || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/_/g, ' ').toLowerCase());

  // Show what was actually blocked, even when it is not a scheme we would navigate back to.
  // textContent, so an odd value is displayed rather than interpreted.
  const site = document.getElementById('site');
  if (site) site.textContent = requestedUrl;

  const providerEl = document.getElementById('provider');
  if (providerEl) providerEl.textContent = 'Blocked by WardenOne + ' + provider;

  const reason = document.getElementById('reason');
  if (reason) {
    reason.textContent = threats.length
      ? provider + ' flagged this URL as ' + threats.join(', ') + '.'
      : provider + ' flagged this URL as dangerous.';
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
      if (res && res.ok) { location.href = url; return; }
      proceed.textContent = 'Could not continue';
    });
  });
})();

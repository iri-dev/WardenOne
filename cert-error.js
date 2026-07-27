(function () {
  'use strict';

  const params = new URLSearchParams(location.search || '');
  const originalUrl = params.get('u') || '';
  const kind = params.get('k') || 'blocked_certificate';
  const problem = params.get('p') || 'Invalid security certificate';
  const why = params.get('w') || 'The website security certificate is invalid.';
  const risk = params.get('r') || 'Attackers may be able to intercept information sent to this website.';
  const error = params.get('e') || '';

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

  const retryUrl = safeHttpUrl(originalUrl);
  let host = originalUrl;
  try {
    const u = new URL(retryUrl || originalUrl);
    host = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '');
  } catch (_) {}

  text('title', kind === 'blocked_http_only' ? 'Secure Connection Required' : 'Connection Not Trusted');
  text('site', originalUrl || host);
  text('reason', problem + (why ? '. ' + why : ''));
  text('risk', risk);
  text('error', error ? error.replace(/^net::/i, '') : 'Certificate or TLS trust check failed');
  text('status', 'Blocked by Warden One');

  document.getElementById('back')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = 'about:blank';
  });

  document.getElementById('retry')?.addEventListener('click', () => {
    if (retryUrl) location.href = retryUrl;
  });

  document.getElementById('activity')?.addEventListener('click', () => {
    location.href = chrome.runtime.getURL('history.html');
  });
})();

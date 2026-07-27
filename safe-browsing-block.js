(function () {
  'use strict';

  const params = new URLSearchParams(location.search || '');
  const url = params.get('u') || '';
  const provider = params.get('p') || 'URL reputation';
  const threats = String(params.get('t') || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/_/g, ' ').toLowerCase());

  const site = document.getElementById('site');
  if (site) site.textContent = url;

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
})();

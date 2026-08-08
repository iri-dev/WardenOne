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
  document.getElementById('wrong')?.addEventListener('click', () => {
    if (!escapePanel) return;
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
    if (proceed.hasAttribute('disabled')) return;
    proceed.setAttribute('disabled', 'disabled');
    proceed.textContent = 'Continuing…';
    chrome.runtime.sendMessage({ kind: 'safe-browsing-allow-once', host: host }, (res) => { void chrome.runtime.lastError;
      if (res && res.ok) { location.href = url; return; }
      proceed.textContent = 'Could not continue';
    });
  });
})();

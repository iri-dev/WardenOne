/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
(function () {
  'use strict';

  document.getElementById('back').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = 'about:blank';
  });
  document.getElementById('activity').addEventListener('click', () => {
    location.href = chrome.runtime.getURL('history.html');
  });

  try {
    chrome.runtime.sendMessage({ kind: 'grabber-navigation-status' }, (result) => {
      const error = chrome.runtime.lastError;
      const status = !error && result && result.status;
      const blocked = status === 'blocked';
      document.getElementById('status').textContent = blocked ? 'Blocked before connecting'
        : status === 'protection_unavailable' ? 'Network protection unavailable' : 'Block not confirmed';
      document.getElementById('explanation').textContent = blocked
        ? 'WardenOne redirected this visit before the destination could load.'
        : status === 'protection_unavailable'
          ? 'WardenOne network protection is unavailable for this destination. Your public IP address and request information may already have been exposed.'
          : 'WardenOne observed this navigation but could not confirm a block. Your public IP address and request information may already have been exposed.';
      const host = blocked && /^[a-z0-9.-]{1,253}$/.test(result.host || '') ? result.host : '';
      if (host) {
        document.getElementById('host').textContent = host;
        document.getElementById('host-row').hidden = false;
      }
    });
  } catch (_) {
    document.getElementById('status').textContent = 'Block not confirmed';
    document.getElementById('explanation').textContent = 'WardenOne could not confirm a blocked navigation. Your public IP address and request information may already have been exposed.';
  }
})();

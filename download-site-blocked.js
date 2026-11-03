/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
(function () {
  'use strict';

  const back = document.getElementById('back');
  const status = document.getElementById('return-status');
  let pending = false;

  function unavailable() {
    pending = false;
    back.disabled = false;
    back.textContent = 'Back to download page';
    status.textContent = 'WardenOne could not find the original page. Switch back to it using your browser’s tabs, close this ad tab, then try the original download button again.';
  }

  back.addEventListener('click', event => {
    if (!event || event.isTrusted !== true || pending) return;
    pending = true;
    back.disabled = true;
    back.textContent = 'Returning…';
    status.textContent = '';
    const timeout = setTimeout(unavailable, 5000);
    try {
      chrome.runtime.sendMessage({ kind: 'download-site-return' }, result => {
        const error = chrome.runtime.lastError;
        clearTimeout(timeout);
        if (error || !result || result.ok !== true) unavailable();
      });
    } catch (_) {
      clearTimeout(timeout);
      unavailable();
    }
  });
})();

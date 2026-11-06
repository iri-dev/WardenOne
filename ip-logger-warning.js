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

  const COULD_NOT_CHECK = 'WardenOne could not check this visit just now, so it cannot say whether the block worked. Browsers limit how often this check can run, so reloading this page in a few minutes usually answers it.';

  function show(result) {
    const status = result && result.status;
    const blocked = status === 'blocked';
    document.getElementById('status').textContent = blocked ? 'Blocked before connecting'
      : status === 'protection_unavailable' ? 'Network protection unavailable'
        : status === 'observed_unconfirmed' ? 'Block not confirmed' : 'Could not check';
    document.getElementById('explanation').textContent = blocked
      ? 'WardenOne redirected this visit before the destination could load.'
      : status === 'protection_unavailable'
        ? 'WardenOne network protection is unavailable for this destination. Your public IP address and request information may already have been exposed.'
        : status === 'observed_unconfirmed'
          ? 'WardenOne observed this navigation but could not confirm a block. Your public IP address and request information may already have been exposed.'
          : COULD_NOT_CHECK;
    const host = blocked && /^[a-z0-9.-]{1,253}$/.test(result.host || '') ? result.host : '';
    if (host) {
      document.getElementById('host').textContent = host;
      document.getElementById('host-row').hidden = false;
    }
  }

  /* A confirmed block stays true for this history entry. Reload and Back cannot ask again: the
     browser moved its record of the block when this page loaded, and that would read as a doubt. */
  if (history.state && history.state.wardenOneBlocked === true) {
    show({ status: 'blocked', host: history.state.host });
    return;
  }

  try {
    chrome.runtime.sendMessage({ kind: 'grabber-navigation-status' }, (result) => {
      const answer = !chrome.runtime.lastError && result ? result : null;
      show(answer);
      if (answer && answer.status === 'blocked') {
        try { history.replaceState({ wardenOneBlocked: true, host: answer.host }, ''); } catch (_) {}
      }
    });
  } catch (_) {
    show(null);
  }
})();

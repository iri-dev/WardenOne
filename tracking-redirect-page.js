/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  if (window.top !== window) return;
  const failed = () => {
    document.getElementById('status').textContent = 'This link could not be opened safely';
    document.getElementById('detail').textContent = 'WardenOne could not confirm a safe destination for this redirect.';
    document.getElementById('back').hidden = false;
  };
  document.getElementById('back').addEventListener('click', () => history.back());
  chrome.runtime.sendMessage({ kind: 'tracking-redirect-resolve' }, result => {
    if (chrome.runtime.lastError || !result?.ok || typeof result.url !== 'string') { failed(); return; }
    try {
      const target = new URL(result.url);
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) { failed(); return; }
      location.replace(target.href);
    } catch (_) { failed(); }
  });
})();

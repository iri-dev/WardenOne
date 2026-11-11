/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
(() => {
  'use strict';
  if (window !== window.top && /(^|\.)hcaptcha\.com$/i.test(String(location.hostname || ''))) return;
  let preload;
  try {
    preload = WOEyeShieldProfiles.paintPreload(document, location, window.__wardenOneEyeShieldPreloadMode);
  } catch (_) {}
  try {
    chrome.runtime.sendMessage({ kind: 'eyeshield-bootstrap' }, (response) => {
      if (chrome.runtime.lastError || !response?.injected) preload?.remove();
    });
  } catch (_) { preload?.remove(); }
})();

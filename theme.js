/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

(() => {
  const STORAGE_KEY = 'wardenone_theme';
  const THEMES = new Set(['light', 'dark']);
  const root = document.documentElement;
  let selected = 'light';

  function normalise(value) {
    return THEMES.has(value) ? value : 'light';
  }

  function syncControls() {
    document.querySelectorAll('[data-wardenone-theme]').forEach((control) => {
      const active = control.getAttribute('data-wardenone-theme') === selected;
      control.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-wardenone-theme-status]').forEach((status) => {
      status.textContent = selected.charAt(0).toUpperCase() + selected.slice(1) + ' theme';
    });
  }

  function applyTheme(value) {
    selected = normalise(value);
    root.setAttribute('data-wardenone-theme', selected);
    root.setAttribute('data-wardenone-theme-resolved', selected);
    syncControls();
  }

  function saveTheme(value) {
    applyTheme(value);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set({ [STORAGE_KEY]: selected });
  }

  function bindControls() {
    document.querySelectorAll('[data-wardenone-theme]').forEach((control) => {
      control.addEventListener('click', () => saveTheme(control.getAttribute('data-wardenone-theme')));
    });
    syncControls();
  }

  applyTheme('light');

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(STORAGE_KEY, (stored) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const storedTheme = stored && stored[STORAGE_KEY];
        applyTheme(storedTheme);
        if (storedTheme && !THEMES.has(storedTheme)) chrome.storage.local.set({ [STORAGE_KEY]: selected });
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) applyTheme(changes[STORAGE_KEY].newValue);
      });
    }
  } catch (_) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls, { once: true });
  else bindControls();
})();

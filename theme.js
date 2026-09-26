/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

(() => {
  const STORAGE_KEY = 'wardenone_theme';
  /* Three values. Light is the default: WardenOne was designed light-first and that is the
     design a reader meets until they choose otherwise. "system" is offered beside Light and Dark
     (BUG-11 -- the controller used to know only the two) for readers who want the pages to
     follow their operating system; it resolves through prefers-color-scheme and follows a
     mid-session switch. An explicit Light or Dark wins in both directions. */
  const THEMES = new Set(['light', 'dark', 'system']);
  const DEFAULT_THEME = 'light';
  const root = document.documentElement;
  let selected = DEFAULT_THEME;
  let resolved = 'light';

  function normalise(value) {
    return THEMES.has(value) ? value : DEFAULT_THEME;
  }

  const darkQuery = (() => {
    try { return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null; } catch (_) { return null; }
  })();

  function resolve(value) {
    if (value === 'light' || value === 'dark') return value;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }

  function label() {
    if (selected === 'system') return 'System theme (' + resolved + ' right now)';
    return selected.charAt(0).toUpperCase() + selected.slice(1) + ' theme';
  }

  /* The root carries data-wardenone-theme too (applyTheme writes the choice there), so a bare
     attribute selector would take <html> for a control: it got aria-pressed="true" and a click
     listener, and every click anywhere on the page re-saved the current theme -- which, with
     nothing stored, turned "no choice yet" into an explicit one on the first click. */
  function controls() {
    return Array.from(document.querySelectorAll('[data-wardenone-theme]')).filter((el) => el !== root);
  }

  function syncControls() {
    controls().forEach((control) => {
      const active = control.getAttribute('data-wardenone-theme') === selected;
      control.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-wardenone-theme-status]').forEach((status) => {
      status.textContent = label();
    });
  }

  /* The choice is the attribute the controls read; what it resolves to is the one the CSS
     reads (data-wardenone-theme-resolved), so the palette rules never have to know about
     "system". color-scheme follows the resolved value in theme.css, so form controls and
     scrollbars follow too. */
  function applyTheme(value) {
    selected = normalise(value);
    resolved = resolve(selected);
    root.setAttribute('data-wardenone-theme', selected);
    root.setAttribute('data-wardenone-theme-resolved', resolved);
    syncControls();
  }

  /* A same-origin mirror of the stored choice, read synchronously before the first paint. The
     authoritative copy is chrome.storage.local, but that read is asynchronous, and a reader who
     chose Dark (or System on a dark machine) would otherwise see a light flash on every page
     until it lands. Missing or blocked storage means no mirror, which means the Light default
     -- never a wrong theme. */
  function readMirror() {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null; } catch (_) { return null; }
  }
  function writeMirror(value) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
  }

  function saveTheme(value) {
    applyTheme(value);
    writeMirror(selected);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set({ [STORAGE_KEY]: selected });
  }

  function bindControls() {
    controls().forEach((control) => {
      control.addEventListener('click', () => saveTheme(control.getAttribute('data-wardenone-theme')));
    });
    syncControls();
  }

  applyTheme(readMirror());

  /* An open page follows the operating system while the choice is "system". */
  try {
    if (darkQuery && typeof darkQuery.addEventListener === 'function') {
      darkQuery.addEventListener('change', () => { if (selected === 'system') applyTheme(selected); });
    } else if (darkQuery && typeof darkQuery.addListener === 'function') {
      darkQuery.addListener(() => { if (selected === 'system') applyTheme(selected); });
    }
  } catch (_) {}

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(STORAGE_KEY, (stored) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const storedTheme = stored && stored[STORAGE_KEY];
        applyTheme(storedTheme);
        writeMirror(selected);
        if (storedTheme && !THEMES.has(storedTheme)) chrome.storage.local.set({ [STORAGE_KEY]: selected });
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
          applyTheme(changes[STORAGE_KEY].newValue);
          writeMirror(selected);
        }
      });
    }
  } catch (_) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls, { once: true });
  else bindControls();
})();

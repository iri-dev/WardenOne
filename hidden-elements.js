/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The local manager for selectors saved by Element Zapper. */
'use strict';

const HIDDEN_STORE_KEY = 'wardenone_hidden_elements';
const $ = (id) => document.getElementById(id);
let hiddenSites = [];

function safeSelector(value) {
  const selector = String(value || '').trim();
  if (!selector || selector.length > 400 || /[{}<;@\\]/.test(selector)) return '';
  if (selector.indexOf('/*') >= 0 || selector.indexOf('*/') >= 0) return '';
  for (let i = 0; i < selector.length; i++) if (selector.charCodeAt(i) < 0x20) return '';
  if (/^(html|body|:root|\*)$/i.test(selector)) return '';
  return selector;
}

function readHiddenSites() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HIDDEN_STORE_KEY, (stored) => {
      void chrome.runtime.lastError;
      const raw = stored && stored[HIDDEN_STORE_KEY];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { resolve([]); return; }
      const sites = [];
      Object.keys(raw).sort((a, b) => a.localeCompare(b)).forEach((hostname) => {
        const selectors = (Array.isArray(raw[hostname]) ? raw[hostname] : [])
          .map(safeSelector).filter(Boolean).slice(0, 100);
        if (selectors.length) sites.push({ hostname: String(hostname), selectors });
      });
      resolve(sites);
    });
  });
}

function setStatus(text, error) {
  const status = $('zap-status');
  status.textContent = text || '';
  status.style.color = error ? 'var(--wo-danger)' : '';
}

function emptyState(title, detail) {
  const empty = document.createElement('div');
  empty.className = 'empty';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const text = document.createElement('div');
  text.textContent = detail;
  empty.appendChild(strong);
  empty.appendChild(text);
  return empty;
}

function undoSelector(hostname, selector, button) {
  button.disabled = true;
  setStatus('Restoring ' + hostname + '…');
  chrome.runtime.sendMessage({ kind: 'hidden-remove', hostname, selector }, (res) => {
    const error = chrome.runtime.lastError;
    if (error || !res || !res.ok) {
      button.disabled = false;
      setStatus((res && res.error) || (error && error.message) || 'Could not restore that element.', true);
      return;
    }
    setStatus('Restored. Matching open pages were updated.');
    loadHiddenSites();
  });
}

function renderHiddenSites() {
  const list = $('site-list');
  const query = String($('zap-search').value || '').trim().toLowerCase();
  const total = hiddenSites.reduce((sum, site) => sum + site.selectors.length, 0);
  $('element-count').textContent = String(total);
  $('site-count').textContent = String(hiddenSites.length);
  list.textContent = '';

  const shown = [];
  hiddenSites.forEach((site) => {
    const hostMatch = site.hostname.toLowerCase().includes(query);
    const selectors = query && !hostMatch
      ? site.selectors.filter((selector) => selector.toLowerCase().includes(query))
      : site.selectors.slice();
    if (selectors.length) shown.push({ hostname: site.hostname, selectors });
  });

  if (!hiddenSites.length) {
    list.appendChild(emptyState('Nothing is zapped', 'Use Element Zapper on a web page and saved elements will appear here.'));
    setStatus('No saved elements.');
    return;
  }
  if (!shown.length) {
    list.appendChild(emptyState('No matches', 'Try a site name or part of the saved selector.'));
    setStatus('No zapped elements match this search.');
    return;
  }

  shown.forEach((site) => {
    const group = document.createElement('details');
    group.className = 'site';
    group.open = !!query;
    const summary = document.createElement('summary');
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = site.hostname;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = site.selectors.length + ' saved';
    /* Per site, because one site collecting twenty-nine rules is the normal case
       and "all of them" is the wrong tool for tidying up one of them. */
    const clearSite = document.createElement('button');
    clearSite.type = 'button';
    clearSite.className = 'reset small';
    clearSite.textContent = 'Reset site';
    wireReset(clearSite, () => ({
      count: site.selectors.length,
      armedLabel: 'Reset ' + site.selectors.length + '? Press again',
      warning: 'This puts every element hidden on ' + site.hostname + ' back. It cannot be undone.',
      working: 'Restoring ' + site.hostname + '…',
      done: 'Everything on ' + site.hostname + ' was restored.',
    }), () => ({ kind: 'hidden-clear', hostname: site.hostname }));
    summary.appendChild(host);
    summary.appendChild(count);
    summary.appendChild(clearSite);
    const entries = document.createElement('div');
    entries.className = 'entries';
    site.selectors.forEach((selector) => {
      const row = document.createElement('div');
      row.className = 'entry';
      const code = document.createElement('code');
      code.textContent = selector;
      code.title = selector;
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.textContent = 'Undo';
      undo.addEventListener('click', () => undoSelector(site.hostname, selector, undo));
      row.appendChild(code);
      row.appendChild(undo);
      entries.appendChild(row);
    });
    group.appendChild(summary);
    group.appendChild(entries);
    list.appendChild(group);
  });
  setStatus(query
    ? shown.reduce((sum, site) => sum + site.selectors.length, 0) + ' matching zapped element(s).'
    : total + ' zapped element(s) across ' + hiddenSites.length + ' site(s).');
}

async function loadHiddenSites() {
  hiddenSites = await readHiddenSites();
  renderHiddenSites();
}

/* Reset all: one press arms it, the second does it. A native confirm() is not
   available to a click handler in an extension page without feeling like a
   browser warning, and this is destructive enough to deserve a deliberate second
   press rather than a dialog people dismiss by reflex. The armed state times out
   so a stray click cannot sit waiting to be completed by an unrelated one. */
/* Reset, for one site or for all of them.
 *
 * Both are irreversible, so both take two presses: the first arms the button and
 * says what it is about to do, the second does it. One helper rather than two
 * copies -- the per-site button appeared later, and a second copy of this is how
 * the two end up behaving differently.
 *
 * The armed state expires so a stray press cannot sit waiting to be completed by
 * an unrelated one minutes later, and arming any button disarms the others so
 * there is never more than one loaded question on screen. */
const armedButtons = new Set();

function disarmAll() {
  armedButtons.forEach((button) => {
    clearTimeout(Number(button.dataset.armTimer) || 0);
    delete button.dataset.armTimer;
    button.removeAttribute('data-armed');
    button.textContent = button.dataset.idleLabel || button.textContent;
  });
  armedButtons.clear();
}

/**
 * Wire a destructive button. `describe()` returns { count, armedLabel, warning,
 * working, done } or null when there is nothing to do.
 */
function wireReset(button, describe, request) {
  button.dataset.idleLabel = button.textContent;
  button.addEventListener('click', (event) => {
    /* The per-site button lives inside a <summary>, where a click would
       otherwise open or close the group underneath it. */
    event.preventDefault();
    event.stopPropagation();

    const info = describe();
    if (!info || !info.count) { setStatus('There is nothing saved to reset.'); return; }

    if (button.getAttribute('data-armed') !== 'true') {
      disarmAll();
      button.setAttribute('data-armed', 'true');
      button.textContent = info.armedLabel;
      setStatus(info.warning);
      button.dataset.armTimer = String(setTimeout(() => disarmAll(), 6000));
      armedButtons.add(button);
      return;
    }

    disarmAll();
    button.disabled = true;
    setStatus(info.working);
    chrome.runtime.sendMessage(request(), (res) => {
      const error = chrome.runtime.lastError;
      button.disabled = false;
      if (error || !res || !res.ok) {
        setStatus((res && res.error) || (error && error.message) || 'Could not reset the saved rules.', true);
        return;
      }
      /* After the reload, not before: renderHiddenSites writes the status line
         last, so a message set here would be replaced by the rendered count and
         the confirmation nobody saw would be the only sign it worked. */
      loadHiddenSites().then(() => setStatus(info.done));
    });
  });
}

const resetButton = $('zap-reset');
if (resetButton) {
  wireReset(resetButton, () => {
    const count = hiddenSites.reduce((sum, site) => sum + site.selectors.length, 0);
    return {
      count,
      armedLabel: 'Reset all ' + count + '? Press again',
      warning: 'This puts every hidden element back on every site. It cannot be undone.',
      working: 'Restoring everything…',
      done: 'Everything restored. Matching open pages were updated.',
    };
  }, () => ({ kind: 'hidden-clear' }));
}

$('zap-search').addEventListener('input', renderHiddenSites);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HIDDEN_STORE_KEY]) loadHiddenSites();
});
loadHiddenSites();

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */

const POPUP_SCROLL_KEY = 'wardenone_popup_scroll_memory';
const ADVANCED_PROVIDERS_OPEN_KEY = 'wardenone_advanced_providers_open';
const POPUP_SEARCH_KEY = 'wardenone_popup_search_memory';
const POPUP_SCROLL_IDLE_MS = 450;
let popupScrollSaveTimer = 0;
let popupScrollLastSavedY = null;
let popupScrollPosition = null;
let popupScrollRestoring = false;
let popupScrollUserInteracted = false;
let popupScrollRestored = false;
let popupScrollLayoutObserver = null;
let adjustPopupScrollAnchor = () => {};
let popupMemoryLayoutReady = false;
let advancedProvidersRestoring = false;
let advancedProvidersLastOpen = null;
const popupInitialMemory = {};
const popupMemoryKeys = [POPUP_SCROLL_KEY, ADVANCED_PROVIDERS_OPEN_KEY, POPUP_SEARCH_KEY];
let restorePopupSearch = (done) => { if (typeof done === 'function') done(); };

popupMemoryKeys.forEach((key) => {
  const entry = readPopupMemoryMirror(key);
  if (entry !== null) popupInitialMemory[key] = entry;
});
/* The parser can paint while the larger control scripts are still loading. */
const popupScrollParserObserver = new MutationObserver(() => {
  if (!document.getElementById('site-dash')) return;
  popupScrollParserObserver.disconnect();
  if (popupScrollUserInteracted) return;
  const y = popupScrollSavedY(popupInitialMemory[POPUP_SCROLL_KEY]);
  if (y !== null) restoreAdvancedProvidersState(() => setPopupScrollY(popupScrollRestoreY(popupInitialMemory[POPUP_SCROLL_KEY])));
});
popupScrollParserObserver.observe(document.documentElement, { childList: true, subtree: true });
try {
  popupScrollStore().get(popupMemoryKeys, (res) => {
    if (chrome.runtime.lastError) return;
    popupMemoryKeys.forEach((key) => {
      if (popupInitialMemory[key] === undefined && res && res[key] !== undefined) writePopupMemoryMirror(key, res[key]);
    });
    if (popupMemoryLayoutReady && !popupScrollRestored && !popupScrollUserInteracted) restorePopupMemoryLayout();
  });
} catch (_) {}

function readPopupMemoryMirror(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 16384) return null;
    const entry = JSON.parse(raw);
    if (key === POPUP_SCROLL_KEY && popupScrollSavedY(entry) === null) return null;
    return entry;
  } catch (_) { return null; }
}

function writePopupMemoryMirror(key, entry) {
  popupInitialMemory[key] = entry;
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch (_) {}
}

function readInitialPopupMemory(callback) {
  callback(popupInitialMemory);
}

function restorePopupMemoryLayout() {
  popupMemoryLayoutReady = true;
  if (popupScrollUserInteracted) return;
  restorePopupSearch(() => restoreAdvancedProvidersState(restorePopupScrollPosition));
}

function popupScrollStore() {
  return (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
}

function popupScrollElement() {
  return document.scrollingElement || document.documentElement || document.body;
}

function getPopupScrollY() {
  const el = popupScrollElement();
  return Math.max(0, Math.round(el.scrollTop || window.scrollY || 0));
}

function setPopupScrollY(y) {
  const el = popupScrollElement();
  const maxY = Math.max(0, el.scrollHeight - (window.innerHeight || document.documentElement.clientHeight || 0));
  const top = Math.min(Math.max(0, Number(y) || 0), maxY);
  window.scrollTo(0, top);
  el.scrollTop = top;
}

function rememberPopupScrollPosition() {
  if (popupScrollRestoring || document.visibilityState === 'hidden') return;
  const y = getPopupScrollY();
  if (popupScrollPosition && popupScrollPosition.y === y) return;
  popupScrollPosition = { y, anchor: y > 0 ? capturePopupScrollAnchor() : null, at: Date.now() };
  writePopupMemoryMirror(POPUP_SCROLL_KEY, popupScrollPosition);
}

function flushPopupScrollPosition() {
  clearTimeout(popupScrollSaveTimer);
  popupScrollSaveTimer = 0;
  if (popupScrollRestoring || !popupScrollPosition) return;
  const y = popupScrollPosition.y;
  if (y === popupScrollLastSavedY) return;
  try {
    popupScrollStore().set({ [POPUP_SCROLL_KEY]: popupScrollPosition });
    popupScrollLastSavedY = y;
  } catch (_) {}
}

function schedulePopupScrollSave() {
  if (popupScrollRestoring || document.visibilityState === 'hidden') return;
  rememberPopupScrollPosition();
  clearTimeout(popupScrollSaveTimer);
  popupScrollSaveTimer = setTimeout(flushPopupScrollPosition, POPUP_SCROLL_IDLE_MS);
}

function stopPopupScrollRestore() {
  popupScrollUserInteracted = true;
  if (popupScrollLayoutObserver) popupScrollLayoutObserver.disconnect();
}

function capturePopupScrollAnchor() {
  const x = Math.min(170, window.innerWidth / 2);
  for (const y of [8, 32, 64, 96]) {
    const hit = document.elementFromPoint(x, y);
    const row = hit && hit.closest('.row');
    const el = row ? (row.id ? row : row.querySelector('[data-key]') || row.querySelector('input[id], select[id], button[id], details[id]')) : hit && hit.closest('[id]');
    if (!el || el.id === 'groups' || !el.getClientRects().length) continue;
    const key = el.getAttribute('data-key');
    if (!el.id && !key) continue;
    return { id: el.id || undefined, key: key || undefined, offset: el.getBoundingClientRect().top };
  }
  return null;
}

function popupScrollAnchorY(entry) {
  const anchor = entry && typeof entry === 'object' && entry.anchor;
  if (anchor && typeof anchor === 'object' && Number.isFinite(anchor.offset) && Math.abs(anchor.offset) < 1000000) {
    let el = null;
    if (typeof anchor.id === 'string' && /^[a-zA-Z][\w:-]{0,127}$/.test(anchor.id)) el = document.getElementById(anchor.id);
    else if (typeof anchor.key === 'string' && /^[a-zA-Z][\w-]{0,79}$/.test(anchor.key)) el = document.querySelector('[data-key="' + anchor.key + '"]');
    if (el && el.getClientRects().length) return getPopupScrollY() + el.getBoundingClientRect().top - anchor.offset;
  }
  return null;
}

function popupScrollRestoreY(entry) {
  const y = popupScrollAnchorY(entry);
  return y === null ? popupScrollSavedY(entry) : y;
}

function popupScrollSavedY(entry) {
  const value = entry && typeof entry === 'object' ? entry.y : entry;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const y = Number(value);
  return Number.isFinite(y) && y >= 0 ? Math.round(y) : null;
}

function restorePopupScrollPosition() {
  if (popupScrollUserInteracted || popupScrollRestored) return;
  const y = popupScrollSavedY(popupInitialMemory[POPUP_SCROLL_KEY]);
  if (y === null) return;
  popupScrollRestoring = true;
  const entry = popupInitialMemory[POPUP_SCROLL_KEY];
  setPopupScrollY(popupScrollRestoreY(entry));
  const restoredY = getPopupScrollY();
  popupScrollPosition = { y: restoredY, anchor: restoredY > 0 ? capturePopupScrollAnchor() : null, at: Date.now() };
  popupScrollRestored = true;
  popupScrollRestoring = false;
  if (entry && typeof entry === 'object' && entry.anchor) {
    adjustPopupScrollAnchor = () => {
      if (popupScrollUserInteracted || document.visibilityState === 'hidden') return;
      const target = popupScrollAnchorY(entry);
      if (target !== null && Math.abs(target - getPopupScrollY()) > 1) setPopupScrollY(target);
    };
    popupScrollLayoutObserver = new ResizeObserver(adjustPopupScrollAnchor);
    popupScrollLayoutObserver.observe(document.body);
  }
}

function initPopupScrollMemory() {
  window.addEventListener('scroll', schedulePopupScrollSave, { passive: true });
  window.addEventListener('wheel', stopPopupScrollRestore, { passive: true, once: true });
  window.addEventListener('touchstart', stopPopupScrollRestore, { passive: true, once: true });
  window.addEventListener('pointerdown', stopPopupScrollRestore, { passive: true, once: true });
  window.addEventListener('keydown', stopPopupScrollRestore, { once: true });
  window.addEventListener('pagehide', flushPopupScrollPosition);
  window.addEventListener('beforeunload', flushPopupScrollPosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPopupScrollPosition();
  });
}

function advancedProvidersPanel() {
  return document.querySelector('.advanced-providers');
}

function saveAdvancedProvidersState() {
  if (advancedProvidersRestoring) return;
  const panel = advancedProvidersPanel();
  if (!panel) return;
  if (advancedProvidersLastOpen === !!panel.open) return;
  advancedProvidersLastOpen = !!panel.open;
  const entry = { open: !!panel.open, at: Date.now() };
  writePopupMemoryMirror(ADVANCED_PROVIDERS_OPEN_KEY, entry);
  popupScrollStore().set({ [ADVANCED_PROVIDERS_OPEN_KEY]: entry });
}

function restoreAdvancedProvidersState(done) {
  const panel = advancedProvidersPanel();
  if (!panel) {
    if (typeof done === 'function') done();
    return;
  }
  readInitialPopupMemory((res) => {
    const entry = res && res[ADVANCED_PROVIDERS_OPEN_KEY];
    if (entry === undefined || entry === null) {
      if (typeof done === 'function') done();
      return;
    }
    const open = typeof entry === 'object' ? entry.open === true : entry === true;
    advancedProvidersRestoring = true;
    advancedProvidersLastOpen = open;
    panel.open = open;
    advancedProvidersRestoring = false;
    if (typeof done === 'function') done();
  });
}

function initAdvancedProvidersMemory() {
  const panel = advancedProvidersPanel();
  if (!panel) return;
  panel.addEventListener('toggle', () => {
    saveAdvancedProvidersState();
    schedulePopupScrollSave();
  });
}

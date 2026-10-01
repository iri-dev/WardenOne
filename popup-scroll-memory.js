/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */

const POPUP_SCROLL_KEY = 'wardenone_popup_scroll_memory';
const ADVANCED_PROVIDERS_OPEN_KEY = 'wardenone_advanced_providers_open';
const POPUP_SCROLL_IDLE_MS = 450;
let popupScrollSaveTimer = 0;
let popupScrollLastSavedY = null;
let popupScrollRestoring = false;
let popupScrollUserInteracted = false;
let popupScrollRestoreGeneration = 0;
let advancedProvidersRestoring = false;

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

function savePopupScrollPosition() {
  clearTimeout(popupScrollSaveTimer);
  popupScrollSaveTimer = 0;
  if (popupScrollRestoring) return;
  const y = getPopupScrollY();
  if (y === popupScrollLastSavedY) return;
  popupScrollLastSavedY = y;
  popupScrollStore().set({ [POPUP_SCROLL_KEY]: { y, at: Date.now() } });
}

function schedulePopupScrollSave() {
  if (popupScrollRestoring) return;
  clearTimeout(popupScrollSaveTimer);
  popupScrollSaveTimer = setTimeout(savePopupScrollPosition, POPUP_SCROLL_IDLE_MS);
}

function stopPopupScrollRestore() {
  popupScrollUserInteracted = true;
  popupScrollRestoreGeneration++;
  popupScrollRestoring = false;
}

function restorePopupScrollPosition() {
  if (popupScrollUserInteracted) return;
  const store = popupScrollStore();
  store.get(POPUP_SCROLL_KEY, (res) => {
    if (popupScrollUserInteracted) return;
    const entry = res && res[POPUP_SCROLL_KEY];
    const y = Number(entry && typeof entry === 'object' ? entry.y : entry);
    if (!Number.isFinite(y) || y <= 0) return;
    popupScrollRestoring = true;
    const generation = ++popupScrollRestoreGeneration;
    let tries = 0;
    const apply = () => {
      if (generation !== popupScrollRestoreGeneration || popupScrollUserInteracted) return;
      setPopupScrollY(y);
      tries += 1;
      if (tries < 6) {
        setTimeout(apply, tries < 2 ? 0 : 80);
        return;
      }
      setTimeout(() => { if (generation === popupScrollRestoreGeneration) popupScrollRestoring = false; }, 80);
    };
    requestAnimationFrame(apply);
  });
}

function initPopupScrollMemory() {
  window.addEventListener('scroll', schedulePopupScrollSave, { passive: true });
  window.addEventListener('wheel', stopPopupScrollRestore, { passive: true, once: true });
  window.addEventListener('touchstart', stopPopupScrollRestore, { passive: true, once: true });
  window.addEventListener('pointerdown', stopPopupScrollRestore, { passive: true, once: true });
  window.addEventListener('keydown', stopPopupScrollRestore, { once: true });
  window.addEventListener('pagehide', savePopupScrollPosition);
  window.addEventListener('beforeunload', savePopupScrollPosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePopupScrollPosition();
  });
}

function advancedProvidersPanel() {
  return document.querySelector('.advanced-providers');
}

function saveAdvancedProvidersState() {
  if (advancedProvidersRestoring) return;
  const panel = advancedProvidersPanel();
  if (!panel) return;
  popupScrollStore().set({ [ADVANCED_PROVIDERS_OPEN_KEY]: { open: !!panel.open, at: Date.now() } });
}

function restoreAdvancedProvidersState(done) {
  const panel = advancedProvidersPanel();
  if (!panel) {
    if (typeof done === 'function') done();
    return;
  }
  popupScrollStore().get(ADVANCED_PROVIDERS_OPEN_KEY, (res) => {
    const entry = res && res[ADVANCED_PROVIDERS_OPEN_KEY];
    if (entry === undefined || entry === null) {
      if (typeof done === 'function') done();
      return;
    }
    const open = typeof entry === 'object' ? entry.open === true : entry === true;
    advancedProvidersRestoring = true;
    panel.open = open;
    setTimeout(() => {
      advancedProvidersRestoring = false;
      if (typeof done === 'function') done();
    }, 0);
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

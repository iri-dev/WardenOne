/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */

const POPUP_SCROLL_KEY = 'wardenone_popup_scroll_memory';
const ADVANCED_PROVIDERS_OPEN_KEY = 'wardenone_advanced_providers_open';
let popupScrollSaveTimer = 0;
let popupScrollRestoring = false;
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
  if (popupScrollRestoring) return;
  const store = popupScrollStore();
  const y = getPopupScrollY();
  store.set({ [POPUP_SCROLL_KEY]: { y, at: Date.now() } });
}

function schedulePopupScrollSave() {
  if (popupScrollRestoring) return;
  clearTimeout(popupScrollSaveTimer);
  popupScrollSaveTimer = setTimeout(savePopupScrollPosition, 120);
}

function restorePopupScrollPosition() {
  const store = popupScrollStore();
  store.get(POPUP_SCROLL_KEY, (res) => {
    const entry = res && res[POPUP_SCROLL_KEY];
    const y = Number(entry && typeof entry === 'object' ? entry.y : entry);
    if (!Number.isFinite(y) || y <= 0) return;
    popupScrollRestoring = true;
    let tries = 0;
    const apply = () => {
      setPopupScrollY(y);
      tries += 1;
      if (tries < 6) {
        setTimeout(apply, tries < 2 ? 0 : 80);
        return;
      }
      setTimeout(() => { popupScrollRestoring = false; }, 80);
    };
    requestAnimationFrame(apply);
  });
}

function initPopupScrollMemory() {
  window.addEventListener('scroll', schedulePopupScrollSave, { passive: true });
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

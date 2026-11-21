/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const existing = window._satellite;
  if (existing && existing.buildInfo) return;

  const noop = () => {};
  const cookie = { get: () => undefined, set: noop, remove: noop };
  const logger = { log: noop, info: noop, warn: noop, error: noop, debug: noop, outputEnabled: false };
  /* Data elements read as empty strings: page code often calls string methods on what getVar returns. */
  window._satellite = Object.assign(existing && typeof existing === 'object' ? existing : {}, {
    buildInfo: { turbineVersion: '', turbineBuildDate: '', buildDate: '', environment: 'production' },
    environment: { id: '', stage: 'production' },
    property: { name: '' },
    company: { orgId: '' },
    track: noop,
    getVar: () => '',
    setVar: noop,
    getDataElement: () => '',
    getVisitorId: () => null,
    pageBottom: noop,
    notify: noop,
    setDebug: noop,
    readCookie: () => undefined,
    setCookie: noop,
    removeCookie: noop,
    logger,
    cookie,
  });

  /* Target and the Web SDK hide the page until they personalise it. Neither is coming once Launch is answered
     locally, so lift their documented hiding styles instead of leaving the page blank until their timeout. */
  function reveal() {
    try {
      if (!(window.adobe && window.adobe.target)) document.getElementById('at-body-style')?.remove();
      if (typeof window.alloy !== 'function') document.getElementById('alloy-prehiding')?.remove();
    } catch (_) {}
  }
  reveal();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal, { once: true });
})();

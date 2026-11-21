/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const previous = window.optimizely;
  if (previous && !Array.isArray(previous) && typeof previous.get === 'function') return;
  const queued = Array.isArray(previous) ? previous.slice() : [];

  function later(callback, value) {
    if (typeof callback === 'function') queueMicrotask(() => { try { callback(value); } catch (_) {} });
  }
  /* No experiment runs, so every query answers "nothing active" and the page shows its original version. */
  const state = {
    getActiveExperimentIds: () => [], getExperimentStates: () => ({}), getCampaignStates: () => ({}),
    getPageStates: () => ({}), getVariationMap: () => ({}), getDecisionString: () => null,
    getDecisionObject: () => null, getRedirectInfo: () => null, isGlobalHoldback: () => false,
  };
  const data = { experiments: {}, campaigns: {}, pages: {}, events: {}, audiences: {}, attributes: {},
    variations: {}, dimensions: {}, groups: {}, projectId: '', accountId: '', revision: '' };
  const visitor = { visitorId: '', attributes: {}, custom: {} };
  const pending = () => new Promise(() => {});
  const utils = { waitForElement: pending, waitUntil: pending, poll: () => () => {}, observeSelector: () => () => {} };
  const answers = { state, data, visitor, session: { sessionId: '' }, behavior: { query: () => [] }, utils };

  const listeners = [];
  function push(command) {
    try {
      if (!command || typeof command !== 'object' || Array.isArray(command)) return true;
      if (command.type === 'addListener' && command.filter && typeof command.handler === 'function') {
        listeners.push(command);
        if (command.filter.type === 'lifecycle' && (command.filter.name === 'initialized' || command.filter.name === 'activated')) {
          later(command.handler, { type: 'lifecycle', name: command.filter.name, data: {} });
        }
      }
    } catch (_) {}
    return true;
  }
  /* The older Classic API reads these as plain properties. */
  window.optimizely = {
    initialized: true,
    get: name => answers[name],
    push,
    activeExperiments: [], allExperiments: {}, variationMap: {}, variationNamesMap: {}, variationIdsMap: {},
  };
  for (const command of queued) push(command);
})();

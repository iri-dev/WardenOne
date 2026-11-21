/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const previous = window.analytics;
  if (previous && previous.initialized) return;
  const queued = Array.isArray(previous) ? previous.slice() : [];

  function later(callback) {
    if (typeof callback === 'function') queueMicrotask(() => { try { callback(); } catch (_) {} });
  }
  function lastCallback(args) {
    for (let i = args.length - 1; i >= 0; i--) if (typeof args[i] === 'function') return args[i];
    return null;
  }

  /* Each event call settles at once with nothing delivered, so a page that waits on its callback or promise carries on.
     trackLink and trackForm attach nothing, so the browser follows the link or submits the form itself. */
  const analytics = {};
  const context = (type, args) => ({ event: { type, event: typeof args[0] === 'string' ? args[0] : undefined }, logs: () => [] });
  for (const type of ['track', 'page', 'pageview', 'identify', 'group', 'alias', 'screen']) {
    analytics[type] = (...args) => { later(lastCallback(args)); return Promise.resolve(context(type, args)); };
  }
  for (const name of ['trackLink', 'trackClick', 'trackForm', 'trackSubmit', 'debug', 'on', 'once', 'off', 'reset',
    'setAnonymousId', 'addSourceMiddleware', 'addIntegrationMiddleware', 'addDestinationMiddleware', 'register',
    'deregister', 'use', 'load', 'initialize', 'timeout']) {
    analytics[name] = () => analytics;
  }
  const user = { id: () => null, anonymousId: () => null, traits: () => ({}) };
  analytics.user = () => user;
  analytics.ready = callback => { later(callback); return Promise.resolve(); };
  analytics.push = command => {
    if (!Array.isArray(command) || typeof command[0] !== 'string') return;
    const method = analytics[command[0]];
    if (typeof method === 'function' && command[0] !== 'push') {
      try { Reflect.apply(method, analytics, command.slice(1)); } catch (_) {}
    }
  };
  analytics.initialized = true;
  analytics.invoked = true;
  window.analytics = analytics;
  for (const command of queued) analytics.push(command);
})();

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const name = typeof window.GoogleAnalyticsObject === 'string' ? window.GoogleAnalyticsObject : 'ga';
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === '__proto__' || name === 'constructor') return;
  const previous = window[name];
  if (typeof previous === 'function' ? previous.loaded : previous != null) return;

  function complete(callback) {
    queueMicrotask(() => { try { callback(); } catch (_) {} });
  }

  function analytics(command, ...args) {
    if (typeof command === 'function') {
      complete(command);
      return;
    }
    if (typeof command !== 'string' || !/^(?:[\w-]+\.)?send$/.test(command)) return;
    const fields = args.at(-1);
    if (fields && typeof fields === 'object' && typeof fields.hitCallback === 'function') complete(fields.hitCallback);
  }

  const queued = typeof previous === 'function' && Array.isArray(previous.q) ? previous.q : [];
  analytics.loaded = true;
  window[name] = analytics;
  for (const args of queued) {
    try { if (args && typeof args.length === 'number') Reflect.apply(analytics, undefined, args); } catch (_) {}
  }
})();

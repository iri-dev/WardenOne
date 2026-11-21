/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const queued = window._gaq;
  if (queued != null && !Array.isArray(queued)) return;

  function later(callback) {
    if (typeof callback === 'function') queueMicrotask(() => { try { callback(); } catch (_) {} });
  }
  const hits = new Set(['_trackPageview', '_trackEvent', '_trackSocial', '_trackTiming', '_trackTrans']);
  const trackers = new Map();

  /* The classic ga.js tracker. A hit sends nothing and then runs the hitCallback field, as ga.js does once a hit is
     out, so a link that waits on it still opens. _link navigates the way ga.js does. */
  function tracker(name, account) {
    if (trackers.has(name)) return trackers.get(name);
    const fields = { account: account || '' };
    const known = {
      _set(key, value) { fields[key] = value; },
      _get: key => fields[key],
      _setAccount(value) { fields.account = value; },
      _getAccount: () => fields.account,
      _getName: () => name,
      _getVersion: () => '',
      _getLinkerUrl: url => url,
      _getVisitorCustomVar: () => undefined,
      _link(url) { if (typeof url === 'string' && url) location.assign(url); },
    };
    const self = new Proxy(known, {
      get(target, key) {
        if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
        if (typeof key !== 'string' || !key.startsWith('_')) return undefined;
        if (hits.has(key)) return () => { later(fields.hitCallback); };
        return () => {};
      },
    });
    trackers.set(name, self);
    return self;
  }

  function apply(command) {
    try {
      if (typeof command === 'function') { command(); return; }
      if (!Array.isArray(command) || typeof command[0] !== 'string') return;
      const [path, ...args] = command;
      const dot = path.lastIndexOf('.');
      const method = tracker(dot === -1 ? '' : path.slice(0, dot))[dot === -1 ? path : path.slice(dot + 1)];
      if (typeof method === 'function') Reflect.apply(method, undefined, args);
    } catch (_) {}
  }

  window._gat = {
    _getTracker: account => tracker('', account),
    _createTracker: (account, name) => tracker(name || '', account),
    _getTrackerByName: name => tracker(name || ''),
    _anonymizeIp() {},
    _forceSSL() {},
  };
  window._gaq = { push(...commands) { for (const command of commands) apply(command); return 0; } };
  for (const command of Array.isArray(queued) ? queued : []) apply(command);
})();

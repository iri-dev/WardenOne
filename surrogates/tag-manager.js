/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const source = document.currentScript?.src;
  const parameters = source ? new URL(source).searchParams : new URLSearchParams();
  const name = parameters.get('l') || 'dataLayer';
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === '__proto__' || name === 'constructor') return;
  const layer = window[name] ?? (window[name] = []);
  if (!Array.isArray(layer)) return;
  /* Google Optimize's anti-flicker snippet keeps the page invisible until a container ends it. The real container is
     not loading and Optimize no longer runs, so end it now instead of leaving the page blank until its timeout. */
  try { if (typeof layer.hide?.end === 'function') layer.hide.end(); } catch (_) {}

  const installed = Symbol.for('gtm.eventCallback');
  const previousPush = layer.push;
  if (typeof previousPush !== 'function' || previousPush[installed]) return;
  const container = parameters.get('id') || undefined;

  function finishEvent(entry) {
    try {
      if (entry?.[0] === 'event' && typeof entry[1] === 'string') {
        const callback = entry[2]?.event_callback;
        if (typeof callback === 'function') queueMicrotask(() => { try { callback(); } catch (_) {} });
        return;
      }
      if (!entry || typeof entry.event !== 'string' || !entry.event) return;
      const callback = entry.eventCallback;
      if (typeof callback === 'function') queueMicrotask(() => { try { callback(container); } catch (_) {} });
    } catch (_) {}
  }

  function push(...entries) {
    const length = Reflect.apply(previousPush, this, entries);
    if (this === layer) for (const entry of entries) finishEvent(entry);
    return length;
  }

  Object.defineProperty(push, installed, { value: true });
  try { Object.defineProperty(layer, 'push', { value: push, configurable: true, writable: true }); }
  catch (_) { return; }
  const queued = layer.length;
  for (let i = 0; i < queued; i++) finishEvent(layer[i]);
})();

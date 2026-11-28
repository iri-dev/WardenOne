/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const previous = window.adsbygoogle;
  if (previous?.loaded || (previous != null && (!Array.isArray(previous) || !Object.isExtensible(previous)))) return;
  const queue = previous || [];
  const completeSlot = () => {
    const slot = document.querySelector('ins.adsbygoogle:not([data-adsbygoogle-status])');
    if (!slot) return;
    slot.setAttribute('data-adsbygoogle-status', 'done');
    slot.setAttribute('data-ad-status', 'unfilled');
  };
  for (const request of queue) if (request && typeof request === 'object') queueMicrotask(completeSlot);
  Object.defineProperty(queue, 'push', { configurable: true, writable: true, value(...entries) {
    const size = Array.prototype.push.apply(this, entries);
    if (this === queue) for (const request of entries) if (request && typeof request === 'object') queueMicrotask(completeSlot);
    return size;
  } });
  queue.loaded = true;
  window.adsbygoogle = queue;
})();

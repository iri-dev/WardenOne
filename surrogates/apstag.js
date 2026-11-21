/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const previous = window.apstag;
  const queued = previous && Array.isArray(previous._Q) ? previous._Q : null;
  if (previous && !queued && typeof previous.fetchBids === 'function') return;

  function later(callback, value) {
    if (typeof callback === 'function') queueMicrotask(() => { try { callback(value); } catch (_) {} });
  }
  /* Every slot comes back with no bid, which is what an auction with no buyer returns, so the page renders its own
     fallback or leaves the slot empty. */
  const noBid = slot => ({ slotID: slot && slot.slotID, amzniid: '', amznbid: '', amznp: '', amznsz: '0x0', amznactt: '', size: '0x0' });
  const noop = () => {};
  const apstag = {
    init: noop,
    fetchBids(config, callback) {
      const slots = config && Array.isArray(config.slots) ? config.slots : [];
      later(callback, slots.map(noBid));
    },
    setDisplayBids: noop,
    targetingKeys: () => [],
    renderImp: noop,
    debug: noop,
    deleteId: noop,
    rpa(_config, callback) { later(callback); },
    upa(_config, callback) { later(callback); },
    dpa(callback) { later(callback); },
  };
  window.apstag = apstag;
  for (const entry of queued || []) {
    try {
      const [kind, args] = entry;
      const method = kind === 'i' ? apstag.init : kind === 'f' ? apstag.fetchBids : null;
      if (method) Reflect.apply(method, apstag, Array.from(args || []));
    } catch (_) {}
  }
})();

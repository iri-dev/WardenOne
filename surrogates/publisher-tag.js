/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const tag = window.googletag ?? (window.googletag = {});
  if (typeof tag !== 'object' || tag.apiReady || typeof tag.pubads === 'function') return;

  const slots = new Map(), adSlots = new Set(), displayed = new Set(), listeners = new Set();
  let disableInitialLoad = false, nextSlotId = 0;

  function finishEmpty(slot) {
    queueMicrotask(() => {
      if (!displayed.has(slot) || !adSlots.has(slot)) return;
      const event = { slot, isEmpty: true, serviceName: 'publisher_ads', size: null };
      for (const listener of [...listeners]) {
        try { listener(event); } catch (_) {}
      }
    });
  }

  const service = {
    addEventListener(name, listener) {
      if (name === 'slotRenderEnded' && typeof listener === 'function') listeners.add(listener);
    },
    removeEventListener(name, listener) { if (name === 'slotRenderEnded') listeners.delete(listener); },
    getSlots: () => [...adSlots],
    setTargeting: () => service,
    setPrivacySettings: () => service,
    enableSingleRequest: () => true,
    disableInitialLoad() { if (!tag.pubadsReady) disableInitialLoad = true; },
    isInitialLoadDisabled: () => disableInitialLoad,
    refresh(requested) {
      const targets = requested ?? displayed;
      if (!tag.pubadsReady || (targets !== displayed && !Array.isArray(targets))) return;
      for (const slot of targets) if (displayed.has(slot) && adSlots.has(slot)) finishEmpty(slot);
    },
  };

  const queued = Array.isArray(tag.cmd) ? tag.cmd : [];
  const pending = [];
  let running = false, processed = 0;
  function run(commands) {
    for (const command of commands) if (typeof command === 'function') pending.push(command);
    if (running) return processed;
    running = true;
    for (const command of pending) {
      processed++;
      try { command.call(window); } catch (_) {}
    }
    pending.length = 0;
    running = false;
    return processed;
  }

  const api = {
    cmd: { push: (...commands) => run(commands) },
    pubads: () => service,
    defineSlot(path, _size, id) {
      if (typeof path !== 'string') return null;
      if (id === undefined) {
        do { id = 'google_ads_' + ++nextSlotId; } while (slots.has(id));
      }
      if (typeof id !== 'string' || !id || slots.has(id)) return null;
      const slot = {
        addService(value) { if (value === service && slots.get(id) === slot) adSlots.add(slot); return slot; },
        getAdUnitPath: () => path,
        getSlotElementId: () => id,
        setTargeting: () => slot,
      };
      slots.set(id, slot);
      return slot;
    },
    setConfig(config) {
      if (!tag.pubadsReady && typeof config?.disableInitialLoad === 'boolean') disableInitialLoad = config.disableInitialLoad;
    },
    enableServices() { tag.pubadsReady = true; },
    display(target) {
      const slot = slots.get(typeof target === 'string' ? target : target?.id) || target;
      if (!adSlots.has(slot) || displayed.has(slot)) return;
      displayed.add(slot);
      if (tag.pubadsReady && !disableInitialLoad) finishEmpty(slot);
    },
    destroySlots(requested = [...slots.values()]) {
      if (!Array.isArray(requested)) return false;
      let removed = false;
      for (const [id, slot] of slots) {
        if (!requested.includes(slot)) continue;
        slots.delete(id);
        adSlots.delete(slot);
        displayed.delete(slot);
        removed = true;
      }
      return removed;
    },
    apiReady: true,
  };
  try { Object.assign(tag, api); } catch (_) { return; }
  run(queued);
})();

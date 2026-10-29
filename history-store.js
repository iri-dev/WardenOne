/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

var WO_HISTORY = (() => {
  let serial = Promise.resolve(), epoch = 0, changing = false;
  const keys = ['wardenone_history', 'wardenone_notifications'];
  const mode = config => config && config.historyMode !== undefined
    ? (['normal', 'session', 'off'].includes(config.historyMode) ? config.historyMode : 'off') : 'normal';
  const step = task => {
    const run = serial.then(task);
    serial = run.catch(() => {});
    return run;
  };
  const context = async () => {
    const stored = await chrome.storage.local.get('wardenone_config');
    const config = stored && stored.wardenone_config || {};
    const selected = typeof INCOGNITO_CONTEXT !== 'undefined' && INCOGNITO_CONTEXT ? 'off' : mode(config);
    return { config, mode: selected, area: selected === 'normal' ? chrome.storage.local : chrome.storage.session };
  };
  const read = (key, callback) => {
    const token = epoch;
    const run = step(async () => {
      const selected = await context();
      const value = !changing && token === epoch && selected.mode !== 'off' ? await selected.area.get(key) : {};
      if (changing || token !== epoch) return {};
      return value || {};
    });
    if (callback) run.then(callback, error => callback({}, error));
    return run;
  };
  const write = (values, callback, token = epoch) => {
    const blocked = changing;
    const run = step(async () => {
      const selected = await context();
      if (blocked || changing || token !== epoch || selected.mode === 'off') return;
      await selected.area.set(values);
    });
    if (callback) run.then(() => callback(), callback);
    return run;
  };
  const journal = (entries, token = epoch) => {
    const blocked = changing;
    return step(async () => {
      const selected = await context();
      if (blocked || changing || token !== epoch || selected.mode === 'off') return;
      if (entries.length) await chrome.storage.session.set({ __wardenone_hist_buffer: entries });
      else await chrome.storage.session.remove('__wardenone_hist_buffer');
    });
  };
  const revoke = () => {
    changing = true; epoch++;
    if (typeof discardProtectionHistoryBuffers === 'function') discardProtectionHistoryBuffers();
    return serial;
  };
  const erase = async task => {
    if (changing) throw new Error('A history change is already running.');
    const drained = revoke();
    try {
      await drained;
      await Promise.all([chrome.storage.local.remove(keys),
        chrome.storage.session.remove([...keys, '__wardenone_hist_buffer'])]);
      if (task) await task();
    } finally { changing = false; }
  };
  return { mode, context, read, write, journal, erase, revoke, drain: () => serial,
    resume: () => { changing = false; },
    get epoch() { return epoch; }, get changing() { return changing; } };
})();

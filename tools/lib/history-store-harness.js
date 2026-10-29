/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../history-store.js'), 'utf8');
function install(box) {
  box.chrome ||= {};
  box.chrome.storage ||= {};
  box.chrome.storage.local ||= { get: box.localGet, set: box.localSet, remove: async () => {} };
  box.chrome.storage.session ||= { get: async () => ({}), set: async () => {}, remove: async () => {} };
  for (const area of [box.chrome.storage.local, box.chrome.storage.session]) {
    for (const key of ['get', 'set', 'remove']) {
      const original = area[key];
      if (!original) continue;
      area[key] = (...args) => {
        if (typeof args[args.length - 1] === 'function') return original.apply(area, args);
        return new Promise((resolve, reject) => {
          const callback = value => {
            const error = box.chrome.runtime && box.chrome.runtime.lastError;
            if (error) reject(new Error(error.message)); else resolve(value);
          };
          const returned = original.apply(area, [...args, callback]);
          if (returned && typeof returned.then === 'function') returned.then(resolve, reject);
        });
      };
    }
  }
  if (!vm.isContext(box)) vm.createContext(box);
  vm.runInContext(source, box, { filename: 'history-store.js' });
  return box.WO_HISTORY;
}
module.exports = { install };

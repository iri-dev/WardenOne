/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
function wardenOneSetPrivacySignals(enabled) {
  const name = '__wardenOnePrivacySignals';
  let control = window[name];
  if (!control && enabled !== true) return;
  if (!control) {
    const targets = [[Navigator.prototype, 'globalPrivacyControl', true], [navigator, 'globalPrivacyControl', true],
      [Navigator.prototype, 'doNotTrack', '1'], [navigator, 'doNotTrack', '1'], [window, 'doNotTrack', '1']];
    const entries = targets.map(([owner, key, value]) => ({ owner, key, value, original: Object.getOwnPropertyDescriptor(owner, key), getter: null }));
    const set = on => {
      for (const entry of entries) {
        try {
          const current = Object.getOwnPropertyDescriptor(entry.owner, entry.key);
          if (on === true) {
            if (entry.getter) continue;
            if (current && current.configurable === false) continue;
            entry.original = current;
            entry.getter = () => entry.value;
            Object.defineProperty(entry.owner, entry.key, { get: entry.getter, configurable: true, enumerable: true });
          } else if (entry.getter) {
            // Restore only a descriptor we still own; preserve changes made by the browser or page.
            if (current?.get === entry.getter) {
              if (entry.original) Object.defineProperty(entry.owner, entry.key, entry.original);
              else delete entry.owner[entry.key];
            }
            entry.getter = null;
          }
        } catch (_) {}
      }
    };
    control = Object.freeze({ set });
    try { Object.defineProperty(window, name, { value: control, configurable: false, enumerable: false }); }
    catch (_) { return; }
  }
  if (typeof control.set === 'function') control.set(enabled === true);
}
if (typeof window !== 'undefined') wardenOneSetPrivacySignals(true);
if (typeof module !== 'undefined') module.exports = wardenOneSetPrivacySignals;

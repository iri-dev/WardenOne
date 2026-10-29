/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE · Official source: https://github.com/iri-dev/WardenOne · Upstream filter-list attribution: CREDITS.md · A modified copy must say so, with a date (GPLv3 5a), and keep this notice. */
/* fingerprint-realm.js is GENERATED; rebuild with tools/build-content.js after editing this bootstrap or src/content.js.
   Same-origin children inherit the protected seed; cross-origin children await signed config. Workers stay native because
   re-serving source breaks URLs and imports. */
(function () {
  'use strict';
  /* Skip realms already owned by the top-frame engine; patch child and blank/blob popup realms once. */
  let isTop = false;
  try { isTop = window.top === window.self; } catch (_) { isTop = false; }
  let scheme = '';
  try { scheme = String(location.protocol || '').toLowerCase(); } catch (_) { scheme = ''; }
  if (isTop && /^(?:https?|file):$/.test(scheme)) return;
  /* Once per document. The accessor below is non-configurable, so its presence is the proof
     that this module (or the engine) already ran in this realm. */
  try { if (Object.getOwnPropertyDescriptor(window, '__wardenOneRealm')) return; } catch (_) {}

  /* ---- 2. This realm's record, for the realms a page can reach from here ------------------- */
  const OFF = Object.freeze({ v: 1, noise: false, webglBlocked: false });
  let record = null;
  try {
    Object.defineProperty(window, '__wardenOneRealm', {
      get: function () { return record; },
      configurable: false,
      enumerable: false,
    });
  } catch (_) {}
  const settledHere = () => {
    try { document.dispatchEvent(new CustomEvent('wo-realm-settled')); } catch (_) {}
  };

  /* Build markers splice the engine’s authentication and noise implementations into this bootstrap. */
  /* @wardenone-include AUTH */
  /* @wardenone-include WEBGL-SAVER */
  /* @wardenone-include FINGERPRINT-NOISE */
  const webglControl = __woWebGLSaver();

  /* ---- 4. Settling ---------------------------------------------------------------------------
     A realm settles once. `inherited` is a parent's record (its seed is reused) or null. */
  let settled = false;
  const publishWebGL = (blocked) => {
    webglControl.set(blocked === true);
    if (!record) return;
    record = Object.freeze(Object.assign({}, record, { webglBlocked: blocked === true }));
    settledHere();
  };
  const settle = (noise, blocked, inherited) => {
    if (settled) return;
    settled = true;
    if (noise) {
      try { record = __woFingerprintNoise(inherited || null); } catch (_) { record = OFF; }
    } else {
      record = OFF;
    }
    record = Object.freeze(Object.assign({}, record, { webglBlocked: blocked === true }));
    webglControl.set(blocked === true);
    settledHere();
  };
  const validRecord = (r) => !!(r && typeof r === 'object' && r.v === 1 && typeof r.noise === 'boolean');

  /* Adopt from parent, top, then opener where same-origin reads succeed. Capture these windows now:
     page code can later replace parent/opener, but not their protected realm-record accessors. */
  const SOURCES = (() => {
    const out = [];
    try { if (window.parent && window.parent !== window) out.push(window.parent); } catch (_) {}
    try { if (window.top && window.top !== window && out.indexOf(window.top) < 0) out.push(window.top); } catch (_) {}
    try { if (window.opener && window.opener !== window) out.push(window.opener); } catch (_) {}
    return out;
  })();
  const adopt = () => {
    for (let i = 0; i < SOURCES.length; i++) {
      try {
        const r = SOURCES[i].__wardenOneRealm;
        if (validRecord(r)) return r;
      } catch (_) {}
    }
    return null;
  };
  const early = adopt();
  if (early) settle(early.noise, early.webglBlocked === true, early);

  /* Listen for an upstream verdict while configuration is pending. Page-generated events only trigger a re-read of the
     protected record. */
  const adoptLater = () => {
    const late = adopt();
    if (!late) return;
    if (settled) publishWebGL(late.webglBlocked === true);
    else settle(late.noise, late.webglBlocked === true, late);
  };
  SOURCES.forEach((w) => {
    try { w.document.addEventListener('wo-realm-settled', adoptLater, true); } catch (_) {}
  });

  /* Accept the one-time key only before executable page content could have run. Initial about:blank
     children already have a body and must use same-origin adoption rather than accept a forged key. */
  let token = null;
  let key = null;
  let lastSeq = 0;
  document.addEventListener('wo-key', (e) => {
    const d = e && e.detail;
    if (key !== null || !d || typeof d.token !== 'string' || !d.token || typeof d.key !== 'string' || !d.key) return;
    if (!/^[0-9a-f]{64}$/i.test(d.key) || __woAuth.pageCouldHaveRun(document)) return;
    token = d.token;
    key = __woAuth.key(d.key);
  }, true);
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const m = event.data || {};
    if (m.source !== 'wardenone' || m.kind !== 'config' || token === null || m.token !== token) return;
    const verified = __woAuth.config(m, key, lastSeq);
    if (!verified) return;
    lastSeq = verified.seq;
    const config = verified.overrides;
    /* The parent's answer normally lands before this frame's own. Mirroring it keeps the realms
       a page can compare agreeing on the numbers, so adoption is tried once more first. */
    const late = adopt();
    if (late) {
      if (settled) publishWebGL(late.webglBlocked === true);
      else settle(late.noise, late.webglBlocked === true, late);
      return;
    }
    if (settled) publishWebGL(config.webglDisabled === true);
    else settle(config.frameNoise === true, config.webglDisabled === true, null);
  }, true);
  /* The bridge may have run first, and handed its key to a document with no listener yet. */
  if (!early) try { document.dispatchEvent(new CustomEvent('wo-bridge-replay')); } catch (_) {}
}());

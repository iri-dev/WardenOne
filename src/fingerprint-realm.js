/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE · Official source: https://github.com/iri-dev/WardenOne · Upstream filter-list attribution: CREDITS.md · A modified copy must say so, with a date (GPLv3 5a), and keep this notice. */
/* fingerprint-realm.js is GENERATED. Do not edit it: edit src/fingerprint-realm.js (this
   bootstrap) or src/content.js (the two regions marked below, copied out byte for byte) and run
   `node tools/build-content.js`. `node tools/build-content.js --check` fails when they drift.

   The anti-fingerprinting noise is realm-local: it rewrites the prototypes of the realm it runs
   in and nothing else. The engine (content.min.js) runs in the top frame only, so every child
   frame used to be a fresh realm with untouched prototypes -- and a page did not have to defeat
   a single wrapper, it could pick a realm that had none. A hidden same-origin iframe hands over
   a clean HTMLCanvasElement.prototype.toDataURL that works on a top-frame canvas; a third-party
   frame measures itself and posts the result up; a cooperating frame does the same. This module
   is the realm-level half of the answer (SEC-05): the identical noise function, run in every
   frame the engine's manifest entry does not reach, with the same shared seed, so the realms a
   page can compare agree with each other the way a real browser's realms do.

   What it decides, and from where. A frame that is same-origin with its parent (about:blank,
   srcdoc, a real URL) reads the parent's realm record synchronously at document_start, before
   the parent page's appendChild has returned -- so the child is patched before anything can
   borrow from it, and inherits the parent's verdict and seed. A cross-origin frame cannot read
   its parent; it waits for the config its own isolated bridge fetches from the worker, which
   carries the verdict for THIS frame (frameNoise: the reader's switch, the pause and per-site
   choices for both the frame's host and the page's top host). Nothing here reads a switch off
   window: the record is a non-configurable accessor the page cannot redefine, and the config
   counts only when it carries the bridge's signature.

   Not covered, and said so where the switch is described: web workers. A worker's realm is
   unreachable from any content script, and the one way in -- re-serving the worker's source
   from a blob -- changes self.location under scripts that use it, breaks module workers'
   relative imports, and is forbidden for service workers (tools/test-known-limits.js pins that
   decision). OffscreenCanvas inside a worker therefore still answers with the real machine. */
(function () {
  'use strict';
  /* ---- 1. Where the engine already is, this module is not ------------------------------------
     The engine owns the top frame of every http(s) (and file:) page and installs the noise there
     itself. This module is for the realms its manifest entry never reaches: every child frame,
     including about:blank and srcdoc children and blob:/data: children, and the top-level
     about:blank or blob: window a page opens with window.open. Two engines in one realm would
     patch it twice, and a wrapper wrapped is the kind of thing a detector looks for. */
  let isTop = false;
  try { isTop = window.top === window.self; } catch (_) { isTop = false; }
  let scheme = '';
  try { scheme = String(location.protocol || '').toLowerCase(); } catch (_) { scheme = ''; }
  if (isTop && /^(?:https?|file):$/.test(scheme)) return;
  /* Once per document. The accessor below is non-configurable, so its presence is the proof
     that this module (or the engine) already ran in this realm. */
  try { if (Object.getOwnPropertyDescriptor(window, '__wardenOneRealm')) return; } catch (_) {}

  /* ---- 2. This realm's record, for the realms a page can reach from here ------------------- */
  const OFF = Object.freeze({ v: 1, noise: false });
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

  /* ---- 3. The two regions shared with the engine ---------------------------------------------
     __woAuth (HMAC-SHA256, plain JS) verifies the bridge's signed config, exactly as the engine
     does; __woFingerprintNoise installs the noise and returns the record to publish. Both are the
     engine's own text, spliced in by the build. */
  /* @wardenone-include AUTH */
  /* @wardenone-include FINGERPRINT-NOISE */

  /* ---- 4. Settling ---------------------------------------------------------------------------
     A realm settles once. `inherited` is a parent's record (its seed is reused) or null. */
  let settled = false;
  const settle = (noise, inherited) => {
    if (settled) return;
    settled = true;
    if (noise) {
      try { record = __woFingerprintNoise(inherited || null); } catch (_) { record = OFF; }
    } else {
      record = OFF;
    }
    settledHere();
  };
  const validRecord = (r) => !!(r && typeof r === 'object' && r.v === 1 && typeof r.noise === 'boolean');

  /* ---- 5. Adoption: read a same-origin ancestor's record ------------------------------------
     parent first, then top (a same-origin grandparent past a cross-origin parent), then the
     opener for a top-level about:blank/blob: window. A cross-origin read throws and is skipped.
     Captured ONCE, now: at document_start nobody has touched this realm yet, so parent, top and
     opener are what the browser says they are -- but `parent` and `opener` are replaceable, and
     a same-origin page could point them at an object of its own the moment this returns. The
     late paths below read only these captured windows, whose record accessors cannot be redefined. */
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
  if (early) { settle(early.noise, early); return; }

  /* Not decided upstream yet -- the parent's own config has not landed. Listen on every
     same-origin source for the moment it settles, and adopt then. A page can dispatch this
     event too; hearing it only makes this realm re-read the record. */
  const adoptLater = () => {
    if (settled) return;
    const late = adopt();
    if (late) settle(late.noise, late);
  };
  SOURCES.forEach((w) => {
    try { w.document.addEventListener('wo-realm-settled', adoptLater, true); } catch (_) {}
  });

  /* ---- 6. Otherwise, this frame's own verified config -----------------------------------------
     The key arrives once, in the bridge's synchronous wo-key event at document_start, and only
     while no page script can have run -- the same rule the bridge applies before it hands the key
     over. In an initial about:blank document the body already exists, so the bridge never
     delivers there and neither is a key accepted there: a page dispatching its own wo-key into a
     child it created does not get to sign that child's config. Such a child is same-origin with
     its creator by construction and is settled by adoption above instead. */
  const INERT_TAG = /^(?:head|meta|title|link|style|base)$/;
  const pageCouldHaveRun = () => {
    try {
      if (document.readyState !== 'loading' || document.body) return true;
      const root = document.documentElement;
      if (!root) return false;
      const all = root.getElementsByTagName('*');
      if (all.length > 64) return true;
      for (let i = -1; i < all.length; i++) {
        const el = i < 0 ? root : all[i];
        if (i >= 0 && !INERT_TAG.test(String(el.localName || '').toLowerCase())) return true;
        const attrs = el.attributes;
        for (let j = 0; attrs && j < attrs.length; j++) {
          if (/^on/i.test(String(attrs[j].name || ''))) return true;
        }
      }
      return false;
    } catch (_) { return true; }
  };
  let token = null;
  let key = null;
  let lastSeq = 0;
  const verify = (kind, payload, m) => {
    if (key === null || !m) return false;
    const seq = Number(m.seq);
    if (!Number.isInteger(seq) || seq <= lastSeq) return false;
    if (!__woAuth.same(m.mac, __woAuth.hmac(key, seq + '\n' + kind + '\n' + String(payload)))) return false;
    lastSeq = seq;
    return true;
  };
  document.addEventListener('wo-key', (e) => {
    const d = e && e.detail;
    if (key !== null || !d || typeof d.token !== 'string' || !d.token || typeof d.key !== 'string' || !d.key) return;
    if (pageCouldHaveRun()) return;
    token = d.token;
    key = d.key;
  }, true);
  window.addEventListener('message', (event) => {
    if (settled || event.source !== window) return;
    const m = event.data || {};
    if (m.source !== 'wardenone' || m.kind !== 'config' || token === null || m.token !== token) return;
    if (!m.overrides || typeof m.overrides !== 'object') return;
    if (!verify('config', JSON.stringify(m.overrides), m)) return;
    /* The parent's answer normally lands before this frame's own. Mirroring it keeps the realms
       a page can compare agreeing on the numbers, so adoption is tried once more first. */
    const late = adopt();
    if (late) { settle(late.noise, late); return; }
    settle(m.overrides.frameNoise === true, null);
  }, true);
  /* The bridge may have run first, and handed its key to a document with no listener yet. */
  try { document.dispatchEvent(new CustomEvent('wo-bridge-replay')); } catch (_) {}
}());

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Permission Chain Guard (MAIN world)
 * Watches for sensitive browser capability requests in sequence. It does not
 * read clipboard contents, file names, media streams, or location values.
 */
(function () {
  'use strict';

  const WO_GUARD_VERSION = '1.0.0';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOnePermissionChainInstalled === WO_GUARD_VERSION) return;
  if (window.__wardenOnePermissionChainInstalled) {
    try {
      if (typeof window.__wardenOnePermissionChainDispose === 'function') window.__wardenOnePermissionChainDispose();
    } catch (_) {}
  }
  window.__wardenOnePermissionChainInstalled = WO_GUARD_VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  window.__wardenOnePermissionChainDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
  };

  let woToken = null;
  let chainEnabled = false;
  const queued = [];
  const lastSignalAt = Object.create(null);
  let lastGestureAt = 0;

  function now() {
    return Date.now();
  }

  function noteGesture(e) {
    try {
      if (!e || e.isTrusted === false) return;
      lastGestureAt = now();
    } catch (_) {}
  }

  try {
    woOn(window, 'pointerdown', noteGesture, true);
    woOn(window, 'keydown', noteGesture, true);
    woOn(window, 'touchstart', noteGesture, true);
  } catch (_) {}

  function hasRecentGesture() {
    return now() - lastGestureAt < 5000;
  }

  function cleanPermission(value) {
    const raw = String(value || '').toLowerCase().replace(/_/g, '-').trim();
    const aliases = {
      notification: 'notifications',
      clipboard: 'clipboard-read',
      clipboardread: 'clipboard-read',
      clipboardwrite: 'clipboard-write',
      geolocation: 'location',
      display: 'screen',
      screenshare: 'screen',
      file: 'file-open',
      filesystem: 'file-open',
      directorypicker: 'directory',
      automaticdownloads: 'automatic-downloads',
    };
    const key = aliases[raw] || raw;
    return /^(notifications|camera|microphone|screen|clipboard-read|clipboard-write|location|file-open|file-save|directory|file-upload|automatic-downloads)$/.test(key) ? key : '';
  }

  function cleanHost(value) {
    return String(value || '').replace(/^www\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
  }

  function hostAllowedByUser(cfg) {
    const host = cleanHost(location.hostname);
    const list = Array.isArray(cfg && cfg.allowlist) ? cfg.allowlist : [];
    return list.some((item) => {
      const d = cleanHost(item);
      return !!(d && (host === d || host.endsWith('.' + d)));
    });
  }

  function emit(permission, action, extra) {
    if (!chainEnabled) return;
    const key = cleanPermission(permission);
    if (!key) return;
    const act = String(action || 'request').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const bucket = key + ':' + act;
    const t = now();
    if (lastSignalAt[bucket] && t - lastSignalAt[bucket] < 2500) return;
    lastSignalAt[bucket] = t;
    const detail = Object.assign({
      token: woToken,
      permission: key,
      action: act,
      userGesture: hasRecentGesture(),
    }, extra && typeof extra === 'object' ? extra : {});
    if (!woToken) {
      queued.push(detail);
      if (queued.length > 40) queued.shift();
      return;
    }
    try {
      document.dispatchEvent(new CustomEvent('wo-permission-signal', { detail }));
    } catch (_) {}
  }

  function flushQueued() {
    if (!woToken) return;
    while (queued.length) {
      const detail = queued.shift();
      detail.token = woToken;
      try {
        document.dispatchEvent(new CustomEvent('wo-permission-signal', { detail }));
      } catch (_) {}
    }
  }

  try {
    woOn(window, 'message', (e) => {
      if (e.source !== window) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.source === 'wardenone-handshake' && typeof m.token === 'string' && !woToken) {
        woToken = m.token;
        flushQueued();
        return;
      }
      if (m.source === 'wardenone' && m.kind === 'config' && (!woToken || m.token === woToken)) {
        const cfg = m.overrides || {};
        chainEnabled = cfg.enabled !== false && cfg.permissionChainGuard !== false && !hostAllowedByUser(cfg);
      }
    }, true);
  } catch (_) {}

  function wrapMethod(obj, name, wrapper) {
    try {
      if (!obj || obj.__woPermChainPatched && obj.__woPermChainPatched[name]) return;
      const original = obj[name];
      if (typeof original !== 'function') return;
      const wrapped = wrapper(original);
      try { Object.defineProperty(wrapped, 'name', { value: original.name || name }); } catch (_) {}
      try { Object.defineProperty(wrapped, 'length', { value: original.length }); } catch (_) {}
      obj[name] = wrapped;
      if (!obj.__woPermChainPatched) {
        try { Object.defineProperty(obj, '__woPermChainPatched', { value: Object.create(null) }); } catch (_) { obj.__woPermChainPatched = Object.create(null); }
      }
      obj.__woPermChainPatched[name] = true;
    } catch (_) {}
  }

  function mediaKinds(constraints) {
    const out = [];
    try {
      const c = constraints || {};
      if (c.video) out.push('camera');
      if (c.audio) out.push('microphone');
    } catch (_) {}
    return out.length ? out : ['camera', 'microphone'];
  }

  function patchNotifications() {
    try {
      const N = window.Notification;
      if (!N || typeof N.requestPermission !== 'function' || N.__woPermChainRequest) return;
      const original = N.requestPermission;
      const wrapped = function (callback) {
        emit('notifications', 'request');
        const cb = typeof callback === 'function' ? function (result) {
          emit('notifications', result === 'granted' ? 'granted' : 'denied', { result: String(result || '') });
          return callback.apply(this, arguments);
        } : callback;
        const ret = original.call(this, cb);
        if (ret && typeof ret.then === 'function') {
          return ret.then((result) => {
            emit('notifications', result === 'granted' ? 'granted' : 'denied', { result: String(result || '') });
            return result;
          }, (err) => {
            emit('notifications', 'error');
            throw err;
          });
        }
        return ret;
      };
      try { Object.defineProperty(wrapped, 'name', { value: original.name || 'requestPermission' }); } catch (_) {}
      N.requestPermission = wrapped;
      try { Object.defineProperty(N, '__woPermChainRequest', { value: true }); } catch (_) { N.__woPermChainRequest = true; }
    } catch (_) {}
  }

  function patchMedia() {
    try {
      const md = navigator.mediaDevices;
      if (!md) return;
      wrapMethod(md, 'getUserMedia', (original) => function (constraints) {
        const kinds = mediaKinds(constraints);
        kinds.forEach((k) => emit(k, 'request'));
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((stream) => {
            kinds.forEach((k) => emit(k, 'granted'));
            return stream;
          }, (err) => {
            kinds.forEach((k) => emit(k, 'denied', { result: String((err && err.name) || '') }));
            throw err;
          });
        }
        return ret;
      });
      wrapMethod(md, 'getDisplayMedia', (original) => function () {
        emit('screen', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((stream) => {
            emit('screen', 'granted');
            return stream;
          }, (err) => {
            emit('screen', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
    } catch (_) {}
  }

  function patchClipboard() {
    try {
      const cb = navigator.clipboard;
      if (!cb) return;
      ['read', 'readText'].forEach((name) => {
        wrapMethod(cb, name, (original) => function () {
          emit('clipboard-read', 'request');
          const ret = original.apply(this, arguments);
          if (ret && typeof ret.then === 'function') {
            return ret.then((value) => {
              emit('clipboard-read', 'granted');
              return value;
            }, (err) => {
              emit('clipboard-read', 'denied', { result: String((err && err.name) || '') });
              throw err;
            });
          }
          return ret;
        });
      });
      ['write', 'writeText'].forEach((name) => {
        wrapMethod(cb, name, (original) => function () {
          emit('clipboard-write', 'used');
          return original.apply(this, arguments);
        });
      });
    } catch (_) {}
  }

  function patchGeolocation() {
    try {
      const geo = navigator.geolocation;
      if (!geo) return;
      ['getCurrentPosition', 'watchPosition'].forEach((name) => {
        wrapMethod(geo, name, (original) => function (success, error) {
          emit('location', 'request');
          const wrappedSuccess = typeof success === 'function' ? function () {
            emit('location', 'granted');
            return success.apply(this, arguments);
          } : success;
          const wrappedError = typeof error === 'function' ? function (err) {
            emit('location', 'denied', { result: String((err && err.code) || '') });
            return error.apply(this, arguments);
          } : function (err) {
            emit('location', 'denied', { result: String((err && err.code) || '') });
          };
          return original.call(this, wrappedSuccess, wrappedError, arguments[2]);
        });
      });
    } catch (_) {}
  }

  function patchFilePickers() {
    try {
      wrapMethod(window, 'showOpenFilePicker', (original) => function () {
        emit('file-open', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((handles) => {
            emit('file-open', 'selected', { count: Array.isArray(handles) ? Math.min(handles.length, 99) : 1 });
            return handles;
          }, (err) => {
            emit('file-open', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
      wrapMethod(window, 'showSaveFilePicker', (original) => function () {
        emit('file-save', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((handle) => {
            emit('file-save', 'selected');
            return handle;
          }, (err) => {
            emit('file-save', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
      wrapMethod(window, 'showDirectoryPicker', (original) => function () {
        emit('directory', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((handle) => {
            emit('directory', 'selected');
            return handle;
          }, (err) => {
            emit('directory', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
    } catch (_) {}
  }

  function watchFileInputs() {
    try {
      woOn(document, 'change', (e) => {
        const el = e && e.target;
        if (!el || !el.matches || !el.matches('input[type="file" i]')) return;
        const count = el.files && typeof el.files.length === 'number' ? Math.min(el.files.length, 99) : 0;
        if (count > 0) emit('file-upload', 'selected', { count });
      }, true);
    } catch (_) {}
  }

  function patchAll() {
    patchNotifications();
    patchMedia();
    patchClipboard();
    patchGeolocation();
    patchFilePickers();
  }

  patchAll();
  watchFileInputs();
  try { woTimeout(patchAll, 500); } catch (_) {}
  try { woTimeout(patchAll, 2000); } catch (_) {}
})();

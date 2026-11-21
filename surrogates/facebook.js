/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const source = document.currentScript?.src || '';
  if (/\/fbevents\.js(?:[?#]|$)/.test(source)) {
    if (typeof window.fbq === 'function' && typeof window.fbq.callMethod === 'function') return;
    window.fbq = window._fbq = Object.assign(() => {}, { loaded: true });
    return;
  }
  if (window.FB) return;

  const reply = (callback, value) => {
    if (typeof callback === 'function') queueMicrotask(() => { try { callback(value); } catch (_) {} });
  };
  const unavailable = callback => reply(callback, { status: 'unknown', authResponse: null });
  const failedApi = (...args) => reply(args.at(-1), { error: { message: 'Facebook is unavailable' } });
  window.FB = {
    init() {},
    login: unavailable,
    getLoginStatus: unavailable,
    logout: unavailable,
    getAuthResponse: () => null,
    api: failedApi,
    ui: failedApi,
    Event: { subscribe() {}, unsubscribe() {} },
    XFBML: { parse(_root, callback) { reply(callback); } },
  };
  const ready = () => reply(window.fbAsyncInit);
  if (typeof window.fbAsyncInit === 'function' || document.readyState !== 'loading') ready();
  else document.addEventListener('DOMContentLoaded', ready, { once: true });
})();

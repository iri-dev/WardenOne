/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const queued = window._paq;
  if (queued != null && !Array.isArray(queued)) return;

  function later(callback) {
    if (typeof callback === 'function') queueMicrotask(() => { try { callback(); } catch (_) {} });
  }
  const noop = () => {};
  /* Methods that report something take an optional callback last; it runs once nothing has been sent. */
  const tracking = new Set(['trackPageView', 'trackEvent', 'trackLink', 'trackGoal', 'trackRequest',
    'trackEcommerceOrder', 'trackEcommerceCartUpdate', 'ping']);
  const answers = {
    getVisitorId: () => '', getVisitorInfo: () => [], getUserId: () => '', getPageViewId: () => '',
    getAttributionInfo: () => [], getAttributionCampaignName: () => '', getAttributionCampaignKeyword: () => '',
    getAttributionReferrerTimestamp: () => '', getAttributionReferrerUrl: () => '', getCustomData: () => undefined,
    getCustomVariable: () => false, getCustomDimension: () => undefined, getSiteId: () => '', getTrackerUrl: () => '',
    getMatomoUrl: () => '', getPiwikUrl: () => '', getCurrentUrl: () => location.href, getLinkTrackingTimer: () => 0,
    getNumTrackedPageViews: () => 0, getEcommerceItems: () => ({}), getCrossDomainLinkingUrlParameter: () => '',
    hasCookies: () => false, areCookiesEnabled: () => false, isUserOptedOut: () => false,
    hasRememberedConsent: () => false, getRememberedConsent: () => null, isConsentRequired: () => false,
  };
  const tracker = new Proxy(answers, {
    get(target, name) {
      if (Object.prototype.hasOwnProperty.call(target, name)) return target[name];
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (tracking.has(name)) return (...args) => { later(args.findLast(arg => typeof arg === 'function')); };
      return noop;
    },
  });

  function apply(command) {
    try {
      if (typeof command === 'function') { command.call(tracker); return; }
      if (!Array.isArray(command)) return;
      const [name, ...args] = command;
      if (typeof name === 'function') { Reflect.apply(name, tracker, args); return; }
      if (typeof name !== 'string' || name.includes('::')) return;
      const method = tracker[name];
      if (typeof method === 'function') Reflect.apply(method, tracker, args);
    } catch (_) {}
  }

  const matomo = {
    initialized: true,
    getAsyncTracker: () => tracker, getTracker: () => tracker, addTracker: () => tracker,
    getAsyncTrackers: () => [tracker], on: noop, off: noop, trigger: noop, addPlugin: noop,
  };
  window.Matomo = window.Piwik = matomo;
  window._paq = { push(...commands) { for (const command of commands) apply(command); } };
  for (const command of Array.isArray(queued) ? queued : []) apply(command);
  for (const name of ['matomoAsyncInit', 'piwikAsyncInit']) if (typeof window[name] === 'function') later(window[name]);
})();

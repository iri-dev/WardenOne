/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOIdentifierObserver = (() => {
  const detector = WOIdentifiers.create({ siteIdentity: host => {
    const normalized = WOCname.normalizeHost(host);
    return normalized ? siteIdentity(normalized) : '';
  }, crypto });
  let generation = 0, pending = 0;
  const seen = new Set();
  function clear() { generation++; seen.clear(); detector.clear(); }
  function allowed(cfg, host) {
    return cfg.enabled !== false && cfg.trackerLearner !== false && cfg.historyMode !== 'off'
      && !hostMatchesAllowlist(host, activeAllowlist(cfg))
      && !Object.entries(cfg.siteOverrides || {}).some(([site, value]) => value?.trackerLearner === false && hostMatchesSite(host, site));
  }
  async function observe(details) {
    if (INCOGNITO_CONTEXT || pending >= WOIdentifiers.LIMITS.pending || details?.method !== 'GET'
      || !WOIdentifiers.TYPES.includes(details.type) || typeof details.url !== 'string' || details.url.length > WOIdentifiers.LIMITS.url
      || !details.url.includes('?') || typeof details.requestId !== 'string' || details.requestId.length > 100 || seen.has(details.requestId)) return;
    if (!WOIdentifiers.requestValues(details.url)) return;
    if (seen.size >= 512) seen.delete(seen.values().next().value);
    seen.add(details.requestId);
    const epoch = generation;
    pending++;
    try {
      const store = await localGet('wardenone_config');
      const cfg = Object.assign({}, DEFAULT_CONFIG, store?.wardenone_config || {});
      if (cfg.enabled === false || cfg.trackerLearner === false || cfg.historyMode === 'off'
        || typeof __privacyEraseInProgress !== 'undefined' && __privacyEraseInProgress) return;
      const top = await trackerRequestTopFrame(details);
      if (!top) return;
      const first = new URL(top.url), request = new URL(details.url);
      if (epoch !== generation || !allowed(cfg, first.hostname) || !allowed(cfg, request.hostname)
        || isProtectedTrackerDomain(first.hostname) || isProtectedTrackerDomain(request.hostname)
        || isMediaCompatDomain(first.hostname) || isMediaCompatDomain(request.hostname)) return;
      const finding = await detector.observe({ url: details.url, topUrl: top.url, type: details.type, method: details.method });
      if (!finding || epoch !== generation) return;
      const current = await chrome.webNavigation.getFrame({ tabId: top.tabId, frameId: 0 });
      if (epoch !== generation || !current || current.documentId !== top.documentId || current.documentLifecycle !== 'active') return;
      queueHistory({ type: 'warned_tracking_identifier', at: Date.now(), detail: {
        ...finding, why: 'The same random-looking URL value appeared repeatedly across three independent sites. Suspected identifier; detection only. The URL was left intact.' } });
    } catch (_) {}
    finally { pending--; }
  }
  function listener(details) { void observe(details); }
  function reconcile(enabled) {
    try {
      const event = chrome.webRequest.onBeforeRequest;
      if (enabled && !event.hasListener(listener)) event.addListener(listener, { urls: ['https://*/*'], types: WOIdentifiers.TYPES.slice() });
      if (!enabled) { if (event.hasListener(listener)) event.removeListener(listener); clear(); }
    } catch (_) { return false; }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wardenone_config) clear();
  });
  reconcile(true);
  return Object.freeze({ clear, reconcile });
})();

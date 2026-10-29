/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
(function (root) {
  'use strict';
  const DURATION_MS = 15 * 60 * 1000;
  const FEATURES = Object.freeze({
    adShield: 'AdShield',
    blockTrackers: 'Tracker blocking',
    blockThirdPartyCookies: 'Third-party cookie blocking',
    autoRejectConsent: 'Cookie banner auto-reject',
    removeOverlays: 'Overlay removal',
    scriptletEngine: 'Scriptlet engine',
    stripTrackingParams: 'Link cleaning',
    blockAutoplayMedia: 'Autoplay blocking',
  });
  const EVENTS = Object.freeze({
    blocked_ad_resource: 'adShield',
    blocked_tracker_request: 'blockTrackers',
    blocked_thirdparty_cookie: 'blockThirdPartyCookies',
    consent_rejected: 'autoRejectConsent',
    blocked_overlay: 'removeOverlays',
    blocked_overlay_ad_frame: 'removeOverlays',
    scriptlet_mutator_blocked: 'scriptletEngine',
    cleaned_history_url: 'stripTrackingParams',
    blocked_autoplay_media: 'blockAutoplayMedia',
  });
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  function active(raw, now, normalizeHost) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [host, entry] of Object.entries(raw).slice(0, 100)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || normalizeHost(host) !== host) continue;
      const until = entry.until;
      if (!own(FEATURES, entry.key) || !Number.isSafeInteger(until) || until <= now || until > now + DURATION_MS + 30000) continue;
      out[host] = { key: entry.key, until };
    }
    return out;
  }
  function effective(config, now, normalizeHost) {
    const entries = active(config && config.siteRecoveryUntil, now, normalizeHost);
    if (!Object.keys(entries).length) return config;
    const cfg = Object.assign({}, config);
    const siteOverrides = Object.assign({}, cfg.siteOverrides || {});
    for (const [host, entry] of Object.entries(entries)) {
      if (cfg[entry.key] === false) continue;
      siteOverrides[host] = Object.assign({}, siteOverrides[host] || {}, { [entry.key]: false });
    }
    cfg.siteOverrides = siteOverrides;
    return cfg;
  }
  function next(raw, now, normalizeHost) {
    const values = Object.values(active(raw, now, normalizeHost)).map(entry => entry.until);
    return values.length ? Math.min(...values) : 0;
  }
  function suggestions(summary, config, now) {
    const found = new Map();
    for (const event of Array.isArray(summary && summary.events) ? summary.events : []) {
      const key = EVENTS[event && event.type];
      const at = Number(event && event.at);
      if (!key || config && config[key] === false || !Number.isFinite(at) || at < now - 10 * 60 * 1000 || at > now + 5000) continue;
      const prev = found.get(key);
      if (!prev) found.set(key, { key, label: FEATURES[key], type: event.type, at, count: 1 });
      else { prev.count++; prev.at = Math.max(prev.at, at); }
    }
    return [...found.values()].sort((a, b) => b.at - a.at).slice(0, 3);
  }
  function report(summary, exception, now, normalizeHost) {
    const host = normalizeHost(summary && summary.host);
    if (!host || host !== summary.host) return null;
    const counts = {};
    for (const event of Array.isArray(summary.events) ? summary.events : []) {
      const type = String(event && event.type || '');
      const at = Number(event && event.at);
      if (!own(EVENTS, type) || !Number.isFinite(at) || at < now - 10 * 60 * 1000 || at > now + 5000) continue;
      counts[type] = Math.min(1000, (counts[type] || 0) + 1);
    }
    const valid = active({ [host]: exception }, now, normalizeHost)[host];
    return {
      format: 'wardenone-site-diagnostic', version: 1,
      site: host, createdAt: new Date(now).toISOString(),
      recentActions: Object.entries(counts).map(([type, count]) => ({ type, count })),
      trial: valid ? { feature: valid.key, expiresAt: new Date(valid.until).toISOString() } : null,
      note: 'Only the site name, action types and counts, and the temporary trial are included.',
    };
  }
  const api = Object.freeze({ DURATION_MS, FEATURES, EVENTS, active, effective, next, suggestions, report });
  root.WOSiteRecovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

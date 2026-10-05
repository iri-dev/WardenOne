/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
(function (root) {
  'use strict';

  const ADJUSTMENTS = Object.freeze({
    eyeShieldBrightness: [0, 200, 100],
    eyeShieldContrast: [0, 300, 100],
    eyeShieldSaturation: [0, 300, 100],
    eyeShieldWarmth: [0, 100, 0],
    eyeShieldGrayscale: [0, 100, 0],
  });
  const MODES = new Set(['off', 'light', 'dark', 'ultra']);
  const hostOf = (value) => {
    const host = String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (/^\[[0-9a-f:.]+\]$/.test(host)) {
      try { return new URL('http://' + host + '/').hostname; } catch (_) { return ''; }
    }
    if (host.length > 253 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)) return '';
    return host;
  };
  const number = (value, limits) => {
    const n = typeof value === 'number' ? value : NaN;
    return Number.isFinite(n) ? Math.max(limits[0], Math.min(limits[1], Math.round(n))) : limits[2];
  };
  const customFromGlobal = (config) => {
    const source = config && typeof config === 'object' ? config : {};
    const profile = { mode: 'custom', theme: MODES.has(source.eyeShieldMode) ? source.eyeShieldMode : 'off' };
    for (const [field, limits] of Object.entries(ADJUSTMENTS)) profile[field] = number(source[field], limits);
    return profile;
  };
  const cleanProfile = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.mode === 'off') return { mode: 'off' };
    if (raw.mode !== 'custom') return null;
    return customFromGlobal(Object.assign({}, raw, { eyeShieldMode: raw.theme }));
  };
  const cleanSites = (raw) => {
    const sites = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return sites;
    for (const [key, value] of Object.entries(raw).slice(0, 256)) {
      const host = hostOf(key);
      const profile = cleanProfile(value);
      if (host && profile) sites[host] = profile;
    }
    return sites;
  };
  const profileFor = (raw, hostname) => {
    const host = hostOf(hostname);
    if (!host || !raw || typeof raw !== 'object') return null;
    return cleanProfile(Object.prototype.hasOwnProperty.call(raw, host) ? raw[host] : raw['www.' + host]);
  };
  const forHost = (raw, hostname) => {
    const host = hostOf(hostname);
    const profile = profileFor(raw, host);
    return host && profile ? { [host]: profile } : {};
  };
  const resolve = (config, hostname) => {
    const profile = profileFor(config && config.eyeShieldSites, hostname);
    if (!profile) return { mode: 'inherit', config };
    if (profile.mode === 'off') return { mode: 'off', config: Object.assign({}, config, { enabled: false, eyeShieldMode: 'off' }) };
    const effective = Object.assign({}, config, { eyeShieldMode: profile.theme });
    for (const field of Object.keys(ADJUSTMENTS)) effective[field] = profile[field];
    return { mode: 'custom', config: effective };
  };
  const api = Object.freeze({ ADJUSTMENTS, hostOf, cleanSites, profileFor, forHost, customFromGlobal, resolve });
  root.WOEyeShieldProfiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

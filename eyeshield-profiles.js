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
  const PRELOAD_BG = { dark: '#16181a', ultra: '#000000', light: '#f7f8fb' };
  const GOOGLE_PRELOAD = {
    light: ['#ffffff', '#202124', '#5f6368', '#1a0dab', '#681da8', '#ffffff', '#dadce0'],
    dark: ['#111316', '#f1f3f6', '#a8afbb', '#8ab4ff', '#c07cf0', '#1b1f26', '#343a46'],
    ultra: ['#000000', '#ffffff', '#a9b0bc', '#8ab4ff', '#c07cf0', '#0d0f14', '#2a2f3a'],
  };
  function googleSearchActionsCSS(icon) {
    const buttons = ':is(#searchform,form[role="search"]) .RNNXgb :is(.dRYYxd,.BKRPef,.y1yadf) :where(button,[role="button"])';
    return `${buttons}{background-color:transparent !important;color:${icon} !important;}
      ${buttons} :where(svg,path){color:${icon} !important;fill:currentColor !important;stroke:currentColor !important;}`;
  }

  function paintPreload(doc, loc, mode) {
    if (!MODES.has(mode) || mode === 'off' || /(^|\.)(discord|spotify|tiktok)\.com$/i.test(loc.hostname)) return null;
    const scheme = mode === 'light' ? 'light' : 'dark';
    let bg = PRELOAD_BG[mode];
    let searchCSS = '';
    if (/^(?:www\.)?google\.(?:com|cat|(?:co\.|com\.)?[a-z]{2})$/i.test(loc.hostname)
        && /^\/(?:search|webhp)?$/.test(loc.pathname)) {
      const [canvas, text, muted, link, visited, input, border] = GOOGLE_PRELOAD[mode];
      bg = canvas;
      const results = ':is(#search,#rso,#rhs)';
      searchCSS = `html body{
        color:${text} !important;--YLNNHc:${text} !important;--bbQxAb:${muted} !important;
        --IXoxUe:${muted} !important;--JKqx2:${link} !important;
        --xhUGwc:${bg} !important;--cIehld:${bg} !important;--PBxOKe:${bg} !important;
      }
      :is(#main,#cnt,#rcnt,#center_col,#search,#rso,#rhs,.sfbg){
        background-color:${bg} !important;color:${text} !important;
      }
      :is(#hdtb,#top_nav,#gb) :where(a,button,[role="button"]),${results} :where(h1,h2,h3,p,span,li){
        color:${text} !important;
      }
      ${results} :where(cite,small,.VwiC3b,.MUxGbd,.hgKElc){color:${muted} !important;}
      ${results} a,${results} a :where(h3,span){color:${link} !important;}
      ${results} a:visited,${results} a:visited :where(h3,span){color:${visited} !important;}
      :is(.RNNXgb,.aajZCb){background-color:${input} !important;border-color:${border} !important;color:${text} !important;}
      :is(#searchform,form[role="search"]) :where(input,textarea){color:${text} !important;}`
        + googleSearchActionsCSS(mode === 'light' ? '#3c4043' : text);
    }
    const css = `html{background-color:${bg} !important;color-scheme:${scheme} !important;}
      html body{background-color:${bg} !important;background-image:none !important;}` + searchCSS;
    const id = 'wardenone-eyeshield-preload';
    let pre = doc.getElementById(id);
    if (!pre) {
      pre = doc.createElement('style');
      pre.id = id;
      pre.textContent = css;
      (doc.head || doc.documentElement).appendChild(pre);
    } else if (pre.textContent !== css) {
      pre.textContent = css;
    }
    return pre;
  }
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
  const api = Object.freeze({ ADJUSTMENTS, hostOf, cleanSites, profileFor, forHost, customFromGlobal, resolve,
    paintPreload, googleSearchActionsCSS });
  root.WOEyeShieldProfiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

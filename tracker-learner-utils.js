/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOLearner = (() => {
  const pageSignals = Object.freeze({ 'known-tracker-host': 'page-claim', 'tracking-path': 'page-behavior',
    'tracking-params': 'page-behavior', 'beacon-api': 'page-behavior' });
  const sources = Object.freeze({ 'page-claim': 'Page claim', 'page-behavior': 'Page API/path observation',
    network: 'Browser network observation', 'curated-feed': 'Packaged tracker list',
    'curated-cname': 'Local CNAME mapping', 'fingerprint-feed': 'Known fingerprint library',
    'tracking-cookie': 'Cross-site identifying cookie seen by the browser',
    'canvas-fingerprint': 'Canvas drawing and readback observed by WardenOne',
    'local-storage': 'Cross-site storage identifier read by WardenOne',
    'url-id': 'Browser request carrying a verified stored identifier' });
  const trustedSignals = Object.freeze(['tracking-cookie', 'canvas-fingerprint', 'local-storage', 'url-id']);
  const signals = Object.freeze([...Object.keys(pageSignals), 'curated-feed', 'curated-cname', 'fingerprint-feed', ...trustedSignals]);
  /* Infrastructure and consent cookies can look like identifiers; keep those outside automatic learning. */
  const benignCookie = /^(?:awsalb|awsalbcors|awselb|awselbcors|__cf|cf_|__cflb|arraffinity|bigipserver|incap_|visid_incap|nlbi_|ak_bmsc|bm_|_abck|ts[0-9a-f]{6,}$)|consent|gdpr|ccpa|usprivacy|optanon|cookieyes|cookielaw|tcf|cmp/i;
  const COOKIE_MIN_LIFE_MS = 30 * 86400000;
  /* Classify persistent cross-site ID-shaped cookies seen by the browser. Page reports cannot supply this evidence. */
  function identifyingCookie(cookie, now) {
    if (!cookie || typeof cookie !== 'object' || cookie.sameSite !== 'no_restriction' || cookie.session !== false || cookie.partitionKey
        || typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || benignCookie.test(cookie.name)) return false;
    if (!(Number(cookie.expirationDate) * 1000 - now >= COOKIE_MIN_LIFE_MS)) return false;
    return identifyingValue(cookie.value);
  }
  function identifyingValue(raw) {
    if (typeof raw !== 'string') return false;
    const value = raw.replace(/^"|"$/g, '');
    if (value.length < 10 || value.length > 512 || /^\d+$/.test(value) && value.length < 16 || /^(?:true|false|null|undefined)$/i.test(value)) return false;
    const counts = new Map();
    for (const c of value) counts.set(c, (counts.get(c) || 0) + 1);
    if (counts.size < 8) return false;
    let bits = 0;
    for (const n of counts.values()) bits -= n * Math.log2(n / value.length);
    return bits >= 40;
  }
  function identifyingStorageKey(name) {
    return typeof name === 'string' && name.length <= 120 && !benignCookie.test(name)
      && !/auth|token|secret|password|csrf|xsrf|session|consent/i.test(name)
      && /^(?:_?(?:uid|uuid\d*|user_?id|visitor_?id|client_?id|device_?id|browser_?id|anonymous_?id|distinct_?id|tracking_?id|tracker_?id|ga|fbp)|ide)$/i.test(name);
  }
  function queryIdentifiers(raw) {
    try {
      if (typeof raw !== 'string' || raw.length > 8192) return [];
      const url = new URL(raw);
      if (!/^https:$/.test(url.protocol) || url.username || url.password
          || /(?:^|\/)(?:oauth2?|authorize|login|signin|saml|sso|checkout|payment)(?:\/|$)/i.test(url.pathname)) return [];
      const out = [];
      for (const [name, value] of url.searchParams) {
        if (identifyingStorageKey(name) && identifyingValue(value) && out.length < 8) out.push(value);
      }
      return out;
    } catch (_) { return []; }
  }
  /* A Set-Cookie response header in the shape identifyingCookie reads from the jar, so a cookie that
   * third-party cookie blocking strips before it is stored is judged by the same rule. */
  function setCookieShape(header, now) {
    const parts = String(header || '').split(';');
    const eq = parts[0].indexOf('=');
    if (eq <= 0 || parts[0].length > 4096) return null;
    const cookie = { name: parts[0].slice(0, eq).trim(), value: parts[0].slice(eq + 1).trim(), sameSite: 'unspecified', secure: false, session: true };
    let maxAge = null, expires = null;
    for (const part of parts.slice(1)) {
      const at = part.indexOf('='), key = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase(), value = at < 0 ? '' : part.slice(at + 1).trim();
      if (key === 'samesite') cookie.sameSite = /^none$/i.test(value) ? 'no_restriction' : value.toLowerCase();
      else if (key === 'secure') cookie.secure = true;
      else if (key === 'partitioned') cookie.partitionKey = { topLevelSite: '' };
      else if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
      else if (key === 'expires' && !Number.isNaN(Date.parse(value))) expires = Date.parse(value);
    }
    const end = maxAge !== null ? now + maxAge * 1000 : expires;
    if (end !== null) { cookie.session = false; cookie.expirationDate = end / 1000; }
    /* The browser refuses SameSite=None without Secure, so such a header can never become a cross-site ID. */
    return cookie.secure ? cookie : null;
  }
  function pageEvidence(detail) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail) || typeof detail.signal !== 'string' || detail.signal.length > 40 || !Object.hasOwn(pageSignals, detail.signal)) return null;
    return { signal: detail.signal, source: pageSignals[detail.signal] };
  }
  function counts(value, allowed) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const key of allowed) {
      const count = value[key];
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[key] = Math.min(1000000, Math.floor(count));
    }
    return out;
  }
  function summary(value) {
    const evidence = counts(value, Object.keys(sources));
    const confirmed = ['curated-feed', 'curated-cname', 'fingerprint-feed', ...trustedSignals].some(key => evidence[key] > 0)
      && (evidence.network > 0 || evidence['canvas-fingerprint'] > 0 || evidence['local-storage'] > 0);
    return { confidence: confirmed ? 'corroborated' : evidence.network > 0 ? 'observed' : evidence['page-behavior'] > 0 ? 'inferred' : 'unverified',
      source: Object.keys(sources).filter(key => evidence[key] > 0).map(key => sources[key]).join(' + ') || 'No corroborated source recorded' };
  }
  function positions(salt, site, bits = 128) {
    let h = 0x811c9dc5;
    const text = String(salt) + '\n' + String(site);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    if (bits === 128) {
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    }
    const mask = bits - 1, a = h & mask;
    let b = (h >>> (bits === 32 ? 5 : 7)) & mask;
    if (b === a) b = (b + 1) & mask;
    return [a, b];
  }
  function validMarks(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
      || typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
  }
  function has(marks, salt, site) {
    const legacy = typeof marks === 'number';
    const [a, b] = positions(salt, site, legacy ? 32 : 128);
    if (legacy) return ((marks >>> a) & 1) === 1 && ((marks >>> b) & 1) === 1;
    if (!validMarks(marks)) return false;
    return [a, b].every(bit => ((parseInt(marks.slice((bit >>> 5) * 8, (bit >>> 5) * 8 + 8), 16) >>> (bit & 31)) & 1) === 1);
  }
  function add(marks, salt, site) {
    const legacy = typeof marks === 'number';
    const [a, b] = positions(salt, site, legacy ? 32 : 128);
    if (legacy) return ((marks >>> 0) | (1 << a) | (1 << b)) >>> 0;
    const text = validMarks(marks) ? marks : '0'.repeat(32);
    const words = Array.from({ length: 4 }, (_, i) => parseInt(text.slice(i * 8, i * 8 + 8), 16));
    for (const bit of [a, b]) words[bit >>> 5] = (words[bit >>> 5] | (1 << (bit & 31))) >>> 0;
    return words.map(word => word.toString(16).padStart(8, '0')).join('');
  }
  return Object.freeze({ pageSignals, sources, signals, trustedSignals, pageEvidence, counts, summary, positions, validMarks, has, add,
    identifyingCookie, identifyingValue, identifyingStorageKey, queryIdentifiers, setCookieShape });
})();
if (typeof module !== 'undefined') module.exports = WOLearner;

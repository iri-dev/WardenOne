/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOIdentifiers = (() => {
  const LIMITS = Object.freeze({ url: 8192, parameters: 20, values: 4, entries: 256, sites: 3,
    ttlMs: 30 * 60 * 1000, repeatMs: 1000, pending: 8, requestsPerMinute: 120 });
  const TYPES = Object.freeze(['image', 'ping', 'xmlhttprequest']);
  const sensitive = /(?:auth|oauth|openid|saml|login|signin|sign_in|sign-in|logout|session|csrf|xsrf|token|jwt|bearer|password|passwd|secret|signature|signed|credential|nonce|checkout|payment|billing|purchase|transaction|download|attachment|callback|redirect|authorize|account|reset|verify|recovery|invite|captcha)/i;
  const reserved = /^(?:id|sid|uid|uuid|guid|key|sig|code|state|sso|otp|pin|hash|digest|checksum|etag|integrity|policy|expires?|expiry|response|scope|ticket|assertion|client|app|application|project|tenant|resource|document|file|asset|build|version|cache|v|q|query|search|email|phone|user|device|order|cart|invoice|sku|product)(?:$|[_.-])/i;
  const known = /^(?:utm_|fbclid$|gclid$|dclid$|msclkid$|mc_[ec]id$|igshid$|_hsenc$|_hsmi$|yclid$|_openstat$|twclid$|spm$)/i;
  const keyShape = /^[a-z][a-z0-9_.-]{0,39}$/i;
  const applicationKey = /^(?:client|app|application|project|tenant|resource|document|file|asset|build|user|device|order|cart|invoice|product)[_.-]?(?:id|key|hash|version|number)$/i;
  function url(raw) {
    if (typeof raw !== 'string' || raw.length > LIMITS.url || /[\u0000-\u0020\u007f]/.test(raw)) return null;
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password && !u.hash ? u : null;
    } catch (_) { return null; }
  }
  function excluded(u) {
    let route = u.hostname + u.pathname;
    try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(route); if (next === route) break; route = next; } }
    catch (_) { return true; }
    if (sensitive.test(route) || /(?:^|[/._-])(?:api|graphql|rpc|sso|cdn|assets?|static)(?:$|[/._-])/i.test(route)
      || /\.(?:zip|pdf|exe|msi|dmg|apk|docx?|xlsx?|pptx?|mp[34]|m3u8|webm|woff2?|js|css)(?:$|[;/])/i.test(u.pathname)) return true;
    let count = 0;
    const seen = new Set();
    for (const [key, value] of u.searchParams) {
      if (++count > LIMITS.parameters || !keyShape.test(key) || seen.has(key.toLowerCase()) || sensitive.test(key) || reserved.test(key) || applicationKey.test(key)
        || /^(?:x-amz-|x-goog-|awsaccesskeyid$|googleaccessid$|saml|response_type$|redirect_uri$)/i.test(key)
        || /(?:https?:|[\/@]|%[0-9a-f]{2})/i.test(value) || /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return true;
      seen.add(key.toLowerCase());
    }
    return false;
  }
  function highEntropy(value) {
    if (typeof value !== 'string' || value.length < 24 || value.length > 128 || !/^[a-z0-9_-]+$/i.test(value)
      || !/[a-z]/i.test(value) || !/\d/.test(value)) return false;
    const counts = new Map();
    for (const c of value) counts.set(c, (counts.get(c) || 0) + 1);
    if (counts.size < 8) return false;
    let entropy = 0;
    for (const n of counts.values()) { const p = n / value.length; entropy -= p * Math.log2(p); }
    return entropy >= 3.3 && entropy * value.length >= 96;
  }
  function requestValues(raw) {
    const request = url(raw);
    if (!request || excluded(request)) return null;
    const values = [];
    for (const [key, value] of request.searchParams) {
      if (!known.test(key) && highEntropy(value) && !values.includes(value)) values.push(value);
      if (values.length > LIMITS.values) return null;
    }
    return values.length ? { host: request.hostname, values } : null;
  }
  function candidates(requestUrl, topUrl, siteIdentity) {
    const request = requestValues(requestUrl), top = url(topUrl);
    if (!request || !top || excluded(top)) return null;
    const destination = siteIdentity(request.host), site = siteIdentity(top.hostname);
    if (!destination || !site || destination === site) return null;
    return { ...request, destination, site };
  }
  function create({ siteIdentity, crypto, now = Date.now }) {
    let epoch = 0, started = 0, last = 0, secret = null, pending = 0, minute = 0, budget = 0;
    const entries = new Map();
    const encoder = new TextEncoder();
    function clear() { epoch++; entries.clear(); secret = null; started = 0; }
    function age(time) {
      if (time < last || time - started >= LIMITS.ttlMs) clear();
      last = time;
      if (!started) started = time;
      for (const [key, row] of entries) if (time - row.first >= LIMITS.ttlMs) entries.delete(key);
    }
    function digest(key, kind, value) {
      return crypto.subtle.sign('HMAC', key, encoder.encode(kind + '\n' + value)).then(bytes =>
        Array.from(new Uint8Array(bytes).slice(0, 16), b => b.toString(16).padStart(2, '0')).join(''));
    }
    async function observe(input) {
      if (!input || input.method !== 'GET' || !TYPES.includes(input.type) || pending >= LIMITS.pending) return null;
      const candidate = candidates(input.url, input.topUrl, siteIdentity);
      if (!candidate) return null;
      const time = now();
      if (!Number.isFinite(time) || time <= 0) return null;
      age(time);
      const bucket = Math.floor(time / 60000);
      if (bucket !== minute) { minute = bucket; budget = 0; }
      if (++budget > LIMITS.requestsPerMinute) return null;
      const generation = epoch;
      pending++;
      try {
        secret ||= crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const key = await secret;
        const [site, ...values] = await Promise.all([digest(key, 'site', candidate.site),
          ...candidate.values.map(value => digest(key, 'value', candidate.destination + '\n' + value))]);
        if (generation !== epoch || now() - time >= LIMITS.ttlMs || now() < time) return null;
        let finding = null;
        for (const value of values) {
          let row = entries.get(value);
          if (!row) {
            if (entries.size >= LIMITS.entries) entries.delete(entries.keys().next().value);
            row = { first: time, sites: new Map(), reported: false }; entries.set(value, row);
          }
          let mark = row.sites.get(site);
          if (!mark && row.sites.size < LIMITS.sites) { mark = { count: 1, last: time }; row.sites.set(site, mark); }
          else if (mark && time - mark.last >= LIMITS.repeatMs) { mark.count = Math.min(2, mark.count + 1); mark.last = time; }
          if (!row.reported && row.sites.size === LIMITS.sites && [...row.sites.values()].every(m => m.count >= 2)) {
            row.reported = true;
            finding = { host: candidate.host, contexts: LIMITS.sites, confidence: 'suspected-identifier',
              enforcement: 'detection-only', source: 'Browser-observed URL value reuse' };
          }
        }
        return finding;
      } catch (_) { return null; }
      finally { pending--; }
    }
    return Object.freeze({ observe, clear, stats: () => { age(now()); return { entries: entries.size, pending }; } });
  }
  return Object.freeze({ LIMITS, TYPES, highEntropy, requestValues, candidates, create });
})();
if (typeof module !== 'undefined') module.exports = WOIdentifiers;

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOTrackingRedirects = (() => {
  const profiles = Object.freeze([
    { id: 'google', hosts: ['google.com', 'google.co.uk', 'google.com.au', 'google.ca', 'google.de', 'google.fr', 'google.es', 'google.it'], path: '/(?:url|aclk)', keys: ['url', 'q', 'adurl'] },
    { id: 'google-ads', hosts: ['googleadservices.com', 'ad.doubleclick.net'], path: '/(?:pagead/aclk|ddm/clk)', keys: ['adurl'] },
    { id: 'youtube', hosts: ['youtube.com'], path: '/redirect', keys: ['q', 'url'] },
    { id: 'facebook', hosts: ['facebook.com', 'messenger.com', 'l.instagram.com'], path: '/l\\.php', keys: ['u'] },
    { id: 'reddit', hosts: ['out.reddit.com'], path: '/(?:t3_[^/?]+)?', keys: ['url'] },
    { id: 'linkedin', hosts: ['linkedin.com'], path: '/safety/go/?', keys: ['url'] },
    { id: 'duckduckgo', hosts: ['duckduckgo.com'], path: '/l/?', keys: ['uddg'] },
    { id: 'bing', hosts: ['bing.com'], path: '/ck/a', keys: ['u'], base64: true },
    { id: 'awin', hosts: ['awin1.com'], path: '/cread\\.php', keys: ['ued'] },
    { id: 'cj', hosts: ['anrdoezrs.net', 'jdoqocy.com', 'dpbolvw.net', 'kqzyfj.com', 'tkqlhce.com', 'qksrv.net'], path: '/click(?:-[^/?]+|/[^?]*)?', keys: ['url'] },
    { id: 'rakuten', hosts: ['click.linksynergy.com'], path: '/(?:deeplink|fs-bin/click)', keys: ['murl'] },
    { id: 'skimlinks', hosts: ['go.skimresources.com'], path: '/', keys: ['url'] },
    { id: 'sovrn', hosts: ['redirect.viglink.com'], path: '/', keys: ['u'] },
    { id: 'skimlinks-legacy', hosts: ['go.redirectingat.com'], path: '/', keys: ['url'] },
    { id: 'shareasale', hosts: ['shareasale.com'], path: '/r\\.cfm', keys: ['urllink'] },
    { id: 'tradedoubler', hosts: ['clk.tradedoubler.com'], path: '/click', keys: ['url'] },
    { id: 'impact', hosts: ['pxf.io', 'sjv.io'], path: '/c/[^?]+', keys: ['u', 'url'] },
    { id: 'partnerize', hosts: ['prf.hn'], path: '/click/(?:[^/?#]+/)*destination:([^?#]+)', keys: [], pathTarget: true },
    { id: 'ebay', hosts: ['rover.ebay.com'], path: '/rover/[^?]+', keys: ['mpre'] },
    { id: 'clickserve', hosts: ['clickserve.dartsearch.net'], path: '/link/click', keys: ['ds_dest_url'] },
  ].map(profile => Object.freeze({ ...profile, hosts: Object.freeze(profile.hosts), keys: Object.freeze(profile.keys) })));
  const MAX_URL = 8192, MAX_HOPS = 5;
  const protectedKeys = /^(?:signature|sig|hmac|access_token|id_token|code|state|ticket|nonce|otp|x-amz-signature|x-goog-signature)$/i;
  const controls = /[\x00-\x20\x7f]/;
  const under = (host, scope) => host === scope || host.endsWith('.' + scope);
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_URL || controls.test(raw) || !/^https?:\/\//i.test(raw)) return null;
    try {
      const url = new URL(raw);
      return url.username || url.password || !url.hostname ? null : url;
    } catch (_) { return null; }
  }
  function profileFor(url) {
    return profiles.find(profile => profile.hosts.some(host => under(url.hostname.toLowerCase(), host)) && new RegExp('^' + profile.path + '$', 'i').test(url.pathname));
  }
  function decode(raw, profile) {
    let value = raw;
    if (profile.base64 && value.startsWith('a1')) {
      try {
        const bytes = atob(value.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
        value = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes, char => char.charCodeAt(0)));
      } catch (_) { return ''; }
    }
    for (let i = 0; i < 3 && !/^https?:\/\//i.test(value); i++) {
      try { const next = decodeURIComponent(value); if (next === value) break; value = next; } catch (_) { return ''; }
    }
    return value;
  }
  function resolve(raw, publicHost) {
    const original = parse(raw);
    if (!original || !profileFor(original)) return { status: 'unsupported' };
    const visited = new Set();
    let current = original;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (visited.has(current.href)) return { status: 'unchanged' };
      visited.add(current.href);
      const profile = profileFor(current);
      if (!profile) return { status: 'resolved', url: current.href, hops: hop };
      const pathValue = profile.pathTarget ? new RegExp('^' + profile.path + '$', 'i').exec(current.pathname)[1] : '';
      const rawPathTarget = /^https?:\/\//i.test(pathValue);
      if (!rawPathTarget && [...current.searchParams.keys()].some(key => protectedKeys.test(key))) return { status: 'unchanged' };
      const values = [];
      if (profile.pathTarget) values.push(decode(pathValue, profile) + (rawPathTarget ? current.search + current.hash : ''));
      else for (const [key, value] of current.searchParams) if (profile.keys.includes(key.toLowerCase())) values.push(decode(value, profile));
      if (values.length !== 1 || !values[0]) return { status: 'unchanged' };
      const target = parse(values[0]);
      if (!target || !publicHost(target.hostname)) return { status: 'unsafe' };
      current = target;
    }
    return profileFor(current) ? { status: 'unchanged' } : { status: 'resolved', url: current.href, hops: MAX_HOPS };
  }
  return Object.freeze({ profiles, resolve, parse, profileFor, MAX_URL });
})();
if (typeof module !== 'undefined') module.exports = WOTrackingRedirects;

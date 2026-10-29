/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOCname = (() => {
  const maxAliases = 2000, maxRules = 300;
  const resourceTypes = ['script', 'image', 'xmlhttprequest', 'ping', 'websocket', 'webtransport'];
  const trackerTargets = ['eulerian.net', 'ca-eulerian.net', 'etracker.com', 'at-o.net', 'wt-eu02.net', 'webtrekk.net'];
  const sites = new Map();

  function knownSite(host) {
    if (sites.has(host)) return sites.get(host);
    const site = siteIdentity(host);
    if (sites.size >= maxAliases * 2) sites.clear();
    sites.set(host, site);
    return site;
  }

  function confirmedTarget(host) {
    return trackerTargets.some(domain => host === domain || host.endsWith('.' + domain));
  }

  function normalizeHost(value) {
    if (typeof value !== 'string' || value.length > 512) return '';
    const raw = value.trim().replace(/\.$/, '');
    if (!raw || /[\s/\\:@%?#*\[\]]/.test(raw)) return '';
    try {
      const host = new URL('https://' + raw).hostname.toLowerCase();
      if (host.length > 253 || !host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host)) return '';
      if (host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
      return wardenOneIsPublicSuffix(host) ? '' : host;
    } catch (_) { return ''; }
  }

  function validateEntries(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > maxAliases) throw new Error('CNAME entry budget exceeded or empty');
    const mapping = new Map();
    for (const row of entries) {
      if (!Array.isArray(row) || row.length !== 2) throw new Error('Invalid CNAME record');
      const alias = normalizeHost(row[0]), target = normalizeHost(row[1]);
      if (!alias || !target || alias === knownSite(alias)) throw new Error('Unsafe CNAME hostname');
      if (mapping.has(alias) && mapping.get(alias) !== target) throw new Error('Conflicting CNAME target');
      mapping.set(alias, target);
    }
    const resolved = new Map();
    for (const alias of mapping.keys()) {
      let target = alias;
      const seen = new Set();
      while (mapping.has(target)) {
        if (seen.has(target) || seen.size >= 8) throw new Error('CNAME cycle or excessive depth');
        seen.add(target);
        target = mapping.get(target);
      }
      resolved.set(alias, target);
    }
    return new Map([...resolved].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }

  function validateData(data) {
    if (!data || data.schema !== 1 || data.source !== 'AdGuard CNAME trackers'
        || !/^[0-9a-f]{40}$/.test(data.revision || '')
        || !/^\d{4}-\d{2}-\d{2}T/.test(data.updatedAt || '') || !Number.isFinite(Date.parse(data.updatedAt))) {
      throw new Error('Invalid CNAME source metadata');
    }
    return validateEntries(data.entries);
  }

  function resolve(mapping, host, source) {
    const requestedHost = normalizeHost(host), canonicalTarget = mapping.get(requestedHost);
    if (!canonicalTarget || !confirmedTarget(canonicalTarget) || knownSite(requestedHost) === knownSite(canonicalTarget)) return null;
    return { requestedHost, canonicalTarget, source, confidence: 'curated' };
  }

  function compile(mapping, { base, excludedInitiatorDomains, protectedHost }) {
    const protectedHosts = new Map();
    const isProtected = host => {
      if (!protectedHosts.has(host)) protectedHosts.set(host, protectedHost(host));
      return protectedHosts.get(host);
    };
    const aliases = [...mapping.keys()].filter(host => {
      const target = mapping.get(host);
      return confirmedTarget(target) && knownSite(host) !== knownSite(target) && !isProtected(host) && !isProtected(target);
    });
    const byDepth = new Map(), groups = [];
    for (const alias of aliases) {
      const depth = alias.split('.').length;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth).push(alias);
    }
    for (const [depth, hosts] of [...byDepth].sort(([a], [b]) => a - b)) {
      for (let i = 0; i < hosts.length; i += 100) groups.push({ depth, hosts: hosts.slice(i, i + 100) });
    }
    if (groups.length > maxRules) throw new Error('CNAME rule budget exceeded');
    /* requestDomains includes descendants. Equal label depth makes that suffix
       match exact without a large hostname-alternation regex. */
    return groups.map(({ depth, hosts }, index) => ({ id: base + index, priority: 900, action: { type: 'block' },
      condition: { requestDomains: hosts,
        regexFilter: '^(?:https?|wss?)://(?:[^/@]*@)?(?:[a-z0-9-]+\\.){' + (depth - 1) + '}[a-z0-9-]+\\.?(?::[0-9]+)?/',
        isUrlFilterCaseSensitive: false, resourceTypes,
        ...(excludedInitiatorDomains.length ? { excludedInitiatorDomains } : {}) } }));
  }

  return Object.freeze({ maxAliases, maxRules, resourceTypes, normalizeHost, validateEntries, validateData, resolve, compile });
})();
if (typeof module !== 'undefined') module.exports = WOCname;

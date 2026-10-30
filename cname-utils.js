/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOCname = (() => {
  const maxAliases = 2000, maxRules = 300, rulePriority = 900;
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
    validateCatalog(data.catalog);
    return validateEntries(data.entries);
  }

  /* requestDomains includes descendants; the label count keeps a listed alias exact, and lets a
     wildcard family match its children but not the parent itself. */
  function exactHostRegex(depth) {
    return '^(?:https?|wss?)://(?:[^/@]*@)?(?:[a-z0-9-]+\\.){' + (depth - 1) + '}[a-z0-9-]+\\.?(?::[0-9]+)?/';
  }

  function descendantRegex(depth) {
    return '^(?:https?|wss?)://(?:[^/@]*@)?(?:[a-z0-9-]+\\.){' + depth + ',}[a-z0-9-]+\\.?(?::[0-9]+)?/';
  }

  function validateCatalog(catalog) {
    const counts = ['rules', 'blockedHosts', 'cookieHosts', 'families'];
    if (!catalog || !/^[0-9a-f]{64}$/.test(catalog.sha256 || '') || Object.keys(catalog).length !== counts.length + 1
        || counts.some(key => !Number.isSafeInteger(catalog[key]) || catalog[key] < 0)) throw new Error('Invalid CNAME catalog summary');
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
    return groups.map(({ depth, hosts }, index) => ({ id: base + index, priority: rulePriority, action: { type: 'block' },
      condition: { requestDomains: hosts, regexFilter: exactHostRegex(depth), isUrlFilterCaseSensitive: false, resourceTypes,
        ...(excludedInitiatorDomains.length ? { excludedInitiatorDomains } : {}) } }));
  }

  /* Site exceptions for the packaged catalog: one allow rule per excepted site covering only the
     catalog hosts under that site, at the catalog's priority so no other protection is lifted. */
  function exceptionRules(catalogRules, sites, { base, budget }) {
    const initiators = new Map();
    for (const host of sites) {
      const site = knownSite(host);
      if (!site) continue;
      if (!initiators.has(site)) initiators.set(site, []);
      initiators.get(site).push(host);
    }
    const found = new Map();
    for (const rule of catalogRules) {
      for (const host of rule.condition.requestDomains) {
        for (let h = host.slice(host.indexOf('.') + 1); h.includes('.'); h = h.slice(h.indexOf('.') + 1)) {
          if (!initiators.has(h)) continue;
          if (!found.has(h)) found.set(h, new Set());
          found.get(h).add(host);
          break;
        }
      }
    }
    const groups = [...found.keys()].sort().map(site => ({ initiators: initiators.get(site), hosts: found.get(site) }));
    if (groups.length > budget) {
      const merged = groups.splice(budget - 1);
      groups.push({ initiators: merged.flatMap(group => group.initiators), hosts: new Set(merged.flatMap(group => [...group.hosts])) });
    }
    return groups.map((group, index) => ({ id: base + index, priority: rulePriority, action: { type: 'allow' },
      condition: { initiatorDomains: [...new Set(group.initiators)].sort(), requestDomains: [...group.hosts].sort(), resourceTypes } }));
  }

  return Object.freeze({ maxAliases, maxRules, rulePriority, resourceTypes, normalizeHost, validateEntries, validateData, resolve, compile,
    exactHostRegex, descendantRegex, exceptionRules });
})();
if (typeof module !== 'undefined') module.exports = WOCname;

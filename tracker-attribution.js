/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const WOTrackerAttribution = (() => {
  const MAX_BYTES = 128 * 1024, MAX_AGE = 365 * 86400000;
  const trackingCategories = new Set(['advertising', 'pornvertising', 'site_analytics', 'telemetry', 'mobile_analytics']);
  const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value);
  function shape(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  }
  function host(value) {
    if (typeof value !== 'string' || value.length > 8192 || !value) return '';
    try {
      const raw = value.trim();
      const url = /^https?:\/\//i.test(raw) ? new URL(raw) : !/[\s/\\:@%?#*\[\]]/.test(raw) ? new URL('https://' + raw) : null;
      if (!url || url.username || url.password) return '';
      const name = url.hostname.toLowerCase().replace(/\.$/, '');
      if (name.length > 253 || !name.includes('.') || /^\d+(?:\.\d+){3}$/.test(name)
          || name.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || wardenOneIsPublicSuffix(name)) return '';
      return name;
    } catch (_) { return ''; }
  }
  function validate(data, now = Date.now()) {
    if (!shape(data, ['schema','source','categories','organizations','trackers']) || data.schema !== 1
        || !shape(data.source, ['name','revision','updatedAt','license','inputSha256']) || data.source.name !== 'AdGuard Companies DB'
        || data.source.license !== 'CC-BY-SA-4.0' || !/^[a-f0-9]{40}$/.test(data.source.revision || '')
        || !Array.isArray(data.source.inputSha256) || data.source.inputSha256.length !== 2 || data.source.inputSha256.some(h => !/^[a-f0-9]{64}$/.test(h))) throw Error('Invalid catalog provenance');
    const updated = Date.parse(data.source.updatedAt);
    if (typeof data.source.updatedAt !== 'string' || !Number.isFinite(updated) || updated > now + 86400000 || now - updated > MAX_AGE) throw Error('Catalog date is stale or invalid');
    const collect = (rows, max, keys, check) => {
      if (!Array.isArray(rows) || !rows.length || rows.length > max) throw Error('Catalog record budget');
      const map = new Map();
      for (const row of rows) {
        if (!shape(row, keys) || !id(row.id) || !text(row.name) || map.has(row.id) || !check(row)) throw Error('Invalid catalog record');
        map.set(row.id, row);
      }
      return map;
    };
    const categories = collect(data.categories, 32, ['id','name'], () => true);
    const organizations = collect(data.organizations, 256, ['id','name'], () => true);
    const domains = new Map(); let count = 0;
    collect(data.trackers, 512, ['id','name','organization','category','domains'], row => {
      if (!organizations.has(row.organization) || !categories.has(row.category) || !Array.isArray(row.domains) || !row.domains.length || row.domains.length > 100) return false;
      for (const domain of row.domains) {
        if (host(domain) !== domain || domains.has(domain) || ++count > 2048) return false;
        domains.set(domain, Object.freeze({ id: row.id, name: row.name, organization: organizations.get(row.organization).name,
          category: categories.get(row.category).name, categoryId: row.category,
          kind: trackingCategories.has(row.category) ? 'known-tracker' : 'known-service', matchedDomain: domain,
          confidence: 'catalog-domain-match', datasetRevision: data.source.revision, datasetUpdatedAt: data.source.updatedAt,
          source: data.source.name, sourceUrl: 'https://github.com/AdguardTeam/companiesdb/blob/' + data.source.revision + '/dist/trackers.json' }));
      }
      return true;
    });
    return Object.freeze({ lookup(value) {
      const requestedHost = host(value); if (!requestedHost) return null;
      for (let candidate = requestedHost; candidate.includes('.'); candidate = candidate.slice(candidate.indexOf('.') + 1)) {
        const found = domains.get(candidate);
        if (found) return siteIdentity(requestedHost) === siteIdentity(candidate) ? { ...found, requestedHost } : null;
      }
      return null;
    }, revision: data.source.revision, updatedAt: data.source.updatedAt, domains: count });
  }
  async function read(response) {
    if (!response.ok) throw Error('Catalog unavailable');
    const declared = Number(response.headers?.get('content-length'));
    if (declared > MAX_BYTES) throw Error('Catalog byte budget');
    if (!response.body?.getReader) { const body = await response.text(); if (new TextEncoder().encode(body).length > MAX_BYTES) throw Error('Catalog byte budget'); return body; }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let body = '', bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > MAX_BYTES) throw Error('Catalog byte budget');
        body += decoder.decode(part.value, { stream: true });
      }
      return body + decoder.decode();
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  function createLoader(fetcher, url, clock = Date.now, timeoutMs = 3000) {
    let current = null, pending = null;
    return Object.freeze({ refresh() {
      if (pending) return pending;
      pending = (async () => {
        const controller = new AbortController(); let timeout;
        try {
          const next = await Promise.race([
            (async () => validate(JSON.parse(await read(await fetcher(url, { cache: 'no-store', signal: controller.signal }))), clock()))(),
            new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(Error('Catalog timeout')); }, timeoutMs); }),
          ]);
          if (current && Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) throw Error('Catalog rollback rejected');
          current = next;
          return { catalog: current, status: 'ready' };
        } catch (_) { controller.abort(); return { catalog: current, status: current ? 'cached' : 'unavailable' }; }
        finally { clearTimeout(timeout); }
      })().finally(() => { pending = null; });
      return pending;
    } });
  }
  function describe(catalog, value, observation = {}) {
    const identity = catalog?.lookup(value) || null;
    if (identity) return { ...identity, label: identity.name + ' · ' + identity.organization + ' · ' + identity.category };
    const kind = observation.suspected ? 'suspected-tracker' : observation.blocked ? 'blocked-unattributed' : 'unattributed';
    const requestedHost = host(value), suffix = (requestedHost ? requestedHost + ' · ' : '') + 'identity unknown';
    return { kind, requestedHost, label: kind === 'suspected-tracker' ? 'Locally suspected tracker · ' + suffix : kind === 'blocked-unattributed' ? 'Blocked request · ' + suffix : '' };
  }
  function historyHost(entry) {
    if (!/^(?:blocked_tracker_request|detected_thirdparty_tracker|proposed_tracker_domain|learned_tracker_domain|auto_learned_tracker_domain|auto_blocked_tracker_domain|unblocked_tracker_domain|detected_beacon|warned_logger_api|blocked_fingerprint_script)$/.test(entry?.type || '')) return '';
    const d = entry.detail || {};
    return host(d.domain || d.host || d.dest || d.url) || '';
  }
  function renderIdentity(parent, identity, className) {
    if (!identity?.label) return;
    const line = document.createElement('div'); line.className = className; line.textContent = identity.label;
    line.dataset.trackerIdentity = identity.id || identity.kind;
    if (identity.id) {
      line.title = 'Catalog hostname match: ' + identity.matchedDomain + '. Request outcome and evidence are shown separately. ' + identity.source + ', ' + identity.datasetUpdatedAt.slice(0,10);
      line.appendChild(document.createTextNode(' · '));
      const source = document.createElement('a'); source.href = identity.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Source';
      source.addEventListener('click', event => event.stopPropagation()); line.appendChild(source);
    }
    parent.appendChild(line);
  }
  return Object.freeze({ MAX_BYTES, host, validate, createLoader, describe, historyHost, renderIdentity });
})();
if (typeof module !== 'undefined') module.exports = WOTrackerAttribution;

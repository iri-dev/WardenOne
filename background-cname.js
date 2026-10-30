/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
let __knownAliases = null, __knownAliasSource = '', __knownAliasCatalog = null, __knownAliasesLoading = null;
/* Session cache of the computed exception band, keyed by catalog and sites, so a worker wake does
   not re-read the multi-megabyte catalog to confirm nothing changed. */
const CNAME_EXCEPTION_CACHE_KEY = 'wardenone_cname_exception_cache';

async function loadKnownAliases() {
  if (__knownAliases) return __knownAliases;
  if (__knownAliasesLoading) return __knownAliasesLoading;
  __knownAliasesLoading = (async () => {
    const response = await fetch(chrome.runtime.getURL('cname-trackers.json'));
    if (!response.ok) throw new Error('CNAME mapping unavailable');
    const text = await response.text();
    if (text.length > 256 * 1024) throw new Error('CNAME mapping exceeds its budget');
    const data = JSON.parse(text), mapping = WOCname.validateData(data);
    __knownAliasSource = data.source + '@' + data.revision;
    __knownAliasCatalog = data.catalog;
    __knownAliases = mapping;
    return mapping;
  })();
  try { return await __knownAliasesLoading; }
  finally { __knownAliasesLoading = null; }
}

function resolveKnownAlias(host) {
  return __knownAliases ? WOCname.resolve(__knownAliases, host, __knownAliasSource) : null;
}

async function loadCnameCatalog(summary) {
  const response = await fetch(chrome.runtime.getURL('rules-cname.json'));
  if (!response.ok) throw new Error('CNAME catalog unavailable');
  const text = await response.text();
  if (text.length > 6 * 1024 * 1024) throw new Error('CNAME catalog exceeds its budget');
  const rules = JSON.parse(text);
  if (!Array.isArray(rules) || rules.length !== summary.rules
      || rules.some(rule => !Array.isArray(rule?.condition?.requestDomains))) throw new Error('CNAME catalog does not match its summary');
  return rules;
}

/* Paused sites and this-site CNAME exceptions. Login and media hosts are excluded in the packaged rules. */
function cnameExceptionSites(cfg) {
  const hosts = new Set(activeAllowlist(cfg));
  for (const [pattern, entry] of Object.entries(cfg.siteOverrides || {})) {
    if (!entry || entry.blockCnameTrackers !== false) continue;
    const host = normalizeAllowlistHost(pattern);
    if (host) hosts.add(host);
  }
  if (hosts.size > 2000) throw new Error('CNAME site exception budget exceeded');
  return [...hosts].sort();
}

async function applyCnameRules(cfg, submitRules) {
  try {
    const enabled = cfg.enabled !== false && cfg.blockCnameTrackers !== false;
    const sites = enabled ? cnameExceptionSites(cfg) : [];
    let addRules = [];
    if (sites.length) {
      await loadKnownAliases();
      const key = JSON.stringify([__knownAliasCatalog.sha256, sites]);
      const cached = (await chrome.storage.session.get(CNAME_EXCEPTION_CACHE_KEY))[CNAME_EXCEPTION_CACHE_KEY];
      if (cached && cached.key === key && Array.isArray(cached.rules)) addRules = cached.rules;
      else {
        addRules = WOCname.exceptionRules(await loadCnameCatalog(__knownAliasCatalog), sites, { base: CNAME_RULE_BASE, budget: CNAME_RULES_BUDGET });
        await chrome.storage.session.set({ [CNAME_EXCEPTION_CACHE_KEY]: { key, rules: addRules } });
      }
    }
    const existing = await getDynamicRulesInBand(CNAME_RULE_BASE, CNAME_RULES_BUDGET);
    const mine = existing.filter(rule => rule.id >= CNAME_RULE_BASE && rule.id < CNAME_RULE_BASE + CNAME_RULES_BUDGET);
    if (!dnrBandUnchanged(mine, addRules, true)) {
      const change = { removeRuleIds: mine.map(rule => rule.id), addRules };
      await (submitRules ? submitRules(change) : writeDynamicRules(change));
    }
  } catch (error) {
    console.warn('[WardenOne] CNAME policy could not be applied', error);
    return false;
  }
}

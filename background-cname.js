/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
let __knownAliases = null, __knownAliasSource = '', __knownAliasesLoading = null;

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
    __knownAliases = mapping;
    return mapping;
  })();
  try { return await __knownAliasesLoading; }
  finally { __knownAliasesLoading = null; }
}

function resolveKnownAlias(host) {
  return __knownAliases ? WOCname.resolve(__knownAliases, host, __knownAliasSource) : null;
}

function cnameExcludedInitiators(cfg) {
  const hosts = new Set([...LOGIN_COMPAT_NEVER_BLOCK_DOMAINS, ...MEDIA_COMPAT_DOMAINS, ...activeAllowlist(cfg)]);
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
    const excludedInitiatorDomains = enabled ? cnameExcludedInitiators(cfg) : [];
    let addRules = [];
    if (enabled) {
      const mapping = await loadKnownAliases();
      addRules = WOCname.compile(mapping, { base: CNAME_RULE_BASE, excludedInitiatorDomains,
        protectedHost: host => isProtectedTrackerDomain(host) || isMediaCompatDomain(host) });
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

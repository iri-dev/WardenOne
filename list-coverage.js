/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const WO_LIST_COVERAGE = (() => {
  const metrics = [
    ['acceptedEntries', 'Accepted feed entries', 'Domain entries that passed parsing, before deduplication and source exclusions.'],
    ['listedDomains', 'Unique feed hostnames', 'Distinct hostnames remaining after source exclusions.'],
    ['coveredDomains', 'Feed hostnames covered', 'Listed hostnames covered by an installed domain rule, including subdomains covered by a parent.'],
    ['installedHostEntries', 'Hostnames in browser rules', 'Hostnames explicitly stored in the downloaded domain rules.'],
    ['installedDomainRules', 'Domain rules', 'Browser rules containing the packed hostname lists.'],
    ['installedOptionRules', 'URL filter rules', 'Browser rules with URL patterns or request conditions, including exceptions.'],
    ['installedRedirectRules', 'Replacement rules', 'Browser rules that substitute a packaged file for a request.'],
    ['installedCspRules', 'Content policy rules', 'Browser rules that append a Content Security Policy.'],
  ];

  function read(value) {
    if (!value || metrics.some(([key]) => !Number.isSafeInteger(value[key]) || value[key] < 0)) return null;
    if (value.installedDomainRules > value.installedHostEntries || value.installedHostEntries > value.coveredDomains
        || value.coveredDomains > value.listedDomains || value.listedDomains > value.acceptedEntries) return null;
    return value;
  }

  function rows(value, selection) {
    const coverage = read(value);
    if (!coverage) return [];
    const result = metrics.map(([key, label, definition]) => ({ label, count: coverage[key], definition }));
    if (selection && ['eligible', 'redundant', 'capacity'].every(key =>
      Number.isSafeInteger(selection[key]) && selection[key] >= 0)
      && selection.eligible >= coverage.installedOptionRules && selection.capacity >= coverage.installedOptionRules) {
      result.push(
        { label: 'Eligible URL filters', count: selection.eligible, definition: 'Unique candidates left after source caps, safety checks, and removal of redundant host rules.' },
        { label: 'Redundant URL filters skipped', count: selection.redundant, definition: 'Third-party whole-host filters already covered by the downloaded domain rules.' },
        { label: 'URL filter capacity', count: selection.capacity, definition: 'Maximum browser rules available to this downloaded URL filter band.' },
      );
    }
    return result;
  }

  return Object.freeze({ read, rows });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WO_LIST_COVERAGE;

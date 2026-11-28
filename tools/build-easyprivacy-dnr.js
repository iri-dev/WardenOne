/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
// Batch third-party tracker hosts by resource type.
// Usage: node tools/build-easyprivacy-dnr.js <easyprivacy.txt> <rules-trackers.json> <out rules-easyprivacy.json> [maxHosts]
'use strict';

const fs = require('fs');

// Resource types a tracker host is blocked for. Mirrors rules-trackers.json EXACTLY:
// every subresource type, but NOT main_frame / document -- so navigating directly to a
// tracker domain still works, we only stop it loading as a third-party subresource.
const RESOURCE_TYPES = [
  'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];
const BATCH = 500;          // hostnames per rule; rules-cname.json proves far larger lists load
const PRIORITY = 1000;      // same priority band as rules-trackers.json

// Well-known, high-prevalence trackers/RUM/session-replay/attribution vendors the audit
// flagged as missing from the 44-host list. Guaranteed into the output regardless of where
// they sit in EasyPrivacy's file order, so the named gaps are definitely closed.
const PRIORITY_HOSTS = [
  // RUM / APM / error monitoring
  'newrelic.com', 'nr-data.net', 'datadoghq.com', 'datadoghq-browser-agent.com',
  'browser-intake-datadoghq.com', 'sentry.io', 'ingest.sentry.io', 'bugsnag.com',
  'rollbar.com', 'raygun.io', 'logrocket.com', 'logrocket.io', 'smartlook.com',
  // product analytics / attribution
  'segment.com', 'segment.io', 'cdn.segment.com', 'api.segment.io', 'posthog.com',
  'amplitude.com', 'api.amplitude.com', 'cdn.amplitude.com', 'mixpanel.com',
  'api.mixpanel.com', 'heap.io', 'heapanalytics.com', 'statsig.com', 'featuregates.org',
  'branch.io', 'app.link', 'adjust.com', 'app.adjust.com', 'appsflyer.com',
  'kochava.com', 'singular.net', 'tenjin.io',
  // session replay / heatmaps / UX
  'fullstory.com', 'fs.fullstory.com', 'contentsquare.net', 'contentsquare.com',
  'hotjar.com', 'hotjar.io', 'static.hotjar.com', 'mouseflow.com', 'luckyorange.com',
  'luckyorange.net', 'inspectlet.com', 'crazyegg.com', 'clarity.ms', 'quantummetric.com',
  // tag managers / CDPs / experimentation
  'tealium.com', 'tiqcdn.com', 'optimizely.com', 'optimizelyapis.com', 'kameleoon.com',
  'kameleoon.eu', 'launchdarkly.com', 'split.io', 'vwo.com', 'visualwebsiteoptimizer.com',
  'dynamicyield.com', 'evergage.com',
  // ad / social pixels & data brokers
  'doubleclick.net', 'googlesyndication.com', 'googletagmanager.com', 'googletagservices.com',
  'google-analytics.com', 'analytics.google.com', 'connect.facebook.net', 'facebook.com',
  'ads-twitter.com', 'analytics.tiktok.com', 'ct.pinterest.com', 'px.ads.linkedin.com',
  'snap.licdn.com', 'bat.bing.com', 'scorecardresearch.com', 'quantserve.com',
  'quantcount.com', 'demdex.net', 'omtrdc.net', 'everesttech.net', 'adsrvr.org',
  'rlcdn.com', 'rfihub.com', 'krxd.net', 'bluekai.com', 'agkn.com', 'crwdcntrl.net',
  'mathtag.com', 'casalemedia.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'yieldmo.com',
  'mc.yandex.ru', 'matomo.cloud', 'chartbeat.com', 'parsely.com', 'cxense.com',
];

function isValidDomain(h) {
  if (!h || h.length > 253 || h.indexOf('.') === -1) return false;
  if (h.includes('*') || h.includes('_') || h.includes('/')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;            // raw IPv4 -> not a requestDomain
  if (/[^a-z0-9.-]/.test(h)) return false;                        // ascii host chars only
  const labels = h.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => l && l.length <= 63 && !/^-|-$/.test(l));
}

const RESOURCE_TYPE_ALIASES = new Map([
  ['subdocument', 'sub_frame'], ['frame', 'sub_frame'], ['xhr', 'xmlhttprequest'],
  ['beacon', 'ping'], ['csp-report', 'csp_report'],
]);
const THIRD_PARTY_OPTIONS = new Set(['third-party', '3p', '~first-party', '~1p']);

function parseHostRule(line) {
  const match = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(?:\$([a-z0-9,~_-]+))?$/i.exec(line.trim());
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!isValidDomain(host)) return null;
  if (!match[2]) return { host, types: RESOURCE_TYPES };

  const included = new Set();
  const excluded = new Set();
  for (const option of match[2].toLowerCase().split(',')) {
    if (THIRD_PARTY_OPTIONS.has(option)) continue;
    const negated = option.startsWith('~');
    const name = negated ? option.slice(1) : option;
    const type = RESOURCE_TYPE_ALIASES.get(name) || name;
    if (!RESOURCE_TYPES.includes(type)) return null;
    (negated ? excluded : included).add(type);
  }
  const types = RESOURCE_TYPES.filter(type => (!included.size || included.has(type)) && !excluded.has(type));
  return types.length ? { host, types } : null;
}

function compileHostRules(text, existing) {
  const byHost = new Map();
  let scanned = 0;
  for (const line of text.split(/\r?\n/)) {
    const entry = parseHostRule(line);
    if (!entry) continue;
    scanned++;
    const previous = byHost.get(entry.host);
    const types = previous
      ? RESOURCE_TYPES.filter(type => previous.includes(type) || entry.types.includes(type))
      : entry.types;
    byHost.set(entry.host, types);
  }

  const priorityHosts = new Set(PRIORITY_HOSTS);
  for (const host of priorityHosts) byHost.set(host, RESOURCE_TYPES);
  const ordered = [...byHost.keys()].sort();
  const hosts = ordered.filter(host => priorityHosts.has(host)).concat(ordered.filter(host => !priorityHosts.has(host)));

  const groups = new Map();
  let kept = 0;
  for (const host of hosts) {
    if (existing.has(host)) continue;
    const inherited = new Set();
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (existing.has(parent)) continue;
      for (const type of byHost.get(parent) || []) inherited.add(type);
    }
    const types = byHost.get(host).filter(type => !inherited.has(type));
    if (!types.length) continue;
    const key = types.join(',');
    if (!groups.has(key)) groups.set(key, { types, hosts: [] });
    groups.get(key).hosts.push(host);
    kept++;
  }

  const rules = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.hosts.length; i += BATCH) {
      rules.push({
        id: rules.length + 1,
        priority: PRIORITY,
        action: { type: 'block' },
        condition: { requestDomains: group.hosts.slice(i, i + BATCH), domainType: 'thirdParty', resourceTypes: group.types },
      });
    }
  }
  return { rules, scanned, unique: byHost.size, kept };
}

function main() {
  const [, , epPath, trackersPath, outPath, maxArg] = process.argv;
  if (!epPath || !trackersPath || !outPath) {
    console.error('usage: node build-easyprivacy-dnr.js <easyprivacy.txt> <rules-trackers.json> <out> [maxHosts]');
    process.exit(2);
  }
  const maxHosts = Math.max(100, Number(maxArg) || 100000);
  const existing = new Set();
  try {
    const trackers = JSON.parse(fs.readFileSync(trackersPath, 'utf8'));
    for (const rule of trackers) {
      for (const domain of rule.condition?.requestDomains || []) existing.add(String(domain).toLowerCase());
    }
  } catch (_) {}

  const { rules, scanned, unique, kept } = compileHostRules(fs.readFileSync(epPath, 'utf8'), existing);
  if (kept > maxHosts) {
    console.error('easyprivacy: ' + kept + ' hosts exceed the ' + maxHosts + '-host ceiling; raise it deliberately');
    process.exit(1);
  }
  fs.writeFileSync(outPath, JSON.stringify(rules));
  console.log('easyprivacy host blocks: lines-matched=' + scanned + ' unique=' + unique
    + ' shipped=' + kept + ' in ' + rules.length + ' rules (BATCH=' + BATCH + ')');
}

if (require.main === module) main();
module.exports = { compileHostRules };

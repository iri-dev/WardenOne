/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
#!/usr/bin/env node
// Builds rules-easyprivacy.json -- a STATIC declarativeNetRequest ruleset of
// third-party TRACKER HOSTS derived from EasyPrivacy, to back the "Block trackers"
// toggle with real coverage (the hand-curated rules-trackers.json was only ~44 hosts).
//
// Budget-aware: the adshield EasyList ruleset already consumes ~28k of Chrome's ~30k
// guaranteed static-rule budget, so we CANNOT ship ~10k individual tracker rules. Instead
// we BATCH many hostnames into each rule's `requestDomains` array (DNR matches the request
// domain or any subdomain of it). This is the same technique uBlock Origin Lite uses, and
// turns thousands of tracker hosts into a few dozen rules -- negligible budget impact.
//
// We keep ONLY pure third-party host blocks (||host^ / ||host^$third-party). Path rules,
// regex, domain-scoped, cosmetic and exception filters are skipped (the adshield ruleset
// and the cosmetic engine cover those); approximating them risks breaking sites.
//
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
const BATCH = 100;          // hostnames per rule (well under DNR's per-rule domain limit)
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

// Pure host block: ||host^ optionally with $third-party / $3p / plain type tokens. Reject
// anything carrying domain= (site-scoped; charset below already excludes '='), exceptions,
// paths, wildcards, or regex.
function hostFromLine(line) {
  const s = line.trim();
  if (!s || s[0] === '!' || s[0] === '[' || s.startsWith('@@')) return null;
  if (/#[#@?$%]#?/.test(s)) return null;                         // cosmetic/scriptlet
  const m = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(?:\$[a-z0-9,~_-]+)?$/i.exec(s);
  if (!m) return null;
  const host = m[1].toLowerCase();
  return isValidDomain(host) ? host : null;
}

function main() {
  const [, , epPath, trackersPath, outPath, maxArg] = process.argv;
  if (!epPath || !trackersPath || !outPath) {
    console.error('usage: node build-easyprivacy-dnr.js <easyprivacy.txt> <rules-trackers.json> <out> [maxHosts]');
    process.exit(2);
  }
  const maxHosts = Math.max(100, Number(maxArg) || 8000);

  // Hosts already covered by the curated trackers ruleset -> don't duplicate.
  let existing = new Set();
  try {
    const tr = JSON.parse(fs.readFileSync(trackersPath, 'utf8'));
    for (const r of tr) for (const d of ((r.condition && r.condition.requestDomains) || [])) existing.add(String(d).toLowerCase());
  } catch (_) {}

  const text = fs.readFileSync(epPath, 'utf8');
  const set = new Set();
  let scanned = 0;
  for (const line of text.split(/\r?\n/)) {
    const h = hostFromLine(line);
    if (h) { scanned++; set.add(h); }
  }
  for (const h of PRIORITY_HOSTS) if (isValidDomain(h)) set.add(h);

  // Ancestor de-dup: requestDomains matches a domain AND its subdomains, so if example.com
  // is present, a.example.com is redundant. Drop the child to maximise coverage per entry.
  const all = Array.from(set).sort();
  const kept = [];
  for (const h of all) {
    if (existing.has(h)) continue;
    let covered = false;
    const parts = h.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (set.has(parent) && !existing.has(parent)) { covered = true; break; }
    }
    if (!covered) kept.push(h);
  }

  // Keep priority hosts first, then fill to the cap.
  const prioritySet = new Set(PRIORITY_HOSTS.filter((h) => kept.includes(h)));
  const ordered = kept.filter((h) => prioritySet.has(h)).concat(kept.filter((h) => !prioritySet.has(h)));
  const finalHosts = ordered.slice(0, maxHosts);

  // domainType:'thirdParty' -- this auto-generated set blocks trackers only in a THIRD-PARTY
  // context, so it can never block a site loading a resource from its OWN domain. That makes
  // a large, un-hand-vetted host list safe to ship (the curated rules-trackers.json blocks
  // its 44 dedicated hosts in any context; this broader set stays conservative).
  const rules = [];
  for (let i = 0; i < finalHosts.length; i += BATCH) {
    rules.push({
      id: rules.length + 1,
      priority: PRIORITY,
      action: { type: 'block' },
      condition: { requestDomains: finalHosts.slice(i, i + BATCH), domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES },
    });
  }

  fs.writeFileSync(outPath, JSON.stringify(rules));
  console.log('easyprivacy host blocks: lines-matched=' + scanned + ' unique=' + set.size
    + ' after-ancestor/existing-dedup=' + kept.length + ' shipped=' + finalHosts.length
    + ' in ' + rules.length + ' rules (BATCH=' + BATCH + ')');
}

main();

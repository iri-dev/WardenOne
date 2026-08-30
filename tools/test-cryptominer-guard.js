/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// Cryptojacking guard (toggle: blockCryptominers).
//
// The guard splits its seed list into two buckets that are deliberately NOT
// treated the same, and the split is the whole reason it can be on by default:
//
//   minerHosts -- mining-as-a-service. Blocked on every resource type.
//   poolHosts  -- real mining pools with real websites. Blocked only as
//                 third-party subresources, never main_frame, so a user who
//                 actually mines can still reach the pool they use.
//
// If a later edit lets main_frame into the pool bucket, or drops the
// third-party condition, the guard silently starts blocking legitimate sites
// outright. That is a compatibility bug under the house rules, so it is asserted
// here rather than left to a bug report.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'cryptominer-domains.json'), 'utf8'));
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

// Domains that must never appear in a blocklist. A miner list is a plausible
// place for a typo'd or over-broad entry to land, and the blast radius of
// blocking one of these on main_frame is a broken browser.
const MUST_NEVER_BLOCK = [
  'google.com', 'gstatic.com', 'googleapis.com', 'cloudflare.com', 'cloudfront.net',
  'microsoft.com', 'live.com', 'office.com', 'apple.com', 'icloud.com',
  'amazonaws.com', 'akamai.net', 'akamaihd.net', 'jsdelivr.net', 'unpkg.com',
  'github.com', 'githubusercontent.com', 'mozilla.org', 'wikipedia.org',
  'youtube.com', 'facebook.com', 'twitch.tv', 'paypal.com', 'stripe.com',
];

function num(name) {
  const m = BG.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)\\s*;'));
  assert(m, 'missing constant ' + name + ' in background.js');
  return Number(m[1]);
}

/* Resource-type lists are derived from a single ALL_DNR_RESOURCE_TYPES
   inventory now, so a regex for "const X = [...]" no longer finds them. Resolve
   the right-hand side instead, in a sandbox seeded with the constants it may
   refer to. These assertions then check the value that actually ships rather
   than the shape the source happens to be written in -- which is the point,
   since the invariants below are about behaviour, not syntax. */
function constDecl(name) {
  const at = BG.indexOf('const ' + name + ' =');
  assert(at >= 0, 'missing constant ' + name + ' in background.js');
  const end = BG.indexOf(';', at);
  assert(end > at, 'unterminated constant ' + name + ' in background.js');
  return BG.slice(at, end + 1);
}

function resourceTypeList(name) {
  const needed = ['ALL_DNR_RESOURCE_TYPES', 'SECURITY_RESOURCE_TYPES', name]
    .filter((n, i, a) => a.indexOf(n) === i);
  const sandbox = { __result: null };
  vm.runInNewContext(needed.map(constDecl).join(' ') + ' __result = ' + name + ';', sandbox);
  assert(Array.isArray(sandbox.__result), name + ' did not resolve to an array');
  return sandbox.__result;
}

function arrayLiteral(name) {
  const m = BG.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]'));
  assert(m, 'missing constant ' + name + ' in background.js');
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

let passed = 0;
function check(label, cond) {
  assert(cond, label);
  console.log('  ok  - ' + label);
  passed++;
}

function run() {
  // ---- seed list shape -------------------------------------------------
  assert(Array.isArray(SEED.minerHosts), 'minerHosts must be an array');
  assert(Array.isArray(SEED.poolHosts), 'poolHosts must be an array');
  check('seed list has both buckets populated', SEED.minerHosts.length > 0 && SEED.poolHosts.length > 0);

  const bad = [];
  for (const d of SEED.minerHosts.concat(SEED.poolHosts)) {
    // Same validator the runtime applies; anything failing it is dead weight
    // that silently never becomes a rule.
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) || d.includes('..')) bad.push(d);
  }
  check('every seed entry survives the runtime domain validator', bad.length === 0
    ? true : assert.fail('entries the runtime would silently drop: ' + bad.join(', ')));

  const dupes = [];
  const seen = new Set();
  for (const d of SEED.minerHosts.concat(SEED.poolHosts)) {
    if (seen.has(d)) dupes.push(d);
    seen.add(d);
  }
  check('no duplicate entries across buckets', dupes.length === 0
    ? true : assert.fail('duplicates: ' + dupes.join(', ')));

  const overlap = MUST_NEVER_BLOCK.filter((safe) =>
    seen.has(safe) || Array.from(seen).some((d) => d === safe || d.endsWith('.' + safe)));
  check('no major legitimate domain is in the miner list', overlap.length === 0
    ? true : assert.fail('would block legitimate infrastructure: ' + overlap.join(', ')));

  // ---- the false-positive-critical invariants --------------------------
  const poolTypes = resourceTypeList('MINER_POOL_RESOURCE_TYPES');
  check('pool rules never block main_frame (visiting a pool must still work)',
    !poolTypes.includes('main_frame'));
  check('pool rules still cover websocket (stratum runs over WSS)',
    poolTypes.includes('websocket'));

  const applyFn = BG.slice(BG.indexOf('async function applyMinerFeedRules'));
  const applyBody = applyFn.slice(0, applyFn.indexOf('\n}\n'));
  check('pool rules are third-party only', /domainType:\s*'thirdParty'/.test(applyBody));
  check('miner-host rules are NOT limited to third-party',
    (applyBody.match(/domainType:\s*'thirdParty'/g) || []).length === 1);

  const minerTypes = resourceTypeList('MINER_RESOURCE_TYPES');
  check('miner-host rules cover main_frame and websocket',
    minerTypes.includes('main_frame') && minerTypes.includes('websocket'));

  // ---- rule id band ----------------------------------------------------
  const base = num('MINER_FEED_RULE_BASE');
  const max = num('MINER_FEED_MAX');
  const offset = num('MINER_POOL_RULE_OFFSET');
  const budget = num('MINER_FEED_RULES_BUDGET');

  check('rule band sits in the free 742000-744999 range', base === 742000 && base + max <= 745000);
  check('declared budget matches the band size', budget === max);
  check('pool offset leaves room for both buckets', offset > 0 && offset < max);
  check('seed miner hosts fit below the pool offset', SEED.minerHosts.length <= offset);
  check('seed pool hosts fit in the tail of the band', SEED.poolHosts.length <= max - offset);

  // The band must not overlap the neighbouring feeds.
  const grabberBase = num('GRABBER_FEED_RULE_BASE');
  const grabberMax = num('GRABBER_FEED_MAX');
  const neverBlockBase = num('NEVER_BLOCK_ALLOW_RULE_BASE');
  check('band starts after the grabber feed ends', base >= grabberBase + grabberMax);
  check('band ends before the never-block allow rules begin', base + max <= neverBlockBase);

  // ---- wiring ----------------------------------------------------------
  check('blockCryptominers is in DEFAULT_CONFIG and defaults on',
    /blockCryptominers:\s*true/.test(BG));
  check('the toggle reapplies rules when it changes',
    /o\.blockCryptominers\s*!==\s*n\.blockCryptominers/.test(BG));
  check('the feed loads at startup', /^loadMinerFeed\(\);$/m.test(BG));
  check('the guard counts toward the protection health score',
    /'blockCryptominers'/.test(BG.slice(BG.indexOf('HEALTH_SHIELD_KEYS'))));
  check('popup exposes the toggle', /data-key="blockCryptominers"/.test(POPUP_HTML));
  check('popup knows the key and its default',
    /'blockCryptominers'/.test(POPUP_JS) && /blockCryptominers:\s*true/.test(POPUP_JS));

  // ---- deep detection (cryptominerCpuWatch) ----------------------------
  // Reads the source of workers a page starts and warns when it finds mining
  // code. It deliberately does NOT measure CPU load: measured on a 12-core
  // machine against a spinning worker per core, a main-thread benchmark moved
  // 1.03-1.21x, a probe worker 1.63x but only against a baseline taken before
  // the miner starts, and a baseline-free worker/main ratio 1.21x. All of those
  // either cannot fire or fire on any busy page, and none of them can tell
  // mining apart from a video export. Load is not evidence of mining, so the
  // guard must not start treating it as evidence.
  const DETECT = fs.readFileSync(path.join(ROOT, 'cryptominer-detect.js'), 'utf8');

  check('deep detection defaults OFF in background', /cryptominerCpuWatch:\s*false/.test(BG));
  check('deep detection defaults OFF in popup', /cryptominerCpuWatch:\s*false/.test(POPUP_JS));
  check('deep detection is not switched on by "Turn everything on"',
    /MANUAL_ONLY_TOGGLES\s*=\s*new Set\(\[[^\]]*'cryptominerCpuWatch'/.test(POPUP_JS));
  /* Slice by named anchors, and insist both exist. The end anchor used to be
     EXT_HIGH_RISK_PERMS; when that constant moved to background-extension-watch.js
     indexOf returned -1, slice(start, -1) quietly ran to the end of the file, and
     this check started scanning all of background.js and failing on an unrelated
     mention. A slice whose bounds are not verified is not a check, it is a
     coincidence. */
  const bundleStart = BG.indexOf('const ONBOARDING_RECOMMENDED');
  const bundleEnd = BG.indexOf('const REMOTE_LISTS');
  assert(bundleStart >= 0, 'missing ONBOARDING_RECOMMENDED anchor in background.js');
  assert(bundleEnd > bundleStart, 'missing REMOTE_LISTS anchor after the onboarding bundles');
  check('deep detection is not in any onboarding bundle',
    !/cryptominerCpuWatch/.test(BG.slice(bundleStart, bundleEnd)));

  // Off by default is only meaningful if the script is not loaded at all.
  const reconcile = BG.slice(BG.indexOf('async function reconcileMinerDetectInjection'));
  const reconcileBody = reconcile.slice(0, reconcile.indexOf('\n}\n'));
  check('detector is only registered when the toggle is explicitly on',
    /cryptominerCpuWatch\s*===\s*true/.test(reconcileBody));
  check('detector is unregistered when the toggle goes off',
    /unregisterContentScripts/.test(reconcileBody));
  check('detector is not a static content script (would defeat lazy loading)',
    !/cryptominer-detect\.js/.test(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')));
  check('detector runs in the MAIN world (needs the page realm to hook Worker)',
    /world:\s*'MAIN'/.test(reconcileBody));

  // It terminates workers now, so the guards that keep that safe are the whole
  // ballgame. Each of these, if lost, turns the feature into something that
  // breaks sites.
  check('nothing is terminated before the config (and so the allowlist) arrives',
    /if \(!configReady\)/.test(DETECT) && /pending\.push/.test(DETECT) && /flushPending/.test(DETECT));
  check('an allowlisted site is reported but never acted on',
    /if \(masterOff \|\| siteAllowlisted\)/.test(DETECT)
      && /detected_cryptominer/.test(DETECT) && /blocked_cryptominer/.test(DETECT));
  check('the allowlist is matched the same way the content script matches it',
    /HOST === h \|\| HOST\.endsWith\('\.' \+ h\)/.test(DETECT));
  check('only workers whose own source matched are terminated',
    /liveByUrl\[url\]/.test(DETECT) && !/for \(var k in liveByUrl\)/.test(DETECT));
  check('respawned miners are killed on sight without a re-scan',
    /minerSources\[href\]/.test(DETECT) && /killWorker\(w\)/.test(DETECT));
  check('the scan budget is raised once a page is confirmed, so respawns are caught',
    /SCAN_BUDGET_CONFIRMED/.test(DETECT));
  check('a miner cannot save itself by replacing terminate()',
    /__woNativeTerminate/.test(DETECT) && /writable: false/.test(DETECT));
  // This used to assert that both files contained the string `__wardenOneBridgeReplay`. They did,
  // and the call could still never land: the detector runs in MAIN and the bridge publishes that
  // global on its own ISOLATED window. Two files mentioning the same name is not a connection
  // between them. The replay now goes through the shared document, and tools/test-miner-realms.js
  // drives both worlds to prove it arrives.
  check('detector asks for a replay through the shared document, not a cross-world global',
    /document\.dispatchEvent\(new CustomEvent\('wo-bridge-replay'\)\)/.test(DETECT)
      && !/window\.__wardenOneBridgeReplay\s*(?:===|\()/.test(DETECT)
      && /'wo-bridge-replay'/.test(fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8')));
  check('detector does not resurrect a CPU-load verdict',
    !/detected_cpu_abuse/.test(DETECT) && !/slowdown/.test(DETECT));
  check('detector decides on worker source, not on load',
    /MINER_TELLS/.test(DETECT) && /scanWorkerSource/.test(DETECT));
  check('tells exclude words that are legitimate elsewhere',
    !/\bnonce\b/.test(String(DETECT.match(/var MINER_TELLS = [^;]+;/) || ''))
      && !/scrypt|argon2/.test(String(DETECT.match(/var MINER_TELLS = [^;]+;/) || '')));
  check('cross-origin worker scripts are never fetched',
    /u\.origin !== location\.origin/.test(DETECT));
  check('scanning is bounded per page',
    /SCAN_BUDGET\s*=\s*\d+/.test(DETECT) && /scanned >= scanBudget/.test(DETECT));
  // Reported once, but killing continues -- a miner that respawns must keep
  // being stopped without spamming the activity log for every replacement.
  check('detector reports at most once per page',
    (DETECT.match(/if \(!reported\) \{ reported = true; announce\(/g) || []).length === 2);
  check('detector cloaks its Worker wrapper from the page',
    /Wrapped\.toString\s*=/.test(DETECT));
  const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
  check('history labels both outcomes',
    /blocked_cryptominer:/.test(HISTORY) && /detected_cryptominer:/.test(HISTORY));
  check('popup exposes the deep toggle', /data-key="cryptominerCpuWatch"/.test(POPUP_HTML));
  check('popup copy does not claim a CPU benchmark it no longer runs',
    !/benchmark/i.test(POPUP_HTML) && !/Expensive to run/i.test(POPUP_HTML));
  check('popup copy says it stops miners rather than only warning',
    /stops the ones running mining routines/i.test(POPUP_HTML)
      && !/it only warns/i.test(POPUP_HTML));

  console.log('\n' + passed + ' passed, 0 failed');
}

run();

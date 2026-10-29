/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// Reserve capacity inside Chrome's guaranteed allocation rather than depending
// on the shared pool. Duplicate rule IDs can invalidate an entire ruleset.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Chrome's guaranteed budget for enabled static rulesets. More may be available
// from a global pool shared with every other installed extension, but that is not
// guaranteed to us, so it must not be relied on.
const GUARANTEED_STATIC_RULES = 30000;
const MIN_STATIC_RULE_HEADROOM = 1000;
const MAX_ENABLED_RULESETS = 50;
const MAX_RULESETS = 100;

function rulesetPath(entry) {
  return path.join(ROOT, String(entry.path || '').replace(/^\/+/, ''));
}

function assertStaticHeadroom(resources, ruleCount) {
  // Disabled packs can be enabled later, so reserve their capacity too.
  const total = resources.reduce((sum, entry) => sum + ruleCount(entry), 0);
  const headroom = GUARANTEED_STATIC_RULES - total;
  assert(headroom >= MIN_STATIC_RULE_HEADROOM,
    'packaged static rules ' + total + ' leave ' + headroom + ' spare; require at least '
    + MIN_STATIC_RULE_HEADROOM + ' below Chrome\'s guaranteed ' + GUARANTEED_STATIC_RULES
    + '. Review rule growth before shipping; do not depend on the shared global pool.');
  return { total, headroom };
}

function run() {
  const dnr = MANIFEST.declarative_net_request || {};
  const resources = Array.isArray(dnr.rule_resources) ? dnr.rule_resources : [];
  assert(resources.length > 0, 'manifest declares no static rulesets');
  assert(resources.length <= MAX_RULESETS,
    'declared rulesets ' + resources.length + ' exceed Chrome\'s ceiling of ' + MAX_RULESETS);

  let enabledRules = 0;
  let enabledSets = 0;
  const seenIds = new Set();
  const counts = new Map();

  for (const entry of resources) {
    const file = rulesetPath(entry);
    assert(fs.existsSync(file), 'ruleset file missing: ' + entry.path);

    let rules;
    try {
      rules = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      assert.fail('ruleset ' + entry.id + ' is not valid JSON: ' + e.message);
    }
    assert(Array.isArray(rules), 'ruleset ' + entry.id + ' is not an array');

    // Duplicate ids inside one file cost the whole file, not just the duplicate.
    const ids = new Set();
    for (const rule of rules) {
      const id = rule && rule.id;
      assert(Number.isInteger(id) && id > 0,
        'ruleset ' + entry.id + ' has a rule with a non-positive-integer id');
      assert(!ids.has(id), 'ruleset ' + entry.id + ' has duplicate rule id ' + id);
      ids.add(id);
    }

    assert(!seenIds.has(entry.id), 'duplicate ruleset id ' + entry.id);
    seenIds.add(entry.id);
    counts.set(entry.id, rules.length);

    if (entry.enabled) {
      enabledSets += 1;
      enabledRules += rules.length;
    }
    console.log('  ' + entry.id + ': ' + rules.length + ' rules' + (entry.enabled ? ' (enabled)' : ' (disabled)'));
  }

  assert(enabledSets <= MAX_ENABLED_RULESETS,
    'enabled rulesets ' + enabledSets + ' exceed Chrome\'s ceiling of ' + MAX_ENABLED_RULESETS);

  const { total, headroom } = assertStaticHeadroom(resources, (entry) => counts.get(entry.id));
  console.log('  enabled static rules: ' + enabledRules + '; packaged: ' + total + ' / '
    + GUARANTEED_STATIC_RULES + ' (headroom ' + headroom + ', required ' + MIN_STATIC_RULE_HEADROOM + ')');

  for (const [count, passes] of [[28999, true], [29000, true], [29001, false],
    [29975, false], [30000, false], [30001, false]]) {
    const check = () => assertStaticHeadroom([{ count }], (entry) => entry.count);
    if (passes) assert.equal(check().headroom, GUARANTEED_STATIC_RULES - count);
    else assert.throws(check, /spare; require at least/, 'static total ' + count + ' escaped the gate');
  }
  assert.throws(() => assertStaticHeadroom([
    { enabled: true, count: 28900 }, { enabled: false, count: 101 },
  ], (entry) => entry.count), /spare; require at least/, 'disabled packs must reserve capacity');

  const budget = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/perf/static-budget.json'), 'utf8'));
  assert.equal(budget.maximum.staticDnrRules, GUARANTEED_STATIC_RULES - MIN_STATIC_RULE_HEADROOM,
    'the staged package budget must retain the same static-rule reserve');
  console.log('[ok] DNR static rule budget retains spare capacity');
}

// Chrome 121+ separates dynamic and session quotas. Unsafe dynamic actions have
// a smaller sublimit; every quota also needs capacity beyond today's allocations.
const MAX_DYNAMIC_RULES = 30000;
const MAX_SESSION_RULES = 5000;
const MAX_UNSAFE_DYNAMIC_RULES = 5000;
const DYNAMIC_LIMIT_SINCE_CHROME = 121;

function numberConstant(source, name) {
  const m = source.match(new RegExp('^const\\s+' + name + '\\s*=\\s*(\\d+)\\s*;', 'm'));
  assert(m, 'background.js no longer declares a numeric ' + name);
  return Number(m[1]);
}

function allocation(bg, name) {
  const expr = bg.match(new RegExp('^const\\s+' + name + '\\s*=\\s*([\\s\\S]*?);', 'm'));
  assert(expr, 'background.js no longer declares ' + name);
  assert(/^[\sA-Z0-9_+]+$/.test(expr[1]), name + ' must be a sum of numeric constants');
  const terms = expr[1].split('+').map((part) => part.trim());
  assert(new Set(terms).size === terms.length, name + ' counts a band twice');
  return { bands: terms.filter((term) => !/^\d+$/.test(term)),
    total: terms.reduce((sum, term) => sum + (/^\d+$/.test(term) ? Number(term) : numberConstant(bg, term)), 0) };
}

function assertQuotas(bg, verbose = false) {
  const spare = numberConstant(bg, 'DNR_MIN_RULE_HEADROOM');
  assert(spare >= 1000, 'keep at least 1000 rules of headroom per quota');
  const budgets = {};
  for (const [name, limit] of [
    ['TOTAL_DYNAMIC_BUDGET', MAX_DYNAMIC_RULES],
    ['TOTAL_SESSION_BUDGET', MAX_SESSION_RULES],
    ['TOTAL_UNSAFE_DYNAMIC_BUDGET', MAX_UNSAFE_DYNAMIC_RULES],
  ]) {
    const value = allocation(bg, name);
    assert(value.total <= limit, name + ' exceeds Chrome quota ' + limit);
    assert(limit - value.total >= spare, name + ' leaves less than ' + spare + ' headroom');
    budgets[name] = value;
    if (verbose) console.log('  ' + name + ': ' + value.total + ' / ' + limit + ' (headroom ' + (limit - value.total) + ')');
  }
  return budgets;
}

function runDynamic() {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const budgets = assertQuotas(bg, true);
  const dynamicBands = budgets.TOTAL_DYNAMIC_BUDGET.bands;
  const sessionBands = budgets.TOTAL_SESSION_BUDGET.bands;
  const bands = dynamicBands.concat(sessionBands);
  assert(dynamicBands.length >= 10 && sessionBands.length >= 5, 'quota allocation lost its band inventory');
  assert(new Set(bands).size === bands.length, 'dynamic and session allocations must be separate');
  const declaredBands = [...bg.matchAll(/^const ([A-Z][A-Z0-9_]*_RULES_BUDGET) = \d+;/gm)].map((m) => m[1]);
  assert(declaredBands.every((name) => name === 'INTRANET_NET_RULES_BUDGET' || bands.includes(name)),
    'a declared rule budget is missing from both quotas');
  assert.strictEqual(numberConstant(bg, 'INTRANET_NET_RULES_BUDGET'), numberConstant(bg, 'INTRANET_NETWORK_RULES_BUDGET'),
    'intranet builder cap differs from its allocation');
  for (const [builder, budget, extra] of [
    ['LEARNED_MAX', 'LEARNED_RULES_BUDGET', 0],
    ['GRABBER_FEED_MAX', 'GRABBER_FEED_RULES_BUDGET', 2],
    ['MINER_FEED_MAX', 'MINER_FEED_RULES_BUDGET', 0],
    ['FINGERPRINT_SCRIPT_RULE_MAX', 'FINGERPRINT_SCRIPT_RULES_BUDGET', 0],
    ['GOOGLE_SEARCH_ALLOW_RULE_MAX', 'GOOGLE_SEARCH_ALLOW_RULES_BUDGET', 0],
    ['SAFE_SEARCH_RULE_MAX', 'SAFE_SEARCH_RULES_BUDGET', 0],
  ]) {
    assert(numberConstant(bg, builder) + extra <= numberConstant(bg, budget), builder + ' exceeds its allocation');
  }

  // Every range belongs to an allocation. Missing a band defeats the quota check.
  const ranges = [...bg.matchAll(/const ([A-Z][A-Z0-9_]*)_RULE_BASE = \d+/g)].map((m) => m[1]);
  const COVERED_ELSEWHERE = { IP_LOOKUP_BLOCK: 'SMALL_SESSION_RULES_BUDGET', DYNAMIC: 'MAX_DYNAMIC' };
  const unbudgeted = ranges.filter((prefix) => {
    if (COVERED_ELSEWHERE[prefix]) return !bands.includes(COVERED_ELSEWHERE[prefix]);
    return !bands.some((band) => band.startsWith(prefix));
  });
  assert(unbudgeted.length === 0,
    'rule ranges missing a quota allocation: ' + unbudgeted.map((p) => p + '_RULE_BASE').join(', '));

  // A new feature must fail the gate before it can spend the last spare rules.
  for (const name of ['MAX_DYNAMIC', 'ALLOWLIST_RULES_BUDGET', 'FIREWALL_RULES_BUDGET']) {
    const oversized = bg.replace(new RegExp('const ' + name + ' = \\d+;'), 'const ' + name + ' = 30000;');
    assert.throws(() => assertQuotas(oversized), /quota|headroom/, name + ' growth escaped the gate');
  }
  const nearlyFull = bg.replace(/const MAX_DYNAMIC = \d+;/, 'const MAX_DYNAMIC = '
    + (numberConstant(bg, 'MAX_DYNAMIC') + MAX_DYNAMIC_RULES - budgets.TOTAL_DYNAMIC_BUDGET.total - 25) + ';');
  assert.throws(() => assertQuotas(nearlyFull), /headroom/, 'a legal quota with only 25 spare rules must fail');
  const unsafeNearlyFull = bg.replace(/const TOTAL_UNSAFE_DYNAMIC_BUDGET = [^;]+;/,
    'const TOTAL_UNSAFE_DYNAMIC_BUDGET = 4975;');
  assert.throws(() => assertQuotas(unsafeNearlyFull), /headroom/, 'unsafe actions must retain their own headroom');

  // The floor that makes the 30,000 ceiling true in the first place.
  const total = budgets.TOTAL_DYNAMIC_BUDGET.total;
  const declared = MANIFEST.minimum_chrome_version;
  assert(declared, 'manifest.json declares no minimum_chrome_version, but the dynamic rule '
    + 'budget (' + total + ') relies on the 30,000 ceiling added in Chrome '
    + DYNAMIC_LIMIT_SINCE_CHROME + '. Below that the limit is 5,000 and the blocklist '
    + 'silently never applies.');
  const major = Number(String(declared).split('.')[0]);
  assert(Number.isFinite(major) && major >= DYNAMIC_LIMIT_SINCE_CHROME,
    'minimum_chrome_version is ' + declared + ' but the dynamic rule budget (' + total
    + ') needs the 30,000 ceiling from Chrome ' + DYNAMIC_LIMIT_SINCE_CHROME + '.');
  console.log('  minimum_chrome_version: ' + declared + ' (>= ' + DYNAMIC_LIMIT_SINCE_CHROME + ')');

  console.log('[ok] DNR dynamic, session and unsafe budgets retain spare capacity');
}


// ---------------------------------------------------------------------------
// Rule-ID bands must not overlap (L8-L9).
//
// The budget check above proves the rule COUNT fits Chrome ceiling. It says nothing about where
// those rules are numbered. Each family is laid out from a base with a cap, and the ids are
// derived as base + index -- so a family whose cap grows past the distance to the next base
// starts writing ids that belong to another family. updateDynamicRules would accept them and one
// family would silently overwrite the other: no error, no failed check, just protections quietly
// replacing each other. Nothing asserted the gaps, so the arithmetic was only ever correct by
// inspection.
function runBands() {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const num = (name) => numberConstant(bg, name);

  // [base constant, cap constant, label]
  const FAMILIES = [
    ["LEARNED_RULE_BASE", "LEARNED_RULES_BUDGET", "learned malicious domains"],
    ["TRACKER_RULE_BASE", "TRACKER_RULES_BUDGET", "tracker learner"],
    ["CNAME_RULE_BASE", "CNAME_RULES_BUDGET", "CNAME blocking"],
    ["TRACKER_COOKIE_ALIAS_RULE_BASE", "TRACKER_COOKIE_ALIAS_RULES_BUDGET", "CNAME cookie isolation"],
  ];
  // Single ids reserved outside the families. A band must never grow far enough to reach them.
  const RESERVED = ["PRIVACY_HEADER_RULE_ID", "PRIVACY_HEADER_NAV_RULE_ID", "THIRD_PARTY_COOKIE_RULE_ID",
    "LOCATION_PRIVACY_HEADER_RULE_ID", "TRACKER_COOKIE_RULE_ID", "HTTPS_UPGRADE_RULE_ID", "HTTPS_UPGRADE_DYNAMIC_RULE_ID"];

  const ranges = FAMILIES.map(([baseName, capName, label]) => {
    const base = num(baseName);
    const cap = num(capName);
    assert(Number.isFinite(base) && Number.isFinite(cap),
      "could not read " + baseName + "/" + capName + " from background.js");
    return { label, base, end: base + cap - 1 };
  }).sort((x, y) => x.base - y.base);

  for (const r of ranges) console.log("  " + r.label + ": " + r.base + "-" + r.end);

  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1];
    const cur = ranges[i];
    assert(prev.end < cur.base,
      "rule-id bands overlap: " + prev.label + " ends at " + prev.end
      + " but " + cur.label + " starts at " + cur.base + " -- one family would overwrite the other");
    console.log("  gap after " + prev.label + ": " + (cur.base - prev.end - 1));
  }

  assert.strictEqual(new Set(RESERVED.map(num)).size, RESERVED.length, 'reserved DNR rule IDs must be distinct');
  for (const name of RESERVED) {
    const id = num(name);
    assert(Number.isFinite(id), "could not read " + name);
    for (const r of ranges) {
      assert(id < r.base || id > r.end,
        name + " (" + id + ") falls inside the " + r.label + " band " + r.base + "-" + r.end);
    }
  }

  console.log("[ok] DNR rule-id bands do not overlap each other or the reserved ids");
}

run();
runDynamic();
runBands();

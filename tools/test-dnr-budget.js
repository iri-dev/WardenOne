'use strict';

// Static declarativeNetRequest rules fail SILENTLY. Chrome guarantees 30,000
// rules across enabled static rulesets; anything past that is dropped without an
// error, so the extension keeps running while part of the blocklist quietly stops
// blocking. The downloaded ad/tracker lists grow on their own, so the only way to
// notice is to check on every build.
//
// Duplicate rule ids are the other silent failure: Chrome rejects the ruleset that
// contains them, losing every rule in that file rather than just the duplicate.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Chrome's guaranteed budget for enabled static rulesets. More may be available
// from a global pool shared with every other installed extension, but that is not
// guaranteed to us, so it must not be relied on.
const GUARANTEED_STATIC_RULES = 30000;
const MAX_ENABLED_RULESETS = 50;
const MAX_RULESETS = 100;

function rulesetPath(entry) {
  return path.join(ROOT, String(entry.path || '').replace(/^\/+/, ''));
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

    if (entry.enabled) {
      enabledSets += 1;
      enabledRules += rules.length;
    }
    console.log('  ' + entry.id + ': ' + rules.length + ' rules' + (entry.enabled ? ' (enabled)' : ' (disabled)'));
  }

  assert(enabledSets <= MAX_ENABLED_RULESETS,
    'enabled rulesets ' + enabledSets + ' exceed Chrome\'s ceiling of ' + MAX_ENABLED_RULESETS);

  const headroom = GUARANTEED_STATIC_RULES - enabledRules;
  console.log('  enabled static rules: ' + enabledRules + ' / ' + GUARANTEED_STATIC_RULES
    + '  (headroom ' + headroom + ')');

  assert(enabledRules <= GUARANTEED_STATIC_RULES,
    'enabled static rules ' + enabledRules + ' exceed Chrome\'s guaranteed ' + GUARANTEED_STATIC_RULES
    + '. Rules past the limit are dropped silently, so part of the blocklist would stop blocking. '
    + 'Trim a ruleset or move entries to the dynamic blocklist.');

  if (headroom < 2000) {
    console.log('  [warn] under 2000 rules of headroom; a list refresh could cross the limit');
  }

  console.log('[ok] DNR static rule budget within Chrome limits');
}

// The DYNAMIC budget had no build-time check at all. background.js compares its own
// total against 30,000 and calls console.error on the way past -- in a service worker,
// which nobody has open. Exceeding it is not silent like the static case: the
// updateDynamicRules call rejects and the whole remote blocklist fails to apply. So
// it is worth catching here instead.
//
// 30,000 is also the reason minimum_chrome_version exists. Before Chrome 121 the limit
// was MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES = 5,000 combined, which this budget
// exceeds nearly six times over. Lowering the floor without lowering the budget would
// ship an extension whose main blocklist never loads, so the two are asserted together.
const MAX_DYNAMIC_RULES = 30000;
const DYNAMIC_LIMIT_SINCE_CHROME = 121;

function numberConstant(source, name) {
  const m = source.match(new RegExp('^const\\s+' + name + '\\s*=\\s*(\\d+)\\s*;', 'm'));
  assert(m, 'background.js no longer declares a numeric ' + name);
  return Number(m[1]);
}

function runDynamic() {
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

  // Read the band names out of the TOTAL_DYNAMIC_BUDGET expression itself rather than
  // listing them here, so a band added to that sum is covered automatically. A
  // hand-maintained list is exactly what goes stale and then reads as headroom that
  // is not there.
  const expr = bg.match(/^const\s+TOTAL_DYNAMIC_BUDGET\s*=\s*([\s\S]*?);/m);
  assert(expr, 'background.js no longer declares TOTAL_DYNAMIC_BUDGET');
  const bands = expr[1].match(/[A-Z][A-Z0-9_]*/g) || [];
  assert(bands.length >= 10,
    'TOTAL_DYNAMIC_BUDGET now sums only ' + bands.length + ' bands; the parser may be reading it wrong');

  let total = 0;
  for (const band of bands) {
    const value = numberConstant(bg, band);
    total += value;
    console.log('  ' + band + ': ' + value);
  }

  const headroom = MAX_DYNAMIC_RULES - total;
  console.log('  dynamic + session budget: ' + total + ' / ' + MAX_DYNAMIC_RULES
    + '  (headroom ' + headroom + ', across ' + bands.length + ' bands)');

  assert(total <= MAX_DYNAMIC_RULES,
    'dynamic rule budget ' + total + ' exceeds Chrome\'s ceiling of ' + MAX_DYNAMIC_RULES
    + '. updateDynamicRules would reject and the whole remote blocklist would fail to '
    + 'apply. Trim a band.');

  if (headroom < 1000) {
    console.log('  [warn] under 1000 rules of dynamic headroom');
  }

  // The floor that makes the 30,000 ceiling true in the first place.
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

  console.log('[ok] DNR dynamic rule budget within Chrome limits');
}

run();
runDynamic();

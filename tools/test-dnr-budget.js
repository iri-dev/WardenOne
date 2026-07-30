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

run();

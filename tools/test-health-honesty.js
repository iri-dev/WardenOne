/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Does the health summary ever claim safety it did not verify (M39)?
 *
 * buildProtectionHealthSummary is the extension's own answer to "am I protected?", and it does
 * something genuinely good: rather than trusting the config toggles it asks Chrome which rulesets
 * are really enabled. But the verification was wrapped in a guard that could not tell two very
 * different answers apart:
 *
 *     if (enabledRulesets.length) { ...three checks... }
 *
 * An empty array is produced BOTH by "the call failed" AND by "nothing is enabled". Either way
 * every check was skipped, no issue was added, and the popup rendered
 * "You're safe -- Core shields are active and watching quietly." The single worst state the
 * extension can be in -- master switch on, not one ruleset enabled, no network blocking running --
 * produced the most reassuring line the UI can show.
 *
 * The decision table is lifted out of background.js and driven here, because the whole finding is
 * about which branch runs for which input.
 *
 * Run: node tools/test-health-honesty.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Lift the ruleset branch verbatim: from the tri-state declaration to the end of its else-block.
const FROM = '  let enabledRulesets = null;';
const TO = '  const activeShields = healthCountActiveShields(cfg);';
const from = BG.indexOf(FROM);
const to = BG.indexOf(TO, from);
if (from < 0 || to <= from) throw new Error('ruleset decision block not found in background.js');
const BLOCK = BG.slice(from, to);

// Drive the real branch with a stubbed chrome and a recording addIssue.
async function decide({ answer, throws, cfg, rulesetError }) {
  const issues = [];
  const addIssue = (severity, text, topLevel) => issues.push({ severity, text, topLevel: topLevel === true });
  const chrome = {
    declarativeNetRequest: {
      getEnabledRulesets: async () => { if (throws) throw new Error('unavailable'); return answer; },
    },
  };
  const __blocklistRulesetError = rulesetError || '';
  // eslint-disable-next-line no-new-func
  const run = new Function('chrome', 'cfg', 'addIssue', '__blocklistRulesetError',
    '"use strict";return (async()=>{' + BLOCK + '\nreturn true;})();');
  await run(chrome, cfg, addIssue, __blocklistRulesetError);
  return {
    issues,
    worst: issues.some((i) => i.severity === 'danger') ? 'danger'
      : issues.some((i) => i.severity === 'warn' && i.topLevel) ? 'warning' : 'ok',
  };
}

const ON = { enabled: true, blockMalwareSites: true, adShield: true, blockTrackers: true };
const ALL = ['grabbers', 'adshield_easylist', 'trackers', 'easyprivacy'];

(async () => {
  // -------------------------------------------------------------------------
  // 1. The state the finding is about: on, but nothing enabled.
  // -------------------------------------------------------------------------
  {
    const r = await decide({ answer: [], cfg: ON });
    check('nothing enabled while switched on is a danger, not silence', r.worst === 'danger',
      'the popup would say "You\'re safe" with no network blocking running');
  }

  // -------------------------------------------------------------------------
  // 2. The other producer of an empty array: the call itself failing.
  //    This must not be reported as health either -- but it is not the same claim.
  // -------------------------------------------------------------------------
  {
    const r = await decide({ throws: true, cfg: ON });
    check('a failed check is surfaced rather than passed off as healthy', r.worst !== 'ok');
    check('and it says it could not check, rather than asserting nothing is enabled',
      r.issues.some((i) => /could not check/i.test(i.text)),
      'the two outcomes are still collapsed');
  }

  // -------------------------------------------------------------------------
  // 3. The healthy path must stay healthy, or this becomes a false alarm generator.
  // -------------------------------------------------------------------------
  {
    const r = await decide({ answer: ALL, cfg: ON });
    check('a fully enabled browser still reports ok', r.worst === 'ok',
      'the fix would cry wolf on a healthy profile: ' + JSON.stringify(r.issues));
  }

  // -------------------------------------------------------------------------
  // 4. Master switch off: every ruleset disabled is CORRECT, and is already reported by the
  //    master-switch issue. It must not produce a second, misleading "no rulesets" danger.
  // -------------------------------------------------------------------------
  {
    const r = await decide({ answer: [], cfg: { enabled: false } });
    check('switching WardenOne off does not raise a ruleset alarm',
      !r.issues.some((i) => /No blocking rulesets/i.test(i.text)),
      'turning the extension off would look like a malfunction');
  }

  // -------------------------------------------------------------------------
  // 5. A partially enabled state still names the missing ruleset.
  // -------------------------------------------------------------------------
  {
    const r = await decide({ answer: ['adshield_easylist', 'trackers'], cfg: ON });
    check('a missing core ruleset is still a danger', r.worst === 'danger');
    check('and it is named', r.issues.some((i) => /malicious-domain/i.test(i.text)));
  }

  // -------------------------------------------------------------------------
  // 6. A failed updateEnabledRulesets is remembered, not only logged to the console.
  // -------------------------------------------------------------------------
  {
    const r = await decide({ answer: ALL, cfg: ON, rulesetError: 'quota exceeded' });
    check('a ruleset apply failure reaches the user', r.worst === 'danger',
      'the failure would live only in console.warn');
  }

  if (failed) { console.error('\n' + failed + ' health-honesty check(s) failed'); process.exit(1); }
  console.log('\nthe health summary reports what it verified, and says so when it could not');
})().catch((e) => { console.error('health-honesty suite threw: ' + e.message); process.exit(1); });

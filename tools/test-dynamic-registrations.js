/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const fs = require('fs');
const resourceTypes = require('./lib/resource-types.js');

const background = fs.readFileSync('background.js', 'utf8');

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok  - ' + name);
    return;
  }
  fail++;
  console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function bodyOf(fnName) {
  const start = background.indexOf('async function ' + fnName);
  if (start < 0) return '';
  const next = background.indexOf('\nasync function ', start + 1);
  return background.slice(start, next < 0 ? background.length : next);
}

const searchBody = bodyOf('reconcileSearchCleanupCssScript');
check('search cleanup dynamic script updates existing registrations',
  /updateContentScripts\(\[scriptDef\]\)/.test(searchBody),
  'missing updateContentScripts');
check('search cleanup dynamic script falls back to unregister/register',
  /unregisterContentScripts\(\{ ids: \[id\] \}\)/.test(searchBody)
    && /registerContentScripts\(\[scriptDef\]\)/.test(searchBody),
  'missing fallback');

const consentBody = bodyOf('reconcileConsentRejectInjection');
check('consent dynamic script update fallback unregisters stale script',
  /updateContentScripts\(\[scriptDef\]\)/.test(consentBody)
    && /unregisterContentScripts\(\{ ids: \[CONSENT_REJECT_SCRIPT_ID\] \}\)/.test(consentBody)
    && /registerContentScripts\(\[scriptDef\]\)/.test(consentBody),
  'missing consent fallback');

const initiatorMatch = background.match(/const GOOGLE_SEARCH_INITIATOR_DOMAINS = \[([\s\S]*?)\];/);
const initiators = initiatorMatch ? initiatorMatch[1] : '';
[
  'search.brave.com',
  'google.co.za',
  'google.co.in',
  'google.co.jp',
  'google.com.br',
  'google.com.mx',
].forEach((domain) => {
  check('sponsored search allow initiators include ' + domain, initiators.includes("'" + domain + "'"));
});

const budgetMatch = background.match(/const TOTAL_DYNAMIC_BUDGET = ([\s\S]*?);/);
const budgetExpr = budgetMatch ? budgetMatch[1] : '';
[
  'ALLOWLIST_RULES_BUDGET',
  'MEDIA_COMPAT_RULES_BUDGET',
  'LOGIN_COMPAT_RULES_BUDGET',
  'GRABBER_FEED_RULES_BUDGET',
  'NEVER_BLOCK_ALLOW_RULES_BUDGET',
  'SCRIPT_SHIELD_RULES_BUDGET',
  'FINGERPRINT_SCRIPT_RULES_BUDGET',
  'GOOGLE_SEARCH_ALLOW_RULES_BUDGET',
  'SMALL_SESSION_RULES_BUDGET',
].forEach((name) => {
  check('dynamic rule budget counts ' + name, budgetExpr.includes(name));
});
// The ceiling check used to be a runtime `if (TOTAL_DYNAMIC_BUDGET > 30000)
// console.error(...)` in background.js, which could only ever print into a
// service-worker console nobody has open. It now lives in tools/test-dnr-budget.js,
// where a breach fails the build, and where the band names are read out of the
// TOTAL_DYNAMIC_BUDGET expression itself so a new band is covered without anyone
// remembering to add it. The guarantee asserted here is unchanged: the REAL summed
// total is checked against the ceiling, not a hand-copied number.
const dnrBudgetTest = fs.readFileSync('tools/test-dnr-budget.js', 'utf8');
check('dynamic rule budget total is asserted at build time',
  /MAX_DYNAMIC_RULES = 30000/.test(dnrBudgetTest)
  && /total <= MAX_DYNAMIC_RULES/.test(dnrBudgetTest));
check('dynamic rule budget bands are read from the expression, not hand-listed',
  /const expr = bg\.match\(/.test(dnrBudgetTest)
  && /TOTAL_DYNAMIC_BUDGET/.test(dnrBudgetTest));
check('dynamic rule budget is tied to minimum_chrome_version',
  /minimum_chrome_version/.test(dnrBudgetTest)
  && /DYNAMIC_LIMIT_SINCE_CHROME = 121/.test(dnrBudgetTest));

const repairStart = background.indexOf("if (msg && msg.kind === 'verify-repair')");
const repairBody = repairStart >= 0 ? background.slice(repairStart, background.indexOf('sendResponse(report);', repairStart)) : '';
check('verify-repair enumerates frames before injecting',
  /getRepairFramesForTab\(t\)/.test(repairBody)
    && /repairMainWorldFilesForUrl\(frameUrl,\s*frameId\)/.test(repairBody),
  'repair path must be frame-aware');
check('verify-repair no longer blindly injects into all frames',
  !/allFrames:\s*true/.test(repairBody),
  'repair path should use filtered frameIds');
check('verify-repair keeps consent reject out of excluded frames',
  /consentRejectExcludedUrl\(frameUrl\)/.test(repairBody),
  'missing consent frame exclusion');

check('remote option rules respect never-block domains',
  /function networkRulePatternHost/.test(background)
    && /const patternHost = networkRulePatternHost\(pattern\)/.test(background)
    && /isNeverBlockDomain\(patternHost\)/.test(background),
  'option-rule parser must drop Twitch and other never-block false positives');

check('URL reputation bypasses Twitch official legal host',
  /function isTrustedPolicyReputationUrl/.test(background)
    && /legal\.twitch\.tv/.test(background)
    && /isTrustedPolicyReputationUrl\(normalized\)/.test(background),
  'legal.twitch.tv should not be treated as a phishing reputation hit');

const mediaBody = bodyOf('applyMediaCompatibilityRules');
check('media compatibility never installs an edge.ads Twitch block',
  !/edge\.ads\.twitch\.tv/.test(mediaBody),
  'edge ads must stay network-allowed so Twitch can advance its ad lifecycle');
/* The allow rule's types come from the shared DNR inventory now, so the literal
   'media' no longer appears anywhere in this function. Resolve the list and look
   at what it contains: the invariant was always that Twitch media is allowed
   through, never that a particular word was present in the source. */
const mediaAllowTypes = /allTypes = ALL_DNR_RESOURCE_TYPES/.test(mediaBody)
  ? resourceTypes.resolve('ALL_DNR_RESOURCE_TYPES').filter((type) => type !== 'main_frame')
  : (mediaBody.match(/'[a-z_]+'/g) || []).map((token) => token.slice(1, -1));
check('Twitch media compatibility allow remains installed',
  /\{ domain:\s*'twitch\.tv', initiators:\s*\['twitch\.tv'\] \}/.test(mediaBody)
    && /priority:\s*90000/.test(mediaBody)
    && /action:\s*\{ type:\s*'allow' \}/.test(mediaBody)
    && mediaAllowTypes.includes('media'),
  'targeted page guarding must retain the broad Twitch media allow');
check('media compatibility refresh no longer depends on the Twitch ad-block toggle',
  /applyMediaCompatibilityRules\(cfg\.enabled !== false\)/.test(background)
    && /applyMediaCompatibilityRules\(on\)/.test(background)
    && !/applyMediaCompatibilityRules\([^\n]*twitchAdBlock/.test(background),
  'media allows and the Twitch page guard must be independently toggleable');

// The client-side pre-roll is answered on the page in twitch-adblock.js, not
// refused here -- a blocked ad request never settles, and the player will not
// leave its ad state until it does. See tools/test-twitch-adblock.js.
check('no DNR rule refuses the Twitch ad service',
  !/applyTwitchAdRules/.test(background)
    && !/edge\.ads\.twitch\.tv/.test(background),
  'blocking the ad service at the network layer strands the break with a frozen picture');

// ---------------------------------------------------------------------------
// Every flag that decides a dynamic registration must be in the early-out key (M23).
//
// refreshExtensionState() builds a key from the settings it cares about and returns immediately
// when it has not changed. Two reconcilers read a flag that was never in that key, so once any
// other change had primed it, toggling only cryptominerCpuWatch or flagSearchJunk produced an
// identical key, the function returned before reaching the reconciler, and the script was neither
// registered nor unregistered -- the switch in the popup simply did nothing.
//
// Adding the two flags fixes today. This check fixes tomorrow: it reads the reconcilers and fails
// when any of them decides on a flag the key does not carry, so the next feature added cannot
// quietly repeat it. A hand-maintained key is what drifted; another hand-maintained list of the
// things in it would drift the same way.
{
  // Scoped to refreshExtensionState. refreshBlocklistRuleset has an early-out key of its own,
  // earlier in the file, and reading that one instead would make this check pass on the wrong text.
  const fnStart = background.indexOf('function refreshExtensionState()');
  const keyStart = background.indexOf('const stateKey = [', fnStart);
  const keyEnd = background.indexOf("].join('|')", keyStart);
  check('the extension-state key is still findable',
    fnStart >= 0 && keyStart > fnStart && keyEnd > keyStart);
  const keySource = background.slice(keyStart, keyEnd);

  const reconcilers = (background.match(/async function (reconcile\w*Injection)\(/g) || [])
    .map((m) => m.replace(/async function /, '').replace(/\($/, ''));
  check('the reconcilers are still findable', reconcilers.length >= 4,
    reconcilers.length + ' found');

  // `enabled` is represented by the leading `on` term rather than by name.
  const REPRESENTED_ELSEWHERE = new Set(['enabled']);
  const gaps = [];
  for (const name of reconcilers) {
    const body = bodyOf(name);
    const flags = new Set((body.match(/\bmerged\.([A-Za-z_$][\w$]*)/g) || [])
      .map((m) => m.split('.')[1]));
    for (const flag of flags) {
      if (REPRESENTED_ELSEWHERE.has(flag)) continue;
      if (!keySource.includes('cfg.' + flag)) gaps.push(name + ' -> ' + flag);
    }
  }
  check('every flag a dynamic reconciler decides on is in the early-out key',
    gaps.length === 0,
    gaps.join(', ') + ' -- toggling one of these alone leaves the key unchanged, so the reconciler is never reached');

  // Named explicitly as well, so the two that were actually broken cannot quietly come back out.
  check('cryptominerCpuWatch is in the key', /cfg\.cryptominerCpuWatch/.test(keySource));
  check('flagSearchJunk is in the key', /cfg\.flagSearchJunk/.test(keySource));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

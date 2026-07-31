'use strict';

const fs = require('fs');

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
check('dynamic rule budget guard checks the real total',
  /if \(TOTAL_DYNAMIC_BUDGET > 30000\)/.test(background));

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
check('Twitch media compatibility allow remains installed',
  /\{ domain:\s*'twitch\.tv', initiators:\s*\['twitch\.tv'\] \}/.test(mediaBody)
    && /priority:\s*90000/.test(mediaBody)
    && /action:\s*\{ type:\s*'allow' \}/.test(mediaBody)
    && /'media'/.test(mediaBody),
  'targeted page guarding must retain the broad Twitch media allow');
check('media compatibility refresh no longer depends on the Twitch ad-block toggle',
  /applyMediaCompatibilityRules\(cfg\.enabled !== false\)/.test(background)
    && /applyMediaCompatibilityRules\(on\)/.test(background)
    && !/applyMediaCompatibilityRules\([^\n]*twitchAdBlock/.test(background),
  'media allows and the Twitch page guard must be independently toggleable');

// Pre-rolls are the client-side ad path, so no amount of playlist work reaches
// them and the block has to live here. A pre-roll sets an ad format, which makes
// AdRequestBuilder repoint from the vaes bid host to edge.ads.twitch.tv/ads/format
// -- so both are refused, but the Twitch host only ever by path.
const twitchAdBody = bodyOf('applyTwitchAdRules');
const twitchAdHosts = (background.match(/const TWITCH_CLIENT_AD_HOSTS = \[[^\]]*\]/) || [''])[0];
const twitchAdPath = (background.match(/const TWITCH_AD_PATH_FILTER = '[^']*'/) || [''])[0];
check('client-side Twitch ad rule refuses the pre-roll creative endpoints',
  /'vaes\.amazon-adsystem\.com'/.test(twitchAdHosts)
    && /\|\|edge\.ads\.twitch\.tv\/ads/.test(twitchAdPath)
    && /requestDomains: TWITCH_CLIENT_AD_HOSTS/.test(twitchAdBody)
    && /urlFilter: TWITCH_AD_PATH_FILTER/.test(twitchAdBody),
  'the client-side VAST creative endpoints must be blocked at the network layer');
check('client-side Twitch ad rule blocks edge ads by path, never by host',
  !/edge\.ads\.twitch\.tv/.test(twitchAdHosts)
    && !/requestDomains: \[[^\]]*edge\.ads\.twitch\.tv/.test(twitchAdBody),
  'a whole-host block strands the player mid-break; only the /ads paths may be refused');
check('client-side Twitch ad rule outranks the media compatibility band',
  /priority: 96000/.test(twitchAdBody),
  'a broadened compatibility allow would otherwise silently retire this rule');
check('client-side Twitch ad rule stays scoped to Twitch initiators',
  /initiatorDomains: \['twitch\.tv'\]/.test(twitchAdBody),
  'a Twitch feature must not change how unrelated sites load ads');
check('client-side Twitch ad rule follows the Twitch ad-block toggle',
  /applyTwitchAdRules\(on && cfg\.twitchAdBlock !== false\)/.test(background)
    && /cfg\.twitchAdBlock !== false \? 1 : 0/.test(background),
  'the toggle must gate the rule and take part in the state key that re-applies it');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

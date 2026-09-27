/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
// Verifies the onboarding protection bundles in background.js:
//  - "Maximum privacy" is a true superset of "Recommended" (can't weaken it)
//  - it enables the hardened privacy set the onboarding promises
//  - it never enables the footgun toggles (block-all-cookies, honeytokens)
//  - the message handlers exist and use the shared constants (no drift)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
let passed = 0; const failures = [];
function ok(name, cond) { cond ? (passed++, console.log('[ok] ' + name)) : (failures.push(name), console.error('[FAIL] ' + name)); }

// --- pull the two bundle declarations out and evaluate them in isolation ---
const block = src.match(/const ONBOARDING_RECOMMENDED = \{[\s\S]*?ONBOARDING_MAX_PRIVACY = Object\.assign\([\s\S]*?\n\}\);/);
if (!block) { console.error('[FAIL] could not locate ONBOARDING_* bundles in background.js'); process.exit(1); }
const sandbox = { Object: Object };
vm.runInNewContext(block[0] + '\nthis.R = ONBOARDING_RECOMMENDED; this.M = ONBOARDING_MAX_PRIVACY;', sandbox);
const R = sandbox.R, M = sandbox.M;

ok('recommended bundle is a non-empty object', R && typeof R === 'object' && Object.keys(R).length > 10);
ok('max-privacy bundle is a non-empty object', M && typeof M === 'object' && Object.keys(M).length > Object.keys(R).length);
ok('recommended keeps the safe baseline (enabled, adShield, blockTrackers)', R.enabled === true && R.adShield === true && R.blockTrackers === true);

// superset: every recommended key/value must survive in max
const weakened = Object.keys(R).filter((k) => M[k] !== R[k]);
ok('max privacy is a true superset of recommended (nothing weakened)', weakened.length === 0);

// hardened set that max must turn on
/* antiFingerprintNoise alone: the legacy antiFingerprint alias is no longer set (PI-06, below). */
const HARDENED = ['antiFingerprintNoise', 'blockFirstPartyTrackers', 'breachCheck', 'clipboardGuard', 'blockSuspiciousWebRTC', 'capReferrer', 'deAmp'];
HARDENED.forEach((k) => ok('max enables hardened: ' + k, M[k] === true));

// recommended must NOT include the hardened set (stays the safe default)
HARDENED.forEach((k) => ok('recommended leaves hardened untouched: ' + k, !(k in R)));

// footguns that must never be in either bundle
['blockAllCookies', 'honeytokenMode', 'forceHttps'].forEach((k) => {
  ok('max does NOT force footgun: ' + k, M[k] !== true);
  ok('recommended does NOT force footgun: ' + k, R[k] !== true);
});

// --- handler wiring ---
ok('recommended handler present', src.includes("msg.kind === 'apply-onboarding-recommended'"));
ok('max-privacy handler present', src.includes("msg.kind === 'apply-onboarding-max-privacy'"));
ok('recommended handler uses shared constant (no inline drift)', src.includes('DEFAULT_CONFIG, current, ONBOARDING_RECOMMENDED'));
ok('max handler uses shared constant', src.includes('DEFAULT_CONFIG, current, ONBOARDING_MAX_PRIVACY'));

// --- PI-06: onboarding is a page in the product, not a one-off --------------------------
// It opened once on install and nothing linked to it again, so the Maximum privacy bundle could
// not be chosen later. The popup footer now links it, and every setting a bundle can switch on
// also has its own control.
{
  const popupHtml = require('fs').readFileSync(require('path').join(__dirname, '..', 'popup.html'), 'utf8');
  ok('the popup links the set-up guide durably', /<a id="wo-setup-link" href="onboarding\.html"/.test(popupHtml));
  /* A setting a bundle switches on that the popup cannot switch off is a one-way door. The one
     exception is a watch-only log that is on for everyone already. */
  const DEFAULT_ON_WATCH_ONLY = new Set(['logThirdPartyBeacons']);
  Object.keys(M).filter((k) => M[k] === true && !DEFAULT_ON_WATCH_ONLY.has(k) && k !== 'enabled').forEach((k) => {
    ok('a Maximum privacy setting has its own control too: ' + k, popupHtml.includes('data-key="' + k + '"'));
  });
  ok('Maximum privacy no longer sets the legacy fingerprint alias the popup cannot turn off', M.antiFingerprint !== true);
  const popupJs = require('fs').readFileSync(require('path').join(__dirname, '..', 'popup.js'), 'utf8');
  ok('an alias left on by an earlier bundle shows as on and is folded into the switch on save',
    /if \(config\.antiFingerprint === true\) \{\s*\n\s*document\.querySelectorAll\('input\[data-key="antiFingerprintNoise"\]'\)\.forEach\(\(el\) => \{ el\.checked = true; \}\);/.test(popupJs)
      && /if \(document\.querySelector\('input\[data-key="antiFingerprintNoise"\]'\)\) config\.antiFingerprint = false;/.test(popupJs));
}

console.log('\n' + passed + ' passed, ' + failures.length + ' failed.');
if (failures.length) process.exit(1);

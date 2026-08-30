/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * How many protections WardenOne actually has, asserted in every place that claims a number.
 *
 * The README said "80+" for long enough that it drifted to 99 without anyone noticing, the
 * GitHub About repeated it, and the popup's "You're safe" panel showed a denominator of 87
 * from a third list that had gone its own way. Three numbers, three sources, none agreeing.
 * A count nobody checks is a count that rots, so this makes HEALTH_SHIELD_KEYS the single
 * source of truth and fails the build when a claim stops matching it.
 *
 * The denominator has to mean something specific to be worth printing: protections you can
 * actually switch off. So two kinds of key are deliberately excluded, and both exclusions
 * are asserted here rather than left to memory --
 *   - the watch-only guards, which have no toggle because they never block; and
 *   - antiFingerprint, a legacy alias that antiFingerprintNoise already ORs in, so it could
 *     never be turned on or off on its own and counting it inflated the total by one.
 *
 * Run: node tools/test-protection-count.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
}

const listMatch = BG.match(/const HEALTH_SHIELD_KEYS = \[([\s\S]*?)\];/);
if (!listMatch) {
  console.error('HEALTH_SHIELD_KEYS not found in background.js');
  process.exit(1);
}
const SHIELDS = [...listMatch[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);

/* Guards that observe and never block. They have no toggle by design, so they are not part
   of the switchable count -- but they ARE protections, so they are part of the total. */
/* backTrapGuard was here until it stopped being watch-only. It now REFUSES a page's
   pushState and forward calls to keep Back working, which can affect a site, so by the same
   rule that took the toggles off these three it earns one back. Watch-only means blocks
   nothing and changes nothing on the page; that is the whole test. */
const WATCH_ONLY = ['logThirdPartyBeacons', 'deviceAccessGuard', 'capabilityGuard'];

const SWITCHABLE = SHIELDS.length;
const TOTAL = SWITCHABLE + WATCH_ONLY.length;

console.log('\nprotection count\n');
console.log('  switchable shields: ' + SWITCHABLE);
console.log('  watch-only        : ' + WATCH_ONLY.length);
console.log('  total             : ' + TOTAL + '\n');

/* ---- the list itself is honest --------------------------------------------------- */

check('no duplicates in the shield list', new Set(SHIELDS).size === SHIELDS.length);
{
  const noToggle = SHIELDS.filter((k) => !POPUP_HTML.includes('data-key="' + k + '"'));
  check('every counted shield can actually be switched off from the popup',
    noToggle.length === 0, noToggle.join(', '));
}
{
  const counted = WATCH_ONLY.filter((k) => SHIELDS.includes(k));
  check('no watch-only guard is counted as a switchable shield', counted.length === 0, counted.join(', '));
}
{
  const hasToggle = WATCH_ONLY.filter((k) => POPUP_HTML.includes('data-key="' + k + '"'));
  check('and none of them has a toggle', hasToggle.length === 0, hasToggle.join(', '));
}
/* The alias that started this. If someone gives it its own behaviour later, it stops being an
   alias and this check is the reminder to count it again. */
check('antiFingerprint is still only an alias of antiFingerprintNoise',
  /antiFingerprintNoise:gate\(cfg\.antiFingerprintNoise\|\|cfg\.antiFingerprint\)/.test(CONTENT));
check('so it is not counted as a shield of its own', !SHIELDS.includes('antiFingerprint'));
check('and not offered as a separate per-site override', !/'antiFingerprint'/.test(POPUP_JS));

/* ---- every place that prints a number agrees with it ------------------------------ */

check('the README headline says ' + TOTAL,
  README.includes('One master switch. ' + TOTAL + ' protections.'),
  (README.match(/One master switch\. [^.]*\./) || ['(not found)'])[0]);
check('the README badge says ' + TOTAL,
  README.includes('badge/protections-' + TOTAL + '-'),
  (README.match(/badge\/protections-[^-]*-/) || ['(not found)'])[0]);
check('the README explains the split as ' + SWITCHABLE + ' of ' + TOTAL,
  README.includes(SWITCHABLE + ' of the ' + TOTAL + ' protections have their own toggle'));
check('the README no longer claims every feature is toggleable',
  !/Every feature is individually toggleable/.test(README));

/* The popup prints the same denominator from the same list, so there is nothing to assert
   about its number -- only that it still reads it from here rather than a copy. */
check('the popup denominator still comes from this list',
  /totalShields: HEALTH_SHIELD_KEYS\.length/.test(BG));

/* ---- the note that used to sit under "You're safe" -------------------------------- */

/* A feed that did not answer costs nothing: merges never wipe, so the copy already downloaded
   stays active. Saying so on every transient miss put a permanent-looking warning under a panel
   headed "You're safe". It is now only raised when it actually cost something. */
check('a partial feed failure is not reported while the lists are fresh',
  /staleNow/.test(BG) && /failedFeeds >= totalFeeds/.test(BG));
check('and when it is reported, it says protection is intact',
  /still active, so nothing is unprotected/.test(BG));
check('the old unconditional wording is gone',
  !/unreachable during the last update/.test(BG));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all protection-count checks passed');

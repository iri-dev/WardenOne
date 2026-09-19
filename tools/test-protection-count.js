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
const vm = require('vm');

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

/* The registry beside the shield list (FEAT-08): the watch-only guards, the second levels of a
   counted protection, and every popup switch that is not a protection, by kind. Read from the
   worker so the code, the gate and the copy cannot hold three different answers. On a source
   without it the lists are empty and every switch outside the shield list is reported below. */
function registryValue(name) {
  const i = BG.indexOf('const ' + name + ' = ');
  if (i < 0) return null;
  let depth = 0;
  let seen = false;
  for (let j = BG.indexOf('=', i) + 1; j < BG.length; j++) {
    const c = BG[j];
    if (c === '[' || c === '{') { depth++; seen = true; } else if (c === ']' || c === '}') {
      depth--;
      if (seen && depth === 0) return vm.runInNewContext('(' + BG.slice(BG.indexOf('=', i) + 1, j + 1) + ')');
    }
  }
  return null;
}
/* Guards that observe and never block. They have no toggle by design, so they are not part
   of the switchable count -- but they ARE protections, so they are part of the total.
   backTrapGuard was here until it stopped being watch-only. It now REFUSES a page's
   pushState and forward calls to keep Back working, which can affect a site, so by the same
   rule that took the toggles off these three it earns one back. Watch-only means blocks
   nothing and changes nothing on the page; that is the whole test. */
const WATCH_ONLY = registryValue('WATCH_ONLY_GUARDS') || [];
const SECOND_LEVEL = registryValue('SECOND_LEVEL_OF') || {};
const KINDS = registryValue('CONTROL_KINDS') || {};

const SWITCHABLE = SHIELDS.length;
const TOTAL = SWITCHABLE + WATCH_ONLY.length;

console.log('\nprotection count\n');
console.log('  switchable shields: ' + SWITCHABLE);
console.log('  watch-only        : ' + WATCH_ONLY.length);
console.log('  total             : ' + TOTAL + '\n');

/* ---- the list itself is honest --------------------------------------------------- */

check('the registry beside the list exists', WATCH_ONLY.length > 0 && Object.keys(KINDS).length > 0,
  'WATCH_ONLY_GUARDS / SECOND_LEVEL_OF / CONTROL_KINDS are missing from background.js');
check('no duplicates in the shield list', new Set(SHIELDS).size === SHIELDS.length);
{
  /* Every counted key is a real setting. */
  const defaults = registryValue('DEFAULT_CONFIG') || {};
  const unknown = SHIELDS.filter((k) => !Object.prototype.hasOwnProperty.call(defaults, k));
  check('every counted shield is a key of DEFAULT_CONFIG', unknown.length === 0, unknown.join(', '));
}
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

/* ---- two-way coverage: every switch is classified, every classification is a switch ----
   The old test proved that each counted shield has a toggle and stopped there, so a real
   protection could be added to the popup without touching the denominator, and the copy
   could name a number nothing checked. Now every checkbox in the popup has to be exactly one
   thing: a counted shield, a second level of one, or a control of a named non-protection
   kind -- and every entry in the registry has to be a switch that exists. */
const SWITCHES = [...POPUP_HTML.matchAll(/<input\b[^>]*>/g)].map((m) => m[0])
  .filter((tag) => /type="checkbox"/.test(tag) && /data-key="/.test(tag))
  .map((tag) => tag.match(/data-key="([A-Za-z0-9_]+)"/)[1]);
const SWITCH_SET = new Set(SWITCHES);
const CLASSIFIED = new Map();   // key -> kind
for (const kind of Object.keys(KINDS)) for (const k of KINDS[kind]) CLASSIFIED.set(k, kind);
for (const k of Object.keys(SECOND_LEVEL)) CLASSIFIED.set(k, 'second level of ' + SECOND_LEVEL[k]);
{
  const unclassified = [...SWITCH_SET].filter((k) => !SHIELDS.includes(k) && !CLASSIFIED.has(k));
  check('every popup switch is a counted shield or classified as something else', unclassified.length === 0,
    unclassified.length + ' unclassified: ' + unclassified.join(', '));
  const both = [...CLASSIFIED.keys()].filter((k) => SHIELDS.includes(k));
  check('nothing is both counted and classified as a non-protection', both.length === 0, both.join(', '));
  const dead = [...CLASSIFIED.keys()].filter((k) => !SWITCH_SET.has(k));
  check('every classified control is a switch that exists in the popup', dead.length === 0, dead.join(', '));
  const dupes = Object.values(KINDS).flat().concat(Object.keys(SECOND_LEVEL)).filter((k, i, a) => a.indexOf(k) !== i);
  check('no control is classified twice', dupes.length === 0, dupes.join(', '));
  const orphanLevels = Object.keys(SECOND_LEVEL).filter((k) => !SHIELDS.includes(SECOND_LEVEL[k]));
  check('every second level sits under a counted shield', orphanLevels.length === 0, orphanLevels.join(', '));
  const watchSwitch = WATCH_ONLY.filter((k) => SWITCH_SET.has(k));
  check('a watch-only guard has no switch, or it is not watch-only', watchSwitch.length === 0, watchSwitch.join(', '));
  console.log('  classified          : ' + CLASSIFIED.size + ' (' + Object.keys(KINDS).map((k) => k + ' ' + KINDS[k].length).join(', ')
    + ', second level ' + Object.keys(SECOND_LEVEL).length + ')');
}

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

/* The public site is the other place a number is printed, and it said "80+" for a year after
   the README had moved on (FEAT-08, CWS-04). It carries the same total, from the same list,
   and none of the absolutes the README already gave up. */
const SITE = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
check('the public site says ' + TOTAL + ' protections', SITE.includes(TOTAL + ' protections</li>'),
  (SITE.match(/\d+\+? protections<\/li>/) || ['(not found)'])[0]);
check('the public site no longer says everything runs locally',
  !/Everything runs locally/.test(SITE), 'opt-in checks contact named services; the privacy policy lists them');
check('the public site no longer says every feature can be turned off individually',
  !/Every feature can be turned off individually/.test(SITE), 'three watch-only recorders have no switch');
check('the public site does not promise WebRTC leak protection from the visible switch',
  !/WebRTC IP-leak protection/.test(SITE) && /hardened WebRTC candidates are a separate opt-in/.test(SITE),
  'the visible switch blocks IP-lookup services; candidate hardening is the opt-in (FEAT-03)');

/* The popup prints the same denominator from the same list, so there is nothing to assert
   about its number -- only that it still reads it from here rather than a copy. */
check('the popup denominator still comes from this list',
  /totalShields: HEALTH_SHIELD_KEYS\.length/.test(BG));

/* ---- every number anyone printed, not only the sentences someone remembered to test -----
   The README carried "103 individually controllable" two lines under a headline the test
   checked, for as long as the split sentence a thousand lines further down said 104. So every
   surface a reader sees is scanned for every count-shaped claim, and each has to equal the
   figure it names. The CHANGELOG is history and is left out on purpose. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const numberOf = (text) => (/^\d+$/.test(text) ? Number(text) : WORDS.indexOf(String(text).toLowerCase()));
const SURFACES = ['README.md', 'site/index.html', 'popup.html', 'popup.js', 'onboarding.html', 'onboarding.js', 'PRIVACY.md', 'history.html', 'privacy-test.html'];
{
  const wrong = [];
  for (const file of SURFACES) {
    let text = '';
    try { text = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (_) { continue; }
    for (const m of text.matchAll(/\b(\d{2,3})(\+?) protections\b/g)) {
      if (m[2] || Number(m[1]) !== TOTAL) wrong.push(file + ': "' + m[0] + '"');
    }
    for (const m of text.matchAll(/\b(\d{2,3}) individually controllable\b/g)) {
      if (Number(m[1]) !== SWITCHABLE) wrong.push(file + ': "' + m[0] + '"');
    }
    for (const m of text.matchAll(/\b(\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine) watch-only\b/gi)) {
      if (numberOf(m[1]) !== WATCH_ONLY.length) wrong.push(file + ': "' + m[0] + '"');
    }
    for (const m of text.matchAll(/\b(\d{2,3}) of the (\d{2,3}) protections\b/g)) {
      if (Number(m[1]) !== SWITCHABLE || Number(m[2]) !== TOTAL) wrong.push(file + ': "' + m[0] + '"');
    }
    for (const m of text.matchAll(/\bThe other (\w+) are watch-only\b/g)) {
      if (numberOf(m[1]) !== WATCH_ONLY.length) wrong.push(file + ': "' + m[0] + '"');
    }
  }
  check('every count printed on a reader-facing surface equals the registry', wrong.length === 0, wrong.join('; '));
}

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

/* ---- a count is not a diagnosis ---------------------------------------------------
   The main updater used to answer a failed fetch with `failedSources++; continue;`,
   throwing away the URL and the reason. The popup could then say "5 unreachable"
   and nobody -- reader or maintainer -- could find out which five. Three feeds sat
   refused behind that number for months, one of them a list whose bucket was
   therefore permanently empty. */
check('the main updater records WHICH source failed and why',
  /sourceFailures\.push\(\{/.test(BG) && /url: String\(result\.url \|\| ''\)/.test(BG)
    && /error: String\(result\.error \|\| 'failed'\)/.test(BG),
  'a bare counter cannot be acted on');
check('the failures reach the stored meta',
  /failures: sourceFailures\.slice\(0, \d+\)/.test(BG));
check('the list of failures is bounded',
  /sourceFailures\.slice\(0, \d+\)/.test(BG),
  'a permanently broken feed should not grow storage without limit');
check('the popup names them rather than only counting them',
  /id="list-failures"/.test(POPUP_HTML) && /list-failure-url/.test(POPUP_JS)
    && /list-failure-why/.test(POPUP_JS));
check('and shows the reason, not just the name',
  /why\.textContent = f\.error/.test(POPUP_JS),
  'a 404 needs a new URL and an over-cap list needs a smaller edition; as a count they look identical');
check('nothing is shown when every feed worked',
  /failEl\.hidden = failedList\.length === 0/.test(POPUP_JS));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all protection-count checks passed');

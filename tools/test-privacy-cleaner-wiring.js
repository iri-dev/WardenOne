/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The Privacy Cleaner's controls have to reach the worker (PI-01).
 *
 * "Consent banners & tracking cookies" shipped ticked by default, was announced in the README
 * and the changelog, and had never once run. Three links were missing and any one of them
 * would have been enough: the checkbox was read by nothing, the request field was sent by
 * nobody, and the implementation was called from nowhere. The reason it survived review is a
 * naming near-miss -- the element is cl-consent, the field is consentCookies, and neither
 * string appears in the other's file, so nothing looked broken from either end.
 *
 * Nothing errored either. A reader ticking only that box got "Pick at least one thing to
 * clean", which reads as a UI quirk, and a reader leaving it ticked among others got a
 * cheerful summary that simply never mentioned consent cookies.
 *
 * So this asserts the wiring as a set relationship in three places at once -- panel, sender,
 * worker -- rather than checking any single link. A new checkbox that reaches nothing, or a
 * worker field nobody sends, fails here by name.
 *
 * It then runs the shipped handler, because the wiring being present is not the same as the
 * feature working, and checks the promise printed on the control itself: "Keeps you signed in".
 *
 * Run: node tools/test-privacy-cleaner-wiring.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return src.slice(a, b);
}

/* ---- 1. the three sets ------------------------------------------------------------ */

/* every checkbox in the cleaner panel, which is bounded by its own Clean selected button */
const PANEL = between(HTML, 'id="cl-since"', 'id="cl-run"', 'the cleaner panel');
const boxes = [...PANEL.matchAll(/<input type="checkbox" id="(cl-[a-z]+)"/g)].map((m) => m[1]);

/* the types object the click handler builds and sends */
const SENDER = between(POPUP, "$('cl-run').addEventListener('click'", "const out = $('cl-result')",
  'the cleaner click handler');
const sent = new Map();                       // request field -> element id
for (const m of SENDER.matchAll(/([A-Za-z]+):\s*\$\('(cl-[a-z]+)'\)\.checked/g)) {
  sent.set(m[1], m[2]);
}

/* every field the worker branches on */
const HANDLER = between(BG, "if (msg && msg.kind === 'clean-browser' && msg.types) {",
  '// ---- Local Extension Security Centre ----', 'the clean-browser handler');
const read = new Set([...HANDLER.matchAll(/\bt\.([A-Za-z]+)\b/g)].map((m) => m[1]));

/* These three only guard against a parse that found nothing -- a slice whose anchor moved
   would otherwise report "every checkbox is wired" about an empty set. The real work is the
   set comparison below, which needs no expected count and so cannot go stale when a control
   is legitimately added or removed. */
check('the cleaner panel was found and has its controls', boxes.length > 0, boxes.join(', '));
check('the click handler was found', sent.size > 0, [...sent.keys()].join(', '));
check('the worker handler was found', read.size > 0, [...read].join(', '));

const unsentBoxes = boxes.filter((id) => ![...sent.values()].includes(id));
check('every checkbox in the panel is read by the click handler', unsentBoxes.length === 0,
  unsentBoxes.join(', ') + ' -- a control the reader can tick that reaches nothing');

const unreadFields = [...sent.keys()].filter((f) => !read.has(f));
check('every field the popup sends is read by the worker', unreadFields.length === 0,
  unreadFields.join(', ') + ' -- sent and ignored');

const unsentFields = [...read].filter((f) => !sent.has(f));
check('every field the worker reads is sent by the popup', unsentFields.length === 0,
  unsentFields.join(', ') + ' -- the worker gates work on a field no sender sets, which is '
  + 'exactly how the consent sweep spent a release doing nothing');

/* the specific pair, by name, so neither end can be renamed in isolation */
check('cl-consent maps to consentCookies', sent.get('consentCookies') === 'cl-consent',
  'the one link that was missing');
check('and the worker still gates the sweep on that field',
  /t\.consentCookies/.test(HANDLER) && /cleanConsentAndTrackingCookies\(\)/.test(HANDLER));

/* ---- 2. run the shipped handler --------------------------------------------------- */

function runHandler(types) {
  const calls = { sweep: 0, removeArgs: null };
  const ctx = {
    Date, Number, Object, Array, String, JSON, Promise, console: { log() {}, warn() {} },
    chrome: {
      browsingData: {
        remove(opts, dataTypes) { calls.removeArgs = { opts, dataTypes }; return Promise.resolve(); },
      },
    },
    cleanConsentAndTrackingCookies() {
      calls.sweep++;
      return Promise.resolve({ removed: 143, kept: 900, sites: 62 });
    },
    resetSensitiveSitePermissionsGlobally() { return Promise.resolve({ reset: ['Camera'] }); },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return new Promise((resolve) => {
    ctx.sendResponse = (res) => resolve({ res, calls });
    ctx.msg = { kind: 'clean-browser', types, sinceMs: 0 };
    vm.runInContext('(function (msg, sendResponse) {\n' + HANDLER + '\n})(msg, sendResponse);', ctx);
  });
}

(async () => {
  /* the default state of the panel: consent ticked, cookies not */
  {
    const { res, calls } = await runHandler({ consentCookies: true });
    check('a consent-only clean runs the sweep', calls.sweep === 1);
    check('and does not call browsingData.remove at all', calls.removeArgs === null,
      'there is no browsingData type for "the consent cookies only"');
    check('and answers ok rather than "nothing selected"', res.ok === true, JSON.stringify(res));
    check('and returns the counts the popup prints',
      res.consent && res.consent.removed === 143 && res.consent.sites === 62,
      JSON.stringify(res.consent));
    check('and reports no browsingData categories cleared',
      Array.isArray(res.cleared) && res.cleared.length === 0);
  }

  /* both ticked: the sweep is subsumed, and its sentence would contradict the wipe */
  {
    const { res, calls } = await runHandler({ consentCookies: true, cookies: true });
    check('ticking all cookies too skips the redundant sweep', calls.sweep === 0,
      'it would delete cookies moments before browsingData deletes them all, and then print '
      + '"so you are still signed in" above a wholesale sign-out');
    check('and the wholesale cookie wipe still happens',
      calls.removeArgs && calls.removeArgs.dataTypes.cookies === true);
    check('and no consent sentence is offered to the popup', res.consent === null,
      JSON.stringify(res.consent));
  }

  /* unticked stays unticked */
  {
    const { res, calls } = await runHandler({ cache: true });
    check('an unticked consent box runs nothing', calls.sweep === 0);
    check('and the rest of the clean is unaffected',
      calls.removeArgs && calls.removeArgs.dataTypes.cache === true && res.ok === true);
  }

  /* ---- 3. the popup path around it ------------------------------------------------ */

  check('the "pick at least one" guard now counts the consent box',
    /const anyChecked = Object\.values\(types\)\.some\(Boolean\)/.test(SENDER + POPUP),
    'it is computed from the same types object, so adding the field fixes the guard too');

  const CONFIRM = between(POPUP, 'const anyChecked', "chrome.runtime.sendMessage({ kind: 'clean-browser'",
    'the confirmation block');
  check('the sign-out warning is still tied to the all-cookies box only',
    /const willSignOut = types\.cookies \?/.test(CONFIRM),
    'a consent sweep that warns about signing you out defeats the point of it');
  check('and the consent box does not trigger it',
    !/types\.consentCookies/.test(CONFIRM));

  const RESULT = between(POPUP, 'if (res && res.ok) {', 'if (res.perms)', 'the result renderer');
  check('the result sentence the changelog promised is rendered', /if \(res\.consent\)/.test(RESULT));
  check('it reports removed, sites and kept', /c\.removed/.test(RESULT) && /c\.sites/.test(RESULT)
    && /c\.kept/.test(RESULT));
  check('it has a sentence for a clean profile too',
    /No consent or tracking cookies left to remove/.test(RESULT));

  /* ---- 4. the promise printed on the control -------------------------------------- */

  check('the control still promises it keeps you signed in',
    /Keeps you signed in/.test(PANEL));

  /* Which cookies are safe to delete is NOT asserted here -- tools/test-cookie-cleaner.js
     already attacks that classifier from the side that matters, and a second copy of those
     cases would drift from the first. What is asserted here is the thing that suite cannot
     see: that this sweep uses the same classifier at all. A private copy of the rules inside
     cleanConsentAndTrackingCookies would leave test-cookie-cleaner.js green while the manual
     path deleted whatever it liked. */
  /* Both bodies sit at column 0, so their for-loops close with a bare "}" line too; the first
     blank line is the only reliable end of either function. */
  const sweep = between(BG, 'async function cleanConsentAndTrackingCookies() {',
    '\n\n', 'the profile-wide sweep');
  const onLeave = between(BG, 'async function clearCookiesForDomain(domain) {', '\n\n',
    'the clear-on-leave sweep');
  check('the sweep slice reached its return statement', /return \{ removed, kept:/.test(sweep),
    'the slice ended early and the assertions below are reading a fragment');
  check('the profile-wide sweep classifies with the shared cookieIsDisposable',
    /if \(!cookieIsDisposable\(cookie\)\) continue;/.test(sweep),
    'the keep/remove rules are tested once, in tools/test-cookie-cleaner.js, and both sweeps '
    + 'have to be the thing that suite is testing');
  check('and so does the clear-on-leave sweep it shares its lists with',
    /if \(!cookieIsDisposable\(cookie\)\) continue;/.test(onLeave));
  check('the profile-wide sweep counts what it kept, which is the reassuring half',
    /kept: all\.length - removed/.test(sweep));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all Privacy Cleaner wiring checks passed');
})();

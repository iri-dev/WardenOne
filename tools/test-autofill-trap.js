/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The autofill trap, inside the Form Trap Detector.
 *
 * A page can carry credential fields the reader never sees, marked so a password
 * manager fills them, and read the result out with script. The reader never knew a
 * password box existed.
 *
 * THE ENTIRE DESIGN IS THE CALIBRATION. A hidden credential field on its own is not
 * evidence -- real logins use them constantly, and a detector that fires on that is a
 * detector nobody can leave switched on. So this suite is mostly about what must NOT
 * warn: every partial combination has to stay under TRAP_THRESHOLD, and only the full
 * one may cross it. Testing that it catches the trap is the easy half.
 *
 * scoreForm is lifted out of src/content.js and run for real.
 *
 * Run: node tools/test-autofill-trap.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

const THRESHOLD = Number((SRC.match(/TRAP_THRESHOLD=(\d+)/) || [])[1]);
check('the threshold is readable from the source', THRESHOLD > 0);

const start = SRC.indexOf('const trapTypedFields=new WeakSet,');
const end = SRC.indexOf('showTrapPanel=reasons=>{', start);
check('the scoring block is where the slice expects it', start > 0 && end > start);
const block = 'const ' + SRC.slice(start + 'const '.length, end) + '__end=0;';

/* A field is whatever the scorer asks it about, and nothing more. */
function makeField(opts) {
  const o = opts || {};
  return {
    __style: {
      display: o.display || 'inline-block',
      visibility: o.visibility || 'visible',
      opacity: o.opacity === undefined ? '1' : o.opacity,
    },
    __rect: o.rect || { width: 180, height: 28, left: 40, top: 200, right: 220, bottom: 228 },
    type: o.type || 'password',
    value: o.value === undefined ? '' : o.value,
    autocomplete: o.autocomplete || '',
    getAttribute(name) { return name === 'autocomplete' ? this.autocomplete : null; },
    getBoundingClientRect() { return this.__rect; },
    matches(sel) { return o.chromeAutofilled ? /autofill/.test(sel) : false; },
    closest() { return null; },
    parentElement: null,
  };
}
const HIDDEN_RECT = { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
const OFFSCREEN_RECT = { width: 180, height: 28, left: -9999, top: 200, right: -9819, bottom: 228 };

function score(field, opts) {
  const o = opts || {};
  const sandbox = {
    String, Number, RegExp, WeakSet, Boolean, Array, Object, Math, URL, console,
    getComputedStyle: (el) => el.__style,
    window: { innerWidth: 1280, innerHeight: 800 },
    document: {
      querySelectorAll: () => (o.pagePasswordFields || [field]),
    },
    location: { href: 'https://shop.example/checkout', hostname: 'shop.example', protocol: 'https:' },
    /* Everything the pre-existing scoring reads. All neutral, so the only score that
       can appear is the one this suite is about. */
    regHost: (h) => String(h || '').replace(/^www\./, '').toLowerCase(),
    here: 'shop.example',
    rawIp: () => false,
    sibling: () => true,
    isAuthProvider: () => false,
    onGrabberList: () => false,
    isOverlay: () => false,
    brandClaimMismatch: () => '',
    injectedForms: { has: () => false },
    WO: { __pageRisk: null },
  };
  vm.createContext(sandbox);
  vm.runInContext(block + ';globalThis.__score = scoreForm;'
    + 'globalThis.__typed = trapTypedFields;', sandbox, { filename: 'src/content.js:formtrap' });
  if (o.typedInto) sandbox.__typed.add(field);
  return sandbox.__score(field);
}

/* ---- what must NOT warn --------------------------------------------------- */
{
  const r = score(makeField({}));
  check('an ordinary visible password box scores nothing', r.score === 0,
    'scored ' + r.score + ': ' + r.reasons.join(' / '));
}
{
  const r = score(makeField({ rect: HIDDEN_RECT }));
  check('a hidden field ALONE stays under the threshold', r.score < THRESHOLD,
    'scored ' + r.score + '; real logins carry hidden credential fields constantly');
  check('and it is still noticed', r.score > 0);
}
{
  const r = score(makeField({ rect: HIDDEN_RECT, autocomplete: 'current-password' }));
  check('hidden + marked for the password manager stays under', r.score < THRESHOLD,
    'scored ' + r.score);
}
{
  /* The important one: a real login page whose manager filled a hidden field as well
     as the visible one. Every part of the trap is present EXCEPT that there is a
     login box on screen -- and that is what makes it ordinary. */
  const trap = makeField({ rect: HIDDEN_RECT, autocomplete: 'current-password', value: 'hunter2' });
  const visible = makeField({});
  const r = score(trap, { pagePasswordFields: [trap, visible] });
  check('hidden + marked + filled, WITH a visible login, stays under', r.score < THRESHOLD,
    'scored ' + r.score + ' (' + r.reasons.join(' / ') + '); this is the ordinary case and '
    + 'warning on it would make the feature unusable');
}
{
  const f = makeField({ rect: HIDDEN_RECT, autocomplete: 'current-password', value: 'typed-by-hand' });
  const r = score(f, { typedInto: true, pagePasswordFields: [f] });
  check('a hidden field the reader typed into is not "filled without typing"',
    r.score < THRESHOLD, 'scored ' + r.score + ': ' + r.reasons.join(' / '));
}

/* ---- what MUST warn ------------------------------------------------------- */
{
  const f = makeField({ rect: HIDDEN_RECT, autocomplete: 'current-password', value: 'hunter2' });
  const r = score(f, { pagePasswordFields: [f] });
  check('the full combination crosses the threshold', r.score >= THRESHOLD,
    'scored ' + r.score);
  check('and leads with the fact the reader most needs',
    /password box on this page you cannot see/.test(r.reasons[0]),
    'the panel shows reasons[0]; got: ' + r.reasons[0]);
  check('and says no login box was on screen',
    r.reasons.some((x) => /no login box/.test(x)));
}
{
  /* Chrome tells us directly what it filled, which must count even with no value
     readable from the field. */
  const f = makeField({ rect: HIDDEN_RECT, autocomplete: 'username', chromeAutofilled: true });
  const r = score(f, { pagePasswordFields: [f] });
  check("Chrome's own autofill marker is enough to count as filled", r.score >= THRESHOLD,
    'scored ' + r.score);
}
for (const [name, opts] of [
  ['display:none', { display: 'none' }],
  ['visibility:hidden', { visibility: 'hidden' }],
  ['opacity:0', { opacity: '0' }],
  ['type=hidden', { type: 'hidden' }],
  ['parked off-screen', { rect: OFFSCREEN_RECT }],
  /* Sitting in the middle of the page at no size at all. Distinct from the off-screen
     case: this one's edges are positive, so only the size test can see it. */
  ['collapsed to nothing', { rect: { width: 0, height: 0, left: 400, top: 300, right: 400, bottom: 300 } }],
]) {
  const f = makeField(Object.assign({ autocomplete: 'current-password', value: 'hunter2' }, opts));
  const r = score(f, { pagePasswordFields: [f] });
  check('hidden by ' + name + ' is caught', r.score >= THRESHOLD, 'scored ' + r.score);
}
{
  /* Below the fold is not hidden. A long sign-up page must not become a trap. */
  const f = makeField({
    autocomplete: 'current-password',
    value: 'hunter2',
    rect: { width: 180, height: 28, left: 40, top: 1400, right: 220, bottom: 1428 },
  });
  const r = score(f, { pagePasswordFields: [f] });
  check('a field below the fold is not treated as hidden', r.score < THRESHOLD,
    'scored ' + r.score + '; it has a real position and scrolls into view');
}

/* ---- it lives in the Form Trap Detector, not beside it -------------------- */
check('the scoring is inside the existing detector',
  SRC.indexOf('credentialTrapHidden') > SRC.indexOf('WO.formTrapDetector'),
  'this was asked for as an upgrade to Form Trap Detector, not a separate shield');
check('it reports through the existing warning',
  /warned_form_trap/.test(SRC) && !/warned_autofill_trap/.test(SRC),
  'a new event kind would be a new product panel by another name');
check('there is no separate config toggle',
  !/autofillTrap/i.test(SRC),
  'it rides on formTrapDetector; another switch is feature-count inflation');
check('only trusted typing counts',
  /!1!==e\.isTrusted&&e\.target&&trapTypedFields\.add/.test(SRC),
  'a script dispatching its own keydown to look like a person is the thing this sees through');
check('the typing listeners are passive and do nothing but record',
  /for\(const ev of\["keydown","beforeinput"\]\)/.test(SRC));

if (failed) {
  console.error('autofill trap: ' + failed + ' failed');
  process.exit(1);
}
console.log('autofill trap: all checks passed');

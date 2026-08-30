/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Keyboard lock and pointer lock, inside the full-screen guard.
 * Run: node tools/test-keyboard-lock-guard.js
 *
 * The full-screen phishing warning ends with "Leave full screen before typing
 * anything." navigator.keyboard.lock(["Escape"]) is a page's answer to that
 * sentence: it takes the one key the advice depends on. Chrome's fallback is to
 * hold Escape, which works and is discoverable only by someone who already knows
 * it exists — not the person being phished. The guard's own comment already
 * allowed that the "press Esc" hint fades and the attack is timed around it;
 * this was the same problem one step on, with the hint gone AND the key taken.
 *
 * So the interesting assertions here are the restrained ones. A game locking W,
 * A, S, D and F11 is the reason this API exists, and the guard's stated rule is
 * warn, never block. Escape is filtered out of a list and everything else in it
 * is granted; a whole-keyboard grab cannot be filtered, so it is only refused
 * once the page has already been caught drawing a fake address bar.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* The two guards as they ship, lifted out of the built engine and run against a
   stub keyboard. Grepping for the code would not tell us whether Escape actually
   survives, which is the entire claim. */
function guardSource() {
  const start = CONTENT.indexOf('const kb=navigator.keyboard;');
  assert(start > 0, 'keyboard lock guard not found in content.min.js');
  const from = CONTENT.lastIndexOf('try{', start);
  const end = CONTENT.indexOf('woOn(document,"fullscreenchange"', start);
  assert(end > from, 'could not delimit the guard');
  return CONTENT.slice(from, end);
}

function harness(opts) {
  opts = opts || {};
  const locked = [];
  const logs = [];
  const pointerLocks = [];

  function Element() {}
  Element.prototype.requestPointerLock = function () { pointerLocks.push(1); return 'real-lock'; };

  const sandbox = {
    console, Promise, Array, Object, String, Boolean, DOMException: function DOMException(m, n) {
      const e = new Error(m); e.name = n || 'Error'; return e;
    },
    fsSpoofSeen: !!opts.spoofSeen,
    log: (type, detail) => { logs.push({ type, detail }); },
    navigator: {
      keyboard: {
        lock(keys) { locked.push(arguments.length === 0 ? null : keys); return Promise.resolve('real-lock'); },
      },
    },
    window: {},
    Element,
  };
  sandbox.window.Element = Element;
  vm.createContext(sandbox);
  vm.runInContext(guardSource(), sandbox, { filename: 'content.min.js' });

  return {
    sandbox, locked, logs, pointerLocks,
    lock(keys) {
      return arguments.length === 0
        ? sandbox.navigator.keyboard.lock()
        : sandbox.navigator.keyboard.lock(keys);
    },
    pointerLock() { return new sandbox.Element().requestPointerLock(); },
    typed(t) { return logs.filter((l) => l.type === t); },
  };
}

const pending = [];

// --- Escape survives, everything else is granted ----------------------------

pending.push((async function escapeIsStrippedAndTheRestIsKept() {
  const h = harness();
  await h.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape', 'F11']);
  check('the real lock was still called', h.locked.length === 1);
  const got = h.locked[0] || [];
  check('Escape is not among the locked keys', got.indexOf('Escape') < 0, JSON.stringify(got));
  /* The restraint that makes this shippable: a game asking for six keys gets
     five, not zero. */
  check('every other requested key is granted',
    ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'F11'].every((k) => got.indexOf(k) >= 0), JSON.stringify(got));
  const noted = h.typed('blocked_keyboard_lock');
  check('the attempt is recorded', noted.length === 1);
  check('the record says what was kept',
    noted.length === 1 && noted[0].detail.requested === 6 && noted[0].detail.kept === 5,
    JSON.stringify(noted[0] && noted[0].detail));
}()));

pending.push((async function aLockWithoutEscapeIsUntouched() {
  const h = harness();
  await h.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  check('a game lock is passed through unchanged',
    h.locked.length === 1 && (h.locked[0] || []).length === 4, JSON.stringify(h.locked[0]));
  check('nothing is recorded for it', h.logs.length === 0, JSON.stringify(h.logs));
}()));

pending.push((async function escapeIsMatchedCaseInsensitively() {
  const h = harness();
  await h.lock(['escape', 'KeyW']);
  const got = h.locked[0] || [];
  check('a differently-cased Escape is still stripped',
    got.indexOf('escape') < 0 && got.indexOf('KeyW') >= 0, JSON.stringify(got));
}()));

pending.push((async function anEscapeOnlyLockGrantsNothing() {
  const h = harness();
  await h.lock(['Escape']);
  /* Filtering the only key leaves an empty list. Calling lock([]) would capture
     the whole keyboard, which is the opposite of the intent. */
  check('the real lock is not called with an empty list', h.locked.length === 0,
    JSON.stringify(h.locked));
  check('it still resolves, so the page does not see an error', true);
  check('and it is recorded', h.typed('blocked_keyboard_lock').length === 1);
}()));

// --- the whole-keyboard grab ------------------------------------------------

pending.push((async function aWholeKeyboardGrabIsAllowedButRecorded() {
  /* Warn, never block, until the page has shown what it is. Presentations and
     games do this legitimately and far more often than phishing does. */
  const h = harness({ spoofSeen: false });
  const r = await h.lock();
  check('a no-argument lock is allowed on an ordinary page', h.locked.length === 1 && r === 'real-lock');
  const noted = h.typed('detected_keyboard_lock');
  check('it is recorded as an observation, not a block', noted.length === 1);
  check('the advice tells the reader the fallback exists',
    noted.length === 1 && /hold escape/i.test(noted[0].detail.action || ''),
    JSON.stringify(noted[0] && noted[0].detail.action));
}()));

pending.push((async function aWholeKeyboardGrabIsRefusedAfterAFakeAddressBar() {
  const h = harness({ spoofSeen: true });
  let rejected = false;
  try { await h.lock(); } catch (_) { rejected = true; }
  check('once the page has drawn a fake address bar, the grab is refused', rejected);
  check('the real lock is never called', h.locked.length === 0);
  const noted = h.typed('blocked_keyboard_lock');
  check('the refusal is recorded at high severity',
    noted.length === 1 && noted[0].detail.severity === 'High',
    JSON.stringify(noted[0] && noted[0].detail));
}()));

// --- pointer lock -----------------------------------------------------------

(function pointerLockFollowsTheSameRule() {
  const ordinary = harness({ spoofSeen: false });
  check('pointer lock works on an ordinary page',
    ordinary.pointerLock() === 'real-lock' && ordinary.pointerLocks.length === 1);
  check('and nothing is recorded for it', ordinary.logs.length === 0);

  const caught = harness({ spoofSeen: true });
  const result = caught.pointerLock();
  /* A fake window you cannot see your cursor in is the whole illusion. */
  check('pointer lock is refused after a fake address bar',
    result === undefined && caught.pointerLocks.length === 0, String(result));
  check('the refusal is recorded', caught.typed('blocked_pointer_lock').length === 1);
}());

// --- the contradiction this closes ------------------------------------------

(function theWarningsAdviceIsNowTrue() {
  /* The reason this was worth doing at all. The guard tells someone to leave
     full screen; a page could make the key that does it stop working. */
  check('the full-screen warning still tells the reader to leave full screen',
    /Leave full screen before typing anything/.test(SOURCE));
  check('the guard shares the spoof flag with the full-screen detector',
    /let fsSpoofSeen=!1;/.test(SOURCE) && /fsSpoofSeen=!0,/.test(SOURCE));
  check('the keyboard guard reads that flag', guardSource().indexOf('fsSpoofSeen') >= 0);
  check('it rides the existing full-screen switch rather than adding one',
    !/data-key="keyboardLock/i.test(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8')));
  const guardAt = SOURCE.indexOf('if(WO.fullscreenGuard&&WO_TOP');
  check('it lives inside the full-screen guard block',
    guardAt > 0 && SOURCE.indexOf('const kb=navigator.keyboard;') > guardAt);
}());

(function itShipped() {
  check('the built engine carries the keyboard guard', CONTENT.indexOf('navigator.keyboard') > 0);
  check('the built engine carries the pointer guard', CONTENT.indexOf('requestPointerLock') > 0);
  check('src and build agree',
    (SOURCE.match(/blocked_keyboard_lock/g) || []).length === (CONTENT.match(/blocked_keyboard_lock/g) || []).length);
}());

// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('keyboard/pointer lock guard: ' + pass + ' checks passed');
});

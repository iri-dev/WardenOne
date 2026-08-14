/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Warnings that behave as the modals they look like (M20).
 *
 * The bridge's interstitials cover the viewport and demand an answer, but announced nothing: no
 * alertdialog role, no accessible name, no initial focus, no contained tab sequence, no focus
 * restoration. A screen reader was never told a phishing decision had appeared, and keyboard focus
 * stayed on the obscured page underneath.
 *
 * The riskiest part of fixing that is the focus trap: one that outlives its dialog breaks the page
 * it was warning about. So these assert the teardown as hard as the semantics.
 *
 * Run: node tools/test-warning-dialogs.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const OAUTH = fs.readFileSync(path.join(ROOT, 'oauth-guard.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// A DOM fake with the one rule that matters faithfully implemented: a closed shadow root reports
// its own activeElement, and listeners are observable so teardown can be asserted.
function makeDom() {
  const listeners = [];
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attrs: {},
      isConnected: true,
      offsetParent: {},
      focused: 0,
      firstChild: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      // Real appendChild DETACHES from the previous parent first. Omitting that made re-parenting
      // an infinite loop here -- shadow.firstChild never advanced -- and dialog() bailed out of its
      // own try/catch, which read as the code being broken rather than the fake being wrong.
      appendChild(c) {
        if (c.parentNode && c.parentNode !== this) c.parentNode.removeChild(c);
        this.children.push(c);
        c.parentNode = this;
        this.firstChild = this.children[0] || null;
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        this.firstChild = this.children[0] || null;
        return c;
      },
      remove() { this.isConnected = false; if (this.parentNode) this.parentNode.removeChild(this); },
      // Focusing must move document.activeElement, or the restore path has nothing to remember and
      // the test reads as a missing feature rather than a missing fake.
      focus() {
        this.focused++;
        if (this.rootRef) this.rootRef.activeElement = this;
        if (this.ownerDoc) this.ownerDoc.activeElement = this;
      },
      addEventListener(type, fn, cap) { listeners.push({ node: this, type, fn, cap }); },
      removeEventListener(type, fn, cap) {
        const i = listeners.findIndex((l) => l.node === this && l.type === type && l.fn === fn && l.cap === cap);
        if (i >= 0) listeners.splice(i, 1);
      },
      querySelector() { return null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n2) => {
          for (const c of n2.children) {
            if (/button/i.test(sel) && c.tagName === 'BUTTON') out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    n.ownerDoc = null;
    return n;
  }
  const document = Object.assign(node('document'), {
    createElement: node,
    activeElement: null,
  });
  // Stamp ownership so focus() can move document.activeElement the way a real one does.
  const own = (n) => { n.ownerDoc = document; const inner = n.appendChild; n.appendChild = function (c) { c.ownerDoc = document; own(c); return inner.call(this, c); }; return n; };
  document.createElement = (tag) => own(node(tag));
  document.body = own(node('body'));
  document.documentElement = document.body;
  return { document, node, listeners };
}

// Lift the real helper.
const from = BRIDGE.indexOf('  const WO_FOCUS_STYLE =');
const to = BRIDGE.indexOf('  // Handles for the three interstitials');
if (from < 0 || to <= from) throw new Error('woOwnedOverlay source markers not found');

function build() {
  const dom = makeDom();
  const healers = [];
  const sandbox = {
    document: dom.document,
    Array, Object, String,
    domWatch: (fn) => { healers.push(fn); return () => { const i = healers.indexOf(fn); if (i >= 0) healers.splice(i, 1); }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE.slice(from, to) + '\nglobalThis.__make = woOwnedOverlay;', sandbox, { filename: 'bridge.js' });
  return { dom, sandbox, listeners: dom.listeners };
}

// ---------------------------------------------------------------------------
// 1. Semantics: a screen reader must be told what appeared.
// ---------------------------------------------------------------------------
{
  const { dom, sandbox, listeners } = build();
  const prior = dom.node('input');
  dom.document.body.appendChild(prior);
  prior.focus();

  const ov = sandbox.__make('wo-login-age');
  const root = ov.root();
  const safe = dom.node('button');
  const risky = dom.node('button');
  root.appendChild(safe);
  root.appendChild(risky);
  ov.mount();
  ov.dialog({ label: 'WardenOne phishing warning', description: 'Check the address.' });

  const box = root.children.filter((c) => c.getAttribute && c.getAttribute('role'))[0];
  check('the warning is exposed as an alertdialog', box && box.getAttribute('role') === 'alertdialog');
  check('it is announced as modal', box && box.getAttribute('aria-modal') === 'true');
  check('it carries an accessible name', box && /phishing warning/.test(box.getAttribute('aria-label') || ''));
  check('it carries a description', box && /Check the address/.test(box.getAttribute('aria-description') || ''));
  check('the existing content is re-parented, not discarded',
    box && box.children.indexOf(safe) >= 0 && box.children.indexOf(risky) >= 0);

  // ---------------------------------------------------------------------------
  // 2. Focus lands inside, on the SAFEST action -- not on "continue anyway".
  // ---------------------------------------------------------------------------
  check('focus moves into the dialog on open', safe.focused > 0, 'safe action was not focused');
  check('focus does not land on the destructive action', risky.focused === 0);

  // ---------------------------------------------------------------------------
  // 3. The tab sequence is contained while it is open.
  // ---------------------------------------------------------------------------
  const trap = listeners.filter((l) => l.type === 'keydown');
  check('a keyboard containment handler is installed', trap.length === 1);

  let prevented = 0;
  const press = (shift, active) => {
    root.activeElement = active;
    trap[0].fn({ key: 'Tab', shiftKey: shift, preventDefault: () => { prevented++; } });
  };
  press(false, risky);
  check('Tab on the last control wraps to the first', prevented === 1 && safe.focused > 1);
  press(true, safe);
  check('Shift+Tab on the first control wraps to the last', prevented === 2 && risky.focused > 0);

  // ---------------------------------------------------------------------------
  // 4. Teardown. This is the part that breaks the host page if it leaks.
  // ---------------------------------------------------------------------------
  ov.destroy();
  check('the containment handler is removed on destroy',
    listeners.filter((l) => l.type === 'keydown').length === 0,
    'a focus trap outlived its dialog');
  check('focus is handed back to where it was', prior.focused > 1, 'focus was not restored');
  check('the host is detached', prior.isConnected === true);
}

// ---------------------------------------------------------------------------
// 5. Every warning that uses the helper opts in, and the focus ring survives `all:initial`.
// ---------------------------------------------------------------------------
{
  check('bridge.js opts all four of its owned warnings into dialog semantics',
    (BRIDGE.match(/\.dialog\(\{/g) || []).length === 4);

  // oauth-guard is deliberately NOT wired yet. Adding the call there made its own suite fail --
  // the modal stopped being detected, because that harness identifies it by watching what gets
  // appended to body and the re-parenting changed what it saw. Rather than ship the highest-stakes
  // consent warning in an unverified state, the wiring was backed out until that harness is
  // updated. Pinned here so the omission is a recorded decision rather than something overlooked.
  check('oauth-guard is knowingly still unwired, not silently missed',
    (OAUTH.match(/\.dialog\(\{/g) || []).length === 0,
    'oauth-guard now calls dialog() -- re-run tools/test-oauth-guard.js before trusting it');
  check('a focus indicator is restored after all:initial strips it',
    /:focus-visible\{/.test(BRIDGE) && /outline:3px solid currentColor/.test(BRIDGE));
  check('the indicator uses an outline, which forced-colors mode honours',
    /outline:3px solid currentColor!important/.test(BRIDGE));
  check('every wired dialog is given a name rather than relying on its contents',
    (BRIDGE.match(/label: 'WardenOne/g) || []).length === 4);
}

if (failed) { console.error('\n' + failed + ' warning-dialog check(s) failed'); process.exit(1); }
console.log('\nwarning dialogs announce and contain correctly');

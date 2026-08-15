/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Warnings that behave as the modals they look like (M20).
 *
 * The nine high-stakes interstitials cover the viewport and demand an answer, but announced
 * nothing: no alertdialog role, no accessible name, no initial focus, no contained tab sequence,
 * no focus restoration. A screen reader was never told a phishing decision had appeared, and
 * keyboard focus stayed on the obscured page underneath.
 *
 * They are built in two places. The bridge and oauth-guard own theirs in a closed shadow root and
 * get the semantics from woOwnedOverlay.dialog(); the engine builds five in the page's own DOM,
 * where that helper cannot reach, and gets them from woDialog() in src/content.js. Two helpers,
 * one contract -- so this suite asserts the same guarantees on both halves rather than trusting
 * that the second copy grew the same behaviour.
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
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// A DOM fake with the rules that matter faithfully implemented: a closed shadow root reports its
// own activeElement, listeners are observable so teardown can be asserted, and a style attribute
// records the priority it was written with -- the focus ring is only correct if it lands inline
// AND important, so a fake that forgot the priority would pass a broken implementation.
function makeDom() {
  const listeners = [];
  function styleDecl() {
    const props = {};
    return {
      props,
      setProperty(k, v, priority) { props[k] = { value: String(v), priority: priority || '' }; },
      removeProperty(k) { delete props[k]; },
    };
  }
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attrs: {},
      isConnected: true,
      offsetParent: {},
      focused: 0,
      firstChild: null,
      style: styleDecl(),
      // Chromium decides :focus-visible for us; the fake lets a test say "this one was a mouse
      // click" so the no-ring-on-click path is exercised rather than assumed.
      focusVisible: true,
      matches(sel) { return /focus-visible/.test(String(sel)) ? this.focusVisible !== false : false; },
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
      // A real closed shadow root, distinct from its host. Without this the fake fell into
      // woOwnedOverlay's light-DOM fallback, where host and root are the same object -- and a
      // fake with no shadow boundary cannot show you a bug that only exists at one.
      attachShadow(init) {
        const sr = own(node('#shadow-root'));
        sr.mode = (init && init.mode) || 'open';
        sr.hostNode = this;
        this.shadowRootRef = sr;
        return sr;
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
const from = BRIDGE.indexOf('  function woFocusRing(scope) {');
const to = BRIDGE.indexOf('  // Handles for the three interstitials');
if (from < 0 || to <= from) throw new Error('woOwnedOverlay source markers not found');

// woOwnedOverlay registers itself in the live-overlay set, which is declared with the other
// teardown collections at the top of the file rather than inside this slice. Lift the real
// declaration rather than stubbing one here: a hand-written `new Set()` in the sandbox would keep
// passing after the real one was renamed or removed, which is the failure this set exists to stop.
const OVERLAY_SET_DECL = '  const woOverlays = new Set();';
if (BRIDGE.indexOf(OVERLAY_SET_DECL) < 0) throw new Error('live-overlay set declaration not found');

function build() {
  const dom = makeDom();
  const healers = [];
  const sandbox = {
    document: dom.document,
    Array, Object, String, Set,
    domWatch: (fn) => { healers.push(fn); return () => { const i = healers.indexOf(fn); if (i >= 0) healers.splice(i, 1); }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(OVERLAY_SET_DECL + '\n' + BRIDGE.slice(from, to)
    + '\nglobalThis.__make = woOwnedOverlay;'
    + '\nglobalThis.__overlays = woOverlays;', sandbox, { filename: 'bridge.js' });
  return { dom, sandbox, healers, listeners: dom.listeners };
}

// The dispose region, lifted whole so the teardown below is the real one rather than a
// re-implementation. Everything it touches is either a Node global or supplied here.
const dFrom = BRIDGE.indexOf('  const woAbort = new AbortController();');
const dTo = BRIDGE.indexOf('  // A per-page-load routing token.');
if (dFrom < 0 || dTo <= dFrom) throw new Error('bridge dispose source markers not found');

function buildDispose() {
  const sandbox = {
    AbortController, Array, Object, Set, String,
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: function () { return { disconnect() {} }; },
    chrome: { runtime: { onMessage: { addListener() {}, removeListener() {} } } },
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE.slice(dFrom, dTo)
    + '\nglobalThis.__overlays = woOverlays;'
    + '\nglobalThis.__dispose = window.__wardenOneBridgeDispose;'
    + '\nglobalThis.__aborted = () => woAbort.signal.aborted;', sandbox, { filename: 'bridge.js' });
  return sandbox;
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
  // 2b. The focus ring actually lands.
  //
  // The first version of this shipped a `:focus-visible` rule in the overlay's stylesheet, which
  // computed to `outline-style:none` on every button in a real browser: the buttons carry
  // `all:initial!important` in their style attribute, and no stylesheet rule outranks that. So the
  // assertion is not "a ring is declared somewhere" -- it is that the ring lands on the element,
  // inline, with the priority that wins.
  // ---------------------------------------------------------------------------
  const ring = (el) => el.style.props.outline;
  check('the focused action gets a focus ring', !!ring(safe) && ring(safe).value === '3px solid currentColor');
  check('the ring is written inline with the priority that beats all:initial',
    !!ring(safe) && ring(safe).priority === 'important',
    'a stylesheet rule cannot outrank an important style attribute');
  check('the ring is offset so it does not sit on the button edge', !!safe.style.props['outline-offset']);

  const focusEvents = () => listeners.filter((l) => /^focus(in|out)$/.test(l.type));
  check('the ring follows focus rather than being painted once', focusEvents().length === 2);
  // Where it listens is the whole behaviour. Focus events are RETARGETED as they leave a closed
  // shadow tree, so a listener on the HOST sees every focusin reporting the host as its target --
  // it would paint the wrapper rather than the button, and the ring would never move with Tab.
  // Measured in Chromium before this was corrected: no ring at all on a shadow-DOM warning.
  //
  // So delivery is modelled the way the browser does it, and the assertions below fail if the
  // listener sits outside the root -- rather than passing because the fake had no boundary.
  check('the ring listens inside the shadow root, where the event still names the button',
    focusEvents().length > 0 && focusEvents().every((l) => l.node === root),
    'bound on the host, a retargeted focusin names the host and the ring follows nothing');
  const fire = (type, target) => focusEvents().filter((l) => l.type === type)
    .forEach((l) => l.fn({ target: l.node === root ? target : ov.hostNode() }));
  fire('focusout', safe);
  check('the ring is removed when focus leaves', !ring(safe));
  risky.focusVisible = false;
  fire('focusin', risky);
  check('a mouse click does not leave a ring behind', !ring(risky), ':focus-visible was not consulted');
  risky.focusVisible = true;
  fire('focusin', risky);
  check('a keyboard focus does paint one', !!ring(risky));

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
  check('the ring listeners are removed on destroy', focusEvents().length === 0);
  check('no inline ring is left behind', !ring(risky));
  check('focus is handed back to where it was', prior.focused > 1, 'focus was not restored');
  check('the host is detached', prior.isConnected === true);
}

// ---------------------------------------------------------------------------
// 5. Every warning that uses the helper opts in, and the focus ring survives `all:initial`.
// ---------------------------------------------------------------------------
{
  check('bridge.js opts all four of its owned warnings into dialog semantics',
    (BRIDGE.match(/\.dialog\(\{/g) || []).length === 4);

  // oauth-guard keeps its own lifted copy of the helper, so the first attempt to wire it called a
  // dialog() that did not exist there -- the surrounding try/catch swallowed the TypeError and took
  // mount() down with it, which read as a harness problem and was actually divergence between two
  // copies of the same code. Re-lifting fixed it, so the copies must not drift again.
  check('oauth-guard opts its consent warning in too',
    (OAUTH.match(/\.dialog\(\{/g) || []).length === 1);
  check('both lifted copies of the helper still carry dialog()',
    OAUTH.includes('dialog(opts)') && BRIDGE.includes('dialog(opts)'),
    'the copies have diverged again');
  check('both lifted copies carry the focus ring too',
    OAUTH.includes('function woFocusRing(scope) {') && BRIDGE.includes('function woFocusRing(scope) {'));
  // Only bridge.js's copy is driven behaviourally above, so oauth-guard's binding site is asserted
  // here instead -- otherwise the copy that is never executed is free to reintroduce the bug.
  check('both copies bind the ring inside the shadow root rather than on the host',
    /focusRing = woFocusRing\(shadow\);/.test(BRIDGE) && /focusRing = woFocusRing\(shadow\);/.test(OAUTH),
    'a ring bound on the host only ever sees the host');
  check('the indicator uses an outline, which forced-colors mode honours',
    /setProperty\('outline', '3px solid currentColor', 'important'\)/.test(BRIDGE)
    && /setProperty\('outline', '3px solid currentColor', 'important'\)/.test(OAUTH));

  // The dead-stylesheet version must not come back anywhere, in any of the three copies. It looked
  // right in review and in a DOM fake, and drew nothing in a browser.
  check('no copy still declares the ring in a stylesheet that cannot apply',
    !/WO_FOCUS_STYLE/.test(BRIDGE) && !/WO_FOCUS_STYLE/.test(OAUTH) && !/focus-visible\{/.test(ENGINE),
    'a :focus-visible rule loses to the elements\' own important style attribute');
  check('every wired dialog is given a name rather than relying on its contents',
    (BRIDGE.match(/label: 'WardenOne/g) || []).length === 4);
}

// ---------------------------------------------------------------------------
// The engine half: the five core blockers built in src/content.js.
//
// These are light-DOM overlays, so the shadow-root helper cannot serve them. woDialog() is the
// same contract written for the page's own DOM, and the assertions below are deliberately the
// same ones the bridge half gets -- the point of a second helper is that it behaves identically,
// and the only way to know that is to demand it twice.
// ---------------------------------------------------------------------------
function buildEngine() {
  const from = ENGINE.indexOf('    woFocusRing=host=>{');
  const to = ENGINE.indexOf('    mountBlocker=(id,');
  if (from < 0 || to <= from) throw new Error('woDialog source markers not found in src/content.js');
  const dom = makeDom();
  const sandbox = { document: dom.document, Array, Object, String };
  vm.createContext(sandbox);
  // Trailing block comments are stripped before the comma: the region ends where the next chain
  // member's explanatory comment begins, and `const ... , /* comment */ ;` does not parse.
  // The comment body may not itself contain `*/`, which pins this to the LAST block comment --
  // a lazy `[\s\S]*?` anchored at the end matches from the FIRST one and eats the region.
  const region = ENGINE.slice(from, to)
    .replace(/\/\*(?:[^*]|\*(?!\/))*\*\/\s*$/, '')
    .replace(/,\s*$/, '');
  vm.runInContext('const ' + region + ';'
    + '\nglobalThis.__dialog = woDialog;', sandbox, { filename: 'src/content.js' });
  return { dom, sandbox, listeners: dom.listeners };
}

{
  const { dom, sandbox, listeners } = buildEngine();
  const prior = dom.node('input');
  dom.document.body.appendChild(prior);
  prior.focus();

  const host = dom.document.createElement('div');
  host.id = 'rg-phish-block';
  const card = dom.document.createElement('div');
  const safe = dom.document.createElement('button');
  const risky = dom.document.createElement('button');
  card.appendChild(safe);
  card.appendChild(risky);
  host.appendChild(card);
  dom.document.body.appendChild(host);

  const release = sandbox.__dialog(host, card, {
    label: 'WardenOne phishing warning',
    description: 'This address imitates a well-known brand.',
  });

  check('the engine blocker is exposed as an alertdialog', card.getAttribute('role') === 'alertdialog');
  check('the engine blocker is announced as modal', card.getAttribute('aria-modal') === 'true');
  check('the engine blocker carries an accessible name',
    /phishing warning/.test(card.getAttribute('aria-label') || ''));
  check('the engine blocker carries a description',
    /imitates a well-known brand/.test(card.getAttribute('aria-description') || ''));

  // Same ring, same reason it has to be inline: oBtn resets every button with `all:unset!important`
  // in its style attribute, which no stylesheet rule of ours can outrank.
  const ring = (el) => el.style.props.outline;
  check('the engine dialog paints a focus ring on the action it focused',
    !!ring(safe) && ring(safe).value === '3px solid currentColor');
  check('the engine ring is written inline with the priority that beats all:unset',
    !!ring(safe) && ring(safe).priority === 'important');
  check('the engine leaves no stylesheet behind to do a job it cannot do',
    host.children.filter((c) => c.tagName === 'STYLE').length === 0);

  const focusEvents = () => listeners.filter((l) => /^focus(in|out)$/.test(l.type));
  const fire = (type, target) => focusEvents().filter((l) => l.type === type).forEach((l) => l.fn({ target }));
  check('the engine ring follows focus', focusEvents().length === 2);
  fire('focusout', safe);
  check('the engine ring is removed when focus leaves', !ring(safe));
  risky.focusVisible = false;
  fire('focusin', risky);
  check('a mouse click leaves no ring in the engine dialog either', !ring(risky));

  check('focus moves into the engine dialog on open', safe.focused > 0);
  check('focus does not land on the engine dialog\'s destructive action', risky.focused === 0);

  const trap = listeners.filter((l) => l.type === 'keydown');
  check('a keyboard containment handler is installed on the engine dialog', trap.length === 1);

  let prevented = 0;
  const press = (shift, active) => {
    dom.document.activeElement = active;
    trap[0].fn({ key: 'Tab', shiftKey: shift, preventDefault: () => { prevented++; } });
  };
  press(false, risky);
  check('Tab on the last engine control wraps to the first', prevented === 1 && safe.focused > 1);
  press(true, safe);
  check('Shift+Tab on the first engine control wraps to the last', prevented === 2 && risky.focused > 0);
  press(false, safe);
  check('Tab in the middle of the sequence is left alone', prevented === 2);

  release();
  check('the engine containment handler is removed on release',
    listeners.filter((l) => l.type === 'keydown').length === 0,
    'a focus trap outlived its dialog');
  check('the engine ring listeners are removed on release', focusEvents().length === 0);
  check('focus is handed back to where it was', prior.focused > 1, 'focus was not restored');
  release();
  check('releasing twice is harmless', prior.focused === 2, 'release is not idempotent');
}

// ---------------------------------------------------------------------------
// All five engine warnings opt in, and every close path releases.
//
// The trap is bound to the overlay rather than the document, so a leaked one is not merely untidy:
// it is a live keydown handler on a node the page can still reach. Each blocker composes its
// release into the teardown the buttons already call, so there is one way out, not two.
// ---------------------------------------------------------------------------
{
  check('all five engine blockers are wired to woDialog',
    (ENGINE.match(/woDialog\(/g) || []).length === 5,
    (ENGINE.match(/woDialog\(/g) || []).length + ' call sites');
  check('each engine blocker is given a name rather than relying on its contents',
    (ENGINE.match(/label:"WardenOne /g) || []).length === 5);
  for (const id of ['rg-adult-gate', 'rg-interstitial', 'rg-phish-block', 'rg-grabber-warn', 'wo-scam-lock']) {
    check(id + ' is one of them', ENGINE.includes('"' + id + '"'));
  }

  // The four self-healing blockers: teardown releases before it unmounts, so the button paths and
  // the navigation paths cannot diverge.
  check('every mountBlocker teardown releases its dialog first',
    (ENGINE.match(/release&&release\(\),\s+release=null,\s+stop\w+\(\)/g) || []).length === 4,
    (ENGINE.match(/release&&release\(\),\s+release=null,\s+stop\w+\(\)/g) || []).length + ' composed teardowns');

  // The scam lock has no mountBlocker, so its two exits are hand-wired and both must release.
  check('the scam lock releases when you leave the page',
    /releaseScamPanel\(\),\s+leaveSafely\(\)/.test(ENGINE));
  check('the scam lock releases when you dismiss it',
    /releaseScamPanel\(\);\s+try\{\s+wrap\.remove\(\)/.test(ENGINE));

  // The phishing bar is the deliberate non-dialog. It must announce, and it must NOT trap.
  check('the lower-confidence phishing bar announces itself',
    /bar\.setAttribute\("role",\s+"alert"\)/.test(ENGINE));
  check('the phishing bar close button has a name',
    /x\.setAttribute\("aria-label",\s+"Dismiss phishing warning"\)/.test(ENGINE));
  check('the phishing bar gets a focus ring too', ENGINE.includes('woFocusRing(bar)'));
  check('the phishing bar does not steal focus or trap the keyboard',
    !/woDialog\(bar/.test(ENGINE), 'a non-modal notification must not become a modal');

  // Source is not what ships. content.min.js is generated, and a stale one would leave every
  // assertion above green while users got the old, silent warnings.
  check('the shipped runtime carries the engine dialogs',
    (MIN.match(/woDialog\(/g) || []).length === 5 && MIN.includes('woDialog=(host,box,opts)=>'),
    'content.min.js is stale');
}

// ---------------------------------------------------------------------------
// Closing a warning has to reach destroy(), on every path there is.
//
// destroy() is the only thing that releases the keyboard trap, hands focus back, stops the
// self-healing watcher and removes the host. Three of the five bridge interstitials used to close
// by calling wrap.remove() on the inner element instead: the panel vanished, so it looked right,
// while the dialog stayed registered with focus never returned and an empty aria-modal box left in
// the accessibility tree.
//
// The second half is the same defect from the other end. A bridge that is replaced while a warning
// is up aborts every button's listener -- they all ride the abort signal -- but the trap is a raw
// listener on the host and is not covered by it. Without the registry that left an undismissable
// modal on the page. Repair is what triggers it: it stamps this file's version flag stale and
// re-injects, and people press Repair when something looks wrong, which is when a warning is most
// likely to be on screen.
// ---------------------------------------------------------------------------
{
  const { dom, sandbox } = build();
  const prior = dom.node('input');
  dom.document.body.appendChild(prior);
  prior.focus();

  const ov = sandbox.__make('wo-script-drift');
  const root = ov.root();
  const btn = dom.node('button');
  root.appendChild(btn);
  ov.mount();
  ov.dialog({ label: 'WardenOne security warning' });

  check('a live overlay is registered while it is on screen', sandbox.__overlays.size === 1);
  check('opening a dialog moves focus off the page', prior.focused > 0 && dom.document.activeElement !== prior);

  ov.destroy();
  check('destroy deregisters the overlay', sandbox.__overlays.size === 0);
  check('destroy hands focus back to where the user was', dom.document.activeElement === prior);
  check('destroy removes the host from the page', !ov.hostNode());

  // Dispose drains the set and a caller may have destroyed the same overlay first, so neither may
  // depend on being the one that got there.
  let threw = false;
  try { ov.destroy(); } catch (_) { threw = true; }
  check('destroy is idempotent', !threw && sandbox.__overlays.size === 0);
}

{
  // Every close path in bridge.js goes through destroy() rather than detaching inner markup.
  // Asserted on source because these are five separate call sites in five different features; the
  // behaviour each one depends on is driven above.
  // Four use the capture-then-null idiom; the smart-script notice predates it and also has a focus
  // ring of its own to release first. Both shapes are accepted, neither absence is.
  const captured = (BRIDGE.match(/try \{ if \(overlay\) overlay\.destroy\(\); \} catch \(_\) \{\}/g) || []).length;
  check('the four capture-then-destroy interstitials all close through destroy()',
    captured === 4, captured + ' found');
  check('the smart-script notice closes through destroy() as well',
    /smartScriptNoticeOverlay\.destroy\(\); \} catch \(_\) \{\}\s*\n\s*smartScriptNoticeOverlay = null;/.test(BRIDGE));
  check('no warning closes by detaching its inner wrapper', !/wrap\.remove\(\)/.test(BRIDGE));
}

{
  // The real dispose, driven.
  const sb = buildDispose();
  const destroyed = [];
  const overlay = { destroy() { destroyed.push('overlay'); } };
  const stubborn = { destroy() { throw new Error('page broke it'); } };
  sb.__overlays.add(stubborn);
  sb.__overlays.add(overlay);

  // Guarded so a dispose that stops catching fails this assertion instead of crashing the suite
  // and hiding the three below it.
  let disposeThrew = false;
  try { sb.__dispose(); } catch (_) { disposeThrew = true; }

  check('replacing the bridge destroys a warning it left on screen', destroyed.length === 1);
  check('the overlay set is emptied by dispose', sb.__overlays.size === 0);
  check('one overlay that throws cannot strand the others',
    !disposeThrew && destroyed.indexOf('overlay') >= 0);
  check('dispose still aborts the listener signal afterwards', sb.__aborted() === true);

  let reThrew = false;
  try { sb.__dispose(); } catch (_) { reThrew = true; }
  check('dispose is safe to run twice', !reThrew);
}

if (failed) { console.error('\n' + failed + ' warning-dialog check(s) failed'); process.exit(1); }
console.log('\nwarning dialogs announce and contain correctly');

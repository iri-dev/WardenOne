/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Fake Window Guard used to rediscover every possible fake window in the document every
 * time anything changed.
 *
 * The observer watched childList across the whole subtree and threw the mutation away:
 * any change queued a pass that selected every div, section, dialog, aside and form in
 * the document and called getBoundingClientRect() on each one. The 500 cap counted
 * CANDIDATES -- elements that had already passed the size test -- so it never limited the
 * layout reads at all. A page with ten thousand divs paid ten thousand forced layout
 * reads per pass, up to forty passes, during hydration (PERF-01).
 *
 * Two changes carry the fix, and this asserts both:
 *
 *   - a structural prefilter. The decisive test refuses to warn unless the container holds
 *     a password field or an embedded frame, so asking that first -- a selector match, no
 *     layout -- is exactly conservative. It cannot drop anything that could have warned.
 *   - mutation locality. After the first pass, only changed subtrees and their candidate
 *     ancestors are scanned, which is the same lesson the subtree-scan dedup learned.
 *
 * Detection had to survive both, so the counting here runs the SHIPPED scan against a
 * stub DOM and checks the warning still fires for a window inserted whole, one assembled
 * piece by piece, and one restyled into place after insertion -- the three shapes the
 * finding's regression note called out.
 *
 * Run: node tools/test-fake-window-scan-cost.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* ---- a stub DOM that counts what the scan actually costs ------------------------- */

let layoutReads = 0;
let styleReads = 0;
let selectorRuns = 0;

class El {
  constructor(tag, opts) {
    opts = opts || {};
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.box = opts.box || { top: 0, bottom: 40, width: 100, height: 40 };
    this.position = opts.position || 'static';
    this.text = opts.text || '';
    /* fwOwnText walks firstChild/nextSibling looking for text nodes, so an element
       given text but no children still needs one. Wiring this only inside add() left
       title bars with no readable text and no header was ever found. */
    this.firstChild = this.text ? { nodeType: 3, nodeValue: this.text, nextSibling: null } : null;
    this.nextSibling = null;
  }
  add(child) {
    child.parentElement = this;
    this.children.push(child);
    const kids = this.children;
    for (let i = 0; i < kids.length; i++) kids[i].nextSibling = kids[i + 1] || null;
    this.firstChild = this.text
      ? { nodeType: 3, nodeValue: this.text, nextSibling: kids[0] || null }
      : (kids[0] || null);
    return child;
  }
  descendants(out) {
    out = out || [];
    for (const c of this.children) { out.push(c); c.descendants(out); }
    return out;
  }
  getBoundingClientRect() { layoutReads++; return this.box; }
  matchesSelector(sel) {
    const tags = sel.split(',').map((t) => t.trim());
    for (const t of tags) {
      if (/^[a-z]+$/i.test(t) && this.tagName === t.toUpperCase()) return true;
      if (t.indexOf('input[type="password"]') === 0 && this.tagName === 'INPUT' && this.type === 'password') return true;
      if (t === 'iframe' && this.tagName === 'IFRAME') return true;
      if (t.indexOf('input[autocomplete') === 0 && this.tagName === 'INPUT' && this.autocomplete) return true;
    }
    return false;
  }
  querySelectorAll(sel) {
    selectorRuns++;
    if (sel === '*') return this.descendants();
    return this.descendants().filter((n) => n.matchesSelector(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function makeDoc(divCount, windowSpec) {
  const body = new El('body');
  for (let i = 0; i < divCount; i++) {
    body.add(new El('div', { box: { top: 10, bottom: 60, width: 400, height: 50 } }));
  }
  let win = null;
  if (windowSpec) {
    win = new El('div', {
      box: { top: 100, bottom: 520, width: 460, height: 420 },
      position: windowSpec.position || 'fixed',
    });
    const bar = win.add(new El('div', { box: { top: 100, bottom: 130, width: 460, height: 30 }, text: 'accounts.google.com  ×' }));
    void bar;
    const pw = new El('input');
    pw.type = 'password';
    pw.box = { top: 300, bottom: 330, width: 300, height: 30 };
    win.add(pw);
    body.add(win);
  }
  return { body, win };
}

/* ---- run the shipped scan in a sandbox ------------------------------------------ */

/* The guard body lives inside an `if (...) { ... }`, so the slice has to stop after the
   observer try/catch closes or the lifted text is unbalanced. */
function liftGuard() {
  const start = SRC.indexOf('      const FW_CONTROL=');
  const tail = '      }\n      catch(_){\n\n      }\n';
  const at = SRC.indexOf(tail, SRC.indexOf('6e4)', start));
  if (start < 0 || at < 0) throw new Error('Fake Window Guard block not found');
  return SRC.slice(start, at + tail.length);
}

function runScan(doc, opts) {
  opts = opts || {};
  layoutReads = 0; styleReads = 0; selectorRuns = 0;
  const warned = [];
  const timers = [];
  const listeners = {};
  let observerCb = null;

  const sandbox = {
    document: {
      body: doc.body,
      documentElement: doc.body,
      createElement: (t) => new El(t),
    },
    window: { innerWidth: 1280, innerHeight: 900 },
    location: { hostname: 'shop.example', href: 'https://shop.example/' },
    getComputedStyle: (el) => { styleReads++; return { position: el.position }; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Set, Map, WeakSet, Math, String, Number, Array, Object, RegExp, Date, JSON,
    regDomain: (h) => {
      const parts = String(h || '').split('.').filter(Boolean);
      return parts.slice(-2).join('.');
    },
    log: (type, detail) => { if (type === 'warned_fake_window') warned.push(detail); },
    woOn: (target, type, fn) => { listeners[type] = fn; },
    __woObserver: (cb) => { observerCb = cb; return { observe() {}, disconnect() {} }; },
    __woWarn: { up: () => false, mark: () => {} },
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(liftGuard() + '\nglobalThis.__fwScan = fwScan;\nglobalThis.__fwNote = typeof fwNote === "function" ? fwNote : null;', sandbox);

  // the initial full pass
  sandbox.__fwScan();
  const firstPass = { layoutReads, styleReads, selectorRuns };

  // then a burst of mutations, as a hydrating page produces
  layoutReads = 0; styleReads = 0; selectorRuns = 0;
  const noise = [];
  for (let i = 0; i < (opts.mutations || 20); i++) {
    const n = doc.body.add(new El('span', { box: { top: 0, bottom: 10, width: 10, height: 10 } }));
    noise.push(n);
  }
  if (observerCb) {
    observerCb(noise.map((n) => ({ type: 'childList', addedNodes: [n] })));
    // drain the debounce
    for (const t of timers.splice(0)) { try { t.fn(); } catch (_) {} }
  }
  const afterMutations = { layoutReads, styleReads, selectorRuns };

  return { warned, firstPass, afterMutations, observerCb, timers, listeners, sandbox };
}

/* ---- 1. the cost of unrelated mutations ------------------------------------------ */

console.log('  -- scan cost --');
{
  const doc = makeDoc(4000, null);
  const r = runScan(doc, { mutations: 20 });
  console.log('     first pass       : ' + r.firstPass.layoutReads + ' layout reads over 4000 containers');
  console.log('     20 unrelated muts: ' + r.afterMutations.layoutReads + ' layout reads');
  check('the first pass no longer measures every container',
    r.firstPass.layoutReads < 100,
    r.firstPass.layoutReads + ' layout reads -- the prefilter should reject containers with no password field or frame before any geometry');
  check('unrelated mutations cost almost no layout',
    r.afterMutations.layoutReads < 50,
    r.afterMutations.layoutReads + ' layout reads for 20 spans that cannot be windows');
}

/* ---- 2. detection survives, in all three shapes --------------------------------- */

console.log('  -- detection --');
{
  const doc = makeDoc(300, { position: 'fixed' });
  const r = runScan(doc, { mutations: 0 });
  check('a fake window present at first scan is still caught',
    r.warned.length === 1 && /google\.com/.test(r.warned[0].shown || ''),
    JSON.stringify(r.warned.map((w) => w.shown)));
}
{
  // inserted after load, found via the mutation path rather than a full rescan
  const doc = makeDoc(300, null);
  const r = runScan(doc, { mutations: 2 });
  const late = makeDoc(0, { position: 'fixed' }).win;
  doc.body.add(late);
  r.observerCb([{ type: 'childList', addedNodes: [late] }]);
  for (const t of r.timers.splice(0)) { try { t.fn(); } catch (_) {} }
  check('a window inserted after load is still caught',
    r.warned.length === 1, JSON.stringify(r.warned.map((w) => w.shown)));
}
{
  // already in the DOM, restyled into a window later -- an attribute change
  const doc = makeDoc(300, { position: 'static' });
  const r = runScan(doc, { mutations: 2 });
  check('a static container is not warned about', r.warned.length === 0);
  doc.win.position = 'fixed';
  r.observerCb([{ type: 'attributes', target: doc.win, attributeName: 'style' }]);
  for (const t of r.timers.splice(0)) { try { t.fn(); } catch (_) {} }
  check('restyling it into a window IS caught',
    r.warned.length === 1,
    'attributes were not observed at all before this fix, so a late restyle was found only by luck');
}

/* ---- 3. the guarantees the finding said not to lose ----------------------------- */

console.log('  -- preserved guarantees --');
const GUARD = SRC.slice(SRC.indexOf('      const FW_CONTROL='), SRC.indexOf('6e4)', SRC.indexOf('      const FW_CONTROL=')));
check('the forty-run safety cap is still there', /\+\+fwRuns>40\)return/.test(GUARD));
check('the observer still covers the whole subtree', /subtree:!0/.test(GUARD));
check('attribute changes are now observed too', /attributeFilter:\["style","class"\]/.test(GUARD));
check('the password-field correlation is unchanged', /fwCredentialInside\(el\)/.test(GUARD));
check('the identity-provider frame rule is unchanged', /provider&&fwFrameInside\(el\)/.test(GUARD));
check('the foreign-address test is unchanged', /regDomain\(shown\)!==fwHost/.test(GUARD));
check('the prefilter is exactly the decisive gate, so nothing detectable is dropped',
  /fwCouldBeWindow=el=>/.test(GUARD)
  && /input\[type="password"\][^)]*iframe/.test(GUARD));
check('reads are batched before any decision', /const boxes=shortlist\.map/.test(GUARD));
check('clicks still queue a pass', /"click"/.test(GUARD));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all fake-window scan-cost checks passed');

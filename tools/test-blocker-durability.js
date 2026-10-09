/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* A blocked page may remove or spoof MAIN-world overlay nodes. Verify each
   blocker retains its own node identity and remounts without a timer or retry
   cap. Exercise the shipped function rather than a copied implementation. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function liftMountBlocker(source) {
  const start = source.indexOf('mountBlocker=(id,');
  if (start < 0) throw new Error('mountBlocker not found');
  let depth = 0;
  for (let j = source.indexOf('{', start); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  throw new Error('mountBlocker braces unbalanced');
}
const FN = liftMountBlocker(SRC);

// A DOM with only what mountBlocker touches. isConnected is the property the fix turns on, so it
// is modelled honestly rather than stubbed true.
function makeDom() {
  const byId = new Map();
  const observers = [];
  const notify = () => { for (const o of observers) if (o.live) o.cb(); };
  function El(tag) {
    this.tagName = tag; this.id = ''; this.textContent = ''; this.children = []; this.__in = false; this.__wo = false;
    Object.defineProperty(this, 'isConnected', { get() { return this.__in; } });
  }
  El.prototype.appendChild = function (c) { this.children.push(c); c.__in = true; if (c.id) byId.set(c.id, c); notify(); return c; };
  El.prototype.remove = function () { this.__in = false; if (this.id && byId.get(this.id) === this) byId.delete(this.id); notify(); };
  El.prototype.setAttribute = function () {};
  const documentElement = new El('html');
  const head = new El('head');
  return {
    El, byId, documentElement,
    document: {
      documentElement, head,
      get body() { return null; },
      createElement: (t) => new El(t),
      getElementById: (id) => byId.get(id) || null,
    },
    MutationObserver: class { constructor(cb) { this.cb = cb; this.live = false; } observe() { this.live = true; observers.push(this); } disconnect() { this.live = false; } },
    observerLive: () => observers.some((o) => o.live),
    plantDecoy(id) { const e = new El('div'); e.id = id; e.__in = true; byId.set(id, e); return e; },
  };
}

function mount(dom, id) {
  const frames = [];
  const sandbox = {
    document: dom.document,
    MutationObserver: dom.MutationObserver,
    setTimeout: (fn, ms) => { frames.push({ fn, at: ms }); return frames.length; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { frames.push({ fn, at: 0 }); return frames.length; },
    cancelAnimationFrame: () => {},
    __woObserver: (cb) => new dom.MutationObserver(cb),
    __woLastOverlay: null,
    WO: {},
    console,
  };
  vm.createContext(sandbox);
  // Stands in for buildOverlay: creates the host, records it, appends it. Recording is the whole
  // mechanism -- it is how mountBlocker learns which node is its own.
  sandbox.__paint = () => {
    const h = dom.document.createElement('div');
    h.id = id; h.__wo = true;
    sandbox.__woLastOverlay = h;
    dom.documentElement.appendChild(h);
  };
  vm.runInContext('var mountBlocker=' + FN.replace(/^mountBlocker=/, '') + ';var stop=mountBlocker(' + JSON.stringify(id) + ',__paint);', sandbox);
  return {
    sandbox,
    tick() { const due = frames.splice(0, frames.length); for (const f of due) f.fn(); },
    onScreen: () => dom.document.getElementById(id),
    styleUp: () => !!dom.document.getElementById(id + '-style'),
  };
}

const ID = 'rg-phish-block';

// ---------------------------------------------------------------------------
// 1. Removing the overlay in a loop must never win, however long the loop runs.
// ---------------------------------------------------------------------------
{
  const dom = makeDom();
  const m = mount(dom, ID);
  check('control: a benign page keeps its block screen', !!m.onScreen() && m.styleUp());

  for (let i = 0; i < 500; i++) {
    const o = m.onScreen(); if (o) o.remove();
    m.tick();
  }
  const el = m.onScreen();
  check('500 removals later the block screen is still up', !!el, 'the page won');
  check('and it is still WardenOne\'s own node', !!(el && el.__wo));
  check('and the page is still hidden behind it', m.styleUp());
  check('the watcher is still watching', dom.observerLive(), 'the self-heal retired');
}

// ---------------------------------------------------------------------------
// 2. Waiting must not help. This was the simplest attack of the three: no race, no loop.
// ---------------------------------------------------------------------------
{
  const dom = makeDom();
  const m = mount(dom, ID);
  for (let i = 0; i < 2000; i++) m.tick();           // well past any ten-second retirement
  check('the watcher has not retired on a timer', dom.observerLive());

  const o = m.onScreen(); if (o) o.remove();
  m.tick();
  const el = m.onScreen();
  check('a single removal after a long wait is repaired', !!el, 'wait-then-remove still wins');
  check('the repaired node is WardenOne\'s', !!(el && el.__wo));
}

// ---------------------------------------------------------------------------
// 3. A decoy carrying our id must not suppress the real warning, and must never end up as the
//    only visible element on a page WardenOne has hidden.
// ---------------------------------------------------------------------------
{
  const dom = makeDom();
  dom.plantDecoy(ID);                                 // page ships <div id="rg-phish-block">
  const m = mount(dom, ID);
  const el = m.onScreen();
  check('a pre-planted decoy does not suppress the real warning', !!(el && el.__wo),
    'paint never ran; the element on screen belongs to the page');
  check('the page is not hidden in favour of the decoy alone',
    !(m.styleUp() && !(el && el.__wo)),
    'WardenOne hid the page and left the attacker element as the only thing visible');
}

// ---------------------------------------------------------------------------
// 4. Static shape, in the shipped build: the two surrender mechanisms are gone for good.
// ---------------------------------------------------------------------------
{
  const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const shipped = codeOnly(liftMountBlocker(MIN));
  check('no repair cap in the shipped blocker', !/remounts/.test(shipped));
  check('no watcher timeout in the shipped blocker', !/setTimeout/.test(shipped));
  check('the shipped blocker checks identity, not id', /hostEl&&hostEl\.isConnected/.test(shipped));
  check('the shipped blocker holds its stylesheet too', /styleEl&&styleEl\.isConnected/.test(shipped));
}

if (failed) { console.error('\n' + failed + ' blocker-durability check(s) failed'); process.exit(1); }
console.log('\nthe blocked page cannot remove, outlast or impersonate its own block screen');

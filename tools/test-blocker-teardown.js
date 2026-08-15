/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A dismissed blocker must give the page back.
 *
 * The full-page blockers -- the adult gate, the redirect-chain gate, the phishing block, the
 * IP-logger warning -- work by installing a stylesheet that hides every element on the page and
 * paints the body near-black, then drawing themselves on top of it. So that stylesheet outliving
 * its overlay is not a cosmetic problem: it is a black screen with nothing on it and no way back,
 * on a page the user chose to continue to.
 *
 * Reported from live use: continuing past the age gate on an adult site left the page black
 * forever, and the site's own age prompt never appeared -- it was there, hidden by our stylesheet.
 *
 * Run: node tools/test-blocker-teardown.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// A DOM fake with the parts the blocker actually touches, plus a frame queue that can be run by
// hand -- the defect lives entirely in when a queued frame runs relative to teardown.
function makeDom() {
  const byId = new Map();
  const frames = [];
  let nextFrameId = 1;
  const node = (tag) => {
    const n = {
      tagName: String(tag).toUpperCase(),
      id: '',
      children: [],
      textContent: '',
      appendChild(c) { this.children.push(c); c.parent = this; if (c.id) byId.set(c.id, c); return c; },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
        if (this.id && byId.get(this.id) === this) byId.delete(this.id);
      },
    };
    return n;
  };
  const document = {
    createElement: node,
    getElementById: (id) => byId.get(id) || null,
    // Registered by appendChild via the id map; head/documentElement are just hosts.
  };
  document.documentElement = node('html');
  document.head = node('head');
  return {
    document,
    frames,
    requestAnimationFrame(fn) { const id = nextFrameId++; frames.push({ id, fn }); return id; },
    cancelAnimationFrame(id) { const i = frames.findIndex((f) => f.id === id); if (i >= 0) frames.splice(i, 1); },
    runFrames() { const queued = frames.splice(0); queued.forEach((f) => f.fn()); return queued.length; },
    register(el) { if (el.id) byId.set(el.id, el); },
  };
}

function loadBlocker(options = {}) {
  // Declared first so paint() can read a flag a test flips after the mount.
  const bundle = { paintFails: false };
  const dom = makeDom();
  const state = { painted: 0, observers: [], timeouts: 0 };
  const sandbox = {
    console, Object, String, Number,
    document: dom.document,
    requestAnimationFrame: dom.requestAnimationFrame,
    cancelAnimationFrame: dom.cancelAnimationFrame,
    setTimeout: () => { state.timeouts++; return 1; },
    clearTimeout: () => {},
    WO: {},
    __woObserver: (fn) => {
      const o = { fn, connected: false, observe() { this.connected = true; }, disconnect() { this.connected = false; } };
      state.observers.push(o);
      return o;
    },
  };
  vm.createContext(sandbox);
  const from = ENGINE.indexOf('    mountBlocker=(id,');
  const to = ENGINE.indexOf('\n    if(WO.gateAdultSites', from);
  if (from < 0 || to <= from) throw new Error('mountBlocker source markers not found');
  vm.runInContext('const ' + ENGINE.slice(from, to).replace(/;\s*$/, '') + ';'
    + '\nthis.__mount = mountBlocker;', sandbox, { filename: 'src/content.js' });

  // The overlay a real paint() would build: an element carrying the blocker's id. It also records
  // the node in __woLastOverlay, because that is what buildOverlay does and it is how mountBlocker
  // learns which element is its own -- an id lookup would answer for a page-planted decoy too.
  // A paint that throws records nothing, which is the case the black-screen checks below rely on.
  const paint = () => {
    state.painted++;
    if (options.paintThrows || bundle.paintFails) throw new Error('paint failed');
    const host = dom.document.createElement('div');
    host.id = options.id || 'rg-adult-gate';
    sandbox.__woLastOverlay = host;
    dom.document.documentElement.appendChild(host);
  };
  bundle.dom = dom;
  bundle.state = state;
  bundle.sandbox = sandbox;
  bundle.paint = paint;
  bundle.mount = () => sandbox.__mount(options.id || 'rg-adult-gate', paint);
  return bundle;
}

const styleUp = (b) => !!b.dom.document.getElementById((b.opts || 'rg-adult-gate') + '-style');
const overlayUp = (b) => !!b.dom.document.getElementById('rg-adult-gate');

// ---------------------------------------------------------------------------
// 1. The reported failure: continue, with a frame already queued.
// ---------------------------------------------------------------------------
{
  const b = loadBlocker();
  const teardown = b.mount();
  check('the blocker starts with both its stylesheet and its overlay',
    !!b.dom.document.getElementById('rg-adult-gate-style') && overlayUp(b));

  // The page behind the gate keeps loading, so the observer fires and queues a frame.
  b.state.observers.forEach((o) => o.fn());
  check('a page mutation queues a self-heal frame', b.dom.frames.length === 1);

  // The user chooses to continue.
  teardown();
  check('teardown removes the overlay', !overlayUp(b));
  check('teardown removes the stylesheet', !b.dom.document.getElementById('rg-adult-gate-style'));

  // The frame that was already queued now runs. This is the whole bug.
  const ran = b.dom.runFrames();
  check('the queued frame is cancelled rather than left to fire', ran === 0, ran + ' frames ran');
  check('the page is not left hidden behind a resurrected stylesheet',
    !b.dom.document.getElementById('rg-adult-gate-style'),
    'the stylesheet came back with no overlay -- a black screen with nothing on it');
  check('and the blocker does not reappear over a page the user chose to continue to',
    !overlayUp(b));
}

// ---------------------------------------------------------------------------
// 2. Belt and braces: even a frame that somehow runs must not leave the style alone.
// ---------------------------------------------------------------------------
{
  const b = loadBlocker();
  const teardown = b.mount();
  b.state.observers.forEach((o) => o.fn());
  const queued = b.dom.frames.slice();
  teardown();
  // Run it anyway, as if the cancel had not taken -- a different browser, a different frame API.
  queued.forEach((f) => f.fn());
  check('a self-heal that runs after teardown still leaves the page visible',
    !b.dom.document.getElementById('rg-adult-gate-style'));
}

// ---------------------------------------------------------------------------
// 3. The other way the style could end up alone: a repaint that throws.
// ---------------------------------------------------------------------------
{
  const b = loadBlocker({ paintThrows: true });
  b.mount();
  check('a blocker whose paint throws installs no stylesheet either',
    !b.dom.document.getElementById('rg-adult-gate-style'),
    'the page would be hidden with nothing drawn over it');
}

// ---------------------------------------------------------------------------
// 3b. The same invariant mid-life: the page tears the blocker off, the self-heal fires, and the
//     repaint throws. The stylesheet must not be left holding the page down on its own.
// ---------------------------------------------------------------------------
{
  const b = loadBlocker();
  b.mount();
  b.state.observers.forEach((o) => o.fn());
  // Now make every further repaint fail, and let a hostile page remove both.
  b.paintFails = true;
  b.dom.document.getElementById('rg-adult-gate').remove();
  b.dom.document.getElementById('rg-adult-gate-style').remove();
  b.state.observers.forEach((o) => o.fn());
  b.dom.runFrames();
  // The invariant is "never a stylesheet with nothing drawn over it", not "the stylesheet is
  // gone". Those were the same assertion while a failed repaint meant no overlay. They are not
  // any more: the blocker holds the node it built, so a page tearing it off is repaired by
  // re-appending that node -- paint never runs, and paintFails never comes into it. Restoring the
  // warning is the better outcome, so the check is written against the invariant it always meant.
  check('a self-heal whose repaint fails does not leave the stylesheet alone',
    !b.dom.document.getElementById('rg-adult-gate-style')
      || !!b.dom.document.getElementById('rg-adult-gate'),
    'the page would be held down by a stylesheet with nothing drawn over it');
}

// ---------------------------------------------------------------------------
// 4. The self-heal still works while the blocker is up -- the whole point of it.
// ---------------------------------------------------------------------------
{
  const b = loadBlocker();
  b.mount();
  // A hostile page removes both.
  b.dom.document.getElementById('rg-adult-gate').remove();
  b.dom.document.getElementById('rg-adult-gate-style').remove();
  b.state.observers.forEach((o) => o.fn());
  b.dom.runFrames();
  check('a blocker torn off the page by the site puts itself back', overlayUp(b));
  check('and its stylesheet with it', !!b.dom.document.getElementById('rg-adult-gate-style'));
}

// ---------------------------------------------------------------------------
// 5. Teardown is idempotent and leaves nothing armed.
// ---------------------------------------------------------------------------
{
  const b = loadBlocker();
  const teardown = b.mount();
  teardown();
  teardown();
  b.state.observers.forEach((o) => o.fn());
  b.dom.runFrames();
  check('tearing down twice is harmless',
    !overlayUp(b) && !b.dom.document.getElementById('rg-adult-gate-style'));
  check('the observer is disconnected', b.state.observers.every((o) => !o.connected));
  check('and the page is unfrozen', b.sandbox.WO.__frozen === false);
}

// Every full-page blocker shares this mount, so the fix reaches all of them.
['rg-adult-gate', 'rg-interstitial', 'rg-phish-block', 'rg-grabber-warn'].forEach((id) => {
  check(id + ' still goes through the shared blocker mount', ENGINE.includes('mountBlocker("' + id + '"'));
});

if (failed) { console.error('\n' + failed + ' blocker teardown check(s) failed'); process.exit(1); }
console.log('\na dismissed blocker gives the page back');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A child frame pays for what it needs, not for what the top frame needs (PERF-02).
 *
 * The finding modelled the per-frame cost from bytes -- 298 KiB of source into every child
 * frame -- and an earlier assessment measured compile alone and found 3 ms a frame, the best
 * safe saving 0.43 ms, and stopped. The browser fixture (tools/measure-frame-cost.js) then
 * measured the real thing: about 13 ms of main-thread time and 0.7 MiB per child frame, of
 * which delivery was 0.7 ms and initialisation the rest. Two pieces of that initialisation
 * were doing top-frame work in every frame:
 *
 *   - anti-redirect.js installed the confirm-bait sweep -- a subtree observer and seven timed
 *     passes of elementFromPoint, each forcing layout -- in every frame, including the ad slot
 *     and the tracking pixel, where no dialog can fit and nothing is ever found. It now
 *     installs in a child frame only once the frame is dialog-sized, and a resize listener
 *     arms it the moment a small frame grows into one, because that is the overlay-ad shape.
 *   - bridge.js opened a second channel to the worker at document_start in every frame just
 *     to fetch the reader's hidden-element rules. They ride along with the config answer now;
 *     the separate request survives only for a refresh after the list is edited.
 *
 * Measured together, interleaved, five runs: 20 frames 350 -> 280 ms of script, 100 frames
 * 2,350 -> 1,225 ms and a load event 800 ms sooner. What is asserted here is the behaviour
 * those numbers rest on, run from the shipped source with the frame stubbed either way.
 *
 * Run: node tools/test-frame-aware-init.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const AR = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
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

/* ---- 1. the bait sweep, in a frame of each size ----------------------------------- */

const BAIT = between(AR, '  // ---- confirm-bait sweep: installed per document', '\n  /* CREDENTIAL_FRAME_GUARD_START', 'the bait sweep install');

function frame({ top, width, height }) {
  const state = { observers: 0, timers: [], resize: null, observed: null };
  const win = { innerWidth: width, innerHeight: height };
  const ctx = {
    console: { warn() {} }, Set, Array, Object, Math, Number, String,
    TOP_FRAME: !!top,
    window: win,
    document: { documentElement: { tag: 'html' } },
    woObserver: (cb) => { state.observers++; return { observe: (target, opts) => { state.observed = opts; }, disconnect() {} }; },
    woTimeout: (fn, ms) => { state.timers.push(ms); return state.timers.length; },
    woOn: (target, type, fn) => { if (type === 'resize') state.resize = fn; },
    BAIT_REMOVE_CAP: 25, baitRemoved: 0, baitPending: new Set(),
    confirmBaitEnabled: () => true, sweepConfirmBait() {}, scheduleConfirmBaitSweep() {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(BAIT, ctx);
  return { state, win, ctx };
}

{
  const { state } = frame({ top: true, width: 300, height: 200 });
  check('the top frame installs the sweep unconditionally, even in a small window',
    state.observers === 1 && state.timers.length === 7 && state.observed && state.observed.subtree === true, JSON.stringify(state));
  check('and needs no resize listener', state.resize === null);
}
{
  const { state } = frame({ top: false, width: 300, height: 250 });
  check('a 300x250 child frame -- an ad slot -- installs nothing', state.observers === 0 && state.timers.length === 0, JSON.stringify(state));
  check('but listens for resize', typeof state.resize === 'function');
}
{
  const { state } = frame({ top: false, width: 1, height: 1 });
  check('a 1x1 child frame installs nothing', state.observers === 0 && state.timers.length === 0);
}
{
  const { state } = frame({ top: false, width: 800, height: 600 });
  check('a dialog-sized child frame installs the sweep at once', state.observers === 1 && state.timers.length === 7);
  check('and the timers are the seven passes they always were', state.timers.join(',') === '120,350,800,2000,4000,8000,15000', state.timers.join(','));
}
{
  const { state, win } = frame({ top: false, width: 1, height: 1 });
  win.innerWidth = 1200; win.innerHeight = 900;
  state.resize();
  check('a frame that grows into a dialog gets the sweep on resize', state.observers === 1 && state.timers.length === 7, JSON.stringify(state));
  state.resize();
  state.resize();
  check('and only once, however often it resizes', state.observers === 1 && state.timers.length === 7);
}
{
  const { state, ctx } = frame({ top: false, width: 800, height: 600 });
  ctx.installConfirmBaitSweep();
  ctx.installConfirmBaitSweep();
  check('the installer itself refuses to run twice, whoever calls it', state.observers === 1 && state.timers.length === 7,
    'the resize listener checks too, but the guard has to hold without it');
}
{
  const { state, win } = frame({ top: false, width: 399, height: 299 });
  check('just under the threshold installs nothing', state.observers === 0);
  win.innerWidth = 400; win.innerHeight = 300;
  state.resize();
  check('and exactly the threshold installs', state.observers === 1);
}
check('the thresholds are what the comment says', /const BAIT_FRAME_MIN_W = 400;/.test(AR) && /const BAIT_FRAME_MIN_H = 300;/.test(AR));
check('the grid\'s own small-viewport guard is still there', /if \(w < 150 \|\| h < 120\) return found;/.test(AR),
  'the two gates are different things: one decides whether to install, the other whether a pass samples');

/* ---- 2. hidden rules ride with the config ----------------------------------------- */

check('bridge no longer fetches hidden rules at start-up',
  !/\n  bridgeLoadUserHidden\(\);\n/.test(BRIDGE),
  'a second document_start channel from every frame, for a list that is usually empty');
check('it still refreshes them when the reader edits the list',
  /if \(!msg \|\| msg\.kind !== 'hidden-rules-refresh'\) return;\n    bridgeLoadUserHidden\(\);/.test(BRIDGE));
check('and applies the rules that arrive with the config',
  /if \(Array\.isArray\(res\.hidden\) && res\.hidden\.length\) bridgeApplyUserHidden\(res\.hidden\);\n\s*sendConfig\(res\.overrides \|\| \{\}\);/.test(BRIDGE));
check('the refresh path and the config path share one applier',
  /bridgeApplyUserHidden\(res\.inherited\);/.test(BRIDGE) && /function bridgeApplyUserHidden\(list\)/.test(BRIDGE));

/* run the applier */
{
  const APPLY = between(BRIDGE, '  function bridgeSafeUserSelector(value) {', '\n  /* The initial rules arrive with the config', 'the hidden applier');
  const doc = { styles: [], head: { appendChild(el) { doc.styles.push(el); } }, documentElement: {},
    querySelector() { return doc.styles[0] || null; }, querySelectorAll() { return []; },
    createElement() { const el = { attrs: {}, textContent: '', setAttribute(k, v) { el.attrs[k] = v; } }; return el; } };
  const ctx = { console: { warn() {} }, Array, String, RegExp, document: doc };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(APPLY + '\nglobalThis.apply = bridgeApplyUserHidden;', ctx);
  ctx.apply(['#ad-banner', '.promo', 'div{}bad', 'html', 'x'.repeat(500)]);
  check('the applier writes one style element with the safe selectors',
    doc.styles.length === 1 && doc.styles[0].textContent === '#ad-banner{display:none!important;}.promo{display:none!important;}', doc.styles[0] && doc.styles[0].textContent);
  check('and refuses the unsafe ones', !/bad|html\{|xxxx/.test(doc.styles[0].textContent));
}

/* ---- 3. the worker answers both in one message ----------------------------------- */

check('the config handler names the asking frame\'s host from sender.url',
  /new URL\(String\(\(sender && sender\.url\) \|\| ''\)\)\.hostname/.test(between(BG, "kind === 'content-config-get'", 'return true;', 'the config-get handler')));
{
  const SNAP = between(BG, 'async function buildContentConfigSnapshot(frameHost) {', '\nlet __contentConfigRefreshTimer', 'the snapshot builder');
  const calls = [];
  const ctx = {
    console: { warn() {} }, Array, Object, String, Promise,
    localGet: async () => ({ wardenone_config: { enabled: true } }),
    SUPPLEMENTAL_LIST_STORAGE_KEY: 'sup',
    sanitizeContentConfig: (c) => c, sanitizeLearnedForContent: () => [], sanitizeSupplementalLists: () => ({}), sanitizeSearchJunkForContent: () => [],
    readHiddenElements: async () => { calls.push('read'); return { 'shop.example': ['#promo', '.cookie-bar'] }; },
    hiddenSelectorsForHost: (all, host) => (host === 'shop.example' || host.endsWith('.shop.example')) ? all['shop.example'] : [],
  };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(SNAP + '\nglobalThis.build = buildContentConfigSnapshot;', ctx);
  (async () => {
    const a = await ctx.build('www.shop.example');
    check('a frame on the site gets its hidden rules with the config', Array.isArray(a.hidden) && a.hidden.join(',') === '#promo,.cookie-bar', JSON.stringify(a.hidden));
    const b = await ctx.build('ads.example');
    check('a cross-origin frame gets its own (empty) rules, not the top page\'s', Array.isArray(b.hidden) && b.hidden.length === 0);
    calls.length = 0;
    const c = await ctx.build('');
    check('no host, no lookup', Array.isArray(c.hidden) && c.hidden.length === 0 && calls.length === 0);
    check('the separate hidden-list kind still exists for the popup and the refresh', /kind === 'hidden-list' && msg\.hostname/.test(BG));

    console.log('');
    if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
    console.log('all frame-aware init checks passed');
  })();
}

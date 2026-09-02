/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Two findings, one shape: state kept on the side stopped matching reality.
 *
 *   M1: the badge counter lived only in the worker, and MV3 suspends the worker after ~30s idle.
 *       Chrome keeps the badge TEXT, our counter came back absent, so the next block on a page
 *       showing 47 set the badge to 1 -- wrong in the direction that undersells the product.
 *   M5: Memory Shield's two veto flags latched. formDirty was set by the first keystroke in any
 *       field, including a site search box, and nothing ever set it false. mediaActive was cleared
 *       only from a track 'ended' listener, and MediaStreamTrack.stop() does not dispatch 'ended'.
 *       On a single-page app one keystroke exempted the tab for the whole session.
 *
 * Both are fixed the same way: ask the authoritative source at query time instead of trusting a
 * cached copy. For M5 the protective direction matters more than the permissive one -- this guard
 * is what stops the extension discarding a tab holding unsaved work -- so the "still protected"
 * cases are tested harder than the "now eligible" ones.
 *
 * Run with:
 *   node tools/test-stale-state.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

function sourceBetween(src, a, b) {
  const start = src.indexOf(a);
  assert(start >= 0, 'missing marker: ' + a);
  const end = src.indexOf(b, start + a.length);
  assert(end > start, 'missing marker after ' + a + ': ' + b);
  return src.slice(start, end);
}

// ===========================================================================
// M1: the badge count survives a worker suspension.
//
// This used to drive a model that read the count back out of the toolbar with
// chrome.action.getBadgeText and held in-flight tabs in a `badgeRecovering` map.
// That model is gone: the counts are now mirrored into chrome.storage.session,
// which survives a worker sleep and is cleared with the browser session -- the
// same lifetime as the tab IDs the counts are keyed by. Parsing the visible text
// was the thing worth removing, because a tab with no block override shows the
// GLOBAL unread badge, so "7 unread" could come back as "8 blocked".
//
// The guarantees below are the ones that model owes, not the old one's markers:
// nothing is lost while recovery is in flight, what was stored comes back, and
// counts for tabs that no longer exist do not.
// ===========================================================================
function loadBadge(options) {
  const opts = options || {};
  const written = [];
  const session = Object.assign({}, opts.session || {});
  const reads = [];
  const sandbox = {
    Number, Object, String, Math, JSON, console,
    // Held rather than run: the 3s belt-and-braces finish must not pre-empt the
    // storage read the test is deliberately holding open.
    setTimeout: (fn) => { sandbox.__timers.push(fn); return sandbox.__timers.length; },
    counts: Object.create(null),
    chrome: {
      runtime: { lastError: null },
      action: {
        setBadgeText: (o) => { written.push(o); },
        setBadgeBackgroundColor() {},
      },
      storage: {
        session: {
          // Deferred, like the real async call, so operations land in the gap.
          get: (key, cb) => { reads.push(() => cb({ [key]: session[key] })); },
          set: (items, cb) => { Object.assign(session, items); if (cb) cb(); },
        },
      },
      tabs: {
        query: (_q, cb) => cb((opts.openTabs || []).map((id) => ({ id }))),
      },
    },
  };
  sandbox.__timers = [];
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween(BG, 'function setBadge(tabId) {', 'const TOKEN_EXFIL_HISTORY_COOLDOWN_MS'),
    sandbox, { filename: 'background.js:badge' });
  return {
    sandbox,
    written,
    session,
    begin: () => vm.runInContext('beginBadgeCountRecovery()', sandbox),
    bump: (tabId) => vm.runInContext('bumpBadge(' + tabId + ')', sandbox),
    remove: (tabId) => vm.runInContext('removeBadge(' + tabId + ')', sandbox),
    // Let the held storage read answer, which is what finishes recovery.
    settle: () => { const q = reads.splice(0); q.forEach((f) => f()); },
    count: (tabId) => vm.runInContext('counts[' + tabId + ']', sandbox),
    ready: () => vm.runInContext('badgeCountsReady', sandbox),
  };
}

{
  // A block that lands before recovery has answered must not be dropped.
  const b = loadBadge({ openTabs: [7] });
  b.begin();
  b.bump(7);
  check('a block during recovery is not counted yet', b.count(7) === undefined,
    'counts[7]=' + b.count(7));
  check('and nothing is painted from a half-known state', b.written.length === 0,
    b.written.length + ' writes');
  b.settle();
  check('once recovery answers, the queued block is applied', b.count(7) === 1,
    'counts[7]=' + b.count(7));
  check('and the badge is painted', b.written.some((w) => w.tabId === 7 && w.text === '1'),
    JSON.stringify(b.written));
}

{
  // What storage.session held comes back, and later blocks add to it.
  const b = loadBadge({ session: { __wardenone_badge_counts: { 7: 5 } }, openTabs: [7] });
  b.begin();
  b.settle();
  check('a stored count is recovered', b.count(7) === 5, 'counts[7]=' + b.count(7));
  b.bump(7);
  check('and counting continues from it', b.count(7) === 6, 'counts[7]=' + b.count(7));
}

{
  // Tab IDs are reused. A count for a tab that closed while the worker slept
  // must not be handed to whatever tab inherits that ID.
  const b = loadBadge({
    session: { __wardenone_badge_counts: { 7: 5, 99: 3 } },
    openTabs: [7],
  });
  b.begin();
  b.settle();
  check('a count for a tab that is still open survives', b.count(7) === 5);
  check('a count for a tab that is gone is dropped', b.count(99) === undefined,
    'counts[99]=' + b.count(99));
}

{
  // Zero writes null, not '': an empty string is a tab-scoped blank that masks
  // the global unread badge, which is exactly what this model exists to keep separate.
  const b = loadBadge({ openTabs: [7] });
  b.begin();
  b.settle();
  b.bump(7);
  b.remove(7);
  vm.runInContext('setBadge(7)', b.sandbox);
  const last = b.written.filter((w) => w.tabId === 7).pop();
  check('an emptied badge is cleared with null, not a blank string',
    last && last.text === null, JSON.stringify(last));
}

// ===========================================================================
// M5: the veto flags are computed, not latched.
// ===========================================================================
function loadVeto(fields) {
  const sandbox = {
    Array, Object, String, Set, Math, console,
    document: {
      querySelectorAll: () => fields || [],
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween(BRIDGE, '  const FORM_SCAN_CAP = 4000;', '  // Streams captured in THIS world')
    + '\nthis.__ask = pageHasUnsavedInput;',
    sandbox, { filename: 'bridge.js:form-dirty' });
  return () => sandbox.__ask();
}

function input(type, props) {
  return Object.assign({
    tagName: 'INPUT', type, value: '', defaultValue: '',
    checked: false, defaultChecked: false, isContentEditable: false,
  }, props || {});
}

{
  // The protective direction first, and hardest: genuine unsaved input must still be protected.
  const protective = [
    ['typed text', [input('text', { value: 'hello' })]],
    ['typed into a textarea', [{ tagName: 'TEXTAREA', value: 'draft', defaultValue: '' }]],
    ['edited a pre-filled field', [input('text', { value: 'changed', defaultValue: 'original' })]],
    ['typed a password', [input('password', { value: 'secret' })]],
    ['ticked a checkbox', [input('checkbox', { checked: true, defaultChecked: false })]],
    ['unticked a pre-ticked checkbox', [input('checkbox', { checked: false, defaultChecked: true })]],
    ['chose a file', [input('file', { files: [{ name: 'a.pdf' }] })]],
    ['changed a dropdown', [{
      tagName: 'SELECT',
      options: [{ selected: false, defaultSelected: true }, { selected: true, defaultSelected: false }],
    }]],
    ['wrote in a contenteditable', [{ tagName: 'DIV', isContentEditable: true, textContent: 'a draft' }]],
    ['one dirty field among many clean ones', [
      input('text'), input('text'), input('text', { value: 'typed' }), input('text'),
    ]],
  ];
  for (const [label, fields] of protective) {
    check('protected: ' + label, loadVeto(fields)() === true);
  }

  // A field that throws when inspected is unknown, so it must protect.
  check('protected: a field that throws when read', loadVeto([{
    tagName: 'INPUT',
    get type() { throw new Error('hostile getter'); },
  }])() === true);

  // More fields than the scan cap is also unknown.
  const many = [];
  for (let i = 0; i < 4001; i++) many.push(input('text'));
  check('protected: more fields than the scan cap', loadVeto(many)() === true);
}

{
  // The permissive direction: the cases the latch got wrong.
  const eligible = [
    ['no fields at all', []],
    ['an empty search box', [input('search')]],
    ['typed then cleared', [input('text', { value: '' })]],
    ['a pre-filled field left untouched', [input('text', { value: 'preset', defaultValue: 'preset' })]],
    ['an untouched checkbox', [input('checkbox')]],
    ['an untouched dropdown', [{
      tagName: 'SELECT',
      options: [{ selected: true, defaultSelected: true }, { selected: false, defaultSelected: false }],
    }]],
    ['an empty contenteditable', [{ tagName: 'DIV', isContentEditable: true, textContent: '   ' }]],
    ['a submit button', [input('submit', { value: 'Send' })]],
    ['a hidden field carrying a token', [input('hidden', { value: 'csrf-abc' })]],
    ['a file input with nothing chosen', [input('file', { files: [] })]],
  ];
  for (const [label, fields] of eligible) {
    check('eligible: ' + label, loadVeto(fields)() === false);
  }
}

{
  // Media: live capture protects, stopped capture does not -- without relying on 'ended'.
  const sandbox = { Array, Object, Set, console };
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween(BRIDGE, '  const liveStreams = new Set();', '  // Honest scope: page scripts')
    + '\nthis.__live = pageHasLiveCapture; this.__streams = liveStreams;',
    sandbox, { filename: 'bridge.js:media' });

  const stream = (states) => ({ getTracks: () => states.map((s) => ({ readyState: s })) });
  check('media: no capture reads as idle', sandbox.__live() === false);

  sandbox.__streams.add(stream(['live']));
  check('media: a live track protects the tab', sandbox.__live() === true);

  sandbox.__streams.clear();
  // stop() leaves tracks 'ended' without ever dispatching the event.
  sandbox.__streams.add(stream(['ended', 'ended']));
  check('media: stopped tracks read as idle even though "ended" never fired',
    sandbox.__live() === false);
  check('media: dead streams are pruned from the set', sandbox.__streams.size === 0,
    'size=' + sandbox.__streams.size);

  sandbox.__streams.clear();
  sandbox.__streams.add(stream(['ended', 'live']));
  check('media: one live track among ended ones still protects', sandbox.__live() === true);

  sandbox.__streams.clear();
  sandbox.__streams.add({ getTracks() { throw new Error('gone'); } });
  check('media: a stream that throws is treated as idle and dropped',
    sandbox.__live() === false && sandbox.__streams.size === 0);
}

check('the reply computes both answers rather than reading flags',
  /formDirty: pageHasUnsavedInput\(\)/.test(BRIDGE)
  && /mediaActive: pageHasLiveCapture\(\) \|\| relayMediaActive/.test(BRIDGE));
check('no latched formDirty variable survives', !/let formDirty = false;/.test(BRIDGE));
check('no latched mediaActive variable survives', !/let mediaActive = false;/.test(BRIDGE));

// The engine half: it must stop depending on 'ended' to report inactive.
check('the engine reports media-inactive from a self-clearing poll',
  /woMediaPoll=__woInterval\(/.test(SRC) && /woMediaIdle\(\)&&clearInterval\(woMediaPoll\)/.test(SRC));
check('...and it survived the build',
  MIN.includes('woMediaIdle') && MIN.includes('clearInterval(woMediaPoll)'));
check('the engine still honours "ended" as the fast path',
  /addEventListener\("ended",\s*\(\)=>\{\s*woMediaIdle\(\)/.test(SRC));

if (failures) {
  console.error('[fail] stale-state tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] stale-state tests passed');

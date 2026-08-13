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
// M1: the badge recovers its count from Chrome after a worker suspension.
// ===========================================================================
function loadBadge(options) {
  const opts = options || {};
  const written = [];
  const sandbox = {
    Number,
    Object,
    String,
    parseInt,
    console,
    counts: Object.create(null),
    chrome: {
      runtime: { lastError: null },
      action: {
        setBadgeText: ({ tabId, text }) => { written.push({ tabId, text }); },
        setBadgeBackgroundColor() {},
        getBadgeText: ({ tabId }, cb) => {
          // Deferred, like the real async call, so concurrent blocks land in the gap.
          const answer = Object.prototype.hasOwnProperty.call(opts.badges || {}, tabId)
            ? opts.badges[tabId] : '';
          (sandbox.__queue = sandbox.__queue || []).push(() => cb(answer));
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween(BG, 'function setBadge(tabId) {', '// Tabs whose count we are recovering')
    + sourceBetween(BG, '// Tabs whose count we are recovering', '\n\nfunction messageHostFromText')
      .replace(/^[\s\S]*?const badgeRecovering/, 'const badgeRecovering'),
    sandbox, { filename: 'background.js:badge' });
  return {
    sandbox,
    bump: (tabId) => vm.runInContext('bumpBadge(' + tabId + ')', sandbox),
    drain: () => { const q = sandbox.__queue || []; sandbox.__queue = []; q.forEach((f) => f()); },
    count: (tabId) => vm.runInContext('counts[' + tabId + ']', sandbox),
    written,
  };
}

{
  // A tab we already know about: no round trip, straight increment.
  const b = loadBadge({ badges: { 7: '47' } });
  vm.runInContext('counts[7] = 3', b.sandbox);
  b.bump(7);
  check('a tab already counted increments without asking Chrome',
    b.count(7) === 4 && (b.sandbox.__queue || []).length === 0, 'count=' + b.count(7));
}

{
  // The finding's case: worker resumed, counts empty, Chrome still shows 47.
  const b = loadBadge({ badges: { 7: '47' } });
  b.bump(7);
  check('nothing is written before Chrome has answered',
    b.written.length === 0, JSON.stringify(b.written));
  b.drain();
  check('the count continues from the badge instead of restarting at 1',
    b.count(7) === 48, 'count=' + b.count(7));
  check('...and the badge shows it',
    b.written.length === 1 && b.written[0].text === '48', JSON.stringify(b.written));
}

{
  // Blocks arriving during the round trip must not be lost, and must not each recover.
  const b = loadBadge({ badges: { 7: '10' } });
  b.bump(7);
  b.bump(7);
  b.bump(7);
  check('concurrent blocks start only one recovery',
    (b.sandbox.__queue || []).length === 1, 'queued=' + (b.sandbox.__queue || []).length);
  b.drain();
  check('every block during the gap is counted', b.count(7) === 13, 'count=' + b.count(7));
}

{
  // A genuinely new tab, and a navigation reset, must not inherit anything.
  const b = loadBadge({ badges: {} });
  b.bump(9);
  b.drain();
  check('a tab with no badge starts at 1', b.count(9) === 1, 'count=' + b.count(9));

  const reset = loadBadge({ badges: { 9: '31' } });
  vm.runInContext('counts[9] = 0', reset.sandbox);
  reset.bump(9);
  check('a navigation reset to 0 does not recover the old number',
    reset.count(9) === 1 && (reset.sandbox.__queue || []).length === 0, 'count=' + reset.count(9));
}

{
  // Per-tab isolation.
  const b = loadBadge({ badges: { 1: '5', 2: '99' } });
  b.bump(1);
  b.bump(2);
  b.drain();
  check('tabs recover independently',
    b.count(1) === 6 && b.count(2) === 100, b.count(1) + ' / ' + b.count(2));
}

{
  // Junk badge text must not poison the count.
  // '1e9' parses as 1 in base 10 -- parseInt stops at the 'e' -- which is the conservative answer
  // and the one we want. We only ever write plain integers, so this is defence against a value
  // that should not exist rather than a case to support.
  for (const [text, expected] of [['', 1], ['abc', 1], ['-4', 1], ['1e9', 2], ['12x', 13]]) {
    const b = loadBadge({ badges: { 3: text } });
    b.bump(3);
    b.drain();
    check('badge text ' + JSON.stringify(text) + ' -> ' + expected,
      b.count(3) === expected, 'got ' + b.count(3));
  }
}

{
  // A tab can close while getBadgeText is still in flight. onRemoved clears both maps, and the
  // callback used to fall back to `|| 1` and put the entry straight back -- leaking a counter for
  // a tab that no longer exists, for the rest of the worker's life.
  const b = loadBadge({ badges: { 7: '20' } });
  b.bump(7);
  check('a recovery is in flight', (b.sandbox.__queue || []).length === 1);

  // What chrome.tabs.onRemoved does.
  vm.runInContext('delete counts[7]; delete badgeRecovering[7];', b.sandbox);
  b.drain();

  check('a tab closing mid-recovery does not resurrect its counter',
    b.count(7) === undefined, 'counts[7]=' + JSON.stringify(b.count(7)));
  check('...and no badge is written for the closed tab',
    b.written.length === 0, JSON.stringify(b.written));
}

{
  // The whole start-up ordering, not just the helper.
  //
  // Every check above lifts bumpBadge on its own, and that is why they all passed while the badge
  // was still wrong in a real worker: at module evaluation the worker walked every tab and called
  // setBadge while counts was empty, writing '' and destroying the number bumpBadge was about to
  // recover from. The helper produced 48; the real ordering produced ["", "1"] and finished at 1.
  //
  // So this runs both pieces in the order the worker does.
  const written = [];
  const queue = [];
  const sandbox = {
    Number, Object, String, parseInt, console,
    counts: Object.create(null),
    chrome: {
      runtime: { lastError: null },
      tabs: { query: (_q, cb) => cb([{ id: 7 }]) },
      action: {
        setBadgeText: ({ tabId, text }) => { written.push({ tabId, text }); },
        setBadgeBackgroundColor() {},
        // Chrome's retained value for a tab that was showing 47 before the worker slept.
        getBadgeText: ({ tabId }, cb) => queue.push(() => cb(tabId === 7 ? '47' : '')),
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween(BG, 'function setBadge(tabId) {', '// Tabs whose count we are recovering')
    + sourceBetween(BG, '// Tabs whose count we are recovering', '\n\nfunction messageHostFromText')
      .replace(/^[\s\S]*?const badgeRecovering/, 'const badgeRecovering')
    // The seed block sits after messageHostFromText, so it needs its own end marker.
    + '\n' + sourceBetween(BG, '// Seed the counters from what Chrome', '\n\nchrome.runtime.onMessage.addListener'),
    sandbox, { filename: 'background.js:startup' });

  // Start-up runs, then its badge reads come back.
  const startup = queue.splice(0, queue.length);
  startup.forEach((f) => f());

  check('start-up writes nothing to the badge',
    written.length === 0, JSON.stringify(written));
  check('start-up seeds the counter from what Chrome was showing',
    vm.runInContext('counts[7]', sandbox) === 47, 'counts[7]=' + vm.runInContext('counts[7]', sandbox));

  // Now a block arrives on that tab.
  vm.runInContext('bumpBadge(7)', sandbox);
  queue.splice(0, queue.length).forEach((f) => f());

  check('the next block continues from 47 rather than restarting',
    vm.runInContext('counts[7]', sandbox) === 48,
    'counts[7]=' + vm.runInContext('counts[7]', sandbox));
  check('...and the badge never showed a blank or a 1',
    written.length === 1 && written[0].text === '48', JSON.stringify(written));
}

check('all three increment sites go through the helper',
  (BG.match(/bumpBadge\(/g) || []).length >= 4
  && !/counts\[\w+(\.\w+)?\] = \(counts\[/.test(BG),
  'bumpBadge uses=' + (BG.match(/bumpBadge\(/g) || []).length);
check('an in-flight recovery is dropped when the tab closes',
  /delete badgeRecovering\[tabId\];/.test(BG));

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

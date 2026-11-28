/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* The overlay cleaner decides modal shape from geometry before it reads innerText, which lays out the whole subtree
   (TechRadar, 2026-11-27: 188 ms of one load). Fuzzed against the same classifier without that early exit, the
   verdict never changes and text is read only for boxes that can still be hidden.
   Run: node tools/test-overlay-classifier-cost.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

function between(start, end) {
  const from = CONTENT.indexOf(start);
  const to = CONTENT.indexOf(end, from + start.length);
  assert.ok(from !== -1 && to !== -1, 'missing source marker: ' + start);
  return CONTENT.slice(from, to);
}
const PLAYER = between('const PLAYER_ROUTE_RE=', '\n    !function(){');
const OVERLAY = between('mediaRectState={', 'CONTINUE_TEXT=');
const EARLY_EXIT = /\n\s*if\(!\(z>=20\|\|r\.width\*r\.height>=innerWidth\*innerHeight\*\.45\|\|[^\n]*\)\)return!1;/;
assert.ok(EARLY_EXIT.test(OVERLAY), 'the modal shape early exit is gone or reworded; update this test with it');
const textReadIndex = OVERLAY.indexOf('el.innerText||el.textContent', OVERLAY.indexOf('isOverlay=el=>'));
assert.ok(OVERLAY.search(EARLY_EXIT) < textReadIndex, 'the modal shape check must come before the text read');

function classifier(source) {
  const player = { location: { pathname: '/' }, document: { querySelector: () => null } };
  vm.createContext(player);
  installEngineAmbient(player);
  vm.runInContext(PLAYER + '\nthis.__p = { PLAYER_SHELL_SELECTOR, playerShellFor, playerFrameworkShellFor };', player);
  const box = {
    mediaRectState: null, mediaRects: null, mediaHitFor: null, fakeNotifyVisual: null, overlayCandidate: null,
    hasLoginUi: null, isOverlay: null, seen: new WeakSet(),
    PROTECT: /(password|sign[\s-]?in|checkout|payment)/i,
    AD_SIGNAL: /(advertisement|sponsored|ad\s*choices|skip ad)/i,
    NUISANCE: /(cookie|consent|subscribe|adblock)/i,
    BAIT_SIGNAL: /(notification|download now|watch now)/i,
    innerWidth: 1280, innerHeight: 720, Date, Math, Number, parseInt, parseFloat, Set, WeakSet, Array, String, RegExp,
    PLAYER_SHELL_SELECTOR: player.__p.PLAYER_SHELL_SELECTOR, playerShellFor: player.__p.playerShellFor,
    playerFrameworkShellFor: player.__p.playerFrameworkShellFor,
    document: { body: {}, documentElement: {}, querySelectorAll() { return []; } },
    getComputedStyle: (node) => node._style,
  };
  vm.createContext(box);
  installEngineAmbient(box);
  vm.runInContext(source + 'null; this.__classify = isOverlay;', box);
  return box.__classify;
}
const shipped = classifier(OVERLAY);
const reference = classifier(OVERLAY.replace(EARLY_EXIT, ''));

let seed = 20261127;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
const pick = (list) => list[rand(list.length)];
const TEXTS = ['', 'Advertisement', 'Sponsored offer, skip ad', 'Allow notifications to watch now', 'Subscribe to our newsletter',
  'We use cookies', 'Sign in to continue', 'Download now', 'Breaking news: the match report', 'x', 'Play video'];
const CLASSES = ['', 'modal', 'ad-slot', 'notif-bell', 'player-ad-overlay', 'cookie-banner', 'hero', 'push-prompt', 'video-player'];

function node(textReads) {
  const w = pick([20, 50, 64, 120, 200, 240, 300, 380, 700, 1200, 1280]);
  const h = pick([20, 48, 70, 90, 120, 200, 280, 400, 600, 720]);
  const left = rand(1280 - Math.min(w, 1279)), top = pick([-800, -50, 0, 100, 300, 500, 700, 900]);
  const text = pick(TEXTS);
  const attrs = { role: pick([null, null, 'dialog', 'button']), 'aria-modal': pick([null, null, 'true']), 'aria-label': pick([null, 'Close', 'Advertisement']) };
  const inShell = !rand(5);
  const hasClose = !rand(3);
  const n = {
    nodeType: 1, tagName: pick(['DIV', 'DIV', 'SECTION', 'ASIDE', 'A', 'SPAN']), id: pick(['', '', 'overlay', 'wo-badge', 'promo']),
    className: pick(CLASSES), onclick: rand(4) ? null : () => {}, parentElement: null,
    get innerText() { textReads.count++; return text; },
    textContent: text,
    _style: {
      display: pick(['block', 'block', 'none']), visibility: pick(['visible', 'visible', 'hidden']), opacity: pick(['1', '1', '0']),
      position: pick(['fixed', 'absolute', 'sticky', 'static', 'relative']), zIndex: pick(['auto', '0', '5', '10', '20', '999', '2147483647']),
      borderRadius: pick(['0', '50%', '24px']), borderTopLeftRadius: '0', borderTopRightRadius: '0', borderBottomLeftRadius: '0',
      borderBottomRightRadius: '0', backgroundColor: pick(['rgba(0, 0, 0, 0)', 'rgb(20,20,20)', 'transparent', 'red']), cursor: pick(['auto', 'pointer']),
    },
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    getBoundingClientRect: () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h }),
    closest: (selector) => (inShell && String(selector).includes('[data-player]') ? {} : null),
    querySelector: (selector) => {
      const s = String(selector);
      if (s.includes('[class*="play" i]')) return inShell ? {} : null;
      if (s.includes('main')) return rand(8) ? null : {};
      if (s.includes('password')) return rand(10) ? null : {};
      return rand(3) ? null : {};
    },
    querySelectorAll: (selector) => (hasClose && String(selector).includes('[class*="close" i]') ? [{
      nodeType: 1, tagName: 'BUTTON', id: '', className: 'close', innerText: 'x', textContent: 'x', getAttribute: () => null,
      getBoundingClientRect: () => ({ left: left + w - 30, top: top + 4, right: left + w - 4, bottom: top + 30, width: 26, height: 26 }),
    }] : []),
    matches: () => false,
  };
  return n;
}

let compared = 0, positives = 0, skippedReads = 0;
for (let i = 0; i < 16000; i++) {
  const reads = { count: 0 }, refReads = { count: 0 };
  const state = seed;
  const a = shipped(node(reads));
  seed = state;
  const b = reference(node(refReads));
  assert.equal(a, b, 'case ' + i + ': the early exit changed a verdict');
  assert.ok(reads.count <= refReads.count, 'case ' + i + ': the shipped classifier read more text than the reference');
  compared++;
  if (a) positives++;
  skippedReads += refReads.count - reads.count;
}
assert.ok(positives > 50, 'the fuzz reached too few overlays to mean anything: ' + positives);
assert.ok(skippedReads > 50, 'the early exit skipped too few text reads: ' + skippedReads);

/* A carousel slide: absolutely positioned, low z-index, off centre, no dialog role. Its text is never read. */
{
  const reads = { count: 0 };
  seed = 7;
  const slide = node(reads);
  Object.assign(slide._style, { display: 'block', visibility: 'visible', opacity: '1', position: 'absolute', zIndex: '2' });
  slide.getBoundingClientRect = () => ({ left: 20, top: 40, right: 320, bottom: 240, width: 300, height: 200 });
  slide.getAttribute = () => null;
  slide.closest = () => null;
  assert.equal(shipped(slide), false);
  assert.equal(reads.count, 0, 'a positioned box that cannot look modal still had its subtree text read');
}
console.log('[ok] overlay classifier: ' + compared + ' fuzzed boxes, same verdicts (' + positives + ' overlays), ' + skippedReads + ' subtree text reads skipped');

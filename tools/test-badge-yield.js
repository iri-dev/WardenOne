/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The badge must never be the thing standing between someone and a control.
 *
 * It is fixed to the bottom-right corner at the maximum z-index, which is exactly
 * where video and music players put their controls. Reported on YouTube: in
 * fullscreen the badge swallowed the hover and the click that reveal and press the
 * exit button, so getting back out was a fight with the extension.
 *
 * Two outcomes, deliberately different:
 *   player  -> HIDDEN. It sits on a volume slider or a seek bar, and passing the
 *              click through is no comfort when you cannot see what you are dragging.
 *   control -> INERT but visible. Vanishing on every page with something in that
 *              corner would be worse than the problem it solves.
 *
 * This evaluates the shipped functions out of src/content.js rather than a copy.
 *
 * Run: node tools/test-badge-yield.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

const start = source.indexOf('badgeYieldState={at:0');
const end = source.indexOf('alignBadge=()=>{', start);
assert(start >= 0, 'the badge yield block is present in src/content.js');
assert(end > start, 'the badge yield block ends at alignBadge');
/* The slice is a fragment of a comma-separated declarator list and ends on a
   comma, so it becomes a valid declaration by closing it with one more binding. */
/* Match the shipped IIFE. Without strict mode this test allowed undeclared geometry
   bindings that throw in content.min.js, so the real nearby-control check failed
   closed while the copied fragment appeared to work. */
const block = '"use strict"; const ' + source.slice(start, end) + '__end=0;';

const BADGE_RECT = { left: 1200, top: 900, right: 1320, bottom: 940, width: 120, height: 40 };

function makeElement(tag, role) {
  return {
    tag,
    role: role || '',
    closest(selector) {
      return String(selector || '').split(',').some((part) => {
        const token = part.trim();
        return token === this.tag || (this.role && token === '[role="' + this.role + '"]');
      }) ? this : null;
    },
  };
}

function run(options) {
  const opts = options || {};
  const documentElement = { tag: 'html', closest: () => null };
  const body = { tag: 'body', closest: () => null };
  const badgeHost = { contains: (el) => !!(el && el.insideHost) };
  const toggled = {};
  let isAway = false;
  const awayCollapsesLayout = /\.b\.away\{display:none\}/.test(source);
  const calls = { hit: 0, query: 0 };
  const badgeButton = {
    getBoundingClientRect: () => (isAway && awayCollapsesLayout
      ? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
      : (opts.rect === undefined ? BADGE_RECT : opts.rect)),
    classList: { toggle(name, on) { toggled[name] = !!on; if (name === 'away') isAway = !!on; } },
  };
  const sandbox = {
    Date, Math, String, Object, Array, Number,
    /* The yield check keys its cache on viewport size, so the sandbox needs one.
       opts.viewport lets a test change it and prove the cache is invalidated. */
    window: { innerWidth: (opts.viewport || 1920), innerHeight: 1080 },
    PLAYER_SHELL_SELECTOR: '[data-player],[data-video],[id="player" i],[class~="player" i]',
    badgeHost,
    badgeButton,
    document: {
      documentElement,
      body,
      fullscreenElement: opts.fullscreen ? {} : null,
      elementsFromPoint: opts.noApi ? undefined : (() => { calls.hit++; return opts.stack || []; }),
      /* Controls sitting NEAR the badge rather than under it. Spotify's volume slider
         is beside the badge, not beneath it, so nothing shows up in elementsFromPoint. */
      querySelectorAll: () => { calls.query++; return (opts.nearby || []).map((rect) => ({
        getBoundingClientRect: () => rect,
      })); },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { filename: 'src/content.js:badge-yield' });
  vm.runInContext('globalThis.__r={kind:badgeCoversPageControl(),fs:badgeInFullscreen()};'
    + 'updateBadgeYield(true);', sandbox, { filename: 'probe' });
  return { result: sandbox.__r, toggled, calls, sandbox, vm };
}

/* The reported case: a player's own control sitting under the badge. */
const shell = run({ stack: [makeElement('[data-player]')] });
assert.strictEqual(shell.result.kind, 'player', 'a player shell under the badge is a player');
assert.strictEqual(shell.toggled.away, true,
  'and the badge gets out of the way entirely -- inert is not enough over a slider');
assert.strictEqual(shell.toggled.inert, true, 'and takes no input on the way out');

/* An ordinary button: inert, but still visible. */
const button = run({ stack: [makeElement('button')] });
assert.strictEqual(button.result.kind, 'control', 'a plain button under the badge is a control');
assert.strictEqual(button.toggled.inert, true, 'so the click lands where it was aimed');
assert.strictEqual(button.toggled.away, false,
  'but the badge stays visible -- the reader still wants to see the guard is running');

const roled = run({ stack: [makeElement('div', 'button')] });
assert.strictEqual(roled.result.kind, 'control',
  'a div with role=button counts -- players rarely use real buttons');

/* Ordinary page content must NOT disable the badge, or it would be permanently
   inert on any page whose bottom-right corner happens to be occupied. */
const plain = run({ stack: [makeElement('div')] });
assert.strictEqual(plain.result.kind, '', 'inert page content leaves the badge usable');
assert.strictEqual(plain.toggled.inert, false, 'so the badge keeps taking input');
assert.strictEqual(plain.toggled.away, false, 'and stays where it is');

/* Only the topmost page element decides. A button buried under an opaque div is
   not reachable anyway, and yielding to it would disable the badge for nothing. */
const buried = run({ stack: [makeElement('div'), makeElement('button')] });
assert.strictEqual(buried.result.kind, '',
  'a control behind an opaque element is not the thing the reader is aiming at');

/* The badge's own host is skipped rather than ending the scan -- shadow content
   retargets to the host, so it is always the first hit over the badge itself. */
const ownHost = run({
  stack: [{ insideHost: true, tag: 'span', closest: () => null }, makeElement('button')],
});
assert.strictEqual(ownHost.result.kind, 'control',
  "the badge's own element must not mask the control underneath it");

/* Fullscreen: the page owns the whole screen and the badge cannot be dismissed. */
const fs1 = run({ fullscreen: true, stack: [makeElement('div')] });
assert.strictEqual(fs1.result.fs, true, 'fullscreen is detected');
assert.strictEqual(fs1.toggled.away, true, 'and the badge is hidden outright');
assert.strictEqual(fs1.toggled.inert, true, 'and inert, so nothing is intercepted either');

/* Degrade quietly rather than throwing into the engine. */
const noApi = run({ noApi: true, stack: [makeElement('button')] });
assert.strictEqual(noApi.result.kind, '', 'no elementsFromPoint means no opinion');
const collapsed = run({ rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } });
assert.strictEqual(collapsed.result.kind, '', 'a collapsed badge tests nothing');

/* THE ACCUMULATION BUG. Each check costs three elementsFromPoint plus up to forty
   getBoundingClientRect calls. The hover re-check was added with force=true, which
   bypasses the throttle entirely, so crossing the badge five times ran the whole thing
   five times. Reported as: smooth at first, then worse the more it was triggered.
   The answer depends only on layout, so while the viewport is unchanged it is reused. */
{
  const r = run({ nearby: [{ left: 100, right: 200, top: 100, bottom: 120, width: 100, height: 20 }] });
  const afterFirst = r.calls.hit + r.calls.query;
  assert(afterFirst > 0, 'the first check actually measures something');

  /* Five hover crossings in a row, none forced. */
  for (let i = 0; i < 5; i++) r.vm.runInContext('updateBadgeYield();', r.sandbox, { filename: 'hover' });
  assert.strictEqual(r.calls.hit + r.calls.query, afterFirst,
    'repeated hovers must reuse the answer -- this is the accumulation that made '
    + 'crossing the badge repeatedly degrade');

  /* A forced caller -- resize, fullscreen, a player starting, the load-time one-shots --
     must still recompute, or a player bar mounting late would never be noticed. */
  r.vm.runInContext('updateBadgeYield(true);', r.sandbox, { filename: 'forced' });
  assert(r.calls.hit + r.calls.query > afterFirst,
    'a forced check must always recompute');

  /* And a viewport change invalidates the cache, because layout is what the answer
     depends on. */
  const after = r.calls.hit + r.calls.query;
  r.sandbox.window.innerWidth = 1280;
  r.vm.runInContext('updateBadgeYield();', r.sandbox, { filename: 'resized' });
  assert(r.calls.hit + r.calls.query > after,
    'a changed viewport must invalidate the cached answer');
}

/* The CSS the classes rely on has to exist, or every assertion above is theatre. */
assert(/\.b\.inert\{pointer-events:none\}/.test(source),
  'the inert class must actually remove pointer events');
assert(/\.b\.away\{visibility:hidden;opacity:0;pointer-events:none\}/.test(source),
  'the away class must hide without collapsing the geometry needed by the next check');
assert(/\.b\.away\+\.panel\{display:none\}/.test(source),
  'an open badge panel must leave with the badge');
/* Specificity, not order: .b sets pointer-events:auto and .b.inert must win. */
assert(/\.b\{[^}]*pointer-events:auto/.test(source),
  'the base rule still takes input when nothing is underneath');

/* SITTING NEXT TO a control, which is the case the hit test above cannot see.
   The badge is bottom-right; that is where music players put the volume slider. On
   Spotify the player bar spans the badge's whole band, so nothing is ever underneath
   it while the reader is still reaching past a chip that lights up on hover and takes
   the pointer on the way to the slider. */
{
  /* Badge occupies 1200..1320 x 900..940. This slider sits just below and left of it:
     no overlap at all, but well inside the 32px approach margin. */
  const beside = run({ nearby: [{ left: 1100, right: 1190, top: 950, bottom: 966, width: 90, height: 16 }] });
  assert.strictEqual(beside.toggled.away, true,
    'a control beside the badge must move the badge out of the way');
  assert.strictEqual(beside.toggled.inert, true, 'and stop it taking the pointer');

  /* A scheduled forced recheck runs after the badge has hidden. display:none makes
     getBoundingClientRect() return zero, which used to make that second check falsely
     conclude the slider had gone and bring the badge straight back. */
  beside.vm.runInContext('updateBadgeYield(true);', beside.sandbox, { filename: 'forced-hidden-recheck' });
  assert.strictEqual(beside.toggled.away, true,
    'a hidden badge must retain its layout rectangle and stay hidden while the slider remains');
}
{
  /* Far away: the badge must not disappear on every page that has a slider somewhere. */
  const far = run({ nearby: [{ left: 100, right: 200, top: 100, bottom: 120, width: 100, height: 20 }] });
  assert.strictEqual(far.toggled.away, false,
    'a control elsewhere on the page is none of the badge\'s business');
  assert.strictEqual(far.toggled.inert, false, 'and must leave the badge usable');
}
{
  /* The reach is asymmetric on purpose: vertically the badge has to clear a whole
     player bar (60-100px tall), horizontally only the control beside it. A single 32px
     margin found Spotify's slider on one window size and missed it on another. */
  const below = run({ nearby: [{ left: 1250, right: 1300, top: 1000, bottom: 1016, width: 50, height: 16 }] });
  assert.strictEqual(below.toggled.away, true,
    'a control 60px BELOW the badge is inside the same player bar and must move it');
  const sideways = run({ nearby: [{ left: 1380, right: 1450, top: 905, bottom: 935, width: 70, height: 30 }] });
  assert.strictEqual(sideways.toggled.away, false,
    'but a control 60px to the SIDE is a different part of the page -- the horizontal '
    + 'reach must stay tight or the badge vanishes on ordinary pages');
}
{
  /* Zero-sized nodes are not controls the reader can reach for. */
  const collapsedNear = run({ nearby: [{ left: 1200, right: 1200, top: 900, bottom: 900, width: 0, height: 0 }] });
  assert.strictEqual(collapsedNear.toggled.away, false,
    'a zero-sized element must not banish the badge');
}

/* THE PERFORMANCE REGRESSION, guarded. elementsFromPoint forces a synchronous
   layout. Driving it from pointer or scroll events meant the check ran while
   someone was dragging Spotify's volume slider, and made that slider feel laggy --
   the check degrading the very control it exists to protect. What sits under the
   badge changes when the PAGE changes, so only page-shaped events may drive it. */
const wiringStart = source.indexOf('!badgeEventsBound){');
const wiringEnd = source.indexOf('const NO_BADGE_TYPES=', wiringStart);
assert(wiringStart > 0 && wiringEnd > wiringStart, 'the badge event wiring moved');
/* Comments stripped first: the code says in prose that it deliberately avoids
   pointermove, and matching that sentence would fail the check it is explaining. */
const wiring = source.slice(wiringStart, wiringEnd).replace(/\/\*[\s\S]*?\*\//g, '');
for (const forbidden of ['pointermove', 'mousemove', 'pointerover', 'scroll', 'setInterval']) {
  assert(!wiring.includes('"' + forbidden + '"'),
    'the badge must not hit-test from ' + forbidden + ' -- it forces layout on every call');
}
assert(wiring.includes('fullscreenchange'), 'entering fullscreen must still re-check');
assert(/"play"/.test(wiring), 'a player starting must still re-check');

console.log('badge yield tests passed (39 assertions)');

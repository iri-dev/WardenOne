/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Media must not be condemned for the crime of being new.
 *
 * scanMedia runs from a MutationObserver callback, which fires BEFORE layout. A media
 * element that was just inserted measures 0x0 however big it is about to be -- and
 * that size test is what decides "hidden" for anything without a controls attribute.
 *
 * Acting there is not a harmless mistake. neutralizeMedia sets autoplay=false and
 * muted=true on the element permanently, and a site that REUSES one media element
 * (YouTube reuses a single hover-preview video for every thumbnail) stays broken for
 * the rest of the page's life after one mis-timed scan. Reported exactly that way:
 * rare to trigger, then every thumbnail grey until reload.
 *
 * This evaluates the shipped functions out of src/content.js and controls the clock.
 *
 * Run: node tools/test-media-scan-timing.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

const start = source.indexOf('isMediaElement=el=>');
const end = source.indexOf('scanMedia=root=>', start);
assert(start >= 0 && end > start, 'the media guard block is where the slice expects it');
/* A fragment of a comma-separated declarator list, ending on a comma. */
const block = 'const ' + source.slice(start, end) + '__end=0;';

function makeMedia(opts) {
  const o = opts || {};
  const el = {
    tagName: o.tag || 'VIDEO',
    hidden: !!o.hiddenAttr,
    controls: false,
    autoplay: o.autoplay !== false,
    muted: false,
    paused: true,
    __size: o.size || { width: 0, height: 0 },
    __style: {
      display: o.display || 'inline',
      visibility: o.visibility || 'visible',
      opacity: o.opacity === undefined ? '1' : o.opacity,
    },
    __paused: 0,
    getBoundingClientRect() { return this.__size; },
    hasAttribute(name) { return name === 'controls' ? this.controls : false; },
    removeAttribute() {},
    pause() { this.__paused++; },
  };
  return el;
}

function run(el, options) {
  const opts = options || {};
  const timers = [];
  const noted = [];
  const sandbox = {
    String, Object, Array, Number, Math, Set, RegExp, console,
    document: { readyState: 'complete' },
    getComputedStyle: (node) => node.__style,
    playerShellFor: () => (opts.inShell ? {} : null),
    mediaRisk: { autoplay: 'autoplay' },
    mediaLogged: new Set(),
    noteMedia: (type, detail) => noted.push({ type, detail }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { filename: 'src/content.js:media-guard' });
  sandbox.__el = el;
  vm.runInContext('considerMedia(__el);', sandbox, { filename: 'probe' });
  return {
    noted,
    timers,
    fireTimers() { timers.splice(0).forEach((t) => t.fn()); },
  };
}

/* THE REPORTED BUG. Measured before layout, sized immediately after. */
{
  const el = makeMedia({ size: { width: 0, height: 0 } });
  const r = run(el);
  assert.strictEqual(r.noted.length, 0,
    'a freshly inserted element must not be neutralised on its pre-layout size');
  assert.strictEqual(el.__paused, 0, 'and must not be paused');
  assert.strictEqual(el.muted, false, 'and must not be muted');
  assert.strictEqual(el.autoplay, true, 'and must keep its autoplay intent for now');
  assert.strictEqual(r.timers.length, 1, 'the verdict is deferred, not dropped');

  /* Layout happens: the preview gets its real size. */
  el.__size = { width: 320, height: 180 };
  r.fireTimers();
  assert.strictEqual(r.noted.length, 0, 'and once it has a size it is left alone for good');
  assert.strictEqual(el.__paused, 0, 'it is never paused');
  assert.strictEqual(el.muted, false,
    'muted is never set -- this is the flag that persists and keeps a reused element broken');
}

/* The guard must still work: something that is genuinely 0x0 after layout is caught. */
{
  const el = makeMedia({ size: { width: 0, height: 0 } });
  const r = run(el);
  assert.strictEqual(r.noted.length, 0, 'not judged immediately');
  r.fireTimers();
  assert.strictEqual(r.noted.length, 1, 'but judged once layout has happened');
  assert.strictEqual(r.noted[0].type, 'blocked_hidden_media', 'and reported as hidden media');
  assert.strictEqual(el.__paused, 1, 'and actually paused');
  assert.strictEqual(el.muted, true, 'and muted');
}

/* Definitive signals involve no measurement, so they need no deferral. Waiting on
   these would give real hidden autoplay a free 250ms of sound. */
for (const [name, opts] of [
  ['display:none', { display: 'none' }],
  ['visibility:hidden', { visibility: 'hidden' }],
  ['opacity:0', { opacity: '0' }],
  ['the hidden attribute', { hiddenAttr: true }],
]) {
  const el = makeMedia(Object.assign({ size: { width: 640, height: 360 } }, opts));
  const r = run(el);
  assert.strictEqual(r.noted.length, 1, name + ' must be acted on immediately');
  assert.strictEqual(r.timers.length, 0, name + ' must not wait for a timer');
  assert.strictEqual(el.__paused, 1, name + ' must be paused at once');
}

/* Recognised players are still exempt whatever the timing. */
{
  const el = makeMedia({ size: { width: 0, height: 0 } });
  const r = run(el, { inShell: true });
  assert.strictEqual(r.noted.length, 0, 'a player shell is exempt');
  assert.strictEqual(r.timers.length, 0, 'and is not even queued for a second look');
}

/* The deferral must be a real wait, not a zero-delay tick that lands in the same
   frame -- which is the whole failure being fixed. */
{
  const el = makeMedia({ size: { width: 0, height: 0 } });
  const r = run(el);
  assert(r.timers[0].ms >= 100,
    'the re-measure must happen after layout, not on the same turn of the loop');
}

console.log('media scan timing tests passed (20 assertions)');

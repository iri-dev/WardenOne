/* Arrange rows support long-press dragging without taking over scrolling or arrow controls. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const start = popup.indexOf('let arrangeDrag = null;');
const end = popup.indexOf('\n(function initPopupSectionOrder()', start);
assert(start >= 0 && end > start, 'arrange drag wiring is available');
assert(html.includes('On touch, hold briefly first.'), 'the touch interaction is explained');
assert(popup.includes("up.className = 'arrange-move';") && popup.includes("down.className = 'arrange-move';"),
  'both arrow buttons remain available');

function fixture() {
  const listeners = { list: {}, document: {} };
  const timers = new Map();
  const commits = [];
  let nextTimer = 0;
  let renders = 0;
  const classes = () => {
    const state = new Set();
    return { add: (name) => state.add(name), remove: (name) => state.delete(name), contains: (name) => state.has(name) };
  };
  const list = {
    rows: [],
    addEventListener(type, handler) { listeners.list[type] = handler; },
    querySelectorAll() { return this.rows; },
    insertBefore(item, before) {
      this.rows.splice(this.rows.indexOf(item), 1);
      const index = before ? this.rows.indexOf(before) : this.rows.length;
      this.rows.splice(index, 0, item);
    },
    appendChild(item) { this.insertBefore(item, null); },
  };
  const items = ['a', 'b', 'c'].map((id) => ({
    dataset: { id }, parentElement: list, classList: classes(),
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { const top = list.rows.indexOf(this) * 40 + 50; return { top, bottom: top + 32, height: 32 }; },
    get nextSibling() { return list.rows[list.rows.indexOf(this) + 1] || null; },
  }));
  list.rows = items.slice();
  const target = (item, kind = 'name') => ({
    closest(selector) {
      if (selector === '.arrange-item') return item;
      if (selector === '.arrange-grip') return kind === 'grip' ? this : null;
      if (selector === '.arrange-move' || selector === '.arrange-move, .arrange-grip') return kind === 'arrow' || (selector.includes('grip') && kind === 'grip') ? this : null;
      return null;
    },
    setPointerCapture() {}, releasePointerCapture() {},
  });
  const document = {
    body: { classList: classes() },
    addEventListener(type, handler) { listeners.document[type] = handler; },
    elementFromPoint(x, y) {
      const item = items[y >= 130 ? 2 : y >= 90 ? 1 : 0];
      return { closest(selector) { return selector === '.arrange-item' ? item : null; } };
    },
  };
  const context = {
    document, window: { innerHeight: 500, scrollBy() {} },
    setTimeout(fn, delay) { assert.equal(delay, 120); const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    popupSectionRuns() { return ['a', 'b', 'c'].map((id) => ({ id })); },
    commitArrangeOrder(order, id) { commits.push({ order: Array.from(order), id }); },
    renderArrangeList() { renders++; },
  };
  context.list = list;
  vm.createContext(context);
  vm.runInContext(popup.slice(start, end) + '\nwireArrangeDrag(list);', context);
  const fire = (surface, type, event) => {
    assert(listeners[surface][type], `${surface} ${type} listener`);
    const delivered = { ...event, type, prevented: false, preventDefault() { this.prevented = true; } };
    listeners[surface][type](delivered);
    return delivered;
  };
  const hold = () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } };
  return { list, items, target, fire, hold, timers, commits, document, get renders() { return renders; } };
}

function pointer(f, type, target, y, pointerType = 'mouse') {
  f.fire(type === 'pointerdown' ? 'list' : 'document', type,
    { target, button: 0, pointerId: 1, pointerType, clientX: 100, clientY: y });
}
function touch(f, type, target, y, count = 1) {
  const point = { identifier: 7, clientX: 100, clientY: y };
  const event = { target, changedTouches: [point], touches: Array(count).fill(point) };
  return f.fire(type === 'touchstart' ? 'list' : 'document', type, event);
}

{
  const f = fixture();
  const row = f.target(f.items[0]);
  pointer(f, 'pointerdown', row, 60);
  assert.equal(f.timers.size, 0, 'mouse dragging has no hold timer');
  pointer(f, 'pointermove', row, 80);
  assert(f.items[0].classList.contains('is-dragging'), 'moving immediately starts the row drag');
  pointer(f, 'pointermove', row, 115);
  pointer(f, 'pointerup', row, 115);
  assert.deepEqual(f.commits, [{ order: ['b', 'a', 'c'], id: 'a' }], 'quick row drag saves the new order');
  assert(!f.document.body.classList.contains('wo-arranging'), 'drag styling is cleared');
}
{
  const f = fixture();
  const arrow = f.target(f.items[0], 'arrow');
  pointer(f, 'pointerdown', arrow, 60);
  assert.equal(f.timers.size, 0, 'arrows never start a drag');
  pointer(f, 'pointerup', arrow, 60);
}
{
  const f = fixture();
  const row = f.target(f.items[0]);
  pointer(f, 'pointerdown', row, 60);
  pointer(f, 'pointerup', row, 60);
  assert.equal(f.commits.length, 0, 'a click alone does not reorder');
}
{
  const f = fixture();
  const grip = f.target(f.items[0], 'grip');
  pointer(f, 'pointerdown', grip, 60);
  assert.equal(f.timers.size, 0, 'dots retain immediate dragging');
  pointer(f, 'pointermove', grip, 115);
  pointer(f, 'pointerup', grip, 115);
  assert.deepEqual(f.commits[0].order, ['b', 'a', 'c']);
}
{
  const f = fixture();
  const row = f.target(f.items[0]);
  touch(f, 'touchstart', row, 60);
  const scrolling = touch(f, 'touchmove', row, 80);
  assert.equal(scrolling.prevented, false, 'early movement must not block scrolling');
  assert.equal(f.timers.size, 0, 'an early touch move leaves native scrolling alone');
  f.hold();
  touch(f, 'touchend', row, 80, 0);
  assert.equal(f.commits.length, 0);
}
{
  const f = fixture();
  const row = f.target(f.items[0]);
  touch(f, 'touchstart', row, 60);
  const jostle = touch(f, 'touchmove', row, 68);
  assert.equal(jostle.prevented, false, 'small movement before the hold remains scrollable');
  f.hold();
  const dragging = touch(f, 'touchmove', row, 115);
  assert.equal(dragging.prevented, true, 'movement after the hold must not scroll the popup');
  touch(f, 'touchend', row, 115, 0);
  assert.deepEqual(f.commits[0].order, ['b', 'a', 'c'], 'touch hold moves the row');
}
{
  const f = fixture();
  const row = f.target(f.items[0]);
  touch(f, 'touchstart', row, 60);
  f.hold();
  touch(f, 'touchmove', row, 115);
  touch(f, 'touchcancel', row, 115, 0);
  assert.equal(f.commits.length, 0, 'cancel does not save a partial drag');
  assert.equal(f.renders, 1, 'cancel restores the displayed order');
}
console.log('[ok] immediate row drag, touch hold, dots, scrolling and cancellation');

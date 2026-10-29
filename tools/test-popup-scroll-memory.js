/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('popup-scroll-memory.js', 'utf8');
const html = fs.readFileSync('popup.html', 'utf8');
const scrollKey = 'wardenone_popup_scroll_memory';
const panelKey = 'wardenone_advanced_providers_open';
const searchKey = 'wardenone_popup_search_memory';
assert(html.indexOf('<script src="popup-scroll-memory.js"></script>') < html.indexOf('</head>'));
assert(!html.includes('wo-popup-restoring'), 'restoring must never hide the popup');
assert(fs.readFileSync('tools/package-allowlist.json', 'utf8').includes('"popup-scroll-memory.js"'));
assert(fs.readFileSync('background.js', 'utf8').includes("'popup-scroll-memory.js'"));

function realm(withSession, options = {}) {
  const values = { ...options.values };
  const mirror = options.mirror || new Map();
  const reads = [], writes = [], scrolls = [], pending = [];
  const listeners = {}, panelListeners = {}, timers = new Map();
  let timerId = 0;
  let anchorTop = options.anchorTop;
  let resized = null;
  let resizeDisconnected = false;
  const element = { scrollTop: 0, scrollHeight: 1000 };
  const control = { id: '', getAttribute() { return 'testAnchor'; }, getClientRects() { return [{}]; },
    getBoundingClientRect() { return { top: anchorTop - element.scrollTop }; } };
  const row = { querySelector() { return control; } };
  const hit = { closest(selector) { return selector === '.row' ? row : null; } };
  const panel = { open: false, addEventListener(name, fn) { panelListeners[name] = fn; } };
  const runtime = { lastError: options.errorRead ? { message: 'Read failed' } : null };
  const storage = {
    get(keys, callback) {
      reads.push(keys);
      if (options.throwRead) throw Error('Read failed');
      const respond = () => callback(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]])));
      if (options.delayRead) pending.push(respond); else respond();
    },
    set(entry) { writes.push(entry); if (!options.dropWrites) Object.assign(values, entry); },
  };
  const sandbox = {
    chrome: { runtime, storage: { session: withSession ? storage : undefined, local: storage } },
    localStorage: {
      getItem(key) { if (options.blockMirror) throw Error('Unavailable'); return mirror.get(key) || null; },
      setItem(key, value) { if (options.blockMirror) throw Error('Unavailable'); mirror.set(key, value); },
    },
    document: {
      scrollingElement: element, body: {}, documentElement: { clientHeight: 400 }, visibilityState: 'visible',
      querySelector(selector) {
        if (selector === '.advanced-providers' && !options.noPanel) return panel;
        return selector === '[data-key="testAnchor"]' && anchorTop !== undefined ? control : null;
      },
      addEventListener(name, fn) { listeners[name] = fn; },
      getElementById() { return null; },
      elementFromPoint() { return anchorTop !== undefined ? hit : null; },
    },
    window: {
      innerHeight: 400, innerWidth: 348, scrollY: 0,
      scrollTo(_x, y) { scrolls.push(y); element.scrollTop = y; },
      addEventListener(name, fn) { listeners[name] = fn; },
    },
    restorePopupSearch(done) { done(); },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resized = fn; } observe() {} disconnect() { resizeDisconnected = true; } },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  vm.runInContext('initPopupScrollMemory(); initAdvancedProvidersMemory(); restorePopupMemoryLayout()', sandbox);
  const run = expression => vm.runInContext(expression, sandbox);
  const flushReads = () => { while (pending.length) pending.shift()(); };
  const flushTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const resize = top => { anchorTop = top; if (resized && !resizeDisconnected) resized(); };
  return { sandbox, values, mirror, reads, writes, scrolls, listeners, panelListeners, panel, element, timers, run, resize, flushReads, flushTimers };
}

for (const withSession of [true, false]) {
  const r = realm(withSession, { delayRead: true });
  r.listeners.wheel();
  r.element.scrollTop = 237;
  r.listeners.scroll();
  assert.equal(JSON.parse(r.mirror.get(scrollKey)).y, 237, 'scroll must be recorded synchronously');
  assert.equal(r.writes.length, 0, 'browser storage writes should remain debounced');
  r.element.scrollTop = 310;
  r.listeners.scroll();
  assert.equal(r.timers.size, 1, 'scroll writes should debounce');
  assert.equal(JSON.parse(r.mirror.get(scrollKey)).y, 310);

  const reopened = realm(withSession, { mirror: r.mirror, delayRead: true });
  assert.equal(reopened.element.scrollTop, 310, 'reopening must use the latest scroll without any closing event or completed storage write');
  assert.deepEqual(reopened.scrolls, [310], 'the saved position must apply synchronously');
  reopened.flushReads();
  reopened.flushTimers();
  assert.deepEqual(reopened.scrolls, [310], 'late data must not reapply an old position');

  r.element.scrollTop = 0;
  r.listeners.pagehide();
  r.listeners.beforeunload();
  r.sandbox.document.visibilityState = 'hidden';
  r.listeners.visibilitychange();
  assert.equal(r.values[scrollKey].y, 310, 'teardown resetting scrollTop must not overwrite the last observed position');
  assert.equal(r.writes.length, 1, 'closing events should deduplicate writes');
  assert.equal(r.timers.size, 0);
  r.listeners.scroll();
  assert.equal(JSON.parse(r.mirror.get(scrollKey)).y, 310, 'a hidden popup must not replace the foreground position');

  reopened.listeners.wheel();
  reopened.element.scrollTop = 0;
  reopened.listeners.scroll();
  assert.equal(JSON.parse(reopened.mirror.get(scrollKey)).y, 0, 'deliberately scrolling to the top must persist');
  assert.equal(realm(withSession, { mirror: reopened.mirror, delayRead: true }).element.scrollTop, 0);

  const legacy = realm(withSession, { delayRead: true, values: { [scrollKey]: { y: 800 }, [panelKey]: { open: true } } });
  legacy.flushReads();
  assert.equal(legacy.panel.open, true);
  assert.equal(legacy.element.scrollTop, 600, 'legacy browser-storage positions should migrate and clamp');
  assert.equal(JSON.parse(legacy.mirror.get(scrollKey)).y, 800);
  assert.equal(legacy.reads.length, 1, 'legacy migration should use one read');
  legacy.panelListeners.toggle();
  assert.equal(legacy.writes.length, 0, 'restoring the disclosure should not write it back');
  legacy.panel.open = false;
  legacy.panelListeners.toggle();
  assert.equal(JSON.parse(legacy.mirror.get(panelKey)).open, false);

  for (const input of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    const cancelled = realm(withSession, { delayRead: true, values: { [scrollKey]: { y: 500 } } });
    cancelled.listeners[input]();
    cancelled.element.scrollTop = 180;
    cancelled.listeners.scroll();
    cancelled.flushReads();
    assert.equal(cancelled.element.scrollTop, 180, input + ' must prevent late restoration');
    assert.equal(JSON.parse(cancelled.mirror.get(scrollKey)).y, 180, 'late reads must preserve a fresh user position');
  }

  for (const entry of [undefined, null, { y: 'invalid' }, { y: -20 }, { y: Infinity }, { y: { toString: null } }, { y: false }]) {
    const invalid = realm(withSession, { values: { [scrollKey]: entry } });
    assert.equal(invalid.element.scrollTop, 0);
    assert.equal(invalid.scrolls.length, 0, 'invalid positions must not move the popup');
  }
  for (const options of [{ throwRead: true }, { errorRead: true }, { delayRead: true, dropWrites: true }]) {
    const cached = new Map([[scrollKey, JSON.stringify({ y: 400 })]]);
    const offline = realm(withSession, { ...options, mirror: cached });
    assert.equal(offline.element.scrollTop, 400, 'cached restoration must work without browser storage');
    offline.listeners.wheel(); offline.element.scrollTop = 250; offline.listeners.scroll();
    assert.equal(realm(withSession, { mirror: cached, delayRead: true }).element.scrollTop, 250);
  }
  const blocked = realm(withSession, { blockMirror: true, values: { [scrollKey]: { y: 450 } } });
  assert.equal(blocked.element.scrollTop, 450, 'browser storage remains a fallback when DOM storage is unavailable');
  const malformed = realm(withSession, { mirror: new Map([[scrollKey, '{broken']]), values: { [scrollKey]: { y: 200 } } });
  assert.equal(malformed.element.scrollTop, 200);
  const absentPanel = realm(withSession, { noPanel: true, values: { [scrollKey]: { y: 300 } } });
  assert.equal(absentPanel.element.scrollTop, 300);

  const anchored = realm(withSession, { anchorTop: 500, mirror: new Map([[scrollKey, JSON.stringify({
    y: 350, anchor: { key: 'testAnchor', offset: 20 },
  })]]) });
  assert.equal(anchored.element.scrollTop, 480, 'the same control must restore even when content above it changed height');
  anchored.resize(560);
  assert.equal(anchored.element.scrollTop, 540, 'loading the site card must retain the saved control at the same viewport offset');
  anchored.listeners.scroll();
  assert.equal(JSON.parse(anchored.mirror.get(scrollKey)).anchor.key, 'testAnchor');
  anchored.listeners.wheel();
  anchored.element.scrollTop = 200;
  anchored.resize(600);
  assert.equal(anchored.element.scrollTop, 200, 'layout corrections must end when the user scrolls');

  for (const anchor of [{ key: '\"]input', offset: 20 }, { id: '<invalid>', offset: 20 },
    { key: 'missingControl', offset: 20 }, { key: 'testAnchor', offset: Infinity }]) {
    const invalid = realm(withSession, { anchorTop: 500, values: { [scrollKey]: { y: 250, anchor } } });
    assert.equal(invalid.element.scrollTop, 250, 'unavailable or malformed anchors must fall back to the saved pixel position');
    invalid.element.scrollTop = 300;
    invalid.resize(560);
    assert.equal(invalid.element.scrollTop, 300, 'an invalid anchor must not create repeated scroll corrections');
  }
}
console.log('[ok] immediate popup restoration, scroll-time recording, fast close, teardown, legacy migration, input cancellation and storage failures');

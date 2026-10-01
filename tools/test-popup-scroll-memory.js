/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('popup-scroll-memory.js', 'utf8');
const html = fs.readFileSync('popup.html', 'utf8');
assert(html.indexOf('<script src="popup-scroll-memory.js"></script>') < html.indexOf('<script src="popup.js"></script>'));
assert(html.indexOf('<script src="popup-scroll-memory.js"></script>') > html.indexOf('<script src="popup-health.js"></script>'));
assert(fs.readFileSync('tools/package-allowlist.json', 'utf8').includes('"popup-scroll-memory.js"'));
assert(fs.readFileSync('background.js', 'utf8').includes("'popup-scroll-memory.js'"));

function realm(withSession = true) {
  const values = {};
  const writes = [];
  const timers = new Map();
  const listeners = {};
  const panelListeners = {};
  let nextTimer = 1;
  const panel = {
    open: false,
    addEventListener(name, fn) { panelListeners[name] = fn; },
  };
  const element = { scrollTop: 0, scrollHeight: 1000 };
  const storage = {
    get(key, callback) { callback({ [key]: values[key] }); },
    set(entry) { Object.assign(values, entry); writes.push(entry); },
  };
  const window = {
    innerHeight: 400,
    scrollY: 0,
    scrollTo(_x, y) { element.scrollTop = y; },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  const document = {
    scrollingElement: element,
    documentElement: { clientHeight: 400 },
    visibilityState: 'visible',
    querySelector(selector) { return selector === '.advanced-providers' ? panel : null; },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  const sandbox = {
    chrome: { storage: { session: withSession ? storage : undefined, local: storage } },
    window,
    document,
    Date,
    Number,
    Math,
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const runTimers = () => {
    let count = 0;
    while (timers.size) {
      assert(++count < 30, 'restore should have bounded retries');
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
    }
  };
  return { sandbox, values, writes, listeners, panelListeners, panel, element, runTimers, timers };
}

for (const withSession of [true, false]) {
  const r = realm(withSession);
  vm.runInContext('initPopupScrollMemory(); initAdvancedProvidersMemory();', r.sandbox);
  assert(r.listeners.scroll && r.listeners.pagehide && r.listeners.beforeunload && r.listeners.visibilitychange);
  assert(r.panelListeners.toggle);

  r.element.scrollTop = 237;
  r.listeners.scroll();
  r.listeners.scroll();
  assert.strictEqual(r.timers.size, 1, 'scroll saves should debounce');
  r.runTimers();
  assert.strictEqual(r.values.wardenone_popup_scroll_memory.y, 237);

  r.values.wardenone_popup_scroll_memory = { y: 800, at: Date.now() };
  vm.runInContext('restorePopupScrollPosition()', r.sandbox);
  const before = r.writes.length;
  vm.runInContext('savePopupScrollPosition()', r.sandbox);
  assert.strictEqual(r.writes.length, before, 'restoring must not overwrite the saved position');
  r.runTimers();
  assert.strictEqual(r.element.scrollTop, 600, 'restored scroll should fit the page');

  r.panel.open = true;
  r.panelListeners.toggle();
  assert.strictEqual(r.values.wardenone_advanced_providers_open.open, true);
  r.runTimers();
  r.values.wardenone_advanced_providers_open = { open: false, at: Date.now() };
  let done = false;
  r.sandbox.done = () => { done = true; };
  vm.runInContext('restoreAdvancedProvidersState(done)', r.sandbox);
  assert.strictEqual(r.panel.open, false);
  const panelWrites = r.writes.length;
  r.panelListeners.toggle();
  assert.strictEqual(r.writes.length, panelWrites, 'restoring must not save the panel state');
  r.runTimers();
  assert(done);
}

console.log('[ok] popup scroll and advanced-provider state persist across sessions');

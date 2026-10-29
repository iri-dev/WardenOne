/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { popupSections } = require('./build-settings-data.js');
const popup = fs.readFileSync('popup.js', 'utf8');
const settings = fs.readFileSync('settings.js', 'utf8');
const html = fs.readFileSync('popup.html', 'utf8');
const key = 'wardenone_popup_section_order';
const plain = value => JSON.parse(JSON.stringify(value));
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert(start >= 0 && end > start, from);
  return source.slice(start, end);
}
const data = {};
vm.runInNewContext(fs.readFileSync('settings-data.js', 'utf8') + ';this.data = SETTINGS_DATA;', data);
const catalog = popupSections(html, popup);
assert.deepEqual(plain(data.data.popupSections), catalog);
assert(catalog.some(section => section.id === 'security-centre'));
assert(catalog.some(section => section.id === 'browser-health'));
const future = popupSections(html.replace('<h2>Privacy cleaner</h2>', '<h2>New section</h2><h2>Privacy cleaner</h2>'), popup);
assert(future.some(section => section.id === 'new-section'), 'new popup sections reach Settings without a second hand-maintained table');
const defaults = catalog.map(section => section.id);
assert.equal(new Set(defaults).size, defaults.length);
const popupResolver = {};
vm.runInNewContext(between(popup, 'function resolvePopupSectionOrder(', '\nfunction applyPopupSectionOrder('), popupResolver);
const old = defaults.filter(id => !['security-centre', 'browser-health'].includes(id)).reverse();
const resolver = { DATA: { popupSections: catalog } };
vm.runInNewContext(between(settings, 'const POPUP_SECTION_ORDER_KEY =', '\nlet sectionOrder ='), resolver);
for (const saved of [undefined, null, {}, [], old, defaults.slice().reverse(), ['browser-health', 'cleaner', 'security-centre'],
  ['cleaner', 'cleaner', null, {}, '__proto__', 'removed-section'], Array(65).fill('removed').concat('cleaner', 'script-shield')]) {
  assert.deepEqual(plain(resolver.resolveSectionOrder(saved)), plain(popupResolver.resolvePopupSectionOrder(saved, defaults, defaults)));
}
assert.deepEqual(plain(resolver.resolveSectionOrder(old)).filter(id => old.includes(id)), old, 'adding sections preserves the saved relative order');

function fixture(surface, fail = false) {
  const calls = [], errors = [], applied = [];
  let pendingRead;
  const context = { POPUP_SECTION_ORDER_KEY: key, POPUP_SECTION_DEFAULT: defaults,
    DATA: { popupSections: catalog }, current: 'arrange',
    chrome: { runtime: { lastError: null }, storage: { local: {
      get(name, callback) { pendingRead = callback; },
      set(value, callback) { calls.push({ set: plain(value) }); finish(callback); },
      remove(name, callback) { calls.push({ remove: name }); finish(callback); },
    } } },
    arrangeStatus(message) { errors.push(message); },
    applyPopupSectionOrder(order) { applied.push(plain(order)); },
    renderPage() {},
    writePopupMemoryMirror() {},
    adjustPopupScrollAnchor() {},
  };
  function finish(callback) {
    context.chrome.runtime.lastError = fail ? { message: 'Quota exceeded' } : null;
    callback(); context.chrome.runtime.lastError = null;
  }
  vm.createContext(context);
  if (surface === 'popup') {
    vm.runInContext(between(popup, 'let popupSectionOrderEdited =', '\nconst ARRANGE_SVG ='), context);
  } else {
    vm.runInContext(between(settings, 'const POPUP_SECTION_ORDER_KEY =', '\nfunction sectionsPanel()'), context);
  }
  const read = between(surface === 'popup' ? popup : settings,
    'chrome.storage.local.get(POPUP_SECTION_ORDER_KEY, (res) => {', '\n    });') + '\n    });';
  vm.runInContext(read, context);
  const edited = defaults.slice().reverse();
  const save = order => {
    context.nextOrder = order;
    vm.runInContext(surface === 'popup' ? 'savePopupSectionOrder(nextOrder)' : 'sectionOrder = nextOrder.slice(); saveSectionOrder()', context);
  };
  save(edited);
  pendingRead({ [key]: defaults });
  if (surface === 'popup') assert.equal(applied.length, 0, 'late popup restore must not replace a user edit');
  else assert.deepEqual(plain(vm.runInContext('sectionOrder', context)), edited, 'late Settings restore must not replace a user edit');
  assert.deepEqual(calls[0], { set: { [key]: edited } });
  if (fail) {
    const message = surface === 'popup' ? errors[0] : vm.runInContext('sectionNote', context);
    assert.match(message, /Could not save.*Quota exceeded/);
  }
  save(defaults);
  assert.deepEqual(calls[1], { remove: key }, 'explicit reset removes the saved order');
}
for (const surface of ['popup', 'settings']) for (const fail of [false, true]) fixture(surface, fail);
console.log('[ok] generated section catalog, upgrade reconciliation, delayed restore, durable writes, reset and visible save failures');

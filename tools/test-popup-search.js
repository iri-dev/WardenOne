/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('popup.js', 'utf8');
const searchBlock = source.match(/;\(function\(\)\{\r?\n  var inp=document\.getElementById\('wo-settings-search'\);[\s\S]*?\r?\n\}\)\(\);/);
assert(searchBlock, 'popup settings-search block must remain discoverable');

class FakeClassList {
  constructor(names) {
    this.names = new Set(names || []);
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.names.has(name) : !!force;
    if (next) this.names.add(name);
    else this.names.delete(name);
    return next;
  }

  remove(name) {
    this.names.delete(name);
  }
}

class FakeElement {
  constructor(options) {
    const opts = options || {};
    this.id = opts.id || '';
    this.tagName = opts.tagName || 'DIV';
    this.textContent = opts.text || '';
    this.value = opts.value || '';
    this.open = !!opts.open;
    this.style = {};
    this.parentElement = null;
    this.previousElementSibling = null;
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.assign({}, opts.attributes || {});
    this.classList = new FakeClassList(opts.classes || []);
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  emit(type) {
    assert(this.listeners[type], this.id + ' must listen for ' + type);
    this.listeners[type]({ target: this });
  }

  focus() {}

  querySelector(selector) {
    if (selector === '.row:not(.wo-hidden)') {
      return this.children.find((child) => child.classList.contains('row') && !child.classList.contains('wo-hidden')) || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector.indexOf('.eyeshield-') >= 0) return eyeSearchChildren.slice();
    return [];
  }
}

const searchInput = new FakeElement({ id: 'wo-settings-search' });
const clearButton = new FakeElement({ id: 'wo-search-clear', tagName: 'BUTTON' });
const resultCount = new FakeElement({ id: 'wo-search-count' });
const noResult = new FakeElement({ id: 'wo-noresult' });

const eyeHeading = new FakeElement({ id: 'eyeshield-title', tagName: 'H2', text: 'EyeShield' });
const eyePanel = new FakeElement({
  id: 'eyeshield-panel',
  tagName: 'SECTION',
  classes: ['eyeshield-panel'],
  text: 'Normal Light Dark Ultra This site brightness 100% Extras contrast saturation warmth grayscale Reset to default',
});
eyePanel.previousElementSibling = eyeHeading;
const eyeModes = eyePanel.append(new FakeElement({ id: 'eyeshield-modes', classes: ['eyeshield-modes'], text: 'Normal Light Dark Ultra' }));
const normalMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Normal', attributes: { 'data-eyeshield-mode': 'off' } }));
const lightMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Light', attributes: { 'data-eyeshield-mode': 'light' } }));
const darkMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Dark', attributes: { 'data-eyeshield-mode': 'dark' } }));
const ultraMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Ultra', attributes: { 'data-eyeshield-mode': 'ultra' } }));
const brightnessLabel = eyePanel.append(new FakeElement({ classes: ['eyeshield-slider-row'], text: 'This site brightness 100%' }));
const brightnessRange = eyePanel.append(new FakeElement({ id: 'eyeshield-brightness', tagName: 'INPUT', classes: ['eyeshield-range'] }));
const extras = eyePanel.append(new FakeElement({ id: 'eyeshield-extras', tagName: 'DETAILS', classes: ['eyeshield-extras'], text: 'Extras contrast saturation warmth grayscale Reset to default' }));
const eyeSearchChildren = [eyeModes, normalMode, lightMode, darkMode, ultraMode, brightnessLabel, brightnessRange, extras];

const interfaceHeading = new FakeElement({ tagName: 'H2', text: 'Interface' });
const interfaceGroup = new FakeElement({ classes: ['card-group'] });
interfaceGroup.previousElementSibling = interfaceHeading;
const interfaceTheme = interfaceGroup.append(new FakeElement({ classes: ['row'], text: 'Theme Light Dark' }));

const rewindDetails = new FakeElement({ tagName: 'DETAILS', classes: ['rewind-drop'], open: false });
const rewindGroup = rewindDetails.append(new FakeElement({ classes: ['card-group'] }));
/* The real row's wording matters here: it carries both 'speed' and 'records', which is how
   a search for 'speech rec' used to land on it. */
const rewindRow = rewindGroup.append(new FakeElement({ classes: ['row'], text: 'Twitch local rewind DVR Buffer length plus speed 1-2x It records the live stream' }));
const micGroup = new FakeElement({ classes: ['card-group'] });
const micHeading = new FakeElement({ tagName: 'H2', text: 'Media Shield' });
micGroup.previousElementSibling = micHeading;
const micRow = micGroup.append(new FakeElement({ classes: ['row'], text: 'Block camera and microphone includes speech recognition which reaches the microphone by a different route' }));

const byId = new Map([
  [searchInput.id, searchInput],
  [clearButton.id, clearButton],
  [resultCount.id, resultCount],
  [noResult.id, noResult],
  [eyeHeading.id, eyeHeading],
  [eyePanel.id, eyePanel],
  [eyeModes.id, eyeModes],
  [brightnessRange.id, brightnessRange],
  [extras.id, extras],
]);

const document = {
  visibilityState: 'visible',
  getElementById(id) { return byId.get(id) || null; },
  addEventListener() {},
  querySelector(selector) {
    if (selector === '.master' || selector === '.top-quick') return null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.row') return [rewindRow, interfaceTheme, micRow];
    if (selector === '.card-group') return [rewindGroup, interfaceGroup, micGroup];
    if (selector === '.group>h2, .eyeshield-panel+h2, #js-shield+h2') return [eyeHeading, interfaceHeading];
    if (selector.indexOf('.eyeshield-mode') >= 0) return eyeSearchChildren.slice();
    return [];
  },
};

const storage = { get() {}, set() {}, remove() {} };
const context = {
  POPUP_SEARCH_KEY: 'wardenone_popup_search_memory',
  clearTimeout() {},
  console,
  Date,
  document,
  popupScrollStore() { return storage; },
  restorePopupSearch() {},
  setTimeout() { return 1; },
  window: { addEventListener() {} },
  $(id) { return document.getElementById(id); },
};

vm.runInNewContext(searchBlock[0], context, { filename: 'popup.js:settings-search' });

searchInput.value = 'dar';
searchInput.emit('input');

assert.strictEqual(resultCount.textContent, '2 results', 'Dark must count EyeShield and Interface once each');
assert(!eyePanel.classList.contains('wo-hidden'), 'Dark must keep the EyeShield panel visible');
for (const control of [normalMode, lightMode, darkMode, ultraMode, brightnessLabel, brightnessRange, extras]) {
  assert(!control.classList.contains('wo-hidden'), 'Dark must keep the compound EyeShield control intact');
}
assert(!interfaceTheme.classList.contains('wo-hidden'), 'Dark must surface the Interface theme row');
assert(rewindDetails.classList.contains('wo-hidden'), 'an unmatched rewind summary must not be orphaned in results');

searchInput.value = 'eyeshield';
searchInput.emit('input');
assert.strictEqual(resultCount.textContent, '1 result', 'EyeShield must not be double-counted through its heading');

searchInput.value = 'twitch';
searchInput.emit('input');
assert(!rewindDetails.classList.contains('wo-hidden'), 'a matching rewind section must be visible');
assert.strictEqual(rewindDetails.open, true, 'search must open a matching collapsed rewind section');

searchInput.value = '';
searchInput.emit('input');
assert(!eyePanel.classList.contains('wo-hidden'), 'clearing search must restore EyeShield');
assert(!rewindDetails.classList.contains('wo-hidden'), 'clearing search must restore the rewind section');
assert.strictEqual(rewindDetails.open, false, 'clearing search must restore the rewind section collapsed state');
assert.strictEqual(resultCount.textContent, '', 'clearing search must clear the result count');

/* Fuzzy matching used to allow two edits from six characters up -- a third of a six-letter
   word. So 'speech' matched 'speed', and because the Twitch rewind row also says 'records',
   a search for 'speech rec' returned it: both tokens 'matched', neither meaningfully. Two
   edits now need a word long enough to survive them. */
searchInput.value = 'speech rec';
searchInput.emit('input');
assert(rewindRow.classList.contains('wo-hidden'),
  'speech must not fuzzy-match speed: the Twitch rewind row is not a speech setting');
assert(!micRow.classList.contains('wo-hidden'),
  'the row that actually mentions speech recognition must still be found');

searchInput.value = 'speech';
searchInput.emit('input');
assert(rewindRow.classList.contains('wo-hidden'), 'speech alone must not reach the rewind row either');

/* The other half: real typos must still work, or the fix has traded one annoyance for a
   worse one. Each of these is a single edit from a word in the microphone row. */
for (const typo of ['microphon', 'recogniton', 'camra']) {
  searchInput.value = typo;
  searchInput.emit('input');
  assert(!micRow.classList.contains('wo-hidden'), 'a one-edit typo must still find its setting: ' + typo);
}

searchInput.value = '';
searchInput.emit('input');

console.log('[ok] popup settings-search grouping checks passed');

/* The current-site card's fold state is a local display preference. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const start = popup.indexOf('function wireSiteDashboard() {');
const end = popup.indexOf('\n}\n\n// The first read', start);
assert(start >= 0 && end > start, 'site dashboard wiring is available');
const wiring = popup.slice(start, end + 2);

function openCard(saved) {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  const writes = [];
  let storageListener;
  const card = {
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
  const fold = {
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, callback) { listeners[name] = callback; },
    title: '',
  };
  const context = {
    navigator: {},
    document: {
      getElementById(id) { return ({ 'site-card': card, 'site-card-fold': fold })[id] || null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    chrome: {
      runtime: {},
      storage: {
        local: {
          get(keys, callback) { callback({ wardenone_site_card_folded: saved }); },
          set(value) { writes.push(value); },
        },
        onChanged: { addListener(callback) { storageListener = callback; } },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`
    const SITE_CARD_LAYOUT_KEY = 'wardenone_site_card_layout';
    const SITE_CARD_FOLD_KEY = 'wardenone_site_card_folded';
    let siteCardLayout = 'A', siteDashLast = null;
    const $ = (id) => document.getElementById(id);
    ${wiring}
    wireSiteDashboard();
  `, context);
  return { card, fold, attributes, listeners, writes, changed: (changes, area) => storageListener(changes, area) };
}

const fresh = openCard(undefined);
assert.equal(fresh.card.classList.contains('is-folded'), false, 'card starts expanded');
assert.equal(fresh.attributes['aria-expanded'], 'true');
fresh.listeners.click();
assert.equal(fresh.card.classList.contains('is-folded'), true, 'button folds card');
assert.equal(fresh.attributes['aria-expanded'], 'false');
assert.equal(fresh.attributes['aria-label'], 'Show the whole site card');
assert.equal(fresh.fold.title, 'Show more');
assert.equal(fresh.writes[0].wardenone_site_card_folded, true, 'fold state is saved');

const reopened = openCard(true);
assert.equal(reopened.card.classList.contains('is-folded'), true, 'saved fold survives reopening');
reopened.listeners.click();
assert.equal(reopened.card.classList.contains('is-folded'), false, 'button expands card');
assert.equal(reopened.attributes['aria-expanded'], 'true');
assert.equal(reopened.writes[0].wardenone_site_card_folded, false, 'expansion is saved');
reopened.changed({ wardenone_site_card_folded: { newValue: true } }, 'local');
assert.equal(reopened.card.classList.contains('is-folded'), true, 'another popup can update the preference');

assert.equal(openCard('true').card.classList.contains('is-folded'), false, 'only a stored boolean folds the card');
assert(/\.site-card\.is-folded \.site-card-stats, \.site-card\.is-folded \.site-card-caption, \.site-card\.is-folded \.site-card-detail \{ display: none !important; \}/.test(html),
  'folding hides the counts and both layout descriptions');
assert(/\.site-card\.is-folded\[data-layout="A"\] \.site-card-status \{ display: inline-flex; \}/.test(html),
  'the compact layout shows the status when folded');
assert(/id="site-card-fold"[^>]*aria-controls="site-card-stats site-card-caption site-card-detail"/.test(html),
  'the toggle identifies all content it controls');
console.log('[ok] site card fold, persistence and accessible state');

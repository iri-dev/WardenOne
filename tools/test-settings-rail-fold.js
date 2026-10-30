/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
/* The Settings side cards fold like the sidebar groups: the whole header toggles, the choice is
   remembered per card, every card starts open, and a reset forgets the folds. Runs the shipped
   settings.js helpers rather than a copy of them. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'settings.html'), 'utf8');
function between(start, end) {
  const from = SOURCE.indexOf(start);
  const to = SOURCE.indexOf(end, from);
  assert(from >= 0 && to > from, 'settings.js markers missing: ' + start);
  return SOURCE.slice(from, to);
}
const FOLD = between('const RAIL_FOLD_KEY', 'function paintNavGroupCounts');
const CARDS = between('const cardHead =', 'const plural =');
const ICON = between('const icon =', '\n');

function load(saved) {
  const store = new Map(saved === undefined ? [] : [['wardenone_settings_rail', saved]]);
  const bodies = new Map();
  const sandbox = {
    JSON, Object, String,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    },
    document: { getElementById: (id) => bodies.get(id) || null },
  };
  vm.createContext(sandbox);
  vm.runInContext(ICON + '\n' + FOLD + '\n' + CARDS + '\nthis.api = { railCard, toggleRailFold };', sandbox);
  return { api: sandbox.api, store, bodies };
}
function header(html) {
  const m = /<button type="button" class="rc-h rc-fold" data-rail-fold="([a-z]+)" aria-expanded="(true|false)" aria-controls="rail-body-\1">/.exec(html);
  assert(m, 'a side card header must be its fold button: ' + html.slice(0, 160));
  return { id: m[1], expanded: m[2] === 'true', bodyHidden: new RegExp('id="rail-body-' + m[1] + '" hidden>').test(html) };
}
function fakeButton(id, expanded) {
  const attrs = { 'aria-expanded': String(expanded) };
  return { dataset: { railFold: id }, getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
}

const fresh = load();
const card = fresh.api.railCard('protected', 'i-bars', 'What’s protected', '14 of 15 on', '<ul class="rlist"></ul>');
let h = header(card);
assert(h.expanded && !h.bodyHidden, 'a side card must start open');
assert(/<h3 class="rc-fold-h"><button/.test(card), 'the fold button must stay inside a heading');
assert(card.includes('<span class="rc-sub">14 of 15 on</span>'), 'the summary line must stay in the header so a folded card still says something');

const body = { hidden: false };
fresh.bodies.set('rail-body-protected', body);
const button = fakeButton('protected', true);
fresh.api.toggleRailFold(button);
assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
assert.strictEqual(body.hidden, true, 'folding must hide the card body');
assert.deepStrictEqual(JSON.parse(fresh.store.get('wardenone_settings_rail')), { protected: true }, 'the fold must be remembered');

const reopened = load(fresh.store.get('wardenone_settings_rail'));
h = header(reopened.api.railCard('protected', 'i-bars', 'What’s protected', '', ''));
assert(!h.expanded && h.bodyHidden, 'a remembered fold must render folded after a reload');
h = header(reopened.api.railCard('related', 'i-sliders', 'Related settings', '', ''));
assert(h.expanded && !h.bodyHidden, 'folding one card must not fold another');

const unfold = fakeButton('protected', false);
reopened.api.toggleRailFold(unfold);
assert.deepStrictEqual(JSON.parse(reopened.store.get('wardenone_settings_rail')), {}, 'unfolding must forget the fold');
for (const junk of ['[1]', '{"protected":"yes"}', 'not json']) {
  h = header(load(junk).api.railCard('protected', 'i-bars', 't', '', ''));
  assert(h.expanded, 'a malformed saved value must leave the card open: ' + junk);
}

/* Wiring: every idle card folds, the click reaches the toggle before the other handlers, the
   reset forgets the folds, and the chevron turns like the sidebar's. */
for (const id of ['search', 'protected', 'recent', 'tip', 'related']) {
  assert(SOURCE.includes("railCard('" + id + "'"), 'the ' + id + ' side card must be foldable');
}
assert(!/<section class="rcard">' \+ cardHead\('i-(?:search|bars|eye|bulb|sliders)'/.test(SOURCE), 'no idle side card may keep a header that cannot fold');
const click = SOURCE.indexOf("const railFold = t.closest('[data-rail-fold]');");
assert(click > 0 && click < SOURCE.indexOf("const navToggle = t.closest('[data-nav-group]');", click), 'the fold click must be routed first');
assert(/NAV_COLLAPSE_KEY, RAIL_FOLD_KEY\]\.forEach\(\(key\) => localStorage\.removeItem\(key\)\)/.test(SOURCE), 'a reset must forget the side-card folds');
assert(/\.rc-fold\[aria-expanded="false"\] \.rc-chev \{ transform: rotate\(180deg\); \}/.test(HTML), 'the folded chevron must turn like the sidebar chevron');

console.log('[ok] settings side cards fold, remember per card, and reset');

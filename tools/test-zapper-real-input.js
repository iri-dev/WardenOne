/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
/* The Element Zapper acts only on the person's own input. On Twitch a page capture listener registered before the
   Zapper could fire a synthetic click mid press: it confirmed the "covers most of the page" warning unseen, and a
   later one hid the cookie dialog backdrop again right after Undo all. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PICKER = fs.readFileSync(path.join(__dirname, '..', 'element-picker.js'), 'utf8');
const between = (from, to) => {
  const start = PICKER.indexOf(from), end = PICKER.indexOf(to, start);
  assert(start > 0 && end > start, 'element-picker.js still has ' + from.trim());
  return PICKER.slice(start, end);
};
let passed = 0;
const check = (name, run) => { run(); passed++; console.log('[ok] ' + name); };

function make(tag, cls, text) {
  return { tag, className: cls, textContent: text || '', children: [], listeners: {},
    appendChild(node) { this.children.push(node); }, setAttribute() {},
    addEventListener(type, listener) { this.listeners[type] = listener; } };
}
const textOf = node => !node ? '' : [node.textContent].concat(node.children.map(textOf)).join(' ');
const find = (node, label) => {
  if (!node) return null;
  if (node.tag === 'button' && node.textContent === label) return node;
  for (const child of node.children) { const found = find(child, label); if (found) return found; }
  return null;
};

function picker() {
  const page = { body: { id: 'body' }, documentElement: { id: 'html' } };
  const state = { selected: [], undone: 0, stopped: 0, panel: null, pointed: null };
  const context = {
    ui: { id: 'ui' }, el: make, frame() {}, keyHints: () => make('div'), hintPanel: () => make('div', null, 'hint'),
    undoAllPanel: () => make('div', null, 'Undo all Zapper changes on this site?'),
    say(panel) { state.panel = panel; }, tooBig: t => t.big === true, matchCount: () => 1, isFragile: () => false,
    looksLikeListItem: () => false, undoTargetIsEditable: () => false, stop() { state.stopped++; },
    undoLatestZapper() { state.undone++; return true; }, zapped: [], lastSaved: [],
    requestAnimationFrame(fn) { fn(); return 1; }, cancelAnimationFrame() {},
    document: Object.assign(page, { elementFromPoint: () => state.pointed }),
  };
  vm.createContext(context);
  vm.runInContext('let current=null,undoAllConfirming=false,undoAllPending=false,confirmBig=null,zapCount=0,latestSeq=0;'
    + between('  function addUndoAllButton(', '  function undoAllPanel(')
    + between('  /* ---- picking', '  function stop() {')
    + ';this.selectTarget=function(t){state.selected.push(t);};'
    + 'this.api={onMove,onClick,onKey,onWheel,addUndoAllButton,current:()=>current,'
    + 'finishUndoAll(){undoAllConfirming=false;}};', Object.assign(context, { state }));
  context.selectTarget = t => state.selected.push(t);
  const event = (trusted, extra = {}) => Object.assign({ isTrusted: trusted, target: {}, clientX: 5, clientY: 5,
    composedPath: () => [], prevented: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() {} }, extra);
  const point = (target, trusted = true) => { state.pointed = target; context.api.onMove(event(trusted)); };
  return { state, api: context.api, event, point };
}

check('a synthetic click is swallowed but selects nothing', () => {
  const p = picker(), small = { name: 'banner' };
  p.point(small);
  const fake = p.event(false);
  p.api.onClick(fake);
  assert.equal(fake.prevented, 1, 'the page still does not get the click while the Zapper is open');
  assert.equal(p.state.selected.length, 0);
  p.api.onClick(p.event(true));
  assert.deepEqual(p.state.selected, [small], 'a real click still hides what is under the pointer');
});

check('a synthetic pointer move cannot choose the target of the next real click', () => {
  const p = picker(), wanted = { name: 'wanted' }, decoy = { name: 'decoy' };
  p.point(wanted);
  p.point(decoy, false);
  assert.equal(p.api.current(), wanted);
  p.api.onClick(p.event(true));
  assert.deepEqual(p.state.selected, [wanted]);
});

check('one real press on a page sized element only warns, even with a synthetic click mid press', () => {
  const p = picker(), backdrop = { name: 'cookie dialog backdrop', big: true };
  p.point(backdrop);
  p.api.onClick(p.event(false));
  assert.equal(p.state.panel, null, 'the synthetic click does not even raise the warning');
  p.api.onClick(p.event(true));
  assert.match(textOf(p.state.panel), /That covers most of the page/);
  assert.equal(p.state.selected.length, 0, 'nothing is hidden on the first real press');
  p.api.onClick(p.event(false));
  assert.equal(p.state.selected.length, 0, 'a synthetic click cannot confirm the warning');
  p.api.onClick(p.event(true));
  assert.deepEqual(p.state.selected, [backdrop], 'a second real press confirms it');
});

check('the warning asks again after Undo all and in a new Zapper run', () => {
  const p = picker(), backdrop = { name: 'backdrop', big: true };
  p.point(backdrop);
  p.api.onClick(p.event(true));
  find(p.state.panel, 'Undo all on this site').listeners.click({ isTrusted: true });
  p.api.finishUndoAll();
  p.api.onClick(p.event(true));
  assert.equal(p.state.selected.length, 0, 'opening Undo all clears the pending confirmation');
  assert.match(textOf(p.state.panel), /That covers most of the page/);
  const next = picker();
  next.point(backdrop);
  next.api.onClick(next.event(true));
  assert.equal(next.state.selected.length, 0, 'a confirmation never carries over to a later run');
  assert.equal(backdrop.__woConfirmedBig, undefined, 'nothing is written onto the page element');
});

check('Hide it anyway hides the warned element', () => {
  const p = picker(), backdrop = { name: 'backdrop', big: true };
  p.point(backdrop);
  p.api.onClick(p.event(true));
  find(p.state.panel, 'Hide it anyway').listeners.click({ isTrusted: true });
  assert.deepEqual(p.state.selected, [backdrop]);
});

check('synthetic keys do nothing; real Enter keeps the two press warning', () => {
  const p = picker(), backdrop = { name: 'backdrop', big: true };
  p.point(backdrop);
  for (const key of ['Enter', 'Escape', 'ArrowUp']) p.api.onKey(p.event(false, { key }));
  p.api.onKey(p.event(false, { key: 'z', ctrlKey: true }));
  assert.deepEqual([p.state.selected.length, p.state.stopped, p.state.undone, p.state.panel], [0, 0, 0, null]);
  p.api.onKey(p.event(true, { key: 'Enter' }));
  assert.match(textOf(p.state.panel), /That covers most of the page/);
  assert.equal(p.state.selected.length, 0);
  p.api.onKey(p.event(true, { key: 'Enter' }));
  assert.deepEqual(p.state.selected, [backdrop]);
  p.api.onKey(p.event(true, { key: 'z', ctrlKey: true }));
  assert.equal(p.state.undone, 1, 'a real Ctrl+Z still undoes');
  p.api.onKey(p.event(true, { key: 'Escape' }));
  assert.equal(p.state.stopped, 1, 'a real Escape still closes the Zapper');
});

check('a synthetic wheel does not widen the selection', () => {
  const p = picker(), child = { name: 'child' }, parent = { name: 'parent' };
  child.parentElement = parent;
  p.point(child);
  p.api.onWheel(p.event(false, { deltaY: -1 }));
  assert.equal(p.api.current(), child);
  p.api.onWheel(p.event(true, { deltaY: -1 }));
  assert.equal(p.api.current(), parent);
});

check('after Done, only a real Ctrl+Z retracts the last saved rule', () => {
  const listeners = [], removed = [], sent = [];
  const element = { removeAttribute: name => removed.push(name) };
  const context = { ZAP_ATTR: 'data-wardenone-zapped',
    undoState: { items: [{ element, hostname: 'www.twitch.tv', selector: '.chat-banner', saveFinished: true, undoRequested: false }], listener: null },
    document: { addEventListener: (type, fn) => listeners.push(fn), removeEventListener() {} },
    chrome: { runtime: { sendMessage: (message, callback) => { sent.push(message); callback(); }, lastError: undefined } } };
  vm.createContext(context);
  vm.runInContext(between('  function undoTargetIsEditable(', '  function registerZapperUndo(') + ';armGlobalUndo();', context);
  assert.equal(listeners.length, 1);
  const key = trusted => ({ isTrusted: trusted, key: 'z', ctrlKey: true, target: { nodeType: 1, tagName: 'DIV', closest: () => null },
    preventDefault() {}, stopImmediatePropagation() {} });
  listeners[0](key(false));
  assert.deepEqual([removed.length, sent.length], [0, 0], 'a page cannot undo the person\'s saved change');
  listeners[0](key(true));
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ kind: 'hidden-remove', hostname: 'www.twitch.tv', selector: '.chat-banner' }]);
});

console.log('Zapper real input: ' + passed + ' checks passed');

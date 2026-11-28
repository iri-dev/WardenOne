/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
/* The Zapper's Undo all after an in-app navigation. Chrome keeps sender.url at the address the
   document loaded with after history.pushState, so an exact URL match refused every press on
   Twitch until the per-tab ceiling answered "Rate limited.". */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadBackground } = require('./test-message-rate-limits.js');

const ROOT = path.resolve(__dirname, '..');
const PICKER = fs.readFileSync(path.join(ROOT, 'element-picker.js'), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LOADED_URL = 'https://www.twitch.tv/';
const CURRENT_URL = 'https://www.twitch.tv/boomiexd';
const SAVED = () => ({ 'twitch.tv': ['.chat-banner', '#player-promo'], 'spotify.com': ['#keep'] });

async function run() {
  const h = loadBackground();
  await sleep(100);
  const store = h.chrome.storage.local._data;
  const browser = { tabUrl: CURRENT_URL, documentId: 'twitch-document' };
  h.ctx.tabsGet = async id => ({ id, url: browser.tabUrl, incognito: false });
  h.chrome.webNavigation.getFrame = async () => ({ documentId: browser.documentId });
  /* What Chrome reported for the picker in Edge after pushState: the tab moved, sender.url did not. */
  const sender = (tabId, extra = {}) => Object.assign({ id: h.chrome.runtime.id, frameId: 0, documentId: 'twitch-document',
    url: LOADED_URL, origin: 'https://www.twitch.tv', tab: { id: tabId, url: CURRENT_URL } }, extra);
  const press = (from, hostname = 'www.twitch.tv') => new Promise(resolve => {
    for (const listener of h.chrome.runtime.onMessage._l) listener({ kind: 'hidden-clear-site', hostname }, from, resolve);
  });
  const seed = () => { store.wardenone_hidden_elements = SAVED(); };
  const saved = () => JSON.parse(JSON.stringify(store.wardenone_hidden_elements));

  seed();
  const first = await press(sender(801));
  assert.equal(first.ok, true, 'the first press after an in-app navigation is accepted: ' + JSON.stringify(first));
  assert.notEqual(first.persisted, false);
  assert.deepEqual(saved(), { 'spotify.com': ['#keep'] }, 'only the current site is cleared');
  console.log('[ok] Undo all clears the site on the first press after an in-app navigation');

  const limit = vm.runInContext("TAB_CONTEXT_RATE_LIMITS['hidden-clear-site']", h.ctx);
  assert(limit && limit.max >= 2 && limit.max <= 10 && limit.windowMs >= 60000, 'Undo all keeps a small per-tab ceiling');
  for (let n = 2; n <= limit.max; n++) {
    const reply = await press(sender(801));
    assert.equal(reply.ok, true, 'press ' + n + ' is inside the ceiling');
  }
  seed();
  const flood = await press(sender(801));
  assert.equal(flood.ok, false, 'a tab past the ceiling is refused');
  assert.equal(flood.error, 'Rate limited.');
  assert.deepEqual(saved(), SAVED(), 'a refused press changes nothing');
  const otherTab = await press(sender(802));
  assert.equal(otherTab.ok, true, 'one tab spending its allowance does not block another tab');
  console.log('[ok] the per-tab ceiling still refuses a flood of ' + (limit.max + 1) + ' requests a minute');

  const refusals = [
    { name: 'a full navigation replaced the document', document: 'replacement-document' },
    { name: 'the tab is now on another site', tabUrl: 'https://elsewhere.example/' },
    { name: 'a subframe asked', extra: { frameId: 1 } },
    { name: 'another site was named', hostname: 'spotify.com' },
  ];
  for (const [index, item] of refusals.entries()) {
    seed();
    browser.tabUrl = item.tabUrl || CURRENT_URL;
    browser.documentId = item.document || 'twitch-document';
    const reply = await press(sender(810 + index, item.extra), item.hostname);
    assert.equal(reply.ok, false, item.name + ': ' + JSON.stringify(reply));
    assert.notEqual(reply.error, 'Rate limited.', item.name + ' is refused by the sender check, not the ceiling');
    assert.deepEqual(saved(), SAVED(), item.name + ': nothing is cleared');
  }
  browser.tabUrl = CURRENT_URL;
  browser.documentId = 'twitch-document';
  console.log('[ok] a replaced document, another site, a subframe and a foreign host are still refused');

  /* The real panel code, wired to the worker above, must reach its success panel on one press. */
  seed();
  const make = (tag, cls, text) => ({ tag, className: cls, textContent: text || '', children: [], listeners: {}, disabled: false,
    appendChild(node) { this.children.push(node); }, setAttribute() {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { this.listeners.click({ isTrusted: true }); },
  });
  const removed = [];
  const entries = ['.chat-banner', '#player-promo'].map(selector => ({ selector, saveFinished: true, undoRequested: false,
    element: { removeAttribute: name => removed.push([selector, name]) } }));
  let delivered = 0;
  const context = { HOST: 'www.twitch.tv', HOST_LABEL: 'www.twitch.tv', ZAP_ATTR: 'data-wardenone-zapped',
    undoState: { items: entries.slice() }, zapped: entries.map(entry => entry.element), lastSaved: entries.map(entry => entry.selector),
    zapCount: 2, latestSeq: 1, current: null, ui: { isConnected: true }, el: make, frame() {}, stop() {},
    keyHints: () => make('div'), say(panel) { context.panel = panel; }, disarmGlobalUndoIfEmpty() {},
    chrome: { runtime: { lastError: undefined, sendMessage(message, callback) {
      delivered++;
      for (const listener of h.chrome.runtime.onMessage._l) listener(message, sender(830), callback);
    } } },
  };
  vm.createContext(context);
  const start = PICKER.indexOf('  function hintPanel('), end = PICKER.indexOf('\n  say(hintPanel());', start);
  assert(start > 0 && end > start, 'the picker panel code is where this test expects it');
  vm.runInContext('let undoAllConfirming=false,undoAllPending=false;' + PICKER.slice(start, end)
    + ';this.open=()=>say(hintPanel());', context);
  const find = (label, node = context.panel) => {
    if (node.tag === 'button' && node.textContent === label) return node;
    for (const child of node.children) { const found = find(label, child); if (found) return found; }
  };
  const text = (node = context.panel) => [node.textContent].concat(node.children.map(child => text(child))).join(' ');
  context.open();
  find('Undo all on this site').click();
  find('Undo all').click();
  for (let wait = 0; wait < 100 && !/were undone/.test(text()); wait++) await sleep(10);
  assert.equal(delivered, 1, 'one press sends one request');
  assert.match(text(), /Element Zapper changes saved for www\.twitch\.tv were undone\./, 'the panel reports success: ' + text());
  assert.doesNotMatch(text(), /Rate limited|Not allowed|Could not undo/);
  assert.deepEqual(saved(), { 'spotify.com': ['#keep'] });
  assert.equal(removed.length, 2, 'the on-screen marks are lifted too');
  console.log('[ok] the real Zapper panel reaches "were undone" on its first press');
}

run().catch(error => { console.error(error); process.exitCode = 1; });

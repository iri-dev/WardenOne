/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
const { installPlatformGlobals } = require('./lib/engine-ambient.js');
const source = fs.readFileSync('consent-reject.js', 'utf8');
function rig() {
  const document = { nodeType: 9, documentElement: null, body: {}, addEventListener() {}, querySelectorAll: () => [],
    createTreeWalker(root) { let i = 0; return { nextNode: () => (root.elements || [])[i++] || null }; } };
  const window = {}; window.top = window;
  const context = { window, document, location: { hostname: 'consent.example', pathname: '/', href: 'https://consent.example/', origin: 'https://consent.example' },
    URL, console, innerWidth: 1200, innerHeight: 900, Set, WeakSet, Date,
    chrome: { runtime: { lastError: null, onMessage: { addListener() {}, removeListener() {} } } },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  installPlatformGlobals(context);
  const marker = '  if (document.documentElement) start();'; assert(source.includes(marker));
  vm.runInNewContext(source.replace(marker, '  globalThis.api={clickControl,safeRejectCandidate,settingsCandidate,saveChoicesCandidate,collectRoots,choicesAreOff,choicesReadyToSave,openSettings:()=>{openSettingsUntil=Date.now()+900;}};\n' + marker), context);
  return { api: context.api, document };
}
function element(text, attrs = {}) {
  return { nodeType: 1, tagName: 'BUTTON', textContent: text, innerText: text, isConnected: true,
    id: attrs.id || '', className: attrs.class || '', getAttribute: key => attrs[key] ?? null,
    hasAttribute: key => key in attrs, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ width: 200, height: 50, top: 10, left: 10, right: 210, bottom: 60 }) };
}
const { api } = rig();
for (const attrs of [{ disabled: true }, { 'aria-disabled': 'true' }]) {
  let clicked = false;
  const button = element('Reject all', attrs); button.disabled = !!attrs.disabled; button.click = () => { clicked = true; };
  assert.equal(api.clickControl(button), false); assert.equal(clicked, false, 'disabled consent control');
  button.disabled = false; button.getAttribute = () => null;
  assert.equal(api.clickControl(button), true); assert.equal(clicked, true, 'a previously disabled control can become available');
}
for (const label of ['Reject all', 'Only necessary cookies', 'Continue without accepting', 'Rifiuta', 'Rifiuta tutti', 'Rifiuta tutto', 'Alle ablehnen', 'Tout refuser', 'Rechazar todo']) {
  assert(api.safeRejectCandidate(element(label)), 'reject label: ' + label);
}
for (const [label, attrs] of [
  ['Accept all', { 'data-testid': 'reject-all' }], ['Accept all', { class: 'reject-all' }],
  ['Accept all', { 'data-action': 'reject-all' }], ['Accept all', { 'aria-label': 'Reject all' }],
  ['Continue', { 'data-testid': 'reject-all' }], ['Manage preferences', { id: 'reject-all' }],
  ['Confirm payment and reject cookies', {}],
]) assert.equal(api.safeRejectCandidate(element(label, attrs)), false, 'metadata cannot authorize: ' + label + ' ' + JSON.stringify(attrs));
const container = element('Cookie consent preferences');
for (const label of ['Save preferences', 'Confirm choices', 'Apply settings']) {
  assert.equal(api.settingsCandidate(element(label), container), false, 'save must not use the settings bypass: ' + label);
}
assert.equal(api.saveChoicesCandidate(element('Accept all', { 'data-action': 'save-preferences' }), container, true), false);
assert.equal(api.settingsCandidate(element('Accept all', { 'data-action': 'manage-preferences' }), container), false);
for (const [labels, expected] of [
  [[['Necessary', true], ['Marketing', false]], true],
  [[['Necessary', true], ['Marketing', true]], false],
  [[['Necessary marketing', true]], false],
  [[['Unclassified purpose', true]], false],
]) {
  const controls = labels.map(([label, checked]) => {
    const el = element('', { type: 'checkbox' }); el.tagName = 'INPUT'; el.type = 'checkbox'; el.checked = checked;
    el.parentElement = element(label); el.parentElement.parentElement = container; return el;
  });
  container.querySelectorAll = () => controls;
  assert.equal(api.choicesAreOff(container), expected, 'checked purposes: ' + JSON.stringify(labels));
}
container.querySelectorAll = () => [Object.assign(element('', { type: 'checkbox' }), { tagName: 'INPUT', type: 'checkbox', checked: false })];
assert.equal(api.choicesReadyToSave(container, false), false, 'an untouched initial panel is not an initiated settings flow');
api.openSettings();
assert.equal(api.choicesReadyToSave(container, false), true, 'an opened panel with optional toggles already off can be saved');
container.querySelectorAll = () => [];
assert.equal(api.choicesReadyToSave(container, false), false, 'a toggle-free settings panel is not evidence that optional purposes are off');
{
  const hidden = element('', { type: 'checkbox' }); hidden.tagName = 'INPUT'; hidden.type = 'checkbox'; hidden.checked = true;
  hidden.parentElement = element('Marketing'); hidden.parentElement.parentElement = container;
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  container.querySelectorAll = () => [hidden];
  assert.equal(api.choicesAreOff(container), false, 'a hidden enabled optional purpose still prevents saving consent');
}
{
  const r = rig(), inner = { nodeType: 11, elements: [] }, nestedHost = { nodeType: 1, shadowRoot: inner };
  const outer = { nodeType: 11, elements: [nestedHost] }, host = { nodeType: 1, shadowRoot: outer };
  const root = { nodeType: 1, elements: [host] };
  const roots = r.api.collectRoots(root);
  assert.equal(roots.length, 3); assert.equal(roots[1], outer); assert.equal(roots[2], inner);
  let visited = 0;
  r.document.createTreeWalker = () => ({ nextNode: () => { visited++; return { nodeType: 1 }; } });
  r.api.collectRoots(root); assert(visited <= 1800, 'nested discovery retains a shared traversal budget');
}
console.log('[ok] consent action labels, guarded preference saves, nested shadow roots and shared traversal budget');

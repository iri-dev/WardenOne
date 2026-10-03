/* The pin step follows the action's real pinned state without guessing toolbar coordinates. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'onboarding.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'onboarding.html'), 'utf8');
assert(!html.includes('class="pin-arrow"'), 'no arrow makes an unverified position claim');
assert(!script.includes('flashPinArrow'), 'popup fallback does not revive the arrow');
assert(html.includes('Match this puzzle shape'), 'the guide shows what to look for');
assert(script.includes('chrome.action.getUserSettings()'), 'the browser supplies the pinned state');
assert(script.includes('onUserSettingsChanged'), 'the guide follows pin and unpin changes');

const elements = Object.fromEntries(['pin-title', 'pin-lead', 'pin-state', 'pin-steps']
  .map((id) => [id, { textContent: '', hidden: false }]));
const start = script.indexOf("const pinTitle = $('pin-title');");
const end = script.indexOf('\n  async function refreshPinState()', start);
assert(start >= 0 && end > start, 'pin state painter is available');
const context = { $: (id) => elements[id] };
vm.createContext(context);
vm.runInContext(script.slice(start, end), context);
vm.runInContext('paintPinState(true)', context);
assert.equal(elements['pin-title'].textContent, 'WardenOne is already pinned.');
assert.equal(elements['pin-state'].hidden, false);
assert.equal(elements['pin-steps'].hidden, true);
vm.runInContext('paintPinState(false)', context);
assert.equal(elements['pin-title'].textContent, 'Pin WardenOne to your toolbar.');
assert.equal(elements['pin-state'].hidden, true);
assert.equal(elements['pin-steps'].hidden, false);
console.log('[ok] onboarding pin guidance');

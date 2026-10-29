/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm'), path = require('path');
const { installPlatformGlobals } = require('./lib/engine-ambient.js');
const state = require('../consent-state.js'), root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'consent-reject.js'), 'utf8');
assert(source.includes('woTimeout(() => queueScan(true), 800)'), 'one bounded discovery pass catches shadow roots attached without document mutations');
const cases = [
  ['onetrust', 'groups=C0001:1,C0002:0,C0003:0,C0004:0', true],
  ['onetrust', 'groups=C0001:1,C0002:1', false], ['onetrust', 'groups=C0001:1', false],
  ['onetrust', 'groups=C0001:1,C0002:0&groups=C0001:1', false], ['onetrust', 'groups=C0001:1,C0002:0,C0002:0', false],
  ['cookiebot', "{stamp:'sample',necessary:true,preferences:false,statistics:false,marketing:false,method:'explicit',ver:1,utc:123}", true],
  ['cookiebot', '{"necessary":true,"preferences":false,"statistics":false,"marketing":false}', true],
  ['cookiebot', '{necessary:true,preferences:false,statistics:true,marketing:false}', false],
  ['cookiebot', '{necessary:true,preferences:false,statistics:false}', false],
  ['cookiebot', '{necessary:true,preferences:false,statistics:false,marketing:false,marketing:true}', false],
  ['cookiebot', '{stamp:"x,necessary:true,preferences:false,statistics:false,marketing:false"}', false],
  ['cookiebot', '{necessary:true,preferences:false,statistics:false,marketing:false,callback:alert(1)}', false],
  ['trustarc', '0', true], ['trustarc', '0::expressed,eu', true], ['trustarc', '0,1,2', false], ['trustarc', '100', false], ['unknown', '0', false],
];
for (const [id, value, expected] of cases) assert.equal(state.rejected(id, value), expected, id + ': ' + value);
assert.equal(state.cookie('other=private; OptanonConsent=' + encodeURIComponent(cases[0][1]), 'OptanonConsent'), cases[0][1]);
for (const raw of ['OptanonConsent=%XX', 'OptanonConsent=a; OptanonConsent=b', 'x'.repeat(32769)]) assert.equal(state.cookie(raw, 'OptanonConsent'), '');
assert(!state.verify(state.profiles[0], cases[0][1], cases[0][1]), 'pre-existing state alone is not a newly saved opt-out');
function rig() {
  const messages = [], timers = [], listeners = [];
  const document = { documentElement: null, cookie: '', addEventListener() {}, querySelectorAll: () => [], body: {} };
  const window = {}; window.top = window;
  const context = { window, document, WOConsentState: state, location: { hostname: 'choice.example', pathname: '/', href: 'https://choice.example/', origin: 'https://choice.example' },
    URL, URLSearchParams, console, innerWidth: 1000, innerHeight: 800, Set, WeakSet, Date,
    chrome: { runtime: { lastError: null, onMessage: { addListener: f => listeners.push(f), removeListener() {} }, sendMessage: m => messages.push(m) } },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
  };
  installPlatformGlobals(context);
  const marker = '  if (document.documentElement) start();'; assert(source.includes(marker));
  vm.runInNewContext(source.replace(marker, '  globalThis.api={clickControl,performChoice,choicesAreOff,refreshConfigState,loadConfig,mutationNodeMayAffectConsent,isActive:()=>active,activate:()=>{active=true;}};\n' + marker), context);
  context.api.activate();
  return { context, messages, timers, listeners, document, api: context.api };
}
function button(action) { return { tagName: 'BUTTON', getAttribute: () => null, focus() {}, click: action || (() => {}) }; }
{
  const r = rig(), el = button(() => { throw Error('click failed'); });
  assert(r.api.mutationNodeMayAffectConsent({ nodeType: 1, shadowRoot: { querySelector: () => ({}) } }), 'an anonymous open-shadow host wakes consent scanning');
  assert.equal(r.api.performChoice(el, null, state.profiles[0]), false);
  assert.equal(r.messages[0].detail.status, 'failed'); assert(!r.messages.some(m => m.detail.status === 'rejected'));
}
{
  const r = rig(); assert(r.api.performChoice(button(), null, state.profiles[0]));
  assert.equal(r.messages.length, 0, 'a dispatched click alone makes no saved-state claim');
  r.timers.find(t => t.delay === 2500).fn(); assert.equal(r.messages[0].detail.status, 'unverified');
}
for (const [index, saved] of [[0, cases[0][1]], [1, cases[5][1]], [2, '0::expressed,eu']]) {
  const r = rig(), profile = state.profiles[index];
  assert(r.api.performChoice(button(() => { r.document.cookie = profile.cookie + '=' + encodeURIComponent(saved); }), null, profile));
  assert.equal(r.messages[0].detail.status, 'rejected');
  assert.equal(r.messages[0].detail.evidence, 'changed-saved-cookie-state');
  assert(!JSON.stringify(r.messages).includes(saved), 'raw consent values stay out of logs');
}
{
  const r = rig(); r.api.performChoice(button(), null, state.profiles[0]);
  r.api.refreshConfigState({ enabled: false }); r.document.cookie = 'OptanonConsent=' + encodeURIComponent(cases[0][1]);
  r.timers.find(t => t.delay === 2500).fn(); assert.equal(r.messages.length, 0, 'pause revokes pending verification');
}
{
  const r = rig(); r.api.performChoice(button(), null, state.profiles[0]);
  for (const listener of r.listeners) listener({ kind: 'consent-reset' });
  r.document.cookie = 'OptanonConsent=' + encodeURIComponent(cases[0][1]);
  r.timers.find(t => t.delay === 2500).fn(); assert.equal(r.messages.length, 0, 'history erasure revokes pending saved-state checks');
}
for (const reply of [null, { ok: false }, { ok: true, overrides: {} }, { ok: true, overrides: { enabled: true, autoRejectConsent: 'invalid' } }]) {
  const r = rig(); r.context.window.__wardenOneContentConfigRequest = (_need, callback) => callback(reply);
  r.api.loadConfig(); assert.equal(r.api.isActive(), false, 'unavailable or malformed effective settings never enable automatic interaction');
}
console.log('[ok] failed/dispatched/unverified/saved consent outcomes, bounded CMP cookie parsing and revocation');

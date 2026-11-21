/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
const { installPlatformGlobals } = require('./lib/engine-ambient.js');
const source = fs.readFileSync('consent-reject.js', 'utf8');
function rig(timers) {
  const document = { nodeType: 9, documentElement: null, body: {}, addEventListener() {}, querySelectorAll: () => [],
    createTreeWalker(root) { let i = 0; return { nextNode: () => (root.elements || [])[i++] || null }; } };
  const window = {}; window.top = window;
  const context = { window, document, location: { hostname: 'consent.example', pathname: '/', href: 'https://consent.example/', origin: 'https://consent.example' },
    URL, console, innerWidth: 1200, innerHeight: 900, Set, WeakSet, Date,
    chrome: { runtime: { lastError: null, onMessage: { addListener() {}, removeListener() {} }, sendMessage() {} } },
    setTimeout: (fn, ms) => { if (timers) timers.push({ fn, ms }); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  installPlatformGlobals(context);
  const marker = '  if (document.documentElement) start();'; assert(source.includes(marker));
  vm.runInNewContext(source.replace(marker, '  globalThis.api={clickControl,safeRejectCandidate,settingsCandidate,saveChoicesCandidate,collectRoots,choicesAreOff,choicesReadyToSave,performChoice,saveAfterRefusal,composedText,containerText,composedParent,consentBannerAncestor,protectedContainerContext,choicesMade:()=>choicesMade,changed:c=>changedChoices.has(c),openSettings:()=>{openSettingsUntil=Date.now()+900;},activate:()=>{active=true;}};\n' + marker), context);
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
/* Didomi draws each purpose as a Disagree / Agree radio pair (role="radio", aria-checked). A chosen "Disagree" read as
   consent given, so the panel was never saved (didomi.io, 2026-11-20). */
for (const [pick, expected] of [['Disagree', true], ['Agree', false]]) {
  const controls = ['Disagree', 'Agree'].map(label => {
    const el = element(label, { role: 'radio', 'aria-checked': String(label === pick), 'aria-label': label + ' Personalised advertising and ad performance measurement' });
    el.parentElement = element('Personalised advertising and ad performance measurement'); el.parentElement.parentElement = container; return el;
  });
  container.querySelectorAll = () => controls;
  assert.equal(api.choicesAreOff(container), expected, 'radio pair with ' + pick + ' chosen');
}
{
  /* Each purpose's Disagree used one of the three answers a page gets, so Didomi ran out before its Save. */
  const { api: fresh } = rig();
  const panel = element('Cookie consent preferences');
  const option = element('Disagree', { role: 'radio', 'aria-checked': 'false' }); option.click = () => {};
  assert.equal(fresh.performChoice(option, panel), true, 'a purpose option is clicked');
  assert.equal(fresh.choicesMade(), 0, 'a purpose option does not use up an answer');
  assert.equal(fresh.changed(panel), true, 'a purpose option leaves the panel ready to save');
  const { api: other } = rig();
  const answer = element('Reject all'); answer.click = () => {};
  assert.equal(other.performChoice(answer, panel), true, 'a real answer is clicked');
  assert.equal(other.choicesMade(), 1, 'a real answer still counts');
}
{
  /* Didomi's hidden per-vendor options: text "Di agree" (a styled letter drops out), purpose first in the label. */
  const hidden = element('Di agree', { role: 'radio', 'aria-checked': 'true', 'aria-label': 'Personalised advertising and ad performance measurement Disagree ' });
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  hidden.parentElement = element('Personalised advertising and ad performance measurement'); hidden.parentElement.parentElement = container;
  container.querySelectorAll = () => [hidden];
  assert.equal(api.choicesAreOff(container), true, 'a chosen refusal named after its purpose still counts as off');
  const agree = element('Agree', { role: 'radio', 'aria-checked': 'true', 'aria-label': 'Personalised advertising and ad performance measurement Agree' });
  agree.parentElement = hidden.parentElement;
  container.querySelectorAll = () => [agree];
  assert.equal(api.choicesAreOff(container), false, 'a chosen Agree named after its purpose still counts as on');
}
{
  const yes = element('Yes', { role: 'radio', 'aria-checked': 'true' }); yes.parentElement = element('Marketing'); yes.parentElement.parentElement = container;
  container.querySelectorAll = () => [yes];
  assert.equal(api.choicesAreOff(container), false, 'a chosen consent option in a radio pair still counts as on');
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
{
  /* usercentrics.com: the banner's shadow host is the last child of <body>, past 1800 elements of page. */
  const r = rig(), banner = { nodeType: 11, elements: [] }, host = { nodeType: 1, id: 'usercentrics-cmp-ui', shadowRoot: banner };
  const filler = Array.from({ length: 2500 }, () => ({ nodeType: 1 }));
  const page = { nodeType: 9, documentElement: { nodeType: 1, elements: filler.concat([host]) }, body: { children: [host] },
    querySelectorAll: () => [] };
  r.document.createTreeWalker = (start) => { let i = 0; const list = start.elements || []; return { nextNode: () => list[i++] || null }; };
  const roots = r.api.collectRoots(page);
  assert(roots.includes(banner), 'a banner shadow root at the end of a big page is found');
  assert.equal(roots.filter(x => x === banner).length, 1, 'and only once');
  const viaId = { nodeType: 9, documentElement: { nodeType: 1, elements: filler }, body: { children: [] }, querySelectorAll: () => [host] };
  assert(r.api.collectRoots(viaId).includes(banner), 'a known consent host is found wherever it sits');
}
/* ketch.com's purposes dialog: Reject All switches every purpose off and the dialog waits for "Save choices"
   (2026-11-20). Only that dialog's own save finishes the refusal. */
function refusalPanel(options = {}) {
  const timers = [], { api: panelApi } = rig(timers);
  panelApi.activate();
  const clicks = [];
  const panel = element('Your Privacy. We use cookies and share data with vendors. Purposes: Analytics, Behavioral Advertising.', options.plainPanel ? {} : { role: 'dialog', 'aria-modal': 'true' });
  const reject = element('Reject All'), save = element(options.saveLabel || 'Save choices');
  const toggle = Object.assign(element('', { type: 'checkbox' }), { tagName: 'INPUT', type: 'checkbox', checked: !!options.toggleOn });
  toggle.parentElement = element('Behavioral Advertising'); toggle.parentElement.parentElement = panel;
  toggle.click = () => { clicks.push('toggle'); if (!options.toggleStuck) toggle.checked = false; };
  reject.click = () => { clicks.push('reject'); if (options.closes) reject.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }); };
  save.click = () => clicks.push('save');
  /* A page that talks about cookies itself leaves only the dialog's edge, or the page's height, between the refusal
     and a save outside the dialog. */
  const height = options.shortPage ? 800 : 5000;
  const page = element(options.shortPage || options.cookiePage ? 'Cookie settings for this app' : 'A readable page', {});
  page.getBoundingClientRect = () => ({ width: 1200, height, top: 0, left: 0, right: 1200, bottom: height });
  page.querySelectorAll = () => [reject, toggle, save];
  panel.parentElement = page;
  panel.querySelectorAll = () => options.saveOutside ? [reject, toggle] : [reject, toggle, save];
  reject.parentElement = panel;
  return { api: panelApi, timers, clicks, panel, reject };
}
{
  const realNow = Date.now; let clock = 1e12; Date.now = () => clock;
  try {
    const step = (options) => { const r = refusalPanel(options); r.api.performChoice(r.reject, r.panel);
      for (const t of r.timers.filter(t => t.ms === 1800 || t.ms === 3600).sort((a, b) => a.ms - b.ms)) { clock += t.ms; t.fn(); } return r; };
    let r = step({});
    assert.deepEqual(r.clicks, ['reject', 'save'], 'a refusal that leaves its dialog open is saved there');
    assert.equal(r.api.choicesMade(), 2, 'the save is the second of the page answers');
    r = step({ toggleOn: true });
    assert.deepEqual(r.clicks, ['reject', 'toggle', 'save'], 'a purpose Reject All missed is switched off before the save');
    r = step({ toggleOn: true, toggleStuck: true });
    assert.deepEqual(r.clicks, ['reject', 'toggle'], 'a purpose that stays on keeps the save from being pressed');
    r = step({ closes: true });
    assert.deepEqual(r.clicks, ['reject'], 'a dialog the refusal closed is left alone');
    r = step({ saveOutside: true });
    assert.deepEqual(r.clicks, ['reject'], 'a save beyond the dialog is never pressed');
    r = step({ saveOutside: true, shortPage: true });
    assert.deepEqual(r.clicks, ['reject'], 'nor on a page no taller than the window');
    r = step({ saveOutside: true, plainPanel: true, cookiePage: true });
    assert.deepEqual(r.clicks, ['reject'], 'nor in the page around a panel that is not a dialog');
    r = step({ plainPanel: true });
    assert.deepEqual(r.clicks, ['reject', 'save'], 'a panel that is not marked as a dialog still has its own save pressed');
    r = step({ saveLabel: 'Accept and save choices' });
    assert.deepEqual(r.clicks, ['reject'], 'a save that also accepts is never pressed');
    r = step({ saveLabel: 'Save' });
    assert.deepEqual(r.clicks, ['reject'], 'a bare Save names no choices and is left alone');
    {
      const timers = [], { api: off } = rig(timers); off.activate();
      const answer = element('Save preferences'); answer.click = () => {};
      off.performChoice(answer, element('Cookie consent preferences', { role: 'dialog' }));
      assert.equal(timers.filter(t => t.ms === 1800 || t.ms === 3600).length, 0, 'a save is not followed by another save');
    }
  } finally { Date.now = realNow; }
}
/* iubenda.com's team.blue banner (2026-11-20): an alertdialog whose words and buttons all live in nested shadow roots
   of its parts, so its own text is empty and a walk up from Reject stopped at the first shadow boundary. */
function part(tag, kids = [], shadowKids = null, attrs = {}) {
  const el = element('', attrs); el.tagName = tag.toUpperCase(); el.localName = tag;
  const link = (owner, list) => { list.forEach((c, i) => { c.nextSibling = list[i + 1] || null; if (c.nodeType === 1 && owner.nodeType === 1) c.parentElement = owner; }); owner.firstChild = list[0] || null; };
  link(el, kids);
  el.textContent = kids.map(k => k.nodeType === 3 ? k.data : k.textContent).join(' ');
  /* What the rig's tree walker visits: light descendants, never another root's. */
  const below = list => list.filter(k => k.nodeType === 1).flatMap(k => [k].concat(k.elements || []));
  el.elements = below(kids);
  const buttons = list => list.filter(e => e.localName === 'button');
  el.querySelectorAll = () => buttons(el.elements);
  if (shadowKids) {
    const inside = below(shadowKids);
    const root = { nodeType: 11, host: el, elements: inside, querySelector: () => null, querySelectorAll: () => buttons(inside) };
    link(root, shadowKids);
    for (const k of shadowKids) if (k.nodeType === 1) { k.parentElement = null; k.getRootNode = () => root; }
    el.shadowRoot = root;
  }
  return el;
}
const text = (data) => ({ nodeType: 3, data });
function shadowBanner(words, options = {}) {
  const reject = part('button', [text('Reject')]);
  const buttonHost = part('tb-action-button', [], [reject]);
  const hosts = [buttonHost].concat(options.accept ? [part('tb-action-button', [], [part('button', [text('Accept')])])] : []);
  const footer = part('div', hosts, null, { class: 'tb-footer-buttons-container' });
  const footerHost = part('tb-banner-footer', [], [footer]);
  const content = part('div', [text(words)].concat(options.password ? [part('input', [], null, { type: 'password' })] : []));
  const contentHost = part('tb-banner-content', [], [content]);
  if (options.password) contentHost.shadowRoot.querySelector = (selector) => /password/.test(selector) ? content : null;
  const box = part('div', [contentHost, footerHost], null, { class: 'tb-banner-wrapper', role: 'alertdialog' });
  box.getBoundingClientRect = () => ({ width: 480, height: 440, top: 100, left: 400, right: 880, bottom: 540 });
  return { box, reject };
}
{
  const { api: shadowApi } = rig();
  let b = shadowBanner('We and selected third parties use cookies for analytics and advertising.');
  assert(/cookies/.test(shadowApi.containerText(b.box)) && /Reject/.test(shadowApi.containerText(b.box)), 'a box with no text of its own is read through its parts');
  const rich = part('div', [text('We use cookies on this site to measure visits and show you relevant ads, as described here.'), part('x-extra', [], [text('PARTWORDS')])]);
  assert(/measure visits/.test(shadowApi.containerText(rich)) && !/PARTWORDS/.test(shadowApi.containerText(rich)), 'a box with its own words is read as before, without walking its parts');
  const deepHost = part('tb-action-button'); assert.equal(shadowApi.composedParent(b.reject), b.reject.getRootNode().host, 'the step up from a shadow root is its host');
  assert.equal(shadowApi.composedParent(deepHost), null, 'an element with no parent and no shadow host has nowhere to go');
  assert.equal(shadowApi.consentBannerAncestor(b.reject), b.box, 'a Reject three shadow roots deep finds its cookie banner');
  b = shadowBanner('Join the call now? Your camera stays off until you say so.');
  assert.equal(shadowApi.consentBannerAncestor(b.reject), null, 'a shadow dialog that never mentions cookies is left alone');
  b = shadowBanner('We use cookies on this page.', { password: true });
  assert.equal(shadowApi.protectedContainerContext(b.box, b.reject), true, 'a password field inside a shadow part still protects the dialog');
  assert.equal(shadowApi.consentBannerAncestor(b.reject), null, 'so that Reject is never pressed');
  /* "withdraw" is a banking word; a plain Reject and Accept pair in the parts shows it is a consent choice. */
  const withdraw = 'We and selected third parties use cookies. You can freely give, deny, or withdraw your consent at any time.';
  b = shadowBanner(withdraw, { accept: true });
  assert.equal(shadowApi.consentBannerAncestor(b.reject), b.box, 'withdraw your consent, with Reject and Accept in the parts, is a cookie banner');
  b = shadowBanner(withdraw);
  assert.equal(shadowApi.consentBannerAncestor(b.reject), null, 'without the Accept beside it, withdraw still protects the dialog');
  const flood = part('div', Array.from({ length: 3000 }, () => part('span')).concat([text('far away cookies')]));
  assert(!/far away/.test(shadowApi.composedText(flood, 500)), 'reading through parts stops at its budget');
}
{
  /* The banner's own root sits under <body>, and its parts' roots inside that; a big page used the budget first. */
  const r = rig(), inner = { nodeType: 11, elements: [] }, nestedHost = { nodeType: 1, shadowRoot: inner };
  const outer = { nodeType: 11, elements: [nestedHost] }, host = { nodeType: 1, shadowRoot: outer };
  const filler = Array.from({ length: 2500 }, () => ({ nodeType: 1 }));
  const page = { nodeType: 9, documentElement: { nodeType: 1, elements: filler.concat([host]) }, body: { children: [host] }, querySelectorAll: () => [] };
  r.document.createTreeWalker = (start) => { let i = 0; const list = start.elements || []; return { nextNode: () => list[i++] || null }; };
  const roots = r.api.collectRoots(page);
  assert(roots.includes(inner), 'a part nested in a banner root at the end of a big page is found');
  assert.equal(roots.filter(x => x === inner).length, 1, 'and only once');
}
console.log('[ok] consent action labels, guarded preference saves, refusals finished in their own dialog, banners built from shadow parts, nested shadow roots and shared traversal budget');

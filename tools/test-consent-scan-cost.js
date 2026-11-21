/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* The consent decliner's two load-time savings must not change any answer.
   1. elementText reads text only until its 500 kept characters are settled: same result as full textContent.
   2. safeRejectCandidate skips controls with none of REJECT_RE's word stems: any label REJECT_RE matches has one.
   3. A hidden list item, heading or style tag never keeps the load polls running; containers still do.
   Measured cost before: about 1.9 s of main thread per CNN load and 1.1 s per Wikipedia load (Browser Guard 1v1).
   Run: node tools/test-consent-scan-cost.js */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'consent-reject.js'), 'utf8');
const between = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert(a > 0 && b > a, 'missing ' + from);
  return source.slice(a, b);
};
const reject = /const REJECT_RE = .*;\n/.exec(source)[0];
const context = vm.createContext({ NodeFilter: { SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8 }, document: null });
vm.runInContext(reject + between('function leadingText(el, limit)', '  function controlLabel(el)')
  + between('const REJECT_STEM_RE', 'function safeRejectCandidate(el)')
  + ';this.api={leadingText,elementText,mayBeRejectControl,mayBecomeBanner,isContainerMatch,queryContainers,REJECT_RE,REJECT_STEM_RE};', context);
const { api } = context;
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };

/* A tiny element: text nodes in order, attributes, and a tree walker over the text nodes. */
function element(texts, attrs = {}) {
  const nodes = texts.map((data) => ({ data }));
  const el = {
    textContent: texts.join(''), id: attrs.id || '', className: attrs.className || '', name: attrs.name || '',
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    ownerDocument: { createTreeWalker: () => { let i = -1; return { nextNode: () => nodes[++i] || null }; } },
  };
  return { el, nodes };
}
const oldElementText = (el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('value'),
  el.getAttribute('data-testid'), el.getAttribute('data-test'), el.getAttribute('data-cy'), el.getAttribute('data-action'),
  el.getAttribute('data-consent-action'), el.getAttribute('aria-checked'), el.id, typeof el.className === 'string' ? el.className : '', el.name]
  .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);

/* 1. Same answer as reading everything, including whitespace-heavy and attribute-heavy shapes. */
let seed = 7;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pieces = ['Cookie ', 'consent', '   ', '\n\n\t', 'We use cookies to improve your experience. ', 'Reject all', ' ', '', 'x'.repeat(700), '\u00A0'];
let same = 0;
for (let t = 0; t < 3000; t++) {
  const texts = Array.from({ length: 1 + rand(40) }, () => pieces[rand(pieces.length)]);
  const attrs = rand(3) ? { 'aria-label': 'Close banner', title: 'Cookie settings', id: 'cmp-root', className: 'cookie consent' } : {};
  const { el } = element(texts, attrs);
  if (api.elementText(el) === oldElementText(el)) same++;
}
ok(same === 3000, 'elementText gives the same 500 characters as full textContent, every time (' + same + ' of 3000)');
const huge = element(Array.from({ length: 20000 }, (_, i) => 'Section ' + i + ' of the page. '));
let visited = 0;
huge.el.ownerDocument = { createTreeWalker: () => { let i = -1; return { nextNode: () => { visited++; return huge.nodes[++i] || null; } }; } };
ok(api.elementText(huge.el) === oldElementText(huge.el), 'a huge container gives the same text');
ok(visited < 200, 'and reads only its first few text nodes (' + visited + ' of 20,000)');
const spaces = element([...Array.from({ length: 3000 }, () => '        '), 'Reject all']);
ok(api.elementText(spaces.el) === oldElementText(spaces.el), 'whitespace before the words is still read through');

/* 2. Every label REJECT_RE accepts has a stem, so the skip never drops a real reject button. */
const labels = ['Reject', 'Reject all', 'REJECT ALL', 'Reject optional', 'Decline', 'Decline all', 'Deny', 'Deny all', 'Refuse', 'Refuse all',
  'Disagree', 'I disagree', 'Do not accept', 'Do not agree', 'Do not consent', 'Do not sell or share', "Don't consent", 'Dont consent',
  'Strictly necessary only', 'Necessary cookies only', 'Essential only', 'Required only', 'Only strictly necessary', 'Only essential cookies',
  'Use necessary cookies', 'Use strictly necessary cookies', 'Save without accepting', 'Continue without accepting', 'Opt out', 'Optout',
  'Object to all', 'Disable all', 'Turn off all', 'Withdraw consent', 'Alle ablehnen', 'Tout refuser', 'Rechazar todo', 'Rifiuta', 'Rifiuta tutti',
  'Afwijzen', 'Alles weigeren', 'Odrzu\u0107 wszystkie', 'Rejeitar tudo', 'Avvisa alla'];
for (const label of labels) {
  ok(api.REJECT_RE.test(label), 'REJECT_RE accepts the sample: ' + label);
  ok(api.mayBeRejectControl(element([label]).el), 'kept by the stem check as text: ' + label);
  ok(api.mayBeRejectControl(element([], { 'aria-label': label }).el), 'kept as an aria-label: ' + label);
  ok(api.mayBeRejectControl(element([], { value: label }).el), 'kept as a button value: ' + label);
}
/* Words split across elements: innerText joins them with a break, textContent does not; either way the stem is there. */
ok(api.mayBeRejectControl(element(['Reject', 'all']).el), 'stem found when the words sit in separate elements');
for (const label of ['Main page', 'Contents', 'Current events', 'Random article', 'Donate', 'Log in', 'Search', 'World', 'Sport', 'Video', 'Weather']) {
  ok(!api.mayBeRejectControl(element([label]).el), 'an ordinary link is skipped before innerText: ' + label);
}
/* 3. Hidden matches only keep the load polls alive if they could become a banner. */
for (const tag of ['DIV', 'div', 'SECTION', 'ASIDE', 'DIALOG', 'FORM', 'IFRAME', 'MAIN', 'ARTICLE', 'NAV', 'FOOTER', 'SPAN', 'CMP-BANNER', 'onetrust-consent-sdk']) {
  ok(api.mayBecomeBanner({ tagName: tag }), 'a ' + tag + ' could still become a banner');
}
for (const tag of ['STYLE', 'SCRIPT', 'LINK', 'TEMPLATE', 'LI', 'UL', 'H3', 'H4', 'SUP', 'A', 'P', 'TD', 'IMG', 'BUTTON', 'INPUT', 'OPTION']) {
  ok(!api.mayBecomeBanner({ tagName: tag }), 'a hidden ' + tag + ' no longer keeps the polls running');
}
ok(api.mayBecomeBanner({}), 'an element without a tag name is kept, failing toward polling');
ok(/&& mayBecomeBanner\(el\)\) noteCandidate\(\);/.test(source), 'getContainers applies it only to the hidden branch');
const dialogEl = (open) => ({ tagName: 'DIALOG', hasAttribute: (n) => n === 'open' && open });
ok(!api.mayBecomeBanner(dialogEl(false)), 'a closed <dialog> waits for its open attribute instead of keeping the polls running');
ok(api.mayBecomeBanner(dialogEl(true)), 'an open but hidden <dialog> still keeps them running');
ok(/attributeFilter: \[[^\]]*'open'/.test(source), 'the observer still wakes when a dialog gains open');

/* 4. The one pass over the elements matches exactly what CONTAINER_SELECTOR matches. Every entry is parsed into a
   reference test here; an entry of a new shape fails until both this reference and isContainerMatch know it. */
const entries = eval(/const CONTAINER_SELECTOR = (\[[\s\S]*?\])\.join\(','\);/.exec(source)[1]);
ok(entries.length >= 40, 'CONTAINER_SELECTOR entries found (' + entries.length + ')');
const CSS_SPACE = /[ \t\n\f\r]+/;
const lower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const reference = entries.map((entry) => {
  if (entry === 'dialog') return (el) => el.localName === 'dialog';
  const m = /^\[([a-z-]+)(\*=|\^=|~=|\$=|=)"([^"]*)"( i)?\]$/.exec(entry);
  assert(m, 'CONTAINER_SELECTOR entry of an unknown shape: ' + entry);
  const [, attr, op, value, insensitive] = m;
  const fold = insensitive ? lower : (s) => s;
  const want = fold(value);
  return (el) => {
    const got = el.getAttribute(attr);
    if (got === null || !want) return false;
    const v = fold(got);
    if (op === '=') return v === want;
    if (op === '*=') return v.includes(want);
    if (op === '^=') return v.startsWith(want);
    if (op === '$=') return v.endsWith(want);
    return v.split(CSS_SPACE).includes(want);
  };
});
const fakeEl = (localName, attrs) => ({
  localName, tagName: localName.toUpperCase(),
  hasAttributes: () => Object.keys(attrs).length > 0,
  getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
});
const words = ['cookie', 'COOKIE', 'Consent', 'privacy', 'gdpr', 'cmp', 'OneTrust', 'didomi', 'usercentrics', 'trustarc', 'sourcepoint', 'osano',
  'termly', 'axeptio', 'truste', 'cky', 'CKY', 'cky-', 'cky-x', 'x-cky', 'cky_', 'ckyx', ' ', '\t', '\n', '\u00A0', 'dialog', 'Dialog', 'true', 'TRUE',
  'banner', 'nav', '-', '', 'co', 'okie', 'con\u017Fent', 'COOK\u0130E', 'privac'];
const names = ['id', 'class', 'role', 'aria-modal', 'aria-label', 'data-testid', 'title', 'name'];
let agreed = 0, fuzzMatches = 0;
const FUZZ = 20000;
for (let t = 0; t < FUZZ; t++) {
  const attrs = {};
  for (const n of names) if (!rand(3)) attrs[n] = Array.from({ length: rand(4) }, () => words[rand(words.length)]).join('');
  const el = fakeEl(['div', 'section', 'dialog', 'span', 'aside'][rand(5)], attrs);
  const want = reference.some((f) => f(el));
  if (want) fuzzMatches++;
  if (api.isContainerMatch(el) === want) agreed++;
  else assert.fail('isContainerMatch disagrees with CONTAINER_SELECTOR on ' + el.localName + ' ' + JSON.stringify(attrs));
}
ok(agreed === FUZZ && fuzzMatches > 2000 && fuzzMatches < FUZZ - 2000, 'isContainerMatch agrees with every CONTAINER_SELECTOR entry on ' + FUZZ + ' random elements (' + fuzzMatches + ' matches)');
for (const entry of entries) {
  const m = /^\[([a-z-]+)(\*=|\^=|~=|\$=|=)"([^"]*)"( i)?\]$/.exec(entry);
  const el = m ? fakeEl('div', { [m[1]]: m[2] === '~=' || m[2] === '*=' ? 'x ' + m[3] + ' y' : m[3] }) : fakeEl('dialog', {});
  ok(api.isContainerMatch(el), 'the pass matches the entry ' + entry);
}
for (const [label, attrs] of [['a no break space is not a class separator', { class: 'x\u00A0cky' }], ['ckyx is not cky', { class: 'ckyx' }],
  ['role is case sensitive', { role: 'Dialog' }], ['aria-modal is case sensitive', { 'aria-modal': 'TRUE' }], ['a title does not count', { title: 'cookie' }]]) {
  ok(!api.isContainerMatch(fakeEl('div', attrs)), label);
}
/* iubenda.com's banner is a role="alertdialog" (2026-11-20). */
ok(entries.includes('[role="alertdialog"]') && api.isContainerMatch(fakeEl('div', { role: 'alertdialog' })), 'an alert dialog is a container');
const tree = [fakeEl('div', { id: 'app' }), fakeEl('div', { class: 'cookie-banner' }), fakeEl('dialog', {}), fakeEl('p', {}), fakeEl('div', { role: 'dialog' })];
const order = (list) => list.map((el) => tree.indexOf(el)).join(',');
ok(order(api.queryContainers({ getElementsByTagName: (t) => (t === '*' ? tree : []) })) === '1,2,4', 'a document is walked in tree order');
ok(order(api.queryContainers({ querySelectorAll: (s) => (s === '*' ? tree : []) })) === '1,2,4', 'so is a shadow root, which has no getElementsByTagName');
ok(!/querySelectorAll\(CONTAINER_SELECTOR\)/.test(between('function containerMatches(root)', 'function isContainerMatch(el)')), 'containerMatches no longer runs the selector itself');

/* The stem list is derived from REJECT_RE: if a phrase is added there, a stem must cover it here. */
const alternatives = /const REJECT_RE = \/\\b\((.*)\)\\b\/i;/.exec(reject)[1];
ok(alternatives.split('|').length > 20, 'REJECT_RE alternatives found');
console.log('[ok] consent scan cost: ' + checks + ' checks');

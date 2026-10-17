/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A page that explains what WardenOne detects is not the thing it detects.
 *
 * WardenOne's website lists every protection with its name, its default and its description,
 * generated from settings-data.js. Opened with WardenOne running, that features page got the
 * full-screen tech-support scam warning (and the bridge's copy of it): the scam guard's own
 * description quotes fake "your computer is infected / locked -- call this number" pages. The
 * home page got the ClickFix warning for saying a fake "verify you're human" page tells you to
 * press Win+R and paste a command.
 *
 * This builds that features page's text from the settings data the site is generated from, the
 * way the site lays it out, and runs the shipped page-text detectors (Scam Lock, ClickFix, Fake
 * Update) from content.min.js over it. None may warn. And the fix must not become a way past
 * them: the same descriptions pasted into a real scam page do not save it.
 *
 * Run: node tools/test-feature-page-warnings.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

function slice(from, to) {
  const start = CONTENT.indexOf(from);
  const end = CONTENT.indexOf(to, start);
  assert(start >= 0 && end > start, 'shipped markers are missing: ' + from);
  return CONTENT.slice(start, end);
}
const SCAM_LOCK = slice('if(WO.scamLockGuard&&WO_TOP)try{', 'if(WO.commandPasteGuard)try{');
const CLICKFIX = slice('if(WO.commandPasteGuard)try{', 'if(WO.fakeUpdateDetector&&WO_TOP)try{');
const FAKE_UPDATE = slice('if(WO.fakeUpdateDetector&&WO_TOP)try{', 'if(WO.insecureLoginGuard!==!1)try{');

/* The warning registry sits outside the ClickFix slice; built from the shipped source, as
   tools/test-clickfix-guard.js does, so the guard reads the page the way it really does. */
const NL = String.fromCharCode(10);
const WARN_START = SOURCE.indexOf('const __woWarn={');
const WARN_END = SOURCE.indexOf(NL + '  };', WARN_START);
assert(WARN_START >= 0 && WARN_END > WARN_START, 'shipped warning-registry markers are missing');
const WARN_REGISTRY_SOURCE = SOURCE.slice(WARN_START, WARN_END + 5);

/* ---- the features page, from the data the site is generated from ---------------------------- */
const settingsSandbox = {};
vm.createContext(settingsSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'settings-data.js'), 'utf8') + ';this.__data=SETTINGS_DATA;', settingsSandbox);
const DATA = settingsSandbox.__data;
const SECTIONS = DATA.sections.concat((DATA.carried || []).map((c) => ({ title: (c.rows[0] && c.rows[0].section) || '', rows: c.rows })));
const entry = (row) => [row.name, 'Default: ' + (DATA.defaults[row.key] === false ? 'off' : 'on'), '', row.desc, ''].join(NL);
const sectionText = (s) => [s.title, ''].concat(s.rows.map(entry)).join(NL);
const ROWS = SECTIONS.flatMap((s) => s.rows);
const FEATURES_PAGE = ['Features', '108 protections.', 'Every one', 'explained.', ''].concat(SECTIONS.map(sectionText)).join(NL);

/* Wording is assembled from fragments: an on-access scanner reading this file from disk would
   otherwise see a scam page (see tools/test-clickfix-guard.js). */
const t = (...parts) => parts.join('');
const PLUS = String.fromCharCode(43);
const PHONE = () => t('1-8', '44-555-', '0199');
const HOME_CLICKFIX = () => t('A scam instruction gets interrupted, not quietly logged.', NL, NL,
  'A fake “verify you\'re human” page tells you to press Win', PLUS, 'R and paste a command. ',
  'WardenOne recognises the ClickFix trick and explains it before you follow the steps.');
const REAL_SCAM = () => t('Windows Defender Security Center', NL, 'Access to this PC ', 'has been blocked for security reasons.',
  NL, 'Your computer has been infected with spyware.', NL, 'Call Windows Support: +', PHONE(), ' (Toll Free)');
const REAL_LURE = () => t('Verify you are human', NL, 'Please verify that you are a human to continue.', NL,
  'Verification steps', NL, '1. Press Win', PLUS, 'R', NL, '2. Press Ctrl', PLUS, 'V', NL, '3. Press Enter');

/* ---- harnesses: the shipped blocks, run against text ----------------------------------------- */
function node(tagName) {
  return {
    tagName: String(tagName || 'div').toUpperCase(), id: '', textContent: '', children: [], attrs: {}, isConnected: true,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener() {}, remove() { this.isConnected = false; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    querySelector() { return null; },
  };
}

function scamLock(text, opts) {
  const o = opts || {};
  const logs = [];
  const root = node('html');
  const document = { documentElement: root, body: node('body'), createElement: node, fullscreenElement: o.fullscreen ? root : null, pointerLockElement: null };
  const sandbox = {
    WO: { scamLockGuard: true }, WO_TOP: true,
    document, window: {}, history: { length: 1, back() {} }, location: new URL(o.page || 'https://wardenone.example/features/'),
    Object, String, Date, Math, setTimeout() {},
    trustedMediaHost: false, conversationHost: false, searchResultsHost: false,
    /* The engine reads the first 20,000 characters, as bodyTextCapped does. */
    bodyTextCapped: (cap) => text.slice(0, cap),
    __woWarn: { up() { return false; }, mark() {} },
    woDialog: () => () => {},
    woOn() {},
    log(type) { logs.push(type); },
    __woTextScan: { add(s) { return { now() { return s.run(); } }; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(SCAM_LOCK, sandbox, { filename: 'scam-lock-slice.js' });
  return { warned: logs.includes('warned_techsupport_scam'), panel: root.children.some((c) => c.id === 'wo-scam-lock') };
}

const CLICKFIX_TYPES = new Set(['warned_clickfix_instruction', 'warned_clickfix_fake_captcha', 'warned_clickfix_clipboard',
  'warned_clickfix_correlated', 'warned_command_paste']);
function clickfix(text, opts) {
  const o = opts || {};
  const logs = [];
  const body = node('body');
  body.textContent = text;
  body.innerText = text;
  const document = {
    body, documentElement: node('html'), activeElement: null, createElement: node,
    getSelection() { return ''; }, execCommand() { return true; },
  };
  const sandbox = {
    WO: { commandPasteGuard: true }, WO_TOP: true,
    navigator: { userActivation: { isActive: false }, clipboard: { writeText: (v) => Promise.resolve(v), write: (v) => Promise.resolve(v) } },
    document, location: new URL(o.page || 'https://wardenone.example/'),
    DOMException, Promise, Set, Map, Object, String, RegExp, Array, Date,
    __woWarn: vm.runInNewContext(WARN_REGISTRY_SOURCE + NL + '__woWarn;', { Map, String }),
    conversationHost: false, searchResultsHost: false,
    log(type, detail) { logs.push({ type, detail }); },
    woOn() {}, woObserve() { return { disconnect() {} }; },
    __woTextScan: { add(spec) { return { now() { return spec.run(); } }; } },
    setTimeout() { return 0; }, clearTimeout() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(CLICKFIX, sandbox, { filename: 'clickfix-guard-slice.js' });
  return { activities: logs.filter((e) => CLICKFIX_TYPES.has(e.type)), panels: body.children.length };
}

function fakeUpdate(text) {
  const logs = [];
  /* The site's own Download button, which points off the page's host to the release. */
  const download = { textContent: 'Download', href: 'https://github.com/iri-dev/WardenOne/releases/latest', getAttribute() { return this.href; } };
  const sandbox = {
    WO: { fakeUpdateDetector: true }, WO_TOP: true,
    document: { body: node('body'), querySelector: () => null, querySelectorAll: () => [download] },
    location: new URL('https://wardenone.example/features/'), URL, String, RegExp,
    regDomain: (h) => String(h || '').replace(/^www\./, '').toLowerCase(),
    searchResultsHost: false,
    bodyTextCapped: (cap) => text.slice(0, cap),
    log(type) { logs.push(type); }, woOn() {},
    __woTextScan: { add(s) { return { now() { return s.run(); } }; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(FAKE_UPDATE, sandbox, { filename: 'fake-update-slice.js' });
  return { warned: logs.includes('warned_fake_update') };
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (error) {
    console.error('FAIL - ' + name);
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

/* ---- the fixture is what tripped the guards ------------------------------------------------- */
check('the fixture still carries the wording that tripped Scam Lock', () => {
  const scam = ROWS.find((row) => row.key === 'scamLockGuard');
  assert(scam, 'the scam guard has no row in settings-data.js');
  const block = SCAM_LOCK;
  const fear = vm.runInNewContext(/FEAR=(\/.*?\/[gimsuy]*),CALL=/.exec(block)[1]);
  const call = vm.runInNewContext(/CALL=(\/.*?\/[gimsuy]*),breakLeaveTrap=/.exec(block)[1]);
  /* If the description is ever reworded so that it no longer says both, this suite stops
     proving anything about it; say so rather than pass quietly. */
  assert(fear.test(scam.desc) && call.test(scam.desc),
    'the scam guard description no longer contains a claim and a call; replace this fixture with wording that does');
  assert(ROWS.length >= 100, 'only ' + ROWS.length + ' protections were read from settings-data.js');
});

/* ---- Scam Lock -------------------------------------------------------------------------------- */
check('the features page is not locked as a tech-support scam, whichever protection it lists first', () => {
  /* The engine judges the first claim in the first 20,000 characters, so which description
     gets judged depends on how the site orders and groups them -- the site's grouping is its
     own, not settings-data.js's. Every order is covered by putting each entry first in turn. */
  const r = scamLock(FEATURES_PAGE);
  assert(!r.warned && !r.panel, 'the features page was locked as a scam');
  for (const row of ROWS) {
    const page = t('Features', NL, '108 protections.', NL, entry(row), NL, FEATURES_PAGE);
    assert(!scamLock(page).warned, 'the features page was locked as a scam with "' + row.name + '" listed first');
  }
});

check('no section, and no single description, is locked either', () => {
  /* The engine reads the first claim in the first 20,000 characters; a description further
     down the page is read once text above it scrolls away or the page is rearranged. */
  for (const s of SECTIONS) assert(!scamLock(sectionText(s)).warned, 'the ' + s.title + ' section was locked as a scam');
  for (const row of ROWS) assert(!scamLock(entry(row)).warned, 'the "' + row.name + '" description was locked as a scam');
});

check('a real tech-support scam page is still locked', () => {
  const r = scamLock(REAL_SCAM());
  assert(r.warned && r.panel, 'a real scam page was not locked');
});

check('copying the descriptions onto a scam page does not save it', () => {
  /* Nothing here is an allowlist: the page's own words, wherever they came from, are not asked
     whether they are a scam. A scam that pastes WardenOne's feature list above its script is
     read like any other page. */
  const scamRow = entry(ROWS.find((row) => row.key === 'scamLockGuard'));
  assert(scamLock(scamRow + NL + REAL_SCAM()).warned, 'the scam guard description in front of a scam hid it');
  assert(scamLock(REAL_SCAM() + NL + scamRow).warned, 'the scam guard description after a scam hid it');
  assert(scamLock(t(FEATURES_PAGE.slice(0, 4000), NL, REAL_SCAM())).warned, 'the features page in front of a scam hid it');
});

check('the description with a browser lock in force is the scam', () => {
  /* The behaviour the guard's words stood in for: a page that takes the screen and says this. */
  const scamRow = entry(ROWS.find((row) => row.key === 'scamLockGuard'));
  assert(scamLock(scamRow, { fullscreen: true }).warned, 'a full-screen page carrying the claim and the call was not locked');
});

/* ---- ClickFix --------------------------------------------------------------------------------- */
check('the features page and the home page are not reported as ClickFix', () => {
  for (const [what, text] of [['the features page', FEATURES_PAGE], ['the home page', HOME_CLICKFIX()]]) {
    const r = clickfix(text);
    assert.strictEqual(r.activities.length, 0, what + ': ' + JSON.stringify(r.activities.map((a) => a.type)));
    assert.strictEqual(r.panels, 0, what + ' got a warning panel');
  }
  for (const row of ROWS) {
    const r = clickfix(entry(row));
    assert.strictEqual(r.activities.length, 0, 'the "' + row.name + '" description was reported as ClickFix');
  }
});

check('a real ClickFix lure is still reported', () => {
  const r = clickfix(REAL_LURE());
  const types = r.activities.map((a) => a.type);
  assert(types.includes('warned_clickfix_fake_captcha'), 'the lure was not reported: ' + types.join(','));
  assert(r.panels > 0, 'the lure got no panel');
});

check('a lure that quotes its own heading still meets the step check', () => {
  /* Quoting the verification wording makes it reported speech, not a free pass: the steps are
     still steps, and the paste beside them is still the trick. */
  const quoted = REAL_LURE().replace('Verify you are human', '"Verify you are human"').replace('Please verify that you are a human', '"Please verify that you are a human"');
  const r = clickfix(quoted);
  const types = r.activities.map((a) => a.type);
  assert(types.length > 0, 'quoting the heading hid the lure');
  assert(r.panels > 0, 'quoting the heading took the panel away');
});

check('the home page sentence with the lure\'s paste step beside it is the lure', () => {
  const r = clickfix(t(HOME_CLICKFIX(), NL, 'Press Ctrl', PLUS, 'V'));
  assert(r.activities.length > 0, 'a paste step beside the steps was not reported');
});

/* ---- Fake Update ------------------------------------------------------------------------------ */
check('the features page is not a fake update, even with its Download button', () => {
  assert(!fakeUpdate(FEATURES_PAGE).warned, 'the features page was reported as a fake update');
  for (const row of ROWS) assert(!fakeUpdate(entry(row)).warned, 'the "' + row.name + '" description was reported as a fake update');
});

check('this suite is wired into the gate', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');
  assert(/checkCommand\([^)]*'tools\/test-feature-page-warnings\.js'/.test(gate), 'tools/check-maintainability.js does not run it');
});

console.log('\n' + passed + ' feature page warning checks passed.');

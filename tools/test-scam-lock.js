/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Scam Lock's page-text half: a claim or a number to call, not two names.
 *
 * Executes the shipped Scam Lock block from content.min.js against page text. A list of
 * Windows commands ("wscui.cpl: Windows Security Center", "mstsc: Remote Desktop
 * Connection") matched both halves of the pattern and was locked as a scam, and so was a
 * search for the scam itself. Real scam pages must still be caught.
 *
 * Run: node tools/test-scam-lock.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const start = CONTENT.indexOf('if(WO.scamLockGuard&&WO_TOP)try{');
const end = CONTENT.indexOf('if(WO.commandPasteGuard)try{', start);
assert(start >= 0 && end > start, 'shipped Scam Lock markers are missing');
const SLICE = CONTENT.slice(start, end);

/* Scam wording is assembled from fragments: an on-access scanner reading this file from
   disk would otherwise see a tech-support scam page, the way one already quarantines
   tools/test-clickfix-guard.js for its fake-CAPTCHA fixtures. */
const t = (...parts) => parts.join('');
const PHONE = () => t('1-8', '44-555-', '0199');
const LOCKED = () => t('Access to this PC ', 'has been ', 'blocked for security reasons.');

function node() {
  return {
    id: '', children: [], textContent: '',
    setAttribute() {}, addEventListener() {}, remove() {},
    appendChild(child) { this.children.push(child); return child; },
  };
}

function scan(text, opts) {
  const o = opts || {};
  const logs = [];
  const root = node();
  let spec = null;
  const sandbox = {
    WO: { scamLockGuard: true }, WO_TOP: true,
    document: { documentElement: root, body: node(), createElement: node },
    window: {}, history: { length: 1, back() {} }, location: new URL(o.page || 'https://example.test/'),
    Object, String, Date, Math, setTimeout() {},
    trustedMediaHost: false, conversationHost: false, searchResultsHost: !!o.searchResultsHost,
    bodyTextCapped: () => text,
    __woWarn: { up() { return false; }, mark() {} },
    woDialog: () => () => {},
    woOn() {},
    log(type) { logs.push(type); },
    __woTextScan: { add(s) { spec = s; return { now() { return s.run(); } }; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox, { filename: 'scam-lock-slice.js' });
  return {
    warned: logs.includes('warned_techsupport_scam'),
    panel: root.children.some((child) => child.id === 'wo-scam-lock'),
    run: (snapshot) => spec.run(snapshot),
  };
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

const SCAMS = [
  ['a blocked-PC page with a support number', t('Windows Defender Security Center\n', LOCKED(),
    '\nYour computer has been infected with spyware.\nCall Windows Support: +', PHONE(), ' (Toll Free)')],
  ['an alert with a number and a do-not-close line', t('Critical security alert!\nYour PC is infected. ',
    'Do not close this window.\nCall Microsoft Support now at ', PHONE(), '.')],
  ['a lock claim with a remote tool and no number', t('Your computer has been ', 'locked.\nDownload AnyDesk and ',
    'enter the code our technician gives you to unlock it.')],
  ['a product name with a helpline number', t('Windows Security Center\nTechnical support helpline: ', PHONE(),
    '\nDo not ignore this warning.')],
  ['names and a do-not-close line with a call to support', t('Windows Defender Security Center\n',
    'Do not close this window.\nCall support immediately.')],
];

const HOW_TOS = [
  ['a list of Run commands', 'Useful Run commands\nPress Windows key and R, then type one of these and press Enter.\n'
    + 'control - Control Panel\nwscui.cpl - Windows Security Center\nmstsc - Remote Desktop Connection\n'
    + 'msra - Windows Remote Assistance\nquickassist - Quick Assist'],
  ['an sfc tutorial', 'Type sfc /scannow and press Enter.\nDo not close this window until the scan reaches 100%.\n'
    + 'If Windows asks, enter the PIN for your account.'],
  ['an article about backups', 'Without a backup your files are at risk. Quick Assist and Remote Desktop let a '
    + 'family member help you set one up.'],
  ['a registry tip', 'regedit - Registry Editor\nCritical warning: back up the registry before you change it. '
    + 'If something breaks, contact Microsoft Support or use Remote Assistance.'],
  /* Taking a name out must not join its neighbours into a call to action: without the name,
     "call the Quick Assist helpline" reads "call the helpline". */
  ['a scam-awareness tip', 'Windows Security Center never shows a phone number. If a pop-up tells you to call the '
    + 'Quick Assist helpline, close it.'],
];

check('a tech-support scam page is still locked', () => {
  for (const [name, text] of SCAMS) {
    const r = scan(text);
    assert(r.warned, 'not recognised: ' + name);
    assert(r.panel, 'no lock panel for: ' + name);
  }
});

check('names and how-to phrases on their own are not a scam', () => {
  for (const [name, text] of HOW_TOS) {
    const r = scan(text);
    assert(!r.warned && !r.panel, 'locked as a scam: ' + name);
  }
});

check('an ordinary phrase never hides a real claim beside it', () => {
  /* Taking the ordinary phrases out must not take the claim or the number with them. */
  const ordinary = ['Windows Security Center', 'critical warning', 'your files are at risk', 'do not close this window',
    'contact Microsoft Support', 'AnyDesk', 'Quick Assist', 'Remote Desktop', 'enter the code', 'run the support tool'];
  for (const phrase of ordinary) {
    assert(scan(t(phrase, '.\n', LOCKED(), '\nCall us now.')).warned, 'a claim beside "' + phrase + '" was lost');
    assert(scan(t(phrase, '.\nYour PC is infected.\nPhone ', PHONE())).warned, 'a number beside "' + phrase + '" was lost');
  }
});

check('a pass leaves nothing behind for the next one', () => {
  /* The ordinary-phrase pattern is global so it can be replaced throughout a window; a
     global regex that kept its lastIndex would skip matches on the next page state. */
  const r = scan('An ordinary page about gardening.');
  assert(!r.run(HOW_TOS[0][1]), 'the how-to page was locked on a later pass');
  assert(!r.run(HOW_TOS[2][1]), 'a second how-to page was locked on a later pass');
  assert(r.run(SCAMS[0][1]), 'a scam arriving after ordinary text was missed');
});

check('search results are not the page talking', () => {
  const results = t('microsoft support popup scam\nAI Overview\nScammers show a fake alert saying "Your computer has been ',
    'locked" and tell you to call Microsoft Support at a toll-free number. Never let them install AnyDesk.');
  assert(scan(results, { page: 'https://blog.example/scams' }).warned, 'the control page did not trigger at all');
  const engine = scan(results, { page: 'https://www.google.com/search?q=scam', searchResultsHost: true });
  assert(!engine.warned && !engine.panel, 'a search about a scam was locked as the scam');
});

check('this suite is wired into the gate', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');
  assert(/checkCommand\([^)]*'tools\/test-scam-lock\.js'/.test(gate), 'tools/check-maintainability.js does not run it');
});

console.log('\n' + passed + ' Scam Lock checks passed.');

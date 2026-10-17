/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Scam Lock's page-text half: a claim or a number to call, not two names -- and the means to
 * act on it, not the words alone.
 *
 * Executes the shipped Scam Lock block from content.min.js against page text. A list of
 * Windows commands ("wscui.cpl: Windows Security Center", "mstsc: Remote Desktop
 * Connection") matched both halves of the pattern and was locked as a scam, and so was a
 * search for the scam itself, and so was WardenOne's own feature list describing the scam
 * (tools/test-feature-page-warnings.js). Real scam pages must still be caught: by the number
 * they give, the remote-access code they ask for, or the lock they put on the browser.
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

/* opts.lock: 'fullscreen' | 'pointer' | 'leave-trap' -- a browser lock already in force when
   the text is read ('leave-trap' is a leave-page handler, which must NOT count). opts.dialogs:
   the page has native dialogs to call (see dialog()). */
function scan(text, opts) {
  const o = opts || {};
  const logs = [];
  const reasons = [];
  const root = node();
  const listeners = Object.create(null);
  let spec = null;
  const shown = [];
  const document = { documentElement: root, body: node(), createElement: node, fullscreenElement: null, pointerLockElement: null };
  const window = {};
  if (o.dialogs) ['alert', 'confirm', 'prompt'].forEach((name) => { window[name] = (msg) => { shown.push(String(msg)); }; });
  const lock = (kind, element) => {
    if (kind === 'fullscreen') document.fullscreenElement = element || root;
    if (kind === 'pointer') document.pointerLockElement = document.body;
    if (kind === 'leave-trap') window.onbeforeunload = () => 'Are you sure?';
  };
  if (o.lock) lock(o.lock);
  const sandbox = {
    WO: { scamLockGuard: true }, WO_TOP: true,
    document, window, history: { length: 1, back() {} }, location: new URL(o.page || 'https://example.test/'),
    Object, String, Date, Math, setTimeout() {},
    trustedMediaHost: false, conversationHost: false, searchResultsHost: !!o.searchResultsHost,
    bodyTextCapped: () => text,
    __woWarn: { up() { return false; }, mark() {} },
    woDialog: () => () => {},
    woOn(target, type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    log(type, detail) { logs.push(type); if (detail && detail.reason) reasons.push(detail.reason); },
    __woTextScan: { add(s) { spec = s; return { now() { return s.run(); } }; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox, { filename: 'scam-lock-slice.js' });
  const result = {
    get warned() { return logs.includes('warned_techsupport_scam'); },
    get panel() { return root.children.some((child) => child.id === 'wo-scam-lock'); },
    reasons,
    shown,
    run: (snapshot) => spec.run(snapshot),
    /* The lock starting after the text was read, the way a locker takes the screen on the
       reader's first click. */
    startLock(kind, event, element) { lock(kind, element); for (const fn of listeners[event] || []) fn(); },
    dialog: (msg) => window.alert(msg),
  };
  return result;
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
  ['a number written with brackets', t('Your computer has been ', 'locked.\nCall Windows Support at +1 (8', '44) 555-0199 now.')],
  ['an international number', t('Critical security alert! Your PC is infected.\nCall Microsoft Support: +44 20 ', '7946 0958')],
  ['a remote-access code asked for the other way round', t('Your computer has been ', 'locked.\nRead the ID shown in ',
    'TeamViewer to our technician to unlock it.\nCall support immediately.')],
];

/* The claim and the call with nothing to act on them: what a page says ABOUT the scam.
   WardenOne's own feature list reads like the first one. */
const DESCRIPTIONS = [
  ['a feature description quoting the scam', t('Tech-support scam guard\nDetects fake "your computer is ',
    'infected / locked - call this number" pages and browser-lockers.')],
  ['names and a do-not-close line with a call to support', t('Windows Defender Security Center\n',
    'Do not close this window.\nCall support immediately.')],
  ['a warning about remote tools with no code asked for', t('Scam pages say "your computer has been ',
    'locked" and tell you to call support. Never let a stranger install AnyDesk on your PC.')],
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

check('the claim and the call with no means to act on them are a description, not a scam', () => {
  for (const [name, text] of DESCRIPTIONS) {
    const r = scan(text);
    assert(!r.warned && !r.panel, 'locked as a scam: ' + name);
  }
});

check('the same words with a browser lock in force are the scam', () => {
  /* A locker whose number is drawn as an image still holds the browser: the lock is the
     behaviour the words were standing in for. */
  for (const kind of ['fullscreen', 'pointer']) {
    const r = scan(DESCRIPTIONS[1][1], { lock: kind });
    assert(r.warned && r.panel, 'not recognised with a ' + kind + ' lock');
    assert(/browser lock/.test(r.reasons[0]), 'the reason does not name the lock: ' + r.reasons[0]);
  }
});

check('a leave-page handler is not a lock', () => {
  /* Every editor with unsaved changes sets one -- a forum reply quoting the scam included. */
  const r = scan(DESCRIPTIONS[1][1], { lock: 'leave-trap' });
  assert(!r.warned && !r.panel, 'an unsaved-changes handler was taken for a browser lock');
});

check('a lock that starts after the text was read is still caught', () => {
  /* Lockers take the screen on the first click, after the load-time pass found nothing. */
  for (const [kind, event] of [['fullscreen', 'fullscreenchange'], ['fullscreen', 'webkitfullscreenchange'], ['pointer', 'pointerlockchange']]) {
    const r = scan(DESCRIPTIONS[1][1]);
    assert(!r.warned, 'locked before any lock');
    r.startLock(kind, event);
    assert(r.warned && r.panel, 'missed a ' + kind + ' lock reported by ' + event);
  }
  /* And a lock on a page that only describes the scam is not invented into one by the event. */
  const quiet = scan('An ordinary page about gardening.');
  quiet.startLock('fullscreen', 'fullscreenchange');
  assert(!quiet.warned, 'a fullscreen page with no scam text was locked');
});

check('a player taking the screen is not a lock', () => {
  /* A video about the scam, watched full screen on an article about it, holds the screen while
     the article's words sit behind it. Embedded players arrive as an iframe. */
  const leaf = (tagName) => Object.assign(node(), { tagName, querySelector: () => null });
  const holding = (tagName) => Object.assign(node(), { tagName: 'DIV', querySelector: (sel) => (sel.split(',').includes(tagName.toLowerCase()) ? leaf(tagName) : null) });
  const cases = [['a video', leaf('VIDEO'), false], ['an embedded player', leaf('IFRAME'), false], ['a game canvas', leaf('CANVAS'), false],
    ['a video player wrapper', holding('VIDEO'), false], ['an embed wrapper', holding('IFRAME'), false], ['a page panel', leaf('DIV'), true]];
  for (const [what, element, locked] of cases) {
    const r = scan(DESCRIPTIONS[1][1]);
    r.startLock('fullscreen', 'fullscreenchange', element);
    assert.strictEqual(r.warned, locked, what + ' full screen ' + (locked ? 'was not counted as a lock' : 'was counted as a lock'));
  }
});

check('a page dialog is the page talking, and what it says is read', () => {
  /* The claim and the number only in the dialog, the body an image: caught on the first one. */
  const r = scan('', { dialogs: true });
  r.dialog(t('Your computer has been ', 'locked. Call Windows Support: ', PHONE()));
  assert(r.warned && r.panel, 'a dialog carrying the claim and a number was not recognised');
  assert.strictEqual(r.shown.length, 0, 'the scam dialog was shown over the warning');
  /* The page's words without a number, then a dialog: the dialog is the behaviour. */
  const d = scan(DESCRIPTIONS[1][1], { dialogs: true });
  assert(!d.warned, 'locked before the dialog');
  d.dialog('Press OK to continue');
  assert(d.warned, 'a dialog over the claim and the call was not counted as the lock');
  assert(/pop-up dialog/.test(d.reasons[0]), 'the reason does not name the dialog: ' + d.reasons[0]);
  /* An ordinary page's dialog is shown as usual and warns about nothing. */
  const plain = scan('A recipe for bread.', { dialogs: true });
  plain.dialog('Saved!');
  assert(!plain.warned && plain.shown.length === 1, 'an ordinary dialog was swallowed or warned about');
});

check('an ordinary phrase never hides a real claim beside it', () => {
  /* Taking the ordinary phrases out must not take the claim or the number with them. The lock
     stands in for the number in the first case, so the claim itself is what is tested. */
  const ordinary = ['Windows Security Center', 'critical warning', 'your files are at risk', 'do not close this window',
    'contact Microsoft Support', 'AnyDesk', 'Quick Assist', 'Remote Desktop', 'enter the code', 'run the support tool'];
  for (const phrase of ordinary) {
    assert(scan(t(phrase, '.\n', LOCKED(), '\nCall us now.'), { lock: 'fullscreen' }).warned, 'a claim beside "' + phrase + '" was lost');
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
  /* People search the number the pop-up gave them, so the results quote it with the script. */
  const results = t(PHONE(), ' microsoft support popup scam\nAI Overview\nScammers show a fake alert saying "Your computer has been ',
    'locked" and tell you to call Microsoft Support at ', PHONE(), '. Never let them install AnyDesk.');
  assert(scan(results, { page: 'https://blog.example/scams' }).warned, 'the control page did not trigger at all');
  const engine = scan(results, { page: 'https://www.google.com/search?q=scam', searchResultsHost: true });
  assert(!engine.warned && !engine.panel, 'a search about a scam was locked as the scam');
});

check('this suite is wired into the gate', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8');
  assert(/checkCommand\([^)]*'tools\/test-scam-lock\.js'/.test(gate), 'tools/check-maintainability.js does not run it');
});

console.log('\n' + passed + ' Scam Lock checks passed.');

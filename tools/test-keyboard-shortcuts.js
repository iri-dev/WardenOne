/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Keyboard shortcuts.
 *
 * These add no protection -- every one of them is a faster route to something the popup
 * or the right-click menu already does -- so what this suite is actually for is the two
 * ways a shortcut goes wrong:
 *
 *   1. It collides. Chrome allows four suggested keys and each one is a chance to take a
 *      combination the reader already uses, so most ship unassigned on purpose.
 *   2. It claims something it does not do. A shortcut listed beside an action it no
 *      longer runs is worse than no list at all, which is why the popup reads the list
 *      from Chrome rather than restating it.
 *
 * runWardenCommandOnActiveTab is lifted out of background.js and run for real.
 *
 * Run: node tools/test-keyboard-shortcuts.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

/* ---- what ships ------------------------------------------------------------ */
const commands = MANIFEST.commands || {};
const names = Object.keys(commands);
const withKeys = names.filter((n) => commands[n].suggested_key);
check('every command carries a description Chrome can show',
  names.every((n) => String(commands[n].description || '').length > 4), JSON.stringify(names));
check('at most four come with a default key', withKeys.length <= 4,
  withKeys.length + ' have one; Chrome only accepts four');
/* Was three, with the fourth deliberately unspent. The command palette took it, and it is
   the one entry that earns it: it is how every other tool is reached without remembering
   a key, so a palette nobody can open by default is a discovery surface nobody discovers.
   All four are now spoken for -- a fifth default would be silently dropped by Chrome,
   which is what the ceiling check below is really guarding. */
check('all four default slots are spent, and no more', withKeys.length === 4,
  withKeys.length + ' defaults; Chrome takes four and silently ignores the rest');
check('the rest ship unassigned', names.length - withKeys.length >= 2, JSON.stringify(names));
for (const n of withKeys) {
  const key = commands[n].suggested_key.default;
  check(n + ' avoids Ctrl+Shift', !/^Ctrl\+Shift/.test(key),
    key + ': Ctrl+Shift+P and Ctrl+Shift+Z are DevTools and redo, and the element tool '
    + 'uses Ctrl+Z itself');
  check(n + ' has a mac binding too', !!commands[n].suggested_key.mac);
}
check('no two defaults are the same key',
  new Set(withKeys.map((n) => commands[n].suggested_key.default)).size === withKeys.length);

/* ---- one tool, one shortcut ------------------------------------------------ */
check('there is no separate picker and zapper command',
  !names.some((n) => /picker/i.test(n)) && !names.some((n) => /zap/i.test(n)),
  'element-picker.js records why those two were merged into one tool; two shortcuts '
  + 'would put the split back through the keyboard');
check('the element tool command exists', names.includes('element-tool'));

/* ---- the handlers, run for real -------------------------------------------- */
const start = BG.indexOf('async function runWardenCommandOnActiveTab(command) {');
const end = BG.indexOf('\n}\n', start);
check('the handler is where the slice expects it', start > 0 && end > start);
const BLOCK = BG.slice(start, end + 3);

function makeRunner(world) {
  const o = world || {};
  const acted = [];
  let stored = { wardenone_config: o.config || {} };
  const sandbox = {
    String, Number, Object, Boolean, Date, URL, Promise, RegExp, console,
    /* Every constant the dispatcher names. A missing one throws a ReferenceError into the
       function's own catch, which returns silently -- so the command under test appears to
       "do nothing" and the failure points at the wrong thing entirely. */
    WO_COMMAND_PALETTE: 'command-palette',
    openCommandPalette: (tab) => acted.push(['palette', tab.id]),
    WO_COMMAND_ELEMENT_TOOL: 'element-tool',
    WO_COMMAND_NETWORK_LOGGER: 'open-network-logger',
    WO_COMMAND_PAUSE_SITE: 'pause-site',
    WO_COMMAND_SCAN_SITE: 'scan-site',
    WO_SHORTCUT_PAUSE_MINUTES: 60,
    tabsQuery: () => Promise.resolve(o.tab === null ? [] : [o.tab || { id: 7, url: 'https://shop.example/x' }]),
    startElementTool: (tab, frameId) => acted.push(['element', tab.id, frameId]),
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://wo/' + p },
      tabs: { create: (opts) => { acted.push(['open', opts.url]); return Promise.resolve(); } },
    },
    localGet: () => Promise.resolve(stored),
    localSet: (obj) => { stored = Object.assign({}, stored, obj); acted.push(['save']); return Promise.resolve(); },
    runWardenManualCheck: (url, tab) => { acted.push(['scan', url]); return Promise.resolve(); },
    wardenManualNotice: (title, text) => { acted.push(['notice', title, text]); return Promise.resolve(); },
    /* The real resolver pair, so this suite cannot pass against a stand-in that agrees
       with the shipped one only by accident. */
    normalizeAllowlistHost: (h) => String(h || '').replace(/^www\./, '').toLowerCase(),
  };
  const resolverFrom = BG.indexOf('function sitePausedUntil(cfg, host) {');
  const resolverTo = BG.indexOf('function hostMatchesAllowlist(', resolverFrom);
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(resolverFrom, resolverTo) + BLOCK
    + ';globalThis.__run = runWardenCommandOnActiveTab;', sandbox,
    { filename: 'background.js:shortcuts' });
  return { run: sandbox.__run, acted, config: () => stored.wardenone_config };
}

(async () => {
  {
    const r = makeRunner({});
    await r.run('element-tool');
    check('the element tool opens on the active tab',
      JSON.stringify(r.acted) === JSON.stringify([['element', 7, 0]]), JSON.stringify(r.acted));
  }
  {
    const r = makeRunner({});
    await r.run('open-network-logger');
    check('the logger opens as a tab',
      r.acted.length === 1 && r.acted[0][0] === 'open' && /logger\.html$/.test(r.acted[0][1]),
      JSON.stringify(r.acted));
    check('and does not claim a per-tab scope the logger has not got',
      !/logger\.html\?/.test(r.acted[0][1]),
      'a query string nothing reads is a feature described but not built');
  }
  {
    const r = makeRunner({});
    await r.run('scan-site');
    check('scan checks the page it was pressed on',
      r.acted.length === 1 && r.acted[0][0] === 'scan' && r.acted[0][1] === 'https://shop.example/x',
      JSON.stringify(r.acted));
  }

  /* Pause is the one that changes stored state, so it gets the most of this. */
  {
    const r = makeRunner({});
    await r.run('pause-site');
    const until = (r.config().allowlistUntil || {})['shop.example'];
    check('pausing records an expiry for this host', Number(until) > Date.now(),
      JSON.stringify(r.config()));
    /* "In the future" is not enough. A pause that expires in a century is a permanent
       hole opened by one keystroke, which is the outcome the whole design of this is
       trying to avoid -- so the length is checked, not just the direction. */
    const minutes = (Number(until) - Date.now()) / 60000;
    check('and it is about an hour, not forever', minutes > 55 && minutes <= 61,
      Math.round(minutes) + ' minutes; long enough to diagnose a broken site, short '
      + 'enough that forgetting about it is not permanent');
    check('and says so on the page', r.acted.some((a) => a[0] === 'notice' && /paused/i.test(a[2])),
      JSON.stringify(r.acted));
    check('and says the page needs reloading',
      r.acted.some((a) => a[0] === 'notice' && /reload/i.test(a[2])),
      'a pause that silently does nothing until the next navigation is a pause that looks broken');
  }
  {
    const r = makeRunner({ config: { allowlistUntil: { 'shop.example': Date.now() + 600000 } } });
    await r.run('pause-site');
    check('pressing it again resumes', !(r.config().allowlistUntil || {})['shop.example'],
      JSON.stringify(r.config()));
    check('and says THAT', r.acted.some((a) => a[0] === 'notice' && /resumed/i.test(a[2])),
      JSON.stringify(r.acted));
  }
  {
    const past = { allowlistUntil: { 'shop.example': Date.now() - 1000, 'other.example': Date.now() + 600000 } };
    const r = makeRunner({ config: past });
    await r.run('pause-site');
    const map = r.config().allowlistUntil || {};
    check('a lapsed pause counts as not paused, so this pauses again',
      Number(map['shop.example']) > Date.now(), JSON.stringify(map));
    check('and other sites keep theirs', Number(map['other.example']) > Date.now(), JSON.stringify(map));
  }
  {
    const r = makeRunner({ config: { allowlist: ['shop.example'] } });
    await r.run('pause-site');
    check('a permanently allowlisted site keeps its permanent entry',
      JSON.stringify(r.config().allowlist) === JSON.stringify(['shop.example']),
      'that is a decision made somewhere else; a shortcut must not quietly undo it');
  }
  {
    const r = makeRunner({});
    await r.run('pause-site');
    check('nothing is reloaded', !r.acted.some((a) => a[0] === 'reload'),
      'a keystroke that throws away a half-filled form is a worse surprise than one more '
      + 'keypress');
  }

  /* Pages the tools cannot run on. */
  for (const [what, tab] of [
    ['a chrome:// page', { id: 7, url: 'chrome://settings' }],
    ['the web store', { id: 7, url: 'https://chromewebstore.google.com/' }],
  ]) {
    const r = makeRunner({ tab });
    await r.run('pause-site');
    await r.run('scan-site');
    if (what === 'a chrome:// page') {
      check('nothing happens on ' + what, r.acted.length === 0, JSON.stringify(r.acted));
    }
  }
  {
    const r = makeRunner({ tab: null });
    await r.run('element-tool');
    await r.run('pause-site');
    check('no active tab means no action at all', r.acted.length === 0, JSON.stringify(r.acted));
  }
  {
    const r = makeRunner({});
    await r.run('some-command-that-does-not-exist');
    check('an unknown command does nothing', r.acted.length === 0, JSON.stringify(r.acted));
  }
  {
    const r = makeRunner({});
    await r.run('command-palette');
    check('the palette opens on the tab it was pressed from',
      JSON.stringify(r.acted) === JSON.stringify([['palette', 7]]), JSON.stringify(r.acted));
  }

  /* ---- the list the reader sees --------------------------------------------- */
  /* Two traps in one assertion, both hit while writing it. Without the open paren this
     matched getAllNope, so a rename that stopped the list being read still passed -- a
     prefix is not a call. And the comment above the real call says
     "chrome.commands.getAll()" in prose, so searching the raw file matched the sentence
     describing the code rather than the code. Comments are stripped first. */
  const popupCode = POPUP_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('the popup reads the shortcuts from Chrome',
    /chrome\.commands\.getAll\(/.test(popupCode),
    'a hard-coded table starts lying the moment somebody rebinds one');
  check('and never hard-codes a key beside an action',
    !/Alt\+Shift\+[A-Z]/.test(POPUP_HTML),
    'the same lie, written in the markup instead');
  check('an unassigned command is shown as a state, not a blank',
    /'Not set'/.test(POPUP_JS));
  check('there is a way to change them',
    /chrome:\/\/extensions\/shortcuts/.test(POPUP_JS),
    'Chrome does not let an extension assign its own, so this has to hand off');
  check('the copy says Chrome owns the list', /Chrome owns this list/.test(POPUP_HTML));
  check('every command is wired to a handler',
    names.every((n) => BG.includes("'" + n + "'")), JSON.stringify(names));

  /* ---- the tool's own keys, once it is open --------------------------------- */
  {
    const PICKER = fs.readFileSync(path.join(ROOT, 'element-picker.js'), 'utf8');
    check('Escape leaves and keeps what was hidden',
      /if \(e\.key === 'Escape'\) \{[\s\S]{0,400}stop\(\);/.test(PICKER));
    check('the arrows walk the tree',
      /e\.key === 'ArrowUp'\) \{ widen\(\)/.test(PICKER) && /e\.key === 'ArrowDown'\) \{ narrow\(\)/.test(PICKER));
    check('Enter takes whatever is framed', /e\.key === 'Enter'/.test(PICKER));
    check('and goes through the click path, not straight to zap',
      /e\.key === 'Enter'[\s\S]{0,700}onClick\(\{/.test(PICKER)
      && !/e\.key === 'Enter'[\s\S]{0,700}selectTarget\(/.test(PICKER),
      'the "that covers most of the page" second press has to apply to the keyboard too, '
      + 'or Enter is a trapdoor around a confirmation the mouse still gets');
    check('Enter cannot hide the whole document',
      /e\.key === 'Enter'[\s\S]{0,600}current === document\.body \|\| current === document\.documentElement\) return;/.test(PICKER));
    check('Ctrl+Z stays armed after the tool closes',
      /armGlobalUndo/.test(PICKER) && /UNDO_STATE_KEY/.test(PICKER));
  }

  /* ---- it is not a protection ------------------------------------------------ */
  check('no shortcut is counted as a protection',
    !/'element-tool'|'pause-site'|'scan-site'/.test(BG.match(/const HEALTH_SHIELD_KEYS = \[[\s\S]*?\];/)[0]),
    'they are faster routes to things that already existed, not new engines');

  if (failed) {
    console.error('keyboard shortcuts: ' + failed + ' failed');
    process.exit(1);
  }
  console.log('keyboard shortcuts: all checks passed');
})();

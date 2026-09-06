/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The command palette.
 *
 * It adds no protection -- every entry is a faster route to something that already
 * exists -- but it does add a channel, and that is what this suite is about.
 *
 * The overlay lives IN THE PAGE. So the page can rewrite it, and a message arriving from
 * it is a message from somewhere a hostile script may already be. "Pause WardenOne on
 * this site" is exactly what such a script would reach for, and it is on the list.
 *
 * Three gates, and none of them trusts the sender:
 *   1. the command must be one the background knows;
 *   2. the palette must have been OPENED on that tab, which only the shortcut can do;
 *   3. that opening is consumed, so one press buys one action.
 *
 * The other half is that a message kind sent from a tab has to be on
 * TAB_CONTEXT_ALLOWED_MESSAGES or it never reaches its handler at all -- the bug that
 * killed the search-result warnings silently while every unit test passed.
 *
 * Run: node tools/test-command-palette.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const PALETTE = fs.readFileSync(path.join(ROOT, 'command-palette.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

/* ---- the gate, run for real ------------------------------------------------ */
const start = BG.indexOf('const PALETTE_ALLOWED = new Set([');
const end = BG.indexOf('async function runPaletteCommand(', start);
const sliceable = start > 0 && end > start;
check('the gate is where the slice expects it', sliceable);
if (!sliceable) { console.error('command palette: ' + failed + ' failed'); process.exit(1); }

function makeGate() {
  const injected = [];
  const sandbox = {
    Set, Object, Date, Number, String, console,
    chrome: {
      scripting: { executeScript: (opts, cb) => { injected.push(opts.files[0]); if (cb) cb(); } },
      runtime: { lastError: null },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(start, end)
    + ';globalThis.__open = openCommandPalette;globalThis.__claim = paletteClaim;'
    + 'globalThis.__allowed = PALETTE_ALLOWED;globalThis.__at = PALETTE_OPEN_AT;',
    sandbox, { filename: 'background.js:palette' });
  return { open: sandbox.__open, claim: sandbox.__claim, allowed: sandbox.__allowed,
    at: sandbox.__at, injected: injected };
}

{
  const g = makeGate();
  check('nothing is claimable before the palette is opened', g.claim(7) === false,
    'this is the gate that a forged message has to get past, and it cannot open the palette');
}
{
  const g = makeGate();
  g.open({ id: 7, url: 'https://shop.example/' });
  check('the overlay is injected on open', g.injected.join(',') === 'command-palette.js');
  check('and one action becomes claimable', g.claim(7) === true);
  check('but only one', g.claim(7) === false,
    'without consuming it, a single press would leave a window in which a forged '
    + 'message could run anything on the list');
}
{
  const g = makeGate();
  g.open({ id: 7, url: 'https://shop.example/' });
  check('a different tab cannot spend this tab\'s opening', g.claim(8) === false);
  check('and the real tab still can', g.claim(7) === true);
}
{
  const g = makeGate();
  g.open({ id: 7, url: 'https://shop.example/' });
  g.at[7] = Date.now() - 200000;
  check('an old opening has lapsed', g.claim(7) === false,
    'a stolen moment must not become a standing invitation');
}
for (const url of ['chrome://settings', 'about:blank', 'file:///c:/x.html']) {
  const g = makeGate();
  g.open({ id: 7, url: url });
  check('nothing is injected or claimable on ' + url,
    g.injected.length === 0 && g.claim(7) === false);
}

/* ---- what the palette may ask for ------------------------------------------ */
{
  const g = makeGate();
  for (const forged of ['blocklist-clear', 'firewall-set', 'file-scan-vt', 'privacy-test-run',
    'eval', '__proto__', 'toString', '']) {
    check('the palette cannot ask for "' + forged + '"', !g.allowed.has(forged),
      'the list is the only thing that turns an id into an action');
  }
  check('and the ids it CAN ask for are the ones it shows',
    [...g.allowed].length === 11, [...g.allowed].join(','));
}
{
  /* Both halves have to agree, or an entry is drawn and does nothing. */
  const shown = [...PALETTE.matchAll(/\{ id: '([a-z-]+)'/g)].map((m) => m[1]);
  const g = makeGate();
  check('every entry the overlay draws is one the background will accept',
    shown.every((id) => g.allowed.has(id)),
    shown.filter((id) => !g.allowed.has(id)).join(',') + ' would be drawn and do nothing');
  check('and every command the background accepts is drawn',
    [...g.allowed].every((id) => shown.includes(id)),
    [...g.allowed].filter((id) => !shown.includes(id)).join(',') + ' is reachable but invisible');
}

/* ---- the handler's own gates ------------------------------------------------ */
{
  const at = BG.indexOf("msg.kind === 'palette-run'");
  check('the handler exists', at > 0);
  const handler = BG.slice(at, at + 1200);
  check('it checks the command is on the list', /PALETTE_ALLOWED\.has\(command\)/.test(handler));
  check('it claims the opening', /paletteClaim\(tab\.id\)/.test(handler));
  check('it takes the tab from the SENDER, never from the message',
    /const tab = sender && sender\.tab;/.test(handler) && !/msg\.tabId/.test(handler),
    'a tab id in the message body would let a page act on a different tab');
  check('and refuses a non-web sender', /\^https\?:/.test(handler));
}
{
  /* The bug that killed the search warnings: a kind not on this list never reaches its
     handler, and every unit test still passes. */
  const allowFrom = BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES = new Set([');
  const allowList = BG.slice(allowFrom, BG.indexOf(']);', allowFrom));
  const limits = BG.slice(BG.indexOf('const TAB_CONTEXT_RATE_LIMITS'),
    BG.indexOf('\n};', BG.indexOf('const TAB_CONTEXT_RATE_LIMITS')));
  check("'palette-run' is allowed from a tab at all", allowList.includes("'palette-run'"),
    'the overlay lives in the page, so it sends from a tab');
  check("and 'palette-run' has a rate limit", limits.includes("'palette-run'"));
}

/* ---- reachable without a key ------------------------------------------------ */
{
  /* Chrome applies a suggested key only at INSTALL time, so a command added by an update
     arrives with nothing bound. A palette that can only be opened by a shortcut nobody
     has set yet is a discovery surface nobody discovers. */
  const at = BG.indexOf("msg.kind === 'palette-open'");
  check('the popup can open the palette', at > 0);
  const opener = BG.slice(at, at + 900);
  check('and only an extension page may', /messageSenderIsExtensionPage\(sender\)/.test(opener),
    'a web page able to open the palette could then spend its one-shot claim');
  check('it is not reachable from a tab',
    !BG.slice(BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES = new Set(['),
      BG.indexOf(']);', BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES = new Set(['))).includes("'palette-open'"));
  check('it opens through the same function the shortcut uses',
    /openCommandPalette\(tab\)/.test(opener),
    'a second way in is always the one that turns out to have skipped a gate');
  check('the popup offers the button', /id="open-palette"/.test(
    fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8')));
  check('and the popup explains why a new shortcut is blank',
    /only applies a suggested key when an extension is first installed/.test(
      fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8')),
    'otherwise "Not set" reads as WardenOne being broken rather than as Chrome being Chrome');
}

/* ---- it reuses, rather than reimplements ------------------------------------ */
check('the shared commands go through the shortcut path',
  /await runWardenCommandOnActiveTab\(command\);/.test(BG.slice(BG.indexOf('async function runPaletteCommand'))),
  'two ways to pause a site would be two chances to get the allowlist wrong');
check('there is one element-tool entry, not a picker and a zapper',
  (PALETTE.match(/id: 'element-tool'/g) || []).length === 1
  && !/id: 'element-picker'|id: 'element-zapper'/.test(PALETTE),
  'those two were deliberately merged; two palette rows would put the split back');
check('and the entry says so', /picker and zapper are one tool/.test(PALETTE));

/* ---- the overlay itself ------------------------------------------------------ */
check('it is injected on demand, never resident',
  !/command-palette\.js/.test(JSON.stringify(MANIFEST.content_scripts || [])),
  'a palette has no reason to be in every page for the whole of its life');
check('the page cannot read it', /attachShadow\(\{ mode: 'closed' \}\)/.test(PALETTE));
check('nor restyle it out of the way', /all:initial/.test(PALETTE) && /z-index:2147483647!important/.test(PALETTE));
check('it is built with textContent, never innerHTML', !/innerHTML/.test(PALETTE));
check('Escape closes it even on a page that eats keys',
  /window\.addEventListener\('keydown', onKey, true\)/.test(PALETTE)
  && /e\.key === 'Escape'[\s\S]{0,120}close\(\)/.test(PALETTE));
check('it sends the id and nothing else',
  /sendMessage\(\{ kind: 'palette-run', command: item\.id \}/.test(PALETTE));
/* Anchored to the DEFINITION, not to the word "run" -- which also appears in the mousedown
   handler a few lines above, so a looser pattern matched a different call site and a
   removed close() went unnoticed. */
check('it closes after running, so one opening is one action',
  /function run\(\) \{[\s\S]*?close\(\);\n  \}/.test(PALETTE),
  'the background refuses a second pick anyway, but a palette left on screen with nothing '
  + 'behind it is a control that looks alive and is not');
/* The token survives when the guard is gone -- it is assigned on the next line and cleared
   in close(). What has to be asserted is the early return itself. */
check('it refuses to stack copies of itself',
  /if \(window\.__wardenOnePaletteOpen\) return;/.test(PALETTE),
  'without the guard, holding the shortcut builds a stack of palettes over each other');
check('but the guard is only set once the palette is really on the page',
  PALETTE.indexOf('window.__wardenOnePaletteOpen = true;') > PALETTE.indexOf('appendChild(host);'),
  'set up front, one throw anywhere below leaves the flag stuck true and the palette dead '
  + 'on that page for good -- which is indistinguishable from the key not being bound');

/* ---- typing on a page that wants those keys for itself ------------------------ */
{
  /* The bug: on YouTube, f j k l and m are fullscreen, seek, play/pause, seek and mute.
     Its document handler saw the keydown first and called preventDefault, so those five
     letters never reached the palette's <input> and could not be typed. The palette keeps
     its own query now, and takes every key before the page can have it. */
  check('the palette owns its query rather than relying on an input',
    /let query = '';/.test(PALETTE) && !/document\.createElement\('input'\)/.test(PALETTE),
    'a real input needs the key to survive the page, and plenty of pages take letters');
  check('and swallows every key while it is open',
    /function onKey\(e\) \{[\s\S]{0,400}e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*e\.stopImmediatePropagation\(\);/.test(PALETTE),
    'typing "km" on YouTube would otherwise pause the video and mute it');
  check('including keypress and keyup',
    /for \(const type of \['keypress', 'keyup'\]\) \{\s*window\.addEventListener\(type, eat, true\);/.test(PALETTE),
    'a page listening on either would still act on letters the palette has taken');
  check('it reads keys at window capture, the earliest point there is',
    /window\.addEventListener\('keydown', onKey, true\)/.test(PALETTE));
  check('and gives every listener back when it closes',
    /removeEventListener\('keydown', onKey, true\)/.test(PALETTE)
    && /removeEventListener\(type, eat, true\)/.test(PALETTE),
    'leaving them attached would make the page deaf to its own keyboard, which is worse '
    + 'than the bug this fixes');
  check('it needs no focus, so no page can steal it back',
    !/\.focus\(/.test(PALETTE));
  check('modifier combinations are left to the browser',
    /!e\.ctrlKey && !e\.metaKey && !e\.altKey/.test(PALETTE),
    'a palette that ate Ctrl+T would be worse than one that ate an f');

  /* The handler, run for real, on the exact letters that failed. */
  const from = PALETTE.indexOf('  function onKey(e) {');
  const to = PALETTE.indexOf('  /* Capture, on window', from);
  const box = {
    Math, String, console,
    close: () => { box.closed = true; },
    run: () => { box.ran = true; },
    paint: () => {},
    filter: () => {},
    shown: [{ id: 'a' }, { id: 'b' }],
    index: 0,
    query: '',
    closed: false,
    ran: false,
  };
  vm.createContext(box);
  vm.runInContext('var shown=[{id:"a"},{id:"b"}];var index=0;var query="";'
    + PALETTE.slice(from, to)
    + ';globalThis.__key = onKey;globalThis.__q = () => query;globalThis.__i = () => index;',
    box, { filename: 'command-palette.js:keys' });
  const press = (key, mods) => {
    let prevented = false;
    let stopped = false;
    box.__key(Object.assign({
      key: key,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      stopImmediatePropagation() {},
    }, mods || {}));
    return { prevented: prevented, stopped: stopped };
  };
  for (const letter of ['f', 'j', 'k', 'l', 'm']) {
    const before = box.__q();
    const r = press(letter);
    check('"' + letter + '" reaches the palette', box.__q() === before + letter,
      'got "' + box.__q() + '"; this is the exact set YouTube takes for itself');
    check('and the page never sees it', r.prevented && r.stopped);
  }
  check('the whole word arrives', box.__q() === 'fjklm', box.__q());
  press('Backspace');
  check('backspace removes one', box.__q() === 'fjkl', box.__q());
  press('Backspace', { ctrlKey: true });
  check('ctrl+backspace clears it', box.__q() === '', box.__q());
  press('t', { ctrlKey: true });
  check('ctrl+t is left to the browser', box.__q() === '', box.__q());
  press('ArrowDown');
  check('arrows still move', box.__i() === 1, String(box.__i()));
  press('Escape');
  check('escape still closes', box.closed === true);
}

/* ---- typing finds things ------------------------------------------------------ */
{
  const scoreStart = PALETTE.indexOf('function score(item, query) {');
  const scoreEnd = PALETTE.indexOf('const host = document.createElement');
  const box = { Math, String, console };
  vm.createContext(box);
  vm.runInContext(PALETTE.slice(scoreStart, scoreEnd) + ';globalThis.__score = score;', box,
    { filename: 'command-palette.js:score' });
  const items = [...PALETTE.matchAll(/\{ id: '([a-z-]+)', label: '([^']+)', hint: '[^']*', keys: '([^']+)' \}/g)]
    .map((m) => ({ id: m[1], label: m[2].replace(/\u2019/g, "'"), keys: m[3] }));
  check('the entries parsed for scoring', items.length === 11, String(items.length));
  const best = (q) => items.map((i) => ({ i: i, s: box.__score(i, q) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.i.id)[0];
  check('"log" finds the network logger', best('log') === 'open-network-logger', best('log'));
  check('"priv" finds the privacy test', best('priv') === 'privacy-test', best('priv'));
  check('"zap" finds the element tool', best('zap') === 'element-tool', best('zap'));
  check('"pause" finds the pause command', best('pause') === 'pause-site', best('pause'));
  check('"firew" finds the firewall', best('firew') === 'open-firewall', best('firew'));
  check('an empty query keeps everything',
    items.filter((i) => box.__score(i, '') > 0).length === items.length);
  check('nonsense matches nothing',
    items.filter((i) => box.__score(i, 'qqzzxx') > 0).length === 0);
}

/* ---- it is not a protection --------------------------------------------------- */
check('no shortcut or palette entry is counted as a protection',
  !/'command-palette'|'palette-run'/.test(BG.match(/const HEALTH_SHIELD_KEYS = \[[\s\S]*?\];/)[0]));
check('the palette has a default key', !!(MANIFEST.commands['command-palette']
  && MANIFEST.commands['command-palette'].suggested_key));
check('and Chrome will accept the number of defaults',
  Object.values(MANIFEST.commands).filter((c) => c.suggested_key).length <= 4,
  'Chrome takes four suggested keys and silently drops the rest');

if (failed) {
  console.error('command palette: ' + failed + ' failed');
  process.exit(1);
}
console.log('command palette: all checks passed');

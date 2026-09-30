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
 *   2. the pick must carry the nonce the shortcut handed THIS tab's palette -- opening is
 *      something only the shortcut can do, and the nonce lives on the isolated world's window;
 *   3. that grant is consumed, so one press buys one action.
 *
 * The grant lives in storage.session, not worker memory (MV3-06): the two minutes a palette
 * stays valid are two minutes in which Chrome routinely tears the worker down, and the pick
 * used to wake a new worker with an empty map, which refused it. The gate is driven here
 * with two worker realms sharing one mocked session store.
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
/* Control: point WARDENONE_BACKGROUND / WARDENONE_PALETTE at pre-fix copies. */
const BG = fs.readFileSync(process.env.WARDENONE_BACKGROUND || path.join(ROOT, 'background.js'), 'utf8');
const PALETTE = fs.readFileSync(process.env.WARDENONE_PALETTE || path.join(ROOT, 'command-palette.js'), 'utf8');
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
/* The worker's own hash helper, lifted rather than re-implemented, so the claim hashes the
   nonce exactly as the opening did. */
const shaAt = BG.indexOf('async function sha256TextHex(text) {');
const shaSrc = BG.slice(shaAt, BG.indexOf('\n}\n', shaAt) + 3);
check('the hash helper lifts', shaAt > 0 && /crypto\.subtle\.digest/.test(shaSrc));

/* One mocked storage.session, shareable between two "workers". */
function sessionStore() {
  const data = {};
  return {
    data,
    get(key, cb) { cb({ [key]: data[key] }); },
    set(obj, cb) { Object.assign(data, obj); if (cb) cb(); },
    remove(key, cb) { delete data[key]; if (cb) cb(); },
  };
}
/* A worker realm: its own RAM, the shared store, and a scripting API that records what it
   injects -- the nonce handed to the isolated window, then the file. */
function makeGate(store) {
  const injected = [];
  const sandbox = {
    Set, Object, Date, Number, String, Array, Promise, Uint8Array, TextEncoder, console,
    crypto: globalThis.crypto,
    chrome: {
      scripting: {
        executeScript: (opts, cb) => {
          if (opts.files) injected.push(opts.files[0]);
          else if (opts.func) injected.push('nonce:' + (opts.args && opts.args[0]));
          if (cb) cb();
        },
      },
      runtime: { lastError: null },
      storage: { session: store },
    },
  };
  sandbox.sessionArea = () => sandbox.chrome.storage.session;
  vm.createContext(sandbox);
  vm.runInContext(shaSrc + BG.slice(start, end)
    + ';globalThis.__open = openCommandPalette;globalThis.__claim = paletteClaim;'
    + 'globalThis.__allowed = PALETTE_ALLOWED;globalThis.__key = typeof PALETTE_GRANT_KEY === "string" ? PALETTE_GRANT_KEY : "wardenone_palette_grant";',
    sandbox, { filename: 'background.js:palette' });
  return {
    open: sandbox.__open, claim: sandbox.__claim, allowed: sandbox.__allowed, key: sandbox.__key,
    injected, store, sandbox,
    nonce: () => { const n = injected.find((x) => x.indexOf('nonce:') === 0); return n ? n.slice(6) : ''; },
  };
}

const gateTests = (async () => {
  {
    const g = makeGate(sessionStore());
    check('nothing is claimable before the palette is opened', (await g.claim(7, 'anything')) === false,
      'this is the gate that a forged message has to get past, and it cannot open the palette');
  }
  {
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: 'https://shop.example/' });
    check('the nonce is set on the isolated window first, then the overlay is injected',
      g.injected.length === 2 && g.injected[0].indexOf('nonce:') === 0 && g.injected[1] === 'command-palette.js', g.injected.join(','));
    const nonce = g.nonce();
    check('the nonce is 32 random bytes', /^[0-9a-f]{64}$/.test(nonce));
    const stored = g.store.data[g.key];
    check('the grant is in storage.session: hash, tab and time, never the nonce itself',
      stored && stored.tabId === 7 && /^[0-9a-f]{64}$/.test(stored.hash) && stored.hash !== nonce && typeof stored.at === 'number',
      JSON.stringify(stored));
    check('and one action becomes claimable with the nonce', (await g.claim(7, nonce)) === true);
    check('the grant is removed on the claim', g.store.data[g.key] === undefined);
    check('but only one', (await g.claim(7, nonce)) === false,
      'without consuming it, a single press would leave a window in which a forged '
      + 'message could run anything on the list');
  }
  {
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: 'https://shop.example/' });
    check('a pick without the nonce is refused -- a requirement the old gate did not have',
      (await g.claim(7, '')) === false && (await g.claim(7, undefined)) === false);
    check('a wrong nonce is refused', (await g.claim(7, 'f'.repeat(64))) === false);
    check('and does not spend the grant: a forged pick cannot cancel the reader\'s', (await g.claim(7, g.nonce())) === true);
  }
  {
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: 'https://shop.example/' });
    check('a different tab cannot spend this tab\'s opening', (await g.claim(8, g.nonce())) === false);
    check('and the real tab still can', (await g.claim(7, g.nonce())) === true);
  }
  {
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: 'https://shop.example/' });
    if (g.store.data[g.key]) g.store.data[g.key].at = Date.now() - 200000;
    check('an old opening has lapsed', (await g.claim(7, g.nonce())) === false,
      'a stolen moment must not become a standing invitation');
    check('and a lapsed grant is dropped', g.store.data[g.key] === undefined);
  }
  for (const url of ['chrome://settings', 'about:blank', 'file:///c:/x.html']) {
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: url });
    check('nothing is injected or claimable on ' + url,
      g.injected.length === 0 && g.store.data[g.key] === undefined && (await g.claim(7, g.nonce())) === false);
  }
  {
    /* THE CARD: the worker that opened the palette is gone when the pick arrives. */
    const store = sessionStore();
    const opener = makeGate(store);
    await opener.open({ id: 7, url: 'https://shop.example/' });
    const nonce = opener.nonce();
    const successor = makeGate(store);        // a new worker: empty memory, same session store
    check('a new worker honours a grant it did not make', (await successor.claim(7, nonce)) === true,
      'the pick used to wake an empty worker, which refused a palette that was visibly open');
    check('and the old worker cannot spend it again', (await opener.claim(7, nonce)) === false,
      'the grant was consumed in the store both workers read');
    check('the store is empty afterwards', store.data[opener.key] === undefined);
  }
  {
    /* Two picks racing inside one worker spend one grant once. */
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: 'https://shop.example/' });
    const nonce = g.nonce();
    const results = await Promise.all([g.claim(7, nonce), g.claim(7, nonce), g.claim(7, nonce)]);
    check('three simultaneous picks yield exactly one action', results.filter(Boolean).length === 1, JSON.stringify(results));
  }
  {
    /* A second press replaces the grant; the open palette reads the nonce at pick time. */
    const g = makeGate(sessionStore());
    await g.open({ id: 7, url: 'https://shop.example/' });
    const first = g.nonce();
    g.injected.length = 0;
    await g.open({ id: 7, url: 'https://shop.example/' });
    const second = g.nonce();
    check('a second press mints a new nonce', second && second !== first);
    check('the first is no longer good', (await g.claim(7, first)) === false);
    check('the second is', (await g.claim(7, second)) === true);
  }
})();

/* ---- what the palette may ask for ------------------------------------------ */
{
  const g = makeGate(sessionStore());
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
  const g = makeGate(sessionStore());
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
  check('it claims the grant with the pick\'s nonce, and waits for the answer', /await paletteClaim\(tab\.id, msg\.grant\)/.test(handler));
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
  /* Commands added after install may have no browser-assigned shortcut. */
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
  check('and the popup explains an unassigned suggestion without claiming it can force one',
    /a suggestion may remain <em>Not set<\/em>/.test(
      fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8'))
      && /cannot assign or restore a key/.test(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8')),
    'the browser may decline a suggested shortcut or preserve a user change');
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
check('it sends the id and the grant, nothing else',
  /sendMessage\(\{ kind: 'palette-run', command: item\.id, grant: grant \}/.test(PALETTE));
check('the grant is read from the isolated window at the moment of the pick, not at load',
  /function run\(\) \{[\s\S]*?window\.__wardenOnePaletteGrant[\s\S]*?sendMessage/.test(PALETTE)
  && PALETTE.indexOf('window.__wardenOnePaletteGrant') > PALETTE.indexOf('function run() {'),
  'a second press mints a new grant while the palette is still open; the pick has to spend the one that exists');
check('the nonce is set through a func injection into the same isolated world, before the file',
  /executeScript\(\s*\{ target, func: \(grant\) => \{ window\.__wardenOnePaletteGrant = grant; \}, args: \[nonce\] \}/.test(BG)
  && BG.indexOf('func: (grant) =>') < BG.indexOf("files: ['command-palette.js']", BG.indexOf('func: (grant) =>')));
check('the grant is kept in storage.session, as a hash', /PALETTE_GRANT_KEY = 'wardenone_palette_grant'/.test(BG)
  && /await paletteRemember\(\{ tabId: tab\.id, hash, at: Date\.now\(\) \}\)/.test(BG)
  && !/PALETTE_OPEN_AT/.test(BG), 'the worker-RAM map is what died with the worker');
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

gateTests.then(() => {
  if (failed) { console.error('command palette: ' + failed + ' failed'); process.exit(1); }
  console.log('command palette: all checks passed');
}, (e) => { console.error('command palette: gate tests threw: ' + (e && e.stack || e)); process.exit(1); });

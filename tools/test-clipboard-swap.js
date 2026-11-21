#!/usr/bin/env node
'use strict';

/* Clipboard swap detection (on by default) and the opt-in clipboard hijack guard, run in a fake page.
   Each copy is dispatched the way a browser does it: window capture, then the page's handler, then
   window bubble. The clipboard then holds the transfer data when the copy was cancelled, otherwise
   whatever is selected at the end. Nothing here touches a real clipboard. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function slice(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) throw new Error('cannot find block ' + startMarker);
  return src.slice(start, end);
}
const reMatch = /\n\s*CRYPTO_ADDR_RE=(\/\\b\(0x[^\n]*?\\b\/),\n/.exec(src);
if (!reMatch) throw new Error('cannot find CRYPTO_ADDR_RE');
const CRYPTO_SRC = reMatch[1];
const SWAP_BLOCK = slice('    if(WO.clipboardSwapDetect&&WO_TOP)try{', '    if(WO.keystrokePressure&&WO_TOP)try{');
const GUARD_BLOCK = slice('    if(WO.clipboardGuard)try{', '    if(WO.clipboardSwapDetect&&WO_TOP)try{');

const USER_BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const EVIL_BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const USER_ETH = '0x52908400098527886E0F7030069857D2E4169EE7';
const EVIL_ETH = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const USER_LEGACY = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

function setup(opts) {
  opts = opts || {};
  let now = 1000000;
  const listeners = [];
  const logs = [];
  const clipboardWrites = [];
  const panels = [];
  class FakeDT {
    constructor() { this.data = {}; const dt = this; this.items = { add(value, type) { if (typeof value === 'string') { dt.data[String(type).toLowerCase()] = value; return {}; } return null; } }; }
  }
  FakeDT.prototype.setData = function (type, value) { let t = String(type).toLowerCase(); if (t === 'text') t = 'text/plain'; this.data[t] = String(value); };
  FakeDT.prototype.getData = function (type) { let t = String(type).toLowerCase(); if (t === 'text') t = 'text/plain'; return this.data[t] || ''; };
  FakeDT.prototype.clearData = function (type) { if (type) delete this.data[String(type).toLowerCase()]; else this.data = {}; };

  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, textContent: '' });
  const page = { selection: '', active: null };
  const document = {
    get activeElement() { return page.active; },
    getSelection() { return { toString: () => page.selection }; },
    createElement: el,
    body: { appendChild(n) { panels.push(n); } },
    documentElement: {},
  };
  const window = {};
  const realClipboard = {
    writeText(text) { clipboardWrites.push(['text', String(text)]); return Promise.resolve(); },
    write(items) { clipboardWrites.push(['items', items]); return Promise.resolve(); },
  };
  const navigator = { clipboard: realClipboard };
  const FakeDate = { now: () => now };
  const ctx = {
    WO: { clipboardSwapDetect: true, clipboardGuard: !!opts.guard },
    WO_TOP: true,
    window, document, navigator,
    DataTransfer: FakeDT,
    DOMException,
    Date: FakeDate,
    Promise, Array, String, Number, RegExp, Object, Math, Set,
    __woWarn: { up: () => false, mark() {} },
    woOn(target, type, fn, o) { listeners.push({ target, type, fn, capture: o === true || !!(o && o.capture) }); },
    log(type, detail) { logs.push({ type, detail }); },
  };
  vm.createContext(ctx);
  const code = 'const CRYPTO_ADDR_RE=' + CRYPTO_SRC + ';\n' + (opts.guard ? GUARD_BLOCK : '') + (opts.noSwap ? '' : SWAP_BLOCK);
  vm.runInContext(code, ctx, { filename: 'clipboard-blocks.js' });

  const fire = (target, type, capture, event) => {
    for (const l of listeners.slice()) {
      if (l.target === target && l.type === type && l.capture === capture) {
        if (event.__stopped) return;
        l.fn(event);
      }
    }
  };
  const makeEvent = (dt, trusted) => ({
    isTrusted: trusted !== false, clipboardData: dt, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.__stopped = true; },
  });
  /* A copy: returns what the clipboard would hold after the browser finishes. */
  const copy = (sel, pageHandler, extra) => {
    extra = extra || {};
    page.selection = sel;
    const dt = new FakeDT();
    const e = makeEvent(dt, extra.trusted);
    if (extra.before) extra.before(e, dt);
    fire(window, 'copy', true, e);
    fire(document, 'copy', true, e);
    if (pageHandler) pageHandler(e, dt, page);
    if (!e.__stopped) fire(document, 'copy', false, e);
    if (!e.__stopped) fire(window, 'copy', false, e);
    if (e.isTrusted === false) return null;
    return e.defaultPrevented ? (dt.data['text/plain'] || '') : page.selection;
  };
  const paste = (text) => {
    const e = { isTrusted: true, clipboardData: { getData: (t) => (/text/.test(t) ? text : '') } };
    fire(document, 'paste', true, e);
  };
  const gesture = (type) => fire(window, type || 'pointerdown', true, { isTrusted: true });
  return {
    copy, paste, gesture, logs, clipboardWrites, panels, page, FakeDT,
    clipboard: navigator.clipboard,
    tick(ms) { now += ms; },
    swaps: () => logs.filter((l) => l.type === 'blocked_clipboard_swap'),
  };
}
const settle = () => new Promise((r) => setImmediate(r));

(async () => {
  /* 1. The 1v1 fixture: the copy handler cancels the copy and writes the attacker's address. */
  {
    const t = setup();
    t.gesture('keydown');
    const got = t.copy('Send to ' + USER_BTC, (e) => { e.preventDefault(); e.clipboardData.setData('text/plain', EVIL_BTC); });
    eq(got, 'Send to ' + USER_BTC, 'copy handler swap keeps the selection');
    eq(t.swaps().length, 1, 'copy handler swap logged once');
    const d = t.swaps()[0] && t.swaps()[0].detail;
    eq(d && d.kind, 'btc', 'swap names the coin');
    eq(d && d.how, 'copy handler', 'swap names how');
    ok(d && !JSON.stringify(d).includes(USER_BTC) && !JSON.stringify(d).includes(EVIL_BTC), 'swap event carries no address');
    ok(d && typeof d.why === 'string' && !/—/.test(d.why), 'swap reason has no em dash');
  }
  /* 2. Plain and rich text both swapped: rich text dropped, plain kept. */
  {
    const t = setup();
    t.gesture('keydown');
    let dtRef;
    const got = t.copy(USER_BTC, (e, dt) => { dtRef = dt; e.preventDefault(); dt.setData('text/html', '<b>' + EVIL_BTC + '</b>'); dt.setData('text/plain', EVIL_BTC); });
    eq(got, USER_BTC, 'plain swap restored');
    ok(!String(dtRef.data['text/html'] || '').includes(EVIL_BTC), 'rich text with the other address is not kept');
    eq(t.swaps().length, 1, 'one log for one copy');
  }
  /* 3. Only rich text written and the copy cancelled: plain text is still the selection. */
  {
    const t = setup();
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); dt.setData('text/html', EVIL_BTC); });
    eq(got, USER_BTC, 'html only swap still leaves the selection as plain text');
  }
  /* 4. The prototype method called directly, around the wrapped one. */
  {
    const t = setup();
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); t.FakeDT.prototype.setData.call(dt, 'text/plain', EVIL_BTC); });
    eq(got, USER_BTC, 'prototype bypass caught at the end of the copy');
  }
  /* 5. items.add path. */
  {
    const t = setup();
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); dt.items.add(EVIL_BTC, 'text/plain'); });
    eq(got, USER_BTC, 'items.add swap caught');
  }
  /* 6. The old trick: select hidden text with another address and let the browser copy it. */
  {
    const t = setup();
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt, page) => { page.selection = EVIL_BTC; });
    eq(got, USER_BTC, 'selection swap restored');
    eq(t.swaps()[0] && t.swaps()[0].detail.how, 'selection swap', 'selection swap named');
  }
  /* 7. A handler that also stops the copy from reaching the window still meets the wrapped setData. */
  {
    const t = setup();
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); e.stopPropagation(); dt.setData('text/plain', EVIL_BTC); });
    eq(got, USER_BTC, 'stopPropagation does not skip the wrapped setData');
  }
  /* 8. Async writes after the copy, with no new click or key. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy(USER_BTC);
    t.tick(50);
    let rejected = null;
    await t.clipboard.writeText(EVIL_BTC).then(() => { rejected = false; }, (err) => { rejected = err && err.name; });
    eq(rejected, 'NotAllowedError', 'later writeText of another address refused');
    eq(t.clipboardWrites.length, 0, 'refused write never reached the clipboard');
    eq(t.swaps().length, 1, 'write refusal logged');
    eq(t.swaps()[0].detail.how, 'clipboard write', 'write refusal named');
    /* An object whose text changes between reads is converted once. */
    let calls = 0;
    const shifty = { toString() { calls++; return calls === 1 ? USER_BTC : EVIL_BTC; } };
    await t.clipboard.writeText(shifty).catch(() => {});
    ok(!t.clipboardWrites.some((w) => w[1] === EVIL_BTC), 'value converted once, the checked text is the written text');
    t.tick(60 * 1000);
    await t.clipboard.writeText(EVIL_BTC).catch(() => {});
    ok(!t.clipboardWrites.some((w) => w[1] === EVIL_BTC), 'still refused within two minutes');
    t.tick(61 * 1000);
    await t.clipboard.writeText(EVIL_BTC);
    ok(t.clipboardWrites.some((w) => w[1] === EVIL_BTC), 'after two minutes the hold ends');
  }
  /* 9. Copy buttons: a new click before the write means the person asked for it. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy(USER_BTC);
    t.tick(400);
    t.gesture('pointerdown');
    t.tick(10);
    await t.clipboard.writeText(EVIL_BTC);
    ok(t.clipboardWrites.some((w) => w[1] === EVIL_BTC), 'copy button for a second address works after a click');
    eq(t.swaps().length, 0, 'no refusal for a copy button');
  }
  /* 10. Same address written again, with extra words or recased hex. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy(USER_ETH);
    await t.clipboard.writeText('Pay to ' + USER_ETH.toLowerCase() + ' today');
    ok(t.clipboardWrites.length === 1, 'same hex address in another case is not a swap');
    const got = t.copy(USER_ETH, (e, dt) => { e.preventDefault(); dt.setData('text/plain', USER_ETH + '\n\nRead more at https://example.org/guide'); });
    eq(got, USER_ETH + '\n\nRead more at https://example.org/guide', 'attribution on copy is left alone');
    eq(t.swaps().length, 0, 'no refusal for same address');
  }
  /* 11. Truncated address and another coin are not swaps of the copied one. */
  {
    const t = setup();
    t.gesture('keydown');
    let got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); dt.setData('text/plain', 'bc1qxy2k...0wlh'); });
    eq(got, 'bc1qxy2k...0wlh', 'truncated address left alone');
    t.gesture('keydown');
    got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); dt.setData('text/plain', USER_ETH); });
    eq(got, USER_ETH, 'different coin left alone');
    eq(t.swaps().length, 0, 'near misses not refused');
  }
  /* 12. Copying text with no address: the page may write anything, including an address. */
  {
    const t = setup();
    t.gesture('pointerdown');
    const got = t.copy('npm install lab-benign-package', (e, dt) => { e.preventDefault(); dt.setData('text/plain', 'npm install lab-benign-package'); });
    eq(got, 'npm install lab-benign-package', 'benign copy button untouched');
    t.gesture('keydown');
    t.copy(USER_BTC);
    t.gesture('keydown');
    t.copy('hello there');
    await t.clipboard.writeText(EVIL_BTC);
    ok(t.clipboardWrites.some((w) => w[1] === EVIL_BTC), 'a later plain copy ends the hold');
    eq(t.swaps().length, 0, 'no refusals without an address copy');
  }
  /* 13. Synthetic copy events are ignored and cannot poison the paste check. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy(USER_BTC);
    const synth = t.copy(EVIL_BTC, (e, dt) => { e.preventDefault(); dt.setData('text/plain', EVIL_BTC); }, { trusted: false });
    eq(synth, null, 'synthetic copy runs without writing');
    eq(t.swaps().length, 0, 'synthetic copy not acted on');
    t.paste(EVIL_BTC);
    eq(t.logs.filter((l) => l.type === 'warned_clipboard_swap').length, 1, 'paste still compares against the real copy');
  }
  /* 14. A copy the page triggers itself, with no new action from the person. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy('Wallet: ' + USER_BTC);
    t.tick(30);
    const got = t.copy(EVIL_BTC);
    eq(got, 'Wallet: ' + USER_BTC, 'page triggered copy of another address keeps the person\'s copy');
    eq(t.swaps()[0] && t.swaps()[0].detail.how, 'page copy', 'page copy named');
    /* A real new copy after a key press is the person's own. */
    t.gesture('keydown');
    const again = t.copy(EVIL_BTC);
    eq(again, EVIL_BTC, 'a new copy after a key press is the person\'s choice');
  }
  /* 15. Address selected inside a text field. */
  {
    const t = setup();
    const value = 'my address ' + USER_LEGACY;
    t.page.active = { tagName: 'INPUT', value, selectionStart: 11, selectionEnd: value.length };
    t.gesture('keydown');
    t.page.selection = '';
    const got = t.copy('', (e, dt) => { e.preventDefault(); dt.setData('text/plain', '1HLoD9E4SDFFPDiYfNYnkBLQ85Y51J3Zb1'); });
    eq(got, USER_LEGACY, 'selection inside a field is protected');
    t.page.active = null;
  }
  /* 16. Link cleaning ran first: the cleaned text is what the person keeps. */
  {
    const t = setup();
    t.gesture('keydown');
    const cleaned = USER_BTC + ' https://example.org/a';
    const got = t.copy(USER_BTC + ' https://example.org/a?utm_source=x', (e, dt) => { e.preventDefault(); dt.setData('text/plain', EVIL_BTC); },
      { before: (e, dt) => { dt.setData('text/plain', cleaned); e.preventDefault(); } });
    eq(got, cleaned, 'cleaned link text survives a swap');
  }
  /* 17. clipboard.write with items. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy(USER_BTC);
    const item = (text) => ({ types: ['text/plain'], getType: () => Promise.resolve({ text: () => Promise.resolve(text), slice() { return this; } }) });
    let res = null;
    await t.clipboard.write([item(EVIL_BTC)]).then(() => { res = 'ok'; }, (err) => { res = err.name; });
    eq(res, 'NotAllowedError', 'write() with another address refused');
    await t.clipboard.write([item(USER_BTC)]);
    eq(t.clipboardWrites.filter((w) => w[0] === 'items').length, 1, 'write() with the same address passes');
    t.gesture('pointerdown');
    await t.clipboard.write([item(EVIL_BTC)]);
    eq(t.clipboardWrites.filter((w) => w[0] === 'items').length, 2, 'write() after a new click passes untouched');
  }
  /* 18. Paste check: recased hex is the same address; another address of that coin warns. */
  {
    const t = setup();
    t.gesture('keydown');
    t.copy(USER_ETH);
    t.paste(USER_ETH.toLowerCase());
    eq(t.logs.filter((l) => l.type === 'warned_clipboard_swap').length, 0, 'recased paste does not warn');
    t.paste(EVIL_ETH);
    eq(t.logs.filter((l) => l.type === 'warned_clipboard_swap').length, 1, 'different paste warns');
  }
  /* 19. The log is capped. */
  {
    const t = setup();
    for (let i = 0; i < 30; i++) {
      t.gesture('keydown');
      t.copy(USER_BTC, (e, dt) => { e.preventDefault(); dt.setData('text/plain', EVIL_BTC); });
    }
    eq(t.swaps().length, 20, 'refusals logged at most 20 times');
  }
  /* 20. The opt-in guard alone: a swapped copy leaves the selection, never an empty clipboard. */
  {
    const t = setup({ guard: true, noSwap: true });
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); e.clipboardData.setData('text/plain', EVIL_BTC); });
    eq(got, USER_BTC, 'clipboard guard keeps the selection');
    eq(t.logs.filter((l) => l.type === 'blocked_clipboard_hijack').length, 1, 'clipboard guard logs its block');
  }
  /* 21. Both guards on together still give the person their selection. */
  {
    const t = setup({ guard: true });
    t.gesture('keydown');
    const got = t.copy(USER_BTC, (e, dt) => { e.preventDefault(); e.clipboardData.setData('text/plain', EVIL_BTC); });
    eq(got, USER_BTC, 'both guards together keep the selection');
  }
  await settle();

  /* Wiring outside the engine. */
  const history = fs.readFileSync(path.join(root, 'history.js'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const events = fs.readFileSync(path.join(root, 'protection-event-settings.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  ok(/blocked_clipboard_swap:\s*'/.test(history), 'history labels the swap event');
  ok(/blocked_clipboard_swap:\s*'/.test(popup), 'popup labels the swap event');
  ok(/add\('[^']*\bblocked_clipboard_swap\b[^']*', 'clipboardSwapDetect'/.test(events), 'swap event belongs to Clipboard swap detection');
  const row = /data-key="clipboardSwapDetect"/.test(popupHtml) && /Clipboard swap detection<\/div><div class="desc">([^<]*)</.exec(popupHtml);
  ok(row && /swap/.test(row[1]) && !/—/.test(row[1]), 'setting copy describes the copy check without em dashes');
  ok(!/\/\/ /.test(SWAP_BLOCK.replace(/https?:\/\//g, '')), 'no line comments in the swap block');

  if (failures) { console.error(failures + ' of ' + checks + ' clipboard swap checks failed'); process.exit(1); }
  console.log('[ok] clipboard swap checks passed (' + checks + ')');
})().catch((err) => { console.error(err); process.exit(1); });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The badge must never be the thing standing between someone and a control -- and it
 * must not be dead on every page that has a link in its corner.
 *
 * It is fixed to the bottom-right corner at the maximum z-index, which is exactly where
 * video and music players put their controls. Reported on YouTube: in fullscreen the badge
 * swallowed the hover and the click that reveal and press the exit button. Then reported
 * the other way round: "on most pages we cannot press the button". The first fix yielded
 * to ANY control under the badge, and on a page with links everywhere something is under
 * it nearly all the time -- so the badge went inert at load and, taking no pointer events,
 * never received the hover that would have re-checked. Dead until a resize.
 *
 * Three outcomes now, deliberately different:
 *   player, slider beside, fullscreen -> HIDDEN. Passing the click through is no comfort
 *              when you cannot see what you are dragging.
 *   anchored control (fixed, sticky, inside the fullscreen element, or in the flow of a
 *              document that cannot scroll, with no scrolling pane in between) -> the badge
 *              MOVES UP, clear of the control or of its whole block; only when nothing fits
 *              does it stay put and go inert.
 *   anything that scrolls away -> the badge is left alone. It is a floating widget like any
 *              other, and a flick of the wheel reaches whatever was under it.
 *
 * This evaluates the shipped functions out of src/content.js rather than a copy.
 *
 * Run: node tools/test-badge-yield.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

const start = source.indexOf('badgeYieldState={at:0');
const end = source.indexOf('alignBadge=()=>{', start);
assert(start >= 0, 'the badge yield block is present in src/content.js');
assert(end > start, 'the badge yield block ends at alignBadge');
/* The slice is a fragment of a comma-separated declarator list and ends on a
   comma, so it becomes a valid declaration by closing it with one more binding. */
const block = '"use strict"; const ' + source.slice(start, end) + '__end=0;';

/* Viewport 1920x1080. The badge's home corner: bottom 1064 (16px up), 120x40. */
const VIEW = { w: 1920, h: 1080 };
const BADGE_RECT = { left: 1784, top: 1024, right: 1904, bottom: 1064, width: 120, height: 40 };
const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

/* A small element model. `closest`/`matches` understand the selector tokens the shipped
   code uses: a tag name, [attr], [attr="v"], [attr="v" i], [attr^=...] etc. reduced to
   presence, and :not([tabindex="-1"]). Ancestry carries position/overflow for the
   anchoring walk, and a rect for hit-testing. */
let seq = 0;
function el(tag, opts) {
  const o = opts || {};
  const node = {
    id: ++seq,
    nodeType: 1,
    tag: String(tag).toLowerCase(),
    attrs: Object.assign({}, o.attrs || {}),
    style: Object.assign({ position: 'static', overflowY: 'visible' }, o.style || {}),
    scrollHeight: o.scrollHeight || 0,
    clientHeight: o.clientHeight || 0,
    rect: o.rect || rect(0, 0, 0, 0),
    parentElement: null,
    insideHost: !!o.insideHost,
    children: [],
    getBoundingClientRect() { return this.rect; },
    get localName() { return this.tag; },
    matches(selector) {
      return String(selector || '').split(',').some((part) => {
        const t = part.trim();
        if (!t) return false;
        const m = /^([a-z-]*)((?:\[[^\]]+\])*)(:not\(\[tabindex="-1"\]\))?$/i.exec(t);
        if (!m) return false;
        if (m[1] && m[1].toLowerCase() !== this.tag) return false;
        const attrs = m[2].match(/\[[^\]]+\]/g) || [];
        for (const a of attrs) {
          const am = /^\[([a-z-]+)(?:[\^$*~]?=\s*"([^"]*)"(?:\s+i)?)?\]$/i.exec(a);
          if (!am) return false;
          const have = this.attrs[am[1]];
          if (have === undefined) return false;
          if (am[2] !== undefined && String(have).toLowerCase() !== am[2].toLowerCase()) return false;
        }
        if (m[3] && this.attrs.tabindex === '-1') return false;
        return true;
      });
    },
    closest(selector) {
      for (let n = this; n; n = n.parentElement) if (n.matches && n.matches(selector)) return n;
      return null;
    },
  };
  return node;
}
function under(child, parent) { child.parentElement = parent; parent.children.push(child); return child; }

function run(options) {
  const opts = options || {};
  const html = el('html', { style: { overflowY: opts.htmlOverflow || 'visible' } });
  const body = under(el('body', { style: { overflowY: opts.bodyOverflow || 'visible' } }), html);
  const badgeHost = { contains: (node) => !!(node && node.insideHost), style: { setProperty(k, v) { lifts.push([k, v]); } } };
  const lifts = [];
  const toggled = {};
  let isAway = false;
  const calls = { hit: 0, query: 0, style: 0 };
  /* The real badge moves up by the lift (its `bottom` rides --rg-lift), so the fake's box
     does too -- home is then recovered by adding the lift back, as the engine does. */
  let sandbox = null;
  const badgeButton = {
    getBoundingClientRect: () => {
      const base = opts.rect === undefined ? BADGE_RECT : opts.rect;
      const up = sandbox ? (sandbox.badgeLift || 0) : 0;
      return rect(base.left, base.top - up, base.right, base.bottom - up);
    },
    classList: { toggle(name, on) { toggled[name] = !!on; if (name === 'away') isAway = !!on; } },
  };
  /* The panel the badge opens; a class set that remembers whether it is open. */
  const panelClasses = new Set(opts.panelOpen ? ['open'] : []);
  const badgePanel = { classList: { remove: (c) => panelClasses.delete(c), add: (c) => panelClasses.add(c), contains: (c) => panelClasses.has(c) } };
  /* Everything the page has in it, topmost first. Hit-testing returns the ones containing
     the point; the near-check returns the ones matching the slider/shell query. */
  const elements = (opts.build ? opts.build(body) : []) || [];
  const now = { t: 1e6 };
  sandbox = {
    Math, String, Object, Array, Number, isFinite,
    Date: { now: () => now.t },
    window: { innerWidth: opts.viewport || VIEW.w, innerHeight: VIEW.h },
    getComputedStyle: (node) => { calls.style++; return node.style || {}; },
    PLAYER_SHELL_SELECTOR: '[data-player],[data-video],[id="player" i],[class~="player" i]',
    badgeHost,
    badgeButton,
    badgePanel,
    /* Declared in the engine's `let` chain, outside the slice: the current lift in px. */
    badgeLift: 0,
    document: {
      documentElement: html,
      body,
      scrollingElement: { scrollHeight: opts.docHeight === undefined ? 5000 : opts.docHeight },
      fullscreenElement: opts.fullscreen || null,
      elementsFromPoint: opts.noApi ? undefined : ((x, y) => {
        calls.hit++;
        return elements.filter((n) => n.rect.left <= x && x <= n.rect.right && n.rect.top <= y && y <= n.rect.bottom);
      }),
      querySelectorAll: (sel) => { calls.query++; return elements.filter((n) => n.matches(sel)); },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { filename: 'src/content.js:badge-yield' });
  const api = {
    sandbox, toggled, calls, lifts, now, elements, body,
    panelOpen: () => panelClasses.has('open'),
    kind: () => vm.runInContext('badgeCoversPageControl()', sandbox),
    anchor: (node) => { sandbox.__n = node; return vm.runInContext('badgeAnchorOf(__n)', sandbox); },
    update: (force) => vm.runInContext('updateBadgeYield(' + (force ? 'true' : '') + ')', sandbox),
    lift: () => { const last = lifts.filter((l) => l[0] === '--rg-lift').pop(); return last ? parseInt(last[1], 10) : null; },
    fs: () => vm.runInContext('badgeInFullscreen()', sandbox),
  };
  api.update(true);
  return api;
}

/* ---- the reported case: a player's own control under the badge --------------------------- */
{
  const r = run({ build: (body) => [under(el('div', { attrs: { 'data-player': '' }, rect: rect(1500, 900, 1920, 1080) }), body)] });
  assert.strictEqual(r.kind(), 'player', 'a player shell under the badge is a player');
  assert.strictEqual(r.toggled.away, true, 'and the badge gets out of the way entirely -- inert is not enough over a slider');
  assert.strictEqual(r.toggled.inert, true, 'and takes no input on the way out');
}

/* ---- THE SECOND REPORT: ordinary content must not disable the badge ------------------------ */
{
  /* A long page; a link in its flow has scrolled under the badge. */
  const r = run({ build: (body) => [under(el('a', { attrs: { href: '/x' }, rect: rect(1700, 1000, 1920, 1080) }), body)] });
  assert.strictEqual(r.kind(), '', 'a link that scrolls away is not something the badge yields to');
  assert.strictEqual(r.toggled.inert, false, 'so the badge keeps taking input');
  assert.strictEqual(r.toggled.away, false, 'and stays where it is');
  assert.strictEqual(r.lift(), 0, 'and does not move');
}
{
  const r = run({ build: (body) => [under(el('button', { rect: rect(1700, 1000, 1920, 1080) }), body)] });
  assert.strictEqual(r.kind(), '', 'a button in the page flow likewise');
  assert.strictEqual(r.toggled.inert, false);
}
{
  /* An app shell: the document does not scroll, but the link sits in a pane that does. */
  const r = run({
    docHeight: 1080, htmlOverflow: 'hidden',
    build: (body) => {
      const shell = under(el('div', { rect: rect(0, 0, 1920, 1080) }), body);
      const pane = under(el('div', { style: { overflowY: 'auto' }, scrollHeight: 9000, clientHeight: 900, rect: rect(300, 100, 1920, 1080) }), shell);
      const message = under(el('div', { rect: rect(1600, 1000, 1920, 1080) }), pane);
      return [under(el('a', { attrs: { href: '/m' }, rect: rect(1700, 1010, 1900, 1070) }), message)];
    },
  });
  assert.strictEqual(r.kind(), '', 'a link inside a scrolling pane of a fixed-height app is scrolling content');
  assert.strictEqual(r.toggled.inert, false, 'the badge stays usable over a chat pane');
}

/* ---- anchored controls: the badge moves up instead of going dead --------------------------- */
{
  /* A consent bar: fixed, 200px tall along the bottom, with a link and a button under the badge. */
  const r = run({
    build: (body) => {
      const bar = under(el('div', { style: { position: 'fixed' }, rect: rect(0, 880, 1920, 1080) }), body);
      const text = under(el('p', { rect: rect(40, 900, 1500, 1060) }), bar);
      const accept = under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), bar);
      return [accept, text, bar];
    },
  });
  assert.strictEqual(r.kind(), 'control', 'a button in a fixed bar is an anchored control');
  assert.strictEqual(r.toggled.inert, false, 'the badge is NOT made inert for it');
  assert.strictEqual(r.toggled.away, false, 'nor hidden');
  const lift = r.lift();
  /* clear of the button: 1064 - 1030 + 8 = 42 */
  assert.strictEqual(lift, 42, 'it moves up just clear of the control (' + lift + ')');
}
{
  /* A chat bubble: a fixed 60x60 button in the corner. */
  const r = run({
    build: (body) => [under(el('button', { style: { position: 'fixed' }, rect: rect(1840, 1000, 1900, 1060) }), body)],
  });
  assert.strictEqual(r.toggled.inert, false);
  assert.strictEqual(r.lift(), 1064 - 1000 + 8, 'it clears a chat bubble by the gap');
}
{
  /* A fixed chat iframe counts as a control too: the reader needs to click into it. */
  const r = run({
    build: (body) => [under(el('iframe', { style: { position: 'fixed' }, rect: rect(1800, 980, 1904, 1064) }), body)],
  });
  assert.strictEqual(r.kind(), 'control', 'a fixed iframe in the corner is a control');
  assert.strictEqual(r.toggled.inert, false);
  assert(r.lift() > 0, 'and the badge moves above it');
}
{
  /* When the spot above the control is itself occupied by another anchored control, the
     badge clears the whole block instead. */
  const r = run({
    build: (body) => {
      const bar = under(el('div', { style: { position: 'fixed' }, rect: rect(0, 900, 1920, 1080) }), body);
      const accept = under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), bar);
      const policy = under(el('a', { attrs: { href: '/p' }, rect: rect(1700, 950, 1904, 1025) }), bar);
      return [accept, policy, bar];
    },
  });
  assert.strictEqual(r.toggled.inert, false, 'still not inert');
  assert.strictEqual(r.lift(), 1064 - 900 + 8, 'it clears the bar (' + r.lift() + ')');
}
{
  /* THE THIRD REPORT, Twitch: "when it blocks something the badge becomes unclickable".
     Twitch is an app shell whose document never scrolls, so everything in its flow is
     anchored. The badge's corner is the chat column's input row: the Chat button under the
     badge, the chat input (a contenteditable with a tabindex) directly above it, and above
     that the message list, which scrolls. "Clear of the control" landed on the input, which
     is another anchored control, and "clear of the whole block" is the viewport itself on a
     page that does not scroll -- so nothing fit and the badge went inert, visible and dead,
     the moment a play event (an ad break blocked, the stream resuming) forced a re-check.
     The badge now climbs: a spot occupied by another anchored control yields the next
     candidate, clear of THAT control, until the spot is free or the cap is reached. */
  const twitch = (opts) => run({
    docHeight: 1080, htmlOverflow: 'hidden',
    build: (body) => {
      const column = under(el('section', { rect: rect(1580, 0, 1920, 1080) }), body);
      const list = under(el('div', { style: { overflowY: 'auto' }, scrollHeight: opts && opts.shortList ? 800 : 9000, clientHeight: 940, rect: rect(1580, 0, 1920, 950) }), column);
      const message = under(el('a', { attrs: { href: '/u/someone' }, rect: rect(1600, 900, 1900, 940) }), list);
      const input = under(el('div', { attrs: { tabindex: '0', role: 'textbox' }, rect: rect(1600, 958, 1910, 1010) }), column);
      const row = under(el('div', { rect: rect(1580, 1014, 1920, 1080) }), column);
      const gear = under(el('button', { rect: rect(1790, 1020, 1830, 1060) }), row);
      const send = under(el('button', { rect: rect(1838, 1020, 1904, 1060) }), row);
      return [send, gear, row, input, message, list, column];
    },
  });
  const r = twitch();
  assert.strictEqual(r.kind(), 'control', 'the Chat button under the badge is an anchored control on a page that does not scroll');
  assert.strictEqual(r.toggled.inert, false, 'the badge is NOT inert: it has somewhere to go');
  assert.strictEqual(r.toggled.away, false, 'and is not hidden');
  /* clear of the input, which is the second anchored control it met on the way up: 1064 - 958 + 8 */
  assert.strictEqual(r.lift(), 1064 - 958 + 8, 'it climbs past the Chat button AND the chat input, to the message list (' + r.lift() + ')');
  /* The forced re-check a play event triggers gives the same answer, not a dead badge. */
  r.update(true);
  assert.strictEqual(r.toggled.inert, false, 'a forced re-check (the play event) keeps it usable');
  assert.strictEqual(r.lift(), 1064 - 958 + 8);
  /* A short chat: the list does not scroll, so its last message is anchored too; the badge
     climbs past that as well, one hop further. */
  const quiet = twitch({ shortList: true });
  assert.strictEqual(quiet.toggled.inert, false, 'a short chat list is one more hop, not a dead badge');
  assert.strictEqual(quiet.lift(), 1064 - 900 + 8, 'clear of the last message (' + quiet.lift() + ')');
}
{
  /* A fixed sidebar the full height of the window, with a link the full height of the
     sidebar: a control the badge could never clear is a region, not something the reader is
     aiming at with the one corner the badge covers -- so the badge stays usable. (It used to
     go inert here: visible and dead, which is what the fourth report was.) */
  const r = run({
    build: (body) => {
      const side = under(el('nav', { style: { position: 'fixed' }, rect: rect(1600, 0, 1920, 1080) }), body);
      return [under(el('a', { attrs: { href: '/n' }, rect: rect(1620, 0, 1900, 1080) }), side), side];
    },
  });
  assert.strictEqual(r.kind(), '', 'a control taller than the lift cap is a region, not a control');
  assert.strictEqual(r.toggled.inert, false, 'the badge keeps taking input');
  assert.strictEqual(r.toggled.away, false, 'and stays visible');
  assert.strictEqual(r.lift(), 0);
}
{
  /* But a page-tall IFRAME is still a control: what is inside it cannot be seen from here,
     and a chat embed puts its own send button in exactly this corner. Nothing fits, so this
     is the one shape left that ends inert. */
  const r = run({
    build: (body) => [under(el('iframe', { style: { position: 'fixed' }, rect: rect(1560, 0, 1920, 1080) }), body)],
  });
  assert.strictEqual(r.kind(), 'control', 'a fixed page-tall iframe is still a control');
  assert.strictEqual(r.toggled.inert, true, 'with nowhere to go it stays put and stops taking input');
  assert.strictEqual(r.toggled.away, false, 'but stays visible');
}
{
  /* THE FOURTH REPORT, from the real Twitch DOM on a quiet channel (two messages): under the
     home corner the chat-settings button; 40px up the message field ([tabindex="0"]); and
     every band above that the empty chat scroller, whose closest() focusable ancestor is a
     [tabindex="0"] Layout wrapper the height of the whole column. The document is pinned, so
     that wrapper was an anchored control 700px tall, no candidate could clear it, and the
     badge went inert -- with its panel stuck open, since an inert badge cannot be pressed
     to close it. The wrapper is a region now; the badge lifts clear of the message field
     onto the empty list, and a panel left open when the badge stops taking input is closed. */
  const quiet = (opts) => run(Object.assign({
    docHeight: 1080, htmlOverflow: 'visible', bodyOverflow: 'hidden',
    build: (body) => {
      const column = under(el('section', { rect: rect(1580, 50, 1920, 1080) }), body);
      const wrapper = under(el('div', { attrs: { tabindex: '0' }, rect: rect(1580, 50, 1920, 950) }), column);
      const scroller = under(el('div', { attrs: { 'data-a-target': 'chat-scroller' }, style: { overflowY: 'auto' }, scrollHeight: 637, clientHeight: 637, rect: rect(1580, 60, 1920, 950) }), wrapper);
      const input = under(el('div', { attrs: { tabindex: '0', role: 'textbox', 'data-a-target': 'chat-input' }, rect: rect(1600, 958, 1910, 1010) }), column);
      const row = under(el('div', { rect: rect(1580, 1014, 1920, 1080) }), column);
      const gear = under(el('button', { attrs: { 'data-a-target': 'chat-settings' }, rect: rect(1780, 1020, 1820, 1060) }), row);
      const send = under(el('button', { rect: rect(1830, 1020, 1904, 1060) }), row);
      return [send, gear, row, input, scroller, wrapper, column];
    },
  }, opts || {}));
  const r = quiet();
  assert.strictEqual(r.toggled.inert, false, 'the badge is usable on a quiet Twitch chat');
  assert.strictEqual(r.toggled.away, false);
  assert.strictEqual(r.lift(), 1064 - 958 + 8, 'it sits just clear of the message field, on the empty list (' + r.lift() + ')');
  /* The panel: open when a forced re-check finds nothing fits, it is closed rather than stranded. */
  const stuck = run({
    panelOpen: true,
    build: (body) => [under(el('iframe', { style: { position: 'fixed' }, rect: rect(1560, 0, 1920, 1080) }), body)],
  });
  assert.strictEqual(stuck.toggled.inert, true);
  assert.strictEqual(stuck.panelOpen(), false, 'a panel left open when the badge stops taking input is closed, not stranded');
  const fine = quiet({ panelOpen: true });
  assert.strictEqual(fine.panelOpen(), true, 'and a panel stays open while the badge can still be pressed');
  /* No hopping about. A forced re-check (the stream's play events force one every few
     minutes) used to climb again from scratch, so as chat rows came and went the badge landed
     a little higher or lower each time -- while the reader was aiming at it. The spot it holds
     is tried first: while it is still clear it stays; it comes home when home is clear. */
  const held = quiet();
  assert.strictEqual(held.lift(), 1064 - 958 + 8);
  const input = held.elements.find((n) => n.attrs['data-a-target'] === 'chat-input');
  input.rect = rect(1600, 980, 1910, 1010);   /* the field shrank: a fresh climb would now say 92 */
  held.update(true);
  assert.strictEqual(held.lift(), 1064 - 958 + 8, 'a forced re-check keeps the spot the badge already holds while it is still clear');
  for (const b of held.elements.filter((n) => n.tag === 'button')) b.rect = rect(1600, 1020, 1700, 1060);   /* the buttons moved away from the corner */
  held.update(true);
  assert.strictEqual(held.lift(), 0, 'and it comes home when home is clear again');
}
{
  /* The climb is bounded: a stack of anchored controls taller than the cap still ends inert
     rather than looping, and never costs more than a handful of hit tests. */
  const r = run({
    docHeight: 1080, htmlOverflow: 'hidden',
    build: (body) => {
      const out = [];
      for (let i = 0; i < 30; i++) out.push(under(el('button', { rect: rect(1700, 1064 - (i + 1) * 36, 1910, 1064 - i * 36) }), body));
      return out;
    },
  });
  assert.strictEqual(r.toggled.inert, true, 'a column of buttons taller than the cap: inert, not a runaway climb');
  assert(r.calls.hit <= 3 * 16, 'the climb is bounded (' + r.calls.hit + ' hit tests)');
}
{
  /* The cap: a block that would push the badge past 45% of the screen is not cleared. A fixed
     panel 580px tall, filled with a column of ordinary buttons: the climb reaches the cap
     before it reaches a free spot, and the badge stops rather than floating mid-screen. */
  const r = run({
    build: (body) => {
      const panel = under(el('div', { style: { position: 'fixed' }, rect: rect(1500, 500, 1920, 1080) }), body);
      const out = [];
      for (let y = 1030; y >= 520; y -= 40) out.push(under(el('button', { rect: rect(1520, y, 1900, y + 38) }), panel));
      out.push(panel);
      return out;
    },
  });
  assert.strictEqual(r.toggled.inert, true, 'a tall fixed panel full of controls is not cleared -- the badge would float mid-screen');
  assert.strictEqual(r.lift(), 0);
}
{
  /* Sticky counts as anchored. */
  const r = run({
    build: (body) => {
      const bar = under(el('footer', { style: { position: 'sticky' }, rect: rect(0, 1000, 1920, 1080) }), body);
      return [under(el('button', { rect: rect(1780, 1020, 1900, 1070) }), bar), bar];
    },
  });
  assert.strictEqual(r.kind(), 'control', 'a sticky bar is anchored');
  assert(r.lift() > 0);
}
{
  /* A document that cannot scroll: a short page's footer button stays where it is too. */
  const r = run({
    docHeight: 1080,
    build: (body) => [under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), body)],
  });
  assert.strictEqual(r.kind(), 'control', 'in a document that does not scroll, a control in flow is anchored');
  assert.strictEqual(r.lift(), 42, 'and the badge clears it');
  assert.strictEqual(r.toggled.inert, false);
}
{
  /* The same button on a long page is scrolling content. */
  const r = run({ docHeight: 6000, build: (body) => [under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), body)] });
  assert.strictEqual(r.kind(), '', 'on a page that scrolls, the same button is left to the wheel');
}
{
  /* html{overflow:hidden} pins the document even when its content is tall. */
  const r = run({ docHeight: 6000, htmlOverflow: 'hidden', build: (body) => [under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), body)] });
  assert.strictEqual(r.kind(), 'control', 'overflow:hidden on the root means the page never scrolls');
}
{
  /* Inside the fullscreen element everything is anchored (and fullscreen hides anyway). */
  const r = run({ build: () => [] });
  const fsEl = el('div', { rect: rect(0, 0, 1920, 1080) });
  under(fsEl, r.body);
  const btn = under(el('button', { rect: rect(1800, 1000, 1900, 1060) }), fsEl);
  r.sandbox.document.fullscreenElement = fsEl;
  assert(r.anchor(btn) && r.anchor(btn).top === 0, 'a control inside the fullscreen element is anchored to it');
}

/* ---- only the topmost element decides; the badge\'s own host is skipped ------------------------ */
{
  const r = run({
    build: (body) => {
      const bar = under(el('div', { style: { position: 'fixed' }, rect: rect(0, 900, 1920, 1080) }), body);
      const btn = under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), bar);
      const cover = under(el('div', { rect: rect(1500, 900, 1920, 1080) }), body);
      return [cover, btn, bar];
    },
  });
  assert.strictEqual(r.kind(), '', 'a control behind an opaque element is not the thing the reader is aiming at');
}
{
  const r = run({
    build: (body) => {
      const own = el('span', { insideHost: true, rect: rect(1784, 1024, 1904, 1064) });
      const btn = under(el('button', { style: { position: 'fixed' }, rect: rect(1760, 1030, 1900, 1070) }), body);
      return [own, btn];
    },
  });
  assert.strictEqual(r.kind(), 'control', "the badge's own element must not mask the control underneath it");
}

/* ---- fullscreen, no API, collapsed ------------------------------------------------------------ */
{
  const r = run({ fullscreen: {}, build: (body) => [under(el('div', { rect: rect(0, 0, 1920, 1080) }), body)] });
  assert.strictEqual(r.fs(), true, 'fullscreen is detected');
  assert.strictEqual(r.toggled.away, true, 'and the badge is hidden outright');
  assert.strictEqual(r.toggled.inert, true, 'and inert, so nothing is intercepted either');
}
{
  const r = run({ noApi: true, build: (body) => [under(el('button', { style: { position: 'fixed' }, rect: rect(1760, 1030, 1900, 1070) }), body)] });
  assert.strictEqual(r.kind(), '', 'no elementsFromPoint means no opinion');
  assert.strictEqual(r.toggled.inert, false);
}
{
  const r = run({ rect: rect(0, 0, 0, 0), build: () => [] });
  assert.strictEqual(r.kind(), '', 'a collapsed badge tests nothing');
}

/* ---- sitting NEXT TO a control: hidden, but only for anchored sliders and any player -------- */
{
  /* Spotify: the app does not scroll; the volume slider sits beside the badge's band. */
  const r = run({
    docHeight: 1080, htmlOverflow: 'hidden',
    build: (body) => {
      const bar = under(el('footer', { rect: rect(0, 990, 1920, 1080) }), body);
      return [under(el('input', { attrs: { type: 'range' }, rect: rect(1650, 1030, 1760, 1046) }), bar)];
    },
  });
  assert.strictEqual(r.toggled.away, true, 'a volume slider beside the badge in a pinned app hides it');
  assert.strictEqual(r.toggled.inert, true, 'and stops it taking the pointer');
  /* A scheduled forced recheck runs after the badge has hidden and must not bring it back. */
  r.update(true);
  assert.strictEqual(r.toggled.away, true, 'a hidden badge stays hidden while the slider remains');
}
{
  /* A range input in a form that has scrolled into the corner is not a volume control. */
  const r = run({ docHeight: 6000, build: (body) => [under(el('input', { attrs: { type: 'range' }, rect: rect(1650, 1030, 1760, 1046) }), body)] });
  assert.strictEqual(r.toggled.away, false, 'a slider in scrolling content does not banish the badge');
  assert.strictEqual(r.toggled.inert, false);
}
{
  /* A player shell beside the badge counts wherever it is -- an inline player is still a player. */
  const r = run({ docHeight: 6000, build: (body) => [under(el('div', { attrs: { 'data-player': '' }, rect: rect(1300, 700, 1760, 1010) }), body)] });
  assert.strictEqual(r.toggled.away, true, 'a player beside the badge hides it, anchored or not');
}
{
  /* The reach is asymmetric on purpose: 72px vertically, 32px horizontally. */
  const below = run({ docHeight: 1080, build: (body) => [under(el('input', { attrs: { type: 'range' }, rect: rect(1800, 1070, 1850, 1078) }), body)] });
  assert.strictEqual(below.toggled.away, true, 'a slider just below the badge is inside the same bar');
  const sideways = run({ docHeight: 1080, build: (body) => [under(el('input', { attrs: { type: 'range' }, rect: rect(1700, 1030, 1740, 1046) }), body)] });
  assert.strictEqual(sideways.toggled.away, false, 'a slider 44px to the side is a different part of the page');
}
{
  const r = run({ docHeight: 1080, build: (body) => [under(el('input', { attrs: { type: 'range' }, rect: rect(1800, 1030, 1800, 1030) }), body)] });
  assert.strictEqual(r.toggled.away, false, 'a zero-sized element must not banish the badge');
}
{
  /* A lift candidate that lands beside a slider is refused. */
  const r = run({
    build: (body) => {
      const bar = under(el('div', { style: { position: 'fixed' }, rect: rect(0, 700, 1920, 1080) }), body);
      const btn = under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), bar);
      const slider = under(el('input', { attrs: { type: 'range' }, rect: rect(1650, 1000, 1760, 1016) }), bar);
      return [btn, slider, bar];
    },
  });
  assert.strictEqual(r.toggled.away, true, 'a slider beside the home corner hides the badge before any lift is considered');
}

/* ---- the hover path never drops a lifted badge onto the pointer ---------------------------- */
{
  const bar = { node: null, btn: null };
  const r = run({
    build: (body) => {
      bar.node = under(el('div', { style: { position: 'fixed' }, rect: rect(0, 880, 1920, 1080) }), body);
      bar.btn = under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), bar.node);
      return [bar.btn, bar.node];
    },
  });
  assert.strictEqual(r.lift(), 42, 'lifted above the bar');
  /* The bar is dismissed; the pointer then arrives at the (lifted) badge. */
  r.elements.length = 0;
  r.now.t += 10000;
  r.update(false);
  assert.strictEqual(r.lift(), 42, 'the hover re-check leaves the badge where the pointer is heading');
  assert.strictEqual(r.toggled.inert, false);
  /* A forced check -- resize, fullscreen, a player -- brings it home. */
  r.update(true);
  assert.strictEqual(r.lift(), 0, 'a forced check brings it home');
}
{
  /* Hover path, home still blocked, current spot still free: keep the spot, stay usable. */
  const r = run({
    build: (body) => {
      const bar = under(el('div', { style: { position: 'fixed' }, rect: rect(0, 880, 1920, 1080) }), body);
      return [under(el('button', { rect: rect(1760, 1030, 1900, 1070) }), bar), bar];
    },
  });
  assert.strictEqual(r.lift(), 42);
  r.now.t += 10000;
  r.update(false);
  assert.strictEqual(r.lift(), 42);
  assert.strictEqual(r.toggled.inert, false);
}

/* ---- THE ACCUMULATION BUG: the hover path is cached ------------------------------------------ */
{
  const r = run({ docHeight: 6000, build: (body) => [under(el('input', { attrs: { type: 'range' }, rect: rect(100, 100, 200, 120) }), body)] });
  const afterFirst = r.calls.hit + r.calls.query;
  assert(afterFirst > 0, 'the first check actually measures something');
  for (let i = 0; i < 5; i++) r.update(false);
  assert.strictEqual(r.calls.hit + r.calls.query, afterFirst,
    'repeated hovers must reuse the answer -- this is the accumulation that made crossing the badge repeatedly degrade');
  r.update(true);
  assert(r.calls.hit + r.calls.query > afterFirst, 'a forced check must always recompute');
  const after = r.calls.hit + r.calls.query;
  r.sandbox.window.innerWidth = 1280;
  r.update(false);
  assert(r.calls.hit + r.calls.query > after, 'a changed viewport must invalidate the cached answer');
}

/* ---- the CSS the classes and the lift rely on ------------------------------------------------- */
assert(/\.b\.inert\{pointer-events:none\}/.test(source), 'the inert class must actually remove pointer events');
assert(/\.b\.away\{visibility:hidden;opacity:0;pointer-events:none\}/.test(source),
  'the away class must hide without collapsing the geometry needed by the next check');
assert(/\.b\.away\+\.panel\{display:none\}/.test(source), 'an open badge panel must leave with the badge');
assert(/\.b\{[^}]*pointer-events:auto/.test(source), 'the base rule still takes input when nothing is underneath');
assert(/\.b\{position:fixed;bottom:calc\(16px \+ var\(--rg-lift,0px\)\)/.test(source), 'the badge rides the lift');
assert(/\.panel\{position:fixed;bottom:calc\(52px \+ var\(--rg-lift,0px\)\)/.test(source), 'and so does its panel');
{
  /* The lift changes `bottom`, which is not transitioned: an instant move at a discrete
     event, not a repaint-driving animation in a player's corner. */
  const badgeCss = (source.match(/\.b\{[^}]*\}/) || [''])[0];
  const transition = (badgeCss.match(/transition:[^;}]*/) || [''])[0];
  assert(!/bottom|all/.test(transition), 'the lift must not be animated');
}

/* ---- THE PERFORMANCE REGRESSION, guarded ------------------------------------------------------- */
const wiringStart = source.indexOf('!badgeEventsBound){');
const wiringEnd = source.indexOf('const NO_BADGE_TYPES=', wiringStart);
assert(wiringStart > 0 && wiringEnd > wiringStart, 'the badge event wiring moved');
const wiring = source.slice(wiringStart, wiringEnd).replace(/\/\*[\s\S]*?\*\//g, '');
for (const forbidden of ['pointermove', 'mousemove', 'pointerover', 'scroll', 'setInterval']) {
  assert(!wiring.includes('"' + forbidden + '"'), 'the badge must not hit-test from ' + forbidden + ' -- it forces layout on every call');
}
assert(wiring.includes('fullscreenchange'), 'entering fullscreen must still re-check');
assert(/"play"/.test(wiring), 'a player starting must still re-check');
/* The yield block itself adds no observer or timer of its own. */
const yieldCode = source.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
assert(!/MutationObserver|setInterval|setTimeout|requestAnimationFrame|addEventListener|woOn\(/.test(yieldCode),
  'the yield logic is driven only by the discrete events already wired');

console.log('badge yield tests passed');

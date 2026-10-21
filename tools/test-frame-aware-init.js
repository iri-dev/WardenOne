/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Child frames must skip top-frame-only work while retaining their own required guards. (PERF-02)
   Run: node tools/test-frame-aware-init.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const AR = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

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

/* ---- 1. the bait sweep, in a frame of each size ----------------------------------- */

const BAIT = between(AR, '  // ---- confirm-bait sweep: installed per document', '\n  /* CREDENTIAL_FRAME_GUARD_START', 'the bait sweep install');

function frame({ top, width, height, media, discord }) {
  const state = { observers: 0, timers: [], resize: null, observed: null };
  const win = { innerWidth: width, innerHeight: height };
  const ctx = {
    console: { warn() {} }, Set, Array, Object, Math, Number, String,
    TOP_FRAME: !!top,
    MEDIA_APP_HOST: !!media,
    DISCORD_APP_HOST: !!discord,
    window: win,
    document: { documentElement: { tag: 'html' } },
    woObserver: (cb) => { state.observers++; return { observe: (target, opts) => { state.observed = opts; }, disconnect() {} }; },
    woTimeout: (fn, ms) => { state.timers.push(ms); return state.timers.length; },
    woOn: (target, type, fn) => { if (type === 'resize') state.resize = fn; },
    BAIT_REMOVE_CAP: 25, baitRemoved: 0, baitPending: new Set(),
    confirmBaitEnabled: () => true, sweepConfirmBait() {}, scheduleConfirmBaitSweep() {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(BAIT, ctx);
  return { state, win, ctx };
}

{
  const { state } = frame({ top: true, width: 300, height: 200 });
  check('the top frame installs the sweep unconditionally, even in a small window',
    state.observers === 1 && state.timers.length === 7 && state.observed && state.observed.subtree === true, JSON.stringify(state));
  check('and needs no resize listener', state.resize === null);
}
{
  const { state } = frame({ top: false, width: 300, height: 250 });
  check('a 300x250 child frame -- an ad slot -- installs nothing', state.observers === 0 && state.timers.length === 0, JSON.stringify(state));
  check('but listens for resize', typeof state.resize === 'function');
}
{
  const { state } = frame({ top: false, width: 1, height: 1 });
  check('a 1x1 child frame installs nothing', state.observers === 0 && state.timers.length === 0);
}
{
  const { state } = frame({ top: false, width: 800, height: 600 });
  check('a dialog-sized child frame installs the sweep at once', state.observers === 1 && state.timers.length === 7);
  check('and the timers are the seven passes they always were', state.timers.join(',') === '120,350,800,2000,4000,8000,15000', state.timers.join(','));
}
{
  const { state, win } = frame({ top: false, width: 1, height: 1 });
  win.innerWidth = 1200; win.innerHeight = 900;
  state.resize();
  check('a frame that grows into a dialog gets the sweep on resize', state.observers === 1 && state.timers.length === 7, JSON.stringify(state));
  state.resize();
  state.resize();
  check('and only once, however often it resizes', state.observers === 1 && state.timers.length === 7);
}
{
  const { state, ctx } = frame({ top: false, width: 800, height: 600 });
  ctx.installConfirmBaitSweep();
  ctx.installConfirmBaitSweep();
  check('the installer itself refuses to run twice, whoever calls it', state.observers === 1 && state.timers.length === 7,
    'the resize listener checks too, but the guard has to hold without it');
}
{
  const { state, win } = frame({ top: false, width: 399, height: 299 });
  check('just under the threshold installs nothing', state.observers === 0);
  win.innerWidth = 400; win.innerHeight = 300;
  state.resize();
  check('and exactly the threshold installs', state.observers === 1);
}
{
  /* Twitch's player and chat churn would drive the sweep every few frames there, for a guard
     that is off on media apps (tools/test-confirm-bait-linked-overlay.js has the why). */
  const top = frame({ top: true, width: 1400, height: 900, media: true });
  check('a media app installs no sweep in its top frame', top.state.observers === 0 && top.state.timers.length === 0, JSON.stringify(top.state));
  const child = frame({ top: false, width: 800, height: 600, media: true });
  child.ctx.installConfirmBaitSweep();
  check('nor in a dialog-sized frame of its own, whoever calls the installer', child.state.observers === 0 && child.state.timers.length === 0);
}
{
  const app = frame({ top: true, width: 1400, height: 900, discord: true });
  check('Discord app onboarding installs no confirm-bait remover',
    app.state.observers === 0 && app.state.timers.length === 0);
}
check('the thresholds are what the comment says', /const BAIT_FRAME_MIN_W = 400;/.test(AR) && /const BAIT_FRAME_MIN_H = 300;/.test(AR));
check('the grid\'s own small-viewport guard is still there', /if \(w < 150 \|\| h < 120\) return found;/.test(AR),
  'the two gates are different things: one decides whether to install, the other whether a pass samples');

/* ---- 2. hidden rules ride with the config ----------------------------------------- */

check('bridge no longer fetches hidden rules at start-up',
  !/\n  bridgeLoadUserHidden\(\);\n/.test(BRIDGE),
  'a second document_start channel from every frame, for a list that is usually empty');
check('it still refreshes them when the reader edits the list',
  /if \(!msg \|\| msg\.kind !== 'hidden-rules-refresh'\) return;\n    bridgeLoadUserHidden\(\);/.test(BRIDGE));
check('and applies the rules that arrive with the config',
  /if \(Array\.isArray\(res\.hidden\) && res\.hidden\.length\) bridgeApplyUserHidden\(res\.hidden\);\n\s*(?:bridgeFrameSite = [^\n]*\n\s*)?sendConfig\(res\.overrides \|\| \{\}\);/.test(BRIDGE));
check('the refresh path and the config path share one applier',
  /bridgeApplyUserHidden\(res\.inherited\);/.test(BRIDGE) && /function bridgeApplyUserHidden\(list\)/.test(BRIDGE));

/* run the applier */
{
  const APPLY = between(BRIDGE, '  function bridgeSafeUserSelector(', '\n  /* The initial rules arrive with the config', 'the hidden applier');
  const doc = { styles: [], marked: [], head: { appendChild(el) { doc.styles.push(el); } }, documentElement: {},
    querySelector() { return doc.styles[0] || null; }, querySelectorAll() { return doc.marked.filter((n) => n.marked); },
    createElement() { const el = { attrs: {}, textContent: '', setAttribute(k, v) { el.attrs[k] = v; } }; return el; } };
  class TestStyleSheet {
    constructor() { this.cssRules = []; }
    insertRule(css) {
      const selector = css.slice(0, css.indexOf('{'));
      if (!['#ad-banner', '.promo', '#next-pick', '[title="valid"]', 'a[title="unfinished'].includes(selector)) {
        throw new SyntaxError('invalid selector fixture');
      }
      this.cssRules.unshift({ selectorText: selector,
        style: { length: selector === 'a[title="unfinished' ? 0 : 1,
          getPropertyValue: () => 'none', getPropertyPriority: () => 'important' } });
    }
    deleteRule(index) { this.cssRules.splice(index, 1); }
  }
  const ctx = { console: { warn() {} }, Array, String, RegExp, document: doc, CSSStyleSheet: TestStyleSheet };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(APPLY + '\nglobalThis.apply = bridgeApplyUserHidden;', ctx);
  ctx.apply(['#ad-banner', '.promo', 'div{}bad', 'html', 'x'.repeat(500)]);
  check('the applier writes one style element with the safe selectors',
    doc.styles.length === 1 && doc.styles[0].textContent === '#ad-banner{display:none!important;}\n.promo{display:none!important;}', doc.styles[0] && doc.styles[0].textContent);
  check('and refuses the unsafe ones', !/bad|html\{|xxxx/.test(doc.styles[0].textContent));
  ctx.apply(['#ad-banner', 'a[href=', 'a[title="unfinished', '[title="valid"]', '.promo']);
  check('parse failures and CSS recovery cannot consume neighbouring rules',
    doc.styles[0].textContent === '#ad-banner{display:none!important;}\n[title="valid"]{display:none!important;}\n.promo{display:none!important;}');
  const mark = (selector) => ({
    marked: true, matches: (s) => s === selector,
    removeAttribute(name) { if (name === 'data-wardenone-zapped') this.marked = false; },
  });
  const confirmed = mark('#ad-banner'), removed = mark('#next-pick');
  doc.marked = [confirmed, removed];
  ctx.apply(['#ad-banner', '#next-pick']);
  ctx.apply(['#ad-banner']);
  check('removing a rule clears its mark without clearing retained rules', !removed.marked && confirmed.marked);
  check('refreshes reuse the bridge-owned sheet', doc.styles.length === 1 && doc.styles[0].id === 'wo-user-hidden');
}

/* ---- 4. the engine's host lists stay with the engine ------------------------------ *
 * Child frames need no host lists. The top frame sends only adult entries that can match
 * its current host, beside the config under a separate MAC. */
{
  check('a child frame does not ask for the engine\'s host lists',
    /const BRIDGE_TOP_FRAME = window === window\.top;/.test(BRIDGE)
    && /const CONTENT_CONFIG_NEED = BRIDGE_TOP_FRAME \? \['overrides', 'learned', 'supplemental', 'hidden'\] : \['overrides', 'hidden'\];/.test(BRIDGE));
  const SEND = between(BRIDGE, '  const sendConfig = (overrides) => {', '\n  const bridgeReplay = () => {', 'sendConfig');
  const run = (top, hostname = 'shop.example', adultSupplement = ['adult.example']) => {
    const posted = [];
    const sanitized = [];
    const ctx = {
      JSON, Object, Array, String, console,
      BRIDGE_TOP_FRAME: top,
      bridgeConfig: {}, bridgeConfigReady: false, bridgeFrameSite: 'shop.example',
      sanitizeBridgeHostList: (list) => { sanitized.push(list); return Array.isArray(list) ? list.slice() : []; },
      bridgeSyncGoogleCleanupCss() {},
      bridgeActiveAllowlist: () => [],
      bridgeSiteOverridesFor: () => ({}),
      bridgeFrameNoiseAllowed: () => false,
      bridgeFrameWebGLDisabled: () => false,
      gateSilentPresentation() {},
      mainWorldConfigForHost: (clean) => clean,
      mergeNormalizedHostLists: (limit, ...lists) => [].concat(...lists.map((l) => l || [])),
      learnedGrabberDomains: ['learned.example'],
      supplementalLists: { adultDomainsExtra: adultSupplement, grabberDomainsExtra: ['grab.example'], trustedPaymentHostsExtra: ['pay.example'] },
      postToPage: (m) => posted.push(m),
      signed: (kind, payload, m) => Object.assign(m, { seq: 7, mac: 'm', signedText: payload }),
      signedPart: (kind, payload, m) => kind + ':' + m.seq + ':' + payload,
      TOKEN: 't',
      location: { hostname },
      document: { dispatchEvent() {} },
      CustomEvent: function CustomEvent(type) { this.type = type; },
    };
    vm.createContext(ctx);
    vm.runInContext(SEND + '\nsendConfig({ enabled: true, adultDomainsExtra: ["own-adult.example"] });', ctx);
    return { message: posted[0], sanitized };
  };
  const child = run(false);
  check('a child frame\'s config carries no host lists, inside or beside it',
    child.message.lists === undefined && child.message.listsMac === undefined
    && !/adult\.example|grab\.example|pay\.example|learned\.example/.test(JSON.stringify(child.message)), JSON.stringify(child.message));
  check('...and its bridge normalises none of them', !child.sanitized.some((l) => Array.isArray(l) && l.indexOf('own-adult.example') !== -1));
  const top = run(true);
  check('the top frame\'s signed config text leaves the lists out',
    !/adult\.example|grab\.example|pay\.example|learned\.example/.test(top.message.signedText), top.message.signedText);
  check('...and only relevant lists ride beside it under a MAC bound to the config\'s seq',
    JSON.stringify(top.message.lists) === JSON.stringify({ grabberDomainsExtra: ['learned.example', 'grab.example'],
      trustedPaymentHostsExtra: ['pay.example'] })
    && top.message.listsMac === 'config-lists:7:' + JSON.stringify(top.message.lists), JSON.stringify(top.message));
  for (const [hostname, expected] of [
    ['adult.example', 'adult.example'],
    ['sub.adult.example', 'adult.example'],
    ['www.own-adult.example', 'own-adult.example'],
  ]) {
    const matching = run(true, hostname).message;
    check('adult list delivery matches ' + hostname,
      JSON.stringify(matching.lists.adultDomainsExtra) === JSON.stringify([expected])
      && matching.listsMac === 'config-lists:7:' + JSON.stringify(matching.lists), JSON.stringify(matching));
  }
  const lookalike = run(true, 'notadult.example').message;
  check('adult list delivery rejects a lookalike hostname',
    lookalike.lists.adultDomainsExtra === undefined, JSON.stringify(lookalike.lists));
  const manyAdults = Array.from({ length: 2998 }, (_, i) => 'site' + i + '.adult.example.com');
  manyAdults.push('listed.adult.example.com');
  const largeList = run(true, 'sub.listed.adult.example.com', manyAdults).message;
  check('a match at the end of a large adult list reaches the engine alone',
    JSON.stringify(largeList.lists.adultDomainsExtra) === '["listed.adult.example.com"]'
    && !largeList.signedText.includes('listed.adult.example.com'), JSON.stringify(largeList.lists));
}

/* ---- 5. the click-layer sweep asks its document-level gates first ------------------- *
 * Every frame sweeps <body>'s children at DOMContentLoaded and again when the config lands.
 * Nothing in considerClickLayer acts without strict popups on and a player in the document,
 * yet each child had its first link resolved and matched against the trusted hosts before
 * that was asked: ~2 ms a frame on the eight-frame profile page, which has no player. */
{
  const SWEEP = between(AR, '  function sweepClickLayers() {', '\n  // The layers are appended straight to <body>', 'the click-layer sweep');
  const run = (strict, player) => {
    const considered = [];
    const kids = [{ tagName: 'P' }, { tagName: 'SCRIPT' }, { tagName: 'DIV' }];
    const ctx = {
      document: { body: { children: kids }, documentElement: { children: [] } },
      CLICK_LAYER_SKIP: /^(?:SCRIPT|STYLE)$/, Math,
      strictPopupEnabled: () => strict, playerDocument: () => player,
      considerClickLayer: (node) => { considered.push(node.tagName); return false; },
    };
    vm.createContext(ctx);
    vm.runInContext(SWEEP + '\nsweepClickLayers();', ctx);
    return considered.join(',');
  };
  check('with no player in the document the sweep looks at no child', run(true, false) === '');
  check('with strict popups off it looks at none either', run(false, true) === '');
  check('with both, every eligible child is still considered', run(true, true) === 'P,DIV', run(true, true));
}

/* ---- 3. the worker answers both in one message ----------------------------------- */

check('the config handler names the asking frame\'s host from sender.url (its inherited origin for an about:blank child)',
  /contentConfigFrameHost\(sender\)/.test(between(BG, "kind === 'content-config-get'", 'return true;', 'the config-get handler'))
  && /function contentConfigFrameHost\(sender\) \{[\s\S]{0,400}?\[sender && sender\.url, sender && sender\.origin\]/.test(BG));
{
  /* The builder sits behind the shared memo now (COST-01); the slice starts at its input keys. */
  const SNAP = between(BG, 'function contentConfigInputKeys() {', '\nlet __contentConfigRefreshTimer', 'the snapshot builder');
  const calls = [];
  const ctx = {
    console: { warn() {} }, Array, Object, String, Promise, Set, WOEyeShieldProfiles: require('../eyeshield-profiles.js'),
    localGet: async () => ({ wardenone_config: { enabled: true } }),
    SUPPLEMENTAL_LIST_STORAGE_KEY: 'sup',
    emptySupplementalLists: () => ({ adultDomainsExtra: [], grabberDomainsExtra: [], trustedPaymentHostsExtra: [], searchJunkDomainsExtra: [] }),
    sanitizeContentConfig: (c) => c, sanitizeLearnedForContent: () => [], sanitizeSupplementalLists: () => ({}), sanitizeSearchJunkForContent: () => [],
    readHiddenElements: async () => { calls.push('read'); return { 'shop.example': ['#promo', '.cookie-bar'] }; },
    hiddenSelectorsForHost: (all, host) => (host === 'shop.example' || host.endsWith('.shop.example')) ? all['shop.example'] : [],
    siteIdentityBg: (h) => String(h || ''),
    /* The packaged scraper seed is read by the worker since BUG-10; nothing to add here. */
    searchJunkSeed: async () => ({ hosts: [], ok: true, error: '' }),
    searchJunkStoredHosts: (raw) => (Array.isArray(raw) ? raw : []),
  };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(SNAP + '\nglobalThis.build = buildContentConfigSnapshot;', ctx);
  (async () => {
    const a = await ctx.build('www.shop.example');
    check('a frame on the site gets its hidden rules with the config', Array.isArray(a.hidden) && a.hidden.join(',') === '#promo,.cookie-bar', JSON.stringify(a.hidden));
    const b = await ctx.build('ads.example');
    check('a cross-origin frame gets its own (empty) rules, not the top page\'s', Array.isArray(b.hidden) && b.hidden.length === 0);
    calls.length = 0;
    const c = await ctx.build('');
    check('no host, no lookup', Array.isArray(c.hidden) && c.hidden.length === 0 && calls.length === 0);
    check('the separate hidden-list kind still exists for the popup and the refresh', /kind === 'hidden-list' && msg\.hostname/.test(BG));

    console.log('');
    if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
    console.log('all frame-aware init checks passed');
  })();
}

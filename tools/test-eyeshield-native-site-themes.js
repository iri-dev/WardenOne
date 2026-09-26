/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Eye Shield must not paint over a site's own design where that design is what works.
 *
 * Three reports, one cause -- a site profile repainting components the site already
 * draws correctly:
 *
 *   GitHub     typed text invisible in the search box; file names and commit messages
 *              one washed-out blue; octicons heavy. Measured live: the search <input> is
 *              transparent and the typed text is drawn on a layer BEHIND it, and the
 *              profile painted every input rgb(13,15,20). Links were all forced
 *              #8ab4ff, and every SVG was given stroke:currentColor. GitHub now keeps its
 *              own light/dark theme, switched through data-color-mode on <html>; Ultra
 *              only takes the canvas to black. Measured after: the input transparent,
 *              the typed text rgb(240,246,252), file names in the text colour.
 *              A signed-in page carries only the theme the reader chose, so the switch
 *              waits for GitHub's stylesheet (loaded the way GitHub's picker loads it);
 *              switching without it left every GitHub colour undefined -- the second
 *              report: dark text on black, white buttons, icons gone.
 *
 *   YouTube    every album cover a flat square (black in Ultra, white in Light). The
 *   Music      YouTube theme's bare `#content` matched the overlay div on each cover;
 *              YouTube Music has no ytd- element for the rest of that theme to reach.
 *              It has its own profile. Light: YouTube's shared colours switched through
 *              the `dark` attribute, the app's own variables turned light, and only the
 *              text and icon colours its stylesheets hard-code rewritten (measured live:
 *              895 rules, 70 ms). Ultra sinks its grey bars and panels to near-black.
 *
 *   ChatGPT    the voice button beside the composer "too pale": a white disc with a
 *              white glyph. Every button's text and every SVG's fill was forced to the
 *              theme's near-white; ChatGPT's primary buttons are white discs and pills.
 *              In Light the composer stayed dark and the conversations near-white. The
 *              signed-in app switches with a `dark`/`light` class on <html> and ships
 *              both themes; that class is what is switched now.
 *
 * Run: node tools/test-eyeshield-native-site-themes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'eyeshield.js'), 'utf8');
const SITES = fs.readFileSync(path.join(ROOT, 'eyeshield-sites.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* ---- a page just real enough to load the shipped core ---------------------------- */

function makeHtml(attrs, classes, scheme) {
  const map = new Map(Object.entries(attrs || {}));
  let cls = (classes || []).slice();
  let colorScheme = scheme || '';
  let el = null;
  const notify = (name, old) => notifyAttr(name, old, el);
  const setClasses = (next) => { const old = cls.join(' '); cls = next; if (cls.join(' ') !== old) notify('class', old); };
  el = {
    nodeType: 1,
    isConnected: true,
    querySelector: () => null,
    style: {
      setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; },
      get colorScheme() { return colorScheme; },
      set colorScheme(v) { const old = colorScheme; colorScheme = String(v); if (colorScheme !== old) notify('style', old); },
    },
    classList: {
      contains: (c) => cls.indexOf(c) >= 0,
      add: (c) => { if (cls.indexOf(c) < 0) setClasses(cls.concat(c)); },
      remove: (c) => { if (cls.indexOf(c) >= 0) setClasses(cls.filter((x) => x !== c)); },
      toggle: (c, on) => { if (on) { if (cls.indexOf(c) < 0) setClasses(cls.concat(c)); } else if (cls.indexOf(c) >= 0) setClasses(cls.filter((x) => x !== c)); },
    },
    classes: () => cls.slice(),
    appendChild() {},
    getAttribute: (a) => (map.has(a) ? map.get(a) : null),
    hasAttribute: (a) => map.has(a),
    setAttribute: (a, v) => { const old = map.has(a) ? map.get(a) : null; map.set(a, String(v)); notify(a, old); },
    removeAttribute: (a) => { const old = map.has(a) ? map.get(a) : null; map.delete(a); notify(a, old); },
    attrs: () => Object.fromEntries(map),
  };
  return el;
}
let observers = [];
function notifyAttr(attributeName, oldValue, target) {
  observers.forEach((o) => {
    if (!o.active) return;
    if (o.filter && o.filter.indexOf(attributeName) < 0) return;
    o.queue.push({ type: 'attributes', attributeName, oldValue, target });
  });
}
/* An element rendered into the page later, as React would. */
function notifyAdded(node) {
  observers.forEach((o) => { if (o.active) o.queue.push({ type: 'childList', addedNodes: [node], target: null }); });
}
/* Theme scopes inside the page (ChatGPT's `.dark`/`.light`), for querySelectorAll. */
let themeScopes = [];
/* Deliver queued records the way the browser does: after the current script, in a batch. */
function flushObservers() {
  for (let guard = 0; guard < 10; guard++) {
    const due = observers.filter((o) => o.active && o.queue.length);
    if (!due.length) return guard;
    due.forEach((o) => { const q = o.queue.splice(0); o.cb(q); });
  }
  return 10;
}
class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this.queue = []; this.active = false; this.filter = null; observers.push(this); }
  observe(_t, opts) {
    if (observers.indexOf(this) < 0) observers.push(this); // sections reset the list; an observer re-armed later must still hear
    this.active = true; this.filter = opts && opts.attributeFilter ? opts.attributeFilter : null;
  }
  disconnect() { this.active = false; this.queue = []; }
}

/* GitHub's theme stylesheets as a page carries them: the themes it needs as ordinary links
   named after the theme, every other theme as a link[data-color-theme] placeholder holding
   data-href, which loads once it is given an href. Loads are settled by hand so the test decides
   when a stylesheet arrives. */
let themeSheets = [];
let placeholders = [];
function makePlaceholder(name) {
  const attrs = new Map([['data-color-theme', name], ['data-href', 'https://github.githubassets.com/assets/' + name + '-0123abcd.css']]);
  const ph = {
    name, sheet: null, listeners: {}, requested: 0,
    getAttribute: (a) => (attrs.has(a) ? attrs.get(a) : null),
    setAttribute: (a, v) => { attrs.set(a, String(v)); if (a === 'href') ph.requested++; },
    addEventListener: (type, fn) => { (ph.listeners[type] = ph.listeners[type] || []).push(fn); },
  };
  return ph;
}
function settle(name, ok) {
  const ph = placeholders.find((p) => p.name === name);
  if (!ph) return;
  if (ok) ph.sheet = {};
  const fns = (ph.listeners[ok ? 'load' : 'error'] || []).splice(0);
  fns.forEach((fn) => fn({ type: ok ? 'load' : 'error' }));
}
function linkQuery(sel) {
  const scope = /^\.(dark|light),\[data-theme="(dark|light)"\]$/.exec(sel);
  if (scope) {
    const html = ctx.document.documentElement;
    return [html].concat(themeScopes).filter((e) => (e.classList && e.classList.contains(scope[1]))
      || (e.getAttribute && e.getAttribute('data-theme') === scope[2]));
  }
  if (sel === 'link[href]') {
    return themeSheets.map((name) => ({ getAttribute: (a) => (a === 'href' ? 'https://github.githubassets.com/assets/' + name + '-89abcdef.css' : null), sheet: {} }))
      .concat(placeholders.filter((p) => p.getAttribute('href')));
  }
  return [];
}
const noop = () => {};
const messageListeners = [];
const el = () => ({ style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' }, setAttribute: noop, remove: noop, appendChild: noop, textContent: '' });
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
  MutationObserver: FakeMutationObserver,
  CSS: { escape: (s) => String(s).replace(/"/g, '\\"') },
  location: { hostname: 'example.com' },
  localStorage: { removeItem: noop },
  chrome: { runtime: { sendMessage: noop, onMessage: { addListener: (fn) => { messageListeners.push(fn); }, removeListener: noop }, lastError: undefined } },
  document: {
    readyState: 'complete',
    getElementById: () => null,
    createElement: el,
    head: el(),
    documentElement: makeHtml({}),
    body: null,
    querySelectorAll: linkQuery,
    querySelector: (sel) => {
      const m = /^link\[data-color-theme="([^"]+)"\]\[data-href\]$/.exec(sel);
      return m ? placeholders.find((p) => p.name === m[1]) || null : null;
    },
    addEventListener: noop,
    referrer: '',
  },
  addEventListener: noop,
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

/* The core keeps its functions inside one closure. Expose the ones under test just before
   the closure ends -- the code that runs is the shipped code, unchanged. */
const EXPOSE = ['themeHeader', 'themeFooter', 'managedThemeHostName', 'applyGitHubNativeTheme',
  'restoreGitHubNativeTheme', 'applyChatGPTNativeTheme', 'restoreChatGPTNativeTheme',
  'applyYouTubeMusicNativeTheme', 'restoreYouTubeMusicNativeTheme', 'applyNativeTheme', 'restoreNativeThemes',
  'buildVarRoles', 'buildThemeCSS', 'managedRemapsOwnText', 'needsManagedObserverHost',
  'scheduleNativeThemeCheck', 'nativeThemeVerdict'];
function loadCore() {
  const tail = CORE.lastIndexOf('}());');
  const src = CORE.slice(0, tail) + 'globalThis.__esTest = {' + EXPOSE.map((n) => n + ':' + n).join(',')
    + ',loadConfig:loadConfig,getCfg:function(){return cfg;},nativeFallback:function(){return nativeThemeFallback;}};\n' + CORE.slice(tail);
  vm.runInContext(src, ctx, { filename: 'eyeshield.js' });
  return ctx.__esTest;
}
vm.runInContext(SITES, ctx, { filename: 'eyeshield-sites.js' });
let core = loadCore();
check('the core loads with its internals reachable', !!(core && typeof core.themeFooter === 'function'));
if (!core) process.exit(1);

function themeFor(host, mode, htmlAttrs) {
  ctx.location.hostname = host;
  ctx.document.documentElement = makeHtml(htmlAttrs || {});
  return { name: core.managedThemeHostName(), css: core.themeHeader(mode) + core.themeFooter(mode) };
}
function rules(css) {
  const out = [];
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => { out.push({ sel: sel.trim(), body }); return ''; });
  return out;
}

/* ---- GitHub: its own theme, not a repaint ----------------------------------------- */

console.log('GitHub');
const GH_ATTRS = { 'data-color-mode': 'auto', 'data-light-theme': 'light', 'data-dark-theme': 'dark' };
check('a GitHub page carrying data-color-mode is the github profile',
  themeFor('github.com', 'dark', GH_ATTRS).name === 'github');
check('a GitHub-host page without it gets the generic remap like any site',
  themeFor('github.com', 'dark', {}).name === '',
  'a profile written for Primer pages does not describe it');

for (const mode of ['dark', 'ultra', 'light']) {
  const { css } = themeFor('github.com', mode, GH_ATTRS);
  const site = rules(css).filter((r) => /bgColor|fgColor|color-canvas/.test(r.body) || /var\(--bgColor-default\)/.test(r.body));
  check(mode + ': the page takes GitHub\'s own canvas back from the core header',
    /html,body\{background-color:var\(--bgColor-default\) !important;color:var\(--fgColor-default\) !important;\}/.test(css));
  check(mode + ': nothing paints GitHub\'s inputs',
    !/(^|[\s,}])input[\s,{:]/.test(css) && !/search-with-dialog/.test(css),
    'the search box draws its text BEHIND a transparent input');
  check(mode + ': nothing recolours GitHub\'s links',
    !rules(css).some((r) => /(^|,)\s*a(\[|,|$|\.)/.test(r.sel) && /color:/.test(r.body)),
    'file names, commit messages and links each have their own colour');
  check(mode + ': nothing strokes or refills the octicons',
    !rules(css).some((r) => /(^|,)\s*(svg|path|octicon-icon)\s*(,|$)/.test(r.sel) && /(^|;)\s*(fill|stroke|color)\s*:/.test(r.body)),
    'a stroke on a fill-drawn icon makes it heavy');
  check(mode + ': the GitHub rules are only the canvas, its scheme and its tokens',
    site.every((r) => /^(html,body|html\[data-color-mode="dark"\])$/.test(r.sel)),
    site.map((r) => r.sel).join(' | '));
  check(mode + ': the colour scheme follows the theme GitHub is actually showing',
    css.indexOf('html[data-color-mode="light"]{color-scheme:light !important;}html[data-color-mode="dark"]{color-scheme:dark !important;}') >= 0,
    'the switch waits for the stylesheet, so the old theme can still be showing');
  const setsTokens = /html\[data-color-mode="dark"\]\{[^}]*--bgColor-default:#000000 !important/.test(css);
  check(mode + (mode === 'ultra' ? ': Ultra takes the canvas to black, once dark is in force' : ': GitHub\'s own tokens are left alone'),
    mode === 'ultra' ? setsTokens && /--overlay-bgColor:#0d0f14 !important/.test(css) : !/--bgColor|--fgColor/.test(css.replace(/var\(--[\w-]+\)/g, '')),
    'black under GitHub light while its dark sheet loads would be dark text on black');
  if (mode === 'ultra') {
    check('ultra: GitHub\'s grey buttons, inputs, panels and cards go near-black too',
      ['--button-default-bgColor-rest:#111319', '--control-bgColor-rest:#0d0f14', '--bgColor-muted:#08090c', '--card-bgColor:#08090c']
        .every((d) => css.indexOf(d + ' !important') >= 0),
      'a reader already on GitHub dark otherwise sees only the page change');
    check('ultra: borders stay GitHub\'s, so the structure holds', !/--borderColor/.test(css));
  }
}

/* The switch itself, driven against a page the way GitHub serves one. */
console.log('GitHub theme switch');
function ghPage(attrs, loaded, parked) {
  observers = [];
  themeSheets = loaded || [];
  placeholders = (parked || []).map(makePlaceholder);
  ctx.location.hostname = 'github.com';
  ctx.__wardenOneGitHubThemeOrig = null;
  const h = makeHtml(attrs);
  ctx.document.documentElement = h;
  return h;
}
const PARKED = ['light', 'dark', 'dark_dimmed', 'dark_high_contrast'];
{
  /* A signed-in reader on GitHub light: only the light sheet is on the page. This is the page
     that broke -- measured live, forcing dark there left --bgColor-default and --fgColor-default
     empty, so every component fell back to light colours on the black canvas. */
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }, ['light'], PARKED);
  core.applyGitHubNativeTheme('ultra');
  flushObservers();
  const dark = placeholders.find((p) => p.name === 'dark');
  check('with the dark sheet absent, nothing switches yet', h.getAttribute('data-color-mode') === 'light');
  check('the dark sheet is requested the way GitHub\'s own picker does', dark.requested === 1
    && dark.getAttribute('href') === dark.getAttribute('data-href'));
  check('and only that one', placeholders.filter((p) => p.requested).length === 1);
  settle('dark', true);
  flushObservers();
  check('once it arrives, GitHub switches to dark', h.getAttribute('data-color-mode') === 'dark'
    && h.getAttribute('data-dark-theme') === 'dark');
  h.setAttribute('data-color-mode', 'light');
  const rounds = flushObservers();
  check('when GitHub writes its mode back, the switch holds', h.getAttribute('data-color-mode') === 'dark');
  check('and the hold settles instead of looping', rounds < 10, rounds + ' rounds');
  core.applyGitHubNativeTheme('light');
  flushObservers();
  check('light switches straight back: its sheet is already there', h.getAttribute('data-color-mode') === 'light');
  core.restoreGitHubNativeTheme();
  flushObservers();
  check('off restores exactly what the page had', JSON.stringify(h.attrs()) === JSON.stringify({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }),
    JSON.stringify(h.attrs()));
  h.setAttribute('data-color-mode', 'dark');
  flushObservers();
  check('and once off, the page may change its own theme', h.getAttribute('data-color-mode') === 'dark');
}
{
  /* "Sync with system": both sheets are on the page, so the switch is immediate. */
  const h = ghPage({ 'data-color-mode': 'auto', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }, ['light', 'dark'], PARKED);
  core.applyGitHubNativeTheme('dark');
  check('with both sheets present the switch is immediate', h.getAttribute('data-color-mode') === 'dark');
  check('and nothing is fetched', placeholders.every((p) => !p.requested));
  core.restoreGitHubNativeTheme();
}
{
  /* The reader's own dark variant is loaded for them and kept. */
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark_dimmed' }, ['light'], PARKED);
  core.applyGitHubNativeTheme('dark');
  settle('dark_dimmed', true);
  check('a reader\'s dimmed choice is loaded and kept', h.getAttribute('data-color-mode') === 'dark'
    && h.getAttribute('data-dark-theme') === 'dark_dimmed');
  core.restoreGitHubNativeTheme();
}
{
  /* If the reader's variant will not load, plain dark is the fallback. */
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark_dimmed' }, ['light'], PARKED);
  core.applyGitHubNativeTheme('ultra');
  settle('dark_dimmed', false);
  check('a variant that fails to load falls back to plain dark', placeholders.find((p) => p.name === 'dark').requested === 1
    && h.getAttribute('data-color-mode') === 'light');
  settle('dark', true);
  check('which is used once it arrives', h.getAttribute('data-color-mode') === 'dark' && h.getAttribute('data-dark-theme') === 'dark');
  core.restoreGitHubNativeTheme();
}
{
  /* Nothing loadable: GitHub is left exactly as it is rather than half switched. */
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }, ['light'], []);
  core.applyGitHubNativeTheme('dark');
  flushObservers();
  check('with no dark sheet to be had, GitHub stays as it is', h.getAttribute('data-color-mode') === 'light');
  core.restoreGitHubNativeTheme();
}
{
  /* The mode changes, or Eye Shield turns off, while a sheet is still on its way: the late
     arrival must not switch anything. */
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }, ['light'], PARKED);
  core.applyGitHubNativeTheme('ultra');
  core.applyGitHubNativeTheme('light');
  settle('dark', true);
  flushObservers();
  check('a sheet that lands after the mode changed is ignored', h.getAttribute('data-color-mode') === 'light');
  core.applyGitHubNativeTheme('dark');
  core.restoreGitHubNativeTheme();
  settle('dark', true);
  flushObservers();
  check('and one that lands after Eye Shield turned off', h.getAttribute('data-color-mode') === 'light');
}
{
  /* An attribute the page never had is removed again, not left set to a value. */
  const h = ghPage({ 'data-color-mode': 'auto' }, ['light', 'dark'], PARKED);
  core.applyGitHubNativeTheme('dark');
  core.restoreGitHubNativeTheme();
  check('attributes the page lacked are removed on off', !h.hasAttribute('data-dark-theme') && h.getAttribute('data-color-mode') === 'auto',
    JSON.stringify(h.attrs()));
}
{
  /* A copy that replaces this one after an update restores the PAGE's values, not the
     values the previous copy wrote. */
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }, ['light', 'dark'], PARKED);
  core.applyGitHubNativeTheme('ultra');
  ctx.__wardenOneEyeShieldInstalled = '0.0.0-older';
  const next = loadCore();
  next.applyGitHubNativeTheme('ultra');
  next.restoreGitHubNativeTheme();
  check('a replacement copy restores the page\'s own mode', h.getAttribute('data-color-mode') === 'light',
    'it would otherwise take the forced dark for the original');
  core = next;
}

check('apply() switches the sites with their own themes through one entry',
  /applyNativeTheme\(mode\);\n\s*scheduleNativeThemeCheck\(mode\);\n\s*removePreload\(\); \/\/ real theme is in place now/.test(CORE));
check('and puts them all back when the mode goes off and when Eye Shield is disabled',
  (CORE.match(/restoreNativeThemes\(\);/g) || []).length >= 2);
{
  const h = ghPage({ 'data-color-mode': 'light', 'data-light-theme': 'light', 'data-dark-theme': 'dark' }, ['light', 'dark'], PARKED);
  core.applyNativeTheme('dark');
  check('the entry routes a GitHub page to the GitHub switch', h.getAttribute('data-color-mode') === 'dark');
  core.restoreNativeThemes();
  check('and the reset puts it back', h.getAttribute('data-color-mode') === 'light');
}

/* ---- YouTube Music: its own app, its own profile ---------------------------------- */

console.log('YouTube Music');
check('YouTube Music is not the YouTube profile', themeFor('music.youtube.com', 'dark').name === 'youtubemusic');
check('and YouTube itself still is', themeFor('www.youtube.com', 'dark').name === 'youtube');
check('the YouTube Music host is matched before YouTube',
  CORE.indexOf("if (isYouTubeMusicHost()) return 'youtubemusic';") >= 0
    && CORE.indexOf("if (isYouTubeMusicHost()) return 'youtubemusic';") < CORE.indexOf("if (isYouTubeHost()) return 'youtube';"));
for (const mode of ['dark', 'ultra', 'light']) {
  const { css } = themeFor('music.youtube.com', mode);
  check(mode + ': the YouTube theme does not reach it', !/ytd-|--yt-spec-/.test(css));
  check(mode + ': nothing paints the overlay on every cover', !/#content/.test(css),
    'painting it the page colour turned each cover into a flat square');
}
{
  /* Normal, Dark and Ultra were indistinguishable on YouTube Music: Dark changed nothing, and
     Ultra's variables never reached the pieces anyone sees, because each component re-declares
     its own and the chips, search field, active sidebar entry and tonal buttons paint hard-coded
     translucent white (rgba(255,255,255,.1)/.15 natively, measured live). Both modes now paint
     those pieces by name, and a mode must be visibly different from the one before it without
     ever lightening the page. */
  const CHIP = 'ytmusic-chip-cloud-chip-renderer:not([is-selected]) a.ytmusic-chip-cloud-chip-renderer';
  const ruleFor = (css, selectorStart) => {
    const at = css.indexOf(selectorStart);
    return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const alphaOf = (decl) => { const m = /rgba\(255,255,255,(\.\d+)\)/.exec(decl); return m ? Number(m[1]) : NaN; };
  const dark = themeFor('music.youtube.com', 'dark').css;
  check('dark keeps YouTube Music\'s own canvas and theme -- never lighter',
    /html,body\{background-color:#030303 !important;\}/.test(dark) && dark.indexOf('--ytmusic-') < 0);
  check('dark removes the tinted artwork wash behind the top of the page',
    /ytmusic-browse-response #background\.immersive-background\{visibility:hidden !important;\}/.test(dark)
      && /ytmusic-browse-response \.background-gradient\{background-image:none !important;\}/.test(dark));
  const darkFill = alphaOf(ruleFor(dark, CHIP + ','));
  check('dark sinks the chip, sidebar and button fills below the native .1',
    darkFill > 0 && darkFill < 0.1 && ruleFor(dark, CHIP + ',').indexOf('background-color') >= 0
      && dark.indexOf('ytmusic-guide-entry-renderer[active] tp-yt-paper-item') >= 0
      && dark.indexOf('button.ytSpecButtonShapeNextTonal.ytSpecButtonShapeNextMono') >= 0,
    'fill alpha ' + darkFill);
  check('dark sinks the search field below its native .15',
    alphaOf(ruleFor(dark, 'ytmusic-search-box .search-box.ytmusic-search-box{')) < 0.15);

  const ultra = themeFor('music.youtube.com', 'ultra').css;
  ['--ytmusic-background', '--ytmusic-general-background-c', '--ytmusic-nav-bar', '--ytmusic-player-page-background',
    '--ytmusic-player-bar-background', '--yt-sys-color-baseline--base-background']
    .forEach((v) => check('ultra takes ' + v + ' to black', ultra.indexOf(v + ':#000000 !important') >= 0));
  check('ultra paints the canvas and sidebar black directly',
    /html,body,#guide-wrapper\{background-color:#000000 !important;\}/.test(ultra));
  check('ultra removes the artwork wash too', /#background\.immersive-background\{visibility:hidden !important;\}/.test(ultra));
  const ultraFill = ruleFor(ultra, CHIP + ',');
  check('ultra draws the chips, active sidebar entry and tonal buttons as black with an outline',
    /background-color:#000000 !important/.test(ultraFill) && /box-shadow:inset 0 0 0 1px rgba\(255,255,255,\.\d+\) !important/.test(ultraFill),
    'a black fill alone on a black page shows no change');
  check('ultra draws the search field as a black box with a visible border',
    /ytmusic-search-box \.search-box\.ytmusic-search-box\{background:#000000 !important;border-color:rgba\(255,255,255,\.\d+\) !important;\}/.test(ultra));
  check('ultra separates the black player bar from the black page', /ytmusic-player-bar\{box-shadow:inset 0 1px 0 rgba/.test(ultra));
  check('ultra brings the dimmed secondary text up to near white',
    /:is\(\.subtitle,\.secondary-flex-columns,\.strapline-text,\.byline\) a\{color:#d4d4d4 !important;\}/.test(ultra));
  check('a selected chip keeps its own white fill in both modes, so the active filter stays obvious',
    [dark, ultra].every((css) => css.indexOf('ytmusic-chip-cloud-chip-renderer a.') < 0
      && css.indexOf('ytmusic-chip-cloud-chip-renderer:not([is-selected])') >= 0));
  const light = themeFor('music.youtube.com', 'light').css;
  check('light turns the app\'s own surfaces and text light', ['--ytmusic-background:#ffffff', '--ytmusic-nav-bar:#ffffff',
    '--ytmusic-player-bar-background:#f9f9f9', '--ytmusic-text-primary:#0f0f0f', '--ytmusic-text-secondary:#606060']
    .every((d) => light.indexOf(d + ' !important') >= 0));
  check('light fades the artwork backdrop to the page, not to black',
    /ytmusic-browse-response \.background-gradient\{background-image:linear-gradient\(rgba\(255,255,255,\.72\),#ffffff\) !important;\}/.test(light));
  check('light shows the logo\'s own icon with the word set beside it, not a white wordmark on white',
    /ytmusic-logo img\.logo\{width:24px !important;[^}]*object-position:left center !important;\}/.test(light)
      && /ytmusic-logo a::after\{content:"Music";[^}]*color:#030303;\}/.test(light));
}
{
  ctx.location.hostname = 'music.youtube.com';
  check('light rewrites YouTube Music\'s own text colours', core.managedRemapsOwnText('light') === true);
  check('dark and ultra do not', !core.managedRemapsOwnText('dark') && !core.managedRemapsOwnText('ultra'));
  ctx.location.hostname = 'www.youtube.com';
  check('and nowhere else does', !core.managedRemapsOwnText('light'));
  check('the text-only remap is what the core builds for it',
    /root === document && managedRemapsOwnText\(mode\) \? buildThemeCSS\(mode, sheetsOfRoot\(root\), true\)/.test(CORE));
  check('with the var-role scan it needs, on the first theme and on every rebuild',
    (CORE.match(/if \(!isManagedThemeHost\(\) \|\| managedRemapsOwnText\((mode|activeRemap)\)\) buildVarRoles\(roots\);/g) || []).length === 2);
}
{
  /* The engine's text-only remap, run on a stylesheet shaped like YouTube Music's. */
  function decl(obj) {
    const names = Object.keys(obj);
    const st = { length: names.length, getPropertyValue: (p) => (obj[p] == null ? '' : obj[p]) };
    names.forEach((n, i) => { st[i] = n; });
    return st;
  }
  const rule = (selectorText, obj) => ({ type: 1, selectorText, style: decl(obj) });
  const sheet = { cssRules: [
    rule(':root', { '--text-only': '#ffffff', '--shared': '#ffffff', '--surface': '#212121' }),
    rule('.title', { color: 'rgb(255, 255, 255)' }),
    rule('.sub', { color: 'rgba(255, 255, 255, 0.7)' }),
    rule('.card', { 'background-color': '#212121', color: '#fff' }),
    rule('.pill', { 'background-color': 'rgba(255, 255, 255, 0.1)' }),
    rule('.cover', { background: 'url("a.png") rgba(255, 255, 255, 0.9)' }),
    rule('.edge', { 'border-color': '#ffffff' }),
    rule('.a', { color: 'var(--text-only)' }),
    rule('.chip', { background: 'var(--shared)' }),
    rule('.b', { color: 'var(--shared)' }),
    rule('.c', { 'background-color': 'var(--surface)' }),
  ] };
  core.buildVarRoles([{ styleSheets: [sheet] }]);
  const out = core.buildThemeCSS('light', [sheet], true);
  const bodyOf = (sel) => { const m = out.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[2] : ''; };
  const light = (v) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(v); return m ? (+m[1] + +m[2] + +m[3]) / 3 : 255; };
  check('white text is rewritten dark', light(bodyOf('.title')) < 60, bodyOf('.title'));
  check('secondary text keeps its transparency', /rgba\(\d+, \d+, \d+, 0\.7\)/.test(bodyOf('.sub')), bodyOf('.sub'));
  check('a surface keeps the site\'s own colour', !/\.card\{[^}]*background/.test(out), 'the surfaces are the native theme\'s');
  check('a translucent white wash becomes a faint dark one', /\.pill\{background-color:rgba\(0, 0, 0, 0\.06\) !important;\}/.test(out),
    'YouTube Music lifts its chips with rgba(255,255,255,.1), invisible on a white page -- measured live');
  check('but a near-opaque white is a surface, not a wash, and an image is never touched', !/\.cover\{/.test(out));
  check('borders are left alone', !/border/.test(out));
  check('a variable used only for text is rewritten', /--text-only:rgb\(\d+, \d+, \d+\)/.test(bodyOf(':root'))
    && light(bodyOf(':root')) < 60, bodyOf(':root'));
  check('a variable also used as a surface is not', !/--shared/.test(out),
    'the text colour of one component is the chip behind another');
  check('nor is a surface variable', !/--surface/.test(out));
}
{
  /* The shared YouTube colours switch through the `dark` attribute. */
  observers = [];
  ctx.location.hostname = 'music.youtube.com';
  ctx.__wardenOneYouTubeMusicDarkOrig = null;
  const h = makeHtml({ dark: 'true' });
  ctx.document.documentElement = h;
  core.applyYouTubeMusicNativeTheme('light');
  flushObservers();
  check('light removes YouTube Music\'s dark switch', !h.hasAttribute('dark'));
  h.setAttribute('dark', 'true');
  flushObservers();
  check('and holds it off when the app sets it again', !h.hasAttribute('dark'));
  core.applyYouTubeMusicNativeTheme('ultra');
  flushObservers();
  check('ultra puts it back as the app had it', h.getAttribute('dark') === 'true');
  core.applyYouTubeMusicNativeTheme('light');
  core.restoreNativeThemes();
  check('and so does turning Eye Shield off', h.getAttribute('dark') === 'true');
  check('the rebuild watch runs for YouTube Music only in light',
    /managedRemapsOwnText\(activeRemap\)/.test(CORE.slice(CORE.indexOf('function needsManagedObserverHost'), CORE.indexOf('function needsManagedObserverHost') + 300)));
}

/* ---- ChatGPT: its own theme --------------------------------------------------------- */

console.log('ChatGPT');
for (const mode of ['dark', 'ultra', 'light']) {
  const { css } = themeFor('chatgpt.com', mode);
  const rs = rules(css);
  const site = rs.filter((r) => !/^(html|img,picture|::selection|::-moz-selection|#wardenone)/.test(r.sel) && !/^@media/.test(r.sel));
  check(mode + ': nothing repaints ChatGPT\'s buttons, icons, links or text',
    !rs.some((r) => /(^|,)\s*(button|svg|path|a\[href\]|p|li|article)\b/.test(r.sel) && /(color|fill|stroke|background)\s*:/.test(r.body)),
    'its white send and voice discs lost their glyphs; its sidebar went blue');
  check(mode + ': the core leaves the page background to ChatGPT', !/html,body\{background/.test(css));
  const PIN = ':root,:root *';
  check(mode + ': the polyfilled light-dark() switch is pinned to the mode on every element',
    rs.some((r) => r.sel === PIN
      && (mode === 'light' ? /--lightningcss-light:initial !important;--lightningcss-dark:\s+!important/ : /--lightningcss-light:\s+!important;--lightningcss-dark:initial !important/).test(r.body)));
  check(mode + ': and so is color-scheme, which the browser\'s own light-dark() follows',
    rs.some((r) => r.sel === PIN && new RegExp('color-scheme:' + (mode === 'light' ? 'light' : 'dark') + ' !important').test(r.body)),
    'ChatGPT sets color-scheme: dark on its own containers; measured in Chrome: under the html-only scheme a light-dark() panel stayed rgb(33,33,33) in Light, pinned it is rgb(255,255,255)');
  const APP = 'html[data-theme="dark"],html[data-theme="dark"] [data-theme="dark"]';
  const OLDER = 'html.dark:not([data-codex-window-type]),html.dark:not([data-codex-window-type]) *';
  check(mode + ': the only other rules are Ultra\'s',
    site.every((r) => r.sel === PIN || (mode === 'ultra' && (r.sel === APP || r.sel === OLDER))),
    rs.map((r) => r.sel).join(' | '));
  const appRule = rs.find((r) => r.sel === APP);
  const olderRule = rs.find((r) => r.sel === OLDER);
  const surfaces = appRule && olderRule ? { body: appRule.body + olderRule.body } : null;
  const value = (name) => { const m = surfaces && new RegExp('(?:^|;)' + name + ':([^;!]+) !important').exec(surfaces.body); return m && m[1].trim(); };
  if (mode !== 'ultra') {
    check(mode + ': every surface is ChatGPT\'s own theme', !appRule && !olderRule,
      mode === 'dark' ? 'a charcoal Dark (#212121) over ChatGPT\'s own black read as Eye Shield making the page lighter' : '');
  } else {
    check('ultra sets the signed-in app\'s tokens where it declares them, to be inherited', !!appRule && !/--main-surface/.test(appRule.body));
    check('the signed-out app\'s tokens reach every element, where it declares them again',
      !!olderRule && !/--app-color/.test(olderRule.body), 'measured: set on <html> alone, the signed-out page\'s <html> changed and its body did not');
    check('and only on the signed-out app, not on every element of a signed-in page',
      /:not\(\[data-codex-window-type\]\) \*$/.test(OLDER), 'all of it on every element cost ~10% more style recalculation on 20,000 elements');
    check('ultra takes both apps\' canvases to true black',
      ['--app-color-background-surface', '--app-color-background-surface-under', '--main-surface-primary', '--sidebar-surface-primary']
        .every((n) => value(n) === '#000000'));
    /* ChatGPT's own dark is already true black with a #1b1b1b composer; Ultra that only sank the
       composer to #111 was, on the reader's screen, indistinguishable from it. */
    check('the composer goes black and keeps a crisp outline in place of its grey fill',
      value('--app-color-background-elevated-primary-opaque') === '#000000' && /^inset 0 0 0 1px #ffffff/.test(value('--elevation-composer-dark') || ''));
    check('buttons and controls sink below ChatGPT\'s own #303030',
      parseInt(value('--app-color-background-control').slice(1, 3), 16) < 0x30);
    check('text and icons go to pure white, as Ultra\'s text does everywhere',
      value('--app-color-text-foreground') === '#ffffff' && value('--app-color-icon-primary') === '#ffffff');
    check('the accent and the message colours stay ChatGPT\'s and the reader\'s own',
      !/--app-color-(accent|background-accent|text-accent|icon-accent)|--color-background-user-message|--color-background-composer-primary/.test(surfaces.body));
  }
}
/* ChatGPT's switch. Its tokens are declared on `.dark` and `.light` scopes, so a scope inside the
   page re-darkens everything under it; the signed-in page that broke had one (reproduced on the
   real extension: html flipped to light, an inner dark scope left the page half dark). These run
   on timers because inner scopes restored or added later are collected into one rescan. */
const chatgptDone = new Promise((resolve) => {
  observers = [];
  ctx.location.hostname = 'chatgpt.com';
  ctx.__wardenOneChatGPTThemeOrig = null;
  const h = makeHtml({}, ['dark'], 'dark');
  const mainScope = makeHtml({}, ['dark', 'flex']);
  const sideScope = makeHtml({}, ['dark']);
  themeScopes = [mainScope, sideScope];
  ctx.document.documentElement = h;
  core.applyChatGPTNativeTheme('light');
  flushObservers();
  check('light switches ChatGPT to its own light theme', h.classList.contains('light') && !h.classList.contains('dark')
    && h.style.colorScheme === 'light');
  check('and every dark scope inside the page with it', [mainScope, sideScope].every((e) => e.classList.contains('light') && !e.classList.contains('dark')),
    'one left dark keeps its backgrounds dark under light text');
  check('leaving their other classes alone', JSON.stringify(mainScope.classes()) === JSON.stringify(['flex', 'light']));
  h.classList.remove('light'); h.classList.add('dark'); h.style.colorScheme = 'dark';
  const rounds = flushObservers();
  check('it holds when ChatGPT re-applies its own', h.classList.contains('light') && !h.classList.contains('dark'));
  check('without looping', rounds < 10, rounds + ' rounds');
  /* React restores a scope's class on re-render, and renders a new scope later. */
  mainScope.classList.remove('light'); mainScope.classList.add('dark');
  const late = makeHtml({}, ['dark']);
  themeScopes.push(late);
  notifyAdded(late);
  flushObservers();
  setTimeout(() => {
    check('a scope React restores is flipped again', mainScope.classList.contains('light') && !mainScope.classList.contains('dark'));
    check('and one rendered later is flipped as it appears', late.classList.contains('light') && !late.classList.contains('dark'));
    core.applyChatGPTNativeTheme('ultra');
    flushObservers();
    check('ultra uses ChatGPT\'s dark theme, scopes included', h.classList.contains('dark') && [mainScope, sideScope, late].every((e) => e.classList.contains('dark') && !e.classList.contains('light')));
    core.applyChatGPTNativeTheme('light');
    core.restoreNativeThemes();
    flushObservers();
    check('off restores exactly what the page had', JSON.stringify(h.classes()) === JSON.stringify(['dark']) && h.style.colorScheme === 'dark',
      JSON.stringify(h.classes()) + ' ' + h.style.colorScheme);
    check('scopes included', [sideScope, late].every((e) => JSON.stringify(e.classes()) === JSON.stringify(['dark']))
      && JSON.stringify(mainScope.classes()) === JSON.stringify(['flex', 'dark']), JSON.stringify(mainScope.classes()));
    check('and a page that had no data-theme is left without one', !h.hasAttribute('data-theme'));
    themeScopes = [];
    resolve();
  }, 120);
});

/* The signed-in app, as read off a signed-in page through the reader's own browser: <html
   class="chatgpt-theme" data-theme="dark">, every colour hung off data-theme. Class flip and
   pinned variables left it rgb(0,0,0) with rgb(237,237,237) text; data-theme="light" gave
   rgb(252,252,252) with rgb(13,13,13), sidebar and message box included. */
const chatgptSignedInDone = chatgptDone.then(() => new Promise((resolve) => {
  observers = [];
  ctx.location.hostname = 'chatgpt.com';
  ctx.__wardenOneChatGPTThemeOrig = null;
  const h = makeHtml({ 'data-theme': 'dark' }, ['chatgpt-theme'], '');
  const popover = makeHtml({ 'data-theme': 'dark' }, []);
  themeScopes = [popover];
  ctx.document.documentElement = h;
  core.applyChatGPTNativeTheme('light');
  flushObservers();
  check('signed in: light switches data-theme on <html>', h.getAttribute('data-theme') === 'light',
    'the class alone left the signed-in page dark');
  check('and on anything inside that carries its own', popover.getAttribute('data-theme') === 'light');
  h.setAttribute('data-theme', 'dark');
  flushObservers();
  check('it holds when ChatGPT writes its own theme back', h.getAttribute('data-theme') === 'light');
  const menu = makeHtml({ 'data-theme': 'dark' }, []);
  themeScopes.push(menu);
  notifyAdded(menu);
  flushObservers();
  setTimeout(() => {
    check('a menu rendered later with its own dark theme is switched as it appears', menu.getAttribute('data-theme') === 'light');
    core.restoreNativeThemes();
    flushObservers();
    check('off puts the signed-in page back exactly', h.getAttribute('data-theme') === 'dark'
      && JSON.stringify(h.classes()) === JSON.stringify(['chatgpt-theme']) && h.style.colorScheme === '',
      h.getAttribute('data-theme') + ' ' + JSON.stringify(h.classes()) + ' "' + h.style.colorScheme + '"');
    check('menus included', popover.getAttribute('data-theme') === 'dark' && menu.getAttribute('data-theme') === 'dark');
    themeScopes = [];
    resolve();
  }, 120);
}));

/* ---- a mode change reaches an open tab and stays ------------------------------------ */

chatgptSignedInDone.then(() => new Promise((resolve) => {
  console.log('Live mode changes');
  /* The popup pushes the new settings, then re-runs Eye Shield, which pulls them again -- and
     the pull could be answered from a snapshot taken before the change. Measured on a live
     GitHub tab: a switch to Light was still Ultra 1.2 s later; with this in place it held from
     0.3 s. Settings here are marked with a probe key so the test can tell which one won. */
  ctx.location.hostname = 'example.com';
  ctx.document.documentElement = makeHtml({});
  const listen = messageListeners[messageListeners.length - 1];
  listen({ kind: 'config-update', overrides: { eyeShieldMode: 'off', __probe: 'pushed' } });
  check('a pushed change is applied', core.getCfg().__probe === 'pushed');
  const pullAnswers = [];
  ctx.__wardenOneContentConfigRequest = (need, cb) => { pullAnswers.push(need); cb(ctx.__nextPull); };
  ctx.__nextPull = { ok: true, rev: Date.now() - 60000, overrides: { eyeShieldMode: 'off', __probe: 'stale' } };
  core.loadConfig();
  check('a snapshot built before that push does not undo it', core.getCfg().__probe === 'pushed');
  ctx.__nextPull = { ok: true, rev: Date.now() + 1000, overrides: { eyeShieldMode: 'off', __probe: 'fresh' } };
  core.loadConfig();
  check('a snapshot built after it is taken', core.getCfg().__probe === 'fresh');
  const before = pullAnswers.length;
  listen({ kind: 'content-config-refresh' });
  check('a refresh notice does not ask in the same dispatch', pullAnswers.length === before,
    'the bridge, told the same thing, has to start its own re-fetch first so this one waits for it');
  setTimeout(() => {
    check('it asks a tick later', pullAnswers.length === before + 1);
    resolve();
  }, 5);
})).then(() => {
  /* ---- a site renames its switch ------------------------------------------------------- */
  console.log('A site that renamed its switch');
  /* GitHub, ChatGPT and YouTube Music are switched to their OWN themes by names they chose.
     If one renames them, the switch silently stops working and the page stays as it was;
     Eye Shield measures the page a moment later and, on a clear miss twice over, hands the page
     to the general engine instead of leaving it unthemed. The check's timers are run by hand. */
  const realSetTimeout = ctx.setTimeout;
  const queue = [];
  ctx.setTimeout = (fn, ms) => { queue.push({ fn, ms }); return 100000 + queue.length; };
  const runCheck = () => {
    for (let round = 0; round < 6; round++) {
      const i = queue.findIndex((t) => t.ms === 1000 || t.ms === 1500 || t.ms === 2500);
      if (i < 0) return;
      const t = queue.splice(i, 1)[0];
      try { t.fn(); } catch (e) { check('the check runs without throwing', false, String(e && e.stack || e)); return; }
    }
  };
  let bg = 'rgb(0, 0, 0)';
  ctx.getComputedStyle = () => ({ backgroundColor: bg, color: 'rgb(0, 0, 0)', getPropertyValue: () => '' });
  ctx.document.body = { tagName: 'BODY', nodeType: 1 };
  ctx.innerWidth = 1200;
  ctx.innerHeight = 800;
  ctx.location.hostname = 'chatgpt.com';
  ctx.document.documentElement = makeHtml({}, ['dark'], 'dark');
  const cfg = core.getCfg();
  cfg.enabled = true;
  cfg.eyeShieldMode = 'light';

  bg = 'rgb(252, 252, 252)';
  core.scheduleNativeThemeCheck('light');
  runCheck();
  check('a site that switched to the requested mode keeps its own theme', !core.nativeFallback() && core.managedThemeHostName() === 'chatgpt');
  check('the verdict reads light as light and black as dark',
    core.nativeThemeVerdict('light') === 'ok' && (bg = 'rgb(0, 0, 0)', core.nativeThemeVerdict('dark') === 'ok' && core.nativeThemeVerdict('light') === 'failed'));
  bg = 'rgb(150, 150, 150)';
  check('an in-between page is not called a miss', core.nativeThemeVerdict('light') === 'unknown' && core.nativeThemeVerdict('ultra') === 'unknown');
  bg = 'rgba(0, 0, 0, 0)';
  check('nor is a page that paints no background of its own', core.nativeThemeVerdict('light') === 'unknown');

  /* One miss (a slow page) that then comes right is not a fallback. */
  bg = 'rgb(0, 0, 0)';
  core.scheduleNativeThemeCheck('light');
  const first = queue.findIndex((t) => t.ms === 1500);
  queue.splice(first, 1)[0].fn();
  bg = 'rgb(252, 252, 252)';
  runCheck();
  check('a page that misses once and then switches keeps its own theme', !core.nativeFallback());

  /* The user changed mode in between: the old check stands down. */
  bg = 'rgb(0, 0, 0)';
  core.scheduleNativeThemeCheck('light');
  cfg.eyeShieldMode = 'dark';
  runCheck();
  check('a check for a mode no longer chosen does nothing', !core.nativeFallback());
  cfg.eyeShieldMode = 'light';

  /* The switch has stopped working: the page stays dark under Light, twice. */
  bg = 'rgb(0, 0, 0)';
  core.scheduleNativeThemeCheck('light');
  runCheck();
  check('a clear miss, twice, hands the page to the general engine', core.nativeFallback() === true && core.managedThemeHostName() === '');
  check('and ChatGPT\'s own profile no longer applies to it', core.themeFooter('light').indexOf(':root,:root *{--lightningcss-light') < 0);
  check('the check is scheduled from every apply', /applyNativeTheme\(mode\);\s*\n\s*scheduleNativeThemeCheck\(mode\);/.test(CORE));
  check('and never judges GitHub while a theme stylesheet is still loading',
    /host === 'github' && githubLoading/.test(CORE) && /githubLoading = true;/.test(CORE));
  ctx.setTimeout = realSetTimeout;
}).then(() => {
  /* Every timer-driven check has run: let go of the core's pending timers (the stylesheet-load
     timeouts) so the run ends now. */
  try { ctx.__wardenOneEyeShieldDispose(); } catch (_) {}
  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('all Eye Shield native site theme checks passed');
});
check('the popup refreshes a tab with the per-site themes too, top frame, before the core',
  /files: \['eyeshield-sites\.js'\][\s\S]{0,400}files: \['eyeshield\.js'\]/.test(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'))
    && /target: \{ tabId: tab\.id, frameIds: \[0\] \}, files: \['eyeshield-sites\.js'\]/.test(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8')),
  'a tab opened before theming was on had the core but no GitHub or YouTube Music profile');
check('a missing per-site file is not remembered as missing',
  /function eyeSites\(\) \{\s*if \(__eyeSitesResolved\) return __eyeSites;\s*try \{ if \(!\(globalThis\.__woEyeSites && typeof globalThis\.__woEyeSites\.factory === 'function'\)\) return null;/.test(CORE));
check('and a profiled page themed without it is rebuilt once it arrives',
  /themeBuiltWithoutSites = isManagedThemeHost\(\) && !eyeSites\(\);/.test(CORE)
    && /\|\| \(themeBuiltWithoutSites && eyeSites\(\)\)\) \{/.test(CORE));

check('the version records the changes',
  ['yt-player-keeps-own-pills', 'ytmusic-own-profile', 'github-native-theme', 'chatgpt-keeps-own-buttons',
    'github-loads-theme-sheet', 'chatgpt-native-theme', 'ytmusic-native-light', 'chatgpt-flips-every-scope', 'chatgpt-pins-color-scheme', 'chatgpt-data-theme',
    'chatgpt-dark-surfaces', 'native-theme-fallback']
    .every((m) => CORE.indexOf(m) >= 0));


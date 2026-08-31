/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Full-screen consent walls.
 *
 * Every case below came out of a 101-site live sweep, and most of them are here because
 * the obvious implementation got them wrong first:
 *
 *  - Matching on "covers the viewport" ate a site's own hero carousel. The z-index floor
 *    is what separates a consent sheet from full-bleed page furniture, so a carousel at
 *    z-index auto has to survive.
 *  - Releasing the scroll lock unconditionally unlocked etsy.com, which runs no consent
 *    manager at all, by stripping the site's own wt-html-no-scroll. The release has to be
 *    a consequence of a removal, never an independent step.
 *  - The lock is normally a CLASS on <html>, so clearing an inline overflow does nothing.
 *  - On some sites the article was never sent, and lifting the wall hands someone a blank
 *    page. The wall has to go back.
 *  - Six real walls carried no id or class worth matching, so identity is read from the
 *    whole element -- and an element that is still anonymous is only accepted when a
 *    consent manager is demonstrably running on the page.
 *
 * Run: node tools/test-consent-wall.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { installPlatformGlobals } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'consent-wall.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const ANTI_REDIRECT = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');

const VIEWPORT = { width: 1280, height: 900 };

let failures = 0;
function check(label, condition) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label);
}

/* ---- a DOM just real enough ------------------------------------------------------- */

function makeEl(spec, world) {
  const o = spec || {};
  const el = {
    nodeType: 1,
    tagName: String(o.tag || 'div').toUpperCase(),
    id: o.id || '',
    className: o.cls || '',
    isConnected: true,
    parentNode: null,
    parentElement: null,
    nextSibling: null,
    innerText: o.text || '',
    _attrs: Object.assign({}, o.attrs),
    _z: o.z === undefined ? 'auto' : String(o.z),
    _pos: o.pos || 'static',
    _rect: o.rect || { width: VIEWPORT.width, height: VIEWPORT.height },
    _links: o.links || 0,
    _headings: o.headings || 0,
    _children: [],
    style: makeStyle(),
  };
  el.classList = makeClassList(el);
  el.getAttribute = (name) => (name in el._attrs ? el._attrs[name] : null);
  el.getBoundingClientRect = () => el._rect;
  el.querySelectorAll = (sel) => {
    if (/a\[href\]/.test(sel)) return { length: el._links };
    if (/h1,h2,h3/.test(sel)) return { length: el._headings };
    return { length: 0 };
  };
  el.remove = () => {
    el.isConnected = false;
    world.removed.push(el);
    const list = world.stack;
    const i = list.indexOf(el);
    if (i >= 0) list.splice(i, 1);
    // A site that re-renders its wall does so before anyone can observe it gone.
    if (typeof world.afterRemove === 'function') world.afterRemove(el);
    if (typeof world.mutate === 'function') world.mutate();
  };
  return el;
}

function makeStyle() {
  const props = new Map();
  const priorities = new Map();
  return {
    getPropertyValue: (p) => props.get(p) || '',
    getPropertyPriority: (p) => priorities.get(p) || '',
    setProperty: (p, v, prio) => { props.set(p, v); priorities.set(p, prio || ''); },
    removeProperty: (p) => { props.delete(p); priorities.delete(p); },
    _props: props,
  };
}

function makeClassList(el) {
  const set = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
  const sync = () => { el.className = Array.from(set).join(' '); };
  return {
    add: (c) => { set.add(c); sync(); },
    remove: (c) => { set.delete(c); sync(); },
    contains: (c) => set.has(c),
    [Symbol.iterator]: () => set[Symbol.iterator](),
  };
}

/*
 * scenario:
 *   host             page hostname
 *   stack            elements returned by elementsFromPoint, topmost first
 *   htmlClasses      classes on <html>
 *   bodyClasses      classes on <body>
 *   bodyInline       inline style on <body> ({position, overflow, top})
 *   lockedBy         'class' | 'inline' | 'sheet' | null -- what actually holds the scroll
 *   cmpGlobal        a window global a consent manager would set
 *   cmpSelector      true if a known CMP container is in the document
 *   contentAfter     { scrollHeight, text } once the wall is gone
 *   config           overrides for wardenone_config
 */
function run(scenario) {
  const s = scenario || {};
  const world = { removed: [], stack: [], messages: [], observers: [], mutations: 0 };
  // Anything that changes the DOM tells the connected observers, exactly as a browser
  // would -- including the changes the script makes itself.
  world.mutate = () => {
    world.mutations++;
    if (world.mutations > 400) return; // a runaway loop should fail the test, not hang it
    for (const o of world.observers) {
      if (o._on && typeof o._cb === 'function') { try { o._cb([], o); } catch (_) {} }
    }
  };

  const html = makeEl({ tag: 'html', cls: (s.htmlClasses || []).join(' ') }, world);
  const body = makeEl({ tag: 'body', cls: (s.bodyClasses || []).join(' ') }, world);
  body.parentNode = html;
  body.parentElement = html;
  for (const [prop, value] of Object.entries(s.bodyInline || {})) body.style.setProperty(prop, value);

  if (s.readdAfterRemoval) {
    let readds = 0;
    world.afterRemove = (el) => {
      if (readds >= 1) return;
      readds++;
      el.isConnected = true;
      world.stack.unshift(el);
    };
  }
  world.stack = (s.stack || []).map((spec) => {
    const el = makeEl(spec, world);
    el.parentNode = body;
    el.parentElement = body;
    return el;
  });
  // Reinsertion has to find its way home, so body has to accept a child back.
  body.insertBefore = (node) => { node.isConnected = true; world.stack.unshift(node); body._children.push(node); world.mutate(); };
  body.appendChild = (node) => { node.isConnected = true; world.stack.unshift(node); body._children.push(node); world.mutate(); };

  const wallGone = () => world.stack.length === 0;

  // The page scrolls unless something is holding it. Which "something" depends on the
  // scenario, because that is exactly what the tiered release has to work through.
  const LOCK_CLASSES = /^(?:sp-message-open|didomi-popup-open|modal-open|no-?scroll|noscroll|wt-html-no-scroll|wt-body-no-scroll|scroll-?lock|overflow-?hidden)$/i;
  function stillLocked() {
    if (!s.lockedBy) return false;
    if (s.lockedBy === 'class') {
      for (const el of [html, body]) {
        for (const c of Array.from(el.classList)) if (LOCK_CLASSES.test(c)) return true;
      }
      return false;
    }
    if (s.lockedBy === 'inline') {
      return !!(body.style.getPropertyValue('position') === 'fixed'
        || body.style.getPropertyValue('overflow') === 'hidden');
    }
    // 'sheet': a stylesheet rule nothing can edit. Only an !important override outranks it.
    return body.style.getPropertyPriority('position') !== 'important';
  }

  let scrollY = 0;
  const timers = [];
  let now = 0;

  const context = {
    window: null,
    document: null,
    location: { hostname: s.host || 'example.invalid', href: 'https://' + (s.host || 'example.invalid') + '/' },
    innerWidth: VIEWPORT.width,
    innerHeight: VIEWPORT.height,
    get scrollY() { return scrollY; },
    scrollTo(_x, y) { scrollY = stillLocked() ? 0 : y; },
    getComputedStyle(el) {
      if (el === body) {
        return {
          position: body.style.getPropertyValue('position') || 'static',
          top: body.style.getPropertyValue('top') || 'auto',
          overflow: body.style.getPropertyValue('overflow') || 'visible',
          overflowY: 'visible',
          display: 'block', visibility: 'visible', opacity: '1', zIndex: 'auto',
        };
      }
      return {
        position: el._pos, zIndex: el._z,
        display: el._display || 'block', visibility: 'visible', opacity: '1',
        top: 'auto', overflow: 'visible', overflowY: 'visible',
      };
    },
    /* A live observer, because the bug this suite now covers IS the observer.
       An inert stub cannot see a removal wake the scanner that caused it, which is
       the loop that made pages flicker, so with a stub the regression test passes
       whether or not the fix is present. */
    MutationObserver: class {
      constructor(cb) { this._cb = cb; this._on = false; world.observers.push(this); }
      observe() { this._on = true; }
      disconnect() { this._on = false; }
    },
    chrome: {
      storage: {
        local: {
          get(_key, done) {
            done({ wardenone_config: Object.assign({ enabled: true, removeConsentWalls: true }, s.config || {}) });
          },
        },
        onChanged: { addListener() {} },
      },
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage(m, done) {
          if (m && m.kind === 'content-config-get' && typeof done === 'function') {
            done({ ok: true, overrides: Object.assign({ enabled: true, removeConsentWalls: true }, s.config || {}) });
            return;
          }
          world.messages.push(m);
        },
      },
    },
    setTimeout(fn, delay) { const id = timers.length + 1; timers.push({ id, fn, at: now + (delay || 0) }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval() { return 0; },
    clearInterval() {},
    console,
    Date, Set, WeakSet, Map, Array, Object, String, Number, RegExp, JSON, Math, parseInt, isNaN,
  };
  context.window = context;
  context.self = context;
  // The script runs top-frame only and checks window.top === window before anything else.
  // Without this every scenario silently returns on line one and every assertion about
  // "did not touch the page" passes for the wrong reason.
  context.top = context;

  const doc = {
    documentElement: html,
    body,
    readyState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    elementsFromPoint: () => world.stack.slice(),
    querySelector: (sel) => (s.cmpSelector && /sp_message_container|didomi|onetrust|Cybot|iubenda|usercentrics|qc-cmp|fc-consent|appconsent|ketch|cmpbox|cookiescript/i.test(sel) ? html : null),
    querySelectorAll: () => [],
    get scrollHeight() { return html.scrollHeight; },
  };
  Object.defineProperty(html, 'scrollHeight', {
    get() {
      if (!wallGone()) return VIEWPORT.height;
      const after = s.contentAfter || {};
      return after.scrollHeight === undefined ? VIEWPORT.height * 20 : after.scrollHeight;
    },
  });
  Object.defineProperty(body, 'innerText', {
    get() {
      if (!wallGone()) return 'wall';
      const after = s.contentAfter || {};
      return after.text === undefined ? 'x'.repeat(50000) : after.text;
    },
    set() {},
  });
  context.document = doc;
  if (s.cmpGlobal) context[s.cmpGlobal] = {};

  installPlatformGlobals(context);
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'consent-wall.js' });

  // Drain the clock. The script schedules scans at 0/400/1200/2600 and a verification pass
  // 400ms after a removal, so the whole sequence has to be able to play out.
  for (let guard = 0; guard < 500 && timers.length; guard++) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers.shift();
    now = Math.max(now, t.at);
    try { t.fn(); } catch (err) { console.log('  (timer threw) ' + err.message); }
  }

  return {
    // Every removal EVENT, including a node taken out, put back, and taken out again.
    // removedCount below counts nodes currently out, which is what most checks want and
    // is exactly blind to the thrash this number exists to catch.
    removalEvents: world.removed.length,
    mutations: world.mutations,
    removedCount: world.removed.filter((el) => !el.isConnected).length,
    wallGone: wallGone(),
    htmlClasses: Array.from(html.classList),
    bodyClasses: Array.from(body.classList),
    bodyStyle: body.style,
    locked: stillLocked(),
    scrollY,
    messages: world.messages,
  };
}

const WALL = {
  tag: 'div', id: 'sp_message_container_1426772', z: 2147483647, pos: 'fixed',
  rect: { width: VIEWPORT.width, height: VIEWPORT.height }, text: 'We value your privacy',
};
const CAROUSEL = {
  tag: 'div', cls: 'absolute flex h-full w-full', z: 'auto', pos: 'absolute',
  rect: { width: VIEWPORT.width, height: VIEWPORT.height }, text: 'Top stories',
};

console.log('\nfull-screen consent walls\n');

/* ---- 1. the discriminator --------------------------------------------------------- */

{
  const r = run({ host: 'spiegel.invalid', stack: [WALL], cmpGlobal: '_sp_' });
  check('removes a full-viewport sheet at the top of the stacking context', r.wallGone);
  check('reports the removal', r.messages.some((m) => /consent wall/.test(m.detail.matched)));
  check('says plainly that nothing was consented to',
    r.messages.some((m) => /without consenting/.test(m.detail.why)));
}
{
  const r = run({ host: 'spiegel.invalid', stack: [CAROUSEL], cmpGlobal: '_sp_' });
  check("leaves a site's own full-bleed carousel alone (z-index auto)", !r.wallGone && r.removedCount === 0);
}
{
  const low = Object.assign({}, WALL, { z: 9999 });
  const r = run({ host: 'x.invalid', stack: [low], cmpGlobal: '_sp_' });
  check('leaves a full-viewport element below the z-index floor alone', !r.wallGone);
}
{
  const small = Object.assign({}, WALL, { rect: { width: VIEWPORT.width, height: 120 } });
  const r = run({ host: 'x.invalid', stack: [small], cmpGlobal: '_sp_' });
  check('leaves a bottom cookie bar to auto-reject (not full height)', !r.wallGone);
}
{
  const content = Object.assign({}, WALL, { id: '', cls: 'app-root', links: 60, headings: 20 });
  const r = run({ host: 'x.invalid', stack: [content], cmpGlobal: '_sp_' });
  check("never removes an element holding a front page's worth of links and headings", !r.wallGone);
}

/* ---- 2. never act without a match (the etsy failure) ------------------------------ */

{
  const r = run({
    host: 'etsy.invalid',
    stack: [],                       // no wall anywhere
    htmlClasses: ['wt-html-no-scroll'],
    bodyClasses: ['wt-body-no-scroll'],
    bodyInline: { position: 'fixed', overflow: 'hidden' },
    lockedBy: 'class',
  });
  check("leaves a site's own scroll lock alone when there is no wall (etsy)",
    r.htmlClasses.includes('wt-html-no-scroll') && r.bodyClasses.includes('wt-body-no-scroll'));
  check('leaves the page locked exactly as the site left it', r.locked);
  check('stays silent when it did nothing', r.messages.length === 0);
}
{
  const r = run({
    host: 'shop.invalid',
    stack: [CAROUSEL],               // present, but not a wall
    htmlClasses: ['modal-open'],
    lockedBy: 'class',
  });
  check('a non-matching overlay does not trigger the lock release',
    r.htmlClasses.includes('modal-open') && r.locked);
}

/* ---- 3. the lock is a class on <html> --------------------------------------------- */

{
  const r = run({
    host: 'bild.invalid', stack: [WALL], cmpGlobal: '_sp_',
    htmlClasses: ['sp-message-open'], lockedBy: 'class',
  });
  check('removes the lock class the manager put on <html>', !r.htmlClasses.includes('sp-message-open'));
  check('page scrolls again after the class comes off', !r.locked);
}
{
  const r = run({
    host: 'inline.invalid', stack: [WALL], cmpGlobal: '_sp_',
    bodyInline: { position: 'fixed', overflow: 'hidden', top: '-2400px' },
    lockedBy: 'inline',
  });
  check('clears an inline lock when there is no class to remove', !r.locked);
  check('puts the reader back where they were parked', r.scrollY === 2400);
}
{
  const r = run({
    host: 'futura.invalid', stack: [WALL], cmpGlobal: '__tcfapi',
    lockedBy: 'sheet',
  });
  check('outranks a stylesheet lock with !important when nothing else works',
    r.bodyStyle.getPropertyPriority('position') === 'important' && !r.locked);
}

/* ---- 4. nothing behind the wall (derstandard / golem) ----------------------------- */

{
  const r = run({
    host: 'derstandard.invalid', stack: [WALL], cmpGlobal: '_sp_',
    htmlClasses: ['sp-message-open'], lockedBy: 'class',
    contentAfter: { scrollHeight: 1046, text: '© STANDARD Verlagsgesellschaft m.b.H. 2026' },
  });
  check('puts the wall back when the article was never sent', !r.wallGone);
  check('restores the lock class it removed', r.htmlClasses.includes('sp-message-open'));
  check('says so rather than failing quietly',
    r.messages.some((m) => /nothing behind it/.test(m.detail.why)));
}
{
  // vg.no: 1,819 characters of short headlines and a completely healthy front page. Text
  // length alone would condemn it; scroll height is what saves it.
  const r = run({
    host: 'vg.invalid', stack: [WALL], cmpGlobal: '_sp_',
    htmlClasses: ['sp-message-open'], lockedBy: 'class',
    contentAfter: { scrollHeight: 86620, text: 'x'.repeat(1819) },
  });
  check('keeps a short-but-real front page open (does not judge on text length)', r.wallGone);
}

/* ---- the flicker ------------------------------------------------------------------ */

/* Reported as a page that "faded but was flickering many times a second, and it was
   horrid", and it was our own loop rather than the site's.
 *
 * Removing the wall is a mutation. Putting it back is a mutation. The observer could not
 * tell either of them from the site drawing a fresh wall, so on a page that was empty
 * behind its wall the sequence was: remove, wait 400ms, measure, restore, observe our own
 * restore, scan, find the wall we had just put back, remove it again. Nothing stopped
 * that except the pass cap, so the page strobed three times and then settled -- and the
 * reader saw every frame of it. */
{
  const r = run({
    host: 'derstandard.invalid', stack: [WALL], cmpGlobal: '_sp_',
    htmlClasses: ['sp-message-open'], lockedBy: 'class',
    contentAfter: { scrollHeight: 1046, text: '© STANDARD Verlagsgesellschaft m.b.H. 2026' },
  });
  check('an empty page has its wall taken out exactly once, not once per pass',
    r.removalEvents === 1, r.removalEvents + ' removals — each one is a visible flash');
  check('and the wall is still there at the end', !r.wallGone);
  /* The count that matters for a strobe is how much churn we caused, not whether we
     eventually stopped. The cap always made it stop. */
  check('the page is not churned while we decide', r.mutations <= 4,
    r.mutations + ' DOM mutations from a single wall');
}

/* The other half: a site that puts its own wall back. That is a site telling us it
   intends to keep it, and a second removal starts a fight that renders as a strobe --
   we remove, the framework re-renders, we remove again. One attempt, then leave it. */
{
  const r = run({
    host: 'fighty.invalid', stack: [WALL], cmpGlobal: '_sp_',
    contentAfter: { scrollHeight: 86620, text: 'x'.repeat(4000) },
    readdAfterRemoval: true,
  });
  check('a wall the site puts back is not removed a second time',
    r.removalEvents === 1, r.removalEvents + ' removals — we are fighting the page');
}

/* ---- 5. identity is often not in id or class -------------------------------------- */

{
  const iframe = {
    tag: 'iframe', z: 2147483647, pos: 'fixed',
    rect: { width: VIEWPORT.width, height: VIEWPORT.height },
    attrs: { title: 'Consent window' },
  };
  const r = run({ host: 'lefigaro.invalid', stack: [iframe] });
  check('reads an iframe title when there is no id or class', r.wallGone);
}
{
  const obfuscated = {
    tag: 'div', cls: 'o6ugt3n', z: 2147483307, pos: 'fixed',
    rect: { width: VIEWPORT.width, height: VIEWPORT.height },
    text: 'Cenimy Twoją prywatność. Kliknij AKCEPTUJĘ',
  };
  const r = run({ host: 'wp.invalid', stack: [obfuscated] });
  check('reads the wall\'s own words under an obfuscated class name', r.wallGone);
}
{
  const anonymous = {
    tag: 'iframe', z: 2147483647, pos: 'fixed',
    rect: { width: VIEWPORT.width, height: VIEWPORT.height },
  };
  const withCmp = run({ host: 'as.invalid', stack: [anonymous], cmpGlobal: 'Didomi' });
  check('accepts a nameless cross-origin sheet when a consent manager is running', withCmp.wallGone);
  const withoutCmp = run({ host: 'unknown.invalid', stack: [anonymous] });
  check('leaves a nameless sheet alone when nothing proves a manager is there', !withoutCmp.wallGone);
}

/* ---- 5b. the identifiers real managers actually ship ------------------------------ */

/* Every string below was read off a live page during the sweep. They are here because the
   first version matched almost none of them: \b sits between a word character and a
   non-word one, and these vendors join their words with underscores, so \bsp_message\b
   never matched sp_message_container_1426772 -- the most common container in the sample.
   Verified against spiegel.de in a browser, which is how the miss was found at all. */
const REAL_CONTAINERS = [
  ['sp_message_container_1426772 bg-shade-lightest dark:bg-black', 'Sourcepoint'],
  ['CybotCookiebotDialogBodyUnderlay', 'Cookiebot'],
  ['CookieConsent__root', 'SVT own-build'],
  ['qc-cmp-cleanslate css-13ij2t5', 'Quantcast'],
  ['didomi-popup didomi-popup-backdrop didomi-notice-popup', 'Didomi'],
  ['onetrust-pc-dark-filter ot-fade-in', 'OneTrust'],
  ['iubenda-cs-banner iubenda-cs-black', 'iubenda'],
  ['ketch-fixed ketch-z-ketch-max-z-index ketch-top-0', 'Ketch'],
  ['fc-consent-root', 'Google Funding Choices'],
  ['privacy-cp-wall', 'Corriere own-build'],
  ['gdpr-lmd-standard gdpr-lmd-wall', 'Le Monde own-build'],
  ['appconsent', 'Le Figaro parent id'],
];
for (const [blob, vendor] of REAL_CONTAINERS) {
  const el = { tag: 'div', cls: blob, z: 2147483647, pos: 'fixed', rect: { width: VIEWPORT.width, height: VIEWPORT.height } };
  const r = run({ host: 'real.invalid', stack: [el] });   // no CMP global: identity alone must carry it
  check('recognises ' + vendor + ' by its container name alone', r.wallGone);
}
{
  // The generic half keeps its boundaries, so an ordinary layout class is not a consent
  // manager just because it contains those letters. 'sketchbook' is here because the Ketch
  // identifier is matched as a substring and would otherwise catch it -- which is why that
  // one entry is 'ketch-' and not 'ketch'.
  for (const innocent of ['app-shell hero-full', 'lightbox-backdrop', 'sketchbook-frame', 'overlay-root']) {
    const el = { tag: 'div', cls: innocent, z: 2147483647, pos: 'fixed', rect: { width: VIEWPORT.width, height: VIEWPORT.height } };
    const r = run({ host: 'innocent.invalid', stack: [el] });
    check('"' + innocent + '" is not treated as a consent manager', !r.wallGone);
  }
  /* A class containing the literal word "cookies" DOES match, and that is deliberate rather
     than an oversight. A recipe site's cookie list is not reachable from here: nothing is
     tested for identity until it already covers 98% of the viewport at a z-index of 100000
     or more, and page furniture does not do that -- across 85 measured sites the geometry
     gate matched no ordinary content at all. Narrowing the word here would cost real
     detections (svt.se ships CookieConsent__root and nothing else) to guard against a
     combination that does not occur. The wall also goes straight back if the page turns
     out to be empty behind it, which is the real backstop. */
  const foodish = { tag: 'div', cls: 'recipe-cookies-list-header', z: 2147483647, pos: 'fixed', rect: { width: VIEWPORT.width, height: VIEWPORT.height } };
  check('a full-viewport max-z element named "cookies" is still treated as a wall (documented trade-off)',
    run({ host: 'food.invalid', stack: [foodish] }).wallGone);
  const normalFurniture = Object.assign({}, foodish, { z: 'auto', pos: 'absolute' });
  check('...but the same class as ordinary page furniture is untouched',
    !run({ host: 'food.invalid', stack: [normalFurniture] }).wallGone);
}

/* ---- 6. off where it must be off --------------------------------------------------- */

for (const host of ['accounts.google.com', 'checkout.stripe.com', 'challenges.cloudflare.com', 'login.live.com']) {
  const r = run({ host, stack: [WALL], cmpGlobal: '_sp_', htmlClasses: ['modal-open'], lockedBy: 'class' });
  check('never runs on ' + host, !r.wallGone && r.htmlClasses.includes('modal-open'));
}
{
  const r = run({ host: 'spiegel.invalid', stack: [WALL], cmpGlobal: '_sp_', config: { removeConsentWalls: false } });
  check('does nothing while the toggle is off', !r.wallGone);
}
{
  const r = run({ host: 'spiegel.invalid', stack: [WALL], cmpGlobal: '_sp_', config: { enabled: false } });
  check('does nothing while WardenOne itself is off', !r.wallGone);
}
{
  const r = run({
    host: 'spiegel.invalid', stack: [WALL], cmpGlobal: '_sp_',
    config: { allowlist: ['spiegel.invalid'] },
  });
  check('respects the site allowlist', !r.wallGone);
}

/* ---- 7. wiring -------------------------------------------------------------------- */

check('ships off by default in background defaults', /removeConsentWalls:\s*false/.test(BACKGROUND));
check('ships off by default in popup defaults', /removeConsentWalls:\s*false/.test(POPUP_JS));
check('the popup knows the key', /'removeConsentWalls'/.test(POPUP_JS));
check('the popup has a toggle for it', /data-key="removeConsentWalls"/.test(POPUP_HTML));
check('registered only while on', /CONSENT_WALL_SCRIPT_ID/.test(BACKGROUND)
  && /reconcileConsentWallInjection/.test(BACKGROUND));
check('reuses the sign-in and payment exclusions', /excludeMatches: CONSENT_REJECT_EXCLUDE_MATCHES,\n\s+js: \['consent-wall\.js'\]/.test(BACKGROUND));
check('Repair reinstalls it and can evict a stale copy',
  /consent-wall\.js', world: 'ISOLATED', flag: '__wardenOneConsentWallReadyVersion'/.test(BACKGROUND));
check('packaged as a core file', /'consent-wall\.js'/.test(BACKGROUND.split('CORE_FILES')[1] || ''));

// Nothing is clicked, and no consent is stored. That is the whole claim the copy makes.
check('never clicks anything', !/\.click\s*\(/.test(SOURCE));
check('never writes a cookie', !/document\.cookie/.test(SOURCE));
check('never submits a form', !/\.submit\s*\(/.test(SOURCE));

/* ---- 8. the popup copy is honest about the limits --------------------------------- */

const descOf = (name) => (POPUP_HTML.split(name + '</div><div class="desc">')[1] || '').split('</div>')[0];
const desc = descOf('Lift full-screen cookie walls');
check('the description exists', desc.length > 80);
check('says nothing is consented to', /nothing is consented to/i.test(desc));
check('admits the page can be empty behind the wall, and that it goes back',
  /empty behind it/i.test(desc) && /goes back/i.test(desc));
check('admits some walls live on a domain it cannot reach',
  /separate domain|different domain|another domain/i.test(desc) && /nothing can reach/i.test(desc));
check('marks itself opt-in', /Opt-in/.test(desc));
/* It reads in a popup panel about 230px wide, so an honest description still has to be a
   description and not an essay. The first draft ran to 774 characters -- longer than anything
   else in the popup by 60% -- and read as an autobiography. Every claim above still has to be
   in it; this only stops them being made at length. */
check('says all that without turning into an essay', desc.length <= 320,
  desc.length + ' chars');

/* The three cookie-banner settings only make sense as a set: one for a banner that offers a
   refuse, one for a banner that offers none, one for when you accept it yourself. They used
   to sit in two different sections with nothing saying how they related, which is exactly
   how someone ends up asking what the second one is even for.

   The relationship is carried by the descriptions themselves rather than by a heading over
   them. A standalone explainer line was tried and removed: the popup uses .note once, as the
   footer, and a second one in the middle of a settings list read as belonging to a different
   product. Every other setting here is a name and a description, so these are too. */
const groupStart = POPUP_HTML.indexOf('data-key="autoRejectConsent"');
const groupEnd = POPUP_HTML.indexOf('data-key="clearCookiesOnLeave"');
check('the three cookie-banner settings sit together',
  groupStart > 0 && groupEnd > groupStart
  && POPUP_HTML.slice(groupStart, groupEnd).includes('data-key="removeConsentWalls"'));
check('nothing but rows between them — no explainer block that matches nothing else',
  !/class="note"/.test(POPUP_HTML.slice(groupStart, groupEnd)));
check('each one names the case it handles, so the set explains itself',
  /^When the banner offers a way to say no/.test(descOf('Auto-reject cookie banners'))
  && /^When it offers none/.test(desc)
  && /^When you accept one yourself/.test(descOf("Clear a site's cookies after accepting")));

/* ---- 9. the confirm-bait lock release, fixed alongside ----------------------------- */

check('confirm-bait release no longer only clears an inline overflow',
  !/if \(el && \/hidden\/i\.test\(el\.style\.overflow \|\| ''\)\) el\.style\.overflow = '';/.test(ANTI_REDIRECT));
check('confirm-bait release removes lock classes', /BAIT_LOCK_CLASS_RE/.test(ANTI_REDIRECT));
check('confirm-bait release tests the scroll rather than trusting scrollHeight',
  /function baitPageStuck/.test(ANTI_REDIRECT) && /window\.scrollTo\(0, 700\)/.test(ANTI_REDIRECT));
check('confirm-bait release restores the parked offset', /parked/.test(ANTI_REDIRECT));
check('confirm-bait release only runs after something was removed',
  /overlay\.remove\(\); \} catch \(_\) \{\}\n\s+releaseBaitLock\(\);/.test(ANTI_REDIRECT));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all consent-wall checks passed');

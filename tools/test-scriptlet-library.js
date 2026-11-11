/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The compiler drops any +js() rule whose name it cannot map, so the alias table in background.js
   and the library in the content script have to agree exactly. Also exercises what the newly
   mapped scriptlets actually do.
   Run: node tools/test-scriptlet-library.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { h, makeDocument } = require('./lib/mini-dom.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const RUNTIME = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

// ---------------------------------------------------------------------------
// The alias table and the storage-mutator set, read out of background.js.
// ---------------------------------------------------------------------------
function liftBlock(source, opener) {
  const at = source.indexOf(opener);
  if (at < 0) throw new Error('cannot find ' + opener);
  const from = source.indexOf('{', at);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(from, i + 1); }
  }
  throw new Error('cannot brace-match ' + opener);
}

const ALIASES = vm.runInNewContext('(' + liftBlock(BG, 'const SCRIPTLET_ALIASES = ') + ')');
const MUTATORS = new Set(vm.runInNewContext(
  'new Set(' + (BG.match(/const SCRIPTLET_STORAGE_MUTATORS = new Set\((\[[^\]]*\])\)/) || [])[1] + ')'));

const canonical = new Set(Object.values(ALIASES));
check('the alias table was read', canonical.size > 20, canonical.size + ' canonical names');
check('the storage-mutator set was read', MUTATORS.size >= 3, [...MUTATORS].join(','));

// ---------------------------------------------------------------------------
// The library, sliced out of the shipped runtime.
// ---------------------------------------------------------------------------
const start = RUNTIME.indexOf('scSearchToRe=s=>{');
const end = RUNTIME.indexOf('runScriptlets=list=>{', start);
check('the scriptlet block is where the slice expects it', start > 0 && end > start);
if (start < 0 || end < start) process.exit(1);
const BLOCK = 'const ' + RUNTIME.slice(start, end) + '__end=0;';

function makeLibrary(opts) {
  const o = opts || {};
  const document = o.document || makeDocument('https://example.test/', []);
  const logged = [];
  const sweepers = [];
  const timers = { setTimeout: [], setInterval: [] };
  const win = {
    setTimeout(fn, t) { timers.setTimeout.push(t); return 1; },
    setInterval(fn, t) { timers.setInterval.push(t); return 2; },
    eval(code) { return 'REAL:' + code; },
    getComputedStyle: (el) => ({ getPropertyValue: (p) => (o.computed && o.computed[p]) || '', display: 'none' }),
  };
  const sandbox = {
    String, Number, Boolean, Array, Object, Set, Map, WeakSet, RegExp, Math, URL, Error,
    ReferenceError, Proxy, Promise, JSON, isFinite, parseInt, console, atob,
    document,
    location: o.location || { hostname: 'example.test', pathname: '/', href: 'https://example.test/' },
    NodeFilter: { SHOW_TEXT: 4 },
    Response: function () {},
    addEventListener(type) { logged.push('listen:' + type); },
    log: (name, detail) => logged.push(name + ':' + JSON.stringify(detail || {})),
    scriptletPlayerPage: () => false,
    pageMutationScriptletRuntimeOn: () => true,
    networkScriptletRuntimeOn: () => true,
    __woObserver: () => ({ observe() {} }),
    WO: { enabled: true, adShield: true, scriptletEngine: true },
  };
  sandbox.window = win;
  win.window = win;
  Object.setPrototypeOf(win, sandbox);
  /* The sweepers fire on mutation in the browser; here the test pumps them. */
  sandbox.__pump = () => { for (const fn of sweepers) fn(); };
  vm.createContext(sandbox);
  vm.runInContext(BLOCK + 'this.__api={SCRIPTLET_LIB,scSearchToRe};'
    + 'this.__sweepers=scSweepers;', sandbox, { filename: 'content.min.js:scriptlets' });
  return { lib: sandbox.__api.SCRIPTLET_LIB, document, logged, timers, win, sandbox,
    pump: () => { for (const fn of sandbox.__sweepers) fn(); } };
}

const { lib } = makeLibrary();
const implemented = new Set(Object.keys(lib));
check('the library was read', implemented.size > 20, implemented.size + ' entries');

// ---------------------------------------------------------------------------
// Sync. A name on one side and not the other is a silently dropped rule.
// ---------------------------------------------------------------------------
for (const name of canonical) {
  check('alias target "' + name + '" is implemented in the content script', implemented.has(name));
}
for (const name of implemented) {
  check('library entry "' + name + '" is reachable from the alias table', canonical.has(name),
    'no +js() name maps to it, so the compiler can never serve it');
}
for (const name of MUTATORS) {
  check('storage mutator "' + name + '" is implemented as a refusal', implemented.has(name));
}

// ---------------------------------------------------------------------------
// Names the public lists actually use must resolve.
// ---------------------------------------------------------------------------
for (const name of ['rmnt', 'rpnt', 'aost', 'nano-sib', 'nano-stb',
  'cookie-remover', 'href-sanitizer', 'popads.net', 'nobab', 'nofab', 'set-attr', 'spoof-css',
  'adjust-setinterval', 'adjust-settimeout', 'remove-node-text', 'abort-on-stack-trace']) {
  check('"' + name + '" resolves to an implemented scriptlet',
    !!ALIASES[name] && implemented.has(ALIASES[name]),
    ALIASES[name] ? 'maps to unimplemented ' + ALIASES[name] : 'is not in the alias table');
}

// ---------------------------------------------------------------------------
// A storage write stays refused; a cookie removal does not.
// ---------------------------------------------------------------------------
{
  const env = makeLibrary();
  env.document.cookie = 'keep=1';
  env.lib['set-cookie'](['consent', '1']);
  env.lib['set-local-storage-item'](['gdpr', '1']);
  env.lib['set-session-storage-item'](['gdpr', '1']);
  check('a cookie write is refused and logged',
    env.logged.filter((l) => l.startsWith('scriptlet_mutator_blocked')).length === 3,
    env.logged.join(' | '));
  check('a refused write leaves the document cookie alone', env.document.cookie === 'keep=1');
  check('remove-cookie is not treated as a storage mutator', !MUTATORS.has('remove-cookie'));
}

// ---------------------------------------------------------------------------
// remove-cookie clears what it matches and nothing else.
// ---------------------------------------------------------------------------
{
  const env = makeLibrary();
  const writes = [];
  let jar = '_pcid=abc; sid=keepme; cX_last=1';
  Object.defineProperty(env.document, 'cookie', {
    get: () => jar,
    set: (v) => { writes.push(v); },
    configurable: true,
  });
  env.lib['remove-cookie'](['/^(_pc|cX_)/', 'when', 'scroll keydown']);
  const cleared = writes.map((w) => w.split('=')[0]);
  check('remove-cookie expires every matching name',
    cleared.includes('_pcid') && cleared.includes('cX_last'), writes.join(' | '));
  check('remove-cookie leaves a name it was not given alone', !cleared.includes('sid'),
    writes.join(' | '));
  check('every write is an expiry, never a value',
    writes.every((w) => /expires=Thu, 01 Jan 1970/.test(w)), writes.join(' | '));
  check('a "when" trigger registers the events it names',
    env.logged.includes('listen:scroll') && env.logged.includes('listen:keydown'),
    env.logged.join(' | '));
}

// ---------------------------------------------------------------------------
// href-sanitizer unwraps a redirect without touching anything else.
// ---------------------------------------------------------------------------
{
  const wrapped = h('a', { id: 'wrapped', href: '/url?q=https%3A%2F%2Freal.test%2Fpage', ping: '/track' });
  const plain = h('a', { id: 'plain', href: 'https://other.test/' });
  const env = makeLibrary({ document: makeDocument('https://example.test/', [wrapped, plain]) });
  env.lib['href-sanitizer'](['a[href^="/url?q=http"]', '?q']);
  env.pump();
  check('href-sanitizer rewrites the href to the wrapped destination',
    wrapped.getAttribute('href') === 'https://real.test/page', wrapped.getAttribute('href'));
  check('href-sanitizer drops the ping attribute it unwrapped', !wrapped.hasAttribute('ping'));
  check('href-sanitizer leaves a link the selector did not name alone',
    plain.getAttribute('href') === 'https://other.test/');

  const b64 = h('a', { id: 'b64', href: '/go?u=aHR0cHM6Ly9yZWFsLnRlc3QvYg==' });
  const env64 = makeLibrary({ document: makeDocument('https://example.test/', [b64]) });
  env64.lib['href-sanitizer'](['a[href^="/go?u="]', '?u -base64']);
  env64.pump();
  check('href-sanitizer decodes a base64 destination',
    b64.getAttribute('href') === 'https://real.test/b', b64.getAttribute('href'));

  const hostile = h('a', { id: 'bad', href: '/go?u=javascript%3Aalert(1)' });
  const envBad = makeLibrary({ document: makeDocument('https://example.test/', [hostile]) });
  envBad.lib['href-sanitizer'](['a[href^="/go?u="]', '?u']);
  envBad.pump();
  check('href-sanitizer refuses a non-http destination',
    hostile.getAttribute('href') === '/go?u=javascript%3Aalert(1)', hostile.getAttribute('href'));
}

// ---------------------------------------------------------------------------
// remove-node-text and replace-node-text.
// ---------------------------------------------------------------------------
{
  const bait = h('script', {}, ['var x = 1; adsBlocked();']);
  const honest = h('script', {}, ['renderArticle();']);
  const env = makeLibrary({ document: makeDocument('https://example.test/', [bait, honest]) });
  env.lib['remove-node-text'](['script', 'adsBlocked']);
  env.pump();
  check('remove-node-text empties the matching script', bait.textContent === '', JSON.stringify(bait.textContent));
  check('remove-node-text leaves a script it did not match alone',
    honest.textContent === 'renderArticle();');

  const target = h('script', {}, ['before ADS after']);
  const rep = makeLibrary({ document: makeDocument('https://example.test/', [target]) });
  rep.lib['replace-node-text'](['script', 'ADS', 'ok']);
  rep.pump();
  check('replace-node-text substitutes rather than emptying',
    target.textContent === 'before ok after', JSON.stringify(target.textContent));
  rep.pump();
  check('replace-node-text does not rewrite the same node twice',
    target.textContent === 'before ok after', JSON.stringify(target.textContent));
}

// ---------------------------------------------------------------------------
// set-attr, including the "[other-attr]" copy form.
// ---------------------------------------------------------------------------
{
  const lazy = h('img', { id: 'lazy', class: 'lazyload', 'data-src': 'https://cdn.test/a.png' });
  const env = makeLibrary({ document: makeDocument('https://example.test/', [lazy]) });
  env.lib['set-attr'](['img.lazyload', 'src', '[data-src]']);
  env.pump();
  check('set-attr copies from the attribute it was pointed at',
    lazy.getAttribute('src') === 'https://cdn.test/a.png', lazy.getAttribute('src'));

  const flagged = h('div', { id: 'slot', class: 'adsbygoogle' });
  const lit = makeLibrary({ document: makeDocument('https://example.test/', [flagged]) });
  lit.lib['set-attr'](['.adsbygoogle', 'data-ad-status', '0']);
  lit.pump();
  check('set-attr writes a literal value', flagged.getAttribute('data-ad-status') === '0');

  const unsafe = h('div', { id: 'x', class: 'adsbygoogle' });
  const bad = makeLibrary({ document: makeDocument('https://example.test/', [unsafe]) });
  bad.lib['set-attr'](['.adsbygoogle', 'on click', '0']);
  bad.pump();
  check('set-attr refuses an attribute name that is not a name',
    unsafe.getAttribute('on click') === null);
}

// ---------------------------------------------------------------------------
// The timer boosters.
// ---------------------------------------------------------------------------
{
  const env = makeLibrary();
  env.lib['adjust-setInterval'](['countdown', '2000', '0.02']);
  env.win.setInterval(function countdown() {}, 2000);
  check('adjust-setInterval scales a matching delay',
    env.timers.setInterval[0] === 40, String(env.timers.setInterval[0]));
  env.win.setInterval(function other() {}, 2000);
  check('adjust-setInterval leaves a non-matching callback alone',
    env.timers.setInterval[1] === 2000, String(env.timers.setInterval[1]));

  const bare = makeLibrary();
  bare.lib['adjust-setInterval']([]);
  bare.win.setInterval(function anything() {}, 1000);
  check('adjust-setInterval with no arguments uses the default boost',
    bare.timers.setInterval[0] === 50, String(bare.timers.setInterval[0]));

  const clamped = makeLibrary();
  clamped.lib['adjust-setTimeout'](['tick', '', '0']);
  clamped.win.setTimeout(function tick() {}, 1000);
  check('a zero boost is clamped rather than collapsing the timer to 0',
    clamped.timers.setTimeout[0] > 0, String(clamped.timers.setTimeout[0]));
}

// ---------------------------------------------------------------------------
// Defusing eval is deliberately absent: replacing window.eval makes every direct eval() in the
// page indirect, which moves it out of the caller's scope. Keep the omission deliberate so a
// later "parity" pass does not quietly reintroduce it.
// ---------------------------------------------------------------------------
{
  check('no eval defuser is mapped', !ALIASES['noeval'] && !ALIASES['noeval-if']
    && !ALIASES['prevent-eval-if'],
    'eval defusing is incompatible with direct eval; see test-xss-behavior-guard.js');
  check('no eval defuser is implemented', !implemented.has('no-eval-if'));
  check('the content script never assigns window.eval',
    !/window\.eval\s*=/.test(RUNTIME));
}

// ---------------------------------------------------------------------------
// abort-on-stack-trace.
// ---------------------------------------------------------------------------
{
  const env = makeLibrary();
  env.win.probe = { createElement(tag) { return 'made:' + tag; } };
  env.lib['abort-on-stack-trace'](['probe.createElement', 'adsBlocked']);
  const callers = vm.runInContext(`(function(){
    const out = {};
    function adsBlocked(){ return window.probe.createElement('div'); }
    function renderArticle(){ return window.probe.createElement('div'); }
    try { out.bait = adsBlocked(); } catch (e) { out.bait = e.constructor.name; }
    try { out.honest = renderArticle(); } catch (e) { out.honest = e.constructor.name; }
    return out;
  })()`, env.sandbox);
  check('abort-on-stack-trace throws for the caller it names',
    callers.bait === 'ReferenceError', String(callers.bait));
  check('abort-on-stack-trace leaves another caller working',
    callers.honest === 'made:div', String(callers.honest));
}

// ---------------------------------------------------------------------------
// The anti-adblock bait stubs.
// ---------------------------------------------------------------------------
{
  const env = makeLibrary();
  env.lib['popads-dummy']([]);
  check('popads-dummy answers the bait properties', env.win.PopAds === true && env.win.popns === true);

  const bab = makeLibrary();
  bab.lib['bab-defuser']([]);
  check('bab-defuser hands the page a constructor', typeof bab.win.BlockAdBlock === 'function');
  check('bab-defuser installs the instance the bait looks for',
    bab.win.blockAdBlock && typeof bab.win.blockAdBlock.onDetected === 'function');
  check('the stub detection callbacks chain and never fire',
    bab.win.blockAdBlock.onDetected(() => { throw new Error('fired'); }) === bab.win.blockAdBlock);

  const fab = makeLibrary();
  fab.lib['fuckadblock-defuser']([]);
  check('fuckadblock-defuser covers both bait names',
    typeof fab.win.FuckAdBlock === 'function' && typeof fab.win.BlockAdBlock === 'function');

  const pop = makeLibrary();
  pop.lib['prevent-popads-net']([]);
  let threw = false;
  try { void pop.win.PopAds; } catch (_) { threw = true; }
  check('prevent-popads-net throws on access', threw);
}

// ---------------------------------------------------------------------------
// spoof-css reports the value the bait wants without changing the page.
// ---------------------------------------------------------------------------
{
  const bait = h('div', { id: 'bait', class: 'ad-test-element' });
  const env = makeLibrary({ document: makeDocument('https://example.test/', [bait]) });
  env.lib['spoof-css'](['.ad-test-element', 'display', 'block']);
  const seen = env.win.getComputedStyle(bait).getPropertyValue('display');
  check('spoof-css reports the spoofed value for a matching element', seen === 'block', seen);
  const other = h('div', { class: 'article' });
  env.document.body.appendChild(other);
  check('spoof-css leaves other elements reporting the truth',
    env.win.getComputedStyle(other).getPropertyValue('display') === '');
}

if (failed) {
  console.error('[fail] ' + failed + ' scriptlet library check(s) failed');
  process.exit(1);
}
console.log('[ok] scriptlet library: ' + canonical.size + ' canonical names, alias table in sync, '
  + 'storage writes refused, new implementations behave');

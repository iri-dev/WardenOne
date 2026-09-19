/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * How far can a page point the EyeShield stylesheet fetch? Nowhere the page cannot go itself.
 * Run: node tools/test-eyeshield-fetch-scope.js
 *
 * EyeShield recolours cross-origin (CDN-hosted) stylesheets, whose text the page -- and so the
 * content script -- cannot read across origins. It used to ask the service worker for that text,
 * and the worker fetched it with the extension's own permissions, which reach addresses no page
 * may: a router, a NAS, a service on the reader's own network. Between a page and that reach
 * stood a check of the hostname STRING (M40 tightened it: real stylesheet Content-Types only,
 * default ports only) -- and a string cannot see what a public-looking name RESOLVES to. A page
 * that listed a stylesheet on such a name could have the extension fetch from inside the
 * reader's network and hand the result back into the page's own DOM (SEC-11). Chrome gives an
 * extension no way to learn where a name resolves before the request is made, so no version of
 * that proxy could be made safe: the only fix that guarantees no privileged request ever reaches
 * a private listener is to make no privileged request.
 *
 * So the worker has no stylesheet fetch any more, and the content script fetches the text itself,
 * from the page's context and on the page's own terms: mode 'cors', no credentials. That request
 * is subject to everything the page's own requests are -- CORS and Chrome's private-network
 * rules -- so a page gains nothing from EyeShield that it did not already have. The cost is
 * honest: a host that does not let pages read its stylesheets keeps its own colours.
 *
 * The content script's fetch is lifted and driven against a fake fetch; the worker is checked for
 * the absence of the proxy, and the custom-list fetch -- an address the READER typed, not a page
 * -- for keeping its guards.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const EYE = fs.readFileSync(path.join(ROOT, 'eyeshield.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
/* A fetch that never answers would drain the event loop and exit 0 with nothing printed. The
   suite is a failure until it says otherwise. */
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished: something never answered'); });
/* Functions inside eyeshield.js's closure are indented; the lift tolerates that and, on a source
   that lacks one, returns null so the suite reports what is missing instead of crashing. */
function grabFn(src, name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(src);
  if (!m) return null;
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}
const constOf = (name) => { const m = new RegExp('^[ \\t]*const ' + name + ' = ([^;]+);', 'm').exec(EYE); return m ? 'const ' + name + ' = ' + m[1] + ';' : null; };

/* ---- 1. the worker no longer fetches anything a page chose --------------------------------- */
check('the worker has no stylesheet fetch', !/function fetchPublicStylesheetText\(/.test(BG));
check('and no handler a tab could reach for one', !/eyeshield-fetch-css/.test(BG));
check('the content script no longer asks the worker for stylesheet text', !/eyeshield-fetch-css/.test(EYE) && !/sendMessage\([^)]*css/i.test(EYE));
/* The one worker fetch of a typed-in address that remains is the reader's own custom list, and it
   keeps the guards that made the M40 audit note call it well built. */
check('the custom-list fetch still refuses private hosts, non-default ports and redirects onto them',
  /async function fetchCustomListText\(rawUrl\) \{\s*let url = normalizePublicHttpUrl\(rawUrl\);\s*if \(!url \|\| !isDefaultPortHttpUrl\(url\)\)/.test(BG)
    && /const next = normalizePublicHttpUrl\(res\.headers && res\.headers\.get\('location'\), url\);\s*if \(!next \|\| !isDefaultPortHttpUrl\(next\)\)/.test(BG));

/* ---- 2. the content script's fetch is the page's own kind of request ---------------------- */
const FETCH_SRC = grabFn(EYE, 'fetchForeignSheet');
check('the content script fetches the sheet itself', !!FETCH_SRC, 'fetchForeignSheet is missing');
check('as a CORS request', !!FETCH_SRC && /mode: 'cors'/.test(FETCH_SRC));
check('without credentials', !!FETCH_SRC && /credentials: 'omit'/.test(FETCH_SRC));
check('with a tracked timeout that aborts', !!FETCH_SRC && /controller\.abort\(\)/.test(FETCH_SRC) && /woTimeout\([\s\S]{0,160}FOREIGN_CSS_TIMEOUT_MS\)/.test(FETCH_SRC));

/* ---- 3. drive it ------------------------------------------------------------------------- */
const LIFTED = [
  constOf('FOREIGN_CSS_MAX_BYTES') || 'const FOREIGN_CSS_MAX_BYTES = 4000000;',
  constOf('FOREIGN_CSS_TIMEOUT_MS') || 'const FOREIGN_CSS_TIMEOUT_MS = 8000;',
  grabFn(EYE, 'isStylesheetContentType') || 'function isStylesheetContentType() { return true; }',
  grabFn(EYE, 'readBoundedText') || 'async function readBoundedText(res) { return res.text(); }',
  FETCH_SRC || "function fetchForeignSheet(href, done) { chrome.runtime.sendMessage({ kind: 'eyeshield-fetch-css', url: href }, (r) => done(r && r.ok ? r.css : '')); }",
  grabFn(EYE, 'collectForeignHrefs'),
  grabFn(EYE, 'applyForeignCSS'),
].join('\n');

function realm(fetchImpl) {
  const state = { timers: [], timerId: 0, injected: [], messages: 0, fetches: [] };
  const sandbox = {
    console, Promise, Object, Array, String, Number, Boolean, Set, Map, JSON, Math, Error, TypeError, Symbol,
    URL, Response, Headers, ReadableStream, TextDecoder, AbortController,
    /* EyeShield's tracked timer (woTimeout, cleared on dispose) and the raw one, both recorded. */
    setTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, ms }); return id; },
    woTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
    fetch: (url, init) => { state.fetches.push({ url, init }); return fetchImpl(url, init); },
    /* The worker, as the old code reached it: counted, and answered as a worker with no handler
       answers, so a pre-fix source is reported rather than waited on. */
    chrome: { runtime: { lastError: null, sendMessage: (msg, cb) => { state.messages++; if (typeof cb === 'function') setImmediate(() => cb(undefined)); } } },
    CSSStyleSheet: function CSSStyleSheet() {},
    THEME_ID: 'wo-eyeshield-theme',
    isManagedThemeHost: () => false,
    rootsList: () => [sandbox.document],
    injectForeignCSS: (mode) => { state.injected.push(mode); },
    foreignCache: new Map(), foreignPending: new Set(), foreignToken: 0, activeRemap: 'dark',
    document: { styleSheets: [] },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { fetchForeignSheet, applyForeignCSS, collectForeignHrefs, isStylesheetContentType };'
    + '\nthis.bump = () => { foreignToken++; };', ctx, { filename: 'eyeshield-foreign.js' });
  return { state, sandbox, api: sandbox.api, bump: sandbox.bump };
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const fetched = (r, href) => new Promise((resolve) => { r.api.fetchForeignSheet(href, resolve); });
const cssResponse = (text, headers) => new Response(text, { status: 200, headers: Object.assign({ 'content-type': 'text/css' }, headers || {}) });
/* A cross-origin sheet as the page sees it: an href, and cssRules that throw. */
const foreignSheet = (href, extra) => Object.assign({ href, disabled: false, ownerNode: { id: '' }, get cssRules() { throw new Error('SecurityError'); } }, extra || {});
const ownSheet = (href) => ({ href, disabled: false, ownerNode: { id: '' }, cssRules: [] });

(async () => {
  /* A CDN that lets pages read its stylesheets, which every CDN serving web fonts does. */
  {
    const r = realm(async () => cssResponse('a{color:#fff}'));
    const css = await fetched(r, 'https://cdn.example/site.css');
    check('a stylesheet a page may read is fetched and returned', css === 'a{color:#fff}', JSON.stringify(css));
    const init = r.state.fetches[0] && r.state.fetches[0].init;
    check('as the page would fetch it: cors, no credentials, redirects followed by the browser',
      !!init && init.mode === 'cors' && init.credentials === 'omit' && init.redirect === 'follow', JSON.stringify(init));
    check('and nothing was asked of the worker', r.state.messages === 0, r.state.messages + ' message(s)');
    check('the timeout was cleared once the sheet arrived', r.state.timers.length === 0);
  }
  /* A host that does not: the browser refuses the read, and the sheet keeps its colours. */
  {
    const r = realm(async () => { throw new TypeError('Failed to fetch'); });
    const css = await fetched(r, 'https://strict-cdn.example/site.css');
    check('a stylesheet the page may not read yields nothing, without a throw', css === '');
    check('and no other route to it is tried', r.state.messages === 0 && r.state.fetches.length === 1);
  }
  /* The address the finding is about, a public-looking name that resolves inward. The page's own
     request to it is what Chrome's private-network rules apply to, and the only request made is the
     page's own kind. */
  {
    const r = realm(async () => { throw new TypeError('Failed to fetch'); });
    const css = await fetched(r, 'https://cdn-looking-name.example/theme.css');
    check('a name that resolves into the reader\'s network gets exactly one request, and it is the page\'s own kind',
      css === '' && r.state.fetches.length === 1 && r.state.fetches[0].init.mode === 'cors' && r.state.messages === 0,
      JSON.stringify(r.state.fetches.map((f) => f.init.mode)) + ' / ' + r.state.messages + ' worker message(s)');
  }
  /* Only stylesheets. */
  for (const ct of ['text/html', 'text/plain', 'application/json', '']) {
    const r = realm(async () => new Response('body{}', { status: 200, headers: ct ? { 'content-type': ct } : {} }));
    check('a response labelled ' + JSON.stringify(ct) + ' is not a stylesheet', (await fetched(r, 'https://x.example/a')) === '');
  }
  for (const ct of ['text/css', 'text/css; charset=utf-8', 'TEXT/CSS', 'application/x-css', 'text/x-css']) {
    const r = realm(async () => new Response('b{}', { status: 200, headers: { 'content-type': ct } }));
    check('a response labelled ' + JSON.stringify(ct) + ' is one', (await fetched(r, 'https://x.example/a')) === 'b{}');
  }
  {
    const r = realm(async () => new Response('', { status: 404 }));
    check('an HTTP error yields nothing', (await fetched(r, 'https://x.example/missing.css')) === '');
  }
  /* Bounded. */
  {
    const r = realm(async () => cssResponse('c{}', { 'content-length': String(4000001) }));
    check('a sheet declared over four megabytes is refused on its header', (await fetched(r, 'https://x.example/big.css')) === '');
  }
  {
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const r = realm(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/css' } }));
    const css = await fetched(r, 'https://x.example/endless.css');
    check('an undeclared body is read no further than four megabytes, then dropped', css === '' && cancelled, cancelled ? 'not cancelled' : 'stream still open');
  }
  {
    let aborted = false;
    const r = realm((url, init) => new Promise(() => { init.signal.addEventListener('abort', () => { aborted = true; }); }));
    let result = null;
    r.api.fetchForeignSheet('https://slow.example/a.css', (css) => { result = css; });
    check('a slow host is given the timeout and no more', r.state.timers.length === 1 && r.state.timers[0].ms === 8000, JSON.stringify(r.state.timers.map((t) => t.ms)));
    for (const t of r.state.timers.splice(0)) t.fn();
    await settle();
    check('then the request is aborted and the sheet given up', aborted && result === '');
  }

  /* ---- 4. through applyForeignCSS, the way the page's sheets reach it ------------------------ */
  {
    const r = realm(async (url) => (url.indexOf('closed') >= 0 ? Promise.reject(new TypeError('Failed to fetch')) : cssResponse('p{color:#000}')));
    r.sandbox.document.styleSheets = [
      ownSheet('https://site.example/own.css'),
      foreignSheet('https://cdn.example/open.css'),
      foreignSheet('https://cdn.example/open.css'),
      foreignSheet('https://cdn.example/closed.css'),
      foreignSheet('https://cdn.example/disabled.css', { disabled: true }),
      foreignSheet('https://cdn.example/ours.css', { ownerNode: { id: 'wo-eyeshield-theme' } }),
      foreignSheet('blob:https://site.example/abc'),
    ];
    const hrefs = r.api.collectForeignHrefs([r.sandbox.document]);
    check('only the cross-origin, enabled, http(s) sheets that are not ours are candidates, once each',
      hrefs.join(',') === 'https://cdn.example/open.css,https://cdn.example/closed.css', hrefs.join(','));
    r.api.applyForeignCSS('dark');
    check('each candidate is fetched from the page, once', r.state.fetches.length === 2 && r.state.messages === 0, r.state.fetches.length + ' fetch(es)');
    await settle();
    check('the readable sheet is cached and injected for the active mode; the closed one is remembered as empty',
      r.sandbox.foreignCache.get('https://cdn.example/open.css') === 'p{color:#000}' && r.sandbox.foreignCache.get('https://cdn.example/closed.css') === ''
        && r.state.injected.length >= 1 && r.state.injected.every((m) => m === 'dark') && r.sandbox.foreignPending.size === 0,
      JSON.stringify({ injected: r.state.injected, pending: r.sandbox.foreignPending.size }));
    const before = r.state.fetches.length;
    r.state.injected.length = 0;
    r.api.applyForeignCSS('dark');
    check('a second pass reuses the cache: no new request, an immediate inject', r.state.fetches.length === before && r.state.injected.length === 1);
  }
  {
    /* A mode change while a fetch is in flight: the stale answer must not paint the old mode. */
    let release;
    const r = realm(() => new Promise((resolve) => { release = () => resolve(cssResponse('q{}')); }));
    r.sandbox.document.styleSheets = [foreignSheet('https://cdn.example/late.css')];
    r.api.applyForeignCSS('dark');
    r.bump();
    if (release) release();
    await settle();
    check('an answer that arrives after the mode moved on is cached but not injected',
      r.sandbox.foreignCache.get('https://cdn.example/late.css') === 'q{}' && r.state.injected.length === 0, JSON.stringify(r.state.injected));
  }
  {
    const r = realm(async () => cssResponse('x{}'));
    r.sandbox.fetch = undefined;
    r.sandbox.document.styleSheets = [foreignSheet('https://cdn.example/a.css')];
    r.api.applyForeignCSS('dark');
    check('a realm without fetch does nothing rather than throwing', r.state.fetches.length === 0 && r.state.messages === 0);
  }

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the EyeShield stylesheet fetch is the page\'s own kind of request, and the worker makes none');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* A name declared inside a block is gone once the block closes, and the engine's guards catch the
   ReferenceError and quietly switch off. Scan the shipped build for such names, then run it.
   Run: node tools/test-engine-block-scope.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIN = read('content.min.js');
/* The manifest loads these into the same MAIN world ahead of the engine. */
const PRELOAD = ['engine-compat.js', 'domain-utils.js'].map((f) => [f, read(f)]);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail === undefined ? '' : '  -> ' + detail));
}

/* ---- static: a tokenizer just good enough to see blocks, declarations and references ---- */

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const NOT_A_REFERENCE = new Set(('break case catch class const continue debugger default delete do else '
  + 'export extends finally for function if import in instanceof new return super switch this throw try '
  + 'typeof var void while with yield let static await async of get set true false null undefined '
  + 'arguments NaN Infinity').split(' '));
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==',
  '!=', '<=', '>=', '&&', '||', '??', '?.', '**', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++',
  '--', '<<', '>>'];
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/y;
const ID = /[A-Za-z_$À-￿#][\w$À-￿]*/y;

function tokenize(src) {
  const toks = [];
  const braces = [];
  let i = 0;
  let last = null;
  const push = (t, v, at) => { last = { t, v, at }; toks.push(last); };
  const regexAllowed = () => {
    if (!last) return true;
    if (last.t === 'id') return REGEX_AFTER_WORD.has(last.v);
    if (last.t !== 'p') return false;
    return last.v !== ')' && last.v !== ']';
  };
  const template = (at) => {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; push('tpl', '', at); return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; braces.push('t'); push('p', '${', at); return; }
      i++;
    }
    throw new Error('unterminated template at ' + at);
  };
  while (i < src.length) {
    const c = src[i];
    const at = i;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment at ' + at);
      i = end + 2;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      push('str', '', at);
      continue;
    }
    if (c === '`') { i++; template(at); continue; }
    if (c === '}' && braces[braces.length - 1] === 't') { braces.pop(); i++; push('p', '}', at); template(at); continue; }
    if (c === '/' && regexAllowed()) {
      i++;
      let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) break;
        else if (d === '\n') throw new Error('unterminated regex at ' + at);
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;
      push('re', '', at);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      i += m ? m[0].length : 1;
      push('num', '', at);
      continue;
    }
    ID.lastIndex = i;
    const id = ID.exec(src);
    if (id && id.index === i) { i += id[0].length; push('id', id[0], at); continue; }
    const p = PUNCT.find((q) => src.startsWith(q, i) && !(q === '?.' && /[0-9]/.test(src[i + 2] || '')));
    if (p) { i += p.length; push('p', p, at); continue; }
    if (c === '{') braces.push('b');
    if (c === '}') braces.pop();
    i++;
    push('p', c, at);
  }
  return toks;
}

/* A pattern's bindings: identifiers that are neither keys (`a:`) nor defaults (`=b`). */
function patternNames(toks, open, close) {
  const out = [];
  for (let k = open + 1; k < close; k++) {
    const t = toks[k];
    if (t.t !== 'id' || NOT_A_REFERENCE.has(t.v)) continue;
    const next = toks[k + 1] && toks[k + 1].v;
    const prev = toks[k - 1] && toks[k - 1].v;
    if (next === ':' || prev === '=' || prev === '.' || prev === '?.') continue;
    out.push(k);
  }
  return out;
}

function analyse(src) {
  const toks = tokenize(src);
  const match = new Array(toks.length).fill(-1);
  const depth = new Array(toks.length).fill(0);
  const open = [];
  for (let k = 0; k < toks.length; k++) {
    const v = toks[k].t === 'p' ? toks[k].v : '';
    depth[k] = open.length;
    if (v === '(' || v === '[' || v === '{' || v === '${') open.push(k);
    else if (v === ')' || v === ']' || v === '}') {
      const o = open.pop();
      if (o === undefined) throw new Error('unbalanced ' + v + ' at ' + toks[k].at);
      match[o] = k;
      match[k] = o;
      depth[k] = open.length;
    }
  }
  if (open.length) throw new Error(open.length + ' bracket(s) never closed');

  const isP = (k, v) => !!toks[k] && toks[k].t === 'p' && toks[k].v === v;
  const isId = (k, v) => !!toks[k] && toks[k].t === 'id' && (v === undefined || toks[k].v === v);
  const CONTROL = new Set(['if', 'for', 'while', 'switch', 'with']);

  /* A `{` that opens a scope rather than an object literal or a class body. */
  const isBlock = (k) => {
    const p = toks[k - 1];
    if (!p) return true;
    if (p.t === 'p') return p.v === ')' || p.v === ';' || p.v === '{' || p.v === '}' || p.v === '=>';
    return p.t === 'id' && /^(else|try|finally|do)$/.test(p.v);
  };

  /* Declarator names of a const/let/var at token k, stopping at the end of its statement. */
  const declarators = (k) => {
    const level = depth[k];
    const names = [];
    let j = k + 1;
    for (;;) {
      if (isId(j)) names.push(j);
      else if (isP(j, '{') || isP(j, '[')) names.push(...patternNames(toks, j, match[j]));
      else break;
      for (; j < toks.length; j++) {
        if (depth[j] < level) return names;
        if (depth[j] === level && (isP(j, ',') || isP(j, ';') || isId(j, 'in') || isId(j, 'of'))) break;
        if (match[j] > j) j = match[j];
      }
      if (!isP(j, ',')) return names;
      j++;
    }
    return names;
  };

  /* Everything declared anywhere, generously: a parameter of the same name elsewhere must not
     make an outside reference look orphaned. */
  const declaredAt = new Map();
  const declToken = new Set();
  const addDecl = (k) => {
    declToken.add(k);
    const n = toks[k].v;
    if (!declaredAt.has(n)) declaredAt.set(n, []);
    declaredAt.get(n).push(k);
  };
  const addAllIds = (from, to) => {
    for (let k = from + 1; k < to; k++) if (isId(k) && !NOT_A_REFERENCE.has(toks[k].v) && !isP(k - 1, '.')) addDecl(k);
  };
  for (let k = 0; k < toks.length; k++) {
    if (isId(k, 'const') || isId(k, 'let') || isId(k, 'var')) declarators(k).forEach(addDecl);
    else if ((isId(k, 'function') || isId(k, 'class')) && isId(k + 1) && !NOT_A_REFERENCE.has(toks[k + 1].v)) addDecl(k + 1);
    else if (isP(k, '=>')) {
      if (isId(k - 1)) addDecl(k - 1);
      else if (isP(k - 1, ')')) addAllIds(match[k - 1], k - 1);
    } else if (isP(k, '(') && (isP(match[k] + 1, '{')) && !(isId(k - 1) && CONTROL.has(toks[k - 1].v))) {
      addAllIds(k, match[k]);
    }
  }

  /* References: identifiers in expression position. */
  const refsAt = new Map();
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'id' || NOT_A_REFERENCE.has(t.v) || declToken.has(k)) continue;
    if (isP(k - 1, '.') || isP(k - 1, '?.') || isP(k + 1, ':')) continue;
    if (isId(k - 1, 'function') || isId(k - 1, 'class')) continue;
    /* method shorthand: `{name(){`, `,name(){`, `get name(){` */
    if (isP(k + 1, '(') && isP(match[k + 1] + 1, '{')
      && (isP(k - 1, '{') || isP(k - 1, ',') || isId(k - 1, 'get') || isId(k - 1, 'set') || isId(k - 1, 'static') || isId(k - 1, 'async'))) continue;
    if (!refsAt.has(t.v)) refsAt.set(t.v, []);
    refsAt.get(t.v).push(k);
  }

  /* Names a block declares directly, then any reference to them that escapes it. */
  const leaks = [];
  let blocks = 0;
  for (let k = 0; k < toks.length; k++) {
    if (!isP(k, '{') || !isBlock(k)) continue;
    blocks++;
    const close = match[k];
    const inner = depth[k] + 1;
    const own = [];
    for (let j = k + 1; j < close; j++) {
      if (match[j] > j && depth[j] > inner) { j = match[j]; continue; }
      if (depth[j] !== inner) continue;
      if (isId(j, 'const') || isId(j, 'let')) own.push(...declarators(j));
      else if ((isId(j, 'function') || isId(j, 'class')) && isId(j + 1)) own.push(j + 1);
    }
    const outside = (j) => j < k || j > close;
    for (const d of own) {
      const name = toks[d].v;
      const escaped = (refsAt.get(name) || []).filter(outside);
      if (!escaped.length) continue;
      if ((declaredAt.get(name) || []).some(outside)) continue;
      leaks.push({ name, declared: toks[d].at, used: toks[escaped[0]].at, uses: escaped.length });
    }
  }
  return { tokens: toks.length, blocks, leaks, declared: new Set(declaredAt.keys()) };
}

const snippet = (src, at) => src.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ');

console.log('\nengine block scope\n');

{
  /* The shape this suite exists for, reduced: a helper declared in a bare block, used after it. */
  const bug = '!function(){"use strict";{const REDIRECT=["u"],regDom=regDomain,u2=s=>{try{return new URL(s,location.href)}catch{return null}};let last=0}'
    + 'const localAdminTarget=raw=>{try{const u=u2(raw);return!!u&&regDom(u.hostname)}catch(_){return!1}};localAdminTarget("x")}();';
  const r = analyse(bug);
  const names = r.leaks.map((l) => l.name).sort().join(',');
  check('the scanner catches the bug shape (u2 and regDom used after their block)', names === 'regDom,u2', names || 'nothing found');
  const fine = '!function(){"use strict";const u2=s=>s;{const u2=t=>t,o={u2:1};o.u2}u2(1);const f=(regDom)=>regDom;'
    + '{const helper=1;helper}const o2={helper(){return 1}};x?.helper;if(a){const k=/}{/.test(b)}const s=`${1}{`}();';
  const r2 = analyse(fine);
  check('shadowing, keys, methods, regex and template braces are not mistaken for leaks',
    r2.leaks.length === 0, JSON.stringify(r2.leaks));
}

let shipped = null;
try {
  shipped = analyse(MIN);
} catch (e) {
  check('the shipped engine tokenizes cleanly', false, e.message);
}
if (shipped) {
  check('the scanner walked the whole shipped engine', shipped.blocks > 1000 && shipped.tokens > 100000,
    shipped.blocks + ' blocks, ' + shipped.tokens + ' tokens');
  /* Outside its block such a name can still be a global one of the preloaded files declares:
     buildConfig calls domain-utils.js's regDomain and hostMatchesSite on purpose. */
  const preloadGlobals = new Set();
  for (const [, code] of PRELOAD) {
    for (const m of code.matchAll(/^(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([\w$]+)/gm)) preloadGlobals.add(m[1]);
  }
  const resolved = shipped.leaks.filter((l) => preloadGlobals.has(l.name));
  const leaks = shipped.leaks.filter((l) => !preloadGlobals.has(l.name));
  for (const l of resolved) console.log('  [info] ' + l.name + ' outside its block resolves to the preloaded global of that name');
  check('no name declared inside a block is used after that block closes', leaks.length === 0,
    leaks.map((l) => l.name + ' (' + l.uses + ' use(s), e.g. ...' + snippet(MIN, l.used) + '...)').join('\n      '));
}

/* ---- dynamic: run the shipped engine in a stub page and use what it installed ---- */

function boot(href) {
  const noop = () => {};
  const el = (tag) => ({
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '', getPropertyPriority: () => '' },
    setAttribute: noop, getAttribute: () => null, hasAttribute: () => false, removeAttribute: noop,
    appendChild: (c) => c, removeChild: noop, remove: noop, insertBefore: (c) => c,
    addEventListener: noop, removeEventListener: noop, attachShadow: () => el(),
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, getElementsByTagName: () => [],
    matches: () => false, contains: () => false,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    getRootNode() { return this; }, isConnected: true, children: [], childNodes: [],
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    dataset: {}, textContent: '', innerText: '', innerHTML: '', value: '', tagName: tag || 'DIV',
    localName: String(tag || 'div').toLowerCase(), attributes: [],
    nodeType: 1, id: '', className: '', parentNode: null, parentElement: null, options: [],
  });
  const events = [];
  const passed = [];
  const doc = new EventTarget();
  Object.assign(doc, {
    readyState: 'loading', documentElement: el('HTML'), head: el('HEAD'), body: null,
    createElement: (t) => el(String(t).toUpperCase()), createElementNS: () => el(), createTextNode: () => el(),
    getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
    querySelector: () => null, querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null }), currentScript: null,
    cookie: '', title: '', referrer: '', hidden: false, visibilityState: 'visible', adoptedStyleSheets: [], nodeType: 9,
  });
  doc.addEventListener('wo-event', (e) => { const d = e.detail || {}; events.push({ type: d.type, detail: d.detail || {} }); });
  const win = new EventTarget();
  const timers = [];
  const record = (kind) => function (url) { passed.push(kind + ' ' + String(url && url.url || url)); };
  class Form {
    constructor(action, fields) { this.action = action; this.fields = fields || []; this.tagName = 'FORM'; this.nodeType = 1; }
    getAttribute(n) { return n === 'action' ? this.action : null; }
    removeAttribute() {}
    querySelector(sel) { return this.fields.some((f) => sel.includes('name="' + f + '"')) ? {} : null; }
  }
  Form.prototype.submit = function () { passed.push('submit ' + this.action); };
  Form.prototype.requestSubmit = function () { passed.push('requestSubmit ' + this.action); };
  class Node {}
  Node.prototype.appendChild = function (n) { passed.push('append ' + n.tagName); return n; };
  Node.prototype.insertBefore = function (n) { passed.push('insert ' + n.tagName); return n; };
  class Element {}
  Element.prototype.setAttribute = function (n, v) { passed.push('setAttribute ' + this.tagName + ' ' + n + '=' + v); };
  const ctor = (kind) => class { constructor(url) { passed.push(kind + ' ' + url); } addEventListener() {} postMessage() {} close() {} send() {} terminate() {} };
  const XHR = class { open(m, url) { passed.push('xhr ' + url); } send() {} setRequestHeader() {} addEventListener() {} };
  const sandbox = {
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    document: doc,
    location: Object.assign(new URL(href), { reload: noop, assign: noop, replace: noop }),
    navigator: {
      userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'en-GB', languages: ['en-GB'],
      hardwareConcurrency: 8, deviceMemory: 8, doNotTrack: null, webdriver: false,
      mediaDevices: {}, permissions: {}, sendBeacon: () => true, clipboard: {},
      userAgentData: null, plugins: [], mimeTypes: [], maxTouchPoints: 0, storage: {},
    },
    history: { pushState: noop, replaceState: noop, back: noop, forward: noop, go: noop },
    screen: { width: 1920, height: 1080, colorDepth: 24, availWidth: 1920, availHeight: 1040 },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop, key: () => null, length: 0 },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop, key: () => null, length: 0 },
    performance: { now: () => 0, getEntriesByType: () => [], mark: noop, measure: noop },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: noop,
    setInterval: () => 0, clearInterval: noop, requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    requestIdleCallback: () => 0, cancelIdleCallback: noop,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    PerformanceObserver: class { observe() {} disconnect() {} },
    AbortController, AbortSignal, EventTarget, Event, CustomEvent, DOMException,
    fetch(input) { record('fetch')(input); return Promise.resolve({ ok: true, status: 200 }); },
    XMLHttpRequest: XHR,
    WebSocket: ctor('websocket'), EventSource: ctor('eventsource'),
    Worker: ctor('worker'), SharedWorker: ctor('sharedworker'),
    RTCPeerConnection: class { createDataChannel() {} createOffer() { return Promise.resolve({}); } addEventListener() {} close() {} },
    URL, URLSearchParams, Blob: class {}, FileReader: class {}, FormData: class {},
    Image: class { addEventListener() {} }, Audio: class { addEventListener() {} },
    HTMLMediaElement: class {}, HTMLCanvasElement: class {}, HTMLIFrameElement: class {},
    HTMLElement: class {}, Element, Node, Document: class {}, HTMLFormElement: Form,
    CanvasRenderingContext2D: class {}, WebGLRenderingContext: class {}, WebGL2RenderingContext: class {},
    AudioContext: class {}, OfflineAudioContext: class {}, SpeechSynthesis: class {},
    Notification: class {}, PushManager: class {}, ServiceWorkerContainer: class {},
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, atob, btoa,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    open: noop, close: noop, postMessage: noop,
    addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win),
    dispatchEvent: win.dispatchEvent.bind(win),
    getComputedStyle: () => ({ getPropertyValue: () => '', position: 'static', zIndex: 'auto', display: 'block', visibility: 'visible', opacity: '1' }),
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, isSecureContext: true,
    origin: new URL(href).origin, name: '', frameElement: null,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
    Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, Intl, Uint8Array, Uint32Array, ArrayBuffer, DataView,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  doc.location = sandbox.location;
  vm.createContext(sandbox);
  for (const [name, code] of PRELOAD) vm.runInContext(code, sandbox, { filename: name });
  vm.runInContext(MIN, sandbox, { filename: 'content.min.js', timeout: 20000 });
  /* The bridge hands its key over while the document is still loading; after that, events leave
     the engine as wo-event and this stub can read them. */
  doc.dispatchEvent(new CustomEvent('wo-key', { detail: { token: 'test', key: 'a'.repeat(64) } }));
  doc.readyState = 'complete';
  /* No signed config arrives here, so start the runtime the way the page does when the bridge is
     slow: the 1.5 s fallback, on the shipped defaults. */
  const start = timers.find((t) => t.ms === 1500);
  if (!start) throw new Error('the runtime start fallback was not scheduled');
  start.fn();
  const types = () => events.map((e) => e.type);
  const outcome = async (fn) => {
    try { await fn(); return 'allowed'; } catch (e) { return String(e && e.message || e); }
  };
  return { w: sandbox, events, types, passed, outcome, Form };
}

const INTRANET = 'Blocked by WardenOne Intranet Guard';
const RISKY = 'Blocked by WardenOne Risky-site Mode';

(async () => {
  {
    const page = boot('https://example.com/');
    const { w, outcome } = page;
    check('public page: fetch to a loopback address is refused',
      (await outcome(() => w.fetch('http://127.0.0.1:9/'))) === INTRANET);
    check('public page: a Worker from a loopback address is refused',
      (await outcome(() => new w.Worker('http://127.0.0.1:9/x.js'))) === INTRANET);
    check('public page: a WebSocket to the router is refused',
      (await outcome(() => new w.WebSocket('ws://192.168.1.1/'))) === INTRANET);
    check('public page: an EventSource to a .lan name is refused',
      (await outcome(() => new w.EventSource('http://nas.lan/events'))) === INTRANET);
    const xhr = new w.XMLHttpRequest();
    xhr.open('GET', 'http://10.0.0.1/admin');
    check('public page: XHR to a private address never reaches open()',
      !page.passed.some((p) => p === 'xhr http://10.0.0.1/admin'), page.passed.join(' | '));
    const probes = () => page.types().filter((t) => t === 'blocked_intranet_probe').length;
    check('and each refusal is recorded as an intranet probe', probes() === 5, page.types().join(','));
    /* Discord's invite page looks for its desktop app on ten consecutive ports. */
    const sweep = [];
    for (let p = 6463; p <= 6472; p++) sweep.push(await outcome(() => new w.WebSocket('ws://127.0.0.1:' + p + '/?v=1')));
    check('a port sweep is refused on every port but recorded once',
      sweep.every((r) => r === INTRANET) && probes() === 6, sweep.join(',') + ' / ' + probes() + ' records');

    check('public page: a public name that begins like a private address is not one',
      (await outcome(() => w.fetch('https://192.168.advertiser.com/login'))) === 'allowed'
        && (await outcome(() => w.fetch('https://10.example.com/admin/app.js'))) === 'allowed'
        && (await outcome(() => new w.WebSocket('wss://172.16.cdn.example.com/setup'))) === 'allowed'
        && probes() === 6, page.types().join(','));
    check('public page: ordinary requests still go through',
      (await outcome(() => w.fetch('https://example.com/api/data'))) === 'allowed'
        && (await outcome(() => new w.Worker('https://example.com/worker.js'))) === 'allowed'
        && (await outcome(() => new w.Worker('blob:https://example.com/2f1c'))) === 'allowed'
        && (await outcome(() => new w.WebSocket('wss://example.com/live'))) === 'allowed');

    /* Forms: field names are the page's own words. A public page that names its fields like a
       sign-in response is still a public page posting to this computer. */
    new w.HTMLFormElement('http://localhost:2375/containers/create', ['Image']).submit();
    new w.HTMLFormElement('http://localhost:2375/containers/create', ['Image', 'code', 'state']).submit();
    new w.HTMLFormElement('http://127.0.0.1:2375/containers/create', ['SAMLResponse', 'RelayState']).requestSubmit();
    new w.HTMLFormElement('https://localhost:5001/signin-oidc', ['code', 'state', 'id_token']).submit();
    new w.HTMLFormElement('http://192.168.1.1/apply.cgi', ['code', 'state']).submit();
    check('a public page cannot pass a loopback form off as a sign-in response',
      !page.passed.some((p) => /localhost|127\.0\.0\.1|192\.168\.1\.1/.test(p)), page.passed.join(' | '));
    const disguised = new w.HTMLFormElement('http://127.0.0.1:2375/containers/create', ['code', 'state']);
    const submitEvent = new Event('submit', { cancelable: true });
    Object.defineProperty(submitEvent, 'target', { value: disguised });
    w.document.dispatchEvent(submitEvent);
    check('and neither can a user-clicked submit of one', submitEvent.defaultPrevented);

    const form = { tagName: 'FORM', nodeType: 1, getAttribute: () => null, removeAttribute() {} };
    w.Element.prototype.setAttribute.call(form, 'action', 'http://localhost:5001/signin-oidc');
    w.Node.prototype.appendChild.call({}, Object.assign({}, form, { action: 'http://localhost:5001/signin-oidc' }));
    check('a loopback form on a public page is neither pointed at this computer nor inserted',
      !page.passed.some((p) => /^setAttribute FORM|^append FORM/.test(p)), page.passed.join(' | '));
    const img = { tagName: 'IMG', nodeType: 1, getAttribute: () => null, removeAttribute() {}, remove() {} };
    w.Element.prototype.setAttribute.call(img, 'src', 'http://192.168.1.1/status.gif');
    w.Node.prototype.appendChild.call({}, Object.assign({}, img, { src: 'http://192.168.1.1/status.gif' }));
    check('a router-probe image is neither pointed at the router nor inserted',
      !page.passed.some((p) => /^setAttribute IMG|^append IMG/.test(p)), page.passed.join(' | '));

    await w.fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-X');
    const seen = page.events.find((e) => e.type === 'detected_thirdparty_tracker');
    check('the tracker learner records a third-party tracker call',
      !!seen && seen.detail.domain === 'google-analytics.com', JSON.stringify(seen));
    await w.fetch('https://example.com/collect');
    check('but not the page talking to itself',
      page.events.filter((e) => e.type === 'detected_thirdparty_tracker').length === 1);

    const failed = page.events.filter((e) => /_failed$/.test(e.type));
    const leaked = failed.filter((e) => {
      const m = /ReferenceError: ([\w$]+) is not defined/.exec(String(e.detail.error || ''));
      return m && shipped && shipped.declared.has(m[1]);
    });
    check('no guard switched itself off over a name the engine declares',
      leaked.length === 0, leaked.map((e) => e.type + ': ' + e.detail.error).join('; '));
    check('Intranet Guard, Risky-site Mode and the tracker learner all started',
      !failed.some((e) => /^(intranet_guard|risky_site_mode|tracker_learner)_failed$/.test(e.type)),
      failed.map((e) => e.type + ': ' + e.detail.error).join('; '));
  }

  {
    /* The trust comes from the page's own host, which the page cannot choose. */
    const page = boot('https://login.microsoft.com/common/oauth2/v2.0/authorize');
    const { w } = page;
    new w.HTMLFormElement('https://localhost:5001/signin-oidc', ['code', 'state', 'id_token']).submit();
    new w.HTMLFormElement('http://127.0.0.1:8080/saml/acs', ['SAMLResponse', 'RelayState']).requestSubmit();
    check('a listed sign-in provider can post its response to an app on this computer',
      page.passed.includes('submit https://localhost:5001/signin-oidc')
        && page.passed.includes('requestSubmit http://127.0.0.1:8080/saml/acs'), page.passed.join(' | '));
    const form = { tagName: 'FORM', nodeType: 1, getAttribute: () => null, removeAttribute() {} };
    w.Element.prototype.setAttribute.call(form, 'action', 'https://localhost:5001/signin-oidc');
    check('and its callback form keeps its action',
      page.passed.includes('setAttribute FORM action=https://localhost:5001/signin-oidc'), page.passed.join(' | '));
    new w.HTMLFormElement('http://192.168.1.1/apply.cgi', ['code', 'state']).submit();
    check('but not to the router: the exemption is loopback only',
      !page.passed.some((p) => /192\.168\.1\.1/.test(p)), page.passed.join(' | '));
  }

  for (const href of ['https://login.microsoftonline.com.evil.example.com/', 'https://evil-login.live.com.example.net/']) {
    const page = boot(href);
    new page.w.HTMLFormElement('https://localhost:5001/signin-oidc', ['code', 'state', 'id_token']).submit();
    check(new URL(href).hostname + ': a lookalike host is not a sign-in provider',
      !page.passed.some((p) => /localhost/.test(p)), page.passed.join(' | '));
  }

  {
    /* The engine's list and the network rules' exemption must name the same providers. */
    const BG = read('background.js');
    const listed = (src, from) => {
      const at = src.indexOf('[', src.indexOf(from));
      return src.indexOf(from) < 0 ? [] : (src.slice(at, src.indexOf(']', at)).match(/"[^"]+"|'[^']+'/g) || []).map((s) => s.slice(1, -1));
    };
    const engine = listed(MIN, 'signInCallbackPage=');
    const rules = listed(BG, 'const SIGN_IN_CALLBACK_PROVIDERS = [');
    check('the engine and the network rules trust the same sign-in providers',
      engine.length > 0 && engine.join(',') === rules.join(','), engine.join(',') + ' vs ' + rules.join(','));
  }

  for (const href of ['http://192.168.1.1/', 'http://localhost:3000/', 'http://router.local/']) {
    const page = boot(href);
    const { w, outcome } = page;
    check(href + ' is not treated as a public page: its own LAN calls go through',
      (await outcome(() => w.fetch(href + 'api/status'))) === 'allowed'
        && (await outcome(() => new w.Worker('http://127.0.0.1:9/x.js'))) === 'allowed'
        && (await outcome(() => new w.WebSocket('ws://192.168.1.20/cam'))) === 'allowed'
        && !page.types().includes('blocked_intranet_probe'), page.types().join(','));
    check(href + ': Risky-site Mode stays out of it', !page.types().some((t) => /^risky_site_mode/.test(t)));
  }

  {
    /* .xyz is on Risky-site Mode's list, so this host is the one it exists for. */
    const page = boot('https://app.example.xyz/');
    const { w, outcome } = page;
    check('risky host: Risky-site Mode is active', page.types().includes('risky_site_mode_active'), page.types().join(','));
    check('risky host: a third-party call is refused',
      (await outcome(() => w.fetch('https://cdn.unknown-tracker.net/x.js'))) === RISKY);
    check('risky host: a sibling subdomain of the same site is not a third party',
      (await outcome(() => w.fetch('https://api.example.xyz/v1'))) === 'allowed');
    check('risky host: the trusted CDNs still load',
      (await outcome(() => w.fetch('https://cdnjs.cloudflare.com/ajax/libs/x.js'))) === 'allowed');
  }

  for (const [href, media, worker] of [
    ['https://www.youtube.com/watch?v=x', 'https://rr1---sn-ab5l6nzr.googlevideo.com/videoplayback?id=1', 'blob:https://www.youtube.com/1'],
    ['https://www.twitch.tv/somechannel', 'https://video-weaver.fra05.hls.ttvnw.net/v1/playlist/x.m3u8', 'blob:https://www.twitch.tv/2'],
  ]) {
    const page = boot(href);
    const { w, outcome } = page;
    check(new URL(href).hostname + ': player requests and its blob worker are untouched',
      (await outcome(() => w.fetch(media))) === 'allowed'
        && (await outcome(() => new w.Worker(worker))) === 'allowed'
        && !page.types().some((t) => /^risky_site_mode|^blocked_intranet_probe$/.test(t)), page.types().join(','));
  }

  console.log('');
  if (failures) {
    console.error('[fail] engine block scope: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] engine block scope tests passed');
})().catch((e) => {
  console.error('[fail] engine block scope: ' + (e && e.stack || e));
  process.exit(1);
});

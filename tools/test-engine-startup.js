/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * The overlay cleaner's `cleanerMonitoring` flag was declared inside a 31,000-character
 * comma-separated `const` chain, and start() assigns to it. That is a TypeError, thrown on the
 * first ordinary page load, because removeOverlays is on by default and the gate exempts only a
 * handful of hosts. Start-up aborted after some prototype patches were live but before the ready
 * version was published -- so the extension looked installed while a large part of it was not
 * running, and Repair could not certify the tab.
 *
 * The guard that actually catches a regression here is the STATIC one: the declaration must be a
 * `let` and must not be back inside a const chain. That was verified by reverting the fix -- the
 * static checks fail, and they are the reason this file exists.
 *
 * The run-the-engine check below is weaker than it looks, and the comment says so deliberately.
 * The stub page never supplies a config, so WO.removeOverlays is unset, the cleaner gate is never
 * taken and start() is never called -- meaning this check did NOT fail when the bug was put back.
 * It is still worth keeping: it proves the shipped bundle evaluates end to end without a
 * top-level assignment-to-constant, which is a real class of failure. It is not proof that the
 * cleaner path is sound. Driving the config far enough to reach start() would make it so, and is
 * the obvious next improvement.
 *
 * Run with:
 *   node tools/test-engine-startup.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// ---------------------------------------------------------------------------
// 1. The declaration is mutable, and is not back inside the const chain.
// ---------------------------------------------------------------------------
for (const [label, text] of [['source', SRC], ['shipped build', MIN]]) {
  check(label + ': cleanerMonitoring is declared with let',
    /let cleanerMonitoring=!1/.test(text));
  check(label + ': it is not part of a const chain',
    !/const [^;]{0,40000}?cleanerMonitoring=!1,/.test(text));
}
check('it is still actually assigned (the flag is in use)',
  (MIN.match(/cleanerMonitoring=!/g) || []).length >= 3,
  (MIN.match(/cleanerMonitoring=!/g) || []).length + ' occurrences');

// ---------------------------------------------------------------------------
// 2. Run the shipped engine. A stub page cannot carry it to completion, so the
//    assertion is narrow and honest: no assignment-to-constant error escapes.
// ---------------------------------------------------------------------------
function runEngine() {
  const noop = () => {};
  const el = () => ({
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '', getPropertyPriority: () => '' },
    setAttribute: noop, getAttribute: () => null, hasAttribute: () => false, removeAttribute: noop,
    appendChild: (c) => c, removeChild: noop, remove: noop, insertBefore: (c) => c,
    addEventListener: noop, removeEventListener: noop, attachShadow: () => el(),
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    matches: () => false, contains: () => false, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    getRootNode() { return this; }, isConnected: true, children: [], childNodes: [],
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    dataset: {}, textContent: '', innerText: '', innerHTML: '', value: '', tagName: 'DIV',
    nodeType: 1, id: '', className: '', parentNode: null, parentElement: null, options: [],
  });

  const doc = el();
  Object.assign(doc, {
    readyState: 'complete', documentElement: el(), head: el(), body: el(),
    createElement: () => el(), createElementNS: () => el(), createTextNode: () => el(),
    getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
    createTreeWalker: () => ({ nextNode: () => null }), currentScript: null,
    cookie: '', title: '', referrer: '', location: null, hidden: false, visibilityState: 'visible',
    dispatchEvent: () => true, createEvent: () => el(), adoptedStyleSheets: [],
  });

  const sandbox = {
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    document: doc,
    location: new URL('https://example.com/'),
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
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    requestIdleCallback: () => 0, cancelIdleCallback: noop,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    PerformanceObserver: class { observe() {} disconnect() {} },
    AbortController, AbortSignal, EventTarget, Event, CustomEvent: Event,
    fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} },
    WebSocket: class { addEventListener() {} close() {} send() {} },
    RTCPeerConnection: class { createDataChannel() {} createOffer() { return Promise.resolve({}); } addEventListener() {} close() {} },
    Worker: class { addEventListener() {} postMessage() {} terminate() {} },
    URL, URLSearchParams, Blob: class {}, FileReader: class {}, FormData: class {},
    Image: class { addEventListener() {} }, Audio: class { addEventListener() {} },
    HTMLMediaElement: class {}, HTMLCanvasElement: class {}, HTMLIFrameElement: class {},
    HTMLElement: class {}, Element: class {}, Node: class {}, Document: class {},
    CanvasRenderingContext2D: class {}, WebGLRenderingContext: class {}, WebGL2RenderingContext: class {},
    AudioContext: class {}, OfflineAudioContext: class {}, SpeechSynthesis: class {},
    Notification: class {}, PushManager: class {}, ServiceWorkerContainer: class {},
    IntlDateTimeFormat: null, crypto: { getRandomValues: (a) => a, randomUUID: () => 'x', subtle: {} },
    atob: (s) => s, btoa: (s) => s, matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    open: noop, close: noop, postMessage: noop, addEventListener: noop, removeEventListener: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '', position: 'static', zIndex: 'auto', display: 'block', visibility: 'visible', opacity: '1' }),
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, isSecureContext: true,
    origin: 'https://example.com', name: '', frameElement: null, parent: null, top: null, self: null,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
    Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, Intl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  doc.location = sandbox.location;

  vm.createContext(sandbox);
  let error = null;
  try {
    vm.runInContext(MIN, sandbox, { filename: 'content.min.js', timeout: 15000 });
  } catch (e) {
    error = e;
  }
  return { error, sandbox };
}

const { error } = runEngine();

const isConstWrite = !!error
  && /Assignment to constant variable/i.test(String(error && error.message));

check('the shipped engine does not throw "Assignment to constant variable"',
  !isConstWrite, error ? String(error.message).slice(0, 140) : '');

if (error && !isConstWrite) {
  // Not a failure. A stub page cannot satisfy the whole engine, and saying so is more honest
  // than pretending this harness is a browser.
  console.log('  [info] engine stopped on unrelated stub-page limitation: '
    + String(error.message).slice(0, 100));
} else if (!error) {
  console.log('  [info] the engine ran to completion in the stub page');
}

// ---------------------------------------------------------------------------
// 3. Prove the test can still fail: the old shape must be rejected.
// ---------------------------------------------------------------------------
{
  let threw = '';
  try {
    vm.runInNewContext('const a=1,flag=!1,start=()=>{if(flag)return;flag=!0;};start();');
  } catch (e) {
    threw = String(e.message);
  }
  check('a const-chain flag assigned by a helper still throws (the bug shape)',
    /Assignment to constant variable/i.test(threw), threw || 'did not throw');
}

if (failures) {
  console.error('[fail] engine start-up tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] engine start-up tests passed');

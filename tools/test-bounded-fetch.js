/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Outbound requests stay bounded (L17).
 *
 * Two paths did not use the hardening the rest of the project does. The site-breach lookup had no
 * abort timeout and called res.json() with no ceiling -- and the popup disables its button until
 * that callback arrives, so a server that accepts a connection and never answers left the control
 * dead for as long as the socket lived. The cryptominer worker scanner called r.text() and only
 * then sliced to MAX_SOURCE_BYTES: the declared limit bounded what was MATCHED, never what was
 * held in memory.
 *
 * Run: node tools/test-bounded-fetch.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const DETECT = fs.readFileSync(path.join(ROOT, 'cryptominer-detect.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

process.exitCode = 1;

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function liftBetween(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  const to = source.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to <= from) throw new Error('markers not found: ' + startMarker);
  return source.slice(from, to + endMarker.length);
}
// Handles both files' shapes: top-level `async function` in background.js and indented
// `function` inside the detector's IIFE. The closing brace is the one at the same indent.
function liftFunction(source, name) {
  const m = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\(', 'm'));
  if (!m) throw new Error('function not found: ' + name);
  const indent = m[1];
  const end = source.indexOf('\n' + indent + '}\n', m.index);
  if (end < 0) throw new Error('function end not found: ' + name);
  return source.slice(m.index, end + indent.length + 3);
}

// A body that streams in chunks, so a cap can be observed stopping it rather than inferred.
function streamingBody(totalBytes, chunkBytes) {
  let sent = 0;
  let cancelled = false;
  return {
    cancelled: () => cancelled,
    body: {
      getReader() {
        return {
          read() {
            if (cancelled || sent >= totalBytes) return Promise.resolve({ done: true });
            const size = Math.min(chunkBytes, totalBytes - sent);
            sent += size;
            return Promise.resolve({ done: false, value: Buffer.alloc(size, 0x61) });
          },
          cancel() { cancelled = true; },
          releaseLock() {},
        };
      },
    },
    read: () => sent,
  };
}

// ---------------------------------------------------------------------------
// 1. The site-breach lookup.
// ---------------------------------------------------------------------------
function loadSiteBreach(options = {}) {
  const state = { responses: [], aborted: false, fetchOptions: null };
  const sandbox = {
    console, Date, Object, Array, String, Number, Math, JSON, Promise, Error, URL,
    encodeURIComponent,
    TextDecoder, TextEncoder,
    // The timer is real, just short when the test wants it to win the race. Firing it
    // synchronously would abort before fetch had even been called, which is not the shape of the
    // thing being tested.
    setTimeout: (fn, ms) => { state.timerMs = ms; return setTimeout(fn, options.fireTimer ? 0 : 100000); },
    clearTimeout: (id) => clearTimeout(id),
    AbortController: class {
      constructor() { this.signal = { aborted: false, listeners: [], addEventListener(_t, cb) { this.listeners.push(cb); } }; }
      abort() {
        state.aborted = true;
        this.signal.aborted = true;
        this.signal.listeners.forEach((cb) => { try { cb(); } catch (_) {} });
      }
    },
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
    isLocalOrPrivateHost: (h) => h === 'localhost',
    localGet: async () => ({}),
    localSet: async () => {},
    readResponseTextWithByteLimit: null,   // the real one, lifted below
    fetch: options.fetch,
  };
  vm.createContext(sandbox);
  vm.runInContext([
    liftFunction(BACKGROUND, 'utf8ByteLength'),
    liftFunction(BACKGROUND, 'readResponseTextWithByteLimit'),
    'const SITE_BREACH_TIMEOUT_MS = ' + (BACKGROUND.match(/SITE_BREACH_TIMEOUT_MS = (\d+)/) || [])[1] + ';',
    'const SITE_BREACH_MAX_BYTES = ' + (BACKGROUND.match(/SITE_BREACH_MAX_BYTES = ([^;]+);/) || [])[1] + ';',
    'function handleSiteBreach(msg, sendResponse) {',
    liftBetween(BACKGROUND, "  if (msg && msg.kind === 'site-breach' && msg.domain) {", 'return true; // async'),
    '  }',   // closes the router's `if`, which the lift deliberately starts inside
    '}',
  ].join('\n') + '\nthis.__handle = handleSiteBreach;', sandbox, { filename: 'background.js' });
  state.run = (msg) => new Promise((resolve) => {
    sandbox.__handle(msg, (r) => { state.responses.push(r); resolve(r); });
  });
  return state;
}

const okResponse = (bodyText) => ({
  ok: true,
  status: 200,
  headers: { get: () => String(bodyText.length) },
  text: async () => bodyText,
});

async function testSiteBreach() {
  const msg = { kind: 'site-breach', domain: 'example.com' };

  // A server that accepts and never answers must still settle, so the popup button re-enables.
  {
    const s = loadSiteBreach({
      fireTimer: true,
      // Never resolves on its own; only the abort ends it, exactly as a real fetch would.
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        const signal = init && init.signal;
        if (signal && signal.addEventListener) {
          signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      }),
    });
    const r = await s.run(msg);
    check('a never-answering server times out rather than hanging', r && r.ok === false);
    check('and says it was a timeout, not a network failure', r.error === 'timeout', JSON.stringify(r));
    check('the request carried an abort signal', s.aborted === true);
  }

  // Every non-2xx must be reported, never treated as "no breaches".
  for (const status of [429, 503, 404, 500]) {
    const s = loadSiteBreach({ fetch: async () => ({ ok: false, status, headers: { get: () => '0' } }) });
    const r = await s.run(msg);
    check('HTTP ' + status + ' is reported, not classified as clean',
      r && r.ok === false && r.status === status, JSON.stringify(r));
  }

  // Malformed JSON is not a clean result either.
  {
    const s = loadSiteBreach({ fetch: async () => okResponse('<html>not json</html>') });
    const r = await s.run(msg);
    check('a malformed body is an error, not an empty breach list',
      r && r.ok === false && r.error === 'bad response', JSON.stringify(r));
  }

  // A body past the cap is refused rather than buffered.
  {
    const huge = streamingBody(2 * 1024 * 1024, 64 * 1024);
    const s = loadSiteBreach({
      fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, body: huge.body }),
    });
    const r = await s.run(msg);
    check('an oversized body is refused', r && r.ok === false && r.error === 'too_large', JSON.stringify(r));
    check('and the read was cancelled rather than drained', huge.cancelled() === true);
    check('less than the whole body was read', huge.read() <= 512 * 1024 + 64 * 1024, huge.read() + ' bytes');
  }

  // A declared content-length past the cap is refused before a byte is read.
  {
    const s = loadSiteBreach({
      fetch: async () => ({ ok: true, status: 200, headers: { get: () => String(9 * 1024 * 1024) }, text: async () => '[]' }),
    });
    const r = await s.run(msg);
    check('an oversized content-length is refused up front', r && r.error === 'too_large');
  }

  // And the normal path still works.
  {
    const body = JSON.stringify([
      { Title: 'Old', BreachDate: '2015-01-01', PwnCount: 5, DataClasses: ['Emails'] },
      { Title: 'New', BreachDate: '2021-06-01', PwnCount: 9, DataClasses: ['Emails', 'Passwords'] },
    ]);
    const s = loadSiteBreach({ fetch: async () => okResponse(body) });
    const r = await s.run(msg);
    check('a valid response is still parsed', r && r.ok === true && r.breaches.length === 2);
    check('and still sorted newest first', r.breaches[0].name === 'New', JSON.stringify(r.breaches));
  }

  check('the popup tells the user when it was a timeout rather than a reachability problem',
    /res\.error === 'timeout'/.test(POPUP) && /took too long to answer/.test(POPUP));
  check('and it re-enables the button before doing anything else',
    /btn\.disabled = false;[\s\S]{0,80}if \(!res \|\| !res\.ok\)/.test(POPUP));
}

// ---------------------------------------------------------------------------
// 2. The worker-source read.
// ---------------------------------------------------------------------------
function loadWorkerScan(options = {}) {
  const state = { fetches: [], found: [], killed: 0 };
  const cap = Number((DETECT.match(/MAX_SOURCE_BYTES = (\d+)/) || [])[1]);
  const sandbox = {
    console, Object, String, Number, Math, Promise, Error, URL, RegExp, Date,
    TextDecoder,
    setTimeout, clearTimeout,
    AbortController: class { constructor() { this.signal = {}; } abort() { state.aborted = true; } },
    woTimeout: (fn, ms) => setTimeout(fn, ms),
    location: { origin: 'https://miner.example', href: 'https://miner.example/' },
    MAX_SOURCE_BYTES: cap,
    MINER_TELLS: /cryptonight|randomx|coinhive/i,
    minerSources: Object.create(null),
    sourceReadsInFlight: Object.create(null),
    SOURCE_READ_TIMEOUT_MS: 50,
    scanned: 0,
    scanBudget: 100,
    killWorker: () => { state.killed++; },
    onMinerFound: (url, tell) => { state.found.push({ url, tell }); },
    fetch: (href, init) => {
      state.fetches.push(href);
      return options.fetch(href, init);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext([liftFunction(DETECT, 'readCapped'), liftFunction(DETECT, 'scanWorkerSource')].join('\n')
    + '\nthis.__api = { scanWorkerSource, readCapped };', sandbox, { filename: 'cryptominer-detect.js' });
  state.api = sandbox.__api;
  state.cap = cap;
  return state;
}

const settle = () => new Promise((r) => setTimeout(r, 15));

async function testWorkerSourceRead() {
  const cap = Number((DETECT.match(/MAX_SOURCE_BYTES = (\d+)/) || [])[1]);
  check('the declared source cap is still findable', cap > 0);

  // The whole point: stop reading at the cap instead of buffering and slicing.
  {
    const stream = streamingBody(cap * 4, 64 * 1024);
    const s = loadWorkerScan({ fetch: async () => ({ ok: true, status: 200, body: stream.body }) });
    const text = await s.api.readCapped({ ok: true, body: stream.body });
    check('a body past the cap stops at the cap', text.length === cap, text.length + ' vs ' + cap);
    check('and the read is cancelled rather than drained', stream.cancelled() === true);
    check('so buffering never reaches the whole body', stream.read() <= cap + 64 * 1024,
      stream.read() + ' bytes read of ' + cap * 4);
  }

  // Matching semantics are unchanged: a tell inside the first cap bytes is still found.
  {
    const body = 'x'.repeat(1000) + 'cryptonight' + 'y'.repeat(1000);
    const s = loadWorkerScan({ fetch: async () => ({ ok: true, status: 200, text: async () => body }) });
    s.api.scanWorkerSource('https://miner.example/w.js', {});
    await settle();
    check('a miner tell in the source is still found', s.found.length === 1, JSON.stringify(s.found));
  }

  // ...and the scan path actually goes through the capped reader, rather than the reader merely
  // existing beside a call site that still buffers the whole body.
  {
    const stream = streamingBody(cap * 3, 64 * 1024);
    const s = loadWorkerScan({ fetch: async () => ({ ok: true, status: 200, body: stream.body }) });
    s.api.scanWorkerSource('https://miner.example/huge.js', {});
    await settle();
    await settle();
    check('scanning an oversized worker source cancels the read at the cap',
      stream.cancelled() === true && stream.read() <= cap + 64 * 1024,
      stream.read() + ' bytes read, cancelled=' + stream.cancelled());
  }

  // An error page is not worker source.
  {
    const s = loadWorkerScan({ fetch: async () => ({ ok: false, status: 404, text: async () => 'coinhive not found' }) });
    s.api.scanWorkerSource('https://miner.example/missing.js', {});
    await settle();
    check('a non-2xx body is never matched against', s.found.length === 0, JSON.stringify(s.found));
  }

  // The same URL twice is one read.
  {
    const s = loadWorkerScan({ fetch: () => new Promise(() => {}) });
    s.api.scanWorkerSource('https://miner.example/same.js', {});
    s.api.scanWorkerSource('https://miner.example/same.js', {});
    s.api.scanWorkerSource('https://miner.example/same.js', {});
    await settle();
    check('a repeated worker URL is read once while in flight', s.fetches.length === 1,
      s.fetches.length + ' fetches');
  }

  // A read that never answers is aborted, and its slot is freed so a later one can try.
  {
    const s = loadWorkerScan({ fetch: (href, init) => new Promise((_r, reject) => { s.reject = reject; if (init && init.signal) s.signal = init.signal; }) });
    s.api.scanWorkerSource('https://miner.example/slow.js', {});
    await settle();
    check('the read carries an abort signal', !!s.signal);
    s.reject(new Error('aborted'));
    await settle();
    s.api.scanWorkerSource('https://miner.example/slow.js', {});
    await settle();
    check('a failed read frees its slot rather than blocking that URL forever',
      s.fetches.length === 2, s.fetches.length + ' fetches');
  }

  check('the cap is applied while reading, not after buffering',
    !/\.text\(\)\.then\(function \(src\) \{[\s\S]{0,120}slice\(0, MAX_SOURCE_BYTES\)/.test(DETECT)
      && /function readCapped\(res\)/.test(DETECT));
}

async function main() {
  await testSiteBreach();
  await testWorkerSourceRead();

  if (failed) { console.error('\n' + failed + ' bounded-fetch check(s) failed'); process.exit(1); }
  console.log('\noutbound requests stay bounded');
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

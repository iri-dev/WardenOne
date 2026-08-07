/*
 * Deep cryptominer detection (toggle: cryptominerCpuWatch, OFF by default).
 *
 * The network guard (blockCryptominers) stops miners that fetch a payload from a
 * mining service or phone a pool. It cannot see a miner a site hosts on its own
 * origin and proxies through its own backend. This is the layer for that case.
 * It WARNS. It never terminates a worker or blocks anything.
 *
 * How it decides: it reads the source of the workers a page starts and looks for
 * mining code. A miner has to run its hashing loop somewhere, and on the web that
 * means a Worker whose script contains recognisable mining vocabulary.
 *
 * ---------------------------------------------------------------------------
 * Why there is no CPU measurement here, having tried it.
 *
 * The obvious design is "notice a worker on every core, then confirm the CPU is
 * pegged". Measured on a 12-core machine against a spinning worker per core:
 *
 *   main-thread benchmark         1.03-1.21x slower   -- the scheduler keeps the
 *                                                        main thread on its own
 *                                                        core, so an all-core
 *                                                        miner is nearly invisible
 *   probe worker, clean baseline  1.63x slower        -- usable, BUT the baseline
 *                                                        has to be taken before the
 *                                                        miner starts, and by the
 *                                                        time a fleet is worth
 *                                                        investigating it already has
 *   worker-vs-main ratio          1.21x separation    -- baseline-free, but too
 *                                                        close to noise to threshold
 *
 * Every variant either cannot fire or fires on anything busy. And even at its
 * best it could only say "something is using your CPU", which is equally true of
 * a video export, a WASM build, or a game. So load is not measured, and the word
 * cryptominer is only used when the code says so.
 * ---------------------------------------------------------------------------
 *
 * Known limits, stated rather than hidden:
 *   - Top frame only.
 *   - Cross-origin worker scripts cannot be read, so they are never scanned. The
 *     network layer is what covers those.
 *   - An obfuscated or pure-WASM miner with no recognisable strings is not caught.
 *     This narrows the gap the network layer leaves; it does not close it.
 */
(function () {
  'use strict';
  if (window.__wardenOneMinerWatch) return;
  window.__wardenOneMinerWatch = true;
  if (window.top !== window) return;

  var TOKEN = null;
  try {
    window.addEventListener('message', function (e) {
      if (!TOKEN && e.source === window && e.data
        && e.data.source === 'wardenone-handshake' && e.data.token) {
        TOKEN = e.data.token;
      }
    });
  } catch (_) {}
  /* The bridge posts the handshake once at document_start; a dynamically
     registered script can miss it, so ask for a replay. */
  try { if (typeof window.__wardenOneBridgeReplay === 'function') window.__wardenOneBridgeReplay(); } catch (_) {}

  /* Vocabulary that does not turn up in ordinary code by accident. Deliberately
     no bare "nonce" (CSP), "scrypt" or "argon2" (password hashing), or "worker" --
     those are legitimate elsewhere and would make this a false-positive machine. */
  var MINER_TELLS = /cryptonight|randomx|hashesPerSecond|hashrate|totalhashes|stratum\+tcp|coinhive|authedmine|cryptoloot|crypto-loot|webminepool|jsecoin|deepminer|coinimp|minero\.cc|throttleMiner|CryptonightWASMWrapper/i;

  var MAX_SCANS = 8;          /* never scan a page to death */
  var MAX_SOURCE_BYTES = 800000;

  var scanned = 0;
  var reported = false;
  var liveWorkers = 0;
  var peakWorkers = 0;
  var wasmSeen = false;

  function report(tell) {
    if (reported) return;
    reported = true;
    try {
      document.dispatchEvent(new CustomEvent('wo-event', {
        detail: {
          token: TOKEN,
          type: 'detected_cryptominer',
          detail: {
            host: location.hostname,
            workers: peakWorkers,
            cores: Number(navigator.hardwareConcurrency) || 0,
            tell: String(tell || 'mining code').slice(0, 40),
            wasm: wasmSeen,
            why: 'a background worker on this page is running mining code',
          },
        },
      }));
    } catch (_) {}
  }

  function scanWorkerSource(url) {
    if (reported || scanned >= MAX_SCANS) return;
    var href = String(url || '');
    if (!href) return;
    if (!/^blob:/i.test(href)) {
      /* Only same-origin scripts are readable. Anything else is the network
         layer's job, and fetching it would be a request the page never made. */
      try {
        var u = new URL(href, location.href);
        if (u.origin !== location.origin) return;
        if (!/^https?:$/.test(u.protocol)) return;
      } catch (_) { return; }
    }
    scanned++;
    try {
      /* same-origin or blob: only, so this is served from cache or memory and
         does not put a new request on the wire for a third party. */
      fetch(href).then(function (r) { return r.text(); }).then(function (src) {
        if (reported || typeof src !== 'string') return;
        var m = src.slice(0, MAX_SOURCE_BYTES).match(MINER_TELLS);
        if (m) report(m[0]);
      }).catch(function () {});
    } catch (_) {}
  }

  try {
    var NativeWorker = window.Worker;
    if (typeof NativeWorker === 'function') {
      var Wrapped = function (url, opts) {
        var w = new NativeWorker(url, opts);
        liveWorkers++;
        if (liveWorkers > peakWorkers) peakWorkers = liveWorkers;
        scanWorkerSource(url);
        var done = false;
        var drop = function () {
          if (done) return;
          done = true;
          liveWorkers = Math.max(0, liveWorkers - 1);
        };
        try {
          var nativeTerminate = w.terminate;
          w.terminate = function () { drop(); return nativeTerminate.apply(this, arguments); };
        } catch (_) {}
        try { w.addEventListener('error', drop); } catch (_) {}
        return w;
      };
      Wrapped.prototype = NativeWorker.prototype;
      try { Object.defineProperty(Wrapped, 'name', { value: 'Worker', configurable: true }); } catch (_) {}
      /* Match the cloaking the rest of the extension uses: a page that
         stringifies Worker must not see a wrapper. */
      try {
        var nativeToString = Function.prototype.toString;
        Wrapped.toString = function () { return nativeToString.call(NativeWorker); };
      } catch (_) {}
      window.Worker = Wrapped;
    }
  } catch (_) {}

  /* Recorded for context in the report only. WebAssembly on its own means
     nothing -- every serious web app uses it. */
  try {
    var WA = window.WebAssembly;
    if (WA) {
      var mark = function (fn) {
        if (typeof fn !== 'function') return fn;
        return function () { wasmSeen = true; return fn.apply(this, arguments); };
      };
      if (WA.instantiate) WA.instantiate = mark(WA.instantiate);
      if (WA.compile) WA.compile = mark(WA.compile);
      if (WA.instantiateStreaming) WA.instantiateStreaming = mark(WA.instantiateStreaming);
      if (WA.compileStreaming) WA.compileStreaming = mark(WA.compileStreaming);
    }
  } catch (_) {}
})();

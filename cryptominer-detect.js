/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Deep cryptominer detection (toggle: cryptominerCpuWatch, OFF by default).
 *
 * The network guard (blockCryptominers) stops miners that fetch a payload from a
 * mining service or phone a pool. It cannot see a miner a site hosts on its own
 * origin and proxies through its own backend. This is the layer for that case.
 *
 * How it decides: it reads the source of the workers a page starts and looks for
 * mining code. A miner has to run its hashing loop somewhere, and on the web that
 * means a Worker whose script contains recognisable mining vocabulary.
 *
 * What it does about it: terminates that worker, and keeps terminating the ones
 * the miner starts to replace it. Detection alone would just be a notification
 * that your battery is being spent. Because this DOES act, it acts only on the
 * evidence it can actually stand behind -- a worker whose own code contains
 * mining routines -- and it never acts on an allowlisted site.
 *
 * The surgical part matters: only workers whose source matched are terminated.
 * A mining page that also runs a legitimate worker keeps the legitimate one.
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
  const WO_GUARD_VERSION = '1.0.0';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOneMinerWatch === WO_GUARD_VERSION) return;
  if (window.__wardenOneMinerWatch) {
    try {
      if (typeof window.__wardenOneMinerWatchDispose === 'function') window.__wardenOneMinerWatchDispose();
    } catch (_) {}
  }
  window.__wardenOneMinerWatch = WO_GUARD_VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  window.__wardenOneMinerWatchDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
  };
  if (window.top !== window) return;

  var TOKEN = null;
  var siteAllowlisted = false;
  var masterOff = false;
  var configReady = false;
  var pending = [];
  var HOST = String(location.hostname || '').replace(/^www\./, '').toLowerCase();

  try {
    woOn(window, 'message', function (e) {
      if (e.source !== window || !e.data) return;
      if (!TOKEN && e.data.source === 'wardenone-handshake' && e.data.token) {
        TOKEN = e.data.token;
        return;
      }
      /* The bridge hands the main world the same sanitized config content.js
         gets. We only need two things from it: whether the user switched
         WardenOne off, and whether they allowlisted this site. An allowlisted
         site is never acted on -- that is the escape hatch for a false positive
         and for anyone who genuinely wants a page to mine. */
      if (e.data.source === 'wardenone' && e.data.kind === 'config'
        && e.data.token === TOKEN && e.data.overrides) {
        var o = e.data.overrides;
        masterOff = o.enabled === false;
        var list = Array.isArray(o.allowlist) ? o.allowlist : [];
        siteAllowlisted = list.some(function (h) {
          h = String(h || '').replace(/^www\./, '').toLowerCase();
          return h && (HOST === h || HOST.endsWith('.' + h));
        });
        configReady = true;
        flushPending();
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

  var SCAN_BUDGET = 8;        /* never scan an ordinary page to death */
  var SCAN_BUDGET_CONFIRMED = 250;
  var MAX_SOURCE_BYTES = 800000;

  var scanned = 0;
  var scanBudget = SCAN_BUDGET;
  var reported = false;
  var confirmed = false;
  var liveWorkers = 0;
  var peakWorkers = 0;
  var wasmSeen = false;
  var stoppedCount = 0;
  var firstTell = '';
  var minerSources = Object.create(null);  /* url -> true, for respawn */
  var liveByUrl = Object.create(null);     /* url -> [worker] */

  function trackWorker(url, w) {
    var list = liveByUrl[url] || (liveByUrl[url] = []);
    list.push(w);
  }
  function untrackWorker(url, w) {
    var list = liveByUrl[url];
    if (!list) return;
    var i = list.indexOf(w);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete liveByUrl[url];
  }

  function killWorker(w) {
    try {
      /* the native terminate, captured before the page could replace it */
      if (w && typeof w.__woNativeTerminate === 'function') w.__woNativeTerminate();
      else if (w && typeof w.terminate === 'function') w.terminate();
      stoppedCount++;
      return true;
    } catch (_) { return false; }
  }

  function announce(type, tell) {
    try {
      document.dispatchEvent(new CustomEvent('wo-event', {
        detail: {
          token: TOKEN,
          type: type,
          detail: {
            host: location.hostname,
            workers: peakWorkers,
            stopped: stoppedCount,
            cores: Number(navigator.hardwareConcurrency) || 0,
            tell: String(tell || 'mining code').slice(0, 40),
            wasm: wasmSeen,
            why: type === 'blocked_cryptominer'
              ? 'a background worker was running mining code and was stopped'
              : 'a background worker is running mining code (site is allowlisted, left alone)',
          },
        },
      }));
    } catch (_) {}
  }

  /* Nothing may be terminated before the bridge has told us whether the user
     allowlisted this site. A blob: worker's source resolves from memory, which
     is routinely faster than the config message (the bridge has to read storage
     first), so acting on arrival would kill workers on allowlisted sites. Hold
     findings until the answer is in; a miner running a few hundred ms longer is
     a far better failure than breaking a site the user asked us to leave alone. */
  function flushPending() {
    if (!configReady) return;
    var queue = pending;
    pending = [];
    for (var i = 0; i < queue.length; i++) onMinerFound(queue[i].url, queue[i].tell);
  }

  /* Called when a worker's source is confirmed to contain mining code. */
  function onMinerFound(url, tell) {
    if (!firstTell) firstTell = tell;

    if (!configReady) {
      pending.push({ url: url, tell: tell });
      /* The handshake may have been posted before this script was injected;
         ask the bridge to send both again. */
      try { if (typeof window.__wardenOneBridgeReplay === 'function') window.__wardenOneBridgeReplay(); } catch (_) {}
      return;
    }

    if (masterOff || siteAllowlisted) {
      /* Never act on a site the user allowlisted. Say so once and stop there. */
      if (!reported) { reported = true; announce('detected_cryptominer', tell); }
      return;
    }

    minerSources[url] = true;
    if (!confirmed) {
      confirmed = true;
      /* The page is now known hostile, so keep scanning its replacements. A
         miner that respawns behind a fresh blob: URL each time would otherwise
         walk straight past the ordinary-page scan budget. */
      scanBudget = SCAN_BUDGET_CONFIRMED;
    }

    var list = (liveByUrl[url] || []).slice();
    for (var i = 0; i < list.length; i++) killWorker(list[i]);

    if (!reported) { reported = true; announce('blocked_cryptominer', tell); }
  }

  function scanWorkerSource(url, w) {
    var href = String(url || '');
    if (!href) return;
    /* A source already known to be a miner needs no second look -- kill on sight.
       This is the respawn path and it is synchronous, so the replacement worker
       gets no run time at all. */
    if (minerSources[href]) { killWorker(w); return; }
    if (scanned >= scanBudget) return;
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
        if (typeof src !== 'string') return;
        var m = src.slice(0, MAX_SOURCE_BYTES).match(MINER_TELLS);
        if (m) onMinerFound(href, m[0]);
      }).catch(function () {});
    } catch (_) {}
  }

  try {
    var NativeWorker = window.Worker;
    if (typeof NativeWorker === 'function') {
      var Wrapped = function (url, opts) {
        var w = new NativeWorker(url, opts);
        var href = String(url || '');
        liveWorkers++;
        if (liveWorkers > peakWorkers) peakWorkers = liveWorkers;
        var done = false;
        var drop = function () {
          if (done) return;
          done = true;
          liveWorkers = Math.max(0, liveWorkers - 1);
          untrackWorker(href, w);
        };
        try {
          var nativeTerminate = w.terminate;
          /* Keep our own handle on the real terminate. A miner that overwrites
             terminate() with a no-op must not be able to keep itself alive. */
          try {
            Object.defineProperty(w, '__woNativeTerminate', {
              value: function () { drop(); return nativeTerminate.call(w); },
              enumerable: false, configurable: false, writable: false,
            });
          } catch (_) {}
          w.terminate = function () { drop(); return nativeTerminate.apply(this, arguments); };
        } catch (_) {}
        try { woOn(w, 'error', drop); } catch (_) {}
        trackWorker(href, w);
        scanWorkerSource(href, w);
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

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The deep cryptominer detector across two worlds (M23).
 *
 * cryptominer-detect.js runs in MAIN; bridge.js runs in ISOLATED. They share a document and a
 * postMessage channel, and they do NOT share a window -- `window.x` set by one is invisible to the
 * other. The detector used to ask for a replayed handshake by calling window.__wardenOneBridgeReplay,
 * which the bridge publishes on its own window, so the call could never land. A detector injected
 * after the one-time handshake therefore never got a token, rejected every config that followed,
 * and sat on confirmed detections forever, having killed nothing and reported nothing.
 *
 * The old suite asserted this by checking that both files contained the string
 * `__wardenOneBridgeReplay`. They did. That is exactly what a defect between two realms looks like
 * to a test that models neither, so this one models both: separate window objects, one shared
 * document, one shared message channel.
 *
 * Run: node tools/test-miner-realms.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const DETECT = fs.readFileSync(path.join(ROOT, 'cryptominer-detect.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// ---------------------------------------------------------------------------
// Two realms, faithful about the one distinction that matters.
//
//   window properties  -> per world. This is where the bug lived.
//   document events    -> shared. Both worlds see the same node.
//   window.postMessage -> shared. Each world receives it as coming from ITS OWN window, which is
//                         why the detector's `e.source !== window` guard passes today.
// ---------------------------------------------------------------------------
function makeWorld() {
  const docListeners = [];
  const messageListeners = [];
  const events = [];

  const document = {
    addEventListener(type, fn) { docListeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = docListeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) docListeners.splice(i, 1);
    },
    dispatchEvent(evt) {
      events.push(evt);
      docListeners.slice().filter((l) => l.type === evt.type).forEach((l) => {
        try { l.fn(evt); } catch (_) {}
      });
      return true;
    },
    documentElement: { nodeType: 1 },
    readyState: 'loading',
    querySelectorAll: () => [],
  };

  function makeWindow() {
    const w = {
      addEventListener(type, fn) { if (type === 'message') messageListeners.push({ fn, w }); },
      removeEventListener(type, fn) {
        const i = messageListeners.findIndex((l) => l.fn === fn);
        if (i >= 0) messageListeners.splice(i, 1);
      },
      postMessage(data) {
        // Each listener sees the event as coming from the window of ITS OWN world.
        messageListeners.slice().forEach((l) => { try { l.fn({ source: l.w, data }); } catch (_) {} });
      },
    };
    w.top = w;
    w.self = w;
    w.window = w;
    return w;
  }

  return { document, events, mainWindow: makeWindow(), isolatedWindow: makeWindow() };
}

function CustomEventShim(type, init) {
  this.type = type;
  this.detail = init && init.detail;
}

// The bridge's replay wiring, lifted rather than restated.
function loadBridgeReplay(world, options = {}) {
  const from = BRIDGE.indexOf('  const bridgeReplay = () => {');
  const to = BRIDGE.indexOf('  // 1. Listen for the custom events the main-world trap dispatches on document,');
  if (from < 0 || to <= from) throw new Error('bridge replay source markers not found');
  const state = { replays: 0, posted: [] };
  const sandbox = {
    window: world.isolatedWindow,
    document: world.document,
    Object,
    TOKEN: options.token || 'tok-shared',
    bridgeConfigReady: options.configReady !== false,
    bridgeConfig: options.config || {},
    postToPage(msg) { state.posted.push(msg); world.isolatedWindow.postMessage(msg); },
    sendConfig(cfg) {
      state.posted.push({ kind: 'config' });
      world.isolatedWindow.postMessage({
        source: 'wardenone', kind: 'config', token: sandbox.TOKEN, overrides: cfg,
      });
    },
    woOn(target, type, fn) { target.addEventListener(type, fn); },
    bridgeRateOk: options.rateOk || (() => true),
  };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE.slice(from, to) + '\nthis.__replay = bridgeReplay;', sandbox, { filename: 'bridge.js' });
  state.replay = sandbox.__replay;
  return state;
}

// The real detector, in a MAIN-world context.
function loadDetector(world, options = {}) {
  const state = { workers: [], terminated: [], fetched: [] };
  const source = options.workerSource === undefined ? 'var x = cryptonight;' : options.workerSource;

  function FakeWorker(url) {
    this.url = String(url);
    this.terminate = () => { state.terminated.push(this.url); };
    state.workers.push(this);
  }
  FakeWorker.prototype = {};

  const sandbox = {
    window: world.mainWindow,
    document: world.document,
    location: { hostname: options.hostname || 'miner.example', origin: 'https://miner.example', href: 'https://miner.example/' },
    navigator: { hardwareConcurrency: 8 },
    console,
    Object, Set, Array, String, Number, Math, JSON, Promise, URL, RegExp, Error, Date,
    AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    CustomEvent: CustomEventShim,
    fetch(href) {
      state.fetched.push(String(href));
      return Promise.resolve({ text: () => Promise.resolve(source) });
    },
  };
  sandbox.window.Worker = FakeWorker;
  sandbox.window.WebAssembly = undefined;
  vm.createContext(sandbox);
  vm.runInContext(DETECT, sandbox, { filename: 'cryptominer-detect.js' });
  state.startWorker = (url) => new sandbox.window.Worker(url || 'https://miner.example/w.js');
  return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const minerEvents = (world) => world.events.filter((e) => e.type === 'wo-event'
  && e.detail && /cryptominer/.test(String(e.detail.type || '')));

async function main() {
  // -------------------------------------------------------------------------
  // 1. The failure this finding is about: the bridge has already sent its one-time handshake
  //    before the dynamically-registered detector exists. The detector must be able to ask for
  //    another one, across the realm boundary.
  // -------------------------------------------------------------------------
  {
    const world = makeWorld();
    const bridge = loadBridgeReplay(world, { config: { enabled: true, allowlist: [] } });
    // The one-time handshake happens here, with nothing in MAIN listening for it yet.
    bridge.replay();
    const before = bridge.posted.length;

    const detector = loadDetector(world);
    await settle();
    check('the detector asks for a replayed handshake it actually missed',
      bridge.posted.length > before,
      'the request never reached the other world');

    detector.startWorker('https://miner.example/miner.js');
    await settle();
    check('a confirmed miner is stopped once the replay lands',
      detector.terminated.length === 1, JSON.stringify(detector.terminated));
    check('and it is reported as blocked',
      minerEvents(world).some((e) => e.detail.type === 'blocked_cryptominer'));
  }

  // -------------------------------------------------------------------------
  // 2. The other ordering: the detector installs first and the bridge's handshake arrives after.
  //    This one worked before and must keep working.
  // -------------------------------------------------------------------------
  {
    const world = makeWorld();
    const detector = loadDetector(world);
    const bridge = loadBridgeReplay(world, { config: { enabled: true, allowlist: [] } });
    bridge.replay();
    await settle();
    detector.startWorker('https://miner.example/miner.js');
    await settle();
    check('detector-first ordering still ends with the miner stopped',
      detector.terminated.length === 1);
  }

  // -------------------------------------------------------------------------
  // 3. Nothing is acted on before config arrives, and the queue is what makes that safe rather
  //    than lossy: the detection is held, then flushed once the token and config land.
  // -------------------------------------------------------------------------
  {
    const world = makeWorld();
    const detector = loadDetector(world);
    detector.startWorker('https://miner.example/miner.js');
    await settle();
    check('a miner found before config is not touched', detector.terminated.length === 0);
    check('and nothing is reported yet', minerEvents(world).length === 0);

    const bridge = loadBridgeReplay(world, { config: { enabled: true, allowlist: [] } });
    bridge.replay();
    await settle();
    check('the held detection is acted on once config arrives', detector.terminated.length === 1);
  }

  // -------------------------------------------------------------------------
  // 3b. The ordering where the detector never saw a handshake at all: it installed before the
  //     bridge, so its request at install time went nowhere, and the bridge then came up without
  //     replaying on its own. The only thing that recovers this is the retry inside onMinerFound,
  //     which is the one that fires when there is finally something to lose.
  // -------------------------------------------------------------------------
  {
    const world = makeWorld();
    const detector = loadDetector(world);
    loadBridgeReplay(world, { config: { enabled: true, allowlist: [] } });
    await settle();
    detector.startWorker('https://miner.example/miner.js');
    await settle();
    await settle();
    check('finding a miner with no token yet fetches one and then acts',
      detector.terminated.length === 1,
      'the detector never recovered from missing the handshake');
  }

  // -------------------------------------------------------------------------
  // 4. The escape hatches. Both must report and neither may act -- that is the difference between
  //    a detector and something that breaks worker-heavy sites.
  // -------------------------------------------------------------------------
  for (const [label, config, host] of [
    ['the user switched WardenOne off', { enabled: false, allowlist: [] }, 'miner.example'],
    ['the user allowlisted this site', { enabled: true, allowlist: ['miner.example'] }, 'miner.example'],
    ['the user allowlisted a parent domain', { enabled: true, allowlist: ['miner.example'] }, 'sub.miner.example'],
  ]) {
    const world = makeWorld();
    const bridge = loadBridgeReplay(world, { config });
    bridge.replay();
    const detector = loadDetector(world, { hostname: host });
    await settle();
    detector.startWorker('https://miner.example/miner.js');
    await settle();
    check('no worker is terminated when ' + label, detector.terminated.length === 0,
      JSON.stringify(detector.terminated));
    check('but it is still reported when ' + label,
      minerEvents(world).some((e) => e.detail.type === 'detected_cryptominer'));
  }

  // -------------------------------------------------------------------------
  // 5. An ordinary worker is left alone. A detector that kills everything would pass every
  //    assertion above.
  // -------------------------------------------------------------------------
  {
    const world = makeWorld();
    const bridge = loadBridgeReplay(world, { config: { enabled: true, allowlist: [] } });
    bridge.replay();
    const detector = loadDetector(world, { workerSource: 'self.onmessage = function () { resize(); };' });
    await settle();
    detector.startWorker('https://miner.example/ordinary.js');
    await settle();
    check('an ordinary worker is never terminated', detector.terminated.length === 0);
    check('and nothing is reported about it', minerEvents(world).length === 0);
  }

  // -------------------------------------------------------------------------
  // 6. The wiring, so the realm boundary cannot be re-crossed by accident.
  // -------------------------------------------------------------------------
  check('the detector asks through the shared document, not a window global',
    /document\.dispatchEvent\(new CustomEvent\('wo-bridge-replay'\)\)/.test(DETECT)
      && !/window\.__wardenOneBridgeReplay\s*(?:===|\()/.test(DETECT),
    'a MAIN-world script cannot reach a global the ISOLATED bridge published');
  check('the bridge answers that request', /'wo-bridge-replay'/.test(BRIDGE));
  check('the replay the event triggers is the same one the global exposes',
    /window\.__wardenOneBridgeReplay = bridgeReplay;/.test(BRIDGE),
    'two copies of the replay would drift');
  check('a page cannot use the request to spam the channel',
    /bridgeRateOk\('wo-bridge-replay'/.test(BRIDGE));
  check('the bridge still keeps its own same-world replay entry point',
    /typeof window\.__wardenOneBridgeReplay === 'function'/.test(BRIDGE),
    'a re-injected bridge in the SAME world uses this, and that call is legitimate');

  if (failed) { console.error('\n' + failed + ' miner realm check(s) failed'); process.exit(1); }
  console.log('\nthe detector and the bridge reach each other across worlds');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

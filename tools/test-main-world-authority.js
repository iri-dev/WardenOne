/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Nothing the page can say may count (SEC-01, SEC-02, SEC-03).
 *
 * The MAIN-world engine shares its world with the page. It used to take three things on the
 * strength of a routing nonce the page could read: configuration ("carries the nonce, so it
 * came from the bridge" -- a page could post {enabled:false} and switch the engine off), a
 * reputation verdict (a page could answer its own link check "clean" before the worker did),
 * and its own teardown (window.__wardenOneDispose, callable by anyone, with the ready markers
 * page-writable afterwards so the watchdog's probe said "present").
 *
 * Now the isolated bridge hands the engine a key once, in a synchronous DOM event at
 * document_start, before the page can run; signs everything the engine must trust with it; and
 * treats the engine as alive only when it answers a signed challenge. This is the two-world
 * harness the findings asked for: the real bridge listeners in one world, the real engine
 * listeners in the other, and a page that can observe every message and dispatch every event.
 * No page-originated sequence may change the config, settle a pending verdict, dispose the
 * engine, or make the bridge believe an engine is there.
 *
 * Run: node tools/test-main-world-authority.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const woAuth = require('./lib/wo-auth');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return src.slice(a, b);
}
const tick = () => new Promise((r) => setImmediate(r));

/* ---- the two worlds, and the page in one of them ----------------------------------- */

/* Just enough of a DOM for the seal: tag names, attributes, and every descendant of <html>. */
function element(localName, attrs, children) {
  const el = { localName, attributes: Object.keys(attrs || {}).map((name) => ({ name, value: attrs[name] })), children: children || [] };
  Object.defineProperty(el, 'firstElementChild', { get() { return el.children[0] || null; } });
  return el;
}
function descendants(el, out) { (el.children || []).forEach((c) => { out.push(c); descendants(c, out); }); return out; }

function makeWorlds() {
  const events = [];
  const docListeners = [];
  function listenerOk(l) { return !(l.opts && l.opts.signal && l.opts.signal.aborted); }
  const documentElement = element('html', {}, []);
  documentElement.getElementsByTagName = (q) => { if (q !== '*') throw new Error('the seal asks for every element'); return descendants(documentElement, []); };
  const document = {
    documentElement,
    head: null,
    body: null,
    readyState: 'loading',
    addEventListener(type, fn, opts) { docListeners.push({ type, fn, opts: opts || {} }); },
    removeEventListener(type, fn) { const i = docListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) docListeners.splice(i, 1); },
    dispatchEvent(evt) {
      events.push(evt);
      docListeners.slice().filter((l) => l.type === evt.type && listenerOk(l)).forEach((l) => { try { l.fn(evt); } catch (e) { events.push({ type: 'listener-threw', error: String(e) }); } });
      return true;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const messageListeners = [];
  const posted = [];
  function makeWindow(name) {
    const w = {
      name,
      addEventListener(type, fn, opts) { if (type === 'message') messageListeners.push({ fn, w, opts: opts || {} }); },
      removeEventListener(type, fn) { const i = messageListeners.findIndex((l) => l.fn === fn); if (i >= 0) messageListeners.splice(i, 1); },
      postMessage(data) {
        posted.push(data);
        // Every listener sees the event as coming from the window of its own world; the
        // engine registered first, so it hears each message before the page does.
        messageListeners.slice().filter(listenerOk).forEach((l) => { try { l.fn({ source: l.w, data }); } catch (e) { events.push({ type: 'listener-threw', error: String(e) }); } });
      },
    };
    w.top = w; w.self = w; w.window = w;
    return w;
  }
  return { document, events, posted, mainWindow: makeWindow('main'), isolatedWindow: makeWindow('isolated') };
}
function CustomEventShim(type, init) { this.type = type; this.detail = init && init.detail; }

/* ---- the real bridge, its authority-bearing parts ------------------------------------ */

const BRIDGE_AUTH = between(BRIDGE, '  const TOKEN = (function () {', '  const BRIDGE_RATE = Object.create(null);', 'the token, the key and the signer');
const BRIDGE_RATE = between(BRIDGE, '  const BRIDGE_RATE = Object.create(null);', '\n  /* User-picked hidden elements', 'the rate limiter');
const BRIDGE_POST = between(BRIDGE, '  function postToPage(message) {', '\n  const WO_MODAL = {', 'postToPage and publicSafeBrowsingResult');
const BRIDGE_REPLAY = between(BRIDGE, '  const bridgeReplay = () => {', '\n  // 1. Listen for the custom events the main-world trap dispatches on document,', 'the replay');
const BRIDGE_WATCHDOG = between(BRIDGE, '  /* The engine has to PROVE it is there.', '\n  // Navigation attribution signals.', 'the watchdog and the wo-event listener');
const BRIDGE_REPUTATION = between(BRIDGE, '  // A verdict is signed over its request id and its body', '\n  // Narrow MAIN-world -> background relay.', 'the reputation relay');
const BRIDGE_RELAY = between(BRIDGE, '  // Narrow MAIN-world -> background relay.', '\n  // Cookie reload-loop escape.', 'the background relay');
const SEND_TAIL = between(BRIDGE, "    postToPage(signed('config', JSON.stringify(clean)", ';\n', 'the config send') + ';';

function loadBridge(worlds, options) {
  const o = options || {};
  /* The worker answers only when the test lets it: latency is the attacker's whole advantage. */
  const state = { sent: [], timers: [], intervals: [], held: [], verdict: o.verdict || { ok: true, enabled: true, hit: true, threats: ['SOCIAL_ENGINEERING'] } };
  state.release = () => { const held = state.held.splice(0); held.forEach((fn) => fn()); };
  const sandbox = {
    window: worlds.isolatedWindow,
    document: worlds.document,
    location: { protocol: 'https:', hostname: 'victim.example', href: 'https://victim.example/' },
    CustomEvent: CustomEventShim,
    Uint8Array, Uint32Array, Array, Object, String, Number, JSON, Math, Date, Set, Map, RegExp, parseInt, Promise,
    crypto: { getRandomValues: (a) => require('crypto').randomFillSync(a) },
    console: { warn() {}, log() {} },
    setTimeout, clearTimeout,
    pageTargetOrigin: () => '*',
    woOn: (t, type, fn, opts) => t.addEventListener(type, fn, opts),
    woTimeout: (fn, ms) => { state.timers.push({ fn, ms }); return state.timers.length; },
    woInterval: (fn, ms) => { state.intervals.push({ fn, ms }); return state.intervals.length; },
    woOnMessage: () => {},
    safeBrowsingIntentAllowed: () => true,
    boundedBridgeDetail: (d) => d,
    bridgeConfigReady: true,
    bridgeConfig: o.config || { enabled: true },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          state.sent.push(msg);
          if (msg && msg.kind === 'safe-browsing-check') { state.held.push(() => cb && cb(state.verdict)); return; }
          if (msg && msg.kind === 'domain-age') { state.held.push(() => cb && cb({ ok: true, ageDays: 3 })); return; }
          if (cb) cb(undefined);
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext([
    BRIDGE_AUTH, BRIDGE_RATE, BRIDGE_POST,
    'const sendConfig = (clean) => {\n' + SEND_TAIL + '\n};',
    BRIDGE_REPLAY, BRIDGE_WATCHDOG, BRIDGE_REPUTATION, BRIDGE_RELAY,
    'globalThis.api = { deliverKey, sendConfig, engineAnswers, bridgeVerifyEngine, signed, TOKEN, KEY,'
    + ' seen: () => bridgeEngineSeen, fresh: () => BRIDGE_FRESH, checks: () => bridgeEngineChecks };',
  ].join('\n'), sandbox, { filename: 'bridge-authority.js' });
  return { api: sandbox.api, state, sandbox };
}

/* ---- the real engine, its authority-bearing parts ------------------------------------ */

const ENGINE_AUTH = between(SRC, '  let __woToken=null;', '\n  let __woRuntimeStarted=!1;', 'the engine listeners');
const ENGINE_TEARDOWN_MARK = '  const __woTeardown=()=>{';
const ENGINE_REPUTATION = (() => {
  const raw = between(SRC, '    safeBrowsingPending=new Map;', '\n    showSafeBrowsingPanel=(title,', 'the reputation client');
  return 'var ' + raw.replace(/\},\s*$/, '};');
})();

function loadEngine(worlds) {
  const state = { emitted: [], torn: 0 };
  const store = { enabled: true, __configReady: false };
  const sandbox = {
    window: worlds.mainWindow,
    document: worlds.document,
    location: { href: 'https://victim.example/', hostname: 'victim.example' },
    CustomEvent: CustomEventShim,
    URL,
    Uint8Array, Uint32Array, Array, Object, String, Number, JSON, Math, Date, Set, Map, RegExp, parseInt, Promise,
    setTimeout, clearTimeout,
    console: { warn() {}, log() {} },
    __woNativeMessageDataGetter: null,
    __woMessageData: (e) => e && e.data,
    __woConfigStore: store,
    buildConfig: (o) => Object.assign({}, o || {}),
    __woTeardown: () => { state.torn++; },
    WO: { downloadSafeBrowsing: true },
    urlReputationOn: () => true,
    AbortController,
  };
  /* The engine's own woOn adds the abort signal; here the signal is what a teardown aborts. */
  vm.createContext(sandbox);
  vm.runInContext('var __woAbort = new AbortController(); var woOn = (t, type, fn, o) => { const b = Object.assign({}, o === true ? { capture: true } : (o || {})); b.signal = __woAbort.signal; t.addEventListener(type, fn, b); };', sandbox);
  vm.runInContext([
    ENGINE_AUTH, ENGINE_REPUTATION,
    'globalThis.api = { store: __woConfigStore, token: () => __woToken, key: () => __woKey, lastSeq: () => __woLastSeq,'
    + ' frameClickfix: () => __woFrameClickfix, request: __woBackgroundRequest, safeBrowsingCheck, emit: __woEmit,'
    + ' abort: () => __woAbort.abort() };',
  ].join('\n'), sandbox, { filename: 'engine-authority.js' });
  worlds.document.addEventListener('wo-event', (e) => state.emitted.push(e.detail));
  /* What the runtime does at start: announce itself. Queued until the key arrives. */
  vm.runInContext('__woEmit({ type: "installed", detail: { version: "1.0.1" } })', sandbox);
  return { api: sandbox.api, state };
}

/* ---- the page: sees everything, may dispatch anything ------------------------------- */

function attachPage(worlds) {
  const seen = { messages: [], events: [] };
  worlds.mainWindow.addEventListener('message', (e) => seen.messages.push(e.data));
  for (const type of ['wo-key', 'wo-event', 'wo-ping', 'wo-safe-browsing-check', 'wo-background-message', 'wo-bridge-config-ready']) {
    worlds.document.addEventListener(type, (e) => seen.events.push({ type, detail: e.detail }));
  }
  return {
    seen,
    post: (data) => worlds.mainWindow.postMessage(data),
    dispatch: (type, detail) => worlds.document.dispatchEvent(new CustomEventShim(type, { detail })),
    lastConfig: () => seen.messages.filter((m) => m && m.source === 'wardenone' && m.kind === 'config').pop(),
    token: () => (seen.messages.find((m) => m && m.source === 'wardenone-handshake') || {}).token,
  };
}

/* A document the parser has built into: a <head> with a <script> in it, which may have run. */
function pageHasRun(worlds) {
  worlds.document.head = element('head', {}, [element('script', { src: 'https://victim.example/app.js' })]);
  worlds.document.documentElement.children.push(worlds.document.head);
}

(async () => {
  console.log('\nMAIN-world authority\n');

  /* ---- 1. the hand-off: engine first, bridge second, the page never ------------------ */
  {
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    check('the bridge is fresh at document_start', bridge.api.fresh() === true);
    check('before the hand-off the engine holds no key', engine.api.key() === null);
    bridge.api.deliverKey();
    check('the key reaches the engine synchronously, by the document, once', engine.api.key() === bridge.api.KEY && engine.api.token() === bridge.api.TOKEN);
    check('the engine flushed a signed installed the moment it had the key, and the bridge counted it',
      engine.state.emitted.some((d) => d.type === 'installed' && d.mac) && bridge.api.seen() === true);
    check('the key never went out by postMessage', !worlds.posted.some((m) => m && JSON.stringify(m).indexOf(bridge.api.KEY) !== -1));

    /* Now the page exists. From here on it sees everything. */
    pageHasRun(worlds);
    const page = attachPage(worlds);
    bridge.api.sendConfig({ enabled: true, blockClickfix: true });
    check('the page sees the config and its signature', !!page.lastConfig() && typeof page.lastConfig().mac === 'string' && page.lastConfig().seq >= 1);
    check('and the engine applied it', engine.api.store.blockClickfix === true && engine.api.store.__configReady === true);

    page.dispatch('wo-bridge-replay');
    check('a replay the page asks for hands out the nonce and the config again', page.token() === bridge.api.TOKEN && page.seen.messages.filter((m) => m && m.kind === 'config').length === 2);
    check('but never the key', !page.seen.events.some((e) => e.type === 'wo-key') && !page.seen.messages.some((m) => JSON.stringify(m).indexOf(bridge.api.KEY) !== -1));
  }

  /* ---- 1b. what counts as "the page has run" ------------------------------------------ */
  {
    /* The Spotify, Twitch and YouTube modules run in MAIN before this bridge and append a
       <style> at document_start. Inert -- and the first seal refused the key over it, on
       exactly those three sites. */
    const worlds = makeWorlds();
    worlds.document.documentElement.children.push(element('style', { id: 'wo-spotify-adblock-css' }));
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    check('a style prelude from a sibling module does not seal the bridge', bridge.api.fresh() === true);
    bridge.api.deliverKey();
    check('and the key still reaches the engine', engine.api.key() === bridge.api.KEY);
  }
  for (const [label, arrange] of [
    ['a handler attribute on that prelude', (d) => d.documentElement.children.push(element('style', { onload: 'steal()' }))],
    ['a script element, even an empty one', (d) => { d.head = element('head', {}, [element('script', {})]); d.documentElement.children.push(d.head); }],
    ['a frame', (d) => d.documentElement.children.push(element('iframe', { srcdoc: '<script>steal()</script>' }))],
    ['a body', (d) => { d.body = element('body', {}); d.documentElement.children.push(d.body); }],
    ['a document past loading', (d) => { d.readyState = 'interactive'; }],
    ['a handler on the html element itself', (d) => d.documentElement.attributes.push({ name: 'onload', value: 'steal()' })],
    ['a document too big to have been built by content scripts', (d) => { for (let i = 0; i < 65; i++) d.documentElement.children.push(element('meta', { name: 'x' + i })); }],
    ['a document that cannot be inspected', (d) => { d.documentElement.getElementsByTagName = () => { throw new Error('no'); }; }],
  ]) {
    const worlds = makeWorlds();
    arrange(worlds.document);
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    check(label + ' seals the bridge', bridge.api.fresh() === false && engine.api.key() === null);
  }
  {
    /* Bridge first, engine second: the order of manifest entries is not promised across
       worlds. The engine asks for a replay at its own start and holds the key from then on. */
    const worlds = makeWorlds();
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    const engine = loadEngine(worlds);
    check('an engine loaded after the bridge asks for a replay at its start and holds the key', engine.api.key() === bridge.api.KEY);
    check('and its installed was signed and counted', bridge.api.seen() === true);
    check('and the config the replay carried was applied', engine.api.store.__configReady === true);
  }

  /* ---- 2. SEC-01: no page-originated sequence changes the config --------------------- */
  {
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    pageHasRun(worlds);
    const page = attachPage(worlds);
    bridge.api.sendConfig({ enabled: true, blockClickfix: true });
    page.dispatch('wo-bridge-replay');
    const genuine = page.lastConfig();
    const token = page.token();
    const spoofs = () => engine.state.emitted.filter((d) => d.type === 'blocked_config_spoof').length;

    page.post({ source: 'wardenone', kind: 'config', token, overrides: { enabled: false } });
    check('the finding\'s own attack -- nonce in hand, enabled:false -- changes nothing', engine.api.store.enabled === true && spoofs() === 1);
    page.post({ source: 'wardenone', kind: 'config', token, overrides: { enabled: false }, seq: genuine.seq + 1, mac: genuine.mac });
    check('a copied signature on new content is refused', engine.api.store.enabled === true && spoofs() === 2);
    page.post(genuine);
    check('the genuine message replayed verbatim is refused on its sequence number', spoofs() === 3 && engine.api.lastSeq() === genuine.seq);
    page.post(Object.assign({}, genuine, { seq: genuine.seq + 50 }));
    check('and moving the sequence forward breaks the signature', spoofs() === 4);

    const forged = woAuth.handshake((type, detail) => page.dispatch(type, detail), (data) => page.post(data), { token });
    check('a second wo-key from the page does not replace the first', engine.api.key() === bridge.api.KEY);
    forged.sendConfig({ enabled: false });
    check('a config signed with the page\'s own key is refused', engine.api.store.enabled === true && spoofs() === 5);

    bridge.api.sendConfig({ enabled: true, blockClickfix: false });
    check('a later genuine config still applies, and the sequence moved on', engine.api.store.blockClickfix === false && engine.api.lastSeq() > genuine.seq);
    check('what the page dispatched in between left the bridge\'s counter alone', page.lastConfig().seq === genuine.seq + 1);
  }

  /* ---- 3. SEC-02: a forged verdict never settles the pending request ----------------- */
  {
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds, { verdict: { ok: true, enabled: true, hit: true, threats: ['SOCIAL_ENGINEERING'] } });
    bridge.api.deliverKey();
    pageHasRun(worlds);
    const page = attachPage(worlds);
    bridge.api.sendConfig({ enabled: true });

    let settled = null;
    const pending = engine.api.safeBrowsingCheck('https://evil.example/login', 'link', 2000).then((r) => { settled = r; return r; });
    const req = page.seen.events.find((e) => e.type === 'wo-safe-browsing-check');
    check('the page sees the request leave, id and nonce included', !!req && !!req.detail.id && req.detail.token === bridge.api.TOKEN);
    page.post({ source: 'wardenone-safe-browsing', token: req.detail.token, id: req.detail.id, result: { ok: true, enabled: true, hit: false } });
    await tick();
    check('the finding\'s own attack -- a clean reply first -- does not settle the request', settled === null);
    page.post({ source: 'wardenone-safe-browsing', token: req.detail.token, id: req.detail.id, result: { ok: true, enabled: true, hit: false }, seq: 99, mac: 'ab'.repeat(32) });
    await tick();
    check('nor does one with a made-up signature', settled === null);
    bridge.state.release();
    const verdict = await pending;
    check('the worker\'s real answer, signed by the bridge, is what settles it -- and it is the hit', verdict && verdict.ok === true && verdict.hit === true, verdict);
    const reply = page.seen.messages.find((m) => m && m.source === 'wardenone-safe-browsing' && typeof m.mac === 'string');
    check('the page saw the genuine reply go by', !!reply && reply.id === req.detail.id, page.seen.messages.filter((m) => m && m.source === 'wardenone-safe-browsing'));

    let second = null;
    engine.api.safeBrowsingCheck('https://evil.example/other', 'link', 2000).then((r) => { second = r; });
    const req2 = page.seen.events.filter((e) => e.type === 'wo-safe-browsing-check').pop();
    page.post(Object.assign({}, reply, { id: req2.detail.id, result: { ok: true, enabled: true, hit: false } }));
    page.post(reply);
    await tick();
    check('a captured genuine reply cannot be re-aimed at a new request or replayed', second === null);
    bridge.state.release();
    await tick();
    check('and the new request is still answered by the bridge', second && second.hit === true, second);
  }

  /* the generic background channel has the same shape */
  {
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    pageHasRun(worlds);
    const page = attachPage(worlds);
    let answer = null;
    engine.api.request({ kind: 'domain-age', domain: 'victim.example' }, (r) => { answer = r; }, 2000);
    const req = page.seen.events.find((e) => e.type === 'wo-background-message');
    page.post({ source: 'wardenone-bg-response', token: req.detail.token, id: req.detail.id, result: { ok: true, ageDays: 9000 } });
    check('a forged background reply does not settle the request', answer === null);
    bridge.state.release();
    await tick();
    check('the bridge\'s signed reply does', answer && answer.ok === true && answer.ageDays === 3, answer);
  }

  /* the frame relay too */
  {
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    pageHasRun(worlds);
    const page = attachPage(worlds);
    page.post({ source: 'wardenone', kind: 'frame-clickfix', token: bridge.api.TOKEN, detail: { sample: 'powershell -e ...', frameHost: 'evil.example' } });
    check('a forged frame relay fills nothing', engine.api.frameClickfix() === null);
    const detail = { sample: 'powershell -e ...', frameHost: 'ads.example' };
    worlds.isolatedWindow.postMessage(bridge.api.signed('frame-clickfix', JSON.stringify(detail), { source: 'wardenone', kind: 'frame-clickfix', token: bridge.api.TOKEN, detail }));
    check('the signed one does', engine.api.frameClickfix() && engine.api.frameClickfix().frameHost === 'ads.example');
  }

  /* ---- 4. SEC-03: no page-callable teardown, and a challenge the page cannot answer ---- */
  {
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    pageHasRun(worlds);
    const page = attachPage(worlds);
    check('there is no window.__wardenOneDispose to call', typeof worlds.mainWindow.__wardenOneDispose !== 'function' && !/window\.__wardenOneDispose/.test(MIN));
    page.post({ source: 'wardenone', kind: 'dispose', token: bridge.api.TOKEN });
    page.post({ source: 'wardenone', kind: 'dispose', token: bridge.api.TOKEN, seq: 7, mac: 'cd'.repeat(32) });
    check('a dispose the page posts, signed or not, tears nothing down', engine.state.torn === 0);
    check('a live engine answers the bridge\'s challenge', bridge.api.engineAnswers() === true);
    const pings = page.seen.events.filter((e) => e.type === 'wo-ping');
    check('the page saw the nonce', pings.length === 1 && !!pings[0].detail.nonce);

    /* The page removes the engine the only way left to it -- it cannot, so the harness aborts the
       engine's listeners the way the real teardown does -- and then puts every marker back. */
    engine.api.abort();
    worlds.mainWindow.__wardenOneReadyVersion = '1.0.1';
    worlds.mainWindow.__wardenOneInstalled = '1.0.1';
    worlds.mainWindow.__wardenOneProtectionActive = true;
    check('once the listeners are gone the challenge fails, whatever the markers say', bridge.api.engineAnswers() === false);
    worlds.document.addEventListener('wo-ping', (e) => {
      page.dispatch('wo-event', { token: bridge.api.TOKEN, type: 'pong', nonce: e.detail.nonce, mac: 'ef'.repeat(32) });
    });
    check('a page answering the ping with the right nonce and a made-up signature still fails', bridge.api.engineAnswers() === false);
    bridge.api.bridgeVerifyEngine('still-absent');
    const report = bridge.state.sent.find((m) => m && m.kind === 'wo-engine-check');
    check('the bridge reports the engine as disposed, saying it had seen a genuine one',
      !!report && report.why === 'disposed' && report.seen === true && report.fresh === true, report);

    worlds.isolatedWindow.postMessage(bridge.api.signed('dispose', '', { source: 'wardenone', kind: 'dispose', token: bridge.api.TOKEN }));
    check('a bridge-signed dispose is the one thing that reaches the teardown (here, after the abort, it cannot)', engine.state.torn === 0);
  }
  {
    /* The signed dispose against a live engine. */
    const worlds = makeWorlds();
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    worlds.isolatedWindow.postMessage(bridge.api.signed('dispose', '', { source: 'wardenone', kind: 'dispose', token: bridge.api.TOKEN }));
    check('a bridge-signed dispose reaches the teardown', engine.state.torn === 1);
  }
  {
    /* A page pretending to be an engine, to a bridge that never met one. */
    const worlds = makeWorlds();
    const bridge = loadBridge(worlds);
    bridge.api.deliverKey();
    pageHasRun(worlds);
    const page = attachPage(worlds);
    page.dispatch('wo-bridge-replay');
    page.dispatch('wo-event', { token: page.token(), type: 'installed', detail: { version: '1.0.1' } });
    check('an installed the page emits with the nonce is not counted', bridge.api.seen() === false);
    page.dispatch('wo-event', { token: page.token(), type: 'installed', mac: 'ab'.repeat(32) });
    check('nor one with a made-up signature', bridge.api.seen() === false);
    bridge.state.timers.filter((t) => t.ms === 6000).forEach((t) => t.fn());
    const report = bridge.state.sent.find((m) => m && m.kind === 'wo-engine-check');
    check('after six seconds the bridge reports an engine that never announced itself', !!report && report.why === 'never-announced' && report.seen === false, report);
  }
  {
    /* A bridge injected into a document the page has already run in hands no key over. */
    const worlds = makeWorlds();
    pageHasRun(worlds);
    const engine = loadEngine(worlds);
    const bridge = loadBridge(worlds);
    const page = attachPage(worlds);
    check('the bridge knows it is late', bridge.api.fresh() === false);
    bridge.api.deliverKey();
    page.dispatch('wo-bridge-replay');
    check('and delivers no key, not even on request', engine.api.key() === null && !page.seen.events.some((e) => e.type === 'wo-key'));
    bridge.api.sendConfig({ enabled: false });
    check('so its config -- which the page could forge just as well -- is not applied either', engine.api.store.enabled === true);
  }

  /* ---- 5. the shipped runtime carries all of it --------------------------------------- */
  check('the shipped engine takes its key from wo-key and nothing else',
    /woOn\(document,"wo-key",/.test(MIN) && !/"wardenone-handshake"/.test(MIN));
  check('the shipped engine verifies config, verdicts, background replies, the frame relay and dispose',
    ['"config"', '"safe-browsing"', '"bg-response"', '"frame-clickfix"', '"dispose"'].every((k) => MIN.indexOf('__woVerify(' + k) !== -1));
  check('a verdict that does not verify leaves the request pending',
    /if\(!__woVerify\("safe-browsing",id\+"\\n"\+JSON\.stringify\(m\.result\),m\)\)return;\s*const pending=safeBrowsingPending\.get\(id\)/.test(MIN));
  const minimised = [...MIN.matchAll(/__woAuth\.hmac\(/g)].length;
  check('the shipped engine uses the HMAC exactly three times: verify, installed, pong', minimised === 3, String(minimised));
  check('the other MAIN security consumers take their key from wo-key too',
    ['anti-redirect.js', 'permission-chain.js', 'cryptominer-detect.js'].every((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return /woOn\(document, 'wo-key'/.test(src) && !/'wardenone-handshake'/.test(src) && /woVerify\('config', JSON\.stringify\(/.test(src);
    }));
  check('the bridge signs config, both relays and the frame relay with one counter',
    ["signed('config'", "signed('safe-browsing'", "signed('bg-response'", "signed('frame-clickfix'"].every((k) => BRIDGE.indexOf(k) !== -1)
    && /authSeq \+= 1;/.test(BRIDGE));
  check('every shipped MAIN consumer asks for a replay once its own listeners exist',
    MIN.indexOf('document.dispatchEvent(new CustomEvent("wo-bridge-replay"))') > MIN.indexOf('woOn(document,"wo-key",')
    && ['anti-redirect.js', 'permission-chain.js', 'cryptominer-detect.js'].every((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return src.indexOf("new CustomEvent('wo-bridge-replay')") > src.indexOf("woOn(document, 'wo-key'");
    }));
  check('the bridge hands the key over last, after every listener exists',
    BRIDGE.lastIndexOf('  deliverKey();') > BRIDGE.indexOf("woOn(document, 'wo-event', (e) => {")
    && BRIDGE.lastIndexOf('  deliverKey();') > BRIDGE.indexOf("woOn(document, 'wo-safe-browsing-check'"));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all MAIN-world authority checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

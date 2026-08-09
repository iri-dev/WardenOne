/*
 * Node harness for IP Privacy / blockWebRTCLeak.
 * Runs the shipped content.min.js guard slice and asserts:
 *   - common IP echo APIs are denied before fetch/beacon/socket network leaves
 *   - normal RTCPeerConnection/ICE/SDP/stats behavior is preserved so calls work
 *
 * Run: node tools/test-ip-privacy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const MIN = fs.readFileSync(path.join(__dirname, '..', 'content.min.js'), 'utf8');
const START = MIN.indexOf('if(WO.blockWebRTCLeak)try{const IP_LOOKUP_HOST_RE=');
const END = MIN.indexOf('try{let locationEventCount=0;', START);
if (START < 0 || END < 0 || END <= START) {
  console.error('FATAL: IP privacy markers not found in content.min.js');
  process.exit(1);
}
const SLICE = MIN.slice(START, END);

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); return; }
  fail++;
  console.log('  FAIL - ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

const LEAK_SDP = [
  'v=0',
  'o=- 1 2 IN IP4 192.168.1.23',
  'c=IN IP4 203.0.113.9',
  'a=candidate:1 1 udp 2122260223 192.168.1.23 54321 typ host',
  '',
].join('\r\n');

function makeSandbox() {
  const logs = [];
  const fetchCalls = [];
  const beacons = [];
  const socketUrls = [];
  const addedListeners = [];
  const statsInput = new Map([[
    'local',
    {
      type: 'local-candidate',
      address: '192.168.1.23',
      ip: '203.0.113.9',
      ipAddress: '203.0.113.9',
      relatedAddress: '10.0.0.5',
      networkType: 'wifi',
      candidateType: 'host',
      candidate: 'candidate:1 1 udp 2122260223 192.168.1.23 54321 typ host',
      url: 'stun:stun.l.google.com:19302',
    },
  ]]);

  function FakeResponse(body, init) {
    this.body = body;
    this.status = init && init.status;
    this.statusText = init && init.statusText;
  }

  function RealWebSocket(url) {
    socketUrls.push(String(url));
    this.url = String(url);
  }

  function RealEventSource(url) {
    socketUrls.push(String(url));
    this.url = String(url);
  }

  function FakeRTC(config) {
    this.config = config || {};
    this.setConfigArg = null;
    this.setLocalArg = null;
    this._local = { type: 'offer', sdp: LEAK_SDP };
  }
  FakeRTC.prototype.addEventListener = function (type, listener) {
    addedListeners.push(type);
    this.listener = listener;
  };
  FakeRTC.prototype.setLocalDescription = function (desc) {
    this.setLocalArg = desc;
    this._local = desc;
    return Promise.resolve();
  };
  FakeRTC.prototype.createOffer = function () {
    return Promise.resolve({ type: 'offer', sdp: LEAK_SDP });
  };
  FakeRTC.prototype.createAnswer = function () {
    return Promise.resolve({ type: 'answer', sdp: LEAK_SDP });
  };
  FakeRTC.prototype.setConfiguration = function (config) {
    this.setConfigArg = config;
  };
  FakeRTC.prototype.getStats = function () {
    return Promise.resolve(statsInput);
  };
  Object.defineProperty(FakeRTC.prototype, 'localDescription', {
    configurable: true,
    get() { return this._local; },
  });
  Object.defineProperty(FakeRTC.prototype, 'currentLocalDescription', {
    configurable: true,
    get() { return this._local; },
  });
  Object.defineProperty(FakeRTC.prototype, 'pendingLocalDescription', {
    configurable: true,
    get() { return this._local; },
  });

  const sandbox = {
    WO: { blockWebRTCLeak: true },
    trustedMediaHost: false,
    log(type, detail) { logs.push({ type, detail }); },
    location: { hostname: 'example.test', href: 'https://example.test/' },
    navigator: {
      sendBeacon(url) { beacons.push(String(url)); return true; },
    },
    window: {},
    Response: FakeResponse,
    DOMException,
    URL,
    Promise,
    Object,
    String,
    Map,
    Array,
  };
  sandbox.window.fetch = function (url) {
    fetchCalls.push(String(url && url.url || url));
    return Promise.resolve(new FakeResponse('real', { status: 200, statusText: 'OK' }));
  };
  sandbox.window.WebSocket = RealWebSocket;
  sandbox.window.EventSource = RealEventSource;
  sandbox.window.RTCPeerConnection = FakeRTC;
  sandbox.RTCPeerConnection = FakeRTC;
  sandbox.window.webkitRTCPeerConnection = null;
  sandbox.window.mozRTCPeerConnection = null;
  sandbox.__state = { logs, fetchCalls, beacons, socketUrls, addedListeners };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(SLICE, sandbox);
  return sandbox;
}

(async () => {
  const s = makeSandbox();

  const blocked = await s.window.fetch('https://api.ipify.org/?format=json');
  await s.window.fetch('https://example.test/ok');
  check('fetch to IP echo service is answered locally and real network is not called',
    blocked.status === 403 && s.__state.fetchCalls.length === 1 && /example\.test/.test(s.__state.fetchCalls[0]),
    { status: blocked.status, fetchCalls: s.__state.fetchCalls });

  const beaconOk = s.navigator.sendBeacon('https://ipinfo.io/json', 'x');
  check('sendBeacon to IP echo service is swallowed', beaconOk === true && s.__state.beacons.length === 0,
    s.__state.beacons);

  let socketBlocked = false;
  try { new s.window.WebSocket('wss://ipinfo.io/ws'); } catch (_) { socketBlocked = true; }
  check('WebSocket to IP echo service is denied', socketBlocked && s.__state.socketUrls.length === 0,
    s.__state.socketUrls);

  const pc = new s.window.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.example' }] });
  check('constructor preserves configured ICE servers', Array.isArray(pc.config.iceServers) && pc.config.iceServers.length === 1,
    pc.config);
  pc.setConfiguration({ iceServers: [{ urls: 'turn:turn.example' }] });
  check('setConfiguration preserves later ICE servers', Array.isArray(pc.setConfigArg.iceServers) && pc.setConfigArg.iceServers.length === 1,
    pc.setConfigArg);
  pc.onicecandidate = function () {};
  pc.addEventListener('icecandidate', function () {});
  check('icecandidate listeners are preserved', typeof pc.onicecandidate === 'function' && s.__state.addedListeners.includes('icecandidate'),
    { onicecandidate: pc.onicecandidate, added: s.__state.addedListeners });

  const offer = await pc.createOffer();
  check('createOffer SDP is not rewritten', offer.sdp === LEAK_SDP, offer.sdp);
  await pc.setLocalDescription({ type: 'offer', sdp: LEAK_SDP });
  check('setLocalDescription receives the original SDP', pc.setLocalArg.sdp === LEAK_SDP,
    pc.setLocalArg.sdp);
  check('localDescription getter preserves the browser result', pc.localDescription.sdp === LEAK_SDP,
    pc.localDescription.sdp);

  const stats = await pc.getStats();
  const local = stats.get('local');
  check('getStats preserves the native report shape and values',
    stats instanceof Map && local.address === '192.168.1.23' && local.ip === '203.0.113.9' &&
    local.relatedAddress === '10.0.0.5' && local.networkType === 'wifi' &&
    local.url === 'stun:stun.l.google.com:19302' && local.candidateType === 'host',
    local);

  check('IP privacy events are logged', s.__state.logs.some((l) => l.type === 'blocked_ip_lookup') &&
    s.__state.logs.some((l) => l.type === 'webrtc_transport_preserved') &&
    !s.__state.logs.some((l) => l.type === 'webrtc_leak_guard_installed'), s.__state.logs);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Routing token = routing only; the key = anything WardenOne believes.
 *
 * 1. THE KEY STAYS SECRET IN THE PAGE'S WORLD. The engine and its sibling MAIN-world scripts sign
 *    with a key the bridge hands over once at document_start -- but they compute the HMAC in the
 *    page's own realm, where the page can replace built-ins after load. The HMAC used to pass the
 *    key through String.prototype.substr and parseInt, and key-derived bytes through
 *    Uint8Array.prototype.set and the typed-array length getter: a page that patched any one of
 *    them was handed the whole key by the next signature (the bridge's liveness challenge asks
 *    for one every 45 seconds). Now the key becomes its HMAC pad blocks once, at the hand-off,
 *    and signing touches nothing a page can replace. Every MAIN-world copy is attacked here.
 *
 * 2. SECURITY SIGNALS ARE SIGNED. blocked_/detected_/gated_/warned_/behavioral_risk events, the
 *    permission-chain signal, the media-active report Memory Shield trusts before sleeping a tab,
 *    and the reload-loop notice were believed on the public token alone -- a page could put fake
 *    findings in the Activity log and on the badges, raise WardenOne's own notices over itself,
 *    or present a live camera as idle. Each sender now signs; the bridge and the engine believe
 *    only what verifies, once.
 *
 * The shipped code is lifted and run; nothing here is a second implementation of what is tested.
 *
 * Run: node tools/test-main-world-key-isolation.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BRIDGE = read('bridge.js');
const CONTENT = read('src/content.js');
const MAIN_FILES = ['src/content.js', 'anti-redirect.js', 'cryptominer-detect.js', 'permission-chain.js', 'spotify-adblock.js'];

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}
function authBlock(src, file) {
  const a = src.indexOf('const __woAuth=(function(){');
  const b = src.indexOf('})();', src.indexOf('return{hmac:hmac,same:same', a));
  if (a < 0 || b < 0) throw new Error('no __woAuth in ' + file);
  return src.slice(a, b + 5);
}
function between(src, from, to, what) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(what + ' not found');
  return src.slice(a, b);
}
const KEY = crypto.randomBytes(32).toString('hex');
const TOKEN = 'tok-' + crypto.randomBytes(6).toString('hex');
const nodeHmac = (text) => crypto.createHmac('sha256', Buffer.from(KEY, 'hex')).update(text, 'utf8').digest('hex');

/* ---- 1. the key, attacked in every MAIN-world copy ------------------------------------------ */
console.log('the key in the page\'s world');
const ATTACKS = {
  'String.prototype.substr': 'const o=String.prototype.substr; String.prototype.substr=function(...x){ stolen.push(String(this)); return o.apply(this,x); };',
  'parseInt': 'const o=parseInt; globalThis.parseInt=function(s,r){ stolen.push(String(s)); return o(s,r); };',
  'Uint8Array.prototype.set': 'const P=Object.getPrototypeOf(Uint8Array.prototype); const o=P.set; P.set=function(src,off){ stolen.push(Array.from(src)); return o.call(this,src,off); };',
  'Uint8Array.prototype.subarray': 'const P=Object.getPrototypeOf(Uint8Array.prototype); const o=P.subarray; P.subarray=function(a,b){ stolen.push(Array.from(this)); return o.call(this,a,b); };',
  'the typed-array length getter': 'const P=Object.getPrototypeOf(Uint8Array.prototype); const d=Object.getOwnPropertyDescriptor(P,"length"); Object.defineProperty(P,"length",{get(){ stolen.push(Array.from(this)); return d.get.call(this); },configurable:true});',
  'Number.prototype.toString': 'const o=Number.prototype.toString; Number.prototype.toString=function(r){ stolen.push(Number(this)); return o.call(this,r); };',
  'String.prototype.charCodeAt': 'const o=String.prototype.charCodeAt; String.prototype.charCodeAt=function(i){ stolen.push(String(this)); return o.call(this,i); };',
};
const keyBytes = Buffer.from(KEY, 'hex');
function leaked(stolen) {
  for (const s of stolen) {
    if (typeof s === 'string' && s.length >= 2 && KEY.indexOf(s) >= 0 && s.length >= 16) return 'the key text';
    if (Array.isArray(s) && s.length >= 32) {
      for (const pad of [0, 0x36, 0x5c]) {
        if (keyBytes.every((b, i) => s[i] === (b ^ pad))) return 'key bytes' + (pad ? ' (a pad block)' : '');
      }
    }
  }
  /* a byte at a time (parseInt): the whole key in order */
  const pairs = stolen.filter((s) => typeof s === 'string' && /^[0-9a-f]{2}$/.test(s)).join('');
  if (pairs.indexOf(KEY) >= 0) return 'the key, a byte at a time';
  return '';
}
for (const file of MAIN_FILES) {
  const AUTH = authBlock(read(file), file);
  for (const [name, patch] of Object.entries(ATTACKS)) {
    const ctx = vm.createContext({});
    vm.runInContext(AUTH + '\nthis.__woAuth = __woAuth;', ctx);
    ctx.HANDOFF = KEY;
    vm.runInContext('this.pads = __woAuth.key(HANDOFF); delete this.HANDOFF;', ctx);
    vm.runInContext('globalThis.stolen = [];' + patch, ctx);
    let mac = '';
    try { mac = vm.runInContext('__woAuth.hmac(pads, "pong\\n" + "n0nce")', ctx); } catch (e) { mac = 'threw ' + e.message; }
    const how = leaked(vm.runInContext('stolen', ctx));
    check(file + ': a page patching ' + name + ' after the hand-off learns nothing about the key', !how, how);
    if (name === 'String.prototype.substr') check(file + ': and signing still gives HMAC-SHA256', mac === nodeHmac('pong\nn0nce'), mac);
  }
}
{
  const copies = MAIN_FILES.concat(['bridge.js']).map((f) => authBlock(read(f), f).replace(/\n[ \t]+/g, '\n'));
  check('all six copies of the signing code are the same code', copies.every((c) => c === copies[0]));
  check('every MAIN-world script turns the key into its pads at the hand-off, and keeps nothing else',
    MAIN_FILES.concat(['src/fingerprint-realm.js']).every((f) => /(?:woKey|__woKey|key) ?= ?__woAuth\.key\(d\.key\);/.test(read(f)) && !/(?:woKey|__woKey|\bkey) ?= ?d\.key;/.test(read(f))));
}

/* ---- 2. the senders and the checkers ---------------------------------------------------------- */
function bridgeRealm(key) {
  const state = { dispatched: [] };
  const sandbox = {
    TOKEN, KEY: key === undefined ? KEY : key, Set, Object, String, Number, JSON, Uint8Array, Uint32Array, Math, Array,
    window: {},
    document: { dispatchEvent(ev) { state.dispatched.push(ev.detail); return true; } },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  };
  vm.createContext(sandbox);
  vm.runInContext([
    authBlock(BRIDGE, 'bridge.js'),
    between(BRIDGE, '  function boundedBridgeDetail(', '\n  }\n', 'boundedBridgeDetail') + '\n  }',
    between(BRIDGE, '  const KEY_PADS = KEY ?', '  const BRIDGE_RATE', 'the bridge\'s checkers'),
    'this.api = { eventSigned, permissionSignalSigned, pageNoticeSigned, dispatchLocalNotice, auth: __woAuth };',
  ].join('\n'), sandbox, { filename: 'bridge.js:checkers' });
  return Object.assign(sandbox.api, { state, window: sandbox.window });
}
function engineRealm() {
  const sandbox = { Object, String, Number, WeakMap, Reflect, Uint8Array, Uint32Array, Math, Array };
  vm.createContext(sandbox);
  vm.runInContext([
    authBlock(CONTENT, 'src/content.js'),
    'let __woToken=null,__woKey=null;',
    between(CONTENT, '  let __woEventSeq=0,', '  function __woEmit(detail){', 'the engine\'s signing and checking'),
    'this.api = { signed: __woSignedDetail, notice: __woSignedNotice, request: __woSignedRequest, trusted: __woEventTrusted, arm: (t, k) => { __woToken = t; __woKey = __woAuth.key(k); } };',
  ].join('\n'), sandbox, { filename: 'src/content.js:events' });
  return sandbox.api;
}

console.log('security events');
{
  const b = bridgeRealm();
  const e = engineRealm();
  e.arm(TOKEN, KEY);
  const ev = e.signed({ type: 'blocked_payment_card_submit', detail: { host: 'shop.example', why: 'card sent to a collector', n: 3, list: [1, 'a', null], nested: { ok: true } } });
  check('the engine signs its events as the "engine" sender', ev.src === 'engine' && Number.isInteger(ev.eseq) && /^[0-9a-f]{64}$/.test(ev.emac) && ev.token === TOKEN);
  const clone = JSON.parse(JSON.stringify(ev));
  check('the bridge, with its own copy of the event, believes it', b.eventSigned(clone) === true);
  check('once: the same event again is a replay', b.eventSigned(JSON.parse(JSON.stringify(ev))) === false);
  const forged = { token: TOKEN, type: 'blocked_payment_card_submit', detail: { host: 'shop.example' } };
  check('a token-only event is not believed', b.eventSigned(forged) === false && e.trusted(forged) === false);
  const ev2 = e.signed({ type: 'detected_grabber_domain', detail: { host: 'a.example' } });
  const altered = JSON.parse(JSON.stringify(ev2));
  altered.detail.host = 'bank.example';
  check('an event whose detail was changed after signing is not believed', b.eventSigned(altered) === false);
  const retyped = Object.assign(JSON.parse(JSON.stringify(ev2)), { type: 'blocked_popup' });
  check('nor one whose type was changed', b.eventSigned(retyped) === false);
  const resourced = Object.assign(JSON.parse(JSON.stringify(ev2)), { src: 'miner' });
  check('nor one that claims another sender', b.eventSigned(resourced) === false);
  const pageKey = crypto.randomBytes(32).toString('hex');
  const selfSigned = Object.assign({}, forged, { src: 'engine', eseq: 99, emac: crypto.createHmac('sha256', Buffer.from(pageKey, 'hex')).update(b.auth.eventText('engine', 99, forged.type, forged.detail)).digest('hex') });
  check('nor one signed with a key of the page\'s own', b.eventSigned(selfSigned) === false);
  const keyless = bridgeRealm('');
  const ev4 = e.signed({ type: 'blocked_popup', detail: { url: 'https://y.example/' } });
  check('and a bridge that never had a key believes nothing, however it is signed', keyless.eventSigned(JSON.parse(JSON.stringify(ev4))) === false);

  console.log('the engine\'s own listeners');
  const ev3 = e.signed({ type: 'blocked_popup', detail: { url: 'https://x.example/' } });
  check('the notice card, the badge and the risk score all believe the same signed event', e.trusted(ev3) && e.trusted(ev3) && e.trusted(ev3));
  check('but not a copy of it replayed as a new event', e.trusted(Object.assign({}, ev3)) === false);
  ev3.detail.url = 'https://changed.example/';
  check('nor the same event object changed between one listener and the next', e.trusted(ev3) === false);
  check('nor anything unsigned', e.trusted({ token: TOKEN, type: 'blocked_popup', detail: {} }) === false);
}

console.log('the other senders');
{
  const b = bridgeRealm();
  /* cryptominer-detect.js */
  const MINER = read('cryptominer-detect.js');
  const m = { TOKEN, Object, String, Number, Uint8Array, Uint32Array, Math, Array, seen: [],
    location: { hostname: 'miner.example' }, navigator: { hardwareConcurrency: 8 },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; } };
  m.document = { dispatchEvent(ev) { m.seen.push(ev.detail); return true; } };
  vm.createContext(m);
  vm.runInContext([authBlock(MINER, 'cryptominer-detect.js'), 'var woKey = __woAuth.key(' + JSON.stringify(KEY) + '); var peakWorkers = 2, stoppedCount = 1, wasmSeen = true;',
    between(MINER, '  var minerEventSeq = 0;', '\n  /* Nothing may be terminated', 'announce'), 'announce("blocked_cryptominer", "coinhive");'].join('\n'), m);
  check('the miner detector\'s finding is signed and believed', m.seen.length === 1 && b.eventSigned(JSON.parse(JSON.stringify(m.seen[0]))) === true);
  /* permission-chain.js */
  const PERM = read('permission-chain.js');
  const p = { Object, String, Number, Uint8Array, Uint32Array, Math, Array };
  vm.createContext(p);
  vm.runInContext([authBlock(PERM, 'permission-chain.js'), 'let woKey = __woAuth.key(' + JSON.stringify(KEY) + ');',
    between(PERM, '  let permissionSeq = 0;', '\n  function flushQueued()', 'signPermission'),
    'this.sig = (d) => signPermission(d);'].join('\n'), p);
  const sig1 = p.sig({ token: TOKEN, permission: 'geolocation', action: 'request', userGesture: false, origin: 'x.example' });
  check('a permission signal is signed and believed', b.permissionSignalSigned(JSON.parse(JSON.stringify(sig1))) === true);
  check('once', b.permissionSignalSigned(JSON.parse(JSON.stringify(sig1))) === false);
  const sig2 = p.sig({ token: TOKEN, permission: 'camera', action: 'request', userGesture: false });
  check('a signal whose permission was changed after signing is not believed',
    b.permissionSignalSigned(Object.assign(JSON.parse(JSON.stringify(sig2)), { permission: 'notifications' })) === false);
  check('nor a token-only one', b.permissionSignalSigned({ token: TOKEN, permission: 'camera', action: 'request' }) === false);
  /* the media report and the reload-loop panel */
  const e = engineRealm();
  e.arm(TOKEN, KEY);
  const live = e.notice({ source: 'wardenone-media', token: TOKEN, active: true, kind: 'media' }, '1');
  check('"media went live" is signed, and the report does not carry its kind', /^[0-9a-f]{64}$/.test(live.mac) && live.kind === undefined);
  check('and believed', b.pageNoticeSigned('media', live, '1') === true);
  const idle = e.notice({ source: 'wardenone-media', token: TOKEN, active: false, kind: 'media' }, '0');
  check('a genuine "idle" flipped to "live" is not believed', b.pageNoticeSigned('media', Object.assign({}, idle, { active: true }), '1') === false);
  check('a forged "idle" -- the attack on Memory Shield -- is not believed', b.pageNoticeSigned('media', { source: 'wardenone-media', token: TOKEN, active: false, seq: 99, mac: 'f'.repeat(64) }, '0') === false);
  check('the genuine one is', b.pageNoticeSigned('media', idle, '0') === true);
  check('once', b.pageNoticeSigned('media', idle, '0') === false);
  const loop = e.notice({ source: 'wardenone-reload-loop', token: TOKEN, kind: 'reload-loop' }, '');
  check('the reload-loop panel request is signed and believed', b.pageNoticeSigned('reload-loop', loop, '') === true);
  check('a media report is not accepted as a reload-loop request', b.pageNoticeSigned('reload-loop', e.notice({ source: 'x', token: TOKEN, kind: 'media' }, ''), '') === false);
}

console.log('the bridge\'s own notice');
{
  const b = bridgeRealm();
  const e = engineRealm();
  e.arm(TOKEN, KEY);
  check('the answer to a right-click check goes out signed', b.dispatchLocalNotice('detected_manual_check', { why: 'example.com: nothing known', action: 'You asked' }) === true);
  const n = b.state.dispatched[0];
  check('as the "bridge" sender, and the engine\'s notice card believes it', n && n.src === 'bridge' && e.trusted(JSON.parse(JSON.stringify(n))) === true);
  check('it will sign nothing but that notice', b.dispatchLocalNotice('blocked_payment_card_submit', {}) === false && b.state.dispatched.length === 1);
  check('it is reachable from the extension\'s own world only', typeof b.window.__wardenOneLocalNotice === 'function');
  check('the bridge does not record its own notice as a finding', /if \(!eventSigned\(d\) \|\| d\.src === 'bridge'\) return;/.test(BRIDGE));
}

console.log('wiring');
check('the engine\'s notice card, page badge and risk score believe only signed events',
  (CONTENT.match(/if\(!__woEventTrusted\((?:e\.detail|d)\)\)return;/g) || []).length === 3);
check('the media-active flag and the reload-loop panel need a signed report',
  /pageNoticeSigned\('media', e\.data, e\.data\.active \? '1' : '0'\)/.test(BRIDGE) && /pageNoticeSigned\('reload-loop', e\.data, ''\)/.test(BRIDGE));
check('the permission-chain relay needs a signed signal', /!permissionChainGuardOn\(\) \|\| !permissionSignalSigned\(d\)\) return;/.test(BRIDGE));
check('the worker hands the right-click answer to the bridge, and falls back to a system notification',
  /window\.__wardenOneLocalNotice\('detected_manual_check'/.test(read('background.js')) && /results\[0\]\.result === true\) return true;/.test(read('background.js')));
/* SEC-14: the notice mute and "shown" requests. A page holding only the token could mute a
   class of security notices on every site, for good, with one message. */
console.log('notice mutes');
{
  const relay = {
    TOKEN, KEY, Set, Object, String, Number, JSON, Uint8Array, Uint32Array, Math, Array,
    location: { hostname: 'shop.example' },
  };
  vm.createContext(relay);
  vm.runInContext([
    authBlock(BRIDGE, 'bridge.js'),
    'const KEY_PADS = KEY ? __woAuth.key(KEY) : null;',
    'const relaySamePageHost = () => true;',
    between(BRIDGE, '    let relayRequestSeqSeen = 0;', '    const postBackgroundReply', 'the relay\'s request check'),
    'this.allowed = relayAllowedMessage;',
  ].join('\n'), relay, { filename: 'bridge.js:relay' });
  const e = engineRealm();
  e.arm(TOKEN, KEY);
  const mute = e.request({ kind: 'mute-toast', type: 'warned_clickfix_correlated', minutes: 0 });
  check('the engine signs a mute it sends', Number.isInteger(mute.rseq) && /^[0-9a-f]{64}$/.test(mute.rmac));
  const passed = relay.allowed(JSON.parse(JSON.stringify(mute)));
  check('the bridge relays a signed mute, stripped to its fields', !!passed && passed.kind === 'mute-toast' && passed.minutes === 0 && !('rmac' in passed));
  check('but not the same one twice', relay.allowed(JSON.parse(JSON.stringify(mute))) === null);
  check('nor a token-only mute from the page -- the attack', relay.allowed({ kind: 'mute-toast', type: 'warned_clickfix_correlated', minutes: 0 }) === null);
  const changed = Object.assign(JSON.parse(JSON.stringify(e.request({ kind: 'mute-toast', type: 'behavioral_risk', minutes: 60 }))), { minutes: 0 });
  check('nor a signed one-hour mute turned into "forever"', relay.allowed(changed) === null);
  const retyped = Object.assign(JSON.parse(JSON.stringify(e.request({ kind: 'mute-toast', type: 'blocked_popup', minutes: 60 }))), { type: 'warned_potential_xss_sink' });
  check('nor one pointed at another notice type', relay.allowed(retyped) === null);
  const shown = e.request({ kind: 'toast-shown', type: 'warned_clickfix_correlated' });
  check('a signed "shown" is relayed', !!relay.allowed(JSON.parse(JSON.stringify(shown))));
  check('a forged "shown" that would quieten the page\'s own warnings is not', relay.allowed({ kind: 'toast-shown', type: 'warned_clickfix_correlated' }) === null);
  const shownAsMute = Object.assign(JSON.parse(JSON.stringify(e.request({ kind: 'toast-shown', type: 'blocked_popup' }))), { kind: 'mute-toast', minutes: 0 });
  check('and a "shown" signature does not pass as a mute', relay.allowed(shownAsMute) === null);
}
check('the notice card signs both requests and only a real click mutes',
  /__woBackgroundRequest\(__woSignedRequest\(\{kind:"mute-toast",type:type,minutes:minutes\}\)\)/.test(CONTENT)
    && /__woBackgroundRequest\(__woSignedRequest\(\{kind:"toast-shown",type:type\}\)\)/.test(CONTENT)
    && /ev=>\{\s*if\(!ev\.isTrusted\)return;\s*try\{\s*ev\.preventDefault\(\),\s*ev\.stopPropagation\(\),\s*__woBackgroundRequest\(__woSignedRequest\(\{kind:"mute-toast"/.test(CONTENT));

const MIN = read('content.min.js');
check('and the built engine carries all of it', MIN.indexOf('__woEventTrusted(') > 0 && MIN.indexOf('__woSignedNotice(') > 0 && MIN.indexOf('eventText:eventText') > 0);

if (failed) { console.error('\n' + failed + ' key/signal check(s) failed'); process.exit(1); }
console.log('\nall key-isolation and signed-signal checks passed');

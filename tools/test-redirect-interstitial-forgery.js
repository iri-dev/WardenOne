/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A page cannot summon WardenOne's redirect interstitial for a destination of its own.
 * Run: node tools/test-redirect-interstitial-forgery.js
 *
 * The in-page guard (anti-redirect.js, MAIN world) cancels a forced same-tab jump and emits
 * blocked_gestureless_nav. When the jump followed a real click -- the ambiguous case where
 * "Continue" might genuinely be wanted -- the bridge relays a redirect-warning to the worker,
 * which navigates the tab to WardenOne's own warning page with a Continue button pointing at
 * the event's url. The bridge used to relay that on the routing token alone, and the token is
 * public (SEC-01): any script on the page could dispatch
 *   wo-event {type:'blocked_gestureless_nav', detail:{url:<attacker>, why:'...', silent:false}}
 * and put its own landing page behind a genuine, WardenOne-branded Continue button on a real
 * chrome-extension:// page -- eight times a minute, which also trains the reader to click
 * through the interstitial a real hijack would raise (SEC-15).
 *
 * The request is now signed the way the navigation signals are (SEC-13): the guard signs it
 * under the bridge's key -- handed to the MAIN world once at document_start, before any page
 * script existed -- over a number that only moves forward and the destination, the reason and
 * the kind the interstitial will show. The bridge relays an interstitial request for nothing
 * that fails the signature, repeats a number or was altered in flight. The badge count for the
 * same event is unchanged: it was never the worker DOING something. The real emitter and the
 * real relay are lifted and driven here, as the page would attack each of them.
 *
 * Control: WARDENONE_BRIDGE / WARDENONE_ANTI_REDIRECT point at pre-fix copies.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GUARD = fs.readFileSync(process.env.WARDENONE_ANTI_REDIRECT || path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BRIDGE = fs.readFileSync(process.env.WARDENONE_BRIDGE || path.join(ROOT, 'bridge.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function grabFn(src, name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'missing ' + name);
  return balanced(src, m.index);
}
function balanced(src, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated block');
}
function iife(src, marker) {
  const i = src.indexOf(marker);
  assert(i >= 0, 'missing ' + marker);
  const body = balanced(src, i);
  const close = src.indexOf('})();', i + body.length - 1);
  assert(close >= 0, 'unterminated iife ' + marker);
  return src.slice(i, close + '})();'.length);
}
const optional = (src, re) => { const m = re.exec(src); return m ? m[0].trim() : ''; };
const TOKEN = 'tok-' + crypto.randomBytes(8).toString('hex');
const KEY = crypto.randomBytes(32).toString('hex');
const PAGE_KEY = crypto.randomBytes(32).toString('hex');
const hmacHex = (keyHex, text) => crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(text, 'utf8').digest('hex');
const sig = (seq, url, why, kind) => 'redirect-warning\n' + seq + '\n' + url + '\n' + (why || '') + '\n' + (kind || '');

/* ---- the bridge's wo-event relay, in the isolated world ---------------------------------- */
function bridgeRealm(opts) {
  const o = opts || {};
  const relayStart = BRIDGE.indexOf("woOn(window, 'wo-event'");
  assert(relayStart >= 0, 'the bridge no longer relays wo-event');
  const listener = balanced(BRIDGE, relayStart) + ');';
  const engineMacLine = /^\s*const engineMac = [^\n]+/m.exec(BRIDGE);
  assert(engineMacLine, 'engineMac is gone from the bridge');
  const state = { sent: [], listeners: {} };
  const sandbox = {
    TOKEN, KEY: o.key === undefined ? KEY : o.key, Number, String, Object, RegExp, Date, Uint8Array, Uint32Array, Math, Array, WeakSet, Set, JSON,
    chrome: { runtime: { lastError: null, sendMessage: (msg) => { state.sent.push(JSON.parse(JSON.stringify(msg))); } } },
    document: { dispatchEvent(ev) { const fn = state.listeners[ev.type]; if (fn) fn(ev); return true; } },
    window: {},
    woOn: (target, type, fn) => { state.listeners[type] = fn; },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext([
    iife(BRIDGE, 'const __woAuth=(function(){'),
    engineMacLine[0].trim(),
    'const BRIDGE_RATE = Object.create(null);',
    grabFn(BRIDGE, 'bridgeRateOk'),
    grabFn(BRIDGE, 'boundedBridgeDetail'),
    'let bridgeEngineSeen = false; let bridgePendingPong = null;',
    /* The event signature every security event now needs (bridge.js eventSigned). */
    BRIDGE.slice(BRIDGE.indexOf('  const KEY_PADS = KEY ?'), BRIDGE.indexOf('  let bridgeEventSeq = 0;')),
    optional(BRIDGE, /^\s*let interstitialSeqSeen = 0;/m),
    optional(BRIDGE, /^\s*const interstitialRequestSigned = \(detail\) => \{[\s\S]*?\n  \};/m),
    listener,
    'this.__woAuth = __woAuth;',
  ].join('\n'), ctx, { filename: 'bridge-relay.js' });
  return {
    state,
    auth: sandbox.__woAuth,
    dispatch: (detail) => sandbox.document.dispatchEvent({ type: 'wo-event', detail }),
    interstitials: () => state.sent.filter((m) => m.kind === 'redirect-warning'),
    badges: () => state.sent.filter((m) => m.kind === 'rg-block'),
  };
}

/* ---- the in-page guard's emitter, in the MAIN world --------------------------------------- */
function emitterRealm(onDetail, opts) {
  const o = opts || {};
  const seen = [];
  const sandbox = {
    Date, Object, String, Number, Uint8Array, Uint32Array, Math, Array,
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    document: { dispatchEvent(ev) { seen.push(ev.detail); if (onDetail) onDetail(ev.detail); return true; } },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext([
    iife(GUARD, 'const __woAuth=(function(){'),
    'let token = ' + JSON.stringify(o.token === undefined ? TOKEN : o.token) + '; let woKey = ' + JSON.stringify(o.key === undefined ? KEY : o.key) + ';',
    'let queuedEvents = [];',
    optional(GUARD, /^\s*let interstitialSeq = 0;/m),
    optional(GUARD, /^\s*let hardenerEventSeq = 0;/m),
    (/^\s*function signInterstitial\(/m.test(GUARD) ? grabFn(GUARD, 'signInterstitial') : ''),
    grabFn(GUARD, 'emit'),
    grabFn(GUARD, 'flushEvents'),
    'this.__emit = emit; this.__flush = flushEvents; this.__arm = (t, k) => { token = t; woKey = k; };',
  ].join('\n'), ctx, { filename: 'guard-emitter.js' });
  return { seen, emit: sandbox.__emit, flush: sandbox.__flush, arm: sandbox.__arm };
}

const ATTACKER = 'https://attacker.example/landing?x=1';
const forged = (extra) => ({
  token: TOKEN, type: 'blocked_gestureless_nav', at: Date.now(),
  detail: Object.assign({ kind: 'assign', url: ATTACKER, matched: 'attacker.example', why: 'forced redirect after a click', silent: false }, extra || {}),
});

/* A security event the way the guard now sends one: the event itself signed as the 'hardener'
   (bridge.js eventSigned), whatever interstitial signature its detail carries. Wrapping a request
   in a genuine event signature isolates the interstitial's own check -- as if the guard itself had
   sent that exact detail. */
let nextEventSeq = 1;
const asEvent = (b, d, key) => {
  const eseq = nextEventSeq++;
  return Object.assign({}, d, { src: 'hardener', eseq, emac: hmacHex(key || KEY, b.auth.eventText('hardener', eseq, d.type, d.detail)) });
};

/* ---- 1. the attack as written, and every variation a page can produce -------------------- */
{
  const b = bridgeRealm();
  b.dispatch(forged());
  check('the attack as written: a token-only blocked_gestureless_nav raises no interstitial', b.interstitials().length === 0, JSON.stringify(b.interstitials()));
  check('and, carrying only the public token, it is not believed at all: no badge count, no Activity entry',
    b.badges().length === 0, JSON.stringify(b.badges()));
  b.dispatch(asEvent(b, forged(), PAGE_KEY));
  check('an event signed with a key of the page\'s own counts for nothing either', b.badges().length === 0 && b.interstitials().length === 0);
  b.dispatch(forged({ seq: 1, mac: 'f'.repeat(64) }));
  check('a made-up signature raises none', b.interstitials().length === 0);
  b.dispatch(forged({ seq: 1, mac: hmacHex(PAGE_KEY, sig(1, ATTACKER, 'forced redirect after a click', 'assign')) }));
  check('a request signed with a key of the page\'s own raises none', b.interstitials().length === 0);
  b.dispatch(forged({ seq: 1, mac: hmacHex(KEY, 'nav-signal\n1\ntop-nav-authorized\nattacker.example') }));
  check('a genuine signature for a different purpose (a nav signal) raises none', b.interstitials().length === 0);
  for (let i = 0; i < 40; i++) b.dispatch(forged({ seq: 100 + i, mac: crypto.randomBytes(32).toString('hex') }));
  check('forty guesses raise none', b.interstitials().length === 0);
}

/* ---- 2. what the relay accepts, and what it refuses under a genuine signature -------------- */
{
  const b = bridgeRealm();
  const genuine = asEvent(b, forged({ seq: 1, mac: hmacHex(KEY, sig(1, ATTACKER, 'forced redirect after a click', 'assign')) }));
  b.dispatch(genuine);
  check('a request signed under the bridge\'s key is relayed, with its destination',
    b.interstitials().length === 1 && b.interstitials()[0].detail.url === ATTACKER && b.interstitials()[0].detail.why === 'forced redirect after a click', JSON.stringify(b.interstitials()));
  check('and the event is counted once', b.badges().length === 1 && b.badges()[0].type === 'blocked_gestureless_nav');
  b.dispatch(genuine);
  check('the same event again -- the page saw it and replays it -- is not relayed or counted twice', b.interstitials().length === 1 && b.badges().length === 1);
  b.dispatch(Object.assign({}, genuine, { detail: Object.assign({}, genuine.detail, { seq: 2 }) }));
  check('altering what a signed event says, without its key, is not believed at all', b.interstitials().length === 1 && b.badges().length === 1);
  /* From here the event itself is genuinely signed, so only the interstitial's own signature decides. */
  b.dispatch(asEvent(b, forged({ seq: 2, mac: hmacHex(KEY, sig(1, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('moving its number forward without re-signing is not relayed', b.interstitials().length === 1);
  b.dispatch(asEvent(b, forged({ seq: 2, url: 'https://elsewhere.example/', mac: hmacHex(KEY, sig(2, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('changing the destination under a genuine signature is not relayed: the destination is signed', b.interstitials().length === 1);
  b.dispatch(asEvent(b, forged({ seq: 2, why: 'WardenOne verified this site', mac: hmacHex(KEY, sig(2, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('changing the reason the interstitial will show is not relayed: the reason is signed', b.interstitials().length === 1);
  b.dispatch(asEvent(b, forged({ seq: 2, mac: hmacHex(KEY, sig(2, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('a later, correctly signed request is (this is the guard\'s own path, not the page\'s)', b.interstitials().length === 2);
  b.dispatch(asEvent(b, forged({ seq: 1, mac: hmacHex(KEY, sig(1, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('a number that went backwards is not relayed', b.interstitials().length === 2);
  b.dispatch(asEvent(b, forged({ seq: 3, silent: true, mac: hmacHex(KEY, sig(3, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('silent stays silent even when signed: the reader kept their page, no Continue is offered', b.interstitials().length === 2);
  b.dispatch(asEvent(b, forged({ seq: 4, why: 'no recent user gesture', mac: hmacHex(KEY, sig(4, ATTACKER, 'no recent user gesture', 'assign')) })));
  check('a jump with no gesture behind it stays badge-only even when signed', b.interstitials().length === 2);
}
{
  const b = bridgeRealm({ key: '' });
  b.dispatch(asEvent(b, forged({ seq: 1, mac: hmacHex(KEY, sig(1, ATTACKER, 'forced redirect after a click', 'assign')) })));
  check('a bridge that never had a key believes no event at all', b.interstitials().length === 0 && b.badges().length === 0);
}

/* ---- 3. the emitter and the relay agree, end to end ---------------------------------------- */
{
  const b = bridgeRealm();
  const em = emitterRealm((d) => b.dispatch(d));
  em.emit('blocked_gestureless_nav', { kind: 'assign', url: 'https://rm358.example/4/11216888', matched: 'rm358.example', why: 'forced redirect after a click', silent: false });
  check('the guard\'s own cancelled jump reaches the worker as an interstitial request',
    b.interstitials().length === 1 && b.interstitials()[0].detail.url === 'https://rm358.example/4/11216888', JSON.stringify(b.interstitials()));
  const d = em.seen[0] && em.seen[0].detail;
  check('it carried a number and a signature, and no key',
    d && Number.isInteger(d.seq) && /^[0-9a-f]{64}$/.test(d.mac) && JSON.stringify(em.seen[0]).indexOf(KEY) === -1, JSON.stringify(em.seen[0]));
  /* The page saw that event too. Everything it can do with it: */
  b.dispatch(em.seen[0]);
  b.dispatch(Object.assign({}, em.seen[0], { detail: Object.assign({}, d, { url: ATTACKER }) }));
  b.dispatch(Object.assign({}, em.seen[0], { detail: Object.assign({}, d, { seq: d.seq + 1 }) }));
  b.dispatch(Object.assign({}, em.seen[0], { detail: Object.assign({}, d, { why: 'WardenOne verified this site' }) }));
  check('replaying it, re-addressing it, renumbering it or re-wording it relays nothing', b.interstitials().length === 1, b.interstitials().length + ' relayed');
  em.emit('blocked_gestureless_nav', { kind: 'href', url: 'https://second.example/', matched: 'second.example', why: 'click did not target this site', silent: false });
  check('the guard\'s next cancelled jump is relayed with the next number', b.interstitials().length === 2 && b.interstitials()[1].detail.url === 'https://second.example/');
  em.emit('blocked_gestureless_nav', { kind: 'assign', url: 'https://third.example/', matched: 'third.example', why: 'no recent user gesture', silent: true });
  check('a silent block is emitted without a signature: nothing to authorise', em.seen[2].detail.mac === undefined && b.interstitials().length === 2, JSON.stringify(em.seen[2]));
  const badgesBefore = b.badges().length;
  em.emit('blocked_popup', { kind: 'click', url: 'https://popup.example/', matched: 'popup.example', why: 'blank popup opened from the page', silent: true });
  check('a popup block carries no interstitial signature: it is counted, and offers no Continue',
    em.seen[3].detail.mac === undefined && /^[0-9a-f]{64}$/.test(em.seen[3].emac) && b.badges().length === badgesBefore + 1 && b.interstitials().length === 2);
  check('every event the guard sends is signed as an event, and none carries the key',
    em.seen.every((e) => e.src === 'hardener' && Number.isInteger(e.eseq) && /^[0-9a-f]{64}$/.test(e.emac)) && JSON.stringify(em.seen).indexOf(KEY) === -1);
}
{
  /* Events queued before the key arrive are signed when they are flushed, not when queued. */
  const b = bridgeRealm();
  const em = emitterRealm((d) => b.dispatch(d), { token: null, key: null });
  em.emit('blocked_gestureless_nav', { kind: 'assign', url: 'https://queued.example/', matched: 'queued.example', why: 'forced redirect after a click', silent: false });
  check('before the handshake nothing is dispatched', em.seen.length === 0);
  em.arm(TOKEN, KEY);
  em.flush();
  check('flushed after the handshake, the queued request is signed and relayed',
    em.seen.length === 1 && /^[0-9a-f]{64}$/.test(em.seen[0].detail.mac) && b.interstitials().length === 1 && b.interstitials()[0].detail.url === 'https://queued.example/', JSON.stringify(em.seen));
}
{
  /* A world with the token but no key cannot sign; the block still counts, the Continue offer is withheld. */
  const b = bridgeRealm();
  const em = emitterRealm((d) => b.dispatch(d), { key: null });
  em.emit('blocked_gestureless_nav', { kind: 'assign', url: ATTACKER, matched: 'attacker.example', why: 'forced redirect after a click', silent: false });
  check('with the token but no key, the event goes out unsigned, and nothing believes it',
    em.seen.length === 1 && em.seen[0].detail.mac === undefined && em.seen[0].emac === undefined && b.badges().length === 0 && b.interstitials().length === 0, JSON.stringify(em.seen));
}

/* ---- 4. the wiring, in the shipped files ---------------------------------------------------- */
check('the relay still bounds the detail it forwards (test-bridge-bounds pins the same string)',
  BRIDGE.indexOf("kind: 'redirect-warning', detail: boundedBridgeDetail(d.detail)") > 0);
check('the relay believes a security event only when it is signed, before it forwards anything',
  /if \(!eventSigned\(d\) \|\| d\.src === 'bridge'\) return;/.test(BRIDGE)
  && BRIDGE.indexOf('if (!eventSigned(d)') < BRIDGE.indexOf("kind: 'rg-block', type"));
check('the relay checks the signature before it forwards an interstitial request',
  /if \(!interstitialRequestSigned\(d\.detail\)\) return;/.test(BRIDGE)
  && BRIDGE.indexOf('interstitialRequestSigned(d.detail)') < BRIDGE.indexOf("kind: 'redirect-warning', detail: boundedBridgeDetail(d.detail)"));
check('the guard signs at dispatch, after the queue, so a queued request is signed when it goes out',
  /function emit\(type, detail\) \{[\s\S]*?queuedEvents\.push\(payload\);[\s\S]*?signInterstitial\(payload\.detail\)/.test(GUARD));
check('the signature covers the number, the destination, the reason and the kind on both sides',
  /'redirect-warning\\n' \+ interstitialSeq \+ '\\n' \+ String\(detail\.url\) \+ '\\n' \+ String\(detail\.why \|\| ''\) \+ '\\n' \+ String\(detail\.kind \|\| ''\)/.test(GUARD)
  && /engineMac\('redirect-warning', seq \+ '\\n' \+ String\(detail\.url\) \+ '\\n' \+ String\(detail\.why \|\| ''\) \+ '\\n' \+ String\(detail\.kind \|\| ''\)\)/.test(BRIDGE));

finished = true;
console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
process.exitCode = 0;
console.log('  ok  ' + pass + ' checks: a page can dispatch a blocked-redirect event all day and never put its own site behind Continue');

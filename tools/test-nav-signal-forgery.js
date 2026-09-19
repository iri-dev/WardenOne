/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A page cannot tell the worker that the reader authorised a navigation.
 * Run: node tools/test-nav-signal-forgery.js
 *
 * The forced-redirect interstitial (blockPopupTricks) fires when a page sends the whole tab to
 * another site by client_redirect and nothing in the tab explains it. What explains it is a
 * navigation signal from the in-page guard -- 'gesture' for a real click or keypress,
 * 'top-nav-authorized' when the guard's own logic let a navigation through -- relayed by the
 * isolated bridge to the worker. The bridge used to accept any wo-nav-signal that carried the
 * routing token, and the token is public: a page that dispatched
 * {token, kind:'top-nav-authorized'} every two seconds held the interstitial off for its own tab
 * for as long as it liked, no gesture required (SEC-13).
 *
 * Now the emitter signs each beacon -- an HMAC under the bridge's key, which the MAIN world was
 * handed once at document_start before any page script existed, over a sequence number, the kind
 * and the destination host -- and the bridge relays nothing that fails the signature, repeats a
 * number, or names no host for an authorisation. The worker binds an authorisation to the host it
 * was given for, so a genuine one cannot be armed with a decoy and spent on a different jump. The
 * real emitter, the real relay and the real worker guard are lifted and driven here, end to end
 * and as the page would attack each of them.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const GUARD = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

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
/* From `start`, the text through the brace that closes the first `{` after it. */
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
const TOKEN = 'tok-' + crypto.randomBytes(8).toString('hex');
const KEY = crypto.randomBytes(32).toString('hex');
const PAGE_KEY = crypto.randomBytes(32).toString('hex');

/* ---- the bridge's relay, in the isolated world -------------------------------------------- */
function bridgeRealm() {
  const relayStart = BRIDGE.indexOf("woOn(document, 'wo-nav-signal'");
  assert(relayStart >= 0, 'the bridge no longer relays wo-nav-signal');
  const listener = balanced(BRIDGE, relayStart) + ');';
  const seqLine = /^\s*let navSignalSeqSeen = 0;/m.exec(BRIDGE);
  const engineMacLine = /^\s*const engineMac = [^\n]+/m.exec(BRIDGE);
  assert(engineMacLine, 'engineMac is gone from the bridge');
  const state = { relayed: [], listeners: {} };
  const sandbox = {
    TOKEN, KEY, Number, String, Object, RegExp, Date, Uint8Array, Uint32Array, Math,
    chrome: { runtime: { lastError: null, sendMessage: (msg) => { state.relayed.push(JSON.parse(JSON.stringify(msg))); } } },
    document: { dispatchEvent(ev) { const fn = state.listeners[ev.type]; if (fn) fn(ev); return true; } },
    woOn: (target, type, fn) => { state.listeners[type] = fn; },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext([
    iife(BRIDGE, 'const __woAuth=(function(){'),
    engineMacLine[0].trim(),
    'const BRIDGE_RATE = Object.create(null);',
    grabFn(BRIDGE, 'bridgeRateOk'),
    seqLine ? seqLine[0].trim() : '',
    listener,
    'this.__auth = __woAuth;',
  ].join('\n'), ctx, { filename: 'bridge-relay.js' });
  return { state, auth: sandbox.__auth, dispatch: (detail) => sandbox.document.dispatchEvent({ type: 'wo-nav-signal', detail }) };
}

/* ---- the in-page guard's emitter, in the MAIN world ---------------------------------------- */
function emitterRealm(onDetail) {
  const sandbox = {
    Date, Object, String, Number, Uint8Array, Uint32Array, Math,
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    document: { dispatchEvent(ev) { onDetail(ev.detail); return true; } },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext([
    iife(GUARD, 'const __woAuth=(function(){'),
    'let token = TOKEN_IN; let woKey = KEY_IN; let lastGestureBeacon = 0; let navSignalSeq = 0;',
    grabFn(GUARD, 'signal'),
    'this.__signal = signal;',
  ].join('\n').replace('TOKEN_IN', JSON.stringify(TOKEN)).replace('KEY_IN', JSON.stringify(KEY)), ctx, { filename: 'guard-emitter.js' });
  return { signal: sandbox.__signal };
}

/* ---- the worker's guard ----------------------------------------------------------------------- */
function workerRealm(options) {
  const o = options || {};
  const START = 'const PLAYER_GESTURE_AT = Object.create(null);';
  const END = 'async function evaluateRedirectChain(details) {';
  const from = BG.indexOf(START);
  const to = BG.indexOf(END, from + START.length);
  assert(from >= 0 && to > from, 'the forced-redirect guard moved in background.js');
  const updates = [];
  const history = [];
  const sandbox = {
    DEFAULT_CONFIG: { enabled: true, blockPopupTricks: true, allowlist: [] },
    localGet: () => Promise.resolve({ wardenone_config: o.config || {} }),
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [],
    registrableDomain: (host) => String(host || '').split('.').slice(-2).join('.'),
    registrableDomainBg: (host) => String(host || '').split('.').slice(-2).join('.'),
    queueHistory: (entry) => history.push(entry),
    redirectWarningPageUrl: (info) => 'chrome-extension://x/redirect-warning.html?to=' + encodeURIComponent(info.targetUrl),
    chrome: { tabs: { update: (id, props) => { updates.push({ id, props }); return Promise.resolve(); } } },
    isLoginCompatibilityUrl: (u) => /accounts\.google|login\.microsoftonline|\/oauth|\/saml/i.test(String(u || '')),
    URL, Object, Date, String, Number, Promise, RegExp,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(grabFn(BG, 'messageCleanHost') + '\n' + BG.slice(from, to)
    + '\nthis.__state = { PLAYER_GESTURE_AT, TOP_NAV_OWNED_AT, LAST_TOP_URL, LAST_GESTURE_AT, TOP_NAV_OWNED_HOST: typeof TOP_NAV_OWNED_HOST !== "undefined" ? TOP_NAV_OWNED_HOST : null };',
    ctx, { filename: 'worker-guard.js' });
  return {
    updates, history, state: sandbox.__state,
    signal: (tabId, kind, host) => sandbox.noteNavSignal(tabId, kind, host),
    committed: (tabId, url) => { sandbox.__state.LAST_TOP_URL[tabId] = url; },
    forget: (tabId) => sandbox.forgetNavSignals(tabId),
    forced: (tabId, url) => sandbox.maybeBlockForcedTopRedirect({ tabId, frameId: 0, url, transitionQualifiers: ['client_redirect'] }),
    frame: (tabId, url) => sandbox.maybeFlagFrameDrivenRedirect({ tabId, frameId: 0, url }),
  };
}
const hmacHex = (keyHex, text) => crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(text, 'utf8').digest('hex');

(async () => {
  /* ---- 1. the relay: what a page can dispatch, and what counts --------------------------------- */
  {
    const b = bridgeRealm();
    b.dispatch({ token: TOKEN, kind: 'top-nav-authorized', host: 'evil.example' });
    check('the attack as written: a token-only authorisation is not relayed', b.state.relayed.length === 0, JSON.stringify(b.state.relayed));
    b.dispatch({ token: TOKEN, kind: 'gesture' });
    check('nor a token-only gesture', b.state.relayed.length === 0);
    b.dispatch({ token: TOKEN, kind: 'top-nav-authorized', host: 'evil.example', seq: 1, mac: 'f'.repeat(64) });
    check('a made-up signature is not relayed', b.state.relayed.length === 0);
    b.dispatch({ token: TOKEN, kind: 'top-nav-authorized', host: 'evil.example', seq: 1, mac: hmacHex(PAGE_KEY, 'nav-signal\n1\ntop-nav-authorized\nevil.example') });
    check('a beacon signed with a key of the page\'s own is not relayed', b.state.relayed.length === 0);
    b.dispatch({ token: TOKEN, kind: 'top-nav-authorized', seq: 1, mac: hmacHex(KEY, 'nav-signal\n1\ntop-nav-authorized\n') });
    check('an authorisation that names no host is not relayed, even correctly signed', b.state.relayed.length === 0);
    for (let i = 0; i < 40; i++) b.dispatch({ token: TOKEN, kind: 'top-nav-authorized', host: 'evil.example', seq: 100 + i, mac: crypto.randomBytes(32).toString('hex') });
    check('forty guesses a second still relay nothing', b.state.relayed.length === 0);
  }
  {
    const b = bridgeRealm();
    const genuine = { token: TOKEN, kind: 'top-nav-authorized', host: 'payments.example', seq: 1, mac: hmacHex(KEY, 'nav-signal\n1\ntop-nav-authorized\npayments.example') };
    b.dispatch(genuine);
    check('a beacon signed under the bridge\'s key is relayed, with its kind and its host',
      b.state.relayed.length === 1 && b.state.relayed[0].signal === 'top-nav-authorized' && b.state.relayed[0].host === 'payments.example', JSON.stringify(b.state.relayed));
    b.dispatch(genuine);
    check('the same beacon again -- the page saw it and replays it -- is not relayed twice', b.state.relayed.length === 1);
    b.dispatch(Object.assign({}, genuine, { seq: 2 }));
    check('moving its number forward without re-signing is not relayed', b.state.relayed.length === 1);
    b.dispatch(Object.assign({}, genuine, { seq: 2, host: 'evil.example', mac: hmacHex(KEY, 'nav-signal\n2\ntop-nav-authorized\npayments.example') }));
    check('changing the host under a genuine signature is not relayed: the host is signed', b.state.relayed.length === 1);
    b.dispatch({ token: TOKEN, kind: 'top-nav-authorized', host: 'evil.example', seq: 2, mac: hmacHex(KEY, 'nav-signal\n2\ntop-nav-authorized\nevil.example') });
    check('a later, correctly signed beacon is (this is the emitter\'s own path, not the page\'s)', b.state.relayed.length === 2);
    b.dispatch({ token: TOKEN, kind: 'gesture', seq: 1, mac: hmacHex(KEY, 'nav-signal\n1\ngesture\n') });
    check('a sequence number that went backwards is not relayed whatever the kind', b.state.relayed.length === 2);
    b.dispatch({ token: TOKEN, kind: 'gesture', seq: 3, mac: hmacHex(KEY, 'nav-signal\n3\ngesture\n') });
    check('a signed gesture with the next number is', b.state.relayed.length === 3 && b.state.relayed[2].signal === 'gesture' && b.state.relayed[2].host === '');
  }

  /* ---- 2. the emitter and the relay agree, end to end -------------------------------------------- */
  {
    const b = bridgeRealm();
    const seen = [];
    const em = emitterRealm((detail) => { seen.push(detail); b.dispatch(detail); });
    em.signal('top-nav-authorized', { host: 'payments.example' });
    check('the guard\'s own authorisation reaches the worker', b.state.relayed.length === 1 && b.state.relayed[0].host === 'payments.example', JSON.stringify(b.state.relayed));
    check('it carried a number and a signature, and no key', seen.length === 1 && Number.isInteger(seen[0].seq) && /^[0-9a-f]{64}$/.test(seen[0].mac) && JSON.stringify(seen[0]).indexOf(KEY) === -1, JSON.stringify(seen[0]));
    /* The page saw that event too. Everything it can do with it: */
    b.dispatch(seen[0]);
    b.dispatch(Object.assign({}, seen[0], { host: 'evil.example' }));
    b.dispatch(Object.assign({}, seen[0], { seq: seen[0].seq + 1 }));
    check('replaying it, re-addressing it or renumbering it relays nothing', b.state.relayed.length === 1, b.state.relayed.length + ' relayed');
    em.signal('gesture');
    em.signal('gesture');
    check('a real gesture is relayed (and the emitter\'s own half-second throttle holds)', b.state.relayed.length === 2 && b.state.relayed[1].signal === 'gesture');
    em.signal('player-gesture');
    check('a player gesture is relayed', b.state.relayed.length === 3 && b.state.relayed[2].signal === 'player-gesture');
  }
  {
    /* Before the key has arrived there is nothing to sign with, and nothing goes out. */
    const seen = [];
    const sandbox = {
      Date, Object, String, Number, Uint8Array, Uint32Array, Math,
      CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
      document: { dispatchEvent(ev) { seen.push(ev.detail); return true; } },
    };
    vm.createContext(sandbox);
    vm.runInContext([iife(GUARD, 'const __woAuth=(function(){'), 'let token = ' + JSON.stringify(TOKEN) + '; let woKey = null; let lastGestureBeacon = 0; let navSignalSeq = 0;', grabFn(GUARD, 'signal'), 'this.__signal = signal;'].join('\n'), sandbox);
    sandbox.__signal('top-nav-authorized', { host: 'x.example' });
    check('with the token but no key yet, the emitter sends nothing rather than something unsigned', seen.length === 0, JSON.stringify(seen));
  }

  /* ---- 3. the worker: an authorisation is for one destination ----------------------------------- */
  const EVIL = 'https://rm358.example/4/11216888?var=1&ymid=2';
  {
    const w = workerRealm();
    w.committed(1, 'https://yomi.to/watch/x');
    await w.forced(1, EVIL);
    check('with no signal at all, a cross-site client_redirect is interposed', w.updates.length === 1 && w.history.length === 1, JSON.stringify(w.updates));
  }
  {
    const w = workerRealm();
    w.committed(1, 'https://yomi.to/watch/x');
    const r = w.signal(1, 'top-nav-authorized', 'decoy.example');
    await w.forced(1, EVIL);
    check('an authorisation for one host does not explain a jump to another', w.updates.length === 1, JSON.stringify({ r, updates: w.updates.length }));
  }
  {
    const w = workerRealm();
    w.committed(1, 'https://shop.example/cart');
    w.signal(1, 'top-nav-authorized', 'payments.example');
    await w.forced(1, 'https://payments.example/checkout');
    check('an authorisation for the host actually navigated to does', w.updates.length === 0 && w.history.length === 0, JSON.stringify(w.updates));
  }
  {
    const w = workerRealm();
    w.committed(1, 'https://shop.example/cart');
    w.signal(1, 'top-nav-authorized', 'www.pay.payments.example');
    await w.forced(1, 'https://payments.example/checkout');
    check('the binding is by registrable domain, so a subdomain announcement covers the site', w.updates.length === 0, JSON.stringify(w.updates));
  }
  {
    const w = workerRealm();
    w.committed(1, 'https://yomi.to/watch/x');
    const r = w.signal(1, 'top-nav-authorized');
    await w.forced(1, EVIL);
    check('an authorisation with no host is refused and arms nothing', r && r.ok === false && w.updates.length === 1 && !w.state.TOP_NAV_OWNED_AT[1], JSON.stringify(r));
    const r2 = w.signal(1, 'top-nav-authorized', 'not a host!');
    check('nor one with a host that is not a host', r2 && r2.ok === false && !w.state.TOP_NAV_OWNED_AT[1]);
  }
  {
    const w = workerRealm();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'gesture');
    await w.forced(1, EVIL);
    check('a real gesture still explains a jump, as designed', w.updates.length === 0);
  }
  {
    /* The frame-driven guard reads the same marker with the same binding. */
    const w = workerRealm();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    w.signal(1, 'top-nav-authorized', 'decoy.example');
    await w.frame(1, 'https://fake-google.example/search');
    check('a frame-driven jump is still caught when the announced host is a different one', w.updates.length === 1, JSON.stringify(w.updates));
  }
  {
    const w = workerRealm();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    w.signal(1, 'top-nav-authorized', 'elsewhere.example');
    await w.frame(1, 'https://elsewhere.example/');
    check('and not when our own hooks announced that very host', w.updates.length === 0);
  }
  {
    const w = workerRealm();
    w.signal(1, 'top-nav-authorized', 'payments.example');
    w.forget(1);
    check('a committed page forgets the host with the rest', !w.state.TOP_NAV_OWNED_AT[1] && !(w.state.TOP_NAV_OWNED_HOST && w.state.TOP_NAV_OWNED_HOST[1]));
  }
  {
    /* End to end: the guard's beacon, through the relay, into the worker. */
    const b = bridgeRealm();
    const em = emitterRealm((detail) => b.dispatch(detail));
    em.signal('top-nav-authorized', { host: 'payments.example' });
    const msg = b.state.relayed[0];
    const w = workerRealm();
    w.committed(1, 'https://shop.example/cart');
    w.signal(1, msg.signal, msg.host);
    await w.forced(1, 'https://payments.example/checkout');
    check('end to end: the guard authorises a checkout and the worker lets that checkout through', w.updates.length === 0, JSON.stringify(w.updates));
    await w.forced(1, EVIL);
    check('and still interposes on a jump the authorisation was not for', w.updates.length === 1);
  }

  /* ---- 4. the wiring, in the shipped files ---------------------------------------------------- */
  check('the worker handler passes the host through', /noteNavSignal\(sender && sender\.tab && sender\.tab\.id, msg\.signal, msg\.host\)/.test(BG));
  check('both announcing paths in the guard name the host',
    (GUARD.match(/signal\('top-nav-authorized', \{ host: hostOf\(rawTarget\) \}\)/g) || []).length === 2 && !/signal\('top-nav-authorized'\)/.test(GUARD));
  check('the relay still checks the token and the rate as before', /d\.token !== TOKEN/.test(BRIDGE) && /bridgeRateOk\('wo-nav-signal', 180, 60000\)/.test(BRIDGE));

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: a page can dispatch a navigation signal all day and never make one count');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });

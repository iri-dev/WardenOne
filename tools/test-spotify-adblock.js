/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Behavioural tests for the real Spotify Web Player module (spotify-adblock.js).
 *
 * Spotify's state machine and real media URLs must remain untouched. The player's own loader
 * is handed a one-second silent clip for anything Spotify labels an ad; the network redirect
 * serves the same clip for known ad hosts and it ends naturally; a muted unredirected ad seeks
 * to its own tail. Tests also cover worker-side ad URL discovery, repeated skips, signed
 * controls and fail-open scope.
 *
 * Run: node tools/test-spotify-adblock.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const auth = require('./lib/wo-auth');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'spotify-adblock.js'), 'utf8');
const WORKER_AD_NOTICE = (SOURCE.match(/const WORKER_AD_NOTICE = '([^']+)'/) || [])[1];
const WORKER_AD_CURRENT_NOTICE = (SOURCE.match(/const WORKER_AD_CURRENT_NOTICE = '([^']+)'/) || [])[1];
if (!WORKER_AD_NOTICE || !WORKER_AD_CURRENT_NOTICE) throw new Error('the worker ad URL markers were not found');
const SILENT_CLIP = (SOURCE.match(/const SILENT_CLIP = '(data:video\/mp4;base64,[A-Za-z0-9+/=]+)'/) || [])[1];
if (!SILENT_CLIP) throw new Error('the inlined silent clip was not found');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

/* ---- the live player's state machine, abbreviated ------------------------------------- */
const AD_URI = 'spotify:ad:6c4vpESQOnm5NNedq0dRwn';
function adTrack(extra) {
  return Object.assign({
    metadata: { uri: AD_URI, name: 'Listen to music, ad-free.', duration: 30000 },
    manifest: { file_urls_mp3: [{ file_id: '9f0f2c3d', file_url: 'https://audio-fa.scdn.co/audio/ad-9f0f2c3d.mp3?x=1' }] },
    content_type: 'AD', track_type: 'AUDIO',
  }, extra || {});
}
function songTrack(id, name) {
  return {
    metadata: { uri: 'spotify:track:' + id, name, duration: 184641 },
    manifest: { file_ids_mp4: [{ file_id: 'a1', bitrate: 128000 }], file_ids_mp4_dual: [{ file_id: 'a2' }] },
    content_type: 'TRACK', track_type: 'AUDIO',
  };
}
function ref(index) { return { state_index: index, paused: false, active_alias: null }; }
function state(track, transitions) {
  return { state_id: 'st' + track + Math.random().toString(16).slice(2, 8), track, disallow_seeking: false,
    transitions: Object.assign({ advance: null, skip_next: null, skip_prev: null, show_next: null, show_prev: null }, transitions || {}) };
}
/* The current song is state 2. Its natural end (advance) leads to the ad (state 3); the skip
   button (skip_next) leads to the next song (state 0). This is the common, seamless shape. */
function songMachineAdOnAdvance() {
  return {
    state_machine: {
      state_machine_id: 'sm-song',
      tracks: [songTrack('6u6DXAyj', 'Hollow'), adTrack(), songTrack('1Hyqfzra', 'Taunt'), songTrack('5xp9j5th', 'Control'), songTrack('2b2TwfTx', 'Bandit'), songTrack('3OcfgjgrY', 'Venom')],
      states: [state(0, { show_next: ref(6), show_prev: ref(7) }), state(5, { show_next: ref(8), show_prev: ref(9) }), state(3, { advance: ref(3), skip_next: ref(0), skip_prev: ref(1), show_next: ref(4), show_prev: ref(5) }), state(1), state(0), state(5), state(2), state(3), state(3), state(4)],
      attributes: { options: { shuffling_context: false } },
    },
    updated_state_ref: ref(2),
    previous_state_ref: { state_machine_id: 'sm-prev', state_id: 'x', paused: false },
  };
}
/* After a manual skip: the current song's advance, skip_next AND skip_prev all lead to the
   ad (state 3). Nothing to reroute to; the ad state is marked already-complete instead. */
function songMachineForcedAd() {
  const m = songMachineAdOnAdvance();
  m.state_machine.states[2].transitions = Object.assign(m.state_machine.states[2].transitions, { advance: ref(3), skip_next: ref(3), skip_prev: ref(3) });
  /* The server locks the ad state down: no seeking, restrictions set. */
  m.state_machine.states[3].disallow_seeking = true;
  m.state_machine.states[3].restrictions = { disallow_seeking_reasons: ['ad'] };
  return m;
}
function currentAdMachine() {
  const m = songMachineForcedAd();
  m.updated_state_ref = ref(3);
  return m;
}
function plainSongMachine() {
  const m = songMachineAdOnAdvance();
  m.state_machine.tracks[1] = songTrack('7FE74FvU', 'Cold in the Water');
  return m;
}
const STATE_URL = 'https://gew1-spclient.spotify.com/track-playback/v1/devices/3a03f01af43207/state';
const CONFLICT_URL = 'https://gew1-spclient.spotify.com/track-playback/v1/devices/3a03f01af43207/state_conflict';
const LICENSE_URL = 'https://gew1-spclient.spotify.com/widevine-license/v1/audio/license';

/* ---- the sandbox: a document at document_start, a window, a media element -------------- */
function makeHarness() {
  const html = { attrs: Object.create(null), children: [], setAttribute(n, v) { this.attrs[n] = v; }, removeAttribute(n) { delete this.attrs[n]; }, hasAttribute(n) { return n in this.attrs; },
    appendChild(el) { this.children.push(el); el.isConnected = true; el.parentNode = this; return el; },
    removeChild(el) { this.children = this.children.filter((c) => c !== el); el.isConnected = false; el.parentNode = null; return el; } };
  const dispatched = [];
  const document = {
    documentElement: html, head: null, readyState: 'loading',
    createElement: (tag) => ({ tagName: String(tag).toUpperCase(), id: '', textContent: '', disabled: false, isConnected: false, parentNode: null }),
    dispatchEvent: (evt) => { dispatched.push(evt && evt.type); return true; },
  };
  const dispatchDoc = auth.documentEvents(document);
  const messageListeners = [];
  const underlying = { next: null, calls: [] };
  class HarnessWorker {
    constructor(url, opts) { this.url = url; this.opts = opts; this.listeners = []; this.onmessage = null; }
    addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); }
    emit(data) {
      let stopped = false;
      const event = { data, stopImmediatePropagation() { stopped = true; } };
      for (const fn of this.listeners.slice()) { fn.call(this, event); if (stopped) return; }
      if (typeof this.onmessage === 'function') this.onmessage.call(this, event);
    }
  }
  class HarnessSharedWorker { constructor(url, opts) { this.url = url; this.opts = opts; this.port = new HarnessWorker(url, opts); } }
  const window = {
    addEventListener: (type, fn) => { if (type === 'message') messageListeners.push({ fn }); },
    removeEventListener: (type, fn) => { const i = messageListeners.findIndex((l) => l.fn === fn); if (i >= 0) messageListeners.splice(i, 1); },
    fetch: function (input, init) { underlying.calls.push({ url: typeof input === 'string' ? input : (input && input.url), init }); const r = typeof underlying.next === 'function' ? underlying.next(input, init) : underlying.next; return Promise.resolve(r); },
    Headers, Response, URL, Blob, Worker: HarnessWorker, SharedWorker: HarnessSharedWorker,
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ font: '', color: '', backgroundColor: '' }),
    Event: class Event { constructor(type) { this.type = type; this.isTrusted = false; } },
  };
  window.window = window; window.self = window;
  const fireWindow = (data) => { messageListeners.slice().forEach((l) => { try { l.fn({ source: window, data }); } catch (e) { dispatched.push('listener-threw:' + e); } }); };
  const harnessSetTimeout = (fn, ms) => setTimeout(fn, ms === 60000 ? 0 : ms);
  const sandbox = {
    window, document, location: { hostname: 'open.spotify.com', origin: 'https://open.spotify.com', href: 'https://open.spotify.com/' },
    setTimeout: harnessSetTimeout, clearTimeout, Date, console: { warn() {}, log() {} },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    function HTMLMediaElement() { this.src = ''; this.currentSrc = ''; this.muted = false; this.paused = true; this.ended = false; this.duration = NaN; this.readyState = 0; this._currentTime = 0; this.seeks = []; this.__listeners = Object.create(null); }
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get: function () { return this._currentTime; }, set: function (v) { this._currentTime = v; this.seeks.push(v); if (Number.isFinite(this.duration) && v >= this.duration - 0.71) { this.ended = true; this.dispatchEvent({ type: 'ended', isTrusted: true }); } } });
    HTMLMediaElement.prototype.addEventListener = function (type, fn) { (this.__listeners[type] || (this.__listeners[type] = [])).push(fn); };
    HTMLMediaElement.prototype.removeEventListener = function (type, fn) { var a = this.__listeners[type] || []; this.__listeners[type] = a.filter(function (item) { return item !== fn; }); };
    HTMLMediaElement.prototype.dispatchEvent = function (event) { var a = (this.__listeners[event.type] || []).slice(); for (var i = 0; i < a.length; i++) a[i].call(this, event); return true; };
    HTMLMediaElement.prototype.play = function () { this.plays = (this.plays||0)+1; this.paused = false; this.mutedAtPlay = this.muted; return Promise.resolve(); };
    window.HTMLMediaElement = HTMLMediaElement;
  `, sandbox);
  const jsonResponse = (obj, extraHeaders) => new Response(JSON.stringify(obj), { status: 200, statusText: 'OK', headers: Object.assign({ 'content-type': 'application/json', 'content-length': '999', 'content-encoding': 'gzip', 'x-spotify': 'yes' }, extraHeaders || {}) });
  const origFetch = window.fetch;
  const origTest = vm.runInContext('RegExp.prototype.test', sandbox);
  const origPlay = vm.runInContext('HTMLMediaElement.prototype.play', sandbox);
  return {
    sandbox, window, document, html, dispatched, underlying, dispatchDoc, fireWindow, messageListeners, jsonResponse,
    origFetch, origTest, origPlay,
    newMedia: () => vm.runInContext('new HTMLMediaElement()', sandbox),
    inContext: (code) => vm.runInContext(code, sandbox),
    load: () => vm.runInContext(SOURCE, sandbox, { filename: 'spotify-adblock.js' }),
    style: () => html.children.find((c) => c.id === 'wo-spotify-adblock-css') || null,
    fetchState: async (machine, url) => { underlying.next = jsonResponse(machine); const res = await window.fetch(url || STATE_URL, { method: 'PUT', body: '{}' }); return res; },
  };
}
function fileUrl(machine, trackIndex) { return machine.state_machine.tracks[trackIndex].manifest.file_urls_mp3[0]; }
function adState(machine) { const m = machine.state_machine; return m.states.find((st) => { const t = m.tracks[st.track]; return t && (t.content_type === 'AD' || /:ad:/.test(String(t.metadata.uri || ''))); }); }
function controlShape(payload) {
  const machine = payload.state_machine;
  return JSON.stringify({
    state_machine_id: machine.state_machine_id,
    states: machine.states,
    attributes: machine.attributes,
    updated_state_ref: payload.updated_state_ref,
    previous_state_ref: payload.previous_state_ref,
  });
}

(async () => {
  console.log('\nSpotify Web Player ad blocker\n');
  check('the 132 ms JSON replacement and its synthetic ended path are gone',
    !/SILENT_MEDIA|spotifyRegExpTest|dispatchEvent\(new NativeEvent\('ended'\)\)/.test(SOURCE));

  /* A Spotify response is observed, never rebuilt or edited. */
  {
    const h = makeHarness(); h.load();
    check('the module installs at document_start and requests its bridge replay',
      h.window.__wardenOneSpotifyAdblockReady === VERSION && !!h.style() &&
      h.dispatched.includes('wo-bridge-replay'));
    const input = songMachineForcedAd();
    const before = JSON.stringify(input);
    const response = await h.fetchState(input);
    const output = await response.json();
    check('forced-ad state, restrictions, transitions, media URL and file id stay byte-for-byte intact',
      JSON.stringify(output) === before && adState(output).disallow_seeking === true &&
      fileUrl(output, 1).file_id === '9f0f2c3d');
    check('the original Response and all its headers survive', response === h.underlying.next &&
      response.headers.get('content-length') === '999' && response.headers.get('x-spotify') === 'yes');
    check('the extension makes no extra playback request', h.underlying.calls.length === 1);
    let stable = true;
    for (let i = 0; i < 30; i++) {
      const payload = i % 2 ? songMachineForcedAd() : songMachineAdOnAdvance();
      payload.state_machine.state_machine_id += '-' + i;
      const raw = JSON.stringify(payload);
      const r = await h.fetchState(payload);
      stable = stable && r === h.underlying.next && JSON.stringify(await r.json()) === raw;
    }
    check('thirty consecutive ad-bearing machines remain unmodified', stable);
  }

  /* A future ad in a song's graph is not yet current. The old code sought it immediately,
     and its four timers could seek it again during a skip, triggering a skip cascade. */
  {
    const h = makeHarness(); h.load();
    await h.fetchState(songMachineForcedAd());
    const media = h.newMedia();
    media.src = media.currentSrc = fileUrl(songMachineForcedAd(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    check('known ad media is muted before native play and the short slot is hidden',
      media.mutedAtPlay === true && h.html.hasAttribute('data-wo-spotify-ad'));
    media.duration = 29.99; media.readyState = 1;
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('a skip into a future ad cannot seek before the server confirms the current ad',
      media.seeks.length === 0 && media.ended === false,
      { seeks: media.seeks, ended: media.ended });
    await h.fetchState(currentAdMachine());
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('the confirmed ad clock reaches its tail and emits a trusted end',
      media.seeks.length === 1 && media.seeks[0] > 29 && media.seeks[0] < 29.5 && media.ended === true,
      { seeks: media.seeks, ended: media.ended });
    media._currentTime = 0; media.ended = false;
    media.dispatchEvent({ type: 'durationchange', isTrusted: true });
    await h.fetchState(currentAdMachine());
    await new Promise((resolve) => setTimeout(resolve, 900));
    check('duplicate ad confirmations and retry timers never seek the same ad twice',
      media.seeks.length === 1 && media.ended === false, { seeks: media.seeks });
    media.src = media.currentSrc = 'blob:https://open.spotify.com/next-song';
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    check('the next song starts unmuted and removes the temporary ad slot',
      media.mutedAtPlay === false && !h.html.hasAttribute('data-wo-spotify-ad'));
  }
  {
    const h = makeHarness(); h.load();
    await h.fetchState(currentAdMachine());
    const media = h.newMedia(); media.src = media.currentSrc = fileUrl(currentAdMachine(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    media.duration = 1.05; media.readyState = 1;
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('a redirected one-second ad is muted and never sought or ended synthetically',
      media.mutedAtPlay === true && media.seeks.length === 0 && media.ended === false,
      { seeks: media.seeks, ended: media.ended });
  }
  {
    const h = makeHarness(); h.load();
    await h.fetchState(currentAdMachine());
    const media = h.newMedia();
    media.src = media.currentSrc = fileUrl(songMachineForcedAd(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    media.duration = 29.99; media.readyState = 1;
    media.src = media.currentSrc = 'blob:https://open.spotify.com/rapid-next';
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('a rapid next song cancels a pending ad seek', media.seeks.length === 0 && media.mutedAtPlay === false);
  }
  {
    const h = makeHarness(); h.load();
    await h.fetchState(currentAdMachine());
    const media = h.newMedia(); media.src = media.currentSrc = fileUrl(currentAdMachine(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    await h.fetchState(plainSongMachine());
    media.duration = 29.99; media.readyState = 1;
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('a later normal state disarms a stale ad seek', media.seeks.length === 0);
  }
  {
    const h = makeHarness(); h.load();
    let release;
    h.underlying.next = new Promise((resolve) => { release = resolve; });
    const pending = h.window.fetch(STATE_URL);
    const song = h.newMedia(); song.src = song.currentSrc = 'blob:https://open.spotify.com/new-song';
    h.inContext('HTMLMediaElement.prototype.play').call(song);
    release(h.jsonResponse(currentAdMachine()));
    await pending;
    const ad = h.newMedia(); ad.src = ad.currentSrc = fileUrl(currentAdMachine(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(ad);
    ad.duration = 29.99; ad.readyState = 1;
    ad.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('an old ad response arriving after a new song cannot re-arm the ad', ad.seeks.length === 0);
  }
  {
    const h = makeHarness(); h.load();
    await h.fetchState(songMachineForcedAd());
    const ad = h.newMedia(); ad.src = ad.currentSrc = fileUrl(songMachineForcedAd(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(ad);
    const song = h.newMedia(); song.src = song.currentSrc = 'blob:https://open.spotify.com/parallel-song';
    h.inContext('HTMLMediaElement.prototype.play').call(song);
    check('a preloaded song cannot unmute a still-playing separate ad element', ad.muted === true);
    ad.ended = true;
    const next = h.newMedia(); next.src = next.currentSrc = 'blob:https://open.spotify.com/later-song';
    h.inContext('HTMLMediaElement.prototype.play').call(next);
    check('a finished separate ad eventually releases its temporary mute', ad.muted === false);
  }

  /* Ad recognition is based on Spotify's explicit metadata, with only dedicated ad hosts as
     a fallback. Ordinary songs and podcasts on shared CDNs must never be touched. */
  {
    const h = makeHarness(); h.load();
    const podcast = plainSongMachine();
    podcast.state_machine.tracks[1] = {
      metadata: { uri: 'spotify:episode:pod1', duration: 1800000 },
      manifest: { file_urls_mp3: [{ file_url: 'https://audio-fa.scdn.co/audio/podcast.mp3' }] },
      content_type: 'EPISODE',
    };
    const pod = await h.fetchState(podcast);
    check('episode response is unchanged', pod === h.underlying.next);
    for (const src of [
      'https://audio-fa.scdn.co/audio/song',
      'https://audio-cf.spotifycdn.com/audio/preview',
      'https://p.scdn.co/mp3/preview.mp3',
      'https://audio-fa.scdn.co/audio/podcast.mp3',
    ]) {
      const m = h.newMedia(); m.src = m.currentSrc = src;
      h.inContext('HTMLMediaElement.prototype.play').call(m);
      check('shared-CDN music/preview/episode is never muted: ' + src, m.mutedAtPlay === false && m.seeks.length === 0);
    }
    const dedicated = h.newMedia();
    dedicated.src = dedicated.currentSrc = 'https://2mdn.net/ad.mp3';
    h.inContext('HTMLMediaElement.prototype.play').call(dedicated);
    check('dedicated ad host is muted even without state metadata', dedicated.mutedAtPlay === true);
    const normal = h.newMedia(); normal.src = normal.currentSrc = 'blob:https://open.spotify.com/normal';
    h.inContext('HTMLMediaElement.prototype.play').call(normal);
  }
  {
    const h = makeHarness(); h.load();
    const variants = [
      adTrack({ metadata: { uri: 'spotify:track:odd-label', duration: 30000 } }),
      adTrack({ content_type: 'TRACK' }),
      adTrack({ manifest: { file_urls_mp4: [{ file_url: 'https://video.example/ad.mp4' }] } }),
    ];
    let recognized = true;
    for (const track of variants) {
      const m = songMachineForcedAd(); m.state_machine.tracks[1] = track;
      await h.fetchState(m);
      const key = Object.keys(track.manifest)[0];
      const media = h.newMedia(); media.src = media.currentSrc = track.manifest[key][0].file_url;
      h.inContext('HTMLMediaElement.prototype.play').call(media);
      recognized = recognized && media.mutedAtPlay === true;
      const song = h.newMedia(); song.src = song.currentSrc = 'blob:https://open.spotify.com/clear';
      h.inContext('HTMLMediaElement.prototype.play').call(song);
    }
    check('content_type, ad URI, and video ad candidates are all recognized without rewriting', recognized);
    const keyed = songMachineForcedAd();
    keyed.state_machine.tracks = Object.fromEntries(keyed.state_machine.tracks.map((t, i) => [String(i), t]));
    await h.fetchState(keyed);
    const media = h.newMedia(); media.src = media.currentSrc = fileUrl(songMachineForcedAd(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    check('index-keyed tracks are recognized', media.mutedAtPlay === true);
  }
  {
    const h = makeHarness(); h.load();
    const machine = songMachineForcedAd();
    h.underlying.next = new Response(JSON.stringify({ commands: [{ type: 'replace_state', state_machine: machine.state_machine }] }), { status: 200 });
    const r = await h.window.fetch(CONFLICT_URL, { method: 'PUT', body: '{}' });
    const media = h.newMedia(); media.src = media.currentSrc = fileUrl(machine, 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    check('replacement-state commands reveal ad URLs while the conflict Response stays intact',
      r === h.underlying.next && media.mutedAtPlay === true);
  }
  {
    const h = makeHarness(); h.load();
    h.underlying.next = new Response(JSON.stringify(plainSongMachine()), { status: 200 });
    check('a response without an ad is returned unchanged', await h.window.fetch(STATE_URL) === h.underlying.next);
    h.underlying.next = new Response(JSON.stringify(songMachineForcedAd()), { status: 200 });
    check('unrelated endpoints are not inspected', await h.window.fetch('https://gew1-spclient.spotify.com/storage-resolve/v2/files/audio/x') === h.underlying.next);
    h.underlying.next = new Response(null, { status: 204 });
    check('empty 204 playback response passes through', await h.window.fetch(STATE_URL) === h.underlying.next);
  }
  /* A license 429 is held, not retried, so the player need not immediately auto-skip a
     sequence of songs. Successful requests and unrelated endpoints have no added delay. */
  {
    const h = makeHarness(); h.load();
    const pending = [];
    h.sandbox.setTimeout = (fn, ms) => { const task = { fn, ms, cancelled: false }; pending.push(task); return task; };
    h.sandbox.clearTimeout = (task) => { task.cancelled = true; };
    const good = new Response('license', { status: 200 });
    h.underlying.next = good;
    check('successful audio license returns its original Response with no hold',
      await h.window.fetch(LICENSE_URL, { method: 'POST' }) === good && pending.length === 0 && h.underlying.calls.length === 1);
    const throttled = new Response(null, { status: 429 });
    h.underlying.next = throttled;
    let resolved = false;
    const held = h.window.fetch(LICENSE_URL, { method: 'POST' }).then((r) => { resolved = true; return r; });
    await settle();
    check('only the original Spotify audio-license 429 is held, without retrying',
      !resolved && pending.length === 1 && pending[0].ms === 10000 && h.underlying.calls.length === 2);
    pending[0].fn();
    check('held license returns the identical server response after its bounded wait',
      await held === throttled && pending[0].cancelled && h.underlying.calls.length === 2);
    for (const [url, init] of [
      [LICENSE_URL, { method: 'GET' }],
      ['https://example.com/widevine-license/v1/audio/license', { method: 'POST' }],
      ['https://gew1-spclient.spotify.com/other', { method: 'POST' }],
    ]) {
      check('429 hold is limited to a Spotify audio-license POST',
        await h.window.fetch(url, init) === throttled && pending.length === 1);
    }
  }
  {
    const h = makeHarness(); h.load();
    const pending = [];
    h.sandbox.setTimeout = (fn, ms) => { const task = { fn, ms, cancelled: false }; pending.push(task); return task; };
    h.sandbox.clearTimeout = (task) => { task.cancelled = true; };
    const throttled = new Response(null, { status: 429 });
    h.underlying.next = throttled;
    const controller = new AbortController();
    const held = h.window.fetch(LICENSE_URL, { method: 'POST', signal: controller.signal });
    await settle();
    controller.abort();
    check('an aborted license request releases the failed response immediately',
      await held === throttled && pending.length === 1 && pending[0].cancelled && h.underlying.calls.length === 1);
    const second = h.window.fetch(LICENSE_URL, { method: 'POST' });
    await settle();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    link.sendConfig({ adShield: false });
    check('disabling AdShield releases a pending license without waiting',
      await second === throttled && pending[1].cancelled);
    link.sendConfig({ adShield: true });
    const third = h.window.fetch(LICENSE_URL, { method: 'POST' });
    await settle();
    link.sendDispose();
    check('disposing the module releases pending licenses', await third === throttled && pending[2].cancelled);
  }

  /* The worker observer may discover generic ad URLs. Its socket and fetch wrappers must
     deliver the original event/Response, with no fake replacement state. */
  {
    const shimMatch = SOURCE.match(/function woWorkerShim\(NOTICE, CURRENT\) \{[\s\S]*?\n  \}\n/);
    check('worker observer is present', !!shimMatch);
    const notices = [];
    function FakeWS() {}
    FakeWS.prototype.addEventListener = function (type, fn) { this.listener = fn; };
    Object.defineProperty(FakeWS.prototype, 'onmessage', { configurable: true, get() { return this.listener; }, set(fn) { this.listener = fn; } });
    const self = { WebSocket: FakeWS, postMessage(message) { notices.push(message); }, fetch: () => Promise.resolve(new Response(JSON.stringify(songMachineForcedAd()))) };
    const ctx = { self, Promise, Response, JSON, Object, Array, RegExp, String };
    vm.createContext(ctx);
    vm.runInContext('(' + shimMatch[0] + ')(' + JSON.stringify(WORKER_AD_NOTICE) + ',' + JSON.stringify(WORKER_AD_CURRENT_NOTICE) + ');', ctx);
    const frame = JSON.stringify({ payloads: [{ state_machine: songMachineForcedAd().state_machine }] });
    const event = { data: frame };
    const ws = new self.WebSocket();
    let received = null;
    ws.onmessage = (ev) => { received = ev; };
    ws.listener(event);
    check('dealer event is delivered as the identical original object', received === event);
    check('dealer frame reports only explicitly labelled ad URL candidates',
      notices.length === 1 && notices[0][WORKER_AD_NOTICE][0] === fileUrl(songMachineForcedAd(), 1).file_url);
    ws.listener({ data: JSON.stringify({ payloads: [currentAdMachine()] }) });
    check('dealer frame distinguishes a current ad from a future candidate',
      notices.length === 2 && !notices[0][WORKER_AD_CURRENT_NOTICE] &&
      notices[1][WORKER_AD_CURRENT_NOTICE][0] === fileUrl(currentAdMachine(), 1).file_url);
    const fetchResponse = await self.fetch(STATE_URL);
    check('worker fetch also preserves the exact Response object', fetchResponse instanceof Response);
    check('worker observer never builds a Response or sends a playback command',
      !/new Response\(|\.send\(/.test(shimMatch[0]));
  }
  {
    const h = makeHarness(); h.load();
    const worker = new h.window.Worker('/web-player-worker.js');
    let pageMessages = 0;
    worker.addEventListener('message', () => { pageMessages++; });
    const generic = 'https://audio-fa.scdn.co/audio/worker-ad.mp3';
    worker.emit({ [WORKER_AD_NOTICE]: [generic] });
    const media = h.newMedia(); media.src = media.currentSrc = generic;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    check('worker ad URL notice is consumed and registered without leaking to Spotify listeners',
      pageMessages === 0 && media.mutedAtPlay === true);
    media.duration = 29.99; media.readyState = 1;
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    check('worker candidate notice alone does not seek a speculative ad', media.seeks.length === 0);
    worker.emit({ [WORKER_AD_NOTICE]: [generic], [WORKER_AD_CURRENT_NOTICE]: [generic] });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('worker current-ad notice arms exactly one seek', media.seeks.length === 1);
    worker.emit({ ordinary: true });
    check('ordinary worker messages pass through', pageMessages === 1);
    check('unsupported worker URLs fail open to native construction',
      new h.window.Worker('blob:https://open.spotify.com/opaque').url.startsWith('blob:'));
  }
  {
    const h = makeHarness(); h.load();
    const worker = new h.window.Worker('/web-player-worker.js');
    const url = fileUrl(currentAdMachine(), 1).file_url;
    worker.emit({ [WORKER_AD_NOTICE]: [url], [WORKER_AD_CURRENT_NOTICE]: [url] });
    const media = h.newMedia(); media.src = media.currentSrc = url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    media.duration = 29.99; media.readyState = 1;
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('worker notice received before the ad media plays cannot arm a future slot', media.seeks.length === 0);
  }

  /* The player's own loader: the content object Spotify resolves a track into passes through
     one Promise callback before the media element sees its URL. An ad's URL becomes the
     silent clip there, on any host; everything else is the native then. */
  {
    const clip = SILENT_CLIP;
    check('the inlined silent clip is byte-for-byte the packaged one-second MP4',
      Buffer.from(clip.slice(clip.indexOf(',') + 1), 'base64').equals(fs.readFileSync(path.join(ROOT, 'spotify-silent-1s.mp4'))) &&
      clip.startsWith('data:video/mp4;base64,'));
    const h = makeHarness();
    const nativeThen = h.inContext('Promise.prototype.then');
    h.load();
    check('Promise.prototype.then is replaced at document_start', h.inContext('Promise.prototype.then') !== nativeThen &&
      h.inContext('Promise.prototype.then.length') === 2);
    /* The player's callback, as it reads in the bundle: an arrow whose source names
       _getCacheKey, run against the freshly loaded content object. */
    const loader = h.inContext(`(function (content) {
      var player = { _cache: new Map(), _getCacheKey: function (t) { return t && t._uri || null; }, seen: null };
      return Promise.resolve(content).then(o => { player.seen = o; var i = player._getCacheKey(o); return i && player._cache.set(i, o), o; })
        .then(function (o) { return { returned: o, seen: player.seen }; });
    })`);
    const other = h.inContext('(function (content) { return Promise.resolve(content).then(o => o); })');
    const ad = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-9f0f2c3d.mp3?x=1', _mediaType: 'audio' };
    const adResult = await loader(ad);
    check('an ad content object is handed the silent clip before the loader continues',
      ad._url === clip && adResult.seen === ad && adResult.returned === ad);
    const song = { _uri: 'spotify:track:6u6DXAyj', _url: 'https://audio-fa.scdn.co/audio/song?x=1' };
    const episode = { _uri: 'spotify:episode:pod1', _url: 'https://traffic.megaphone.fm/pod1.mp3' };
    const external = { _uri: 'spotify:track:external', _url: 'https://cf.adxcel.com/song.mp3' };
    await loader(song); await loader(episode); await loader(external);
    check('songs, episodes and external files keep their URLs whatever host they are on',
      song._url === 'https://audio-fa.scdn.co/audio/song?x=1' && episode._url === 'https://traffic.megaphone.fm/pod1.mp3' &&
      external._url === 'https://cf.adxcel.com/song.mp3');
    const elsewhere = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-elsewhere.mp3' };
    await other(elsewhere);
    check('an ad object passing through any other then callback is left alone',
      elsewhere._url === 'https://audio-fa.scdn.co/audio/ad-elsewhere.mp3');
    const manifest = { _uri: 'spotify:ad:manifest1', _adURL: '', _manifestURL: 'https://spclient.wg.spotify.com/ad-manifest/1',
      _playableContentSorted: [{ url: 'https://ads.spotifycdn.example/one.mp4', type: 'audio/mp4', bitrate: 256000 }, { url: 'https://ads.spotifycdn.example/two.mp4', type: 'audio/mp4', bitrate: 96000 }] };
    await loader(manifest);
    check('a manifest-delivered ad has every candidate swapped, its manifest and formats untouched',
      manifest._playableContentSorted.every((c) => c.url === clip) && manifest._playableContentSorted[0].type === 'audio/mp4' &&
      manifest._playableContentSorted[1].bitrate === 96000 && manifest._adURL === '' &&
      manifest._manifestURL === 'https://spclient.wg.spotify.com/ad-manifest/1');
    const cached = { _uri: 'spotify:ad:manifest2', _adURL: 'https://ads.spotifycdn.example/chosen.mp4', _playableContentSorted: [] };
    await loader(cached);
    check('a cached manifest ad that already chose its file is swapped too', cached._adURL === clip);
    const chained = await h.inContext('Promise.resolve(2).then(x => x * 2).then(x => x + 1)');
    const caught = await h.inContext('Promise.reject(new Error("no")).then(null, e => "caught:" + e.message)');
    const passthrough = await h.inContext('Promise.resolve("v").then()');
    let thrown = null;
    try { await h.inContext('Promise.resolve({ _uri: "spotify:ad:x", _url: "https://a/b" }).then(o => { var i = this._getCacheKey; throw new Error("loader failed"); })'); }
    catch (e) { thrown = e; }
    check('every other then, catch path, argument-less then and a throwing loader behave natively',
      chained === 5 && caught === 'caught:no' && passthrough === 'v' && thrown && thrown.message === 'loader failed');
    h.inContext('Function.prototype.toString = function () { return "hidden"; }');
    const late = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-late.mp3' };
    await loader(late);
    check('a page that redefines Function.prototype.toString cannot hide the loader', late._url === clip);
    const media = h.newMedia(); media.src = media.currentSrc = clip;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    media.duration = 1.0; media.readyState = 1;
    media.dispatchEvent({ type: 'loadedmetadata', isTrusted: true });
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('the clip plays through unmuted, blanks the now-playing surfaces and is never sought',
      media.mutedAtPlay === false && h.html.hasAttribute('data-wo-spotify-ad') && media.seeks.length === 0);
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    link.sendConfig({ adShield: false });
    const off = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-off.mp3' };
    await loader(off);
    check('signed AdShield-off leaves the loader untouched', off._url === 'https://audio-fa.scdn.co/audio/ad-off.mp3');
    link.sendConfig({ adShield: true });
    /* The callback is wrapped when the player registers it and runs later; a switch-off in
       between must still win. */
    const settleLater = h.inContext('(function () { var done; var p = new Promise(function (r) { done = r; }); return { p: p, done: done }; })')();
    const between = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-between.mp3' };
    const pendingLoad = loader(settleLater.p.then(() => between));
    link.sendConfig({ adShield: false });
    settleLater.done();
    await pendingLoad;
    check('a switch-off after the loader was registered still leaves the ad URL alone',
      between._url === 'https://audio-fa.scdn.co/audio/ad-between.mp3');
    link.sendConfig({ adShield: true });
    const on = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-on.mp3' };
    await loader(on);
    check('signed AdShield-on swaps again', on._url === clip);
    link.sendDispose();
    const after = { _uri: AD_URI, _url: 'https://audio-fa.scdn.co/audio/ad-after.mp3' };
    await loader(after);
    check('signed dispose restores the native then', h.inContext('Promise.prototype.then') === nativeThen &&
      after._url === 'https://audio-fa.scdn.co/audio/ad-after.mp3');
  }

  /* Scope, signed settings and lifecycle remain under the extension bridge's authority. */
  {
    const h = makeHarness(); h.load();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    const generic = fileUrl(songMachineForcedAd(), 1).file_url;
    link.sendConfig({ adShield: false });
    await h.fetchState(songMachineForcedAd());
    const off = h.newMedia(); off.src = off.currentSrc = generic;
    h.inContext('HTMLMediaElement.prototype.play').call(off);
    check('signed AdShield-off disables discovery, seek and cosmetics',
      off.mutedAtPlay === false && h.style().disabled === true);
    link.sendConfig({ adShield: true });
    await h.fetchState(songMachineForcedAd());
    const on = h.newMedia(); on.src = on.currentSrc = generic;
    h.inContext('HTMLMediaElement.prototype.play').call(on);
    check('signed AdShield-on re-enables ad handling', on.mutedAtPlay === true && h.style().disabled === false);
    const impostor = new auth.Signer('11'.repeat(32));
    h.fireWindow(auth.configMessage(impostor, link.token, { adShield: false }));
    check('wrong-key config cannot disable protection', h.style().disabled === false);
    link.sendDispose();
    check('signed dispose restores fetch and media play, removes style and ready flag',
      h.window.fetch === h.origFetch && h.inContext('HTMLMediaElement.prototype.play') === h.origPlay &&
      !h.style() && h.window.__wardenOneSpotifyAdblockReady === undefined);
  }
  {
    const h = makeHarness(); h.load();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    link.sendConfig({ allowlist: ['open.spotify.com'] });
    await h.fetchState(songMachineForcedAd());
    const media = h.newMedia(); media.src = media.currentSrc = fileUrl(songMachineForcedAd(), 1).file_url;
    h.inContext('HTMLMediaElement.prototype.play').call(media);
    check('user allowlist disables handling on Spotify', media.mutedAtPlay === false);
    const firstFetch = h.window.fetch; h.load();
    check('a second injection in one document is idempotent', h.window.fetch === firstFetch);
    const other = makeHarness();
    other.inContext('location.hostname = "example.com"; location.href = "https://example.com/";');
    other.load();
    check('the module remains scoped to open.spotify.com', other.window.__wardenOneSpotifyAdblockReady === undefined);
  }

  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const entry = (manifest.content_scripts || []).find((cs) => (cs.js || []).includes('spotify-adblock.js'));
    check('manifest injects in the MAIN world at document_start on Spotify only',
      !!entry && entry.world === 'MAIN' && entry.run_at === 'document_start' && (entry.matches || []).join(',') === 'https://open.spotify.com/*');
    check('no server state, graph, account request or fake ended event is authored',
      !/seq_num|debug_source|new NativeEvent\('ended'\)|state_ref\s*[:=]\s*\{/.test(SOURCE) &&
      !/\.transitions\.(advance|skip_next)\s*=/.test(SOURCE));
    check('seeking is scoped to the known ad slot and checked against the exact media source',
      /current !== slot/.test(SOURCE) && /mediaSrc\(media\) !== current\.src/.test(SOURCE) &&
      /knownAdUrls\.has\(src\)/.test(SOURCE));
    check('auth verifies signed config and disposal',
      /woVerify\('config'/.test(SOURCE) && /woVerify\('dispose'/.test(SOURCE) && /seq <= woLastSeq/.test(SOURCE));
    check('ad chrome remains hidden', SOURCE.includes('[data-testid="ad"]') && SOURCE.includes('[data-testid^="ad-"]'));
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all Spotify ad blocker checks passed');
})();

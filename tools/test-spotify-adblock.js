/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Behavioural tests for the real Spotify Web Player module (spotify-adblock.js).
 *
 * The fixtures are the shape of the live player's state machine, read off
 * /track-playback/v1/devices/<id>/state on 2026-09-12: a song state whose advance,
 * skip-next and skip-prev all point at an ad state; then, once the player has entered
 * it, the server's confirming machine with the ad current and advance pointing at the
 * next song. The slot timeline below replays the measured sequence -- clip loads and
 * plays at t=0, ends natively at 132 ms, confirming response at ~550 ms -- and the
 * suite holds the module to leaving the slot within tens of milliseconds of that
 * response, to never re-routing the machine (both ways of doing so broke the live
 * player), and to blanking the bar for exactly the length of the slot.
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
const SILENT_MEDIA = (SOURCE.match(/const SILENT_MEDIA = '([^']+)'/) || [])[1];
if (!SILENT_MEDIA) throw new Error('the silent clip was not found in spotify-adblock.js');
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
    manifest: { file_urls_mp3: [{ file_id: '9f0f2c3d', file_url: 'https://p.scdn.co/mp3-ad/9f0f2c3d.mp3?x=1' }] },
    ms_played_until_update: 1000, content_type: 'AD', track_type: 'AUDIO',
  }, extra || {});
}
function songTrack(id, name) {
  return {
    metadata: { uri: 'spotify:track:' + id, name, duration: 184641 },
    manifest: { file_ids_mp4: [{ file_id: 'a1', bitrate: 128000 }], file_ids_mp4_dual: [{ file_id: 'a2' }] },
    ms_played_until_update: 30000, content_type: 'TRACK', track_type: 'AUDIO',
  };
}
function ref(index) { return { state_index: index, paused: false, active_alias: null }; }
function state(track, transitions) {
  return { state_id: 'st' + track + Math.random().toString(16).slice(2, 8), track, transitions: Object.assign({ advance: null, skip_next: null, skip_prev: null, show_next: null, show_prev: null }, transitions || {}) };
}
/* The song is current; every exit leads to the ad (state 3); 4 and 5 preview the queue. */
function songMachineWithAdNext() {
  return {
    state_machine: {
      state_machine_id: 'sm-song',
      tracks: [songTrack('2b2TwfTx', 'Bandit'), adTrack(), songTrack('1Hyqfzra', 'Taunt'), songTrack('5xp9j5th', 'Control'), songTrack('6u6DXAyj', 'Hollow'), songTrack('3OcfgjgrY', 'Venom')],
      states: [state(1), state(1), state(3, { advance: ref(3), skip_next: ref(0), skip_prev: ref(1), show_next: ref(4), show_prev: ref(5) }), state(1), state(0), state(2)],
      attributes: { options: { shuffling_context: false } },
    },
    updated_state_ref: ref(2),
    previous_state_ref: { state_machine_id: 'sm-prev', state_id: 'x', paused: false },
  };
}
/* The server has confirmed the ad as current; advance leads to the next song (state 0). */
function adCurrentMachine() {
  return {
    state_machine: {
      state_machine_id: 'sm-ad',
      tracks: [songTrack('6u6DXAyj', 'Hollow'), songTrack('5xp9j5th', 'Control'), songTrack('2b2TwfTx', 'Bandit'), adTrack()],
      states: [state(2), state(0), state(3, { advance: ref(0) }), state(1)],
    },
    updated_state_ref: ref(2),
  };
}
function plainSongMachine() {
  const m = songMachineWithAdNext();
  m.state_machine.tracks[1] = songTrack('7FE74FvU', 'Cold in the Water');
  return m;
}
const STATE_URL = 'https://gew1-spclient.spotify.com/track-playback/v1/devices/3a03f01af43207/state';

/* ---- the sandbox: a document at document_start, a window, a clock, a media element ----- */

function makeHarness() {
  const clock = { now: 0, timers: new Map(), nextId: 1 };
  clock.setTimeout = (fn, ms) => { const id = clock.nextId++; clock.timers.set(id, { at: clock.now + (Number(ms) || 0), fn }); return id; };
  clock.clearTimeout = (id) => { clock.timers.delete(id); };
  clock.advance = (ms) => {
    const target = clock.now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of clock.timers) if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      clock.timers.delete(next.id);
      clock.now = next.t.at;
      next.t.fn();
    }
    clock.now = target;
  };

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
  const window = {
    addEventListener: (type, fn, opts) => { if (type === 'message') messageListeners.push({ fn, opts }); },
    removeEventListener: (type, fn) => { const i = messageListeners.findIndex((l) => l.fn === fn); if (i >= 0) messageListeners.splice(i, 1); },
    fetch: function (input, init) { underlying.calls.push({ input, init }); const r = typeof underlying.next === 'function' ? underlying.next(input, init) : underlying.next; return Promise.resolve(r); },
    Headers, Response, URL,
    Event: class Event { constructor(type) { this.type = type; } },
  };
  window.window = window; window.self = window;
  const fireWindow = (data) => { messageListeners.slice().forEach((l) => { try { l.fn({ source: window, data }); } catch (e) { dispatched.push('listener-threw:' + e); } }); };

  const sandbox = {
    window, document, location: { hostname: 'open.spotify.com', href: 'https://open.spotify.com/' },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Date: { now: () => clock.now },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    console: { warn() {}, log() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    function HTMLMediaElement() { this.src = ''; this.currentSrc = ''; this.ended = false; this.loop = false; this.error = null; this.muted = false; this.dispatched = []; this.plays = 0; this.events = {}; }
    HTMLMediaElement.prototype.play = function () { this.plays++; return Promise.resolve(); };
    HTMLMediaElement.prototype.addEventListener = function (type, fn) { (this.events[type] ||= []).push(fn); };
    HTMLMediaElement.prototype.removeEventListener = function (type, fn) { this.events[type] = (this.events[type] || []).filter(f => f !== fn); };
    HTMLMediaElement.prototype.dispatchEvent = function (e) { this.dispatched.push(e.type); for (const fn of (this.events[e.type] || []).slice()) fn(e); return true; };
    window.HTMLMediaElement = HTMLMediaElement;
    var __nativePlay = HTMLMediaElement.prototype.play;
    var __nativeTest = RegExp.prototype.test;
  `, sandbox);
  return {
    sandbox, clock, document, window, html, dispatched, underlying, dispatchDoc, fireWindow, messageListeners,
    newMedia: () => vm.runInContext('new HTMLMediaElement()', sandbox),
    inContext: (code) => vm.runInContext(code, sandbox),
    load: () => vm.runInContext(SOURCE, sandbox, { filename: 'spotify-adblock.js' }),
    style: () => html.children.find((c) => c.id === 'wo-spotify-adblock-css') || null,
    fetchState: async (machine, url) => { underlying.next = new Response(JSON.stringify(machine), { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json', 'content-length': '999', 'x-spotify': 'yes' } }); const res = await window.fetch(url || STATE_URL, { method: 'PUT', body: '{}' }); return res; },
  };
}
function fileUrl(machine, trackIndex) { return machine.state_machine.tracks[trackIndex].manifest.file_urls_mp3[0]; }

(async () => {
  console.log('\nSpotify Web Player ad blocker\n');

  /* ---- 1. the state machine: silenced, never re-routed ------------------------------- */
  {
    const h = makeHarness();
    h.load();
    check('the module installs on open.spotify.com at document_start', h.sandbox.window.__wardenOneSpotifyAdblockReady === VERSION && !!h.style() && h.style().isConnected);
    check('and asks the bridge for a replay once its listeners exist', h.dispatched.includes('wo-bridge-replay'));
    const res = await h.fetchState(songMachineWithAdNext());
    const out = await res.json();
    check('an ad track in the machine gets the silent clip, file id 1', fileUrl(out, 1).file_url === SILENT_MEDIA && fileUrl(out, 1).file_id === 1);
    check('the songs around it keep their encrypted-MP4 manifests untouched', JSON.stringify(out.state_machine.tracks[0].manifest) === JSON.stringify(songTrack('2b2TwfTx', 'Bandit').manifest) && !('file_urls_mp3' in out.state_machine.tracks[3].manifest));
    const s2 = out.state_machine.states[2].transitions;
    check('the song still advances, skips forward and back into the ad state -- no re-routing', s2.advance.state_index === 3 && s2.skip_next.state_index === 0 && s2.skip_prev.state_index === 1);
    check('the current state is still the song', out.updated_state_ref.state_index === 2);
    check('status, statusText and the other headers survive the rewrite', res.status === 200 && res.statusText === 'OK' && res.headers.get('x-spotify') === 'yes');
    check('content-length and content-encoding do not', !res.headers.get('content-length') && !res.headers.get('content-encoding'));
    const conf = await (await h.fetchState(adCurrentMachine())).json();
    check('the confirming machine keeps the ad as the current state and its advance intact', conf.updated_state_ref.state_index === 2 && conf.state_machine.states[2].transitions.advance.state_index === 0 && fileUrl(conf, 3).file_url === SILENT_MEDIA);
    check('the shipped source never touches updated_state_ref or a transition', !/updated_state_ref\.state_index\s*=/.test(SOURCE) && !/transitions\.(advance|skip_next|skip_prev)\s*=/.test(SOURCE) && !/state_index\s*=/.test(SOURCE));
  }
  {
    const h = makeHarness();
    h.load();
    const plain = plainSongMachine();
    h.underlying.next = new Response(JSON.stringify(plain), { status: 200 });
    const res = await h.window.fetch(STATE_URL);
    check('a machine with no ad in it comes back as the very Response the server sent', res === h.underlying.next);
    h.underlying.next = new Response(JSON.stringify(songMachineWithAdNext()), { status: 200 });
    const other = await h.window.fetch('https://gew1-spclient.spotify.com/storage-resolve/v2/files/audio/interactive/10/abc');
    check('a response from any other endpoint is never read or rewritten, ad-shaped or not', other === h.underlying.next);
    h.underlying.next = new Response(null, { status: 204 });
    const empty = await h.window.fetch(STATE_URL, { method: 'PUT' });
    check('an empty 204 on the endpoint passes through', empty === h.underlying.next && empty.status === 204);
    const m = songMachineWithAdNext();
    m.state_machine.tracks[1] = adTrack({ metadata: { uri: 'spotify:track:oddlylabelled', name: 'x', duration: 30000 } });
    const byType = await (await h.fetchState(m)).json();
    check('content_type AD alone is enough to be treated as an ad', fileUrl(byType, 1).file_url === SILENT_MEDIA);
    const m2 = songMachineWithAdNext();
    m2.state_machine.tracks[1] = { metadata: { uri: 'spotify:episode:pod1', name: 'An episode', duration: 1800000 }, manifest: { file_urls_mp3: [{ file_id: 'ep', file_url: 'https://traffic.megaphone.fm/ep.mp3' }] }, content_type: 'EPISODE' };
    h.underlying.next = new Response(JSON.stringify(m2), { status: 200 });
    const pod = await h.window.fetch(STATE_URL);
    check('an episode with a plain MP3 URL is not an ad and is left alone', pod === h.underlying.next);
    const m3 = songMachineWithAdNext();
    m3.state_machine.tracks[1].manifest.file_urls_mp4 = [{ file_id: 'v1', file_url: 'https://adstudio-assets.scdn.co/video/ad.mp4' }];
    const video = await (await h.fetchState(m3)).json();
    check('a video ad candidate is silenced the same way', video.state_machine.tracks[1].manifest.file_urls_mp4[0].file_url === SILENT_MEDIA);
    const m4 = songMachineWithAdNext();
    m4.state_machine.tracks = Object.fromEntries(m4.state_machine.tracks.map((t, i) => [String(i), t]));
    const keyed = await (await h.fetchState(m4)).json();
    check('tracks keyed by index instead of listed are handled', keyed.state_machine.tracks['1'].manifest.file_urls_mp3[0].file_url === SILENT_MEDIA);
  }

  /* ---- 2. the URL check the player runs -------------------------------------------- */
  {
    const h = makeHarness();
    h.load();
    check('the clip passes the player\'s https check', h.inContext('/^https:\\/\\//.test(' + JSON.stringify(SILENT_MEDIA) + ')') === true);
    check('any other data: URL does not', h.inContext('/^https:\\/\\//.test("data:audio/mpeg;base64,AAAA")') === false);
    check('every other test on the page is the native one', h.inContext('/^spotify:ad:/i.test("spotify:ad:x") && !/foo/.test("bar") && /a(b)/.exec("ab")[1] === "b"'));
  }

  /* ---- 3. the slot, replayed from the live capture --------------------------------- */
  {
    const h = makeHarness();
    h.load();
    const media = h.newMedia();
    /* t=0: the player enters the ad state and loads the clip. */
    media.src = SILENT_MEDIA; media.currentSrc = SILENT_MEDIA; media.play();
    check('the slot opens the moment the clip plays: the bar is blanked', h.html.hasAttribute('data-wo-spotify-ad'));
    check('the clip itself was never given a synthetic ended', media.dispatched.length === 0);
    h.clock.advance(132); media.ended = true;
    h.clock.advance(418);
    check('nothing is dispatched before the server confirms the ad -- the player would not act on it', media.dispatched.length === 0);
    /* t=550: the confirming machine. */
    const res = await h.fetchState(adCurrentMachine());
    await res.json(); await settle();
    check('the confirmation alone dispatches nothing', media.dispatched.length === 0);
    h.clock.advance(50);
    check('50 ms after the confirming response the clip\'s ended is re-dispatched', media.dispatched.length === 1 && media.dispatched[0] === 'ended');
    check('the bar is still blank while the player transitions', h.html.hasAttribute('data-wo-spotify-ad'));
    /* The player moves on: the next song, a MediaSource on the same detached element. */
    h.clock.advance(60);
    media.src = 'blob:https://open.spotify.com/1c1bbf68'; media.currentSrc = media.src; media.ended = false; media.play();
    check('the slot ends when the song plays: the bar is back', !h.html.hasAttribute('data-wo-spotify-ad'));
    check('the whole slot lasted 660 ms of virtual time, not the 1270 ms of a timer-driven retry', h.clock.now === 660);
    h.clock.advance(5000);
    check('no further ended is ever dispatched to the element once it carries a song', media.dispatched.length === 1);
  }
  {
    /* The clip ends AFTER the confirming response (slow load): the player advances on its own. */
    const h = makeHarness();
    h.load();
    const media = h.newMedia();
    media.src = SILENT_MEDIA; media.currentSrc = SILENT_MEDIA; media.play();
    h.clock.advance(550);
    await (await h.fetchState(adCurrentMachine())).json(); await settle();
    h.clock.advance(50);
    check('an ended that has not happened yet is not faked', media.dispatched.length === 0);
    h.clock.advance(100); media.ended = true; /* native ended at 700 */
    media.src = 'blob:https://open.spotify.com/next'; media.currentSrc = media.src; media.ended = false; media.play();
    h.clock.advance(3000);
    check('a player that moved on by itself is never nudged', media.dispatched.length === 0 && !h.html.hasAttribute('data-wo-spotify-ad'));
  }
  {
    /* The confirming response arrives before the clip plays (a slot the player resumed into). */
    const h = makeHarness();
    h.load();
    await (await h.fetchState(adCurrentMachine())).json(); await settle();
    check('the confirmation alone blanks the bar', h.html.hasAttribute('data-wo-spotify-ad'));
    h.clock.advance(300);
    const media = h.newMedia();
    media.src = SILENT_MEDIA; media.currentSrc = SILENT_MEDIA; media.ended = true; media.play();
    h.clock.advance(50);
    check('the nudges belong to the clip element once it plays', media.dispatched.length === 1);
  }
  {
    /* The rewrite missed and the real ad plays: muted, hidden, never ended early. */
    const h = makeHarness();
    h.load();
    await (await h.fetchState(adCurrentMachine())).json(); await settle();
    const ad = h.newMedia();
    ad.src = 'https://p.scdn.co/mp3-ad/9f0f2c3d.mp3?x=1'; ad.currentSrc = ad.src; ad.play();
    check('ad media the rewrite did not reach is muted', ad.muted === true && h.html.hasAttribute('data-wo-spotify-ad'));
    h.clock.advance(3000);
    check('and is never given a synthetic ended -- the report would not match the media', ad.dispatched.length === 0);
    h.clock.advance(6000);
    check('the blanking has a time limit (8 s) so a long slot cannot leave the bar empty for good', !h.html.hasAttribute('data-wo-spotify-ad'));
    check('the mute does not: it lasts until something that is not an ad plays', ad.muted === true);
    const song = h.newMedia();
    song.src = 'blob:https://open.spotify.com/song'; song.currentSrc = song.src; song.play();
    check('the next song restores the ad element\'s mute state and is itself untouched', ad.muted === false && song.muted === false);
    const ep = h.newMedia();
    await (await h.fetchState(adCurrentMachine())).json(); await settle();
    ep.src = 'https://traffic.megaphone.fm/ep.mp3'; ep.currentSrc = ep.src; ep.play();
    check('an episode from a podcast host is not an ad: not muted, and it ends the slot', ep.muted === false && !h.html.hasAttribute('data-wo-spotify-ad'));
  }
  {
    /* Never on an element that is looping, errored, or simply still playing. */
    const h = makeHarness();
    h.load();
    for (const [label, arrange] of [['still playing', (m) => { m.ended = false; }], ['errored', (m) => { m.ended = true; m.error = { code: 4 }; }], ['looping', (m) => { m.ended = true; m.loop = true; }]]) {
      const media = h.newMedia();
      media.src = SILENT_MEDIA; media.currentSrc = SILENT_MEDIA; arrange(media); media.play();
      await (await h.fetchState(adCurrentMachine())).json(); await settle();
      h.clock.advance(2500);
      check('a clip that is ' + label + ' is never given a synthetic ended', media.dispatched.length === 0);
      const song = h.newMedia(); song.src = 'blob:x'; song.currentSrc = 'blob:x'; song.play();
    }
    check('the schedule stops on its own: no timers are left behind after a slot', h.clock.timers.size === 0);
  }
  {
    /* The URL is the authority, not the ended flag: a stale ended on an element that already
       carries the next song (src set, play not yet called) must not be re-dispatched. */
    const h = makeHarness();
    h.load();
    const media = h.newMedia();
    media.src = SILENT_MEDIA; media.currentSrc = SILENT_MEDIA; media.ended = true; media.play();
    await (await h.fetchState(adCurrentMachine())).json(); await settle();
    media.src = 'blob:https://open.spotify.com/next'; media.currentSrc = media.src;
    h.clock.advance(2500);
    check('an element that already carries the next song is never nudged, whatever its ended flag says', media.dispatched.length === 0);
  }

  /* ---- 4. lifecycle, slow responses and consecutive ad slots ------------------------- */
  {
    const h = makeHarness(); h.load();
    for (const url of ['https://example.com/track-playback/v1/state',
      'https://spotify.com.example.org/track-playback/v1/state',
      'https://gew1-spclient.spotify.com/metadata?next=/track-playback/v1/state']) {
      h.underlying.next = new Response(JSON.stringify(adCurrentMachine()));
      const result = await h.window.fetch(url);
      check('lookalike playback URLs are untouched: ' + url, result === h.underlying.next && !h.html.hasAttribute('data-wo-spotify-ad'));
    }
  }
  for (const phase of ['network', 'body']) {
    for (const action of ['disable', 'disable-reenable', 'dispose']) {
      const h = makeHarness(); h.load();
      const link = auth.handshake(h.dispatchDoc, h.fireWindow);
      let resolve;
      const pending = new Promise(r => { resolve = r; });
      const original = phase === 'body'
        ? { clone: () => ({ json: () => pending }) }
        : new Response(JSON.stringify(adCurrentMachine()));
      h.underlying.next = phase === 'network' ? pending : original;
      const request = h.window.fetch(STATE_URL);
      await settle();
      if (action === 'dispose') link.sendDispose();
      else {
        link.sendConfig({ adShield: false });
        if (action === 'disable-reenable') link.sendConfig({ adShield: true });
      }
      resolve(phase === 'network' ? original : adCurrentMachine());
      const result = await request;
      check(action + ' during pending ' + phase + ' leaves the response and slot alone',
        result === original && !h.html.hasAttribute('data-wo-spotify-ad') && h.clock.timers.size === 0);
    }
  }
  {
    const h = makeHarness(); h.load();
    let resolve;
    h.underlying.next = new Promise(r => { resolve = r; });
    const pending = h.window.fetch(STATE_URL);
    const song = h.newMedia(); song.src = song.currentSrc = 'blob:https://open.spotify.com/already-playing'; song.play();
    resolve(new Response(JSON.stringify(adCurrentMachine())));
    await pending;
    h.clock.advance(100);
    check('a delayed old ad confirmation never re-blanks a song that already started',
      !h.html.hasAttribute('data-wo-spotify-ad') && h.clock.timers.size === 0);
  }
  {
    const h = makeHarness(); h.load();
    const first = h.newMedia();
    first.src = first.currentSrc = SILENT_MEDIA; first.ended = true; first.play();
    await h.fetchState(adCurrentMachine());
    h.clock.advance(50);
    const firstCount = first.dispatched.length;
    const second = h.newMedia();
    second.src = second.currentSrc = SILENT_MEDIA; second.ended = true; second.play();
    await h.fetchState(adCurrentMachine());
    h.clock.advance(50);
    check('a consecutive ad on a fresh detached element receives recovery', second.dispatched.length === 1);
    check('the preceding ad element is released, not nudged again', first.dispatched.length === firstCount && first.events.ended.length === 0);
    second.src = 'blob:https://open.spotify.com/next';
    /* currentSrc is deliberately still the old clip until resource selection catches up. */
    h.clock.advance(3000);
    check('a new song src takes precedence over a stale ad currentSrc', second.dispatched.length === 1);
    second.currentSrc = second.src; second.ended = false; second.play();
    const nextBreak = h.newMedia();
    nextBreak.src = nextBreak.currentSrc = SILENT_MEDIA; nextBreak.ended = true; nextBreak.play();
    h.clock.advance(500);
    check('a later break cannot reuse the preceding break confirmation', nextBreak.dispatched.length === 0);
    await h.fetchState(adCurrentMachine()); h.clock.advance(50);
    check('the later break resumes on its own confirmation', nextBreak.dispatched.length === 1);
  }
  {
    const h = makeHarness(); h.load();
    const media = h.newMedia(); media.src = media.currentSrc = SILENT_MEDIA; media.play();
    await h.fetchState(adCurrentMachine()); h.clock.advance(3000);
    media.ended = true;
    media.dispatchEvent({ type: 'ended', isTrusted: true });
    const nativeCount = media.dispatched.length;
    h.clock.advance(50);
    check('a slow clip ending after the initial schedule can still recover', media.dispatched.length === nativeCount + 1);
    h.clock.advance(10000);
    check('synthetic ended events never recursively re-arm recovery', media.dispatched.length === nativeCount + 7 && h.clock.timers.size === 0);
    check('slot timeout removes its detached-element listener', media.events.ended.length === 0);
  }
  {
    const h = makeHarness(); h.load();
    for (const src of ['https://audio-fa.scdn.co/audio/song', 'https://audio-cf.spotifycdn.com/audio/preview',
      'https://audio.akamaized.net/audio/song', 'https://p.scdn.co/mp3/preview.mp3']) {
      const media = h.newMedia(); media.src = media.currentSrc = src; media.play();
      check('shared-CDN music is never muted merely by its host: ' + src, !media.muted && !h.html.hasAttribute('data-wo-spotify-ad'));
    }
    const markedUrl = 'https://audio-cf.spotifycdn.com/audio/metadata-confirmed-ad';
    const m = adCurrentMachine(); m.state_machine.tracks[3].manifest.file_urls_mp3[0].file_url = markedUrl;
    await h.fetchState(m);
    const ad = h.newMedia(); ad.src = ad.currentSrc = markedUrl; ad.play();
    check('a shared-CDN URL explicitly identified by ad metadata retains the mute fail-safe', ad.muted);
    const song = h.newMedia(); song.src = song.currentSrc = 'blob:https://open.spotify.com/next'; song.play();
    check('the metadata-backed mute is restored at the next song', !ad.muted && !song.muted);
  }

  /* ---- 5. what the bridge says, signed ---------------------------------------------- */
  {
    const h = makeHarness();
    h.load();
    h.fireWindow({ source: 'wardenone-handshake', token: 'guess' });
    h.fireWindow({ source: 'wardenone', kind: 'config', token: 'guess', overrides: { enabled: false } });
    let out = await (await h.fetchState(songMachineWithAdNext())).json();
    check('the old unsigned handshake and config are ignored: still blocking', fileUrl(out, 1).file_url === SILENT_MEDIA && h.style().disabled === false);
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    const forged = auth.configMessage(new auth.Signer(auth.newKey()), link.token, { enabled: false });
    h.fireWindow(forged);
    out = await (await h.fetchState(songMachineWithAdNext())).json();
    check('a config with the right token and the wrong key is ignored', fileUrl(out, 1).file_url === SILENT_MEDIA);
    link.sendConfig({ enabled: true, adShield: false });
    h.underlying.next = new Response(JSON.stringify(songMachineWithAdNext()), { status: 200 });
    const passthrough = await h.window.fetch(STATE_URL);
    check('AdShield off, signed: playback responses pass through untouched and the cosmetics are off', passthrough === h.underlying.next && h.style().disabled === true);
    check('and the clip no longer passes the https check', h.inContext('/^https:\\/\\//.test(' + JSON.stringify(SILENT_MEDIA) + ')') === false);
    const genuine = auth.configMessage(link.signer, link.token, { enabled: true, adShield: true });
    h.fireWindow(genuine);
    out = await (await h.fetchState(songMachineWithAdNext())).json();
    check('a later genuine config turns it back on', fileUrl(out, 1).file_url === SILENT_MEDIA && h.style().disabled === false);
    h.fireWindow(genuine);
    link.sendConfig({ enabled: true, adShield: true, allowlist: ['spotify.com'] });
    h.underlying.next = new Response(JSON.stringify(songMachineWithAdNext()), { status: 200 });
    check('the site on the user\'s allowlist (by suffix) is left alone', (await h.window.fetch(STATE_URL)) === h.underlying.next);
    link.sendConfig({ enabled: true, adShield: true, allowlist: ['example.com', 'notspotify.com'] });
    out = await (await h.fetchState(songMachineWithAdNext())).json();
    check('an allowlist naming other sites changes nothing', fileUrl(out, 1).file_url === SILENT_MEDIA);
    const stale = auth.configMessage(link.signer, link.token, { enabled: false });
    link.sendConfig({ enabled: true, adShield: true });
    h.fireWindow(stale);
    out = await (await h.fetchState(songMachineWithAdNext())).json();
    check('a signed message replayed out of order is refused on its sequence number', fileUrl(out, 1).file_url === SILENT_MEDIA);
  }
  {
    const h = makeHarness();
    h.load();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    const media = h.newMedia();
    media.src = SILENT_MEDIA; media.currentSrc = SILENT_MEDIA; media.ended = true; media.play();
    await (await h.fetchState(adCurrentMachine())).json(); await settle();
    link.sendConfig({ enabled: false });
    h.clock.advance(3000);
    check('switching off mid-slot ends the slot: bar back, no nudges', !h.html.hasAttribute('data-wo-spotify-ad') && media.dispatched.length === 0 && h.clock.timers.size === 0);
    check('there is no window.__wardenOneSpotifyAdblockDispose for a page to call', typeof h.sandbox.window.__wardenOneSpotifyAdblockDispose === 'undefined' && !/__wardenOneSpotifyAdblockDispose/.test(SOURCE));
    h.fireWindow({ source: 'wardenone', kind: 'dispose', token: link.token, seq: 99, mac: 'nope' });
    check('a dispose the page posts changes nothing', h.messageListeners.length === 1 && h.sandbox.window.__wardenOneSpotifyAdblockReady === VERSION);
    link.sendDispose();
    check('a bridge-signed dispose restores fetch, RegExp.prototype.test and play to the natives', h.inContext('RegExp.prototype.test === __nativeTest && HTMLMediaElement.prototype.play === __nativePlay') && h.window.fetch.name !== 'spotifyFetch');
    check('removes the style and every listener, and drops the ready flag', !h.style() && h.messageListeners.length === 0 && Object.keys(h.dispatchDoc.registry).every((k) => !h.dispatchDoc.registry[k].length) && typeof h.sandbox.window.__wardenOneSpotifyAdblockReady === 'undefined');
  }
  {
    const h = makeHarness();
    h.load();
    const before = h.window.fetch;
    h.load();
    check('a second copy in the same document returns at once', h.window.fetch === before && h.html.children.length === 1);
    const other = makeHarness();
    other.sandbox.location.hostname = 'accounts.spotify.com';
    other.load();
    check('the module is scoped to open.spotify.com', typeof other.sandbox.window.__wardenOneSpotifyAdblockReady === 'undefined' && other.window.fetch === other.sandbox.window.fetch && !other.style());
  }

  /* ---- 6. the shipped shape ---------------------------------------------------------- */
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const entry = (manifest.content_scripts || []).find((c) => (c.js || []).includes('spotify-adblock.js'));
    check('the manifest runs it in the MAIN world at document_start on open.spotify.com only', !!entry && entry.world === 'MAIN' && entry.run_at === 'document_start' && JSON.stringify(entry.matches) === '["https://open.spotify.com/*"]');
    check('the module takes its key from wo-key and verifies config and dispose', /'wo-key'/.test(SOURCE) && /woVerify\('config', JSON\.stringify\(m\.overrides\), m\)/.test(SOURCE) && /woVerify\('dispose', '', m\)/.test(SOURCE) && !/'wardenone-handshake'/.test(SOURCE));
    check('it never seeks, never changes playback rate, never looks for audio elements in the document', !/currentTime\s*=/.test(SOURCE) && !/playbackRate/.test(SOURCE) && !/querySelectorAll\(['"]audio/.test(SOURCE));
    check('the ad chrome the live player renders is in the always-hidden list', ['[data-testid="ad"]', '[data-testid^="ad-"]', '[data-testid="context-item-info-ad-subtitle"]', '[data-testid="button-like-ad"]'].every((s) => SOURCE.indexOf(s) !== -1));
    check('the bar has slot-scoped blanking', /html\[data-wo-spotify-ad\] /.test(SOURCE) && SOURCE.indexOf("'[data-testid=\"now-playing-widget\"]'") !== -1);
    check('ad-only DOM controls hide the initial flash before the media hook runs', hStyleHasFirstPaintRule());
    check('CREDITS names the clip\'s origin', /noop-0\.1s\.mp3/.test(fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8')));
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all Spotify ad blocker checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

function hStyleHasFirstPaintRule() {
  const h = makeHarness(); h.load();
  return h.style().textContent.includes('html:has([data-testid="now-playing-bar"] [data-testid="ad-controls"])') &&
    h.style().textContent.includes('#Desktop_PanelContainer_Id');
}

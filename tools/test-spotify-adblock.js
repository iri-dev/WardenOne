/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Behavioural tests for the real Spotify Web Player module (spotify-adblock.js).
 *
 * The module rewrites the state-machine responses the player fetches and NEVER touches the
 * account's server-side playback state (an earlier version that did was echoed back to the
 * player over Spotify's worker-side dealer socket as "you are on the ad now" -> "can't play
 * this" + a self-firing skip button; that whole approach is gone). The fixtures are the two
 * live shapes read off /track-playback/v1/devices/<id>/state: a song whose natural end leads
 * to an ad while the skip button leads to the next song (rerouted, seamless), and a song
 * where every exit is the ad (the ad state is marked already-complete and its finished clip
 * is signalled again after server confirmation, closing the early-ended race). Every check
 * that the module must not reach for the server is here too.
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
function plainSongMachine() {
  const m = songMachineAdOnAdvance();
  m.state_machine.tracks[1] = songTrack('7FE74FvU', 'Cold in the Water');
  return m;
}
const STATE_URL = 'https://gew1-spclient.spotify.com/track-playback/v1/devices/3a03f01af43207/state';
const CONFLICT_URL = 'https://gew1-spclient.spotify.com/track-playback/v1/devices/3a03f01af43207/state_conflict';

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
  const window = {
    addEventListener: (type, fn) => { if (type === 'message') messageListeners.push({ fn }); },
    removeEventListener: (type, fn) => { const i = messageListeners.findIndex((l) => l.fn === fn); if (i >= 0) messageListeners.splice(i, 1); },
    fetch: function (input, init) { underlying.calls.push({ url: typeof input === 'string' ? input : (input && input.url), init }); const r = typeof underlying.next === 'function' ? underlying.next(input, init) : underlying.next; return Promise.resolve(r); },
    Headers, Response, URL, MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ font: '', color: '', backgroundColor: '' }),
    Event: class Event { constructor(type) { this.type = type; this.isTrusted = false; } },
  };
  window.window = window; window.self = window;
  const fireWindow = (data) => { messageListeners.slice().forEach((l) => { try { l.fn({ source: window, data }); } catch (e) { dispatched.push('listener-threw:' + e); } }); };
  const sandbox = {
    window, document, location: { hostname: 'open.spotify.com', href: 'https://open.spotify.com/' },
    setTimeout, clearTimeout, Date, console: { warn() {}, log() {} },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    function HTMLMediaElement() { this.src = ''; this.currentSrc = ''; this.muted = false; this.ended = false; this.loop = false; this.error = null; this.__listeners = Object.create(null); }
    HTMLMediaElement.prototype.addEventListener = function (type, fn) { (this.__listeners[type] || (this.__listeners[type] = [])).push(fn); };
    HTMLMediaElement.prototype.removeEventListener = function (type, fn) { var a = this.__listeners[type] || []; this.__listeners[type] = a.filter(function (item) { return item !== fn; }); };
    HTMLMediaElement.prototype.dispatchEvent = function (event) { var a = (this.__listeners[event.type] || []).slice(); for (var i = 0; i < a.length; i++) a[i].call(this, event); return true; };
    HTMLMediaElement.prototype.play = function () { this.plays = (this.plays||0)+1; return Promise.resolve(); };
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

(async () => {
  console.log('\nSpotify Web Player ad blocker\n');
  {
    const wav = Buffer.from(SILENT_MEDIA.split(',')[1], 'base64');
    check('replacement is a complete PCM WAV with a non-zero 1 ms duration',
      SILENT_MEDIA.startsWith('data:audio/wav;base64,') && wav.toString('ascii', 0, 4) === 'RIFF' &&
      wav.toString('ascii', 8, 12) === 'WAVE' && wav.readUInt32LE(4) === wav.length - 8 &&
      wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16 &&
      wav.readUInt32LE(40) === wav.length - 44 && wav.readUInt32LE(40) / wav.readUInt32LE(28) === 0.001);
    check('every sample in the replacement is genuine digital silence', wav.subarray(44).every((byte) => byte === 0));
  }

  /* ---- 1. silence + shorten + reroute, on a fetched response ------------------------- */
  {
    const h = makeHarness();
    h.load();
    check('the module installs on open.spotify.com at document_start', h.sandbox.window.__wardenOneSpotifyAdblockReady === VERSION && !!h.style() && h.style().isConnected);
    check('and asks the bridge for a replay once its listeners exist', h.dispatched.includes('wo-bridge-replay'));

    const res = await h.fetchState(songMachineAdOnAdvance());
    const out = await res.json();
    const s2 = out.state_machine.states[2].transitions;
    check('the ad track audio is swapped for the silent clip, file id 1', fileUrl(out, 1).file_url === SILENT_MEDIA && fileUrl(out, 1).file_id === 1);
    check('the songs around it keep their encrypted-MP4 manifests untouched', JSON.stringify(out.state_machine.tracks[0].manifest) === JSON.stringify(songTrack('6u6DXAyj', 'Hollow').manifest) && !('file_urls_mp3' in out.state_machine.tracks[2].manifest));
    check('the natural end is rerouted to the next song (the skip target), so the ad is never reached', s2.advance.state_index === 0 && s2.advance.paused === false && out.state_machine.tracks[out.state_machine.states[0].track].content_type === 'TRACK');
    check('the skip and show transitions and the current ref are exactly as the server sent them', s2.skip_next.state_index === 0 && s2.skip_prev.state_index === 1 && s2.show_next.state_index === 4 && s2.show_prev.state_index === 5 && out.updated_state_ref.state_index === 2);
    check('status, statusText and unrelated headers survive the rewrite', res.status === 200 && res.statusText === 'OK' && res.headers.get('x-spotify') === 'yes');
    check('content-length and content-encoding do not', !res.headers.get('content-length') && !res.headers.get('content-encoding'));
    check('the module never made a request of its own -- the server state is never touched', h.underlying.calls.length === 1);
  }
  {
    /* Every-exit-is-the-ad: nothing to reroute to, so the ad state is marked already-done. */
    const h = makeHarness();
    h.load();
    const out = await (await h.fetchState(songMachineForcedAd())).json();
    const ad = adState(out);
    check('the forced ad state is marked already at its end so the server advances out of it at once',
      ad.initial_playback_position === 30000 && ad.position_offset === 30000 && ad.disallow_seeking === false && (!ad.restrictions || Object.keys(ad.restrictions).length === 0), JSON.stringify({ ipp: ad.initial_playback_position, po: ad.position_offset, r: ad.restrictions }));
    check('its audio is silenced too', fileUrl(out, 1).file_url === SILENT_MEDIA);
    check('the current song still advances into the ad (there is nowhere else), but the ad is now instant', out.state_machine.states[2].transitions.advance.state_index === 3);
    check('again, no request of the module\'s own', h.underlying.calls.length === 1);
  }
  {
    /* Live race: the 1 ms clip finishes before the response confirms that its ad is current.
       The player ignored that early ending and used to remain on Advertisement indefinitely. */
    const h = makeHarness();
    h.load();
    const clip = h.newMedia();
    clip.src = clip.currentSrc = SILENT_MEDIA;
    clip.ended = true;
    let endings = 0;
    clip.addEventListener('ended', () => { endings++; });
    h.inContext('HTMLMediaElement.prototype.play').call(clip);
    check('the now-playing bar is blanked as soon as the forced-ad clip loads', h.html.hasAttribute('data-wo-spotify-ad'));
    const confirmed = songMachineForcedAd();
    confirmed.updated_state_ref = ref(3);
    await h.fetchState(confirmed);
    await new Promise((resolve) => setTimeout(resolve, 90));
    check('a server-confirmed ad re-signals its already-finished clip instead of getting stuck', endings > 0, endings);
    const song = h.newMedia();
    song.src = song.currentSrc = 'blob:https://open.spotify.com/next-song';
    h.inContext('HTMLMediaElement.prototype.play').call(song);
    const settledEndings = endings;
    await new Promise((resolve) => setTimeout(resolve, 180));
    check('normal media ends the slot, restores the bar and cancels every remaining retry',
      !h.html.hasAttribute('data-wo-spotify-ad') && endings === settledEndings);
  }
  {
    const h = makeHarness();
    h.load();
    /* advance leads to a song already; skip_next is the ad. Advance must not be rerouted onto an ad. */
    const m = songMachineAdOnAdvance();
    m.state_machine.states[2].transitions = Object.assign(m.state_machine.states[2].transitions, { advance: ref(0), skip_next: ref(3) });
    const out = await (await h.fetchState(m)).json();
    check('advance is only ever rerouted onto a non-ad target', out.state_machine.states[2].transitions.advance.state_index === 0);
    const bad = songMachineAdOnAdvance();
    bad.state_machine.states[2].transitions.skip_next = { state_index: 99 };
    const b = await (await h.fetchState(bad)).json();
    check('a skip target outside the machine is never followed', b.state_machine.states[2].transitions.advance.state_index === 3);
  }

  /* ---- 2. what is left alone -------------------------------------------------------- */
  {
    const h = makeHarness();
    h.load();
    h.underlying.next = new Response(JSON.stringify(plainSongMachine()), { status: 200 });
    const res = await h.window.fetch(STATE_URL, { method: 'PUT', body: '{}' });
    check('a machine with no ad comes back as the very Response the server sent', res === h.underlying.next);
    h.underlying.next = new Response(JSON.stringify(songMachineAdOnAdvance()), { status: 200 });
    const other = await h.window.fetch('https://gew1-spclient.spotify.com/storage-resolve/v2/files/audio/interactive/10/abc');
    check('a response from any other endpoint is never read or rewritten, ad-shaped or not', other === h.underlying.next);
    h.underlying.next = new Response(null, { status: 204 });
    const empty = await h.window.fetch(STATE_URL, { method: 'PUT', body: '{}' });
    check('an empty 204 on the endpoint passes through', empty === h.underlying.next && empty.status === 204);
    check('a response with no ad is never parsed or rebuilt -- it is kept off the control-latency path',
      /text\.indexOf\(':ad:'\) < 0 && text\.indexOf\('"AD"'\) < 0/.test(SOURCE) && /\.clone\(\)\.text\(\)/.test(SOURCE));
    const m2 = songMachineAdOnAdvance();
    m2.state_machine.tracks[1] = { metadata: { uri: 'spotify:episode:pod1', name: 'An episode', duration: 1800000 }, manifest: { file_urls_mp3: [{ file_id: 'ep', file_url: 'https://traffic.megaphone.fm/ep.mp3' }] }, content_type: 'EPISODE' };
    m2.state_machine.states[2].transitions = Object.assign(m2.state_machine.states[2].transitions, { advance: ref(0), skip_next: ref(0), skip_prev: ref(1) });
    h.underlying.next = new Response(JSON.stringify(m2), { status: 200 });
    const pod = await h.window.fetch(STATE_URL, { method: 'PUT', body: '{}' });
    check('an episode with a plain MP3 URL is not an ad and is left alone', pod === h.underlying.next);
  }
  {
    /* content_type AD alone, a bare :ad: uri, video ad manifests, and index-keyed tracks. */
    const h = makeHarness();
    h.load();
    const m = songMachineAdOnAdvance();
    m.state_machine.tracks[1] = adTrack({ metadata: { uri: 'spotify:track:oddlylabelled', name: 'x', duration: 30000 } });
    check('content_type AD alone is enough to be treated as an ad', fileUrl(await (await h.fetchState(m)).json(), 1).file_url === SILENT_MEDIA);
    const u = songMachineAdOnAdvance();
    u.state_machine.tracks[1] = adTrack({ content_type: 'TRACK' });
    check('a spotify:ad: uri alone is enough, even labelled TRACK', fileUrl(await (await h.fetchState(u)).json(), 1).file_url === SILENT_MEDIA);
    const v = songMachineAdOnAdvance();
    v.state_machine.tracks[1].manifest.file_urls_mp4 = [{ file_id: 'vid', file_url: 'https://adstudio-assets.scdn.co/video/ad.mp4' }];
    check('a video ad candidate is silenced the same way', (await (await h.fetchState(v)).json()).state_machine.tracks[1].manifest.file_urls_mp4[0].file_url === SILENT_MEDIA);
    const k = songMachineAdOnAdvance();
    k.state_machine.tracks = Object.fromEntries(k.state_machine.tracks.map((t, i) => [String(i), t]));
    check('tracks keyed by index instead of listed are handled', (await (await h.fetchState(k)).json()).state_machine.tracks['1'].manifest.file_urls_mp3[0].file_url === SILENT_MEDIA);
  }
  {
    /* A rejected-state answer carries replacement machines in its commands. */
    const h = makeHarness();
    h.load();
    h.underlying.next = new Response(JSON.stringify({ commands: [{ type: 'replace_state', state_ref: { state_index: 2 }, state_machine: songMachineAdOnAdvance().state_machine }] }), { status: 200 });
    const out = await (await h.window.fetch(CONFLICT_URL, { method: 'PUT', body: '{}' })).json();
    check('a replace_state command\'s machine is prepared like a fetched one', out.commands[0].state_machine.states[2].transitions.advance.state_index === 0 && out.commands[0].state_machine.tracks[1].manifest.file_urls_mp3[0].file_url === SILENT_MEDIA);
  }

  /* ---- 3. the URL check the player runs -------------------------------------------- */
  {
    const h = makeHarness();
    h.load();
    check('the clip passes the player\'s https check', h.inContext('/^https:\\/\\//.test(' + JSON.stringify(SILENT_MEDIA) + ')') === true);
    check('any other data: URL does not', h.inContext('/^https:\\/\\//.test("data:audio/mpeg;base64,AAAA")') === false);
    check('every other test on the page is the native one', h.inContext('/^spotify:ad:/i.test("spotify:ad:x") && !/foo/.test("bar") && /a(b)/.exec("ab")[1] === "b"'));
  }

  /* ---- 4. the audio fail-safe ------------------------------------------------------- */
  {
    const h = makeHarness();
    h.load();
    await h.fetchState(songMachineForcedAd());
    const ad = h.newMedia();
    ad.src = 'https://p.scdn.co/mp3-ad/9f0f2c3d.mp3?x=1'; ad.currentSrc = ad.src;
    h.inContext('HTMLMediaElement.prototype.play').call(ad);
    check('ad media the rewrite did not reach is muted (a URL it saw in a manifest)', ad.muted === true);
    const song = h.newMedia();
    song.src = 'blob:https://open.spotify.com/song'; song.currentSrc = song.src;
    h.inContext('HTMLMediaElement.prototype.play').call(song);
    check('the next song restores the ad element\'s mute state and is itself untouched', ad.muted === false && song.muted === false);
    for (const src of ['https://audio-fa.scdn.co/audio/song', 'https://audio-cf.spotifycdn.com/audio/preview', 'https://p.scdn.co/mp3/preview.mp3']) {
      const m = h.newMedia(); m.src = m.currentSrc = src; h.inContext('HTMLMediaElement.prototype.play').call(m);
      check('shared-CDN music/previews are never muted by host alone: ' + src, m.muted === false);
    }
    const dedicated = h.newMedia();
    dedicated.src = dedicated.currentSrc = 'https://2mdn.net/ad.mp3'; h.inContext('HTMLMediaElement.prototype.play').call(dedicated);
    check('a dedicated ad host is muted by the fail-safe', dedicated.muted === true);
    const cleanup = h.newMedia();
    cleanup.src = cleanup.currentSrc = 'blob:https://open.spotify.com/cleanup'; h.inContext('HTMLMediaElement.prototype.play').call(cleanup);
  }

  /* ---- 5. narrow protocol boundaries ------------------------------------------------ */
  {
    check('the module never issues a state request of its own (no seq_num, no debug_source, no state_ref writes)',
      !/seq_num/.test(SOURCE) && !/debug_source/.test(SOURCE) && !/state_ref\s*[:=]\s*\{/.test(SOURCE));
    check('it never seeks, never changes playback rate and never scans the document for media elements',
      !/currentTime\s*=/.test(SOURCE) && !/playbackRate\s*=/.test(SOURCE) && !/querySelector(All)?\(['"][^'"]*(audio|video)/i.test(SOURCE));
    check('the only synthetic media signal is ended, guarded to the exact finished, non-looping clip',
      /if \(!isClip\(media\)\)/.test(SOURCE) &&
      SOURCE.includes("if (media.ended && !media.loop && !media.error) media.dispatchEvent(new NativeEvent('ended'));") &&
      (SOURCE.match(/media\.dispatchEvent\(/g) || []).length === 1);
    /* The page world never touches a WebSocket; only the worker shim does, inside the worker,
       where Spotify's dealer socket actually lives. */
    const shim = (SOURCE.match(/function woWorkerShim\(SILENT\) \{[\s\S]*?\n  \}\n/) || [''])[0];
    const codeOutsideShim = SOURCE.replace(shim, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check('the page world never opens or hooks a WebSocket -- only the worker shim does, in the worker',
      /self\.WebSocket/.test(shim) && !/WebSocket/.test(codeOutsideShim) && !/window\.WebSocket\s*=/.test(SOURCE) && !/new WebSocket\b/.test(codeOutsideShim));
    check('the only transition it ever writes is advance, to the machine\'s own skip_next target',
      (SOURCE.match(/transitions\.advance\s*=/g) || []).length === 1 && /transitions\.advance = \{ state_index: transitions\.skip_next\.state_index, paused: transitions\.skip_next\.paused === true \};/.test(SOURCE) && !/transitions\.(skip_next|skip_prev|show_next|show_prev)\s*=/.test(SOURCE) && !/updated_state_ref\s*[:=]/.test(SOURCE));
  }

  /* ---- 6. what the bridge says, signed --------------------------------------------- */
  {
    const h = makeHarness(); h.load();
    const before = await (await h.fetchState(songMachineAdOnAdvance())).json();
    check('the old unsigned handshake and config are ignored: still blocking', fileUrl(before, 1).file_url === SILENT_MEDIA && h.style().disabled === false);
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    link.sendConfig({ adShield: false });
    const passthrough = await h.window.fetch(STATE_URL, { method: 'PUT', body: '{}' });
    check('AdShield off, signed: playback responses pass through untouched and the cosmetics are off', passthrough === h.underlying.next && h.style().disabled === true);
    check('and the clip no longer passes the https check', h.inContext('/^https:\\/\\//.test(' + JSON.stringify(SILENT_MEDIA) + ')') === false);
    link.sendConfig({ adShield: true });
    check('a later genuine config turns it back on', fileUrl(await (await h.fetchState(songMachineAdOnAdvance())).json(), 1).file_url === SILENT_MEDIA && h.style().disabled === false);
  }
  {
    const h = makeHarness(); h.load();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    link.sendConfig({ allowlist: ['open.spotify.com'] });
    check('the site on the user\'s allowlist (by suffix) is left alone', (await h.fetchState(songMachineAdOnAdvance())) === h.underlying.next);
  }
  {
    /* The module took key K from the first wo-key. A config signed with a DIFFERENT key but
       the same token must fail the MAC and be ignored -- still blocking. */
    const h = makeHarness(); h.load();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    const impostor = new auth.Signer('11'.repeat(32));
    h.fireWindow(auth.configMessage(impostor, link.token, { adShield: false }));
    check('a config with the right token but signed by the wrong key is ignored', fileUrl(await (await h.fetchState(songMachineAdOnAdvance())).json(), 1).file_url === SILENT_MEDIA && h.style().disabled === false);
    check('the sequence number is checked, so a captured signed message cannot be replayed', /seq <= woLastSeq/.test(SOURCE) && /woVerify\('config'/.test(SOURCE));
  }

  /* ---- 7. lifecycle ---------------------------------------------------------------- */
  {
    const h = makeHarness(); h.load();
    const link = auth.handshake(h.dispatchDoc, h.fireWindow);
    check('there is no window.__wardenOneSpotifyAdblockDispose for a page to call', typeof h.sandbox.window.__wardenOneSpotifyAdblockDispose === 'undefined');
    link.sendDispose();
    check('a bridge-signed dispose restores fetch, RegExp.prototype.test and play to what they were',
      h.window.fetch === h.origFetch && h.inContext('RegExp.prototype.test') === h.origTest && h.inContext('HTMLMediaElement.prototype.play') === h.origPlay);
    check('it removes the style and drops the ready flag', !h.style() && typeof h.sandbox.window.__wardenOneSpotifyAdblockReady === 'undefined');
    const later = await h.fetchState(songMachineAdOnAdvance());
    check('a response that lands after dispose is not rewritten', later === h.underlying.next);
  }
  {
    const h = makeHarness(); h.load();
    const before = h.window.fetch;
    h.load();
    check('a second copy in the same document returns at once', h.window.fetch === before && h.html.children.length === 1);
    const other = makeHarness();
    other.inContext('location.hostname = "example.com"; location.href = "https://example.com/";');
    other.load();
    check('the module is scoped to open.spotify.com', typeof other.sandbox.window.__wardenOneSpotifyAdblockReady === 'undefined' && other.window.fetch === other.origFetch);
  }

  /* ---- 8. the shipped shape -------------------------------------------------------- */
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const entry = (manifest.content_scripts || []).find((cs) => (cs.js || []).includes('spotify-adblock.js'));
    check('the manifest runs it in the MAIN world at document_start on open.spotify.com only', !!entry && entry.world === 'MAIN' && entry.run_at === 'document_start' && (entry.matches || []).join(',') === 'https://open.spotify.com/*');
    check('the module takes its key from wo-key and verifies config and dispose', /'wo-key'/.test(SOURCE) && /woVerify\('config', JSON\.stringify/.test(SOURCE) && /woVerify\('dispose'/.test(SOURCE));
    for (const sel of ['[data-testid="ad"]', '[data-testid^="ad-"]', '[data-testid="context-item-info-ad-subtitle"]']) {
      check('the ad chrome the live player renders is in the always-hidden list: ' + sel, SOURCE.includes(sel));
    }
    check('CREDITS names the technique\'s origin', /spotify-web-ads-remover/.test(fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8')) && /noop-0\.1s\.mp3/.test(fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8')));
  }

  /* ---- 9. the rewriter injected into Spotify's worker ------------------------------ */
  /* On this account the ad transitions arrive over the dealer WebSocket inside a Web Worker,
     invisible to a page-world script. woWorkerShim's SOURCE is run inside that worker; here it
     is run in a mock worker global and held to the same rewrite the page does. */
  {
    const shimMatch = SOURCE.match(/function woWorkerShim\(SILENT\) \{[\s\S]*?\n  \}\n/);
    check('the worker shim function is present to extract', !!shimMatch);
    const listeners = [];
    function FakeWS() {}
    FakeWS.prototype = { addEventListener() {} };
    Object.defineProperty(FakeWS.prototype, 'onmessage', { configurable: true, get() { return this.__om; }, set(fn) { this.__om = fn; } });
    const self = { WebSocket: FakeWS, fetch: null };
    const ctx = { self, MessageEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
      Headers, Response, Promise, JSON, Object, Array, Number, RegExp, String, console };
    self.self = self;
    vm.createContext(ctx);
    vm.runInContext('(' + shimMatch[0] + ')(' + JSON.stringify(SILENT_MEDIA) + ');', ctx, { filename: 'wo-worker-shim.js' });
    const rewrite = self.__WO_REWRITE__;
    check('the shim installs its rewriter in the worker scope', typeof rewrite === 'function');
    /* A dealer frame carrying a replace_state with an ad. */
    const dealerFrame = (machine) => JSON.stringify({ type: 'message', uri: 'hm://track-playback/v1/command', payloads: [{ type: 'replace_state', state_ref: { state_index: 2 }, state_machine: machine.state_machine }] });
    const outText = rewrite(dealerFrame(songMachineAdOnAdvance()));
    const out = JSON.parse(outText).payloads[0].state_machine;
    check('a dealer replace_state ad frame is rewritten: audio silenced, natural end rerouted past the ad',
      out.tracks[1].manifest.file_urls_mp3[0].file_url === SILENT_MEDIA && out.states[2].transitions.advance.state_index === 0);
    const forced = rewrite(dealerFrame(songMachineForcedAd()));
    const fad = adState({ state_machine: JSON.parse(forced).payloads[0].state_machine });
    check('a forced-ad dealer frame has its ad state marked already-complete', fad.initial_playback_position === 30000 && fad.disallow_seeking === false);
    /* Both exits lead to (different) ads: nothing to reroute to, so advance must be left on
       its ad target -- never repointed onto the other ad. */
    const bothAds = { state_machine: { state_machine_id: 'x', tracks: [songTrack('a', 'A'), adTrack(), adTrack({ metadata: { uri: 'spotify:ad:B', name: 'B', duration: 15000 } })],
      states: [state(0, { advance: ref(1), skip_next: ref(2) }), state(1), state(2)] }, updated_state_ref: ref(0) };
    const bothOut = JSON.parse(rewrite(dealerFrame(bothAds))).payloads[0].state_machine;
    check('when both exits are ads the natural end is not rerouted onto an ad', bothOut.states[0].transitions.advance.state_index === 1);
    check('a frame with no ad is left exactly as it was (returns null -> the worker keeps the original)',
      rewrite(dealerFrame(plainSongMachine())) === null && rewrite('not json at all') === null && rewrite(JSON.stringify({ payloads: [] })) === null);
    /* The WebSocket the worker code creates: a message with an ad is rewritten before the
       worker's own listener sees it, whether it listens by onmessage or addEventListener. */
    const ws = new self.WebSocket();
    let viaOnmessage = null;
    ws.onmessage = (ev) => { viaOnmessage = ev.data; };
    ws.__om({ data: dealerFrame(songMachineAdOnAdvance()), origin: '' });
    check('a message delivered by onmessage reaches the worker already rewritten',
      viaOnmessage && JSON.parse(viaOnmessage).payloads[0].state_machine.tracks[1].manifest.file_urls_mp3[0].file_url === SILENT_MEDIA);
    let viaAdd = null;
    const added = [];
    FakeWS.prototype.addEventListener = function (type, fn) { added.push({ type, fn }); };
    /* re-run the shim to re-wrap addEventListener over the fresh stub */
    vm.runInContext('(' + shimMatch[0] + ')(' + JSON.stringify(SILENT_MEDIA) + ');', ctx, { filename: 'wo-worker-shim.js' });
    const ws2 = new self.WebSocket();
    ws2.addEventListener('message', (ev) => { viaAdd = ev.data; });
    added[added.length - 1].fn({ data: dealerFrame(songMachineForcedAd()), origin: '' });
    check('a message delivered by addEventListener reaches the worker already rewritten', viaAdd && adState({ state_machine: JSON.parse(viaAdd).payloads[0].state_machine }).initial_playback_position === 30000);
    /* A non-ad message passes through untouched (same object the socket delivered). */
    let plain = null; const plainEv = { data: dealerFrame(plainSongMachine()), origin: '' };
    ws.onmessage = (ev) => { plain = ev; };
    ws.__om(plainEv);
    check('a non-ad message is delivered as the very event the socket produced', plain === plainEv);
  }
  {
    /* The module wires the worker hook in and unwinds it, and loads the real worker safely. */
    check('the worker hook is installed at start and the shim carries the silent clip',
      /installWorkerHook\(\);/.test(SOURCE) && /workerShimHead\(\) \{ return '\(' \+ woWorkerShim\.toString\(\) \+ '\)\(' \+ JSON\.stringify\(SILENT_MEDIA\)/.test(SOURCE));
    check('a classic worker is loaded with importScripts, a module worker with dynamic import',
      /importScripts\(' \+ JSON\.stringify\(abs\)/.test(SOURCE) && /import\(' \+ JSON\.stringify\(abs\)/.test(SOURCE) && /opts && opts\.type === 'module'/.test(SOURCE));
    check('a worker it cannot wrap falls back to the native one, never breaking it',
      /return w \|\| \(opts === undefined \? new NativeWorker\(url\) : new NativeWorker\(url, opts\)\);/.test(SOURCE) && /catch \(_\) \{ return null; \}/.test(SOURCE));
    check('SharedWorker is covered the same way', /NativeSharedWorker/.test(SOURCE) && /window\.SharedWorker = S;/.test(SOURCE));
    check('dispose restores the native Worker and SharedWorker', /window\.Worker = NativeWorker;/.test(SOURCE) && /window\.SharedWorker = NativeSharedWorker;/.test(SOURCE));
    const shimSrc = (SOURCE.match(/function woWorkerShim\(SILENT\) \{[\s\S]*?\n  \}\n/) || [''])[0];
    check('the injected rewriter never touches server state either (no state request, no state_ref writes in the shim)',
      !/seq_num/.test(shimSrc) && !/debug_source/.test(shimSrc) && !/\.send\(/.test(shimSrc));
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all Spotify ad blocker checks passed');
})();

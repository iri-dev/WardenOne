/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Spotify Web Player ad blocker.
 *
 * How the web player takes an ad, measured on the live player (2026-09-12): the server's
 * playback state machine puts the ad between two songs, and the player will not leave a
 * song until the server confirms what follows it. There are two shapes: usually only the
 * song's natural end leads to the ad and the skip button leads to the next song; after a
 * manual skip while an ad is pending, every exit is the ad.
 *
 * WardenOne never touches the account's server-side playback state (an earlier version that
 * did was echoed back to the player over Spotify's dealer socket -- which runs in a Web
 * Worker no page hook can reach -- as "you are on the ad now", which showed as "can't play
 * this" and a self-firing skip button). Instead it rewrites the state-machine responses the
 * player fetches, three ways, and leaves the server alone:
 *   1. The ad's audio is swapped for a 1 ms silent clip, so nothing audible ever loads. (The
 *      player validates the URL with a regular expression, hence the narrow
 *      RegExp.prototype.test shim below.)
 *   2. Where the machine offers the skip button's route to the next song beside the ad, the
 *      song's natural end is pointed at that route -- so the player advances straight to the
 *      next song with no ad and no gap. This is the common case.
 *   3. Any ad state still reachable (every-exit-is-the-ad, after a manual skip) is marked
 *      already at its end. The 1 ms clip can finish before Spotify confirms the state; as soon
 *      as that confirmation arrives, its guarded ended signal is replayed so the player moves
 *      on immediately instead of getting stranded on an Advertisement screen.
 * Only a track whose own metadata says it is an ad is touched; ordinary tracks, episodes and
 * podcast media keep their files, and any ad audio that ever slips through plays muted. The
 * ad chrome Spotify renders (countdown, companion card, the "Advertisement" label) is hidden
 * by stylesheet. The state-machine technique is the one the open-source Spotify Web Ads
 * Remover established (CREDITS.md); the code here is WardenOne's own. Songs travel as
 * encrypted MP4 over fetch and a MediaSource on a detached VIDEO element -- which is also why
 * the old fail-safe that searched the document for audio elements could never find the player.
 */
(function wardenOneSpotifyAdblock() {
  'use strict';

  const VERSION = '1.0.1';
  if (!/^open\.spotify\.com$/i.test(String(location.hostname || ''))) return;
  if (window.__wardenOneSpotifyAdblockReady) return;
  window.__wardenOneSpotifyAdblockReady = VERSION;

  /* Generated PCM WAV: eight zero-valued 16-bit mono samples at 8 kHz (1 ms).
     A valid, non-empty file gives the browser genuine metadata and a native ending,
     without spending 132 ms playing the previous MPEG replacement. */
  const SILENT_MEDIA = 'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const TRACK_PLAYBACK_RE = /^\/track-playback\//i;
  const AD_URI_RE = /^spotify:ad:/i;
  /* Rendered by the player only while an ad is current (element ids read off the live
     player). Hidden outright whenever an ad is current. */
  const AD_ELEMENT_SELECTOR = [
    '#leaderboard-ad-element',
    'a[data-context-item-type="ad"]',
    'div[aria-label="Advertisement"]',
    '[data-testid="ad"]',
    '[data-testid^="ad-"]',
    '[data-testid="context-item-info-ad-subtitle"]',
    '[data-testid="button-like-ad"]',
    '[data-testid="button-dislike-ad"]',
    '[data-testid="billboard-ad"]',
    '[data-testid="ads-video-player-npv"]',
    '[data-testid="canvas-ad-player"]',
  ].join(',');
  /* Blank the now-playing surfaces from the instant the silent clip loads until normal media
     resumes. The :has branch also catches Spotify's first ad render before play() reaches us. */
  const SLOT_ATTRIBUTE = 'data-wo-spotify-ad';
  const SLOT_ELEMENT_SELECTOR = [
    '[data-testid="now-playing-widget"]',
    '[data-testid="context-item-info-ad-subtitle"]',
    '[data-testid="playback-progressbar"]',
    '[data-testid="playback-position"]',
    '[data-testid="playback-duration"]',
    '[data-testid="video-card-image"]',
    '#Desktop_PanelContainer_Id',
  ].map((sel) => 'html[' + SLOT_ATTRIBUTE + '] ' + sel +
    ',html:has([data-testid="now-playing-bar"] [data-testid="ad-controls"]) ' + sel).join(',');
  /* The first retry lands just after the confirming response has been consumed. Later retries
     cover a slow player without extending the visible slot; all stop when normal media starts. */
  const NUDGE_SCHEDULE = [20, 60, 140, 260, 450, 750, 1150, 1750];
  const SLOT_TIMEOUT_MS = 5000;

  const nativeFetch = window.fetch;
  const nativeRegExpTest = RegExp.prototype.test;
  const NativeHeaders = window.Headers;
  const NativeResponse = window.Response;
  const NativeEvent = window.Event;
  const NativeURL = window.URL;
  const NativeWorker = window.Worker;
  const NativeSharedWorker = window.SharedWorker;
  const NativeBlob = window.Blob;
  const nativeCreateObjectURL = window.URL && window.URL.createObjectURL;
  const nativeRevokeObjectURL = window.URL && window.URL.revokeObjectURL;
  const mediaPrototype = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  const nativeMediaPlay = mediaPrototype && mediaPrototype.play;

  let enabled = true;
  let disposed = false;
  let configEpoch = 0;
  let playbackEpoch = 0;
  let lastNormalSrc = '';
  const listeners = [];
  const timers = new Set();
  const knownAdUrls = new Set();

  function on(target, type, listener, options) {
    try {
      target.addEventListener(type, listener, options);
      listeners.push([target, type, listener, options]);
    } catch (_) {}
  }
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) {
    if (!timers.has(id)) return;
    clearTimeout(id);
    timers.delete(id);
  }
  /* ---- what the bridge tells this module, signed (SEC-01) --------------------------------- */
  let woToken = null;
  let woKey = null;
  let woLastSeq = 0;
  /* HMAC-SHA256 over UTF-8 text, in plain JS. crypto.subtle is absent on http: pages and
     asynchronous everywhere, and this has to answer inside a synchronous DOM event. Every
     reference it needs is captured here, before the page runs, so a page that rewrites
     TextEncoder or Uint8Array later changes nothing about what it computes. Not a general
     library: fixed 32-byte key (hex), text in, hex out. */
  const __woAuth=(function(){
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const U8=Uint8Array,U32=Uint32Array;
    /* UTF-8 by hand rather than TextEncoder: a lifted fragment in a bare sandbox has no
       TextEncoder, and the page cannot be handed a hook into this either way. */
    function encode(text){
      const s=String(text),out=new U8(3*s.length+3);
      let n=0;
      for(let i=0;i<s.length;i++){
        let c=s.charCodeAt(i);
        if(c>=0xd800&&c<0xdc00&&i+1<s.length){const d=s.charCodeAt(i+1);if(d>=0xdc00&&d<0xe000){c=0x10000+((c-0xd800)<<10)+(d-0xdc00),i++}}
        if(c<0x80)out[n++]=c;
        else if(c<0x800)out[n++]=0xc0|(c>>6),out[n++]=0x80|(c&63);
        else if(c<0x10000)out[n++]=0xe0|(c>>12),out[n++]=0x80|((c>>6)&63),out[n++]=0x80|(c&63);
        else out[n++]=0xf0|(c>>18),out[n++]=0x80|((c>>12)&63),out[n++]=0x80|((c>>6)&63),out[n++]=0x80|(c&63)
      }
      return out.subarray(0,n)
    }
    const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
    function sha256(msg){
      const len=msg.length,padded=new U8(((len+9+63)>>6)<<6);
      padded.set(msg),padded[len]=0x80;
      const bits=len*8;
      padded[padded.length-4]=(bits>>>24)&255,padded[padded.length-3]=(bits>>>16)&255,padded[padded.length-2]=(bits>>>8)&255,padded[padded.length-1]=bits&255;
      const h=new U32([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new U32(64);
      for(let off=0;off<padded.length;off+=64){
        for(let i=0;i<16;i++)w[i]=(padded[off+4*i]<<24)|(padded[off+4*i+1]<<16)|(padded[off+4*i+2]<<8)|padded[off+4*i+3];
        for(let i=16;i<64;i++){
          const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3),s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);
          w[i]=(w[i-16]+s0+w[i-7]+s1)|0
        }
        let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],k=h[7];
        for(let i=0;i<64;i++){
          const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^(~e&g),t1=(k+S1+ch+K[i]+w[i])|0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),mj=(a&b)^(a&c)^(b&c),t2=(S0+mj)|0;
          k=g,g=f,f=e,e=(d+t1)|0,d=c,c=b,b=a,a=(t1+t2)|0
        }
        h[0]=(h[0]+a)|0,h[1]=(h[1]+b)|0,h[2]=(h[2]+c)|0,h[3]=(h[3]+d)|0,h[4]=(h[4]+e)|0,h[5]=(h[5]+f)|0,h[6]=(h[6]+g)|0,h[7]=(h[7]+k)|0
      }
      const out=new U8(32);
      for(let i=0;i<8;i++)out[4*i]=h[i]>>>24,out[4*i+1]=(h[i]>>>16)&255,out[4*i+2]=(h[i]>>>8)&255,out[4*i+3]=h[i]&255;
      return out
    }
    function hexBytes(hex){
      const s=String(hex||""),out=new U8(s.length>>1);
      for(let i=0;i<out.length;i++)out[i]=parseInt(s.substr(2*i,2),16)||0;
      return out
    }
    function hex(bytes){
      let s="";
      for(let i=0;i<bytes.length;i++)s+=(bytes[i]<256?(bytes[i]<16?"0":""):"")+bytes[i].toString(16);
      return s
    }
    function hmac(keyHex,text){
      const key=hexBytes(keyHex),block=new U8(64);
      block.set(key.length>64?sha256(key):key);
      const ipad=new U8(64),opad=new U8(64);
      for(let i=0;i<64;i++)ipad[i]=block[i]^0x36,opad[i]=block[i]^0x5c;
      const data=encode(String(text)),inner=new U8(64+data.length);
      inner.set(ipad),inner.set(data,64);
      const ih=sha256(inner),outer=new U8(96);
      outer.set(opad),outer.set(ih,64);
      return hex(sha256(outer))
    }
    /* Constant-time-enough equality for two short hex strings; a mismatch is not a secret. */
    function same(a,b){
      a=String(a||""),b=String(b||"");
      if(a.length!==b.length||!a.length)return!1;
      let diff=0;
      for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
      return 0===diff
    }
    return{hmac:hmac,same:same}
  })();
  const woVerify = (kind, payload, m) => {
    if (!woKey || !m) return false;
    const seq = Number(m.seq);
    if (!Number.isInteger(seq) || seq <= woLastSeq) return false;
    if (!__woAuth.same(m.mac, __woAuth.hmac(woKey, seq + '\n' + kind + '\n' + String(payload)))) return false;
    woLastSeq = seq;
    return true;
  };
  function cleanHost(value) {
    return String(value || '').trim().toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  }
  function hostAllowedByUser(cfg) {
    const host = cleanHost(location.hostname);
    const list = Array.isArray(cfg && cfg.allowlist) ? cfg.allowlist : [];
    return list.some((item) => {
      const d = cleanHost(item);
      return !!(d && (host === d || host.endsWith('.' + d)));
    });
  }

  /* ---- cosmetics ------------------------------------------------------------------------ */
  const style = document.createElement('style');
  style.id = 'wo-spotify-adblock-css';
  style.textContent = AD_ELEMENT_SELECTOR +
    '{display:none!important;visibility:hidden!important;pointer-events:none!important;}\n' +
    SLOT_ELEMENT_SELECTOR + '{visibility:hidden!important;}';
  function mountStyle() {
    if (disposed || !enabled || style.isConnected) return;
    try {
      const root = document.head || document.documentElement;
      if (root) root.appendChild(style);
    } catch (_) {}
  }

  /* ---- the state machine ---------------------------------------------------------------- */
  function requestUrl(input) {
    try {
      return typeof input === 'string' ? input : String(input && input.url || input || '');
    } catch (_) {
      return '';
    }
  }
  function isPlaybackRequest(input, stateOnly) {
    try {
      const url = new NativeURL(requestUrl(input), location.href);
      return url.protocol === 'https:' && /(^|\.)spotify\.com$/i.test(url.hostname) &&
        TRACK_PLAYBACK_RE.test(url.pathname) &&
        (!stateOnly || /^\/track-playback\/v1\/devices\/[^/]+\/state(_conflict)?\/?$/i.test(url.pathname));
    } catch (_) { return false; }
  }
  function isObject(value) {
    return value !== null && typeof value === 'object';
  }
  function trackValues(tracks) {
    if (Array.isArray(tracks)) return tracks;
    return isObject(tracks) ? Object.keys(tracks).map((key) => tracks[key]) : [];
  }
  function isAdTrack(track) {
    try {
      if (!isObject(track)) return false;
      if (track.content_type === 'AD') return true;
      return isObject(track.metadata) && AD_URI_RE.test(String(track.metadata.uri || ''));
    } catch (_) {
      return false;
    }
  }
  /* Every URL candidate of an ad track becomes the clip; file_id 1 is the value the player
     accepts for a URL it did not resolve itself. */
  function silenceAdTrack(track) {
    if (!isAdTrack(track)) return false;
    let changed = false;
    try {
      const manifest = track.manifest;
      if (!isObject(manifest)) return false;
      for (const key of Object.keys(manifest)) {
        if (!/^file_urls_/.test(key) || !Array.isArray(manifest[key])) continue;
        for (const candidate of manifest[key]) {
          if (!isObject(candidate)) continue;
          if (typeof candidate.file_url === 'string' && candidate.file_url !== SILENT_MEDIA) {
            knownAdUrls.add(candidate.file_url);
            if (knownAdUrls.size > 128) knownAdUrls.delete(knownAdUrls.values().next().value);
          }
          if (candidate.file_id !== 1) { candidate.file_id = 1; changed = true; }
          if (candidate.file_url !== SILENT_MEDIA) { candidate.file_url = SILENT_MEDIA; changed = true; }
        }
      }
    } catch (_) {}
    return changed;
  }
  /* The first shape: the ad sits on advance alone, and skip_next -- a state the server itself
     put in this machine, reached by the button beside the song -- leads to the next song.
     Advance is pointed there, so the song's natural end is reported as a skip taken at its
     last millisecond. Only advance is ever rewritten, only to this machine's own skip_next
     target, and only when that target is not an ad: updated_state_ref, the skip and show
     transitions and the states themselves are never touched. In the second shape skip_next
     is an ad too and nothing here changes; shortenAdState handles that ad instead. */
  function rerouteAdvance(machine) {
    let changed = false;
    try {
      const states = isObject(machine) && Array.isArray(machine.states) ? machine.states : [];
      const tracks = isObject(machine) ? machine.tracks : null;
      const targetIsAd = (target) => {
        if (!isObject(target) || !Number.isInteger(target.state_index)) return null;
        const state = states[target.state_index];
        if (!isObject(state)) return null;
        return isAdTrack(tracks && tracks[state.track]);
      };
      for (const state of states) {
        const transitions = isObject(state) && state.transitions;
        if (!isObject(transitions)) continue;
        if (targetIsAd(transitions.advance) !== true || targetIsAd(transitions.skip_next) !== false) continue;
        transitions.advance = { state_index: transitions.skip_next.state_index, paused: transitions.skip_next.paused === true };
        changed = true;
      }
    } catch (_) {}
    return changed;
  }
  /* Mark an ad state as already at its end, so the server treats it as played and advances
     out of it at once instead of holding the player there for the ad's duration. Combined
     with the silenced audio, the ad becomes an inaudible instant. */
  function shortenAdState(state, track) {
    if (!isObject(state)) return false;
    const duration = Number(track && track.metadata && track.metadata.duration) || 1;
    let changed = false;
    if (state.disallow_seeking !== false) { state.disallow_seeking = false; changed = true; }
    if (state.restrictions && Object.keys(state.restrictions).length) { state.restrictions = {}; changed = true; }
    if (state.initial_playback_position !== duration) { state.initial_playback_position = duration; changed = true; }
    if (state.position_offset !== duration) { state.position_offset = duration; changed = true; }
    return changed;
  }
  /* Everything done to a state machine before the player sees it, whichever request or
     command carried it: the ad audio silenced, every ad state marked already-complete, and a
     song's natural end pointed at the machine's own skip target where that skips the ad. The
     server's state is never touched -- only the response the player reads. */
  function prepareMachine(machine) {
    if (!isObject(machine)) return false;
    let changed = false;
    for (const track of trackValues(machine.tracks)) changed = silenceAdTrack(track) || changed;
    const states = Array.isArray(machine.states) ? machine.states : [];
    const tracks = machine.tracks;
    for (const state of states) {
      if (isObject(state) && isAdTrack(tracks && tracks[state.track])) changed = shortenAdState(state, tracks[state.track]) || changed;
    }
    changed = rerouteAdvance(machine) || changed;
    return changed;
  }
  /* A rejected-state answer carries replacement machines in its commands. */
  function prepareConflict(payload) {
    let changed = false;
    const commands = payload && payload.commands;
    const list = Array.isArray(commands) ? commands : isObject(commands) ? Object.keys(commands).map((k) => commands[k]) : [];
    for (const command of list) {
      if (isObject(command) && command.type === 'replace_state') changed = prepareMachine(command.state_machine) || changed;
    }
    return changed;
  }
  /* The server confirmation is the gate the player waits for before it will leave an ad. */
  function currentStateIsAd(payload) {
    try {
      const machine = payload && payload.state_machine;
      const ref = payload && payload.updated_state_ref;
      if (!isObject(machine) || !isObject(ref)) return false;
      const state = machine.states && machine.states[ref.state_index];
      return isAdTrack(state && machine.tracks && machine.tracks[state.track]);
    } catch (_) {
      return false;
    }
  }
  /* A request and its body can both finish after disable/repair; an old response must not act
     once protection is off. Epoch-guarded on both sides of the await. */
  function rewriteResponse(response, epoch, playback) {
    if (!enabled || disposed || epoch !== configEpoch || !response || typeof response.clone !== 'function') return Promise.resolve(response);
    /* The player waits on its state responses to confirm a pause, a skip, a track change, so
       whatever this does is on the latency path of every control. The overwhelming majority
       of those responses carry no ad at all; read the body as text (a decode, no parse) and,
       unless it actually names an ad, hand back the very Response the server sent -- no parse,
       no rewrite, no rebuilt Response. Only a response that mentions an ad pays the full cost. */
    return response.clone().text().then((text) => {
      if (!enabled || disposed || epoch !== configEpoch) return response;
      if (text.indexOf(':ad:') < 0 && text.indexOf('"AD"') < 0) return response;
      let payload;
      try { payload = JSON.parse(text); } catch (_) { return response; }
      if (!isObject(payload)) return response;
      let changed = prepareMachine(payload.state_machine);
      if (payload.commands) changed = prepareConflict(payload) || changed;
      /* Ignore a late response from a slot that normal media has already superseded. */
      if (playback === playbackEpoch && currentStateIsAd(payload)) adConfirmed();
      if (!changed) return response;
      const headers = new NativeHeaders(response.headers || undefined);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new NativeResponse(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers: headers });
    }).catch(() => response);
  }
  function spotifyFetch(input) {
    const promise = Reflect.apply(nativeFetch, this, arguments);
    if (!enabled || disposed || !isPlaybackRequest(input)) return promise;
    const epoch = configEpoch;
    const playback = playbackEpoch;
    return Promise.resolve(promise).then((response) => rewriteResponse(response, epoch, playback));
  }
  /* The player checks a candidate URL against a pattern before it will load it, and a data:
     URL would fail that check. Only the exact clip is ever answered for; every other test on
     the page is the native one. */
  function spotifyRegExpTest() {
    const args = Array.from(arguments);
    if (enabled && args[0] === SILENT_MEDIA) args[0] = 'https://';
    return Reflect.apply(nativeRegExpTest, this, args);
  }

  /* ---- the forced-ad slot and audio fail-safe ------------------------------------------- */
  function mediaSrc(media) {
    try { return String(media.src || media.currentSrc || ''); } catch (_) { return ''; }
  }
  function isClip(media) {
    return mediaSrc(media) === SILENT_MEDIA;
  }
  /* Shared /audio/ and /mp3/ CDNs also serve previews and normal music. Trust explicit ad
     metadata for those URLs; the host-only fallback is limited to dedicated ad media. */
  const AD_MEDIA_RE = /^https?:\/\/(?:[^/?#]*\.)?(?:(?:2mdn\.net|amillionads\.com|adxcel\.com|adstudio-assets\.scdn\.co)(?:[/?#]|$)|scdn\.co\/mp3-ad\/)/i;
  const mutedMedia = [];
  function restoreMuted() {
    for (const entry of mutedMedia.splice(0, mutedMedia.length)) {
      try { if (entry.media.muted === true) entry.media.muted = entry.was; } catch (_) {}
    }
  }
  let slot = null;
  function detachSlotElement(current) {
    try {
      if (current.element && current.onEnded) current.element.removeEventListener('ended', current.onEnded);
    } catch (_) {}
    current.onEnded = null;
  }
  function endSlot() {
    const current = slot;
    slot = null;
    if (!current) return;
    detachSlotElement(current);
    cancel(current.timeout);
    current.nudges.forEach(cancel);
    try { document.documentElement.removeAttribute(SLOT_ATTRIBUTE); } catch (_) {}
  }
  function beginSlot(element) {
    if (disposed || !enabled) return;
    if (!slot) {
      slot = { element: null, onEnded: null, confirmed: false, advanced: false, nudges: [], timeout: 0 };
      slot.timeout = later(endSlot, SLOT_TIMEOUT_MS);
      try { document.documentElement.setAttribute(SLOT_ATTRIBUTE, ''); } catch (_) {}
    }
    if (element && slot.element !== element) {
      detachSlotElement(slot);
      slot.element = element;
      slot.advanced = false;
      const current = slot;
      current.onEnded = (event) => {
        if (event.isTrusted === true && slot === current && current.confirmed) scheduleNudges(true);
      };
      try { element.addEventListener('ended', current.onEnded); } catch (_) {}
    }
  }
  function adConfirmed() {
    beginSlot(null);
    if (!slot) return;
    slot.confirmed = true;
    scheduleNudges(true);
  }
  function scheduleNudges(restart) {
    if (!slot) return;
    if (slot.nudges.length) {
      if (!restart) return;
      slot.nudges.splice(0, slot.nudges.length).forEach(cancel);
    }
    const current = slot;
    for (const ms of NUDGE_SCHEDULE) current.nudges.push(later(() => nudge(current), ms));
  }
  /* The signal is replayed only for our exact clip, after server confirmation, while it is
     genuinely ended and non-looping. It can therefore never end or seek a real song. */
  function nudge(current) {
    if (current !== slot || !current || !enabled || current.advanced) return;
    const media = current.element;
    if (!media) return;
    try {
      if (!isClip(media)) { current.advanced = true; return; }
      if (media.ended && !media.loop && !media.error) media.dispatchEvent(new NativeEvent('ended'));
    } catch (_) {}
  }
  /* An ad whose audio the rewrite did not reach plays muted. The state-machine rewrite is the
     real defence; this only spares the ears if a raw ad file is ever played directly. */
  function spotifyMediaPlay() {
    const result = Reflect.apply(nativeMediaPlay, this, arguments);
    if (!disposed && enabled) {
      try {
        const src = mediaSrc(this);
        if (isClip(this)) {
          beginSlot(this);
          if (slot && slot.confirmed) scheduleNudges(true);
        } else if (src && (knownAdUrls.has(src) || AD_MEDIA_RE.test(src))) {
          beginSlot(null);
          if (!mutedMedia.some((entry) => entry.media === this)) mutedMedia.push({ media: this, was: this.muted === true });
          this.muted = true;
        } else if (src) {
          if (slot || src !== lastNormalSrc) playbackEpoch++;
          lastNormalSrc = src;
          if (slot) slot.advanced = true;
          endSlot();
          restoreMuted();
        }
      } catch (_) {}
    }
    return result;
  }

  /* ---- injecting the ad rewriter into Spotify's worker ---------------------------------- */
  /* This function's SOURCE is what runs inside the worker (it is only ever stringified here,
     never called on the page). It installs, in the worker's own global scope and before the
     worker's real code loads, the same read-only rewrite the page does: an ad track's audio
     becomes the silent clip, a song's natural end is pointed past the ad at the machine's own
     skip target, and any ad state is marked already-complete. It hooks both the worker's
     WebSocket (where the dealer frames arrive) and its fetch. Then it loads the real worker. */
  function woWorkerShim(SILENT) {
    'use strict';
    try {
      var AD = /^spotify:ad:/i;
      function isObj(v) { return v !== null && typeof v === 'object'; }
      function isAd(t) { try { if (!isObj(t)) return false; if (t.content_type === 'AD') return true; return isObj(t.metadata) && AD.test(String(t.metadata.uri || '')); } catch (_) { return false; } }
      function tv(tr) { if (Array.isArray(tr)) return tr; return isObj(tr) ? Object.keys(tr).map(function (k) { return tr[k]; }) : []; }
      function silence(track) { if (!isAd(track)) return false; var ch = false; try { var m = track.manifest; if (!isObj(m)) return false; for (var k in m) { if (!/^file_urls_/.test(k) || !Array.isArray(m[k])) continue; for (var i = 0; i < m[k].length; i++) { var c = m[k][i]; if (!isObj(c)) continue; if (c.file_id !== 1) { c.file_id = 1; ch = true; } if (c.file_url !== SILENT) { c.file_url = SILENT; ch = true; } } } } catch (_) {} return ch; }
      function shorten(state, track) { if (!isObj(state)) return false; var d = Number(track && track.metadata && track.metadata.duration) || 1; var ch = false; if (state.disallow_seeking !== false) { state.disallow_seeking = false; ch = true; } if (state.restrictions && Object.keys(state.restrictions).length) { state.restrictions = {}; ch = true; } if (state.initial_playback_position !== d) { state.initial_playback_position = d; ch = true; } if (state.position_offset !== d) { state.position_offset = d; ch = true; } return ch; }
      function reroute(m) { var ch = false; try { var st = isObj(m) && Array.isArray(m.states) ? m.states : []; var tk = isObj(m) ? m.tracks : null; var ta = function (t) { if (!isObj(t) || !Number.isInteger(t.state_index)) return null; var stt = st[t.state_index]; if (!isObj(stt)) return null; return isAd(tk && tk[stt.track]); }; for (var i = 0; i < st.length; i++) { var tr = isObj(st[i]) && st[i].transitions; if (!isObj(tr)) continue; if (ta(tr.advance) !== true || ta(tr.skip_next) !== false) continue; tr.advance = { state_index: tr.skip_next.state_index, paused: tr.skip_next.paused === true }; ch = true; } } catch (_) {} return ch; }
      function prep(m) { if (!isObj(m)) return false; var ch = false; var a = tv(m.tracks); for (var i = 0; i < a.length; i++) ch = silence(a[i]) || ch; var st = Array.isArray(m.states) ? m.states : []; for (var j = 0; j < st.length; j++) { var stt = st[j]; if (isObj(stt) && isAd(m.tracks && m.tracks[stt.track])) ch = shorten(stt, m.tracks[stt.track]) || ch; } ch = reroute(m) || ch; return ch; }
      function rewrite(text) { try { if (typeof text !== 'string') return null; if (text.indexOf(':ad:') < 0 && text.indexOf('"AD"') < 0) return null; var d = JSON.parse(text); var ch = false; if (isObj(d)) { if (d.state_machine) ch = prep(d.state_machine) || ch; if (Array.isArray(d.payloads)) { for (var i = 0; i < d.payloads.length; i++) { var pl = d.payloads[i]; if (isObj(pl) && pl.state_machine) ch = prep(pl.state_machine) || ch; } } if (d.commands) { var cs = Array.isArray(d.commands) ? d.commands : Object.keys(d.commands).map(function (k) { return d.commands[k]; }); for (var c = 0; c < cs.length; c++) { if (isObj(cs[c]) && cs[c].state_machine) ch = prep(cs[c].state_machine) || ch; } } } return ch ? JSON.stringify(d) : null; } catch (_) { return null; } }
      self.__WO_REWRITE__ = rewrite;
      var WS = self.WebSocket;
      if (WS && WS.prototype) {
        var proto = WS.prototype;
        var wrap = function (fn) {
          return function (ev) {
            try { var t = rewrite(ev && ev.data); if (t !== null) { var ne = null; try { ne = new MessageEvent('message', { data: t, origin: ev.origin, lastEventId: ev.lastEventId }); } catch (_) { ne = null; } if (ne) return fn.call(this, ne); } } catch (_) {}
            return fn.call(this, ev);
          };
        };
        try { var oAdd = proto.addEventListener; proto.addEventListener = function (type, fn, opts) { if (type === 'message' && typeof fn === 'function') return oAdd.call(this, type, wrap(fn), opts); return oAdd.apply(this, arguments); }; } catch (_) {}
        try { var d0 = Object.getOwnPropertyDescriptor(proto, 'onmessage'); if (d0 && d0.set) { Object.defineProperty(proto, 'onmessage', { configurable: true, get: d0.get, set: function (fn) { d0.set.call(this, typeof fn === 'function' ? wrap(fn) : fn); } }); } } catch (_) {}
      }
      var of = self.fetch;
      if (typeof of === 'function' && typeof self.Response === 'function') {
        self.fetch = function (input, init) {
          var pr = of.apply(this, arguments);
          try {
            var u = typeof input === 'string' ? input : (input && input.url) || '';
            if (!/track-playback\/v1\/devices\/[^/]+\/state/i.test(u)) return pr;
            return Promise.resolve(pr).then(function (res) {
              if (!res || typeof res.clone !== 'function') return res;
              return res.clone().text().then(function (t) { var nt = rewrite(t); if (nt === null) return res; var h; try { h = new Headers(res.headers); h.delete('content-length'); h.delete('content-encoding'); } catch (_) { h = undefined; } try { return new Response(nt, { status: res.status, statusText: res.statusText, headers: h }); } catch (_) { return res; } }).catch(function () { return res; });
            });
          } catch (_) { return pr; }
        };
      }
    } catch (_) {}
  }
  function workerShimHead() { return '(' + woWorkerShim.toString() + ')(' + JSON.stringify(SILENT_MEDIA) + ');\n'; }
  /* Build the real worker behind a shim blob. The shim installs the hooks, then loads the
     original: importScripts for a classic worker, dynamic import() for a module worker (its
     relative imports resolve against the original URL, not the blob). Any failure -- a blob
     the shim cannot build, a URL it cannot resolve -- falls back to the native worker, so a
     worker WardenOne cannot wrap is never a worker it breaks. */
  function shimWorker(Ctor, url, opts) {
    try {
      if (typeof nativeCreateObjectURL !== 'function' || typeof NativeBlob !== 'function') return null;
      /* Only a same-origin http(s) script worker is safe to run through the shim: our shim
         loads the original with importScripts/import, and a cross-origin script without CORS
         (or an already-opaque blob:/data: worker) would fail to load and take playback with
         it. Anything else falls back to the native worker, untouched -- a worker WardenOne
         cannot wrap is never a worker it breaks. */
      var u = new NativeURL(String(url), location.href);
      if (!/^https?:$/.test(u.protocol) || u.origin !== location.origin) return null;
      var abs = u.href;
      var isModule = !!(opts && opts.type === 'module');
      var loader = isModule ? 'import(' + JSON.stringify(abs) + ').catch(function () {});' : 'try { importScripts(' + JSON.stringify(abs) + '); } catch (e) { throw e; }';
      var src = workerShimHead() + loader + '\n';
      var blobUrl = nativeCreateObjectURL(new NativeBlob([src], { type: 'text/javascript' }));
      var passOpts = null;
      if (opts && typeof opts === 'object') { passOpts = {}; for (var k in opts) if (k !== 'type') passOpts[k] = opts[k]; if (!Object.keys(passOpts).length) passOpts = null; }
      var worker = passOpts ? new Ctor(blobUrl, passOpts) : new Ctor(blobUrl);
      try { setTimeout(function () { try { nativeRevokeObjectURL(blobUrl); } catch (_) {} }, 60000); } catch (_) {}
      return worker;
    } catch (_) { return null; }
  }
  function installWorkerHook() {
    try {
      if (typeof NativeWorker === 'function') {
        var W = function (url, opts) {
          if (disposed || !enabled) return opts === undefined ? new NativeWorker(url) : new NativeWorker(url, opts);
          var w = shimWorker(NativeWorker, url, opts);
          return w || (opts === undefined ? new NativeWorker(url) : new NativeWorker(url, opts));
        };
        W.prototype = NativeWorker.prototype;
        try { window.Worker = W; } catch (_) {}
      }
    } catch (_) {}
    try {
      if (typeof NativeSharedWorker === 'function') {
        var S = function (url, opts) {
          if (disposed || !enabled) return opts === undefined ? new NativeSharedWorker(url) : new NativeSharedWorker(url, opts);
          var w = shimWorker(NativeSharedWorker, url, opts);
          return w || (opts === undefined ? new NativeSharedWorker(url) : new NativeSharedWorker(url, opts));
        };
        S.prototype = NativeSharedWorker.prototype;
        try { window.SharedWorker = S; } catch (_) {}
      }
    } catch (_) {}
  }

  /* ---- switches ------------------------------------------------------------------------- */
  function setEnabled(next) {
    const value = next !== false;
    if (enabled !== value) configEpoch++;
    enabled = value;
    style.disabled = !enabled;
    if (!enabled) { endSlot(); restoreMuted(); knownAdUrls.clear(); }
    else mountStyle();
  }
  function woDispose() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    configEpoch++;
    knownAdUrls.clear();
    endSlot();
    restoreMuted();
    for (const id of Array.from(timers)) cancel(id);
    for (const entry of listeners.splice(0, listeners.length)) {
      try { entry[0].removeEventListener(entry[1], entry[2], entry[3]); } catch (_) {}
    }
    try { if (style.parentNode) style.parentNode.removeChild(style); } catch (_) {}
    try { if (window.fetch === spotifyFetch) window.fetch = nativeFetch; } catch (_) {}
    try { if (window.Worker && window.Worker.prototype === NativeWorker.prototype && window.Worker !== NativeWorker) window.Worker = NativeWorker; } catch (_) {}
    try { if (NativeSharedWorker && window.SharedWorker && window.SharedWorker !== NativeSharedWorker && window.SharedWorker.prototype === NativeSharedWorker.prototype) window.SharedWorker = NativeSharedWorker; } catch (_) {}
    try { if (mediaPrototype && mediaPrototype.play === spotifyMediaPlay) mediaPrototype.play = nativeMediaPlay; } catch (_) {}
    try { if (RegExp.prototype.test === spotifyRegExpTest) RegExp.prototype.test = nativeRegExpTest; } catch (_) {}
    try { delete window.__wardenOneSpotifyAdblockReady; } catch (_) {}
  }

  window.fetch = spotifyFetch;
  RegExp.prototype.test = spotifyRegExpTest;
  installWorkerHook();
  if (typeof nativeMediaPlay === 'function' && typeof NativeEvent === 'function') {
    try { mediaPrototype.play = spotifyMediaPlay; } catch (_) {}
  }
  mountStyle();
  on(document, 'readystatechange', mountStyle);
  on(document, 'wo-key', (e) => {
    const d = e && e.detail;
    if (woKey || !d || typeof d.token !== 'string' || !d.token || typeof d.key !== 'string' || !d.key) return;
    woToken = d.token;
    woKey = d.key;
  });
  on(window, 'message', (event) => {
    if (event.source !== window) return;
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    if (m.source === 'wardenone' && m.kind === 'dispose' && woToken && m.token === woToken && woVerify('dispose', '', m)) {
      woDispose();
      return;
    }
    if (m.source === 'wardenone' && m.kind === 'config' && woToken && m.token === woToken
        && m.overrides && typeof m.overrides === 'object'
        && woVerify('config', JSON.stringify(m.overrides), m)) {
      const cfg = m.overrides;
      setEnabled(cfg.enabled !== false && cfg.adShield !== false && !hostAllowedByUser(cfg));
    }
  }, true);
  /* In case the bridge ran first and its key found no listener here: ask once, now that the
     listeners above exist. The bridge answers only while no page script can be running. */
  try { document.dispatchEvent(new CustomEvent('wo-bridge-replay')); } catch (_) {}
})();

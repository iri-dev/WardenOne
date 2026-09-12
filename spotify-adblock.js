/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Spotify Web Player ad blocker.
 *
 * How the web player takes an ad, measured on the live player: the server's playback state
 * machine makes the ad the only exit from the current song -- advance, skip-next and
 * skip-prev all point at it -- and the player will not move on until it has entered that
 * state and reported it finished. Routing around the state breaks the player: pointing the
 * song at a queue state empties the player, and pointing the confirmed ad straight at the
 * following song leaves a player that shows the song and can neither play nor skip it.
 *
 * So the slot is taken, and made as short and as invisible as the protocol allows.
 *   1. Inside the state machine response the ad's audio is swapped for a 132 ms silent clip,
 *      so nothing audible ever loads. (The player validates the URL with a regular
 *      expression, hence the narrow RegExp.prototype.test shim below.)
 *   2. The clip has ended before the server confirms the ad as current, and the player does
 *      not act on an ending that came early. The moment the confirming response is in, this
 *      module re-dispatches "ended" on the clip's element until the player moves to the next
 *      song -- tens of milliseconds, where a timer-driven retry took over a second.
 *   3. From the clip loading until the next song's media starts, the now-playing bar is
 *      blanked and every ad element Spotify renders (countdown, companion card, the
 *      "Advertisement" label) is hidden, so the slot shows as a short gap between songs.
 * Only a track whose own metadata says it is an ad is touched; ordinary tracks, episodes and
 * podcast media are never classified by host or duration. Songs travel as encrypted MP4 over
 * fetch and a MediaSource on a detached VIDEO element -- which is also why the old fail-safe
 * that searched the document for audio elements could never find the player.
 */
(function wardenOneSpotifyAdblock() {
  'use strict';

  const VERSION = '1.0.1';
  if (!/^open\.spotify\.com$/i.test(String(location.hostname || ''))) return;
  if (window.__wardenOneSpotifyAdblockReady) return;
  window.__wardenOneSpotifyAdblockReady = VERSION;

  /* uBlock Origin's noop-0.1s.mp3 (CREDITS.md): a genuine 132 ms MPEG audio clip, so the
     player gets a real load, a real duration and a real ended event. */
  const SILENT_MEDIA = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjQwLjEwMQAAAAAAAAAAAAAA//tUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAADAABgYGBgYGBgYGBgYGBgYGBggICAgICAgICAgICAgICAgICgoKCgoKCgoKCgoKCgoKCgwMDAwMDAwMDAwMDAwMDAwMDg4ODg4ODg4ODg4ODg4ODg4P////////////////////8AAAAATGF2YzU2LjYwAAAAAAAAAAAAAAAAJAAAAAAAAAAAAwDNZKlY//sUZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sUZB4P8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sUZDwP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sUZFoP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sUZHgP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sUZJYP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
  const TRACK_PLAYBACK_RE = /^\/track-playback\//i;
  const AD_URI_RE = /^spotify:ad:/i;
  /* Rendered by the player only while an ad is current (element ids read off the live
     player). Hidden outright, whether or not this module knows a slot is on. */
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
  /* Blanked only for the length of a slot: the parts of the now-playing bar that would
     otherwise show the ad's title, artwork and the 0:00 / 0:00 progress of the clip. */
  const SLOT_ELEMENT_SELECTOR = [
    '[data-testid="now-playing-widget"]',
    '[data-testid="playback-progressbar"]',
    '[data-testid="playback-position"]',
    '[data-testid="playback-duration"]',
    '[data-testid="video-card-image"]',
    '#Desktop_PanelContainer_Id',
  ].map((s) => 'html[data-wo-spotify-ad] ' + s +
    ',html:has([data-testid="now-playing-bar"] [data-testid="ad-controls"]) ' + s).join(',');
  /* The :has branch applies in the first style calculation of an ad render, even before
     play() or a confirming fetch has reached us. No DOM polling or paint-delay timer. */
  const SLOT_ATTRIBUTE = 'data-wo-spotify-ad';
  /* When to re-dispatch "ended" after the confirming response, in ms; stops early the
     moment the element has moved on. */
  const NUDGE_SCHEDULE = [50, 200, 400, 700, 1100, 1600, 2200];
  const SLOT_TIMEOUT_MS = 8000;

  const nativeFetch = window.fetch;
  const nativeRegExpTest = RegExp.prototype.test;
  const NativeHeaders = window.Headers;
  const NativeResponse = window.Response;
  const NativeEvent = window.Event;
  const NativeURL = window.URL;
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
  function isPlaybackRequest(input) {
    try {
      const url = new NativeURL(requestUrl(input), location.href);
      return url.protocol === 'https:' && /(^|\.)spotify\.com$/i.test(url.hostname) &&
        TRACK_PLAYBACK_RE.test(url.pathname);
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
  /* Is the state the server says is current an ad? That response is the one the player
     waits for before it will leave the slot. */
  function currentStateIsAd(payload) {
    try {
      const machine = payload && payload.state_machine;
      const ref = payload && payload.updated_state_ref;
      if (!isObject(machine) || !isObject(ref)) return false;
      const state = machine.states && machine.states[ref.state_index];
      const track = state && machine.tracks && machine.tracks[state.track];
      return isAdTrack(track);
    } catch (_) {
      return false;
    }
  }
  function rewriteTrackPlayback(payload) {
    try {
      const machine = payload && payload.state_machine;
      let changed = false;
      for (const track of trackValues(machine && machine.tracks)) changed = silenceAdTrack(track) || changed;
      return changed;
    } catch (_) {
      return false;
    }
  }
  /* A request and its body can both finish after disable/repair. An old response must not
     re-arm the slot, even when protection was switched back on in the meantime. */
  async function rewriteResponse(response, epoch, playback) {
    if (!enabled || disposed || epoch !== configEpoch || !response || typeof response.clone !== 'function') return response;
    try {
      const payload = await response.clone().json();
      if (!enabled || disposed || epoch !== configEpoch) return response;
      const changed = rewriteTrackPlayback(payload);
      /* A response for the previous slot must not blank a song that has already started. */
      if (playback === playbackEpoch && currentStateIsAd(payload)) adConfirmed();
      if (!changed) return response;
      const headers = new NativeHeaders(response.headers || undefined);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new NativeResponse(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    } catch (_) {
      return response;
    }
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
  function spotifyRegExpTest(value) {
    const args = Array.from(arguments);
    if (enabled && args[0] === SILENT_MEDIA) args[0] = 'https://';
    return Reflect.apply(nativeRegExpTest, this, args);
  }

  /* ---- the slot ------------------------------------------------------------------------- */
  let slot = null;

  function mediaSrc(media) {
    /* currentSrc can still name the finished ad after src has been set to the next song. */
    try { return String(media.src || media.currentSrc || ''); } catch (_) { return ''; }
  }
  function isClip(media) {
    return mediaSrc(media) === SILENT_MEDIA;
  }
  /* Shared /audio/ and /mp3/ CDNs can also serve previews and normal music. Trust explicit
     ad metadata for those URLs; the host-only fallback is limited to dedicated ad media. */
  const AD_MEDIA_RE = /^https?:\/\/(?:[^/?#]*\.)?(?:(?:2mdn\.net|amillionads\.com|adxcel\.com|adstudio-assets\.scdn\.co)(?:[/?#]|$)|scdn\.co\/mp3-ad\/)/i;
  /* Ad media the rewrite did not reach plays muted until something that is not an ad plays;
     independent of the slot, whose blanking has a time limit and a real ad does not. */
  const mutedMedia = [];
  function restoreMuted() {
    for (const entry of mutedMedia.splice(0, mutedMedia.length)) {
      try { if (entry.media.muted === true) entry.media.muted = entry.was; } catch (_) {}
    }
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
        /* A slowly loaded clip can finish after the initial retries were exhausted.
           Synthetic retries must never recursively schedule themselves. */
        if (event.isTrusted === true && slot === current && current.confirmed) scheduleNudges(true);
      };
      try { element.addEventListener('ended', current.onEnded); } catch (_) {}
    }
  }
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
  /* The confirming response is in. Re-dispatch the clip's ended event on the schedule until
     the element has moved on to the next song -- and never after anything else has played,
     so a stale element cannot end a real track. */
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
  function nudge(current) {
    if (current !== slot || !current || !enabled || current.advanced) return;
    const media = current.element;
    if (!media) return;
    try {
      if (!isClip(media)) { current.advanced = true; return; }
      if (media.ended && !media.loop && !media.error) media.dispatchEvent(new NativeEvent('ended'));
    } catch (_) {}
  }
  function spotifyMediaPlay() {
    const result = Reflect.apply(nativeMediaPlay, this, arguments);
    if (!disposed && enabled) {
      try {
        const src = mediaSrc(this);
        if (isClip(this)) {
          beginSlot(this);
          /* The confirming response may already be in (a slot the player resumed into):
             the nudges belong to this element now. */
          if (slot && slot.confirmed) scheduleNudges(true);
        } else if (knownAdUrls.has(src) || AD_MEDIA_RE.test(src)) {
          /* An ad whose URL the rewrite did not reach. Silent at least, and the bar stays
             blank for as long as the slot's time limit allows. */
          beginSlot(null);
          if (!mutedMedia.some((entry) => entry.media === this)) mutedMedia.push({ media: this, was: this.muted === true });
          this.muted = true;
        } else if (src) {
          /* The next song (a MediaSource on the same detached element, or a fresh one), or an
             episode: whatever the slot was, it is over. */
          if (slot || src !== lastNormalSrc) playbackEpoch++;
          lastNormalSrc = src;
          if (slot) slot.advanced = true;
          endSlot();
          restoreMuted();
        }
      } catch (_) {}
    }
    /* The native play promise, rejection and autoplay semantics included. */
    return result;
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
    try { if (mediaPrototype && mediaPrototype.play === spotifyMediaPlay) mediaPrototype.play = nativeMediaPlay; } catch (_) {}
    try { if (RegExp.prototype.test === spotifyRegExpTest) RegExp.prototype.test = nativeRegExpTest; } catch (_) {}
    try { delete window.__wardenOneSpotifyAdblockReady; } catch (_) {}
  }

  window.fetch = spotifyFetch;
  RegExp.prototype.test = spotifyRegExpTest;
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

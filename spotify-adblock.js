/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Spotify Web Player ad blocker.
 *
 * The state machine Spotify sends is server-authoritative. Repointing one of its transitions
 * or changing an ad state's position can look seamless for a few skips, but eventually the
 * server and player disagree and the web player falls into an empty Advertisement state that
 * only a reload repairs. WardenOne therefore leaves every state, transition, reference and
 * playback position exactly as Spotify sent it.
 *
 * Three layers, all on the reader's side of the wire, in the order they get their chance:
 *
 * 1. The player's own loader. Spotify's player resolves every track into a content object
 *    whose `_uri` is the track's Spotify URI and whose `_url` (or, for a manifest-delivered
 *    ad, `_playableContentSorted[].url`) is the media it will hand the media element. Right
 *    before the loader's completion callback runs, an object whose URI is `spotify:ad:` has
 *    that URL replaced by a one-second silent clip. Nothing about the ad is fetched; the clip
 *    plays out, ends on its own, and the player moves on exactly as it would after a real ad.
 *    This is the AdGuard Base technique for open.spotify.com, and it does not care which host
 *    Spotify serves the ad from.
 * 2. The network. A declarativeNetRequest ruleset redirects media requests to the known ad
 *    hosts (uBlock Origin's open.spotify.com list) to the same packaged clip, and lets media
 *    through on the web player where a tracker list would otherwise cut a podcast off.
 * 3. This module's fallback for an ad that reached the media element unchanged: recognized
 *    from Spotify's own state machine, muted before play(), then sought near its end once
 *    Spotify confirms it is current. Short replacement media is never sought; seeking it
 *    can race Spotify's transition.
 *
 * Playback responses and media URLs are observed, never edited. Ordinary tracks, episodes
 * and podcast media keep their files. The ad chrome Spotify renders is hidden by stylesheet.
 * No request is made on the account's behalf. Songs travel as encrypted MP4 over fetch and
 * a MediaSource on a detached VIDEO element, which is why a document query cannot find the
 * real player.
 */
(function wardenOneSpotifyAdblock() {
  'use strict';

  const VERSION = '1.0.1';
  if (!/^open\.spotify\.com$/i.test(String(location.hostname || ''))) return;
  if (window.__wardenOneSpotifyAdblockReady) return;
  window.__wardenOneSpotifyAdblockReady = VERSION;

  const TRACK_PLAYBACK_RE = /^\/track-playback\//i;
  const AUDIO_LICENSE_PATH = '/widevine-license/v1/audio/license';
  const AUDIO_LICENSE_429_HOLD_MS = 10000;
  const AD_URI_RE = /^spotify:ad:/i;
  /* The one-second silent MP4 the network layer serves (spotify-silent-1s.mp4, uBlock
     Origin's noop-1s.mp4), inlined so the player can be handed it as a plain URL with no
     extension id in it. tools/test-spotify-adblock.js holds this to the packaged bytes. */
  const SILENT_CLIP = 'data:video/mp4;base64,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';
  /* The player's loader finishes every track through one Promise callback whose source names
     this method; it is the only place the resolved content object passes by before the media
     element sees its URL. */
  const PLAYER_LOADER_MARK = '_getCacheKey';
  /* Rendered by the player only while an ad is current (element ids read off the live
     player). Hidden outright whenever an ad is current. */
  const AD_ELEMENT_SELECTOR = [
    '#leaderboard-ad-element',
    'a[data-context-item-type="ad"]',
    'a[href^="https://adclick.g.doubleclick.net/"]',
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
  /* Blank the now-playing surfaces from the instant the muted ad loads until normal media
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
  const SLOT_TIMEOUT_MS = 5000;
  const AD_SEEK_MARGIN = 0.7;

  const nativeFetch = window.fetch;
  const NativeURL = window.URL;
  const NativeWorker = window.Worker;
  const NativeSharedWorker = window.SharedWorker;
  const NativeBlob = window.Blob;
  const nativeCreateObjectURL = window.URL && window.URL.createObjectURL;
  const nativeRevokeObjectURL = window.URL && window.URL.revokeObjectURL;
  const mediaPrototype = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  const nativeMediaPlay = mediaPrototype && mediaPrototype.play;
  const promisePrototype = typeof Promise === 'function' ? Promise.prototype : null;
  const nativePromiseThen = promisePrototype && promisePrototype.then;
  const nativeFunctionToString = Function.prototype.toString;
  const NativeWeakMap = typeof WeakMap === 'function' ? WeakMap : null;
  const WORKER_AD_NOTICE = '__wo_spotify_ad_urls_1__';
  const WORKER_AD_CURRENT_NOTICE = '__wo_spotify_ad_current_1__';

  let enabled = true;
  let disposed = false;
  let configEpoch = 0;
  let normalMediaEpoch = 0;
  const listeners = [];
  const timers = new Set();
  const knownAdUrls = new Set();
  const confirmedAdUrls = new Set();
  const pendingLicenseHolds = new Set();

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
  function isAudioLicenseRequest(input, init) {
    try {
      const url = new NativeURL(requestUrl(input), location.href);
      const method = String(init && init.method || input && input.method || 'GET').toUpperCase();
      return method === 'POST' && url.protocol === 'https:' &&
        /(^|\.)spotify\.com$/i.test(url.hostname) && url.pathname === AUDIO_LICENSE_PATH;
    } catch (_) { return false; }
  }
  /* A rejected license makes Spotify auto-advance through otherwise playable songs, which
     produces still more license requests. Briefly hold only the original 429 Response so
     Spotify can settle; never retry a DRM challenge or change a successful response. A
     manual skip that aborts the request releases it immediately. */
  function holdRejectedLicense(response, input, init) {
    return new Promise((resolve) => {
      let timer = 0;
      let signal = null;
      let released = false;
      try { signal = init && init.signal || input && input.signal || null; } catch (_) {}
      const release = () => {
        if (released) return;
        released = true;
        pendingLicenseHolds.delete(release);
        if (timer) clearTimeout(timer);
        try { if (signal) signal.removeEventListener('abort', release); } catch (_) {}
        resolve(response);
      };
      try {
        if (signal && signal.aborted) return release();
        pendingLicenseHolds.add(release);
        if (signal) signal.addEventListener('abort', release, { once: true });
        timer = setTimeout(release, AUDIO_LICENSE_429_HOLD_MS);
      } catch (_) { release(); }
    });
  }
  function releaseLicenseHolds() {
    for (const release of Array.from(pendingLicenseHolds)) release();
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
  /* Learn only candidates Spotify labels as ad media. The response itself remains untouched. */
  function adUrls(track) {
    const urls = [];
    if (!isAdTrack(track)) return urls;
    try {
      const manifest = track.manifest;
      if (!isObject(manifest)) return urls;
      for (const key of Object.keys(manifest)) {
        if (!/^file_urls_/.test(key) || !Array.isArray(manifest[key])) continue;
        for (const candidate of manifest[key]) {
          if (!isObject(candidate)) continue;
          const url = candidate.file_url;
          if (typeof url !== 'string' || url.length > 4096 || !/^https?:\/\//i.test(url)) continue;
          urls.push(url);
        }
      }
    } catch (_) {}
    return urls;
  }
  function rememberAdTrack(track) {
    for (const url of adUrls(track)) {
      knownAdUrls.add(url);
      if (knownAdUrls.size > 128) knownAdUrls.delete(knownAdUrls.values().next().value);
    }
  }
  function confirmCurrentAd(urls) {
    confirmedAdUrls.clear();
    for (const url of urls) confirmedAdUrls.add(url);
    if (slot) {
      slot.confirmed = confirmedAdUrls.has(slot.src);
      if (slot.confirmed) scheduleSeek(slot);
    }
  }
  function observeCurrentState(payload) {
    try {
      const machine = payload.state_machine;
      const ref = payload.updated_state_ref;
      if (!isObject(machine) || !isObject(ref) || !Array.isArray(machine.states)) return;
      const state = machine.states[ref.state_index];
      if (!isObject(state)) return;
      confirmCurrentAd(adUrls(machine.tracks && machine.tracks[state.track]));
    } catch (_) {}
  }
  function rememberMachine(machine) {
    if (!isObject(machine)) return;
    for (const track of trackValues(machine.tracks)) rememberAdTrack(track);
  }
  function rememberPayload(payload, allowCurrent) {
    if (!isObject(payload)) return;
    rememberMachine(payload.state_machine);
    if (allowCurrent) observeCurrentState(payload);
    const commands = payload && payload.commands;
    const list = Array.isArray(commands) ? commands : isObject(commands) ? Object.keys(commands).map((k) => commands[k]) : [];
    for (const command of list) if (isObject(command)) {
      rememberMachine(command.state_machine);
      if (allowCurrent) observeCurrentState(command);
    }
  }
  /* A request and its body can both finish after disable/repair; an old response must not act
     once protection is off. Epoch-guarded on both sides of the await. */
  function observeResponse(response, epoch, mediaEpoch) {
    if (!enabled || disposed || epoch !== configEpoch || !response || typeof response.clone !== 'function') return Promise.resolve(response);
    /* The player waits on its state responses to confirm a pause, a skip, a track change, so
       whatever this does is on the latency path of every control. The overwhelming majority
       of those responses carry no ad at all; read the body as text (a decode, no parse) and,
       unless it actually names an ad, hand back the very Response the server sent. */
    return response.clone().text().then((text) => {
      if (!enabled || disposed || epoch !== configEpoch) return response;
      if (text.indexOf(':ad:') < 0 && text.indexOf('"AD"') < 0 && !confirmedAdUrls.size) return response;
      let payload;
      try { payload = JSON.parse(text); } catch (_) { return response; }
      /* A response requested before the next song started may arrive afterward. It can still
         reveal ad URLs, but it must not re-arm a finished ad as the current one. */
      rememberPayload(payload, mediaEpoch === normalMediaEpoch);
      return response;
    }).catch(() => response);
  }
  function spotifyFetch(input) {
    const promise = Reflect.apply(nativeFetch, this, arguments);
    if (!enabled || disposed) return promise;
    if (isAudioLicenseRequest(input, arguments[1])) {
      const epoch = configEpoch;
      const init = arguments[1];
      return Promise.resolve(promise).then((response) =>
        enabled && !disposed && epoch === configEpoch && response && response.status === 429
          ? holdRejectedLicense(response, input, init) : response);
    }
    if (!isPlaybackRequest(input)) return promise;
    const epoch = configEpoch;
    const mediaEpoch = normalMediaEpoch;
    return Promise.resolve(promise).then((response) => observeResponse(response, epoch, mediaEpoch));
  }

  /* ---- the ad slot and media clock ------------------------------------------------------- */
  function mediaSrc(media) {
    try { return String(media.src || media.currentSrc || ''); } catch (_) { return ''; }
  }
  /* Shared /audio/ and /mp3/ CDNs also serve previews and normal music. Trust explicit ad
     metadata for those URLs; the host-only fallback is limited to dedicated ad media. */
  const AD_MEDIA_RE = /^https?:\/\/(?:[^/?#]*\.)?(?:(?:2mdn\.net|amillionads\.com|adxcel\.com|adstudio-assets\.scdn\.co)(?:[/?#]|$)|scdn\.co\/mp3-ad\/)/i;
  const mutedMedia = [];
  function restoreMuted(activeMedia) {
    const keep = [];
    for (const entry of mutedMedia.splice(0, mutedMedia.length)) {
      try {
        if (activeMedia && entry.media !== activeMedia && !entry.media.paused && !entry.media.ended) {
          keep.push(entry);
        } else if (entry.media.muted === true) {
          entry.media.muted = entry.was;
        }
      } catch (_) {}
    }
    mutedMedia.push(...keep);
  }
  let slot = null;
  function endSlot() {
    const current = slot;
    slot = null;
    if (!current) return;
    try {
      current.element.removeEventListener('loadedmetadata', current.onMetadata);
      current.element.removeEventListener('durationchange', current.onMetadata);
    } catch (_) {}
    cancel(current.timeout);
    current.seekTimers.forEach(cancel);
    try { document.documentElement.removeAttribute(SLOT_ATTRIBUTE); } catch (_) {}
  }
  /* A candidate in a song's future graph is not permission to finish the ad now. Only the
     server's current-ad state may arm one native seek; repeated seeks can advance real songs. */
  function seekAdTail(current) {
    if (current !== slot || !enabled || disposed || !current.confirmed || current.seeked) return;
    const media = current.element;
    try {
      if (mediaSrc(media) !== current.src || media.readyState < 1) return;
      const duration = Number(media.duration);
      if (!Number.isFinite(duration) || duration < 3) return;
      const target = Math.max(0, duration - AD_SEEK_MARGIN);
      if (media.currentTime >= target - 0.2) return;
      current.seeked = true;
      try { media.currentTime = target; } catch (_) { current.seeked = false; }
    } catch (_) {}
  }
  function scheduleSeek(current) {
    if (!current.confirmed || current.seeked || current.seekTimers.length) return;
    for (const delay of [120, 350, 800, 1500]) {
      current.seekTimers.push(later(() => seekAdTail(current), delay));
    }
  }
  function beginSlot(media, src) {
    if (disposed || !enabled) return;
    if (slot && slot.element === media && slot.src === src) return;
    endSlot();
    const current = { element: media, src: src, confirmed: confirmedAdUrls.has(src), seeked: false, onMetadata: null, seekTimers: [], timeout: 0 };
    slot = current;
    current.onMetadata = () => { seekAdTail(current); scheduleSeek(current); };
    try {
      media.addEventListener('loadedmetadata', current.onMetadata);
      media.addEventListener('durationchange', current.onMetadata);
      document.documentElement.setAttribute(SLOT_ATTRIBUTE, '');
    } catch (_) {}
    current.timeout = later(endSlot, SLOT_TIMEOUT_MS);
    if (media.readyState >= 1) scheduleSeek(current);
  }
  function spotifyMediaPlay() {
    if (!disposed && enabled) {
      try {
        const src = mediaSrc(this);
        if (src === SILENT_CLIP) {
          /* The loader was handed the clip in place of an ad: nothing to mute, nothing to
             seek (it is a second long and ends on its own), only the now-playing surfaces to
             keep blank until the next real track starts. */
          beginSlot(this, src);
        } else if (src && (knownAdUrls.has(src) || AD_MEDIA_RE.test(src))) {
          if (!mutedMedia.some((entry) => entry.media === this)) {
            mutedMedia.push({ media: this, was: this.muted === true });
          }
          this.muted = true;
          beginSlot(this, src);
        } else if (src) {
          normalMediaEpoch++;
          confirmedAdUrls.clear();
          endSlot();
          restoreMuted(this);
        }
      } catch (_) {}
    }
    return Reflect.apply(nativeMediaPlay, this, arguments);
  }

  /* ---- the player's loader --------------------------------------------------------------- */
  /* Spotify's player finishes loading every track through `promise.then(o => {...})`, where
     `o` is the content object about to be handed to the media element and the callback's
     source names `_getCacheKey`. Promise.prototype.then is replaced by a function that
     recognizes that one callback by its source and, before it runs, swaps the URL of any
     content whose URI Spotify itself marks as an ad. Every other `.then` is the native call
     with the same arguments. The recognition is cached per callback function, and the
     source text is read through the Function.prototype.toString captured at load, so a page
     that later redefines it cannot hide the loader. */
  const loaderCallbacks = typeof NativeWeakMap === 'function' ? new NativeWeakMap() : null;
  function isPlayerLoader(fn) {
    if (typeof fn !== 'function') return false;
    let known = loaderCallbacks ? loaderCallbacks.get(fn) : undefined;
    if (known === undefined) {
      try { known = nativeFunctionToString.call(fn).indexOf(PLAYER_LOADER_MARK) >= 0; } catch (_) { known = false; }
      if (loaderCallbacks) { try { loaderCallbacks.set(fn, known); } catch (_) {} }
    }
    return known;
  }
  /* Only Spotify's own label counts: a content object whose `_uri` is `spotify:ad:`. Its
     direct URL (`_url`, a file_urls_mp3 ad or a storage-resolved file_ids_mp3 ad) and the
     candidates of a manifest-delivered ad (`_playableContentSorted[].url`, plus the choice
     already made in `_adURL`) all become the silent clip. Songs, episodes and podcasts carry
     other URIs and are never looked at further. */
  function silenceAdContent(content) {
    if (!enabled || disposed) return false;
    try {
      if (!isObject(content) || typeof content._uri !== 'string' || !AD_URI_RE.test(content._uri)) return false;
      let swapped = false;
      if (typeof content._url === 'string' && content._url && content._url !== SILENT_CLIP) {
        content._url = SILENT_CLIP;
        swapped = true;
      }
      if (Array.isArray(content._playableContentSorted)) {
        for (const candidate of content._playableContentSorted) {
          if (isObject(candidate) && typeof candidate.url === 'string' && candidate.url && candidate.url !== SILENT_CLIP) {
            candidate.url = SILENT_CLIP;
            swapped = true;
          }
        }
      }
      if (typeof content._adURL === 'string' && content._adURL && content._adURL !== SILENT_CLIP) {
        content._adURL = SILENT_CLIP;
        swapped = true;
      }
      return swapped;
    } catch (_) {
      return false;
    }
  }
  function wrapPlayerLoader(fn) {
    return function woSpotifyLoader(content) {
      silenceAdContent(content);
      return Reflect.apply(fn, this, arguments);
    };
  }
  function spotifyPromiseThen(onFulfilled, onRejected) {
    if (!disposed && enabled && isPlayerLoader(onFulfilled)) {
      return Reflect.apply(nativePromiseThen, this, [wrapPlayerLoader(onFulfilled), onRejected]);
    }
    return Reflect.apply(nativePromiseThen, this, arguments);
  }
  function installLoaderHook() {
    if (typeof nativePromiseThen !== 'function' || !promisePrototype) return;
    try { promisePrototype.then = spotifyPromiseThen; } catch (_) {}
  }

  /* ---- observing ad media URLs in Spotify's worker -------------------------------------- */
  /* This function's SOURCE runs inside a same-origin Spotify worker before the real code. It
     only observes ad media URLs; original responses and dealer frames reach Spotify intact. */
  function woWorkerShim(NOTICE, CURRENT) {
    'use strict';
    try {
      var AD = /^spotify:ad:/i;
      function isObj(v) { return v !== null && typeof v === 'object'; }
      function isAd(t) { try { return isObj(t) && (t.content_type === 'AD' || isObj(t.metadata) && AD.test(String(t.metadata.uri || ''))); } catch (_) { return false; } }
      function tracks(v) { return Array.isArray(v) ? v : isObj(v) ? Object.keys(v).map(function (k) { return v[k]; }) : []; }
      var noticePorts = [];
      function collectTrack(t, urls) {
        var m = t && t.manifest;
        if (!isAd(t) || !isObj(m)) return;
        for (var k in m) {
          if (!/^file_urls_/.test(k) || !Array.isArray(m[k])) continue;
          for (var j = 0; j < m[k].length; j++) {
            var u = m[k][j] && m[k][j].file_url;
            if (typeof u === 'string' && u.length <= 4096 && /^https?:\/\//i.test(u)) urls.push(u);
          }
        }
      }
      function collect(machine, urls) {
        if (!isObj(machine)) return;
        var ts = tracks(machine.tracks);
        for (var i = 0; i < ts.length; i++) collectTrack(ts[i], urls);
      }
      function observe(text) {
        try {
          if (typeof text !== 'string' || text.indexOf(':ad:') < 0 && text.indexOf('"AD"') < 0) return;
          var data = JSON.parse(text), urls = [], current = [];
          function payload(p) {
            if (!isObj(p)) return;
            collect(p.state_machine, urls);
            var m = p.state_machine, ref = p.updated_state_ref;
            if (isObj(m) && Array.isArray(m.states) && isObj(ref)) {
              var state = m.states[ref.state_index];
              if (isObj(state)) collectTrack(m.tracks && m.tracks[state.track], current);
            }
            var cs = p.commands;
            if (Array.isArray(cs)) for (var i = 0; i < cs.length; i++) payload(cs[i]);
            else if (isObj(cs)) for (var k in cs) payload(cs[k]);
          }
          payload(data);
          if (Array.isArray(data.payloads)) for (var i = 0; i < data.payloads.length; i++) payload(data.payloads[i]);
          if (!urls.length && !current.length) return;
          var message = {}; message[NOTICE] = urls;
          if (current.length) message[CURRENT] = current;
          if (typeof self.postMessage === 'function') self.postMessage(message);
          else for (var n = 0; n < noticePorts.length; n++) noticePorts[n].postMessage(message);
        } catch (_) {}
      }
      self.__WO_OBSERVE__ = observe;
      try {
        if (typeof self.postMessage !== 'function' && typeof self.addEventListener === 'function') {
          self.addEventListener('connect', function (ev) { var port = ev && ev.ports && ev.ports[0]; if (port) noticePorts.push(port); });
        }
      } catch (_) {}
      var WS = self.WebSocket;
      if (WS && WS.prototype) {
        var proto = WS.prototype;
        var wrap = function (fn) { return function (ev) { try { observe(ev && ev.data); } catch (_) {} return fn.call(this, ev); }; };
        try {
          var oAdd = proto.addEventListener;
          proto.addEventListener = function (type, fn, opts) {
            if (type === 'message' && typeof fn === 'function') return oAdd.call(this, type, wrap(fn), opts);
            return oAdd.apply(this, arguments);
          };
        } catch (_) {}
        try {
          var desc = Object.getOwnPropertyDescriptor(proto, 'onmessage');
          if (desc && desc.set) Object.defineProperty(proto, 'onmessage', {
            configurable: true, get: desc.get,
            set: function (fn) { desc.set.call(this, typeof fn === 'function' ? wrap(fn) : fn); }
          });
        } catch (_) {}
      }
      var nativeFetch = self.fetch;
      if (typeof nativeFetch === 'function') {
        self.fetch = function (input) {
          var promise = nativeFetch.apply(this, arguments);
          try {
            var url = typeof input === 'string' ? input : input && input.url || '';
            if (!/track-playback\/v1\/devices\/[^/]+\/state/i.test(url)) return promise;
            return Promise.resolve(promise).then(function (response) {
              if (!response || typeof response.clone !== 'function') return response;
              return response.clone().text().then(function (body) { observe(body); return response; }).catch(function () { return response; });
            });
          } catch (_) { return promise; }
        };
      }
    } catch (_) {}
  }
  function workerShimHead() { return '(' + woWorkerShim.toString() + ')(' + JSON.stringify(WORKER_AD_NOTICE) + ',' + JSON.stringify(WORKER_AD_CURRENT_NOTICE) + ');\n'; }
  function attachWorkerNotice(worker) {
    try {
      const target = worker && (worker.port || worker);
      if (!target || typeof target.addEventListener !== 'function') return worker;
      target.addEventListener('message', (event) => {
        const data = event && event.data;
        if (!isObject(data) || !Array.isArray(data[WORKER_AD_NOTICE])) return;
        try { if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation(); } catch (_) {}
        if (!enabled || disposed) return;
        for (const url of data[WORKER_AD_NOTICE]) {
          if (typeof url !== 'string' || url.length > 4096 || !/^https?:\/\//i.test(url)) continue;
          knownAdUrls.add(url);
          if (knownAdUrls.size > 128) knownAdUrls.delete(knownAdUrls.values().next().value);
        }
        if (slot && Array.isArray(data[WORKER_AD_CURRENT_NOTICE])) {
          const urls = data[WORKER_AD_CURRENT_NOTICE].filter((url) => typeof url === 'string' && url.length <= 4096 && /^https?:\/\//i.test(url));
          if (urls.includes(slot.src)) confirmCurrentAd(urls);
        }
      });
    } catch (_) {}
    return worker;
  }
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
          return w ? attachWorkerNotice(w) : (opts === undefined ? new NativeWorker(url) : new NativeWorker(url, opts));
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
          return w ? attachWorkerNotice(w) : (opts === undefined ? new NativeSharedWorker(url) : new NativeSharedWorker(url, opts));
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
    if (!enabled) { releaseLicenseHolds(); endSlot(); restoreMuted(); knownAdUrls.clear(); confirmedAdUrls.clear(); }
    else mountStyle();
  }
  function woDispose() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    configEpoch++;
    releaseLicenseHolds();
    knownAdUrls.clear();
    confirmedAdUrls.clear();
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
    try { if (promisePrototype && promisePrototype.then === spotifyPromiseThen) promisePrototype.then = nativePromiseThen; } catch (_) {}
    try { delete window.__wardenOneSpotifyAdblockReady; } catch (_) {}
  }

  window.fetch = spotifyFetch;
  installWorkerHook();
  installLoaderHook();
  if (typeof nativeMediaPlay === 'function') {
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

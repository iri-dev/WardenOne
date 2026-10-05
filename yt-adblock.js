/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* WardenOne YouTube module
 *
 * Rebuilt from the active AdGuard YouTube filter rules in:
 *   Extension/filters/chromium/filter_2.txt, lines 37700-37732
 *
 * This file intentionally avoids WardenOne's older YouTube heuristics. The
 * behavior here is a compact, readable port of AdGuard's current YouTube rules:
 * JSON pruning for ad schedule fields, anti-abnormality defusing, native
 * fetch/Request iframe workaround, SSAP timeout/segment handling, and AdGuard's
 * bounded player-request recovery modes.
 */
(function () {
  "use strict";

  var YT_MODULE_VERSION = "1.0.2";
  if (window.__wardenOneYouTubeReadyVersion === YT_MODULE_VERSION) return;
  window.__wardenOneYouTubeVersion = YT_MODULE_VERSION;

  var realFetch = self.fetch;
  var realParse = JSON.parse;
  var realStringify = JSON.stringify;
  var woConfigToken = null;
  var woMasterEnabled = true;
  var cosmeticStyle = null;
  var installSsapPushCapture = function () {};
  var restoreSsapPushCapture = function () {};

  /* AdShield reports the ad breaks it strips to the Site Dashboard's count, signed like every
     other page-world report so a page cannot inflate it: the bridge hands over its key at
     document_start, before any page script can run, and only the HMAC pads are kept. */
  const __woAuth=(function(){
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const U8=Uint8Array,U32=Uint32Array,D="0123456789abcdef";
    /* This code runs in the page's own world, where the page can replace any built-in method after
       load. So nothing that touches the key calls one. The key becomes its two HMAC pad blocks ONCE,
       in key(), at the document_start hand-off before any page script exists; after that a
       signature is index reads and arithmetic on typed arrays -- no .set, .subarray, .length,
       substr, parseInt or toString -- each of which a page could replace to be handed the key: a
       patched String.prototype.substr, Uint8Array.prototype.set or typed-array length getter each
       recovered the whole key from one signature (tools/test-main-world-key-isolation.js). The
       message text is not secret; a page that tampers with how it is read only spoils its own
       signature, which it could already do by stopping the event. */
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
      return{b:out,n:n}
    }
    const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
    function sha256(msg,len){
      const total=((len+9+63)>>6)<<6,padded=new U8(total);
      for(let i=0;i<len;i++)padded[i]=msg[i];
      padded[len]=0x80;
      const bits=len*8;
      padded[total-4]=(bits>>>24)&255,padded[total-3]=(bits>>>16)&255,padded[total-2]=(bits>>>8)&255,padded[total-1]=bits&255;
      const h=new U32(8),w=new U32(64);
      h[0]=0x6a09e667,h[1]=0xbb67ae85,h[2]=0x3c6ef372,h[3]=0xa54ff53a,h[4]=0x510e527f,h[5]=0x9b05688c,h[6]=0x1f83d9ab,h[7]=0x5be0cd19;
      for(let off=0;off<total;off+=64){
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
    function hex(bytes){
      let s="";
      for(let i=0;i<32;i++)s+=D[bytes[i]>>4]+D[bytes[i]&15];
      return s
    }
    /* The key's two pad blocks, made once. Call it only where the page cannot have run yet (the
       wo-key hand-off at document_start) or cannot reach (the bridge's own world). */
    function key(keyHex){
      const s=String(keyHex||""),n=s.length>>1,raw=new U8(n);
      for(let i=0;i<n;i++)raw[i]=parseInt(s.substr(2*i,2),16)||0;
      const k=n>64?sha256(raw,n):raw,kl=n>64?32:n,ipad=new U8(64),opad=new U8(64);
      for(let i=0;i<64;i++){
        const b=i<kl?k[i]:0;
        ipad[i]=b^0x36,opad[i]=b^0x5c
      }
      return{i:ipad,o:opad}
    }
    function hmac(k,text){
      const pads="string"==typeof k?key(k):k,e=encode(text),n=e.n,data=e.b,inner=new U8(64+n),outer=new U8(96);
      for(let i=0;i<64;i++)inner[i]=pads.i[i],outer[i]=pads.o[i];
      for(let i=0;i<n;i++)inner[64+i]=data[i];
      const ih=sha256(inner,64+n);
      for(let i=0;i<32;i++)outer[64+i]=ih[i];
      return hex(sha256(outer,96))
    }
    /* Constant-time-enough equality for two short hex strings; a mismatch is not a secret. */
    function same(a,b){
      a=String(a||""),b=String(b||"");
      if(a.length!==b.length||!a.length)return!1;
      let diff=0;
      for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
      return 0===diff
    }
    /* A signed event's text: who sent it, its number, its type and a canonical form of its detail
       -- keys sorted, every value typed, every string length-prefixed -- so the page's world and
       the bridge's, which each hold their own copy of the detail, compute the same text from it. */
    function canon(v,depth){
      if(void 0===v)return"u";
      if(null===v)return"n";
      const t=typeof v;
      if("string"===t)return"s"+v.length+":"+v;
      if("number"===t)return"d"+String(v);
      if("boolean"===t)return v?"T":"F";
      if("object"!==t||depth>8)return"x";
      let s;
      if(Array.isArray(v)){
        s="[";
        for(let i=0;i<v.length&&i<256;i++)s+=canon(v[i],depth+1)+",";
        return s+"]"
      }
      const keys=Object.keys(v).sort();
      s="{";
      for(let i=0;i<keys.length&&i<256;i++)s+=keys[i].length+":"+keys[i]+"="+canon(v[keys[i]],depth+1)+",";
      return s+"}"
    }
    function eventText(src,seq,type,detail){
      return"event\n"+String(src)+"\n"+String(seq)+"\n"+String(type)+"\n"+canon(detail,0)
    }
    return{hmac:hmac,same:same,key:key,canon:canon,eventText:eventText}
  })();
  var woKey = null;
  var woToken = "";
  var adshieldEventSeq = 0;
  var adsCountedByVideo = Object.create(null);
  try {
    document.addEventListener("wo-key", function (e) {
      var d = e && e.detail;
      if (woKey || !d || typeof d.token !== "string" || !d.token || typeof d.key !== "string" || !d.key) return;
      woToken = d.token;
      woKey = __woAuth.key(d.key);
    });
  } catch (_) {}

  /* One count per video: the same player response can pass through JSON.parse and the fetch
     path both, so a video only ever adds what it has not already reported. */
  function noteAdsRemoved(count, videoId) {
    if (!count || !woKey || !woToken) return;
    var key = videoId || ("page:" + String(location.pathname || ""));
    var prior = adsCountedByVideo[key] || 0;
    if (count <= prior) return;
    adsCountedByVideo[key] = count;
    var detail = { count: count - prior };
    adshieldEventSeq += 1;
    try {
      document.dispatchEvent(new CustomEvent("wo-event", { detail: {
        token: woToken, type: "youtube_ads_removed", detail: detail, at: Date.now(),
        src: "adshield", eseq: adshieldEventSeq,
        emac: __woAuth.hmac(woKey, __woAuth.eventText("adshield", adshieldEventSeq, "youtube_ads_removed", detail))
      } }));
    } catch (_) {}
  }

  /* The ad breaks a player response schedules: each adPlacements entry is one break (pre-roll,
     a mid-roll, a post-roll); playerAds or adSlots without placements count as one. */
  function countPlayerAds(obj) {
    var n = 0;
    var add = function (pr) {
      if (!pr || typeof pr !== "object") return;
      if (Array.isArray(pr.adPlacements) && pr.adPlacements.length) n += pr.adPlacements.length;
      else if (pr.playerAds || pr.adSlots) n += 1;
    };
    add(obj);
    add(obj && obj.playerResponse);
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) add(obj[i] && obj[i].playerResponse);
    }
    return n;
  }

  function masterEnabled() {
    return woMasterEnabled !== false;
  }

  function setMasterEnabled(value) {
    woMasterEnabled = value !== false;
    if (!masterEnabled()) {
      restoreSsapPushCapture();
      restoreVisibility();
      removeCosmetics();
    } else {
      applyCosmetics();
      installSsapPushCapture();
    }
  }

  try {
    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      var message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.source === "wardenone-handshake" && typeof message.token === "string" && woConfigToken === null) {
        woConfigToken = message.token;
        return;
      }
      if (message.source !== "wardenone" || message.kind !== "config" || !message.overrides) return;
      if (woConfigToken === null || message.token !== woConfigToken) return;
      setMasterEnabled(message.overrides.enabled !== false);
    });
  } catch (_) {}

  var host = "";
  try { host = String(location.hostname || "").replace(/^www\./, "").toLowerCase(); } catch (_) {}
  // `host` has already had a leading `www.` removed. Keep the desktop request
  // recovery modes off m.youtube.com, which has its own lighter-weight body
  // stamping path below and is not compatible with desktop client params.
  var isDesktopWatch = host === "youtube.com";
  var isMobileWatch = host === "m.youtube.com";

  var PLAYER_RESPONSE_RE = /playlist\?list=|\/player(?!.*get_drm_license)|player\?|watch\?[tv]=|get_watch\?|get_video_info/i;
  var PLAYER_REQUEST_RE = /\/youtubei\/v1\/player(?:[?/]|$)|\/player\?/i;
  var INITPLAYBACK_RE = /googlevideo\.com\/initplayback\?[^#]*source=youtube(?=[^#]*\bc=TVHTML5\b)(?=[^#]*\boad\b)/i;

  var MODE_PYV = "pyv";
  var MODE_PARAM_FIRST = "param_first";
  var MODE_PARAM_SECOND = "param_second";
  var MODE_CLIENT_SCREEN = "client_screen";
  var MODE_AD_TYPE = "ad_type";
  var MODE_NONE = "none";
  var modes = [MODE_PARAM_FIRST, MODE_PARAM_SECOND, MODE_PYV, MODE_CLIENT_SCREEN, MODE_AD_TYPE, MODE_NONE];
  var mode = MODE_PARAM_FIRST;
  var modeVideoId = "";
  var failedModes = {};
  var visibilityDescriptor = null;

  try {
    if (typeof Document !== "undefined") {
      visibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    }
  } catch (_) {}

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function safeString(value) {
    try { return realStringify(value); } catch (_) { return ""; }
  }

  function currentUrl() {
    try { return String(location.href || ""); } catch (_) { return ""; }
  }

  function playerShapingAllowed() {
    var href = currentUrl();
    return isDesktopWatch &&
      href.indexOf("/shorts/") === -1 &&
      href.indexOf("youtube.com/tv") === -1 &&
      href.indexOf("youtube.com/embed/") === -1;
  }

  function resetModeForVideo(videoId) {
    if (!videoId || videoId === modeVideoId) return;
    modeVideoId = videoId;
    mode = MODE_PARAM_FIRST;
    failedModes = {};
  }

  function advanceMode(videoId, reason) {
    if (videoId) resetModeForVideo(videoId);
    var key = (modeVideoId || "") + "|" + mode + "|" + (reason || "");
    if (failedModes[key]) return false;
    failedModes[key] = true;
    var idx = modes.indexOf(mode);
    if (idx < 0 || idx >= modes.length - 1) {
      mode = MODE_NONE;
      return false;
    }
    mode = modes[idx + 1];
    return mode !== MODE_NONE;
  }

  function forceVisible() {
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: function () { return "visible"; },
      });
    } catch (_) {}
  }

  function restoreVisibility() {
    try {
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
    } catch (_) {}
  }

  function playbackContexts(body) {
    var out = [];
    if (body && body.playbackContext) out.push(body.playbackContext);
    if (body && body.playerRequest && body.playerRequest.playbackContext) {
      out.push(body.playerRequest.playbackContext);
    }
    return out;
  }

  function ensureContentPlayback(ctx) {
    ctx.contentPlaybackContext = ctx.contentPlaybackContext || {};
    return ctx.contentPlaybackContext;
  }

  function setParams(body, params) {
    body.params = params;
    if (body.playerRequest && body.playerRequest.params !== params) body.playerRequest.params = params;
    if (body.playbackContext && body.playbackContext.params !== params) body.playbackContext.params = params;
  }

  function stripAppInstallData(body) {
    try {
      if ((body.playbackContext || body.playerRequest) &&
          body.context && body.context.client && body.context.client.configInfo) {
        delete body.context.client.configInfo.appInstallData;
      }
    } catch (_) {}
  }

  function currentPlayerStatus() {
    try {
      var mp = document.getElementById("movie_player");
      var pr = mp && mp.getPlayerResponse && mp.getPlayerResponse();
      return pr && pr.playabilityStatus && pr.playabilityStatus.status;
    } catch (_) {
      return "";
    }
  }

  function applyAdGuardMode(body, forcedMode) {
    try {
      if (!playerShapingAllowed() || !isObject(body) || Array.isArray(body)) return false;
      if (!body.context || !body.context.client) return false;
      resetModeForVideo(body.videoId);

      var activeMode = forcedMode || mode;
      var status = currentPlayerStatus();
      if (status === "LOGIN_REQUIRED" || status === "CONTENT_CHECK_REQUIRED") activeMode = MODE_NONE;

      var client = body.context.client;
      var contexts = playbackContexts(body);
      if (!contexts.length) return false;
      var stamp = String(Date.now());
      var changed = false;
      var i;

      function touch() {
        for (i = 0; i < contexts.length; i++) {
          ensureContentPlayback(contexts[i]).lactMilliseconds = stamp;
        }
        stripAppInstallData(body);
        changed = true;
      }

      if (activeMode === MODE_PARAM_FIRST) {
        if (client.clientScreen === "CHANNEL" || String(body.params || "").indexOf("YAHI") === 0) return false;
        setParams(body, "eAFgAQ");
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_PARAM_SECOND) {
        if (client.clientScreen === "CHANNEL" || String(body.params || "").indexOf("YAHI") === 0) return false;
        setParams(body, "8AUB");
        if (!body.playlistId) client.clientScreen = "CHANNEL";
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_PYV) {
        for (i = 0; i < contexts.length; i++) contexts[i].adPlaybackContext = { pyv: true };
        touch();
        return changed;
      }

      if (activeMode === MODE_CLIENT_SCREEN) {
        if (client.clientName === "WEB") client.clientScreen = "CHANNEL";
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_AD_TYPE) {
        for (i = 0; i < contexts.length; i++) contexts[i].adPlaybackContext = { adType: "AD_TYPE_INSTREAM" };
        touch();
        forceVisible();
        return changed;
      }

      if (activeMode === MODE_NONE) {
        for (i = 0; i < contexts.length; i++) delete contexts[i].adPlaybackContext;
        restoreVisibility();
      }
    } catch (_) {}
    return false;
  }

  function shapeOutboundText(text) {
    try {
      if (!playerShapingAllowed()) return null;
      if (typeof text !== "string") return null;
      if (text.indexOf("\"contentPlaybackContext\"") === -1 && text.indexOf("\"adSignalsInfo\"") === -1) return null;
      var body = realParse(text);
      if (!body || !body.context || !body.context.client) return null;
      return applyAdGuardMode(body) ? realStringify(body) : null;
    } catch (_) {
      return null;
    }
  }

  function stampMobileBody(body) {
    try {
      if (!isMobileWatch || !isObject(body) || !body.context || !body.context.client) return false;
      if (currentUrl().indexOf("/shorts/") !== -1 ||
          currentUrl().indexOf("youtube.com/tv") !== -1 ||
          currentUrl().indexOf("youtube.com/embed/") !== -1) return false;
      var contexts = playbackContexts(body);
      var stamp = String(Date.now());
      var changed = false;
      for (var i = 0; i < contexts.length; i++) {
        if (contexts[i].adPlaybackContext === undefined) {
          ensureContentPlayback(contexts[i]).lactMilliseconds = stamp;
          changed = true;
        }
      }
      return changed;
    } catch (_) {
      return false;
    }
  }

  function walkDelete(root, parts, index) {
    if (!isObject(root)) return;
    var part = parts[index];
    if (part === "[]") {
      if (Array.isArray(root)) {
        for (var i = 0; i < root.length; i++) walkDelete(root[i], parts, index + 1);
      }
      return;
    }
    if (part === "[-]") {
      if (!Array.isArray(root)) return;
      var rest = parts.slice(index + 1);
      for (var j = root.length - 1; j >= 0; j--) {
        if (resolvePath(root[j], rest, 0)) root.splice(j, 1);
      }
      return;
    }
    if (index === parts.length - 1) {
      if (own(root, part)) delete root[part];
      return;
    }
    walkDelete(root[part], parts, index + 1);
  }

  function resolvePath(root, parts, index) {
    if (!isObject(root)) return false;
    var value = root[parts[index]];
    if (index === parts.length - 1) return value !== undefined && value !== null && value !== false;
    return resolvePath(value, parts, index + 1);
  }

  var PRUNE_PATHS = [
    "playerResponse.adPlacements",
    "playerResponse.playerAds",
    "playerResponse.adSlots",
    "[].playerResponse.adPlacements",
    "[].playerResponse.playerAds",
    "[].playerResponse.adSlots",
    "adPlacements",
    "playerAds",
    "adSlots",
    "entries.[-].command.reelWatchEndpoint.adClientParams.isAd",
    "playerResponse.messages.[].youThereRenderer",
  ];

  function fixPlayerObject(obj) {
    if (!isObject(obj)) return;
    try {
      if (obj.responseContext || obj.playabilityStatus) {
        delete obj.adSlots;
        delete obj.playerAds;
        delete obj.adPlacements;
      }
      var audio = obj.playerConfig && obj.playerConfig.audioConfig;
      var shouldFixMute = audio && audio.muteOnStart &&
        (currentUrl().indexOf("/watch") !== -1 || (obj.cards && !(obj.playabilityStatus && obj.playabilityStatus.miniplayer)));
      if (shouldFixMute) {
        delete audio.muteOnStart;
        if (obj.messages && obj.messages[0]) delete obj.messages[0].youThereRenderer;
      }
      if (mode === MODE_AD_TYPE &&
          obj.playerConfig &&
          obj.playerConfig.granularVariableSpeedConfig) {
        obj.playerConfig.granularVariableSpeedConfig.maximumPlaybackRate = 200;
        obj.playerConfig.granularVariableSpeedConfig.minimumPlaybackRate = 25;
      }
      if (obj.auxiliaryUi && obj.auxiliaryUi.messageRenderers) {
        delete obj.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel;
      }
    } catch (_) {}
  }

  function pruneAdGuard(obj) {
    if (!isObject(obj)) return obj;
    var adCount = 0;
    var videoId = "";
    try {
      adCount = countPlayerAds(obj);
      videoId = responseVideoId(obj) || (Array.isArray(obj) && obj[0] ? responseVideoId(obj[0]) : "");
    } catch (_) {}
    try {
      for (var i = 0; i < PRUNE_PATHS.length; i++) walkDelete(obj, PRUNE_PATHS[i].split("."), 0);
      fixPlayerObject(obj);
      fixPlayerObject(obj.playerResponse);
      if (Array.isArray(obj)) {
        for (var j = 0; j < obj.length; j++) {
          fixPlayerObject(obj[j] && obj[j].playerResponse);
        }
      }
    } catch (_) {}
    if (adCount) noteAdsRemoved(adCount, videoId);
    return obj;
  }

  function mightContainPlayerAds(obj) {
    if (!isObject(obj)) return false;
    return !!(
      obj.responseContext || obj.playabilityStatus || obj.playerResponse ||
      obj.adPlacements || obj.playerAds || obj.adSlots || obj.entries
    );
  }

  function responseVideoId(obj) {
    try {
      return (obj && obj.videoDetails && obj.videoDetails.videoId) ||
        (obj && obj.playerResponse && obj.playerResponse.videoDetails && obj.playerResponse.videoDetails.videoId) ||
        "";
    } catch (_) {
      return "";
    }
  }

  function responseLooksRecoverableError(obj, source, reviver) {
    try {
      // Escapes and revivers can create marker text absent from the source.
      if (typeof source === "string" && typeof reviver !== "function" &&
          source.indexOf("\\u") === -1 &&
          source.indexOf("playerErrorMessageRenderer") === -1 &&
          source.indexOf("UNPLAYABLE") === -1) return false;
      var text = safeString(obj);
      if (text.indexOf("CONTENT_CHECK_REQUIRED") !== -1) return false;
      return text.indexOf("playerErrorMessageRenderer") !== -1 || text.indexOf("UNPLAYABLE") !== -1;
    } catch (_) {
      return false;
    }
  }

  function rotateFromResponse(obj, source, reviver) {
    if (!playerShapingAllowed() || mode === MODE_NONE) return;
    if (responseLooksRecoverableError(obj, source, reviver)) advanceMode(responseVideoId(obj), "parse");
  }

  function definePlain(name, value) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: value,
      });
    } catch (_) {}
  }

  function trapInitial(name) {
    try {
      var existing = window[name];
      if (existing !== undefined) {
        definePlain(name, pruneAdGuard(existing));
        return;
      }
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return undefined; },
        set: function (value) { definePlain(name, pruneAdGuard(value)); },
      });
    } catch (_) {}
  }

  trapInitial("ytInitialPlayerResponse");
  trapInitial("ytInitialData");

  function urlFromInput(input) {
    try {
      return typeof input === "string" ? input : (input && input.url) || String(input || "");
    } catch (_) {
      return "";
    }
  }

  function isInitPlayback(url) {
    return INITPLAYBACK_RE.test(String(url || ""));
  }

  function shouldPruneUrl(url) {
    return PLAYER_RESPONSE_RE.test(String(url || ""));
  }

  function responseFromText(text, resp) {
    return new Response(text, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
  }

  self.fetch = new Proxy(realFetch, {
    get: function (target, prop, receiver) {
      if (prop === "name") return "fetch";
      if (prop === "length") return 1;
      return Reflect.get(target, prop, receiver);
    },
    apply: function (target, thisArg, args) {
      if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
      var url = urlFromInput(args && args[0]);
      try {
        if (isInitPlayback(url)) {
          return Promise.resolve(new Response("", { status: 204, statusText: "No Content" }));
        }
        if (url && PLAYER_REQUEST_RE.test(url) && args[1] && typeof args[1].body === "string") {
          var shaped = shapeOutboundText(args[1].body);
          if (shaped !== null) {
            args = args.slice();
            args[1] = Object.assign({}, args[1], { body: shaped });
          }
        }
      } catch (_) {}

      var promise = Reflect.apply(target, thisArg, args);
      if (!url || !shouldPruneUrl(url)) return promise;
      return promise.then(function (resp) {
        try {
          if (!resp || typeof resp.clone !== "function") return resp;
          return resp.clone().text().then(function (text) {
            try {
              var obj = realParse(text);
              pruneAdGuard(obj);
              return responseFromText(realStringify(obj), resp);
            } catch (_) {
              return resp;
            }
          }, function () { return resp; });
        } catch (_) {
          return resp;
        }
      });
    },
  });

  try {
    var xhrUrls = new WeakMap();
    var realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = new Proxy(realOpen, {
      apply: function (target, thisArg, args) {
        try { xhrUrls.set(thisArg, String(args && args[1] || "")); } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    var realSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = new Proxy(realSend, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var url = xhrUrls.get(thisArg) || "";
          if (isInitPlayback(url)) return undefined;
          var body = args && args[0];
          if (url && PLAYER_REQUEST_RE.test(url)) {
            var text = Array.isArray(body) ? body[0] : body;
            var shaped = shapeOutboundText(text);
            if (shaped !== null) {
              args = args.slice();
              if (Array.isArray(body)) args[0][0] = shaped;
              else args[0] = shaped;
            }
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
  } catch (_) {}

  try {
    if (typeof Request === "function") {
      var realRequest = Request;
      Request = new Proxy(realRequest, {
        construct: function (target, args, newTarget) {
          if (!masterEnabled()) return Reflect.construct(target, args, newTarget);
          try {
            var input = args && args[0];
            var init = args && args[1];
            var url = urlFromInput(input);
            var body = init && init.body;
            if (url && PLAYER_REQUEST_RE.test(url) && typeof body === "string") {
              var shaped = shapeOutboundText(body);
              if (shaped !== null) {
                args = args.slice();
                args[1] = Object.assign({}, init, { body: shaped });
              }
            }
          } catch (_) {}
          return Reflect.construct(target, args, newTarget);
        },
      });
    }
  } catch (_) {}

  try {
    if (typeof TextEncoder !== "undefined" && TextEncoder.prototype && TextEncoder.prototype.encode) {
      var realEncode = TextEncoder.prototype.encode;
      TextEncoder.prototype.encode = new Proxy(realEncode, {
        apply: function (target, thisArg, args) {
          if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
          try {
            var shaped = shapeOutboundText(args && args[0]);
            if (shaped !== null) {
              args = args.slice();
              args[0] = shaped;
            }
          } catch (_) {}
          return Reflect.apply(target, thisArg, args);
        },
      });
    }
  } catch (_) {}

  JSON.stringify = new Proxy(realStringify, {
    apply: function (target, thisArg, args) {
      if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
      try {
        var value = args && args[0];
        if (isObject(value)) {
          if (applyAdGuardMode(value) || stampMobileBody(value)) {
            args = args.slice();
            args[0] = value;
          }
        }
      } catch (_) {}
      return Reflect.apply(target, thisArg, args);
    },
  });

  JSON.parse = new Proxy(realParse, {
    apply: function (target, thisArg, args) {
      var obj = Reflect.apply(target, thisArg, args);
      try {
        if (masterEnabled()) {
          if (mightContainPlayerAds(obj)) pruneAdGuard(obj);
          rotateFromResponse(obj, args && args[0], args && args[1]);
        }
      } catch (_) {}
      return obj;
    },
  });

  try {
    var realThen = Promise.prototype.then;
    Promise.prototype.then = new Proxy(realThen, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var cb = args && args[0];
          if (typeof cb === "function") {
            var source = String(cb);
            if (source.indexOf("onAbnormalityDetected") !== -1) {
              args = args.slice();
              args[0] = function () {};
            } else if (source.indexOf(".next(") !== -1) {
              args = args.slice();
              args[0] = new Proxy(cb, {
                apply: function (innerTarget, innerThis, innerArgs) {
                  try {
                    var first = innerArgs && innerArgs[0];
                    if (masterEnabled() && first && typeof first.value === "string" && first.value.indexOf("playerResponse") !== -1) {
                      first.value = first.value
                        .replace(/"muteOnStart":true/g, "\"muteOnStart\":false")
                        .replace(/"youThereRenderer":/g, "\"no_youThereRenderer\":")
                        .replace(/"(adSlots|playerAds)":/g, "\"no_ads\":");
                    }
                  } catch (_) {}
                  return Reflect.apply(innerTarget, innerThis, innerArgs);
                },
              });
            } else if (source.indexOf("jspbResponseCtor") !== -1) {
              args = args.slice();
              args[0] = new Proxy(cb, {
                apply: function (innerTarget, innerThis, innerArgs) {
                  var result = Reflect.apply(innerTarget, innerThis, innerArgs);
                  try { if (masterEnabled()) pruneAdGuard(result); } catch (_) {}
                  return result;
                },
              });
            }
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
  } catch (_) {}

  try {
    if (typeof Node !== "undefined" && typeof HTMLIFrameElement !== "undefined") {
      var realAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = new Proxy(realAppendChild, {
        apply: function (target, thisArg, args) {
          var out = Reflect.apply(target, thisArg, args);
          try {
            if (masterEnabled() && out instanceof HTMLIFrameElement && out.src === "about:blank") {
              /* A frame sandboxed WITHOUT allow-scripts still gets our fetch when
                 it keeps allow-same-origin. It cannot run code, so no content
                 script can patch it from inside -- which is exactly why a page
                 would borrow a clean fetch from one -- and only this write, from
                 the parent, reaches it. YouTube makes one of these on every watch
                 page. Only a frame with an opaque origin (a sandbox without
                 allow-same-origin) is skipped: the parent cannot reach into it,
                 and the write would only throw.

                 This write is NOT what Chrome reports as "Blocked script
                 execution in 'about:blank' because the document's frame is
                 sandboxed". Measured in Edge 150: the same write with WardenOne
                 off logs nothing. The warning is Chrome declining to inject
                 WardenOne's MAIN-world scripts (blank-frame coverage, SEC-05)
                 into a frame that forbids scripts -- one per script file -- and
                 it is filed under WardenOne because a WardenOne insertion wrapper
                 is on the stack when the page inserts the frame. */
              var sandboxAttr = null;
              /* Only skip on positive evidence of a sandbox. If the attribute
                 cannot be read at all, assume the frame is ordinary and hook it
                 -- failing the other way would silently stop hooking every
                 about:blank frame, which is the thing this proxy exists for. */
              try { sandboxAttr = out.getAttribute ? out.getAttribute("sandbox") : null; } catch (_) { sandboxAttr = null; }
              var opaqueOrigin = typeof sandboxAttr === "string" && !/(^|\s)allow-same-origin(\s|$)/.test(sandboxAttr);
              if (!opaqueOrigin && out.contentWindow) {
                out.contentWindow.fetch = self.fetch;
                out.contentWindow.Request = Request;
              }
            }
          } catch (_) {}
          return out;
        },
      });
    }
  } catch (_) {}

  try {
    var realTimeout = window.setTimeout || setTimeout;
    var timeoutProxy = new Proxy(realTimeout, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var cb = args && args[0];
          var delay = Number(args && args[1]);
          if (delay === 5000 && String(cb).indexOf("(),a,b)") !== -1) {
            return 0;
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    window.setTimeout = timeoutProxy;
    try { setTimeout = timeoutProxy; } catch (_) {}
  } catch (_) {}

  try {
    var pageUrl = document.location && document.location.href;
    var ssapSegments = [];
    var ssapIds = [];
    var ssapArmed = false;
    var lastJumpKey = "";
    var realPush = Array.prototype.push;
    var ssapPushProxy = new Proxy(realPush, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var item = args && args[0];
          var flag = window.yt && window.yt.config_ && window.yt.config_.EXPERIMENT_FLAGS &&
            window.yt.config_.EXPERIMENT_FLAGS.html5_enable_ssap_entity_id;
          if (flag && item && item !== window && typeof item.start === "number" &&
              item.end && item.namespace === "ssap" && item.id) {
            if (!ssapArmed || item.start !== 0 || ssapIds.indexOf(item.id) === -1) {
              if (!ssapArmed || item.start === 0) {
                ssapSegments.length = 0;
                ssapIds.length = 0;
                ssapArmed = true;
              }
              realPush.call(ssapSegments, item);
              realPush.call(ssapIds, item.id);
            }
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    var ssapPushRestoreTimer = 0;
    restoreSsapPushCapture = function () {
      if (ssapPushRestoreTimer) {
        try { clearTimeout(ssapPushRestoreTimer); } catch (_) {}
        ssapPushRestoreTimer = 0;
      }
      // Do not overwrite a newer page patch installed after ours.
      if (Array.prototype.push === ssapPushProxy) Array.prototype.push = realPush;
    };
    installSsapPushCapture = function () {
      if (!masterEnabled()) return;
      // Array#push is one of the hottest methods on any page, and routing every
      // call on YouTube through a Proxy costs 15.6ns -> 41.5ns each, measured.
      // The capture can only ever collect something while this experiment flag
      // is on, so when the page config has already loaded and says it is off,
      // installing would slow down every push on the page for ten seconds to
      // collect nothing. Before the config arrives we genuinely cannot tell, and
      // catching the early pushes is the whole point, so that case is unchanged
      // -- this only skips the installs we can prove are pointless, which
      // includes every yt-navigate-start within a mix, where config is loaded.
      var ssapFlags = window.yt && window.yt.config_ && window.yt.config_.EXPERIMENT_FLAGS;
      if (ssapFlags && !ssapFlags.html5_enable_ssap_entity_id) return;
      if (Array.prototype.push !== realPush && Array.prototype.push !== ssapPushProxy) return;
      restoreSsapPushCapture();
      Array.prototype.push = ssapPushProxy;
      try {
        if (typeof realTimeout !== "function") throw new Error("timeout unavailable");
        ssapPushRestoreTimer = realTimeout(restoreSsapPushCapture, 10000);
        // Node-based regression harnesses should not be kept alive by the
        // browser-only startup watchdog.
        if (ssapPushRestoreTimer && typeof ssapPushRestoreTimer.unref === "function") {
          ssapPushRestoreTimer.unref();
        }
      } catch (_) {
        // Never leave a page-wide prototype hook installed without a working
        // watchdog to remove it.
        restoreSsapPushCapture();
      }
    };
    installSsapPushCapture();
    window.addEventListener("yt-navigate-start", function () {
      ssapSegments.length = 0;
      ssapIds.length = 0;
      ssapArmed = false;
      lastJumpKey = "";
      installSsapPushCapture();
    });
    window.addEventListener("pagehide", restoreSsapPushCapture, { once: true });
    document.addEventListener("DOMContentLoaded", function () {
      try {
        if (!masterEnabled()) return;
        if (!(window.yt && window.yt.config_ && window.yt.config_.EXPERIMENT_FLAGS &&
            window.yt.config_.EXPERIMENT_FLAGS.html5_enable_ssap_entity_id)) return;
        var check = function () {
          try {
            var video = document.querySelector("video");
            if (!video || !ssapSegments.length) return;
            var duration = Math.round(video.duration);
            var last = ssapSegments[ssapSegments.length - 1];
            var end = Math.round(last.end / 1000);
            var key = ssapIds.join(",");
            if (pageUrl !== document.location.href) {
              pageUrl = document.location.href;
              ssapSegments.length = 0;
              ssapIds.length = 0;
              ssapArmed = false;
              return;
            }
            if (duration && duration === end && ((!video.loop && lastJumpKey !== key) || video.loop)) {
              var start = last.start / 1000;
              if (video.currentTime < start) {
                video.currentTime = start;
                ssapArmed = false;
                lastJumpKey = key;
              }
            }
          } catch (_) {}
        };
        check();
        var checkQueued = false;
        var queueCheck = function () {
          if (checkQueued) return;
          checkQueued = true;
          setTimeout(function () {
            checkQueued = false;
            check();
          }, 150);
        };
        new MutationObserver(queueCheck).observe(document, { childList: true, subtree: true });
      } catch (_) {}
    });
  } catch (_) {}

  try {
    var realCall = Function.prototype.call;
    var sawSnapshot = false;
    var backoffDetected = false;
    var restoredCall = false;
    var restoreCall = function () {
      try {
        if (!restoredCall) {
          Function.prototype.call = realCall;
          restoredCall = true;
        }
      } catch (_) {}
    };
    var hasBackoffTime = function (root) {
      if (!isObject(root)) return false;
      var stack = [{ obj: root, depth: 0 }];
      var seen = new WeakSet();
      while (stack.length) {
        var entry = stack.pop();
        var obj = entry.obj;
        if (!isObject(obj) || seen.has(obj) || entry.depth > 5) continue;
        seen.add(obj);
        if (own(obj, "backoffTimeMs")) return obj.backoffTimeMs !== undefined;
        for (var key in obj) {
          if (!own(obj, key)) continue;
          var value = obj[key];
          if (isObject(value) && !seen.has(value)) stack.push({ obj: value, depth: entry.depth + 1 });
        }
      }
      return false;
    };
    Function.prototype.call = new Proxy(realCall, {
      apply: function (target, thisArg, args) {
        if (!masterEnabled()) return Reflect.apply(target, thisArg, args);
        try {
          var first = args && args[0];
          if (first && first.requestNumber && first.snapshot) {
            sawSnapshot = true;
            backoffDetected = hasBackoffTime(first);
            if (backoffDetected) restoreCall();
          }
        } catch (_) {}
        return Reflect.apply(target, thisArg, args);
      },
    });
    window.addEventListener("load", function () {
      restoreCall();
      if (!masterEnabled()) return;
      // Reloading is a last-resort recovery for an observed transport backoff.
      // If YouTube changed the snapshot shape (or no snapshot was seen), a
      // speculative reload only restarts healthy playback and adds delay.
      if (!backoffDetected) return;
      try {
        var query = window.location.search;
        var videoId = new URLSearchParams(query).get("v");
        if (!videoId) return;
        var waitUntilPlayer = function (selector, interval, timeout) {
          return new Promise(function (resolve) {
            var end = Date.now() + timeout;
            var tick = function () {
              var found = document.querySelector(selector);
              if (found || Date.now() > end) resolve(found || null);
              else setTimeout(tick, interval);
            };
            tick();
          });
        };
        waitUntilPlayer("#movie_player", 200, 10000).then(function (mp) {
          if (!mp || typeof mp.loadVideoById !== "function") return;
          var t = new URLSearchParams(query).get("t") || "0";
          try {
            mp.loadVideoById(videoId, parseInt(t, 10));
          } catch (_) {}
        });
      } catch (_) {}
    });
  } catch (_) {}

  try {
    var flagTimer = setInterval(function () {
      try {
        if (!masterEnabled()) {
          clearInterval(flagTimer);
          return;
        }
        if (window.ytcfg && ytcfg.data_ && ytcfg.data_.EXPERIMENT_FLAGS) {
          ytcfg.data_.EXPERIMENT_FLAGS.web_streaming_watch = false;
          clearInterval(flagTimer);
        }
      } catch (_) {}
    }, 200); // PERF: 50ms was needlessly tight on weak CPUs; flag is read once early. Still bounded by the 5s deadline below.
    setTimeout(function () { try { clearInterval(flagTimer); } catch (_) {} }, 5000);
  } catch (_) {}

  function removeCosmetics() {
    try {
      if (cosmeticStyle && cosmeticStyle.parentNode) cosmeticStyle.parentNode.removeChild(cosmeticStyle);
      cosmeticStyle = null;
    } catch (_) {}
  }

  function applyCosmetics() {
    if (!masterEnabled() || cosmeticStyle) return;
    try {
    var css =
      /* An ad card can keep a menu beside its hidden ad renderer; collapse the card too. */
      "ytd-rich-item-renderer:has(> #content > :is(ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-display-ad-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer))," +
      "ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-display-ad-renderer," +
      "ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer," +
      "ytd-companion-slot-renderer,ytd-action-companion-ad-renderer," +
      "ytd-banner-promo-renderer,#masthead-ad,#player-ads," +
      "ytm-promoted-sparkles-web-renderer,ytm-companion-slot-renderer" +
      "{display:none!important}";
    var style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
      cosmeticStyle = style;
    } catch (_) {}
  }

  applyCosmetics();
  window.__wardenOneYouTubeReadyVersion = YT_MODULE_VERSION;
})();

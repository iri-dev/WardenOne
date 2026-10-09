/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Deep miner detection covers same-origin workers that network blocklists miss.
   Terminate only workers whose readable source contains mining routines, including
   replacements; allowlisted sites are untouched. CPU load alone cannot identify
   mining reliably. Cross-origin, obfuscated and pure-WASM workers remain outside
   this detector's scope. */
(function () {
  'use strict';
  const WO_GUARD_VERSION = '1.0.2';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  /* Any copy at all, of any version: nothing injects a second copy into a live document any more
     (the worker reloads the tab instead), and a published disposer for the old copy to be released
     through was a page-callable kill switch (SEC-03). */
  if (window.__wardenOneMinerWatch) return;
  window.__wardenOneMinerWatch = WO_GUARD_VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  /* Reachable only through a signed "dispose" message from the isolated bridge. */
  const woDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
  };
  if (window.top !== window) return;

  var TOKEN = null;
  /* The routing token is public; the key is handed over once, in a synchronous wo-key event at
     document_start, and never again (SEC-01). Config counts only when it is signed with it. */
  var woKey = null;
  var woLastSeq = 0;
  /* HMAC-SHA256 over UTF-8 text, in plain JS. crypto.subtle is absent on http: pages and
     asynchronous everywhere, and this has to answer inside a synchronous DOM event. Every
     reference it needs is captured here, before the page runs, so a page that rewrites
     TextEncoder or Uint8Array later changes nothing about what it computes. Not a general
     library: fixed 32-byte key (hex), text in, hex out. */
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

  /* Verify a signed message from the bridge: a sequence number that only moves forward and an
     HMAC under the key over that number, the kind and the payload (SEC-01). */
  const woVerify = (kind, payload, m) => {
    if (!woKey || !m) return false;
    const seq = Number(m.seq);
    if (!Number.isInteger(seq) || seq <= woLastSeq) return false;
    if (!__woAuth.same(m.mac, __woAuth.hmac(woKey, seq + '\n' + kind + '\n' + String(payload)))) return false;
    woLastSeq = seq;
    return true;
  };

  var siteAllowlisted = false;
  var masterOff = false;
  var configReady = false;
  var pending = [];
  var HOST = String(location.hostname || '').replace(/^www\./, '').toLowerCase();

  try {
    woOn(document, 'wo-key', function (e) {
      var d = e && e.detail;
      if (woKey || !d || typeof d.token !== 'string' || !d.token || typeof d.key !== 'string' || !d.key) return;
      TOKEN = d.token;
      woKey = __woAuth.key(d.key);
    });
    woOn(window, 'message', function (e) {
      if (e.source !== window || !e.data) return;
      if (e.data.source === 'wardenone' && e.data.kind === 'dispose' && TOKEN && e.data.token === TOKEN && woVerify('dispose', '', e.data)) {
        woDispose();
        return;
      }
      /* The bridge hands the main world the same sanitized config content.js
         gets. We only need two things from it: whether the user switched
         WardenOne off, and whether they allowlisted this site. An allowlisted
         site is never acted on -- that is the escape hatch for a false positive
         and for anyone who genuinely wants a page to mine. */
      if (e.data.source === 'wardenone' && e.data.kind === 'config'
        && TOKEN && e.data.token === TOKEN && e.data.overrides
        && woVerify('config', JSON.stringify(e.data.overrides), e.data)) {
        var o = e.data.overrides;
        masterOff = o.enabled === false;
        var list = Array.isArray(o.allowlist) ? o.allowlist : [];
        siteAllowlisted = list.some(function (h) {
          h = String(h || '').replace(/^www\./, '').toLowerCase();
          return h && (HOST === h || HOST.endsWith('.' + h));
        });
        configReady = true;
        flushPending();
      }
    });
  } catch (_) {}
  /* The bridge posts the handshake once at document_start; a dynamically registered script can
     miss it, so ask for a replay.

     Through a DOM event, not a global. This script runs in MAIN and the bridge runs in ISOLATED,
     so the window each sees is a different object: the `window.__wardenOneBridgeReplay` this used
     to call is not merely absent, it is unreachable by construction. The test guarding it was
     false every time, so the request was a no-op and this script simply never recovered from a
     missed handshake -- no token, so every later config was rejected, so confirmed detections
     stayed queued behind configReady and nothing was ever acted on or reported.

     `document` is shared between the two worlds, and is already the channel this side uses to
     reach the bridge. */
  function requestBridgeReplay() {
    try { document.dispatchEvent(new CustomEvent('wo-bridge-replay')); } catch (_) {}
  }
  requestBridgeReplay();

  /* Vocabulary that does not turn up in ordinary code by accident. Deliberately
     no bare "nonce" (CSP), "scrypt" or "argon2" (password hashing), or "worker" --
     those are legitimate elsewhere and would make this a false-positive machine. */
  var MINER_TELLS = /cryptonight|randomx|hashesPerSecond|hashrate|totalhashes|stratum\+tcp|coinhive|authedmine|cryptoloot|crypto-loot|webminepool|jsecoin|deepminer|coinimp|minero\.cc|throttleMiner|CryptonightWASMWrapper/i;

  var SCAN_BUDGET = 8;        /* never scan an ordinary page to death */
  var SCAN_BUDGET_CONFIRMED = 250;
  var MAX_SOURCE_BYTES = 800000;

  var scanned = 0;
  var scanBudget = SCAN_BUDGET;
  var reported = false;
  var confirmed = false;
  var liveWorkers = 0;
  var peakWorkers = 0;
  var wasmSeen = false;
  var stoppedCount = 0;
  var firstTell = '';
  var minerSources = Object.create(null);  /* url -> true, for respawn */
  var sourceReadsInFlight = Object.create(null);  /* url -> 1 while its source is being read */
  var SOURCE_READ_TIMEOUT_MS = 5000;
  var liveByUrl = Object.create(null);     /* url -> [worker] */

  function trackWorker(url, w) {
    var list = liveByUrl[url] || (liveByUrl[url] = []);
    list.push(w);
  }
  function untrackWorker(url, w) {
    var list = liveByUrl[url];
    if (!list) return;
    var i = list.indexOf(w);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete liveByUrl[url];
  }

  function killWorker(w) {
    try {
      /* the native terminate, captured before the page could replace it */
      if (w && typeof w.__woNativeTerminate === 'function') w.__woNativeTerminate();
      else if (w && typeof w.terminate === 'function') w.terminate();
      stoppedCount++;
      return true;
    } catch (_) { return false; }
  }

  /* Signed as the 'miner' sender (bridge.js eventSigned): without the key there is no signature,
     and the bridge and the engine then ignore it, as they ignore anything unsigned. */
  var minerEventSeq = 0;
  function announce(type, tell) {
    try {
      var detail = {
        host: location.hostname,
        workers: peakWorkers,
        stopped: stoppedCount,
        cores: Number(navigator.hardwareConcurrency) || 0,
        tell: String(tell || 'mining code').slice(0, 40),
        wasm: wasmSeen,
        why: type === 'blocked_cryptominer'
          ? 'a background worker was running mining code and was stopped'
          : 'a background worker is running mining code (site is allowlisted, left alone)',
      };
      var event = { token: TOKEN, type: type, detail: detail };
      if (woKey) {
        minerEventSeq += 1;
        event.src = 'miner';
        event.eseq = minerEventSeq;
        event.emac = __woAuth.hmac(woKey, __woAuth.eventText('miner', minerEventSeq, type, detail));
      }
      document.dispatchEvent(new CustomEvent('wo-event', { detail: event }));
    } catch (_) {}
  }

  /* Nothing may be terminated before the bridge has told us whether the user
     allowlisted this site. A blob: worker's source resolves from memory, which
     is routinely faster than the config message (the bridge has to read storage
     first), so acting on arrival would kill workers on allowlisted sites. Hold
     findings until the answer is in; a miner running a few hundred ms longer is
     a far better failure than breaking a site the user asked us to leave alone. */
  function flushPending() {
    if (!configReady) return;
    var queue = pending;
    pending = [];
    for (var i = 0; i < queue.length; i++) onMinerFound(queue[i].url, queue[i].tell);
  }

  /* Called when a worker's source is confirmed to contain mining code. */
  function onMinerFound(url, tell) {
    if (!firstTell) firstTell = tell;

    if (!configReady) {
      pending.push({ url: url, tell: tell });
      /* The handshake may have been posted before this script was injected; ask the bridge to
         send both again. This is the retry that matters -- the one at install time can lose the
         race if the bridge has not run yet, and this one fires when there is something to lose. */
      requestBridgeReplay();
      return;
    }

    if (masterOff || siteAllowlisted) {
      /* Never act on a site the user allowlisted. Say so once and stop there. */
      if (!reported) { reported = true; announce('detected_cryptominer', tell); }
      return;
    }

    minerSources[url] = true;
    if (!confirmed) {
      confirmed = true;
      /* The page is now known hostile, so keep scanning its replacements. A
         miner that respawns behind a fresh blob: URL each time would otherwise
         walk straight past the ordinary-page scan budget. */
      scanBudget = SCAN_BUDGET_CONFIRMED;
    }

    var list = (liveByUrl[url] || []).slice();
    for (var i = 0; i < list.length; i++) killWorker(list[i]);

    if (!reported) { reported = true; announce('blocked_cryptominer', tell); }
  }

  /* Stop reading at the cap instead of buffering the whole body and slicing afterwards (L17).
     MAX_SOURCE_BYTES always bounded what was MATCHED; it never bounded what was held in memory,
     so a page could hand this an arbitrarily large "worker script" and have it all read in before
     the limit was applied. Matching semantics are unchanged -- still the first 800 KB. */
  function readCapped(res) {
    if (!res || !res.body || typeof res.body.getReader !== 'function') {
      return res.text().then(function (t) { return String(t || '').slice(0, MAX_SOURCE_BYTES); });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var bytes = 0;
    var text = '';
    var pump = function () {
      return reader.read().then(function (chunk) {
        if (!chunk || chunk.done) { text += decoder.decode(); return text; }
        var value = chunk.value;
        if (value) {
          bytes += Number(value.byteLength || value.length || 0);
          text += decoder.decode(value, { stream: true });
          if (bytes >= MAX_SOURCE_BYTES) {
            try { reader.cancel(); } catch (_) {}
            return text.slice(0, MAX_SOURCE_BYTES);
          }
        }
        return pump();
      });
    };
    return pump();
  }

  function scanWorkerSource(url, w) {
    var href = String(url || '');
    if (!href) return;
    /* A source already known to be a miner needs no second look -- kill on sight.
       This is the respawn path and it is synchronous, so the replacement worker
       gets no run time at all. */
    if (minerSources[href]) { killWorker(w); return; }
    if (scanned >= scanBudget) return;
    if (!/^blob:/i.test(href)) {
      /* Only same-origin scripts are readable. Anything else is the network
         layer's job, and fetching it would be a request the page never made. */
      try {
        var u = new URL(href, location.href);
        if (u.origin !== location.origin) return;
        if (!/^https?:$/.test(u.protocol)) return;
      } catch (_) { return; }
    }
    /* One read per URL in flight. A page that starts the same worker repeatedly would otherwise
       get one fetch each, and the scan budget only counts starts, not concurrent reads (L17). */
    if (sourceReadsInFlight[href]) return;
    scanned++;
    sourceReadsInFlight[href] = 1;
    var done = function () { delete sourceReadsInFlight[href]; };
    try {
      /* same-origin or blob: only, so this is served from cache or memory and
         does not put a new request on the wire for a third party. */
      var controller = new AbortController();
      var timer = woTimeout(function () { try { controller.abort(); } catch (_) {} }, SOURCE_READ_TIMEOUT_MS);
      fetch(href, { signal: controller.signal }).then(function (r) {
        /* An error page is not worker source. Reading one and matching against it is how a
           404 body full of site chrome could be scored as mining code. */
        if (!r || (r.status && !r.ok)) throw new Error('bad status');
        return readCapped(r);
      }).then(function (src) {
        clearTimeout(timer);
        done();
        if (typeof src !== 'string') return;
        var m = src.match(MINER_TELLS);
        if (m) onMinerFound(href, m[0]);
      }).catch(function () { clearTimeout(timer); done(); });
    } catch (_) { done(); }
  }

  try {
    var NativeWorker = window.Worker;
    if (typeof NativeWorker === 'function') {
      var Wrapped = function (url, opts) {
        var w = new NativeWorker(url, opts);
        var href = String(url || '');
        liveWorkers++;
        if (liveWorkers > peakWorkers) peakWorkers = liveWorkers;
        var done = false;
        var drop = function () {
          if (done) return;
          done = true;
          liveWorkers = Math.max(0, liveWorkers - 1);
          untrackWorker(href, w);
        };
        try {
          var nativeTerminate = w.terminate;
          /* Keep our own handle on the real terminate. A miner that overwrites
             terminate() with a no-op must not be able to keep itself alive. */
          try {
            Object.defineProperty(w, '__woNativeTerminate', {
              value: function () { drop(); return nativeTerminate.call(w); },
              enumerable: false, configurable: false, writable: false,
            });
          } catch (_) {}
          w.terminate = function () { drop(); return nativeTerminate.apply(this, arguments); };
        } catch (_) {}
        try { woOn(w, 'error', drop); } catch (_) {}
        trackWorker(href, w);
        scanWorkerSource(href, w);
        return w;
      };
      Wrapped.prototype = NativeWorker.prototype;
      try { Object.defineProperty(Wrapped, 'name', { value: 'Worker', configurable: true }); } catch (_) {}
      /* Match the cloaking the rest of the extension uses: a page that
         stringifies Worker must not see a wrapper. */
      try {
        var nativeToString = Function.prototype.toString;
        Wrapped.toString = function () { return nativeToString.call(NativeWorker); };
      } catch (_) {}
      window.Worker = Wrapped;
    }
  } catch (_) {}

  /* Recorded for context in the report only. WebAssembly on its own means
     nothing -- every serious web app uses it. */
  try {
    var WA = window.WebAssembly;
    if (WA) {
      var mark = function (fn) {
        if (typeof fn !== 'function') return fn;
        return function () { wasmSeen = true; return fn.apply(this, arguments); };
      };
      if (WA.instantiate) WA.instantiate = mark(WA.instantiate);
      if (WA.compile) WA.compile = mark(WA.compile);
      if (WA.instantiateStreaming) WA.instantiateStreaming = mark(WA.instantiateStreaming);
      if (WA.compileStreaming) WA.compileStreaming = mark(WA.compileStreaming);
    }
  } catch (_) {}
})();

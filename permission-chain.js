/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Permission Chain Guard (MAIN world)
 * Watches for sensitive browser capability requests in sequence. It does not
 * read clipboard contents, file names, media streams, or location values.
 */
(function () {
  'use strict';

  const WO_GUARD_VERSION = '1.0.1';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  /* Any copy at all, of any version: nothing injects a second copy into a live document any more
     (the worker reloads the tab instead), and a published disposer for the old copy to be released
     through was a page-callable kill switch (SEC-03). */
  if (window.__wardenOnePermissionChainInstalled) return;
  window.__wardenOnePermissionChainInstalled = WO_GUARD_VERSION;

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

  let woToken = null;
  /* The routing token is public; the key is handed over once, in a synchronous wo-key event at
     document_start, and never again (SEC-01). Config counts only when it is signed with it. */
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

  let chainEnabled = false;
  const queued = [];
  const lastSignalAt = Object.create(null);
  let lastGestureAt = 0;

  function now() {
    return Date.now();
  }

  function noteGesture(e) {
    try {
      if (!e || e.isTrusted === false) return;
      lastGestureAt = now();
    } catch (_) {}
  }

  try {
    woOn(window, 'pointerdown', noteGesture, true);
    woOn(window, 'keydown', noteGesture, true);
    woOn(window, 'touchstart', noteGesture, true);
  } catch (_) {}

  function hasRecentGesture() {
    return now() - lastGestureAt < 5000;
  }

  function cleanPermission(value) {
    const raw = String(value || '').toLowerCase().replace(/_/g, '-').trim();
    const aliases = {
      notification: 'notifications',
      clipboard: 'clipboard-read',
      clipboardread: 'clipboard-read',
      clipboardwrite: 'clipboard-write',
      geolocation: 'location',
      display: 'screen',
      screenshare: 'screen',
      file: 'file-open',
      filesystem: 'file-open',
      directorypicker: 'directory',
      automaticdownloads: 'automatic-downloads',
    };
    const key = aliases[raw] || raw;
    return /^(notifications|camera|microphone|screen|clipboard-read|clipboard-write|location|file-open|file-save|directory|file-upload|automatic-downloads)$/.test(key) ? key : '';
  }

  function cleanHost(value) {
    return String(value || '').replace(/^www\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
  }

  function hostAllowedByUser(cfg) {
    const host = cleanHost(location.hostname);
    const list = Array.isArray(cfg && cfg.allowlist) ? cfg.allowlist : [];
    return list.some((item) => {
      const d = cleanHost(item);
      return !!(d && (host === d || host.endsWith('.' + d)));
    });
  }

  function emit(permission, action, extra) {
    if (!chainEnabled) return;
    const key = cleanPermission(permission);
    if (!key) return;
    const act = String(action || 'request').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const bucket = key + ':' + act;
    const t = now();
    if (lastSignalAt[bucket] && t - lastSignalAt[bucket] < 2500) return;
    lastSignalAt[bucket] = t;
    const detail = Object.assign({
      token: woToken,
      permission: key,
      action: act,
      userGesture: hasRecentGesture(),
    }, extra && typeof extra === 'object' ? extra : {});
    if (!woToken) {
      queued.push(detail);
      if (queued.length > 40) queued.shift();
      return;
    }
    try {
      document.dispatchEvent(new CustomEvent('wo-permission-signal', { detail }));
    } catch (_) {}
  }

  function flushQueued() {
    if (!woToken) return;
    while (queued.length) {
      const detail = queued.shift();
      detail.token = woToken;
      try {
        document.dispatchEvent(new CustomEvent('wo-permission-signal', { detail }));
      } catch (_) {}
    }
  }

  try {
    woOn(document, 'wo-key', (e) => {
      const d = e && e.detail;
      if (woKey || !d || typeof d.token !== 'string' || !d.token || typeof d.key !== 'string' || !d.key) return;
      woToken = d.token;
      woKey = d.key;
      flushQueued();
    });
    woOn(window, 'message', (e) => {
      if (e.source !== window) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.source === 'wardenone' && m.kind === 'dispose' && woToken && m.token === woToken && woVerify('dispose', '', m)) {
        woDispose();
        return;
      }
      /* Config used to be accepted before any token had arrived at all ("!woToken ||"), so a
         page did not even need the nonce to switch this guard off. */
      if (m.source === 'wardenone' && m.kind === 'config' && woToken && m.token === woToken
          && m.overrides && typeof m.overrides === 'object'
          && woVerify('config', JSON.stringify(m.overrides), m)) {
        const cfg = m.overrides || {};
        chainEnabled = cfg.enabled !== false && cfg.permissionChainGuard !== false && !hostAllowedByUser(cfg);
      }
    }, true);
    /* In case the bridge ran first and its key found no listener here: ask once, now that the
       listeners above exist. The bridge answers only while no page script can be running. */
    document.dispatchEvent(new CustomEvent('wo-bridge-replay'));
  } catch (_) {}

  function wrapMethod(obj, name, wrapper) {
    try {
      if (!obj || obj.__woPermChainPatched && obj.__woPermChainPatched[name]) return;
      const original = obj[name];
      if (typeof original !== 'function') return;
      const wrapped = wrapper(original);
      try { Object.defineProperty(wrapped, 'name', { value: original.name || name }); } catch (_) {}
      try { Object.defineProperty(wrapped, 'length', { value: original.length }); } catch (_) {}
      obj[name] = wrapped;
      if (!obj.__woPermChainPatched) {
        try { Object.defineProperty(obj, '__woPermChainPatched', { value: Object.create(null) }); } catch (_) { obj.__woPermChainPatched = Object.create(null); }
      }
      obj.__woPermChainPatched[name] = true;
    } catch (_) {}
  }

  function mediaKinds(constraints) {
    const out = [];
    try {
      const c = constraints || {};
      if (c.video) out.push('camera');
      if (c.audio) out.push('microphone');
    } catch (_) {}
    return out.length ? out : ['camera', 'microphone'];
  }

  function patchNotifications() {
    try {
      const N = window.Notification;
      if (!N || typeof N.requestPermission !== 'function' || N.__woPermChainRequest) return;
      const original = N.requestPermission;
      const wrapped = function (callback) {
        emit('notifications', 'request');
        // ONE outcome per request, whatever the implementation does (L22).
        //
        // requestPermission has two shapes: it returns a Promise and it accepts a legacy callback,
        // and a browser is allowed to honour both for the same call. Emitting from each path
        // independently then reported a single prompt twice -- two log entries for one decision,
        // and two charges against the rate limit that keeps this instrumentation cheap. Which of
        // the two arrives first does not matter; only that the second one is ignored.
        let settled = false;
        const settle = (kind, detail) => {
          if (settled) return;
          settled = true;
          emit('notifications', kind, detail);
        };
        const outcome = (result) => settle(
          result === 'granted' ? 'granted' : 'denied',
          { result: String(result || '') },
        );
        const cb = typeof callback === 'function' ? function (result) {
          outcome(result);
          return callback.apply(this, arguments);
        } : callback;
        const ret = original.call(this, cb);
        if (ret && typeof ret.then === 'function') {
          return ret.then((result) => {
            outcome(result);
            return result;
          }, (err) => {
            settle('error');
            throw err;
          });
        }
        return ret;
      };
      try { Object.defineProperty(wrapped, 'name', { value: original.name || 'requestPermission' }); } catch (_) {}
      N.requestPermission = wrapped;
      try { Object.defineProperty(N, '__woPermChainRequest', { value: true }); } catch (_) { N.__woPermChainRequest = true; }
    } catch (_) {}
  }

  function patchMedia() {
    try {
      const md = navigator.mediaDevices;
      if (!md) return;
      wrapMethod(md, 'getUserMedia', (original) => function (constraints) {
        const kinds = mediaKinds(constraints);
        kinds.forEach((k) => emit(k, 'request'));
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((stream) => {
            kinds.forEach((k) => emit(k, 'granted'));
            return stream;
          }, (err) => {
            kinds.forEach((k) => emit(k, 'denied', { result: String((err && err.name) || '') }));
            throw err;
          });
        }
        return ret;
      });
      wrapMethod(md, 'getDisplayMedia', (original) => function () {
        emit('screen', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((stream) => {
            emit('screen', 'granted');
            return stream;
          }, (err) => {
            emit('screen', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
    } catch (_) {}
  }

  function patchClipboard() {
    try {
      const cb = navigator.clipboard;
      if (!cb) return;
      ['read', 'readText'].forEach((name) => {
        wrapMethod(cb, name, (original) => function () {
          emit('clipboard-read', 'request');
          const ret = original.apply(this, arguments);
          if (ret && typeof ret.then === 'function') {
            return ret.then((value) => {
              emit('clipboard-read', 'granted');
              return value;
            }, (err) => {
              emit('clipboard-read', 'denied', { result: String((err && err.name) || '') });
              throw err;
            });
          }
          return ret;
        });
      });
      ['write', 'writeText'].forEach((name) => {
        wrapMethod(cb, name, (original) => function () {
          emit('clipboard-write', 'used');
          return original.apply(this, arguments);
        });
      });
    } catch (_) {}
  }

  function patchGeolocation() {
    try {
      const geo = navigator.geolocation;
      if (!geo) return;
      ['getCurrentPosition', 'watchPosition'].forEach((name) => {
        wrapMethod(geo, name, (original) => function (success, error) {
          emit('location', 'request');
          const wrappedSuccess = typeof success === 'function' ? function () {
            emit('location', 'granted');
            return success.apply(this, arguments);
          } : success;
          const wrappedError = typeof error === 'function' ? function (err) {
            emit('location', 'denied', { result: String((err && err.code) || '') });
            return error.apply(this, arguments);
          } : function (err) {
            emit('location', 'denied', { result: String((err && err.code) || '') });
          };
          return original.call(this, wrappedSuccess, wrappedError, arguments[2]);
        });
      });
    } catch (_) {}
  }

  function patchFilePickers() {
    try {
      wrapMethod(window, 'showOpenFilePicker', (original) => function () {
        emit('file-open', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((handles) => {
            emit('file-open', 'selected', { count: Array.isArray(handles) ? Math.min(handles.length, 99) : 1 });
            return handles;
          }, (err) => {
            emit('file-open', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
      wrapMethod(window, 'showSaveFilePicker', (original) => function () {
        emit('file-save', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((handle) => {
            emit('file-save', 'selected');
            return handle;
          }, (err) => {
            emit('file-save', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
      wrapMethod(window, 'showDirectoryPicker', (original) => function () {
        emit('directory', 'request');
        const ret = original.apply(this, arguments);
        if (ret && typeof ret.then === 'function') {
          return ret.then((handle) => {
            emit('directory', 'selected');
            return handle;
          }, (err) => {
            emit('directory', 'denied', { result: String((err && err.name) || '') });
            throw err;
          });
        }
        return ret;
      });
    } catch (_) {}
  }

  function watchFileInputs() {
    try {
      woOn(document, 'change', (e) => {
        const el = e && e.target;
        if (!el || !el.matches || !el.matches('input[type="file" i]')) return;
        const count = el.files && typeof el.files.length === 'number' ? Math.min(el.files.length, 99) : 0;
        if (count > 0) emit('file-upload', 'selected', { count });
      }, true);
    } catch (_) {}
  }

  function patchAll() {
    patchNotifications();
    patchMedia();
    patchClipboard();
    patchGeolocation();
    patchFilePickers();
  }

  patchAll();
  watchFileInputs();
  try { woTimeout(patchAll, 500); } catch (_) {}
  try { woTimeout(patchAll, 2000); } catch (_) {}
})();

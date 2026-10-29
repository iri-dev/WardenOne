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
  if (typeof wardenOneEngineLoginUrl === 'function' && wardenOneEngineLoginUrl(location.href)) return;

  const WO_GUARD_VERSION = '1.0.3';
  /* SEC-03: refuse a second copy of any version. Repair reloads the tab; no page-callable disposer is exposed. */
  if (window.__wardenOnePermissionChainInstalled) return;
  window.__wardenOnePermissionChainInstalled = WO_GUARD_VERSION;


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
  /* Preserve the native timer callback’s this binding. */
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
  /* Synchronous DOM replies need HMAC without crypto.subtle, which is async and unavailable on HTTP. Capture built-ins
     before page scripts; keys are fixed 32-byte hex values. */
  /* AUTH-BEGIN: shared by MAIN-world receivers and the isolated bridge. */
  const __woAuth=(function(){
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const U8=Uint8Array,U32=Uint32Array,D="0123456789abcdef";
    /* Derive HMAC pads before page scripts run. Signing must not call replaceable built-ins with key data;
       a patched string/typed-array method could otherwise capture the key. Message data is not secret. */
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
    const parse=JSON.parse,stringify=JSON.stringify,isSafeInteger=Number.isSafeInteger,isArray=Array.isArray;
    function config(message,pads,lastSeq){
      try{
        const seq=message.seq;
        if(!pads||!isSafeInteger(seq)||seq<=lastSeq)return null;
        const payload=stringify(message.overrides);
        if(!payload||payload.length>1048576)return null;
        const overrides=parse(payload);
        if(!overrides||typeof overrides!=="object"||isArray(overrides))return null;
        if(!same(message.mac,hmac(pads,seq+"\nconfig\n"+payload)))return null;
        return{seq:seq,overrides:overrides}
      }catch(_){return null}
    }
    function pageCouldHaveRun(doc){
      try{
        if(doc.readyState!=="loading"||doc.body)return true;
        const root=doc.documentElement;
        if(!root)return false;
        const all=root.getElementsByTagName("*");
        if(all.length>64)return true;
        for(let i=-1;i<all.length;i++){
          const el=i<0?root:all[i];
          if(i>=0&&!/^(?:head|meta|title|link|style|base)$/.test(String(el.localName||"").toLowerCase()))return true;
          for(let j=0;el.attributes&&j<el.attributes.length;j++)if(/^on/i.test(String(el.attributes[j].name||"")))return true;
        }
        return false
      }catch(_){return true}
    }
    function configReceiver(){
      let token=null,pads=null,lastSeq=0;
      return{
        acceptKey(detail,doc){
          if(pads||!detail||typeof detail.token!=="string"||!detail.token||typeof detail.key!=="string"||!/^[0-9a-f]{64}$/i.test(detail.key)||pageCouldHaveRun(doc))return false;
          token=detail.token,pads=key(detail.key);
          return true
        },
        read(event,win){
          try{
            const message=event.data;
            if(event.source!==win||!message||message.source!=="wardenone"||message.kind!=="config"||token===null||message.token!==token)return null;
            const verified=config(message,pads,lastSeq);
            if(!verified)return null;
            lastSeq=verified.seq;
            return verified.overrides
          }catch(_){return null}
        }
      }
    }
    return{hmac:hmac,same:same,key:key,canon:canon,eventText:eventText,config:config,configReceiver:configReceiver,pageCouldHaveRun:pageCouldHaveRun}
  })();
  /* AUTH-END */

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
      return typeof hostMatchesSite === 'function' && hostMatchesSite(host, item);
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
      document.dispatchEvent(new CustomEvent('wo-permission-signal', { detail: signPermission(detail) }));
    } catch (_) {}
  }

  /* Signed under the key (bridge.js permissionSignalSigned), over a number that only moves forward
     and everything the signal says: the routing token is public, so a page could otherwise report
     permission requests it never made, or hide the ones it did behind invented ones. */
  let permissionSeq = 0;
  function signPermission(detail) {
    if (!woKey) return detail;
    const body = Object.assign({}, detail);
    delete body.token; delete body.pseq; delete body.pmac;
    permissionSeq += 1;
    detail.pseq = permissionSeq;
    detail.pmac = __woAuth.hmac(woKey, 'permission\n' + permissionSeq + '\n' + __woAuth.canon(body, 0));
    return detail;
  }

  function flushQueued() {
    if (!woToken) return;
    while (queued.length) {
      const detail = queued.shift();
      detail.token = woToken;
      try {
        document.dispatchEvent(new CustomEvent('wo-permission-signal', { detail: signPermission(detail) }));
      } catch (_) {}
    }
  }

  try {
    woOn(document, 'wo-key', (e) => {
      const d = e && e.detail;
      if (woKey || !d || typeof d.token !== 'string' || !d.token || typeof d.key !== 'string' || !/^[0-9a-f]{64}$/i.test(d.key) || __woAuth.pageCouldHaveRun(document)) return;
      woToken = d.token;
      woKey = __woAuth.key(d.key);
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
      if (m.source === 'wardenone' && m.kind === 'config' && woToken && m.token === woToken) {
        const verified = __woAuth.config(m, woKey, woLastSeq);
        if (!verified) return;
        woLastSeq = verified.seq;
        const cfg = verified.overrides;
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
        // L22: promise and legacy callback paths may both complete one request. Emit only the first outcome.
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

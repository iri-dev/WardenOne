/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
(function () {
  'use strict';
  if (window.top === window) return;
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (!cookie?.configurable || !cookie.get || !cookie.set) return;

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

  const receiver = __woAuth.configReceiver();
  const apply = Reflect.apply;
  const define = Object.defineProperty;
  const descriptor = Object.getOwnPropertyDescriptor;
  const resolve = Promise.resolve.bind(Promise);
  let blocked = false;
  try {
    const entries = performance.getEntriesByType('navigation');
    const timing = entries.length === 1 ? entries[0].serverTiming : [];
    // Response timing can only tighten this document before authenticated configuration arrives.
    blocked = !__woAuth.pageCouldHaveRun(document) && timing.length === 1
      && timing[0].name === 'cookie-policy' && timing[0].description === 'restricted' && timing[0].duration === 0;
  } catch (_) {}

  document.addEventListener('wo-key', event => receiver.acceptKey(event.detail, document), true);
  window.addEventListener('message', event => {
    const cfg = receiver.read(event, window);
    if (cfg) blocked = cfg.frameCookieIsolation === true && cfg.enabled !== false && cfg.blockThirdPartyCookies !== false;
  }, true);

  {
    const guard = original => ({ enumerable: original.enumerable, configurable: false,
      get() { return blocked ? '' : apply(original.get, this, []); },
      set(value) { if (!blocked) return apply(original.set, this, [value]); } });
    const own = descriptor(document, 'cookie');
    // Guard the document and prototype; an extracted prototype getter must not bypass the decision.
    define(Document.prototype, 'cookie', guard(cookie));
    if (!own || (own.configurable && own.get && own.set)) define(document, 'cookie', guard(own || cookie));
  }

  if (typeof CookieStore === 'function' && window.cookieStore) {
    for (const name of ['get', 'getAll', 'set', 'delete']) {
      const entry = descriptor(CookieStore.prototype, name);
      if (!entry?.configurable || typeof entry.value !== 'function') continue;
      const value = function (...args) {
        if (!blocked) return apply(entry.value, this, args);
        return resolve(name === 'get' ? null : name === 'getAll' ? [] : undefined);
      };
      define(CookieStore.prototype, name, { ...entry, configurable: false, writable: false, value });
      define(window.cookieStore, name, { configurable: false, writable: false, value });
    }
    const stop = Event.prototype.stopImmediatePropagation;
    apply(EventTarget.prototype.addEventListener, window.cookieStore, ['change', event => {
      if (blocked) apply(stop, event, []);
    }, true]);
  }
})();


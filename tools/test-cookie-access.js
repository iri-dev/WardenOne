/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const auth=require('./lib/wo-auth.js');
const source=fs.readFileSync('cookie-access.js','utf8');
function realm(topFrame=false,late=false,timing=[]){
  const events=new Map(),cookies=new Map([['seed','fixed']]);
  class FakeDocument{}
  Object.defineProperty(FakeDocument.prototype,'cookie',{configurable:true,enumerable:true,
    get(){if(!(this instanceof FakeDocument))throw new TypeError('Illegal invocation');return [...cookies].map(([k,v])=>k+'='+v).join('; ');},
    set(value){const [k,v]=value.split('=');cookies.set(k,v);}});
  class FakeEvent{stopImmediatePropagation(){this.stopped=true;}}
  class FakeTarget{
    addEventListener(type,listener){const list=events.get(type)||[];list.push(listener);events.set(type,list);}
    dispatchEvent(event){for(const fn of events.get(event.type)||[]){fn(event);if(event.stopped)break;}}
  }
  class FakeStore extends FakeTarget{
    async get(name){return cookies.has(name)?{name,value:cookies.get(name)}:null;}
    async getAll(){return [...cookies].map(([name,value])=>({name,value}));}
    async set({name,value}){cookies.set(name,value);}
    async delete(name){cookies.delete(name);}
  }
  const document=new FakeDocument();document.readyState=late?'complete':'loading';
  document.documentElement={getElementsByTagName:()=>[],attributes:[]};document.body=late?{}:null;
  const dispatchDoc=auth.documentEvents(document),listeners=[];
  const window={cookieStore:new FakeStore(),addEventListener(type,fn){if(type==='message')listeners.push(fn);}};
  window.top=topFrame?window:{};
  const context=vm.createContext({window,document,Document:FakeDocument,CookieStore:FakeStore,Event:FakeEvent,EventTarget:FakeTarget,console,
    performance:{getEntriesByType:type=>{assert.equal(type,'navigation');return[{serverTiming:timing}];}}});
  vm.runInContext(source,context);
  const send=data=>listeners.forEach(fn=>fn({source:window,data}));
  const handoff=auth.handshake(dispatchDoc,send);
  return{window,document,FakeDocument,cookies,context,send,handoff};
}
async function workerPolicy(){
  const bg=fs.readFileSync('background.js','utf8');
  const start=bg.indexOf('function frameCookieRuleMatches('),end=bg.indexOf('function trackerCookieResourceTypes(',start);
  assert(start>0&&end>start);
  const rule={id:900007,priority:2000,action:{type:'modifyHeaders'},condition:{requestDomains:['accounts.google.com'],excludedTopDomains:['google.com'],resourceTypes:['sub_frame']}};
  const state={rules:[rule],dynamic:[],reads:0,frameReads:0,fail:false,documentId:'frame-doc'};
  const host=url=>{try{return new URL(url).hostname;}catch(_){return '';}};
  const sandbox=vm.createContext({console,URL,TRACKER_COOKIE_RULE_ID:900007,TRACKER_COOKIE_ALIAS_RULE_BASE:901000,TRACKER_COOKIE_ALIAS_RULES_BUDGET:300,
    FIREWALL_RULE_BASE:950000,FIREWALL_RULE_MAX:250,TRACKER_RULE_BASE:720000,TRACKER_RULE_MAX:1000,USER_RULE_BASE:750000,USER_RULE_MAX:500,
    writeSessionRules:function(){},writeDynamicRules:function(){},registrableDomainBg:h=>h.split('.').slice(-2).join('.'),
    messageSenderIsTab:s=>s?.id==='extension'&&Number.isInteger(s.frameId)&&Number.isInteger(s.tab?.id),contentConfigFrameHost:s=>host(s.origin),trustHostFromUrl:host,
    trackerCookieCompatibility:cfg=>({excludedInitiatorDomains:cfg.exceptions||[]}),hostMatchesSite:(h,d)=>h===d||h.endsWith('.'+d),
    chrome:{declarativeNetRequest:{getSessionRules:async()=>{state.reads++;if(state.fail)throw Error('read failed');return state.rules;},
      getDynamicRules:async filter=>{assert.equal(filter.ruleIds.length,1750);return state.dynamic;}},
      webNavigation:{getFrame:async({frameId})=>{state.frameReads++;return frameId===1?{documentId:state.documentId,parentFrameId:0}:{url:'https://shop.example.org/'};},
        getAllFrames:async()=>[{frameId:0,parentFrameId:-1,url:'https://shop.example.org/'}]}},
  });
  vm.runInContext(bg.slice(start,end)+';this.decide=frameCookieIsolationFor;this.matches=frameCookieRuleMatches;',sandbox);
  const sender={id:'extension',frameId:1,documentId:'frame-doc',origin:'https://accounts.google.com',url:'https://accounts.google.com/gsi/iframe/select',tab:{id:7,url:'https://shop.example.org/'}};
  assert((await Promise.all(Array.from({length:10},()=>sandbox.decide(sender,{})))).every(Boolean));assert.equal(state.reads,1,'concurrent frames share bounded native reads');
  for(const bad of [{...sender,id:'page'}, {...sender,frameId:0},{...sender,documentId:''},{...sender,tab:{id:7,url:'https://accounts.google.com/'}}])assert.equal(await sandbox.decide(bad,{}),false);
  for(const cfg of [{enabled:false},{blockThirdPartyCookies:false},{exceptions:['shop.example.org']}])assert.equal(await sandbox.decide(sender,cfg),false);
  state.documentId='replacement-document';assert.equal(await sandbox.decide(sender,{}),false,'a navigation cannot apply an old frame decision');state.documentId='frame-doc';
  state.dynamic=[{id:950000,priority:97000,action:{type:'allow'},condition:{initiatorDomains:['shop.example.org'],requestDomains:['accounts.google.com'],resourceTypes:['sub_frame'],regexFilter:'url-specific-reader-rule'}}];
  sandbox.writeDynamicRules.revision=1;assert.equal(await sandbox.decide(sender,{}),false,'an ambiguous explicit URL allowance keeps DOM access');
  state.dynamic[0].condition.resourceTypes=['image'];sandbox.writeDynamicRules.revision++;assert.equal(await sandbox.decide(sender,{}),true,'an image allowance does not release frame cookies');
  state.dynamic[0].priority=1999;state.dynamic[0].condition.resourceTypes=['sub_frame'];sandbox.writeDynamicRules.revision++;assert.equal(await sandbox.decide(sender,{}),true,'automatic compatibility allows do not suppress isolation');
  state.dynamic=[{id:750000,priority:97000,action:{type:'allowAllRequests'},condition:{requestDomains:['shop.example.org'],resourceTypes:['main_frame']}}];
  sandbox.writeDynamicRules.revision++;assert.equal(await sandbox.decide(sender,{}),false,'a document allowance applies to its descendant frames');
  state.dynamic=[];sandbox.writeDynamicRules.revision++;
  state.fail=true;sandbox.writeSessionRules.revision=1;assert.equal(await sandbox.decide(sender,{}),false);state.fail=false;assert.equal(await sandbox.decide(sender,{}),true,'failed native reads retry');
  const unknown={...sender,origin:'https://unknown.example.net',url:'https://unknown.example.net/frame'};const before=state.frameReads;
  assert.equal(await sandbox.decide(unknown,{}),false);assert.equal(state.frameReads,before,'unknown hosts need no frame-tree walk');
  for(const condition of [{requestDomains:['other.example']},{excludedRequestDomains:['accounts.google.com']},{excludedTopDomains:['shop.example.org']},{resourceTypes:['image']},{domainType:'firstParty'},{tabIds:[2]},{excludedTabIds:[7]},{responseHeaders:[]}]){
    assert.equal(sandbox.matches({...rule,condition},{host:'accounts.google.com',top:'shop.example.org',initiator:'shop.example.org',url:sender.url,tabId:7}),false,'unsupported or unmatched native condition');
  }
}
async function main(){
  await workerPolicy();
  const marker=[{name:'cookie-policy',description:'restricted',duration:0}];
  const early=realm(false,false,marker);assert.equal(early.document.cookie,'','native-marked frames deny the first inline read');
  early.document.cookie='before=leak';assert(!early.cookies.has('before'));
  assert.equal(await early.window.cookieStore.get('seed'),null,'Cookie Store is isolated before the worker reply');
  early.send({source:'wardenone',kind:'config',token:early.handoff.token,overrides:{frameCookieIsolation:false}});
  assert.equal(early.document.cookie,'','an unsigned reply cannot release the early restriction');
  early.handoff.sendConfig({frameCookieIsolation:false});assert(early.document.cookie.includes('seed=fixed'),'an authenticated exception releases the restriction');
  for(const item of [{name:'other',description:'restricted',duration:0},{name:'cookie-policy',description:'allow',duration:0},{name:'cookie-policy',description:'restricted',duration:1}]){
    assert(realm(false,false,[item]).document.cookie.includes('seed=fixed'),'unknown or malformed timing has no effect');
  }
  assert(realm(true,false,marker).document.cookie.includes('seed=fixed'),'timing cannot restrict a top-level visit');
  assert(realm(false,true,marker).document.cookie.includes('seed=fixed'),'late injection cannot treat old timing as a new decision');
  assert(realm(false,false,marker.concat({name:'extra',description:'isolate',duration:0})).document.cookie.includes('seed=fixed'),'extra server metrics do not qualify as the native bootstrap shape');
  const r=realm();assert(r.document.cookie.includes('seed=fixed'),'unanswered policy fails open');
  r.send({source:'wardenone',kind:'config',token:r.handoff.token,overrides:{frameCookieIsolation:true}});
  assert(r.document.cookie.includes('seed=fixed'),'an unsigned page message has no authority');
  r.handoff.sendConfig({enabled:true,blockThirdPartyCookies:true,frameCookieIsolation:true});
  assert.equal(r.document.cookie,'');
  const getter=Object.getOwnPropertyDescriptor(r.FakeDocument.prototype,'cookie').get;
  assert.equal(getter.call(r.document),'','prototype extraction cannot bypass isolation');
  r.document.cookie='dom=leak';assert(!r.cookies.has('dom'));
  assert.equal(await r.window.cookieStore.get('seed'),null);
  assert.equal((await r.window.cookieStore.getAll()).length,0);
  await r.window.cookieStore.set({name:'api',value:'leak'});assert(!r.cookies.has('api'));
  await r.window.cookieStore.delete('seed');assert(r.cookies.has('seed'));
  let observed=0;r.window.cookieStore.addEventListener('change',()=>observed++);
  r.window.cookieStore.dispatchEvent({type:'change'});assert.equal(observed,0,'cookie change events do not expose values while isolated');
  /* A page may wrap the guard as it could the native accessor; the wrapper still reaches no cookies. */
  const guarded=Object.getOwnPropertyDescriptor(r.FakeDocument.prototype,'cookie');
  assert(guarded.configurable&&guarded.enumerable,'the guard keeps the native descriptor shape');
  assert.equal(Object.getOwnPropertyDescriptor(r.document,'cookie'),undefined,'no own property the native document lacks');
  Object.defineProperty(r.document,'cookie',{configurable:true,get(){return 'wrapped:'+guarded.get.call(this);},set(v){guarded.set.call(this,v);}});
  assert.equal(r.document.cookie,'wrapped:','a page wrapper sees nothing while isolated');
  r.document.cookie='wrap=leak';assert(!r.cookies.has('wrap'));
  delete r.document.cookie;
  const old=auth.configMessage(r.handoff.signer,r.handoff.token,{frameCookieIsolation:false});
  r.handoff.sendConfig({frameCookieIsolation:true});r.send(old);assert.equal(r.document.cookie,'','signed replay cannot reverse a newer decision');
  r.handoff.sendConfig({frameCookieIsolation:false});
  assert(r.document.cookie.includes('seed=fixed'));r.document.cookie='dom=restored';assert.equal(r.cookies.get('dom'),'restored');
  await r.window.cookieStore.set({name:'api',value:'restored'});assert.equal((await r.window.cookieStore.get('api')).value,'restored');
  r.window.cookieStore.dispatchEvent({type:'change'});assert.equal(observed,1);
  for(const patch of [{enabled:false,frameCookieIsolation:true},{enabled:true,blockThirdPartyCookies:false,frameCookieIsolation:true}]){
    r.handoff.sendConfig(patch);assert(r.document.cookie.includes('seed=fixed'),'off/exception restores native reads');
  }
  vm.runInContext(source,r.context);assert(r.document.cookie.includes('seed=fixed'),'a late reinjection only passes through');
  r.handoff.sendConfig({enabled:true,blockThirdPartyCookies:true,frameCookieIsolation:true});
  assert.equal(r.document.cookie,'','and the first guard still isolates beneath it');
  r.handoff.sendConfig({frameCookieIsolation:false});
  {
    /* An embedded app instruments cookies while isolated, then again after protection is switched off. */
    const app=realm(false,false,marker),seen=[];
    const instrument=()=>{
      const base=Object.getOwnPropertyDescriptor(app.FakeDocument.prototype,'cookie');
      Object.defineProperty(app.FakeDocument.prototype,'cookie',{configurable:true,enumerable:true,
        get(){const v=base.get.call(this);seen.push(v);return v;},set(v){seen.push('set '+v);base.set.call(this,v);}});
      const store=app.context.CookieStore.prototype,get=store.get;
      store.get=async function(name){seen.push('store '+name);return get.call(this,name);};
    };
    instrument();
    assert.equal(app.document.cookie,'','the app wrapper installs and reads nothing while isolated');
    assert.equal(await app.window.cookieStore.get('seed'),null);
    assert.deepEqual(seen,['','store seed']);
    app.handoff.sendConfig({enabled:false,frameCookieIsolation:true});
    assert(app.document.cookie.includes('seed=fixed'),'its wrapper sees real cookies once protection is off');
    instrument();
    app.document.cookie='app=1';assert.equal(app.cookies.get('app'),'1','a second wrapper after the toggle writes through');
    assert.equal((await app.window.cookieStore.get('seed')).value,'fixed');
    const shape=Object.getOwnPropertyDescriptor(app.FakeDocument.prototype,'cookie');
    assert(shape.configurable&&shape.enumerable&&shape.get&&shape.set,'the descriptor stays native-shaped across the toggle');
  }
  const top=realm(true);top.handoff.sendConfig({frameCookieIsolation:true});assert(top.document.cookie.includes('seed=fixed'));
  const late=realm(false,true);late.handoff.sendConfig({frameCookieIsolation:true});assert(late.document.cookie.includes('seed=fixed'),'a late public key cannot gain authority');
  console.log('[ok] authenticated frame cookie policy, prototype/Cookie Store guards, events, exceptions and native restoration');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

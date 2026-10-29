/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),{ready:badgerReady}=require('./probe-privacy-badger.js');
const {ghosteryReady}=require('./browser-ghostery-baseline.js');
const {tls}=require('./browser-media-security.js'),{verifyBuild,sha256}=require('./lib/privacy-baseline.js');
const {cleanupProfile}=require('./lib/browser-profile-cleanup.js');
const {evaluate,until,state}=require('./prepare-ghostery-performance.js'),{configurationHash}=require('./lib/ghostery-performance.js');
const {classify,localReplacement}=require('./browser-release-rematch.js');
const PAGE='shop.cookie-review.example.org';
const CASES=Object.freeze([
  {name:'identity-fetch',host:'accounts.google.com',kind:'fetch',requiresCookie:false},
  {name:'payment-script',host:'js.stripe.com',kind:'script',requiresCookie:false},
  {name:'identity-frame',host:'accounts.google.com',kind:'frame',requiresCookie:true},
  {name:'payment-frame',host:'checkout.stripe.com',kind:'frame',requiresCookie:true},
  {name:'identity-public-client',host:'accounts.google.com',path:'/gsi/client',kind:'script',requiresCookie:false},
  {name:'payment-public-client',host:'js.stripe.com',path:'/v3/',kind:'script',requiresCookie:false},
  {name:'payment-telemetry',host:'m.stripe.com',kind:'fetch',requiresCookie:false},
  {name:'spotify-resource',host:'accounts.spotify.com',kind:'fetch',requiresCookie:false},
  {name:'facebook-sdk',host:'connect.facebook.net',path:'/en_US/sdk.js',kind:'script',requiresCookie:false},
  {name:'google-static-resource',host:'www.gstatic.com',path:'/resource.js',kind:'script',requiresCookie:false},
  {name:'identity-state-frame',host:'accounts.google.com',path:'/gsi/iframe/select',kind:'frame',requiresCookie:true},
  {name:'payment-state-frame',host:'js.stripe.com',path:'/v3/elements-inner-fixture.html',kind:'frame',requiresCookie:true},
  {name:'checkout-state-frame',host:'checkout.stripe.com',path:'/c/pay/cs_test_fixture',kind:'frame',requiresCookie:true},
  {name:'unknown-resource',host:'unknown.cookie-review.example.net',kind:'fetch',requiresCookie:true},
  {name:'unknown-frame',host:'unknown.cookie-review.example.net',path:'/frame',kind:'frame',requiresCookie:true},
]);
function responseFor(item,cookie){
  const sent=/(?:^|;\s*)review_session=fixed(?:;|$)/.test(cookie);
  return {sent,usable:!item.requiresCookie||sent};
}
function frameProbe(token,usable,parentOrigin){
  return `const initialCookieReadable=document.cookie.includes('review_session=fixed');
const initialProbe={cookieReadable:initialCookieReadable};
try{initialProbe.prototypeCookieReadable=Reflect.apply(Object.getOwnPropertyDescriptor(Document.prototype,'cookie').get,document,[]).includes('review_session=fixed');document.cookie='review_inline=fixed;SameSite=None;Secure;Path=/';initialProbe.cookieWriteReadable=document.cookie.includes('review_inline=fixed');}catch(e){initialProbe.cookieError=e.name;}
const initialStoreRead=window.cookieStore?cookieStore.get('review_session').then(c=>!!c).catch(e=>e.name):Promise.resolve(null);
const initialStoreWrite=window.cookieStore?cookieStore.set({name:'review_inline_store',value:'fixed',sameSite:'none',path:'/'}).catch(e=>e.name):Promise.resolve(null);
setTimeout(async()=>{
 const probe={initialCookieReadable,initial:initialProbe,initialStoreReadable:await initialStoreRead,cookieReadable:document.cookie.includes('review_session=fixed')};await initialStoreWrite;
 try{probe.prototypeCookieReadable=Reflect.apply(Object.getOwnPropertyDescriptor(Document.prototype,'cookie').get,document,[]).includes('review_session=fixed');}catch(e){probe.prototypeError=e.name;}
 try{document.cookie='review_dom=fixed; SameSite=None; Secure; Path=/';probe.cookieWriteReadable=document.cookie.includes('review_dom=fixed');}catch(e){probe.cookieError=e.name;}
 if(window.cookieStore){try{probe.cookieStoreReadable=!!(await cookieStore.get('review_session'));await cookieStore.set({name:'review_store',value:'fixed',sameSite:'none',path:'/'});probe.cookieStoreWriteReadable=!!(await cookieStore.get('review_store'));}catch(e){probe.cookieStoreError=e.name;}}
 parent.postMessage({token:${JSON.stringify(token)},usable:${JSON.stringify(usable)},probe},${JSON.stringify(parentOrigin)});
},350);`;
}
function fixture(hits){return https.createServer(tls,(req,res)=>{
  const u=new URL(req.url,'https://'+req.headers.host),host=u.hostname;
  res.setHeader('Cache-Control','no-store');
  if(u.searchParams.has('case')){
    const item=CASES.find(c=>c.name===u.searchParams.get('case')&&c.host===host&&(c.path||'/resource')===u.pathname);
    if(!item){res.writeHead(404);res.end();return;}
    const outcome=responseFor(item,req.headers.cookie||'');
    const row={token:u.searchParams.get('token'),name:item.name,host,...outcome};hits.push(row);
    res.setHeader('Set-Cookie','review_new=fixed; SameSite=None; Secure; Path=/');
    if(u.searchParams.get('cache')==='1')res.setHeader('Cache-Control','public,max-age=600');
    if(u.searchParams.get('badTiming')==='1')res.setHeader('Server-Timing','cookie-policy;desc="allow";dur=99, original;dur=2');
    if(u.searchParams.get('redirect')==='unknown'){
      res.writeHead(302,{Location:'https://unknown.cookie-review.example.net:'+req.socket.localPort+'/frame?case=unknown-frame&token='+encodeURIComponent(row.token)});res.end();return;
    }
    res.setHeader('Access-Control-Allow-Origin','https://'+PAGE+':'+req.socket.localPort);
    res.setHeader('Access-Control-Allow-Credentials','true');
    if(item.kind==='script'){res.setHeader('Content-Type','application/javascript');res.end('void 0;');}
    else if(item.kind==='frame'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script>'+frameProbe(row.token,outcome.usable,'https://'+(u.searchParams.get('context')==='first-party'?host:PAGE)+':'+req.socket.localPort)+'</script><p>'+String(outcome.usable)+'</p>');}
    else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({usable:outcome.usable}));}
  }else if(u.pathname==='/top-session'){
    const usable=responseFor({requiresCookie:true},req.headers.cookie||'').usable;
    hits.push({token:u.searchParams.get('token'),name:'top-session',host,usable});
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><p id="result">'+String(usable)+'</p>');
  }else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cookie compatibility review</title>');}
});}
async function trial(build,snapshots,server,hits,repetition){
  if(build.product!=='off')verifyBuild(build);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wo-cookie-review-')),port=await profile.freePort();let cdp,ext;
  const result={build:build.label,repetition,cases:[],complete:false};
  const origin=host=>'https://'+host+':'+server.address().port;
  try{
    if(build.warmedSeed)fs.cpSync(build.warmedSeed.directory,directory,{recursive:true});
    fs.mkdirSync(path.join(directory,'Default'),{recursive:true});
    const preferencesPath=path.join(directory,'Default/Preferences'),preferences=fs.existsSync(preferencesPath)?JSON.parse(fs.readFileSync(preferencesPath)):{};
    preferences.profile={...preferences.profile,cookie_controls_mode:0,block_third_party_cookies:false,default_content_setting_values:{...preferences.profile?.default_content_setting_values,cookies:1}};
    fs.writeFileSync(preferencesPath,JSON.stringify(preferences));
    const resolver=[PAGE,...CASES.map(c=>c.host)].map(h=>'MAP '+h+' 127.0.0.1').concat('MAP * ~NOTFOUND','EXCLUDE 127.0.0.1').join(', ');
    const browser=await profile.launch(snapshots.browserPath,build.product==='off'?'off':'on',build.directory||'',port,directory,
      ['--no-proxy-server','--host-resolver-rules='+resolver,'--ignore-certificate-errors','--disable-features=TrackingProtection3pcd']);
    cdp=new profile.Cdp(browser.webSocketDebuggerUrl);await cdp.connect();result.browser=browser.Browser;
    if(build.product!=='off'){
      ext=build.product==='privacybadger'?await badgerReady(cdp):build.product==='ghostery'?await ghosteryReady(cdp,build):await profile.extensionReady(cdp,port,build.version,undefined,100);
      if(build.product==='wardenone'){
        await until(()=>evaluate(cdp,ext.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'reconciled cookie review');
        await evaluate(cdp,ext.attachedSession,'Promise.all([...__subsystemQueues.values()]).then(()=>true)');
        result.cookiePolicy=await evaluate(cdp,ext.attachedSession,'(async()=>({topDomainMatching:!!chrome.declarativeNetRequest.RuleConditionKeys?.EXCLUDED_TOP_DOMAINS,rules:(await chrome.declarativeNetRequest.getSessionRules()).filter(r=>r.id===TRACKER_COOKIE_RULE_ID||(r.id>=TRACKER_COOKIE_ALIAS_RULE_BASE&&r.id<TRACKER_COOKIE_ALIAS_RULE_BASE+TRACKER_COOKIE_ALIAS_RULES_BUDGET))}))()');
      }
      if(build.warmedSeed){
        result.frozenState=await state(cdp,ext,build.warmedSeed);
        assert.equal(result.frozenState.dataHash,build.warmedSeed.state.dataHash);
        assert.equal(configurationHash(build.product,result.frozenState.config),configurationHash(build.product,build.warmedSeed.state.config));
      }
      await profile.closeExtensionTabs(cdp,port,ext.id);
    }
    const {targetId}=await cdp.send('Target.createTarget',{url:origin(PAGE)+'/'}),s=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
    for(const d of ['Page','Network','Runtime'])await cdp.send(d+'.enable',{},s);
    const requests=new Map();
    cdp.on(event=>{
      if(event.sessionId!==s)return;
      const p=event.params,previous=requests.get(p.requestId);
      if(event.method==='Network.requestWillBeSent')requests.set(p.requestId,{...previous,url:previous?.url||p.request.url,finalUrl:p.request.url,
        redirects:[...(previous?.redirects||[]),...(p.redirectResponse?[{from:p.redirectResponse.url,to:p.request.url,status:p.redirectResponse.status,headers:p.redirectResponse.headers}]:[])]});
      if(event.method==='Network.responseReceived')requests.set(p.requestId,{...previous,finalResponse:{url:p.response.url,status:p.response.status,fromDiskCache:p.response.fromDiskCache,fromServiceWorker:p.response.fromServiceWorker,
        cacheControl:p.response.headers['cache-control']||p.response.headers['Cache-Control'],serverTiming:p.response.headers['server-timing']||p.response.headers['Server-Timing']}});
      if(event.method==='Network.requestServedFromCache')requests.set(p.requestId,{...previous,servedFromCache:true});
      if(event.method==='Network.loadingFailed')requests.set(p.requestId,{...previous,failure:{errorText:p.errorText,blockedReason:p.blockedReason}});
    });
    await until(()=>evaluate(cdp,s,'location.hostname==='+JSON.stringify(PAGE)+'&&document.readyState==="complete"'),'review page');
    const {frameTree}=await cdp.send('Page.getFrameTree',{},s),contextId=(await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'cookie-review'} ,s)).executionContextId;
    const seed=async host=>{
      for(const name of ['review_session','review_new','review_dom','review_store','review_inline','review_inline_store'])await cdp.send('Network.deleteCookies',{name,url:origin(host)+'/'},s);
      assert((await cdp.send('Network.setCookie',{name:'review_session',value:'fixed',url:origin(host)+'/',secure:true,sameSite:'None'},s)).success);
    };
    const observeFrame=(url,token,frameOrigin)=>evaluate(cdp,s,`new Promise(resolve=>{
      const frame=document.createElement('iframe');const receive=e=>{if(e.origin===${JSON.stringify(frameOrigin)}&&e.source===frame.contentWindow&&e.data?.token===${JSON.stringify(token)}){removeEventListener('message',receive);resolve(e.data);}};
      addEventListener('message',receive);frame.src=${JSON.stringify(url)};document.body.append(frame);setTimeout(()=>{removeEventListener('message',receive);resolve({error:'timeout'});},8000);
    })`);
    for(const item of CASES){
      await seed(item.host);const token=build.label+'-'+repetition+'-'+item.name,url=origin(item.host)+(item.path||'/resource')+'?case='+item.name+'&token='+token;
      const expression=item.kind==='fetch'?`fetch(${JSON.stringify(url)},{credentials:'include',signal:AbortSignal.timeout(8000)}).then(r=>r.json()).catch(e=>({usable:false,error:String(e)}))`:
        item.kind==='script'?`new Promise(resolve=>{const script=document.createElement('script');script.onload=()=>resolve({usable:true});script.onerror=()=>resolve({usable:false});script.src=${JSON.stringify(url)};document.head.append(script);setTimeout(()=>resolve({error:'timeout'}),8000);})`:
        `new Promise(resolve=>{const receive=e=>{if(e.origin===${JSON.stringify(origin(item.host))}&&e.source===frame.contentWindow&&e.data?.token===${JSON.stringify(token)}){removeEventListener('message',receive);resolve({usable:e.data.usable,probe:e.data.probe});}};const frame=document.createElement('iframe');addEventListener('message',receive);frame.src=${JSON.stringify(url)};document.body.append(frame);setTimeout(()=>{removeEventListener('message',receive);resolve({error:'timeout'});},8000);})`;
      const observed=await cdp.send('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true},s);
      if(observed.exceptionDetails)throw Error(observed.exceptionDetails.text);
      const receipt=hits.find(h=>h.token===token),cookies=(await cdp.send('Network.getCookies',{urls:[origin(item.host)+'/']},s)).cookies;
      const network=[...requests.values()].find(r=>r.url===url)||null;
      let replacement=localReplacement(network,ext?.id);
      if(replacement){
        const file=path.resolve(build.directory,'.'+replacement.path),relative=path.relative(build.directory,file);
        if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(file)||!fs.statSync(file).isFile())replacement=null;
        else replacement.sha256=sha256(fs.readFileSync(file));
      }
      const stored=cookies.some(c=>c.name==='review_new');
      const row={...item,receipt:receipt||null,network,replacement,requestStatus:classify({received:!!receipt,failure:network?.failure,oldCookieSent:receipt?.sent,newCookieStored:stored,replacement}),observed:observed.result.value,stored};
      if(item.kind==='frame')row.domStored={cookie:cookies.some(c=>c.name==='review_dom'),cookieStore:cookies.some(c=>c.name==='review_store'),inlineCookie:cookies.some(c=>c.name==='review_inline'),inlineCookieStore:cookies.some(c=>c.name==='review_inline_store')};
      assert.notEqual(row.requestStatus,'error','a missing resource requires native block or local-replacement evidence');
      if(receipt)assert.equal(row.observed.usable,receipt.usable,'page and server must agree about the operation');
      result.cases.push(row);
    }
    result.topLevel=[];
    if(build.product==='wardenone'){
      const tabId=await evaluate(cdp,ext.attachedSession,'chrome.tabs.query({}).then(t=>t.find(x=>x.url.startsWith('+JSON.stringify(origin(PAGE)) +')).id)');
      const inspect=()=>evaluate(cdp,ext.attachedSession,`(async()=>{
        const frames=(await chrome.webNavigation.getAllFrames({tabId:${tabId}})).filter(f=>f.frameId!==0&&${JSON.stringify(CASES.filter(c=>c.kind==='frame'&&c.name!=='unknown-frame').map(c=>c.host))}.includes(new URL(f.url).hostname));
        return Promise.all(frames.map(async f=>({host:new URL(f.url).hostname,...(await chrome.scripting.executeScript({target:{tabId:${tabId},documentIds:[f.documentId]},world:'MAIN',func:async()=>{
          const read=document.cookie.includes('review_session=fixed');document.cookie='review_recovery=fixed;SameSite=None;Secure;Path=/';
          return{read,write:document.cookie.includes('review_recovery=fixed'),prototypeRead:Reflect.apply(Object.getOwnPropertyDescriptor(Document.prototype,'cookie').get,document,[]).includes('review_session=fixed'),storeRead:window.cookieStore?!!(await cookieStore.get('review_session')):null};
        }}))[0].result})));
      })()`);
      result.domRecovery=[];
      for(const [name,patch,readable]of [
        ['cookie-off',{blockThirdPartyCookies:false},true],['cookie-on',{blockThirdPartyCookies:true},false],
        ['site-exception',{siteOverrides:{[PAGE]:{blockThirdPartyCookies:false}}},true],['site-policy-restored',{siteOverrides:{}},false],
        ['site-pause',{allowlist:[PAGE]},true],['site-resumed',{allowlist:[]},false],
        ['master-off',{enabled:false},true],['master-on',{enabled:true},false],
      ]){
        await evaluate(cdp,ext.attachedSession,'updateStoredConfig(c=>Object.assign(c,'+JSON.stringify(patch)+')).then(()=>true)');
        await until(()=>evaluate(cdp,ext.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'DOM recovery native policy');
        let rows;await until(async()=>{rows=await inspect();return rows.length===5&&rows.every(r=>r.read===readable&&r.prototypeRead===readable&&(r.storeRead===null||r.storeRead===readable));},'DOM recovery '+name);
        result.domRecovery.push({name,readable,frames:rows});
      }
      for(const allowed of [true,false]){
        const change={removeRuleIds:[950000],addRules:allowed?[{id:950000,priority:97001,action:{type:'allow'},condition:{requestDomains:['accounts.google.com'],initiatorDomains:[PAGE],resourceTypes:['sub_frame']}}]:[]};
        await evaluate(cdp,ext.attachedSession,'writeDynamicRules('+JSON.stringify(change)+').then(()=>true)');
        let rows;await until(async()=>{rows=await inspect();return rows.length===5&&rows.every(r=>r.read===(allowed&&r.host==='accounts.google.com'));},'DOM firewall '+allowed);
        result.domRecovery.push({name:allowed?'firewall-allow':'firewall-revoke',frames:rows});
      }
      result.freshDocuments=[];
      for(const [name,patch,readable]of [
        ['site-exception-first-script',{siteOverrides:{[PAGE]:{blockThirdPartyCookies:false}}},true],
        ['cookie-off-first-script',{blockThirdPartyCookies:false},true],['master-off-first-script',{enabled:false},true],
        ['protected-first-script',{},false],['server-timing-overwrite',{},false],
        ['cache-protected',{},false],['cache-cookie-off',{blockThirdPartyCookies:false},true],['cache-protection-restored',{},false],
        ['redirect-to-unknown',{},true],['cold-worker-first-script',{},false],
      ]){
        await evaluate(cdp,ext.attachedSession,'updateStoredConfig(c=>Object.assign(c,{enabled:true,blockThirdPartyCookies:true,siteOverrides:{},allowlist:[]},'+JSON.stringify(patch)+')).then(()=>true)');
        await until(()=>evaluate(cdp,ext.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'fresh document policy '+name);
        await seed('accounts.google.com');if(name==='redirect-to-unknown')await seed('unknown.cookie-review.example.net');
        const token=build.label+'-'+repetition+'-'+(name.startsWith('cache-')?'cache-shared':name);
        const url=origin('accounts.google.com')+'/gsi/iframe/select?case=identity-state-frame&token='+token
          +(name.startsWith('cache-')?'&cache=1':'')+(name==='server-timing-overwrite'?'&badTiming=1':'')+(name==='redirect-to-unknown'?'&redirect=unknown':'');
        const target=name==='redirect-to-unknown'?'unknown.cookie-review.example.net':'accounts.google.com';
        if(name==='cold-worker-first-script'){
          result.coldWorker={before:ext.workerTargetId};
          const monitor=(await cdp.send('Target.createTarget',{url:'chrome-extension://'+ext.id+'/permissions.html'})).targetId;
          const monitorSession=(await cdp.send('Target.attachToTarget',{targetId:monitor,flatten:true})).sessionId;
          const versions=new Map();let stopped=false;
          const offVersions=cdp.on(event=>{if(event.method==='ServiceWorker.workerVersionUpdated')for(const version of event.params.versions){versions.set(version.versionId,version);if(version.scriptURL==='chrome-extension://'+ext.id+'/background.js'&&version.runningStatus==='stopped')stopped=true;}});
          try{
            await cdp.send('ServiceWorker.enable',{},monitorSession);
            await until(()=>[...versions.values()].some(v=>v.scriptURL==='chrome-extension://'+ext.id+'/background.js'&&v.runningStatus==='running'),'worker version');
            const running=[...versions.values()].find(v=>v.scriptURL==='chrome-extension://'+ext.id+'/background.js'&&v.runningStatus==='running');
            await evaluate(cdp,ext.attachedSession,'globalThis.__earlyCookieRealmSentinel=true');
            await cdp.send('ServiceWorker.stopWorker',{versionId:running.versionId},monitorSession);
            await until(()=>stopped,'worker stopped');result.coldWorker.stopped=true;
          }finally{offVersions();await cdp.send('Target.closeTarget',{targetId:monitor});}
        }
        const observed=await observeFrame(url,token,origin(target));
        assert.equal(observed.probe?.initialCookieReadable,readable,name+': first inline cookie read');
        assert.equal(observed.probe?.initial.prototypeCookieReadable,readable,name+': first inline prototype read');
        if(observed.probe.initialStoreReadable!==null)assert.equal(observed.probe.initialStoreReadable,readable,name+': first inline Cookie Store read');
        result.freshDocuments.push({name,readable,observed,network:[...requests.values()].filter(r=>r.url===url).at(-1)});
        if(name==='cold-worker-first-script'){
          ext=await profile.extensionReady(cdp,port,build.version,undefined,100);result.coldWorker.after=ext.workerTargetId;
          result.coldWorker.freshRealm=await evaluate(cdp,ext.attachedSession,'typeof globalThis.__earlyCookieRealmSentinel==="undefined"');
          assert(result.coldWorker.freshRealm,'the replacement must use a fresh worker realm');
          await until(()=>evaluate(cdp,ext.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'replacement worker policy');
          result.coldWorker.fixtureQuarantine=await evaluate(cdp,ext.attachedSession,'chrome.storage.local.get("wardenone_config").then(s=>s.wardenone_config.rebindQuarantine||[])');
          assert(result.coldWorker.fixtureQuarantine.every(h=>CASES.some(c=>c.host===h)),'only fixture-mapped hosts may be reset');
          /* Forced worker eviction loses the local top-frame IP context; the mapped service
             response can correctly trigger DNS quarantine. Reset only this disposable fixture. */
          await evaluate(cdp,ext.attachedSession,'clearRebindQuarantine().then(()=>true)');
          await cdp.send('Page.navigate',{url:origin(PAGE)+'/'},s);
          await until(()=>evaluate(cdp,s,'location.hostname==='+JSON.stringify(PAGE)+'&&document.readyState==="complete"'),'local fixture context restored');
        }
      }
    }
    result.firstPartyFrames=[];
    for(const host of ['accounts.google.com','checkout.stripe.com']){
      await seed(host);const token=build.label+'-'+repetition+'-top-'+host;
      const navigation=await cdp.send('Page.navigate',{url:origin(host)+'/top-session?token='+token},s);
      if(navigation.errorText){
        const matched=build.product==='wardenone'?await evaluate(cdp,ext.attachedSession,'(async()=>({matched:(await chrome.declarativeNetRequest.getMatchedRules({})).rulesMatchedInfo.slice(-12),quarantine:(await chrome.storage.local.get("wardenone_config")).wardenone_config.rebindQuarantine}))()').catch(()=>null):null;
        throw Error('First-party navigation: '+navigation.errorText+' '+JSON.stringify(matched));
      }
      await until(()=>evaluate(cdp,s,'document.getElementById("result")?.textContent==="true"'),'first-party session').catch(async error=>{
        const state=await evaluate(cdp,s,'({host:location.hostname,title:document.title,result:document.getElementById("result")?.textContent})');
        throw Error(error.message+': '+JSON.stringify({state,receipt:hits.find(h=>h.token===token)}));
      });
      assert(hits.find(h=>h.token===token)?.usable);result.topLevel.push({host,usable:true});
      const item=CASES.find(c=>c.name===(host==='accounts.google.com'?'identity-state-frame':'checkout-state-frame'));
      const frameToken=token+'-same-party',url=origin(host)+item.path+'?case='+item.name+'&token='+frameToken+'&context=first-party';
      const frame=await observeFrame(url,frameToken,origin(host));
      assert.equal(frame.probe?.initialCookieReadable,true,'first-party inline session stays available');
      result.firstPartyFrames.push({host,observed:frame});
    }
    if(build.product==='off')assert(result.cases.every(c=>c.receipt?.sent&&c.stored&&c.observed.usable),'browser cookie policy must not confound the comparison');
    result.complete=true;return result;
  }finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}cleanupProfile(directory,'wo-cookie-review-');}
}
async function main(){
  const [snapshotFile,out,runsArg='3']=process.argv.slice(2);
  if(!snapshotFile||!out||!/^([1-5])$/.test(runsArg)||fs.existsSync(out))throw Error('Use snapshots.json new-report.json [1..5]');
  const snapshots=JSON.parse(fs.readFileSync(snapshotFile));assert.equal(sha256(fs.readFileSync(snapshots.browserPath)),snapshots.browserSha256);
  const labels=['candidate','privacybadger',...(snapshots.builds.some(b=>b.label==='ghostery')?['ghostery']:[])];
  const builds=[{label:'off',product:'off'},...labels.map(label=>snapshots.builds.find(b=>b.label===label))];assert(builds.every(Boolean));
  const hits=[],server=fixture(hits);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const report={createdAt:new Date().toISOString(),snapshotFile,snapshots,harnessSha256:sha256(fs.readFileSync(__filename)),cases:CASES,results:[],complete:false,
    limitations:['Loopback fixture bodies are synthetic and do not execute Google or Stripe code.','A cookie requirement is deliberately part of the frame contract; failure demonstrates the cost of stripping, not a real-service breakage.','Nonessential resource fixtures have no cookie dependency; cookie preservation there is privacy exposure in this corpus.','Native blocks and local replacements are recorded separately from cookie stripping. DOM coverage is limited to the explicitly recorded APIs.','The forced-worker case can quarantine service hosts mapped to loopback after losing the local top-frame context; that fixture state is recorded and reset before separate first-party checks.','Local TLS cache attempts do not establish a cache hit; inspect native cache evidence separately.']};
  const save=()=>{fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');};
  try{for(let n=0;n<Number(runsArg);n++)for(const build of n%2?[...builds].reverse():builds){const row=await trial(build,snapshots,server,hits,n);report.results.push(row);save();console.log(build.label+' '+n+': '+row.cases.map(c=>c.name+'='+c.requestStatus+' cookies='+(c.receipt?.sent??'not-delivered')+'/'+c.stored+' usable='+c.observed?.usable).join(', '));}report.complete=true;}
  finally{save();await new Promise(r=>server.close(r));}
}
module.exports={CASES,responseFor,frameProbe,fixture};
if(require.main===module)profile.mustFinish(main,'cookie compatibility review').catch(e=>{console.error(e);process.exitCode=1;});

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const {ready: badgerReady} = require('./probe-privacy-badger.js');
const {ghosteryReady} = require('./browser-ghostery-baseline.js');
const {state: performanceState} = require('./prepare-ghostery-performance.js');
const {configurationHash} = require('./lib/ghostery-performance.js');
const {tls} = require('./browser-media-security.js');
const {cleanupProfile} = require('./lib/browser-profile-cleanup.js');
const {verifyBuild, sha256} = require('./lib/privacy-baseline.js');
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'www.consobaby.co.uk';
const CORPUS = Object.freeze([
  {name:'analytics', host:'google-analytics.com', kind:'fetch', role:'tracker'},
  {name:'advertising', host:'doubleclick.net', kind:'fetch', role:'tracker'},
  {name:'shared-known-cname', host:'0sbm.consobaby.co.uk', kind:'fetch', role:'tracker'},
  {name:'fingerprint-library', host:'api.fpjs.io', kind:'script', role:'tracker'},
  {name:'unknown-alias', host:'unlisted.consobaby.co.uk', kind:'fetch', role:'control'},
  {name:'same-site-api', host:'api.consobaby.co.uk', kind:'fetch', role:'control'},
  {name:'unknown-third-party', host:'tracker.wardenone-rematch.example.net', kind:'fetch', role:'control'},
  {name:'authentication', host:'accounts.google.com', kind:'fetch', role:'control'},
  {name:'payment', host:'js.stripe.com', kind:'script', role:'control'},
  {name:'ordinary-script', host:'static.consobaby.co.uk', kind:'script', role:'control'},
]);
const ACCEPTANCE = Object.freeze({
  requests:'All tracker cases and no control failures in every repetition; compare tracker requests blocked before server receipt. Any unexplained request failure invalidates the round.',
  cookies:'All tracker cases and no control failures in every repetition; count delivered requests with outgoing or incoming cookies removed separately from blocked requests.',
  detection:'Browser-owned tracker evidence only. Unavailable attribution is unscored, never inferred from an absent request.',
  compatibility:'Every editor, controlled OAuth GET, SAML POST and media playback check passes in every repetition; these are fixtures, not real account logins.',
  performance:'Five alternating fresh profiles; candidate medians must fit the pinned reference-relative budget. Browser CPU and JS heaps are separate; no total RAM claim.',
  recovery:'Forced worker termination replaces private heap and preserves installed dynamic/session rules, then a request repeats successfully under the same policy.',
  privilegedMessages:'No winner without a demonstrated page-reachable privileged exploit under the same threat model. Source review or isolated-world API access alone is insufficient.',
  sourceQuality:'Unscored unless matching development source and packaged build provenance exist for both products.',
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression, contextId) {
  const r = await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,...(contextId?{contextId}:{})},session);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(fn, name, timeout=30000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {if(await fn())return;await sleep(100);}
  throw Error('Timed out: '+name);
}
function classify({received, failure, oldCookieSent, newCookieStored, replacement}) {
  if (!received) return replacement ? 'replaced' : failure?.errorText === 'net::ERR_BLOCKED_BY_CLIENT' ? 'blocked' : 'error';
  return !oldCookieSent || !newCookieStored ? 'stripped' : 'allowed';
}
function localReplacement(network,extensionId) {
  try{
    if(!/^[a-p]{32}$/.test(extensionId||'')||!network?.redirects?.length||network.redirects.length>8)return null;
    const final=new URL(network.finalUrl),response=network.finalResponse,first=network.redirects[0];
    if(final.protocol!=='chrome-extension:'||final.hostname!==extensionId||response?.url!==final.href||response.status!==200)return null;
    const reason=Object.entries(first.headers||{}).find(([k])=>k.toLowerCase()==='non-authoritative-reason')?.[1];
    if(first.from!==network.url||first.status!==307||reason!=='WebRequest API'||!/^https?:\/\//.test(first.from))return null;
    let previous=network.url;
    for(const hop of network.redirects){const to=new URL(hop.to);if(hop.from!==previous||to.protocol!=='chrome-extension:'||to.pathname!==final.pathname)return null;previous=hop.to;}
    if(previous!==final.href)return null;
    return {extensionId,path:decodeURIComponent(final.pathname)};
  }catch{return null;}
}
function fixture(hits) {
  return https.createServer(tls,(req,res)=>{
    const host=String(req.headers.host).split(':')[0], url=new URL(req.url,'https://'+host);
    const origin='https://'+PAGE+':'+req.socket.localPort;
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/probe') {
      hits.push({token:url.searchParams.get('token'),host,cookie:req.headers.cookie||''});
      res.setHeader('Set-Cookie','rematch_new=fixed; SameSite=None; Secure; Path=/');
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');
      res.setHeader('Content-Type',url.searchParams.get('script')?'application/javascript':'text/plain');
      res.end(url.searchParams.get('script')?'void 0;':'fixture');
    } else if(url.pathname==='/start') {
      if(url.searchParams.get('kind')==='oauth') {res.writeHead(302,{Location:origin+'/callback?kind=oauth&state=fixed'});res.end();}
      else {res.setHeader('Content-Type','text/html');res.end('<form method="post" action="'+origin+'/callback?kind=saml"><input name="SAMLResponse" value="fixture"><input name="RelayState" value="fixed"></form><script>document.forms[0].submit()</script>');}
    } else if(url.pathname==='/callback') {
      let body='';req.on('data',b=>{body+=b;});req.on('end',()=>{
        const kind=url.searchParams.get('kind'), ok=kind==='oauth'?url.searchParams.get('state')==='fixed':req.method==='POST'&&body==='SAMLResponse=fixture&RelayState=fixed';
        hits.push({flow:kind,method:req.method,ok});res.setHeader('Content-Type','text/html');res.end('<title>Login callback</title><p id="result">'+(ok?'LOGIN_OK:':'LOGIN_FAILED:')+kind+'</p>');
      });
    } else if(url.pathname==='/media.mp4') {res.setHeader('Content-Type','video/mp4');res.end(fs.readFileSync(path.join(ROOT,'spotify-silent-1s.mp4')));}
    else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Release rematch fixture</title><input id="editor" value="editable"><div id="rich" contenteditable>draft</div><video id="player" muted loop playsinline src="/media.mp4"></video>');}
  });
}
async function runOne(build, repetition, snapshots, server, hits, recovery) {
  if(build.product!=='off')verifyBuild(build);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-release-rematch-')),port=await profile.freePort();
  if(build.warmedSeed)fs.cpSync(build.warmedSeed.directory,dir,{recursive:true});
  fs.mkdirSync(path.join(dir,'Default'),{recursive:true});
  const preferencesPath=path.join(dir,'Default/Preferences'),preferences=fs.existsSync(preferencesPath)?JSON.parse(fs.readFileSync(preferencesPath)):{};
  preferences.profile={...preferences.profile,cookie_controls_mode:0,block_third_party_cookies:false,default_content_setting_values:{...preferences.profile?.default_content_setting_values,cookies:1}};
  fs.writeFileSync(preferencesPath,JSON.stringify(preferences));
  const result={build:build.label,repetition,scenarios:[],compatibility:{},complete:false};
  const origin=host=>'https://'+host+':'+server.address().port;
  const resolver=[PAGE,...CORPUS.map(c=>c.host)].map(host=>'MAP '+host+' 127.0.0.1').concat('MAP * ~NOTFOUND','EXCLUDE 127.0.0.1').join(', ');
  let cdp,ext;
  const started=Date.now();
  try {
    const browser=await profile.launch(snapshots.browserPath,build.product==='off'?'off':'on',build.directory||'',port,dir,[
      '--host-resolver-rules='+resolver,'--ignore-certificate-errors','--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,TrackingProtection3pcd']);
    cdp=new profile.Cdp(browser.webSocketDebuggerUrl);await cdp.connect();result.browser=browser.Browser;
    result.startupStages={browserEndpointMs:Date.now()-started};
    const worker=expression=>evaluate(cdp,ext.attachedSession,expression);
    const getReady=()=>build.product==='privacybadger'?badgerReady(cdp):build.product==='ghostery'?ghosteryReady(cdp,build):profile.extensionReady(cdp,port,build.version,undefined,100);
    if(build.product!=='off') {
      ext=await getReady();result.startupStages.workerAttachedMs=Date.now()-started;
      await profile.closeExtensionTabs(cdp,port,ext.id);result.startupStages.extensionTabsClosedMs=Date.now()-started;
      if(build.product==='wardenone') {
        await until(()=>worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'reconcile');
        result.startupStages.reconciledMs=Date.now()-started;
        await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
        result.defaults=await worker('({antiFingerprintNoise:DEFAULT_CONFIG.antiFingerprintNoise,blockCnameTrackers:DEFAULT_CONFIG.blockCnameTrackers})');
      } else if(build.product==='privacybadger') {
        await until(()=>worker('chrome.declarativeNetRequest.getDynamicRules().then(r=>r.length>0)'),'Badger rules');
        result.defaults=await worker('badger.getSettings().getItemClones()');
      } else {
        assert(build.warmedSeed,'Ghostery requires a warmed, pinned filter profile');
        result.defaults=ext.options;
      }
      if(build.warmedSeed){
        result.frozenState=await performanceState(cdp,ext,build.warmedSeed);
        assert.equal(result.frozenState.dataHash,build.warmedSeed.state.dataHash,'warmed filter payloads');
        assert.equal(configurationHash(build.product,result.frozenState.config),configurationHash(build.product,build.warmedSeed.state.config),'warmed protection settings');
        await profile.closeExtensionTabs(cdp,port,ext.id);
      }
    }
    const cpu=async()=>{const p=(await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser');if(!p)throw Error('Browser CPU unavailable');return p.cpuTime*1000;};
    result.startupWallMs=Date.now()-started;result.browserCpuAtReadyMs=await cpu();
    const attach=async url=>{
      const {targetId}=await cdp.send('Target.createTarget',{url});const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
      for(const domain of ['Runtime','Page','Network'])await cdp.send(domain+'.enable',{},sessionId);
      await until(()=>evaluate(cdp,sessionId,'location.href==='+JSON.stringify(url)+'&&document.readyState==="complete"'),'page ready');
      return {targetId,sessionId};
    };
    const page=await attach(origin(PAGE)+'/');
    const browserTabId=ext?await worker('chrome.tabs.query({}).then(t=>t.find(t=>t.url==='+JSON.stringify(origin(PAGE)+'/')+')?.id)'):null;
    if(ext)assert(Number.isInteger(browserTabId),'browser-owned tab attribution');
    if(build.product==='wardenone')await until(()=>evaluate(cdp,page.sessionId,'window.__wardenOneReadyVersion==='+JSON.stringify(build.version)),'page engine');
    const {frameTree}=await cdp.send('Page.getFrameTree',{},page.sessionId);
    const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'release-network'},page.sessionId);
    const requests=new Map();
    const stop=cdp.on(m=>{
      if(m.sessionId!==page.sessionId)return;const p=m.params;
      if(m.method==='Network.requestWillBeSent'){
        const previous=requests.get(p.requestId);
        requests.set(p.requestId,{...previous,url:previous?.url||p.request.url,finalUrl:p.request.url,
          redirects:[...(previous?.redirects||[]),...(p.redirectResponse?[{from:p.redirectResponse.url,to:p.request.url,status:p.redirectResponse.status,headers:p.redirectResponse.headers}]:[])]});
      }
      if(m.method==='Network.responseReceived')requests.set(p.requestId,{...requests.get(p.requestId),finalResponse:{url:p.response.url,status:p.response.status}});
      if(m.method==='Network.loadingFailed')requests.set(p.requestId,{...requests.get(p.requestId),failure:{errorText:p.errorText,blockedReason:p.blockedReason}});
      if(m.method==='Network.requestWillBeSentExtraInfo')requests.set(p.requestId,{...requests.get(p.requestId),cookieBlockedReasons:p.associatedCookies.filter(c=>c.cookie.name==='rematch_old').flatMap(c=>c.blockedReasons)});
    });
    const request=async(item,suffix='')=>{
      const token=build.label+'-'+repetition+'-'+item.name+suffix,url=origin(item.host)+'/probe?token='+token+(item.kind==='script'?'&script=1':'');
      await cdp.send('Network.deleteCookies',{name:'rematch_new',url:origin(item.host)+'/'},page.sessionId);
      const seeded=await cdp.send('Network.setCookie',{name:'rematch_old',value:'fixed',url:origin(item.host)+'/',secure:true,sameSite:'None'},page.sessionId);assert(seeded.success);
      const expression=item.kind==='script'?`new Promise(resolve=>{const s=document.createElement('script');s.src=${JSON.stringify(url)};s.onload=()=>resolve('loaded');s.onerror=()=>resolve('failed');document.head.append(s);setTimeout(()=>resolve('timeout'),8000);})`:
        `(async()=>{try{const r=await fetch(${JSON.stringify(url)},{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(8000)});return r.status;}catch(e){return String(e);}})()`;
      const start=Date.now(),before=await cpu(),response=await evaluate(cdp,page.sessionId,expression,executionContextId);await sleep(50);
      const received=hits.find(h=>h.token===token),network=[...requests.values()].find(r=>r.url===url);
      const cookies=(await cdp.send('Network.getCookies',{urls:[origin(item.host)+'/']},page.sessionId)).cookies;
      const oldCookieSent=!!received?.cookie.includes('rematch_old=fixed'),newCookieStored=cookies.some(c=>c.name==='rematch_new'&&c.value==='fixed');
      let replacement=localReplacement(network,ext?.id);
      if(replacement){
        const file=path.resolve(build.directory,'.'+replacement.path),relative=path.relative(build.directory,file);
        if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(file)||!fs.statSync(file).isFile())replacement=null;
        else replacement.sha256=sha256(fs.readFileSync(file));
      }
      let detection=null;
      if(build.product==='privacybadger')detection=await worker(`({action:badger.storage.getBestAction(${JSON.stringify(item.host)}),tabs:badger.tabData.getTrackers(${browserTabId})})`);
      return {...item,status:classify({received:!!received,failure:network?.failure,oldCookieSent,newCookieStored,replacement}),replacement,received:!!received,
        oldCookieSent,newCookieStored,network:network||null,response,detection,latencyMs:Date.now()-start,browserCpuMs:(await cpu())-before};
    };
    for(const item of CORPUS)result.scenarios.push(await request(item));
    result.compatibility.editor=await evaluate(cdp,page.sessionId,`(()=>{const e=document.getElementById('editor');e.value='edited';e.setSelectionRange(1,3);const r=document.getElementById('rich');r.textContent='rich edit';return e.value==='edited'&&e.selectionStart===1&&e.selectionEnd===3&&r.textContent==='rich edit';})()`);
    result.compatibility.media=await evaluate(cdp,page.sessionId,`(async()=>{const v=document.getElementById('player');try{await v.play();const t=v.currentTime;await new Promise(r=>setTimeout(r,300));return !v.paused&&v.currentTime!==t&&v.readyState>=2;}catch(e){return String(e);}})()`);
    for(const kind of ['oauth','saml']) {
      const login=await attach(origin(PAGE)+'/login-'+kind);
      await cdp.send('Page.navigate',{url:origin('accounts.google.com')+'/start?kind='+kind},login.sessionId);
      try {await until(()=>evaluate(cdp,login.sessionId,'document.getElementById("result")?.textContent==='+JSON.stringify('LOGIN_OK:'+kind)),kind+' callback',10000);result.compatibility[kind]=true;}
      catch(error){result.compatibility[kind]=error.message;}
      await cdp.send('Target.closeTarget',{targetId:login.targetId});
    }
    if(build.product==='wardenone') {
      const warmStarted=Date.now();await worker('getCosmeticMem().then(()=>true)');
      result.cosmeticWarmWallMs=Date.now()-warmStarted;
    }
    await cdp.send('HeapProfiler.collectGarbage',{},page.sessionId);
    result.rendererHeapBytes=(await cdp.send('Runtime.getHeapUsage',{},page.sessionId)).usedSize;
    if(ext){await cdp.send('HeapProfiler.collectGarbage',{},ext.attachedSession);result.workerHeapBytes=(await cdp.send('Runtime.getHeapUsage',{},ext.attachedSession)).usedSize;}
    if(ext&&recovery) {
      const ui=await attach('chrome-extension://'+ext.id+'/'+(build.product==='privacybadger'?'skin/options.html':build.product==='ghostery'?'pages/settings/index.html':'settings.html'));
      const rules=()=>evaluate(cdp,ui.sessionId,'Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules()])');
      const beforeRules=await rules(),versions=new Map();
      const unlisten=cdp.on(m=>{if(m.method==='ServiceWorker.workerVersionUpdated')for(const v of m.params.versions)versions.set(v.versionId,v);});
      await cdp.send('ServiceWorker.enable',{},ui.sessionId);
      const workerUrl='chrome-extension://'+ext.id+'/'+(build.product==='privacybadger'?'js/background.js':build.product==='ghostery'?build.background.service_worker:'background.js');
      await until(()=>[...versions.values()].some(v=>v.scriptURL===workerUrl&&v.runningStatus==='running'),'worker version');
      await worker('globalThis.__releaseSentinel=true;true');
      const old=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===workerUrl)?.targetId;assert(old);
      await cdp.send('ServiceWorker.stopWorker',{versionId:[...versions.values()].find(v=>v.scriptURL===workerUrl&&v.runningStatus==='running').versionId},ui.sessionId);
      await until(async()=>!(await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===old),'worker stop');
      assert.deepEqual(await rules(),beforeRules);
      await evaluate(cdp,ui.sessionId,'chrome.runtime.sendMessage('+JSON.stringify(build.product==='privacybadger'?{type:'getOptionsData'}:build.product==='ghostery'?{action:'keepAlive'}:{kind:'release-rematch-wake'})+').then(()=>true,()=>true)');
      ext=await getReady();assert.equal(await worker('typeof globalThis.__releaseSentinel'),'undefined');
      if(build.product==='wardenone'){await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');}
      else if(build.product==='privacybadger')await until(()=>worker('badger.INITIALIZED'),'Badger restarted');
      assert.deepEqual(await rules(),beforeRules);
      const replay=await request(CORPUS[0],'-restart');assert.equal(replay.status,result.scenarios[0].status);
      result.recovery={privateHeapReplaced:true,rulesSurvived:true,requestStatusPreserved:true};unlisten();
    }
    stop();result.complete=true;
    if(build.product==='off')for(const r of result.scenarios)assert(r.status==='allowed'&&r.oldCookieSent&&r.newCookieStored,'negative control failed: '+JSON.stringify(r));
    return result;
  } finally {
    if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}cleanupProfile(dir,'wo-release-rematch-');
  }
}
async function run() {
  const [snapshotFile,out,runsArg='5',buildsArg='off,reference,candidate,privacybadger']=process.argv.slice(2);
  if(!snapshotFile||!out||!/^[1-5]$/.test(runsArg))throw Error('Usage: browser-release-rematch.js snapshots.json new-report.json [1..5] [builds]');
  if(fs.existsSync(out))throw Error('Preserve existing report');
  const snapshots=JSON.parse(fs.readFileSync(snapshotFile)),labels=buildsArg.split(',');
  if(sha256(fs.readFileSync(snapshots.browserPath))!==snapshots.browserSha256)throw Error('Browser identity changed');
  const builds=labels.map(label=>label==='off'?{label,product:'off'}:snapshots.builds.find(b=>b.label===label));
  if(builds.some(b=>!b))throw Error('Unknown build');
  const hits=[],server=fixture(hits);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const report={date:new Date().toISOString(),snapshotFile,snapshots,corpus:CORPUS,acceptance:ACCEPTANCE,runs:[],complete:false,
    harnessSha256:sha256(fs.readFileSync(__filename)),performancePolicySha256:sha256(fs.readFileSync(path.join(__dirname,'check-release-performance.js'))),
    mediaSha256:sha256(fs.readFileSync(path.join(ROOT,'spotify-silent-1s.mp4'))),
    measurementProtocol:2,workerHeapState:'WardenOne packaged cosmetic cache explicitly warmed before GC; worker readiness polled every 100ms for both products.',
    limitations:['Offline loopback TLS with fixed host mapping, not live DNS CNAME resolution or real vendor script behavior.','No local-learning setting changed. Fixed harmless cookie identifiers and script responses.','Synthetic OAuth/SAML and playback fixtures do not establish live account or streaming compatibility.','PB packaged source attribution and page-reachable privileged exploit equivalence remain unscored.']};
  fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
  try {
    for(let n=0;n<Number(runsArg);n++)for(const build of n%2?[...builds].reverse():builds) {
      const result=await runOne(build,n,snapshots,server,hits,n===0);report.runs.push(result);
      fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
      console.log('[ok] '+build.label+' repetition '+n+': '+result.scenarios.map(r=>r.name+'='+r.status).join(', '));
    }
    report.complete=true;fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  } catch(error) {report.error=error.stack||String(error);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');throw error;
  } finally {await new Promise(resolve=>server.close(resolve));}
}
module.exports={CORPUS,ACCEPTANCE,classify,localReplacement,runOne};
if(require.main===module)profile.mustFinish(run,'browser-release-rematch').catch(e=>{console.error(e.stack||e);process.exitCode=1;});

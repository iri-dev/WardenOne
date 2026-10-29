/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),{sha256,verifyBuild,fingerprint}=require('./lib/privacy-baseline.js');
const {ARMS,PAGES,hash,configurationHash,order,cpuDelta,rendererCounterDelta,summarize,publicReady}=require('./lib/ghostery-performance.js'),fixtures=require('./lib/ghostery-performance-fixtures.js');
const {evaluate,until,attach,state,sleep}=require('./prepare-ghostery-performance.js'),{cleanupProfile}=require('./lib/browser-profile-cleanup.js');
const {processState,pageState,SITES}=require('./perf-real-sites.js');
async function metrics(cdp,session){const r=await cdp.send('Performance.getMetrics',{},session);return Object.fromEntries(r.metrics.map(x=>[x.name,x.value]));}
async function cpu(cdp){const r=await cdp.send('SystemInfo.getProcessInfo');return Object.fromEntries(r.processInfo.map(x=>[x.id,x.cpuTime]));}
async function heap(cdp,session){try{return (await cdp.send('Runtime.getHeapUsage',{},session)).usedSize/1048576;}catch{return null;}}
async function tab(cdp){const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'}),session=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  for(const d of ['Page','Runtime','Performance','Network'])await cdp.send(d+'.enable',{},session);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:profile.LONGTASK_SCRIPT},session);await cdp.send('Page.bringToFront',{},session);return{targetId,session};}
async function measure(cdp,page,ext,arm,fixture,name,cache){
  const s=page.session,url=fixture.origin+'/'+name;
  if(cache==='cold')await cdp.send('Network.clearBrowserCache',{},s);
  await cdp.send('Page.navigate',{url:'about:blank'},s);await sleep(100);
  const before=await metrics(cdp,s),cpuBefore=await cpu(cdp),start=performance.now();
  const row={page:name,cache,compatible:false};let requests=0,cached=0;
  const off=cdp.on(e=>{if(e.sessionId===s&&e.method==='Network.responseReceived'){requests++;if(e.params.response.fromDiskCache||e.params.response.fromPrefetchCache)cached++;}if(e.sessionId===s&&e.method==='Network.requestServedFromCache')cached++;});
  try{
    await cdp.send('Page.navigate',{url},s);await until(()=>evaluate(cdp,s,'location.href==='+JSON.stringify(url)+'&&window.__done===true&&document.readyState==="complete"'),'workload '+name,90000);
    if(arm.product==='wardenone')await until(()=>evaluate(cdp,s,'window.__wardenOneReadyVersion==='+JSON.stringify(arm.build.version)),'page engine');
    await sleep(700);
    if(name==='media'){
      row.video=await evaluate(cdp,s,'(async()=>{const v=document.getElementById("player");await v.play();const end=performance.now()+10000;while(v.getVideoPlaybackQuality().totalVideoFrames<5&&performance.now()<end)await new Promise(r=>setTimeout(r,50));return {frames:v.getVideoPlaybackQuality().totalVideoFrames,width:v.videoWidth,paused:v.paused,error:v.error?.code??null};})()');
      assert(row.video.frames>=5&&row.video.width>0&&!row.video.paused&&!row.video.error,'video decoding');
      row.audio=await evaluate(cdp,s,'(async()=>{const a=new OfflineAudioContext(1,512,44100),b=a.createBuffer(1,512,44100);b.getChannelData(0).fill(.25);const s=a.createBufferSource();s.buffer=b;s.connect(a.destination);s.start();return (await a.startRendering()).getChannelData(0).every(x=>x===.25);})()');assert(row.audio,'native audio samples');
    }
    await evaluate(cdp,s,'document.getElementById("interaction").focus();true');await cdp.send('Input.insertText',{text:'benchmark-user'},s);
    await until(()=>evaluate(cdp,s,'Number.isFinite(window.__inputLatency)'),'interaction paint');
    const nav=await evaluate(cdp,s,'(()=>{const n=performance.getEntriesByType("navigation")[0],l=window.__wo_perf?.longTasks||[];return {loadMs:n.loadEventEnd,dclMs:n.domContentLoadedEventEnd,longTasks:l.length,longTaskMs:l.reduce((a,b)=>a+b,0),interactionMs:__inputLatency,frames:document.querySelectorAll("iframe").length,input:document.getElementById("interaction").value,noise:window.__wardenOneRealm?.noise??null,nodes:document.getElementsByTagName("*").length};})()');
    assert.equal(nav.input,'benchmark-user');if(name==='frames8')assert.equal(nav.frames,8);if(name==='frames30')assert.equal(nav.frames,30);
    const after=await metrics(cdp,s),cpuAfter=await cpu(cdp);Object.assign(row,nav,{wallMs:performance.now()-start,requests,cached,
      taskMs:rendererCounterDelta(before.TaskDuration,after.TaskDuration),scriptMs:rendererCounterDelta(before.ScriptDuration,after.ScriptDuration),layoutMs:rendererCounterDelta(before.LayoutDuration,after.LayoutDuration),
      browserCpuMs:cpuDelta(cpuBefore,cpuAfter),workerHeapMiB:ext?await heap(cdp,ext.attachedSession):null,workerTaskMs:null});
    if(row.taskMs===null||row.scriptMs===null||row.layoutMs===null)row.rendererCounterUnavailable='Missing or reset cumulative renderer counter; unavailable deltas remain null.';
    await cdp.send('HeapProfiler.collectGarbage',{},s);row.rendererHeapMiB=await heap(cdp,s);
    const memory=await processState(cdp);row.processPrivateMiB=memory.privateMB??null;row.processWorkingMiB=memory.workingSetMB??null;row.processCount=memory.processCount;
    if(name==='auth'){
      await evaluate(cdp,s,'document.getElementById("password").focus();true');await cdp.send('Input.insertText',{text:'synthetic-only'},s);await evaluate(cdp,s,'document.querySelector("form").requestSubmit();true');
      await until(()=>evaluate(cdp,s,'location.pathname==="/account"&&document.querySelector("#session")?.textContent==="signed-in"'),'cookie session');row.auth={syntheticCredentials:true,session:true,indexedDB:true};
    }
    row.compatible=true;
  }catch(error){row.error=String(error.stack||error);}finally{off();}
  return row;
}
async function live(cdp,page,ext,arm){const rows=[];
  for(const[name,url]of Object.entries({article:'https://en.wikipedia.org/wiki/Browser_extension',youtube:SITES.youtube,twitch:SITES.twitch,auth:'https://accounts.google.com/ServiceLogin'})){
    const row={name,url,compatible:false};rows.push(row);
    try{await cdp.send('Page.navigate',{url:'about:blank'},page.session);await sleep(100);const before=await metrics(cdp,page.session),c=await cpu(cdp),started=performance.now();
      await cdp.send('Page.navigate',{url},page.session);await until(async()=>publicReady(name,await pageState(cdp,page.session),arm.product),'public '+name,60000);
      await cdp.send('Page.bringToFront',{},page.session);if(name==='youtube'||name==='twitch')await evaluate(cdp,page.session,'(async()=>{const v=document.querySelector("video");v.muted=true;await v.play();return true;})()');
      row.first=await pageState(cdp,page.session);await sleep(3000);row.last=await pageState(cdp,page.session);
      if(name==='youtube'||name==='twitch')assert(!row.last.videoPaused&&row.last.videoWidth>0&&row.last.videoTime>row.first.videoTime,'advancing public video');
      const after=await metrics(cdp,page.session);Object.assign(row,{wallMs:performance.now()-started,taskMs:(after.TaskDuration-before.TaskDuration)*1000,browserCpuMs:cpuDelta(c,await cpu(cdp)),rendererHeapMiB:await heap(cdp,page.session),workerHeapMiB:ext?await heap(cdp,ext.attachedSession):null,processes:await processState(cdp),compatible:true});
    }catch(error){row.error=String(error.stack||error);row.lastObserved=await pageState(cdp,page.session).catch(()=>null);}
  }return rows;
}
function trialConfigurationHash(product,config,live){if(live&&product==='wardenone'){const {toastMemory,...settings}=config;return configurationHash(product,settings);}return configurationHash(product,config);}
async function trial(seed,block,options,fixture){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wo-ghostery-performance-')),port=await profile.freePort();let cdp;
  const row={arm:seed.id,block,position:order(block).indexOf(seed.id),pages:[],complete:false,workerCreations:0};
  try{fs.cpSync(seed.directory,directory,{recursive:true});
    const flags=['--no-proxy-server','--ignore-certificate-errors-spki-list='+options.spki,'--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-media-suspend','--autoplay-policy=no-user-gesture-required',
      '--host-resolver-rules='+fixture.hosts.map(h=>'MAP '+h+' 127.0.0.1').concat(options.live?options.feedHosts.map(h=>'MAP '+h+' ~NOTFOUND'):['MAP * ~NOTFOUND']).join(', ')+', EXCLUDE 127.0.0.1'];
    const native=await profile.launch(options.browser,seed.product==='off'?'off':'on',seed.build?.directory||'',port,directory,flags);row.browser=native.Browser;
    cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();await cdp.send('Target.setDiscoverTargets',{discover:true});
    cdp.on(e=>{if(e.method==='Target.targetCreated'&&e.params.targetInfo.type==='service_worker'&&e.params.targetInfo.url.startsWith('chrome-extension://'))row.workerCreations++;});
    let ext;if(seed.build){verifyBuild(seed.build);ext=await attach(cdp,seed.build,port);if(options.live){await cdp.send('Network.enable',{},ext.attachedSession);await cdp.send('Network.setBlockedURLs',{urls:options.feedUrls},ext.attachedSession);row.feedRequestFreeze=options.feedUrls;}
      row.before=await state(cdp,ext,seed);assert.equal(row.before.dataHash,seed.state.dataHash,'frozen updated data at start');assert.equal(trialConfigurationHash(seed.product,row.before.config,options.live),trialConfigurationHash(seed.product,seed.state.config,options.live),'effective preset at start');await profile.closeExtensionTabs(cdp,port,ext.id);}
    const page=await tab(cdp);
    for(const name of options.publicOnly?[]:[...PAGES.slice(block%PAGES.length),...PAGES.slice(0,block%PAGES.length)])for(const cache of ['cold','warm']){
      const p=await measure(cdp,page,ext,seed,fixture,name,cache);row.pages.push(p);console.log(seed.id+' block '+(block+1)+' '+name+' '+cache+': '+(p.compatible?p.taskMs.toFixed(1)+' ms':p.error.split('\n')[0]));
    }
    const c=await cpu(cdp),m=await metrics(cdp,page.session);await sleep(3000);const n=await metrics(cdp,page.session);row.pinnedIdle={seconds:3,browserCpuMs:cpuDelta(c,await cpu(cdp)),pageTaskMs:(n.TaskDuration-m.TaskDuration)*1000,workerDebuggerAttached:!!ext};
    if(options.live)row.live=await live(cdp,page,ext,seed);
    if(ext){row.after=await state(cdp,ext,seed);row.dataUnchanged=row.after.dataHash===row.before.dataHash;row.configurationUnchanged=trialConfigurationHash(seed.product,row.after.config,options.live)===trialConfigurationHash(seed.product,row.before.config,options.live);if(options.live&&seed.product==='wardenone')row.toastMemoryChanged=hash(row.after.config.toastMemory||{})!==hash(row.before.config.toastMemory||{});assert(row.dataUnchanged,'filters changed during trial');assert(row.configurationUnchanged,'configuration changed during trial');}
    await cdp.send('Target.closeTarget',{targetId:page.targetId});row.complete=row.pages.every(x=>x.compatible)&&(!row.live||row.live.every(x=>x.compatible));
  }catch(error){row.error=String(error.stack||error);}finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}await sleep(300);cleanupProfile(directory,'wo-ghostery-performance-');}
  return row;
}
async function main(options){
  if(fs.existsSync(options.out))throw Error('Preserve existing benchmark reports');const seeds=JSON.parse(fs.readFileSync(options.seeds));assert(seeds.complete,'seeds must be warmed');options.browser=seeds.browser;
  if(options.live)Object.assign(options,feedFreeze());
  assert.equal(sha256(fs.readFileSync(options.browser)),seeds.browserSha256);const fixture=await fixtures.serve();
  const crypto=require('crypto'),{tls}=require('./browser-media-security.js');options.spki=crypto.createHash('sha256').update(new crypto.X509Certificate(tls.cert).publicKey.export({format:'der',type:'spki'})).digest('base64');
  const report={schemaVersion:1,createdAt:new Date().toISOString(),runs:options.runs,seeds:options.seeds,seedsSha256:sha256(fs.readFileSync(options.seeds)),harnessSha256:sha256(fs.readFileSync(__filename)),browserSha256:seeds.browserSha256,
    machine:{cpu:os.cpus()[0].model,cores:os.cpus().length,ram:os.totalmem(),release:os.release()},corpus:fixture.bodyHashes,live:options.live,publicOnly:!!options.publicOnly,order:Array.from({length:options.runs},(_,i)=>order(i)),trials:[],complete:false,
    limitations:['Five-arm position-balanced blocks, serial browser processes. No protection disabled beyond each documented product preset.','Controlled loops use frozen warmed updates and identical served bytes; public pages remain variable.',
      'Attached worker measurements keep workers awake; natural suspension and forced wake costs require the separate lifecycle diagnostic.','Worker Performance-domain task time is unavailable and is null, not zero.','Input-to-two-animation-frame timing is a fixture response measurement, not field INP.']};
  const save=()=>{report.summary=summarize(report);fs.mkdirSync(path.dirname(options.out),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(report,null,2)+'\n');};
  try{for(let block=0;block<options.runs;block++)for(const arm of order(block).filter(x=>!options.arms||options.arms.includes(x))){console.log('Starting '+arm+' block '+(block+1));const row=await trial(seeds.arms.find(x=>x.id===arm),block,options,fixture);report.trials.push(row);save();if(row.error)throw Error(row.error);}
    report.complete=report.trials.every(x=>x.complete);for(const b of seeds.arms.filter(x=>x.build))verifyBuild(b.build);
  }finally{save();await new Promise(r=>fixture.server.close(r));}
  if(!report.complete)throw Error('One or more workload compatibility checks failed');console.log('[ok] serial matched performance dataset complete');
}
function feedFreeze(){const urls=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/source-inventory.json'))).sources.map(s=>s.url).concat('*://cdn.ghostery.com/*');return{feedUrls:urls,feedHosts:[...new Set(urls.filter(u=>u.startsWith('https://')).map(u=>new URL(u).hostname).concat('cdn.ghostery.com'))]};}
function args(argv){const o={runs:5,live:false};for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--live')o.live=true;else if(k==='--public-only'){o.publicOnly=true;o.live=true;}else if(k==='--runs')o.runs=Number(argv[++i]);else if(k==='--arms')o.arms=argv[++i].split(',');else if(k==='--seeds'||k==='--out')o[k.slice(2)]=path.resolve(argv[++i]);else throw Error('Unknown option '+k);}if(!o.seeds||!o.out||!Number.isInteger(o.runs)||o.runs<1||o.runs>10||o.arms?.some(x=>!ARMS.some(a=>a.id===x)))throw Error('Use --seeds --out [--runs 1..10] [--live|--public-only] [--arms ids]');return o;}
module.exports={args,trial,measure,live,metrics,cpu,heap,tab,feedFreeze,trialConfigurationHash};
if(require.main===module)profile.mustFinish(()=>main(args(process.argv.slice(2))),'Ghostery performance').catch(e=>{console.error(e);process.exitCode=1;});

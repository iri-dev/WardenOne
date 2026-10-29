/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),{evaluate,until,attach,state,ghosteryUI,sleep}=require('./prepare-ghostery-performance.js');
const {cpu,tab}=require('./browser-ghostery-performance.js'),{cpuDelta,hash,configurationHash}=require('./lib/ghostery-performance.js');
const {serve}=require('./lib/ghostery-performance-fixtures.js'),{cleanupProfile}=require('./lib/browser-profile-cleanup.js'),{tls}=require('./browser-media-security.js'),{sha256}=require('./lib/privacy-baseline.js');
function costs(p){const byId=new Map(p.nodes.map(n=>[n.id,n])),scripts=new Map(),functions=new Map();for(let i=0;i<(p.samples||[]).length;i++){const f=byId.get(p.samples[i])?.callFrame;if(!f)continue;const ms=(p.timeDeltas?.[i]||0)/1000,url=f.url||'(runtime)',key=url+'|'+f.functionName+'|'+f.lineNumber+':'+f.columnNumber;scripts.set(url,(scripts.get(url)||0)+ms);const item=functions.get(key)||{url,name:f.functionName||'(anonymous)',line:f.lineNumber+1,column:f.columnNumber+1,selfMs:0};item.selfMs+=ms;functions.set(key,item);}
  return{scripts:[...scripts].map(([url,selfMs])=>({url,selfMs})).sort((a,b)=>b.selfMs-a.selfMs),functions:[...functions.values()].sort((a,b)=>b.selfMs-a.selfMs).slice(0,30),durationMs:(p.endTime-p.startTime)/1000};}
async function diagnostic(seed,seeds,fixture,out){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-ghostery-lifecycle-')),port=await profile.freePort();let cdp;const row={arm:seed.id,complete:false,profiles:[],forcedRestarts:[]};
  try{fs.cpSync(seed.directory,dir,{recursive:true});const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(tls.cert).publicKey.export({format:'der',type:'spki'})).digest('base64');
    const native=await profile.launch(seeds.browser,seed.product==='off'?'off':'on',seed.build?.directory||'',port,dir,['--no-proxy-server','--ignore-certificate-errors-spki-list='+spki,'--disable-backgrounding-occluded-windows','--disable-background-timer-throttling','--disable-renderer-backgrounding','--host-resolver-rules='+fixture.hosts.map(x=>'MAP '+x+' 127.0.0.1').join(', ')+', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    row.browser=native.Browser;cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();await cdp.send('Target.setDiscoverTargets',{discover:true});const events=[];
    cdp.on(e=>{if(['Target.targetCreated','Target.targetDestroyed'].includes(e.method))events.push({at:Date.now(),method:e.method,target:e.params.targetInfo||e.params.targetId});});
    let ext;if(seed.build){ext=await attach(cdp,seed.build,port);row.before=await state(cdp,ext,seed);assert.equal(row.before.dataHash,seed.state.dataHash);await profile.closeExtensionTabs(cdp,port,ext.id);}
    if(seed.product==='wardenone')for(const name of ['article','churn','frames30']){
      const page=await tab(cdp);for(const session of[page.session,ext.attachedSession]){await cdp.send('Profiler.enable',{},session);await cdp.send('Profiler.setSamplingInterval',{interval:1000},session);await cdp.send('Profiler.start',{},session);}
      await cdp.send('Page.navigate',{url:fixture.origin+'/'+name},page.session);await until(()=>evaluate(cdp,page.session,'window.__done===true'),'profile '+name,90000);await sleep(1000);
      for(const[k,session]of[['page',page.session],['worker',ext.attachedSession]]){const p=(await cdp.send('Profiler.stop',{},session)).profile,file=path.join(out,seed.id+'-'+name+'-'+k+'.cpuprofile');fs.writeFileSync(file,JSON.stringify(p));row.profiles.push({name,realm:k,file,sha256:sha256(fs.readFileSync(file)),...costs(p)});}
      await cdp.send('Target.closeTarget',{targetId:page.targetId});
    }
    const control=await tab(cdp),versions=new Map();
    cdp.on(e=>{if(e.method==='ServiceWorker.workerVersionUpdated')for(const v of e.params.versions)versions.set(v.versionId,v);});
    await cdp.send('ServiceWorker.enable',{},control.session);
    if(ext){
      const ui=seed.product==='ghostery'?await ghosteryUI(cdp,ext.id):null;
      const uiPage=ui||await (async()=>{const t=await cdp.send('Target.createTarget',{url:'chrome-extension://'+ext.id+'/popup.html'}),s=(await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;await cdp.send('Runtime.enable',{},s);await until(()=>evaluate(cdp,s,'document.readyState==="complete"'),'control UI');return{targetId:t.targetId,session:s};})();
      const bgUrl='chrome-extension://'+ext.id+'/'+seed.build.background.service_worker;
      for(let repeat=0;repeat<3;repeat++){
        const version=await until(()=>[...versions.values()].find(v=>v.scriptURL===bgUrl&&v.runningStatus==='running'),'worker version');
        const old=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===bgUrl);assert(old);
        const rules=await evaluate(cdp,uiPage.session,'chrome.declarativeNetRequest.getDynamicRules()');
        await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId},control.session);
        await until(async()=>!(await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===old.targetId),'forced worker stop');
        assert.equal(hash(await evaluate(cdp,uiPage.session,'chrome.declarativeNetRequest.getDynamicRules()')),hash(rules),'native rules survive termination');
        const before=await cpu(cdp),started=performance.now();await evaluate(cdp,uiPage.session,'chrome.runtime.sendMessage({'+(seed.product==='ghostery'?'action:"keepAlive"':'kind:"performance-wake"')+'}).then(()=>true,()=>true)');
        ext=await attach(cdp,seed.build,port,false);await profile.closeExtensionTabs(cdp,port,ext.id);
        row.forcedRestarts.push({repeat:repeat+1,latencyMs:performance.now()-started,browserCpuMs:cpuDelta(before,await cpu(cdp)),dynamicRulesPreserved:true});
        if(repeat<2){
          const newUI=seed.product==='ghostery'?await ghosteryUI(cdp,ext.id):await (async()=>{const t=await cdp.send('Target.createTarget',{url:'chrome-extension://'+ext.id+'/popup.html'}),s=(await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;await cdp.send('Runtime.enable',{},s);await until(()=>evaluate(cdp,s,'document.readyState==="complete"'),'wake UI');return{targetId:t.targetId,session:s};})();Object.assign(uiPage,newUI);
        }
      }
      await profile.closeExtensionTabs(cdp,port,ext.id);await cdp.send('Target.detachFromTarget',{sessionId:ext.attachedSession}).catch(()=>{});
    }
    const before=await cpu(cdp),start=Date.now();await sleep(40000);const after=await cpu(cdp),targets=(await cdp.send('Target.getTargets')).targetInfos;
    row.naturalIdle={seconds:(Date.now()-start)/1000,browserCpuMs:cpuDelta(before,after),debuggerDetached:true,workerRunning:ext?targets.some(t=>t.type==='service_worker'&&t.url.startsWith('chrome-extension://'+ext.id+'/')):false,
      workerCreatedEvents:events.filter(e=>e.at>=start&&e.method==='Target.targetCreated'&&e.target.type==='service_worker').length};
    if(ext){const start=performance.now(),c=await cpu(cdp);await cdp.send('Page.navigate',{url:fixture.origin+'/article'},control.session);ext=await attach(cdp,seed.build,port,false);row.navigationWake={latencyMs:performance.now()-start,browserCpuMs:cpuDelta(c,await cpu(cdp)),previouslySuspended:!row.naturalIdle.workerRunning};
      row.after=await state(cdp,ext,seed);assert.equal(row.after.dataHash,row.before.dataHash);assert.equal(configurationHash(seed.product,row.after.config),configurationHash(seed.product,row.before.config));}
    row.events=events;row.complete=true;
  }catch(error){row.error=String(error.stack||error);}finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}await sleep(300);cleanupProfile(dir,'wo-ghostery-lifecycle-');}return row;
}
async function main(){const [seedFile,out]=process.argv.slice(2);if(!seedFile||!out||fs.existsSync(out))throw Error('Use seeds.json new-output-directory');fs.mkdirSync(out,{recursive:true});const seeds=JSON.parse(fs.readFileSync(seedFile));assert(seeds.complete);const fixture=await serve(),report={createdAt:new Date().toISOString(),seedFile,seedsSha256:sha256(fs.readFileSync(seedFile)),toolSha256:sha256(fs.readFileSync(__filename)),rows:[],complete:false};
  try{for(const seed of seeds.arms){console.log('Lifecycle '+seed.id);const row=await diagnostic(seed,seeds,fixture,out);report.rows.push(row);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(row.error)throw Error(row.error);}report.complete=true;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await new Promise(r=>fixture.server.close(r));}
  console.log('[ok] profiler attribution, three forced restarts and unpinned natural idle per arm');
}
module.exports={costs};
if(require.main===module)profile.mustFinish(main,'Ghostery lifecycle performance').catch(e=>{console.error(e);process.exitCode=1;});

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const profile=require('./perf-profile.js'),{ghosteryReady}=require('./browser-ghostery-baseline.js'),{verifyBuild,sha256}=require('./lib/privacy-baseline.js');
const {ARMS,hash,feedProjection,assertConfiguration}=require('./lib/ghostery-performance.js'),{safeSettings}=require('./prepare-ghostery-baseline.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(cdp,session,expression){const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(fn,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await sleep(150);}throw Error('Timed out: '+label);}
async function attach(cdp,build,port,requireReconcile=true){
  if(build.product==='wardenone'){const ext=await profile.extensionReady(cdp,port,build.version,undefined,100);try{await until(()=>evaluate(cdp,ext.attachedSession,(requireReconcile?'!!__refreshExtensionStateLastKey&&':'')+'!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'),'WardenOne queues');}catch(error){const diagnostic=await evaluate(cdp,ext.attachedSession,'({lastKey:__refreshExtensionStateLastKey,inFlight:__refreshExtensionStateInFlightKey,timer:!!__refreshExtensionStateTimer,queued:__refreshExtensionStateQueued,generation:__refreshExtensionStateGeneration})').catch(e=>({error:String(e)}));throw Error(error.message+': '+JSON.stringify(diagnostic));}await evaluate(cdp,ext.attachedSession,'Promise.all([...__subsystemQueues.values()]).then(()=>true)');return ext;}
  return ghosteryReady(cdp,build);
}
async function ghosteryUI(cdp,id){const {targetId}=await cdp.send('Target.createTarget',{url:'chrome-extension://'+id+'/pages/settings/index.html'}),session=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;await cdp.send('Runtime.enable',{},session);await until(()=>evaluate(cdp,session,'document.readyState==="complete"'),'vendor settings');return{targetId,session};}
async function configure(cdp,ext,arm){
  if(arm.product==='wardenone')return evaluate(cdp,ext.attachedSession,'updateStoredConfig(cfg=>{const next=Object.assign({},cfg,DEFAULT_CONFIG,'+(arm.preset==='maximum'?'ONBOARDING_MAX_PRIVACY':'ONBOARDING_RECOMMENDED')+');migrateStoredConfig(next,DEFAULT_CONFIG);return next}).then(()=>true)');
  if(arm.preset!=='maximum')return;
  const ui=await ghosteryUI(cdp,ext.id);
  try{return await evaluate(cdp,ui.session,`(async()=>{const[{default:store},{default:Options}]=await Promise.all([import(chrome.runtime.getURL('npm/hybrids/src/store.js')),import(chrome.runtime.getURL('store/options.js'))]);const current=await store.resolve(Options);await store.set(current,{blockAds:true,blockTrackers:true,blockAnnoyances:true,fixesFilters:true,serpTrackingPrevention:true,autoconsent:{autoAction:'optOut',gpc:true},distractions:{shorts:true,browserPrompts:true,notifications:true,socialWidgets:true}});await chrome.runtime.sendMessage({action:'e2e:idle'});return true;})()`);}
  finally{await cdp.send('Target.closeTarget',{targetId:ui.targetId});}
}
async function state(cdp,ext,arm){
  const s=ext.attachedSession,common=await evaluate(cdp,s,`Promise.all([chrome.storage.local.get(null),chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.declarativeNetRequest.getEnabledRulesets(),chrome.permissions.getAll(),chrome.scripting.getRegisteredContentScripts()]).then(([storage,dynamic,session,enabled,permissions,scripts])=>({storage,dynamic,session,enabled,permissions,scripts}))`);
  let config,data;
  if(arm.product==='wardenone'){
    config=await evaluate(cdp,s,'chrome.storage.local.get("wardenone_config").then(x=>Object.assign({},DEFAULT_CONFIG,x.wardenone_config||{}))');
    const keys=Object.keys(common.storage).filter(k=>/^(?:wardenone_(?:aux_lists|blocked_domains|blocked_security_count|security_domains|cname_data|tracker_catalog|adshield_cosmetic|list_integrity|grabber_domains|cryptominer_domains|download_threat_feeds))$/.test(k));
    data=Object.fromEntries(keys.sort().map(k=>{const value=feedProjection(k,common.storage[k]);return[k,{bytes:Buffer.byteLength(JSON.stringify(value)),sha256:hash(value),count:Array.isArray(value)?value.length:null}];}));
    common.listMeta=common.storage.wardenone_list_meta;common.updateState=await evaluate(cdp,s,'({inFlight:!!__remoteListUpdateInFlight,queued:__remoteListUpdateQueuedReason,refreshing:!!__refreshExtensionStateInFlightKey,queuedRefresh:!!__refreshExtensionStateQueued})');
  }else{
    const ui=await ghosteryUI(cdp,ext.id);try{config=await evaluate(cdp,ui.session,`(async()=>{const[{default:store},{default:Options}]=await Promise.all([import(chrome.runtime.getURL('npm/hybrids/src/store.js')),import(chrome.runtime.getURL('store/options.js'))]);return JSON.parse(JSON.stringify(await store.resolve(Options)));})()`);}finally{await cdp.send('Target.closeTarget',{targetId:ui.targetId});}
    data=common.storage.resources?.checksums||{};
  }
  assertConfiguration(arm.product,arm.preset,config);
  return {config:safeSettings(config),data,dataHash:hash(data),listMeta:common.listMeta||null,updateState:common.updateState||null,
    rules:{dynamic:common.dynamic.length,session:common.session.length,enabled:common.enabled,dynamicHash:hash(common.dynamic)},permissions:common.permissions,
    scripts:common.scripts.map(({id,world,runAt,matches})=>({id,world,runAt,matches})),storageKeys:Object.keys(common.storage).sort()};
}
async function prepare(options){
  const snapshots=JSON.parse(fs.readFileSync(options.snapshots));if(fs.existsSync(options.out)&&!options.resume)throw Error('Preserve the existing warmed snapshot');
  const prior=options.resume?JSON.parse(fs.readFileSync(path.join(options.out,'seeds.json'))):null;
  if(prior?.complete)throw Error('Completed seed profiles are immutable');
  if(prior)fs.copyFileSync(path.join(options.out,'seeds.json'),path.join(options.out,'seeds-attempt-'+Date.now()+'.json'));
  fs.mkdirSync(options.out,{recursive:true});const report=prior||{schemaVersion:1,createdAt:new Date().toISOString(),snapshots:options.snapshots,browser:snapshots.browserPath,browserSha256:sha256(fs.readFileSync(snapshots.browserPath)),arms:[],complete:false};
  report.harnessSha256=sha256(fs.readFileSync(__filename));
  const imported=options.importSeeds?JSON.parse(fs.readFileSync(options.importSeeds)):null;
  if(imported){if(!imported.complete)throw Error('Imported seeds are incomplete');report.importedWarmSeeds={path:options.importSeeds,sha256:sha256(fs.readFileSync(options.importSeeds)),reason:'Reindex semantic payload fingerprints separately from mutable fetch timestamps; preserve warmed data and settings'};}
  const save=()=>fs.writeFileSync(path.join(options.out,'seeds.json'),JSON.stringify(report,null,2)+'\n');
  try{for(const arm of ARMS){const build=snapshots.builds.find(b=>b.product===arm.product),directory=path.join(options.out,arm.id),port=await profile.freePort();let cdp;
    if(build)verifyBuild(build);let item=report.arms.find(x=>x.id===arm.id);if(item?.complete)continue;
    console.log('Preparing '+arm.id);if(item){item.priorError=item.error;delete item.error;}else{item={...arm,directory,build:build||null,complete:false};report.arms.push(item);}save();
    if(imported&&!fs.existsSync(directory)){const original=imported.arms.find(a=>a.id===arm.id);fs.cpSync(original.directory,directory,{recursive:true});item.update=original.update;}
    try{const native=await profile.launch(snapshots.browserPath,arm.product==='off'?'off':'on',build?.directory||'',port,directory,['--no-proxy-server',...(imported?['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']:[])]);item.browser=native.Browser;
      cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();
      if(build){const ext=await attach(cdp,build,port);if(!imported)await configure(cdp,ext,arm);
        if(arm.product==='wardenone'&&!imported){
          if(!item.update?.result?.ok){
            await evaluate(cdp,ext.attachedSession,"globalThis.__benchmarkUpdate={done:false};updateRemoteLists('manual').then(result=>{__benchmarkUpdate={done:true,result};},error=>{__benchmarkUpdate={done:true,error:String(error)};});true");
            await until(()=>evaluate(cdp,ext.attachedSession,'__benchmarkUpdate.done'),'WardenOne updated filters',300000);
            item.update=await evaluate(cdp,ext.attachedSession,'__benchmarkUpdate');
          }
          await until(()=>evaluate(cdp,ext.attachedSession,'!__remoteListUpdateInFlight&&!__remoteListUpdateQueuedReason&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'),'update quiescence',120000);
          await evaluate(cdp,ext.attachedSession,'Promise.all([...__subsystemQueues.values()]).then(()=>true)');
        }else if(arm.product==='ghostery'&&!imported){
          const ui=await ghosteryUI(cdp,ext.id);try{item.update=await evaluate(cdp,ui.session,"chrome.runtime.sendMessage({action:'updateEngines'}).then(r=>({result:r??null}))");item.idle=await evaluate(cdp,ui.session,"chrome.runtime.sendMessage({action:'e2e:idle'})");}finally{await cdp.send('Target.closeTarget',{targetId:ui.targetId});}
        }
        await sleep(3000);item.state=await state(cdp,ext,arm);await profile.closeExtensionTabs(cdp,port,ext.id);
        if(arm.product==='wardenone'&&(!item.update.result?.ok||!item.state.listMeta?.updated))throw Error('WardenOne remote update did not establish usable updated data');
        if(arm.product==='ghostery'&&(!Object.keys(item.state.data).length||!item.state.rules.enabled.includes('tracking')))throw Error('Ghostery data not ready');
      }
      item.complete=true;
    }catch(error){item.error=String(error.stack||error);throw error;}finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}await sleep(1000);save();}
  }report.complete=true;}finally{save();}
  console.log('[ok] five warmed, explicitly configured profiles; browser data retained locally in '+options.out);return report;
}
if(require.main===module){const[snapshots,out,flag,value]=process.argv.slice(2);if(flag&&!['--resume','--import'].includes(flag))throw Error('Unknown flag');profile.mustFinish(()=>prepare({snapshots:path.resolve(snapshots),out:path.resolve(out),resume:flag==='--resume',importSeeds:flag==='--import'?path.resolve(value):null}),'prepare Ghostery performance').catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={evaluate,until,attach,configure,state,ghosteryUI,prepare,sleep};

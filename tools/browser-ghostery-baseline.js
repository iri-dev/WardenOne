/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https'),crypto=require('crypto'),assert=require('assert/strict');
const profile=require('./perf-profile.js');
const {tls}=require('./browser-media-security.js');
const {cleanupProfile}=require('./lib/browser-profile-cleanup.js');
const {verifyBuild,sha256}=require('./lib/privacy-baseline.js');
const {safeSettings}=require('./prepare-ghostery-baseline.js');
const HOST='article.wardenone-ghostery.example.org';
const fixtureSpki=crypto.createHash('sha256').update(new crypto.X509Certificate(tls.cert).publicKey.export({format:'der',type:'spki'})).digest('base64');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(cdp,session,expression,contextId) {
  const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,...(contextId?{contextId}:{})},session);
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
}
async function until(fn,label,timeout=45000) {const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100);}throw Error('Timed out: '+label);}
async function ghosteryReady(cdp,build) {
  const expected='/'+build.background.service_worker;
  const target=await until(async()=> (await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith('chrome-extension://')&&t.url.endsWith(expected)),'Ghostery worker');
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  await cdp.send('Runtime.enable',{},sessionId);
  await until(()=>evaluate(cdp,sessionId,"typeof chrome!=='undefined'&&typeof chrome.runtime?.getManifest==='function'"),'Ghostery extension context');
  const details=await evaluate(cdp,sessionId,'({version:chrome.runtime.getManifest().version,id:chrome.runtime.id})');
  assert.equal(details.version,build.version,'loaded vendor manifest');
  const url='chrome-extension://'+details.id+'/pages/settings/index.html';
  const {targetId}=await cdp.send('Target.createTarget',{url});
  const ui=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await cdp.send('Runtime.enable',{},ui);
  await until(()=>evaluate(cdp,ui,'location.href==='+JSON.stringify(url)+'&&document.readyState==="complete"'),'Ghostery settings page');
  const initialization=await evaluate(cdp,ui,"chrome.runtime.sendMessage({action:'e2e:idle'}).then(r=>({response:r??null}),e=>({error:String(e)}))");
  const options=await evaluate(cdp,ui,`(async()=>{const[{default:store},{default:Options}]=await Promise.all([import(chrome.runtime.getURL('npm/hybrids/src/store.js')),import(chrome.runtime.getURL('store/options.js'))]);return JSON.parse(JSON.stringify(await store.resolve(Options)));})()`);
  return{id:details.id,attachedSession:sessionId,options:safeSettings(options),initialization};
}
async function probe(build,browser,server,hits,allowVendorUpdates) {
  if(build.product!=='off')verifyBuild(build);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-ghostery-baseline-')),port=await profile.freePort();
  let cdp;
  const row={build:build.label,complete:false,errors:[],outboundHostAttempts:[]};
  const attempts=new Set();
  try {
    const native=await profile.launch(browser,build.product==='off'?'off':'on',build.directory||'',port,dir,[
      '--ignore-certificate-errors-spki-list='+fixtureSpki,'--no-proxy-server','--host-resolver-rules='+(allowVendorUpdates&&build.product==='ghostery'?'EXCLUDE cdn.ghostery.com, ':'')+'MAP '+HOST+' 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    row.browser=native.Browser;cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();
    let ext;
    if(build.product==='wardenone') {
      ext=await profile.extensionReady(cdp,port,build.version,undefined,100);
      await until(()=>evaluate(cdp,ext.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'WardenOne reconciliation');
      await evaluate(cdp,ext.attachedSession,'Promise.all([...__subsystemQueues.values()]).then(()=>true)');
      row.options=safeSettings(await evaluate(cdp,ext.attachedSession,'DEFAULT_CONFIG'));
    } else if(build.product==='ghostery') {ext=await ghosteryReady(cdp,build);row.options=ext.options;row.engineReadiness=ext.initialization;}
    if(ext) {
      await profile.closeExtensionTabs(cdp,port,ext.id);
      cdp.on(m=>{
        if(m.sessionId!==ext.attachedSession)return;
        if(m.method==='Runtime.exceptionThrown')row.errors.push(m.params.exceptionDetails.text);
        if(m.method==='Network.requestWillBeSent')try{const u=new URL(m.params.request.url);if(['http:','https:'].includes(u.protocol))attempts.add(u.hostname);}catch(_){}
      });
      await cdp.send('Network.enable',{},ext.attachedSession);
      row.ruleState=await evaluate(cdp,ext.attachedSession,'Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.declarativeNetRequest.getEnabledRulesets()]).then(([d,s,enabled])=>({dynamic:d.length,session:s.length,enabled}))');
      if(build.product==='ghostery')assert(row.ruleState.enabled.includes('ads')&&row.ruleState.enabled.includes('tracking'),'Ghostery default network filtering initialized');
      row.registeredScripts=await evaluate(cdp,ext.attachedSession,'chrome.scripting.getRegisteredContentScripts().then(s=>s.map(({id,world,runAt})=>({id,world,runAt})))');
      row.permissions=await evaluate(cdp,ext.attachedSession,'chrome.permissions.getAll()');
      if(build.product==='ghostery')row.resourceChecksums=await evaluate(cdp,ext.attachedSession,"chrome.storage.local.get('resources').then(d=>d.resources?.checksums||{})");
    }
    const url='https://'+HOST+':'+server.address().port+'/?build='+build.label;
    const {targetId}=await cdp.send('Target.createTarget',{url});const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);
    await until(()=>evaluate(cdp,sessionId,'location.href==='+JSON.stringify(url)+'&&document.readyState==="complete"'),'fixture page');
    if(build.product==='wardenone')await until(()=>evaluate(cdp,sessionId,'window.__wardenOneReadyVersion==='+JSON.stringify(build.version)),'WardenOne page engine');
    row.page=await evaluate(cdp,sessionId,`(()=>{const e=document.getElementById('editor');e.value='edited';e.setSelectionRange(1,3);return {editor:e.value==='edited'&&e.selectionStart===1&&e.selectionEnd===3,gpc:navigator.globalPrivacyControl??null};})()`);
    const {frameTree}=await cdp.send('Page.getFrameTree',{},sessionId);const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'ghostery-baseline'},sessionId);
    row.fetch=await evaluate(cdp,sessionId,'fetch('+JSON.stringify(url.replace('/?','/probe?'))+').then(r=>r.status)',executionContextId);
    row.gpcHeader=hits.find(h=>h.build===build.label)?.gpc||null;
    row.outboundHostAttempts=[...attempts].sort();
    assert.equal(row.fetch,200);assert.equal(row.page.editor,true);row.complete=true;
  }catch(error){row.error=error.stack||String(error);}
  finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}await sleep(1000);cleanupProfile(dir,'wo-ghostery-baseline-');}
  return row;
}
async function run() {
  const [snapshotFile,browserArg,out,mode]=process.argv.slice(2);if(!out||(mode&&mode!=='--vendor-updates'))throw Error('Usage: browser-ghostery-baseline.js snapshots.json browser.exe new-report.json [--vendor-updates]');
  const allowVendorUpdates=mode==='--vendor-updates';
  if(fs.existsSync(out))throw Error('Preserve existing report');
  const snapshots=JSON.parse(fs.readFileSync(snapshotFile)),browser=path.resolve(browserArg),hits=[];
  const server=https.createServer(tls,(req,res)=>{const url=new URL(req.url,'https://'+HOST);if(url.pathname==='/probe')hits.push({build:url.searchParams.get('build'),gpc:req.headers['sec-gpc']||null});
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',url.pathname==='/probe'?'text/plain':'text/html');res.end(url.pathname==='/probe'?'ok':'<!doctype html><title>Ghostery baseline fixture</title><input id="editor" value="editable">');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const report={schemaVersion:1,date:new Date().toISOString(),snapshotFile,browserSha256:sha256(fs.readFileSync(browser)),harnessSha256:sha256(fs.readFileSync(__filename)),environment:{...snapshots.environment,
    updates:allowVendorUpdates?'WardenOne packaged offline; Ghostery CDN initialized; data states unmatched and unscored':snapshots.environment.updates},
    corpus:{host:HOST,pages:'Local article/editor and same-site fetch only',network:allowVendorUpdates?'Only Ghostery CDN updates allowed; other remote DNS refused; no settings changed':'Remote DNS refused; packaged offline data; no settings changed'},runs:[],complete:false,
    limitations:['Readiness/default-state smoke only; no performance or blocking score.','Onboarding untouched; read-only resolution of the vendor Options model and its existing observer queue.','Outbound attempts observed only after worker attachment; no complete outbound privacy claim.']};
  try{for(const build of [{label:'off',product:'off'},...snapshots.builds]) {const row=await probe(build,browser,server,hits,allowVendorUpdates);report.runs.push(row);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(build.label+': '+(row.complete?'ready':row.error));}
    report.complete=report.runs.every(r=>r.complete);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');if(!report.complete)process.exitCode=1;
  }finally{await new Promise(resolve=>server.close(resolve));}
}
module.exports={ghosteryReady};
if(require.main===module)profile.mustFinish(run,'browser-ghostery-baseline').catch(e=>{console.error(e.stack||e);process.exitCode=1;});

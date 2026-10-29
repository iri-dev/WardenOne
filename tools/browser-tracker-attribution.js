/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https'),assert=require('assert/strict');
const profile=require('./perf-profile.js');
const {tls}=require('./browser-media-security.js');
const {cleanupProfile}=require('./lib/browser-profile-cleanup.js');
const {fingerprint,sha256}=require('./lib/privacy-baseline.js');
const {validateEntries}=require('./check-package-archive.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(cdp,session,expression) {
  const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
}
async function until(check,label) {const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await sleep(100);}throw Error('Timed out: '+label);}
async function run() {
  const [extensionArg,browserArg,out]=process.argv.slice(2);if(!out)throw Error('Usage: browser-tracker-attribution.js frozen-runtime browser.exe new-report.json');
  if(fs.existsSync(out))throw Error('Preserve existing native report');
  const source=path.resolve(extensionArg);if(fs.existsSync(path.join(source,'.git'))||fs.existsSync(path.join(source,'tools')))throw Error('Use a release snapshot, not a working tree');
  const identity=fingerprint(source),problems=validateEntries(identity.files.map(f=>f.path));if(problems.length)throw Error(problems.join('\n'));
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'wo-attribution-runtime-')),dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-attribution-profile-'));
  fs.cpSync(source,runtime,{recursive:true});const dataFile=path.join(runtime,'tracker-catalog.json'),original=fs.readFileSync(dataFile);
  const report={date:new Date().toISOString(),runtimeFingerprint:identity.sha256,harnessSha256:sha256(fs.readFileSync(__filename)),checks:[],complete:false};
  const hits=[],server=https.createServer(tls,(req,res)=>{hits.push({host:req.headers.host,path:req.url});res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Attribution fixture</title><input id="editor" value="works">');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=await profile.freePort();let cdp;
  try {
    const native=await profile.launch(path.resolve(browserArg),'on',runtime,port,dir,['--ignore-certificate-errors',
      '--host-resolver-rules=MAP article.attribution.example.org 127.0.0.1, MAP www.google-analytics.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    report.browser=native.Browser;cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();
    const ext=await profile.extensionReady(cdp,port,JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'))).version,undefined,100);
    const worker=expression=>evaluate(cdp,ext.attachedSession,expression);
    await until(()=>worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'policy reconcile');
    await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    await profile.closeExtensionTabs(cdp,port,ext.id);
    const rules=()=>worker('Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.declarativeNetRequest.getEnabledRulesets()])');
    const permissions=await worker('chrome.permissions.getAll()'),config=await worker("chrome.storage.local.get('wardenone_config')");
    const attach=async url=>{
      const{targetId}=await cdp.send('Target.createTarget',{url});const{sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
      await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Page.enable',{},sessionId);
      await until(()=>evaluate(cdp,sessionId,'location.href==='+JSON.stringify(url)+'&&document.readyState==="complete"'),'page ready');return{targetId,sessionId};
    };
    const page=await attach('https://article.attribution.example.org:'+server.address().port+'/');
    await until(()=>evaluate(cdp,page.sessionId,'!!window.__wardenOneReadyVersion'),'page protection');
    await until(()=>worker('chrome.declarativeNetRequest.getSessionRules().then(r=>r.find(x=>x.id===INTRANET_NET_RULE_BASE)?.condition.excludedTabIds?.length>0)'),'loopback fixture compatibility');
    await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    const before=await rules();
    const entries=[['blocked_tracker_request','www.google-analytics.com'],['detected_thirdparty_tracker','googletagmanager.com'],['proposed_tracker_domain','unknown.attribution.example.net'],['blocked_tracker_request','google-analytics.com.attacker.example.net']];
    await worker('(()=>{'+entries.map(([type,domain],n)=>'queueHistory('+JSON.stringify({type,detail:{domain},url:'https://article.attribution.example.org/',at:Date.now()+n})+');').join('')+'flushHistory();return true;})()');
    await worker('WO_HISTORY.drain().then(()=>true)');
    const activity=await attach('chrome-extension://'+ext.id+'/history.html');
    const activityValue=expression=>evaluate(cdp,activity.sessionId,expression);
    await until(()=>activityValue('document.querySelector(\'[data-tracker-identity="google_analytics"]\')?.textContent.includes("Google Analytics")'),'Activity identity');
    assert(await activityValue('document.querySelector(\'[data-tracker-identity="google_tag_manager"]\').textContent.includes("Essential services")'));
    assert(await activityValue('document.querySelector(\'[data-tracker-identity="suspected-tracker"]\').textContent.includes("Locally suspected")'));
    assert(await activityValue('document.querySelector(\'[data-tracker-identity="blocked-unattributed"]\').textContent.includes("identity unknown")'));
    report.checks.push('Activity distinguishes products under one company, essential services, local suspicion and unattributed blocks');
    const logger=await attach('chrome-extension://'+ext.id+'/logger.html');
    const loggerValue=expression=>evaluate(cdp,logger.sessionId,expression);
    await until(()=>loggerValue('!!document.getElementById("tracker-catalog-status").textContent'),'logger metadata');
    await sleep(250);
    await evaluate(cdp,page.sessionId,'fetch('+JSON.stringify('https://www.google-analytics.com:'+server.address().port+'/collect?fixture=1')+').then(()=>true,()=>false)');
    await until(()=>loggerValue('document.querySelector(\'[data-tracker-identity="google_analytics"]\')?.textContent.includes("Google Analytics")'),'native network identity');
    try { await until(()=>loggerValue('ENTRIES.some(e=>e.host==="google-analytics.com"&&e.action==="blocked")'),'settled browser block'); }
    catch(error) { report.networkDiagnostics=await loggerValue('ENTRIES.filter(e=>e.host.includes("google-analytics")).map(e=>({host:e.host,action:e.action,error:e.error,source:e.source,rule:e.rule,url:e.url}))');console.log(JSON.stringify(report.networkDiagnostics));throw error; }
    report.networkEvidence=await loggerValue('(()=>{const e=ENTRIES.find(e=>e.host==="google-analytics.com"&&e.action==="blocked");return {host:e.host,action:e.action,rule:e.rule,source:e.source};})()');
    assert(!hits.some(h=>h.host.startsWith('www.google-analytics.com:')),'tracker stays blocked before fixture receipt');
    await loggerValue('document.querySelector(\'[data-tracker-identity="google_analytics"]\').closest("tr").click();true');
    await until(()=>loggerValue('document.getElementById("rows").textContent.includes("Catalog hostname match")'),'network detail evidence');
    report.checks.push('A real blocked tracker request retains its outcome and shows source, category, company and match evidence');
    const next=JSON.parse(original);next.source.revision='b'.repeat(40);next.source.updatedAt=new Date().toISOString();next.trackers.find(t=>t.id==='google_analytics').name='Updated Analytics <img src=x onerror=alert(1)>';
    fs.writeFileSync(dataFile,JSON.stringify(next));
    await activityValue('document.getElementById("refresh-tracker-names").click();true');
    await loggerValue('document.getElementById("refresh-tracker-names").click();true');
    await until(()=>activityValue('document.querySelector(\'[data-tracker-identity="google_analytics"]\')?.textContent.startsWith("Updated Analytics")'),'same-page metadata replacement');
    await until(()=>loggerValue('document.querySelector(\'[data-tracker-identity="google_analytics"]\')?.textContent.startsWith("Updated Analytics")'),'logger replacement');
    assert.equal(await activityValue('document.querySelectorAll("#rows img").length'),0,'metadata remains text');
    report.checks.push('A complete metadata replacement refreshes both open pages without restart; markup is rendered as text');
    const stale=JSON.parse(original);stale.source.updatedAt=new Date(Date.now()-366*86400000).toISOString();
    for(const body of ['{',original.toString(),JSON.stringify(stale)]) {
      fs.writeFileSync(dataFile,body);await activityValue('document.getElementById("refresh-tracker-names").click();true');
      await activityValue('trackerCatalogLoader.refresh().then(()=>true)');
      await until(()=>activityValue('document.getElementById("tracker-catalog-status").textContent.includes("keeping previous names")'),'invalid metadata fallback');
      assert(await activityValue('document.querySelector(\'[data-tracker-identity="google_analytics"]\').textContent.startsWith("Updated Analytics")'));
    }
    report.checks.push('Malformed, rolled-back and year-stale metadata retain the last validated identity snapshot');
    assert.deepEqual(await rules(),before);assert.deepEqual(await worker('chrome.permissions.getAll()'),permissions);
    assert.deepEqual(await worker("chrome.storage.local.get('wardenone_config')"),config);
    report.checks.push('Installed rules, settings and granted permissions are unchanged by attribution and refresh failures');
    fs.writeFileSync(dataFile,original);
    const restored=await attach('chrome-extension://'+ext.id+'/history.html');
    await until(()=>evaluate(cdp,restored.sessionId,'document.querySelector(\'[data-tracker-identity="google_analytics"]\')?.textContent.startsWith("Google Analytics")'),'original catalog restored');
    await evaluate(cdp,restored.sessionId,'document.getElementById("activity").scrollIntoView({block:"start"});true');
    const screenshot=(await cdp.send('Page.captureScreenshot',{format:'png'},restored.sessionId)).data;fs.writeFileSync(out.replace(/\.json$/,'.png'),Buffer.from(screenshot,'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},restored.sessionId);
    await evaluate(cdp,restored.sessionId,'document.getElementById("activity").scrollIntoView({block:"start"});true');
    fs.writeFileSync(out.replace(/\.json$/,'-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'},restored.sessionId)).data,'base64'));
    report.complete=true;
  }catch(error){report.error=error.stack||String(error);throw error;}
  finally {
    fs.writeFileSync(dataFile,original);
    if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}
    await new Promise(resolve=>server.close(resolve));
    assert.equal(fingerprint(runtime).sha256,identity.sha256,'test-only metadata changes restored');
    await sleep(1000);cleanupProfile(dir,'wo-attribution-profile-');cleanupProfile(runtime,'wo-attribution-runtime-');
    fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  }
  console.log('[ok] '+report.browser+': '+report.checks.length+' native attribution, refresh, safety and enforcement checks');
}
profile.mustFinish(run,'browser-tracker-attribution').catch(error=>{console.error(error.stack||error);process.exitCode=1;});

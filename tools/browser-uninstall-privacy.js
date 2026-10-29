/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),{cleanupProfile}=require('./lib/browser-profile-cleanup.js');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(150);}throw Error('Timed out: '+label);}
async function evaluate(cdp,session,expression){const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function popup(cdp,id){const targetId=(await cdp.send('Target.createTarget',{url:'chrome-extension://'+id+'/popup.html'})).targetId,session=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;await cdp.send('Runtime.enable',{},session);await until(()=>evaluate(cdp,session,'document.readyState==="complete"'),'popup');return{targetId,session};}
async function main(out){if(out&&fs.existsSync(out))throw Error('Preserve existing evidence');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-uninstall-privacy-')),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).version;
  const report={schemaVersion:1,createdAt:new Date().toISOString(),complete:false};let cdp,port;
  const launch=async()=>{port=await profile.freePort();const native=await profile.launch(profile.edgePath(),'on',root,port,dir,['--host-resolver-rules=MAP * ~NOTFOUND']);cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();report.browser=native.Browser;return profile.extensionReady(cdp,port,version);};
  const close=async()=>{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();cdp=null;}};
  try{let ext=await launch(),id=ext.id,ui=await popup(cdp,id);report.extensionId=id;
    await evaluate(cdp,ui.session,"chrome.storage.local.set({wardenone_history:[{url:'https://g06-uninstall.example.org/private',at:Date.now()}],wardenone_config:{enabled:true,downloadSafeBrowsingKey:'G06_UNINSTALL_SECRET'}}).then(()=>{localStorage.setItem('g06-uninstall','G06_UNINSTALL_SECRET');return true;})");
    const seeded=await evaluate(cdp,ui.session,"chrome.storage.local.get(['wardenone_history','wardenone_config']).then(s=>!!s.wardenone_history?.length&&s.wardenone_config?.downloadSafeBrowsingKey==='G06_UNINSTALL_SECRET'&&localStorage.getItem('g06-uninstall')==='G06_UNINSTALL_SECRET')");
    assert(seeded,'uninstall sentinel was not seeded');
    await evaluate(cdp,ui.session,'setTimeout(()=>chrome.management.uninstallSelf({showConfirmDialog:false}).catch(()=>{}),100);true');
    await until(async()=>!(await cdp.send('Target.getTargets')).targetInfos.some(t=>t.url.startsWith('chrome-extension://'+id+'/')),'extension targets removed',45000);
    report.uninstallTargetsGone=true;await close();
    ext=await launch();assert.equal(ext.id,id,'reinstalled extension identity changed');ui=await popup(cdp,id);
    const after=await evaluate(cdp,ui.session,"Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)]).then(([local,session])=>({history:JSON.stringify(local.wardenone_history||[]).includes('g06-uninstall.example.org'),key:local.wardenone_config?.downloadSafeBrowsingKey==='G06_UNINSTALL_SECRET',session:JSON.stringify(session).includes('G06_UNINSTALL_SECRET'),dom:localStorage.getItem('g06-uninstall')==='G06_UNINSTALL_SECRET'}))");
    assert.deepEqual(after,{history:false,key:false,session:false,dom:false},'reinstalled extension could read pre-uninstall data');
    report.reinstallStateClean=true;report.complete=true;
  }finally{await close();if(out){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}cleanupProfile(dir,'wo-uninstall-privacy-');}
  console.log('[ok] uninstall removes extension targets and reinstall cannot read prior activity, key or DOM storage');
}
if(require.main===module)profile.mustFinish(()=>main(process.argv[2]),'uninstall privacy').catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};

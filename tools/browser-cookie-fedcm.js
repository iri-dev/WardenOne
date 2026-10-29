/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https');
const root=path.resolve(__dirname,'..'),p=require(path.join(root,'tools/perf-profile.js'));
const {tls}=require(path.join(root,'tools/browser-media-security.js'));
const {evaluate,until}=require(path.join(root,'tools/prepare-ghostery-performance.js'));
const {ready:badgerReady}=require(path.join(root,'tools/probe-privacy-badger.js'));
const {cleanupProfile}=require(path.join(root,'tools/lib/browser-profile-cleanup.js'));
const {verifyBuild,sha256}=require('./lib/privacy-baseline.js');
let builds,browserPath,out;
const versions={};
const RP='https://shop.cookie-fedcm.example.org',IDP='https://accounts.google.com',hits=[];
const server=https.createServer(tls,(req,res)=>{
 const url=new URL(req.url,'https://'+req.headers.host),sent=(req.headers.cookie||'').includes('fedcm_session=fixed');
 hits.push({host:url.hostname,path:url.pathname,sent,destination:req.headers['sec-fetch-dest']||'',method:req.method});
 res.setHeader('Access-Control-Allow-Origin',RP);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Cache-Control','no-store');
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
 if(url.pathname==='/.well-known/web-identity')return json({provider_urls:[IDP+'/fedcm.json']});
 if(url.pathname==='/fedcm.json')return json({accounts_endpoint:'/accounts',id_assertion_endpoint:'/assertion',client_metadata_endpoint:'/metadata',login_url:'/login'});
 if(url.pathname==='/accounts')return json({accounts:sent?[{id:'fixture-account',name:'Fixture Person',email:'fixture@idp.example',approved_clients:['fixture-client']}]:[]});
 if(url.pathname==='/metadata')return json({privacy_policy_url:IDP+'/privacy',terms_of_service_url:IDP+'/terms'});
 if(url.pathname==='/assertion')return json(sent?{token:'fixture-token'}:{error:{code:'invalid_request'}});
 res.setHeader('Content-Type','text/html');
 if(url.pathname==='/login'){res.setHeader('Set-Login','logged-in');res.setHeader('Set-Cookie','fedcm_session=fixed; Secure; HttpOnly; SameSite=None; Path=/');}
 res.end('<!doctype html><title>FedCM fixture</title><p>Local identity fixture</p>');
});
const report={createdAt:new Date().toISOString(),results:[],complete:false,scope:'Real browser FedCM protocol with loopback RP/IdP and a synthetic HttpOnly session. No external Google account or credential.'};
async function run(label,repetition){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wo-cookie-fedcm-')),port=await p.freePort();let cdp;
 const row={label,repetition,complete:false,dialogs:[]},from=hits.length;
 try{
  const b=await p.launch(browserPath,label==='off'?'off':'on',builds[label]||'',port,directory,['--host-resolver-rules=MAP shop.cookie-fedcm.example.org 127.0.0.1, MAP accounts.google.com 127.0.0.1, MAP google.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--ignore-certificate-errors','--no-proxy-server']);row.browser=b.Browser;
  cdp=new p.Cdp(b.webSocketDebuggerUrl);await cdp.connect();
  if(label!=='off'){
   const ext=label==='privacybadger'?await badgerReady(cdp):await p.extensionReady(cdp,port,versions.candidate);
   if(label==='candidate')await until(()=>evaluate(cdp,ext.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'),'FedCM policy');
   await p.closeExtensionTabs(cdp,port,ext.id);
  }
  const {targetId}=await cdp.send('Target.createTarget',{url:IDP+'/login'}),s=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await cdp.send('Page.enable',{},s);await cdp.send('FedCm.enable',{disableRejectionDelay:true},s);
  cdp.on(e=>{if(e.sessionId===s&&e.method==='FedCm.dialogShown'){
   const d=e.params;row.dialogs.push({type:d.dialogType,accounts:d.accounts.length});
   if(d.accounts.length)cdp.send('FedCm.selectAccount',{dialogId:d.dialogId,accountIndex:0},s).catch(e=>{row.dialogError=String(e.message);});
  }});
  await until(()=>evaluate(cdp,s,'location.hostname==="accounts.google.com"&&document.readyState==="complete"'),'IdP login');
  await cdp.send('Page.navigate',{url:RP+'/'},s);await until(()=>evaluate(cdp,s,'location.hostname==="shop.cookie-fedcm.example.org"&&document.readyState==="complete"'),'RP');
  await cdp.send('Page.bringToFront',{},s);
  row.outcome=await evaluate(cdp,s,`navigator.credentials.get({identity:{providers:[{configURL:${JSON.stringify(IDP+'/fedcm.json')},clientId:'fixture-client',nonce:'fixture'}],mode:'active'},mediation:'required',signal:AbortSignal.timeout(15000)}).then(c=>({token:c.token})).catch(e=>({error:e.name,message:e.message}))`);
  row.complete=row.outcome.token==='fixture-token';
 }catch(e){row.error=String(e.stack||e);}
 finally{row.requests=hits.slice(from);if(cdp){await p.killBrowser(cdp,port).catch(()=>{});cdp.close();}cleanupProfile(directory,'wo-cookie-fedcm-');}
 return row;
}
async function main(){
 const [snapshotFile,output,runsArg='3']=process.argv.slice(2);
 if(!snapshotFile||!output||! /^[1-5]$/.test(runsArg)||fs.existsSync(output))throw Error('Use snapshots.json new-report.json [1..5]');
 const snapshots=JSON.parse(fs.readFileSync(snapshotFile));browserPath=snapshots.browserPath;out=path.resolve(output);
 if(sha256(fs.readFileSync(browserPath))!==snapshots.browserSha256)throw Error('Browser identity changed');
 builds={};for(const label of ['candidate','privacybadger']){const build=snapshots.builds.find(b=>b.label===label);verifyBuild(build);builds[label]=build.directory;versions[label]=build.version;}
 report.snapshots=snapshots;report.harnessSha256=sha256(fs.readFileSync(__filename));
 fs.mkdirSync(path.dirname(out),{recursive:true});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(443,'127.0.0.1',resolve);});
 try{for(let n=0;n<Number(runsArg);n++)for(const label of n%2?['privacybadger','candidate','off']:['off','candidate','privacybadger']){const row=await run(label,n);report.results.push(row);fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(label+' '+n+': '+JSON.stringify(row.outcome||row.error));if(!row.complete)throw Error('FedCM failed for '+label);}report.complete=true;}
 finally{fs.writeFileSync(out,JSON.stringify(report,null,2));await new Promise(r=>server.close(r));}
 if(!report.complete)process.exitCode=1;
}
if(require.main===module)p.mustFinish(main,'FedCM cookie compatibility').catch(e=>{console.error(e);process.exitCode=1;});

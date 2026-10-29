/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https'),crypto=require('crypto'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),{cleanupProfile}=require('./lib/browser-profile-cleanup.js'),{tls}=require('./browser-media-security.js');
const {build}=require('./lib/outbound-inventory.js');
const root=path.resolve(__dirname,'..'),host='site.g06-audit.example.org',tracker='tracker.g06-audit.example.net';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(cdp,session,expression){const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100);}throw Error('Timed out: '+label);}
function server(){return https.createServer(tls,(request,response)=>{response.setHeader('Cache-Control','no-store');if(request.url==='/first-party.js'){response.setHeader('Content-Type','application/javascript');response.end('window.g06PageReady=true');return;}if(request.url==='/pixel'){response.setHeader('Content-Type','image/gif');response.end(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64'));return;}response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><title>Privacy fixture</title><script src="/first-party.js"></script><img src="https://'+tracker+':'+request.socket.localPort+'/pixel"><p>Normal browsing fixture</p>');});}
function captureScript(){return `(async()=>{globalThis.__g06Captured=[];globalThis.__g06NativeFetch=fetch;globalThis.fetch=async(input,options)=>{const url=String(input&&input.url||input);if(/^https?:/.test(url)){__g06Captured.push({url,method:options?.method||'GET',body:String(options?.body||''),headers:options?.headers||{},credentials:options?.credentials||''});return new Response('{}',{status:200,headers:{'content-type':'application/json'}});}return __g06NativeFetch(input,options);};return true;})()`;}
async function main(out){if(out&&fs.existsSync(out))throw Error('Preserve existing evidence');const inventory=build(root),dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-outbound-privacy-')),port=await profile.freePort(),fixture=server();let cdp;
  const report={schemaVersion:1,createdAt:new Date().toISOString(),browser:null,inventoryHosts:inventory.entries.length,normal:null,providers:[],complete:false};
  try{await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const fixturePort=fixture.address().port;
    const spki=crypto.createHash('sha256').update(new crypto.X509Certificate(tls.cert).publicKey.export({format:'der',type:'spki'})).digest('base64');
    const native=await profile.launch(profile.edgePath(),'on',root,port,dir,['--no-proxy-server','--ignore-certificate-errors-spki-list='+spki,'--host-resolver-rules=MAP '+host+' 127.0.0.1, MAP '+tracker+' 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']);
    report.browser=native.Browser;cdp=new profile.Cdp(native.webSocketDebuggerUrl);await cdp.connect();
    const version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).version,extension=await profile.extensionReady(cdp,port,version);
    await until(()=>evaluate(cdp,extension.attachedSession,'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'),'reconciliation');
    await evaluate(cdp,extension.attachedSession,'Promise.all([...__subsystemQueues.values()]).then(()=>true)');
    await evaluate(cdp,extension.attachedSession,'updateStoredConfig(c=>{c.autoUpdateLists=false;c.downloadSafeBrowsing=false;c.phishTank=false;c.openPhish=false;c.abuseIpDb=false;c.urlHaus=false;c.whoisXml=false;c.whoisXmlReputation=false;c.whoisXmlThreatIntel=false;c.downloadVirusTotal=false;c.downloadVirusTotalHash=false;c.loginAgeCheck=false;c.downloadDomainAge=false;}).then(()=>true)');
    await profile.closeExtensionTabs(cdp,port,extension.id);
    const traffic=[],targetBySession=new Map([[extension.attachedSession,'worker']]);
    cdp.on(event=>{if(event.method==='Network.requestWillBeSent'&&targetBySession.has(event.sessionId)){const url=event.params.request.url;if(/^https?:/.test(url))traffic.push({target:targetBySession.get(event.sessionId),url,initiator:event.params.initiator?.type||''});}});
    await cdp.send('Network.enable',{},extension.attachedSession);
    const pageTarget=(await cdp.send('Target.createTarget',{url:'about:blank'})).targetId,page=(await cdp.send('Target.attachToTarget',{targetId:pageTarget,flatten:true})).sessionId;
    targetBySession.set(page,'page');await cdp.send('Runtime.enable',{},page);await cdp.send('Network.enable',{},page);
    const visited='https://'+host+':'+fixturePort+'/login/route?access_token=G06_QUERY_SECRET#G06_FRAGMENT_SECRET';
    await cdp.send('Page.navigate',{url:visited},page);await until(()=>evaluate(cdp,page,'document.readyState==="complete"&&window.g06PageReady===true'),'fixture page');
    await evaluate(cdp,extension.attachedSession,"noteTrackerObservation('https://site.g06-audit.example.org/landing',{domain:'tracker.g06-audit.example.net',signal:'tracking-path'}).then(()=>true)");
    await evaluate(cdp,extension.attachedSession,"queueHistory({type:'blocked_popup',url:'https://site.g06-audit.example.org/reset/G06_PATH_SECRET?token=G06_QUERY_SECRET#G06_FRAGMENT_SECRET',at:Date.now()});flushHistory();true");
    await sleep(3000);
    const local=await evaluate(cdp,extension.attachedSession,"chrome.storage.local.get(['wardenone_tracker_learner','wardenone_history']).then(s=>({normalized:normalizeTrackerDomain('tracker.g06-audit.example.net'),domains:Object.keys(s.wardenone_tracker_learner?.domains||{}),history:JSON.stringify(s.wardenone_history||[])}))");
    const external=traffic.filter(x=>x.target==='worker'&&![host,tracker].includes(new URL(x.url).hostname));
    assert.equal(external.length,0,'ordinary browsing contacted an external worker destination');
    assert(local.domains.includes(local.normalized),'tracker observation did not stay in local storage: '+JSON.stringify(local));
    assert(local.history.includes('site.g06-audit.example.org')&&!/G06_(?:PATH|QUERY|FRAGMENT)_SECRET/.test(local.history),'history redaction');
    report.normal={workerExternalRequests:external.length,workerHosts:[...new Set(traffic.filter(x=>x.target==='worker').map(x=>new URL(x.url).hostname))],pageHosts:[...new Set(traffic.filter(x=>x.target==='page').map(x=>new URL(x.url).hostname))],trackerObservationLocal:true,historyRedacted:true,seconds:3};
    await evaluate(cdp,extension.attachedSession,captureScript());
    const switches=['downloadSafeBrowsing','phishTank','openPhish','abuseIpDb','urlHaus','whoisXml','whoisXmlReputation','whoisXmlThreatIntel'];
    const keys={downloadSafeBrowsing:'downloadSafeBrowsingKey',phishTank:'phishTankKey',abuseIpDb:'abuseIpDbKey',urlHaus:'urlHausKey',whoisXml:'whoisXmlKey',whoisXmlReputation:'whoisXmlKey',whoisXmlThreatIntel:'whoisXmlKey'};
    const expected={downloadSafeBrowsing:'safebrowsing.googleapis.com',phishTank:'checkurl.phishtank.com',openPhish:'raw.githubusercontent.com',abuseIpDb:'api.abuseipdb.com',urlHaus:'urlhaus-api.abuse.ch',whoisXml:'www.whoisxmlapi.com',whoisXmlReputation:'domain-reputation.whoisxmlapi.com',whoisXmlThreatIntel:'threat-intelligence.whoisxmlapi.com'};
    const queryUrl='https://g06-user:G06_PASSWORD@g06-audit.net/login/route?access_token=G06_QUERY_SECRET#G06_FRAGMENT_SECRET';
    const policy=Object.fromEntries(switches.map(key=>[key,false]));
    for(const enabled of ['none',...switches]){
      const config={...policy,downloadSafeBrowsingKey:'',phishTankKey:'',abuseIpDbKey:'',urlHausKey:'',whoisXmlKey:''};if(enabled!=='none'){config[enabled]=true;if(keys[enabled])config[keys[enabled]]='G06_TEST_KEY';}
      if(enabled!=='none'&&keys[enabled]){
        const noKey={...config,[keys[enabled]]:''};await evaluate(cdp,extension.attachedSession,'updateStoredConfig(c=>Object.assign(c,'+JSON.stringify(noKey)+')).then(()=>true)');
        await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
        await evaluate(cdp,extension.attachedSession,'urlReputationLookupUrl('+JSON.stringify(queryUrl)+',{context:"page"}).then(()=>true)');
        assert.equal((await evaluate(cdp,extension.attachedSession,'__g06Captured')).length,0,enabled+' called a provider without a key');
      }
      await evaluate(cdp,extension.attachedSession,'updateStoredConfig(c=>Object.assign(c,'+JSON.stringify(config)+')).then(()=>true)');
      await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
      const url=enabled==='abuseIpDb'?queryUrl.replace('g06-audit.net','93.184.216.34'):queryUrl;
      await evaluate(cdp,extension.attachedSession,'urlReputationLookupUrl('+JSON.stringify(url)+',{context:"page"}).then(()=>true)');
      const requests=await evaluate(cdp,extension.attachedSession,'__g06Captured');
      const hosts=requests.map(x=>new URL(x.url).hostname);
      if(enabled==='none')assert.equal(requests.length,0,'optional lookup ran when all switches were off');
      else assert(hosts.includes(expected[enabled]),enabled+' did not call its provider: '+JSON.stringify(hosts));
      assert(!JSON.stringify(requests).includes('G06_QUERY_SECRET')&&!JSON.stringify(requests).includes('G06_FRAGMENT_SECRET')&&!JSON.stringify(requests).includes('G06_PASSWORD'),'provider received URL query, fragment or userinfo');
      report.providers.push({switch:enabled,requestHosts:hosts,requestCount:requests.length,queryFragmentCredentialsAbsent:true});
    }
    await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
    await evaluate(cdp,extension.attachedSession,'enrichDownloadWithExternalReputation({score:0,reasons:[],action:"allow"},'+JSON.stringify(queryUrl)+',{downloadVirusTotal:false,downloadVirusTotalKey:"G06_TEST_KEY"}).then(()=>true)');
    assert.equal((await evaluate(cdp,extension.attachedSession,'__g06Captured')).length,0,'VirusTotal download lookup ran while off');
    await evaluate(cdp,extension.attachedSession,'enrichDownloadWithExternalReputation({score:0,reasons:[],action:"allow"},'+JSON.stringify(queryUrl)+',{downloadVirusTotal:true,downloadVirusTotalKey:"G06_TEST_KEY"}).then(()=>true)');
    let requests=await evaluate(cdp,extension.attachedSession,'__g06Captured');
    assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).hostname,'www.virustotal.com');
    const vtId=new URL(requests[0].url).pathname.split('/').pop();
    assert.equal(Buffer.from(vtId,'base64url').toString(),'https://g06-audit.net/login/route');
    report.providers.push({switch:'downloadVirusTotal',requestHosts:['www.virustotal.com'],requestCount:1,queryFragmentCredentialsAbsent:true});
    await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
    await evaluate(cdp,extension.attachedSession,'enrichDownloadWithVirusTotalHash({score:0,reasons:[]},"https://g06-audit.net/file.exe","file.exe",{downloadVirusTotalHash:false,downloadVirusTotalKey:"G06_TEST_KEY"}).then(()=>true)');
    assert.equal((await evaluate(cdp,extension.attachedSession,'__g06Captured')).length,0,'VirusTotal hash lookup ran while off');
    await evaluate(cdp,extension.attachedSession,'checkVirusTotalFileHash("'+('a'.repeat(64))+'","G06_TEST_KEY").then(()=>true)');
    requests=await evaluate(cdp,extension.attachedSession,'__g06Captured');assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).pathname,'/api/v3/files/'+('a'.repeat(64)));
    report.providers.push({switch:'downloadVirusTotalHash',requestHosts:['www.virustotal.com'],requestCount:1,hashOnly:true});
    const uiTarget=(await cdp.send('Target.createTarget',{url:'chrome-extension://'+extension.id+'/popup.html'})).targetId,ui=(await cdp.send('Target.attachToTarget',{targetId:uiTarget,flatten:true})).sessionId;
    await cdp.send('Runtime.enable',{},ui);await until(()=>evaluate(cdp,ui,'document.readyState==="complete"&&!!document.getElementById("ss-pwned")'),'popup');
    await evaluate(cdp,extension.attachedSession,'updateStoredConfig(c=>Object.assign(c,'+JSON.stringify({...policy,downloadVirusTotal:false,downloadVirusTotalKey:''})+')).then(()=>true)');
    await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
    await evaluate(cdp,ui,'chrome.runtime.sendMessage({kind:"scan-url-virustotal",url:'+JSON.stringify(queryUrl)+'}).then(()=>true)');
    assert.equal((await evaluate(cdp,extension.attachedSession,'__g06Captured')).length,0,'manual VirusTotal scan ran without a key');
    await evaluate(cdp,extension.attachedSession,'updateStoredConfig(c=>Object.assign(c,{downloadVirusTotal:false,downloadVirusTotalKey:"G06_TEST_KEY"})).then(()=>true)');
    await evaluate(cdp,ui,'chrome.runtime.sendMessage({kind:"scan-url-virustotal",url:'+JSON.stringify(queryUrl)+'}).then(()=>true)');
    requests=await evaluate(cdp,extension.attachedSession,'__g06Captured');assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).hostname,'www.virustotal.com');
    assert.equal(Buffer.from(new URL(requests[0].url).pathname.split('/').pop(),'base64url').toString(),queryUrl,'manual scan must retain the user-selected URL');
    report.providers.push({switch:'manualVirusTotalClick',requestHosts:['www.virustotal.com'],requestCount:1,selectedUrlSent:true,automaticSwitchOff:true});
    await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
    await evaluate(cdp,ui,'chrome.runtime.sendMessage({kind:"site-breach",domain:"login.g06-audit.net"}).then(()=>true)');
    requests=await evaluate(cdp,extension.attachedSession,'__g06Captured');assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).hostname,'haveibeenpwned.com');assert.equal(new URL(requests[0].url).searchParams.get('Domain'),'g06-audit.net');
    report.providers.push({switch:'site-breach-click',requestHosts:['haveibeenpwned.com'],requestCount:1,registrableDomainOnly:true});
    await evaluate(cdp,extension.attachedSession,'updateStoredConfig(c=>Object.assign(c,'+JSON.stringify({...policy,whoisXmlKey:''})+')).then(()=>true)');
    await evaluate(cdp,extension.attachedSession,'(__g06Captured.length=0,true)');
    await evaluate(cdp,ui,'chrome.runtime.sendMessage({kind:"domain-age",domain:"login.g06-audit.net"}).then(()=>true)');
    requests=await evaluate(cdp,extension.attachedSession,'__g06Captured');assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).hostname,'rdap.org');assert.equal(new URL(requests[0].url).pathname,'/domain/g06-audit.net');
    report.providers.push({switch:'domain-age-click',requestHosts:['rdap.org'],requestCount:1,registrableDomainOnly:true});
    await evaluate(cdp,ui,'globalThis.__g06PopupRequests=[];globalThis.__g06PopupFetch=fetch;fetch=async(u,o)=>{__g06PopupRequests.push({url:String(u),method:o?.method||"GET",body:String(o?.body||"")});return new Response("",{status:200});};true');
    await evaluate(cdp,ui,'document.getElementById("ss-pwned-input").value="G06_PASSWORD_TEST";document.getElementById("ss-pwned").click();true');
    await until(()=>evaluate(cdp,ui,'__g06PopupRequests.length===1'),'password range request');
    const pwned=await evaluate(cdp,ui,'({requests:__g06PopupRequests,input:document.getElementById("ss-pwned-input").value})');
    assert.equal(pwned.requests.length,1);assert(/^https:\/\/api\.pwnedpasswords\.com\/range\/[A-F0-9]{5}$/.test(pwned.requests[0].url));assert.equal(pwned.requests[0].body,'');
    await until(()=>evaluate(cdp,ui,'document.getElementById("ss-pwned-input").value===""'),'password input cleared');
    report.providers.push({switch:'password-check-click',requestHosts:['api.pwnedpasswords.com'],requestCount:1,fiveCharacterHashPrefixOnly:true});
    await evaluate(cdp,ui,"chrome.storage.local.set({wardenone_history:[{type:'blocked_popup',url:'https://stale.g06-audit.net/',at:Date.now()-31*86400000},{type:'blocked_popup',url:'https://fresh.g06-audit.net/',at:Date.now()}]}).then(()=>true)");
    const history=await evaluate(cdp,ui,'chrome.runtime.sendMessage({kind:"history-get"})');
    assert(history?.ok&&history.history.some(x=>x.url?.includes('fresh.g06-audit.net'))&&!history.history.some(x=>x.url?.includes('stale.g06-audit.net')),'expired history visible after read');
    report.retention={expiredHistoryHidden:true,freshHistoryRetained:true};
    await cdp.send('Target.closeTarget',{targetId:uiTarget});
    report.complete=true;
    await cdp.send('Target.closeTarget',{targetId:pageTarget});
  }finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}await new Promise(resolve=>fixture.close(resolve));if(out){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}cleanupProfile(dir,'wo-outbound-privacy-');}
  console.log('[ok] native outbound traffic, local observations, history redaction and optional reputation boundaries');
}
if(require.main===module)profile.mustFinish(()=>main(process.argv[2]),'outbound privacy').catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};

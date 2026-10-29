/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),identity=require('./lib/privacy-baseline.js'),{tls}=require('./browser-media-security.js');
const HOST='alpha.fp-suite.test',CROSS='cross.fp-other.test',EXCLUDED='accounts.google.com';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(cdp,session,expression,contextId){const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true,...(contextId?{contextId}:{})},session);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(check,label){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await sleep(50);}throw Error('Timed out: '+label);}
async function probe(){
  const hash=bytes=>{let h=2166136261;for(const b of bytes)h=Math.imul(h^b,16777619);return(h>>>0).toString(16);};
  const descriptor=(proto,name)=>{const d=Object.getOwnPropertyDescriptor(proto,name),f=d?.value;return d?{own:true,enumerable:d.enumerable,writable:d.writable,configurable:d.configurable,name:f?.name,length:f?.length,prototype:f?Object.hasOwn(f,'prototype'):null,native:f?/\[native code\]/.test(Function.prototype.toString.call(f)):null}:null;};
  const r={noise:window.__wardenOneRealm?.noise??null,language:navigator.language,languages:[...navigator.languages],zone:Intl.DateTimeFormat().resolvedOptions().timeZone,offset:new Date().getTimezoneOffset(),cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory,
    descriptors:{audio:descriptor(AudioBuffer.prototype,'getChannelData'),text:descriptor(CanvasRenderingContext2D.prototype,'measureText'),rect:descriptor(Element.prototype,'getClientRects'),function:descriptor(Function.prototype,'toString')}};
  const audio=new AudioContext({sampleRate:44100}),b=audio.createBuffer(1,512,44100),raw=b.getChannelData(0);
  r.audio={rate:audio.sampleRate,zero:raw.every(x=>x===0)};raw[0]=.25;raw[100]=.5;
  const copy=new Float32Array(512);b.copyFromChannel(copy,0);r.audio.copy=copy[0]===.25&&copy[100]===.5;
  b.copyToChannel(new Float32Array([.75]),0);r.audio.write=b.getChannelData(0)[0]===.75&&raw[100]===.5;
  r.audio.same=b.getChannelData(0)===raw;
  try{AudioBuffer.prototype.getChannelData.call({},0);r.audio.badReceiver=false;}catch(e){r.audio.badReceiver=e.name==='TypeError';}
  const offAudio=new OfflineAudioContext(1,256,44100),input=offAudio.createBuffer(1,256,44100);input.getChannelData(0).fill(.25);
  const source=offAudio.createBufferSource(),analyser=offAudio.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=0;source.buffer=input;source.connect(analyser);analyser.connect(offAudio.destination);source.start();
  const rendered=await offAudio.startRendering();r.audio.renderExact=rendered.getChannelData(0).every(x=>x===.25);
  const fa=new Float32Array(128),fb=new Float32Array(128);analyser.getFloatFrequencyData(fa);analyser.getFloatFrequencyData(fb);
  r.audio.finiteFrequency=fa.filter(Number.isFinite).length;r.audio.frequencyStable=fa.every((x,i)=>x===fb[i]);
  await audio.close();
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#336699';ctx.fillRect(0,0,128,64);ctx.font='16px sans-serif';ctx.fillStyle='white';ctx.fillText('Editing',8,32);
  const pixels=ctx.getImageData(0,0,128,64),first=hash(pixels.data),url=canvas.toDataURL();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve)),off=new OffscreenCanvas(128,64),oc=off.getContext('2d');oc.drawImage(canvas,0,0);oc.font=ctx.font;
  r.canvas={pixels:first,repeat:first===hash(ctx.getImageData(0,0,128,64).data),exportStable:url===canvas.toDataURL(),blob:!!blob&&blob.size>0,
    offscreenPixels:hash(oc.getImageData(0,0,128,64).data),offscreenBlob:(await off.convertToBlob()).size,
    text:ctx.measureText('Editing').width,textRepeat:ctx.measureText('Editing').width,offscreenText:oc.measureText('Editing').width,empty:ctx.measureText('').width,
    metricsType:Object.getPrototypeOf(ctx.measureText('Editing'))===TextMetrics.prototype};
  const box=document.createElement('div');box.style.cssText='position:absolute;left:20px;top:20px;width:201.25px;height:54.25px;white-space:nowrap';box.contentEditable='true';box.textContent='editable text';document.body.append(box);
  const rect=box.getBoundingClientRect(),list=box.getClientRects(),tuple=x=>[x.x,x.y,x.width,x.height];
  const range=document.createRange();range.selectNodeContents(box);const rangeBox=range.getBoundingClientRect(),rangeList=range.getClientRects();
  r.layout={box:tuple(rect),client:tuple(list[0]),sameItem:list.item(0)===list[0],iterated:[...list][0]===list[0],type:Object.getPrototypeOf(list)===DOMRectList.prototype,
    nullItem:list.item(99)===null,rangeBox:tuple(rangeBox),rangeClient:tuple(rangeList[0])};
  box.focus();getSelection().removeAllRanges();getSelection().addRange(range);document.execCommand('insertText',false,'edited');r.editing=box.textContent==='edited';
  const counts={text:10000,rect:10000,clientRects:10000,audioReads:10000};r.hooks={counts};
  for(const [name,fn]of Object.entries({text:()=>ctx.measureText('Editing').width,rect:()=>box.getBoundingClientRect().width,clientRects:()=>box.getClientRects()[0].width,audioReads:()=>b.getChannelData(0)[0]})){
    let sum=0;const start=performance.now();for(let i=0;i<counts[name];i++)sum+=fn();r.hooks[name]={ms:performance.now()-start,sum};
  }
  box.remove();const gl=document.createElement('canvas').getContext('webgl');r.webgl={supported:!!gl};
  if(gl){gl.clearColor(.25,.5,.75,1);gl.clear(gl.COLOR_BUFFER_BIT);const p=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);r.webgl.pixel=[...p];r.webgl.extensions=gl.getSupportedExtensions();
    const ext=gl.getExtension('WEBGL_debug_renderer_info');r.webgl.debug=!!ext;r.webgl.vendor=ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null;
    try{gl.getParameter.call({},37445);r.webgl.badReceiver=false;}catch(e){r.webgl.badReceiver=e.name==='TypeError';}}
  r.webgpu={supported:!!navigator.gpu};
  try{if(navigator.gpu){const adapter=await navigator.gpu.requestAdapter();r.webgpu.adapter=!!adapter;
    if(adapter){const info=adapter.info||(adapter.requestAdapterInfo?await adapter.requestAdapterInfo():null);r.webgpu.info=info?{vendor:info.vendor,architecture:info.architecture,subgroupMinSize:info.subgroupMinSize,subgroupMaxSize:info.subgroupMaxSize,isFallbackAdapter:info.isFallbackAdapter}:null;
      r.webgpu.limit=adapter.limits.maxTextureDimension2D;r.webgpu.infoType=info?Object.getPrototypeOf(info).constructor.name:null;
      const device=await adapter.requestDevice();device.label='usable device';r.webgpu.label=device.label;r.webgpu.deviceLimit=device.limits.maxTextureDimension2D;
      const buffer=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_WRITE|GPUBufferUsage.COPY_SRC,mappedAtCreation:true});new Uint32Array(buffer.getMappedRange())[0]=42;buffer.unmap();buffer.destroy();device.destroy();r.webgpu.usable=true;}}}catch(e){r.webgpu.error=String(e);}
  const devices=await navigator.mediaDevices.enumerateDevices();r.devices={count:devices.length,types:devices.map(x=>Object.getPrototypeOf(x).constructor.name),hidden:devices.every(x=>x.label===''&&x.groupId===''),jsonHidden:devices.every(x=>{const j=x.toJSON();return j.label===''&&j.groupId==='';})};
  const camera=devices.find(x=>x.kind==='videoinput');if(camera){const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:camera.deviceId}}});r.devices.selected=stream.getVideoTracks().length===1;stream.getTracks().forEach(x=>x.stop());}
  const mc={type:'file',video:{contentType:'video/webm; codecs="vp8"',width:640,height:360,bitrate:1000000,framerate:30}};r.media=await navigator.mediaCapabilities.decodingInfo(mc);
  return r;
}
const PROBE='('+probe.toString()+')()';
const WORKER=`async function collect(){const c=new OffscreenCanvas(128,64),x=c.getContext('2d');x.font='16px sans-serif';const out={href:location.href,cores:navigator.hardwareConcurrency,language:navigator.language,text:x.measureText('Editing').width,module:typeof moduleValue==='undefined'?null:moduleValue,canvas:!!await c.convertToBlob()};if(navigator.gpu){const a=await navigator.gpu.requestAdapter();out.gpu=a?{vendor:a.info?.vendor,limit:a.limits.maxTextureDimension2D}:null;}return out;}
if(typeof ServiceWorkerGlobalScope!=='undefined'&&self instanceof ServiceWorkerGlobalScope){self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('message',e=>e.waitUntil(collect().then(value=>e.source.postMessage({token:e.data,value}))));}
else if(typeof SharedWorkerGlobalScope!=='undefined'&&self instanceof SharedWorkerGlobalScope){self.onconnect=e=>{const p=e.ports[0];p.onmessage=()=>collect().then(value=>p.postMessage(value));p.start();};}
else self.onmessage=()=>collect().then(value=>self.postMessage(value));`;
async function workerProbe(){
  const out={};
  for(const [name,type]of[['classic',undefined],['module','module'],['shared',undefined],['shared-module','module']]){
    const w=name.startsWith('shared')?new SharedWorker('/'+name+'.js',{type}):new Worker('/'+name+'.js',{type}),port=w.port||w;
    try{out[name]=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(name+' timeout')),10000);port.onmessage=e=>{clearTimeout(timer);resolve(e.data);};w.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};port.start?.();port.postMessage('probe');});}
    finally{w.terminate?.();w.port?.close();}
  }
  for(const name of['service','module-service']){
    const reg=await navigator.serviceWorker.register('/'+name+'.js',{scope:'/sw-'+name+'/',...(name==='module-service'?{type:'module'}:{})});
    await new Promise((resolve,reject)=>{const start=Date.now(),poll=()=>{if(reg.active)resolve();else if(Date.now()-start>10000)reject(Error(name+' activation timeout'));else setTimeout(poll,30);};poll();});
    const token='fixture-'+name;out[name]=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(name+' message timeout')),10000),handler=e=>{if(e.data.token!==token)return;navigator.serviceWorker.removeEventListener('message',handler);clearTimeout(timer);resolve(e.data.value);};navigator.serviceWorker.addEventListener('message',handler);reg.active.postMessage(token);});await reg.unregister();
  }
  return out;
}
async function run(build,run,options,server){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-fingerprint-')),port=await profile.freePort();let cdp;
  const origin=host=>'https://'+host+':'+server.address().port;
  const result={build:build.label,run,variants:{},complete:false};
  try{
    const launched=await profile.launch(options.browser,'on',build.directory,port,dir,['--host-resolver-rules=MAP '+HOST+' 127.0.0.1, MAP '+CROSS+' 127.0.0.1, MAP '+EXCLUDED+' 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--ignore-certificate-errors','--enable-unsafe-webgpu','--disable-popup-blocking','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']);
    result.browser=launched.Browser;cdp=new profile.Cdp(launched.webSocketDebuggerUrl);await cdp.connect();
    const contexts=new Map();cdp.on(e=>{if(e.method==='Runtime.executionContextCreated'&&e.params.context.auxData?.isDefault)contexts.set(e.sessionId+':'+e.params.context.auxData.frameId,e.params.context.id);});
    const extension=await profile.extensionReady(cdp,port,JSON.parse(fs.readFileSync(path.join(build.directory,'manifest.json'))).version);await profile.closeExtensionTabs(cdp,port,extension.id);
    const bg=expression=>evaluate(cdp,extension.attachedSession,expression);
    const config=async on=>{await bg('updateStoredConfig(c=>{c.antiFingerprintNoise='+on+';c.blockFingerprintScripts=false;c.blockPopupTricks=false;c.blockForcedPopups=false;c.blockCameraMic=false;}).then(()=>true)');await until(()=>bg('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'),'config');};
    for(const variant of['off','on','excluded']){
      await config(variant!=='off');const host=variant==='excluded'?EXCLUDED:HOST;
      const target=await cdp.send('Target.createTarget',{url:'about:blank'}),session=(await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
      await cdp.send('Runtime.enable',{},session);await cdp.send('Page.enable',{},session);await cdp.send('Performance.enable',{},session);
      const navigate=async pathname=>{await cdp.send('Page.navigate',{url:origin(host)+pathname},session);await until(()=>evaluate(cdp,session,'document.readyState==="complete"&&location.hostname==='+JSON.stringify(host)),'page');
        if(variant!=='excluded')await until(()=>evaluate(cdp,session,'window.__wardenOneRealm?.noise==='+String(variant==='on')),'noise verdict');};
      await navigate('/');const before=await cdp.send('Performance.getMetrics',{},session),top=await evaluate(cdp,session,PROBE);
      const row={top,taskAfterLoadSeconds:before.metrics.find(x=>x.name==='TaskDuration')?.value};result.variants[variant]=row;
      if(variant!=='excluded'){
        row.children=[];const tree=(await cdp.send('Page.getFrameTree',{},session)).frameTree;
        for(const childHost of[HOST,CROSS]){
          let childSession=session,frame=tree.childFrames?.find(x=>new URL(x.frame.url).hostname===childHost)?.frame;
          if(!frame){const targets=(await cdp.send('Target.getTargets')).targetInfos;const remote=targets.find(x=>x.type==='iframe'&&x.url.startsWith(origin(childHost)));
            assert(remote,'child target');childSession=(await cdp.send('Target.attachToTarget',{targetId:remote.targetId,flatten:true})).sessionId;await cdp.send('Runtime.enable',{},childSession);await cdp.send('Page.enable',{},childSession);frame=(await cdp.send('Page.getFrameTree',{},childSession)).frameTree.frame;}
          await until(()=>contexts.has(childSession+':'+frame.id),'main frame context');const id=contexts.get(childSession+':'+frame.id);
          await until(()=>evaluate(cdp,childSession,'window.__wardenOneRealm?.noise==='+String(variant==='on'),id),'child verdict');
          row.children.push({host:childHost,result:await evaluate(cdp,childSession,PROBE,id)});
        }
        row.popupOpened=await evaluate(cdp,session,'window.open('+JSON.stringify(origin(HOST)+'/popup')+',"fp-popup")!==null');
        let popup;await until(async()=>{popup=(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.type==='page'&&x.url===origin(HOST)+'/popup');return!!popup;},'popup');
        const ps=(await cdp.send('Target.attachToTarget',{targetId:popup.targetId,flatten:true})).sessionId;
        await until(()=>evaluate(cdp,ps,'window.__wardenOneRealm?.noise==='+String(variant==='on')),'popup verdict');row.popup=await evaluate(cdp,ps,PROBE);await cdp.send('Target.closeTarget',{targetId:popup.targetId});
        await navigate('/csp');row.workers=await evaluate(cdp,session,'('+workerProbe.toString()+')()');
        await navigate('/reload');row.reload=await evaluate(cdp,session,PROBE);
      }
      await cdp.send('HeapProfiler.collectGarbage',{},session);row.pageHeapAfterGcBytes=(await cdp.send('Runtime.getHeapUsage',{},session)).usedSize;
      validate(row,variant,build.label);await cdp.send('Target.closeTarget',{targetId:target.targetId});
    }
    result.complete=true;
  }catch(e){result.error=String(e.stack||e);if(cdp)result.targets=(await cdp.send('Target.getTargets').catch(()=>({targetInfos:[]}))).targetInfos.map(x=>({type:x.type,url:x.url}));}finally{if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}
    const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('wo-fingerprint-'))throw Error('Unexpected profile path');
    try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch(e){result.cleanupWarning=e.message;}}
  return result;
}
function validate(row,variant,build){
  const all=[row.top,...(row.children||[]).map(x=>x.result),row.popup,row.reload].filter(Boolean);
  for(const p of all){assert(p.canvas.repeat&&p.canvas.exportStable&&p.canvas.blob&&p.canvas.offscreenBlob&&p.canvas.metricsType);assert.equal(p.canvas.pixels,p.canvas.offscreenPixels);assert(p.editing&&p.audio.copy&&p.audio.write&&p.audio.same&&p.audio.badReceiver);assert(p.devices.selected,'native camera selection');
    if(build==='candidate'){assert(p.audio.zero&&p.audio.renderExact,'audio samples remain exact');assert(p.audio.frequencyStable,'derived audio snapshot remains stable');assert.equal(p.audio.rate,44100);assert.equal(p.canvas.text,p.canvas.textRepeat);assert.equal(p.canvas.text,p.canvas.offscreenText);assert.equal(p.canvas.empty,0);
      assert.deepEqual(p.layout.box,p.layout.client);assert.deepEqual(p.layout.rangeBox,p.layout.rangeClient);assert(p.layout.type&&p.layout.sameItem&&p.layout.iterated&&p.layout.nullItem);
      assert.equal(p.descriptors.audio.length,1);assert.equal(p.descriptors.text.length,1);assert.equal(p.descriptors.text.prototype,false);assert.equal(p.descriptors.function.prototype,false);if(p.webgl.supported)assert(p.webgl.badReceiver);
      if(p.webgpu.adapter)assert(p.webgpu.usable&&p.webgpu.label==='usable device');
      if(variant==='on')assert(p.devices.hidden&&p.devices.jsonHidden);}
  }
  if(row.workers)for(const[name,w]of Object.entries(row.workers)){assert(w.canvas&&w.cores===row.top.cores);assert(w.href.includes('/'+name+'.js'));if(name.includes('module'))assert.equal(w.module,7);}
  if(row.reload){assert.equal(row.top.canvas.pixels,row.reload.canvas.pixels);assert.equal(row.top.language,row.reload.language);assert.equal(row.top.zone,row.reload.zone);}
}
async function main(options){
  const builds=['reference','candidate'].map(label=>({label,directory:options[label],fingerprint:identity.fingerprint(options[label]).sha256}));
  const report={createdAt:new Date().toISOString(),browserSha256:identity.sha256(fs.readFileSync(options.browser)),toolSha256:identity.sha256(fs.readFileSync(__filename)),builds,machine:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,platform:process.platform,release:os.release()},results:[],complete:false};
  const server=https.createServer(tls,(req,res)=>{const url=new URL(req.url,'https://'+req.headers.host);res.setHeader('Cache-Control','no-store');
    if(url.pathname.endsWith('.js')){res.setHeader('Content-Type','text/javascript');if(url.pathname==='/dependency.js')res.end('export const moduleValue=7;');else res.end((url.pathname.includes('module')?"import {moduleValue} from './dependency.js';\n":'')+WORKER);return;}
    if(url.pathname==='/csp')res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'");
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fingerprint consistency fixture</title><input id="editing" value="editable">'+(url.pathname==='/'&&url.hostname!==EXCLUDED?'<iframe allow="camera;microphone" src="https://'+HOST+':'+server.address().port+'/frame"></iframe><iframe allow="camera;microphone" src="https://'+CROSS+':'+server.address().port+'/frame"></iframe>':''));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const save=()=>{fs.mkdirSync(path.dirname(options.out),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(report,null,2));};
  try{for(let i=1;i<=options.runs;i++)for(const build of i%2?builds:[...builds].reverse()){console.log('Fingerprint '+build.label+' '+i+'/'+options.runs);const row=await run(build,i,options,server);report.results.push(row);save();if(!row.complete)throw Error(row.error);}
    for(const b of builds)assert.equal(identity.fingerprint(b.directory).sha256,b.fingerprint);report.complete=true;
  }finally{save();await new Promise(resolve=>server.close(resolve));}
  console.log('[ok] native audio/canvas/editing, frames/popup/reload, GPU/media, CSP workers and hook measurements');
}
function args(argv){const o={runs:5};for(let i=0;i<argv.length;i+=2){const key=argv[i].slice(2),value=argv[i+1];if(!['browser','reference','candidate','out','runs'].includes(key)||!value)throw Error('Use paired browser/reference/candidate/out/runs options');o[key]=key==='runs'?Number(value):path.resolve(value);}if(!o.browser||!o.reference||!o.candidate||!o.out||!Number.isInteger(o.runs)||o.runs<1||o.runs>10)throw Error('Paths and 1..10 runs required');return o;}
if(require.main===module)profile.mustFinish(()=>main(args(process.argv.slice(2))),'fingerprint browser checks').catch(e=>{console.error(e);process.exitCode=1;});
module.exports={probe,PROBE,WORKER,workerProbe,evaluate,until};

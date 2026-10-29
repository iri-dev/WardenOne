/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),https=require('https'),assert=require('assert/strict');
const profile=require('./perf-profile.js'),identity=require('./lib/privacy-baseline.js');
const {tls}=require('./browser-media-security.js'),{evaluate,until,WORKER,workerProbe}=require('./browser-fingerprint-consistency.js');
const {cleanupProfile}=require('./lib/browser-profile-cleanup.js');
const HOSTS=['one.g04-suite.test','two.g04-other.test','three.g04-third.test'],MEDIA='fixture.googlevideo.com';
async function collect(){
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
  const c=canvas.getContext('2d');c.font='16px sans-serif';c.fillStyle='#368';c.fillRect(0,0,128,64);c.fillStyle='white';c.fillText('Editing',8,32);
  const off=new OffscreenCanvas(128,64),oc=off.getContext('2d');oc.font=c.font;
  const audio=new OfflineAudioContext(1,5000,44100),osc=audio.createOscillator(),compressor=audio.createDynamicsCompressor(),analyser=audio.createAnalyser();
  osc.type='triangle';osc.frequency.value=1000;analyser.fftSize=256;analyser.smoothingTimeConstant=0;
  osc.connect(compressor);compressor.connect(analyser);analyser.connect(audio.destination);osc.start();
  const rendered=await audio.startRendering(),a=new Float32Array(512).fill(17),b=new Float32Array(512).fill(17);
  analyser.getFloatFrequencyData(a);analyser.getFloatFrequencyData(b);
  const tail=a.subarray(analyser.frequencyBinCount).every(x=>x===17),stable=a.every((x,i)=>Object.is(x,b[i]));
  const tests={};let conversions=0;const text={toString(){conversions++;return 'Editing';}};
  tests.textCoercion=c.measureText(text).width===c.measureText('Editing').width&&conversions===1;
  const expected=c.measureText('Editing').width;let fontReads=0;
  Object.defineProperty(c,'font',{get(){fontReads++;return '99px serif';}});c.measureText('Editing');tests.shadowFont=fontReads===0;
  tests.wrongTextReceiver=false;let badConversions=0;
  try{CanvasRenderingContext2D.prototype.measureText.call({},{toString(){badConversions++;return 'x';}});}catch(e){tests.wrongTextReceiver=e.name==='TypeError'&&badConversions===0;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),t=document.createElementNS(svg.namespaceURI,'text');svg.append(t);document.body.append(svg);
  tests.svgZero=t.getComputedTextLength()===0;t.textContent='Editing';tests.svgZero=tests.svgZero&&t.getSubStringLength(0,0)===0;svg.remove();
  const methods=[[CanvasRenderingContext2D.prototype,'measureText',1],[OffscreenCanvasRenderingContext2D.prototype,'measureText',1],
    [SVGTextContentElement.prototype,'getComputedTextLength',0],[SVGTextContentElement.prototype,'getSubStringLength',2],
    [AnalyserNode.prototype,'getFloatFrequencyData',1],[WebGLRenderingContext.prototype,'getExtension',1],
    [WebGLRenderingContext.prototype,'getSupportedExtensions',0],[WebGLRenderingContext.prototype,'getParameter',1]];
  const reflection=methods.map(([owner,key,length])=>{const d=Object.getOwnPropertyDescriptor(owner,key),f=d.value;let constructError='';try{Reflect.construct(f,[]);}catch(e){constructError=e.name;}
    return {key,name:f.name,length:f.length,expectedLength:length,constructError,prototype:Object.hasOwn(f,'prototype'),native:/\[native code\]/.test(Function.prototype.toString.call(f)),writable:d.writable,enumerable:d.enumerable,configurable:d.configurable};});
  const gl=document.createElement('canvas').getContext('webgl'),graphics={available:!!gl};
  if(gl){
    let reads=0;try{gl.getExtension.call({},{toString(){reads++;return 'WEBGL_debug_renderer_info';}});tests.extensionBrand=false;}catch(e){tests.extensionBrand=e.name==='TypeError'&&reads===0;}
    graphics.debug=!!gl.getExtension('WEBGL_debug_renderer_info');graphics.unmasked=gl.getParameter(37446);gl.getError();
    let values=0;tests.enumForms=gl.getParameter(gl.VERSION)===gl.getParameter({valueOf(){values++;return gl.VERSION;}})&&values===1&&gl.getParameter(String(gl.VERSION))===gl.getParameter(gl.VERSION);
    const compile=(type,code)=>{const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);assertShader(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader));return shader;};
    function assertShader(ok,message){if(!ok)throw Error(message);}
    const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'precision mediump float;void main(){gl_FragColor=vec4(.25,.5,.75,1.);}'));gl.linkProgram(program);assertShader(gl.getProgramParameter(program,gl.LINK_STATUS),'link');gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    let frames=0;await new Promise(resolve=>{const draw=()=>{gl.drawArrays(gl.TRIANGLES,0,3);if(++frames===3)resolve();else requestAnimationFrame(draw);};requestAnimationFrame(draw);});
    const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);graphics.game={frames,pixel:[...pixel],error:gl.getError()};
    graphics.limits={texture:gl.getParameter(gl.MAX_TEXTURE_SIZE),uniforms:gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)};
  }
  const timings={};for(const [name,fn]of Object.entries({text:()=>c.measureText('Editing').width,extension:()=>gl?.getExtension('OES_texture_float'),parameter:()=>gl?.getParameter(gl.VERSION),analyser:()=>analyser.getFloatFrequencyData(a)})){
    const start=performance.now();for(let i=0;i<5000;i++)fn();timings[name]={iterations:5000,ms:performance.now()-start};
  }
  const result={noise:window.__wardenOneRealm?.noise,text:expected,textRepeat:c.measureText('Editing').width,offscreenText:oc.measureText('Editing').width,
    pixels:await digest(c.getImageData(0,0,128,64).data),audio:await digest(rendered.getChannelData(0).buffer),audioTail:tail,audioStable:stable,tests,reflection,graphics,timings,
    cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory,screen:{width:screen.width,height:screen.height},gpu:{available:!!navigator.gpu}};
  if(navigator.gpu){const adapter=await navigator.gpu.requestAdapter();result.gpu.adapter=!!adapter;if(adapter){const info=adapter.info||(adapter.requestAdapterInfo?await adapter.requestAdapterInfo():null);result.gpu.info=info?{vendor:info.vendor,architecture:info.architecture,isFallbackAdapter:info.isFallbackAdapter}:null;result.gpu.texture=adapter.limits.maxTextureDimension2D;result.gpu.features=[...adapter.features].sort();}}
  return result;
}
async function blankProbe(on){
  const frame=document.createElement('iframe');document.body.append(frame);const w=frame.contentWindow;
  const early=w.CanvasRenderingContext2D.prototype.measureText,earlyToString=w.Function.prototype.toString,ctx=w.document.createElement('canvas').getContext('2d');ctx.font='16px sans-serif';
  const initial={noise:w.__wardenOneRealm?.noise??null,width:early.call(ctx,'Editing').width};
  await new Promise((resolve,reject)=>{const start=performance.now(),poll=()=>{if(w.__wardenOneRealm?.noise===on)resolve();else if(performance.now()-start>10000)reject(Error('blank settlement'));else setTimeout(poll,10);};poll();});
  const result={initial,settled:{noise:w.__wardenOneRealm.noise,width:ctx.measureText('Editing').width},borrowedAfter:early.call(ctx,'Editing').width,
    retainedEarlyMethod:early===w.CanvasRenderingContext2D.prototype.measureText,localString:Function.prototype.toString.call(CanvasRenderingContext2D.prototype.measureText),
    childString:w.Function.prototype.toString.call(CanvasRenderingContext2D.prototype.measureText),earlyString:earlyToString.call(CanvasRenderingContext2D.prototype.measureText)};
  frame.remove();return result;
}
async function run(options,server){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-fingerprint-resistance-')),port=await profile.freePort();let cdp;
  const report={createdAt:new Date().toISOString(),runtime:identity.fingerprint(options.extension).sha256,browserSha256:identity.sha256(fs.readFileSync(options.browser)),toolSha256:identity.sha256(fs.readFileSync(__filename)),
    machine:{cpu:os.cpus()[0].model,platform:process.platform,release:os.release()},variants:{},complete:false};
  const save=()=>{fs.mkdirSync(path.dirname(options.out),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(report,null,2));};
  try{
    report.fixtureFlags=['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-media-suspend'];
    const launched=await profile.launch(options.browser,'on',options.extension,port,dir,[...report.fixtureFlags,'--host-resolver-rules='+[...HOSTS,MEDIA].map(x=>'MAP '+x+' 127.0.0.1').join(', ')+', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--ignore-certificate-errors','--enable-unsafe-webgpu','--autoplay-policy=no-user-gesture-required']);
    report.browser=launched.Browser;cdp=new profile.Cdp(launched.webSocketDebuggerUrl);await cdp.connect();report.browserErrors=[];
    cdp.on(e=>{if(e.method==='Network.loadingFailed'||e.method==='Runtime.exceptionThrown')report.browserErrors.push({method:e.method,details:e.params});});
    const ext=await profile.extensionReady(cdp,port,JSON.parse(fs.readFileSync(path.join(options.extension,'manifest.json'))).version);await profile.closeExtensionTabs(cdp,port,ext.id);
    const bg=code=>evaluate(cdp,ext.attachedSession,code);
    for(const on of[false,true]){
      await bg('updateStoredConfig(c=>{c.antiFingerprintNoise='+on+';c.blockFingerprintScripts=false;c.blockCameraMic=false;}).then(()=>true)');
      await until(()=>bg('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'),'config');
      const target=await cdp.send('Target.createTarget',{url:'about:blank'}),session=(await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
      await cdp.send('Page.enable',{},session);await cdp.send('Runtime.enable',{},session);await cdp.send('Network.enable',{},session);await cdp.send('Page.bringToFront',{},session);
      const rows=[];report.variants[on?'on':'off']={rows,labOverrides:{antiFingerprintNoise:on,blockFingerprintScripts:false,blockCameraMic:false},probeDetection:'unchanged default: on'};
      for(const host of HOSTS)for(let visit=1;visit<=4;visit++){
        const url='https://'+host+':'+server.address().port+'/?visit='+visit;
        await cdp.send('Page.navigate',{url},session);await until(()=>evaluate(cdp,session,'document.readyState==="complete"&&location.href==='+JSON.stringify(url)),'page');
        await until(()=>evaluate(cdp,session,'window.__wardenOneRealm?.noise==='+on),'noise');
        const data=await evaluate(cdp,session,'('+collect.toString()+')()');rows.push({host,visit,...data});
        assert.equal(data.text,data.textRepeat);assert.equal(data.text,data.offscreenText);assert(data.audioTail&&data.audioStable);
        for(const [name,ok]of Object.entries(data.tests))assert(ok,name);
        for(const d of data.reflection){assert.equal(d.name,d.key);assert.equal(d.length,d.expectedLength);assert.equal(d.constructError,'TypeError');assert(!d.prototype&&d.writable&&d.enumerable&&d.configurable,d.key);if(on)assert(d.native,d.key);}
        assert(data.graphics.game?.frames===3&&data.graphics.game.error===0);assert.deepEqual(data.graphics.game.pixel,[64,128,191,255]);
        if(on){assert(!data.graphics.debug);assert.equal(data.graphics.unmasked,null);}
        if(host===HOSTS[0]&&visit===1){
          report.variants[on?'on':'off'].blank=await evaluate(cdp,session,'('+blankProbe.toString()+')('+on+')');
          report.variants[on?'on':'off'].workers=await evaluate(cdp,session,'('+workerProbe.toString()+')()');
          await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},session);
          await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},session);
          assert(await evaluate(cdp,session,'window.gameKeys===1'),'game keyboard input');
          await evaluate(cdp,session,'document.querySelector("#user").focus();true');await cdp.send('Input.insertText',{text:'fixture-user'},session);
          await evaluate(cdp,session,'document.querySelector("#password").focus();true');await cdp.send('Input.insertText',{text:'synthetic-fixture-only'},session);
          await evaluate(cdp,session,'document.querySelector("form").requestSubmit();true');
          await until(()=>evaluate(cdp,session,'location.pathname==="/account"&&document.querySelector("#session")?.textContent==="signed-in"'),'login session');
          report.variants[on?'on':'off'].login={synthetic:true,session:true,keyboard:true};
          await cdp.send('Page.bringToFront',{},session);
          const playback=await evaluate(cdp,session,'(async()=>{const v=document.querySelector("video");await v.play();const end=performance.now()+10000;while(v.getVideoPlaybackQuality().totalVideoFrames<5&&performance.now()<end)await new Promise(r=>setTimeout(r,100));return {frames:v.getVideoPlaybackQuality().totalVideoFrames,width:v.videoWidth,paused:v.paused,error:v.error?.code??null};})()');
          report.variants[on?'on':'off'].video=playback;assert(playback.frames>=5&&playback.width>0&&!playback.paused&&!playback.error,'video playback');
        }
        save();
      }
      await cdp.send('Target.closeTarget',{targetId:target.targetId});
    }
    const off=report.variants.off.rows,on=report.variants.on.rows;
    report.linkability={sites:HOSTS.length,visitsPerSite:4,documentsPerVariant:on.length,
      offTextValues:new Set(off.map(x=>x.text)).size,onTextValues:new Set(on.map(x=>x.text)).size,
      offPixelHashes:new Set(off.map(x=>x.pixels)).size,onPixelHashes:new Set(on.map(x=>x.pixels)).size,
      offAudioHashes:new Set(off.map(x=>x.audio)).size,onAudioHashes:new Set(on.map(x=>x.audio)).size,
      rawPixelsUnchanged:off.every(x=>x.pixels===on[0].pixels),rawAudioUnchanged:off.every(x=>x.audio===on[0].audio),
      claim:'Selected text values resample; unchanged raw signals remain linkable. No anonymity or uniqueness claim.'};
    assert.equal(report.linkability.offTextValues,1);assert.equal(report.linkability.onTextValues,on.length);assert(report.linkability.rawPixelsUnchanged&&report.linkability.rawAudioUnchanged);
    for(const row of on){assert.deepEqual(row.graphics.limits,off[0].graphics.limits);if(row.gpu.adapter){assert.deepEqual(row.gpu.features,off[0].gpu.features);assert(row.gpu.texture<=off[0].gpu.texture);const first=on.find(x=>x.host===row.host);assert.deepEqual(row.gpu.info,first.gpu.info);}}
    for(const variant of Object.values(report.variants))for(const w of Object.values(variant.workers)){assert(w.canvas&&w.cores===variant.rows[0].cores);assert.equal(w.text,off[0].text);if(w.module!==null)assert.equal(w.module,7);}
    assert.equal(identity.fingerprint(options.extension).sha256,report.runtime);report.complete=true;
  }catch(error){report.error=String(error.stack||error);throw error;}finally{save();if(cdp){await profile.killBrowser(cdp,port).catch(()=>{});cdp.close();}cleanupProfile(dir,'wo-fingerprint-resistance-');await new Promise(resolve=>server.close(resolve));}
  console.log('[ok] 24 documents, coercion/reflection/audio bounds, raw-signal linkability, blank-frame reflection, six CSP worker forms, GPU draw/input, synthetic login and video');
}
async function main(){
  const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].slice(2);if(!['browser','extension','out'].includes(key)||!process.argv[i+1])throw Error('Paired --browser --extension --out required');options[key]=path.resolve(process.argv[i+1]);}
  if(!options.browser||!options.extension||!options.out)throw Error('Missing paths');
  const video=fs.readFileSync(path.join(__dirname,'../spotify-silent-1s.mp4'));
  const server=https.createServer(tls,(req,res)=>{const url=new URL(req.url,'https://'+req.headers.host);res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/input.js'){res.setHeader('Content-Type','text/javascript');res.end('window.gameKeys=0;addEventListener("keydown",e=>{if(e.key==="ArrowRight"&&e.isTrusted)gameKeys++});');return;}
    if(url.pathname.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(url.pathname==='/dependency.js'?'export const moduleValue=7;':(url.pathname.includes('module')?"import {moduleValue} from './dependency.js';\n":'')+WORKER);return;}
    if(url.pathname==='/video.mp4'){res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',video.length);res.end(video);return;}
    if(url.pathname==='/login'){req.resume();req.on('end',()=>{res.writeHead(303,{'Set-Cookie':'fixture_session=yes; Secure; HttpOnly; SameSite=Lax','Location':'/account'});res.end();});return;}
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self'; media-src https://"+MEDIA+':'+server.address().port+"; object-src 'none'");
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fingerprint resistance fixture</title>'+(url.pathname==='/account'?'<p id="session">'+(req.headers.cookie?.includes('fixture_session=yes')?'signed-in':'missing')+'</p><video style="position:fixed;top:10px;left:10px;width:320px;height:180px;z-index:999999" controls loop muted src="https://'+MEDIA+':'+server.address().port+'/video.mp4"></video>':'<form method="post" action="/login"><input id="user" name="user" autocomplete="username"><input id="password" name="password" type="password" autocomplete="current-password"><button>Sign in</button></form><script src="/input.js"></script>'));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await run(options,server);
}
if(require.main===module)profile.mustFinish(main,'fingerprint resistance').catch(error=>{console.error(error);process.exitCode=1;});
module.exports={collect,blankProbe};

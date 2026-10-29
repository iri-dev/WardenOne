/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '../..');
function create(options = {}) {
  const source = fs.readFileSync(options.source || process.env.WARDENONE_FP_SOURCE || path.join(root, 'src/content.js'), 'utf8');
  const start = source.indexOf('function __woFingerprintNoise('), end = source.indexOf('/* FINGERPRINT-NOISE-END */', start);
  if (start < 0 || end <= start) throw Error('Missing fingerprint region');
  const world = vm.createContext({ console, testHost: options.host || 'one.example.org', testSeed: options.seed || 31 });
  vm.runInContext(`
    this.window=this;this.navigator={platform:'Win32',language:'en-US'};this.location={hostname:testHost,ancestorOrigins:[]};this.screen={width:1280,height:720};
    let randomCounter=0;this.crypto={getRandomValues(a){for(let i=0;i<a.length;i++)a[i]=(testSeed+17*(++randomCounter))>>>0;return a;}};
    const fonts=new WeakMap(),metricValues=new WeakMap(),contexts=new WeakMap(),analysers=new WeakMap(),svgObjects=new WeakSet(),arrayLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),'length').get;
    class TextMetrics {constructor(width){metricValues.set(this,width);}get width(){if(!metricValues.has(this))throw new TypeError('Illegal invocation');return metricValues.get(this);}}
    this.TextMetrics=TextMetrics;
    class CanvasRenderingContext2D {
      constructor(){fonts.set(this,'16px sans-serif');}
      get font(){if(!fonts.has(this))throw new TypeError('Illegal invocation');return fonts.get(this);}
      set font(value){if(!fonts.has(this))throw new TypeError('Illegal invocation');fonts.set(this,String(value));}
      measureText(text){if(!fonts.has(this))throw new TypeError('Illegal invocation');if(!arguments.length||typeof text==='symbol')throw new TypeError('DOMString');return new TextMetrics(String(text).length*7);}
      getImageData(){return {data:new Uint8ClampedArray([1,2,3,255])};}
    }
    this.CanvasRenderingContext2D=CanvasRenderingContext2D;
    this.OffscreenCanvasRenderingContext2D=class extends CanvasRenderingContext2D{};
    for(const name of ['measureText','font'])Object.defineProperty(OffscreenCanvasRenderingContext2D.prototype,name,Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,name));
    this.HTMLCanvasElement=class{toDataURL(){return 'pixels';}toBlob(){}};
    this.Element=class{};this.DOMRect=class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}};
    this.SVGTextContentElement=class {
      constructor(text=''){svgObjects.add(this);this.textContent=text;}
      getComputedTextLength(){if(!svgObjects.has(this))throw new TypeError('Illegal invocation');return this.textContent.length*7;}
      getSubStringLength(start,count){if(!svgObjects.has(this))throw new TypeError('Illegal invocation');if(arguments.length<2)throw new TypeError('arguments');const a=(+start)>>>0,b=(+count)>>>0;return this.textContent.slice(a,a+b).length*7;}
    };
    this.WebGLRenderingContext=class {
      constructor(debug=false){contexts.set(this,{debug});}
      get canvas(){if(!contexts.has(this))throw new TypeError('Illegal invocation');return null;}
      getParameter(parameter){if(!contexts.has(this))throw new TypeError('Illegal invocation');if(!arguments.length)throw new TypeError('arguments');const p=(+parameter)>>>0,state=contexts.get(this);return p===7938?'WebGL 1.0':p===37445?(state.debug?'native-vendor':null):p===37446?(state.debug?'native-renderer':null):0;}
      getExtension(name){if(!contexts.has(this))throw new TypeError('Illegal invocation');if(!arguments.length||typeof name==='symbol')throw new TypeError('DOMString');const text=String(name);if(/^WEBGL_debug_renderer_info$/i.test(text)){contexts.get(this).debug=true;return {UNMASKED_VENDOR_WEBGL:37445};}return text==='OES_texture_float'?{}:null;}
      getSupportedExtensions(){if(!contexts.has(this))throw new TypeError('Illegal invocation');return ['WEBGL_debug_renderer_info','OES_texture_float'];}
    };
    this.WebGL2RenderingContext=class extends WebGLRenderingContext{};
    for(const name of ['canvas','getParameter','getExtension','getSupportedExtensions'])Object.defineProperty(WebGL2RenderingContext.prototype,name,Object.getOwnPropertyDescriptor(WebGLRenderingContext.prototype,name));
    this.AnalyserNode=class {
      constructor(){analysers.set(this,128);}
      get frequencyBinCount(){if(!analysers.has(this))throw new TypeError('Illegal invocation');return analysers.get(this);}
      getFloatFrequencyData(array){if(!analysers.has(this)||!(array instanceof Float32Array))throw new TypeError('Illegal invocation');array.fill(-70,0,Math.min(arrayLength.call(array),analysers.get(this)));}
    };
    this.AudioBuffer=class{getChannelData(){return new Float32Array(32);}};this.Navigator=class{};
    this.Worker=class Worker{};
    this.before={text:CanvasRenderingContext2D.prototype.measureText,font:Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'font').get,
      audio:AudioBuffer.prototype.getChannelData,worker:Worker,toString:Function.prototype.toString,
      methods:[CanvasRenderingContext2D.prototype,OffscreenCanvasRenderingContext2D.prototype,SVGTextContentElement.prototype,WebGLRenderingContext.prototype,AnalyserNode.prototype].flatMap(p=>Object.getOwnPropertyNames(p).filter(k=>typeof Object.getOwnPropertyDescriptor(p,k)?.value==='function'&&k!=='constructor').map(k=>({owner:p,key:k,descriptor:Object.getOwnPropertyDescriptor(p,k)})))};
  `, world);
  for (const file of ['domain-utils.js', 'psl-private.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), world);
  if (options.detector) {
    const from=source.indexOf('const patchGLProbe=proto=>'),to=source.indexOf('patchGLProbe(window.WebGL2RenderingContext&&WebGL2RenderingContext.prototype)',from);
    if(from<0||to<from)throw Error('Missing GPU detector');
    vm.runInContext('const noteFingerprint=()=>{};'+source.slice(from,to)+'patchGLProbe(WebGL2RenderingContext.prototype);',world);
  }
  vm.runInContext(source.slice(start, end) + '\nthis.applyNoise=inherited=>__woFingerprintNoise(inherited);', world);
  if (options.apply !== false) vm.runInContext('this.record=applyNoise(null);', world);
  return { world, run: code => vm.runInContext(code, world) };
}
module.exports = { create };

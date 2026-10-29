/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync(process.env.WARDENONE_FP_SOURCE || path.join(__dirname, '../src/content.js'), 'utf8');
const from = source.indexOf('function __woFingerprintNoise('), end = source.indexOf('/* FINGERPRINT-NOISE-END */', from);
assert(from >= 0 && end > from);
const world = vm.createContext({ console });
vm.runInContext(`
this.window=this;this.navigator={platform:'Win32'};this.location={hostname:'fixture.example',ancestorOrigins:[]};this.screen={width:1280,height:720};
this.crypto={getRandomValues(a){a.fill(12345);return a;}};
class CanvasRenderingContext2D{constructor(){this.font='12px sans-serif';}measureText(text){if(!(this instanceof CanvasRenderingContext2D))throw new TypeError('Illegal invocation');return {width:String(text).length*7,actualBoundingBoxAscent:10};}}
this.CanvasRenderingContext2D=CanvasRenderingContext2D;
this.OffscreenCanvasRenderingContext2D=class extends CanvasRenderingContext2D{};
Object.defineProperty(OffscreenCanvasRenderingContext2D.prototype,'measureText',Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'measureText'));
this.HTMLCanvasElement=class{toDataURL(){return 'pixels';}toBlob(){}};
this.Element=class{getBoundingClientRect(){return {x:1,y:2,width:3,height:4};}getClientRects(){return [];}};
this.DOMRect=class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}};
this.Navigator=class{};
const samples=new WeakMap();
this.AudioBuffer=class{constructor(){samples.set(this,new Float32Array(512));}getChannelData(channel){if(!samples.has(this))throw new TypeError('Illegal invocation');if(channel!==0)throw new RangeError('channel');return samples.get(this);}copyFromChannel(target,channel){target.set(this.getChannelData(channel).subarray(0,target.length));}copyToChannel(input,channel){this.getChannelData(channel).set(input);}};
this.AudioContext=class{get sampleRate(){return 44100;}};
this.AnalyserNode=class{getFloatFrequencyData(target){if(!(this instanceof AnalyserNode))throw new TypeError('Illegal invocation');target.fill(-70);}};
this.before={audio:AudioBuffer.prototype.getChannelData,rate:Object.getOwnPropertyDescriptor(AudioContext.prototype,'sampleRate'),text:CanvasRenderingContext2D.prototype.measureText,
  descriptor:Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'measureText'),toString:Function.prototype.toString};
`, world);
vm.runInContext(source.slice(from, end) + '\nthis.record=__woFingerprintNoise(null);', world);
const result = vm.runInContext(`(()=>{
const b=new AudioBuffer(),raw=b.getChannelData(0),zero=raw.every(x=>x===0);raw[0]=.25;raw[100]=.5;
const same=b.getChannelData(0)===raw,copy=new Float32Array(512);b.copyFromChannel(copy,0);
b.copyToChannel(new Float32Array([.75]),0);const mutated=b.getChannelData(0)[0]===.75&&raw[100]===.5;
const analyser=new AnalyserNode(),a=new Float32Array(128),c=new Float32Array(128);analyser.getFloatFrequencyData(a);analyser.getFloatFrequencyData(c);
const context=new CanvasRenderingContext2D(),off=new OffscreenCanvasRenderingContext2D();
const descriptor=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'measureText');
let badReceiver=false;try{context.measureText.call({},'test');}catch(e){badReceiver=e instanceof TypeError;}
return {zero,same,mutated,copy:copy[0]===.25&&copy[100]===.5,nativeAudio:before.audio===AudioBuffer.prototype.getChannelData,
  rate:new AudioContext().sampleRate,nativeRate:!Object.hasOwn(AudioContext.prototype,'sampleRate')||Object.getOwnPropertyDescriptor(AudioContext.prototype,'sampleRate').get===before.rate.get,
  stableFrequency:a.every((x,i)=>x===c[i]),repeatedText:context.measureText('editing').width===context.measureText('editing').width,
  canvasAgreement:context.measureText('editing').width===off.measureText('editing').width,nonnegativeText:context.measureText('').width>=0,
  arity:context.measureText.length,name:context.measureText.name,constructible:Object.hasOwn(context.measureText,'prototype'),
  descriptor:descriptor.enumerable===before.descriptor.enumerable&&descriptor.configurable===before.descriptor.configurable&&descriptor.writable===before.descriptor.writable,
  toStringPrototype:Object.hasOwn(Function.prototype.toString,'prototype'),badReceiver};})()`, world);
for (const key of ['zero','same','mutated','copy','nativeAudio','nativeRate','stableFrequency','repeatedText','canvasAgreement','nonnegativeText','descriptor','badReceiver']) assert.equal(result[key],true,key);
assert.equal(result.rate,44100);assert.equal(result.arity,1);assert.equal(result.name,'measureText');
assert.equal(result.constructible,false);assert.equal(result.toStringPrototype,false);
console.log('[ok] nonmutating audio, truthful sample rate, stable derived output, canvas consistency and method descriptors');

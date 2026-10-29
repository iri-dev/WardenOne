/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const { create } = require('./lib/fingerprint-adversarial-harness.js');
const r = create(), failures = [];
function check(name, expression) {
  try { assert.equal(r.run(expression), true); }
  catch (error) { failures.push(name); console.error('[fail] ' + name + ': ' + error.message); }
}
check('canvas converts an object exactly once', `(()=>{let n=0;const value={toString(){n++;return 'editing';}};new CanvasRenderingContext2D().measureText(value);return n===1;})()`);
check('object and primitive canvas text share the same noise', `(()=>{const c=new CanvasRenderingContext2D();let n=0;const a=c.measureText({[Symbol.toPrimitive](hint){if(hint!=='string')throw Error('hint');n++;return 'editing';}}).width;return n===1&&a===c.measureText('editing').width;})()`);
check('wrong canvas receiver does not coerce input', `(()=>{let n=0;try{CanvasRenderingContext2D.prototype.measureText.call({},{toString(){n++;return 'x';}});}catch(e){return e instanceof TypeError&&n===0;}return false;})()`);
check('canvas preserves primitive conversion and native errors', `(()=>{const c=new CanvasRenderingContext2D();for(const value of [undefined,null,12,12n,true])if(c.measureText(value).width!==c.measureText(String(value)).width)return false;for(const call of [()=>c.measureText(),()=>c.measureText(Symbol()),()=>c.measureText({[Symbol.toPrimitive](){return Symbol();}})]){try{call();return false;}catch(e){if(!(e instanceof TypeError))return false;}}return true;})()`);
check('native font access avoids invoking a page-shadowed getter', `(()=>{const c=new CanvasRenderingContext2D(),expected=c.measureText('editing').width;let reads=0;Object.defineProperty(c,'font',{get(){reads++;return 'changed';}});return c.measureText('editing').width===expected&&reads===0;})()`);
check('GL debug extension validates receiver before coercion', `(()=>{let reads=0;try{WebGLRenderingContext.prototype.getExtension.call({},{toString(){reads++;return 'WEBGL_debug_renderer_info';}});}catch(e){return e instanceof TypeError&&reads===0;}return false;})()`);
check('GL debug extension does not skip receiver validation', `(()=>{try{WebGLRenderingContext.prototype.getExtension.call({},'WEBGL_debug_renderer_info');}catch(e){return e instanceof TypeError;}return false;})()`);
check('blocking a debug extension does not enable it internally', `(()=>{const g=new WebGLRenderingContext();return g.getExtension('WEBGL_debug_renderer_info')===null&&g.getParameter(37445)===null;})()`);
check('GL enum string and boxed forms do not reveal another identity', `(()=>{const g=new WebGLRenderingContext(true),v=g.getParameter(37445);let n=0;return g.getParameter('37445')===v&&g.getParameter({valueOf(){n++;return 37445;}})===v&&n===1;})()`);
check('GL wrapping preserves ToNumber errors', `(()=>{const g=new WebGLRenderingContext();for(const value of [1n,Symbol('x'),{valueOf(){return 1n;}}]){try{g.getParameter(value);return false;}catch(e){if(!(e instanceof TypeError))return false;}}return true;})()`);
check('GL normal extensions convert once and forward natively', `(()=>{const g=new WebGLRenderingContext();let n=0;const result=g.getExtension({toString(){n++;return 'OES_texture_float';}});return !!result&&n===1;})()`);
check('GL enum receiver is checked before object conversion', `(()=>{let n=0;try{WebGLRenderingContext.prototype.getParameter.call({},{valueOf(){n++;return 37445;}});}catch(e){return e instanceof TypeError&&n===0;}return false;})()`);
check('oversized audio arrays preserve the untouched tail', `(()=>{const a=new AnalyserNode(),v=new Float32Array(512).fill(17);a.getFloatFrequencyData(v);return v.subarray(128).every(x=>x===17);})()`);
check('audio buffer length comes from native analyser state', `(()=>{const a=new AnalyserNode(),v=new Float32Array(512).fill(17);Object.defineProperty(a,'frequencyBinCount',{value:512});a.getFloatFrequencyData(v);return v.subarray(128).every(x=>x===17);})()`);
check('audio array length does not invoke a shadowed getter', `(()=>{const a=new AnalyserNode(),v=new Float32Array(512).fill(17);let reads=0;Object.defineProperty(v,'length',{get(){reads++;return 512;}});a.getFloatFrequencyData(v);return reads===0&&v.subarray(128).every(x=>x===17);})()`);
check('derived audio noise is idempotent for native snapshots', `(()=>{const a=new AnalyserNode(),x=new Float32Array(512).fill(17),y=new Float32Array(512).fill(17);a.getFloatFrequencyData(x);a.getFloatFrequencyData(y);return x.every((v,i)=>v===y[i]);})()`);
check('zero SVG lengths remain zero', `(()=>{const s=new SVGTextContentElement('');return s.getComputedTextLength()===0&&s.getSubStringLength(0,0)===0;})()`);
check('wrapped native methods remain nonconstructible with matching arity', `before.methods.filter(x=>['measureText','getParameter','getExtension','getSupportedExtensions','getComputedTextLength','getSubStringLength','getFloatFrequencyData'].includes(x.key)).every(x=>{const f=x.owner[x.key];return f.name===x.key&&f.length===x.descriptor.value.length&&!Object.hasOwn(f,'prototype')&&Object.getPrototypeOf(f)===Function.prototype;})`);
check('wrapper descriptor flags stay unchanged', `before.methods.every(x=>{const d=Object.getOwnPropertyDescriptor(x.owner,x.key);return d.configurable===x.descriptor.configurable&&d.enumerable===x.descriptor.enumerable&&d.writable===x.descriptor.writable;})`);
check('raw audio buffers and Worker construction stay native', `before.audio===AudioBuffer.prototype.getChannelData&&before.worker===Worker`);
const a = create({ seed: 1 }), b = create({ seed: 901 });
assert.equal(a.run("new WebGLRenderingContext(true).getParameter(37446)"), b.run("new WebGLRenderingContext(true).getParameter(37446)"), 'site graphics policy remains stable across documents');
assert.notEqual(a.run("new CanvasRenderingContext2D().measureText('editing').width"), b.run("new CanvasRenderingContext2D().measureText('editing').width"), 'private document seeds remain independent');
const detection=create({apply:false,detector:true});
assert(detection.run(`(()=>{const f=WebGLRenderingContext.prototype.getParameter,g=new WebGLRenderingContext();let n=0;return f.name==='getParameter'&&f.length===1&&!Object.hasOwn(f,'prototype')&&g.getParameter({valueOf(){n++;return 7938;}})==='WebGL 1.0'&&n===1;})()`),'GPU detector retains method shape and one native conversion');
if (failures.length) { console.error(failures.length + ' adversarial fingerprint cases failed'); process.exitCode = 1; }
else console.log('[ok] coercion order, method brands/descriptors, GL identity forms, native audio bounds and private-document policy');

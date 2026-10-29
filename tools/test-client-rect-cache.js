/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../content.min.js'),'utf8');
const at=source.indexOf('const rectSeed='),from=source.lastIndexOf('try{',at),to=source.indexOf('try{const patchSvgText=',at);
assert(at>0&&from>=0&&to>from);
const world=vm.createContext({console});
vm.runInContext(`this.window=this;this._sk=12345;this.cloak=fn=>fn;
this.makeRnd=seed=>{let s=seed>>>0;return()=>{s=(1664525*s+1013904223)>>>0;return s/4294967296;}};
this.DOMRect=class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}};
const rows=new WeakMap,objects=new WeakMap;
this.DOMRectList=class{constructor(values){rows.set(this,values);values.forEach((v,i)=>Object.defineProperty(this,String(i),{value:v,configurable:true,enumerable:true}));}
get length(){if(!rows.has(this))throw new TypeError('Illegal invocation');return rows.get(this).length;}
item(index){if(!rows.has(this))throw new TypeError('Illegal invocation');return rows.get(this)[Number(index)>>>0]||null;}
[Symbol.iterator](){return Array.prototype.values.call(this);}};
this.Element=class{constructor(count=3){objects.set(this,count);}getBoundingClientRect(){if(!objects.has(this))throw new TypeError('Illegal invocation');return new DOMRect(10,20,30,40);}
getClientRects(){if(!objects.has(this))throw new TypeError('Illegal invocation');return new DOMRectList(Array.from({length:objects.get(this)},(_,i)=>new DOMRect(10+i,20+i,30+i,40+i)));}};
this.before=Object.getOwnPropertyDescriptor(Element.prototype,'getClientRects');`,world);
vm.runInContext(source.slice(from,to),world);
const result=vm.runInContext(`(()=>{const e=new Element,first=e.getClientRects(),second=e.getClientRects();
const last=first[2],head=first[0],all=[...first],native=before.value.call(e);
const result={type:Object.getPrototypeOf(first)===DOMRectList.prototype,length:first.length===3,
item:first.item(2)===last&&first.item('0')===head,iterator:all[0]===head&&all[2]===last,
outOfRange:first.item(99)===null,property:first['01']===undefined,method:first.item===first.item,
fresh:first[0]!==second[0],nativeIntact:native[0].width===30,
empty:(()=>{const r=new Element(0).getClientRects();return r.length===0&&r.item(0)===null&&[...r].length===0;})(),
methodShape:first.item.name==='item'&&first.item.length===1&&!Object.hasOwn(first.item,'prototype')};
head.width=900;result.mutable=first.item(0).width===900;result.isolated=second[0].width!==900&&e.getClientRects()[0].width!==900;
let badThis=false;try{first.item.call({});}catch(e){badThis=e instanceof TypeError;}result.badThis=badThis;
let badElement=false;try{Element.prototype.getClientRects.call({});}catch(e){badElement=e instanceof TypeError;}result.badElement=badElement;
const d=Object.getOwnPropertyDescriptor(Element.prototype,'getClientRects');result.descriptor=d.configurable===before.configurable&&d.enumerable===before.enumerable&&d.writable===before.writable&&d.value.length===before.value.length;
return result;})()`,world);
for(const[key,value]of Object.entries(result))assert.equal(value,true,key);
console.log('[ok] multi-rectangle order, lazy/repeated access, mutation isolation, native collection and receiver contracts');

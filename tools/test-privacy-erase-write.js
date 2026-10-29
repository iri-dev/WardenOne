/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),assert=require('assert/strict'),vm=require('vm');
const source=fs.readFileSync('background.js','utf8');
function lift(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name);let depth=0,opened=false;for(let i=start;i<source.length;i++){if(source[i]==='{'){depth++;opened=true;}else if(source[i]==='}'&&--depth===0&&opened)return source.slice(start,i+1);}throw Error('Unterminated '+name);}
const writes=[],sandbox={Promise,Symbol,Object,Error,INCOGNITO_CONTEXT:false,persistentLocalPayload:x=>x,contentConfigInputKeys:()=>[],invalidateContentConfigMemo:()=>{},__cfgCacheSet:()=>{},__cfgClone:x=>x,
  chrome:{runtime:{lastError:null},storage:{local:{set:(payload,done)=>{writes.push(payload);done();}}}}};
vm.createContext(sandbox);
vm.runInContext("const PRIVACY_ERASE_CONFIG_WRITE=Symbol('privacy erase config write');let __privacyEraseInProgress=true;"+lift('localSet')+';globalThis.api={localSet,token:PRIVACY_ERASE_CONFIG_WRITE};',sandbox);
(async()=>{
  await assert.rejects(sandbox.api.localSet({test:1}),/Data erase in progress/);
  await assert.rejects(sandbox.api.localSet({test:1},Symbol('wrong')),/Data erase in progress/);
  assert.equal(writes.length,0);
  await sandbox.api.localSet({test:1},sandbox.api.token);
  assert.equal(writes.length,1);
  const update=lift('updateStoredConfig'),erase=lift('eraseWardenOneSite');
  assert(update.includes('localSet({ wardenone_config: next, [WO_CONFIG_WRITES_KEY]: stamp.record }, writeToken)'));
  assert(update.includes('updateStoredConfig(mutate, left, order, writeToken)'));
  assert(erase.includes('}, undefined, undefined, PRIVACY_ERASE_CONFIG_WRITE)'));
  console.log('[ok] erase-owned config write succeeds while ordinary writes stay blocked');
})().catch(error=>{console.error(error);process.exitCode=1;});

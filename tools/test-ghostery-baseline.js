/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert=require('assert/strict'),crypto=require('crypto'),fs=require('fs');
const {gitTreeHash,verifyVendor,safeSettings}=require('./prepare-ghostery-baseline.js');
const {sha256}=require('./lib/privacy-baseline.js');
const bytes=Buffer.from('release fixture'),files=new Map([['package.json',Buffer.from('{"version":"10.6.7"}')]]);
const commit='a'.repeat(40),tag='v10.6.7';
const pin={schemaVersion:1,tag,commit:{sha:commit},ref:{ref:'refs/tags/'+tag,object:{sha:commit}},release:{tag,assets:[{name:'ghostery-chromium-10.6.7.zip',url:'https://github.com/ghostery/ghostery-extension/releases/download/'+tag+'/ghostery-chromium-10.6.7.zip',sha256:sha256(bytes)}]},
  tree:{truncated:false,tree:[...files].map(([path,content])=>({path,type:'blob',mode:'100644',sha:crypto.createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex')}))}};
pin.commit.tree=gitTreeHash(pin.tree.tree);
assert.equal(gitTreeHash([]),'4b825dc642cb6eb9a060e54bf8d69288fbee4904');
const manifest={version:'10.6.7',manifest_version:3};
assert(verifyVendor(files,pin,bytes,manifest).gitBlobsVerified);
assert.throws(()=>verifyVendor(files,pin,Buffer.from('other runtime'),manifest),/digest/);
assert.throws(()=>verifyVendor(files,pin,bytes,{...manifest,version:'10.6.8'}),/version/);
assert.throws(()=>verifyVendor(new Map([...files,['unreviewed.js',Buffer.from('x')]]),pin,bytes,manifest),/inventory/);
for(const mutate of [p=>{p.commit.sha='b'.repeat(40);},p=>{p.commit.tree='b'.repeat(40);},p=>{p.tree.truncated=true;},p=>{p.ref.ref='refs/tags/latest';},p=>{p.release.assets[0].url='https://other.example/file.zip';},p=>{p.tree.tree[0].sha='c'.repeat(40);},p=>{p.tree.tree[0].mode='120000';}]) {
  const changed=structuredClone(pin);mutate(changed);assert.throws(()=>verifyVendor(files,changed,bytes,manifest));
}
assert.deepEqual(safeSettings({enabled:true,apiKey:'sensitive',nested:{nonce:'secret',token:'',mode:'normal'},hosts:['fixture.example']}),
  {enabled:true,apiKey:'[redacted]',nested:{nonce:'[redacted]',token:'',mode:'normal'},hosts:['fixture.example']});
const polluted=JSON.parse('{"__proto__":{"leak":true},"constructor":"bad","safe":true}');
assert.deepEqual(safeSettings(polluted),{safe:true});
const roadmap=JSON.parse(fs.readFileSync('docs/ghostery-roadmap-status.json'));
assert.equal(new Set(roadmap.phases.map(p=>p.id)).size,9);
for(let n=1;n<=9;n++)assert(roadmap.phases.some(p=>p.id==='G-0'+n));
for(const phase of roadmap.phases) {
  assert(['planned','in-progress','complete'].includes(phase.status));
  assert(phase.checklist.length&&phase.gap&&phase.existing);
  for(const file of [...phase.owners,...phase.regressions])assert(fs.existsSync(file),file);
  if(phase.status==='complete')assert(phase.changeReferences.length&&phase.validationReferences.length,'Completed phases need evidence');
}
console.log('[ok] Ghostery commit/blob/package pinning, mismatched provenance rejection and baseline secret redaction');

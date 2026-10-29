/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const {compareArchives} = require('./prepare-release-review.js');
const {CORPUS,ACCEPTANCE,classify,localReplacement} = require('./browser-release-rematch.js');
const {assess,POLICY} = require('./check-release-performance.js');
const {summarize} = require('./summarize-release-rematch.js');
const {CASES,responseFor} = require('./browser-cookie-compatibility.js');
for(const item of CASES){
  assert(responseFor(item,'review_session=fixed').usable);
  assert.equal(responseFor(item,'').usable,!item.requiresCookie);
  for(const cookie of ['review_session=fixed-extra','other_review_session=fixed','review_session=wrong'])assert(!responseFor(item,cookie).sent);
}
assert.equal(classify({received:false,failure:{errorText:'net::ERR_BLOCKED_BY_CLIENT'}}),'blocked');
for(const errorText of ['net::ERR_NAME_NOT_RESOLVED','net::ERR_CERT_AUTHORITY_INVALID','net::ERR_TIMED_OUT'])assert.equal(classify({received:false,failure:{errorText}}),'error');
assert.equal(classify({received:true,oldCookieSent:false,newCookieStored:true}),'stripped');
assert.equal(classify({received:true,oldCookieSent:true,newCookieStored:false}),'stripped');
assert.equal(classify({received:true,oldCookieSent:true,newCookieStored:true}),'allowed');
const extensionId='a'.repeat(32),resource='chrome-extension://'+extensionId+'/redirects/empty';
const redirect={url:'https://tracker.example/probe',finalUrl:resource,redirects:[{from:'https://tracker.example/probe',to:resource,status:307,headers:{'Non-Authoritative-Reason':'WebRequest API'}}],finalResponse:{url:resource,status:200}};
assert.deepEqual(localReplacement(redirect,extensionId),{extensionId,path:'/redirects/empty'});
for(const change of [{finalUrl:'https://unrelated.example/empty'},{finalUrl:'chrome-extension://'+'b'.repeat(32)+'/redirects/empty'},
  {finalResponse:{url:resource,status:404}},{redirects:[]},{redirects:[{...redirect.redirects[0],headers:{}}]},
  {redirects:[{...redirect.redirects[0],from:'https://other.example/probe'}]}])assert.equal(localReplacement({...redirect,...change},extensionId),null);
assert.equal(classify({received:false,replacement:localReplacement(redirect,extensionId)}),'replaced');
assert.equal(new Set(CORPUS.map(c=>c.name)).size,CORPUS.length);assert(CORPUS.some(c=>c.role==='control'&&c.kind==='script'));
assert(Object.keys(ACCEPTANCE).includes('privilegedMessages'));
const source=new Map(['manifest.json','LICENSE','NOTICE','CREDITS.md','THIRD_PARTY_NOTICES.html','src/content.js','tools/build-content.js','.gitattributes'].map(f=>[f,Buffer.from(f==='manifest.json'?'{}':'fixture')]));
const runtime=new Map([...source].filter(([f])=>!f.startsWith('src/')&&!f.startsWith('tools/')&&f!=='.gitattributes'));
assert.deepEqual(compareArchives(source,runtime).errors,[]);
runtime.set('LICENSE',Buffer.from('altered'));assert(compareArchives(source,runtime).errors.some(e=>e.includes('mismatch: LICENSE')));
const secret=Buffer.from('-----BEGIN '+'PRIVATE KEY-----');source.set('surprise.txt',secret);
assert(compareArchives(source,runtime).errors.some(e=>e==='private key: surprise.txt'));source.delete('surprise.txt');
source.set('tmp/local.json',Buffer.from('{}'));assert(compareArchives(source,runtime).errors.some(e=>e.includes('local/credential file:')));source.delete('tmp/local.json');
const report={complete:true,runs:[]};
for(const build of ['reference','candidate'])for(let n=0;n<POLICY.minimumSamples;n++)report.runs.push({build,complete:true,...Object.fromEntries(POLICY.metrics.map(m=>[m,100+n]))});
assert(assess(report).pass);
const regression=structuredClone(report);regression.runs.filter(r=>r.build==='candidate').forEach(r=>r.startupWallMs=200);assert(!assess(regression).pass);
for(const bad of [null,-1,NaN,Infinity]){const invalid=structuredClone(report);invalid.runs[0].startupWallMs=bad;assert.throws(()=>assess(invalid),/Missing\/invalid/);}
assert.throws(()=>assess({...report,complete:false}),/Incomplete/);
assert.throws(()=>assess({...report,runs:report.runs.slice(1)}),/samples/);
const comparison={complete:true,measurementProtocol:2,corpus:CORPUS,acceptance:ACCEPTANCE,runs:[]};
for(const build of ['off','reference','candidate','privacybadger'])for(let n=0;n<5;n++)comparison.runs.push({build,repetition:n,complete:true,
  compatibility:{editor:true,media:true,oauth:true,saml:true},...(n===0&&build!=='off'?{recovery:{privateHeapReplaced:true,rulesSurvived:true,requestStatusPreserved:true}}:{}),
  ...Object.fromEntries(POLICY.metrics.map(m=>[m,100+n])),scenarios:CORPUS.map(item=>{
    const blocked=build!=='off'&&item.role==='tracker';return{...item,status:blocked?'blocked':'allowed',received:!blocked,oldCookieSent:!blocked,newCookieStored:!blocked,network:blocked?{failure:{errorText:'net::ERR_BLOCKED_BY_CLIENT'}}:{}};
  })});
assert.equal(summarize(comparison).rounds.requests,'draw');
assert.equal(summarize(comparison).rounds.compatibilityHostCookieMinimization,'draw');
const lessExposure=structuredClone(comparison);
for(const run of lessExposure.runs.filter(r=>r.build==='privacybadger'))for(const row of run.scenarios.filter(s=>['authentication','payment'].includes(s.name))){row.oldCookieSent=false;row.newCookieStored=false;row.status='stripped';}
assert.equal(summarize(lessExposure).rounds.compatibilityHostCookieMinimization,'privacybadger','lower cookie exposure must remain visible even when it favors the opponent');
const fabricated=structuredClone(comparison);fabricated.runs[0].scenarios[0].status='blocked';assert.throws(()=>summarize(fabricated),/evidence/);
const dns=structuredClone(comparison);dns.runs[5].scenarios[0].network.failure.errorText='net::ERR_NAME_NOT_RESOLVED';assert.throws(()=>summarize(dns),/evidence/);
const duplicates=structuredClone(comparison);duplicates.runs[0].repetition=1;assert.throws(()=>summarize(duplicates));
console.log('[ok] release source/runtime parity, network attribution and baseline-relative budget failures');

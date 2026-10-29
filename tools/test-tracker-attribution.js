/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert=require('assert/strict'),fs=require('fs'),zlib=require('zlib'),vm=require('vm');
const {load}=require('./lib/tracker-attribution-harness.js');
const {build}=require('./build-tracker-catalog.js');
const api=load({chrome:new Proxy({},{get(){throw Error('Attribution must not access browser authority');}})});
const data=JSON.parse(fs.readFileSync('tracker-catalog.json')),now=Date.parse(data.source.updatedAt)+10000;
const catalog=api.validate(data,now);
const analytics=catalog.lookup('https://www.google-analytics.com/collect?secret=not-used'),tags=catalog.lookup('googletagmanager.com');
assert.equal(analytics.id,'google_analytics');assert.equal(analytics.name,'Google Analytics');assert.equal(analytics.category,'Site analytics');
assert.equal(analytics.organization,tags.organization);assert.notEqual(analytics.id,tags.id);assert.equal(tags.kind,'known-service');
assert.equal(analytics.confidence,'catalog-domain-match');assert(analytics.sourceUrl.includes(data.source.revision));
for(const value of ['notgoogle-analytics.com','google-analytics.com.attacker.example','googIe-analytics.com','https://google-analytics.com@evil.example/','javascript:google-analytics.com','google-analytics.com:80',null,{},'x'.repeat(9000)])assert.equal(catalog.lookup(value),null,String(value));
assert.equal(api.describe(catalog,'unfamiliar.example',{blocked:true}).kind,'blocked-unattributed');
assert.equal(api.describe(catalog,'unfamiliar.example',{suspected:true}).kind,'suspected-tracker');
assert.equal(api.describe(catalog,'unfamiliar.example',{}).label,'');
assert.equal(api.historyHost({type:'warned_permission_chain',detail:{domain:'google-analytics.com'}}),'');
assert.equal(api.historyHost({type:'proposed_tracker_domain',detail:{domain:'google-analytics.com'}}),'google-analytics.com');
const fixture=structuredClone(data);fixture.trackers=[{...fixture.trackers[0],domains:['alice.github.io']}];
const tenant=api.validate(fixture,now);assert(tenant.lookup('metrics.alice.github.io'));assert.equal(tenant.lookup('bob.github.io'),null);
const specific=JSON.parse(fs.readFileSync('tracker-catalog.json'));
specific.trackers=[{...specific.trackers.find(t=>t.id==='google_analytics'),domains:['service.example.net']},
  {...specific.trackers.find(t=>t.id==='google_tag_manager'),domains:['www.service.example.net']}];
const loggerSource=fs.readFileSync('logger.js','utf8');
const loggerContext=vm.createContext({WOTrackerAttribution:api,trackerCatalogLoader:{},trackerCatalogState:{catalog:api.validate(specific,now)}});
vm.runInContext(loggerSource.slice(loggerSource.indexOf('function trackerIdentity('),loggerSource.indexOf('function refreshTrackerNames('))+';this.identify=trackerIdentity;',loggerContext);
assert.equal(loggerContext.identify({host:'service.example.net',url:'https://www.service.example.net/probe',action:'blocked'}).id,'google_tag_manager','the actual request hostname must retain its most-specific identity despite the logger display normalization');
for(const domain of ['github.io','cloudfront.net','co.uk']){const invalid=structuredClone(fixture);invalid.trackers[0].domains=[domain];assert.throws(()=>api.validate(invalid,now));}
const changes=[d=>d.schema=2,d=>d.source.license='unknown',d=>d.source.revision='main',d=>d.source.updatedAt='invalid',
  d=>d.source.updatedAt=new Date(now+2*86400000).toISOString(),d=>d.source.updatedAt=new Date(now-366*86400000).toISOString(),
  d=>d.trackers[0].organization='missing',d=>d.trackers[0].category='missing',d=>d.trackers[0].id='__proto__',
  d=>d.trackers[0].action={type:'block'},d=>d.trackers[0].name='bad\0name',d=>d.trackers.push({...d.trackers[0]}),
  d=>d.trackers[1].domains.push(d.trackers[0].domains[0]),d=>d.organizations.push({...d.organizations[0]}),d=>d.rules=[]];
for(const mutate of changes){const invalid=structuredClone(data);mutate(invalid);assert.throws(()=>api.validate(invalid,now));}
const originalName=catalog.lookup('google-analytics.com').name;data.trackers.find(t=>t.id==='google_analytics').name='Mutated input';assert.equal(catalog.lookup('google-analytics.com').name,originalName);
const snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync('docs/tracker-catalog-source.json.gz')));
assert.equal(JSON.stringify(build(snapshot)),fs.readFileSync('tracker-catalog.json','utf8').trim());
const damaged=structuredClone(snapshot);damaged.files[0].text+=' ';assert.throws(()=>build(damaged),/integrity/);
async function reloads() {
  const original=JSON.parse(fs.readFileSync('tracker-catalog.json'));let body=JSON.stringify(original),calls=0;
  const loader=api.createLoader(async(url,options)=>{calls++;assert.equal(url,'chrome-extension://fixture/tracker-catalog.json');assert.equal(options.cache,'no-store');return new Response(body);},'chrome-extension://fixture/tracker-catalog.json',()=>now);
  const first=loader.refresh();assert.equal(first,loader.refresh(),'concurrent readers share one bounded load');
  assert.equal((await first).status,'ready');assert.equal(calls,1);
  const next=structuredClone(original);next.source.revision='b'.repeat(40);next.source.updatedAt=new Date(now).toISOString();next.trackers.find(t=>t.id==='google_analytics').name='Updated Analytics';body=JSON.stringify(next);
  const updated=await loader.refresh();assert.equal(updated.catalog.lookup('google-analytics.com').name,'Updated Analytics');
  for(const invalid of ['{',JSON.stringify(original),'x'.repeat(api.MAX_BYTES+1)]) {body=invalid;const held=await loader.refresh();assert.equal(held.status,'cached');assert.equal(held.catalog,updated.catalog,'invalid, rolled-back or oversized data cannot replace the last valid snapshot');}
  const empty=api.createLoader(async()=>new Response('{'), 'local',()=>now);assert.equal((await empty.refresh()).status,'unavailable');
  let resolve;const stalled=api.createLoader(()=>new Promise(r=>{resolve=r;}),'local',()=>now,10);
  assert.equal((await stalled.refresh()).status,'unavailable');resolve(new Response(JSON.stringify(original)));
  await new Promise(r=>setTimeout(r,0));
  const history=fs.readFileSync('history.js','utf8'),from=history.indexOf('function load(refreshCatalog = false)'),to=history.indexOf("window.addEventListener('hashchange'",from);
  const callbacks=[],painted=[];
  const context=vm.createContext({activityLoadGeneration:0,trackerCatalogLoader:null,trackerCatalogState:{catalog:null,status:'unavailable'},HISTORY_RETENTION_MS:30*86400000,
    chrome:{runtime:{sendMessage(_msg,reply){callbacks.push(reply);}}},activitySiteFilter:()=>'',paintActivitySiteFilter(){},render:rows=>painted.push(rows),document:{getElementById:()=>null}});
  vm.runInContext(history.slice(from,to)+';this.run=load;',context);
  context.run();context.run();callbacks[1]({history:[{at:Date.now(),type:'current'}]});
  callbacks[0]({history:[{at:Date.now(),type:'old'}]});
  assert(painted.every(rows=>rows.every(row=>row.type==='current')),'an obsolete response must not restore old activity during a catalog refresh or erasure');
}
reloads().then(()=>console.log('[ok] product/company/category attribution, tenant boundaries, malformed/stale data, atomic refresh, byte/time bounds and no browser authority'))
  .catch(error=>{console.error(error);process.exitCode=1;});

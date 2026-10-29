/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const p=require('./lib/ghostery-performance.js'),{pages}=require('./lib/ghostery-performance-fixtures.js'),{args,feedFreeze,trialConfigurationHash}=require('./browser-ghostery-performance.js');
const {costs}=require('./browser-ghostery-performance-lifecycle.js');
const {configure}=require('./prepare-ghostery-performance.js');
for(let block=0;block<5;block++)assert.deepEqual([...p.order(block)].sort(),p.ARMS.map(a=>a.id).sort());
for(const arm of p.ARMS)assert.equal(new Set(Array.from({length:5},(_,i)=>p.order(i).indexOf(arm.id))).size,5,'every arm occupies every position');
assert.throws(()=>p.order(-1));assert.equal(p.cpuDelta({1:2,2:1},{1:2.5,3:.1}),600);
assert.equal(p.rendererCounterDelta(1,1.25),250);
for(const [before,after]of [[1,.5],[undefined,1],[1,NaN],[null,1]])assert.equal(p.rendererCounterDelta(before,after),null,'reset or missing counters are unavailable rather than zero or negative');
assert.equal(p.stats([null,undefined,NaN]).median,null);assert.equal(p.stats([null,0,1]).n,2);
assert.deepEqual(p.stats([3,1,2]).raw,[3,1,2]);assert.equal(p.stats([3,1,2]).median,2);
assert.equal(p.hash({b:2,a:{d:1,c:0}}),p.hash({a:{c:0,d:1},b:2}));
assert.notEqual(p.hash([1,2]),p.hash([2,1]));assert.deepEqual(p.pairedInterval([1,2,3]),p.pairedInterval([1,2,3]));
assert.equal(p.hash(p.feedProjection('wardenone_aux_lists',{updated:1,version:1,domains:['a']})),p.hash(p.feedProjection('wardenone_aux_lists',{updated:2,version:1,domains:['a']})));
assert.notEqual(p.hash(p.feedProjection('wardenone_aux_lists',{updated:1,version:1,domains:['a']})),p.hash(p.feedProjection('wardenone_aux_lists',{updated:1,version:1,domains:['b']})));
assert.notEqual(p.hash(p.feedProjection('wardenone_list_integrity',{sources:{a:{sha256:'first',byteLength:10,acceptedAt:1}}})),p.hash(p.feedProjection('wardenone_list_integrity',{sources:{a:{sha256:'changed',byteLength:10,acceptedAt:1}}})));
assert.equal(p.configurationHash('ghostery',{blockAds:true,filtersUpdatedAt:1,revision:2}),p.configurationHash('ghostery',{blockAds:true,filtersUpdatedAt:2,revision:3}));
assert.equal(p.configurationHash('ghostery',{blockAds:true,onboarding:false}),p.configurationHash('ghostery',{blockAds:true,onboarding:true}));
assert.notEqual(p.configurationHash('ghostery',{blockAds:true}),p.configurationHash('ghostery',{blockAds:false}));
const report={runs:5,trials:[]};for(let block=0;block<5;block++)for(const arm of p.ARMS)report.trials.push({arm:arm.id,block,pages:[{page:'article',cache:'cold',compatible:true,taskMs:arm.product==='wardenone'?50:30,workerHeapMiB:null}]});
let summary=p.summarize(report);assert.equal(summary.overallWinner,null);const c=summary.comparisons.find(x=>x.page==='article'&&x.cache==='cold'&&x.preset==='recommended');
assert.equal(c.eligible,true);assert.equal(c.taskDifferenceWardenMinusGhosteryMs.median,20,'unfavorable results are retained');
assert.equal(summary.groups.find(x=>x.arm==='off'&&x.page==='article'&&x.cache==='cold').metrics.workerHeapMiB.n,0,'unsupported worker values are not zero overhead');
report.trials.find(x=>x.arm==='warden-recommended').pages[0].compatible=false;summary=p.summarize(report);
assert.equal(summary.comparisons.find(x=>x.page==='article'&&x.cache==='cold'&&x.preset==='recommended').eligible,false,'a broken page cannot win on reduced work');
const settings=vm.runInNewContext(fs.readFileSync('settings-data.js','utf8')+';SETTINGS_DATA');
for(const preset of ['recommended','maximum']){const config=Object.assign({},settings.defaults,...settings.carried.map(x=>x.defaults||{}),settings.recommended,preset==='maximum'?settings.maxAdds:{});p.assertConfiguration('wardenone',preset,config);for(const key of ['enabled','adShield','blockTrackers','autoRejectConsent','autoUpdateLists'])assert.throws(()=>p.assertConfiguration('wardenone',preset,{...config,[key]:false}));}
p.assertConfiguration('ghostery','maximum',{terms:true,blockAds:true,blockTrackers:true,blockAnnoyances:true,fixesFilters:true,mode:'default'});
assert.throws(()=>p.assertConfiguration('ghostery','maximum',{terms:true,blockAds:true,blockTrackers:true,blockAnnoyances:true,fixesFilters:true,mode:'zap'}));
const fixture=pages(4444);for(const name of p.PAGES){assert(fixture[name].includes('id="interaction"'),name);assert.equal(p.hash(fixture[name]),p.hash(pages(4444)[name]));}
assert.equal((fixture.frames8.match(/<iframe/g)||[]).length,8);assert.equal((fixture.frames30.match(/<iframe/g)||[]).length,30);
const profile=costs({startTime:0,endTime:10000,nodes:[{id:1,callFrame:{url:'engine.js',functionName:'scan',lineNumber:9,columnNumber:0}}],samples:[1,1],timeDeltas:[1000,2000]});
assert.equal(profile.scripts[0].selfMs,3);assert.equal(profile.functions[0].line,10);assert.equal(profile.durationMs,10);
const publicVideo={host:'www.youtube.com',videos:1,videoReadyState:4,textLength:3000};
assert(p.publicReady('youtube',publicVideo,'off'));assert(p.publicReady('youtube',publicVideo,'ghostery'));assert(!p.publicReady('youtube',publicVideo,'wardenone'));assert(p.publicReady('youtube',{...publicVideo,readyVersion:'active'},'wardenone'));
assert(!p.publicReady('auth',{host:'accounts.google.com',textLength:500,loginFields:0},'off'));
assert.equal(args(['--seeds','input','--out','output','--runs','5','--live']).live,true);assert.throws(()=>args(['--seeds','in','--out','out','--runs','0']));assert.throws(()=>args(['--seeds','in','--out','out','--arms','other']));
const freeze=feedFreeze(),sources=JSON.parse(fs.readFileSync('docs/source-inventory.json')).sources;
for(const source of sources){assert(freeze.feedUrls.includes(source.url));assert(freeze.feedHosts.includes(new URL(source.url).hostname));}
assert(freeze.feedHosts.includes('cdn.ghostery.com'));for(const host of ['en.wikipedia.org','www.youtube.com','www.twitch.tv','accounts.google.com'])assert(!freeze.feedHosts.includes(host));
assert.equal(trialConfigurationHash('wardenone',{enabled:true,toastMemory:{}},true),trialConfigurationHash('wardenone',{enabled:true,toastMemory:{'warned_service_worker|example.com':123}},true));
assert.notEqual(trialConfigurationHash('wardenone',{enabled:true,toastMemory:{}},false),trialConfigurationHash('wardenone',{enabled:true,toastMemory:{'warned_service_worker|example.com':123}},false));
assert.notEqual(trialConfigurationHash('wardenone',{enabled:true,blockTrackers:true},true),trialConfigurationHash('wardenone',{enabled:true,blockTrackers:false},true));
async function presetMigrationTest(){
  for(const preset of ['recommended','maximum']){
    const state={enabled:false};
    const context={DEFAULT_CONFIG:{enabled:true,blockTrackers:true},ONBOARDING_RECOMMENDED:{antiFingerprintNoise:false},ONBOARDING_MAX_PRIVACY:{antiFingerprintNoise:true},
      migrateStoredConfig:require('../upgrade-config.js').migrateStoredConfig,
      updateStoredConfig:mutate=>{Object.assign(state,mutate(state));return Promise.resolve(true);}};
    const cdp={send:async(method,params)=>({result:{value:await vm.runInNewContext(params.expression,context)}})};
    await configure(cdp,{attachedSession:'worker'},{product:'wardenone',preset});
    assert.equal(state.__locationPrivacyV344Enabled,true,'preset preparation preserves migration state');
    assert.equal(state.enabled,true);
    assert.equal(state.antiFingerprintNoise,preset==='maximum');
  }
}
presetMigrationTest().then(()=>console.log('[ok] balanced benchmark order, raw/distribution/paired statistics, failed-page exclusions, explicit settings, native fixtures and unknown metric handling'))
  .catch(error=>{console.error(error);process.exitCode=1;});

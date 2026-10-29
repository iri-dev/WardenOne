/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const crypto=require('crypto');
const ARMS=[{id:'off',product:'off',preset:'none'},{id:'warden-recommended',product:'wardenone',preset:'recommended'},
  {id:'ghostery-default',product:'ghostery',preset:'default'},{id:'warden-maximum',product:'wardenone',preset:'maximum'},
  {id:'ghostery-maximum',product:'ghostery',preset:'maximum'}];
const PAGES=['article','churn','frames8','frames30','media','auth'];
const METRICS=['taskMs','scriptMs','layoutMs','longTaskMs','longTasks','loadMs','dclMs','interactionMs','rendererHeapMiB','processPrivateMiB','processWorkingMiB','browserCpuMs','workerHeapMiB'];
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function feedProjection(key,value){
  if(key==='wardenone_aux_lists'){const {updated,...data}=value;return data;}
  if(key==='wardenone_list_integrity')return Object.fromEntries(Object.entries(value.sources||{}).map(([url,r])=>[url,{sha256:r.sha256,byteLength:r.byteLength}]));
  return value;
}
function configurationHash(product,config){if(product!=='ghostery')return hash(config);const {filtersUpdatedAt,revision,onboarding,...settings}=config;return hash(settings);}
function order(block){if(!Number.isInteger(block)||block<0)throw Error('Invalid block');return [0,1,4,2,3].map(x=>ARMS[(x+block)%ARMS.length].id);}
function cpuDelta(before,after){let total=0;for(const [pid,value]of Object.entries(after)){const difference=value-(before[pid]||0);if(difference>=0)total+=difference;}return total*1000;}
function rendererCounterDelta(before,after){return Number.isFinite(before)&&Number.isFinite(after)&&after>=before?(after-before)*1000:null;}
function stats(values){const v=values.filter(Number.isFinite).sort((a,b)=>a-b),q=p=>{if(!v.length)return null;const n=(v.length-1)*p,a=Math.floor(n),b=Math.ceil(n);return v[a]+(v[b]-v[a])*(n-a);};return {n:v.length,median:q(.5),p90:q(.9),min:q(0),max:q(1),raw:values};}
function pairedInterval(values){if(!values.length)return null;let seed=81301;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},samples=[];
  for(let i=0;i<2000;i++)samples.push(stats(Array.from({length:values.length},()=>values[Math.floor(random()*values.length)])).median);
  samples.sort((a,b)=>a-b);return {n:values.length,median:stats(values).median,lower95:samples[49],upper95:samples[1949],method:'paired block bootstrap median, deterministic 2000 resamples; small-n descriptive interval'};}
function summarize(report){const groups=[];
  for(const page of PAGES)for(const cache of ['cold','warm'])for(const arm of ARMS){const rows=report.trials.flatMap(t=>t.arm===arm.id?t.pages.filter(p=>p.page===page&&p.cache===cache):[]);
    groups.push({page,cache,arm:arm.id,attempted:rows.length,failed:rows.filter(x=>!x.compatible).length,metrics:Object.fromEntries(METRICS.map(k=>[k,stats(rows.filter(x=>x.compatible).map(x=>x[k]??null))]))});}
  const comparisons=[];for(const preset of ['recommended','maximum'])for(const page of PAGES)for(const cache of ['cold','warm']){
    const w=groups.find(x=>x.arm==='warden-'+preset&&x.page===page&&x.cache===cache),g=groups.find(x=>x.arm==='ghostery-'+(preset==='recommended'?'default':'maximum')&&x.page===page&&x.cache===cache);
    const pairs=[];for(let block=0;block<report.runs;block++){const a=report.trials.find(x=>x.block===block&&x.arm===w.arm)?.pages.find(x=>x.page===page&&x.cache===cache),b=report.trials.find(x=>x.block===block&&x.arm===g.arm)?.pages.find(x=>x.page===page&&x.cache===cache);if(a?.compatible&&b?.compatible&&Number.isFinite(a.taskMs)&&Number.isFinite(b.taskMs))pairs.push(a.taskMs-b.taskMs);}
    comparisons.push({preset,page,cache,taskDifferenceWardenMinusGhosteryMs:pairedInterval(pairs),eligible:w.failed===0&&g.failed===0&&pairs.length===report.runs});
  }
  return {groups,comparisons,overallWinner:null,scope:'Controlled corpus costs only. Security coverage differs; live pages, updates and worker lifecycle are separately reported.'};
}
function assertConfiguration(product,preset,config){
  if(product==='wardenone'){if(config.enabled!==true||config.adShield!==true||config.blockTrackers!==true||config.autoRejectConsent!==true||config.autoUpdateLists!==true)throw Error('Incomplete WardenOne baseline');if(preset==='maximum'&&config.antiFingerprintNoise!==true)throw Error('Maximum noise missing');}
  if(product==='ghostery'){for(const k of ['terms','blockAds','blockTrackers','blockAnnoyances','fixesFilters'])if(config[k]!==true)throw Error('Incomplete Ghostery '+k);if(config.mode!=='default')throw Error('Destructive Zap mode is not a practical browser baseline');}
}
function publicReady(name,state,product){if(!state||state.browserError)return false;
  if(name==='auth')return state.host==='accounts.google.com'&&state.loginFields>=1&&state.textLength>100;
  if(name==='article')return state.host==='en.wikipedia.org'&&state.path==='/wiki/Browser_extension'&&state.textLength>3000;
  if(product==='wardenone'&&!state.readyVersion)return false;
  return state.host===(name==='youtube'?'www.youtube.com':'www.twitch.tv')&&state.videos>0&&state.videoReadyState>=2&&state.textLength>(name==='youtube'?2500:1200);
}
module.exports={ARMS,PAGES,METRICS,canonical,hash,feedProjection,configurationHash,order,cpuDelta,rendererCounterDelta,stats,pairedInterval,summarize,assertConfiguration,publicReady};

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* PERF-09/AUD26-006 check in a disposable browser profile. It fills the extension's dynamic/session
   quota close to the browser limit, toggles SafeSearch, and compares the final SafeSearch band
   after restoring the original config. Nothing is written to the user's browser profile. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-dnr-'));
  let cdp = null;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', ROOT, port, dir,
      ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: extension.workerTargetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    const evaluate = async (expression) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || 'worker evaluation failed');
      return value.result && value.result.value;
    };
    const warmup = await evaluate(`(async () => {
      globalThis.__woDnrAwaitGeneration=async after=>{
        const deadline=Date.now()+30000;
        while(Date.now()<deadline){
          if(__refreshExtensionStateGeneration>after&&__refreshExtensionStateLastKey
            &&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued
            &&!__refreshExtensionStateTimer&&!__remoteListUpdateInFlight&&!__remoteListUpdateQueuedReason)return;
          await new Promise(r=>setTimeout(r,50));
        }
        throw Error('DNR reconcile did not settle: '+JSON.stringify({after,generation:__refreshExtensionStateGeneration,
          inFlight:__refreshExtensionStateInFlightKey,queued:__refreshExtensionStateQueued,
          degraded:await readReconcileDegraded()}));
      };
      const deadline=Date.now()+15000;
      while(!(await chrome.storage.local.get('wardenone_config')).wardenone_config){
        if(Date.now()>deadline)throw Error('Install did not initialize configuration');
        await new Promise(r=>setTimeout(r,50));
      }
      const dnr=chrome.declarativeNetRequest,original=dnr.getSessionRules.bind(dnr);
      let delayedReads=0;
      // Deliberately exceed the old fixed sleep before measuring any settings change.
      dnr.getSessionRules=async(...args)=>{
        const rules=await original(...args);
        delayedReads++;
        await new Promise(r=>setTimeout(r,2500));
        return rules;
      };
      try{
        let before=__refreshExtensionStateGeneration;
        await updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,autoUpdateLists:false,adShield:true,
          safeSearch:cfg.safeSearch!==true,loginCompatibility:true,blockFingerprintScripts:true,blockFraudVendorScripts:false,
          blockSearchAiAnswers:false,blockSponsoredSearchResults:false,googleSearchResultCleanup:false}));
        refreshExtensionState();
        await __woDnrAwaitGeneration(before);
        if((await chrome.storage.local.get('wardenone_config')).wardenone_config.safeSearch===true){
          before=__refreshExtensionStateGeneration;
          await updateStoredConfig(cfg=>Object.assign(cfg,{safeSearch:false}));
          await __woDnrAwaitGeneration(before);
        }
        await Promise.all([...__subsystemQueues.values()]);
        return {generation:__refreshExtensionStateGeneration,delayedReads};
      }finally{dnr.getSessionRules=original;}
    })()`);
    if (!warmup || warmup.delayedReads < 1) throw new Error('Delayed startup was not exercised');
    const seeded = await evaluate(`(async () => {
      const dnr=chrome.declarativeNetRequest;
      const [dynamic,session]=await Promise.all([dnr.getDynamicRules(),dnr.getSessionRules()]);
      const count=Math.max(0,29800-dynamic.length-session.length);
      const rules=Array.from({length:count},(_,i)=>({id:5000000+i,priority:1,
        action:{type:'block'},condition:{requestDomains:['profile-'+i+'.example'],resourceTypes:['script']}}));
      await dnr.updateDynamicRules({removeRuleIds:[],addRules:rules});
      return {seeded:count,existingDynamic:dynamic.length,existingSession:session.length};
    })()`);
    if (!seeded || seeded.seeded < 25000) throw new Error('Could not reach a useful near-limit rule count: ' + JSON.stringify(seeded));
    const baseline = await evaluate(`(async () => {
      const dnr=chrome.declarativeNetRequest;
      const config=(await chrome.storage.local.get('wardenone_config')).wardenone_config || {};
      const session=await dnr.getSessionRules();
      const band=session.filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      const loginBand=session.filter(r=>r.id>=807000&&r.id<807300).sort((a,b)=>a.id-b.id);
      const dynamic=await dnr.getDynamicRules();
      const fingerprintBand=dynamic.filter(r=>r.id>=931500&&r.id<931580).sort((a,b)=>a.id-b.id);
      const sponsorBand=dynamic.filter(r=>r.id>=931700&&r.id<931720).sort((a,b)=>a.id-b.id);
      globalThis.__woDnrProfile={config,band:JSON.stringify(band),loginBand:JSON.stringify(loginBand),
        fingerprintBand:JSON.stringify(fingerprintBand),sponsorBand:JSON.stringify(sponsorBand),
        counts:{dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0},
        timings:{dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0},traces:[]};
      const names={getDynamicRules:'dynamicReads',getSessionRules:'sessionReads',
        updateDynamicRules:'dynamicWrites',updateSessionRules:'sessionWrites'};
      for(const [name,key] of Object.entries(names)){
        const original=dnr[name].bind(dnr);
        const wrapped=(...args)=>{
          const p=globalThis.__woDnrProfile,started=performance.now();
          p.counts[key]++;
          if(key.startsWith('dynamic')&&p.traces.length<8) p.traces.push({key,stack:String(new Error().stack).split('\\n').slice(1,4).join(' | ')});
          const result=original(...args);
          const finish=()=>{p.timings[key]+=performance.now()-started};
          if(result&&typeof result.finally==='function') return result.then(async value=>{
            const ids=args[0]&&args[0].ruleIds;
            if(key==='dynamicReads'&&p.delayBand&&ids&&ids.includes(p.delayBand)){
              p.delayedReads[p.delayBand]=(p.delayedReads[p.delayBand]||0)+1;
              await new Promise(r=>setTimeout(r,120));
            }
            return value;
          }).finally(finish);
          finish();
          return result;
        };
        dnr[name]=wrapped;
        if(dnr[name]!==wrapped) throw Error('DNR instrument did not attach: '+name);
      }
      return {safeSearch:config.safeSearch===true,bandSize:band.length,loginBandSize:loginBand.length,
        fingerprintBandSize:fingerprintBand.length,sponsorBandSize:sponsorBand.length};
    })()`);
    const unrelated = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      let before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:{...p.config,blockSearchAiAnswers:!p.config.blockSearchAiAnswers}});
      await __woDnrAwaitGeneration(before);
      const counts={...p.counts};
      before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:p.config});
      await __woDnrAwaitGeneration(before);
      const restoredCounts={...p.counts};
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.timings={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.traces=[];
      return {changed:counts,restored:restoredCounts};
    })()`);
    if (!unrelated || Object.values(unrelated).some((counts) => Object.values(counts).some((count) => count !== 0))) {
      throw new Error('Unrelated search appearance setting caused DNR work: ' + JSON.stringify(unrelated));
    }
    const toggled = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      const started=performance.now();
      const before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:!p.config.safeSearch}});
      await __woDnrAwaitGeneration(before);
      const counts={...p.counts};
      const timings={...p.timings};
      const traces=p.traces.slice();
      const band=(await chrome.declarativeNetRequest.getSessionRules())
        .filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      return {observedWindowMs:Math.round(performance.now()-started),bandSize:band.length,
        changed:JSON.stringify(band)!==p.band,counts,timings,traces};
    })()`);
    if (!toggled || !toggled.changed) throw new Error('SafeSearch band did not change: ' + JSON.stringify(toggled));
    const restored = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.timings={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      const started=performance.now();
      const before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:p.config});
      await __woDnrAwaitGeneration(before);
      const counts={...p.counts};
      const timings={...p.timings};
      const band=(await chrome.declarativeNetRequest.getSessionRules())
        .filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      return {observedWindowMs:Math.round(performance.now()-started),bandSize:band.length,
        same:JSON.stringify(band)===p.band,counts,timings};
    })()`);
    if (!restored || !restored.same) throw new Error('SafeSearch band did not restore: ' + JSON.stringify(restored));
    const combined = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      let before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:true,loginCompatibility:false}});
      await __woDnrAwaitGeneration(before);
      const changed={...p.counts};
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:p.config});
      await __woDnrAwaitGeneration(before);
      const restoredCounts={...p.counts};
      const session=await chrome.declarativeNetRequest.getSessionRules();
      const safe=session.filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      const login=session.filter(r=>r.id>=807000&&r.id<807300).sort((a,b)=>a.id-b.id);
      return {changed,restoredCounts,exact:JSON.stringify(safe)===p.band&&JSON.stringify(login)===p.loginBand};
    })()`);
    if (!combined || !combined.exact || combined.changed.sessionWrites !== 1 || combined.restoredCounts.sessionWrites !== 1) {
      throw new Error('Two session owners did not merge or restore exactly: ' + JSON.stringify(combined));
    }
    /* The worker's bands share one dynamic-rule read, reused for up to 15 s, so a phase that starts
       inside that window makes no read and never meets the delay. Each phase drops it first. */
    const dynamicCombined = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      p.delayBand=931700;
      p.delayedReads={};
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.traces=[];
      __ownDynamicRulesRead=null;
      let before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:{...p.config,blockFingerprintScripts:false,googleSearchResultCleanup:true}});
      await __woDnrAwaitGeneration(before);
      const changed={...p.counts};
      const traces=p.traces.slice();
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.delayBand=931500;
      __ownDynamicRulesRead=null;
      before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:p.config});
      await __woDnrAwaitGeneration(before);
      const restoredCounts={...p.counts};
      p.delayBand=0;
      const dynamic=await chrome.declarativeNetRequest.getDynamicRules();
      const fingerprint=dynamic.filter(r=>r.id>=931500&&r.id<931580).sort((a,b)=>a.id-b.id);
      const sponsor=dynamic.filter(r=>r.id>=931700&&r.id<931720).sort((a,b)=>a.id-b.id);
      return {changed,restoredCounts,traces,delayedReads:p.delayedReads,
        exact:JSON.stringify(fingerprint)===p.fingerprintBand&&JSON.stringify(sponsor)===p.sponsorBand};
    })()`);
    if (!dynamicCombined || !dynamicCombined.exact || dynamicCombined.changed.dynamicWrites !== 1
      || dynamicCombined.restoredCounts.dynamicWrites !== 1 || dynamicCombined.delayedReads[931500] !== 1
      || dynamicCombined.delayedReads[931700] !== 1) {
      throw new Error('Two dynamic owners did not merge or restore exactly: ' + JSON.stringify(dynamicCombined));
    }
    const rapid = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      let before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:true}});
      await new Promise(r=>setTimeout(r,40));
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:false}});
      await new Promise(r=>setTimeout(r,40));
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:true}});
      await __woDnrAwaitGeneration(before);
      const applied={...p.counts};
      const active=(await chrome.declarativeNetRequest.getSessionRules()).filter(r=>r.id>=743000&&r.id<743040).length;
      before=__refreshExtensionStateGeneration;
      await chrome.storage.local.set({wardenone_config:p.config});
      await __woDnrAwaitGeneration(before);
      const restored=(await chrome.declarativeNetRequest.getSessionRules())
        .filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      return {applied,active,exact:JSON.stringify(restored)===p.band};
    })()`);
    if (!rapid || !rapid.exact || rapid.active < 1 || rapid.applied.sessionWrites !== 1) {
      throw new Error('Rapid settings did not settle to the newest generation: ' + JSON.stringify(rapid));
    }
    console.log(JSON.stringify({ browser:browser.Browser,warmup,seeded,baseline,unrelated,toggled,restored,combined,dynamicCombined,rapid }));
    console.log('[ok] near-limit browser toggle restored the exact SafeSearch rule band');
    await evaluate(`chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds:Array.from({length:${seeded.seeded}},(_,i)=>5000000+i),addRules:[]})`);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot)) throw new Error('Refusing to remove a profile outside temp');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (require.main === module) profile.mustFinish(run, 'browser-dnr-reconcile').catch((error) => { console.error(error); process.exitCode = 1; });

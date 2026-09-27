/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Manual PERF-09 check in a disposable Edge profile. It fills the extension's dynamic/session
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
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: extension.workerTargetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    const evaluate = async (expression) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || 'worker evaluation failed');
      return value.result && value.result.value;
    };
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
          if(result&&typeof result.finally==='function') return result.finally(finish);
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
      await chrome.storage.local.set({wardenone_config:{...p.config,blockSearchAiAnswers:!p.config.blockSearchAiAnswers}});
      await new Promise(r=>setTimeout(r,2200));
      const counts={...p.counts};
      await chrome.storage.local.set({wardenone_config:p.config});
      await new Promise(r=>setTimeout(r,2200));
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.timings={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.traces=[];
      return counts;
    })()`);
    if (Object.values(unrelated || {}).some((count) => count !== 0)) {
      throw new Error('Unrelated search appearance setting caused DNR work: ' + JSON.stringify(unrelated));
    }
    const toggled = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      const started=performance.now();
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:!p.config.safeSearch}});
      await new Promise(r=>setTimeout(r,2200));
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
      await chrome.storage.local.set({wardenone_config:p.config});
      await new Promise(r=>setTimeout(r,2200));
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
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:true,loginCompatibility:false}});
      await new Promise(r=>setTimeout(r,2200));
      const changed={...p.counts};
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      await chrome.storage.local.set({wardenone_config:p.config});
      await new Promise(r=>setTimeout(r,2200));
      const restoredCounts={...p.counts};
      const session=await chrome.declarativeNetRequest.getSessionRules();
      const safe=session.filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      const login=session.filter(r=>r.id>=807000&&r.id<807300).sort((a,b)=>a.id-b.id);
      return {changed,restoredCounts,exact:JSON.stringify(safe)===p.band&&JSON.stringify(login)===p.loginBand};
    })()`);
    if (!combined || !combined.exact || combined.changed.sessionWrites !== 1 || combined.restoredCounts.sessionWrites !== 1) {
      throw new Error('Two session owners did not merge or restore exactly: ' + JSON.stringify(combined));
    }
    const dynamicCombined = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      p.traces=[];
      await chrome.storage.local.set({wardenone_config:{...p.config,blockFingerprintScripts:false,googleSearchResultCleanup:true}});
      await new Promise(r=>setTimeout(r,2200));
      const changed={...p.counts};
      const traces=p.traces.slice();
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      await chrome.storage.local.set({wardenone_config:p.config});
      await new Promise(r=>setTimeout(r,2200));
      const restoredCounts={...p.counts};
      const dynamic=await chrome.declarativeNetRequest.getDynamicRules();
      const fingerprint=dynamic.filter(r=>r.id>=931500&&r.id<931580).sort((a,b)=>a.id-b.id);
      const sponsor=dynamic.filter(r=>r.id>=931700&&r.id<931720).sort((a,b)=>a.id-b.id);
      return {changed,restoredCounts,traces,exact:JSON.stringify(fingerprint)===p.fingerprintBand&&JSON.stringify(sponsor)===p.sponsorBand};
    })()`);
    if (!dynamicCombined || !dynamicCombined.exact || dynamicCombined.changed.dynamicWrites !== 1
      || dynamicCombined.restoredCounts.dynamicWrites !== 1) {
      throw new Error('Two dynamic owners did not merge or restore exactly: ' + JSON.stringify(dynamicCombined));
    }
    const rapid = await evaluate(`(async () => {
      const p=globalThis.__woDnrProfile;
      p.counts={dynamicReads:0,sessionReads:0,dynamicWrites:0,sessionWrites:0};
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:true}});
      await new Promise(r=>setTimeout(r,40));
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:false}});
      await new Promise(r=>setTimeout(r,40));
      await chrome.storage.local.set({wardenone_config:{...p.config,safeSearch:true}});
      await new Promise(r=>setTimeout(r,2200));
      const applied={...p.counts};
      const active=(await chrome.declarativeNetRequest.getSessionRules()).filter(r=>r.id>=743000&&r.id<743040).length;
      await chrome.storage.local.set({wardenone_config:p.config});
      await new Promise(r=>setTimeout(r,2200));
      const restored=(await chrome.declarativeNetRequest.getSessionRules())
        .filter(r=>r.id>=743000&&r.id<743040).sort((a,b)=>a.id-b.id);
      return {applied,active,exact:JSON.stringify(restored)===p.band};
    })()`);
    if (!rapid || !rapid.exact || rapid.active < 1 || rapid.applied.sessionWrites !== 1) {
      throw new Error('Rapid settings did not settle to the newest generation: ' + JSON.stringify(rapid));
    }
    console.log(JSON.stringify({ seeded, baseline, unrelated, toggled, restored, combined, dynamicCombined, rapid }));
    console.log('[ok] near-limit browser toggle restored the exact SafeSearch rule band');
    await evaluate(`chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds:Array.from({length:${seeded.seeded}},(_,i)=>5000000+i),addRules:[]})`);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot)) throw new Error('Refusing to remove a profile outside temp');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

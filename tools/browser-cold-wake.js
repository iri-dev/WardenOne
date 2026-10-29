/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Cold wakes in disposable Edge: browser CPU, rule-task attribution and UI stalls.
   Remote feeds must load; no worker debugger is attached during a sample.
   Run options and measurement limits: docs/perf/README.md. */
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Below this many dynamic rules the remote lists did not arrive, and a quiet wake proves nothing. */
const MIN_DYNAMIC_RULES = 5000;
const RULE_STALL_MS = 50;
const UI_STALL_BUDGET_MS = 300;

function parseArgs(argv) {
  const options = { runs: 1, out: null, traceDir: null, extension:null, browser:null, syntheticRules:null };
  const flags = new Map([['--runs', 'runs'], ['--out', 'out'], ['--trace-dir', 'traceDir'],['--extension','extension'],['--browser','browser'],['--synthetic-rules','syntheticRules']]);
  for (let i = 0; i < argv.length; i++) {
    const key = flags.get(argv[i]);
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('expected --runs <1-10>, --out <file>, or --trace-dir <directory>');
    options[key] = argv[++i];
  }
  options.runs = Number(options.runs);
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) throw new Error('--runs must be an integer from 1 to 10');
  if(options.syntheticRules!==null){options.syntheticRules=Number(options.syntheticRules);if(!Number.isInteger(options.syntheticRules)||options.syntheticRules<5000||options.syntheticRules>29950)throw new Error('--synthetic-rules must be 5000..29950');}
  return options;
}

function summariseTrace(events, browserPid) {
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(e.pid + ':' + e.tid, e.args.name);
  const tasks = events.filter((e) => e.pid === browserPid && e.ph === 'X'
    && (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'ThreadPool_RunTask') && Number.isFinite(e.dur) && e.dur >= 0);
  const ui = tasks.filter((e) => threads.get(e.pid + ':' + e.tid) === 'CrBrowserMain');
  if (![...threads.entries()].some(([key, name]) => key.startsWith(browserPid + ':') && name === 'CrBrowserMain')) {
    throw new Error('trace has no browser UI thread; refusing an empty stall result');
  }
  const long = ui.filter((e) => e.dur >= 16000);
  const isRuleTask = (e) => /declarative_net_request/.test((e.args && e.args.src_file) || '');
  const ruleTasks = new Map();
  for (const e of tasks.filter(isRuleTask)) {
    const thread = threads.get(e.pid + ':' + e.tid) || 'unknown';
    const source = e.args.src_file;
    const fn = e.args.src_func || 'unknown';
    const key = JSON.stringify([thread, source, fn]);
    const group = ruleTasks.get(key) || { thread, source, function: fn, tasks: 0, taskMs: 0 };
    group.tasks++;
    group.taskMs += e.dur / 1000;
    ruleTasks.set(key, group);
  }
  const round = (value) => Math.round(value * 100) / 100;
  return {
    stallMs: Math.round(long.reduce((sum, e) => sum + e.dur, 0) / 1000),
    stalls: long.length,
    worstMs: Math.round(long.reduce((max, e) => Math.max(max, e.dur), 0) / 1000),
    ruleStalls: long.filter((e) => isRuleTask(e) && e.dur >= RULE_STALL_MS * 1000).map((e) => Math.round(e.dur / 1000)),
    ruleUiTaskMs: round(ui.filter(isRuleTask).reduce((sum, e) => sum + e.dur, 0) / 1000),
    ruleBackgroundTaskMs: round(tasks.filter((e) => isRuleTask(e) && threads.get(e.pid + ':' + e.tid) !== 'CrBrowserMain')
      .reduce((sum, e) => sum + e.dur, 0) / 1000),
    ruleTasks: [...ruleTasks.values()].map((group) => ({ ...group, taskMs: round(group.taskMs) })),
  };
}

function browserProcess(info) {
  const browser = info.processInfo.find((item) => item.type === 'browser');
  if (!browser || !Number.isFinite(browser.id) || !Number.isFinite(browser.cpuTime)) throw new Error('browser process CPU counters unavailable');
  return browser;
}

async function traceUiThread(cdp, action, windowMs, tracePath) {
  const events = [];
  const off = cdp.on((msg) => { if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value); });
  try {
    await cdp.send('Tracing.start', { categories: 'toplevel,__metadata,v8,v8.execute,disabled-by-default-v8.compile', transferMode: 'ReportEvents' });
    await sleep(200);
    const before = browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
    const started = Date.now();
    await action();
    await sleep(windowMs);
    const after = browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
    if (before.id !== after.id || after.cpuTime < before.cpuTime) throw new Error('browser process changed during measurement');
    const elapsedMs = Date.now() - started;
    const done = cdp.waitFor((msg) => msg.method === 'Tracing.tracingComplete', 30000);
    await Promise.all([cdp.send('Tracing.end'), done]);
    if (tracePath) {
      fs.mkdirSync(path.dirname(tracePath), { recursive: true });
      fs.writeFileSync(tracePath, JSON.stringify({ traceEvents: events }));
    }
    const compile=events.filter(e=>e.ph==='X'&&/compile|parse/i.test(e.name)&&Number.isFinite(e.dur));
    return { ...summariseTrace(events, before.id), elapsedMs, browserCpuMs: Math.round((after.cpuTime - before.cpuTime) * 1000),
      compileEvents:compile.map(e=>({pid:e.pid,name:e.name,durationMs:e.dur/1000,url:e.args?.data?.url||e.args?.url||null})) };
  } finally { off(); }
}

async function resources(cdp, extension) {
  await cdp.send('HeapProfiler.collectGarbage',{},extension.attachedSession);
  const workerHeapAfterGcBytes=(await cdp.send('Runtime.getHeapUsage',{},extension.attachedSession)).usedSize;
  const browser=browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
  if(process.platform!=='win32')return {workerHeapAfterGcBytes,browserMemory:'unavailable on this platform'};
  if(!Number.isSafeInteger(browser.id)||browser.id<1)throw new Error('Invalid browser PID');
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-Command',
    'Get-Process -Id '+browser.id+' | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress'],{encoding:'utf8',timeout:10000});
  if(result.status!==0)throw new Error('Browser memory counters unavailable');
  const value=JSON.parse(result.stdout);
  return {workerHeapAfterGcBytes,browserPid:browser.id,browserPrivateBytes:value.PrivateMemorySize64,browserWorkingSetBytes:value.WorkingSet64};
}

async function popupSample(cdp,id,expectOffline) {
  const start=Date.now(),before=browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
  const {targetId}=await cdp.send('Target.createTarget',{url:'chrome-extension://'+id+'/popup.html'});
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  await cdp.send('Performance.enable',{},sessionId);
  const end=Date.now()+30000;
  for(;;){
    const state=await cdp.send('Runtime.evaluate',{expression:'document.readyState==="complete"&&typeof config==="object"'+(expectOffline?'&&config.autoUpdateLists===false':''),returnByValue:true},sessionId).catch(()=>null);
    if(state?.result?.value===true)break;
    if(Date.now()>end)throw new Error('Popup configuration did not load');
    await sleep(25);
  }
  const after=browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
  const metrics=(await cdp.send('Performance.getMetrics',{},sessionId)).metrics;
  return {targetId,readyMs:Date.now()-start,browserCpuMs:(after.cpuTime-before.cpuTime)*1000,rendererTaskMs:(metrics.find(x=>x.name==='TaskDuration')?.value||0)*1000};
}

async function run(options) {
  const root=options.extension?path.resolve(options.extension):ROOT;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>cold wake</title><p>' + 'A quiet page. '.repeat(120) + '</p>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-cold-wake-'));
  let cdp = null;
  const failures = [];
  const report = {
    measuredAt: new Date().toISOString(), version: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version,
    backgroundSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'background.js'))).digest('hex'),
    runtimeFingerprint:options.extension?identity.fingerprint(root).sha256:null,
    coverage:options.syntheticRules?'fixed synthetic native rules; remote feeds disabled':'live remote feeds',
    machine: { platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length },
    scenarios: [], failures, complete:false,
  };
  const save=()=>{if(options.out){fs.mkdirSync(path.dirname(path.resolve(options.out)),{recursive:true});fs.writeFileSync(options.out,JSON.stringify(report,null,2)+'\n');}};
  try {
    const start=Date.now();
    const browser = await profile.launch(options.browser||profile.edgePath(), 'on', root, port, dir,options.syntheticRules?['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']:[]);
    const endpointAt=Date.now();
    report.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    let extension = await profile.extensionReady(cdp, port, version);
    report.startup={browserEndpointMs:endpointAt-start,workerReadyAfterEndpointMs:Date.now()-endpointAt,firstParseBreakdown:'not observable before DevTools endpoint'};
    const settled=await cdp.send('Runtime.evaluate',{expression:`(async()=>{const end=Date.now()+30000;while(Date.now()<end){if(__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer)return true;await new Promise(r=>setTimeout(r,50));}throw Error('Startup reconcile did not settle');})()`,awaitPromise:true,returnByValue:true},extension.attachedSession);
    if(settled.exceptionDetails)throw new Error('Startup reconciliation failed');
    report.beforeRules=await resources(cdp,extension);
    const ruleCount = async () => {
      const value = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.declarativeNetRequest.getDynamicRules().then((rules) => rules.length)', awaitPromise: true, returnByValue: true,
      }, extension.attachedSession);
      return Number(value && value.result && value.result.value) || 0;
    };
    if(options.syntheticRules){
      const seeded=await cdp.send('Runtime.evaluate',{expression:`(async()=>{
        await updateStoredConfig(c=>{c.autoUpdateLists=false;});
        const end=Date.now()+30000;while(Date.now()<end){if(__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer)break;await new Promise(r=>setTimeout(r,50));}
        const before=await chrome.declarativeNetRequest.getDynamicRules();
        const extra=Array.from({length:Math.max(0,${options.syntheticRules}-before.length)},(_,i)=>({id:5000000+i,priority:1,action:{type:'block'},condition:{requestDomains:['fixed-'+i+'.example'],resourceTypes:['script']}}));
        await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[],addRules:extra});
        return {before:before.length,added:extra.length};})()`,returnByValue:true,awaitPromise:true},extension.attachedSession);
      if(seeded.exceptionDetails)throw new Error('Synthetic rule installation failed');report.seed=seeded.result.value;
      const session=await cdp.send('Runtime.evaluate',{expression:`chrome.storage.session.set({wardenone_tracker_session:{counted:['fixed-tracker.example'],siteView:{'fixed-top.example':{'fixed-tracker.example':1}}}}).then(()=>true)`,awaitPromise:true,returnByValue:true},extension.attachedSession);
      if(session.exceptionDetails)throw new Error('Session hydration seed failed');
    }
    /* The install fetches the remote lists; wait until the rule count stops moving. */
    let rules = 0;
    let steadySince = Date.now();
    const listDeadline = Date.now() + 150000;
    while (Date.now() < listDeadline) {
      const now = await ruleCount();
      if (now !== rules) { rules = now; steadySince = Date.now(); }
      if (rules >= MIN_DYNAMIC_RULES && (options.syntheticRules||Date.now() - steadySince > 10000)) break;
      await sleep(2000);
    }
    console.log(`  dynamic rules installed: ${rules}`);
    report.dynamicRules = rules;
    report.afterRules=await resources(cdp,extension);
    const inventory=await cdp.send('Runtime.evaluate',{expression:`(async()=>{
      const dnr=chrome.declarativeNetRequest,original=dnr.getDynamicRules;let calls=0,filters=[];
      dnr.getDynamicRules=function(...args){calls++;filters.push(args[0]?.ruleIds?.length||0);return original.apply(this,args);};
      try{__ownDynamicRulesRead=null;const start=performance.now();await Promise.all(ownDynamicRuleBands().map(([id,size])=>getDynamicRulesInBand(id,size)));
        const coldMs=performance.now()-start,coldCalls=calls,warmStart=performance.now();await Promise.all(ownDynamicRuleBands().map(([id,size])=>getDynamicRulesInBand(id,size)));
        return {coldMs,warmMs:performance.now()-warmStart,coldCalls,warmCalls:calls-coldCalls,filters};
      }finally{dnr.getDynamicRules=original;}})()`,awaitPromise:true,returnByValue:true},extension.attachedSession);
    if(inventory.exceptionDetails||inventory.result.value.coldCalls!==1||inventory.result.value.warmCalls!==0)throw new Error('Owned rule read sharing regressed');
    report.inventory=inventory.result.value;
    report.warmPopups=[];
    for(let i=0;i<3;i++){const sample=await popupSample(cdp,extension.id,!!options.syntheticRules);report.warmPopups.push(sample);await cdp.send('Target.closeTarget',{targetId:sample.targetId});}
    if (rules < MIN_DYNAMIC_RULES) throw new Error(`only ${rules} dynamic rules after the install: the remote lists did not arrive, so a cold wake here would not be representative`);

    const tabs = [];
    for (let i = 0; i < options.runs + 2; i++) {
      const { targetId } = await cdp.send('Target.createTarget', { url: origin + '/page-' + i });
      tabs.push(targetId);
      await sleep(400);
    }
    await profile.closeExtensionTabs(cdp, port, extension.id);
    await sleep(3000);

    let popup;
    const scenarios = [
      ['closing a tab', () => cdp.send('Target.closeTarget', { targetId: tabs.pop() })],
      ['opening the popup', async () => {popup=await popupSample(cdp,extension.id,!!options.syntheticRules);}],
    ];
    for (let round = 1; round <= options.runs; round++) {
      for (const [label, action] of scenarios) {
        await profile.releaseWorker(cdp, extension);
        extension.attachedSession = null;
        const tracePath = options.traceDir && path.join(options.traceDir, round + '-' + (label === 'closing a tab' ? 'tab' : 'popup') + '.json');
        const result = await traceUiThread(cdp, action, 5000, tracePath);
        report.scenarios.push({ round, label, ...result,...(label==='opening the popup'?{popup}:{} ) });
        console.log(`  ${label} on a sleeping worker: UI thread ${result.stalls} stalls >= 16 ms, ${result.stallMs} ms in all, worst ${result.worstMs} ms; rule-API stalls ${result.ruleStalls.length ? result.ruleStalls.join(', ') + ' ms' : 'none'}`);
        console.log(`    browser CPU ${result.browserCpuMs} ms over ${result.elapsedMs} ms; rule tasks ${result.ruleUiTaskMs} ms UI / ${result.ruleBackgroundTaskMs} ms background`);
        if (result.ruleStalls.length) failures.push(`${label}: ${result.ruleStalls.length} UI-thread stall(s) answering a rule-API call (${result.ruleStalls.join(', ')} ms) -- a wake is reading rules it does not need`);
        if (result.stallMs > UI_STALL_BUDGET_MS) failures.push(`${label}: ${result.stallMs} ms of UI-thread stalls, over the ${UI_STALL_BUDGET_MS} ms budget`);
        extension=await profile.extensionReady(cdp,port,version);
        const hydration=await cdp.send('Runtime.evaluate',{expression:`(async()=>{const start=performance.now(),state=trackerSessionState();await state.mirror.ready();return {ms:performance.now()-start,counted:state.counted.has('fixed-tracker.example')};})()`,awaitPromise:true,returnByValue:true},extension.attachedSession);
        if(hydration.exceptionDetails||options.syntheticRules&&!hydration.result.value.counted)throw new Error('Worker session hydration failed');
        report.scenarios[report.scenarios.length-1].hydration=hydration.result.value;
        report.scenarios[report.scenarios.length-1].resources=await resources(cdp,extension);
        if(options.syntheticRules&&await ruleCount()!==options.syntheticRules)throw new Error('Cold wake changed the fixed rule inventory');
        save();
        await profile.closeExtensionTabs(cdp, port, extension.id);
      }
    }
    report.complete=failures.length===0;
    if(options.extension&&identity.fingerprint(root).sha256!==report.runtimeFingerprint)throw new Error('Measured runtime changed');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('wo-cold-wake-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn('[warn] could not remove the temporary profile: ' + error.message); }
    }
    save();
  }
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  }
  if (failures.length) {
    for (const failure of failures) console.log('  FAIL ' + failure);
    process.exitCode = 1;
    return;
  }
  console.log('[ok] a cold wake leaves the browser UI thread free: no rule-API stalls closing a tab or opening the popup');
}

module.exports = { parseArgs, summariseTrace, browserProcess, traceUiThread };
if (require.main === module) {
  profile.mustFinish(() => run(parseArgs(process.argv.slice(2))), 'cold-wake profile')
    .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const { tls } = require('./browser-media-security.js');
const SITES = ['alpha.learner-one.test', 'beta.learner-two.test', 'gamma.learner-three.test'];
const HOSTS = [...SITES, 'paused.learner-four.test', 'child.frame-fixture.test', 'a.trowow.de', 'g.doubleclick.net', 'fpjs.io', 'cdn.jsdelivr.net'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
async function cpu(cdp) {
  return new Map((await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(row => [row.id, row.cpuTime * 1000]));
}
function args(argv) {
  const options = { runs: 5 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].slice(2), value = argv[i + 1];
    if (!['browser', 'candidate', 'reference', 'out', 'runs'].includes(key) || !value) throw new Error('Expected paired browser/candidate/reference/out/runs options');
    options[key] = key === 'runs' ? Number(value) : path.resolve(value);
  }
  if (!options.browser || !options.candidate || !options.reference || !options.out || !Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) throw new Error('All paths and 1..10 runs required');
  return options;
}
async function runOne(build, run, options, server, hits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-tracker-learning-'));
  const origin = host => 'https://' + host + ':' + server.address().port;
  const resolver = HOSTS.map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ');
  const flags = ['--host-resolver-rules=' + resolver, '--ignore-certificate-errors', '--disable-features=TrackingProtection3pcd,CalculateNativeWinOcclusion'];
  const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json')));
  let port, cdp, extension, page, context;
  const result = { build: build.label, run, complete: false, checks: [] };
  try {
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const quiet = () => until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'reconciliation');
    const launch = async () => {
      port = await profile.freePort();
      const browser = await profile.launch(options.browser, 'on', build.directory, port, dir, flags);
      cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
      extension = await profile.extensionReady(cdp, port, manifest.version); await quiet();
      await profile.closeExtensionTabs(cdp, port, extension.id); result.browser = browser.Browser;
      await worker('globalThis.__learnerMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info=>{if(info.request.url.includes("/probe?"))__learnerMatches.push(info);});true');
    };
    const started = Date.now(); await launch(); result.startupMs = Date.now() - started;
    result.supported = await worker('typeof noteTrackerNetworkRequest==="function"');
    result.observer = result.supported && await worker('chrome.webRequest.onBeforeRequest.hasListener(trackerNetworkListener)');
    if (build.label === 'candidate') assert(result.observer, 'targeted observer must be registered');
    await cdp.send('HeapProfiler.collectGarbage', {}, extension.attachedSession);
    result.workerHeapDefaultAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession)).usedSize;
    const setConfig = async patch => {
      await worker('updateStoredConfig(cfg=>{Object.assign(cfg,' + JSON.stringify(patch) + ');}).then(()=>true)');
      await sleep(100); await quiet();
    };
    await setConfig({ enabled: true, trackerLearner: true, adShield: false, blockTrackers: false, blockCnameTrackers: false,
      blockThirdPartyCookies: false, blockFingerprintScripts: false });
    await worker(`(async()=>{const data={version:TRACKER_LEARNER_STORE_VERSION,salt:'00112233445566778899aabbccddeeff',domains:{},siteControls:{}};
      await localSet({[TRACKER_LEARNER_KEY]:data});TRACKER_LEARNER=trackerStoreShape(data);__initTrackerLearner=Promise.resolve(TRACKER_LEARNER);
      await chrome.storage.session.remove('wardenone_tracker_session');__trackerSession=null;return true;})()`);
    const newPage = async () => {
      const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
      page = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
      await cdp.send('Page.enable', {}, page);
    };
    const navigate = async (host, redirect = false) => {
      await cdp.send('Page.navigate', { url: origin(host) + (redirect ? '/top-redirect' : '/') }, page);
      const expected = redirect ? SITES[1] : host;
      await until(() => evaluate(cdp, page, 'document.readyState==="complete"&&location.hostname===' + JSON.stringify(expected)), 'fixture page');
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, page);
      context = (await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'native-tracker-learning' }, page)).executionContextId;
    };
    let serial = 0;
    const request = async (host, blocked = false, world = context, session = page) => {
      const token = build.label + '-' + run + '-' + (++serial), url = origin(host) + '/probe?token=' + token;
      const response = await evaluate(cdp, session, `(async()=>{try{const r=await fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(5000)});return {ok:r.ok};}catch(e){return {error:String(e)};}})()`, world);
      await sleep(75);
      const receipt = hits.some(row => row.token === token);
      assert.equal(receipt, !blocked, host + ': server receipt');
      if (!blocked) assert(response.ok, JSON.stringify(response));
      const matched = await worker('globalThis.__learnerMatches.filter(info=>info.request.url.includes(' + JSON.stringify('token=' + token) + ')).map(info=>info.rule)');
      if (blocked) assert(await worker('globalThis.__learnerMatches.some(info=>info.request.url.includes(' + JSON.stringify('token=' + token)
        + ')&&info.rule.ruleId>=TRACKER_RULE_BASE&&info.rule.ruleId<TRACKER_RULE_BASE+TRACKER_RULE_MAX)'), 'learner native rule must confirm the block');
      return { token, receipt, response, matched };
    };
    const learnerRules = () => worker('getDynamicRulesInBand(TRACKER_RULE_BASE,TRACKER_RULE_MAX).then(rows=>rows.filter(row=>row.id>=TRACKER_RULE_BASE&&row.id<TRACKER_RULE_BASE+TRACKER_RULE_MAX))');
    await newPage();
    for (const [host, redirect] of [[SITES[0], false], [SITES[0], true], [SITES[2], false]]) {
      await navigate(host, redirect); await request('a.trowow.de');
    }
    await until(async () => !result.supported || await worker('TRACKER_LEARNER.domains["etracker.com"]?.sites===3'), 'three verified sites');
    if (result.supported) {
      assert.equal(await worker('TRACKER_LEARNER.domains["etracker.com"].sessions'), 1);
      assert.equal(await worker('trackerLearnerProposals().length'), 0);
      assert.equal((await learnerRules()).length, 0);
      const status = await worker('trackerLearnerStatus(' + JSON.stringify(origin(SITES[1]) + '/') + ')');
      assert(status.items.some(row => row.domain === 'etracker.com'), 'redirect belongs to the committed top site');
      await evaluate(cdp, page, `new Promise(resolve=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(origin('child.frame-fixture.test') + '/')};frame.onload=()=>resolve(true);document.body.appendChild(frame);})`, context);
      let childSession = page, childId;
      await until(async () => {
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, page);
        const child = frameTree.childFrames?.find(row => row.frame.url.startsWith(origin('child.frame-fixture.test')));
        if (child) { childId = child.frame.id; return true; }
        const { targetInfos } = await cdp.send('Target.getTargets');
        const remote = targetInfos.find(row => row.type === 'iframe' && row.url.startsWith(origin('child.frame-fixture.test')));
        if (!remote) return false;
        childSession = (await cdp.send('Target.attachToTarget', { targetId: remote.targetId, flatten: true })).sessionId;
        await cdp.send('Page.enable', {}, childSession);
        childId = (await cdp.send('Page.getFrameTree', {}, childSession)).frameTree.frame.id;
        return true;
      }, 'nested frame target');
      const childWorld = (await cdp.send('Page.createIsolatedWorld', { frameId: childId, worldName: 'native-child-learning' }, childSession)).executionContextId;
      await request('g.doubleclick.net', false, childWorld, childSession);
      await until(() => worker('!!TRACKER_LEARNER.domains["doubleclick.net"]'), 'child observation');
      const topStatus = await worker('trackerLearnerStatus(' + JSON.stringify(origin(SITES[2]) + '/') + ')');
      const childStatus = await worker('trackerLearnerStatus(' + JSON.stringify(origin('child.frame-fixture.test') + '/') + ')');
      assert(topStatus.items.some(row => row.domain === 'doubleclick.net'));
      assert(!childStatus.items.some(row => row.domain === 'doubleclick.net'));
      result.checks.push('redirect and nested frame attribution');
    }
    const beforeCpu = await cpu(cdp), burstStart = Date.now();
    const burst = await evaluate(cdp, page, `Promise.all(Array.from({length:100},(_,i)=>fetch(${JSON.stringify(origin('a.trowow.de') + '/probe?token=burst-' + build.label + '-' + run + '-')}+i).then(r=>r.ok)))`, context);
    assert(burst.every(Boolean));
    await sleep(100); const afterCpu = await cpu(cdp);
    result.burst = { requests: 100, wallMs: Date.now() - burstStart,
      allProcessCpuMs: [...afterCpu].reduce((sum, [id, ms]) => sum + Math.max(0, ms - (beforeCpu.get(id) || 0)), 0) };
    if (result.supported) {
      assert.equal(await worker('TRACKER_LEARNER.domains["etracker.com"].hits'), 3, 'burst is coalesced');
      await setConfig({ siteOverrides: { 'learner-four.test': { trackerLearner: false } } });
      await navigate('paused.learner-four.test'); await request('a.trowow.de');
      assert.equal(await worker('TRACKER_LEARNER.domains["etracker.com"].hits'), 3);
      await setConfig({ siteOverrides: {} });
      result.checks.push('per-site opt-out and repetition coalescing');
    }
    await profile.killBrowser(cdp, port); cdp.close(); await launch(); await newPage();
    for (const host of SITES) { await navigate(host); await request('g.doubleclick.net'); }
    await navigate(SITES[0]); await request('a.trowow.de');
    if (result.supported) {
      await until(() => worker('trackerLearnerProposals().some(row=>row.domain==="etracker.com")'), 'two-session CNAME proposal');
      await until(() => worker('trackerLearnerProposals().some(row=>row.domain==="doubleclick.net")'), 'two-session tracker proposal');
      assert.equal((await learnerRules()).length, 0, 'proposals never authorize rules');
      const stored = await worker('localGet(TRACKER_LEARNER_KEY).then(row=>JSON.stringify(row[TRACKER_LEARNER_KEY]))');
      for (const host of HOSTS) assert(!stored.includes(host), 'durable learner contains a visited host: ' + host);
      const history = await worker('localGet("wardenone_history").then(row=>(row.wardenone_history||[]).filter(item=>item.type==="proposed_tracker_domain"))');
      assert(history.every(row => !row.url));
      const { targetId: popupId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
      const ui = (await cdp.send('Target.attachToTarget', { targetId: popupId, flatten: true })).sessionId;
      await until(() => evaluate(cdp, ui, '!!document.getElementById("tracker-learner-proposals")?.textContent.includes("etracker.com")'), 'proposal UI');
      const choose = async (domain, label) => {
        await evaluate(cdp, ui, `(()=>{const row=[...document.querySelectorAll('#tracker-learner-proposals .perm-row')].find(row=>row.textContent.includes(${JSON.stringify(domain)}));
          const button=[...row.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(label)});button.click();return true;})()`);
      };
      /* The compact popup row names the confidence; its source is in the row's title and in Settings history. */
      result.proposalText = await evaluate(cdp, ui, '[...document.querySelectorAll("#tracker-learner-proposals .perm-row-label")].map(row=>row.textContent+" | "+row.title).join("\\n")');
      assert(result.proposalText.includes('corroborated') && result.proposalText.includes('Local CNAME mapping'), result.proposalText);
      await choose('doubleclick.net', 'Ignore');
      await until(() => worker('TRACKER_LEARNER.domains["doubleclick.net"].state==="dismissed"'), 'ignore choice');
      await request('g.doubleclick.net');
      assert.equal(await worker('trackerLearnerProposals().some(row=>row.domain==="doubleclick.net")'), false);
      await choose('etracker.com', 'Block requests');
      await until(() => worker('TRACKER_LEARNER.domains["etracker.com"].state==="learned"'), 'approval');
      await until(async () => (await learnerRules()).length > 1, 'native approval installed');
      await until(() => evaluate(cdp, ui, '!document.getElementById("tracker-learner-proposals").textContent.includes("etracker.com")'), 'approval acknowledged');
      await request('a.trowow.de', true);
      const rules = await learnerRules(); assert(rules.length > 1);
      assert(rules.every(rule => !rule.condition.resourceTypes.includes('script') && !rule.condition.resourceTypes.includes('sub_frame')));
      result.approvedRules = rules.length;
      await worker('setTrackerLearnerSiteMode(' + JSON.stringify(origin(SITES[0])) + ',"etracker.com","allow")');
      await request('a.trowow.de');
      await setConfig({ trackerLearner: false });
      await until(() => worker('!chrome.webRequest.onBeforeRequest.hasListener(trackerNetworkListener)'), 'observer disabled');
      result.checks.push('private persistence', 'approval-only alias enforcement', 'ignore suppression', 'explicit site allowance', 'observer disabled');
      await cdp.send('Target.closeTarget', { targetId: popupId });
    } else {
      result.networkLearningStatus = 'unsupported';
      assert.equal(await worker('Object.keys(TRACKER_LEARNER.domains).length'), 0, 'isolated-world requests are not page reports');
    }
    result.complete = true;
  } catch (error) { result.error = String(error.stack || error); }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-tracker-learning-')) throw new Error('Unexpected profile path');
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { result.cleanupWarning = String(error.message); }
  }
  return result;
}
async function main(options) {
  const builds = ['reference', 'candidate'].map(label => ({ label, directory: options[label], fingerprint: identity.fingerprint(options[label]).sha256 }));
  const report = { createdAt: new Date().toISOString(), toolSha256: identity.sha256(fs.readFileSync(__filename)), builds,
    browserSha256: identity.sha256(fs.readFileSync(options.browser)), machine: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, platform: process.platform, release: os.release() }, results: [], completed: false };
  const hits = [], server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url, 'https://' + req.headers.host);
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/top-redirect') { res.writeHead(302, { Location: 'https://' + SITES[1] + ':' + server.address().port + '/' }); res.end(); return; }
    if (url.pathname === '/probe') { hits.push({ token: url.searchParams.get('token'), host: req.headers.host }); res.end('fixture'); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Tracker learning fixture</title><input value="editable">'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const save = () => { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2)); };
  try {
    for (let run = 1; run <= options.runs; run++) for (const build of run % 2 ? builds : [...builds].reverse()) {
      console.log('Tracker learning ' + build.label + ' ' + run + '/' + options.runs);
      const row = await runOne(build, run, options, server, hits); report.results.push(row); save();
      if (!row.complete) throw new Error(row.error);
    }
    for (const build of builds) assert.equal(identity.fingerprint(build.directory).sha256, build.fingerprint, 'measured source changed');
    report.completed = true;
  } finally { save(); await new Promise(resolve => server.close(resolve)); }
  console.log('[ok] real network attribution, redirect/frame identity, restart, privacy, approval and alias enforcement');
}
if (require.main === module) profile.mustFinish(() => main(args(process.argv.slice(2))), 'tracker learner browser checks')
  .catch(error => { console.error(error); process.exitCode = 1; });

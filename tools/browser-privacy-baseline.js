/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const baseline = require('./lib/privacy-baseline.js');
const { tls } = require('./browser-media-security.js');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const HOSTS = Object.freeze({ page: 'shop.wardenone-baseline.example.org', same: 'api.shop.wardenone-baseline.example.org',
  tracker: 'tracker.wardenone-baseline.example.net', knownAlias: 'metrics.shop.wardenone-baseline.example.org',
  unknownAlias: 'unlisted.shop.wardenone-baseline.example.org', auth: 'accounts.google.com', packaged: 'google-analytics.com' });

function fixtureServer(hits) {
  return https.createServer(tls, (request, response) => {
    const host = String(request.headers.host || '').split(':')[0];
    const url = new URL(request.url, 'https://' + host);
    if (url.pathname === '/probe') {
      hits.push({ host, token: url.searchParams.get('token'), cookie: request.headers.cookie || '',
        responseCookie: 'baseline_new=fixed; SameSite=None; Secure; Path=/' });
      response.setHeader('Set-Cookie', 'baseline_new=fixed; SameSite=None; Secure; Path=/');
      response.setHeader('Content-Type', 'text/plain');
      response.setHeader('Access-Control-Allow-Origin', 'https://' + HOSTS.page + ':' + request.socket.localPort);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Cache-Control', 'no-store');
      response.end('fixture');
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end('<!doctype html><title>Privacy baseline</title><p>Controlled fixture</p><input id="editor" value="editable">');
    }
  });
}

async function evaluate(cdp, session, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function until(fn, description, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(100); }
  throw new Error('Timed out: ' + description);
}

async function browserCpu(cdp) {
  const browser = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(item => item.type === 'browser');
  if (!browser || !Number.isFinite(browser.cpuTime)) throw new Error('Browser CPU unavailable');
  return { id: browser.id, ms: browser.cpuTime * 1000 };
}

async function runOne(build, run, snapshots, server, hits) {
  const result = { build: build.label, run, scenarios: [], measurements: [], complete: false };
  if (build.product !== 'off') baseline.verifyBuild(build);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-privacy-baseline-'));
  fs.mkdirSync(path.join(dir, 'Default'));
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({
    profile: { cookie_controls_mode: 0, block_third_party_cookies: false, default_content_setting_values: { cookies: 1 } },
  }));
  const port = await profile.freePort();
  const origin = host => 'https://' + host + ':' + server.address().port;
  const resolver = Object.values(HOSTS).map(host => 'MAP ' + host + ' 127.0.0.1').concat('MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1').join(', ');
  let cdp, extension, page, ui;
  const started = Date.now();
  try {
    const browser = await profile.launch(snapshots.browserPath, build.product === 'off' ? 'off' : 'on', build.directory || '', port, dir, [
      '--host-resolver-rules=' + resolver, '--ignore-certificate-errors',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,TrackingProtection3pcd',
    ]);
    result.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const worker = expression => evaluate(cdp, extension.attachedSession, expression);
    const attach = async url => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Network.enable', {}, sessionId);
      await until(() => evaluate(cdp, sessionId, 'location.href===' + JSON.stringify(url) + '&&document.readyState==="complete"'), 'target navigation');
      return { targetId, sessionId };
    };
    if (build.product !== 'off') {
      extension = await profile.extensionReady(cdp, port, build.version);
      await profile.closeExtensionTabs(cdp, port, extension.id);
      await until(() => worker('!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer'), 'initial reconciliation');
      await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
      result.initialRules = await worker(`Promise.all([chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.declarativeNetRequest.getEnabledRulesets()]).then(([dynamic,session,enabled])=>({dynamic:dynamic.length,session:session.length,enabled}))`);
      result.settings = await worker('({antiFingerprintNoise:DEFAULT_CONFIG.antiFingerprintNoise,blockThirdPartyCookies:DEFAULT_CONFIG.blockThirdPartyCookies})');
      await worker(`globalThis.__privacyBaselineMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(d=>{
        if(d.request.url.includes('/probe?'))__privacyBaselineMatches.push({url:d.request.url,ruleId:d.rule.ruleId,rulesetId:d.rule.rulesetId});});true`);
    }
    result.startupWallMs = Date.now() - started;
    result.browserCpuAtReadyMs = (await browserCpu(cdp)).ms;
    page = await attach(origin(HOSTS.page) + '/');
    await until(() => evaluate(cdp, page.sessionId, 'location.href===' + JSON.stringify(origin(HOSTS.page) + '/') + '&&document.readyState==="complete"'), 'fixture navigation');
    if (extension) await until(() => evaluate(cdp, page.sessionId, 'window.__wardenOneReadyVersion===' + JSON.stringify(build.version)), 'page engine');
    else assert.equal(await evaluate(cdp, page.sessionId, 'typeof window.__wardenOneReadyVersion'), 'undefined');
    const frames = await cdp.send('Page.getFrameTree', {}, page.sessionId);
    let { executionContextId: requestContext } = await cdp.send('Page.createIsolatedWorld',
      { frameId: frames.frameTree.frame.id, worldName: 'privacy-baseline-network' }, page.sessionId);
    const requests = new Map();
    cdp.on(message => {
      if (message.sessionId !== page.sessionId) return;
      if (message.method === 'Network.requestWillBeSent') {
        const value = requests.get(message.params.requestId) || {};
        requests.set(message.params.requestId, { ...value, url: message.params.request.url });
      } else if (message.method === 'Network.requestWillBeSentExtraInfo') {
        const value = requests.get(message.params.requestId) || {};
        requests.set(message.params.requestId, { ...value, cookieBlockedReasons: message.params.associatedCookies
          .filter(item => item.cookie.name === 'baseline_old').flatMap(item => item.blockedReasons) });
      }
    });

    const cookie = async (host, name) => {
      const got = await cdp.send('Network.getCookies', { urls: [origin(host) + '/'] }, page.sessionId);
      return got.cookies.find(item => item.name === name)?.value || null;
    };
    let serial = 0;
    const request = async (name, host, policy, unsupported = false) => {
      const token = build.label + '-' + run + '-' + (++serial);
      await cdp.send('Network.deleteCookies', { name: 'baseline_new', url: origin(host) + '/' }, page.sessionId);
      const seeded = await cdp.send('Network.setCookie', { name: 'baseline_old', value: 'fixed', url: origin(host) + '/', secure: true, sameSite: 'None' }, page.sessionId);
      assert(seeded.success && await cookie(host, 'baseline_old') === 'fixed', 'fixture cookie must be present before request');
      const before = await browserCpu(cdp), start = Date.now();
      const response = await evaluate(cdp, page.sessionId, `(async()=>{try{const r=await fetch(${JSON.stringify(origin(host) + '/probe?token=' + token)},{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(8000)});return {ok:r.ok,text:await r.text()};}catch(e){return {ok:false,error:String(e)};}})()`, requestContext);
      const latencyMs = Date.now() - start;
      const after = await browserCpu(cdp);
      assert.equal(before.id, after.id, 'browser changed during measurement');
      const received = hits.find(item => item.token === token) || null;
      if (!received && extension) await sleep(200);
      const matched = extension ? await worker('globalThis.__privacyBaselineMatches.filter(item=>item.url.includes(' + JSON.stringify('token=' + token) + '))') : [];
      for (const match of matched) {
        if (match.rulesetId === '_session' || match.rulesetId === '_dynamic') {
          const method = match.rulesetId === '_session' ? 'getSessionRules' : 'getDynamicRules';
          match.action = await worker('chrome.declarativeNetRequest.' + method + '({ruleIds:[' + match.ruleId + ']}).then(rows=>rows[0]?.action.type||null)');
        } else {
          const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json')));
          const resource = manifest.declarative_net_request.rule_resources.find(item => item.id === match.rulesetId);
          match.action = resource ? JSON.parse(fs.readFileSync(path.join(build.directory, resource.path))).find(rule => rule.id === match.ruleId)?.action.type : null;
        }
      }
      const stored = await cookie(host, 'baseline_new');
      const heap = await cdp.send('Runtime.getHeapUsage', {}, page.sessionId);
      const workerHeap = extension ? await cdp.send('Runtime.getHeapUsage', {}, extension.attachedSession) : null;
      const blocked = matched.some(rule => rule.action === 'block');
      const status = baseline.requestStatus({ received: !!received, blockedEvidence: blocked,
        cookieBefore: true, cookieAtServer: received?.cookie.includes('baseline_old=fixed'),
        cookieStoredAfter: received ? stored === 'fixed' : undefined, unsupported });
      const record = { name, profile: policy, status, networkOutcome: received ? 'received' : blocked ? 'blocked-with-dnr-evidence' : 'unobserved',
        requestedHost: host, requestCookie: received?.cookie || null, responseSetCookie: received?.responseCookie || null,
        storedNewCookie: stored, matchedRules: matched, response, latencyMs,
        browserCookieBlockedReasons: [...requests.values()].find(value => value.url?.includes('token=' + token))?.cookieBlockedReasons || [],
        browserCpuMs: after.ms - before.ms, rendererHeapBytes: heap.usedSize, extensionHeapBytes: workerHeap?.usedSize ?? null };
      result.scenarios.push(record);
      if (status === 'error') throw new Error('Request lacks either server receipt or enforcement evidence: ' + name + ' ' + JSON.stringify(response));
      if (build.product === 'off') assert(received?.cookie.includes('baseline_old=fixed') && stored === 'fixed', 'Cookie control failed: ' + JSON.stringify(record));
      return record;
    };

    const primary = 'default-offline-bundled-rules';
    await request('packaged-tracker', HOSTS.packaged, primary);
    await request('same-site-api-cookie', HOSTS.same, primary);
    await request('cross-site-auth-cookie', HOSTS.auth, primary);
    await request('unknown-third-party-cookie', HOSTS.tracker, primary);
    await request('known-alias-fixture', HOSTS.knownAlias, primary, !!extension);
    await request('unknown-alias-fixture', HOSTS.unknownAlias, primary);
    assert.equal(await evaluate(cdp, page.sessionId, '(()=>{const e=document.getElementById("editor");e.value="edited";return e.value;})()'), 'edited');

    const fpCpuBefore = await browserCpu(cdp), fpStart = Date.now();
    const fingerprinting = await evaluate(cdp, page.sessionId, `(()=>{
      const canvas=document.createElement('canvas');canvas.width=240;canvas.height=50;
      const ctx=canvas.getContext('2d');ctx.font='16px sans-serif';ctx.fillText('Controlled fingerprint workload',5,25);
      const first=canvas.toDataURL();for(let i=0;i<100;i++){canvas.toDataURL();ctx.measureText('width-'+i);}
      const surface=document.createElement('canvas'),gl=surface.getContext('webgl');
      if(gl){gl.clearColor(0,1,0,1);gl.clear(gl.COLOR_BUFFER_BIT);}
      const audio=new AudioBuffer({length:64,numberOfChannels:1,sampleRate:44100});audio.getChannelData(0).fill(0.25);
      const a=Array.from(audio.getChannelData(0)),b=Array.from(audio.getChannelData(0));
      return {canvasRepeatEqual:first===canvas.toDataURL(),webglAvailable:!!gl,
        audioRepeatEqual:a.every((v,i)=>v===b[i]),audioApplicationDataIntact:b.every(v=>v===0.25)};
    })()`);
    result.measurements.push({ name: 'scripted-fingerprinting-default', result: 'observed', latencyMs: Date.now() - fpStart,
      browserCpuMs: (await browserCpu(cdp)).ms - fpCpuBefore.ms, ...fingerprinting,
      note: 'API consistency and application data checks; this does not prove tracker detection.' });

    if (extension) {
      ui = await attach('chrome-extension://' + extension.id + '/permissions.html');
      const beforeRules = await evaluate(cdp, ui.sessionId, 'chrome.declarativeNetRequest.getSessionRules()');
      const id = beforeRules.find(rule => rule.id === 900007)?.id;
      assert(id, 'tracker cookie rule installed');
      const rejected = await evaluate(cdp, ui.sessionId, `(async()=>{try{await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[${id}],addRules:[{id:${id},priority:1,action:{type:'block'},condition:{regexFilter:'['}}]});return false;}catch(_){return true;}})()`);
      assert(rejected, 'invalid native replacement must be rejected');
      assert.deepEqual(await evaluate(cdp, ui.sessionId, 'chrome.declarativeNetRequest.getSessionRules()'), beforeRules);
      result.ruleFailure = { rejected: true, lastKnownGoodRulesPreserved: true };

      const versions = new Map();
      const stopListening = cdp.on(message => {
        if (message.method === 'ServiceWorker.workerVersionUpdated') for (const value of message.params.versions) versions.set(value.versionId, value);
      });
      await cdp.send('ServiceWorker.enable', {}, ui.sessionId);
      await until(async () => [...versions.values()].some(value => value.scriptURL === 'chrome-extension://' + extension.id + '/background.js' && value.runningStatus === 'running'), 'worker version');
      await worker('globalThis.__privacyBaselineSentinel=true;true');
      const old = extension.workerTargetId;
      const oldWorkerSession = extension.attachedSession;
      const workerVersion = [...versions.values()].find(value => value.scriptURL === 'chrome-extension://' + extension.id + '/background.js' && value.runningStatus === 'running');
      const restartCpuBefore = await browserCpu(cdp), restartStart = Date.now();
      await cdp.send('ServiceWorker.stopWorker', { versionId: workerVersion.versionId }, ui.sessionId);
      await until(async () => !(await cdp.send('Target.getTargets')).targetInfos.some(target => target.targetId === old), 'worker stop');
      const suspendedRules = await evaluate(cdp, ui.sessionId, 'chrome.declarativeNetRequest.getSessionRules()');
      assert.deepEqual(suspendedRules, beforeRules, 'DNR must survive worker termination');
      await evaluate(cdp, ui.sessionId, `chrome.runtime.sendMessage({kind:'privacy-baseline-wake'}).then(()=>true,()=>true)`);
      extension = await profile.extensionReady(cdp, port, build.version);
      await cdp.send('Target.detachFromTarget', { sessionId: oldWorkerSession }).catch(() => {});
      assert.equal(await worker('typeof globalThis.__privacyBaselineSentinel'), 'undefined');
      await worker('Promise.all([...__subsystemQueues.values()]).then(()=>true)');
      assert.deepEqual(await evaluate(cdp, ui.sessionId, 'chrome.declarativeNetRequest.getSessionRules()'), beforeRules);
      result.restart = { result: 'pass', privateHeapReplaced: true, sessionRulesSurvived: true,
        fullReconcileTriggered: await worker('!!__refreshExtensionStateLastKey'),
        latencyMs: Date.now() - restartStart, browserCpuMs: (await browserCpu(cdp)).ms - restartCpuBefore.ms };
      stopListening();
      await cdp.send('Page.navigate', { url: origin(HOSTS.page) + '/' }, page.sessionId);
      await until(() => evaluate(cdp, page.sessionId, 'location.href===' + JSON.stringify(origin(HOSTS.page) + '/') + '&&document.readyState==="complete"&&window.__wardenOneReadyVersion===' + JSON.stringify(build.version)), 'post-restart fixture navigation');
      const restartedFrame = await cdp.send('Page.getFrameTree', {}, page.sessionId);
      requestContext = (await cdp.send('Page.createIsolatedWorld', { frameId: restartedFrame.frameTree.frame.id, worldName: 'privacy-baseline-network' }, page.sessionId)).executionContextId;
      result.restart.followedByFreshNavigation = true;
      await worker(`globalThis.__privacyBaselineMatches=[];chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(d=>{
        if(d.request.url.includes('/probe?'))__privacyBaselineMatches.push({url:d.request.url,ruleId:d.rule.ruleId,rulesetId:d.rule.rulesetId});});true`);

      await worker(`packagedHeaderTrackerDomains=async()=>[${JSON.stringify(HOSTS.tracker)}];__trackerCookieRuleEnabled=null;applyTrackerCookieRule(true).then(()=>true)`);
      const cookiePolicy = await request('confirmed-tracker-cookie-policy', HOSTS.tracker, 'synthetic-trusted-domain-dependency');
      result.cookiePolicy = { outgoingRemoved: !cookiePolicy.requestCookie?.includes('baseline_old=fixed'),
        incomingRemoved: cookiePolicy.storedNewCookie === null,
        source: 'Unmodified production rule owner with a synthetic trusted domain provider; no block rule added.' };

      const tabId = await worker(`chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(origin(HOSTS.page) + '/')}).id)`);
      await cdp.send('Target.closeTarget', { targetId: ui.targetId });
      ui = await attach('chrome-extension://' + extension.id + '/firewall.html?site=' + HOSTS.page + '&tab=' + tabId);
      await until(() => evaluate(cdp, ui.sessionId, 'typeof RULES==="object"'), 'firewall UI');
      const applied = await evaluate(cdp, ui.sessionId, `new Promise(resolve=>chrome.runtime.sendMessage({kind:'firewall-set',site:${JSON.stringify(HOSTS.page)},domain:${JSON.stringify(HOSTS.tracker)},column:'cookie',verdict:'strip'},resolve))`);
      assert(applied?.ok, JSON.stringify(applied));
      const manual = await request('manual-firewall-cookie-policy', HOSTS.tracker, 'synthetic-trusted-domain-plus-manual-cookie-strip');
      assert(manual.networkOutcome === 'received' && !manual.requestCookie?.includes('baseline_old=fixed'), 'manual cookie firewall must remove the fixture cookie on a delivered request');
      result.storageBytes = await worker('Promise.all([chrome.storage.local.getBytesInUse(null),chrome.storage.session.getBytesInUse(null)]).then(([local,session])=>({local,session}))');
      await cdp.send('Target.closeTarget', { targetId: ui.targetId });
      ui = null;
      await profile.closeExtensionTabs(cdp, port, extension.id);
      const idleTrigger = await cdp.send('Target.createTarget', { url: 'about:blank' });
      await evaluate(cdp, page.sessionId, 'document.getElementById("editor").value="idle-edited"');
      await worker('globalThis.__privacyBaselineIdleSentinel=true;true');
      await cdp.send('HeapProfiler.collectGarbage', {}, page.sessionId);
      const idleHeapBefore = (await cdp.send('Runtime.getHeapUsage', {}, page.sessionId)).usedSize;
      const idleStart = Date.now();
      await profile.releaseWorker(cdp, extension, 120000);
      const idleCpuBefore = await browserCpu(cdp), idleWakeStart = Date.now();
      await cdp.send('Target.closeTarget', { targetId: idleTrigger.targetId });
      await until(async () => (await cdp.send('Target.getTargets')).targetInfos.some(target => target.type === 'service_worker'
        && target.url === 'chrome-extension://' + extension.id + '/background.js'), 'native wake after tab close', 5000);
      extension = await profile.extensionReady(cdp, port, build.version);
      const idleWakeLatencyMs = Date.now() - idleWakeStart;
      const idleCpuAfter = await browserCpu(cdp);
      assert.equal(await worker('typeof globalThis.__privacyBaselineIdleSentinel'), 'undefined');
      assert.equal(await evaluate(cdp, page.sessionId, 'document.getElementById("editor").value'), 'idle-edited');
      await cdp.send('HeapProfiler.collectGarbage', {}, page.sessionId);
      result.idleWake = { result: 'pass', stoppedWithDebuggerDetached: true, trigger: 'tab-close',
        idleWaitMs: idleWakeStart - idleStart, latencyMs: idleWakeLatencyMs,
        browserCpuMs: idleCpuAfter.ms - idleCpuBefore.ms, browserProcessUnchanged: idleCpuAfter.id === idleCpuBefore.id,
        rendererHeapBeforeIdleBytes: idleHeapBefore,
        rendererHeapAfterIdleBytes: (await cdp.send('Runtime.getHeapUsage', {}, page.sessionId)).usedSize,
        pageStillUsable: true, measurementIncludesReadinessChecks: true };
      assert(result.idleWake.browserProcessUnchanged);
    }
    result.complete = true;
  } catch (error) {
    result.error = String(error.stack || error);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('wo-privacy-baseline-')) throw new Error('Unexpected profile path');
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { result.cleanupWarning = String(error.message); }
  }
  return result;
}

async function main(options) {
  const snapshots = JSON.parse(fs.readFileSync(options.snapshots));
  assert.equal(baseline.sha256(fs.readFileSync(snapshots.browserPath)), snapshots.browserSha256, 'browser changed');
  const labels = options.builds || ['off', 'reference', 'candidate'];
  const builds = labels.map(label => label === 'off' ? { label, product: 'off' } : snapshots.builds.find(build => build.label === label));
  if (builds.some(build => !build || !['wardenone', 'off'].includes(build.product))) throw new Error('This lab measures WardenOne and browser controls; comparator adapters require an independently ready runtime');
  const report = { schema: 1, createdAt: new Date().toISOString(), runs: options.runs,
    machine: { platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length },
    snapshots, fixture: { hosts: HOSTS, knownAlias: { requestedHost: HOSTS.knownAlias, canonicalTarget: HOSTS.tracker,
      source: 'Synthetic mapping declaration; DNS is mapped to loopback, not a real CNAME chain.' } },
    toolSha256: baseline.sha256(fs.readFileSync(__filename)), results: [], completed: false,
    notes: ['Fresh disposable profile for each build/run. Remote DNS is refused; only listed loopback fixtures are reachable.',
      'TrackingProtection3pcd is disabled only in disposable test browsers; third-party cookie access is verified by every extension-off server control.',
      'Network probes use a dedicated isolated execution world so page-side fetch wrappers cannot hide native header/DNR behavior.',
      'Default cases use bundled protection; remote-feed coverage is unavailable, not treated as an empty successful update.',
      'Matched DNR IDs and server headers distinguish egress blocking from cookie isolation and missing observations.',
      'The synthetic trusted-domain policy case supplies only a fixture classification dependency; it does not test feed discovery.',
      'Cookie results include the native browser policy; the extension-off control must be considered before attributing a difference.',
      'Attached sessions are warm. Forced termination and ordinary idle shutdown are separate scenarios; idle sampling drops the worker debugger and wakes it by closing a tab.',
      'CPU is browser-process CPU; heap is V8 used heap, not total RAM. Missing extension heap stays unavailable.',
      'No competitive score is computed; the supplied MV2 comparator requires a compatible, successfully initialized runtime.'],
  };
  const save = () => { report.summary = baseline.summarize(report.results); fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2)); };
  const hits = [], server = fixtureServer(hits);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (let run = 1; run <= options.runs; run++) {
      for (const build of run % 2 ? builds : [...builds].reverse()) {
        console.log('Privacy baseline ' + build.label + ' ' + run + '/' + options.runs);
        const result = await runOne(build, run, snapshots, server, hits);
        report.results.push(result);
        save();
        if (!result.complete) throw new Error('Incomplete baseline: ' + build.label + ': ' + result.error);
      }
    }
    for (const build of builds.filter(build => build.product !== 'off')) baseline.verifyBuild(build);
    report.completed = true;
  } finally { save(); await new Promise(resolve => server.close(resolve)); }
  console.log('[ok] ' + options.runs + ' clean runs per build; explicit network outcomes, header observations and recovery evidence saved');
}

module.exports = { HOSTS, fixtureServer };
if (require.main === module) profile.mustFinish(() => main(baseline.parseArgs(process.argv.slice(2))), 'privacy baseline')
  .catch(error => { console.error(error); process.exitCode = 1; });

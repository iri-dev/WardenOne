/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const options = { extension: root, browser: process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), out: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--extension': 'extension', '--browser': 'browser', '--out': 'out' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw Error('Expected --extension path --browser path --out path');
  options[key] = path.resolve(process.argv[i + 1]);
}

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-interruption-'));
  let cdp;
  const report = { createdAt: new Date().toISOString(), complete: false, results: [],
    extension: options.extension, fingerprint: options.extension === root ? null : identity.fingerprint(options.extension).sha256,
    backgroundSha256: identity.sha256(fs.readFileSync(path.join(options.extension, 'background.js'))) };
  try {
    const browser = await profile.launch(options.browser, 'on', options.extension, port, dir,
      ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    report.browser = browser.Browser;
    report.browserSha256 = identity.sha256(fs.readFileSync(options.browser));
    const version = JSON.parse(fs.readFileSync(path.join(options.extension, 'manifest.json'), 'utf8')).version;
    let extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (expression, session = extension.attachedSession) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (check, label, timeout = 20000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (await check()) return; await sleep(80); }
      throw Error('Timed out: ' + label);
    };
    await evaluate(`updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,autoUpdateLists:false,capReferrer:false}))`);
    await until(() => evaluate(`!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey
      &&!__refreshExtensionStateQueued&&!__refreshExtensionStateTimer`), 'baseline reconciliation');
    assert.equal(await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]}).then(r=>r.length)`), 0);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/permissions.html' });
    const page = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page.sessionId);
    const versions = new Map();
    const off = cdp.on((message) => {
      if (message.method !== 'ServiceWorker.workerVersionUpdated') return;
      for (const item of message.params.versions) versions.set(item.versionId, item);
    });
    await cdp.send('ServiceWorker.enable', {}, page.sessionId);
    await until(async () => Array.from(versions.values()).some((item) => item.scriptURL === 'chrome-extension://' + extension.id + '/background.js'
      && item.runningStatus === 'running'), 'service worker version');
    await evaluate(`(async()=>{
      applyHeaderShieldRules=async()=>{globalThis.__interruptionReached=true;await new Promise(()=>{});};
      await updateStoredConfig(cfg=>Object.assign(cfg,{capReferrer:true}));
    })()`);
    await until(() => evaluate('globalThis.__interruptionReached===true'), 'held rule owner');
    const pending = () => evaluate(`chrome.storage.session.get('wardenone_reconcile_pending')
      .then(s=>!!s.wardenone_reconcile_pending)`, page.sessionId);
    assert.equal(await pending(), true, 'intent is durable while an owner is still pending');
    assert.equal(await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]}).then(r=>r.length)`), 0);

    const stop = async () => {
      const running = Array.from(versions.values()).find((item) => item.scriptURL === 'chrome-extension://' + extension.id + '/background.js'
        && item.runningStatus === 'running');
      assert.ok(running, 'running worker version');
      const oldTarget = extension.workerTargetId;
      await evaluate('globalThis.__interruptionReached=true');
      let stopped = false;
      const offStop = cdp.on((message) => {
        if (message.method === 'ServiceWorker.workerVersionUpdated' && message.params.versions.some((item) =>
          item.versionId === running.versionId && item.runningStatus === 'stopped')) stopped = true;
        if (message.method === 'Target.targetDestroyed' && message.params.targetId === oldTarget) stopped = true;
      });
      try {
        await cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId }, page.sessionId);
        await until(async () => stopped || !(await cdp.send('Target.getTargets')).targetInfos.some((item) => item.targetId === oldTarget), 'forced worker termination');
      } finally { offStop(); }
    };
    const wake = async () => {
      await evaluate(`chrome.runtime.sendMessage({kind:'worker-interruption-test-wake'}).then(()=>true,()=>true)`, page.sessionId);
      extension = await profile.extensionReady(cdp, port, version);
      assert.equal(await evaluate('typeof globalThis.__interruptionReached'), 'undefined', 'recovery uses a fresh worker realm');
    };
    await stop();
    assert.equal(await pending(), true, 'termination must not erase unfinished intent');
    await wake();
    await until(async () => !await pending() && await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]})
      .then(r=>r.length===1)`), 'latest setting restored by the new worker');
    report.results.push({ stage: 'session-rule-intent', recovered: true });
    console.log('[ok] forced worker termination preserves intent and resumes the latest rule setting in ' + browser.Browser);

    const stages = ['failed-read', 'intent-written', 'dnr-pending', 'storage-ack-pending', 'success-before-cleanup'];
    for (const name of ['grabber', 'miner']) for (const stage of stages) {
      const key = 'wardenone_feed_load_' + name;
      const alarmName = 'wardenone-feed-load-' + name;
      const domain = 'recovery-' + stage + '-' + name + '.example';
      const inputKey = name === 'grabber' ? 'wardenone_grabber_domains' : 'wardenone_cryptominer_domains';
      const input = name === 'grabber' ? [domain] : { minerHosts: [domain], poolHosts: [] };
      const base = name === 'grabber' ? 740000 : 742000;
      const rules = async () => evaluate(`chrome.declarativeNetRequest.getDynamicRules({ruleIds:Array.from({length:1000},(_,i)=>${base}+i)})`, page.sessionId);
      await until(() => evaluate(`!__feedLoadJobs.size`), 'feed recovery idle');
      const before = await rules();
      await evaluate(`(()=>{
        const name=${JSON.stringify(name)},key=${JSON.stringify(key)},stage=${JSON.stringify(stage)};
        const hold=()=>{globalThis.__interruptionReached=true;return new Promise(()=>{});};
        if(stage==='failed-read'){
          const oldFetch=fetch;
          fetch=(url,...args)=>String(url).endsWith(name==='grabber'?'grabber-extra.json':'cryptominer-domains.json')
            ?Promise.reject(Error('injected packaged read failure')):oldFetch(url,...args);
          scheduleFeedLoadRetry=async()=>hold();
        }
        if(stage==='intent-written'){
          const oldFetch=fetch;
          fetch=(url,...args)=>String(url).endsWith(name==='grabber'?'grabber-extra.json':'cryptominer-domains.json')
            ?hold():oldFetch(url,...args);
        }
        if(stage==='dnr-pending'){
          const oldWrite=writeDynamicRules;
          writeDynamicRules=(change)=>{
            const pending=oldWrite(change);
            if((change.addRules||[]).some(rule=>rule.id>=${base}&&rule.id<${base + 1000})){
              pending.catch(()=>{});return hold();
            }
            return pending;
          };
        }
        if(stage==='storage-ack-pending'){
          const oldSet=chrome.storage.session.set.bind(chrome.storage.session);
          chrome.storage.session.set=async(values)=>{
            if(values[key]?.phase==='loading')return hold();
            return oldSet(values);
          };
        }
        if(stage==='success-before-cleanup'){
          const oldRemove=chrome.storage.session.remove.bind(chrome.storage.session);
          chrome.storage.session.remove=(value)=>value===key?hold():oldRemove(value);
        }
      })()`);
      await evaluate(`chrome.storage.local.set({[${JSON.stringify(inputKey)}]:${JSON.stringify(input)}})`, page.sessionId);
      await until(() => evaluate('globalThis.__interruptionReached===true'), name + ' ' + stage);
      const checkpointBefore = await evaluate(`chrome.storage.session.get(${JSON.stringify(key)}).then(s=>s[${JSON.stringify(key)}]||null)`, page.sessionId);
      const alarmBefore = await evaluate(`chrome.alarms.get(${JSON.stringify(alarmName)})`, page.sessionId);
      assert.ok(alarmBefore, 'browser wake armed before ' + stage);
      if (stage !== 'storage-ack-pending') assert.equal(checkpointBefore.phase, 'loading');
      const heldRules = await rules();
      if (stage === 'failed-read' || stage === 'intent-written' || stage === 'storage-ack-pending') assert.deepEqual(heldRules, before, 'unread inputs retain the old band');
      if (stage === 'success-before-cleanup') assert.ok(heldRules.some(rule => rule.condition.requestDomains.includes(domain)));
      await stop();
      assert.deepEqual(await rules(), heldRules, 'dynamic rules survive worker termination');
      assert.equal(await evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]}).then(r=>r.length)`, page.sessionId), 1,
        'session rules survive worker termination');
      await wake();
      await until(async () => (await rules()).some(rule => rule.condition.requestDomains.includes(domain))
        && await evaluate(`chrome.storage.session.get(${JSON.stringify(key)}).then(s=>!s[${JSON.stringify(key)}])`, page.sessionId), name + ' recovery at ' + stage);
      await until(async () => !await evaluate(`chrome.alarms.get(${JSON.stringify(alarmName)}).then(a=>!!a)`, page.sessionId), 'recovery alarm cleared');
      assert.equal(await evaluate(`typeof globalThis.__interruptionReached`), 'undefined');
      report.results.push({ name, stage, checkpointBefore, alarmBefore, rulesBefore: before.length, rulesHeld: heldRules.length,
        rulesRecovered: (await rules()).length, dynamicSurvived: true, sessionSurvived: true, recovered: true });
      console.log('[ok] ' + name + ': forced termination at ' + stage + ' recovers the latest inputs');
    }
    for (const setting of ['blockGrabberResources', 'warnGrabberDomains', 'blockMalwareSites']) {
      const id = { blockGrabberResources: 740000, warnGrabberDomains: 741000, blockMalwareSites: 741001 }[setting];
      const injectFailure = () => evaluate(`(()=>{
        const oldFetch=fetch;
        fetch=(url,...args)=>String(url).endsWith('grabber-extra.json')?Promise.reject(Error('injected unavailable sources')):oldFetch(url,...args);
      })()`);
      await until(() => evaluate('!__feedLoadJobs.size'), 'feed idle before cold partial disable');
      await injectFailure();
      assert.equal((await evaluate('loadGrabberFeed()')).ok, false);
      await stop();
      await wake();
      await until(() => evaluate('!__feedLoadJobs.size'), 'deferred cold grabber load');
      assert.equal(await evaluate('__grabberFeedReady'), false);
      assert.ok(await evaluate('GRABBER_FEED_DOMAINS.size>0'), 'installed membership hydrated during backoff');
      await injectFailure();
      await evaluate(`updateStoredConfig(cfg=>Object.assign(cfg,{[${JSON.stringify(setting)}]:false}))`);
      await until(() => evaluate(`(async()=>{const r=await chrome.declarativeNetRequest.getDynamicRules({ruleIds:[740000,741000,741001]});
        return !r.some(x=>x.id===${id})&&r.length===2&&!__feedLoadJobs.size;})()`), 'explicit partial disable during failed cold load');
      await stop();
      await wake();
      await until(() => evaluate('!__feedLoadJobs.size'), 'cold partial disable replay');
      const remaining = await evaluate(`chrome.declarativeNetRequest.getDynamicRules({ruleIds:[740000,741000,741001]}).then(r=>r.map(x=>x.id))`);
      assert.equal(remaining.length, 2);
      assert.ok(!remaining.includes(id));
      await evaluate(`updateStoredConfig(cfg=>Object.assign(cfg,{[${JSON.stringify(setting)}]:true}))`);
      await until(() => evaluate(`(async()=>{const s=await chrome.storage.session.get('wardenone_feed_load_grabber');return !s.wardenone_feed_load_grabber&&__grabberFeedReady;})()`), 'enabled grabber recovered');
      report.results.push({ name: 'grabber', stage: 'unhydrated-partial-off', setting, remaining, recovered: true });
      console.log('[ok] cold unavailable grabber data honors ' + setting + ' off while retaining the other bands');
    }
    await until(() => evaluate('!__feedLoadJobs.size'), 'feeds settled before autonomous wake');
    await evaluate(`(()=>{
      const oldFetch=fetch;
      fetch=(url,...args)=>String(url).endsWith('cryptominer-domains.json')
        ?Promise.reject(Error('injected failure before autonomous wake')):oldFetch(url,...args);
    })()`);
    assert.equal((await evaluate('loadMinerFeed()')).ok, false);
    const scheduled = await evaluate(`chrome.alarms.get('wardenone-feed-load-miner')`, page.sessionId);
    assert.ok(scheduled);
    await stop();
    const stoppedAt = Date.now();
    await until(() => evaluate(`chrome.storage.session.get('wardenone_feed_load_miner').then(s=>!s.wardenone_feed_load_miner)`, page.sessionId),
      'browser alarm wakes and repairs without a runtime message', 90000);
    extension = await profile.extensionReady(cdp, port, version);
    assert.equal(await evaluate('typeof globalThis.__interruptionReached'), 'undefined');
    report.results.push({ name: 'miner', stage: 'autonomous-alarm-wake', recovered: true,
      scheduled, elapsedMs: Date.now() - stoppedAt });
    console.log('[ok] browser alarm autonomously wakes the stopped worker and recovers the failed feed');
    await until(() => evaluate(`!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer`), 'reconciliation settled');
    await evaluate(`refreshExtensionState=()=>{globalThis.__interruptionReached=true;};updateStoredConfig(cfg=>Object.assign(cfg,{capReferrer:false}))`);
    await until(() => evaluate('globalThis.__interruptionReached===true'), 'held reconciliation debounce');
    assert.ok(await evaluate(`chrome.alarms.get('wardenone-reconcile')`, page.sessionId));
    await stop();
    const debounceStoppedAt = Date.now();
    await until(() => evaluate(`chrome.declarativeNetRequest.getSessionRules({ruleIds:[900005]}).then(r=>r.length===0)`, page.sessionId),
      'reconcile alarm repairs a setting interrupted before pending intent', 90000);
    extension = await profile.extensionReady(cdp, port, version);
    assert.equal(await evaluate('typeof globalThis.__interruptionReached'), 'undefined');
    report.results.push({ stage: 'reconcile-debounce-alarm', recovered: true, elapsedMs: Date.now() - debounceStoppedAt });
    console.log('[ok] reconciliation alarm recovers a settings change lost before the debounce ran');
    off();
    if (report.fingerprint) assert.equal(identity.fingerprint(options.extension).sha256, report.fingerprint);
    assert.equal(identity.sha256(fs.readFileSync(path.join(options.extension, 'background.js'))), report.backgroundSha256);
    report.complete = true;
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    try {
      if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('wo-interruption-')) {
        await sleep(2000);
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 300 });
        report.cleanupComplete = true;
      }
    } finally {
      if (options.out) { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n'); }
    }
  }
}
profile.mustFinish(run, 'browser-worker-interruption').catch((error) => { console.error(error); process.exitCode = 1; });

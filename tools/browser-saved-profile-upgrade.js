/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { fingerprint, sha256 } = require('./lib/privacy-baseline.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');

const options = { browser: process.env.WARDENONE_BROWSER_PATH || profile.edgePath() };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--old': 'old', '--candidate': 'candidate', '--out': 'out', '--lane': 'lane', '--browser': 'browser' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw Error('Expected --old path --candidate path --lane name --out path');
  options[key] = key === 'lane' ? process.argv[i + 1] : path.resolve(process.argv[i + 1]);
}
for (const key of ['old', 'candidate', 'out', 'lane']) if (!options[key]) throw Error('Missing ' + key);
assert(['oldest', 'published', 'store'].includes(options.lane));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function manifest(directory) { return JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')); }
function replaceExtension(parent, source) {
  const target = path.resolve(parent, 'extension');
  assert.equal(path.dirname(target), path.resolve(parent));
  assert.equal(path.basename(target), 'extension');
  assert(fs.existsSync(path.join(source, 'manifest.json')));
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.cpSync(source, target, { recursive: true });
  return target;
}

async function run() {
  const oldManifest = manifest(options.old), newManifest = manifest(options.candidate);
  const report = { createdAt: new Date().toISOString(), complete: false, lane: options.lane,
    old: { version: oldManifest.version, fingerprint: fingerprint(options.old).sha256 },
    candidate: { version: newManifest.version, fingerprint: fingerprint(options.candidate).sha256 },
    browserSha256: sha256(fs.readFileSync(options.browser)) };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-upgrade-'));
  const extensionDir = replaceExtension(directory, options.old);
  const profileDir = path.join(directory, 'profile');
  let cdp, port;
  const start = async expectedVersion => {
    const startedAt = Date.now();
    port = await profile.freePort();
    const browser = await profile.launch(options.browser, 'on', extensionDir, port, profileDir,
      ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    report.browser = browser.Browser;
    const extension = await profile.extensionReady(cdp, port, expectedVersion);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    report.startupMs ||= [];
    report.startupMs.push(Date.now() - startedAt);
    return extension;
  };
  const stop = async () => {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); cdp = null; }
  };
  const evaluate = async (extension, expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, extension.attachedSession);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (check, label, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
    throw Error('Timed out: ' + label);
  };
  const snapshot = extension => evaluate(extension, `(async()=>{
    const keys=['wardenone_config','wardenone_user_rules','wardenone_firewall','wardenone_tracker_learner',
      'wardenone_history','wardenone_cleaner_settings','wardenone_cleaner_state'];
    const store=await chrome.storage.local.get(keys);
    const [dynamic,session,alarms]=await Promise.all([chrome.declarativeNetRequest.getDynamicRules(),
      chrome.declarativeNetRequest.getSessionRules(),chrome.alarms.getAll()]);
    const band=(rules,from,to)=>rules.filter(rule=>rule.id>=from&&rule.id<to)
      .map(rule=>({id:rule.id,priority:rule.priority,action:rule.action.type,domains:rule.condition.requestDomains||[],
        initiators:rule.condition.initiatorDomains||[],filter:rule.condition.urlFilter||''}));
    return {store,dynamic:{user:band(dynamic,750000,760000),firewall:band(dynamic,950000,951000),
      tracker:band(dynamic,720000,730000),security:band(dynamic,740000,743000)},
      sessionCount:session.length,alarms:alarms.map(alarm=>alarm.name)};
  })()`);
  try {
    let extension = await start(oldManifest.version);
    report.extensionId = extension.id;
    await until(async () => !!(await evaluate(extension, `chrome.storage.local.get('wardenone_config').then(s=>s.wardenone_config)`)), 'old config initialized');
    const newest = options.lane !== 'oldest';
    const seeded = await evaluate(extension, `(async()=>{
      const now=Date.now(),store=await chrome.storage.local.get('wardenone_config');
      const cfg={...store.wardenone_config,enabled:true,autoUpdateLists:false,sendPrivacySignals:true,
        autoRejectConsent:false,blockThirdPartyCookies:true,allowlist:['trusted.upgrade.example']};
      if(${newest}){
        cfg.siteOverrides={'news.upgrade.example':{blockTrackers:false}};
        cfg.historyMode='normal';
      }else{
        cfg.blockGeolocation=false;
        delete cfg.__locationPrivacyV344Enabled;
        cfg.stopYouTubeVideoPreviews=true;
        delete cfg.stopAnimatedVideoPreviews;
        cfg.retiredProviderKey='synthetic-test-value';
      }
      const learner={domains:${newest ? `{'tracker.example':{state:'learned',approvedAt:now,firstSeen:now,lastSeen:now,hits:5,sites:3,sessions:2,signals:{network:3}}}` : `{'tracker.example':{state:'learned',firstSeen:now,lastSeen:now,hits:5,sites:{'publisher.example':{hits:3,lastSeen:now}},signals:{network:3}}}`},
        siteControls:{'publisher.example':{allow:{'tracker.example':now},block:{}}}};
      if(${newest}){learner.version=3;learner.salt='0123456789abcdef0123456789abcdef';}
      const values={wardenone_config:cfg,wardenone_tracker_learner:learner,
        wardenone_history:[{type:'blocked_tracker',url:'https://history.upgrade.example/',at:now,
          detail:{host:'track.upgrade.example'}}]};
      if(${newest}){
        values.wardenone_user_rules={text:'||ads.upgrade.example^',updatedAt:now};
        values.wardenone_firewall={'news.upgrade.example':{'cdn.upgrade.example':{script:'block'}}};
      }
      await chrome.storage.local.set(values);
      refreshExtensionState();
      return {keys:Object.keys(values),version:chrome.runtime.getManifest().version};
    })()`);
    report.seeded = seeded;
    await until(async () => {
      const s = await snapshot(extension);
      return s.store.wardenone_config?.allowlist?.includes('trusted.upgrade.example')
        && s.store.wardenone_tracker_learner?.siteControls?.['publisher.example']?.allow?.['tracker.example'];
    }, 'old decisions stored');
    report.before = await snapshot(extension);
    await stop();
    replaceExtension(directory, options.candidate);
    extension = await start(newManifest.version);
    await cdp.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()', returnByValue: true }, extension.attachedSession).catch(() => {});
    await sleep(500);
    extension = await profile.extensionReady(cdp, port, newManifest.version);
    report.extensionReload = true;
    assert.equal(extension.id, report.extensionId, 'extension identity changed across upgrade');
    report.candidateWorker = await evaluate(extension, '({cleaner:typeof WO_CLEANER,migration:typeof migrateStoredConfig})');
    report.candidateInitial = await snapshot(extension);
    await until(async () => {
      const s = await snapshot(extension);
      return s.store.wardenone_config?.allowlist?.includes('trusted.upgrade.example')
        && s.store.wardenone_tracker_learner?.siteControls?.['publisher.example']?.allow?.['tracker.example'];
    }, 'upgraded decisions restored');
    await until(async () => {
      const s = await snapshot(extension);
      return !newest || s.dynamic.user.length > 0 && s.dynamic.firewall.length > 0;
    }, 'upgraded DNR owners');
    if (!newest) await until(async () => {
      const cfg = (await snapshot(extension)).store.wardenone_config;
      return cfg?.stopAnimatedVideoPreviews === true && !Object.prototype.hasOwnProperty.call(cfg, 'stopYouTubeVideoPreviews');
    }, 'legacy config migration');
    report.after = await snapshot(extension);
    const cfg = report.after.store.wardenone_config;
    assert.equal(cfg.autoRejectConsent, false);
    assert.equal(cfg.sendPrivacySignals, true);
    assert.deepEqual(cfg.allowlist, ['trusted.upgrade.example']);
    assert(report.after.store.wardenone_history?.some(event => event.url === 'https://history.upgrade.example/'));
    assert(report.after.store.wardenone_tracker_learner.siteControls['publisher.example'].allow['tracker.example']);
    if (newest) {
      assert.equal(cfg.siteOverrides['news.upgrade.example'].blockTrackers, false);
      assert.equal(report.after.store.wardenone_user_rules.text, '||ads.upgrade.example^');
      assert.equal(report.after.store.wardenone_firewall['news.upgrade.example']['cdn.upgrade.example'].script, 'block');
      assert(report.after.dynamic.user.length > 0 && report.after.dynamic.firewall.length > 0);
      assert.equal(report.after.store.wardenone_tracker_learner.domains['tracker.example'].state, 'learned');
    } else {
      assert.equal(cfg.blockGeolocation, false);
      assert.equal(cfg.stopAnimatedVideoPreviews, true);
      assert.equal(cfg.stopYouTubeVideoPreviews, undefined);
      assert.equal(cfg.retiredProviderKey, undefined);
    }
    report.historyPermissionBefore = await evaluate(extension, "chrome.permissions.contains({permissions:['history']})");
    if (report.historyPermissionBefore) {
      report.historyPermissionRemoved = await evaluate(extension, "chrome.permissions.remove({permissions:['history']})");
      assert.equal(report.historyPermissionRemoved, true);
    }
    report.historyPermissionAfter = await evaluate(extension, "chrome.permissions.contains({permissions:['history']})");
    assert.equal(report.historyPermissionAfter, false);
    const cleaner = await evaluate(extension, `(async()=>{
      const current=await WO_CLEANER.get();
      const config={...current.config,automatic:{...current.config.automatic,enabled:true,frequency:'daily',
        onStartup:false,notify:false,types:{cache:true},sinceMs:0}};
      const saved=await WO_CLEANER.save(config);
      const alarm=await chrome.alarms.get('wardenone-privacy-cleaning');
      return {enabled:saved.config.automatic.enabled,alarm:!!alarm};
    })()`);
    assert(cleaner.enabled && cleaner.alarm, 'scheduled cleanup was not armed');
    report.cleaner = cleaner;
    await stop();
    extension = await start(newManifest.version);
    assert.equal(extension.id, report.extensionId);
    await until(async () => (await snapshot(extension)).alarms.includes('wardenone-privacy-cleaning'), 'cleaner alarm after restart');
    report.restarted = await snapshot(extension);
    assert.equal(report.restarted.store.wardenone_cleaner_settings.automatic.enabled, true);
    assert.equal(report.restarted.store.wardenone_user_rules?.text, report.after.store.wardenone_user_rules?.text);
    assert.deepEqual(report.restarted.store.wardenone_firewall, report.after.store.wardenone_firewall);
    assert.deepEqual(report.restarted.store.wardenone_config.allowlist, report.after.store.wardenone_config.allowlist);
    assert.equal(report.restarted.dynamic.user.length, report.after.dynamic.user.length);
    assert.equal(report.restarted.dynamic.firewall.length, report.after.dynamic.firewall.length);
    assert.equal(fingerprint(options.candidate).sha256, report.candidate.fingerprint);
    report.complete = true;
    console.log('[ok] ' + options.lane + ' saved-profile upgrade and restart in ' + report.browser);
  } finally {
    await stop();
    await sleep(2000);
    cleanupProfile(directory, 'wo-upgrade-');
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  }
}

profile.mustFinish(run, 'browser-saved-profile-upgrade').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

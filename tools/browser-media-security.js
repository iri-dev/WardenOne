/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Local HTTPS origins exercise native DNR frame inheritance and media playback. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const {cleanupProfile} = require('./lib/browser-profile-cleanup.js');
const root = path.resolve(process.env.WARDENONE_EXTENSION_DIR || path.join(__dirname, '..'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Public throwaway credentials for this loopback fixture, never a trusted CA. */
const tls = {
  key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgRv4lgemvmkqG+8qc
03aei+4tXplK2LOMnRGd74w0AGihRANCAASNe/ITDDcygNBJpUa2DcHBsxjlmN9O
Bx/B5isyPQdDlPLlaXOD+Q6DFQSInYdMwWgr0tLBwBN8wSk8D6WDtfaL
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIBmDCCAT+gAwIBAgIUHOo4IVeWZJqfBwD+01ERTzWCg5cwCgYIKoZIzj0EAwIw
ITEfMB0GA1UEAwwWd2FyZGVub25lLXRlc3QuaW52YWxpZDAgFw0yNjEwMjAyMjU3
NTFaGA8yMTI2MDkyNjIyNTc1MVowITEfMB0GA1UEAwwWd2FyZGVub25lLXRlc3Qu
aW52YWxpZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABI178hMMNzKA0EmlRrYN
wcGzGOWY304HH8HmKzI9B0OU8uVpc4P5DoMVBIidh0zBaCvS0sHAE3zBKTwPpYO1
9oujUzBRMB0GA1UdDgQWBBQ9OAlaMi+srHrw3XrisVHpcfTL2TAfBgNVHSMEGDAW
gBQ9OAlaMi+srHrw3XrisVHpcfTL2TAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49
BAMCA0cAMEQCIHzhciLrZznd4ChC0R4xO7NvDLZosQM3YYMJL2UHmycbAiBUtd2i
9XAW1v91X+GzGnf/cTcWk2+JYgSF11Dxy9VsHg==
-----END CERTIFICATE-----`,
};

async function run() {
  const sites = ['www.youtube.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.twitch.tv'];
  /* Public-looking names: Intranet Guard refuses .test hosts embedded by a public site. */
  const child = 'child.wardenone-security.example.net';
  const control = 'control.wardenone-security.example.net';
  const blocked = 'blocked.wardenone-security.example.net';
  const cdn = 'fixture.googlevideo.com';
  const infrastructure = ['github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'accounts.google.com', 'login.live.com'];
  const tenants = ['alice.webflow.io', 'bob.webflow.io', 'analytics.alice.webflow.io', 'analytics.bob.webflow.io', 'alice.netlify.app', 'bob.netlify.app'];
  const hits = [];
  const media = fs.readFileSync(path.join(root, 'spotify-silent-1s.mp4'));
  const server = https.createServer(tls, (request, response) => {
    const host = String(request.headers.host).replace(/:\d+$/, '');
    hits.push(host + request.url);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    if (request.url.startsWith('/media-ok.mp4')) {
      response.setHeader('Content-Type', 'video/mp4');
      response.end(media);
    } else if (request.url.startsWith('/autoplay-fixture')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Delayed playback</title><button id="unrelated-click">Elsewhere</button><video id="intentional-video" muted controls loop '
        + 'style="width:640px;height:360px" src="https://' + cdn + ':' + server.address().port + '/media-ok.mp4"></video>'
        + '<button id="stream-start" aria-controls="intentional-video" onclick="setTimeout(()=>document.querySelector(\'video\').play()'
        + '.then(()=>window.delayedPlay=\'playing\',e=>window.delayedPlay=e.name+\': \'+e.message),1600)">Play stream</button>'
        + '<video id="unrelated-video" muted loop src="https://' + cdn + ':' + server.address().port + '/media-ok.mp4"></video>');
    } else if (request.url.startsWith('/fixture')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Media security fixture</title><video id="player" muted controls loop src="https://'
        + cdn + ':' + server.address().port + '/media-ok.mp4"></video><iframe src="https://'
        + child + ':' + server.address().port + '/child"></iframe><script>window.fixtureReady=true;</script>');
    } else if (request.url.startsWith('/child')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Child fixture</title><p>Child frame</p>');
    } else { response.end('ok'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-media-security-'));
  let cdp;
  try {
    const hosts = sites.concat(child, control, blocked, cdn, infrastructure, tenants);
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required',
        '--host-resolver-rules=' + hosts.map((host) => 'MAP ' + host + ' 127.0.0.1').join(', ')]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, require('../manifest.json').version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = extension.attachedSession;
    const evaluate = async (sessionId, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (session, expression) => {
      for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(100)) {
        if (await evaluate(session, expression).catch(() => false)) return;
      }
      throw new Error('Timed out: ' + expression);
    };
    await evaluate(worker, `applyMediaCompatibilityRules(true).then(()=>chrome.declarativeNetRequest.updateDynamicRules({
      addRules:[{...domainToRule(${JSON.stringify(blocked)},6000001,'security'),priority:1000},
        {...domainToRule(${JSON.stringify(cdn)},6000002,'security'),condition:{requestDomains:[${JSON.stringify(cdn)}],urlFilter:'/denied-media',resourceTypes:SECURITY_RESOURCE_TYPES}}],
      removeRuleIds:[6000001,6000002]
    })).then(()=>true)`);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page);
    await cdp.send('Page.enable', {}, page);
    const probe = async (tabId, frameId, url) => evaluate(worker, `chrome.scripting.executeScript({
      target:{tabId:${tabId},frameIds:[${frameId}]},world:'MAIN',
      func:async (url)=>fetch(url).then(r=>'loaded '+r.status,()=> 'blocked'),args:[${JSON.stringify(url)}]
    }).then(rows=>rows[0].result)`);
    const autoplayUrl = 'https://' + control + ':' + serverPort + '/autoplay-fixture';
    const playResult = 'document.querySelector("video").play().then(()=>"playing",e=>e.name+": "+e.message)';
    const autoplayDenied = 'NotAllowedError: Autoplay blocked by WardenOne';
    const hiddenDenied = 'NotAllowedError: Hidden autoplay blocked by WardenOne';
    const configured = async (patch) => {
      await evaluate(worker, `updateStoredConfig(c=>Object.assign(c,${JSON.stringify(patch)})).then(()=>true)`);
    };
    /* A started engine can still be waiting for its config; until it lands, Block autoplay is off. */
    const autoplayReady = async (blocking = true) => until(page, 'window.__wardenOneReadyVersion'
      + (blocking ? '&&!!window.__WO_CONFIG__&&window.__WO_CONFIG__.blockAutoplay===true' : '')
      + '&&document.readyState==="complete"&&document.querySelector("video").readyState>=2');
    /* No reloads: the guard must already hold on the first document, however late its config lands. */
    await configured({ blockAutoplay: true });
    await cdp.send('Page.navigate', { url: autoplayUrl }, page);
    await autoplayReady();
    assert.equal(await evaluate(page, playResult), autoplayDenied, 'unattended autoplay is blocked on the first navigation');
    await evaluate(page, 'window.dispatchEvent(new MouseEvent("click"));true');
    assert.equal(await evaluate(page, playResult), autoplayDenied, 'synthetic clicks cannot grant playback');
    const clickAutoplayControl = async (id) => {
      const point = await evaluate(page, '(()=>{const r=document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point }, page);
      }
    };
    await clickAutoplayControl('unrelated-click');
    assert.equal(await evaluate(page, playResult), autoplayDenied, 'unrelated trusted clicks cannot grant playback');
    await clickAutoplayControl('stream-start');
    await until(page, 'window.delayedPlay==="playing"');
    const started = await evaluate(page, 'document.querySelector("video").currentTime');
    await until(page, '(()=>{const v=document.querySelector("video");return !v.paused&&v.currentTime!==' + started + '})()');
    await sleep(1600);
    assert.equal(await evaluate(page, playResult), 'playing', 'later stream retries retain trusted user intent');
    assert.equal(await evaluate(page, playResult.replace('document.querySelector("video")', 'document.getElementById("unrelated-video")')), autoplayDenied,
      'starting a stream must not unlock a different video');
    console.log('[ok] player-scoped trusted playback and retries play; unattended, synthetic and unrelated autoplay remain blocked');
    await cdp.send('Page.reload', {}, page);
    await autoplayReady();
    assert.equal(await evaluate(page, playResult), autoplayDenied, 'a new document requires its own interaction');
    await configured({ blockAutoplay: false });
    await until(page, '(' + playResult + ').then(result=>result==="playing")');
    await evaluate(page, 'document.querySelector("video").hidden=true;true');
    assert.equal(await evaluate(page, playResult), hiddenDenied, 'hidden-video protection remains active');
    await configured({ blockAutoplayMedia: false });
    await until(page, '(' + playResult + ').then(result=>result==="playing")');
    await configured({ blockAutoplayMedia: true, mediaShield: false });
    await until(page, '(' + playResult + ').then(result=>result==="playing")');
    await configured({ mediaShield: true });
    await until(page, '(' + playResult + ').then(result=>result===' + JSON.stringify(hiddenDenied) + ')');
    console.log('[ok] media toggles release installed guards without reload; re-enabling hidden-media protection restores blocking');
    await configured({ blockAutoplay: true });
    await cdp.send('Page.reload', {}, page);
    await autoplayReady();
    assert.equal(await evaluate(page, playResult), autoplayDenied, 're-enabled Block autoplay applies to the reloaded page');
    const beforeMasterOff = await evaluate(page, 'performance.timeOrigin');
    const { targetId: popupId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
    const { sessionId: popupSession } = await cdp.send('Target.attachToTarget', { targetId: popupId, flatten: true });
    await cdp.send('Runtime.enable', {}, popupSession);
    await until(popupSession, `document.readyState==='complete'&&document.querySelector('input[data-key="blockAutoplay"]')?.checked===true`);
    await evaluate(popupSession, `(()=>{const input=document.getElementById('enabled');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await until(worker, `chrome.storage.local.get('wardenone_config').then(s=>s.wardenone_config?.enabled===false)`);
    await until(page, 'performance.timeOrigin!==' + beforeMasterOff + '&&document.readyState==="complete"&&!!document.querySelector("video")');
    await autoplayReady(false);
    await evaluate(page, 'document.querySelector("video").hidden=true;true');
    await until(page, '(' + playResult + ').then(result=>result==="playing")');
    await until(worker, 'chrome.declarativeNetRequest.getEnabledRulesets().then(ids=>ids.length===0)');
    await cdp.send('Target.closeTarget', { targetId: popupId });
    await configured({ enabled: true, blockAutoplay: false });
    await until(worker, 'chrome.declarativeNetRequest.getEnabledRulesets().then(ids=>ids.includes("trackers"))');
    console.log('[ok] popup master-off reloads the media page, releases playback guards and disables static blocking');
    for (const site of sites) {
      const url = 'https://' + site + ':' + serverPort + '/fixture';
      await cdp.send('Page.navigate', { url }, page);
      await until(page, 'window.fixtureReady===true&&document.readyState==="complete"');
      const tabId = await evaluate(worker, `chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(url)}).id)`);
      const frames = await evaluate(worker, `chrome.webNavigation.getAllFrames({tabId:${tabId}}).then(frames=>frames.map(frame=>({id:frame.frameId,url:frame.url})))`);
      assert(frames.some((frame) => frame.url.includes(child)), 'a cross-origin child frame loaded');
      for (const frame of frames) {
        assert.equal(await probe(tabId, frame.id, 'https://' + control + ':' + serverPort + '/control'), 'loaded 200');
        for (const hostPath of [blocked + ':' + serverPort + '/denied-host', cdn + ':' + serverPort + '/denied-media']) {
          const before = hits.length;
          assert.equal(await probe(tabId, frame.id, 'https://' + hostPath), 'blocked', site + ' frame ' + frame.id + ' must retain security blocking');
          assert(!hits.slice(before).some((hit) => hit.includes('/denied-')), 'a blocked request must not reach the server');
        }
      }
      await evaluate(page, 'document.getElementById("player").play().then(()=>true)');
      const start = await evaluate(page, 'document.getElementById("player").currentTime');
      await until(page, '(()=>{const v=document.getElementById("player");return !v.paused&&v.readyState>=2&&v.currentTime!==' + start + '})()');
      console.log('[ok] native security blocks in ' + site + ' and child frame; unblocked requests and media playback survive');
      if (site === sites[0]) {
        await evaluate(worker, `chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[806000],addRules:[{
          id:806000,priority:95000,action:{type:'allowAllRequests'},
          condition:{requestDomains:['youtube.com'],resourceTypes:['main_frame','sub_frame']}
        }]}).then(()=>true)`);
        await cdp.send('Page.reload', {}, page);
        await until(page, 'window.fixtureReady===true&&document.readyState==="complete"');
        const deniedUrl = 'https://' + blocked + ':' + serverPort + '/denied-migration';
        assert.equal(await probe(tabId, 0, deniedUrl), 'loaded 200', 'the legacy-rule control must reproduce the bypass');
        await evaluate(worker, '(__mediaCompatibilityRulesEnabled=null,applyMediaCompatibilityRules(true)).then(()=>true)');
        const before = hits.length;
        assert.equal(await probe(tabId, 0, deniedUrl), 'blocked', 'replacing legacy rules repairs an already loaded document');
        assert(!hits.slice(before).some((hit) => hit.includes('/denied-migration')));
        console.log('[ok] legacy frame-wide exemption reproduces the bypass; migration restores blocking without reloading');
        await until(page, 'window.__wardenOneYouTubeReadyVersion===' + JSON.stringify(require('../manifest.json').version));
        const probeAds = `Object.hasOwn(JSON.parse('{"adPlacements":[{}],"playerAds":[{}],"videoDetails":{"videoId":"auth-fixture"}}'),'adPlacements')`;
        await until(page, '!' + probeAds);
        await evaluate(page, `window.__ytFixtureConfigs=[];
          window.addEventListener('message',e=>{
            if(e.source===window&&e.data?.source==='wardenone'&&e.data.kind==='config') __ytFixtureConfigs.push(e.data);
          });true`);
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=false;}).then(()=>true)');
        await until(page, probeAds);
        await until(page, '__ytFixtureConfigs.some(m=>m.overrides.enabled===false&&typeof m.mac==="string")');
        assert.equal(await evaluate(page, `(()=>{
          window.ytInitialPlayerResponse={adPlacements:[{}],playerAds:[{}],streamingData:{formats:[{url:'fixture'}]}};
          window.ytInitialData={playerResponse:{adPlacements:[{}],playerAds:[{}]}};
          return Object.hasOwn(window.ytInitialPlayerResponse,'adPlacements')
            &&Object.hasOwn(window.ytInitialData.playerResponse,'adPlacements')
            &&window.ytInitialPlayerResponse.streamingData.formats[0].url==='fixture';
        })()`), true, 'master-off cold-load bootstrap data must remain intact');
        await evaluate(page, 'window.__ytOldDisable=__ytFixtureConfigs.find(m=>m.overrides.enabled===false&&typeof m.mac==="string");true');
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=true;}).then(()=>true)');
        await until(page, '!' + probeAds);
        await evaluate(page, `new Promise(resolve=>{
          const done=e=>{if(e.source===window&&e.data?.kind==='yt-auth-fixture-done'){
            window.removeEventListener('message',done);resolve(true);
          }};
          window.addEventListener('message',done);
          for(const message of [
            {source:'wardenone-handshake',token:'attacker-picked'},
            {source:'wardenone',kind:'config',token:'attacker-picked',overrides:{enabled:false}},
            {...__ytOldDisable,seq:1000000,mac:'0'.repeat(64)},
            {...__ytOldDisable,mac:undefined},__ytOldDisable
          ]) window.postMessage(message,location.origin);
          window.postMessage({kind:'yt-auth-fixture-done'},location.origin);
        })`);
        assert.equal(await evaluate(page, probeAds), false, 'unsigned, invalid and replayed config cannot disable YouTube pruning');
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=false;}).then(()=>true)');
        await until(page, probeAds);
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=true;}).then(()=>true)');
        await until(page, '!' + probeAds);
        await evaluate(page, 'document.getElementById("player").play().then(()=>true)');
        const resumedAt = await evaluate(page, 'document.getElementById("player").currentTime');
        await until(page, '(()=>{const v=document.getElementById("player");return !v.paused&&v.readyState>=2&&v.currentTime!==' + resumedAt + '})()');
        console.log('[ok] authenticated YouTube toggles, forgery/replay rejection and media playback through the real bridge');
      }
      if (site === 'www.twitch.tv') {
        await until(page, '!!document.getElementById("wo-twitch-adblock-css")');
        const off = 'document.getElementById("wo-twitch-adblock-css").disabled';
        await until(page, '!' + off);
        await evaluate(page, `window.__twitchFixtureConfigs=[];
          window.addEventListener('message',e=>{
            if(e.source===window&&e.data?.source==='wardenone'&&e.data.kind==='config') __twitchFixtureConfigs.push(e.data);
          });true`);
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=false;}).then(()=>true)');
        await until(page, off);
        await until(page, '__twitchFixtureConfigs.some(m=>m.overrides.enabled===false)');
        await evaluate(page, 'window.__oldTwitchOff=__twitchFixtureConfigs.find(m=>m.overrides.enabled===false);true');
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=true;}).then(()=>true)');
        await until(page, '!' + off);
        await evaluate(page, `new Promise(resolve=>{
          window.__WO_CONFIG__={enabled:false,twitchAdBlock:false,__configReady:true};
          document.dispatchEvent(new CustomEvent('wo-config-change',{detail:{config:window.__WO_CONFIG__}}));
          const done=e=>{if(e.source===window&&e.data?.kind==='twitch-auth-fixture-done'){
            window.removeEventListener('message',done);resolve(true);
          }};
          window.addEventListener('message',done);
          for(const message of [
            {source:'wardenone-handshake',token:'attacker-picked'},
            {source:'wardenone',kind:'config',token:'attacker-picked',overrides:{enabled:false}},
            {...__oldTwitchOff,seq:1000000,mac:'0'.repeat(64)}, {...__oldTwitchOff,mac:undefined}, __oldTwitchOff
          ]) window.postMessage(message,location.origin);
          window.postMessage({kind:'twitch-auth-fixture-done'},location.origin);
        })`);
        assert.equal(await evaluate(page, off), false, 'Twitch rejects page-controlled protection changes');
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=false;}).then(()=>true)');
        await until(page, off);
        await evaluate(worker, 'updateStoredConfig(cfg=>{cfg.enabled=true;}).then(()=>true)');
        await until(page, '!' + off);
        await evaluate(page, 'document.getElementById("player").play().then(()=>true)');
        const resumed = await evaluate(page, 'document.getElementById("player").currentTime');
        await until(page, 'document.getElementById("player").currentTime!==' + resumed);
        console.log('[ok] authenticated Twitch toggles reject forgery, replay and page globals while media plays');
      }
    }
    const githubUrl = 'https://github.com:' + serverPort + '/fixture';
    await cdp.send('Page.navigate', { url: githubUrl }, page);
    await until(page, 'window.fixtureReady===true&&document.readyState==="complete"');
    const githubTab = await evaluate(worker, `chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(githubUrl)}).id)`);
    for (const host of infrastructure.slice(1)) {
      const badUrl = 'https://' + host + ':' + serverPort + '/denied-infrastructure/payload.js';
      const knownUrl = 'https://' + host + ':' + serverPort + '/denied-confirmed/payload.js';
      const goodUrl = 'https://' + host + ':' + serverPort + '/ordinary-resource';
      await evaluate(worker, `(()=>{
        const candidates=parseList(${JSON.stringify(host)});
        if(!candidates.includes(${JSON.stringify(host)})) throw new Error('Security-feed host was discarded');
        const option=parseNetworkRules(${JSON.stringify('|' + badUrl + '|$script,xmlhttprequest')},0,1);
        if(option.length!==1) throw new Error('Security-feed path was discarded');
        return chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[6000004,6000005,6000006],addRules:[
          finalizeOptionRule(option[0],6000004,'security'),
          {id:6000005,priority:2000,action:{type:'block'},condition:{urlFilter:${JSON.stringify('|' + knownUrl + '|')},resourceTypes:['xmlhttprequest']}},
          {id:6000006,priority:1000,action:{type:'block'},condition:{urlFilter:${JSON.stringify('|' + goodUrl + '|')},resourceTypes:['xmlhttprequest']}}
        ]}).then(()=>true);
      })()`);
      if (host === infrastructure[1]) {
        await evaluate(worker, `chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[6000007],addRules:[{
          id:6000007,priority:3000,action:{type:'allow'},condition:{requestDomains:[${JSON.stringify(host)}],resourceTypes:['xmlhttprequest']}
        }]}).then(()=>true)`);
        const before = hits.length;
        assert.equal(await probe(githubTab, 0, badUrl), 'loaded 200', 'legacy infrastructure allow reproduces the tie bypass');
        assert(hits.slice(before).some(hit => hit.includes('/denied-infrastructure/')));
        await evaluate(worker, 'chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[6000007]}).then(()=>true)');
      }
      for (const url of [badUrl, knownUrl]) {
        const before = hits.length;
        assert.equal(await probe(githubTab, 0, url), 'blocked', 'security remains authoritative on ' + host);
        assert(!hits.slice(before).some(hit => hit.includes('/denied-')), 'blocked infrastructure request reached the server');
      }
      assert.equal(await probe(githubTab, 0, goodUrl), 'loaded 200', 'ad-list compatibility remains effective on ' + host);
    }
    console.log('[ok] shared infrastructure retains threat blocking and ordinary-resource compatibility in ' + browser.Browser);
    await evaluate(worker, `(async()=>{
      const now=Date.now(), proposal={state:'proposed',firstSeen:now,lastSeen:now,hits:6,sites:3,sessions:2,proposedAt:now};
      await chrome.storage.local.set({[TRACKER_LEARNER_KEY]:{version:2,salt:'a'.repeat(32),domains:{
        'webflow.io':{...proposal,state:'learned',approvedAt:now},
        'alice.webflow.io':{...proposal},'bob.webflow.io':{...proposal}
      },siteControls:{}}});
      await writeDynamicRules({removeRuleIds:[TRACKER_RULE_BASE],addRules:[{
        id:TRACKER_RULE_BASE,priority:1800,action:{type:'block'},
        condition:{requestDomains:['webflow.io'],domainType:'thirdParty',resourceTypes:TRACKER_RESOURCE_TYPES}
      }]});
      __initTrackerLearner=null;
      await loadTrackerLearner();await applyTrackerLearnerRules();return true;
    })()`);
    for (const host of tenants.slice(0, 4)) {
      assert.equal(await probe(githubTab, 0, 'https://' + host + ':' + serverPort + '/tenant-scope'), 'loaded 200', 'an unapproved proposal or withdrawn legacy apex must not block');
    }
    const decision = await evaluate(worker, 'decideTrackerProposal("analytics.alice.webflow.io","block")');
    assert.equal(decision.ok, true);
    assert.equal(decision.domain, 'alice.webflow.io');
    for (const host of ['alice.webflow.io', 'analytics.alice.webflow.io']) {
      const before = hits.length;
      assert.equal(await probe(githubTab, 0, 'https://' + host + ':' + serverPort + '/denied-tenant'), 'blocked');
      assert(!hits.slice(before).some(hit => hit.includes('/denied-tenant')));
    }
    for (const host of ['bob.webflow.io', 'analytics.bob.webflow.io']) {
      assert.equal(await probe(githubTab, 0, 'https://' + host + ':' + serverPort + '/tenant-scope'), 'loaded 200');
    }
    const alicePage = 'https://alice.webflow.io:' + serverPort + '/fixture';
    const mode = await evaluate(worker, `setTrackerLearnerSiteMode(${JSON.stringify(alicePage)},'alice.netlify.app','block')`);
    assert.equal(mode.ok, true);
    for (const first of ['alice.webflow.io', 'bob.webflow.io']) {
      await cdp.send('Page.navigate', { url: 'https://' + first + ':' + serverPort + '/fixture' }, page);
      await until(page, 'window.fixtureReady===true&&document.readyState==="complete"');
      assert.equal(await probe(githubTab, 0, 'https://alice.netlify.app:' + serverPort + '/tenant-control'),
        first === 'alice.webflow.io' ? 'blocked' : 'loaded 200', 'a per-site decision must retain its initiator tenant');
      assert.equal(await probe(githubTab, 0, 'https://bob.netlify.app:' + serverPort + '/tenant-control'), 'loaded 200');
    }
    console.log('[ok] tracker approval, legacy scope removal and per-site controls isolate hosted tenants in ' + browser.Browser);
    const shutdownUrl = 'https://' + control + ':' + serverPort + '/shutdown-fixture';
    const shutdown = await evaluate(worker, `(async()=>{
      const id=USER_RULE_BASE+USER_RULE_MAX-1;
      await writeDynamicRules({removeRuleIds:[id],addRules:[{
        id,priority:3000,action:{type:'block'},condition:{urlFilter:${JSON.stringify('|' + shutdownUrl + '|')},resourceTypes:['xmlhttprequest']}
      }]});
      const dnr=chrome.declarativeNetRequest,original=dnr.updateDynamicRules;
      let failures=0;
      const request=()=>chrome.scripting.executeScript({target:{tabId:${githubTab}},world:'MAIN',
        func:async url=>fetch(url).then(r=>'loaded '+r.status,()=> 'blocked'),args:[${JSON.stringify(shutdownUrl)}]
      }).then(rows=>rows[0].result);
      try{
        dnr.updateDynamicRules=function(change){
          if(!failures&&(change.removeRuleIds||[]).includes(id)){
            failures++;return Promise.reject(new Error('Injected shutdown removal failure'));
          }
          return original.call(dnr,change);
        };
        const first=await refreshBlocklistRuleset({enabled:false});
        const result={failures,first,firstKey:__blocklistRulesetStateKey,firstError:__blocklistRulesetError,firstRequest:await request()};
        await refreshBlocklistRuleset({enabled:false});
        result.secondKey=__blocklistRulesetStateKey;result.secondError=__blocklistRulesetError;
        result.secondRequest=await request();result.staticDisabled=(await dnr.getEnabledRulesets()).length===0;
        return result;
      }finally{
        dnr.updateDynamicRules=original;
        await refreshBlocklistRuleset({enabled:true});
      }
    })()`);
    assert.equal(shutdown.failures, 1);
    assert.equal(shutdown.first, false);
    assert.equal(shutdown.firstKey, '');
    assert.match(shutdown.firstError, /Injected shutdown removal failure/);
    assert.equal(shutdown.firstRequest, 'blocked');
    assert(shutdown.secondKey.startsWith('0|'));
    assert.equal(shutdown.secondError, '');
    assert.equal(shutdown.secondRequest, 'loaded 200');
    assert.equal(shutdown.staticDisabled, true);
    console.log('[ok] a rejected native shutdown remains visible and retries successfully in ' + browser.Browser);
    console.log('[ok] media compatibility security boundary in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise((resolve) => server.close(resolve));
    cleanupProfile(dir, 'wo-media-security-');
  }
}
module.exports = { tls };
if (require.main === module) profile.mustFinish(run, 'browser-media-security')
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

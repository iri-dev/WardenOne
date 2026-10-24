/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

/* AUD26-002/003: cookie label boundaries and native ICE diagnostic choices.
   The test uses synthetic cookies, a local server and fake media permission. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HOST = 'privacy.wardenone-audit.net';

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-audit-mediums-'));
  const port = await profile.freePort();
  let cdp, server;
  try {
    server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Local WebRTC diagnostic regression</title><p>No external ICE servers.</p>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://' + HOST + ':' + server.address().port;
    const tenantOrigins = ['alice.webflow.io', 'bob.webflow.io'].map((host) => 'http://' + host + ':' + server.address().port);
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir, [
      '--host-resolver-rules=' + [HOST, 'alice.webflow.io', 'bob.webflow.io'].map((host) => 'MAP ' + host + ' 127.0.0.1').join(', '),
      '--unsafely-treat-insecure-origin-as-secure=' + [origin, ...tenantOrigins].join(','),
      '--disable-features=msEdgeShoppingUI,msImplicitSignin,msEdgeStartupBoost,WebRtcHideLocalIpsWithMdns',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    ]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (session, expression, contextId) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,
        userGesture: true, ...(contextId ? { contextId } : {}) }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const open = async (url) => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      return sessionId;
    };
    const until = async (session, expression) => {
      for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(100)) {
        if (await evaluate(session, expression)) return;
      }
      throw new Error('Timed out: ' + expression);
    };
    const worker = extension.attachedSession;
    const sweep = await evaluate(worker, `(async()=>{
      const kept=['notadnxs.net','notdoubleclick.com','returndoubleclick.net','sync.notadnxs.net','shop-audit.net'];
      for(const host of kept.concat(['adnxs.net','sync.doubleclick.net'])){
        for(const name of ['uid','c']) await chrome.cookies.set({url:'https://'+host+'/',name,value:'synthetic-account-state',secure:true});
      }
      const result=await cleanConsentAndTrackingCookies();
      const states=[];
      for(const host of kept.concat(['adnxs.net','sync.doubleclick.net'])){
        for(const name of ['uid','c']) states.push({host,name,exists:!!await chrome.cookies.get({url:'https://'+host+'/',name})});
      }
      return {result,states};
    })()`);
    assert.equal(sweep.result.removed, 4);
    assert(sweep.states.every((c) => c.exists === !['adnxs.net', 'sync.doubleclick.net'].includes(c.host)));
    console.log('[ok] cookie sweep keeps lookalike uid/c state and removes exact/subdomain vendor cookies');

    const testPage = await open(`chrome-extension://${extension.id}/privacy-test.html`);
    await until(testPage, "typeof buildChecks === 'function' && typeof render === 'function'");
    const web = await open(origin + '/start');
    const cases = [
      ['lookup only', true, false, {}, 'design'],
      ['hardening without dependency', false, true, {}, 'design'],
      ['both off', false, false, {}, 'design'],
      ['native hardening', true, true, {}, 'protected'],
      ['master off', true, true, { enabled: false }, 'design'],
      ['site paused', true, true, { allowlistUntil: { [HOST]: Date.now() + 120000 } }, 'design'],
      ['native site exception', true, true, { siteOverrides: { [HOST]: { blockSuspiciousWebRTC: false } } }, 'design'],
      ['dependency site exception', true, true, { siteOverrides: { [HOST]: { blockWebRTCLeak: false } } }, 'design'],
      ['site master exception', true, true, { siteOverrides: { [HOST]: { enabled: false } } }, 'design'],
      ['platform exception keeps tenant protected', true, true, { siteOverrides: { 'webflow.io': { blockSuspiciousWebRTC: false } } }, 'protected', tenantOrigins[0]],
      ['tenant exception applies to its own site', true, true, { siteOverrides: { 'alice.webflow.io': { blockSuspiciousWebRTC: false } } }, 'design', tenantOrigins[0]],
      ['tenant exception keeps sibling protected', true, true, { siteOverrides: { 'alice.webflow.io': { blockSuspiciousWebRTC: false } } }, 'protected', tenantOrigins[1]],
    ];
    for (const [label, blockWebRTCLeak, blockSuspiciousWebRTC, choices, expected, testOrigin = origin] of cases) {
      const config = { enabled: true, blockWebRTCLeak, blockSuspiciousWebRTC, allowlist: [], allowlistUntil: {},
        siteOverrides: {}, antiFingerprint: false, antiFingerprintNoise: false, mediaShield: false, blockCameraMic: false,
        capabilityGuard: false, deviceAccessGuard: false, ...choices };
      await evaluate(worker, `updateStoredConfig(cfg=>Object.assign(cfg,${JSON.stringify(config)})).then(()=>true)`);
      await until(worker, `sharedContentConfigSnapshot().then(s=>
        ['enabled','blockWebRTCLeak','blockSuspiciousWebRTC','siteOverrides','allowlistUntil'].every(k=>
          JSON.stringify(s.overrides[k])===JSON.stringify((${JSON.stringify(config)})[k])))`);
      const url = testOrigin + '/' + label.replace(/ /g, '-');
      await cdp.send('Page.navigate', { url }, web);
      await until(web, `location.href===${JSON.stringify(url)}&&document.readyState==='complete'`);
      const tabId = await evaluate(worker, `chrome.tabs.query({}).then(ts=>ts.find(t=>t.url===${JSON.stringify(url)})?.id)`);
      assert(Number.isInteger(tabId));
      if (tenantOrigins.includes(testOrigin)) {
        for (const world of ['MAIN', 'ISOLATED']) {
          const match = await evaluate(worker, `chrome.scripting.executeScript({target:{tabId:${tabId}},world:${JSON.stringify(world)},
            func:()=>({apex:hostMatchesSite(location.hostname,'webflow.io'),own:hostMatchesSite(location.hostname,'alice.webflow.io')})}).then(r=>r[0].result)`);
          assert.equal(match.apex, false, world + ': platform apex does not exempt tenants');
          assert.equal(match.own, testOrigin === tenantOrigins[0], world + ': only the named tenant matches');
        }
      }
      await until(worker, `tabEngineStatus(${tabId}).then(s=>s&&s.configured)`);
      const hardeningOn = expected === 'protected';
      await until(web, `!!window.__WO_CONFIG__ && window.__WO_CONFIG__.blockSuspiciousWebRTC===${hardeningOn}`);
      /* Settings that arrive after the 1.5 s start fallback miss the start-only WebRTC guard;
         reload so the engine starts configured. A guard that never installs still fails. */
      const rtcGuarded = "(()=>{const pc=new RTCPeerConnection();const own=!!Object.getOwnPropertyDescriptor(pc,'onicecandidate');pc.close();return own})()";
      for (let reloads = 0; hardeningOn && !(await evaluate(web, rtcGuarded)); reloads++) {
        assert(reloads < 3, label + ': the WebRTC guard never installed on the page');
        await evaluate(web, 'window.__woStaleDocument=true');
        await cdp.send('Page.navigate', { url }, web);
        await until(web, `!window.__woStaleDocument&&location.href===${JSON.stringify(url)}&&document.readyState==='complete'`);
        await until(worker, `tabEngineStatus(${tabId}).then(s=>s&&s.configured)`);
        await until(web, '!!window.__WO_CONFIG__ && window.__WO_CONFIG__.blockSuspiciousWebRTC===true');
      }
      const { frameTree } = await cdp.send('Page.getFrameTree', {}, web);
      const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id, worldName: 'native-rtc-permission',
      }, web);
      await evaluate(web, `navigator.mediaDevices.getUserMedia({video:true})
        .then(s=>{s.getTracks().forEach(t=>t.stop());return true})`, executionContextId);
      const result = await evaluate(testPage, `(async()=>{
        const data=await chrome.runtime.sendMessage({kind:'privacy-test-run',tabId:${tabId}});
        if(!data.ok)throw new Error(data.error);
        const rows=buildChecks(data);render(rows,data);
        return {settings:data.settings,bare:data.bare?.webrtcLocalIps?.ips.length,
          shielded:data.shielded?.webrtcLocalIps?.ips.length,
          row:rows.find(r=>r.name==='Local network addresses (WebRTC)'),
          lookup:rows.find(r=>r.name==='IP lookup services')};
      })()`);
      assert(result.bare > 0, label + ': browser must expose native host candidates; mDNS cannot hide the regression');
      assert.equal(result.row.verdict, expected, label + ': ' + JSON.stringify(result));
      assert.equal(result.lookup.verdict, 'untested');
      if (expected === 'design') assert(result.shielded > 0, label + ': native addresses remain available by choice');
      else assert.equal(result.shielded, 0, label + ': native hardening changes the measured result');
      console.log('[ok] native ICE diagnostic: ' + label + ' -> ' + expected);
    }
    console.log('[ok] Medium browser regressions in ' + browser.Browser + '; local ICE only, no STUN server');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (server) await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-audit-mediums-/.test(path.basename(resolved))) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
profile.mustFinish(run, 'browser-audit-mediums').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

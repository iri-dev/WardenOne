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
const root = path.resolve(__dirname, '..');
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
  const child = 'child.wardenone-security.test';
  const control = 'control.wardenone-security.test';
  const blocked = 'blocked.wardenone-security.test';
  const cdn = 'fixture.googlevideo.com';
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
    const hosts = sites.concat(child, control, blocked, cdn);
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
      }
    }
    console.log('[ok] media compatibility security boundary in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-media-security-')) throw new Error('Unexpected temporary profile');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
profile.mustFinish(run, 'browser-media-security').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

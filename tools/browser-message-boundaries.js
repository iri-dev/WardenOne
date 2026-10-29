/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const { fingerprint } = require('./lib/privacy-baseline.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  assert(['browser', 'extension', 'out'].includes(key) && process.argv[i + 1]);
  options[key] = path.resolve(process.argv[i + 1]);
}
const root = options.extension || path.resolve(__dirname, '..');
async function run() {
  const identity = options.extension ? fingerprint(root).sha256 : null;
  const topHost = 'top.warden-boundary.example.com', childHost = 'frame.warden-boundary.example.com';
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end('<!doctype html><title>Boundary fixture</title><main id="ready">Ready</main>' +
      (req.url === '/top' ? `<iframe src="http://${childHost}:${server.address().port}/child"></iframe>` : ''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://${topHost}:${server.address().port}`;
  const port = await profile.freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-message-boundaries-'));
  let cdp;
  const results = [], observations = [];
  try {
    const browser = await profile.launch(options.browser || profile.edgePath(), 'on', root, port, dir,
      [`--host-resolver-rules=MAP ${topHost} 127.0.0.1,MAP ${childHost} 127.0.0.1,MAP * ~NOTFOUND`]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (expression, session = extension.attachedSession) => {
      const out = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      if (out.exceptionDetails) throw Error(JSON.stringify(out.exceptionDetails));
      return out.result.value;
    };
    await evaluate(`(async()=>{
      await updateStoredConfig(c=>{c.dnsRebindGuard=false;c.autoUpdateLists=false;});
      globalThis.__boundarySenders=[];globalThis.__boundaryLearned=[];
      learnDomain=(...a)=>__boundaryLearned.push(a);
      chrome.runtime.onMessage.addListener((m,s)=>{if(m&&m.kind==='content-config-get')__boundarySenders.push(s);});
    })()`);
    const tab = await evaluate(`chrome.tabs.create({url:${JSON.stringify(origin + '/top')}})`);
    let frames;
    for (let i = 0; i < 60; i++) {
      frames = await evaluate(`chrome.webNavigation.getAllFrames({tabId:${tab.id}})`);
      if (frames?.length === 2 && frames.every(f => f.url.startsWith('http:'))) break;
      await sleep(100);
    }
    assert.equal(frames.length, 2);
    const child = frames.find(f => f.frameId !== 0);
    const send = async (message, frameId = 0) => {
      const response = await evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id},frameIds:[${frameId}]},world:'ISOLATED',
        func:async encoded=>{try{return await chrome.runtime.sendMessage(JSON.parse(encoded));}catch(e){return {transportError:String(e.message)};}},
        args:[${JSON.stringify(JSON.stringify(message))}]}).then(r=>r[0].result)`);
      return response;
    };
    const cfg = await send({ kind: 'content-config-get', need: ['engine'] });
    assert(cfg && !cfg.error && !JSON.stringify(cfg).includes('apiKey'));
    observations.push(...await evaluate('__boundarySenders'));
    assert(observations.some(s => s.tab?.id === tab.id && s.id === extension.id && s.frameId === 0 && s.documentId && s.origin === origin));
    results.push('native isolated sender identity and projected configuration');
    const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
    const allowRegion = source.slice(source.indexOf('const TAB_CONTEXT_ALLOWED_MESSAGES'), source.indexOf('const TAB_CONTEXT_RATE_LIMITS'));
    const allowed = new Set([...allowRegion.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]));
    const privateKinds = [...new Set([...source.matchAll(/msg\.kind === '([a-z0-9-]+)'/g)].map(m => m[1]))]
      .filter(k => !allowed.has(k) && k !== 'string' && k !== 'clear');
    for (const kind of privateKinds) {
      const reply = await send({ kind });
      assert.equal(reply?.ok, false, kind); assert.match(reply.error, /Not allowed/);
    }
    results.push(`${privateKinds.length} privileged kinds rejected from native content context`);
    for (const value of [null, [], { kind: ['rg-block'] }, { kind: 'rg-block', detail: 'x'.repeat(100000) },
      JSON.parse('{"kind":"rg-block","detail":{"__proto__":{"polluted":true}}}')]) {
      const reply = await send(value);
      if (value === null) assert.match(reply?.transportError || reply?.error || '', /Invalid|invalid/);
      else { assert.equal(reply?.ok, false, JSON.stringify({ kind: value.kind, bytes: JSON.stringify(value).length, reply })); assert.match(reply.error, /Invalid message/); }
    }
    for (let i = 0; i < 5; i++) await send({ kind: 'rg-block', type: 'detected_grabber_domain', detail: { host: topHost } });
    assert.deepEqual(await evaluate('__boundaryLearned'), []);
    results.push('malformed payloads and repeated page claims cannot authorize learning');
    const cookie = { kind: 'set-site-permission', key: 'cookies', setting: 'allow', url: origin };
    const denied = await send(cookie, child.frameId);
    assert.equal(denied.ok, false); assert.match(denied.error, /Not allowed/);
    const accepted = await send(cookie);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    results.push('top-frame cookie compatibility control works; foreign child cannot change it');
    const popup = await evaluate(`chrome.tabs.create({url:chrome.runtime.getURL('popup.html')})`);
    let target;
    for (let i = 0; i < 50; i++) {
      const listing = await cdp.send('Target.getTargets');
      target = listing.targetInfos.find(t => t.type === 'page' && t.url === `chrome-extension://${extension.id}/popup.html`);
      if (target) break; await sleep(100);
    }
    assert(target && popup.id);
    const { sessionId: ui } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    for (let i = 0; i < 60; i++) {
      if (await evaluate("typeof chrome!=='undefined' && !!chrome.runtime?.sendMessage && document.readyState==='complete'", ui)) break;
      await sleep(100);
    }
    const health = await evaluate(`chrome.runtime.sendMessage({kind:'protection-health',tabId:${tab.id}})`, ui);
    assert(health && !/Not allowed|Unknown message/.test(health.error || ''));
    results.push('private popup still reads protection health');
    const warUrl = `chrome-extension://${extension.id}/ip-logger-warning.html`;
    const { targetId: warTarget } = await cdp.send('Target.createTarget', { url: warUrl });
    const { sessionId: war } = await cdp.send('Target.attachToTarget', { targetId: warTarget, flatten: true });
    for (let i = 0; i < 60; i++) {
      if (await evaluate("typeof chrome!=='undefined' && !!chrome.runtime?.sendMessage && document.readyState==='complete'", war)) break;
      await sleep(100);
    }
    for (const kind of ['protection-health', 'content-config-get', 'clean-browser', 'firewall-set']) {
      const reply = await evaluate(`chrome.runtime.sendMessage({kind:${JSON.stringify(kind)}})`, war);
      assert.equal(reply.ok, false); assert.match(reply.error, /Not allowed/);
    }
    results.push('web-accessible warning page cannot read config or reach private actions');
    const probeUrl = `http://${childHost}:${server.address().port}/priority-probe`;
    const probe = () => evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id},frameIds:[0]},world:'ISOLATED',
      func:async url=>{try{return (await fetch(url,{cache:'no-store'})).ok;}catch(_){return false;}},args:[${JSON.stringify(probeUrl)}]}).then(r=>r[0].result)`);
    assert.equal(await probe(), true, 'priority fixture starts reachable');
    for (const [cells, expected] of [[{ all: 'block', xhr: 'allow' }, true], [{ all: 'allow', xhr: 'block' }, false]]) {
      const matrix = { [topHost]: { [childHost]: cells } };
      await evaluate(`(async()=>{const rules=firewallRulesFrom(${JSON.stringify(matrix)}).map((r,i)=>({...r,id:20000000+i}));
        await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[20000000,20000001],addRules:rules});})()`);
      assert.equal(await probe(), expected, JSON.stringify(cells));
    }
    await evaluate('chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[20000000,20000001]})');
    assert.equal(await probe(), true, 'removing the test rules restores the request');
    results.push('native DNR honors specific XHR allow/block over the competing All decision');
    await evaluate('ensureWardenOffscreenDocument()');
    let audioTarget;
    for (let i = 0; i < 50; i++) {
      audioTarget = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${extension.id}/offscreen.html`);
      if (audioTarget) break; await sleep(100);
    }
    assert(audioTarget);
    const { sessionId: audio } = await cdp.send('Target.attachToTarget', { targetId: audioTarget.targetId, flatten: true });
    await evaluate(`globalThis.__sounds=[];globalThis.__audioSenders=[];playTone=async(...args)=>{__sounds.push(args);return true;};
      chrome.runtime.onMessage.addListener((m,s)=>{if(m?.target==='wardenone-offscreen')__audioSenders.push(s);});`, audio);
    const sound = { target: 'wardenone-offscreen', type: 'play-notification-sound', sound: 'block', volume: 0.5 };
    await send(sound);
    await evaluate(`chrome.runtime.sendMessage(${JSON.stringify(sound)})`, ui);
    assert.equal((await evaluate('__sounds', audio)).length, 0);
    const playback = await evaluate(`chrome.runtime.sendMessage(${JSON.stringify(sound)})`);
    const audioSenders = await evaluate('__audioSenders', audio);
    observations.push(...audioSenders);
    assert.equal(playback?.ok, true, JSON.stringify({ playback, audioSenders }));
    assert.equal((await evaluate('__sounds', audio)).length, 1);
    results.push('offscreen audio accepts the worker and rejects page/private UI direct requests');
    const report = { date: new Date().toISOString(), browser: browser.Browser, extensionFingerprint: identity,
      results, senderObservations: observations.map(s => ({ id: s.id, url: s.url, origin: s.origin, frameId: s.frameId,
        documentId: s.documentId, tabId: s.tab?.id })) };
    if (options.out) { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve));
    await sleep(2000);
    cleanupProfile(dir, 'wo-message-boundaries-');
  }
}
profile.mustFinish(run, 'browser-message-boundaries').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

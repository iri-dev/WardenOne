/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-link-check-'));
  const port = await profile.freePort();
  let cdp;
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.end('<!doctype html><title>Source fixture</title><h1>Source page stays here</h1><a id="link" href="https://nfsu2.xyz/?token=TARGET_SECRET#PRIVATE">Check this destination</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP source.wardenone-audit.net 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, require('../manifest.json').version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = extension.attachedSession;
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (session, expression, timeout = 15000) => {
      for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(75)) {
        if (await evaluate(session, expression).catch(() => false)) return;
      }
      const state = await evaluate(session, 'document.body?.innerText').catch(() => 'No readable page');
      throw Error('Timed out: ' + expression + '\n' + state);
    };
    const attachReport = async (exclude = []) => {
      for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(75)) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        const target = targetInfos.find(item => item.url.startsWith('chrome-extension://' + extension.id + '/link-check.html?id=') && !exclude.includes(item.targetId));
        if (target) {
          const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
          await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.enable', {}, sessionId);
          return { ...target, sessionId };
        }
      }
      throw Error('No result tab opened');
    };
    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:false,showToasts:false,silentMode:true})).then(()=>true)');
    const url = 'http://source.wardenone-audit.net:' + server.address().port + '/?token=SOURCE_SECRET';
    const { targetId: sourceTarget } = await cdp.send('Target.createTarget', { url });
    const { sessionId: sourcePage } = await cdp.send('Target.attachToTarget', { targetId: sourceTarget, flatten: true });
    await cdp.send('Runtime.enable', {}, sourcePage);
    await until(sourcePage, 'document.readyState==="complete"&&!!document.getElementById("link")');
    const tab = await evaluate(worker, `chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===${JSON.stringify(url)}))`);
    await evaluate(worker, `var linkCheckOriginals={urlReputationConfig,urlReputationLookupUrl,lookupDomainAge};
      urlReputationConfig=async()=>({enabled:true,cfg:{enabled:true}});
      globalThis.linkCheckResolvers=[];
      urlReputationLookupUrl=async (url,options)=>new Promise(resolve=>{
        options.onStart?.(['Fixture reputation','Unavailable fixture']);
        options.onResult?.({provider:'Fixture reputation',ok:true,hit:false},0);
        globalThis.linkCheckResolvers.push({url,resolve})});
      lookupDomainAge=async()=>({ok:true,ageDays:18,created:'2026-10-18'});
      void runWardenLinkCheck({linkUrl:'https://nfsu2.xyz/?token=TARGET_SECRET#PRIVATE'},${JSON.stringify(tab)});true`);
    const view = await attachReport();
    await until(view.sessionId, 'document.getElementById("retry")?.disabled===true&&document.getElementById("addresses")?.textContent.includes("nfsu2.xyz")');
    await until(worker, 'globalThis.linkCheckResolvers.length>0');
    await until(view.sessionId, 'document.getElementById("checks").textContent.includes("Fixture reputation")&&document.getElementById("checks").textContent.includes("Waiting for this provider")');
    await sleep(12500);
    assert(await evaluate(view.sessionId, 'document.getElementById("retry").disabled&&document.getElementById("checks").textContent.includes("Waiting for this provider")'), 'a slow provider can finish after the old twelve-second cutoff');
    await evaluate(worker, `for(const pending of linkCheckResolvers.splice(0))pending.resolve({results:[{provider:'Fixture reputation',ok:true,hit:false},{provider:'Unavailable fixture',ok:false}]});true`);
    await until(view.sessionId, 'document.getElementById("retry")?.disabled===false');
    const text = await evaluate(view.sessionId, 'document.body.innerText');
    assert(text.includes('nfsu2.xyz') && text.includes('source.wardenone-audit.net') && text.includes('Source fixture'));
    assert(text.includes('18 days ago') && text.includes('Unavailable fixture') && text.includes('could not return a verdict'), text);
    assert(!text.includes('TARGET_SECRET') && !text.includes('SOURCE_SECRET') && !text.includes('#PRIVATE'));
    assert.equal(await evaluate(sourcePage, 'document.querySelector("h1").textContent'), 'Source page stays here');
    const click = async id => {
      await cdp.send('Page.bringToFront', {}, view.sessionId);
      await evaluate(view.sessionId, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
      const point = await evaluate(view.sessionId, `(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, view.sessionId);
    };
    await evaluate(worker, `urlReputationLookupUrl=async()=>({results:[{provider:'Retried fixture',ok:true,hit:false}]});true`);
    await click('retry');
    await until(view.sessionId, 'document.getElementById("checks").textContent.includes("Retried fixture")&&document.getElementById("retry").disabled===false');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, view.sessionId);
    fs.writeFileSync(path.join(root, '.link-check-result.png'), Buffer.from(data, 'base64'));
    console.log('[ok] live provider progress survives the old cutoff and an early caution; contextual results, retry, source preservation and redaction');
    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,openPhish:true})).then(()=>true)');
    await evaluate(worker, `urlReputationConfig=linkCheckOriginals.urlReputationConfig;urlReputationLookupUrl=linkCheckOriginals.urlReputationLookupUrl;lookupDomainAge=linkCheckOriginals.lookupDomainAge;
      globalThis.linkCheckDiagnostics=[];
      for(const [name,original] of Object.entries(linkCheckOriginals))globalThis[name]=async function(...args){
        const started=Date.now();try{const result=await original(...args);linkCheckDiagnostics.push({name,elapsed:Date.now()-started,ok:result?.ok,enabled:result?.enabled,status:result?.status});return result}
        catch(error){linkCheckDiagnostics.push({name,elapsed:Date.now()-started,error:String(error)});throw error}
      }
      void runWardenLinkCheck({linkUrl:'https://nfsu2.xyz/'},${JSON.stringify(tab)});true`);
    const real = await attachReport([view.targetId]);
    await until(real.sessionId, 'document.getElementById("addresses")?.textContent.includes("nfsu2.xyz")&&document.getElementById("retry")?.disabled===false', 35000);
    const result = await evaluate(real.sessionId, '({summary:document.getElementById("verdict").textContent,checks:Array.from(document.querySelectorAll("#checks h3")).map(item=>item.textContent)})');
    assert(result.checks.length > 0);
    console.log('[ok] nfsu2.xyz real check returns a visible, completed result: ' + JSON.stringify(result));
    console.log('[info] live lookup diagnostics: ' + JSON.stringify(await evaluate(worker, 'linkCheckDiagnostics')));
    assert(!(await cdp.send('Target.getTargets')).targetInfos.some(item => /^https?:\/\/nfsu2\.xyz/.test(item.url)), 'the destination is never opened');
    const actual = await cdp.send('Page.captureScreenshot', { format: 'png' }, real.sessionId);
    fs.writeFileSync(path.join(root, '.link-check-nfsu2-real.png'), Buffer.from(actual.data, 'base64'));
    await cdp.send('Target.closeTarget', { targetId: sourceTarget });
    await click('back');
    await until(view.sessionId, 'document.getElementById("status").textContent.includes("no longer available")');
    await evaluate(worker, 'manualLinkEraseReports();true');
    await click('retry');
    await until(view.sessionId, 'document.getElementById("scope").textContent.includes("interrupted")');
    assert(await evaluate(view.sessionId, 'document.getElementById("copy").disabled'), 'an interrupted report cannot copy a stale verdict');
    console.log('[ok] closed source tabs and interrupted/expired reports have explicit outcomes');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve));
    cleanupProfile(dir, 'wo-link-check-');
  }
}
if (require.main === module) profile.mustFinish(run, 'browser-link-check').catch(error => { console.error(error); process.exitCode = 1; });

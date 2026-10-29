/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const { fingerprint } = require('./lib/privacy-baseline.js');
const root = path.resolve(process.env.WARDENONE_EXTENSION_DIR || path.join(__dirname, '..'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const host = 'login.wardenone-history.example.com';
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Sign in fixture</title><label>Password <input type="password"></label>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = await profile.freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-history-modes-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      [`--host-resolver-rules=MAP ${host} 127.0.0.1,MAP * ~NOTFOUND`]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    let worker = extension.attachedSession;
    const evaluate = async (expression, session = worker) => {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (out.exceptionDetails) throw Error(JSON.stringify(out.exceptionDetails));
      return out.result.value;
    };
    async function page(url) {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      for (let i = 0; i < 80; i++) {
        if (await evaluate(`location.href.split('#')[0]===${JSON.stringify(url.split('#')[0])} && document.readyState==='complete' && !!document.body`, sessionId)) return sessionId;
        await sleep(100);
      }
      throw Error('page did not load');
    }
    const ui = await page(`chrome-extension://${extension.id}/settings.html#page=cleanup`);
    const ask = message => evaluate(`chrome.runtime.sendMessage(${JSON.stringify(message)})`, ui);
    const seed = async () => {
      await evaluate(`queueHistory({type:'blocked_popup',url:'https://account.example/reset/shortword?token=HISTORYSECRET',detail:{why:'See https://account.example/login?token=HISTORYSECRET'},at:Date.now()})`);
      for (let i = 0; i < 80; i++) {
        await evaluate('flushHistory();flushWardenNotifications()');
        await evaluate('WO_HISTORY.drain()');
        if (await evaluate('__histRecoveryDone&&!__histWriting&&!__histBuffer.length&&!__histInFlight.length')) return;
        await sleep(100);
      }
      throw Error('history writer did not settle');
    };
    const results = [];
    await seed();
    const initial = await ask({ kind: 'history-get' });
    assert(initial.history.length, JSON.stringify(initial));
    assert(!JSON.stringify(await ask({ kind: 'history-get' })).includes('HISTORYSECRET'));
    results.push('normal history and embedded URL redaction');
    assert.equal((await ask({ kind: 'history-mode-set', mode: 'session' })).ok, true);
    await seed();
    let stores = await evaluate('Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)])');
    assert(!stores[0].wardenone_history && !stores[0].wardenone_notifications);
    assert(stores[1].wardenone_history.length && stores[1].wardenone_notifications.length);
    const activity = await page(`chrome-extension://${extension.id}/history.html`);
    for (let i = 0; i < 60; i++) {
      if ((await evaluate('document.body.innerText', activity)).includes('account.example')) break;
      await sleep(100);
    }
    assert((await evaluate('document.body.innerText', activity)).includes('account.example'));
    results.push('session storage and real Activity rendering');
    await evaluate(`queueHistory({type:'blocked_popup',url:'https://pending.example/',at:Date.now()})`);
    assert.equal((await ask({ kind: 'history-clear' })).ok, true);
    await sleep(1000);
    assert.equal((await ask({ kind: 'history-get' })).history.length, 0);
    assert.equal((await ask({ kind: 'history-mode-set', mode: 'off' })).ok, true);
    await seed();
    stores = await evaluate('Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)])');
    for (const state of stores) assert(!state.wardenone_history && !state.wardenone_notifications && !state.__wardenone_hist_buffer);
    assert.equal(stores[0].wardenone_config.historyMode, 'off');
    results.push('clear revokes buffered writes; off persists only the selected setting');
    await evaluate(`(async()=>{
      await updateStoredConfig(c=>{c.dnsRebindGuard=false;c.loginAgeCheck=true;c.autoUpdateLists=false;});
      globalThis.__domainRequests=[];const realFetch=fetch;
      fetch=async function(url,options){if(String(url).startsWith('https://rdap.org/domain/')){
        __domainRequests.push(String(url));return new Response(JSON.stringify({events:[{eventAction:'registration',eventDate:'2000-01-01T00:00:00Z'}]}),{status:200,headers:{'content-type':'application/rdap+json'}});}
        return realFetch(url,options);};
    })()`);
    const login = await page(`http://${host}:${server.address().port}/signin`);
    await cdp.send('DOM.enable', {}, login);
    let button;
    for (let i = 0; i < 80; i++) {
      const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }, login);
      const visit = node => {
        if (node.nodeName === 'BUTTON' && node.children?.some(child => child.nodeValue === 'Check domain age')) button = node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
      };
      visit(tree.root); if (button) break; await sleep(100);
    }
    assert(button, 'an opted-in login offers a domain check');
    assert.deepEqual(await evaluate('__domainRequests'), [], 'password visibility alone must not start RDAP');
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: button.nodeId }, login);
    const q = model.content, x = (q[0] + q[4]) / 2, y = (q[1] + q[5]) / 2;
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, login);
    for (let i = 0; i < 60; i++) { if ((await evaluate('__domainRequests')).length) break; await sleep(100); }
    const requests = await evaluate('__domainRequests');
    assert.deepEqual(requests, ['https://rdap.org/domain/example.com']);
    results.push('no domain disclosure before a native trusted click; only the registrable domain reaches the controlled RDAP endpoint');
    async function restart() {
      await profile.killBrowser(cdp, port); cdp.close();
      const fresh = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
        ['--host-resolver-rules=MAP * ~NOTFOUND']);
      cdp = new profile.Cdp(fresh.webSocketDebuggerUrl); await cdp.connect();
      worker = (await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version)).attachedSession;
      return page(`chrome-extension://${extension.id}/settings.html#page=cleanup`);
    }
    let restartedUi = await restart();
    let restored = await evaluate("chrome.runtime.sendMessage({kind:'history-get'})", restartedUi);
    assert.equal(restored.mode, 'off'); assert.equal(restored.history.length, 0);
    assert.equal((await evaluate("chrome.runtime.sendMessage({kind:'history-mode-set',mode:'session'})", restartedUi)).ok, true);
    await seed();
    assert((await evaluate("chrome.runtime.sendMessage({kind:'history-get'})", restartedUi)).history.length);
    restartedUi = await restart();
    restored = await evaluate("chrome.runtime.sendMessage({kind:'history-get'})", restartedUi);
    assert.equal(restored.mode, 'session'); assert.equal(restored.history.length, 0); assert.equal(restored.notifications.length, 0);
    results.push('browser restart preserves the selected mode and removes session-only incidents');
    const report = { date: new Date().toISOString(), browser: browser.Browser, fingerprint: process.env.WARDENONE_EXTENSION_DIR ? fingerprint(root).sha256 : null, results, controlledRequests: requests };
    const output = process.env.WARDENONE_HISTORY_REPORT;
    if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve));
    cleanupProfile(dir, 'wo-history-modes-');
  }
}
profile.mustFinish(run, 'browser-history-modes').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

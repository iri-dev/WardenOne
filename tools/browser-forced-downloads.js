/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const {cleanupProfile} = require('./lib/browser-profile-cleanup.js');
const root = path.resolve(process.env.WARDENONE_EXTENSION_DIR || path.join(__dirname, '..'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const httpPort = await profile.freePort();
  const base = `http://download.wardenone-fixture.example.com:${httpPort}`;
  const cdn = `http://cdn.wardenone-fixture.example.org:${httpPort}`;
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, base);
    hits.push(url.pathname);
    if (url.pathname === '/start') { res.writeHead(302, { Location: cdn + '/file.exe' }); res.end(); return; }
    if (/^\/(file\.exe|opaque|avast_secure_browser_setup\.exe)$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="' +
        (url.pathname.includes('avast') ? 'avast_secure_browser_setup.exe' : 'file.exe') + '"', 'cache-control': 'no-store' });
      res.write('Harmless WardenOne download fixture.');
      setTimeout(() => res.end(' End.'), 4000);
      return;
    }
    const kind = url.searchParams.get('case');
    let body = '<h1>Download fixture</h1>';
    if (kind === 'synthetic') body += '<script>window.startFixture=()=>{const a=document.createElement("a");a.href="/file.exe";a.download="file.exe";document.body.appendChild(a);a.click()}</script>';
    if (kind === 'detached') body += '<script>window.startFixture=()=>{const a=document.createElement("a");a.href="/opaque";a.download="file.exe";a.click()}</script>';
    if (kind === 'automatic') body += '<script>window.startFixture=()=>location.assign("/opaque")</script>';
    if (kind === 'play') body += '<button id="main" onclick="location.assign(\'/opaque\')">Play video</button>';
    if (kind === 'direct') body += '<a id="main" href="/file.exe">Download installer</a>';
    if (kind === 'second') body += '<a id="main" href="/file.exe" onclick="setTimeout(()=>location.assign(\'/opaque\'),1500)">Download installer</a>';
    if (kind === 'cdn') body += '<a id="main" href="/start">Download installer</a>';
    if (kind === 'export') body += '<button id="main" onclick="const a=document.createElement(\'a\');a.href=window.URL.createObjectURL(new Blob([\'a,b\\n1,2\'],{type:\'text/csv\'}));a.download=\'report.csv\';a.click()">Export report</button>';
    if (kind === 'mismatch') body = '<h1>GTA VI Grand Theft Auto 6</h1><a id="main" href="' + cdn + '/avast_secure_browser_setup.exe">Download for Windows</a>';
    if (kind === 'hidden-offer' || kind === 'offer-continue') {
      body = '<h1>Game download fixture</h1><a id="main" href="/continuation" onclick="event.preventDefault();const m=document.getElementById(\'box-c2l-modal\');m.dataset.downloadUrl=this.href;m.style.display=\'block\'">Download for Windows</a>'
        + '<div id="box-c2l-modal" style="display:none"><div id="download-modal" class="box-c2l-offer" data-campaign-id="fixture">Sponsored offer '
        + '<a id="download-partner-restart" target="_blank" href="' + cdn + '/avast_secure_browser_setup.exe">click here</a>'
        + '<a id="download-partner-custom" target="_blank" href="' + cdn + '/avast_secure_browser_setup.exe">Download Now</a>'
        + '<a href="#" class="box-c2l-cancel-action">No thanks, I will continue downloading</a></div></div>';
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end('<!doctype html><title>Download fixture</title><body>' + body + '</body>');
  });
  await new Promise(resolve => server.listen(httpPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-forced-download-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP download.wardenone-fixture.example.com 127.0.0.1, MAP cdn.wardenone-fixture.example.org 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync('manifest.json')).version);
    const evaluate = async (expression, session = extension.attachedSession) => {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails));
      return out.result.value;
    };
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
    await evaluate('updateStoredConfig(cfg=>{cfg.downloadReputation=false;cfg.forcedDownloadProtection=true;cfg.dnsRebindGuard=false;cfg.blockGesturelessNav=false;cfg.blockForcedPopups=false;cfg.blockMetaRefresh=false;})');
    const until = async (fn, label) => {
      for (let i = 0; i < 100; i++) { if (await fn()) return; await sleep(100); }
      throw new Error('Timed out: ' + label);
    };
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const pageErrors = [];
    cdp.on(message => { if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails); });
    async function open(kind, click) {
      await evaluate('FORCED_DOWNLOAD_REQUESTS.clear();');
      const route = kind === 'mismatch' ? '/download/game' : '/page';
      await cdp.send('Page.navigate', { url: base + route + '?case=' + kind }, sessionId);
      await until(() => evaluate('document.readyState === "complete"', sessionId).catch(() => false), 'page loaded');
      await until(() => evaluate(`new Promise(async resolve => {
        const tabs=await tabsQuery({});const tab=tabs.find(t=>t.url===${JSON.stringify(base + route + '?case=' + kind)});
        if(!tab)return resolve(false);
        chrome.tabs.sendMessage(tab.id,{kind:'download-intent-query',filename:''},{frameId:0},r=>{
          const error=chrome.runtime.lastError;resolve(!error&&r&&r.configured);
        });
      })`), 'bridge configured');
      if (!click) await evaluate('if(window.startFixture)window.startFixture();true', sessionId);
      if (click) {
        const point = await evaluate('(()=>{const r=document.querySelector("#main").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()', sessionId);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, sessionId);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, sessionId);
      }
    }
    const items = () => evaluate('downloadSearch({})');
    async function latestAfter(before) {
      let latest;
      try { await until(async () => { latest = (await items()).filter(item => item.id > before).sort((a,b) => b.id-a.id)[0]; return !!latest; }, 'new download'); }
      catch (error) {
        console.log('diagnostic', JSON.stringify({ pageErrors, body: await evaluate('document.body.innerHTML.slice(0,800)', sessionId) }));
        throw error;
      }
      return latest;
    }
    const lastId = async () => Math.max(0, ...(await items()).map(item => item.id));
    await open('hidden-offer'); await sleep(1500);
    assert(!hits.includes('/avast_secure_browser_setup.exe'), 'hidden sponsor markup cannot initiate an installer request');
    assert.equal(await lastId(), 0, 'entry to a download detail page creates no download');
    console.log('[ok] hidden campaign offer stays inert on page entry');
    await open('offer-continue', true);
    await until(() => evaluate('location.pathname === "/continuation"', sessionId).catch(() => false), 'matching original continuation');
    assert(!hits.includes('/avast_secure_browser_setup.exe'), 'continuing a requested download never picks the sponsor installer');
    console.log('[ok] auto-skip follows the explicitly requested continuation');
    await open('synthetic'); await sleep(1800);
    if (!await evaluate('!!document.getElementById("wo-unexpected-download")', sessionId)) {
      const tree = await cdp.send('Page.getFrameTree', {}, sessionId);
      const world = await cdp.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'wardenone-debug' }, sessionId);
      console.log('diagnostic', JSON.stringify({ hits, downloads: await items(),
        worker: await evaluate('({requests:[...FORCED_DOWNLOAD_REQUESTS],contexts:[...FORCED_DOWNLOAD_CONTEXT],reasons:[...FORCED_DOWNLOAD_REASONS]})'),
        bridge: await cdp.send('Runtime.evaluate', { expression: '({version:window.__wardenOneBridgeReadyVersion,config:typeof window.__wardenOneContentConfig})', contextId: world.executionContextId, returnByValue: true }, sessionId) }));
    }
    assert(await evaluate('!!document.getElementById("wo-unexpected-download")', sessionId), 'synthetic link stopped before request');
    assert(!hits.includes('/file.exe'));
    console.log('[ok] synthetic first download stopped before network request');
    const beforeAllowance = await lastId();
    await cdp.send('DOM.enable', {}, sessionId);
    const { nodes } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true }, sessionId);
    const allow = nodes.find(node => node.nodeName === 'BUTTON' && nodes.some(child => child.parentId === node.nodeId && child.nodeValue === 'Download once'));
    assert(allow, 'the closed-shadow review has an allowance button');
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: allow.nodeId }, sessionId);
    const point = { x: (model.content[0] + model.content[2]) / 2, y: (model.content[1] + model.content[5]) / 2 };
    assert(point.x > 0 && point.x < 1280 && point.y > 0 && point.y < 900, 'review actions are on screen');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, sessionId);
    const allowed = await latestAfter(beforeAllowance);
    await until(async () => (await items()).some(entry => entry.id === allowed.id && entry.state === 'complete'), 'Download once completes');
    assert.equal(await evaluate(`getPendingDownload(${allowed.id}).then(Boolean)`), false);
    console.log('[ok] visible Download once action permits the requested file');
    await open('mismatch', true); await sleep(200);
    assert(await evaluate('!!document.getElementById("wo-unexpected-download")', sessionId), 'product mismatch intercepted');
    assert(!hits.includes('/avast_secure_browser_setup.exe'));
    console.log('[ok] unrelated installer link intercepted');
    for (const kind of ['automatic', 'detached', 'play']) {
      const before = await lastId();
      await open(kind, kind === 'play');
      let item;
      try { item = await latestAfter(before); } catch (error) {
        console.log('diagnostic', JSON.stringify({ kind, pageErrors, body: await evaluate('document.body.innerHTML', sessionId) }));
        throw error;
      }
      try { await until(() => evaluate(`getPendingDownload(${item.id}).then(r=>!!(r&&r.reviewEvidence.unexpectedDownload))`), kind + ' review'); }
      catch (error) {
        console.log('diagnostic', JSON.stringify(await evaluate('(async()=>({items:await downloadSearch({}),contexts:[...FORCED_DOWNLOAD_CONTEXT],reasons:[...FORCED_DOWNLOAD_REASONS]}))()')));
        throw error;
      }
      try { await until(async () => (await items()).some(entry => entry.id === item.id && entry.paused), kind + ' native pause'); }
      catch (error) {
        console.log('diagnostic', JSON.stringify(await evaluate(`Promise.all([downloadSearch({id:${item.id}}),getPendingDownload(${item.id})])`)));
        throw error;
      }
      const current = (await items()).find(entry => entry.id === item.id);
      assert.equal(current.paused, true, kind + ' is paused');
      assert.equal(current.state, 'in_progress');
      await evaluate(`handleDownloadDecision('${item.id}','cancel',{})`);
      console.log('[ok] ' + kind + ' attachment held and cancelled through review');
    }
    {
      /* Adversarial: the page starts an unrelated installer inside the window the real click opened. */
      const before = await lastId();
      await open('second', true);
      const first = await latestAfter(before);
      let second;
      await until(async () => { second = (await items()).find(entry => entry.id > first.id); return !!second; }, 'the second file');
      await until(() => evaluate(`getPendingDownload(${second.id}).then(r=>!!(r&&r.reviewEvidence.unexpectedDownload))`), 'second file held');
      await until(async () => (await items()).some(entry => entry.id === first.id && entry.state === 'complete'), 'requested file completes');
      assert.equal(await evaluate(`getPendingDownload(${first.id}).then(Boolean)`), false, 'the requested file is left alone');
      await evaluate(`handleDownloadDecision('${second.id}','cancel',{})`);
      console.log('[ok] a second, unrelated installer cannot reuse the first download click');
    }
    for (const kind of ['direct', 'cdn', 'export']) {
      const before = await lastId();
      await open(kind, true);
      const item = await latestAfter(before);
      await until(async () => (await items()).some(entry => entry.id === item.id && entry.state === 'complete'), kind + ' completes');
      assert.equal(await evaluate(`getPendingDownload(${item.id}).then(Boolean)`), false);
      console.log('[ok] intentional ' + kind + ' download completes quietly');
    }
    await evaluate('updateStoredConfig(cfg=>{cfg.forcedDownloadProtection=false;})');
    const before = await lastId(); await open('automatic'); const offItem = await latestAfter(before);
    await until(async () => (await items()).some(entry => entry.id === offItem.id && entry.state === 'complete'), 'toggle off');
    console.log('[ok] independent toggle disables page and browser backstops; ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve));
    cleanupProfile(dir, 'wo-forced-download-');
  }
}
profile.mustFinish(run, 'browser-forced-downloads').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

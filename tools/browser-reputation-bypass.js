/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const HOST = 'reputation.wardenone-grant.example.com';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const serverPort = await profile.freePort();
  const base = `http://${HOST}:${serverPort}`;
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: base + '/other-tenant', 'cache-control': 'no-store' }); res.end(); return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end('<!doctype html><title>Reputation fixture</title><main id="fixture">Requested page</main>');
  });
  await new Promise(resolve => server.listen(serverPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-reputation-grant-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const evaluate = async (expression, session = extension.attachedSession) => {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails));
      return out.result.value;
    };
    // The fixture maps a public host to loopback; replace provider verdicts without making external reputation requests.
    await evaluate(`(async()=>{
      await updateStoredConfig(cfg=>{cfg.dnsRebindGuard=false;});
      urlReputationConfig=async()=>({enabled:true});
      locallyBlockedReputationHost=async()=>'';
      urlReputationLookupUrl=async()=>({ok:true,hit:true,provider:'Fixture',threats:['MALWARE']});
    })()`);
    const tab = await evaluate(`chrome.tabs.create({url:'about:blank#reputation-grant-fixture'})`);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(t => t.type === 'page' && t.url === 'about:blank#reputation-grant-fixture');
    assert(target);
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, page);
    const pageValue = expression => evaluate(expression, page);
    async function until(predicate, description) {
      for (let i = 0; i < 120; i++) {
        try { if (await predicate()) return; } catch (_) {}
        await sleep(100);
      }
      throw new Error(description + ': ' + await pageValue('location.href'));
    }
    async function warningFor(url) {
      let handle;
      await until(async () => {
        if (!await pageValue(`location.pathname==='/safe-browsing-block.html' && document.readyState==='complete' && !!document.getElementById('wrong')`)) return false;
        handle = await pageValue(`new URLSearchParams(location.search).get('w')`);
        const record = await evaluate(`chrome.storage.session.get('wardenone_warning:'+${JSON.stringify(handle)}).then(s=>s['wardenone_warning:'+${JSON.stringify(handle)}])`);
        return record && record.url === url && record.tabId === tab.id;
      }, 'warning did not load for ' + url);
      return handle;
    }
    async function navigateBlocked(url) {
      await cdp.send('Page.navigate', { url }, page);
      return warningFor(url);
    }
    async function continueWarning() {
      assert.match(await pageValue(`document.getElementById('escape').textContent`), /exact address once, in this tab/);
      await pageValue(`document.getElementById('wrong').click()`);
      await until(() => pageValue(`!document.getElementById('proceed').disabled`), 'continue countdown did not finish');
      await pageValue(`document.getElementById('proceed').click()`);
    }
    const original = base + '/tenant-a?token=fixture-secret';
    const handle = await navigateBlocked(original);
    await continueWarning();
    await until(() => pageValue(`location.href===${JSON.stringify(original)} && !!document.getElementById('fixture')`), 'continue did not reach exact address');
    await sleep(300);
    const state = await evaluate(`chrome.storage.session.get(['wardenone_warning:'+${JSON.stringify(handle)},SAFE_BROWSING_BYPASS_KEY])`);
    assert.deepEqual(state, {}, 'warning and one-use grant are consumed');
    await navigateBlocked(original);
    await navigateBlocked(base + '/tenant-b');
    await navigateBlocked(base + '/tenant-a?token=different');
    // Seed this warning before the HTTP redirect can commit its final address.
    const redirectWarning = await evaluate(`safeBrowsingBlockPageUrl({url:${JSON.stringify(base + '/redirect')},tabId:${tab.id},provider:'Fixture',threats:'MALWARE',context:'page'})`);
    await cdp.send('Page.navigate', { url: redirectWarning }, page);
    await warningFor(base + '/redirect');
    await continueWarning();
    await warningFor(base + '/other-tenant');
    console.log('[ok] ' + browser.Browser + ': actual warning Continue reaches only the original URL once; revisits, other tenants, query changes and HTTP redirects are checked');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-reputation-grant-/.test(path.basename(resolved))) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
profile.mustFinish(run, 'browser-reputation-bypass').catch(e => { console.error(e.stack || e); process.exitCode = 1; });

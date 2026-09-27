/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Manual browser check for SEC-10. Run with Node 22+ on Windows. It launches a disposable
   Edge profile, loads this checkout unpacked, and attacks a ClickFix warning on localhost. */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plus = String.fromCharCode(43);
const lure = 'Verify you are human. Press Win' + plus + 'R, then press Ctrl' + plus + 'V and press Enter to complete verification.';
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Warning ownership test</title></head>
<body><h1>Human verification</h1><p>${lure}</p><script>
window.warningRemovals = 0;
new MutationObserver(() => {
  for (const id of ['wo-cmd-warn', 'wo-owned-main-warning']) {
    const node = document.getElementById(id);
    if (node && window.warningRemovals < 4) { window.warningRemovals++; node.remove(); }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;

async function run() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-warning-'));
  let cdp = null;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs?.(cdp, port, extension.id);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: origin }, sessionId);
    let result = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const response = await cdp.send('Runtime.evaluate', {
        expression: `(() => ({ ready: window.__wardenOneReadyVersion || '',
          removed: window.warningRemovals || 0,
          original: !!document.getElementById('wo-cmd-warn'),
          owned: !!document.getElementById('wo-owned-main-warning'),
          closed: !!document.getElementById('wo-owned-main-warning') && document.getElementById('wo-owned-main-warning').shadowRoot === null }))()`,
        returnByValue: true,
      }, sessionId);
      result = response.result && response.result.value;
      if (result && result.ready === version && result.removed >= 2 && result.owned) break;
    }
    console.log(JSON.stringify(result));
    if (!result || result.ready !== version || result.removed < 2 || !result.owned || !result.closed) {
      throw new Error('The real-browser warning removal and owned-overlay check did not pass');
    }
    console.log('[ok] real-browser warning remains in a closed owned overlay after page removal');
    const { sessionId: worker } = await cdp.send('Target.attachToTarget', { targetId: extension.workerTargetId, flatten: true });
    await cdp.send('Runtime.enable', {}, worker);
    await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount=0; globalThis.showWardenSystemNotification=async function(){globalThis.__warningIntegrityCount++;return true};',
    }, worker);
    await sleep(6500);
    const visibleProbe = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    const beforeCover = visibleProbe.result && visibleProbe.result.value;
    if (beforeCover) throw new Error('A visible owned warning falsely requested a browser fallback (' + beforeCover + ')');
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const host=document.getElementById('wo-owned-main-warning');
        host.style.setProperty('display','none','important');
        const fake=document.createElement('div'); fake.id='wo-owned-main-warning'; fake.textContent='Safe to continue';
        document.body.appendChild(fake); return host.isConnected; })()`,
      returnByValue: true,
    }, sessionId);
    await sleep(6500);
    const hiddenProbe = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    if ((hiddenProbe.result && hiddenProbe.result.value || 0) < 1) {
      throw new Error('CSS-hidden owned warning and counterfeit ID did not request browser fallback');
    }
    console.log('[ok] CSS-hidden warning and counterfeit ID request browser-owned fallback');
    await cdp.send('Page.reload', {}, sessionId);
    await sleep(2500);
    await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount=0',
    }, worker);
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const d=document.createElement('dialog'); d.id='cover';
        d.style.cssText='width:100vw;height:100vh;max-width:100vw;max-height:100vh;margin:0;padding:0;border:0;background:#000';
        document.body.appendChild(d); d.showModal(); return document.elementFromPoint(innerWidth/2,32).id; })()`,
      returnByValue: true,
    }, sessionId);
    await sleep(10500);
    const fallback = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    const count = fallback.result && fallback.result.value;
    if (count < 1) throw new Error('Top-layer cover did not trigger a browser-owned fallback (got ' + count + ')');
    console.log('[ok] top-layer cover requests a browser-owned fallback');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise((resolve) => server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot)) throw new Error('Refusing to remove a profile outside temp');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

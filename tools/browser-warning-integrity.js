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
window.warningStops = 0;
window.addEventListener('wo-event', (event) => {
  if (event.detail && event.detail.type === 'warning_panel') {
    window.warningStops++;
    event.stopImmediatePropagation();
  }
}, true);
new MutationObserver(() => {
  for (const id of ['wo-cmd-warn', 'wo-owned-main-warning']) {
    const node = document.getElementById(id);
    if (node && window.warningRemovals < 4) { window.warningRemovals++; node.remove(); }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;
const fakeUpdatePage = `<!doctype html><html><head><meta charset="utf-8"><title>Fake update warning test</title></head>
<body><h1>Your browser is out of date</h1><a href="/update.exe">Download update</a><script>
window.toastRemovals = 0;
window.toastStops = 0;
window.toastEvents = [];
window.addEventListener('wo-event', (event) => {
  window.toastEvents.push(event.detail && event.detail.type || '?');
  if (event.detail && event.detail.type === 'warning_toast') {
    window.toastStops++;
    event.stopImmediatePropagation();
  }
}, true);
new MutationObserver(() => {
  for (const id of ['rg-toast-host', 'wo-owned-security-toast']) {
    const node = document.getElementById(id);
    if (node && window.toastRemovals < 4) { window.toastRemovals++; node.remove(); }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
</script></body></html>`;

async function run() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/fake-update' ? fakeUpdatePage : page);
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
          stopped: window.warningStops || 0,
          original: !!document.getElementById('wo-cmd-warn'),
          owned: !!document.getElementById('wo-owned-main-warning'),
          closed: !!document.getElementById('wo-owned-main-warning') && document.getElementById('wo-owned-main-warning').shadowRoot === null }))()`,
        returnByValue: true,
      }, sessionId);
      result = response.result && response.result.value;
      if (result && result.ready === version && result.removed >= 2 && result.stopped >= 1 && result.owned) break;
    }
    console.log(JSON.stringify(result));
    if (!result || result.ready !== version || result.removed < 2 || result.stopped < 1 || !result.owned || !result.closed) {
      throw new Error('The real-browser warning removal and owned-overlay check did not pass');
    }
    console.log('[ok] real-browser warning remains in a closed owned overlay after page removal');
    await cdp.send('Accessibility.enable', {}, sessionId);
    const ax = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const dialog = (ax.nodes || []).find((node) => !node.ignored && node.role && node.role.value === 'alertdialog');
    if (!dialog || !dialog.name || !dialog.name.value) throw new Error('Owned warning has no named alertdialog in the browser accessibility tree');
    const initialFocus = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement && document.activeElement.id', returnByValue: true }, sessionId);
    if (!initialFocus.result || initialFocus.result.value !== 'wo-owned-main-warning') throw new Error('Owned warning did not take initial focus');
    for (let i = 0; i < 5; i++) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      const focused = await cdp.send('Runtime.evaluate', {
        expression: 'document.activeElement && document.activeElement.id', returnByValue: true,
      }, sessionId);
      if (!focused.result || focused.result.value !== 'wo-owned-main-warning') {
        throw new Error('Tab left the owned warning dialog on step ' + (i + 1) + ': ' + JSON.stringify(focused.result && focused.result.value));
      }
    }
    console.log('[ok] owned warning has a named alertdialog and keeps keyboard focus inside');
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const node=document.getElementById('wo-owned-main-warning');
        const fragment=document.createDocumentFragment(); fragment.appendChild(node); return !node.isConnected; })()`,
      returnByValue: true,
    }, sessionId);
    await sleep(600);
    const reparented = await cdp.send('Runtime.evaluate', {
      expression: `!!document.getElementById('wo-owned-main-warning')`, returnByValue: true,
    }, sessionId);
    if (!reparented.result || reparented.result.value !== true) throw new Error('Reparented warning was not restored');
    const reparentedFocus = await cdp.send('Runtime.evaluate', {
      expression: 'document.activeElement && document.activeElement.id', returnByValue: true,
    }, sessionId);
    if (!reparentedFocus.result || reparentedFocus.result.value !== 'wo-owned-main-warning') throw new Error('Reparented warning did not restore focus');
    console.log('[ok] reparented warning returns to the page');
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
    await cdp.send('Runtime.evaluate', { expression: 'globalThis.__warningIntegrityCount=0' }, worker);
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const host=document.getElementById('wo-owned-main-warning');
        if (!host) return false; host.style.setProperty('opacity','0','important'); return true; })()`,
      returnByValue: true,
    }, sessionId);
    await sleep(6500);
    const transparentProbe = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    if ((transparentProbe.result && transparentProbe.result.value || 0) < 1) {
      throw new Error('Opacity-hidden owned warning did not request browser fallback');
    }
    console.log('[ok] opacity-hidden warning requests browser-owned fallback');
    const topTarget = await cdp.send('Target.createTarget', { url: origin });
    const topAttached = await cdp.send('Target.attachToTarget', { targetId: topTarget.targetId, flatten: true });
    const topSession = topAttached.sessionId;
    await cdp.send('Runtime.enable', {}, topSession);
    let topReady = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const probe = await cdp.send('Runtime.evaluate', {
        expression: `({ owned:!!document.getElementById('wo-owned-main-warning'), stopped:window.warningStops||0,
          removals:window.warningRemovals||0 })`, returnByValue: true,
      }, topSession);
      topReady = probe.result && probe.result.value;
      if (topReady && topReady.owned && topReady.stopped >= 1) break;
    }
    if (!topReady || !topReady.owned || topReady.stopped < 1) throw new Error('Top-layer case has no warning to cover: ' + JSON.stringify(topReady));
    await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount=0',
    }, worker);
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const d=document.createElement('dialog'); d.id='cover';
        d.style.cssText='width:100vw;height:100vh;max-width:100vw;max-height:100vh;margin:0;padding:0;border:0;background:#000';
        document.body.appendChild(d); d.showModal(); return document.elementFromPoint(innerWidth/2,32).id; })()`,
      returnByValue: true,
    }, topSession);
    await sleep(10500);
    const fallback = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    const count = fallback.result && fallback.result.value;
    if (count < 1) throw new Error('Top-layer cover did not trigger a browser-owned fallback (got ' + count + ')');
    console.log('[ok] top-layer cover requests a browser-owned fallback');
    const toastTarget = await cdp.send('Target.createTarget', { url: origin + '/fake-update' });
    const toastAttached = await cdp.send('Target.attachToTarget', { targetId: toastTarget.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, toastAttached.sessionId);
    let toast = null;
    for (let i = 0; i < 24; i++) {
      await sleep(400);
      const probe = await cdp.send('Runtime.evaluate', {
        expression: `({ready:window.__wardenOneReadyVersion||'',removals:window.toastRemovals||0,
          stopped:window.toastStops||0,owned:!!document.getElementById('wo-owned-security-toast'),
          closed:!!document.getElementById('wo-owned-security-toast')&&document.getElementById('wo-owned-security-toast').shadowRoot===null,
          events:window.toastEvents||[],body:document.body.innerText.slice(0,200)})`,
        returnByValue: true,
      }, toastAttached.sessionId);
      toast = probe.result && probe.result.value;
      if (toast && toast.ready === version && toast.removals >= 2 && toast.stopped >= 1 && toast.owned) break;
    }
    if (!toast || toast.ready !== version || toast.removals < 2 || toast.stopped < 1 || !toast.owned || !toast.closed) {
      throw new Error('Security toast did not survive hostile removal and event stopping: ' + JSON.stringify(toast));
    }
    console.log('[ok] security toast has an isolated copy after hostile removal and event stopping');
    await cdp.send('Runtime.evaluate', { expression: 'globalThis.__warningIntegrityCount=0' }, worker);
    await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('wo-owned-security-toast').style.setProperty('filter','blur(8px)','important')`,
    }, toastAttached.sessionId);
    await sleep(6500);
    const toastFallback = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    if ((toastFallback.result && toastFallback.result.value || 0) < 1) {
      throw new Error('Blurred security toast did not request browser fallback: ' + JSON.stringify(toastFallback.result));
    }
    console.log('[ok] CSS-blurred security toast requests browser-owned fallback');
    const movedTarget = await cdp.send('Target.createTarget', { url: origin });
    const movedAttached = await cdp.send('Target.attachToTarget', { targetId: movedTarget.targetId, flatten: true });
    await cdp.send('Page.enable', {}, movedAttached.sessionId);
    await cdp.send('Runtime.enable', {}, movedAttached.sessionId);
    let movedReady = false;
    for (let i = 0; i < 24; i++) {
      await sleep(400);
      const probe = await cdp.send('Runtime.evaluate', {
        expression: `!!document.getElementById('wo-owned-main-warning')`, returnByValue: true,
      }, movedAttached.sessionId);
      movedReady = probe.result && probe.result.value === true;
      if (movedReady) break;
    }
    if (!movedReady) throw new Error('Transform case has no owned warning');
    await cdp.send('Runtime.evaluate', { expression: 'globalThis.__warningIntegrityCount=0' }, worker);
    await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('wo-owned-main-warning').style.setProperty('transform','translateX(200vw)','important')`,
    }, movedAttached.sessionId);
    await sleep(6500);
    const movedFallback = await cdp.send('Runtime.evaluate', {
      expression: 'globalThis.__warningIntegrityCount || 0', returnByValue: true,
    }, worker);
    if ((movedFallback.result && movedFallback.result.value || 0) < 1) throw new Error('Offscreen-transformed warning did not request browser fallback');
    console.log('[ok] offscreen-transformed warning requests browser-owned fallback');
    await cdp.send('Page.navigate', { url: 'about:blank' }, movedAttached.sessionId);
    await sleep(500);
    const navigated = await cdp.send('Runtime.evaluate', {
      expression: `!!document.getElementById('wo-owned-main-warning')`, returnByValue: true,
    }, movedAttached.sessionId);
    if (navigated.result && navigated.result.value) throw new Error('Owned warning survived navigation');
    console.log('[ok] owned warning does not persist into a new document');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise((resolve) => server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot)) throw new Error('Refusing to remove a profile outside temp');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

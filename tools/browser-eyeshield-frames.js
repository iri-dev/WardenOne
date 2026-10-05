/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
/* A real browser checks frame matching, which worker-only tests cannot simulate.
   Run: node tools/browser-eyeshield-frames.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const siteHost = 'site.wardenone-frame.example';
const embedHost = 'embed.wardenone-frame.example';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const serverPort = await profile.freePort();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.url === '/child' ? '<!doctype html><title>Child</title><p>Embedded page</p>'
      : `<!doctype html><title>Parent</title><iframe src="http://${embedHost}:${serverPort}/child"></iframe>`);
  });
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-eyeshield-frames-'));
  let cdp;
  try {
    const mapped = `MAP ${siteHost} 127.0.0.1, MAP ${embedHost} 127.0.0.1`;
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=' + mapped]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const attach = async (targetId) => {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    };
    const evaluate = async (sessionId, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400));
      return result.result.value;
    };
    const until = async (fn, label) => {
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await sleep(150)) {
        try { if (await fn()) return; } catch (_) {}
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workerTarget = targetInfos.find((target) => target.type === 'service_worker'
      && target.url === `chrome-extension://${extension.id}/background.js`);
    assert(workerTarget, 'the WardenOne worker');
    const worker = await attach(workerTarget.targetId);
    const { targetId: settingsId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/settings.html` });
    const settings = await attach(settingsId);
    await until(() => evaluate(settings, "typeof loaded !== 'undefined' && loaded === true"), 'Settings');
    const registrationReady = () => evaluate(worker, "chrome.scripting.getRegisteredContentScripts({ ids: ['wo-eyeshield-dynamic'] }).then((list) => list.length === 1 && list[0].js.includes('eyeshield-bootstrap.js') && list[0].allFrames === true && list[0].matches.includes('<all_urls>'))");
    const probe = (tabId) => evaluate(worker, `chrome.scripting.executeScript({ target: { tabId: ${tabId}, allFrames: true }, world: 'ISOLATED', func: () => ({ host: location.hostname, active: typeof window.__wardenOneEyeShieldApplyConfig === 'function', mode: document.getElementById('wardenone-eyeshield-theme')?.getAttribute('data-wo-eyeshield-mode') || '' }) }).then((list) => list.map((item) => item.result))`);
    const openPage = async () => {
      const url = `http://${siteHost}:${serverPort}/parent?fresh=${Date.now()}`;
      await cdp.send('Target.createTarget', { url });
      let tabId;
      await until(async () => {
        tabId = await evaluate(worker, `chrome.tabs.query({}).then((tabs) => (tabs.find((tab) => String(tab.url || '') === ${JSON.stringify(url)}) || {}).id)`);
        return Number.isInteger(tabId);
      }, 'the test tab');
      await until(async () => (await probe(tabId)).some((frame) => frame.host === embedHost), 'the cross-origin child frame');
      return tabId;
    };

    await evaluate(settings, `writeConfig({ eyeShield: false, eyeShieldMode: 'off', eyeShieldSites: { '${siteHost}': { mode: 'custom', theme: 'dark' } } }).then(() => true)`);
    await until(registrationReady, 'the frame bootstrap registration');
    const customTab = await openPage();
    await until(async () => {
      const frames = await probe(customTab);
      return frames.some((frame) => frame.host === siteHost && frame.active && frame.mode === 'dark')
        && frames.some((frame) => frame.host === embedHost && frame.active && frame.mode === 'dark');
    }, 'the custom dark profile in both site frames');

    await evaluate(settings, `writeConfig({ eyeShield: true, eyeShieldMode: 'dark', eyeShieldSites: { '${siteHost}': { mode: 'off' } } }).then(() => true)`);
    await until(registrationReady, 'the Off-site frame bootstrap registration');
    const offTab = await openPage();
    await until(async () => {
      const frames = await probe(offTab);
      return frames.some((frame) => frame.host === siteHost) && frames.some((frame) => frame.host === embedHost)
        && frames.every((frame) => !frame.active);
    }, 'the full script to stay out of Off-site frames');
    await evaluate(settings, `writeConfig({ eyeShield: false, eyeShieldMode: 'off', eyeShieldSites: { '${siteHost}': { mode: 'custom', theme: 'dark' } } }).then(() => true)`);
    await until(async () => {
      const frames = await probe(offTab);
      return frames.some((frame) => frame.host === siteHost && frame.mode === 'dark')
        && frames.some((frame) => frame.host === embedHost && frame.mode === 'dark');
    }, 'Custom to apply to the already open Off-site tab');
    console.log('[ok] real browser: custom profile reaches cross-origin frames; Off skips the full engine; switching to Custom updates the open tab');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-eyeshield-frames-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

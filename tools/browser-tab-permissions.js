/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

/* Permission variants run in disposable copies and profiles. The working manifest stays intact. */
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = JSON.parse(fs.readFileSync(path.join(root, 'tools/package-allowlist.json'), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Extension action automation requires Chrome's debugging pipe transport. */
class PipeCdp {
  constructor(child) {
    this.child = child;
    this.nextId = 0;
    this.pending = new Map();
    let buffer = '';
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });
    const closed = () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Browser pipe closed'));
      }
      this.pending.clear();
    };
    child.once('exit', closed);
    child.once('error', closed);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
}

async function run() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Permission audit page</title><p>Local fixture</p>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://permission-audit.wardenone-smoke.test:' + server.address().port + '/page';
  const results = [];
  const out = process.env.WARDENONE_PERMISSION_AUDIT_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  try {
    for (const removed of [[], ['activeTab'], ['tabs'], ['activeTab', 'tabs']]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-tab-permissions-'));
      const extensionDir = path.join(dir, 'extension');
      fs.mkdirSync(extensionDir);
      for (const file of files) {
        const destination = path.join(extensionDir, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file), destination);
      }
      const variant = { ...manifest, permissions: manifest.permissions.filter((permission) => !removed.includes(permission)) };
      fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify(variant, null, 2));
      const binary = process.env.WARDENONE_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      const child = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--disable-background-networking',
        '--disable-component-update', '--disable-sync', '--window-size=1200,1000',
        '--user-data-dir=' + path.join(dir, 'profile'),
        '--host-resolver-rules=MAP permission-audit.wardenone-smoke.test 127.0.0.1', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
      const cdp = new PipeCdp(child);
      try {
        const browser = await cdp.send('Browser.getVersion');
        await cdp.send('Extensions.loadUnpacked', { path: extensionDir });
        let extension = await profile.extensionReady(cdp, 0, manifest.version);
        const evaluate = async (session, expression) => {
          const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
            .catch((error) => { throw new Error(expression.slice(0, 200) + ': ' + error.message); });
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
          return result.result.value;
        };
        const open = async (address) => {
          const { targetId } = await cdp.send('Target.createTarget', { url: address });
          const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
          await cdp.send('Runtime.enable', {}, sessionId);
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            if (await evaluate(sessionId, `location.href === ${JSON.stringify(address)}
              && document.readyState === 'complete'`)) return { targetId, sessionId };
            await sleep(50);
          }
          throw new Error('Page did not load: ' + address);
        };
        const worker = (expression) => evaluate(extension.attachedSession, expression);
        const first = await open(url);
        const { targetInfos } = await cdp.send('Target.getTargets', {
          filter: [{ type: 'tab', exclude: false }, { exclude: true }],
        });
        const actionTarget = targetInfos.find((target) => target.url === url);
        assert(actionTarget, 'the fixture has a tab target for action invocation');
        await open(url);
        const internal = await open('chrome://version/');
        const allTabs = await worker('chrome.tabs.query({})');
        const firstTab = allTabs.find((tab) => tab.url === url);
        assert(firstTab, 'ordinary HTTP metadata is available with broad host access');
        let control = await open('chrome-extension://' + extension.id + '/permissions.html');
        const injection = () => evaluate(control.sessionId, `Promise.race([
          chrome.scripting.executeScript({ target: { tabId: ${firstTab.id} },
            func: () => document.title }).then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
        ])`);
        assert.equal(await injection(), true, 'ordinary page injection works');
        assert((await worker('findDuplicateTabs()')).extraCount >= 1, 'ordinary duplicate scanning works');
        const internalVisible = allTabs.some((tab) => tab.url === 'chrome://version/');
        assert.equal(internalVisible, !removed.includes('tabs'), 'browser-page metadata needs tabs');
        if (!removed.length) {
          const dns = await open('chrome-extension://' + extension.id + '/network.html');
          for (const theme of ['light', 'dark']) {
            const colors = [];
            for (const state of ['on', 'warn', 'off']) {
              const rendered = await evaluate(dns.sessionId, `(async () => {
                document.documentElement.setAttribute('data-wardenone-theme-resolved', ${JSON.stringify(theme)});
                globalThis.fetch = async (address) => {
                  if (${JSON.stringify(state)} === 'on' && Object.values(TESTS).flat().includes(address)) throw new Error('blocked');
                  if (${JSON.stringify(state)} === 'warn' && address === TESTS.adult[0]) throw new Error('blocked');
                  return {};
                };
                await runTest();
                const result = document.getElementById('result');
                result.scrollIntoView({ behavior: 'instant', block: 'center' });
                return { className: result.className, color: getComputedStyle(result).color,
                  background: getComputedStyle(result).backgroundColor };
              })()`);
              assert.equal(rendered.className, 'result ' + state + ' show');
              colors.push(rendered.background);
              if (out) {
                const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, dns.sessionId);
                fs.writeFileSync(path.join(out, 'dns-' + theme + '-' + state + '.png'), Buffer.from(screenshot.data, 'base64'));
              }
            }
            assert.equal(new Set(colors).size, 3, theme + ' DNS result states have distinct rendered colors');
          }
          await cdp.send('Target.closeTarget', { targetId: dns.targetId });
        }
        const settings = await open('chrome://extensions/');
        await evaluate(settings.sessionId, `chrome.developerPrivate.updateExtensionConfiguration({
          extensionId: ${JSON.stringify(extension.id)}, hostAccess: 'ON_CLICK' })`);
        await sleep(500);
        extension = await profile.extensionReady(cdp, 0, manifest.version);
        await cdp.send('Target.closeTarget', { targetId: settings.targetId });
        await cdp.send('Target.closeTarget', { targetId: internal.targetId });
        await cdp.send('Page.reload', {}, first.sessionId);
        await sleep(300);
        await cdp.send('Target.closeTarget', { targetId: control.targetId });
        control = await open('chrome-extension://' + extension.id + '/permissions.html');
        const withheldInjection = await injection();
        const withheldDuplicates = (await worker('findDuplicateTabs()')).extraCount;
        assert.equal(withheldInjection, false, 'withheld host access blocks injection before invocation');
        assert.equal(withheldDuplicates >= 1, !removed.includes('tabs'), 'duplicate scanning with withheld hosts needs tabs');
        await cdp.send('Page.bringToFront', {}, first.sessionId);
        await cdp.send('Extensions.triggerAction', { id: extension.id, targetId: actionTarget.targetId });
        const invokedInjection = await injection();
        assert.equal(invokedInjection, true, 'toolbar invocation grants access to the requested site');
        const row = { removed, browser: browser.product, ordinaryInjection: true,
          internalVisible, withheldInjection, withheldDuplicates, invokedInjection };
        results.push(row);
        console.log(JSON.stringify(row));
      } finally {
        await cdp.send('Browser.close').catch(() => {});
        child.stdio[3].destroy();
        child.stdio[4].destroy();
        child.kill();
        const resolved = path.resolve(dir);
        if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-tab-permissions-/.test(path.basename(resolved))) {
          try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
        }
      }
    }
    if (out) fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log('[ok] tab-permission variants and rendered DNS result states');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

profile.mustFinish(run, 'browser-tab-permissions').catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

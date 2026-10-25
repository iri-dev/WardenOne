/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Real requests and firewall controls in disposable Edge, including rejected writes. */
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const ROOT = path.resolve(__dirname, '..');
const SITE = 'fw-site.example.com';
const TARGET = 'fw-cdn.example.com';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const report = { measuredAt: new Date().toISOString(), completed: false, checks: [],
    sources: Object.fromEntries(['background.js', 'firewall.js', 'firewall.html', 'settings.js'].map(file =>
      [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')])) };
  const out = path.join(ROOT, 'docs/perf/traces/firewall-2026-10-25/report.json');
  const server = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', 'http://' + SITE + ':' + server.address().port);
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('cache-control', 'no-store');
    if (req.url.startsWith('/headers')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ cookie: req.headers.cookie || '' }));
    } else if (/\.js(?:\?|$)/.test(req.url)) {
      res.setHeader('content-type', 'text/javascript');
      res.end('window.__firewallResourceLoaded = true;');
    } else if (req.url.startsWith('/pixel')) {
      res.setHeader('content-type', 'image/png');
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    } else {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>Firewall fixture</title><p>Ordinary site content</p>'
        + '<script>if(parent!==window)parent.postMessage({kind:"firewall-frame-probe",n:new URLSearchParams(location.search).get("n")},"*")</script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://' + SITE + ':' + server.address().port;
  const target = 'http://' + TARGET + ':' + server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-firewall-'));
  const port = await profile.freePort();
  let cdp;
  const check = (label, condition) => { assert(condition, label); report.checks.push(label); console.log('[ok] ' + label); };
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', ROOT, port, dir,
      ['--host-resolver-rules=MAP ' + SITE + ' 127.0.0.1, MAP ' + TARGET + ' 127.0.0.1, MAP * ~NOTFOUND']);
    report.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'))).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const worker = expression => evaluate(extension.attachedSession, expression);
    const until = async (fn, label) => {
      for (const deadline = Date.now() + 30000; Date.now() < deadline; await sleep(100)) if (await fn()) return;
      throw new Error('timed out waiting for ' + label);
    };
    await until(() => worker('!!__refreshExtensionStateLastKey && !__refreshExtensionStateInFlightKey'), 'initial reconcile');
    await worker('Promise.all([...__subsystemQueues.values()]).then(() => true)');
    const createPage = async url => {
      const { targetId } = await cdp.send('Target.createTarget', { url });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    };
    const page = await createPage(origin + '/');
    await until(() => evaluate(page, 'window.__wardenOneReadyVersion === ' + JSON.stringify(version)), 'site engine');
    const tabId = await worker(`chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === ${JSON.stringify(origin + '/')}).id)`);
    const ui = await createPage('chrome-extension://' + extension.id + '/firewall.html?site=' + SITE + '&tab=' + tabId);
    await until(() => evaluate(ui, 'typeof RULES === "object" && document.getElementById("capture-state").textContent.startsWith("Watching")'), 'firewall page');
    const ask = message => evaluate(ui, `new Promise(resolve => chrome.runtime.sendMessage(${JSON.stringify(message)}, resolve))`);
    const set = async (column, verdict) => {
      const result = await ask({ kind: 'firewall-set', site: SITE, domain: TARGET, column, verdict });
      assert(result && result.ok, JSON.stringify(result));
      return result;
    };
    let serial = 0;
    const load = (type, route) => evaluate(page, `new Promise(resolve => {
      const node = document.createElement(${JSON.stringify(type === 'image' ? 'img' : 'script')});
      node.onload = () => { node.remove(); resolve(true); };
      node.onerror = () => { node.remove(); resolve(false); };
      node.src = ${JSON.stringify(target + route + '?n=' + serial++)};
      document.body.appendChild(node);
    })`);
    check('ordinary script starts accessible', await load('script', '/ordinary.js'));
    await worker(`writeDynamicRules({ addRules: [
      { id:5000001, priority:3000, action:{type:'block'}, condition:{requestDomains:['${TARGET}'],urlFilter:'/security.js',resourceTypes:['script']} },
      { id:5000002, priority:1100, action:{type:'block'}, condition:{requestDomains:['${TARGET}'],urlFilter:'/tracker.js',resourceTypes:['script']} }
    ] }).then(() => true)`);
    await set('all', 'block');
    check('All block stops scripts and images', !await load('script', '/ordinary.js') && !await load('image', '/pixel.png'));
    await evaluate(ui, 'load(); true');
    await until(() => evaluate(ui, `RULES[${JSON.stringify(TARGET)}]?.all === 'block'`), 'All block display');
    await evaluate(ui, `document.getElementById('noop-mode').checked = true;
      document.getElementById('noop-mode').dispatchEvent(new Event('change'));
      const select = [...document.querySelectorAll('select.fw-btn')].find(node => node.getAttribute('aria-label').startsWith('${TARGET}, Script:'));
      select.value = 'noop'; select.dispatchEvent(new Event('change')); true`);
    await until(() => evaluate(ui, `RULES[${JSON.stringify(TARGET)}]?.script === 'noop'`), 'direct noop selection');
    check('Script noop permits an otherwise unblocked script', await load('script', '/ordinary.js'));
    check('Script noop retains malware and tracker blocks', !await load('script', '/security.js') && !await load('script', '/tracker.js'));
    check('Script noop leaves the row All block on images', !await load('image', '/pixel.png'));
    await set('media', 'noop');
    check('Media noop permits the otherwise unblocked image', await load('image', '/pixel.png'));
    await set('media', 'default');
    const frame = () => {
      const token = String(serial++);
      return evaluate(page, `new Promise(resolve => {
        const frame = document.createElement('iframe');
        const finish = ok => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); resolve(ok); };
        const receive = event => { if(event.source === frame.contentWindow && event.origin === ${JSON.stringify(target)}
          && event.data?.kind === 'firewall-frame-probe' && event.data.n === ${JSON.stringify(token)}) finish(true); };
        const timer = setTimeout(() => finish(false), 1500);
        window.addEventListener('message', receive);
        frame.src = ${JSON.stringify(target + '/child?n=' + token)};
        document.body.appendChild(frame);
      })`);
    };
    check('Script noop leaves subframes under All block', !await frame());
    await set('frame', 'noop');
    check('Frame noop permits the otherwise unblocked child document', await frame());
    await set('frame', 'default');
    const headers = () => evaluate(page, `fetch(${JSON.stringify(target + '/headers')}, {credentials:'include'}).then(response => response.json()).catch(() => null)`);
    check('Script noop leaves XHR under All block', await headers() === null);
    await set('xhr', 'noop');
    await worker(`chrome.cookies.set({url:${JSON.stringify(target + '/')},name:'firewall_probe',value:'fixture',sameSite:'lax'}).then(cookie => !!cookie)`);
    await set('cookie', 'strip');
    check('XHR noop permits requests while independent cookie stripping remains active', (await headers())?.cookie === '');
    await set('cookie', 'default');
    check('removing cookie stripping restores the fixture cookie', (await headers())?.cookie.includes('firewall_probe=fixture'));
    await set('all', 'allow');
    check('noop removes All allow for malware and tracker scripts', !await load('script', '/security.js') && !await load('script', '/tracker.js'));
    await set('script', 'default');
    check('Default restores the explicit All allowance', await load('script', '/security.js'));
    await set('script', 'noop');

    await evaluate(ui, 'load(); true');
    await until(() => evaluate(ui, `RULES[${JSON.stringify(TARGET)}]?.script === 'noop'`), 'stored noop display');
    check('stored noop is visible and enables direct choices', await evaluate(ui,
      `document.getElementById('noop-mode').checked && [...document.querySelectorAll('select.fw-btn.is-noop')].some(node => node.value === 'noop')`));
    await evaluate(ui, 'document.getElementById("matrix").scrollIntoView(); true');
    await cdp.send('Page.enable', {}, ui);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, ui);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(out), 'firewall.png'), Buffer.from(screenshot.data, 'base64'));
    await worker('globalThis.__firewallNativeWrite = chrome.declarativeNetRequest.updateDynamicRules; chrome.declarativeNetRequest.updateDynamicRules = () => Promise.reject(new Error("simulated firewall write rejection")); true');
    await evaluate(ui, `const choice = document.querySelector('select.fw-btn.is-noop'); choice.value = 'default'; choice.dispatchEvent(new Event('change')); true`);
    await until(() => evaluate(ui, 'document.getElementById("status").textContent.includes("refused")'), 'refused UI change');
    await worker('chrome.declarativeNetRequest.updateDynamicRules = globalThis.__firewallNativeWrite; delete globalThis.__firewallNativeWrite; true');
    check('refused change preserves the visible, stored and applied noop', await evaluate(ui, `RULES[${JSON.stringify(TARGET)}].script === 'noop'`)
      && await worker(`readFirewall().then(matrix => matrix['${SITE}']['${TARGET}'].script === 'noop')`) && !await load('script', '/security.js'));
    const once = await ask({ kind: 'firewall-allow-once', site: SITE, domain: TARGET, column: 'all' });
    check('temporary explicit allowance retains its intended authority', once.ok && await load('script', '/security.js'));
    await worker(`firewallClearSession('${SITE}').then(result => { if(!result.ok)throw Error(result.error); return true; })`);
    check('clearing the temporary allowance restores the security block', !await load('script', '/security.js'));
    const reset = await ask({ kind: 'firewall-reset', site: SITE, all: false });
    check('reset restores ordinary traffic while retaining the independent security block', reset.ok && await load('script', '/ordinary.js') && !await load('script', '/security.js'));
    const settings = await createPage('chrome-extension://' + extension.id + '/settings.html');
    await until(() => evaluate(settings, 'typeof cleanLists === "function"'), 'settings backup validator');
    const backup = await evaluate(settings, `cleanLists({firewall:{'${SITE}':{'${TARGET}':{all:'block',script:'noop',cookie:'strip',media:'strip'}}}}).firewall`);
    check('settings backups retain noop and reject invalid column decisions', JSON.stringify(backup) === JSON.stringify({[SITE]:{[TARGET]:{all:'block',script:'noop',cookie:'strip'}}}));
    report.completed = true;
  } catch (error) { report.error = String(error.stack || error); throw error; }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('wo-firewall-')) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn('temporary profile cleanup deferred: ' + error.message); }
    }
  }
}

profile.mustFinish(run, 'firewall browser checks').catch(error => { console.error(error); process.exitCode = 1; });

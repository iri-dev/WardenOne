/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The protection itself, not just its pages, on a real web page. The extension-page suites prove
   the popup and Settings run; this proves what a website meets:
     - the page engine starts in the page's own world, at the shipped version;
     - it acts on the config the bridge hands it: a tracking ping on a link is stripped, and with
       that switch off in storage it is left alone, which the engine's built-in defaults alone
       could not do;
     - its signed report crosses the bridge to the worker, which counts it for the Site Dashboard;
     - a shipped network rule matches a listed tracker, whose live request is blocked before it
       leaves the browser, while an unlisted host on the same page still loads.
   The page is served locally; --host-resolver-rules points the test host names at it.
   Run: node tools/browser-engine-smoke.js
   It drives the unpacked extension in a browser (tools/perf-profile.js), so it runs in CI's
   browser jobs, Edge and Chrome at the manifest's minimum, rather than the local gate. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE_HOST = 'shop.wardenone-smoke.example';
const CONTROL_HOST = 'cdn.wardenone-smoke.example';

/* Domains the shipped tracker list blocks outright for a script's fetch, wherever it is loaded:
   a block rule naming the domain, for every resource type or for xmlhttprequest, and with no
   initiator, method or first-party condition that would leave this page out. */
function listedTrackers() {
  const out = [];
  const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules-trackers.json'), 'utf8'));
  for (const rule of rules) {
    const c = rule.condition || {};
    if (!rule.action || rule.action.type !== 'block') continue;
    if (c.initiatorDomains || c.excludedInitiatorDomains || c.requestMethods || c.excludedRequestMethods || c.domainType === 'firstParty') continue;
    if (c.resourceTypes && !c.resourceTypes.includes('xmlhttprequest')) continue;
    if (c.excludedResourceTypes && c.excludedResourceTypes.includes('xmlhttprequest')) continue;
    const domains = Array.isArray(c.requestDomains) ? c.requestDomains
      : (/^\|\|([a-z0-9.-]+\.[a-z]{2,})\^?$/.exec(c.urlFilter || '') || []).slice(1);
    for (const d of domains) if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !out.includes(d)) out.push(d);
    if (out.length >= 5) break;
  }
  return out;
}

async function run() {
  const trackers = listedTrackers();
  assert(trackers.length >= 3, 'the tracker list names domains to test against');
  const hits = [];
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    hits.push(host + req.url);
    if (req.url.startsWith('/page')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><title>Smoke</title><a id="tracked" href="/next" ping="/ping-beacon">Next</a><p>A page.</p>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end('ok');
  });
  const serverPort = await profile.freePort();
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-engine-smoke-'));
  const mapped = [PAGE_HOST, CONTROL_HOST].concat(trackers).map((h) => 'MAP ' + h + ' 127.0.0.1').join(', ');
  let cdp;
  try {
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
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ' -> ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const until = async (sessionId, expression, label, ms) => {
      for (const deadline = Date.now() + (ms || 15000); Date.now() < deadline; await sleep(100)) {
        try { if (await evaluate(sessionId, expression)) return; } catch (_) {}
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workerTarget = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extension.id}/background.js`);
    assert(workerTarget, 'the WardenOne service worker');
    const worker = await attach(workerTarget.targetId);
    const { targetId: settingsId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/settings.html` });
    const settings = await attach(settingsId);
    await until(settings, "typeof loaded !== 'undefined' && loaded === true", 'Settings to load');

    const pageUrl = `http://${PAGE_HOST}:${serverPort}/page`;
    const { targetId: pageId } = await cdp.send('Target.createTarget', { url: pageUrl });
    const page = await attach(pageId);
    await until(page, "document.readyState === 'complete'", 'the page to load');

    /* 1. The engine starts in the page's own world. */
    await until(page, `window.__wardenOneReadyVersion === ${JSON.stringify(version)}`, 'the page engine to start, at ' + version);

    /* 2. It acts on the config it was handed: the tracking ping on the link goes. */
    await until(page, "!document.getElementById('tracked').hasAttribute('ping')", 'the engine to strip the link\'s tracking ping');

    /* 3. Its signed report crosses the bridge to the worker. */
    const tabId = await evaluate(worker, `chrome.tabs.query({}).then((tabs) => (tabs.find((t) => String(t.url || '').startsWith(${JSON.stringify(pageUrl)})) || {}).id)`);
    assert(Number.isInteger(tabId), 'the page has a tab');
    const tallied = `chrome.runtime.sendMessage({ kind: 'site-dashboard', tabId: ${tabId} }).then((d) => JSON.stringify(d || {}).includes('stripped_link_ping'))`;
    await until(settings, tallied, 'the worker to count the stripped ping for the Site Dashboard');
    /* 4. An unlisted host loads, while a listed one is blocked. Edge can stop known trackers
       before DNR records a match, so testMatchOutcome also checks the shipped rule itself. */
    await until(worker, "chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => ids.includes('trackers'))", 'the shipped tracker ruleset to activate');
    const probe = async (host) => evaluate(page, `fetch('http://${host}:${serverPort}/probe-' + Date.now()).then((r) => 'loaded ' + r.status, (e) => 'blocked')`);
    assert.equal(await probe(CONTROL_HOST), 'loaded 200', 'an unlisted host still loads, so the test can tell a block from a broken page');
    let blocked = '';
    let matchedRule;
    for (const tracker of trackers) {
      const outcome = await evaluate(worker, `chrome.declarativeNetRequest.testMatchOutcome({ url: 'http://${tracker}:${serverPort}/probe-rule', initiator: ${JSON.stringify(pageUrl)}, type: 'xmlhttprequest', tabId: ${tabId} }).then((r) => r.matchedRules)`);
      const rule = outcome.find((item) => item.rulesetId === 'trackers');
      if (!rule || (await probe(tracker)) !== 'blocked') continue;
      blocked = tracker;
      matchedRule = rule;
      break;
    }
    assert(blocked, 'a listed tracker was blocked by the browser and matched by the shipped ruleset: tried ' + trackers.join(', '));
    assert(!hits.some((h) => h.startsWith(blocked + '/')), 'the blocked request never reached the server');

    /* 2b. The config the engine acts on is the one the bridge delivers, not its built-in defaults:
       switched off in Settings, the change reaches this open page, and a tracked link added after it
       keeps its ping; switched back on, the next one loses it. Done on the open page because at a
       page's start the engine falls back to its defaults if the worker has not answered within
       1.5 s, which a fresh load can lose to. */
    const addLink = (id) => evaluate(page, `(() => { const a = document.createElement('a'); a.id = ${JSON.stringify(id)}; a.href = '/next'; a.setAttribute('ping', '/ping-beacon'); a.textContent = 'More'; document.body.appendChild(a); return true; })()`);
    const kept = (id) => evaluate(page, `document.getElementById(${JSON.stringify(id)}).hasAttribute('ping')`);
    await evaluate(settings, "writeConfig({ unshimLinks: false }).then(() => true)");
    await until(page, 'window.__WO_CONFIG__ && window.__WO_CONFIG__.unshimLinks === false', 'the off switch to reach the page');
    await addLink('added-off');
    await sleep(800);
    assert(await kept('added-off'), 'with the switch off in Settings the engine still stripped a new link\'s ping, so the change never reached it');
    await evaluate(settings, "writeConfig({ unshimLinks: true }).then(() => true)");
    await until(page, 'window.__WO_CONFIG__ && window.__WO_CONFIG__.unshimLinks === true', 'the on switch to reach the page');
    await addLink('added-on');
    await until(page, "!document.getElementById('added-on').hasAttribute('ping')", 'the switch turned back on to reach the page');

    console.log('[ok] the page engine, the bridge, the worker and a shipped network rule all work on a real page in ' + browser.Browser
      + ' (blocked ' + blocked + ', ruleset ' + matchedRule.rulesetId + ')');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-engine-smoke-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
profile.mustFinish(run, 'browser-engine-smoke').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

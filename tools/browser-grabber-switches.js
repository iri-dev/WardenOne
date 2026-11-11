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
const PAGE_HOST = 'reader.wardenone-switch.example';
const LOGGER_HOST = 'iplogger.icu';
const image = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cases = [
  { name: 'all-off', resources: false, warnings: false, malware: false, imageBlocked: false, visit: 'allowed' },
  { name: 'resources-only', resources: true, warnings: false, malware: false, imageBlocked: true, visit: 'allowed' },
  { name: 'warnings-only', resources: false, warnings: true, malware: false, imageBlocked: false, visit: 'warning' },
  { name: 'malware-only', resources: false, warnings: false, malware: true, imageBlocked: false, visit: 'blocked' },
];

async function run() {
  const hits = [];
  const serverPort = await profile.freePort();
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    const url = new URL(req.url, `http://${host}:${serverPort}`);
    hits.push({ host, path: url.pathname, name: url.searchParams.get('case') });
    if (host === PAGE_HOST && url.pathname === '/page') {
      const src = `http://${LOGGER_HOST}:${serverPort}/image?case=${encodeURIComponent(url.searchParams.get('case') || '')}`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><title>Switch fixture</title><img id="probe" src="${src}">`);
    } else if (host === LOGGER_HOST && url.pathname === '/visit') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><title>Logger visit fixture</title>Reached the loopback server');
    } else if (host === LOGGER_HOST && url.pathname === '/image') {
      res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' });
      res.end(image);
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const browserPort = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-grabber-switches-'));
  const mapped = [PAGE_HOST, LOGGER_HOST].map((host) => 'MAP ' + host + ' 127.0.0.1').join(', ');
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(),
      'on', root, browserPort, dir, ['--host-resolver-rules=' + mapped]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, browserPort, version);
    await profile.closeExtensionTabs(cdp, browserPort, extension.id);
    const worker = extension.attachedSession;
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (session, expression, label) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try { if (await evaluate(session, expression)) return; } catch (_) {}
        await sleep(100);
      }
      throw new Error('Timed out waiting for ' + label);
    };
    assert(await evaluate(worker, `securityStoresReady().then(async () => {
      LEARNED[${JSON.stringify(LOGGER_HOST)}] = {
        firstSeen: Date.now(), hits: 1, reason: 'known IP-grabber behavior'
      };
      await localSet({ wardenone_learned: LEARNED });
      return (await applyLearnedRules()).ok === true;
    })`), 'legacy learned logger rule was installed');
    const learnedRuleId = await evaluate(worker, 'LEARNED_RULE_BASE');
    const openTab = async () => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      return sessionId;
    };
    const arrived = (host, path, name) => hits.some((hit) => hit.host === host && hit.path === path && hit.name === name);
    const assertNoOtherDecision = async (rules, expectedPack, label) => {
      const others = rules.filter((rule) => rule.rulesetId !== expectedPack
        && !(rule.rulesetId === '_dynamic' && rule.ruleId === learnedRuleId));
      const ids = others.filter((rule) => rule.rulesetId === '_session').map((rule) => rule.ruleId);
      const headerIds = ids.length ? await evaluate(worker,
        `chrome.declarativeNetRequest.getSessionRules({ ruleIds: ${JSON.stringify(ids)} })
          .then((items) => items.filter((item) => item.action.type === 'modifyHeaders').map((item) => item.id))`) : [];
      if (!others.every((rule) => rule.rulesetId === '_session' && headerIds.includes(rule.ruleId))) {
        const dynamicIds = others.filter((rule) => rule.rulesetId === '_dynamic').map((rule) => rule.ruleId);
        const dynamic = dynamicIds.length ? await evaluate(worker,
          `chrome.declarativeNetRequest.getDynamicRules({ ruleIds: ${JSON.stringify(dynamicIds)} })`) : [];
        const learned = await evaluate(worker,
          "chrome.storage.local.get('wardenone_learned').then((store) => store.wardenone_learned || {})");
        assert.fail(label + ' has an unrelated decision: ' + JSON.stringify({ rules, dynamic, learned }));
      }
    };

    for (const state of cases) {
      const config = { enabled: true, blockGrabberResources: state.resources,
        warnGrabberDomains: state.warnings, blockMalwareSites: state.malware,
        adShield: false, blockTrackers: false, trackerLearner: false, forceHttps: false };
      await evaluate(worker, `updateStoredConfig((cfg) => Object.assign(cfg, ${JSON.stringify(config)})).then(() => true)`);
      const expectedPacks = { grabbers: state.resources, grabber_navigation: state.warnings,
        grabber_malware_navigation: state.malware, adshield_easylist: false,
        trackers: false, easyprivacy: false };
      await until(worker, `chrome.declarativeNetRequest.getEnabledRulesets().then((ids) =>
        Object.entries(${JSON.stringify(expectedPacks)}).every(([id, enabled]) => ids.includes(id) === enabled))`,
      state.name + ' rulesets');
      const expectedTypes = (state.resources
        ? ['sub_frame', 'image', 'xmlhttprequest', 'script', 'ping', 'websocket'] : [])
        .concat(state.malware ? ['main_frame'] : []);
      await until(worker, `chrome.declarativeNetRequest.getDynamicRules({ ruleIds: [${learnedRuleId}] })
        .then((items) => JSON.stringify(items[0]?.condition.resourceTypes || [])
          === ${JSON.stringify(JSON.stringify(expectedTypes))})`, state.name + ' learned rule scope');

      const pageUrl = `http://${PAGE_HOST}:${serverPort}/page?case=${state.name}`;
      const imageUrl = `http://${LOGGER_HOST}:${serverPort}/image?case=${state.name}`;
      const visitUrl = `http://${LOGGER_HOST}:${serverPort}/visit?case=${state.name}`;
      const outcome = async (url, type) => evaluate(worker, `chrome.declarativeNetRequest.testMatchOutcome({
        url: ${JSON.stringify(url)}, initiator: ${JSON.stringify(pageUrl)}, type: ${JSON.stringify(type)}
      }).then((result) => result.matchedRules)`);
      const imageRules = await outcome(imageUrl, 'image');
      assert.equal(imageRules.some((rule) => (rule.rulesetId === 'grabbers' && rule.ruleId === 169)
        || (rule.rulesetId === '_dynamic' && rule.ruleId === learnedRuleId)),
      state.resources, state.name + ' image rule: ' + JSON.stringify(imageRules));
      await assertNoOtherDecision(imageRules, 'grabbers', state.name + ' image');
      const visitRules = await outcome(visitUrl, 'main_frame');
      const visitPack = state.visit === 'warning' ? 'grabber_navigation'
        : state.visit === 'blocked' ? 'grabber_malware_navigation' : '';
      assert.equal(visitRules.some((rule) => rule.rulesetId === visitPack
        || (state.visit === 'blocked' && rule.rulesetId === '_dynamic'
          && rule.ruleId === learnedRuleId)), !!visitPack,
        state.name + ' visit rule: ' + JSON.stringify(visitRules));
      await assertNoOtherDecision(visitRules, visitPack, state.name + ' visit');

      const imageTab = await openTab();
      await cdp.send('Page.navigate', { url: pageUrl }, imageTab);
      await until(imageTab, `location.href === ${JSON.stringify(pageUrl)} && document.readyState === 'complete'
        && document.getElementById('probe')?.complete`, state.name + ' image page');
      const width = await evaluate(imageTab, "document.getElementById('probe').naturalWidth");
      assert.equal(width === 0, state.imageBlocked, state.name + ' image load outcome');
      assert.equal(arrived(LOGGER_HOST, '/image', state.name), !state.imageBlocked,
        state.name + ' image server arrival');

      const visitTab = await openTab();
      await cdp.send('Network.enable', {}, visitTab);
      let blocked = false;
      const off = cdp.on((event) => {
        if (event.sessionId === visitTab && event.method === 'Network.loadingFailed'
            && /ERR_BLOCKED_BY_CLIENT/.test(String(event.params && event.params.errorText))) blocked = true;
      });
      const navigation = await cdp.send('Page.navigate', { url: visitUrl }, visitTab);
      if (state.visit === 'allowed') {
        await until(visitTab, `location.href === ${JSON.stringify(visitUrl)}
          && document.title === 'Logger visit fixture'`, state.name + ' direct visit');
      } else if (state.visit === 'warning') {
        const warningUrl = `chrome-extension://${extension.id}/ip-logger-warning.html`;
        await until(visitTab, `location.href === ${JSON.stringify(warningUrl)}
          && document.getElementById('status')?.textContent === 'Blocked before connecting'`,
        state.name + ' warning page');
      } else {
        const deadline = Date.now() + 5000;
        while (!blocked && Date.now() < deadline) await sleep(100);
        assert(blocked || /ERR_BLOCKED_BY_CLIENT/.test(String(navigation.errorText || '')),
          state.name + ' produced a browser-level blocked navigation: ' + JSON.stringify(navigation));
      }
      off();
      assert.equal(arrived(LOGGER_HOST, '/visit', state.name), state.visit === 'allowed',
        state.name + ' visit server arrival');
    }
    console.log('[ok] live IP-grabber switch requests and navigation in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, browserPort).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-grabber-switches-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

profile.mustFinish(run, 'browser-grabber-switches').catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

/* Browser requests stay on the loopback server. The extension-off pass proves
   the same hosts and image paths are reachable before the on pass checks blocks. */
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const PAGE_HOST = 'reader.wardenone-smoke.example';
const CLEAN_HOST = 'metrics.wardenone-smoke.example';
const SUSPECT_HOST = 'unlisted.wardenone-smoke.example';
const LOGGER_HOST = 'iplogger.icu';
const image = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(port, phase) {
  const logger = (name) => `http://${LOGGER_HOST}:${port}/${name}?phase=${phase}`;
  const clean = (name) => `http://${CLEAN_HOST}:${port}/${name}?phase=${phase}`;
  const suspicious = `http://${SUSPECT_HOST}:${port}/iplogger/abc1234567?phase=${phase}`;
  return `<!doctype html><meta charset="utf-8"><title>Image load check</title>
    <style>#css,#ordinary-css{width:20px;height:20px;background-size:cover}
      #css{background-image:url('${logger('css')}')}
      #ordinary-css{background-image:url('${clean('ordinary-css')}')}</style>
    <img id="direct" src="${logger('direct')}">
    <img id="srcset" src="${clean('fallback')}" srcset="${logger('srcset')} 1x">
    <div id="css"></div>
    <img id="redirect" src="${clean('redirect')}">
    <img id="ordinary" src="${clean('pixel.gif')}&uid=ordinary">
    <img id="ordinary-srcset" src="${clean('ordinary-fallback')}" srcset="${clean('ordinary-srcset')} 1x">
    <img id="ordinary-redirect" src="${clean('ordinary-redirect')}">
    <img id="suspicious" src="${suspicious}">
    <div id="ordinary-css"></div>`;
}

async function run() {
  const hits = [];
  const serverPort = await profile.freePort();
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    const url = new URL(req.url, `http://${host}:${serverPort}`);
    const phase = url.searchParams.get('phase') || '';
    hits.push({ host, path: url.pathname, phase });
    if (host === PAGE_HOST && url.pathname === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fixture(serverPort, phase));
    } else if (host === CLEAN_HOST && url.pathname === '/redirect') {
      res.writeHead(302, { location: `http://${LOGGER_HOST}:${serverPort}/redirect-target?phase=${phase}`,
        'cache-control': 'no-store' });
      res.end();
    } else if (host === CLEAN_HOST && url.pathname === '/ordinary-redirect') {
      res.writeHead(302, { location: `http://${CLEAN_HOST}:${serverPort}/ordinary-redirect-target?phase=${phase}`,
        'cache-control': 'no-store' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' });
      res.end(image);
    }
  });
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const mapped = [PAGE_HOST, CLEAN_HOST, SUSPECT_HOST, LOGGER_HOST]
    .map((host) => 'MAP ' + host + ' 127.0.0.1').join(', ');

  async function pass(variant, phase) {
    const port = await profile.freePort();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-logger-loads-'));
    let cdp;
    try {
      const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(),
        variant, root, port, dir, ['--host-resolver-rules=' + mapped]);
      cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
      await cdp.connect();
      let extension = null;
      if (variant === 'on') {
        const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
        extension = await profile.extensionReady(cdp, port, version);
        await profile.closeExtensionTabs(cdp, port, extension.id);
      }
      const pageUrl = `http://${PAGE_HOST}:${serverPort}/page?phase=${phase}`;
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      const evaluate = async (session, expression) => {
        const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      await cdp.send('Page.navigate', { url: pageUrl }, sessionId);
      const loaded = `location.href === ${JSON.stringify(pageUrl)} && document.readyState === 'complete'`;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !(await evaluate(sessionId, loaded))) await sleep(100);
      assert(await evaluate(sessionId, loaded), phase + ' page loaded at ' +
        await evaluate(sessionId, 'location.href'));
      await sleep(1200);
      const arrived = (host, path) => hits.some((hit) => hit.phase === phase && hit.host === host && hit.path === '/' + path);
      assert(arrived(PAGE_HOST, 'page'), phase + ' page reached the local server');
      assert(arrived(CLEAN_HOST, 'redirect'), phase + ' redirect source reached the local server');
      for (const path of ['pixel.gif', 'ordinary-css', 'ordinary-srcset', 'ordinary-redirect', 'ordinary-redirect-target']) {
        assert(arrived(CLEAN_HOST, path), phase + ' ordinary ' + path + ' loaded');
      }
      assert(arrived(SUSPECT_HOST, 'iplogger/abc1234567'), phase + ' unlisted suspicious image reached the server');
      assert(await evaluate(sessionId, "document.getElementById('ordinary').naturalWidth === 1"),
        phase + ' ordinary transparent pixel rendered');
      for (const id of ['ordinary-srcset', 'ordinary-redirect']) {
        assert(await evaluate(sessionId, `document.getElementById(${JSON.stringify(id)}).naturalWidth === 1`),
          phase + ' ' + id + ' rendered');
      }
      assert(await evaluate(sessionId, "document.getElementById('suspicious').naturalWidth === 1"),
        phase + ' unlisted suspicious image rendered');

      if (variant === 'off') {
        for (const path of ['direct', 'srcset', 'css', 'redirect-target']) {
          assert(arrived(LOGGER_HOST, path), 'extension-off ' + path + ' reached the server');
        }
        assert(await evaluate(sessionId, "document.getElementById('srcset').currentSrc.includes('/srcset')"),
          'the browser selected the logger srcset candidate');
      } else {
        for (const path of ['direct', 'srcset', 'css', 'redirect-target']) {
          assert(!arrived(LOGGER_HOST, path), 'protected ' + path + ' never reached the server');
        }
        const { sessionId: worker } = await cdp.send('Target.attachToTarget', {
          targetId: extension.workerTargetId, flatten: true,
        });
        await cdp.send('Runtime.enable', {}, worker);
        const tabId = await evaluate(worker, `chrome.tabs.query({}).then((tabs) => (tabs.find((tab) => tab.url === ${JSON.stringify(pageUrl)}) || {}).id)`);
        assert(Number.isInteger(tabId), 'protected page has a tab');
        const matched = await evaluate(worker, `chrome.declarativeNetRequest.getMatchedRules({ tabId: ${tabId} }).then((result) => result.rulesMatchedInfo.map((item) => item.rule))`);
        assert(matched.some((rule) => rule.rulesetId === 'grabbers' && rule.ruleId === 169),
          'Chrome attributes a real image block to the packaged logger rule');
        await sleep(1200);
        const notices = await evaluate(worker, `chrome.storage.local.get('wardenone_history').then((store) =>
          (store.wardenone_history || []).concat(__histBuffer || []).filter((item) => /grabber/.test(item.type || '')
            && item.detail && typeof item.detail === 'object')
            .map((item) => ({ type: item.type, matched: item.detail?.matched, status: item.detail?.status })))`);
        assert(!notices.some((item) => item.matched === CLEAN_HOST), 'ordinary pixels did not trigger an IP-logger alert');
        assert(notices.some((item) => item.type === 'warned_grabber_image'
          && item.matched === SUSPECT_HOST && item.status === 'observed_unconfirmed'),
        'the unlisted image was observed and reported as unconfirmed, not blocked');
      }
      return browser.Browser;
    } finally {
      if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
      const resolved = path.resolve(dir);
      if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-logger-loads-/.test(path.basename(resolved))) {
        try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
      }
    }
  }

  try {
    await pass('off', 'baseline');
    const browser = await pass('on', 'protected');
    console.log('[ok] real img, srcset, CSS and redirect logger loads blocked; ordinary pixels load and unlisted image warns in ' + browser);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

profile.mustFinish(run, 'browser-image-logger-loads').catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

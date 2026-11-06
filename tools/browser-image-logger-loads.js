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
const SELECTED_HOST = 'iplogger.selected-wardenone-smoke.test';
const UNSELECTED_HOST = 'iplogger.unselected-wardenone-smoke.test';
const FRAME_HOST = 'widget.cross-origin-wardenone-smoke.example';
const FRAME_SUSPECT_HOST = 'iplogger.frame-wardenone-smoke.test';
const FRAME_SRCSET_HOST = 'iplogger.frame-srcset-wardenone-smoke.test';
const FRAME_UNSELECTED_HOST = 'iplogger.frame-unselected-wardenone-smoke.test';
const FRAME_CSS_HOST = 'iplogger.frame-css-wardenone-smoke.test';
const ATTRIBUTE_HOST = 'iplogger.attribute-wardenone-smoke.example';
const SRCSET_HOST = 'iplogger.srcset-wardenone-smoke.example';
const LOGGER_HOST = 'iplogger.icu';
const image = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Every run is a fresh install, parsing every remote list in a worker Chrome keeps at Idle priority.
   When the machine is saturated Windows gives such a process a turn only about every 4.7 s, and
   frozen spells of over 30 s have been measured. Waits end when their answer arrives. */
const BUSY_BROWSER_MS = 90000;

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
    <img id="responsive-selected" srcset="http://${SELECTED_HOST}:${port}/selected?phase=${phase} 1x, ${clean('selected-2x')} 2x">
    <img id="responsive-unselected" srcset="${clean('unselected-1x')} 1x, http://${UNSELECTED_HOST}:${port}/unselected?phase=${phase} 2x">
    <img id="ordinary-redirect" src="${clean('ordinary-redirect')}">
    <img id="suspicious" src="${suspicious}">
    <img id="changed" src="${clean('changed-base')}">
    <img id="changed-srcset" src="${clean('srcset-base')}">
    <div id="ordinary-css"></div>
    <iframe id="widget" src="http://${FRAME_HOST}:${port}/frame?phase=${phase}"></iframe>`;
}

function frameFixture(port, phase) {
  const suspicious = (host, name) => `http://${host}:${port}/${name}?phase=${phase}&token=PRIVATE`;
  const clean = `http://${CLEAN_HOST}:${port}/frame-pixel?phase=${phase}`;
  return `<!doctype html><meta charset="utf-8"><title>Cross-origin image widget</title>
    <img id="frame-direct" src="${suspicious(FRAME_SUSPECT_HOST, 'frame-direct')}">
    <picture><source srcset="${suspicious(FRAME_SRCSET_HOST, 'frame-srcset')} 1x"><img src="${clean}"></picture>
    <img id="frame-unselected" srcset="${clean} 1x, ${suspicious(FRAME_UNSELECTED_HOST, 'frame-unselected')} 2x">
    <img id="frame-ordinary" src="${clean}">
    <div style="width:20px;height:20px;background-image:url('${suspicious(LOGGER_HOST, 'frame-css-known')}')"></div>
    <div id="frame-css" style="width:20px;height:20px"></div>
    <script>setTimeout(() => { document.getElementById('frame-css').style.backgroundImage =
      "url('${suspicious(FRAME_CSS_HOST, 'frame-css-unlisted')}')"; }, 100);</script>`;
}

function assertWarningResourceAccess(browserVersion, resource, stableUrl, resourceUrl, probes) {
  const major = Number(/\/(\d+)\./.exec(browserVersion)?.[1]);
  assert(Number.isInteger(major) && major > 0, 'unrecognised Chromium version: ' + browserVersion);
  // Chrome first enforced use_dynamic_url in 130; older versions retain fixed URLs.
  if (major >= 130) {
    assert.notEqual(resourceUrl, stableUrl, resource + ' has a session URL');
    assert.deepEqual(probes, [false, true], resource + ' rejects fixed-ID probes and permits its session URL');
  } else {
    assert.equal(resourceUrl, stableUrl, resource + ' uses the legacy fixed URL');
    assert.deepEqual(probes, [true, true], resource + ' remains accessible for warning redirects');
  }
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
    } else if (host === FRAME_HOST && url.pathname === '/frame') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(frameFixture(serverPort, phase));
    } else if ((host === PAGE_HOST && url.pathname === '/safe')
        || (host === LOGGER_HOST && url.pathname === '/visit')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><title>Navigation fixture</title><p>Local navigation check</p>');
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
  const mapped = [PAGE_HOST, CLEAN_HOST, SUSPECT_HOST, SELECTED_HOST, UNSELECTED_HOST,
    FRAME_HOST, FRAME_SUSPECT_HOST, FRAME_SRCSET_HOST, FRAME_UNSELECTED_HOST, FRAME_CSS_HOST,
    ATTRIBUTE_HOST, SRCSET_HOST, LOGGER_HOST]
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
      const crashed = [];
      cdp.on((message) => { if (message.method === 'Target.targetCrashed') crashed.push(message.params); });
      await cdp.send('Target.setDiscoverTargets', { discover: true });
      let extension = null;
      if (variant === 'on') {
        const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
        extension = await profile.extensionReady(cdp, port, version);
        await profile.closeExtensionTabs(cdp, port, extension.id);
      }
      const evaluate = async (session, expression) => {
        const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const arrived = (host, path) => hits.some((hit) => hit.phase === phase && hit.host === host && hit.path === '/' + path);
      /* Under extreme load a navigation into a new renderer has twice failed to commit, even minutes
         after the load stopped, with no cause found. If it recurs, say what the browser itself saw. */
      const browserState = async () => JSON.stringify({ crashed,
        targets: (await cdp.send('Target.getTargets')).targetInfos.map((target) => target.type + ' ' + target.url.slice(0, 70)),
        processes: (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map((item) => item.type) });
      const waitFor = async (session, expression, label) => {
        const deadline = Date.now() + BUSY_BROWSER_MS;
        while (Date.now() < deadline && !(await evaluate(session, expression))) await sleep(100);
        if (await evaluate(session, expression)) return;
        assert.fail(label + ' at ' + await evaluate(session, 'location.href') + ': ' + await browserState());
      };
      /* Only requests that must arrive. The fixed sleeps stay, so what must not arrive gets its full chance. */
      const waitForArrivals = async (expected) => {
        const deadline = Date.now() + BUSY_BROWSER_MS;
        while (Date.now() < deadline && !expected.every(([host, name]) => arrived(host, name))) await sleep(100);
        const missing = expected.filter(([host, name]) => !arrived(host, name)).map(([, name]) => name);
        if (missing.length) console.warn('still not requested: ' + missing.join(', ') + ' ' + await browserState());
      };
      const openTab = async (url) => {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Page.navigate', { url }, sessionId);
        return sessionId;
      };
      const navUrl = `http://${LOGGER_HOST}:${serverPort}/visit?phase=${phase}`;
      let activityTab = null;
      let warningAnswerGuards = null;
      if (variant === 'off') {
        const nav = await openTab(navUrl);
        await waitFor(nav, `location.href === ${JSON.stringify(navUrl)} && document.readyState === 'complete'`,
          'extension-off logger navigation loaded');
        assert(arrived(LOGGER_HOST, 'visit'), 'extension-off logger navigation reached the server');
      } else {
        const safeUrl = `http://${PAGE_HOST}:${serverPort}/safe?phase=${phase}`;
        const warningUrl = `chrome-extension://${extension.id}/ip-logger-warning.html`;
        const activityUrl = `chrome-extension://${extension.id}/history.html`;
        /* Late is allowed; any settled answer but this exact one fails at once. */
        const warningConfirmed = async (session, label) => {
          const deadline = Date.now() + BUSY_BROWSER_MS;
          let status = '';
          do {
            status = await evaluate(session, `location.href === ${JSON.stringify(warningUrl)}
              && document.getElementById('status')?.textContent || ''`);
            if (status && status !== 'Checking') break;
            await sleep(100);
          } while (Date.now() < deadline);
          assert.equal(status, 'Blocked before connecting', label + ' at ' + await evaluate(session, 'location.href'));
        };
        const nav = await openTab(safeUrl);
        await waitFor(nav, `location.href === ${JSON.stringify(safeUrl)} && document.readyState === 'complete'`,
          'safe page loaded before logger navigation');
        for (const resource of ['ip-logger-warning.html', 'ip-logger-warning.css', 'ip-logger-warning.js']) {
          const dynamicUrl = await evaluate(extension.attachedSession,
            `chrome.runtime.getURL(${JSON.stringify(resource)})`);
          const stableUrl = `chrome-extension://${extension.id}/${resource}`;
          const probes = await evaluate(nav, `Promise.all(${JSON.stringify([stableUrl, dynamicUrl])}.map(async (url) => {
            try { return (await fetch(url)).ok; } catch (_) { return false; }
          }))`);
          assertWarningResourceAccess(browser.Browser, resource, stableUrl, dynamicUrl, probes);
        }
        await cdp.send('Page.navigate', { url: navUrl }, nav);
        await warningConfirmed(nav, 'extension warning rendered');
        const rejected = await evaluate(nav, `Promise.all(['protection-health', 'content-config-get',
          'future-privileged-kind'].map((kind) => chrome.runtime.sendMessage({ kind })))`);
        assert(rejected.every((result) => result?.ok === false
          && result.error === 'Not allowed from this context.'), 'the public warning cannot use other message routes');
        const warning = await evaluate(nav, `(() => ({
          title: document.title,
          heading: document.getElementById('title')?.textContent,
          explanation: document.getElementById('explanation')?.textContent,
          host: document.getElementById('host')?.textContent,
          hostVisible: !document.getElementById('host-row')?.hidden,
          back: document.getElementById('back')?.textContent,
          activity: document.getElementById('activity')?.textContent,
          cardVisible: document.querySelector('main.card')?.getBoundingClientRect().width > 0,
        }))()`);
        assert.match(warning.title, /IP logger warning/);
        assert.equal(warning.heading, 'Possible IP logger detected');
        assert.match(warning.explanation, /before the destination could load/);
        assert.equal(warning.host, LOGGER_HOST);
        assert(warning.hostVisible && warning.cardVisible, 'warning and destination are visible');
        assert.equal(warning.back, 'Go back');
        assert.equal(warning.activity, 'View Activity Center');
        assert(!arrived(LOGGER_HOST, 'visit'), 'protected logger navigation never reached the server');
        await evaluate(nav, "document.getElementById('back').click(); true");
        await waitFor(nav, `location.href === ${JSON.stringify(safeUrl)}`, 'Go back returned to the safe page');
        await cdp.send('Page.navigate', { url: navUrl }, nav);
        await warningConfirmed(nav, 'warning rendered on a second visit');
        await evaluate(nav, "document.getElementById('activity').click(); true");
        await waitFor(nav, `location.href === ${JSON.stringify(activityUrl)} && document.readyState === 'complete'`,
          'View Activity Center opened history');
        activityTab = nav;
        assert(!arrived(LOGGER_HOST, 'visit'), 'neither protected navigation reached the server');
        /* Each of these was a genuine block that told the person it might not have worked. They run
           last so the worker state they change cannot reach the checks above. */
        warningAnswerGuards = async (worker) => {
          const openSafeTab = async () => {
            const tab = await openTab(safeUrl);
            await waitFor(tab, `location.href === ${JSON.stringify(safeUrl)} && document.readyState === 'complete'`, 'safe page loaded for a guard');
            return tab;
          };

          await evaluate(activityTab, 'history.back(); true');
          await warningConfirmed(activityTab, 'Back from Activity keeps the confirmed block');
          await evaluate(activityTab, 'window.__beforeReload = true; location.reload(); true');
          await waitFor(activityTab, "!window.__beforeReload && document.readyState === 'complete'", 'warning reloaded');
          await warningConfirmed(activityTab, 'reloading keeps the confirmed block');

          const budgetTab = await openSafeTab();
          await evaluate(worker, `(() => {
            while (DNR_FEEDBACK_READS.length < 19) DNR_FEEDBACK_READS.push({ at: Date.now(), purpose: 'event' });
            DNR_FEEDBACK_SNAPSHOT = null;
            return true;
          })()`);
          await cdp.send('Page.navigate', { url: navUrl }, budgetTab);
          await warningConfirmed(budgetTab, 'a block is confirmed with every read refused');

          /* The match read is the fallback, and Chrome files the match only at commit, so a read
             begun during a visit lacks it. Racing one would depend on how busy the worker is, so
             this leaves its exact state instead: a real read from before the visit, stamped as
             begun just after the request and kept current. */
          const readTab = await openSafeTab();
          assert(await evaluate(worker, `(async () => {
            DNR_FEEDBACK_READS.length = 0;
            globalThis.grabberRedirectStoppedRequest = () => false;
            const evidence = await readMatchedRuleEvidence({ requiredAt: Date.now() }, 'background');
            const stampRead = (details) => {
              if (!details.url.includes(${JSON.stringify('//' + LOGGER_HOST + ':')})) return;
              chrome.webRequest.onBeforeRequest.removeListener(stampRead);
              DNR_FEEDBACK_SNAPSHOT.startedAt = Math.ceil(details.timeStamp) + 1;
              DNR_FEEDBACK_SNAPSHOT.at = Date.now() + 10 * 60 * 1000;
            };
            chrome.webRequest.onBeforeRequest.addListener(stampRead, { urls: ['<all_urls>'], types: ['main_frame'] });
            return evidence.ok;
          })()`), 'the read that stands in for the race succeeded');
          await cdp.send('Page.navigate', { url: navUrl }, readTab);
          await warningConfirmed(readTab, 'a read begun before commit cannot deny a block');
        };
      }
      const pageUrl = `http://${PAGE_HOST}:${serverPort}/page?phase=${phase}`;
      const sessionId = await openTab(pageUrl);
      await waitFor(sessionId, `location.href === ${JSON.stringify(pageUrl)} && document.readyState === 'complete'`,
        phase + ' image page loaded');
      await sleep(1200);
      await waitForArrivals([[PAGE_HOST, 'page'], [CLEAN_HOST, 'redirect'], [CLEAN_HOST, 'pixel.gif'],
        [CLEAN_HOST, 'ordinary-css'], [CLEAN_HOST, 'ordinary-srcset'], [CLEAN_HOST, 'ordinary-redirect'],
        [CLEAN_HOST, 'ordinary-redirect-target'], [SUSPECT_HOST, 'iplogger/abc1234567'], [SELECTED_HOST, 'selected'],
        [FRAME_HOST, 'frame'], [FRAME_SUSPECT_HOST, 'frame-direct'], [FRAME_SRCSET_HOST, 'frame-srcset'],
        [FRAME_CSS_HOST, 'frame-css-unlisted'], [CLEAN_HOST, 'frame-pixel']]);
      assert(arrived(PAGE_HOST, 'page'), phase + ' page reached the local server');
      assert(arrived(CLEAN_HOST, 'redirect'), phase + ' redirect source reached the local server');
      for (const path of ['pixel.gif', 'ordinary-css', 'ordinary-srcset', 'ordinary-redirect', 'ordinary-redirect-target']) {
        assert(arrived(CLEAN_HOST, path), phase + ' ordinary ' + path + ' loaded');
      }
      assert(arrived(SUSPECT_HOST, 'iplogger/abc1234567'), phase + ' unlisted suspicious image reached the server');
      assert(arrived(SELECTED_HOST, 'selected'), phase + ' selected 1x image reached the server');
      assert(!arrived(UNSELECTED_HOST, 'unselected'), phase + ' unused 2x image stayed unrequested');
      assert(arrived(FRAME_HOST, 'frame'), phase + ' cross-origin widget loaded');
      assert(arrived(FRAME_SUSPECT_HOST, 'frame-direct'), phase + ' frame image reached the server');
      assert(arrived(FRAME_SRCSET_HOST, 'frame-srcset'), phase + ' frame srcset reached the server');
      assert(!arrived(FRAME_UNSELECTED_HOST, 'frame-unselected'), phase + ' unused frame 2x image stayed unrequested');
      assert(arrived(FRAME_CSS_HOST, 'frame-css-unlisted'), phase + ' unlisted frame CSS image reached the server');
      assert(arrived(CLEAN_HOST, 'frame-pixel'), phase + ' ordinary frame pixel loaded');
      assert(await evaluate(sessionId, "document.getElementById('ordinary').naturalWidth === 1"),
        phase + ' ordinary transparent pixel rendered');
      for (const id of ['ordinary-srcset', 'ordinary-redirect']) {
        assert(await evaluate(sessionId, `document.getElementById(${JSON.stringify(id)}).naturalWidth === 1`),
          phase + ' ' + id + ' rendered');
      }
      assert(await evaluate(sessionId, "document.getElementById('suspicious').naturalWidth === 1"),
        phase + ' unlisted suspicious image rendered');
      assert(await evaluate(sessionId, `document.getElementById('responsive-selected').currentSrc.includes(${JSON.stringify(SELECTED_HOST)})
        && !document.getElementById('responsive-unselected').currentSrc.includes(${JSON.stringify(UNSELECTED_HOST)})`),
      phase + ' browser selected the 1x candidates');
      const changedUrl = `http://${ATTRIBUTE_HOST}:${serverPort}/changed?phase=${phase}`;
      const changedSrcsetUrl = `http://${SRCSET_HOST}:${serverPort}/changed-srcset?phase=${phase}`;
      await evaluate(sessionId, `document.getElementById('changed').setAttribute('src', ${JSON.stringify(changedUrl)});
        document.getElementById('changed-srcset').setAttribute('srcset', ${JSON.stringify(changedSrcsetUrl + ' 1x')}); true`);
      await sleep(1200);
      await waitForArrivals([[ATTRIBUTE_HOST, 'changed'], [SRCSET_HOST, 'changed-srcset']]);
      assert(arrived(ATTRIBUTE_HOST, 'changed'), phase + ' changed image source reached the server');
      assert(arrived(SRCSET_HOST, 'changed-srcset'), phase + ' changed image srcset reached the server');

      if (variant === 'off') {
        for (const path of ['direct', 'srcset', 'css', 'redirect-target', 'frame-css-known']) {
          assert(arrived(LOGGER_HOST, path), 'extension-off ' + path + ' reached the server');
        }
        assert(await evaluate(sessionId, "document.getElementById('srcset').currentSrc.includes('/srcset')"),
          'the browser selected the logger srcset candidate');
      } else {
        for (const path of ['direct', 'srcset', 'css', 'redirect-target', 'frame-css-known']) {
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
        const readNotices = () => evaluate(worker, `chrome.storage.local.get('wardenone_history').then((store) =>
          (store.wardenone_history || []).concat(__histBuffer || []).filter((item) => /grabber/.test(item.type || '')
            && item.detail && typeof item.detail === 'object')
            .map((item) => ({ type: item.type, matched: item.detail?.matched,
              status: item.detail?.status, observation: item.detail?.observation, url: item.url })))`);
        let notices = [];
        const expected = [
          ['blocked_grabber_navigation', LOGGER_HOST], ['blocked_grabber_network', LOGGER_HOST],
          ...[SUSPECT_HOST, SELECTED_HOST, ATTRIBUTE_HOST, SRCSET_HOST,
            FRAME_SUSPECT_HOST, FRAME_SRCSET_HOST].map((host) => ['warned_grabber_image', host]),
        ];
        const noticeDeadline = Date.now() + BUSY_BROWSER_MS;
        do {
          notices = await readNotices();
          if (expected.every(([type, host]) => notices.some((item) => item.type === type && item.matched === host))) break;
          await sleep(100);
        } while (Date.now() < noticeDeadline);
        assert(notices.some((item) => item.type === 'blocked_grabber_navigation'
          && item.matched === LOGGER_HOST), 'the intercepted visit has a confirmed-block Activity entry: ' + JSON.stringify(notices));
        assert(notices.some((item) => item.type === 'blocked_grabber_network'
          && item.matched === LOGGER_HOST), 'the stopped image has a confirmed-block Activity entry: ' + JSON.stringify(notices));
        await waitFor(activityTab, `Array.from(document.querySelectorAll('#rows .row')).some((row) =>
          row.querySelector('.rtitle')?.textContent === 'IP-logging image request blocked' &&
          row.querySelector('.rmeta')?.textContent.includes(${JSON.stringify(LOGGER_HOST)}))`,
        'Activity Center rendered the confirmed image block');
        assert(!notices.some((item) => item.matched === CLEAN_HOST), 'ordinary pixels did not trigger an IP-logger alert');
        assert(notices.some((item) => item.type === 'warned_grabber_image'
          && item.matched === SUSPECT_HOST && item.status === 'observed_unconfirmed'),
        'the unlisted image was observed and reported as unconfirmed, not blocked');
        assert(notices.some((item) => item.type === 'warned_grabber_image'
          && item.matched === SELECTED_HOST && item.observation === 'image_selected_reference'),
        'the selected 1x candidate is recorded as selected');
        assert(!notices.some((item) => item.matched === UNSELECTED_HOST
          || item.matched === FRAME_UNSELECTED_HOST), 'unused 2x candidates did not warn');
        assert(!notices.some((item) => item.matched === FRAME_CSS_HOST),
          'an unlisted frame CSS image did not receive an image-element heuristic warning');
        for (const host of [ATTRIBUTE_HOST, SRCSET_HOST]) {
          assert(notices.some((item) => item.type === 'warned_grabber_image'
            && item.matched === host && item.status === 'observed_unconfirmed'),
          'an existing image changed to ' + host + ' was reported as unconfirmed: ' + JSON.stringify(notices));
        }
        for (const host of [FRAME_SUSPECT_HOST, FRAME_SRCSET_HOST]) {
          assert(notices.some((item) => item.type === 'warned_grabber_image'
            && item.matched === host && item.status === 'observed_unconfirmed'
            && (host !== FRAME_SRCSET_HOST || item.observation === 'image_selected_reference')
            && item.url === `https://${PAGE_HOST}/`),
          'cross-origin frame image ' + host + ' was reported as unconfirmed');
        }
        await warningAnswerGuards(worker);
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
    console.log('[ok] logger navigation warning, buttons, image blocks and Activity entries in ' + browser);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

profile.mustFinish(run, 'browser-image-logger-loads').catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

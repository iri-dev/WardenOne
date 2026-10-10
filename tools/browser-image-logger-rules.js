/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

/* Manual browser check for the packaged logger rules. Hypothetical requests do not
   contact the logger hosts, and Chromium evaluates the real shipped DNR rules. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-logger-rules-'));
  let cdp;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', root, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: extension.workerTargetId, flatten: true,
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const enabled = await evaluate("chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => ids.includes('grabbers'))");
    assert(enabled, 'the packaged grabbers ruleset is enabled');
    const outcome = async (url, type, initiator) => {
      const input = { url, type, initiator };
      const matched = await evaluate('chrome.declarativeNetRequest.testMatchOutcome('
        + JSON.stringify(input) + ').then((result) => result.matchedRules)');
      return matched.filter((rule) => rule.rulesetId === 'grabbers').map((rule) => rule.ruleId);
    };
    const crossSite = 'https://news.example/article';
    assert((await outcome('https://iplogger.icu/x', 'image', crossSite)).includes(169));
    assert((await outcome('https://iplogger.icu/x', 'main_frame', crossSite)).includes(168));
    assert((await outcome('https://tracker.iplocation.net/p/ABC123', 'image', crossSite)).includes(170));
    assert(!(await outcome('https://tracker.iplocation.net/assets/logo.png', 'image',
      'https://tracker.iplocation.net/')).includes(170), 'same-site dashboard images remain available');
    for (const route of ['t/ABC12345', 's/abc123']) {
      assert((await outcome('https://tracker.iplocation.net/' + route, 'main_frame', crossSite)).includes(171));
      assert((await outcome('https://tracker.iplocation.net/' + route, 'xmlhttprequest', crossSite)).includes(172));
    }
    for (const url of ['https://tracker.iplocation.net/',
      'https://tracker.iplocation.net/t/',
      'https://tracker.iplocation.net.evil.example/t/ABC12345',
      'https://www.iplocation.net/t/ABC12345']) {
      assert(!(await outcome(url, 'main_frame', crossSite)).includes(171), 'overbroad route: ' + url);
    }
    assert(!(await outcome('https://images.example/pixel.gif', 'image', crossSite)).includes(170));
    console.log('[ok] packaged image-logger DNR rules match reviewed hosts and routes in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-logger-rules-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}

profile.mustFinish(run, 'browser-image-logger-rules').catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* What a cold worker wake costs the browser's UI thread, in a disposable Edge profile.

   The worker stops after about thirty quiet seconds, and the next tab close, popup open or
   navigation starts it again. Whatever the wake asks of Chrome is answered on the UI thread --
   the thread that draws the tab strip and routes scrollbar drags -- so a wake that reads every
   dynamic rule (~22,000 once the lists are in) freezes the browser for a second while a tab
   closes. This waits for the lists, lets the worker sleep, then closes a tab and opens the popup,
   each on a sleeping worker, and fails on any UI-thread stall answering a rule-API call.

   Run: node tools/browser-cold-wake.js   (about three minutes; needs Edge and network access) */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Below this many dynamic rules the remote lists did not arrive, and a quiet wake proves nothing. */
const MIN_DYNAMIC_RULES = 5000;
const RULE_STALL_MS = 50;
const UI_STALL_BUDGET_MS = 300;

async function traceUiThread(cdp, action, windowMs) {
  const events = [];
  const off = cdp.on((msg) => { if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value); });
  await cdp.send('Tracing.start', { categories: 'toplevel,__metadata', transferMode: 'ReportEvents' });
  await sleep(200);
  await action();
  await sleep(windowMs);
  const done = new Promise((resolve) => { const o = cdp.on((msg) => { if (msg.method === 'Tracing.tracingComplete') { o(); resolve(); } }); });
  await cdp.send('Tracing.end');
  await done;
  off();
  const threads = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  const tasks = events.filter((e) => e.ph === 'X' && e.name === 'ThreadControllerImpl::RunTask' && threads[e.pid + ':' + e.tid] === 'CrBrowserMain');
  const long = tasks.filter((e) => e.dur >= 16000);
  const ruleStalls = long.filter((e) => /declarative_net_request/.test((e.args && e.args.src_file) || '') && e.dur >= RULE_STALL_MS * 1000);
  return {
    stallMs: Math.round(long.reduce((sum, e) => sum + e.dur, 0) / 1000),
    stalls: long.length,
    worstMs: Math.round(long.reduce((max, e) => Math.max(max, e.dur), 0) / 1000),
    ruleStalls: ruleStalls.map((e) => Math.round(e.dur / 1000)),
  };
}

async function run() {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>cold wake</title><p>' + 'A quiet page. '.repeat(120) + '</p>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-cold-wake-'));
  let cdp = null;
  const failures = [];
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const ruleCount = async () => {
      const value = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.declarativeNetRequest.getDynamicRules().then((rules) => rules.length)', awaitPromise: true, returnByValue: true,
      }, extension.attachedSession);
      return Number(value && value.result && value.result.value) || 0;
    };
    /* The install fetches the remote lists; wait until the rule count stops moving. */
    let rules = 0;
    let steadySince = Date.now();
    const listDeadline = Date.now() + 150000;
    while (Date.now() < listDeadline) {
      const now = await ruleCount();
      if (now !== rules) { rules = now; steadySince = Date.now(); }
      if (rules >= MIN_DYNAMIC_RULES && Date.now() - steadySince > 10000) break;
      await sleep(2000);
    }
    console.log(`  dynamic rules installed: ${rules}`);
    if (rules < MIN_DYNAMIC_RULES) throw new Error(`only ${rules} dynamic rules after the install: the remote lists did not arrive, so a cold wake here would not be representative`);

    const tabs = [];
    for (let i = 0; i < 3; i++) {
      const { targetId } = await cdp.send('Target.createTarget', { url: origin + '/page-' + i });
      tabs.push(targetId);
      await sleep(400);
    }
    await profile.closeExtensionTabs(cdp, port, extension.id);
    await sleep(3000);

    const scenarios = [
      ['closing a tab', () => cdp.send('Target.closeTarget', { targetId: tabs.pop() })],
      ['opening the popup', () => cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' })],
    ];
    for (const [label, action] of scenarios) {
      await profile.releaseWorker(cdp, extension);
      extension.attachedSession = null;
      const result = await traceUiThread(cdp, action, 5000);
      console.log(`  ${label} on a sleeping worker: UI thread ${result.stalls} stalls >= 16 ms, ${result.stallMs} ms in all, worst ${result.worstMs} ms; rule-API stalls ${result.ruleStalls.length ? result.ruleStalls.join(', ') + ' ms' : 'none'}`);
      if (result.ruleStalls.length) failures.push(`${label}: ${result.ruleStalls.length} UI-thread stall(s) answering a rule-API call (${result.ruleStalls.join(', ')} ms) -- a wake is reading rules it does not need`);
      if (result.stallMs > UI_STALL_BUDGET_MS) failures.push(`${label}: ${result.stallMs} ms of UI-thread stalls, over the ${UI_STALL_BUDGET_MS} ms budget`);
      await profile.closeExtensionTabs(cdp, port, extension.id);
    }
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('wo-cold-wake-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn('[warn] could not remove the temporary profile: ' + error.message); }
    }
  }
  if (failures.length) {
    for (const failure of failures) console.log('  FAIL ' + failure);
    process.exitCode = 1;
    return;
  }
  console.log('[ok] a cold wake leaves the browser UI thread free: no rule-API stalls closing a tab or opening the popup');
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

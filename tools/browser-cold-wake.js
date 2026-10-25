/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Cold wakes in disposable Edge: browser CPU, rule-task attribution and UI stalls.
   Remote feeds must load; no worker debugger is attached during a sample.
   Run options and measurement limits: docs/perf/README.md. */
const fs = require('fs');
const crypto = require('crypto');
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

function parseArgs(argv) {
  const options = { runs: 1, out: null, traceDir: null };
  const flags = new Map([['--runs', 'runs'], ['--out', 'out'], ['--trace-dir', 'traceDir']]);
  for (let i = 0; i < argv.length; i++) {
    const key = flags.get(argv[i]);
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('expected --runs <1-10>, --out <file>, or --trace-dir <directory>');
    options[key] = argv[++i];
  }
  options.runs = Number(options.runs);
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) throw new Error('--runs must be an integer from 1 to 10');
  return options;
}

function summariseTrace(events, browserPid) {
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(e.pid + ':' + e.tid, e.args.name);
  const tasks = events.filter((e) => e.pid === browserPid && e.ph === 'X'
    && (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'ThreadPool_RunTask') && Number.isFinite(e.dur) && e.dur >= 0);
  const ui = tasks.filter((e) => threads.get(e.pid + ':' + e.tid) === 'CrBrowserMain');
  if (![...threads.entries()].some(([key, name]) => key.startsWith(browserPid + ':') && name === 'CrBrowserMain')) {
    throw new Error('trace has no browser UI thread; refusing an empty stall result');
  }
  const long = ui.filter((e) => e.dur >= 16000);
  const isRuleTask = (e) => /declarative_net_request/.test((e.args && e.args.src_file) || '');
  const ruleTasks = new Map();
  for (const e of tasks.filter(isRuleTask)) {
    const thread = threads.get(e.pid + ':' + e.tid) || 'unknown';
    const source = e.args.src_file;
    const fn = e.args.src_func || 'unknown';
    const key = JSON.stringify([thread, source, fn]);
    const group = ruleTasks.get(key) || { thread, source, function: fn, tasks: 0, taskMs: 0 };
    group.tasks++;
    group.taskMs += e.dur / 1000;
    ruleTasks.set(key, group);
  }
  const round = (value) => Math.round(value * 100) / 100;
  return {
    stallMs: Math.round(long.reduce((sum, e) => sum + e.dur, 0) / 1000),
    stalls: long.length,
    worstMs: Math.round(long.reduce((max, e) => Math.max(max, e.dur), 0) / 1000),
    ruleStalls: long.filter((e) => isRuleTask(e) && e.dur >= RULE_STALL_MS * 1000).map((e) => Math.round(e.dur / 1000)),
    ruleUiTaskMs: round(ui.filter(isRuleTask).reduce((sum, e) => sum + e.dur, 0) / 1000),
    ruleBackgroundTaskMs: round(tasks.filter((e) => isRuleTask(e) && threads.get(e.pid + ':' + e.tid) !== 'CrBrowserMain')
      .reduce((sum, e) => sum + e.dur, 0) / 1000),
    ruleTasks: [...ruleTasks.values()].map((group) => ({ ...group, taskMs: round(group.taskMs) })),
  };
}

function browserProcess(info) {
  const browser = info.processInfo.find((item) => item.type === 'browser');
  if (!browser || !Number.isFinite(browser.id) || !Number.isFinite(browser.cpuTime)) throw new Error('browser process CPU counters unavailable');
  return browser;
}

async function traceUiThread(cdp, action, windowMs, tracePath) {
  const events = [];
  const off = cdp.on((msg) => { if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value); });
  try {
    await cdp.send('Tracing.start', { categories: 'toplevel,__metadata', transferMode: 'ReportEvents' });
    await sleep(200);
    const before = browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
    const started = Date.now();
    await action();
    await sleep(windowMs);
    const after = browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
    if (before.id !== after.id || after.cpuTime < before.cpuTime) throw new Error('browser process changed during measurement');
    const elapsedMs = Date.now() - started;
    const done = cdp.waitFor((msg) => msg.method === 'Tracing.tracingComplete', 30000);
    await Promise.all([cdp.send('Tracing.end'), done]);
    if (tracePath) {
      fs.mkdirSync(path.dirname(tracePath), { recursive: true });
      fs.writeFileSync(tracePath, JSON.stringify({ traceEvents: events }));
    }
    return { ...summariseTrace(events, before.id), elapsedMs, browserCpuMs: Math.round((after.cpuTime - before.cpuTime) * 1000) };
  } finally { off(); }
}

async function run(options) {
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
  const report = {
    measuredAt: new Date().toISOString(), version: JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version,
    backgroundSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'background.js'))).digest('hex'),
    machine: { platform: process.platform, release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length },
    scenarios: [], failures,
  };
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    report.browser = browser.Browser;
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
    report.dynamicRules = rules;
    if (rules < MIN_DYNAMIC_RULES) throw new Error(`only ${rules} dynamic rules after the install: the remote lists did not arrive, so a cold wake here would not be representative`);

    const tabs = [];
    for (let i = 0; i < options.runs + 2; i++) {
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
    for (let round = 1; round <= options.runs; round++) {
      for (const [label, action] of scenarios) {
        await profile.releaseWorker(cdp, extension);
        extension.attachedSession = null;
        const tracePath = options.traceDir && path.join(options.traceDir, round + '-' + (label === 'closing a tab' ? 'tab' : 'popup') + '.json');
        const result = await traceUiThread(cdp, action, 5000, tracePath);
        report.scenarios.push({ round, label, ...result });
        console.log(`  ${label} on a sleeping worker: UI thread ${result.stalls} stalls >= 16 ms, ${result.stallMs} ms in all, worst ${result.worstMs} ms; rule-API stalls ${result.ruleStalls.length ? result.ruleStalls.join(', ') + ' ms' : 'none'}`);
        console.log(`    browser CPU ${result.browserCpuMs} ms over ${result.elapsedMs} ms; rule tasks ${result.ruleUiTaskMs} ms UI / ${result.ruleBackgroundTaskMs} ms background`);
        if (result.ruleStalls.length) failures.push(`${label}: ${result.ruleStalls.length} UI-thread stall(s) answering a rule-API call (${result.ruleStalls.join(', ')} ms) -- a wake is reading rules it does not need`);
        if (result.stallMs > UI_STALL_BUDGET_MS) failures.push(`${label}: ${result.stallMs} ms of UI-thread stalls, over the ${UI_STALL_BUDGET_MS} ms budget`);
        await profile.closeExtensionTabs(cdp, port, extension.id);
      }
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
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  }
  if (failures.length) {
    for (const failure of failures) console.log('  FAIL ' + failure);
    process.exitCode = 1;
    return;
  }
  console.log('[ok] a cold wake leaves the browser UI thread free: no rule-API stalls closing a tab or opening the popup');
}

module.exports = { parseArgs, summariseTrace, browserProcess, traceUiThread };
if (require.main === module) {
  profile.mustFinish(() => run(parseArgs(process.argv.slice(2))), 'cold-wake profile')
    .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

const assert = require('assert');
const { parseArgs, summariseTrace, browserProcess, traceUiThread } = require('./browser-cold-wake.js');
const { mustFinish } = require('./perf-profile.js');

const metadata = (pid, tid, name) => ({ ph: 'M', name: 'thread_name', pid, tid, args: { name } });
const task = (tid, dur, rule = true, pid = 7) => ({ ph: 'X', name: tid === 2 ? 'ThreadPool_RunTask' : 'ThreadControllerImpl::RunTask', pid, tid, dur,
  args: { src_file: rule ? 'extensions/browser/api/declarative_net_request/declarative_net_request_api.cc' : 'other.cc', src_func: 'fixture' } });
const events = [metadata(7, 1, 'CrBrowserMain'), metadata(7, 2, 'ThreadPoolForegroundWorker'), metadata(8, 1, 'CrBrowserMain'),
  task(1, 15999), task(1, 16000, false), task(1, 49999), task(1, 50000), task(2, 110000), task(1, 900000, true, 8),
  { ...task(2, 110000), name: 'Edge_RunTask' }];

mustFinish(async () => {
  assert.deepStrictEqual(parseArgs([]), { runs: 1, out: null, traceDir: null });
  assert.deepStrictEqual(parseArgs(['--runs', '3', '--out', 'report.json', '--trace-dir', 'traces']),
    { runs: 3, out: 'report.json', traceDir: 'traces' });
  for (const args of [['--runs', '0'], ['--runs', '11'], ['--runs', '1.5'], ['--runs', 'NaN'], ['--out'], ['--unknown', 'x'], ['toString', 'x'], ['--out', '--runs', '2']]) {
    assert.throws(() => parseArgs(args));
  }
  const result = summariseTrace(events, 7);
  assert.strictEqual(result.stalls, 3, '16 ms is the UI-stall boundary');
  assert.strictEqual(result.stallMs, 116);
  assert.strictEqual(result.worstMs, 50);
  assert.deepStrictEqual(result.ruleStalls, [50], 'only browser UI rule tasks at least 50 ms fail the rule-stall check');
  assert.strictEqual(result.ruleUiTaskMs, 116, 'short rule work remains in attribution totals');
  assert.strictEqual(result.ruleBackgroundTaskMs, 110, 'background work is measured separately from UI stalls');
  assert.strictEqual(result.ruleTasks.length, 2);
  assert.strictEqual(result.ruleTasks[1].tasks, 1, 'Edge wrapper events cannot double-count thread-pool work');
  assert.strictEqual(result.ruleTasks[0].tasks, 3, 'other processes cannot inflate browser task counts');
  assert.throws(() => summariseTrace([metadata(8, 1, 'CrBrowserMain')], 7), /no browser UI thread/);
  assert.strictEqual(summariseTrace([metadata(7, 1, 'CrBrowserMain')], 7).stallMs, 0);
  assert.strictEqual(browserProcess({ processInfo: [{ id: 7, type: 'browser', cpuTime: 2 }] }).id, 7);
  for (const processInfo of [[], [{ id: 7, type: 'renderer', cpuTime: 2 }], [{ id: 7, type: 'browser' }]]) {
    assert.throws(() => browserProcess({ processInfo }), /CPU counters unavailable/);
  }

  const listeners = new Set();
  const calls = [];
  let snapshots = 0;
  const cdp = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    waitFor() { calls.push('wait'); return Promise.resolve({}); },
    async send(method) {
      calls.push(method);
      if (method === 'SystemInfo.getProcessInfo') return { processInfo: [{ id: 7, type: 'browser', cpuTime: 2 + snapshots++ / 4 }] };
      if (method === 'Tracing.end') for (const listener of listeners) listener({ method: 'Tracing.dataCollected', params: { value: events } });
      return {};
    },
  };
  const measured = await traceUiThread(cdp, async () => calls.push('action'), 0);
  assert.strictEqual(measured.browserCpuMs, 250, 'process CPU seconds become milliseconds');
  assert.strictEqual(measured.ruleBackgroundTaskMs, 110);
  assert(calls.indexOf('action') > calls.indexOf('SystemInfo.getProcessInfo'));
  assert(calls.indexOf('wait') < calls.indexOf('Tracing.end'), 'trace completion is observed before ending the trace');
  assert.strictEqual(listeners.size, 0);
  await assert.rejects(traceUiThread(cdp, async () => { throw new Error('action failed'); }, 0), /action failed/);
  assert.strictEqual(listeners.size, 0, 'failed measurements release the trace listener');
  console.log('[ok] cold-wake CPU, trace attribution, stall boundaries and fail-closed reporting');
}, 'cold-wake profile tests').catch((error) => { console.error(error); process.exitCode = 1; });

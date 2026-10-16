/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = background.indexOf('function createReconcileDnrBatch(kind) {');
const end = background.indexOf('\nfunction refreshExtensionState() {', start);
assert(start >= 0 && end > start, 'DNR batch helper exists');
const source = background.slice(start, end);

function harness(fail) {
  const calls = [];
  const timers = [];
  const update = async (kind, change) => {
    calls.push({ kind, change });
    if (fail && fail(kind, change)) throw new Error('simulated Chrome rejection');
  };
  const context = {
    chrome: { declarativeNetRequest: {
      updateDynamicRules: (change) => update('dynamic', change),
      updateSessionRules: (change) => update('session', change),
    } },
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at, 1); },
    Promise, Set, Error,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.make = createReconcileDnrBatch;', context);
  return { make: context.make, calls, timers, flushTimer: async () => { const timer = timers.shift(); assert(timer); await timer.fn(); await tick(); } };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const held = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
const change = (id) => ({ removeRuleIds: [id], addRules: [{ id }] });
process.exitCode = 1;
(async () => {
  let h = harness();
  let batch = h.make('session');
  const first = batch.collect((submit) => submit(change(10)));
  const gate = held();
  const second = batch.collect(async (submit) => { await gate.promise; return submit(change(20)); });
  await batch.seal();
  await tick();
  await tick();
  assert.strictEqual(h.calls.length, 0, 'an earlier plan waits across tasks for the delayed owner');
  assert.strictEqual(h.timers.length, 1, 'only a stalled-owner fallback is scheduled');
  assert.strictEqual(h.timers[0].delay, 5000);
  gate.release();
  await Promise.all([first, second]);
  assert.strictEqual(h.timers.length, 0, 'completed preparation cancels the fallback');
  assert.strictEqual(h.calls.length, 1, 'disjoint session bands merged into one Chrome call');
  assert.deepStrictEqual(Array.from(h.calls[0].change.removeRuleIds), [10, 20]);
  assert.deepStrictEqual(Array.from(h.calls[0].change.addRules, (rule) => rule.id), [10, 20]);
  await batch.submit({ removeRuleIds: [30], addRules: [{ id: 30 }] });
  assert.strictEqual(h.calls.length, 2, 'late plan applies directly instead of hanging');

  h = harness((_kind, change) => change.addRules.some((rule) => rule.id === 40));
  batch = h.make('dynamic');
  const rejected = batch.collect((submit) => submit(change(40)));
  const independent = batch.collect((submit) => submit(change(50)));
  const outcomes = Promise.allSettled([rejected, independent]);
  await batch.seal();
  const statuses = await outcomes;
  assert.strictEqual(statuses[0].status, 'rejected');
  assert.strictEqual(statuses[1].status, 'fulfilled');
  assert.strictEqual(h.calls.length, 3, 'combined failure falls back to separate owner writes');

  h = harness();
  batch = h.make('session');
  const overlapA = batch.collect((submit) => submit(change(60)));
  const overlapB = batch.collect((submit) => submit(change(60)));
  const overlapResults = Promise.allSettled([overlapA, overlapB]);
  await batch.seal();
  assert((await overlapResults).every((result) => result.status === 'rejected'));
  assert.strictEqual(h.calls.length, 0, 'overlapping owner IDs never reach Chrome or claim success');

  for (const [label, apply, expected] of [
    ['no-op', async () => true, 'fulfilled'],
    ['reported failure', async () => false, 'fulfilled'],
    ['read rejection', async () => { await tick(); throw new Error('read failed'); }, 'rejected'],
    ['synchronous error', () => { throw new Error('early failure'); }, 'rejected'],
  ]) {
    h = harness(); batch = h.make('dynamic');
    const results = Promise.allSettled([batch.collect((submit) => submit(change(70))), batch.collect(apply)]);
    await batch.seal();
    const states = await results;
    assert.strictEqual(states[0].status, 'fulfilled', label + ' cannot strand the other owner');
    assert.strictEqual(states[1].status, expected);
    assert.strictEqual(h.calls.length, 1);
  }

  h = harness(); batch = h.make('dynamic');
  const stalled = held();
  const immediate = batch.collect((submit) => submit(change(80)));
  const delayed = batch.collect(async (submit) => { await stalled.promise; return submit(change(90)); });
  await batch.seal();
  await h.flushTimer();
  await immediate;
  assert.strictEqual(h.calls.length, 1, 'a stalled owner cannot indefinitely hold prepared writes');
  stalled.release();
  await delayed;
  assert.strictEqual(h.calls.length, 2, 'the late owner still applies after the fallback closes the batch');

  h = harness(); batch = h.make('session');
  await batch.seal();
  assert.strictEqual(h.calls.length, 0, 'a generation with no changed owners performs no DNR work');
  assert.strictEqual(h.timers.length, 0);
  const refresh = background.slice(end, background.indexOf('let __refreshExtensionStateTimer', end));
  assert(/batch \? batch.collect\(apply\) : apply\(\)/.test(refresh), 'only changed owners register with their batch');
  assert(/dynamicBatch.seal\(\)[\s\S]*sessionBatch.seal\(\)[\s\S]*Promise.allSettled\(applied\)/.test(refresh),
    'both batches finish registration before waiting on commits');
  for (const [owner, kind] of [['fingerprintScripts', 'dynamic'], ['searchSponsoredAllow', 'dynamic'],
    ['allowlist', 'session'], ['mediaCompatibility', 'session'], ['loginCompatibility', 'session'], ['searchParams', 'session']]) {
    const line = refresh.split('\n').find((text) => text.includes("run('" + owner + "',"));
    assert(line && line.includes('(submitRules) =>') && line.trimEnd().endsWith(kind + 'Batch);'), owner + ' participates');
  }
  console.log('[ok] reconciler DNR batching and isolated fallback tests');
  process.exitCode = 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });

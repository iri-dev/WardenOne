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
    setTimeout: (fn) => { timers.push(fn); },
    Promise, Set, Error,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.make = createReconcileDnrBatch;', context);
  return { make: context.make, calls, timers, flushTimer: async () => { const fn = timers.shift(); assert(fn); fn(); await new Promise((resolve) => setTimeout(resolve, 10)); } };
}

(async () => {
  let h = harness();
  let batch = h.make('session');
  const first = batch.submit({ removeRuleIds: [10], addRules: [{ id: 10 }] });
  const second = batch.submit({ removeRuleIds: [20], addRules: [{ id: 20 }] });
  assert.strictEqual(h.timers.length, 1, 'one flush scheduled for the generation');
  await h.flushTimer();
  await Promise.all([first, second]);
  assert.strictEqual(h.calls.length, 1, 'disjoint session bands merged into one Chrome call');
  assert.deepStrictEqual(Array.from(h.calls[0].change.removeRuleIds), [10, 20]);
  assert.deepStrictEqual(Array.from(h.calls[0].change.addRules, (rule) => rule.id), [10, 20]);
  await batch.submit({ removeRuleIds: [30], addRules: [{ id: 30 }] });
  assert.strictEqual(h.calls.length, 2, 'late plan applies directly instead of hanging');

  h = harness((_kind, change) => change.addRules.some((rule) => rule.id === 40));
  batch = h.make('dynamic');
  const rejected = batch.submit({ removeRuleIds: [40], addRules: [{ id: 40 }] });
  const independent = batch.submit({ removeRuleIds: [50], addRules: [{ id: 50 }] });
  const outcomes = Promise.allSettled([rejected, independent]);
  await h.flushTimer();
  const statuses = await outcomes;
  assert.strictEqual(statuses[0].status, 'rejected');
  assert.strictEqual(statuses[1].status, 'fulfilled');
  assert.strictEqual(h.calls.length, 3, 'combined failure falls back to separate owner writes');

  h = harness();
  batch = h.make('session');
  const overlapA = batch.submit({ removeRuleIds: [60], addRules: [{ id: 60 }] });
  const overlapB = batch.submit({ removeRuleIds: [60], addRules: [{ id: 60 }] });
  const overlapResults = Promise.allSettled([overlapA, overlapB]);
  await h.flushTimer();
  assert((await overlapResults).every((result) => result.status === 'rejected'));
  assert.strictEqual(h.calls.length, 0, 'overlapping owner IDs never reach Chrome or claim success');
  console.log('[ok] reconciler DNR batching and isolated fallback tests');
})().catch((error) => { console.error(error); process.exitCode = 1; });

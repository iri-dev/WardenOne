/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('content.min.js', 'utf8');
function toastRuntime() {
  let now = 1000000;
  const timers = [], rendered = [];
  const start = source.indexOf('const showToast=');
  const end = source.indexOf(',renderToast=', start);
  assert(start >= 0 && end > start);
  const ruleStart = source.indexOf('notificationRuleId=type=>');
  const ruleEnd = source.indexOf(',notificationPreference=', ruleStart);
  const defaultsStart = source.indexOf('const NOTIFICATION_RULE_DEFAULTS=');
  const defaultsEnd = source.indexOf(',notificationRuleId=', defaultsStart);
  const box = {
    Date: { now: () => now }, Set, Object, Number, String, Math,
    WO: { enabled: true, showToasts: true }, lastToastAt: 0, toastGeneration: 0, recentKey: '', toastSeen: new Set(),
    TOAST_INFO: new Proxy({}, { get: (_object, type) => ({ why: String(type), severity: 'Notice', action: 'Fixture' }) }),
    notificationPreference: () => ({ mode: 'toast' }), shouldQuietToast: () => false,
    OWNED_TOAST_TYPES: new Set(JSON.parse(/OWNED_TOAST_TYPES=new Set\((\[[^\]]+\])\)/.exec(source)[1])),
    ACTIVE_BLOCK_TOAST_TYPES: new Set(['blocked_popup', 'blocked_gestureless_nav', 'blocked_meta_refresh', 'blocked_redirect_chain']),
    __woEmit() {}, __woBackgroundRequest() {}, __woSignedRequest: value => value,
    setTimeout: (fn, delay) => { timers.push({ fn, at: now + delay, delay }); return timers.length; },
    renderToast: type => { rendered.push({ type, at: now }); },
  };
  vm.createContext(box);
  vm.runInContext(source.slice(defaultsStart, defaultsEnd) + ';globalThis.notificationRuleId='
    + source.slice(ruleStart + 'notificationRuleId='.length, ruleEnd) + ';globalThis.showToast='
    + source.slice(start + 'const showToast='.length, end) + ';', box);
  return { box, rendered, timers, now: () => now, flush() {
    for (const timer of timers.filter(timer => timer.delay < 1000).sort((left, right) => left.at - right.at)) {
      now = timer.at; timer.fn();
    }
  } };
}
async function main() {
  const burst = toastRuntime();
  for (let index = 0; index < 100; index++) burst.box.showToast('detected_cookie_fixture_' + index, {});
  for (const type of ['warned_phishing', 'blocked_safe_browsing_link', 'blocked_popup', 'detected_manual_check']) {
    burst.box.showToast(type, {});
    assert.equal(burst.rendered.at(-1).type, type);
    assert.equal(burst.rendered.at(-1).at, burst.now(), type + ' must not wait behind the burst');
  }
  assert(burst.timers.every(timer => timer.delay <= 450 || timer.delay === 30000));
  burst.flush();
  assert.equal(burst.rendered.length, 104, 'distinct notices are scheduled without an accumulating seconds-long backlog');
  const canceled = toastRuntime();
  canceled.box.showToast('detected_cookie_fixture_1', {});
  canceled.box.showToast('detected_cookie_fixture_2', {});
  canceled.box.toastGeneration++;
  canceled.flush();
  assert.equal(canceled.rendered.length, 1, 'navigation cancels a queued notice from the previous page');

  const worker = fs.readFileSync('background.js', 'utf8');
  const link = fs.readFileSync('background-link-check.js', 'utf8');
  const lift = (text, signature) => { const start = text.indexOf(signature); return text.slice(start, text.indexOf('\n}\n', start) + 3); };
  let answerReputation, answerAge;
  const progress = [], deadlines = [];
  let ageStarted = false;
  const box = {
    Promise, Object, Number, Math, MANUAL_LINK_CHECK_TIMEOUT_MS: 30000,
    setTimeout: (fn, delay) => { deadlines.push({ fn, delay }); return deadlines.length; }, clearTimeout() {},
    urlReputationConfig: async () => ({ enabled: true }),
    urlReputationLookupUrl: () => new Promise(resolve => { answerReputation = resolve; }),
    lookupDomainAge: () => { ageStarted = true; return new Promise(resolve => { answerAge = resolve; }); },
    normalizeSafeBrowsingUrl: url => url, reputationQueryUrl: url => url,
  };
  vm.createContext(box);
  vm.runInContext(lift(link, 'function manualLinkWithin(') + '\n' + lift(worker, 'async function wardenHostFindings('), box);
  const pending = box.wardenHostFindings('example.com', 'https://example.com/', {}, lines => { progress.push([...lines]); });
  await new Promise(resolve => setImmediate(resolve));
  assert(ageStarted && answerReputation, 'registration starts while reputation is pending');
  answerAge({ ok: true, ageDays: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert(progress.some(lines => lines.some(line => /only 4 days/.test(line))), 'a completed result is delivered while another service waits');
  assert(deadlines.every(deadline => deadline.delay === 30000));
  deadlines[0].fn();
  const final = await pending;
  assert(final.some(line => /timed out/.test(line)) && final.some(line => /only 4 days/.test(line)));
  const beforeLate = progress.length;
  answerReputation({ ok: true, hit: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(progress.length, beforeLate, 'a late provider cannot replace the completed timeout result');
  console.log('[ok] warning priority, bounded burst delay, navigation cancellation and independent lookup progress');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

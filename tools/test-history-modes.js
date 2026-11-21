/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const vm = require('vm');
const { loadBackground } = require('./test-message-rate-limits.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function settle(h) {
  await sleep(30);
  h.ctx.flushHistory();
  await h.ctx.flushWardenNotifications();
  await h.ctx.WO_HISTORY.drain();
  await sleep(20);
}
async function run() {
  const h = loadBackground(); await sleep(100);
  const event = { type: 'blocked_popup', url: 'https://user:pass@site.example/reset/shortword?token=SECRET#fragment',
    detail: { why: 'Sent to https://site.example/login?token=SECRET', nested: { sourceUrl: 'site.example/recover/pin?secret=SECRET' }, access_token: 'SECRET' }, at: Date.now() };
  h.ctx.queueHistory(event); await settle(h);
  let saved = h.chrome.storage.local._data;
  assert.equal(saved.wardenone_history.length, 1);
  assert(!JSON.stringify(saved.wardenone_history).includes('SECRET'));
  assert(!JSON.stringify(saved.wardenone_notifications).includes('SECRET'));
  assert(!JSON.stringify(saved.wardenone_history).includes('shortword'));
  assert(!JSON.stringify(saved.wardenone_history).includes('user:pass'));
  assert.equal((await h.ctx.clearProtectionHistory(false, 'session')).ok, true);
  h.ctx.queueHistory(event); await settle(h);
  assert(!h.chrome.storage.local._data.wardenone_history);
  assert(!h.chrome.storage.local._data.wardenone_notifications);
  assert.equal(h.chrome.storage.session._data.wardenone_history.length, 1);
  assert.equal((await h.ctx.readProtectionHistory()).history.length, 1);
  h.ctx.queueHistory(event);
  assert.equal((await h.ctx.clearProtectionHistory()).ok, true);
  await settle(h);
  assert(!(await h.ctx.readProtectionHistory()).history.length, 'pending journal/notification jobs cannot restore cleared data');
  assert(!h.chrome.storage.session._data.__wardenone_hist_buffer);
  assert.equal((await h.ctx.clearProtectionHistory(false, 'off')).ok, true);
  h.ctx.queueHistory(event); await settle(h);
  for (const area of ['local', 'session']) for (const key of ['wardenone_history', 'wardenone_notifications', '__wardenone_hist_buffer'])
    assert(!h.chrome.storage[area]._data[key], 'off must not save ' + area + '/' + key);
  assert.equal(h.chrome.storage.local._data.wardenone_config.historyMode, 'off');
  assert.equal((await h.ctx.clearProtectionHistory(false, 'invalid')).ok, false);
  const sentinel = { wardenone_config: { historyMode: 'normal' },
    wardenone_history: [{ type: 'blocked_popup', url: 'https://sentinel.example/', at: Date.now() }],
    wardenone_notifications: [{ title: 'sentinel notice', at: Date.now() }] };
  const privateProfile = loadBackground({ incognito: true });
  Object.assign(privateProfile.chrome.storage.local._data, JSON.parse(JSON.stringify(sentinel)));
  privateProfile.chrome.storage.session._data.wardenone_history = sentinel.wardenone_history;
  await sleep(100);
  await privateProfile.ctx.WO_HISTORY.erase();
  assert.deepEqual(privateProfile.chrome.storage.local._data.wardenone_history, sentinel.wardenone_history,
    'a private window worker must not erase the regular profile history it shares storage.local with');
  assert.deepEqual(privateProfile.chrome.storage.local._data.wardenone_notifications, sentinel.wardenone_notifications);
  assert.deepEqual(privateProfile.chrome.storage.session._data.wardenone_history, sentinel.wardenone_history);
  /* "Clear history" pressed in a private window: the private worker leaves a request, and the normal profile's
     worker, which owns the history and its pending writes, clears it and answers. Saving the request is never
     reported as "cleared". */
  const answer = (value) => {
    for (const listener of privateProfile.chrome.storage.onChanged._l) listener({ wardenone_history_clear_result: { newValue: value } }, 'local');
  };
  const unanswered = await privateProfile.ctx.requestRegularHistoryClear(false, 30);
  assert.equal(unanswered.ok, false, 'with no answer yet, a private window does not claim the history is cleared');
  assert.equal(unanswered.pending, true, 'it says the clear is still waiting');
  assert.deepEqual(privateProfile.chrome.storage.local._data.wardenone_history, sentinel.wardenone_history,
    'the private worker leaves the shared history to the normal worker');
  const request = privateProfile.chrome.storage.local._data.wardenone_history_clear_request;
  assert.equal(request.observations, false);
  assert(typeof request.id === 'string' && request.id.length >= 8, 'each request carries its own id');
  const waiting = privateProfile.ctx.requestRegularHistoryClear(false, 2000);
  await sleep(10);
  answer({ id: privateProfile.chrome.storage.local._data.wardenone_history_clear_request.id, ok: true, at: Date.now() });
  assert.deepEqual(JSON.parse(JSON.stringify(await waiting)), { ok: true }, 'the normal worker\'s answer is what reports success');
  const failing = privateProfile.ctx.requestRegularHistoryClear(false, 2000);
  await sleep(10);
  answer({ id: privateProfile.chrome.storage.local._data.wardenone_history_clear_request.id, ok: false, error: 'disk full', at: Date.now() });
  assert.deepEqual(JSON.parse(JSON.stringify(await failing)), { ok: false, error: 'disk full' }, 'a failed clear is reported as a failure');
  const stale = privateProfile.ctx.requestRegularHistoryClear(false, 60);
  await sleep(10);
  answer({ id: 'another-request', ok: true, at: Date.now() - 60000 });
  assert.equal((await stale).pending, true, 'an older answer to another request does not count');
  const later = privateProfile.ctx.requestRegularHistoryClear(false, 2000);
  await sleep(10);
  answer({ id: 'a-newer-request', ok: true, at: Date.now() + 5 });
  assert.equal((await later).ok, true, 'a successful clear that finished after this request also answers it');
  for (const listener of privateProfile.chrome.storage.onChanged._l) {
    listener({ wardenone_history_clear_request: { newValue: { id: 'x', at: Date.now(), observations: false } } }, 'local');
  }
  await settle(privateProfile);
  assert.deepEqual(privateProfile.chrome.storage.local._data.wardenone_history, sentinel.wardenone_history,
    'a private worker never acts on the request itself');
  delete privateProfile.chrome.storage.local._data.wardenone_history;
  delete privateProfile.chrome.storage.local._data.wardenone_notifications;
  delete privateProfile.chrome.storage.session._data.wardenone_history;
  delete privateProfile.chrome.storage.local._data.wardenone_history_clear_request;
  privateProfile.ctx.queueHistory(event); await settle(privateProfile);
  assert(!privateProfile.chrome.storage.local._data.wardenone_history);
  assert(!privateProfile.chrome.storage.local._data.wardenone_notifications);
  assert(!privateProfile.chrome.storage.session._data.wardenone_history);
  const token = h.ctx.WO_HISTORY.epoch;
  await h.ctx.clearProtectionHistory(false, 'normal');
  await h.ctx.WO_HISTORY.write({ wardenone_history: [event] }, null, token);
  assert(!h.chrome.storage.local._data.wardenone_history, 'revoked generation cannot write after clear');
  h.ctx.queueHistory(event); await settle(h);
  assert.equal(h.chrome.storage.local._data.wardenone_history.length, 1);
  h.chrome.storage.local._data.wardenone_history_clear_request = { id: 'req-1', at: Date.now(), observations: false };
  for (const listener of h.chrome.storage.onChanged._l) {
    listener({ wardenone_history_clear_request: { newValue: { id: 'req-1', at: Date.now(), observations: false } } }, 'local');
  }
  await settle(h); await sleep(50);
  assert(!h.chrome.storage.local._data.wardenone_history, 'the normal worker clears its history when a private window asks');
  assert(!h.chrome.storage.local._data.wardenone_history_clear_request, 'and removes the request once done');
  assert.equal(h.chrome.storage.local._data.wardenone_history_clear_result.id, 'req-1', 'it answers that request by id');
  assert.equal(h.chrome.storage.local._data.wardenone_history_clear_result.ok, true);
  /* A clear that fails keeps the request for the next start and answers with the error. */
  const realClear = h.ctx.clearProtectionHistory;
  h.ctx.clearProtectionHistory = async () => ({ ok: false, error: 'disk full' });
  h.chrome.storage.local._data.wardenone_history_clear_request = { id: 'req-2', at: Date.now(), observations: false };
  await h.ctx.runRegularHistoryClearRequest({ id: 'req-2', at: Date.now(), observations: false });
  h.ctx.clearProtectionHistory = realClear;
  assert.equal(h.chrome.storage.local._data.wardenone_history_clear_request.id, 'req-2', 'a failed clear keeps the request to retry');
  assert.deepEqual(JSON.parse(JSON.stringify(h.chrome.storage.local._data.wardenone_history_clear_result)).ok, false);
  assert.equal(h.chrome.storage.local._data.wardenone_history_clear_result.error, 'disk full', 'and its answer says why');
  delete h.chrome.storage.local._data.wardenone_history_clear_request;
  const firewall = { 'site.example': { 'tracker.example': { all: 'block' } } };
  await h.chrome.storage.local.set({ wardenone_firewall: firewall, wardenone_site_tally: { 'site.example': {} },
    wardenone_script_drift_baselines: { stale: {} } });
  assert.equal((await h.ctx.clearProtectionHistory(true)).ok, true);
  assert.deepEqual(h.chrome.storage.local._data.wardenone_firewall, firewall);
  assert(!h.chrome.storage.local._data.wardenone_site_tally);
  assert(!h.chrome.storage.local._data.wardenone_script_drift_baselines);
  for (const area of ['local', 'session']) for (const key of Object.keys(h.chrome.storage[area]._data))
    assert(h.ctx.privacyPolicyForKey(key), 'observed write has no storage policy: ' + key);
  h.ctx.sessionMirror('wardenone_recent_redirect_chains', () => ({ host: 'erased.example' }), () => {}).persist();
  h.ctx.noteForgetTabHost(9999, 'erased.example');
  vm.runInContext('__privacyEraseInProgress=true', h.ctx);
  await h.chrome.storage.session.clear();
  await sleep(350);
  assert(!JSON.stringify(h.chrome.storage.session._data).includes('erased.example'), 'delayed site mirrors cannot restore erased session data');
  console.log('[ok] normal/session/off history, redaction, journal and notification erasure, revoked writers, stored choice and incognito');
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

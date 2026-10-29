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
  const privateProfile = loadBackground({ incognito: true }); await sleep(100);
  privateProfile.ctx.queueHistory(event); await settle(privateProfile);
  assert(!privateProfile.chrome.storage.local._data.wardenone_history);
  assert(!privateProfile.chrome.storage.local._data.wardenone_notifications);
  assert(!privateProfile.chrome.storage.session._data.wardenone_history);
  const token = h.ctx.WO_HISTORY.epoch;
  await h.ctx.clearProtectionHistory(false, 'normal');
  await h.ctx.WO_HISTORY.write({ wardenone_history: [event] }, null, token);
  assert(!h.chrome.storage.local._data.wardenone_history, 'revoked generation cannot write after clear');
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

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const SOURCE = fs.readFileSync('background-privacy-cleaner.js', 'utf8');
const BG = fs.readFileSync('background.js', 'utf8');
const HTML = fs.readFileSync('popup.html', 'utf8');
const UI = fs.readFileSync('popup-privacy-cleaner.js', 'utf8');
const SETTINGS = 'wardenone_cleaner_settings', STATE = 'wardenone_cleaner_state';
const copy = value => JSON.parse(JSON.stringify(value));

async function harness(options = {}) {
  const store = options.store || {}, alarms = new Map(), listeners = {}, calls = [];
  let now = options.now || Date.UTC(2026, 0, 31, 14), writes = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const ctx = { console, URL, crypto, Date: Clock, INCOGNITO_CONTEXT: !!options.private, __privacyEraseInProgress: false,
    SCRIPT_DRIFT_BASELINE_KEY: 'wardenone_script_drift_baselines',
    activeTabMatchesOrigin: async origin => options.inactive ? '' : origin,
    regDomainBg: host => host.split('.').slice(-2).join('.'),
    cleanConsentAndTrackingCookies: async filter => { calls.push({ consent: copy(filter) }); return { removed: 2, kept: 4, sites: 1, failed: 0 }; },
    resetSensitiveSitePermissionsGlobally: async () => { calls.push({ permissions: true }); return { reset: ['Camera'], failed: [] }; },
    clearProtectionHistory: async observations => { calls.push({ security: observations }); return { ok: true }; },
    clearTrackerLearnerObservations: async () => { calls.push({ learning: true }); },
    clearScriptDriftBaselines: async () => { calls.push({ removed: 'wardenone_script_drift_baselines' }); },
    showWardenSystemNotification: async () => { calls.push({ notify: true }); },
    chrome: { storage: { local: {
      async get(key) { return copy({ [key]: store[key] }); },
      async set(value) { writes++; if (options.failState && value[STATE]) throw Error('Disk full'); Object.assign(store, copy(value)); },
      async remove(key) { calls.push({ removed: key }); delete store[key]; },
    }, onChanged: event('storage') },
    browsingData: { async remove(filter, types) { calls.push({ filter: copy(filter), types: copy(types) });
      if (options.remove) await options.remove(filter, types);
      if (options.failType && types[options.failType]) throw Error('Unsupported type'); } },
    alarms: { onAlarm: event('alarm'), async create(name, info) { alarms.set(name, { scheduledTime: info.when }); },
      async get(name) { return alarms.get(name); }, async clear(name) { alarms.delete(name); } },
    runtime: { onStartup: event('startup') } } };
  vm.createContext(ctx); vm.runInContext(SOURCE, ctx);
  const api = ctx.WO_CLEANER;
  if (!options.private) await api.wake();
  return { api, store, calls, ctx, alarms, listeners, writes: () => writes, advance: ms => { now += ms; }, now: () => now };
}
async function run(h, types, extra = {}) {
  const preview = await h.api.preview({ types, sinceMs: 0, scope: 'all', ...extra });
  return h.api.run(preview.previewId);
}
async function main() {
  let h = await harness();
  const defaults = copy((await h.api.get()).config);
  assert.deepEqual(Object.keys(defaults.manualTypes).filter(k => defaults.manualTypes[k]), ['cache']);
  assert.equal(defaults.automatic.enabled, false); assert.equal(defaults.automatic.onStartup, false);
  assert.equal(h.writes(), 0, 'default cold starts do not write cleaner state');
  const config = copy(defaults); config.protectedOrigins = ['https://mail.example.com'];
  await h.api.save(config);
  const report = await run(h, { cache: true, cacheStorage: true, fileSystems: true, history: true, downloads: true });
  assert.equal(report.ok, true); assert.equal(report.completed.length, 5);
  for (const call of h.calls.filter(x => x.types)) {
    const global = call.types.history || call.types.downloads;
    assert.deepEqual(call.filter.excludeOrigins, global ? undefined : ['https://mail.example.com']);
    assert.equal(call.filter.origins, undefined);
  }
  assert(!h.calls.some(c => c.security || c.learning || c.removed), 'browser history must not erase WardenOne observations');
  await run(h, { consentCookies: true });
  assert.deepEqual(h.calls.find(c => c.consent).consent.protectedOrigins, ['https://mail.example.com']);
  const swept = h.calls.filter(c => c.consent).length;
  await run(h, { consentCookies: true, cookies: true });
  assert.equal(h.calls.filter(c => c.consent).length, swept, 'all-cookie cleanup subsumes name-based sweep');
  await assert.rejects(() => run(h, { cookies: true }, { scope: 'site', origin: 'https://shop.example.com' }), /protected/);
  await assert.rejects(() => run(h, { storage: true }, { scope: 'site', origin: 'https://mail.example.com' }), /protected/);
  await run(h, { cookies: true, storage: true }, { scope: 'site', origin: 'https://other.test' });
  assert.deepEqual(h.calls.filter(c => c.types).at(-1).filter.origins, ['https://other.test']);
  await assert.rejects(() => run(h, { history: true }, { scope: 'site', origin: 'https://other.test' }), /only/);
  await run(h, { securityHistory: true, trackerLearning: true, scriptDrift: true });
  assert(h.calls.some(c => c.security === false)); assert(h.calls.some(c => c.learning));
  assert(h.calls.some(c => c.removed === 'wardenone_script_drift_baselines'));
  for (const bad of [{ cache: 1 }, { passwords: true }, { cache: 'true' }, JSON.parse('{"__proto__":true}')]) await assert.rejects(() => run(h, bad));
  for (const site of ['file:///secret', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#a']) {
    await assert.rejects(() => h.api.save({ ...config, protectedOrigins: [site] }));
  }
  await assert.rejects(() => run(h, { cache: true }, { sinceMs: -1 }));
  let preview = await h.api.preview({ types: { cache: true }, sinceMs: 0, scope: 'all' });
  await h.api.run(preview.previewId); await assert.rejects(() => h.api.run(preview.previewId), /Preview expired/);
  preview = await h.api.preview({ types: { cache: true }, sinceMs: 0, scope: 'all' });
  await assert.rejects(() => h.api.save(config), /another window/);
  await h.api.save((await h.api.get()).config); await assert.rejects(() => h.api.run(preview.previewId), /Preview expired|settings changed/);
  preview = await h.api.preview({ types: { cache: true }, sinceMs: 0, scope: 'all' });
  h.advance(6 * 60000); await assert.rejects(() => h.api.run(preview.previewId), /expired/);
  h = await harness({ inactive: true });
  await assert.rejects(() => run(h, { cache: true }, { scope: 'site', origin: 'https://other.test' }), /Open/);
  h = await harness({ failType: 'fileSystems' });
  const partial = await run(h, { cache: true, fileSystems: true });
  assert.equal(partial.ok, false); assert.equal(partial.completed.length, 1); assert.equal(partial.failed.length, 1);
  assert.equal((await h.api.get()).history[0].ok, false);
  assert(!JSON.stringify(h.store[STATE]).includes('https://'), 'cleanup history contains no site addresses');
  h = await harness({ failState: true }); await assert.rejects(() => run(h, { cache: true }), /Disk/);
  assert.equal(h.calls.length, 0, 'a failed journal write prevents deletion');
  h = await harness();
  const auto = copy(defaults); auto.automatic.enabled = true; auto.automatic.onStartup = true; auto.automatic.notify = true;
  await h.api.save(auto); const next = h.store[STATE].nextRun;
  h.advance(next - h.now() + 2 * 86400000);
  await h.api.wake(); await h.api.wake(); await h.api.wake(true);
  assert.equal(h.calls.filter(c => c.types).length, 1, 'missed schedules and simultaneous startup coalesce');
  assert.equal(h.calls.filter(c => c.notify).length, 1); assert(h.store[STATE].nextRun > h.now());
  assert.equal(new Date(h.api.nextDate(Date.UTC(2026, 0, 31), 'monthly')).toISOString(), '2026-02-28T00:00:00.000Z');
  const store = copy(h.store); store[STATE].pending = { at: h.now(), source: 'scheduled', scope: 'all' };
  h = await harness({ store, now: store[STATE].pending.at + 60000 }); await h.api.wake(true);
  assert.equal(h.calls.length, 0, 'interrupted cleanup is not replayed by a simultaneous startup');
  assert.equal(store[STATE].history[0].ok, false); assert.match(store[STATE].history[0].failed[0], /interrupted/);
  await h.api.clearHistory(); assert.equal((await h.api.get()).history.length, 0);
  store[SETTINGS].protectedOrigins = ['broken origin']; await assert.rejects(() => h.api.wake());
  assert.equal(h.calls.length, 0, 'corrupt protection list prevents cleanup');
  h = await harness({ private: true }); await h.api.wake(true);
  await assert.rejects(() => h.api.get(), /normal/); assert.equal(h.calls.length, 0); assert.equal(h.writes(), 0);
  let unblock;
  h = await harness({ remove: () => new Promise(resolve => { unblock = resolve; }) });
  preview = await h.api.preview({ types: { cache: true }, sinceMs: 0, scope: 'all' });
  const running = h.api.run(preview.previewId); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => h.api.run(preview.previewId), /already running/);
  const drained = h.api.pauseAndDrain(); unblock(); await assert.rejects(() => running, /reset/); await drained;
  const definitions = (await (await harness()).api.get()).definitions;
  const fieldBlock = UI.slice(UI.indexOf('const fields ='), UI.indexOf('let config,'));
  for (const key of Object.keys(definitions)) {
    const id = fieldBlock.match(new RegExp('\\b' + key + ": '(cl-[a-z-]+)'"));
    assert(id, key + ' needs a control mapping'); assert(HTML.includes('id="' + id[1] + '"'));
  }
  for (const kind of ['clean-browser-preview', 'clean-browser', 'privacy-cleaner-save', 'privacy-cleaner-get', 'privacy-cleaner-clear-history']) {
    assert(BG.includes("msg.kind === '" + kind + "'"));
    const allowed = BG.slice(BG.indexOf('const TAB_CONTEXT_ALLOWED_MESSAGES'), BG.indexOf('const TAB_CONTEXT_RATE_LIMITS'));
    assert(!allowed.includes("'" + kind + "'"), kind + ' must be private UI only');
  }
  assert(!HTML.slice(HTML.indexOf('<h2>Privacy cleaner'), HTML.indexOf('<h2>Security Centre')).includes('Keeps you signed in'));
  assert(HTML.includes('src="popup-privacy-cleaner.js"'));
  console.log('[ok] cleaner defaults, controls, protected/site scope, separate records, partial results, schedules, interruption, private context and hostile settings');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

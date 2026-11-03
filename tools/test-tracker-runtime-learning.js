/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const { create } = require('./lib/tracker-learner-harness.js');
const utils = require('../tracker-learner-utils.js');
const ID = 'AHWqTUk3Jx9pQmZ0rT5vLs8nYw2bC4';
const SITES = ['one.example', 'two.example', 'three.example'];
function rig(extra = {}) {
  const r = create();
  r.state.local.wardenone_config = { enabled: true, trackerLearner: true, trackerLearnerAuto: true, ...extra };
  return r;
}
function frame(r, site, value = ID, extra = {}) {
  const documentId = 'frame-' + site;
  r.state.frames['1:0'] = { url: 'https://' + site + '/', documentId: 'top-' + site, parentFrameId: -1, documentLifecycle: 'active' };
  r.state.frames['1:2'] = { url: 'https://px.tracker.example/', documentId, parentFrameId: 0, parentDocumentId: 'top-' + site, documentLifecycle: 'active' };
  r.state.scriptValues[documentId] = [{ frameId: 2, documentId, result: { origin: 'https://px.tracker.example', values: [{ name: 'visitor_id', value }] } }];
  return { tabId: 1, frameId: 2, documentId, url: 'https://px.tracker.example/', ...extra };
}
const entry = r => r.api.learner().domains['tracker.example'];
async function storage(r, site, value = ID) { await r.api.storage(frame(r, site, value)); }
async function canvas(r, site, extra = {}) {
  const details = frame(r, site);
  await r.api.canvas({ tab: { id: 1 }, frameId: 2, documentId: details.documentId, url: details.url, origin: 'https://px.tracker.example', ...extra });
}
async function urlID(r, site, value = ID, extra = {}) {
  const details = frame(r, site);
  await r.api.identifierRequest({ ...details, frameId: 0, documentId: 'top-' + site, initiator: 'https://' + site,
    url: 'https://px.tracker.example/pixel?visitor_id=' + value, type: 'image', ...extra });
}
async function run() {
  for (const signal of utils.trustedSignals) assert.equal(utils.pageEvidence({ signal }), null);
  for (const source of ['canvas-fingerprint', 'local-storage', 'url-id']) {
    const forged = rig();
    for (const site of SITES) await forged.api.note('https://' + site, { domain: 'tracker.example', signal: source, verifiedSites: 3 });
    assert.equal(entry(forged), undefined, 'public page observations cannot supply ' + source);
  }
  const draw = rig();
  for (const site of SITES) await canvas(draw, site);
  assert.equal(entry(draw).automatic, 'block');
  assert.equal(entry(draw).sessions, 1);
  assert.equal(entry(draw).evidence.network, undefined, 'canvas is not mislabelled as a native network request');
  const saved = rig();
  for (const site of SITES) await storage(saved, site);
  assert.equal(entry(saved).automatic, 'block');
  assert.equal(saved.state.scriptCalls[0].world, 'ISOLATED');
  assert.deepEqual(Array.from(saved.state.scriptCalls[0].target.documentIds), ['frame-one.example']);
  assert(!JSON.stringify([saved.state.local, saved.state.session]).includes(ID), 'raw IDs never persist');
  assert(!JSON.stringify(saved.state.local).includes('one.example'), 'durable evidence has no visited sites');
  const suspended = rig();
  await storage(suspended, SITES[0]); await storage(suspended, SITES[1]);
  suspended.api.restart();
  await storage(suspended, SITES[2]);
  assert.equal(entry(suspended).automatic, 'block', 'worker suspension preserves session correlation');
  const partitioned = rig();
  for (let i = 0; i < SITES.length; i++) await storage(partitioned, SITES[i], ID + i);
  assert.equal(entry(partitioned).state, 'candidate', 'different IDs on each site cannot qualify');
  const restarted = rig();
  await storage(restarted, SITES[0]); await storage(restarted, SITES[1]); restarted.browserRestart();
  await storage(restarted, SITES[2]);
  assert.notEqual(entry(restarted).automatic, 'block', 'identifier correlation does not outlive a browser session');
  const onlyURL = rig();
  for (const site of SITES) await urlID(onlyURL, site);
  assert.equal(entry(onlyURL), undefined, 'arbitrary high-entropy query strings cannot poison learning');
  const urls = rig();
  urls.state.cookies['px.tracker.example'] = [{ name: 'IDE', value: ID, sameSite: 'no_restriction', session: false, expirationDate: (urls.state.now + 400 * 86400000) / 1000 }];
  for (const site of SITES) await urlID(urls, site);
  assert.equal(entry(urls).automatic, 'block');
  assert.equal(entry(urls).evidence['url-id'], 3);
  const mismatch = rig(); mismatch.state.cookies = urls.state.cookies;
  for (const site of SITES) await urlID(mismatch, site, ID + 'x');
  assert.equal(entry(mismatch), undefined, 'query IDs must match stored browser data');
  const storageURL = rig();
  await storage(storageURL, SITES[0]);
  for (const site of SITES) await urlID(storageURL, site);
  assert.equal(entry(storageURL).automatic, 'block', 'URL IDs may match a prior isolated storage observation');
  for (const extra of [{ enabled: false }, { trackerLearner: false }, { allowlist: ['one.example', 'two.example', 'three.example'] },
    { siteOverrides: Object.fromEntries(SITES.map(site => [site, { trackerLearner: false }])) }]) {
    const paused = rig(extra);
    for (const site of SITES) { await storage(paused, site); await canvas(paused, site); }
    assert.equal(entry(paused), undefined, 'disabled and paused sites do not contribute');
    assert.equal(paused.state.scriptCalls.length, 0, 'paused storage is never read');
  }
  const review = rig({ trackerLearnerAuto: false });
  for (const site of SITES) await canvas(review, site);
  assert.equal(entry(review).state, 'proposed', 'trusted single-session evidence may be reviewed');
  assert.equal(review.state.rules.length, 0, 'automatic mode remains opt-in');
  const stale = rig();
  stale.state.executeScript = async () => { stale.state.frames['1:2'].documentId = 'replacement'; return stale.state.scriptValues['frame-one.example']; };
  await storage(stale, SITES[0]); assert.equal(entry(stale), undefined, 'navigation races discard results');
  const wrong = rig();
  wrong.state.executeScript = async () => [{ frameId: 2, documentId: 'wrong', result: { origin: 'https://px.tracker.example', values: [{ name: 'visitor_id', value: ID }] } }];
  await storage(wrong, SITES[0]); assert.equal(entry(wrong), undefined, 'results are bound to the requested document');
  const erased = rig();
  erased.state.executeScript = async () => { await erased.api.clear(); return erased.state.scriptValues['frame-one.example']; };
  await storage(erased, SITES[0]); assert.equal(entry(erased), undefined, 'late reads cannot restore erased evidence');
  for (const site of SITES) await canvas(erased, site, { documentId: 'forged' });
  assert.equal(entry(erased), undefined, 'canvas cannot forge its browser document identity');
  const malformed = rig();
  for (const sites of [Infinity, 4, '3', 2.5, -1]) {
    const shaped = malformed.api.shape({ version: 5, domains: { 'tracker.example': { state: 'candidate', hits: 3,
      trustedSites: { 'canvas-fingerprint': { sites } } } } });
    assert.equal(shaped.domains['tracker.example']?.trustedSites?.['canvas-fingerprint'], undefined, 'invalid trusted counters are discarded');
  }
  const jarRace = rig();
  jarRace.context.chrome.cookies.getAll = async () => { await jarRace.api.clear(); return [{ name: 'IDE', value: ID,
    sameSite: 'no_restriction', session: false, expirationDate: (jarRace.state.now + 400 * 86400000) / 1000 }]; };
  await jarRace.cookieRequest(SITES[0], 'px.tracker.example');
  assert.equal(entry(jarRace), undefined, 'late cookie reads cannot restore erased evidence');
  for (const name of ['access_token', 'csrf', 'consent', 'session_id', 'password', '__proto__']) assert(!utils.identifyingStorageKey(name), name);
  for (const path of ['/oauth', '/login', '/checkout', '/payment']) assert.equal(utils.queryIdentifiers('https://tracker.example' + path + '?uid=' + ID).length, 0);
  assert.equal(utils.queryIdentifiers('https://user:pass@tracker.example/?uid=' + ID).length, 0);
  console.log('[ok] trusted runtime learning: canvas attribution, isolated storage, matching URL IDs, single-session thresholds, forged claims, partitions, suspension, races and erasure');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

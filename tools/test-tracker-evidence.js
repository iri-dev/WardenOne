/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const { create } = require('./lib/tracker-learner-harness.js');
async function main() {
  const rig = create(process.argv[2] ? { background: process.argv[2] } : {});
  const sites = ['first.example', 'second.example', 'third.example'];
  for (let session = 0; session < 2; session++) {
    for (const site of sites) await rig.api.note('https://' + site + '/', { domain: 'victim.example.net', signal: 'invented-signal', source: 'network', confidence: 'confirmed' });
    rig.browserRestart();
  }
  assert(!rig.api.learner().domains['example.net'], 'unknown attacker-controlled evidence must not create a proposal');
  const spoof = create();
  for (let session = 0; session < 2; session++) {
    for (const site of sites) await spoof.api.note('https://' + site + '/', { domain: 'telemetry.example.net', signal: 'tracking-path', source: 'curated-cname', canonicalTarget: 'stripe.com' });
    spoof.browserRestart();
  }
  assert.equal(spoof.api.proposals()[0]?.confidence, 'inferred');
  assert.equal(spoof.state.rules.length, 0, 'page claims never authorize automatic DNR rules');
  assert.equal(spoof.state.history.filter(row => row.type === 'proposed_tracker_domain').length, 1);
  assert(spoof.state.history.every(row => !row.url), 'learner history does not retain a first-party-to-tracker edge');
  const network = create();
  for (const site of sites) await network.network(site, 'a.trowow.de');
  assert.equal(network.api.learner().domains['etracker.com']?.sites, 3, 'browser-verified aliases count against the canonical service');
  assert.equal(network.api.proposals().length, 0, 'one browser session does not suffice');
  network.browserRestart();
  await network.network(sites[0], 'a.trowow.de');
  assert.equal(network.api.proposals()[0]?.domain, 'etracker.com');
  assert.equal(network.api.proposals()[0]?.confidence, 'corroborated');
  assert.equal(network.state.rules.length, 0);
  assert(!JSON.stringify(network.state.local).includes(sites[0]));
  assert(!JSON.stringify(network.state.local).includes('a.trowow.de'));
  await boundaries();
  await pressure();
  await failures();
  console.log('[ok] typed evidence, spoof resistance, CNAME network attribution and approval boundary');
}
async function boundaries() {
  for (const detail of [null, [], {}, { signal: '__proto__' }, { signal: 'network' }, { signal: 'tracking-path', domain: {} },
    { signal: 'tracking-path', domain: 'https://collector.net/path' }, { signal: 'tracking-path', domain: 'x'.repeat(9000) }]) {
    const rig = create(); await rig.api.note('https://first.example/', detail);
    assert.equal(Object.keys(rig.api.learner().domains).length, 0);
  }
  for (const override of [{ documentId: 'stale' }, { initiator: 'https://forged.example' }, { tabId: -1 },
    { frameId: 1 }, { type: 'main_frame' }, { url: 'file:///local' }, { url: 'https://a.trowow.de.attacker.test/' }]) {
    const rig = create(); await rig.network('first.example', 'a.trowow.de', override);
    assert.equal(Object.keys(rig.api.learner().domains).length, 0, JSON.stringify(override));
  }
  const rig = create();
  rig.state.frames['2:0'] = { url: 'https://top.example/', documentId: 'top', parentFrameId: -1, documentLifecycle: 'active' };
  rig.state.frames['2:1'] = { url: 'https://child.example/', documentId: 'child', parentFrameId: 0, parentDocumentId: 'top', documentLifecycle: 'active' };
  const sender = { tab: { id: 2, url: 'https://forged.example/' }, frameId: 1, documentId: 'child', origin: 'https://child.example' };
  await rig.api.page(sender, { domain: 'collector.net', signal: 'tracking-path', topUrl: 'https://forged.example/', canonicalTarget: 'stripe.com' });
  assert.equal((await rig.api.status('https://top.example/')).items.length, 1);
  assert.equal((await rig.api.status('https://child.example/')).items.length, 0);
  assert.equal((await rig.api.status('https://forged.example/')).items.length, 0);
  rig.state.frames['2:1'].parentDocumentId = 'previous-top';
  await rig.api.page(sender, { domain: 'other-collector.net', signal: 'tracking-path' });
  assert(!rig.api.learner().domains['other-collector.net']);
  rig.state.frames['2:1'].parentDocumentId = 'top'; rig.state.frames['2:1'].documentLifecycle = 'cached';
  await rig.api.page(sender, { domain: 'other-collector.net', signal: 'tracking-path' });
  assert(!rig.api.learner().domains['other-collector.net']);
  for (const config of [{ enabled: false }, { trackerLearner: false }, { allowlist: ['first.example'] },
    { siteOverrides: { 'first.example': { trackerLearner: false } } }]) {
    const off = create({ local: { wardenone_config: config } }); await off.network('sub.first.example', 'a.trowow.de');
    assert.equal(Object.keys(off.api.learner().domains).length, 0);
  }
  const sites = create();
  for (const host of ['a.tenant-one.github.io', 'b.tenant-one.github.io', 'tenant-two.github.io', 'tenant-three.github.io']) {
    await sites.api.note('https://' + host, { domain: 'collector.net', signal: 'tracking-path' });
  }
  assert.equal(sites.api.learner().domains['collector.net'].sites, 3, 'private tenants are separate, their subdomains are not');
  const idn = create();
  for (const host of ['bücher.de', 'xn--bcher-kva.de', 'sub.xn--bcher-kva.de']) {
    await idn.api.note('https://' + host, { domain: 'collector.net', signal: 'tracking-path' });
  }
  assert.equal(idn.api.learner().domains['collector.net'].sites, 1, 'IDN spellings normalize to one registrable site');
}
async function pressure() {
  const rig = create();
  await Promise.all(Array.from({ length: 500 }, () => rig.network('first.example', 'a.trowow.de')));
  assert.equal(rig.api.learner().domains['etracker.com'].hits, 1);
  rig.state.now += 86400000;
  await rig.network('first.example', 'a.trowow.de');
  assert.equal(rig.api.learner().domains['etracker.com'].hits, 2);
  assert.equal(rig.api.learner().domains['etracker.com'].sites, 1);
  assert.equal(rig.api.learner().domains['etracker.com'].sessions, 1, 'days and tab churn cannot spoof browser sessions');
  const full = create(); await full.api.load(); await new Promise(resolve => setImmediate(resolve));
  /* 600 observations fill the store; the one decision is held apart from that cap. */
  for (let i = 0; i < 601; i++) full.api.learner().domains['candidate-' + i + '.net'] = {
    state: i === 0 ? 'learned' : 'candidate', approvedAt: full.state.now, lastSeen: full.state.now,
    firstSeen: full.state.now, sites: 0, sessions: 0, hits: 1, signals: {}, evidence: {},
  };
  await full.api.note('https://first.example/', { domain: 'poisoned.net', signal: 'tracking-path' });
  assert(!full.api.learner().domains['poisoned.net']);
  await full.network('first.example', 'a.trowow.de');
  assert(full.api.learner().domains['etracker.com']);
  assert(full.api.learner().domains['candidate-0.net'], 'pressure preserves an explicit decision');
  assert.equal(Object.keys(full.api.learner().domains).length, 601, 'observations stay at their cap beside the decision');
  assert.equal(full.state.rules.length, 0, 'evidence admission never applies rules');
}
async function failures() {
  for (const failure of ['rejectNative', 'rejectStorage']) {
    const rig = create();
    for (const site of ['one.example', 'two.example', 'three.example']) await rig.network(site, 'a.trowow.de');
    rig.browserRestart(); await rig.network('one.example', 'a.trowow.de');
    const before = JSON.stringify(rig.state.local); rig.state[failure] = true;
    const decision = await rig.api.decide('etracker.com', 'block');
    assert.equal(decision.ok, false, failure);
    assert.equal(rig.api.learner().domains['etracker.com'].state, 'proposed');
    assert.equal(rig.state.rules.length, 0, 'native policy is unchanged or rolled back');
    assert.equal(JSON.stringify(rig.state.local), before);
    rig.state[failure] = false;
    assert.equal((await rig.api.decide('etracker.com', 'block')).ok, true);
    assert(rig.state.rules.length > 1, 'explicit approval covers confirmed aliases');
    assert.equal((await rig.api.setMode('https://one.example', 'etracker.com', 'allow')).ok, true);
    assert(rig.state.rules.some(row => row.action.type === 'allow' && row.condition.regexFilter));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

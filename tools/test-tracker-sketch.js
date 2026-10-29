/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const sketch = require('../tracker-learner-utils.js');
const { create } = require('./lib/tracker-learner-harness.js');
async function main() {
  const salt = '00112233445566778899aabbccddeeff';
  for (let i = 0; i < 500; i++) {
    const site = 'site-' + i + '.example';
    for (const initial of [undefined, 0]) {
      const first = sketch.add(initial, salt, site);
      assert(sketch.has(first, salt, site));
      assert.equal(sketch.add(first, salt, site), first, 'repeated membership is idempotent');
      assert.equal(typeof first, initial === undefined ? 'string' : 'number');
    }
  }
  const sites = ['news-alpha.example', 'shop-beta.example'];
  let legacy = 0;
  for (const site of sites) legacy = sketch.add(legacy, salt, site);
  const now = Date.UTC(2026, 9, 26);
  const old = { version: 3, salt, domains: {
    'collector.net': { sites: 2, marks: legacy, state: 'candidate', sessions: 1, hits: 2, firstSeen: now, lastSeen: now },
    'etracker.com': { sites: 3, state: 'learned', approvedAt: now, sessions: 2, hits: 4, firstSeen: now, lastSeen: now },
  }, siteControls: { 'shop.example': { allow: { 'etracker.com': now } } } };
  const rig = create({ local: { wardenone_tracker_learner: old } });
  await rig.api.load();
  let entry = rig.api.learner().domains['collector.net'];
  assert.equal(entry.marks, legacy, 'migration preserves legacy membership without inventing new bits');
  for (const site of sites) await rig.api.note('https://' + site + '/', { domain: 'collector.net', signal: 'tracking-path' });
  entry = rig.api.learner().domains['collector.net']; assert.equal(entry.sites, 2);
  assert(!rig.api.learner().domains['etracker.com'].cnameApproved, 'legacy approvals do not gain alias scope');
  assert(!rig.api.learner().siteControls['shop.example'].cname, 'legacy site choices do not gain alias scope');
  await rig.api.note('https://fresh.example/', { domain: 'fresh-collector.net', signal: 'tracking-path' });
  assert.match(rig.api.learner().domains['fresh-collector.net'].marks, /^[0-9a-f]{32}$/);
  const corrupt = rig.api.shape({ version: 4, salt, domains: { 'broken.net': { state: 'candidate', sites: 2, marks: 'malformed', sessions: 1, hits: 2 } } });
  assert.equal(corrupt.domains['broken.net'].sites, 0, 'invalid membership cannot preserve an unsupported distinct-site count');
  console.log('[ok] wide sketch membership, legacy continuation, invalid storage and unchanged historical decision scope');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

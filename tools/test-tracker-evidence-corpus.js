/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const path = require('path');
const corpus = require('./fixtures/tracker-evidence-corpus.json');
const { evaluate } = require('./bench-tracker-evidence.js');
async function main() {
  assert.equal(new Set(corpus.cases.map(row => row.id)).size, corpus.cases.length);
  const result = await evaluate(path.join(__dirname, '../background.js'), corpus.cases);
  const byId = Object.fromEntries(result.rows.map(row => [row.id, row]));
  for (const id of ['curated-ad-tracker', 'curated-analytics', 'fingerprint-library', 'confirmed-cloaked-tracker']) assert.equal(byId[id].confidence, 'corroborated', id);
  for (const id of ['federated-login', 'checkout-payment', 'video-cdn', 'shared-cdn-resource', 'shared-host-forged-signal', 'essential-analytics-forged-source', 'fake-cname-authority', 'site-scoped-feed-outside-its-site']) assert.equal(byId[id].proposed, false, id);
  assert.equal(byId['ambiguous-essential-analytics'].confidence, 'inferred', 'ambiguous proposals remain visibly unverified');
  assert.equal(byId['unlisted-tracker-without-page-evidence'].proposed, false, 'unlisted network hosts are not guessed');
  assert(result.rows.every(row => row.automaticRules === 0 && row.historySiteEdges === 0));
  console.log('[ok] calibrated positive/negative corpus, explicit remaining ambiguity, no automatic blocking or durable site edges');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

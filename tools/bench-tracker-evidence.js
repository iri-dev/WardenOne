/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { create } = require('./lib/tracker-learner-harness.js');
const corpusPath = path.join(__dirname, 'fixtures/tracker-evidence-corpus.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function evaluate(background, cases) {
  const result = { tp: 0, fp: 0, tn: 0, fn: 0, rows: [] };
  for (const item of cases) {
    const rig = create({ background });
    for (let session = 0; session < 2; session++) {
      if (session) rig.browserRestart();
      for (const site of ['first.example', 'second.example', 'third.example']) {
        if (item.kind === 'network') {
          if (rig.api.network) await rig.network(site, item.host, { type: item.type || 'xmlhttprequest' });
        } else await rig.api.note('https://' + site + '/', { domain: item.host, signal: item.signal, source: 'curated-feed', confidence: 'confirmed' });
      }
    }
    const proposal = rig.api.proposals()[0], proposed = !!proposal;
    result[item.positive ? proposed ? 'tp' : 'fn' : proposed ? 'fp' : 'tn']++;
    result.rows.push({ id: item.id, positive: item.positive, proposed,
      status: item.kind === 'network' && !rig.api.network ? 'unsupported' : proposed ? 'proposed' : 'not-proposed',
      confidence: proposal?.confidence || null, source: proposal?.source || null,
      automaticRules: rig.state.rules.length, localBytes: Buffer.byteLength(JSON.stringify(rig.state.local)),
      historySiteEdges: rig.state.history.filter(row => row.url).length });
  }
  result.precision = result.tp + result.fp ? result.tp / (result.tp + result.fp) : null;
  result.recall = result.tp / (result.tp + result.fn);
  return result;
}
async function main(baseline, out) {
  if (!baseline || !out) throw new Error('Use <baseline background.js> <output.json>');
  const bytes = fs.readFileSync(corpusPath), corpus = JSON.parse(bytes), current = path.join(__dirname, '../background.js');
  const report = { createdAt: new Date().toISOString(), corpusSha256: hash(bytes), baselineSha256: hash(fs.readFileSync(baseline)),
    candidateSha256: hash(fs.readFileSync(current)), toolSha256: hash(fs.readFileSync(__filename)),
    node: process.version, cpu: os.cpus()[0].model, scope: corpus.purpose, results: [] };
  for (const [build, source] of [['baseline', baseline], ['candidate', current]]) {
    const result = await evaluate(source, corpus.cases); report.results.push({ build, ...result });
    console.log(build, JSON.stringify({ tp: result.tp, fp: result.fp, tn: result.tn, fn: result.fn, precision: result.precision, recall: result.recall }));
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
}
module.exports = { evaluate };
if (require.main === module) main(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });

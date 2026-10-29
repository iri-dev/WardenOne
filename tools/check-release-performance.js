/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const {sha256} = require('./lib/privacy-baseline.js');
const {median,p90} = require('./perf-profile.js');
const POLICY = Object.freeze({minimumSamples:5,relativeVariance:0.25,observedSpreadMultiplier:2,metrics:['startupWallMs','browserCpuAtReadyMs','rendererHeapBytes','workerHeapBytes']});
function assess(report) {
  if(!report.complete)throw Error('Incomplete rematch');
  const rows=[];
  for(const metric of POLICY.metrics) {
    const samples=label=>report.runs.filter(r=>r.build===label&&r.complete).map(r=>r[metric]);
    const reference=samples('reference'),candidate=samples('candidate');
    for(const values of [reference,candidate])if(values.length<POLICY.minimumSamples||values.some(v=>!Number.isFinite(v)||v<=0))throw Error('Missing/invalid '+metric+' samples');
    const baseline=median(reference),spread=(p90(reference)-baseline)/baseline;
    const allowance=Math.max(POLICY.relativeVariance,POLICY.observedSpreadMultiplier*spread),ceiling=baseline*(1+allowance);
    rows.push({metric,reference,candidate,baselineMedian:baseline,baselineP90:p90(reference),relativeAllowance:allowance,ceiling,candidateMedian:median(candidate),pass:median(candidate)<=ceiling});
  }
  return {policy:POLICY,pass:rows.every(r=>r.pass),rows};
}
if(require.main===module) {
  try {const [input,out]=process.argv.slice(2);if(!input)throw Error('Usage: check-release-performance.js rematch.json [new-budget.json]');
    const bytes=fs.readFileSync(input),result={inputSha256:sha256(bytes),...assess(JSON.parse(bytes))};
    if(out){if(fs.existsSync(out))throw Error('Preserve the existing budget report');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
    console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={POLICY,assess};

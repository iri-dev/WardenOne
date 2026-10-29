/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const assert = require('assert/strict');
const {CORPUS,ACCEPTANCE,classify} = require('./browser-release-rematch.js');
const {median,p90} = require('./perf-profile.js');
const {assess} = require('./check-release-performance.js');
const {sha256} = require('./lib/privacy-baseline.js');
function summarize(report) {
  assert(report.complete,'incomplete comparison');
  assert.equal(report.measurementProtocol,2,'use equal readiness polling and warmed cosmetic caches');
  assert.deepEqual(report.corpus,CORPUS,'corpus changed');assert.deepEqual(report.acceptance,ACCEPTANCE,'acceptance changed');
  const groups={};
  for(const label of ['off','reference','candidate','privacybadger']) {
    const runs=report.runs.filter(r=>r.build===label);
    assert.equal(runs.length,5,label+' requires five samples');assert.equal(new Set(runs.map(r=>r.repetition)).size,5);
    for(const run of runs) {
      assert(run.complete);assert.deepEqual(run.scenarios.map(r=>r.name),CORPUS.map(r=>r.name));
      for(const [index,row] of run.scenarios.entries()) {
        for(const key of ['host','kind','role'])assert.equal(row[key],CORPUS[index][key],'fixture changed');
        assert(['allowed','blocked','stripped'].includes(row.status),'unexplained request failure');
        assert.equal(classify({received:row.received,failure:row.network?.failure,oldCookieSent:row.oldCookieSent,newCookieStored:row.newCookieStored}),row.status,'status lacks matching browser/server evidence');
      }
    }
    groups[label]={samples:5,requests:runs.map(r=>({blockedTrackers:r.scenarios.filter(s=>s.role==='tracker'&&s.status==='blocked').length,
      deliveredTrackers:r.scenarios.filter(s=>s.role==='tracker'&&s.received).length,
      trackerOutgoingCookieRemoved:r.scenarios.filter(s=>s.role==='tracker'&&s.received&&!s.oldCookieSent).length,
      trackerIncomingCookieRemoved:r.scenarios.filter(s=>s.role==='tracker'&&s.received&&!s.newCookieStored).length,
      controlRequestsBlocked:r.scenarios.filter(s=>s.role==='control'&&!s.received).length,
      controlCookiesChanged:r.scenarios.filter(s=>s.role==='control'&&s.status==='stripped').length})),
      compatibilityHostCookieExposure:runs.map(r=>r.scenarios.filter(s=>['authentication','payment'].includes(s.name)).map(s=>({name:s.name,received:s.received,outgoingCookie:s.oldCookieSent,incomingCookie:s.newCookieStored}))),
      compatibility:runs.every(r=>Object.values(r.compatibility).length===4&&Object.values(r.compatibility).every(v=>v===true)),
      recovery:runs.filter(r=>r.recovery).map(r=>r.recovery),
      resources:Object.fromEntries(['startupWallMs','browserCpuAtReadyMs','rendererHeapBytes','workerHeapBytes'].map(key=>{
        const values=runs.map(r=>r[key]).filter(Number.isFinite);return[key,values.length?{median:median(values),p90:p90(values),min:Math.min(...values),max:Math.max(...values)}:null];}))};
  }
  assert(groups.off.requests.every(r=>r.blockedTrackers===0&&r.deliveredTrackers===4&&r.trackerOutgoingCookieRemoved===0&&r.trackerIncomingCookieRemoved===0&&r.controlRequestsBlocked===0&&r.controlCookiesChanged===0),'negative controls failed');
  const a=groups.candidate,b=groups.privacybadger;
  const requestsValid=[a,b].every(g=>g.requests.every(r=>r.controlRequestsBlocked===0)&&new Set(g.requests.map(r=>r.blockedTrackers)).size===1);
  const score=g=>g.requests[0].blockedTrackers;
  const cookieCounts=g=>g.compatibilityHostCookieExposure.map(rows=>rows.reduce((n,r)=>n+Number(r.outgoingCookie)+Number(r.incomingCookie),0));
  const cookieCountsA=cookieCounts(a),cookieCountsB=cookieCounts(b);
  const cookieResourcesDelivered=[a,b].every(g=>g.compatibilityHostCookieExposure.every(rows=>rows.length===2&&rows.every(r=>r.received)));
  const cookieExposureWinner=cookieResourcesDelivered&&cookieCountsA.every((n,i)=>n>cookieCountsB[i])?'privacybadger':
    cookieResourcesDelivered&&cookieCountsB.every((n,i)=>n>cookieCountsA[i])?'candidate':
      cookieResourcesDelivered&&cookieCountsA.every((n,i)=>n===cookieCountsB[i])?'draw':'unscored';
  const rounds={requests:requestsValid&&Math.max(score(a),score(b))===CORPUS.filter(c=>c.role==='tracker').length?(score(a)===score(b)?'draw':score(a)>score(b)?'candidate':'privacybadger'):'unscored',
    cookies:'unscored: tracker requests were blocked; this corpus has no delivered tracker-cookie comparison',
    compatibilityHostCookieMinimization:cookieExposureWinner,
    detection:'unscored: tracker attribution was collected from Privacy Badger; equivalent WardenOne evidence was not collected',
    compatibility:a.compatibility&&b.compatibility?'draw':'unscored: inspect fixture failures',
    recovery:[a,b].every(g=>g.recovery.length===1&&Object.values(g.recovery[0]).every(v=>v===true))?'draw':'unscored',
    performance:'reported per metric; no cross-product winner because feature scope differs',
    privilegedMessages:'unscored: no matched page-reachable exploit demonstrated',sourceQuality:'unscored: exact Privacy Badger package/source correspondence not established'};
  return{groups,rounds,cookieScope:'Authentication fetch and payment script on an unrelated first-party page. Fewer cookies means lower exposure in this fixture. The OAuth/SAML checks do not depend on cookies and cannot establish whether cookie stripping preserves real sign-in or checkout.',performance:assess(report)};
}
if(require.main===module) {
  try {const [input,out]=process.argv.slice(2);if(!input)throw Error('Usage: summarize-release-rematch.js rematch.json [new-summary.json]');
    const bytes=fs.readFileSync(input),summary={inputSha256:sha256(bytes),...summarize(JSON.parse(bytes))};
    if(out){if(fs.existsSync(out))throw Error('Preserve the existing summary');fs.writeFileSync(out,JSON.stringify(summary,null,2)+'\n');}
    console.log(JSON.stringify(summary,null,2));
    if(!summary.performance.pass||!summary.groups.candidate.compatibility||summary.groups.candidate.requests.some(r=>r.controlRequestsBlocked))process.exitCode=1;
  }catch(error){console.error(error.stack||error);process.exitCode=1;}
}
module.exports={summarize};

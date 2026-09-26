/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What a wrapped sink costs (PERF-11).
 * Run: node tools/bench-xss-sinks.js [--calls N] [--json]
 *
 * The XSS Behavior Guard wraps innerHTML, setAttribute and the other page sinks and, after the
 * native call, correlates the assigned text with the page's mutable sources. This drives the
 * real shipped scanner (through the fake DOM of tools/test-xss-behavior-guard.js) with benign
 * and malicious inputs of 1, 8 and 64 KiB, on a page whose URL and window.name carry sources,
 * and reports the per-call median and p95 of each sink, plus the detections, so a change to
 * the hot path is measured rather than guessed at. The suite tools/test-xss-sink-cost.js
 * asserts the detections and the shape of the cost; this prints the numbers.
 */
'use strict';

const { run } = require('./test-xss-behavior-guard.js');

const args = process.argv.slice(2);
const CALLS = Math.max(50, Number((args[args.indexOf('--calls') + 1]) || 0) || 2000);
const JSON_OUT = args.includes('--json');

/* A page with sources: a query that reflects a payload shape, a benign parameter, a hash and a
   window.name -- the state of an ordinary app page after a marketing link, plus one hostile value. */
const PAGE = 'https://app.example.com/dashboard/reports?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&ref=sidebar-widget-a&utm_campaign=spring-launch-2026#section-overview';
const WINDOW_NAME = 'wo-bench-window-name-value';

function benignHtml(bytes) {
  const row = '<tr class="row"><td class="cell name">Quarterly report <em>draft</em></td><td class="cell num">1,234.56</td><td><a href="/reports/42" data-id="42">open</a></td></tr>';
  let out = '<table class="grid"><tbody>';
  while (out.length < bytes - 20) out += row;
  return out + '</tbody></table>';
}
function maliciousHtml(bytes) {
  /* the reflected payload buried in ordinary markup, past the first third so it is neither at
     the start nor beyond the guard's 65,536-character cut */
  const filler = benignHtml(Math.max(0, bytes - 80));
  const at = filler.indexOf('<tr', Math.floor(filler.length / 3));
  return filler.slice(0, at) + '<img src=x onerror=alert(1)>' + filler.slice(at);
}
const KB = 1024;
const INPUTS = [
  ['benign 1 KiB', benignHtml(1 * KB), false],
  ['benign 8 KiB', benignHtml(8 * KB), false],
  ['benign 64 KiB', benignHtml(64 * KB), false],
  ['malicious 1 KiB', maliciousHtml(1 * KB), true],
  ['malicious 8 KiB', maliciousHtml(8 * KB), true],
  ['malicious 64 KiB', maliciousHtml(64 * KB), true],
];

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* One realm per input, so the verdict cache of one input never warms another. `distinct` makes
   every call's value differ by a counter in a text node -- the render loop that never repeats a
   fragment -- so the memo cannot answer and the per-call analysis itself is what is timed. */
function measure(label, value, sink, calls, distinct) {
  const realm = run({ page: PAGE, windowName: WINDOW_NAME });
  const { Element, sandbox } = realm;
  const times = new Array(calls);
  const marker = sink === 'setAttribute' ? 'Quarterly' : '<em>draft</em>';
  for (let i = 0; i < calls; i++) {
    const element = new Element(sink === 'setAttribute' ? 'img' : 'div');
    element.isConnected = true;
    const v = distinct ? value.replace(marker, marker + ' ' + i) : value;
    const t0 = process.hrtime.bigint();
    if (sink === 'setAttribute') element.setAttribute('onerror', v);
    else element.innerHTML = v;
    times[i] = Number(process.hrtime.bigint() - t0) / 1e3; /* microseconds */
  }
  times.sort((a, b) => a - b);
  const activities = sandbox.__woBenchActivities || realm.logs.filter((e) => /^warned_potential_/.test(e.type)).length;
  return {
    label, sink, calls, bytes: value.length, distinct: !!distinct,
    medianUs: Math.round(quantile(times, 0.5) * 10) / 10,
    p95Us: Math.round(quantile(times, 0.95) * 10) / 10,
    maxUs: Math.round(times[times.length - 1] * 10) / 10,
    totalMs: Math.round(times.reduce((a, b) => a + b, 0) / 1000 * 10) / 10,
    detections: activities,
    warnings: realm.logs.filter((e) => e.type === 'behavioral_risk').length,
  };
}

function main() {
  const rows = [];
  for (const [label, value, malicious] of INPUTS) {
    for (const sink of ['innerHTML', 'setAttribute']) {
      /* an onerror attribute of 64 KiB is not a real shape; setAttribute is measured at 1 and 8 */
      if (sink === 'setAttribute' && value.length > 8 * KB) continue;
      for (const distinct of [false, true]) {
        const r = measure(label, value, sink, CALLS, distinct);
        r.malicious = malicious;
        rows.push(r);
      }
    }
  }
  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log('XSS sink wrappers, ' + CALLS + ' calls each, one realm per input (page carries a payload-shaped query, a benign query and a window.name)');
  console.log(['input', 'sink', 'values', 'bytes', 'median us', 'p95 us', 'max us', 'total ms', 'detections'].map((h) => h.padEnd(15)).join(''));
  for (const r of rows) {
    console.log([r.label, r.sink, r.distinct ? 'distinct' : 'repeated', String(r.bytes), String(r.medianUs), String(r.p95Us), String(r.maxUs), String(r.totalMs), String(r.detections)].map((v) => v.padEnd(15)).join(''));
  }
}

if (require.main === module) main();
module.exports = { measure, benignHtml, maliciousHtml, PAGE, WINDOW_NAME, INPUTS };

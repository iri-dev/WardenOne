/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The release performance profile harness, the parts that need no browser.
 * Run: node tools/test-perf-profile.js
 *
 * tools/perf-profile.js drives Microsoft Edge with the real extension loaded; that takes minutes
 * and a display, so the gate does not run it. What the gate checks here is everything around the
 * browser: the statistics that turn five runs into a median and a tail, the known-regression
 * patch applying to the built engine exactly once (so the "prove it sees a regression" variant
 * can be built), the synthetic pages having the shapes the measurements assume, the report
 * writer, and the fail-closed rules -- an "on" variant without the readiness marker must refuse
 * to measure. And that a profile of the current candidate exists in docs/perf and was produced
 * by a browser that had the extension loaded (PERF-12).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const harness = require('./perf-profile.js');
const SRC = fs.readFileSync(path.join(ROOT, 'tools', 'perf-profile.js'), 'utf8');

let failed = 0;
let passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* ---- statistics ---------------------------------------------------------------------------- */
check('the median of five is the third', harness.median([5, 1, 4, 2, 3]) === 3);
check('the median of four interpolates', harness.median([1, 2, 3, 4]) === 2.5);
check('p90 of five sits near the top', harness.p90([10, 20, 30, 40, 50]) === 46);
check('a non-number is ignored, not counted', harness.median([1, NaN, 3]) === 2);
check('an empty series is NaN, not zero', Number.isNaN(harness.median([])));
{
  const s = harness.summarise([3, 1, 2, 10, 2]);
  check('a summary keeps the raw values beside the medians', s.n === 5 && s.median === 2 && s.max === 10 && s.min === 1 && s.raw.length === 5);
}

/* ---- the known regression --------------------------------------------------------------- */
{
  const built = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
  let patched = null;
  let error = null;
  try { patched = harness.applyRegression(built, 'mutation-dedup'); } catch (e) { error = e; }
  check('the mutation-dedup regression applies to the built engine exactly once', !error && patched && patched !== built, error && error.message);
  check('and undoes the outermost-node filter', !!patched && patched.indexOf('if(added.length<2||!0)return{added:added,roots:added,structural:structural};') > 0);
  let threw = false;
  try { harness.applyRegression(built + built, 'mutation-dedup'); } catch (_) { threw = true; }
  check('an anchor that matches twice is refused rather than patched at random', threw);
  threw = false;
  try { harness.applyRegression(built, 'no-such-regression'); } catch (_) { threw = true; }
  check('an unknown regression name is refused', threw);
}

/* ---- the synthetic pages ------------------------------------------------------------------ */
{
  for (const p of harness.MEASURED_PAGES) check(p + ' is served', typeof harness.PAGES[p] === 'function');
  const article = harness.PAGES['/article.html']();
  check('the article carries cross-site links, a sign-in form and images -- the shapes the guards look at',
    /https:\/\/example\.net\//.test(article) && /type="password"/.test(article) && /<img /.test(article) && (article.match(/<a /g) || []).length > 300);
  check('every page signals __done so a run is waited on, not guessed', harness.MEASURED_PAGES.every((p) => /__done = true/.test(harness.PAGES[p]())));
  const churn = harness.PAGES['/churn.html']();
  check('the churn page builds a deep tree in-document, parent first -- the case the mutation-scan dedup is for',
    /app\.appendChild\(c\);/.test(churn) && /parent\.appendChild\(el\); if \(depth > 1\) grow\(el, depth - 1/.test(churn) && /grow\(c, 6, String\(batch\)\)/.test(churn)
    && churn.indexOf('app.appendChild(c)') < churn.indexOf('grow(c, 6'),
    'a subtree built off-document and appended once arrives as one added node and exercises nothing');
  check('the pages fetch nothing off the machine', harness.MEASURED_PAGES.concat(['/frame.html']).every((p) => !/src="https?:/.test(harness.PAGES[p]())));
  check('the long-task observer is buffered from document start', /buffered: true/.test(harness.LONGTASK_SCRIPT) && /addScriptToEvaluateOnNewDocument/.test(SRC));
}

/* ---- the report ---------------------------------------------------------------------------- */
{
  const run = (t) => ({ taskMs: t, scriptMs: t / 2, layoutMs: 1, styleMs: 1, longTasks: 0, longTaskMs: 0, dclMs: 5, loadMs: 6, heapAfterGcMB: 1, domNodes: 100, listeners: 1, workerTaskMs: NaN });
  const results = [
    { variant: 'off', pages: { '/article.html': { cold: [run(10), run(12), run(11)], warm: [run(5), run(5), run(6)] } } },
    { variant: 'on', pages: { '/article.html': { cold: [run(30), run(31), run(29)], warm: [run(8), run(9), run(8)] } } },
  ];
  const summary = harness.aggregate(results);
  check('the summary carries median, p90 and max per cell', summary.on['/article.html'].cold.taskMs.median === 30 && summary.on['/article.html'].cold.taskMs.max === 31);
  const d = harness.deltas(summary, 'off', 'on');
  check('the delta is on minus off, with a percentage', d['/article.html'].cold.taskMs.medianDelta === 19 && Math.round(d['/article.html'].cold.taskMs.pct) === 173, JSON.stringify(d['/article.html'].cold.taskMs));
  const md = harness.markdown({ meta: { commit: 'abc', dirty: false, extensionVersion: '1.0.1', browser: 'Edg/150', cpu: 'cpu', cores: 12, throttle: 1, runs: 3, date: 'now', variants: ['off', 'on'], readiness: { off: null, on: { extensionId: 'x'.repeat(32), workerVersion: '1.0.1', pageMarker: '1.0.1', workerMetrics: false } } }, summary, deltas: { on: d } });
  check('the markdown names the commit, the browser, the readiness evidence and the deltas', /commit `abc`/.test(md) && /Edg\/150/.test(md) && /page marker 1\.0\.1/.test(md) && /\+19 \(\+172\.73%\)/.test(md));
  check('a metric the browser could not provide is left out, not printed as NaN', !/NaN/.test(md));
}

/* ---- fail closed ---------------------------------------------------------------------------- */
check('an "on" variant refuses to measure without the readiness marker', /refusing to measure an extension that is not running/.test(SRC) && /seen !== expectedVersion/.test(SRC));
check('an "off" variant refuses to measure with WardenOne present', /the "off" variant has WardenOne in the page/.test(SRC));
check('the worker is found by its manifest, never by the first extension target', /manifest\.name === 'WardenOne'/.test(SRC) && /getManifest\(\)\.version/.test(SRC));
check('a wrong worker version is refused', /the loaded worker reports version/.test(SRC));
check('the pages are served from the loopback only', /listen\(0, '127\.0\.0\.1'/.test(SRC));
check('a fresh profile directory per variant, removed afterwards', /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'wardenone-perf-/.test(SRC) && /fs\.rmSync\(profileDir/.test(SRC));
check('the known-regression variant is built from the tracked files, never from the working tree wholesale', /git', \['ls-files'\]/.test(SRC));
check('a regression the harness cannot see fails the run', /the harness is not sensitive enough to serve as a gate/.test(SRC));

/* ---- a profile of this candidate exists, and was real ----------------------------------- */
{
  const dir = path.join(ROOT, 'docs', 'perf');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^profile-[0-9a-f]+(?:-x\d+)?\.json$/.test(f)) : [];
  check('a stored profile exists in docs/perf', files.length > 0, 'run node tools/perf-profile.js');
  for (const f of files) {
    let p = null;
    try { p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) {}
    check(f + ' is a profile with metadata, summaries, deltas and raw runs', !!p && p.meta && p.summary && p.deltas && p.raw && p.meta.commit && p.meta.browser && p.meta.extensionVersion);
    if (!p) continue;
    const on = p.meta.readiness && p.meta.readiness.on;
    check(f + ' was produced with the extension loaded and stamped in the page', !!on && on.pageMarker === p.meta.extensionVersion && /^[a-p]{32}$/.test(String(on.extensionId || '')));
    check(f + ' has the off variant without the extension', p.meta.readiness && Object.prototype.hasOwnProperty.call(p.meta.readiness, 'off') && !(p.meta.readiness.off && p.meta.readiness.off.pageMarker));
    check(f + ' has at least five runs per cell', p.meta.runs >= 5 && Object.values(p.raw.on || {}).every((page) => page.cold.length >= 5 && page.warm.length >= 5));
    check(f + ' has a markdown summary beside it', fs.existsSync(path.join(dir, f.replace(/\.json$/, '.md'))));
  }
}

if (failed) { console.error('\n' + failed + ' failed, ' + passed + ' passed'); process.exit(1); }
console.log('\nperf profile harness: ' + passed + ' checks passed');

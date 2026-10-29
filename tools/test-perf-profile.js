/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Check the performance harness’s argument handling and report generation without launching a browser.
   Run: node tools/test-perf-profile.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const harness = require('./perf-profile.js');
const SRC = fs.readFileSync(path.join(ROOT, 'tools', 'perf-profile.js'), 'utf8');
require('assert').equal(harness.parseArgs(['--fingerprint-noise','on']).fingerprintNoise,true);
require('assert').equal(harness.parseArgs(['--fingerprint-noise','off']).fingerprintNoise,false);
require('assert').throws(()=>harness.parseArgs(['--fingerprint-noise','unknown']));

let failed = 0;
let passed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

check('a trace run can use a separate output directory',
  harness.parseArgs(['--trace', '--trace-dir', 'docs/perf/traces/startup']).traceDir
    === 'docs/perf/traces/startup');
check('CPU sampling is an explicit trace option',
  harness.parseArgs(['--trace', '--cpu-profile']).cpuProfile === true
    && /--cpu-profile requires --trace/.test(SRC));
check('a profile can focus on the churn fixture',
  JSON.stringify(harness.parseArgs(['--pages', '/churn.html']).pages) === '["/churn.html"]');
check('a profile can focus on the player fixture',
  JSON.stringify(harness.parseArgs(['--pages', '/player.html']).pages) === '["/player.html"]');
check('a profile can focus on DOM churn beside an existing player',
  JSON.stringify(harness.parseArgs(['--pages', '/media-churn.html']).pages) === '["/media-churn.html"]'
    && /page !== '\/media-churn\.html'/.test(SRC));
check('a profile can focus on the article without a credential form',
  JSON.stringify(harness.parseArgs(['--pages', '/article-neutral.html']).pages) === '["/article-neutral.html"]');
check('an offline profile can use two immutable extension snapshots',
  harness.parseArgs(['--offline', '--candidate', 'candidate', '--baseline', 'reference']).offline === true
    && harness.parseArgs(['--candidate', 'candidate']).candidate === path.resolve('candidate')
    && harness.parseArgs(['--baseline', 'reference']).baseline === path.resolve('reference'));
check('the opt-in tracker policy can be profiled explicitly', harness.parseArgs(['--first-party-trackers']).firstPartyTrackers === true);
check('CNAME protection can be profiled independently', harness.parseArgs(['--cname-trackers']).cnameTrackers === true
  && harness.parseArgs(['--cname-trackers']).firstPartyTrackers !== true);
check('the same build can provide a CNAME-off baseline', harness.parseArgs(['--baseline-cname-off', '--cname-trackers']).baselineCnameOff === true
  && harness.parseArgs(['--baseline-cname-off', '--cname-trackers']).cnameTrackers === true);

async function checkLaunchScheduling() {
  const launches = [];
  const stop = new Error('stop after capturing the browser launch');
  const mockedModule = { exports: {} };
  const mockProcess = { ...process, env: { ...process.env, WARDENONE_SOFTWARE_GL: '0' } };
  vm.runInNewContext(SRC + '\nmodule.exports.runVariant = runVariant; freePort = async () => 9222;', {
    __dirname, module: mockedModule, process: mockProcess,
    require: (id) => {
      if (id === 'fs') return Object.assign({}, fs, {
        mkdtempSync: () => path.join(ROOT, 'mock-profile'), rmSync: () => {},
        existsSync: file => String(file).includes('mock-snapshot') || fs.existsSync(file),
      });
      if (id === 'child_process') return Object.assign({}, require(id), {
        spawn: (_browser, args) => { launches.push(Array.from(args)); return { unref() {} }; },
      });
      return require(id);
    },
    fetch: async () => ({ json: async () => ({ webSocketDebuggerUrl: 'ws://mock-browser' }) }),
    WebSocket: class { constructor() { throw stop; } },
  }, { filename: path.join(__dirname, 'perf-profile.js') });
  const mocked = mockedModule.exports;
  const timingFlags = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  const features = (args) => args.filter((arg) => arg.startsWith('--disable-features=')).at(-1).split('=')[1].split(',');
  await mocked.launch('mock-browser', 'on', ROOT, 9222, 'mock-profile');
  const shared = launches.pop();
  check('shared browser regressions keep normal background scheduling',
    timingFlags.every((flag) => !shared.includes(flag)) && !features(shared).includes('CalculateNativeWinOcclusion'));
  for (const variant of ['off', 'on']) {
    try { await mocked.runVariant(variant, { edge: 'mock-browser' }); }
    catch (error) { if (error !== stop) throw error; }
    const measured = launches.pop();
    check(variant + ' performance runs explicitly disable background throttling and occlusion',
      timingFlags.every((flag) => measured.includes(flag)) && features(measured).includes('CalculateNativeWinOcclusion'));
    check(variant + ' performance runs retain the shared Edge feature exclusions',
      features(shared).every((feature) => features(measured).includes(feature)));
  }
  for (const variant of ['base', 'on']) {
    const snapshot = path.join(ROOT, 'mock-snapshot-' + variant);
    try { await mocked.runVariant(variant, { edge: 'mock-browser', baseline: snapshot, candidate: snapshot, offline: true }); }
    catch (error) { if (error !== stop) throw error; }
    const measured = launches.pop();
    check(variant + ' profile loads the requested immutable snapshot', measured.includes('--load-extension=' + snapshot));
    check(variant + ' offline profile refuses remote DNS while retaining loopback',
      measured.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'));
  }
  check('performance metadata records its unthrottled scheduling', SRC.includes('backgroundThrottlingDisabled: true'));
  check('normal browser runs retain their native renderer', !shared.some(arg => /^--use-(gl|angle)=/.test(arg)));
  mockProcess.env.WARDENONE_SOFTWARE_GL = '1';
  mockProcess.env.WARDENONE_HEADLESS = '1';
  for (const variant of ['off', 'on']) {
    await mocked.launch('mock-browser', variant, ROOT, 9222, 'mock-profile');
    const args = launches.pop();
    check(variant + ' CI runs can select software ANGLE without disabling WebGL',
      ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader'].every(flag => args.includes(flag))
        && !args.includes('--disable-webgl') && !args.includes('--disable-gpu'));
  }
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
  check('and undoes the outermost-node filter', !!patched && patched.indexOf('if(added.length<2||!0)return{added:added,roots:added,structural:structural,sourceOnly:sourceOnly};') > 0);
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
  const neutral = harness.PAGES['/article-neutral.html']();
  check('the neutral article keeps the same body without the loopback credential warning',
    !/<form|type="password"/.test(neutral) && /https:\/\/example\.net\//.test(neutral)
      && (neutral.match(/<img /g) || []).length === (article.match(/<img /g) || []).length);
  check('every page signals __done so a run is waited on, not guessed', harness.MEASURED_PAGES.every((p) => /__done = true/.test(harness.PAGES[p]())));
  const churn = harness.PAGES['/churn.html']();
  check('the churn page builds a deep tree in-document, parent first -- the case the mutation-scan dedup is for',
    /app\.appendChild\(c\);/.test(churn) && /parent\.appendChild\(el\); if \(depth > 1\) grow\(el, depth - 1/.test(churn) && /grow\(c, 6, String\(batch\)\)/.test(churn)
    && churn.indexOf('app.appendChild(c)') < churn.indexOf('grow(c, 6'),
    'a subtree built off-document and appended once arrives as one added node and exercises nothing');
  const player = harness.PAGES['/player.html']();
  const mediaChurn = harness.PAGES['/media-churn.html']();
  check('player churn uses the same nested additions beside an existing control shell',
    /data-player/.test(mediaChurn) && /aria-label="Volume"/.test(mediaChurn)
      && /grow\(c, 6, String\(batch\)\)/.test(mediaChurn) && /__done = true/.test(mediaChurn)
      && !/data-player/.test(churn));
  check('the focused player page pins a control shell under the badge on a large DOM',
    /id="player" data-player/.test(player) && /position:fixed;right:0;bottom:0/.test(player)
      && (player.match(/class="row"/g) || []).length === 5000 && /__done = true/.test(player));
  check('the pages fetch nothing off the machine', harness.MEASURED_PAGES.concat(['/frame.html']).every((p) => !/src="https?:/.test(harness.PAGES[p]())));
  check('the heavy frame fixture covers thirty child documents',
    (harness.PAGES['/frames-heavy.html']().match(/<iframe /g) || []).length === 30
      && /let left = 30;/.test(harness.PAGES['/frames-heavy.html']()));
  const imageFrames = harness.PAGES['/image-frames.html']();
  const imageFrame = harness.PAGES['/image-frame.html']();
  check('the focused image fixture has eight child frames and waits for their churn',
    (imageFrames.match(/<iframe /g) || []).length === 8 && /__frameDone === true/.test(imageFrames)
      && /window\.__done = true/.test(imageFrames));
  check('each child changes src and srcset and adds image subtrees in twelve batches',
    /i < 64/.test(imageFrame) && /setAttribute\("src"/.test(imageFrame)
      && /setAttribute\("srcset"/.test(imageFrame) && /subtree\.appendChild\(img\)/.test(imageFrame)
      && /round < 12/.test(imageFrame) && /__frameBatchMs/.test(imageFrame));
  check('the image fixture uses only the loopback server',
    !/src="https?:/.test(imageFrames + imageFrame) && /\/pixel\.png/.test(imageFrame));
  check('the control variant disables only the logger warning switch',
    /variant === 'on:logger-off' \|\| variant === 'on'/.test(SRC)
      && /cfg\.warnGrabberDomains = \$\{warningOn\}/.test(SRC));
  check('paired runs alternate warning states in one browser profile',
    /args\.pairedLogger \? \['on'\] : args\.variants/.test(SRC)
      && /i % 2 \? \['on', 'on:logger-off'\] : \['on:logger-off', 'on'\]/.test(SRC)
      && /checkFrameLogger\(origin \+ pagePath, warningOn\)/.test(SRC));
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

  /* A baseline build in the same report: its own column, and on minus base beside on minus off. */
  const withBase = harness.aggregate(results.concat([{ variant: 'base', pages: { '/article.html': { cold: [run(40), run(41), run(39)], warm: [run(9), run(9), run(9)] } } }]));
  const baseMd = harness.markdown({ meta: { commit: 'abc', dirty: true, extensionVersion: '1.0.1', browser: 'Edg/150', cpu: 'cpu', cores: 12, throttle: 1, runs: 3, date: 'now', variants: ['off', 'base', 'on'], pages: ['/article.html'],
    readiness: { off: null, base: { extensionId: 'y'.repeat(32), workerVersion: '1.0.1', pageMarker: '1.0.1', remoteLists: { loaded: true, hosts: 3636 } }, on: { extensionId: 'x'.repeat(32), workerVersion: '1.0.1', pageMarker: '1.0.1', remoteLists: { loaded: false, hosts: 0 } } } },
  summary: withBase, deltas: { on: harness.deltas(withBase, 'off', 'on') }, featureBase: 'base', featureDeltas: harness.deltas(withBase, 'base', 'on') });
  check('a baseline build gets an on - base column', /on - base \(median\)/.test(baseMd) && /\| -10 \(-25%\) \|/.test(baseMd), baseMd.split('\n').filter((l) => /task ms \| cold/.test(l)).join('\n'));
  check('the readiness line says whether the remote lists were loaded', /remote host lists 3636 hosts/.test(baseMd) && /remote host lists not loaded/.test(baseMd));
}
check('--baseline names an extension directory, resolved to an absolute path',
  path.isAbsolute(harness.parseArgs(['--baseline', 'some/checkout']).baseline || ''));
check('the base variant refuses to run without a baseline that holds a manifest',
  /the base variant needs --baseline <extension directory>/.test(SRC));
check('an "on" variant waits, bounded, for the remote lists and records what it measured with',
  /remoteListsLoaded\(cdp, ext\.attachedSession, REMOTE_LISTS_WAIT_MS\)/.test(SRC) && /remoteLists, consentRegistered(?:,| \})/.test(SRC));
check('an "on" variant refuses to profile before dynamic consent registration',
  /await consentScriptReady\(cdp, ext\.attachedSession\)/.test(SRC)
    && /Consent Auto-Reject was not registered; refusing to profile/.test(SRC));

/* ---- fail closed ---------------------------------------------------------------------------- */
check('an "on" variant refuses to measure without the readiness marker', /refusing to measure an extension that is not running/.test(SRC) && /seen !== expectedVersion/.test(SRC));
check('an "off" variant refuses to measure with WardenOne present', /the "off" variant has WardenOne in the page/.test(SRC));
check('the worker is found by its manifest, never by the first extension target', /manifest\.name === 'WardenOne'/.test(SRC) && /getManifest\(\)\.version/.test(SRC));
check('a wrong worker version is refused', /the loaded worker reports version/.test(SRC));
check('the pages are served from the loopback only', /listen\(0, '127\.0\.0\.1'/.test(SRC));
check('a fresh profile directory per variant, removed afterwards', /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'wardenone-perf-/.test(SRC) && /fs\.rmSync\(profileDir/.test(SRC));
check('the known-regression variant is built from the tracked files, never from the working tree wholesale', /git', \['ls-files'\]/.test(SRC));
check('a regression the harness cannot see fails the run', /the harness is not sensitive enough to serve as a gate/.test(SRC));

/* ---- validate local browser evidence when available -------------------------------------- */
{
  const dir = path.join(ROOT, 'docs', 'perf');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^profile-[0-9a-f]+(?:-x\d+)?\.json$/.test(f)) : [];
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

async function checkNavigationCounters() {
  const from = SRC.indexOf('async function measureOnce(');
  const to = SRC.indexOf('\nasync function traceOnce(', from);
  let duration = 0.5;
  const calls = [];
  const box = { Date, Number, RUN_TIMEOUT_MS: 1000,
    metricsOf: async () => ({ TaskDuration: duration, ScriptDuration: duration }),
    sleep: async () => {}, waitDone: async () => {},
    delta: (after, before, name) => ((after[name] || 0) - (before[name] || 0)) * 1000,
  };
  vm.runInNewContext(SRC.slice(from, to) + '\nthis.measure = measureOnce;', box);
  const cdp = { send: async (method, args) => {
    calls.push([method, args]);
    if (method === 'Page.navigate') duration = args.url === 'about:blank' ? 0 : 0.2;
    if (method === 'Page.reload') duration = 0.2;
    return { result: { value: {} } };
  } };
  const result = await box.measure(cdp, 'page', null, 'http://fixture', '/frames-heavy.html', 'warm');
  check('warm navigation does not subtract the previous document counters', result.scriptMs === 200 && result.taskMs === 200);
  check('warm measurement retains the browser cache', !calls.some(([method]) => method === 'Network.clearBrowserCache'));
}

async function checkExtensionReadinessContexts() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  const id = 'a'.repeat(32);
  const workers = ['private', 'regular'].map((context) => ({
    type: 'service_worker', targetId: context + '-worker', browserContextId: context,
    url: 'chrome-extension://' + id + '/background.js',
  }));
  for (const [context, expected] of [[undefined, 'private-worker'], ['regular', 'regular-worker'], ['private', 'private-worker']]) {
    const attached = [];
    const cdp = { send: async (method, params) => {
      if (method === 'Target.getTargets') return { targetInfos: workers };
      if (method === 'Target.attachToTarget') {
        attached.push(params.targetId);
        return { sessionId: params.targetId };
      }
      if (method === 'Runtime.evaluate') return {
        result: { value: JSON.stringify({ name: 'WardenOne', version, id }) },
      };
      return {};
    } };
    const ready = await harness.extensionReady(cdp, 0, version, context);
    check('extension readiness selects ' + (context || 'the first available context'),
      ready.workerTargetId === expected && attached.length === 1 && attached[0] === expected);
  }
}

async function checkSlowExtensionReadiness() {
  const from = SRC.indexOf('async function extensionReady(');
  const to = SRC.indexOf('async function releaseWorker(', from);
  const id = 'a'.repeat(32);
  let clock = 0;
  let available = true;
  const context = { Date: { now: () => clock }, sleep: async ms => { clock += ms; } };
  vm.runInNewContext(SRC.slice(from, to) + '\nthis.ready=extensionReady;', context);
  const cdp = { send: async method => {
    if (method === 'Target.getTargets') return { targetInfos: available && clock >= 25000
      ? [{ type: 'service_worker', targetId: 'late-worker', url: 'chrome-extension://' + id + '/background.js' }] : [] };
    if (method === 'Target.attachToTarget') return { sessionId: 'worker-session' };
    if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify({ name: 'WardenOne', version: 'fixture', id }) } };
    return {};
  } };
  const ready = await context.ready(cdp, 0, 'fixture');
  check('slow worker registration is awaited without restarting the browser', ready.workerTargetId === 'late-worker' && clock === 25000);
  available = false;
  clock = 0;
  let error = '';
  try { await context.ready(cdp, 0, 'fixture'); } catch (failure) { error = failure.message; }
  check('a missing worker fails within a bounded wait with target diagnostics',
    clock <= 61000 && error.includes('no running WardenOne worker') && error.includes('"targets":[]'));
}

{
  const page='/frame.html',measurement=delta=>({[page]:{cold:{taskMs:{medianDelta:delta}}}});
  check('explicit baseline comparisons enforce overhead instead of silently skipping it',harness.overheadFailures({featureDeltas:measurement(76),deltas:{}},[page],75).length===1);
  check('a measured baseline comparison within budget passes',harness.overheadFailures({featureDeltas:measurement(5),deltas:{}},[page],75).length===0);
  check('extension-off comparisons retain overhead enforcement',harness.overheadFailures({deltas:{on:measurement(76)}},[page],75).length===1);
  check('missing overhead data cannot pass a requested budget',harness.overheadFailures({deltas:{}},[page],75).length===1);
}
Promise.all([checkLaunchScheduling(), checkNavigationCounters(), checkExtensionReadinessContexts(), checkSlowExtensionReadiness()]).then(() => {
  if (failed) { console.error('\n' + failed + ' failed, ' + passed + ' passed'); process.exitCode = 1; }
  else console.log('\nperf profile harness: ' + passed + ' checks passed');
}).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

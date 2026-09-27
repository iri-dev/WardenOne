/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The release performance profile: the real extension, loaded, against the same browser with
 * no extension, on local synthetic pages, several runs each, medians and tails.
 *
 *   node tools/perf-profile.js                      # off vs on, 5 runs, writes docs/perf/profile-<commit>.json
 *   node tools/perf-profile.js --runs 7 --throttle 4  # CPU throttled 4x, as a slow laptop
 *   node tools/perf-profile.js --variants off,on,regress:mutation-dedup --expect-regression
 *                                                   # prove the harness sees a known regression
 *   node tools/perf-profile.js --assert-overhead-ms 40 # fail if the extension adds more than 40 ms
 *                                                   # of main-thread task time (median) on any page
 *
 * Why this exists (PERF-12). The repository's suites pin structural optimisations and carry
 * historical live numbers, but nothing produced an accepted enabled-versus-disabled profile of
 * a release candidate: CPU, memory after GC, long tasks, first load, in the real browser with
 * the real extension. An earlier automated attempt was discarded because the extension's
 * readiness marker was absent -- the extension had not loaded and the numbers measured nothing.
 * So this harness fails closed: the "on" variants assert, before a single measurement, that the
 * worker is up with the expected version and that the engine stamped its readiness marker in
 * the page; the "off" variant asserts the marker is absent. Chrome 152 no longer honours
 * --load-extension; Microsoft Edge does, so Edge is the browser, and its version is recorded.
 *
 * What is measured, per variant x page x phase (cold = first navigation with the cache cleared,
 * warm = reload), for each of N runs: main-thread task time, script, layout and style time
 * (Performance.getMetrics deltas), long tasks (a PerformanceObserver installed at document
 * start), navigation timing, DOM nodes and listeners, JS heap after a forced GC, and the
 * extension worker's task time. Reported as median, p90 and max; the on-minus-off deltas are
 * the profile. Raw per-run values are kept in the JSON, with the commit, the browser and
 * extension versions, the CPU, the throttle and the date, so a number can always be traced to
 * what produced it. --trace also stores a DevTools trace per variant x page.
 *
 * Nothing leaves the machine: the pages are generated here and served from 127.0.0.1, the
 * profiles are fresh temp directories, and no real site is visited.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE_MIN = 22;

/* ---- arguments ---------------------------------------------------------------------------- */
function parseArgs(argv) {
  const out = { runs: 5, throttle: 1, variants: ['off', 'on'], out: '', edge: '', trace: false, expectRegression: false, assertOverheadMs: 0, keepProfiles: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--runs') out.runs = Math.max(1, parseInt(next(), 10) || 5);
    else if (a === '--throttle') out.throttle = Math.max(1, Number(next()) || 1);
    else if (a === '--variants') out.variants = String(next() || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') out.out = String(next() || '');
    else if (a === '--edge') out.edge = String(next() || '');
    else if (a === '--trace') out.trace = true;
    else if (a === '--expect-regression') out.expectRegression = true;
    else if (a === '--assert-overhead-ms') out.assertOverheadMs = Number(next()) || 0;
    else if (a === '--keep-profiles') out.keepProfiles = true;
    else if (a === '--render') out.render = String(next() || '');
    else if (a === '--help' || a === '-h') { out.help = true; }
    else throw new Error('unknown argument ' + a);
  }
  return out;
}

/* ---- statistics --------------------------------------------------------------------------- */
function quantile(values, q) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
const median = (v) => quantile(v, 0.5);
const p90 = (v) => quantile(v, 0.9);
const max = (v) => { const f = v.filter((x) => Number.isFinite(x)); return f.length ? Math.max(...f) : NaN; };
function summarise(values) {
  return { n: values.length, median: round(median(values)), p90: round(p90(values)), max: round(max(values)), min: round(quantile(values, 0)), raw: values.map(round) };
}
function round(x) { return Number.isFinite(x) ? Math.round(x * 100) / 100 : x; }

/* ---- the known regression ------------------------------------------------------------------ *
 * The mutation-scan dedup (scan only the outermost added nodes; 86-97% of added elements sit
 * inside another added in the same batch). Undoing it -- every added node scanned -- is the
 * regression the churn page exists to show, and a harness that cannot see it is not a gate. */
const REGRESSIONS = {
  'mutation-dedup': {
    file: 'content.min.js',
    from: 'if(added.length<2)return{added:added,roots:added,structural:structural};',
    to: 'if(added.length<2||!0)return{added:added,roots:added,structural:structural};',
    describe: 'every added node scanned again (the outermost-node dedup undone)',
  },
};
function applyRegression(text, name) {
  const r = REGRESSIONS[name];
  if (!r) throw new Error('unknown regression ' + name + ' (known: ' + Object.keys(REGRESSIONS).join(', ') + ')');
  const count = text.split(r.from).length - 1;
  if (count !== 1) throw new Error('regression ' + name + ': anchor found ' + count + ' times in ' + r.file + ', expected exactly 1');
  return text.replace(r.from, r.to);
}

/* ---- the synthetic pages ------------------------------------------------------------------- */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
function articlePage() {
  const paras = [];
  for (let i = 0; i < 150; i++) {
    paras.push('<p>Paragraph ' + i + ' of an ordinary article, with a <a href="/article.html#s' + i + '">local link</a>, another to '
      + '<a href="https://example.net/read/' + i + '?utm_source=test&ref=abc">elsewhere</a>, a <a href="https://cdn.example.org/asset/' + i + '.pdf">document</a> '
      + 'and enough text to make the layout do some work: the quick brown fox jumps over the lazy dog and keeps going for a while.'
      + (i % 4 === 0 ? ' <img src="' + PIXEL + '" width="120" height="80" alt="">' : '') + '</p>');
  }
  return '<!doctype html><html><head><meta charset="utf-8"><title>Article</title><style>body{font:16px/1.5 system-ui;max-width:800px;margin:0 auto;padding:20px}nav a{margin-right:8px}</style></head><body>'
    + '<nav>' + Array.from({ length: 30 }, (_, i) => '<a href="/section/' + i + '">Section ' + i + '</a>').join('') + '</nav>'
    + '<form action="/login" method="post"><label>Email <input type="email" name="email" autocomplete="username"></label>'
    + '<label>Password <input type="password" name="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>'
    + '<main>' + paras.join('') + '</main>'
    + '<div style="position:fixed;bottom:0;left:0;right:0;padding:8px;background:#eee"><button>Accept</button><button>Settings</button></div>'
    + '<script>window.__done = true;</script></body></html>';
}
/* The page builds itself the way frameworks do: a container goes into the document first and
   its rows and cells are appended INTO it, synchronously, so one mutation batch holds the
   container and everything under it as separate added nodes. That is the shape the engine's
   outermost-node dedup exists for; a subtree built off-document and appended once would arrive
   as a single added node and exercise nothing. */
function churnPage() {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Churn</title><style>body{font:14px system-ui}.card{padding:4px;border:1px solid #ddd;margin:2px}</style></head><body>'
    + '<h1>An application that builds itself</h1><div id="app"></div>'
    + '<script>'
    + 'const app = document.getElementById("app"); let batch = 0; const total = 16;'
    /* A batch is a tree six levels deep with three children per node (1,093 elements), appended
       top-down in the document, so every element arrives as its own added node under an added
       ancestor. Nesting is what makes a per-node subtree scan quadratic-ish; flat rows would not. */
    + 'function grow(parent, depth, key) {'
    + '  for (let i = 0; i < 3; i++) { const el = document.createElement(depth === 1 ? "a" : "div"); el.className = "card";'
    + '    if (depth === 1) { el.href = (i ? "https://other.example/" : "/item/") + key + "-" + i; el.textContent = "item " + key; }'
    + '    parent.appendChild(el); if (depth > 1) grow(el, depth - 1, key + "-" + i); } }'
    + 'function build() {'
    + '  const c = document.createElement("section"); c.className = "card"; app.appendChild(c);'
    + '  grow(c, 6, String(batch));'
    + '  if (batch >= 6) { const old = app.firstElementChild; if (old && app.children.length > 5) old.remove(); }'
    + '  if (++batch < total) setTimeout(build, 50); else setTimeout(() => { window.__done = true; }, 300);'
    + '}'
    + 'window.addEventListener("load", () => setTimeout(build, 50));'
    + '</script></body></html>';
}
function framePage() {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Frame</title></head><body style="font:13px system-ui">'
    + '<p>A frame with <a href="https://ads.example/click?id=1">a link</a> and <a href="/inner">another</a>.</p>'
    + '<form><input name="q"><button>Go</button></form><img src="' + PIXEL + '" width="40" height="40" alt="">'
    + Array.from({ length: 30 }, (_, i) => '<p>Line ' + i + ' <a href="/f/' + i + '">link</a></p>').join('')
    + '</body></html>';
}
function framesPage() {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Frames</title></head><body style="font:14px system-ui">'
    + '<h1>Eight same-origin frames</h1>'
    + Array.from({ length: 8 }, (_, i) => '<iframe src="/frame.html?n=' + i + '" width="300" height="160"></iframe>').join('')
    + '<script>let left = 8; document.querySelectorAll("iframe").forEach((f) => f.addEventListener("load", () => { if (--left === 0) setTimeout(() => { window.__done = true; }, 200); }));'
    + 'window.addEventListener("load", () => setTimeout(() => { window.__done = true; }, 3000));</script></body></html>';
}
const PAGES = {
  '/article.html': articlePage,
  '/churn.html': churnPage,
  '/frames.html': framesPage,
  '/frame.html': framePage,
};
const MEASURED_PAGES = ['/article.html', '/churn.html', '/frames.html'];

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = String(req.url || '/').split('?')[0];
      const page = PAGES[url];
      if (!page) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=300' });
      res.end(page());
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port }));
  });
}

/* ---- the browser, over the DevTools protocol ---------------------------------------------- */
function edgePath(explicit) {
  const candidates = [explicit, process.env.WARDENONE_EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Microsoft Edge was not found (Chrome 152+ no longer loads unpacked extensions from the command line); pass --edge <path>');
}
function freePort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* How long a page may take to signal __done. Generous, because the known-regression variant can
   make the churn page many times slower, and that slowness is the result being measured. */
const RUN_TIMEOUT_MS = 90000;
async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.listeners = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(new Error('devtools socket failed: ' + (e && e.message))));
      ws.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: no } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) no(new Error(msg.error.message)); else ok(msg.result);
        } else if (msg.method) {
          for (const fn of this.listeners) fn(msg);
        }
      });
    });
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('timed out waiting for ' + (predicate.name || 'event'))); }, timeoutMs || 15000);
      const off = this.on((msg) => { if (predicate(msg)) { clearTimeout(timer); off(); resolve(msg); } });
    });
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function launch(edge, variant, extensionDir, port, profileDir) {
  const args = [
    '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir, '--no-first-run', '--no-default-browser-check',
    '--window-position=-3000,-3000', '--window-size=1280,900', '--force-device-scale-factor=1',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-service-autorun',
    '--disable-features=msEdgeShoppingUI,msImplicitSignin,msEdgeStartupBoost',
  ];
  if (variant === 'off') args.push('--disable-extensions');
  else args.push('--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir);
  args.push('about:blank');
  const child = spawn(edge, args, { detached: true, stdio: 'ignore' });
  child.unref();
  /* Edge forks and the spawned process exits at once; the browser is alive when the endpoint is. */
  for (let i = 0; i < 100; i++) {
    try { const v = await fetchJson('http://127.0.0.1:' + port + '/json/version'); if (v && v.webSocketDebuggerUrl) return v; } catch (_) {}
    await sleep(200);
  }
  throw new Error('the browser did not open its DevTools endpoint on port ' + port);
}
async function killBrowser(cdp, port) {
  try { await cdp.send('Browser.close'); } catch (_) {}
  for (let i = 0; i < 25; i++) {
    try { await fetchJson('http://127.0.0.1:' + port + '/json/version'); } catch (_) { return; }
    await sleep(200);
  }
}

/* The long-task observer, installed before any page script so buffered entries are ours. */
const LONGTASK_SCRIPT = '(() => { try { window.__wo_perf = { longTasks: [] }; const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__wo_perf.longTasks.push(Math.round(e.duration)); }); o.observe({ type: "longtask", buffered: true }); } catch (_) {} })();';

async function extensionReady(cdp, port, expectedVersion) {
  /* Edge ships component extensions of its own (background pages and a worker or two), so the
     extension under test is found by asking each MV3 worker for its manifest, never by taking
     the first chrome-extension:// target. The worker may start a moment after the endpoint is
     up, so this polls; an idle worker is woken by opening one of the extension's pages. */
  const deadline = Date.now() + 20000;
  let wakeTarget = null;
  for (;;) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workers = targetInfos.filter((t) => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(t.url));
    for (const w of workers) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: w.targetId, flatten: true });
      let manifest = null;
      try {
        await cdp.send('Runtime.enable', {}, sessionId);
        const r = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({ name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version, id: chrome.runtime.id })', returnByValue: true }, sessionId);
        manifest = JSON.parse((r && r.result && r.result.value) || 'null');
      } catch (_) { manifest = null; }
      if (manifest && manifest.name === 'WardenOne') {
        if (manifest.version !== expectedVersion) throw new Error('the loaded worker reports version ' + manifest.version + ', the repository is ' + expectedVersion);
        /* The worker's own task time, where the browser exposes it: Edge's worker target does not
           carry the Performance domain, in which case the column is reported as unavailable. */
        let workerMetrics = true;
        try { await cdp.send('Performance.enable', {}, sessionId); } catch (_) { workerMetrics = false; }
        if (wakeTarget) { try { await cdp.send('Target.closeTarget', { targetId: wakeTarget }); } catch (_) {} }
        return { id: manifest.id, workerSession: workerMetrics ? sessionId : null, workerTargetId: w.targetId, workerMetrics };
      }
      try { await cdp.send('Target.detachFromTarget', { sessionId }); } catch (_) {}
    }
    if (Date.now() > deadline) throw new Error('no running WardenOne worker was found: the extension did not load, or its worker never started');
    if (!wakeTarget && Date.now() > deadline - 12000) {
      /* Past the first several seconds with no worker: it may be idle. WardenOne opens its
         onboarding page on install, which names the id; opening a page of it wakes the worker. */
      const page = targetInfos.find((t) => t.type === 'page' && /^chrome-extension:\/\/[a-p]{32}\/onboarding\.html/.test(t.url));
      if (page) {
        const id = page.url.slice('chrome-extension://'.length, 'chrome-extension://'.length + 32);
        const created = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + id + '/popup.html' });
        wakeTarget = created.targetId;
      }
    }
    await sleep(500);
  }
}
async function closeExtensionTabs(cdp, port, id) {
  const list = await fetchJson('http://127.0.0.1:' + port + '/json/list');
  for (const t of list) {
    if (t.type === 'page' && id && t.url.indexOf('chrome-extension://' + id + '/') === 0) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id }); } catch (_) {}
    }
  }
}

async function metricsOf(cdp, session) {
  const { metrics } = await cdp.send('Performance.getMetrics', {}, session);
  const out = {};
  for (const m of metrics) out[m.name] = m.value;
  return out;
}
const delta = (after, before, key) => (Number(after[key] || 0) - Number(before[key] || 0)) * 1000; /* seconds to ms */

async function waitDone(cdp, session, timeoutMs) {
  const start = Date.now();
  for (;;) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'window.__done === true', returnByValue: true }, session);
    if (r && r.result && r.result.value === true) return;
    if (Date.now() - start > timeoutMs) throw new Error('the page never signalled __done');
    await sleep(50);
  }
}

async function measureOnce(cdp, page, workerSession, origin, pagePath, phase, opts) {
  const url = origin + pagePath;
  if (phase === 'cold') {
    await cdp.send('Network.clearBrowserCache', {}, page);
    await cdp.send('Page.navigate', { url: 'about:blank' }, page);
    await sleep(150);
  }
  const before = await metricsOf(cdp, page);
  const workerBefore = workerSession ? await metricsOf(cdp, workerSession).catch(() => ({})) : {};
  const t0 = Date.now();
  if (phase === 'cold') await cdp.send('Page.navigate', { url }, page);
  else await cdp.send('Page.reload', { ignoreCache: false }, page);
  await waitDone(cdp, page, RUN_TIMEOUT_MS);
  await sleep(600);  /* let the extension's post-load work land */
  const wall = Date.now() - t0;
  const nav = await cdp.send('Runtime.evaluate', { expression: '(() => { const n = performance.getEntriesByType("navigation")[0] || {}; const lt = (window.__wo_perf && window.__wo_perf.longTasks) || []; return { dcl: n.domContentLoadedEventEnd || 0, load: n.loadEventEnd || 0, longTasks: lt.length, longTaskMs: lt.reduce((a, b) => a + b, 0), nodes: document.getElementsByTagName("*").length }; })()', returnByValue: true }, page);
  const after = await metricsOf(cdp, page);
  await cdp.send('HeapProfiler.collectGarbage', {}, page).catch(() => {});
  await sleep(100);
  const afterGc = await metricsOf(cdp, page);
  const workerAfter = workerSession ? await metricsOf(cdp, workerSession).catch(() => ({})) : {};
  const v = (nav && nav.result && nav.result.value) || {};
  return {
    taskMs: delta(after, before, 'TaskDuration'),
    scriptMs: delta(after, before, 'ScriptDuration'),
    layoutMs: delta(after, before, 'LayoutDuration'),
    styleMs: delta(after, before, 'RecalcStyleDuration'),
    longTasks: v.longTasks || 0,
    longTaskMs: v.longTaskMs || 0,
    dclMs: v.dcl || 0,
    loadMs: v.load || 0,
    wallMs: wall,
    heapAfterGcMB: Number(afterGc.JSHeapUsedSize || 0) / (1024 * 1024),
    domNodes: Number(v.nodes || 0),   /* the live document's count; the renderer metric also counts the previous document until it is collected */
    listeners: Number(after.JSEventListeners || 0),
    workerTaskMs: workerSession ? delta(workerAfter, workerBefore, 'TaskDuration') : NaN,
  };
}

async function traceOnce(cdp, page, origin, pagePath, outFile) {
  const events = [];
  const off = cdp.on((msg) => {
    if (msg.method === 'Tracing.dataCollected' && msg.params && Array.isArray(msg.params.value)) events.push(...msg.params.value);
  });
  await cdp.send('Page.navigate', { url: 'about:blank' }, page);
  await sleep(150);
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' }, page);
  await cdp.send('Page.navigate', { url: origin + pagePath }, page);
  await waitDone(cdp, page, RUN_TIMEOUT_MS);
  await sleep(600);
  const done = cdp.waitFor((m) => m.method === 'Tracing.tracingComplete', 30000);
  await cdp.send('Tracing.end', {}, page);
  await done;
  await sleep(200);
  off();
  fs.writeFileSync(outFile, JSON.stringify({ traceEvents: events }));
  return events.length;
}

/* ---- one variant, start to finish ---------------------------------------------------------- */
async function runVariant(variant, ctx) {
  const { edge, runs, throttle, origin, expectedVersion, trace, traceDir } = ctx;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-perf-' + variant.replace(/[^a-z-]/gi, '_') + '-'));
  let extensionDir = ROOT;
  let cleanupExtensionDir = null;
  if (variant.indexOf('regress:') === 0) {
    /* A copy of the extension with the named regression applied to the built file. */
    const name = variant.slice('regress:'.length);
    const r = REGRESSIONS[name];
    if (!r) throw new Error('unknown regression ' + name);
    extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-regress-'));
    cleanupExtensionDir = extensionDir;
    copyExtension(ROOT, extensionDir);
    const target = path.join(extensionDir, r.file);
    fs.writeFileSync(target, applyRegression(fs.readFileSync(target, 'utf8'), name));
  }
  const port = await freePort();
  const version = await launch(edge, variant, extensionDir, port, profileDir);
  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.connect();
  const result = { variant, browser: version.Browser, userAgent: version['User-Agent'], pages: {}, readiness: null };
  try {
    let ext = null;
    if (variant !== 'off') {
      ext = await extensionReady(cdp, port, expectedVersion);
      await closeExtensionTabs(cdp, port, ext.id);
      result.readiness = { extensionId: ext.id, workerVersion: expectedVersion, workerMetrics: ext.workerMetrics };
    }
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, page);
    await cdp.send('Runtime.enable', {}, page);
    await cdp.send('Network.enable', {}, page);
    await cdp.send('Performance.enable', {}, page);
    await cdp.send('HeapProfiler.enable', {}, page);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LONGTASK_SCRIPT }, page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }, page);

    /* Readiness in the PAGE, fail closed: the engine's marker must be there (on) or absent (off). */
    await cdp.send('Page.navigate', { url: origin + '/article.html' }, page);
    await waitDone(cdp, page, RUN_TIMEOUT_MS);
    await sleep(1500);
    const marker = await cdp.send('Runtime.evaluate', { expression: 'window.__wardenOneReadyVersion', returnByValue: true }, page);
    const seen = marker && marker.result && marker.result.value;
    if (variant === 'off' && seen !== undefined) throw new Error('the "off" variant has WardenOne in the page (marker ' + seen + '); the measurement would compare nothing');
    if (variant !== 'off' && seen !== expectedVersion) throw new Error('the engine did not stamp its readiness marker in the page (saw ' + JSON.stringify(seen) + ', expected ' + expectedVersion + '); refusing to measure an extension that is not running');
    result.readiness = Object.assign({}, result.readiness || {}, { pageMarker: seen === undefined ? null : seen });

    for (const pagePath of MEASURED_PAGES) {
      const rec = { cold: [], warm: [] };
      for (let i = 0; i < runs; i++) {
        rec.cold.push(await measureOnce(cdp, page, ext && ext.workerSession, origin, pagePath, 'cold'));
        rec.warm.push(await measureOnce(cdp, page, ext && ext.workerSession, origin, pagePath, 'warm'));
      }
      result.pages[pagePath] = rec;
      process.stdout.write('  ' + variant + ' ' + pagePath + ': ' + runs + ' cold + ' + runs + ' warm runs, cold task median ' + round(median(rec.cold.map((r) => r.taskMs))) + ' ms\n');
    }
    /* Traces last, in a tab of their own, so a tracing session never sits under a measured run. */
    if (trace) {
      const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId: tracePage } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      await cdp.send('Page.enable', {}, tracePage);
      await cdp.send('Runtime.enable', {}, tracePage);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LONGTASK_SCRIPT }, tracePage);
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }, tracePage);
      for (const pagePath of MEASURED_PAGES) {
        const file = path.join(traceDir, variant.replace(/[^a-z-]/gi, '_') + pagePath.replace(/[^a-z]/gi, '-') + '.trace.json');
        try {
          const n = await traceOnce(cdp, tracePage, origin, pagePath, file);
          process.stdout.write('    trace: ' + n + ' events -> ' + path.relative(ROOT, file) + '\n');
        } catch (e) {
          process.stdout.write('    trace of ' + pagePath + ' failed: ' + (e && e.message) + '\n');
        }
      }
      try { await cdp.send('Target.closeTarget', { targetId: t.targetId }); } catch (_) {}
    }
  } finally {
    await killBrowser(cdp, port);
    cdp.close();
    if (!ctx.keepProfiles) { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {} }
    if (cleanupExtensionDir) { try { fs.rmSync(cleanupExtensionDir, { recursive: true, force: true }); } catch (_) {} }
  }
  return result;
}

/* The shipped files only: what `git ls-files` tracks, minus nothing. An untracked file in the
   working tree is not part of the extension under test. */
function copyExtension(from, to) {
  const ls = spawnSync('git', ['ls-files'], { cwd: from, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ls.status !== 0) throw new Error('git ls-files failed');
  for (const rel of ls.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(to, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

/* ---- the report ------------------------------------------------------------------------------ */
const METRICS = [
  ['taskMs', 'main-thread task ms'], ['scriptMs', 'script ms'], ['layoutMs', 'layout ms'], ['styleMs', 'style ms'],
  ['longTasks', 'long tasks'], ['longTaskMs', 'long-task ms'], ['dclMs', 'DOMContentLoaded ms'], ['loadMs', 'load ms'],
  ['heapAfterGcMB', 'heap after GC MB'], ['domNodes', 'DOM nodes'], ['listeners', 'listeners'], ['workerTaskMs', 'worker task ms'],
];
function aggregate(results) {
  const out = {};
  for (const r of results) {
    out[r.variant] = {};
    for (const pagePath of Object.keys(r.pages)) {
      out[r.variant][pagePath] = {};
      for (const phase of ['cold', 'warm']) {
        out[r.variant][pagePath][phase] = {};
        for (const [key] of METRICS) out[r.variant][pagePath][phase][key] = summarise(r.pages[pagePath][phase].map((x) => x[key]));
      }
    }
  }
  return out;
}
function deltas(agg, base, other) {
  const out = {};
  if (!agg[base] || !agg[other]) return out;
  for (const pagePath of Object.keys(agg[other])) {
    out[pagePath] = {};
    for (const phase of ['cold', 'warm']) {
      out[pagePath][phase] = {};
      for (const [key] of METRICS) {
        const a = agg[base][pagePath] && agg[base][pagePath][phase][key];
        const b = agg[other][pagePath][phase][key];
        if (!a || !b) continue;
        out[pagePath][phase][key] = { medianDelta: round(b.median - a.median), p90Delta: round(b.p90 - a.p90), pct: a.median ? round(((b.median - a.median) / a.median) * 100) : null };
      }
    }
  }
  return out;
}
function markdown(profile) {
  const lines = [];
  lines.push('# WardenOne performance profile', '');
  lines.push('- commit `' + profile.meta.commit + (profile.meta.dirty ? '` (working tree modified)' : '`') + ', extension ' + profile.meta.extensionVersion);
  lines.push('- ' + profile.meta.browser + ' on ' + profile.meta.cpu + ' (' + profile.meta.cores + ' cores), CPU throttle x' + profile.meta.throttle + ', ' + profile.meta.runs + ' runs per cell, ' + profile.meta.date);
  lines.push('- variants: ' + profile.meta.variants.join(', ') + '; pages served from 127.0.0.1; nothing left the machine');
  const workerMetrics = Object.values(profile.meta.readiness || {}).some((r) => r && r.workerMetrics);
  lines.push('- readiness: ' + Object.entries(profile.meta.readiness || {}).map(([v, r]) => v + ' = ' + (r && r.extensionId ? 'worker ' + r.workerVersion + ' (' + r.extensionId + '), page marker ' + r.pageMarker : 'no extension, page marker absent')).join('; ')
    + (workerMetrics ? '' : '; the worker\'s own task time is not exposed by this browser\'s worker target'), '');
  for (const pagePath of MEASURED_PAGES) {
    lines.push('## ' + pagePath, '');
    lines.push('| metric | phase | ' + profile.meta.variants.map((v) => v + ' median / p90 / max').join(' | ') + ' | on - off (median) |');
    lines.push('|---|---|' + profile.meta.variants.map(() => '---').join('|') + '|---|');
    for (const [key, label] of METRICS) {
      /* A metric the browser could not provide (the worker's task time in Edge) is left out rather than shown as NaN. */
      const present = profile.meta.variants.some((v) => { const s = profile.summary[v] && profile.summary[v][pagePath]; return s && ['cold', 'warm'].some((ph) => Number.isFinite(s[ph][key].median)); });
      if (!present) continue;
      for (const phase of ['cold', 'warm']) {
        const cells = profile.meta.variants.map((v) => { const s = profile.summary[v] && profile.summary[v][pagePath] && profile.summary[v][pagePath][phase][key]; return s && Number.isFinite(s.median) ? s.median + ' / ' + s.p90 + ' / ' + s.max : '-'; });
        const d = profile.deltas.on && profile.deltas.on[pagePath] && profile.deltas.on[pagePath][phase][key];
        lines.push('| ' + label + ' | ' + phase + ' | ' + cells.join(' | ') + ' | ' + (d ? (d.medianDelta >= 0 ? '+' : '') + d.medianDelta + (d.pct !== null ? ' (' + (d.pct >= 0 ? '+' : '') + d.pct + '%)' : '') : '-') + ' |');
      }
    }
    lines.push('');
  }
  lines.push('Raw per-run values, readiness evidence and metadata are in the JSON beside this file.', '');
  return lines.join('\n');
}

/* ---- main ------------------------------------------------------------------------------------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[1].split('\n').slice(0, 30).join('\n')); return; }
  if (args.render) {
    const file = path.resolve(ROOT, args.render);
    const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file.replace(/\.json$/, '') + '.md', markdown(profile));
    console.log(markdown(profile));
    return;
  }
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < NODE_MIN || typeof WebSocket !== 'function' || typeof fetch !== 'function') throw new Error('Node ' + NODE_MIN + '+ with built-in fetch and WebSocket is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const commit = (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim() || 'unknown';
  const dirty = (spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim().length > 0;
  const edge = edgePath(args.edge);
  const outDir = path.join(ROOT, 'docs', 'perf');
  fs.mkdirSync(outDir, { recursive: true });
  const traceDir = path.join(outDir, 'traces');
  if (args.trace) fs.mkdirSync(traceDir, { recursive: true });
  const outBase = args.out ? path.resolve(ROOT, args.out).replace(/\.json$/, '') : path.join(outDir, 'profile-' + commit + (args.throttle > 1 ? '-x' + args.throttle : ''));

  const { server, origin } = await serve();
  console.log('WardenOne performance profile: ' + args.variants.join(' vs ') + ', ' + args.runs + ' runs, throttle x' + args.throttle + ', pages at ' + origin);
  const results = [];
  try {
    for (const variant of args.variants) {
      console.log('variant ' + variant + ':');
      results.push(await runVariant(variant, { edge, runs: args.runs, throttle: args.throttle, origin, expectedVersion: manifest.version, trace: args.trace, traceDir, keepProfiles: args.keepProfiles }));
    }
  } finally {
    server.close();
  }
  const summary = aggregate(results);
  const profile = {
    meta: {
      commit, dirty, extensionVersion: manifest.version, browser: results[0].browser, userAgent: results[0].userAgent,
      cpu: os.cpus()[0].model.trim(), cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9), platform: os.platform() + ' ' + os.release(),
      throttle: args.throttle, runs: args.runs, variants: args.variants, date: new Date().toISOString(), pages: MEASURED_PAGES,
      readiness: Object.fromEntries(results.map((r) => [r.variant, r.readiness])),
    },
    summary,
    deltas: Object.fromEntries(args.variants.filter((v) => v !== 'off').map((v) => [v, deltas(summary, 'off', v)])),
    raw: Object.fromEntries(results.map((r) => [r.variant, r.pages])),
  };
  fs.writeFileSync(outBase + '.json', JSON.stringify(profile, null, 1));
  fs.writeFileSync(outBase + '.md', markdown(profile));
  console.log('\n' + markdown(profile));
  console.log('written: ' + path.relative(ROOT, outBase + '.json') + ' and .md');

  let failed = false;
  if (args.expectRegression) {
    const reg = args.variants.find((v) => v.indexOf('regress:') === 0);
    const on = summary.on && summary.on['/churn.html'];
    const bad = reg && summary[reg] && summary[reg]['/churn.html'];
    const seen = on && bad && bad.cold.taskMs.median > on.cold.taskMs.median * 1.15;
    console.log(seen ? 'the harness sees the known regression on the churn page (' + bad.cold.taskMs.median + ' ms vs ' + on.cold.taskMs.median + ' ms)' : 'FAIL: the known regression was not visible on the churn page; the harness is not sensitive enough to serve as a gate');
    if (!seen) failed = true;
  }
  if (args.assertOverheadMs > 0 && profile.deltas.on) {
    for (const pagePath of MEASURED_PAGES) {
      const d = profile.deltas.on[pagePath] && profile.deltas.on[pagePath].cold.taskMs;
      if (d && d.medianDelta > args.assertOverheadMs) { console.log('FAIL: ' + pagePath + ' cold task-time overhead ' + d.medianDelta + ' ms exceeds ' + args.assertOverheadMs + ' ms'); failed = true; }
    }
    if (!failed) console.log('overhead within ' + args.assertOverheadMs + ' ms on every page');
  }
  process.exit(failed ? 1 : 0);
}

module.exports = { parseArgs, quantile, median, p90, summarise, applyRegression, REGRESSIONS, PAGES, MEASURED_PAGES, aggregate, deltas, markdown, LONGTASK_SCRIPT, Cdp, launch, killBrowser, extensionReady, freePort, edgePath };

if (require.main === module) {
  main().catch((e) => { console.error('perf profile: ' + (e && e.stack || e)); process.exit(2); });
}

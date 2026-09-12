/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What does WardenOne cost a page per child frame, really? (PERF-02)
 *
 * Not a gate check: this drives a real browser. It serves a fixture page with N same-origin
 * child frames, launches Edge twice -- once with the unpacked extension from this checkout,
 * once with no extensions at all -- loads the fixture at 0, 5, 20 and 100 frames in each, and
 * reads the renderer's own accounting through the DevTools protocol: script time, task time,
 * JS heap, the load event, listener count. The extension's cost is the difference.
 *
 * Why Edge: Chrome 152 removed --load-extension; Edge still honours it. Why a real browser:
 * compile time measured in Node said 3 ms a frame and the finding modelled from bytes; the
 * renderer said 13 ms and 0.7 MiB a frame, almost none of it delivery. Only the browser
 * knows what an isolated world, its bindings, its observers and its round trips cost.
 *
 * Usage:   node tools/measure-frame-cost.js [runs]
 * Needs:   Edge at the path below, Node 24+ (built-in WebSocket), ports 8765/8766 and
 *          9451/9452 free. Nothing is installed; two throwaway profiles are created in the
 *          temp directory and both browsers are closed through the protocol at the end.
 * Output:  a table of extension-minus-control medians, and the raw runs as JSON next to it.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const EDGE = process.env.WARDENONE_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPO = path.resolve(__dirname, '..');
const FIXTURE_PORT = 8765;
const RUNS = Number(process.argv[2] || 5);
const COUNTS = [0, 5, 20, 100];
const SETTLE_MS = 2500;

/* ---- the fixture: a parent with N small child frames ------------------------------ */

function childPage(i) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>child ' + i + '</title>'
    + '<style>body{font:14px system-ui;margin:12px}</style></head><body>'
    + '<h3>Child frame ' + i + '</h3><p>A small document with a form and a list, so the frame is not empty.</p>'
    + '<form><input name="q" placeholder="search"><button type="button">go</button></form>'
    + '<ul>' + Array.from({ length: 12 }, (_, k) => '<li>item ' + k + '</li>').join('') + '</ul></body></html>';
}
function parentPage(n) {
  const frames = Array.from({ length: n }, (_, i) => '<iframe src="/child.html?i=' + i + '" width="200" height="120"></iframe>').join('\n');
  return '<!doctype html><html><head><meta charset="utf-8"><title>frames ' + n + '</title>'
    + '<style>body{font:14px system-ui;margin:12px}iframe{border:1px solid #ccc;margin:2px}</style></head><body>'
    + '<h1>Parent with ' + n + ' frames</h1>\n' + frames + '\n</body></html>';
}
function serveFixture(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/child.html') { res.end(childPage(url.searchParams.get('i') || '0')); return; }
    if (url.pathname === '/frames.html') { res.end(parentPage(Math.max(0, Math.min(200, Number(url.searchParams.get('n') || 0))))); return; }
    res.statusCode = 404; res.end('no');
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/* ---- a minimal DevTools protocol client -------------------------------------------- */

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve); this.ws.addEventListener('error', reject); });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        return;
      }
      if (msg.method) for (const fn of (this.listeners.get(msg.method) || [])) fn(msg.params, msg.sessionId);
    });
  }
  send(method, params, sessionId) {
    const id = ++this.id; const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  off(method, fn) { const list = this.listeners.get(method) || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
  close() { try { this.ws.close(); } catch (_) {} }
}

/* ---- browsers ---------------------------------------------------------------------- */

async function launch(withExtension, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-frame-cost-' + (withExtension ? 'ext' : 'ctl') + '-'));
  const args = ['--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--force-device-scale-factor=1', '--window-size=1440,960', '--window-position=-3000,-3000',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
  if (withExtension) args.push('--disable-extensions-except=' + REPO, '--load-extension=' + REPO);
  else args.push('--disable-extensions');
  const child = spawn(EDGE, args, { detached: true, stdio: 'ignore' });
  child.unref();
  let version = null;
  for (let i = 0; i < 100 && !version; i++) { await sleep(300); try { version = await getJson('http://127.0.0.1:' + port + '/json/version'); } catch (_) {} }
  if (!version) throw new Error('Edge did not come up on port ' + port + ' -- is it at ' + EDGE + '?');
  return { version, profile };
}
async function wardenOnePresent(port) {
  /* WardenOne specifically -- its worker or the onboarding page it opens on install. Edge has
     component extensions of its own on chrome-extension:// URLs, so "any extension" is wrong. */
  for (let i = 0; i < 40; i++) {
    const list = await getJson('http://127.0.0.1:' + port + '/json/list');
    if (list.some((t) => /chrome-extension:\/\/[a-p]{32}\/(background\.js|onboarding\.html)/.test(t.url))) return true;
    await sleep(250);
  }
  return false;
}

async function measureOnce(browser, n) {
  const cdp = new Cdp(browser.version.webSocketDebuggerUrl);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' }, sessionId);
  let isolatedContexts = 0;
  const onCtx = (params, sid) => { if (sid === sessionId && params.context && params.context.auxData && params.context.auxData.type === 'isolated') isolatedContexts++; };
  cdp.on('Runtime.executionContextCreated', onCtx);
  const loaded = new Promise((resolve) => { const fn = (p, sid) => { if (sid === sessionId) { cdp.off('Page.loadEventFired', fn); resolve(); } }; cdp.on('Page.loadEventFired', fn); });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + FIXTURE_PORT + '/frames.html?n=' + n }, sessionId);
  await Promise.race([loaded, sleep(60000)]);
  await sleep(SETTLE_MS);
  const { metrics } = await cdp.send('Performance.getMetrics', {}, sessionId);
  const m = {}; for (const { name, value } of metrics) m[name] = value;
  const nav = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(performance.getEntriesByType("navigation")[0].toJSON())', returnByValue: true }, sessionId);
  const timing = JSON.parse((nav.result && nav.result.value) || '{}');
  cdp.off('Runtime.executionContextCreated', onCtx);
  await cdp.send('Target.closeTarget', { targetId });
  cdp.close();
  return {
    scriptMs: m.ScriptDuration * 1000, taskMs: m.TaskDuration * 1000, compileMs: (m.V8CompileDuration || 0) * 1000,
    heapMiB: m.JSHeapUsedSize / 1048576, loadMs: Math.round(timing.loadEventEnd || 0), dclMs: Math.round(timing.domContentLoadedEventEnd || 0),
    listeners: m.JSEventListeners, isolatedContexts,
  };
}
const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

async function series(withExtension, port) {
  const browser = await launch(withExtension, port);
  const present = await wardenOnePresent(port);
  if (withExtension && !present) throw new Error('WardenOne did not load from ' + REPO);
  if (!withExtension && present) throw new Error('the control browser has WardenOne loaded');
  await sleep(withExtension ? 6000 : 1500);   // worker installs, lists parse, onboarding opens
  const out = {};
  for (const n of COUNTS) {
    const runs = [];
    for (let r = 0; r < RUNS; r++) runs.push(await measureOnce(browser, n));
    const med = {}; for (const k of Object.keys(runs[0])) med[k] = median(runs.map((x) => x[k]));
    out[n] = { median: med, runs };
    process.stderr.write('  ' + (withExtension ? 'extension' : 'control  ') + '  n=' + String(n).padStart(3) + '  script ' + med.scriptMs.toFixed(0) + ' ms  heap ' + med.heapMiB.toFixed(1) + ' MiB  load ' + med.loadMs + ' ms\n');
  }
  const cdp = new Cdp(browser.version.webSocketDebuggerUrl); await cdp.ready;
  try { await cdp.send('Browser.close'); } catch (_) {}
  cdp.close();
  return out;
}

(async () => {
  const server = serveFixture(FIXTURE_PORT);
  try {
    const control = await series(false, 9451);
    const ext = await series(true, 9452);
    const delta = {};
    for (const n of COUNTS) {
      const c = control[n].median, e = ext[n].median;
      delta[n] = {
        scriptMs: +(e.scriptMs - c.scriptMs).toFixed(1), taskMs: +(e.taskMs - c.taskMs).toFixed(1), compileMs: +(e.compileMs - c.compileMs).toFixed(1),
        heapMiB: +(e.heapMiB - c.heapMiB).toFixed(2), loadMs: e.loadMs - c.loadMs, dclMs: e.dclMs - c.dclMs,
        listeners: e.listeners - c.listeners, isolatedContexts: e.isolatedContexts - c.isolatedContexts,
      };
    }
    const outFile = path.join(__dirname, 'frame-cost-result.json');
    fs.writeFileSync(outFile, JSON.stringify({ runs: RUNS, counts: COUNTS, control, ext, delta, when: new Date().toISOString() }, null, 2));
    console.log('\nextension minus control, medians of ' + RUNS + ' runs:\n');
    console.log('frames  script(ms)  task(ms)  compile(ms)  heap(MiB)  load(ms)  DCL(ms)  listeners  isolated-ctx');
    for (const n of COUNTS) {
      const d = delta[n];
      console.log(String(n).padStart(6) + String(d.scriptMs).padStart(12) + String(d.taskMs).padStart(10) + String(d.compileMs).padStart(13) + String(d.heapMiB).padStart(11)
        + String(d.loadMs).padStart(10) + String(d.dclMs).padStart(9) + String(d.listeners).padStart(11) + String(d.isolatedContexts).padStart(14));
    }
    const perFrame = (delta[100].scriptMs - delta[0].scriptMs) / 100;
    const perFrameHeap = (delta[100].heapMiB - delta[0].heapMiB) / 100;
    console.log('\nper child frame, from the 100-frame row: ' + perFrame.toFixed(1) + ' ms of script, ' + perFrameHeap.toFixed(2) + ' MiB of heap.');
    console.log('raw runs written to ' + outFile);
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

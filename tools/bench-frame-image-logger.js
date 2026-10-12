/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Micro-benchmark for the iframe image-logger detector (frame-image-logger.js) alone.
   Each run loads one detector into a fresh same-origin frame and times DOM work in it,
   mutation-observer callbacks included, on a cross-origin-isolated page so the timer is
   fine-grained. Variants: `none` (no detector), `floor` (an observer with the same options
   that only walks its records, the price of observing at all), `current` (the working
   tree) and, with --compare <git-rev|file>, `compare`. The shapes:
     imageChurn      the perf-profile image fixture: 64 images changing src/srcset
     frameworkBuild  a 1,093-element tree appended parent-first into a 2,000-node DOM
     playerTicks     300 single-node updates in a 3,000-node DOM, like a player clock
     lazyLoad        a loader setting src and srcset on 300 images at once
   usage: node tools/bench-frame-image-logger.js [--reps 15] [--throttle 4]
            [--compare HEAD] [--out file.json] [--edge <path>]
   It needs Microsoft Edge (or --edge) and takes a few minutes; it is not part of the gate. */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { reps: 15, throttle: 1, compare: '', out: '', edge: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--reps') out.reps = Math.max(1, parseInt(next(), 10) || 15);
    else if (a === '--throttle') out.throttle = Math.max(1, Number(next()) || 1);
    else if (a === '--compare') out.compare = String(next() || '');
    else if (a === '--out') out.out = String(next() || '');
    else if (a === '--edge') out.edge = String(next() || '');
  }
  return out;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>frame image logger bench</title></head><body><script>
const params = new URLSearchParams(location.search);
const VARIANTS = params.get('variants').split(',');
const REPS = Number(params.get('reps'));
const FLOOR = "(function(){ if (window===window.top) return; new MutationObserver(function(rs){ for (const r of rs){ if (r.type==='attributes'){ void r.target; continue; } for (const n of r.addedNodes) void n.nodeType; } }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset']}); })();";
const sources = {};
const tick = () => Promise.resolve();
function makeFrame() {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.src = '/frame.html';
    f.onload = () => resolve(f);
    document.body.appendChild(f);
  });
}
function arm(f, name) {
  const w = f.contentWindow;
  w.__wardenOneFrameGrabberConfig = () => ({ enabled: true, site: '127.0.0.1' });
  w.chrome = { runtime: { lastError: null, sendMessage(m, cb) { if (cb) cb(); } } };
  w.siteIdentity = (h) => h;
  if (name === 'floor') w.eval(FLOOR);
  else if (name !== 'none') w.eval(sources[name]);
}
function staticDom(doc, count) {
  const host = doc.createElement('div');
  let parent = host;
  for (let i = 0; i < count; i++) {
    const el = doc.createElement(i % 5 === 0 ? 'section' : (i % 3 ? 'p' : 'span'));
    if (i % 7 === 0) el.textContent = 'text ' + i;
    if (i % 25 === 0) parent = host;
    parent.appendChild(el);
    if (i % 5 === 0) parent = el;
  }
  doc.body.appendChild(host);
}
const SCENARIOS = {
  async imageChurn(doc) {
    const root = doc.createElement('main'); doc.body.appendChild(root);
    const images = [];
    for (let i = 0; i < 64; i++) { const img = doc.createElement('img'); img.src = '/p.png?v=0'; root.appendChild(img); images.push(img); }
    await tick();
    let total = 0;
    for (let round = 0; round < 12; round++) {
      const t = performance.now();
      for (let i = 0; i < images.length; i++) {
        if (i % 2) images[i].setAttribute('src', '/p.png?v=' + (round % 2));
        else images[i].setAttribute('srcset', '/p.png?v=' + (round % 2) + ' 1x');
      }
      const sub = doc.createElement('div');
      for (let i = 0; i < 16; i++) { const img = doc.createElement('img'); img.src = '/p.png?v=' + (round % 2); sub.appendChild(img); }
      root.appendChild(sub);
      if (root.children.length > 72) root.children[64].remove();
      await tick();
      total += performance.now() - t;
    }
    return total;
  },
  async frameworkBuild(doc) {
    staticDom(doc, 2000);
    await tick();
    let total = 0;
    for (let batch = 0; batch < 6; batch++) {
      const t = performance.now();
      const c = doc.createElement('section'); doc.body.appendChild(c);
      (function grow(parent, depth, key) {
        for (let i = 0; i < 3; i++) {
          const leaf = depth === 1;
          const el = doc.createElement(leaf ? (i === 0 ? 'img' : 'a') : 'div');
          if (leaf && i === 0) el.setAttribute('src', '/p.png?k=' + key);
          else if (leaf) el.setAttribute('href', '/item/' + key + '-' + i);
          parent.appendChild(el);
          if (!leaf) grow(el, depth - 1, key + '-' + i);
        }
      })(c, 6, String(batch));
      await tick();
      c.remove();
      await tick();
      total += performance.now() - t;
    }
    return total;
  },
  async playerTicks(doc) {
    staticDom(doc, 3000);
    const label = doc.createElement('span'); doc.body.appendChild(label);
    await tick();
    const t = performance.now();
    for (let i = 0; i < 300; i++) { label.textContent = '0:' + i; await tick(); }
    return performance.now() - t;
  },
  async lazyLoad(doc) {
    const images = [];
    for (let i = 0; i < 300; i++) { const img = doc.createElement('img'); img.dataset.src = '/p.png?l=' + i; doc.body.appendChild(img); images.push(img); }
    await tick();
    let total = 0;
    for (let rep = 0; rep < 5; rep++) {
      const t = performance.now();
      for (const img of images) {
        const u = img.dataset.src + '&r=' + rep;
        img.setAttribute('src', u);
        img.setAttribute('srcset', u + ' 1x, ' + u + '&d=2 2x');
      }
      await tick();
      for (const img of images) { img.removeAttribute('srcset'); img.removeAttribute('src'); }
      await tick();
      total += performance.now() - t;
    }
    return total;
  },
};
(async () => {
  for (const name of VARIANTS) if (name !== 'none' && name !== 'floor') sources[name] = await (await fetch('/det/' + name + '.js')).text();
  const names = Object.keys(SCENARIOS);
  const results = {};
  for (const v of VARIANTS) { results[v] = {}; for (const s of names) results[v][s] = []; }
  for (let rep = 0; rep < REPS + 2; rep++) {
    const order = VARIANTS.slice().sort(() => Math.random() - 0.5);
    for (const s of names) {
      for (const v of order) {
        const f = await makeFrame();
        arm(f, v);
        await tick();
        const ms = await SCENARIOS[s](f.contentDocument);
        if (rep >= 2) results[v][s].push(ms);
        f.remove();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  window.__result = { isolated: self.crossOriginIsolated, results };
})().catch((e) => { window.__result = { error: String(e && e.stack || e) }; });
</script></body></html>`;

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function edgePath(explicit) {
  const candidates = [explicit, process.env.WARDENONE_EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Microsoft Edge was not found; pass --edge <path>');
}

function compareSource(ref) {
  if (fs.existsSync(ref)) return fs.readFileSync(ref, 'utf8');
  const shown = spawnSync('git', ['show', ref + ':frame-image-logger.js'], { cwd: ROOT, encoding: 'utf8' });
  if (shown.status !== 0) throw new Error('cannot read frame-image-logger.js at ' + ref);
  return shown.stdout;
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const quantile = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const detectors = { current: fs.readFileSync(path.join(ROOT, 'frame-image-logger.js'), 'utf8') };
  if (args.compare) detectors.compare = compareSource(args.compare);
  const variants = ['none', 'floor', ...Object.keys(detectors)];
  const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const name = (u.pathname.match(/^\/det\/(\w+)\.js$/) || [])[1];
    if (u.pathname === '/bench.html') { res.writeHead(200, { ...isolation, 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(PAGE); }
    else if (u.pathname === '/frame.html') { res.writeHead(200, { ...isolation, 'Content-Type': 'text/html' }); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); }
    else if (u.pathname === '/p.png') { res.writeHead(200, { ...isolation, 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }); res.end(PIXEL); }
    else if (name && detectors[name]) { res.writeHead(200, { ...isolation, 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(detectors[name]); }
    else { res.writeHead(404, isolation); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const port = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-frame-bench-'));
  const child = spawn(edgePath(args.edge), ['--remote-debugging-port=' + port, '--user-data-dir=' + profileDir,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-position=-3000,-3000',
    '--window-size=1280,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion,msEdgeShoppingUI',
    'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page') || null; } catch (_) {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('the browser did not open its DevTools endpoint');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  let result = null;
  let browser = '';
  try {
    try { browser = (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()).Browser || ''; } catch (_) {}
    if (args.throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: args.throttle });
    await send('Page.navigate', { url: origin + '/bench.html?variants=' + variants.join(',') + '&reps=' + args.reps });
    const started = Date.now();
    while (!result && Date.now() - started < 30 * 60 * 1000) {
      await sleep(1000);
      const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__result || null)', returnByValue: true });
      const v = r.result && r.result.result && r.result.result.value;
      if (v && v !== 'null') result = JSON.parse(v);
    }
  } finally {
    try { await send('Browser.close'); } catch (_) {}
    ws.close();
    server.close();
  }
  if (!result || result.error) throw new Error('benchmark failed: ' + (result ? result.error : 'timed out'));
  if (!result.isolated) throw new Error('the page was not cross-origin isolated, so its timer is too coarse to trust');
  const summary = {};
  console.log('frame image-logger bench: ' + args.reps + ' runs per cell, CPU throttle x' + args.throttle
    + (args.compare ? ', compare = ' + args.compare : ''));
  for (const s of Object.keys(result.results.none)) {
    const none = median(result.results.none[s]);
    summary[s] = {};
    console.log('\n' + s);
    for (const v of variants) {
      const runs = result.results[v][s];
      summary[s][v] = { median: median(runs), p25: quantile(runs, 0.25), p75: quantile(runs, 0.75), overNone: median(runs) - none };
      console.log('  ' + v.padEnd(8) + ' median ' + median(runs).toFixed(2).padStart(8) + ' ms  p25 '
        + quantile(runs, 0.25).toFixed(2).padStart(8) + '  p75 ' + quantile(runs, 0.75).toFixed(2).padStart(8)
        + '  over none ' + (median(runs) - none).toFixed(2).padStart(8));
    }
  }
  if (args.out) {
    const commit = (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim();
    const compare = !args.compare ? null : (fs.existsSync(args.compare) ? path.basename(args.compare) : args.compare);
    const meta = { commit, compare, reps: args.reps, throttle: args.throttle, browser,
      cpu: (os.cpus()[0] || {}).model || '', date: new Date().toISOString() };
    fs.writeFileSync(path.resolve(ROOT, args.out), JSON.stringify({ meta, summary, raw: result.results }, null, 2) + '\n');
    console.log('\nwritten: ' + args.out);
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

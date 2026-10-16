/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
/* Manual memory attribution with disposable Edge profiles. No user profile is read or changed. */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const browser = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mib = (n) => Math.round(n / 1048576 * 100) / 100;

function argsOf(argv) {
  const args = { phase: 'frames', counts: [0, 1, 10, 30], runs: 2,
    refreshCosmetics: false, waitAutoCosmetics: false,
    out: path.join(ROOT, 'docs', 'perf', 'memory-investigation-2026-10-14.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--phase') args.phase = argv[++i];
    else if (argv[i] === '--counts') args.counts = argv[++i].split(',').map(Number);
    else if (argv[i] === '--runs') args.runs = Number(argv[++i]);
    else if (argv[i] === '--refresh-cosmetics') args.refreshCosmetics = true;
    else if (argv[i] === '--wait-auto-cosmetics') args.waitAutoCosmetics = true;
    else if (argv[i] === '--out') args.out = path.resolve(ROOT, argv[++i]);
    else throw new Error('unknown option ' + argv[i]);
  }
  if (!['frames', 'worker'].includes(args.phase) || !Number.isInteger(args.runs) || args.runs < 1
      || args.counts.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) throw new Error('invalid arguments');
  return args;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      if (url.pathname === '/frame') {
        res.end('<!doctype html><title>Frame</title><p>Ordinary embedded document</p><a href="/article">Link</a>');
      } else {
        const n = Math.min(100, Math.max(0, Number(url.searchParams.get('n')) || 0));
        res.end('<!doctype html><title>Frame memory fixture</title><h1>Frame memory fixture</h1>'
          + Array.from({ length: n }, (_, i) => '<iframe src="/frame?i=' + i + '"></iframe>').join('')
          + '<script>window.__frameFixtureLoaded = true</script>');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port }));
  });
}

async function evaluate(cdp, session, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, session);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluation failed');
  return r.result && r.result.value;
}

async function processMemory(cdp) {
  const info = await cdp.send('SystemInfo.getProcessInfo');
  const processes = (info.processInfo || []).map((p) => ({ pid: Number(p.id), type: p.type }));
  const pids = processes.map((p) => p.pid).filter((p) => Number.isSafeInteger(p) && p > 0);
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const command = '$ids=@(' + pids.join(',') + '); Get-Process -Id $ids -ErrorAction SilentlyContinue'
    + ' | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress';
  const out = spawnSync(ps, ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 10000 });
  if (out.status !== 0 || !out.stdout.trim()) throw new Error('process memory query failed');
  const byPid = new Map([].concat(JSON.parse(out.stdout)).map((p) => [Number(p.Id), p]));
  const rows = processes.map((p) => ({ type: p.type, pid: p.pid,
    privateMiB: mib(Number((byPid.get(p.pid) || {}).PrivateMemorySize64 || 0)),
    workingSetMiB: mib(Number((byPid.get(p.pid) || {}).WorkingSet64 || 0)) }));
  return { totalPrivateMiB: Math.round(rows.reduce((n, p) => n + p.privateMiB, 0) * 100) / 100,
    totalWorkingSetMiB: Math.round(rows.reduce((n, p) => n + p.workingSetMiB, 0) * 100) / 100,
    rows };
}

async function workerSnapshot(cdp, session, label) {
  await cdp.send('HeapProfiler.collectGarbage', {}, session);
  await sleep(100);
  const heap = await cdp.send('Runtime.getHeapUsage', {}, session);
  const state = await evaluate(cdp, session, `(() => {
    const data = __cosmeticMem && __cosmeticMem.data;
    const packaged = __packagedCosmetics;
    const sizes = (x) => x ? { keys: Object.keys(x).length,
      entries: Object.values(x).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0) } : null;
    return { packaged: packaged ? { scriptlets: sizes(packaged.scriptlets),
      procedural: sizes(packaged.procedural) } : null,
      mem: data ? { generic: (data.generic || []).length,
        specific: sizes(data.specific), exceptions: sizes(data.exceptions),
        genericHideExclusions: (data.genericHideExclusions || []).length,
        scriptletsSameAsPackaged: data.scriptlets === packaged.scriptlets,
        proceduralSameAsPackaged: data.procedural === packaged.procedural } : null,
      hostCache: __cosmeticHostCache.size, listBroker: LIST_BROKER.stats() };
  })()`);
  return { label, usedHeapMiB: mib(heap.usedSize), allocatedHeapMiB: mib(heap.totalSize), state };
}

async function one(phase, variant, count, origin, version, refreshCosmetics, waitAutoCosmetics) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-memory-investigation-'));
  const port = await browser.freePort();
  let cdp;
  try {
    const edge = await browser.launch(browser.edgePath(), variant, ROOT, port, profileDir);
    cdp = new browser.Cdp(edge.webSocketDebuggerUrl);
    await cdp.connect();
    let extension = null;
    if (variant === 'on') {
      extension = await browser.extensionReady(cdp, port, version);
      await browser.closeExtensionTabs(cdp, port, extension.id);
    }
    if (phase === 'worker') {
      const session = extension.attachedSession;
      const samples = [await workerSnapshot(cdp, session, 'startup')];
      await evaluate(cdp, session, 'getPackagedCosmetics().then(() => true)', true);
      samples.push(await workerSnapshot(cdp, session, 'packaged'));
      await evaluate(cdp, session, 'getCosmeticMem().then(() => true)', true);
      samples.push(await workerSnapshot(cdp, session, 'cosmetic-mem'));
      if (waitAutoCosmetics) {
        let ready = false;
        for (let i = 0; i < 120; i++) {
          ready = await evaluate(cdp, session, `chrome.storage.local.get('wardenone_adshield_cosmetic').then(x => {
            const b = LIST_BROKER.stats();
            return !!x.wardenone_adshield_cosmetic && !b.holders && !b.active && !b.queued;
          })`, true);
          if (ready) break;
          await sleep(1000);
        }
        if (!ready) throw new Error('automatic cosmetic refresh did not settle within 120 seconds');
        await sleep(2000);
        samples.push(await workerSnapshot(cdp, session, 'auto-refresh-before-mem-load'));
        await evaluate(cdp, session, 'getCosmeticMem().then(() => true)', true);
        samples.push(await workerSnapshot(cdp, session, 'auto-refresh-mem-loaded'));
        await evaluate(cdp, session, 'invalidateCosmeticCache(); true');
        samples.push(await workerSnapshot(cdp, session, 'auto-refresh-cache-dropped'));
        await evaluate(cdp, session, '__packagedCosmetics = null; true');
        samples.push(await workerSnapshot(cdp, session, 'auto-refresh-package-dropped'));
        await evaluate(cdp, session, 'getPackagedCosmetics().then(() => true)', true);
        samples.push(await workerSnapshot(cdp, session, 'auto-refresh-package-reloaded'));
      }
      if (refreshCosmetics) {
        await evaluate(cdp, session, 'updateAdShieldCosmetics().then(() => true)', true);
        await evaluate(cdp, session, 'getCosmeticMem().then(() => true)', true);
        samples.push(await workerSnapshot(cdp, session, 'refreshed-cosmetic-mem'));
        await sleep(5000);
        samples.push(await workerSnapshot(cdp, session, 'refreshed-after-5s'));
        await sleep(15000);
        samples.push(await workerSnapshot(cdp, session, 'refreshed-after-20s'));
        await evaluate(cdp, session, 'invalidateCosmeticCache(); true');
        samples.push(await workerSnapshot(cdp, session, 'after-cosmetic-cache-drop'));
      }
      const stored = await evaluate(cdp, session, `chrome.storage.local.get('wardenone_adshield_cosmetic').then(x => {
        const d = x.wardenone_adshield_cosmetic; return d ? {
          serializedBytes: new TextEncoder().encode(JSON.stringify(d)).length,
          generic: (d.generic || []).length,
          specificHosts: Object.keys(d.specific || {}).length,
          exceptionHosts: Object.keys(d.exceptions || {}).length
        } : null;
      })`, true);
      return { phase, variant, browser: edge.Browser, samples, stored, processes: await processMemory(cdp) };
    }
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Performance.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: origin + '/?n=' + count }, sessionId);
    for (let i = 0; i < 100; i++) {
      const loaded = await evaluate(cdp, sessionId, `(() => {
        const frames = Array.from(document.querySelectorAll('iframe'));
        return document.readyState === 'complete' && frames.length === ${count}
          && frames.every(f => f.contentDocument && f.contentDocument.readyState === 'complete')
          && ${variant === 'on' ? 'window.__wardenOneReadyVersion === ' + JSON.stringify(version) : '!window.__wardenOneReadyVersion'};
      })()`);
      if (loaded) break;
      if (i === 99) throw new Error('fixture or extension did not become ready');
      await sleep(100);
    }
    await sleep(1200);
    await cdp.send('HeapProfiler.collectGarbage', {}, sessionId);
    await sleep(200);
    const metrics = await cdp.send('Performance.getMetrics', {}, sessionId);
    const values = Object.fromEntries((metrics.metrics || []).map((m) => [m.name, m.value]));
    const heap = await cdp.send('Runtime.getHeapUsage', {}, sessionId);
    const state = await evaluate(cdp, sessionId, `({ frames: document.querySelectorAll('iframe').length,
      readyVersion: window.__wardenOneReadyVersion || null })`);
    return { phase, variant, count, browser: edge.Browser, state,
      rendererHeapMiB: mib(heap.usedSize), rendererMetricHeapMiB: mib(values.JSHeapUsedSize || 0),
      rendererNodes: values.Nodes, processes: await processMemory(cdp) };
  } finally {
    if (cdp) { try { await browser.killBrowser(cdp, port); } catch (_) {} cdp.close(); }
    const resolved = path.resolve(profileDir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
        && path.basename(resolved).startsWith('wo-memory-investigation-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
      catch (error) { console.warn('temporary profile cleanup deferred: ' + error.message); }
    }
  }
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  const fixture = args.phase === 'frames' ? await serve() : null;
  const report = { date: new Date().toISOString(), version, phase: args.phase,
    note: 'Fresh disposable Edge profile per sample; attached debugger keeps extension worker awake.', samples: [] };
  try {
    const cases = args.phase === 'worker' ? [['on', 0]] : args.counts.flatMap((n) => [['off', n], ['on', n]]);
    for (let run = 0; run < args.runs; run++) {
      for (const [variant, count] of cases) {
        console.log('run ' + (run + 1) + '/' + args.runs + ': ' + variant + ' ' + count + ' frames');
        try { report.samples.push({ run: run + 1, ...await one(args.phase, variant, count, fixture && fixture.origin, version, args.refreshCosmetics, args.waitAutoCosmetics) }); }
        catch (error) { report.samples.push({ run: run + 1, variant, count, error: String(error && error.stack || error) }); }
        fs.mkdirSync(path.dirname(args.out), { recursive: true });
        fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
      }
    }
  } finally { if (fixture) await new Promise((resolve) => fixture.server.close(resolve)); }
  if (report.samples.some((s) => s.error)) process.exitCode = 1;
  console.log('written: ' + args.out);
}

browser.mustFinish(main, 'perf-memory-investigation').catch((error) => {
  console.error(error); process.exitCode = 1;
});

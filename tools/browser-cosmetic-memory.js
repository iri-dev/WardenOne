/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Cosmetic cache and frame lifecycles in disposable Edge; the debugger holds the worker awake.
   Run: node tools/browser-cosmetic-memory.js --extension <snapshot> --out <report.json> */
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function argsOf(argv) {
  const args = { extension: ROOT, out: path.join(ROOT, 'docs/perf/traces/cosmetic-memory/report.json'), cycles: 5 };
  const flags = new Map([['--extension', 'extension'], ['--out', 'out'], ['--cycles', 'cycles']]);
  for (let i = 0; i < argv.length; i++) {
    const key = flags.get(argv[i]);
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('expected --extension <directory>, --out <file>, or --cycles <1-10>');
    args[key] = argv[++i];
  }
  args.cycles = Number(args.cycles);
  if (!Number.isInteger(args.cycles) || args.cycles < 1 || args.cycles > 10) throw new Error('--cycles must be 1-10');
  args.extension = path.resolve(args.extension);
  args.out = path.resolve(args.out);
  return args;
}

async function evaluate(cdp, session, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function until(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do { if (await fn()) return; await sleep(200); } while (Date.now() < deadline);
  throw new Error('timed out waiting for ' + label);
}

async function run(args) {
  const manifest = JSON.parse(fs.readFileSync(path.join(args.extension, 'manifest.json')));
  const report = { measuredAt: new Date().toISOString(), version: manifest.version,
    backgroundSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extension, 'background.js'))).digest('hex'),
    note: 'Post-GC worker and same-origin renderer V8 heap; not total process memory. Worker debugger remains attached.',
    completed: false, worker: [], pages: [] };
  const save = () => {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    const frames = req.url.startsWith('/frames') ? Array.from({ length: 30 }, (_, i) => '<iframe src="/child?i=' + i + '"></iframe>').join('') : '';
    res.end('<!doctype html><title>Cosmetic memory</title><p>Ordinary content</p>'
      + '<div id="memory-ad-probe" class="memory-' + (args.cycles - 1) + '-specific">Cosmetic probe</div>' + frames);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = 'cosmetic-memory.example.org';
  const origin = 'http://' + host + ':' + server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-cosmetic-memory-'));
  const port = await profile.freePort();
  let cdp;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', args.extension, port, dir, [
      '--host-resolver-rules=MAP ' + host + ' 127.0.0.1',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,msEdgeShoppingUI,msImplicitSignin,msEdgeStartupBoost',
    ]);
    report.browser = browser.Browser;
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, manifest.version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = extension.attachedSession;
    let quietSince = Date.now();
    await until(async () => {
      const ready = await evaluate(cdp, worker, `chrome.storage.local.get('wardenone_adshield_cosmetic').then(x => {
        const b = LIST_BROKER.stats();
        return !!x.wardenone_adshield_cosmetic && !b.holders && !b.active && !b.queued && !__remoteListUpdateInFlight;
      })`);
      if (!ready) quietSince = Date.now();
      return ready && Date.now() - quietSince >= 5000;
    }, 'remote cosmetic data and a quiet list broker', 180000);

    const snapshot = async (label) => {
      await cdp.send('HeapProfiler.collectGarbage', {}, worker);
      const heap = await cdp.send('Runtime.getHeapUsage', {}, worker);
      const state = await evaluate(cdp, worker, `(() => {
        const rows = [...__cosmeticHostCache.values()];
        return { hosts: rows.length, cap: COSMETIC_HOST_CACHE_MAX,
          distinctSelectorArrays: new Set(rows.map(row => row.selectors)).size,
          generic: __cosmeticMem ? __cosmeticMem.data.generic.length : null, generation: __cosmeticGeneration };
      })()`);
      assert(state.hosts <= state.cap);
      if (label.endsWith('capacity')) assert.strictEqual(state.hosts, state.cap, 'the workload must fill the host cache');
      const sample = { label, usedHeapBytes: heap.usedSize, ...state };
      report.worker.push(sample);
      save();
      console.log(JSON.stringify(sample));
    };
    await evaluate(cdp, worker, 'invalidateCosmeticCache(); getCosmeticMem().then(() => true)');
    await snapshot('real-list-loaded');
    report.parent = await evaluate(cdp, worker, `(() => {
      const mem = __cosmeticMem;
      const parent = Object.keys(mem.data.specific).find(host => normalizeAllowlistHost(host) && mem.data.specific[host].length
        && !isVideoPlatformHost(host) && !isXPlatformHost(host) && !hostMatchesCosmeticDomainList(host, mem.data.genericHideExclusions || []));
      if (!parent) throw new Error('no scoped cosmetic host found');
      for (let i = 0; i < COSMETIC_HOST_CACHE_MAX; i++) computeCosmeticForHost('memory-probe-' + i + '.' + parent, mem, false);
      return parent;
    })()`);
    await snapshot('real-list-scoped-capacity');
    await evaluate(cdp, worker, 'invalidateCosmeticCache(); true');
    await snapshot('real-list-invalidated');

    for (let cycle = 0; cycle < args.cycles; cycle++) {
      const generation = await evaluate(cdp, worker, '__cosmeticGeneration');
      await evaluate(cdp, worker, `chrome.storage.local.set({ wardenone_adshield_cosmetic: {
        generic: Array.from({length:16000}, (_, i) => '.memory-${cycle}-ad-' + i),
        specific: {'example.org':['.memory-${cycle}-specific']}, exceptions: {}, genericHideExclusions: []
      } }).then(() => true)`);
      await until(() => evaluate(cdp, worker, '__cosmeticGeneration > ' + generation), 'storage-driven invalidation');
      await evaluate(cdp, worker, `getCosmeticMem().then(mem => {
        for (let i = 0; i < COSMETIC_HOST_CACHE_MAX * 4; i++) {
          const result = computeCosmeticForHost('host-' + i + '.example.org', mem, false);
          if (!result.selectors.includes('.memory-${cycle}-specific') || result.selectors.some(s => s.startsWith('.memory-') && !s.startsWith('.memory-${cycle}-'))) throw new Error('stale selector or lost scoped coverage');
        }
        return true;
      })`);
      await snapshot('replacement-' + (cycle + 1) + '-capacity');
      await evaluate(cdp, worker, 'invalidateCosmeticCache(); true');
      await snapshot('replacement-' + (cycle + 1) + '-invalidated');
    }

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, page);
    await cdp.send('Runtime.enable', {}, page);
    const navigate = async (route) => {
      const navigation = await cdp.send('Page.navigate', { url: origin + route }, page);
      if (navigation.errorText) throw new Error(navigation.errorText);
      await until(() => evaluate(cdp, page, `location.href === ${JSON.stringify(origin + route)} && document.readyState === 'complete' && window.__wardenOneReadyVersion === ${JSON.stringify(manifest.version)}
        && [...document.querySelectorAll('iframe')].every(f => f.contentDocument && f.contentDocument.readyState === 'complete')`), 'fixture and extension readiness');
      await sleep(1000);
    };
    const pageSnapshot = async (label) => {
      await cdp.send('HeapProfiler.collectGarbage', {}, page);
      const heap = await cdp.send('Runtime.getHeapUsage', {}, page);
      const counters = await cdp.send('Memory.getDOMCounters', {}, page);
      const frames = await evaluate(cdp, page, 'document.querySelectorAll("iframe").length');
      const cosmetic = await evaluate(cdp, page, `({ cssChars: document.getElementById('rg-adshield-style')?.textContent.length || 0,
        hidden: getComputedStyle(document.getElementById('memory-ad-probe')).display === 'none' })`);
      assert(cosmetic.cssChars > 0 && cosmetic.hidden, 'the real page must receive and apply the cosmetic list');
      const sample = { label, usedHeapBytes: heap.usedSize, frames, ...counters, ...cosmetic };
      report.pages.push(sample);
      save();
      console.log(JSON.stringify(sample));
    };
    await navigate('/frames?warmup');
    await navigate('/ordinary?warmup');
    await pageSnapshot('warm-baseline');
    for (let cycle = 0; cycle < args.cycles; cycle++) {
      await navigate('/frames?round=' + cycle);
      await pageSnapshot('frames-' + (cycle + 1));
      assert.strictEqual(report.pages.at(-1).frames, 30);
      await navigate('/ordinary?round=' + cycle);
      await pageSnapshot('returned-' + (cycle + 1));
      assert.strictEqual(report.pages.at(-1).frames, 0);
    }
    report.completed = true;
  } catch (error) {
    report.error = String(error.stack || error);
    throw error;
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('wo-cosmetic-memory-')) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn('temporary profile cleanup deferred: ' + error.message); }
    }
    save();
  }
  console.log('[ok] cosmetic capacity, storage invalidation and frame navigation cycles completed');
}

module.exports = { argsOf };
if (require.main === module) profile.mustFinish(() => run(argsOf(process.argv.slice(2))), 'cosmetic memory profile')
  .catch((error) => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const assert = require('assert/strict');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const { tls } = require('./browser-media-security.js');
const { browserProcess } = require('./browser-cold-wake.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(cdp, session, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw Error('Timed out: ' + label);
}
async function workload() {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:10px;top:10px;width:220.25px;height:32.5px;white-space:nowrap';
  box.textContent = 'editable text'; box.contentEditable = 'true'; document.body.append(box);
  const range = document.createRange(); range.selectNodeContents(box);
  const first = box.getClientRects(), other = box.getClientRects();
  const shape = { type: Object.getPrototypeOf(first) === DOMRectList.prototype,
    item: first.item(0) === first[0], iterator: [...first][0] === first[0], nullItem: first.item(50) === null,
    fresh: first[0] !== other[0], lengths: first.length === 1, noise: window.__wardenOneRealm?.noise };
  const originalWidth = other[0].width; first[0].width = 999;
  shape.mutationIsolated = other[0].width === originalWidth && box.getClientRects()[0].width === originalWidth;
  const paragraph=document.createElement('p');paragraph.style.cssText='width:45px;font:16px sans-serif';paragraph.textContent='several wrapped words on separate lines';document.body.append(paragraph);
  const multiline=document.createRange();multiline.selectNodeContents(paragraph);const rects=multiline.getClientRects();
  shape.multiline=rects.length>1&&rects.item(rects.length-1)===rects[rects.length-1]&&[...rects].every((r,i)=>r===rects[i]);paragraph.remove();
  const operations = {
    index: () => box.getClientRects()[0].width,
    item: () => box.getClientRects().item(0).width,
    range: () => range.getClientRects()[0].width,
  };
  const loops = {};
  for (const [name, read] of Object.entries(operations)) {
    let sum = 0; for (let i = 0; i < 2000; i++) sum += read();
    const start = performance.now(); for (let i = 0; i < 100000; i++) sum += read();
    loops[name] = { calls: 100000, ms: performance.now() - start, sum };
  }
  const samples = [], start = performance.now(); let last = start, checksum = 0;
  for (let frame = 0; frame < 30; frame++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now(); samples.push(now - last); last = now;
    box.firstChild.data = 'editing frame ' + frame;
    range.selectNodeContents(box); getSelection().removeAllRanges(); getSelection().addRange(range);
    for (let i = 0; i < 500; i++) checksum += range.getClientRects()[0].width + box.getClientRects()[0].width;
  }
  shape.editing = box.textContent === 'editing frame 29'; box.remove();
  return { shape, loops, editing: { frames: 30, reads: 30000, wallMs: performance.now() - start, gapsMs: samples, checksum } };
}
async function run(build, round, options, origin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-layout-perf-'));
  const port = await profile.freePort(); let cdp;
  const row = { build: build.label, round, variants: {}, complete: false };
  try {
    const browser = await profile.launch(options.browser, 'on', build.directory, port, dir,
      ['--host-resolver-rules=MAP layout.performance.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']);
    row.browser = browser.Browser; cdp = new profile.Cdp(browser.webSocketDebuggerUrl); await cdp.connect();
    const manifest = JSON.parse(fs.readFileSync(path.join(build.directory, 'manifest.json')));
    const ext = await profile.extensionReady(cdp, port, manifest.version); await profile.closeExtensionTabs(cdp, port, ext.id);
    for (const noise of [false, true]) {
      await evaluate(cdp, ext.attachedSession, `updateStoredConfig(c=>{c.antiFingerprintNoise=${noise};c.fingerprintProbeDetection=false;c.autoUpdateLists=false;}).then(()=>true)`);
      await until(() => evaluate(cdp, ext.attachedSession, '!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued'), 'config');
      const target = await cdp.send('Target.createTarget', { url: origin });
      const session = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
      await cdp.send('Performance.enable', {}, session);
      await until(() => evaluate(cdp, session, 'document.readyState==="complete"&&window.__wardenOneRealm?.noise===' + noise), 'page verdict');
      const task = async () => (await cdp.send('Performance.getMetrics', {}, session)).metrics.find(x => x.name === 'TaskDuration').value * 1000;
      const beforeCpu = browserProcess(await cdp.send('SystemInfo.getProcessInfo')), beforeTask = await task();
      if (noise && round === 1) { await cdp.send('Profiler.enable', {}, session); await cdp.send('Profiler.start', {}, session); }
      const measured = await evaluate(cdp, session, '(' + workload.toString() + ')()');
      if (noise && round === 1) {
        const result = await cdp.send('Profiler.stop', {}, session);
        const file = options.out.replace(/\.json$/, '') + '-' + build.label + '.cpuprofile';
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(result.profile));
        measured.cpuProfile = file; await cdp.send('Profiler.disable', {}, session);
      }
      const afterCpu = browserProcess(await cdp.send('SystemInfo.getProcessInfo'));
      measured.browserCpuMs = (afterCpu.cpuTime - beforeCpu.cpuTime) * 1000;
      measured.rendererTaskMs = await task() - beforeTask;
      await cdp.send('HeapProfiler.collectGarbage', {}, session);
      measured.rendererHeapAfterGcBytes = (await cdp.send('Runtime.getHeapUsage', {}, session)).usedSize;
      for (const [key, value] of Object.entries(measured.shape)) if (key !== 'noise') assert(value, key);
      assert.equal(measured.shape.noise, noise); row.variants[noise ? 'on' : 'off'] = measured;
      await cdp.send('Target.closeTarget', { targetId: target.targetId });
    }
    row.complete = true;
  } catch (e) { row.error = String(e.stack || e); }
  finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-layout-perf-')) throw Error('Unexpected profile path');
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (e) { row.cleanupWarning = e.message; }
  }
  return row;
}
function args(argv) {
  const o = { runs: 7 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].slice(2), value = argv[i + 1];
    if (!['browser', 'reference', 'candidate', 'runs', 'out'].includes(key) || !value) throw Error('Expected paired browser/reference/candidate/runs/out options');
    o[key] = key === 'runs' ? Number(value) : path.resolve(value);
  }
  if (!o.browser || !o.reference || !o.candidate || !o.out || !Number.isInteger(o.runs) || o.runs < 1 || o.runs > 10) throw Error('Paths and 1..10 runs required');
  return o;
}
async function main(options) {
  const builds = ['reference', 'candidate'].map(label => ({ label, directory: options[label], fingerprint: identity.fingerprint(options[label]).sha256 }));
  const report = { createdAt: new Date().toISOString(), toolSha256: identity.sha256(fs.readFileSync(__filename)),
    browserSha256: identity.sha256(fs.readFileSync(options.browser)), builds, cpu: os.cpus()[0].model, platform: os.platform() + ' ' + os.release(), results: [], complete: false };
  const server = https.createServer(tls, (req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Layout performance</title><input value="editable">'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const save = () => { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2)); };
  try {
    for (let round = 1; round <= options.runs; round++) for (const build of round % 2 ? builds : [...builds].reverse()) {
      console.log('Layout ' + build.label + ' ' + round + '/' + options.runs);
      const row = await run(build, round, options, 'https://layout.performance.test:' + server.address().port + '/');
      report.results.push(row); save(); if (!row.complete) throw Error(row.error);
    }
    for (const build of builds) assert.equal(identity.fingerprint(build.directory).sha256, build.fingerprint);
    report.complete = true;
  } finally { save(); await new Promise(resolve => server.close(resolve)); }
  console.log('[ok] native layout semantics, editing responsiveness and hook CPU/heap measurements');
}
if (require.main === module) profile.mustFinish(() => main(args(process.argv.slice(2))), 'layout performance').catch(e => { console.error(e); process.exitCode = 1; });

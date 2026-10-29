/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
/* Manual live-site comparison. It records only public URLs and aggregate browser metrics. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const browser = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const SITES = {
  youtube: 'https://www.youtube.com/watch?v=duNv2_IplR4',
  twitch: 'https://www.twitch.tv/videos/2896433713',
  discord: 'https://discord.com/app',
  images: 'https://commons.wikimedia.org/wiki/Commons:Featured_pictures/Animals/Mammals',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => Math.round(bytes / 1048576 * 100) / 100;

function argsOf(argv) {
  const args = { sites: Object.keys(SITES), variants: ['head', 'current'], seconds: 120,
    warmup: 20, skipRemoteWait: false, out: path.join(ROOT, 'docs', 'perf', 'real-sites-2026-10-12.json') };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i];
    if (argv[i] === '--sites') args.sites = value().split(',');
    else if (argv[i] === '--variants') args.variants = value().split(',');
    else if (argv[i] === '--seconds') args.seconds = Number(value());
    else if (argv[i] === '--warmup') args.warmup = Number(value());
    else if (argv[i] === '--skip-remote-wait') args.skipRemoteWait = true;
    else if (argv[i] === '--out') args.out = path.resolve(ROOT, value());
    else if (argv[i] === '--extension') args.extension = path.resolve(value());
    else if (argv[i] === '--noise') args.noise = true;
    else throw new Error('unknown option ' + argv[i]);
  }
  if (args.sites.some((site) => !SITES[site]) || args.variants.some((v) => !['head', 'current'].includes(v))
      || !Number.isFinite(args.seconds) || args.seconds < 10 || !Number.isFinite(args.warmup) || args.warmup < 0) {
    throw new Error('invalid sites, variants, seconds or warmup');
  }
  if(args.extension&&args.variants.includes('head'))throw new Error('--extension requires only the current variant');
  return args;
}

function copyHead(to) {
  const files = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (files.status !== 0) throw new Error('git ls-files failed');
  for (const rel of files.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const source = path.join(ROOT, rel);
    if (!fs.existsSync(source)) continue;
    const target = path.join(to, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const rel of ['bridge.js', 'frame-image-logger.js']) {
    const old = spawnSync('git', ['show', 'HEAD:' + rel], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 });
    if (old.status !== 0) throw new Error('git show HEAD:' + rel + ' failed');
    fs.writeFileSync(path.join(to, rel), old.stdout);
  }
}

async function pageState(cdp, session) {
  const expression = `(() => {
    const images = Array.from(document.images);
    const video = document.querySelector('video');
    const player = document.getElementById('movie_player');
    const vod = Array.from(document.querySelectorAll('a[href]')).map((link) => link.href)
      .find((href) => /twitch\\.tv\\/(?:videos\\/\\d+|[^/]+\\/video\\/\\d+)/.test(href));
    const body = document.body;
    return { host: location.hostname, path: location.pathname, title: document.title, noiseEnabled: window.__wardenOneRealm?.noise ?? null,
      textLength: body ? body.innerText.length : 0, images: images.length,
      loadedImages: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      videos: document.querySelectorAll('video').length,
      videoTime: video ? video.currentTime : null, videoDuration: video ? video.duration : null,
      videoWidth: video ? video.videoWidth : null, videoHeight: video ? video.videoHeight : null,
      playbackQuality: player && typeof player.getPlaybackQuality === 'function'
        ? player.getPlaybackQuality() : null,
      videoReadyState: video ? video.readyState : null, videoPaused: video ? video.paused : null,
      videoEnded: video ? video.ended : null,
      vodPath: vod ? new URL(vod).pathname : null,
      loginFields: document.querySelectorAll('input[type="email"], input[type="password"]').length,
      readyVersion: window.__wardenOneReadyVersion || null,
      browserError: /^(chrome-error|edge-error):/.test(location.protocol)
        || /can't be reached|can't reach this page|site can't be reached/i.test(document.title) };
  })()`;
  const reply = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, session);
  return reply && reply.result && reply.result.value;
}

function siteReady(site, state) {
  if (!state || state.browserError || !state.readyVersion) return false;
  if (site === 'youtube') return state.host === 'www.youtube.com'
    && state.videos > 0 && state.videoReadyState >= 2 && state.textLength > 2500;
  if (site === 'twitch') return state.host === 'www.twitch.tv'
    && state.videos > 0 && state.videoReadyState >= 2 && state.textLength > 1200;
  if (site === 'discord') return state.host === 'discord.com'
    && state.path === '/login' && state.loginFields >= 1 && state.textLength > 150;
  return state.host === 'commons.wikimedia.org' && state.images >= 300 && state.loadedImages >= 20;
}

function sampleSuccessful(result) {
  if(result.error||result.readiness?.ready!==true)return false;
  const first=result.samples?.[0]?.state,last=result.samples?.at(-1)?.state;
  if(!siteReady(result.site,last))return false;
  if(result.site!=='youtube'&&result.site!=='twitch')return true;
  return Number.isFinite(first?.videoTime)&&Number.isFinite(last.videoTime)
    &&last.videoTime>first.videoTime+.05&&(!last.videoPaused||last.videoEnded===true);
}

async function waitForSite(cdp, session, site, navigationStart, minimumSeconds) {
  await sleep(minimumSeconds * 1000);
  let state = await pageState(cdp, session);
  while (!siteReady(site, state) && Date.now() - navigationStart < 90000) {
    await sleep(2000);
    state = await pageState(cdp, session);
  }
  return { ready: siteReady(site, state), readySeconds: Math.round((Date.now() - navigationStart) / 1000), state };
}

async function processState(cdp) {
  const reply = await cdp.send('SystemInfo.getProcessInfo').catch(() => null);
  const processes = reply && reply.processInfo || [];
  const pids = processes.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const cpuSeconds = processes.reduce((total, item) => total + (Number(item.cpuTime) || 0), 0);
  const cpuByPid = Object.fromEntries(processes.map((item) => [item.id, Number(item.cpuTime) || 0]));
  if (!pids.length || process.platform !== 'win32') return { cpuSeconds, cpuByPid, processCount: pids.length };
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const command = '$procIds=@(' + pids.join(',') + '); Get-Process -Id $procIds -ErrorAction SilentlyContinue'
    + ' | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress';
  const result = spawnSync(ps, ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0 || !result.stdout.trim()) return { cpuSeconds, cpuByPid, processCount: pids.length };
  const items = [].concat(JSON.parse(result.stdout));
  return { cpuSeconds, cpuByPid, processCount: items.length,
    workingSetMB: mb(items.reduce((sum, item) => sum + Number(item.WorkingSet64 || 0), 0)),
    privateMB: mb(items.reduce((sum, item) => sum + Number(item.PrivateMemorySize64 || 0), 0)) };
}

async function sample(cdp, page, workerSessions) {
  const metrics = await cdp.send('Performance.getMetrics', {}, page);
  const values = Object.fromEntries((metrics.metrics || []).map((item) => [item.name, item.value]));
  const [state, processes] = await Promise.all([pageState(cdp, page), processState(cdp)]);
  const workerHeaps = await Promise.all(Array.from(workerSessions || []).filter((session) => session !== page)
    .map((session) => cdp.send('Runtime.getHeapUsage', {}, session).catch(() => null)));
  return { elapsedMs: Date.now(), taskSeconds: values.TaskDuration || 0,
    scriptSeconds: values.ScriptDuration || 0, heapMB: mb(values.JSHeapUsedSize || 0),
    playerWorkerHeapMB: mb(workerHeaps.reduce((total, heap) => total + Number(heap && heap.usedSize || 0), 0)),
    playerWorkerCount: workerHeaps.filter(Boolean).length,
    domNodes: values.Nodes || 0, listeners: values.JSEventListeners || 0,
    state, processes };
}

async function remoteHostCount(cdp, workerSession) {
  const result = await cdp.send('Runtime.evaluate', { expression:
    'chrome.storage.local.get("wardenone_aux_lists").then((value) =>'
    + ' Object.values(value.wardenone_aux_lists || {}).reduce((total, item) =>'
    + ' total + (Array.isArray(item) ? item.length : 0), 0))',
    awaitPromise: true, returnByValue: true }, workerSession).catch(() => null);
  return result && result.result && Number(result.result.value) || 0;
}

async function waitRemoteHosts(cdp, workerSession) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const count = await remoteHostCount(cdp, workerSession);
    if (count > 0) { await sleep(2000); return count; }
    await sleep(1000);
  }
  return 0;
}

async function runOne(site, variant, seconds, warmup, extensionDir, version, skipRemoteWait, noise) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-real-sites-'));
  const port = await browser.freePort();
  let cdp;
  try {
    const edge = await browser.launch(browser.edgePath(), 'on', extensionDir, port, profileDir,
      ['--autoplay-policy=no-user-gesture-required']);
    cdp = new browser.Cdp(edge.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await browser.extensionReady(cdp, port, version);
    await browser.closeExtensionTabs(cdp, port, extension.id);
    if (noise) {
      const result=await cdp.send('Runtime.evaluate',{expression:'updateStoredConfig(c=>{c.antiFingerprintNoise=true;}).then(()=>true)',awaitPromise:true,returnByValue:true},extension.attachedSession);
      if(result.exceptionDetails||result.result.value!==true)throw Error('Cannot enable fingerprint noise');
      const end=Date.now()+30000;
      while(true){
        const ready=await cdp.send('Runtime.evaluate',{expression:'!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&!__refreshExtensionStateTimer&&!__refreshExtensionStateQueued',returnByValue:true},extension.attachedSession);
        if(ready.result.value===true)break;
        if(Date.now()>end)throw Error('Fingerprint noise configuration did not settle');
        await sleep(50);
      }
    }
    const remoteHostsStart = skipRemoteWait ? await remoteHostCount(cdp, extension.attachedSession)
      : await waitRemoteHosts(cdp, extension.attachedSession);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Performance.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    const responses = new Map();
    const networkSessions = new Set([sessionId]);
    const network = { playlist: { count: 0, bytes: 0, maxBytes: 0 },
      media: { count: 0, bytes: 0, maxBytes: 0 }, json: { count: 0, bytes: 0, maxBytes: 0 } };
    const offNetwork = cdp.on((message) => {
      if (message.method === 'Target.attachedToTarget' && message.sessionId === sessionId
          && message.params && message.params.targetInfo
          && ['worker', 'shared_worker'].includes(message.params.targetInfo.type)) {
        const child = message.params.sessionId;
        networkSessions.add(child);
        cdp.send('Network.enable', {}, child).catch(() => networkSessions.delete(child));
        return;
      }
      if (!networkSessions.has(message.sessionId) || !message.params) return;
      const params = message.params;
      const requestKey = message.sessionId + ':' + params.requestId;
      if (message.method === 'Network.responseReceived') {
        const url = String(params.response && params.response.url || '');
        const mime = String(params.response && params.response.mimeType || '').toLowerCase();
        const kind = /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/.test(mime) ? 'playlist'
          : /(?:\.ts|\.m4s|\.mp4|\.aac)(?:[?#]|$)/i.test(url)
            || /googlevideo\.com\/videoplayback/i.test(url) || /video\/|audio\//.test(mime) ? 'media'
            : /json/.test(mime) ? 'json' : null;
        if (kind) responses.set(requestKey, kind);
      } else if (message.method === 'Network.loadingFinished') {
        const kind = responses.get(requestKey);
        responses.delete(requestKey);
        if (!kind) return;
        const bytes = Number(params.encodedDataLength) || 0;
        network[kind].count++;
        network[kind].bytes += bytes;
        network[kind].maxBytes = Math.max(network[kind].maxBytes, bytes);
      } else if (message.method === 'Network.loadingFailed') responses.delete(requestKey);
    });
    await cdp.send('Target.setAutoAttach', { autoAttach: true,
      waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    const navigationStart = Date.now();
    await cdp.send('Page.navigate', { url: SITES[site] }, sessionId);
    const readiness = await waitForSite(cdp, sessionId, site, navigationStart, warmup);
    if (site === 'youtube' || site === 'twitch') {
      await cdp.send('Page.bringToFront', {}, sessionId);
      const playback = await cdp.send('Runtime.evaluate', { expression: `(async () => {
        const video = document.querySelector('video');
        if (!video) throw Error('Video player unavailable');
        video.muted = true;
        await video.play();
        return true;
      })()`, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      if (playback.exceptionDetails || playback.result.value !== true)
        throw Error('Video playback did not start: ' + (playback.exceptionDetails?.exception?.description || playback.exceptionDetails?.text || 'unknown result'));
    }
    await cdp.send('HeapProfiler.collectGarbage', {}, sessionId).catch(() => {});
    const samples = [await sample(cdp, sessionId, networkSessions)];
    for (let elapsed = 0; elapsed < seconds; elapsed += 30) {
      if (site === 'images') {
        await cdp.send('Runtime.evaluate', { expression: 'window.scrollBy(0, innerHeight * 1.5)' }, sessionId).catch(() => {});
      }
      await sleep(Math.min(30, seconds - elapsed) * 1000);
      samples.push(await sample(cdp, sessionId, networkSessions));
      console.log(site + ' ' + variant + ': ' + Math.min(elapsed + 30, seconds) + '/' + seconds + ' s');
    }
    await cdp.send('HeapProfiler.collectGarbage', {}, sessionId).catch(() => {});
    const afterGc = await sample(cdp, sessionId, networkSessions);
    const remoteHostsEnd = await remoteHostCount(cdp, extension.attachedSession);
    const first = samples[0], last = samples.at(-1);
    const cpuMax = new Map();
    for (const item of samples) {
      for (const [pid, value] of Object.entries(item.processes.cpuByPid || {})) {
        cpuMax.set(pid, Math.max(cpuMax.get(pid) || 0, value));
      }
    }
    const browserCpuSeconds = [...cpuMax].reduce((sum, [pid, value]) =>
      sum + Math.max(0, value - (first.processes.cpuByPid[pid] || 0)), 0);
    offNetwork();
    return { site, variant, url: SITES[site], browser: edge.Browser, readiness,
      remoteHostsStart, remoteHostsEnd,
      network, networkTargetCount: networkSessions.size,
      durationSeconds: (last.elapsedMs - first.elapsedMs) / 1000,
      taskMs: Math.round((last.taskSeconds - first.taskSeconds) * 1000),
      scriptMs: Math.round((last.scriptSeconds - first.scriptSeconds) * 1000),
      browserCpuSeconds: Math.round(browserCpuSeconds * 100) / 100,
      heapStartMB: first.heapMB, heapEndGcMB: afterGc.heapMB,
      privateStartMB: first.processes.privateMB, privateEndMB: last.processes.privateMB,
      workingSetStartMB: first.processes.workingSetMB, workingSetEndMB: last.processes.workingSetMB,
      samples };
  } finally {
    if (cdp) { try { await browser.killBrowser(cdp, port); } catch (_) {} cdp.close(); }
    const resolved = path.resolve(profileDir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
        && path.basename(resolved).startsWith('wo-real-sites-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const currentRoot=args.extension||ROOT;
  const version = JSON.parse(fs.readFileSync(path.join(currentRoot, 'manifest.json'), 'utf8')).version;
  const headDir = args.variants.includes('head') ? fs.mkdtempSync(path.join(os.tmpdir(), 'wo-real-head-')) : null;
  const report = { date: new Date().toISOString(), version, seconds: args.seconds,
    warmupSeconds: args.warmup, sites: args.sites, variants: args.variants, extensionDirectory:currentRoot,noiseRequested:!!args.noise,results: [],complete:false };
  try {
    if (headDir) copyHead(headDir);
    for (const site of args.sites) {
      const order = args.sites.indexOf(site) % 2 ? [...args.variants].reverse() : args.variants;
      for (const variant of order) {
        console.log('Starting ' + site + ' ' + variant);
        try {
          report.results.push(await runOne(site, variant, args.seconds, args.warmup,
            variant === 'head' ? headDir : currentRoot, version, args.skipRemoteWait, args.noise));
        } catch (error) {
          report.results.push({ site, variant, error: String(error && error.message || error) });
          console.error(site + ' ' + variant + ': ' + error);
        }
        fs.mkdirSync(path.dirname(args.out), { recursive: true });
        report.complete=report.results.length===args.sites.length*args.variants.length&&report.results.every(sampleSuccessful);
        fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
      }
    }
  } finally {
    if (headDir) {
      const resolved = path.resolve(headDir);
      if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
          && path.basename(resolved).startsWith('wo-real-head-')) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  }
  if(!report.complete){console.error('Live-site validation incomplete: a page was not ready or video did not advance.');process.exitCode=1;}
  console.log('written: ' + args.out);
}

module.exports={processState,pageState,siteReady,sampleSuccessful,SITES,waitForSite};
if(require.main===module)browser.mustFinish(main, 'perf-real-sites').catch((error) => {
  console.error(error); process.exitCode = 1;
});

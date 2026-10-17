/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

/* Paired representation comparison using the same full refreshed lists and browser worker.
   The debugger holds that worker awake; this does not model ordinary idle-worker suspension. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mib = (value) => Math.round(value / 1048576 * 100) / 100;

async function processMemory(cdp) {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const ids = processInfo.map((p) => Number(p.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const command = '$sampleIds=@(' + ids.join(',') + '); $privateWorking=@{}; $extensionProcesses=@{}; '
    + 'Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $sampleIds -contains [int]$_.IDProcess } '
    + '| ForEach-Object { $privateWorking[[int]$_.IDProcess]=[long]$_.WorkingSetPrivate }; '
    + 'Get-CimInstance Win32_Process | Where-Object { $sampleIds -contains [int]$_.ProcessId } '
    + '| ForEach-Object { $extensionProcesses[[int]$_.ProcessId]=$_.CommandLine -like "*--extension-process*" }; '
    + 'Get-Process -Id $sampleIds -ErrorAction SilentlyContinue | ForEach-Object { '
    + '[pscustomobject]@{pid=$_.Id;privateBytes=$_.PrivateMemorySize64;workingSet=$_.WorkingSet64;'
    + 'privateWorkingSet=$privateWorking[$_.Id];extension=$extensionProcesses[$_.Id]} } | ConvertTo-Json -Compress';
  const rows = [].concat(JSON.parse(execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 20000 })));
  assert(rows.some((row) => row.extension && row.privateWorkingSet > 0), 'extension private working set available');
  return { rows, extensionPrivateMiB: mib(rows.filter((p) => p.extension).reduce((n, p) => n + p.privateBytes, 0)),
    extensionPrivateWorkingSetMiB: mib(rows.filter((p) => p.extension).reduce((n, p) => n + p.privateWorkingSet, 0)),
    browserPrivateMiB: mib(rows.reduce((n, p) => n + p.privateBytes, 0)),
    browserPrivateWorkingSetMiB: mib(rows.reduce((n, p) => n + p.privateWorkingSet, 0)) };
}

async function run() {
  const output = process.argv[2];
  assert(output && path.isAbsolute(output), 'provide an absolute JSON output path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-domain-memory-'));
  const extensionDir = path.join(dir, 'baseline');
  fs.mkdirSync(extensionDir);
  const files = JSON.parse(fs.readFileSync(path.join(root, 'tools/package-allowlist.json'), 'utf8'));
  for (const file of files) {
    const target = path.join(extensionDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(extensionDir, 'background.js'), execFileSync('git', ['show', 'HEAD:background.js'],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 }));
  const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const start = source.indexOf('function blockedDomainIndex(');
  const end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start);
  const helper = source.slice(start, end);
  const port = await profile.freePort();
  let cdp;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', extensionDir, port, path.join(dir, 'profile'));
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const ext = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version);
    await profile.closeExtensionTabs(cdp, port, ext.id);
    const session = ext.attachedSession;
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    for (const deadline = Date.now() + 180000;; await sleep(500)) {
      if (await evaluate('!__remoteListUpdateInFlight&&!!__refreshExtensionStateLastKey&&!__refreshExtensionStateInFlightKey&&LIST_BROKER.stats().holders===0')) break;
      if (Date.now() > deadline) throw new Error('Lists did not settle');
    }
    await evaluate('updateStoredConfig(cfg=>Object.assign(cfg,{autoUpdateLists:false})).then(()=>true)');
    const data = await evaluate(`({security:[...SECURITY_DOMAINS],other:[...BLOCKED_DOMAINS].filter(d=>!SECURITY_DOMAINS.has(d))})`);
    assert(data.security.length > 100000, 'a full security feed was loaded');
    const body = JSON.stringify(data);
    const counts = { security: data.security.length, other: data.other.length, total: data.security.length + data.other.length };
    fs.writeFileSync(path.join(extensionDir, 'memory-domain-input.json'), body);
    await evaluate(helper + '\ntrue');
    const results = [];
    for (const variant of ['baseline', 'shared', 'shared', 'baseline', 'baseline', 'shared']) {
      const verified = await evaluate(`(async()=>{
        const data=await fetch(chrome.runtime.getURL('memory-domain-input.json')).then(r=>r.json());
        const security=new Set(data.security),merged=new Set(data.security.concat(data.other));
        SECURITY_DOMAINS=security;
        BLOCKED_DOMAINS=${variant === 'baseline' ? 'merged' : 'blockedDomainIndex(merged,security)'};
        for(const domain of data.security)if(!BLOCKED_DOMAINS.has(domain)||!SECURITY_DOMAINS.has(domain))throw Error('Lost security membership');
        for(const domain of data.other)if(!BLOCKED_DOMAINS.has(domain)||SECURITY_DOMAINS.has(domain))throw Error('Changed category');
        for(let i=0;i<10000;i++)if(BLOCKED_DOMAINS.has('missing-'+i+'.wardenone-memory.invalid'))throw Error('Unexpected negative match');
        if(BLOCKED_DOMAINS.size!==merged.size)throw Error('Changed domain count');
        return {total:BLOCKED_DOMAINS.size,security:SECURITY_DOMAINS.size};
      })()`);
      await cdp.send('HeapProfiler.collectGarbage', {}, session);
      await sleep(1500);
      const heap = await cdp.send('Runtime.getHeapUsage', {}, session);
      const memory = await processMemory(cdp);
      results.push({ variant, verified, heapMiB: mib(heap.usedSize), memory });
      fs.writeFileSync(output, JSON.stringify({ browser: browser.Browser, baselineCommit, counts, results }, null, 2));
      console.log(JSON.stringify({ variant, heapMiB: mib(heap.usedSize), extensionPrivateMiB: memory.extensionPrivateMiB,
        extensionPrivateWorkingSetMiB: memory.extensionPrivateWorkingSetMiB, browserPrivateWorkingSetMiB: memory.browserPrivateWorkingSetMiB }));
    }
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert(path.basename(dir).startsWith('wo-domain-memory-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
profile.mustFinish(run, 'bench-domain-index-memory').catch((error) => { console.error(error); process.exitCode = 1; });

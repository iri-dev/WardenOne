/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const HOST = 'download.wardenone-hash.example.com';
const CDN = 'cdn.wardenone-hash.example.com';
const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const expected = createHash('sha256').update(bytes).digest('hex');

async function run() {
  const hits = [];
  const serverPort = await profile.freePort();
  const base = `http://${HOST}:${serverPort}`;
  const final = `http://${CDN}:${serverPort}/file?signature=fixture`;
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie });
    const route = new URL(req.url, base).pathname;
    let location = '';
    let status = 302;
    if (route === '/start') location = '/cross';
    if (route === '/cross') { location = final; status = 307; }
    if (route.startsWith('/status/')) { location = final; status = Number(route.split('/').pop()); }
    if (route === '/private') location = `http://127.0.0.1:${serverPort}/private-file`;
    if (route === '/later-private') location = '/private';
    if (route === '/loop') location = '/loop';
    if (route === '/non-web') location = 'data:text/plain,not-a-file';
    if (location) { res.writeHead(status, { Location: location, 'cache-control': 'no-store' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store' });
    res.end(bytes);
  });
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-download-hash-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      [`--host-resolver-rules=MAP ${HOST} 127.0.0.1, MAP ${CDN} 127.0.0.1`]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    const evaluate = async (expression) => {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, extension.attachedSession);
      if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails));
      return out.result.value;
    };
    const hash = (url, cap = 1024) => evaluate(`(async()=>{
      const r=await fetchBytesForHash(${JSON.stringify(url)},${cap});
      const {bytes,...summary}=r;
      return {...summary,sha256:r.ok?await sha256Hex(bytes):null};
    })()`);
    // Public fixture names deliberately resolve to loopback; test the hash URL gate independently of DNS quarantine.
    await evaluate('updateStoredConfig(cfg=>{cfg.dnsRebindGuard=false;})');
    await evaluate(`chrome.cookies.set({url:${JSON.stringify(base)},name:'hash-fixture',value:'must-not-be-sent'})`);
    const raw = await evaluate(`fetch(${JSON.stringify(base + '/start')},{redirect:'manual',credentials:'omit',cache:'no-store'}).then(r=>({type:r.type,status:r.status}))`);
    assert.deepEqual(raw, { type: 'opaqueredirect', status: 0 });
    const result = await hash(base + '/start');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.finalUrl, final); assert.equal(result.redirects, 2);
    assert.equal(result.sha256, expected); assert.equal(result.exactFile, false);
    for (const status of [301, 302, 303, 307, 308]) {
      const r = await hash(base + '/status/' + status);
      assert.equal(r.ok, true, status + ': ' + JSON.stringify(r)); assert.equal(r.sha256, expected); assert.equal(r.redirects, 1);
    }
    for (const route of ['/private', '/later-private', '/non-web']) {
      const r = await hash(base + route); assert.equal(r.ok, false, route + ': ' + JSON.stringify(r));
    }
    assert(!hits.some((h) => h.url === '/private-file'), 'no private destination was fetched');
    const beforeLoop = hits.filter((h) => h.url === '/loop').length;
    assert.match((await hash(base + '/loop')).reason, /too many redirects/);
    assert.equal(hits.filter((h) => h.url === '/loop').length - beforeLoop, 5);
    assert.equal((await hash(base + '/start', 100)).skipped, true);
    const parallel = await evaluate(`Promise.all([fetchBytesForHash(${JSON.stringify(base + '/start')},1024),fetchBytesForHash(${JSON.stringify(base + '/start')},1024)]).then(rs=>Promise.all(rs.map(async r=>({ok:r.ok,sha256:r.ok?await sha256Hex(r.bytes):null}))))`);
    assert(parallel.every((r) => r.ok && r.sha256 === expected), JSON.stringify(parallel));
    assert(!hits.some((h) => h.cookie), 'all hops omit cookies');
    assert.equal(await evaluate('DOWNLOAD_HASH_HOP_QUEUES.size'), 0);
    assert.equal(await evaluate('DOWNLOAD_HASH_ACTIVE_HOPS.size'), 0);
    console.log('[ok] ' + browser.Browser + ': final-response SHA-256 through all redirect statuses; private targets untouched, limits and concurrent requests preserved');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-download-hash-/.test(path.basename(resolved))) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
profile.mustFinish(run, 'browser-download-hash-redirects').catch((e) => { console.error(e.stack || e); process.exitCode = 1; });

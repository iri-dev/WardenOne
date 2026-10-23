/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { webcrypto, createHash } = require('crypto');
const source = fs.readFileSync('background-downloads.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');
function region(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return text.slice(a, b);
}
function event() {
  const listeners = new Set();
  return { listeners, addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); },
    emit(details) { for (const fn of [...listeners]) fn(details); } };
}
const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const START = 'https://download.example.com/start';
const FILE = 'https://cdn.example.com/file.bin';
function world(routes, options = {}) {
  const before = event(), redirect = event(), calls = [], controllers = [];
  const now = Date.now();
  let nextId = 0;
  const box = {
    URL, Uint8Array, ArrayBuffer, AbortController, setTimeout, clearTimeout, crypto: webcrypto, Date: { now: () => now },
    DOWNLOAD_HASH_TIMEOUT_MS: options.timeout || 1000, DOWNLOAD_HASH_SOURCE_KIND: 'url_refetch',
    formatBytesShort: (n) => n + ' B',
    chrome: { runtime: { getURL: (p) => ORIGIN + '/' + p }, webRequest: { onBeforeRequest: before, onBeforeRedirect: redirect } },
    async fetch(url, init) {
      calls.push(url); controllers.push(init.signal);
      assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
      const details = { url, initiator: ORIGIN, method: 'GET', type: 'xmlhttprequest', tabId: -1, requestId: String(++nextId), timeStamp: now + (options.timeStampOffset || 0) };
      before.emit(details);
      const route = routes[url]; assert(route, 'unexpected request ' + url);
      if (route.error) throw new Error(route.error);
      if (route.redirect) {
        if (options.extra) options.extra({ before, redirect, details });
        if (!options.missing) setTimeout(() => redirect.emit({ ...details, redirectUrl: route.redirect, statusCode: 302 }), 0);
        return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), body: null };
      }
      return new Response(route.bytes || 'final response', { status: route.status || 200, headers: route.headers || {} });
    },
  };
  if (options.unavailable) box.chrome.webRequest = {};
  vm.createContext(box);
  vm.runInContext(region(background, 'function ipv4FromMappedIpv6(', 'function ipFromUrl(')
    + region(source, 'const DOWNLOAD_HASH_HOP_QUEUES =', 'function normalizeDownloadHashSourceKind(')
    + '\nthis.api={fetchBytesForHash,sha256Hex,pending:DOWNLOAD_HASH_HOP_QUEUES,active:DOWNLOAD_HASH_ACTIVE_HOPS};', box);
  return { api: box.api, calls, controllers, before, redirect };
}
function released(w) {
  assert.equal(w.before.listeners.size, 1); assert.equal(w.redirect.listeners.size, 1);
  assert.equal(w.api.pending.size, 0); assert.equal(w.api.active.size, 0);
}
async function run() {
  const routes = { [START]: { redirect: FILE }, [FILE]: { bytes: 'redirected file bytes' } };
  const w = world(routes);
  const result = await w.api.fetchBytesForHash(START + '#not-sent', 100);
  assert.equal(result.ok, true); assert.equal(result.redirects, 1); assert.equal(result.finalUrl, FILE);
  assert.equal(result.requestedUrl, START); assert.equal(result.exactFile, false);
  assert.equal(await w.api.sha256Hex(result.bytes), createHash('sha256').update('redirected file bytes').digest('hex'));
  assert.deepEqual(w.calls, [START, FILE]); released(w);

  for (const timeStampOffset of [-11.12, -1.36, -0.375, 0, 1]) {
    const t = world(routes, { timeStampOffset });
    assert.equal((await t.api.fetchBytesForHash(START, 100)).ok, true, 'browser timestamp offset ' + timeStampOffset);
    released(t);
  }
  const earlier = world(routes, { timeStampOffset: -51, timeout: 20 });
  assert.equal((await earlier.api.fetchBytesForHash(START, 100)).ok, false, 'a request from before the clock slack cannot register');
  assert.deepEqual(earlier.calls, [START]); released(earlier);

  for (const target of ['http://127.0.0.1/file', 'http://2130706433/file', 'http://10.0.0.1/file',
    'http://192.168.0.1/file', 'http://169.254.169.254/file', 'http://localhost/file', 'http://host.local/file',
    'http://[::1]/file', 'http://[::ffff:127.0.0.1]/file', 'http://[fe90::1]/file', 'http://[fd00::1]/file',
    'file:///private/file', 'data:text/plain,secret', 'ftp://public.example.com/file', 'http://[invalid']) {
    const t = world({ [START]: { redirect: target } });
    const r = await t.api.fetchBytesForHash(START, 100);
    assert.equal(r.ok, false, target); assert.deepEqual(t.calls, [START], target); released(t);
  }
  for (const url of ['http://localhost/file', 'http://127.1/file', 'http://[::1]/file', 'file:///file']) {
    const t = world({}); assert.equal((await t.api.fetchBytesForHash(url, 100)).skipped, true);
    assert.equal(t.calls.length, 0); released(t);
  }
  const localSecond = world({ [START]: { redirect: FILE }, [FILE]: { redirect: 'http://10.0.0.1/file' } });
  assert.equal((await localSecond.api.fetchBytesForHash(START, 100)).ok, false);
  assert.deepEqual(localSecond.calls, [START, FILE]); released(localSecond);

  const loop = world({ [START]: { redirect: START } });
  const loopResult = await loop.api.fetchBytesForHash(START, 100);
  assert.match(loopResult.reason, /too many redirects/); assert.equal(loop.calls.length, 5); released(loop);

  const foreign = world(routes, { extra: ({ before, redirect, details }) => {
    for (const extra of [{ initiator: 'https://page.example' }, { tabId: 7 }, { url: 'https://unrelated.example/' }, { method: 'POST' }]) {
      const other = { ...details, ...extra, requestId: 'foreign' };
      before.emit(other); redirect.emit({ ...other, redirectUrl: 'http://127.0.0.1/' });
    }
  } });
  assert.equal((await foreign.api.fetchBytesForHash(START, 100)).ok, true); released(foreign);

  const stale = world(routes, { extra: ({ before, redirect, details }) => {
    const old = { ...details, requestId: 'earlier-fetch', timeStamp: details.timeStamp - 10000 };
    before.emit(old); redirect.emit({ ...old, redirectUrl: 'https://wrong.example.com/' });
  } });
  const fresh = await stale.api.fetchBytesForHash(START, 100);
  assert.equal(fresh.ok, true); assert.equal(fresh.finalUrl, FILE); released(stale);

  const ambiguous = world(routes, { extra: ({ before, redirect, details }) => {
    const other = { ...details, requestId: 'another-worker-request' };
    before.emit(other); redirect.emit({ ...other, redirectUrl: 'https://wrong.example.com/' });
  } });
  assert.equal((await ambiguous.api.fetchBytesForHash(START, 100)).ok, false);
  assert.deepEqual(ambiguous.calls, [START]); released(ambiguous);

  for (const options of [{ unavailable: true }, { missing: true, timeout: 20 }]) {
    const t = world(routes, options); assert.equal((await t.api.fetchBytesForHash(START, 100)).ok, false);
    assert.deepEqual(t.calls, [START]);
    if (options.unavailable) { assert.equal(t.api.active.size, 0); assert.equal(t.api.pending.size, 0); }
    else released(t);
  }
  const concurrent = world(routes);
  const parallel = await Promise.all([concurrent.api.fetchBytesForHash(START, 100), concurrent.api.fetchBytesForHash(START, 100)]);
  assert(parallel.every((r) => r.ok)); released(concurrent);

  for (const headers of [{ 'content-length': '200' }, {}]) {
    const t = world({ [START]: { redirect: FILE }, [FILE]: { bytes: 'x'.repeat(200), headers } });
    assert.equal((await t.api.fetchBytesForHash(START, 100)).skipped, true); released(t);
  }
  const failed = world({ [START]: { error: 'network failed' } });
  assert.equal((await failed.api.fetchBytesForHash(START, 100)).ok, false); released(failed);
  console.log('[ok] opaque download redirects hash final bytes; private targets, ambiguity, limits and cleanup stay guarded');
}
run().catch((e) => { console.error(e); process.exitCode = 1; });

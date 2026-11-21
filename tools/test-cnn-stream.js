#!/usr/bin/env node
'use strict';

/* CNN video without ads: the playback API answer is rewritten to start the plain fallback copy CNN already lists, only
   on CNN, only for that API, and only when the answer has an ad-stitched stream and a plain fallback. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8');
const start = SRC.indexOf('    /* CNN stitches its prerolls into the stream on its own servers.');
const end = SRC.indexOf('    if(WO.adShield)try{', start);
assert(start > 0 && end > start, 'CNN block not found');
const BLOCK = SRC.slice(start, end);

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const API = 'https://default.any-any.prd.api.bolt.cnn.com/any/playback/v1/playbackInfo';
const sample = () => ({
  cdn: { provider: 'cloudfront', providerDomains: ['cf.example.cnn.com'] },
  videos: [{ duration: 46.8, manifestationId: 'abc', type: 'main' }],
  ssaiInfo: { forecastTimeline: [{ event: { schema: 'beacon', type: 'impression' } }] },
  manifest: { url: 'https://cf.example.cnn.com/global/abc/dash.mpd?rtype=s&pid=1', type: 'ssai', format: 'dash' },
  fallback: {
    manifest: { url: 'https://cf.example.cnn.com/global/abc/3_9b0ef3_fallback.mpd', type: 'single-video', format: 'dash' },
    videos: [{ duration: 46.8, manifestationId: 'abc', type: 'main', fallback: true }],
    cdn: { provider: 'cloudfront-fallback', providerDomains: ['cf.example.cnn.com'] },
  },
  capabilities: { a: 1 },
});

function world(opts) {
  opts = opts || {};
  const logs = [];
  const calls = [];
  const answers = opts.answers || {};
  const realFetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url || String(input);
    calls.push(url);
    const a = answers[url] || { body: '{}', status: 200 };
    const res = new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status || 200, headers: { 'content-type': 'application/json', 'content-length': '999' } });
    /* A network response carries its address; a constructed one does not. */
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  const window = { fetch: realFetch };
  const ctx = {
    window, WO: { adShield: opts.adShield !== false }, WO_TOP: opts.top !== false, location: { hostname: opts.host || 'edition.cnn.com' },
    log: (type, detail) => logs.push({ type, detail }), Response, Headers, Object, JSON, String,
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK, ctx, { filename: 'cnn-block.js' });
  return { fetch: (...a) => ctx.window.fetch(...a), wrapped: ctx.window.fetch !== realFetch, logs, calls };
}

(async () => {
  /* 1. The ad-stitched answer becomes the plain fallback. */
  {
    const w = world({ answers: { [API]: { body: sample() } } });
    ok(w.wrapped, 'fetch is wrapped on CNN');
    const res = await w.fetch(API, { method: 'POST' });
    const info = await res.json();
    ok(info.manifest.type === 'single-video' && /fallback\.mpd$/.test(info.manifest.url), 'primary stream is the plain copy');
    ok(!('ssaiInfo' in info), 'the ad schedule is gone, so no ad beacons fire');
    ok(info.fallback && info.fallback.manifest.type === 'single-video', 'the fallback entry stays (the player reads it unchecked)');
    ok(info.videos[0].fallback === true && info.cdn.provider === 'cloudfront-fallback', 'videos and cdn come from the fallback');
    ok(info.capabilities && info.capabilities.a === 1, 'fields the fallback does not have are kept');
    ok(res.status === 200 && res.url === API, 'status and address are kept');
    ok(!res.headers.get('content-length'), 'the stale length header is dropped');
    ok(w.logs.length === 1 && w.logs[0].type === 'adshield_plain_stream' && !JSON.stringify(w.logs[0].detail).includes('mpd'), 'a quiet engine note records it without addresses');
  }
  /* 2. Near misses are passed through untouched. */
  const passes = async (label, body, url, opts) => {
    const w = world(Object.assign({ answers: { [url || API]: { body, status: (opts && opts.status) || 200 } } }, opts || {}));
    const res = await w.fetch(url || API);
    const text = await res.text();
    ok(text === (typeof body === 'string' ? body : JSON.stringify(body)), label);
    ok(w.logs.length === 0, label + ' (no activity entry)');
  };
  const noSsai = sample(); noSsai.manifest.type = 'single-video';
  await passes('a stream without ads is left alone', noSsai);
  const noFallback = sample(); delete noFallback.fallback;
  await passes('an answer with no fallback is left alone', noFallback);
  const ssaiFallback = sample(); ssaiFallback.fallback.manifest.type = 'ssai';
  await passes('a fallback that also has ads is left alone', ssaiFallback);
  const noUrl = sample(); delete noUrl.fallback.manifest.url;
  await passes('a fallback without a stream address is left alone', noUrl);
  await passes('a reply that is not JSON is left alone', 'not json at all');
  await passes('an error reply is left alone', { error: 'nope' }, API, { status: 500 });
  await passes('other CNN API calls are left alone', sample(), 'https://busy.any-emea.prd.api.bolt.cnn.com/markers/any/markers/v1/markers');
  await passes('a look-alike host is left alone', sample(), 'https://default.any-any.prd.api.bolt.cnn.com.attacker.example/any/playback/v1/playbackInfo');
  await passes('a similar path elsewhere is left alone', sample(), 'https://api.example.com/any/playback/v1/playbackInfo');
  /* 3. Only on CNN's own pages, in the top frame, with Ad Shield on. */
  ok(!world({ host: 'cnn.com.attacker.example' }).wrapped, 'not on look-alike hosts');
  ok(!world({ host: 'notcnn.com' }).wrapped, 'not on other sites');
  ok(world({ host: 'www.cnn.com' }).wrapped && world({ host: 'cnn.com' }).wrapped, 'every CNN host');
  ok(!world({ adShield: false }).wrapped, 'not with Ad Shield off');
  ok(!world({ top: false }).wrapped, 'not in frames');
  /* 4. A Request object and a URL object work like a string. */
  {
    const w = world({ answers: { [API]: { body: sample() } } });
    const res = await w.fetch(new Request(API));
    ok((await res.json()).manifest.type === 'single-video', 'Request input');
  }
  ok(!/\/\/ /.test(BLOCK.replace(/https?:\/\//g, '').replace(/\/\^https:\\\/\\\//, '')), 'no line comments in the engine block');
  console.log('[ok] CNN stream checks passed (' + checks + ')');
})().catch((err) => { console.error(err); process.exit(1); });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const { loadNetworkParser } = require('./bench-filter-parsing.js');
const { loadBackground } = require('./test-message-rate-limits.js');
const source = fs.readFileSync('background.js', 'utf8');
async function run() {
  const parser = loadNetworkParser(source);
  const deep = '{"domains":["first.example"],"tail":' + '['.repeat(20000) + '"last.example"' + ']'.repeat(20000) + '}';
  for (const text of [deep, '{"domains":["first.example"],"tail":',
    '{"__proto__":{"domains":["first.example"]}}', '{"domains":[' + '0,'.repeat(500000) + '0]}']) {
    assert.throws(() => parser.parseList(text), /Integrity guard rejected source:/, 'invalid JSON shape must reject the whole source, not return a partial/empty list');
  }
  assert.deepEqual(Array.from(parser.parseList('[Adblock Plus 2.0]\n||valid.example^\n')), ['valid.example']);
  assert.deepEqual(Array.from(parser.parseList('{"domains":["valid.example"],"allowlist":["allowed.example"]}')), ['valid.example']);
  const h = loadBackground();
  await new Promise(resolve => setTimeout(resolve, 80));
  for (const url of ['https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_3_Spyware/filter.txt',
    'https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-online.txt']) {
    const policy=h.ctx.validateRemoteListSource(url,true);
    assert.equal(policy.ok,true);assert.equal(policy.maxBytes,16*1024*1024);
    let cancelled=false;
    h.ctx.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(policy.maxBytes+1)}),cancel:async()=>{cancelled=true;}})}});
    const over=await h.ctx.fetchRemoteListTextRaw(policy,100);
    assert.equal(over.ok,false);assert.equal(over.integrityRejected,true);assert.equal(cancelled,true);
    assert.equal(h.ctx.validateRemoteListSource(url+'?unreviewed=1',true).ok,false,'growth allowance does not admit a new URL');
  }
  for (const text of [deep, '{"domains":[', '{"__proto__":{"grabberDomainsExtra":["first.example"]}}']) {
    assert.throws(() => h.ctx.parseSupplementalManifestText(text), /Integrity guard rejected source:/);
  }
  const requests = [];
  h.ctx.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, status: 302 }; };
  let result = await h.ctx.fetchRemoteListTextRaw({ url: 'https://feed.example/list', maxBytes: 1024 }, 100);
  assert.equal(result.ok, false); assert.equal(result.integrityRejected, true);
  assert.equal(requests[0].options.redirect, 'manual'); assert.equal(requests[0].options.credentials, 'omit');
  let cancelled = false, chunk = 0;
  h.ctx.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '1' }, body: { getReader: () => ({
    async read() { return chunk++ ? { done: true } : { done: false, value: new Uint8Array(1025) }; },
    async cancel() { cancelled = true; },
  }) } });
  result = await h.ctx.fetchRemoteListTextRaw({ url: 'https://feed.example/list', maxBytes: 1024 }, 100);
  assert.equal(result.ok, false); assert.equal(result.integrityRejected, true); assert.equal(cancelled, true);
  for (const url of ['http://feed.example/list', 'https://feed.example:8443/list', 'https://feed.example@evil.example/list', 'https://127.0.0.1/list']) {
    assert.equal(h.ctx.validateRemoteListSource(url, true).ok, false);
  }
  console.log('[ok] bounded JSON trees, atomic source rejection, redirects, streaming byte caps and exact feed URL policy');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

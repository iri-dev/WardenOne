/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A list refresh fetches each source once, four at a time, and lets go of what it downloaded.
 * Run: node tools/test-list-fetch-broker.js
 *
 * Three pipelines read the remote lists -- the network sets, the cosmetic set and the supplemental
 * buckets -- and each owned its own fetches. A default refresh therefore made 40 requests for 37
 * addresses: EasyList and AdGuard's tracking filter were downloaded once for the network rules and
 * again for the cosmetic rules, Anti-Grabify once for the grabber rules and again for the page-side
 * grabber list; and the ten cosmetic downloads ran all at once beside the four-wide network batch,
 * so up to fourteen multi-megabyte bodies were in flight together (PERF-07).
 *
 * Now one broker sits under all three: one request per address per refresh, a body more than one
 * pipeline has planned to read is kept until the last of them has taken it and released the moment
 * it has, every fetch waits in one queue of LIST_FETCH_CONCURRENCY, and the cosmetic pipeline is
 * started after the network batch instead of beside it. Nothing about what a pipeline may read
 * changed: each still validates the address against its own policy first, and the byte cap is a
 * property of the address. This suite drives the real broker with the real source lists through a
 * fake fetch that counts requests and in-flight bodies, the way the card's verification asks.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function balanced(src, start, open, close) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) { depth++; seen = true; } else if (src[i] === close) {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated block');
}
function grabFn(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(BG);
  assert(m, 'missing ' + name);
  return balanced(BG, m.index, '{', '}');
}
const has = (name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(BG);
function constArray(name) {
  const i = BG.indexOf('const ' + name + ' = [');
  assert(i >= 0, 'missing ' + name);
  return balanced(BG, i, '[', ']') + ';';
}
function constLine(name) {
  const m = new RegExp('^const ' + name + ' = [^\\n]+$', 'm').exec(BG);
  assert(m, 'missing ' + name);
  return m[0];
}
function constBlock(name) {
  /* `const NAME = (() => { ... })();` */
  const i = BG.indexOf('const ' + name + ' = (() => {');
  if (i < 0) return null;
  const body = balanced(BG, BG.indexOf('{', i), '{', '}');
  const end = BG.indexOf('})();', i + body.length - 1);
  return BG.slice(i, end + '})();'.length);
}

const LIFTED = [
  constArray('REMOTE_LISTS'), constArray('TOKEN_AND_SCAM_LISTS'), constArray('MALWARE_LISTS'), constArray('TRACKER_LISTS'),
  constArray('ADSHIELD_NET_LISTS'), constArray('ADSHIELD_COSMETIC_LISTS'), constLine('REMOTE_LIST_URL'),
  constLine('SUPPLEMENTAL_LIST_STORAGE_KEY'), constLine('SUPPLEMENTAL_LIST_META_KEY'), constLine('SUPPLEMENTAL_LIST_VERSION'),
  BG.slice(BG.indexOf('const SUPPLEMENTAL_LIST_SOURCES = ['), BG.indexOf('const SUPPLEMENTAL_LIST_SOURCES = [') + balanced(BG, BG.indexOf('const SUPPLEMENTAL_LIST_SOURCES = ['), '[', ']').length) + ';',
  constLine('SUPPLEMENTAL_BUNDLED_MANIFEST_PATH'), constLine('SUPPLEMENTAL_MANIFEST_URL'),
  BG.slice(BG.indexOf('const SUPPLEMENTAL_MANIFEST_SOURCES = ['), BG.indexOf('const SUPPLEMENTAL_SOURCE_URLS')),
  constLine('SUPPLEMENTAL_SOURCE_URLS'),
  constLine('LIST_FETCH_TIMEOUT_MS'), constLine('LIST_FETCH_CONCURRENCY'), constLine('LIST_SOURCE_MAX_BYTES'), constLine('LIST_COSMETIC_SOURCE_MAX_BYTES'),
  grabFn('expectedRemoteListSources'), grabFn('listSourceByteLimit'), grabFn('utf8ByteLength'), grabFn('readResponseTextWithByteLimit'),
  grabFn('validateRemoteListSource'),
  /* The fix's pieces; on the pre-fix source the raw fetcher is the whole function and there is no broker. */
  has('fetchRemoteListTextRaw') ? grabFn('fetchRemoteListTextRaw') : '',
  constBlock('LIST_BROKER') || 'const LIST_BROKER = { plan() {}, retain() {}, release() {}, stats() { return { bodies: 0, active: 0, queued: 0, holders: 0 }; } };',
  grabFn('fetchValidatedRemoteListText'),
].join('\n');

/* ---- the network, counted ---------------------------------------------------------------------- */
function realm(options) {
  const o = options || {};
  const state = { calls: [], inflight: 0, peak: 0, failOnce: new Set(o.failOnce || []), release: [] };
  const body = (url) => 'BODY-OF ' + url + '\n||example.invalid^\n';
  const sandbox = {
    console, Promise, Object, Array, String, Number, Boolean, Set, Map, JSON, Math, Error, RegExp, URL, Date,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, setImmediate,
    AbortController,
    fetch: (url, init) => {
      state.calls.push(url);
      state.inflight++;
      state.peak = Math.max(state.peak, state.inflight);
      return new Promise((resolve) => {
        /* Every response waits for the test to let it go, so concurrency is visible. */
        state.release.push(() => {
          state.inflight--;
          if (state.failOnce.has(url)) { state.failOnce.delete(url); resolve({ ok: false, status: 503, headers: { get: () => null } }); return; }
          const text = body(url);
          resolve({ ok: true, status: 200, headers: { get: (h) => (h === 'content-length' ? String(text.length) : null) }, body: null, text: async () => text });
        });
      });
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { fetchValidatedRemoteListText, LIST_BROKER, expectedRemoteListSources, ADSHIELD_COSMETIC_LISTS, REMOTE_LISTS, TOKEN_AND_SCAM_LISTS, MALWARE_LISTS, TRACKER_LISTS, ADSHIELD_NET_LISTS, SUPPLEMENTAL_LIST_SOURCES, LIST_FETCH_CONCURRENCY };', ctx, { filename: 'list-broker.js' });
  return { state, api: sandbox.api, body };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
/* Release the responses in flight, one wave at a time, until the work being waited on has settled. */
async function pump(r, work) {
  let done = false;
  const result = work.then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
  while (!done) {
    await settle();
    const wave = r.state.release.splice(0);
    for (const go of wave) go();
  }
  return result;
}

/* The three pipelines, as the worker runs them for a default configuration. */
function mainSources(api) {
  const out = [];
  const seen = new Set();
  for (const list of [api.REMOTE_LISTS, api.TOKEN_AND_SCAM_LISTS, api.MALWARE_LISTS, api.TRACKER_LISTS, api.ADSHIELD_NET_LISTS]) {
    for (const url of list) if (!seen.has(url)) { seen.add(url); out.push(url); }
  }
  return out;
}
async function refresh(r) {
  const api = r.api;
  const main = mainSources(api);
  const cosmetic = api.ADSHIELD_COSMETIC_LISTS.slice();
  const supplemental = api.SUPPLEMENTAL_LIST_SOURCES.map((s) => s.url);
  api.LIST_BROKER.retain();
  api.LIST_BROKER.plan(main.concat(cosmetic, supplemental));
  const results = { main: [], cosmetic: [], supplemental: [] };
  /* The network batch, four at a time as updateRemoteListsCore runs it. */
  const mainRun = (async () => {
    for (let i = 0; i < main.length; i += api.LIST_FETCH_CONCURRENCY) {
      const batch = main.slice(i, i + api.LIST_FETCH_CONCURRENCY);
      results.main.push(...await Promise.all(batch.map((u) => api.fetchValidatedRemoteListText(u, false, 25000))));
    }
  })();
  /* The cosmetic set: all ten at once, as updateAdShieldCosmetics issues them. */
  const cosmeticRun = (async () => {
    api.LIST_BROKER.retain();
    results.cosmetic = await Promise.all(cosmetic.map((u) => api.fetchValidatedRemoteListText(u, true, 25000)));
    api.LIST_BROKER.release();
  })();
  await pump(r, Promise.all([mainRun, cosmeticRun]));
  /* Then the supplemental buckets, as attachSupplementalListUpdate runs them. */
  results.supplemental = await pump(r, Promise.all(supplemental.map((u) => api.fetchValidatedRemoteListText(u, false, 25000))));
  api.LIST_BROKER.release();
  return { main, cosmetic, supplemental, results };
}

(async () => {
  {
    const r = realm();
    const unique = new Set(r.api.expectedRemoteListSources(true));
    const { main, cosmetic, supplemental, results } = await refresh(r);
    const asked = main.length + cosmetic.length + supplemental.length;
    const distinct = new Set(main.concat(cosmetic, supplemental));
    console.log('  [info] ' + asked + ' reads of ' + distinct.size + ' addresses; ' + r.state.calls.length + ' requests, peak ' + r.state.peak + ' in flight');
    check('a default refresh reads ' + asked + ' sources across three pipelines, of which ' + distinct.size + ' are distinct',
      asked === 40 && distinct.size === 37 && distinct.size <= unique.size, asked + ' / ' + distinct.size);
    check('and makes one request per address', r.state.calls.length === distinct.size, r.state.calls.length + ' request(s)');
    const dupes = r.state.calls.filter((u, i, a) => a.indexOf(u) !== i);
    check('no address is fetched twice', dupes.length === 0, [...new Set(dupes)].join(', '));
    check('never more than LIST_FETCH_CONCURRENCY bodies in flight, cosmetic and network together',
      r.state.peak <= r.api.LIST_FETCH_CONCURRENCY, r.state.peak + ' in flight (cap ' + r.api.LIST_FETCH_CONCURRENCY + ')');
    const all = results.main.concat(results.cosmetic, results.supplemental);
    check('every pipeline got its text', all.every((x) => x && x.ok && typeof x.text === 'string' && x.text.indexOf('BODY-OF ' + x.url) === 0),
      all.filter((x) => !x || !x.ok).map((x) => x && (x.url + ': ' + x.error)).join('; ').slice(0, 200));
    const shared = ['https://easylist.to/easylist/easylist.txt', 'https://filters.adtidy.org/extension/ublock/filters/3.txt', 'https://raw.githubusercontent.com/TMAFE/anti-grabify/master/url_list.txt'];
    check('the three shared sources reached both of their readers from one download',
      shared.every((u) => r.state.calls.filter((c) => c === u).length === 1 && all.filter((x) => x.url === u && x.ok).length === 2));
    check('and nothing is kept once the refresh is over', r.api.LIST_BROKER.stats().bodies === 0 && r.api.LIST_BROKER.stats().holders === 0, JSON.stringify(r.api.LIST_BROKER.stats()));
  }
  /* ---- policy is still per reader ------------------------------------------------------------ */
  {
    const r = realm();
    const refused = await pump(r, r.api.fetchValidatedRemoteListText('https://easylist.to/easylist/easyprivacy.txt', false, 25000));
    check('a cosmetic-only address asked for by the network pipeline is refused before any request',
      refused.ok === false && refused.integrityRejected === true && r.state.calls.length === 0, JSON.stringify(refused).slice(0, 160));
    const unknown = await pump(r, r.api.fetchValidatedRemoteListText('https://evil.example/list.txt', true, 25000));
    check('an address on no list is refused before any request', unknown.ok === false && r.state.calls.length === 0);
  }
  /* ---- a failure is not shared -------------------------------------------------------------- */
  {
    const url = 'https://easylist.to/easylist/easylist.txt';
    const r = realm({ failOnce: [url] });
    r.api.LIST_BROKER.retain();
    r.api.LIST_BROKER.plan([url, url]);
    const first = await pump(r, r.api.fetchValidatedRemoteListText(url, false, 25000));
    const second = await pump(r, r.api.fetchValidatedRemoteListText(url, true, 25000));
    r.api.LIST_BROKER.release();
    check('a fetch that failed is handed to its reader and not kept', first.ok === false && /503/.test(first.error || ''), JSON.stringify(first).slice(0, 120));
    check('so the next planned reader tries again and gets the body', second.ok === true && r.state.calls.length === 2, r.state.calls.length + ' request(s)');
  }
  /* ---- two readers asking at once share the request in flight ----------------------------------- */
  {
    const url = 'https://filters.adtidy.org/extension/ublock/filters/3.txt';
    const r = realm();
    r.api.LIST_BROKER.retain();
    r.api.LIST_BROKER.plan([url, url]);
    const both = Promise.all([r.api.fetchValidatedRemoteListText(url, false, 25000), r.api.fetchValidatedRemoteListText(url, true, 25000)]);
    await settle();
    check('two pipelines asking at the same moment cause one request', r.state.calls.length === 1);
    const [a, b] = await pump(r, both);
    check('and both receive it', a.ok && b.ok && a.text === b.text);
    check('with nothing kept afterwards', r.api.LIST_BROKER.stats().bodies === 0);
    r.api.LIST_BROKER.release();
  }
  /* ---- a body is released as soon as its last planned reader has it -------------------------- */
  {
    const url = 'https://raw.githubusercontent.com/TMAFE/anti-grabify/master/url_list.txt';
    const r = realm();
    r.api.LIST_BROKER.retain();
    r.api.LIST_BROKER.plan([url, url]);
    await pump(r, r.api.fetchValidatedRemoteListText(url, false, 25000));
    check('after the first of two planned readers the body is kept for the second', r.api.LIST_BROKER.stats().bodies === 1, JSON.stringify(r.api.LIST_BROKER.stats()));
    await pump(r, r.api.fetchValidatedRemoteListText(url, false, 25000));
    check('and released the moment the second has taken it, before the refresh ends', r.api.LIST_BROKER.stats().bodies === 0 && r.state.calls.length === 1);
    const again = await pump(r, r.api.fetchValidatedRemoteListText(url, false, 25000));
    check('an unplanned third reader fetches afresh rather than reading a stale body', again.ok && r.state.calls.length === 2);
    r.api.LIST_BROKER.release();
  }
  /* ---- the queue holds a cap, whatever is thrown at it ---------------------------------------- */
  {
    const r = realm();
    const urls = r.api.ADSHIELD_COSMETIC_LISTS.slice();
    const all = Promise.all(urls.map((u) => r.api.fetchValidatedRemoteListText(u, true, 25000)));
    await settle();
    check('ten requests issued at once put LIST_FETCH_CONCURRENCY on the wire and queue the rest',
      r.state.inflight === r.api.LIST_FETCH_CONCURRENCY && r.api.LIST_BROKER.stats().queued === urls.length - r.api.LIST_FETCH_CONCURRENCY,
      r.state.inflight + ' in flight, ' + JSON.stringify(r.api.LIST_BROKER.stats()));
    const results = await pump(r, all);
    check('and all ten complete', results.every((x) => x.ok) && r.state.peak === r.api.LIST_FETCH_CONCURRENCY);
  }

  /* ---- the wiring ----------------------------------------------------------------------------- */
  check('every consumer goes through the one validated fetch', (BG.match(/fetchValidatedRemoteListText\(/g) || []).length >= 4 && !/\bfetchRemoteListTextRaw\(policy, timeoutMs\)[\s\S]{0,40}\bfunction fetchListSource/.test(BG));
  check('the refresh plans its reads for the broker before the first request', /LIST_BROKER\.plan\(planned\);/.test(BG));
  check('the refresh holds the broker for its whole run, including the supplemental pass', /LIST_BROKER\.retain\(\);\s*const run = updateRemoteListsCore\(reason\)/.test(BG) && /LIST_BROKER\.release\(\);[\s\S]{0,400}__remoteListUpdateInFlight = null;/.test(BG));
  check('the cosmetic pipeline holds it for as long as it runs', /async function updateAdShieldCosmetics\(\) \{\s*LIST_BROKER\.retain\(\);/.test(BG) && /finally \{\s*LIST_BROKER\.release\(\);\s*\}\s*\}\s*\n/.test(BG.slice(BG.indexOf('async function updateAdShieldCosmetics'), BG.indexOf('async function updateAdShieldCosmetics') + 5000)));
  {
    const core = BG.slice(BG.indexOf('async function updateRemoteListsCore'), BG.indexOf('async function updateRemoteLists(reason)'));
    const loop = core.indexOf('fetchListSource(url, reason, integrity)');
    const cosmetic = core.indexOf('updateAdShieldCosmetics();');
    check('the cosmetic pipeline starts after the network batch, not beside it', loop >= 0 && cosmetic > loop, 'cosmetic at ' + cosmetic + ', loop at ' + loop);
    check('and still before the integrity quarantine can return early', cosmetic < core.indexOf('if (rejectedSources) {'));
  }

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: one request per source, four at a time, and nothing kept past its last reader');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });

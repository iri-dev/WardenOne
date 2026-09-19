/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The content configuration snapshot is built once per change, not once per frame.
 * Run: node tools/test-content-config-memo.js
 *
 * Every content script that needs its settings asks the worker for content-config-get, and the
 * bridge asks in every frame. The answer is a pure function of four storage keys -- the config,
 * the learned map, the supplemental lists and the search-junk list -- and it changes at most a
 * few times a day. It used to be rebuilt from scratch for every request: a four-key storage read,
 * then the sanitisers over 173 fields, up to 1,000 learned hosts and four list buckets capped at
 * 3,000 + 1,500 + 300 + 5,000, each entry through a URL construction -- 61 ms and 211 KiB per
 * frame, thirty times over on an ad-heavy page, and every frame received the 5,000-entry
 * search-copycat list that only the top-frame search marker can use (COST-01).
 *
 * Now the sanitised snapshot is memoised in the worker and served frozen to every caller, cleared
 * whenever one of its four inputs is written (the storage.onChanged hook that already refreshed
 * the pages, and the worker's own localSet before that event arrives), and a caller says which
 * parts it needs, so a child frame that only wants its switches gets its switches. This suite
 * runs the real sanitisers and builder against a store at the caps and counts reads per request.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const REQUESTERS = ['bridge.js', 'consent-reject.js', 'consent-wall.js', 'eyeshield.js', 'mail-shield.js', 'oauth-guard.js', 'search-junk.js', 'twitch-rewind.js', 'twitch-vod-rewind.js'];

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function balanced(src, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated block');
}
function grabFn(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'missing ' + name);
  return balanced(src, m.index);
}
const has = (name) => new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(BG);
const orElse = (name, fallback) => (has(name) ? grabFn(BG, name) : fallback);
function constObject(name) {
  const i = BG.indexOf('const ' + name + ' = {');
  assert(i >= 0, 'missing ' + name);
  return balanced(BG, i) + ';';
}
function constLine(name, fallback) {
  const m = new RegExp('^const ' + name + ' = [^\\n]+;$', 'm').exec(BG);
  return m ? m[0] : fallback;
}
function constSet(name, fallback) {
  const i = BG.indexOf('const ' + name + ' = new Set([');
  if (i < 0) return fallback;
  const j = BG.indexOf(']);', i);
  return BG.slice(i, j + 3);
}

const LIFTED = [
  constObject('DEFAULT_CONFIG'),
  constSet('CONTENT_CONFIG_EXTRA_FIELDS'),
  constSet('CONTENT_CONFIG_NEEDS', 'const CONTENT_CONFIG_NEEDS = new Set();'),
  orElse('contentConfigInputKeys', 'function contentConfigInputKeys() { return []; }'),
  constObject('SUPPLEMENTAL_LIST_CAPS'),
  constLine('SUPPLEMENTAL_LIST_STORAGE_KEY'),
  constLine('HIDDEN_STORE_KEY'), constLine('HIDDEN_MAX_PER_HOST'),
  grabFn(BG, 'normalizeAllowlistHost'), grabFn(BG, 'isLocalOrPrivateHost'),
  grabFn(BG, 'contentConfigFieldAllowed'), grabFn(BG, 'sanitizeContentConfig'), grabFn(BG, 'sanitizeLearnedForContent'),
  grabFn(BG, 'sanitizeSearchJunkForContent'), grabFn(BG, 'emptySupplementalLists'), grabFn(BG, 'supplementalListCap'),
  grabFn(BG, 'normalizeSupplementalListDomain'), grabFn(BG, 'sanitizeSupplementalBucket'), grabFn(BG, 'sanitizeSupplementalLists'),
  grabFn(BG, 'readHiddenElements'), grabFn(BG, 'hiddenSelectorsForHost'), grabFn(BG, 'hiddenEntriesForHost'),
  /* The fix's own pieces; on the pre-fix source the stand-ins are the old behaviour. */
  orElse('invalidateContentConfigMemo', 'function invalidateContentConfigMemo() {}'),
  orElse('contentConfigNeeds', 'function contentConfigNeeds() { return null; }'),
  orElse('sharedContentConfigSnapshot', 'function sharedContentConfigSnapshot() { return Promise.resolve(null); }'),
  has('deepFreezeSnapshot') ? grabFn(BG, 'deepFreezeSnapshot') : 'function deepFreezeSnapshot(v) { return v; }',
  BG.includes('let __contentConfigMemo = null;') ? 'let __contentConfigMemo = null;' : '',
  grabFn(BG, 'buildContentConfigSnapshot'),
].join('\n');

/* ---- a store at the caps -------------------------------------------------------------------- */
/* .com, not .example: the real normaliser treats the reserved TLDs as private and drops them. */
function hosts(prefix, n) { const out = []; for (let i = 0; i < n; i++) out.push(prefix + i + '.com'); return out; }
function store() {
  const learned = {};
  /* One under the cap, so the host a later check adds is not the one the cap drops. */
  for (const h of hosts('learned', 999)) learned[h] = { reason: 'known IP-grabber behavior', at: 1 };
  return {
    wardenone_config: Object.assign({}, { allowlist: ['trusted.com'], adShield: true, warnSearchResults: true, flagSearchJunk: true, phishTankKey: 'secret-key' }),
    wardenone_learned: learned,
    wardenone_aux_lists: {
      adultDomainsExtra: hosts('adult', 3000),
      grabberDomainsExtra: hosts('grab', 1500),
      trustedPaymentHostsExtra: hosts('pay', 300),
      searchJunkDomainsExtra: hosts('junkx', 5000),
    },
    wardenone_search_junk_domains: { scraperHosts: hosts('junk', 5000) },
    wardenone_hidden_elements: { 'a.com': ['.ad-slot'], 'b.com': ['#promo'] },
  };
}

function realm(local) {
  const state = { local, reads: [], fail: false };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const sandbox = {
    console, Promise, Object, Array, String, Number, Boolean, Set, Map, JSON, Math, RegExp, Error, URL, Date, Symbol,
    chrome: {
      runtime: { lastError: null, getURL: (p) => 'chrome-extension://wo/' + p },
      storage: { local: {
        get(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          state.reads.push(list.slice());
          if (state.fail) { throw new Error('storage unavailable'); }
          const out = {};
          for (const k of list) if (state.local[k] !== undefined) out[k] = clone(state.local[k]);
          if (typeof cb === 'function') { cb(out); return undefined; }
          return Promise.resolve(out);
        },
      } },
    },
    localGet: (keys) => new Promise((resolve, reject) => { try { sandbox.chrome.storage.local.get(keys, resolve); } catch (e) { reject(e); } }),
    sanitizeWardenNotificationSettings: (v) => clone(v || {}),
    isNeverBlockDomain: () => false,
    normalizeIpLiteral: () => '',
    ipv4FromMappedIpv6: () => '',
    isSafeSelector: () => true,
    INCOGNITO_CONTEXT: false,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { buildContentConfigSnapshot, invalidateContentConfigMemo, contentConfigNeeds, sharedContentConfigSnapshot };', ctx, { filename: 'content-config.js' });
  const snapshotReads = () => state.reads.filter((k) => k.indexOf('wardenone_config') >= 0 && k.indexOf('wardenone_learned') >= 0).length;
  const request = (frameHost, need) => sandbox.api.buildContentConfigSnapshot(frameHost, sandbox.api.contentConfigNeeds(need));
  return { state, api: sandbox.api, request, snapshotReads };
}
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

(async () => {
  const full = store();
  /* ---- one build per change, however many frames ask ------------------------------------------ */
  {
    const r = realm(full);
    const t0 = process.hrtime.bigint();
    const first = await r.request('a.com');
    const t1 = process.hrtime.bigint();
    check('the snapshot is complete: switches, learned hosts, four buckets at their caps, the search-junk list, the frame\'s hidden rules',
      first.ok === true && first.overrides.adShield === true && Object.keys(first.learned).length === 999
        && first.supplemental.adultDomainsExtra.length === 3000 && first.supplemental.grabberDomainsExtra.length === 1500
        && first.supplemental.trustedPaymentHostsExtra.length === 300 && first.supplemental.searchJunkDomainsExtra.length === 5000
        && first.searchJunkDomains.length === 5000 && first.hidden.join(',') === '.ad-slot',
      JSON.stringify({ learned: Object.keys(first.learned).length, sup: Object.keys(first.supplemental).map((k) => first.supplemental[k].length), junk: first.searchJunkDomains.length, hidden: first.hidden }));
    check('and it carries no credential', JSON.stringify(first).indexOf('secret-key') === -1 && first.overrides.phishTankKey === undefined);
    const fullBytes = bytes(first);
    const t2 = process.hrtime.bigint();
    const answers = [];
    for (let i = 0; i < 30; i++) answers.push(await r.request(i % 2 ? 'a.com' : 'b.com'));
    const t3 = process.hrtime.bigint();
    console.log('  [info] first build ' + (Number(t1 - t0) / 1e6).toFixed(1) + ' ms, ' + (fullBytes / 1024).toFixed(0) + ' KiB; thirty more frames ' + (Number(t3 - t2) / 1e6).toFixed(1) + ' ms');
    check('thirty frames asking after the first read the four keys once in all', r.snapshotReads() === 1, r.snapshotReads() + ' snapshot read(s) for 31 requests');
    check('every frame gets the same lists', answers.every((a) => JSON.stringify(a.supplemental) === JSON.stringify(first.supplemental) && JSON.stringify(a.learned) === JSON.stringify(first.learned)));
    check('and its own hidden rules, not another frame\'s', answers[0].hidden.join(',') === '#promo' && answers[1].hidden.join(',') === '.ad-slot');
    const noHost = await r.request('');
    check('a frame that named no host gets no hidden rules', Array.isArray(noHost.hidden) && noHost.hidden.length === 0);
  }
  /* ---- a burst of cold callers shares one read ------------------------------------------------ */
  {
    const r = realm(store());
    const all = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(() => r.request('a.com')));
    check('eight frames asking at once share one in-flight build', r.snapshotReads() === 1 && all.every((a) => a.ok), r.snapshotReads() + ' read(s)');
  }
  /* ---- the memo is cleared when an input changes, and only then ------------------------------- */
  {
    const r = realm(store());
    await r.request('a.com');
    r.state.local.wardenone_config.allowlist = ['trusted.com', 'added.com'];
    const stale = await r.request('a.com');
    check('a write the memo has not been told about is served as it was (this is what the invalidation hooks are for)',
      stale.overrides.allowlist.length === 1 && r.snapshotReads() === 1);
    r.api.invalidateContentConfigMemo();
    const fresh = await r.request('a.com');
    check('once invalidated, the next request reads again and reflects the change', fresh.overrides.allowlist.length === 2 && r.snapshotReads() === 2,
      JSON.stringify({ allow: fresh.overrides.allowlist, reads: r.snapshotReads() }));
    r.state.local.wardenone_learned['new-logger.com'] = { reason: 'known IP-grabber behavior', at: 2 };
    r.state.local.wardenone_aux_lists.grabberDomainsExtra.unshift('new-grab.com');
    r.state.local.wardenone_search_junk_domains.scraperHosts.unshift('new-junk.com');
    r.api.invalidateContentConfigMemo();
    const after = await r.request('a.com');
    check('a learned host, a list entry and a search-junk entry each reach the next snapshot',
      after.learned['new-logger.com'] === true && after.supplemental.grabberDomainsExtra[0] === 'new-grab.com' && after.searchJunkDomains[0] === 'new-junk.com');
    await r.request('b.com');
    check('and requests between changes still read nothing', r.snapshotReads() === 3, r.snapshotReads() + ' read(s)');
  }
  /* ---- a failed read is not remembered --------------------------------------------------------- */
  {
    const r = realm(store());
    r.state.fail = true;
    let failed = false;
    try { await r.request('a.com'); } catch (_) { failed = true; }
    check('a request whose storage read fails fails', failed);
    r.state.fail = false;
    const ok = await r.request('a.com');
    check('and the next request reads again rather than serving the failure', ok.ok === true && r.snapshotReads() === 2, r.snapshotReads() + ' read(s)');
  }
  /* ---- the memo cannot be changed by a caller --------------------------------------------------- */
  {
    const r = realm(store());
    const a = await r.request('a.com');
    let threw = false;
    try { a.supplemental.adultDomainsExtra.push('injected.com'); } catch (_) { threw = true; }
    try { a.overrides.enabled = false; } catch (_) {}
    const b = await r.request('a.com');
    check('the shared lists are frozen: a caller cannot push into them', threw && b.supplemental.adultDomainsExtra.length === 3000 && b.supplemental.adultDomainsExtra.indexOf('injected.com') === -1);
    check('nor change a switch for the next frame', b.overrides.enabled !== false);
  }
  /* ---- a caller gets what it asked for --------------------------------------------------------- */
  {
    const r = realm(store());
    const whole = await r.request('a.com');
    const switches = await r.request('a.com', ['overrides']);
    check('a script that needs only its switches gets its switches, and empty lists',
      switches.ok === true && switches.overrides.adShield === true && Object.keys(switches.learned).length === 0
        && Object.keys(switches.supplemental).every((k) => switches.supplemental[k].length === 0) && switches.searchJunkDomains.length === 0 && switches.hidden.length === 0,
      JSON.stringify({ learned: Object.keys(switches.learned).length, junk: switches.searchJunkDomains.length, hidden: switches.hidden }));
    console.log('  [info] full answer ' + (bytes(whole) / 1024).toFixed(0) + ' KiB; switches only ' + (bytes(switches) / 1024).toFixed(1) + ' KiB');
    check('which is a small fraction of the whole', bytes(switches) * 10 < bytes(whole), bytes(switches) + ' of ' + bytes(whole) + ' bytes');
    const bridge = await r.request('a.com', ['overrides', 'learned', 'supplemental', 'hidden']);
    check('the bridge gets the switches, the learned map, the three engine buckets and the hidden rules',
      Object.keys(bridge.learned).length === 999 && bridge.supplemental.adultDomainsExtra.length === 3000 && bridge.supplemental.grabberDomainsExtra.length === 1500
        && bridge.supplemental.trustedPaymentHostsExtra.length === 300 && bridge.hidden.join(',') === '.ad-slot');
    check('and not the two search-copycat lists it never reads', bridge.searchJunkDomains.length === 0 && bridge.supplemental.searchJunkDomainsExtra.length === 0,
      bridge.searchJunkDomains.length + ' / ' + bridge.supplemental.searchJunkDomainsExtra.length);
    const search = await r.request('a.com', ['overrides', 'searchJunk']);
    check('the search marker gets the switches and both search-copycat lists, and nothing else',
      search.searchJunkDomains.length === 5000 && search.supplemental.searchJunkDomainsExtra.length === 5000 && search.supplemental.adultDomainsExtra.length === 0
        && Object.keys(search.learned).length === 0 && search.hidden.length === 0);
    const odd = await r.request('a.com', ['nonsense']);
    const none = await r.request('a.com', 'overrides');
    check('a request that names nothing this worker knows, or is not a list, gets the whole answer, as before',
      bytes(odd) === bytes(whole) && bytes(none) === bytes(whole));
    check('narrowing never costs a read', r.snapshotReads() === 1, r.snapshotReads() + ' read(s)');
  }

  /* ---- the wiring --------------------------------------------------------------------------- */
  check('the storage.onChanged hook clears the memo before it tells the pages to refresh',
    /\|\| changes\.wardenone_search_junk_domains\)\) \{\s*invalidateContentConfigMemo\(\);\s*scheduleContentConfigRefresh\(\);/.test(BG));
  check('and the worker\'s own writes clear it before that event can arrive',
    /function localSet\(obj\) \{[\s\S]{0,400}invalidateContentConfigMemo\(\)/.test(BG));
  check('the handler passes what the caller asked for', /respond\(buildContentConfigSnapshot\(frameHost, contentConfigNeeds\(msg\.need\)\), sendResponse\);/.test(BG));
  for (const file of REQUESTERS) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const asks = src.match(/kind: 'content-config-get'[^}]*\}/g) || [];
    check(file + ' says what it needs', asks.length >= 1 && asks.every((a) => /need: \[/.test(a)), asks.join(' | ').slice(0, 160));
  }
  {
    const mail = fs.readFileSync(path.join(ROOT, 'mail-shield.js'), 'utf8');
    check('mail-shield reads the field the worker actually sends', /const cfg = \(res && res\.overrides\) \|\| \{\};/.test(mail) && !/res\.config\b/.test(mail));
  }

  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the content configuration is built once per change and each frame gets what it asked for');
})().catch((e) => { finished = true; console.error(e); process.exit(1); });

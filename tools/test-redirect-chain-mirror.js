/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The redirect chain a download came through outlives the worker that saw it.
 * Run: node tools/test-redirect-chain-mirror.js
 *
 * Download Shield grades a file partly on how the reader got there: the ten-minute window of
 * recent redirect chains, kept in worker memory and mirrored to storage.session so that a
 * suspension between the chain and the download does not lose it (LIFE-03). The download
 * handler restores the mirror before it looks the chain up -- that half has been wired since
 * M17 -- but the WRITE path had not: a chain is recorded from the synchronous webRequest
 * observer on every top-level redirect hop in any tab, and persisting it snapshotted the
 * in-memory window as it stood. A fresh worker that had not read the stored copy yet held
 * only what it had seen since it woke, so the first redirect hop anywhere in the browser after
 * a suspension replaced the stored window with one entry, and the chain recorded before the
 * suspension was gone before the download that followed it could ask. Redirect hops are
 * constant -- shorteners, login flows, canonical-host bounces -- so in practice the mirror
 * only helped when nothing at all redirected between the wake and the download.
 *
 * Now the mirror restores before it writes. The restore merges, so the snapshot that reaches
 * storage.session is both halves: what earlier lifetimes stored and what this one recorded.
 * This suite is the card's own regression test, run against the real code: a chain is
 * recorded, the worker "dies" (a fresh realm on the same storage), an unrelated redirect
 * happens, and the download still finds its chain -- while an entry past the TTL is not
 * returned, a legacy entry carrying the address is not carried forward, and the window stays
 * capped and deduplicated across any number of lifetimes.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const DL = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function grabFn(src, name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'missing ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}
function region(src, a, b, what) {
  const i = src.indexOf(a);
  assert(i >= 0, 'missing ' + what);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end of ' + what);
  return src.slice(i, j);
}

/* The mirror, the recent-chain window and every reader and writer of it, contiguous in the
   worker; the hop observer that feeds it; and the download side's lookup. */
const LIFTED = [
  region(BG, 'function sessionArea() {', '\nfunction resetRedirectChain(', 'the session mirror and the recent-chain window'),
  grabFn(BG, 'chainFakeInstallLander'),
  grabFn(BG, 'noteRedirectHop'),
  grabFn(DL, 'downloadRedirectContext'),
].join('\n');

const KEY = 'wardenone_recent_redirect_chains';
const TTL_MS = 10 * 60 * 1000;

/* ---- the browser: storage.session and the clock persist, a worker realm does not --------- */
function browser(options) {
  const o = options || {};
  const state = {
    session: {}, clock: Date.UTC(2026, 8, 18, 12, 0, 0), timers: [], timerId: 0,
    counts: { gets: 0, sets: 0 },
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const area = {
    get(key, cb) {
      state.counts.gets++;
      if (o.getThrows) throw new Error('storage unavailable');
      /* Delivered asynchronously, as Chrome does. */
      Promise.resolve().then(() => cb(state.session[key] === undefined ? {} : { [key]: clone(state.session[key]) }));
    },
    set(items, cb) {
      state.counts.sets++;
      Object.assign(state.session, clone(items));
      if (cb) cb();
    },
  };
  const chrome = { runtime: { lastError: null }, storage: o.noSession ? {} : { session: area } };
  return { state, chrome };
}
const stored = (b) => b.state.session[KEY] || null;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
/* Run every pending coalesce timer, then let the restore-then-write it starts finish. */
async function fire(b) {
  const due = b.state.timers.splice(0);
  for (const t of due) t.fn();
  await settle();
}

/* ---- one worker lifetime: a fresh realm on the same browser -------------------------------- */
function wake(b) {
  const state = b.state;
  class FakeDate extends Date { static now() { return state.clock; } }
  const sandbox = {
    chrome: b.chrome, console: { warn() {}, log() {} },
    Promise, Object, Array, String, Number, Boolean, Set, Map, JSON, RegExp, Math, URL, Error, Symbol, Reflect,
    Date: FakeDate,
    setTimeout: (fn, ms) => { const id = ++state.timerId; state.timers.push({ id, fn, at: state.clock + (ms || 0) }); return id; },
    clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
    registrableDomainBg: (host) => { const p = String(host || '').toLowerCase().split('.'); return p.length >= 2 ? p.slice(-2).join('.') : String(host || ''); },
    BLOCKED_DOMAINS: new Set(['evil.example']),
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(LIFTED + '\nthis.api = { noteRedirectHop, rememberRecentRedirectChain, recentRedirectChainForDownload, downloadRedirectContext,'
    + ' RECENT_REDIRECT_MIRROR, RECENT_REDIRECT_CHAINS, REDIRECT_CHAINS, REDIRECT_CHAIN_RECENT_MAX };', ctx, { filename: 'redirect-mirror-wake.js' });
  return sandbox.api;
}
/* A top-level 30x, as the webRequest observer reports it. */
const hop = (api, tabId, from, to) => api.noteRedirectHop({ tabId, frameId: 0, url: from, redirectUrl: to });
/* The download handler's sequence: restore the mirror, then look the chain up. */
async function download(api, url, referrer) {
  await api.RECENT_REDIRECT_MIRROR.ready();
  return api.downloadRedirectContext(url, referrer || '', { referrer: referrer || '' });
}

const CHAIN = ['https://short.example/x9', 'https://track.example/r?u=1', 'https://cdn.land.example/dl', 'https://land.example/get/setup.exe'];
const FINAL = CHAIN[CHAIN.length - 1];
function runChain(api, tabId) {
  for (let i = 1; i < CHAIN.length; i++) hop(api, tabId, CHAIN[i - 1], CHAIN[i]);
}

(async () => {
  /* ---- the card's sequence: chain, suspension, download ---------------------------------- */
  {
    const b = browser();
    const w1 = wake(b);
    runChain(w1, 7);
    check('a chain is remembered as it happens, one summary per hop, newest first',
      w1.RECENT_REDIRECT_CHAINS.length === 3 && w1.RECENT_REDIRECT_CHAINS[0].hops === 3 && w1.RECENT_REDIRECT_CHAINS[2].hops === 1,
      JSON.stringify(w1.RECENT_REDIRECT_CHAINS.map((e) => e.hops)));
    check('the write is coalesced, not one per hop', stored(b) === null && b.state.timers.length === 1, b.state.timers.length + ' timer(s)');
    await fire(b);
    const s1 = stored(b);
    check('the window reaches storage.session', Array.isArray(s1) && s1.length === 3, JSON.stringify(s1));
    check('and what it holds is a digest and a host, never the address (PRIV-04)',
      s1.every((e) => e.finalUrl === undefined && /^[0-9a-f]{14}$/.test(e.finalKey)) && JSON.stringify(s1).indexOf('setup.exe') === -1,
      JSON.stringify(s1).slice(0, 200));

    /* The worker is gone; the download wakes a new one. */
    const w2 = wake(b);
    check('a fresh worker starts with an empty window', w2.RECENT_REDIRECT_CHAINS.length === 0);
    const cold = w2.downloadRedirectContext(FINAL, '', {});
    check('a lookup before the mirror has been read sees nothing, which is why the handler waits', cold === null, JSON.stringify(cold));
    const found = await download(w2, FINAL);
    check('the download finds the chain recorded by the worker that died',
      !!found && found.matchedOn === 'download-url' && found.hops === 3 && found.finalHost === 'land.example',
      JSON.stringify(found));
    check('with the domains it crossed', !!found && found.chain.join(',') === 'track.example,land.example', found && found.chain.join(','));
    const byReferrer = await download(w2, 'https://land.example/files/setup.exe', FINAL);
    check('a download whose referrer is the chain end matches too', !!byReferrer && byReferrer.matchedOn === 'referrer', JSON.stringify(byReferrer));
    check('reading the mirror is one storage read per worker lifetime, however often it is asked',
      b.state.counts.gets === 2, b.state.counts.gets + ' read(s)');
  }

  /* ---- the hole that remained: a write from a worker that has not restored ---------------- */
  {
    const b = browser();
    const w1 = wake(b);
    runChain(w1, 7);
    await fire(b);
    check('setup: the chain is in storage', stored(b).length === 3);

    /* The worker dies. Something unrelated wakes a new one, and a link shortener in another
       tab bounces once. */
    const w2 = wake(b);
    hop(w2, 9, 'https://l.example/abc', 'https://news.example/story');
    check('the new worker knows only its own hop until it has restored', w2.RECENT_REDIRECT_CHAINS.length === 1);
    await fire(b);
    const s2 = stored(b);
    check('persisting from a worker that had not restored keeps what the store already held',
      Array.isArray(s2) && s2.length === 4, s2 ? s2.length + ' entr(ies): ' + JSON.stringify(s2.map((e) => e.finalHost)) : 'nothing');
    check('newest first, the new hop ahead of the old chain', !!s2 && s2.length >= 2 && s2[0].finalHost === 'news.example' && s2[1].finalHost === 'land.example',
      s2 && s2.map((e) => e.finalHost).join(','));
    check('and the restore that made that possible merged into this worker\'s own window as well',
      w2.RECENT_REDIRECT_CHAINS.length === 4, String(w2.RECENT_REDIRECT_CHAINS.length));
    const getsAfterFirstWrite = b.state.counts.gets;
    hop(w2, 9, 'https://news.example/story', 'https://www.news.example/story');
    await fire(b);
    hop(w2, 9, 'https://www.news.example/story', 'https://news.example/amp/story');
    await fire(b);
    check('further writes from the same worker restore nothing again', b.state.counts.gets === getsAfterFirstWrite, b.state.counts.gets + ' read(s)');
    check('and each adds exactly its own entry -- the merge does not duplicate what it restored',
      stored(b).length === 6, stored(b).length + ' entr(ies)');

    /* The worker dies again; the download the reader was heading for finally starts. */
    const w3 = wake(b);
    const found = await download(w3, FINAL);
    check('the download that follows an unrelated redirect still finds its chain',
      !!found && found.matchedOn === 'download-url' && found.hops === 3, JSON.stringify(found));

    /* ---- the TTL is honoured, not ignored -------------------------------------------- */
    b.state.clock += 9 * 60 * 1000;
    const inside = await download(wake(b), FINAL);
    check('nine minutes on, the chain is still there', !!inside && inside.hops === 3);
    b.state.clock += 2 * 60 * 1000;
    const w5 = wake(b);
    const expired = await download(w5, FINAL);
    check('past ten minutes, an entry is not returned', expired === null, JSON.stringify(expired));
    check('and not kept in memory either', w5.RECENT_REDIRECT_CHAINS.length === 0, String(w5.RECENT_REDIRECT_CHAINS.length));
    hop(w5, 3, 'https://a.example/', 'https://b.example/');
    await fire(b);
    check('the next write leaves the expired entries behind', stored(b).length === 1 && stored(b)[0].finalHost === 'b.example',
      JSON.stringify(stored(b).map((e) => e.finalHost)));
  }

  /* ---- the window stays bounded across lifetimes ------------------------------------------ */
  {
    const b = browser();
    /* Sixty single-hop bounces in sixty tabs per lifetime (one tab caps its own chain at 24 hops). */
    const w1 = wake(b);
    for (let i = 0; i < 60; i++) hop(w1, 100 + i, 'https://s' + i + '.example/', 'https://t' + i + '.example/');
    await fire(b);
    const w2 = wake(b);
    for (let i = 0; i < 60; i++) hop(w2, 200 + i, 'https://u' + i + '.example/', 'https://v' + i + '.example/');
    await fire(b);
    check('two lifetimes of hops never grow the stored window past its cap',
      stored(b).length === w2.REDIRECT_CHAIN_RECENT_MAX && w2.RECENT_REDIRECT_CHAINS.length === w2.REDIRECT_CHAIN_RECENT_MAX,
      stored(b).length + ' stored, ' + w2.RECENT_REDIRECT_CHAINS.length + ' in memory (cap ' + w2.REDIRECT_CHAIN_RECENT_MAX + ')');
    const hosts = stored(b).map((e) => e.finalHost);
    check('and the newest survive the cut: all of this lifetime, the last twenty of the one before',
      hosts[0] === 'v59.example' && hosts.filter((h) => /^v/.test(h)).length === 60
        && hosts.indexOf('t40.example') >= 0 && hosts.indexOf('t39.example') === -1,
      hosts.slice(0, 3).join(',') + ' … ' + hosts.slice(-3).join(','));
  }

  /* ---- a legacy entry carrying the address is dropped, not carried forward --------------- */
  {
    const b = browser();
    b.state.session[KEY] = [
      { hops: 2, domains: 2, chain: ['a.example'], finalUrl: 'https://old.example/?token=1', finalKey: 'https://old.example/?token=1', finalHost: 'old.example', at: b.state.clock },
      { hops: 1, domains: 1, chain: ['b.example'], finalKey: '0123456789abcd', finalHost: 'b.example', at: b.state.clock },
    ];
    const w = wake(b);
    hop(w, 4, 'https://c.example/', 'https://d.example/');
    await fire(b);
    check('a restore-before-write drops the entry that carried the address',
      stored(b).length === 2 && stored(b).every((e) => e.finalUrl === undefined) && JSON.stringify(stored(b)).indexOf('token=1') === -1,
      JSON.stringify(stored(b).map((e) => e.finalHost)));
    check('and keeps the digest-keyed one', stored(b).some((e) => e.finalHost === 'b.example'));
  }

  /* ---- nothing here can block a write or hang a read --------------------------------------- */
  {
    const b = browser({ noSession: true });
    const w = wake(b);
    runChain(w, 7);
    await fire(b);
    check('without storage.session the window still works within the lifetime',
      (await download(w, FINAL)) !== null && b.state.timers.length === 0 && stored(b) === null);
  }
  {
    const b = browser({ getThrows: true });
    const w = wake(b);
    runChain(w, 7);
    await fire(b);
    check('a read that throws still lets the write through', Array.isArray(stored(b)) && stored(b).length === 3,
      JSON.stringify(stored(b)));
    check('and a lookup after it resolves rather than hangs', (await download(w, FINAL)) !== null);
  }

  /* ---- the wiring in the shipped files ------------------------------------------------------ */
  check('persist restores before it snapshots',
    /timer = null;[\s\S]{0,900}mirror\.ready\(\)\.then\(\(\) => \{\s*try \{ area\.set\(\{ \[key\]: snapshot\(\) \}/.test(BG));
  check('both correlation windows are built on that one mirror',
    /const RECENT_REDIRECT_MIRROR = sessionMirror\(/.test(BG) && /const PERMISSION_CHAIN_MIRROR = sessionMirror\(/.test(BG));
  check('the download handler restores before it looks the chain up',
    /await RECENT_REDIRECT_MIRROR\.ready\(\);/.test(DL)
      && DL.indexOf('await RECENT_REDIRECT_MIRROR.ready();') < DL.indexOf('downloadRedirectContext(downloadUrl'));
  check('the permission handler restores before it records',
    BG.indexOf('await PERMISSION_CHAIN_MIRROR.ready();') > 0
      && BG.indexOf('await PERMISSION_CHAIN_MIRROR.ready();') < BG.indexOf('PERMISSION_CHAIN_MIRROR.persist();'));

  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  console.log('  ok  ' + pass + ' checks: a download finds the redirect chain recorded before the worker died, whatever redirected in between');
})().catch((e) => { console.error(e); process.exit(1); });

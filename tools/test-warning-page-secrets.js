/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A warning page must never carry the address it is warning about in its own URL (PRIV-04).
 *
 * The redirect, Safe Browsing and certificate interstitials each received the raw URL as a
 * query parameter -- ?to=, ?u= -- up to 1,200 characters of it, query string included. That
 * made the TAB's URL a durable copy of the most sensitive addresses the browser sees, because
 * redirect chains are exactly where OAuth codes and reset tokens travel, and a tab URL goes
 * into history, session restore, screenshots and crash reports for as long as the tab lives.
 * The redirect mirror in storage.session kept the same addresses in plain text for ten minutes,
 * in a field (finalUrl) that nothing read.
 *
 * This runs the finding's own verification: a controlled address carrying userinfo, an OAuth
 * code, a reset token and a fragment goes through every builder and every page, and no raw
 * secret may appear in the page URL, the display, or the mirror. The exact address lives only
 * in a session record keyed by a random handle, is consumed when the reader continues, and a
 * page whose record is gone must still offer the way back.
 *
 * Run: node tools/test-warning-page-secrets.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return src.slice(a, b);
}

/* ---- the address under test ------------------------------------------------------- */

const SECRETS = {
  userinfo: 'alice:hunter2',
  code: 'AQABAAIAAAD-oauth-CODE-9f8e7d6c',
  token: 'RESETTOKENabc123DEF456ghi789',
  fragment: 'access_token=ya29.FRAGMENT-SECRET',
};
const TARGET = 'https://' + SECRETS.userinfo + '@login.example.test/reset/' + SECRETS.token
  + '/confirm?code=' + SECRETS.code + '&state=xyz#' + SECRETS.fragment;
const SOURCE = 'https://mail.example.test/inbox?folder=all&msg=' + SECRETS.code;

function leaks(text) {
  const s = String(text || '');
  return Object.keys(SECRETS).filter((k) => s.indexOf(SECRETS[k]) !== -1);
}

/* ---- a storage.session that speaks both dialects -------------------------------- */

function fakeSession() {
  const store = {};
  const area = {
    __store: store,
    get(key, cb) {
      const out = {};
      const keys = key === null || key === undefined ? Object.keys(store) : (Array.isArray(key) ? key : [key]);
      for (const k of keys) if (store[k] !== undefined) out[k] = JSON.parse(JSON.stringify(store[k]));
      if (typeof cb === 'function') { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set(obj, cb) {
      for (const k of Object.keys(obj)) store[k] = JSON.parse(JSON.stringify(obj[k]));
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
    remove(keys, cb) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
    /* the warning records only, keyed by handle, as the old single-map view of the store */
    records() {
      const out = {};
      for (const k of Object.keys(store)) if (k.indexOf('wardenone_warning:') === 0) out[k.slice('wardenone_warning:'.length)] = store[k];
      return out;
    },
  };
  return area;
}

/* ---- lift the worker side --------------------------------------------------------- */

const LOG_HELPERS = between(BG, 'const LOG_URL_MAX = 300;', '\n// Details carry URLs too', 'the log URL helpers');
const SESSION_HELPERS = between(BG, 'function sessionArea() {', '\nconst REDIRECT_CHAINS = Object.create(null);', 'the session helpers');
const MIRROR = between(BG, 'const REDIRECT_CHAINS = Object.create(null);', '\nfunction resetRedirectChain', 'the redirect mirror');
const RECORDS = between(BG, '// ---- Warning-page hand-off records (PRIV-04) ----', '\nasync function showRedirectWarning', 'the warning records');
const TRUST = between(BG, 'async function trustErrorPageUrl', '\nasync function handleTrustError', 'the trust builder');

function workerSandbox() {
  const session = fakeSession();
  const ctx = {
    console: { warn() {}, log() {} },
    URL, URLSearchParams, Date, Math, Object, Array, String, Number, JSON, Promise, RegExp, Set, Uint8Array,
    setTimeout, clearTimeout,
    /* Real randomness, deliberately. A first version of this stub returned the same bytes on
       every call, so every record shared one handle and silently overwrote the last -- and
       the cap, the per-tab drop and two of the three pages were being tested against a store
       that only ever held one record. */
    crypto: { getRandomValues(a) { return require('crypto').randomFillSync(a); } },
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://wo/' + p, lastError: null },
      storage: { session },
    },
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
    BLOCKED_DOMAINS: new Set(['evil.example']),
    CERT_ERROR_PAGE: 'cert-error.html',
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext([LOG_HELPERS, SESSION_HELPERS, MIRROR, RECORDS, TRUST,
    'globalThis.api = { safeBrowsingBlockPageUrl, redirectWarningPageUrl, trustErrorPageUrl,'
    + ' createWarningRecord, forgetWarningRecordsForTab, warningDisplayUrl, warningTargetUrl,'
    + ' redirectChainUrlKey, redirectChainSummary, rememberRecentRedirectChain,'
    + ' recentRedirectChainForDownload, RECENT_REDIRECT_CHAINS, RECENT_REDIRECT_MIRROR,'
    + ' WARNING_RECORD_PREFIX, WARNING_RECORD_MAX, WARNING_RECORD_TTL_MS };',
  ].join('\n'), ctx);
  return { api: ctx.api, session };
}

/* ---- run a page script against a stub DOM ---------------------------------------- */

function runPage(file, handle, session) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, textContent: '', hidden: false, handlers: {}, attrs: {},
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
  });
  const nav = { href: '' };
  const ctx = {
    console: { warn() {}, log() {} },
    URL, URLSearchParams, Date, Object, Array, String, Number, JSON, Promise, RegExp,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: { getElementById: el },
    location: { search: '?w=' + handle, get href() { return nav.href; }, set href(v) { nav.href = v; } },
    history: { length: 2, back() { nav.href = '(back)'; } },
    window: { open() {} },
    chrome: {
      runtime: { getURL: (p) => 'chrome-extension://wo/' + p, lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } },
      storage: { session },
      tabs: { create() {} },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: file });
  return { els, nav, el };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  /* ---- 1. the three builders put nothing but a handle in the page URL -------------- */
  {
    const { api, session } = workerSandbox();
    const urls = {
      redirect: await api.redirectWarningPageUrl({ tabId: 7, targetUrl: TARGET, sourceUrl: SOURCE, kind: 'forced-redirect', why: 'test' }),
      safeBrowsing: await api.safeBrowsingBlockPageUrl({ tabId: 7, url: TARGET, provider: 'Google Safe Browsing', threats: 'MALWARE' }),
      trust: await api.trustErrorPageUrl({ kind: 'blocked_certificate', problem: 'p', why: 'w', risk: 'r' }, TARGET, 'net::ERR_CERT_DATE_INVALID', 7),
    };
    for (const [name, url] of Object.entries(urls)) {
      const q = new URL(url).searchParams;
      check(name + ' page URL carries only a handle', [...q.keys()].join(',') === 'w', url);
      check(name + ' handle is 32 hex characters', /^[0-9a-f]{32}$/.test(q.get('w') || ''), q.get('w'));
      check(name + ' page URL leaks no secret', leaks(url).length === 0, leaks(url).join(', '));
      check(name + ' page URL does not even name the host', url.indexOf('login.example.test') === -1);
    }
    const records = session.records();
    check('three records were written', records && Object.keys(records).length === 3);
    for (const rec of Object.values(records)) {
      check(rec.kind + ' record keeps the exact query so "continue" still works',
        String(rec.url).indexOf('code=' + SECRETS.code) !== -1, rec.url);
      check(rec.kind + ' record drops userinfo from the stored address',
        String(rec.url).indexOf(SECRETS.userinfo) === -1, rec.url);
      check(rec.kind + ' display form leaks no secret', leaks(rec.shown).length === 0, rec.shown);
      check(rec.kind + ' display form marks that a query was cut', /\?…$/.test(rec.shown), rec.shown);
      check(rec.kind + ' display form stars the token-shaped path segment',
        /\/reset\/\*\/confirm/.test(rec.shown), rec.shown);
      check(rec.kind + ' record is tied to its tab', rec.tabId === 7);
    }
    const redirectRec = Object.values(records).find((r) => r.kind === 'redirect');
    check('the redirect record shows the source without its query either',
      redirectRec && leaks(redirectRec.sourceShown).length === 0 && /mail\.example\.test\/inbox\?…$/.test(redirectRec.sourceShown),
      redirectRec && redirectRec.sourceShown);
  }

  /* ---- 2. each page renders from the record and never paints a secret ------------- */
  const PAGES = [
    ['redirect-warning.js', 'redirect', { targetUrl: TARGET, sourceUrl: SOURCE, kind: 'forced-redirect', why: 'why-text' }, 'to-url', 'continue'],
    ['safe-browsing-block.js', 'safe-browsing', { url: TARGET, provider: 'Google Safe Browsing', threats: 'MALWARE' }, 'site', 'proceed'],
    ['cert-error.js', 'trust', null, 'site', 'retry'],
  ];
  for (const [file, kind, info, shownId, goId] of PAGES) {
    const { api, session } = workerSandbox();
    let url;
    if (kind === 'redirect') url = await api.redirectWarningPageUrl(Object.assign({ tabId: 3 }, info));
    else if (kind === 'safe-browsing') url = await api.safeBrowsingBlockPageUrl(Object.assign({ tabId: 3 }, info));
    else url = await api.trustErrorPageUrl({ kind: 'blocked_certificate', problem: 'Expired', why: 'w', risk: 'r' }, TARGET, 'net::ERR_CERT_DATE_INVALID', 3);
    const handle = new URL(url).searchParams.get('w');

    const page = runPage(file, handle, session);
    await tick();
    const painted = Object.values(page.els).map((e) => e.textContent).join('\n');
    check(file + ' paints no secret anywhere in the DOM', leaks(painted).length === 0, leaks(painted).join(', '));
    check(file + ' shows the display form of the address', page.els[shownId].textContent.indexOf('login.example.test/reset/*/confirm?') !== -1,
      page.els[shownId].textContent);

    /* continue: the record is consumed and the EXACT address is navigated to */
    const go = page.el(goId);
    go.removeAttribute('disabled');
    go.handlers.click();
    await tick();
    check(file + ' "continue" navigates to the exact address, query intact',
      page.nav.href.indexOf('code=' + SECRETS.code) !== -1 && /^https:\/\/login\.example\.test\//.test(page.nav.href), page.nav.href);
    check(file + ' "continue" does not carry userinfo', page.nav.href.indexOf(SECRETS.userinfo) === -1);
    const after = session.records();
    check(file + ' consumes the record on continue', !after[handle], Object.keys(after).join(','));

    /* the same handle a second time: nothing to continue to */
    const again = runPage(file, handle, session);
    await tick();
    const paintedAgain = Object.values(again.els).map((e) => e.textContent).join('\n');
    check(file + ' a consumed handle renders as expired', /This warning has expired/.test(paintedAgain), paintedAgain.slice(0, 120));
    check(file + ' and the expired page paints no address at all', paintedAgain.indexOf('login.example.test') === -1);
    check(file + ' and offers no way forward',
      again.el(goId).hidden === true || (kind === 'safe-browsing' && again.el('wrong').hidden === true), 'go=' + again.el(goId).hidden);
    again.el(goId).removeAttribute('disabled');
    again.el(goId).handlers.click();
    await tick();
    check(file + ' clicking forward on an expired page goes nowhere', again.nav.href === '', again.nav.href);
    again.el('back').handlers.click();
    check(file + ' but the way back still works', again.nav.href !== '', again.nav.href);
  }

  /* a record of the wrong kind is refused by the page */
  {
    const { api, session } = workerSandbox();
    const url = await api.trustErrorPageUrl({ kind: 'blocked_certificate' }, TARGET, 'net::ERR', 1);
    const handle = new URL(url).searchParams.get('w');
    const page = runPage('redirect-warning.js', handle, session);
    await tick();
    check('a redirect page handed a trust record treats it as missing', /expired/i.test(page.els['to-host'].textContent));
  }

  /* ---- 3. records are dropped with their tab, capped, and aged out ----------------- */
  {
    const { api, session } = workerSandbox();
    await api.redirectWarningPageUrl({ tabId: 1, targetUrl: TARGET, sourceUrl: '' });
    await api.redirectWarningPageUrl({ tabId: 2, targetUrl: TARGET, sourceUrl: '' });
    await api.forgetWarningRecordsForTab(1);
    const left = Object.values(session.records());
    check('closing a tab drops only that tab\'s records', left.length === 1 && left[0].tabId === 2, JSON.stringify(left.map((r) => r.tabId)));

    for (let i = 0; i < api.WARNING_RECORD_MAX + 5; i++) {
      await api.createWarningRecord('redirect', { tabId: 100 + i, url: 'https://x.example/' + i, at: Date.now() + i });
    }
    const capped = Object.keys(session.records()).length;
    check('the store is capped at ' + api.WARNING_RECORD_MAX, capped === api.WARNING_RECORD_MAX, 'has ' + capped);

  }

  /* expiry, on a store far below the cap -- checked on the full store above, the oldest
     record is also the one the cap would drop, and a TTL that never fired passed anyway */
  {
    const { api, session } = workerSandbox();
    const stale = await api.createWarningRecord('redirect', { tabId: 1, url: 'https://old.example/' });
    const fresh = await api.createWarningRecord('redirect', { tabId: 2, url: 'https://new.example/' });
    session.__store[api.WARNING_RECORD_PREFIX + stale].at = Date.now() - api.WARNING_RECORD_TTL_MS - 1000;
    await api.createWarningRecord('redirect', { tabId: 3, url: 'https://y.example/' });
    check('an expired record is pruned on the next write', !session.records()[stale]);
    check('and a live one is not', !!session.records()[fresh]);
  }

  /* two navigations stopped in the same instant must both get a record -- a single map under
     one key lost one of them to a read-modify-write race, which is why each record is its
     own key */
  {
    const { api, session } = workerSandbox();
    const [a, b] = await Promise.all([
      api.redirectWarningPageUrl({ tabId: 1, targetUrl: 'https://a.example/', sourceUrl: '' }),
      api.safeBrowsingBlockPageUrl({ tabId: 2, url: 'https://b.example/' }),
    ]);
    const both = session.records();
    check('two records created in the same instant both survive',
      Object.keys(both).length === 2 && both[new URL(a).searchParams.get('w')] && both[new URL(b).searchParams.get('w')],
      Object.keys(both).length + ' record(s)');
  }

  /* a handle that is not a handle reaches no key at all */
  {
    const { api, session } = workerSandbox();
    await api.redirectWarningPageUrl({ tabId: 1, targetUrl: TARGET, sourceUrl: '' });
    const page = runPage('redirect-warning.js', '../wardenone_recent_redirect_chains', session);
    await tick();
    check('a malformed handle is refused before it becomes a storage key',
      /This warning has expired/.test(page.els['to-host'].textContent));
  }

  /* a store that cannot be written yields a page with nothing to continue to, never a
     fallback to the old query string */
  {
    const { api, session } = workerSandbox();
    session.set = () => Promise.reject(new Error('quota'));
    const url = await api.redirectWarningPageUrl({ tabId: 1, targetUrl: TARGET, sourceUrl: SOURCE });
    check('a failed record write still leaks nothing into the URL', leaks(url).length === 0 && /\?w=$/.test(url), url);
  }

  /* ---- 4. the redirect mirror keeps a digest, not the address ---------------------- */
  {
    const { api, session } = workerSandbox();
    const chain = { hops: [{ to: 'https://hop.example/?x=1', host: 'hop.example', at: 1 }], domains: ['hop.example'], flagged: false };
    api.rememberRecentRedirectChain(5, TARGET, chain, 'completed-navigation');
    const entry = api.RECENT_REDIRECT_CHAINS[0];
    check('the summary carries no finalUrl field', entry && entry.finalUrl === undefined, JSON.stringify(entry));
    check('finalKey is a digest, not an address', /^[0-9a-f]{14}$/.test(entry.finalKey), entry.finalKey);
    check('the whole summary leaks no secret', leaks(JSON.stringify(entry)).length === 0, JSON.stringify(entry));
    check('and no field in it contains the host path either', JSON.stringify(entry).indexOf('/reset/') === -1);
    check('finalHost is kept, because the reviewer shows it', entry.finalHost === 'login.example.test');

    const hit = api.recentRedirectChainForDownload(TARGET, '');
    check('a download of the exact final URL still matches the chain', hit && hit.matchedOn === 'download-url');
    const fragmentOnly = TARGET.replace(/#.*$/, '#other');
    check('a fragment difference still matches, as before', !!api.recentRedirectChainForDownload(fragmentOnly, ''));
    const otherQuery = TARGET.replace('state=xyz', 'state=abc');
    check('a different query does not match, as before', !api.recentRedirectChainForDownload(otherQuery, ''));
    check('a referrer match still works', api.recentRedirectChainForDownload('https://elsewhere.example/file.exe', TARGET).matchedOn === 'referrer');

    /* what reaches storage.session */
    await new Promise((r) => setTimeout(r, 400));
    const mirrored = JSON.stringify(session.__store.wardenone_recent_redirect_chains || '');
    check('the mirror was persisted', mirrored.length > 2);
    check('the persisted mirror leaks no secret', leaks(mirrored).length === 0, mirrored.slice(0, 200));

    /* a legacy entry with the raw address is not carried forward */
    api.RECENT_REDIRECT_CHAINS.length = 0;
    session.__store.wardenone_recent_redirect_chains = [
      { hops: 2, domains: 2, chain: ['a.example'], finalUrl: TARGET, finalKey: TARGET.replace(/#.*$/, ''), finalHost: 'login.example.test', at: Date.now() },
      { hops: 1, domains: 1, chain: ['b.example'], finalKey: 'abcdef0123456789'.slice(0, 14), finalHost: 'b.example', at: Date.now() },
    ];
    const { api: api2 } = (() => {
      const w = workerSandbox();
      w.session.__store.wardenone_recent_redirect_chains = session.__store.wardenone_recent_redirect_chains;
      return w;
    })();
    await api2.RECENT_REDIRECT_MIRROR.ready();
    check('restoring the mirror drops the legacy entry that carried the address',
      api2.RECENT_REDIRECT_CHAINS.length === 1 && api2.RECENT_REDIRECT_CHAINS[0].finalHost === 'b.example',
      JSON.stringify(api2.RECENT_REDIRECT_CHAINS.map((e) => e.finalHost)));
  }

  /* ---- 5. nothing reads the old parameters any more ------------------------------- */
  for (const file of ['redirect-warning.js', 'safe-browsing-block.js', 'cert-error.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    check(file + ' reads no address from its own query string',
      !/params\.get\(['"](u|to|from)['"]\)/.test(src) && !/\.get\(['"](u|to|from)['"]\)/.test(src));
    check(file + ' resolves its record without the worker', /chrome\.storage\.session\.get\(/.test(src));
  }
  check('no builder sets an address parameter any more',
    !/params\.set\('(u|to|from)',/.test(RECORDS + TRUST));

  /* ---- 6. the policy says what is kept, and the numbers in it are the code's ------ */
  const policy = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
  check('the policy discloses the hand-off records', /Warning-page hand-off records/.test(policy));
  check('and says they are memory-only session storage', /\*session\* storage \(memory only/.test(policy));
  check('and that the page URL carries only a handle', /random\s+handle that is the only thing the warning page/.test(policy));
  const ttlHours = (() => { const m = /const WARNING_RECORD_TTL_MS = (\d+) \* 60 \* 60 \* 1000;/.exec(BG); return m ? Number(m[1]) : NaN; })();
  const WORD = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 8: 'eight', 12: 'twelve', 24: 'twenty-four' };
  check('the expiry it states is the one the code applies', ttlHours > 0 && policy.indexOf('expires after ' + WORD[ttlHours] + ' hours') !== -1,
    'code says ' + ttlHours + ' hours');
  check('it says the mirror keeps a fingerprint, not the address', /a fingerprint of the final\s+address — not the address/.test(policy));
  check('and no longer implies stripping the fragment makes an address safe', !/fragment-stripped/.test(policy));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all warning-page secret checks passed');
})();

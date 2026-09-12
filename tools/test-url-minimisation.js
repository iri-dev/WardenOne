/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What leaves the device, and what stays on it, must be less than the address (PRIV-03,
 * PRIV-05, PRIV-06, CWS-01).
 *
 * Three places kept or sent more of a URL than they needed. Every reputation provider was
 * handed normalizeSafeBrowsingUrl(url) -- the whole address with only the fragment removed --
 * so enabling Safe Browsing or urlhaus once turned every later navigation into a request
 * carrying its query string, and the answer was cached on disk under that address as the key.
 * A pending download review persisted item.finalUrl in full, signed CDN links included, for
 * two hours in the normal profile. The startup report stored page titles and, in a private
 * window, wrote them to the shared normal profile because its key was missing from the
 * ephemeral registry.
 *
 * This runs the finding's own verification: one address carrying userinfo, an OAuth code, a
 * reset token, an e-mail address and a fragment goes through the shipped provider clients
 * against a recording fetch, in every context the engine uses, and no request and no stored
 * cache key may contain any of it. The same address goes through the shipped download review
 * builder and the shipped startup report store, in a normal and a private worker.
 *
 * Run: node tools/test-url-minimisation.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const DL = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');
const SU = fs.readFileSync(path.join(ROOT, 'background-startup.js'), 'utf8');

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
function grabFn(src, head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error('cannot find ' + head);
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error(head + ' is unterminated');
  return src.slice(at, end + 3);
}
const tick = () => new Promise((r) => setTimeout(r, 5));

/* ---- the address under test ------------------------------------------------------- */

const SECRETS = {
  userinfo: 'alice:hunter2',
  code: 'AQABAAIAAAD-oauth-CODE-9f8e7d6c',
  session: 'sess-5f4dcc3b5aa765d61d8327deb882cf99',
  email: 'victim@mail.example',
  card: '4111111111111111',
  fragment: 'access_token=ya29.FRAGMENT-SECRET',
};
const PATH = '/reset/RESETTOKENabc123DEF456ghi789/confirm';
const TARGET = 'https://' + SECRETS.userinfo + '@login.acme-bank.net' + PATH
  + '?code=' + SECRETS.code + '&state=xyz&session=' + SECRETS.session
  + '&email=' + encodeURIComponent(SECRETS.email) + '&card=' + SECRETS.card
  + '#' + SECRETS.fragment;
const SENT = 'https://login.acme-bank.net' + PATH;
const RAW_MARKERS = ['hunter2', 'alice', SECRETS.code, SECRETS.session, 'victim', SECRETS.card,
  'FRAGMENT-SECRET', 'state=xyz', '?code=', 'ya29'];
function leaks(text) {
  const s = String(text || '');
  return RAW_MARKERS.filter((m) => s.indexOf(m) !== -1);
}

/* ---- lift the provider clients ---------------------------------------------------- */

const PROVIDERS = between(BG, 'const REPUTATION_MAX_BYTES = ', '\nfunction safeBrowsingThreatLabel', 'the provider clients');
const DIGEST = grabFn(BG, 'function urlDigest53(text) {');
const WHOIS_ERR = grabFn(BG, 'function firstString() {') + grabFn(BG, 'function whoisXmlErrorText(data) {');
const WHOIS_CONSTS = between(BG, 'const WHOISXML_TIMEOUT_MS = ', '\nfunction registrableDomainBg', 'the WhoisXML constants');
const MANUAL = grabFn(BG, 'async function wardenHostFindings(host, url, cfg) {');

function providerSandbox() {
  const store = {};
  const writes = [];
  const requests = [];
  const replies = {
    'safebrowsing.googleapis.com': () => ({ matches: [] }),
    'checkurl.phishtank.com': () => ({ results: { in_database: false, verified: false, valid: false } }),
    'urlhaus-api.abuse.ch': (u) => (/\/host\//.test(u) ? { query_status: 'no_results' } : { query_status: 'no_results' }),
    'threat-intelligence.whoisxmlapi.com': () => ({ total: 0, results: [] }),
  };
  const ctx = {
    console: { warn() {}, log() {} },
    URL, URLSearchParams, Date, Math, Object, Array, String, Number, Boolean, JSON, Promise, RegExp, Set, Map,
    Error, setTimeout, clearTimeout, AbortController, TextEncoder, btoa, encodeURIComponent, decodeURIComponent,
    parseInt, parseFloat, isFinite, isNaN, Symbol,
    WO_CLIENT_VERSION: '1.0.1',
    DEFAULT_CONFIG: { enabled: true },
    chrome: { storage: { session: { get: async () => ({}), set: async () => {} } } },
    localGet: async (key) => {
      const out = {};
      for (const k of (Array.isArray(key) ? key : [key])) if (k in store) out[k] = store[k];
      return out;
    },
    localSet: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); writes.push(Object.keys(obj)); },
    readResponseTextWithByteLimit: (res) => res.text(),
    utf8ByteLength: (t) => Buffer.byteLength(String(t || ''), 'utf8'),
    registrableDomainBg: (h) => String(h || '').split('.').slice(-2).join('.'),
    lookupDomainAge: async () => null,
    fetch: async (url, options) => {
      requests.push({ url: String(url), body: String((options && options.body) || ''), headers: (options && options.headers) || {} });
      const host = new URL(String(url)).hostname;
      const reply = replies[host] || (() => ({}));
      const data = reply(String(url));
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(data) };
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext([DIGEST, WHOIS_CONSTS, WHOIS_ERR, PROVIDERS, MANUAL,
    'globalThis.api = { urlReputationLookupUrl, normalizeSafeBrowsingUrl, reputationQueryUrl, reputationCacheKey,'
    + ' isReputationCacheKey, safeBrowsingLookupUrl, phishTankLookupUrl, urlHausLookupUrl, whoisXmlThreatIntelLookupUrl,'
    + ' checkSafeBrowsingUrl, fetchPhishTankUrl, fetchUrlHausUrl, loadUrlHausCache, loadSafeBrowsingCache,'
    + ' shouldUsePhishTankForContext, wardenHostFindings, urlDigest53 };',
  ].join('\n'), ctx);
  return { api: ctx.api, store, writes, requests, replies };
}

function fullState(overrides) {
  const cfg = Object.assign({
    enabled: true,
    downloadSafeBrowsing: true, downloadSafeBrowsingKey: 'sb-key',
    urlHaus: true, urlHausKey: 'uh-key',
    phishTank: true, phishTankKey: 'pt-key',
    whoisXmlThreatIntel: true, whoisXmlKey: 'wx-key',
  }, overrides || {});
  return {
    cfg, key: cfg.downloadSafeBrowsingKey, phishTankKey: cfg.phishTankKey, abuseIpDbKey: '', urlHausKey: cfg.urlHausKey,
    whoisXmlKey: cfg.whoisXmlKey, safeBrowsingEnabled: true, phishTankEnabled: true, openPhishEnabled: false,
    abuseIpDbEnabled: false, urlHausEnabled: true, whoisXmlEnabled: false, whoisXmlReputationEnabled: false,
    whoisXmlThreatIntelEnabled: true, enabled: true,
  };
}

/* what each recorded request actually asked about */
function askedAbout(req) {
  const host = new URL(req.url).hostname;
  if (host === 'safebrowsing.googleapis.com') {
    const body = JSON.parse(req.body);
    return { provider: 'Google Safe Browsing', asked: body.threatInfo.threatEntries.map((e) => e.url).join(' ') };
  }
  if (host === 'checkurl.phishtank.com') return { provider: 'PhishTank', asked: new URLSearchParams(req.body).get('url') };
  if (host === 'urlhaus-api.abuse.ch') {
    const p = new URLSearchParams(req.body);
    return { provider: 'URLhaus' + (p.get('host') ? ' host' : ''), asked: p.get('url') || p.get('host') };
  }
  if (host === 'threat-intelligence.whoisxmlapi.com') return { provider: 'WhoisXML Threat Intelligence', asked: new URL(req.url).searchParams.get('ioc') };
  return { provider: host, asked: req.url + ' ' + req.body };
}

(async () => {
  /* ---- 1. the form a provider is asked about ------------------------------------- */
  console.log('1. reputationQueryUrl');
  {
    const { api } = providerSandbox();
    check('userinfo, query and fragment are gone; scheme, host and path stay', api.reputationQueryUrl(TARGET) === SENT, api.reputationQueryUrl(TARGET));
    check('the whole-address form still exists for the engine to compare against',
      api.normalizeSafeBrowsingUrl(TARGET).indexOf('?code=') !== -1 && api.normalizeSafeBrowsingUrl(TARGET).indexOf('#') === -1);
    check('a query-only difference collapses to one lookup',
      api.reputationQueryUrl('https://a.acme.net/p?x=1') === api.reputationQueryUrl('https://a.acme.net/p?x=2'));
    check('a path difference does not', api.reputationQueryUrl('https://a.acme.net/p1') !== api.reputationQueryUrl('https://a.acme.net/p2'));
    check('a non-web scheme is refused', api.reputationQueryUrl('ftp://a.acme.net/x') === '' && api.reputationQueryUrl('chrome://settings') === '');
    check('a private host is refused', api.reputationQueryUrl('http://192.168.1.1/admin?pw=x') === '' && api.reputationQueryUrl('http://localhost/x') === '');
    check('the form is idempotent', api.reputationQueryUrl(SENT) === SENT);
    const long = 'https://a.acme.net/' + 'p/'.repeat(2000);
    check('cut at 1,500 characters', api.reputationQueryUrl(long).length === 1500);
    check('the cache key is a 53-bit digest, not the address',
      api.isReputationCacheKey(api.reputationCacheKey(SENT)) && api.reputationCacheKey(SENT) !== SENT && api.reputationCacheKey(SENT) === api.urlDigest53(SENT));
    check('an address-shaped key is not a cache key', !api.isReputationCacheKey(SENT) && !api.isReputationCacheKey('login.example.test'));
  }

  /* ---- 2. every provider, every context: the request carries no secret ----------- */
  console.log('2. what the providers are sent');
  for (const context of ['page', 'link', 'paste', 'form', 'manual']) {
    const { api, requests } = providerSandbox();
    const verdict = await api.urlReputationLookupUrl(api.normalizeSafeBrowsingUrl(TARGET), Object.assign({ context }, fullState()));
    const asked = requests.map(askedAbout);
    const providers = asked.map((a) => a.provider);
    check('[' + context + '] all four providers were asked (' + providers.join(', ') + ')',
      ['Google Safe Browsing', 'PhishTank', 'URLhaus', 'WhoisXML Threat Intelligence'].every((p) => providers.indexOf(p) !== -1) && verdict && verdict.ok);
    for (const a of asked) {
      const expected = a.provider === 'URLhaus host' ? 'login.acme-bank.net' : SENT;
      check('[' + context + '] ' + a.provider + ' was asked about ' + expected, a.asked === expected, a.asked);
    }
    const leaked = requests.map((r) => leaks(r.url + ' ' + r.body + ' ' + JSON.stringify(r.headers))).flat();
    check('[' + context + '] no request carried userinfo, the code, the session, the e-mail, the card or the fragment',
      leaked.length === 0, leaked.join(', '));
  }

  /* the download path calls the clients directly, the way background-downloads.js does */
  console.log('3. the download path');
  {
    const { api, requests } = providerSandbox();
    const cfg = fullState().cfg;
    await api.safeBrowsingLookupUrl(TARGET, { cfg, key: cfg.downloadSafeBrowsingKey });
    await api.urlHausLookupUrl(TARGET, { cfg, key: cfg.urlHausKey, context: 'download' });
    await api.phishTankLookupUrl(TARGET, { cfg, key: cfg.phishTankKey });
    await api.whoisXmlThreatIntelLookupUrl(TARGET, { cfg, key: cfg.whoisXmlKey });
    const asked = requests.map(askedAbout);
    check('four clients asked directly, as the download grader does', asked.length >= 4);
    for (const a of asked) {
      const expected = a.provider === 'URLhaus host' ? 'login.acme-bank.net' : SENT;
      check('[download] ' + a.provider + ' was asked about ' + expected, a.asked === expected, a.asked);
    }
    const leaked = requests.map((r) => leaks(r.url + ' ' + r.body)).flat();
    check('[download] no request carried a secret', leaked.length === 0, leaked.join(', '));
    check('background-downloads.js still hands the clients the raw download URL, so the strip must live in the clients',
      /safeBrowsingLookupUrl\(url, \{ cfg, key: cfg\.downloadSafeBrowsingKey \}\)/.test(DL));
  }

  /* the raw request builders refuse a query on their own */
  {
    const { api, requests } = providerSandbox();
    await api.checkSafeBrowsingUrl(TARGET, 'sb-key');
    await api.fetchPhishTankUrl(TARGET, 'pt-key');
    await api.fetchUrlHausUrl(TARGET, 'uh-key');
    const asked = requests.map(askedAbout);
    check('the three raw builders strip on their own, so no future caller can send more', asked.length === 3 && asked.every((a) => a.asked === SENT),
      asked.map((a) => a.asked).join(' | '));
  }

  /* ---- 4. the gate still reads the query on the device, then does not send it ------- */
  console.log('4. the held-back providers');
  {
    const { api, requests } = providerSandbox();
    const redirectish = 'https://cheap.xyz/go?redirect=https://bank.example/login&sid=' + SECRETS.session;
    check('a ?redirect= on a cheap suffix still trips the PhishTank gate on the device',
      api.shouldUsePhishTankForContext(api.normalizeSafeBrowsingUrl(redirectish), 'page') === true);
    await api.urlReputationLookupUrl(api.normalizeSafeBrowsingUrl(redirectish), Object.assign({ context: 'page' }, fullState()));
    const pt = requests.map(askedAbout).find((a) => a.provider === 'PhishTank');
    check('and PhishTank is then asked about the page without it', !!pt && pt.asked === 'https://cheap.xyz/go', pt && pt.asked);
    check('the session id never left', requests.every((r) => r.body.indexOf(SECRETS.session) === -1 && r.url.indexOf(SECRETS.session) === -1));
    const plain = 'https://news.dailyreport.net/story/12?utm=' + SECRETS.session;
    const before = requests.length;
    await api.urlReputationLookupUrl(api.normalizeSafeBrowsingUrl(plain), Object.assign({ context: 'page' }, fullState()));
    const later = requests.slice(before).map(askedAbout).map((a) => a.provider);
    check('an ordinary page still does not reach PhishTank or WhoisXML',
      later.indexOf('PhishTank') === -1 && later.indexOf('WhoisXML Threat Intelligence') === -1 && later.indexOf('Google Safe Browsing') !== -1, later.join(', '));
  }

  /* ---- 5. the caches: digest keys, no address, and a hit on the second look --------- */
  console.log('5. the caches on disk');
  {
    const { api, store, requests } = providerSandbox();
    await api.urlReputationLookupUrl(api.normalizeSafeBrowsingUrl(TARGET), Object.assign({ context: 'page' }, fullState()));
    await tick();
    const CACHES = ['wardenone_safe_browsing_cache', 'wardenone_phishtank_cache', 'wardenone_urlhaus_cache', 'wardenone_whoisxml_threat_cache'];
    for (const name of CACHES) {
      const cache = store[name] || {};
      const keys = Object.keys(cache);
      check(name + ' was written with one entry under a digest key', keys.length === 1 && api.isReputationCacheKey(keys[0]), keys.join(','));
      const text = JSON.stringify(cache);
      check(name + ' holds neither the address nor its host', leaks(text).length === 0 && text.indexOf('login.acme-bank.net') === -1 && text.indexOf(PATH) === -1, text.slice(0, 160));
    }
    const first = requests.length;
    const again = await api.urlReputationLookupUrl(api.normalizeSafeBrowsingUrl(TARGET.replace('state=xyz', 'state=other')), Object.assign({ context: 'page' }, fullState()));
    check('the same page with a different query is answered from the cache with no request',
      requests.length === first && again && again.ok && again.results.every((r) => r.cached === true), 'requests ' + first + ' -> ' + requests.length);
  }

  /* a cache written by an earlier build, keyed by addresses, is emptied of them on load */
  {
    const { api, store, writes } = providerSandbox();
    const future = Date.now() + 60 * 60 * 1000;
    const digest = api.reputationCacheKey('https://kept.example/p');
    store.wardenone_urlhaus_cache = {
      ['https://old.example/dl?token=' + SECRETS.session]: { checkedAt: 1, expiresAt: future, result: { ok: true, hit: false } },
      'https://old.example/plain': { checkedAt: 1, expiresAt: future, result: { ok: true, hit: false } },
      [digest]: { checkedAt: 1, expiresAt: future, result: { ok: true, hit: false } },
    };
    const cache = await api.loadUrlHausCache();
    await tick();
    check('address-shaped keys from the old build are dropped on load', Object.keys(cache).length === 1 && !!cache[digest], Object.keys(cache).join(','));
    check('and the trimmed cache is written back at once', writes.some((w) => w.indexOf('wardenone_urlhaus_cache') !== -1)
      && Object.keys(store.wardenone_urlhaus_cache).length === 1 && leaks(JSON.stringify(store)).length === 0);
    const sb = await api.loadSafeBrowsingCache();
    check('an empty cache loads as empty and writes nothing', Object.keys(sb).length === 0 && !writes.some((w) => w.indexOf('wardenone_safe_browsing_cache') !== -1));
  }

  /* ---- 6. the right-click check says when less than the selection was sent --------- */
  console.log('6. the manual check');
  {
    const { api, requests, store } = providerSandbox();
    /* the manual check reads the saved config itself */
    store.wardenone_config = fullState().cfg;
    const ctxLines = await api.wardenHostFindings('login.acme-bank.net', TARGET, fullState().cfg).catch((e) => ['threw ' + e]);
    check('the manual check runs the same lookup', ctxLines.some((l) => /Not on any reputation list/.test(l)), ctxLines.join(' | '));
    check('and says the query string was not sent', ctxLines.some((l) => l === 'Its query string was not sent.'), ctxLines.join(' | '));
    check('with nothing secret in the request', requests.every((r) => leaks(r.url + ' ' + r.body).length === 0));
    const plainLines = await api.wardenHostFindings('news.dailyreport.net', 'https://news.dailyreport.net/story', fullState().cfg);
    check('an address with nothing to cut gets no such line', !plainLines.some((l) => /query string/.test(l)), plainLines.join(' | '));
  }

  /* ---- 7. the download review keeps a display form, not the link (PRIV-05) --------- */
  console.log('7. the download review');
  {
    const LOG_HELPERS = between(BG, 'const LOG_URL_MAX = 300;', '\n// Details carry URLs too', 'the log URL helpers');
    const REVIEW = grabFn(DL, 'function downloadDisplayUrl(raw) {') + grabFn(DL, 'function buildDownloadReview(item, rep, pauseResult) {')
      + grabFn(DL, 'function downloadHashSourceMeta(fetched, kind, extra) {') + grabFn(DL, 'async function rememberPendingDownload(review) {');
    const store = {};
    const ctx = {
      console, URL, Date, Math, Object, Array, String, Number, JSON, Promise, RegExp,
      PENDING_DOWNLOADS: {},
      DOWNLOAD_PENDING_KEY: 'wardenone_pending_downloads',
      DOWNLOAD_REVIEW_TTL_MS: 2 * 60 * 60 * 1000,
      DOWNLOAD_HASH_MAX_BYTES: 50 * 1024 * 1024,
      DOWNLOAD_HASH_SOURCE: { NOT_AVAILABLE: 'not_available', URL_REFETCH: 'url_refetch' },
      DOWNLOAD_HASH_SOURCE_META: { not_available: { label: 'n/a', available: false, exactFile: false, verified: false, caveat: '' }, url_refetch: { label: 'refetch', available: true, exactFile: false, verified: false, caveat: '' } },
      normalizeDownloadHashSourceKind: (k) => k || 'not_available',
      downloadRecommendation: () => 'review',
      withDownloadStore: async (key, fn) => fn(),
      downloadStateGet: async (key) => ({ [key]: store[key] }),
      downloadStateSet: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(LOG_HELPERS + '\n' + REVIEW + '\nglobalThis.api = { downloadDisplayUrl, buildDownloadReview, downloadHashSourceMeta, rememberPendingDownload };', ctx);
    const api = ctx.api;
    const signed = 'https://' + SECRETS.userinfo + '@cdn.acme-files.net/u/9F8E7D6C1234ABCD/report.pdf?X-Amz-Signature=' + SECRETS.session + '&X-Amz-Credential=' + SECRETS.code + '#' + SECRETS.fragment;
    const item = { id: 41, filename: 'C:\\Users\\me\\Downloads\\report.pdf', url: 'https://start.example/get?token=' + SECRETS.session, finalUrl: signed, mime: 'application/pdf' };
    const rep = { source: 'cdn.acme-files.net', grade: 'C', status: 'review', color: 'amber', score: 3, reasons: ['signed link'], fileHash: {
      sha256: 'ab'.repeat(32), hashSource: api.downloadHashSourceMeta({ requestedUrl: signed, finalUrl: signed, redirects: 1 }, 'url_refetch') } };
    const review = api.buildDownloadReview(item, rep, { ok: true });
    check('the review carries scheme, host and a starred path, not the signed link', review.url === 'https://cdn.acme-files.net/u/*/report.pdf', review.url);
    check('the Chrome download id is what identifies the item', review.downloadId === 41 && review.id === '41');
    check('the re-fetch addresses inside the hash record are the same display form',
      review.fileHash.hashSource.requestedUrl === 'https://cdn.acme-files.net/u/*/report.pdf' && review.fileHash.hashSource.finalUrl === review.fileHash.hashSource.requestedUrl,
      review.fileHash.hashSource.requestedUrl);
    await api.rememberPendingDownload(review);
    const persisted = JSON.stringify(store);
    check('the persisted review holds no userinfo, signature, credential or fragment', leaks(persisted).length === 0, leaks(persisted).join(', '));
    check('and not the start-of-chain token either', persisted.indexOf('token=') === -1);
    /* expiry at write time */
    store.wardenone_pending_downloads['7'] = { id: '7', createdAt: Date.now() - 3 * 60 * 60 * 1000, url: 'https://stale.example/f?sig=' + SECRETS.card };
    ctx.PENDING_DOWNLOADS['7'] = store.wardenone_pending_downloads['7'];
    await api.rememberPendingDownload(api.buildDownloadReview(Object.assign({}, item, { id: 42 }), rep, { ok: true }));
    check('an expired review is dropped the moment another is written, from the store and from memory',
      !store.wardenone_pending_downloads['7'] && !ctx.PENDING_DOWNLOADS['7'] && !!store.wardenone_pending_downloads['42'] && !!store.wardenone_pending_downloads['41']);
    const blob = api.downloadDisplayUrl('blob:https://app.acme.net/3f9a1c2e-uuid?sig=' + SECRETS.card);
    check('a blob: address is shown by its inner origin and path, without the blob: wrapper or a query',
      /^https:\/\/app\.acme\.net\//.test(blob) && blob.indexOf(SECRETS.card) === -1, blob);
  }

  /* ---- 8. the startup report: host and reason, in the right store (PRIV-06) --------- */
  console.log('8. the startup report');
  {
    const STORE = between(SU, 'var STARTUP_REPORT_KEY = ', '\nasync function startupCheckEnabled', 'the startup report store');
    function startupSandbox(incognito) {
      const local = {}; const session = {};
      const ctx = {
        Date, Object, String, Number, Promise, JSON,
        INCOGNITO_CONTEXT: incognito,
        chrome: { storage: { session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => { Object.assign(session, o); } } } },
        localGet: async (k) => ({ [k]: local[k] }),
        localSet: async (o) => { Object.assign(local, o); },
      };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(STORE + '\nglobalThis.api = { startupReportGet, startupReportSet, STARTUP_REPORT_TTL_MS };', ctx);
      return { api: ctx.api, local, session };
    }
    const report = { when: Date.now(), tabs: [{ id: 3, host: 'private.example', why: 'on a known malware/scam blocklist' }] };
    const priv = startupSandbox(true);
    await priv.api.startupReportSet(report);
    check('a private worker writes its report to storage.session only',
      !!priv.session.wardenone_startup_report && !('wardenone_startup_report' in priv.local));
    check('and reads it back from there', (await priv.api.startupReportGet()) && (await priv.api.startupReportGet()).tabs[0].host === 'private.example');
    const norm = startupSandbox(false);
    await norm.api.startupReportSet(report);
    check('a normal worker writes to storage.local as before',
      !!norm.local.wardenone_startup_report && !('wardenone_startup_report' in norm.session));
    await norm.api.startupReportSet({ when: Date.now() - norm.api.STARTUP_REPORT_TTL_MS - 1000, tabs: report.tabs });
    check('a report older than a day is not shown again', (await norm.api.startupReportGet()) === null);
    check('the finding keeps no title', !/title:/.test(between(SU, 'findings.tabs.push(', ')', 'the tab finding')) && /findings\.tabs\.push\(\{ id: t\.id, host: rd, why:/.test(SU));
    const registry = between(BG, 'const INCOGNITO_EPHEMERAL_LOCAL_KEYS = new Set([', ']);', 'the ephemeral registry');
    check('the key is in the ephemeral registry the isolation test reads', /'wardenone_startup_report',/.test(registry));
    check('the popup renders the host and reason, not a title',
      /section\('Risky open tabs', tabs, \(t\) => \(t\.host \|\| 'Tab'\) \+ ' \(' \+ t\.why \+ '\)'\);/.test(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8')));
    const direct = (src) => (src.match(/local(?:Get|Set)\(\{? ?\[?STARTUP_REPORT_KEY/g) || []).length;
    check('the worker reads and clears the report through the store, not localGet',
      /sendResponse\(\{ ok: true, report: \(await startupReportGet\(\)\) \|\| null \}\)/.test(BG) && /await startupReportSet\(null\);/.test(BG)
      && direct(BG) === 0 && direct(SU) === 2, 'direct storage calls: bg ' + direct(BG) + ', startup ' + direct(SU) + ' (the store itself makes two)');
  }

  /* ---- 9. the words match the code (CWS-01) ------------------------------------------ */
  console.log('9. disclosure');
  {
    const policy = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
    const popup = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
    const keys = fs.readFileSync(path.join(ROOT, 'api-keys.html'), 'utf8');
    check('the policy says providers get scheme, host and path', /\*\*scheme, host and path\*\*/.test(policy));
    check('and that the query, fragment and user name are removed before the request', /query string \(everything\s+from `\?` on\), the `#fragment` and any user name in the address are removed before the\s+request/.test(policy));
    check('and that a secret in the path still travels', /secret carried \*in the path\*/.test(policy));
    check('and no longer says the full address is sent', !/receive the \*\*full address\*\*/.test(policy) && !/PhishTank then receives the full address/.test(policy));
    check('and corrects its WhoisXML claim', /PhishTank and WhoisXML Threat Intelligence then receive the\s+same scheme, host and path/.test(policy));
    check('and says the cache holds a fingerprint', /under a\s+fingerprint of the address rather than the address itself/.test(policy));
    check('the policy discloses the download review form and the startup report', /Download-review records for the Download Guard: the file name/.test(policy) && /startup safety check's report/.test(policy));
    check('the popup discloses trigger, recipient, fields and retention before the first switch',
      popup.indexOf('id="provider-disclosure"') !== -1 && popup.indexOf('id="provider-disclosure"') < popup.indexOf('data-key="downloadSafeBrowsing"')
      && /asked <strong>on its own<\/strong>/.test(popup) && /<strong>scheme, host and path<\/strong>, never its query string/.test(popup) && /for up to 12 hours/.test(popup));
    check('the popup rows for the four URL providers say what is sent',
      /sent to Google as scheme, host and path/.test(popup) && /sent to abuse\.ch as scheme, host and path/.test(popup)
      && /sent to PhishTank as scheme, host and path/.test(popup) && /downloads are sent as scheme, host and path/.test(popup));
    check('the api-keys page no longer presents a lookup as something you press', /a lookup is not something you press/.test(keys) && !/nothing else goes with it/.test(keys));
    check('the policy keeps "nothing to us" apart from "nothing leaves the device"',
      /WardenOne sends nothing to us\./.test(policy) && /a different statement from "nothing leaves your device"/.test(policy)
      && !/does not collect or transmit: your browsing history/.test(policy));
    const site = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
    check('the site no longer says browsing history goes nowhere', !/does not send your browsing history anywhere/.test(site)
      && /unless you switch on an\s+optional check that has to ask an outside service/.test(site));
    const ttlMax = Math.max(...['URLHAUS_HIT_TTL_MS', 'WHOISXML_THREAT_CLEAN_TTL_MS', 'PHISHTANK_HIT_TTL_MS', 'SAFE_BROWSING_CLEAN_TTL_MS']
      .map((n) => { const m = new RegExp('const ' + n + ' = ([0-9 *]+);').exec(BG); return m ? eval(m[1]) : 0; }));
    check('the twelve hours the popup and policy state is the longest TTL in the code', ttlMax === 12 * 60 * 60 * 1000 && /twelve hours/.test(policy), String(ttlMax));
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all URL-minimisation checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

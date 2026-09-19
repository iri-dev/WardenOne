/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Search-result warnings.
 *
 * THE PROMISES ARE THE FEATURE, and each one is a way this could go wrong rather than a
 * behaviour to confirm:
 *
 *   1. It never says a result is safe. No positive verdict exists, at any level.
 *   2. It answers from local lists only. No verdict path may reach the network -- ten
 *      badges per search would mean ten queries per search, handing a third party the
 *      thing the reader typed.
 *   3. "Known malicious" means the malware feeds, NOT the merged blocklist, which also
 *      holds ad and tracker hosts. One wrong "malicious" beside an analytics domain
 *      discredits every true one.
 *   4. It marks; it never hides or reorders.
 *
 * searchResultVerdictForHost is lifted out of background.js and run for real.
 *
 * Run: node tools/test-search-result-warnings.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { h, makeDocument } = require('./lib/mini-dom');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'search-junk.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let failed = 0;
let realLoggers = null;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

/* ---- the scorer, run for real --------------------------------------------- */
const start = BG.indexOf('function searchResultVerdictForHost(');
const end = BG.indexOf('async function searchResultVerdicts(', start);
check('the scorer is where the slice expects it', start > 0 && end > start);
const BLOCK = BG.slice(start, end);
/* Comments in here TALK about the things these checks forbid -- "BLOCKED_DOMAINS also
   holds ad hosts", "innerHTML would let a listed domain..." -- so a search over the raw
   text passes or fails on prose. Every forbidden-token check reads the code only. */
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODE = codeOnly(BLOCK);

function makeScorer(world) {
  const sandbox = Object.assign({
    String, Number, Boolean, Object, Math, Set, RegExp, JSON, console,
    SECURITY_DOMAINS: new Set(world.security || []),
    GRABBER_FEED_DOMAINS: new Set(world.grabbers || []),
    GRABBER_PACKAGED_DOMAINS: new Set(world.packaged || []),
    SEARCH_WARN_NEW_DOMAIN_DAYS: 60,
    registrableDomainBg: (h) => {
      const parts = String(h || '').split('.').filter(Boolean);
      if (parts.length <= 2) return parts.join('.');
      const last2 = parts.slice(-2).join('.');
      return /^(co|com|org|net|ac)\.[a-z]{2}$/.test(last2) ? parts.slice(-3).join('.') : last2;
    },
    hostMatchesAllowlist: (h, list) => (list || []).some((a) => h === a || h.endsWith('.' + a)),
    normalizeIpLiteral: (v) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) && !/^(10|127|192\.168)\./.test(v) ? v : ''),
    loginBrandRiskForHost: world.brand || (() => null),
    looksLikeLookalikeHost: world.lookalike || (() => false),
  }, world.extra || {});
  vm.createContext(sandbox);
  vm.runInContext(BLOCK + ';globalThis.__score = searchResultVerdictForHost;', sandbox,
    { filename: 'background.js:searchwarn' });
  /* A scorer that reaches for something the sandbox does not provide -- BLOCKED_DOMAINS,
     a network lookup -- throws, and an uncaught throw here would end the run before the
     source-text checks below could say what went wrong. A crash is a failure, and it has
     to be reported as one rather than taking the rest of the suite down with it. */
  return (host, ctx) => {
    try { return sandbox.__score(host, ctx); } catch (e) {
      failed++;
      console.error('[fail] the scorer threw on ' + host + ' -- ' + String(e && e.message || e)
        + '; it may only read what the background hands it');
      return { level: '__threw__' };
    }
  };
}
const CTX = { allowlist: [], learned: {}, ages: {} };

/* ---- 1. there is no good news --------------------------------------------- */
{
  const score = makeScorer({});
  for (const host of ['example.com', 'wikipedia.org', 'some-random-blog.co.uk', 'news.bbc.co.uk']) {
    const r = score(host, CTX);
    check('an unknown host gets no verdict at all (' + host + ')', r === null,
      'got ' + JSON.stringify(r) + '; "nothing known" must never become a mark');
  }
}
check('no verdict level is a positive one',
  !/level:\s*'(safe|clean|ok|good|trusted|known|verified)'/.test(BG),
  'a green badge beside an unexamined result spends trust the lists cannot back');
check('every exit from the scorer is either null or a warning',
  CODE.split('return ').slice(1).every((r) => /^(null|\{)/.test(r.trim())),
  'an object for a clean host is a shape the page could render as reassurance');
{
  /* Only this feature's own row. The popup has "Trusted script sites" and "Trusted
     download sites" elsewhere, and those are lists the reader made, not claims about a
     result nobody examined. */
  const row = POPUP_HTML.slice(POPUP_HTML.indexOf('data-key="warnSearchResults"') - 2200,
    POPUP_HTML.indexOf('data-key="warnSearchResults"'));
  check('the row exists to check', row.length > 200);
  for (const word of ['Safe', 'Verified', 'Trusted', 'Checked', 'Clean', 'No threats']) {
    check('the toggle copy never promises "' + word + '"',
      !new RegExp('\\b' + word + '\\b').test(row.replace(/never marks anything safe/i, '')),
      'the one permitted use of the word is the sentence saying it is never claimed');
  }
}

/* ---- 2. local only -------------------------------------------------------- */
{
  /* Nothing in the scorer may reach out. If any of these ever appears, the feature has
     quietly become "tell a third party every result the reader was shown". */
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'lookupDomainAge', 'urlReputationLookup',
    'abuseIpDb', 'safeBrowsing', 'virusTotal', 'openPhish']) {
    check('the scorer never calls ' + forbidden, CODE.indexOf(forbidden) < 0,
      'a badge per result would be a query per result');
  }
  const handlerAt = BG.indexOf("msg.kind === 'search-result-check'");
  check('the handler exists', handlerAt > 0);
  const handler = BG.slice(handlerAt, handlerAt + 1900);
  check('the handler does not reach the network either',
    !/fetch\(|lookupDomainAge|urlReputationLookup/.test(handler));
  check('the handler is restricted to the search engines it runs on',
    /SEARCH_WARN_ENGINE_HOST\.test/.test(handler),
    'anywhere else this answers "is my domain on your blocklist yet" for anyone who asks');
  check('and only for a tab, never an extension page',
    /messageSenderIsTab\(sender\)/.test(BG.slice(handlerAt - 120, handlerAt + 200)));
  check('the batch is capped', /SEARCH_WARN_MAX_HOSTS/.test(BG));
  check('the handler answers with what it has and says whether the feed lists are in yet',
    /const ready = SECURITY_DOMAINS\.size > 0;/.test(handler)
    && /sendResponse\(\{ ok: true, ready, verdicts: await searchResultVerdicts\(msg\.hosts, cfg\) \}\)/.test(handler),
    'a worker woken from idle spends ~400-600 ms restoring its lists; waiting for that made every warning late');
  check('and it does not wait for the restore before answering',
    !/await securityStoresReady\(\)/.test(handler),
    'the packaged IP-logger list is in memory at once; the feed verdicts come on the second ask');

  /* The bug this suite did not catch the first time. TAB_CONTEXT_ALLOWED_MESSAGES is
     consulted BEFORE any handler runs, so a kind a content script sends but nobody
     registered is refused as "Not allowed from this context" and the feature is dead on
     every page -- while every unit test still passes, because the handler it tests is
     never reached. Checked for EVERY kind the content scripts send, not just this one:
     the class of mistake matters more than the instance. */
  const allowFrom = BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES = new Set([');
  const allowList = BG.slice(allowFrom, BG.indexOf(']);', allowFrom));
  const limits = BG.slice(BG.indexOf('const TAB_CONTEXT_RATE_LIMITS'),
    BG.indexOf('\n};', BG.indexOf('const TAB_CONTEXT_RATE_LIMITS')));
  const senders = ['search-junk.js', 'consent-reject.js', 'consent-wall.js', 'mail-shield.js'];
  for (const file of senders) {
    let source = '';
    try { source = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (_) { continue; }
    /* Only top-level message kinds: a `kind` inside a detail payload is not one, so the
       match is anchored to a sendMessage call rather than to the word anywhere. */
    const sent = [...source.matchAll(/sendMessage\(\s*\{\s*kind:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
    for (const kind of new Set(sent)) {
      check(file + " may actually send '" + kind + "'", allowList.includes("'" + kind + "'"),
        'a content script sending a kind that is not on the allowlist is refused before '
        + 'its handler runs, and every unit test still passes');
      check("and '" + kind + "' has a rate limit", limits.includes("'" + kind + "'"),
        'the table\'s own comment says every tab-allowed kind needs one');
    }
  }
}

/* ---- 3. malicious means the malware feeds, not the merged blocklist -------- */
{
  const score = makeScorer({ security: ['evil.example'] });
  const bad = score('evil.example', CTX);
  check('a malware-feed domain is called malicious', bad && bad.level === 'malicious',
    JSON.stringify(bad));
  check('and says which list it means', bad && /blocklist/i.test(bad.label));
}
check('the scorer reads SECURITY_DOMAINS, never BLOCKED_DOMAINS',
  CODE.indexOf('SECURITY_DOMAINS') > 0 && CODE.indexOf('BLOCKED_DOMAINS') < 0,
  'the merged set also holds ad and tracker hosts; calling one of those malicious is the '
  + 'single mistake that would get this feature switched off for good');
check('the security half is tracked separately in memory',
  /let SECURITY_DOMAINS = new Set\(\)/.test(BG));
check('and restored from storage as the leading run of the stored list',
  /wardenone_blocked_security_count/.test(BG)
  && /SECURITY_DOMAINS = new Set\(r\.wardenone_blocked_domains\.slice\(0, n\)\)/.test(BG));
check('the stored count can never outrun the stored list',
  /Math\.min\(r\.wardenone_blocked_domains\.length, Number\(r\.wardenone_blocked_security_count\)/.test(BG),
  'an over-long count would claim ad domains are malware');
check('the pressure trim cuts the count with the array',
  /wardenone_blocked_security_count: keptSecurity/.test(BG),
  'trimming the list and leaving the count is the same over-claim by another route');
{
  const grab = makeScorer({ grabbers: ['grabify.example'] })('grabify.example', CTX);
  check('a known IP-logger is called out', grab && grab.level === 'malicious', JSON.stringify(grab));
  check('and called what it is', grab && /IP logger/.test(grab.label) && /reveals your address/.test(grab.label), grab && grab.label);
  const packaged = makeScorer({ packaged: ['logger.example'] })('www.logger.example', CTX);
  check('the packaged IP-logger ruleset counts, not only the feed', packaged && /IP logger/.test(packaged.label), JSON.stringify(packaged));
  /* grabify.link is on the packaged ruleset AND on the malware feeds. The feed answered first
     and called it malware and scam -- true of the list, wrong about the site. */
  const both = makeScorer({ packaged: ['grabify.example'], security: ['grabify.example'] })('grabify.example', CTX);
  check('an IP logger that is also on a malware feed is described as an IP logger', both && /IP logger/.test(both.label), both && both.label);
  check('the scorer never reads the packaged ruleset off disk itself', !/rules\.json|fetch\(/.test(CODE));
  check('the worker reads the packaged ruleset once and the handler waits for it',
    /const GRABBER_PACKAGED_DOMAINS = new Set\(\)/.test(BG) && /getURL\('rules\.json'\)/.test(BG)
    && /await loadPackagedGrabberDomains\(\);/.test(BG.slice(BG.indexOf("msg.kind === 'search-result-check'"), BG.indexOf("msg.kind === 'search-result-check'") + 1900)));
}
{
  /* rules.json is not only block rules: it carries ALLOW rules for google.com, googleapis.com,
     accounts.google.com and the login-compat set. Reading every rule's domains labelled
     Google's own tabs on a Google results page as IP loggers. The real loader, run against
     the real file, and against a hand-built one. */
  const from = BG.indexOf('function packagedGrabberDomainsFrom(rules) {');
  const to = BG.indexOf('let __grabberPackagedLoad = null;', from);
  check('the packaged loader is where the slice expects it', from > 0 && to > from);
  const sandbox = {
    String, Set, Array, RegExp,
    registrableDomainBg: (h) => { const p = String(h).split('.'); return p.slice(-2).join('.'); },
    isNeverBlockDomain: (d) => /^(google\.com|googleapis\.com|gstatic\.com|microsoft\.com|live\.com|apple\.com)$/.test(d),
  };
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(from, to) + ';globalThis.__load = packagedGrabberDomainsFrom;', sandbox, { filename: 'background.js:packaged-grabbers' });
  const real = sandbox.__load(JSON.parse(fs.readFileSync(path.join(ROOT, 'rules.json'), 'utf8')));
  realLoggers = real;
  check('the real ruleset yields the loggers', real.has('grabify.link') && real.has('grabify.org') && real.size >= 100, real.size);
  for (const never of ['google.com', 'googleapis.com', 'accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com']) {
    check('and never ' + never, !real.has(never), 'an allow rule names it');
  }
  const built = sandbox.__load([
    { action: { type: 'allow' }, condition: { requestDomains: ['allowed.example'], resourceTypes: ['main_frame', 'script'] } },
    { action: { type: 'block' }, condition: { requestDomains: ['pathonly.example'], urlFilter: '/track', resourceTypes: ['main_frame'] } },
    { action: { type: 'block' }, condition: { requestDomains: ['assets.example'], resourceTypes: ['script', 'image'] } },
    { action: { type: 'block' }, condition: { requestDomains: ['logger.example', 'www.logger2.example'], resourceTypes: ['main_frame', 'sub_frame'] } },
    { action: { type: 'block' }, condition: { requestDomains: ['google.com'], resourceTypes: ['main_frame'] } },
  ]);
  check('only a rule that blocks a whole domain outright names a logger',
    built.has('logger.example') && built.has('www.logger2.example') && built.size === 2, Array.from(built).join(','));
  check('a never-block domain is refused even from a block rule', !built.has('google.com'));
}

/* ---- what warns, and what must not ---------------------------------------- */
{
  const score = makeScorer({ brand: (h) => (/paypa1/.test(h) ? { brand: 'PayPal', matched: h } : null) });
  const r = score('paypa1-secure.example', CTX);
  check('a brand look-alike warns', r && r.level === 'warn', JSON.stringify(r));
  check('and names the brand it is imitating', r && /PayPal/.test(r.label));
  check('it is a warning, not a malicious verdict', r && r.level !== 'malicious',
    'a name that resembles a brand is evidence, not proof');
}
{
  const r = makeScorer({})('xn--80ak6aa92e.example', CTX);
  check('punycode warns', r && r.level === 'warn', JSON.stringify(r));
}
{
  const r = makeScorer({})('203.0.113.9', CTX);
  check('a bare IP address warns', r && r.level === 'warn', JSON.stringify(r));
}
{
  const score = makeScorer({});
  const learned = { 'shady.example': { reason: 'suspicious behavior', userBlocked: false } };
  const r = score('shady.example', Object.assign({}, CTX, { learned }));
  check("WardenOne's own past block warns", r && r.level === 'warn', JSON.stringify(r));
  const mine = { 'ex.example': { reason: 'blocked by you', userBlocked: true } };
  const own = score('ex.example', Object.assign({}, CTX, { learned: mine }));
  check('but the reader\'s own block is not presented as a WardenOne verdict', own === null,
    'crediting their decision to the extension is the bug history.js already fixed once');
}
{
  const score = makeScorer({});
  const fresh = { 'new.example': { ageDays: 3 } };
  const r = score('new.example', Object.assign({}, CTX, { ages: fresh }));
  check('a domain the cache already knows is new warns', r && r.level === 'warn', JSON.stringify(r));
  const old = { 'old.example': { ageDays: 4000 } };
  check('an established domain does not', score('old.example', Object.assign({}, CTX, { ages: old })) === null);
  check('and a domain with no cached age is simply not mentioned',
    score('unknown.example', CTX) === null,
    'the alternative is asking a registry about every result, which is the thing being avoided');
}
check('a stale cached age is discarded rather than reported',
  /now - hit\.cachedAt\) < DOMAIN_AGE_CACHE_MS/.test(BG),
  '"registered 3 days ago" off a year-old entry is simply false');
{
  const allow = Object.assign({}, CTX, { allowlist: ['evil.example'] });
  const r = makeScorer({ security: ['evil.example'] })('evil.example', allow);
  check('an allowlisted site is never warned about', r === null,
    'the reader has already answered this question');
}
{
  /* Order matters: one verdict per result, and it has to be the worst one. */
  const score = makeScorer({
    security: ['both.example'],
    brand: () => ({ brand: 'PayPal', matched: 'both.example' }),
  });
  const r = score('both.example', CTX);
  check('the worst verdict wins when several apply', r && r.level === 'malicious',
    JSON.stringify(r));
}

/* ---- 4. it marks, it does not hide ---------------------------------------- */
check('the warning pass never sets display:none or removes a result',
  !/wo-risk[^;]*display:none/.test(SCRIPT) && !/riskBlock\.remove\(\)/.test(SCRIPT));
check('and does not dim the result the way a scraper result is dimmed',
  !/\[' \+ WARN_ATTR \+ '[^']*opacity/.test(SCRIPT),
  'a warning has to stay readable to be acted on');
check('the line is an attribute the stylesheet reads back as text, never markup',
  /setAttribute\(WARN_LABEL_ATTR, label\)/.test(SCRIPT) && /content:attr\(' \+ WARN_LABEL_ATTR \+ '\)/.test(SCRIPT)
  && !/innerHTML/.test(codeOnly(SCRIPT)),
  'these strings come from feed data; a node inside the result is also what Bing sweeps out');
check('a host with no verdict is remembered as answered -- once the answer was a complete one',
  /if \(Object\.prototype\.hasOwnProperty\.call\(got, key\)\) verdicts\[key\] = got\[key\];\s*else if \(!partial\) verdicts\[key\] = null;/.test(SCRIPT),
  'otherwise every rescan re-asks about every clean host on the page');
check('and a null verdict is never rendered',
  /\} else if \(verdicts\[clean\]\) \{/.test(SCRIPT));
check('the link walk is bounded apart from either pass',
  /j < links\.length && looked < MAX_SCAN_LINKS/.test(SCRIPT) && /looked = scanRoot\(roots\[r\], pending, looked\)/.test(SCRIPT),
  'bounding it on the scraper counter meant a page full of scraper results silenced '
  + 'every warning below them -- and missing warnings read as an all-clear');
check('the warning pass has its own runaway guard',
  /warned < MAX_MARKS/.test(SCRIPT) && /warned\+\+/.test(SCRIPT));

/* ---- 5. the page side, driven against real result shapes ------------------ */
/* Every shape below was read off the live engine on 2026-09-12. Two of them are the
   bugs that made the whole feature look absent: DuckDuckGo renders an empty
   [data-testid="mainline"] BEFORE the one its results live in, and querySelector took the
   first; Bing hands out results through /ck/a?u=a1<base64> so every anchor's host was
   bing.com, and it sweeps foreign nodes out of a result item, so a line placed inside one
   vanished within seconds. */
/* What the worker answers. grabify.link is on the packaged IP-logger ruleset, which the
   page also holds (from storage) and names itself; feedhit.example stands for a host only
   the downloaded feeds know, so its line can only come from the worker. */
const LOGGER = 'IP logger — opening it reveals your address';
const BAD = {
  'grabify.link': { level: 'malicious', label: LOGGER, detail: 'grabify.link' },
  'feedhit.example': { level: 'malicious', label: 'On a malware and scam blocklist', detail: 'feedhit.example' },
};
function runPage(url, bodyChildren, options) {
  const o = options || {};
  const document = makeDocument(url, bodyChildren);
  const timers = [];
  const sent = [];
  const observers = [];
  const late = [];
  /* The worker registers search-loggers.js in front of the script while the warning pass
     is on; here that is a global the sandbox does or does not carry (warnOff leaves it out). */
  const sandbox = {
    document, location: new URL(url), URL, atob: (v) => Buffer.from(v, 'base64').toString('binary'),
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    AbortController, Object, Array, String, RegExp, Promise, JSON, Math, Number, Set, Map, Date, console,
    chrome: { runtime: { lastError: null, getURL: (p) => 'chrome-extension://wo/' + p,
      sendMessage(msg, cb) {
        sent.push(msg);
        if (msg.kind === 'content-config-get') {
          const answer = () => cb({ ok: true, overrides: Object.assign({ enabled: true, warnSearchResults: true, flagSearchJunk: false }, o.config || {}) });
          if (o.lateSnapshot) late.push(answer); else answer();
          return;
        }
        if (msg.kind === 'search-result-check') {
          if (o.silentWorker) return;
          if (o.notReady) { const partial = {}; msg.hosts.forEach((host) => { if (o.partial && o.partial[host]) partial[host] = o.partial[host]; }); cb({ ok: true, ready: false, verdicts: partial }); return; }
          const verdicts = {};
          msg.hosts.forEach((host) => { if ((o.bad || BAD)[host]) verdicts[host] = (o.bad || BAD)[host]; });
          cb({ ok: true, ready: true, verdicts });
          return;
        }
        cb(undefined);
      } } },
    fetch: () => Promise.reject(new Error('no network in this harness')),
  };
  sandbox.window = sandbox; sandbox.top = sandbox; sandbox.self = sandbox;
  if (!o.warnOff) sandbox.WO_SEARCH_LOGGERS = o.loggers || ['grabify.link', 'iplogger.example'];
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: 'search-junk.js' });
  const flush = (n) => { for (let i = 0; i < (n || 20) && timers.length; i++) { const t = timers.shift(); t.fn(); } };
  if (o.autoFlush !== false) flush();
  const marked = () => document.querySelectorAll('[data-wo-risk]');
  return { document, sent, flush, timers, observers, marked, o,
    deliverSnapshot: () => { while (late.length) late.shift()(); },
    asked: () => sent.filter((m) => m.kind === 'search-result-check').map((m) => m.hosts) };
}
const result = (href, title) => h('article', { 'data-testid': 'result' }, [h('h2', [h('a', { href }, [title || href])])]);
const ddgModern = (items) => [
  h('div', { 'data-testid': 'mainline' }),
  h('section', { 'data-testid': 'mainline' }, [h('ol', { class: 'react-results--main' }, items.map((it) => h('li', { 'data-layout': 'organic' }, [it])))]),
];
{
  const page = runPage('https://duckduckgo.com/?q=grabify&ia=web', ddgModern([result('https://grabify.link/', 'Grabify'), result('https://feedhit.example/', 'Feed hit'), result('https://example.org/', 'Example')]));
  const marks = page.marked();
  const label = (m) => (m && m.getAttribute('data-wo-risk-label')) || '';
  check('DuckDuckGo: the results container that holds the results is the one scanned, not the empty one before it',
    marks.length === 2 && marks.every((m) => m.tagName === 'ARTICLE'), marks.map((m) => m.outerTag).join(','));
  check('the block carries the level and the line', marks[0] && marks[0].getAttribute('data-wo-risk') === 'malicious'
    && /^\u26D4\uFE0F IP logger \u2014 opening it reveals your address \u00B7 grabify\.link$/.test(label(marks[0]))
    && /^\u26D4\uFE0F On a malware and scam blocklist \u00B7 feedhit\.example$/.test(label(marks[1])),
    label(marks[0]) + ' | ' + label(marks[1]));
  check('the line is drawn by the stylesheet, not placed inside the result', !page.document.querySelector('.wo-risk-tag')
    && /::before\{content:attr\(data-wo-risk-label\)/.test(page.document.head.textContent));
  check('the clean result beside them is untouched', !page.document.querySelectorAll('article')[2].hasAttribute('data-wo-risk'));
  check('each host is asked about once, and the logger the page named itself is not asked about at all',
    page.asked().length === 1 && page.asked()[0].join(',') === 'feedhit.example,example.org', JSON.stringify(page.asked()));
}
{
  const wrapped = 'https://www.bing.com/ck/a?!&&p=abc&u=a1' + Buffer.from('https://grabify.link/').toString('base64').replace(/=+$/, '') + '&ntb=1';
  const page = runPage('https://www.bing.com/search?q=grabify', [h('ol', { id: 'b_results' }, [
    h('li', { class: 'b_algo' }, [h('h2', [h('a', { href: wrapped }, ['Grabify'])])]),
    h('li', { class: 'b_algo' }, [h('h2', [h('a', { href: 'https://www.bing.com/ck/a?!&&p=def&u=a1' + Buffer.from('https://example.org/').toString('base64') }, ['Example'])])]),
  ])]);
  check('Bing: the destination is read out of the /ck/a redirect, so the result is the site it lands on',
    page.marked().length === 1 && page.marked()[0].tagName === 'LI' && /grabify\.link/.test(page.marked()[0].getAttribute('data-wo-risk-label')),
    page.marked().map((m) => m.getAttribute('data-wo-risk-label')).join(','));
  check('and bing.com itself was never asked about', page.asked().every((hosts) => !hosts.includes('bing.com')), JSON.stringify(page.asked()));
}
{
  const page = runPage('https://www.google.com/search?q=grabify', [h('div', { id: 'search' }, [h('div', { id: 'rso' }, [
    h('div', { class: 'MjjYud' }, [h('div', { 'data-hveid': 'CAgQAA' }, [h('div', { class: 'g' }, [h('a', { href: 'https://grabify.link/' }, [h('h3', ['Grabify'])])])])]),
    h('div', { class: 'MjjYud' }, [h('div', { 'data-hveid': 'CAkQAA' }, [h('div', { class: 'g' }, [h('a', { href: '/url?q=https://grabify.link/login&sa=U' }, [h('h3', ['Grabify login'])])])])]),
    h('div', { class: 'MjjYud' }, [h('div', { 'data-hveid': 'CAoQAA' }, [h('div', { class: 'g' }, [h('a', { href: 'https://example.org/' }, [h('h3', ['Example'])])])])]),
  ])])]);
  check('Google: a direct result and a /url?q= result are both marked, the clean one is not',
    page.marked().length === 2 && page.marked().every((m) => /grabify\.link/.test(m.getAttribute('data-wo-risk-label'))), page.marked().length);
}
{
  /* The engine's own links -- its tabs, "people also search for", the video carousel -- are
     not results. Google's tabs were labelled IP loggers on the live page, through the
     packaged-ruleset slip above; even with that fixed, the engine is never asked about. */
  const nav = (href, text) => h('div', { 'data-hveid': 'nav-' + text }, [h('a', { href }, [h('h3', [text])])]);
  const page = runPage('https://www.google.com/search?q=grabify', [h('div', { id: 'search' }, [h('div', { id: 'rso' }, [
    nav('https://www.google.com/search?q=grabify&udm=2', 'Images'),
    nav('https://support.google.com/websearch', 'Help'),
    h('div', { 'data-hveid': 'r1' }, [h('a', { href: 'https://grabify.link/' }, [h('h3', ['Grabify'])])]),
  ])])], { bad: { 'google.com': { level: 'malicious', label: 'a verdict the worker must never be asked for', detail: 'google.com' }, 'grabify.link': BAD['grabify.link'] } });
  check('the engine itself is never asked about, so it can never be marked',
    page.asked().every((hosts) => !hosts.some((x) => /google\.com$/.test(x))) && page.marked().length === 1 && /grabify/.test(page.marked()[0].getAttribute('data-wo-risk-label')),
    JSON.stringify(page.asked()) + ' ' + page.marked().length);
  const ddg = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://duckduckgo.com/settings', 'Settings'), result('https://grabify.link/', 'Grabify')]));
  check('and the same on an engine with no www', ddg.asked().every((hosts) => !hosts.includes('duckduckgo.com')) && ddg.marked().length === 1, JSON.stringify(ddg.asked()));
}
{
  /* A Google result with sitelinks: a block per sitelink, each with its own data-hveid,
     nested inside the result's block. Read off the live page on 2026-09-12, where the
     first result carried two lines. */
  const sitelink = (href, text) => h('div', { 'data-hveid': 'inner-' + text }, [h('div', { class: 'usJj9c' }, [h('h3', [h('a', { href }, [text])])])]);
  const outerFirst = h('div', { id: 'search' }, [h('div', { id: 'rso' }, [h('div', { class: 'MjjYud' }, [h('div', { 'data-hveid': 'outer', class: 'Ww4FFb' }, [
    h('div', { class: 'tF2Cxc' }, [h('a', { href: 'https://grabify.link/' }, [h('h3', ['Grabify'])])]),
    h('table', [h('tr', [h('td', [sitelink('https://grabify.link/ip-grabber/', 'IP grabber')]), h('td', [sitelink('https://grabify.link/ip-lookup/', 'IP lookup')])])]),
  ])])])]);
  const page = runPage('https://www.google.com/search?q=grabify', [outerFirst]);
  check('a result with sitelinks carries one line, on the result, not one per sitelink',
    page.marked().length === 1 && page.marked()[0].getAttribute('data-hveid') === 'outer', page.marked().map((m) => m.getAttribute('data-hveid')).join(','));
  const innerFirst = h('div', { id: 'search' }, [h('div', { id: 'rso' }, [h('div', { class: 'MjjYud' }, [h('div', { 'data-hveid': 'outer', class: 'Ww4FFb' }, [
    h('table', [h('tr', [h('td', [sitelink('https://grabify.link/ip-grabber/', 'IP grabber')])])]),
    h('div', { class: 'tF2Cxc' }, [h('a', { href: 'https://grabify.link/' }, [h('h3', ['Grabify'])])]),
  ])])])]);
  const late = runPage('https://www.google.com/search?q=grabify', [innerFirst]);
  check('and the same when the sitelink comes before the result\'s own link: the outer block takes over',
    late.marked().length === 1 && late.marked()[0].getAttribute('data-hveid') === 'outer' && !late.document.querySelector('[data-hveid="inner-IP grabber"]').hasAttribute('data-wo-risk-label'),
    late.marked().map((m) => m.getAttribute('data-hveid')).join(','));
}
{
  const page = runPage('https://html.duckduckgo.com/html/?q=grabify', [h('div', { id: 'links', class: 'results' }, [
    h('div', { class: 'result results_links' }, [h('h2', { class: 'result__title' }, [h('a', { class: 'result__a', href: '//duckduckgo.com/l/?uddg=https%3A%2F%2Fgrabify.link%2F&rut=abc' }, ['Grabify'])])]),
  ])]);
  check('DuckDuckGo HTML: the /l/?uddg= redirect is unwrapped', page.marked().length === 1 && /grabify\.link/.test(page.marked()[0].getAttribute('data-wo-risk-label')));
}
{
  const page = runPage('https://uk.search.yahoo.com/search?p=grabify', [h('div', { id: 'web' }, [h('ol', [
    h('li', [h('div', { class: 'algo' }, [h('h3', [h('a', { href: 'https://r.search.yahoo.com/_ylt=A0;_ylu=Y29s/RV=2/RE=1/RO=10/RU=https%3a%2f%2fgrabify.link%2f/RK=2/RS=abc-' }, ['Grabify'])])])]),
  ])])]);
  check('Yahoo: the RU= redirect is unwrapped', page.marked().length === 1 && /grabify\.link/.test(page.marked()[0].getAttribute('data-wo-risk-label')));
}
{
  /* A worker woken from idle answers at once with what it has -- here, one feed hit it
     already holds -- and says the feed lists are not all in yet. That part is drawn now;
     the hosts it had nothing against are asked about again, and only then recorded as
     clean. Neither host is on the page's own list, so every line here is the worker's. */
  const slow = { 'slow.example': { level: 'malicious', label: 'On a malware and scam blocklist', detail: 'slow.example' } };
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://feedhit.example/', 'Feed hit'), result('https://slow.example/', 'Slow')]), { notReady: true, partial: { 'feedhit.example': BAD['feedhit.example'] }, autoFlush: false });
  check('what the worker already knows is drawn on the first answer, before the lists are in',
    page.marked().length === 1 && /feedhit/.test(page.marked()[0].getAttribute('data-wo-risk-label')), page.marked().length);
  check('and it is drawn on the answer itself, with no timer in between', page.timers.every((t) => t.ms === 2500), JSON.stringify(page.timers.map((t) => t.ms)));
  check('the host it had nothing against yet is not taken as clean: one retry is queued', page.timers.length === 1 && page.timers[0].ms === 2500);
  page.flush(1);
  check('the retry asks only about what was left open', page.asked().length === 2 && page.asked()[1].join(',') === 'slow.example', JSON.stringify(page.asked()));
  page.o.notReady = false;
  page.o.bad = Object.assign({}, BAD, slow);
  page.flush();
  check('and the feed verdict is drawn once the worker is ready', page.marked().length === 2, page.marked().length);
  const capped = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://slow.example/', 'Slow')]), { notReady: true });
  check('the retries are capped', capped.asked().length === 13 && capped.timers.length === 0, capped.asked().length);
}
{
  /* With the pass off the worker registers the script without search-loggers.js (or not at
     all, when the scraper pass is off too); the page takes the list's absence as the answer. */
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify'), result('https://feedhit.example/', 'Feed hit')]), { warnOff: true, config: { warnSearchResults: false } });
  check('with the toggle off nothing is asked and nothing is marked', page.asked().length === 0 && page.marked().length === 0);
  check('the worker registers the list only while the pass is on',
    /const files = warn \? \['search-loggers\.js', 'search-junk\.js'\] : \['search-junk\.js'\];/.test(BG) && /js: files,/.test(BG)
    && /const warn = merged\.warnSearchResults !== false;/.test(BG));
  check('and a registration made before the toggle moved is updated in place, not left standing',
    /updateContentScripts\(\[\{ id: SEARCH_JUNK_SCRIPT_ID, js: files \}\]\)/.test(BG) && /haveFiles\.join\(','\) !== files\.join\(','\)/.test(BG));
}
{
  /* The wait the reader felt, taken apart: the switches used to come from the worker (a
     wake-up round trip before anything), and the answer sat behind a 300 ms debounce. */
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { autoFlush: false, lateSnapshot: true });
  check('a known logger is named before the worker has said anything at all, and before any timer',
    page.marked().length === 1 && page.asked().length === 0 && page.timers.length === 0, page.marked().length + ' ' + JSON.stringify(page.timers.map((t) => t.ms)));
  check('the switches are not read from storage, and the worker is not waited on for them',
    !/chrome\.storage/.test(SCRIPT) && /doWarn = typeof WO_SEARCH_LOGGERS !== 'undefined' && Array\.isArray\(WO_SEARCH_LOGGERS\);/.test(SCRIPT),
    'a content script is kept out of the store, and asking the worker meant waking it');
  const junk = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { config: { flagSearchJunk: true } });
  check('the scraper pass still asks the worker for its lists, after the warning pass has begun',
    junk.sent.some((m) => m.kind === 'content-config-get') && junk.marked().length === 1, JSON.stringify(junk.sent.map((m) => m.kind)));
  check('the rescan debounce is short', /var RESCAN_DEBOUNCE_MS = 80;/.test(SCRIPT), 'a 300 ms debounce was most of the wait');
  check('the domain-age cache is read at most once a minute, not once per search',
    /const ages = await searchResultAges\(\);/.test(BG) && /SEARCH_AGES_TTL_MS = 60000/.test(BG));
}
{
  /* The snapshot is the one reading of the allowlist, and it arrives after the first lines
     are drawn. It can only turn the pass off: a paused engine gets its lines taken back,
     and nothing drawn after. The same when the toggle went off after the registration
     was made (a stale registration; the worker updates it in place, but a page open at
     that moment has the old one). */
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { autoFlush: false, lateSnapshot: true, config: { allowlist: ['duckduckgo.com'] } });
  check('a paused engine: the line drawn before the snapshot is taken back', page.marked().length === 1 && (page.deliverSnapshot(), page.marked().length === 0));
  page.document.querySelector('ol').appendChild(h('li', { 'data-layout': 'organic' }, [result('https://iplogger.example/', 'Logger')]));
  page.observers.forEach((ob) => ob.fn()); page.flush();
  check('and nothing is drawn after it', page.marked().length === 0 && page.asked().length === 0, page.marked().length);
  const stale = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { lateSnapshot: true, config: { warnSearchResults: false } });
  check('a stale registration: the snapshot says the pass is off and the line comes back off', stale.marked().length === 1 && (stale.deliverSnapshot(), stale.marked().length === 0));
  const paused = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { lateSnapshot: true, config: { enabled: false } });
  check('and the same when WardenOne is paused altogether', paused.marked().length === 1 && (paused.deliverSnapshot(), paused.marked().length === 0));
  const on = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { warnOff: true, lateSnapshot: true, config: { warnSearchResults: true } });
  check('the snapshot never turns the pass on', (on.deliverSnapshot(), on.marked().length === 0 && on.asked().length === 0));
}
{
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('javascript:void(0)', 'js'), result('mailto:x@example.org', 'mail'), result('https://example.org/', 'Example')]));
  check('only web addresses are asked about', page.asked().length === 1 && page.asked()[0].join(',') === 'example.org', JSON.stringify(page.asked()));
}

/* ---- wiring --------------------------------------------------------------- */
check('it rides the existing search-cleanup script, not a new one',
  /: \['search-junk\.js'\];/.test(BG) && !/search-guard\.js/.test(BG),
  'a second content script would mean a second copy of the engine table; search-loggers.js is a list, not a script');
check('either toggle is enough to register the script',
  /merged\.flagSearchJunk === true \|\| merged\.warnSearchResults !== false/.test(BG));
check('the script runs each pass only if its own toggle is on',
  /if \(off \|\| cfg\.flagSearchJunk !== true\) return;\s*doJunk = true;/.test(SCRIPT)
  && /doWarn = typeof WO_SEARCH_LOGGERS !== 'undefined'/.test(SCRIPT)
  && /if \(doWarn && \(off \|\| cfg\.warnSearchResults === false\)\) \{ doWarn = false; clearMarks\(\); \}/.test(SCRIPT));
check('an empty scraper list no longer ends the script',
  /if \(!Object\.keys\(hosts\)\.length\) \{ doJunk = false; return; \}/.test(SCRIPT) && /if \(doWarn\) \{\s*addPackagedLoggers\(WO_SEARCH_LOGGERS\);\s*begin\(\);/.test(SCRIPT),
  'the warning pass does not use that list and must still run');
check('the toggle drives the registration key',
  /cfg\.warnSearchResults !== false \? 1 : 0/.test(BG),
  'without this the switch does nothing until something unrelated also changes');
check('it defaults ON in background', /warnSearchResults: true/.test(BG));
check('it defaults ON in the popup', /warnSearchResults: true/.test(POPUP_JS));
check('the popup exposes the toggle', /data-key="warnSearchResults"/.test(POPUP_HTML));
check('it counts as a protection', /'warnSearchResults'/.test(BG.match(/const HEALTH_SHIELD_KEYS = \[[\s\S]*?\];/)[0]));
check('the popup copy states the never-safe rule',
  /never marks anything safe/i.test(POPUP_HTML),
  'the promise is the feature; it belongs where the switch is');
check('the popup copy points at Check this link for the remote answer',
  /Check this link/.test(POPUP_HTML));

/* ---- 6. the page carries the packaged logger list itself -------------------- */
/* Waking the worker took ~800 ms measured; a logger link is the one result nobody should
   wait to be told about. A content script cannot fetch the packaged ruleset in MV3, and it
   is kept out of extension storage; so the list is generated into search-loggers.js and
   registered in front of the script, and the page reads it from there. */
{
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify'), result('https://www.google.com/', 'Google'), result('https://example.org/', 'Example')]), { silentWorker: true, autoFlush: false });
  check('a packaged logger is marked with no worker answering at all, before any timer', page.marked().length === 1 && /grabify\.link/.test(page.marked()[0].getAttribute('data-wo-risk-label')), page.marked().length);
  check('and it carries the same words the worker would use', page.marked()[0] && /IP logger — opening it reveals your address/.test(page.marked()[0].getAttribute('data-wo-risk-label')));
  check('a host outside the list is not marked by the page', !page.document.querySelectorAll('article')[1].hasAttribute('data-wo-risk'));
  check('the worker is asked about the rest, and not about the logger', page.asked().length === 1 && page.asked()[0].join(',') === 'google.com,example.org', JSON.stringify(page.asked()));
}
{
  const page = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://sub.iplogger.example/x', 'Logger')]), { silentWorker: true, autoFlush: false });
  check('a subdomain of a packaged logger counts', page.marked().length === 1);
  const none = runPage('https://duckduckgo.com/?q=grabify', ddgModern([result('https://grabify.link/', 'Grabify')]), { silentWorker: true, loggers: [], autoFlush: false });
  check('with an empty list the page marks nothing on its own and asks', none.marked().length === 0 && none.asked().length === 1);
}
check('the page never fetches the ruleset itself', !/rules\.json/.test(SCRIPT), 'a content script cannot read a packaged file in MV3; the fetch silently never landed');
check('and never touches extension storage', !/chrome\.storage/.test(SCRIPT), 'pages get a bounded snapshot from the worker, never the store');
check('the worker leaves no copy of the list in storage either', !/wardenone_packaged_loggers/.test(BG));
{
  /* The shipped file is the worker's own reading of the ruleset, and the generator says so. */
  const gen = require('./build-search-loggers');
  const shipped = fs.readFileSync(path.join(ROOT, 'search-loggers.js'), 'utf8');
  const listed = (() => { const s = { }; vm.createContext(s); vm.runInContext(shipped + ';globalThis.__l = WO_SEARCH_LOGGERS;', s); return s.__l; })();
  check('search-loggers.js is what the generator makes of rules.json', shipped === gen.currentText(), 'run node tools/build-search-loggers.js');
  check('and it lists what the worker reads out of the same file', Array.isArray(listed) && listed.join(',') === Array.from(realLoggers).sort().join(','), listed.length + ' vs ' + realLoggers.size);
  check('it is a plain list and nothing else', /^var WO_SEARCH_LOGGERS = \[\n(  '[a-z0-9.-]+',\n)+\];\n$/.test(shipped.slice(shipped.indexOf('var WO_SEARCH_LOGGERS'))));
  check('the gate keeps it current', /build-search-loggers\.js', '--check'/.test(fs.readFileSync(path.join(ROOT, 'tools', 'check-maintainability.js'), 'utf8')));
}
check('the two labels are one string',
  (SCRIPT.match(/var LOGGER_LABEL = '([^']+)'/) || [])[1] === (BG.match(/label: '(IP logger[^']+)'/) || [])[1]
  && (SCRIPT.match(/var LOGGER_LABEL = '([^']+)'/) || [])[1] === 'IP logger \\u2014 opening it reveals your address',
  'the page says it first and the worker confirms it; a different wording would flicker');

if (failed) {
  console.error('search-result warnings: ' + failed + ' failed');
  process.exit(1);
}
console.log('search-result warnings: all checks passed');

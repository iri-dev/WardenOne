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

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'search-junk.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let failed = 0;
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
  const handler = BG.slice(handlerAt, handlerAt + 1400);
  check('the handler does not reach the network either',
    !/fetch\(|lookupDomainAge|urlReputationLookup/.test(handler));
  check('the handler is restricted to the search engines it runs on',
    /SEARCH_WARN_ENGINE_HOST\.test/.test(handler),
    'anywhere else this answers "is my domain on your blocklist yet" for anyone who asks');
  check('and only for a tab, never an extension page',
    /messageSenderIsTab\(sender\)/.test(BG.slice(handlerAt - 120, handlerAt + 200)));
  check('the batch is capped', /SEARCH_WARN_MAX_HOSTS/.test(BG));

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
check('the strip is built with textContent, never innerHTML',
  /text\.textContent = String\(verdict\.label/.test(SCRIPT) && !/innerHTML/.test(codeOnly(SCRIPT)),
  'these strings come from feed data; innerHTML would let a listed domain put markup on '
  + 'a Google results page');
check('a host with no verdict is remembered as answered',
  /verdicts\[key\] = Object\.prototype\.hasOwnProperty\.call\(got, key\) \? got\[key\] : null/.test(SCRIPT),
  'otherwise every rescan re-asks about every clean host on the page');
check('and a null verdict is never rendered',
  /\} else if \(verdicts\[clean\]\) \{/.test(SCRIPT));
check('the link walk is bounded apart from either pass',
  /j < links\.length && j < MAX_SCAN_LINKS/.test(SCRIPT),
  'bounding it on the scraper counter meant a page full of scraper results silenced '
  + 'every warning below them -- and missing warnings read as an all-clear');
check('the warning pass has its own runaway guard',
  /warned < MAX_MARKS/.test(SCRIPT) && /warned\+\+/.test(SCRIPT));

/* ---- wiring --------------------------------------------------------------- */
check('it rides the existing search-cleanup script, not a new one',
  /js: \['search-junk\.js'\]/.test(BG) && !/search-guard\.js/.test(BG),
  'a second content script would mean a second copy of the engine table');
check('either toggle is enough to register the script',
  /merged\.flagSearchJunk === true \|\| merged\.warnSearchResults !== false/.test(BG));
check('the script runs each pass only if its own toggle is on',
  /doJunk = cfg\.flagSearchJunk === true/.test(SCRIPT)
  && /doWarn = cfg\.warnSearchResults !== false/.test(SCRIPT));
check('an empty scraper list no longer ends the script',
  /if \(!Object\.keys\(hosts\)\.length\) doJunk = false;/.test(SCRIPT),
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

if (failed) {
  console.error('search-result warnings: ' + failed + ' failed');
  process.exit(1);
}
console.log('search-result warnings: all checks passed');

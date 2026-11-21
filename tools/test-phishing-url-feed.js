#!/usr/bin/env node
'use strict';

/* Address-level phishing checks on page visits: OpenPhish keys that never widen a listed address to its
   whole path, OpenPhish retention after an address rotates out of the public feed, malware-filter's
   address list for pages on shared hosts, and destinations of known link redirectors. */

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
  failures.push(name + (detail ? ' (' + detail + ')' : ''));
}
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
function constLine(name) {
  const m = new RegExp('^const ' + name + ' = [^\\n]+$', 'm').exec(BG);
  assert(m, 'missing ' + name);
  return m[0];
}
function constBlock(name, open, close) {
  const i = BG.indexOf('const ' + name + ' = ');
  assert(i >= 0, 'missing ' + name);
  const at = BG.indexOf(open, i);
  return BG.slice(i, at) + balanced(BG, at, open, close) + ';';
}

const NEVER_BLOCK = new Set(['facebook.com', 'google.com', 'microsoft.com', 'office.com', 'booking.com', 'zoom.us', 'bsky.app']);
const code = [
  constLine('OPENPHISH_MAX_URLS'), constLine('OPENPHISH_RETAIN_MS'), constLine('PHISHING_URL_FEED_MAX_ENTRIES'),
  constLine('PHISHING_URL_FEED_PROVIDER'), constLine('PHISHING_URL_FEED_TTL_MS'), constLine('PHISHING_URL_FEED_STALE_TTL_MS'),
  'const LIST_PARSE_SLICE_LINES = 4000;',
  constBlock('PATH_TENANT_HOSTS', '(', ')'), constLine('PATH_TENANT_HOST_RE'), grabFn('isPathTenantHost'),
  grabFn('normalizeSafeBrowsingUrl'), grabFn('isTrustedPolicyReputationUrl'),
  grabFn('phishUrlKeyParts'), grabFn('phishUrlEntryKeys'), grabFn('phishUrlLookupKeys'),
  grabFn('buildOpenPhishFeed'), grabFn('mergeOpenPhishUrls'),
  grabFn('phishingUrlFeedEntry'), grabFn('buildPhishingUrlIndex'), grabFn('parsePhishingUrlFeed'), grabFn('phishingUrlIndexHas'),
  constBlock('LINK_REDIRECTORS', '[', ']'), grabFn('linkRedirectTarget'), grabFn('localPhishingUrlVerdict'),
].join('\n');

function sandbox(overrides) {
  const ctx = Object.assign({
    URL, Set, Map, Promise, setTimeout, Number, String, Array, Object, Date, Math, decodeURIComponent,
    isLocalOrPrivateHost: (h) => /^(?:localhost|127\.|10\.|192\.168\.)/.test(h),
    wardenOneIsPublicSuffix: (h) => ['com', 'co.uk', 'pages.dev', 'netlify.app'].includes(h),
    isNeverBlockDomain: (h) => NEVER_BLOCK.has(String(h).replace(/^www\./, '').split('.').slice(-2).join('.')),
    trustHostFromUrl: (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } },
    isLocalTrustHost: (h) => /^(?:localhost|127\.)/.test(h),
    locallyBlockedReputationHost: async () => '',
    getPhishingUrlIndex: async () => null,
    getOpenPhishFeed: async () => ({ ok: false }),
  }, overrides || {});
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'phishing-url-slice.js' });
  return ctx;
}

(async () => {
  const s = sandbox();

  /* 1. A listed address with a query never widens to its bare path. */
  {
    const listed = 'https://accounts.google.com/ServiceLogin?continue=https://sites.google.com/view/phish';
    const feed = s.buildOpenPhishFeed([listed], Date.now(), false);
    const hit = (u) => s.phishUrlLookupKeys(u).some((k) => feed.keys[k]);
    check('listed address with query matches itself', hit(listed));
    check('Google sign-in without that query is not matched', !hit('https://accounts.google.com/ServiceLogin?service=mail'));
    check('bare Google sign-in path is not matched', !hit('https://accounts.google.com/ServiceLogin'));
    const forms = s.buildOpenPhishFeed(['https://forms.office.com/Pages/ResponsePage.aspx?id=PHISH1'], Date.now(), false);
    check('other Microsoft Forms are not matched', !s.phishUrlLookupKeys('https://forms.office.com/Pages/ResponsePage.aspx?id=REAL2').some((k) => forms.keys[k]));
  }
  /* 2. A listed address without a query matches the page with tracking added, and slash variants. */
  {
    const feed = s.buildOpenPhishFeed(['https://evil-login.pages.dev/verify', 'http://www.kit.example.org/a/'], Date.now(), false);
    const hit = (u) => s.phishUrlLookupKeys(u).some((k) => feed.keys[k]);
    check('query added by the kit still matches', hit('https://evil-login.pages.dev/verify?id=42'));
    check('trailing slash variant matches', hit('https://evil-login.pages.dev/verify/'));
    check('other paths on the tenant are not matched', !hit('https://evil-login.pages.dev/verify2') && !hit('https://evil-login.pages.dev/'));
    check('www and scheme do not matter', hit('https://kit.example.org/a') && hit('http://www.kit.example.org/a/?x=1'));
  }
  /* 3. Retention after an address rotates out of the public feed. */
  {
    const now = 1e12;
    const day = 864e5;
    const previous = { cachedAt: now - day, urls: ['https://b.example.net/x', 'https://c.example.net/y', 'https://a.example.net/z'],
      seenAt: [now - 3 * day, now - 8 * day, now - day] };
    const merged = s.mergeOpenPhishUrls(['https://a.example.net/z', 'https://d.example.net/w'], previous, now);
    check('fresh addresses come first', merged.urls[0] === 'https://a.example.net/z' && merged.urls[1] === 'https://d.example.net/w');
    check('recently listed address is kept', merged.urls.includes('https://b.example.net/x'));
    check('address last listed 8 days ago is dropped', !merged.urls.includes('https://c.example.net/y'));
    check('an address listed again is fresh', merged.seenAt[0] === now);
    check('kept address keeps its last listing time', merged.seenAt[merged.urls.indexOf('https://b.example.net/x')] === now - 3 * day);
    const legacy = s.mergeOpenPhishUrls([], { cachedAt: now - 2 * day, urls: ['https://e.example.net/q'] }, now);
    check('older cache without times uses its fetch time', legacy.urls.length === 1 && legacy.seenAt[0] === now - 2 * day);
    const many = s.mergeOpenPhishUrls(Array.from({ length: 30000 }, (_, i) => 'https://f' + i + '.example.net/p'), null, now);
    check('retention respects the cap', many.urls.length === 25000);
    const feed = s.buildOpenPhishFeed(merged.urls, now, false, merged.seenAt);
    check('built feed keeps times aligned', feed.seenAt.length === feed.urls.length && feed.seenAt[0] === now);
  }
  /* 4. Which list lines become page keys. */
  {
    const e = (l) => s.phishingUrlFeedEntry(l);
    check('B2 file path kept', e('||f006.backblazeb2.com/file/idioxt/index.html^$all') === '//f006.backblazeb2.com/file/idioxt/index.html');
    check('QR short link kept', e('||qrco.de/bfQv1c^$all') === '//qrco.de/bfQv1c');
    check('Google Sites page kept', e('||sites.google.com/view/viewbill-bt-1/bt^$all') === '//sites.google.com/view/viewbill-bt-1/bt');
    check('form response keeps its query and real ampersands', e('||forms.office.com/Pages/ResponsePage.aspx?id=X1&amp;r=2^$all') === '//forms.office.com/Pages/ResponsePage.aspx?id=X1&r=2');
    check('host only lines are left to the host lists', e('0-1-x.16215785.xyz') === '' && e('||phish.example.org^') === '' && e('||phish.example.org/^$all') === '');
    check('wildcards skipped', e('||moviesboys.com/*.shtml$doc') === '');
    check('short bare path on a big site skipped', e('||www.facebook.com/login.php^$all') === '' && e('||account.booking.com/sign-in^$all') === '');
    check('deeper path on a big site kept', e('||docs.zoom.us/doc/abc123^$all') === '//docs.zoom.us/doc/abc123');
    check('query on a big site kept', e('||account.booking.com/sign-in?op_token=abc^$all') === '//account.booking.com/sign-in?op_token=abc');
    check('credentials, ports, private hosts and suffixes skipped',
      e('||user:pw@x.example.org/a^') === '' && e('||x.example.org:8080/a^') === '' && e('||127.0.0.1/a^') === '' && e('||pages.dev/a^') === '');
    check('a dollar sign inside the path stays', e('||google.com//amp/a/x.com/.Mtree34$/EMAIL^$all').indexOf('$/EMAIL') > 0);
    check('comments and cosmetic lines skipped', e('! Title: Phishing URL Blocklist') === '' && e('example.org##.ad') === '');
  }
  /* 5. The index matches the listed page only. */
  {
    const text = ['! Title: Phishing URL Blocklist', '0-1-x.16215785.xyz', '||qrco.de/bfQv1c^$all',
      '||forms.office.com/Pages/ResponsePage.aspx?id=PHISH^$all', '||sites.google.com/view/billpay/^$all',
      '||go.bsky.app/redirect?u=https://roaring-dieffenbachia-e5b3cf.netlify.app/careers^$all',
      '||f006.backblazeb2.com/file/idioxt/index.html^$all', '||qrco.de/bfQv1c^$all'].join('\n');
    const entries = await s.parsePhishingUrlFeed(text);
    check('parser keeps five distinct page keys', entries.length === 5, entries.length);
    const index = s.buildPhishingUrlIndex(entries, Date.now());
    const has = (u) => s.phishingUrlIndexHas(index, u);
    check('listed QR link blocked', has('https://qrco.de/bfQv1c'));
    check('other QR links untouched', !has('https://qrco.de/bfQv1cX') && !has('https://qrco.de/') && !has('https://qrco.de/other'));
    check('listed form blocked, other forms untouched', has('https://forms.office.com/Pages/ResponsePage.aspx?id=PHISH')
      && !has('https://forms.office.com/Pages/ResponsePage.aspx?id=REAL') && !has('https://forms.office.com/Pages/ResponsePage.aspx'));
    check('Google Sites page blocked with or without its slash', has('https://sites.google.com/view/billpay') && has('https://sites.google.com/view/billpay/'));
    check('other Google Sites untouched', !has('https://sites.google.com/view/billpay2') && !has('https://sites.google.com/view/'));
    check('PhishTank style redirector entry matched exactly', has('https://go.bsky.app/redirect?u=https://roaring-dieffenbachia-e5b3cf.netlify.app/careers'));
    check('B2 path from the 1v1 blocked', has('https://f006.backblazeb2.com/file/idioxt/index.html'));
    check('other B2 files untouched', !has('https://f006.backblazeb2.com/file/idioxt/report.pdf') && !has('https://f006.backblazeb2.com/file/other/index.html'));
    const big = Array.from({ length: 70000 }, (_, i) => '||q-r.to/x' + i + '^$all').join('\n');
    check('parser stops at the entry cap', (await s.parsePhishingUrlFeed(big)).length === 60000);
  }
  /* 6. Redirector destinations. */
  {
    const t = (u) => s.linkRedirectTarget(u);
    check('bsky redirect target', t('https://go.bsky.app/redirect?u=https://roaring-dieffenbachia-e5b3cf.netlify.app/careers') === 'https://roaring-dieffenbachia-e5b3cf.netlify.app/careers');
    check('encoded target', t('https://go.bsky.app/redirect?u=https%3A%2F%2Fevil.example.org%2Fa%3Fb%3D1') === 'https://evil.example.org/a?b=1');
    check('facebook link shim', t('https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example.org%2F&h=AT0') === 'https://evil.example.org/');
    check('google url and country domain', t('https://www.google.com/url?q=https://evil.example.org/x&sa=D') === 'https://evil.example.org/x'
      && t('https://www.google.co.uk/url?url=https://evil.example.org/y') === 'https://evil.example.org/y');
    check('youtube and steam', t('https://www.youtube.com/redirect?q=https://evil.example.org/z&v=1') === 'https://evil.example.org/z'
      && t('https://steamcommunity.com/linkfilter/?url=https://evil.example.org/s') === 'https://evil.example.org/s');
    check('outlook safe links', t('https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fevil.example.org%2Fo&data=1') === 'https://evil.example.org/o');
    check('search pages are not redirectors', t('https://www.google.com/search?q=https://evil.example.org/') === '');
    check('other bsky paths are not redirectors', t('https://go.bsky.app/profile?u=https://evil.example.org/') === '');
    check('look-alike hosts are not redirectors', t('https://evil-google.com/url?q=https://evil.example.org/') === ''
      && t('https://www.google.com.evil.net/url?q=https://evil.example.org/') === '' && t('https://xgo.bsky.app/redirect?u=https://e.example.org/') === '');
    check('non web targets ignored', t('https://go.bsky.app/redirect?u=javascript:alert(1)') === '' && t('https://go.bsky.app/redirect?u=data:text/html,x') === '');
    check('same host target ignored', t('https://www.google.com/url?q=https://www.google.com/maps') === '');
    check('relative target ignored', t('https://go.bsky.app/redirect?u=/settings') === '');
  }
  /* 7. The combined local verdict. */
  {
    const entries = await s.parsePhishingUrlFeed('! Title: x\n||qrco.de/bfQv1c^$all\n||sites.google.com/view/billpay^$all');
    const index = s.buildPhishingUrlIndex(entries, Date.now());
    const op = s.buildOpenPhishFeed(['https://kit.example.net/login'], Date.now(), false);
    const v = sandbox({
      getPhishingUrlIndex: async (cfg) => (cfg && cfg.blockMalwareSites !== false ? index : null),
      getOpenPhishFeed: async () => ({ ok: true, feed: op }),
      locallyBlockedReputationHost: async (h) => (h === 'listed-host.example.org' ? 'security' : ''),
    });
    const cfg = { enabled: true, blockMalwareSites: true, openPhish: true };
    let r = await v.localPhishingUrlVerdict('https://qrco.de/bfQv1c', cfg);
    check('page in the address list names the list', r && r.provider === 'malware-filter phishing list' && r.blockUrl === 'https://qrco.de/bfQv1c' && !r.viaRedirect);
    r = await v.localPhishingUrlVerdict('https://l.facebook.com/l.php?u=' + encodeURIComponent('https://sites.google.com/view/billpay'), cfg);
    check('redirector to a listed page blocks at the destination', r && r.viaRedirect && r.blockUrl === 'https://sites.google.com/view/billpay');
    r = await v.localPhishingUrlVerdict('https://go.bsky.app/redirect?u=https://listed-host.example.org/x', cfg);
    check('redirector to a listed host uses the local list', r && r.provider === 'WardenOne local malware and scam list' && r.blockUrl === 'https://listed-host.example.org/x');
    r = await v.localPhishingUrlVerdict('https://www.google.com/url?q=https://kit.example.net/login', cfg);
    check('redirector to an OpenPhish page names OpenPhish', r && r.provider === 'OpenPhish' && r.viaRedirect);
    r = await v.localPhishingUrlVerdict('https://qrco.de/bfQv1c', { enabled: true, blockMalwareSites: false, openPhish: false });
    check('address list follows its switch', r === null);
    r = await v.localPhishingUrlVerdict('https://www.google.com/url?q=https://example.org/fine', cfg);
    check('clean destination passes', r === null);
    r = await v.localPhishingUrlVerdict('https://qrco.de/bfQv1c', { enabled: false, blockMalwareSites: true, openPhish: true });
    check('master switch off stops OpenPhish lookups', !r || r.provider !== 'OpenPhish');
  }
  /* 8. Wiring in the page visit check. */
  {
    const fn = grabFn('handleSafeBrowsingNavigation');
    const userAt = fn.indexOf("if (local === 'user') return;");
    const localAt = fn.indexOf('localPhishingUrlVerdict(url, state.cfg)');
    const providersAt = fn.indexOf('urlReputationLookupUrl(url');
    check('own block list still wins first', userAt > 0 && userAt < localAt);
    check('local address check runs before provider lookups', localAt > 0 && localAt < providersAt);
    check('provider gate kept for provider lookups', /if \(!verdict\) \{\s*if \(!state\.enabled\) return;/.test(fn));
    check('block page and history use the destination', /safeBrowsingBlockPageUrl\(\{ url: blockUrl/.test(fn) && /matched: blockUrl/.test(fn));
    check('OpenPhish lookups use lookup keys', /phishUrlLookupKeys\(normalized\)/.test(grabFn('openPhishLookupUrl')));
    check('OpenPhish entries use entry keys', /phishUrlEntryKeys\(normalized\)/.test(grabFn('buildOpenPhishFeed')));
    check('the old widening helper is gone', !/function openPhishUrlKeys\(/.test(BG));
    check('feed cache key is in the storage policy', /'wardenone_phishing_url_feed'/.test(BG.slice(BG.indexOf('const PRIVACY_STORE_POLICY = '))));
    check('lookups never wait on the network', !/await refreshPhishingUrlFeed/.test(grabFn('getPhishingUrlIndex')));
  }

  if (failures.length) {
    for (const f of failures) console.error('  FAIL ' + f);
    console.error(failures.length + ' of ' + (pass + failures.length) + ' phishing address checks failed');
    process.exit(1);
  }
  console.log('[ok] phishing address checks passed (' + pass + ')');
})().catch((err) => { console.error(err); process.exit(1); });

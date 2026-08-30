/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Clearing cookies after a banner the user had to accept.
 *
 * Auto-reject handles a banner that offers a way to say no. This is for the ones
 * that do not: the user clicks Accept to reach the page, and the cookies that
 * bought them entry stay behind. When the last tab for that site goes, so do they.
 *
 * This is the only feature in the extension that deletes the user's data, so the
 * checks below are mostly about when it must NOT run, and about the one thing it
 * must never take with it: the sign-in.
 *
 * Run: node tools/test-clear-on-leave.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const CONSENT = fs.readFileSync(path.join(ROOT, 'consent-reject.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');

/* Sliced from the real classifier, not a copy of it: the whole safety claim is
   that this uses the same rules as the manual cleaner. */
const START = 'const SESSION_COOKIE_HINT';
const END = 'async function cleanConsentAndTrackingCookies() {';
const from = BG.indexOf(START);
const to = BG.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the clear-on-leave block moved in background.js');
const SLICE = BG.slice(from, to);

let passed = 0;
let failed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

function world(options) {
  const o = options || {};
  const history = [];
  const removed = [];
  const sandbox = {
    DEFAULT_CONFIG: { enabled: true, clearCookiesOnLeave: false },
    localGet: () => Promise.resolve({ wardenone_config: o.config || {} }),
    registrableDomainBg: (h) => String(h || '').replace(/^www\./, '').split('.').slice(-2).join('.'),
    queueHistory: (e) => history.push(e),
    LAST_TOP_URL: o.tabUrls || {},
    CONSENT_COOKIE_EXACT: new Set(['euconsent-v2', 'cookieconsent_status']),
    TRACKING_COOKIE_EXACT: new Set(['_ga', '_fbp']),
    CONSENT_COOKIE_PREFIX: ['cookie_notice'],
    TRACKING_COOKIE_PREFIX: ['_gid', '_hj'],
    chrome: {
      tabs: { query: () => Promise.resolve(o.openTabs || []) },
      cookies: {
        getAll: () => Promise.resolve(o.cookies || []),
        remove: (spec) => { removed.push(spec.name); return Promise.resolve(); },
      },
    },
    URL, Set, Object, Date, String, Number, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(SLICE + '\nglobalThis.__api = { CONSENT_ACCEPTED_AT, maybeClearOnLeave, noteConsentAccepted, cookieIsDisposable };',
    sandbox, { filename: 'clear-on-leave.js' });
  return { history, removed, api: sandbox.__api };
}

const ON = { enabled: true, clearCookiesOnLeave: true };
const COOKIES = [
  { name: '_ga', domain: '.shop.example', secure: true, path: '/' },
  { name: 'euconsent-v2', domain: '.shop.example', secure: true, path: '/' },
  { name: 'sessionid', domain: '.shop.example', secure: true, path: '/' },
  { name: 'auth_token', domain: '.shop.example', secure: true, path: '/' },
  { name: 'cart_contents', domain: '.shop.example', secure: true, path: '/' },
];

async function main() {
  {
    const w = world({ config: ON, cookies: COOKIES });
    w.api.noteConsentAccepted(1, 'https://shop.example/checkout');
    await w.api.maybeClearOnLeave('shop.example');
    check('the consent and tracking cookies go', w.removed.includes('_ga') && w.removed.includes('euconsent-v2'), w.removed);
    check('the sign-in stays', !w.removed.includes('sessionid') && !w.removed.includes('auth_token'), w.removed);
    check('and anything it does not recognise is left alone',
      !w.removed.includes('cart_contents'),
      'only names on the consent/tracking lists are touched, never the whole domain');
    check('it is recorded', w.history.length === 1 && w.history[0].type === 'cleaned_site_cookies', w.history);
    check('the record says the sign-in was spared',
      /sign-in was left alone/i.test(w.history[0].detail.why), w.history[0].detail);
  }

  {
    const w = world({ config: ON, cookies: COOKIES });
    await w.api.maybeClearOnLeave('shop.example');
    check('a site you never accepted on is untouched', w.removed.length === 0, w.removed);
    check('and nothing is recorded for it', w.history.length === 0);
  }

  {
    const w = world({ config: { enabled: true, clearCookiesOnLeave: false }, cookies: COOKIES });
    w.api.noteConsentAccepted(1, 'https://shop.example/');
    await w.api.maybeClearOnLeave('shop.example');
    check('it does nothing while switched off', w.removed.length === 0, w.removed);
  }

  {
    const w = world({ config: { enabled: false, clearCookiesOnLeave: true }, cookies: COOKIES });
    w.api.noteConsentAccepted(1, 'https://shop.example/');
    await w.api.maybeClearOnLeave('shop.example');
    check('the master switch turns it off too', w.removed.length === 0, w.removed);
  }

  {
    const w = world({
      config: ON, cookies: COOKIES,
      openTabs: [{ url: 'https://shop.example/other' }],
    });
    w.api.noteConsentAccepted(1, 'https://shop.example/');
    await w.api.maybeClearOnLeave('shop.example');
    check('a site still open in another tab is not cleared',
      w.removed.length === 0, 'closing one tab is not leaving the site');
  }

  {
    const w = world({
      config: ON, cookies: COOKIES,
      openTabs: [{ url: 'https://unrelated.example/' }],
    });
    w.api.noteConsentAccepted(1, 'https://shop.example/');
    await w.api.maybeClearOnLeave('shop.example');
    check('an unrelated open tab does not keep it alive', w.removed.length > 0, w.removed);
  }

  {
    const w = world({ config: ON, cookies: COOKIES });
    w.api.noteConsentAccepted(1, 'https://shop.example/');
    await w.api.maybeClearOnLeave('shop.example');
    const first = w.removed.length;
    await w.api.maybeClearOnLeave('shop.example');
    check('leaving twice does not clear twice', w.removed.length === first, w.removed.length);
  }

  {
    const w = world({ config: ON, cookies: [] });
    w.api.noteConsentAccepted(1, 'https://shop.example/');
    await w.api.maybeClearOnLeave('shop.example');
    check('nothing to clear means nothing is recorded', w.history.length === 0);
  }

  {
    const w = world({ config: ON, cookies: COOKIES });
    w.api.noteConsentAccepted(1, 'not a url');
    await w.api.maybeClearOnLeave('shop.example');
    check('an unparseable page does not mark anything', w.removed.length === 0, w.removed);
  }

  // -------------------------------------------------------------------------
  {
    check('only a real click counts as consent',
      /event\.isTrusted !== true\) return;/.test(CONSENT),
      'a synthetic click is the page consenting on its own behalf, which is not consent');
    check('and only inside an actual consent banner',
      /consentBannerAncestor\(el\)\) return;/.test(CONSENT));
    check('a reject-shaped label is never mistaken for acceptance',
      /REJECT_RE\.test\(label\)\) return;/.test(CONSENT),
      '"Save without accepting" contains the word accept');
    check('it reports once per page, not once per click',
      /acceptReported/.test(CONSENT));

    check('it is off by default in the worker',
      (BG.match(/clearCookiesOnLeave: false/g) || []).length === 2,
      'clearing data nobody asked to lose is not a default');
    check('and off by default in the popup', /clearCookiesOnLeave: false/.test(POPUP_JS));
    check('the popup can turn it on',
      /data-key="clearCookiesOnLeave"/.test(POPUP_HTML) && /'clearCookiesOnLeave'/.test(POPUP_JS));
    check('the row says sign-ins are left alone',
      /Sign-ins are left alone/i.test(POPUP_HTML),
      'the first question anyone asks is whether this logs them out');
    check('Activity Center names it', /cleaned_site_cookies: '/.test(HISTORY));
    check('it never clears a whole domain',
      !/cookies\.remove[\s\S]{0,200}?forEach\(all\)/.test(BG) && /cookieIsDisposable\(cookie\)\) continue;/.test(BG),
      'every removal goes through the same classifier the manual cleaner uses');
  }

  // -------------------------------------------------------------------------
  // The tracking IDs a site keeps in localStorage
  // -------------------------------------------------------------------------
  /* This is where the tracking went once third-party cookies started dying -- and
     it is also where most sites keep the session token, so getting it wrong logs
     the user out of everything they visited. The rule is vendor namespaces only,
     with two vetoes that override even a vendor match. */
  const lsSrc = CONSENT.slice(CONSENT.indexOf('const LS_VENDOR_PREFIX'), CONSENT.indexOf('function clearTrackingStorage'));
  const isTrackingKey = vm.runInNewContext(lsSrc + ';trackingStorageKey', { String });

  const KEYS = [
    ['_ga', 'GA1.2.1234567890.1680000000', true, 'a Google Analytics client id'],
    ['_ga_XY12ZQ', 'GS1.1.1680000000', true, 'a GA4 container id'],
    ['__utmz', 'x', true, 'legacy Google Analytics'],
    ['_hjSessionUser_12345', '{"id":"abc"}', true, 'Hotjar, which reads like a session but is analytics'],
    ['_uetsid', 'abc123', true, 'Microsoft UET, which contains "sid"'],
    ['_clck', 'abc', true, 'Microsoft Clarity'],
    ['ajs_user_id', 'u_991', true, 'a Segment identity'],
    ['amp_1a2b3c', 'deviceId', true, 'Amplitude'],
    ['mp_abc_mixpanel', '{}', true, 'Mixpanel'],
    ['OptanonConsent', 'groups=C0001', true, 'a OneTrust consent record'],
    ['euconsent-v2', 'CPXyz', true, 'an IAB consent string'],

    ['sessionToken', 'abc123', false, 'a login token'],
    ['auth', 'xyz', false, 'a credential'],
    ['access_token', 'xyz', false, 'an access token'],
    ['user_preferences', '{"theme":"dark"}', false, 'app settings'],
    ['cart', '[{"id":1}]', false, 'a shopping cart'],
    ['draft_post', 'my unsent essay', false, 'unsaved work'],
    ['analytics_opt_out', 'true', false, 'a name that merely sounds tracker-ish'],
    ['tracking_id', 'abc', false, 'so does this one'],
  ];
  for (const [key, value, want, why] of KEYS) {
    check((want ? 'storage: clears ' : 'storage: keeps  ') + why,
      isTrackingKey(key, value) === want, key);
  }

  /* The two vetoes. Both apply to keys that DID match a vendor namespace, which is
     the only reason they are worth having. */
  check('storage: a JWT value is a credential whatever the key is called',
    isTrackingKey('_ga', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk') === false,
    'a vendor prefix must not be enough to delete something shaped like a token');
  check('storage: a kilobyte-plus value is application state, not an id',
    isTrackingKey('_hjBig', 'x'.repeat(2000)) === false);
  check('storage: an empty key is never touched', isTrackingKey('', 'x') === false);

  check('storage: the list is vendor namespaces, not a pattern',
    /LS_VENDOR_PREFIX = \[/.test(CONSENT) && !/\/(?:track|analytic)/i.test(
      CONSENT.slice(CONSENT.indexOf('const LS_VENDOR_PREFIX'), CONSENT.indexOf('const LS_JWT_RE'))),
    'a pattern like /track|analytics/ would eventually eat somebody app state');
  check('storage: it only runs where the user accepted',
    /if \(storageCleared \|\| !acceptReported\) return;/.test(CONSENT));
  check('storage: and only with the switch on',
    /config\.clearCookiesOnLeave !== true\) return 0;/.test(CONSENT));
  check('storage: the number of keys removed is capped',
    /doomed\.length < LS_MAX_KEYS/.test(CONSENT));
  check('storage: it never wipes the store wholesale',
    !/localStorage\.clear\(\)/.test(CONSENT),
    'clear() is what the browsingData API would do, and it takes the login with it');
  check('storage: Activity Center names it', /cleaned_site_storage: '/.test(HISTORY));

  if (failed) { console.error('\n' + failed + ' clear-on-leave check(s) failed'); process.exit(1); }
  console.log('\n' + passed + ' clear-on-leave checks passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });

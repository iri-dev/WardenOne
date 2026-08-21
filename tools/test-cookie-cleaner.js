/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Can the consent-cookie sweep sign anyone out?
 *
 * "Accept all" leaves a cookie on every site that asked, and the ad networks leave several more.
 * Clearing cookies wholesale removes them -- and every session cookie with them, so tidying up
 * costs you every login you had. The sweep exists to remove the first kind and not the second.
 *
 * That promise is only as good as the classifier, so this suite attacks it from the side that
 * matters. Two properties, and they are not equally important:
 *
 *   1. It removes the consent and tracking cookies it claims to. Nice to have.
 *   2. It NEVER removes anything that could be holding a session. Non-negotiable -- a miss here
 *      logs a real person out of their bank while they were trying to clean up trackers.
 *
 * The classifier is built as an allowlist of names to delete precisely so that an unknown cookie
 * is kept by default. The keep-list below is therefore the half worth staring at.
 *
 * Run: node tools/test-cookie-cleaner.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Lift the classifier and the tables it reads, so this tests the shipped decision rather than a
// description of it.
const from = BG.indexOf('const CONSENT_COOKIE_EXACT');
const to = BG.indexOf('// Rebuild the URL a cookie was set for');
if (from < 0 || to <= from) throw new Error('cookie classifier not found in background.js');

const sandbox = { console, Set, RegExp, String, Object, Array };
vm.createContext(sandbox);
vm.runInContext(BG.slice(from, to) + '\nglobalThis.__disposable = cookieIsDisposable;', sandbox);
const disposable = (name, domain, opts) => sandbox.__disposable(
  Object.assign({ name, domain: domain || 'example.com' }, opts || {}));

// Anti-vacuity: if the classifier said "no" to everything, every keep assertion below would pass
// while the feature did nothing at all.
check('the classifier can say yes to something', disposable('_ga', 'example.com') === true,
  'nothing would ever be removed');

// ---------------------------------------------------------------------------
// 1. THE ONE THAT MATTERS. None of these may ever be removed.
// ---------------------------------------------------------------------------
{
  const KEEP = [
    ['sessionid', 'bank.example'],
    ['SESSION', 'shop.example'],
    ['PHPSESSID', 'forum.example'],
    ['JSESSIONID', 'work.example'],
    ['connect.sid', 'app.example'],
    ['auth_token', 'mail.example'],
    ['access_token', 'api.example'],
    ['refresh_token', 'api.example'],
    ['jwt', 'app.example'],
    ['remember_me', 'shop.example'],
    ['csrftoken', 'bank.example'],
    ['XSRF-TOKEN', 'app.example'],
    ['user_session', 'github.com'],
    ['SID', 'google.com'],
    ['SAPISID', 'google.com'],
    ['__Secure-1PSID', 'google.com'],
    ['li_at', 'linkedin.com'],
    ['c_user', 'facebook.com'],
    ['xs', 'facebook.com'],
    ['sessionKey', 'example.com'],
    ['cart', 'shop.example'],
    ['basket_id', 'shop.example'],
    ['theme', 'blog.example'],
    ['lang', 'blog.example'],
    ['currency', 'shop.example'],
    // A cookie nobody has ever heard of. The default must be to keep it.
    ['some_unknown_thing_2026', 'random.example'],
    ['wp-settings-1', 'blog.example'],
    ['_shopify_y', 'shop.example'],
  ];
  for (const [name, domain] of KEEP) {
    check('kept: ' + name + ' on ' + domain, disposable(name, domain) === false,
      'this would have signed someone out or lost their state');
  }
}

// ---------------------------------------------------------------------------
// 2. The consent banners, which is what the user actually asked to be rid of.
// ---------------------------------------------------------------------------
{
  const CONSENT = [
    ['euconsent-v2', 'news.example'],
    ['OptanonConsent', 'shop.example'],
    ['OptanonAlertBoxClosed', 'shop.example'],
    ['CookieConsent', 'blog.example'],
    ['cookielawinfo-checkbox-necessary', 'wp.example'],
    ['cmplz_consented_services', 'wp.example'],
    ['didomi_token', 'news.example'],
    ['CybotCookiebotDialogConsent', 'news.example'],
    ['_iub_cs-12345', 'shop.example'],
    ['viewed_cookie_policy', 'wp.example'],
    ['borlabs-cookie', 'de.example'],
    ['notice_gdpr_prefs', 'news.example'],
    ['usprivacy', 'news.example'],
  ];
  for (const [name, domain] of CONSENT) {
    check('removed: ' + name, disposable(name, domain) === true);
  }
}

// ---------------------------------------------------------------------------
// 3. The trackers riding along with them.
// ---------------------------------------------------------------------------
{
  const TRACKERS = [
    ['_ga', 'shop.example'], ['_ga_ABC123', 'shop.example'], ['_gid', 'shop.example'],
    ['_fbp', 'shop.example'], ['_gcl_au', 'shop.example'], ['__hstc', 'shop.example'],
    ['_hjSessionUser_123', 'shop.example'], ['_clck', 'shop.example'], ['_uetsid', 'shop.example'],
    ['mp_abc_mixpanel', 'app.example'], ['_pk_id.1.abc', 'site.example'],
    ['IDE', 'doubleclick.net'], ['test_cookie', 'doubleclick.net'], ['MUID', 'bing.com'],
    ['personalization_id', 'twitter.com'], ['_rdt_uuid', 'reddit.com'],
  ];
  for (const [name, domain] of TRACKERS) {
    check('removed: ' + name + ' on ' + domain, disposable(name, domain) === true);
  }
}

// ---------------------------------------------------------------------------
// 4. Generic names are only disposable on hosts whose business is tracking.
//    `uid` on an adtech host is a tracker; `uid` on a shop is probably your account.
// ---------------------------------------------------------------------------
{
  check('uid on an adtech host is removed', disposable('uid', 'adnxs.net') === true);
  check('uid on an ordinary site is kept', disposable('uid', 'shop.example') === false,
    'a generic name was removed off a site the user may have an account with');
  check('c on an adtech host is removed', disposable('c', 'crwdcntrl.net') === true);
  check('c on an ordinary site is kept', disposable('c', 'blog.example') === false);
  check('consent on an ordinary site is kept', disposable('consent', 'shop.example') === false);
}

// ---------------------------------------------------------------------------
// 5. The belt-and-braces guard: a session-shaped name is refused even if it matched.
// ---------------------------------------------------------------------------
{
  check('a session-shaped name is refused outright', disposable('_ga_session_token', 'x.example') === false);
  check('an auth-shaped name is refused outright', disposable('consent_auth_token', 'x.example') === false);
}

if (failed) { console.error('\n' + failed + ' cookie-cleaner check(s) failed'); process.exit(1); }
console.log('\nthe sweep removes consent and tracking cookies and cannot sign anyone out');

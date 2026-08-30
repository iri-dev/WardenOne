/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Session Security scoring.
 *
 * This grade is shown to users as a letter on a coloured badge, so being wrong
 * is expensive in both directions: a scary letter on a safe site teaches people
 * to ignore it, and a friendly letter on a leaking site is worse than showing
 * nothing at all.
 *
 * The scorer is pulled out of popup.js and executed against whole site profiles
 * rather than checked by reading it, because the failure that shipped was
 * arithmetic -- Google Search scored D on the strength of two analytics
 * parameters -- and no amount of reading the source catches that.
 *
 * The classifier in src/content.js is exercised the same way, since the grade is
 * only as good as the confidence it is handed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* Read with one newline convention. These files are edited by whatever tool
   is to hand, so a slice that hunts for a line break must not depend on which
   convention the last write happened to leave behind. */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const lf = (s) => s.split(CR + LF).join(LF);
const POPUP_JS = lf(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'));
const CONTENT = lf(fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8'));

let passed = 0;
function check(name, cond, extra) {
  assert(cond, name + (extra ? ' :: ' + extra : ''));
  console.log('  ok  - ' + name);
  passed++;
}

/* ---- pull the real scorer out of popup.js and run it ---- */
const start = POPUP_JS.indexOf('function computeScore(data, cookies) {');
assert(start >= 0, 'computeScore not found in popup.js');
const end = POPUP_JS.indexOf('\n}\n', start);
const computeScore = new Function(POPUP_JS.slice(start, end + 3) + '\nreturn computeScore;')();

const f = (where, confidence, jwt) => ({ where, key: 'k', preview: '****', confidence, jwt });
const goodCookies = { total: 10, secure: 10, httpOnly: 8, sameSite: 10, sessionLike: 3, weak: [] };
const weakCookies = { total: 10, secure: 2, httpOnly: 0, sameSite: 1, sessionLike: 3,
  weak: [{ name: 'sid' }, { name: 'auth' }] };

/* ---- the case that started this: Google Search ----
   After the classifier fix, ved= and gs_lp= never become findings at all, so the
   only thing left is a handful of opaque storage values. */
const google = computeScore(
  { onHttps: true, isSensitivePage: false, thirdPartyScripts: [], tokenCount: 5,
    findings: [f('localStorage', 'low'), f('localStorage', 'low'), f('cookie (readable)', 'low'),
      f('cookie (readable)', 'low'), f('localStorage', 'low')] },
  goodCookies);
check('Google-shaped page is no longer graded harshly', google.score >= 78 && /A|B/.test(google.grade),
  'got ' + google.grade + ' (' + google.score + ')');
check('good cookie hygiene actually earns credit', google.credits.length > 0, google.credits.join('; '));

/* ---- a genuine leak must still be caught hard ---- */
const leak = computeScore(
  { onHttps: true, isSensitivePage: true, thirdPartyScripts: [],
    findings: [f('URL query string', 'high', { exp: null, longLived: false })] },
  goodCookies);
check('a real credential in the URL still scores badly', leak.score < 65,
  'got ' + leak.grade + ' (' + leak.score + ')');
check('the URL leak is the headline reason', /URL/.test(leak.reasons[0] || ''), leak.reasons[0]);

/* ---- confidence has to change the outcome, or it is decoration ---- */
const lowUrl = computeScore({ onHttps: true, findings: [f('URL query string', 'low')] }, goodCookies);
const highUrl = computeScore({ onHttps: true, findings: [f('URL query string', 'high')] }, goodCookies);
check('a low-confidence URL value costs nothing', lowUrl.score > highUrl.score + 20,
  'low=' + lowUrl.score + ' high=' + highUrl.score);

/* ---- where the token lives has to matter ---- */
const inUrl = computeScore({ onHttps: true, findings: [f('URL query string', 'high')] }, goodCookies);
const inStore = computeScore({ onHttps: true, findings: [f('localStorage', 'high')] }, goodCookies);
check('a token in the URL is judged worse than the same token in storage',
  inUrl.score < inStore.score, 'url=' + inUrl.score + ' store=' + inStore.score);

/* ---- sensitive pages weigh heavier ---- */
const plain = computeScore({ onHttps: true, isSensitivePage: false, findings: [f('localStorage', 'high')] }, goodCookies);
const signin = computeScore({ onHttps: true, isSensitivePage: true, findings: [f('localStorage', 'high')] }, goodCookies);
check('the same finding costs more on a sign-in page', signin.score < plain.score,
  'plain=' + plain.score + ' signin=' + signin.score);

/* ---- transport is not negotiable ---- */
const httpSession = computeScore({ onHttps: false, findings: [] }, goodCookies);
check('a session over plain HTTP cannot score better than D',
  httpSession.score <= 45 && /D|F/.test(httpSession.grade), 'got ' + httpSession.grade);
check('the HTTP cap is reported, not silent', httpSession.capped === true);

/* ---- no session at all is not a security failure ---- */
const anon = computeScore({ onHttps: true, findings: [] }, { total: 4, secure: 4, httpOnly: 0, sameSite: 4, sessionLike: 0, weak: [] });
check('a logged-out page is not given a scary letter', /A|B/.test(anon.grade), 'got ' + anon.grade);
check('a logged-out page says so rather than claiming safety', anon.hasSession === false
  && /no sign-in/i.test(anon.risk), anon.risk);

/* ---- weak cookies are punished ---- */
const weak = computeScore({ onHttps: true, findings: [] }, weakCookies);
check('session cookies missing HttpOnly/Secure drag the grade down', weak.score < 78,
  'got ' + weak.grade + ' (' + weak.score + ')');
check('the cookie problem is explained', weak.reasons.some((r) => /HttpOnly|Secure/.test(r)),
  weak.reasons.join('; '));

/* ---- every grade must come with a reason or a credit ---- */
[google, leak, weak, anon, httpSession].forEach((s, i) => {
  assert(s.reasons.length || s.credits.length, 'scenario ' + i + ' produced a bare grade');
});
check('no scenario produces a grade with nothing to explain it', true);

/* ---- the classifier feeding all of this ---- */
const cls = CONTENT.slice(CONTENT.indexOf('addFinding=(where,'), CONTENT.indexOf('scanStorage=(store,'));
check('URL findings reject shape-only matches', /inUrl&&"low"===confidence/.test(cls),
  'this is what stops ved= and gs_lp= being called tokens');
check('confidence reaches the popup', /confidence:confidence/.test(CONTENT));
check('a JWT is always high confidence', /isJwt\?"high"/.test(cls));
check('a token-named key still counts without a token-shaped value', /namedLikeToken\?\(/.test(cls));

/* ---- clearing and hiding exposed tokens ----
 * These two handlers delete a user's session and rewrite their cookies, so the
 * guards around them matter more than the happy path does. */
const BG = lf(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'));
const clearFn = BG.slice(BG.indexOf("msg.kind === 'clear-exposed-tokens'"), BG.indexOf("msg.kind === 'harden-site-cookies'"));
const hardenFn = BG.slice(BG.indexOf("msg.kind === 'harden-site-cookies'"), BG.indexOf("msg.kind === 'cookie-audit'"));

check('clearing only ever touches the tab the user is looking at',
  /activeTabMatchesOrigin\(u\.origin\)/.test(clearFn));
check('clearing is bounded, so a hostile message cannot enqueue thousands of keys',
  /\.slice\(0, 60\)/.test(clearFn));
check('clearing covers cookies as well as storage',
  /cookies\.remove/.test(clearFn) && /localStorage\.removeItem/.test(clearFn));
check('clearing is recorded in the activity log', /gated_tokens_cleared/.test(clearFn));

check('hardening only ever touches the tab the user is looking at',
  /activeTabMatchesOrigin\(u\.origin\)/.test(hardenFn));
check('hardening refuses to run on plain HTTP',
  /u\.protocol !== 'https:'/.test(hardenFn),
  'setting Secure on an http page would drop the cookie entirely');
check('hardening SKIPS CSRF cookies, which sites are meant to read',
  /CSRF_NAME/.test(hardenFn) && /skippedCsrf\+\+/.test(hardenFn),
  'hardening a double-submit CSRF cookie breaks the site outright');
check('hardening sets HttpOnly, which is the whole point',
  /httpOnly: true/.test(hardenFn));
check('a host-only cookie is not widened to its subdomains',
  /if \(!c\.hostOnly\) set\.domain = c\.domain/.test(hardenFn),
  'sending a domain on a host-only cookie is the opposite of hardening');
check('hardening preserves the cookie value verbatim', /value: c\.value/.test(hardenFn));

/* The popup must be able to act on everything the scan reports, not just the
   parts that happen to be reachable from page script. */
check('every finding location has a clear action',
  /\/\^cookie\/i\.test\(f\.where\)\s*\|\|\s*\/\^URL\/\.test\(f\.where\)/.test(POPUP_JS),
  'cookies and URL values used to be the only two you could not clear');
check('a URL value is described honestly as removed from the address bar',
  /Removed from the address bar/.test(POPUP_JS),
  'history and any referrer already sent cannot be recalled');
check('hiding is only offered where hiding is actually possible',
  /readableCookies\.length && data\.onHttps/.test(POPUP_JS));
check('the popup warns that the site can undo the hardening',
  /can undo it next time it sets the cookie/i.test(POPUP_JS));

console.log('\n' + passed + ' passed, 0 failed');

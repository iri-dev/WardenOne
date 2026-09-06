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

/* ---- a missing flag is ONE decision, not one per cookie ----
   The penalty used to be 9 per non-HttpOnly cookie, so a site whose own JS reads
   six session cookies paid 54 (capped 34) for exactly the decision a site with
   one cookie paid 9 for. YouTube came out F / High Risk on that arithmetic, which
   is not a defensible thing to say about the most-visited site on the web: its
   hygiene is mediocre, not dangerous. */
const weakCookie = (httpOnly, secure) => ({ httpOnly, secure });
const oneWeak = computeScore({ onHttps: true, findings: [] },
  { total: 3, sessionLike: 1, sameSite: 3, weak: [weakCookie(false, false)] });
const manyWeak = computeScore({ onHttps: true, findings: [] },
  { total: 9, sessionLike: 7, sameSite: 9, weak: Array.from({ length: 6 }, () => weakCookie(false, false)) });
check('six weak cookies are not charged six times over',
  manyWeak.score === oneWeak.score,
  'one=' + oneWeak.score + ' six=' + manyWeak.score + ' -- the decision is the same one');

const youtubeShaped = computeScore(
  { onHttps: true, findings: Array.from({ length: 5 }, () => f('sessionStorage', 'medium')) },
  { total: 9,
    sessionLike: 7,
    sameSite: 2,
    weak: [weakCookie(true, false), weakCookie(false, false), weakCookie(false, true),
      weakCookie(false, true), weakCookie(false, true), weakCookie(false, false), weakCookie(false, false)] });
check('a big site with script-readable session cookies is not called High Risk',
  youtubeShaped.grade !== 'F' && youtubeShaped.score >= 60,
  'got ' + youtubeShaped.grade + ' (' + youtubeShaped.score + ')');
check('but it is not called clean either',
  youtubeShaped.score < 78 && youtubeShaped.grade !== 'A' && youtubeShaped.grade !== 'B',
  'got ' + youtubeShaped.grade + ' (' + youtubeShaped.score + ')');

/* The recalibration must not let the genuinely bad cases off. */
const httpWeak = computeScore({ onHttps: false, findings: [] },
  { total: 3, sessionLike: 1, sameSite: 3, weak: [weakCookie(false, false)] });
check('a session cookie with no flags over plain HTTP is still F',
  httpWeak.grade === 'F', 'got ' + httpWeak.grade + ' (' + httpWeak.score + ')');
check('one weak cookie is no longer excused for being only one',
  oneWeak.grade !== 'A' && oneWeak.grade !== 'B',
  'got ' + oneWeak.grade + ' (' + oneWeak.score + ') -- it used to earn a B');

/* ---- a C must not be dressed as an emergency ----
   The grade was right about YouTube and the panel around it was not: a red
   Cookie-security row, a red seven-item heading, and a bare 'Medium Risk' with
   nothing saying what was being graded. Every fact stayed; the framing had to
   stop implying the site was unsafe to use. */
/* Copy in popup.js is wrapped across string concatenations, so a sentence
   matched literally fails the moment it crosses a `' + '` seam. Join the seams
   for copy assertions; POPUP_JS stays raw for anything structural. */
const POPUP_COPY = POPUP_JS.split(/'\s*\+\s*'/).join('');
check('the panel says what the letter is about',
  POPUP_JS.includes('not whether the site is safe to use'),
  'a letter with no reference frame reads as a verdict on the site');
/* Matched as literals: these assertions are about source that is itself full of
   regex, and escaping a regex inside a regex is how the last three of these got
   silently mangled into something that matched nothing. */
check('alarm colour is chosen by the grade, not by any finding existing',
  POPUP_JS.includes('const severeColor = /^[DF]$/.test(sc.grade)'),
  'painting every weak cookie danger-red made a C look like an emergency');
check('the cookie row and the heading both use it',
  (POPUP_JS.match(/severeColor/g) || []).length >= 3);
check('the alarming heading wording is gone',
  !POPUP_JS.includes('Session cookies missing protection')
    && POPUP_JS.includes('Flags these session cookies do not set'));
check('proportion is offered on the grades that deserve it',
  POPUP_COPY.includes('not a sign that anything is wrong with this site'));
check('and withheld at D and F, where worry is the right response',
  POPUP_JS.includes('if (!/^[DF]$/.test(sc.grade)) {'),
  'reassurance on a site with a token in the URL would be the harmful direction');
check('no fact was removed to achieve any of that',
  POPUP_JS.includes('not HttpOnly') && POPUP_JS.includes('not Secure')
    && POPUP_JS.includes('w.name'),
  'the cookie names and the missing flags are still listed one by one');
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

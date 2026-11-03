/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Link cleaning on navigation: click and campaign identifiers leave top-level GET page loads before
   the request is sent, signed links are left alone, and page links are never edited. The
   2026-10-30 WardenOne-vs-Privacy-Badger run found every fbclid, gclid and utm_* reaching the
   destination: the click-time cleaner had lost its only caller on 2026-09-27.
   node tools/test-link-clean-navigation.js */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const start = BG.indexOf('// ---- Link cleaning on navigation');
const end = BG.indexOf('let __linkCleanRulesEnabled', start);
if (start < 0 || end < 0) { console.error('[fail] link cleaning code not found in background.js'); process.exit(1); }
const login = /const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = (\[[\s\S]*?\]);/.exec(BG);
const sandbox = { URL, LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: login ? vm.runInNewContext(login[1]) : null };
vm.runInNewContext(BG.slice(start, end) + ';this.api={rules:linkCleanRules,apply:linkCleanApply,params:LINK_CLEAN_PARAMS,signed:LINK_CLEAN_SIGNED_PARAMS,base:LINK_CLEAN_RULE_BASE};', sandbox);
const { rules: makeRules, apply, params, base } = sandbox.api;
const budget = Number((/const LINK_CLEAN_RULES_BUDGET = (\d+);/.exec(BG) || [])[1]);
let failed = 0;
const check = (name, ok, detail) => { if (ok) console.log('  ok  - ' + name); else { failed++; console.log('[fail] ' + name + (detail ? ' -- ' + detail : '')); } };

/* ---- shape --------------------------------------------------------------------------------- */
const rules = makeRules();
const guards = rules.filter(rule => rule.action.type === 'allow');
const redirects = rules.filter(rule => rule.action.type === 'redirect');
const names = rule => /\(\?:([^)]*)\)=\$?$/.exec(rule.condition.regexFilter)[1].split('|').map(name => name.replace(/\\/g, ''));
check('the login-compatibility list was found', Array.isArray(sandbox.LOGIN_COMPAT_NEVER_BLOCK_DOMAINS) && sandbox.LOGIN_COMPAT_NEVER_BLOCK_DOMAINS.length > 0);
check('rules fit the declared budget', Number.isInteger(budget) && rules.length <= budget, rules.length + ' > ' + budget);
check('ids are contiguous from the band base', rules.every((rule, i) => rule.id === base + i));
check('signed-link guards come first, outrank the redirects and are allows',
  guards.length > 0 && rules.slice(0, guards.length).every(rule => rule.action.type === 'allow' && rule.priority === 2)
  && guards.length + redirects.length === rules.length && redirects.every(rule => rule.priority === 1));
check('guards only cover https, so they never outrank Force HTTPS', guards.every(rule => /^\^https:\/\//.test(rule.condition.regexFilter)));
check('guards match case-insensitively (X-Amz-Signature, Signature)', guards.every(rule => rule.condition.isUrlFilterCaseSensitive !== true));
const guarded = guards.flatMap(names);
check('the guard groups cover each signed-link name exactly once',
  JSON.stringify([...guarded].sort()) === JSON.stringify([...sandbox.api.signed].sort()) && new Set(guarded).size === guarded.length);
/* Edge 156 refused one 18-name case-insensitive alternation as over its 2 KB compiled limit. */
check('each guard group stays small enough to compile', guards.every(rule => names(rule).length <= 6 && rule.condition.regexFilter.length < 140));
for (const rule of rules) {
  const c = rule.condition;
  check('rule ' + rule.id + ': top-level GET page loads only', JSON.stringify(c.resourceTypes) === '["main_frame"]' && JSON.stringify(c.requestMethods) === '["get"]');
}
check('redirects match case-sensitively, so only names the transform removes can match',
  redirects.every(rule => rule.condition.isUrlFilterCaseSensitive === true));
check('every redirect removes the whole list',
  redirects.every(rule => JSON.stringify(rule.action.redirect.transform.queryTransform.removeParams) === JSON.stringify([...params])));
check('sign-in and payment hosts are excluded',
  redirects.every(rule => rule.condition.excludedRequestDomains.includes('accounts.google.com')));
const matched = redirects.flatMap(names);
check('the redirect groups cover each name exactly once', JSON.stringify([...matched].sort()) === JSON.stringify([...params].sort()) && new Set(matched).size === matched.length);
check('each group stays small for the browser regex limit', redirects.every(rule => rule.condition.regexFilter.length < 260));

/* ---- every removed name is also on the address-bar cleaner's list ---------------------------- */
const tracking = /const TRACKING_PARAMS=\[([\s\S]*?)\],\s*toURL=/.exec(SRC);
const global = /COPY_CLEAN_GLOBAL=(\/\^\([\s\S]*?\)\$\/i),/.exec(SRC);
const contentRes = [...(tracking ? vm.runInNewContext('[' + tracking[1] + ']') : []), ...(global ? [vm.runInNewContext(global[1])] : [])];
check('the content cleaner lists were found', contentRes.length > 2);
const stray = params.filter(name => !contentRes.some(re => re.test(name)));
check('no name the address-bar cleaner would keep', stray.length === 0, stray.join(', '));

/* ---- behaviour --------------------------------------------------------------------------------- */
const DEST = 'https://www.fixture-destination.com/page/landing?utm_source=news&utm_medium=email&fbclid=FBCLIDFIXTURE&gclid=GCLIDFIXTURE&msclkid=MSCLKFIXTURE&mc_eid=MCEIDFIXTURE&keep=1';
check('the championship link reaches the site with only its own parameter',
  apply(rules, DEST).url === 'https://www.fixture-destination.com/page/landing?keep=1', apply(rules, DEST).url);
check('order and the rest of the address are kept',
  apply(rules, 'https://shop.example/a/b?x=1&fbclid=abc&y=2#top').url === 'https://shop.example/a/b?x=1&y=2#top');
check('an http link is cleaned too', apply(rules, 'http://news.example/?gclid=1&id=4').url === 'http://news.example/?id=4');
for (const [label, url] of [
  ['an S3-signed download', 'https://bucket.s3.amazonaws.com/f.zip?X-Amz-Credential=a&X-Amz-Signature=b&utm_source=mail'],
  ['a token link', 'https://app.example/magic?token=abc&utm_source=email'],
  ['an OAuth callback', 'https://app.example/cb?code=abc&state=xyz&fbclid=1'],
  ['a signed CDN link', 'https://cdn.example/v.mp4?Expires=1&Signature=s&Key-Pair-Id=k&gclid=1'],
]) {
  const out = apply(rules, url);
  check(label + ' is left exactly as written', out.url === url && out.signed === true, out.url);
}
for (const [label, url] of [
  ['no tracking parameters', 'https://example.com/search?q=privacy&page=2'],
  ['a name in a value, not a key', 'https://example.com/?q=fbclid=1'],
  ['a longer name', 'https://example.com/?fbclidx=1&xfbclid=2'],
  ['an upper-case variant the transform would not remove', 'https://example.com/?FBCLID=1'],
  ['an identifier only in the fragment', 'https://example.com/page#fbclid=1'],
]) check(label + ': untouched', apply(rules, url).url === url, apply(rules, url).url);
const LOOPS = [DEST, 'https://e.example/?utm_source=a&utm_campaign=b&_kx=c&hsCtaTracking=d&__hstc=e', 'https://e.example/?fbclid=1&fbclid=2', 'http://e.example/p?yclid=1&_gl=2&fb_source=3'];
check('a cleaned address never matches again (no redirect loop)',
  LOOPS.every(url => { const once = apply(rules, url).url; return once !== url && apply(rules, once).url === once; }));
check('without installed rules nothing is changed', apply([], DEST).url === DEST && apply([], DEST).rules === 0);

/* ---- wiring ------------------------------------------------------------------------------------- */
check('the switch drives the rules', /run\('linkCleaning', \(\) => applyLinkCleaningRules\(on && cfg\.stripTrackingParams !== false\), String\(on && cfg\.stripTrackingParams !== false\)\);/.test(BG));
/* Live Edge showed it: switching cleaning back on alone never reconciled, because the reconcile
   skips a pass whose state key is unchanged. */
const stateKey = BG.slice(BG.indexOf('const stateKey = ['), BG.indexOf('].join', BG.indexOf('const stateKey = [')));
check('changing the switch alone reconciles', /cfg\.stripTrackingParams !== false \? 1 : 0,/.test(stateKey));
check('the band is in the dynamic budget', /TOTAL_DYNAMIC_BUDGET = [^;]*\+ LINK_CLEAN_RULES_BUDGET;/.test(BG));
check('rules are stored, so they cover the first click after a cold start', /async function applyLinkCleaningRules[\s\S]*?writeDynamicRules\(/.test(BG));
check('a browser that rejects any regex installs none (fail open)', /if \(!verdicts\.every\(Boolean\)\)[^\n]*want = \[\];/.test(BG));
check('the network logger names the band and does not count it as a block',
  /\[LINK_CLEAN_RULE_BASE, 'Link cleaning'\]/.test(BG) && /SAFE_SEARCH_RULE_BASE, LINK_CLEAN_RULE_BASE,/.test(BG));
const scrub = SRC.slice(SRC.indexOf('scrubDomLink=el=>{'), SRC.indexOf('sweepDomLinks=root=>{'));
check('page links and forms are still never edited (CHANGELOG 2026-09-27)', scrub.length > 0 && !/setAttribute\("(href|action)"/.test(scrub));

if (failed) { console.error('link cleaning on navigation: ' + failed + ' failed'); process.exit(1); }
console.log('[ok] link cleaning on navigation: identifiers removed before the request leaves, signed links and page links untouched');

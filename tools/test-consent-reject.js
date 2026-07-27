'use strict';

const fs = require('fs');

const src = fs.readFileSync('src/content.js', 'utf8');
const min = fs.readFileSync('content.min.js', 'utf8');
const consent = fs.readFileSync('consent-reject.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok  - ' + name);
    return;
  }
  fail++;
  console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

check('legacy main-world auto-reject block is disabled in source',
  src.includes('if(!1&&WO.autoRejectConsent&&'));
check('legacy main-world auto-reject block is disabled in runtime',
  min.includes('if(!1&&WO.autoRejectConsent&&'));
check('legacy remove-overlays consent click helper no-ops in source',
  src.includes('clickConsentReject=root=>') && src.includes('try{\n          return!1;'));
check('legacy remove-overlays consent click helper no-ops in runtime',
  min.includes('clickConsentReject=root=>{try{return!1;'));

const protectMatch = consent.match(/const PROTECT_RE = ([^\n]+);/);
const protect = protectMatch ? protectMatch[1] : '';
[
  'payment',
  'billing',
  'checkout',
  'card',
  'password',
  'delete',
].forEach((word) => {
  check('consent reject protect regex includes ' + word, protect.toLowerCase().includes(word));
});

const excludeMatch = background.match(/const CONSENT_REJECT_EXCLUDE_MATCHES = \[([\s\S]*?)\];/);
const excludes = excludeMatch ? excludeMatch[1] : '';
[
  'checkout.stripe.com',
  'paypal.com',
  'adyen.com',
  'braintreepayments.com',
  'klarna.com',
  'cash.app',
].forEach((host) => {
  check('consent dynamic exclude list includes ' + host, excludes.includes(host));
});

check('dynamic consent registration uses excludeMatches',
  /excludeMatches: CONSENT_REJECT_EXCLUDE_MATCHES/.test(background));
check('dynamic consent registration persists across sessions',
  /persistAcrossSessions: true/.test(background));

check('consent reject refuses real navigation links',
  /function isUnsafeAutoClickLink/.test(consent)
    && /url\.origin !== location\.origin/.test(consent)
    && /url\.pathname !== location\.pathname/.test(consent)
    && /function clickControl\(el\)[\s\S]*isUnsafeAutoClickLink\(el\)/.test(consent));
check('consent reject treats legal and cookie-choice links as informational',
  /INFO_LINK_RE/.test(consent)
    && /cookie\\s\+choices\?/.test(consent)
    && /privacy\\s\+\(\?:notice\|policy\|choices\?\)/.test(consent)
    && /legal/.test(consent));
check('Twitch consent fast path cannot click navigational legal links',
  /function tryTwitchReject/.test(consent)
    && /\^reject\(\?:\\s\+all\)\?\$/.test(consent)
    && /!isUnsafeAutoClickLink\(el\)/.test(consent));

check('consent reject has an attribute-agnostic banner fallback for obfuscated bars (e.g. X BottomBar)',
  /function tryGenericReject/.test(consent)
    && /function consentBannerAncestor/.test(consent)
    && /if \(tryGenericReject\(\)\) return;/.test(consent));
check('generic reject fallback still requires a safe reject control inside a real consent banner',
  /tryGenericReject[\s\S]*safeRejectCandidate\(el\)[\s\S]*consentBannerAncestor\(el\)/.test(consent)
    && /consentBannerAncestor[\s\S]*hasStrongConsentLanguage\(own\)[\s\S]*PROTECT_RE\.test\(own\)/.test(consent));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

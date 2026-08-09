/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const fs = require('fs');
const vm = require('vm');

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

function runConsentDialog(dialogText, labels) {
  const clicks = [];
  const rect = (width, height) => ({ width, height, top: 40, left: 50, right: 50 + width, bottom: 40 + height });
  let dialog;
  const controls = labels.map((label) => ({
    nodeType: 1,
    tagName: 'BUTTON',
    type: 'button',
    innerText: label,
    textContent: label,
    className: '',
    name: '',
    id: '',
    isConnected: true,
    parentElement: null,
    getAttribute() { return null; },
    hasAttribute() { return false; },
    getBoundingClientRect() { return rect(180, 48); },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    click() { clicks.push(label); },
  }));

  dialog = {
    nodeType: 1,
    tagName: 'DIV',
    innerText: dialogText,
    textContent: dialogText,
    className: 'surface',
    name: '',
    id: '',
    isConnected: true,
    parentElement: null,
    getAttribute(name) { return name === 'role' ? 'dialog' : null; },
    hasAttribute() { return false; },
    getBoundingClientRect() { return rect(820, 650); },
    querySelectorAll(selector) { return String(selector).startsWith('button') ? controls : []; },
  };
  controls.forEach((control) => { control.parentElement = dialog; });

  const body = {
    nodeType: 1,
    tagName: 'BODY',
    innerText: dialogText,
    textContent: dialogText,
    isConnected: true,
    parentElement: null,
    querySelectorAll() { return []; },
    getBoundingClientRect() { return rect(1000, 800); },
    getAttribute() { return null; },
  };
  const html = {
    nodeType: 1,
    tagName: 'HTML',
    innerText: dialogText,
    textContent: dialogText,
    isConnected: true,
    parentElement: null,
    querySelectorAll() { return []; },
    getBoundingClientRect() { return rect(1000, 800); },
    getAttribute() { return null; },
  };
  dialog.parentElement = body;
  body.parentElement = html;

  const document = {
    nodeType: 9,
    documentElement: html,
    body,
    querySelectorAll(selector) {
      const value = String(selector);
      if (value.includes('[role="dialog"]')) return [dialog];
      if (value.startsWith('button')) return controls;
      return [];
    },
    createTreeWalker() { return { nextNode() { return null; } }; },
    addEventListener() {},
  };
  const window = {};
  window.top = window;

  const context = {
    window,
    document,
    location: {
      hostname: 'consent-fixture.invalid',
      pathname: '/prompt',
      href: 'https://consent-fixture.invalid/prompt',
      origin: 'https://consent-fixture.invalid',
    },
    innerWidth: 1000,
    innerHeight: 800,
    URL,
    CSS: { escape(value) { return String(value); } },
    getComputedStyle(el) {
      return {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: el === dialog ? 'fixed' : 'static',
      };
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    chrome: {
      storage: {
        local: { get(_key, done) { done({ wardenone_config: { enabled: true, autoRejectConsent: true } }); } },
        onChanged: { addListener() {} },
      },
      runtime: { sendMessage() {} },
    },
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn, delay) { if (delay === 0) fn(); return 1; },
    setInterval() { return 1; },
    clearInterval() {},
    console,
    Date,
    Set,
    WeakSet,
  };
  vm.runInNewContext(consent, context, { filename: 'consent-reject.js' });
  return clicks;
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
    && /consentBannerAncestor[\s\S]*hasStrongConsentLanguage\(own\)[\s\S]*protectedContainerContext\(n, el\)/.test(consent));

const auxiliaryAuthDialogClicks = runConsentDialog(
  'Before you continue. Sign in. We use cookies and data to maintain services, measure engagement, build an advertising profile, transfer data, and let you withdraw consent.',
  ['Reject all', 'Accept all', 'More options']
);
check('an explicit consent decision pair is not suppressed by an unrelated authentication control',
  auxiliaryAuthDialogClicks.length === 1 && auxiliaryAuthDialogClicks[0] === 'Reject all',
  JSON.stringify(auxiliaryAuthDialogClicks));

const ambiguousAuthDialogClicks = runConsentDialog(
  'Sign in to manage privacy preferences and cookie settings.',
  ['Reject all', 'Continue']
);
check('authentication context without a complete consent decision pair remains protected',
  ambiguousAuthDialogClicks.length === 0,
  JSON.stringify(ambiguousAuthDialogClicks));

const sensitiveDialogClicks = runConsentDialog(
  'Payment and billing profile. We use cookies and data for personalised ads.',
  ['Reject all', 'Accept all']
);
check('sensitive account context remains protected even when reject and accept labels coexist',
  sensitiveDialogClicks.length === 0,
  JSON.stringify(sensitiveDialogClicks));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

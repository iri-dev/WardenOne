/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Untrusted payment frames on a checkout page.
 * Run: node tools/test-payment-frame-origin.js
 *
 * The payment card guard used to carry this check:
 *
 *     if (window.top !== window && !trustedPaymentHost(location.hostname)) ...
 *         reasons.push("card fields are inside an untrusted embedded frame")
 *
 * inside an engine the manifest injects with all_frames:false. window.top always
 * equalled window, so the branch could not be taken and the reason had never once
 * been raised — a warning that had been shipping, and passing review, while being
 * unreachable.
 *
 * The fix inverts it rather than injecting the engine into every frame. Asked
 * from the top frame it is the better question anyway: the top document can
 * enumerate every embedded payment form at once, including ones whose own script
 * would have kept an injected guard out, and it costs nothing on the frames it
 * does not care about.
 *
 * The restraint is the hard part. Most checkouts render card fields inside a
 * third-party iframe — that is what Stripe and Adyen do, and it is exactly what
 * makes them safe — so flagging third-party frames as a class would flag every
 * real checkout and the advertisement beside it. Only a raw IP address or a host
 * that already looks like a fake payment domain counts.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* The scanner as it ships, with the real host helpers it leans on lifted from
   the same file rather than reimplemented — a paraphrase of suspiciousPaymentHost
   would be testing this suite's opinion of a junk TLD, not the engine's. */
function loadScanner(pageHost, frames) {
  const start = CONTENT.indexOf('untrustedPaymentFrames=()=>{');
  assert(start > 0, 'untrustedPaymentFrames not found in content.min.js');
  const end = CONTENT.indexOf('paymentPageText=()=>{', start);
  assert(end > start, 'could not delimit the scanner');

  const helperNames = ['suspiciousPaymentHost=host=>{', 'trustedPaymentHost=host=>', 'rawHost=host=>', 'sameSiteHost=host=>{'];
  const helpers = helperNames.map((marker) => {
    const at = CONTENT.indexOf(marker);
    assert(at > 0, 'missing helper: ' + marker);
    /* Each helper is one entry in a comma-separated const chain, so it runs to
       the start of the next entry. */
    const nextComma = CONTENT.indexOf(',', CONTENT.indexOf('},', at) >= 0 ? CONTENT.indexOf('},', at) : at);
    return CONTENT.slice(at, nextComma >= 0 ? nextComma : at + 400);
  });

  const sandbox = {
    console, URL, String, Array, Object, Number, Boolean,
    currentHost: pageHost,
    location: { hostname: pageHost, href: 'https://' + pageHost + '/checkout' },
    hostMatches: (host, list) => (list || []).some((d) => host === d || String(host).endsWith('.' + d)),
    TRUSTED_PAYMENT_HOSTS: ['stripe.com', 'js.stripe.com', 'adyen.com', 'paypal.com', 'braintreegateway.com', 'checkout.com'],
    document: {
      querySelectorAll(sel) {
        assert(/iframe/.test(sel), 'unexpected selector: ' + sel);
        return frames.map((src) => ({ getAttribute: () => src }));
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext('var ' + helpers.join(', ') + ';', sandbox, { filename: 'content.min.js' });
  vm.runInContext('var ' + CONTENT.slice(start, end).replace(/,\s*$/, '') + ';\nthis.__scan = untrustedPaymentFrames;',
    sandbox, { filename: 'content.min.js' });
  return sandbox.__scan;
}

function scan(frames, pageHost) {
  return loadScanner(pageHost || 'shop.example', frames)();
}

// --- what must be caught ----------------------------------------------------

(function rawIpFramesAreCaught() {
  /* A checkout that loads its card form from a bare IP address is never a real
     processor. */
  check('an http IP-address frame is flagged',
    scan(['http://192.0.2.44/pay.html']).indexOf('192.0.2.44') >= 0);
  check('an https IP-address frame is flagged',
    scan(['https://203.0.113.9/card']).indexOf('203.0.113.9') >= 0);
}());

(function fakeLookingPaymentHostsAreCaught() {
  /* suspiciousPaymentHost is the engine's own judgement about junk TLDs,
     punycode and digit-stuffed labels. This checks it is consulted, not what it
     thinks. */
  const hits = scan(['https://secure-pay-verify.cfd/form']);
  check('a junk-TLD payment lookalike is flagged', hits.length === 1, JSON.stringify(hits));
  check('the host is reported so the warning can name it',
    hits[0] === 'secure-pay-verify.cfd', JSON.stringify(hits));
}());

(function severalBadFramesAreCollected() {
  const hits = scan(['https://203.0.113.9/a', 'https://pay-now.cfd/b', 'https://js.stripe.com/v3']);
  check('every bad frame is collected', hits.length === 2, JSON.stringify(hits));
  check('the trusted one is not among them', hits.indexOf('js.stripe.com') < 0);
}());

// --- what must be left alone ------------------------------------------------

(function realProcessorsAreNeverFlagged() {
  /* The whole reason the check cannot simply flag third-party frames: this IS
     how a safe checkout is built. */
  ['https://js.stripe.com/v3/elements', 'https://checkoutshopper-live.adyen.com/hpp',
    'https://www.paypal.com/smart/buttons', 'https://assets.braintreegateway.com/web/frame.html',
  ].forEach((src) => {
    check('a real processor frame is not flagged: ' + src.split('/')[2], scan([src]).length === 0,
      JSON.stringify(scan([src])));
  });
}());

(function ordinaryThirdPartyFramesAreNotFlagged() {
  /* The false positive that would have made this unusable. A checkout page with
     an ad, a chat widget and an analytics frame is an ordinary checkout page. */
  const hits = scan([
    'https://googleads.g.doubleclick.net/pagead/ads',
    'https://www.youtube.com/embed/abc',
    'https://widget.intercom.io/frame',
    'https://www.google.com/recaptcha/api2/anchor',
  ]);
  check('ads, chat, video and CAPTCHA frames are left alone', hits.length === 0, JSON.stringify(hits));
}());

(function sameSiteFramesAreNotThirdParties() {
  check('a frame on the checkout\'s own host is ignored',
    scan(['https://shop.example/pay-iframe.html']).length === 0);
  check('a frame on its own subdomain is ignored',
    scan(['https://secure.shop.example/pay.html']).length === 0);
  check('a relative frame src is ignored', scan(['/pay-iframe.html']).length === 0);
}());

(function malformedInputIsSurvived() {
  const hits = scan(['', 'not a url', 'javascript:void(0)', 'about:blank', 'data:text/html,<b>x']);
  check('unparseable and non-http frame sources are skipped', hits.length === 0, JSON.stringify(hits));
}());

(function theScanIsBounded() {
  /* A page can hold thousands of iframes. The reason list only ever shows one. */
  const many = [];
  for (let i = 0; i < 200; i++) many.push('https://bad-' + i + '.cfd/pay');
  const hits = scan(many);
  check('the result is capped rather than unbounded', hits.length <= 3, String(hits.length));
  check('it still finds something', hits.length > 0);
}());

// --- the reason is actually raised ------------------------------------------

(function theWarningIsWiredUp() {
  /* Knowing the scanner works is not the same as knowing anything calls it —
     which was precisely the old bug. */
  check('the scanner is called by the card guard', /const badPaymentFrames=untrustedPaymentFrames\(\)/.test(SOURCE));
  check('a hit is treated as a hard reason', /badPaymentFrames\.length\)\{\s*hard=!0/.test(SOURCE.replace(/\n\s*/g, '')));
  check('the reason names the host it found',
    /card fields are inside an untrusted embedded frame \("\+badPaymentFrames\[0\]/.test(SOURCE));
  check('it ships in the built engine', CONTENT.indexOf('untrustedPaymentFrames') > 0);
}());

(function theDeadBranchIsGone() {
  /* The specific shape that could not fire. If it ever comes back, so does a
     warning that silently never happens. */
  check('the unreachable window.top check is removed',
    SOURCE.indexOf('window.top!==window&&!trustedPaymentHost') < 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const engine = (manifest.content_scripts || []).find((cs) => (cs.js || []).indexOf('content.min.js') >= 0);
  check('the engine is still top-frame only, which is why the inversion was needed',
    !!engine && engine.all_frames !== true);
}());

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('payment frame origin: ' + pass + ' checks passed');

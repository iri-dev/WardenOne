/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Who can claim a site-compatibility exit (C1).
 *
 * The engine takes a deliberate exit on Amazon: __woStartRuntime returns before installing
 * anything, and __woSyncConfig turns every boolean in the config off. Both exits also stamp
 * __wardenOneInstalled and __wardenOneReadyVersion, so a tab that took one goes on reporting
 * itself protected.
 *
 * That is fine while only Amazon can claim it. The test was /(^|\.)amazon\.[a-z.]+$/i, which
 * anchors the label but not the suffix: it accepted any run of letters and dots after a label
 * called "amazon", and the attacker chooses their own hostname. amazon.attacker.com matched, and
 * so did amazon.com.evil.tld -- the shape Amazon credential phishing actually uses. A page could
 * therefore switch off the phishing blocker, Payment Card Guard, skimmer detection, token-exfil
 * detection, the clipboard-swap guard and the scam lock by picking a subdomain, and the tab still
 * looked healthy to the popup and to Repair.
 *
 * The declarative network layer is no help on that host: a freshly registered phishing domain is
 * on no blocklist, which is the whole reason the in-page heuristic exists.
 *
 * This suite pins three things, because fixing any one alone leaves the hole open:
 *   1. real Amazon storefronts still take the exit (or the shim stops doing its job),
 *   2. attacker-controlled hosts do not,
 *   3. the loose pattern has not come back anywhere, and every call site shares one binding.
 *
 * The regex is lifted from content.min.js -- the artifact the browser actually loads -- rather
 * than from src/content.js, so a source fix that never reached the build cannot pass this.
 *
 * Run: node tools/test-compat-host-scope.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Lift the host test out of the shipped build rather than restating it. A second copy here would
// drift from the engine's, and then this suite would be pinning its own opinion instead.
// Deliberately matches ANY regex literal, not the corrected one. Pinning the expected shape here
// meant a reintroduced loose pattern threw "declaration not found" instead of reporting which
// hostnames it let through -- a failure either way, but the wrong one to read at 2am.
const DECL = /const __woAmazonHost=(\/(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[a-z]*);/.exec(MIN);
if (!DECL) throw new Error('__woAmazonHost declaration not found in content.min.js');

let AMAZON_HOST;
try {
  AMAZON_HOST = (0, eval)(DECL[1]);
} catch (e) {
  throw new Error('lifted __woAmazonHost is not a usable regex: ' + e.message);
}

// ---------------------------------------------------------------------------
// 1. The shim still covers the sites it exists for.
//
// Amazon runs many country storefronts and the exit exists because the engine genuinely broke the
// site. An over-tightened list re-breaks Amazon in those markets, which is why this half is
// checked first and treated as equal in weight to the security half.
// ---------------------------------------------------------------------------
{
  const real = [
    'amazon.com', 'www.amazon.com', 'smile.amazon.com',
    'amazon.co.uk', 'www.amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es',
    'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.com.be', 'amazon.ie',
    'amazon.ca', 'amazon.com.mx', 'amazon.com.br', 'amazon.com.co', 'amazon.cl',
    'amazon.com.au', 'amazon.co.jp', 'amazon.in', 'amazon.sg', 'amazon.ae', 'amazon.sa',
    'amazon.eg', 'amazon.com.tr', 'amazon.cn', 'amazon.co.za', 'amazon.ng',
  ];
  for (const host of real) {
    check('compat exit still applies to ' + host, AMAZON_HOST.test(host));
  }
}

// ---------------------------------------------------------------------------
// 2. Nobody else can claim it.
//
// Every entry is a hostname an attacker can register and serve from today. amazon.com.evil.tld is
// the one that matters most: the engine's own phishing heuristic classifies exactly that shape as
// a high-confidence "subdomain-spoof", so the old pattern disabled the detector on its own signal.
// ---------------------------------------------------------------------------
{
  const hostile = [
    'amazon.attacker.com',
    'amazon.com.evil.tld',
    'amazon.com.verifyxyz.com',
    'amazon.co.uk.evil.tld',
    'amazon.evil.tld',
    'login.amazon.phishing.site',
    'amazon.x',
    'amazon.support',
    'amazon.secure',
    'signin.amazon.account.tld',
  ];
  for (const host of hostile) {
    check('compat exit refused to ' + host, !AMAZON_HOST.test(host), 'attacker can disable the engine');
  }

  // Hosts that merely mention Amazon were never in scope and must stay out of it.
  for (const host of ['notamazon.com', 'amazonn.com', 'amazon-security.com', 'myamazon.com', 'evil.com']) {
    check('unrelated host unaffected: ' + host, !AMAZON_HOST.test(host));
  }
}

// ---------------------------------------------------------------------------
// 3. The loose pattern has not come back, and there is still only one of it.
//
// The original defect was the same mistake written out six times. One binding is what stops a
// seventh call site reintroducing it, so the count is pinned as well as the shape.
// ---------------------------------------------------------------------------
{
  const LOOSE = /amazon\\\.\[a-z\.\]\+\$/;
  const inCode = (text) => {
    // The explanatory comment in src/content.js quotes the old pattern on purpose. Strip block
    // comments before looking, or this check fails on the note that documents why it exists.
    return text.replace(/\/\*[\s\S]*?\*\//g, '');
  };
  check('the unanchored amazon pattern is gone from the source', !LOOSE.test(inCode(SRC)));
  check('the unanchored amazon pattern is gone from the shipped build', !LOOSE.test(inCode(MIN)));

  const srcUses = SRC.split('__woAmazonHost').length - 1;
  const minUses = MIN.split('__woAmazonHost').length - 1;
  check('source has one declaration and six call sites', srcUses === 7, 'found ' + srcUses);
  check('shipped build carries the same seven', minUses === 7, 'found ' + minUses);

  // The Shopify half of the same condition was always anchored; keep it that way.
  check('the shopify half stays anchored', /\(\^\|\\\.\)shopify\\\.com\$/.test(MIN));
}

if (failed) { console.error('\n' + failed + ' compat-host-scope check(s) failed'); process.exit(1); }
console.log('\nsite-compatibility exits can only be claimed by the sites they are for');

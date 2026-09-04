/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Who can claim Amazon-specific handling (C1).
 *
 * The engine USED to take a whole-engine exit on Amazon and Shopify:
 * __woStartRuntime returned before installing anything, and __woSyncConfig turned
 * every boolean in the config off. Both exits still stamped __wardenOneInstalled
 * and __wardenOneReadyVersion, so a tab that took one went on reporting itself
 * protected to the popup and to Repair. Those exits are GONE -- YouTube is now
 * the only host that pauses anything, and it pauses only the names in
 * YT_COMPAT_PAUSED. Section 0 pins that, because a site-wide off switch is the
 * most valuable thing an attacker could get back.
 *
 * __woAmazonHost itself survives, for Amazon-specific URL cleaning (/ref= and
 * friends). The host test still has to be tight. It was /(^|\.)amazon\.[a-z.]+$/i,
 * which anchors the label but not the suffix: it accepted any run of letters and
 * dots after a label called "amazon", and the attacker chooses their own
 * hostname. amazon.attacker.com matched, and so did amazon.com.evil.tld -- the
 * shape Amazon credential phishing actually uses. That is less severe now that it
 * only governs link rewriting rather than the whole engine, but a page still must
 * not be able to claim it.
 *
 * This suite pins:
 *   0. no host takes a whole-engine exit any more,
 *   1. real Amazon storefronts still get their URL cleaning,
 *   2. attacker-controlled hosts do not,
 *   3. the loose pattern has not come back anywhere, and every call site shares
 *      one binding.
 *
 * The regex is lifted from content.min.js -- the artifact the browser actually loads --
 * rather than from src/content.js, so a source fix that never reached the build cannot pass.
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
// 0. No host gets a whole-engine exit.
//
// This is the check that matters most. Both old exits stamped the tab as
// installed and ready while doing nothing, so the failure was invisible from
// every surface a reader could check.
// ---------------------------------------------------------------------------
{
  check('the runtime no longer returns early for any host',
    !/__wardenOneReadyVersion=__WO_RUNTIME_VERSION;\s*return/.test(MIN),
    'an exit that still stamps the tab as ready reports itself protected while doing nothing');
  check('no config derivation turns every boolean off',
    !/for\(const k of Object\.keys\(safe\)\)"boolean"==typeof safe\[k\]&&\(safe\[k\]=!1\)/.test(MIN),
    'the blanket kill is a site-wide off switch');
  check('the Amazon compatibility mode is gone', !/__amazonCompatibilityMode/.test(MIN));
  check('YouTube is the only derived config left',
    (MIN.match(/const safe=Object\.assign\(\{\},cfg\);/g) || []).length === 1,
    'a second derived copy means another site is being quietly stripped');
  check('and it pauses only the names it lists',
    /const YT_COMPAT_PAUSED=\[/.test(MIN)
      && /i<YT_COMPAT_PAUSED\.length/.test(MIN));
}

// ---------------------------------------------------------------------------
// 1. The host test still covers the storefronts it exists for.
//
// Amazon runs many country storefronts. An over-tightened list silently stops cleaning their
// URLs in those markets, which is why this half is treated as equal in weight to the security
// half below.
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
    check('Amazon URL cleaning still applies to ' + host, AMAZON_HOST.test(host));
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
    check('Amazon URL cleaning refused to ' + host, !AMAZON_HOST.test(host),
      'an attacker-chosen host must not claim Amazon-specific handling');
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

  // One declaration and four call sites, all of them URL cleaning. It was seven
  // before; the two that went were the whole-engine exit in __woStartRuntime and
  // the config derivation that turned every boolean off.
  const srcUses = SRC.split('__woAmazonHost').length - 1;
  const minUses = MIN.split('__woAmazonHost').length - 1;
  check('source has one declaration and four call sites', srcUses === 5, 'found ' + srcUses);
  check('shipped build carries the same five', minUses === 5, 'found ' + minUses);
  check('no call site gates the engine on the host',
    !MIN.includes('if(__woAmazonHost.test(location.hostname)'),
    'that shape was the whole-engine exit');
  // Shopify was the other half of that condition and has no call site left at all.
  check('shopify no longer gates anything',
    !MIN.includes('shopify\\.com$/i.test(location.hostname)'),
    'the engine must start on Shopify like anywhere else');
}

if (failed) { console.error('\n' + failed + ' compat-host-scope check(s) failed'); process.exit(1); }
console.log('\nno host takes a whole-engine exit; Amazon URL cleaning is tightly scoped');

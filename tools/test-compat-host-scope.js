/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* No host may disable the whole engine. Amazon URL cleanup applies only to
   genuine storefront hosts; attacker-controlled lookalikes must not qualify.
   Read the shipped content.min.js so an unreconstructed source fix cannot pass. */
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
  check('there is one derived config, not one per site',
    (MIN.match(/const safe=Object\.assign\(\{\},cfg\);/g) || []).length === 1,
    'a second derived copy means another site is being quietly stripped');
  /* It pauses names from a list, and the only lists are YouTube's and the education one, each
     chosen by its own host test. A third list, or a loop over anything else, fails here. */
  check('and it pauses only the names in a named list',
    /const YT_COMPAT_PAUSED=\[/.test(MIN) && /EDU_COMPAT_PAUSED=\[/.test(MIN)
      && /paused=youtube\?YT_COMPAT_PAUSED:EDU_COMPAT_HOST\.test\(host\)\?EDU_COMPAT_PAUSED:null;/.test(MIN)
      && /i<paused\.length/.test(MIN)
      && (MIN.match(/_COMPAT_PAUSED=\[/g) || []).length === 2);
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

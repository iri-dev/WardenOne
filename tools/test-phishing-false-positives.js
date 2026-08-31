/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Regression checks for phishing false positives on official brand infrastructure.
 *
 * Run: node tools/test-phishing-false-positives.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const source = fs.readFileSync('src/content.js', 'utf8');
const min = fs.readFileSync('content.min.js', 'utf8');
const startup = fs.readFileSync('background-startup.js', 'utf8');
const brandStart = source.indexOf('const BRANDS={');
const brandEnd = brandStart >= 0 ? source.indexOf('};\n      try{', brandStart) : -1;
assert(brandStart >= 0 && brandEnd > brandStart, 'content phishing brand table not found');
const brandBlock = source.slice(brandStart, brandEnd);

function contentBrandDomains(brand) {
  const match = brandBlock.match(new RegExp('\\b' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\[([\\s\\S]*?)\\]'));
  assert(match, 'missing content brand entry: ' + brand);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function hasDomain(list, domain) {
  return list.includes(domain);
}

function checkContentBrand(brand, domains) {
  const list = contentBrandDomains(brand);
  domains.forEach((domain) => {
    assert(hasDomain(list, domain), brand + ' should trust official domain ' + domain);
    assert(min.includes(domain), 'runtime content bundle should include ' + domain);
  });
}

checkContentBrand('paypal', ['paypalobjects.com']);
checkContentBrand('google', ['g.co', 'goo.gle', 'withgoogle.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com']);
checkContentBrand('amazon', ['amazon.co.jp', 'amazon.com.au', 'amazonpay.com', 'amzn.com']);
checkContentBrand('microsoft', ['microsoft365.com', 'sharepoint.com', 'onmicrosoft.com', 'msftauth.net', 'msauth.net', 'aka.ms']);
checkContentBrand('facebook', ['meta.com', 'facebookmail.com', 'fbcdn.net']);
checkContentBrand('github', ['githubusercontent.com', 'githubassets.com', 'github.io']);
checkContentBrand('dropbox', ['dropboxusercontent.com']);
checkContentBrand('twitch', ['ttvnw.net', 'jtvnw.net', 'twitchcdn.net']);
checkContentBrand('chase', ['jpmorganchase.com']);

function regDomainBg(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (/^(co|com|org|net|gov|ac)\.[a-z]{2}$/i.test(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

const sandbox = {
  console,
  setTimeout() {},
  DEFAULT_CONFIG: {},
  BLOCKED_DOMAINS: new Set(),
  EXT_BASELINE_KEY: 'test-baseline',
  regDomainBg,
  localGet: async () => ({}),
  localSet: async () => {},
  snapshotExtensionBaseline: async () => {},
  chrome: {
    runtime: { onStartup: { addListener() {} } },
    tabs: { query: async () => [] },
    management: { getAll: async () => [] },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    notifications: { create() {} },
  },
  globalThis: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
  installEngineAmbient(sandbox);
vm.runInContext(startup + '\nglobalThis.__phishingTest = { loginRiskVerdict, looksLikeLookalikeHost };', sandbox, { filename: 'background-startup.js' });

const officialStartupHosts = [
  'login.microsoft365.com',
  'secure.msftauth.net',
  'tenant.sharepoint.com',
  'contoso.onmicrosoft.com',
  'accounts.paypalobjects.com',
  'static.googleusercontent.com',
  'apis.googleapis.com',
  'facebookmail.com',
  'assets.githubusercontent.com',
  'static.dropboxusercontent.com',
  'pay.amazonpay.com',
  'www.amazon.co.jp',
  'secure.jpmorganchase.com',
];

officialStartupHosts.forEach((host) => {
  const verdict = sandbox.__phishingTest.loginRiskVerdict(host, 'https://' + host + '/login', null, 14);
  assert.strictEqual(verdict.risky, false, host + ' should not be treated as a login phishing domain');
  assert.strictEqual(sandbox.__phishingTest.looksLikeLookalikeHost(host), false, host + ' should not be a startup lookalike');
});

const risky = sandbox.__phishingTest.loginRiskVerdict('paypa1.com', 'https://paypa1.com/login', null, 14);
assert.strictEqual(risky.risky, true, 'obvious PayPal typo should still be risky');

console.log('[ok] phishing false-positive checks passed');

// ---------------------------------------------------------------------------
// M31. Behavioural verdicts, not just table contents.
//
// word.cloud.microsoft was shown the full-page "Likely phishing site blocked" interstitial. The
// cause was not a missing table entry so much as the subdomain-spoof rule: it asks
// parts.includes(brand), and Microsoft OWNS the .microsoft TLD -- so on its most first-party
// address the brand name is the last label, and the rule read that as the strongest possible spoof
// of itself. blog.google failed the same way.
//
// The table above is checked by regex, which cannot catch that. These run the detector.
// ---------------------------------------------------------------------------
{
  const detectStart = source.indexOf('const BRANDS={');
  const loopEnd = source.indexOf('if(phishHit)break', detectStart);
  assert(detectStart >= 0 && loopEnd > detectStart, 'phishing detection region not found');
  /* SITE_BOUNDARY is defined far above the detector, and the detector uses it to
     resolve the registrable label instead of counting dots from the right. Lift
     it too, or every case here dies with "not defined" -- which reads on a
     pass/fail count exactly like "nothing is flagged any more". */
  const sbStart = source.indexOf('SITE_BOUNDARY=(()=>{');
  const sbEnd = source.indexOf('VERIFICATION_FLOW_POLICY=(()=>{', sbStart);
  assert(sbStart >= 0 && sbEnd > sbStart, 'SITE_BOUNDARY region not found');
  const boundarySrc = 'const ' + source.slice(sbStart, sbEnd).replace(/,\s*$/, ';');
  const detectSrc = boundarySrc + String.fromCharCode(10)
    + source.slice(detectStart, source.indexOf('}', loopEnd) + 1);

  function verdictFor(hostname) {
    const sandbox = {
      location: { hostname },
      WO: {},
      Object, Array, Set, Math, String, RegExp,
    };
    installEngineAmbient(sandbox);
    vm.runInContext(detectSrc + '\nthis.__hit = phishHit;', sandbox, { filename: 'src/content.js' });
    return sandbox.__hit;
  }

  let m31Failed = 0;
  const expect = (host, shouldWarn, why) => {
    const hit = verdictFor(host);
    const warned = !!hit;
    if (warned === shouldWarn) {
      console.log('  ok  - ' + host + (shouldWarn ? ' warns' : ' is allowed') + (why ? ' (' + why + ')' : ''));
      return;
    }
    m31Failed++;
    console.error('  FAIL - ' + host + ' expected ' + (shouldWarn ? 'a warning' : 'no warning')
      + ' but got ' + (hit ? hit.kind + '/' + hit.brand : 'none'));
  };

  // The reported false positive, and its siblings on the same brand-owned TLD.
  expect('word.cloud.microsoft', false, 'the reported M31 URL');
  expect('excel.cloud.microsoft', false);
  expect('powerpoint.cloud.microsoft', false);
  expect('cloud.microsoft', false);
  // Google publishes on its own TLD too, and broke identically.
  expect('blog.google', false);
  expect('about.google', false);
  // Ordinary first-party hosts that were already fine must stay fine.
  expect('www.microsoft.com', false);
  expect('outlook.office.com', false);
  expect('login.microsoftonline.com', false);

  // The security half. Owning a TLD is the ownership proof, so it must not be forgeable by putting
  // the brand name anywhere else in the name. These are the cases the fix must NOT have loosened.
  expect('microsoft.evil.com', true, 'brand as a subdomain of an unrelated site');
  expect('login.microsoft.attacker.net', true, 'brand buried mid-name');
  // A hyphenated look-alike only warns when the name also carries a phishing word. That is a
  // deliberate pre-existing trade-off in the brand-in-name rule, not something this fix changed --
  // without it, every legitimate "microsoft-partner-consulting.com" would be flagged. Recorded as
  // the behaviour it is, so a future change to that rule shows up here rather than silently.
  expect('cloud-microsoft.com', false, 'no phishing word: brand-in-name deliberately abstains');
  expect('login-cloud-microsoft.com', true, 'hyphenated look-alike carrying a phishing word');
  expect('rnicrosoft.com', true, 'rn/m visual substitution');
  expect('microsofr.com', true, 'single-character typo');
  expect('paypa1.com', true, 'digit-for-letter on another brand');

  if (m31Failed) {
    console.error('\n' + m31Failed + ' phishing verdict check(s) failed');
    process.exit(1);
  }
  console.log('\nphishing verdict checks passed');
}

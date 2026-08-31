/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Disclosure contract (M13).
 *
 * The privacy policy described a password k-anonymity lookup the shipped extension never
 * offered, and omitted the one network call its breach feature actually makes. Nobody noticed
 * because nothing compared the two: the policy was prose, the endpoints were code, and they
 * drifted independently for as long as they liked.
 *
 * So this enumerates the hosts the worker really fetches and asserts each is disclosed. It is
 * deliberately built from fetch() call sites rather than from any list of strings, because a
 * list would be a second copy of the same knowledge and would drift the same way.
 *
 * Run: node tools/test-privacy-disclosure.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Hosts reached from a literal fetch(), plus hosts held in a named feed/API constant. Both
// forms appear in the worker; neither is a curated list.
function runtimeHosts() {
  const hosts = new Set();
  for (const file of ['background.js', 'background-downloads.js', 'background-memory.js', 'background-startup.js',
    'background-extension-watch.js', 'background-extension-reputation.js', 'extensions.js']) {
    let src = '';
    try { src = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (_) { continue; }
    for (const m of src.matchAll(/fetch\(\s*[`'"]([^`'"]*)/g)) {
      const host = (m[1].match(/^https:\/\/([a-z0-9.-]+)/i) || [])[1];
      if (host) hosts.add(host.toLowerCase());
    }
    for (const m of src.matchAll(/[A-Z0-9_]*(?:FEED|API|URL|ENDPOINT)[A-Z0-9_]*\s*=\s*['"]https:\/\/([a-z0-9.-]+)/g)) {
      hosts.add(m[1].toLowerCase());
    }
  }
  // example.com appears in comments and placeholder URLs, not as a real destination.
  hosts.delete('example.com');
  return [...hosts].sort();
}

const hosts = runtimeHosts();
check('runtime endpoints were discovered at all', hosts.length >= 5, 'found ' + hosts.length);

// A provider may be disclosed by name rather than hostname, which is legitimate prose. Accept
// either, so the test does not force a particular wording on the policy.
const BY_NAME = {
  'api.abuseipdb.com': 'abuseipdb',
  'checkurl.phishtank.com': 'phishtank',
  'urlhaus-api.abuse.ch': 'urlhaus',
  'www.whoisxmlapi.com': 'whoisxml',
  'domain-reputation.whoisxmlapi.com': 'whoisxml',
  'threat-intelligence.whoisxmlapi.com': 'whoisxml',
  'safebrowsing.googleapis.com': 'safe browsing',
};
const policy = POLICY.toLowerCase();
for (const host of hosts) {
  const alias = BY_NAME[host];
  check('PRIVACY.md discloses ' + host,
    policy.includes(host) || (alias && policy.includes(alias)),
    'neither the host nor its provider name appears');
}

// The specific defect: the shipped breach feature and its data shape.
check('the site-breach endpoint is named',
  policy.includes('haveibeenpwned.com'));
check('the policy says a registrable domain is what is sent',
  /registrable domain/.test(policy));
check('the 12-hour cache is disclosed', /12 hours/.test(policy));
check('the 120-domain cap is disclosed', /120/.test(policy));
check('the policy says it checks the SITE, not the user account',
  /not your account/.test(policy));

/* The password check is back, deliberately, and the shape of the old mistake is
   what this now guards. Last time the handler existed in the worker and NOTHING
   could reach it, while the policy described it in detail -- a documented feature
   that did not exist. So the pairing runs both ways: the policy has to describe
   it, and the interface has to actually offer it. */
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

check('the policy describes the password check', /pwnedpasswords\.com/.test(policy));
check('the policy says what actually leaves the device',
  /five hexadecimal characters|first five characters/i.test(policy));
check('the policy says the answer is not written down',
  /written nowhere/i.test(policy));

/* The reason the last one was removed: a documented feature with no way in. */
check('the interface actually offers it', /id="ss-pwned"/.test(popupHtml),
  'the policy would be describing something unreachable again');
check('and something is wired to that control', /ss-pwned/.test(popupJs));

/* It runs from the extension page. Re-adding it as a message kind would hand
   pages a channel to submit hash prefixes through, which is what the old
   'breach-check' kind was. */
check('the worker has no password message kind', !bg.includes("kind === 'breach-check'"),
  'a page-reachable channel for hash prefixes is back');
check('the lookup does not run in the worker', !bg.includes('api.pwnedpasswords.com'),
  'it belongs in the extension page, where no tab can reach it');

// OpenPhish was described as needing a key it has never needed.
check('the policy no longer claims every provider needs an API key',
  !/off by default, your own api key required/.test(policy));
check('OpenPhish is identified as the keyless exception',
  /openphish is the exception/.test(policy));

// The Limited Use affirmation has to live on the hosted privacy page, because that is the page
// the dashboard points at. PRIVACY.md IS that page -- Pages serves it from main.
// Pin the affirmation SENTENCE, not the words "limited use". Checking for the phrase alone
// passes on a page that merely mentions it -- verified by mutation: deleting the section heading
// left that weaker assertion green, because the body still said the words.
check('the hosted policy carries the Limited Use affirmation',
  /use and transfer of information received from google apis/.test(policy)
    && /chrome web store user data policy/.test(policy)
    && /limited use/.test(policy));
check('the affirmation is a section a reviewer can find, not a buried clause',
  /## chrome web store limited use/.test(policy));
check('the affirmation states the no-advertising limb explicitly',
  /never.{0,40}transferred or used for advertising/.test(policy));
check('the policy date was refreshed alongside the content',
  /last updated: august 30, 2026/.test(policy));

if (failed) { console.error('\n' + failed + ' disclosure check(s) failed'); process.exit(1); }
console.log('\nprivacy disclosure contract holds (' + hosts.length + ' runtime endpoints checked)');

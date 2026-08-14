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
const SUBMISSION = fs.readFileSync(path.join(ROOT, 'CWS-SUBMISSION.md'), 'utf8');

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
  for (const file of ['background.js', 'background-downloads.js', 'background-memory.js', 'background-startup.js']) {
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

// The removed feature must be gone from code and not re-described as shipping.
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
check('the unreachable password handler is gone from the worker',
  !bg.includes('api.pwnedpasswords.com') && !bg.includes("kind === 'breach-check'"));
check('the submission notes no longer list the removed endpoint',
  !SUBMISSION.includes('api.pwnedpasswords.com'));
check('the policy explains the removal rather than silently dropping it',
  /no password checking in wardenone/.test(policy));

// OpenPhish was described as needing a key it has never needed.
check('the policy no longer claims every provider needs an API key',
  !/off by default, your own api key required/.test(policy));
check('OpenPhish is identified as the keyless exception',
  /openphish is the exception/.test(policy));

// Both public documents must agree; the store answers are written from them.
for (const host of ['haveibeenpwned.com', 'rdap.org']) {
  check('CWS-SUBMISSION.md also names ' + host, SUBMISSION.includes(host));
}

if (failed) { console.error('\n' + failed + ' disclosure check(s) failed'); process.exit(1); }
console.log('\nprivacy disclosure contract holds (' + hosts.length + ' runtime endpoints checked)');

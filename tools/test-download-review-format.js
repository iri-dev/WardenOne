/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('download-review.js', 'utf8');
const start = source.indexOf('const PROVIDER_RENDERERS = new Map([');
const end = source.indexOf('\nfunction formatBytes(', start);
assert(start >= 0 && end > start);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + '\nthis.format = formatExternalReputation;', sandbox);

const cases = [
  [{ provider: 'VirusTotal', ok: false, status: 429 }, 'VirusTotal: rate limited'],
  [{ provider: 'VirusTotal', ok: false, status: 503 }, 'VirusTotal: lookup failed (HTTP 503)'],
  [{ provider: 'VirusTotal', stats: { malicious: 2, suspicious: 1 } }, 'VirusTotal: 2 malicious, 1 suspicious'],
  [{ provider: 'VirusTotal', notFound: true }, 'VirusTotal: no URL report yet'],
  [{ provider: 'VirusTotal file hash', stats: { malicious: 1 } }, 'VirusTotal URL-content hash: 1 malicious, 0 suspicious'],
  [{ provider: 'Google Safe Browsing', ok: false, status: 403 }, 'Google Safe Browsing: lookup failed (HTTP 403)'],
  [{ provider: 'Google Safe Browsing', threats: ['MALWARE', 'SOCIAL_ENGINEERING'] }, 'Google Safe Browsing: MALWARE, SOCIAL_ENGINEERING'],
  [{ provider: 'Google Safe Browsing', ok: true }, 'Google Safe Browsing: clear'],
  [{ provider: 'PhishTank', ok: false, rateLimited: true }, 'PhishTank: rate limited'],
  [{ provider: 'PhishTank', hit: true, phishId: 17 }, 'PhishTank: verified phishing #17'],
  [{ provider: 'PhishTank', ok: true, inDatabase: true }, 'PhishTank: listed, not current/verified'],
  [{ provider: 'OpenPhish', ok: false }, 'OpenPhish: feed lookup failed'],
  [{ provider: 'OpenPhish', hit: true }, 'OpenPhish: phishing feed match'],
  [{ provider: 'OpenPhish', ok: true, stale: true }, 'OpenPhish: clear (stale feed)'],
  [{ provider: 'AbuseIPDB', ok: false, status: 500 }, 'AbuseIPDB: lookup failed (HTTP 500)'],
  [{ provider: 'AbuseIPDB', warning: true, score: 43, totalReports: 2 }, 'AbuseIPDB: 43% abuse confidence, 2 reports'],
  [{ provider: 'AbuseIPDB', ok: true }, 'AbuseIPDB: clear'],
  [{ provider: 'URLhaus', ok: false, rateLimited: true }, 'URLhaus: rate limited'],
  [{ provider: 'URLhaus', hit: true, hostOnly: true, threat: 'malware', signatures: ['A'], payloadCount: 2 }, 'URLhaus: malware host - malware / A, 2 payloads'],
  [{ provider: 'URLhaus', ok: true }, 'URLhaus: clear'],
  [{ provider: 'WhoisXML Domain Reputation', ok: false, rateLimited: true }, 'WhoisXML reputation: rate limited'],
  [{ provider: 'WhoisXML Domain Reputation', warning: true, reputationScore: 72.6 }, 'WhoisXML reputation: 73/100'],
  [{ provider: 'WhoisXML Domain Reputation', ok: true }, 'WhoisXML reputation: clear'],
  [{ provider: 'WhoisXML Threat Intelligence', ok: false, status: 502 }, 'WhoisXML threat intel: lookup failed (HTTP 502)'],
  [{ provider: 'WhoisXML Threat Intelligence', hit: true, total: 2, threatTypes: ['botnet'] }, 'WhoisXML threat intel: 2 IoC matches / botnet'],
  [{ provider: 'WhoisXML Threat Intelligence', ok: true }, 'WhoisXML threat intel: clear'],
  [{ provider: 'WhoisXML API', warning: true, ageDays: 3 }, 'WhoisXML domain age: 3 days'],
  [{ provider: 'WhoisXML API', ok: true }, 'WhoisXML domain age: clear'],
  [{ provider: 'Unknown source' }, 'Unknown source'],
  [null, 'External reputation'],
];

for (const [item, expected] of cases) {
  assert.strictEqual(sandbox.format([item]), expected, JSON.stringify(item));
}
assert.strictEqual(sandbox.format([]), '');
assert.strictEqual(sandbox.format(cases.slice(0, 2).map(([item]) => item)), 'VirusTotal: rate limited · VirusTotal: lookup failed (HTTP 503)');
console.log('[ok] download-review provider summaries (' + cases.length + ' cases)');

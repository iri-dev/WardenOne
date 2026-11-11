/* The support report must keep aggregate evidence while dropping site and account data. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { buildDiagnosticsReport, diagnosticBrowser } = require('../popup-diagnostics.js');

const secret = 'SECRET-DOMAIN.example';
const commit = '378a104' + 'a'.repeat(33);
const now = Date.now();
/* totalShields is the switchable count (HEALTH_SHIELD_KEYS, 105), not the 108 headline, which
   also counts the three watch-only guards that have no switch to be on or off. */
const base = {
  health: {
    ok: true, level: 'warning', configuredShields: 103, totalShields: 105,
    componentFailures: 0, detail: secret, needsAttention: [{ text: secret, alerts: [{ name: secret }] }],
    tab: { state: 'verified', host: secret, text: secret },
    list: { active: 28412, updated: now - 3600000,
      feedCoverage: { coveredDomains: 28000, installedHostEntries: 26000, installedDomainRules: 13,
        installedOptionRules: 100, installedRedirectRules: 2, installedCspRules: 1 },
      sources: { total: 7, succeeded: 6, failed: 1, failures: [{ url: 'https://' + secret }] },
      publisher: { dated: 5, stale: 2, unknown: 2 },
    },
  },
  config: { siteOverrides: { [secret]: { adShield: false }, 'other.example': {} },
    downloadSafeBrowsingKey: secret, history: [{ url: 'https://' + secret }] },
  dnr: { session: 3, staticSets: 4 },
  verification: { version: '1.0.1', build: commit, at: now - 3600000, passed: true, url: secret },
  browser: 'Brave (version unavailable)', version: '1.0.1', build: commit, now,
};
const report = buildDiagnosticsReport(base);
assert(report.includes('Build commit: ' + commit));
assert(report.includes('Protections enabled in settings: 103/105'));
assert(report.includes('Failed modules: 0'));
assert(report.includes('Feed hostnames covered at last refresh: 28,000'));
assert(report.includes('Hostnames in downloaded domain rules: 26,000'));
assert(report.includes('Downloaded URL filter rules: 100'));
assert(!report.includes('28,412'));
assert(report.includes('Lists current: 6/7'));
assert(report.includes('Publisher dates: 3 recent, 2 over 30 days old, 2 unknown'));
assert(report.includes('Site overrides: 2'));
assert(report.includes('Last integrity check (Verify & Repair): Passed'));
assert(!report.includes(secret) && !report.includes('https://') && !report.includes('history:'));

const missing = buildDiagnosticsReport({ ...base, health: { ok: false, detail: secret },
  dnr: { session: -1, staticSets: 'bad' },
  verification: { version: '0.0.0', passed: true, at: now }, browser: secret, build: secret });
assert(missing.includes('Protection health: unknown'));
assert(missing.includes('Downloaded domain rules: Unknown'));
assert(missing.includes('Session DNR rules: Unknown'));
assert(missing.includes('Enabled static rulesets: Unknown'));
assert(missing.includes('Last integrity check (Verify & Repair): Not recorded for this version'));
assert(missing.includes('Browser: Unknown'));
assert(missing.includes('Build commit: Unavailable'));
assert(!missing.includes(secret));
assert(buildDiagnosticsReport({ ...base, verification: { ...base.verification, build: 'b'.repeat(40) } })
  .includes('Last integrity check (Verify & Repair): Not recorded for this version'));

const html = fs.readFileSync('popup.html', 'utf8');
const bg = fs.readFileSync('background.js', 'utf8');
const script = fs.readFileSync('popup-diagnostics.js', 'utf8');
const allowlist = JSON.parse(fs.readFileSync('tools/package-allowlist.json', 'utf8'));
assert(html.includes('id="diagnostics-prepare"') && html.includes('id="diagnostics-download"'));
assert(html.includes('id="diagnostics-preview" hidden') && html.includes('src="popup-diagnostics.js"'));
assert(allowlist.includes('popup-diagnostics.js') && bg.includes("'popup-diagnostics.js', 'popup-scroll-memory.js'"));
assert(bg.includes('componentFailures,') && bg.includes('wardenone_last_verification'));
assert(script.includes("prepare.addEventListener('click'") && script.includes("download.addEventListener('click'"));
assert(!script.includes('fetch('));
assert(!script.includes('getDynamicRules('), 'diagnostics should not copy the full packed rule band into the UI');

diagnosticBrowser({ brave: { isBrave: async () => true }, userAgent: 'Chrome/999' })
  .then((name) => {
    assert.strictEqual(name, 'Brave (Chromium 999)');
    assert(buildDiagnosticsReport({ ...base, browser: name }).includes('Browser: Brave (Chromium 999)'));
    assert(buildDiagnosticsReport({ ...base, browser: 'Brave 999' }).includes('Browser: Unknown'));
    console.log('[ok] diagnostics export tests');
  })
  .catch((error) => { console.error(error); process.exitCode = 1; });

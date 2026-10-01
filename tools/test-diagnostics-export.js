/* The support report must keep aggregate evidence while dropping site and account data. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { buildDiagnosticsReport, diagnosticBrowser } = require('../popup-diagnostics.js');

const secret = 'SECRET-DOMAIN.example';
const now = Date.now();
const base = {
  health: {
    ok: true, level: 'warning', configuredShields: 101, totalShields: 106,
    componentFailures: 0, detail: secret, needsAttention: [{ text: secret, alerts: [{ name: secret }] }],
    tab: { state: 'verified', host: secret, text: secret },
    list: { active: 28412, updated: now - 3600000,
      sources: { total: 7, succeeded: 6, failed: 1, failures: [{ url: 'https://' + secret }] },
      publisher: { dated: 5, stale: 2, unknown: 2 },
    },
  },
  config: { siteOverrides: { [secret]: { adShield: false }, 'other.example': {} },
    downloadSafeBrowsingKey: secret, history: [{ url: 'https://' + secret }] },
  dnr: { dynamic: 1211, session: 3, staticSets: 4 },
  verification: { version: '1.0.1', at: now - 3600000, passed: true, url: secret },
  browser: 'Brave (version unavailable)', version: '1.0.1', now,
};
const report = buildDiagnosticsReport(base);
assert(report.includes('Protections active: 101/106'));
assert(report.includes('Failed modules: 0'));
assert(report.includes('Rules loaded: 28,412'));
assert(report.includes('Lists current: 6/7'));
assert(report.includes('Publisher dates: 3 recent, 2 over 30 days old, 2 unknown'));
assert(report.includes('Site overrides: 2'));
assert(report.includes('Last integrity check (Verify & Repair): Passed'));
assert(!report.includes(secret) && !report.includes('https://') && !report.includes('history:'));

const missing = buildDiagnosticsReport({ ...base, health: { ok: false, detail: secret },
  dnr: { dynamic: null, session: -1, staticSets: 'bad' },
  verification: { version: '0.0.0', passed: true, at: now }, browser: secret });
assert(missing.includes('Protection health: unknown'));
assert(missing.includes('Dynamic DNR rules: Unknown'));
assert(missing.includes('Session DNR rules: Unknown'));
assert(missing.includes('Enabled static rulesets: Unknown'));
assert(missing.includes('Last integrity check (Verify & Repair): Not recorded for this version'));
assert(missing.includes('Browser: Unknown'));
assert(!missing.includes(secret));

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

diagnosticBrowser({ brave: { isBrave: async () => true }, userAgent: 'Chrome/999' })
  .then((name) => {
    assert.strictEqual(name, 'Brave (Chromium 999)');
    assert(buildDiagnosticsReport({ ...base, browser: name }).includes('Browser: Brave (Chromium 999)'));
    assert(buildDiagnosticsReport({ ...base, browser: 'Brave 999' }).includes('Browser: Unknown'));
    console.log('[ok] diagnostics export tests');
  })
  .catch((error) => { console.error(error); process.exitCode = 1; });

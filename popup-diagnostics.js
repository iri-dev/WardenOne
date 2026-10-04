/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const DIAGNOSTIC_TAB_STATES = new Set(['verified', 'failed', 'paused', 'excluded', 'restricted', 'off', 'sleeping', 'unconfigured', 'unknown']);
const DIAGNOSTIC_LEVELS = new Set(['ok', 'warning', 'danger']);
function diagnosticCount(value) {
  if (typeof value !== 'number') return null;
  const n = value;
  return Number.isSafeInteger(n) && n >= 0 && n <= 1000000000 ? n : null;
}
function diagnosticNumber(value) {
  const n = diagnosticCount(value);
  return n === null ? 'Unknown' : n.toLocaleString('en-US');
}
function diagnosticDate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= Date.now() ? new Date(n).toISOString().slice(0, 10) + ' UTC' : 'Unknown';
}
function buildDiagnosticsReport({ health, config, dnr, verification, browser, version, build, now }) {
  const h = health && health.ok === true ? health : null;
  const list = h && h.list || {};
  const sources = list.sources || {};
  const publisher = list.publisher || {};
  const overrides = config && config.siteOverrides && typeof config.siteOverrides === 'object'
    && !Array.isArray(config.siteOverrides) ? config.siteOverrides : {};
  const level = h && DIAGNOSTIC_LEVELS.has(h.level) ? h.level : 'unknown';
  const tabState = h && h.tab && DIAGNOSTIC_TAB_STATES.has(h.tab.state) ? h.tab.state : 'unknown';
  const dated = diagnosticCount(publisher.dated);
  const stale = diagnosticCount(publisher.stale);
  const recent = dated !== null && stale !== null && stale <= dated ? dated - stale : null;
  const commit = /^[0-9a-f]{40}$/.test(String(build)) ? build : '';
  const checked = verification && verification.version === version
    && (commit ? verification.build === commit : !verification.build) ? verification : null;
  const verifyStatus = checked && checked.at && diagnosticDate(checked.at) !== 'Unknown'
    ? (checked.passed === true ? 'Passed' : 'Issues found') + ' on ' + diagnosticDate(checked.at)
    : 'Not recorded for this version';
  const browserLabel = /^(?:Brave \(version unavailable\)|Brave \(Chromium \d+\)|Microsoft Edge \d+|Google Chrome \d+|Chromium \d+|Chromium-based browser \d+|Unknown)$/.test(String(browser))
    ? browser : 'Unknown';
  const text = [
    'WardenOne diagnostics',
    'Created: ' + diagnosticDate(now),
    'WardenOne version: ' + (/^\d+\.\d+\.\d+$/.test(String(version)) ? version : 'Unknown'),
    'Build commit: ' + (commit || 'Unavailable'),
    'Browser: ' + browserLabel,
    'Protection health: ' + level,
    'Protections active: ' + (h ? diagnosticNumber(h.configuredShields) : 'Unknown')
      + '/' + (h ? diagnosticNumber(h.totalShields) : 'Unknown'),
    'Current page engine: ' + tabState,
    'Failed modules: ' + (h ? diagnosticNumber(h.componentFailures) : 'Unknown'),
    'Rules loaded: ' + (h ? diagnosticNumber(list.active) : 'Unknown'),
    'Dynamic DNR rules: ' + diagnosticNumber(dnr && dnr.dynamic),
    'Session DNR rules: ' + diagnosticNumber(dnr && dnr.session),
    'Enabled static rulesets: ' + diagnosticNumber(dnr && dnr.staticSets),
    'Lists current: ' + diagnosticNumber(sources.succeeded)
      + '/' + diagnosticNumber(sources.total),
    'Publisher dates: ' + diagnosticNumber(recent) + ' recent, '
      + diagnosticNumber(stale) + ' over 30 days old, ' + diagnosticNumber(publisher.unknown) + ' unknown',
    'Last list fetch: ' + diagnosticDate(list.updated),
    'Site overrides: ' + Object.keys(overrides).length,
    'Last integrity check (Verify & Repair): ' + verifyStatus,
    '',
    'This report contains aggregate counts and states only. It omits URLs, site names, history, API keys and extension names.',
  ];
  return text.join('\n') + '\n';
}

async function diagnosticBrowser(nav) {
  try {
    if (nav.brave && await nav.brave.isBrave()) {
      const braveVersion = /\b(?:Chrome|Chromium)\/(\d+)\b/i.exec(String(nav.userAgent || ''));
      return braveVersion ? 'Brave (Chromium ' + braveVersion[1] + ')' : 'Brave (version unavailable)';
    }
  } catch (_) {}
  const brands = nav.userAgentData && nav.userAgentData.brands || [];
  for (const [pattern, name] of [[/Microsoft Edge/i, 'Microsoft Edge'], [/Google Chrome/i, 'Google Chrome'], [/Chromium/i, 'Chromium']]) {
    const found = brands.find((entry) => pattern.test(String(entry && entry.brand)));
    if (found && /^\d+$/.test(String(found.version))) return name + ' ' + found.version;
  }
  const ua = String(nav.userAgent || '');
  const found = /\b(Edg|Chrome)\/(\d+)\b/.exec(ua);
  return found ? (found[1] === 'Edg' ? 'Microsoft Edge ' : 'Chromium-based browser ') + found[2] : 'Unknown';
}

function diagnosticChromeCall(fn) {
  return new Promise((resolve) => {
    try { fn((result) => { const error = chrome.runtime.lastError; resolve(error ? null : result); }); }
    catch (_) { resolve(null); }
  });
}
async function prepareDiagnostics() {
  const tabs = await diagnosticChromeCall((done) => chrome.tabs.query({ active: true, currentWindow: true }, done));
  const tabId = tabs && tabs[0] && Number.isInteger(tabs[0].id) ? tabs[0].id : -1;
  const [health, saved, dynamic, session, staticSets, browser] = await Promise.all([
    diagnosticChromeCall((done) => chrome.runtime.sendMessage({ kind: 'protection-health', tabId }, done)),
    diagnosticChromeCall((done) => chrome.storage.local.get(['wardenone_config', 'wardenone_last_verification'], done)),
    diagnosticChromeCall((done) => chrome.declarativeNetRequest.getDynamicRules(done)),
    diagnosticChromeCall((done) => chrome.declarativeNetRequest.getSessionRules(done)),
    diagnosticChromeCall((done) => chrome.declarativeNetRequest.getEnabledRulesets(done)),
    diagnosticBrowser(navigator),
  ]);
  const manifest = chrome.runtime.getManifest();
  return buildDiagnosticsReport({
    health,
    config: saved && saved.wardenone_config,
    verification: saved && saved.wardenone_last_verification,
    dnr: { dynamic: Array.isArray(dynamic) ? dynamic.length : null,
      session: Array.isArray(session) ? session.length : null,
      staticSets: Array.isArray(staticSets) ? staticSets.length : null },
    browser, version: manifest.version,
    build: typeof woSourceCommit === 'function' ? woSourceCommit() : '', now: Date.now(),
  });
}

function setupDiagnosticsExport() {
  const prepare = document.getElementById('diagnostics-prepare');
  const download = document.getElementById('diagnostics-download');
  const preview = document.getElementById('diagnostics-preview');
  const status = document.getElementById('diagnostics-status');
  if (!prepare || !download || !preview || !status) return;
  let report = '';
  prepare.addEventListener('click', async () => {
    prepare.disabled = true;
    download.disabled = true;
    report = '';
    preview.hidden = true;
    status.textContent = 'Preparing local report…';
    try {
      report = await prepareDiagnostics();
      preview.textContent = report;
      preview.hidden = false;
      download.disabled = false;
      status.textContent = 'Review the report before sharing it.';
    } catch (_) {
      report = '';
      preview.hidden = true;
      status.textContent = 'Could not prepare the report. Try again.';
    } finally { prepare.disabled = false; }
  });
  download.addEventListener('click', () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wardenone-diagnostics.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  });
}
if (typeof document !== 'undefined') setupDiagnosticsExport();
if (typeof module !== 'undefined') module.exports = { buildDiagnosticsReport, diagnosticBrowser };

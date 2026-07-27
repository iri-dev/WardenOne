/*
 * Static regression checks for the user-trust surfaces:
 * - popup protection health panel
 * - recovery permission reset on cleanup actions
 * - richer Payment Guard explanations
 *
 * Run: node tools/test-protection-health.js
 */
'use strict';

const fs = require('fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error('[fail] ' + message);
    process.exit(1);
  }
}

const background = read('background.js');
const popupHtml = read('popup.html');
const popupJs = read('popup.js');
const content = read('src/content.js');
const manifest = JSON.parse(read('manifest.json'));

assert(manifest.version === '1.0.0', 'manifest version should be 1.0.0 for the stress-hardening release');

assert(/kind === 'protection-health'/.test(background), 'background should expose protection-health endpoint');
assert(/buildProtectionHealthSummary/.test(background), 'background should build protection health summary');
assert(/HEALTH_SHIELD_KEYS/.test(background), 'health summary should count active shields');
assert(/wardenone_history/.test(background) && /blocked24h/.test(background), 'health summary should report recent blocked count');
assert(/wardenone_list_meta/.test(background) && /SUPPLEMENTAL_LIST_META_KEY/.test(background), 'health summary should report list metadata');

assert(/<details class="health-panel" id="protection-health-panel"/.test(popupHtml), 'popup should render protection health as a collapsed details dropdown');
assert(/class="health-summary"/.test(popupHtml), 'popup health dropdown should have a compact summary row');
assert(popupHtml.indexOf('id="all-on"') >= 0 && popupHtml.indexOf('id="protection-health-panel"') > popupHtml.indexOf('id="all-on"'), 'health dropdown should sit below Turn everything on');
assert(/id="health-active-count"/.test(popupHtml), 'popup should show active shield count');
assert(/id="health-blocked-count"/.test(popupHtml), 'popup should show blocked count');
assert(/id="health-list-updated"/.test(popupHtml), 'popup should show list freshness');
assert(/function renderProtectionHealth/.test(popupJs), 'popup should render protection health');
assert(/kind: 'protection-health'/.test(popupJs), 'popup should request protection health');
assert(/function turnEverythingOn[\s\S]*querySelector\('input\[data-key="silentMode"\]'\)[\s\S]*checked = false/.test(popupJs), 'Turn everything on should restore visible safety feedback by disabling silent mode');
assert(/function turnEverythingOn[\s\S]*document\.querySelectorAll\('input\[data-key\]'\)/.test(popupJs), 'Turn everything on should cover every popup data-key toggle');
assert(/const status = cfg\.enabled === false \? 'Off'[\s\S]*'Check setup'[\s\S]*"You're safe"/.test(background), 'health status should use safer calm label');
assert(/severity === 'warn' && i\.topLevel/.test(background), 'non-critical notes should not force top-level attention state');
assert(/font-family:\s*var\(--display\);[\s\S]*font-size:\s*13px;[\s\S]*font-weight:\s*700;/.test(popupHtml), 'health title should use the popup display heading styling');
assert(/font:\s*800 15px\/1 var\(--display\)/.test(popupHtml), 'health stat numbers should use the bold display style shared with other popup stats');
assert(/\.health-title\s*\{[\s\S]*color:\s*var\(--plum\);[\s\S]*font-family:\s*var\(--display\);/.test(popupHtml), 'health title should use the soft plum accent like other popup labels');
assert(/background:\s*rgba\(142, 57, 191, 0\.1\)/.test(popupHtml), 'health chip should use a soft purple tint');
assert(/items\.length \? 'Notes' : 'Open'/.test(popupJs), 'health dropdown chip should use softer labels');

const keyBody = popupJs.match(/const KEYS = \[([\s\S]*?)\];/);
assert(keyBody, 'popup should define KEYS');
const knownKeys = new Set([...keyBody[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const dataKeys = [...popupHtml.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
const missingKeys = [...new Set(dataKeys.filter((key) => !knownKeys.has(key)))];
assert(!missingKeys.length, 'all popup data-key toggles should be saved by KEYS: ' + missingKeys.join(', '));

assert(/resetSitePermissionsForUrl/.test(background), 'background should have reusable site permission reset helper');
assert(/resetPanicPermissionDefaults/.test(background), 'background should reset sensitive prompt defaults on panic logout');
assert(/forget-site-now[\s\S]*permissionsReset/.test(background), 'Forget Me now should return permission reset results');
assert(/clear-site-data[\s\S]*permissionsReset/.test(background), 'site data cleanup should return permission reset results');
assert(/panic-logout[\s\S]*permissionsReset/.test(background), 'panic logout should return permission reset results');
assert(/permissionResetSummary/.test(popupJs), 'popup should explain permission reset results');
assert(/forget-site-now', host, url/.test(popupJs), 'Forget Me should send active tab URL for verified permission reset');

assert(/paymentRiskDetail/.test(content), 'Payment Guard should build structured warning detail');
assert(/paymentRiskDialog/.test(content), 'Payment Guard should use the richer confirm dialog');
assert(/Severity: /.test(content), 'Payment Guard warnings should include severity');
assert(/What to do:/.test(content), 'Payment Guard warnings should include next steps');
assert(/detail&&detail\.severity/.test(content), 'toast renderer should display dynamic severity');
assert(/detail&&detail\.action/.test(content), 'toast renderer should display dynamic action');

console.log('[ok] protection health and warning UX checks passed');

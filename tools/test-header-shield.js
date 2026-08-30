/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Expanded Header Shield regression coverage.
 *
 * Runs the real session-rule builder and pins the compatibility boundaries:
 * low-entropy UA hints are removed only for known third-party trackers, strict
 * referrer removal is opt-in, and cache validators are never disabled globally.
 *
 * Run: node tools/test-header-shield.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resourceTypes = require('./lib/resource-types.js');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function between(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  const to = source.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to <= from) throw new Error('source markers not found: ' + startMarker);
  return source.slice(from, to);
}

function headerNames(items) {
  return (items || []).map((item) => String(item.header || '').toLowerCase());
}

function makeHarness() {
  const updates = [];
  /* The lifted slice declares HEADER_SHIELD_RESOURCE_TYPES but the inventory it
     derives from is declared further up the file, outside the slice. Seed every
     resource-type list so the fragment resolves the same values the service
     worker would. */
  const sandbox = Object.assign({}, resourceTypes.resolveAll(BACKGROUND), {
    console,
    Promise,
    Set,
    Array,
    Object,
    String,
    Error,
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['login.example', 'pay.example'],
    normalizeAllowlistHost(value) {
      return String(value || '').trim().toLowerCase().replace(/^www\./, '');
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { condition: { requestDomains: ['metrics.example', 'connect.facebook.net'] } },
        { condition: { requestDomains: ['metrics.example', 'telemetry.example'] } },
      ],
    }),
    chrome: {
      runtime: { getURL: (file) => 'chrome-extension://test/' + file },
      declarativeNetRequest: {
        updateSessionRules: async (update) => { updates.push(update); },
      },
    },
  });
  vm.createContext(sandbox);
  const constants = between(
    BACKGROUND,
    'const CLIENT_HINT_HIGH_ENTROPY_RULE_ID =',
    'const IP_LOOKUP_BLOCK_RULE_BASE =',
  );
  const implementation = between(
    BACKGROUND,
    'let __packagedHeaderTrackerDomains = null;',
    '// Add or remove the rule that appends "DNT: 1"',
  );
  vm.runInContext(constants + implementation + '\nthis.__api = { applyHeaderShieldRules };', sandbox, {
    filename: 'background.js',
  });
  return { api: sandbox.__api, updates };
}

(async () => {
  const h = makeHarness();

  await h.api.applyHeaderShieldRules({ clientHints: true, strictReferrer: false, trackerCache: false });
  const clientUpdate = h.updates.at(-1);
  const broad = clientUpdate.addRules.find((rule) => rule.id === 900003);
  const tracker = clientUpdate.addRules.find((rule) => rule.id === 900004);
  const broadHeaders = headerNames(broad && broad.action.requestHeaders);
  const trackerHeaders = headerNames(tracker && tracker.action.requestHeaders);

  check('Client Hint protection installs a broad and a tracker-specific rule',
    clientUpdate.addRules.length === 2 && broad && tracker);
  check('broad protection removes requested high-entropy UA details',
    ['sec-ch-ua-full-version-list', 'sec-ch-ua-platform-version', 'sec-ch-ua-arch',
      'sec-ch-ua-bitness', 'sec-ch-ua-model'].every((name) => broadHeaders.includes(name)),
    JSON.stringify(broadHeaders));
  check('broad protection preserves low-entropy compatibility hints',
    ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].every((name) => !broadHeaders.includes(name)),
    JSON.stringify(broadHeaders));
  check('cross-site top-level navigations keep destination Client Hints for compatibility',
    !broad.condition.resourceTypes.includes('main_frame') &&
      tracker && !tracker.condition.resourceTypes.includes('main_frame'));
  check('low-entropy reduction is limited to known third-party trackers',
    tracker.condition.domainType === 'thirdParty' &&
      tracker.condition.requestDomains.join(',') === 'metrics.example,connect.facebook.net,telemetry.example' &&
      ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].every((name) => trackerHeaders.includes(name)));
  check('tracker host scope is preserved instead of broadened to a registrable domain',
    tracker.condition.requestDomains.includes('connect.facebook.net') &&
      !tracker.condition.requestDomains.includes('facebook.net'));
  check('Client Hint rules carry sign-in and payment exclusions',
    broad.condition.excludedRequestDomains.includes('login.example') &&
      tracker.condition.excludedRequestDomains.includes('pay.example') &&
      broad.condition.excludedInitiatorDomains.includes('login.example') &&
      tracker.condition.excludedInitiatorDomains.includes('pay.example'));
  check('known trackers cannot persist new Client Hint opt-ins',
    ['accept-ch', 'critical-ch'].every((name) =>
      headerNames(tracker.action.responseHeaders).includes(name)));

  await h.api.applyHeaderShieldRules({ clientHints: true, strictReferrer: true, trackerCache: true });
  const strictUpdate = h.updates.at(-1);
  const referrer = strictUpdate.addRules.find((rule) => rule.id === 900005);
  const cache = strictUpdate.addRules.find((rule) => rule.id === 900006);
  check('strict mode removes Referer only from third-party requests',
    referrer && referrer.condition.domainType === 'thirdParty' &&
      headerNames(referrer.action.requestHeaders).join(',') === 'referer');
  check('strict referrer mode keeps compatibility destinations excluded',
    referrer.condition.excludedRequestDomains.includes('login.example') &&
      referrer.condition.excludedRequestDomains.includes('pay.example') &&
      referrer.condition.excludedInitiatorDomains.includes('login.example'));
  check('cache defense removes both request and response validators',
    cache && headerNames(cache.action.requestHeaders).includes('if-none-match') &&
      headerNames(cache.action.responseHeaders).includes('etag'));
  check('cache defense is tracker-only and passive-resource-only',
    cache.condition.domainType === 'thirdParty' &&
      cache.condition.requestDomains.includes('metrics.example') &&
      cache.condition.resourceTypes.join(',') === 'image,xmlhttprequest' &&
      cache.condition.requestMethods.join(',') === 'get,head' &&
      cache.condition.excludedInitiatorDomains.includes('pay.example'));

  await h.api.applyHeaderShieldRules({ clientHints: false, strictReferrer: false, trackerCache: false });
  const disabled = h.updates.at(-1);
  check('turning Header Shield off removes every owned rule',
    disabled.addRules.length === 0 && disabled.removeRuleIds.join(',') === '900003,900004,900005,900006');

  const raced = makeHarness();
  const enable = raced.api.applyHeaderShieldRules({ clientHints: true, strictReferrer: true, trackerCache: true });
  const disable = raced.api.applyHeaderShieldRules({ clientHints: false, strictReferrer: false, trackerCache: false });
  await Promise.all([enable, disable]);
  const raceFinal = raced.updates.at(-1);
  check('rapid setting changes cannot leave stale Header Shield rules installed',
    raceFinal && raceFinal.addRules.length === 0 &&
      raceFinal.removeRuleIds.join(',') === '900003,900004,900005,900006');

  check('fresh installs use conservative Client Hint protection',
    /clientHintProtection:\s*true/.test(between(BACKGROUND, 'const DEFAULT_CONFIG =', '// ---- Onboarding protection bundles')));
  check('strict referrer and cache-validator modes stay off by default',
    /capReferrer:\s*false/.test(between(BACKGROUND, 'const DEFAULT_CONFIG =', '// ---- Onboarding protection bundles')) &&
      /trackerCacheProtection:\s*false/.test(between(BACKGROUND, 'const DEFAULT_CONFIG =', '// ---- Onboarding protection bundles')));
  check('Turn everything on does not silently opt into extra cache bandwidth',
    /MANUAL_ONLY_TOGGLES[^\n]*trackerCacheProtection/.test(POPUP));
  check('Maximum privacy explicitly enables the two strict modes',
    /const ONBOARDING_MAX_PRIVACY[\s\S]*?capReferrer:\s*true,[\s\S]*?trackerCacheProtection:\s*true,/.test(BACKGROUND));
  check('the popup exposes and explains all three Header Shield controls',
    ['clientHintProtection', 'capReferrer', 'trackerCacheProtection'].every((key) => POPUP_HTML.includes('data-key="' + key + '"')) &&
      POPUP_HTML.includes('navigator.userAgentData') && POPUP_HTML.includes('more bandwidth'));
  check('the redundant Chromium-default referrer DOM rewrite is gone',
    !CONTENT.includes('meta[name="referrer"][data-rg]') && !CONTENT.includes('capreferrer_on'));
  check('existing JavaScript UA hardening covers the matching high-entropy values',
    ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList']
      .every((key) => CONTENT.includes('"' + key + '"in out')) ||
      (CONTENT.includes('"architecture"in out') && CONTENT.includes('Array.isArray(out.fullVersionList)')));

  console.log('');
  if (failed) {
    console.error(failed + ' Header Shield check(s) failed');
    process.exit(1);
  }
  console.log('Header Shield stays selective and compatibility-first');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

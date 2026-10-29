/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Apply wide cookie stripping only to known tracker hosts while preserving federation exclusions.
   Run: node tools/test-tracker-cookie-rule.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installSessionIo } = require('./lib/dynamic-rule-io.js');
const resourceTypes = require('./lib/resource-types.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function harness(domains) {
  const state = { updates: [] };
  const sandbox = Object.assign({
    console, Promise, Set, Map, Array, Object, String, Number, Boolean, scheduleContentConfigRefresh() {},
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com', 'login.microsoftonline.com'],
    TRACKER_COOKIE_ALIAS_RULE_BASE: Number(BG.match(/const TRACKER_COOKIE_ALIAS_RULE_BASE = (\d+)/)[1]),
    TRACKER_COOKIE_ALIAS_RULES_BUDGET: Number(BG.match(/const TRACKER_COOKIE_ALIAS_RULES_BUDGET = (\d+)/)[1]),
    FIREWALL_RULE_BASE:950000,FIREWALL_RULE_MAX:250,FIREWALL_SESSION_RULE_BASE:960000,FIREWALL_SESSION_RULE_MAX:50,
    TRACKER_RULE_BASE:720000,TRACKER_RULE_MAX:1000,USER_RULE_BASE:750000,USER_RULE_MAX:500,
    MEDIA_COMPAT_DOMAINS: new Set(), activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: value => value,
    isProtectedTrackerDomain: () => false, isMediaCompatDomain: () => false,
    loadKnownAliases: async () => new Map(), WOCname: { compile: () => [] },
    packagedHeaderTrackerDomains: async () => (domains === undefined
      ? ['doubleclick.net', 'connect.facebook.net', 'scorecardresearch.com']
      : domains),
    chrome: {
      declarativeNetRequest: {
        async updateSessionRules(update) { state.updates.push(update); },
      },
    },
  }, resourceTypes.resolveAll(BG));

  const from = BG.indexOf('const TRACKER_COOKIE_RULE_ID');
  const to = BG.indexOf('// Read the setting and apply. Called on install/startup', from);
  assert(from > 0 && to > from, 'could not delimit the tracker cookie rule');

  vm.createContext(sandbox);
  installSessionIo(sandbox);
  vm.runInContext(BG.slice(from, to) + '\nthis.__api = { applyTrackerCookieRule, trackerCookieResourceTypes };',
    sandbox, { filename: 'background.js' });
  return { api: sandbox.__api, state };
}

const pending = [];

pending.push((async function theWideRuleIsScopedToTrackers() {
  const h = harness();
  await h.api.applyTrackerCookieRule(true);
  const rule = (h.state.updates[0].addRules || [])[0];
  check('a rule is installed', !!rule);
  if (!rule) return;

  /* The single condition that makes the wide types safe. Without it this is the
     blanket rule the narrow one exists to avoid being. */
  check('it names the tracker domains explicitly',
    Array.isArray(rule.condition.requestDomains) && rule.condition.requestDomains.length === 3,
    JSON.stringify(rule.condition.requestDomains));
  check('it is still third-party only', rule.condition.domainType === 'thirdParty');
  check('it removes Set-Cookie',
    rule.action.type === 'modifyHeaders'
      && rule.action.responseHeaders[0].header === 'set-cookie'
      && rule.action.responseHeaders[0].operation === 'remove');
  /* Belt and braces: if a host ever appears on both lists, sign-in wins. */
  check('login-compat hosts are excluded even here',
    (rule.condition.excludedRequestDomains || []).indexOf('accounts.google.com') >= 0);
}()));

pending.push((async function theWideRuleIsActuallyWide() {
  const h = harness();
  await h.api.applyTrackerCookieRule(true);
  const rules = h.state.updates[0].addRules;
  const types = [...new Set(rules.filter(rule=>rule.condition.domainType==='thirdParty'
    &&rule.condition.requestDomains?.includes('doubleclick.net')).flatMap(rule=>rule.condition.resourceTypes))];
  /* The types the narrow rule cannot have, and where tracker cookies really are. */
  ['sub_frame', 'script', 'xmlhttprequest', 'media', 'other', 'websocket'].forEach((t) => {
    check('the wide rule covers ' + t, types.indexOf(t) >= 0, JSON.stringify(types));
  });
  check('navigating to a tracker yourself is untouched', types.indexOf('main_frame') < 0);
  check('it is the security inventory minus main_frame',
    types.length === resourceTypes.resolve('SECURITY_RESOURCE_TYPES', BG).length - 1, String(types.length));
}()));

pending.push((async function anEmptyListInstallsNothing() {
  /* The failure that would turn this into the blanket wide rule: a requestDomains
     condition with an empty array matches every domain, not none. If the packaged
     list ever fails to load, the correct answer is no rule at all. */
  const h = harness([]);
  const result = await h.api.applyTrackerCookieRule(true);
  check('unavailable classification is reported', result === false);
  check('no rule is installed or removed without a tracker list', h.state.updates.length === 0);
}()));

pending.push((async function itCanBeTurnedOff() {
  const h = harness();
  await h.api.applyTrackerCookieRule(true);
  await h.api.applyTrackerCookieRule(false);
  const last = h.state.updates[h.state.updates.length - 1];
  check('turning it off removes the rule and adds none',
    (last.addRules || []).length === 0 && last.removeRuleIds.includes(900007));
}()));

pending.push((async function repeatedCallsDoNotRewrite() {
  const h = harness();
  await h.api.applyTrackerCookieRule(true);
  await h.api.applyTrackerCookieRule(true);
  check('an unchanged state is written once', h.state.updates.length === 1, String(h.state.updates.length));
}()));

// --- the narrow rule must stay narrow ---------------------------------------

(function theBlanketRuleIsUnchanged() {
  /* If someone later "fixes" the narrow rule by widening it, sign-in breaks on
     whichever provider they did not test. That is the whole reason the wide
     behaviour arrived as a separate, scoped rule instead. */
  const narrow = resourceTypes.resolve('THIRD_PARTY_COOKIE_RESOURCE_TYPES', BG);
  check('the blanket rule still covers image and ping only',
    narrow.length === 2 && narrow.indexOf('image') >= 0 && narrow.indexOf('ping') >= 0,
    JSON.stringify(narrow));
  ['sub_frame', 'script', 'xmlhttprequest'].forEach((t) => {
    check('the blanket rule still does not touch ' + t + ' (sign-in sets cookies there)',
      narrow.indexOf(t) < 0);
  });
}());

(function bothRulesShip() {
  check('the wide rule is applied with the same setting as the narrow one',
    /applyTrackerCookieRule\(on && cfg\.blockThirdPartyCookies !== false, cfg(?:, submitRules)?\)/.test(BG));
  check('it is applied on both the settings and refresh paths',
    (BG.match(/applyTrackerCookieRule\(on && cfg\.blockThirdPartyCookies !== false, cfg(?:, submitRules)?\)/g) || []).length >= 2);
  check('it is serialized with the other rule appliers',
    /'applyTrackerCookieRule'/.test(BG.slice(BG.indexOf('SERIALIZED_STATE_APPLIERS'))));
  check('it has its own rule id', /const TRACKER_COOKIE_RULE_ID = 900007/.test(BG));
}());


Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('tracker cookie rule: ' + pass + ' checks passed');
});

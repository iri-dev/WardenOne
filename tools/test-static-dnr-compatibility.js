/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Static DNR boundary and compatibility regressions.
 *
 * Run with:
 *   node tools/test-static-dnr-compatibility.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const FUNCTIONAL_RESOURCE_TYPES = [
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'xmlhttprequest',
  'media',
  'websocket',
];
const AUTH_CHALLENGE_DOMAINS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'apis.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'okta.com',
  'oktacdn.com',
  'auth0.com',
  'onelogin.com',
  'duosecurity.com',
  'openathens.net',
  'shibboleth.net',
  'pingidentity.com',
  'pingone.com',
  'b2clogin.com',
  'ciamlogin.com',
  'hcaptcha.com',
  'recaptcha.net',
  'challenges.cloudflare.com',
  'turnstile.cloudflare.com',
  'amazoncognito.com',
];
const VALID_RESOURCE_TYPES = new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other',
]);
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function domainListMatches(domains, rawHost) {
  const host = String(rawHost || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  return Array.from(domains || []).some((rawDomain) => {
    const domain = String(rawDomain || '').toLowerCase();
    return host === domain || host.endsWith('.' + domain);
  });
}

function conditionMatches(rule, requestHost, initiatorHost, resourceType) {
  const condition = rule.condition || {};
  if (condition.requestDomains && !domainListMatches(condition.requestDomains, requestHost)) return false;
  if (condition.initiatorDomains && !domainListMatches(condition.initiatorDomains, initiatorHost)) return false;
  return !condition.resourceTypes || condition.resourceTypes.includes(resourceType);
}

function ruleById(id) {
  const rule = rules.find((candidate) => candidate.id === id);
  assert(rule, 'missing rule ' + id);
  return rule;
}

function sorted(values) {
  return Array.from(values || []).sort();
}

const ids = new Set();
assert.strictEqual(rules.length, 130, 'unexpected static DNR rule count');
for (const rule of rules) {
  assert(Number.isInteger(rule.id) && rule.id > 0, 'invalid rule id');
  assert(!ids.has(rule.id), 'duplicate rule id ' + rule.id);
  ids.add(rule.id);
  assert(Number.isInteger(rule.priority) && rule.priority > 0, 'invalid priority on rule ' + rule.id);
  assert(rule.action && ['allow', 'block'].includes(rule.action.type), 'invalid action on rule ' + rule.id);
  assert(rule.condition && typeof rule.condition === 'object', 'missing condition on rule ' + rule.id);
  assert(Array.isArray(rule.condition.resourceTypes) && rule.condition.resourceTypes.length,
    'missing resource types on rule ' + rule.id);
  for (const type of rule.condition.resourceTypes) {
    assert(VALID_RESOURCE_TYPES.has(type), `invalid resource type ${type} on rule ${rule.id}`);
  }
  for (const field of ['requestDomains', 'initiatorDomains']) {
    if (!Object.prototype.hasOwnProperty.call(rule.condition, field)) continue;
    assert(Array.isArray(rule.condition[field]) && rule.condition[field].length,
      `${field} must be a non-empty array on rule ${rule.id}`);
    for (const domain of rule.condition[field]) {
      assert.strictEqual(typeof domain, 'string', `non-string ${field} entry on rule ${rule.id}`);
      assert(HOST.test(domain) && domain.includes('.') && !domain.includes('..'),
        `invalid ${field} entry ${domain} on rule ${rule.id}`);
      assert(!domainListMatches([domain], domain + '.evil.example'),
        `${field} entry ${domain} leaks into a hostile suffix`);
    }
  }
}

const hostBlocks = rules.filter((rule) => rule.action.type === 'block');
assert.strictEqual(hostBlocks.length, 125, 'expected exactly 125 static block rules');
for (const rule of hostBlocks) {
  assert.deepStrictEqual(Object.keys(rule.condition).sort(), ['requestDomains', 'resourceTypes']);
  assert.strictEqual(rule.condition.requestDomains.length, 1, 'block rule must cover one reviewed host');
  assert(!Object.prototype.hasOwnProperty.call(rule.condition, 'urlFilter'),
    'exact host block still uses an unsafe URL filter on rule ' + rule.id);
}
assert(!rules.some((rule) => /^\|\|[a-z0-9-]+\.$/i.test(String(rule.condition.urlFilter || ''))),
  'TLD-agnostic label hard block remains');
const remainingUrlFilters = rules.filter((rule) => rule.condition.urlFilter);
assert.deepStrictEqual(remainingUrlFilters.map((rule) => rule.id), [163],
  'only the reviewed path-specific compatibility filter may remain a URL filter');
assert.strictEqual(remainingUrlFilters[0].condition.urlFilter,
  '||static.doubleclick.net/instream/ad_status.js');

const grabifyRule = ruleById(1);
assert(conditionMatches(grabifyRule, 'sub.grabify.link', 'example.com', 'script'));
assert(!conditionMatches(grabifyRule, 'grabify.link.evil.example', 'example.com', 'script'),
  'grabify.link block leaked into a hostile suffix');

const compatibilityRules = [ruleById(164), ruleById(165), ruleById(166)];
for (const rule of compatibilityRules) {
  assert.strictEqual(rule.priority, 3000);
  assert.strictEqual(rule.action.type, 'allow');
  assert(Array.isArray(rule.condition.requestDomains) && rule.condition.requestDomains.length);
  assert(Array.isArray(rule.condition.initiatorDomains) && rule.condition.initiatorDomains.length);
  assert.deepStrictEqual(sorted(rule.condition.resourceTypes), sorted(FUNCTIONAL_RESOURCE_TYPES));
  for (const forbidden of ['main_frame', 'ping', 'object']) {
    assert(!rule.condition.resourceTypes.includes(forbidden), `${forbidden} leaked into rule ${rule.id}`);
  }
}

const githubRule = ruleById(164);
assert(!githubRule.condition.requestDomains.includes('github.io'), 'github.io must not receive a blanket allow');
assert(!githubRule.condition.requestDomains.includes('githubusercontent.com'),
  'the whole multi-tenant githubusercontent.com suffix must not be allowed');
assert(conditionMatches(githubRule, 'raw.githubusercontent.com', 'github.com', 'xmlhttprequest'));
assert(!conditionMatches(githubRule, 'raw.githubusercontent.com', 'evil.example', 'xmlhttprequest'));
assert(!conditionMatches(githubRule, 'raw.githubusercontent.com.evil.example', 'github.com', 'xmlhttprequest'));

const googleRule = ruleById(165);
assert(conditionMatches(googleRule, 'drive.googleusercontent.com', 'drive.google.com', 'media'));
assert(!conditionMatches(googleRule, 'drive.googleusercontent.com', 'evil.example', 'media'),
  'multi-tenant Google content was globally allowed');
assert(!conditionMatches(googleRule, 'drive.googleusercontent.com.evil.example', 'drive.google.com', 'media'));
assert(!conditionMatches(googleRule, 'drive.googleusercontent.com', 'drive.google.com.evil.example', 'media'));

const gameDriveRule = ruleById(166);
assert(conditionMatches(gameDriveRule, 'cdn.gamedrive.org', 'gamedrive.org', 'script'));
assert(!conditionMatches(gameDriveRule, 'cdn.gamedrive.org', 'evil.example', 'script'));

const authRule = ruleById(167);
assert.strictEqual(authRule.priority, 3000);
assert.strictEqual(authRule.action.type, 'allow');
assert(!Object.prototype.hasOwnProperty.call(authRule.condition, 'initiatorDomains'),
  'cross-site authentication compatibility must not be tied to one relying party');
assert.deepStrictEqual(sorted(authRule.condition.requestDomains), sorted(AUTH_CHALLENGE_DOMAINS));
assert.deepStrictEqual(sorted(authRule.condition.resourceTypes), sorted(FUNCTIONAL_RESOURCE_TYPES));
for (const forbidden of ['main_frame', 'ping', 'object']) {
  assert(!authRule.condition.resourceTypes.includes(forbidden), `${forbidden} leaked into auth compatibility`);
}
assert(conditionMatches(authRule, 'js.hcaptcha.com', 'portal.ac.uk', 'script'));
assert(conditionMatches(authRule, 'accounts.google.com', 'portal.ac.uk', 'sub_frame'));
assert(!conditionMatches(authRule, 'accounts.google.com.evil.example', 'portal.ac.uk', 'sub_frame'));
assert(!conditionMatches(authRule, 'accounts.google.com', 'portal.ac.uk', 'main_frame'));
assert(!conditionMatches(authRule, 'hcaptcha.com', 'portal.ac.uk', 'ping'));

const manifestExclusions = (manifest.content_scripts || [])
  .flatMap((entry) => entry.exclude_matches || [])
  .map(String);
for (const domain of AUTH_CHALLENGE_DOMAINS) {
  const covered = manifestExclusions.some((pattern) => {
    const match = pattern.match(/^https:\/\/(?:\*\.)?([^/*]+)\/\*$/i);
    return match && match[1].toLowerCase() === domain;
  });
  assert(covered, domain + ' is not backed by an existing manifest exclusion');
}

console.log('[ok] 130 static DNR rules validated: 125 bounded blocks, scoped compatibility, and auth/challenge coverage.');

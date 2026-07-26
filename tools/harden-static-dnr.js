/*
 * Deterministically harden WebWarden's small hand-maintained static ruleset.
 *
 * Run with:
 *   node tools/harden-static-dnr.js [--check]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'rules.json');
const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));

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

const exactHostFilter = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)$/i;
const tldAgnosticLabelFilter = /^\|\|[a-z0-9-]+\.$/i;
const exactHostRules = rules.filter((rule) =>
  rule.action && rule.action.type === 'block'
    && rule.condition
    && exactHostFilter.test(String(rule.condition.urlFilter || '')));
const genericLabelRules = rules.filter((rule) =>
  rule.action && rule.action.type === 'block'
    && rule.condition
    && tldAgnosticLabelFilter.test(String(rule.condition.urlFilter || '')));

// The source pack has a deliberately fixed shape. Refuse a partial or surprising
// rewrite, while still allowing the tool to be run again after hardening.
if (exactHostRules.length !== 0 && exactHostRules.length !== 125) {
  throw new Error(`Expected 125 exact-host URL filters, found ${exactHostRules.length}`);
}
if (genericLabelRules.length !== 0 && genericLabelRules.length !== 37) {
  throw new Error(`Expected 37 TLD-agnostic label filters, found ${genericLabelRules.length}`);
}

const replacementIds = new Set([164, 165, 166, 167]);
const hardened = rules
  .filter((rule) => !genericLabelRules.includes(rule) && !replacementIds.has(rule.id))
  .map((rule) => {
    const match = exactHostFilter.exec(String(rule.condition && rule.condition.urlFilter || ''));
    if (!match || !rule.action || rule.action.type !== 'block') return rule;
    const condition = Object.assign({}, rule.condition);
    delete condition.urlFilter;
    condition.requestDomains = [match[1].toLowerCase()];
    return Object.assign({}, rule, { condition });
  });

hardened.push(
  {
    id: 164,
    priority: 3000,
    action: { type: 'allow' },
    condition: {
      initiatorDomains: ['github.com'],
      requestDomains: [
        'github.com',
        'githubassets.com',
        'raw.githubusercontent.com',
        'objects.githubusercontent.com',
        'avatars.githubusercontent.com',
        'camo.githubusercontent.com',
        'media.githubusercontent.com',
        'user-images.githubusercontent.com',
      ],
      resourceTypes: FUNCTIONAL_RESOURCE_TYPES,
    },
  },
  {
    id: 165,
    priority: 3000,
    action: { type: 'allow' },
    condition: {
      initiatorDomains: ['google.com'],
      requestDomains: [
        'google.com',
        'googleapis.com',
        'gstatic.com',
        'googleusercontent.com',
      ],
      resourceTypes: FUNCTIONAL_RESOURCE_TYPES,
    },
  },
  {
    id: 166,
    priority: 3000,
    action: { type: 'allow' },
    condition: {
      initiatorDomains: ['gamedrive.org'],
      requestDomains: ['gamedrive.org'],
      resourceTypes: FUNCTIONAL_RESOURCE_TYPES,
    },
  },
  {
    id: 167,
    priority: 3000,
    action: { type: 'allow' },
    condition: {
      requestDomains: AUTH_CHALLENGE_DOMAINS,
      resourceTypes: FUNCTIONAL_RESOURCE_TYPES,
    },
  },
);

hardened.sort((a, b) => a.id - b.id);

const hardenedBlocks = hardened.filter((rule) =>
  rule.action && rule.action.type === 'block'
    && rule.condition
    && Array.isArray(rule.condition.requestDomains));
if (hardenedBlocks.length !== 125) {
  throw new Error(`Expected 125 bounded block rules after rewrite, found ${hardenedBlocks.length}`);
}
if (hardened.some((rule) => tldAgnosticLabelFilter.test(String(rule.condition && rule.condition.urlFilter || '')))) {
  throw new Error('TLD-agnostic label filters remain after rewrite');
}

const output = JSON.stringify(hardened, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(RULES_PATH, 'utf8') !== output) {
    console.error('rules.json is not in the hardened deterministic form');
    process.exit(1);
  }
  console.log(`Checked ${hardened.length} rules: ${hardenedBlocks.length} bounded host blocks, 0 generic label blocks.`);
} else {
  fs.writeFileSync(RULES_PATH, output);
  console.log(`Wrote ${hardened.length} rules: ${hardenedBlocks.length} bounded host blocks, 0 generic label blocks.`);
}

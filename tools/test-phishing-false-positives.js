/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Regression checks for phishing false positives on official brand infrastructure.
 *
 * Run: node tools/test-phishing-false-positives.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const source = fs.readFileSync('src/content.js', 'utf8');
const min = fs.readFileSync('content.min.js', 'utf8');
const startup = fs.readFileSync('background-startup.js', 'utf8');
const brandStart = source.indexOf('const BRANDS={');
const brandEnd = brandStart >= 0 ? source.indexOf('};\n      try{', brandStart) : -1;
assert(brandStart >= 0 && brandEnd > brandStart, 'content phishing brand table not found');
const brandBlock = source.slice(brandStart, brandEnd);

function contentBrandDomains(brand) {
  const match = brandBlock.match(new RegExp('\\b' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\[([\\s\\S]*?)\\]'));
  assert(match, 'missing content brand entry: ' + brand);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function hasDomain(list, domain) {
  return list.includes(domain);
}

function checkContentBrand(brand, domains) {
  const list = contentBrandDomains(brand);
  domains.forEach((domain) => {
    assert(hasDomain(list, domain), brand + ' should trust official domain ' + domain);
    assert(min.includes(domain), 'runtime content bundle should include ' + domain);
  });
}

checkContentBrand('paypal', ['paypalobjects.com']);
checkContentBrand('google', ['g.co', 'goo.gle', 'withgoogle.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com']);
checkContentBrand('amazon', ['amazon.co.jp', 'amazon.com.au', 'amazonpay.com', 'amzn.com']);
checkContentBrand('microsoft', ['microsoft365.com', 'sharepoint.com', 'onmicrosoft.com', 'msftauth.net', 'msauth.net', 'aka.ms']);
checkContentBrand('facebook', ['meta.com', 'facebookmail.com', 'fbcdn.net']);
checkContentBrand('github', ['githubusercontent.com', 'githubassets.com', 'github.io']);
checkContentBrand('dropbox', ['dropboxusercontent.com']);
checkContentBrand('twitch', ['ttvnw.net', 'jtvnw.net', 'twitchcdn.net']);
checkContentBrand('chase', ['jpmorganchase.com']);

function regDomainBg(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (/^(co|com|org|net|gov|ac)\.[a-z]{2}$/i.test(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

const sandbox = {
  console,
  setTimeout() {},
  DEFAULT_CONFIG: {},
  BLOCKED_DOMAINS: new Set(),
  EXT_BASELINE_KEY: 'test-baseline',
  regDomainBg,
  localGet: async () => ({}),
  localSet: async () => {},
  snapshotExtensionBaseline: async () => {},
  chrome: {
    runtime: { onStartup: { addListener() {} } },
    tabs: { query: async () => [] },
    management: { getAll: async () => [] },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    notifications: { create() {} },
  },
  globalThis: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
  installEngineAmbient(sandbox);
vm.runInContext(startup + '\nglobalThis.__phishingTest = { loginRiskVerdict, looksLikeLookalikeHost };', sandbox, { filename: 'background-startup.js' });

const officialStartupHosts = [
  'login.microsoft365.com',
  'secure.msftauth.net',
  'tenant.sharepoint.com',
  'contoso.onmicrosoft.com',
  'accounts.paypalobjects.com',
  'static.googleusercontent.com',
  'apis.googleapis.com',
  'facebookmail.com',
  'assets.githubusercontent.com',
  'static.dropboxusercontent.com',
  'pay.amazonpay.com',
  'www.amazon.co.jp',
  'secure.jpmorganchase.com',
];

officialStartupHosts.forEach((host) => {
  const verdict = sandbox.__phishingTest.loginRiskVerdict(host, 'https://' + host + '/login', null, 14);
  assert.strictEqual(verdict.risky, false, host + ' should not be treated as a login phishing domain');
  assert.strictEqual(sandbox.__phishingTest.looksLikeLookalikeHost(host), false, host + ' should not be a startup lookalike');
});

const risky = sandbox.__phishingTest.loginRiskVerdict('paypa1.com', 'https://paypa1.com/login', null, 14);
assert.strictEqual(risky.risky, true, 'obvious PayPal typo should still be risky');

console.log('[ok] phishing false-positive checks passed');

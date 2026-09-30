/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const STARTUP = fs.readFileSync(path.join(ROOT, 'background-startup.js'), 'utf8');
const DOMAIN = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const idnStart = DOMAIN.indexOf('const WARDENONE_IDN_CONFUSABLES');
const idnEnd = DOMAIN.indexOf('function regDomain(', idnStart);
assert(idnStart >= 0 && idnEnd > idnStart, 'shared IDN helper has moved');
const PATHS = ['/login', '/verify', '/account', '/oauth'];

function regDomainBg(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

const workerWorld = {
  console, setTimeout() {}, DEFAULT_CONFIG: {}, BLOCKED_DOMAINS: new Set(),
  EXT_BASELINE_KEY: 'test-baseline', regDomainBg,
  localGet: async () => ({}), localSet: async () => {},
  snapshotExtensionBaseline: async () => {},
  chrome: {
    runtime: { onStartup: { addListener() {} } },
    tabs: { query: async () => [] }, management: { getAll: async () => [] },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    notifications: { create() {} },
  },
};
workerWorld.globalThis = workerWorld;
vm.createContext(workerWorld);
vm.runInContext(DOMAIN.slice(idnStart, idnEnd), workerWorld);
installEngineAmbient(workerWorld);
vm.runInContext(STARTUP + '\nglobalThis.verdict = loginRiskVerdict;', workerWorld,
  { filename: 'background-startup.js' });

function worker(host, pathname, ageDays) {
  const age = ageDays === null ? null : { ageDays };
  return workerWorld.verdict(host, 'https://' + host + pathname, age, 30);
}

const first = CONTENT.indexOf('const trapTypedFields=new WeakSet,');
const last = CONTENT.indexOf('showTrapPanel=reasons=>{', first);
assert(first >= 0 && last > first, 'form scoring slice has moved');
const scoreBlock = 'const ' + CONTENT.slice(first + 'const '.length, last) + '__end=0;';
const brandFirst = CONTENT.indexOf('BRAND_LOGIN={');
const brandLast = CONTENT.indexOf('isOverlay=el=>{', brandFirst);
assert(brandFirst >= 0 && brandLast > brandFirst, 'form brand claim slice has moved');
const brandBlock = 'const ' + CONTENT.slice(brandFirst, brandLast) + '__brandEnd=0;';
const threshold = Number((CONTENT.match(/TRAP_THRESHOLD=(\d+)/) || [])[1]);
assert.strictEqual(threshold, 5, 'path corroboration is calibrated for a five-point warning');

function formScore(url, claim, options) {
  const parsed = new URL(url);
  const o = options || {};
  const form = {
    textContent: o.formText || claim + ' Email Password',
    querySelectorAll: () => [{ textContent: o.heading || claim }],
    getAttribute: () => '',
    action: '',
    parentElement: null,
  };
  const field = {
    type: 'password', value: '', parentElement: form,
    closest: (selector) => selector === 'form' ? form : null,
    getBoundingClientRect: () => ({ width: 180, height: 28, left: 40, top: 200, right: 220, bottom: 228 }),
  };
  const world = {
    String, Number, RegExp, WeakSet, Boolean, Array, Object, Math, URL, console,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static' }),
    window: { innerWidth: 1280, innerHeight: 800 },
    document: { body: {}, querySelectorAll: () => [field] },
    location: { href: url, hostname: parsed.hostname, pathname: parsed.pathname, protocol: parsed.protocol },
    regHost: (host) => String(host || '').toLowerCase(), here: parsed.hostname,
    rawIp: () => false,
    sibling: (host, domain) => host === domain || host.endsWith('.' + domain),
    isAuthProvider: () => false, onGrabberList: () => false,
    isOverlay: () => false,
    injectedForms: { has: () => false }, WO: { __pageRisk: null },
  };
  vm.createContext(world);
  vm.runInContext(brandBlock + '\n' + scoreBlock + '\nglobalThis.score = scoreForm;', world,
    { filename: 'src/content.js:form-score' });
  return world.score(field);
}

for (const pathname of PATHS) {
  for (const [host, ownClaim] of [
    ['disboard.org', 'Sign in to Disboard'],
    ['discordbotlist.com', 'Sign in to Discord Bot List'],
    ['steamrip.com', 'Sign in to SteamRIP'],
  ]) {
    assert.strictEqual(worker(host, pathname, 900).hardBlock, false,
      host + pathname + ' must not be blocked for its own account path');
    assert(formScore('https://' + host + pathname, ownClaim).score < threshold,
      host + pathname + ' own account form must stay below the warning threshold');
  }
  for (const [host, brand] of [
    ['discord-help.example', 'Discord'],
    ['steam-support.example', 'Steam'],
    ['identity.example', 'Google'],
    ['signin.example', 'Microsoft'],
    ['payment.example', 'PayPal'],
    ['orders.example', 'Amazon'],
  ]) {
    assert.strictEqual(worker(host, pathname, 900).hardBlock, false,
      host + pathname + ' path alone must not cause a hard block');
    const claimed = formScore('https://' + host + pathname, 'Sign in to ' + brand);
    assert(claimed.score >= threshold && claimed.reasons.some((reason) => reason.toLowerCase().includes('claims to be ' + brand.toLowerCase())),
      host + pathname + ' needs a warning when its password form claims ' + brand);
    assert(formScore('https://' + host + pathname, 'Sign in to this site').score < threshold,
      host + pathname + ' without a brand claim must not warn from the path alone');
  }
  for (const host of ['discord.com', 'steamcommunity.com', 'accounts.google.com']) {
    assert.strictEqual(worker(host, pathname, 900).hardBlock, false,
      host + pathname + ' official login must stay clear');
  }
  for (const host of ['d1scord.example', 'discord-login.example', 'discord.evil.example']) {
    assert(worker(host, pathname, 900).hardBlock,
      host + pathname + ' deceptive host must still warn regardless of path');
  }
  assert(worker('identity.example', pathname, 2).hardBlock,
    'a new domain with a password field must still warn on ' + pathname);
}

for (const pathname of ['/', '/help/login-guide', '/login-help']) {
  assert(formScore('https://identity.example' + pathname, 'Sign in to Google').score < threshold,
    pathname + ' is not an exact sign-in path segment');
}
for (const pathname of ['/Login', '/l%6Fgin', '/login.php', '/oauth2', '/verify.html']) {
  assert(formScore('https://identity.example' + pathname, 'Sign in to Google').score >= threshold,
    pathname + ' must not bypass a claimed-brand sign-in warning');
}
assert(formScore('https://identity.example/login?next=/oauth#verify', 'Sign in to Google').score >= threshold,
  'query and fragment do not erase a real login path');
assert(formScore('https://identity.example/login', 'Google account login').score >= threshold,
  'an explicit brand account heading still corroborates the login path');
assert(formScore('https://identity.example/?next=/login#verify', 'Sign in to Google').score < threshold,
  'query and fragment words are not path intent');
assert(formScore('https://identity.example/oauth', 'Continue to Google').score < threshold,
  'an OAuth redirect label is not a claim that the host is Google');
assert(formScore('https://identity.example/login', 'Sign in to this site', {
  formText: 'Sign in to this site Email Password Google login',
}).score < threshold, 'a Google OAuth button beside the site own password field is not a Google claim');

console.log('[ok] phishing path intent: four path segments, brand claims, own logins, official hosts and deceptive hosts');

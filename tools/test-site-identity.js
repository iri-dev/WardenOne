/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/*
 * Shared-host identity regression tests.
 *
 * A platform suffix is not a site. These checks pin that trust, cookie controls,
 * allowlists and learned-block exceptions cannot cross from one tenant to another.
 * Run: node tools/test-site-identity.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DOMAIN = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const ANTI = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function grabFn(source, name) {
  const at = source.indexOf('function ' + name);
  assert(at >= 0, name + ' is missing');
  let depth = 0;
  let opened = false;
  for (let i = at; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') {
      depth--;
      if (opened && depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(name + ' is unterminated');
}

function loadDomainApi() {
  const sandbox = { URL, Set, Object, String, Array };
  vm.createContext(sandbox);
  vm.runInContext(DOMAIN + '\nthis.api={regDomain,registrableDomain,sameSiteDomain,sharedTenantSuffix,isSharedTenantHost,hostMatchesSite};', sandbox);
  return sandbox.api;
}

const domain = loadDomainApi();
assert.strictEqual(domain.registrableDomain('www.shop.example.com'), 'example.com');
assert.strictEqual(domain.registrableDomain('portal.example.co.uk'), 'example.co.uk');
assert.strictEqual(domain.registrableDomain('https://Sub.Alice.GitHub.io:443/path'), 'alice.github.io');
assert.strictEqual(domain.registrableDomain('sub.alice.github.io'), 'alice.github.io');
assert.strictEqual(domain.registrableDomain('bob.github.io'), 'bob.github.io');
assert.strictEqual(domain.sameSiteDomain('sub.alice.github.io', 'alice.github.io'), true);
assert.strictEqual(domain.sameSiteDomain('alice.github.io', 'bob.github.io'), false);
assert.strictEqual(domain.sameSiteDomain('one.pages.dev', 'two.pages.dev'), false);
assert.strictEqual(domain.sameSiteDomain('one.netlify.app', 'two.netlify.app'), false);
assert.strictEqual(domain.registrableDomain('bucket.s3.eu-west-2.amazonaws.com'), 'bucket.s3.eu-west-2.amazonaws.com');
assert.strictEqual(domain.sameSiteDomain('bucket-a.s3.amazonaws.com', 'bucket-b.s3.amazonaws.com'), false);
assert.strictEqual(domain.sameSiteDomain('d111.cloudfront.net', 'd222.cloudfront.net'), false);
assert.strictEqual(domain.hostMatchesSite('docs.alice.github.io', 'alice.github.io'), true);
assert.strictEqual(domain.hostMatchesSite('bob.github.io', 'alice.github.io'), false);
assert.strictEqual(domain.hostMatchesSite('alice.github.io', 'github.io'), false);
assert.strictEqual(domain.hostMatchesSite('child.bucket.s3.amazonaws.com', 'bucket.s3.amazonaws.com'), false);
assert.strictEqual(domain.hostMatchesSite('login.example.com', 'example.com'), true);

const partySandbox = { URL, Set, Object, String, Array };
vm.createContext(partySandbox);
vm.runInContext(DOMAIN + '\n' + grabFn(ANTI, 'regHost') + '\n' + grabFn(ANTI, 'baseDomain') + '\n'
  + grabFn(ANTI, 'sameParty') + '\nthis.sameParty=sameParty;', partySandbox);
assert.strictEqual(partySandbox.sameParty('app.example.com', 'login.example.com'), true);
assert.strictEqual(partySandbox.sameParty('docs.alice.github.io', 'auth.alice.github.io'), true);
assert.strictEqual(partySandbox.sameParty('alice.github.io', 'bob.github.io'), false);
assert.strictEqual(partySandbox.sameParty('bucket.s3.amazonaws.com', 'child.bucket.s3.amazonaws.com'), false);

const patternSandbox = { URL, Set, Object, String, Array };
vm.createContext(patternSandbox);
vm.runInContext(
  DOMAIN
    + '\nfunction registrableDomainBg(host){return registrableDomain(host);}\n'
    + grabFn(BACKGROUND, 'siteContentSettingPatterns') + '\n'
    + grabFn(BACKGROUND, 'cookieContentSettingPatterns')
    + '\nthis.api={siteContentSettingPatterns,cookieContentSettingPatterns};',
  patternSandbox,
);
const aliceCookies = Array.from(patternSandbox.api.cookieContentSettingPatterns('https://docs.alice.github.io/account'));
assert(aliceCookies.includes('https://*.alice.github.io/*'));
assert(!aliceCookies.includes('https://*.github.io/*'));
const s3Cookies = Array.from(patternSandbox.api.cookieContentSettingPatterns('https://bucket.s3.amazonaws.com/object'));
assert(!s3Cookies.includes('https://*.amazonaws.com/*'));
assert(!s3Cookies.includes('https://*.s3.amazonaws.com/*'));
const ordinaryCookies = Array.from(patternSandbox.api.cookieContentSettingPatterns('https://login.example.com/'));
assert(ordinaryCookies.includes('https://*.example.com/*'));

const neverStart = BACKGROUND.indexOf('const NEVER_BLOCK_DOMAINS');
const neverEnd = BACKGROUND.indexOf('// High-priority DNR allow rules', neverStart);
assert(neverStart >= 0 && neverEnd > neverStart, 'never-block policy markers moved');
const neverSandbox = { URL, Set, Object, String, Array };
vm.createContext(neverSandbox);
vm.runInContext(
  DOMAIN + '\nconst LOGIN_COMPAT_NEVER_BLOCK_DOMAINS=[];\n'
    + BACKGROUND.slice(neverStart, neverEnd)
    + '\nthis.isNeverBlockDomain=isNeverBlockDomain;',
  neverSandbox,
);
const never = neverSandbox.isNeverBlockDomain;
assert.strictEqual(never('github.io'), true, 'a platform-apex feed rule could block every tenant');
assert.strictEqual(never('phish-kit.github.io'), false, 'an unrelated GitHub Pages tenant became unblockable');
assert.strictEqual(never('iri-dev.github.io'), true, 'the project tenant lost its exact exception');
assert.strictEqual(never('docs.iri-dev.github.io'), true, 'the project tenant exception lost its subdomain');
assert.strictEqual(never('githubusercontent.com'), true, 'shared delivery apex is not protected from broad feed rules');
assert.strictEqual(never('evil.githubusercontent.com'), false, 'all Google/GitHub user-content tenants became trusted');
assert.strictEqual(never('raw.githubusercontent.com'), true, 'known GitHub delivery infrastructure lost protection');
assert.strictEqual(never('ordinary.s3.amazonaws.com'), false, 'every S3 customer became unblockable');
assert.strictEqual(never('github-cloud.s3.amazonaws.com'), true, 'GitHub upload infrastructure lost its narrow exception');

const scripts = MANIFEST.content_scripts || [];
const antiEntry = scripts.find((entry) => Array.isArray(entry.js) && entry.js.includes('anti-redirect.js'));
assert(antiEntry, 'anti-redirect content-script entry is missing');
assert.deepStrictEqual(antiEntry.js.slice(-2), ['domain-utils.js', 'anti-redirect.js']);
const bridgeEntry = scripts.find((entry) => Array.isArray(entry.js) && entry.js.includes('bridge.js'));
assert(bridgeEntry, 'bridge content-script entry is missing');
assert.deepStrictEqual(bridgeEntry.js.slice(-2), ['domain-utils.js', 'bridge.js']);

const repair = grabFn(BACKGROUND, 'repairMainWorldFilesForUrl');
assert(repair.indexOf("add('domain-utils.js')") < repair.indexOf("add('content.min.js')"));
assert(repair.indexOf("add('domain-utils.js')") < repair.indexOf("add('anti-redirect.js')"));
assert(!/TRUSTED_BASE_DOMAINS[\s\S]*?'amazonaws\.com'/.test(ANTI.slice(0, ANTI.indexOf('function cfg'))));
assert(ANTI.includes('hostMatchesSite(host, base)'), 'top-frame trusted-host checks bypass shared identity');
assert(ANTI.includes('hostMatchesSite(clean, base)'), 'credential-frame trusted-host checks bypass shared identity');
assert(BRIDGE.includes('hostMatchesSite(h, item)'), 'isolated allowlist checks bypass shared identity');

console.log('site identity tests passed');

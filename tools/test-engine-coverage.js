/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const bg = read('background.js');
const src = read('src/content.js');
const popup = read('popup.js');
const matcherStart = bg.indexOf('function urlMatchesManifestPattern(');
const matcherEnd = bg.indexOf('async function verifyEngineInTab(', matcherStart);
const repairStart = bg.indexOf('function isMainWorldRepairExcludedUrl(');
const repairEnd = bg.indexOf('\n}\n', repairStart) + 2;
assert(matcherStart > 0 && matcherEnd > matcherStart && repairStart > 0 && repairEnd > repairStart);
const worker = vm.createContext({ URL, chrome: { runtime: { getManifest: () => manifest } } });
vm.runInContext(read('engine-compat.js'), worker);
vm.runInContext(bg.slice(matcherStart, matcherEnd) + '\n' + bg.slice(repairStart, repairEnd)
  + '\nthis.excluded=(url)=>engineExcludedByManifest(url)||wardenOneEngineLoginUrl(url); this.repairExcluded=isMainWorldRepairExcludedUrl;', worker);

const contentPages = [
  'https://docs.google.com/forms/d/e/example/viewform',
  'https://docs.google.com/forms/u/0/d/e/example/formResponse',
  'https://docs.google.com/document/d/example/edit',
  'https://docs.google.com/spreadsheets/d/example/edit',
  'https://drive.google.com/file/d/example/view',
  'https://drive.google.com/drive/u/0/my-drive',
  ...['okta.com', 'auth0.com', 'onelogin.com', 'duosecurity.com', 'pingone.com', 'b2clogin.com',
    'ciamlogin.com', 'amazoncognito.com', 'shopify.com'].flatMap((domain) => [
    'https://tenant.' + domain + '/content/shared-page',
    'https://' + domain + '/docs/guide',
  ]),
];
const loginPages = [
  'https://accounts.google.com/v3/signin/identifier',
  'https://tenant.okta.com/', 'https://tenant.okta.com/?fromURI=app',
  'https://tenant.okta.com/login/login.htm', 'https://tenant.okta.com/signin/verify/okta',
  'https://tenant.okta.com/oauth2/default/v1/authorize?client_id=example',
  'https://tenant.okta.com/app/example/key/sso/saml',
  'https://tenant.auth0.com/authorize?client_id=example',
  'https://tenant.auth0.com/u/login/identifier?state=example',
  'https://tenant.auth0.com/u/mfa-otp-challenge?state=example',
  'https://tenant.auth0.com/login/callback',
  'https://tenant.onelogin.com/oidc/2/auth?client_id=example',
  'https://tenant.onelogin.com/login2',
  'https://api-example.duosecurity.com/oauth/v1/authorize',
  'https://api-example.duosecurity.com/frame/v4/auth',
  'https://auth.pingone.com/environment/as/authorize',
  'https://auth.pingone.com/environment/flows/flow-id',
  'https://tenant.b2clogin.com/tenant.onmicrosoft.com/policy/oauth2/v2.0/authorize',
  'https://tenant.b2clogin.com/tenant.onmicrosoft.com/policy/SelfAsserted',
  'https://tenant.ciamlogin.com/tenant/oauth2/v2.0/authorize',
  'https://pool.auth.eu-west-2.amazoncognito.com/oauth2/authorize?client_id=example',
  'https://pool.auth.eu-west-2.amazoncognito.com/login?client_id=example',
  'https://pool.auth.eu-west-2.amazoncognito.com/mfa?client_id=example',
  'https://accounts.shopify.com/lookup', 'https://admin.shopify.com/authentication/login',
  'https://www.facebook.com/dialog/oauth?client_id=example',
  'https://slack.com/oauth/v2/authorize?client_id=example',
];
for (const [excluded, pages] of [[false, contentPages], [true, loginPages]]) {
  for (const url of pages) {
    assert.strictEqual(worker.excluded(url), excluded, url);
    assert.strictEqual(worker.repairExcluded(url), excluded, 'health/repair follows coverage: ' + url);
  }
}
for (const domain of ['okta.com', 'auth0.com', 'onelogin.com', 'duosecurity.com', 'pingone.com',
  'b2clogin.com', 'ciamlogin.com', 'amazoncognito.com', 'shopify.com']) {
  assert.strictEqual(worker.excluded('https://' + domain + '.attacker.example/login'), false, domain);
  assert.strictEqual(worker.excluded('https://tenant.' + domain + '/content/page?next=/login/oauth2/authorize'), false, domain);
}

const earlyEnd = src.indexOf('  const __WO_RUNTIME_VERSION=');
assert(earlyEnd > 0);
for (const url of loginPages.filter((url) => vm.runInContext('wardenOneEngineLoginUrl(' + JSON.stringify(url) + ')', worker))) {
  const ctx = vm.createContext({ URL, location: new URL(url) });
  vm.runInContext(read('engine-compat.js') + '\n' + src.slice(0, earlyEnd) + '\nglobalThis.started=true;}();', ctx);
  assert.strictEqual(ctx.started, undefined, 'variable login exits before runtime hooks: ' + url);
}
for (const host of ['docs.google.com.attacker.example', 'tenant.auth0.com.attacker.example', 'notshopify.com']) {
  assert.strictEqual(vm.runInContext('wardenOneHostedAppHost(' + JSON.stringify(host) + ')', worker), false, host);
}

// Run the shipped config derivation with every protection on: only named pauses may change it.
const chainStart = src.indexOf('    const YT_COMPAT_PAUSED=[');
const chainEnd = src.indexOf('    WO_TOP=window===window.top,', chainStart);
assert(chainStart > 0 && chainEnd > chainStart);
const chain = src.slice(chainStart, chainEnd).replace(/,\s*$/, ';');
const enabled = ['enabled', 'removeOverlays', 'autoRejectConsent', 'antiFingerprintNoise', 'antiFingerprint',
  'detectPhishing', 'commandPasteGuard', 'formTrapDetector', 'detectSkimmers', 'fakeUpdateDetector',
  'scamLockGuard', 'paymentCardGuard', 'blockTokenExfil', 'sessionShield'];
const config = Object.fromEntries(enabled.map((key) => [key, true]));
const paused = ['removeOverlays', 'autoRejectConsent', 'antiFingerprintNoise', 'antiFingerprint'];
for (const url of contentPages) {
  const ctx = vm.createContext({ location: new URL(url), __woConfigStore: config,
    __woWebGLControl: { set() {} }, __woRealmRecord: null, woOn() {}, document: {} });
  vm.runInContext(read('engine-compat.js') + '\n' + chain + '\nthis.policy=WO; this.paused=HOSTED_APP_COMPAT_PAUSED; this.refresh=__woSyncConfig;', ctx);
  assert.deepStrictEqual(Array.from(ctx.paused), paused);
  for (const key of enabled) assert.strictEqual(ctx.policy[key], !paused.includes(key), url + ': ' + key);
  vm.runInContext('wardenOneHostedAppHost=()=>false; refresh();', ctx);
  assert.strictEqual(ctx.policy.antiFingerprintNoise, false, 'a changed page global cannot alter compatibility policy');
}
const popupList = popup.match(/const SITE_DASH_HOSTED_APP_PAUSED = new Set\((\[[^\]]*\])\)/);
assert(popupList);
assert.deepStrictEqual(vm.runInNewContext(popupList[1]).join(','), paused.join(','));
const engineHost = src.match(/HOSTED_APP_COMPAT_HOST=(\/[^\n]+\/i),/);
const sharedHost = read('engine-compat.js').match(/return (\/[^\n]+\/i)\.test/);
assert(engineHost && sharedHost && engineHost[1] === sharedHost[1], 'private engine matcher agrees with the isolated bridge and popup policy');
assert(popup.includes('wardenOneHostedAppHost(host)'));
console.log('Engine coverage: content pages protected, login routes excluded, health aligned and security guards retained');

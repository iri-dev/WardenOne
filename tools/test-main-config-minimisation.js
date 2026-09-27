/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* A page sees only its own allowlist decision, never the reader's site graph. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8');
const start = source.indexOf('function mainWorldConfigForHost(');
const end = source.indexOf('\n  const sendConfig =', start);
assert(start >= 0 && end > start, 'MAIN config projection moved');
assert(/postToPage\(signed\('config', JSON\.stringify\(pageConfig\)/.test(source),
  'the signed MAIN message bypasses the projected config');
const ctx = {
  Object, Array, String,
  normalizeBridgeHost: (raw) => String(raw || '').replace(/^www\./, '').toLowerCase(),
  bridgeHostMatchesList: (host, list) => Array.isArray(list) && list.some((entry) => host === entry || host.endsWith('.' + entry)),
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end) + '\nthis.project=mainWorldConfigForHost;', ctx);

const sensitive = {
  enabled: true,
  allowlist: ['sensitive.bank.example', 'shop.example'],
  allowlistUntil: { 'private.health.example': 9999999999999 },
  forgetMeList: ['private.health.example'],
  memoryNeverSleepHosts: ['private.mail.example'],
  rebindQuarantine: ['internal.router.example'],
  eyeShieldBrightnessByHost: { 'private.mail.example': 60 },
  eyeShieldWarmthByHost: { 'private.health.example': 30 },
  siteOverrides: { 'private.bank.example': { mediaShield: false } },
  downloadSafeBrowsingKey: 'SECRET-CREDENTIAL',
  mediaShield: true,
};
const page = ctx.project(sensitive, 'unrelated.example');
assert.strictEqual(page.enabled, true);
assert.strictEqual(page.mediaShield, true);
assert.deepStrictEqual(Array.from(page.allowlist), []);
for (const canary of ['sensitive.bank.example', 'shop.example', 'private.health.example',
  'private.mail.example', 'internal.router.example', 'SECRET-CREDENTIAL']) {
  assert(!JSON.stringify(page).includes(canary), canary + ' leaked to an unrelated page');
}
const own = ctx.project(sensitive, 'sub.shop.example');
assert.deepStrictEqual(Array.from(own.allowlist), ['sub.shop.example']);
assert(!JSON.stringify(own).includes('sensitive.bank.example'));
assert.deepStrictEqual(sensitive.allowlist, ['sensitive.bank.example', 'shop.example'],
  'projection changed the isolated config used by other scripts');
console.log('MAIN config minimisation tests passed');

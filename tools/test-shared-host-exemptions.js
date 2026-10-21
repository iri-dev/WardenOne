/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Exemptions must have the same PSL boundary in the worker and both page worlds. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const bg = read('background.js');
const bridge = read('bridge.js');
const content = read('src/content.js');
function lift(source, name) {
  const at = source.search(new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm'));
  assert(at >= 0, name);
  const end = source.indexOf('\n}', at);
  // Nested bridge functions close at their own indentation level.
  const indent = source.slice(at).match(/^[ \t]*/)[0];
  const close = source.indexOf('\n' + indent + '}', at);
  assert(close > at && end >= close, name + ' boundary');
  return source.slice(at, close + indent.length + 2);
}
function realm(file, raw) {
  const box = vm.createContext({ URL });
  vm.runInContext(read(file) + (raw ? '\n' + read('psl-private.js') : ''), box);
  assert.equal(vm.runInContext('wardenOnePrivateCache.size', box), 0, 'private TLD groups load lazily');
  return box;
}
const realms = [realm('domain-utils.js', false), realm('domain-utils-isolated.js', false), realm('domain-utils.js', true)];
const cases = [
  ['alice.webflow.io', 'webflow.io', false], ['alice.github.io', 'github.io', false],
  ['alice.webflow.io', 'bob.webflow.io', false], ['alice.github.io', 'bob.github.io', false],
  ['cdn.alice.webflow.io', 'alice.webflow.io', true], ['cdn.alice.github.io', 'alice.github.io', true],
  ['www.webflow.io', 'webflow.io', false], ['alice.webflow.io', 'www.webflow.io', false],
  ['cdn.www.webflow.io', 'www.webflow.io', true],
  ['cdn.alice.foo.ck', 'alice.foo.ck', true], ['alice.foo.ck', 'foo.ck', false],
  ['cdn.city.kawasaki.jp', 'city.kawasaki.jp', true], ['alice.foo.kawasaki.jp', 'foo.kawasaki.jp', false],
  ['healthy-college.co.uk', 'co.uk', false], ['login.example.com', 'example.com', true],
  ['example.com.evil.com', 'example.com', false], ['notexample.com', 'example.com', false],
  ['child.bucket.s3.amazonaws.com', 'bucket.s3.amazonaws.com', false],
];
for (const [index, box] of realms.entries()) {
  for (const [host, candidate, expected] of cases) {
    assert.equal(box.hostMatchesSite(host, candidate), expected, index + ': ' + host + ' / ' + candidate);
  }
  assert.equal(box.siteIdentity('alice.webflow.io'), 'alice.webflow.io');
  assert.equal(box.sameSiteDomain('alice.webflow.io', 'bob.webflow.io'), false);
  vm.runInContext('const NORMALIZED_HOST_CACHE=new Map(); const NORMALIZED_HOST_CACHE_MAX=12000;', box);
  for (const name of ['bridgePrivateOrLocalHost', 'hostParsesAsItself', 'normalizeBridgeHostUncached', 'normalizeBridgeHost', 'bridgeCleanHost', 'bridgeHostMatchesList', 'bridgeSiteOverridesFor', 'mainWorldConfigForHost']) {
    vm.runInContext(lift(bridge, name), box);
  }
  const cfg = { allowlist: ['webflow.io'], siteOverrides: {
    'webflow.io': { commandPasteGuard: false }, 'alice.webflow.io': { behavioralScan: false },
  } };
  assert.deepEqual(Object.keys(box.bridgeSiteOverridesFor(cfg, 'bob.webflow.io')), []);
  assert.deepEqual(Object.keys(box.bridgeSiteOverridesFor(cfg, 'cdn.alice.webflow.io')), ['behavioralScan']);
  assert.equal(box.bridgeHostMatchesList('alice.webflow.io', cfg.allowlist), false);
  assert.deepEqual(Array.from(box.mainWorldConfigForHost(cfg, 'alice.webflow.io', false).allowlist), []);
  assert.deepEqual(Array.from(box.mainWorldConfigForHost({ allowlist: ['alice.webflow.io'] }, 'cdn.alice.webflow.io', false).allowlist), ['cdn.alice.webflow.io']);
  const start = content.indexOf('SITE_BOUNDARY=');
  const end = content.indexOf('VERIFICATION_FLOW_POLICY=', start);
  assert(start >= 0 && end > start);
  vm.runInContext('const ' + content.slice(start, end).trim().replace(/,$/, ';') + '\nthis.boundary=SITE_BOUNDARY;', box);
  assert.equal(box.boundary.same('alice.webflow.io', 'webflow.io'), false);
  assert.equal(box.boundary.siblingCandidate('alice.webflow.io', 'bob.webflow.io'), false);
  assert.equal(box.boundary.same('cdn.alice.webflow.io', 'alice.webflow.io'), true);
  box.isLocalOrPrivateHost = () => false;
  box.regDomainBg = box.registrableDomain;
  box.SHARED_HOSTING_SUFFIXES = new Set(['amazonaws.com']);
  vm.runInContext(lift(bg, 'normalizeAllowlistHost'), box);
  for (const name of ['downloadTrustTarget', 'trustedDownloadMatch']) vm.runInContext(lift(read('background-downloads.js'), name), box);
  assert.equal(box.downloadTrustTarget('cdn.alice.webflow.io'), 'alice.webflow.io');
  assert.equal(box.trustedDownloadMatch('bob.webflow.io', ['webflow.io', 'alice.webflow.io']), '');
  assert.equal(box.trustedDownloadMatch('cdn.alice.webflow.io', ['alice.webflow.io']), 'alice.webflow.io');
}
const rules = vm.runInContext('(WARDENONE_PSL_PRIVATE_RULES + "\\n" + WARDENONE_PSL_ICANN_RULES).split("\\n")', realms[2]);
let comparisons = 0;
for (const rule of rules) {
  const base = rule.replace(/^!/, '').replace(/^\*\./, 'boundary.');
  for (const host of [base, 'alice.' + base, 'cdn.alice.' + base]) {
    const expected = realms[2].wardenOnePslSuffix(host, true);
    for (const box of realms.slice(0, 2)) {
      assert.equal(box.wardenOnePslSuffix(host, true), expected, rule + ': ' + host);
      assert.equal(box.wardenOneIsPublicSuffix(host), realms[2].wardenOneIsPublicSuffix(host), host);
      assert.equal(box.hostMatchesSite('alice.' + base, base), realms[2].hostMatchesSite('alice.' + base, base), rule);
      comparisons++;
    }
  }
}
assert(comparisons > 60000);
console.log('[ok] shared-host exemptions agree in all worlds; ' + comparisons + ' complete-PSL comparisons');

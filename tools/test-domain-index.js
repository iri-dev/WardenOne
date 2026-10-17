/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const start = source.indexOf('function blockedDomainIndex(');
const end = source.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start);
const helper = source.slice(start, end);
const context = vm.createContext({ Set, Object });
vm.runInContext(helper + '\nthis.make = blockedDomainIndex;', context);
for (const [all, security] of [
  [[], []], [['security.example'], ['security.example']],
  [['tracker.example', 'ad.example'], []],
  [['security.example', 'tracker.example', 'ad.example', 'security.example'], ['security.example']],
]) {
  const expected = new Set(all), securitySet = new Set(security);
  const index = context.make(all, securitySet);
  assert.equal(index.size, expected.size);
  assert(Object.isFrozen(index));
  for (const host of all.concat(['clean.example', 'child.security.example', 'notsecurity.example', ''])) {
    assert.equal(index.has(host), expected.has(host), host + ' membership');
    assert.equal(securitySet.has(host), security.includes(host), host + ' classification');
  }
}
const domains = Array.from({ length: 100000 }, (_, i) => 'host-' + i + '.example');
const original = new Set(domains), security = new Set(domains.slice(0, 80000));
const old = context.make(original, security);
for (let i = 0; i < 110000; i++) assert.equal(old.has('host-' + i + '.example'), original.has('host-' + i + '.example'));
const next = context.make(['new.example'], new Set(['new.example']));
assert(next.has('new.example') && !next.has(domains[0]));
assert(old.has(domains[0]) && !old.has('new.example'), 'replacing an index leaves an in-flight reader consistent');

const restoreStart = source.indexOf('let SECURITY_DOMAINS = new Set();');
const restoreEnd = source.indexOf('// One readiness promise', restoreStart);
assert(restoreStart > end && restoreEnd > restoreStart);
async function restore(count) {
  const ctx = vm.createContext({ Set, Object, Promise, Math, Number,
    chrome: { storage: { local: { get(_keys, callback) {
      setImmediate(() => callback({ wardenone_blocked_domains: ['security.example', 'tracker.example'], wardenone_blocked_security_count: count }));
    } } } },
  });
  vm.runInContext(helper + '\nlet BLOCKED_DOMAINS = new Set();let __initBlockedDomains=null;\n'
    + source.slice(restoreStart, restoreEnd)
    + '\nthis.ready=__initBlockedDomains;this.state=()=>({blocked:BLOCKED_DOMAINS,security:SECURITY_DOMAINS});', ctx);
  await ctx.ready;
  return ctx.state();
}
process.exitCode = 1;
(async () => {
  for (const [count, expected] of [[1, ['security.example']], [0, []], [-3, []], [100, ['security.example', 'tracker.example']], [undefined, []]]) {
    const state = await restore(count);
    assert.equal(state.blocked.size, 2);
    for (const host of ['security.example', 'tracker.example', 'clean.example']) {
      assert.equal(state.blocked.has(host), host !== 'clean.example');
      assert.equal(state.security.has(host), expected.includes(host), 'stored security prefix remains authoritative');
    }
  }
  assert(/BLOCKED_DOMAINS = blockedDomainIndex\(merged, domainBuckets.security\)/.test(source), 'refreshed full lists use shared membership');
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.js'))) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/\bBLOCKED_DOMAINS\.(\w+)/g)) {
      assert(['has', 'size'].includes(match[1]), file + ' requires a mutable or enumerable domain Set');
    }
  }
  console.log('[ok] exact shared domain membership, security classification, replacement and cold restoration');
  process.exitCode = 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });

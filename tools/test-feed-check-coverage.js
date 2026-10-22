/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/source-inventory.json'), 'utf8'));
const output = execFileSync(process.execPath, [path.join(__dirname, 'check-feeds.js'), '--list-json'],
  { cwd: root, encoding: 'utf8' });
const policies = JSON.parse(output);
const byUrl = new Map(policies.map((policy) => [policy.url, policy]));

assert.equal(byUrl.size, policies.length, 'the check reads each source once');
assert.deepEqual([...byUrl.keys()].sort(), inventory.sources.map((source) => source.url).sort(),
  'the live check covers every configured runtime feed');

const source = (fragment) => {
  const match = policies.find((policy) => policy.url.includes(fragment));
  assert(match, 'missing policy for ' + fragment);
  return match;
};
assert.deepEqual([source('/openphish/public_feed/').maxBytes, source('/openphish/public_feed/').timeoutMs],
  [6 * 1024 * 1024, 6500], 'optional OpenPhish uses its shorter timeout and cap');
assert.equal(source('/TMAFE/anti-grabify/').maxBytes, 8 * 1024 * 1024,
  'a source shared with supplemental lists uses the stricter cap');
assert.equal(source('/filter_3_Spyware/').maxBytes, 12 * 1024 * 1024,
  'a source shared with cosmetic filtering uses the cosmetic cap');
assert.equal(source('/blocklistproject/Lists/master/scam.txt').maxBytes, 18 * 1024 * 1024,
  'an ordinary network list uses the network cap');
assert.deepEqual([source('/urlhaus-filter-online.txt').maxBytes, source('/malicious-hash/').maxBytes],
  [9 * 1024 * 1024, 9 * 1024 * 1024], 'Download Guard feeds use their own cap');
assert(policies.every((policy) => Number.isSafeInteger(policy.maxBytes) && policy.maxBytes > 0
  && Number.isSafeInteger(policy.timeoutMs) && policy.timeoutMs > 0));

console.log('[ok] feed reachability check covers all ' + policies.length + ' configured sources with their limits');

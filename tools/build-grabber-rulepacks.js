/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'rules.json'), 'utf8'));
const hostBlocks = source.filter((rule) => rule.action.type === 'block'
  && rule.condition.requestDomains && rule.condition.resourceTypes.includes('main_frame'));
const resourceOnly = source.filter((rule) => rule.action.type === 'block'
  && !rule.condition.resourceTypes.includes('main_frame'));
const redirects = source.filter((rule) => rule.action.type === 'redirect');
const allowances = source.filter((rule) => rule.action.type === 'allow');

assert.equal(hostBlocks.length, 126, 'the reviewed whole-host logger list changed');
assert.deepEqual(resourceOnly.map((rule) => rule.id), [170, 172]);
assert.deepEqual(redirects.map((rule) => rule.id), [168, 171]);
assert.deepEqual(allowances.map((rule) => rule.id), [163, 164, 165, 166, 167]);
assert.equal(hostBlocks.length + resourceOnly.length + redirects.length + allowances.length,
  source.length, 'every canonical rule needs an owner');
assert(redirects.every((rule) => rule.condition.resourceTypes.length === 1
  && rule.condition.resourceTypes[0] === 'main_frame'));

const withoutNavigation = (rule) => ({ ...rule, condition: { ...rule.condition,
  resourceTypes: rule.condition.resourceTypes.filter((type) => type !== 'main_frame') } });
const asSiteBlock = (rule) => ({ ...rule, priority: 2000, action: { type: 'block' } });
const packs = {
  'rules-grabber-resources.json': hostBlocks.map(withoutNavigation).concat(resourceOnly),
  'rules-grabber-navigation.json': redirects,
  'rules-grabber-malware-navigation.json': redirects.map(asSiteBlock),
  'rules-grabber-compat.json': allowances,
};

for (const [file, rules] of Object.entries(packs)) {
  const output = JSON.stringify(rules, null, 2) + '\n';
  const target = path.join(root, file);
  if (process.argv.includes('--check')) {
    assert.equal(fs.readFileSync(target, 'utf8'), output, file + ' is stale');
  } else {
    fs.writeFileSync(target, output);
  }
}
console.log('[ok] packaged grabber rulepacks match rules.json');

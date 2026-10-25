/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const start = background.indexOf('const FIREWALL_RULE_BASE =');
const end = background.indexOf('async function applyFirewallRulesFrom(', start);
const inventory = background.match(/const ALL_DNR_RESOURCE_TYPES = \[[\s\S]*?\];/)[0];
const context = vm.createContext({
  FIREWALL_RULES_BUDGET: Number(background.match(/const FIREWALL_RULES_BUDGET = (\d+)/)[1]),
  FIREWALL_SESSION_RULES_BUDGET: Number(background.match(/const FIREWALL_SESSION_RULES_BUDGET = (\d+)/)[1]),
});
vm.runInContext(inventory + '\n' + background.slice(start, end)
  + '\nthis.api = { firewallCompile, firewallRefusalFor, FIREWALL_COLUMNS, FIREWALL_RULE_MAX };', context);
const { firewallCompile: compile, firewallRefusalFor: refusal, FIREWALL_COLUMNS: columns, FIREWALL_RULE_MAX: cap } = context.api;
const matrix = (cells) => ({ 'news.example.com': { 'cdn.example.org': cells } });
const rule = (id, priority, action) => ({ id, priority, action: { type: action }, condition: { resourceTypes: ['script'] } });
const policy = require('./lib/network-policy.js');
const matches = (r, type, site, domain) => {
  const c = r.condition;
  const includes = (list, host) => !list || list.some(d => host === d || host.endsWith('.' + d));
  return (!c.resourceTypes || c.resourceTypes.includes(type)) && includes(c.initiatorDomains, site) && includes(c.requestDomains, domain);
};
const outcome = (rules, type = 'script', site = 'news.example.com', domain = 'cdn.example.org') => {
  const candidates = rules.filter(r => r.action.type !== 'modifyHeaders' && matches(r, type, site, domain));
  candidates.sort((a, b) => b.priority - a.priority || (a.action.type === 'allow' ? -1 : 1));
  return candidates[0] || null;
};

for (const all of ['allow', 'block']) {
  for (const column of ['script', 'xhr', 'frame', 'media']) {
    const result = compile(matrix({ all, [column]: 'noop', cookie: 'strip' }));
    const broad = result.rules.find(r => r.action.type === all);
    assert(broad);
    for (const type of columns[column]) {
      assert(!broad.condition.resourceTypes.includes(type), all + '/' + column + ': noop removes only this row\'s All decision');
      assert.strictEqual(outcome(result.rules, type), null, 'noop creates no allow or block');
    }
    for (const type of columns.all.filter(t => !columns[column].includes(t))) assert(broad.condition.resourceTypes.includes(type));
    assert(result.rules.some(r => r.action.type === 'modifyHeaders'), 'noop leaves cookie stripping intact');
    assert.strictEqual(result.decisions, 3, 'noop counts toward the saved-decision limit');
    policy.validate({ addRules: result.rules }, 'dynamic');
  }
}
for (const [label, external, expected] of [
  ['malware', rule(10000, 3000, 'block'), 'block'],
  ['tracker', rule(10001, 1100, 'block'), 'block'],
  ['compatibility', rule(10002, 1900, 'allow'), 'allow'],
  ['typed user exception', rule(750000, 98000, 'allow'), 'allow'],
  ['site pause', rule(800000, 100000, 'allow'), 'allow'],
  ['temporary firewall allowance', rule(960000, 97003, 'allow'), 'allow'],
]) {
  const compiled = compile(matrix({ all: 'allow', script: 'noop' })).rules;
  const winner = outcome([...compiled, external]);
  assert.strictEqual(winner.action.type, expected, label);
  assert.strictEqual(winner.id, external.id, label + ': noop leaves other authorities in control');
}
const security = rule(10000, 3000, 'block');
const ordinary = compile(matrix({ all: 'allow' })).rules;
assert.strictEqual(outcome([...ordinary, security]).action.type, 'allow', 'explicit Allow retains its existing security override');
assert.strictEqual(outcome(compile(matrix({ all: 'block', script: 'default' })).rules).action.type, 'block', 'Default retains the All decision');
assert.strictEqual(compile(matrix({ script: 'noop' })).rules.length, 0);
assert.strictEqual(compile(matrix({ all: 'noop', cookie: 'noop', script: 'strip' })).rules.length, 0, 'invalid column/decision pairs never compile');
const scoped = compile(matrix({ all: 'block', script: 'noop' })).rules;
assert.strictEqual(outcome(scoped, 'image', 'other.example.com'), null);
assert.strictEqual(outcome(scoped, 'image', 'news.example.com', 'other.example.org'), null);
const parent = compile({ 'news.example.com': { 'example.org': { script: 'block' }, 'cdn.example.org': { all: 'block', script: 'noop' } } }).rules;
assert.strictEqual(outcome(parent).action.type, 'block', 'noop does not cancel a separate parent-domain row');

const full = { 'news.example.com': Object.fromEntries(Array.from({ length: cap }, (_, i) => ['d-' + i + '.example.org', { script: 'noop' }])) };
const before = compile(full);
assert.strictEqual(before.decisions, cap);
assert.strictEqual(before.rules.length, 0, 'saved noops do not install permissive rules');
full['news.example.com']['extra.example.org'] = { script: 'noop' };
const after = compile(full);
assert.strictEqual(after.omitted.length, 1);
assert(refusal(before, after), 'zero-rule decisions still enforce the configuration limit');
const legacy = { 'news.example.com': Object.fromEntries(Array.from({ length: cap - 1 }, (_, i) => ['d-' + i + '.example.org', { script: 'noop' }])) };
legacy['news.example.com']['cdn.example.org'] = { all: 'block', script: 'noop' };
const overflow = compile(legacy);
assert(overflow.omitted.some(cell => cell.column === 'script'));
assert(outcome(overflow.rules), 'an omitted noop must not affect a compiled All decision');
const settings = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const lists = vm.createContext({ isObj: value => value !== null && typeof value === 'object' && !Array.isArray(value) });
vm.runInContext(settings.match(/^const savedHost = .*;$/m)[0] + '\n'
  + settings.slice(settings.indexOf('const strList ='), settings.indexOf('async function collectLists()'))
  + '\nthis.clean = cleanLists;', lists);
const imported = lists.clean({ firewall: matrix({ all: 'block', script: 'noop', xhr: 'strip', cookie: 'allow', media: 'noop', frame: 'explode' }) });
assert.strictEqual(JSON.stringify(imported.firewall), JSON.stringify(matrix({ all: 'block', script: 'noop', media: 'noop' })), 'backup validation retains only valid decisions');
assert.strictEqual(JSON.stringify(lists.clean(imported)), JSON.stringify(imported), 'backup normalization is stable');
console.log('[ok] firewall noop authority, resource scopes, inherited rows and decision capacity');

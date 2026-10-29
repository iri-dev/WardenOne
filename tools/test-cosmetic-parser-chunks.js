/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const background = fs.readFileSync('background.js', 'utf8');
const start = background.indexOf('function cosmeticGenericHideDomain(');
const end = background.indexOf('// Fetch + parse the cosmetic lists', start);
assert(start >= 0 && end > start, 'cosmetic parser source was not found');

const scope = {
  ADSHIELD_COSMETIC_MAX: 6,
  parseScriptlet(body) { return { name: String(body), args: [] }; },
  scriptletMayBeStoredForDomains() { return true; },
};
vm.createContext(scope);
vm.runInContext(background.slice(start, end) + '\nthis.parse = parseCosmeticFilters;', scope);

const sources = [
  '##.global-one\nsite.example##.first\nsite.example##.second\n',
  '',
  'site.example#@#.first\nsite.example#?#.dialog:has-text(ad)\nsite.example##+js(set-constant, key, value)',
  '##.global-two\nsite.example##.third\nsite.example##.over-budget\n##.global-over-budget\n@@||site.example^$generichide\r\n',
];
const combined = scope.parse(sources.filter(Boolean).join('\n'));
const chunked = scope.parse(sources.filter(Boolean));
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepStrictEqual(plain(chunked), plain(combined), 'separate sources changed rule order or meaning');
assert.deepStrictEqual(plain(chunked.generic), ['.global-one', '.global-two'], 'the cosmetic budget changed');
assert.deepStrictEqual(plain(chunked.specific['site.example']).slice(0, 3), ['.first', '.second', '.third'],
  'domain-specific selectors changed order');
assert.deepStrictEqual(plain(chunked.exceptions['site.example']), ['.first'],
  'a later source lost its exception');
assert(plain(chunked.genericHideExclusions).includes('site.example'),
  'generic-hide exception after the cosmetic budget was lost');
assert.deepStrictEqual(plain(chunked.procedural['site.example']), ['.dialog:has-text(ad)'],
  'procedural rule was lost');
assert.strictEqual(plain(chunked.scriptlets['site.example']).length, 1,
  'scriptlet rule was lost');
assert.deepStrictEqual(plain(scope.parse(['', ''])), plain(scope.parse('')),
  'empty sources changed the empty result');

console.log('ok - cosmetic source chunks preserve rule order, budgets, and exceptions');

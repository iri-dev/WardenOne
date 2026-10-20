/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const DOMAIN = read('domain-utils.js');
const ctx = vm.createContext({ URL });
vm.runInContext(DOMAIN + '\nthis.api={registrableDomain,sameSiteDomain,hostMatchesSite,wardenOneIcannSuffix};', ctx);
const api = ctx.api;
assert.strictEqual(vm.runInContext('wardenOneIcannCache.size', ctx), 0, 'suffix groups are lazy');
api.registrableDomain('x.or.jp');
assert.strictEqual(vm.runInContext('wardenOneIcannCache.size', ctx), 1, 'a lookup parses only its TLD group');
const suffixes = ['or.jp', 'web.id', 'me.uk', 'ltd.uk', 'sch.uk', 'nhs.uk', 'or.kr', 'pe.kr', 'id.au', 'k12.ca.us'];
for (const suffix of suffixes) {
  assert.strictEqual(api.registrableDomain('x.' + suffix), 'x.' + suffix, suffix);
  assert.strictEqual(api.sameSiteDomain('x.' + suffix, 'y.' + suffix), false, suffix);
  assert.strictEqual(api.hostMatchesSite('x.' + suffix, suffix), false, 'public suffix cannot allow tenants: ' + suffix);
}
for (const [host, expected] of [
  ['assets.school.k12.ca.us', 'school.k12.ca.us'],
  ['assets.x.or.jp', 'x.or.jp'], ['www.example.com', 'example.com'],
  ['a.b.sch.uk', 'a.b.sch.uk'], ['b.sch.uk', 'b.sch.uk'],
  ['a.city.kawasaki.jp', 'city.kawasaki.jp'], ['a.b.kawasaki.jp', 'a.b.kawasaki.jp'],
  ['www.ck', 'www.ck'], ['a.www.ck', 'www.ck'], ['a.b.ck', 'a.b.ck'],
  ['cdn.shop.公司.cn', 'shop.xn--55qx5d.cn'],
  ['127.0.0.1', '127.0.0.1'], ['[::1]', '[::1]'], ['localhost', 'localhost'],
  ['a.owner.unknown-tld', 'owner.unknown-tld'],
]) assert.strictEqual(api.registrableDomain(host), expected, host);
assert.strictEqual(api.sameSiteDomain('a.x.sch.uk', 'b.x.sch.uk'), false);
assert.strictEqual(api.sameSiteDomain('a.x.or.jp', 'b.x.or.jp'), true);

// Compare compact lookups with the independent full-rule representation, including wildcards.
const full = vm.createContext({});
vm.runInContext(read('psl-private.js') + '\nthis.rules=WARDENONE_PSL_ICANN_RULES.split("\\n");', full);
const exact = new Set(full.rules.filter((r) => r[0] !== '!' && !r.startsWith('*.')));
const wildcard = new Set(full.rules.filter((r) => r.startsWith('*.')).map((r) => r.slice(2)));
const exceptions = new Set(full.rules.filter((r) => r[0] === '!').map((r) => r.slice(1)));
function reference(host) {
  const labels = host.split('.');
  const matches = [];
  for (let i = 0; i < labels.length; i++) {
    const tail = labels.slice(i).join('.');
    if (exceptions.has(tail)) return labels.slice(i + 1).join('.');
    if (exact.has(tail) || (i < labels.length - 1 && wildcard.has(labels.slice(i + 1).join('.')))) matches.push(tail);
  }
  return matches.sort((a, b) => b.length - a.length)[0] || labels.at(-1);
}
let checked = 0;
for (const rule of full.rules) {
  const base = rule.replace(/^!/, '').replace(/^\*\./, 'label.');
  for (const host of [base, 'tenant.' + base, 'child.tenant.' + base]) {
    assert.strictEqual(api.wardenOneIcannSuffix(host), reference(host), rule + ': ' + host);
    checked++;
  }
}

const search = read('search-junk.js');
const searchCode = search.slice(search.indexOf('function registrable'), search.indexOf('function isJunkHost'));
vm.runInContext(searchCode + '\nthis.searchSite=registrable;', ctx);
const bridge = read('bridge.js');
const driftStart = bridge.indexOf('const regSite =');
const driftEnd = bridge.indexOf('const showScriptDriftWarning', driftStart);
ctx.location = { hostname: 'x.or.jp', href: 'https://x.or.jp/', protocol: 'https:' };
ctx.document = { scripts: [{ src: 'https://y.or.jp/a.js' }, { src: 'https://cdn.x.or.jp/b.js' }] };
vm.runInContext(bridge.slice(driftStart, driftEnd) + '\nthis.collect=collectScriptUrls;', ctx);
assert.deepStrictEqual(Array.from(ctx.collect(), (item) => item.url), ['https://y.or.jp/a.js']);
for (const suffix of suffixes) assert.strictEqual(ctx.searchSite('x.' + suffix), 'x.' + suffix);
const content = read('src/content.js');
const boundaryStart = content.indexOf('SITE_BOUNDARY=(()=>{');
const boundaryEnd = content.indexOf('VERIFICATION_FLOW_POLICY=', boundaryStart);
const keyStart = content.indexOf('siteKey=h=>{');
const keyEnd = content.indexOf('sameSite=', keyStart);
assert(boundaryStart > 0 && boundaryEnd > boundaryStart && keyStart > 0 && keyEnd > keyStart);
vm.runInContext('const ' + content.slice(boundaryStart, boundaryEnd).trim().replace(/,$/, ';')
  + '\nconst ' + content.slice(keyStart, keyEnd).trim().replace(/,$/, ';')
  + '\nthis.pageSite=SITE_BOUNDARY.site; this.requestSite=siteKey;', ctx);
for (const suffix of suffixes) {
  assert.strictEqual(ctx.pageSite('x.' + suffix), 'x.' + suffix, 'page boundary: ' + suffix);
  assert.strictEqual(ctx.requestSite('x.' + suffix), 'x.' + suffix, 'request boundary: ' + suffix);
}
const lateHelper = vm.createContext({});
vm.runInContext(searchCode + '\nthis.site=registrable;', lateHelper);
assert.strictEqual(lateHelper.site('x.or.jp'), 'x.or.jp', 'registration ordering cannot broaden trust');
console.log('ICANN boundaries passed: reported suffixes, consumers and ' + checked + ' full-list comparisons');

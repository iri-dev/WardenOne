/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { helpers, readSnapshot, sha256, PROVIDERS } = require('./build-cname-data.js');
const { WOCname, siteIdentity } = helpers();
const text = fs.readFileSync('rules-cname.json', 'utf8');
const rules = JSON.parse(text);
const summary = JSON.parse(fs.readFileSync('cname-trackers.json', 'utf8')).catalog;
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

assert.equal(summary.sha256, sha256(text), 'the runtime summary names this catalog');
assert.equal(summary.rules, rules.length);
assert(manifest.declarative_net_request.rule_resources.some(r => r.id === 'cname_trackers' && r.path === 'rules-cname.json' && r.enabled === true));
assert(rules.length <= 120 && rules.filter(rule => rule.condition.regexFilter).length < 1000, 'static regex and rule limits');

/* The shipped compatibility functions, not the builder's mirror of them. */
function shipped() {
  const source = fs.readFileSync('background.js', 'utf8');
  const take = (pattern, name) => { const match = source.match(pattern); assert(match, name); return match[0]; };
  const fn = name => {
    const start = source.indexOf('\nfunction ' + name + '(');
    assert(start >= 0, name);
    return source.slice(start, source.indexOf('\n}\n', start) + 3);
  };
  const script = [
    'function registrableDomainBg(host) { return registrableDomain(host); }',
    take(/const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = \[[\s\S]*?\];/, 'login hosts'),
    take(/const TRACKER_PROTECTED_DOMAINS = new Set\(\[[\s\S]*?\]\);\nLOGIN_COMPAT_NEVER_BLOCK_DOMAINS\.forEach[^\n]*/, 'protected sites'),
    take(/const MEDIA_COMPAT_DOMAINS = new Set\(\[[\s\S]*?\]\);\nconst MEDIA_COMPAT_SUFFIXES[^\n]*/, 'media hosts'),
    'let __ownProviderDomains = null;',
    ...['ownProviderDomains', 'normalizeTrackerDomain', 'isProtectedTrackerDomain', 'isMediaCompatDomainLowercase', 'isMediaCompatDomain'].map(fn),
    'this.api = { isProtectedTrackerDomain, isMediaCompatDomain, login: LOGIN_COMPAT_NEVER_BLOCK_DOMAINS, media: [...MEDIA_COMPAT_DOMAINS] };',
  ].join('\n');
  const context = vm.createContext({ URL, console });
  for (const file of ['domain-utils.js', 'psl-private.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  vm.runInContext(script, context);
  return context.api;
}
const runtime = shipped();

const seen = new Set(), sites = new Set();
let blocked = 0, cookies = 0;
for (const rule of rules) {
  const c = rule.condition;
  assert.equal(rule.priority, WOCname.rulePriority);
  assert.equal(JSON.stringify(c.resourceTypes), JSON.stringify(WOCname.resourceTypes));
  assert(!c.resourceTypes.some(type => ['main_frame', 'sub_frame', 'media', 'stylesheet', 'font'].includes(type)), 'navigations and page rendering stay outside');
  /* Case-insensitive matching is the default from Chrome 118; the manifest requires 121. */
  assert(!('domainType' in c) && !('initiatorDomains' in c) && !('isUrlFilterCaseSensitive' in c));
  for (const host of runtime.login.concat(runtime.media)) assert(c.excludedInitiatorDomains.includes(host), 'compatibility initiator ' + host);
  assert(rule.action.type === 'block' || JSON.stringify(rule.action) === JSON.stringify({ type: 'modifyHeaders',
    requestHeaders: [{ header: 'cookie', operation: 'remove' }], responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] }));
  const family = /,\}/.test(c.regexFilter);
  const depth = Number(c.regexFilter.match(/\{(\d+)/)[1]) + (family ? 0 : 1);
  assert.equal(c.regexFilter, family ? WOCname.descendantRegex(depth) : WOCname.exactHostRegex(depth));
  for (const host of c.requestDomains) {
    assert(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host), 'normalized ' + host);
    assert.equal(host.split('.').length, depth, 'depth group ' + host);
    const site = siteIdentity(host);
    assert(site && site !== host, 'a registrable site is never blocked whole: ' + host);
    sites.add(site);
    /* A listed alias can also parent a wildcard family; the family regex excludes the parent itself. */
    const key = (family ? '*.' : '') + host;
    assert(!seen.has(key), 'listed once per kind: ' + host);
    seen.add(key);
    assert(!runtime.isMediaCompatDomain(host), 'media host in catalog: ' + host);
  }
  if (rule.action.type === 'block') blocked += c.requestDomains.length; else cookies += c.requestDomains.length;
}
/* isProtectedTrackerDomain depends only on the host's site. */
for (const site of sites) assert(!runtime.isProtectedTrackerDomain(site), 'protected site in catalog: ' + site);
assert.deepEqual([blocked, cookies], [summary.blockedHosts, summary.cookieHosts]);
assert(blocked > 100000, 'catalog coverage regressed');

const matches = (host, type = 'script') => rules.filter(rule => {
  const c = rule.condition, url = 'https://' + host + '/collect';
  return c.resourceTypes.includes(type) && c.requestDomains.some(d => host === d || host.endsWith('.' + d)) && new RegExp(c.regexFilter, 'i').test(url);
}).map(rule => rule.action.type);
const expectAction = (host, expected) => assert.equal(matches(host).join(), expected, host);
expectAction('a.trowow.de', 'block');
expectAction('0.avmarket.rs', 'block');
expectAction('child.a.trowow.de', '');
expectAction('a.trowow.de.evil.test', '');
expectAction('trowow.de', '');
const family = rules.find(rule => /,\}/.test(rule.condition.regexFilter) && rule.condition.requestDomains.includes('net.daraz.com'));
assert(family && family.action.type === 'block', 'wildcard family');
expectAction('anything-new.net.daraz.com', 'block');
expectAction('net.daraz.com', 'block');
expectAction('child.net.home24.de', 'block');
expectAction('net.home24.de', '');
assert.equal(matches('a.trowow.de', 'main_frame').length, 0);

const snapshot = readSnapshot();
const listed = stem => Object.keys(JSON.parse(snapshot.files.find(file => file.path === 'data/trackers/' + stem + '.json').text));
for (const [stem, tier] of Object.entries(PROVIDERS)) {
  const hosts = listed(stem).map(WOCname.normalizeHost).filter(host => seen.has(host));
  if (!hosts.length) continue;
  const action = matches(hosts[0]).join();
  assert.equal(action, tier === 'cookies' ? 'modifyHeaders' : 'block', stem + ' tier');
  if (tier === 'hosted') {
    const rule = rules.find(r => r.condition.requestDomains.includes(hosts[0]));
    assert(rule.condition.excludedInitiatorDomains.includes(hosts[0]), stem + ' pages keep their own resources');
  }
}

const exception = WOCname.exceptionRules(rules, ['shop.trowow.de', 'nothing-listed.example', 'www.trowow.de'], { base: 730000, budget: 300 });
assert.equal(exception.length, 1);
assert.deepEqual(Array.from(exception[0].condition.initiatorDomains), ['shop.trowow.de', 'www.trowow.de']);
assert(exception[0].condition.requestDomains.includes('a.trowow.de'));
assert(exception[0].condition.requestDomains.every(host => host.endsWith('.trowow.de')));
assert.equal(exception[0].action.type, 'allow');
assert.equal(exception[0].priority, WOCname.rulePriority, 'an exception never outranks other protections');
const daraz = WOCname.exceptionRules(rules, ['www.daraz.com'], { base: 730000, budget: 300 });
assert(daraz[0].condition.requestDomains.includes('net.daraz.com'), 'a family exception allows its subtree');
const merged = WOCname.exceptionRules(rules, [...sites].slice(0, 5).map(site => 'www.' + site), { base: 730000, budget: 2 });
assert.equal(merged.length, 2, 'the exception band stays inside its budget');
assert.equal(merged[1].condition.initiatorDomains.length, 4);
console.log('[ok] CNAME catalog: ' + blocked + ' blocked and ' + cookies + ' cookie-only hosts, runtime compatibility parity, exact scope and site exceptions');

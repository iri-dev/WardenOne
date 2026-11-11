/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs'), vm = require('vm');
const { loadNetworkParser } = require('./bench-filter-parsing.js');
const source = fs.readFileSync('background.js', 'utf8');
const parser = loadNetworkParser(source);
const parse = text => Array.from(parser.parseList(text));
const maxHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
const accepted = [
  ['pixel.feed-fixture.net', 'pixel.feed-fixture.net'],
  ['WWW.Feed-Fixture.NET.', 'www.feed-fixture.net'],
  ['b\u00fccher.de', 'xn--bcher-kva.de'],
  ['xn--bcher-kva.de', 'xn--bcher-kva.de'],
  ['\u98df\u72ee.\u516c\u53f8.cn', 'xn--85x722f.xn--55qx5d.cn'],
  ['\uff11\uff12\uff13.feed-fixture.net', '123.feed-fixture.net'],
  ['dga-0123456789abcdef.xyz', 'dga-0123456789abcdef.xyz'],
  ['0x7f.feed-fixture.net', '0x7f.feed-fixture.net'],
  ['local.feed-fixture.net', 'local.feed-fixture.net'],
  ['test.feed-fixture.net', 'test.feed-fixture.net'],
  ['example.co.uk', 'example.co.uk'],
  ['notexample.com', 'notexample.com'],
  ['example.com.feed-fixture.net', 'example.com.feed-fixture.net'],
  ['a'.repeat(56) + '.onion', 'a'.repeat(56) + '.onion'],
  [maxHost, maxHost],
];
const rejected = [
  '127.0.0.1', '127.1', '2130706433', '0177.0.0.1', '0x7f.0.0.1', '127.0.0x0.1',
  '0x7f000001', '0000153.0000255.0000011.0000125', '120.229.26.0138', '103.103.20.102.84',
  '999.999.999.999', 'dga.123', 'dga.0x', 'dga.0x123', '\uff11\uff12\uff17.\uff10.\uff10.\uff11',
  '[::1]', '[2001:db8::1]', '2001:db8::1',
  'localhost', 'host.localhost', 'host.local', 'host.localdomain', 'host.home', 'host.home.arpa',
  'host.lan', 'host.internal', 'host.intranet', 'host.corp', 'host.test', 'host.invalid', 'host.example',
  'dummy-tf-test-dummy-2t4navcd.example', 'example-probe-does-not-exist-12345.invalid',
  'example.com', 'sub.example.net', 'www.example.org.', '1.0.0.127.in-addr.arpa', 'b.a.ip6.arpa',
  'resolver.arpa', 'host\u3002example', 'host\uff0einvalid',
  'bad..feed-fixture.net', '-bad.feed-fixture.net', 'bad-.feed-fixture.net', 'a'.repeat(64) + '.net',
  maxHost + 'e', 'xn--zz.net', 'xn--a.net', 'host_name.net',
  'https://feed-fixture.net/path', 'user@feed-fixture.net', 'feed-fixture.net:443',
  'feed-fixture.net/path', 'feed-fixture.net?query', 'feed-fixture.net#fragment',
  'feed-fixture.net\\\u00e9vil', 'feed-fixture.net%2f\u00e9vil',
  'tenant.github.io^$script', '@@||tenant.github.io^', '*.tenant.github.io',
];
const forms = [
  host => '! Plain domain list\n' + host,
  host => '0.0.0.0 ' + host,
  host => '127.0.0.1 ' + host,
  host => '::1 ' + host,
  host => '||' + host + '^',
  host => JSON.stringify({ domains: [host] }),
];
async function run() {
  for (const [host, expected] of accepted) for (const form of forms) {
    assert.deepEqual(parse(form(host)), [expected], form(host));
  }
  for (const host of rejected) for (const form of forms) {
    assert.deepEqual(parse(form(host)), [], form(host));
  }
  assert.deepEqual(parse(JSON.stringify({ domains: ['feed-fixture.net\nother.net'] })), [], 'JSON strings cannot add host records through control characters');
  assert.throws(() => parse('[2001:db8::1]'), /Integrity guard rejected source:/, 'an ambiguous malformed JSON source is rejected atomically');
  const mixed = ['! title', '0.0.0.0 pixel.feed-fixture.net host.test second.feed-fixture.net',
    '||PIXEL.FEED-FIXTURE.NET^', 'host.invalid', 'b\u00fccher.de', 'xn--bcher-kva.de',
    'https://feed-fixture.net/path', 'tenant.github.io', 'github.io'].join('\n');
  const expected = ['pixel.feed-fixture.net', 'second.feed-fixture.net', 'xn--bcher-kva.de', 'tenant.github.io'];
  assert.deepEqual(parse(mixed), expected, 'normalization, tenant boundaries and first-seen order survive');
  assert.deepEqual(parse(JSON.stringify({ blocklist: ['pixel.feed-fixture.net', 'host.test'],
    allowlist: ['safe.feed-fixture.net'], fuzzylist: ['brand.feed-fixture.net'] })), ['pixel.feed-fixture.net']);
  const large = Array.from({ length: 8500 }, (_, i) => i % 3 ? 'h' + i + '.feed-fixture.net' : rejected[i % rejected.length]).join('\n');
  assert.deepEqual(Array.from(await parser.parseListInSlices(large)), parse(large), 'sliced and synchronous parsing reject the same inputs');
  const from = source.indexOf('function parseList('), to = source.indexOf('\n}\n', from);
  assert(from >= 0 && to > from, 'whole-host parser is available to the URL allocation fixture');
  let urlParses = 0;
  class CountingURL extends URL { constructor(value) { super(value); urlParses++; } }
  const context = vm.createContext({ URL: CountingURL, isUnsafeFeedBlockTarget: () => false, isFeedFalsePositiveDomain: () => false });
  vm.runInContext(fs.readFileSync('idn-utils.js', 'utf8') + '\n' + source.slice(from, to + 3), context);
  const ascii = Array.from({ length: 10000 }, (_, i) => 'host-' + i + '.feed-fixture.net');
  assert.equal(context.parseList(ascii.join('\n')).length, ascii.length);
  assert.equal(urlParses, 0, 'large ordinary ASCII feeds must not construct a URL for every host');
  assert.equal(context.parseList('xn--bcher-kva.de').length, 1);
  assert.equal(urlParses, 1, 'punycode still passes browser validation');
  context.URL = class {
    constructor(value) { this.hostname = value.slice('http://'.length); this.pathname = '/'; }
  };
  for (const host of ['xn--zz.net', 'xn--a.net']) {
    assert.equal(context.parseList(host).length, 0, 'reject invalid ACE even when URL leaves ' + host + ' unchanged');
  }
  console.log('[ok] feed domains: test/local/reverse-DNS names, alternate IP spellings, DNS bounds, IDNA, host formats, JSON authority, slice parity and ASCII fast path');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

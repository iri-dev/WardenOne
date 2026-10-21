/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Compare private/local address classification across worker, page and DNR implementations.
   Run: node tools/test-ip-classifier-agreement.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}
function between(src, from, to, what) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(what + ' not found');
  return src.slice(a, b);
}

const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(between(BG, 'function ipv4FromMappedIpv6(', 'function ipFromUrl(', 'the address helpers')
  + between(BG, 'function classifyResolvedIp(', 'function rebindQuarantineRules(', 'classifyResolvedIp')
  + between(BG, 'const INTRANET_NET_PATTERNS = [', '];', 'the intranet patterns') + '];'
  + '\nthis.api = { normalizeIpLiteral, isLocalOrPrivateHost, classifyResolvedIp, ipv6Range, INTRANET_NET_PATTERNS };',
sandbox, { filename: 'background.js:ip-classifiers' });
const bg = sandbox.api;
const intranet = bg.INTRANET_NET_PATTERNS.map((p) => new RegExp(p));

/* The engine's local-admin check: the IP lines of localAdminTarget, run on the hostname the URL
   parser produces (which is what the engine sees). */
const adminBlock = between(SRC, 'const localAdminTarget=raw=>{', 'if(/\\.(local|localdomain|lan|home|internal|intranet|corp)$/i.test(h))return!0;', 'localAdminTarget');
const adminRes = (adminBlock.match(/if\(\/\^[^\n]*?\/i\.test\(h\)\)return!0;/g) || []).map((line) => {
  const m = /if\((\/\^.*\/i)\.test\(h\)\)return!0;/.exec(line);
  return vm.runInNewContext(m[1]);
});
function engineSaysLocal(host) {
  const h = new URL('http://[' + host + ']/').hostname.replace(/^\[|\]$/g, '');
  return adminRes.some((re) => re.test(h));
}
function ruleSaysLocal(host) {
  const url = new URL('http://[' + host + ']/').href;
  return intranet.some((re) => re.test(url));
}

/* [address, private-or-local?] */
const TABLE = [
  ['fe80::1', true], ['fe8f::1', true], ['fe90::1', true], ['fea0::1', true], ['feb0::1', true], ['febf:ffff::1', true],
  ['FE90::1', true], ['fe80:0000:0000::1', true],
  ['fe7f::1', false], ['fec0::1', false], ['fe00::1', false],
  ['fc00::1', true], ['fd12:3456::1', true], ['fdff::1', true], ['fbff::1', false], ['fc::1', false],
  ['::1', true], ['0:0:0:0:0:0:0:1', true],
  ['::ffff:10.0.0.1', true], ['::ffff:a00:1', true], ['::ffff:127.0.0.1', true], ['::ffff:192.168.1.1', true],
  ['::ffff:172.20.0.1', true], ['::ffff:169.254.1.1', true],
  ['::ffff:8.8.8.8', false], ['::ffff:172.32.0.1', false],
  ['2606:4700:4700::1111', false], ['2a00:1450:4001::200e', false],
];

console.log('background: normalizeIpLiteral / isLocalOrPrivateHost');
for (const [ip, local] of TABLE) {
  check((local ? 'local  ' : 'public ') + ip, (bg.normalizeIpLiteral(ip) === '') === local && bg.isLocalOrPrivateHost('[' + ip + ']') === local,
    'normalizeIpLiteral=' + JSON.stringify(bg.normalizeIpLiteral(ip)) + ' isLocalOrPrivateHost=' + bg.isLocalOrPrivateHost('[' + ip + ']'));
}
console.log('background: the DNS-rebinding classifier agrees');
for (const [ip, local] of TABLE) {
  const c = bg.classifyResolvedIp(ip);
  check(ip + ' -> ' + c, (c !== 'public') === local);
}
console.log('the intranet network rule agrees');
for (const [ip, local] of TABLE) check(ip, ruleSaysLocal(ip) === local, 'rule matched: ' + ruleSaysLocal(ip));
console.log('the engine\'s local-admin check agrees');
for (const [ip, local] of TABLE) check(ip, engineSaysLocal(ip) === local, 'engine matched: ' + engineSaysLocal(ip));

console.log('the rest of the special ranges');
check('multicast and documentation addresses are not public', bg.normalizeIpLiteral('ff02::1') === '' && bg.normalizeIpLiteral('2001:db8::1') === '');
check('the unspecified address is not public', bg.normalizeIpLiteral('::') === '' && bg.classifyResolvedIp('::') === 'loopback');
check('a public address comes back in canonical form', bg.normalizeIpLiteral('2606:4700:4700:0000::1111') === '2606:4700:4700::1111');
check('nonsense is not an address', bg.normalizeIpLiteral('fe80::zz') === '' && bg.ipv6Range('fe80::zz') === 'invalid');
check('one IPv6 classifier: both background classifiers call ipv6Range',
  /return ipv6Range\(ip\) === 'public' \? canonicalIpv6\(ip\) : '';/.test(BG) && /const range = ipv6Range\(ip\);/.test(BG));
check('the "fe80"-only test is gone everywhere', !/\bfe80\)/.test(BG) && !/\|fe80\):/.test(SRC));

if (failed) { console.error('\n' + failed + ' classifier check(s) failed'); process.exit(1); }
console.log('\nall IP classifier agreement checks passed');

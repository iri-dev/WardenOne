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
  + between(BG, 'const INTRANET_LOOPBACK_PATTERNS = [', '// Sign-in pages whose content', 'the intranet patterns')
  + '\nthis.api = { normalizeIpLiteral, isLocalOrPrivateHost, classifyResolvedIp, intranetTargetHost, ipv6Range,'
  + ' INTRANET_NET_PATTERNS, INTRANET_PATTERN_EXCLUDED_HOSTS };',
sandbox, { filename: 'background.js:ip-classifiers' });
const bg = sandbox.api;
/* DNR regex filters are case-insensitive unless a rule says otherwise. */
const intranet = bg.INTRANET_NET_PATTERNS.map((p) => [new RegExp(p, 'i'), bg.INTRANET_PATTERN_EXCLUDED_HOSTS.get(p) || []]);
function ruleMatchesUrl(url) {
  const host = new URL(url).hostname;
  return intranet.some(([re, excluded]) => re.test(url) && !excluded.some((d) => host === d || host.endsWith('.' + d)));
}

/* The engine's whole localAdminTarget, as shipped in the source, given the URL parser it uses. */
const engineSource = between(SRC, 'const localAdminTarget=raw=>{', 'publicPage=()=>', 'localAdminTarget').replace(/,\s*$/, ';');
const engineSandbox = { URL, u2: (s) => { try { return new URL(s); } catch (_) { return null; } } };
vm.createContext(engineSandbox);
vm.runInContext(engineSource + '\nthis.localAdminTarget = localAdminTarget;', engineSandbox, { filename: 'src/content.js:localAdminTarget' });
const engineMatchesUrl = engineSandbox.localAdminTarget;

function engineSaysLocal(host) {
  return engineMatchesUrl(new URL('http://[' + host + ']/').href);
}
function ruleSaysLocal(host) {
  return ruleMatchesUrl(new URL('http://[' + host + ']/').href);
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

/* What Intranet Guard refuses: intranetTargetHost is the policy, and the network rules and the
   engine must give the same answer for every host. [host, refused?] */
const TARGETS = [
  ['localhost', true], ['localhost.', true], ['app.localhost', true], ['app.localhost.', true],
  ['127.0.0.1', true], ['127.1.2.3', true], ['0.0.0.0', true], ['0.1.2.3', true],
  ['10.0.0.1', true], ['100.64.0.1', true], ['100.100.100.100', true], ['100.127.255.254', true],
  ['169.254.169.254', true], ['172.16.0.1', true], ['172.31.255.254', true], ['192.168.1.1', true],
  ['[::1]', true], ['[::]', true], ['[fd00::1]', true], ['[fe80::1]', true],
  ['[::ffff:100.64.0.1]', true], ['[::ffff:0.1.2.3]', true], ['[::ffff:192.168.1.1]', true],
  ['nas', true], ['nas.', true], ['printer', true], ['router.lan', true], ['router.lan.', true],
  ['nas.local', true], ['box.localdomain', true], ['pi.home', true], ['nas.home.arpa', true],
  ['svc.internal', true], ['wiki.intranet', true], ['git.corp', true], ['myapp.test', true],
  ['x.invalid', true], ['x.example', true],
  ['example.com', false], ['example.com.', false], ['10.example.com', false], ['127.example.org', false],
  ['192.168.advertiser.com', false], ['100.example.com', false], ['10.0.0.1.example.com', false],
  ['100.63.255.255', false], ['100.128.0.1', false], ['172.15.0.1', false], ['172.32.0.1', false],
  ['8.8.8.8', false], ['192.0.2.1', false], ['198.18.0.1', false], ['224.0.0.1', false],
  ['[2606:4700:4700::1111]', false], ['[2001:db8::1]', false], ['[ff02::1]', false], ['[::ffff:8.8.8.8]', false],
  ['local.example.com', false], ['localhost.example.com', false], ['mylocalhost.com', false],
  ['evil-localhost.com', false], ['myapp.test.example.com', false], ['home.arpa.example.com', false],
];
console.log('Intranet Guard: the policy, the network rules and the engine agree');
for (const [host, refused] of TARGETS) {
  for (const url of ['http://' + host + '/', 'https://' + host + ':8443/app.js', 'ws://u@' + host + ':9000/socket']) {
    const href = new URL(url).href;
    const policy = bg.intranetTargetHost(new URL(href).hostname);
    const rule = ruleMatchesUrl(href);
    const engine = engineMatchesUrl(href);
    check((refused ? 'refused  ' : 'allowed  ') + href, policy === refused && rule === refused && engine === refused,
      'policy=' + policy + ' rule=' + rule + ' engine=' + engine);
  }
}
console.log('userinfo is never mistaken for the host');
for (const url of ['https://nas:pw@example.com/', 'https://localhost:pw@example.com/', 'https://10.0.0.1:x@example.com/',
  'https://router.lan:1@example.com/', 'wss://printer@example.com/socket']) {
  check(url, !ruleMatchesUrl(url) && !engineMatchesUrl(url), 'rule=' + ruleMatchesUrl(url) + ' engine=' + engineMatchesUrl(url));
}
check('the rebinding observer leaves to Intranet Guard exactly what it refuses',
  /if \(intranetTargetHost\(host\)\) return;/.test(BG) && !/if \(isLocalOrPrivateHost\(host\)\) return;/.test(BG));

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

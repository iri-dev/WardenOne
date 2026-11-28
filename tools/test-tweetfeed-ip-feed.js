/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* TweetFeed feed: only bare public IPv4 addresses come out of the CSV, and they reach the security packs. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start > 0 && end > start, 'missing ' + from);
  return source.slice(start, end);
};
const context = vm.createContext({ URL, Set, Number, String, setTimeout, Promise,
  wardenOnePunycodeDecode: (s) => s, isUnsafeFeedBlockTarget: () => false, isFeedFalsePositiveDomain: () => false,
  LIST_PARSE_SLICE_LINES: 3 });
vm.runInContext(slice('function ipv4FromMappedIpv6(', 'function isLocalOrPrivateHost(')
  + slice('const TWEETFEED_IOC_LIST_URL', '/* Download Guard data')
  + slice('/* options.ipv4: a security feed', 'async function compileRemoteNetworkSource(')
  + slice('function validNetworkRuleScope(', 'function acceptableNetworkRuleHost(')
  + ';this.api={read:tweetFeedIocAddresses,compile:compileTweetFeedSource,url:TWEETFEED_IOC_LIST_URL,scope:validNetworkRuleScope,'
  + 'parse:parseList,sliced:parseListInSlices};', context);
const api = context.api;
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
/* Values cross from the sandbox, whose arrays have their own prototype, so compare them as JSON. */
const eq = (a, b, message) => { assert.equal(JSON.stringify(a), JSON.stringify(b), message); checks++; };

const csv = [
  '2026-11-07 04:22:47,someone,ip,45.38.60.192,#APT,https://x.com/someone/status/1',
  '2026-11-07 04:22:48,someone,url,http://23.94.145.224/login,#malware,https://x.com/someone/status/2',
  '2026-11-07 04:22:49,someone,url,https://199.91.221.237:3000,#C2,https://x.com/someone/status/3',
  '2026-11-07 04:22:50,someone,ip,45.38.60.192,#APT,https://x.com/someone/status/4',
  '2026-11-07 04:22:51,someone,domain,bad.example.com,#phishing,https://x.com/someone/status/5',
  '2026-11-07 04:22:52,someone,url,https://bad.example.com/a.exe,#malware,https://x.com/someone/status/6',
  '2026-11-07 04:22:53,someone,sha256,' + 'a'.repeat(64) + ',#malware,https://x.com/someone/status/7',
  '2026-11-07 04:22:54,someone,ip,192.168.1.10,#oops,https://x.com/someone/status/8',
  '2026-11-07 04:22:55,someone,ip,198.51.100.23,#doc,https://x.com/someone/status/9',
  '2026-11-07 04:22:56,someone,ip,8.8.8.8,#mistake,https://x.com/someone/status/10',
  '2026-11-07 04:22:57,someone,ip,1.1.1.1,#mistake,https://x.com/someone/status/11',
  '2026-11-07 04:22:58,someone,ip,999.1.2.3,#bad,https://x.com/someone/status/12',
  '2026-11-07 04:22:59,someone,ip,010.1.2.3,#octal,https://x.com/someone/status/13',
  '2026-11-07 04:23:00,someone,ip,2001:db8::1,#v6,https://x.com/someone/status/14',
  '2026-11-07 04:23:01,someone,url,http://[2001:db8::1]/x.exe,#v6,https://x.com/someone/status/15',
  '2026-11-07 04:23:02,someone,IP, 77.239.124.167 ,#space,https://x.com/someone/status/16',
  'garbage line',
  '',
  '2026-11-07 04:23:03,someone,url,not a url,#x,https://x.com/someone/status/17',
].join('\r\n');

eq(api.read(csv), ['45.38.60.192', '23.94.145.224', '199.91.221.237', '77.239.124.167'],
  'reported IPs and IP-literal URL hosts, deduplicated, public only, nothing else');
const compiled = api.compile(csv);
eq(compiled.optionRules, [], 'no path rules from this source');
eq(compiled.redirectRules, [], 'no redirects');
eq(compiled.cspRules, [], 'no CSP rules');
eq(compiled.acceptedDomainEntries, 4, 'counted for the integrity guard');
eq(api.read(''), [], 'an empty feed gives nothing');
eq(api.read('date,user,type,value,tags,tweet'), [], 'a header row gives nothing');
const big = Array.from({ length: 30000 }, (_, i) => 'd,u,ip,' + (20 + (i >> 16)) + '.' + ((i >> 8) & 255) + '.' + (i & 255) + '.9,#t,x').join('\n');
ok(api.read(big).length <= 20000, 'capped');
for (const ip of api.read(csv)) ok(api.scope(ip), 'an IP passes the rule scope check: ' + ip);

/* Security feeds keep their bare IP entries; every other feed still refuses numeric names. */
const listText = ['0.0.0.0 45.38.60.192', '||23.94.145.224^', '93.184.216.34', 'badsite-shop.com', '192.168.1.1', '8.8.8.8',
  '203.0.113.9', '010.1.2.3', '1.2.3', '0.0.0.0 evil-loader.net'].join('\n');
eq(api.parse(listText, null, { ipv4: true }), ['45.38.60.192', '23.94.145.224', '93.184.216.34', 'badsite-shop.com', 'evil-loader.net'],
  'security feed: public IPs kept beside names, private, documentation and resolver addresses refused');
eq(api.parse(listText), ['badsite-shop.com', 'evil-loader.net'], 'without the option nothing numeric gets through, as before');
(async () => {
  eq(await api.sliced(listText + '\n' + listText, null, { ipv4: true }), ['45.38.60.192', '23.94.145.224', '93.184.216.34', 'badsite-shop.com', 'evil-loader.net'],
    'the sliced parser passes the option on and still deduplicates');
  const urlhausIps = ['# Title: Online Malicious IPs Blocklist', '1.92.101.221', '1.92.136.152', '10.0.0.8', ''].join('\n');
  eq(await api.sliced(urlhausIps, null, { ipv4: true }), ['1.92.101.221', '1.92.136.152'], 'URLhaus IP file: public addresses only');

  /* Wiring. */
  ok(/const MALWARE_LISTS = \[[\s\S]*'https:\/\/raw\.githubusercontent\.com\/0xDanielLopez\/TweetFeed\/master\/month\.csv',[\s\S]*'https:\/\/malware-filter\.gitlab\.io\/urlhaus-filter\/urlhaus-filter-dnscrypt-blocked-ips-online\.txt',\s*\];/.test(source),
    'TweetFeed and the URLhaus IP file are malware lists, so they get security packs and need Block known malicious sites');
  ok(/url: 'https:\/\/malware-filter\.gitlab\.io\/urlhaus-filter\/urlhaus-filter-online\.txt',\s*kind: 'payload-urls'/.test(source),
    'Download Guard keeps reading the big file for its exact payload addresses; the list update never fetches it');
  ok(!/const MALWARE_LISTS = \[[^\]]*urlhaus-filter-online\.txt/.test(source), 'so the 12 MB file is not downloaded twice');
  ok(/compileRemoteNetworkSource\(text, OPTION_RULES_PER_SOURCE_CAP, \{ ipv4: security \}\)/.test(source)
    && /const security = remoteListSourceKind\(url\) === 'security';/.test(source), 'only security feeds keep IPs');
  finish();
})().catch((error) => { console.error(error); process.exit(1); });
function finish() {
eq(api.url, 'https://raw.githubusercontent.com/0xDanielLopez/TweetFeed/master/month.csv', 'the constant names the listed URL');
ok(/const tweetFeed = url === TWEETFEED_IOC_LIST_URL;\s*const compiled = tweetFeed \? compileTweetFeedSource\(text\)/.test(source),
  'the list fetch reads TweetFeed with its own reader, never the domain parser');
/* Its integrity baseline must know which reader made it, or a reader change refuses every copy (2026-11-21..26). */
ok(/parseListPublisherDate\(text\),\s*tweetFeed \? 'tweetfeed-ip' : 'list'\s*\)/.test(source),
  'the integrity check is told which reader produced the entries');
const licensing = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'source-licensing.json'), 'utf8'));
const profile = licensing.profiles.tweetfeed;
ok(profile && profile.license.id === 'CC0-1.0' && profile.urls.includes(api.url), 'licence recorded');
ok(profile.compliance.implementation.some((line) => /IPv4/.test(line)), 'the register says only addresses are kept');

console.log('[ok] feed IP addresses (TweetFeed, URLhaus online, security feeds): ' + checks + ' checks');
}

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Feeds must not block shared platforms whole-host, and oisd big must not call ad companies dangerous.
   The Browser Guard 1v1 (2026-11-13) found every bit.ly link, all of Google Sites and Firebase Storage
   images on every site blocked, and media.net, tapad.com, company-target.com and visiblemeasures.com
   shown as "Dangerous Site".
   Run: node tools/test-feed-shared-platforms.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadNetworkParser } = require('./bench-filter-parsing.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const parser = loadNetworkParser(BG);
const parse = (text) => Array.from(parser.parseList(text));
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

/* Every shared host a feed listed bare during the 1v1, in every form a feed writes a host. */
const SHARED = ['bit.ly', 'sites.google.com', 'firebasestorage.googleapis.com', 'pastebin.com', 'telegra.ph', 'qrco.de',
  'cloudflare-ipfs.com', 'dweb.link', 'gateway.pinata.cloud', 's.id', 'shorturl.at', 't.co', 'www.dropbox.com',
  's3.eu-west-2.amazonaws.com', 'f005.backblazeb2.com', 'docs.google.com',
  /* Round 5 (2026-11-14): Phishing.Database listed the AMP cache bare, so every AMP link showed "Dangerous Site". */
  'cdn.ampproject.org', 'ampproject.org', 'bing-amp.com'];
const forms = [(h) => h, (h) => '0.0.0.0 ' + h, (h) => '||' + h + '^', (h) => JSON.stringify({ domains: [h] })];
for (const host of SHARED) for (const form of forms) ok(parse(form(host)).length === 0, 'whole-host entry ignored: ' + form(host));

/* A tenant of its own, and ordinary hosts, are still blocked whole-host. github.com stays blockable by a
   security feed's confirmed entry (see test-infrastructure-threat-precedence.js). */
for (const host of ['phish-tenant.s3.amazonaws.com', 'evil-login.feed-fixture.net', 'bit.ly.feed-fixture.net', 'notbit.ly', 'github.com',
  'evil-phish-com.cdn.ampproject.org', 'cdn.ampproject.org.evil-login-feed-fixture.net'])
  ok(parse(host).length === 1, 'ordinary or tenant host still accepted: ' + host);

/* URL feeds still reach the one bad page on a shared platform. */
const pathRules = Array.from(parser.parseNetworkRules('||sites.google.com/view/evil-page^$document\n||bit.ly/3AbCdEf^$document\n||cdn.ampproject.org/c/s/evil-login-feed-fixture.net/login^$document', 700, 10));
ok(pathRules.length === 3 && pathRules.every((r) => /\/(view\/evil-page|3AbCdEf|c\/s\/evil-login-feed-fixture\.net\/login)/.test(r.condition.urlFilter)),
  'path rules on shared platforms are kept: ' + JSON.stringify(pathRules.map((r) => r.condition.urlFilter)));

/* A bare ||host^ rule with options blocks every tenant unless it names the sites it applies on. */
ok(Array.from(parser.parseNetworkRules('||bit.ly^$document', 700, 10)).length === 0, 'bare shared-host rule with options is dropped');
ok(Array.from(parser.parseNetworkRules('||bit.ly^$popup,domain=dexerto.com', 700, 10)).length === 0, 'popup rules stay unsupported');
const scoped = Array.from(parser.parseNetworkRules('||bit.ly^$script,domain=dailyuploads.net', 700, 10));
ok(scoped.length === 1 && scoped[0].condition.initiatorDomains.includes('dailyuploads.net'), 'a site-scoped rule on a shared host is kept');

/* oisd big: held, then settled against the ad and tracker lists once every list is in. */
const settle = /function settleAdOverlapCandidates\([\s\S]*?\n\}/.exec(BG);
ok(!!settle, 'settleAdOverlapCandidates exists');
const box = vm.createContext({});
vm.runInContext(settle[0] + '\nthis.settle = settleAdOverlapCandidates;', box);
const buckets = { security: new Set(['evil-download.example']), tracker: new Set(['media.net', 'tapad.com']), adshield: new Set(['adnet.example']) };
box.settle(new Set(['media.net', 'tapad.com', 'cdn.adnet.example', 'evil-download.example', 'gift-airdrop.example']), buckets);
ok(!buckets.security.has('media.net') && !buckets.security.has('tapad.com'), 'an ad company named by an ad list is not security');
ok(!buckets.security.has('cdn.adnet.example') && buckets.tracker.has('cdn.adnet.example'), 'a name under an ad-list parent is tracker kind');
ok(buckets.security.has('gift-airdrop.example'), 'an oisd name no ad list carries stays security');
ok(buckets.security.has('evil-download.example'), 'a name another security feed carries stays security');

/* Wiring: oisd is still downloaded as a malware feed, held, and settled before rules are built. */
const update = BG.slice(BG.indexOf('const domainBuckets = { security: new Set()'), BG.indexOf('const listRules = await listDomainRules(domainBuckets, merged, feedDomainCounts);'));
ok(/'https:\/\/raw\.githubusercontent\.com\/sjhgvr\/oisd\/main\/domainswild2_big\.txt'/.test(BG.slice(BG.indexOf('const MALWARE_LISTS = ['), BG.indexOf('];', BG.indexOf('const MALWARE_LISTS = [')))),
  'oisd big is still one of the malware feeds');
ok(/const adOverlapSources = new Set\(\['https:\/\/raw\.githubusercontent\.com\/sjhgvr\/oisd\/main\/domainswild2_big\.txt'\]\);/.test(update), 'oisd big is held for settling');
ok(/if \(holdForAdOverlap\) adOverlapCandidates\.add\(d\);\s*else domainBuckets\[sourceKind\]\.add\(d\);/.test(update), 'held names skip the security bucket');
ok(/settleAdOverlapCandidates\(adOverlapCandidates, domainBuckets\);/.test(update), 'held names are settled before rules are built');

/* Grabber and miner names drop any path they carry, so "bit.ly/abc" must not become all of bit.ly. */
const region = (from, to) => { const a = BG.indexOf(from), b = BG.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return BG.slice(a, b); };
const liftFn = (name) => (new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}').exec(BG) || [''])[0];
const guardBox = vm.createContext({ URL });
vm.runInContext([fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'idn-utils.js'), 'utf8'),
  region('const NEVER_BLOCK_PUBLIC_SUFFIXES', 'function isNeverBlockDomain('), liftFn('addGrabberFeedDomains'), liftFn('addMinerDomains'),
  'this.grabber = addGrabberFeedDomains; this.miner = addMinerDomains; this.guard = isUnsafeFeedBlockTarget;'].join('\n'), guardBox);
for (const [name, build] of [['grabber', guardBox.grabber], ['miner', guardBox.miner]]) {
  const into = new Set();
  build(['bit.ly/AbC123', 'www.dropbox.com/s/x', 'grabify.link/*', 'coinhive-fixture.net'], into);
  ok(!into.has('bit.ly') && !into.has('dropbox.com') && !into.has('www.dropbox.com'), name + ' names never widen to a shared host: ' + [...into]);
  ok(into.has('grabify.link') && into.has('coinhive-fixture.net'), name + ' names on their own hosts are kept: ' + [...into]);
}
ok(guardBox.guard('bit.ly') === true && guardBox.guard('bit.ly', true) === false, 'path rules may name a shared host; whole-host entries may not');

/* Round 5 P2-1: annoyance and tracker lists blocked OneTrust, Didomi and Usercentrics, so no banner appeared and no
   refusal was ever recorded (OneTrust 0/3). The banner hosts are never-block now; their analytics hosts are not. */
const neverBox = vm.createContext({ URL, LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: [] });
vm.runInContext([fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'idn-utils.js'), 'utf8'),
  region('const NEVER_BLOCK_DOMAINS = new Set([', 'function isNeverBlockDomain('), liftFn('isGithubUploadInfraDomain'), liftFn('isNeverBlockDomain'),
  'this.never = isNeverBlockDomain; this.consent = CONSENT_MANAGER_HOSTS;'].join('\n'), neverBox);
for (const host of ['cdn.cookielaw.org', 'geolocation.onetrust.com', 'sdk.privacy-center.org', 'app.usercentrics.eu',
  'consent.cookiebot.com', 'consentcdn.cookiebot.com', 'cdn.privacy-mgmt.com', 'quantcast.mgr.consensu.org', 'consent.trustarc.com']) {
  ok(neverBox.never(host) === true, 'a consent banner host loads past tracker and annoyance lists: ' + host);
}
for (const host of ['uct.service.usercentrics.eu', 'privacy-analytics-proxy.cookiebot.com', 'smetrics.onetrust.com', 'trustarc.com',
  'onetrust.com', 'cookiebot.com', 'cookielaw.org.evil-consent.net', 'onetrust.com.cookie-check.net']) {
  ok(neverBox.never(host) === false, 'a consent company analytics host or lookalike stays blockable: ' + host);
}
ok(/if \(remoteRuleSourceKind\(sourceKind\) === 'security'\) return true;\n  return !isNeverBlockDomain\(host\)/.test(BG), 'a security list still blocks a consent host');
/* Radio Times lost its typefaces: a tracker list named Adobe Fonts' kit loader. */
ok(neverBox.never('use.typekit.net') === true, 'Adobe Fonts kit loader loads');
ok(neverBox.never('p.typekit.net') === false && neverBox.never('typekit.net') === false, 'Adobe Fonts usage beacon stays blockable');

console.log('feed shared-platform checks passed: ' + checks);

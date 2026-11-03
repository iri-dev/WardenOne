/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadBackground } = require('./test-message-rate-limits.js');
const url = 'https://threatview.io/Downloads/DOMAIN-High-Confidence-Feed.txt';
const liteUrl = 'https://raw.githubusercontent.com/badmojr/1Hosts/master/Lite/adblock.txt';
const scamUrl = 'https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt';
async function run() {
  const h = loadBackground();
  await new Promise(resolve => setTimeout(resolve, 100));
  const state = new Map(), requests = [];
  h.chrome.declarativeNetRequest.getDynamicRules = async ({ ruleIds } = {}) => [...state.values()].filter(rule => !ruleIds || ruleIds.includes(rule.id));
  h.chrome.declarativeNetRequest.updateDynamicRules = async change => {
    for (const id of change.removeRuleIds || []) state.delete(id);
    for (const rule of change.addRules || []) state.set(rule.id, rule);
  };
  const root = path.resolve(__dirname, '..');
  const shared = 'duplicate.feed-fixture.net', malicious = 'tv-malicious.feed-fixture.net';
  const fixture = [malicious, shared, 'b\u00fccher.de', 'fileditch.com', 'www.fileditch.com', 'bad.fileditch.com', 'host.example', 'host.invalid',
    '1.0.0.127.in-addr.arpa', '0000153.0000255.0000011.0000125', 'xn--zz.net'].join('\n');
  const adHost = 'ads.onehosts-feed-fixture.net';
  const liteFixture = [adHost, shared, 'tenant.github.io', 'github.io', 'youtube.com', 'accounts.google.com',
    'raw.githubusercontent.com', 'host.invalid'].map(host => '||' + host + '^').join('\n');
  const gameHosts = ['gamedrive.org', 'www.gamedrive.org'];
  const gameThreats = ['bad.gamedrive.org', 'gamedrive.org.attacker.net'];
  const scamFixture = [shared, ...gameHosts, ...gameThreats].map(host => '0.0.0.0 ' + host).concat(
    '||gamedrive.org/payload.exe$script', '||www.gamedrive.org/payload.zip$xmlhttprequest').join('\n');
  const otherSecurityUrl = vm.runInContext('MALWARE_LISTS[0]', h.ctx);
  let independentGameVerdict = false;
  h.ctx.fetch = async (input, options) => {
    const address = String(input);
    if (address.startsWith(h.chrome.runtime.getURL(''))) {
      const file = path.resolve(root, address.slice(h.chrome.runtime.getURL('').length));
      assert(file.startsWith(root + path.sep));
      return new Response(fs.readFileSync(file), { status: 200 });
    }
    requests.push({ url: address, options });
    return new Response(address === url ? fixture : address === liteUrl ? liteFixture : address === scamUrl ? scamFixture
      : independentGameVerdict && address === otherSecurityUrl ? gameHosts.join('\n') : shared, { status: 200 });
  };
  const setConfig = patch => h.ctx.updateStoredConfig(cfg => Object.assign(cfg, patch));
  await setConfig({ enabled: true, autoUpdateLists: false, blockMalwareSites: true, blockTrackers: false, adShield: false });
  assert(vm.runInContext('MALWARE_LISTS.includes(' + JSON.stringify(url) + ')', h.ctx));
  assert.equal(h.ctx.remoteListSourceKind(url), 'security');
  const policy = h.ctx.validateRemoteListSource(url, true);
  assert.equal(policy.ok, true); assert.equal(policy.maxBytes, 18 * 1024 * 1024);
  assert.equal(h.ctx.validateRemoteListSource(url + '?different=1', true).ok, false);
  const result = await h.ctx.updateRemoteListsCore('manual');
  assert.equal(result.ok, true, result.error);
  const source = result.meta.feedDomainCounts.find(source => source.url === url);
  assert.equal(source.listedCount, 4);
  assert.equal(source.activeCount, 3, 'overlap is claimed only once');
  const rule = [...state.values()].find(rule => rule.condition.requestDomains?.includes(malicious));
  assert(rule && rule.action.type === 'block' && rule.priority === 3000);
  assert(rule.condition.resourceTypes.includes('main_frame') && rule.condition.resourceTypes.includes('media'));
  assert(![...state.values()].some(rule => rule.condition.requestDomains?.includes('fileditch.com')));
  assert([...state.values()].some(rule => rule.condition.requestDomains?.includes('bad.fileditch.com')));
  assert.equal(h.ctx.remoteListBlockAllowed('fileditch.com', '', 'security', 'https://other.feed-fixture.net/domains.txt'), true);
  assert.equal(h.ctx.remoteListBlockAllowed('fileditch.com.attacker.net', '', 'security', url), true);
  const nativeGameBlocks = () => [...state.values()].filter(rule => rule.action.type === 'block'
    && rule.condition.requestDomains?.some(host => gameHosts.includes(host)));
  for (const host of gameHosts) {
    assert.equal(h.ctx.remoteListBlockAllowed(host, '', 'security', scamUrl), false, host);
    for (const source of [undefined, otherSecurityUrl, scamUrl + '?different=1', scamUrl.replace('https:', 'http:')]) {
      assert.equal(h.ctx.remoteListBlockAllowed(host, '', 'security', source), true, host + ': ' + source);
    }
    assert.equal(vm.runInContext('SECURITY_DOMAINS.has(' + JSON.stringify(host) + ')', h.ctx), false);
    assert.equal(h.ctx.searchResultVerdictForHost(host, { allowlist: [] }), null, host + ': excluded source adds no warning');
  }
  assert.equal(nativeGameBlocks().length, 0, 'the source exclusion adds no whole-domain block');
  assert.equal(result.meta.feedDomainCounts.find(source => source.url === scamUrl).listedCount, 3);
  for (const host of gameThreats) {
    assert.equal(h.ctx.remoteListBlockAllowed(host, '', 'security', scamUrl), true);
    assert([...state.values()].some(rule => rule.action.type === 'block' && rule.priority === 3000
      && rule.condition.requestDomains?.includes(host)), host);
  }
  for (const pattern of ['||gamedrive.org/payload.exe', '||www.gamedrive.org/payload.zip']) {
    assert.equal(h.ctx.remoteListBlockAllowed(h.ctx.networkRulePatternHost(pattern), pattern, 'security', scamUrl), true);
    assert([...state.values()].some(rule => rule.action.type === 'block' && rule.priority === 3000
      && rule.condition.urlFilter === pattern), pattern);
  }
  independentGameVerdict = true;
  assert.equal((await h.ctx.updateRemoteListsCore('manual')).ok, true);
  for (const host of gameHosts) {
    assert(nativeGameBlocks().some(rule => rule.condition.requestDomains.some(domain => host === domain || host.endsWith('.' + domain))),
      host + ': another feed still blocks');
    assert.equal(vm.runInContext('SECURITY_DOMAINS.has(' + JSON.stringify(host) + ')', h.ctx), true);
    assert.equal(h.ctx.searchResultVerdictForHost(host, { allowlist: [] }).label, 'On a malware and scam blocklist');
  }
  independentGameVerdict = false;
  assert.equal((await h.ctx.updateRemoteListsCore('manual')).ok, true);
  assert.equal(nativeGameBlocks().length, 0, 'a list refresh removes stale apex blocks');
  for (const host of gameHosts) {
    assert.equal(vm.runInContext('SECURITY_DOMAINS.has(' + JSON.stringify(host) + ')', h.ctx), false);
    assert.equal(h.ctx.searchResultVerdictForHost(host, { allowlist: [] }), null, host + ': stale warning cleared');
  }
  assert(![...state.values()].some(rule => rule.condition.requestDomains?.some(host => /\.(?:example|invalid|arpa)$/.test(host))), 'rejected records never enter native domain rules');
  const request = requests.find(request => request.url === url);
  assert.equal(request.options.redirect, 'manual'); assert.equal(request.options.credentials, 'omit');
  assert(!request.options.headers || !Object.keys(request.options.headers).some(key => /auth|cookie/i.test(key)));
  requests.length = 0;
  await setConfig({ blockMalwareSites: false });
  const off = await h.ctx.updateRemoteListsCore('manual');
  assert.equal(off.ok, true, off.error);
  assert(!requests.some(request => request.url === url));
  assert(!off.meta.feedDomainCounts.some(source => source.url === url));
  assert(![...state.values()].some(rule => rule.condition.requestDomains?.includes(malicious)));
  await setConfig({ adShield: true });
  requests.length = 0;
  assert(vm.runInContext('ADSHIELD_NET_LISTS.includes(' + JSON.stringify(liteUrl) + ')', h.ctx));
  assert.equal(h.ctx.remoteListSourceKind(liteUrl), 'adshield');
  assert.equal(h.ctx.validateRemoteListSource(liteUrl, true).ok, true);
  const lite = await h.ctx.updateRemoteListsCore('manual');
  assert.equal(lite.ok, true, lite.error);
  const liteSource = lite.meta.feedDomainCounts.find(source => source.url === liteUrl);
  assert.equal(liteSource.listedCount, 3); assert.equal(liteSource.activeCount, 2);
  const adRule = [...state.values()].find(rule => rule.action.type === 'block' && rule.condition.requestDomains?.includes(adHost));
  assert.equal(adRule.priority, 1000); assert.equal(adRule.condition.domainType, 'thirdParty');
  assert(!adRule.condition.resourceTypes.includes('main_frame'));
  assert([...state.values()].some(rule => rule.condition.requestDomains?.includes('tenant.github.io')));
  for (const host of ['youtube.com', 'accounts.google.com', 'raw.githubusercontent.com', 'github.io']) {
    assert(![...state.values()].some(rule => rule.action.type === 'block' && rule.condition.requestDomains?.includes(host)), host);
  }
  assert.equal(requests.filter(request => request.url === liteUrl).length, 1);
  await setConfig({ adShield: false }); requests.length = 0;
  const liteOff = await h.ctx.updateRemoteListsCore('manual');
  assert.equal(liteOff.ok, true, liteOff.error);
  assert(!liteOff.meta.feedDomainCounts.some(source => source.url === liteUrl));
  assert(!requests.some(request => request.url === liteUrl));
  assert(![...state.values()].some(rule => rule.condition.requestDomains?.includes(adHost)));
  requests.length = 0;
  await setConfig({ enabled: false, blockMalwareSites: true });
  const disabled = await h.ctx.updateRemoteListsCore('manual');
  assert.equal(disabled.skipped, true); assert.equal(requests.length, 0);
  const inventory = JSON.parse(fs.readFileSync('docs/source-inventory.json', 'utf8'));
  const notice = inventory.sources.find(source => source.url === url);
  const liteNotice = inventory.sources.find(source => source.url === liteUrl);
  assert.equal(liteNotice.license.id, 'MPL-2.0');
  assert.equal(liteNotice.compliance.status, 'implemented');
  assert.equal(liteNotice.permission.status, 'not-required');
  assert(!require('./check-store-rights.js').unresolvedRights(inventory).includes(liteUrl));
  assert.equal(notice.license.type, 'written-permission');
  assert.equal(notice.compliance.status, 'implemented');
  assert.equal(notice.compliance.issueIds.length, 0);
  assert.equal(notice.permission.status, 'granted');
  assert.equal(notice.permission.evidenceRef, 'permission-threatview-2026-11-02');
  assert(notice.compliance.conditions.some(condition => /credit ThreatView/i.test(condition)));
  assert(!require('./check-store-rights.js').unresolvedRights(inventory).includes(url));
  console.log('[ok] community feeds: ThreatView security scope, 1Hosts Lite resource scope, source-specific service exceptions, independent verdicts, targeted payloads, counts, switches and licence status');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

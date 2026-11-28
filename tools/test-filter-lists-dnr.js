/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* The uBlock and EasyPrivacy filter rulesets (tools/build-filter-lists-dnr.js): each filter keeps its whole scope or is
   skipped, list exceptions stay below WardenOne's compatibility and security bands, redirects only serve files that
   ship, and the rulesets follow the AdShield and tracker switches. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const B = require('./build-filter-lists-dnr.js');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BG = read('background.js');
const manifest = JSON.parse(read('manifest.json'));
const policy = require('./lib/network-policy.js');
const stats = () => ({ options: {} });
const rule = (line) => { const r = B.convert(line, stats()); assert(r.rule, line + ' was skipped: ' + JSON.stringify(r)); return r.rule; };
const skipped = (line) => B.convert(line, stats()).skip;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('host, party and type options become the same DNR scope', () => {
  assert.deepStrictEqual(rule('||ads.example.com^$script,third-party'), { priority: 1, action: { type: 'block' },
    condition: { requestDomains: ['ads.example.com'], domainType: 'thirdParty', resourceTypes: ['script'] } });
  assert.deepStrictEqual(rule('/pixel/track.gif$image,domain=a.com|~shop.a.com').condition,
    { urlFilter: '/pixel/track.gif', initiatorDomains: ['a.com'], excludedInitiatorDomains: ['shop.a.com'], resourceTypes: ['image'] });
  assert.deepStrictEqual(rule('||cdn.example.net/x.js$xhr,from=b.org,method=post').condition,
    { urlFilter: '||cdn.example.net/x.js', initiatorDomains: ['b.org'], requestMethods: ['post'], resourceTypes: ['xmlhttprequest'] });
  assert.deepStrictEqual(rule('*$script,3p,denyallow=cdn.site.com,domain=site.com').condition,
    { domainType: 'thirdParty', initiatorDomains: ['site.com'], excludedRequestDomains: ['cdn.site.com'], resourceTypes: ['script'] });
  assert.deepStrictEqual(rule('/collect?$to=metrics.example.com|~safe.metrics.example.com').condition,
    { urlFilter: '/collect?', requestDomains: ['metrics.example.com'], excludedRequestDomains: ['safe.metrics.example.com'] });
  assert.deepStrictEqual(rule('/track.js$~image,match-case').condition,
    { urlFilter: '/track.js', isUrlFilterCaseSensitive: true, excludedInitiatorDomains: B.ENGINE_PAGES.slice().sort(),
      excludedResourceTypes: ['image', 'main_frame'] });
  assert.strictEqual(rule('||t.example.com^$strict3p').condition.domainType, 'thirdParty');
});

test('a filter whose scope DNR cannot keep is skipped, never widened', () => {
  for (const line of ['||a.example^$script,domain=example.*', '||a.example.com^$popup', '||a.example.com^$csp=script-src none',
    '||a.example.com^$removeparam=utm', '||a.example.com^$strict1p', '||a.example.com^$redirect-rule=noopjs',
    '||a.example.com^$doc', '@@||a.example.com^$document', '@@||a.example.com^$generichide', '||a.example.com^$script,~image',
    '||a.example.com^$header=x-a', '/(?<=ad)s/', '/ad(?=s)/$script', '/(a)\\1/']) {
    assert(skipped(line), line + ' was compiled');
  }
});

test('regex filters keep RE2 syntax and stay short', () => {
  assert.deepStrictEqual(rule('/\\/t\\.js\\?site=[a-f0-9]{32}\\b/$script,3p,match-case').condition,
    { regexFilter: '\\/t\\.js\\?site=[a-f0-9]{32}\\b', isUrlFilterCaseSensitive: true, domainType: 'thirdParty',
      excludedInitiatorDomains: B.ENGINE_PAGES.slice().sort(), resourceTypes: ['script'] });
  assert.strictEqual(B.regexForDnr('a'.repeat(181)), null);
  assert.strictEqual(B.regexForDnr('\\u0041'), null);
  assert.strictEqual(B.regexForDnr('^https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/[-a-z_]{4,22}@latest\\/dist\\/script\\.min\\.js$'), null,
    'a pattern Edge refuses must not ship');
  /* Options can hold slashes of their own; the regex still ends at its own "/$". */
  assert.strictEqual(skipped('/^https:\\/\\/d[0-9a-z]{12,13}\\.cloudfront\\.net\\/loader\\.min\\.js$/$script,3p,match-case,header=etag:/^W\\/"[0-9a-f]{32}"$/'), 'option');
  assert.strictEqual(rule('/foo\\/$/$script').condition.regexFilter, 'foo\\/$');
});

test('precedence bands sit between the list blocks and WardenOne compatibility and security', () => {
  assert.strictEqual(rule('@@||cdn.example.com/lib.js$script,domain=site.com').priority, 1890);
  assert.strictEqual(rule('@@||cdn.example.com/lib.js$script').priority, 2, 'an exception for every site undoes only packaged list blocks');
  assert.strictEqual(rule('@@*$script,domain=site.com').priority, 2, 'an exception for everything on a site undoes only packaged list blocks');
  assert.strictEqual(rule('||ads.example.com^$important').priority, 1895);
  assert.strictEqual(rule('||ads.example.com/a.js$script,redirect=noopjs').priority, 1150);
  assert.strictEqual(rule('||ads.example.com/a.js$script,redirect=noopjs,important').priority, 1895);
  assert.strictEqual(rule('||imasdk.googleapis.com/js/sdkloader/ima3.js$script,redirect=google-ima.js,domain=site.com').priority, 1905,
    'a stand in on named sites outranks the broad compatibility allows');
  assert.strictEqual(rule('||imasdk.googleapis.com/js/sdkloader/ima3.js$script,redirect=google-ima.js').priority, 1150,
    'a stand in for every site stays under them');
  assert(B.PRIORITY.scopedStandIn > 1900 && B.PRIORITY.scopedStandIn < 1950 && B.PRIORITY.scopedStandIn < policy.securityMin);
  const { PRIORITY } = B;
  assert(BG.includes('const LIST_EXCEPTION_PRIORITY = ' + PRIORITY.scopedAllow + ';'),
    'downloaded list exceptions and packaged ones must share one band, under $important');
  assert(/actionType === 'allow' \? LIST_EXCEPTION_PRIORITY :/.test(BG), 'downloaded list exceptions do not use the shared band');
  assert(PRIORITY.scopedAllow > 1160, 'scoped exceptions must outrank the tracker surrogate redirects at 1160');
  assert(PRIORITY.important > PRIORITY.scopedAllow && PRIORITY.important < 1900, 'important sits under the 1900 compatibility allows');
  assert(PRIORITY.scopedAllow < 1900 && PRIORITY.scopedAllow < policy.securityMin);
});

test('redirects only serve resources WardenOne ships, and keep the filter types', () => {
  assert.deepStrictEqual(rule('||google-analytics.com/analytics.js$script,redirect=google-analytics_analytics.js').action,
    { type: 'redirect', redirect: { extensionPath: '/surrogates/analytics.js' } });
  assert.deepStrictEqual(rule('||ads.example.com/v.xml$xhr,redirect=noopvast-4.0:5').condition.resourceTypes, ['xmlhttprequest']);
  assert.strictEqual(skipped('||cdn.example.com/fab.js$script,redirect=fuckadblock.js-3.2.0'), 'redirect resource',
    'a resource WardenOne does not ship must not become a plain block');
  assert.deepStrictEqual(rule('||imasdk.googleapis.com/js/sdkloader/ima3.js$script,redirect=google-ima.js,domain=site.com').action,
    { type: 'redirect', redirect: { extensionPath: '/surrogates/google-ima.js' } });
  const accessible = new Set(manifest.web_accessible_resources.flatMap((entry) => entry.resources));
  for (const [name, resource] of Object.entries(B.REDIRECTS)) {
    assert(fs.existsSync(path.join(ROOT, resource.path)), name + ' points at a missing file ' + resource.path);
    assert(accessible.has(resource.path.slice(1)), resource.path + ' is not web accessible');
  }
});

test('the IMA stand in answers every ad request as empty, so players start the video', () => {
  const vm = require('vm');
  const timers = [];
  const window = {};
  const box = vm.createContext({ window, setTimeout: (fn) => timers.push(fn), Map, Set, Error });
  vm.runInContext(read('surrogates/google-ima.js'), box);
  const ima = window.google.ima;
  assert(ima && typeof ima.AdDisplayContainer === 'function' && typeof ima.AdsLoader === 'function');
  const container = new ima.AdDisplayContainer({}, {});
  container.initialize();
  const loader = new ima.AdsLoader(container);
  loader.getSettings().setVpaidMode(ima.ImaSdkSettings.VpaidMode.ENABLED);
  const seen = [];
  loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, () => seen.push('loaded'), false);
  loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (event) => seen.push(event.getError().getErrorCode() + ' ' + event.getError().getType()), false);
  const request = new ima.AdsRequest();
  request.adTagUrl = 'https://pubads.g.doubleclick.net/gampad/ads?iu=x';
  loader.requestAds(request, { id: 1 });
  assert.deepStrictEqual(seen, [], 'the answer must arrive after requestAds returns, as the real SDK does');
  while (timers.length) timers.shift()();
  assert.deepStrictEqual(seen, ['1009 adLoadError']);
  const manager = new ima.AdsManagerLoadedEvent({}).getAdsManager({}, new ima.AdsRenderingSettings());
  const resumed = [];
  manager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => resumed.push('resume'));
  manager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () => resumed.push('done'));
  manager.init(640, 360, ima.ViewMode.NORMAL);
  manager.start();
  while (timers.length) timers.shift()();
  assert.deepStrictEqual(resumed, ['resume', 'done'], 'a manager with no ads hands the video straight back');
});

test('curated scopes narrow only hosts no packaged list blocks whole', () => {
  const ALL = ['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'];
  const block = (condition) => ({ action: { type: 'block' }, condition });
  const files = {
    'rules-easyprivacy.json': [block({ requestDomains: ['typed.example', 'both.example'], resourceTypes: ['script'] })],
    'rules-adshield.json': [block({ urlFilter: '||sites.example^', initiatorDomains: ['one.example'] }), block({ urlFilter: '||paths.example/ad.js' }),
      block({ urlFilter: '||child.parent.example^', resourceTypes: ['image'] }), block({ urlFilter: '||player.cdn.example^', resourceTypes: ['script'] })],
    'rules-trackers.json': [block({ requestDomains: ['both.example', 'parent.example'], resourceTypes: ALL })],
    'rules-badger.json': [block({ requestDomains: ['cdn.example'], resourceTypes: ALL, excludedRequestDomains: ['player.cdn.example'] })],
  };
  const scoped = B.curatedScopedHosts((file) => files[file] || []);
  assert.deepStrictEqual(scoped, ['paths.example', 'player.cdn.example', 'sites.example', 'typed.example'],
    'a type, site or path scope counts; a whole block anywhere, or on a parent, keeps the host whole; a carved out host is not whole');
  const shipped = new Set(JSON.parse(read(B.SCOPE_FILE)));
  for (const host of ['google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'hotjar.com', 'criteo.com', 'scorecardresearch.com']) {
    assert(!shipped.has(host), host + ' must stay blocked whole by the downloaded lists');
  }
});

test('a host another protection is built around blocking whole is never narrowed', () => {
  /* Stage 2, 2026-11-27: narrowing Ad-Shield's loader let it run on TechRadar again, tripling the page's script time. */
  const keep = B.protectionWholeHosts();
  assert(keep.length >= 1, 'the anti adblock shield lists no loader hosts any more');
  const block = (condition) => ({ action: { type: 'block' }, condition });
  const files = { 'rules-ubo-filters.json': [block({ urlFilter: '||loader.example/l/', resourceTypes: ['xmlhttprequest'] }),
    block({ urlFilter: '||cdn.loader.example^', resourceTypes: ['image'] })] };
  assert.deepStrictEqual(B.curatedScopedHosts((file) => files[file] || [], []), ['cdn.loader.example', 'loader.example']);
  assert.deepStrictEqual(B.curatedScopedHosts((file) => files[file] || [], ['loader.example']), [],
    'a protected host and its subdomains stay whole however narrowly a curated list scopes them');
  const shipped = new Set(JSON.parse(read(B.SCOPE_FILE)));
  for (const host of keep) assert(!shipped.has(host), host + ' is narrowed although anti-adblock-shield.js depends on blocking it');
});

test('the downloaded list gate drops only the whole host verdict, never a security one', () => {
  const vm = require('vm');
  const start = BG.indexOf('function remoteListBlockAllowed(');
  const fn = BG.slice(start, BG.indexOf('\n}\n', start) + 2);
  const box = vm.createContext({ isNeverBlockDomain: () => false, isMediaCompatDomainLowercase: () => false, isMediaCompatFilter: () => false,
    remoteRuleSourceKind: (v) => (v === 'adshield' || v === 'tracker' ? v : 'security') });
  vm.runInContext(fn + '\nthis.gate = remoteListBlockAllowed;', box);
  const url = 'https://feed.example/list.txt';
  assert.strictEqual(box.gate('gleam.io', '', 'tracker', url), true, 'with no scope list loaded nothing is narrowed');
  vm.runInContext('var CURATED_SCOPED_HOSTS = new Set(["gleam.io"]);', box);
  assert.strictEqual(box.gate('gleam.io', '', 'tracker', url), false);
  assert.strictEqual(box.gate('gleam.io', '||gleam.io^', 'adshield', url), false);
  assert.strictEqual(box.gate('gleam.io', '||gleam.io/seen?', 'tracker', url), true, 'a downloaded path rule is not a whole host verdict');
  assert.strictEqual(box.gate('sub.gleam.io', '', 'tracker', url), true, 'only the exact host is narrowed');
  assert.strictEqual(box.gate('gleam.io', '', 'security', url), true, 'security lists are never narrowed');
  assert(/return \{ ok: true, skipped: true, fresh: true, meta: previousMeta \};\n  \}\n  await loadCuratedScopedHosts\(\);/.test(BG),
    'the scope list must load before any downloaded list is merged');
});

test('badfilter and !#if follow uBlock', () => {
  assert.strictEqual(B.badfilterKey('||a.example.com^$script,third-party'), B.badfilterKey('||a.example.com^$third-party,script,badfilter'));
  assert.deepStrictEqual(B.activeLines(['a', '!#if env_firefox', 'b', '!#else', 'c', '!#endif', '!#if ext_ubol && !env_mobile', 'd', '!#endif'].join('\n')), ['a', 'c', 'd']);
  const { rules } = B.compile({ 'ubo-filters': ['||a.example.com^$script', '||a.example.com^$script,badfilter', '||b.example.com^$script'] }, 'ubo_filters');
  assert.deepStrictEqual(rules.map((r) => r.condition.requestDomains), [['b.example.com']]);
});

test('plain host rules with the same options are packed into one rule', () => {
  const packed = B.packHosts([rule('||a.example.com^$script,3p'), rule('||b.example.com^$script,3p'), rule('||c.example.com^$image')]);
  assert.strictEqual(packed.length, 2);
  assert.deepStrictEqual(packed.find((r) => r.condition.resourceTypes[0] === 'script').condition.requestDomains, ['a.example.com', 'b.example.com']);
});

test('WardenOne engine sites, payments and bot checks are left alone', () => {
  assert.strictEqual(skipped('||www.youtube.com/api/stats/ads$xhr'), 'engine site');
  assert.strictEqual(skipped('||cdn.example.com/x.js$domain=twitch.tv'), 'engine site');
  assert.strictEqual(skipped('/checkout/analytics.js'), 'fail open path');
  const lines = B.networkLines('easyprivacy', ['! *** easylist:easyprivacy/easyprivacy_general.txt ***', '||tracker.example^$third-party',
    '/beacon.js?', '! *** easylist:easyprivacy/easyprivacy_specific_perimeterx.txt ***', '/px/client/main.min.js'].join('\n'));
  assert.deepStrictEqual(lines, ['/beacon.js?'], 'EasyPrivacy plain hosts live in rules-easyprivacy.json; PerimeterX sensors fail open');
});

test('the shipped rulesets match their snapshot and stay inside their limits', () => {
  const lists = B.readSnapshot(read('docs/filter-lists-snapshot.txt'));
  for (const [id, out] of Object.entries(B.OUTPUTS)) {
    const shipped = JSON.parse(read(out.file));
    assert.strictEqual(JSON.stringify(B.compile(lists, id).rules), JSON.stringify(shipped), out.file + ' is stale');
    policy.validate({ addRules: shipped }, 'static');
    const regex = shipped.filter((r) => r.condition.regexFilter);
    assert(regex.length <= 900, out.file + ' has ' + regex.length + ' regex rules');
    for (const r of regex) new RegExp(r.condition.regexFilter);
    for (const r of shipped) {
      if (out.security) {
        assert(r.action.type === 'block' && r.priority === policy.securityMin, out.file + ' rule ' + r.id + ' is not a security block');
        continue;
      }
      const standIn = r.action.type === 'redirect' && r.action.redirect.extensionPath.startsWith('/surrogates/') && r.condition.initiatorDomains;
      assert(standIn ? r.priority === B.PRIORITY.scopedStandIn : r.priority < 1900, out.file + ' rule ' + r.id + ' reaches the compatibility band');
      const hosts = (r.condition.requestDomains || []).concat(r.condition.initiatorDomains || []);
      assert(!hosts.some((h) => B.ENGINE_SITES.some((s) => h === s || h.endsWith('.' + s))), out.file + ' rule ' + r.id + ' names an engine site');
      if (r.action.type === 'block' && !r.condition.requestDomains && !r.condition.initiatorDomains && !/^\|\|/.test(r.condition.urlFilter || '')) {
        assert(B.ENGINE_PAGES.every((s) => (r.condition.excludedInitiatorDomains || []).includes(s)), out.file + ' rule ' + r.id + ' runs on engine sites');
      }
    }
    const entry = manifest.declarative_net_request.rule_resources.find((x) => x.id === id);
    assert(entry && entry.enabled && entry.path === out.file, id + ' is not an enabled ruleset in manifest.json');
  }
});

test('the rulesets follow the AdShield and tracker switches', () => {
  assert(BG.includes("const UBO_FILTERS_STATIC_RULESET_ID = 'ubo_filters';"));
  assert(BG.includes("const PRIVACY_FILTERS_STATIC_RULESET_ID = 'privacy_filters';"));
  assert(BG.includes('(adshieldOn ? enableRulesetIds : disableRulesetIds).push(UBO_FILTERS_STATIC_RULESET_ID);'));
  assert(BG.includes('(trackersOn ? enableRulesetIds : disableRulesetIds).push(PRIVACY_FILTERS_STATIC_RULESET_ID);'));
  assert(BG.includes('(grabberSitesOn ? enableRulesetIds : disableRulesetIds).push(BADWARE_FILTERS_STATIC_RULESET_ID);'));
});

test('Badware rules are security blocks that no list exception can undo', () => {
  const { rules } = B.compile({ 'ubo-badware': ['/scam/loader.js$script', '@@/scam/loader.js$script,domain=a.com',
    '||cdn.example.com/a.js$script,redirect=noopjs'] }, 'badware_filters');
  assert.deepStrictEqual(rules.map((r) => [r.action.type, r.priority, r.condition.urlFilter]), [['block', policy.securityMin, '/scam/loader.js']]);
  const strict = B.compile({ 'ubo-badware': ['/\\/m\\/js(?:drive|nom)\\.js\\b/$script,1p,strict1p'] }, 'badware_filters').rules;
  assert.strictEqual(strict.length === 1 && strict[0].condition.domainType, 'firstParty', 'a security strict1p rule keeps the nearest scope DNR has');
  assert.strictEqual(B.compile({ 'ubo-filters': ['/\\/m\\/js(?:drive|nom)\\.js\\b/$script,1p,strict1p'] }, 'ubo_filters').rules.length, 0,
    'outside the security list strict1p is still skipped, never widened');
  assert(B.PRIORITY.security > B.PRIORITY.important && B.PRIORITY.security > 1900);
});

let failures = 0;
for (const item of tests) {
  try { item.fn(); console.log('ok - ' + item.name); } catch (error) { failures++; console.error('not ok - ' + item.name); console.error(error && error.stack ? error.stack : error); }
}
if (failures) process.exitCode = 1;
else console.log('\n' + tests.length + ' filter list rule tests passed.');

/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { helpers } = require('./build-cname-data.js');
const resourceTypes = require('./lib/resource-types.js');
const { WOCname } = helpers();
const referenceRoot = process.argv[2] || '.';
const source = fs.readFileSync(path.join(referenceRoot, 'background.js'), 'utf8');
const mapping = WOCname.validateEntries([
  ['a.shop.example.org', 'collector.etracker.com'],
  ['inside.doubleclick.net', 'collector.etracker.com'],
  ['unconfirmed.shop.example.org', 'cdn.example.net'],
]);
const state = { rules: new Map([[123, { id: 123 }]]), writes: 0, fail: false, unavailable: false, cnameUnavailable: false };
const context = vm.createContext({ console: { warn() {} }, WOCname,
  TRACKER_COOKIE_ALIAS_RULE_BASE: 901000, TRACKER_COOKIE_ALIAS_RULES_BUDGET: 300,
  ...resourceTypes.resolveAll(source),
  LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com', 'stripe.com'], MEDIA_COMPAT_DOMAINS: new Set(['youtube.com']),
  activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: WOCname.normalizeHost,
  isProtectedTrackerDomain: host => host === 'accounts.google.com', isMediaCompatDomain: host => host === 'youtube.com',
  packagedHeaderTrackerDomains: async () => state.unavailable ? [] : ['doubleclick.net'],
  loadKnownAliases: async () => { if (state.cnameUnavailable) throw new Error('alias fixture unavailable'); return mapping; },
  scheduleContentConfigRefresh() {}, chrome: { declarativeNetRequest: { updateSessionRules: async () => {} } },
  writeSessionRules: async change => {
    if (state.fail) throw new Error('native rejection');
    state.writes++;
    for (const id of change.removeRuleIds) state.rules.delete(id);
    for (const rule of change.addRules || []) state.rules.set(rule.id, rule);
  },
});
const start = source.indexOf('const TRACKER_COOKIE_RULE_ID');
const end = source.indexOf('// Read the setting and apply. Called on install/startup', start);
assert(start >= 0 && end > start);
vm.runInContext(source.slice(start, end) + '\nthis.apply=applyTrackerCookieRule;this.compatibility=(cfg,known)=>trackerCookieCompatibility(cfg,known);this.serviceRules=serviceCookieRules;', context);
const owned = () => [...state.rules.values()].filter(rule => rule.id !== 123);
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  const cfg = {};
  await context.apply(true, cfg);
  const rules = owned();
  assert(rules.length > 1, 'the existing cookie switch must install curated and exact CNAME header rules');
  const passive = context.compatibility(cfg, false);
  assert.deepEqual(plain(passive.excludedRequestDomains), ['accounts.google.com', 'stripe.com']);
  assert(!passive.excludedInitiatorDomains, 'unclassified passive traffic retains its original exemption scope');
  for (const rule of rules) {
    assert.equal(rule.action.type, 'modifyHeaders');
    assert.deepEqual(plain(rule.action.requestHeaders), [{ header: 'cookie', operation: 'remove' }]);
    assert.deepEqual(plain(rule.action.responseHeaders[0]), { header: 'set-cookie', operation: 'remove' });
    if(rule.condition.resourceTypes.includes('sub_frame')){
      assert.deepEqual(plain(rule.condition.resourceTypes),['sub_frame']);
      assert.deepEqual(plain(rule.action.responseHeaders[1]),{header:'server-timing',operation:'set',value:'cookie-policy;desc="restricted";dur=0'});
    }else assert.equal(rule.action.responseHeaders.length,1);
    assert(rule.priority > 1999 && rule.priority < 2600, 'automatic compatibility allows must not suppress the explicit cookie choice; user tracker/firewall decisions still win');
    assert(!rule.condition.resourceTypes.includes('main_frame'));
    if (rule.condition.excludedRequestDomains) for (const host of ['accounts.google.com', 'stripe.com', 'youtube.com']) assert(rule.condition.excludedRequestDomains.includes(host));
    assert(rule.condition.excludedInitiatorDomains.includes('youtube.com'));
  }
  const curated = rules.find(rule => rule.id === 900007);
  for (const host of ['accounts.google.com', 'stripe.com']) assert(!curated.condition.excludedInitiatorDomains.includes(host), 'sign-in and payment pages do not exempt unrelated tracker destinations');
  assert.equal(curated.condition.domainType, 'thirdParty');
  const aliases = rules.filter(rule => rule.id !== 900007);
  assert(aliases.some(rule => rule.condition.requestDomains.includes('a.shop.example.org') && !rule.condition.domainType));
  assert(aliases.some(rule => rule.condition.requestDomains.includes('inside.doubleclick.net') && rule.condition.domainType === 'firstParty'));
  assert(!aliases.some(rule => rule.condition.requestDomains.includes('unconfirmed.shop.example.org')));
  const matchesHost=(host,scope)=>host===scope||host.endsWith('.'+scope);
  const cookieStripped=(rows,host,top,type,pathname)=>rows.some(rule=>{
    const c=rule.condition;
    return c.requestDomains.some(scope=>matchesHost(host,scope))&&c.resourceTypes.includes(type)
      &&!(c.excludedInitiatorDomains||c.excludedTopDomains||[]).some(scope=>matchesHost(top,scope))
      &&!(c.excludedRequestDomains||[]).some(scope=>matchesHost(host,scope))
      &&(!c.regexFilter||new RegExp(c.regexFilter).test('https://'+host+':8443'+pathname));
  });
  for(const [host,path,types]of [
    ['accounts.google.com','/gsi/client',['script']],['accounts.google.com','/resource',['script','xmlhttprequest','sub_frame']],
    ['js.stripe.com','/v3/',['script']],['js.stripe.com','/resource',['script','xmlhttprequest','sub_frame']],
    ['checkout.stripe.com','/resource',['sub_frame','xmlhttprequest']],['m.stripe.com','/6',['sub_frame','xmlhttprequest']],
    ['accounts.spotify.com','/resource',['script','sub_frame']],['connect.facebook.net','/en_US/sdk.js',['script']],
    ['www.gstatic.com','/recaptcha/releases/fixture.js',['script']],
  ])for(const type of types)assert(cookieStripped(rules,host,'shop.example.org',type,path),host+' '+type+' '+path);
  for(const [host,top]of [['accounts.google.com','mail.google.com'],['js.stripe.com','dashboard.stripe.com']]){
    assert(!cookieStripped(rules,host,top,'sub_frame','/resource'),'preserve first-party service context '+host);
  }
  for(const [host,paths]of [
    ['accounts.google.com',['/gsi/iframe/select','/o/oauth2/iframe','/signin/','/ServiceLogin','/ListAccounts?x=1','/CheckCookie','/gsiX/iframe','/%4cistAccounts']],
    ['js.stripe.com',['/v3/elements-inner.html','/v3/','/resource']],
    ['checkout.stripe.com',['/c/pay/cs_test_fixture','/resource']],
    ['accounts.spotify.com',['/authorize','/login']],
  ])for(const pathname of paths)for(const type of ['sub_frame','xmlhttprequest','other']){
    assert(cookieStripped(rules,host,'shop.example.org',type,pathname),'third-party path must not bypass isolation '+host+pathname);
  }
  assert(context.serviceRules(902000,curated.action,{}).every(rule=>!rule.condition.regexFilter),'service isolation needs no path regexes');
  context.chrome.declarativeNetRequest.RuleConditionKeys={EXCLUDED_TOP_DOMAINS:'excludedTopDomains'};
  const topRules=context.serviceRules(902000,curated.action,context.compatibility({siteOverrides:{'shop.example.org':{blockThirdPartyCookies:false}}}));
  assert(topRules.every(rule=>rule.condition.excludedTopDomains&&!rule.condition.excludedInitiatorDomains));
  assert(!cookieStripped(topRules,'accounts.google.com','shop.example.org','sub_frame','/resource'),'site exception follows the real top frame on capable browsers');
  delete context.chrome.declarativeNetRequest.RuleConditionKeys;
  const writes = state.writes;
  await context.apply(true, cfg);
  assert.equal(state.writes, writes, 'unchanged policy skips native writes');
  state.fail = true;
  const exception = { ...cfg, siteOverrides: { 'shop.example.org': { blockThirdPartyCookies: false } }, allowlist: ['paused.example.org'] };
  assert.equal(await context.apply(true, exception), false);
  assert.deepEqual(plain(owned()), plain(rules));
  state.fail = false;
  await context.apply(true, exception);
  assert(owned().every(rule => ['shop.example.org', 'paused.example.org'].every(host => rule.condition.excludedInitiatorDomains.includes(host))));
  const previous = plain(owned());
  state.unavailable = true;
  assert.equal(await context.apply(true, cfg), false);
  assert.deepEqual(plain(owned()), previous, 'unavailable classification retains validated installed rules');
  state.unavailable = false;
  state.cnameUnavailable = true;
  assert.equal(await context.apply(true, cfg), false);
  assert.deepEqual(plain(owned()), previous, 'unavailable alias data retains the complete installed policy');
  state.cnameUnavailable = false;
  await context.apply(true, cfg);
  assert(owned().length > 1, 'data failure remains eligible for a successful retry');
  context.chrome.declarativeNetRequest.isRegexSupported=async()=>{throw new Error('unused path-regex API');};
  await context.apply(true,exception);
  assert(owned().every(rule=>rule.condition.excludedInitiatorDomains.includes('shop.example.org')),'service rules do not depend on native path-regex support');
  const originalCompiler=context.WOCname;
  const beforeOversize=plain(owned());
  context.WOCname={...originalCompiler,compile:(_mapping,options)=>Array.from({length:76},(_,i)=>({id:options.base+i,condition:{requestDomains:['budget-'+i+'.example.net']}}))};
  assert.equal(await context.apply(true,cfg),false,'the combined request and frame rules must fit the existing reserved band');
  assert.deepEqual(plain(owned()),beforeOversize,'an oversized frame plan cannot partially replace the installed policy');
  context.WOCname=originalCompiler;
  await context.apply(true,cfg);
  await context.apply(false, { blockThirdPartyCookies: false });
  assert.equal(owned().length, 0);
  assert(state.rules.has(123), 'foreign session owner survives cleanup');
  let draft, release;
  const committed = new Promise(resolve => { release = resolve; });
  const pending = context.apply(true, cfg, change => { draft = change; return committed; });
  while (!draft) await new Promise(resolve => setImmediate(resolve));
  assert.equal(owned().length, 0, 'the batch owns the native write');
  await context.writeSessionRules(draft); release(); await pending;
  assert(owned().length > 1);
  const installed = plain(owned());
  assert.equal(await context.apply(false, cfg, async () => { throw new Error('batch rejected'); }), false);
  assert.deepEqual(plain(owned()), installed, 'batch rejection preserves installed tracker-cookie rules');
  await context.apply(false, cfg);
  assert.equal(owned().length, 0, 'rejected batch does not certify the policy or suppress a retry');
  const metadata = vm.runInNewContext(fs.readFileSync(path.join(referenceRoot, 'settings-data.js'), 'utf8') + '\nSETTINGS_DATA');
  assert.equal(metadata.defaults.blockThirdPartyCookies, true);
  assert.equal(metadata.popupDefaults.blockThirdPartyCookies, true);
  assert(metadata.siteOverrideScope.coordinated.includes('blockThirdPartyCookies'));
  assert.equal(metadata.shieldKeys.filter(key => key === 'blockThirdPartyCookies').length, 1);
  assert(!('isolateTrackerCookies' in metadata.defaults), 'no separate toggle is introduced');
  console.log('[ok] bidirectional cookie isolation, exact CNAME scope, priority, coordinated exceptions and atomic recovery');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

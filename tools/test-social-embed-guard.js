/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* The social widget guard swapped embeds only after the page inserted them, so the embed's own request reached the
   provider first (Round 5b, 2026-11-19: an X tweet frame was requested before the swap). The network band now
   blocks the embed loaders and frames, and the Load button allows one provider in one tab on one site. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const BUILT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
let failed = 0, passed = 0;
function check(what, ok) { if (ok) passed++; else { failed++; console.error('FAIL - ' + what); } }
const constant = name => Number((BG.match(new RegExp('const ' + name + ' = (\\d+);')) || [])[1]);

const start = BG.indexOf('const SOCIAL_EMBED_RULE_BASE');
const end = BG.indexOf("registerListener('social embed load'");
if (start < 0 || end < start) { console.error('FAIL - social embed band not found in background.js'); process.exit(1); }

const reg = host => { const parts = String(host).split('.'); return parts.slice(/\.co\.uk$/.test(host) ? -3 : -2).join('.'); };
function makeWorker() {
  const state = new Map();
  const writes = [];
  const sandbox = {
    console, URL, JSON, Object, Array, Set, Promise, Number, String,
    SOCIAL_EMBED_RULES_BUDGET: constant('SOCIAL_EMBED_RULES_BUDGET'),
    SOCIAL_EMBED_ONCE_RULES_BUDGET: constant('SOCIAL_EMBED_ONCE_RULES_BUDGET'),
    activeAllowlist: cfg => (cfg.allowlist || []).map(h => String(h).toLowerCase()),
    normalizeAllowlistHost: raw => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(String(raw)) ? String(raw).replace(/^www\./, '') : '',
    registrableDomainBg: reg,
    serializeSubsystem: (_name, task) => task(),
    /* The real writer passes every change through the network policy, so the fake does too. */
    writeSessionRules: async change => {
      sandbox.WONetworkPolicy.validate(change, 'session');
      writes.push(change);
      for (const id of change.removeRuleIds || []) state.delete(id);
      for (const rule of change.addRules || []) {
        if (state.has(rule.id)) throw new Error('duplicate rule id ' + rule.id);
        state.set(rule.id, JSON.parse(JSON.stringify(rule)));
      }
    },
    chrome: { declarativeNetRequest: { getSessionRules: async () => [...state.values()].map(rule => JSON.parse(JSON.stringify(rule))) } },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'network-policy.js'), 'utf8') + '\nthis.WONetworkPolicy = WONetworkPolicy;', sandbox,
    { filename: 'network-policy.js' });
  vm.runInContext(BG.slice(start, end) + '\nthis.api = { SOCIAL_EMBED_RULE_BASE, SOCIAL_EMBED_ONCE_RULE_BASE, SOCIAL_EMBED_PRIORITY,'
    + ' SOCIAL_EMBED_ONCE_PRIORITY, socialEmbedExclusions, socialEmbedBlockRules, applySocialEmbedRules, allowSocialEmbedOnce, clearSocialEmbedOnce };',
  sandbox, { filename: 'background.js:social-embed' });
  return { api: sandbox.api, state, writes };
}

/* A small DNR matcher for the condition keys this band uses, plus the allows it must sit between. */
const hostIn = (host, domains) => (domains || []).some(d => host === d || host.endsWith('.' + d));
function matches(rule, req) {
  const c = rule.condition, url = new URL(req.url), host = url.hostname, from = req.initiator ? new URL(req.initiator).hostname : '';
  if (c.resourceTypes && !c.resourceTypes.includes(req.type)) return false;
  if (c.requestDomains && !hostIn(host, c.requestDomains)) return false;
  if (c.tabIds && !c.tabIds.includes(req.tabId)) return false;
  if (c.initiatorDomains && !hostIn(from, c.initiatorDomains)) return false;
  if (c.excludedInitiatorDomains && hostIn(from, c.excludedInitiatorDomains)) return false;
  if (c.domainType === 'thirdParty' && reg(host) === reg(from)) return false;
  if (c.urlFilter) {
    const m = /^\|\|([^/^]+)(.*)$/.exec(c.urlFilter);
    if (!m || !hostIn(host, [m[1]]) || !(url.pathname + url.search).startsWith(m[2])) return false;
  }
  if (c.regexFilter && !new RegExp(c.regexFilter, 'i').test(req.url)) return false;
  const known = ['resourceTypes', 'requestDomains', 'tabIds', 'initiatorDomains', 'excludedInitiatorDomains', 'domainType', 'urlFilter', 'regexFilter'];
  return Object.keys(c).every(key => known.includes(key));
}
const LOGIN_ALLOW = { id: 807000, priority: 1900, action: { type: 'allow' }, condition: { requestDomains: ['connect.facebook.net'] } };
function outcome(rules, req) {
  const hit = rules.concat([LOGIN_ALLOW]).filter(rule => matches(rule, req)).sort((a, b) => b.priority - a.priority)[0];
  return hit ? hit.action.type : 'none';
}

(async () => {
  const { api, state, writes } = makeWorker();
  const cfg = { allowlist: ['trusted.example'], siteOverrides: { 'blog.example': { socialWidgetGuard: false }, 'paused.example': { enabled: false }, 'other.example': { adShield: false } } };
  const blocks = api.socialEmbedBlockRules(cfg);
  check('block rules fit their budget', blocks.length > 0 && blocks.length <= constant('SOCIAL_EMBED_RULES_BUDGET'));
  check('block rules stay inside their id band', blocks.every((rule, i) => rule.id === api.SOCIAL_EMBED_RULE_BASE + i));
  check('blocks sit above the login and never-block allows and below the security lists',
    api.SOCIAL_EMBED_PRIORITY > 1900 && api.SOCIAL_EMBED_PRIORITY < 3000 && blocks.every(rule => rule.priority === api.SOCIAL_EMBED_PRIORITY));
  check('a Load allow outranks the guard but not the security lists', api.SOCIAL_EMBED_ONCE_PRIORITY > api.SOCIAL_EMBED_PRIORITY && api.SOCIAL_EMBED_ONCE_PRIORITY < 3000);
  check('every block is third party only', blocks.every(rule => rule.condition.domainType === 'thirdParty'));
  check('exclusions are the allowlist and the sites with the guard off', JSON.stringify(api.socialEmbedExclusions(cfg)) === '["blog.example","paused.example","trusted.example"]');

  const page = 'https://www.news.example/story';
  for (const [url, type] of [
    ['https://platform.twitter.com/widgets.js', 'script'],
    ['https://platform.twitter.com/embed/Tweet.html?id=20', 'sub_frame'],
    ['https://syndication.twitter.com/srv/timeline-profile/screen-name/lab', 'sub_frame'],
    ['https://www.instagram.com/embed.js', 'script'],
    ['https://www.instagram.com/p/AbC123/embed/captioned/', 'sub_frame'],
    ['https://www.instagram.com/reel/AbC123/embed', 'sub_frame'],
    ['https://www.tiktok.com/embed.js', 'script'],
    ['https://www.tiktok.com/embed/v2/7123456789', 'sub_frame'],
    ['https://www.tiktok.com/player/v1/7123456789', 'sub_frame'],
    ['https://www.facebook.com/plugins/post.php?href=x', 'sub_frame'],
    ['https://www.facebook.com/v19.0/plugins/video.php?href=x', 'sub_frame'],
  ]) check('blocked before the guard can swap it: ' + url, outcome(blocks, { url, type, initiator: page, tabId: 7 }) === 'block');

  for (const [url, type, initiator, why] of [
    ['https://platform.twitter.com/widgets.js', 'script', 'https://x.com/home', 'on X itself'],
    ['https://platform.twitter.com/embed/Tweet.html', 'sub_frame', 'https://twitter.com/lab', 'on Twitter itself'],
    ['https://www.instagram.com/p/AbC/embed', 'sub_frame', 'https://www.facebook.com/', 'inside Meta'],
    ['https://www.facebook.com/plugins/post.php', 'sub_frame', 'https://www.instagram.com/', 'inside Meta'],
    ['https://www.tiktok.com/embed/v2/1', 'sub_frame', 'https://www.tiktok.com/', 'on TikTok itself'],
    ['https://connect.facebook.net/en_US/sdk.js', 'script', page, 'the Facebook sign in SDK'],
    ['https://www.facebook.com/dialog/oauth?client_id=1', 'main_frame', page, 'Facebook sign in'],
    ['https://www.instagram.com/someuser/', 'sub_frame', page, 'not an embed'],
    ['https://www.tiktok.com/@user/video/123', 'main_frame', page, 'opening TikTok'],
    ['https://abs.twimg.com/responsive-web/client.js', 'script', page, 'not an embed host'],
    ['https://platform.twitter.com.evil.example/widgets.js', 'script', page, 'a look-alike host is not the provider'],
    ['https://platform.twitter.com/widgets.js', 'image', page, 'not a loader or frame'],
    ['https://platform.twitter.com/widgets.js', 'script', 'https://blog.example/', 'a site with the guard off'],
    ['https://platform.twitter.com/widgets.js', 'script', 'https://www.paused.example/', 'a paused site'],
    ['https://platform.twitter.com/widgets.js', 'script', 'https://trusted.example/', 'an allowlisted site'],
  ]) check('left alone, ' + why + ': ' + url, outcome(blocks, { url, type, initiator, tabId: 7 }) !== 'block');
  check('a site with another protection off is still guarded',
    outcome(blocks, { url: 'https://platform.twitter.com/widgets.js', type: 'script', initiator: 'https://other.example/', tabId: 7 }) === 'block');

  await api.applySocialEmbedRules(true, cfg);
  check('applying installs the block band', [...state.values()].filter(rule => rule.id >= api.SOCIAL_EMBED_RULE_BASE && rule.id < api.SOCIAL_EMBED_RULE_BASE + 8).length === blocks.length);
  const writesBefore = writes.length;
  await api.applySocialEmbedRules(true, cfg);
  check('an unchanged band is not rewritten', writes.length === writesBefore);

  check('Load allows X for that tab and site', await api.allowSocialEmbedOnce(7, page, 'X') === true);
  const current = () => [...state.values()];
  const once = () => current().filter(rule => rule.id >= api.SOCIAL_EMBED_ONCE_RULE_BASE && rule.id < api.SOCIAL_EMBED_ONCE_RULE_BASE + constant('SOCIAL_EMBED_ONCE_RULES_BUDGET'));
  const [allow] = once();
  check('the Load allow names the tab, the site and only the provider', allow && JSON.stringify(allow.condition.tabIds) === '[7]'
    && JSON.stringify(allow.condition.initiatorDomains) === '["news.example"]'
    && JSON.stringify(allow.condition.requestDomains) === '["platform.twitter.com","syndication.twitter.com"]');
  const x = { url: 'https://platform.twitter.com/embed/Tweet.html?id=20', type: 'sub_frame' };
  check('after Load the tweet frame opens in that tab', outcome(current(), Object.assign({ initiator: page, tabId: 7 }, x)) === 'allow');
  check('another tab stays guarded', outcome(current(), Object.assign({ initiator: page, tabId: 8 }, x)) === 'block');
  check('another site in the same tab stays guarded', outcome(current(), Object.assign({ initiator: 'https://shop.example/', tabId: 7 }, x)) === 'block');
  check('Load for X does not open Instagram', outcome(current(), { url: 'https://www.instagram.com/embed.js', type: 'script', initiator: page, tabId: 7 }) === 'block');
  await api.allowSocialEmbedOnce(7, page, 'X');
  check('pressing Load again adds nothing', once().length === 1);
  for (const [tab, url, name, why] of [[7, page, 'Evil', 'unknown provider'], [7, page, '__proto__', 'prototype name'],
    [7, page, 'constructor', 'prototype name'], [-1, page, 'X', 'no tab'], [7, 'chrome://settings/', 'X', 'not a web page'],
    [7, 'https://localhost/', 'X', 'not a site'], [7.5, page, 'X', 'not a tab id']]) {
    check('Load refused for ' + why, await api.allowSocialEmbedOnce(tab, url, name) === false);
  }
  check('refusals add no rule', once().length === 1);

  await api.allowSocialEmbedOnce(7, page, 'Instagram');
  await api.clearSocialEmbedOnce(7, 'www.news.example');
  check('moving within the site keeps what was loaded', once().length === 2);
  await api.clearSocialEmbedOnce(7, 'shop.example');
  check('leaving the site drops its Load allows', once().length === 0);
  await api.allowSocialEmbedOnce(9, 'https://forum.example/t/1', 'TikTok');
  await api.clearSocialEmbedOnce(9);
  check('closing the tab drops its Load allows', once().length === 0);

  for (let tab = 100; tab < 100 + constant('SOCIAL_EMBED_ONCE_RULES_BUDGET') + 3; tab++) await api.allowSocialEmbedOnce(tab, page, 'X');
  check('a full band replaces an old allow instead of failing or overflowing', once().length === constant('SOCIAL_EMBED_ONCE_RULES_BUDGET'));
  await api.applySocialEmbedRules(false, cfg);
  check('turning the guard off removes the blocks and every Load allow', current().length === 0);

  /* Wiring. */
  check('the worker applies the band from the guard setting and the master switch',
    /run\('socialEmbed', \(\) => applySocialEmbedRules\(on && cfg\.socialWidgetGuard !== false, cfg\)/.test(BG));
  check('the handler takes the tab and the page from the sender, never from the message',
    /msg\.kind === 'social-embed-load' && messageSenderIsTab\(sender\)\) \{\s*respond\(allowSocialEmbedOnce\(sender\.tab\.id, sender\.url, /.test(BG));
  check('the request kind is tab-allowed and rate limited', /'social-embed-load',/.test(BG) && /'social-embed-load': \{ max: \d+, windowMs: 60000 \}/.test(BG));
  const relay = BRIDGE.slice(BRIDGE.indexOf("if (msg.kind === 'social-embed-load')"), BRIDGE.indexOf("if (msg.kind === 'social-embed-load')") + 700);
  check('the bridge relays Load only for a known provider', relay.includes("['X', 'Instagram', 'TikTok', 'Facebook'].includes(provider)"));
  check('the bridge relays Load only after a real click', relay.includes('navigator.userActivation && navigator.userActivation.isActive'));
  check('the bridge relays Load only with the engine signature', relay.includes("relayRequestSigned(msg, { kind: 'social-embed-load', provider: msg.provider })"));
  check('the placeholder asks the worker before it restores the embed',
    BUILT.includes('__woBackgroundRequest(__woSignedRequest({kind:"social-embed-load",provider:provider}),load,3e3)'));
  check('after Load the guard leaves that provider\'s own new frames alone',
    BUILT.includes('btn.disabled=!0,loadedSocialProviders.add(provider);') && BUILT.includes('if(!provider||loadedSocialProviders.has(provider))return;'));
  check('the placeholder only answers a trusted click', /btn\.addEventListener\("click",e=>\{if\(!e\|\|!1!==e\.isTrusted\)\{if\(btn\.disabled\)return;/.test(BUILT));

  if (failed) { console.error(failed + ' social embed guard check(s) failed'); process.exit(1); }
  console.log('[ok] social embed guard: ' + passed + ' checks (network blocks, Load scope, cleanup, wiring)');
})().catch(e => { console.error(e); process.exit(1); });

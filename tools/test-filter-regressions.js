/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Every filtering weakness found in the uBlock Origin Lite 1v1 (Round 6) stays fixed. Each check replays the weakness
   against the packaged rulesets with an offline DNR matcher, plus WardenOne's dynamic bands where the weakness lived
   there. Checks are about mechanisms, never about benchmark cases. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const domains = vm.createContext({ URL });
vm.runInContext(read('domain-utils.js'), domains);
const registrable = (host) => vm.runInContext('registrableDomain', domains)(host);
const manifest = JSON.parse(read('manifest.json'));
const PACKS = manifest.declarative_net_request.rule_resources.filter((r) => r.enabled).map((r) => ({ id: r.id, rules: JSON.parse(read(r.path)) }));
const BG = read('background.js');
const B = require('./build-filter-lists-dnr.js');

const cache = new Map();
function filterRegex(filter, sensitive) {
  const key = filter + '\u0000' + !!sensitive;
  if (!cache.has(key)) {
    let f = filter, pre = '', post = '';
    if (f.startsWith('||')) { pre = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'; f = f.slice(2); } else if (f.startsWith('|')) { pre = '^'; f = f.slice(1); }
    if (f.endsWith('|')) { post = '$'; f = f.slice(0, -1); }
    const body = [...f].map((ch) => (ch === '*' ? '.*' : ch === '^' ? '(?:[^a-z0-9_.%-]|$)' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))).join('');
    cache.set(key, new RegExp(pre + body + post, sensitive ? '' : 'i'));
  }
  return cache.get(key);
}
const under = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));
function matches(rule, req) {
  const c = rule.condition;
  const url = new URL(req.url);
  const host = url.hostname;
  const initiator = req.initiator || '';
  if (c.resourceTypes ? !c.resourceTypes.includes(req.type) : req.type === 'main_frame') return false;
  if ((c.excludedResourceTypes || []).includes(req.type)) return false;
  if (c.requestMethods && !c.requestMethods.includes('get')) return false;
  if (c.requestDomains && !under(host, c.requestDomains)) return false;
  if (c.excludedRequestDomains && under(host, c.excludedRequestDomains)) return false;
  if (c.initiatorDomains && !(initiator && under(initiator, c.initiatorDomains))) return false;
  if (c.excludedInitiatorDomains && initiator && under(initiator, c.excludedInitiatorDomains)) return false;
  if (c.domainType && ((c.domainType === 'thirdParty') !== (!!initiator && registrable(initiator) !== registrable(host)))) return false;
  if (c.urlFilter && !filterRegex(c.urlFilter, c.isUrlFilterCaseSensitive).test(url.href)) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive ? '' : 'i').test(url.href)) return false;
  return true;
}
/* Highest priority wins; at equal priority allow beats block beats redirect, as in Chrome. */
const ORDER = ['allow', 'allowAllRequests', 'block', 'upgradeScheme', 'redirect'];
function decide(req, extra = []) {
  let best = null;
  for (const pack of PACKS.concat([{ id: 'dynamic', rules: extra }])) {
    for (const rule of pack.rules) {
      if (rule.action.type === 'modifyHeaders' || !matches(rule, req)) continue;
      const p = rule.priority || 1;
      if (!best || p > best.priority || (p === best.priority && ORDER.indexOf(rule.action.type) < ORDER.indexOf(best.action))) {
        best = { priority: p, action: rule.action.type, pack: pack.id, id: rule.id };
      }
    }
  }
  return best || { action: 'none' };
}
const req = (url, type, page) => ({ url, type, initiator: page });
const feedBlock = (host, priority = 1000) => ({ id: 1, priority, action: { type: 'block' }, condition: { requestDomains: [host], resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping'] } });

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

/* 1. The packaged lists apply their own rules: every compiled block or redirect stops an example of its own request,
   unless a list exception scoped at least as narrowly lets it through. A wrong scope, band or compile slip fails here. */
{
  const own = PACKS.filter((p) => ['ubo_filters', 'privacy_filters', 'badware_filters'].includes(p.id));
  let tried = 0;
  for (const pack of own) {
    for (const rule of pack.rules) {
      const c = rule.condition;
      if (!['block', 'redirect'].includes(rule.action.type) || c.regexFilter || c.excludedResourceTypes) continue;
      const hostMatch = /^\|\|([a-z0-9.-]+)([^*|^]*)\^?$/.exec(c.urlFilter || '');
      const host = c.requestDomains ? c.requestDomains[0] : hostMatch ? hostMatch[1] : null;
      if (!host || (c.urlFilter && !hostMatch)) continue;
      const pathPart = hostMatch ? hostMatch[2] : '';
      const url = 'https://' + host + (pathPart.startsWith('/') ? pathPart : '/' + pathPart.replace(/^[?&]/, '?')) ;
      const page = c.initiatorDomains ? 'www.' + c.initiatorDomains[0] : c.domainType === 'firstParty' ? host : 'unrelated-site.example';
      const r = req(url.replace(/\/$/, '/a.js'), (c.resourceTypes || ['script'])[0], page);
      if (!matches(rule, r)) continue;
      const verdict = decide(r);
      tried++;
      const listException = verdict.action === 'allow' && ['adshield_easylist', 'ubo_filters', 'privacy_filters'].includes(verdict.pack)
        && [2, 4, B.PRIORITY.scopedAllow].includes(verdict.priority);
      /* WardenOne's own compatibility allows (sign in, at 1900) outrank list blocks on purpose. */
      const compatibility = verdict.action === 'allow' && verdict.pack === 'grabber_compat' && verdict.priority >= 1900;
      ok(verdict.action === 'block' || verdict.action === 'redirect' || listException || compatibility,
        pack.id + ' rule ' + rule.id + ' does not apply to its own request ' + r.url + ' from ' + page + ': ' + JSON.stringify(verdict));
    }
  }
  ok(tried > 1000, 'too few rules replayed: ' + tried);
}

/* 2. A site scoped list exception beats WardenOne's other ad and tracker lists (a feed's 1000, a list option's 1100, a
   redirect's 1150) and never a security verdict. Round 6: exceptions only undid their own list. */
{
  const scoped = PACKS.find((p) => p.id === 'ubo_filters').rules.find((r) => r.action.type === 'allow' && r.priority === B.PRIORITY.scopedAllow
    && r.condition.requestDomains && r.condition.initiatorDomains && !r.condition.urlFilter && (r.condition.resourceTypes || ['script']).includes('script'));
  ok(!!scoped, 'no site scoped host exception to replay');
  const host = scoped.condition.requestDomains[0];
  const r = req('https://' + host + '/lib.js', 'script', 'www.' + scoped.condition.initiatorDomains[0]);
  for (const p of [1000, 1100, 1150]) ok(decide(r, [feedBlock(host, p)]).action === 'allow', 'a list exception lost to an ad or tracker block at ' + p);
  ok(decide(r, [feedBlock(host, 3000)]).action === 'block', 'a list exception overrode a security block');
  ok(decide(r, [{ id: 2, priority: 1900, action: { type: 'allow' }, condition: { requestDomains: [host] } }, feedBlock(host, 3000)]).action === 'block',
    'nothing below security may undo it');
}

/* 3. uBlock's $important outranks every list exception, packaged or downloaded, and stays under WardenOne's own
   compatibility allows and security. Comeback: downloaded exceptions at 1900 beat important redirects. */
{
  const band = Number((/const LIST_EXCEPTION_PRIORITY = (\d+);/.exec(BG) || [])[1]);
  ok(band === B.PRIORITY.scopedAllow, 'downloaded list exceptions left the packaged band: ' + band);
  ok(B.PRIORITY.important > band && B.PRIORITY.important < 1900, 'important must sit between list exceptions and compatibility');
  ok(/actionType === 'allow' \? LIST_EXCEPTION_PRIORITY :/.test(BG), 'downloaded exceptions no longer use the shared band');
}

/* 4. A list's stand in on the sites it names outranks the broad never-block allow (googleapis.com, which carries Google's
   IMA kit), but a stand in for every site does not, and security still wins. */
{
  const ima = PACKS.find((p) => p.id === 'ubo_filters').rules.find((r) => r.action.type === 'redirect'
    && r.action.redirect.extensionPath === '/surrogates/google-ima.js' && r.condition.initiatorDomains && /imasdk\.googleapis\.com/.test(r.condition.urlFilter || ''));
  ok(!!ima, 'no named site IMA stand in to replay');
  const r = req('https://imasdk.googleapis.com/js/sdkloader/ima3.js', 'script', 'www.' + ima.condition.initiatorDomains[0]);
  const neverBlock = { id: 3, priority: 1900, action: { type: 'allow' }, condition: { requestDomains: ['googleapis.com'], resourceTypes: ['script'] } };
  ok(decide(r, [neverBlock]).action === 'redirect', 'the named site stand in lost to the never-block allow');
  ok(decide(req(r.url, 'script', 'unrelated-site.example'), [neverBlock]).action === 'allow', 'a site the list does not name must keep the real kit');
  ok(decide(r, [neverBlock, feedBlock('imasdk.googleapis.com', 3000)]).action === 'block', 'a stand in outranked security');
}

/* 5. Badware rules meant for the page's exact host still block on that host (strict1p, nearest DNR scope). */
{
  const strict = PACKS.find((p) => p.id === 'badware_filters').rules.filter((r) => r.condition.regexFilter && r.condition.domainType === 'firstParty');
  ok(strict.length > 0, 'no Badware strict1p rule compiled');
  ok(strict.every((r) => r.priority >= 2000 && r.action.type === 'block'), 'Badware strict1p rules left the security band');
}

/* 6. EasyList's plain hosts are packed, so the packaged rules stay far inside Chrome's guaranteed 30,000. */
{
  const total = PACKS.reduce((n, p) => n + p.rules.length, 0);
  ok(total < 20000, 'packaged static rules grew to ' + total);
  ok(PACKS.find((p) => p.id === 'adshield_easylist').rules.some((r) => r.action.type === 'block' && (r.condition.requestDomains || []).length > 1000),
    'EasyList hosts are no longer packed');
}

/* 7. Brightcove's player and playback API stay loadable when a feed lists their parent whole, and its analytics do not. */
{
  const media = /const MEDIA_COMPAT_DOMAINS = new Set\((\[[\s\S]*?\])\);/.exec(BG);
  const hosts = vm.runInNewContext(media[1]);
  for (const h of ['players.brightcove.net', 'edge.api.brightcove.com']) ok(hosts.includes(h), h + ' left the media list');
  ok(!hosts.includes('metrics.brightcove.com'), 'Brightcove analytics must stay blockable');
}

console.log('[ok] filter regressions from the Round 6 1v1: ' + checks + ' checks');

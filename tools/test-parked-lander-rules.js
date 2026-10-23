/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
/* Decide which shipped static rule wins for the requests a GoDaddy parked page makes.
   EasyList blocks the whole parking lander, which left parked domains blank; the lander must
   load while its ad feed and trackers stay blocked.
   Run: node tools/test-parked-lander-rules.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const policy = require('./lib/network-policy.js');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const domains = vm.createContext({ URL });
vm.runInContext(read('domain-utils.js'), domains);
const registrable = (host) => vm.runInContext('registrableDomain', domains)(host);

const manifest = JSON.parse(read('manifest.json'));
const packs = manifest.declarative_net_request.rule_resources.filter((r) => r.enabled)
  .map((r) => ({ id: r.id, rules: JSON.parse(read(r.path)) }));
const adshield = packs.find((p) => p.id === 'adshield_easylist').rules;

function pinned(name) {
  const src = read('tools/build-adshield-dnr.js');
  const m = new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\n\\]);').exec(src);
  assert(m, 'missing ' + name + ' in tools/build-adshield-dnr.js');
  return vm.runInNewContext(m[1]);
}

const filterCache = new Map();
function filterRegex(filter) {
  if (filterCache.has(filter)) return filterCache.get(filter);
  let f = filter;
  let prefix = '';
  let suffix = '';
  if (f.startsWith('||')) { prefix = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'; f = f.slice(2); }
  else if (f.startsWith('|')) { prefix = '^'; f = f.slice(1); }
  if (f.endsWith('|')) { suffix = '$'; f = f.slice(0, -1); }
  const body = [...f].map((ch) => (ch === '*' ? '.*' : ch === '^' ? '(?:[^a-z0-9_.%-]|$)'
    : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))).join('');
  const re = new RegExp(prefix + body + suffix, 'i');
  filterCache.set(filter, re);
  return re;
}

const underDomain = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));
const KNOWN_KEYS = new Set(['urlFilter', 'regexFilter', 'requestDomains', 'initiatorDomains',
  'excludedInitiatorDomains', 'resourceTypes', 'excludedResourceTypes', 'domainType']);

function matches(rule, req) {
  const c = rule.condition;
  for (const key of Object.keys(c)) assert(KNOWN_KEYS.has(key), 'rule ' + rule.id + ' uses ' + key + ', which this matcher does not model');
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  const initiator = req.initiator || '';
  if (c.resourceTypes ? !c.resourceTypes.includes(req.type) : req.type === 'main_frame') return false;
  if ((c.excludedResourceTypes || []).includes(req.type)) return false;
  if (c.requestDomains && !underDomain(host, c.requestDomains)) return false;
  if (c.initiatorDomains && !(initiator && underDomain(initiator, c.initiatorDomains))) return false;
  if (c.excludedInitiatorDomains && initiator && underDomain(initiator, c.excludedInitiatorDomains)) return false;
  if (c.domainType) {
    const third = !!initiator && registrable(initiator) !== registrable(host);
    if ((c.domainType === 'thirdParty') !== third) return false;
  }
  if (c.urlFilter && !filterRegex(c.urlFilter).test(url.href)) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter, 'i').test(url.href)) return false;
  return true;
}

/* Highest priority wins; at equal priority allow beats block, as in Chrome. */
const ACTION_ORDER = ['allow', 'allowAllRequests', 'block', 'upgradeScheme', 'redirect', 'modifyHeaders'];
function winner(req, without) {
  let best = null;
  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (without && without(pack.id, rule)) continue;
      if (!matches(rule, req)) continue;
      const priority = rule.priority || 1;
      if (!best || priority > best.priority
        || (priority === best.priority && ACTION_ORDER.indexOf(rule.action.type) < ACTION_ORDER.indexOf(best.action))) {
        best = { priority, action: rule.action.type, pack: pack.id, id: rule.id };
      }
    }
  }
  return best;
}
const outcome = (req, without) => (winner(req, without) || { action: 'none' }).action;
const describe = (req) => JSON.stringify(winner(req));

const PAGE = 'wardenone.com';
const req = (url, type, initiator = PAGE) => ({ url, type, initiator });
const LANDER_JS = req('https://img1.wsimg.com/parking-lander/static/js/main.bb0a72ba.js', 'script');
const LANDER_CSS = req('https://img1.wsimg.com/parking-lander/static/css/main.4276ff80.css', 'stylesheet');
const LANDER_CONFIG = req('https://api.aws.parking.godaddy.com/v1/parking/landers/wardenone.com?trafficTarget=gd&abp=1&gdabp=true', 'xmlhttprequest');
const AD_FEED = req('https://wardenone.com/d/search/p/godaddy/xml/domain/multiset/v4/?url=wardenone.com&Partner=godad_park_dm_2903_search_domainparking&maxListings=3', 'xmlhttprequest');
const ANALYTICS = req('https://csp.secureserver.net/eventbus/web?clientid=b18ef4f046435b64a469b32c3c1c20a3', 'xmlhttprequest');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('every pinned rule in the build script ships in rules-adshield.json', () => {
  const shipped = new Set(adshield.map((r) => JSON.stringify([r.action, r.condition, r.priority || 1])));
  for (const rule of pinned('PINNED_ALLOW_RULES').concat(pinned('PINNED_BLOCK_RULES'))) {
    assert(shipped.has(JSON.stringify([rule.action, rule.condition, rule.priority])),
      'pinned rule missing from rules-adshield.json: ' + JSON.stringify(rule.condition));
  }
});

test('a parked page and its lander load', () => {
  assert.notEqual(outcome(req('https://wardenone.com/lander', 'main_frame', '')), 'block', 'the parked page itself is blocked');
  assert.equal(outcome(LANDER_JS), 'allow', 'the lander script is blocked: ' + describe(LANDER_JS));
  assert.equal(outcome(LANDER_CSS), 'allow', 'the lander stylesheet is blocked: ' + describe(LANDER_CSS));
  assert.equal(outcome(LANDER_CONFIG), 'none', 'the lander cannot read its own configuration: ' + describe(LANDER_CONFIG));
});

test('without the pinned allow, EasyList still blanks the page', () => {
  const withoutAllow = (pack, rule) => pack === 'adshield_easylist' && rule.action.type === 'allow'
    && rule.condition.urlFilter === '||wsimg.com/parking-lander/';
  assert.equal(outcome(LANDER_JS, withoutAllow), 'block',
    'EasyList no longer blocks the lander, so the pinned allow can go');
});

test('the parked page still shows no ads and sends no analytics', () => {
  assert.equal(outcome(AD_FEED), 'block', 'the parking ad feed loads: ' + describe(AD_FEED));
  assert.equal(outcome(ANALYTICS), 'block', 'GoDaddy parking analytics are no longer blocked: ' + describe(ANALYTICS));
});

test('the exception and the feed block stay narrow', () => {
  const allow = adshield.find((r) => r.action.type === 'allow' && r.condition.urlFilter === '||wsimg.com/parking-lander/');
  assert(allow.priority < policy.securityMin && allow.priority < 1000,
    'the lander allow outranks tracker or security blocks: priority ' + allow.priority);
  assert.equal(outcome(req('https://shop.example.com/d/search/results?q=boots', 'xmlhttprequest', 'shop.example.com')), 'none',
    'the feed block reached an ordinary site search');
  assert.equal(outcome(req('https://wardenone.com/d/search/p/godaddy/xml/', 'script')), 'none',
    'the feed block applies beyond the lander’s fetch');
});

let failures = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log('ok - ' + item.name);
  } catch (error) {
    failures++;
    console.error('not ok - ' + item.name);
    console.error(error && error.stack ? error.stack : error);
  }
}
if (failures) process.exitCode = 1;
else console.log('\n' + tests.length + ' parked-lander rule tests passed.');

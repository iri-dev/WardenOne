/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Trackers learned from real browsing: rules-badger.json blocks what Privacy Badger's pre-trained list
   blocks, minus what WardenOne deliberately leaves loading, and never more; rules-easyprivacy.json ships
   every EasyPrivacy host rule. The 2026-10-30 head-to-head found WardenOne blocking 2 of 19 trackers
   sampled from Privacy Badger's list, and EasyPrivacy cut off at hosts starting with "f".
   node tools/test-badger-trained.js */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { buildAll, readSnapshot, upstream, ancestors, RESOURCE_TYPES, PRIORITY } = require('./build-badger-dnr.js');
const { helpers } = require('./build-cname-data.js');
const { shippedTrackerCompat } = require('./lib/tracker-compat.js');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const { WOCname, siteIdentity } = helpers();
const runtime = shippedTrackerCompat();
const text = read('rules-badger.json');
const rules = JSON.parse(text);
const easyprivacy = JSON.parse(read('rules-easyprivacy.json'));
const trackers = JSON.parse(read('rules-trackers.json'));
const BG = read('background.js');
const manifest = JSON.parse(read('manifest.json'));
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };

/* ---- packaging and wiring ------------------------------------------------------------------ */
const snapshot = readSnapshot();
ok(buildAll(snapshot).text === text, 'rules-badger.json is exactly what the pinned snapshot builds');
ok(manifest.declarative_net_request.rule_resources.some(r => r.id === 'badger_trained' && r.path === 'rules-badger.json' && r.enabled === true),
  'the manifest ships the ruleset enabled');
ok(/\(trackersOn \? enableRulesetIds : disableRulesetIds\)\.push\(BADGER_STATIC_RULESET_ID\);/.test(BG), 'the tracker switch turns it on and off');
ok(/const BADGER_STATIC_RULESET_ID = 'badger_trained';/.test(BG) && /badger_trained: 'Privacy Badger trained list',/.test(BG),
  'the network logger names it');

/* ---- rule shape ---------------------------------------------------------------------------- */
ok(JSON.stringify(RESOURCE_TYPES) === JSON.stringify(easyprivacy[0].condition.resourceTypes), 'same request types as EasyPrivacy');
const seen = new Set();
rules.forEach((rule, index) => {
  const c = rule.condition;
  ok(rule.id === index + 1 && rule.priority === PRIORITY && rule.action.type === 'block', 'rule ' + rule.id + ' shape');
  ok(c.domainType === 'thirdParty' && !c.resourceTypes.includes('main_frame'), 'third-party subresources only: rule ' + rule.id);
  for (const host of runtime.login.concat(runtime.media)) ok(c.excludedInitiatorDomains.includes(host), 'compatibility initiator ' + host);
  for (const host of c.requestDomains) {
    ok(WOCname.normalizeHost(host) === host && !seen.has(host), 'normalized and listed once: ' + host);
    seen.add(host);
    ok(!runtime.isMediaCompatDomain(host) && !runtime.isProtectedTrackerDomain(host), 'protected or media host blocked: ' + host);
  }
});
ok(seen.size >= 3000, 'trained coverage regressed: ' + seen.size);

/* ---- behaviour: the shipped rules against Privacy Badger's own decision ------------------------ */
const under = (host, list) => !!list && list.some(d => host === d || host.endsWith('.' + d));
const byDomain = new Map();
const index = (list, rule) => { for (const d of list.condition.requestDomains) { if (!byDomain.has(d)) byDomain.set(d, []); byDomain.get(d).push(rule); } };
for (const rule of rules) index(rule, rule);
/* Chrome's matching for the condition keys these rules use. */
const blockedBy = (host, initiator, map = byDomain) => [host, ...ancestors(host)].some(level => (map.get(level) || []).some(rule => {
  const c = rule.condition;
  if (under(host, c.excludedRequestDomains) || under(initiator, c.excludedInitiatorDomains)) return false;
  return c.domainType !== 'thirdParty' || siteIdentity(host) !== siteIdentity(initiator);
}));

const { blocked, spared, fixes, entities } = upstream(snapshot, WOCname.normalizeHost);
const blockedSet = new Set(blocked.map(WOCname.normalizeHost).filter(Boolean));
const sister = (a, b) => entities.some(list => list.includes(a) && list.includes(b));
/* getBestAction ranks cookie-only and DNT above block at every level; site fixes and owners come first. */
function badgerBlocks(host, initiator) {
  const req = siteIdentity(host), init = siteIdentity(initiator);
  if (!req || req === init || sister(req, init)) return false;
  const levels = [host, ...ancestors(host)];
  if (levels.some(level => fixes.has(level) && fixes.get(level).has(initiator))) return false;
  if (levels.some(level => spared.has(level) && ['cookieblock', 'dnt', 'yellowlist'].includes(spared.get(level)))) return false;
  return levels.some(level => blockedSet.has(level));
}
const compat = runtime.login.concat(runtime.media);
function wardenOneSpares(host, initiator) {
  const levels = [host, ...ancestors(host)];
  return under(initiator, compat) || under(host, compat) || runtime.isProtectedTrackerDomain(host) || runtime.isMediaCompatDomain(host)
    || levels.some(level => ['surrogate', 'widget'].includes(spared.get(level)));
}
const hosts = new Set([...blockedSet, ...spared.keys(), ...fixes.keys()]);
for (const host of [...hosts]) hosts.add('deep-check.' + host);
let pairs = 0, intended = 0, sparedByWardenOne = new Set();
for (const host of hosts) {
  const site = siteIdentity(host);
  const initiators = new Set(['www.fixture-publisher-1.com', 'accounts.google.com']);
  if (site) initiators.add('www.' + site);
  const owners = entities.find(list => list.includes(site));
  if (owners) initiators.add('www.' + owners.find(other => other !== site));
  for (const level of [host, ...ancestors(host)]) if (fixes.has(level)) initiators.add([...fixes.get(level)][0]);
  for (const initiator of initiators) {
    const badger = badgerBlocks(host, initiator), spares = badger && wardenOneSpares(host, initiator);
    const expected = badger && !spares, actual = blockedBy(host, initiator);
    assert.equal(actual, expected, (actual ? 'blocks ' : 'misses ') + host + ' from ' + initiator);
    pairs++;
    if (expected) intended++;
    if (spares && !under(initiator, compat)) sparedByWardenOne.add(siteIdentity(host) || host);
  }
}
checks += pairs;
/* Each deliberate gap is a breakage guard; keep the list small and reviewed. */
ok(sparedByWardenOne.size <= 40, 'Privacy Badger blocks that WardenOne leaves loading grew to ' + sparedByWardenOne.size);
ok(!blockedBy('pixel.mfilterit.net', 'www.mfilterit.net') && blockedBy('pixel.mfilterit.net', 'www.fixture-publisher-1.com'),
  'a tracker is blocked on other sites and never on its own');
const fixedSite = [...fixes.get('securepubads.g.doubleclick.net') || []][0];
ok(!fixedSite || !blockedBy('securepubads.g.doubleclick.net', fixedSite), 'a Privacy Badger site fix keeps that site working');

/* ---- the head-to-head sample, against every tracker ruleset on the same switch ------------------- */
const allTrackers = new Map();
for (const rule of [...rules, ...easyprivacy, ...trackers]) if (rule.action.type === 'block' && rule.condition.requestDomains) index(rule, rule);
for (const [k, v] of byDomain) allTrackers.set(k, v);
const SAMPLE = ['snrbox.com', 'stape.ma', 'lotus-dsp.ru', 'mfilterit.net', 'nordicdataresources.net', 'sales-ninja.me', 'toss.im',
  'herbgreencolumn.com', 'qortex.ai', 'grape.media', 'buzzoola.com', 'posthog.com', 'pornlist.tv', 'mg2insights.com',
  'roimediaconsultants.com', 'tvspix.com', 'insurads.com', 'giosg.com', 'glotgrx.com'];
const missed = SAMPLE.filter(host => !blockedBy(host, 'www.fixture-publisher-4.com', allTrackers));
ok(missed.length === 0, 'head-to-head sample still missed: ' + missed.join(', '));

/* ---- sister sites for Smart Script Shield (Chaturbate's own CDN is mmcdn.com, 2026-10-31) -------- */
const sitesText = read('first-party-sites.json');
ok(buildAll(snapshot).sitesText === sitesText, 'first-party-sites.json is exactly what the pinned snapshot builds');
const owners = JSON.parse(sitesText).entities;
ok(owners.length > 400 && owners.every(list => list.length > 1 && list.every(host => WOCname.normalizeHost(host) === host)), 'owner groups are normalized');
ok(owners.some(list => ['chaturbate.com', 'mmcdn.com', 'highwebmedia.com'].every(host => list.includes(host))), 'Chaturbate and its CDNs are one owner');
ok(/const infra = SCRIPT_SHIELD_PLAYER_INFRA_HOSTS\.concat\(SCRIPT_SHIELD_FIRST_PARTY_APP_HOSTS, SCRIPT_SHIELD_SISTER_HOSTS,/.test(BG)
  && /await hydrateSmartScriptRecoveryTabs\(\);\s*await loadScriptShieldSisterHosts\(\);/.test(BG),
  'Smart Script Shield loads the sister sites before it writes its rules and exempts them from its heuristic');

/* ---- EasyPrivacy ships every host rule ------------------------------------------------------- */
const epHosts = easyprivacy.flatMap(rule => rule.condition.requestDomains);
ok(epHosts.length > 40000 && epHosts.filter(host => host[0] >= 'g').length > 20000, 'EasyPrivacy is cut off: ' + epHosts.length + ' hosts');
ok(['herbgreencolumn.com', 'qortex.ai'].every(host => epHosts.includes(host)), 'EasyPrivacy hosts after "f" are shipped');

console.log('[ok] trained tracker coverage: ' + seen.size + ' Privacy Badger hosts in ' + rules.length + ' rules, ' + pairs
  + ' host/site pairs match its own decision (' + intended + ' blocked, ' + sparedByWardenOne.size + ' sites left loading on purpose), '
  + epHosts.length + ' EasyPrivacy hosts, head-to-head sample 19/19');

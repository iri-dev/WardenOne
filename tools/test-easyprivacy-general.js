/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* EasyPrivacy's general collector rules (Round 5b, 2026-11-19). A site sending analytics to its own address was not
   blocked, because only EasyPrivacy's tracker hosts were shipped. The rules come from a pinned EasyPrivacy excerpt;
   payment, checkout, captcha and bot check sensor paths are left out, and EasyPrivacy's own exceptions apply. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const builder = require('./build-easyprivacy-general-dnr.js');
const RULES = JSON.parse(read('rules-easyprivacy-general.json'));
let failed = 0, passed = 0;
function check(what, ok) { if (ok) passed++; else { failed++; console.error('FAIL - ' + what); } }

const { general, allowlist } = builder.readSnapshot();
const rebuilt = builder.compile(general, allowlist).rules;
check('the shipped rules are exactly what the pinned excerpt compiles to', JSON.stringify(rebuilt) === JSON.stringify(RULES));
check('the excerpt names its EasyPrivacy commit and licence', /^! Commit: [0-9a-f]{40}$/m.test(read('docs/easyprivacy-general-snapshot.txt'))
  && /CC BY-SA 3\.0/.test(read('docs/easyprivacy-general-snapshot.txt')));
check('every rule is a numbered block at the tracker list priority', RULES.every((rule, i) => rule.id === i + 1 && rule.priority === 1000 && rule.action.type === 'block'));
const KNOWN = ['urlFilter', 'isUrlFilterCaseSensitive', 'resourceTypes', 'domainType', 'initiatorDomains', 'excludedInitiatorDomains', 'excludedRequestDomains'];
check('rules use only reviewed condition keys', RULES.every(rule => Object.keys(rule.condition).every(key => KNOWN.includes(key))));
check('no rule blocks a page itself', RULES.every(rule => !(rule.condition.resourceTypes || []).includes('main_frame')));
check('every pattern is ASCII and names a collector', RULES.every(rule => /^[\x21-\x7E]+$/.test(rule.condition.urlFilter) && /collect|beacon|telemetry/i.test(rule.condition.urlFilter)));
check('payment, checkout, captcha and bot check sensor paths are never imported', RULES.every(rule => !builder.FAIL_OPEN.test(rule.condition.urlFilter)));

/* DNR urlFilter semantics, enough for these patterns. */
function matcher(rule) {
  const c = rule.condition;
  let p = c.urlFilter, re = '';
  if (p.startsWith('||')) { re = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'; p = p.slice(2); }
  else if (p.startsWith('|')) { re = '^'; p = p.slice(1); }
  const end = p.endsWith('|');
  if (end) p = p.slice(0, -1);
  for (const ch of p) re += ch === '*' ? '.*' : ch === '^' ? '(?:[^A-Za-z0-9_.%-]|$)' : ch.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  if (end) re += '$';
  const regex = new RegExp(re, c.isUrlFilterCaseSensitive ? '' : 'i');
  const site = host => host.split('.').slice(-2).join('.');
  const within = (host, list) => (list || []).some(d => host === d || host.endsWith('.' + d));
  return req => {
    const url = new URL(req.url), from = new URL(req.initiator).hostname;
    if (req.type === 'main_frame' && !(c.resourceTypes || []).includes('main_frame')) return false;
    if (c.resourceTypes && !c.resourceTypes.includes(req.type)) return false;
    if (c.domainType === 'thirdParty' && site(url.hostname) === site(from)) return false;
    if (c.domainType === 'firstParty' && site(url.hostname) !== site(from)) return false;
    if (c.initiatorDomains && !within(from, c.initiatorDomains)) return false;
    if (within(from, c.excludedInitiatorDomains) || within(url.hostname, c.excludedRequestDomains)) return false;
    return regex.test(req.url);
  };
}
const matchers = RULES.map(rule => [rule, matcher(rule)]);
const blocked = req => matchers.some(([, test]) => test(req));

for (const [url, type, why] of [
  ['https://news-alpha.example/analytics/collect?cid=LABID-S1-abc12345', 'xmlhttprequest', 'a site sending analytics to its own address'],
  ['https://shop.example/stats/collect?event=view', 'ping', 'a first-party stats beacon'],
  ['https://shop.example/collect?v=1&tid=UA-1-1&cid=123.456', 'image', 'a proxied Universal Analytics hit'],
  ['https://metrics.shop.example/g/collect?v=2&tid=G-ABC123', 'xmlhttprequest', 'a proxied GA4 hit'],
  ['https://www.google.com/ccm/collect?en=page_view', 'image', 'Google conversion collection'],
  ['https://blog.example/wp-content/plugins/koko-analytics/koko-analytics-collect.php?p=1', 'ping', 'a WordPress analytics plugin'],
  ['https://cdn.example/assets/beacon.min.js', 'script', 'a beacon library'],
]) check('blocked, ' + why + ': ' + url, blocked({ url, type, initiator: new URL(url).origin + '/' }));

for (const [url, type, initiator, why] of [
  ['https://news-alpha.example/api/analytics/report.json', 'xmlhttprequest', 'https://news-alpha.example/', 'a site reading its own analytics for a chart (lab L5)'],
  ['https://shop.example/collections/shoes', 'xmlhttprequest', 'https://shop.example/', 'a shop collection page'],
  ['https://shop.example/collections?page=2', 'xmlhttprequest', 'https://shop.example/', 'a paged collection'],
  ['https://museum.example/recollections/1', 'image', 'https://museum.example/', 'a word that only contains the letters'],
  ['https://www.zillow.example/abc123/xhr/api/v2/collector', 'xmlhttprequest', 'https://www.zillow.example/', 'a bot check sensor'],
  ['https://shop.example/pay/collect', 'xmlhttprequest', 'https://shop.example/', 'a payment step'],
  ['https://px-cdn.net/api/v2/collector/ocaptcha', 'xmlhttprequest', 'https://shop.example/', 'the PerimeterX captcha'],
  ['https://teams.microsoft.com/dialin-cdn-root/1/aria-web-telemetry-2.js', 'script', 'https://teams.microsoft.com/', 'an EasyPrivacy exception'],
  ['https://static.cloudflareinsights.com/beacon.min.js', 'script', 'https://app.uniswap.org/', 'an EasyPrivacy exception host'],
  ['https://news-alpha.example/analytics/collect?cid=x', 'main_frame', 'https://news-alpha.example/', 'opening the address yourself'],
]) check('left alone, ' + why + ': ' + url, !blocked({ url, type, initiator }));

/* Wiring and paperwork. */
const manifest = JSON.parse(read('manifest.json'));
const entry = manifest.declarative_net_request.rule_resources.find(r => r.id === 'easyprivacy_general');
check('the manifest ships the ruleset, on by default', entry && entry.enabled === true && entry.path === 'rules-easyprivacy-general.json');
const BG = read('background.js');
check('the ruleset follows the tracker switch and the master switch',
  /\(trackersOn \? enableRulesetIds : disableRulesetIds\)\.push\(EASYPRIVACY_GENERAL_STATIC_RULESET_ID\);/.test(BG));
check('the Network Logger names it', /easyprivacy_general: 'EasyPrivacy collector paths'/.test(BG));
check('the package and the repair check include it', JSON.parse(read('tools/package-allowlist.json')).includes('rules-easyprivacy-general.json')
  && BG.includes("'rules-easyprivacy-general.json'"));
const licensing = JSON.parse(read('docs/source-licensing.json')).artifacts.find(a => a.file === 'rules-easyprivacy-general.json');
check('its licence and source are recorded', licensing && licensing.license === 'CC-BY-SA-3.0'
  && licensing.sourceFiles.includes('docs/easyprivacy-general-snapshot.txt') && /rules-easyprivacy-general\.json/.test(read('CREDITS.md')));
check('the pinned excerpt is a public document', JSON.parse(read('tools/publication-policy.json')).publicDocuments.includes('docs/easyprivacy-general-snapshot.txt'));
const enabledStatic = manifest.declarative_net_request.rule_resources.filter(r => r.enabled)
  .reduce((sum, r) => sum + JSON.parse(read(r.path)).length, 0);
const budget = JSON.parse(read('docs/perf/static-budget.json'));
const limit = JSON.stringify(budget).match(/"staticDnrRules":\s*(\d+)/g).map(m => Number(m.split(':')[1])).sort((a, b) => b - a)[0];
check('enabled static rules stay inside the static budget (' + enabledStatic + ' of ' + limit + ')', enabledStatic <= limit && enabledStatic <= 30000);

if (failed) { console.error(failed + ' EasyPrivacy general check(s) failed'); process.exit(1); }
console.log('[ok] EasyPrivacy general collector rules: ' + passed + ' checks (pinned source, scope, exceptions, wiring)');

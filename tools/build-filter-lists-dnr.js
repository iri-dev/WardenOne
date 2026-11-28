/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Compiles the network filters of uBlock's own lists and EasyPrivacy's path, query and site rules into two packaged
   rulesets. EasyList stays in rules-adshield.json and EasyPrivacy's plain tracker hosts in rules-easyprivacy.json.

     rules-ubo-filters.json     uBlock filters, Quick fixes and Unbreak (AdShield switch)
     rules-privacy-filters.json EasyPrivacy rules that are not plain hosts, and uBlock Privacy (tracker switch)

   A filter is compiled only when DNR can keep its whole scope: request host, caller, party, type and method. Anything
   else is skipped and counted, because a wider rule breaks sites and a narrower one hides that it did not apply.

   Precedence, matching the runtime list compiler in background.js:
     block 1, redirect 1150          ad and tracker verdicts, below every WardenOne compatibility or security band
     allow 2                         an exception with no site scope undoes only these packaged list blocks
     allow 1890                      an exception naming both its sites and its request also undoes WardenOne's other ad and tracker
                                     lists (1000 to 1160), and stays below compatibility (1900), OneTrust (1950) and
                                     security (2000 and up)
     important 1895                  beats both kinds of exception, still below compatibility and security

   Usage:
     node tools/build-filter-lists-dnr.js                    rebuild both rulesets from docs/filter-lists-snapshot.txt
     node tools/build-filter-lists-dnr.js --refresh <dir>    first refresh the snapshot from full lists in <dir>:
                                                             ubo-filters.txt ubo-quick-fixes.txt ubo-unbreak.txt
                                                             ubo-privacy.txt easyprivacy.txt */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'filter-lists-snapshot.txt');
const OUTPUTS = {
  ubo_filters: { file: 'rules-ubo-filters.json', sources: ['ubo-filters', 'ubo-quick-fixes', 'ubo-unbreak'] },
  privacy_filters: { file: 'rules-privacy-filters.json', sources: ['easyprivacy', 'ubo-privacy'] },
  /* Scam and malware paths from uBlock Badware. Its hosts already arrive with the malware feeds. These are security
     verdicts: blocks only, at the security band, so no list exception or compatibility allow can undo them. */
  badware_filters: { file: 'rules-badware-filters.json', sources: ['ubo-badware'], security: true },
};
const SOURCES = {
  'ubo-filters': 'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  'ubo-quick-fixes': 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
  'ubo-unbreak': 'https://ublockorigin.github.io/uAssets/filters/unbreak.txt',
  'ubo-privacy': 'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt',
  'ubo-badware': 'https://ublockorigin.github.io/uAssets/filters/badware.txt',
};

/* scopedStandIn: a redirect to one of WardenOne's stand ins on the sites a list names. It outranks the broad 1900
   compatibility allows (never-block lets all of googleapis.com load, Google's IMA ad kit included), because the stand in
   keeps the script's API working there; it stays under OneTrust's answer (1950) and every security band. */
const PRIORITY = { block: 1, redirect: 1150, allow: 2, scopedAllow: 1890, important: 1895, scopedStandIn: 1905, security: 2000 };
const MAX_RULES = { ubo_filters: 9000, privacy_filters: 12000, badware_filters: 2000 };
const MAX_REGEX_RULES = 900;
const MAX_REGEX_LENGTH = 180;
const HOSTS_PER_RULE = 2000;

/* WardenOne's own engines own these players and apps; a list rule there could fight them (YouTube ad shaping, the
   Twitch and Spotify ad handling). Host rules for them are skipped, and rules with no host are kept off their pages. */
const ENGINE_SITES = ['youtube.com', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com', 'twitch.tv', 'ttvnw.net',
  'jtvnw.net', 'spotify.com', 'spotifycdn.com', 'scdn.co'];
/* The pages among them. Only a page starts a request, so these are the callers a rule with no host is kept off. */
const ENGINE_PAGES = ['spotify.com', 'twitch.tv', 'youtube-nocookie.com', 'youtube.com'];
/* WardenOne fails open on payments and bot checks; the same paths are left out of rules-easyprivacy-general.json. */
const FAIL_OPEN = /(?:^|\/)(?:pay|payment|checkout|captcha|challenge)(?:\/|$)|\/api\/v2\/collector/i;
const SKIPPED_SECTIONS = /easyprivacy_specific_perimeterx\.txt/;
/* EasyPrivacy host rules with only party and type options are already in rules-easyprivacy.json, and Badware's host
   rules (with or without $doc) in the malware feeds. */
const EASYPRIVACY_HOST_RULE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(?:\$([a-z0-9,~_-]+))?$/i;

/* uBlock's redirect resources that WardenOne ships. The inert files mirror REDIRECT_RESOURCES in background.js;
   the scripts are WardenOne's own surrogates with the same API as uBlock's resource of that name. */
const NOOP = (file, types) => ({ path: '/redirect-resources/' + file, types });
const REDIRECTS = {
  'noop.js': NOOP('noop.js', ['script']), noopjs: NOOP('noop.js', ['script']),
  'noop.txt': NOOP('noop.txt', ['xmlhttprequest', 'other']), nooptext: NOOP('noop.txt', ['xmlhttprequest', 'other']),
  'noop.css': NOOP('noop.css', ['stylesheet']), noopcss: NOOP('noop.css', ['stylesheet']),
  'noop.json': NOOP('noop.json', ['xmlhttprequest', 'other']), noopjson: NOOP('noop.json', ['xmlhttprequest', 'other']),
  'noop.html': NOOP('noop.html', ['sub_frame']), noopframe: NOOP('noop.html', ['sub_frame']),
  '1x1.gif': NOOP('noop-1x1.gif', ['image']), '1x1-transparent.gif': NOOP('noop-1x1.gif', ['image']),
  '2x2.png': NOOP('noop-2x2.png', ['image']), '2x2-transparent.png': NOOP('noop-2x2.png', ['image']),
  '3x2.png': NOOP('noop-3x2.png', ['image']), '3x2-transparent.png': NOOP('noop-3x2.png', ['image']),
  '32x32.png': NOOP('noop-32x32.png', ['image']), '32x32-transparent.png': NOOP('noop-32x32.png', ['image']),
  'noop-0.1s.mp3': NOOP('noop-0.1s.mp3', ['media']), 'noopmp3-0.1s': NOOP('noop-0.1s.mp3', ['media']),
  'noop-0.5s.mp3': NOOP('noop-0.5s.mp3', ['media']), 'noop-1s.mp4': NOOP('noop-1s.mp4', ['media']),
  'noopmp4-1s': NOOP('noop-1s.mp4', ['media']),
  'noopvast-2.0': NOOP('noop-vast2.xml', ['xmlhttprequest', 'other']), 'noopvast-3.0': NOOP('noop-vast3.xml', ['xmlhttprequest', 'other']),
  'noopvast-4.0': NOOP('noop-vast4.xml', ['xmlhttprequest', 'other']), 'noopvmap-1.0': NOOP('noop-vmap1.xml', ['xmlhttprequest', 'other']),
  'google-analytics_analytics.js': { path: '/surrogates/analytics.js', types: ['script'] },
  'googletagmanager_gtm.js': { path: '/surrogates/tag-manager.js', types: ['script'] },
  'googletagservices_gpt.js': { path: '/surrogates/publisher-tag.js', types: ['script'] },
  'amazon_apstag.js': { path: '/surrogates/apstag.js', types: ['script'] },
  'googlesyndication_adsbygoogle.js': { path: '/surrogates/adsbygoogle.js', types: ['script'] },
  'google-ima.js': { path: '/surrogates/google-ima.js', types: ['script'] },
  'google-ima3': { path: '/surrogates/google-ima.js', types: ['script'] },
};

const TYPES = {
  script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet', object: 'object',
  xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest', subdocument: 'sub_frame', frame: 'sub_frame',
  ping: 'ping', beacon: 'ping', media: 'media', font: 'font', websocket: 'websocket', other: 'other',
};
/* Informational, or about the element hiding engine; they do not change which requests a filter matches. */
const IGNORED = new Set(['reason']);
/* Exceptions that only switch off element hiding or scriptlets: not network verdicts. */
const COSMETIC_EXCEPTION = new Set(['elemhide', 'ehide', 'generichide', 'ghide', 'specifichide', 'shide', 'content']);

/* uBlock's !#if tokens, answered as a Chromium MV3 DNR engine would (uBlock Origin Lite answers ext_ubol the same). */
const ENV = { env_chromium: true, env_edge: false, env_mv3: true, ext_ubol: true, env_firefox: false, env_mobile: false,
  env_safari: false, cap_html_filtering: false, cap_ipaddress: false, cap_user_stylesheet: true, false: false, true: true };
function evaluateCondition(expr) {
  const tokens = expr.replace(/\s+/g, '').match(/!|&&|\|\||\(|\)|[a-z_0-9]+/gi) || [];
  let at = 0;
  const unary = () => { const t = tokens[at++]; if (t === '!') return !unary(); if (t === '(') { const v = or(); at++; return v; } return !!ENV[t]; };
  const and = () => { let v = unary(); while (tokens[at] === '&&') { at++; v = unary() && v; } return v; };
  const or = () => { let v = and(); while (tokens[at] === '||') { at++; v = and() || v; } return v; };
  return or();
}
function activeLines(text) {
  const out = [];
  const stack = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('!#if ')) { stack.push(evaluateCondition(line.slice(5))); continue; }
    if (line === '!#else') { if (stack.length) stack.push(!stack.pop()); continue; }
    if (line === '!#endif') { stack.pop(); continue; }
    if (stack.every(Boolean)) out.push(line);
  }
  return out;
}

const isComment = (line) => !line || line[0] === '!' || line[0] === '[';
const isCosmetic = (line) => /#[@?$%]?#|#\+js|#\^#|#@\$#|#@\?#|##\^/.test(line);

/* The network filters of one list, with EasyPrivacy's plain host rules and its PerimeterX section left out. */
function networkLines(name, text) {
  const out = [];
  let skipSection = false;
  for (const line of activeLines(text)) {
    if (line.startsWith('! *** ')) { skipSection = SKIPPED_SECTIONS.test(line); continue; }
    if (skipSection || isComment(line) || isCosmetic(line)) continue;
    if ((name === 'easyprivacy' || name === 'ubo-badware') && EASYPRIVACY_HOST_RULE.test(line)
      && !/(?:^|[$,])(?:important|redirect)/.test(line)) continue;
    out.push(line);
  }
  return out;
}

function splitFilter(line) {
  let s = line;
  const exception = s.startsWith('@@');
  if (exception) s = s.slice(2);
  if (s.startsWith('/')) {
    /* A regex ends at the first "/$" followed by real options, which may hold slashes of their own
       (header=etag:/.../), or at the final slash when there are none. */
    let end = -1;
    for (let i = s.indexOf('/$', 1); i > 0 && end < 0; i = s.indexOf('/$', i + 1)) {
      if (s.slice(i + 2).split(',').every((t) => /^~?[a-z0-9_-]+(?:=|$)/i.test(t))) end = i;
    }
    if (end < 0 && s.endsWith('/') && s.length > 2) end = s.length - 1;
    if (end > 0 && /[\\[\](){}?+|^$.*]/.test(s.slice(1, end))) {
      return { exception, pattern: s.slice(0, end + 1), options: s.slice(end + 2), regex: true };
    }
  }
  const dollar = s.lastIndexOf('$');
  if (dollar >= 0 && /^~?[a-z0-9_-]+(?:=[^,]*)?(?:,~?[a-z0-9_-]+(?:=[^,]*)?)*$/i.test(s.slice(dollar + 1))) {
    return { exception, pattern: s.slice(0, dollar), options: s.slice(dollar + 1), regex: false };
  }
  return { exception, pattern: s, options: '', regex: false };
}

const hostOk = (h) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(h) && h.length <= 253;
const onEngineSite = (h) => ENGINE_SITES.some((s) => h === s || h.endsWith('.' + s));

function domainList(value) {
  const include = [];
  const exclude = [];
  for (const part of String(value || '').split('|')) {
    const d = part.trim().toLowerCase();
    if (!d) continue;
    const neg = d[0] === '~';
    const host = neg ? d.slice(1) : d;
    if (!hostOk(host)) return null;
    (neg ? exclude : include).push(host);
  }
  return { include, exclude };
}

/* Edge 157 isRegexSupported answered memoryLimitExceeded for these on 2026-11-27, so a static ruleset would drop them
   with only a warning. Rerun the browser check after refreshing the snapshot. */
const BROWSER_REFUSED_REGEX = new Set([
  '^https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/[-a-z_]{4,22}@latest\\/dist\\/script\\.min\\.js$',
  '\\.com\\/[-_0-9a-zA-Z]{4,}\\/[-\\/_0-9a-zA-Z]{25,}$',
  '^https:\\/\\/www\\.igorslab\\.de\\/(?:[0-9a-z-]{7,}\\/)+A[\\/0-9A-Z_a-z-]{100,}(?:[0-9a-z-]{7,}\\/)*$',
]);

/* Converts a JavaScript regex body to one DNR accepts, or null. RE2 has no lookaround or backreferences. */
function regexForDnr(body) {
  if (body.length > MAX_REGEX_LENGTH || /[^\x20-\x7e]/.test(body) || BROWSER_REFUSED_REGEX.has(body)) return null;
  if (/\(\?[=!<]|\\[1-9]|\\u|\(\?<[a-z]/i.test(body)) return null;
  try { new RegExp(body); } catch (_) { return null; }
  return body;
}

function parseOptions(text, stats, scope = {}) {
  const o = { types: [], notTypes: [], domainType: null, domains: null, excludedDomains: null, requestDomains: null,
    excludedRequestDomains: null, methods: [], notMethods: [], matchCase: false, important: false, redirect: null,
    badfilter: false, document: false, cosmetic: false };
  for (const raw of text ? text.split(',') : []) {
    const token = raw.trim();
    if (!token) continue;
    const neg = token[0] === '~';
    const body = neg ? token.slice(1) : token;
    const eq = body.indexOf('=');
    const key = (eq < 0 ? body : body.slice(0, eq)).toLowerCase();
    const value = eq < 0 ? '' : body.slice(eq + 1);
    if (IGNORED.has(key)) continue;
    if (COSMETIC_EXCEPTION.has(key)) { o.cosmetic = true; continue; }
    if (key === 'badfilter') { o.badfilter = true; continue; }
    if (key === 'important') { o.important = true; continue; }
    if (key === 'match-case') { o.matchCase = !neg; continue; }
    if (key === 'third-party' || key === '3p' || key === 'strict3p') { o.domainType = neg ? 'firstParty' : 'thirdParty'; continue; }
    if (key === 'first-party' || key === '1p') { o.domainType = neg ? 'thirdParty' : 'firstParty'; continue; }
    /* strict1p means the page's exact host, which DNR cannot say. For security blocks only, the nearest scope that
       contains it (the same site) is used: a scam loader blocked on a sibling address of the page is no loss. */
    if (key === 'strict1p' && scope.security && !neg) { o.domainType = 'firstParty'; continue; }
    if (key === 'domain' || key === 'from') {
      const list = domainList(value);
      if (neg || !list) return { skip: 'domain' };
      if (list.include.length) o.domains = list.include;
      if (list.exclude.length) o.excludedDomains = list.exclude;
      continue;
    }
    if (key === 'to') {
      const list = domainList(value);
      if (neg || !list) return { skip: 'to' };
      if (list.include.length) o.requestDomains = list.include;
      if (list.exclude.length) o.excludedRequestDomains = list.exclude;
      continue;
    }
    if (key === 'denyallow') {
      const list = domainList(value);
      if (neg || !list || list.exclude.length) return { skip: 'denyallow' };
      o.excludedRequestDomains = (o.excludedRequestDomains || []).concat(list.include);
      continue;
    }
    if (key === 'method') {
      for (const m of value.toLowerCase().split('|')) {
        const n = m.replace(/^~/, '');
        if (!/^(connect|delete|get|head|options|patch|post|put)$/.test(n)) return { skip: 'method' };
        (m[0] === '~' ? o.notMethods : o.methods).push(n);
      }
      continue;
    }
    if (key === 'redirect') { if (neg) return { skip: 'redirect' }; o.redirect = value.split(':')[0]; continue; }
    if (key === 'document' || key === 'doc') { if (neg) return { skip: 'document' }; o.document = true; continue; }
    if (TYPES[key]) { (neg ? o.notTypes : o.types).push(TYPES[key]); continue; }
    stats.options[key] = (stats.options[key] || 0) + 1;
    return { skip: 'option' };
  }
  return o;
}

/* One filter line to one rule, or a reason it was skipped. */
function convert(line, stats, scope = {}) {
  const f = splitFilter(line);
  const o = parseOptions(f.options, stats, scope);
  if (o.skip) return { skip: o.skip };
  if (o.badfilter) return { badfilter: true };
  if (o.cosmetic) return { skip: 'cosmetic exception' };
  if (o.document) return { skip: f.exception ? 'document exception' : 'document block' };
  if (o.types.length && o.notTypes.length) return { skip: 'mixed types' };
  if (o.methods.length && o.notMethods.length) return { skip: 'mixed methods' };
  if (f.exception && (o.redirect !== null || o.important)) return { skip: 'redirect exception' };

  const condition = {};
  let host = null;
  if (f.regex) {
    const body = regexForDnr(f.pattern.slice(1, -1));
    if (!body) return { skip: 'regex' };
    condition.regexFilter = body;
  } else {
    const pattern = f.pattern;
    if (/[^\x21-\x7e]/.test(pattern)) return { skip: 'non ascii' };
    const inner = pattern.slice(pattern.startsWith('||') ? 2 : pattern.startsWith('|') ? 1 : 0, pattern.endsWith('|') ? -1 : undefined);
    if (inner.includes('|')) return { skip: 'mid pipe' };
    const core = pattern.replace(/^\|{1,2}/, '').replace(/\|$/, '').replace(/[*^]/g, '');
    if (core.length < 3 && !o.domains && !o.requestDomains) return { skip: 'too generic' };
    const anchored = /^\|\|([a-z0-9.-]+)(?=[\^/:*?]|$)/i.exec(pattern);
    host = anchored ? anchored[1].toLowerCase().replace(/\.$/, '') : null;
    if (/^\|\|[a-z0-9.-]+\^$/i.test(pattern) && hostOk(host)) condition.requestDomains = [host];
    else if (pattern !== '' && pattern !== '*') condition.urlFilter = pattern;
  }
  if (!f.exception && !f.regex && FAIL_OPEN.test(f.pattern)) return { skip: 'fail open path' };

  const requestHosts = [host, ...(o.requestDomains || [])].filter(Boolean);
  if (requestHosts.some(onEngineSite) || (o.domains || []).some(onEngineSite)) return { skip: 'engine site' };

  if (o.matchCase) condition.isUrlFilterCaseSensitive = true;
  if (o.domainType) condition.domainType = o.domainType;
  if (o.domains) condition.initiatorDomains = [...new Set(o.domains)].sort();
  if (o.requestDomains) {
    if (condition.requestDomains) return { skip: 'to with host' };
    condition.requestDomains = [...new Set(o.requestDomains)].sort();
  }
  const excludedSites = [...(o.excludedDomains || [])];
  if (!f.exception && !host && !o.domains && !o.requestDomains) excludedSites.push(...ENGINE_PAGES);
  if (excludedSites.length) condition.excludedInitiatorDomains = [...new Set(excludedSites)].sort();
  if (o.excludedRequestDomains) condition.excludedRequestDomains = [...new Set(o.excludedRequestDomains)].sort();
  if (o.methods.length) condition.requestMethods = [...new Set(o.methods)].sort();
  if (o.notMethods.length) condition.excludedRequestMethods = [...new Set(o.notMethods)].sort();

  let types = [...new Set(o.types)];
  if (o.redirect !== null) {
    const resource = REDIRECTS[o.redirect];
    if (!resource) return { skip: 'redirect resource' };
    types = (types.length ? types : resource.types).filter((t) => t !== 'main_frame');
    if (!types.length) return { skip: 'redirect type' };
    condition.resourceTypes = types.sort();
    const standIn = resource.path.startsWith('/surrogates/') && !!condition.initiatorDomains;
    return { rule: { priority: standIn ? PRIORITY.scopedStandIn : o.important ? PRIORITY.important : PRIORITY.redirect,
      action: { type: 'redirect', redirect: { extensionPath: resource.path } }, condition } };
  }
  if (types.length) condition.resourceTypes = types.sort();
  else if (o.notTypes.length) condition.excludedResourceTypes = [...new Set(o.notTypes.concat('main_frame'))].sort();

  if (f.exception) {
    /* Named sites and a named request: an exception that lets everything through on a site stays at 2. */
    const scoped = !!condition.initiatorDomains && !!(condition.urlFilter || condition.regexFilter || condition.requestDomains);
    return { rule: { priority: scoped ? PRIORITY.scopedAllow : PRIORITY.allow, action: { type: 'allow' }, condition } };
  }
  return { rule: { priority: o.important ? PRIORITY.important : PRIORITY.block, action: { type: 'block' }, condition } };
}

/* uBlock's $badfilter cancels the filter written the same way without it. */
const badfilterKey = (line) => {
  const f = splitFilter(line);
  const opts = f.options.split(',').map((s) => s.trim()).filter((s) => s && s !== 'badfilter').sort().join(',');
  return (f.exception ? '@@' : '') + f.pattern + '$' + opts;
};

/* Rules that differ only in their single request host become one rule naming every host. */
function packHosts(rules) {
  const groups = new Map();
  const out = [];
  for (const rule of rules) {
    const c = rule.condition;
    if (c.requestDomains && c.requestDomains.length === 1 && !c.urlFilter && !c.regexFilter) {
      const { requestDomains, ...rest } = c;
      const key = JSON.stringify([rule.priority, rule.action, rest]);
      if (!groups.has(key)) groups.set(key, { rule, rest, hosts: new Set() });
      groups.get(key).hosts.add(requestDomains[0]);
    } else out.push(rule);
  }
  for (const { rule, rest, hosts } of groups.values()) {
    const all = [...hosts].sort();
    for (let i = 0; i < all.length; i += HOSTS_PER_RULE) {
      out.push({ priority: rule.priority, action: rule.action, condition: Object.assign({ requestDomains: all.slice(i, i + HOSTS_PER_RULE) }, rest) });
    }
  }
  return out;
}

function compile(listsByName, outputName) {
  const stats = { lines: 0, converted: 0, badfiltered: 0, duplicate: 0, skipped: {}, options: {} };
  const allLines = Object.values(listsByName).flat();
  const bad = new Set(allLines.filter((l) => /(?:^|[$,])badfilter(?:,|$)/.test(l)).map(badfilterKey));
  const seen = new Set();
  const converted = [];
  for (const name of OUTPUTS[outputName].sources) {
    for (const line of listsByName[name] || []) {
      stats.lines++;
      if (bad.has(badfilterKey(line))) { stats.badfiltered++; continue; }
      const r = convert(line, stats, { security: !!OUTPUTS[outputName].security });
      if (r.badfilter) continue;
      if (!r.skip && OUTPUTS[outputName].security) {
        if (r.rule.action.type !== 'block') r.skip = 'security list exception or redirect';
        else r.rule.priority = PRIORITY.security;
      }
      if (r.skip) { stats.skipped[r.skip] = (stats.skipped[r.skip] || 0) + 1; continue; }
      const sig = JSON.stringify([r.rule.priority, r.rule.action, r.rule.condition]);
      if (seen.has(sig)) { stats.duplicate++; continue; }
      seen.add(sig);
      converted.push(r.rule);
      stats.converted++;
    }
  }
  /* Exceptions and redirects first: dropping one would turn a working page into a broken one. */
  const order = (r) => (r.action.type === 'allow' ? 0 : r.action.type === 'redirect' ? 1 : 2);
  let rules = packHosts(converted).sort((a, b) => order(a) - order(b));
  let regexCount = 0;
  rules = rules.filter((r) => !r.condition.regexFilter || ++regexCount <= MAX_REGEX_RULES);
  stats.dropped = Math.max(0, rules.length - MAX_RULES[outputName]);
  rules = rules.slice(0, MAX_RULES[outputName]).map((r, i) => ({ id: i + 1, priority: r.priority, action: r.action, condition: r.condition }));
  stats.rules = rules.length;
  stats.regex = rules.filter((r) => r.condition.regexFilter).length;
  return { rules, stats };
}

/* Hosts the curated filter lists block only for some request types, on named sites or at named paths, and that no
   packaged list blocks whole. background.js keeps a downloaded ad or tracker list from blocking exactly these hosts
   whole; the packaged rules still block them within the curated scope. Security lists are never narrowed. */
const SCOPE_FILE = 'curated-host-scopes.json';
const CURATED_FILES = ['rules-adshield.json', 'rules-ubo-filters.json', 'rules-privacy-filters.json', 'rules-easyprivacy.json',
  'rules-easyprivacy-general.json'];
const WHOLE_HOST_FILES = CURATED_FILES.concat(['rules-trackers.json', 'rules-badger.json', 'rules-cname.json']);
/* Hosts another WardenOne protection is built around blocking whole. uBlock defuses Ad-Shield with page scripts and
   scopes its loader narrowly; WardenOne blocks the loader and anti-adblock-shield.js stops the page blanking that
   follows. Narrowing it let the loader run again (TechRadar, 2026-11-27: three times the page's script time). */
function protectionWholeHosts(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'anti-adblock-shield.js'), 'utf8');
  const m = /const LOADER_HOSTS = (\[[^\]]*\]);/.exec(src);
  if (!m) throw new Error('anti-adblock-shield.js no longer lists LOADER_HOSTS');
  return JSON.parse(m[1].replace(/'/g, '"'));
}
const SUBRESOURCE_TYPES = ['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
  'media', 'websocket', 'other'];
function curatedScopedHosts(readRules, keepWhole = protectionWholeHosts()) {
  const wholeRules = new Map();
  for (const host of keepWhole) wholeRules.set(host, [[]]);
  const scoped = new Set();
  for (const file of WHOLE_HOST_FILES) {
    for (const rule of readRules(file)) {
      if (rule.action.type !== 'block' && rule.action.type !== 'redirect') continue;
      const c = rule.condition;
      if (c.regexFilter) continue;
      const anchored = /^\|\|([a-z0-9.-]+)(.*)$/.exec(c.urlFilter || '');
      const hosts = c.requestDomains || (anchored ? [anchored[1].replace(/\.$/, '')] : []);
      const path = !!anchored && !(anchored[2] === '^' || anchored[2] === '');
      const allTypes = (!c.resourceTypes && !c.excludedResourceTypes) || (c.resourceTypes && SUBRESOURCE_TYPES.every((t) => c.resourceTypes.includes(t)));
      const whole = !path && allTypes && !c.initiatorDomains && c.domainType !== 'firstParty';
      for (const host of hosts) {
        if (whole) { if (!wholeRules.has(host)) wholeRules.set(host, []); wholeRules.get(host).push(c.excludedRequestDomains || []); }
        else if (CURATED_FILES.includes(file)) scoped.add(host);
      }
    }
  }
  const under = (host, parent) => host === parent || host.endsWith('.' + parent);
  /* Whole when a parent is listed by a rule that does not carve this host back out (Badger excludes some players). */
  const whole = (host) => {
    for (let p = host; p.includes('.'); p = p.slice(p.indexOf('.') + 1)) {
      for (const excluded of wholeRules.get(p) || []) if (!excluded.some((e) => under(host, e))) return true;
    }
    return false;
  };
  return [...scoped].filter((host) => !whole(host)).sort();
}

function readSnapshot(text) {
  const lists = {};
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^! \[([a-z-]+)\]/.exec(line);
    if (m) { current = m[1]; lists[current] = []; continue; }
    if (!current || isComment(line)) continue;
    lists[current].push(line);
  }
  return lists;
}

function refreshSnapshot(dir) {
  const parts = ['! WardenOne excerpt of uBlock filters and EasyPrivacy: the network filters tools/build-filter-lists-dnr.js',
    '! compiles. Element hiding and scriptlet filters are left out. Each section names its source and version.',
    '! uBlock filters: uBlock Origin contributors, GPLv3, https://github.com/uBlockOrigin/uAssets',
    '! EasyPrivacy: the EasyList authors, dual licensed GPLv3 and CC BY-SA 3.0, https://easylist.to/pages/licence.html'];
  for (const name of Object.keys(SOURCES)) {
    const text = fs.readFileSync(path.join(dir, name + '.txt'), 'utf8');
    const header = text.split(/\r?\n/).slice(0, 40);
    const stamp = header.find((l) => /^! (Last modified|Version):/.test(l)) || '! Version: unknown';
    parts.push('! [' + name + '] ' + SOURCES[name], stamp, ...networkLines(name, text));
  }
  fs.writeFileSync(SNAPSHOT, parts.join('\n') + '\n');
}

function main() {
  const refresh = process.argv.indexOf('--refresh');
  const check = process.argv.includes('--check');
  if (refresh > 0) refreshSnapshot(process.argv[refresh + 1]);
  const lists = readSnapshot(fs.readFileSync(SNAPSHOT, 'utf8'));
  const policy = require('./lib/network-policy.js');
  for (const name of Object.keys(OUTPUTS)) {
    const { rules, stats } = compile(lists, name);
    policy.validate({ addRules: rules }, 'static');
    const out = path.join(ROOT, OUTPUTS[name].file);
    if (check) {
      if (fs.readFileSync(out, 'utf8') !== JSON.stringify(rules)) {
        console.error('[fail] ' + OUTPUTS[name].file + ' does not match docs/filter-lists-snapshot.txt; rerun tools/build-filter-lists-dnr.js');
        process.exitCode = 1;
      } else console.log('[ok] ' + OUTPUTS[name].file + ' matches its pinned source (' + rules.length + ' rules)');
      continue;
    }
    fs.writeFileSync(out, JSON.stringify(rules));
    console.log('[ok] ' + OUTPUTS[name].file + ': ' + rules.length + ' rules (' + stats.regex + ' regex) from ' + stats.lines
      + ' filters; converted ' + stats.converted + ', badfilter ' + stats.badfiltered + ', duplicate ' + stats.duplicate
      + ', dropped ' + stats.dropped);
    console.log('     skipped ' + JSON.stringify(stats.skipped) + ' options ' + JSON.stringify(stats.options));
  }
  const scopes = JSON.stringify(curatedScopedHosts((file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))));
  const scopeOut = path.join(ROOT, SCOPE_FILE);
  if (check) {
    if (fs.readFileSync(scopeOut, 'utf8') !== scopes) { console.error('[fail] ' + SCOPE_FILE + ' is stale; rerun tools/build-filter-lists-dnr.js'); process.exitCode = 1; }
    else console.log('[ok] ' + SCOPE_FILE + ' matches the packaged rules');
  } else {
    fs.writeFileSync(scopeOut, scopes);
    console.log('[ok] ' + SCOPE_FILE + ': ' + JSON.parse(scopes).length + ' hosts the curated lists scope narrowly');
  }
}

if (require.main === module) main();
module.exports = { convert, compile, packHosts, networkLines, activeLines, evaluateCondition, regexForDnr, readSnapshot,
  badfilterKey, curatedScopedHosts, protectionWholeHosts, PRIORITY, REDIRECTS, ENGINE_SITES, ENGINE_PAGES, OUTPUTS, SCOPE_FILE };

#!/usr/bin/env node
// Builds rules-adshield.json -- a STATIC declarativeNetRequest ruleset compiled
// from EasyList network filters. This is what gives "Adblock: General sites"
// real uBlock-grade network blocking (path patterns, resource types, third-party
// scoping) without consuming any of the 30k DYNAMIC rule budget the host lists,
// option rules, learner and allowlist share.
//
// Usage:  node tools/build-adshield-dnr.js <easylist.txt> <rules-adshield.json>
//
// Conversion philosophy: CONSERVATIVE. A filter is either mapped 1:1 onto DNR
// semantics or it is skipped and counted -- never approximated. Approximating a
// blocker rule risks breaking sites; approximating an exception risks hiding
// real protection gaps. uBlock at runtime will always out-cover this; the goal
// is the 90% of network ad-blocking that DNR can express natively.
'use strict';

const fs = require('fs');

const MAX_RULES = 29500; // rules.json ships 162 static rules; 162 + 29500 = 29662 stays under Chrome's 30k GUARANTEED static budget (~338 rule margin). The old 28000 left ~1800 rules of headroom unused -- those are EasyList blocks that were being dropped for no reason.

const PINNED_ALLOW_RULES = [
  { action: { type: 'allow' }, condition: { urlFilter: '||github-cloud.s3.amazonaws.com^' }, priority: 4, kind: 'allow' },
  { action: { type: 'allow' }, condition: { urlFilter: '||github-production-*.s3.amazonaws.com^' }, priority: 4, kind: 'allow' },
  { action: { type: 'allow' }, condition: { urlFilter: '||github-user-attachments.s3.amazonaws.com^' }, priority: 4, kind: 'allow' },
  { action: { type: 'allow' }, condition: { urlFilter: '||github-repository-files.s3.amazonaws.com^' }, priority: 4, kind: 'allow' },
];

// EasyList option key -> DNR resource type. null = recognised but unsupported
// (the whole filter is skipped; dropping an option silently would change scope).
const TYPE_MAP = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  other: 'other',
  document: 'document', // special-cased: allowAllRequests on @@, skipped on blocks
  doc: 'document',
};

// Recognised-but-unconvertible options. Any filter carrying one is skipped.
const UNSUPPORTED = new Set([
  'popup', 'popunder', 'important', 'badfilter', 'redirect', 'redirect-rule',
  'csp', 'removeparam', 'queryprune', 'replace', 'header', 'empty', 'mp4',
  'genericblock', 'generichide', 'ghide', 'elemhide', 'ehide', 'specifichide',
  'shide', 'inline-script', 'inline-font', 'cname', 'denyallow', 'from', 'to',
  'method', 'strict1p', 'strict3p', 'webrtc', 'object-subrequest',
  'permissions', 'urlskip', 'ipaddress', 'reason',
]);

function parseOptions(optStr) {
  const out = {
    types: [], negTypes: [], domainType: null, domains: [], excludedDomains: [],
    matchCase: false, unsupported: false, hasDocument: false, hasAll: false,
  };
  for (const raw of optStr.split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    const neg = tok[0] === '~';
    const body = neg ? tok.slice(1) : tok;
    const eq = body.indexOf('=');
    const key = (eq === -1 ? body : body.slice(0, eq)).toLowerCase();
    const val = eq === -1 ? '' : body.slice(eq + 1);

    // $all = block every resource type (incl. the page navigation). DNR expresses
    // this as a block rule with NO resourceTypes filter, which already matches all
    // types including main_frame. We can't honour $all's implied popup blocking,
    // but the network block still applies -- so convert rather than skip.
    if (key === 'all') { if (neg) { out.unsupported = true; return out; } out.hasAll = true; continue; }
    if (key === 'third-party' || key === '3p') { out.domainType = neg ? 'firstParty' : 'thirdParty'; continue; }
    if (key === 'first-party' || key === '1p') { out.domainType = neg ? 'thirdParty' : 'firstParty'; continue; }
    if (key === 'match-case') { out.matchCase = !neg; continue; }
    if (key === 'domain') {
      if (neg || !val) { out.unsupported = true; return out; }
      for (const d of val.split('|')) {
        const dom = d.trim().toLowerCase();
        if (!dom) continue;
        const dneg = dom[0] === '~';
        const name = dneg ? dom.slice(1) : dom;
        // entity wildcards (example.*) and non-ASCII have no DNR equivalent
        if (!name || name.includes('*') || /[^\x00-\x7f]/.test(name)) { out.unsupported = true; return out; }
        (dneg ? out.excludedDomains : out.domains).push(name);
      }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TYPE_MAP, key)) {
      const t = TYPE_MAP[key];
      if (t === 'document') { out.hasDocument = !neg; if (neg) { out.unsupported = true; return out; } continue; }
      (neg ? out.negTypes : out.types).push(t);
      continue;
    }
    // unknown or explicitly unsupported -> skip the whole filter
    out.unsupported = true;
    if (!UNSUPPORTED.has(key)) out.unknownKey = key;
    return out;
  }
  return out;
}

function convertLine(line, stats) {
  let s = line.trim();
  if (!s || s[0] === '!' || s[0] === '[') { stats.comment++; return null; }
  // cosmetic / scriptlet / html filters live in the cosmetic engine, not DNR
  if (/#[#@?$%]#?/.test(s)) { stats.cosmetic++; return null; }

  const exception = s.startsWith('@@');
  if (exception) s = s.slice(2);

  // split off the options suffix (last '$' whose remainder looks like options)
  let pattern = s;
  let opts = null;
  const di = s.lastIndexOf('$');
  if (di > 0 && di < s.length - 1) {
    const tail = s.slice(di + 1);
    if (/^~?[a-z][a-z0-9-]*(=[^$]*)?(,~?[a-z][a-z0-9-]*(=[^$]*)?)*$/i.test(tail)) {
      pattern = s.slice(0, di);
      opts = parseOptions(tail);
      if (opts.unsupported) { stats.unsupportedOption++; return null; }
    }
  }

  // regex filters: DNR regexFilter has a tiny budget (and easylist regexes lean
  // on PCRE features RE2 lacks) -- skip
  if (pattern.length > 2 && pattern[0] === '/' && pattern[pattern.length - 1] === '/') { stats.regex++; return null; }
  if (/[^\x00-\x7f]/.test(pattern)) { stats.nonAscii++; return null; }

  // '|' is only meaningful at the ends in DNR urlFilter
  const inner = pattern.slice(pattern.startsWith('||') ? 2 : pattern.startsWith('|') ? 1 : 0, pattern.endsWith('|') ? -1 : undefined);
  if (inner.includes('|')) { stats.midPipe++; return null; }

  // too-generic guard: require >= 3 anchoring chars once wildcards/anchors gone
  const core = pattern.replace(/^\|{1,2}/, '').replace(/\|$/, '').replace(/[*^]/g, '');
  if (core.length < 3) { stats.tooGeneric++; return null; }

  const condition = { urlFilter: pattern };
  if (opts && opts.matchCase) condition.isUrlFilterCaseSensitive = true;
  if (opts && opts.domainType) condition.domainType = opts.domainType;
  if (opts && opts.domains.length) condition.initiatorDomains = opts.domains;
  if (opts && opts.excludedDomains.length) condition.excludedInitiatorDomains = opts.excludedDomains;

  const types = opts ? [...new Set(opts.types)] : [];
  const negTypes = opts ? [...new Set(opts.negTypes)] : [];
  if (types.length && negTypes.length) { stats.mixedTypeNegation++; return null; }

  if (exception && opts && opts.hasDocument) {
    // @@||site.com^$document -- whole-site whitelist
    const rt = ['main_frame'];
    if (types.includes('sub_frame')) rt.push('sub_frame');
    return { action: { type: 'allowAllRequests' }, condition: Object.assign({}, condition, { resourceTypes: rt }), priority: 2, kind: 'allowAll' };
  }
  if (!exception && opts && opts.hasDocument) { stats.blockDocument++; return null; }

  if (types.length) condition.resourceTypes = types;
  // EasyList type negation never includes page loads; DNR's excludedResourceTypes
  // matches EVERYTHING not listed (main_frame included) -- exclude it explicitly
  else if (negTypes.length) condition.excludedResourceTypes = [...new Set(negTypes.concat('main_frame'))];

  return {
    action: { type: exception ? 'allow' : 'block' },
    condition: condition,
    priority: exception ? 2 : 1,
    kind: exception ? 'allow' : 'block',
  };
}

function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error('usage: node build-adshield-dnr.js <easylist.txt> <rules-adshield.json>'); process.exit(2); }
  const text = fs.readFileSync(inPath, 'utf8');
  const stats = {
    comment: 0, cosmetic: 0, unsupportedOption: 0, regex: 0, nonAscii: 0,
    midPipe: 0, tooGeneric: 0, mixedTypeNegation: 0, blockDocument: 0, duplicate: 0,
  };
  const blocks = [];
  const allows = PINNED_ALLOW_RULES.slice();
  const seen = new Set(allows.map((rule) => JSON.stringify([rule.action.type, rule.condition])));
  for (const line of text.split(/\r?\n/)) {
    const rule = convertLine(line, stats);
    if (!rule) continue;
    const sig = JSON.stringify([rule.action.type, rule.condition]);
    if (seen.has(sig)) { stats.duplicate++; continue; }
    seen.add(sig);
    (rule.kind === 'block' ? blocks : allows).push(rule);
  }

  // exceptions ALWAYS ship (they prevent site breakage); blocks fill what's left.
  // Within blocks, PATH/pattern rules ship before pure-host rules: a bare
  // ||adhost^ overlaps the dynamic ad-server host lists, but a path pattern
  // (first-party-served ads) is something only this static ruleset can express.
  const isPureHost = (r) => /^\|\|[0-9a-z.-]+\^?$/.test(r.condition.urlFilter)
    && !r.condition.resourceTypes && !r.condition.excludedResourceTypes
    && !r.condition.initiatorDomains && !r.condition.excludedInitiatorDomains;
  const pathBlocks = blocks.filter((r) => !isPureHost(r));
  const hostBlocks = blocks.filter(isPureHost);
  const orderedBlocks = pathBlocks.concat(hostBlocks);
  const budgetForBlocks = MAX_RULES - allows.length;
  const trimmedBlocks = orderedBlocks.slice(0, Math.max(0, budgetForBlocks));
  const rules = allows.concat(trimmedBlocks).map((r, i) => ({
    id: i + 1,
    priority: r.priority,
    action: r.action,
    condition: r.condition,
  }));

  fs.writeFileSync(outPath, JSON.stringify(rules));
  const skipped = Object.entries(stats).map(([k, v]) => k + '=' + v).join(' ');
  console.log('rules: ' + rules.length + ' (allow/allowAll=' + allows.length + ', block=' + trimmedBlocks.length + (blocks.length > trimmedBlocks.length ? ', dropped=' + (blocks.length - trimmedBlocks.length) : '') + ')');
  console.log('skipped: ' + skipped);
}

main();

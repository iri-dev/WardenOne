/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * "Never let this domain open."
 *
 * Everything else in WardenOne decides for the reader. This is the one list where the
 * reader decides, which puts three obligations on it:
 *
 * 1. IT MUST NOT REINTERPRET WHAT WAS TYPED. A blocklist that quietly widens
 *    example.com/tracker into all of example.com, or narrows it the other way, is
 *    worse than one that refuses the entry. Where it cannot parse something it says
 *    so and blocks nothing.
 * 2. NOTHING OVERRULES IT BUT THE READER. The compatibility allowances exist to stop
 *    WardenOne breaking a site; they were never meant to overrule a decision. If you
 *    block YouTube, YouTube stops loading.
 * 3. IT MUST BLOCK ON EVERY TRANSPORT. Blocking a site on seven of fifteen resource
 *    types is not blocking it -- WebTransport alone is a full channel to the host.
 *
 * The parser and rule builder are lifted out of background.js and run for real.
 *
 * Run: node tools/test-user-blocklist.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'history.html'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- the real parser, executed ------------------------------------------- */
const start = BG.indexOf('function parseBlockPattern(raw)');
const end = BG.indexOf('function userBlockRulesFrom(entries)');
check('the parser is where the slice expects it', start > 0 && end > start);
const ruleEnd = BG.indexOf('async function readUserBlocklist()');
const box = {
  String, Number, URL, RegExp, Boolean, Array, Object, Date, Math, console,
  ALL_DNR_RESOURCE_TYPES: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
    'webbundle', 'other'],
  USER_BLOCKLIST_RULE_BASE: 970000,
  USER_BLOCKLIST_RULES_BUDGET: 64,
  USER_BLOCKLIST_DOMAINS_PER_RULE: 100,
};
vm.createContext(box);
vm.runInContext(BG.slice(start, ruleEnd)
  + ';globalThis.parse = parseBlockPattern; globalThis.build = userBlockRulesFrom;',
box, { filename: 'background.js:blocklist' });
const parse = box.parse;
const build = box.build;

/* ---- exactly the shapes the reader was promised -------------------------- */
{
  const d = parse('example.com');
  check('a bare site is accepted', d.ok && d.kind === 'domain' && d.value === 'example.com');
}
{
  const d = parse('*.example.com');
  check('the *. form means the same thing', d.ok && d.kind === 'domain' && d.value === 'example.com',
    'people write it both ways and mean the same site');
}
{
  const d = parse('192.0.2.55');
  check('an address is accepted', d.ok && d.kind === 'ip' && d.value === '192.0.2.55',
    'the old right-click block refused every IP outright');
}
{
  const d = parse('https://example.com/specific-path/*');
  check('a link with a path is accepted', d.ok && d.kind === 'url');
  check('and keeps its path', d.ok && d.value.indexOf('/specific-path/') > 0);
  check('and the trailing star is not matched literally', d.ok && !/\*/.test(d.value),
    'a trailing * is how people write "everything under here", which a prefix already means');
}
{
  const d = parse('news.example.com');
  check('a subdomain stays a subdomain', d.ok && d.value === 'news.example.com',
    'collapsing it to example.com would block far more than was asked for');
}
{
  const d = parse('example.com/path');
  check('a path without a scheme still parses as a path', d.ok && d.kind === 'url');
}

/* ---- refusals, with a reason --------------------------------------------- */
for (const [name, input] of [
  ['nothing', ''],
  ['spaces', 'example.com evil.com'],
  ['a bare word', 'example'],
  ['a browser page', 'chrome://settings'],
  ['an extension page', 'chrome-extension://abc/page.html'],
  ['a javascript url', 'javascript:alert(1)'],
  ['a file path', 'file:///C:/secret.txt'],
]) {
  const r = parse(input);
  check('refused: ' + name, !r.ok, 'got ' + JSON.stringify(r.value || ''));
  check('and says why: ' + name, !r.ok && !!r.error);
}

/* ---- the rules that come out --------------------------------------------- */
{
  const rules = build([parse('example.com'), parse('192.0.2.55'), parse('https://example.com/x/*')]
    .map((p) => Object.assign({}, p)));
  check('one rule per entry', rules.length === 3);
  check('every rule blocks', rules.every((r) => r.action.type === 'block'));
  /* The reader outranks the compatibility allowances at 95000-96000, and stays below
     their own allowlist at 100000. */
  check('and outranks the compatibility allowances', rules.every((r) => r.priority === 99000),
    'at 2000 a block on YouTube saved, reported success, and then loaded anyway');
  const types = rules[0].condition.resourceTypes;
  check('a block covers every transport', types.length === box.ALL_DNR_RESOURCE_TYPES.length,
    'blocking a site on seven of fifteen types is not blocking it');
  for (const t of ['webtransport', 'media', 'font', 'object', 'stylesheet']) {
    check('including ' + t, types.includes(t));
  }
  /* Looked up rather than indexed. Indexing crashed the whole suite the moment a
     mutation changed how many rules come out -- a test that dies cannot report which
     assertions failed, and a crash reads as "broken mutation" rather than a catch. */
  const byDomain = rules.filter((r) => r.condition.requestDomains);
  const byUrl = rules.filter((r) => typeof r.condition.urlFilter === 'string');
  check('a whole-site entry matches by domain', byDomain.length === 1);
  check('an address and a path each match by url', byUrl.length === 2,
    'got ' + byUrl.length);
  check('every url match is anchored at the start',
    byUrl.length === 2 && byUrl.every((r) => /^\|/.test(r.condition.urlFilter)),
    'unanchored, the same text in a query string elsewhere would match');
}
{
  /* Whole sites BATCH. A rule per entry pushed the shared dynamic-rule total 209 over
     Chrome's 30,000 ceiling, at which point the update is rejected and NOTHING applies
     -- not just this list. The budget test is what caught it. */
  const many = [];
  for (let i = 0; i < 500; i++) many.push(parse('site' + i + '.example'));
  const rules = build(many);
  check('500 whole sites batch into a handful of rules', rules.length === 5,
    'got ' + rules.length + '; one rule per entry blows the shared ceiling');
  const covered = rules.reduce((n, r) => n + (r.condition.requestDomains || []).length, 0);
  check('and no site is lost in the batching', covered === 500, 'covered ' + covered);
  check('the list cannot exceed its rule budget', rules.length <= 64);
  const ids = new Set(rules.map((r) => r.id));
  check('and every rule id is unique', ids.size === rules.length);
}
{
  /* Paths and addresses cannot batch -- each needs its own urlFilter -- so the real
     limit is rules, not entries. An add that would not fit is refused up front. */
  const costStart = BG.indexOf('function userBlockRuleCost(entries)');
  check('the cost function exists', costStart > 0);
  const cbox = { Math, Array, Object, Number };
  vm.createContext(cbox);
  vm.runInContext(BG.slice(costStart, BG.indexOf('async function readUserBlocklist()'))
    + ';globalThis.cost = userBlockRuleCost;'
    + 'globalThis.USER_BLOCKLIST_DOMAINS_PER_RULE = 100;', cbox);
  const domains = [];
  for (let i = 0; i < 250; i++) domains.push({ kind: 'domain', value: 'd' + i + '.example' });
  check('250 sites cost three rules', cbox.cost(domains) === 3, 'got ' + cbox.cost(domains));
  const paths = [];
  for (let i = 0; i < 10; i++) paths.push({ kind: 'url', value: 'example.com/p' + i });
  check('ten paths cost ten rules', cbox.cost(paths) === 10, 'got ' + cbox.cost(paths));
  check('and the two add up', cbox.cost(domains.concat(paths)) === 13);
  check('the add path refuses what would not fit',
    /userBlockRuleCost\(live\.concat\(\[entry\]\)\) > USER_BLOCKLIST_RULES_BUDGET/.test(BG),
    'saving an entry that is never turned into a rule is the "Blocked." that does not block');
}

/* ---- expiry -------------------------------------------------------------- */
{
  const pruneStart = BG.indexOf('function pruneExpiredBlocks(entries, now)');
  const pruneEnd = BG.indexOf('async function applyUserBlocklistRules()');
  check('the prune is where the slice expects it', pruneStart > 0 && pruneEnd > pruneStart);
  const pbox = { Number, Date, Array, Object };
  vm.createContext(pbox);
  vm.runInContext(BG.slice(pruneStart, pruneEnd) + ';globalThis.prune = pruneExpiredBlocks;', pbox);
  const now = 1000000;
  const r = pbox.prune([
    { id: 'a', until: 0 },
    { id: 'b', until: now - 1 },
    { id: 'c', until: now + 1 },
  ], now);
  check('a permanent entry never lapses', r.live.some((e) => e.id === 'a'));
  check('a lapsed entry is dropped', !r.live.some((e) => e.id === 'b'));
  check('a live timed entry stays', r.live.some((e) => e.id === 'c'));
}

/* ---- it is the reader's, so a page must not be able to write to it -------- */
for (const kind of ['blocklist-add', 'blocklist-remove', 'blocklist-clear', 'blocklist-get']) {
  check(kind + ' is handled', BG.includes("msg.kind === '" + kind + "'"));
  check(kind + ' is not reachable from a web page',
    !new RegExp("TAB_CONTEXT_ALLOWED_MESSAGES = new Set\\(\\[[^\\]]*'" + kind + "'").test(BG),
    'a page that could add entries could block someone out of their own bank');
}

/* ---- session blocks end when the session does ---------------------------- */
check('session entries live in storage.session',
  /USER_BLOCKLIST_SESSION_KEY/.test(BG) && /chrome\.storage\.session/.test(BG),
  'a plain in-memory list would be lost when the worker is evicted mid-session');
check('and the rules are rebuilt at startup',
  /^applyUserBlocklistRules\(\);/m.test(BG),
  'dynamic rules persist across restarts, so a session block would outlive its session');
check('the applier is serialized like every other',
  /'applyUserBlocklistRules'/.test(BG),
  'two concurrent rebuilds both read the old rule set and the loser silently wins');
check('until-tomorrow means tomorrow, not 24 hours',
  /setHours\(24, 0, 0, 0\)/.test(BG),
  'blocking something at 11pm to get to sleep does not mean until 11pm tomorrow');

/* ---- what the page says --------------------------------------------------- */
check('the panel offers all three durations',
  /value="forever"/.test(HTML) && /value="tomorrow"/.test(HTML) && /value="session"/.test(HTML));
check('the input exists and is labelled',
  /id="block-input"/.test(HTML) && /aria-label="Site, address or link to block"/.test(HTML));
check('the page says a site name covers its subdomains',
  /already blocks/.test(HTML),
  'otherwise nobody can tell whether example.com got news.example.com too');
check('the page warns that this overrides compatibility exceptions',
  /overrides WardenOne/i.test(HTML),
  'blocking YouTube really does stop YouTube loading, and that should not be a surprise');
check('a failed add keeps what was typed',
  /if \(!res \|\| !res\.ok\) \{ say\(/.test(HISTORY),
  'wiping the field and then saying it was wrong leaves nothing to correct');
check('Forget all clears the reader\'s list too',
  /blocklist-clear/.test(HISTORY),
  'the confirm text promises "including the ones you blocked yourself"');

if (failed) {
  console.error('user blocklist: ' + failed + ' failed');
  process.exit(1);
}
console.log('user blocklist: all checks passed');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The per-site firewall — dynamic filtering, not another blocklist.
 *
 * This is the only tool in WardenOne that can stop a site working outright, on
 * purpose, because the reader asked it to. So the suite is not about whether the
 * rules are permissive enough; it is about three things:
 *
 * 1. A RULE MUST MEAN WHAT THE CELL SAID. The matrix is the reader's mental
 *    model. If "block script on doubleclick.net at bbc.co.uk" generates a rule
 *    that also touches another site or another type, the model is a lie.
 * 2. THE RULES MUST STAY IN THEIR OWN ID RANGE. A rebuild of this matrix that
 *    stepped on another subsystem's ids would break protections nobody touched.
 * 3. UNDO MUST BE REAL AND REACHABLE. A tool this destructive earns its place
 *    only if walking it back is one click, per site and globally.
 *
 * The rule generator is lifted out of background.js and run for real, because a
 * regex over the source cannot tell you whether the emitted condition is right.
 *
 * Run: node tools/test-firewall.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const HTML_RAW = fs.readFileSync('firewall.html', 'utf8');
const HTML = HTML_RAW.replace(/\s+/g, ' ');
const JS = fs.readFileSync('firewall.js', 'utf8');
const POPUP = fs.readFileSync('popup.html', 'utf8');
const POPUP_JS = fs.readFileSync('popup.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- lift the rule generator and run it --------------------------------- */
const region = BG.slice(BG.indexOf('const FIREWALL_RULE_BASE'), BG.indexOf('async function applyFirewallRules'));
check('the firewall engine is where the slice expects it', region.length > 0);
const box = { String, Number, Object, Array, RegExp, console };
/* The budget bands are declared up with the other bands rather than beside the
   feature, because TOTAL_DYNAMIC_BUDGET is evaluated before this point in the
   file. Read them from source so the slice can still be run on its own. */
for (const band of ['FIREWALL_RULES_BUDGET', 'FIREWALL_SESSION_RULES_BUDGET']) {
  const m = BG.match(new RegExp('const ' + band + ' = (\\d+)'));
  check(band + ' is declared', !!m);
  box[band] = m ? Number(m[1]) : 0;
}
vm.createContext(box);
vm.runInContext(region
  + ';globalThis.api = { firewallRulesFrom, firewallNormalizeHost, FIREWALL_COLUMNS,'
  + ' FIREWALL_RULE_BASE, FIREWALL_RULE_MAX, FIREWALL_PRIORITY };',
box, { filename: 'background.js:firewall' });
const api = box.api;

/* ---- a rule means exactly what the cell said ---------------------------- */
const rules = api.firewallRulesFrom({
  'bbc.co.uk': {
    'doubleclick.net': { script: 'block', xhr: 'block' },
    'bbci.co.uk': { all: 'allow' },
    'analytics.example': { cookie: 'strip' },
  },
});
check('one rule per decision', rules.length === 4, rules.length + ' rules');

const blockScript = rules.find((r) => r.condition.requestDomains[0] === 'doubleclick.net'
  && r.condition.resourceTypes.includes('script'));
check('a block cell becomes a block rule', !!blockScript && blockScript.action.type === 'block');
check('scoped to the one site it was set on',
  !!blockScript && blockScript.condition.initiatorDomains.length === 1
    && blockScript.condition.initiatorDomains[0] === 'bbc.co.uk',
  'a rule that leaked to other sites would make the matrix a lie');
check('scoped to the one domain the cell was on',
  !!blockScript && blockScript.condition.requestDomains.length === 1);
check('the script column covers only script',
  !!blockScript && blockScript.condition.resourceTypes.length === 1,
  JSON.stringify(blockScript && blockScript.condition.resourceTypes));

const allowAll = rules.find((r) => r.condition.requestDomains[0] === 'bbci.co.uk');
check('an allow cell becomes an allow rule', !!allowAll && allowAll.action.type === 'allow');
check('"all" really does cover stylesheets and the rest',
  !!allowAll && allowAll.condition.resourceTypes.includes('stylesheet')
    && allowAll.condition.resourceTypes.includes('ping')
    && allowAll.condition.resourceTypes.includes('other'),
  'the page tells the reader that All is the one that covers everything else');

const cookie = rules.find((r) => r.condition.requestDomains[0] === 'analytics.example');
check('the cookie column strips rather than blocks',
  !!cookie && cookie.action.type === 'modifyHeaders'
    && cookie.action.requestHeaders[0].header === 'cookie'
    && cookie.action.requestHeaders[0].operation === 'remove',
  'the useful middle setting: the domain still works and still cannot recognise you');
check('stripping a cookie does not also block the request',
  !!cookie && cookie.action.type !== 'block');

/* ---- the id range ------------------------------------------------------- */
check('every rule sits in the firewall id range',
  rules.every((r) => r.id >= api.FIREWALL_RULE_BASE && r.id < api.FIREWALL_RULE_BASE + api.FIREWALL_RULE_MAX));
check('ids are unique', new Set(rules.map((r) => r.id)).size === rules.length);
/* The ranges other subsystems own. Overlapping one would delete protections
   nobody touched when this matrix is rebuilt. */
const otherBases = [...BG.matchAll(/const ([A-Z_]+RULE_BASE) = (\d+)/g)]
  .filter((m) => !m[1].startsWith('FIREWALL'))
  .map((m) => ({ name: m[1], base: Number(m[2]) }));
check('the firewall range collides with nothing else',
  otherBases.every((o) => o.base < api.FIREWALL_RULE_BASE
    || o.base >= api.FIREWALL_RULE_BASE + api.FIREWALL_RULE_MAX),
  otherBases.filter((o) => o.base >= api.FIREWALL_RULE_BASE
    && o.base < api.FIREWALL_RULE_BASE + api.FIREWALL_RULE_MAX).map((o) => o.name).join(', '));
check('the rebuild only ever removes its own ids',
  /r\.id >= FIREWALL_RULE_BASE && r\.id < FIREWALL_RULE_BASE \+ FIREWALL_RULE_MAX/.test(BG),
  'a rebuild that removed anything else would take other protections with it');
check('the rule count is bounded',
  api.firewallRulesFrom({ 'a.example': Object.fromEntries(
    Array.from({ length: 900 }, (_, i) => ['d' + i + '.example', { all: 'block', script: 'block', xhr: 'block' }]),
  ) }).length <= api.FIREWALL_RULE_MAX,
  'the dynamic rule budget is shared with every other feature');

/* ---- the decisions beat the lists --------------------------------------- */
const priorities = [...BG.matchAll(/priority: (\d+)/g)].map((m) => Number(m[1]));
check('a firewall allow outranks every blocklist rule',
  priorities.filter((p) => p > api.FIREWALL_PRIORITY).length <= 2,
  'only the very top safety allows may sit above an explicit per-site decision');
check('the priority is a named constant, not a literal',
  /priority: FIREWALL_PRIORITY/.test(BG));

/* ---- input that should never become a rule ------------------------------ */
for (const bad of ['', '   ', 'localhost', 'not a host', '../etc', 'a'.repeat(300), 'exam ple.com', 'HTTP://x.com']) {
  check('refused as a host: ' + JSON.stringify(bad.slice(0, 20)), api.firewallNormalizeHost(bad) === '');
}
check('a host is normalised the same way everywhere',
  api.firewallNormalizeHost('WWW.Example.COM') === 'example.com',
  'the matrix and the rule have to agree on what the row is');
check('a junk site produces no rules',
  api.firewallRulesFrom({ 'not a host': { 'x.example': { script: 'block' } } }).length === 0);
check('a junk domain produces no rules',
  api.firewallRulesFrom({ 'example.com': { 'not a host': { script: 'block' } } }).length === 0);
check('an unknown column produces no rule',
  api.firewallRulesFrom({ 'example.com': { 'x.example': { nonsense: 'block' } } }).length === 0);
check('an unknown verdict produces no rule',
  api.firewallRulesFrom({ 'example.com': { 'x.example': { script: 'maybe' } } }).length === 0);
check('cookie only accepts strip',
  api.firewallRulesFrom({ 'example.com': { 'x.example': { cookie: 'block' } } }).length === 0,
  'the cookie column has no block state; treating one as a block would silently do something else');

/* ---- allow-once is temporary by construction ---------------------------- */
/* Sliced to the function. The [\s\S]{0,900} version reached past its closing
   brace into firewallClearSession, which also says updateSessionRules -- so it
   passed with allow-once switched to permanent dynamic rules. */
const allowOnceFn = BG.slice(BG.indexOf('async function firewallAllowOnce'),
  BG.indexOf('async function firewallClearSession'));
check('the allow-once body is where the slice expects it', allowOnceFn.length > 0);
check('allow once uses session rules, not stored ones',
  /updateSessionRules/.test(allowOnceFn) && !/updateDynamicRules/.test(allowOnceFn),
  'a session rule dies with the browser; a dynamic one is permanent configuration');
check('and says why in the source',
  /dies with the browser|session rules so it dies/.test(BG),
  'an experiment that outlives the session becomes configuration nobody remembers making');
check('session rules have their own id range',
  /const FIREWALL_SESSION_RULE_BASE = \d+/.test(BG)
    && !new RegExp('FIREWALL_SESSION_RULE_BASE = ' + api.FIREWALL_RULE_BASE + '\\b').test(BG));

/* ---- undo ---------------------------------------------------------------- */
check('there is a per-site undo', /id="reset-site"/.test(HTML_RAW) && /kind: 'firewall-reset'/.test(JS));
check('there is a remove-everything undo', /id="reset-all"/.test(HTML_RAW) && /all: all === true/.test(JS));
check('resetting also drops the session rules',
  /await firewallClearSession\(\);[\s\S]{0,120}applyFirewallRules\(\)/.test(BG),
  'otherwise an allow-once survives the undo that was supposed to clear everything');
check('undo is on the page, not behind a menu',
  HTML.indexOf('Undo my rules here') > 0 && HTML.indexOf('Remove every firewall rule') > 0);
check('the page says plainly that it can break a site',
  /This is the tool that can break a site/.test(HTML)
    && /nothing here tries to stop you doing that/.test(HTML));

/* ---- the rows are observed, not invented -------------------------------- */
check('the matrix is fed by the real capture',
  /chrome\.runtime\.connect\(\{ name: 'wardenone-logger' \}\)/.test(JS),
  'a row should exist because a request happened, not because a list mentions the domain');
check('it only shows the tab it was opened for',
  /if \(Number\.isFinite\(TAB_ID\) && e\.tabId !== TAB_ID\) continue;/.test(JS));
check('the popup hands it the tab and host',
  /id="open-firewall"/.test(POPUP) && /firewall\.html/.test(POPUP_JS)
    && /\?tab=/.test(POPUP_JS) && /&site=/.test(POPUP_JS));
check('a cell shows what already happened when the reader has not decided',
  /· blocked/.test(JS) && /· loaded/.test(JS));
check('and names the list that blocked it',
  /blocked by/.test(JS) && /e\.source/.test(JS),
  'the reader is overriding something specific, not filling in a blank grid');
check('the site own domain is not sorted to the top',
  /First-party last/.test(JS),
  'the row people mis-click is the one that breaks the site');

/* ---- a domain you have not seen yet ---- */
/* The matrix only knows what it captured, so a domain that loads later, or only
   on another page of the site, had no way in at all. */
check('a domain can be added by hand',
  /id="add-domain"/.test(HTML_RAW) && /function addTyped()/.test(JS) && /const MANUAL = new Set()/.test(JS));
check('a typed URL is reduced to its host',
  JS.includes("host.includes('://')") && JS.includes('new URL(host).hostname'),
  'people paste URLs; the row has to be the host');
check('junk is refused rather than added',
  /That does not look like a domain/.test(JS));
check('adding is not itself a rule',
  /no rules until you click a cell/.test(JS),
  'a row appearing must not change what the site loads');
check('an added row says it was not observed', /added by you/.test(JS));
check('added rows appear in the matrix', /...MANUAL/.test(JS));
/* ---- reachable, and only from Advanced ---------------------------------- */
check('it lives behind the advanced dropdown',
  POPUP.indexOf('id="open-firewall"') > POPUP.indexOf('id="my-filters-drop"'));
check('the page declares its theme scope', /data-wardenone-page="firewall"/.test(HTML_RAW));
const shell = fs.readFileSync('guide-shell.css', 'utf8');
for (const suffix of ['*', 'body']) {
  check('the shell gives it the ' + (suffix === '*' ? 'border-box' : 'body') + ' reset',
    shell.includes(':root[data-wardenone-page="firewall"] ' + suffix));
}

/* ---- privileged ---------------------------------------------------------- */
for (const kind of ['firewall-get', 'firewall-set', 'firewall-allow-once', 'firewall-reset']) {
  check(kind + ' is handled', BG.includes("msg.kind === '" + kind + "'"));
  check(kind + ' is not reachable from a web page',
    !new RegExp("TAB_CONTEXT_ALLOWED_MESSAGES = new Set\\(\\[[^\\]]*'" + kind + "'").test(BG),
    'a page that could write firewall rules would control what every site may load');
}
check('the applier is serialized with the others',
  /'applyFirewallRules',/.test(BG),
  'an unlisted applier can settle out of order and leave the rules disagreeing with the matrix');

if (failed) {
  console.error('site firewall: ' + failed + ' failed');
  process.exit(1);
}
console.log('site firewall: all checks passed');

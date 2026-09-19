/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * A rule past the cap is named, never counted as something else.
 * Run: node tools/test-rule-cap-honesty.js
 *
 * Two compilers share one bug shape (M46). The user-filter parser kept counting network
 * lines past its 500-rule band while skipping them, and the UI derived "hiding rules" as
 * total minus network -- so 550 blocking lines read as 500 blocking and 50 hiding, and the
 * fifty that did nothing were reported as doing something else. The firewall compiler
 * returned at 250 rules from the middle of a loop, so a decision past that was stored,
 * drawn as a decision of yours, and never a rule; which ones ran depended on the order the
 * matrix had been written in.
 *
 * Both now say what they left out, by line or by cell. The parser reports `cosmetic` and
 * `overflow` as their own numbers; the band is shared out own-text-first then list by list
 * in stored order, and that allocation is what each list row shows. The firewall compile
 * returns `omitted`, a decision that would not fit is refused at the write, and a stored
 * cell without a rule is drawn as not in effect. This suite runs the real code at exactly
 * the cap, one past it, across several lists, and again from the same stored text as a
 * restart would, and reads the UI copy for the words that must not be said.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const FW_JS = fs.readFileSync(path.join(ROOT, 'firewall.js'), 'utf8');
const FW_HTML = fs.readFileSync(path.join(ROOT, 'firewall.html'), 'utf8');
const NL = '\n';

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function region(start, end) {
  const a = BG.indexOf(start);
  const b = BG.indexOf(end, a);
  if (a < 0 || b <= a) throw new Error('region not found: ' + start);
  return BG.slice(a, b);
}
function grabFn(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(BG);
  if (!m) throw new Error('missing ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < BG.length; i++) {
    if (BG[i] === '{') { depth++; seen = true; } else if (BG[i] === '}') {
      depth--;
      if (seen && depth === 0) return BG.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}
/* A function the fix introduced: absent on the pre-fix source, where the control run should
   show the old behaviour failing rather than the lift crashing. */
function grabFnOr(name, fallback) {
  return new RegExp('^(?:async )?function ' + name + '\\(', 'm').test(BG) ? grabFn(name) : fallback;
}

/* ---- the user-filter parser and allocation ------------------------------------------ */
const MAX = Number((BG.match(/const USER_RULES_BUDGET = (\d+)/) || [])[1] || 0);
check('the user-rule band is declared', MAX > 0);
const box = {
  String, Object, Number, Array, RegExp, Math, console, URL,
  normalizeIpLiteral: (h) => h,
  isLocalOrPrivateHost: () => false,
  USER_RULES_BUDGET: MAX,
};
vm.createContext(box);
vm.runInContext(
  region('const USER_RULE_BASE = 750000;', 'const USER_RULES_KEY =')
  + NL + region('function normalizeAllowlistHost(value) {', 'function normalizeAllowlistHosts(')
  + NL + grabFn('customListTransportOk')
  + NL + region('function parseUserFilterLine(raw) {', 'function parseUserFilterText(')
  + NL + grabFn('parseUserFilterText') + NL + grabFnOr('userFilterAllocation', 'function userFilterAllocation() { return { own: {}, lists: new Proxy({}, { get: () => ({}) }) }; }') + NL + grabFnOr('customListRowsFor', 'function customListRowsFor() { return []; }')
  + ';globalThis.api = { parse: parseUserFilterText, allocation: userFilterAllocation, rows: customListRowsFor, BASE: USER_RULE_BASE, MAX: USER_RULE_MAX };',
  box, { filename: 'background.js:user-filters' });
const api = box.api;
const hosts = (n, prefix) => Array.from({ length: n }, (_, i) => '||' + (prefix || 'h') + i + '.example^').join(NL);

{
  const out = api.parse(hosts(MAX), api.BASE);
  check('exactly the cap: every line is a rule and nothing overflows',
    out.network.length === MAX && out.overflow === 0 && (out.overflowLines || []).length === 0 && out.count === MAX && out.cosmetic === 0);
}
{
  const out = api.parse(hosts(MAX + 1), api.BASE);
  check('one past the cap: the extra line is overflow, named by its line', out.network.length === MAX && out.overflow === 1
    && (out.overflowLines || []).length === 1 && out.overflowLines[0].line === MAX + 1 && /h500\.example/.test(out.overflowLines[0].text), JSON.stringify(out.overflowLines));
  check('count is what is in use, not what was written', out.count === MAX);
  check('no overflow is counted as cosmetic', out.cosmetic === 0 && out.count - out.network.length === 0);
}
{
  const text = hosts(MAX + 50) + NL + 'example.com##.ad' + NL + '##.banner';
  const out = api.parse(text, api.BASE);
  check('550 blocking lines and two hiding rules: 500 blocking in use, 2 hiding, 50 overflow -- never 52 hiding',
    out.network.length === MAX && out.cosmetic === 2 && out.overflow === 50 && out.count === MAX + 2, JSON.stringify({ n: out.network.length, c: out.cosmetic, o: out.overflow, count: out.count }));
  const big = api.parse(hosts(MAX + 300), api.BASE);
  check('overflow identities are capped at a hundred but the count is not', (big.overflowLines || []).length === 100 && big.overflow === 300);
}

/* The band shared out: own text first, then lists in stored order. */
{
  const own = hosts(100, 'own');
  const lists = [
    { id: 'a', enabled: true, url: 'https://a.example/list.txt', text: hosts(300, 'a') },
    { id: 'b', enabled: true, url: 'https://b.example/list.txt', text: hosts(300, 'b') + NL + 'b.example##.x' },
    { id: 'c', enabled: false, url: 'https://c.example/list.txt', text: hosts(50, 'c') },
    { id: 'd', enabled: true, url: 'http://d.example/list.txt', text: hosts(50, 'd') },
  ];
  const alloc = api.allocation(own, lists);
  check('own rules are served first and in full', alloc.own.applied === 100 && alloc.own.overflow === 0);
  check('the first list gets the next share in full', alloc.lists.a.applied === 300 && alloc.lists.a.overflow === 0);
  check('the second list gets what is left, and its overflow is named', alloc.lists.b.applied === 100 && alloc.lists.b.overflow === 200 && alloc.lists.b.cosmetic === 1, JSON.stringify(alloc.lists.b));
  check('a list that is off, or on http, takes nothing from the band', alloc.lists.c.applied === 0 && alloc.lists.c.off === true && alloc.lists.d.applied === 0 && alloc.lists.d.off === true);
  check('the band is exactly spent', alloc.used === MAX && alloc.limit === MAX);
  const rows = api.rows(lists, own);
  check('the rows the popup gets carry the share and no text',
    rows.length === 4 && rows.every((r) => r.text === undefined) && rows[1].applied === 100 && rows[1].overflow === 200 && rows[0].applied === 300);
  /* A restart rebuilds from the same stored text in the same stored order. */
  const again = api.allocation(String(own), lists.map((l) => Object.assign({}, l)));
  check('the same stored text admits the same set after a restart', JSON.stringify(again) === JSON.stringify(alloc));
  /* Adding a hand-written rule displaces the LAST list, never an earlier source. */
  const more = api.allocation(own + NL + '||own-new.example^', lists);
  check('a new hand-written rule displaces the last list, not itself and not an earlier list',
    more.own.applied === 101 && more.lists.a.applied === 300 && more.lists.b.applied === 99);
}

/* The bundle the applier gets is the same admitted set: the combined text, own first. */
check('the bundle is built own-text-first, then each enabled list in stored order',
  /let text = String\(own \|\| ''\);\s*for \(const l of \(lists \|\| \[\]\)\) \{[\s\S]{0,300}text \+= '\\n' \+ l\.text;/.test(BG));

/* ---- the firewall compile ------------------------------------------------------------ */
const fw = { String, Number, Object, Array, RegExp, console, JSON };
for (const band of ['FIREWALL_RULES_BUDGET', 'FIREWALL_SESSION_RULES_BUDGET']) {
  fw[band] = Number((BG.match(new RegExp('const ' + band + ' = (\\d+)')) || [])[1] || 0);
}
vm.createContext(fw);
vm.runInContext(BG.slice(BG.indexOf('const FIREWALL_RULE_BASE'), BG.indexOf('async function applyFirewallRules')) + NL + grabFn('firewallMatrixWith') + NL + 'const JSON = globalThis.JSON;'
  + NL + grabFnOr('firewallCompile', 'function firewallCompile(m) { return { rules: firewallRulesFrom(m), omitted: [], limit: FIREWALL_RULE_MAX }; }') + NL + grabFnOr('firewallRefusalFor', "function firewallRefusalFor() { return ''; }") + NL + grabFnOr('firewallOmittedFor', 'function firewallOmittedFor() { return []; }')
  + ';globalThis.api = { compile: firewallCompile, rulesFrom: firewallRulesFrom, refusal: firewallRefusalFor, omittedFor: firewallOmittedFor, matrixWith: firewallMatrixWith, MAX: FIREWALL_RULE_MAX };',
  fw, { filename: 'background.js:firewall' });
const F = fw.api;
const FMAX = F.MAX;
check('the firewall band is declared', FMAX > 0);
function matrixOf(cells) {
  const m = {};
  for (let i = 0; i < cells; i++) {
    const site = 'site' + Math.floor(i / 50) + '.example';
    const domain = 'd' + i + '.example';
    (m[site] = m[site] || {})[domain] = { all: 'block' };
  }
  return m;
}
{
  const c = F.compile(matrixOf(FMAX));
  check('exactly the cap: every cell is a rule, nothing omitted', c.rules.length === FMAX && c.omitted.length === 0 && c.limit === FMAX);
  const over = F.compile(matrixOf(FMAX + 5));
  check('255 stored decisions: 250 rules and five named cells', over.rules.length === FMAX && over.omitted.length === 5
    && over.omitted.every((o) => /^site5\.example$/.test(o.site) && o.column === 'all') && over.omitted[0].domain === 'd250.example', JSON.stringify(over.omitted));
  check('firewallRulesFrom is the same compile', F.rulesFrom(matrixOf(FMAX + 5)).length === FMAX);
  check('the omitted cells of one site are what its page is told', F.omittedFor(over, 'site5.example').length === 5 && F.omittedFor(over, 'site0.example').length === 0);
  const again = F.compile(JSON.parse(JSON.stringify(matrixOf(FMAX + 5))));
  check('the same stored matrix admits the same cells after a restart', JSON.stringify(again.omitted) === JSON.stringify(over.omitted) && again.rules.every((r, i) => r.id === over.rules[i].id));
}
{
  /* A cookie column set to anything but strip makes no rule and takes no slot. */
  const m = matrixOf(FMAX);
  m['site0.example']['d0.example'].cookie = 'allow';
  const c = F.compile(m);
  check('a cell that makes no rule takes no slot and is not omitted', c.rules.length === FMAX && c.omitted.length === 0);
}
{
  /* The write-time refusal. The new decision is on an EARLY domain, so it takes an id in
     the middle and the LAST decision is the one the compile would drop. */
  const full = matrixOf(FMAX);
  const before = F.compile(full);
  const next = F.matrixWith(full, 'site0.example', 'd0.example', 'script', 'block');
  const after = F.compile(next);
  check('the extra decision would bump the last stored cell, not itself', after.omitted.length === 1 && after.omitted[0].domain === 'd249.example');
  const why = F.refusal(before, after);
  check('a decision that would not fit is refused with the count', /decision 251 of a firewall that holds 250 rules/.test(why) && /Nothing was saved/.test(why), why);
  const changed = F.matrixWith(full, 'site0.example', 'd0.example', 'all', 'allow');
  check('changing an existing decision at the cap is not refused', F.refusal(before, F.compile(changed)) === '' && F.compile(changed).rules.length === FMAX);
  const fewer = F.matrixWith(full, 'site0.example', 'd0.example', 'all', 'default');
  check('setting a cell back to Default at the cap is not refused', F.refusal(before, F.compile(fewer)) === '' && F.compile(fewer).rules.length === FMAX - 1);
  /* A legacy matrix already over the cap: editing what is there is allowed, growing is not. */
  const legacy = matrixOf(FMAX + 5);
  const lb = F.compile(legacy);
  check('an over-full matrix can still change an existing decision', F.refusal(lb, F.compile(F.matrixWith(legacy, 'site0.example', 'd1.example', 'all', 'allow'))) === '');
  check('but not add one', /decision 256/.test(F.refusal(lb, F.compile(F.matrixWith(legacy, 'site0.example', 'd1.example', 'xhr', 'block')))));
  check('and shrinking it is allowed', F.refusal(lb, F.compile(F.matrixWith(legacy, 'site5.example', 'd254.example', 'all', 'default'))) === '');
}

/* ---- the handlers and the pages say it ----------------------------------------------- */
check('firewall-set refuses before touching Chrome and stores nothing',
  /const before = firewallCompile\(matrix\);\s*const after = firewallCompile\(next\);\s*const refusal = firewallRefusalFor\(before, after\);\s*if \(refusal\) \{\s*sendResponse\(\{ ok: false, error: refusal/.test(BG));
check('firewall-get names the cells stored but not in effect', /omitted: site \? firewallOmittedFor\(compiled, site\) : \[\]/.test(BG));
check('the firewall page draws an inert cell as not in effect', /is-inert/.test(FW_JS) && /stored but NOT in effect/.test(FW_JS) && /\.fw-btn\.is-inert \{[^}]*line-through/.test(FW_HTML) && /stored but not in effect \(over the rule limit\)/.test(FW_JS));
check('the firewall page uses the page\'s own warning token', /outline: 1px dashed var\(--guide-warning\)/.test(FW_HTML));
check('user-rules responses carry cosmetic and overflow as their own numbers',
  (BG.match(/cosmetic: parsed\.cosmetic,\s*overflow: parsed\.overflow,\s*overflowLines: parsed\.overflowLines,\s*limit: USER_RULE_MAX,/g) || []).length === 2
    && !/parsed\.count - parsed\.network\.length/.test(BG));
check('the popup never derives hiding rules by subtraction', /const over = Number\(res\.overflow \|\| 0\);/.test(POPUP) && !/count - /.test(POPUP.slice(POPUP.indexOf('function describeRuleCounts'), POPUP.indexOf('function loadUserRules'))));
check('the popup does not say Saved without qualification over overflow', /'Saved, but not all of it is in use\. '/.test(POPUP));
check('the popup names each overflowing line', /past the ' \+ fmtCount\(limit \|\| 0\) \+ '-rule limit, not in use/.test(POPUP));
check('a list row shows its share of the band, not its parse alone', /applied \+ ' of ' \+ net \+ ' blocking rules in use'/.test(POPUP) && /blocking rules are past the shared limit and not in use/.test(POPUP));

console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
console.log('  ok  ' + pass + ' checks: nothing past either cap is counted as something else, and the pages say what is not in use');

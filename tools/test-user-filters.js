/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * My Rules and Custom Lists: the user-owned filtering layer.
 *
 * A bundled list can only block what its maintainers thought of. These two are
 * the parts only the reader can supply -- a rule for a niche annoyance nobody
 * else will ever see, and a subscription to a list nobody has bundled.
 *
 * Neither is a "protection" with a switch, and that is deliberate: a rule is on
 * because it was written, and each list carries its own enabled flag. Giving
 * them shield toggles would inflate the protection count with things that
 * protect nobody until somebody types into them, which is the honesty problem
 * tools/test-protection-count.js exists to prevent.
 *
 * The rule this file really enforces: a rule that is stored but cannot work must
 * be REPORTED, never silently dropped. Someone who writes a rule and sees no
 * complaint believes they are protected, and a filter engine that lies about
 * that is worse than one with no user rules at all.
 *
 * Run: node tools/test-user-filters.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const POPUP_HTML = fs.readFileSync('popup.html', 'utf8');
const POPUP_JS = fs.readFileSync('popup.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- lift the real parser ---------------------------------------------- */
const NL = String.fromCharCode(10);
function region(startMarker, endMarker) {
  const a = BG.indexOf(startMarker);
  const b = BG.indexOf(endMarker, a);
  return a >= 0 && b > a ? BG.slice(a, b) : '';
}
const consts = region('const USER_RULE_BASE = 750000;', '/* One line in, one of three');
const lineFn = region('function parseUserFilterLine(raw) {', 'async function readUserRulesText');
check('the constants and both parsers are where the slice expects them',
  !!consts && !!lineFn && lineFn.includes('function parseUserFilterText('));
if (!consts || !lineFn) { console.error('user filters: cannot continue'); process.exit(2); }

/* The real normalizeAllowlistHost, not a stub: the parser's idea of what counts
   as a domain IS that function, and a lenient stand-in would let this suite pass
   on input the shipped code rejects. */
const hostFn = region('function normalizeAllowlistHost(value) {', 'function normalizeAllowlistHosts(');
check('normalizeAllowlistHost is liftable', !!hostFn);
const box = {
  String, Object, Number, Array, RegExp, Math, console, URL,
  normalizeIpLiteral: (h) => h,
  isLocalOrPrivateHost: (h) => /^(localhost|127\.|10\.|192\.168\.)/.test(h),
};

vm.createContext(box);
vm.runInContext(consts + NL + hostFn + NL + lineFn
  + ';globalThis.line=parseUserFilterLine;globalThis.parse=parseUserFilterText;'
  + 'globalThis.BASE=USER_RULE_BASE;globalThis.MAX=USER_RULE_MAX;', box,
  { filename: 'background.js:user-filters' });
const line = box.line;
const parse = box.parse;

/* ---- the four forms a person actually writes ---------------------------- */
{
  const a = line('||ads.example.com^');
  check('a host block parses', a.kind === 'network' && a.exception === false && a.pattern === '||ads.example.com^');

  const b = line('@@||example.com^');
  check('an exception parses', b.kind === 'network' && b.exception === true && b.pattern === '||example.com^');

  const c = line('example.com##.newsletter-popup');
  check('a site-scoped hide parses',
    c.kind === 'cosmetic' && c.selector === '.newsletter-popup'
      && c.domains.length === 1 && c.domains[0] === 'example.com');

  const d = line('##.promo');
  check('a global hide parses', d.kind === 'cosmetic' && d.selector === '.promo' && d.domains.length === 0);

  const e = line('a.com,b.com##.x');
  check('a multi-domain hide keeps both domains',
    e.kind === 'cosmetic' && e.domains.join(',') === 'a.com,b.com');

  check('www. is stripped the way every other host list strips it',
    line('www.example.com##.x').domains[0] === 'example.com');
}

/* ---- comments and blanks are not rules ---------------------------------- */
{
  check('a bang comment is a comment', line('! my notes').kind === 'comment');
  check('a section header is a comment', line('[Adblock Plus 2.0]').kind === 'comment');
  check('an empty line is blank', line('   ').kind === 'blank');
}

/* ---- and everything refused says why ------------------------------------ *
 * This is the half that matters. Each of these used to be a plausible thing to
 * type, and every one of them would do nothing. */
{
  const cases = [
    ['a', 'too general'],
    ['||a^', 'too general'],
    ['/ads?/', 'regular-expression'],
    ['||exämple.com^', 'non-ASCII'],
    ['||a|b^', 'only meaningful at the ends'],
    ['||ads.example.com^$script', 'options'],
    ['example.com##', 'no selector'],
    ['##+js(aopr, x)', 'procedural and scriptlet'],
    ['example.com##.a:has-text(promo)', 'procedural and scriptlet'],
    ['example.com#@#.a', 'not supported'],
    ['not a domain!!##.x', 'not a domain'],
  ];
  for (const [text, expect] of cases) {
    const r = line(text);
    check('refused with a reason: ' + text,
      r.kind === 'error' && String(r.why).includes(expect),
      'got ' + r.kind + (r.why ? ' / ' + r.why : ''));
  }
}

/* ---- a whole list, the way the engine consumes it ----------------------- */
{
  const text = [
    '! my rules',
    '',
    '||ads.example.com^',
    '@@||good.example^',
    'example.com##.promo',
    '##.everywhere',
    'a',                       // refused
  ].join(NL);
  const out = parse(text, box.BASE);

  check('counts only the rules it understood', out.count === 4, 'got ' + out.count);
  check('network rules become DNR rules', out.network.length === 2);
  check('ids start at the reserved base', out.network[0].id === box.BASE);
  check('ids do not collide with each other', out.network[0].id !== out.network[1].id);
  check('a block is a block', out.network[0].action.type === 'block');
  check('an exception is an allow', out.network[1].action.type === 'allow');
  /* An exception the reader wrote must beat an automatic block (2000) and the
     hand-block (99000 is the user allowlist's neighbour), but must never beat
     "this site is allowlisted". */
  check('an exception outranks a block', out.network[1].priority > out.network[0].priority);
  check('both sit above the learned/auto range', out.network[0].priority > 2000);

  check('site-scoped hides are grouped by domain',
    (out.cosmeticByDomain['example.com'] || []).join() === '.promo');
  check('global hides are kept apart from site ones',
    out.genericCosmetic.join() === '.everywhere');

  check('the refusal names its line number', out.errors.length === 1 && out.errors[0].line === 7,
    JSON.stringify(out.errors));
  check('and quotes the text back', out.errors[0].text === 'a');
}

/* The dynamic-rule budget is shared with every other feed, so the cap has to
   hold even if someone pastes a hundred thousand lines. */
{
  const many = [];
  for (let i = 0; i < box.MAX + 500; i++) many.push('||host' + i + '.example^');
  const out = parse(many.join(NL), box.BASE);
  check('the network rule cap holds', out.network.length === box.MAX, 'got ' + out.network.length);
  check('ids stay inside the reserved range',
    out.network[out.network.length - 1].id < box.BASE + box.MAX);
}

/* ---- wiring ------------------------------------------------------------- */
check('rules are applied through the serialized applier list',
  /'applyUserFilterRules',/.test(BG),
  'an unserialized applier can settle out of order against the other rule feeds');
check('the reserved id range is cleared before reapplying',
  /x\.id >= USER_RULE_BASE && x\.id < USER_RULE_BASE \+ USER_RULE_MAX/.test(BG),
  'stale rules would accumulate on every save');
check('one rule Chrome refuses does not drop the rest',
  /for \(const rule of bundle\.network\)/.test(BG),
  'updateDynamicRules rejects the whole batch over one bad rule');
check('editing rules invalidates the cosmetic host cache',
  /function invalidateUserFilters\(\)[\s\S]{0,200}__cosmeticHostCache\.clear\(\)/.test(BG),
  'a hide rule would not take effect until the cache aged out');
check('user cosmetics ride the channel that survives allowlisting',
  /out\.userSelectors = \(out\.userSelectors \|\| \[\]\)\.concat\(own\)/.test(BG),
  'allowlisting a site\'s ads must not silently un-hide what the reader hid');
check('and they match host-or-parent like the shipped rules',
  /host === d \|\| host\.endsWith\('\.' \+ d\)/.test(BG));

/* Subscriptions are fetched over the network, so they take the same URL guard
   as every other fetch: public https only, no odd ports, no redirect onto a
   private address, and a byte cap. */
check('a list URL goes through the public-URL guard',
  /let url = normalizePublicHttpUrl\(rawUrl\);/.test(BG)
    && /!isDefaultPortHttpUrl\(url\)/.test(BG));
check('a redirect is re-checked rather than followed blindly',
  /const next = normalizePublicHttpUrl\(res\.headers && res\.headers\.get\('location'\), url\);/.test(BG));
check('the body is size-capped', /readResponseTextWithByteLimit\(res, CUSTOM_LIST_BYTES\)/.test(BG));
check('a failed refresh keeps the copy it already had',
  /Keep the last good copy/.test(BG));
check('list text is never sent to the page',
  (BG.match(/Object\.assign\(\{\}, l, \{ text: undefined \}\)/g) || []).length >= 4,
  'the text can be megabytes and nothing renders it');

/* ---- these are not protections, and must not be counted as any ---------- */
check('no shield toggle was added for either',
  !/data-key="userRules"/.test(POPUP_HTML) && !/data-key="customLists"/.test(POPUP_HTML),
  'they would inflate the protection count with things that protect nobody until used');
/* Presented as a collapsed dropdown section, the same shape Twitch local rewind
   uses, rather than a bespoke widget. Closed by default because nobody needs
   filter syntax for WardenOne to work -- an open section full of empty fields
   reads as something left unfinished. */
check('the section is a rewind-drop like the rest of the popup',
  /<details class="rewind-drop" id="my-filters-drop">/.test(POPUP_HTML));
check('its summary reads as a section header and says it is advanced',
  /<summary>My filters \(advanced\)<span class="rewind-caret"/.test(POPUP_HTML));
check('and it is collapsed by default',
  !/<details class="rewind-drop" id="my-filters-drop" open>/.test(POPUP_HTML));
check('no bespoke collapsible styling was left behind',
  !/\.adv-block/.test(POPUP_HTML) && !/adv-tag/.test(POPUP_HTML),
  'the house pattern already does this');
check('both panes load when the one section opens',
  /const drop = \$\('my-filters-drop'\);/.test(POPUP_JS)
    && /loadUserRules\(\);\s*loadCustomLists\(\);/.test(POPUP_JS));

/* ---- the UI has to report, not just store ------------------------------- */
check('the editor shows what was skipped', /function renderUserRuleErrors\(/.test(POPUP_JS));
check('saving reports the counts back', /describeRuleCounts/.test(POPUP_JS));
check('import appends rather than replacing',
  /Append rather than replace/.test(POPUP_JS),
  'an import that wiped hand-written rules would be unrecoverable');
check('each list row offers update, toggle and remove',
  /custom-list-toggle/.test(POPUP_JS) && /custom-list-update/.test(POPUP_JS)
    && /custom-list-remove/.test(POPUP_JS));
check('a stale list says so in its row', /Last check failed: /.test(POPUP_JS));

if (failed) {
  console.error('user filters: ' + failed + ' failed');
  process.exit(1);
}
console.log('user filters: all checks passed');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* $redirect and $csp: the resource table has to agree with the files on disk, the manifest and
   the package, and the rules the parser emits have to stay inside the bands and off navigations.
   Run: node tools/test-redirect-resources.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const generator = require('./build-redirect-resources.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ALLOWLIST = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'package-allowlist.json'), 'utf8')));

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

function readNumber(name) {
  const found = Number((BG.match(new RegExp('const ' + name + ' = (\\d+)')) || [])[1]);
  check(name + ' is readable from background.js', Number.isFinite(found) && found > 0);
  return found;
}

const REDIRECT_RULE_BASE = readNumber('REDIRECT_RULE_BASE');
const REDIRECT_RULES_BUDGET = readNumber('REDIRECT_RULES_BUDGET');
const CSP_RULE_BASE = readNumber('CSP_RULE_BASE');
const CSP_RULES_BUDGET = readNumber('CSP_RULES_BUDGET');
const REDIRECT_RULE_PRIORITY = readNumber('REDIRECT_RULE_PRIORITY');
const CSP_RULE_PRIORITY = readNumber('CSP_RULE_PRIORITY');

// ---------------------------------------------------------------------------
// Lift the parser out of background.js.
// ---------------------------------------------------------------------------
const from = BG.indexOf('/* ======================= $redirect and $csp');
const to = BG.indexOf('function parseNetworkRules(');
check('the modifier region is where the slice expects it', from > 0 && to > from);
if (from < 0 || to < from) process.exit(1);

const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];

const sandbox = {
  String, Number, Boolean, Array, Object, Set, Map, RegExp, JSON, console,
  ALL_DNR_RESOURCE_TYPES: ALL_TYPES,
  UBO_IGNORABLE: new Set(['all']),
  UBO_TYPE_MAP: {
    script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet',
    object: 'object', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
    subdocument: 'sub_frame', frame: 'sub_frame', document: 'main_frame', doc: 'main_frame',
    ping: 'ping', media: 'media', font: 'font', websocket: 'websocket', other: 'other',
  },
  validNetworkRuleScope: (host) => host.length <= 253 && host.split('.').every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)),
  networkRulePatternHost: (pattern) => {
    let p = String(pattern || '').trim().toLowerCase();
    if (!p) return '';
    p = p.replace(/^\|\|/, '').replace(/^\|/, '');
    p = p.replace(/^https?:\/\//, '').replace(/^https?:/, '').replace(/^\/\//, '');
    p = p.replace(/^\*\./, '').replace(/^www\./, '');
    p = p.replace(/[\^/?#:|].*$/, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p) ? p : '';
  },
  REDIRECT_RULE_PRIORITY,
  CSP_RULE_PRIORITY,
};
vm.createContext(sandbox);
vm.runInContext(BG.slice(from, to)
  + 'this.__api={parseModifierRules,finalizeModifierRule,redirectResourceFor,REDIRECT_RESOURCES,'
  + 'REDIRECT_SURROGATE_NAMES};',
  sandbox, { filename: 'background.js:modifiers' });
const api = sandbox.__api;

// ---------------------------------------------------------------------------
// The table, the files, the manifest and the package all name the same things.
// ---------------------------------------------------------------------------
{
  const generated = new Set(generator.RESOURCES.map((r) => 'redirect-resources/' + r.file));
  const referenced = new Set(Object.values(api.REDIRECT_RESOURCES).map((r) => r.path.replace(/^\//, '')));

  for (const file of referenced) {
    check('the table points at a file that exists: ' + file, fs.existsSync(path.join(ROOT, file)));
    check('the table points at a generated file: ' + file, generated.has(file),
      'tools/build-redirect-resources.js does not produce it');
  }
  for (const file of generated) {
    check('every generated file is reachable from a filter-list name: ' + file, referenced.has(file),
      'nothing in REDIRECT_RESOURCES serves it, so it would ship unused');
  }

  const war = (MANIFEST.web_accessible_resources || [])
    .flatMap((entry) => entry.resources || []);
  for (const file of referenced) {
    check('the browser may serve it to a page: ' + file, war.includes(file),
      'a DNR redirect to a resource that is not web accessible fails the request');
    check('the release package carries it: ' + file, ALLOWLIST.has(file));
  }

  /* A page can fetch a web-accessible resource to recognise the extension. A dynamic URL is the
     only thing that stops that being a reliable fingerprint. */
  const entry = (MANIFEST.web_accessible_resources || [])
    .find((e) => (e.resources || []).some((r) => r.startsWith('redirect-resources/')));
  check('the redirect resources are served from a dynamic URL', !!entry && entry.use_dynamic_url === true,
    'without use_dynamic_url any page can probe for WardenOne at a fixed path');
}

// ---------------------------------------------------------------------------
// Name resolution, including uBlock's trailing ":priority" form.
// ---------------------------------------------------------------------------
{
  check('a canonical name resolves', api.redirectResourceFor('noop.js').path === '/redirect-resources/noop.js');
  check('an alias resolves to the same file',
    api.redirectResourceFor('noopjs').path === '/redirect-resources/noop.js');
  check('a trailing rule priority is ignored',
    api.redirectResourceFor('noopjs:10').path === '/redirect-resources/noop.js');
  check('an unknown name resolves to nothing', api.redirectResourceFor('not-a-resource.js') === null);
  for (const name of ['google-ima.js', 'googlesyndication_adsbygoogle.js', 'fingerprint2.js']) {
    check('surrogate "' + name + '" is not served by a neutered file',
      api.redirectResourceFor(name) === null && api.REDIRECT_SURROGATE_NAMES.has(name),
      'a surrogate has to imitate an API; an empty file would break the page differently');
  }
  for (const [name, resource] of Object.entries(api.REDIRECT_RESOURCES)) {
    check('default types for "' + name + '" exclude main_frame', !resource.types.includes('main_frame'));
    check('default types for "' + name + '" are real DNR types',
      resource.types.every((t) => ALL_TYPES.includes(t)), resource.types.join(','));
  }
}

// ---------------------------------------------------------------------------
// $redirect.
// ---------------------------------------------------------------------------
{
  const out = api.parseModifierRules('||ads.example/banner.js$script,redirect=noopjs\n', 100, 100);
  check('a $redirect line compiles to one redirect rule', out.redirectRules.length === 1);
  const rule = api.finalizeModifierRule(out.redirectRules[0], REDIRECT_RULE_BASE);
  check('it redirects to the extension resource',
    rule.action.type === 'redirect' && rule.action.redirect.extensionPath === '/redirect-resources/noop.js');
  check('it keeps the declared request type',
    JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(['script']));
  check('it sits above the blocklist and below the compatibility allows',
    rule.priority === REDIRECT_RULE_PRIORITY && rule.priority > 1100 && rule.priority < 1900,
    String(rule.priority));

  const typeless = api.parseModifierRules('||ads.example/pixel$redirect=1x1.gif\n', 100, 100);
  check('a line with no request type takes the resource default',
    typeless.redirectRules.length === 1
    && JSON.stringify(typeless.redirectRules[0].condition.resourceTypes) === JSON.stringify(['image']));

  /* uBlock's $redirect-rule only fires when another rule already blocks the request. DNR cannot
     ask that, and emitting it as a plain redirect would stop requests uBlock lets through. */
  const conditional = api.parseModifierRules('||ads.example/a.js$script,redirect-rule=noopjs\n', 100, 100);
  check('$redirect-rule is dropped rather than turned into a block',
    conditional.redirectRules.length === 0);

  const navigation = api.parseModifierRules('||ads.example/page$document,redirect=noop.html\n', 100, 100);
  check('a $redirect on a document is refused', navigation.redirectRules.length === 0,
    'answering a navigation with a local file takes the reader somewhere they did not ask for');

  const unknown = api.parseModifierRules('||ads.example/ima.js$script,redirect=google-ima.js\n', 100, 100);
  check('a rule naming a surrogate we do not ship is dropped', unknown.redirectRules.length === 0);

  const exempted = api.parseModifierRules(
    '||ads.example/a.js$script,redirect=noopjs\n@@||ads.example^$redirect\n', 100, 100);
  check('a $redirect exception drops the redirect for that host', exempted.redirectRules.length === 0);

  const scoped = api.parseModifierRules(
    '||cdn.example/a.js$script,redirect=noopjs,domain=site.example|~sub.site.example\n', 100, 100);
  check('domain scoping becomes initiator domains',
    scoped.redirectRules.length === 1
    && JSON.stringify(scoped.redirectRules[0].condition.initiatorDomains) === JSON.stringify(['site.example'])
    && JSON.stringify(scoped.redirectRules[0].condition.excludedInitiatorDomains) === JSON.stringify(['sub.site.example']));

  const regex = api.parseModifierRules('/ads?\\d+/$script,redirect=noopjs\n', 100, 100);
  check('a regex filter is not approximated', regex.redirectRules.length === 0);

  const capped = api.parseModifierRules(
    Array.from({ length: 50 }, (_, i) => '||a' + i + '.example/x.js$script,redirect=noopjs').join('\n'), 7, 100);
  check('the per-source cap is honoured', capped.redirectRules.length === 7, String(capped.redirectRules.length));
}

// ---------------------------------------------------------------------------
// $csp. Narrower than uBlock on purpose: an appended policy can refuse a site's own scripts.
// ---------------------------------------------------------------------------
{
  const out = api.parseModifierRules("||site.example^$csp=script-src 'self'\n", 100, 100);
  check('a $csp line compiles to one rule', out.cspRules.length === 1);
  const rule = api.finalizeModifierRule(out.cspRules[0], CSP_RULE_BASE);
  check('it appends the header rather than replacing it',
    rule.action.type === 'modifyHeaders'
    && rule.action.responseHeaders[0].header === 'content-security-policy'
    && rule.action.responseHeaders[0].operation === 'append'
    && rule.action.responseHeaders[0].value === "script-src 'self'");
  check('it applies only to documents',
    JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(['main_frame', 'sub_frame']));
  check('it sits below every block and allow band',
    rule.priority === CSP_RULE_PRIORITY && rule.priority < 1000, String(rule.priority));

  const exempted = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@||site.example^$csp\n", 100, 100);
  check('an exception for the host drops the injection', exempted.cspRules.length === 0);

  const otherPolicy = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@||site.example^$csp=worker-src 'none'\n", 100, 100);
  check('an exception naming a different policy still drops the injection',
    otherPolicy.cspRules.length === 0,
    'upstream writes a $csp exception because injection broke that site; policy-by-policy matching'
    + ' is not reproducible here, so the whole host is exempted');

  const pathExempt = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@||site.example/embed/$csp\n", 100, 100);
  check('a path-scoped exception exempts the whole host', pathExempt.cspRules.length === 0);

  const initiator = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@*$csp,domain=host.example\n", 100, 100);
  check('a domain-scoped exception becomes an excluded initiator',
    initiator.cspRules.length === 1
    && (initiator.cspRules[0].condition.excludedInitiatorDomains || []).includes('host.example'));

  const pathPattern = api.parseModifierRules("||site.example/page$csp=script-src 'self'\n", 100, 100);
  check('a $csp rule with a path is refused', pathPattern.cspRules.length === 0,
    'only the document host is reproduced exactly');

  const scopedInjection = api.parseModifierRules(
    "||site.example^$csp=script-src 'self',domain=other.example\n", 100, 100);
  check('a domain-scoped $csp injection is refused', scopedInjection.cspRules.length === 0);

  for (const bad of ["||site.example^$csp=script-src 'self'\r\nX", '||site.example^$csp=']) {
    const parsed = api.parseModifierRules(bad.split('\r').join('\n'), 100, 100);
    check('a malformed policy is refused: ' + JSON.stringify(bad.slice(0, 40)),
      parsed.cspRules.every((r) => !/[\r\n]/.test(r.action.responseHeaders[0].value)));
  }

  const noPolicy = api.parseModifierRules('||site.example^$csp\n', 100, 100);
  check('a bare $csp with no policy injects nothing', noPolicy.cspRules.length === 0);
  const reporting = api.parseModifierRules("||site.example^$csp=script-src 'self'; report-uri https://sink.example/", 100, 100);
  check('downloaded policies cannot send violation reports', reporting.cspRules.length === 0);
}

// ---------------------------------------------------------------------------
// Budgets. Both actions count against Chrome's smaller unsafe dynamic quota.
// ---------------------------------------------------------------------------
{
  const CHROME_UNSAFE_DYNAMIC_MAX = 5000;
  const unsafeLine = BG.match(/const TOTAL_UNSAFE_DYNAMIC_BUDGET = ([^;]+);/);
  check('the unsafe budget is declared', !!unsafeLine);
  check('the unsafe budget counts the redirect band',
    !!unsafeLine && unsafeLine[1].includes('REDIRECT_RULES_BUDGET'),
    'a redirect is an unsafe DNR action and must be reserved');
  check('the unsafe budget counts the csp band',
    !!unsafeLine && unsafeLine[1].includes('CSP_RULES_BUDGET'));
  const firewall = readNumber('FIREWALL_RULES_BUDGET');
  const trackingRedirect = readNumber('TRACKING_REDIRECT_RULES_BUDGET');
  const unsafeTotal = firewall + trackingRedirect + REDIRECT_RULES_BUDGET + CSP_RULES_BUDGET + 1;
  check('the unsafe bands fit Chrome\'s guaranteed unsafe quota',
    unsafeTotal < CHROME_UNSAFE_DYNAMIC_MAX,
    unsafeTotal + ' reserved against ' + CHROME_UNSAFE_DYNAMIC_MAX);

  check('the redirect band does not overlap the csp band',
    REDIRECT_RULE_BASE + REDIRECT_RULES_BUDGET <= CSP_RULE_BASE);
  check('the redirect allocation fits the measured feed count',
    REDIRECT_RULES_BUDGET >= 838, '838 reviewed redirects need more than the former 400 slots');
  const optionBase = readNumber('OPTION_RULE_BASE');
  const optionMax = readNumber('OPTION_RULES_MAX');
  check('the redirect band starts above the option band',
    REDIRECT_RULE_BASE >= optionBase + optionMax);
  check('both bands are replaced with the rest of the remote lists',
    BG.includes('for (let i = 0; i < REDIRECT_RULES_BUDGET; i++) ids.push(REDIRECT_RULE_BASE + i)')
    && BG.includes('for (let i = 0; i < CSP_RULES_BUDGET; i++) ids.push(CSP_RULE_BASE + i)'),
    'a band left out of remoteListRuleIds is never cleared and goes stale');
  check('both bands are recognised as WardenOne rule ids',
    BG.includes('id >= REDIRECT_RULE_BASE && id < REDIRECT_RULE_BASE + REDIRECT_RULES_BUDGET')
    && BG.includes('id >= CSP_RULE_BASE && id < CSP_RULE_BASE + CSP_RULES_BUDGET'));
}

if (failed) {
  console.error('[fail] ' + failed + ' redirect/csp check(s) failed');
  process.exit(1);
}
console.log('[ok] $redirect and $csp: resource table, manifest and package agree; navigations refused, '
  + 'exceptions honoured, bands and unsafe budget reserved');

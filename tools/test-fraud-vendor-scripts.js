/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Fraud and bot-check scripts are not fingerprinting libraries, and the difference decides
 * whether someone can sign into their bank.
 *
 * "Limit fingerprinting JavaScript" shipped on by default with one list of seventeen hosts.
 * Six were fingerprinting libraries -- refusing those costs the reader nothing. The other
 * eleven were ThreatMetrix, iovation, Sift, Forter, Riskified, PerimeterX, DataDome and
 * Kasada: vendors a site has handed an access decision to. Blocking one of those does not
 * quietly drop a tracker from a page that still works, it removes something the site
 * requires, and what the reader gets is a refused login or a declined order with nothing
 * naming the cause. None of WardenOne's three allow bands rescued them, so the only way out
 * was allowlisting the whole site.
 *
 * So the list is split, the gatekeeping half has its own switch and is off unless asked for,
 * and the rules carry the same login-compat exclusion every other blocking rule here carries.
 * The needles are path-anchored too: unanchored they matched the query string, so an
 * unrelated bundle requested with "?module=device-fingerprint" was refused on that alone.
 *
 * This runs the SHIPPED rule builder rather than a copy of it, because a copy would drift.
 *
 * Run: node tools/test-fraud-vendor-scripts.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* Lift a declaration by balancing brackets. Several of these arrays carry "]" inside their
   own comments, so matching on "];" finds the wrong end. */
function lift(name) {
  const i = BG.indexOf('const ' + name);
  if (i < 0) throw new Error('not found: ' + name);
  const open = BG.indexOf('[', i);
  let depth = 0, inStr = '', inLine = false, inBlock = false;
  for (let k = open; k < BG.length; k++) {
    const c = BG[k], n = BG[k + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
    if (inStr) { if (c === '\\') { k++; continue; } if (c === inStr) inStr = ''; continue; }
    if (c === '/' && n === '/') { inLine = true; k++; continue; }
    if (c === '/' && n === '*') { inBlock = true; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (!depth) { let e = k + 1; while (/\s/.test(BG[e])) e++; if (BG[e] === ')') e++; return BG.slice(i, e) + ';'; }
    }
  }
  throw new Error('unbalanced: ' + name);
}

const fnStart = BG.indexOf('async function applyFingerprintScriptRules');
const fnEnd = BG.indexOf('\n}', fnStart) + 2;

const ctx = { console: { warn() {} }, Object, Array, String, Number };
vm.createContext(ctx);
vm.runInContext([
  lift('FINGERPRINT_SCRIPT_RESOURCE_TYPES'),
  lift('FINGERPRINT_LIBRARY_DOMAIN_FILTERS'),
  lift('FRAUD_VENDOR_DOMAIN_FILTERS'),
  lift('FINGERPRINT_LIBRARY_URL_FILTERS'),
  lift('FRAUD_VENDOR_URL_FILTERS'),
  lift('LOGIN_COMPAT_NEVER_BLOCK_DOMAINS'),
  'const FINGERPRINT_SCRIPT_RULE_BASE = 931500;',
  'const FINGERPRINT_SCRIPT_RULE_MAX = 80;',
  'let captured = [];',
  'const chrome = { declarativeNetRequest: { getDynamicRules: async () => [],'
    + ' updateDynamicRules: async (x) => { captured = x.addRules; } } };',
  BG.slice(fnStart, fnEnd),
  'globalThis.build = async (a, b) => { await applyFingerprintScriptRules(a, b); return captured; };',
  'globalThis.FRAUD = FRAUD_VENDOR_DOMAIN_FILTERS;',
  'globalThis.LIBS = FINGERPRINT_LIBRARY_DOMAIN_FILTERS;',
].join('\n'), ctx);

const hosts = (rules) => rules.filter((r) => r.condition.requestDomains).map((r) => r.condition.requestDomains[0]);
const needlesOf = (rules) => rules.filter((r) => r.condition.urlFilter).map((r) => r.condition.urlFilter);

(async () => {
  /* ---- the two halves are actually separate ------------------------------------- */
  check('the two halves share no host',
    ctx.FRAUD.every((d) => !ctx.LIBS.includes(d)));
  check('the gatekeeping vendors are all still named somewhere',
    ['online-metrix.net', 'threatmetrix.com', 'iovation.com', 'iesnare.com', 'sift.com', 'forter.com',
      'riskified.com', 'perimeterx.net', 'px-cloud.net', 'datadome.co', 'kasada.io']
      .every((d) => ctx.FRAUD.includes(d)),
    'a vendor dropped from the list silently stops being offered at all');

  /* ---- defaults -------------------------------------------------------------------- */
  const def = await ctx.build(true, false);
  const defHosts = hosts(def);
  check('on defaults, no fraud or bot-check vendor is blocked',
    ctx.FRAUD.every((d) => !defHosts.includes(d)),
    ctx.FRAUD.filter((d) => defHosts.includes(d)).join(', '));
  check('on defaults, every fingerprinting library still is',
    ctx.LIBS.every((d) => defHosts.includes(d)));
  check('the fraud switch is off in the shipped defaults',
    /blockFraudVendorScripts:\s*false/.test(BG));

  /* ---- the exclusion every other blocking rule here carries ------------------------ */
  check('every emitted rule excludes the login-compat initiators',
    def.length > 0 && def.every((r) => Array.isArray(r.condition.excludedInitiatorDomains)
      && r.condition.excludedInitiatorDomains.length > 0),
    'without it a sign-in page embedding one of these has no way back but a whole-site allowlist');

  /* ---- anchoring ------------------------------------------------------------------- */
  check('every URL needle is anchored to a path segment',
    needlesOf(def).every((n) => n.startsWith('/')),
    needlesOf(def).filter((n) => !n.startsWith('/')).join(', '));
  check('no needle is generic enough to match an ordinary bundle name',
    !needlesOf(def).some((n) => /visitor-id/i.test(n)),
    '"visitor-id" is an ordinary name for a session or analytics file');
  {
    const needles = needlesOf(def);
    const matches = (url) => needles.some((n) => url.includes(n));
    check('a query string no longer decides it',
      !matches('https://cdn.partner.example/bundle.js?module=device-fingerprint'));
    check('a real fingerprinting path still does',
      matches('https://cdn.example.com/lib/fingerprintjs/v3/fp.min.js'));
  }

  /* ---- the opt-in still works ------------------------------------------------------ */
  const both = await ctx.build(true, true);
  check('turning the switch on blocks every gatekeeping vendor',
    ctx.FRAUD.every((d) => hosts(both).includes(d)));
  check('and leaves the libraries blocked too',
    ctx.LIBS.every((d) => hosts(both).includes(d)));
  check('the rules still fit the band they are allocated',
    both.length <= 80 && both.every((r) => r.id >= 931500 && r.id < 931580),
    both.length + ' rules');

  /* ---- the switches are independent ------------------------------------------------ */
  const only = await ctx.build(false, true);
  check('the fraud switch works on its own',
    ctx.FRAUD.every((d) => hosts(only).includes(d)) && ctx.LIBS.every((d) => !hosts(only).includes(d)));
  const off = await ctx.build(false, false);
  check('both off means no rules at all', off.length === 0, off.length + ' rules');

  /* ---- the reader can find it and is told what it costs ---------------------------- */
  check('the switch has a toggle in the popup',
    POPUP_HTML.includes('data-key="blockFraudVendorScripts"'));
  check('the popup reads and writes the key',
    POPUP_JS.includes("'blockFraudVendorScripts'"));
  check('it is counted as a protection',
    /'blockFraudVendorScripts'/.test(BG.slice(BG.indexOf('const HEALTH_SHIELD_KEYS'),
      BG.indexOf('];', BG.indexOf('const HEALTH_SHIELD_KEYS')))));
  check('the description says a sign-in can be refused',
    /sign-in can be refused|order declined/i.test(POPUP_HTML),
    'a switch that can stop a login has to say so where it is turned on');
  check('the fingerprinting switch no longer promises nothing breaks',
    !POPUP_HTML.includes('Block known fingerprinting script files while normal JavaScript keeps working.'));

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('all fraud-vendor script checks passed');
})();

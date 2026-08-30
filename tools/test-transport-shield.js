/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Transport Shield — the inventory test. Run: node tools/test-transport-shield.js
 *
 * The bug this exists to prevent. Blocklist rules were written against a
 * hand-maintained list of seven resource types. Chromium supports fifteen. The
 * gap included `webtransport`, which is a full bidirectional channel to the same
 * host over HTTP/3 — so every malware and phishing domain the extension blocked
 * was still reachable, by a page simply choosing a different constructor. The
 * in-page guards had the same shape of hole: fetch, XHR and WebSocket were all
 * wrapped, WebTransport was not, so Intranet Guard could be walked around in one
 * line.
 *
 * Nothing failed, because a partial list does not look partial. It looks like a
 * list. That is the whole problem, and it is why the fix is not "add
 * webtransport" but "stop maintaining partial lists": there is now one canonical
 * inventory, and the checks below compare everything against it.
 *
 * When Chromium adds a resource type, this suite fails. That is intended. Add it
 * to CHROMIUM_DNR_RESOURCE_TYPES, then decide — deliberately, once — which lists
 * should carry it.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* Every value in chrome.declarativeNetRequest.ResourceType, as of the Chrome
 * version manifest.json pins as its floor. `webtransport` landed in Chrome 105
 * and `webbundle` in 104, both well below that floor, so every entry here is
 * available to every browser this extension will run on.
 *
 * Source: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-ResourceType
 *
 * This constant is the point of the file. It is deliberately written out by hand
 * rather than derived from the source it checks, because a check that reads its
 * expected value from the thing under test proves nothing at all. */
const CHROMIUM_DNR_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
  'webbundle', 'other',
];

const MIN_CHROME_FOR_WEBTRANSPORT = 105;

// --- resolve the lists as they actually ship --------------------------------

/* The lists derive from one another now (SECURITY_RESOURCE_TYPES is the whole
 * inventory; MINER_POOL is that minus main_frame), so a regex for `const X =
 * [...]` would miss most of them and, worse, would silently find nothing rather
 * than failing. Pull every resource-type declaration in source order and run
 * them, so what gets asserted is the value Chrome is handed. */
function resolveResourceTypeLists() {
  const decls = [];
  const names = [];
  /* The optional prefix matters: the tracker list is named plain RESOURCE_TYPES,
   * and an earlier cut of this regex required a prefix, so it skipped the one
   * list most likely to be wrong and reported it as empty rather than missing. */
  const re = /const\s+((?:[A-Z0-9_]+_)?RESOURCE_TYPES)\s*=/g;
  let m;
  while ((m = re.exec(BG))) {
    const end = BG.indexOf(';', m.index);
    assert(end > m.index, 'unterminated declaration for ' + m[1]);
    decls.push(BG.slice(m.index, end + 1));
    names.push(m[1]);
  }
  assert(names.length >= 10, 'expected the resource-type lists to be found, got ' + names.length);
  const sandbox = {};
  try {
    vm.runInNewContext(decls.join(' ') + ' __all = { ' + names.map((n) => n + ': ' + n).join(', ') + ' };', sandbox);
  } catch (e) {
    /* Declarations run in source order, so this fires when one list is defined
       above a list it derives from. Chrome would hit the same TDZ error at
       service-worker startup and load no rules at all, so report it as the
       failure it is rather than dying with a stack trace. */
    console.error('FAIL (1)');
    console.error('  - resource-type lists do not evaluate in source order — ' + e.message);
    process.exit(1);
  }
  return { lists: sandbox.__all, names };
}

const { lists, names } = resolveResourceTypeLists();
const sorted = (a) => a.slice().sort().join(',');

// --- the inventory itself ---------------------------------------------------

(function inventoryMatchesChromium() {
  const ours = lists.ALL_DNR_RESOURCE_TYPES;
  check('ALL_DNR_RESOURCE_TYPES exists', Array.isArray(ours));
  if (!Array.isArray(ours)) return;

  const missing = CHROMIUM_DNR_RESOURCE_TYPES.filter((t) => ours.indexOf(t) < 0);
  const extra = ours.filter((t) => CHROMIUM_DNR_RESOURCE_TYPES.indexOf(t) < 0);

  /* Missing is the failure that let webtransport through. Extra matters just as
   * much the other way: Chrome rejects an entire updateSessionRules call on one
   * unknown resource type, so a typo here does not weaken a rule, it silently
   * drops every rule in the batch. */
  check('inventory covers every Chromium DNR resource type', missing.length === 0,
    'missing: ' + missing.join(', '));
  check('inventory invents no resource type Chromium does not have', extra.length === 0,
    'unknown: ' + extra.join(', '));
  check('inventory has no duplicates', new Set(ours).size === ours.length);
}());

(function everyListUsesRealTypes() {
  /* One bad string anywhere costs the whole rule batch, so check them all, not
   * just the ones this change touched. */
  names.forEach((name) => {
    const value = lists[name];
    if (!Array.isArray(value)) return;
    const bad = value.filter((t) => CHROMIUM_DNR_RESOURCE_TYPES.indexOf(t) < 0);
    check(name + ' contains only real resource types', bad.length === 0, 'bad: ' + bad.join(', '));
  });
}());

(function minimumChromeSupportsTheInventory() {
  const floor = Number(String(MANIFEST.minimum_chrome_version || '0').split('.')[0]);
  check('minimum_chrome_version is new enough for webtransport rules',
    floor >= MIN_CHROME_FOR_WEBTRANSPORT,
    'manifest floor is ' + floor + ', webtransport needs ' + MIN_CHROME_FOR_WEBTRANSPORT);
}());

// --- what each list is allowed to leave out ---------------------------------

(function securityBlocksEverything() {
  check('SECURITY_RESOURCE_TYPES is the whole inventory',
    sorted(lists.SECURITY_RESOURCE_TYPES || []) === sorted(CHROMIUM_DNR_RESOURCE_TYPES),
    'got: ' + (lists.SECURITY_RESOURCE_TYPES || []).join(', '));

  /* Knowing the constant is right is not the same as knowing it is used. */
  const fn = BG.slice(BG.indexOf('function domainToRule'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  check('security blocklist rules use the full inventory',
    /kind === 'security' \? SECURITY_RESOURCE_TYPES : RESOURCE_TYPES/.test(body),
    'domainToRule does not select by source kind');
}());

(function dataChannelsAreNeverOptional() {
  /* A list may leave out stylesheet or font — a false positive there mangles a
   * page, and tracker lists are large enough to be wrong sometimes. No list that
   * blocks anything may leave out the pure data channels: they carry no
   * rendering risk, so excluding them buys no compatibility, and they are
   * exactly where an exfiltration or command path would hide. */
  [
    ['RESOURCE_TYPES', 'tracker and ad blocklist rules'],
    ['SECURITY_RESOURCE_TYPES', 'malware and phishing rules'],
    ['MINER_RESOURCE_TYPES', 'known miner hosts'],
    ['MINER_POOL_RESOURCE_TYPES', 'mining pool endpoints'],
    ['TRACKER_RESOURCE_TYPES', 'tracker beacon rules'],
    ['IP_LOOKUP_BLOCK_RESOURCE_TYPES', 'IP-lookup deanonymisation rules'],
  ].forEach((pair) => {
    const value = lists[pair[0]] || [];
    check(pair[1] + ' cover webtransport', value.indexOf('webtransport') >= 0,
      pair[0] + ' = ' + value.join(', '));
  });
}());

(function poolRulesStillSpareTheAddressBar() {
  /* Widening these lists must not quietly start blocking navigations. Someone
   * typing a mining pool's address into the URL bar is not the attack. */
  check('mining pool rules still exclude main_frame',
    (lists.MINER_POOL_RESOURCE_TYPES || []).indexOf('main_frame') < 0);
  check('mining pool rules still cover websocket (stratum runs over WSS)',
    (lists.MINER_POOL_RESOURCE_TYPES || []).indexOf('websocket') >= 0);
}());

(function allowRulesOutrankAndOutcoverBlocks() {
  /* Login-compat allow rules run at priority 96000 and beat every block rule in
   * the extension. That only helps on the types they actually list: widening a
   * block list past the allow list breaks a sign-in on whichever type the allow
   * list forgot, and it breaks it invisibly, because the request simply does not
   * arrive. So the allow list must be a superset, permanently. */
  const allow = lists.LOGIN_COMPAT_RESOURCE_TYPES || [];
  [['RESOURCE_TYPES', lists.RESOURCE_TYPES], ['SECURITY_RESOURCE_TYPES', lists.SECURITY_RESOURCE_TYPES]]
    .forEach((pair) => {
      const uncovered = (pair[1] || []).filter((t) => allow.indexOf(t) < 0);
      check('login-compat allow rules cover everything ' + pair[0] + ' blocks',
        uncovered.length === 0, 'uncovered: ' + uncovered.join(', '));
    });
}());

// --- the in-page half -------------------------------------------------------

(function everyWebSocketGuardAlsoGuardsWebTransport() {
  /* The structural form of the bug: three separate guards wrapped WebSocket and
   * none wrapped WebTransport. Counting them is a check that keeps working when
   * a fourth guard is added, which a hardcoded list of three would not. */
  const sockets = (CONTENT.match(/window\.WebSocket=function/g) || []).length;
  const transports = (CONTENT.match(/window\.WebTransport=function/g) || []).length;
  check('every guard that wraps WebSocket also wraps WebTransport',
    transports >= sockets && sockets > 0,
    sockets + ' WebSocket wraps, ' + transports + ' WebTransport wraps');
}());

(function everyGuardCoversEveryTransport() {
  /* The parity matrix, and the real lesson of this bug. Checking "is WebTransport
   * handled somewhere" would have passed the day after the fix and told us
   * nothing later. What went wrong twice was per-guard drift: WebSocket was
   * wrapped in three guards and WebTransport in none, then EventSource turned out
   * to be wrapped in one guard out of three, so Intranet Guard could be walked
   * around with a constructor nobody had hooked.
   *
   * Every gate must handle every transport. A cell missing here is a bypass,
   * whichever axis it goes missing on. */
  const TRANSPORTS = ['WebSocket', 'EventSource', 'WebTransport'];
  const GATES = [
    ['blockLocal', 'Intranet Guard'],
    ['blockRisk', 'Risky-site Mode'],
    ['ipLookupUrl', 'IP-lookup privacy'],
  ];

  const coverage = {};
  TRANSPORTS.forEach((name) => {
    SOURCE.split('window.' + name + '=function').slice(1).forEach((tail) => {
      const head = tail.slice(0, 400);
      GATES.forEach((pair) => {
        /* A wrapper that never consults its gate is worse than no wrapper: it
         * reads as coverage and does nothing at runtime. Only count a cell when
         * the gate is actually called inside it. */
        if (head.indexOf(pair[0]) >= 0) {
          (coverage[pair[0]] = coverage[pair[0]] || new Set()).add(name);
        }
      });
    });
  });

  GATES.forEach((pair) => {
    TRANSPORTS.forEach((name) => {
      const covered = !!coverage[pair[0]] && coverage[pair[0]].has(name);
      check(pair[1] + ' wraps ' + name, covered,
        'no ' + name + ' wrapper consults ' + pair[0]);
    });
  });
}());

(function builtOutputMatchesSource() {
  /* content.min.js is generated; a guard that exists only in src/ ships nothing. */
  const inSource = (SOURCE.match(/window\.WebTransport=function/g) || []).length;
  const inBuild = (CONTENT.match(/window\.WebTransport=function/g) || []).length;
  check('content.min.js is rebuilt from src/content.js', inSource === inBuild && inSource === 3,
    'src=' + inSource + ' build=' + inBuild);
}());

(function transportWrappersPreservePrototypes() {
  /* Pages do `x instanceof WebTransport` and read constructor statics. A wrapper
   * that drops the prototype chain breaks working sites while blocking nothing,
   * which is the worst of both outcomes. */
  const wraps = SOURCE.split('window.WebTransport=function').slice(1);
  check('every WebTransport wrapper keeps the real prototype',
    wraps.length > 0 && wraps.every((tail) => tail.slice(0, 700).indexOf('WebTransport.prototype=RealWT.prototype') >= 0),
    wraps.length + ' wrappers inspected');
  check('every WebTransport wrapper keeps constructor statics reachable',
    wraps.every((tail) => tail.slice(0, 700).indexOf('setPrototypeOf') >= 0));
}());

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('transport shield: ' + pass + ' checks passed');

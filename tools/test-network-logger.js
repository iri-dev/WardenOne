/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The network / filtering logger.
 *
 * It answers a different question from the Activity Centre: not "a security event
 * happened" but "this exact request happened, WardenOne blocked or allowed it,
 * and THIS rule from THIS list is why". It exists because My Rules, Custom Lists
 * and the Element Zapper let someone break their own browsing, and without this
 * the only way to debug that is switching things off at random.
 *
 * Two invariants matter more than any feature here, and both are pinned below.
 *
 * 1. IT MUST NOT COST ANYTHING WHEN CLOSED. A webRequest listener over <all_urls>
 *    fires on every request on every page. That is not hypothetical in this
 *    codebase: the YouTube scrub lag was a DNS-rebind listener doing exactly
 *    that, once per storyboard image. So capture is attached when a logger page
 *    connects a port and detached when the last one disconnects.
 *
 * 2. THE LOG MUST NOT BECOME THE LEAK. A record of every URL is a record of every
 *    token in every URL. Redaction happens BEFORE the entry is stored, the buffer
 *    is bounded and in memory, and nothing reaches disk unless the reader exports
 *    it on purpose.
 *
 * Run: node tools/test-network-logger.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const HTML = fs.readFileSync('logger.html', 'utf8');
const JS = fs.readFileSync('logger.js', 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const POPUP_HTML = fs.readFileSync('popup.html', 'utf8');
const POPUP_JS = fs.readFileSync('popup.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

const NL = String.fromCharCode(10);
function region(a, b) {
  const i = BG.indexOf(a);
  const j = BG.indexOf(b, i);
  return i >= 0 && j > i ? BG.slice(i, j) : '';
}

/* ---- 1. the perf invariant: nothing runs while the logger is closed ------ */
check('capture attaches and detaches rather than living forever',
  /function logAttach\(\)/.test(BG) && /function logDetach\(\)/.test(BG));
check('every listener attached is also removed',
  ['onBeforeRequest', 'onCompleted', 'onErrorOccurred'].every((ev) =>
    BG.includes('chrome.webRequest.' + ev + '.addListener(log')
    && BG.includes('chrome.webRequest.' + ev + '.removeListener(log')),
  'a listener left attached is a per-request cost on every page, forever');
check('attach happens on a port connection, not at startup',
  /port\.name !== 'wardenone-logger'/.test(BG) && /LOG_PORTS\.add\(port\);\s*logAttach\(\);/.test(BG),
  'a port is used precisely because it reports when the page goes away');
check('the last disconnect detaches',
  /LOG_PORTS\.delete\(port\);\s*if \(!LOG_PORTS\.size\) logDetach\(\);/.test(BG));
check('the logger never registers a webRequest listener at module scope',
  !/^\s*chrome\.webRequest\.onBeforeRequest\.addListener\(logOnBeforeRequest/m.test(
    BG.replace(/function logAttach\(\)[\s\S]*?\n\}/, '')),
  'that would put the cost back on every page');

/* ---- 2. the privacy invariant ------------------------------------------- */
const redactRegion = region('const LOG_SECRET_PARAM', 'function logHostOf(');
check('the redactor is where the slice expects it', !!redactRegion);
if (redactRegion) {
  const box = { URL, String, Number };
  vm.createContext(box);
  vm.runInContext(redactRegion + ';globalThis.r = logRedactUrl;', box,
    { filename: 'background.js:logRedactUrl' });
  const r = box.r;

  for (const key of ['token', 'access_token', 'api_key', 'password', 'session', 'sig', 'jwt', 'email']) {
    const out = r('https://x.example/a?' + key + '=hunter2secretvalue&keep=1');
    check('redacts ?' + key, !/hunter2secretvalue/.test(out.url) && /keep=1/.test(out.url), out.url);
  }
  const long = r('https://x.example/a?opaque=' + 'A'.repeat(120));
  check('redacts a long opaque value whatever it is called',
    !/AAAA/.test(long.url) && long.redacted === true, long.url);
  const frag = r('https://x.example/p#access_token=abcdefghijklmnop');
  check('redacts a long fragment', !/abcdefghijklmnop/.test(frag.url), frag.url);
  const plain = r('https://x.example/path?page=2');
  check('leaves an ordinary URL alone', plain.url === 'https://x.example/path?page=2' && !plain.redacted);
  check('an unparseable URL is still truncated, not thrown away',
    typeof r('not a url at all').url === 'string');
  /* The point of redacting at write time rather than at render time. */
  check('redaction runs before the entry is stored',
    /const red = logRedactUrl\(d\.url\);[\s\S]{0,400}url: red\.url,/.test(BG),
    'redacting only on display would still keep the secret in memory');
}
check('the buffer is bounded', /LOG_RING\.length > LOG_MAX/.test(BG) && /const LOG_MAX = \d+/.test(BG));
check('nothing about the log is written to storage',
  !/localSet\(\{[^}]*LOG_RING/.test(BG) && !/wardenone_log/.test(BG),
  'the buffer must die with the worker');
check('the page only writes to disk on an explicit export',
  /id="export"/.test(HTML) && /download = 'wardenone-network-log\.json'/.test(JS));

/* ---- 3. only a real block is reported as a block ------------------------ */
check('a block is claimed only for ERR_BLOCKED_BY_CLIENT',
  /BLOCKED_BY_CLIENT\|BLOCKED_BY_ADMINISTRATOR/.test(BG)
    && /blocked \? 'blocked' : 'failed'/.test(BG),
  'a DNS failure reported as "WardenOne blocked this" would send people hunting a rule that does not exist');

/* ---- 4. rule attribution is exact, and honest when it cannot be --------- */
const sourceRegion = region('let __logRuleBases = null;', '/* Anything that looks like a credential');
check('the attribution map is liftable', !!sourceRegion);
if (sourceRegion) {
  const box2 = { Number, Object };
  vm.createContext(box2);
  /* The real constants, so the map is tested against the ids actually shipped. */
  const bases = {};
  for (const m of BG.matchAll(/const ([A-Z_]*RULE_BASE) = (\d+)/g)) bases[m[1]] = Number(m[2]);
  Object.assign(box2, bases);
  box2.LOG_STATIC_RULESETS = { adshield_easylist: 'AdShield / EasyList', easyprivacy: 'EasyPrivacy' };
  vm.runInContext(sourceRegion + ';globalThis.src = logRuleSource;', box2,
    { filename: 'background.js:logRuleSource' });
  const src = box2.src;

  check('a My Rules id names My Rules', src(bases.USER_RULE_BASE + 3, '_dynamic') === 'My rules');
  check('a blocked-site id names Blocked sites', src(bases.LEARNED_RULE_BASE + 1, '_dynamic') === 'Blocked sites');
  check('a tracker id names tracker blocking', src(bases.TRACKER_RULE_BASE + 9, '_dynamic') === 'Tracker blocking');
  check('an allowlist id names your allowlist', src(bases.ALLOWLIST_RULE_BASE, '_dynamic') === 'Your allowlist');
  check('a static ruleset is named by its list', src(7, 'easyprivacy') === 'EasyPrivacy');
  check('an unknown static ruleset falls back to its id', src(7, 'something-new') === 'something-new');
  /* Ranges must not overlap into the wrong owner. */
  check('an id just below a base belongs to the range beneath it',
    src(bases.USER_RULE_BASE - 1, '_dynamic') !== 'My rules');
}
check('the page says plainly when Chrome will not report the rule',
  /unpacked build/.test(JS) && /exactRules/.test(JS),
  'inventing an attribution would be worse than admitting the limit');
check('exact attribution is gated on the API actually existing',
  /function logRuleFeedbackAvailable\(\)/.test(BG)
    && /if \(logRuleFeedbackAvailable\(\)\)/.test(BG));
check('the permission that enables it is declared',
  (MANIFEST.permissions || []).includes('declarativeNetRequestFeedback'));

/* ---- 5. only an extension page may open the port ------------------------ */
check('a page cannot connect the logger port',
  /if \(!messageSenderIsExtensionPage\(port\.sender\)\)/.test(BG),
  'a website able to open this port could read every URL you visit');

/* ---- 6. the actions feed My Rules, not a private store ------------------ */
check('rules made from a request go into My rules',
  /kind: 'user-rules-get'/.test(JS) && /kind: 'user-rules-set'/.test(JS),
  'a hidden store would make the logger able to change filtering invisibly');
check('it refuses to add a rule twice',
  /already in My rules/.test(JS));
check('the three rule actions are offered',
  /Block this domain/.test(JS) && /Allow this domain/.test(JS) && /Block this path/.test(JS));

/* ---- 7. the page is reachable and shaped as an advanced tool ------------ */
check('the popup opens it in a tab',
  /id="open-logger"/.test(POPUP_HTML) && /chrome\.runtime\.getURL\('logger\.html'\)/.test(POPUP_JS),
  'a popup closes the moment you click away, which would stop capture immediately');
check('it lives behind the advanced dropdown',
  POPUP_HTML.indexOf('id="open-logger"') > POPUP_HTML.indexOf('id="my-filters-drop"'));
check('the page declares its theme scope',
  /data-wardenone-page="logger"/.test(HTML),
  'without it the shared dark theme silently never applies');
check('outcome and type filters are both offered',
  /data-action="blocked"/.test(HTML) && /data-type="xmlhttprequest"/.test(HTML)
    && /data-action="allowed"/.test(HTML));
check('there is a search box', /id="search"/.test(HTML));
check('rows merge by id rather than duplicating',
  /const seen = BY_ID\.get\(e\.id\);/.test(JS),
  'a request is reported twice -- when it starts and when it settles');

if (failed) {
  console.error('network logger: ' + failed + ' failed');
  process.exit(1);
}
console.log('network logger: all checks passed');

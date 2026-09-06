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
/* Sliced to the function body, not matched with an open-ended [\s\S]*? -- that
   version passed with the line deleted, because it ran on past the closing brace
   and found the identical line in the 'clear' handler below. */
const detachBody = region('function logDetach() {', NL + '}');
check('logDetach is where the slice expects it', !!detachBody);
check('the buffer is dropped when the last logger tab closes',
  detachBody.includes('LOG_RING.length = 0;'),
  'a list of every URL you loaded must not outlive the window opened to look at it');
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
  const box2 = { Number, Object, Set };
  vm.createContext(box2);
  /* The real constants, so the map is tested against the ids actually shipped. */
  const bases = {};
  for (const m of BG.matchAll(/const ([A-Z_]*RULE_BASE) = (\d+)/g)) bases[m[1]] = Number(m[2]);
  Object.assign(box2, bases);
  box2.LOG_STATIC_RULESETS = { adshield_easylist: 'AdShield / EasyList', easyprivacy: 'EasyPrivacy' };
  vm.runInContext(sourceRegion + ';globalThis.src = logRuleSource;globalThis.canBlock = logRuleCanBlock;',
    box2, { filename: 'background.js:logRuleSource' });
  const src = box2.src;
  const canBlock = box2.canBlock;

  check('a My Rules id names My Rules', src(bases.USER_RULE_BASE + 3, '_dynamic') === 'My rules');
  check('a blocked-site id names Blocked sites', src(bases.LEARNED_RULE_BASE + 1, '_dynamic') === 'Blocked sites');
  check('a tracker id names tracker blocking', src(bases.TRACKER_RULE_BASE + 9, '_dynamic') === 'Tracker blocking');
  check('an allowlist id names your allowlist', src(bases.ALLOWLIST_RULE_BASE, '_dynamic') === 'Your allowlist');
  check('a static ruleset is named by its list', src(7, 'easyprivacy') === 'EasyPrivacy');
  check('an unknown static ruleset falls back to its id', src(7, 'something-new') === 'something-new');
  /* Ranges must not overlap into the wrong owner. */
  check('an id just below a base belongs to the range beneath it',
    src(bases.USER_RULE_BASE - 1, '_dynamic') !== 'My rules');

  /* Chrome's matched-rule feed names the rule but never says what it DID, so a rule
     that lets requests through must never be offered as the reason one was blocked. */
  check('a static block list may explain a block', canBlock(7, 'easyprivacy') === true);
  check('a My Rules id may explain a block',
    canBlock(bases.USER_RULE_BASE + 3, '_dynamic') === true);
  check('an allowlist rule may not explain a block',
    canBlock(bases.ALLOWLIST_RULE_BASE + 2, '_dynamic') === false,
    'blocked by: your allowlist is a wrong answer wearing an exact answer clothes');
  check('a login-compatibility allowance may not explain a block',
    canBlock(bases.LOGIN_COMPAT_RULE_BASE + 1, '_dynamic') === false);
  check('a never-block allowance may not explain a block',
    canBlock(bases.NEVER_BLOCK_ALLOW_RULE_BASE + 1, '_dynamic') === false);
}

/* Chrome reports matched rules to a PACKAGED build too: getMatchedRules is gated on a
   permission, not on being unpacked -- it is onRuleMatchedDebug that is dev-only. What
   it will not give is a request id, so the poll may only claim a row it can prove. */
check('a packaged build still asks Chrome which rules matched',
  /chrome\.declarativeNetRequest\.getMatchedRules\(/.test(BG)
    && /function logMatchedRulesAvailable\(\)/.test(BG),
  'exact-or-nothing throws away attribution Chrome will give a store build');
check('the poll runs only when the exact feed is missing',
  /\} else if \(logMatchedRulesAvailable\(\)\) \{/.test(BG),
  'polling alongside onRuleMatchedDebug spends quota to re-derive a worse answer');
{
  const poll = Number((/const LOG_MATCH_POLL_MS = (\d+)/.exec(BG) || [])[1]);
  check('the poll interval stays inside the getMatchedRules quota', poll >= 30000,
    'Chrome allows 20 calls per 10 minutes; under 30s trips it and attribution stops dead');
}
check('the poll timer is cleared when the last logger closes',
  /clearInterval\(LOG_MATCH_TIMER\)/.test(BG));
check('the poll asks whether the rule could block before naming a row',
  /logRuleCanBlock\(rule\.ruleId, rule\.rulesetId\)[\s\S]{0,120}logSoleBlockedNear\(/
    .test(region('async function logPollMatchedRules(', 'function logAttach()')),
  'a correct blocking check that nothing calls is the same as not having one');
check('the matched-list tally dies with the buffer',
  /LOG_MATCH_TALLY\.clear\(\);/.test(region('function logDetach()', 'A port, not a message')),
  'a record of which lists fired must not outlive the window that collected it');

/* The join itself. Two blocked rows in one tab inside the window means neither can be
   named -- picking one would be a coin flip presented as attribution. */
const nearRegion = region('function logSoleBlockedNear(', 'function logSendMatchedLists(');
check('the sole-candidate join is liftable', !!nearRegion);
if (nearRegion) {
  const box3 = { Number, Math, LOG_MATCH_WINDOW_MS: 1500, LOG_RING: [] };
  vm.createContext(box3);
  vm.runInContext(nearRegion + ';globalThis.sole = logSoleBlockedNear;', box3,
    { filename: 'background.js:logSoleBlockedNear' });
  const sole = box3.sole;
  const at = 1000000;
  const row = (over) => Object.assign({ at, action: 'blocked', rule: '', tabId: 7 }, over);
  const ring = (...rows) => { box3.LOG_RING.length = 0; box3.LOG_RING.push(...rows); };

  ring(row({}));
  check('one blocked row in the window owns the match', sole(7, at) === box3.LOG_RING[0]);
  ring(row({}), row({ at: at + 20 }));
  check('two candidates means neither is named', sole(7, at) === null,
    'picking one of two would be a coin flip presented as attribution');
  ring(row({ tabId: 9 }));
  check('a row in another tab is not a candidate', sole(7, at) === null);
  ring(row({ action: 'allowed' }));
  check('an allowed row is never given a blocking rule', sole(7, at) === null);
  ring(row({ at: at - 9000 }));
  check('a row older than the window is not a candidate', sole(7, at) === null);
  /* The poll runs up to 40s behind, so rows NEWER than the match keep arriving. That
     side of the window needs its own guard: the scan stops early on old rows only. */
  ring(row({ at: at + 9000 }));
  check('a row newer than the window is not a candidate', sole(7, at) === null);
  ring(row({ rule: '42' }));
  check('a row that already has a rule is not overwritten', sole(7, at) === null);
}

check('the page distinguishes an exact rule from a correlated one',
  /nearRules/.test(JS) && /matched by tab and time/.test(JS),
  'a near match shown like an exact one is the invented attribution this page exists to avoid');
check('the packaged-build note is its own sentence, not the unpacked one',
  /function paintExactNote\(\)/.test(JS) && /A packaged build gets matched rules/.test(JS));
check('the export records how a rule was matched',
  /ruleMatch: e\.rule \?/.test(JS),
  'an export without it reads every rule as an exact match on that request');
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
check('the rule actions are offered',
  /Block this host/.test(JS) && /Allow this host/.test(JS) && /Block this path/.test(JS));
/* ||host^ covers the host and what is under it, never its parent or siblings.
   Naming that "block this domain" reads as wider than it is. */
check('host scope and domain scope are offered as separate actions',
  /Block all of/.test(JS) && /e\.base && e\.base !== domain/.test(JS)
    && !/Block this domain/.test(JS),
  'one button cannot honestly mean both blast radii');
check('the worker supplies the parent domain the page offers',
  /base: registrableDomainBg\(logHostOf\(d\.url\)\)/.test(BG),
  'the page has no public-suffix list of its own to derive it from');

/* ---- 8. pause holds; it does not discard ------------------------------- */
check('what arrives during a pause is held rather than dropped',
  /if \(paused\) \{ hold\(msg\.entries \|\| \[\]\); return; \}/.test(JS)
    && /if \(held\.length\) \{ ingest\(held\); held = \[\]; \}/.test(JS),
  'the paused label promises capture continues, so losing those entries would make it a lie');
check('the held backlog is bounded too', /const HELD_MAX = \d+/.test(JS) && /heldDropped/.test(JS));
/* There are two ways the table empties -- the button, and a 'cleared' message
   from the worker -- and BOTH have to drop the backlog, or Clear gets undone by
   the next Resume. Counting is what makes this catch the one that was missed. */
check('every path that empties the table also empties the backlog',
  (JS.match(/BY_ID\.clear\(\)/g) || []).length > 0
    && (JS.match(/BY_ID\.clear\(\)/g) || []).length
       === (JS.match(/BY_ID\.clear\(\); held = \[\]/g) || []).length,
  'a clear that leaves the backlog behind is undone by the next Resume');

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

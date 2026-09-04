/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The right-click checks: "Check where this link goes", "Check <selection>" and
 * "What is this embedded frame?".
 *
 * These route existing engines to a question the reader asked, about something
 * they have not visited yet. The suite runs the SHIPPED routing against stubbed
 * lookups, so it tests what the worker actually does rather than a description
 * of it, and it asserts the two properties that make the feature trustworthy:
 * the classifier does not guess, and an answer always comes back.
 *
 * Run: node tools/test-context-checks.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const NL = String.fromCharCode(10);

let pass = 0;
const failures = [];
/* Checks that need to await the shipped async helpers. */
const deferred = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ---- every entry, every right-click ------------------------------------- *
 * These were scoped to link/selection/frame at first, which made the menu
 * shorter but unpredictable: the entry you wanted was missing depending on the
 * pixel you were over, and a menu whose contents move is one you cannot learn.
 * They are all present now, and each says plainly when it had nothing to work on. */
check('there is one parent menu', /id: WO_MENU_ROOT, title: 'WardenOne'/.test(BG));
check('every entry is offered on every right-click',
  /const everywhere = \['all'\]/.test(BG)
    /* One helper builds every item, so the contexts cannot differ between them. */
    && /const item = \(id, title\) => add\(\{ id, parentId: WO_MENU_ROOT, title, contexts: everywhere/.test(BG)
    && ['WO_MENU_ZAP', 'WO_MENU_COPY_LINK', 'WO_MENU_LINK', 'WO_MENU_SELECTION', 'WO_MENU_MEDIA', 'WO_MENU_FRAME', 'WO_MENU_BLOCK']
      .every((id) => new RegExp('item\\(' + id + ',').test(BG)),
  'an entry is still scoped to one kind of click');

/* ---- the submenu is ruled into groups ----------------------------------- *
 * Six lines of plain text made the reader sort out every time which of them was
 * an action, which was a question and which changed the site. The rules do that
 * once. */
check('the groups are separated by real menu rules',
  /const rule = \(id\) => add\(\{ id, parentId: WO_MENU_ROOT, type: 'separator'/.test(BG)
    && (BG.match(/rule\('wardenone-sep-/g) || []).length === 2);
check('the two actions are one group, above the questions',
  /item\(WO_MENU_ZAP, 'Zap this element'\);\s*item\(WO_MENU_COPY_LINK, 'Copy clean link'\);\s*rule\('wardenone-sep-checks'\)/.test(BG),
  'zapping and copying both do something; the four below only ask');
check('the four checks are one group',
  /rule\('wardenone-sep-checks'\)[\s\S]{0,600}item\(WO_MENU_LINK[\s\S]{0,400}item\(WO_MENU_FRAME[\s\S]{0,200}rule\('wardenone-sep-site'\)/.test(BG));
check('and the site decision is last, on its own',
  /rule\('wardenone-sep-site'\)[\s\S]{0,300}item\(WO_MENU_BLOCK/.test(BG));
check('no entry is scoped to a single context any more',
  !/contexts: linkOnly|contexts: selectionOnly|contexts: frameOnly/.test(BG));
/* Offered everywhere, so the link check has to cope with a click that was not on
   a link rather than doing nothing at all. */
check('the link check falls back to the page when there is no link',
  /runWardenManualCheck\(info\.linkUrl \|\| info\.pageUrl \|\| \(tab && tab\.url\), tab\)/.test(BG));
check('each entry is wired to a handler',
  /WO_MENU_LINK\)/.test(BG) && /runWardenManualCheck\(info\.linkUrl/.test(BG)
    && /runWardenManualCheck\(info\.selectionText/.test(BG)
    && /WO_MENU_FRAME\) \{ void describeWardenFrame\(info/.test(BG));

/* ---- the answer has to be somewhere the reader looks -------------------- *
 * A Chrome system notification was the first attempt and it is the wrong
 * channel: on Windows those are routinely swallowed by focus assist, so the
 * check appeared to do nothing at all. The answer is WardenOne's own toast now,
 * raised through the same wo-event every other notice uses -- which also means
 * the Notification Centre governs its timing and it lands in history. */
check('the answer is raised as a WardenOne toast',
  /new CustomEvent\('wo-event'/.test(BG) && /type: 'detected_manual_check'/.test(BG));
check('the toast type exists in the engine, or showToast drops it',
  /detected_manual_check:\{/.test(fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8')));
check('the tray is kept only as the fallback',
  /catch \(_\) \{ \/\* fall through to the tray \*\/ \}/.test(BG)
    && /return showWardenSystemNotification\(/.test(BG));
/* Parsed rather than counted. This was an arithmetic check -- occurrences of one
   string minus a magic three -- which broke the moment a caller was added and
   told me nothing about which call site was wrong. */
{
  const bad = [];
  let at = BG.indexOf('await wardenManualNotice(');
  while (at >= 0) {
    let depth = 0;
    let i = BG.indexOf('(', at);
    const open = i;
    for (; i < BG.length; i++) {
      if (BG[i] === '(') depth++;
      else if (BG[i] === ')') { depth--; if (!depth) break; }
    }
    const args = BG.slice(open + 1, i).replace(/\s+/g, ' ').trim();
    if (!/,\s*tab$/.test(args)) bad.push(args.slice(0, 60));
    at = BG.indexOf('await wardenManualNotice(', i);
  }
  check('every answer is given the tab it should appear on', !bad.length,
    'these would fall back to the tray for want of a tab: ' + bad.join(' | '));
}

/* ---- a selected IP address ---------------------------------------------- *
 * This branch used to admit it had no lookup. AbuseIPDB was already wired in for
 * page loads, so the work was routing, not a new provider. */
check('an IP goes to the provider that already exists',
  /const verdict = await abuseIpDbLookupIp\(ip\);/.test(BG));
/* normalizeIpLiteral is the engine's own filter and rejects every private and
   reserved range. The regex that used to be here missed CGNAT, the TEST-NETs and
   multicast, and sending one of those spends a request to be told what we knew. */
check('private and reserved ranges are filtered by the engine, not a second regex',
  /const ip = normalizeIpLiteral\(found\.value\);/.test(BG)
    && !/\^\(10\\.\|127\\.\|192\\.168\\./.test(BG));
check('a filtered address is explained rather than looked up',
  /private or reserved address, so it has no public reputation/.test(BG));
/* Three states the reader can act on, kept apart: off, broken, answered. */
check('the provider being off is distinguished from it failing',
  /verdict\.enabled === false/.test(BG) && /Turn on AbuseIPDB and add a free key/.test(BG)
    && /AbuseIPDB did not answer/.test(BG));
/* The same score gets the same words here as in a page warning. */
check('the verdict is phrased by the engine helper, not restated',
  /abuseIpDbRiskText\(verdict\)/.test(BG));
check('who the address belongs to is reported',
  /\[verdict\.isp, verdict\.usageType, verdict\.countryCode\]/.test(BG));
check('and a cached answer says so',
  /if \(verdict\.cached\) lines\.push\('\(from a cached answer\)'\)/.test(BG));

/* ---- where is this image from? ------------------------------------------ *
 * The question a page cannot answer for you. Media carries its own source, and
 * on a modern page that is very often a domain you have never heard of sitting
 * inside one you trust. Chrome hands the real srcUrl to the menu. */
check('there is a media entry', /item\(WO_MENU_MEDIA, 'Where is this image from\?'\)/.test(BG)
  && /checkWardenMedia\(info, tab\)/.test(BG));
check('it reads the real source, not the page',
  /const src = String\(\(info && info\.srcUrl\) \|\| ''\);/.test(BG));
/* The third-party line comes first and is always present: reputation may have
   nothing to say, but "this is served from somewhere else" always does. */
check('whose it is comes before what is known about them',
  /lines\.push\(sameSite[\s\S]{0,200}Served from ' \+ host \+ ', not by '/.test(BG));
check('a subdomain of the page counts as the same site',
  /host\.endsWith\('\.' \+ pageHost\) \|\| pageHost\.endsWith\('\.' \+ host\)/.test(BG));
/* Built into the page rather than fetched: there is no third party to name and
   nothing to look up, and saying so beats a failed lookup. */
check('an inline data: or blob: source is explained, not looked up',
  /\^\(data\|blob\):/.test(BG) && /built into the page itself/.test(BG));
check('the noun matches what was right-clicked',
  /kind === 'video' \? 'video' : \(kind === 'audio' \? 'audio' : 'image'\)/.test(BG));
/* One set of questions, asked the same way by both checks. Two copies would
   drift the moment one of them gained a provider. */
check('the media and link checks share one findings helper',
  /async function wardenHostFindings\(host, url, cfg\)/.test(BG)
    && (BG.match(/wardenHostFindings\(/g) || []).length >= 3);

/* ---- block / unblock the current site ----------------------------------- *
 * One entry, not two. Two entries means one of them is always the wrong answer
 * for the page in front of you and neither says which, so the title is rewritten
 * from the real state before the menu is drawn. */
check('there is a single block entry', /item\(WO_MENU_BLOCK, 'Block this site'\)/.test(BG)
  && !/Unblock this site'/.test(BG));
check('its title is rewritten from the real state',
  /function refreshWardenBlockMenuTitle\(tab, info\)/.test(BG)
    && /chrome\.contextMenus\.update\(WO_MENU_BLOCK, \{ title \}/.test(BG));
check('and refreshed on a tab switch',
  /chrome\.tabs\.onActivated\.addListener[\s\S]{0,220}refreshWardenBlockMenuTitle/.test(BG));
check('and on a navigation within the tab you are on',
  /if \(change && \(change\.url \|\| change\.status === 'complete'\) && tab && tab\.active === true\) \{\s*void refreshWardenBlockMenuTitle\(tab\);/.test(BG),
  'a same-URL reload into the error page changes no url, so status complete must also refresh it');
/* tabs.onUpdated cannot be filtered in Chrome, so each listener is another wake
   of a 760KB service worker on every title, favicon and audible tick of a
   playing tab. The menu title rides an existing one instead of adding a third. */
check('the menu title did not bring its own tab-update listener',
  (BG.match(/chrome\.tabs\.onUpdated\.addListener/g) || []).length === 2,
  'reuse an existing listener rather than registering another');
/* The entry read "Block this site (not a normal page)" on an ordinary page.
   chrome.tabs.get calls back with undefined whenever it errors -- a sleeping
   worker is enough -- and that undefined was handed straight to the refresh,
   which then mislabelled the entry for the rest of the session. */
check('a tab lookup that failed does not relabel the entry',
  /if \(chrome\.runtime\.lastError \|\| !tab\) return;/.test(BG),
  'passing the undefined through is what produced "(not a normal page)"');
check('and the refresh asks Chrome itself before giving up',
  /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}/.test(BG),
  'concluding "not a normal page" from a tab we were never given');
/* Chrome fires no event when a context menu opens, so the page says so. */
check('the page reports the right-click',
  /woOn\(window, 'contextmenu'/.test(BRIDGE)
    && /kind: 'menu-opening'/.test(BRIDGE));
check('and the worker accepts and rate-limits that kind',
  /'menu-opening',/.test(BG) && /'menu-opening': \{ max: \d+, windowMs: \d+ \}/.test(BG),
  'a kind missing from either table is dropped before its handler runs');
check('the host comes from the sender tab, never from the message',
  /refreshWardenBlockMenuTitle\(sender && sender\.tab,/.test(BG),
  'a page must not be able to name a different site');

/* A site you blocked yourself has to actually be blocked.

   YouTube, youtu.be and youtube-nocookie each carry an allowAllRequests on
   main_frame so WardenOne's own blocking cannot break playback. That is there to
   stop US breaking a site, not to overrule the reader -- but the learned block
   sat below it, so "Block this site" on YouTube saved the rule, reported success,
   and the page loaded normally. Both numbers are read from the source here, so
   moving either one without the other fails rather than silently re-breaking it. */
{
  const compat = BG.slice(BG.indexOf('const frameAllowRules = ['), BG.indexOf('const pairs = ['));
  const compatPriority = Number((compat.match(/priority: (\d+)/) || [])[1]);
  const userPriority = Number((BG.match(/userBlocked\) \? (\d+) : 2000/) || [])[1]);
  check('the YouTube compatibility allow still covers the whole frame',
    /action: \{ type: 'allowAllRequests' \}/.test(compat)
      && /'main_frame'/.test(compat) && compatPriority > 0);
  check('a site you blocked yourself outranks it',
    userPriority > compatPriority,
    'a block below the compat allow is saved, reported, and then ignored');
  check('and a block WardenOne worked out on its own does not',
    /userBlocked\) \? \d+ : 2000/.test(BG),
    'compatibility should still win over a guess');
  check('the block still covers the top-level navigation',
    /resourceTypes: \['main_frame', 'sub_frame', 'image'/.test(BG));
}

/* Written to the store the engine's own detections use, so a site blocked here
   appears in Activity beside them and is undone by the same Forget button. A
   parallel "user blocked" list would be a second thing to keep in step. */
check('it uses the same learned-block store the engine does',
  /LEARNED\[host\] = \{/.test(BG) && /localSet\(\{ wardenone_learned: LEARNED \}\)/.test(BG)
    && /applyLearnedRules\(\);/.test(BG));
/* ---- a block that cannot take effect must not claim to ------------------ *
 * applyLearnedRules silently drops a learned domain when the site is allowlisted,
 * and writes no rules at all when WardenOne is off. Verified both: the rule count
 * goes to zero and nothing says so. The menu used to answer "Blocked." either
 * way, which is the worst kind of wrong -- it is false AND it stops you looking
 * any further. This is why blocking appeared to do nothing on an allowlisted
 * site. */
check('the obstacles are checked before the claim is made',
  /async function wardenBlockObstacle\(host\)/.test(BG)
    && /const obstacle = await wardenBlockObstacle\(host\);[\s\S]{0,140}wardenManualNotice\(host, obstacle, tab\)/.test(BG));
/* Run the real helper against config variants. Asserting the MESSAGE exists in
   the source proves only that the string is there -- both of these passed with
   the branch that produces them disabled, which is precisely the bug they are
   meant to catch. */
{
  const obstacleSrc = BG.slice(BG.indexOf('async function wardenBlockObstacle(host) {'),
    BG.indexOf(NL + '}' + NL, BG.indexOf('async function wardenBlockObstacle(host) {')) + 3);
  const ask = (cfg) => {
    const box = {
      Object, String, console,
      DEFAULT_CONFIG: { enabled: true },
      localGet: async () => ({ wardenone_config: cfg }),
      activeAllowlist: (c) => (c.allowlist || []),
      hostMatchesAllowlist: (d, list) => (list || []).some((x) => d === x || d.endsWith('.' + x)),
    };
    vm.createContext(box);
    vm.runInContext(obstacleSrc + NL + 'globalThis.__ask = wardenBlockObstacle;', box);
    return box.__ask('twitch.tv');
  };
  deferred.push(async () => {
    const clean = await ask({ enabled: true, allowlist: [] });
    check('a blockable site reports no obstacle', clean === '', JSON.stringify(clean));
    const allowed = await ask({ enabled: true, allowlist: ['twitch.tv'] });
    check('an allowlisted site is refused, with the remedy',
      /allowlist, which beats a block\. Remove it there first/.test(allowed), JSON.stringify(allowed));
    const off = await ask({ enabled: false, allowlist: [] });
    check('WardenOne being off is refused, and named',
      /switched off, so nothing is being blocked/.test(off), JSON.stringify(off));
    const sub = await ask({ enabled: true, allowlist: ['tv'] });
    check('an allowlisted parent domain counts', sub !== '', JSON.stringify(sub));
  });
}

check('and the menu entry says so before it is chosen',
  /title = obstacle \? 'Cannot block ' \+ host \+ ' yet' : 'Block ' \+ host;/.test(BG));

/* ---- the change has to be visible --------------------------------------- *
 * A DNR rule only applies to the next request, so a page already on screen
 * carries on exactly as before -- which is what "it does not work" looks like
 * when you are watching a stream. */
check('every outcome that changed something reloads the tab',
  /function wardenReloadAfterSiteChange\(tab\)/.test(BG)
    && (BG.match(/wardenReloadAfterSiteChange\(tab\);/g) || []).length === 3,
  'unblock, a fresh block, and re-asserting one that was already blocked');
check('and re-asserting only reloads when the rule is genuinely live',
  /if \(stillLive\) wardenReloadAfterSiteChange\(tab\);/.test(BG),
  'reloading into a page that is not actually blocked is the old lie again');
check('and the answer is on screen before the tab moves',
  /await wardenManualNotice\([\s\S]{0,220}\n\s*wardenReloadAfterSiteChange\(tab\);/.test(BG));

check('and says the block was yours, not something WardenOne worked out',
  /reason: 'you blocked this site'/.test(BG) && /userBlocked: true/.test(BG));
/* Removing a shipped blocklist entry from LEARNED would do nothing, so claiming
   to have unblocked it would be a lie. */
check('a shipped blocklist entry is not pretended to be toggleable',
  /if \(BLOCKED_DOMAINS\.has\(host\) && !LEARNED\[host\]\)/.test(BG)
    && /Already blocked by a protection list/.test(BG));

/* ---- the classifier ------------------------------------------------------ */
const kindStart = BG.indexOf('function wardenIndicatorKind(raw) {');
const kindSrc = BG.slice(kindStart, BG.indexOf(NL + '}' + NL, kindStart) + 3);
const wardenIndicatorKind = new Function(kindSrc + NL + 'return wardenIndicatorKind;')();

const kindOf = (v) => { const r = wardenIndicatorKind(v); return (r && r.kind) || null; };
for (const [input, want] of [
  ['https://example.com/a?utm_source=x', 'url'],
  ['http://1.2.3.4/path', 'url'],
  ['example.com', 'domain'],
  ['www.example.co.uk', 'domain'],
  ['  paypa1-secure.example  ', 'domain'],
  ['192.168.1.1', 'ip'],
  ['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256'],
  ['da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha1'],
  /* The negatives are the point. A classifier that guesses sends nonsense to a
     reputation provider and hands back an answer about nothing. */
  ['999.1.1.1', null],
  ['notes.txt', null],
  ['v1.2', null],
  ['hello world', null],
  ['', null],
  ['ftp://example.com', null],
  ['javascript:alert(1)', null],
]) {
  check('classifies ' + JSON.stringify(input).slice(0, 40) + ' as ' + want,
    kindOf(input) === want, 'got ' + kindOf(input));
}
check('an over-long selection is refused rather than sent anywhere',
  kindOf('a'.repeat(3000)) === null);

/* ---- the routing, running the shipped code ------------------------------- */
function runtime() {
  const notices = [];
  const region = kindSrc
    /* "async function", not "function" -- slicing from the shorter string starts
       after the async keyword and produces a body with a bare await in it. */
    + BG.slice(BG.indexOf('async function wardenManualNotice('),
      BG.indexOf(NL + 'function startElementTool(tab, frameId) {'));
  const sandbox = {
    URL, Set, Object, Array, Number, String, Math, Date, JSON, console, Boolean,
    MALWARE_HASHES: new Set(['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']),
    DEFAULT_CONFIG: {},
    localGet: async () => ({}),
    /* The toast is raised by injecting into the tab. The test records what would
       have been injected instead of running it, so both delivery paths are
       visible: `via` says which one answered. */
    chrome: {
      scripting: {
        executeScript: async (opts) => {
          notices.push({ via: 'toast', message: String((opts.args || [])[0] || ''), type: 'manual_check' });
          return [];
        },
      },
    },
    showWardenSystemNotification: async (id, opts, type) => {
      notices.push({ via: 'tray', title: opts.title, message: opts.message, type });
      return true;
    },
    urlReputationConfig: async () => ({ enabled: true }),
    normalizeSafeBrowsingUrl: (u) => u,
    urlReputationLookupUrl: async (url) => ({ ok: true, hit: /paypa1/.test(url), provider: 'Test provider' }),
    lookupDomainAge: async (host) => (host === 'brand-new.example'
      ? { ok: true, ageDays: 4 } : { ok: true, ageDays: 4000 }),
    /* The engine's own private/reserved filter, and the IP provider it already
       uses for page loads. Stubbed rather than reimplemented: the point is which
       branch the routing takes, not whether AbuseIPDB is reachable from here. */
    normalizeIpLiteral: (v) => (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.6[4-9]\.)/.test(String(v)) ? '' : String(v)),
    abuseIpDbRiskText: (r) => {
      const score = Number(r && r.score) || 0;
      if (score >= 75) return 'high-risk abusive IP (' + score + '% confidence)';
      if (score >= 25) return 'suspicious IP (' + score + '% confidence)';
      return 'low-risk IP (' + score + '% confidence)';
    },
    abuseIpDbLookupIp: async (ip) => (ip === '203.0.113.7'
      ? { enabled: true, ok: true, score: 90, totalReports: 12, isp: 'Bad Host', countryCode: 'RU' }
      : { enabled: true, ok: true, score: 0, totalReports: 0, isp: 'Example ISP', countryCode: 'US' }),
  };
  vm.createContext(sandbox);
  vm.runInContext(region, sandbox, { filename: 'background.js:manual-check' });
  return {
    notices,
    ask: (text, tab) => vm.runInContext('runWardenManualCheck(' + JSON.stringify(text) + ','
      + JSON.stringify(tab || { id: 1, url: 'https://news.example/story' }) + ')', sandbox),
    frame: (frameUrl, pageUrl) => vm.runInContext('describeWardenFrame('
      + JSON.stringify({ frameUrl }) + ',' + JSON.stringify({ id: 1, url: pageUrl }) + ')', sandbox),
  };
}

(async () => {
  const r = runtime();
  const last = () => r.notices[r.notices.length - 1] || null;

  await r.ask('https://paypa1-secure.example/login');
  check('a flagged link says so', /Flagged by/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('brand-new.example');
  check('a young domain is called out', /only 4 days old/.test((last() || {}).message || ''),
    JSON.stringify(last()));

  await r.ask('https://example.com/a');
  check('a clean link still gets an answer',
    /Not on any reputation list/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('192.168.1.1');
  check('a private address is not sent to a provider',
    /private or reserved address/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('203.0.113.7');
  check('a reported address is named as high risk',
    /high-risk abusive IP \(90% confidence\)/.test((last() || {}).message || ''), JSON.stringify(last()));
  check('and says who it belongs to',
    /Bad Host . RU/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('8.8.8.8');
  check('a clean address still gets an answer',
    /low-risk IP/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  check('a known-bad hash is named as such',
    /known-malware list\. Do not run/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('a'.repeat(64));
  check('an unknown hash is not called safe',
    /not proof it is safe/.test((last() || {}).message || ''), JSON.stringify(last()));

  /* The bundled set is SHA-256 only, so anything else must say it cannot answer
     rather than return a clean-looking "not found" it did not earn. */
  await r.ask('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  check('a SHA-1 is told it cannot be answered',
    /only keeps SHA-256/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.ask('have a look at this');
  check('prose is refused clearly',
    /not a link, domain, IP address or file hash/.test((last() || {}).message || ''), JSON.stringify(last()));

  await r.frame('https://ads.weird.xyz/f', 'https://news.example/story');
  check('a third-party frame names its real origin',
    /embedded from ads\.weird\.xyz, not from news\.example/.test((last() || {}).message || ''),
    JSON.stringify(last()));

  await r.frame('https://news.example/embed', 'https://news.example/story');
  check('a same-site frame says so plainly',
    /belongs to the site you are on/.test((last() || {}).message || ''), JSON.stringify(last()));

  /* Every branch answers. A check that goes quiet when it finds nothing is
     indistinguishable from one that never ran. */
  check('every question got exactly one answer', r.notices.length === 12,
    r.notices.length + ' answers for 12 questions');
  check('every answer is filed under the category that governs it',
    r.notices.every((n) => n.type === 'manual_check'));
  /* The toast is the answer, not the tray. If these start coming back as "tray"
     the feature has quietly gone back to the channel Windows swallows. */
  check('the answers arrive as in-page toasts',
    r.notices.every((n) => n.via === 'toast'),
    r.notices.filter((n) => n.via !== 'toast').length + ' fell back to the tray');

  /* And the tray still catches the case the toast genuinely cannot reach. */
  const noTab = runtime();
  await noTab.ask('example.com', { id: 1, url: 'chrome://extensions' });
  check('a page that refuses injection still gets an answer',
    noTab.notices.length === 1 && noTab.notices[0].via === 'tray',
    JSON.stringify(noTab.notices));

  /* ---- blocking a site actually blocks it -------------------------------- *
   * "Block this site" refused with "this is not an ordinary web page" while the
   * reader was plainly on one. The host was read only from tab.url, and Chrome
   * does not always hand a context-menu listener a tab -- while info.pageUrl is
   * always there, which is what every other entry in this menu already reads.
   * Run the shipped toggle rather than checking the source says the right words. */
  {
    const NL2 = String.fromCharCode(10);
    const starts = ['async function wardenBlockObstacle(', 'function wardenSiteHostFromTab(']
      .map((n) => BG.indexOf(n)).filter((i) => i >= 0);
    /* wardenBlockRuleLive lives next to applyLearnedRules, well away from the
       rest of this, so it is lifted on its own and appended. */
    const liveAt = BG.indexOf('async function wardenBlockRuleLive(host) {');
    /* Both of these sit next to applyLearnedRules, well away from the rest, so
       they are lifted on their own and appended. */
    const pickFn = (sig) => {
      const a = BG.indexOf(sig);
      return a < 0 ? '' : BG.slice(a, BG.indexOf(NL2 + '}' + NL2, a) + 3);
    };
    const liveFn = pickFn('async function wardenBlockRuleLive(host) {');
    const dropFn = pickFn('async function wardenDropSiteWorker(host) {');
    check('the block verifier is still where the test expects it', liveAt >= 0 && !!liveFn);
    check('and the service-worker drop is too', !!dropFn);
    const region = BG.slice(Math.min.apply(null, starts),
      BG.indexOf(NL2 + 'function startElementTool(tab, frameId) {'))
      + NL2 + liveFn + NL2 + dropFn;
    const build = (opts) => {
      opts = opts || {};
      const notices = []; const reloads = []; const wiped = [];
      const sb = {
        URL, Object, String, Date, Number, console, Set, JSON,
        LEARNED: {}, BLOCKED_DOMAINS: new Set(),
        WO_MENU_BLOCK: 'b', DEFAULT_CONFIG: { enabled: true },
        normalizeLearnedDomain: (h) => String(h || '').toLowerCase().replace(/^www\./, ''),
        /* The menu reads the host through this one, so the sandbox needs it too. */
        normalizeUserBlockDomain: (h) => String(h || '').toLowerCase().replace(/^www\./, ''),
        securityStoresReady: async () => {},
        localSet: async () => {},
        localGet: async () => ({ wardenone_config: { enabled: true, allowlist: [] } }),
        applyLearnedRules: () => {}, refreshListMetaCounts: () => {},
        activeAllowlist: (c) => c.allowlist || [],
        hostMatchesAllowlist: (d, l) => (l || []).some((x) => d === x || d.endsWith('.' + x)),
        setTimeout: (fn) => { try { fn(); } catch (_) {} return 1; },
        chrome: { contextMenus: { update: (id, o) => { sb.__title = o.title; } }, runtime: { lastError: null },
                  tabs: { query: (q, cb) => cb([{ id: 1, url: 'https://www.youtube.com/' }]),
                          reload: (id, opts) => { reloads.push(opts || {}); } } },
      };
      sb.applyLearnedRules = async () => (opts.applyFails
        ? { ok: false, error: 'rule budget exceeded' } : { ok: true, count: 1 });
      sb.chrome.browsingData = {
        remove: async (filter, types) => {
          wiped.push({ origins: filter.origins || [], types: Object.keys(types) });
        },
      };
      /* Durable offer lives here, surviving the worker eviction the error page
         causes. Seed it via opts.offer to model a given menu state. */
      const sess = opts.offer
        ? { wardenone_block_offer: opts.offer } : {};
      sb.chrome.storage = sb.chrome.storage || {};
      sb.chrome.storage.session = {
        get: async (k) => ({ [k]: sess[k] }),
        set: async (o) => { Object.assign(sess, o); },
      };
      sb.chrome.declarativeNetRequest = {
        getDynamicRules: async () => (opts.ruleLands === false ? [] : [{
          id: 700000, action: { type: 'block' },
          condition: { requestDomains: ['youtube.com'], resourceTypes: ['main_frame', 'sub_frame'] },
        }]),
      };
      sb.wardenManualNotice = async (t, m) => { notices.push(t + ' :: ' + m); return true; };
      vm.createContext(sb);
      vm.runInContext(region.replace(/async function wardenManualNotice[\s\S]*?\n\}\n/, ''), sb,
        { filename: 'background.js:block' });
      return { sb, notices, wiped, reloads, reloaded: () => reloads.length > 0,
        bypassed: () => reloads.some((o) => o && o.bypassCache === true),
        refresh: (tab) => vm.runInContext('refreshWardenBlockMenuTitle('
          + JSON.stringify(tab) + ',null)', sb).then(() => sb.__title),
        toggle: (tab, info) => vm.runInContext('toggleWardenSiteBlock('
          + JSON.stringify(tab === undefined ? null : tab) + ',' + JSON.stringify(info) + ')', sb) };
    };
    const blocked = (r) => !!r.sb.LEARNED['youtube.com'];

    let r = build();
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('blocking a site you are on records the block', blocked(r), r.notices[0]);

    r = build();
    await r.toggle({ id: 1 }, { pageUrl: 'https://www.youtube.com/' });
    check('and still does when Chrome hands over no tab url', blocked(r),
      'this is the case that refused with "not an ordinary web page"');

    r = build();
    await r.toggle(null, { pageUrl: 'https://www.youtube.com/feed/subscriptions' });
    check('and when there is no tab object at all', blocked(r), r.notices[0]);

    /* The sandbox below stubs applyLearnedRules, so the shipped function's own
       contract is checked here: it has to hand its outcome back rather than
       logging it and returning nothing. */
    check('applyLearnedRules reports its outcome, not just a console warning',
      /return \{ ok: true, count: addRules\.length \};/.test(BG)
        && /return \{ ok: false, error: String\(\(e && e\.message\) \|\| e \|\| 'unknown'\) \};/.test(BG),
      'swallowing it is what let a rule Chrome refused be announced as a block');

    /* A blocked site with a service worker never reaches Chrome's error page.
       YouTube registers one, and an installed worker does not need re-fetching to
       run: the navigation goes to the worker, the worker's own fetch is refused by
       the rule, and it serves its cached offline shell. A correctly blocked
       YouTube therefore rendered "Connect to the Internet. You're offline.",
       which reads as a broken browser rather than a site you chose to block. */
    r = build();
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    /* A plain reload can serve the shell from cache, so the main_frame never hits
       the network and only the runtime data calls get blocked -- the "loads but
       not really" skeleton. The reload has to bypass the cache so the block
       actually applies to the document. */
    r = build();
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('the post-block reload bypasses the cache',
      r.bypassed(),
      'a cached shell renders then starves on blocked data calls');
    check('the reload helper passes bypassCache to chrome.tabs.reload',
      /chrome\.tabs\.reload\(tabId, \{ bypassCache: true \}/.test(BG));

    check('blocking drops the site service worker',
      r.wiped.length === 1 && r.wiped[0].types.indexOf('serviceWorkers') >= 0,
      'without this the site serves its own cached offline page instead');
    check('and its cache storage with it',
      r.wiped.length === 1 && r.wiped[0].types.indexOf('cacheStorage') >= 0);
    check('but never cookies or localStorage',
      r.wiped.every((w) => w.types.indexOf('cookies') < 0 && w.types.indexOf('localStorage') < 0),
      'unblocking should leave you signed in, not looking logged out');
    check('covering both schemes and the www host',
      (r.wiped[0] || { origins: [] }).origins.length === 4
        && (r.wiped[0] || { origins: [] }).origins.indexOf('https://www.youtube.com') >= 0);

    /* Re-asserting a block you already had has the same job to do: the worker may
       have re-registered while the site was reachable. */
    /* Re-assert path: reached when the entry said "Block" but the site is already
       blocked. It still drops the worker so the reload lands on the error page. */
    r = build({ offer: { host: 'youtube.com', action: 'block' } });
    r.sb.LEARNED['youtube.com'] = { hits: 1, userBlocked: true };
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('re-asserting an existing block drops the worker too',
      r.wiped.length === 1 && r.wiped[0].types.indexOf('serviceWorkers') >= 0,
      'otherwise a site blocked earlier still shows its own offline page');

    r = build({ ruleLands: false });
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('a block that did not take clears nothing',
      r.wiped.length === 0,
      'dropping a worker for a site that is not actually blocked is pure damage');

    /* ---- the never-block list must not veto YOUR choice ------------------ *
     * THE root cause of "Block this site does nothing". NEVER_BLOCK_DOMAINS is a
     * 10-member literal that two load-time forEach loops grow to 36, and the
     * added names include youtube.com, twitch.tv and netflix.com. Every one of
     * them made normalizeLearnedDomain return '' -- so wardenSiteHostFromTab
     * reported "not a normal page" on YouTube, and applyLearnedRules pruned the
     * entry and PERSISTED the pruned map, deleting the block on the next apply.
     *
     * The mutations are loaded here deliberately: a harness that reads only the
     * Set literal says youtube.com is fine, which is how this was nearly
     * dismissed as a false alarm. */
    {
      const DU = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
      const dsb = { console, String, Object, Set, RegExp, Array, Number, Boolean, JSON, Math, URL };
      vm.createContext(dsb);
      vm.runInContext(DU, dsb, { filename: 'domain-utils.js' });
      const NL3 = String.fromCharCode(10);
      const liftFn = (n) => {
        const a = BG.indexOf('function ' + n + '(');
        if (a < 0) return null;
        const e = BG.indexOf(NL3 + '}' + NL3, a);
        return e > a ? BG.slice(a, e + 3) : null;
      };
      const liftSet = (n) => {
        const a = BG.indexOf('const ' + n + ' = new Set([');
        if (a < 0) return null;
        const e = BG.indexOf(']);', a);
        return e > a ? BG.slice(a, e + 3) : null;
      };
      ['NEVER_BLOCK_DOMAINS', 'NEVER_BLOCK_PUBLIC_SUFFIXES', 'X_APP_COMPAT_DOMAINS',
       'LOGIN_COMPAT_NEVER_BLOCK_DOMAINS'].forEach((n) => {
        const src = liftSet(n);
        if (src) { try { vm.runInContext(src, dsb); } catch (_) {} }
      });
      if (!/^object/.test(vm.runInContext('typeof LOGIN_COMPAT_NEVER_BLOCK_DOMAINS', dsb))) {
        vm.runInContext('var LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = new Set();', dsb);
      }
      const MUT = 'LOGIN_COMPAT_NEVER_BLOCK_DOMAINS.forEach((domain) => NEVER_BLOCK_DOMAINS.add(domain));';
      const TAIL = '].forEach((domain) => NEVER_BLOCK_DOMAINS.add(domain));';
      const ms = BG.indexOf(MUT);
      const me = BG.indexOf(TAIL, ms);
      check('the never-block list is still grown at load time', ms >= 0 && me > ms,
        'a harness that skips these reads youtube.com as blockable and hides the bug');
      if (ms >= 0 && me > ms) vm.runInContext(BG.slice(ms, me + TAIL.length), dsb, { filename: 'mutations' });
      ['ipv4FromMappedIpv6', 'isLocalOrPrivateHost', 'isGithubUploadInfraDomain',
       'isNeverBlockDomain', 'registrableDomainBg', 'normalizeAllowlistHost',
       'normalizeUserBlockDomain', 'normalizeLearnedDomain'].forEach((n) => {
        const src = liftFn(n);
        if (src) { try { vm.runInContext(src, dsb); } catch (_) {} }
      });
      const at = (fn, host) => vm.runInContext(fn + '(' + JSON.stringify(host) + ')', dsb);

      check('youtube.com really is on the never-block list at runtime',
        vm.runInContext('NEVER_BLOCK_DOMAINS.has("youtube.com")', dsb) === true,
        'if this ever goes false the rest of this block proves nothing');
      check('an AUTOMATIC block still honours that list',
        at('normalizeLearnedDomain', 'youtube.com') === ''
          && at('normalizeLearnedDomain', 'twitch.tv') === '',
        'a false positive in the 28k-rule pack must not break a major site');
      check('but a block YOU chose is not vetoed',
        at('normalizeUserBlockDomain', 'youtube.com') === 'youtube.com'
          && at('normalizeUserBlockDomain', 'www.youtube.com') === 'youtube.com'
          && at('normalizeUserBlockDomain', 'netflix.com') === 'netflix.com',
        'this returning "" is what produced "not a normal page" on YouTube');
      check('and it still refuses what is not a site',
        at('normalizeUserBlockDomain', '8.8.8.8') === ''
          && at('normalizeUserBlockDomain', '') === '',
        'bare IPs and empties are not sites you can block by name');
      check('an ordinary host is unaffected either way',
        at('normalizeLearnedDomain', 'example.com') === 'example.com'
          && at('normalizeUserBlockDomain', 'example.com') === 'example.com');
    }
    check('the menu reads the host without the veto',
      /const host = normalizeUserBlockDomain\(u\.hostname\);/.test(BG),
      'normalizeLearnedDomain here is what reported "not a normal page"');
    check('and the prune keeps a block you chose',
      /const d = cur\.userBlocked === true\s*\?\s*normalizeUserBlockDomain\(raw\)\s*:\s*normalizeLearnedDomain\(raw\);/.test(BG),
      'the prune persists its own deletions, so this is where the block un-saved itself');

    /* Clicking "Block this site" must never UNBLOCK it.

       This was a blind toggle on LEARNED[host]. Once a site was in LEARNED -- from
       an earlier attempt, or a click that half-worked -- clicking an entry reading
       "Block this site" removed the block and reloaded, and the page came back
       normally, which is indistinguishable from the block doing nothing. With the
       title stale and the toast easy to miss, alternating clicks just flipped the
       state forever. The action now follows what the entry actually offered. */
    const YT = { id: 1, url: 'https://www.youtube.com/' };
    const YTI = { pageUrl: 'https://www.youtube.com/' };

    /* The one thing a "Block" click must never do is quietly UNBLOCK -- the
       original bug, where alternating clicks flipped the state. The guard now
       hangs on the offer: an entry that said 'block' re-asserts, never undoes. */
    r = build({ offer: { host: 'youtube.com', action: 'block' } });
    r.sb.LEARNED['youtube.com'] = { hits: 1, userBlocked: true };
    await r.toggle(YT, YTI);
    check('an entry that said "Block" re-asserts, never unblocks',
      !!r.sb.LEARNED['youtube.com'], 'this is the loop the reader was stuck in');
    check('and it says which state they are actually in',
      /Already blocked/.test(r.notices[0] || ''), r.notices[0]);

    r = build();
    await r.toggle(YT, YTI);
    await r.toggle(YT, YTI);
    check('clicking block twice before any refresh leaves it blocked',
      !!r.sb.LEARNED['youtube.com'],
      'a fresh block records a block offer, so the second click re-asserts');

    r = build({ offer: { host: 'youtube.com', action: 'unblock' } });
    r.sb.LEARNED['youtube.com'] = { hits: 1, userBlocked: true };
    await r.toggle(YT, YTI);
    check('an entry that read "Unblock" unblocks',
      !r.sb.LEARNED['youtube.com'], r.notices[0]);

    /* THE error page: worker evicted, so the in-memory offer is gone and the
       durable one may be too, but the site is plainly blocked. It must unblock
       rather than dead-end. tab.url is the site; the pageUrl is chrome-error. */
    r = build();
    r.sb.LEARNED['youtube.com'] = { hits: 1, userBlocked: true };
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'chrome-error://chromewebdata/' });
    check('a blocked site unblocks from the error page even with no offer',
      !r.sb.LEARNED['youtube.com'],
      'the worker is cold on the error page; a missing offer must not trap the block on');

    check('the offer is recorded durably so it survives worker eviction',
      /async function wardenWriteBlockOffer\(host, action\)/.test(BG)
        && /chrome\.storage\.session\.set\(\{ \[WARDEN_BLOCK_OFFER_KEY\]: WARDEN_BLOCK_MENU_OFFER \}\)/.test(BG),
      'an in-memory offer is gone by the time the error page is right-clicked');
    check('and unblock is blocked only by an explicit "block" offer',
      /const labelSaidBlock = offer\.host === host && offer\.action === 'block';/.test(BG)
        && /if \(LEARNED\[host\] && !labelSaidBlock\) \{/.test(BG),
      'gating on the presence of an unblock offer is what dead-ended the error page');

    /* The rule is read back out of Chrome before the block is claimed.
       applyLearnedRules was fire-and-forget and swallowed every failure into a
       console warning, so a refused rule still produced "Blocked. Reloading
       now." and a page that loaded perfectly normally. */
    r = build({ applyFails: true, ruleLands: false });
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('a rule Chrome refused is reported, not announced as a block',
      /Could not block youtube\.com/.test(r.notices[0] || '')
        && /rule budget exceeded/.test(r.notices[0] || ''), r.notices[0]);
    check('and it does not reload a tab it has not blocked', !r.reloaded());

    r = build({ ruleLands: false });
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('a rule that wrote cleanly but is not live is caught too',
      /NOT blocking yet/.test(r.notices[0] || ''), r.notices[0]);

    r = build();
    await r.toggle({ id: 1, url: 'https://www.youtube.com/' }, { pageUrl: 'https://www.youtube.com/' });
    check('and a rule that really is live is announced and reloaded',
      /Blocked\. Reloading now/.test(r.notices[0] || '') && r.reloaded(), r.notices[0]);

    r = build();
    await r.toggle({ id: 1, url: 'chrome://extensions' }, { pageUrl: 'chrome://extensions' });
    check('a page that really is not a site is still refused', !blocked(r));
    check('and the refusal names what it looked at',
      /It saw: chrome:\/\/extensions/.test(r.notices[0] || ''),
      'a refusal that describes nothing cost a round of guessing: ' + r.notices[0]);

    r = build();
    await r.toggle({ id: 1 }, {});
    check('with nothing readable it says so plainly',
      !blocked(r) && /no address for this page/.test(r.notices[0] || ''), r.notices[0]);
  }

  /* Anything that had to await a shipped async helper. */
  for (const fn of deferred) await fn();

  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('context checks: ' + pass + ' checks passed');
})();

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The reader's own rules: what they say is what Chrome does, and what the page says is what
 * happened (H17, H18, H19, H20, PI-02, BUG-06).
 *
 * Five findings, one pipeline. The Site Firewall and My Rules / Custom Lists are the two
 * places a person writes network policy by hand, and each had the same two faults in its own
 * shape: the rules Chrome ended up with did not match the cells or lines, and the interface
 * reported success without asking Chrome.
 *
 *   H17  Every firewall cell was emitted at one priority, and Chrome breaks a tie between an
 *        allow and a block in favour of the allow -- so All = allow with Script = block loaded
 *        the scripts. A specific column now outranks All, a cookie strip outranks an allow in
 *        its row, and a session allowance outranks everything stored.
 *   H18  The firewall applier returned 0 for "empty" and for "Chrome refused", and both write
 *        handlers said ok:true either way. They apply first and store only what Chrome took.
 *   H19  ||*abc parsed as a rule Chrome refuses; the atomic update rejected -- leaving every
 *        OLD rule live -- and a fallback added the new rules one at a time onto the old ids,
 *        so nothing changed while the editor text was already stored. The parser refuses it
 *        by line; a refused batch is a refused batch; every write commits through Chrome.
 *   H20  Custom lists promised HTTPS and accepted http://, plus https->http redirects, for
 *        text that carries priority-98000 exceptions. HTTPS only, at the start and through
 *        every redirect; a stored http:// list reads as off, with the reason.
 *   PI-02 "Allow once" -- the design's own argument for exposing a site-breaking matrix --
 *        had a handler, a rule band, a budget and a test, and no control. It has one, and
 *        the allocator underneath it (BUG-06) no longer overwrites the oldest allowance
 *        once the band is full.
 *
 * Everything below runs the shipped functions and handler bodies against a model of
 * declarativeNetRequest that keeps Chrome's contracts: an update is all-or-nothing, a
 * rejected update changes nothing, and a request is decided by the highest-priority
 * matching rule with allow beating block on a tie.
 *
 * Run: node tools/test-user-rules-honesty.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const FW_JS = fs.readFileSync(path.join(ROOT, 'firewall.js'), 'utf8');
const FW_HTML = fs.readFileSync(path.join(ROOT, 'firewall.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}
function between(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error('cannot find the end of ' + what);
  return src.slice(a, b);
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

/* ---- a declarativeNetRequest that keeps Chrome's contracts ------------------------ */

function dnrModel() {
  const dynamic = new Map();
  const session = new Map();
  const log = [];
  let refuseNext = null;   // a reason string, to force one rejection
  function validate(store, removeRuleIds, addRules) {
    const remaining = new Set(store.keys());
    for (const id of removeRuleIds || []) remaining.delete(id);
    const seen = new Set();
    for (const r of addRules || []) {
      if (!r || !Number.isInteger(r.id) || r.id < 1) return 'rule id must be a positive integer';
      if (remaining.has(r.id) || seen.has(r.id)) return 'rule with id ' + r.id + ' already exists';
      seen.add(r.id);
      if (!r.priority || r.priority < 1) return 'priority must be >= 1';
      const f = r.condition && r.condition.urlFilter;
      if (typeof f === 'string' && /^\|\|\*/.test(f)) return 'urlFilter cannot begin with ||*';
      if (typeof f === 'string' && !f.length) return 'urlFilter cannot be empty';
    }
    return '';
  }
  function update(store, name) {
    return async function (opts) {
      const why = refuseNext || validate(store, opts.removeRuleIds, opts.addRules);
      refuseNext = null;
      log.push({ name, ok: !why, remove: (opts.removeRuleIds || []).length, add: (opts.addRules || []).length });
      if (why) throw new Error(why);
      for (const id of opts.removeRuleIds || []) store.delete(id);
      for (const r of opts.addRules || []) store.set(r.id, JSON.parse(JSON.stringify(r)));
    };
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  const domainMatches = (list, host) => !list || !list.length || list.some((d) => host === d || host.endsWith('.' + d));
  function filterMatches(filter, url) {
    if (!filter) return true;
    let f = filter;
    let anchoredHost = false, anchoredStart = false, anchoredEnd = false;
    if (f.startsWith('||')) { anchoredHost = true; f = f.slice(2); } else if (f.startsWith('|')) { anchoredStart = true; f = f.slice(1); }
    if (f.endsWith('|')) { anchoredEnd = true; f = f.slice(0, -1); }
    const re = '^' + (anchoredHost ? '[a-z]+://([^/]+\\.)?' : anchoredStart ? '' : '.*') + f.split('*').map((p) => p.replace(/[.+?${}()[\]\\]/g, '\\$&').replace(/\^/g, '(?:[^a-zA-Z0-9_.%-]|$)')).join('.*') + (anchoredEnd ? '$' : '');
    return new RegExp(re, 'i').test(url);
  }
  function matches(r, req) {
    const c = r.condition || {};
    if (c.resourceTypes && !c.resourceTypes.includes(req.type)) return false;
    if (!domainMatches(c.initiatorDomains, hostOf(req.initiator || ''))) return false;
    if (!domainMatches(c.requestDomains, hostOf(req.url))) return false;
    if (!filterMatches(c.urlFilter, req.url)) return false;
    return true;
  }
  const ORDER = { allow: 0, allowAllRequests: 1, block: 2, upgradeScheme: 3, redirect: 4 };
  function decide(req) {
    const all = [...dynamic.values(), ...session.values()].filter((r) => matches(r, req));
    const decisive = all.filter((r) => r.action.type !== 'modifyHeaders');
    decisive.sort((a, b) => (b.priority - a.priority) || (ORDER[a.action.type] - ORDER[b.action.type]));
    const winner = decisive[0] || null;
    const outcome = winner ? winner.action.type : 'allow';
    let strippedCookie = false;
    if (outcome !== 'block') {
      const allowPriority = winner && (winner.action.type === 'allow' || winner.action.type === 'allowAllRequests') ? winner.priority : 0;
      for (const r of all) {
        if (r.action.type !== 'modifyHeaders') continue;
        /* Chrome's rule, quoted: only modifyHeaders rules with a HIGHER priority than any
           matching allow are included -- an equal priority strip is ignored. That is why
           Cookie = strip beside All = allow at one priority stripped nothing. */
        if (r.priority <= allowPriority) continue;
        if ((r.action.requestHeaders || []).some((h) => h.header === 'cookie' && h.operation === 'remove')) strippedCookie = true;
      }
    }
    return { outcome, winner, strippedCookie };
  }
  return {
    log, dynamic, session,
    refuse(why) { refuseNext = why; },
    decide,
    api: {
      getDynamicRules: async () => [...dynamic.values()],
      getSessionRules: async () => [...session.values()],
      updateDynamicRules: update(dynamic, 'dynamic'),
      updateSessionRules: update(session, 'session'),
    },
  };
}

/* ---- the firewall, lifted whole -------------------------------------------------- */

const FW = between(BG, 'const FIREWALL_RULE_BASE = 950000;', '\n// ---- Cryptojacking guard', 'the firewall');
const FW_SET = between(BG, "  if (msg && msg.kind === 'firewall-set') {\n", "  if (msg && msg.kind === 'firewall-allow-once') {", 'the firewall-set handler');
const FW_ONCE = between(BG, "  if (msg && msg.kind === 'firewall-allow-once') {\n", "  if (msg && msg.kind === 'firewall-reset') {", 'the allow-once handler');
const FW_RESET = between(BG, "  if (msg && msg.kind === 'firewall-reset') {\n", '\n  // ---- File Shield ----', 'the firewall-reset handler');
const FW_GET = between(BG, "  if (msg && msg.kind === 'firewall-get') {\n", "  if (msg && msg.kind === 'firewall-set') {", 'the firewall-get handler');
/* A handler's body: everything between its `if (msg.kind === ...) {` line and the brace that
   closes it, so it can be wrapped as a plain function and driven with a fake sendResponse. */
const unwrap = (sliceWithHead) => {
  const head = sliceWithHead.indexOf('{\n');
  if (head < 0) throw new Error('handler slice has no opening brace');
  const body = sliceWithHead.slice(head + 2);
  const out = body.replace(/\n  \}\s*$/, '\n');
  if (out === body) throw new Error('handler slice did not end with the if-block brace: ' + JSON.stringify(body.slice(-30)));
  return out;
};

function firewallWorld({ store, failStorage } = {}) {
  const dnr = dnrModel();
  const storage = { [ 'wardenone_firewall' ]: store || {} };
  const ctx = {
    console: { warn() {} }, JSON, Object, Array, String, Number, Promise, Set, Map,
    FIREWALL_RULES_BUDGET: Number((/const FIREWALL_RULES_BUDGET = (\d+)/.exec(BG) || [])[1]),
    FIREWALL_SESSION_RULES_BUDGET: Number((/const FIREWALL_SESSION_RULES_BUDGET = (\d+)/.exec(BG) || [])[1]),
    chrome: { declarativeNetRequest: dnr.api },
    localGet: async (key) => ({ [key]: JSON.parse(JSON.stringify(storage[key] || {})) }),
    /* the master switch is on unless a case turns it off (BUG-02) */
    masterSwitchOn: async () => storage.wardenone_config === undefined || (storage.wardenone_config || {}).enabled !== false,
    localSet: async (obj) => { if (failStorage) throw new Error('quota exceeded'); Object.assign(storage, JSON.parse(JSON.stringify(obj))); },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FW
    + '\nasync function handleSet(msg, sendResponse) {\n' + unwrap(FW_SET) + '\n}'
    + '\nasync function handleOnce(msg, sendResponse) {\n' + unwrap(FW_ONCE) + '\n}'
    + '\nasync function handleReset(msg, sendResponse) {\n' + unwrap(FW_RESET) + '\n}'
    + '\nasync function handleGet(msg, sendResponse) {\n' + unwrap(FW_GET) + '\n}'
    + '\nglobalThis.api = { firewallRulesFrom, applyFirewallRulesFrom, firewallAllowOnce, firewallClearSession, firewallSessionAllowances,'
    + ' handleSet, handleOnce, handleReset, handleGet, FIREWALL_PRIORITY, FIREWALL_PRIORITY_COLUMN, FIREWALL_PRIORITY_COOKIE, FIREWALL_PRIORITY_ONCE,'
    + ' FIREWALL_SESSION_RULE_BASE, FIREWALL_SESSION_RULE_MAX };', ctx);
  const call = (fn, msg) => new Promise((resolve) => { fn(msg, resolve); });
  return { api: ctx.api, dnr, storage, call };
}

(async () => {
  /* ---- H17: the cell that says block, blocks ---------------------------------------- */
  {
    const { api, dnr } = firewallWorld();
    check('the tiers are ordered: All < column < cookie < once',
      api.FIREWALL_PRIORITY < api.FIREWALL_PRIORITY_COLUMN && api.FIREWALL_PRIORITY_COLUMN < api.FIREWALL_PRIORITY_COOKIE && api.FIREWALL_PRIORITY_COOKIE < api.FIREWALL_PRIORITY_ONCE);
    check('and none of them touches a priority another band uses',
      ![97001, 97002, 97003].some((p) => new RegExp('priority: ' + p + '\\b').test(BG.replace(/FIREWALL_PRIORITY[_A-Z]* = 9700\d/g, ''))));

    const rules = api.firewallRulesFrom({ 'news.example': { 'cdn.example': { all: 'allow', script: 'block' } } });
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: rules });
    const script = dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' });
    const image = dnr.decide({ url: 'https://cdn.example/a.png', initiator: 'https://news.example', type: 'image' });
    check('All = allow with Script = block: the script IS blocked', script.outcome === 'block', 'winner ' + JSON.stringify(script.winner && script.winner.action));
    check('and the image is still allowed by All', image.outcome === 'allow' && image.winner && image.winner.priority === api.FIREWALL_PRIORITY);
  }
  {
    const { api, dnr } = firewallWorld();
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.firewallRulesFrom({ 'news.example': { 'cdn.example': { all: 'block', script: 'allow' } } }) });
    check('All = block with Script = allow: the script loads', dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' }).outcome === 'allow');
    check('and everything else is blocked', dnr.decide({ url: 'https://cdn.example/a.css', initiator: 'https://news.example', type: 'stylesheet' }).outcome === 'block');
  }
  {
    const { api, dnr } = firewallWorld();
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.firewallRulesFrom({ 'news.example': { 'cdn.example': { all: 'allow', cookie: 'strip' } } }) });
    const r = dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' });
    check('Cookie = strip beside All = allow: the request goes, without its cookie', r.outcome === 'allow' && r.strippedCookie === true);
    await dnr.api.updateDynamicRules({ removeRuleIds: [...dnr.dynamic.keys()], addRules: api.firewallRulesFrom({ 'news.example': { 'cdn.example': { script: 'block', cookie: 'strip' } } }) });
    check('Script = block with Cookie = strip: blocked, and a blocked request has no headers to strip',
      dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' }).outcome === 'block');
    check('the rules are scoped to the site they were set on',
      dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://other.example', type: 'script' }).outcome === 'allow'
      && dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://other.example', type: 'script' }).winner === null);
  }
  {
    const { api, dnr } = firewallWorld();
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.firewallRulesFrom({ 'news.example': { 'cdn.example': { script: 'block' } } }) });
    const once = await api.firewallAllowOnce('news.example', 'cdn.example', 'all');
    check('allow once beats a stored block while it lasts', once.ok === true
      && dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' }).outcome === 'allow');
    await api.firewallClearSession();
    check('and the stored block is back the moment the allowance is cleared',
      dnr.decide({ url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' }).outcome === 'block');
  }

  /* ---- H18: "Saved" means Chrome took it ----------------------------------------- */
  {
    const { api, dnr, storage, call } = firewallWorld();
    const ok = await call(api.handleSet, { site: 'news.example', domain: 'cdn.example', column: 'script', verdict: 'block' });
    check('a cell Chrome accepts is stored and applied', ok.ok === true && ok.applied === 1 && storage.wardenone_firewall['news.example']['cdn.example'].script === 'block');

    dnr.refuse('Internal error while updating dynamic rules');
    const refused = await call(api.handleSet, { site: 'news.example', domain: 'cdn.example', column: 'xhr', verdict: 'block' });
    check('a cell Chrome refuses is reported as refused', refused.ok === false && /refused/.test(refused.error) && /Nothing was saved/.test(refused.error), JSON.stringify(refused));
    check('and the stored matrix is untouched', !storage.wardenone_firewall['news.example']['cdn.example'].xhr);
    check('and the answer carries the rules that ARE in effect, so the page can redraw', refused.rules && refused.rules['cdn.example'].script === 'block' && !refused.rules['cdn.example'].xhr);
    check('and Chrome still holds the previous rule set', dnr.dynamic.size === 1);
    check('the order of operations is Chrome first, storage second',
      dnr.log.filter((l) => l.name === 'dynamic').length === 2, JSON.stringify(dnr.log));
  }
  {
    const { api, call } = firewallWorld({ failStorage: true });
    const r = await call(api.handleSet, { site: 'news.example', domain: 'cdn.example', column: 'script', verdict: 'block' });
    check('a storage failure after Chrome accepted is not reported as saved', r.ok === false && /will not survive a restart/.test(r.error), JSON.stringify(r));
  }
  {
    const { api, dnr, storage, call } = firewallWorld({ store: { 'news.example': { 'cdn.example': { script: 'block' } }, 'shop.example': { 'x.example': { all: 'allow' } } } });
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.firewallRulesFrom(storage.wardenone_firewall) });
    await api.firewallAllowOnce('news.example', 'cdn.example', 'all');
    const r = await call(api.handleReset, { site: 'news.example', all: false });
    check('a per-site reset removes that site, its allowance, and nothing else',
      r.ok === true && !storage.wardenone_firewall['news.example'] && storage.wardenone_firewall['shop.example'] && dnr.session.size === 0 && dnr.dynamic.size === 1, JSON.stringify(r));
    dnr.refuse('rule count exceeded');
    const bad = await call(api.handleReset, { site: 'shop.example', all: false });
    check('a reset Chrome refuses is reported as refused', bad.ok === false && /still stored and still in effect/.test(bad.error), JSON.stringify(bad));
    check('and the stored matrix still has the site', !!storage.wardenone_firewall['shop.example']);
  }

  /* ---- PI-02 / BUG-06: the allowance, reachable and correctly allocated ------------ */
  {
    const { api, dnr, call } = firewallWorld();
    const first = await call(api.handleOnce, { site: 'news.example', domain: 'cdn.example', column: 'all' });
    const again = await call(api.handleOnce, { site: 'news.example', domain: 'cdn.example', column: 'all' });
    check('the same allowance twice refreshes one rule', first.ok && again.ok && again.refreshed === true && dnr.session.size === 1, JSON.stringify(again));
    const base = api.FIREWALL_SESSION_RULE_BASE;
    for (let i = 1; i < api.FIREWALL_SESSION_RULE_MAX; i++) await api.firewallAllowOnce('news.example', 'd' + i + '.example', 'all');
    check('fifty distinct allowances fill the band', dnr.session.size === api.FIREWALL_SESSION_RULE_MAX);
    const full = await api.firewallAllowOnce('news.example', 'one-more.example', 'all');
    check('the fifty-first is refused, with a reason', full.ok === false && full.full === true && /Fifty/.test(full.error), JSON.stringify(full));
    check('and the first allowance is still there', dnr.session.has(base) && dnr.session.get(base).condition.requestDomains[0] === 'cdn.example',
      'the old allocator overwrote slot zero and said true');
    check('a refreshed allowance still fits when the band is full', (await api.firewallAllowOnce('news.example', 'cdn.example', 'all')).ok === true);
    const listed = await api.firewallSessionAllowances('news.example');
    check('the page can ask which allowances are active for the site', listed.length === api.FIREWALL_SESSION_RULE_MAX && listed.some((a) => a.domain === 'cdn.example' && a.column === 'all'));
    check('and only for that site', (await api.firewallSessionAllowances('other.example')).length === 0);
    const cleared = await api.firewallClearSession();
    check('clearing the session drops the whole band', cleared.ok && cleared.removed === api.FIREWALL_SESSION_RULE_MAX && dnr.session.size === 0);
    check('the band is bounded by its own constant everywhere', !/FIREWALL_SESSION_RULE_BASE \+ FIREWALL_RULE_MAX\b/.test(BG),
      'BUG-06: the clear used the dynamic band\'s width for the session band');
    const got = await call(api.handleGet, { site: 'news.example' });
    check('firewall-get answers with the allowances', Array.isArray(got.once));
  }
  check('the page sends the allowance', /kind: 'firewall-allow-once'/.test(FW_JS) && /function allowOnce\(domain, button\)/.test(FW_JS));
  check('with a control in every third-party row', /el\('button', 'fw-once'/.test(FW_JS) && /allow once/.test(FW_JS));
  check('that reads as a session allowance, not a stored decision', /allowed until the browser closes/.test(FW_JS) && /Nothing was stored/.test(FW_JS));
  check('and the page loads the active allowances with the rules', /ONCE = new Set\(\(\(res && res\.once\) \|\| \[\]\)/.test(FW_JS));
  check('the guide explains it', /Allow once<\/strong>, under a domain/.test(FW_HTML) && /A specific column beats/.test(FW_HTML));
  check('the page redraws from the truth when a cell is refused', /if \(res && res\.rules\) RULES = res\.rules;/.test(FW_JS));

  /* ---- the user filters, lifted whole ----------------------------------------------- */
  const UF = between(BG, 'const USER_RULE_BASE = 750000;', '\n// ======================= Network / filtering logger', 'the user filters');
  const UF_SET = between(BG, "  if (msg && msg.kind === 'user-rules-set') {\n", "  // ---- Custom lists ----", 'the user-rules-set handler');
  const UF_TOGGLE = between(BG, "  if (msg && msg.kind === 'custom-list-toggle' && msg.id) {\n", "  if (msg && msg.kind === 'custom-list-remove' && msg.id) {", 'the toggle handler');
  const HOST_FN = between(BG, 'function normalizeAllowlistHost(value) {', 'function normalizeAllowlistHosts(', 'normalizeAllowlistHost');

  function filterWorld({ store, fetchImpl } = {}) {
    const dnr = dnrModel();
    const storage = Object.assign({}, store || {});
    const fetched = [];
    const ctx = {
      console: { warn() {} }, JSON, Object, Array, String, Number, Promise, Set, Map, RegExp, URL, Math, Date, AbortController, setTimeout, clearTimeout,
      USER_RULES_BUDGET: Number((/const USER_RULES_BUDGET = (\d+)/.exec(BG) || [])[1]),
      chrome: { declarativeNetRequest: dnr.api },
      localGet: async (key) => { const keys = Array.isArray(key) ? key : [key]; const out = {}; for (const k of keys) if (storage[k] !== undefined) out[k] = JSON.parse(JSON.stringify(storage[k])); return out; },
      masterSwitchOn: async () => storage.wardenone_config === undefined || (storage.wardenone_config || {}).enabled !== false,
      localSet: async (obj) => { Object.assign(storage, JSON.parse(JSON.stringify(obj))); },
      normalizeIpLiteral: (h) => h,
      isLocalOrPrivateHost: (h) => /^(localhost|127\.|10\.|192\.168\.)/.test(h),
      normalizePublicHttpUrl: (raw, base) => { try { const u = base ? new URL(String(raw || ''), base) : new URL(String(raw || '')); if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''; u.hash = ''; return u.href; } catch (_) { return ''; } },
      isDefaultPortHttpUrl: (raw) => { try { return new URL(String(raw || '')).port === ''; } catch (_) { return false; } },
      readResponseTextWithByteLimit: async (res) => res.text(),
      __cosmeticHostCache: new Map(),
      fetch: async (url, opts) => { fetched.push(url); return fetchImpl ? fetchImpl(url, opts) : { ok: true, status: 200, headers: { get: () => null }, text: async () => '' }; },
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(HOST_FN + '\n' + UF
      + '\nasync function handleSet(msg, sendResponse) {\n' + unwrap(UF_SET) + '\n}'
      + '\nasync function handleToggle(msg, sendResponse) {\n' + unwrap(UF_TOGGLE) + '\n}'
      + '\nglobalThis.api = { parseUserFilterLine, parseUserFilterText, userFilterBundleFor, applyUserFilterRulesFrom, commitUserFilters,'
      + ' fetchCustomListText, readCustomLists, refreshCustomList, handleSet, handleToggle, USER_RULE_BASE };', ctx);
    const call = (fn, msg) => new Promise((resolve) => { fn(msg, resolve); });
    return { api: ctx.api, dnr, storage, fetched, call };
  }

  /* ---- H19: a deleted exception stays deleted ---------------------------------------- */
  {
    const { api } = filterWorld();
    check('||*abc is refused by the parser, by line', api.parseUserFilterLine('||*abc').kind === 'error' && /cannot start with \|\|\*/.test(api.parseUserFilterLine('||*abc').why));
    const parsed = api.parseUserFilterText('@@||good.example^\n||*abc\n||ads.example^', api.USER_RULE_BASE);
    check('so the other lines still become rules and the bad one is named', parsed.network.length === 2 && parsed.errors.length === 1 && parsed.errors[0].line === 2);
  }
  {
    /* the finding's reproduction: an old exception is live; the new text drops it and adds a
       line Chrome would refuse */
    const { api, dnr, storage, call } = filterWorld({ store: { wardenone_user_rules: { text: '@@||malware.example^' } } });
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.userFilterBundleFor('@@||malware.example^', []).network });
    check('the old exception is live', dnr.dynamic.size === 1 && dnr.decide({ url: 'https://malware.example/x', type: 'script' }).outcome === 'allow');
    const r = await call(api.handleSet, { text: '||*abc' });
    check('saving text that deletes the exception removes it from Chrome', r.ok === true && dnr.dynamic.size === 0, JSON.stringify(r));
    check('and names the invalid line rather than losing the save over it', r.errors.length === 1 && /\|\|\*/.test(r.errors[0].why));
    check('and stores the new text', storage.wardenone_user_rules.text === '||*abc');
  }
  {
    /* Chrome refuses for a reason the parser could not foresee */
    const { api, dnr, storage, call } = filterWorld({ store: { wardenone_user_rules: { text: '@@||malware.example^' } } });
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.userFilterBundleFor('@@||malware.example^', []).network });
    dnr.refuse('rule count exceeded');
    const r = await call(api.handleSet, { text: '||ads.example^' });
    check('an update Chrome refuses is reported as refused', r.ok === false && /refused/.test(r.error) && /was not saved/.test(r.error), JSON.stringify(r));
    check('the old rule is still live', dnr.dynamic.size === 1 && dnr.dynamic.has(api.USER_RULE_BASE) && dnr.dynamic.get(api.USER_RULE_BASE).action.type === 'allow');
    check('and the old text is still stored', storage.wardenone_user_rules.text === '@@||malware.example^');
    check('and nothing was added one rule at a time on top of it', dnr.log.filter((l) => l.name === 'dynamic').length === 2, JSON.stringify(dnr.log));
  }
  {
    const { api, dnr } = filterWorld();
    const res = await api.applyUserFilterRulesFrom({ network: [{ id: api.USER_RULE_BASE, priority: 97000, action: { type: 'block' }, condition: { urlFilter: '||*abc' } }] });
    check('the applier itself reports a refused batch honestly', res.ok === false && /\|\|\*/.test(res.error) && dnr.dynamic.size === 0, JSON.stringify(res));
  }

  /* ---- H20: HTTPS only ------------------------------------------------------------- */
  {
    const { api, fetched } = filterWorld();
    const r = await api.fetchCustomListText('http://lists.example/a.txt');
    check('a plain http:// list is refused before any request is made', r.ok === false && /HTTPS only/.test(r.error) && fetched.length === 0, JSON.stringify(r));
  }
  {
    let bodyRead = false;
    const { api, fetched } = filterWorld({ fetchImpl: async (url) => {
      if (url.startsWith('https://')) return { ok: true, status: 302, headers: { get: (h) => (h === 'location' ? 'http://lists.example/a.txt' : null) }, text: async () => { bodyRead = true; return '@@||malware.example^'; } };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => { bodyRead = true; return '@@||malware.example^'; } };
    } });
    const r = await api.fetchCustomListText('https://lists.example/a.txt');
    check('an https -> http redirect is refused', r.ok === false && /plain http/.test(r.error), JSON.stringify(r));
    check('and the downgraded body is never read', bodyRead === false && fetched.length === 1);
  }
  {
    const { api } = filterWorld({ fetchImpl: async (url) => (url.endsWith('/a.txt')
      ? { ok: true, status: 301, headers: { get: (h) => (h === 'location' ? 'https://cdn.lists.example/b.txt' : null) }, text: async () => '' }
      : { ok: true, status: 200, headers: { get: () => null }, text: async () => '||ads.example^' }) });
    const r = await api.fetchCustomListText('https://lists.example/a.txt');
    check('https -> https succeeds', r.ok === true && r.url === 'https://cdn.lists.example/b.txt' && r.text === '||ads.example^');
  }
  {
    const legacy = [{ id: 'cl_1', url: 'http://lists.example/old.txt', title: 'Old', enabled: true, text: '@@||malware.example^', ruleCount: 1 }];
    const { api, dnr, storage, call } = filterWorld({ store: { wardenone_custom_lists: legacy } });
    const lists = await api.readCustomLists();
    check('a stored http:// list reads as off, and says why', lists[0].enabled === false && lists[0].insecure === true && /http:\/\/ address/.test(lists[0].error));
    check('its address and text are kept for the reader', lists[0].url === 'http://lists.example/old.txt' && lists[0].text === '@@||malware.example^');
    const bundle = api.userFilterBundleFor('', lists);
    check('and its rules are not built', bundle.network.length === 0);
    /* and the builder refuses the transport itself, not just the enabled flag it was read with */
    const raw = api.userFilterBundleFor('', [{ id: 'cl_2', url: 'http://lists.example/raw.txt', enabled: true, text: '@@||malware.example^' }]);
    check('a list handed to the builder still enabled but on http:// builds no rules either', raw.network.length === 0);
    const t = await call(api.handleToggle, { id: 'cl_1', enabled: true });
    check('turning it back on is refused with the same reason', t.ok === false && /http:\/\/ address/.test(t.error), JSON.stringify(t));
    check('and nothing reached Chrome', dnr.log.length === 0 && storage.wardenone_custom_lists[0].enabled === true);
  }
  check('the popup shows the notice instead of "still using the copy"', /bad\.textContent = l\.insecure \? l\.error/.test(POPUP_JS));
  check('and disables the switch for it', /if \(l\.insecure\) \{ toggle\.disabled = true;/.test(POPUP_JS));
  check('the add handler refuses http before fetching', /if \(!\/\^https:\/i\.test\(url\)\) \{ sendResponse\(\{ ok: false, error: 'Custom lists are fetched over HTTPS only/.test(BG));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all user-rule honesty checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

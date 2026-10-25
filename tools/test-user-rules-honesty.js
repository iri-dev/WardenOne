/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Exercise the shipped firewall and custom-rule handlers against Chrome-like
   atomic DNR updates. Specific rules outrank broad ones, rejected writes stay
   rejected, HTTPS lists remain HTTPS, and UI success reflects applied state. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dynamicRuleIo = require('./lib/dynamic-rule-io.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const FW_JS = fs.readFileSync(path.join(ROOT, 'firewall.js'), 'utf8');
const FW_HTML = fs.readFileSync(path.join(ROOT, 'firewall.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

process.exitCode = 1;
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
  let refuseOnly = null;   // 'dynamic' or 'session' to aim it at one store
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
      const forced = refuseNext && (!refuseOnly || refuseOnly === name) ? refuseNext : '';
      if (forced) { refuseNext = null; refuseOnly = null; }
      const why = forced || validate(store, opts.removeRuleIds, opts.addRules);
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
    refuse(why, only) { refuseNext = why; refuseOnly = only || null; },
    decide,
    api: {
      getDynamicRules: async () => [...dynamic.values()],
      getSessionRules: async () => [...session.values()],
      updateDynamicRules: update(dynamic, 'dynamic'),
      updateSessionRules: update(session, 'session'),
    },
  };
}

/* "All" is derived from the canonical request-type inventory (M45). */
const ALL_TYPES = JSON.parse(BG.slice(BG.indexOf('const ALL_DNR_RESOURCE_TYPES = [') + 'const ALL_DNR_RESOURCE_TYPES = '.length, BG.indexOf('];', BG.indexOf('const ALL_DNR_RESOURCE_TYPES')) + 1).replace(/'/g, '"').replace(/,\s*\]/, ']'));
/* The worker's per-store transaction lane (M48), with the same ordering guarantee. */
function makeStoreTransaction() {
  const lanes = new Map();
  return (key, task) => {
    const next = (lanes.get(key) || Promise.resolve()).then(task);
    lanes.set(key, next.then(() => {}, () => {}));
    return next;
  };
}

/* ---- the firewall, lifted whole -------------------------------------------------- */

/* The worker's band read and write, and the comparison the firewall makes before writing. */
const BAND_READ = between(BG, 'function dnrValueMatches(', 'function ownDynamicRuleBands(', 'the band comparison')
  + dynamicRuleIo.prelude(BG, [[950000, 250]]);
const FW = BAND_READ + '\n' + between(BG, 'const FIREWALL_RULE_BASE = 950000;', '\n// ---- Cryptojacking guard', 'the firewall');
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

function firewallWorld({ store, failStorage, transaction } = {}) {
  const dnr = dnrModel();
  const storage = { [ 'wardenone_firewall' ]: store || {} };
  const ctx = {
    console: { warn() {} }, JSON, Object, Array, String, Number, Promise, Set, Map,
    ALL_DNR_RESOURCE_TYPES: ALL_TYPES, storeTransaction: transaction || makeStoreTransaction(),
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
  vm.runInContext(between(BG, 'const __subsystemQueues = new Map();', '\n/* Whole-store writers,', 'the subsystem queue') + '\n' + FW
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

function holdFirstSessionWrite(dnr) {
  const read = dnr.api.getSessionRules;
  const write = dnr.api.updateSessionRules;
  let release, entered, reads = 0, writes = 0;
  const held = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  dnr.api.getSessionRules = async () => { reads++; return read(); };
  dnr.api.updateSessionRules = async (change) => {
    if (++writes === 1) { entered(); await held; }
    return write(change);
  };
  return { started, release, get reads() { return reads; } };
}

(async () => {
  {
    const { api, dnr, storage, call } = firewallWorld();
    const set = (column, verdict) => call(api.handleSet, { site: 'news.example', domain: 'cdn.example', column, verdict });
    await set('all', 'allow');
    await dnr.api.updateDynamicRules({ addRules: [{ id: 10000, priority: 3000, action: { type: 'block' },
      condition: { requestDomains: ['cdn.example'], resourceTypes: ['script'] } }] });
    const request = { url: 'https://cdn.example/app.js', initiator: 'https://news.example', type: 'script' };
    check('explicit Allow retains its security-list override', dnr.decide(request).outcome === 'allow');
    const noop = await set('script', 'noop');
    check('a noop is saved only after narrowing the installed All rule', noop.ok && noop.held === 2
      && storage.wardenone_firewall['news.example']['cdn.example'].script === 'noop' && dnr.decide(request).outcome === 'block');
    dnr.refuse('simulated write failure');
    const refused = await set('script', 'default');
    check('a failed noop edit preserves the applied matrix and security decision', !refused.ok && refused.rules['cdn.example'].script === 'noop'
      && storage.wardenone_firewall['news.example']['cdn.example'].script === 'noop' && dnr.decide(request).outcome === 'block');
    const restored = await set('script', 'default');
    check('retrying Default restores the explicit All choice', restored.ok && dnr.decide(request).outcome === 'allow');
    for (const [column, verdict] of [['all', 'noop'], ['cookie', 'noop'], ['script', 'strip'], ['cookie', 'allow']]) {
      const before = JSON.stringify(storage.wardenone_firewall);
      const invalid = await set(column, verdict);
      check('invalid firewall pair is rejected: ' + column + '/' + verdict, !invalid.ok && JSON.stringify(storage.wardenone_firewall) === before);
    }
  }
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
    await api.firewallAllowOnce('shop.example', 'pay.example', 'all');
    const r = await call(api.handleReset, { site: 'news.example', all: false });
    check('a per-site reset removes that site, its allowance, and nothing else',
      r.ok === true && r.sessionRemoved === 1 && !storage.wardenone_firewall['news.example'] && storage.wardenone_firewall['shop.example'] && dnr.dynamic.size === 1, JSON.stringify(r));
    const shopLeft = await api.firewallSessionAllowances('shop.example');
    check('another site\'s temporary allowance survives a per-site reset',
      dnr.session.size === 1 && shopLeft.length === 1 && shopLeft[0].domain === 'pay.example'
        && (await api.firewallSessionAllowances('news.example')).length === 0, JSON.stringify([...dnr.session.values()]));
    dnr.refuse('rule count exceeded');
    const bad = await call(api.handleReset, { site: 'shop.example', all: false });
    check('a reset Chrome refuses is reported as refused', bad.ok === false && !bad.partial
      && /Nothing was changed/.test(bad.error) && /still stored and still in effect/.test(bad.error), JSON.stringify(bad));
    check('and the stored matrix still has the site', !!storage.wardenone_firewall['shop.example']);
    /* The claim has to be true of Chrome, not only of storage: this case used to clear the
       allowances first, so "still in effect" was printed over allowances already gone. */
    check('and Chrome still holds the site\'s rules and its temporary allowance',
      dnr.dynamic.size === 1 && (await api.firewallSessionAllowances('shop.example')).length === 1,
      'dynamic ' + dnr.dynamic.size + ', session ' + JSON.stringify([...dnr.session.values()]));
  }
  {
    /* The other half failing: Chrome takes the stored rules away, then refuses to clear the allowances. */
    const { api, dnr, storage, call } = firewallWorld({ store: { 'news.example': { 'cdn.example': { script: 'block' } }, 'shop.example': { 'x.example': { all: 'allow' } } } });
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.firewallRulesFrom(storage.wardenone_firewall) });
    await api.firewallAllowOnce('news.example', 'cdn.example', 'all');
    dnr.refuse('Internal error while updating session rules', 'session');
    const half = await call(api.handleReset, { site: 'news.example', all: false });
    check('a reset that only half took says so, and is not reported as done',
      half.ok === false && half.partial === true && half.rulesRemoved === true
        && /saved rules for news\.example were removed/.test(half.error) && /temporary allowances/.test(half.error)
        && !/Nothing was changed|still in effect/.test(half.error), JSON.stringify(half));
    check('and storage matches what Chrome holds: the site\'s rules are gone from both',
      !storage.wardenone_firewall['news.example'] && !!storage.wardenone_firewall['shop.example'] && dnr.dynamic.size === 1);
    check('and the allowance still in effect is handed back, so the page can show it',
      Array.isArray(half.once) && half.once.length === 1 && half.once[0].domain === 'cdn.example', JSON.stringify(half.once));
    const again = await call(api.handleReset, { site: 'news.example', all: false });
    check('undoing again finishes the job', again.ok === true && again.sessionRemoved === 1
      && (await api.firewallSessionAllowances('news.example')).length === 0, JSON.stringify(again));
  }
  {
    /* A failed read must not pass for "there were no allowances to clear". */
    const { api, dnr, call } = firewallWorld({ store: { 'news.example': { 'cdn.example': { script: 'block' } } } });
    await api.firewallAllowOnce('news.example', 'cdn.example', 'all');
    const read = dnr.api.getSessionRules;
    dnr.api.getSessionRules = async () => { dnr.api.getSessionRules = read; throw new Error('session rules unavailable'); };
    const blind = await call(api.handleReset, { site: 'news.example', all: false });
    check('a reset that could not read the allowances is not reported as done',
      blind.ok === false && blind.partial === true && /session rules unavailable/.test(blind.error)
        && dnr.session.size === 1, JSON.stringify(blind));
  }
  {
    const { api, dnr, call } = firewallWorld({ store: { 'news.example': { 'cdn.example': { script: 'block' } } }, failStorage: true });
    await dnr.api.updateDynamicRules({ removeRuleIds: [], addRules: api.firewallRulesFrom({ 'news.example': { 'cdn.example': { script: 'block' } } }) });
    const unsaved = await call(api.handleReset, { site: 'news.example', all: false });
    check('a reset Chrome took but storage refused says the rules will come back',
      unsaved.ok === false && unsaved.rulesRemoved === false && /come back when the browser restarts/.test(unsaved.error)
        && dnr.dynamic.size === 0, JSON.stringify(unsaved));
  }
  {
    const { api, dnr, storage, call } = firewallWorld({ store: { 'shop.example': { 'x.example': { all: 'allow' } } } });
    await api.firewallAllowOnce('news.example', 'cdn.example', 'all');
    await api.firewallAllowOnce('shop.example', 'pay.example', 'all');
    const only = await call(api.handleReset, { site: 'news.example', all: false });
    check('a site with only a temporary allowance can be reset',
      only.ok === true && only.sessionRemoved === 1 && dnr.session.size === 1 && !!storage.wardenone_firewall['shop.example'], JSON.stringify(only));
    await api.firewallAllowOnce('news.example', 'cdn.example', 'all');
    const junk = await api.firewallClearSession('not a host');
    check('a site that does not normalise clears nothing rather than the whole band', junk.ok && junk.removed === 0 && dnr.session.size === 2);
    const all = await call(api.handleReset, { all: true });
    check('remove-everything still clears every site\'s allowances', all.ok === true && all.sessionRemoved === 2 && dnr.session.size === 0, JSON.stringify(all));
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

  for (const failure of ['rejection', 'throw', 'missing API', 'undefined result', 'null result', 'invalid result']) {
    const { api, dnr, call } = firewallWorld();
    await api.firewallAllowOnce('news.example', 'existing.example', 'all');
    const before = JSON.stringify([...dnr.session.values()]);
    const writes = dnr.log.length;
    const read = dnr.api.getSessionRules;
    if (failure === 'missing API') delete dnr.api.getSessionRules;
    else dnr.api.getSessionRules = () => {
      if (failure === 'rejection') return Promise.reject(new Error('session lookup unavailable'));
      if (failure === 'throw') throw new Error('session lookup unavailable');
      return Promise.resolve(failure === 'invalid result' ? {} : failure === 'null result' ? null : undefined);
    };
    const result = await call(api.handleOnce, { site: 'shop.example', domain: 'new.example', column: 'script' });
    check('Allow Once refuses ' + failure + ' with an error', result.ok === false && !!result.error, JSON.stringify(result));
    check('Allow Once leaves existing choices untouched after ' + failure,
      JSON.stringify([...dnr.session.values()]) === before && dnr.log.length === writes);
    dnr.api.getSessionRules = read;
    const retry = await call(api.handleOnce, { site: 'shop.example', domain: 'new.example', column: 'script' });
    check('Allow Once can retry after ' + failure, retry.ok === true && dnr.session.size === 2);
  }
  {
    const { api, dnr } = firewallWorld();
    await api.firewallAllowOnce('news.example', 'existing.example', 'all');
    const before = JSON.stringify([...dnr.session.values()]);
    dnr.api.getSessionRules = async () => [];
    const result = await api.firewallAllowOnce('shop.example', 'collision.example', 'all');
    check('an unexpected ID collision fails without replacing an existing allowance',
      result.ok === false && JSON.stringify([...dnr.session.values()]) === before);
  }
  {
    const { api, dnr, call } = firewallWorld();
    const held = holdFirstSessionWrite(dnr);
    const first = call(api.handleOnce, { site: 'news.example', domain: 'first.example', column: 'script' });
    await held.started;
    const second = call(api.handleOnce, { site: 'shop.example', domain: 'second.example', column: 'xhr' });
    await tick();
    check('another allowance waits through allocation and the Chrome write', held.reads === 1);
    held.release();
    const replies = await Promise.all([first, second]);
    check('concurrent Allow Once messages both succeed without replacing either choice',
      replies.every((reply) => reply.ok) && dnr.session.size === 2
        && (await api.firewallSessionAllowances('news.example')).some((rule) => rule.domain === 'first.example')
        && (await api.firewallSessionAllowances('shop.example')).some((rule) => rule.domain === 'second.example'));
  }
  {
    const { api, dnr } = firewallWorld();
    const replies = await Promise.all([api.firewallAllowOnce('news.example', 'same.example', 'all'),
      api.firewallAllowOnce('news.example', 'same.example', 'all')]);
    check('simultaneous identical choices allocate once and then refresh',
      replies[0].ok && !replies[0].refreshed && replies[1].ok && replies[1].refreshed && dnr.session.size === 1);
    dnr.refuse('session write refused', 'session');
    const [failed, next] = await Promise.all([api.firewallAllowOnce('news.example', 'refused.example', 'all'),
      api.firewallAllowOnce('news.example', 'after-error.example', 'all')]);
    check('a refused write does not stop the next allowance', !failed.ok && next.ok && dnr.session.size === 2);
  }
  for (const site of [undefined, 'news.example']) {
    const { api, dnr } = firewallWorld();
    await api.firewallAllowOnce('news.example', 'same.example', 'all');
    const held = holdFirstSessionWrite(dnr);
    const clear = api.firewallClearSession(site);
    await held.started;
    const newer = api.firewallAllowOnce('news.example', 'same.example', 'all');
    await tick();
    check('new allowances wait for ' + (site ? 'site' : 'all-site') + ' clearing', held.reads === 1);
    held.release();
    const [cleared, allowed] = await Promise.all([clear, newer]);
    check('clearing cannot erase a newer allowance', cleared.ok && cleared.removed === 1 && allowed.ok
      && !allowed.refreshed && dnr.session.size === 1);
  }
  {
    const { api, dnr } = firewallWorld();
    for (let i = 0; i < api.FIREWALL_SESSION_RULE_MAX - 1; i++) await api.firewallAllowOnce('news.example', 'existing' + i + '.example', 'all');
    const [first, second] = await Promise.all([api.firewallAllowOnce('news.example', 'last-slot.example', 'all'),
      api.firewallAllowOnce('news.example', 'overflow.example', 'all')]);
    check('concurrent requests cannot both consume the last free slot', first.ok && !second.ok && second.full
      && dnr.session.size === api.FIREWALL_SESSION_RULE_MAX);
  }

  /* ---- M48: two quick cell changes both survive -------------------------------------- *
     The handler reads the whole matrix, changes a copy, asks Chrome, then writes it back. Two
     clicks in quick succession both read the old matrix and the later write erased the earlier
     cell, while both were answered ok. Run with the real lane and with no lane at all. */
  {
    const clicks = (w) => Promise.all([
      w.call(w.api.handleSet, { kind: 'firewall-set', site: 'news.example', domain: 'ads.example', column: 'script', verdict: 'block' }),
      w.call(w.api.handleSet, { kind: 'firewall-set', site: 'news.example', domain: 'cdn.example', column: 'all', verdict: 'allow' }),
    ]);
    const laned = firewallWorld();
    const [a, b] = await clicks(laned);
    const stored = (laned.storage.wardenone_firewall || {})['news.example'] || {};
    check('two overlapping firewall changes are both kept', a.ok && b.ok && !!stored['ads.example'] && !!stored['cdn.example'], JSON.stringify(stored));
    const unlaned = firewallWorld({ transaction: (k, task) => task() });
    const [c, d] = await clicks(unlaned);
    const lost = (unlaned.storage.wardenone_firewall || {})['news.example'] || {};
    check('and without the transaction lane one of them is lost -- the test sees the race',
      !(lost['ads.example'] && lost['cdn.example']), JSON.stringify({ lost, answers: [c.ok, d.ok] }));
  }
  check('every whole-store writer runs in its store\'s lane',
    /if \(msg && msg\.kind === 'firewall-set'\) \{\n    storeTransaction\(FIREWALL_KEY, async \(\) => \{/.test(BG)
      && /if \(msg && msg\.kind === 'firewall-reset'\) \{\n    storeTransaction\(FIREWALL_KEY, async \(\) => \{/.test(BG)
      && ['user-rules-set', 'custom-list-add', 'custom-list-update', 'custom-list-toggle', 'custom-list-remove'].every((k) =>
        new RegExp("msg\\.kind === '" + k + "'[^\\n]*\\) \\{\\n    storeTransaction\\(USER_FILTER_STORES, async \\(\\) => \\{").test(BG))
      && ['addHiddenElement', 'removeHiddenElement', 'clearHiddenElements'].every((f) =>
        new RegExp('respond\\(storeTransaction\\(HIDDEN_STORE_KEY, \\(\\) => ' + f + '\\(').test(BG)));

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
      storeTransaction: makeStoreTransaction(), USER_FILTER_STORES: 'user-filters',
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
    vm.runInContext(fs.readFileSync('domain-utils.js', 'utf8') + '\n' + fs.readFileSync('psl-private.js', 'utf8') + '\n' + HOST_FN + '\n' + BAND_READ + '\n' + UF
      + '\nasync function handleSet(msg, sendResponse) {\n' + unwrap(UF_SET) + '\n}'
      + '\nasync function handleToggle(msg, sendResponse) {\n' + unwrap(UF_TOGGLE) + '\n}'
      + '\nglobalThis.api = { parseUserFilterLine, parseUserFilterText, userFilterBundleFor, applyUserFilterRulesFrom, commitUserFilters,'
      + ' fetchCustomListText, readCustomLists, refreshCustomList, userFilterBundle, handleSet, handleToggle, USER_RULE_BASE };', ctx);
    const call = (fn, msg) => new Promise((resolve) => { fn(msg, resolve); });
    return { api: ctx.api, dnr, storage, fetched, call };
  }

  {
    const { api, call, dnr, storage } = filterWorld();
    await call(api.handleSet, { text: '@@||owner.example^' });
    const text = '@@||owner.example^\n||malware.example^\n@@||malware.example^';
    const imported = await call(api.handleSet, { text, source: 'settings-import' });
    check('an import records the source of its new rules', imported.ok && storage.wardenone_user_rules.untrustedRules.length === 2);
    const ruleFor = (rules, filter) => rules.find((rule) => rule.condition.urlFilter === filter);
    check('an imported exception is below Script Shield and logger rules', ruleFor([...dnr.dynamic.values()], '||malware.example^').priority < 1000);
    check('an existing manual exception keeps its authority', ruleFor([...dnr.dynamic.values()], '||owner.example^').priority === 98000);
    await call(api.handleSet, { text });
    check('saving the editor does not promote imported rules', [...dnr.dynamic.values()].filter((rule) => rule.condition.urlFilter === '||malware.example^').every((rule) => rule.priority < 1000));
    const fresh = filterWorld({ store: storage });
    const restored = await fresh.api.userFilterBundle();
    check('a fresh worker retains the imported priority ceiling', restored.network.filter((rule) => rule.condition.urlFilter === '||malware.example^').every((rule) => rule.priority < 1000));
    for (const priority of [1000, 1900, 2000, 2001, 3000]) {
      const w = filterWorld();
      await w.call(w.api.handleSet, { text: '@@||malware.example^', source: 'settings-import' });
      await w.dnr.api.updateDynamicRules({ addRules: [{ id: 123, priority, action: { type: 'block' }, condition: { requestDomains: ['malware.example'] } }] });
      check('security priority ' + priority + ' beats the imported exception', w.dnr.decide({ url: 'https://malware.example/file.js', type: 'script' }).outcome === 'block');
    }
    const subscription = api.userFilterBundleFor('', [{ id: 'list', url: 'https://lists.example/filters', enabled: true,
      text: '||malware.example^\n@@||malware.example^' }]);
    check('subscriptions use the same ceiling and keep their own block/exception order', subscription.network[0].priority < subscription.network[1].priority && subscription.network[1].priority < 1000);
    const popup = filterWorld();
    await popup.call(popup.api.handleSet, { text: '@@||popup.example^', untrustedRules: ['@@||popup.example^'] });
    check('a filter text file imported through the popup has the same ceiling', [...popup.dnr.dynamic.values()][0].priority === 900);
    await popup.api.commitUserFilters({ own: '@@||popup.example^', lists: [], storeLists: true });
    check('a subscription update does not promote existing file rules', [...popup.dnr.dynamic.values()][0].priority === 900);
    const broad = await call(api.handleSet, { text: '@@|http\n@@.com\n@@||com^\n@@https\n@@://' });
    check('all reported broad exceptions are skipped with individual errors', broad.ok && broad.network === 0 && broad.errors.length === 5);
    check('the popup retains file provenance until it saves', /untrustedRules: \[\.\.\.userRulesImportedLines\]/.test(POPUP_JS)
      && /userRulesImportedLines\.add\(line\.trim\(\)\)/.test(POPUP_JS));
  }

  /* ---- H19: a deleted exception stays deleted ---------------------------------------- */
  for (const source of [undefined, 'settings-import']) {
    const text = 'example.com#?#div:has-text(Ad)';
    const { api, dnr, call } = filterWorld({ store: { wardenone_user_rules: { text } } });
    await dnr.api.updateDynamicRules({ addRules: [{ id: api.USER_RULE_BASE, priority: 97000,
      action: { type: 'block' }, condition: { urlFilter: text } }] });
    const response = await call(api.handleSet, { text, source });
    check('unsupported #?# is reported without retaining a legacy network rule: ' + (source || 'editor'),
      response.ok && response.count === 0 && response.network === 0 && response.errors.length === 1
      && /cosmetic form/.test(response.errors[0].why) && dnr.dynamic.size === 0);
  }
  {
    const { api } = filterWorld();
    const bundle = api.userFilterBundleFor('', [{ id: 'procedural-fixture', enabled: true,
      url: 'https://lists.example/filters', text: 'example.com#?#div:has-text(Ad)\n||ads.example^' }]);
    check('subscriptions skip #?# while preserving real network rules', bundle.count === 1
      && bundle.network.length === 1 && bundle.network[0].condition.urlFilter === '||ads.example^'
      && bundle.errors.length === 1 && bundle.errors[0].line === 2);
  }
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
  process.exitCode = 0;
})().catch((e) => { console.error(e); process.exit(1); });

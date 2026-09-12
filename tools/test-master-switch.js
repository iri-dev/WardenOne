/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Off means off (BUG-02).
 *
 * The master switch routed through removeWardenOneDynamicRules(), whose predicate enumerated
 * nine bands. Three bands that install blocking rules were not among them -- My Rules and
 * subscribed lists (750000), the per-site firewall (950000, plus its 960000 session band) and
 * the hand-written blocked-site list (970000) -- and their appliers had no enabled gate and
 * were re-run only from their own editors. So a site the reader had blocked stayed blocked with
 * the popup reading Disabled, across worker death and browser restart; and the allowlist rule
 * that could have overridden it was withdrawn in the same operation.
 *
 * This executes the shipped predicate against the shipped band constants, as the record's own
 * harness did, and then drives the shipped appliers against a fake DNR through off and on.
 *
 * Run: node tools/test-master-switch.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
function lift(name) {
  let start = BG.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('background.js no longer declares ' + name);
  if (BG.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0;
  for (let i = BG.indexOf('{', start); i < BG.length; i++) {
    if (BG[i] === '{') depth++;
    else if (BG[i] === '}') { depth--; if (depth === 0) return BG.slice(start, i + 1); }
  }
  throw new Error(name + ' is unterminated');
}
function constLine(name) {
  const m = new RegExp('^const ' + name + ' = [^\\n]+;', 'm').exec(BG);
  if (!m) throw new Error('no constant ' + name);
  return m[0];
}
const BAND_CONSTS = ['DYNAMIC_RULE_BASE', 'MAX_DYNAMIC', 'OPTION_RULE_BASE', 'OPTION_RULES_MAX', 'TRACKER_RULES_BUDGET', 'USER_RULES_BUDGET',
  'FIREWALL_RULES_BUDGET', 'FIREWALL_SESSION_RULES_BUDGET', 'USER_BLOCKLIST_RULES_BUDGET', 'NEVER_BLOCK_ALLOW_RULE_BASE', 'NEVER_BLOCK_ALLOW_MAX',
  'SCRIPT_SHIELD_RULE_BASE', 'SCRIPT_SHIELD_RULE_MAX', 'FINGERPRINT_SCRIPT_RULE_BASE', 'FINGERPRINT_SCRIPT_RULE_MAX',
  'GOOGLE_SEARCH_ALLOW_RULE_BASE', 'GOOGLE_SEARCH_ALLOW_RULE_MAX', 'LEARNED_RULE_BASE', 'LEARNED_MAX', 'GRABBER_FEED_RULE_BASE', 'GRABBER_FEED_MAX',
  'TRACKER_RULE_BASE', 'TRACKER_RULE_MAX', 'USER_RULE_BASE', 'USER_RULE_MAX', 'USER_BLOCKLIST_RULE_BASE', 'FIREWALL_RULE_BASE', 'FIREWALL_RULE_MAX',
  'FIREWALL_SESSION_RULE_BASE', 'FIREWALL_SESSION_RULE_MAX'].map(constLine).join('\n');

function rig(options) {
  const o = options || {};
  const state = { enabled: o.enabled !== false, dnr: [], session: [], updates: 0, sessionCleared: 0, writes: [] };
  const ctx = {
    console: { warn() {}, log() {} }, Object, Array, Number, String, JSON, Math, Date, Promise, Set, Map, RegExp,
    localGet: async () => ({ wardenone_config: { enabled: state.enabled } }),
    localSet: async (o2) => { state.writes.push(o2); },
    userFilterBundle: async () => ({ network: [{ id: 750000, priority: 97000, action: { type: 'block' }, condition: { urlFilter: '||ads.example^', resourceTypes: ['script'] } }], cosmetic: [], errors: [] }),
    parseUserFilterText: (text, base) => ({ network: [], cosmetic: [], errors: [], base }),
    readFirewall: async () => ({ 'shop.example': { 'cdn.example': { all: 'block' } } }),
    firewallRulesFrom: () => [{ id: 950000, priority: 97000, action: { type: 'block' }, condition: { requestDomains: ['cdn.example'], initiatorDomains: ['shop.example'] } }],
    firewallErrorText: (e) => String(e),
    firewallClearSession: async () => { state.sessionCleared++; state.session = []; return { ok: true }; },
    readUserBlocklist: async () => [{ pattern: 'blocked.example', scope: 'permanent', addedAt: 1 }],
    pruneExpiredBlocks: (all) => ({ live: all, expired: [] }),
    userBlockRulesFrom: (live) => live.map((e, i) => ({ id: 970000 + i, priority: 99000, action: { type: 'block' }, condition: { requestDomains: [e.pattern] } })),
    normalizeAllowlistHosts: (l) => (l || []).slice(0, 1000),
    chrome: {
      declarativeNetRequest: {
        getDynamicRules: async () => state.dnr.slice(),
        updateDynamicRules: async ({ removeRuleIds, addRules }) => {
          state.updates++;
          state.dnr = state.dnr.filter((r) => !(removeRuleIds || []).includes(r.id)).concat(JSON.parse(JSON.stringify(addRules || [])));
        },
        getSessionRules: async () => state.session.slice(),
        updateSessionRules: async ({ removeRuleIds, addRules }) => {
          state.session = state.session.filter((r) => !(removeRuleIds || []).includes(r.id)).concat(JSON.parse(JSON.stringify(addRules || [])));
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(BAND_CONSTS + '\nvar __allowlistRulesKey = null; const ALLOWLIST_RULE_BASE = 800000;\n'
    + ['masterSwitchOn', 'isWardenOneDynamicRuleId', 'removeWardenOneDynamicRules', 'applyUserFilterRulesFrom', 'applyUserFilterRules',
      'applyFirewallRulesFrom', 'applyFirewallRules', 'applyUserBlocklistRules', 'applyAllowlistRules'].map(lift).join('\n')
    + '\nglobalThis.api = { isMine: isWardenOneDynamicRuleId, removeAll: removeWardenOneDynamicRules, userFilters: applyUserFilterRules,'
    + ' userFiltersFrom: applyUserFilterRulesFrom, firewall: applyFirewallRules, firewallFrom: applyFirewallRulesFrom, blocklist: applyUserBlocklistRules, allowlist: applyAllowlistRules };', ctx);
  return { api: ctx.api, state, band: (base, max) => state.dnr.filter((r) => r.id >= base && r.id < base + max).length };
}
const BANDS = { 'My rules + custom lists': [750000, 500], 'Per-site firewall': [950000, 250], 'Firewall allow-once': [960000, 50], 'User blocklist': [970000, 64] };

(async () => {
  console.log('\nmaster switch\n');

  /* ---- 1. the record's harness: the predicate against the band bases ------------------ */
  {
    const r = rig();
    for (const [label, [base, max]] of Object.entries(BANDS)) {
      const covered = r.api.isMine(base) && r.api.isMine(base + max - 1) && !r.api.isMine(base + max);
      check(label + ' base ' + base + ' withdrawn by the central remover: ' + (covered ? 'YES' : 'NO'), label === 'Firewall allow-once' ? true : covered);
    }
    check('the allow-once band is a session band, cleared by the firewall applier rather than the dynamic remover',
      !r.api.isMine(960000) && /await firewallClearSession\(\);/.test(lift('applyFirewallRules')));
  }

  /* ---- 2. on: every band installs from its store ---------------------------------- */
  {
    const r = rig();
    await r.api.userFilters(); await r.api.firewall(); await r.api.blocklist();
    check('with the switch on, My Rules install', r.band(750000, 500) === 1);
    check('with the switch on, the firewall installs', r.band(950000, 250) === 1);
    check('with the switch on, the blocked-site list installs', r.band(970000, 64) === 1);

    /* ---- 3. off: the central remover takes them, and the appliers install nothing ---- */
    r.state.enabled = false;
    await r.api.removeAll();
    check('turning the switch off removes all three bands', r.band(750000, 500) === 0 && r.band(950000, 250) === 0 && r.band(970000, 64) === 0, r.state.dnr);
    await r.api.userFilters(); await r.api.firewall(); await r.api.blocklist();
    check('and the appliers, run while off, put nothing back', r.state.dnr.length === 0, r.state.dnr);
    check('the firewall applier also clears the session allowances', r.state.sessionCleared >= 1);
    const fromOff = await r.api.userFiltersFrom({ network: [{ id: 750001, priority: 97000, action: { type: 'block' }, condition: { urlFilter: '||x.example^' } }] });
    check('a candidate applied while off goes live nowhere, and says so', fromOff.ok === true && fromOff.count === 0 && r.band(750000, 500) === 0, fromOff);
    const fwOff = await r.api.firewallFrom([{ id: 950001, priority: 97000, action: { type: 'block' }, condition: { requestDomains: ['cdn.example'] } }]);
    check('a firewall decision applied while off goes live nowhere', fwOff.ok === true && fwOff.applied === 0 && r.band(950000, 250) === 0, fwOff);

    /* ---- 4. on again: the stores come back ----------------------------------------- */
    r.state.enabled = true;
    await r.api.userFilters(); await r.api.firewall(); await r.api.blocklist();
    check('turning the switch back on re-installs all three from their stores', r.band(750000, 500) === 1 && r.band(950000, 250) === 1 && r.band(970000, 64) === 1);
  }

  /* ---- 5. the allowlist half: a blocked-then-allowlisted site is reachable either way -- */
  {
    const r = rig();
    await r.api.blocklist();
    await r.api.allowlist(['blocked.example']);
    const blockedOn = r.state.dnr.some((x) => x.condition.requestDomains && x.condition.requestDomains.includes('blocked.example'));
    const allowedOn = r.state.session.some((x) => x.action.type === 'allowAllRequests');
    check('on: the block exists and the allowlist rule sits above it', blockedOn && allowedOn);
    r.state.enabled = false;
    await r.api.removeAll();
    await r.api.allowlist([]);
    const blockedOff = r.state.dnr.some((x) => x.condition.requestDomains && x.condition.requestDomains.includes('blocked.example'));
    check('off: the allowlist rule is withdrawn -- and there is no block left for it to have overridden', !blockedOff && r.state.session.length === 0, r.state.dnr);
  }

  /* ---- 6. the switch moving reaches the appliers ----------------------------------- */
  {
    const orchestrator = BG.slice(BG.indexOf('function refreshExtensionState()'), BG.indexOf('\n}\n', BG.indexOf('function refreshExtensionState()')));
    check('refreshExtensionState runs the three bands as named steps',
      /run\('userFilters', userFilterBandStep\(\)\);/.test(orchestrator) && /run\('firewall', firewallBandStep\(\)\);/.test(orchestrator) && /run\('userBlocklist', userBlocklistBandStep\(\)\);/.test(orchestrator));
    check('only when the switch has moved or on the first reconcile', /if \(__userBandsAppliedFor !== on\) \{/.test(orchestrator) && /__userBandsAppliedFor = on;/.test(orchestrator));
    check('a step that failed does not mark the state applied', /if \(oks\.every\(\(x\) => x !== false\)\) __userBandsAppliedFor = on;/.test(orchestrator));
    check('the health surface has a name for each', /userFilters: 'My Rules and subscribed lists'/.test(BG) && /firewall: 'per-site firewall rules'/.test(BG) && /userBlocklist: 'blocked-site list rules'/.test(BG));
    const callers = [...BG.matchAll(/removeWardenOneDynamicRules\(\);/g)].map((m) => BG.slice(Math.max(0, m.index - 140), m.index));
    check('every caller of the central remover is a master-off path',
      callers.length >= 4 && callers.every((c) => /if \(!on\) \{|if \(!await masterEnabled\(\)\) \{|if \(cfg\.enabled === false\) \{/.test(c)), callers.length + ' callers');
  }

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('off means off');
})().catch((e) => { console.error(e); process.exit(1); });

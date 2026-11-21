/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* Referrer cap (Round 5 P2-3, 2026-11-20). A page that sets unsafe-url sent its full address to unknown sites and on
   every link (lab r2, r3). The worker rewrites that policy when it comes as a header; the engine adds the browser's
   default after a meta tag that asks for it. Both run here as they ship. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
let failed = 0, passed = 0;
function check(what, ok) { if (ok) passed++; else { failed++; console.error('FAIL - ' + what); } }

(async () => {
  /* The worker's header rule. */
  const from = BG.indexOf("const LEAKY_REFERRER_POLICY_VALUES"), to = BG.indexOf('let __headerShieldDesired', from);
  check('the worker rule is where the slice expects it', from > 0 && to > from);
  const writes = [];
  let refuse = false;
  const box = { LEAKY_REFERRER_POLICY_RULE_ID: 900012, LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com'], console: { warn() {} },
    writeSessionRules: async (change) => { if (refuse) throw new Error('responseHeaders is not supported'); writes.push(JSON.parse(JSON.stringify(change))); } };
  vm.createContext(box);
  vm.runInContext(BG.slice(from, to) + '\nthis.apply = applyLeakyReferrerPolicyRule;', box);
  await box.apply(true);
  const rule = writes[0] && writes[0].addRules[0];
  check('one session rule replaces only its own id', writes.length === 1 && JSON.stringify(writes[0].removeRuleIds) === '[900012]' && writes[0].addRules.length === 1);
  check('it rewrites the policy to the browser default', rule && rule.action.type === 'modifyHeaders'
    && JSON.stringify(rule.action.responseHeaders) === JSON.stringify([{ header: 'referrer-policy', operation: 'set', value: 'strict-origin-when-cross-origin' }]));
  const values = rule ? rule.condition.responseHeaders[0].values : [];
  check('only when the page asked for a leaky policy', rule && rule.condition.responseHeaders[0].header === 'referrer-policy'
    && ['*unsafe-url*', '*no-referrer-when-downgrade*', '*always*'].every(v => values.includes(v)) && values.length === 3);
  check('for pages and frames only', rule && JSON.stringify(rule.condition.resourceTypes) === '["main_frame","sub_frame"]');
  check('sign in hosts are left alone', rule && rule.condition.excludedRequestDomains.includes('accounts.google.com'));
  await box.apply(true);
  check('an unchanged setting writes nothing', writes.length === 1);
  await box.apply(false);
  check('switching off removes the rule', writes.length === 2 && writes[1].addRules.length === 0 && JSON.stringify(writes[1].removeRuleIds) === '[900012]');
  refuse = true;
  check('an older browser refusing the rule reports failure without throwing', (await box.apply(true)) === false);

  /* The engine's meta handling, with a small fake document. */
  const a = SRC.indexOf('const __woRefCap={'), b = SRC.indexOf('  const __woStartRuntime=()=>{', a);
  check('the engine section is where the slice expects it', a > 0 && b > a);
  const engine = () => {
    const inserted = [], appended = [];
    const meta = (name, content) => {
      const attrs = { name, content };
      return { nodeName: 'META', getAttribute: k => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; }, attrs,
        after(node) { inserted.push({ after: this, node }); } };
    };
    const env = { observers: [], dcl: null };
    const document = {
      createElement: () => meta(null, null),
      head: { appendChild(node) { appended.push(node); } },
      documentElement: { appendChild(node) { appended.push(node); } },
      addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') env.dcl = fn; },
    };
    class MutationObserver { constructor(fn) { this.fn = fn; env.observers.push(this); } observe(target, opts) { this.target = target; this.opts = opts; } disconnect() { this.target = null; } }
    const sandbox = { document, MutationObserver, WeakSet, String, __woObserver: (fn) => new MutationObserver(fn),
      woOn: (target, type, fn) => target.addEventListener(type, fn) };
    vm.createContext(sandbox);
    vm.runInContext(SRC.slice(a, b) + '\nthis.off = __woRefCapOff;', sandbox, { filename: 'content.js:referrer-cap' });
    const observer = env.observers[0];
    const add = (node) => observer.fn([{ type: 'childList', addedNodes: [node] }]);
    return { meta, add, inserted, appended, observer, env, document, off: sandbox.off };
  };
  let e = engine();
  check('the whole document is watched while it parses', e.observer && e.observer.opts.subtree === true && e.observer.opts.attributeFilter[0] === 'content');
  const page = e.meta('referrer', 'unsafe-url');
  e.add(page);
  const ours = e.inserted[0] && e.inserted[0].node;
  check('a leaky meta gets the browser default right after it', e.inserted.length === 1 && e.inserted[0].after === page
    && ours.attrs.name === 'referrer' && ours.attrs.content === 'strict-origin-when-cross-origin');
  e.add(ours);
  check('its own meta is not answered again', e.inserted.length === 1);
  for (const value of ['no-referrer-when-downgrade', ' ALWAYS ']) { const x = engine(); x.add(x.meta('Referrer', value)); check('also for ' + value.trim(), x.inserted.length === 1); }
  for (const value of ['no-referrer', 'strict-origin', 'origin', 'strict-origin-when-cross-origin']) { const x = engine(); x.add(x.meta('referrer', value)); check('a strict page keeps its own policy: ' + value, x.inserted.length === 0); }
  { const x = engine(); x.add(x.meta('description', 'unsafe-url')); check('other meta tags are ignored', x.inserted.length === 0); }
  { const x = engine(); const m = x.meta('referrer', 'origin'); x.add(m); m.attrs.content = 'unsafe-url'; x.observer.fn([{ type: 'attributes', target: m }]);
    check('a meta changed to a leaky policy later is answered too', x.inserted.length === 1); }
  e.off();
  check('switched off, the page gets its own policy back on top', e.appended.length === 1 && e.appended[0].attrs.content === 'unsafe-url' && e.observer.target === null);
  e.add(e.meta('referrer', 'unsafe-url'));
  check('and nothing more is added', e.inserted.length === 1);
  { const x = engine(); x.off(); check('switching off on a page that never asked adds nothing', x.appended.length === 0); }
  { const x = engine(); check('while parsing the document itself is watched', x.observer.target === x.document); x.env.dcl();
    check('after parsing only the head is watched', x.observer.target === x.document.head); }

  /* Wiring. */
  check('on by default in the worker and the engine', /\n  capLeakyReferrer: true,\n/.test(BG) && /capLeakyReferrer:!0,/.test(SRC) && /capLeakyReferrer:gate\(!1!==cfg\.capLeakyReferrer\)/.test(SRC));
  check('the settings pass applies it and notices a change', BG.includes("run('leakyReferrer', () => applyLeakyReferrerPolicyRule(on && cfg.capLeakyReferrer !== false), String(on && cfg.capLeakyReferrer !== false));")
    && /cfg\.capLeakyReferrer !== false \? 1 : 0,/.test(BG.slice(BG.indexOf('function refreshExtensionState()'), BG.indexOf("].join('|');", BG.indexOf('function refreshExtensionState()')))));
  check('its writes are serialized', BG.slice(BG.indexOf('const SERIALIZED_STATE_APPLIERS = ['), BG.indexOf('];', BG.indexOf('const SERIALIZED_STATE_APPLIERS = ['))).includes("'applyLeakyReferrerPolicyRule'"));
  check('the engine follows the setting at start and on change', /WO\.capLeakyReferrer\|\|__woRefCapOff\(\);\s*woOn\(document,"wo-config-change",\(\)=>\{\s*WO\.capLeakyReferrer\|\|__woRefCapOff\(\)\s*\}\);/.test(SRC));

  if (failed) { console.error(failed + ' referrer cap check(s) failed'); process.exit(1); }
  console.log('[ok] referrer cap: ' + passed + ' checks (header rule, meta handling, wiring)');
})().catch(err => { console.error(err); process.exit(1); });

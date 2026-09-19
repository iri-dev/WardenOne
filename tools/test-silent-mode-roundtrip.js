/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Silent mode round-trips.
 * Run: node tools/test-silent-mode-roundtrip.js
 *
 * Silent mode is a gate over the page's presentation, not a rewrite of the reader's
 * choices. The popup used to paint the toast and badge switches unchecked while Silent was
 * on, the generic change handler read them straight back through readFromUI on the next
 * save, and turning Silent off left both stored off until the reader found two separate
 * switches to re-enable. Onboarding, meanwhile, wrote only silentMode -- so its Silent did
 * not silence anything, because the page engine reads showToasts and showBadge and nothing
 * else.
 *
 * Now the bridge gates the page's copy in sendConfig, right where per-site overrides already
 * reach it (gateSilentPresentation), both surfaces store silentMode alone, and the switches
 * keep the preference underneath. The suite drives the real popup
 * functions on a small DOM through every toast/badge combination and both directions of
 * the Silent switch, runs the real bridge send, and pins the one-time repair for profiles
 * the old popup already damaged to its exact signature and transition.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { h, makeDocument } = require('./lib/mini-dom.js');

const ROOT = path.resolve(__dirname, '..');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const ONBOARDING = fs.readFileSync(path.join(ROOT, 'onboarding.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function grabFn(src, name) {
  const m = new RegExp('^[ \\t]*(?:async )?function ' + name + '\\(', 'm').exec(src);
  assert(m, 'missing function ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error('unterminated ' + name);
}
/* A function the fix introduced; on the pre-fix source it is absent, and the control run
   should show the behaviour failing rather than the lift crashing. */
function grabFnOrNoop(src, name) {
  return new RegExp('^[ \\t]*function ' + name + '\\(', 'm').test(src) ? grabFn(src, name) : 'function ' + name + '() { return false; }';
}
function grabBlock(src, startMarker, endMarker) {
  const from = src.indexOf(startMarker);
  assert(from >= 0, 'missing ' + startMarker);
  const to = src.indexOf(endMarker, from);
  assert(to > from, 'missing end for ' + startMarker);
  return src.slice(from, to + endMarker.length);
}

/* ---- the popup half: the real readFromUI / reflectSilentMode on a small DOM ---------- */
function popupHarness(stored) {
  const toggle = (key) => h('label', { class: 'tg' }, [h('input', { type: 'checkbox', 'data-key': key })]);
  const document = makeDocument('chrome-extension://x/popup.html', [
    h('input', { id: 'enabled', type: 'checkbox' }),
    toggle('showToasts'), toggle('showBadge'), toggle('silentMode'), toggle('adShield'),
  ]);
  /* mini-dom elements carry attributes; the popup reads .checked, so give inputs one. */
  for (const el of document.querySelectorAll('input')) el.checked = false;
  const sandbox = {
    document, console, JSON, Object, Array, String, Number, Boolean,
    $: (id) => document.getElementById(id),
    KEYS: ['showToasts', 'showBadge', 'silentMode', 'adShield'],
    normalizeProviderSettings() {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    'let config = ' + JSON.stringify(Object.assign({ enabled: true, showToasts: true, showBadge: true, silentMode: false, adShield: true }, stored || {})) + ';\n'
    + grabFn(POPUP, 'readFromUI') + '\n' + grabFn(POPUP, 'reflectSilentMode') + '\n' + grabFnOrNoop(POPUP, 'repairSilentModeRewrite') + '\n',
    ctx, { filename: 'popup.js' });
  const input = (key) => key === 'enabled' ? document.getElementById('enabled') : document.querySelector('input[data-key="' + key + '"]');
  /* applyToUI, as far as these switches go: checkboxes follow config, then Silent is painted. */
  const paint = () => {
    const cfg = vm.runInContext('config', ctx);
    input('enabled').checked = cfg.enabled !== false;
    for (const key of sandbox.KEYS) input(key).checked = cfg[key] !== false;
    vm.runInContext('reflectSilentMode()', ctx);
  };
  paint();
  return {
    ctx, document, input, paint,
    config: () => vm.runInContext('config', ctx),
    greyed: (key) => input(key).closest('.tg').attrs.class.split(/\s+/).includes('disabled'),
    /* The reader flips one switch: the generic change handler's path is readFromUI, then
       applyToUI, then the save. */
    flip(key, checked) {
      input(key).checked = checked;
      vm.runInContext('readFromUI()', ctx);
      paint();
      return this.config();
    },
  };
}

const COMBOS = [[true, true], [true, false], [false, true], [false, false]];

/* Turning Silent on stores silentMode alone; the two switches keep their values and are
   only greyed. Turning it off gives back exactly those values. All four combinations. */
for (const [toasts, badge] of COMBOS) {
  const label = 'toasts=' + toasts + ' badge=' + badge;
  const p = popupHarness({ showToasts: toasts, showBadge: badge });
  const on = p.flip('silentMode', true);
  check('Silent on keeps the stored switches (' + label + ')', on.silentMode === true && on.showToasts === toasts && on.showBadge === badge, JSON.stringify(on));
  check('Silent on greys both switches and unchecks neither (' + label + ')',
    p.greyed('showToasts') && p.greyed('showBadge') && p.input('showToasts').checked === toasts && p.input('showBadge').checked === badge);
  /* A save of something else while Silent is on must not rewrite them either. */
  const other = p.flip('adShield', false);
  check('a save while Silent is on leaves them alone (' + label + ')', other.showToasts === toasts && other.showBadge === badge && other.adShield === false);
  const off = p.flip('silentMode', false);
  const legacySignature = toasts === false && badge === false;
  if (!legacySignature) {
    check('Silent off restores the same choices (' + label + ')', off.silentMode === false && off.showToasts === toasts && off.showBadge === badge, JSON.stringify(off));
  } else {
    /* Both off under Silent is the old popup's signature -- it was the only way to get
       there, since the switches were disabled -- so Normal is put back to Normal. */
    check('Silent off repairs the old popup\'s both-off rewrite to Normal', off.silentMode === false && off.showToasts === true && off.showBadge === true, JSON.stringify(off));
  }
  check('Silent off ungreys the switches (' + label + ')', !p.greyed('showToasts') && !p.greyed('showBadge'));
}

/* The repair fires on that transition only. */
{
  const stays = popupHarness({ showToasts: false, showBadge: false, silentMode: false });
  const cfg = stays.flip('adShield', false);
  check('a profile with Silent off and both switches off is never touched', cfg.showToasts === false && cfg.showBadge === false);
  const still = popupHarness({ showToasts: false, showBadge: false, silentMode: true });
  const cfg2 = still.flip('adShield', false);
  check('a damaged profile is not rewritten while Silent stays on', cfg2.silentMode === true && cfg2.showToasts === false && cfg2.showBadge === false);
  const one = popupHarness({ showToasts: false, showBadge: true, silentMode: true });
  const cfg3 = one.flip('silentMode', false);
  check('a reader who had turned off just one switch keeps it off after Silent', cfg3.showToasts === false && cfg3.showBadge === true);
  const fresh = popupHarness({ showToasts: false, showBadge: false, silentMode: true });
  fresh.flip('silentMode', false);
  const again = fresh.flip('silentMode', true);
  const back = fresh.flip('silentMode', false);
  check('once repaired, a second Silent round-trip is an ordinary one', again.showToasts === true && back.showToasts === true && back.showBadge === true);
}

/* ---- the bridge half: the page's copy is gated, the stored one is not ----------------- */
/* The real sendConfig, with the helpers around it stubbed to identity: what reaches
   postToPage is what the page's engine will read. */
function bridgeHarness(merged) {
  const posted = [];
  const sandbox = {
    JSON, Object, Array, String, console,
    bridgeConfig: Object.assign({}, merged || {}), bridgeConfigReady: false,
    sanitizeBridgeHostList: (list) => (Array.isArray(list) ? list : []),
    bridgeSyncGoogleCleanupCss() {},
    bridgeActiveAllowlist: (cfg) => (Array.isArray(cfg.allowlist) ? cfg.allowlist : []),
    bridgeSiteOverridesFor: () => ({}),
    mergeNormalizedHostLists: () => [],
    learnedGrabberDomains: [], supplementalLists: {},
    postToPage: (m) => posted.push(m),
    signed: (kind, payload, m) => m,
    TOKEN: 't',
    location: { hostname: 'shop.example' },
    document: { dispatchEvent() {} },
    CustomEvent: function CustomEvent(type) { this.type = type; },
  };
  const ctx = vm.createContext(sandbox);
  const send = grabBlock(BRIDGE, '  const sendConfig = (overrides) => {', '\n  };');
  vm.runInContext(grabFnOrNoop(BRIDGE, 'gateSilentPresentation') + '\n' + send, ctx, { filename: 'bridge.js' });
  return {
    send: (overrides) => { vm.runInContext('sendConfig(' + JSON.stringify(overrides) + ')', ctx); return posted[posted.length - 1].overrides; },
    merged: () => vm.runInContext('bridgeConfig', ctx),
  };
}
{
  for (const [toasts, badge] of COMBOS) {
    const stored = { enabled: true, showToasts: toasts, showBadge: badge, silentMode: true };
    const page = bridgeHarness().send(stored);
    check('under Silent the page gets no toasts and no badge (toasts=' + toasts + ' badge=' + badge + ')',
      page.silentMode === true && page.showToasts === false && page.showBadge === false, JSON.stringify(page));
    const normal = bridgeHarness().send(Object.assign({}, stored, { silentMode: false }));
    check('with Silent off the page gets the stored choices (toasts=' + toasts + ' badge=' + badge + ')',
      normal.showToasts === toasts && normal.showBadge === badge, JSON.stringify(normal));
  }
  const h = bridgeHarness();
  const stored = { enabled: true, showToasts: true, showBadge: true, silentMode: true };
  const before = JSON.stringify(stored);
  h.send(stored);
  check('the gate never writes into the config it was handed', JSON.stringify(stored) === before);
  check('the bridge keeps the real choices in its own merged view', h.merged().showToasts === true && h.merged().showBadge === true && h.merged().silentMode === true);
  /* A later partial update while Silent is on carries a switch: the merged view decides. */
  const partial = h.send({ showToasts: true });
  check('a partial update while Silent is on cannot let a switch through', partial.showToasts === false);
  const off = h.send({ silentMode: false });
  check('Silent off in a later update stops the gate', off.silentMode === false && off.showToasts === undefined);
  check('silentMode itself still reaches the page, for the bridge\'s own prompts',
    bridgeHarness().send({ silentMode: true }).silentMode === true && bridgeHarness().send({ silentMode: false }).silentMode === false);
}

/* ---- the surfaces agree: Silent is stored as one key, on both --------------------------- */
{
  const setter = grabFn(ONBOARDING.replace(/^\s*async function setSilentMode/m, 'async function setSilentMode'), 'setSilentMode');
  check('onboarding stores silentMode and nothing about toasts or the badge',
    /\{ silentMode: !!isSilent, showDownloadBar: true \}/.test(setter) && !/showToasts|showBadge/.test(setter));
  const read = grabFn(POPUP, 'readFromUI');
  check('the popup no longer writes the switches false under Silent',
    !/config\.showToasts = false|config\.showBadge = false/.test(read) && /repairSilentModeRewrite\(wasSilent\)/.test(read));
  check('painting Silent unchecks nothing', !/checked = false/.test(grabFn(POPUP, 'reflectSilentMode')));
  check('the page engine reads only the two switches, so the gate is what makes Silent real',
    /showToasts:cfg\.showToasts/.test(fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8'))
      && !/silentMode/.test(fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8')));
  check('the page copy is gated in sendConfig after the per-site overrides and before it is posted',
    /delete clean\.siteOverrides;[\s\S]{0,1400}gateSilentPresentation\(clean, bridgeConfig\.silentMode === true\);[\s\S]{0,1600}postToPage\(signed\('config'/.test(BRIDGE));
  check('no worker file touches the two switches -- they are page-resolved keys',
    !/(?:cfg|config|out|clean)\.(?:showToasts|showBadge)\s*=/.test(BG));
  check('the popup says the choices come back', /come back the moment Silent is off/.test(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8')));
}

console.log('');
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
  console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
  process.exit(1);
}
console.log('  ok  ' + pass + ' checks: Silent mode is a gate over presentation, and Normal gets back what was chosen');

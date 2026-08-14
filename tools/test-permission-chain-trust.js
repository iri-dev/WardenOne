/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Who is allowed to make WardenOne assert something (M27).
 *
 * permission-chain.js runs in the MAIN world and reports permission activity to the bridge over a
 * DOM CustomEvent, tagged with a token the bridge broadcast into that same world by postMessage.
 * The page shares the world and the broadcast, so it holds the token too. The token routes
 * messages; it cannot authenticate them, and treating it as a secret was the defect.
 *
 * Forging events is therefore possible and always will be on this architecture. What must not
 * follow is a trusted state change: WardenOne telling the user a site did something, and recording
 * that in history, on nothing but the site's own say-so. The worker reads the real granted
 * permissions from contentSettings, which no page can forge, and that is what these pin.
 *
 * Run: node tools/test-permission-chain-trust.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Lift the real handler rather than restating its logic here.
// Start at `async`, not at `function` -- slicing from the bare keyword drops the modifier and the
// lifted copy then throws on its first await, which looks like a broken test rather than a bad cut.
const from = BACKGROUND.indexOf('async function recordPermissionChainSignal');
const to = BACKGROUND.indexOf('\n}\n', from) + 2;
if (from < 0 || to <= from) throw new Error('recordPermissionChainSignal markers not found');

function runSignal(options) {
  const opts = options || {};
  const history = [];
  const sandbox = {
    Object, Array, String, Number, Math, JSON, Date, Boolean, RegExp,
    DEFAULT_CONFIG: { enabled: true, permissionChainGuard: true },
    PERMISSION_CHAIN_STATE: opts.state || {},
    // The window is mirrored to storage.session now (M17), so the handler restores it before it
    // records anything. This suite drives verdicts from an explicit in-memory state, so the mirror
    // only has to be a no-op here; tools/test-cold-start-state.js is what exercises it.
    PERMISSION_CHAIN_MIRROR: { ready: async () => {}, persist() {} },
    PERMISSION_CHAIN_WINDOW_MS: 120000,
    PERMISSION_CHAIN_WARN_COOLDOWN_MS: 60000,
    PERMISSION_CHAIN_DEFS: { camera: { label: 'Camera' }, microphone: { label: 'Microphone' }, geolocation: { label: 'Location' } },
    async localGet() { return { wardenone_config: { enabled: true, permissionChainGuard: true, allowlist: [] } }; },
    prunePermissionChainState() {},
    messageCleanHost: (u) => { try { return new URL(u).hostname; } catch (_) { return ''; } },
    registrableDomain: (h) => String(h || '').split('.').slice(-2).join('.'),
    hostMatchesAllowlist: () => false,
    cleanPermissionChainKey: (k) => (['camera', 'microphone', 'geolocation'].includes(k) ? k : ''),
    cleanPermissionChainAction: (a) => String(a || 'request'),
    permissionChainLabels: (list) => list.map((k) => k),
    permissionChainActionLabel: (a) => a,
    // A deliberately generous evaluator: it always returns High. That isolates what is being
    // tested -- if a warning still does not fire, only the corroboration gate can have stopped it.
    evaluatePermissionChain: () => ({ risk: 'High', score: 99, labels: ['Camera'], reasons: ['test'] }),
    queueHistory: (entry) => { history.push(entry); },
  };
  vm.createContext(sandbox);
  vm.runInContext(BACKGROUND.slice(from, to) + '\nglobalThis.__run = recordPermissionChainSignal;', sandbox);
  const sender = { tab: { id: 7, url: opts.url || 'https://claims.example/page' } };
  const msg = { permission: 'camera', action: 'request', userGesture: false };
  return { result: sandbox.__run(sender, msg, opts.granted || []), history };
}

// ---------------------------------------------------------------------------
// 1. The forgery. A page holds the token, invents a chain, and holds no real permissions.
// ---------------------------------------------------------------------------
{
  const forged = runSignal({ granted: [] });
  return Promise.resolve(forged.result).then((verdict) => {
    check('a forged chain with no real grants does not warn',
      verdict && verdict.warn !== true, 'warn was ' + (verdict && verdict.warn));
    check('a forged chain with no real grants writes no history',
      forged.history.length === 0, forged.history.length + ' entries written');

    // ---------------------------------------------------------------------------
    // 2. The genuine case still works, so the gate is not simply switching the feature off.
    // ---------------------------------------------------------------------------
    const real = runSignal({ granted: ['camera'] });
    return Promise.resolve(real.result).then((realVerdict) => {
      check('a chain on a site that really holds a sensitive permission still warns',
        realVerdict && realVerdict.warn === true, 'warn was ' + (realVerdict && realVerdict.warn));
      check('the genuine case still records history',
        real.history.length === 1 && real.history[0].type === 'warned_permission_chain');

      // ---------------------------------------------------------------------------
      // 3. Source shape: the token must not be described or used as authentication.
      // ---------------------------------------------------------------------------
      check('the worker gates the warning on worker-gathered corroboration',
        /const corroborated = \(granted \|\| \[\]\)/.test(BACKGROUND)
          && /&& corroborated/.test(BACKGROUND));
      check('the bridge documents the token as a routing nonce, not a secret',
        /A ROUTING NONCE, not a secret/.test(BRIDGE));
      check('the bridge still checks the token for routing',
        BRIDGE.includes('d.token !== TOKEN'));

      if (failed) { console.error('\n' + failed + ' permission-chain trust check(s) failed'); process.exit(1); }
      console.log('\npermission-chain trust boundary holds');
    });
  });
}

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start >= 0 && end > start, 'source markers: ' + from);
  return source.slice(start, end);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
process.exitCode = 1;

function harness() {
  const stored = { wardenone_script_shield_mode: 'smart', wardenone_js_global_block: false,
    wardenone_js_allowlist: ['trusted.net'] };
  const state = { stored, mode: 'smart', calls: [], blocked: false, failRules: false, pause: null };
  const sandbox = {
    URL, Promise,
    chrome: { contentSettings: {}, runtime: {} },
    SCRIPT_SHIELD_MODE_KEY: 'wardenone_script_shield_mode',
    CONTENT_SETTING_SCOPE: 'regular', GLOBAL_JS_PATTERNS: ['https://*/*', 'http://*/*'],
    localGet: async () => ({ ...stored }),
    localSet: async (values) => {
      state.calls.push(values.wardenone_script_shield_mode);
      if (state.pause) { const pause = state.pause; state.pause = null; await pause; }
      Object.assign(stored, values);
      return { persisted: true };
    },
    contentSettingApi: () => ({ clear(_details, callback) { state.blocked = false; callback(); } }),
    jsSettingGet: async () => state.blocked ? 'block' : 'allow',
    jsSettingSet: async (_patterns, setting) => { state.blocked = setting === 'block'; return true; },
    getTrustedScriptHosts: async () => [],
    applyScriptShieldRules: async (mode) => { state.mode = mode; return !state.failRules; },
    normalizeWebOrigin: (url) => new URL(url).origin,
    activeTabMatchesOrigin: async () => true,
    siteUrlPatterns: (url) => [new URL(url).origin + '/*'],
  };
  vm.createContext(sandbox);
  vm.runInContext(slice('const __subsystemQueues =', '// applyScriptShieldRules is deliberately absent')
    + slice('function normalizeScriptShieldMode(', '// Script hosts Smart mode')
    + slice('async function getScriptShieldMode()', 'async function getTrustedScriptHosts()')
    + '\nglobalThis.dispatch = (msg, sendResponse) => {\n'
    + slice("  const JS_ALLOWLIST_KEY = 'wardenone_js_allowlist';", '  // ---- Set one site permission') + '\n};', sandbox);
  state.send = (msg) => new Promise((resolve) => assert.equal(sandbox.dispatch(msg, resolve), true));
  return state;
}

(async () => {
  for (const older of [
    { kind: 'set-script-shield-mode', mode: 'normal' },
    { kind: 'set-javascript-state', scope: 'global', block: false },
  ]) {
    const h = harness();
    let release;
    h.pause = new Promise((resolve) => { release = resolve; });
    const first = h.send(older);
    await tick();
    let newerDone = false;
    const newer = h.send({ kind: 'set-script-shield-mode', mode: 'smart' }).then((reply) => { newerDone = true; return reply; });
    const reading = h.send({ kind: 'get-javascript-state' });
    await tick();
    assert.equal(newerDone, false, 'newer mode waits for older storage write');
    assert.deepEqual(h.calls, ['normal'], 'newer transition has no early side effects');
    release();
    assert.equal((await first).mode, 'normal');
    assert.equal((await newer).mode, 'smart');
    assert.equal((await reading).mode, 'smart');
    assert.equal(h.stored.wardenone_script_shield_mode, 'smart');
    assert.equal(h.mode, 'smart');
    assert.equal(h.blocked, false);
  }
  const h = harness();
  const replies = await Promise.all(['lockdown', 'normal', 'smart'].map((mode) => h.send({ kind: 'set-script-shield-mode', mode })));
  assert.deepEqual(replies.map((reply) => reply.mode), ['lockdown', 'normal', 'smart']);
  assert.equal(h.mode, 'smart');
  assert.equal(h.blocked, false);
  assert.deepEqual(h.stored.wardenone_js_allowlist, ['trusted.net'], 'Lockdown exceptions survive mode changes');
  h.failRules = true;
  assert.equal((await h.send({ kind: 'set-script-shield-mode', mode: 'normal' })).ok, false, 'DNR failure is reported');
  h.failRules = false;
  assert.equal((await h.send({ kind: 'set-script-shield-mode', mode: 'smart' })).ok, true, 'failure does not wedge the queue');
  console.log('[ok] Script Shield transitions, legacy writes and reads stay ordered');
  process.exitCode = 0;
})().catch((error) => console.error(error));

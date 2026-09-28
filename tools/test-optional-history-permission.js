/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const permissionsPage = fs.readFileSync(path.join(root, 'permissions.html'), 'utf8');
assert(!(manifest.permissions || []).includes('history'));
assert((manifest.optional_permissions || []).includes('history'));
assert(/Chrome may ask for history access when you turn this on/.test(fs.readFileSync(path.join(root, 'popup.html'), 'utf8')));
assert(/reconcileForgetHistoryPermission\(\);/.test(popup.slice(popup.indexOf('function load()'), popup.indexOf('function save('))));
assert(/<code>history<\/code><span class="request">Optional<\/span>/.test(permissionsPage));

const uiStart = popup.indexOf('function reconcileForgetHistoryPermission()');
const uiEnd = popup.indexOf('// WardenOne-owned storage', uiStart);
assert(uiStart >= 0 && uiEnd > uiStart);
const uiSource = popup.slice(uiStart, uiEnd);

function makeUi(grant, initialHistory = false) {
  const elements = {};
  for (const id of ['forget-enable', 'forget-history', 'forget-history-status']) {
    elements[id] = { checked: false, disabled: false, textContent: '', listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; } };
  }
  const calls = [];
  const config = { forgetMeHistory: initialHistory };
  const context = {
    config,
    $: (id) => elements[id] || null,
    chrome: { permissions: {
      request(details) { calls.push(['request', details.permissions]); return Promise.resolve(grant); },
      contains(details) { calls.push(['contains', details.permissions]); return Promise.resolve(grant); },
    } },
    save() { calls.push(['save', config.forgetMeHistory]); },
    paintForgetMe() {},
    window: { confirm: () => true },
  };
  vm.createContext(context);
  vm.runInContext(uiSource, context);
  return { elements, calls, config, context };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }

async function main() {
  const denied = makeUi(false);
  denied.elements['forget-history'].checked = true;
  denied.elements['forget-history'].listeners.change();
  assert.strictEqual(denied.calls[0][0], 'request', 'request happens during the user action');
  await flush();
  assert.strictEqual(denied.config.forgetMeHistory, false);
  assert.strictEqual(denied.elements['forget-history'].checked, false);
  assert(!denied.calls.some((call) => call[0] === 'save'));
  assert(/not granted/.test(denied.elements['forget-history-status'].textContent));

  const granted = makeUi(true);
  granted.elements['forget-history'].checked = true;
  granted.elements['forget-history'].listeners.change();
  await flush();
  assert.strictEqual(granted.config.forgetMeHistory, true);
  assert(granted.calls.some((call) => call[0] === 'save' && call[1] === true));
  granted.elements['forget-history'].checked = false;
  granted.elements['forget-history'].listeners.change();
  assert.strictEqual(granted.config.forgetMeHistory, false);

  const revoked = makeUi(false, true);
  revoked.context.reconcileForgetHistoryPermission();
  await flush();
  assert.strictEqual(revoked.config.forgetMeHistory, false);
  assert(revoked.calls.some((call) => call[0] === 'save' && call[1] === false));
  assert(/Turn this on again/.test(revoked.elements['forget-history-status'].textContent));

  const workerStart = background.indexOf('async function getForgetConfig()');
  const workerEnd = background.indexOf('function forgetHostFromUrl', workerStart);
  assert(workerStart >= 0 && workerEnd > workerStart);
  const workerSource = background.slice(workerStart, workerEnd) + '\nglobalThis.getForgetConfig = getForgetConfig;';
  for (const allow of [false, true]) {
    const worker = {
      localGet: async () => ({ wardenone_config: { forgetMeMode: 'all', forgetMeAllConfirmedAt: 1, forgetMeHistory: true } }),
      chrome: { permissions: { contains: async () => allow } },
      normalizeAllowlistHosts: (list) => list,
      activeAllowlist: () => [],
    };
    vm.createContext(worker);
    vm.runInContext(workerSource, worker);
    const result = await worker.getForgetConfig();
    assert.strictEqual(result.history, allow, 'worker must follow the live grant');
    assert.strictEqual(result.mode, 'all', 'cookie and storage cleanup remains enabled');
  }
  assert(/if \(cfg\.history\) \{[\s\S]*?chrome\.history\.search/.test(background));
  console.log('[ok] optional history permission: grant, denial, revocation and background gate');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

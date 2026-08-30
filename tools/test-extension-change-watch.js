/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Regression tests for the version-aware installed-extension change watcher. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync('background-extension-watch.js', 'utf8');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fakeEvent() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    fire(...args) { for (const fn of listeners) fn(...args); },
    listeners,
  };
}

function makeExtension(id, overrides) {
  return Object.assign({
    id,
    type: 'extension',
    name: 'Extension ' + id,
    version: '1.0.0',
    enabled: true,
    installType: 'normal',
    permissions: ['storage'],
    hostPermissions: [],
  }, overrides || {});
}

function createHarness(options) {
  const opts = options || {};
  const events = {
    installed: fakeEvent(),
    enabled: fakeEvent(),
    disabled: fakeEvent(),
    uninstalled: fakeEvent(),
    alarm: fakeEvent(),
    storage: fakeEvent(),
    notificationClick: fakeEvent(),
  };
  const state = {
    storage: clone(opts.storage || { wardenone_config: { enabled: true, watchExtensionPermissions: true } }),
    extensions: clone(opts.extensions || []),
    notifications: [],
    badge: '',
    history: [],
    tabsCreated: [],
    alarmsCreated: [],
    notificationClears: [],
    timers: [],
  };

  const context = {
    console,
    Date,
    Error,
    JSON,
    Math,
    Object,
    Array,
    Set,
    Map,
    Number,
    String,
    RegExp,
    Promise,
    globalThis: null,
    setTimeout(fn) { state.timers.push(fn); return state.timers.length; },
    localGet: async (keys) => {
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) if (Object.prototype.hasOwnProperty.call(state.storage, key)) out[key] = clone(state.storage[key]);
        return out;
      }
      return Object.prototype.hasOwnProperty.call(state.storage, keys) ? { [keys]: clone(state.storage[keys]) } : {};
    },
    localSet: async (update) => {
      for (const key of Object.keys(update || {})) state.storage[key] = clone(update[key]);
    },
    queueHistory: (entry) => state.history.push(clone(entry)),
    chrome: {
      runtime: {
        id: 'wardenone-self',
        lastError: null,
        getURL: (path) => 'chrome-extension://wardenone-self/' + path,
      },
      management: {
        getAll(callback) {
          if (opts.getAllError) {
            context.chrome.runtime.lastError = { message: opts.getAllError };
            if (typeof callback === 'function') callback([]);
            context.chrome.runtime.lastError = null;
            return undefined;
          }
          const value = clone(state.extensions);
          if (typeof callback === 'function') { callback(value); return undefined; }
          return Promise.resolve(value);
        },
        onInstalled: events.installed,
        onEnabled: events.enabled,
        onDisabled: events.disabled,
        onUninstalled: events.uninstalled,
      },
      alarms: {
        get(name, callback) { callback(null); },
        create(name, details) { state.alarmsCreated.push({ name, details: clone(details) }); },
        onAlarm: events.alarm,
      },
      storage: { onChanged: events.storage },
      notifications: {
        create(id, details) { state.notifications.push({ id, details: clone(details) }); },
        clear(id) { state.notificationClears.push(id); },
        onClicked: events.notificationClick,
      },
      action: {
        setBadgeText(details) { state.badge = details.text; },
        setBadgeBackgroundColor() {},
        getBadgeText(details, callback) { callback(state.badge); },
      },
      tabs: { create(details) { state.tabsCreated.push(clone(details)); } },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'background-extension-watch.js' });
  return { context, state, events, watch: context.__woExtensionWatchTest };
}

async function flushScheduled(harness) {
  const timers = harness.state.timers.splice(0);
  for (const fn of timers) fn();
  await harness.watch.reconcileExtensionChanges('test-drain');
}

function alerts(harness) {
  return harness.state.storage.wardenone_ext_alerts || [];
}

async function main() {
  {
    const h = createHarness();
    assert(h.state.alarmsCreated.some((alarm) => alarm.name === 'wardenone-extension-watch'
      && alarm.details.periodInMinutes === 15), 'a periodic local reconciliation must backstop missed events');
    const low = h.watch.classifyExtensionRisk(makeExtension('low', { permissions: ['storage', 'alarms'] }));
    assert.strictEqual(low.level, 'low', 'storage + alarms should not be framed as risky');
    const allSites = h.watch.classifyExtensionRisk(makeExtension('all', { permissions: ['storage'], hostPermissions: ['<all_urls>'] }));
    assert.strictEqual(allSites.level, 'high', 'all-site reach should be high impact');
    const injection = h.watch.classifyExtensionRisk(makeExtension('inject', { permissions: ['scripting'], hostPermissions: ['<all_urls>'] }));
    assert(injection.score > allSites.score, 'all-sites + scripting should score above broad access alone');
    const credentialReach = h.watch.classifyExtensionRisk(makeExtension('creds', { permissions: ['cookies'], hostPermissions: ['<all_urls>'] }));
    assert.strictEqual(credentialReach.level, 'critical', 'cookies + broad host access should be critical capability reach');
    const localFiles = h.watch.classifyExtensionRisk(makeExtension('files', { hostPermissions: ['file:///*'] }));
    assert(localFiles.flags.some((text) => /local file URLs/.test(text)), 'file access needs an honest local-file label');
    assert(!localFiles.flags.some((text) => /all websites/.test(text)), 'file:// must not be mislabeled as all websites');
    const manyHosts = h.watch.classifyExtensionRisk(makeExtension('many-hosts', {
      hostPermissions: Array.from({ length: 25 }, (_, index) => 'https://site' + index + '.example/*'),
    }));
    assert(['medium', 'high'].includes(manyHosts.level), 'many separately listed hosts should not look like narrow access');
    const reduced = h.watch.describeExtensionDelta(
      { id: 'reduced', name: 'Reduced', version: '1', enabled: true, installType: 'normal', permissions: ['storage', 'cookies', '<all_urls>'] },
      { id: 'reduced', name: 'Reduced', version: '2', enabled: true, installType: 'normal', permissions: ['storage'] },
      Date.now());
    assert.strictEqual(reduced.severity, 'low', 'permission removal should be described as reduced risk, not a warning');
    assert(reduced.reasons.some((reason) => /Access decreased/.test(reason)));
    const sourceChanged = h.watch.describeExtensionDelta(
      { id: 'source', name: 'Source', version: '1', enabled: true, disabledReason: '', installType: 'normal', permissions: ['storage'] },
      { id: 'source', name: 'Source', version: '1', enabled: true, disabledReason: '', installType: 'sideload', permissions: ['storage'] },
      Date.now());
    assert.strictEqual(sourceChanged.severity, 'medium', 'a change to a sideloaded source should be visible for review');
    assert(sourceChanged.reasons.some((reason) => /outside Chrome/.test(reason)));
    const permissionApproval = h.watch.describeExtensionDelta(
      { id: 'approval', name: 'Approval', version: '1', enabled: false, disabledReason: '', installType: 'normal', permissions: ['storage'] },
      { id: 'approval', name: 'Approval', version: '1', enabled: false, disabledReason: 'permissions_increase', installType: 'normal', permissions: ['storage'] },
      Date.now());
    assert.strictEqual(permissionApproval.severity, 'medium');
    assert(/waiting for approval/.test(permissionApproval.summary));
  }

  {
    const h = createHarness({ extensions: [makeExtension('existing')] });
    const first = await h.watch.reconcileExtensionChanges('initial');
    assert.deepStrictEqual(Array.from(first), [], 'first inventory should establish a baseline without flooding');
    const baseline = h.state.storage.wardenone_ext_baseline;
    assert.strictEqual(baseline.schema, 3);
    assert.strictEqual(baseline.extensions.existing.version, '1.0.0');
    assert.strictEqual(baseline.extensions.existing.enabled, true);
    assert.strictEqual(alerts(h).length, 0);

    h.state.extensions.push(makeExtension('benign', { name: 'Helpful Notes', permissions: ['storage', 'alarms'] }));
    h.events.installed.fire(h.state.extensions[1]);
    await flushScheduled(h);
    assert.strictEqual(alerts(h).length, 1, 'a benign install should still be visible in the timeline');
    assert.strictEqual(alerts(h)[0].kind, 'installed');
    assert.strictEqual(alerts(h)[0].severity, 'low');
    assert.strictEqual(h.state.notifications.length, 0, 'a benign install must not interrupt the user');

    h.state.extensions[1] = makeExtension('benign', {
      name: 'Totally Trusted Security Tool',
      version: '2.0.0',
      permissions: ['storage', 'cookies'],
      hostPermissions: ['<all_urls>'],
    });
    h.events.installed.fire(h.state.extensions[1]);
    h.events.enabled.fire(h.state.extensions[1]);
    await flushScheduled(h);
    const updateEvents = alerts(h).filter((event) => event.id === 'benign' && event.kind === 'updated');
    assert.strictEqual(updateEvents.length, 1, 'concurrent update/load signals should coalesce into one event');
    assert.strictEqual(updateEvents[0].fromVersion, '1.0.0');
    assert.strictEqual(updateEvents[0].toVersion, '2.0.0');
    assert(updateEvents[0].gainedPermissions.includes('cookies'));
    assert(updateEvents[0].gainedPermissions.includes('<all_urls>'));
    assert.strictEqual(updateEvents[0].severity, 'critical', 'trusted-looking names must not suppress a dangerous access delta');
    assert.strictEqual(h.state.notifications.length, 1);
    assert.strictEqual(h.state.badge, '!');
    assert(h.state.history.some((entry) => entry.type === 'extension_change' && entry.detail.kind === 'updated'));

    h.state.extensions[1].version = '2.0.1';
    h.events.installed.fire(h.state.extensions[1]);
    await flushScheduled(h);
    const harmlessUpdate = alerts(h)[0];
    assert.strictEqual(harmlessUpdate.kind, 'updated');
    assert.strictEqual(harmlessUpdate.severity, 'low');
    assert(harmlessUpdate.reasons.some((reason) => /No new permissions/.test(reason)));
    assert.strictEqual(h.state.notifications.length, 1, 'version-only updates belong in the timeline, not notifications');

    h.state.extensions[1].enabled = false;
    h.events.disabled.fire('benign');
    await flushScheduled(h);
    assert.strictEqual(alerts(h)[0].kind, 'disabled');
    assert.strictEqual(alerts(h)[0].severity, 'low');

    h.state.extensions[1].enabled = true;
    h.events.enabled.fire(h.state.extensions[1]);
    await flushScheduled(h);
    assert.strictEqual(alerts(h)[0].kind, 'enabled');
    assert.strictEqual(alerts(h)[0].severity, 'high', 're-enabling a critical-capability extension deserves attention');

    h.state.extensions = h.state.extensions.filter((item) => item.id !== 'benign');
    h.events.uninstalled.fire('benign');
    await flushScheduled(h);
    assert.strictEqual(alerts(h)[0].kind, 'removed');
    assert.strictEqual(alerts(h)[0].name, 'Totally Trusted Security Tool');
    assert(!h.state.storage.wardenone_ext_baseline.extensions.benign);

    const importantBefore = alerts(h).filter((event) => !event.reviewedAt && ['medium', 'high', 'critical'].includes(event.severity));
    assert(importantBefore.length > 0);
    await h.watch.acknowledgeExtensionAlerts();
    assert(alerts(h).every((event) => event.reviewedAt), 'acknowledgement should be explicit and durable');
    assert.strictEqual(h.state.badge, '');

    const notificationId = h.state.notifications[0].id;
    h.events.notificationClick.fire('unrelated-notification');
    assert.strictEqual(h.state.tabsCreated.length, 0, 'unrelated notification clicks must be ignored');
    h.events.notificationClick.fire(notificationId);
    assert.strictEqual(h.state.tabsCreated.length, 1);
    assert(/extensions\.html$/.test(h.state.tabsCreated[0].url));
  }

  {
    const h = createHarness({
      storage: {
        wardenone_config: { enabled: true, watchExtensionPermissions: true },
        wardenone_ext_baseline: { legacy: ['storage'] },
      },
      extensions: [makeExtension('legacy', { permissions: ['storage', 'downloads'] })],
    });
    await h.watch.reconcileExtensionChanges('legacy-migration');
    assert.strictEqual(alerts(h).length, 1, 'legacy permission arrays should be diffed, not erased');
    assert.strictEqual(alerts(h)[0].kind, 'permissions_changed');
    assert(alerts(h)[0].gainedPermissions.includes('downloads'));
    assert.strictEqual(h.state.storage.wardenone_ext_baseline.schema, 3);
  }

  {
    const h = createHarness({
      storage: { wardenone_config: { enabled: true, watchExtensionPermissions: true }, wardenone_ext_baseline: null },
      extensions: [makeExtension('recover')],
    });
    await h.watch.reconcileExtensionChanges('corrupt-baseline');
    assert.strictEqual(alerts(h).length, 0, 'a missing/corrupt baseline should recover without a mass accusation');
    assert(h.state.storage.wardenone_ext_baseline.extensions.recover);
  }

  {
    const oldBaseline = {
      schema: 2,
      capturedAt: 1,
      extensions: { keep: { id: 'keep', name: 'Keep', version: '1', enabled: true, installType: 'normal', permissions: ['storage'] } },
    };
    const h = createHarness({
      storage: { wardenone_config: { enabled: true, watchExtensionPermissions: true }, wardenone_ext_baseline: oldBaseline },
      getAllError: 'management API unavailable',
    });
    await h.watch.reconcileExtensionChanges('api-error');
    assert.strictEqual(h.state.storage.wardenone_ext_watch_status.state, 'error');
    assert(/management API unavailable/.test(h.state.storage.wardenone_ext_watch_status.lastError));
    assert(h.state.storage.wardenone_ext_baseline.extensions.keep, 'an API failure must not erase the last good inventory');
  }

  {
    const h = createHarness({
      storage: { wardenone_config: { enabled: true, watchExtensionPermissions: true, silentMode: true } },
      extensions: [],
    });
    await h.watch.reconcileExtensionChanges('initial');
    h.state.extensions.push(makeExtension('silent-risk', { permissions: ['nativeMessaging'], hostPermissions: ['<all_urls>'] }));
    await h.watch.reconcileExtensionChanges('install');
    assert.strictEqual(alerts(h).length, 1, 'silent mode must still keep the local ledger');
    assert.strictEqual(h.state.notifications.length, 0, 'silent mode should suppress the interruption only');
    assert.strictEqual(h.state.badge, '');
  }

  {
    const background = fs.readFileSync('background.js', 'utf8');
    const startup = fs.readFileSync('background-startup.js', 'utf8');
    const popup = fs.readFileSync('popup.js', 'utf8');
    const popupHtml = fs.readFileSync('popup.html', 'utf8');
    const history = fs.readFileSync('history.js', 'utf8');
    assert(background.includes("importScripts('background-extension-watch.js')"));
    assert(background.includes("importScripts('background-extension-reputation.js')"));
    assert(!startup.includes('await snapshotExtensionBaseline()'), 'startup must not overwrite a change before it is recorded');
    assert(popupHtml.includes('id="ext-alerts-ack"'), 'important changes need an explicit review action');
    assert(popup.includes("kind: 'ack-extension-alerts'"));
    assert(popup.includes('Extension Security Centre could not build the local report'), 'watcher failures must replace the reassuring empty state');
    assert(popup.includes('changes.wardenone_ext_alerts || changes.wardenone_ext_reviews'), 'an open popup should refresh when a change arrives');
    assert(popup.includes("chrome.runtime.getURL('extensions.html')"), 'the popup should open the full local review surface');
    const alertLoader = popup.slice(popup.indexOf('function loadExtensionAlerts()'), popup.indexOf("$('ext-alerts-clear')"));
    assert(!alertLoader.includes("setBadgeText({ text: '' })"), 'opening the popup must not silently acknowledge an alert');
    assert(history.includes("extension_change: 'Installed extension changed'"));
    assert(history.includes("e.type === 'extension_change'"));
  }

  console.log('extension change watcher tests passed');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

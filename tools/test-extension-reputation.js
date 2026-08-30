/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Regression tests for the local exact-ID extension reputation and review engine. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const WATCH_SOURCE = fs.readFileSync('background-extension-watch.js', 'utf8');
const REPUTATION_SOURCE = fs.readFileSync('background-extension-reputation.js', 'utf8');
const BUNDLED_DATABASE = JSON.parse(fs.readFileSync('extension-reputation.json', 'utf8'));
const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GREAT_SUSPENDER_ID = 'klbibkeccnjlkjkiokjodocebajanakg';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fakeEvent() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, fire(...args) { listeners.forEach((fn) => fn(...args)); }, listeners };
}

function extension(id, overrides) {
  return Object.assign({
    id,
    type: 'extension',
    name: 'Test extension',
    description: 'A test extension',
    version: '1.0.0',
    enabled: true,
    mayDisable: true,
    disabledReason: '',
    installType: 'normal',
    permissions: ['storage'],
    hostPermissions: [],
  }, overrides || {});
}

function customDatabase(id, status, affected) {
  return {
    schema: 1,
    datasetVersion: 'local-test',
    generatedAt: '2026-08-30',
    sources: {
      test: { label: 'Local test evidence', reference: 'https://example.invalid/evidence', retrievedAt: '2026-08-30' },
    },
    entries: {
      [id]: {
        name: 'Evidence name is display-only',
        status,
        reason: 'An evidence-backed exact-ID test record.',
        categories: ['test'],
        affected: affected || { kind: 'all_versions' },
        source: 'test',
        reviewedAt: '2026-08-30',
      },
    },
  };
}

function createHarness(options) {
  const opts = options || {};
  const events = {
    installed: fakeEvent(), enabled: fakeEvent(), disabled: fakeEvent(), uninstalled: fakeEvent(),
    alarm: fakeEvent(), storage: fakeEvent(), notificationClick: fakeEvent(),
  };
  const state = {
    storage: clone(opts.storage || { wardenone_config: { enabled: true, watchExtensionPermissions: true } }),
    extensions: clone(opts.extensions || []),
    fetches: [], notifications: [], history: [], badge: '', timers: [], removed: [], disabled: [],
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
    URL,
    globalThis: null,
    setTimeout(fn) { state.timers.push(fn); return state.timers.length; },
    fetch: async (url) => {
      state.fetches.push(String(url));
       if (opts.databaseError) throw new Error(opts.databaseError);
       return { ok: true, async json() { return clone(opts.bundledDatabase || BUNDLED_DATABASE); } };
    },
    localGet: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      list.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(state.storage, key)) out[key] = clone(state.storage[key]);
      });
      return out;
    },
    localSet: async (update) => {
      Object.keys(update || {}).forEach((key) => { state.storage[key] = clone(update[key]); });
    },
    localRemove: async (key) => { delete state.storage[key]; },
    queueHistory: (entry) => state.history.push(clone(entry)),
    chrome: {
      runtime: {
        id: 'wardenone-self',
        lastError: null,
        getURL: (path) => 'chrome-extension://wardenone-self/' + path,
      },
      management: {
        getAll(callback) {
          const value = clone(state.extensions);
          if (typeof callback === 'function') { callback(value); return undefined; }
          return Promise.resolve(value);
        },
        getPermissionWarningsById(id, callback) {
          const warnings = clone((opts.permissionWarnings && opts.permissionWarnings[id]) || []);
          if (typeof callback === 'function') { callback(warnings); return undefined; }
          return Promise.resolve(warnings);
        },
        async setEnabled(id, enabled) { state.disabled.push({ id, enabled }); },
        async uninstall(id, details) { state.removed.push({ id, details: clone(details) }); },
        onInstalled: events.installed,
        onEnabled: events.enabled,
        onDisabled: events.disabled,
        onUninstalled: events.uninstalled,
      },
      alarms: {
        get(name, callback) { callback({ name }); },
        create() {},
        onAlarm: events.alarm,
      },
      storage: { onChanged: events.storage },
      notifications: {
        create(id, details) { state.notifications.push({ id, details: clone(details) }); },
        clear() {},
        onClicked: events.notificationClick,
      },
      action: {
        setBadgeText(details) { state.badge = details.text; },
        setBadgeBackgroundColor() {},
        getBadgeText(details, callback) { callback(state.badge); },
      },
      tabs: { create() {} },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(WATCH_SOURCE, context, { filename: 'background-extension-watch.js' });
  vm.runInContext(REPUTATION_SOURCE, context, { filename: 'background-extension-reputation.js' });
  return { state, context, rep: context.__woExtensionReputationTest, watch: context.__woExtensionWatchTest };
}

async function rejects(promise, pattern) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert(error, 'expected the operation to reject');
  assert(pattern.test(String(error.message || error)), 'unexpected error: ' + String(error.message || error));
}

async function main() {
  {
    assert.strictEqual(BUNDLED_DATABASE.schema, 1);
    assert(/^\d{4}\.\d{2}\.\d{2}\./.test(BUNDLED_DATABASE.datasetVersion));
    const ids = Object.keys(BUNDLED_DATABASE.entries);
    assert(ids.length >= 21, 'the local catalogue should contain the curated official identities and attributable incident records');
    assert(ids.every((id) => /^[a-p]{32}$/.test(id)), 'database entries must be exact Chrome extension IDs');
    assert.strictEqual(new Set(ids).size, ids.length);
    assert(!JSON.stringify(BUNDLED_DATABASE).includes('known_safe'), 'the database must not invent an absolute safe state');
    assert(BUNDLED_DATABASE.capabilitySignatures.length >= 8, 'capability rules should be data-driven and inspectable');
    for (const [id, version] of [
      ['bigefpfhnfcobdlfbedofhhaibnlghod', '3.39.4'],
      ['bfbameneiokkgbdmiekhjnmfkcnldhhm', '0.4.9'],
      ['eenjdnjldapjajjofmldgmkjaienebbj', '2.8.5'],
    ]) {
      assert.deepStrictEqual(BUNDLED_DATABASE.entries[id].affected, { kind: 'versions', versions: [version] },
        'historical malware evidence must stay bound to the documented affected version');
    }
  }

  const h = createHarness();
  const api = h.rep;
  {
    const malformed = {
      schema: 1,
      entries: {
        short: customDatabase(ID_A, 'known_harmful').entries[ID_A],
        [ID_A]: Object.assign({}, customDatabase(ID_A, 'known_harmful').entries[ID_A], { status: 'known_safe' }),
      },
    };
    const checked = api.validateExtensionReputationDatabase(malformed, { origin: 'custom' });
    assert(checked.ok, 'malformed rows should be ignored without broadening a match');
    assert.strictEqual(Object.keys(checked.database.entries).length, 0);
    assert(checked.errors.some((item) => /ignored/.test(item)));
  }

  {
    const database = await api.loadCombinedExtensionReputation();
    assert.strictEqual(h.state.fetches.length, 1);
    assert.strictEqual(h.state.fetches[0], 'chrome-extension://wardenone-self/extension-reputation.json');
    assert(h.state.fetches.every((url) => url.startsWith('chrome-extension://')), 'database loading must never make an outbound request');
    const incident = api.lookupExtensionReputation(extension(GREAT_SUSPENDER_ID), database);
    assert.strictEqual(incident.status, 'historical_incident');
    assert.strictEqual(incident.exactMatch, true);
    const spoof = api.lookupExtensionReputation(extension(ID_A, { name: 'The Great Suspender (legacy listing)' }), database);
    assert.strictEqual(spoof.status, 'no_record', 'a copied display name must never match a reputation record');
    assert(/not proof/.test(spoof.reason));
    assert.strictEqual(api.lookupExtensionReputation(extension('bigefpfhnfcobdlfbedofhhaibnlghod', { version: '3.39.4' }), database).status,
      'historical_incident');
    assert.strictEqual(api.lookupExtensionReputation(extension('bigefpfhnfcobdlfbedofhhaibnlghod', { version: '3.39.5' }), database).status,
      'no_record', 'a repaired version must not inherit a version-scoped incident verdict');
  }

  {
    const checked = api.validateExtensionReputationDatabase(customDatabase(ID_A, 'known_harmful', {
      kind: 'ranges', ranges: [{ min: '2.0.0', max: '2.4.9' }],
    }), { origin: 'custom' });
    const database = {
      available: true,
      entries: checked.database.entries,
      capabilitySignatures: [],
    };
    assert.strictEqual(api.lookupExtensionReputation(extension(ID_A, { version: '2.0.0' }), database).status, 'known_harmful');
    assert.strictEqual(api.lookupExtensionReputation(extension(ID_A, { version: '2.4.9' }), database).status, 'known_harmful');
    assert.strictEqual(api.lookupExtensionReputation(extension(ID_A, { version: '2.5.0' }), database).status, 'no_record');
    assert(api.compareChromeVersions('10.2.0', '9.20.0') > 0, 'Chrome versions need numeric dotted comparison');
  }

  {
    const bundled = customDatabase(ID_A, 'known_harmful', { kind: 'versions', versions: ['1.0.0'] });
    bundled.datasetVersion = 'overlap-test';
    const custom = customDatabase(ID_A, 'reported_harmful', { kind: 'all_versions' });
    const overlap = createHarness({
      bundledDatabase: bundled,
      storage: {
        wardenone_config: { enabled: true, watchExtensionPermissions: true },
        wardenone_ext_reputation_custom: custom,
      },
    });
    const database = await overlap.rep.loadCombinedExtensionReputation();
    assert.strictEqual(overlap.rep.lookupExtensionReputation(extension(ID_A, { version: '1.0.0' }), database).status, 'known_harmful',
      'the strongest matching record should win');
    assert.strictEqual(overlap.rep.lookupExtensionReputation(extension(ID_A, { version: '2.0.0' }), database).status, 'reported_harmful',
      'an out-of-range stronger record must not hide a valid version-matching warning');
  }

  {
    const database = await api.loadCombinedExtensionReputation();
    const powerful = extension(ID_A, {
      name: 'Friendly Security Helper', permissions: ['storage', 'scripting'], hostPermissions: ['<all_urls>'],
    });
    const assessment = api.buildExtensionAssessment(powerful, database, {}, [], []);
    assert.strictEqual(assessment.reputation.status, 'no_record');
    assert(['high', 'critical'].includes(assessment.access.level));
    assert.strictEqual(assessment.verdict.code, 'powerful_access');
    assert(!/malicious/i.test(assessment.verdict.label), 'permissions must not be turned into a malware accusation');

    const low = api.buildExtensionAssessment(extension(ID_B), database, {}, [], []);
    assert.strictEqual(low.verdict.label, 'NO KNOWN WARNING');
    assert(!/safe|clean/i.test(low.verdict.label), 'unknown must never be rendered as safe or clean');

    const reviewed = api.buildExtensionAssessment(powerful, database, {
      [ID_A]: { reviewedAt: Date.now(), snapshot: assessment.review.snapshot },
    }, [], []);
    assert.strictEqual(reviewed.review.reviewed, true);
    assert.strictEqual(reviewed.verdict.code, 'reviewed_snapshot');

    const reordered = extension(ID_A, {
      name: powerful.name, permissions: ['scripting', 'storage'], hostPermissions: ['<all_urls>'],
    });
    const stillReviewed = api.buildExtensionAssessment(reordered, database, {
      [ID_A]: { reviewedAt: Date.now(), snapshot: assessment.review.snapshot },
    }, [], []);
    assert.strictEqual(stillReviewed.review.reviewed, true, 'permission ordering alone must not invalidate review');

    const renamed = extension(ID_A, {
      name: 'New display identity', permissions: ['storage', 'scripting'], hostPermissions: ['<all_urls>'],
    });
    const stale = api.buildExtensionAssessment(renamed, database, {
      [ID_A]: { reviewedAt: Date.now(), snapshot: assessment.review.snapshot },
    }, [], []);
    assert.strictEqual(stale.review.stale, true);
    assert.strictEqual(stale.verdict.code, 'review_stale');
  }

  {
    const checked = api.validateExtensionReputationDatabase(customDatabase(ID_A, 'known_harmful'), { origin: 'custom' });
    const database = { available: true, entries: checked.database.entries, capabilitySignatures: [] };
    const item = extension(ID_A, { enabled: false });
    const unreviewed = api.buildExtensionAssessment(item, database, {}, [], []);
    const forcedReview = { [ID_A]: { reviewedAt: Date.now(), snapshot: unreviewed.review.snapshot } };
    const assessed = api.buildExtensionAssessment(item, database, forcedReview, [], []);
    assert.strictEqual(assessed.verdict.code, 'known_harmful', 'disabled/reviewed state must not override exact harmful evidence');
    assert.strictEqual(assessed.verdict.needsAttention, true);
  }

  {
    const localDb = customDatabase(ID_A, 'known_harmful');
    const reportHarness = createHarness({
      extensions: [extension(ID_A, { name: 'Looks harmless' }), extension(ID_B)],
      storage: {
        wardenone_config: { enabled: true, watchExtensionPermissions: true },
        wardenone_ext_reputation_custom: localDb,
      },
      permissionWarnings: { [ID_A]: ['Read your browsing history'] },
    });
    const first = await reportHarness.rep.buildExtensionSecurityReport({ trigger: 'test' });
    assert.strictEqual(first.localOnly, true);
    assert.strictEqual(first.summary.installed, 2);
    assert.strictEqual(first.summary.knownHarmful, 1);
    assert.strictEqual(first.extensions[0].id, ID_A, 'actionable exact matches should sort first');
    assert(first.extensions[0].access.chromeWarnings.includes('Read your browsing history'));
    assert.strictEqual((reportHarness.state.storage.wardenone_ext_alerts || []).filter((event) => event.kind === 'reputation_changed').length, 1,
      'a pre-existing harmful match should create a first-run local alert');
    await reportHarness.rep.buildExtensionSecurityReport({ trigger: 'repeat' });
    assert.strictEqual((reportHarness.state.storage.wardenone_ext_alerts || []).filter((event) => event.kind === 'reputation_changed').length, 1,
      'unchanged reputation must not alert repeatedly');
    assert(reportHarness.state.fetches.every((url) => url.startsWith('chrome-extension://')));
  }

  {
    const reviewHarness = createHarness({
      extensions: [extension(ID_A)],
      storage: {
        wardenone_config: { enabled: true, watchExtensionPermissions: true },
        wardenone_ext_alerts: [{ id: ID_A, eventId: 'change-1', kind: 'updated', severity: 'high', reviewedAt: null }],
      },
    });
    await reviewHarness.rep.reviewExtensionSnapshotById(ID_A);
    assert(reviewHarness.state.storage.wardenone_ext_reviews[ID_A]);
    assert(reviewHarness.state.storage.wardenone_ext_alerts[0].reviewedAt, 'snapshot review should acknowledge that extension\'s matching change alert');
    /* A version bump on its own must NOT re-arm review. Chrome updates
       extensions constantly and this used to refill "Needs attention" with
       REVIEW UPDATE cards for things nobody had touched -- including extensions
       with no meaningful access at all. A warning that appears for every routine
       update is one people learn to clear without reading, which costs more than
       it buys. The version move is still recorded on the change timeline. */
    reviewHarness.state.extensions[0].version = '2.0.0';
    const report = await reviewHarness.rep.buildExtensionSecurityReport({ trigger: 'version-change' });
    const item = report.extensions.find((entry) => entry.id === ID_A);
    assert.strictEqual(item.review.stale, false, 'a version bump alone must not re-arm exact-snapshot review');

    /* What a version bump SHOULD re-arm on: the update actually changing what
       the extension can reach. That is the event a review answers a question
       about. */
    reviewHarness.state.extensions[0].version = '3.0.0';
    reviewHarness.state.extensions[0].permissions = ['storage', 'scripting', 'cookies'];
    const afterPerms = await reviewHarness.rep.buildExtensionSecurityReport({ trigger: 'permission-change' });
    const changed = afterPerms.extensions.find((entry) => entry.id === ID_A);
    assert.strictEqual(changed.review.stale, true, 'an update that gains a permission must re-arm review');

    reviewHarness.state.storage.wardenone_ext_reputation_custom = customDatabase(ID_A, 'known_harmful');
    await rejects(reviewHarness.rep.reviewExtensionSnapshotById(ID_A), /known-harmful/);
  }

  {
    const importHarness = createHarness();
    const imported = await importHarness.rep.importExtensionReputationDatabase(customDatabase(ID_A, 'reported_harmful'));
    assert.strictEqual(imported.imported, 1);
    assert(importHarness.state.storage.wardenone_ext_reputation_custom.entries[ID_A]);
    await rejects(importHarness.rep.importExtensionReputationDatabase({ schema: 1, entries: { invalid: {} } }), /no valid exact extension IDs/);
    await rejects(importHarness.rep.importExtensionReputationDatabase({ schema: 1, description: 'x'.repeat(2 * 1024 * 1024 + 1), entries: {} }), /larger than 2 MB/);
    await importHarness.rep.clearImportedExtensionReputation();
    assert(!importHarness.state.storage.wardenone_ext_reputation_custom);
  }

  {
    const unavailable = createHarness({ databaseError: 'local asset missing' });
    const database = await unavailable.rep.loadCombinedExtensionReputation();
    const assessment = unavailable.rep.buildExtensionAssessment(extension(ID_A), database, {}, [], []);
    assert.strictEqual(assessment.reputation.status, 'database_unavailable');
    assert.strictEqual(assessment.verdict.code, 'database_unavailable');
    assert(!/safe|clean/i.test(assessment.reputation.label));
  }

  {
    const prior = {
      status: 'known_harmful', recordDigest: 'last-validated-record', name: 'Test extension', version: '1.0.0',
    };
    const outage = createHarness({
      storage: {
        wardenone_config: { enabled: true, watchExtensionPermissions: true },
        wardenone_ext_reputation_state: { schema: 1, checkedAt: 1, extensions: { [ID_A]: prior } },
        wardenone_ext_alerts: [{ id: ID_B, eventId: 'real-change', kind: 'permissions_changed', severity: 'high', reviewedAt: null }],
      },
    });
    const unavailableDatabase = { available: false, error: 'temporary read failure', entries: {}, capabilitySignatures: [] };
    const assessment = outage.rep.buildExtensionAssessment(extension(ID_A), unavailableDatabase, {}, [], []);
    const events = await outage.rep.persistExtensionReputationState([assessment]);
    assert.strictEqual(events.length, 0, 'database outages must not manufacture per-extension reputation changes');
    assert.deepStrictEqual(outage.state.storage.wardenone_ext_reputation_state.extensions[ID_A], prior,
      'the last validated reputation state must survive a temporary database outage');
    assert.strictEqual(outage.state.storage.wardenone_ext_alerts.length, 1,
      'a database outage must not evict the real extension-change ledger');
  }

  {
    const watcher = createHarness().watch;
    const previous = {
      id: ID_A, name: 'Cross-boundary', version: '1', enabled: true, disabledReason: '',
      installType: 'normal', permissions: ['<all_urls>'],
    };
    const current = Object.assign({}, previous, { version: '2', permissions: ['<all_urls>', 'scripting'] });
    const change = watcher.describeExtensionDelta(previous, current, Date.now());
    assert(['high', 'critical'].includes(change.severity), 'new scripting must be combined with existing all-site reach');
    assert(change.reasons.some((reason) => /combined with script injection/.test(reason)));

    const approval = watcher.describeExtensionDelta(
      Object.assign({}, previous, { version: '1', permissions: ['storage'] }),
      Object.assign({}, current, {
        version: '2', enabled: false, disabledReason: 'permissions_increase', permissions: ['storage', 'tabs'],
      }),
      Date.now(),
    );
    assert(approval && approval.severity !== 'low');
    assert(/disabled it until you approve/.test(approval.summary));
    assert(approval.reasons.some((reason) => /approve.*increased access/.test(reason)));
    assert.strictEqual(watcher.extensionNotificationTitle({ kind: 'reputation_changed', severity: 'critical' }),
      'Critical local extension reputation match');
  }

  {
    const html = fs.readFileSync('extensions.html', 'utf8');
    const page = fs.readFileSync('extensions.js', 'utf8');
    const popup = fs.readFileSync('popup.js', 'utf8');
    const popupHtml = fs.readFileSync('popup.html', 'utf8');
    const background = fs.readFileSync('background.js', 'utf8');
    assert(html.includes('Extension Security Centre'));
    assert(html.includes('No extension IDs uploaded'));
    /* The long "what this can and cannot prove" panel was removed from the page
       -- it was a wall of text at the bottom that nobody scrolled to. The claim
       it protected has to survive somewhere people actually read, so it now sits
       in the database panel copy. This checks the sentence exists, not where the
       markup happens to put it. */
    assert(/not that it is safe/i.test(page) || /not [“"]safe/.test(html),
      'the "no local record does not mean safe" wording was lost');
    assert(html.includes('Mark change alerts reviewed'));
    assert(page.includes('Accept current access'));
    assert(page.includes("chrome.management.setEnabled(id, false, done)"));
    assert(page.includes("chrome.management.uninstall(id, { showConfirmDialog: true }, done)"));
    assert(page.includes('View evidence source'));
    assert(!page.includes('.innerHTML'), 'extension-controlled strings must not enter an HTML sink');
    assert(page.includes('textContent'));
    assert(popup.includes("chrome.runtime.getURL('extensions.html')"));
    assert(popupHtml.includes('Review installed extensions') && popupHtml.includes('id="ext-result"'),
      'the quick installed-extension review must remain available in the popup');
    assert(popup.includes('item.recommendedAction') && !popup.includes("'Reputation: '"),
      'the restored quick review must show the engine conclusion without a repetitive debug dump');
    assert(background.includes("messageSenderIsExtensionPath(sender, 'extensions.html')"));
    ['import-extension-reputation'].forEach((kind) => {
      assert(background.includes("msg.kind === '" + kind + "'"));
    });
    assert(!background.includes("msg.kind === 'disable-installed-extension'")
      && !background.includes("msg.kind === 'remove-installed-extension'"),
    'gesture-required management actions must not be relayed through the service worker');
    assert(html.includes('aria-pressed="true"') && html.includes('data-filter="changed"'));
    assert(/data-wardenone-theme-resolved="dark"[^\n]+\.summary-card/.test(html),
      'the full centre must replace translucent light surfaces in dark mode');
    assert(REPUTATION_SOURCE.includes("chrome.runtime.getURL('extension-reputation.json')"));
    assert(!/fetch\(\s*['\"]https?:/i.test(REPUTATION_SOURCE), 'reputation worker must have no external fetch destination');
  }

  console.log('extension reputation tests passed');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

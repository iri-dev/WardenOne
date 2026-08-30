/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne -- installed-extension change watch (MV3 service worker)
 *
 * Chrome does not let one extension inspect another extension's source code or
 * decide whether it is malware. This module therefore watches facts Chrome does
 * expose: version, enabled state, install source, host reach and API permissions.
 * It records every meaningful change, but only interrupts the user when a change
 * adds a genuinely powerful capability.
 */

/* global chrome, localGet, localSet, queueHistory */
'use strict';

var EXT_BASELINE_KEY = 'wardenone_ext_baseline';
var EXT_ALERTS_KEY = 'wardenone_ext_alerts';
var EXT_WATCH_STATUS_KEY = 'wardenone_ext_watch_status';
var EXT_ALERTS_MAX = 60;
var EXT_WATCH_SCHEMA = 3;
var EXT_WATCH_ALARM = 'wardenone-extension-watch';
var EXT_WATCH_INTERVAL_MINUTES = 15;

var EXT_ALL_SITE_HOSTS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);
var EXT_PERMISSION_CAPABILITIES = Object.freeze({
  '<all_urls>': { weight: 5, label: 'Can read or change data across all websites' },
  tabs: { weight: 1, label: 'Can see open tabs and their URLs' },
  history: { weight: 3, label: 'Can read browsing history' },
  cookies: { weight: 4, label: 'Can read or change cookies, including sign-in sessions' },
  webRequest: { weight: 2, label: 'Can observe network requests' },
  webRequestBlocking: { weight: 4, label: 'Can block or modify network requests' },
  proxy: { weight: 7, label: 'Can route browser traffic through a proxy' },
  debugger: { weight: 7, label: 'Can control tabs through Chrome\'s powerful debugger interface' },
  management: { weight: 5, label: 'Can manage other installed extensions' },
  nativeMessaging: { weight: 7, label: 'Can communicate with programs installed on this computer' },
  clipboardRead: { weight: 3, label: 'Can read the clipboard' },
  declarativeNetRequestWithHostAccess: { weight: 3, label: 'Can change network requests on sites it can access' },
  downloads: { weight: 2, label: 'Can view and manage downloads' },
  scripting: { weight: 1, label: 'Can inject scripts into permitted pages' },
});
var EXT_ATTENTION_LEVELS = new Set(['medium', 'high', 'critical']);
var EXT_RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function extPermSet(ext) {
  var out = new Set();
  for (const permission of (ext && ext.permissions) || []) out.add(String(permission));
  for (const hostPermission of (ext && ext.hostPermissions) || []) {
    const host = String(hostPermission);
    if (EXT_ALL_SITE_HOSTS.has(host)) out.add('<all_urls>');
    else out.add('host:' + host);
  }
  return out;
}

function extensionCapability(token) {
  const raw = String(token || '');
  if (EXT_PERMISSION_CAPABILITIES[raw]) {
    const item = EXT_PERMISSION_CAPABILITIES[raw];
    return { permission: raw, weight: item.weight, label: item.label };
  }
  if (raw === 'host:file:///*' || raw.startsWith('host:file://')) {
    return { permission: raw, weight: 4, label: 'Can access local file URLs when Chrome file access is enabled' };
  }
  return null;
}

function extensionPermissionLabel(token) {
  const capability = extensionCapability(token);
  if (capability) return capability.label;
  const raw = String(token || '');
  if (raw.startsWith('host:')) return 'Can access ' + raw.slice(5);
  return 'Added Chrome permission: ' + raw;
}

function extensionRiskLevel(score) {
  if (score >= 10) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function extensionRiskFromTokens(tokens, installType) {
  const set = tokens instanceof Set ? tokens : new Set(Array.isArray(tokens) ? tokens : []);
  const capabilities = [];
  let score = 0;
  for (const token of set) {
    const capability = extensionCapability(token);
    if (!capability) continue;
    capabilities.push(capability);
    score += capability.weight;
  }

  const broad = set.has('<all_urls>');
  if (broad && set.has('scripting')) {
    score += 2;
    capabilities.push({ permission: 'combination:broad-scripting', weight: 2, label: 'Broad site access is combined with script injection' });
  }
  if (broad && (set.has('cookies') || set.has('history'))) {
    score += 2;
    capabilities.push({ permission: 'combination:broad-sensitive-data', weight: 2, label: 'Broad site access is combined with sensitive browser data access' });
  }
  const finiteHostCount = Array.from(set).filter((token) => token.startsWith('host:') && !token.startsWith('host:file://')).length;
  if (finiteHostCount >= 8) {
    const hostWeight = finiteHostCount >= 100 ? 5 : (finiteHostCount >= 25 ? 3 : 2);
    score += hostWeight;
    capabilities.push({
      permission: 'scope:finite-hosts',
      weight: hostWeight,
      label: 'Can access ' + finiteHostCount + ' separately listed site patterns',
    });
  }
  if (installType === 'development') {
    score += 3;
    capabilities.push({ permission: 'installType:development', weight: 3, label: 'Loaded unpacked in Chrome developer mode' });
  } else if (installType === 'sideload') {
    score += 4;
    capabilities.push({ permission: 'installType:sideload', weight: 4, label: 'Installed outside Chrome\'s usual listing flow' });
  } else if (installType === 'other') {
    score += 2;
    capabilities.push({ permission: 'installType:other', weight: 2, label: 'Chrome reports an unclassified install source' });
  }

  capabilities.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  return {
    score,
    level: extensionRiskLevel(score),
    capabilities,
    flags: capabilities.map((item) => item.label),
  };
}

function classifyExtensionRisk(ext) {
  const permissions = Array.from(extPermSet(ext)).sort();
  const risk = extensionRiskFromTokens(new Set(permissions), ext && ext.installType);
  return Object.assign({ permissions }, risk);
}

function extensionDescriptor(ext, previous) {
  return {
    id: String((ext && ext.id) || ''),
    name: String((ext && ext.name) || '(unknown extension)').slice(0, 160),
    version: String((ext && ext.version) || ''),
    enabled: !!(ext && ext.enabled),
    disabledReason: String((ext && ext.disabledReason) || ''),
    mayDisable: !(ext && ext.mayDisable === false),
    installType: String((ext && ext.installType) || 'unknown'),
    permissions: Array.from(extPermSet(ext)).sort(),
    firstSeenAt: Number(previous && previous.firstSeenAt) || Date.now(),
  };
}

function normalizeExtensionBaseline(raw) {
  const normalized = { schema: EXT_WATCH_SCHEMA, capturedAt: 0, extensions: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalized;

  const source = raw.extensions && typeof raw.extensions === 'object' && !Array.isArray(raw.extensions)
    ? raw.extensions
    : raw;
  normalized.capturedAt = Number(raw.capturedAt) || 0;
  for (const id of Object.keys(source)) {
    if (id === 'schema' || id === 'capturedAt' || id === 'extensions') continue;
    const value = source[id];
    if (Array.isArray(value)) {
      normalized.extensions[id] = {
        id,
        name: '',
        version: '',
        enabled: null,
        disabledReason: '',
        mayDisable: true,
        installType: '',
        permissions: Array.from(new Set(value.map(String))).sort(),
        firstSeenAt: 0,
        legacy: true,
      };
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    normalized.extensions[id] = {
      id,
      name: String(value.name || '').slice(0, 160),
      version: String(value.version || ''),
      enabled: typeof value.enabled === 'boolean' ? value.enabled : null,
      disabledReason: String(value.disabledReason || ''),
      mayDisable: value.mayDisable !== false,
      installType: String(value.installType || ''),
      permissions: Array.from(new Set(Array.isArray(value.permissions) ? value.permissions.map(String) : [])).sort(),
      firstSeenAt: Number(value.firstSeenAt) || 0,
      legacy: value.legacy === true,
    };
  }
  return normalized;
}

function sameStringArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function lowerExtensionSeverity(level) {
  if (level === 'critical') return 'high';
  if (level === 'high') return 'medium';
  return 'low';
}

function extensionChangeHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeExtensionEvent(kind, current, previous, fields) {
  const now = Number(fields && fields.when) || Date.now();
  const event = Object.assign({
    id: String((current && current.id) || (previous && previous.id) || ''),
    name: String((current && current.name) || (previous && previous.name) || '(unknown extension)'),
    kind,
    severity: 'low',
    summary: 'Extension changed',
    reasons: [],
    gainedPermissions: [],
    removedPermissions: [],
    fromVersion: String((previous && previous.version) || ''),
    toVersion: String((current && current.version) || ''),
    enabled: current ? current.enabled : false,
    installType: String((current && current.installType) || (previous && previous.installType) || 'unknown'),
    when: now,
    reviewedAt: now,
  }, fields || {});
  const fingerprintSource = [event.id, event.kind, event.fromVersion, event.toVersion,
    event.enabled, event.gainedPermissions.join(','), event.removedPermissions.join(',')].join('|');
  event.eventId = event.id + '-' + now + '-' + extensionChangeHash(fingerprintSource);
  if (EXT_ATTENTION_LEVELS.has(event.severity)) event.reviewedAt = null;
  return event;
}

function describeExtensionDelta(previous, current, now) {
  const prevPermissions = new Set(previous.permissions || []);
  const currPermissions = new Set(current.permissions || []);
  const gained = current.permissions.filter((permission) => !prevPermissions.has(permission));
  const removed = previous.permissions.filter((permission) => !currPermissions.has(permission));
  const gainedRisk = extensionRiskFromTokens(new Set(gained), 'normal');
  const previousRisk = extensionRiskFromTokens(prevPermissions, previous.installType);
  const currentRisk = extensionRiskFromTokens(currPermissions, current.installType);
  const previousCapabilities = new Set(previousRisk.capabilities.map((capability) => capability.permission));
  const gainedCapabilities = new Set(gainedRisk.capabilities.map((capability) => capability.permission));
  const newlyActivated = currentRisk.capabilities.filter((capability) => !previousCapabilities.has(capability.permission));
  const joinedCapabilities = newlyActivated.filter((capability) => !gainedCapabilities.has(capability.permission));
  const combinedDeltaScore = gainedRisk.score + joinedCapabilities.reduce((sum, capability) => sum + capability.weight, 0);
  let combinedDeltaLevel = extensionRiskLevel(combinedDeltaScore);
  if (joinedCapabilities.some((capability) => capability.permission.startsWith('combination:') || capability.permission === 'scope:finite-hosts')
      && EXT_RISK_RANK[currentRisk.level] > EXT_RISK_RANK[combinedDeltaLevel]) {
    combinedDeltaLevel = currentRisk.level;
  }
  const versionChanged = !previous.legacy && !!previous.version && previous.version !== current.version;
  const stateChanged = !previous.legacy && typeof previous.enabled === 'boolean' && previous.enabled !== current.enabled;
  const installTypeChanged = !previous.legacy && !!previous.installType && previous.installType !== current.installType;
  const disabledReasonChanged = !previous.legacy && previous.disabledReason !== current.disabledReason;
  const metadataChanged = !previous.legacy && ((previous.name && previous.name !== current.name)
    || installTypeChanged || disabledReasonChanged);

  if (!gained.length && !removed.length && !versionChanged && !stateChanged && !metadataChanged) return null;

  if (versionChanged || gained.length || removed.length) {
    const accessChanged = gained.length || removed.length || joinedCapabilities.length;
    const permissionIncreaseDisable = !current.enabled && current.disabledReason === 'permissions_increase'
      && (stateChanged || disabledReasonChanged);
    const kind = versionChanged ? 'updated' : 'permissions_changed';
    let summary = versionChanged
      ? 'Updated from ' + previous.version + ' to ' + current.version
      : 'Permissions changed';
    if (gained.length) summary += ' and gained ' + gained.length + ' permission' + (gained.length === 1 ? '' : 's');
    else if (removed.length) summary += ' and removed access';
    else if (joinedCapabilities.length) summary += ' and changed its capability or install-source profile';
    else summary += ' with no new access';
    const reasons = Array.from(new Set(joinedCapabilities.map((capability) => capability.label).concat(gainedRisk.flags)));
    if (!gained.length && versionChanged && !joinedCapabilities.length) reasons.push('No new permissions were added in this update');
    if (!gained.length && removed.length) reasons.push('Access decreased; no new permissions were added');
    if (gained.length && !gainedRisk.flags.length) reasons.push('Only lower-impact access was added: ' + gained.map(extensionPermissionLabel).join('; '));
    if (removed.length) reasons.push('Removed: ' + removed.map(extensionPermissionLabel).join('; '));
    let severity = (gained.length || joinedCapabilities.length) ? combinedDeltaLevel : 'low';
    if (permissionIncreaseDisable) {
      summary += '; Chrome disabled it until you approve the increased access';
      reasons.unshift('Chrome requires you to approve the extension\'s increased access before it can run again');
      if (EXT_RISK_RANK[severity] < EXT_RISK_RANK.medium) severity = 'medium';
    } else if (!current.enabled && severity !== 'low') {
      severity = lowerExtensionSeverity(severity);
    }
    return makeExtensionEvent(kind, current, previous, {
      when: now,
      severity,
      summary,
      reasons,
      gainedPermissions: gained,
      removedPermissions: removed,
      accessChanged: !!accessChanged,
    });
  }

  if (stateChanged) {
    const profile = extensionRiskFromTokens(new Set(current.permissions), current.installType);
    const enabled = current.enabled;
    const permissionIncreaseDisable = !enabled && current.disabledReason === 'permissions_increase';
    return makeExtensionEvent(enabled ? 'enabled' : 'disabled', current, previous, {
      when: now,
      severity: enabled ? lowerExtensionSeverity(profile.level)
        : (permissionIncreaseDisable ? (profile.level === 'low' ? 'medium' : lowerExtensionSeverity(profile.level)) : 'low'),
      summary: enabled ? 'Extension was enabled again' : (permissionIncreaseDisable
        ? 'Chrome disabled this extension after it requested more permissions'
        : 'Extension was disabled'),
      reasons: permissionIncreaseDisable
        ? ['Chrome requires you to approve the extension\'s increased access before it can run again']
        : (enabled && profile.flags.length
          ? ['Re-enabled with these existing capabilities: ' + profile.flags.slice(0, 2).join('; ')]
          : [enabled ? 'Re-enabled without high-impact access' : 'Disabled extensions cannot act on browser activity']),
    });
  }

  if (installTypeChanged) {
    const sourceRisk = extensionRiskFromTokens(new Set(), current.installType);
    return makeExtensionEvent('metadata_changed', current, previous, {
      when: now,
      severity: sourceRisk.level,
      summary: 'Extension install source changed',
      reasons: sourceRisk.flags.length ? sourceRisk.flags : ['Chrome now reports the install source as ' + current.installType],
    });
  }

  if (disabledReasonChanged && current.disabledReason === 'permissions_increase') {
    return makeExtensionEvent('metadata_changed', current, previous, {
      when: now,
      severity: 'medium',
      summary: 'Chrome is waiting for approval of increased extension access',
      reasons: ['Chrome disabled the extension until its new permissions are approved'],
    });
  }

  return makeExtensionEvent('metadata_changed', current, previous, {
    when: now,
    severity: 'low',
    summary: previous.name && previous.name !== current.name ? 'Extension display name changed' : 'Extension install details changed',
    reasons: ['No new permissions were added'],
  });
}

function extensionInstallEvent(current, now) {
  const profile = extensionRiskFromTokens(new Set(current.permissions), current.installType);
  let severity = profile.level;
  if (!current.enabled && severity !== 'low') severity = lowerExtensionSeverity(severity);
  return makeExtensionEvent('installed', current, null, {
    when: now,
    severity,
    summary: current.enabled ? 'New extension installed' : 'New extension installed (currently disabled)',
    reasons: profile.flags.length ? profile.flags : ['No high-impact permissions detected'],
    gainedPermissions: current.permissions.slice(),
  });
}

function extensionRemovalEvent(previous, now) {
  return makeExtensionEvent('removed', null, previous, {
    when: now,
    severity: 'low',
    summary: 'Extension was removed',
    reasons: ['It no longer has access through Chrome'],
    removedPermissions: (previous.permissions || []).slice(),
  });
}

async function watcherEnabled() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = (store && store.wardenone_config) || {};
    return cfg.enabled !== false && cfg.watchExtensionPermissions !== false;
  } catch (_) {
    return false;
  }
}

async function extensionWatchUiAllowed() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = (store && store.wardenone_config) || {};
    return cfg.enabled !== false && cfg.silentMode !== true;
  } catch (_) {
    return true;
  }
}

function extensionWatchStatus(overrides) {
  return Object.assign({
    enabled: true,
    state: 'watching',
    lastChecked: Date.now(),
    lastError: '',
    watchedCount: 0,
    intervalMinutes: EXT_WATCH_INTERVAL_MINUTES,
  }, overrides || {});
}

function getAllExtensions() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (items) => {
      if (settled) return;
      settled = true;
      resolve(Array.isArray(items) ? items : []);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error || 'Extension list unavailable')));
    };
    try {
      const result = chrome.management.getAll((items) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) {
          fail(new Error(err.message || String(err)));
          return;
        }
        done(items);
      });
      if (result && typeof result.then === 'function') result.then(done, fail);
    } catch (error) {
      /* Some test shims and newer Chromium builds expose a Promise form only. */
      try {
        const result = chrome.management.getAll();
        if (result && typeof result.then === 'function') result.then(done, fail);
        else fail(error);
      } catch (fallbackError) {
        fail(fallbackError);
      }
    }
  });
}

async function snapshotExtensionBaseline() {
  try {
    const all = await getAllExtensions();
    const extensions = {};
    for (const ext of all) {
      if (!ext || ext.type !== 'extension' || ext.id === chrome.runtime.id) continue;
      extensions[ext.id] = extensionDescriptor(ext, null);
    }
    const baseline = { schema: EXT_WATCH_SCHEMA, capturedAt: Date.now(), extensions };
    await localSet({
      [EXT_BASELINE_KEY]: baseline,
      [EXT_WATCH_STATUS_KEY]: extensionWatchStatus({ watchedCount: Object.keys(extensions).length }),
    });
    return baseline;
  } catch (error) {
    const message = String((error && error.message) || error || 'Extension list unavailable').slice(0, 240);
    try {
      await localSet({ [EXT_WATCH_STATUS_KEY]: extensionWatchStatus({ state: 'error', lastError: message }) });
    } catch (_) {}
    return { schema: EXT_WATCH_SCHEMA, capturedAt: 0, extensions: {} };
  }
}

function shouldNotifyExtensionEvent(event) {
  return !!event && EXT_ATTENTION_LEVELS.has(event.severity) && !event.reviewedAt;
}

function extensionNotificationMessage(event) {
  const firstReason = Array.isArray(event.reasons) && event.reasons.length ? event.reasons[0] : event.summary;
  const version = event.fromVersion && event.toVersion && event.fromVersion !== event.toVersion
    ? ' (' + event.fromVersion + ' → ' + event.toVersion + ')' : '';
  return (event.name + version + ': ' + firstReason + '. Click to review the full change.').slice(0, 240);
}

function extensionNotificationTitle(event) {
  if (event && event.kind === 'reputation_changed') {
    return event.severity === 'critical'
      ? 'Critical local extension reputation match'
      : 'Extension reputation changed';
  }
  if (event && event.kind === 'disabled' && /more permissions|increased access/i.test(String(event.summary || ''))) {
    return 'Extension permission approval required';
  }
  return event && event.severity === 'critical' ? 'Critical extension access increase' : 'Extension access changed';
}

async function refreshExtensionAttentionBadge() {
  try {
    const store = await localGet([EXT_ALERTS_KEY, 'wardenone_startup_report']);
    const alerts = Array.isArray(store && store[EXT_ALERTS_KEY]) ? store[EXT_ALERTS_KEY] : [];
    const unread = alerts.some(shouldNotifyExtensionEvent);
    const report = store && store.wardenone_startup_report;
    const startupCount = (report && Array.isArray(report.tabs) ? report.tabs.length : 0)
      + (report && Array.isArray(report.extensions) ? report.extensions.length : 0);
    const text = unread ? '!' : (startupCount ? String(startupCount > 9 ? '9+' : startupCount) : '');
    chrome.action.setBadgeText({ text });
    if (text) chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  } catch (_) {}
}

async function notifyExtensionEvents(events) {
  const important = (events || []).filter(shouldNotifyExtensionEvent);
  if (!important.length || !(await extensionWatchUiAllowed())) return;
  for (const event of important) {
    try {
      chrome.notifications.create('wo-extwatch-' + event.eventId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: extensionNotificationTitle(event),
        message: extensionNotificationMessage(event),
        priority: event.severity === 'critical' || event.severity === 'high' ? 2 : 1,
      });
    } catch (_) {}
  }
  await refreshExtensionAttentionBadge();
}

function logExtensionEvents(events) {
  for (const event of events || []) {
    try {
      queueHistory({
        type: 'extension_change',
        url: '',
        at: event.when,
        detail: {
          name: event.name,
          kind: event.kind,
          severity: event.severity,
          summary: event.summary,
          reasons: event.reasons,
          fromVersion: event.fromVersion,
          toVersion: event.toVersion,
        },
      });
    } catch (_) {}
  }
}

var extensionWatchQueue = Promise.resolve([]);

async function reconcileExtensionChangesNow(trigger, options) {
  const now = Date.now();
  const forceBaseline = !!(options && options.forceBaseline);
  const enabled = await watcherEnabled();
  if (!enabled && !forceBaseline) {
    try {
      await localSet({ [EXT_WATCH_STATUS_KEY]: extensionWatchStatus({ enabled: false, state: 'disabled', watchedCount: 0 }) });
    } catch (_) {}
    return [];
  }

  try {
    const stored = await localGet([EXT_BASELINE_KEY, EXT_ALERTS_KEY]);
    const hasStoredBaseline = !!(stored && Object.prototype.hasOwnProperty.call(stored, EXT_BASELINE_KEY)
      && stored[EXT_BASELINE_KEY] && typeof stored[EXT_BASELINE_KEY] === 'object');
    const baseline = normalizeExtensionBaseline(stored && stored[EXT_BASELINE_KEY]);
    const all = await getAllExtensions();
    const current = {};
    for (const ext of all) {
      if (!ext || ext.type !== 'extension' || ext.id === chrome.runtime.id) continue;
      current[ext.id] = extensionDescriptor(ext, baseline.extensions[ext.id]);
    }

    const nextBaseline = { schema: EXT_WATCH_SCHEMA, capturedAt: now, extensions: current };
    const status = extensionWatchStatus({ enabled, watchedCount: Object.keys(current).length, trigger: String(trigger || 'scan') });
    if (!hasStoredBaseline || forceBaseline) {
      await localSet({ [EXT_BASELINE_KEY]: nextBaseline, [EXT_WATCH_STATUS_KEY]: status });
      return [];
    }

    const events = [];
    for (const id of Object.keys(current)) {
      if (!Object.prototype.hasOwnProperty.call(baseline.extensions, id)) {
        events.push(extensionInstallEvent(current[id], now));
        continue;
      }
      const change = describeExtensionDelta(baseline.extensions[id], current[id], now);
      if (change) events.push(change);
    }
    for (const id of Object.keys(baseline.extensions)) {
      if (!Object.prototype.hasOwnProperty.call(current, id)) events.push(extensionRemovalEvent(baseline.extensions[id], now));
    }

    const oldAlerts = Array.isArray(stored && stored[EXT_ALERTS_KEY]) ? stored[EXT_ALERTS_KEY] : [];
    const alerts = events.concat(oldAlerts).slice(0, EXT_ALERTS_MAX);
    const storageUpdate = {
      [EXT_BASELINE_KEY]: nextBaseline,
      [EXT_WATCH_STATUS_KEY]: status,
    };
    if (events.length) storageUpdate[EXT_ALERTS_KEY] = alerts;
    await localSet(storageUpdate);
    logExtensionEvents(events);
    await notifyExtensionEvents(events);
    return events;
  } catch (error) {
    const message = String((error && error.message) || error || 'Extension list unavailable').slice(0, 240);
    try {
      await localSet({ [EXT_WATCH_STATUS_KEY]: extensionWatchStatus({ enabled, state: 'error', lastError: message }) });
    } catch (_) {}
    return [];
  }
}

function reconcileExtensionChanges(trigger, options) {
  const run = () => reconcileExtensionChangesNow(trigger, options);
  extensionWatchQueue = extensionWatchQueue.catch(() => []).then(run);
  return extensionWatchQueue;
}

async function acknowledgeExtensionAlerts() {
  const store = await localGet(EXT_ALERTS_KEY);
  const alerts = Array.isArray(store && store[EXT_ALERTS_KEY]) ? store[EXT_ALERTS_KEY] : [];
  const now = Date.now();
  const updated = alerts.map((event) => shouldNotifyExtensionEvent(event)
    ? Object.assign({}, event, { reviewedAt: now })
    : event);
  await localSet({ [EXT_ALERTS_KEY]: updated });
  await refreshExtensionAttentionBadge();
  return updated;
}

function ensureExtensionWatchAlarm() {
  try {
    if (chrome.alarms && chrome.alarms.get) {
      chrome.alarms.get(EXT_WATCH_ALARM, (alarm) => {
        void (chrome.runtime && chrome.runtime.lastError);
        if (!alarm) chrome.alarms.create(EXT_WATCH_ALARM, {
          delayInMinutes: 1,
          periodInMinutes: EXT_WATCH_INTERVAL_MINUTES,
        });
      });
    } else if (chrome.alarms && chrome.alarms.create) {
      chrome.alarms.create(EXT_WATCH_ALARM, { delayInMinutes: 1, periodInMinutes: EXT_WATCH_INTERVAL_MINUTES });
    }
  } catch (_) {}
}

function scheduleExtensionReconcile(trigger) {
  try { setTimeout(() => { reconcileExtensionChanges(trigger); }, 300); } catch (_) { reconcileExtensionChanges(trigger); }
}

try {
  chrome.management.onInstalled.addListener(() => scheduleExtensionReconcile('installed'));
  chrome.management.onEnabled.addListener(() => scheduleExtensionReconcile('enabled'));
  chrome.management.onDisabled.addListener(() => scheduleExtensionReconcile('disabled'));
  chrome.management.onUninstalled.addListener(() => scheduleExtensionReconcile('removed'));
} catch (_) {}
try {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === EXT_WATCH_ALARM) reconcileExtensionChanges('alarm');
  });
  ensureExtensionWatchAlarm();
} catch (_) {}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.wardenone_config) return;
    const oldConfig = changes.wardenone_config.oldValue || {};
    const newConfig = changes.wardenone_config.newValue || {};
    const before = oldConfig.watchExtensionPermissions;
    const after = newConfig.watchExtensionPermissions;
    if (before === after && oldConfig.enabled === newConfig.enabled) return;
    const active = newConfig.enabled !== false && after !== false;
    reconcileExtensionChanges(active ? 'watch-enabled' : 'watch-disabled', { forceBaseline: true });
  });
} catch (_) {}

try {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const id = String(notificationId || '');
    if (!id.startsWith('wo-extwatch-') && !id.startsWith('wo-extperm-')) return;
    try { chrome.notifications.clear(id); } catch (_) {}
    try { chrome.tabs.create({ url: chrome.runtime.getURL('extensions.html') }); } catch (_) {}
  });
} catch (_) {}

/* Defer the first comparison until background.js has finished initialising its storage helpers. */
try { setTimeout(() => { reconcileExtensionChanges('worker-start'); }, 750); } catch (_) {}

try {
  globalThis.__woExtensionWatchTest = {
    EXT_BASELINE_KEY,
    EXT_ALERTS_KEY,
    EXT_WATCH_STATUS_KEY,
    classifyExtensionRisk,
    describeExtensionDelta,
    extPermSet,
    normalizeExtensionBaseline,
    reconcileExtensionChanges,
    snapshotExtensionBaseline,
    acknowledgeExtensionAlerts,
    refreshExtensionAttentionBadge,
    extensionNotificationTitle,
    ensureExtensionWatchAlarm,
  };
} catch (_) {}

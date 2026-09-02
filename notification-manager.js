/* Central WardenOne notification manager.
 * Features emit events; this file decides history, toasts, tray, badge and sound. */
'use strict';

importScripts('notification-schema.js');

var WARDEN_NOTIFICATION_HISTORY_CAP = 300;
var WARDEN_NOTIFICATION_GROUP_WINDOW_MS = 30 * 60 * 1000;
var WARDEN_NOTIFICATION_SAMPLE_CAP = 12;
var __wardenNotificationWrite = Promise.resolve();

function wardenNotificationNow(value) {
  var at = Number(value);
  return Number.isFinite(at) && at > 0 ? at : Date.now();
}

function wardenNotificationHostFromEntry(entry) {
  var raw = entry && (entry.url || (entry.detail && (entry.detail.host || entry.detail.domain || entry.detail.matched || entry.detail.url)) || '');
  try {
    if (typeof registrableDomain === 'function' && raw) {
      var fromHelper = registrableDomain(raw);
      if (fromHelper) return String(fromHelper).replace(/^www\./i, '').toLowerCase();
    }
  } catch (_) {}
  try {
    var hostname = new URL(String(raw)).hostname;
    return String(hostname || '').replace(/^www\./i, '').toLowerCase();
  } catch (_) {}
  return String(raw || '').replace(/^www\./i, '').split(/[/:?#]/)[0].toLowerCase();
}

function wardenNotificationSummary(entry, definition) {
  var detail = entry && entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
  var text = String(detail.why || detail.message || detail.title || '').trim();
  if (text) return text.slice(0, 280);
  return String(definition && definition.label || 'WardenOne notice');
}

function wardenNotificationUnreadCount(items, settings) {
  var list = Array.isArray(items) ? items : [];
  if (settings && settings.badgeEnabled === false) return 0;
  return list.reduce(function (total, item) {
    if (!item || item.read) return total;
    if (item.mode === 'history' || item.mode === 'off') return total;
    return total + 1;
  }, 0);
}

async function loadWardenNotificationState() {
  var store = await localGet(['wardenone_config', 'wardenone_notifications']);
  var config = store && store.wardenone_config && typeof store.wardenone_config === 'object' ? store.wardenone_config : {};
  var settings = sanitizeWardenNotificationSettings(config.notificationSettings);
  var items = Array.isArray(store && store.wardenone_notifications)
    ? store.wardenone_notifications.filter(function (item) { return item && typeof item === 'object'; })
    : [];
  return { config: config, settings: settings, items: items };
}

function pruneWardenNotificationHistory(items, settings, now) {
  var list = Array.isArray(items) ? items.slice() : [];
  var days = Number(settings && settings.retentionDays);
  if (days > 0) {
    var cutoff = now - days * 86400000;
    list = list.filter(function (item) { return wardenNotificationNow(item && item.at) >= cutoff; });
  }
  if (list.length > WARDEN_NOTIFICATION_HISTORY_CAP) list = list.slice(0, WARDEN_NOTIFICATION_HISTORY_CAP);
  return list;
}

function applyWardenNotificationBadge(items, settings) {
  if (typeof setWardenNotificationBadgeState === 'function') {
    setWardenNotificationBadgeState(wardenNotificationUnreadCount(items, settings), settings && settings.badgeEnabled !== false);
  }
}

async function restoreWardenNotificationBadge() {
  try {
    var state = await loadWardenNotificationState();
    applyWardenNotificationBadge(state.items, state.settings);
  } catch (_) {}
}

function wardenNotificationFindGroup(items, ruleId, host, at, settings) {
  if (!settings || settings.groupSimilar === false) return -1;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item) continue;
    if (item.ruleId !== ruleId) continue;
    if (String(item.host || '') !== String(host || '')) continue;
    if (Math.abs(wardenNotificationNow(item.at) - at) > WARDEN_NOTIFICATION_GROUP_WINDOW_MS) continue;
    return i;
  }
  return -1;
}

async function recordWardenNotification(entry) {
  if (typeof INCOGNITO_CONTEXT !== 'undefined' && INCOGNITO_CONTEXT) return null;
  if (!entry || typeof entry !== 'object') return null;
  var type = String(entry.type || '').trim();
  if (!type) return null;

  __wardenNotificationWrite = __wardenNotificationWrite.then(async function () {
    var state = await loadWardenNotificationState();
    var resolved = wardenNotificationResolvedPreference(state.settings, type);
    if (resolved.mode === 'off') return null;

    var at = wardenNotificationNow(entry.at);
    var host = wardenNotificationHostFromEntry(entry);
    var summary = wardenNotificationSummary(entry, resolved.definition);
    var items = pruneWardenNotificationHistory(state.items, resolved.settings, at);
    var groupAt = wardenNotificationFindGroup(items, resolved.ruleId, host, at, resolved.settings);
    var recorded;

    if (groupAt >= 0) {
      recorded = Object.assign({}, items[groupAt]);
      recorded.count = Math.min(9999, Math.max(1, Number(recorded.count) || 1) + 1);
      recorded.at = Math.max(wardenNotificationNow(recorded.at), at);
      recorded.read = false;
      recorded.summary = summary;
      recorded.title = resolved.definition.label;
      recorded.severity = resolved.definition.severity;
      recorded.mode = resolved.mode;
      recorded.samples = Array.isArray(recorded.samples) ? recorded.samples.slice() : [];
      recorded.samples.unshift({ summary: summary, at: at, host: host });
      if (recorded.samples.length > WARDEN_NOTIFICATION_SAMPLE_CAP) {
        recorded.samples = recorded.samples.slice(0, WARDEN_NOTIFICATION_SAMPLE_CAP);
      }
      items.splice(groupAt, 1);
      items.unshift(recorded);
    } else {
      recorded = {
        id: 'n-' + at + '-' + resolved.ruleId + '-' + (host || 'local'),
        type: type,
        ruleId: resolved.ruleId,
        section: resolved.definition.section,
        title: resolved.definition.label,
        summary: summary,
        host: host,
        at: at,
        count: 1,
        read: false,
        severity: resolved.definition.severity,
        mode: resolved.mode,
        samples: [{ summary: summary, at: at, host: host }],
      };
      items.unshift(recorded);
    }

    items = pruneWardenNotificationHistory(items, resolved.settings, at);
    await localSet({ wardenone_notifications: items });
    applyWardenNotificationBadge(items, resolved.settings);
    return recorded;
  }).catch(function () { return null; });

  return __wardenNotificationWrite;
}

/* One creation at a time. Two sounds close together both saw no document and
   both called createDocument; the second lost with "Only a single offscreen
   document may be created", the rejection travelled back up, and that sound was
   simply never heard. Sharing the in-flight promise makes the loser wait for the
   winner, which is what it wanted anyway. */
var wardenOffscreenCreating = null;

async function ensureWardenOffscreenDocument() {
  var url = chrome.runtime.getURL('offscreen.html');
  var contexts = [];
  try {
    contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url],
    });
  } catch (_) { contexts = []; }
  if (contexts && contexts.length) return;

  if (!wardenOffscreenCreating) {
    wardenOffscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play WardenOne notification sounds',
    }).catch(function (error) {
      /* Someone else won the race. That is the state we were asking for. */
      if (!/single offscreen document/i.test(String(error && error.message))) throw error;
    });
  }
  try {
    await wardenOffscreenCreating;
  } finally {
    wardenOffscreenCreating = null;
  }
}

function sendWardenOffscreenMessage(payload) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var finish = function (error, value) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    try {
      var pending = chrome.runtime.sendMessage(payload, function (response) {
        var err = chrome.runtime.lastError;
        if (err) finish(new Error(err.message));
        else finish(null, response);
      });
      if (pending && typeof pending.then === 'function') {
        pending.then(function (response) { finish(null, response); }, function (error) { finish(error); });
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function playWardenNotificationSound(sound, volume) {
  /* One list, from the schema. Hardcoding the names here is what let the page
     offer a sound this rejected -- the reader picks it, nothing plays, and
     nothing says why. */
  var name = String(sound || '');
  if (name === 'notification') name = 'soft';
  var known = (typeof wardenNotificationSoundIds === 'function') ? wardenNotificationSoundIds() : ['soft', 'warning', 'critical'];
  if (name === 'none' || known.indexOf(name) < 0) return false;
  var level = Number(volume);
  if (!Number.isFinite(level)) level = 0.55;
  level = Math.max(0, Math.min(1, level));
  var payload = {
    target: 'wardenone-offscreen',
    type: 'play-notification-sound',
    sound: name,
    volume: level,
  };
  await ensureWardenOffscreenDocument();
  try {
    await sendWardenOffscreenMessage(payload);
  } catch (error) {
    /* createDocument resolves when the document EXISTS, not when its scripts
       have run -- so a message sent immediately after can arrive before
       offscreen.js has registered its listener and come back as "Receiving end
       does not exist". Nothing plays and nothing says why, which is what "most
       of them do not play" looks like from the outside. One retry, after the
       document has had a moment, and only for that error. */
    var message = String((error && error.message) || '');
    if (!/Receiving end does not exist|Could not establish connection/i.test(message)) throw error;
    await new Promise(function (resolve) { setTimeout(resolve, 150); });
    await ensureWardenOffscreenDocument();
    await sendWardenOffscreenMessage(payload);
  }
  return true;
}

async function playWardenNotificationSoundForType(type) {
  var state = await loadWardenNotificationState();
  var resolved = wardenNotificationResolvedPreference(state.settings, type);
  if (resolved.mode === 'off' || resolved.mode === 'history') return false;
  if (!wardenNotificationSoundAllowed(resolved.settings, resolved.definition, resolved.rule)) return false;
  return playWardenNotificationSound(resolved.rule.sound, resolved.settings.volume);
}

async function showWardenSystemNotification(id, options, type) {
  var state = await loadWardenNotificationState();
  var resolved = wardenNotificationResolvedPreference(state.settings, type || (options && options.title) || 'system_message');
  if (resolved.mode === 'off' || resolved.mode === 'history') return false;
  var payload = Object.assign({}, options || {}, {
    requireInteraction: resolved.mode === 'persistent' || resolved.duration === 'persistent',
  });
  await new Promise(function (resolve, reject) {
    try {
      chrome.notifications.create(String(id || 'wardenone-' + Date.now()), payload, function () {
        var err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
  try {
    if (wardenNotificationSoundAllowed(resolved.settings, resolved.definition, resolved.rule)) {
      await playWardenNotificationSound(resolved.rule.sound, resolved.settings.volume);
    }
  } catch (_) {}
  return true;
}

try {
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.wardenone_notifications || changes.wardenone_config) restoreWardenNotificationBadge();
    });
  }
} catch (_) {}

try { setTimeout(restoreWardenNotificationBadge, 0); } catch (_) {}

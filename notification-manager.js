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

/* Writes are batched (COST-02). Every recorded event used to read both stores, prune, merge and
   write the whole array back -- up to ~0.9 MiB at the 300-record cap -- once per event, while the
   history writer beside it already buffered. Now events wait in memory for a short window and a
   burst becomes one read and one write, with group merges collapsed inside the batch. A rule
   switched off is decided from the cached config before anything is buffered or read. The cost
   of the window: an event recorded in the last quarter-second before the worker is torn down can
   miss the Notification Centre. The Activity log, which has its own write-ahead copy, still has it. */
var WARDEN_NOTIFICATION_FLUSH_MS = 250;
var __wardenNotificationBuffer = [];
var __wardenNotificationFlushTimer = null;

async function recordWardenNotification(entry) {
  if (typeof INCOGNITO_CONTEXT !== 'undefined' && INCOGNITO_CONTEXT) return null;
  if (!entry || typeof entry !== 'object') return null;
  var type = String(entry.type || '').trim();
  if (!type) return null;
  try {
    var cfgStore = await localGet('wardenone_config');
    var cfg = cfgStore && cfgStore.wardenone_config && typeof cfgStore.wardenone_config === 'object' ? cfgStore.wardenone_config : {};
    var early = wardenNotificationResolvedPreference(sanitizeWardenNotificationSettings(cfg.notificationSettings), type);
    if (early.mode === 'off') return null;
  } catch (_) {}
  return new Promise(function (resolve) {
    __wardenNotificationBuffer.push({ entry: entry, type: type, resolve: resolve, result: null });
    if (!__wardenNotificationFlushTimer) {
      __wardenNotificationFlushTimer = setTimeout(flushWardenNotifications, WARDEN_NOTIFICATION_FLUSH_MS);
    }
  });
}

function flushWardenNotifications() {
  if (__wardenNotificationFlushTimer) {
    try { clearTimeout(__wardenNotificationFlushTimer); } catch (_) {}
    __wardenNotificationFlushTimer = null;
  }
  var batch = __wardenNotificationBuffer.splice(0);
  if (!batch.length) return __wardenNotificationWrite;
  __wardenNotificationWrite = __wardenNotificationWrite.then(async function () {
    var state = await loadWardenNotificationState();
    var items = state.items;
    var latest = null;
    for (var i = 0; i < batch.length; i++) {
      var job = batch[i];
      var resolved = wardenNotificationResolvedPreference(state.settings, job.type);
      if (resolved.mode === 'off') continue;
      var applied = applyWardenNotificationEntry(items, resolved, job.entry, job.type);
      items = applied.items;
      job.result = applied.recorded;
      latest = applied.at;
    }
    if (latest == null) return;
    items = pruneWardenNotificationHistory(items, state.settings, latest);
    await localSet({ wardenone_notifications: items });
    applyWardenNotificationBadge(items, state.settings);
  }).catch(function () {}).then(function () {
    batch.forEach(function (job) { try { job.resolve(job.result || null); } catch (_) {} });
  });
  return __wardenNotificationWrite;
}

/* The one place that turns an event into a stored record or a merge into an existing group. */
function applyWardenNotificationEntry(items, resolved, entry, type) {
  var at = wardenNotificationNow(entry.at);
  var host = wardenNotificationHostFromEntry(entry);
  var summary = wardenNotificationSummary(entry, resolved.definition);
  items = pruneWardenNotificationHistory(items, resolved.settings, at);
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

  return { items: items, recorded: recorded, at: at };
}

/* The Notification Centre's "Mark all read" and "Clear" (M47). The page used to write its own
   copy of the whole store: a six-field projection that dropped summaries, repeat counts and
   samples for good, and a stale snapshot that erased any notice recorded after the page loaded.
   Mutations now run here, behind the same write chain as recording, against the latest store and
   by record id, and hand back the canonical records. Buffered events are flushed first, so "mark
   all read" includes a notice that arrived a moment ago. */
function mutateWardenNotifications(action, ids) {
  flushWardenNotifications();
  var pick = Array.isArray(ids) ? new Set(ids.map(String)) : null;
  var run = __wardenNotificationWrite.then(async function () {
    var state = await loadWardenNotificationState();
    var items = state.items;
    if (action === 'read') {
      items = items.map(function (item) {
        return (!pick || pick.has(String(item.id))) && !item.read ? Object.assign({}, item, { read: true }) : item;
      });
    } else if (action === 'clear') {
      items = pick ? items.filter(function (item) { return !pick.has(String(item.id)); }) : [];
    } else {
      return state.items;
    }
    await localSet({ wardenone_notifications: items });
    applyWardenNotificationBadge(items, state.settings);
    return items;
  });
  __wardenNotificationWrite = run.catch(function () {});
  return run;
}

/* One creation at a time. Two sounds close together both saw no document and
   both called createDocument; the second lost with "Only a single offscreen
   document may be created", the rejection travelled back up, and that sound was
   simply never heard. Sharing the in-flight promise makes the loser wait for the
   winner, which is what it wanted anyway. */
var wardenOffscreenCreating = null;

/* The document lives for a sound, not for the session (LIFE-05). The first sound of a
   session created it and nothing closed it: one extension document, its scripts and an open
   AudioContext stayed resident until the browser closed, in exchange for half a second of
   tone. Now it is closed once it has been idle for a short grace after the last sound --
   long enough that a burst of notifications shares one document and no tune is cut (the
   longest is three notes 0.14 s apart), short enough to matter. A sound in flight holds the
   close; a sound that arrives while the close is in flight waits for it to finish and
   creates afresh, so the creation hardening above and the retry below stay exactly as they
   are -- they matter more once the document can legitimately be absent again. */
var WARDEN_OFFSCREEN_IDLE_MS = 3000;
var wardenOffscreenIdleTimer = 0;
var wardenOffscreenBusy = 0;
var wardenOffscreenClosing = null;

function closeWardenOffscreenDocument() {
  if (wardenOffscreenBusy > 0 || wardenOffscreenClosing) return wardenOffscreenClosing || Promise.resolve();
  wardenOffscreenClosing = Promise.resolve()
    .then(function () { return chrome.offscreen.closeDocument(); })
    .catch(function () { /* already gone, or never there: the state we wanted */ })
    .then(function () { wardenOffscreenClosing = null; });
  return wardenOffscreenClosing;
}

function scheduleWardenOffscreenClose() {
  if (wardenOffscreenIdleTimer) clearTimeout(wardenOffscreenIdleTimer);
  wardenOffscreenIdleTimer = setTimeout(function () {
    wardenOffscreenIdleTimer = 0;
    closeWardenOffscreenDocument();
  }, WARDEN_OFFSCREEN_IDLE_MS);
}

async function ensureWardenOffscreenDocument() {
  /* A document on its way out must finish leaving before we look for one: getContexts still
     lists it, and a message sent to it is lost. */
  if (wardenOffscreenClosing) await wardenOffscreenClosing;
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

async function deliverWardenOffscreenSound(payload) {
  var response = await sendWardenOffscreenMessage(payload);
  if (!response || response.ok !== true) {
    throw new Error(String(response && response.error || 'Notification audio did not play.'));
  }
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
  /* Silent at 0%: no player document opened for it, and not reported as played. */
  if (level <= 0) return false;
  var payload = {
    target: 'wardenone-offscreen',
    type: 'play-notification-sound',
    sound: name,
    volume: level,
  };
  /* A sound in flight holds the document open; the idle close is re-armed when it is done. */
  if (wardenOffscreenIdleTimer) { clearTimeout(wardenOffscreenIdleTimer); wardenOffscreenIdleTimer = 0; }
  wardenOffscreenBusy++;
  try {
    await ensureWardenOffscreenDocument();
    try {
      await deliverWardenOffscreenSound(payload);
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
      await deliverWardenOffscreenSound(payload);
    }
  } finally {
    wardenOffscreenBusy--;
    scheduleWardenOffscreenClose();
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
  /* OS notifications can be shown on a lock screen and kept until dismissed. Only fixed,
     category-level copy crosses that boundary; details stay in WardenOne's own surfaces. */
  var copy = {
    tab_limit_closed: ['Tab Limit', 'An old tab was closed. Open WardenOne for details.'],
    download_review: ['Download Shield', 'A download needs review in WardenOne.'],
    extension_change: ['Extension change', 'An extension change needs review in WardenOne.'],
    manual_check: ['WardenOne check', 'Your requested site check has finished.'],
    warning_integrity: ['WardenOne warning', 'A page obscured a security warning. Open WardenOne to review.'],
    startup_review: ['WardenOne startup check', 'Items need review in WardenOne.'],
  }[String(type || '')] || ['WardenOne notice', 'Open WardenOne to review this notice.'];
  var payload = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: copy[0],
    message: copy[1],
    priority: Math.max(-2, Math.min(2, Number(options && options.priority) || 0)),
    requireInteraction: resolved.mode === 'persistent' || resolved.duration === 'persistent',
  };
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

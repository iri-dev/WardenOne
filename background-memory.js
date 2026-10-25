/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Memory Shield runtime, imported synchronously by background.js. */

// Discard eligible idle tabs without removing them from the tab strip. They reload when activated.
const MEMORY_MODES = {
  gentle:     { minutes: 120 },
  balanced:   { minutes: 30 },
  aggressive: { minutes: 10 },
  emergency:  { minutes: 1 },
};
const MEMORY_DEFAULTS = {
  memoryShield: true,
  memoryMode: 'balanced',
  memoryMinutesOverride: 0, // 0 = use the mode's default; else explicit minutes
  memoryNeverPinned: true,
  memoryNeverAudio: true,
  memoryNeverForms: true,
  memoryNeverPayment: true,
  // Sites the reader marked "never sleep this" themselves, from the right-click menu.
  // Exact hosts only -- see MEMORY_NEVER_SLEEP_MAX for why it is not a wildcard.
  memoryNeverSleepHosts: [],
  // Tab Limit: keep tab count under a user cap by sleeping (or, opt-in,
  // closing) the oldest inactive tab when a new tab crosses the limit.
  tabLimitGuard: false,
  tabLimitMax: 20,
  tabLimitClose: false,          // false = sleep (safe default); true = close (aggressive)
  tabLimitMinIdleMinutes: 30,    // a tab must be idle at least this long to be eligible
  tabLimitWarn: true,            // notify when a tab is closed
};
// last-active timestamp per tabId (in-memory; wiped on every SW restart)
const tabActivity = Object.create(null);
const markTabActive = (tabId) => { if (tabId != null) tabActivity[tabId] = Date.now(); };

// Use the newer of Chrome’s persistent lastAccessed and local navigation/audio activity.
// The heap-only activity map is empty after a worker restart.
function tabLastUsedOrNull(tab) {
  let best = null;
  const persisted = Number(tab && tab.lastAccessed);
  if (Number.isFinite(persisted) && persisted > 0) best = persisted;
  const id = tab && tab.id;
  const seen = id == null ? NaN : Number(tabActivity[id]);
  if (Number.isFinite(seen) && seen > 0 && (best == null || seen > best)) best = seen;
  return best;
}

// Unknown age counts as "just used", so a tab we know nothing about is never slept on that basis.
function tabLastUsed(tab, now) {
  const known = tabLastUsedOrNull(tab);
  return known == null ? (Number(now) || Date.now()) : known;
}

// keep activity fresh on the signals that mean "the user is using this tab"
try {
  chrome.tabs.onActivated.addListener((info) => markTabActive(info.tabId));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    // Only navigation, load and audio starts refresh activity; title-only updates must not erase idle age.
    if (change.status === 'loading' || change.url || change.audible) markTabActive(tabId);
  });
  chrome.tabs.onCreated.addListener((tab) => markTabActive(tab.id));
  chrome.tabs.onRemoved.addListener((tabId) => { delete tabActivity[tabId]; });
} catch (_) {}
// Its own try: a windows registration that throws must not cost the four tabs listeners above
// their registration, or the other way round (LIFE-04).
try {
  // when a window gains focus, its active tab is "active"
  chrome.windows?.onFocusChanged.addListener((winId) => {
    if (winId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId: winId }, (tabs) => { if (tabs && tabs[0]) markTabActive(tabs[0].id); });
  });
} catch (_) {}

async function getMemoryConfig() {
  const store = await localGet('wardenone_config');
  const cfg = (store && store.wardenone_config) || {};
  const m = {};
  for (const k in MEMORY_DEFAULTS) m[k] = (cfg[k] === undefined ? MEMORY_DEFAULTS[k] : cfg[k]);
  // resolve threshold minutes
  const mode = MEMORY_MODES[m.memoryMode] ? m.memoryMode : 'balanced';
  m._minutes = m.memoryMinutesOverride > 0 ? m.memoryMinutesOverride : MEMORY_MODES[mode].minutes;
  m._mode = mode;
  // share the allowlist already used by the rest of the extension
  m._allowlist = normalizeAllowlistHosts(cfg.allowlist || []);
  m._neverSleep = normalizeAllowlistHosts(m.memoryNeverSleepHosts || [], MEMORY_NEVER_SLEEP_MAX);
  return m;
}

// ---- "Never sleep this site" ------------------------------------------------------
// Match exact hosts so removing a menu entry affects only the host it names.
// Cap the list because menu clicks can add entries and every sweep reads it.
const MEMORY_NEVER_SLEEP_MAX = 300;

function memoryNeverSleepHas(list, host) {

  if (!Array.isArray(list) || !list.length) return false;
  const h = normalizeAllowlistHost(host);
  return !!h && list.indexOf(h) >= 0;
}

// Read the stored list on its own, for the menu title -- the sweep reads it through
// getMemoryConfig() like everything else.
async function memoryNeverSleepList() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = (store && store.wardenone_config) || {};
    return normalizeAllowlistHosts(cfg.memoryNeverSleepHosts || [], MEMORY_NEVER_SLEEP_MAX);
  } catch (_) { return []; }
}

// Add or remove one host. Read-modify-write against storage, under the config lock
// (updateStoredConfig), so a popup or Settings save that landed in between is not reverted.
async function memoryChangeNeverSleep(host, desired) {
  const h = normalizeAllowlistHost(host);
  if (!h) return { ok: false, error: 'WardenOne could not read a site from this page.' };
  try {
    let result = null;
    await updateStoredConfig((cfg) => {
      const list = normalizeAllowlistHosts(cfg.memoryNeverSleepHosts || [], MEMORY_NEVER_SLEEP_MAX);
      const on = list.indexOf(h) >= 0;
      const next = desired == null ? !on : desired;
      if (next && !on && list.length >= MEMORY_NEVER_SLEEP_MAX) {
        result = { ok: false, error: 'Your never-sleep list is full at ' + MEMORY_NEVER_SLEEP_MAX
          + ' sites. Take one off it before adding another.' };
        return false;
      }
      result = { ok: true, on: next, host: h, shieldOn: cfg.memoryShield !== false };
      if (next === on) return false;
      cfg.memoryNeverSleepHosts = next ? list.concat([h]) : list.filter((d) => d !== h);
    });
    return result;
  } catch (e) { return { ok: false, error: String(e) }; }
}
function memoryToggleNeverSleep(host) { return memoryChangeNeverSleep(host, null); }
function memorySetNeverSleep(host, on) {
  return typeof on === 'boolean' ? memoryChangeNeverSleep(host, on)
    : Promise.resolve({ ok: false, error: 'Expected an on or off choice.' });
}

// Is a tab safe to put to sleep? Returns null if safe, else a reason it was kept.
function tabKeepReason(tab, cfg) {
  if (!tab || tab.discarded) return 'already asleep';
  if (tab.active) return 'active tab';
  if (cfg.memoryNeverAudio && tab.audible) return 'playing audio';
  if (cfg.memoryNeverPinned && tab.pinned) return 'pinned';
  const url = tab.url || tab.pendingUrl || '';
  if (!/^https?:\/\//i.test(url)) return 'browser/internal page'; // chrome://, about:, extension pages, new tab
  try {
    const host = new URL(url).hostname;
    // Asked for by name, so it outranks every rule below it -- including the ones that
    // would have slept the tab for a reason the reader has already overruled.
    if (memoryNeverSleepHas(cfg._neverSleep, host)) return 'you set never sleep';
    if (isVideoPlatformHost(host)) return 'video/live playback site';
  } catch (_) {}
  // payment / banking / login pages -- never sleep mid-transaction
  if (cfg.memoryNeverPayment && /(checkout|payment|pay|billing|bank|signin|sign-in|login|account\/|secure|wallet|paypal|stripe)/i.test(url)) return 'login/payment page';
  // allowlisted sites (shared allowlist)
  try {
    const host = new URL(url).hostname;
    if (hostMatchesAllowlist(host, cfg._allowlist || [])) return 'allowlisted';
  } catch (_) {}
  return null; // Audio follows its switch; camera/mic and forms use the live check below.
}

// An unreachable bridge is not a clean tab. Destructive callers must keep tabs with unknown state;
// callers that only throttle may fail open.
const MEMORY_LIVE_CHECK_TIMEOUT_MS = 1000;
function memoryTabFrames(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        if (chrome.runtime.lastError || !Array.isArray(frames)) return resolve(null);
        const documents = new Map();
        for (const frame of frames) {
          if (!frame || !Number.isInteger(frame.frameId) || frame.frameId < 0
            || typeof frame.documentId !== 'string' || !frame.documentId || documents.has(frame.frameId)
            || frame.errorOccurred || (frame.documentLifecycle && frame.documentLifecycle !== 'active')) return resolve(null);
          documents.set(frame.frameId, frame.documentId);
        }
        resolve(documents.has(0) ? documents : null);
      });
    } catch (_) { resolve(null); }
  });
}

function memoryFrameLiveState(tabId, frameId, documentId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { kind: 'memory-form-check' }, { frameId, documentId }, (res) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, why: 'unreachable' });
        if (!res || typeof res.formDirty !== 'boolean' || typeof res.mediaActive !== 'boolean') {
          return resolve({ ok: false, why: 'malformed' });
        }
        resolve({ ok: true, formDirty: res.formDirty, mediaActive: res.mediaActive });
      });
    } catch (_) { resolve({ ok: false, why: 'send-failed' }); }
  });
}

function tabLiveState(tabId) {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (timer) {
        try { clearTimeout(timer); } catch (_) {}
        timer = 0;
      }
      resolve(v);
    };
    const unknown = (why) => finish({ ok: false, why, formDirty: false, mediaActive: false });
    timer = setTimeout(() => unknown('timeout'), MEMORY_LIVE_CHECK_TIMEOUT_MS);
    const checkFrames = async () => {
      const before = await memoryTabFrames(tabId);
      if (done) return;
      if (!before) return unknown('frames-unavailable');
      const replies = await Promise.all(Array.from(before, ([frameId, documentId]) => memoryFrameLiveState(tabId, frameId, documentId)));
      if (done) return;
      const formDirty = replies.some((reply) => reply.formDirty === true);
      const mediaActive = replies.some((reply) => reply.mediaActive === true);
      const failed = replies.find((reply) => !reply.ok);
      if (failed) return finish({ ok: false, why: failed.why, formDirty, mediaActive });
      const after = await memoryTabFrames(tabId);
      if (done) return;
      /* A frame added or navigated during the check has not supplied a verified answer. */
      if (!after || after.size !== before.size || Array.from(before).some(([id, documentId]) => after.get(id) !== documentId)) {
        return finish({ ok: false, why: 'frames-changed', formDirty, mediaActive });
      }
      finish({ ok: true, why: '', formDirty, mediaActive });
    };
    checkFrames().catch(() => unknown('frames-unavailable'));
  });
}

// Re-read the selected tab immediately before automatic action: it may have become active or navigated
// during the live-state check. Require the same address, activity time and idle threshold.
async function tabStillSleepable(selected, cfg, minIdleMs) {
  const fresh = await tabsGet(selected.id);
  if (!fresh) return { ok: false, reason: 'tab closed' };
  const keep = tabKeepReason(fresh, cfg);
  if (keep) return { ok: false, reason: keep, protected: true };
  if ((fresh.url || fresh.pendingUrl || '') !== selected.url) return { ok: false, reason: 'navigated while checked' };
  const lastUsed = tabLastUsedOrNull(fresh);
  if (lastUsed != null && (selected.lastUsed == null || lastUsed > selected.lastUsed)) return { ok: false, reason: 'used while checked' };
  const now = Date.now();
  if (minIdleMs > 0 && now - tabLastUsed(fresh, now) < minIdleMs) return { ok: false, reason: 'no longer idle' };
  return { ok: true, tab: fresh };
}
function sleepSelection(tab, lastUsed) {
  return { id: tab.id, url: tab.url || tab.pendingUrl || '', lastUsed: lastUsed == null ? null : lastUsed };
}

const MEMORY_LIVE_CHECK_CONCURRENCY = 4;
async function mapLimited(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const max = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;
  async function run() {
    while (next < list.length) {
      const index = next++;
      try {
        results[index] = await worker(list[index], index);
      } catch (e) {
        results[index] = { ok: false, error: String(e) };
      }
    }
  }
  const workers = [];
  for (let i = 0; i < max; i++) workers.push(run());
  await Promise.all(workers);
  return results;
}

async function runMemoryMaintenance(cfgArg) {
  try {
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return { ok: false, disabled: true };
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const states = new Map();
    for (const tab of tabs) {
      states.set(tab.id, { keep: tabKeepReason(tab, cfg), idleMs: now - tabLastUsed(tab, now) });
    }
    const snapshot = { tabs, now, states, live: new Map(), discarded: new Set() };
    await throttleInactiveTabs(cfg, snapshot);
    const sweep = await memorySweep('alarm', cfg, snapshot);
    if (!sweep.ok) return sweep;
    const groups = await sleepIdleGroups(cfg, snapshot);
    return { ok: true, sweep, groups };
  } catch (e) { return { ok: false, error: String(e) }; }
}

function snapshotLiveState(snapshot, tabId) {
  if (!snapshot.live.has(tabId)) snapshot.live.set(tabId, tabLiveState(tabId));
  return snapshot.live.get(tabId);
}

// Discard tabs that are safe and inactive past the threshold.
async function memorySweep(reason, cfgArg, snapshot) {
  try {
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return { ok: false, disabled: true };
    const tabs = snapshot ? snapshot.tabs : await chrome.tabs.query({});
    const now = snapshot ? snapshot.now : Date.now();
    const thresholdMs = cfg._minutes * 60000;
    const candidates = [];
    for (const tab of tabs) {
      const state = snapshot && snapshot.states.get(tab.id);
      const keep = state ? state.keep : tabKeepReason(tab, cfg);
      if (keep) continue;
      const idleMs = state ? state.idleMs : now - tabLastUsed(tab, now);
      if (idleMs < thresholdMs) continue;
      candidates.push({ tab, idleMs, selected: sleepSelection(tab, now - idleMs) });
    }
    const results = await mapLimited(candidates, MEMORY_LIVE_CHECK_CONCURRENCY, async ({ tab, idleMs, selected }) => {
      // Check the tab's live state once. We always check active camera/mic (a live
      // media tab must never be slept); the form-dirty check only applies when the
      // user has form protection enabled.
      const live = await (snapshot ? snapshotLiveState(snapshot, tab.id) : tabLiveState(tab.id));
      if (!live.ok) return null; // could not ask -- an unanswered tab is not a verified-clean one
      if (live.mediaActive) return null; // active camera/mic -- never sleep
      if (cfg.memoryNeverForms && live.formDirty) return null; // unsaved form input
      if (!(await tabStillSleepable(selected, cfg, thresholdMs)).ok) return null;
      try {
        const discarded = await chrome.tabs.discard(tab.id);
        if (!discarded) return null;
        if (snapshot) snapshot.discarded.add(tab.id);
        const host = (() => { try { return new URL(tab.url).hostname; } catch { return tab.url || ''; } })();
        queueHistory({
          type: 'memory_tab_slept',
          detail: { host, idleMin: Math.round(idleMs / 60000), mode: cfg._mode },
          url: host,
          at: Date.now(),
        });
        return host;
      } catch (_) { return null; /* tab may have closed or be undiscardable */ }
    });
    const sleptUrls = results.filter(Boolean);
    const slept = sleptUrls.length;
    return { ok: true, slept, sleptUrls, mode: cfg._mode, minutes: cfg._minutes };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Free RAM Now: sleep ALL safe inactive tabs immediately (ignores the time
// threshold, but still respects the protection rules).
async function freeRamNow() {
  try {
    const cfg = await getMemoryConfig();
    const tabs = await chrome.tabs.query({});
    let slept = 0, kept = 0; const keptReasons = {};
    const candidates = [];
    for (const tab of tabs) {
      const keep = tabKeepReason(tab, cfg);
      if (keep) { kept++; keptReasons[keep] = (keptReasons[keep] || 0) + 1; continue; }
      candidates.push(tab);
    }
    const results = await mapLimited(candidates, MEMORY_LIVE_CHECK_CONCURRENCY, async (tab) => {
      const selected = sleepSelection(tab, tabLastUsedOrNull(tab));
      const live = await tabLiveState(tab.id);
      if (!live.ok) return { kept: "couldn't check for unsaved work" };
      if (cfg.memoryNeverForms && live.formDirty) return { kept: 'unsaved form' };
      if (live.mediaActive) return { kept: 'camera/mic in use' };
      const still = await tabStillSleepable(selected, cfg, 0);
      if (!still.ok) return { kept: still.reason };
      try {
        const discarded = await chrome.tabs.discard(tab.id);
        return discarded ? { slept: true } : { kept: 'Chrome refused to sleep' };
      } catch (_) { return { kept: 'Chrome refused to sleep' }; }
    });
    for (const result of results) {
      if (result && result.slept) slept++;
      else if (result && result.kept) {
        kept++;
        keptReasons[result.kept] = (keptReasons[result.kept] || 0) + 1;
      }
    }
    queueHistory({ type: 'memory_free_ram', detail: { slept, kept }, url: '', at: Date.now() });
    return { ok: true, slept, kept, keptReasons };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Duplicate-tab detector: fragments can be routes to different app documents.
async function findDuplicateTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const byUrl = Object.create(null);
    for (const tab of tabs) {
      const u = tab.url || '';
      if (!/^https?:/i.test(u)) continue;
      (byUrl[u] = byUrl[u] || []).push({ id: tab.id, title: tab.title, active: tab.active });
    }
    const dups = [];
    for (const u in byUrl) { if (byUrl[u].length > 1) dups.push({ url: u, count: byUrl[u].length, tabs: byUrl[u] }); }
    const extra = dups.reduce((n, d) => n + (d.count - 1), 0);
    return { ok: true, groups: dups, extraCount: extra };
  } catch (e) { return { ok: false, error: String(e) }; }
}

function duplicateTabProtected(tab, cfg, live) {
  return !tab || tab.status === 'loading' || (tab.pendingUrl && tab.pendingUrl !== tab.url)
    || tab.pinned || !!tabKeepReason(tab, cfg) || !live.ok || live.formDirty || live.mediaActive;
}

// Keep protected copies; when all are clean, keep the most recently used one.
async function closeDuplicateTabs() {
  try {
    const found = await findDuplicateTabs();
    if (!found.ok) return found;
    const { groups } = found;
    const cfg = await getMemoryConfig();
    let closed = 0;
    for (const g of (groups || [])) {
      const reviewed = await mapLimited(g.tabs, MEMORY_LIVE_CHECK_CONCURRENCY, async (entry) => {
        const tab = await tabsGet(entry.id);
        if (!tab || tab.url !== g.url) return null;
        const live = await tabLiveState(tab.id);
        const protectedTab = duplicateTabProtected(tab, cfg, live);
        const priority = tab.active ? 5 : (!live.ok || live.formDirty || live.mediaActive) ? 4
          : tab.pinned ? 3 : tab.audible ? 2 : protectedTab ? 2 : 1;
        return { tab, protectedTab, priority, lastUsed: tabLastUsedOrNull(tab) || 0 };
      });
      const copies = reviewed.filter((entry) => entry && entry.tab);
      if (copies.length < 2) continue;
      copies.sort((a, b) => b.priority - a.priority || b.lastUsed - a.lastUsed || a.tab.id - b.tab.id);
      const keepId = copies[0].tab.id;
      for (const entry of copies) {
        if (entry.tab.id === keepId || entry.protectedTab) continue;
        const live = await tabLiveState(entry.tab.id);
        if (!live.ok || live.formDirty || live.mediaActive) continue;
        const survivor = await tabsGet(keepId);
        if (!survivor || survivor.url !== g.url) break;
        const fresh = await tabsGet(entry.tab.id);
        if (!fresh || fresh.url !== g.url || duplicateTabProtected(fresh, cfg, live)) continue;
        if ((tabLastUsedOrNull(fresh) || 0) > entry.lastUsed) continue;
        try { await chrome.tabs.remove(fresh.id); closed++; } catch (_) {}
      }
    }
    if (closed) queueHistory({ type: 'memory_dupes_closed', detail: { closed }, url: '', at: Date.now() });
    return { ok: true, closed };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// RAM score: a simple, honest rating from tab counts (we can't read real RAM).
const HEAVY_HOSTS = /(youtube\.com|twitch\.tv|discord\.com|docs\.google\.com|canva\.com|figma\.com|netflix\.com|hulu\.com|disneyplus\.com|spotify\.com|meet\.google\.com|teams\.microsoft\.com|notion\.so)/i;
async function memoryScore() {
  try {
    const tabs = await chrome.tabs.query({});
    let total = 0, sleeping = 0, heavy = 0;
    const now = Date.now();
    const cfg = await getMemoryConfig();
    const thresholdMs = cfg._minutes * 60000;
    let sleepable = 0;
    for (const tab of tabs) {
      if (!/^https?:/i.test(tab.url || tab.pendingUrl || '') && !tab.discarded) { total++; continue; }
      total++;
      if (tab.discarded) { sleeping++; continue; }
      if (HEAVY_HOSTS.test(tab.url || '')) heavy++;
      const keep = tabKeepReason(tab, cfg);
      const last = tabLastUsed(tab, now);
      if (!keep && (now - last) >= thresholdMs) sleepable++;
    }
    const awake = total - sleeping;
    // rough memory pressure label from awake + heavy tabs
    let level = 'Low';
    if (awake >= 25 || heavy >= 4) level = 'High';
    else if (awake >= 10 || heavy >= 2) level = 'Medium';
    // estimated savings available from sleeping the sleepable ones
    let saved = 'Low';
    if (sleepable >= 8 || (heavy >= 2 && sleepable >= 3)) saved = 'High';
    else if (sleepable >= 3) saved = 'Medium';
    return { ok: true, total, awake, sleeping, heavy, sleepable, level, saved, mode: cfg._mode, minutes: cfg._minutes };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// Keep the sweep alarm only while Memory Shield is on. Reuse a matching alarm:
// recreating it on each worker wake postpones the sweep. Preserve it on a
// storage-read failure rather than silently disabling protection.
const MEMORY_SWEEP_ALARM = 'wardenone-memory-sweep';
const MEMORY_SWEEP_PERIOD_MINUTES = 5;
async function existingMemorySweepAlarm() {
  try {
    if (!chrome.alarms || typeof chrome.alarms.get !== 'function') return null;
    const alarm = await chrome.alarms.get(MEMORY_SWEEP_ALARM);
    return alarm && alarm.name === MEMORY_SWEEP_ALARM ? alarm : null;
  } catch (_) { return null; }
}
async function reconcileMemorySweepAlarm(cfgArg) {
  let wanted = true;
  try {
    const cfg = cfgArg || await getMemoryConfig();
    wanted = !!(cfg && cfg.memoryShield);
  } catch (_) {}
  try {
    if (!wanted) {
      await chrome.alarms.clear(MEMORY_SWEEP_ALARM);
      return wanted;
    }
    const existing = await existingMemorySweepAlarm();
    if (existing && existing.periodInMinutes === MEMORY_SWEEP_PERIOD_MINUTES) return wanted;
    chrome.alarms.create(MEMORY_SWEEP_ALARM, { periodInMinutes: MEMORY_SWEEP_PERIOD_MINUTES });
  } catch (_) {}
  return wanted;
}
reconcileMemorySweepAlarm();

// ---- Tab Limit --------------------------------------------------------------
// Apply the usual idle-tab guards. Sleep only the stalest eligible tab per trigger,
// since discarding does not reduce the tab count; closing can bring it back to the cap.
const TAB_LIMIT_ENFORCE_TIMERS = Object.create(null);
const TAB_LIMIT_MAX_ACTIONS_PER_RUN = 5;

function fmtIdleMinutes(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? h + 'h ' + r + 'm' : h + 'h';
}

async function notifyTabLimitClosed(host, idleMin) {
  if (!(await extensionUiAllowed())) return;
  try {
    await showWardenSystemNotification('wo-tablimit-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Tab Limit',
      message: 'Closed an old tab to stay under your limit: ' + (host || 'a tab')
        + (idleMin ? ' (inactive ' + fmtIdleMinutes(idleMin) + ')' : ''),
      priority: 1,
    }, 'tab_limit_closed');
  } catch (_) {}
}

// A window can close inside the debounce. Nothing cleared its timer, so the handle and the window
// id stayed reachable until it fired and enforced a limit on a window that no longer exists.
try {
  chrome.windows.onRemoved.addListener((windowId) => {
    const timer = TAB_LIMIT_ENFORCE_TIMERS[windowId];
    if (timer) clearTimeout(timer);
    delete TAB_LIMIT_ENFORCE_TIMERS[windowId];
  });
} catch (_) {}

function scheduleTabLimitCheck(windowId) {
  if (windowId == null || windowId < 0) return;
  if (TAB_LIMIT_ENFORCE_TIMERS[windowId]) clearTimeout(TAB_LIMIT_ENFORCE_TIMERS[windowId]);
  // small debounce so opening several links at once enforces a single time
  TAB_LIMIT_ENFORCE_TIMERS[windowId] = setTimeout(() => {
    delete TAB_LIMIT_ENFORCE_TIMERS[windowId];
    enforceTabLimit(windowId).catch(() => {});
  }, 700);
}

async function enforceTabLimit(windowId) {
  const cfg = await getMemoryConfig();
  if (!cfg.tabLimitGuard) return;
  const max = Math.max(2, parseInt(cfg.tabLimitMax, 10) || 0);
  if (!max) return;
  const close = !!cfg.tabLimitClose;
  const minIdleMs = Math.max(0, Number(cfg.tabLimitMinIdleMinutes) || 0) * 60000;
  const now = Date.now();

  // only enforce in normal browser windows (not popups, panels, devtools)
  try { const win = await chrome.windows.get(windowId); if (win && win.type && win.type !== 'normal') return; } catch (_) {}

  let tabs;
  try { tabs = await chrome.tabs.query({ windowId }); } catch (_) { return; }
  if (!tabs || tabs.length <= max) return;

  // Sort eligible tabs by persistent last-use time. Close mode may trim empty new-tab placeholders,
  // but never the active or pinned tab.
  const isDisposableTab = (tab) => {
    const u = tab.url || tab.pendingUrl || '';
    return u === '' || u === 'about:blank'
      || /^(chrome|edge|brave|chrome-search|about):\/?\/?(newtab|new-tab-page|local-ntp|blank)\b/i.test(u);
  };
  const safe = [];
  for (const tab of tabs) {
    const disposable = close && isDisposableTab(tab) && !tab.active && !tab.pinned;
    if (tabKeepReason(tab, cfg) && !disposable) continue;  // protected unless a disposable new-tab
    if (!close && tab.discarded) continue;                 // already asleep -> its RAM is freed
    const last = tabLastUsed(tab, now);
    safe.push({ tab, idleMs: now - last, lastUsed: last, selectedUrl: tab.url || tab.pendingUrl || '', disposable });
  }
  if (!safe.length) return;
  // close empty new-tab pages first, then the most-idle (least-recently-used) real tabs.
  safe.sort((a, b) => (a.disposable !== b.disposable ? (a.disposable ? -1 : 1) : b.idleMs - a.idleMs));

  const over = tabs.length - max;
  let candidates;
  if (close) {
    // CLOSE is the aggressive hard cap the user opted into: enforce the limit by closing
    // the least-recently-used non-protected tabs (idle ones first, since they're sorted
    // that way), even if everything is recent. minIdle only gates SLEEP mode below.
    candidates = safe.slice(0, Math.min(over, TAB_LIMIT_MAX_ACTIONS_PER_RUN));
  } else {
    // SLEEP stays gentle: only a genuinely-idle tab, just one per trigger.
    candidates = safe.filter((s) => s.idleMs >= minIdleMs).slice(0, 1);
    if (!candidates.length) return;
  }

  for (const { tab, lastUsed, selectedUrl } of candidates) {
    // final live-state check right before acting (camera/mic, unsaved form)
    const live = await tabLiveState(tab.id);
    if (!live.ok) continue; // no answer is not the same as a clean answer, and this path can close
    if (live.mediaActive) continue;
    if (cfg.memoryNeverForms && live.formDirty) continue;
    let currentCount = tabs.length;
    if (close) {
      try { currentCount = (await chrome.tabs.query({ windowId })).length; } catch (_) { continue; }
      if (currentCount <= max) break;
    }
    const fresh = await tabsGet(tab.id);
    if (!fresh || fresh.windowId !== windowId) continue;
    const freshDisposable = close && isDisposableTab(fresh) && !fresh.active && !fresh.pinned;
    if (tabKeepReason(fresh, cfg) && !freshDisposable) continue;
    if ((fresh.url || fresh.pendingUrl || '') !== selectedUrl) continue;
    const freshNow = Date.now();
    const freshLastUsed = tabLastUsed(fresh, freshNow);
    if (freshLastUsed > lastUsed || (!close && (fresh.discarded || freshNow - freshLastUsed < minIdleMs))) continue;
    const host = (() => { try { return new URL(fresh.url).hostname.replace(/^www\./, ''); } catch { return fresh.url || ''; } })();
    const idleMin = Math.round((freshNow - freshLastUsed) / 60000);
    try {
      if (close) {
        await chrome.tabs.remove(tab.id);
        queueHistory({ type: 'tab_limit_closed', detail: { host, idleMin, max, count: currentCount }, url: host, at: Date.now() });
        if (cfg.tabLimitWarn) notifyTabLimitClosed(host, idleMin);
      } else {
        const discarded = await chrome.tabs.discard(tab.id);
        if (!discarded) continue;
        queueHistory({ type: 'tab_limit_slept', detail: { host, idleMin, max, count: currentCount }, url: host, at: Date.now() });
      }
    } catch (_) { /* tab closed or can't be discarded -- skip */ }
  }
}

// Enforce the tab limit across every normal window now -- used when the user enables
// the guard or changes the limit, so excess tabs are trimmed immediately instead of
// only on the next tab you open.
async function enforceTabLimitAllWindows() {
  try {
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const w of wins) { if (w && w.id != null) enforceTabLimit(w.id).catch(() => {}); }
  } catch (_) {}
}

try {
  chrome.tabs.onCreated.addListener((tab) => { if (tab) scheduleTabLimitCheck(tab.windowId); });
} catch (_) {}

// ---- Heavy-tab detector: list currently-open heavy tabs (awake) ----
async function listHeavyTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const heavy = [];
    for (const tab of tabs) {
      if (tab.discarded) continue;
      const url = tab.url || '';
      if (!/^https?:/i.test(url)) continue;
      let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { continue; }
      if (HEAVY_HOSTS.test(url)) {
        heavy.push({ id: tab.id, host, title: (tab.title || host).slice(0, 60), active: tab.active, audible: !!tab.audible });
      }
    }
    return { ok: true, heavy };
  } catch (e) { return { ok: false, error: String(e) }; }
}

function tabMemoryPressure(tab, cfg, now) {
  const url = tab.url || tab.pendingUrl || '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
  const last = tabLastUsed(tab, now);
  const idleMin = Math.max(0, Math.round((now - last) / 60000));
  const keep = tabKeepReason(tab, cfg);
  let score = 0;
  const reasons = [];
  if (tab.discarded) {
    reasons.push('already sleeping');
    score -= 5;
  }
  if (tab.frozen) reasons.push('Chrome frozen');
  if (HEAVY_HOSTS.test(url)) { score += 4; reasons.push('known heavy site'); }
  if (/video|stream|canvas|editor|meeting|call|figma|canva|docs|spreadsheet|discord|teams|meet/i.test(String(tab.title || '') + ' ' + url)) {
    score += 2;
    if (!reasons.includes('known heavy site')) reasons.push('heavy-page signal');
  }
  if (idleMin >= 360) { score += 3; reasons.push('idle ' + fmtIdleMinutes(idleMin)); }
  else if (idleMin >= 60) { score += 2; reasons.push('idle ' + fmtIdleMinutes(idleMin)); }
  else if (idleMin >= 15) { score += 1; reasons.push('idle ' + fmtIdleMinutes(idleMin)); }
  if (tab.audible) { score += 1; reasons.push('audio'); }
  if (tab.pinned) reasons.push('pinned');
  if (tab.active) reasons.push('active');
  if (tab.autoDiscardable === false) reasons.push('Chrome auto-discard off');
  if (keep && !reasons.includes(keep)) reasons.push(keep);
  const impact = tab.discarded ? 'Sleeping' : score >= 6 ? 'High' : score >= 3 ? 'Medium' : 'Low';
  return {
    id: tab.id,
    windowId: tab.windowId,
    host,
    title: (tab.title || host || 'Untitled tab').slice(0, 90),
    url: url.slice(0, 500),
    active: !!tab.active,
    pinned: !!tab.pinned,
    audible: !!tab.audible,
    discarded: !!tab.discarded,
    frozen: !!tab.frozen,
    autoDiscardable: tab.autoDiscardable !== false,
    idleMin,
    idle: fmtIdleMinutes(idleMin),
    impact,
    score,
    protected: !!keep,
    keepReason: keep || '',
    sleepable: !keep && !tab.discarded,
    reasons: reasons.slice(0, 5),
  };
}

async function listMemoryTabs() {
  try {
    const cfg = await getMemoryConfig();
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const rows = [];
    for (const tab of tabs) {
      const url = tab.url || tab.pendingUrl || '';
      if (!tab.discarded && !/^https?:\/\//i.test(url)) continue;
      rows.push(tabMemoryPressure(tab, cfg, now));
    }
    rows.sort((a, b) => {
      if (a.discarded !== b.discarded) return a.discarded ? 1 : -1;
      if (a.sleepable !== b.sleepable) return a.sleepable ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return b.idleMin - a.idleMin;
    });
    const summary = { total: rows.length, sleepable: 0, high: 0, sleeping: 0 };
    for (const row of rows) {
      if (row.sleepable) summary.sleepable++;
      if (row.impact === 'High') summary.high++;
      if (row.discarded) summary.sleeping++;
    }
    return {
      ok: true,
      summary,
      tabs: rows.slice(0, 30),
    };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// ---- Zombie-tab detector: awake tabs idle for a long time (default 6h) ----
async function listZombieTabs(hours) {
  try {
    const h = hours || 6;
    const cutoff = Date.now() - h * 3600000;
    const tabs = await chrome.tabs.query({});
    const cfg = await getMemoryConfig();
    const zombies = [];
    for (const tab of tabs) {
      if (tab.discarded || tab.active) continue;
      if (!/^https?:/i.test(tab.url || '')) continue;
      const last = tabLastUsedOrNull(tab);
      if (last == null) continue; // unknown age -> don't accuse
      if (last > cutoff) continue;
      const keep = tabKeepReason(tab, cfg);
      let host = ''; try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) {}
      zombies.push({ id: tab.id, host, title: (tab.title || host).slice(0, 60), idleHours: Math.floor((Date.now() - last) / 3600000), protected: !!keep, keepReason: keep || null });
    }
    return { ok: true, zombies, hours: h };
  } catch (e) { return { ok: false, error: String(e) }; }
}

async function memoryActOnTab(tabId, action, opts) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || id < 0) return { ok: false, error: 'Invalid tab.' };
  const tab = await tabsGet(id);
  if (!tab) return { ok: false, error: 'Tab no longer exists.' };
  const cfg = await getMemoryConfig();
  const keep = tabKeepReason(tab, cfg);
  if (keep) return { ok: false, error: 'Protected tab: ' + keep };
  const requireIdleHours = opts && Number(opts.requireIdleHours) >= 0 ? Number(opts.requireIdleHours) : 6;
  const last = tabLastUsedOrNull(tab) || 0;
  if (requireIdleHours > 0 && (!last || (Date.now() - last) < requireIdleHours * 3600000)) return { ok: false, error: 'Tab is no longer idle enough.' };
  const selected = sleepSelection(tab, tabLastUsedOrNull(tab));
  const live = await tabLiveState(id);
  if (!live.ok) return { ok: false, error: "Couldn't check this tab for unsaved work. Try again, or reload the tab first." };
  if (cfg.memoryNeverForms && live.formDirty) return { ok: false, error: 'Protected tab: unsaved form' };
  if (live.mediaActive) return { ok: false, error: 'Protected tab: camera/mic in use' };
  const still = await tabStillSleepable(selected, cfg, requireIdleHours * 3600000);
  if (!still.ok) {
    if (still.reason === 'tab closed') return { ok: false, error: 'Tab no longer exists.' };
    return { ok: false, error: still.protected ? 'Protected tab: ' + still.reason : 'Tab was used or changed while it was being checked.' };
  }
  try {
    if (action === 'sleep') {
      const discarded = await chrome.tabs.discard(id);
      if (!discarded) return { ok: false, error: 'Chrome refused to sleep this tab.' };
      return { ok: true, action: 'sleep', tabId: id };
    }
    if (action === 'close') {
      await chrome.tabs.remove(id);
      return { ok: true, action: 'close', tabId: id };
    }
    return { ok: false, error: 'Unknown memory action.' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---- Right-click actions on the tab you are looking at -----------------------------
// Explicit actions bypass sweep exemptions, including active and pinned tabs.
// Only confirmed unsaved input or camera/mic use blocks them; an unreachable bridge does not.
async function tabWorkInProgressReason(tab, cfg) {
  if (!tab || typeof tab.id !== 'number') return '';
  // Nothing of ours runs outside http(s), so there is nobody to ask and nothing it
  // could have seen.
  if (!/^https?:\/\//i.test(String(tab.url || tab.pendingUrl || ''))) return '';
  const live = await tabLiveState(tab.id);
  if (!live.ok) return '';
  // Unconditional: there is no switch that means "close my video call for me".
  if (live.mediaActive) return 'this tab is using your camera or microphone';
  // This one follows the reader's own setting, because that switch is exactly the
  // question "should unsaved typing stop a tab being thrown away".
  if (cfg && cfg.memoryNeverForms === false) return '';
  if (live.formDirty) return 'this tab has unsaved text typed into it';
  return '';
}

// The tab Chrome would have put you on anyway: the next one to the right, else the
// nearest to the left. Jumping to the far end of the strip is disorienting.
async function neighbourTabOf(tab) {
  try {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const others = (tabs || []).filter((t) => t && typeof t.id === 'number' && t.id !== tab.id);
    if (!others.length) return null;
    const index = Number(tab.index);
    if (!Number.isFinite(index)) return others[0];
    const right = others.filter((t) => t.index > index).sort((a, b) => a.index - b.index)[0];
    if (right) return right;
    return others.filter((t) => t.index < index).sort((a, b) => b.index - a.index)[0] || others[0];
  } catch (_) { return null; }
}

async function memorySleepTabByHand(tabArg) {
  const id = tabArg && typeof tabArg.id === 'number' ? tabArg.id : null;
  if (id === null) return { ok: false, error: 'Chrome gave WardenOne no tab to sleep.' };
  const tab = (await tabsGet(id)) || tabArg;
  if (tab.discarded) return { ok: false, error: 'This tab is already asleep. Click it to wake it up.' };
  const cfg = await getMemoryConfig();
  const busy = await tabWorkInProgressReason(tab, cfg);
  if (busy) {
    return { ok: false, error: 'Not slept, because ' + busy
      + '. Sleeping reloads the tab, so that would be gone.' };
  }

  // Activate a neighbour before discarding so the current page does not turn blank in place.
  // Chrome also permits discarding the sole tab, so a missing neighbour is not a refusal.
  if (tab.active) {
    const neighbour = await neighbourTabOf(tab);
    if (neighbour) { try { await chrome.tabs.update(neighbour.id, { active: true }); } catch (_) {} }
  }

  // Use discard’s returned tab to confirm success; the original ID may no longer resolve.
  let discarded = null;
  try { discarded = await chrome.tabs.discard(tab.id); } catch (_) { discarded = null; }
  if (!discarded) return { ok: false, error: 'Chrome refused to sleep this tab.' };
  // Read from the tab as it was before the discard, which is the copy already in hand.
  const host = (() => { try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
  // Distinguish a requested sleep from an automatic idle-tab action in activity history.
  queueHistory({ type: 'memory_tab_slept_by_hand', detail: { host }, url: host, at: Date.now() });
  return { ok: true, host };
}

async function memoryCloseTabByHand(tabArg) {
  const id = tabArg && typeof tabArg.id === 'number' ? tabArg.id : null;
  if (id === null) return { ok: false, error: 'Chrome gave WardenOne no tab to close.' };
  const tab = (await tabsGet(id)) || tabArg;
  const cfg = await getMemoryConfig();
  const busy = await tabWorkInProgressReason(tab, cfg);
  if (busy) {
    // tabs.remove bypasses beforeunload. Send users to Ctrl+W when a native unsaved-work prompt is needed.
    return { ok: false, error: 'Not closed, because ' + busy + '. Ctrl+W still closes it.' };
  }
  try { await chrome.tabs.remove(tab.id); } catch (_) { return { ok: false, error: 'Chrome refused to close this tab.' }; }
  return { ok: true };
}

// ---- Tab-group sleeping: discard all safe tabs in groups idle past threshold ----
async function sleepIdleGroups(cfgArg, snapshot) {
  try {
    // Read groupId through chrome.tabs; no chrome.tabGroups API is used here.
    // No grouped tabs is a successful zero-result action, not an unsupported feature.
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return { ok: false, disabled: true };
    const tabs = snapshot ? snapshot.tabs : await chrome.tabs.query({});
    const now = snapshot ? snapshot.now : Date.now();
    const thresholdMs = cfg._minutes * 60000;
    // group tabs by groupId (>-1 means grouped)
    const groups = Object.create(null);
    for (const tab of tabs) {
      if (tab.groupId == null || tab.groupId < 0) continue;
      (groups[tab.groupId] = groups[tab.groupId] || []).push(tab);
    }
    let sleptGroups = 0, sleptTabs = 0;
    for (const gid in groups) {
      const gtabs = groups[gid];
      // a group is "idle" only if EVERY tab in it is idle past threshold and none active
      const allIdle = gtabs.every((t) => {
        if (t.active) return false;
        const state = snapshot && snapshot.states.get(t.id);
        return (state ? state.idleMs : now - tabLastUsed(t, now)) >= thresholdMs;
      });
      if (!allIdle) continue;
      if (snapshot) {
        const groupSlept = gtabs.filter((t) => snapshot.discarded.has(t.id)).length;
        sleptTabs += groupSlept;
        if (groupSlept) sleptGroups++;
        continue;
      }
      const candidates = [];
      for (const t of gtabs) {
        const keep = tabKeepReason(t, cfg);
        if (keep) continue;
        candidates.push(t);
      }
      const results = await mapLimited(candidates, MEMORY_LIVE_CHECK_CONCURRENCY, async (t) => {
        const selected = sleepSelection(t, tabLastUsed(t, now));
        const live = await tabLiveState(t.id);
        if (!live.ok) return false;
        if ((cfg.memoryNeverForms && live.formDirty) || live.mediaActive) return false;
        const still = await tabStillSleepable(selected, cfg, thresholdMs);
        if (!still.ok || still.tab.groupId !== t.groupId) return false;
        try { return !!(await chrome.tabs.discard(t.id)); } catch (_) { return false; }
      });
      const groupSlept = results.filter(Boolean).length;
      sleptTabs += groupSlept;
      const groupSleptAny = groupSlept > 0;
      if (groupSleptAny) sleptGroups++;
    }
    if (sleptTabs) queueHistory({ type: 'memory_group_slept', detail: { groups: sleptGroups, tabs: sleptTabs }, url: '', at: Date.now() });
    return { ok: true, sleptGroups, sleptTabs };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// Background throttle pauses autoplay media in inactive tabs; it cannot unload scripts or flush tab RAM.
async function throttleInactiveTabs(cfgArg, snapshot) {
  try {
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return;
    // throttle tabs idle past HALF the sleep threshold (the "freeze" stage before
    // the later discard). e.g. balanced(30m) -> pause media at 15m, discard at 30m.
    const halfMs = (cfg._minutes * 60000) / 2;
    const now = snapshot ? snapshot.now : Date.now();
    const tabs = snapshot ? snapshot.tabs : await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.active || tab.discarded || tab.audible) continue;
      if (!/^https?:/i.test(tab.url || '')) continue;
      try {
        if (isVideoPlatformHost(new URL(tab.url).hostname)) continue;
      } catch (_) {}
      const state = snapshot && snapshot.states.get(tab.id);
      const keep = state ? state.keep : tabKeepReason(tab, cfg);
      if (keep) continue;
      // Throttling stays fail-open on purpose -- the worst outcome here is a paused video, not a
      // lost draft, so this path never consults live state and never needs to.
      const idleMs = state ? state.idleMs : now - tabLastUsed(tab, now);
      if (idleMs < halfMs) continue;
      try { chrome.tabs.sendMessage(tab.id, { kind: 'memory-throttle' }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    }
  } catch (_) {}
}

try {
  if (globalThis.__WARDENONE_TEST__) {
    globalThis.__woMemoryTest = Object.freeze({
      MEMORY_DEFAULTS,
      MEMORY_MODES,
      MEMORY_NEVER_SLEEP_MAX,
      memoryNeverSleepHas,
      tabWorkInProgressReason,
      neighbourTabOf,
      tabKeepReason,
      tabMemoryPressure,
      mapLimited,
      fmtIdleMinutes,
      tabActivity,
      tabLastUsed,
      tabLastUsedOrNull,
      tabLiveState,
      reconcileMemorySweepAlarm,
      MEMORY_SWEEP_ALARM,
      MEMORY_SWEEP_PERIOD_MINUTES,
      MEMORY_LIVE_CHECK_TIMEOUT_MS,
    });
  }
} catch (_) {}

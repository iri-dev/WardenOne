/*
 * WebWarden Memory Shield runtime
 * =================================
 * Owns tab sleeping, RAM scoring, duplicate/zombie tab helpers, tab-limit
 * enforcement, and popup-facing memory actions. Loaded by background.js with
 * importScripts() so the MV3 worker keeps a smaller main file.
 */

// ======================= Memory Shield =======================
// Saves RAM by DISCARDING (sleeping) inactive tabs via chrome.tabs.discard().
// A discarded tab stays in the tab strip and reloads when clicked -- nothing is
// closed or lost. We track per-tab last-active time and, on a periodic sweep,
// discard tabs that are safe AND have been inactive past the mode's threshold.
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
  // Tab Limit: keep tab count under a user cap by sleeping (or, opt-in,
  // closing) the oldest inactive tab when a new tab crosses the limit.
  tabLimitGuard: false,
  tabLimitMax: 20,
  tabLimitClose: false,          // false = sleep (safe default); true = close (aggressive)
  tabLimitMinIdleMinutes: 30,    // a tab must be idle at least this long to be eligible
  tabLimitWarn: true,            // notify when a tab is closed
};
// last-active timestamp per tabId (in-memory; rebuilt on SW restart from "now")
const tabActivity = Object.create(null);
const markTabActive = (tabId) => { if (tabId != null) tabActivity[tabId] = Date.now(); };

// keep activity fresh on the signals that mean "the user is using this tab"
try {
  chrome.tabs.onActivated.addListener((info) => markTabActive(info.tabId));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    // a navigation or load is activity; also seed unknown tabs
    if (change.status === 'loading' || change.url || change.audible) markTabActive(tabId);
    if (tabActivity[tabId] == null) markTabActive(tabId);
  });
  chrome.tabs.onCreated.addListener((tab) => markTabActive(tab.id));
  chrome.tabs.onRemoved.addListener((tabId) => { delete tabActivity[tabId]; });
  // when a window gains focus, its active tab is "active"
  chrome.windows?.onFocusChanged.addListener((winId) => {
    if (winId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId: winId }, (tabs) => { if (tabs && tabs[0]) markTabActive(tabs[0].id); });
  });
} catch (_) {}

async function getMemoryConfig() {
  const store = await localGet('webwarden_config');
  const cfg = (store && store.webwarden_config) || {};
  const m = {};
  for (const k in MEMORY_DEFAULTS) m[k] = (cfg[k] === undefined ? MEMORY_DEFAULTS[k] : cfg[k]);
  // resolve threshold minutes
  const mode = MEMORY_MODES[m.memoryMode] ? m.memoryMode : 'balanced';
  m._minutes = m.memoryMinutesOverride > 0 ? m.memoryMinutesOverride : MEMORY_MODES[mode].minutes;
  m._mode = mode;
  // share the allowlist already used by the rest of the extension
  m._allowlist = normalizeAllowlistHosts(cfg.allowlist || []);
  return m;
}

// Is a tab safe to put to sleep? Returns null if safe, else a reason it was kept.
function tabKeepReason(tab, cfg) {
  if (!tab || tab.discarded) return 'already asleep';
  if (tab.active) return 'active tab';
  if (tab.audible) return 'playing audio';
  if (cfg.memoryNeverPinned && tab.pinned) return 'pinned';
  const url = tab.url || tab.pendingUrl || '';
  if (!/^https?:\/\//i.test(url)) return 'browser/internal page'; // chrome://, about:, extension pages, new tab
  try {
    const host = new URL(url).hostname;
    if (isVideoPlatformHost(host)) return 'video/live playback site';
  } catch (_) {}
  // payment / banking / login pages -- never sleep mid-transaction
  if (cfg.memoryNeverPayment && /(checkout|payment|pay|billing|bank|signin|sign-in|login|account\/|secure|wallet|paypal|stripe)/i.test(url)) return 'login/payment page';
  // allowlisted sites (shared allowlist)
  try {
    const host = new URL(url).hostname;
    if (hostMatchesAllowlist(host, cfg._allowlist || [])) return 'allowlisted';
  } catch (_) {}
  return null; // safe to discard (audio/camera covered by audible + the content-side form check below is best-effort)
}

// Ask a tab's bridge whether it has unsaved form input or active camera/mic.
// Resolves {formDirty,mediaActive} = false on any error/timeout (so a
// non-responsive tab never blocks sleeping forever).
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
    timer = setTimeout(() => finish({ formDirty: false, mediaActive: false }), 400);
    try {
      chrome.tabs.sendMessage(tabId, { kind: 'memory-form-check' }, (res) => {
        if (chrome.runtime.lastError) return finish({ formDirty: false, mediaActive: false });
        finish({ formDirty: !!(res && res.formDirty), mediaActive: !!(res && res.mediaActive) });
      });
    } catch (_) { finish({ formDirty: false, mediaActive: false }); }
  });
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

// Discard tabs that are safe and inactive past the threshold.
async function memorySweep(reason, cfgArg) {
  try {
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return { ok: false, disabled: true };
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const thresholdMs = cfg._minutes * 60000;
    const candidates = [];
    for (const tab of tabs) {
      const keep = tabKeepReason(tab, cfg);
      if (keep) continue;
      const last = tabActivity[tab.id] || now; // unknown -> treat as just-active (don't nuke on first sweep)
      const idleMs = now - last;
      if (idleMs < thresholdMs) continue;
      candidates.push({ tab, idleMs });
    }
    const results = await mapLimited(candidates, MEMORY_LIVE_CHECK_CONCURRENCY, async ({ tab, idleMs }) => {
      // Check the tab's live state once. We always check active camera/mic (a live
      // media tab must never be slept); the form-dirty check only applies when the
      // user has form protection enabled.
      const live = await tabLiveState(tab.id);
      if (live.mediaActive) return null; // active camera/mic -- never sleep
      if (cfg.memoryNeverForms && live.formDirty) return null; // unsaved form input
      try {
        await chrome.tabs.discard(tab.id);
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
      const live = await tabLiveState(tab.id);
      if (cfg.memoryNeverForms && live.formDirty) return { kept: 'unsaved form' };
      if (live.mediaActive) return { kept: 'camera/mic in use' };
      try { await chrome.tabs.discard(tab.id); return { slept: true }; } catch (_) { return null; }
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

// Duplicate-tab detector: group tabs by normalized URL.
async function findDuplicateTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    const byUrl = Object.create(null);
    for (const tab of tabs) {
      const u = (tab.url || '').split('#')[0];
      if (!/^https?:/i.test(u)) continue;
      (byUrl[u] = byUrl[u] || []).push({ id: tab.id, title: tab.title, active: tab.active });
    }
    const dups = [];
    for (const u in byUrl) { if (byUrl[u].length > 1) dups.push({ url: u, count: byUrl[u].length, tabs: byUrl[u] }); }
    const extra = dups.reduce((n, d) => n + (d.count - 1), 0);
    return { ok: true, groups: dups, extraCount: extra };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// Close all-but-one of each duplicate URL (keeps the active one if present).
async function closeDuplicateTabs() {
  try {
    const { groups } = await findDuplicateTabs();
    let closed = 0;
    for (const g of (groups || [])) {
      // keep the active tab, else the first
      const keepId = (g.tabs.find((t) => t.active) || g.tabs[0]).id;
      for (const t of g.tabs) {
        if (t.id !== keepId) { try { await chrome.tabs.remove(t.id); closed++; } catch (_) {} }
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
      const last = tabActivity[tab.id] || now;
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

function scheduleMemorySweep() {
  try { chrome.alarms.create('webwarden-memory-sweep', { periodInMinutes: 5 }); } catch (_) {}
}
scheduleMemorySweep();

// ---- Tab Limit --------------------------------------------------------------
// When a newly-opened tab pushes a window past the user's limit, act on the
// oldest tab that has been inactive past the minimum idle time: sleep it
// (default, reversible) or close it (aggressive, opt-in). Every Memory Shield
// protection still applies via tabKeepReason() + tabLiveState(), so active,
// pinned, audio, unsaved-form, login/payment, allowlisted, and internal tabs are
// never touched. Sleeping doesn't reduce the tab count, so we only relieve the
// single stalest tab per trigger; closing brings the count back down to the cap.
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
    chrome.notifications.create('ww-tablimit-' + Date.now(), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Tab Limit',
      message: 'Closed an old tab to stay under your limit: ' + (host || 'a tab')
        + (idleMin ? ' (inactive ' + fmtIdleMinutes(idleMin) + ')' : ''),
      priority: 1,
    });
  } catch (_) {}
}

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

  // Safe-to-act tabs (never active/pinned/audio/login/internal/allowlisted). Idle time
  // comes from Chrome's PERSISTENT tab.lastAccessed -- the in-memory tabActivity map is
  // wiped whenever the service worker restarts, which made every tab look "just active"
  // (idle 0) so nothing ever qualified. Sorted most-stale (least-recently-used) first.
  // Empty "New tab" / blank placeholder pages are disposable -- in CLOSE mode they are
  // fair game for the cap even though they're internal pages (so a window full of New
  // tabs actually gets trimmed). Never the active or pinned one.
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
    const last = Number(tab.lastAccessed) || tabActivity[tab.id] || now;
    safe.push({ tab, idleMs: now - last, disposable });
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

  for (const { tab, idleMs } of candidates) {
    // final live-state check right before acting (camera/mic, unsaved form)
    const live = await tabLiveState(tab.id);
    if (live.mediaActive) continue;
    if (cfg.memoryNeverForms && live.formDirty) continue;
    const host = (() => { try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return tab.url || ''; } })();
    const idleMin = Math.round(idleMs / 60000);
    try {
      if (close) {
        await chrome.tabs.remove(tab.id);
        queueHistory({ type: 'tab_limit_closed', detail: { host, idleMin, max, count: tabs.length }, url: host, at: Date.now() });
        if (cfg.tabLimitWarn) notifyTabLimitClosed(host, idleMin);
      } else {
        await chrome.tabs.discard(tab.id);
        queueHistory({ type: 'tab_limit_slept', detail: { host, idleMin, max, count: tabs.length }, url: host, at: Date.now() });
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
  const last = Number(tab.lastAccessed) || tabActivity[tab.id] || now;
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
      const last = Number(tab.lastAccessed) || tabActivity[tab.id];
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
  const last = Number(tab.lastAccessed) || tabActivity[id] || 0;
  if (requireIdleHours > 0 && (!last || (Date.now() - last) < requireIdleHours * 3600000)) return { ok: false, error: 'Tab is no longer idle enough.' };
  const live = await tabLiveState(id);
  if (cfg.memoryNeverForms && live.formDirty) return { ok: false, error: 'Protected tab: unsaved form' };
  if (live.mediaActive) return { ok: false, error: 'Protected tab: camera/mic in use' };
  try {
    if (action === 'sleep') {
      if (!tab.discarded) await chrome.tabs.discard(id);
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

// ---- Tab-group sleeping: discard all safe tabs in groups idle past threshold ----
async function sleepIdleGroups(cfgArg) {
  try {
    if (!chrome.tabGroups) return { ok: false, error: 'Tab groups not supported' };
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return { ok: false, disabled: true };
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
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
        const last = tabActivity[t.id] || now;
        return (now - last) >= thresholdMs;
      });
      if (!allIdle) continue;
      const candidates = [];
      for (const t of gtabs) {
        const keep = tabKeepReason(t, cfg);
        if (keep) continue;
        candidates.push(t);
      }
      const results = await mapLimited(candidates, MEMORY_LIVE_CHECK_CONCURRENCY, async (t) => {
        const live = await tabLiveState(t.id);
        if ((cfg.memoryNeverForms && live.formDirty) || live.mediaActive) return false;
        try { await chrome.tabs.discard(t.id); return true; } catch (_) { return false; }
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

// ---- Background throttle: pause autoplay media in inactive tabs (the honest,
// achievable part of "reduce background activity before discard"). We can't flush
// a tab's RAM cache or strip already-loaded scripts -- no extension can -- but we
// CAN tell an inactive tab to pause autoplaying audio/video, which cuts real CPU.
async function throttleInactiveTabs(cfgArg) {
  try {
    const cfg = cfgArg || await getMemoryConfig();
    if (!cfg.memoryShield) return;
    // throttle tabs idle past HALF the sleep threshold (the "freeze" stage before
    // the later discard). e.g. balanced(30m) -> pause media at 15m, discard at 30m.
    const halfMs = (cfg._minutes * 60000) / 2;
    const now = Date.now();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.active || tab.discarded || tab.audible) continue;
      if (!/^https?:/i.test(tab.url || '')) continue;
      try {
        if (isVideoPlatformHost(new URL(tab.url).hostname)) continue;
      } catch (_) {}
      const keep = tabKeepReason(tab, cfg);
      if (keep) continue;
      const last = tabActivity[tab.id] || now;
      if ((now - last) < halfMs) continue;
      try { chrome.tabs.sendMessage(tab.id, { kind: 'memory-throttle' }, () => { void chrome.runtime.lastError; }); } catch (_) {}
    }
  } catch (_) {}
}

try {
  if (globalThis.__WEBWARDEN_TEST__) {
    globalThis.__wwMemoryTest = Object.freeze({
      MEMORY_DEFAULTS,
      MEMORY_MODES,
      tabKeepReason,
      tabMemoryPressure,
      mapLimited,
      fmtIdleMinutes,
    });
  }
} catch (_) {}

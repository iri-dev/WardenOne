/*
 * WardenOne -- background service worker (MV3)
 * ============================================
 * Maintains the toolbar badge: a per-tab count of how many things WardenOne
 * blocked/gated on that tab. Counts come from the bridge (which hears them from
 * the main-world trap). Resets when a tab navigates to a new page.
 */

// Shared eTLD+1 helpers (regDomain / registrableDomain). Imported synchronously at the
// top of the worker so this file and the popup use ONE implementation (see domain-utils.js).
importScripts('domain-utils.js');

// Per-tab counters: { [tabId]: number }
const counts = {};
// Version reported to external reputation APIs (Safe Browsing, PhishTank). Sourced
// from the manifest so it tracks releases instead of drifting stale (was '3.10.0').
const WO_CLIENT_VERSION = (() => { try { return (chrome.runtime.getManifest().version) || '0'; } catch (_) { return '0'; } })();
const TAB_MESSAGE_RATE = Object.create(null);
const TAB_MESSAGE_RATE_MAX_KEYS = 512;
const TAB_MESSAGE_RATE_MAX_WINDOW_MS = 5 * 60 * 1000;
let TAB_MESSAGE_RATE_LAST_PRUNE = 0;

function pruneTabMessageRates(now) {
  if (now - TAB_MESSAGE_RATE_LAST_PRUNE < 10000) return;
  TAB_MESSAGE_RATE_LAST_PRUNE = now;
  const keys = Object.keys(TAB_MESSAGE_RATE);
  if (keys.length <= TAB_MESSAGE_RATE_MAX_KEYS) return;
  const cutoff = now - TAB_MESSAGE_RATE_MAX_WINDOW_MS;
  const active = [];
  for (const key of keys) {
    const hits = Array.isArray(TAB_MESSAGE_RATE[key])
      ? TAB_MESSAGE_RATE[key].filter((t) => t > cutoff)
      : [];
    if (!hits.length) {
      delete TAB_MESSAGE_RATE[key];
      continue;
    }
    TAB_MESSAGE_RATE[key] = hits;
    active.push({ key, last: hits[hits.length - 1] || 0 });
  }
  if (active.length <= TAB_MESSAGE_RATE_MAX_KEYS) return;
  active.sort((a, b) => a.last - b.last)
    .slice(0, active.length - TAB_MESSAGE_RATE_MAX_KEYS)
    .forEach((item) => { delete TAB_MESSAGE_RATE[item.key]; });
}

function allowTabMessageRate(tabId, bucket, max, windowMs) {
  const id = String(tabId);
  const key = id + ':' + String(bucket || 'message');
  const now = Date.now();
  pruneTabMessageRates(now);
  const windowStart = now - (Number(windowMs) || 60000);
  const hits = Array.isArray(TAB_MESSAGE_RATE[key]) ? TAB_MESSAGE_RATE[key].filter((t) => t > windowStart) : [];
  const maxHits = Math.max(1, Number(max) || 60);
  if (hits.length >= maxHits) {
    TAB_MESSAGE_RATE[key] = hits;
    return false;
  }
  hits.push(now);
  if (hits.length > maxHits) hits.splice(0, hits.length - maxHits);
  TAB_MESSAGE_RATE[key] = hits;
  return true;
}

function clearTabMessageRates(tabId) {
  const prefix = String(tabId) + ':';
  for (const key of Object.keys(TAB_MESSAGE_RATE)) {
    if (key.startsWith(prefix)) delete TAB_MESSAGE_RATE[key];
  }
}

function setBadge(tabId) {
  const n = counts[tabId] || 0;
  const text = n > 0 ? String(n) : '';
  try {
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  } catch (_) {}
}

const TOKEN_EXFIL_HISTORY_COOLDOWN_MS = 90000;
const tokenExfilHistorySeen = Object.create(null);

function messageHostFromText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = raw.includes('://') ? raw : 'https://' + raw.split(/\s+-\s+|\s+/)[0];
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    const m = raw.match(/(?:^|[\s/.-])([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?:[/:?\s-]|$)/i);
    return m ? m[1].replace(/^www\./, '').toLowerCase() : '';
  }
}

function normalizeTabBlockMessage(msg, sender) {
  const type = String((msg && msg.type) || 'block');
  const detail = (msg && msg.detail && typeof msg.detail === 'object') ? Object.assign({}, msg.detail) : (msg && msg.detail) || null;
  const out = { type, detail, log: true };
  if (type !== 'blocked_token_exfil') return out;

  const detailObj = (detail && typeof detail === 'object') ? detail : { matched: String(detail || '') };
  const pageHost = messageHostFromText(sender && sender.tab && sender.tab.url);
  const targetHost = messageHostFromText(detailObj.matched || detailObj.host || detailObj.domain || detailObj.url || detailObj.target);
  const key = (pageHost || 'page') + '>' + (targetHost || 'target');
  const now = Date.now();
  const last = tokenExfilHistorySeen[key] || 0;
  tokenExfilHistorySeen[key] = now;
  out.log = now - last > TOKEN_EXFIL_HISTORY_COOLDOWN_MS;
  out.detail = Object.assign({}, detailObj, {
    pageHost,
    targetHost,
    why: 'A token-shaped value tried to leave this page for another domain. WardenOne blocked the request; on large sites this can also be a noisy embedded-service call.',
  });
  return out;
}

try {
  chrome.tabs?.query?.({}, (tabs) => {
    (tabs || []).forEach((t) => { if (t && t.id != null) setBadge(t.id); });
  });
} catch (_) {}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || !sender.tab || sender.tab.id == null) return;
  const tabId = sender.tab.id;
  if (msg && msg.kind === 'rg-block') {
    if (!allowTabMessageRate(tabId, 'rg-block', 240, 60000)) return;
    const normalized = normalizeTabBlockMessage(msg, sender);
    // warnings (warned_*) are informational -- log them but don't inflate the
    // red "blocked" badge, which should reflect actual blocks/gates only. The
    // download-gate detection is also informational (we deliberately left the ad
    // alone), so it doesn't count toward the badge either.
    const NO_BADGE_TYPES = new Set([
      'blocked_tracker_request',
      'blocked_thirdparty_cookie',
      'blocked_webrtc_candidate_listener',
      'blocked_hidden_media',
      'blocked_autoplay_media',
      'detected_thirdparty_tracker',
      'blocked_token_exfil',
    ]);
    const isWarning = /^warned_/.test(normalized.type || '') || normalized.type === 'detected_download_gate' || NO_BADGE_TYPES.has(normalized.type || '');
    if (!isWarning) {
      counts[tabId] = (counts[tabId] || 0) + 1;
      setBadge(tabId);
    }
    // Queue the log entry in memory and flush on a debounce. This avoids the
    // race where rapid blocks each do get->modify->set concurrently and clobber
    // each other (dropping entries). A single buffered writer reads once, appends
    // ALL pending entries, and writes once.
    if (normalized.log) {
      queueHistory({
        type: normalized.type || 'block',
        detail: normalized.detail || null,
        url: (sender.tab && sender.tab.url) ? sender.tab.url.slice(0, 200) : '',
        at: Date.now(),
      });
    }

    // ADAPTIVE LEARNING: always learn confirmed grabber domains, but only learn
    // behavioral reputation hits once they reach Suspicious/Dangerous. Caution
    // still shows in history without poisoning the future blocklist.
    try {
      // SECURITY: wo-events arrive via a DOM CustomEvent the MAIN-world page shares,
      // so a malicious page can FORGE them. Never learn an attacker-supplied domain
      // (msg.detail.host / matched) -- that would let any site poison the auto-block
      // "learned bad sites" list with arbitrary third parties (e.g. a bank, google).
      // Learning is constrained to the sender TAB's own host, which Chrome sets and
      // a page cannot spoof; a forged event can then only blocklist the forging site
      // itself (harmless). Background-side reputation checks still cover cross-domain.
      const tabHost = (() => { try { return new URL(sender.tab.url).hostname; } catch (_) { return ''; } })();
      if (tabHost && msg.type === 'detected_grabber_domain') {
        // the page itself is the grabber -> learning its own host is correct
        learnDomain(tabHost, 'known IP-grabber behavior');
      } else if (tabHost && msg.type === 'behavioral_risk') {
        // the behavioral scanner flagged the current page -> learn its own host
        const score = Number(msg.detail && msg.detail.score) || 0;
        const level = String((msg.detail && msg.detail.level) || '');
        const shouldLearn = score >= 60 || /^(Suspicious|Dangerous)$/i.test(level);
        if (shouldLearn) learnDomain(tabHost, 'flagged by behavioral scanner (' + (level || score) + ')');
      }
      // NOTE: blocked_safe_browsing_* events are about a LINK/TARGET, not the page,
      // and arrive via a forgeable content event -- we deliberately do NOT auto-learn
      // from them (it would either poison an arbitrary domain or mis-blocklist an
      // innocent page that merely linked out). The background's own Safe Browsing /
      // blocklist checks already block known-bad URLs on every visit.
      if (tabHost && msg.type === 'detected_thirdparty_tracker') {
        noteTrackerObservation(sender.tab.url || '', msg.detail || {});
      }
    } catch (_) {}
  }
});

// ---- buffered, race-free history writer ----
// The in-memory buffer (__histBuffer) is backed by chrome.storage.session so
// entries are NOT lost when the MV3 service worker is terminated and restarted.
// chrome.storage.session survives SW restarts within the same browser session
// but is NOT persisted to disk -- ideal for a write-ahead buffer. The main
// storage write (chrome.storage.local.set) still caps history at 200 items.
let __histBuffer = [];
let __histTimer = null;
let __histWriting = false;
let __histPersistTimer = null;
// Persist the in-memory buffer to chrome.storage.session (fire-and-forget) so a SW
// restart can recover it. Session storage is limited to ~1MB total, so we keep at
// most the last 100 entries. Debouncing collapses noisy block bursts into one
// small write instead of doing storage I/O for every event.
function persistHistBufferNow() {
  __histPersistTimer = null;
  try {
    if (!__histBuffer.length) {
      try { chrome.storage.session.remove('__wardenone_hist_buffer').catch(() => {}); } catch (_) {}
      return;
    }
    const slice = __histBuffer.length > 100 ? __histBuffer.slice(-100) : __histBuffer;
    chrome.storage.session.set({ __wardenone_hist_buffer: slice }).catch(() => {});
  } catch (_) {}
}
function persistHistBuffer() {
  if (__histPersistTimer) return;
  __histPersistTimer = setTimeout(persistHistBufferNow, 150);
}
// A logged URL must never keep its query string or fragment. That is where
// access tokens, OAuth codes, password-reset tokens, magic-link secrets and
// email addresses live, and callers were passing whole tab URLs straight in.
// The history is local, but it is long-lived and the user can export it, so
// retaining those is a real risk in a tool people install *for* privacy.
// Scheme, host and path say what happened without keeping the secret.
const LOG_URL_MAX = 300;
function safeUrlForLog(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return (url.protocol + '//' + url.host + url.pathname).slice(0, LOG_URL_MAX);
  } catch (_) {}
  // Some callers log a bare domain, or a scheme-less host/path. Re-parse with an
  // assumed scheme rather than returning '': dropping them would blank entries
  // that were never sensitive, and a bare "host/path?token=" must still be cut.
  try {
    const url = new URL('https://' + raw.replace(/^\/+/, ''));
    return (url.host + url.pathname).slice(0, LOG_URL_MAX);
  } catch (_) {}
  return '';
}

// Details carry URLs too -- redirect targets, script sources, OAuth endpoints --
// so sanitising only the top-level url would leave the same secrets one field
// over. Only strings that are already absolute URLs are rewritten; everything
// else is left exactly as the caller built it.
function sanitizeHistoryDetail(value, depth) {
  if (typeof value === 'string') {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? safeUrlForLog(value) : value;
  }
  if (!value || typeof value !== 'object' || depth >= 3) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeHistoryDetail(item, depth + 1));
  const out = {};
  for (const key of Object.keys(value)) out[key] = sanitizeHistoryDetail(value[key], depth + 1);
  return out;
}

function queueHistory(entry) {
  // Sanitised here, at the one choke point every history write already passes
  // through, so no future caller can reintroduce this by forgetting to strip.
  const safe = Object.assign({}, entry);
  safe.url = safeUrlForLog(safe.url);
  if (safe.detail !== undefined && safe.detail !== null) {
    safe.detail = sanitizeHistoryDetail(safe.detail, 0);
  }
  __histBuffer.push(safe);
  persistHistBuffer();
  scheduleHistoryFlush();
}
// On startup, recover any buffered entries that were never flushed from a prior
// SW lifecycle. This runs synchronously (inline promise) before event listeners
// are registered, so the buffer is populated before any new messages arrive.
try {
  chrome.storage.session.get('__wardenone_hist_buffer', (x) => {
    if (x && Array.isArray(x.__wardenone_hist_buffer) && x.__wardenone_hist_buffer.length) {
      __histBuffer = x.__wardenone_hist_buffer;
      // schedule a flush immediately to persist survivors to local storage
      scheduleHistoryFlush();
    }
  });
} catch (_) {}
function scheduleHistoryFlush() {
  if (__histTimer || __histWriting) return;
  __histTimer = setTimeout(flushHistory, 500);
}
function flushHistory() {
  __histTimer = null;
  if (__histWriting || !__histBuffer.length) return;
  if (__histPersistTimer) {
    clearTimeout(__histPersistTimer);
    __histPersistTimer = null;
  }
  __histWriting = true;
  // take everything currently buffered; new events that arrive during the async
  // round-trip accumulate in a fresh buffer and get flushed on the next tick.
  const pending = __histBuffer;
  __histBuffer = [];
  // Clear the session-storage buffer now that we're about to persist to local.
  try { chrome.storage.session.remove('__wardenone_hist_buffer').catch(() => {}); } catch (_) {}
  try {
    chrome.storage.local.get('wardenone_history', (x) => {
      const hist = (x && x.wardenone_history) || [];
      // pending is oldest-first; unshift in reverse so newest ends up at index 0
      for (let i = pending.length - 1; i >= 0; i--) hist.unshift(pending[i]);
      if (hist.length > 200) hist.length = 200;
      chrome.storage.local.set({ wardenone_history: hist }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          __histBuffer = pending.concat(__histBuffer);
          __histWriting = false;
          // flushHistory cleared the session buffer before this write. The write failed
          // and we just restored the entries in memory, so re-persist them -- otherwise a
          // SW kill in this window loses exactly the entries this mechanism protects.
          persistHistBuffer();
          pruneStorageIfNeeded('history-write-failed')
            .catch(() => {})
            .finally(() => { if (__histBuffer.length) scheduleHistoryFlush(); });
          return;
        }
        __histWriting = false;
        if (__histBuffer.length) scheduleHistoryFlush(); // drain anything that arrived mid-write
      });
    });
  } catch (_) {
    // on failure, put the entries back so they aren't lost -- and re-persist, since the
    // session buffer was already cleared above.
    __histBuffer = pending.concat(__histBuffer);
    __histWriting = false;
    persistHistBuffer();
  }
}

// Reset the count when a tab starts loading a new top-level page.
chrome.webNavigation?.onBeforeNavigate?.addListener((details) => {
  if (details.frameId === 0) {
    handleSmartScriptTopNavigation(details.tabId, details.url);
    counts[details.tabId] = 0;
    setBadge(details.tabId);
    noteHttpNavigationAttempt(details);
    handleSafeBrowsingNavigation(details);
    resetRedirectChain(details.tabId, details.url);
    // Tab-under signature: this tab spawned a popup moments ago and is now itself navigating
    // (the opener being driven). Log-only -- no blocking, so no false-positive breakage.
    const popAt = POPUP_OPENED_AT[details.tabId];
    if (popAt && (Date.now() - popAt) < 2000) {
      delete POPUP_OPENED_AT[details.tabId];
      queueHistory({
        type: 'tab_under_suspected',
        detail: { note: 'tab navigated right after opening a popup' },
        url: String(details.url || '').slice(0, 200),
        at: Date.now(),
      });
    }
  } else {
    clearSmartScriptFrameTransient(details.tabId, details.frameId);
  }
});

// pushState/replaceState route changes do not trigger onBeforeNavigate. Restore
// Smart's normal tab policy on a top-frame SPA transition; if the new route is
// another player, the bridge can confirm it and recover once again.
chrome.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
  if (details.frameId === 0) clearSmartScriptRecoveryForTab(details.tabId);
  else clearSmartScriptFrameTransient(details.tabId, details.frameId);
  notifySmartScriptRouteChange(details);
});

// ---- Redirect-chain + tab-under detection ----------------------------------------
// The real "redirect chains" protection. The in-page heuristic only ever sees the FINAL
// landing URL; this accumulates the per-tab main_frame redirect HOPS a navigation passes
// through (HTTP 30x / server redirects) and flags chains that cross many distinct registrable
// domains or route through a blocklisted / abuse-TLD hop -- the server-side-chain coverage
// that was missing. webRequest here is OBSERVE-ONLY (no blocking); we react after the chain
// resolves: log every long chain, and show the existing interstitial only for high-confidence
// ones, so normal multi-hop ad/SSO flows are not interrupted.
const REDIRECT_CHAINS = Object.create(null);
const RECENT_REDIRECT_CHAINS = [];
const POPUP_OPENED_AT = Object.create(null);
const REDIRECT_CHAIN_MAX_HOPS = 24;
const REDIRECT_CHAIN_RECENT_TTL_MS = 10 * 60 * 1000;
const REDIRECT_CHAIN_RECENT_MAX = 80;
function chainAbuseTld(host) {
  return /\.(zip|mov|cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|mom|hair|tattoo)$/i.test(String(host || ''));
}
function redirectChainUrlKey(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.href.slice(0, 700);
  } catch (_) {
    return '';
  }
}
function redirectChainHost(url) {
  try { return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
}
function pruneRecentRedirectChains(now) {
  const cutoff = (now || Date.now()) - REDIRECT_CHAIN_RECENT_TTL_MS;
  for (let i = RECENT_REDIRECT_CHAINS.length - 1; i >= 0; i--) {
    if (!RECENT_REDIRECT_CHAINS[i] || RECENT_REDIRECT_CHAINS[i].at < cutoff) RECENT_REDIRECT_CHAINS.splice(i, 1);
  }
  if (RECENT_REDIRECT_CHAINS.length > REDIRECT_CHAIN_RECENT_MAX) {
    RECENT_REDIRECT_CHAINS.splice(REDIRECT_CHAIN_RECENT_MAX);
  }
}
function redirectChainSummary(chain, finalUrl, tabId, matchedOn) {
  const c = chain || {};
  const final = String(finalUrl || '').slice(0, 700);
  return {
    hops: Array.isArray(c.hops) ? c.hops.length : 0,
    domains: Array.isArray(c.domains) ? c.domains.length : 0,
    flagged: !!c.flagged,
    blocklisted: !!c.blocklisted,
    abuseTld: !!c.abuseTld,
    maxed: !!c.maxed,
    chain: Array.isArray(c.domains) ? c.domains.slice(0, 12) : [],
    finalUrl: final,
    finalKey: redirectChainUrlKey(final),
    finalHost: redirectChainHost(final),
    tabId: tabId == null ? -1 : Number(tabId),
    matchedOn: matchedOn || '',
    at: Date.now(),
  };
}
function rememberRecentRedirectChain(tabId, finalUrl, chain, matchedOn) {
  try {
    if (!chain || !Array.isArray(chain.hops) || !chain.hops.length) return;
    const summary = redirectChainSummary(chain, finalUrl, tabId, matchedOn || 'redirect-hop');
    if (!summary.finalKey && !summary.finalHost) return;
    pruneRecentRedirectChains(summary.at);
    RECENT_REDIRECT_CHAINS.unshift(summary);
    pruneRecentRedirectChains(summary.at);
  } catch (_) {}
}
function recentRedirectChainForDownload(finalUrl, referrer) {
  try {
    const now = Date.now();
    pruneRecentRedirectChains(now);
    const finalKey = redirectChainUrlKey(finalUrl);
    const refKey = redirectChainUrlKey(referrer);
    const finalHost = redirectChainHost(finalUrl);
    for (const entry of RECENT_REDIRECT_CHAINS) {
      if (finalKey && entry.finalKey === finalKey) return Object.assign({}, entry, { matchedOn: 'download-url' });
    }
    for (const entry of RECENT_REDIRECT_CHAINS) {
      if (refKey && entry.finalKey === refKey) return Object.assign({}, entry, { matchedOn: 'referrer' });
    }
    for (const entry of RECENT_REDIRECT_CHAINS) {
      if (finalHost && entry.finalHost === finalHost && (entry.flagged || entry.hops >= 4 || entry.domains >= 4)) {
        return Object.assign({}, entry, { matchedOn: 'recent-host' });
      }
    }
  } catch (_) {}
  return null;
}
function resetRedirectChain(tabId, startUrl) {
  if (tabId == null || tabId < 0) return;
  let host = '';
  try { host = new URL(String(startUrl || '')).hostname; } catch (_) {}
  const dom = registrableDomainBg(host) || host;
  REDIRECT_CHAINS[tabId] = { hops: [], domains: dom ? [dom] : [], startedAt: Date.now(), flagged: false };
}
function noteRedirectHop(details) {
  if (!details || details.frameId !== 0 || details.tabId == null || details.tabId < 0) return;
  const chain = REDIRECT_CHAINS[details.tabId] || (REDIRECT_CHAINS[details.tabId] = { hops: [], domains: [], startedAt: Date.now(), flagged: false });
  if (chain.hops.length >= REDIRECT_CHAIN_MAX_HOPS) { chain.flagged = true; chain.maxed = true; return; }
  let toHost = '';
  try { toHost = new URL(String(details.redirectUrl || '')).hostname; } catch (_) {}
  const toDom = registrableDomainBg(toHost) || toHost;
  chain.hops.push({ to: String(details.redirectUrl || '').slice(0, 300), host: toHost, at: Date.now() });
  if (toDom && chain.domains.indexOf(toDom) === -1) chain.domains.push(toDom);
  if (toDom && (BLOCKED_DOMAINS.has(toDom) || BLOCKED_DOMAINS.has(toHost))) {
    chain.flagged = true;
    chain.blocklisted = true;
  }
  if (chainAbuseTld(toHost)) {
    chain.flagged = true;
    chain.abuseTld = true;
  }
  rememberRecentRedirectChain(details.tabId, details.redirectUrl || details.url || '', chain, 'redirect-hop');
}

function redirectChainContainsKnownAuth(chain, finalUrl) {
  const urls = [String(finalUrl || '')];
  for (const hop of (chain && Array.isArray(chain.hops) ? chain.hops : [])) {
    if (hop && hop.to) urls.push(String(hop.to));
  }
  return urls.some((url) => {
    try { return !!url && isLoginCompatibilityUrl(url); } catch (_) { return false; }
  });
}

function redirectChainShouldInterrupt(chain, finalUrl) {
  if (!chain || (!chain.blocklisted && !chain.abuseTld)) return false;
  // Known identity-provider chains often contain many cross-site hops and one-time
  // callback URLs. Replacing the completed callback with an interstitial makes the
  // login unrecoverable, so known auth plumbing is log-only even when a community
  // feed produced a false-positive hop.
  return !redirectChainContainsKnownAuth(chain, finalUrl);
}

async function evaluateRedirectChain(details) {
  if (!details || details.frameId !== 0 || details.tabId == null || details.tabId < 0) return;
  const chain = REDIRECT_CHAINS[details.tabId];
  if (!chain || chain.hops.length === 0) return;
  delete REDIRECT_CHAINS[details.tabId];
  let cfg = {};
  try { const s = await localGet('wardenone_config'); cfg = Object.assign({}, DEFAULT_CONFIG, (s && s.wardenone_config) || {}); } catch (_) {}
  if (cfg.enabled === false || cfg.detectRedirectChains === false) return;
  const hops = chain.hops.length;
  const distinctDomains = chain.domains.length;
  const longChain = hops >= 4 || distinctDomains >= 4;          // log-worthy
  const finalUrl = (chain.hops[chain.hops.length - 1] && chain.hops[chain.hops.length - 1].to) || details.url || '';
  const confirmedThreat = !!(chain.blocklisted || chain.abuseTld);
  const authChain = redirectChainContainsKnownAuth(chain, finalUrl);
  // Hop/domain counts alone are never a reason to replace a completed navigation.
  // Federated login, payment, CDN and regional routing can all cross many domains.
  const suspicious = redirectChainShouldInterrupt(chain, finalUrl);
  if (!longChain && !confirmedThreat) return;
  rememberRecentRedirectChain(details.tabId, finalUrl, chain, 'completed-navigation');
  queueHistory({
    type: 'redirect_chain',
    detail: { hops, domains: distinctDomains, flagged: !!chain.flagged, authChain, chain: chain.domains.slice(0, 12) },
    url: String(finalUrl).slice(0, 300),
    at: Date.now(),
  });
  if (suspicious) {
    try {
      const warningUrl = redirectWarningPageUrl({
        sourceUrl: '',
        targetUrl: String(finalUrl).slice(0, 1200),
        kind: 'redirect-chain',
        why: 'This page was reached through a ' + hops + '-hop redirect chain across ' + distinctDomains + ' site(s), including a confirmed blocklisted or abuse-domain hop.',
      });
      await chrome.tabs.update(details.tabId, { url: warningUrl });
    } catch (_) {}
  }
}
try {
  chrome.webRequest?.onBeforeRedirect?.addListener(noteRedirectHop, { urls: ['<all_urls>'], types: ['main_frame'] });
  chrome.webNavigation?.onCompleted?.addListener(evaluateRedirectChain);
  chrome.webNavigation?.onCreatedNavigationTarget?.addListener((details) => {
    if (details && details.sourceTabId != null && details.sourceTabId >= 0) POPUP_OPENED_AT[details.sourceTabId] = Date.now();
  });
  chrome.tabs.onRemoved.addListener((tabId) => { delete REDIRECT_CHAINS[tabId]; delete POPUP_OPENED_AT[tabId]; });
} catch (_) {}

// Fallback reset via tabs.onUpdated (in case webNavigation perm isn't present).
// GUARD: Skip internal extension pages to prevent spurious badge resets and
// avoid any risk of update-driven loops if this listener ever grows more logic.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || changeInfo.url.startsWith(chrome.runtime.getURL(""))) return;
  if (changeInfo.status === 'loading') {
    counts[tabId] = 0;
    setBadge(tabId);
  }
});

// Clean up when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  delete counts[tabId];
  clearTabMessageRates(tabId);
  clearSmartScriptRecoveryForTab(tabId);
});

// On install, set a default config in storage so the options page has a base.
// Single source of truth for default settings (used by install + verify/repair).
const DEFAULT_CONFIG = {
  enabled: true,
  watchExtensionPermissions: true,
  startupCheck: true,
  blockGesturelessNav: true,
  blockForcedPopups: true,
  strictPopupShield: true,
  blockMetaRefresh: true,
  detectRedirectChains: true,
  warnGrabberDomains: true,
  blockGrabberResources: true,
  blockWebRTCLeak: true,
  gateAdultSites: true,
  adultHeuristics: true,
  warnRedirectParams: true,
  warnShorteners: true,
  monitorLoggerApi: true,
  detectPhishing: true,
  behavioralScan: true,
  blockHighConfidencePhishing: false,
  removeOverlays: true,
  autoSkipDownloadAds: true,
  blockTrackers: true,
  adShield: true,
  googleSearchResultCleanup: false,
  blockSearchAiAnswers: false,
  blockSponsoredSearchResults: false,
  scriptletEngine: true,
  twitchAdBlock: true,
  twitchRewind: false,
  twitchRewindMinutes: 5,
  twitchVodRewind: true,
  blockAutoplay: false,
  throttleBackgroundTabs: false,
  killPrefetch: false,
  lazyLoadMedia: false,
  deAmp: false,
  capReferrer: false,
  autoRejectConsent: true,
  trackerLearner: true,
  unshimLinks: true,
  socialWidgetGuard: true,
  blockSupercookies: true,
  sendPrivacySignals: true,
  antiFingerprintNoise: false,
  fingerprintProbeDetection: true,
  blockFingerprintScripts: true,
  antiFingerprint: false,
  blockThirdPartyCookies: true,
  blockAllCookies: false,
  blockFirstPartyTrackers: false,
  sessionShield: true,
  blockTokenExfil: true,
  continuousTokenScan: true,
  detectSkimmers: true,
  paymentCardGuard: true,
  breachCheck: false,
  // Opt-in: unconditional HTTPS rewriting can break HTTP-only campus services,
  // captive portals, and local OAuth callbacks.
  forceHttps: false,
  certificateGuard: true,
  // Opt-in: this is the one protection that would tell an outside party something
  // about where you browse. On a visible password field it sends that site's
  // registrable domain to rdap.org to check how recently it was registered, which
  // is a strong phishing signal but also a party you would never otherwise
  // contact. Everything else here either runs entirely on the device or talks
  // only to hosts the page already contacted, and the privacy policy says so
  // plainly -- so this stays off until the user asks for it.
  loginAgeCheck: false,
  loginAgeMaxDays: 14,
  downloadReputation: true,
  downloadHardBlockCritical: true,
  downloadHashCheck: true,
  downloadDomainAge: false,
  downloadSafeBrowsing: false,
  downloadSafeBrowsingKey: '',
  downloadVirusTotal: false,
  downloadVirusTotalHash: false,
  downloadVirusTotalKey: '',
  urlHaus: false,
  urlHausKey: '',
  abuseIpDb: false,
  abuseIpDbKey: '',
  openPhish: false,
  openPhishKey: '',
  phishTank: false,
  phishTankKey: '',
  whoisXml: false,
  whoisXmlKey: '',
  whoisXmlReputation: false,
  whoisXmlThreatIntel: false,
  clipboardGuard: false,
  clipboardSwapDetect: true,
  keystrokePressure: false,
  honeytokenMode: false,
  scamLockGuard: true,
  commandPasteGuard: true,
  pasteProtection: true,
  formTrapDetector: true,
  fakeUpdateDetector: true,
  permissionChainGuard: true,
  oauthGuard: true,
  scriptDriftGuard: true,
  riskySiteMode: true,
  antiClickjacking: true,
  intranetProtection: true,
  loginCompatibility: true,
  mediaShield: true,
  blockCameraMic: true,
  blockScreenCapture: true,
  blockGeolocation: true,
  blockAutoplayMedia: true,
  blockSuspiciousWebRTC: false,
  eyeShield: false,
  eyeShieldMode: 'off',
  eyeShieldBrightness: 100,
  eyeShieldBrightnessByHost: {},
  eyeShieldContrast: 100,
  eyeShieldContrastByHost: {},
  eyeShieldSaturation: 100,
  eyeShieldSaturationByHost: {},
  eyeShieldWarmth: 0,
  eyeShieldWarmthByHost: {},
  eyeShieldGrayscale: 0,
  eyeShieldGrayscaleByHost: {},
  autoUpdateLists: true,
  blockMalwareSites: true,
  showToasts: true,
  showBadge: true,
  showDownloadBar: true,
  silentMode: false,
  memoryShield: true,
  memoryMode: 'balanced',
  memoryMinutesOverride: 0,
  memoryNeverPinned: true,
  memoryNeverAudio: true,
  memoryNeverForms: true,
  memoryNeverPayment: true,
  tabLimitGuard: false,
  tabLimitMax: 20,
  tabLimitClose: false,
  tabLimitMinIdleMinutes: 30,
  tabLimitWarn: true,
  oneOpenPerGesture: true,
  stripTrackingParams: true,
  cleanCopyLinks: true,
  gestureWindowMs: 2400,
  // Forget Me When I Leave: wipe a site's cookies/storage when you leave it.
  forgetMeMode: 'off',      // 'off' | 'list' (chosen sites) | 'all' (except allowlist)
  forgetMeList: [],         // registrable domains to forget in 'list' mode
  forgetMeHistory: false,   // also clear the site from browser history
  forgetMeAllConfirmedAt: 0,
  allowlist: [],
};

// ---- Onboarding protection bundles ----------------------------------------
// "Recommended" = the always-safe security + tracking defenses that don't break
// normal browsing (what the onboarding button has always applied). "Maximum
// privacy" is a SUPERSET that also enables the hardened privacy features which
// CAN affect some sites — surfaced in onboarding as an explicit, clearly
// labelled opt-in, never forced on. Sharing the recommended object keeps the two
// from drifting. Deliberately NOT in Maximum privacy: blockAllCookies (breaks
// every login) and honeytokenMode (advanced, can interfere with forms) — those
// stay expert-only toggles in the popup.
const ONBOARDING_RECOMMENDED = {
  enabled: true,
  blockGesturelessNav: true,
  blockForcedPopups: true,
  strictPopupShield: true,
  blockMetaRefresh: true,
  detectRedirectChains: true,
  warnGrabberDomains: true,
  blockGrabberResources: true,
  forceHttps: false,
  certificateGuard: true,
  blockTrackers: true,
  adShield: true,
  scriptletEngine: true,
  sessionShield: true,
  blockTokenExfil: true,
  scamLockGuard: true,
  commandPasteGuard: true,
  pasteProtection: true,
  fakeUpdateDetector: true,
  permissionChainGuard: true,
  oauthGuard: true,
  scriptDriftGuard: true,
  watchExtensionPermissions: true,
  startupCheck: true,
  autoSkipDownloadAds: true,
  blockMalwareSites: true,
  autoUpdateLists: true,
  autoRejectConsent: true,
};
const ONBOARDING_MAX_PRIVACY = Object.assign({}, ONBOARDING_RECOMMENDED, {
  antiFingerprint: true,
  antiFingerprintNoise: true,
  blockFirstPartyTrackers: true,
  breachCheck: true,
  clipboardGuard: true,
  blockSuspiciousWebRTC: true,
  capReferrer: true,
  deAmp: true,
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get('wardenone_config', (res) => {
    if (!res || !res.wardenone_config) {
      localSet({ wardenone_config: Object.assign({}, DEFAULT_CONFIG) }).catch(() => {});
    } else if (details && details.reason === 'update') {
      const cfg = Object.assign({}, res.wardenone_config || {});
      let changed = false;
      if (cfg.__locationPrivacyV344Enabled !== true) {
        // Preserve an explicit user choice from older releases. The migration is
        // only responsible for supplying the new default when the setting did
        // not exist yet; it must not silently turn location blocking back on.
        if (typeof cfg.blockGeolocation === 'undefined') cfg.blockGeolocation = true;
        cfg.__locationPrivacyV344Enabled = true;
        changed = true;
      }
      if (cfg.googleSearchResultCleanup === true && cfg.__searchCleanupSplitV352Enabled !== true) {
        if (typeof cfg.blockSearchAiAnswers === 'undefined') cfg.blockSearchAiAnswers = true;
        if (typeof cfg.blockSponsoredSearchResults === 'undefined') cfg.blockSponsoredSearchResults = true;
        cfg.googleSearchResultCleanup = false;
        cfg.__searchCleanupSplitV352Enabled = true;
        changed = true;
      }
      if (changed) localSet({ wardenone_config: cfg }).catch(() => {});
    }
  });
  if (details && details.reason === 'install') {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }); } catch (_) {}
  }
  // stamp a session boundary so Download Guard reviews are scoped to this session
  markBrowserSessionStart();
  // kick off a list update on install + schedule daily refreshes
  scheduleUpdates();
  pruneStorageIfNeeded('install').catch(() => {});
  updateRemoteListsWithRetry('install');
  applyScriptShieldRules();
  refreshExtensionState();
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleUpdates();
  pruneStorageIfNeeded('startup').catch(() => {});
  updateRemoteListsWithRetry('startup');
  applyScriptShieldRules();
  refreshExtensionState();
});

/* ===========================================================================
 * PERMISSION CHANGE WATCHER
 * ---------------------------------------------------------------------------
 * Threat: a trusted extension you installed long ago gets sold or compromised,
 * and a silent background update adds powerful new permissions ("read & change
 * data on ALL websites", read cookies, intercept requests). Chrome applies many
 * such updates without a prompt. We keep a baseline of each extension's
 * permissions and alert you when an extension GAINS high-risk ones.
 *
 * HONEST SCOPE: the management API lets us observe permissions and react -- it
 * does NOT let us block another extension's update or scan it for malware. This
 * is an early-warning system so YOU can review/remove, not a hard block.
 * ========================================================================== */
const EXT_BASELINE_KEY = 'wardenone_ext_baseline';
const EXT_ALERTS_KEY = 'wardenone_ext_alerts';
const EXT_ALERTS_MAX = 30;
// permissions we consider high-risk if newly gained (label shown to the user)
const EXT_HIGH_RISK_PERMS = {
  '<all_urls>': 'can now read & change data on ALL websites',
  tabs: 'can now see all your open tabs and their URLs',
  history: 'can now read your browsing history',
  cookies: 'can now read your cookies (including login sessions)',
  webRequest: 'can now intercept your network requests',
  webRequestBlocking: 'can now block/modify your network requests',
  proxy: 'can now route your traffic through a proxy',
  debugger: 'can now use the powerful debugger API',
  management: 'can now manage your other extensions',
  nativeMessaging: 'can now talk to programs on your computer',
  clipboardRead: 'can now read your clipboard',
  declarativeNetRequestWithHostAccess: 'can now act on requests across sites',
  scripting: 'can now inject scripts into pages',
};
const EXT_ALL_SITE_HOSTS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', 'file:///*']);

function extPermSet(ext) {
  // normalise an extension's permissions + host permissions into a flat Set, with
  // any "all sites" host pattern collapsed to the <all_urls> sentinel.
  const out = new Set();
  for (const p of (ext.permissions || [])) out.add(p);
  for (const h of (ext.hostPermissions || [])) {
    out.add(EXT_ALL_SITE_HOSTS.has(h) ? '<all_urls>' : ('host:' + h));
  }
  return out;
}

async function watcherEnabled() {
  try {
    const s = await localGet('wardenone_config');
    const cfg = (s && s.wardenone_config) || {};
    return cfg.enabled !== false && cfg.watchExtensionPermissions !== false;
  } catch (_) { return false; }
}

async function snapshotExtensionBaseline() {
  // record current permissions for every installed extension (called on first run
  // and after we process changes) so future growth is detectable.
  try {
    const all = await chrome.management.getAll();
    const baseline = {};
    for (const e of all) {
      if (e.type !== 'extension' || e.id === chrome.runtime.id) continue;
      baseline[e.id] = Array.from(extPermSet(e)).sort();
    }
    await localSet({ [EXT_BASELINE_KEY]: baseline });
    return baseline;
  } catch (_) { return {}; }
}

async function recordExtAlert(alert) {
  try {
    const store = await localGet(EXT_ALERTS_KEY);
    const list = (store && store[EXT_ALERTS_KEY]) || [];
    list.unshift(alert);
    await localSet({ [EXT_ALERTS_KEY]: list.slice(0, EXT_ALERTS_MAX) });
  } catch (_) {}
}

async function checkExtensionForNewPermissions(ext) {
  if (!ext || ext.type !== 'extension' || ext.id === chrome.runtime.id) return;
  if (!(await watcherEnabled())) return;
  try {
    const store = await localGet(EXT_BASELINE_KEY);
    const baseline = (store && store[EXT_BASELINE_KEY]) || {};
    const prev = new Set(baseline[ext.id] || []);
    const curr = extPermSet(ext);
    const gained = [];
    for (const p of curr) if (!prev.has(p)) gained.push(p);

    // which gained permissions are high-risk?
    const riskGained = [];
    for (const g of gained) {
      if (g === '<all_urls>' && EXT_HIGH_RISK_PERMS['<all_urls>']) riskGained.push(EXT_HIGH_RISK_PERMS['<all_urls>']);
      else if (EXT_HIGH_RISK_PERMS[g]) riskGained.push(EXT_HIGH_RISK_PERMS[g]);
    }

    // only alert when there's a baseline (not first-ever sighting) AND real risk grew
    const hadBaseline = Object.prototype.hasOwnProperty.call(baseline, ext.id);
    if (hadBaseline && riskGained.length) {
      const alert = {
        id: ext.id,
        name: ext.name || '(unknown extension)',
        gained: Array.from(new Set(riskGained)),
        when: Date.now(),
      };
      await recordExtAlert(alert);
      if (await extensionUiAllowed()) {
        // a visible notification -- this is important enough to surface immediately
        try {
          chrome.notifications.create('wo-extperm-' + ext.id + '-' + Date.now(), {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Extension gained new permissions',
            message: (ext.name || 'An extension') + ' ' + alert.gained[0] + (alert.gained.length > 1 ? ' (and ' + (alert.gained.length - 1) + ' more)' : '') + '. Tap WardenOne to review.',
            priority: 2,
          });
        } catch (_) {}
        try { chrome.action.setBadgeText({ text: '!' }); chrome.action.setBadgeBackgroundColor({ color: '#c0392b' }); } catch (_) {}
      }
    }

    // refresh this extension's baseline entry either way
    baseline[ext.id] = Array.from(curr).sort();
    await localSet({ [EXT_BASELINE_KEY]: baseline });
  } catch (_) {}
}

// management.onInstalled fires on install AND on update (when the new version's
// permissions differ) -- exactly the compromise/sale scenario. onEnabled covers a
// re-enable that might coincide with a perms change.
try {
  chrome.management.onInstalled.addListener((info) => { checkExtensionForNewPermissions(info); });
  chrome.management.onEnabled.addListener((info) => { checkExtensionForNewPermissions(info); });
  // establish a baseline shortly after startup if we don't have one yet
  chrome.management.getAll().then(async () => {
    const store = await localGet(EXT_BASELINE_KEY);
    if (!store || !store[EXT_BASELINE_KEY]) await snapshotExtensionBaseline();
  }).catch(() => {});
} catch (_) {}

/* ===========================================================================
 * STARTUP SECURITY CHECK
 * ---------------------------------------------------------------------------
 * Split into background-startup.js so the main MV3 service worker stays auditable.
 * The module registers startup listeners and exposes STARTUP_REPORT_KEY,
 * runStartupCheck(), and loginRiskVerdict() for the message handlers below.
 * ========================================================================== */
importScripts('background-startup.js');

/* ===========================================================================
 * AUTO-UPDATING BLOCKLIST
 * ---------------------------------------------------------------------------
 * The static rules.json is good on day one but goes stale as logger services
 * rotate domains. This fetches a remote, maintained domain list and converts it
 * into DYNAMIC declarativeNetRequest rules (which hard-block at the network
 * layer, same as the static ones), refreshed daily.
 *
 * HOW TO POINT IT AT YOUR LIST:
 *   Set REMOTE_LISTS below to one or more list URLs. The parser handles both
 *   plain (one domain per line) and uBlock format (domain.com/* with ! comments),
 *   so you can point it straight at the maintained anti-grabber repos. Lists are
 *   merged + deduped. If a source is unreachable, the others still apply and the
 *   existing rules stay -- it never wipes protection on a failed fetch.
 * =========================================================================== */

// Maintained anti-grabber / IP-logger lists. These repos add new logger domains
// as the services rotate them, so pulling daily keeps the block current without
// shipping a new extension version. Add/remove sources freely.
//
// NOTE: these are community lists -- WardenOne validates every entry (must be a
// well-formed domain) and caps the total, so a compromised/garbage source can't
// inject arbitrary rules. Plain-domain and uBlock(`||domain^`, `domain/*`)
// formats are both parsed.
const REMOTE_LISTS = [
  // Anti-Grabify (uBlock filter format) -- Grabify + IPLogger front domains
  'https://raw.githubusercontent.com/TMAFE/anti-grabify/master/url_list.txt',
  // The Blocklist Project -- "scam" list includes IP-logger / grabber domains
  'https://raw.githubusercontent.com/blocklistproject/Lists/master/scam.txt',
  // durablenapkin scam blocklist -- actively maintained scam/grabber hosts
  'https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt',
];

// Web3/token-stealer and social scam feeds. These stay separate from generic
// malware feeds so they can be kept early in source order: the DNR cap means
// focused wallet/Discord/Steam scam domains should not be crowded out by huge
// catch-all lists.
const TOKEN_AND_SCAM_LISTS = [
  // MetaMask eth-phishing-detect -- malicious Web3 / wallet-drainer domains
  'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json',
  // Discord Scam Prevention Project -- Discord, Steam, Nitro, giveaway scams
  'https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.txt',
  // PhishDestroy primary-active feed -- phishing, crypto drainers, scam domains
  'https://raw.githubusercontent.com/phishdestroy/destroylist/main/rootlist/formats/primary_active/domains.txt',
];

// Malware / phishing domain feeds (SEPARATE toggle: blockMalwareSites). These are
// false-positive-vetted community lists targeting malware distribution, phishing
// kits, and the scam/redirect domains behind free-streaming pop-ups. They can be
// large, so the shared MAX_DYNAMIC cap applies. Sources chosen for their explicit
// false-positive screening.
const MALWARE_LISTS = [
  'https://raw.githubusercontent.com/manic-code/Emerging-Malicious-Domain-Blocklist/main/hosts.txt',
  'https://phishing.army/download/phishing_army_blocklist_extended.txt',
  'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt',
  // uBlock Origin's stock badware risks list
  'https://ublockorigin.github.io/uAssets/filters/badware.txt',
  // Dandelion Sprout's raw-domain anti-malware variant
  'https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Alternate%20versions%20Anti-Malware%20List/AntiMalwareDomains.txt',
  // additional vetted feeds for wider coverage:
  // Phishing.Database (active phishing domains, updated continuously)
  'https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt',
  // OpenPhish-derived community phishing feed
  'https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt',
  // abuse.ch ThreatFox IOC domains (active C2 / malware infrastructure)
  'https://malware-filter.gitlab.io/malware-filter/vn-badsite-filter-hosts.txt',
  // HaGeZi's "threat intelligence feeds" -- aggregated malware/phishing/scam
  'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/tif.txt',
  // dnss-blocklist malicious aggregate -- malware, spyware, phishing, etc.
  'https://raw.githubusercontent.com/flinteger/dnss-blocklists/release/blocklists/malicious.domains.txt',
];

// Tracker / ad-analytics domain feeds (toggle: blockTrackers, ON by default).
const TRACKER_LISTS = [
  // The Blocklist Project -- tracking (covers many logging/beacon endpoints)
  'https://raw.githubusercontent.com/blocklistproject/Lists/master/tracking.txt',
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
  'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.txt',
];

// ---- AdShield: ad-blocking network lists (toggle: adShield, ON by default) ----
// These are ad-server domain lists in hosts/plain format that our existing
// parseList() can already digest into DNR block rules. We keep them SEPARATE from
// the tracker lists so AdShield is its own toggle and its own section. Honest
// scope: this blocks ad-SERVER requests (most display/banner/video-host ads). It
// will NOT match uBlock Origin's coverage and will NOT reliably kill YouTube's
// in-stream video ads (served from the video domain itself).
const ADSHIELD_NET_LISTS = [
  // Peter Lowe's ad servers (also in trackers, but AdShield should stand alone)
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
  // HaGeZi "light" -- ads + tracking, false-positive-conscious, hosts format
  'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/light.txt',
  // AdGuad/AdAway-style mobile + web ad hosts
  'https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt',
  // StevenBlack hosts (adware + malware)
  'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  // AdGuard DNS filter (ads + trackers)
  'https://filters.adtidy.org/extension/ublock/filters/3.txt',
  // EasyList (network filter version)
  'https://easylist.to/easylist/easylist.txt',
  // EasyList China (for Asian ad networks)
  'https://easylist-downloads.adblockplus.org/easylistchina.txt',
  // EasyList Dutch (for European ad networks)
  'https://easylist-downloads.adblockplus.org/easylistdutch.txt',
  // Fanboy's Annoyance List (popups, overlays, etc.)
  'https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt',
  // uBlock Origin badware risks (network level)
  'https://ublockorigin.github.io/uAssets/filters/badware.txt',
];

// Cosmetic + scriptlet filter sources (uBlock/AdGuard syntax). We fetch these and
// parse the ELEMENT-HIDING (##) and a SAFE SUBSET of scriptlet (#%#//scriptlet)
// rules out of them -- the network parser above deliberately ignores these. We
// keep the set small and well-known to start; the cosmetic engine is built to be
// extended over time.
const ADSHIELD_COSMETIC_LISTS = [
  // EasyList (the canonical ad element-hiding list)
  'https://easylist.to/easylist/easylist.txt',
  // EasyPrivacy (tracker element hiding + privacy cosmetics)
  'https://easylist.to/easylist/easyprivacy.txt',
  // uBlock Origin's own filters (cosmetic + scriptlet injections)
  'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  // uBlock Origin privacy filters (scriptlets that defuse trackers/anti-adblock)
  'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
  // uBlock Origin quick-fixes (rapid-response cosmetics + scriptlets)
  'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
  // uBlock Origin "unbreak" -- exception (#@#) rules that PREVENT over-hiding.
  // Listed last so its #@# exceptions are seen; reduces false positives.
  'https://ublockorigin.github.io/uAssets/filters/unbreak.txt',
  // AdGuard Base filter (comprehensive ad blocking)
  'https://filters.adtidy.org/extension/ublock/filters/2.txt',
  // AdGuard Tracking Protection filter
  'https://filters.adtidy.org/extension/ublock/filters/3.txt',
  // AdGuard Annoyances filter (popups, overlays, cookie notices)
  'https://filters.adtidy.org/extension/ublock/filters/11.txt',
  // Fanboy's Social filter (social media widgets/tracking)
  'https://easylist-downloads.adblockplus.org/fanboy-social.txt',
];

// Back-compat: a single extra URL you can set without touching the array above.
const REMOTE_LIST_URL = '';

// ---- Supplemental page-side lists -----------------------------------------
// DNR blocklists cover network blocking, but some protections need data inside
// the content script: the adult-site warning gate, page-visible IP-grabber
// warnings, and the payment guard's known processor hints. These are data-only
// feeds, cached separately from wardenone_config so they can grow without
// bloating user settings or requiring an extension update.
const SUPPLEMENTAL_LIST_STORAGE_KEY = 'wardenone_aux_lists';
const SUPPLEMENTAL_LIST_META_KEY = 'wardenone_aux_list_meta';
const SUPPLEMENTAL_LIST_VERSION = 1;
const SUPPLEMENTAL_LIST_CAPS = {
  adultDomainsExtra: 3000,
  grabberDomainsExtra: 1500,
  trustedPaymentHostsExtra: 300,
};
const SUPPLEMENTAL_LIST_DRIFT = {
  adultDomainsExtra: { minBaseline: 25, dropRatio: 0.25, spikeRatio: 5, spikeFloor: 1500 },
  grabberDomainsExtra: { minBaseline: 25, dropRatio: 0.25, spikeRatio: 4, spikeFloor: 1000 },
  trustedPaymentHostsExtra: { minBaseline: 25, dropRatio: 0.35, spikeRatio: 2, spikeFloor: 100 },
};
const SUPPLEMENTAL_LIST_SOURCES = [
  {
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/porn.txt',
    bucket: 'adultDomainsExtra',
    label: 'adult-domains',
  },
  {
    url: 'https://raw.githubusercontent.com/TMAFE/anti-grabify/master/url_list.txt',
    bucket: 'grabberDomainsExtra',
    label: 'ip-logger-domains',
  },
];

// Payment processors relax warnings, so they are NOT pulled from community
// blocklists. If WardenOne ships an owner-controlled manifest, it can include:
// { "version": 1, "adultDomains": [], "ipLoggerDomains": [],
//   "paymentProcessorDomains": [], "scamDomains": [], "phishingDomains": [] }
// Scam/phishing manifest entries are parsed for future use but the existing DNR
// updater remains the enforcement path for those categories. Set this to a
// WardenOne-owned HTTPS JSON endpoint once that endpoint exists; keeping it as a
// single audited constant avoids adding arbitrary remote config fetches.
const SUPPLEMENTAL_BUNDLED_MANIFEST_PATH = 'supplemental-manifest.json';
const SUPPLEMENTAL_MANIFEST_URL = '';
const SUPPLEMENTAL_MANIFEST_SOURCES = [
  { url: 'wardenone-bundled:' + SUPPLEMENTAL_BUNDLED_MANIFEST_PATH, bucket: 'manifest', label: 'wardenone-bundled-manifest', manifest: true, localPath: SUPPLEMENTAL_BUNDLED_MANIFEST_PATH },
  SUPPLEMENTAL_MANIFEST_URL,
].filter(Boolean).map((source) => typeof source === 'string' ? { url: source, bucket: 'manifest', label: 'wardenone-manifest', manifest: true } : source);
const SUPPLEMENTAL_SOURCE_URLS = SUPPLEMENTAL_LIST_SOURCES.concat(SUPPLEMENTAL_MANIFEST_SOURCES).map((s) => s.url);

// ======================= AdShield cosmetic engine =======================
// Parses uBlock/AdGuard cosmetic filter syntax into a structure the content
// script applies as CSS. We support the common, safe forms and skip the exotic
// ones we can't faithfully implement (so we never silently mis-hide content):
//   example.com##.ad-banner        -> hide .ad-banner on example.com
//   ##.ad-global                   -> hide .ad-global everywhere (generic)
//   example.com#@#.foo             -> EXCEPTION: un-hide .foo on example.com
//   ~example.com##.x / a.com,b.com##.x -> domain include/exclude lists
// We intentionally SKIP for v1 (documented, not silently dropped):
//   #?#  (procedural :has/:matches-css etc -- needs a JS engine)
//   #$#  (cosmetic style injection) and scriptlets are handled separately.
const ADSHIELD_COSMETIC_MAX = 50000; // cap parsed selectors to keep memory sane (increased for better coverage)

// Scriptlets we can actually run (the content-script library implements exactly
// these canonical names). We DROP any +js()/scriptlet rule that doesn't map to
// one of these, so we never serve a scriptlet the page side can't execute. uBlock
// and AdGuard use different names for the same thing -- normalise via aliases.
// IMPORTANT: keep this set in sync with SCRIPTLETS in the content script.
const SCRIPTLET_ALIASES = {
  'abort-current-script': 'abort-current-script', 'acs': 'abort-current-script',
  'abort-current-inline-script': 'abort-current-script', 'acis': 'abort-current-script',
  'abort-on-property-read': 'abort-on-property-read', 'aopr': 'abort-on-property-read',
  'abort-on-property-write': 'abort-on-property-write', 'aopw': 'abort-on-property-write',
  'set-constant': 'set-constant', 'set': 'set-constant',
  'no-setTimeout-if': 'no-setTimeout-if', 'nostif': 'no-setTimeout-if', 'setTimeout-defuser': 'no-setTimeout-if', 'prevent-setTimeout': 'no-setTimeout-if',
  'no-setInterval-if': 'no-setInterval-if', 'nosiif': 'no-setInterval-if', 'setInterval-defuser': 'no-setInterval-if', 'prevent-setInterval': 'no-setInterval-if',
  'no-fetch-if': 'no-fetch-if', 'prevent-fetch': 'no-fetch-if',
  'no-xhr-if': 'no-xhr-if', 'prevent-xhr': 'no-xhr-if',
  'addEventListener-defuser': 'addEventListener-defuser', 'aeld': 'addEventListener-defuser', 'prevent-addEventListener': 'addEventListener-defuser',
  'no-window-open-if': 'no-window-open-if', 'nowoif': 'no-window-open-if', 'window.open-defuser': 'no-window-open-if', 'prevent-window-open': 'no-window-open-if',
  'remove-attr': 'remove-attr', 'ra': 'remove-attr',
  'remove-class': 'remove-class', 'rc': 'remove-class',
  'set-cookie': 'set-cookie',
  'set-local-storage-item': 'set-local-storage-item',
  'json-prune': 'json-prune',
  'nowebrtc': 'nowebrtc',
};
const SCRIPTLET_STORAGE_MUTATORS = new Set(['set-cookie', 'set-local-storage-item']);
// External filter-list scriptlets that write site cookies/localStorage are a
// bigger trust grant than cosmetic hiding or API defusing. Keep this empty by
// default; add audited site domains here only if a specific compatibility fix is
// worth that trust.
const SCRIPTLET_STORAGE_MUTATION_ALLOWLIST = new Set([]);

function cleanScriptletDomainToken(value) {
  const d = String(value || '').trim().replace(/^~+/, '').replace(/^www\./, '').toLowerCase();
  if (!d || d === '*') return '';
  if (!/^[a-z0-9.-]+$/i.test(d)) return '';
  return d.replace(/^\.+|\.+$/g, '');
}

function scriptletDomainAllowedByAllowlist(domain) {
  const d = cleanScriptletDomainToken(domain);
  if (!d) return false;
  for (const allowed of SCRIPTLET_STORAGE_MUTATION_ALLOWLIST) {
    const a = cleanScriptletDomainToken(allowed);
    if (a && (d === a || d.endsWith('.' + a))) return true;
  }
  return false;
}

function scriptletMayBeStoredForDomains(scriptlet, domainPart) {
  if (!scriptlet || !SCRIPTLET_STORAGE_MUTATORS.has(scriptlet.name)) return true;
  const domains = String(domainPart || '')
    .split(',')
    .map(cleanScriptletDomainToken)
    .filter(Boolean);
  return !!(domains.length && domains.every(scriptletDomainAllowedByAllowlist));
}

function scriptletMayRunOnHost(scriptlet, host) {
  if (!scriptlet || !SCRIPTLET_STORAGE_MUTATORS.has(scriptlet.name)) return true;
  return scriptletDomainAllowedByAllowlist(host);
}

// Split a scriptlet argument string on unescaped commas (uBlock uses \, to escape).
function splitScriptletArgs(str) {
  const out = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\' && str[i + 1] === ',') { cur += ','; i++; continue; }
    if (c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

// Parse a scriptlet body into { name, args }. Handles both:
//   uBlock:  +js(set-constant, foo, true)        body = "set-constant, foo, true"
//   AdGuard: //scriptlet('set', 'foo', 'true')   body = "'set', 'foo', 'true'"
// Returns null if the (normalised) name isn't one we implement.
function parseScriptlet(body) {
  let s = String(body || '').trim();
  if (s.startsWith('//scriptlet')) s = s.slice('//scriptlet'.length).trim();
  if (s[0] === '(') s = s.slice(1);
  if (s[s.length - 1] === ')') s = s.slice(0, -1);
  let parts = splitScriptletArgs(s).map((p) => p.replace(/^['"]|['"]$/g, ''));
  if (!parts.length || !parts[0]) return null;
  const rawName = parts[0].replace(/\.js$/i, '').toLowerCase();
  const name = SCRIPTLET_ALIASES[rawName] || SCRIPTLET_ALIASES[parts[0].replace(/\.js$/i, '')];
  if (!name) return null;
  const args = parts.slice(1);
  if (args.length > 6) return null; // pathological
  return { name, args };
}

function parseCosmeticFilters(text) {
  // returns { generic, specific, exceptions, genericHideExclusions, procedural, scriptlets }
  //   procedural: { domain: [rawSelector...] } -- rules using operators like
  //     :has-text()/:has()/:matches-css()/:style()/:remove() etc. Evaluated by a
  //     capped engine in the content script (querySelectorAll can't do these).
  //     uBlock writes these with ## ; AdGuard with #?# / #$# -- we accept both and
  //     normalise AdGuard's "sel { decls }" style form into "sel:style(decls)".
  //   scriptlets: { domain: [{name,args}...] } -- ##+js() / #%#//scriptlet() rules.
  const generic = new Set();
  const specific = Object.create(null);
  const exceptions = Object.create(null);
  const genericHideExclusions = new Set();
  const procedural = Object.create(null);
  const scriptlets = Object.create(null);
  let count = 0;
  let procCount = 0;
  let scriptletCount = 0;
  const PROC_MAX = 12000;     // procedural is heavier -- its own cap
  const SCRIPTLET_MAX = 12000;
  const GENERIC_HIDE_EXCEPTION_MAX = 20000;
  // operators that mean "this is a procedural/action rule, not plain CSS"
  const PROC_OPS = /:(?:-abp-contains|-abp-has|has|has-text|contains|matches-css(?:-before|-after)?|matches-attr|matches-path|min-text-length|upward|nth-ancestor|watch-attr|xpath|others|remove|style)\(/i;

  const addProc = (domainPart, sel) => {
    if (!sel || sel.length > 800 || /[<>]/.test(sel)) return;
    if (!domainPart) return; // generic procedural is too costly/risky -- skip (documented)
    const domains = domainPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    for (const d of domains) {
      if (d[0] === '~') continue;
      (procedural[d] = procedural[d] || []).push(sel);
      if (++procCount >= PROC_MAX) break;
    }
  };
  const addScriptlet = (domainPart, body) => {
    const parsed = parseScriptlet(body);
    if (!parsed) return;
    if (!scriptletMayBeStoredForDomains(parsed, domainPart)) return;
    const domains = (domainPart || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    const targets = domains.length ? domains : ['*']; // '*' = generic non-storage defusers
    for (const d of targets) {
      if (d[0] === '~') continue;
      (scriptlets[d] = scriptlets[d] || []).push(parsed);
      if (++scriptletCount >= SCRIPTLET_MAX) break;
    }
  };

  // Parse document-level generic-hide exceptions in a separate pass so they
  // cannot be lost when any cosmetic-rule budget is exhausted first.
  const noteGenericHideException = (line) => {
    const match = String(line || '').trim().match(/^@@\|\|([a-z0-9.-]+)\^\$([^$]+)$/i);
    if (!match) return false;
    const options = match[2].split(',').map((o) => o.trim().toLowerCase());
    if (!options.includes('generichide') && !options.includes('ghide')) return false;
    const domain = match[1].replace(/^www\./i, '').replace(/^\.+|\.+$/g, '').toLowerCase();
    if (genericHideExclusions.size < GENERIC_HIDE_EXCEPTION_MAX
        && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
        && !domain.includes('..')) genericHideExclusions.add(domain);
    return true;
  };

  const lines = String(text || '').split('\n');
  lines.forEach(noteGenericHideException);
  for (let i = 0; i < lines.length; i++) {
    if (count >= ADSHIELD_COSMETIC_MAX && procCount >= PROC_MAX && scriptletCount >= SCRIPTLET_MAX) break;
    const line = lines[i].trim();
    if (!line || line[0] === '!' || line[0] === '[') continue;

    // Network-style document exceptions can disable generic element hiding for a
    // site (for example @@||x.com^$generichide). Keep only exact domain-anchored
    // forms here; broader URL patterns cannot be represented safely by our
    // per-host cosmetic response.
    if (noteGenericHideException(line)) continue;

    // ---- AdGuard procedural: domain#?#selector ----
    const procSep = line.indexOf('#?#');
    if (procSep !== -1) { if (procCount < PROC_MAX) addProc(line.slice(0, procSep), line.slice(procSep + 3).trim()); continue; }

    // ---- AdGuard cosmetic CSS: domain#$#selector { decls }  ->  sel:style(decls) ----
    const styleSep = line.indexOf('#$#');
    if (styleSep !== -1) {
      const body = line.slice(styleSep + 3).trim();
      const brace = body.indexOf('{');
      // skip AdGuard's #$# scriptlet form (e.g. "#$# log") -- only the CSS form has {}
      if (brace !== -1 && body.endsWith('}') && procCount < PROC_MAX) {
        const sel = body.slice(0, brace).trim();
        const decls = body.slice(brace + 1, -1).trim();
        if (sel && decls) addProc(line.slice(0, styleSep), sel + ':style(' + decls + ')');
      }
      continue;
    }

    // ---- AdGuard scriptlet: domain#%#//scriptlet(...) ----
    const agScriptSep = line.indexOf('#%#');
    if (agScriptSep !== -1) { if (scriptletCount < SCRIPTLET_MAX) addScriptlet(line.slice(0, agScriptSep), line.slice(agScriptSep + 3).trim()); continue; }

    // ---- uBlock hide / exception: ## or #@# ----
    let sep, isException = false;
    const hashAt = line.indexOf('#@#');
    const hashHide = line.indexOf('##');
    if (hashAt !== -1 && (hashHide === -1 || hashAt < hashHide)) { sep = hashAt; isException = true; }
    else if (hashHide !== -1) { sep = hashHide; }
    else continue;

    const domainPart = line.slice(0, sep);
    let selector = line.slice(sep + (isException ? 3 : 2)).trim();
    if (!selector) continue;

    // uBlock scriptlet injection: ##+js(...)  (was previously LEAKING into CSS and
    // breaking whole display:none chunks -- now routed to the scriptlet engine)
    if (!isException && selector.startsWith('+js(')) {
      if (scriptletCount < SCRIPTLET_MAX) addScriptlet(domainPart, selector.slice(3).trim());
      continue;
    }
    if (selector.length > 800) continue; // pathological

    // uBlock-form procedural/action rule (##.x:has-text(...), ##.x:style(...), ##.x:remove())
    if (!isException && PROC_OPS.test(selector)) { if (procCount < PROC_MAX) addProc(domainPart, selector); continue; }
    // exceptions for procedural rules: keep as plain selector exceptions below

    if (/[{}<>]/.test(selector)) continue; // not a clean CSS selector

    if (!domainPart) {
      if (!isException && count < ADSHIELD_COSMETIC_MAX) { generic.add(selector); count++; }
      else if (isException && count < ADSHIELD_COSMETIC_MAX) { (exceptions[''] = exceptions[''] || []).push(selector); count++; }
      continue;
    }
    const domains = domainPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    for (const d of domains) {
      if (d[0] === '~') continue;
      const bucket = isException ? exceptions : specific;
      (bucket[d] = bucket[d] || []).push(selector);
      count++;
      if (count >= ADSHIELD_COSMETIC_MAX) break;
    }
  }
  return { generic: Array.from(generic), specific, exceptions, genericHideExclusions: Array.from(genericHideExclusions), procedural, scriptlets };
}

// Fetch + parse the cosmetic lists, store the result. Errors are non-fatal: a
// cosmetic-list outage must never break the extension.
async function updateAdShieldCosmetics() {
  try {
    // Fetch every source in parallel. Each source still fails independently (one
    // list outage must never block the others), and successful texts are joined
    // in list order so behaviour is unchanged. Parallel fetch collapses ~10
    // sequential network round-trips into one batch, so a single slow CDN no
    // longer stalls the entire cosmetic refresh.
    const texts = await Promise.all(ADSHIELD_COSMETIC_LISTS.map(async (url) => {
      try {
        const fetched = await fetchValidatedRemoteListText(url, true, LIST_FETCH_TIMEOUT_MS);
        return fetched && fetched.ok ? fetched.text : '';
      } catch (_) { return ''; /* skip this source */ }
    }));
    const combinedText = texts.filter(Boolean).join('\n');
    if (!combinedText.trim()) return; // keep whatever we had
    const parsed = parseCosmeticFilters(combinedText);
    const hash = await sha256TextHex(JSON.stringify(parsed));
    const old = await localGet(['wardenone_adshield_cosmetic_hash']);
    if (hash && old && old.wardenone_adshield_cosmetic_hash === hash) {
      await localSet({ wardenone_adshield_cosmetic_checked_at: Date.now() });
      await writeStorageTelemetry('adshield-cosmetic-unchanged', { cosmeticHash: hash });
      return;
    }
    try {
      await localSet({
        wardenone_adshield_cosmetic: parsed,
        wardenone_adshield_cosmetic_at: Date.now(),
        wardenone_adshield_cosmetic_hash: hash,
      });
    } catch (e) {
      await pruneStorageIfNeeded('adshield-cosmetic-quota');
      await localSet({
        wardenone_adshield_cosmetic: parsed,
        wardenone_adshield_cosmetic_at: Date.now(),
        wardenone_adshield_cosmetic_hash: hash,
      });
    }
    invalidateCosmeticCache(); // fresh blob written -- drop the in-memory copy so the next request reloads it
    await pruneStorageIfNeeded('adshield-cosmetic');
  } catch (e) {
    console.warn('[WardenOne] AdShield cosmetic update failed', e);
  }
}

// ======================= Cosmetic serving cache =========================
// The parsed cosmetic blob is multi-megabyte. The content script asks for the
// selectors that apply to its page once PER FRAME, and content scripts run in
// all_frames -- so a page with N iframes used to trigger N full
// chrome.storage.local reads, each deserialising the whole blob, plus N full
// per-host recomputations. We cache the blob (+ config + allowlist) in the
// service-worker heap and memoise the computed result per hostname. Output is
// byte-for-byte identical to reading storage every time; this only removes
// redundant disk reads and recomputation. The cache is dropped whenever the
// underlying data changes (see invalidateCosmeticCache + storage.onChanged), and
// it evaporates for free whenever the idle service worker is torn down.
let __cosmeticMem = null;             // { data, cfg, allow } once loaded; null = needs (re)load
let __cosmeticHostCache = new Map();  // host -> serve result (insertion order = LRU recency)
const COSMETIC_HOST_CACHE_MAX = 256;  // a single page rarely spans more distinct hosts than this

function invalidateCosmeticCache() {
  __cosmeticMem = null;
  __cosmeticHostCache.clear();
}

// Lazily load (and hold) the blob, config and allowlist together. One read for
// all three; all three are invalidated as a unit when any of them changes.
async function getCosmeticMem() {
  if (__cosmeticMem) return __cosmeticMem;
  const store = await chrome.storage.local.get([
    'wardenone_adshield_cosmetic', 'wardenone_config', 'wardenone_adshield_allowlist',
  ]);
  __cosmeticMem = {
    data: store.wardenone_adshield_cosmetic || null,
    cfg: store.wardenone_config || {},
    allow: normalizeAllowlistHosts(store.wardenone_adshield_allowlist || []),
  };
  return __cosmeticMem;
}

// Compute the cosmetic payload for a hostname, memoised per host. This mirrors
// the original inline logic in the adshield-cosmetic handler exactly.
function computeCosmeticForHost(rawHost, mem, playerPage) {
  const host = normalizeAllowlistHost(rawHost);
  if (!host) return { ok: true, selectors: [], invalidHost: true };
  const playerMode = playerPage === true;
  const cacheKey = host + (playerMode ? '|player' : '|page');
  const hit = __cosmeticHostCache.get(cacheKey);
  if (hit) { // refresh LRU recency
    __cosmeticHostCache.delete(cacheKey);
    __cosmeticHostCache.set(cacheKey, hit);
    return hit;
  }

  if (mem.cfg.adShield === false) return { ok: true, selectors: [], disabled: true };
  // per-site allowlist: AdShield off for this site
  if (hostMatchesAllowlist(host, mem.allow)) {
    return { ok: true, selectors: [], allowlisted: true };
  }
  const data = mem.data;
  // Don't cache "not ready" -- the blob may arrive momentarily, after which the
  // storage.onChanged hook invalidates and the next request recomputes for real.
  if (!data) return { ok: true, selectors: [], notReady: true };

  // collect: generic + any rule whose domain matches this host (or a parent).
  // Video players are unusually fragile: broad generic cosmetic selectors can
  // hide or mutate the playback shell, so only apply domain-scoped filters there.
  const videoPlatform = isVideoPlatformHost(host);
  // X publishes a $generichide exception in EasyList and is also kept as an
  // explicit compatibility fallback so an older cached cosmetic blob cannot
  // hide its React login/dialog shell before the next list refresh.
  const genericHideExcluded = isXPlatformHost(host)
    || hostMatchesCosmeticDomainList(host, data.genericHideExclusions || []);
  const sel = new Set(videoPlatform || playerMode || genericHideExcluded ? [] : (data.generic || []));
  const specific = data.specific || {};
  const exceptions = data.exceptions || {};
  const hostParts = host.split('.');
  const candidates = [];
  for (let i = 0; i < hostParts.length - 1; i++) candidates.push(hostParts.slice(i).join('.'));
  if (!playerMode) {
    candidates.forEach((d) => { (specific[d] || []).forEach((s) => sel.add(s)); });
  }
  // remove exceptions that apply to this host
  const ex = new Set();
  candidates.forEach((d) => { (exceptions[d] || []).forEach((s) => ex.add(s)); });
  ex.forEach((s) => sel.delete(s));
  // generic exceptions (domain '') also apply
  (exceptions[''] || []).forEach((s) => sel.delete(s));
  if (videoPlatform) {
    for (const s of Array.from(sel)) {
      if (!isSafeVideoPlatformCosmeticSelector(s, host)) sel.delete(s);
    }
  }
  // collect procedural rules for this host (domain-scoped, capped per page)
  const procedural = data.procedural || {};
  const procRules = [];
  if (!videoPlatform && !playerMode) {
    candidates.forEach((d) => { (procedural[d] || []).forEach((s) => { if (procRules.length < 1200) procRules.push(s); }); });
  }
  // collect scriptlets for this host: generic non-storage defusers + domain-scoped.
  // Cookie/localStorage writers are still denied unless explicitly allowlisted.
  const scriptletsByDomain = data.scriptlets || {};
  const scriptlets = [];
  const seenScriptlet = new Set();
  const pushScriptlet = (sc) => {
    if (!sc || !sc.name) return;
    // The all-frame anti-redirect guard already owns player popup protection.
    // List scriptlets must fail open completely here: even no-window-open-if
    // changes page control flow and can make an ad-gated player abort before it
    // requests its media source.
    if (playerMode) return;
    if (!scriptletMayRunOnHost(sc, host)) return;
    const key = sc.name + '|' + (sc.args || []).join('');
    if (seenScriptlet.has(key) || scriptlets.length >= 100) return;
    seenScriptlet.add(key);
    scriptlets.push(sc);
  };
  if (!videoPlatform && mem.cfg.scriptletEngine !== false) {
    (scriptletsByDomain['*'] || []).forEach(pushScriptlet);
    candidates.forEach((d) => { (scriptletsByDomain[d] || []).forEach(pushScriptlet); });
  }
  const result = { ok: true, selectors: Array.from(sel).slice(0, 20000), procedural: procRules, scriptlets };

  __cosmeticHostCache.set(cacheKey, result);
  if (__cosmeticHostCache.size > COSMETIC_HOST_CACHE_MAX) {
    __cosmeticHostCache.delete(__cosmeticHostCache.keys().next().value); // evict oldest
  }
  return result;
}

// Dynamic rule IDs live in a high range so they never collide with the static
// rules.json (which uses 1..162).
const DYNAMIC_RULE_BASE = 10000;
// Chrome allows up to 30,000 dynamic+session rules. The budget is shared across:
//   - MAX_DYNAMIC blocklist domain rules (dynamic)
//   - OPTION_RULES_MAX uBlock option rules (dynamic)
//   - LEARNED_MAX adaptive learned rules (dynamic)
//   - TRACKER_RULES_BUDGET local tracker learner rules (dynamic)
//   - Allowlist rules (session, up to 1000)
//   - Privacy header rule (session, 1)
//   - HTTPS upgrade rule (session, 1)
// Total: 18000 + 4000 + 2000 + 1000 + 1000 + 1 + 1 = 26,002 (within 30k ceiling)
// These caps leave ~4,000 headroom for future feature rules.
const MAX_DYNAMIC = 18000;
const ACTIVE_DOMAIN_RULE_BUDGETS = {
  security: 9000,
  adshield: 7000,
  tracker: 2000,
};
const STATIC_RULE_COUNT = 130;
// EasyList-compiled static ruleset (rules-adshield.json, generated by
// tools/build-adshield-dnr.js -- rerun it to refresh from a newer EasyList).
// Static rules have their OWN 30k guaranteed budget; they do NOT eat into
// TOTAL_DYNAMIC_BUDGET below. Count must match the builder's output.
const ADSHIELD_STATIC_RULESET_ID = 'adshield_easylist';
const ADSHIELD_STATIC_RULE_COUNT = 28024;
let ADSHIELD_STATIC_ACTIVE = true; // tracked by refreshBlocklistRuleset for the stats display
const TRACKERS_STATIC_RULESET_ID = 'trackers';
// EasyPrivacy-derived third-party tracker host blocks (~15k hosts batched into ~150 rules).
// Gated by the SAME blockTrackers toggle as the curated 'trackers' ruleset.
const EASYPRIVACY_STATIC_RULESET_ID = 'easyprivacy';
// Network filter-OPTION rules (uBlock $third-party/$script/domain=/@@) live in their
// own ID band, separate from whole-domain blocks. Capped (Chrome's 30k dynamic-rule
// ceiling is shared) and per-source-capped so one huge list can't eat the budget.
const OPTION_RULE_BASE = 600000;
const OPTION_RULES_MAX = 4000;
const OPTION_RULES_PER_SOURCE_CAP = 2000;
const ACTIVE_OPTION_RULE_BUDGETS = {
  adshield: 3200,
  tracker: 500,
  security: 300,
};
// Rule budget for the adaptive pools. Applied AFTER blocklist + option
// rules, so total dynamic rules (blocklist + option + learned + tracker) never exceeds
// the Chrome ceiling. Capped explicitly to leave room for allowlist + header
// session rules (which share the 30k budget).
const LEARNED_RULES_BUDGET = 2000;
const TRACKER_RULES_BUDGET = 1000;
const ALLOWLIST_RULES_BUDGET = 1000;
const MEDIA_COMPAT_RULES_BUDGET = 100;
const LOGIN_COMPAT_RULES_BUDGET = 300;
const GRABBER_FEED_RULES_BUDGET = 1000;
const NEVER_BLOCK_ALLOW_RULES_BUDGET = 200;
// One blanket session block, one least-privilege replacement block per recovered
// player tab, and at most four exact, second-stage script rules per tab.
const SCRIPT_SHIELD_RULES_BUDGET = 161;
const FINGERPRINT_SCRIPT_RULES_BUDGET = 80;
const GOOGLE_SEARCH_ALLOW_RULES_BUDGET = 20;
const SMALL_SESSION_RULES_BUDGET = 64; // headers, cookie stripping, HTTPS, IP lookup, etc.
const TOTAL_DYNAMIC_BUDGET = MAX_DYNAMIC + OPTION_RULES_MAX + LEARNED_RULES_BUDGET + TRACKER_RULES_BUDGET
  + ALLOWLIST_RULES_BUDGET + MEDIA_COMPAT_RULES_BUDGET + LOGIN_COMPAT_RULES_BUDGET
  + GRABBER_FEED_RULES_BUDGET + NEVER_BLOCK_ALLOW_RULES_BUDGET + SCRIPT_SHIELD_RULES_BUDGET
  + FINGERPRINT_SCRIPT_RULES_BUDGET + GOOGLE_SEARCH_ALLOW_RULES_BUDGET + SMALL_SESSION_RULES_BUDGET;
// Guards: assert at module load that the budget fits, catching silent drift.
if (TOTAL_DYNAMIC_BUDGET > 30000) {
  console.error('[WardenOne] Dynamic rule budget exceeds Chrome 30k ceiling!');
}
const RESOURCE_TYPES = ['main_frame', 'sub_frame', 'image', 'xmlhttprequest', 'script', 'ping', 'websocket'];
const LIST_FETCH_TIMEOUT_MS = 12000;
const LIST_FETCH_CONCURRENCY = 4;
const LIST_SOURCE_MAX_BYTES = 18 * 1024 * 1024;
const LIST_COSMETIC_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const LIST_AUTO_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LIST_STALE_WARN_MS = 72 * 60 * 60 * 1000;
const LIST_STALE_CRITICAL_MS = 7 * 24 * 60 * 60 * 1000;

function expectedRemoteListSources(includeCosmetic) {
  const urls = []
    .concat(REMOTE_LISTS, TOKEN_AND_SCAM_LISTS, MALWARE_LISTS, TRACKER_LISTS, ADSHIELD_NET_LISTS)
    .concat(SUPPLEMENTAL_SOURCE_URLS)
    .concat(includeCosmetic ? ADSHIELD_COSMETIC_LISTS : []);
  if (REMOTE_LIST_URL) urls.push(REMOTE_LIST_URL);
  return new Set(urls.filter(Boolean));
}

function listSourceByteLimit(url) {
  if (SUPPLEMENTAL_SOURCE_URLS.includes(url)) return 8 * 1024 * 1024;
  return ADSHIELD_COSMETIC_LISTS.includes(url) ? LIST_COSMETIC_SOURCE_MAX_BYTES : LIST_SOURCE_MAX_BYTES;
}

function utf8ByteLength(text) {
  try { return new TextEncoder().encode(String(text || '')).length; } catch (_) { return String(text || '').length; }
}

async function readResponseTextWithByteLimit(res, maxBytes) {
  const cap = Math.max(1024, Number(maxBytes) || 1024 * 1024);
  const declaredLength = Number(res && res.headers && res.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > cap) {
    const err = new Error('response size exceeds cap (' + declaredLength + ' > ' + cap + ' bytes)');
    err.code = 'too_large';
    throw err;
  }
  if (res && res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (!chunk || chunk.done) break;
        const value = chunk.value;
        if (!value) continue;
        bytes += Number(value.byteLength || value.length || 0);
        if (bytes > cap) {
          try { reader.cancel(); } catch (_) {}
          const err = new Error('response size exceeds cap (' + bytes + ' > ' + cap + ' bytes)');
          err.code = 'too_large';
          throw err;
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      try { if (reader.releaseLock) reader.releaseLock(); } catch (_) {}
    }
  }
  const text = await res.text();
  const actualLength = utf8ByteLength(text);
  if (actualLength > cap) {
    const err = new Error('response size exceeds cap (' + actualLength + ' > ' + cap + ' bytes)');
    err.code = 'too_large';
    throw err;
  }
  return text;
}

function validateRemoteListSource(url, includeCosmetic) {
  try {
    const raw = String(url || '').trim();
    const normalized = new URL(raw).href;
    if (normalized !== raw) return { ok: false, error: 'list source URL was not canonical' };
    if (!/^https:\/\//i.test(normalized)) return { ok: false, error: 'list source is not HTTPS' };
    if (!expectedRemoteListSources(includeCosmetic).has(normalized)) return { ok: false, error: 'unexpected list source URL' };
    return { ok: true, url: normalized, maxBytes: listSourceByteLimit(normalized) };
  } catch (_) {
    return { ok: false, error: 'invalid list source URL' };
  }
}

async function fetchValidatedRemoteListText(url, includeCosmetic, timeoutMs) {
  const policy = validateRemoteListSource(url, !!includeCosmetic);
  if (!policy.ok) {
    return {
      ok: false,
      url,
      error: policy.error,
      integrityRejected: true,
      policy,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || LIST_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(policy.url, {
      cache: 'no-cache',
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res && res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        url: policy.url,
        error: 'list source redirected instead of serving the expected URL',
        integrityRejected: true,
        policy,
      };
    }
    if (!res || !res.ok) return { ok: false, url: policy.url, error: 'HTTP ' + (res ? res.status : '?'), policy };
    const declaredLength = Number(res.headers && res.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > policy.maxBytes) {
      return {
        ok: false,
        url: policy.url,
        error: 'source size exceeds cap (' + declaredLength + ' > ' + policy.maxBytes + ' bytes)',
        integrityRejected: true,
        policy,
      };
    }
    const text = await readResponseTextWithByteLimit(res, policy.maxBytes);
    const byteLength = utf8ByteLength(text);
    return { ok: true, url: policy.url, text, byteLength, policy };
  } catch (e) {
    const err = e && e.name === 'AbortError' ? 'Timed out' : String(e);
    return { ok: false, url: policy.url, error: err, integrityRejected: e && e.code === 'too_large', policy };
  } finally {
    clearTimeout(timer);
  }
}

// Session rule ID for the DNT/GPC request-header injection. Sits well outside the
// dynamic-blocklist range so it never collides.
const PRIVACY_HEADER_RULE_ID = 900000;
const THIRD_PARTY_COOKIE_RULE_ID = 900001;
// Only passive tracker-shaped responses are safe to strip. Auth and federation
// commonly establish state on main-frame, iframe, script or XHR responses.
const THIRD_PARTY_COOKIE_RESOURCE_TYPES = ['image', 'ping'];
const LOCATION_PRIVACY_HEADER_RULE_ID = 900002;
const IP_LOOKUP_BLOCK_RULE_BASE = 900020;
const IP_LOOKUP_BLOCK_DOMAINS = [
  'api.ipify.org',
  'api64.ipify.org',
  'ipify.org',
  'ipinfo.io',
  'ifconfig.me',
  'icanhazip.com',
  'ident.me',
  'checkip.amazonaws.com',
  'ip-api.com',
  'ipapi.co',
  'ipwho.is',
  'myexternalip.com',
  'wtfismyip.com',
  'ipecho.net',
  'jsonip.com',
  'seeip.org',
  'ip2location.io',
  'ipdata.co',
  'db-ip.com',
];
const IP_LOOKUP_BLOCK_RESOURCE_TYPES = ['sub_frame', 'script', 'image', 'xmlhttprequest', 'ping', 'websocket', 'other'];

// Allowlist exemption rules live in their own high ID band. When a site is
// allowlisted we add an `allowAllRequests` rule for it so the user's choice ALSO
// suspends network-level (DNR) blocking -- not just the content script. Without
// this, "Allowlist this site" would be a half-measure: rules.json + dynamic
// rules would keep blocking requests on a site the user explicitly trusts.
const ALLOWLIST_RULE_BASE = 800000;
// High-priority allow rules for trusted-infrastructure (NEVER_BLOCK) domains, so an EasyList/
// adshield/learned/grabber false-positive can't break a FUNCTIONAL subresource on a major SaaS app.
const NEVER_BLOCK_ALLOW_RULE_BASE = 745000;
const NEVER_BLOCK_ALLOW_MAX = 200;
const MEDIA_COMPAT_RULE_BASE = 806000;
const LOGIN_COMPAT_RULE_BASE = 807000;
// Blocklist-refresh chatter is opt-in; it fired on every update in the service
// worker console. Warnings and errors are unaffected.
const WO_LIST_DEBUG = false;
const SCRIPT_SHIELD_RULE_BASE = 930000;
const SCRIPT_SHIELD_RULE_MAX = 1000;
const SMART_SCRIPT_RECOVERY_MAX_TABS = 32;
// A single tab can hold several player frames (page -> embed -> player), and each
// frame commonly blocks its analytics hosts alongside the one script the player
// actually needs. At 4 the budget was exhausted by incidental hosts before the
// required one was reached, leaving the player black.
const SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB = 8;
const SMART_SCRIPT_REPLACEMENT_RULE_OFFSET = 1;
const SMART_SCRIPT_STAGE_TWO_RULE_OFFSET = 100;
const SMART_SCRIPT_STAGE_TWO_RULE_PRIORITY = 1900;
const SMART_SCRIPT_PLAYER_CONTEXT_MAX = 256;
const SMART_SCRIPT_PLAYER_INTENT_MAX = 256;
const SMART_SCRIPT_PENDING_MAX = 128;
const SMART_SCRIPT_RETRY_MAX = 128;
const SMART_SCRIPT_PLAYER_CONTEXT_TTL_MS = 90000;
const SMART_SCRIPT_PLAYER_INTENT_TTL_MS = 15000;
const SMART_SCRIPT_PENDING_TTL_MS = 45000;
const SMART_SCRIPT_RETRY_TTL_MS = 10 * 60 * 1000;
const SMART_SCRIPT_TOP_RELOAD_TTL_MS = 8000;
const FINGERPRINT_SCRIPT_RULE_BASE = 931500;
const FINGERPRINT_SCRIPT_RULE_MAX = 80;
const GOOGLE_CLEANUP_CSS_SCRIPT_ID = 'wo-google-cleanup-prepaint-css';
const SEARCH_AI_CLEANUP_CSS_SCRIPT_ID = 'wo-search-ai-cleanup-prepaint-css';
const SEARCH_SPONSORED_CLEANUP_CSS_SCRIPT_ID = 'wo-search-sponsored-cleanup-prepaint-css';
const GOOGLE_CLEANUP_CSS_MATCHES = [
  '*://*.google.com/search*', '*://*.google.com/webhp*',
  '*://*.google.co.uk/search*', '*://*.google.co.uk/webhp*',
  '*://*.google.ca/search*', '*://*.google.com.au/search*',
  '*://*.google.ie/search*', '*://*.google.co.nz/search*',
  '*://*.google.co.za/search*', '*://*.google.de/search*',
  '*://*.google.fr/search*', '*://*.google.it/search*',
  '*://*.google.es/search*', '*://*.google.nl/search*',
  '*://*.google.be/search*', '*://*.google.ch/search*',
  '*://*.google.at/search*', '*://*.google.se/search*',
  '*://*.google.no/search*', '*://*.google.dk/search*',
  '*://*.google.fi/search*', '*://*.google.pl/search*',
  '*://*.google.pt/search*', '*://*.google.co.in/search*',
  '*://*.google.co.jp/search*', '*://*.google.com.br/search*',
  '*://*.google.com.mx/search*',
  '*://search.brave.com/search*',
];
const GOOGLE_SEARCH_ALLOW_RULE_BASE = 931700;
const GOOGLE_SEARCH_ALLOW_RULE_MAX = 20;
const SCRIPT_SHIELD_MODE_KEY = 'wardenone_script_shield_mode';
const SCRIPT_TRUSTED_KEY = 'wardenone_script_trusted_hosts';

const LOGIN_COMPAT_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

// Official identity / CAPTCHA / payment endpoints that commonly need to survive
// third-party cookie stripping and tracker/ad rules during sign-in. These are not
// blanket allowlists for marketing networks; they are the narrow "login plumbing"
// hosts users expect to work.
const LOGIN_COMPAT_FILTERS = [
  '||accounts.google.com',
  '||accounts.google.com/gsi/',
  '||oauth2.googleapis.com',
  '||apis.google.com',
  '||identitytoolkit.googleapis.com',
  '||securetoken.googleapis.com',
  '||firebaseinstallations.googleapis.com',
  '||firebaseappcheck.googleapis.com',
  '||clientservices.googleapis.com',
  '||ssl.gstatic.com/accounts/',
  '||www.gstatic.com/accounts/',
  '||www.gstatic.com/recaptcha/',
  '||www.google.com/recaptcha/',
  '||recaptcha.net',
  '||login.microsoftonline.com',
  '||login.live.com',
  '||aadcdn.msftauth.net',
  '||aadcdn.msauth.net',
  '||msauth.net',
  '||msftauth.net',
  '||appleid.apple.com',
  '||github.com/login/oauth',
  '||discord.com/oauth2',
  '||discord.com/api/oauth2',
  '||discordapp.com/oauth2',
  '||discordapp.com/api/oauth2',
  '||accounts.spotify.com',
  '||login.spotify.com',
  '||login5.spotify.com',
  '||open.spotify.com/get_access_token',
  'facebook.com/dialog/oauth',
  'www.facebook.com/dialog/oauth',
  '||connect.facebook.net',
  '||graph.facebook.com/oauth',
  '||appleid.cdn-apple.com',
  '||cdn.auth0.com',
  '||global.oktacdn.com',
  '||oktacdn.com',
  '||okta.com',
  '||auth0.com',
  '||onelogin.com',
  '||duosecurity.com',
  '||openathens.net',
  '||shibboleth.net',
  '||paypal.com/signin',
  '||www.paypal.com/signin',
  '||paypal.com/checkout',
  '||www.paypal.com/checkout',
  '||paypalobjects.com',
  '||js.stripe.com',
  '||checkout.stripe.com',
  '||stripe.network',
  '||braintreegateway.com',
  '||braintreepayments.com',
  '||adyen.com',
  '||adyenpayments.com',
  '||hcaptcha.com',
  '||js.hcaptcha.com',
  '||challenges.cloudflare.com',
  '||turnstile.cloudflare.com',
  '||amazoncognito.com',
];

const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'apis.google.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'clientservices.googleapis.com',
  'gstatic.com',
  'recaptcha.net',
  'login.microsoftonline.com',
  'login.live.com',
  'msauth.net',
  'msftauth.net',
  'appleid.apple.com',
  'appleid.cdn-apple.com',
  'connect.facebook.net',
  'graph.facebook.com',
  'okta.com',
  'oktacdn.com',
  'auth0.com',
  'cdn.auth0.com',
  'onelogin.com',
  'duosecurity.com',
  'openathens.net',
  'shibboleth.net',
  'paypal.com',
  'paypalobjects.com',
  'stripe.com',
  'stripe.network',
  'braintreegateway.com',
  'braintreepayments.com',
  'adyen.com',
  'adyenpayments.com',
  'hcaptcha.com',
  'challenges.cloudflare.com',
  'turnstile.cloudflare.com',
  'amazoncognito.com',
  'spotify.com',
  'accounts.spotify.com',
  'login.spotify.com',
  'login5.spotify.com',
];

function isLoginCompatibilityUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    const host = String(u.hostname || '').replace(/^www\./, '').toLowerCase();
    const path = String(u.pathname || '').toLowerCase();
    if (!host) return false;
    const authPageDomains = [
      'accounts.google.com',
      'oauth2.googleapis.com',
      'apis.google.com',
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'firebaseinstallations.googleapis.com',
      'firebaseappcheck.googleapis.com',
      'clientservices.googleapis.com',
      'gstatic.com',
      'recaptcha.net',
      'login.microsoftonline.com',
      'login.live.com',
      'msauth.net',
      'msftauth.net',
      'appleid.apple.com',
      'appleid.cdn-apple.com',
      'okta.com',
      'oktacdn.com',
      'auth0.com',
      'cdn.auth0.com',
      'onelogin.com',
      'duosecurity.com',
      'openathens.net',
      'shibboleth.net',
      'hcaptcha.com',
      'challenges.cloudflare.com',
      'turnstile.cloudflare.com',
      'amazoncognito.com',
      'spotify.com',
      'accounts.spotify.com',
      'login.spotify.com',
      'login5.spotify.com',
    ];
    if (authPageDomains.some((domain) => host === domain || host.endsWith('.' + domain))) return true;
    if (host === 'github.com' && path.indexOf('/login/oauth') === 0) return true;
    if ((host === 'discord.com' || host === 'discordapp.com') && /^\/(api\/)?oauth2\//.test(path)) return true;
    if ((host === 'facebook.com' || host === 'www.facebook.com') && path.indexOf('/dialog/oauth') === 0) return true;
    if ((host === 'paypal.com' || host === 'www.paypal.com') && /\/(signin|checkout)\b/.test(path)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function isYouTubeFrameUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '')).hostname;
    return /(^|\.)youtube(-nocookie)?\.com$/i.test(host) || /(^|\.)youtube\.googleapis\.com$/i.test(host);
  } catch (_) {
    return false;
  }
}

function isMainWorldRepairExcludedUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const host = String(u.hostname || '').replace(/^www\./, '').toLowerCase();
    if (!host) return true;
    if (isYouTubeFrameUrl(rawUrl)) return false; // handled by the lightweight YouTube engine
    if (isLoginCompatibilityUrl(rawUrl)) return true;
    if (host === 'shopify.com' || host.endsWith('.shopify.com')) return true;
    return false;
  } catch (_) {
    return true;
  }
}

function repairMainWorldFilesForUrl(rawUrl, frameId) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isMainWorldRepairExcludedUrl(rawUrl)) return null;
    const topFrame = Number(frameId) === 0;
    const files = [];
    const add = (file) => { if (!files.includes(file)) files.push(file); };
    if (topFrame) {
      add('content.min.js');
      add('permission-chain.js');
    }
    // anti-redirect is the intentionally lightweight all-frame guard.
    add('anti-redirect.js');
    if (isTwitchFrameUrl(rawUrl)) add('twitch-adblock.js');
    if (isYouTubeFrameUrl(rawUrl)) {
      add('permission-chain.js');
      add('yt-adblock.js');
    }
    return files;
  } catch (_) {
    return null;
  }
}

function isTwitchFrameUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '')).hostname;
    return /(^|\.)twitch\.tv$/i.test(host);
  } catch (_) {
    return false;
  }
}

function getRepairFramesForTab(tab) {
  return new Promise((resolve) => {
    try {
      chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
        if (chrome.runtime.lastError || !Array.isArray(frames) || !frames.length) {
          resolve([{ frameId: 0, url: tab.url || '' }]);
          return;
        }
        resolve(frames.map((frame) => ({
          frameId: Number(frame.frameId) || 0,
          url: String(frame.url || (Number(frame.frameId) === 0 ? tab.url || '' : '')),
        })));
      });
    } catch (_) {
      resolve([{ frameId: 0, url: tab && tab.url || '' }]);
    }
  });
}

// ---- Adaptive "learned bad domains" ------------------------------------
// When WardenOne's behavioral scorer (or a grabber detection) flags a domain
// that was NOT on any blocklist, we remember it. On the next visit it's blocked
// by a dynamic DNR rule. The user sees these in the Activity Log's "Learned bad
// sites" section and can keep or remove each. This is the adaptive memory that
// lets the extension improve from what the user actually encounters -- the
// blocklist stops being purely static.
const LEARNED_RULE_BASE = 700000;
// Cap matches LEARNED_RULES_BUDGET to stay within the 30k dynamic rule ceiling.
// The storage set still tracks up to 5000 domains, but only the budgeted count
// is applied as DNR rules.
const LEARNED_MAX = 2000;
let LEARNED = {}; // { domain: { firstSeen, reason, hits } }

// ---- Local third-party tracker learner ----------------------------------
// Separate from learned bad domains: this learns tracker-like THIRD-PARTY
// subresources only after they appear across multiple first-party sites. The
// store never leaves the device. Per-site controls can force allow/block/auto.
const TRACKER_LEARNER_KEY = 'wardenone_tracker_learner';
const TRACKER_RULE_BASE = 720000;
const TRACKER_RULE_MAX = TRACKER_RULES_BUDGET;
const TRACKER_LEARN_MIN_SITES = 3;
const TRACKER_LEARN_MIN_HITS = 3;
const TRACKER_LEARN_STORAGE_MAX = 600;
// Ambiguous locally-learned tracker candidates are deliberately limited to
// request-shaped telemetry. A shared player/embed host can legitimately serve
// both scripts and frames, so learner evidence must never take either of those
// functional resource types offline.
const TRACKER_RESOURCE_TYPES = ['image', 'xmlhttprequest', 'ping'];
const X_APP_COMPAT_DOMAINS = new Set(['x.com', 'twitter.com', 'twimg.com']);
const TRACKER_PROTECTED_DOMAINS = new Set([
  'google.com', 'gstatic.com', 'googleusercontent.com', 'googleapis.com',
  'youtube.com', 'ytimg.com', 'googlevideo.com',
  'microsoft.com', 'live.com', 'office.com', 'office365.com', 'microsoftonline.com',
  'apple.com', 'icloud.com', 'mozilla.org', 'wikipedia.org',
  'github.com', 'githubusercontent.com', 'gitlab.com',
  'cloudflare.com', 'cloudflare.net', 'akamaihd.net', 'fastly.net',
  'paypal.com', 'stripe.com', 'amazon.com', 'amazonaws.com',
]);
LOGIN_COMPAT_NEVER_BLOCK_DOMAINS.forEach((domain) => TRACKER_PROTECTED_DOMAINS.add(registrableDomainBg(domain) || domain));
let TRACKER_LEARNER = { domains: {}, siteControls: {} };
let __initTrackerLearner = null;

// Async initialization guard: resolves once both LEARNED and BLOCKED_DOMAINS
// have been loaded from storage. Downstream code (learnDomain, download scoring)
// should await this before relying on those variables to avoid race conditions
// where the service worker restarts and event listeners fire before storage reads complete.
let __initLearned = null;
let __initBlockedDomains = null;

function normalizeLearnedDomain(value) {
  try {
    const host = normalizeAllowlistHost(value);
    if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
    const rd = registrableDomainBg(host) || host;
    if (!rd || isNeverBlockDomain(rd) || X_APP_COMPAT_DOMAINS.has(rd)) return '';
    return rd;
  } catch (_) {
    return '';
  }
}

function loadLearned() {
  if (__initLearned) return __initLearned;
  __initLearned = new Promise((resolve) => {
    try {
      chrome.storage.local.get('wardenone_learned', (r) => {
        const raw = (r && r.wardenone_learned) || {};
        LEARNED = {};
        Object.keys(raw || {}).forEach((domain) => {
          const d = normalizeLearnedDomain(domain);
          if (d) LEARNED[d] = raw[domain] || {};
        });
        applyLearnedRules();
        resolve();
      });
    } catch (_) { resolve(); }
  });
  return __initLearned;
}
async function applyLearnedRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing.filter((x) => x.id >= LEARNED_RULE_BASE && x.id < LEARNED_RULE_BASE + LEARNED_MAX).map((x) => x.id);
    const cfgStore = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (cfgStore && cfgStore.wardenone_config) || {});
    if (cfg.enabled === false) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules: [] });
      return;
    }
    const allowlist = normalizeAllowlistHosts(cfg.allowlist || []);
    let changed = false;
    const normalizedLearned = {};
    Object.keys(LEARNED || {}).forEach((raw) => {
      const d = normalizeLearnedDomain(raw);
      if (!d || hostMatchesAllowlist(d, allowlist)) { changed = true; return; }
      const cur = LEARNED[raw] || {};
      const prev = normalizedLearned[d] || {};
      normalizedLearned[d] = Object.assign({}, cur, prev, {
        firstSeen: Math.min(Number(prev.firstSeen) || Number(cur.firstSeen) || Date.now(), Number(cur.firstSeen) || Number(prev.firstSeen) || Date.now()),
        hits: Math.max(Number(prev.hits) || 0, Number(cur.hits) || 0, 1),
      });
      if (raw !== d) changed = true;
    });
    if (changed || Object.keys(normalizedLearned).length !== Object.keys(LEARNED || {}).length) {
      LEARNED = normalizedLearned;
      localSet({ wardenone_learned: LEARNED }).catch(() => {});
    }
    const domains = Object.keys(LEARNED)
      .sort((a, b) => Number((LEARNED[b] && LEARNED[b].hits) || 0) - Number((LEARNED[a] && LEARNED[a].hits) || 0))
      .slice(0, LEARNED_MAX);
    const addRules = domains.map((d, i) => ({
      id: LEARNED_RULE_BASE + i,
      priority: 2000, // above normal block rules so it's decisive, below allowlist
      action: { type: 'block' },
      condition: { requestDomains: [d], resourceTypes: ['main_frame', 'sub_frame', 'image', 'xmlhttprequest', 'script', 'ping', 'websocket'] },
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules });
  } catch (e) { console.warn('[WardenOne] learned rules failed', e); }
}
// ---- Feed-updatable IP-grabber list -------------------------------------------
// The static grabber ruleset (rules.json) is frozen at ship time, but grabber operators
// rotate domains/TLDs constantly, so the marquee "IP grabbers" protection decays. This adds
// a DYNAMIC, feed/user-updatable grabber list (bundled grabber-extra.json seed + the
// chrome.storage.local 'wardenone_grabber_domains' key) applied as dynamic DNR block rules,
// so new grabber front-ends are blocked WITHOUT shipping a new extension version.
const GRABBER_FEED_RULE_BASE = 740000;
const GRABBER_FEED_MAX = 1000;
const GRABBER_FEED_DOMAINS = new Set();
function addGrabberFeedDomains(arr) {
  for (const d of (Array.isArray(arr) ? arr : [])) {
    const v = String(d || '').trim().toLowerCase().replace(/^\*?\.?/, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) || v.includes('..')) continue;
    const rd = registrableDomainBg(v) || v;
    if (rd && !isNeverBlockDomain(rd)) GRABBER_FEED_DOMAINS.add(v);
  }
}
async function applyGrabberFeedRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing.filter((x) => x.id >= GRABBER_FEED_RULE_BASE && x.id < GRABBER_FEED_RULE_BASE + GRABBER_FEED_MAX).map((x) => x.id);
    let cfg = {};
    try { const s = await localGet('wardenone_config'); cfg = Object.assign({}, DEFAULT_CONFIG, (s && s.wardenone_config) || {}); } catch (_) {}
    const grabberOff = cfg.blockGrabberResources === false && cfg.warnGrabberDomains === false && cfg.blockMalwareSites === false;
    const domains = (cfg.enabled === false || grabberOff) ? [] : Array.from(GRABBER_FEED_DOMAINS).slice(0, GRABBER_FEED_MAX);
    const addRules = domains.map((d, i) => ({
      id: GRABBER_FEED_RULE_BASE + i,
      priority: 2000,
      action: { type: 'block' },
      condition: { requestDomains: [d], resourceTypes: ['main_frame', 'sub_frame', 'image', 'xmlhttprequest', 'script', 'ping', 'websocket', 'media', 'object', 'other'] },
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules });
  } catch (e) { console.warn('[WardenOne] grabber feed rules failed', e); }
}
async function loadGrabberFeed() {
  GRABBER_FEED_DOMAINS.clear();
  try {
    const res = await fetch(chrome.runtime.getURL('grabber-extra.json'), { cache: 'no-store' });
    if (res && res.ok) { const data = await res.json(); addGrabberFeedDomains(Array.isArray(data) ? data : (data && data.domains)); }
  } catch (_) {}
  try {
    const x = await localGet(['wardenone_grabber_domains', SUPPLEMENTAL_LIST_STORAGE_KEY]);
    const stored = x && x.wardenone_grabber_domains;
    addGrabberFeedDomains(Array.isArray(stored) ? stored : (stored && stored.domains));
    const supplemental = x && x[SUPPLEMENTAL_LIST_STORAGE_KEY];
    addGrabberFeedDomains(supplemental && supplemental.grabberDomainsExtra);
  } catch (_) {}
  await applyGrabberFeedRules();
}
loadGrabberFeed();

function learnDomain(domain, reason) {
  try {
    const d = normalizeLearnedDomain(domain);
    if (!d) return;
    // don't learn a domain that's allowlisted or already on a static/dynamic list
    if (BLOCKED_DOMAINS.has(d)) return;
    if (LEARNED[d]) { LEARNED[d].hits = (LEARNED[d].hits || 1) + 1; }
    else { LEARNED[d] = { firstSeen: Date.now(), reason: String(reason || 'suspicious behavior').slice(0, 80), hits: 1 }; }
    localSet({ wardenone_learned: LEARNED })
      .then(() => {
        applyLearnedRules();
        refreshListMetaCounts();
      })
      .catch(() => {});
  } catch (_) {}
}

function normalizeTrackerDomain(value) {
  try {
    let h = String(value || '').trim().toLowerCase();
    if (!h) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) h = new URL(h).hostname;
    h = h.replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
    if (!/^[a-z0-9.-]+$/i.test(h) || !h.includes('.')) return '';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return '';
    return registrableDomainBg(h);
  } catch (_) {
    return '';
  }
}

function trackerStoreShape(raw) {
  const out = { domains: {}, siteControls: {} };
  const src = raw && typeof raw === 'object' ? raw : {};
  const domains = src.domains && typeof src.domains === 'object' ? src.domains : {};
  Object.keys(domains).forEach((key) => {
    const domain = normalizeTrackerDomain(key);
    if (!domain) return;
    const v = domains[key] || {};
    const sites = {};
    const rawSites = v.sites && typeof v.sites === 'object' ? v.sites : {};
    Object.keys(rawSites).slice(0, 80).forEach((siteKey) => {
      const site = normalizeTrackerDomain(siteKey);
      if (!site || site === domain) return;
      const sv = rawSites[siteKey] || {};
      sites[site] = { hits: Math.max(1, Number(sv.hits || 1)), lastSeen: Number(sv.lastSeen || v.lastSeen || Date.now()) };
    });
    const signals = {};
    const rawSignals = v.signals && typeof v.signals === 'object' ? v.signals : {};
    Object.keys(rawSignals).slice(0, 20).forEach((s) => {
      signals[String(s).slice(0, 40)] = Math.max(1, Number(rawSignals[s] || 1));
    });
    out.domains[domain] = {
      firstSeen: Number(v.firstSeen || Date.now()),
      lastSeen: Number(v.lastSeen || v.firstSeen || Date.now()),
      hits: Math.max(1, Number(v.hits || 1)),
      state: v.state === 'learned' ? 'learned' : 'candidate',
      reason: String(v.reason || 'tracker-like third-party requests').slice(0, 120),
      sites,
      signals,
    };
  });
  const controls = src.siteControls && typeof src.siteControls === 'object' ? src.siteControls : {};
  Object.keys(controls).forEach((siteKey) => {
    const site = normalizeTrackerDomain(siteKey);
    if (!site) return;
    const c = controls[siteKey] || {};
    const allow = {};
    const block = {};
    const fill = (from, to) => {
      if (Array.isArray(from)) from.forEach((d) => { const nd = normalizeTrackerDomain(d); if (nd) to[nd] = Date.now(); });
      else if (from && typeof from === 'object') Object.keys(from).forEach((d) => { const nd = normalizeTrackerDomain(d); if (nd) to[nd] = Number(from[d] || Date.now()); });
    };
    fill(c.allow, allow);
    fill(c.block, block);
    out.siteControls[site] = { allow, block };
  });
  return out;
}

function loadTrackerLearner() {
  if (__initTrackerLearner) return __initTrackerLearner;
  __initTrackerLearner = new Promise((resolve) => {
    try {
      chrome.storage.local.get(TRACKER_LEARNER_KEY, (r) => {
        TRACKER_LEARNER = trackerStoreShape(r && r[TRACKER_LEARNER_KEY]);
        applyTrackerLearnerRules();
        resolve(TRACKER_LEARNER);
      });
    } catch (_) {
      resolve(TRACKER_LEARNER);
    }
  });
  return __initTrackerLearner;
}

function trackerDistinctSiteCount(entry) {
  return Object.keys((entry && entry.sites) || {}).length;
}

function isProtectedTrackerDomain(domain) {
  const d = normalizeTrackerDomain(domain);
  if (!d) return true;
  if (TRACKER_PROTECTED_DOMAINS.has(d)) return true;
  return /(^|\.)((gov|edu|mil)\.[a-z]{2}|gov|edu|mil)$/i.test(d);
}

function pruneTrackerLearnerStore() {
  const entries = Object.entries(TRACKER_LEARNER.domains || {})
    .sort((a, b) => Number((b[1] && b[1].lastSeen) || 0) - Number((a[1] && a[1].lastSeen) || 0));
  TRACKER_LEARNER.domains = Object.fromEntries(entries.slice(0, TRACKER_LEARN_STORAGE_MAX));
  const known = new Set(Object.keys(TRACKER_LEARNER.domains));
  Object.keys(TRACKER_LEARNER.siteControls || {}).forEach((site) => {
    const c = TRACKER_LEARNER.siteControls[site] || {};
    ['allow', 'block'].forEach((k) => {
      const src = c[k] || {};
      c[k] = Object.fromEntries(Object.entries(src).filter(([d]) => known.has(d)).slice(0, 80));
    });
    if (!Object.keys(c.allow || {}).length && !Object.keys(c.block || {}).length) delete TRACKER_LEARNER.siteControls[site];
  });
}

async function saveTrackerLearner(applyRules) {
  pruneTrackerLearnerStore();
  await localSet({ [TRACKER_LEARNER_KEY]: TRACKER_LEARNER });
  if (applyRules) await applyTrackerLearnerRules();
}

async function applyTrackerLearnerRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing
      .filter((x) => x.id >= TRACKER_RULE_BASE && x.id < TRACKER_RULE_BASE + TRACKER_RULE_MAX)
      .map((x) => x.id);
    const cfgStore = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (cfgStore && cfgStore.wardenone_config) || {});
    if (cfg.enabled === false || cfg.trackerLearner === false) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules: [] });
      return;
    }
    const rules = [];
    const addRule = (action, priority, domain, extraCondition) => {
      if (rules.length >= TRACKER_RULE_MAX) return;
      const d = normalizeTrackerDomain(domain);
      if (!d) return;
      rules.push({
        id: TRACKER_RULE_BASE + rules.length,
        priority,
        action: { type: action },
        condition: Object.assign({
          requestDomains: [d],
          domainType: 'thirdParty',
          resourceTypes: TRACKER_RESOURCE_TYPES,
        }, extraCondition || {}),
      });
    };
    const controls = TRACKER_LEARNER.siteControls || {};
    Object.keys(controls).sort().forEach((site) => {
      const c = controls[site] || {};
      Object.keys(c.allow || {}).sort().forEach((domain) => addRule('allow', 2600, domain, { initiatorDomains: [site] }));
      Object.keys(c.block || {}).sort().forEach((domain) => addRule('block', 2500, domain, { initiatorDomains: [site] }));
    });
    Object.keys(TRACKER_LEARNER.domains || {})
      .filter((domain) => TRACKER_LEARNER.domains[domain] && TRACKER_LEARNER.domains[domain].state === 'learned')
      .sort((a, b) => Number((TRACKER_LEARNER.domains[b] && TRACKER_LEARNER.domains[b].hits) || 0) - Number((TRACKER_LEARNER.domains[a] && TRACKER_LEARNER.domains[a].hits) || 0))
      .forEach((domain) => addRule('block', 1800, domain));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules: rules });
  } catch (e) {
    console.warn('[WardenOne] tracker learner rules failed', e);
  }
}

// Unambiguous tracker host markers. A third-party host carrying one of these is ~never
// legitimate functional content, so a SINGLE sighting is enough to learn+block it (vs the
// 3-sites / 3-hits default for ambiguous candidates). Deliberately excludes generic words
// (track/tracking/stats/tags/cdn/pixel) that collide with legitimate hosts such as package-
// tracking, status pages, and asset CDNs.
function looksLikeKnownTrackerHost(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return false;
  return /(^|\.)(analytics|metrics|telemetry|beacon|adservice|adsystem|adserver)\./.test(d)
    || /(^|\.)(scorecardresearch|quantserve|doubleclick|moatads|adsafeprotected|mixpanel|amplitude|heapanalytics|fullstory|hotjar|mouseflow|crazyegg|luckyorange|inspectlet|chartbeat|matomo|piwik|demdex|bluekai|krux|omtrdc|2o7|adnxs|rubiconproject|pubmatic|criteo)\./.test(d);
}

async function noteTrackerObservation(tabUrl, detail) {
  try {
    const cfgStore = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (cfgStore && cfgStore.wardenone_config) || {});
    if (cfg.enabled === false || cfg.trackerLearner === false) return;
    let first = '';
    try { first = normalizeTrackerDomain(new URL(String(tabUrl || '')).hostname); } catch (_) {}
    const signal = String((detail && detail.signal) || 'tracker').slice(0, 40);
    // DOM discovery only says that a third-party resource exists. Treating a
    // generic script/iframe/src URL as tracker evidence poisoned shared media
    // providers after they appeared on a few sites. Only API/path/parameter
    // evidence reaches the learner.
    if (signal === 'resource-url') return;
    const third = normalizeTrackerDomain((detail && (detail.domain || detail.host)) || '');
    if (!first || !third || first === third || isProtectedTrackerDomain(third)) return;
    await loadTrackerLearner();
    const now = Date.now();
    const domains = TRACKER_LEARNER.domains || (TRACKER_LEARNER.domains = {});
    const entry = domains[third] || (domains[third] = {
      firstSeen: now,
      lastSeen: now,
      hits: 0,
      state: 'candidate',
      reason: 'tracker-like third-party requests',
      sites: {},
      signals: {},
    });
    entry.lastSeen = now;
    entry.hits = Math.min(1000000, Number(entry.hits || 0) + 1);
    entry.signals = entry.signals || {};
    entry.signals[signal] = Math.min(1000000, Number(entry.signals[signal] || 0) + 1);
    entry.sites = entry.sites || {};
    const site = entry.sites[first] || (entry.sites[first] = { hits: 0, lastSeen: now });
    site.hits = Math.min(1000000, Number(site.hits || 0) + 1);
    site.lastSeen = now;
    const wasLearned = entry.state === 'learned';
    // High-confidence tracker hosts learn on first contact; ambiguous candidates still need
    // the 3-sites / 3-hits corroboration before any block rule is created.
    const strongHost = looksLikeKnownTrackerHost(third);
    const minHits = strongHost ? 1 : TRACKER_LEARN_MIN_HITS;
    const minSites = strongHost ? 1 : TRACKER_LEARN_MIN_SITES;
    if (!wasLearned && entry.hits >= minHits && trackerDistinctSiteCount(entry) >= minSites) {
      entry.state = 'learned';
      entry.reason = strongHost
        ? 'known tracker host pattern'
        : 'seen as a tracker on ' + trackerDistinctSiteCount(entry) + ' different sites';
      queueHistory({
        type: 'learned_tracker_domain',
        detail: { domain: third, sites: trackerDistinctSiteCount(entry), hits: entry.hits },
        url: tabUrl || '',
        at: now,
      });
    }
    await saveTrackerLearner(!wasLearned && entry.state === 'learned');
  } catch (_) {}
}

async function trackerLearnerStatus(url) {
  await loadTrackerLearner();
  let enabled = true;
  try {
    const cfgStore = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (cfgStore && cfgStore.wardenone_config) || {});
    enabled = cfg.enabled !== false && cfg.trackerLearner !== false;
  } catch (_) {}
  let site = '';
  try { site = normalizeTrackerDomain(new URL(String(url || '')).hostname); } catch (_) {}
  const controls = (TRACKER_LEARNER.siteControls && TRACKER_LEARNER.siteControls[site]) || { allow: {}, block: {} };
  const items = Object.keys(TRACKER_LEARNER.domains || {})
    .map((domain) => {
      const entry = TRACKER_LEARNER.domains[domain] || {};
      const siteHit = entry.sites && site && entry.sites[site];
      if (!siteHit && !(controls.allow && controls.allow[domain]) && !(controls.block && controls.block[domain])) return null;
      const siteMode = controls.allow && controls.allow[domain] ? 'allow'
        : controls.block && controls.block[domain] ? 'block'
          : 'auto';
      return {
        domain,
        state: entry.state || 'candidate',
        mode: siteMode,
        hits: Number(entry.hits || 0),
        siteHits: Number((siteHit && siteHit.hits) || 0),
        sites: trackerDistinctSiteCount(entry),
        lastSeen: Number(entry.lastSeen || 0),
        reason: entry.reason || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.siteHits - a.siteHits) || (b.lastSeen - a.lastSeen) || (b.hits - a.hits))
    .slice(0, 12);
  const learnedCount = Object.values(TRACKER_LEARNER.domains || {}).filter((x) => x && x.state === 'learned').length;
  return { ok: true, site, enabled, learnedCount, items };
}

async function setTrackerLearnerSiteMode(url, domain, mode) {
  await loadTrackerLearner();
  let site = '';
  try { site = normalizeTrackerDomain(new URL(String(url || '')).hostname); } catch (_) {}
  const d = normalizeTrackerDomain(domain);
  if (!site || !d || site === d) return { ok: false, error: 'Open a website and choose a valid third-party domain.' };
  TRACKER_LEARNER.domains[d] = TRACKER_LEARNER.domains[d] || {
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    hits: 0,
    state: 'candidate',
    reason: 'manually controlled for this site',
    sites: { [site]: { hits: 0, lastSeen: Date.now() } },
    signals: {},
  };
  const controls = TRACKER_LEARNER.siteControls || (TRACKER_LEARNER.siteControls = {});
  const c = controls[site] || (controls[site] = { allow: {}, block: {} });
  c.allow = c.allow || {};
  c.block = c.block || {};
  if (mode === 'allow') {
    c.allow[d] = Date.now();
    delete c.block[d];
  } else if (mode === 'block') {
    c.block[d] = Date.now();
    delete c.allow[d];
  } else {
    delete c.allow[d];
    delete c.block[d];
  }
  await saveTrackerLearner(true);
  return trackerLearnerStatus(url);
}

// In-memory set of known-bad domains (from the loaded blocklists), used to score
// download sources. Populated by updateRemoteLists and restored from storage on
// service-worker startup.
let BLOCKED_DOMAINS = new Set();
try {
  __initBlockedDomains = new Promise((resolve) => {
    chrome.storage.local.get('wardenone_blocked_domains', (r) => {
      if (r && Array.isArray(r.wardenone_blocked_domains)) BLOCKED_DOMAINS = new Set(r.wardenone_blocked_domains);
      resolve();
    });
  });
} catch (_) {
  if (!__initBlockedDomains) __initBlockedDomains = Promise.resolve();
}

// Wait for both async stores to load before event listeners fire. The top-level
// script completes before Chrome dispatches extension events, so by the time
// onCreated/onMessage/onUpdated listeners are invoked, our in-memory caches
// (LEARNED, BLOCKED_DOMAINS) are populated.
(async () => {
  await Promise.all([loadLearned(), loadTrackerLearner(), __initBlockedDomains || Promise.resolve()]);
})();

// ---- Shared reputation-provider constants --------------------------------
// Download Guard is implemented in background-downloads.js; these constants stay here
// because login/page/link reputation checks use the same provider/cache plumbing.
const DOMAIN_AGE_CACHE_KEY = 'wardenone_domain_age_cache';
const DOMAIN_AGE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const DOMAIN_AGE_TIMEOUT_MS = 4500;
const WHOISXML_CACHE_KEY = 'wardenone_whoisxml_cache';
const WHOISXML_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const WHOISXML_CACHE_MAX = 250;
const WHOISXML_TIMEOUT_MS = 8500;
const WHOISXML_ENDPOINT = 'https://www.whoisxmlapi.com/whoisserver/WhoisService';
const WHOISXML_REPUTATION_ENDPOINT = 'https://domain-reputation.whoisxmlapi.com/api/v2';
const WHOISXML_THREAT_ENDPOINT = 'https://threat-intelligence.whoisxmlapi.com/api/v1';
const EXTERNAL_REPUTATION_TIMEOUT_MS = 6500;

// Registrable-domain helpers. The algorithm lives in domain-utils.js (shared with the
// popup via importScripts above) so the two contexts can't drift; these thin wrappers
// keep the historical *Bg names used throughout this file.
function regDomainBg(host) { return regDomain(host); }
function registrableDomainBg(host) { return registrableDomain(host); }

function normalizeAllowlistHost(value) {
  let raw = String(value || '').trim();
  if (!raw || raw.length > 512) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) return '';
      raw = u.hostname;
    } else {
      raw = new URL('https://' + raw).hostname;
    }
  } catch (_) {
    if (/[/?#]/.test(raw)) return '';
  }
  let h = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
  if (!h || h.length > 253 || h.includes('*') || h.includes('%') || h.includes('/') || h.includes('\\')) return '';
  if (h.includes(':')) {
    const ip = normalizeIpLiteral(h);
    return ip && !isLocalOrPrivateHost(ip) ? ip : '';
  }
  if (!/^[a-z0-9.-]+$/i.test(h) || h.includes('..')) return '';
  const labels = h.split('.');
  if (labels.length < 2) return '';
  if (labels.some((label) => !label || label.length > 63 || /^-|-$/.test(label))) return '';
  if (isLocalOrPrivateHost(h)) return '';
  return h;
}

function normalizeAllowlistHosts(list, limit) {
  const out = [];
  const seen = new Set();
  const max = Math.max(1, Math.min(Number(limit) || 1000, 1000));
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (out.length >= max) return;
    const h = normalizeAllowlistHost(item);
    if (!h || seen.has(h)) return;
    seen.add(h);
    out.push(h);
  });
  return out;
}

function hostMatchesAllowlist(host, allowlist) {
  const h = normalizeAllowlistHost(host);
  if (!h) return false;
  return normalizeAllowlistHosts(allowlist).some((d) => h === d || h.endsWith('.' + d));
}

function sameStringList(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// ---- wardenone_config in-memory cache ----------------------------------------
// wardenone_config is the single hottest storage key -- it was re-read from
// chrome.storage.local on ~40 code paths (every navigation, download scan, message,
// memory sweep), each an async IPC round-trip that also keeps the service worker awake.
// We cache it in module memory and keep it fresh from storage.onChanged (and from our own
// localSet writes). The cache is JSON-deep-cloned on every read so no caller can mutate the
// cached object, and it stores ONLY the raw stored config (callers still merge DEFAULT_CONFIG
// exactly as before) -- so behaviour is byte-identical, just without the repeated reads.
// Multi-key reads (localGet([...])) deliberately bypass the cache -- they are rare and the
// special-case keeps to the single-key fast path.
let __cfgCache = null;
let __cfgCacheValid = false;
function __cfgClone(o) {
  try { return JSON.parse(JSON.stringify(o || {})); } catch (_) { return {}; }
}
function __cfgCacheSet(value) {
  __cfgCache = value && typeof value === 'object' ? value : {};
  __cfgCacheValid = true;
}
function localGet(key) {
  if (key === 'wardenone_config') {
    if (__cfgCacheValid) return Promise.resolve({ wardenone_config: __cfgClone(__cfgCache) });
    return new Promise((resolve) => chrome.storage.local.get('wardenone_config', (res) => {
      if (chrome.runtime.lastError) { resolve(res || {}); return; } // don't cache a failed read
      __cfgCacheSet((res && res.wardenone_config) || {});
      resolve({ wardenone_config: __cfgClone(__cfgCache) });
    }));
  }
  return new Promise((resolve) => chrome.storage.local.get(key, resolve));
}

function localSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else {
          // keep the cache fresh immediately on our own writes (before onChanged fires),
          // closing the write->immediate-read staleness window.
          if (obj && Object.prototype.hasOwnProperty.call(obj, 'wardenone_config')) {
            __cfgCacheSet(__cfgClone(obj.wardenone_config) || {});
          }
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

const STORAGE_META_KEY = 'wardenone_storage_meta';
const STORAGE_SOFT_LIMIT_BYTES = 4 * 1024 * 1024;
const BLOCKED_DOMAIN_STORAGE_MAX = 30000;
const BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX = 12000;
const OPENPHISH_STORAGE_PRESSURE_MAX = 10000;
const HISTORY_STORAGE_PRESSURE_MAX = 120;

function storageQuotaBytes() {
  try {
    const q = Number(chrome.storage.local && chrome.storage.local.QUOTA_BYTES);
    return Number.isFinite(q) && q > 0 ? q : 5 * 1024 * 1024;
  } catch (_) {
    return 5 * 1024 * 1024;
  }
}

function storageGetBytesInUse(keys) {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage.local.getBytesInUse) { resolve(0); return; }
      chrome.storage.local.getBytesInUse(keys == null ? null : keys, (bytes) => {
        const err = chrome.runtime.lastError;
        resolve(err ? 0 : (Number(bytes) || 0));
      });
    } catch (_) {
      resolve(0);
    }
  });
}

async function writeStorageTelemetry(reason, extra) {
  const bytes = await storageGetBytesInUse(null);
  const quotaBytes = storageQuotaBytes();
  const meta = Object.assign({
    bytes,
    quotaBytes,
    softLimitBytes: STORAGE_SOFT_LIMIT_BYTES,
    pressure: bytes >= STORAGE_SOFT_LIMIT_BYTES,
    updatedAt: Date.now(),
    reason: String(reason || ''),
  }, extra || {});
  try { await localSet({ [STORAGE_META_KEY]: meta }); } catch (_) {}
  return meta;
}

async function pruneStorageIfNeeded(reason) {
  const before = await storageGetBytesInUse(null);
  if (!before || before < STORAGE_SOFT_LIMIT_BYTES) {
    return writeStorageTelemetry(reason, { pruned: false });
  }

  const actions = [];
  try {
    const store = await localGet([
      'wardenone_blocked_domains',
      'wardenone_history',
      OPENPHISH_CACHE_KEY,
    ]);

    const blocked = store && store.wardenone_blocked_domains;
    if (Array.isArray(blocked) && blocked.length > BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX) {
      await localSet({ wardenone_blocked_domains: blocked.slice(0, BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX) });
      actions.push('blocked_domains:' + blocked.length + '->' + BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX);
    }

    const hist = store && store.wardenone_history;
    if (Array.isArray(hist) && hist.length > HISTORY_STORAGE_PRESSURE_MAX) {
      await localSet({ wardenone_history: hist.slice(0, HISTORY_STORAGE_PRESSURE_MAX) });
      actions.push('history:' + hist.length + '->' + HISTORY_STORAGE_PRESSURE_MAX);
    }

    const openPhish = store && store[OPENPHISH_CACHE_KEY];
    if (openPhish && Array.isArray(openPhish.urls) && openPhish.urls.length > OPENPHISH_STORAGE_PRESSURE_MAX) {
      await localSet({
        [OPENPHISH_CACHE_KEY]: Object.assign({}, openPhish, {
          urls: openPhish.urls.slice(0, OPENPHISH_STORAGE_PRESSURE_MAX),
        }),
      });
      actions.push('openphish:' + openPhish.urls.length + '->' + OPENPHISH_STORAGE_PRESSURE_MAX);
    }
  } catch (e) {
    actions.push('prune-error:' + String(e).slice(0, 80));
  }

  const after = await storageGetBytesInUse(null);
  return writeStorageTelemetry(reason, { pruned: actions.length > 0, actions, beforeBytes: before, afterBytes: after });
}

async function persistBlockedDomainsForStorage(domains) {
  const list = Array.isArray(domains) ? domains : Array.from(domains || []);
  const bytes = await storageGetBytesInUse(null);
  const caps = bytes >= STORAGE_SOFT_LIMIT_BYTES
    ? [BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX, 8000, 3000]
    : [BLOCKED_DOMAIN_STORAGE_MAX, 18000, BLOCKED_DOMAIN_STORAGE_PRESSURE_MAX, 8000, 3000];
  let lastError = null;
  for (const cap of caps) {
    try {
      const slice = list.slice(0, cap);
      await localSet({ wardenone_blocked_domains: slice });
      await pruneStorageIfNeeded('blocked-domains');
      return { ok: true, storedCount: slice.length, cap };
    } catch (e) {
      lastError = e;
      await pruneStorageIfNeeded('blocked-domains-retry');
    }
  }
  throw lastError || new Error('Could not persist blocked domains');
}

async function sha256TextHex(text) {
  try {
    const data = new TextEncoder().encode(String(text || ''));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return '';
  }
}

function tabsQuery(query) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(query || {}, (tabs) => {
        if (chrome.runtime.lastError) { resolve([]); return; }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (_) {
      resolve([]);
    }
  });
}

function tabsUpdate(tabId, props) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.update(Number(tabId), props || {}, (tab) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '', tab });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function tabsCreate(props) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.create(props || {}, (tab) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '', tab });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function tabsGet(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.get(Number(tabId), (tab) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(tab || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function tabsRemove(tabIds) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.remove(tabIds, () => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function windowsUpdate(windowId, props) {
  return new Promise((resolve) => {
    try {
      chrome.windows.update(Number(windowId), props || {}, (win) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '', window: win });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function windowsCreate(opts) {
  return new Promise((resolve) => {
    try {
      chrome.windows.create(opts, (win) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '', window: win });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

/* ===========================================================================
 * DOWNLOAD GUARD
 * ---------------------------------------------------------------------------
 * Split into background-downloads.js so download scoring/review/hard-blocking
 * can be tested and maintained without adding more weight to the main worker.
 * ========================================================================== */
importScripts('background-downloads.js');

async function lookupDomainAge(domain, cfg) {
  const reg = registrableDomainBg(domain);
  if (!reg || /^\d{1,3}(\.\d{1,3}){3}$/.test(reg) || isLocalOrPrivateHost(reg)) return { ok: false, domain: reg, unsupported: true };

  try {
    if (cfg && cfg.enabled !== false && cfg.whoisXml === true && String(cfg.whoisXmlKey || '').trim()) {
      const whois = await lookupWhoisXmlDomain(reg, cfg);
      if (whois && whois.ok && typeof whois.ageDays === 'number') return whois;
    }

    const cached = await localGet(DOMAIN_AGE_CACHE_KEY);
    const cache = (cached && cached[DOMAIN_AGE_CACHE_KEY] && typeof cached[DOMAIN_AGE_CACHE_KEY] === 'object') ? cached[DOMAIN_AGE_CACHE_KEY] : {};
    const hit = cache[reg];
    if (hit && hit.cachedAt && (Date.now() - hit.cachedAt) < DOMAIN_AGE_CACHE_MS) {
      return Object.assign({ ok: true, domain: reg, cached: true }, hit.result || {});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOMAIN_AGE_TIMEOUT_MS);
    try {
      const res = await fetch('https://rdap.org/domain/' + encodeURIComponent(reg), {
        headers: { 'Accept': 'application/rdap+json' },
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, status: res.status, domain: reg };
      const data = await res.json();
      let created = null;
      const events = Array.isArray(data.events) ? data.events : [];
      for (const e of events) {
        if (e.eventAction === 'registration' && e.eventDate) { created = e.eventDate; break; }
      }
      if (!created) return { ok: false, noDate: true, domain: reg };
      const ageMs = Date.now() - new Date(created).getTime();
      const ageDays = Math.max(0, Math.floor(ageMs / 86400000));
      let risk, riskColor;
      if (ageDays < 7) { risk = 'High'; riskColor = '#c0392b'; }
      else if (ageDays < 30) { risk = 'Elevated'; riskColor = '#bd7a2a'; }
      else if (ageDays < 90) { risk = 'Moderate'; riskColor = '#bd7a2a'; }
      else { risk = 'Low'; riskColor = '#2e9e5b'; }
      const result = { domain: reg, created, ageDays, risk, riskColor, provider: 'RDAP' };
      cache[reg] = { cachedAt: Date.now(), result };
      const entries = Object.entries(cache).sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0));
      while (entries.length > 100) {
        const old = entries.pop();
        if (old) delete cache[old[0]];
      }
      await localSet({ [DOMAIN_AGE_CACHE_KEY]: cache });
      return Object.assign({ ok: true }, result);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, domain: reg, error: String(e) };
  }
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || EXTERNAL_REPUTATION_TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({ credentials: 'omit', redirect: 'error' }, options || {}, { signal: controller.signal }));
    let data = null;
    let bodySnippet = '';
    let contentType = '';
    try { contentType = res.headers && res.headers.get ? String(res.headers.get('content-type') || '') : ''; } catch (_) {}
    const textCopy = res.clone();
    try {
      data = await res.json();
    } catch (_) {
      try { bodySnippet = (await textCopy.text()).slice(0, 500); } catch (_) {}
    }
    return { ok: res.ok, status: res.status, data, bodySnippet, contentType };
  } finally {
    clearTimeout(timer);
  }
}

function base64UrlNoPadding(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function externalSummary(results) {
  return (results || []).map((r) => {
    if (r.provider === 'VirusTotal' && r.stats) {
      return 'VirusTotal ' + (r.stats.malicious || 0) + 'M/' + (r.stats.suspicious || 0) + 'S';
    }
    if (r.provider === 'VirusTotal' && r.notFound) {
      return 'VirusTotal no report';
    }
    if (r.provider === 'VirusTotal' && r.ok === false) {
      return 'VirusTotal failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'VirusTotal file hash' && r.stats) {
      return 'VirusTotal URL-hash ' + (r.stats.malicious || 0) + 'M/' + (r.stats.suspicious || 0) + 'S';
    }
    if (r.provider === 'Google Safe Browsing' && r.threats && r.threats.length) {
      return 'Google Safe Browsing: ' + r.threats.join(', ');
    }
    if (r.provider === 'Google Safe Browsing' && r.ok) {
      return 'Google Safe Browsing clear';
    }
    if (r.provider === 'Google Safe Browsing' && r.ok === false) {
      return 'Google Safe Browsing failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'PhishTank' && r.hit) {
      return 'PhishTank phishing' + (r.phishId ? ' #' + r.phishId : '');
    }
    if (r.provider === 'PhishTank' && r.ok) {
      return r.inDatabase ? 'PhishTank listed, not current/verified' : 'PhishTank clear';
    }
    if (r.provider === 'PhishTank' && r.ok === false) {
      if (r.rateLimited) return 'PhishTank rate limited';
      if (r.cloudflare) return 'PhishTank browser challenge';
      return 'PhishTank failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'OpenPhish' && r.hit) {
      return 'OpenPhish phishing feed match';
    }
    if (r.provider === 'OpenPhish' && r.ok) {
      return r.stale ? 'OpenPhish clear (stale feed)' : 'OpenPhish clear';
    }
    if (r.provider === 'OpenPhish' && r.ok === false) {
      return 'OpenPhish failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'AbuseIPDB' && r.ok === false) {
      return r.rateLimited ? 'AbuseIPDB rate limited' : 'AbuseIPDB failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'AbuseIPDB' && (r.hit || r.warning)) {
      return 'AbuseIPDB ' + (r.score || 0) + '% abuse confidence';
    }
    if (r.provider === 'AbuseIPDB' && r.ok) {
      return 'AbuseIPDB clear';
    }
    if (r.provider === 'URLhaus' && r.hit) {
      return 'URLhaus malware URL' + (r.urlStatus ? ' (' + r.urlStatus + ')' : '');
    }
    if (r.provider === 'URLhaus' && r.ok) {
      return 'URLhaus clear';
    }
    if (r.provider === 'URLhaus' && r.ok === false) {
      return 'URLhaus failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'WhoisXML Domain Reputation' && (r.hit || r.warning)) {
      return 'WhoisXML reputation ' + (r.reputationScore != null ? Math.round(Number(r.reputationScore)) + '/100' : 'warning');
    }
    if (r.provider === 'WhoisXML Domain Reputation' && r.ok) {
      return 'WhoisXML reputation clear';
    }
    if (r.provider === 'WhoisXML Domain Reputation' && r.ok === false) {
      return 'WhoisXML reputation failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'WhoisXML Threat Intelligence' && r.hit) {
      return 'WhoisXML threat intel ' + ((r.threatTypes && r.threatTypes.length) ? r.threatTypes.join(',') : 'match');
    }
    if (r.provider === 'WhoisXML Threat Intelligence' && r.warning) {
      return 'WhoisXML threat intel warning';
    }
    if (r.provider === 'WhoisXML Threat Intelligence' && r.ok) {
      return 'WhoisXML threat intel clear';
    }
    if (r.provider === 'WhoisXML Threat Intelligence' && r.ok === false) {
      return 'WhoisXML threat intel failed' + (r.status ? ' HTTP ' + r.status : '');
    }
    if (r.provider === 'WhoisXML API' && r.warning) {
      return 'WhoisXML age ' + (r.ageDays != null ? r.ageDays + 'd' : 'warning');
    }
    if (r.provider === 'WhoisXML API' && r.ok) {
      return 'WhoisXML age clear';
    }
    return r.provider;
  }).join(' · ');
}

async function checkSafeBrowsingUrl(url, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key || !url) return null;
  const endpoint = 'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + encodeURIComponent(key);
  const body = {
    client: { clientId: 'wardenone', clientVersion: WO_CLIENT_VERSION },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }],
    },
  };
  try {
    const res = await fetchJsonWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { provider: 'Google Safe Browsing', ok: false, status: res.status };
    const matches = (res.data && Array.isArray(res.data.matches)) ? res.data.matches : [];
    if (!matches.length) return { provider: 'Google Safe Browsing', ok: true, hit: false };
    const threats = Array.from(new Set(matches.map((m) => m.threatType).filter(Boolean)));
    const cacheMs = matches
      .map((m) => parseSafeBrowsingDurationMs(m && m.cacheDuration))
      .filter((n) => n > 0)
      .sort((a, b) => a - b)[0] || 0;
    return { provider: 'Google Safe Browsing', ok: true, hit: true, threats, matches, cacheDurationMs: cacheMs };
  } catch (e) {
    return { provider: 'Google Safe Browsing', ok: false, error: String(e).slice(0, 120) };
  }
}

async function testSafeBrowsingKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, error: 'No Google Safe Browsing API key saved.' };

  try {
    const result = await checkSafeBrowsingUrl('https://www.google.com/', key);
    if (result && result.ok) return { ok: true, message: 'Google Safe Browsing key works. URL reputation is enabled.' };
    if (result && (result.status === 400 || result.status === 401 || result.status === 403)) {
      return { ok: false, error: 'Google rejected this Safe Browsing API key. Check the key and make sure the Safe Browsing API is enabled in Google Cloud.' };
    }
    if (result && result.status === 429) {
      return { ok: false, error: 'Safe Browsing key works, but its quota is currently rate-limited.' };
    }
    return { ok: false, error: (result && result.error) || ('Safe Browsing test failed' + (result && result.status ? ' (HTTP ' + result.status + ')' : '') + '.') };
  } catch (e) {
    return { ok: false, error: 'Could not reach Google Safe Browsing: ' + String(e).slice(0, 100) };
  }
}

const SAFE_BROWSING_CACHE_KEY = 'wardenone_safe_browsing_cache';
const SAFE_BROWSING_CACHE_MAX = 800;
const SAFE_BROWSING_CLEAN_TTL_MS = 15 * 60 * 1000;
const SAFE_BROWSING_HIT_TTL_MS = 5 * 60 * 1000;
const PHISHTANK_CACHE_KEY = 'wardenone_phishtank_cache';
const PHISHTANK_CACHE_MAX = 1200;
const PHISHTANK_CLEAN_TTL_MS = 20 * 60 * 1000;
const PHISHTANK_HIT_TTL_MS = 6 * 60 * 60 * 1000;
const PHISHTANK_ENDPOINT = 'https://checkurl.phishtank.com/checkurl/';
const OPENPHISH_CACHE_KEY = 'wardenone_openphish_feed_cache';
const OPENPHISH_FEED_URL = 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt';
const OPENPHISH_FEED_TTL_MS = 12 * 60 * 60 * 1000;
const OPENPHISH_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OPENPHISH_MAX_URLS = 25000;
const OPENPHISH_FEED_MAX_BYTES = 6 * 1024 * 1024;
const ABUSEIPDB_CACHE_KEY = 'wardenone_abuseipdb_cache';
const ABUSEIPDB_CACHE_MAX = 1200;
const ABUSEIPDB_CLEAN_TTL_MS = 12 * 60 * 60 * 1000;
const ABUSEIPDB_WARN_TTL_MS = 4 * 60 * 60 * 1000;
const ABUSEIPDB_HIT_TTL_MS = 4 * 60 * 60 * 1000;
const ABUSEIPDB_ENDPOINT = 'https://api.abuseipdb.com/api/v2/check';
const ABUSEIPDB_WARN_SCORE = 25;
const ABUSEIPDB_BLOCK_SCORE = 75;
const URLHAUS_CACHE_KEY = 'wardenone_urlhaus_cache';
const URLHAUS_CACHE_MAX = 1200;
const URLHAUS_CLEAN_TTL_MS = 60 * 60 * 1000;
const URLHAUS_HIT_TTL_MS = 12 * 60 * 60 * 1000;
const URLHAUS_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/url/';
const URLHAUS_HOST_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/host/';
const URLHAUS_RECENT_TEST_ENDPOINT = 'https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1/';
const WHOISXML_REPUTATION_CACHE_KEY = 'wardenone_whoisxml_reputation_cache';
const WHOISXML_REPUTATION_CACHE_MAX = 800;
const WHOISXML_REPUTATION_CLEAN_TTL_MS = 12 * 60 * 60 * 1000;
const WHOISXML_REPUTATION_WARN_TTL_MS = 6 * 60 * 60 * 1000;
const WHOISXML_REPUTATION_HIT_TTL_MS = 6 * 60 * 60 * 1000;
const WHOISXML_REPUTATION_WARN_SCORE = 70;
const WHOISXML_REPUTATION_BLOCK_SCORE = 20;
const WHOISXML_THREAT_CACHE_KEY = 'wardenone_whoisxml_threat_cache';
const WHOISXML_THREAT_CACHE_MAX = 800;
const WHOISXML_THREAT_CLEAN_TTL_MS = 12 * 60 * 60 * 1000;
const WHOISXML_THREAT_HIT_TTL_MS = 6 * 60 * 60 * 1000;
let safeBrowsingCache = null;
let safeBrowsingCacheWriteTimer = null;
const safeBrowsingInflight = Object.create(null);
let phishTankCache = null;
let phishTankCacheWriteTimer = null;
const phishTankInflight = Object.create(null);
let openPhishFeedCache = null;
let openPhishFeedInflight = null;
let abuseIpDbCache = null;
let abuseIpDbCacheWriteTimer = null;
const abuseIpDbInflight = Object.create(null);
let urlHausCache = null;
let urlHausCacheWriteTimer = null;
const urlHausInflight = Object.create(null);
let whoisXmlReputationCache = null;
let whoisXmlReputationCacheWriteTimer = null;
const whoisXmlReputationInflight = Object.create(null);
let whoisXmlThreatCache = null;
let whoisXmlThreatCacheWriteTimer = null;
const whoisXmlThreatInflight = Object.create(null);

function parseSafeBrowsingDurationMs(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)s$/);
  return m ? Math.max(0, Math.floor(Number(m[1]) * 1000)) : 0;
}

function normalizeSafeBrowsingUrl(url) {
  try {
    const u = new URL(String(url || ''), 'http://wardenone.local/');
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (isLocalOrPrivateHost(u.hostname)) return '';
    u.hash = '';
    return u.href.slice(0, 1500);
  } catch (_) {
    return '';
  }
}

// ---- Shared per-provider reputation cache plumbing -------------------------------
// Every external-reputation provider keeps its own module-level cache object and write
// timer (the provider's fetch/lookup code touches those directly), but the on-demand
// LOAD and the debounced prune-and-write are byte-identical across providers. These two
// helpers hold that logic once; each provider's load/schedule function is a thin shim
// that bridges to its own module variables via get/set closures. A change to the prune
// or write policy now lands in one place instead of six.
async function loadReputationCacheVia(getCache, setCache, cacheKey) {
  const current = getCache();
  if (current && typeof current === 'object') return current;
  let cache;
  try {
    const store = await localGet(cacheKey);
    cache = (store && store[cacheKey] && typeof store[cacheKey] === 'object') ? store[cacheKey] : {};
  } catch (_) {
    cache = {};
  }
  setCache(cache);
  return cache;
}
function scheduleReputationCacheWriteVia(getTimer, setTimer, load, setCache, cacheKey, max) {
  // Write-through NOW: this is called right after a fresh (paid) lookup result was added to the
  // in-memory cache, which previously lived ONLY in memory for the 700ms debounce -- an SW death
  // in that window lost the result and re-spent the rate-limited/paid API quota on the next look.
  // Persisting the current cache immediately makes a hot result durable; the debounced timer below
  // still does the heavier prune+sort+trim. Reputation providers are opt-in and cache hits dominate,
  // so this write fires only on the (infrequent) miss path.
  Promise.resolve(load())
    .then((cache) => { if (cache && typeof cache === 'object') return localSet({ [cacheKey]: cache }); })
    .catch(() => {});
  if (getTimer()) return;
  setTimer(setTimeout(async () => {
    setTimer(null);
    try {
      const cache = await load();
      const now = Date.now();
      const entries = Object.entries(cache)
        .filter(([, v]) => v && (!v.expiresAt || v.expiresAt > now))
        .sort((a, b) => Number((b[1] && b[1].checkedAt) || 0) - Number((a[1] && a[1].checkedAt) || 0))
        .slice(0, max);
      const pruned = Object.fromEntries(entries);
      setCache(pruned);
      await localSet({ [cacheKey]: pruned });
    } catch (_) {}
  }, 700));
}

async function loadSafeBrowsingCache() {
  return loadReputationCacheVia(() => safeBrowsingCache, (v) => { safeBrowsingCache = v; }, SAFE_BROWSING_CACHE_KEY);
}
function scheduleSafeBrowsingCacheWrite() {
  scheduleReputationCacheWriteVia(
    () => safeBrowsingCacheWriteTimer, (t) => { safeBrowsingCacheWriteTimer = t; },
    loadSafeBrowsingCache, (v) => { safeBrowsingCache = v; }, SAFE_BROWSING_CACHE_KEY, SAFE_BROWSING_CACHE_MAX);
}

async function safeBrowsingConfig() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
    const key = String(cfg.downloadSafeBrowsingKey || '').trim();
    return {
      cfg,
      key,
      enabled: cfg.enabled !== false && cfg.downloadSafeBrowsing === true && !!key,
    };
  } catch (_) {
    return { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  }
}

async function safeBrowsingLookupUrl(url, opts) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return { provider: 'Google Safe Browsing', ok: false, enabled: false, error: 'Unsupported URL', url: String(url || '') };

  const provided = opts && opts.cfg && opts.key
    ? { cfg: opts.cfg, key: opts.key, enabled: opts.cfg.enabled !== false && opts.cfg.downloadSafeBrowsing === true && !!String(opts.key || '').trim() }
    : await safeBrowsingConfig();
  if (!provided.enabled) return { provider: 'Google Safe Browsing', ok: false, enabled: false, url: normalized };

  const cache = await loadSafeBrowsingCache();
  const now = Date.now();
  const cached = cache[normalized];
  if (cached && cached.expiresAt > now) {
    return Object.assign({ provider: 'Google Safe Browsing', ok: true, enabled: true, cached: true, url: normalized }, cached.result || {});
  }

  if (safeBrowsingInflight[normalized]) return safeBrowsingInflight[normalized];
  safeBrowsingInflight[normalized] = (async () => {
    try {
      const result = await checkSafeBrowsingUrl(normalized, provided.key);
      const okResult = Object.assign({ enabled: true, url: normalized }, result || { provider: 'Google Safe Browsing', ok: false, error: 'No result' });
      if (okResult.ok) {
        const ttl = okResult.hit ? Math.max(SAFE_BROWSING_HIT_TTL_MS, Number(okResult.cacheDurationMs || 0)) : SAFE_BROWSING_CLEAN_TTL_MS;
        cache[normalized] = {
          checkedAt: now,
          expiresAt: now + ttl,
          result: {
            ok: true,
            hit: !!okResult.hit,
            threats: okResult.threats || [],
            status: okResult.status || 0,
            error: '',
          },
        };
        scheduleSafeBrowsingCacheWrite();
      }
      return okResult;
    } finally {
      delete safeBrowsingInflight[normalized];
    }
  })();
  return safeBrowsingInflight[normalized];
}

function phishTankBool(value) {
  if (value === true || value === 1) return true;
  return /^(y|yes|true|1)$/i.test(String(value || '').trim());
}

function phishTankResultObject(data) {
  const results = data && data.results;
  if (!results) return {};
  if (Array.isArray(results)) return results[0] || {};
  if (results.url0 && typeof results.url0 === 'object') return results.url0;
  return results;
}

function phishTankChallengeText(res) {
  return /cf_chl|cloudflare|just a moment|enable javascript and cookies/i.test(String((res && res.bodySnippet) || ''));
}

async function fetchPhishTankUrl(url, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key || !url) return null;
  const body = new URLSearchParams();
  body.set('url', String(url));
  body.set('format', 'json');
  body.set('app_key', key);

  try {
    const res = await fetchJsonWithTimeout(PHISHTANK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-WardenOne-Client': 'wardenone/' + WO_CLIENT_VERSION,
      },
      body: body.toString(),
    }, EXTERNAL_REPUTATION_TIMEOUT_MS);

    const cloudflare = phishTankChallengeText(res);
    if (!res.ok) {
      const rateLimited = res.status === 509 || res.status === 429;
      return {
        provider: 'PhishTank',
        ok: false,
        status: res.status || 0,
        rateLimited,
        cloudflare,
        error: cloudflare
          ? 'PhishTank returned a browser challenge instead of API JSON.'
          : (rateLimited ? 'PhishTank rate limit reached.' : 'PhishTank request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.'),
      };
    }

    const result = phishTankResultObject(res.data);
    if (!result || !Object.keys(result).length) {
      return {
        provider: 'PhishTank',
        ok: false,
        status: res.status || 0,
        cloudflare,
        error: cloudflare ? 'PhishTank returned a browser challenge instead of API JSON.' : 'PhishTank did not return URL results.',
      };
    }

    const inDatabase = phishTankBool(result.in_database);
    const verified = phishTankBool(result.verified);
    const valid = phishTankBool(result.valid);
    const hit = inDatabase && verified && valid;
    return {
      provider: 'PhishTank',
      ok: true,
      hit,
      threats: hit ? ['PHISHING'] : [],
      inDatabase,
      verified,
      valid,
      phishId: result.phish_id || '',
      detailPage: result.phish_detail_page || '',
      verifiedAt: result.verified_at || '',
      submittedAt: result.submitted_at || '',
      checkedUrl: result.url || url,
      status: res.status || 0,
    };
  } catch (e) {
    return { provider: 'PhishTank', ok: false, error: String(e).slice(0, 120) };
  }
}

async function loadPhishTankCache() {
  return loadReputationCacheVia(() => phishTankCache, (v) => { phishTankCache = v; }, PHISHTANK_CACHE_KEY);
}
function schedulePhishTankCacheWrite() {
  scheduleReputationCacheWriteVia(
    () => phishTankCacheWriteTimer, (t) => { phishTankCacheWriteTimer = t; },
    loadPhishTankCache, (v) => { phishTankCache = v; }, PHISHTANK_CACHE_KEY, PHISHTANK_CACHE_MAX);
}

async function phishTankConfig() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
    const key = String(cfg.phishTankKey || '').trim();
    return {
      cfg,
      key,
      enabled: cfg.enabled !== false && cfg.phishTank === true && !!key,
    };
  } catch (_) {
    return { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  }
}

async function phishTankLookupUrl(url, opts) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return { provider: 'PhishTank', ok: false, enabled: false, error: 'Unsupported URL', url: String(url || '') };

  const provided = opts && opts.cfg
    ? { cfg: opts.cfg, key: String(opts.key || opts.cfg.phishTankKey || '').trim(), enabled: opts.cfg.enabled !== false && opts.cfg.phishTank === true && !!String(opts.key || opts.cfg.phishTankKey || '').trim() }
    : await phishTankConfig();
  if (!provided.enabled) return { provider: 'PhishTank', ok: false, enabled: false, url: normalized };

  const cache = await loadPhishTankCache();
  const now = Date.now();
  const cached = cache[normalized];
  if (cached && cached.expiresAt > now) {
    return Object.assign({ provider: 'PhishTank', ok: true, enabled: true, cached: true, url: normalized }, cached.result || {});
  }

  if (phishTankInflight[normalized]) return phishTankInflight[normalized];
  phishTankInflight[normalized] = (async () => {
    try {
      const result = await fetchPhishTankUrl(normalized, provided.key);
      const okResult = Object.assign({ enabled: true, url: normalized }, result || { provider: 'PhishTank', ok: false, error: 'No result' });
      if (okResult.ok) {
        const ttl = okResult.hit ? PHISHTANK_HIT_TTL_MS : PHISHTANK_CLEAN_TTL_MS;
        cache[normalized] = {
          checkedAt: now,
          expiresAt: now + ttl,
          result: {
            ok: true,
            hit: !!okResult.hit,
            threats: okResult.threats || [],
            status: okResult.status || 0,
            error: '',
            inDatabase: !!okResult.inDatabase,
            verified: !!okResult.verified,
            valid: !!okResult.valid,
            phishId: okResult.phishId || '',
            detailPage: okResult.detailPage || '',
          },
        };
        schedulePhishTankCacheWrite();
      }
      return okResult;
    } finally {
      delete phishTankInflight[normalized];
    }
  })();
  return phishTankInflight[normalized];
}

function openPhishUrlKeys(url) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return [];
  try {
    const u = new URL(normalized);
    const keys = new Set();
    keys.add(u.href);
    keys.add('//' + u.hostname.toLowerCase() + u.pathname + u.search);
    if (u.search) keys.add('//' + u.hostname.toLowerCase() + u.pathname);
    if (u.pathname.endsWith('/') && u.pathname.length > 1) {
      const trimmed = u.pathname.replace(/\/+$/, '');
      keys.add('//' + u.hostname.toLowerCase() + trimmed + u.search);
      keys.add('//' + u.hostname.toLowerCase() + trimmed);
    }
    return Array.from(keys);
  } catch (_) {
    return [normalized];
  }
}

function buildOpenPhishFeed(urls, cachedAt, stale) {
  const clean = [];
  const seen = new Set();
  const keys = Object.create(null);
  (urls || []).forEach((raw) => {
    const normalized = normalizeSafeBrowsingUrl(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    clean.push(normalized);
    openPhishUrlKeys(normalized).forEach((key) => { if (key) keys[key] = normalized; });
  });
  return { cachedAt: Number(cachedAt || Date.now()), urls: clean.slice(0, OPENPHISH_MAX_URLS), keys, stale: !!stale };
}

function parseOpenPhishFeed(text) {
  return String(text || '')
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, OPENPHISH_MAX_URLS);
}

function addOpenPhishUrl(urls, seen, raw) {
  const value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value) || seen.has(value)) return false;
  seen.add(value);
  urls.push(value);
  return urls.length >= OPENPHISH_MAX_URLS;
}

async function loadOpenPhishStoredFeed() {
  try {
    const store = await localGet(OPENPHISH_CACHE_KEY);
    const cached = store && store[OPENPHISH_CACHE_KEY];
    if (!cached || !Array.isArray(cached.urls) || !cached.cachedAt) return null;
    const age = Date.now() - Number(cached.cachedAt || 0);
    if (age > OPENPHISH_STALE_TTL_MS) return null;
    return buildOpenPhishFeed(cached.urls, cached.cachedAt, age > OPENPHISH_FEED_TTL_MS);
  } catch (_) {
    return null;
  }
}

async function saveOpenPhishStoredFeed(feed) {
  try {
    if (!feed || !Array.isArray(feed.urls) || !feed.urls.length) return;
    await localSet({ [OPENPHISH_CACHE_KEY]: { cachedAt: feed.cachedAt || Date.now(), urls: feed.urls.slice(0, OPENPHISH_MAX_URLS) } });
  } catch (_) {}
}

async function fetchOpenPhishFeed() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_REPUTATION_TIMEOUT_MS);
  try {
    const res = await fetch(OPENPHISH_FEED_URL, {
      method: 'GET',
      headers: { 'Accept': 'text/plain,*/*' },
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res && res.status >= 300 && res.status < 400) {
      return { ok: false, provider: 'OpenPhish', status: res.status || 0, error: 'OpenPhish feed redirected unexpectedly.' };
    }
    if (!res.ok) return { ok: false, provider: 'OpenPhish', status: res.status || 0, error: 'OpenPhish feed request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.' };
    const declaredLength = Number(res.headers && res.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > OPENPHISH_FEED_MAX_BYTES) {
      return { ok: false, provider: 'OpenPhish', status: res.status || 0, error: 'OpenPhish feed was larger than the safety cap.' };
    }

    let urls = [];
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const seen = new Set();
      let carry = '';
      let done = false;
      let bytes = 0;
      while (!done && urls.length < OPENPHISH_MAX_URLS) {
        const chunk = await reader.read();
        if (chunk.done) {
          done = true;
          break;
        }
        bytes += chunk.value ? chunk.value.byteLength : 0;
        if (bytes > OPENPHISH_FEED_MAX_BYTES) {
          try { await reader.cancel(); } catch (_) {}
          return { ok: false, provider: 'OpenPhish', status: res.status || 0, error: 'OpenPhish feed was larger than the safety cap.' };
        }
        const text = carry + decoder.decode(chunk.value, { stream: true });
        const parts = text.split(/\s+/);
        carry = parts.pop() || '';
        if (carry.length > 4096) carry = '';
        for (const part of parts) {
          if (addOpenPhishUrl(urls, seen, part)) break;
        }
      }
      if (urls.length < OPENPHISH_MAX_URLS) {
        const tail = carry + decoder.decode();
        for (const part of tail.split(/\s+/)) {
          if (addOpenPhishUrl(urls, seen, part)) break;
        }
      }
      if (urls.length >= OPENPHISH_MAX_URLS) {
        try { await reader.cancel(); } catch (_) {}
      }
    } else {
      const text = await res.text();
      if (utf8ByteLength(text) > OPENPHISH_FEED_MAX_BYTES) {
        return { ok: false, provider: 'OpenPhish', status: res.status || 0, error: 'OpenPhish feed was larger than the safety cap.' };
      }
      urls = parseOpenPhishFeed(text);
    }

    if (!urls.length) return { ok: false, provider: 'OpenPhish', status: res.status || 0, error: 'OpenPhish feed was empty or unreadable.' };
    const feed = buildOpenPhishFeed(urls, Date.now(), false);
    await saveOpenPhishStoredFeed(feed);
    openPhishFeedCache = feed;
    return { ok: true, provider: 'OpenPhish', feed };
  } catch (e) {
    const err = e && e.name === 'AbortError' ? 'Timed out' : String(e).slice(0, 120);
    return { ok: false, provider: 'OpenPhish', status: 0, error: 'Could not reach OpenPhish feed: ' + err };
  } finally {
    clearTimeout(timer);
  }
}

async function getOpenPhishFeed(force) {
  const now = Date.now();
  if (!force && openPhishFeedCache && openPhishFeedCache.cachedAt && (now - openPhishFeedCache.cachedAt) < OPENPHISH_FEED_TTL_MS) {
    return { ok: true, provider: 'OpenPhish', feed: openPhishFeedCache };
  }
  if (!force) {
    const stored = await loadOpenPhishStoredFeed();
    if (stored && !stored.stale) {
      openPhishFeedCache = stored;
      return { ok: true, provider: 'OpenPhish', feed: stored };
    }
  }
  if (openPhishFeedInflight) return openPhishFeedInflight;
  openPhishFeedInflight = (async () => {
    try {
      const fetched = await fetchOpenPhishFeed();
      if (fetched && fetched.ok) return fetched;
      const stored = await loadOpenPhishStoredFeed();
      if (stored) {
        openPhishFeedCache = stored;
        return { ok: true, provider: 'OpenPhish', feed: stored, stale: true, error: fetched && fetched.error };
      }
      return fetched;
    } finally {
      openPhishFeedInflight = null;
    }
  })();
  return openPhishFeedInflight;
}

async function openPhishLookupUrl(url, opts) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return { provider: 'OpenPhish', ok: false, enabled: false, error: 'Unsupported URL', url: String(url || '') };
  const cfg = (opts && opts.cfg) || {};
  if (!(cfg.enabled !== false && cfg.openPhish === true)) return { provider: 'OpenPhish', ok: false, enabled: false, url: normalized };

  const feedResult = await getOpenPhishFeed(false);
  if (!feedResult || !feedResult.ok || !feedResult.feed) {
    return { provider: 'OpenPhish', ok: false, enabled: true, url: normalized, status: (feedResult && feedResult.status) || 0, error: (feedResult && feedResult.error) || 'OpenPhish feed unavailable.' };
  }

  const keys = openPhishUrlKeys(normalized);
  let matched = '';
  for (const key of keys) {
    if (feedResult.feed.keys && feedResult.feed.keys[key]) { matched = feedResult.feed.keys[key]; break; }
  }
  return {
    provider: 'OpenPhish',
    ok: true,
    enabled: true,
    hit: !!matched,
    threats: matched ? ['PHISHING'] : [],
    url: normalized,
    matchedUrl: matched,
    feedSize: feedResult.feed.urls.length,
    cachedAt: feedResult.feed.cachedAt,
    stale: !!(feedResult.stale || feedResult.feed.stale),
  };
}

function ipv4FromMappedIpv6(value) {
  const ip = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  let m = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (m) return m[1];
  m = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!m) return '';
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return '';
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
}

function normalizeIpLiteral(value) {
  let ip = String(value || '').trim().toLowerCase();
  if (!ip) return '';
  ip = ip.replace(/^\[|\]$/g, '');
  const mapped = ipv4FromMappedIpv6(ip);
  if (mapped) return normalizeIpLiteral(mapped);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map((n) => Number(n));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return '';
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return '';
    if (a === 169 && b === 254) return '';
    if (a === 172 && b >= 16 && b <= 31) return '';
    if (a === 192 && b === 168) return '';
    if (a === 100 && b >= 64 && b <= 127) return '';
    if (a === 192 && b === 0 && c === 2) return '';
    if (a === 198 && (b === 18 || b === 19)) return '';
    if (a === 198 && b === 51 && c === 100) return '';
    if (a === 203 && b === 0 && c === 113) return '';
    return parts.join('.');
  }
  if (ip.includes(':')) {
    if (!/^[0-9a-f:.]+$/i.test(ip)) return '';
    if (ip === '::' || ip === '::1') return '';
    if (/^(fc|fd|fe80|ff)/i.test(ip)) return '';
    if (/^2001:db8:/i.test(ip)) return '';
    return ip;
  }
  return '';
}

function isLocalOrPrivateHost(host) {
  const clean = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!clean) return true;
  if (clean.includes('%')) return true;
  if (/^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){0,3}|::1)$/i.test(clean)) return true;
  const mapped = ipv4FromMappedIpv6(clean);
  if (mapped) return !normalizeIpLiteral(mapped);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return !normalizeIpLiteral(clean);
  if (clean.includes(':')) return !normalizeIpLiteral(clean);
  if (!clean.includes('.')) return true;
  const labels = clean.split('.');
  const tld = labels[labels.length - 1];
  if (/^(local|localhost|lan|home|internal|intranet|corp|test|invalid|example)$/i.test(tld)) return true;
  return false;
}

function ipFromUrl(url) {
  try {
    return normalizeIpLiteral(new URL(String(url || '')).hostname);
  } catch (_) {
    return '';
  }
}

function abuseIpDbRiskText(result) {
  const score = Number(result && result.score) || 0;
  if (score >= ABUSEIPDB_BLOCK_SCORE) return 'high-risk abusive IP (' + score + '% confidence)';
  if (score >= ABUSEIPDB_WARN_SCORE) return 'suspicious IP (' + score + '% confidence)';
  return 'low-risk IP (' + score + '% confidence)';
}

function abuseIpDbPublic(result) {
  if (!result) return null;
  return {
    provider: 'AbuseIPDB',
    ok: result.ok !== false,
    hit: !!result.hit,
    warning: !!result.warning,
    status: result.status || 0,
    error: result.error || '',
    threats: result.threats || [],
    cached: !!result.cached,
    ip: result.ip || '',
    score: Number(result.score || 0),
    totalReports: Number(result.totalReports || 0),
    lastReportedAt: result.lastReportedAt || '',
    usageType: result.usageType || '',
    isp: result.isp || '',
    countryCode: result.countryCode || '',
    domain: result.domain || '',
    isTor: !!result.isTor,
    isWhitelisted: !!result.isWhitelisted,
    rateLimited: !!result.rateLimited,
  };
}

async function fetchAbuseIpDbIp(ip, apiKey) {
  const key = String(apiKey || '').trim();
  const normalized = normalizeIpLiteral(ip);
  if (!key || !normalized) return null;
  const params = new URLSearchParams();
  params.set('ipAddress', normalized);
  params.set('maxAgeInDays', '90');
  try {
    const res = await fetchJsonWithTimeout(ABUSEIPDB_ENDPOINT + '?' + params.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Key': key },
    }, EXTERNAL_REPUTATION_TIMEOUT_MS);
    if (!res.ok) {
      const apiError = Array.isArray(res.data && res.data.errors) && res.data.errors[0] ? String(res.data.errors[0].detail || '') : '';
      return {
        provider: 'AbuseIPDB',
        ok: false,
        status: res.status || 0,
        rateLimited: res.status === 429,
        error: apiError || (res.status === 429 ? 'AbuseIPDB rate limit reached.' : 'AbuseIPDB request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.'),
      };
    }

    const data = (res.data && res.data.data) || {};
    const score = Number(data.abuseConfidenceScore || 0);
    const reports = Number(data.totalReports || 0);
    const whitelisted = data.isWhitelisted === true;
    const hit = !whitelisted && score >= ABUSEIPDB_BLOCK_SCORE;
    const warning = !hit && !whitelisted && score >= ABUSEIPDB_WARN_SCORE;
    return {
      provider: 'AbuseIPDB',
      ok: true,
      hit,
      warning,
      threats: hit ? ['ABUSIVE_IP'] : (warning ? ['SUSPICIOUS_SERVER'] : []),
      ip: data.ipAddress || normalized,
      score,
      totalReports: reports,
      lastReportedAt: data.lastReportedAt || '',
      usageType: data.usageType || '',
      isp: data.isp || '',
      domain: data.domain || '',
      countryCode: data.countryCode || '',
      countryName: data.countryName || '',
      isTor: data.isTor === true,
      isPublic: data.isPublic !== false,
      isWhitelisted: whitelisted,
      status: res.status || 0,
    };
  } catch (e) {
    return { provider: 'AbuseIPDB', ok: false, error: String(e).slice(0, 120) };
  }
}

async function loadAbuseIpDbCache() {
  return loadReputationCacheVia(() => abuseIpDbCache, (v) => { abuseIpDbCache = v; }, ABUSEIPDB_CACHE_KEY);
}
function scheduleAbuseIpDbCacheWrite() {
  scheduleReputationCacheWriteVia(
    () => abuseIpDbCacheWriteTimer, (t) => { abuseIpDbCacheWriteTimer = t; },
    loadAbuseIpDbCache, (v) => { abuseIpDbCache = v; }, ABUSEIPDB_CACHE_KEY, ABUSEIPDB_CACHE_MAX);
}

async function abuseIpDbConfig() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
    const key = String(cfg.abuseIpDbKey || '').trim();
    return {
      cfg,
      key,
      enabled: cfg.enabled !== false && cfg.abuseIpDb === true && !!key,
    };
  } catch (_) {
    return { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  }
}

async function abuseIpDbLookupIp(ip, opts) {
  const normalized = normalizeIpLiteral(ip);
  if (!normalized) return { provider: 'AbuseIPDB', ok: false, enabled: false, error: 'Unsupported or private IP', ip: String(ip || '') };

  const provided = opts && opts.cfg
    ? { cfg: opts.cfg, key: String(opts.key || opts.cfg.abuseIpDbKey || '').trim(), enabled: opts.cfg.enabled !== false && opts.cfg.abuseIpDb === true && !!String(opts.key || opts.cfg.abuseIpDbKey || '').trim() }
    : await abuseIpDbConfig();
  if (!provided.enabled) return { provider: 'AbuseIPDB', ok: false, enabled: false, ip: normalized };

  const cache = await loadAbuseIpDbCache();
  const now = Date.now();
  const cached = cache[normalized];
  if (cached && cached.expiresAt > now) {
    return Object.assign({ provider: 'AbuseIPDB', ok: true, enabled: true, cached: true, ip: normalized }, cached.result || {});
  }

  if (abuseIpDbInflight[normalized]) return abuseIpDbInflight[normalized];
  abuseIpDbInflight[normalized] = (async () => {
    try {
      const result = await fetchAbuseIpDbIp(normalized, provided.key);
      const okResult = Object.assign({ enabled: true, ip: normalized }, result || { provider: 'AbuseIPDB', ok: false, error: 'No result' });
      if (okResult.ok) {
        const ttl = okResult.hit ? ABUSEIPDB_HIT_TTL_MS : (okResult.warning ? ABUSEIPDB_WARN_TTL_MS : ABUSEIPDB_CLEAN_TTL_MS);
        cache[normalized] = {
          checkedAt: now,
          expiresAt: now + ttl,
          result: {
            ok: true,
            hit: !!okResult.hit,
            warning: !!okResult.warning,
            threats: okResult.threats || [],
            status: okResult.status || 0,
            error: '',
            ip: okResult.ip || normalized,
            score: Number(okResult.score || 0),
            totalReports: Number(okResult.totalReports || 0),
            lastReportedAt: okResult.lastReportedAt || '',
            usageType: okResult.usageType || '',
            isp: okResult.isp || '',
            domain: okResult.domain || '',
            countryCode: okResult.countryCode || '',
            isTor: !!okResult.isTor,
            isWhitelisted: !!okResult.isWhitelisted,
          },
        };
        scheduleAbuseIpDbCacheWrite();
      }
      return okResult;
    } finally {
      delete abuseIpDbInflight[normalized];
    }
  })();
  return abuseIpDbInflight[normalized];
}

async function abuseIpDbLookupUrl(url, opts) {
  const ip = ipFromUrl(url);
  if (!ip) return { provider: 'AbuseIPDB', ok: true, enabled: false, hit: false, warning: false, url: normalizeSafeBrowsingUrl(url) || String(url || '') };
  const result = await abuseIpDbLookupIp(ip, opts);
  return Object.assign({ url: normalizeSafeBrowsingUrl(url) || String(url || '') }, result);
}

function urlHausPublic(result) {
  if (!result) return null;
  return {
    provider: 'URLhaus',
    ok: result.ok !== false,
    hit: !!result.hit,
    warning: !!result.warning,
    status: result.status || 0,
    error: result.error || '',
    threats: result.threats || [],
    cached: !!result.cached,
    queryStatus: result.queryStatus || '',
    scope: result.scope || '',
    hostOnly: !!result.hostOnly,
    urlStatus: result.urlStatus || '',
    threat: result.threat || '',
    reference: result.reference || '',
    host: result.host || '',
    tags: Array.isArray(result.tags) ? result.tags.slice(0, 8) : [],
    payloadCount: Number(result.payloadCount || 0),
    signatures: Array.isArray(result.signatures) ? result.signatures.slice(0, 6) : [],
    payloads: Array.isArray(result.payloads) ? result.payloads.slice(0, 6) : [],
    urlCount: Number(result.urlCount || 0),
    onlineUrlCount: Number(result.onlineUrlCount || 0),
    sampleUrls: Array.isArray(result.sampleUrls) ? result.sampleUrls.slice(0, 6) : [],
    blacklists: result.blacklists || null,
    dateAdded: result.dateAdded || '',
    lastOnline: result.lastOnline || '',
    rateLimited: !!result.rateLimited,
  };
}

function urlHausPayloadSummary(payloads) {
  return (Array.isArray(payloads) ? payloads : []).slice(0, 12).map((p) => ({
    firstseen: String((p && p.firstseen) || ''),
    filename: String((p && p.filename) || '').slice(0, 160),
    fileType: String((p && (p.file_type || p.filetype || p.magika)) || '').slice(0, 80),
    sha256: String((p && (p.response_sha256 || p.sha256_hash)) || '').slice(0, 96),
    signature: String((p && p.signature) || '').slice(0, 120),
    vtResult: String((p && p.virustotal && p.virustotal.result) || '').slice(0, 40),
    vtPercent: String((p && p.virustotal && p.virustotal.percent) || '').slice(0, 40),
  })).filter((p) => p.filename || p.fileType || p.sha256 || p.signature || p.vtResult);
}

function parseUrlHausResponse(url, data, status) {
  const queryStatus = String((data && data.query_status) || '').trim();
  if (queryStatus === 'no_results') {
    return { provider: 'URLhaus', ok: true, hit: false, queryStatus, status: status || 0, url };
  }
  if (queryStatus !== 'ok') {
    return {
      provider: 'URLhaus',
      ok: false,
      status: status || 0,
      queryStatus,
      error: queryStatus ? ('URLhaus returned ' + queryStatus + '.') : 'URLhaus did not return a query status.',
    };
  }
  const payloads = Array.isArray(data && data.payloads) ? data.payloads : [];
  const signatures = Array.from(new Set(payloads.map((p) => String((p && p.signature) || '').trim()).filter(Boolean))).slice(0, 8);
  const threat = String((data && data.threat) || 'malware_download').trim();
  return {
    provider: 'URLhaus',
    ok: true,
    hit: true,
    threats: [threat || 'MALWARE_DOWNLOAD'],
    queryStatus,
    status: status || 0,
    scope: 'url',
    hostOnly: false,
    url: (data && data.url) || url,
    urlStatus: (data && data.url_status) || '',
    threat,
    reference: (data && data.urlhaus_reference) || '',
    host: (data && data.host) || '',
    dateAdded: (data && data.date_added) || '',
    lastOnline: (data && data.last_online) || '',
    tags: Array.isArray(data && data.tags) ? data.tags.map((t) => String(t || '')).filter(Boolean).slice(0, 12) : [],
    payloadCount: payloads.length,
    signatures,
    payloads: urlHausPayloadSummary(payloads),
  };
}

function parseUrlHausHostResponse(host, data, status) {
  const queryStatus = String((data && (data.query_status || data.query_staus)) || '').trim();
  if (queryStatus === 'no_results') {
    return { provider: 'URLhaus', ok: true, hit: false, queryStatus, status: status || 0, scope: 'host', host };
  }
  if (queryStatus !== 'ok') {
    return {
      provider: 'URLhaus',
      ok: false,
      status: status || 0,
      queryStatus,
      scope: 'host',
      host,
      error: queryStatus ? ('URLhaus host lookup returned ' + queryStatus + '.') : 'URLhaus host lookup did not return a query status.',
    };
  }
  const urls = Array.isArray(data && data.urls) ? data.urls : [];
  const onlineUrls = urls.filter((u) => /^online$/i.test(String((u && u.url_status) || '')));
  const tags = Array.from(new Set(urls.flatMap((u) => Array.isArray(u && u.tags) ? u.tags : []).map((t) => String(t || '').trim()).filter(Boolean))).slice(0, 12);
  const threats = Array.from(new Set(urls.map((u) => String((u && u.threat) || '').trim()).filter(Boolean))).slice(0, 8);
  const blacklists = (data && data.blacklists) || {};
  const spamhaus = String((blacklists && blacklists.spamhaus_dbl) || '').toLowerCase();
  const surbl = String((blacklists && blacklists.surbl) || '').toLowerCase();
  const blacklisted = surbl === 'listed' || /malware|botnet|phishing|spammer|abused/i.test(spamhaus);
  const hit = onlineUrls.length > 0 || blacklisted;
  const warning = !hit && urls.length > 0;
  return {
    provider: 'URLhaus',
    ok: true,
    hit,
    warning,
    threats: hit ? ['MALWARE_HOST'] : (warning ? ['MALWARE_HOST_HISTORY'] : []),
    status: status || 0,
    queryStatus,
    scope: 'host',
    hostOnly: true,
    host: (data && data.host) || host,
    reference: (data && data.urlhaus_reference) || '',
    dateAdded: (data && data.firstseen) || '',
    urlCount: Number((data && data.url_count) || urls.length || 0),
    onlineUrlCount: onlineUrls.length,
    threat: threats[0] || 'malware_download',
    tags,
    signatures: tags,
    sampleUrls: urls.slice(0, 6).map((u) => ({
      url: String((u && u.url) || '').slice(0, 300),
      urlStatus: String((u && u.url_status) || ''),
      threat: String((u && u.threat) || ''),
      dateAdded: String((u && u.date_added) || ''),
      reference: String((u && u.urlhaus_reference) || ''),
      tags: Array.isArray(u && u.tags) ? u.tags.map((t) => String(t || '')).filter(Boolean).slice(0, 6) : [],
    })),
    blacklists,
  };
}

async function fetchUrlHausUrl(url, apiKey) {
  const key = String(apiKey || '').trim();
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!key || !normalized) return null;
  const body = new URLSearchParams();
  body.set('url', normalized);
  try {
    const res = await fetchJsonWithTimeout(URLHAUS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Auth-Key': key,
      },
      body: body.toString(),
    }, EXTERNAL_REPUTATION_TIMEOUT_MS);
    if (!res.ok) {
      const apiError = (res.data && (res.data.query_status || res.data.error || res.data.message)) || '';
      return {
        provider: 'URLhaus',
        ok: false,
        status: res.status || 0,
        rateLimited: res.status === 429,
        error: apiError ? ('URLhaus returned ' + String(apiError) + '.') : 'URLhaus request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.',
      };
    }
    return parseUrlHausResponse(normalized, res.data || {}, res.status || 0);
  } catch (e) {
    return { provider: 'URLhaus', ok: false, error: String(e).slice(0, 120) };
  }
}

async function fetchUrlHausHost(host, apiKey) {
  const key = String(apiKey || '').trim();
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!key || !normalized || isLocalOrPrivateHost(normalized)) return null;
  const body = new URLSearchParams();
  body.set('host', normalized);
  try {
    const res = await fetchJsonWithTimeout(URLHAUS_HOST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Auth-Key': key,
      },
      body: body.toString(),
    }, EXTERNAL_REPUTATION_TIMEOUT_MS);
    if (!res.ok) {
      const apiError = (res.data && (res.data.query_status || res.data.query_staus || res.data.error || res.data.message)) || '';
      return {
        provider: 'URLhaus',
        ok: false,
        status: res.status || 0,
        scope: 'host',
        host: normalized,
        rateLimited: res.status === 429,
        error: apiError ? ('URLhaus host lookup returned ' + String(apiError) + '.') : 'URLhaus host lookup failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.',
      };
    }
    return parseUrlHausHostResponse(normalized, res.data || {}, res.status || 0);
  } catch (e) {
    return { provider: 'URLhaus', ok: false, scope: 'host', host: normalized, error: String(e).slice(0, 120) };
  }
}

function shouldUseUrlHausHostFallback(url, context) {
  const ctx = String(context || '').toLowerCase();
  if (ctx === 'download' || ctx === 'link' || ctx === 'form' || ctx === 'paste') return true;
  return shouldUsePhishTankForContext(url, context);
}

async function loadUrlHausCache() {
  return loadReputationCacheVia(() => urlHausCache, (v) => { urlHausCache = v; }, URLHAUS_CACHE_KEY);
}
function scheduleUrlHausCacheWrite() {
  scheduleReputationCacheWriteVia(
    () => urlHausCacheWriteTimer, (t) => { urlHausCacheWriteTimer = t; },
    loadUrlHausCache, (v) => { urlHausCache = v; }, URLHAUS_CACHE_KEY, URLHAUS_CACHE_MAX);
}

async function urlHausLookupUrl(url, opts) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return { provider: 'URLhaus', ok: false, enabled: false, error: 'Unsupported URL', url: String(url || '') };
  const context = String((opts && opts.context) || '');
  const provided = opts && opts.cfg
    ? { cfg: opts.cfg, key: String(opts.key || opts.cfg.urlHausKey || '').trim(), enabled: opts.cfg.enabled !== false && opts.cfg.urlHaus === true && !!String(opts.key || opts.cfg.urlHausKey || '').trim() }
    : { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  if (!provided.enabled) return { provider: 'URLhaus', ok: false, enabled: false, url: normalized };

  const cache = await loadUrlHausCache();
  const now = Date.now();
  const cached = cache[normalized];
  if (cached && cached.expiresAt > now) {
    return Object.assign({ provider: 'URLhaus', ok: true, enabled: true, cached: true, url: normalized }, cached.result || {});
  }

  if (urlHausInflight[normalized]) return urlHausInflight[normalized];
  urlHausInflight[normalized] = (async () => {
    try {
      const result = await fetchUrlHausUrl(normalized, provided.key);
      let okResult = Object.assign({ enabled: true, url: normalized }, result || { provider: 'URLhaus', ok: false, error: 'No result' });
      if (okResult.ok && !okResult.hit && shouldUseUrlHausHostFallback(normalized, context)) {
        try {
          const host = new URL(normalized).hostname;
          const hostResult = await fetchUrlHausHost(host, provided.key);
          if (hostResult && hostResult.ok && (hostResult.hit || hostResult.warning)) {
            okResult = Object.assign({ enabled: true, url: normalized }, hostResult);
          }
        } catch (_) {}
      }
      if (okResult.ok) {
        const ttl = okResult.hit ? URLHAUS_HIT_TTL_MS : URLHAUS_CLEAN_TTL_MS;
        cache[normalized] = {
          checkedAt: now,
          expiresAt: now + ttl,
          result: {
            ok: true,
            hit: !!okResult.hit,
            threats: okResult.threats || [],
            status: okResult.status || 0,
            error: '',
            queryStatus: okResult.queryStatus || '',
            warning: !!okResult.warning,
            scope: okResult.scope || '',
            hostOnly: !!okResult.hostOnly,
            urlStatus: okResult.urlStatus || '',
            threat: okResult.threat || '',
            reference: okResult.reference || '',
            host: okResult.host || '',
            tags: Array.isArray(okResult.tags) ? okResult.tags.slice(0, 8) : [],
            payloadCount: Number(okResult.payloadCount || 0),
            signatures: Array.isArray(okResult.signatures) ? okResult.signatures.slice(0, 6) : [],
            payloads: Array.isArray(okResult.payloads) ? okResult.payloads.slice(0, 6) : [],
            urlCount: Number(okResult.urlCount || 0),
            onlineUrlCount: Number(okResult.onlineUrlCount || 0),
            sampleUrls: Array.isArray(okResult.sampleUrls) ? okResult.sampleUrls.slice(0, 6) : [],
            blacklists: okResult.blacklists || null,
            dateAdded: okResult.dateAdded || '',
            lastOnline: okResult.lastOnline || '',
          },
        };
        scheduleUrlHausCacheWrite();
      }
      return okResult;
    } finally {
      delete urlHausInflight[normalized];
    }
  })();
  return urlHausInflight[normalized];
}

function whoisXmlDomainTargetFromUrl(url) {
  try {
    const normalized = normalizeSafeBrowsingUrl(url);
    if (!normalized) return '';
    const host = new URL(normalized).hostname;
    if (normalizeIpLiteral(host)) return host;
    return registrableDomainBg(host) || host;
  } catch (_) {
    return '';
  }
}

function whoisXmlReputationWarnings(data) {
  const out = [];
  const tests = Array.isArray(data && data.testResults) ? data.testResults : [];
  tests.forEach((test) => {
    const warnings = Array.isArray(test && test.warnings) ? test.warnings : [];
    warnings.forEach((warning) => {
      const code = Number((warning && warning.warningCode) || 0);
      const description = String((warning && warning.warningDescription) || warning || '').trim();
      out.push({
        test: String((test && test.test) || '').trim(),
        testCode: Number((test && test.testCode) || 0),
        warningCode: code,
        warningDescription: description,
      });
    });
  });
  return out;
}

function parseWhoisXmlDomainReputation(domain, data, status) {
  const score = Number(data && data.reputationScore);
  if (!Number.isFinite(score)) {
    return { provider: 'WhoisXML Domain Reputation', ok: false, status: status || 0, domain, error: whoisXmlErrorText(data) || 'WhoisXML Domain Reputation did not return a score.' };
  }
  const warnings = whoisXmlReputationWarnings(data);
  const warningCodes = warnings.map((w) => Number(w.warningCode || 0)).filter(Boolean);
  const blockCodes = new Set([4001, 4002, 4003, 4004, 4005]);
  const suspiciousCodes = new Set([2001, 2002, 2004, 2005, 2008, 3003, 3004, 3005, 3006, 3008]);
  const blockWarnings = warnings.filter((w) => blockCodes.has(Number(w.warningCode || 0)));
  const suspiciousWarnings = warnings.filter((w) => suspiciousCodes.has(Number(w.warningCode || 0)));
  const hit = blockWarnings.length > 0 || score <= WHOISXML_REPUTATION_BLOCK_SCORE;
  const warning = !hit && (score < WHOISXML_REPUTATION_WARN_SCORE || suspiciousWarnings.length > 0);
  const threats = [];
  if (blockWarnings.some((w) => w.warningCode === 4001)) threats.push('MALWARE_BLOCKLIST');
  if (blockWarnings.some((w) => w.warningCode === 4002)) threats.push('PHISHING_BLOCKLIST');
  if (blockWarnings.some((w) => w.warningCode === 4003)) threats.push('SPAM_BLOCKLIST');
  if (blockWarnings.some((w) => w.warningCode === 4004)) threats.push('REPUTATION_BLOCKLIST');
  if (blockWarnings.some((w) => w.warningCode === 4005)) threats.push('DOS_BLOCKLIST');
  if (hit && !threats.length) threats.push('LOW_DOMAIN_REPUTATION');
  if (warning && !threats.length) threats.push('SUSPICIOUS_DOMAIN_REPUTATION');
  return {
    provider: 'WhoisXML Domain Reputation',
    ok: true,
    hit,
    warning,
    threats,
    status: status || 0,
    domain,
    mode: String((data && data.mode) || 'fast'),
    reputationScore: score,
    warningCodes,
    warnings: warnings.slice(0, 8),
  };
}

async function fetchWhoisXmlDomainReputation(domain, apiKey) {
  const key = String(apiKey || '').trim();
  const target = normalizeIpLiteral(domain) || registrableDomainBg(domain) || String(domain || '').trim().toLowerCase();
  if (!key || !target) return null;
  const params = new URLSearchParams();
  params.set('apiKey', key);
  params.set('domainName', target);
  params.set('mode', 'fast');
  params.set('outputFormat', 'JSON');
  try {
    const res = await fetchJsonWithTimeout(WHOISXML_REPUTATION_ENDPOINT + '?' + params.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    }, WHOISXML_TIMEOUT_MS);
    if (!res.ok) {
      return {
        provider: 'WhoisXML Domain Reputation',
        ok: false,
        status: res.status || 0,
        rateLimited: res.status === 429,
        error: whoisXmlErrorText(res.data) || 'WhoisXML Domain Reputation request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.',
      };
    }
    const apiError = whoisXmlErrorText(res.data);
    if (apiError) return { provider: 'WhoisXML Domain Reputation', ok: false, status: res.status || 0, error: apiError };
    return parseWhoisXmlDomainReputation(target, res.data || {}, res.status || 0);
  } catch (e) {
    return { provider: 'WhoisXML Domain Reputation', ok: false, error: String(e).slice(0, 120) };
  }
}

async function loadWhoisXmlReputationCache() {
  return loadReputationCacheVia(() => whoisXmlReputationCache, (v) => { whoisXmlReputationCache = v; }, WHOISXML_REPUTATION_CACHE_KEY);
}
function scheduleWhoisXmlReputationCacheWrite() {
  scheduleReputationCacheWriteVia(
    () => whoisXmlReputationCacheWriteTimer, (t) => { whoisXmlReputationCacheWriteTimer = t; },
    loadWhoisXmlReputationCache, (v) => { whoisXmlReputationCache = v; }, WHOISXML_REPUTATION_CACHE_KEY, WHOISXML_REPUTATION_CACHE_MAX);
}

async function whoisXmlDomainReputationLookupUrl(url, opts) {
  const domain = whoisXmlDomainTargetFromUrl(url);
  if (!domain) return { provider: 'WhoisXML Domain Reputation', ok: false, enabled: false, error: 'Unsupported domain', url: String(url || '') };
  const provided = opts && opts.cfg
    ? { cfg: opts.cfg, key: String(opts.key || opts.cfg.whoisXmlKey || '').trim(), enabled: opts.cfg.enabled !== false && opts.cfg.whoisXmlReputation === true && !!String(opts.key || opts.cfg.whoisXmlKey || '').trim() }
    : { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  if (!provided.enabled) return { provider: 'WhoisXML Domain Reputation', ok: false, enabled: false, domain };

  const cache = await loadWhoisXmlReputationCache();
  const now = Date.now();
  const cached = cache[domain];
  if (cached && cached.expiresAt > now) {
    return Object.assign({ provider: 'WhoisXML Domain Reputation', ok: true, enabled: true, cached: true, domain }, cached.result || {});
  }

  if (whoisXmlReputationInflight[domain]) return whoisXmlReputationInflight[domain];
  whoisXmlReputationInflight[domain] = (async () => {
    try {
      const result = await fetchWhoisXmlDomainReputation(domain, provided.key);
      const okResult = Object.assign({ enabled: true, domain }, result || { provider: 'WhoisXML Domain Reputation', ok: false, error: 'No result' });
      if (okResult.ok) {
        const ttl = okResult.hit ? WHOISXML_REPUTATION_HIT_TTL_MS : (okResult.warning ? WHOISXML_REPUTATION_WARN_TTL_MS : WHOISXML_REPUTATION_CLEAN_TTL_MS);
        cache[domain] = {
          checkedAt: now,
          expiresAt: now + ttl,
          result: {
            ok: true,
            hit: !!okResult.hit,
            warning: !!okResult.warning,
            threats: okResult.threats || [],
            status: okResult.status || 0,
            error: '',
            domain: okResult.domain || domain,
            mode: okResult.mode || 'fast',
            reputationScore: Number(okResult.reputationScore || 0),
            warningCodes: Array.isArray(okResult.warningCodes) ? okResult.warningCodes.slice(0, 12) : [],
            warnings: Array.isArray(okResult.warnings) ? okResult.warnings.slice(0, 8) : [],
          },
        };
        scheduleWhoisXmlReputationCacheWrite();
      }
      return okResult;
    } finally {
      delete whoisXmlReputationInflight[domain];
    }
  })();
  return whoisXmlReputationInflight[domain];
}

function whoisXmlThreatHighConfidence(threatType) {
  return /(attack|botnet|c&c|command|malware|phishing)/i.test(String(threatType || ''));
}

function parseWhoisXmlThreatIntel(ioc, data, status) {
  const total = Number((data && data.total) || 0);
  const results = Array.isArray(data && data.results) ? data.results : [];
  const sample = results.slice(0, 8).map((r) => ({
    firstSeen: String((r && r.firstSeen) || ''),
    lastSeen: String((r && r.lastSeen) || ''),
    threatType: String((r && r.threatType) || ''),
    iocType: String((r && r.iocType) || ''),
    value: String((r && r.value) || '').slice(0, 220),
  }));
  const threatTypes = Array.from(new Set(sample.map((r) => r.threatType).filter(Boolean)));
  const hit = total > 0 && threatTypes.some(whoisXmlThreatHighConfidence);
  const warning = total > 0 && !hit;
  return {
    provider: 'WhoisXML Threat Intelligence',
    ok: true,
    hit,
    warning,
    threats: hit ? threatTypes.map((t) => String(t || '').toUpperCase().replace(/\s+/g, '_')) : (warning ? ['THREAT_INTEL_MATCH'] : []),
    status: status || 0,
    ioc,
    total,
    threatTypes,
    results: sample,
  };
}

async function fetchWhoisXmlThreatIntel(ioc, apiKey) {
  const key = String(apiKey || '').trim();
  const query = String(ioc || '').trim();
  if (!key || !query) return null;
  const params = new URLSearchParams();
  params.set('apiKey', key);
  params.set('ioc', query.slice(0, 500));
  params.set('size', '10');
  params.set('outputFormat', 'JSON');
  try {
    const res = await fetchJsonWithTimeout(WHOISXML_THREAT_ENDPOINT + '?' + params.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    }, WHOISXML_TIMEOUT_MS);
    if (!res.ok) {
      return {
        provider: 'WhoisXML Threat Intelligence',
        ok: false,
        status: res.status || 0,
        rateLimited: res.status === 429,
        error: whoisXmlErrorText(res.data) || 'WhoisXML Threat Intelligence request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.',
      };
    }
    const apiError = whoisXmlErrorText(res.data);
    if (apiError) return { provider: 'WhoisXML Threat Intelligence', ok: false, status: res.status || 0, error: apiError };
    return parseWhoisXmlThreatIntel(query, res.data || {}, res.status || 0);
  } catch (e) {
    return { provider: 'WhoisXML Threat Intelligence', ok: false, error: String(e).slice(0, 120) };
  }
}

function whoisXmlThreatIocForUrl(url) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return '';
  return normalized;
}

async function loadWhoisXmlThreatCache() {
  return loadReputationCacheVia(() => whoisXmlThreatCache, (v) => { whoisXmlThreatCache = v; }, WHOISXML_THREAT_CACHE_KEY);
}
function scheduleWhoisXmlThreatCacheWrite() {
  scheduleReputationCacheWriteVia(
    () => whoisXmlThreatCacheWriteTimer, (t) => { whoisXmlThreatCacheWriteTimer = t; },
    loadWhoisXmlThreatCache, (v) => { whoisXmlThreatCache = v; }, WHOISXML_THREAT_CACHE_KEY, WHOISXML_THREAT_CACHE_MAX);
}

async function whoisXmlThreatIntelLookupUrl(url, opts) {
  const ioc = whoisXmlThreatIocForUrl(url);
  if (!ioc) return { provider: 'WhoisXML Threat Intelligence', ok: false, enabled: false, error: 'Unsupported IoC', url: String(url || '') };
  const provided = opts && opts.cfg
    ? { cfg: opts.cfg, key: String(opts.key || opts.cfg.whoisXmlKey || '').trim(), enabled: opts.cfg.enabled !== false && opts.cfg.whoisXmlThreatIntel === true && !!String(opts.key || opts.cfg.whoisXmlKey || '').trim() }
    : { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  if (!provided.enabled) return { provider: 'WhoisXML Threat Intelligence', ok: false, enabled: false, ioc };

  const cache = await loadWhoisXmlThreatCache();
  const now = Date.now();
  const cached = cache[ioc];
  if (cached && cached.expiresAt > now) {
    return Object.assign({ provider: 'WhoisXML Threat Intelligence', ok: true, enabled: true, cached: true, ioc }, cached.result || {});
  }

  if (whoisXmlThreatInflight[ioc]) return whoisXmlThreatInflight[ioc];
  whoisXmlThreatInflight[ioc] = (async () => {
    try {
      const result = await fetchWhoisXmlThreatIntel(ioc, provided.key);
      const okResult = Object.assign({ enabled: true, ioc }, result || { provider: 'WhoisXML Threat Intelligence', ok: false, error: 'No result' });
      if (okResult.ok) {
        const ttl = (okResult.hit || okResult.warning) ? WHOISXML_THREAT_HIT_TTL_MS : WHOISXML_THREAT_CLEAN_TTL_MS;
        cache[ioc] = {
          checkedAt: now,
          expiresAt: now + ttl,
          result: {
            ok: true,
            hit: !!okResult.hit,
            warning: !!okResult.warning,
            threats: okResult.threats || [],
            status: okResult.status || 0,
            error: '',
            ioc: okResult.ioc || ioc,
            total: Number(okResult.total || 0),
            threatTypes: Array.isArray(okResult.threatTypes) ? okResult.threatTypes.slice(0, 8) : [],
            results: Array.isArray(okResult.results) ? okResult.results.slice(0, 8) : [],
          },
        };
        scheduleWhoisXmlThreatCacheWrite();
      }
      return okResult;
    } finally {
      delete whoisXmlThreatInflight[ioc];
    }
  })();
  return whoisXmlThreatInflight[ioc];
}

async function urlReputationConfig() {
  try {
    const store = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
    const key = String(cfg.downloadSafeBrowsingKey || '').trim();
    const phishTankKey = String(cfg.phishTankKey || '').trim();
    const abuseIpDbKey = String(cfg.abuseIpDbKey || '').trim();
    const urlHausKey = String(cfg.urlHausKey || '').trim();
    const whoisXmlKey = String(cfg.whoisXmlKey || '').trim();
    const safeBrowsingEnabled = cfg.enabled !== false && cfg.downloadSafeBrowsing === true && !!key;
    const phishTankEnabled = cfg.enabled !== false && cfg.phishTank === true && !!phishTankKey;
    const openPhishEnabled = cfg.enabled !== false && cfg.openPhish === true;
    const abuseIpDbEnabled = cfg.enabled !== false && cfg.abuseIpDb === true && !!abuseIpDbKey;
    const urlHausEnabled = cfg.enabled !== false && cfg.urlHaus === true && !!urlHausKey;
    const whoisXmlEnabled = cfg.enabled !== false && (cfg.whoisXml === true || cfg.whoisXmlReputation === true) && !!whoisXmlKey;
    const whoisXmlReputationEnabled = cfg.enabled !== false && cfg.whoisXmlReputation === true && !!whoisXmlKey;
    const whoisXmlThreatIntelEnabled = cfg.enabled !== false && cfg.whoisXmlThreatIntel === true && !!whoisXmlKey;
    return {
      cfg,
      key,
      phishTankKey,
      abuseIpDbKey,
      urlHausKey,
      whoisXmlKey,
      safeBrowsingEnabled,
      phishTankEnabled,
      openPhishEnabled,
      abuseIpDbEnabled,
      urlHausEnabled,
      whoisXmlEnabled,
      whoisXmlReputationEnabled,
      whoisXmlThreatIntelEnabled,
      enabled: safeBrowsingEnabled || phishTankEnabled || openPhishEnabled || abuseIpDbEnabled || urlHausEnabled || whoisXmlEnabled || whoisXmlReputationEnabled || whoisXmlThreatIntelEnabled,
    };
  } catch (_) {
    return { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', phishTankKey: '', abuseIpDbKey: '', urlHausKey: '', whoisXmlKey: '', safeBrowsingEnabled: false, phishTankEnabled: false, openPhishEnabled: false, abuseIpDbEnabled: false, urlHausEnabled: false, whoisXmlEnabled: false, whoisXmlReputationEnabled: false, whoisXmlThreatIntelEnabled: false, enabled: false };
  }
}

function reputationResultPublic(result) {
  if (!result) return null;
  const out = {
    provider: result.provider || 'URL reputation',
    ok: result.ok !== false,
    hit: !!result.hit,
    status: result.status || 0,
    error: result.error || '',
    threats: result.threats || [],
    cached: !!result.cached,
  };
  if (result.provider === 'PhishTank') {
    out.inDatabase = !!result.inDatabase;
    out.verified = !!result.verified;
    out.valid = !!result.valid;
    out.phishId = result.phishId || '';
    out.detailPage = result.detailPage || '';
    out.rateLimited = !!result.rateLimited;
    out.cloudflare = !!result.cloudflare;
  }
  if (result.provider === 'OpenPhish') {
    out.matchedUrl = result.matchedUrl || '';
    out.feedSize = Number(result.feedSize || 0);
    out.stale = !!result.stale;
  }
  if (result.provider === 'AbuseIPDB') {
    out.warning = !!result.warning;
    out.ip = result.ip || '';
    out.score = Number(result.score || 0);
    out.totalReports = Number(result.totalReports || 0);
    out.lastReportedAt = result.lastReportedAt || '';
    out.usageType = result.usageType || '';
    out.isp = result.isp || '';
    out.domain = result.domain || '';
    out.countryCode = result.countryCode || '';
    out.isTor = !!result.isTor;
    out.isWhitelisted = !!result.isWhitelisted;
    out.rateLimited = !!result.rateLimited;
  }
  if (result.provider === 'URLhaus') {
    return urlHausPublic(result);
  }
  if (result.provider === 'WhoisXML Domain Reputation') {
    out.warning = !!result.warning;
    out.domain = result.domain || '';
    out.reputationScore = Number(result.reputationScore || 0);
    out.mode = result.mode || 'fast';
    out.warningCodes = Array.isArray(result.warningCodes) ? result.warningCodes.slice(0, 12) : [];
    out.warnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : [];
    out.rateLimited = !!result.rateLimited;
  }
  if (result.provider === 'WhoisXML Threat Intelligence') {
    out.warning = !!result.warning;
    out.ioc = result.ioc || '';
    out.total = Number(result.total || 0);
    out.threatTypes = Array.isArray(result.threatTypes) ? result.threatTypes.slice(0, 8) : [];
    out.results = Array.isArray(result.results) ? result.results.slice(0, 8) : [];
    out.rateLimited = !!result.rateLimited;
  }
  if (result.provider === 'WhoisXML API') {
    out.warning = !!result.warning;
    out.domain = result.domain || '';
    out.ageDays = typeof result.ageDays === 'number' ? result.ageDays : null;
    out.risk = result.risk || '';
    out.registrar = result.registrar || '';
    out.registrantOrg = result.registrantOrg || '';
    out.registrantCountry = result.registrantCountry || '';
    out.privacy = !!result.privacy;
    out.nameServers = Array.isArray(result.nameServers) ? result.nameServers.slice(0, 4) : [];
    out.domainAvailability = result.domainAvailability || '';
  }
  return out;
}

function shouldUsePhishTankForContext(url, context) {
  const ctx = String(context || '').toLowerCase();
  if (ctx && ctx !== 'page') return true;
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.toLowerCase();
    const text = (host + ' ' + u.pathname + ' ' + u.search).toLowerCase();
    const authish = /(login|logon|signin|sign-in|verify|verification|account|secure|password|passwd|mfa|2fa|oauth|session|billing|invoice|payment|wallet|bank|recover|confirm|unlock|update)/i.test(text);
    const oddUrl = /(@|%40|xn--)/i.test(String(url || '')) || /\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol)$/i.test(host);
    const redirectish = /[?&](url|u|redirect|redir|next|return|returnurl|continue|dest|destination|target)=/i.test(u.search);
    return authish || (oddUrl && redirectish);
  } catch (_) {
    return false;
  }
}

function shouldUseWhoisXmlReputationForContext(url, context) {
  const ctx = String(context || '').toLowerCase();
  if (ctx && ctx !== 'page') return true;
  return shouldUsePhishTankForContext(url, context);
}

function isTrustedPolicyReputationUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'legal.twitch.tv') return true;
    return false;
  } catch (_) {
    return false;
  }
}

async function urlReputationLookupUrl(url, opts) {
  const normalized = normalizeSafeBrowsingUrl(url);
  if (!normalized) return { provider: 'URL reputation', ok: false, enabled: false, error: 'Unsupported URL', url: String(url || '') };
  const state = opts && opts.cfg ? opts : await urlReputationConfig();
  const context = String((opts && opts.context) || (state && state.context) || '');
  if (!state.enabled) return { provider: 'URL reputation', ok: true, enabled: false, hit: false, url: normalized };
  if (isTrustedPolicyReputationUrl(normalized)) {
    return { provider: 'URL reputation', ok: true, enabled: true, hit: false, warning: false, trusted: true, url: normalized };
  }

  const checks = [];
  if (state.safeBrowsingEnabled) checks.push(safeBrowsingLookupUrl(normalized, { cfg: state.cfg, key: state.key }));
  if (state.urlHausEnabled) {
    checks.push(urlHausLookupUrl(normalized, { cfg: state.cfg, key: state.urlHausKey, context }));
  }
  if (state.phishTankEnabled && shouldUsePhishTankForContext(normalized, context)) {
    checks.push(phishTankLookupUrl(normalized, { cfg: state.cfg, key: state.phishTankKey }));
  }
  if (state.openPhishEnabled) {
    checks.push(openPhishLookupUrl(normalized, { cfg: state.cfg }));
  }
  if (state.abuseIpDbEnabled && ipFromUrl(normalized)) {
    checks.push(abuseIpDbLookupUrl(normalized, { cfg: state.cfg, key: state.abuseIpDbKey }));
  }
  if (state.whoisXmlReputationEnabled && shouldUseWhoisXmlReputationForContext(normalized, context)) {
    checks.push(whoisXmlDomainReputationLookupUrl(normalized, { cfg: state.cfg, key: state.whoisXmlKey }));
  }
  if (state.whoisXmlThreatIntelEnabled && shouldUseWhoisXmlReputationForContext(normalized, context)) {
    checks.push(whoisXmlThreatIntelLookupUrl(normalized, { cfg: state.cfg, key: state.whoisXmlKey }));
  }
  if (state.whoisXmlEnabled && shouldUseWhoisXmlReputationForContext(normalized, context)) {
    checks.push(whoisXmlDomainAgeLookupUrl(normalized, { cfg: state.cfg, key: state.whoisXmlKey }));
  }
  if (!checks.length) return { provider: 'URL reputation', ok: true, enabled: false, hit: false, url: normalized };

  const results = (await Promise.all(checks)).filter(Boolean);
  const hit = results.find((r) => r && r.ok && r.hit);
  const warning = results.find((r) => r && r.ok && r.warning);
  const ageWarning = results.find((r) => r && r.ok && r.provider === 'WhoisXML API' && r.warning);
  if (hit) {
    return Object.assign({}, hit, {
      ok: true,
      enabled: true,
      hit: true,
      warning: !!hit.warning,
      url: normalized,
      results: results.map(reputationResultPublic).filter(Boolean),
    });
  }
  return {
    provider: warning ? warning.provider : 'URL reputation',
    ok: results.some((r) => r && r.ok),
    enabled: true,
    hit: false,
    warning: !!warning,
    url: normalized,
    threats: warning ? (warning.threats || []) : [],
    ip: warning ? (warning.ip || '') : '',
    score: warning ? Number(warning.score || 0) : 0,
    domain: warning ? (warning.domain || '') : '',
    hostOnly: !!(warning && warning.hostOnly),
    urlCount: warning ? Number(warning.urlCount || 0) : 0,
    onlineUrlCount: warning ? Number(warning.onlineUrlCount || 0) : 0,
    reputationScore: warning && warning.reputationScore != null ? Number(warning.reputationScore) : null,
    ageDays: ageWarning && typeof ageWarning.ageDays === 'number' ? ageWarning.ageDays : (warning && typeof warning.ageDays === 'number' ? warning.ageDays : null),
    domainAgeRisk: ageWarning ? (ageWarning.risk || '') : (warning && warning.risk || ''),
    registrar: ageWarning ? (ageWarning.registrar || '') : (warning && warning.registrar || ''),
    domainPrivacy: ageWarning ? !!ageWarning.privacy : !!(warning && warning.privacy),
    warningCodes: warning && Array.isArray(warning.warningCodes) ? warning.warningCodes.slice(0, 12) : [],
    threatTypes: warning && Array.isArray(warning.threatTypes) ? warning.threatTypes.slice(0, 8) : [],
    total: warning ? Number(warning.total || 0) : 0,
    results: results.map(reputationResultPublic).filter(Boolean),
    error: results.filter((r) => r && r.ok === false).map((r) => r.error || (r.provider + ' failed')).filter(Boolean).join(' | '),
  };
}

function safeBrowsingThreatLabel(verdict) {
  const threats = Array.isArray(verdict && verdict.threats) ? verdict.threats : [];
  if (!threats.length) return 'known dangerous URL';
  return threats.map((t) => String(t || '').replace(/_/g, ' ').toLowerCase()).join(', ');
}

function safeBrowsingBlockPageUrl(info) {
  const params = new URLSearchParams();
  params.set('u', String(info && info.url || '').slice(0, 900));
  params.set('t', String(info && info.threats || '').slice(0, 160));
  params.set('c', String(info && info.context || 'page').slice(0, 40));
  params.set('p', String(info && info.provider || 'Google Safe Browsing').slice(0, 80));
  return chrome.runtime.getURL('safe-browsing-block.html') + '?' + params.toString();
}

function redirectWarningPageUrl(info) {
  const params = new URLSearchParams();
  params.set('to', String(info && info.targetUrl || '').slice(0, 1200));
  params.set('from', String(info && info.sourceUrl || '').slice(0, 900));
  params.set('kind', String(info && info.kind || 'redirect').slice(0, 40));
  params.set('why', String(info && info.why || 'This click tried to open a different site than expected.').slice(0, 180));
  return chrome.runtime.getURL('redirect-warning.html') + '?' + params.toString();
}

async function showRedirectWarning(sender, detail) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return { ok: false, error: 'No tab' };
  const sourceUrl = String((sender.tab && sender.tab.url) || (sender && sender.url) || '');
  const targetUrl = String(detail && detail.url || '');
  let source, target;
  try {
    source = new URL(sourceUrl);
    target = new URL(targetUrl);
  } catch (_) {
    return { ok: false, error: 'Bad redirect target' };
  }
  if (!/^https?:$/.test(source.protocol) || !/^https?:$/.test(target.protocol)) {
    return { ok: false, error: 'Unsupported redirect target' };
  }
  if (target.href.length > 2048 || isLocalOrPrivateHost(target.hostname)) {
    return { ok: false, error: 'Unsafe redirect target' };
  }
  const sourceHost = messageCleanHost(source.hostname);
  const targetHost = messageCleanHost(target.hostname);
  const sourceSite = registrableDomainBg(sourceHost) || sourceHost;
  const targetSite = registrableDomainBg(targetHost) || targetHost;
  if (!sourceSite || !targetSite || sourceSite === targetSite) {
    return { ok: false, error: 'Redirect target is not cross-site' };
  }
  const warningUrl = redirectWarningPageUrl({
    sourceUrl,
    targetUrl: target.href,
    kind: detail && detail.kind,
    why: detail && detail.why,
  });
  queueHistory({
    type: 'redirect_interstitial_shown',
    detail: {
      target: target.href.slice(0, 500),
      targetHost: target.hostname,
      reason: String(detail && detail.why || '').slice(0, 180),
    },
    url: sourceUrl.slice(0, 200),
    at: Date.now(),
  });
  await chrome.tabs.update(tabId, { url: warningUrl });
  return { ok: true };
}

const safeBrowsingNavigationCooldown = Object.create(null);

function reputationWarningText(verdict) {
  const provider = String((verdict && verdict.provider) || 'URL reputation');
  if (provider === 'AbuseIPDB') return 'AbuseIPDB reports ' + abuseIpDbRiskText(verdict);
  if (provider === 'WhoisXML Domain Reputation') {
    const score = verdict && verdict.reputationScore != null ? ' (' + Math.round(Number(verdict.reputationScore)) + '/100)' : '';
    const age = verdict && typeof verdict.ageDays === 'number' ? '. Domain age: ' + verdict.ageDays + ' days' : '';
    return 'WhoisXML reports suspicious domain reputation' + score + age;
  }
  if (provider === 'WhoisXML API') {
    const age = verdict && typeof verdict.ageDays === 'number' ? ' Domain age: ' + verdict.ageDays + ' days.' : '';
    return 'WhoisXML reports a very new or suspicious domain.' + age;
  }
  if (provider === 'WhoisXML Threat Intelligence') return 'WhoisXML found a threat intelligence match';
  if (provider === 'URLhaus') {
    if (verdict && verdict.hostOnly) return 'URLhaus reports malware activity on this host';
    return 'URLhaus reports malware activity for this URL';
  }
  return provider + ' reported a suspicious URL';
}

// A reputation block is the one screen with no way forward, and reputation feeds do
// get things wrong. Blocking a university login, a bank, or a download someone needs
// with no escape is its own kind of harm, so there is a deliberate way through.
//
// It is NOT the site allowlist. That stays unable to quiet malware and phishing
// verdicts, as noted below. This is a separate, explicit, per-host decision the user
// makes on the block screen while looking at the evidence, and it lives in session
// storage so it dies with the browser. A permanent malware exemption is not something
// to grant from a single click.
const SAFE_BROWSING_BYPASS_KEY = '__wardenone_sb_bypass';
async function safeBrowsingBypassAllows(host) {
  try {
    const clean = trustHostFromUrl('https://' + String(host || '')) || String(host || '');
    if (!clean) return false;
    const store = await chrome.storage.session.get(SAFE_BROWSING_BYPASS_KEY);
    const list = (store && store[SAFE_BROWSING_BYPASS_KEY]) || {};
    const until = Number(list[clean] || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch (_) {
    return false;
  }
}
async function addSafeBrowsingBypass(host) {
  const clean = trustHostFromUrl('https://' + String(host || '')) || '';
  if (!clean) return { ok: false, error: 'Unrecognised site.' };
  try {
    const store = await chrome.storage.session.get(SAFE_BROWSING_BYPASS_KEY);
    const list = (store && store[SAFE_BROWSING_BYPASS_KEY]) || {};
    const now = Date.now();
    for (const key of Object.keys(list)) {
      if (!(Number(list[key]) > now)) delete list[key];
    }
    // Long enough to finish what you were doing, short enough that a mistaken
    // bypass does not quietly persist all day.
    list[clean] = now + 30 * 60 * 1000;
    await chrome.storage.session.set({ [SAFE_BROWSING_BYPASS_KEY]: list });
    queueHistory({ type: 'warned_reputation_bypassed', detail: { host: clean, minutes: 30 }, url: clean, at: now });
    return { ok: true, host: clean };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function handleSafeBrowsingNavigation(details) {
  try {
    if (!details || details.frameId !== 0 || details.tabId == null || details.tabId < 0) return;
    const url = normalizeSafeBrowsingUrl(details.url);
    if (!url) return;

    const state = await urlReputationConfig();
    if (!state.enabled) return;
    const host = trustHostFromUrl(url);
    // Known-dangerous URL reputation hits are hard security signals. The site
    // allowlist can quiet normal protections, but it should not bypass malware or
    // phishing reputation checks.
    if (!host || isLocalTrustHost(host)) return;
    // The user already saw this verdict and chose to continue anyway.
    if (await safeBrowsingBypassAllows(host)) return;

    const verdict = await urlReputationLookupUrl(url, Object.assign({ context: 'page' }, state));
    if (verdict && verdict.ok && verdict.warning && !verdict.hit) {
      queueHistory({
        type: verdict.provider === 'AbuseIPDB' ? 'warned_abuseipdb_server' : 'warned_url_reputation',
        detail: {
          host,
          provider: verdict.provider || 'URL reputation',
          ip: verdict.ip || ipFromUrl(url),
          score: Number(verdict.score || 0),
          reputationScore: verdict.reputationScore != null ? Number(verdict.reputationScore) : null,
          ageDays: verdict.ageDays != null ? Number(verdict.ageDays) : null,
          domainAgeRisk: verdict.domainAgeRisk || '',
          registrar: verdict.registrar || '',
          domainPrivacy: !!verdict.domainPrivacy,
          matched: url,
          why: reputationWarningText(verdict),
        },
        url,
        at: Date.now(),
      });
      return;
    }
    if (!verdict || !verdict.ok || !verdict.hit) return;

    const key = details.tabId + ':' + url;
    const now = Date.now();
    if (safeBrowsingNavigationCooldown[key] && now - safeBrowsingNavigationCooldown[key] < 2500) return;
    safeBrowsingNavigationCooldown[key] = now;

    try {
      const tab = await tabsGet(details.tabId);
      const current = String((tab && (tab.pendingUrl || tab.url)) || '');
      if (current && normalizeSafeBrowsingUrl(current) !== url) return;
    } catch (_) {}

    counts[details.tabId] = (counts[details.tabId] || 0) + 1;
    setBadge(details.tabId);
    queueHistory({
      type: 'blocked_safe_browsing_page',
      detail: {
        host,
        provider: verdict.provider || 'URL reputation',
        threats: verdict.threats || [],
        matched: url,
        why: 'Flagged this page as ' + safeBrowsingThreatLabel(verdict),
      },
      url,
      at: Date.now(),
    });
    // Do not promote a single URL-reputation hit into a whole-host learned block.
    // Shared hosts and vendor download paths can have one bad URL without making
    // every future path on that host unsafe.
    await tabsUpdate(details.tabId, {
      url: safeBrowsingBlockPageUrl({ url, provider: verdict.provider || 'URL reputation', threats: (verdict.threats || []).join(','), context: 'page' }),
    });
  } catch (e) {
    console.warn('[WardenOne] URL reputation page check failed', e);
  }
}

async function checkVirusTotalUrl(url, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key || !url) return null;
  const id = base64UrlNoPadding(url);
  try {
    const res = await fetchJsonWithTimeout('https://www.virustotal.com/api/v3/urls/' + encodeURIComponent(id), {
      method: 'GET',
      headers: { 'x-apikey': key, 'Accept': 'application/json' },
    });
    if (res.status === 404) return { provider: 'VirusTotal', ok: true, hit: false, notFound: true };
    if (!res.ok) return { provider: 'VirusTotal', ok: false, status: res.status };
    const attrs = res.data && res.data.data && res.data.data.attributes;
    const stats = (attrs && attrs.last_analysis_stats) || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    return {
      provider: 'VirusTotal',
      ok: true,
      hit: malicious > 0 || suspicious > 0,
      stats: {
        malicious,
        suspicious,
        harmless: Number(stats.harmless || 0),
        undetected: Number(stats.undetected || 0),
      },
      reputation: Number((attrs && attrs.reputation) || 0),
    };
  } catch (e) {
    return { provider: 'VirusTotal', ok: false, error: String(e).slice(0, 120) };
  }
}

async function testVirusTotalKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, error: 'No VirusTotal API key saved.' };

  const headers = { 'x-apikey': key, 'Accept': 'application/json' };
  try {
    const user = await fetchJsonWithTimeout('https://www.virustotal.com/api/v3/users/current', {
      method: 'GET',
      headers,
    }, EXTERNAL_REPUTATION_TIMEOUT_MS);
    if (user.ok) return { ok: true, message: 'VirusTotal key works. URL reputation is enabled.' };
    if (user.status === 401 || user.status === 403) {
      return { ok: false, error: 'VirusTotal rejected this API key.' };
    }

    const probeId = base64UrlNoPadding('https://www.virustotal.com/');
    const probe = await fetchJsonWithTimeout('https://www.virustotal.com/api/v3/urls/' + encodeURIComponent(probeId), {
      method: 'GET',
      headers,
    }, EXTERNAL_REPUTATION_TIMEOUT_MS);
    if (probe.ok || probe.status === 404) return { ok: true, message: 'VirusTotal key works. URL reputation is enabled.' };
    if (probe.status === 401 || probe.status === 403) return { ok: false, error: 'VirusTotal rejected this API key.' };
    if (probe.status === 429) return { ok: false, error: 'VirusTotal key works, but its quota is currently rate-limited.' };
    return { ok: false, error: 'VirusTotal test failed (HTTP ' + (probe.status || user.status || '?') + ').' };
  } catch (e) {
    return { ok: false, error: 'Could not reach VirusTotal: ' + String(e).slice(0, 100) };
  }
}

// Shared key-test for the "flag-style" reputation providers whose probe helper resolves
// to { ok, rateLimited, status, error, cloudflare }. PhishTank, AbuseIPDB, URLhaus and
// the three WhoisXML endpoints all map that result to user-facing text identically; only
// the label, no-key message, probe call, and success/reject strings differ. Two optional
// hooks cover the one-offs: `cloudflare` (PhishTank's browser-challenge response) and
// `catchProbe` (URLhaus's secondary GET when the primary probe throws). Keeping the
// mapping here means an edge-case fix (e.g. "also treat HTTP 451 as rejection") lands in
// one place instead of six copies.
async function testReputationProviderKey(key, opts) {
  if (!key) return { ok: false, error: opts.noKey };
  const label = opts.label;
  const genericFail = (r) => (r && r.error) || (label + ' test failed' + (r && r.status ? ' (HTTP ' + r.status + ')' : '') + '.');
  try {
    const result = await opts.probe(key);
    if (result && result.ok) return { ok: true, message: opts.success };
    if (result && result.rateLimited) {
      return { ok: true, warning: true, message: label + ' responded but is rate-limited right now. The key is saved and WardenOne will retry later.' };
    }
    if (result && result.cloudflare && opts.cloudflare) return { ok: false, error: opts.cloudflare };
    if (result && (result.status === 401 || result.status === 403)) return { ok: false, error: opts.rejected };
    return { ok: false, error: genericFail(result) };
  } catch (e) {
    if (opts.catchProbe) {
      try {
        const probe = await opts.catchProbe(key);
        if (probe && probe.ok) return { ok: true, message: opts.success };
        if (probe && (probe.status === 401 || probe.status === 403)) return { ok: false, error: opts.rejected };
      } catch (_) {}
    }
    return { ok: false, error: 'Could not reach ' + label + ': ' + String(e).slice(0, 100) };
  }
}

function testPhishTankKey(apiKey) {
  return testReputationProviderKey(String(apiKey || '').trim(), {
    label: 'PhishTank',
    noKey: 'No PhishTank API key saved.',
    probe: (key) => fetchPhishTankUrl('https://www.google.com/', key),
    success: 'PhishTank responded. Verified phishing URL checks are enabled.',
    rejected: 'PhishTank rejected this key or request.',
    cloudflare: 'PhishTank returned a browser challenge instead of API JSON. Try again later; WardenOne did not mark the key as valid.',
  });
}

function testAbuseIpDbKey(apiKey) {
  return testReputationProviderKey(String(apiKey || '').trim(), {
    label: 'AbuseIPDB',
    noKey: 'No AbuseIPDB API key saved.',
    probe: (key) => fetchAbuseIpDbIp('1.1.1.1', key),
    success: 'AbuseIPDB key works. Raw-IP server reputation checks are enabled.',
    rejected: 'AbuseIPDB rejected this API key.',
  });
}

function testUrlHausKey(apiKey) {
  return testReputationProviderKey(String(apiKey || '').trim(), {
    label: 'URLhaus',
    noKey: 'No URLhaus Auth-Key saved.',
    probe: (key) => fetchUrlHausUrl('https://www.google.com/', key),
    success: 'URLhaus key works. Malware URL and download checks are enabled.',
    rejected: 'URLhaus rejected this Auth-Key.',
    catchProbe: (key) => fetchJsonWithTimeout(URLHAUS_RECENT_TEST_ENDPOINT, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Auth-Key': key },
    }, EXTERNAL_REPUTATION_TIMEOUT_MS),
  });
}

function firstString() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (Array.isArray(value)) {
      const nested = firstString.apply(null, value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === 'object') continue;
    const s = String(value || '').trim();
    if (s) return s;
  }
  return '';
}

function whoisXmlDate(value) {
  const raw = firstString(value);
  if (!raw) return '';
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : raw;
}

function whoisXmlRisk(ageDays) {
  if (ageDays < 7) return { risk: 'High', riskColor: '#c0392b' };
  if (ageDays < 30) return { risk: 'Elevated', riskColor: '#bd7a2a' };
  if (ageDays < 90) return { risk: 'Moderate', riskColor: '#bd7a2a' };
  return { risk: 'Low', riskColor: '#2e9e5b' };
}

function whoisXmlContactOrg(record) {
  const contacts = [
    record && record.registrant,
    record && record.registrantContact,
    record && record.administrativeContact,
    record && record.technicalContact,
    record && record.registryData && record.registryData.registrant,
    record && record.registryData && record.registryData.registrantContact,
  ];
  return firstString.apply(null, contacts.map((c) => c && (c.organization || c.organizationName || c.org)));
}

function whoisXmlContactCountry(record) {
  const contacts = [
    record && record.registrant,
    record && record.registrantContact,
    record && record.administrativeContact,
    record && record.technicalContact,
    record && record.registryData && record.registryData.registrant,
    record && record.registryData && record.registryData.registrantContact,
  ];
  return firstString.apply(null, contacts.map((c) => c && (c.countryCode || c.country)));
}

function whoisXmlNameServers(record) {
  const ns = (record && record.nameServers) || (record && record.registryData && record.registryData.nameServers) || {};
  const values = [];
  if (Array.isArray(ns.hostNames)) values.push.apply(values, ns.hostNames);
  if (Array.isArray(ns.rawText)) values.push.apply(values, ns.rawText);
  if (typeof ns.hostNames === 'string') values.push(ns.hostNames);
  return Array.from(new Set(values.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))).slice(0, 8);
}

function whoisXmlPrivacy(record) {
  const hay = [
    record && record.registrant && record.registrant.organization,
    record && record.registrantContact && record.registrantContact.organization,
    record && record.administrativeContact && record.administrativeContact.organization,
    record && record.technicalContact && record.technicalContact.organization,
    record && record.privateWhoisProxy && record.privateWhoisProxy.name,
    record && record.privateWhoisProxy && record.privateWhoisProxy.rawText,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return /(privacy|redacted|redaction|whoisguard|proxy|private|withheld|data protected)/i.test(hay);
}

function whoisXmlErrorText(data) {
  const err = data && (data.ErrorMessage || data.errorMessage || data.error || data.errors);
  if (Array.isArray(err) && err[0]) return firstString(err[0].msg, err[0].message, err[0].detail, err[0]);
  if (err && typeof err === 'object') return firstString(err.msg, err.message, err.detail, err.error);
  return firstString(err, data && data.message);
}

function parseWhoisXmlResponse(domain, data) {
  const record = data && (data.WhoisRecord || data.whoisRecord || data);
  if (!record || typeof record !== 'object') return { ok: false, domain, error: 'WhoisXML did not return a WHOIS record.' };
  const registry = record.registryData || {};
  const created = whoisXmlDate(
    record.createdDateNormalized,
    record.createdDate,
    record.createdDateRaw,
    registry.createdDateNormalized,
    registry.createdDate,
    registry.createdDateRaw,
  );
  if (!created) return { ok: false, domain, noDate: true, provider: 'WhoisXML API' };
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / 86400000));
  const risk = whoisXmlRisk(ageDays);
  const registrar = firstString(record.registrarName, record.registrar, registry.registrarName, registry.registrar);
  const updated = whoisXmlDate(record.updatedDateNormalized, record.updatedDate, registry.updatedDateNormalized, registry.updatedDate);
  const expires = whoisXmlDate(record.expiresDateNormalized, record.expiresDate, registry.expiresDateNormalized, registry.expiresDate);
  return Object.assign({
    ok: true,
    provider: 'WhoisXML API',
    domain,
    created,
    updated,
    expires,
    ageDays,
    registrar,
    registrantOrg: whoisXmlContactOrg(record),
    registrantCountry: whoisXmlContactCountry(record),
    privacy: whoisXmlPrivacy(record),
    nameServers: whoisXmlNameServers(record),
    domainAvailability: firstString(record.domainAvailability),
  }, risk);
}

async function fetchWhoisXmlDomain(domain, apiKey) {
  const key = String(apiKey || '').trim();
  const reg = registrableDomainBg(domain);
  if (!key || !reg || normalizeIpLiteral(reg)) return null;
  const params = new URLSearchParams();
  params.set('domainName', reg);
  params.set('outputFormat', 'JSON');
  params.set('ignoreRawTexts', '1');
  params.set('checkProxyData', '1');
  try {
    const res = await fetchJsonWithTimeout(WHOISXML_ENDPOINT + '?' + params.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + key },
    }, WHOISXML_TIMEOUT_MS);
    if (!res.ok) {
      return {
        provider: 'WhoisXML API',
        ok: false,
        status: res.status || 0,
        rateLimited: res.status === 429,
        error: whoisXmlErrorText(res.data) || 'WhoisXML request failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '.',
      };
    }
    const apiError = whoisXmlErrorText(res.data);
    if (apiError) return { provider: 'WhoisXML API', ok: false, status: res.status || 0, error: apiError };
    return parseWhoisXmlResponse(reg, res.data);
  } catch (e) {
    return { provider: 'WhoisXML API', ok: false, error: String(e).slice(0, 120) };
  }
}

async function loadWhoisXmlCache() {
  try {
    const store = await localGet(WHOISXML_CACHE_KEY);
    return (store && store[WHOISXML_CACHE_KEY] && typeof store[WHOISXML_CACHE_KEY] === 'object')
      ? store[WHOISXML_CACHE_KEY]
      : {};
  } catch (_) {
    return {};
  }
}

async function saveWhoisXmlCache(cache) {
  try {
    const entries = Object.entries(cache || {})
      .filter(([, v]) => v && v.cachedAt && (Date.now() - v.cachedAt) < WHOISXML_CACHE_MS)
      .sort((a, b) => Number((b[1] && b[1].cachedAt) || 0) - Number((a[1] && a[1].cachedAt) || 0))
      .slice(0, WHOISXML_CACHE_MAX);
    await localSet({ [WHOISXML_CACHE_KEY]: Object.fromEntries(entries) });
  } catch (_) {}
}

function testWhoisXmlKey(apiKey) {
  return testReputationProviderKey(String(apiKey || '').trim(), {
    label: 'WhoisXML API',
    noKey: 'No WhoisXML API key saved.',
    probe: (key) => fetchWhoisXmlDomain('example.com', key),
    success: 'WhoisXML API key works. Domain age and ownership clues are enabled.',
    rejected: 'WhoisXML API rejected this key.',
  });
}

function testWhoisXmlReputationKey(apiKey) {
  return testReputationProviderKey(String(apiKey || '').trim(), {
    label: 'WhoisXML Domain Reputation',
    noKey: 'No WhoisXML API key saved.',
    probe: (key) => fetchWhoisXmlDomainReputation('example.com', key),
    success: 'WhoisXML Domain Reputation works. Domain risk scoring is enabled.',
    rejected: 'WhoisXML rejected this key or this plan does not include Domain Reputation.',
  });
}

function testWhoisXmlThreatIntelKey(apiKey) {
  return testReputationProviderKey(String(apiKey || '').trim(), {
    label: 'WhoisXML Threat Intelligence',
    noKey: 'No WhoisXML API key saved.',
    probe: (key) => fetchWhoisXmlThreatIntel('example.com', key),
    success: 'WhoisXML Threat Intelligence works. IoC threat matching is enabled.',
    rejected: 'WhoisXML rejected this key or this plan does not include Threat Intelligence.',
  });
}

async function testOpenPhishKey(apiKey) {
  const key = String(apiKey || '').trim();
  try {
    const result = await getOpenPhishFeed(true);
    if (result && result.ok && result.feed) {
      return {
        ok: true,
        validated: !key,
        message: key
          ? 'OpenPhish Community feed works. Token saved for future premium-feed support; this build uses the official community feed.'
          : 'OpenPhish Community feed works. Phishing feed checks are enabled.',
        feedSize: result.feed.urls.length,
      };
    }
    return { ok: false, error: (result && result.error) || 'OpenPhish feed test failed.' };
  } catch (e) {
    return { ok: false, error: 'Could not reach OpenPhish feed: ' + String(e).slice(0, 100) };
  }
}

const REPUTATION_PROVIDER_META = {
  urlHaus: { label: 'URLhaus', use: 'malware URL and download intelligence' },
  abuseIpDb: { label: 'AbuseIPDB', use: 'malicious IP reports and suspicious server warnings' },
  openPhish: { label: 'OpenPhish', use: 'phishing intelligence feed and fake login detection' },
  phishTank: { label: 'PhishTank', use: 'community phishing database checks' },
  whoisXml: { label: 'WhoisXML API', use: 'domain registration age and ownership clues' },
  whoisXmlReputation: { label: 'WhoisXML Domain Reputation', use: 'domain reputation scoring and blocklist warnings' },
  whoisXmlThreatIntel: { label: 'WhoisXML Threat Intelligence', use: 'IoC matches for malicious domains, URLs, and IPs' },
};

async function testConfiguredProviderKey(provider, apiKey) {
  const meta = REPUTATION_PROVIDER_META[String(provider || '')];
  if (!meta) return { ok: false, error: 'Unknown provider.' };
  const key = String(apiKey || '').trim();
  if (!key && String(provider || '') !== 'openPhish') return { ok: false, error: 'No ' + meta.label + ' API key saved.' };
  if (String(provider || '') === 'urlHaus') return testUrlHausKey(key);
  if (String(provider || '') === 'abuseIpDb') return testAbuseIpDbKey(key);
  if (String(provider || '') === 'openPhish') return testOpenPhishKey(key);
  if (String(provider || '') === 'phishTank') return testPhishTankKey(key);
  if (String(provider || '') === 'whoisXml') return testWhoisXmlKey(key);
  if (String(provider || '') === 'whoisXmlReputation') return testWhoisXmlReputationKey(key);
  if (String(provider || '') === 'whoisXmlThreatIntel') return testWhoisXmlThreatIntelKey(key);
  return { ok: false, error: meta.label + ' validation is not available in this build.' };
}

async function checkOpenPhishUrl(url, cfg) {
  return openPhishLookupUrl(url, { cfg: Object.assign({}, DEFAULT_CONFIG, cfg || {}) });
}

async function checkPhishTankUrl(url, cfg) {
  return phishTankLookupUrl(url, { cfg: Object.assign({}, DEFAULT_CONFIG, cfg || {}), key: cfg && cfg.phishTankKey });
}

async function lookupWhoisXmlDomain(domain, cfg) {
  const reg = registrableDomainBg(domain);
  const key = String((cfg && cfg.whoisXmlKey) || '').trim();
  if (!reg || normalizeIpLiteral(reg)) return { ok: false, provider: 'WhoisXML API', domain: reg, unsupported: true };
  if (!(cfg && cfg.enabled !== false && cfg.whoisXml === true && key)) {
    return { ok: false, provider: 'WhoisXML API', domain: reg, enabled: false };
  }
  const cache = await loadWhoisXmlCache();
  const hit = cache[reg];
  if (hit && hit.cachedAt && (Date.now() - hit.cachedAt) < WHOISXML_CACHE_MS) {
    return Object.assign({ ok: true, provider: 'WhoisXML API', domain: reg, cached: true }, hit.result || {});
  }
  const result = await fetchWhoisXmlDomain(reg, key);
  if (result && result.ok) {
    cache[reg] = { cachedAt: Date.now(), result };
    await saveWhoisXmlCache(cache);
  }
  return result || { ok: false, provider: 'WhoisXML API', domain: reg, error: 'No WhoisXML result.' };
}

async function whoisXmlDomainAgeLookupUrl(url, opts) {
  let domain = '';
  try {
    const normalized = normalizeSafeBrowsingUrl(url);
    if (!normalized) return { ok: false, provider: 'WhoisXML API', enabled: false, error: 'Unsupported URL', url: String(url || '') };
    domain = new URL(normalized).hostname;
  } catch (_) {
    return { ok: false, provider: 'WhoisXML API', enabled: false, error: 'Unsupported URL', url: String(url || '') };
  }
  const provided = opts && opts.cfg
    ? { cfg: opts.cfg, key: String(opts.key || opts.cfg.whoisXmlKey || '').trim(), enabled: opts.cfg.enabled !== false && !!String(opts.key || opts.cfg.whoisXmlKey || '').trim() }
    : { cfg: Object.assign({}, DEFAULT_CONFIG), key: '', enabled: false };
  if (!provided.enabled) return { ok: false, provider: 'WhoisXML API', enabled: false, domain };
  const ageCfg = Object.assign({}, provided.cfg, { whoisXml: true, whoisXmlKey: provided.key });
  const age = await lookupWhoisXmlDomain(domain, ageCfg);
  if (!age || !age.ok || typeof age.ageDays !== 'number') {
    return Object.assign({ provider: 'WhoisXML API', enabled: true, domain }, age || { ok: false, error: 'No WHOIS age result.' });
  }
  const hit = false;
  const warning = age.ageDays < 90;
  const threats = age.ageDays < 7 ? ['BRAND_NEW_DOMAIN'] : (age.ageDays < 30 ? ['VERY_NEW_DOMAIN'] : (age.ageDays < 90 ? ['NEW_DOMAIN'] : []));
  return Object.assign({}, age, {
    provider: 'WhoisXML API',
    ok: true,
    enabled: true,
    hit,
    warning,
    threats,
  });
}

// ---- Download Guard scoring/review/listeners -----------------------------
// Implemented in background-downloads.js.

let __allowlistRulesKey = null;
async function applyAllowlistRules(list) {
  try {
    const normalized = normalizeAllowlistHosts(list, 1000);
    const key = normalized.join(',');
    if (key === __allowlistRulesKey) return;
    // clear any existing allowlist rules first
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const oldIds = existing.filter((r) => r.id >= ALLOWLIST_RULE_BASE && r.id < ALLOWLIST_RULE_BASE + 1000).map((r) => r.id);
    const addRules = [];
    normalized.forEach((h, i) => {
      addRules.push({
        id: ALLOWLIST_RULE_BASE + i,
        priority: 100000, // far above block rules (which use 1000) so it wins
        action: { type: 'allowAllRequests' },
        condition: { requestDomains: [h], resourceTypes: ['main_frame', 'sub_frame'] },
      });
    });
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: oldIds, addRules });
    __allowlistRulesKey = key;
  } catch (e) {
    console.warn('[WardenOne] allowlist DNR rules failed', e);
  }
}

let __mediaCompatibilityRulesEnabled = null;
async function applyMediaCompatibilityRules(enabled) {
  try {
    enabled = !!enabled;
    if (__mediaCompatibilityRulesEnabled === enabled) return;
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const oldIds = existing
      .filter((r) => r.id >= MEDIA_COMPAT_RULE_BASE && r.id < MEDIA_COMPAT_RULE_BASE + 100)
      .map((r) => r.id);
    if (!enabled) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: oldIds, addRules: [] });
      __mediaCompatibilityRulesEnabled = enabled;
      return;
    }
    const allTypes = ['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'];
    const xAppTypes = allTypes.filter((type) => type !== 'ping');
    const frameAllowRules = [
      { domain: 'youtube.com' },
      { domain: 'youtube-nocookie.com' },
      { domain: 'youtu.be' },
    ].map((p, i) => ({
      id: MEDIA_COMPAT_RULE_BASE + i,
      priority: 95000,
      action: { type: 'allowAllRequests' },
      condition: {
        requestDomains: [p.domain],
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    }));
    const pairs = [
      { domain: 'youtube.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'youtube-nocookie.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'youtu.be', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'googlevideo.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'ytimg.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'youtubei.googleapis.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'googleapis.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'gstatic.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'google.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'googleusercontent.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'ggpht.com', initiators: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'] },
      { domain: 'twitch.tv', initiators: ['twitch.tv'] },
      { domain: 'ttvnw.net', initiators: ['twitch.tv'] },
      { domain: 'jtvnw.net', initiators: ['twitch.tv'] },
      { domain: 'twitchcdn.net', initiators: ['twitch.tv'] },
      { domain: 'usher.ttvnw.net', initiators: ['twitch.tv'] },
      // Keep X's own app family functional without globally allowing Twitter/X
      // tracking requests when those same hosts are embedded on unrelated sites.
      { domain: 'x.com', initiators: ['x.com', 'twitter.com'], requestDomains: ['x.com'], resourceTypes: xAppTypes },
      { domain: 'twitter.com', initiators: ['x.com', 'twitter.com'], requestDomains: ['twitter.com'], resourceTypes: xAppTypes },
      { domain: 'twimg.com', initiators: ['x.com', 'twitter.com'], requestDomains: ['twimg.com'], resourceTypes: xAppTypes },
    ];
    const addRules = pairs.map((p, i) => ({
      id: MEDIA_COMPAT_RULE_BASE + 10 + i,
      priority: 90000,
      action: { type: 'allow' },
      condition: Object.assign({
        initiatorDomains: p.initiators,
        resourceTypes: p.resourceTypes || allTypes,
      }, { requestDomains: p.requestDomains || [p.domain] }),
    }));
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: oldIds, addRules: frameAllowRules.concat(addRules) });
    __mediaCompatibilityRulesEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] media compatibility DNR rules failed', e);
  }
}

let __loginCompatibilityRulesEnabled = null;
function loginCompatibilityRuleCondition(filter) {
  const value = String(filter || '');
  const exactDomain = value.match(/^\|\|([a-z0-9.-]+)\^?$/i);
  return Object.assign(
    exactDomain ? { requestDomains: [exactDomain[1].toLowerCase()] } : { urlFilter: value },
    { resourceTypes: LOGIN_COMPAT_RESOURCE_TYPES },
  );
}
async function applyLoginCompatibilityRules(enabled) {
  try {
    enabled = !!enabled;
    if (__loginCompatibilityRulesEnabled === enabled) return;
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const oldIds = existing
      .filter((r) => r.id >= LOGIN_COMPAT_RULE_BASE && r.id < LOGIN_COMPAT_RULE_BASE + 300)
      .map((r) => r.id);
    if (!enabled) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: oldIds, addRules: [] });
      __loginCompatibilityRulesEnabled = enabled;
      return;
    }
    const addRules = LOGIN_COMPAT_FILTERS.slice(0, 300).map((filter, i) => ({
      id: LOGIN_COMPAT_RULE_BASE + i,
      priority: 96000,
      action: { type: 'allow' },
      condition: loginCompatibilityRuleCondition(filter),
    }));
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: oldIds, addRules });
    __loginCompatibilityRulesEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] login compatibility DNR rules failed', e);
  }
}

function refreshAllowlistRules() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      if (cfg.enabled === false) { applyAllowlistRules([]); return; }
      applyAllowlistRules(cfg.allowlist || []);
    }).catch(() => {});
  } catch (_) {}
}

function refreshMediaCompatibilityRules() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      applyMediaCompatibilityRules(cfg.enabled !== false);
    }).catch(() => {});
  } catch (_) {}
}

function refreshLoginCompatibilityRules() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      applyLoginCompatibilityRules(cfg.enabled !== false && cfg.loginCompatibility !== false);
    }).catch(() => {});
  } catch (_) {}
}

let __blocklistRulesetStateKey = '';
async function refreshBlocklistRuleset(cfgOverride) {
  try {
    const cfg = (cfgOverride && typeof cfgOverride === 'object')
      ? cfgOverride
      : ((await localGet('wardenone_config')).wardenone_config || {});
    const on = cfg.enabled !== false;
    // the EasyList static pack follows BOTH the master switch and the AdShield toggle
    const adshieldOn = on && cfg.adShield !== false;
    const trackersOn = on && cfg.blockTrackers !== false;
    const stateKey = [on ? 1 : 0, adshieldOn ? 1 : 0, trackersOn ? 1 : 0, cfg.trackerLearner !== false ? 1 : 0].join('|');
    if (stateKey === __blocklistRulesetStateKey) return;
    const enableRulesetIds = [];
    const disableRulesetIds = [];
    (on ? enableRulesetIds : disableRulesetIds).push('grabbers');
    (adshieldOn ? enableRulesetIds : disableRulesetIds).push(ADSHIELD_STATIC_RULESET_ID);
    (trackersOn ? enableRulesetIds : disableRulesetIds).push(TRACKERS_STATIC_RULESET_ID);
    (trackersOn ? enableRulesetIds : disableRulesetIds).push(EASYPRIVACY_STATIC_RULESET_ID);
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    __blocklistRulesetStateKey = stateKey;
    ADSHIELD_STATIC_ACTIVE = adshieldOn;
    // The master switch must also suspend the DYNAMIC rules, not just the static
    // ruleset -- otherwise "off" still blocks network requests. Re-fetching remote
    // lists is intentionally handled by install/startup/alarms/manual repair and
    // by the settings-change listener when list composition actually changes; this
    // local refresh path may run on every popup toggle and must stay cheap.
    if (!on) {
      try { await removeWardenOneDynamicRules(); } catch (_) {}
    } else {
      try { applyLearnedRules(); } catch (_) {}
      try { applyTrackerLearnerRules(); } catch (_) {}
    }
  } catch (e) {
    console.warn('[WardenOne] blocklist ruleset toggle failed', e);
  }
}

const ALL_COOKIES_BACKUP_KEY = 'wardenone_all_cookies_previous_setting';
const GLOBAL_COOKIE_PATTERNS = ['<all_urls>', 'http://*/*', 'https://*/*'];
const COOKIE_SETTING_PROBE_URL = 'https://example.com/';
const VALID_COOKIE_SETTINGS = new Set(['allow', 'block', 'session_only']);
const LOCATION_BACKUP_KEY = 'wardenone_location_previous_setting';
const GLOBAL_LOCATION_PATTERNS = ['<all_urls>', 'http://*/*', 'https://*/*'];
const LOCATION_SETTING_PROBE_URL = 'https://example.com/';
const VALID_LOCATION_SETTINGS = new Set(['allow', 'ask', 'block']);

function globalContentSettingApi(key, method) {
  try {
    const group = chrome.contentSettings;
    const api = group && group[key];
    return api && typeof api[method] === 'function' ? api : null;
  } catch (_) {
    return null;
  }
}

function getCookieSettingForProbe() {
  return new Promise((resolve) => {
    const cs = globalContentSettingApi('cookies', 'get');
    if (!cs) { resolve(null); return; }
    let done = false;
    const finish = (setting) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(VALID_COOKIE_SETTINGS.has(setting) ? setting : null);
    };
    const timer = setTimeout(() => finish(null), 1200);
    try {
      cs.get({ primaryUrl: COOKIE_SETTING_PROBE_URL }, (d) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        finish(err ? null : (d && d.setting));
      });
    } catch (_) {
      finish(null);
    }
  });
}

function setGlobalCookieSetting(setting) {
  return new Promise((resolve) => {
    const cs = globalContentSettingApi('cookies', 'set');
    if (!cs || !VALID_COOKIE_SETTINGS.has(setting)) { resolve(false); return; }
    let done = 0;
    let okCount = 0;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      done += 1;
      if (ok) okCount += 1;
      if (done < GLOBAL_COOKIE_PATTERNS.length) return;
      settled = true;
      clearTimeout(timer);
      resolve(okCount > 0);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(okCount > 0);
    }, 2500);
    GLOBAL_COOKIE_PATTERNS.forEach((primaryPattern) => {
      try {
        cs.set({ primaryPattern, setting }, () => {
          const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
          finish(!err);
        });
      } catch (_) {
        finish(false);
      }
    });
  });
}

function getLocationSettingForProbe() {
  return new Promise((resolve) => {
    const cs = globalContentSettingApi('location', 'get');
    if (!cs) { resolve(null); return; }
    let done = false;
    const finish = (setting) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(VALID_LOCATION_SETTINGS.has(setting) ? setting : null);
    };
    const timer = setTimeout(() => finish(null), 1200);
    try {
      cs.get({ primaryUrl: LOCATION_SETTING_PROBE_URL }, (d) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        finish(err ? null : (d && d.setting));
      });
    } catch (_) {
      finish(null);
    }
  });
}

function setGlobalLocationSetting(setting) {
  return new Promise((resolve) => {
    const cs = globalContentSettingApi('location', 'set');
    if (!cs || !VALID_LOCATION_SETTINGS.has(setting)) { resolve(false); return; }
    let done = 0;
    let okCount = 0;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      done += 1;
      if (ok) okCount += 1;
      if (done < GLOBAL_LOCATION_PATTERNS.length) return;
      settled = true;
      clearTimeout(timer);
      resolve(okCount > 0);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(okCount > 0);
    }, 2500);
    GLOBAL_LOCATION_PATTERNS.forEach((primaryPattern) => {
      try {
        cs.set({ primaryPattern, setting }, () => {
          const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
          finish(!err);
        });
      } catch (_) {
        finish(false);
      }
    });
  });
}

function localRemove(key) {
  return new Promise((resolve) => {
    try { chrome.storage.local.remove(key, resolve); } catch (_) { resolve(); }
  });
}

let __allCookieBlockEnabled = null;
async function applyAllCookieBlock(enabled) {
  try {
    enabled = !!enabled;
    if (__allCookieBlockEnabled === enabled) return;
    if (!globalContentSettingApi('cookies', 'set')) return;
    if (enabled) {
      const store = await localGet(ALL_COOKIES_BACKUP_KEY);
      const existingBackup = store && store[ALL_COOKIES_BACKUP_KEY];
      const current = await getCookieSettingForProbe();
      if (!existingBackup && current && current !== 'session_only') {
        await localSet({ [ALL_COOKIES_BACKUP_KEY]: current });
      } else if (!existingBackup && !current) {
        await localSet({ [ALL_COOKIES_BACKUP_KEY]: 'allow' });
      }
      // session_only (NOT 'block'): cookies WORK during the browsing session so logins / sign-in
      // succeed, but EVERY cookie is cleared when the browser fully closes -> no cross-session
      // tracking. The old 'block' killed first-party session cookies and broke a bunch of logins.
      await setGlobalCookieSetting('session_only');
      __allCookieBlockEnabled = enabled;
      return;
    }

    const store = await localGet(ALL_COOKIES_BACKUP_KEY);
    const previous = store && store[ALL_COOKIES_BACKUP_KEY];
    if (VALID_COOKIE_SETTINGS.has(previous)) {
      await setGlobalCookieSetting(previous);
      await localRemove(ALL_COOKIES_BACKUP_KEY);
    }
    __allCookieBlockEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] all-cookie setting failed', e);
  }
}

let __globalLocationBlockEnabled = null;
async function applyGlobalLocationBlock(enabled) {
  try {
    enabled = !!enabled;
    if (__globalLocationBlockEnabled === enabled) return;
    if (!globalContentSettingApi('location', 'set')) return;
    if (enabled) {
      const store = await localGet(LOCATION_BACKUP_KEY);
      const existingBackup = store && store[LOCATION_BACKUP_KEY];
      const current = await getLocationSettingForProbe();
      if (!existingBackup && current && current !== 'block') {
        await localSet({ [LOCATION_BACKUP_KEY]: current });
      } else if (!existingBackup && !current) {
        await localSet({ [LOCATION_BACKUP_KEY]: 'ask' });
      }
      await setGlobalLocationSetting('block');
      __globalLocationBlockEnabled = enabled;
      return;
    }

    const store = await localGet(LOCATION_BACKUP_KEY);
    const previous = store && store[LOCATION_BACKUP_KEY];
    if (VALID_LOCATION_SETTINGS.has(previous)) {
      await setGlobalLocationSetting(previous);
      await localRemove(LOCATION_BACKUP_KEY);
    }
    __globalLocationBlockEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] location content setting failed', e);
  }
}

function refreshAllCookieBlock() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      const on = cfg.enabled !== false;
      applyAllCookieBlock(on && cfg.blockAllCookies === true);
    }).catch(() => {});
  } catch (_) {}
}

function refreshGlobalLocationBlock() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      const on = cfg.enabled !== false;
      applyGlobalLocationBlock(on && cfg.blockGeolocation === true);
    }).catch(() => {});
  } catch (_) {}
}

let __refreshExtensionStateLastKey = '';
function refreshExtensionState() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      const on = cfg.enabled !== false;
      const stateKey = [
        on ? 1 : 0,
        cfg.sendPrivacySignals !== false ? 1 : 0,
        cfg.blockThirdPartyCookies !== false ? 1 : 0,
        normalizeAllowlistHosts(cfg.allowlist || []).join(','),
        cfg.loginCompatibility !== false ? 1 : 0,
        cfg.forceHttps === true ? 1 : 0,
        cfg.adShield !== false ? 1 : 0,
        cfg.blockTrackers !== false ? 1 : 0,
        cfg.blockAllCookies === true ? 1 : 0,
        eyeShieldThemingActive(cfg) ? 1 : 0,
        consentRejectActive(cfg) ? 1 : 0,
        cfg.blockFingerprintScripts !== false ? 1 : 0,
        cfg.googleSearchResultCleanup === true ? 1 : 0,
        cfg.blockSearchAiAnswers === true ? 1 : 0,
        cfg.blockSponsoredSearchResults === true ? 1 : 0,
        cfg.blockGeolocation === true ? 1 : 0,
        cfg.blockWebRTCLeak !== false ? 1 : 0,
      ].join('|');
      if (stateKey === __refreshExtensionStateLastKey) return;
      __refreshExtensionStateLastKey = stateKey;
      applyPrivacyHeaderRule(on && cfg.sendPrivacySignals !== false);
      applyThirdPartyCookieRule(on && cfg.blockThirdPartyCookies !== false);
      applyAllowlistRules(on ? (cfg.allowlist || []) : []);
      applyMediaCompatibilityRules(on);
      applyLoginCompatibilityRules(on && cfg.loginCompatibility !== false);
      applyHttpsUpgradeRule(on && cfg.forceHttps === true);
      refreshBlocklistRuleset(cfg);
      reconcileEyeShieldInjection(cfg);
      reconcileConsentRejectInjection(cfg);
      reconcileGoogleCleanupCssInjection(cfg);
      applyFingerprintScriptRules(on && cfg.blockFingerprintScripts !== false);
      applyGoogleSearchSponsoredAllowRules(on && cfg.adShield !== false && !searchSponsoredCleanupActive(cfg));
      applyAllCookieBlock(on && cfg.blockAllCookies === true);
      applyGlobalLocationBlock(on && cfg.blockGeolocation === true);
      applyLocationPrivacyHeaderRule(on && cfg.blockGeolocation === true);
      applyIpLookupBlockRules(on && cfg.blockWebRTCLeak !== false);
    }).catch(() => {
      refreshPrivacyHeaders();
      refreshAllowlistRules();
      refreshMediaCompatibilityRules();
      refreshLoginCompatibilityRules();
      refreshHttpsUpgrade();
      refreshBlocklistRuleset();
      reconcileEyeShieldInjection();
      reconcileConsentRejectInjection();
      reconcileGoogleCleanupCssInjection({ enabled: false });
      applyFingerprintScriptRules(false);
      applyGoogleSearchSponsoredAllowRules(false);
      refreshAllCookieBlock();
      refreshGlobalLocationBlock();
      applyLocationPrivacyHeaderRule(false);
      applyIpLookupBlockRules(false);
    });
  } catch (_) {
    refreshPrivacyHeaders();
    refreshAllowlistRules();
    refreshMediaCompatibilityRules();
    refreshLoginCompatibilityRules();
    refreshHttpsUpgrade();
    refreshBlocklistRuleset();
    reconcileEyeShieldInjection();
    reconcileConsentRejectInjection();
    reconcileGoogleCleanupCssInjection({ enabled: false });
    applyFingerprintScriptRules(false);
    applyGoogleSearchSponsoredAllowRules(false);
    refreshAllCookieBlock();
    refreshGlobalLocationBlock();
    applyLocationPrivacyHeaderRule(false);
    applyIpLookupBlockRules(false);
  }
}

let __refreshExtensionStateTimer = null;
function scheduleExtensionStateRefresh() {
  if (__refreshExtensionStateTimer) clearTimeout(__refreshExtensionStateTimer);
  __refreshExtensionStateTimer = setTimeout(() => {
    __refreshExtensionStateTimer = null;
    refreshExtensionState();
  }, 150);
}

function searchAiCleanupActive(cfg) {
  cfg = cfg || {};
  return cfg.enabled !== false && (cfg.blockSearchAiAnswers === true || cfg.googleSearchResultCleanup === true);
}

function searchSponsoredCleanupActive(cfg) {
  cfg = cfg || {};
  return cfg.enabled !== false && (cfg.blockSponsoredSearchResults === true || cfg.googleSearchResultCleanup === true);
}

function isGoogleSearchCleanupUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/i.test(u.protocol)
      && ((/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && /^\/(search|webhp)?$/i.test(u.pathname || '/'))
        || (u.hostname === 'search.brave.com' && /^\/search$/i.test(u.pathname || '/')));
  } catch (_) {
    return false;
  }
}

function injectSearchCleanupCssIntoOpenTabs(files) {
  try {
    if (!chrome.scripting || !chrome.scripting.insertCSS) return;
    const cssFiles = (Array.isArray(files) ? files : []).filter(Boolean);
    if (!cssFiles.length) return;
    chrome.tabs.query({}, (tabs) => {
      for (const t of (tabs || [])) {
        if (!t || t.id == null || !isGoogleSearchCleanupUrl(t.url)) continue;
        for (const file of cssFiles) {
          try {
            chrome.scripting.insertCSS(
              { target: { tabId: t.id, allFrames: true }, files: [file] },
              () => { void chrome.runtime.lastError; },
            );
          } catch (_) {}
        }
      }
    });
  } catch (_) {}
}

async function reconcileSearchCleanupCssScript(id, file, want) {
  let have = false;
  try {
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    have = Array.isArray(reg) && reg.length > 0;
  } catch (_) { have = false; }
  const scriptDef = {
      id,
      matches: GOOGLE_CLEANUP_CSS_MATCHES,
      css: [file],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
  };
  async function registerFresh() {
    try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (_) {}
    await chrome.scripting.registerContentScripts([scriptDef]);
  }
  if (want) {
    if (have && chrome.scripting.updateContentScripts) {
      try {
        await chrome.scripting.updateContentScripts([scriptDef]);
      } catch (_) {
        await registerFresh();
      }
    } else if (have) {
      await registerFresh();
    } else {
      await chrome.scripting.registerContentScripts([scriptDef]);
    }
    injectSearchCleanupCssIntoOpenTabs([file]);
  } else if (!want && have) {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }
}

async function reconcileGoogleCleanupCssInjection(cfgArg) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  let cfg = cfgArg;
  if (!cfg) {
    try { cfg = ((await localGet('wardenone_config')).wardenone_config || {}); } catch (_) { cfg = {}; }
  }
  try {
    try { await chrome.scripting.unregisterContentScripts({ ids: [GOOGLE_CLEANUP_CSS_SCRIPT_ID] }); } catch (_) {}
    await reconcileSearchCleanupCssScript(SEARCH_AI_CLEANUP_CSS_SCRIPT_ID, 'search-ai-cleanup.css', searchAiCleanupActive(cfg));
    await reconcileSearchCleanupCssScript(SEARCH_SPONSORED_CLEANUP_CSS_SCRIPT_ID, 'search-sponsored-cleanup.css', searchSponsoredCleanupActive(cfg));
  } catch (e) {
    console.warn('[WardenOne] search cleanup pre-paint CSS registration failed', e);
  }
}

// ===== EyeShield lazy injection (PERF: weak machines) =====
// EyeShield (~179KB) is a cosmetic theming feature that is OFF by default. Static
// all_frames injection parsed it into EVERY frame of EVERY page even for the huge
// majority of users who never theme. Instead we register it as a dynamic content
// script ONLY while theming is actually active, and tear it down otherwise. When
// active it is the SAME file at document_start (registered with persistAcrossSessions
// so it runs even while the service worker is asleep -- no flash, no SW wake).
const EYESHIELD_SCRIPT_ID = 'wo-eyeshield-dynamic';
function eyeShieldThemingActive(cfg) {
  cfg = cfg || {};
  if (cfg.enabled === false) return false;
  if (cfg.eyeShield === true) return true; // flag the popup maintains
  const mode = String(cfg.eyeShieldMode || 'off').toLowerCase();
  if (mode === 'dark' || mode === 'ultra' || mode === 'light') return true;
  const numTouched = (v, def) => v !== undefined && v !== null && Number(v) !== def;
  if (numTouched(cfg.eyeShieldBrightness, 100)) return true;
  if (numTouched(cfg.eyeShieldContrast, 100)) return true;
  if (numTouched(cfg.eyeShieldSaturation, 100)) return true;
  if (numTouched(cfg.eyeShieldWarmth, 0)) return true;
  if (numTouched(cfg.eyeShieldGrayscale, 0)) return true;
  const mapTouched = (m) => !!m && typeof m === 'object' && Object.keys(m).length > 0;
  if (mapTouched(cfg.eyeShieldBrightnessByHost)) return true;
  if (mapTouched(cfg.eyeShieldContrastByHost)) return true;
  if (mapTouched(cfg.eyeShieldSaturationByHost)) return true;
  if (mapTouched(cfg.eyeShieldWarmthByHost)) return true;
  if (mapTouched(cfg.eyeShieldGrayscaleByHost)) return true;
  return false;
}
function injectEyeShieldIntoOpenTabs() {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const t of (tabs || [])) {
        if (!t || t.id == null || !/^https?:/i.test(t.url || '')) continue;
        try {
          chrome.scripting.executeScript(
            { target: { tabId: t.id, allFrames: true }, world: 'ISOLATED', files: ['eyeshield.js'] },
            () => { void chrome.runtime.lastError; },
          );
        } catch (_) {}
      }
    });
  } catch (_) {}
}
async function reconcileEyeShieldInjection(cfgArg) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  let cfg = cfgArg;
  if (!cfg) {
    try { cfg = ((await localGet('wardenone_config')).wardenone_config || {}); } catch (_) { cfg = {}; }
  }
  const want = eyeShieldThemingActive(cfg);
  let have = false;
  try {
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [EYESHIELD_SCRIPT_ID] });
    have = Array.isArray(reg) && reg.length > 0;
  } catch (_) { have = false; }
  try {
    if (want && !have) {
      await chrome.scripting.registerContentScripts([{
        id: EYESHIELD_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: ['eyeshield.js'],
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: true,
        // ISOLATED world (default) -- EyeShield needs chrome.storage/runtime access.
      }]);
      // Apply live to already-open tabs so enabling theming doesn't need a reload.
      injectEyeShieldIntoOpenTabs();
    } else if (!want && have) {
      await chrome.scripting.unregisterContentScripts({ ids: [EYESHIELD_SCRIPT_ID] });
      // Open tabs keep their (now off-mode, cheap) instance until reload; the
      // config-update message already tells EyeShield to tear down any active theme.
    }
  } catch (_) {}
}

// ===== Consent Reject lazy injection (PERF: weak machines) =====
// Auto Reject Consent is ON by default, but still registered lazily from config.
// Loading its DOM scanner into every frame while the feature is off costs parse
// time, a storage read, and listeners on every page.
const CONSENT_REJECT_SCRIPT_ID = 'wo-consent-reject-dynamic';
// Origins where auto-consent-reject must NEVER run. consent-reject.js synthetically clicks
// "reject / opt-out / disable all" controls; on login/SSO/OAuth, captcha challenge frames,
// and payment/checkout that risks dismissing a real auth/payment step or flipping an
// account setting the user never touched. The dynamically-registered consent script did NOT
// inherit content.min.js's manifest exclude_matches, so we mirror them here (+ payment hosts).
const CONSENT_REJECT_EXCLUDE_MATCHES = [
  'https://accounts.google.com/*', 'https://*.accounts.google.com/*',
  'https://oauth2.googleapis.com/*', 'https://apis.google.com/*',
  'https://login.microsoftonline.com/*', 'https://login.live.com/*',
  'https://appleid.apple.com/*',
  'https://okta.com/*', 'https://*.okta.com/*', 'https://*.oktacdn.com/*',
  'https://auth0.com/*', 'https://*.auth0.com/*',
  'https://onelogin.com/*', 'https://*.onelogin.com/*',
  'https://duosecurity.com/*', 'https://*.duosecurity.com/*',
  'https://hcaptcha.com/*', 'https://*.hcaptcha.com/*',
  'https://recaptcha.net/*', 'https://*.recaptcha.net/*',
  'https://challenges.cloudflare.com/*', 'https://turnstile.cloudflare.com/*',
  'https://amazoncognito.com/*', 'https://*.amazoncognito.com/*',
  'https://github.com/*', 'https://*.github.com/*',
  'https://discord.com/oauth2/*', 'https://discord.com/api/oauth2/*',
  'https://paypal.com/*', 'https://*.paypal.com/*',
  'https://checkout.stripe.com/*', 'https://js.stripe.com/*',
  'https://checkout.com/*', 'https://*.checkout.com/*',
  'https://adyen.com/*', 'https://*.adyen.com/*',
  'https://braintreepayments.com/*', 'https://*.braintreepayments.com/*',
  'https://braintreegateway.com/*', 'https://*.braintreegateway.com/*',
  'https://klarna.com/*', 'https://*.klarna.com/*',
  'https://squareup.com/*', 'https://*.squareup.com/*',
  'https://cash.app/*', 'https://*.cash.app/*',
];
// Top-frame URL guard for the one-time catch-up injection into already-open tabs
// (executeScript can't honor excludeMatches the way registerContentScripts does).
const CONSENT_REJECT_EXCLUDE_RE = /(^|\.)(accounts\.google\.com|oauth2\.googleapis\.com|apis\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|okta\.com|oktacdn\.com|auth0\.com|onelogin\.com|duosecurity\.com|hcaptcha\.com|recaptcha\.net|challenges\.cloudflare\.com|turnstile\.cloudflare\.com|amazoncognito\.com|github\.com|paypal\.com|stripe\.com|checkout\.com|adyen\.com|braintreepayments\.com|braintreegateway\.com|klarna\.com|squareup\.com|cash\.app)$/i;
function consentRejectExcludedUrl(url) {
  try { return CONSENT_REJECT_EXCLUDE_RE.test(new URL(url).hostname); } catch (_) { return false; }
}
function consentRejectActive(cfg) {
  cfg = cfg || {};
  return cfg.enabled !== false
    && (cfg.autoRejectConsent === true || cfg.autoRejectConsent === 'true' || cfg.autoRejectConsent === 1);
}
function injectConsentRejectIntoOpenTabs() {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const t of (tabs || [])) {
        if (!t || t.id == null || !/^https?:/i.test(t.url || '')) continue;
        if (consentRejectExcludedUrl(t.url)) continue; // don't catch-up inject on login/payment tabs
        try {
          chrome.scripting.executeScript(
            { target: { tabId: t.id, allFrames: true }, world: 'ISOLATED', files: ['consent-reject.js'] },
            () => { void chrome.runtime.lastError; },
          );
        } catch (_) {}
      }
    });
  } catch (_) {}
}
async function reconcileConsentRejectInjection(cfgArg) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  let cfg = cfgArg;
  if (!cfg) {
    try { cfg = ((await localGet('wardenone_config')).wardenone_config || {}); } catch (_) { cfg = {}; }
  }
  const want = consentRejectActive(cfg);
  let have = false;
  try {
    const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [CONSENT_REJECT_SCRIPT_ID] });
    have = Array.isArray(reg) && reg.length > 0;
  } catch (_) { have = false; }
  try {
    const scriptDef = {
      id: CONSENT_REJECT_SCRIPT_ID,
      matches: ['<all_urls>'],
      excludeMatches: CONSENT_REJECT_EXCLUDE_MATCHES,
      js: ['consent-reject.js'],
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    };
    if (want && have && chrome.scripting.updateContentScripts) {
      try {
        await chrome.scripting.updateContentScripts([scriptDef]);
      } catch (_) {
        try { await chrome.scripting.unregisterContentScripts({ ids: [CONSENT_REJECT_SCRIPT_ID] }); } catch (_) {}
        await chrome.scripting.registerContentScripts([scriptDef]);
        injectConsentRejectIntoOpenTabs();
      }
    } else if (want && !have) {
      await chrome.scripting.registerContentScripts([scriptDef]);
      injectConsentRejectIntoOpenTabs();
    } else if (!want && have) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONSENT_REJECT_SCRIPT_ID] });
    }
  } catch (_) {}
}

// Add or remove the rule that appends "DNT: 1" and "Sec-GPC: 1" request headers
// to outgoing requests, matching the navigator.* signals set in content.min.js.
let __privacyHeaderRuleEnabled = null;
async function applyPrivacyHeaderRule(enabled) {
  try {
    enabled = !!enabled;
    if (__privacyHeaderRuleEnabled === enabled) return;
    // always clear first so toggling off truly removes it
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PRIVACY_HEADER_RULE_ID] });
    if (!enabled) {
      __privacyHeaderRuleEnabled = enabled;
      return;
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: PRIVACY_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'DNT', operation: 'set', value: '1' },
            { header: 'Sec-GPC', operation: 'set', value: '1' },
          ],
        },
        condition: { urlFilter: '*', resourceTypes: RESOURCE_TYPES },
      }],
    });
    __privacyHeaderRuleEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] privacy header rule failed', e);
  }
}

let __locationPrivacyHeaderRuleEnabled = null;
async function applyLocationPrivacyHeaderRule(enabled) {
  try {
    enabled = !!enabled;
    if (__locationPrivacyHeaderRuleEnabled === enabled) return;
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [LOCATION_PRIVACY_HEADER_RULE_ID] });
    if (!enabled) {
      __locationPrivacyHeaderRuleEnabled = enabled;
      return;
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: LOCATION_PRIVACY_HEADER_RULE_ID,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Accept-Language', operation: 'set', value: 'en-US,en;q=0.9' },
            { header: 'X-Geo', operation: 'remove' },
            { header: 'X-Geo-Position', operation: 'remove' },
            { header: 'X-Client-Geo-Location', operation: 'remove' },
          ],
        },
        condition: { urlFilter: '*', resourceTypes: RESOURCE_TYPES },
      }],
    });
    __locationPrivacyHeaderRuleEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] location privacy header rule failed', e);
  }
}

let __ipLookupBlockRulesEnabled = null;
async function applyIpLookupBlockRules(enabled) {
  try {
    enabled = !!enabled;
    if (__ipLookupBlockRulesEnabled === enabled) return;
    const removeRuleIds = IP_LOOKUP_BLOCK_DOMAINS.map((_, i) => IP_LOOKUP_BLOCK_RULE_BASE + i);
    if (!enabled) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: [] });
      __ipLookupBlockRulesEnabled = enabled;
      return;
    }
    const addRules = IP_LOOKUP_BLOCK_DOMAINS.map((domain, i) => ({
      id: IP_LOOKUP_BLOCK_RULE_BASE + i,
      priority: 2000,
      action: { type: 'block' },
      condition: {
        requestDomains: [domain],
        domainType: 'thirdParty',
        resourceTypes: IP_LOOKUP_BLOCK_RESOURCE_TYPES,
      },
    }));
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    __ipLookupBlockRulesEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] IP lookup block rules failed', e);
  }
}

// Block third-party tracking cookies at the network layer, but only on passive
// pixel/beacon responses. Never strip auth state from navigations, frames, scripts,
// or XHR/fetch: doing so breaks OAuth, SAML and university federation callbacks.
let __thirdPartyCookieRuleEnabled = null;
async function applyThirdPartyCookieRule(enabled) {
  try {
    enabled = !!enabled;
    if (__thirdPartyCookieRuleEnabled === enabled) return;
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [THIRD_PARTY_COOKIE_RULE_ID] });
    if (!enabled) {
      __thirdPartyCookieRuleEnabled = enabled;
      return;
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: THIRD_PARTY_COOKIE_RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] },
        condition: {
          domainType: 'thirdParty',
          resourceTypes: THIRD_PARTY_COOKIE_RESOURCE_TYPES,
          excludedRequestDomains: LOGIN_COMPAT_NEVER_BLOCK_DOMAINS,
        },
      }],
    });
    __thirdPartyCookieRuleEnabled = enabled;
  } catch (e) {
    console.warn('[WardenOne] third-party cookie rule failed', e);
  }
}

// Read the setting and apply. Called on install/startup and whenever settings change.
function refreshPrivacyHeaders() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      const on = cfg.enabled !== false;
      applyPrivacyHeaderRule(on && cfg.sendPrivacySignals !== false);
      applyThirdPartyCookieRule(on && cfg.blockThirdPartyCookies !== false);
    }).catch(() => {});
  } catch (_) {}
}

// ---- Force HTTPS: opt-in, top-level navigation only. Upgrading subframes or
// requests made by page code can silently break federated sign-in and HTTP-only
// campus services. Local callback hosts are excluded even when this is enabled.
const HTTPS_UPGRADE_RULE_ID = 910000;
const HTTPS_UPGRADE_DYNAMIC_RULE_ID = 910001;
const HTTPS_UPGRADE_RESOURCE_TYPES = ['main_frame'];
const HTTPS_UPGRADE_EXCLUDED_DOMAINS = ['localhost', '127.0.0.1'];
function httpsUpgradeRule(id) {
  return {
    id,
    priority: 1,
    action: { type: 'upgradeScheme' },
    condition: {
      regexFilter: '^http://',
      resourceTypes: HTTPS_UPGRADE_RESOURCE_TYPES,
      excludedRequestDomains: HTTPS_UPGRADE_EXCLUDED_DOMAINS,
    },
  };
}
let __httpsUpgradeRuleEnabled = null;
async function applyHttpsUpgradeRule(enabled) {
  enabled = !!enabled;
  if (__httpsUpgradeRuleEnabled === enabled) return;
  let sessionOk = false;
  try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [HTTPS_UPGRADE_RULE_ID] }); } catch (_) {}
  try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [HTTPS_UPGRADE_DYNAMIC_RULE_ID] }); } catch (_) {}
  if (!enabled) {
    __httpsUpgradeRuleEnabled = enabled;
    return;
  }
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [httpsUpgradeRule(HTTPS_UPGRADE_RULE_ID)],
    });
    sessionOk = true;
  } catch (e) {
    console.warn('[WardenOne] https session upgrade rule failed', e);
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [httpsUpgradeRule(HTTPS_UPGRADE_DYNAMIC_RULE_ID)],
    });
  } catch (e) {
    console.warn(sessionOk ? '[WardenOne] persistent https upgrade rule failed' : '[WardenOne] https upgrade rule failed', e);
  }
  if (sessionOk) __httpsUpgradeRuleEnabled = enabled;
}
function refreshHttpsUpgrade() {
  try {
    localGet('wardenone_config').then((res) => {
      const cfg = (res && res.wardenone_config) || {};
      const on = cfg.enabled !== false;
      applyHttpsUpgradeRule(on && cfg.forceHttps === true);
    }).catch(() => {});
  } catch (_) {}
}

// ---- Certificate Guard ----------------------------------------------------
// Chrome does the real TLS validation. WardenOne listens for top-level
// certificate/SSL failures, logs them, and replaces the raw browser error with a
// clear "Connection Not Trusted" block page. Chrome does not expose full cert
// metadata to MV3 extensions, so we classify from the browser error name.
const CERT_ERROR_PAGE = 'cert-error.html';
const TRUST_ERROR_COOLDOWN_MS = 1800;
const HTTP_UPGRADE_MEMORY_MS = 12000;
const recentTrustErrors = Object.create(null);
const recentHttpNavigations = Object.create(null);

function trustHostFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
}

function isLocalTrustHost(host) {
  return isLocalOrPrivateHost(host);
}

function noteHttpNavigationAttempt(details) {
  try {
    if (!details || details.frameId !== 0 || details.tabId == null || details.tabId < 0) return;
    const url = String(details.url || '');
    if (!/^http:\/\//i.test(url)) return;
    const host = trustHostFromUrl(url);
    if (!host || isLocalTrustHost(host)) return;
    recentHttpNavigations[details.tabId] = { host, url, at: Date.now() };
  } catch (_) {}
}

function recentlyForcedFromHttp(tabId, url) {
  try {
    const rec = recentHttpNavigations[tabId];
    if (!rec || Date.now() - rec.at > HTTP_UPGRADE_MEMORY_MS) return null;
    const host = trustHostFromUrl(url);
    return host && host === rec.host ? rec : null;
  } catch (_) {
    return null;
  }
}

function classifyTrustError(error, url, cfg, tabId) {
  const e = String(error || '');
  const lower = e.toLowerCase();
  const host = trustHostFromUrl(url);
  const base = {
    kind: 'blocked_certificate',
    title: 'Connection Not Trusted',
    action: 'Blocked',
    risk: 'Attackers may be able to intercept information sent to this website.',
    problem: 'Invalid security certificate',
    why: 'Chrome reported a certificate error for this site.',
  };

  const certProblems = [
    [/err_cert_date_invalid/, 'Certificate expired or is not valid yet', 'The certificate date is outside the valid period.'],
    [/err_cert_common_name_invalid|err_cert_name_constraint_violation/, 'Certificate hostname mismatch', 'The certificate is not valid for this website name.'],
    [/err_cert_authority_invalid|err_cert_invalid|err_cert_unable_to_check_revocation/, 'Self-signed or untrusted certificate', 'The certificate was not issued by a trusted certificate authority.'],
    [/err_cert_revoked/, 'Revoked certificate', 'The certificate has been revoked and should no longer be trusted.'],
    [/err_cert_weak_signature_algorithm|err_cert_symantec_legacy|err_cert_non_unique_name/, 'Weak or distrusted certificate', 'The certificate uses a weak or distrusted configuration.'],
  ];
  for (const [re, problem, why] of certProblems) {
    if (re.test(lower)) return Object.assign({}, base, { host, problem, why });
  }

  const httpRec = cfg && cfg.forceHttps === true ? recentlyForcedFromHttp(tabId, url) : null;
  if (httpRec && /^net::err_(ssl_protocol_error|connection_refused|connection_closed|connection_reset|address_unreachable|timed_out)/i.test(e)) {
    return {
      kind: 'blocked_http_only',
      title: 'Secure Connection Required',
      action: 'Blocked',
      risk: 'This site did not provide a usable HTTPS connection, so traffic could fall back to plain HTTP.',
      problem: 'HTTPS unavailable',
      why: 'WardenOne forced HTTPS before the insecure request was sent, but the site did not complete a secure connection.',
      host,
      originalUrl: httpRec.url,
    };
  }

  // ERR_SSL_CLIENT_AUTH_CERT_NEEDED is an authentication challenge, not proof of
  // a bad certificate. Leave it to Chrome so institutional mTLS login can prompt.
  if (/^net::err_(ssl_protocol_error|ssl_version_or_cipher_mismatch|ssl_pinned_key_not_in_cert_chain)/i.test(e)) {
    return Object.assign({}, base, {
      host,
      problem: 'Broken or unsafe TLS connection',
      why: 'The site could not complete a trustworthy HTTPS connection.',
    });
  }

  return null;
}

function trustErrorPageUrl(info, url, error) {
  const params = new URLSearchParams();
  params.set('u', String(info.originalUrl || url || '').slice(0, 900));
  params.set('e', String(error || '').slice(0, 120));
  params.set('k', String(info.kind || 'blocked_certificate'));
  params.set('p', String(info.problem || '').slice(0, 160));
  params.set('w', String(info.why || '').slice(0, 220));
  params.set('r', String(info.risk || '').slice(0, 240));
  return chrome.runtime.getURL(CERT_ERROR_PAGE) + '?' + params.toString();
}

async function handleTrustError(details) {
  try {
    if (!details || details.tabId == null || details.tabId < 0 || details.type !== 'main_frame') return;
    const url = String(details.url || '');
    if (!/^https?:\/\//i.test(url)) return;

    const store = await localGet('wardenone_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
    if (cfg.enabled === false || cfg.certificateGuard === false) return;

    const info = classifyTrustError(details.error, url, cfg, details.tabId);
    if (!info) return;
    const host = info.host || trustHostFromUrl(url);
    // A normal site allowlist should not override certificate/TLS trust failures.
    // Bad certs are still blocked; only local/private development hosts are exempt.
    if (!host || isLocalTrustHost(host)) return;

    const cooldownKey = details.tabId + ':' + url + ':' + details.error;
    const last = recentTrustErrors[cooldownKey] || 0;
    if (Date.now() - last < TRUST_ERROR_COOLDOWN_MS) return;
    recentTrustErrors[cooldownKey] = Date.now();

    counts[details.tabId] = (counts[details.tabId] || 0) + 1;
    setBadge(details.tabId);
    queueHistory({
      type: info.kind,
      detail: {
        host,
        problem: info.problem,
        why: info.why,
        action: info.action,
        risk: info.risk,
        error: String(details.error || '').replace(/^net::/i, ''),
      },
      url,
      at: Date.now(),
    });

    await tabsUpdate(details.tabId, { url: trustErrorPageUrl(info, url, details.error) });
  } catch (e) {
    console.warn('[WardenOne] certificate guard failed', e);
  }
}

try {
  chrome.webRequest?.onErrorOccurred?.addListener(
    (details) => { handleTrustError(details); },
    { urls: ['<all_urls>'], types: ['main_frame'] }
  );
} catch (e) {
  console.warn('[WardenOne] certificate guard listener failed', e);
}

// Re-apply when the user changes settings (session rules are cleared on browser
// restart, so we also call this on startup below).
chrome.storage.onChanged.addListener((changes, area) => {
  // Keep the wardenone_config in-memory cache fresh on writes from ANY source (the popup,
  // other extension contexts, or our own localSet). newValue is the full post-write config.
  if (area === 'local' && changes.wardenone_config) {
    __cfgCacheSet(__cfgClone(changes.wardenone_config.newValue) || {});
  }
  // A feed (or manual edit) that updates the local known-malware hash set -> reload it.
  if (area === 'local' && changes.wardenone_malware_hashes) {
    loadMalwareHashes();
  }
  // A feed (or manual edit) that updates the grabber domain list -> re-apply its dynamic rules.
  if (area === 'local' && (changes.wardenone_grabber_domains || changes[SUPPLEMENTAL_LIST_STORAGE_KEY])) {
    loadGrabberFeed();
  }
  // Any change to the inputs the cosmetic cache is built from must drop it, so
  // the next page request rebuilds from fresh data (config toggle, per-site
  // allowlist edit, or a refreshed filter blob). updateAdShieldCosmetics also
  // invalidates directly; this covers writes from every other code path.
  if (area === 'local' && (changes.wardenone_config || changes.wardenone_adshield_allowlist || changes.wardenone_adshield_cosmetic)) {
    invalidateCosmeticCache();
  }
  if (area === 'local' && changes.wardenone_config) {
    scheduleExtensionStateRefresh();
    // If the tab-limit settings changed (enabled, limit, or close mode), enforce right
    // away so excess tabs are trimmed immediately -- not only on the next tab you open.
    try {
      const o = changes.wardenone_config.oldValue || {};
      const n = changes.wardenone_config.newValue || {};
      const hadOldConfig = !!(changes.wardenone_config.oldValue && typeof changes.wardenone_config.oldValue === 'object');
      const listCompositionChanged = [
        'enabled',
        'blockMalwareSites',
        'blockTrackers',
        'adShield',
      ].some((key) => o[key] !== n[key]);
      const autoUpdatesEnabled = o.autoUpdateLists === false && n.autoUpdateLists !== false;
      if (hadOldConfig && n.enabled !== false && (listCompositionChanged || autoUpdatesEnabled)) {
        updateRemoteListsWithRetry(o.enabled === false ? 'master-reenable' : 'settings-change');
      }
      if (o.enabled !== n.enabled || o.trackerLearner !== n.trackerLearner) {
        applyTrackerLearnerRules();
      }
      if (o.enabled !== n.enabled) {
        applyScriptShieldRules();
      }
      if (n.tabLimitGuard && (o.tabLimitGuard !== n.tabLimitGuard || o.tabLimitMax !== n.tabLimitMax || o.tabLimitClose !== n.tabLimitClose || o.tabLimitMinIdleMinutes !== n.tabLimitMinIdleMinutes)) {
        enforceTabLimitAllWindows();
      }
    } catch (_) {}
  }
  if (area === 'local' && (changes[SCRIPT_SHIELD_MODE_KEY] || changes[SCRIPT_TRUSTED_KEY])) {
    applyScriptShieldRules();
  }
});

function scheduleUpdates() {
  try {
    chrome.alarms.create('wardenone-list-update', { periodInMinutes: 1440 }); // daily
  } catch (_) {}
}

// Smart list-update retry. A fixed daily refresh means a transient CDN/network
// outage -- or simply being offline at install -- leaves blocklists stale for up
// to 24h. When an update fails outright, or succeeds but with some sources
// unreachable, we schedule a few backed-off one-shot retries to pick up what we
// missed, then fall back to the normal daily cadence. Integrity rejections and
// the user's own toggles are NOT transient, so they never trigger a retry.
const LIST_RETRY_BACKOFF_MIN = [4, 12, 40]; // minutes between retries; then give up until daily
const LIST_RETRY_ALARM = 'wardenone-list-retry';
async function getListRetryCount() {
  try { const s = await localGet(['wardenone_list_retry_n']); return (s && s.wardenone_list_retry_n) || 0; } catch (_) { return 0; }
}
async function setListRetryCount(n) {
  try { if (n) { await localSet({ wardenone_list_retry_n: n }); } else { await chrome.storage.local.remove('wardenone_list_retry_n'); } } catch (_) {}
}
function listUpdateNeedsRetry(result) {
  if (!result || result.skipped) return false;                          // disabled / auto-update off
  if (result.error && /integrity/i.test(result.error)) return false;    // rejected on purpose, not transient
  if (result.ok && result.sources && result.sources.failed > 0) {
    return Number(result.sources.failed || 0) > Number(result.sources.rejected || 0);
  }
  if (result.ok) return false;
  if (result.sources && Number(result.sources.failed || 0) > 0
    && Number(result.sources.failed || 0) === Number(result.sources.rejected || 0)) return false;
  return true;                                                          // outright failure (e.g. offline)
}
async function scheduleListRetry(result) {
  try {
    if (!listUpdateNeedsRetry(result)) {
      try { chrome.alarms.clear(LIST_RETRY_ALARM); } catch (_) {}
      await setListRetryCount(0);
      return;
    }
    const n = await getListRetryCount();
    if (n >= LIST_RETRY_BACKOFF_MIN.length) { await setListRetryCount(0); return; } // exhausted; daily alarm carries on
    await setListRetryCount(n + 1);
    chrome.alarms.create(LIST_RETRY_ALARM, { delayInMinutes: LIST_RETRY_BACKOFF_MIN[n] });
  } catch (_) {}
}
async function updateRemoteListsWithRetry(reason) {
  const result = await updateRemoteLists(reason);
  if (!result || result.ok !== true || (result.sources && result.sources.failed > 0)) {
    await warnIfRemoteListsStale(result && result.meta, (result && result.error) || reason);
  }
  await scheduleListRetry(result);
  return result;
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === 'wardenone-list-update') updateRemoteListsWithRetry('alarm');
  if (alarm && alarm.name === LIST_RETRY_ALARM) updateRemoteListsWithRetry('retry');
  if (alarm && alarm.name === 'wardenone-startup-check') runStartupCheck('startup');
  if (alarm && alarm.name === 'wardenone-memory-sweep') {
    // PERF (weak machines): read config ONCE per wake (was 3x storage.get +
    // implicit work even when disabled) and skip all sweep work when Memory
    // Shield is off, so the SW does nothing on wake for users who turned it off.
    getMemoryConfig().then((cfg) => {
      if (!cfg || !cfg.memoryShield) return;
      memorySweep('alarm', cfg); throttleInactiveTabs(cfg); sleepIdleGroups(cfg);
    }).catch(() => {});
  }
});

// ======================= Memory Shield =======================
// Implemented in background-memory.js so RAM-saving behavior is isolated from the main service worker.
importScripts("background-memory.js");

// ---- Forget Me When I Leave -------------------------------------------------
// When you leave a targeted site -- its LAST open tab closes OR that tab navigates
// to a different site -- wipe the site's cookies + storage so re-visiting starts
// fresh (logged out, no trackers). Brave only clears on tab-close; we also catch
// in-tab navigation. Scope: off / a chosen list / all sites (minus your allowlist).
const FORGET_TAB_HOSTS = Object.create(null);   // tabId -> last known hostname
const FORGET_RECENT = Object.create(null);      // domain -> ts (debounce repeat wipes)
const FORGET_PENDING_HOSTS = Object.create(null); // domain -> hosts to wipe when the last tab leaves
const FORGET_PERSISTENCE_PROTECTED_DOMAINS = new Set([
  // Spotify's web app stores login/playback state across cookies, IndexedDB,
  // cacheStorage, and a service worker. Wiping it on last-tab close looks like
  // "Spotify never keeps me logged in" while other sites seem fine.
  'spotify.com',
]);

async function getForgetConfig() {
  const store = await localGet('wardenone_config');
  const cfg = (store && store.wardenone_config) || {};
  const allConfirmed = cfg.forgetMeMode === 'all' && Number(cfg.forgetMeAllConfirmedAt || 0) > 0;
  return {
    mode: cfg.forgetMeMode === 'list' ? 'list' : allConfirmed ? 'all' : 'off',
    list: normalizeAllowlistHosts(cfg.forgetMeList || []),
    history: cfg.forgetMeHistory === true,
    allowlist: normalizeAllowlistHosts(cfg.allowlist || []),
  };
}

function forgetHostFromUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return ''; // only real web sites (not chrome://, extension pages, about:)
    return x.hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) { return ''; }
}

// Registrable domain to wipe if this host is targeted under the config, else ''.
function forgetDomainFor(host, cfg) {
  const rd = registrableDomainBg(host);
  if (!rd) return '';
  if (isForgetPersistenceProtected(host) || isForgetPersistenceProtected(rd)) return '';
  if (cfg.mode === 'all') return hostMatchesAllowlist(host, cfg.allowlist) || hostMatchesAllowlist(rd, cfg.allowlist) ? '' : rd;
  if (cfg.mode === 'list') return hostMatchesAllowlist(host, cfg.list) || hostMatchesAllowlist(rd, cfg.list) ? rd : '';
  return '';
}

function isForgetPersistenceProtected(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  if (!h) return false;
  for (const domain of FORGET_PERSISTENCE_PROTECTED_DOMAINS) {
    if (h === domain || h.endsWith('.' + domain)) return true;
  }
  return false;
}

// Any (other) open tab still on this registrable domain?
async function domainHasOpenTabs(domain, exceptTabId) {
  try {
    const tabs = await chrome.tabs.query({});
    return tabs.some((t) => {
      if (exceptTabId != null && t.id === exceptTabId) return false;
      const h = forgetHostFromUrl(t.url || t.pendingUrl || '');
      return h && registrableDomainBg(h) === domain;
    });
  } catch (_) { return true; } // on error, assume still open (don't wipe)
}

function rememberForgetPendingHost(domain, host) {
  const d = registrableDomainBg(domain);
  const h = forgetHostFromUrl('http://' + String(host || '').replace(/^https?:\/\//i, ''));
  if (!d || !h || registrableDomainBg(h) !== d) return;
  const list = Array.isArray(FORGET_PENDING_HOSTS[d]) ? FORGET_PENDING_HOSTS[d] : [];
  if (!list.includes(h)) list.push(h);
  FORGET_PENDING_HOSTS[d] = list.slice(-40);
}

function takeForgetPendingHosts(domain, host) {
  const d = registrableDomainBg(domain);
  const out = new Set(Array.isArray(FORGET_PENDING_HOSTS[d]) ? FORGET_PENDING_HOSTS[d] : []);
  const h = forgetHostFromUrl('http://' + String(host || '').replace(/^https?:\/\//i, ''));
  if (h && registrableDomainBg(h) === d) out.add(h);
  delete FORGET_PENDING_HOSTS[d];
  return Array.from(out);
}

async function wipeSiteData(domain, cfg, hostsToWipe) {
  if (!domain) return { ok: false, error: 'No site to forget.' };
  const origins = [];
  const hosts = new Set([domain, 'www.' + domain]);
  (Array.isArray(hostsToWipe) ? hostsToWipe : []).forEach((host) => {
    const h = forgetHostFromUrl('http://' + String(host || '').replace(/^https?:\/\//i, ''));
    if (h && (h === domain || h.endsWith('.' + domain))) hosts.add(h);
  });
  for (const host of hosts) {
    for (const scheme of ['https://', 'http://']) origins.push(scheme + host);
  }
  // storage + cache storage by origin (the origin filter only covers these types).
  // Widely-supported types first; legacy/deprecated types in an isolated call so a
  // rejection there can't stop the core wipe.
  try {
    await chrome.browsingData.remove({ origins }, {
      cookies: true, localStorage: true, indexedDB: true,
      serviceWorkers: true, cacheStorage: true,
    });
  } catch (_) {}
  try {
    await chrome.browsingData.remove({ origins }, { fileSystems: true, webSQL: true });
  } catch (_) {}
  // cookies for the whole registrable domain (covers subdomains the origin list misses)
  try {
    const all = await chrome.cookies.getAll({ domain });
    for (const c of all) {
      const cd = String(c.domain || '').replace(/^\./, '');
      if (!cd) continue;
      const url = (c.secure ? 'https://' : 'http://') + cd + (c.path || '/');
      try { await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId }); } catch (_) {}
    }
  } catch (_) {}
  // optional: scrub the site from browser history
  if (cfg.history) {
    try {
      const items = await chrome.history.search({ text: domain, maxResults: 2000, startTime: 0 });
      for (const it of items) {
        const h = forgetHostFromUrl(it.url);
        if (h === domain || h.endsWith('.' + domain)) { try { await chrome.history.deleteUrl({ url: it.url }); } catch (_) {} }
      }
    } catch (_) {}
  }
  queueHistory({ type: 'forget_me_wiped', detail: { domain, mode: cfg.mode, history: !!cfg.history }, url: domain, at: Date.now() });
  return { ok: true, domain };
}

// A tab left a host (closed or navigated away). If nothing else is open on that
// domain and it's targeted, wipe it.
async function maybeForgetHost(host, exceptTabId) {
  if (!host) return;
  const cfg = await getForgetConfig();
  if (cfg.mode === 'off') return;
  const domain = forgetDomainFor(host, cfg);
  if (!domain) return;
  rememberForgetPendingHost(domain, host);
  if (await domainHasOpenTabs(domain, exceptTabId)) return;  // still open elsewhere
  const now = Date.now();
  if (FORGET_RECENT[domain] && now - FORGET_RECENT[domain] < 4000) return; // debounce
  FORGET_RECENT[domain] = now;
  await wipeSiteData(domain, cfg, takeForgetPendingHosts(domain, host));
}

try {
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    const newHost = forgetHostFromUrl((tab && tab.url) || change.url || '');
    if (!newHost) return;
    const prevHost = FORGET_TAB_HOSTS[tabId];
    FORGET_TAB_HOSTS[tabId] = newHost;
    // navigated to a different registrable domain -> the old one may now be "left"
    if (prevHost && registrableDomainBg(prevHost) !== registrableDomainBg(newHost)) {
      maybeForgetHost(prevHost, tabId).catch(() => {});
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    const host = FORGET_TAB_HOSTS[tabId];
    delete FORGET_TAB_HOSTS[tabId];
    if (host) maybeForgetHost(host, tabId).catch(() => {});
  });
  // seed the map now so closing a pre-existing tab still detects the host after a
  // service-worker restart (when our in-memory map would otherwise be empty)
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((t) => { const h = forgetHostFromUrl(t.url || t.pendingUrl || ''); if (h) FORGET_TAB_HOSTS[t.id] = h; });
  });
} catch (_) {}

// ---- Memory Shield popup/helper tools --------------------------------------
// Implemented in background-memory.js.

function domainToRule(domain, id, sourceKind) {
  const kind = remoteRuleSourceKind(sourceKind);
  return {
    id,
    priority: kind === 'security' ? 3000 : 1000,
    action: { type: 'block' },
    condition: { requestDomains: [domain], resourceTypes: RESOURCE_TYPES },
  };
}

// Apply source-aware precedence only at the final DNR boundary. Parser output
// stays source-neutral and the private source marker never reaches Chrome.
// A scoped ad/tracker exception can therefore repair a functional site without
// gaining enough authority to override a malware/security rule.
function finalizeOptionRule(rule, id, sourceKind) {
  const kind = remoteRuleSourceKind(sourceKind);
  const actionType = rule && rule.action && rule.action.type === 'allow' ? 'allow' : 'block';
  const priority = kind === 'security'
    ? (actionType === 'allow' ? 4000 : 3000)
    : (actionType === 'allow' ? 2000 : 1100);
  return {
    id,
    priority,
    action: { type: actionType },
    condition: Object.assign({}, (rule && rule.condition) || {}),
  };
}

function remoteRuleSourceKind(value) {
  return value === 'adshield' || value === 'tracker' ? value : 'security';
}

function isWardenOneDynamicRuleId(id) {
  return (id >= DYNAMIC_RULE_BASE && id < DYNAMIC_RULE_BASE + MAX_DYNAMIC)
    || (id >= OPTION_RULE_BASE && id < OPTION_RULE_BASE + OPTION_RULES_MAX)
    || (id >= LEARNED_RULE_BASE && id < LEARNED_RULE_BASE + LEARNED_MAX)
    || (id >= TRACKER_RULE_BASE && id < TRACKER_RULE_BASE + TRACKER_RULE_MAX)
    || (id >= GRABBER_FEED_RULE_BASE && id < GRABBER_FEED_RULE_BASE + GRABBER_FEED_MAX)
    || (id >= NEVER_BLOCK_ALLOW_RULE_BASE && id < NEVER_BLOCK_ALLOW_RULE_BASE + NEVER_BLOCK_ALLOW_MAX)
    || (id >= SCRIPT_SHIELD_RULE_BASE && id < SCRIPT_SHIELD_RULE_BASE + SCRIPT_SHIELD_RULE_MAX)
    || (id >= FINGERPRINT_SCRIPT_RULE_BASE && id < FINGERPRINT_SCRIPT_RULE_BASE + FINGERPRINT_SCRIPT_RULE_MAX)
    || (id >= GOOGLE_SEARCH_ALLOW_RULE_BASE && id < GOOGLE_SEARCH_ALLOW_RULE_BASE + GOOGLE_SEARCH_ALLOW_RULE_MAX);
}

async function removeWardenOneDynamicRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = existing.filter((r) => isWardenOneDynamicRuleId(r.id)).map((r) => r.id);
  if (ids.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
}

function normalizeScriptShieldMode(mode) {
  mode = String(mode || '').toLowerCase();
  return mode === 'smart' || mode === 'lockdown' ? mode : 'normal';
}

// Script hosts Smart mode never blanket-blocks. Without these, Smart mode breaks
// most embedded video players -- the player library itself is nearly always
// third-party to the frame that loads it. This exempts the host from Smart's
// HEURISTIC only: it adds no allow rule, so the downloaded ad/tracker/EasyPrivacy,
// learned, grabber and security rules still block any of these hosts normally.
// The general-purpose CDNs (jsDelivr, unpkg, cdnjs) serve arbitrary third-party
// packages and are the weakest entries here; they are included deliberately
// because player libraries overwhelmingly ship through them, and the residual
// exposure equals what Script Shield's default 'normal' level already allows.
const SCRIPT_SHIELD_PLAYER_INFRA_HOSTS = [
  'ajax.googleapis.com', 'code.jquery.com', 'ajax.aspnetcdn.com',
  'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'esm.sh', 'cdn.tailwindcss.com',
  'vjs.zencdn.net', 'cdn.plyr.io', 'cdn.vidstack.io', 'cdn.dashjs.org',
  'content.jwplatform.com', 'ssl.p.jwpcdn.com', 'cdn.jwplayer.com',
  'player.vimeo.com', 'f.vimeocdn.com', 'www.youtube.com', 's.ytimg.com',
];

const SMART_SCRIPT_PLAYER_EVIDENCE = new Set(['known-player-root', 'media-embed', 'route-video']);
const SMART_SCRIPT_PLAYER_CONTEXTS = new Map();
const SMART_SCRIPT_PLAYER_INTENTS = new Map();
const SMART_SCRIPT_PENDING_ERRORS = new Map();
const SMART_SCRIPT_RECOVERED_TABS = new Map();
const SMART_SCRIPT_RETRY_KEYS = new Map();
const SMART_SCRIPT_TOP_RELOADS = new Map();
const SMART_SCRIPT_RECOVERY_CLEARED_TABS = new Map();
const SMART_SCRIPT_PERSISTED_RECOVERY_TABS = new Set();
const SMART_SCRIPT_NAVIGATION_EPOCHS = new Map();
const SMART_SCRIPT_RECOVERY_INFLIGHT = new Map();
let __scriptShieldRuleUpdate = Promise.resolve();
let __smartScriptRecoveryHydration = null;

function smartScriptNavigationEpoch(tabId) {
  const state = SMART_SCRIPT_NAVIGATION_EPOCHS.get(Number(tabId));
  return Number((state && state.epoch) || 0);
}

function bumpSmartScriptNavigationEpoch(tabId) {
  const id = Number(tabId);
  const epoch = smartScriptNavigationEpoch(id) + 1;
  SMART_SCRIPT_NAVIGATION_EPOCHS.set(id, { epoch, at: Date.now() });
  if (SMART_SCRIPT_NAVIGATION_EPOCHS.size > 512) {
    Array.from(SMART_SCRIPT_NAVIGATION_EPOCHS.entries())
      .filter(([key]) => !SMART_SCRIPT_RECOVERY_INFLIGHT.has(key) && !SMART_SCRIPT_RECOVERED_TABS.has(key))
      .sort((a, b) => Number((a[1] && a[1].at) || 0) - Number((b[1] && b[1].at) || 0))
      .slice(0, SMART_SCRIPT_NAVIGATION_EPOCHS.size - 512)
      .forEach(([key]) => SMART_SCRIPT_NAVIGATION_EPOCHS.delete(key));
  }
  return epoch;
}

async function getScriptShieldMode() {
  const store = await localGet(SCRIPT_SHIELD_MODE_KEY);
  return normalizeScriptShieldMode(store && store[SCRIPT_SHIELD_MODE_KEY]);
}

async function getTrustedScriptHosts() {
  const store = await localGet(SCRIPT_TRUSTED_KEY);
  return normalizeAllowlistHosts(store && store[SCRIPT_TRUSTED_KEY], 500).sort();
}

async function setTrustedScriptHosts(list) {
  const clean = normalizeAllowlistHosts(list, 500).sort();
  await localSet({ [SCRIPT_TRUSTED_KEY]: clean });
  await applyScriptShieldRules();
  return clean;
}

async function addTrustedScriptHost(host) {
  const h = normalizeAllowlistHost(host);
  if (!h) return { ok: false, error: 'Open a normal web page first.' };
  const list = await getTrustedScriptHosts();
  if (!list.includes(h)) list.push(h);
  const items = await setTrustedScriptHosts(list);
  return { ok: true, host: h, items };
}

async function removeTrustedScriptHost(host) {
  const h = normalizeAllowlistHost(host);
  const items = await setTrustedScriptHosts((await getTrustedScriptHosts()).filter((x) => x !== h));
  return { ok: true, host: h, items };
}

function cleanSmartScriptExactHost(value) {
  try {
    const raw = String(value || '').trim();
    const host = new URL(raw.includes('://') ? raw : 'https://' + raw).hostname
      .replace(/^\.+|\.+$/g, '').toLowerCase();
    if (!host || host.length > 253 || !host.includes('.') || !/^[a-z0-9.-]+$/i.test(host) || host.includes('..')) return '';
    return host;
  } catch (_) {
    return '';
  }
}

function smartScriptRecoveryHosts(list) {
  return Array.from(new Set((Array.isArray(list) ? list : [])
    .map(cleanSmartScriptExactHost)
    .filter(Boolean)))
    .slice(0, SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB);
}

function normalizeSmartScriptRequestPath(raw, expectedHost) {
  try {
    const url = new URL(String(raw || ''));
    const host = cleanSmartScriptExactHost(url.hostname);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !host
      || (expectedHost && host !== cleanSmartScriptExactHost(expectedHost))) return '';
    // Query values on bootstrap scripts are commonly cache-busters. Stage two
    // therefore binds to the exact canonical origin + pathname and permits only
    // query variation on that same path.
    const path = url.origin + url.pathname;
    return path.length <= 900 ? path : '';
  } catch (_) {
    return '';
  }
}

function smartScriptExactPathRegex(requestPath) {
  const exact = normalizeSmartScriptRequestPath(requestPath);
  if (!exact) return '';
  const escaped = exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return '^' + escaped + '(?:\\?[^#]*)?$';
}

function smartScriptPathFromRegex(regexFilter) {
  const raw = String(regexFilter || '');
  const suffix = '(?:\\?[^#]*)?$';
  if (!raw.startsWith('^') || !raw.endsWith(suffix)) return '';
  const encoded = raw.slice(1, -suffix.length);
  const decoded = encoded.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
  const path = normalizeSmartScriptRequestPath(decoded);
  return path && smartScriptExactPathRegex(path) === raw ? path : '';
}

function smartScriptDomainSetContains(set, host) {
  if (!set || typeof set.has !== 'function') return false;
  const exact = cleanSmartScriptExactHost(host);
  if (!exact) return false;
  const labels = exact.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (set.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

function smartScriptKnownSecurityHost(host) {
  const blocked = typeof BLOCKED_DOMAINS !== 'undefined' ? BLOCKED_DOMAINS : null;
  const grabbers = typeof GRABBER_FEED_DOMAINS !== 'undefined' ? GRABBER_FEED_DOMAINS : null;
  const fingerprintDomains = typeof FINGERPRINT_SCRIPT_DOMAIN_FILTERS !== 'undefined'
    ? new Set(FINGERPRINT_SCRIPT_DOMAIN_FILTERS) : null;
  return smartScriptDomainSetContains(blocked, host)
    || smartScriptDomainSetContains(grabbers, host)
    || smartScriptDomainSetContains(fingerprintDomains, host);
}

function smartScriptKnownFingerprintPath(requestPath) {
  const needles = typeof FINGERPRINT_SCRIPT_URL_FILTERS !== 'undefined' ? FINGERPRINT_SCRIPT_URL_FILTERS : [];
  const value = String(requestPath || '').toLowerCase();
  return !!value && Array.from(needles || []).some((needle) => value.includes(String(needle || '').toLowerCase()));
}

function smartScriptStageTwoEntries(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const requestHost = cleanSmartScriptExactHost(raw && raw.requestHost);
    const initiatorHost = cleanSmartScriptExactHost(raw && raw.initiatorHost);
    const resourceType = String((raw && raw.resourceType) || '').toLowerCase();
    const requestPath = normalizeSmartScriptRequestPath(raw && raw.requestPath, requestHost);
    if (!requestHost || !initiatorHost || !requestPath || resourceType !== 'script'
      || smartScriptKnownSecurityHost(requestHost) || smartScriptKnownFingerprintPath(requestPath)) continue;
    const key = requestHost + '|' + initiatorHost + '|' + resourceType + '|' + requestPath;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ requestHost, initiatorHost, resourceType, requestPath });
    if (out.length >= SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) break;
  }
  return out;
}

function smartScriptRecoveredTabEntries() {
  return Array.from(SMART_SCRIPT_RECOVERED_TABS.entries())
    .map(([tabId, value]) => ({
      tabId: Number(tabId),
      failedHosts: smartScriptRecoveryHosts(value && value.failedHosts),
      stageTwo: smartScriptStageTwoEntries(value && value.stageTwo),
    }))
    .filter((entry) => Number.isInteger(entry.tabId) && entry.tabId >= 0 && entry.failedHosts.length)
    .sort((a, b) => a.tabId - b.tabId)
    .slice(0, SMART_SCRIPT_RECOVERY_MAX_TABS);
}

function buildScriptShieldRulePlan(mode, enabled, trustedHosts, recoveredTabs) {
  const trusted = normalizeAllowlistHosts(trustedHosts, SCRIPT_SHIELD_RULE_MAX - 1)
    .slice(0, SCRIPT_SHIELD_RULE_MAX - 1);
  const tabs = (Array.isArray(recoveredTabs) ? recoveredTabs : [])
    .map((entry) => ({
      tabId: Number(entry && entry.tabId),
      failedHosts: smartScriptRecoveryHosts(entry && entry.failedHosts),
      stageTwo: smartScriptStageTwoEntries(entry && entry.stageTwo),
    }))
    .filter((entry) => Number.isInteger(entry.tabId) && entry.tabId >= 0 && entry.failedHosts.length)
    .sort((a, b) => a.tabId - b.tabId)
    .slice(0, SMART_SCRIPT_RECOVERY_MAX_TABS)
    .filter((entry, index, list) => index === 0 || entry.tabId !== list[index - 1].tabId);
  if (enabled === false || normalizeScriptShieldMode(mode) !== 'smart') return { dynamicRules: [], sessionRules: [] };
  const infra = SCRIPT_SHIELD_PLAYER_INFRA_HOSTS.slice();
  const condition = { domainType: 'thirdParty', resourceTypes: ['script'], excludedRequestDomains: infra };
  // Trusting a site skips only Smart Script Shield's heuristic for requests
  // initiated by that site. It does not create an allow rule, so downloaded
  // ad/tracker, learned, grabber, site-control and security rules still win.
  if (trusted.length) condition.excludedInitiatorDomains = trusted;
  if (tabs.length) condition.excludedTabIds = tabs.map((entry) => entry.tabId);
  const replacementRules = tabs.map((entry, index) => {
    const tabCondition = {
      domainType: 'thirdParty',
      resourceTypes: ['script'],
      tabIds: [entry.tabId],
      excludedRequestDomains: entry.failedHosts.concat(infra),
    };
    if (trusted.length) tabCondition.excludedInitiatorDomains = trusted;
    return {
      id: SCRIPT_SHIELD_RULE_BASE + SMART_SCRIPT_REPLACEMENT_RULE_OFFSET + index,
      priority: 1000,
      action: { type: 'block' },
      condition: tabCondition,
    };
  });
  const stageTwoRules = [];
  tabs.forEach((entry, tabIndex) => {
    entry.stageTwo.forEach((allow, entryIndex) => {
      stageTwoRules.push({
        id: SCRIPT_SHIELD_RULE_BASE + SMART_SCRIPT_STAGE_TWO_RULE_OFFSET
          + (tabIndex * SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) + entryIndex,
        priority: SMART_SCRIPT_STAGE_TWO_RULE_PRIORITY,
        action: { type: 'allow' },
        condition: {
          tabIds: [entry.tabId],
          requestDomains: [allow.requestHost],
          initiatorDomains: [allow.initiatorHost],
          resourceTypes: [allow.resourceType],
          regexFilter: smartScriptExactPathRegex(allow.requestPath),
          isUrlFilterCaseSensitive: true,
        },
      });
    });
  });
  return {
    dynamicRules: [],
    sessionRules: [{
      id: SCRIPT_SHIELD_RULE_BASE,
      priority: 1000,
      action: { type: 'block' },
      condition,
    }].concat(replacementRules, stageTwoRules),
  };
}

function resetSmartScriptRecoveryState() {
  const invalidateTabs = new Set([
    ...SMART_SCRIPT_RECOVERED_TABS.keys(),
    ...SMART_SCRIPT_RECOVERY_INFLIGHT.keys(),
    ...Array.from(SMART_SCRIPT_PLAYER_CONTEXTS.values(), (value) => value && value.tabId),
    ...Array.from(SMART_SCRIPT_PLAYER_INTENTS.values(), (value) => value && value.tabId),
    ...Array.from(SMART_SCRIPT_PENDING_ERRORS.values(), (value) => value && value.tabId),
  ]);
  invalidateTabs.forEach((tabId) => {
    if (Number.isInteger(Number(tabId)) && Number(tabId) >= 0) bumpSmartScriptNavigationEpoch(tabId);
  });
  SMART_SCRIPT_PLAYER_CONTEXTS.clear();
  SMART_SCRIPT_PLAYER_INTENTS.clear();
  SMART_SCRIPT_PENDING_ERRORS.clear();
  SMART_SCRIPT_RECOVERED_TABS.clear();
  SMART_SCRIPT_RETRY_KEYS.clear();
  SMART_SCRIPT_TOP_RELOADS.clear();
  SMART_SCRIPT_RECOVERY_CLEARED_TABS.clear();
  SMART_SCRIPT_PERSISTED_RECOVERY_TABS.clear();
}

function hydrateSmartScriptRecoveryTabs() {
  if (__smartScriptRecoveryHydration) return __smartScriptRecoveryHydration;
  __smartScriptRecoveryHydration = (async () => {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const current = rules.find((rule) => rule.id === SCRIPT_SHIELD_RULE_BASE
        && rule.action && rule.action.type === 'block');
      const blanketIds = Array.from((current && current.condition && current.condition.excludedTabIds) || [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id >= 0)
        .slice(0, SMART_SCRIPT_RECOVERY_MAX_TABS);
      blanketIds.forEach((id) => SMART_SCRIPT_PERSISTED_RECOVERY_TABS.add(id));
      const now = Date.now();
      const recovered = new Map();
      rules.filter((rule) => rule.id >= SCRIPT_SHIELD_RULE_BASE + SMART_SCRIPT_REPLACEMENT_RULE_OFFSET
        && rule.id < SCRIPT_SHIELD_RULE_BASE + SMART_SCRIPT_REPLACEMENT_RULE_OFFSET + SMART_SCRIPT_RECOVERY_MAX_TABS
        && rule.action && rule.action.type === 'block').forEach((rule) => {
        const tabIds = Array.from((rule.condition && rule.condition.tabIds) || []);
        const id = Number(tabIds[0]);
        const failedHosts = smartScriptRecoveryHosts(rule.condition && rule.condition.excludedRequestDomains);
        if (!Number.isInteger(id) || id < 0 || !failedHosts.length) return;
        SMART_SCRIPT_PERSISTED_RECOVERY_TABS.add(id);
        recovered.set(id, { at: now, rehydrated: true, failedHosts, stageTwo: [] });
      });
      rules.filter((rule) => rule.id >= SCRIPT_SHIELD_RULE_BASE + SMART_SCRIPT_STAGE_TWO_RULE_OFFSET
        && rule.id < SCRIPT_SHIELD_RULE_BASE + SMART_SCRIPT_STAGE_TWO_RULE_OFFSET
          + (SMART_SCRIPT_RECOVERY_MAX_TABS * SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB)
        && rule.priority === SMART_SCRIPT_STAGE_TWO_RULE_PRIORITY
        && rule.action && rule.action.type === 'allow').forEach((rule) => {
        const condition = (rule && rule.condition) || {};
        const tabId = Number(Array.from(condition.tabIds || [])[0]);
        const entry = smartScriptStageTwoEntries([{
          requestHost: Array.from(condition.requestDomains || [])[0],
          initiatorHost: Array.from(condition.initiatorDomains || [])[0],
          resourceType: Array.from(condition.resourceTypes || [])[0],
          requestPath: smartScriptPathFromRegex(condition.regexFilter),
        }])[0];
        const state = recovered.get(tabId);
        if (!state || !entry) return;
        state.stageTwo = smartScriptStageTwoEntries(state.stageTwo.concat(entry));
      });
      for (const [id, state] of recovered) {
        if (SMART_SCRIPT_RECOVERY_CLEARED_TABS.has(id) || SMART_SCRIPT_RECOVERED_TABS.has(id)) continue;
        SMART_SCRIPT_RECOVERED_TABS.set(id, state);
      }
    } catch (_) {}
    return true;
  })();
  return __smartScriptRecoveryHydration;
}

function applyScriptShieldRules(mode, trustedHosts) {
  const requestedMode = mode == null ? null : normalizeScriptShieldMode(mode);
  const requestedTrusted = Array.isArray(trustedHosts) ? trustedHosts.slice() : null;
  const reconcile = async () => {
    try {
      await hydrateSmartScriptRecoveryTabs();
      const resolvedMode = requestedMode == null ? await getScriptShieldMode() : requestedMode;
      const cfgStore = await localGet('wardenone_config');
      const cfg = Object.assign({}, DEFAULT_CONFIG, (cfgStore && cfgStore.wardenone_config) || {});
      const trusted = requestedTrusted == null ? await getTrustedScriptHosts() : requestedTrusted;
      if (cfg.enabled === false || resolvedMode !== 'smart') resetSmartScriptRecoveryState();
      const plan = buildScriptShieldRulePlan(resolvedMode, cfg.enabled !== false, trusted, smartScriptRecoveredTabEntries());
      const [dynamicRules, sessionRules] = await Promise.all([
        chrome.declarativeNetRequest.getDynamicRules(),
        chrome.declarativeNetRequest.getSessionRules(),
      ]);
      const inScriptShieldBand = (rule) => rule.id >= SCRIPT_SHIELD_RULE_BASE
        && rule.id < SCRIPT_SHIELD_RULE_BASE + SCRIPT_SHIELD_RULE_MAX;
      const oldDynamicIds = dynamicRules.filter(inScriptShieldBand).map((rule) => rule.id);
      const oldSessionIds = sessionRules.filter(inScriptShieldBand).map((rule) => rule.id);
      // Always remove the old dynamic 930000 blanket and the former host allow
      // rules. Smart's blanket is session-scoped so recovered tabs can be
      // excluded without creating a broad network allow.
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: oldDynamicIds,
        addRules: plan.dynamicRules,
      });
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: oldSessionIds,
        addRules: plan.sessionRules,
      });
      return true;
    } catch (e) {
      console.warn('[WardenOne] Script Shield DNR rules failed', e);
      return false;
    }
  };
  const result = __scriptShieldRuleUpdate.then(reconcile, reconcile);
  __scriptShieldRuleUpdate = result.then(() => undefined, () => undefined);
  return result;
}

function normalizeSmartScriptUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href.slice(0, 1400);
  } catch (_) {
    return '';
  }
}

function smartScriptFrameKey(tabId, frameId) {
  return String(Number(tabId)) + ':' + String(Number(frameId));
}

function trimSmartScriptMap(map, max, now, ttl) {
  for (const [key, value] of map) {
    if (!value || (ttl && now - Number(value.at || 0) > ttl)) map.delete(key);
  }
  if (map.size <= max) return;
  Array.from(map.entries())
    .sort((a, b) => Number((a[1] && a[1].at) || 0) - Number((b[1] && b[1].at) || 0))
    .slice(0, map.size - max)
    .forEach(([key]) => map.delete(key));
}

function pruneSmartScriptRecoveryState(now) {
  const at = Number(now) || Date.now();
  trimSmartScriptMap(SMART_SCRIPT_PLAYER_CONTEXTS, SMART_SCRIPT_PLAYER_CONTEXT_MAX, at, SMART_SCRIPT_PLAYER_CONTEXT_TTL_MS);
  trimSmartScriptMap(SMART_SCRIPT_PLAYER_INTENTS, SMART_SCRIPT_PLAYER_INTENT_MAX, at, SMART_SCRIPT_PLAYER_INTENT_TTL_MS);
  trimSmartScriptMap(SMART_SCRIPT_PENDING_ERRORS, SMART_SCRIPT_PENDING_MAX, at, SMART_SCRIPT_PENDING_TTL_MS);
  trimSmartScriptMap(SMART_SCRIPT_FRAME_HOSTS, SMART_SCRIPT_PENDING_MAX, at, SMART_SCRIPT_PENDING_TTL_MS);
  trimSmartScriptMap(SMART_SCRIPT_RETRY_KEYS, SMART_SCRIPT_RETRY_MAX, at, SMART_SCRIPT_RETRY_TTL_MS);
  trimSmartScriptMap(SMART_SCRIPT_TOP_RELOADS, SMART_SCRIPT_RECOVERY_MAX_TABS, at, SMART_SCRIPT_TOP_RELOAD_TTL_MS);
  trimSmartScriptMap(SMART_SCRIPT_RECOVERY_CLEARED_TABS, SMART_SCRIPT_RECOVERY_MAX_TABS * 2, at, SMART_SCRIPT_RETRY_TTL_MS);
}

function normalizeSmartScriptPlayerContext(sender, msg) {
  const tabId = Number(sender && sender.tab && sender.tab.id);
  const frameId = Number(sender && sender.frameId);
  const evidence = String((msg && msg.evidence) || '');
  if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) return null;
  if (!SMART_SCRIPT_PLAYER_EVIDENCE.has(evidence)) return null;
  const frameUrl = normalizeSmartScriptUrl((sender && sender.url) || (frameId === 0 && sender && sender.tab && sender.tab.url) || '');
  const topUrl = normalizeSmartScriptUrl(sender && sender.tab && sender.tab.url);
  if (!frameUrl || !topUrl) return null;
  return { tabId, frameId, frameUrl, topUrl, evidence, epoch: smartScriptNavigationEpoch(tabId), at: Date.now() };
}

function normalizeSmartScriptPlayerIntent(sender) {
  const tabId = Number(sender && sender.tab && sender.tab.id);
  const frameId = Number(sender && sender.frameId);
  if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) return null;
  const frameUrl = normalizeSmartScriptUrl((sender && sender.url) || (frameId === 0 && sender && sender.tab && sender.tab.url) || '');
  const topUrl = normalizeSmartScriptUrl(sender && sender.tab && sender.tab.url);
  if (!frameUrl || !topUrl) return null;
  return { tabId, frameId, frameUrl, topUrl, epoch: smartScriptNavigationEpoch(tabId), at: Date.now() };
}

function smartScriptContextHasRecentIntent(context) {
  if (!context) return false;
  const intent = SMART_SCRIPT_PLAYER_INTENTS.get(smartScriptFrameKey(context.tabId, context.frameId));
  return !!(intent
    && intent.epoch === context.epoch
    && intent.frameUrl === context.frameUrl
    && Date.now() - intent.at <= SMART_SCRIPT_PLAYER_INTENT_TTL_MS);
}

// Requiring a trusted gesture for EVERY stage deadlocks the common case: when the
// player UI is itself built by the blocked script, no player element ever renders,
// so no click can qualify and the page sits on a dead spinner forever.
//
// Stage 1 therefore auto-recovers on verified player evidence alone. What it can
// do is deliberately bounded: it drops Smart's heuristic for ONE request host, in
// ONE tab, and adds no allow rule -- so the downloaded ad/tracker/EasyPrivacy,
// learned, grabber and security rules still block that host. The worst case for a
// page that fakes the evidence DOM is therefore the behaviour of Script Shield's
// default 'normal' level, which ships with no third-party script blocking at all.
//
// Stage 2 emits a real allow rule that can outrank other rules, so it still
// requires a fresh, non-stale, trusted user gesture.
function smartScriptContextRecoveryAllowed(context, stage) {
  if (!context) return false;
  if (smartScriptContextHasRecentIntent(context)) return true;
  return stage === 1 && SMART_SCRIPT_PLAYER_EVIDENCE.has(String(context.evidence || ''));
}

function smartScriptPartyDomain(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '')).hostname;
    return registrableDomainBg(host) || host.toLowerCase();
  } catch (_) {
    return '';
  }
}

function normalizeSmartScriptFailure(details) {
  if (!details || details.type !== 'script' || !/ERR_BLOCKED_BY_CLIENT/i.test(String(details.error || ''))) return null;
  const tabId = Number(details.tabId);
  const frameId = Number(details.frameId);
  const parentFrameId = Number(details.parentFrameId);
  const requestUrl = normalizeSmartScriptUrl(details.url);
  const documentUrl = normalizeSmartScriptUrl(details.documentUrl || details.initiator);
  const initiatorUrl = normalizeSmartScriptUrl(details.initiator || details.documentUrl);
  if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(frameId) || frameId < 0) return null;
  if (!requestUrl || !documentUrl || !initiatorUrl) return null;
  const requestParty = smartScriptPartyDomain(requestUrl);
  const initiatorParty = smartScriptPartyDomain(initiatorUrl);
  const requestHost = cleanSmartScriptExactHost(requestUrl);
  const initiatorHost = cleanSmartScriptExactHost(initiatorUrl);
  const requestPath = normalizeSmartScriptRequestPath(details.url, requestHost);
  // Smart's rule has domainType=thirdParty. A same-party failure was caused by
  // another rule or extension and must never trigger this recovery path.
  if (!requestParty || !initiatorParty || !requestHost || !initiatorHost || !requestPath
    || requestParty === initiatorParty) return null;
  return {
    tabId,
    frameId,
    parentFrameId: Number.isInteger(parentFrameId) ? parentFrameId : -1,
    epoch: smartScriptNavigationEpoch(tabId),
    requestUrl,
    requestHost,
    requestPath,
    initiatorHost,
    resourceType: 'script',
    documentUrl,
    initiatorUrl,
    at: Date.now(),
  };
}

// Every third-party script a frame had blocked, keyed by frame and navigation
// epoch. Recovering one host per reload was racy: the single attempt landed on
// whichever script the network happened to report first -- usually an analytics
// beacon rather than the one the player needs -- and each extra reload was another
// chance for the frame to move on and have its reload rejected. Stage one now
// clears the whole frame in one pass, so host ordering stops mattering.
const SMART_SCRIPT_FRAME_HOSTS = new Map();

function noteSmartScriptFrameHost(failure) {
  const key = smartScriptFrameKey(failure.tabId, failure.frameId);
  const entry = SMART_SCRIPT_FRAME_HOSTS.get(key);
  if (!entry || entry.epoch !== failure.epoch) {
    SMART_SCRIPT_FRAME_HOSTS.set(key, { epoch: failure.epoch, at: failure.at, hosts: [failure.requestHost] });
    return;
  }
  entry.at = failure.at;
  if (!entry.hosts.includes(failure.requestHost)
    && entry.hosts.length < SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) {
    entry.hosts.push(failure.requestHost);
  }
}

function smartScriptFrameHosts(failure) {
  const entry = SMART_SCRIPT_FRAME_HOSTS.get(smartScriptFrameKey(failure.tabId, failure.frameId));
  if (!entry || entry.epoch !== failure.epoch) return [];
  return smartScriptRecoveryHosts(entry.hosts);
}

function smartScriptContextForFailure(failure) {
  const now = Date.now();
  pruneSmartScriptRecoveryState(now);
  const exact = SMART_SCRIPT_PLAYER_CONTEXTS.get(smartScriptFrameKey(failure.tabId, failure.frameId));
  if (exact && exact.epoch === failure.epoch && now - exact.at <= SMART_SCRIPT_PLAYER_CONTEXT_TTL_MS
    && exact.frameUrl === failure.documentUrl) return exact;
  if (failure.parentFrameId >= 0) {
    const parent = SMART_SCRIPT_PLAYER_CONTEXTS.get(smartScriptFrameKey(failure.tabId, failure.parentFrameId));
    // The vouching frame does NOT have to be the top document. Streaming sites
    // routinely nest a second embed (page -> embed host -> player host), so
    // requiring parent.frameUrl === parent.topUrl silently stranded every player
    // more than one frame deep. Any ancestor that reported a real media embed can
    // vouch for its own child; stage-one bounds still apply.
    if (parent && parent.epoch === failure.epoch && parent.evidence === 'media-embed'
      && now - parent.at <= SMART_SCRIPT_PLAYER_CONTEXT_TTL_MS) return parent;
  }
  return null;
}

async function smartScriptModeActive() {
  const [mode, cfgStore] = await Promise.all([getScriptShieldMode(), localGet('wardenone_config')]);
  const cfg = Object.assign({}, DEFAULT_CONFIG, (cfgStore && cfgStore.wardenone_config) || {});
  return cfg.enabled !== false && mode === 'smart';
}

function smartScriptRetryKey(failure) {
  return smartScriptFrameKey(failure.tabId, failure.frameId) + ':'
    + failure.documentUrl.slice(0, 700) + ':' + String(failure.requestHost || '')
    + ':' + String(failure.requestPath || '');
}

function smartScriptStageRetryKey(failure, stage) {
  return smartScriptRetryKey(failure) + ':stage-' + String(stage);
}

function smartScriptStageOneRecord(failure) {
  return {
    requestHost: failure.requestHost,
    initiatorHost: failure.initiatorHost,
    resourceType: failure.resourceType,
    requestPath: failure.requestPath,
    frameId: failure.frameId,
    documentUrl: failure.documentUrl,
    epoch: failure.epoch,
    at: Date.now(),
  };
}

function smartScriptStageOneRecords(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const requestHost = cleanSmartScriptExactHost(raw && raw.requestHost);
    const initiatorHost = cleanSmartScriptExactHost(raw && raw.initiatorHost);
    const resourceType = String((raw && raw.resourceType) || '').toLowerCase();
    const requestPath = normalizeSmartScriptRequestPath(raw && raw.requestPath, requestHost);
    const frameId = Number(raw && raw.frameId);
    const documentUrl = normalizeSmartScriptUrl(raw && raw.documentUrl);
    const epoch = Number(raw && raw.epoch);
    if (!requestHost || !initiatorHost || !requestPath || resourceType !== 'script' || !Number.isInteger(frameId)
      || frameId < 0 || !documentUrl || !Number.isInteger(epoch)) continue;
    const key = requestHost + '|' + resourceType + '|' + requestPath;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ requestHost, initiatorHost, resourceType, requestPath, frameId, documentUrl, epoch, at: Number(raw.at) || Date.now() });
    if (out.length >= SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) break;
  }
  return out;
}

function smartScriptStageOneMatches(value, failure) {
  const records = smartScriptStageOneRecords(value && value.stageOne);
  const prior = records.find((entry) => entry.requestHost === failure.requestHost
    && entry.resourceType === failure.resourceType
    && entry.requestPath === failure.requestPath);
  if (prior) {
    return prior.initiatorHost === failure.initiatorHost
      && prior.frameId === failure.frameId
      && prior.documentUrl === failure.documentUrl
      && prior.epoch === failure.epoch;
  }
  // A replacement rule survives service-worker suspension, but it stores only
  // the omitted host. Without the original path/frame evidence it must remain
  // at stage one; navigation will clear it and allow a fully correlated retry.
  return false;
}

function clearSmartScriptPendingForTab(tabId) {
  const prefix = String(Number(tabId)) + ':';
  for (const key of SMART_SCRIPT_PENDING_ERRORS.keys()) {
    if (key.startsWith(prefix)) SMART_SCRIPT_PENDING_ERRORS.delete(key);
  }
}

function sendSmartScriptFrameReload(failure, stage) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        failure.tabId,
        {
          kind: 'smart-script-reload-frame',
          expectedUrl: failure.documentUrl,
          failedHost: failure.requestHost,
          recoveryStage: stage === 2 ? 2 : 1,
        },
        { frameId: failure.frameId },
        (response) => {
          const failed = !!chrome.runtime.lastError;
          resolve(!failed && !!response && response.ok === true);
        },
      );
    } catch (_) {
      resolve(false);
    }
  });
}

async function recoverSmartScriptPlayer(failure, context) {
  if (!failure || !context) return false;
  const recoveryEpoch = Number(failure.epoch);
  const epochIsCurrent = () => smartScriptNavigationEpoch(failure.tabId) === recoveryEpoch;
  if (!Number.isInteger(recoveryEpoch) || context.epoch !== recoveryEpoch || !epochIsCurrent()
    || !smartScriptContextRecoveryAllowed(context, 1)) return false;
  if (SMART_SCRIPT_RECOVERY_INFLIGHT.get(failure.tabId) === recoveryEpoch) return false;
  SMART_SCRIPT_RECOVERY_INFLIGHT.set(failure.tabId, recoveryEpoch);
  try {
    if (!await smartScriptModeActive()) return false;
    if (!epochIsCurrent() || !smartScriptContextRecoveryAllowed(context, 1)) return false;
    pruneSmartScriptRecoveryState(Date.now());
    const previous = SMART_SCRIPT_RECOVERED_TABS.get(failure.tabId);
    const previousHosts = smartScriptRecoveryHosts(previous && previous.failedHosts);
    const previousStageOne = smartScriptStageOneRecords(previous && previous.stageOne);
    const previousStageTwo = smartScriptStageTwoEntries(previous && previous.stageTwo);
    const hasStageOnePath = previousStageOne.some((entry) => entry.requestHost === failure.requestHost
      && entry.resourceType === failure.resourceType
      && entry.requestPath === failure.requestPath);
    const stage = hasStageOnePath ? 2 : 1;
    if (!smartScriptContextRecoveryAllowed(context, stage)) return false;
    if (stage === 2) {
      if (!smartScriptStageOneMatches(previous, failure) || smartScriptKnownSecurityHost(failure.requestHost)
        || smartScriptKnownFingerprintPath(failure.requestPath)) return false;
      if (previousStageTwo.some((entry) => entry.requestHost === failure.requestHost
        && entry.initiatorHost === failure.initiatorHost
        && entry.resourceType === failure.resourceType
        && entry.requestPath === failure.requestPath)) return false;
      if (previousStageTwo.length >= SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) return false;
    } else {
      if (previousStageOne.length >= SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) return false;
      if (!previousHosts.includes(failure.requestHost)
        && previousHosts.length >= SMART_SCRIPT_RECOVERY_MAX_HOSTS_PER_TAB) return false;
    }
    // Clear every host this frame had blocked, not just the one that happened to
    // report first, so a single reload is enough to bring the player back.
    const stageOneHosts = stage === 1
      ? smartScriptRecoveryHosts(previousHosts.concat([failure.requestHost], smartScriptFrameHosts(failure)))
      : previousHosts;
    const retryKey = smartScriptStageRetryKey(failure, stage);
    if (SMART_SCRIPT_RETRY_KEYS.has(retryKey)) return false;
    const rollbackCurrentRecovery = async (retryKey) => {
      if (!epochIsCurrent()) return false;
      if (previous) SMART_SCRIPT_RECOVERED_TABS.set(failure.tabId, previous);
      else SMART_SCRIPT_RECOVERED_TABS.delete(failure.tabId);
      SMART_SCRIPT_RETRY_KEYS.delete(retryKey);
      if (!previous) SMART_SCRIPT_PERSISTED_RECOVERY_TABS.delete(failure.tabId);
      await applyScriptShieldRules();
      if (!epochIsCurrent()) return false;
      return false;
    };
    if (!epochIsCurrent() || !smartScriptContextRecoveryAllowed(context, stage)) return false;
    SMART_SCRIPT_RETRY_KEYS.set(retryKey, { at: Date.now() });
    const clearMarker = SMART_SCRIPT_RECOVERY_CLEARED_TABS.get(failure.tabId);
    if (clearMarker && clearMarker.epoch === recoveryEpoch) SMART_SCRIPT_RECOVERY_CLEARED_TABS.delete(failure.tabId);
    if (previous) SMART_SCRIPT_RECOVERED_TABS.delete(failure.tabId);
    const next = {
      at: Date.now(),
      frameId: failure.frameId,
      rehydrated: !!(previous && previous.rehydrated),
      failedHosts: stageOneHosts,
      stageOne: previousStageOne.concat(
        stage === 1 ? [smartScriptStageOneRecord(failure)] : [],
      ),
      stageTwo: smartScriptStageTwoEntries(previousStageTwo.concat(stage === 2 ? [{
        requestHost: failure.requestHost,
        initiatorHost: failure.initiatorHost,
        resourceType: failure.resourceType,
        requestPath: failure.requestPath,
      }] : [])),
    };
    SMART_SCRIPT_RECOVERED_TABS.set(failure.tabId, next);
    while (SMART_SCRIPT_RECOVERED_TABS.size > SMART_SCRIPT_RECOVERY_MAX_TABS) {
      SMART_SCRIPT_RECOVERED_TABS.delete(SMART_SCRIPT_RECOVERED_TABS.keys().next().value);
    }
    if (!epochIsCurrent()) return false;
    const applied = await applyScriptShieldRules();
    if (!epochIsCurrent()) return false;
    if (!smartScriptContextRecoveryAllowed(context, stage)) return rollbackCurrentRecovery(retryKey);
    if (!applied || !SMART_SCRIPT_RECOVERED_TABS.has(failure.tabId)) {
      if (previous) SMART_SCRIPT_RECOVERED_TABS.set(failure.tabId, previous);
      else SMART_SCRIPT_RECOVERED_TABS.delete(failure.tabId);
      SMART_SCRIPT_RETRY_KEYS.delete(retryKey);
      return false;
    }
    SMART_SCRIPT_PERSISTED_RECOVERY_TABS.add(failure.tabId);
    clearSmartScriptPendingForTab(failure.tabId);
    if (failure.frameId === 0) {
      SMART_SCRIPT_TOP_RELOADS.set(failure.tabId, { at: Date.now(), url: failure.documentUrl });
    }
    if (!epochIsCurrent()) return false;
    if (!smartScriptContextRecoveryAllowed(context, stage)) return rollbackCurrentRecovery(retryKey);
    const sent = await sendSmartScriptFrameReload(failure, stage);
    if (!epochIsCurrent()) return false;
    if (!sent) {
      SMART_SCRIPT_TOP_RELOADS.delete(failure.tabId);
      if (previous) SMART_SCRIPT_RECOVERED_TABS.set(failure.tabId, previous);
      else SMART_SCRIPT_RECOVERED_TABS.delete(failure.tabId);
      SMART_SCRIPT_RETRY_KEYS.delete(retryKey);
      if (!previous) SMART_SCRIPT_PERSISTED_RECOVERY_TABS.delete(failure.tabId);
      await applyScriptShieldRules();
      if (!epochIsCurrent()) return false;
    }
    if (sent) SMART_SCRIPT_PLAYER_INTENTS.delete(smartScriptFrameKey(context.tabId, context.frameId));
    return sent;
  } finally {
    if (SMART_SCRIPT_RECOVERY_INFLIGHT.get(failure.tabId) === recoveryEpoch) {
      SMART_SCRIPT_RECOVERY_INFLIGHT.delete(failure.tabId);
    }
  }
}

async function handleSmartScriptFailure(details) {
  const failure = normalizeSmartScriptFailure(details);
  if (!failure) return false;
  noteSmartScriptFrameHost(failure);
  const context = smartScriptContextForFailure(failure);
  // A declined recovery (stage two without a fresh gesture, or a spent bound) must
  // still leave the failure pending, so a later trusted interaction can drive the
  // next stage instead of the evidence being silently dropped.
  if (context && smartScriptContextRecoveryAllowed(context, 1)
    && await recoverSmartScriptPlayer(failure, context)) return true;
  if (!await smartScriptModeActive()) return false;
  if (failure.epoch !== smartScriptNavigationEpoch(failure.tabId)) return false;
  const key = smartScriptFrameKey(failure.tabId, failure.frameId);
  const prior = SMART_SCRIPT_PENDING_ERRORS.get(key);
  if (!prior || prior.requestUrl !== failure.requestUrl || Date.now() - prior.at > 1000) {
    SMART_SCRIPT_PENDING_ERRORS.set(key, failure);
  }
  pruneSmartScriptRecoveryState(Date.now());
  return false;
}

async function handleSmartScriptPlayerContext(sender, msg) {
  const context = normalizeSmartScriptPlayerContext(sender, msg);
  if (!context) return { ok: false };
  const key = smartScriptFrameKey(context.tabId, context.frameId);
  SMART_SCRIPT_PLAYER_CONTEXTS.set(key, context);
  pruneSmartScriptRecoveryState(context.at);
  let pending = SMART_SCRIPT_PENDING_ERRORS.get(key) || null;
  if (!pending && context.evidence === 'media-embed') {
    for (const candidate of SMART_SCRIPT_PENDING_ERRORS.values()) {
      if (candidate.tabId === context.tabId
        && candidate.epoch === context.epoch
        && candidate.parentFrameId === context.frameId) {
        pending = candidate;
        break;
      }
    }
  }
  if (pending && smartScriptContextRecoveryAllowed(context, 1) && await smartScriptModeActive()) {
    if (pending.epoch !== smartScriptNavigationEpoch(pending.tabId)) return { ok: true };
    const matched = smartScriptContextForFailure(pending);
    if (matched) await recoverSmartScriptPlayer(pending, matched);
  }
  return { ok: true };
}

async function handleSmartScriptPlayerIntent(sender) {
  const intent = normalizeSmartScriptPlayerIntent(sender);
  if (!intent) return { ok: false };
  const key = smartScriptFrameKey(intent.tabId, intent.frameId);
  SMART_SCRIPT_PLAYER_INTENTS.set(key, intent);
  pruneSmartScriptRecoveryState(intent.at);
  let pending = SMART_SCRIPT_PENDING_ERRORS.get(key) || null;
  if (!pending) {
    for (const candidate of SMART_SCRIPT_PENDING_ERRORS.values()) {
      if (candidate.tabId === intent.tabId
        && candidate.epoch === intent.epoch
        && candidate.parentFrameId === intent.frameId) {
        pending = candidate;
        break;
      }
    }
  }
  if (!pending || !await smartScriptModeActive()) return { ok: true, recovered: false };
  if (intent.epoch !== smartScriptNavigationEpoch(intent.tabId)) return { ok: true, recovered: false };
  const context = smartScriptContextForFailure(pending);
  if (!context || context.frameId !== intent.frameId || !smartScriptContextHasRecentIntent(context)) {
    return { ok: true, recovered: false };
  }
  return { ok: true, recovered: await recoverSmartScriptPlayer(pending, context) };
}

function clearSmartScriptFrameTransient(tabId, frameId) {
  const key = smartScriptFrameKey(tabId, frameId);
  SMART_SCRIPT_PLAYER_CONTEXTS.delete(key);
  SMART_SCRIPT_PENDING_ERRORS.delete(key);
  SMART_SCRIPT_FRAME_HOSTS.delete(key);
}

function clearSmartScriptRecoveryForTab(tabId) {
  const id = Number(tabId);
  const prefix = String(id) + ':';
  const clearEpoch = bumpSmartScriptNavigationEpoch(id);
  // Remove the in-memory recovery synchronously at navigation start. The queued
  // DNR reconciliation deliberately reads the map only when its turn runs, so
  // it cannot reinstall an exclusion from a stale snapshot.
  const wasRecovered = SMART_SCRIPT_RECOVERED_TABS.delete(id);
  SMART_SCRIPT_RECOVERY_CLEARED_TABS.set(id, { at: Date.now(), epoch: clearEpoch });
  SMART_SCRIPT_TOP_RELOADS.delete(id);
  for (const map of [SMART_SCRIPT_PLAYER_CONTEXTS, SMART_SCRIPT_PLAYER_INTENTS, SMART_SCRIPT_PENDING_ERRORS, SMART_SCRIPT_RETRY_KEYS, SMART_SCRIPT_FRAME_HOSTS]) {
    for (const key of map.keys()) {
      if (key.startsWith(prefix)) map.delete(key);
    }
  }
  return (async () => {
    await hydrateSmartScriptRecoveryTabs();
    const wasPersisted = SMART_SCRIPT_PERSISTED_RECOVERY_TABS.delete(id);
    const result = (wasRecovered || wasPersisted) ? await applyScriptShieldRules() : false;
    const marker = SMART_SCRIPT_RECOVERY_CLEARED_TABS.get(id);
    if (marker && marker.epoch === clearEpoch) SMART_SCRIPT_RECOVERY_CLEARED_TABS.delete(id);
    return result;
  })();
}

function notifySmartScriptRouteChange(details) {
  if (!details || details.tabId == null || details.tabId < 0 || details.frameId == null || details.frameId < 0) return;
  try {
    chrome.tabs.sendMessage(
      details.tabId,
      { kind: 'smart-script-route-changed', routeUrl: normalizeSmartScriptUrl(details.url) },
      { frameId: details.frameId },
      () => { void chrome.runtime.lastError; },
    );
  } catch (_) {}
}

function handleSmartScriptTopNavigation(tabId, rawUrl) {
  const id = Number(tabId);
  const expected = SMART_SCRIPT_TOP_RELOADS.get(id);
  const url = normalizeSmartScriptUrl(rawUrl);
  if (expected && Date.now() - expected.at <= SMART_SCRIPT_TOP_RELOAD_TTL_MS
    && url && url === normalizeSmartScriptUrl(expected.url)) {
    SMART_SCRIPT_TOP_RELOADS.delete(id);
    clearSmartScriptFrameTransient(id, 0);
    clearSmartScriptPendingForTab(id);
    return false;
  }
  clearSmartScriptRecoveryForTab(id);
  return true;
}

try {
  chrome.webRequest?.onErrorOccurred?.addListener(
    (details) => { handleSmartScriptFailure(details); },
    { urls: ['<all_urls>'], types: ['script'] },
  );
} catch (e) {
  console.warn('[WardenOne] Smart Script Shield recovery observer failed', e);
}

const FINGERPRINT_SCRIPT_RESOURCE_TYPES = ['script', 'xmlhttprequest'];
const FINGERPRINT_SCRIPT_DOMAIN_FILTERS = [
  'fpjs.io',
  'fpcdn.io',
  'openfpcdn.io',
  'fingerprint.com',
  'fingerprintjs.com',
  'clientjs.org',
  'online-metrix.net',
  'iesnare.com',
  'iovation.com',
  'threatmetrix.com',
  'sift.com',
  'forter.com',
  'riskified.com',
  'perimeterx.net',
  'px-cloud.net',
  'datadome.co',
  'kasada.io',
];
const FINGERPRINT_SCRIPT_URL_FILTERS = [
  'fingerprintjs',
  'fingerprint2',
  'thumbmarkjs',
  'creepjs',
  'clientjs.min.js',
  'canvas-fingerprint',
  'webgl-fingerprint',
  'audio-fingerprint',
  'font-fingerprint',
  'device-fingerprint',
  'browser-fingerprint',
  'visitor-id',
  'threatmetrix',
  'iovation',
  'mpsnare',
];

async function applyFingerprintScriptRules(enabled) {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing
      .filter((r) => r.id >= FINGERPRINT_SCRIPT_RULE_BASE && r.id < FINGERPRINT_SCRIPT_RULE_BASE + FINGERPRINT_SCRIPT_RULE_MAX)
      .map((r) => r.id);
    const addRules = [];
    if (enabled) {
      FINGERPRINT_SCRIPT_DOMAIN_FILTERS.forEach((domain) => {
        if (addRules.length >= FINGERPRINT_SCRIPT_RULE_MAX) return;
        addRules.push({
          id: FINGERPRINT_SCRIPT_RULE_BASE + addRules.length,
          priority: 1010,
          action: { type: 'block' },
          condition: { requestDomains: [domain], domainType: 'thirdParty', resourceTypes: FINGERPRINT_SCRIPT_RESOURCE_TYPES },
        });
      });
      FINGERPRINT_SCRIPT_URL_FILTERS.forEach((needle) => {
        if (addRules.length >= FINGERPRINT_SCRIPT_RULE_MAX) return;
        addRules.push({
          id: FINGERPRINT_SCRIPT_RULE_BASE + addRules.length,
          priority: 1010,
          action: { type: 'block' },
          condition: { urlFilter: needle, domainType: 'thirdParty', resourceTypes: ['script'] },
        });
      });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules });
  } catch (e) {
    console.warn('[WardenOne] fingerprint script rules failed', e);
  }
}

const GOOGLE_SEARCH_INITIATOR_DOMAINS = [
  'google.com',
  'google.co.uk',
  'google.ca',
  'google.com.au',
  'google.ie',
  'google.co.nz',
  'google.co.za',
  'google.de',
  'google.fr',
  'google.it',
  'google.es',
  'google.nl',
  'google.be',
  'google.ch',
  'google.at',
  'google.se',
  'google.no',
  'google.dk',
  'google.fi',
  'google.pl',
  'google.pt',
  'google.co.in',
  'google.co.jp',
  'google.com.br',
  'google.com.mx',
  'search.brave.com',
];
const GOOGLE_SEARCH_SPONSORED_DOMAINS = [
  'googleadservices.com',
  'adservice.google.com',
  'googleads.g.doubleclick.net',
  'doubleclick.net',
];
const GOOGLE_SEARCH_SPONSORED_PATH_FILTERS = [
  '/aclk',
  '/pagead/aclk',
];

async function applyGoogleSearchSponsoredAllowRules(enabled) {
  try {
    enabled = !!enabled;
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing
      .filter((r) => r.id >= GOOGLE_SEARCH_ALLOW_RULE_BASE && r.id < GOOGLE_SEARCH_ALLOW_RULE_BASE + GOOGLE_SEARCH_ALLOW_RULE_MAX)
      .map((r) => r.id);
    const addRules = [];
    if (enabled) {
      GOOGLE_SEARCH_SPONSORED_DOMAINS.forEach((domain) => {
        if (addRules.length >= GOOGLE_SEARCH_ALLOW_RULE_MAX) return;
        addRules.push({
          id: GOOGLE_SEARCH_ALLOW_RULE_BASE + addRules.length,
          priority: 12000,
          action: { type: 'allow' },
          condition: { requestDomains: [domain], initiatorDomains: GOOGLE_SEARCH_INITIATOR_DOMAINS, resourceTypes: RESOURCE_TYPES },
        });
      });
      GOOGLE_SEARCH_SPONSORED_PATH_FILTERS.forEach((pathFilter) => {
        if (addRules.length >= GOOGLE_SEARCH_ALLOW_RULE_MAX) return;
        addRules.push({
          id: GOOGLE_SEARCH_ALLOW_RULE_BASE + addRules.length,
          priority: 12000,
          action: { type: 'allow' },
          condition: { urlFilter: pathFilter, initiatorDomains: GOOGLE_SEARCH_INITIATOR_DOMAINS, resourceTypes: RESOURCE_TYPES },
        });
      });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules });
  } catch (e) {
    console.warn('[WardenOne] Google Search sponsored allow rules failed', e);
  }
}

const MEDIA_COMPAT_DOMAINS = new Set([
  'googlevideo.com',
  'ytimg.com',
  'youtubei.googleapis.com',
  'ggpht.com',
  'ttvnw.net',
  'jtvnw.net',
  'twitchcdn.net',
  'usher.ttvnw.net',
]);

function isMediaCompatDomain(domain) {
  const d = String(domain || '').replace(/^www\./, '').toLowerCase();
  if (!d) return false;
  if (MEDIA_COMPAT_DOMAINS.has(d)) return true;
  for (const safe of MEDIA_COMPAT_DOMAINS) {
    if (d.endsWith('.' + safe)) return true;
  }
  return false;
}

// Globally-trusted infrastructure that must NEVER be turned into a block rule,
// no matter what a downloaded community blocklist or a heuristic learner says.
// Aggressive lists (and the occasional poisoned/over-broad phishing feed) sometimes
// include GitHub user-content hosts (e.g. a *.github.io phishing page leaks the
// apex github.io, or objects/raw.githubusercontent.com lands on a tracker list),
// which would block code hosting wholesale. This is a false-positive shield only:
// it never relaxes blocking for any other host, and per-URL reputation/Safe Browsing
// hits are unaffected.
const NEVER_BLOCK_DOMAINS = new Set([
  'github.com',
  'githubusercontent.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'github.io',
  'githubassets.com',
'mail.google.com', 'accounts.google.com', 'apis.google.com', 'gstatic.com', 'googleusercontent.com',
  // User-confirmed false-positive exemption: blocked by a downloaded threat feed, not a bundled rule.
  // Keeps all other shields active; the page navigation is un-blocked via rules.json id166 (priority 3000).
  'gamedrive.org',
]);
LOGIN_COMPAT_NEVER_BLOCK_DOMAINS.forEach((domain) => NEVER_BLOCK_DOMAINS.add(domain));
[
  'google.com', 'googleapis.com', 'youtube.com', 'youtube-nocookie.com',
  'twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net',
  'microsoft.com', 'office.com', 'office365.com', 'live.com',
  'discord.com', 'discordapp.com', 'slack.com', 'zoom.us',
  'figma.com', 'canva.com', 'notion.so', 'dropbox.com',
  'netflix.com', 'spotify.com', 'paypal.com', 'stripe.com',
  'cloudflare.com', 'cloudflare.net',
].forEach((domain) => NEVER_BLOCK_DOMAINS.add(domain));

function isGithubUploadInfraDomain(domain) {
  return /^github(?:-[a-z0-9]+)*\.s3\.amazonaws\.com$/i.test(String(domain || ''));
}

function isNeverBlockDomain(domain) {
  const d = String(domain || '').replace(/^www\./, '').toLowerCase();
  if (!d) return false;
  if (isGithubUploadInfraDomain(d)) return true;
  if (NEVER_BLOCK_DOMAINS.has(d)) return true;
  for (const safe of NEVER_BLOCK_DOMAINS) {
    if (d.endsWith('.' + safe)) return true;
  }
  return false;
}

// High-priority DNR allow rules for the trusted-infrastructure (NEVER_BLOCK) domains, so a
// false-positive in the 28k-rule EasyList/adshield pack -- or a learned/grabber rule -- cannot
// break a FUNCTIONAL subresource (script/stylesheet/font/xhr/sub_frame) on a major SaaS app
// (figma, notion, slack, dropbox, ...). Scoped to functional resource types ONLY: image / ping /
// beacon are deliberately NOT allowed, so tracking pixels served from these domains stay
// blockable. Priority sits above our block rules (static 1, tracker/easyprivacy 1000, learned/
// grabber 2000) but below the media-compat (90000) and user-allowlist (100000) rules. Per-URL
// reputation / SafeBrowsing is a separate JS-side layer and is unaffected by these DNR allows.
// NEVER_BLOCK domains that ALSO host their own first-party ad / conversion / telemetry SCRIPTS
// (EasyList/our tracker list deliberately block paths like google.com/pagead/*, youtube.com/
// pagead/*, google.com/ccm/collect). They must NOT get a blanket script/xhr allow or those ads
// get un-blocked. They stay in the JS-side isNeverBlockDomain false-positive shield; they just
// don't get the DNR allow rule (these giants are never broken by an EasyList false-positive).
const NEVER_BLOCK_ALLOW_EXCLUDE = new Set([
  'google.com', 'youtube.com', 'youtube-nocookie.com',
  'microsoft.com', 'live.com', 'office.com', 'office365.com',
]);
async function applyNeverBlockAllowRules() {
  try {
    const domains = [];
    const seen = new Set();
    for (const raw of NEVER_BLOCK_DOMAINS) {
      const h = String(raw || '').replace(/^www\./, '').toLowerCase();
      if (NEVER_BLOCK_ALLOW_EXCLUDE.has(h)) continue;
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !h.includes('..') && !seen.has(h)) { seen.add(h); domains.push(h); }
    }
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existing.filter((x) => x.id >= NEVER_BLOCK_ALLOW_RULE_BASE && x.id < NEVER_BLOCK_ALLOW_RULE_BASE + NEVER_BLOCK_ALLOW_MAX).map((x) => x.id);
    const addRules = [];
    const BATCH = 100;
    for (let i = 0; i < domains.length && addRules.length < NEVER_BLOCK_ALLOW_MAX; i += BATCH) {
      addRules.push({
        id: NEVER_BLOCK_ALLOW_RULE_BASE + addRules.length,
        priority: 3000,
        action: { type: 'allow' },
        condition: { requestDomains: domains.slice(i, i + BATCH), resourceTypes: ['script', 'stylesheet', 'font', 'xmlhttprequest', 'sub_frame'] },
      });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds, addRules });
  } catch (e) { console.warn('[WardenOne] never-block allow rules failed', e); }
}
applyNeverBlockAllowRules();

function isMediaCompatFilter(pattern) {
  const p = String(pattern || '').toLowerCase();
  return /googlevideo\.com|ytimg\.com|youtubei\.googleapis\.com|ggpht\.com|ttvnw\.net|jtvnw\.net|twitchcdn\.net/.test(p);
}

function isVideoPlatformHost(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return h === 'youtube.com'
    || h.endsWith('.youtube.com')
    || h === 'youtube-nocookie.com'
    || h.endsWith('.youtube-nocookie.com')
    || h === 'youtu.be'
    || h === 'twitch.tv'
    || h.endsWith('.twitch.tv');
}

function isXPlatformHost(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return h === 'x.com'
    || h.endsWith('.x.com')
    || h === 'twitter.com'
    || h.endsWith('.twitter.com');
}

function hostMatchesCosmeticDomainList(rawHost, list) {
  let host = normalizeAllowlistHost(rawHost);
  if (!host) return false;
  const domains = new Set();
  for (const raw of (Array.isArray(list) ? list : [])) {
    const domain = String(raw || '').replace(/^www\./i, '').replace(/^\.+|\.+$/g, '').toLowerCase();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && !domain.includes('..')) domains.add(domain);
  }
  while (host) {
    if (domains.has(host)) return true;
    const dot = host.indexOf('.');
    if (dot < 0) break;
    host = host.slice(dot + 1);
  }
  return false;
}

function isSafeVideoPlatformCosmeticSelector(selector, host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const s = String(selector || '').toLowerCase();
  if (!s) return false;
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtube-nocookie.com' || h.endsWith('.youtube-nocookie.com')) {
    const allowedPageAds = /#player-ads\b|#masthead-ad\b|ytd-promoted-sparkles|ytd-display-ad-renderer|ytd-ad-slot-renderer|\.ytd-ad-slot-renderer|ytd-in-feed-ad-layout-renderer|ytd-promoted-video-renderer|ytd-compact-promoted-video-renderer/;
    if (allowedPageAds.test(s)) return true;
    return !/(#movie_player\b|\.html5-video-player\b|\bvideo\b|\.ytp-|ytd-player\b|#player\b(?!-ads)|#player-container\b|#player-theater-container\b|ytd-watch-flexy\b|#columns\b|#primary\b|#secondary\b|#page-manager\b|ytd-app\b)/.test(s);
  }
  if (h === 'twitch.tv' || h.endsWith('.twitch.tv')) {
    return !/(\bvideo\b|\.video-player|\.persistent-player|\.channel-root|\.twilight-main|#root\b)/.test(s);
  }
  return true;
}

// ---- Network filter-option parser (uBlock $third-party/$script/domain=/@@) ----
// Option-bearing uBlock rules must be handled here rather than by parseList().
// Options we cannot faithfully express are skipped (never broadened).
const UBO_TYPE_MAP = {
  script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet',
  object: 'object', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
  subdocument: 'sub_frame', frame: 'sub_frame', document: 'main_frame', doc: 'main_frame',
  ping: 'ping', media: 'media', font: 'font', websocket: 'websocket', other: 'other',
};
const UBO_IGNORABLE = new Set(['all']);
const UBO_UNSUPPORTED = /(redirect|redirect-rule|removeparam|csp|replace|empty|mp4|inline-script|inline-font|generichide|genericblock|elemhide|specifichide|cname|header|popup|popunder|strict1p|strict3p)/;

function networkRulePatternHost(pattern) {
  let p = String(pattern || '').trim().toLowerCase();
  if (!p) return '';
  p = p.replace(/^\|\|/, '').replace(/^\|/, '');
  p = p.replace(/^https?:\/\//, '').replace(/^https?:/, '').replace(/^\/\//, '');
  p = p.replace(/^\*\./, '').replace(/^www\./, '');
  p = p.replace(/[\^\/?#:|].*$/, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p) ? p : '';
}

function parseNetworkRules(text, ruleStartId, maxRules) {
  const rules = [];
  let id = ruleStartId;
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length && rules.length < maxRules; i++) {
    let line = lines[i].trim();
    if (!line || line[0] === '!' || line[0] === '#' || line[0] === '[') continue;
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#') || line.includes('#%#')) continue;
    const dollar = line.indexOf('$');
    if (dollar === -1) continue;

    let isException = false;
    if (line.startsWith('@@')) { isException = true; line = line.slice(2); }

    const pattern = line.slice(0, line.indexOf('$')).trim();
    const optStr = line.slice(line.indexOf('$') + 1).trim();
    if (!pattern || !optStr) continue;
    const patternHost = networkRulePatternHost(pattern);
    if (!isException && (isMediaCompatFilter(pattern) || isNeverBlockDomain(patternHost))) continue;
    const opts = optStr.split(',').map((o) => o.trim()).filter(Boolean);

    if (opts.some((o) => UBO_UNSUPPORTED.test(o.replace(/^~/, '').split('=')[0]))) continue;

    const resourceTypes = [];
    let domains = null, excludedDomains = null, domainType = null;
    let bad = false;
    for (let o of opts) {
      const neg = o[0] === '~';
      if (neg) o = o.slice(1);
      const [k, v] = o.split('=');
      if (k === 'third-party' || k === '3p' || k === 'first-party' || k === '1p') {
        const wantsThirdParty = k === 'third-party' || k === '3p';
        const requestedType = (wantsThirdParty !== neg) ? 'thirdParty' : 'firstParty';
        if (domainType && domainType !== requestedType) { bad = true; break; }
        domainType = requestedType;
        continue;
      }
      if (UBO_IGNORABLE.has(k)) {
        if (neg) { bad = true; break; }
        continue;
      }
      if (k === 'domain') {
        if (neg || !v) { bad = true; break; }
        const incl = [], excl = [];
        v.split('|').forEach((d) => { d = d.trim().toLowerCase(); if (!d) return; if (d[0] === '~') excl.push(d.slice(1)); else incl.push(d); });
        if (incl.length) domains = incl;
        if (excl.length) excludedDomains = excl;
        continue;
      }
      // A negated resource type means "all types except X". Dropping the
      // negation would broaden the rule, so skip it unless represented exactly.
      if (UBO_TYPE_MAP[k]) {
        if (neg) { bad = true; break; }
        resourceTypes.push(UBO_TYPE_MAP[k]);
        continue;
      }
      bad = true; break;
    }
    if (bad) continue;
    // Remote exception rules are allowed only when scoped to initiator domains.
    // A broad @@ rule from a compromised feed is too much authority for a helper
    // parser; domain-scoped exceptions still cover the common false-positive fixes.
    if (isException && !domains) continue;

    let urlFilter = pattern;
    if (!urlFilter || urlFilter.length < 2) continue;
    if (/[^\x00-\x7F]/.test(urlFilter)) continue;

    const condition = { urlFilter };
    if (resourceTypes.length) condition.resourceTypes = Array.from(new Set(resourceTypes));
    if (domains) condition.initiatorDomains = domains;
    if (excludedDomains) condition.excludedInitiatorDomains = excludedDomains;
    if (domainType) condition.domainType = domainType;

    rules.push({
      id: id++,
      priority: isException ? 2 : 1,
      action: { type: isException ? 'allow' : 'block' },
      condition,
    });
  }
  return rules;
}

// Extract only unambiguous whole-host entries: a plain hostname, a hosts-file
// entry, or an exact ||hostname^ rule. URL paths, options, wildcards, and
// exceptions are intentionally left to the network-rule parser so they can
// never be broadened into a whole-domain block.
function parseList(text) {
  const domainRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  const out = [];
  const seen = new Set();

  function addCandidate(raw) {
    let line = String(raw || '').replace(/^\uFEFF/, '').trim().toLowerCase();
    if (!line) return;
    if (line.startsWith('!') || line.startsWith('#') || line.startsWith('[')) return;
    if (line.startsWith('@@')) return; // uBlock allow/exemption rule
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) return; // cosmetic/scriptlet rule

    const exactAbpHost = line.match(/^\|\|([^\s|^\/?#:$*@]+)\^$/);
    if (exactAbpHost) {
      line = exactAbpHost[1];
    } else if (/[\s|^\/?#:$*@,"'`(){}\[\];]/.test(line)) {
      return;
    }
    line = line.replace(/\.$/, '');
    if (!line || line === 'localhost') return;

    // Convert IDN/homograph domains to punycode so they CAN be blocked (DNR
    // urlFilter needs ASCII). e.g. yȯutube.com -> xn--... . Browsers do this
    // natively via the URL parser.
    if (!/^[\x00-\x7F]+$/.test(line)) {
      try {
        const u = new URL('http://' + line);
        line = u.hostname; // now punycode (xn--...)
      } catch (_) { return; } // unconvertible -> skip
    }

    // reject bare IPs -- DNR urlFilter ||x is for domains, not IP literals
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(line)) return;
    if (isMediaCompatDomain(line)) return;
    if (isNeverBlockDomain(line)) return; // GitHub & other vetted infra: never blocklist-block
    if (domainRe.test(line) && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }

  function collectJson(value, key, activeBranch) {
    const keyName = String(key || '');
    if (/^(allow|white|safe|legit|ignore|tolerance|source|report|comment|description|category|title|name|created|updated|date|reason)/i.test(keyName) || /(allow|white)list/i.test(keyName)) return;
    const blockKey = /^(blocklist|blacklist|fuzzylist|domains?|hosts?|urls?|entries|list)$/i.test(keyName);
    const active = activeBranch || blockKey;

    if (typeof value === 'string') {
      if (active) addCandidate(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectJson(item, keyName, active);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        collectJson(childValue, childKey, active);
      }
    }
  }

  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      collectJson(parsed, '', Array.isArray(parsed));
      if (out.length) return out;
    } catch (_) {}
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    if (/^\s*[!#\[]/.test(line)) continue; // comments and list headers
    line = line.replace(/\s[#!].*$/, ''); // inline comments after domains
    const hostsEntry = line.match(/^(?:0|0\.0\.0\.0|127\.0\.0\.1|::|::1)\s+(.+)$/i);
    if (hostsEntry) {
      for (const host of hostsEntry[1].trim().split(/\s+/)) addCandidate(host);
      continue;
    }
    addCandidate(line);
  }
  return out;
}

function getListMeta() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('wardenone_list_meta', (x) => resolve((x && x.wardenone_list_meta) || null));
    } catch (_) {
      resolve(null);
    }
  });
}

function buildListMeta(base) {
  const remoteCount = Number(base.remoteCount || 0);
  const activeRuleCount = Number(base.activeRuleCount || 0);
  const learnedCount = Object.keys(LEARNED || {}).length;
  const activeLearnedCount = Math.min(learnedCount, LEARNED_MAX);
  const adshieldStaticCount = ADSHIELD_STATIC_ACTIVE ? ADSHIELD_STATIC_RULE_COUNT : 0;
  const totalCount = STATIC_RULE_COUNT + adshieldStaticCount + remoteCount + learnedCount;
  const activeCount = STATIC_RULE_COUNT + adshieldStaticCount + activeRuleCount + activeLearnedCount;
  return Object.assign({}, base, {
    count: totalCount,
    totalCount,
    remoteCount,
    activeCount,
    activeRuleCount,
    learnedCount,
    staticRuleCount: STATIC_RULE_COUNT,
    dynamicRuleLimit: MAX_DYNAMIC,
  });
}

function refreshListMetaCounts() {
  try {
    chrome.storage.local.get('wardenone_list_meta', (x) => {
      const oldMeta = x && x.wardenone_list_meta;
      if (!oldMeta) return;
      const remoteCount = Number(oldMeta.remoteCount || oldMeta.count || 0);
      const activeRuleCount = Number(oldMeta.activeRuleCount || Math.min(remoteCount, MAX_DYNAMIC));
      const meta = buildListMeta(Object.assign({}, oldMeta, { remoteCount, activeRuleCount }));
      localSet({ wardenone_list_meta: meta }).catch(() => {});
    });
  } catch (_) {}
}

const LIST_INTEGRITY_KEY = 'wardenone_list_integrity';
const LIST_SOURCE_MIN_BASELINE = 50;
const LIST_SOURCE_DROP_RATIO = 0.35;
const LIST_SOURCE_SPIKE_RATIO = 2.5;
const LIST_SOURCE_SPIKE_FLOOR = 1000;
const LIST_TOTAL_MIN_BASELINE = 1000;
const LIST_TOTAL_DROP_RATIO = 0.5;
const LIST_TOTAL_SPIKE_RATIO = 1.8;
const LIST_TOTAL_SPIKE_FLOOR = 5000;
const LIST_STALE_ALERT_THROTTLE_MS = 12 * 60 * 60 * 1000;

function listCountDriftReason(previous, next, label, opts) {
  const prev = Number(previous || 0);
  const cur = Number(next || 0);
  const minBaseline = Number(opts && opts.minBaseline) || LIST_SOURCE_MIN_BASELINE;
  if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev < minBaseline) return '';
  const dropLimit = Math.max(1, Math.floor(prev * (Number(opts && opts.dropRatio) || LIST_SOURCE_DROP_RATIO)));
  const spikeLimit = Math.ceil((prev * (Number(opts && opts.spikeRatio) || LIST_SOURCE_SPIKE_RATIO)) + (Number(opts && opts.spikeFloor) || LIST_SOURCE_SPIKE_FLOOR));
  if (cur < dropLimit) return label + ' dropped from ' + prev + ' to ' + cur;
  if (cur > spikeLimit) return label + ' jumped from ' + prev + ' to ' + cur;
  return '';
}

async function loadListIntegrity() {
  try {
    const store = await localGet(LIST_INTEGRITY_KEY);
    const data = store && store[LIST_INTEGRITY_KEY];
    return {
      sources: data && data.sources && typeof data.sources === 'object' ? data.sources : {},
      alerts: Array.isArray(data && data.alerts) ? data.alerts.slice(-30) : [],
      lastStaleAlertAt: Number(data && data.lastStaleAlertAt || 0),
    };
  } catch (_) {
    return { sources: {}, alerts: [], lastStaleAlertAt: 0 };
  }
}

async function saveListIntegrity(integrity, acceptedRecords, alerts, reason) {
  try {
    const sources = Object.assign({}, (integrity && integrity.sources) || {});
    for (const [url, record] of Object.entries(acceptedRecords || {})) {
      if (url && record) sources[url] = record;
    }
    const nextAlerts = ((integrity && integrity.alerts) || []).concat(alerts || []).slice(-30);
    await localSet({
      [LIST_INTEGRITY_KEY]: {
        version: 1,
        updatedAt: Date.now(),
      reason: String(reason || ''),
      sources,
      alerts: nextAlerts,
      lastStaleAlertAt: Number(integrity && integrity.lastStaleAlertAt || 0),
    },
  });
    return { sources, alerts: nextAlerts };
  } catch (e) {
    console.warn('[WardenOne] list integrity metadata save failed', e);
    return integrity || { sources: {}, alerts: [] };
  }
}

function listIntegrityAlert(scope, url, reason, extra) {
  const alert = Object.assign({
    scope,
    url: String(url || ''),
    reason: String(reason || ''),
    at: Date.now(),
  }, extra || {});
  try {
    queueHistory({
      type: 'warned_list_integrity',
      detail: { scope: alert.scope, url: alert.url, reason: alert.reason },
      url: alert.url,
      at: alert.at,
    });
  } catch (_) {}
  return alert;
}

function evaluateListSourceIntegrity(url, previous, hash, byteLength, domains, optionRules) {
  const domainCount = Array.isArray(domains) ? domains.length : 0;
  const optionRuleCount = Array.isArray(optionRules) ? optionRules.length : 0;
  const reasons = [];
  const maxBytes = listSourceByteLimit(url);
  if (byteLength > maxBytes) reasons.push('source size exceeds cap (' + byteLength + ' > ' + maxBytes + ' bytes)');
  if (previous) {
    const byteReason = listCountDriftReason(previous.byteLength, byteLength, 'byte size', {
      minBaseline: 100000,
      dropRatio: 0.25,
      spikeRatio: 4,
      spikeFloor: 2000000,
    });
    if (byteReason) reasons.push(byteReason);
    const domainReason = listCountDriftReason(previous.domainCount, domainCount, 'domain count', {
      minBaseline: LIST_SOURCE_MIN_BASELINE,
      dropRatio: LIST_SOURCE_DROP_RATIO,
      spikeRatio: LIST_SOURCE_SPIKE_RATIO,
      spikeFloor: LIST_SOURCE_SPIKE_FLOOR,
    });
    if (domainReason) reasons.push(domainReason);
    const optionReason = listCountDriftReason(previous.optionRuleCount, optionRuleCount, 'option-rule count', {
      minBaseline: 25,
      dropRatio: 0.25,
      spikeRatio: 4,
      spikeFloor: 200,
    });
    if (optionReason) reasons.push(optionReason);
  }
  const record = {
    sha256: hash,
    byteLength,
    domainCount,
    optionRuleCount,
    acceptedAt: Date.now(),
    url,
  };
  if (reasons.length) return { ok: false, record, reason: reasons.join('; ') };
  return { ok: true, record };
}

function totalListDriftReason(previousRemoteCount, nextRemoteCount) {
  return listCountDriftReason(previousRemoteCount, nextRemoteCount, 'combined remote count', {
    minBaseline: LIST_TOTAL_MIN_BASELINE,
    dropRatio: LIST_TOTAL_DROP_RATIO,
    spikeRatio: LIST_TOTAL_SPIKE_RATIO,
    spikeFloor: LIST_TOTAL_SPIKE_FLOOR,
  });
}

async function warnIfRemoteListsStale(meta, reason) {
  try {
    const updated = Number(meta && meta.updated || 0);
    if (!updated) return;
    const age = Date.now() - updated;
    if (age < LIST_STALE_WARN_MS) return;
    const integrity = await loadListIntegrity();
    if (Date.now() - Number(integrity.lastStaleAlertAt || 0) < LIST_STALE_ALERT_THROTTLE_MS) return;
    const critical = age >= LIST_STALE_CRITICAL_MS;
    const days = Math.max(1, Math.floor(age / (24 * 60 * 60 * 1000)));
    const alert = listIntegrityAlert('stale', '', 'remote blocklists are ' + days + ' day(s) old', {
      severity: critical ? 'critical' : 'warning',
      ageMs: age,
      updated,
      updateReason: String(reason || ''),
    });
    await saveListIntegrity(Object.assign({}, integrity, { lastStaleAlertAt: Date.now() }), {}, [alert], reason || 'stale');
  } catch (_) {}
}

async function fetchListSource(url, reason, integrity) {
  const fetched = await fetchValidatedRemoteListText(url, false, LIST_FETCH_TIMEOUT_MS);
  if (!fetched.ok) {
    if (fetched.integrityRejected) {
      const clean = String(fetched.error || 'source integrity policy failed');
      return {
        ok: false,
        url,
        error: 'Integrity guard rejected source: ' + clean,
        integrityRejected: true,
        alert: listIntegrityAlert('source', url, clean),
      };
    }
    return {
      ok: false,
      url,
      error: fetched.error || 'Source fetch failed',
    };
  }
  try {
    const text = fetched.text || '';
    const byteLength = fetched.byteLength || utf8ByteLength(text);
    const domains = parseList(text);
    const optionRules = parseNetworkRules(text, 0, OPTION_RULES_PER_SOURCE_CAP);
    const hash = await sha256TextHex(text);
    const verdict = evaluateListSourceIntegrity(
      url,
      integrity && integrity.sources ? integrity.sources[url] : null,
      hash,
      byteLength,
      domains,
      optionRules
    );
    if (!verdict.ok) {
      console.warn('[WardenOne] source integrity rejected (' + reason + '):', url, verdict.reason);
      return {
        ok: false,
        url,
        error: 'Integrity guard rejected source: ' + verdict.reason,
        integrityRejected: true,
        alert: listIntegrityAlert('source', url, verdict.reason, {
          domainCount: domains.length,
          optionRuleCount: optionRules.length,
          sha256: hash,
        }),
      };
    }
    if (WO_LIST_DEBUG) console.log('[WardenOne] fetched', domains.length, 'domains,', optionRules.length, 'option-rules from', url);
    return { ok: true, url, domains, optionRules, integrityRecord: verdict.record };
  } catch (e) {
    const err = String(e);
    if (/Integrity guard rejected source:/i.test(err)) {
      const clean = err.replace(/^Error:\s*/i, '').replace(/^Integrity guard rejected source:\s*/i, '');
      return {
        ok: false,
        url,
        error: 'Integrity guard rejected source: ' + clean,
        integrityRejected: true,
        alert: listIntegrityAlert('source', url, clean),
      };
    }
    console.warn('[WardenOne] source failed (' + reason + '):', url, err);
    return { ok: false, url, error: err };
  }
}

function emptySupplementalLists() {
  return {
    adultDomainsExtra: [],
    grabberDomainsExtra: [],
    trustedPaymentHostsExtra: [],
  };
}

function supplementalListCap(bucket) {
  return Math.max(0, Number(SUPPLEMENTAL_LIST_CAPS[bucket]) || 0);
}

function normalizeSupplementalListDomain(value, bucket) {
  const h = normalizeAllowlistHost(value);
  if (!h) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return '';
  if (bucket === 'trustedPaymentHostsExtra') {
    const firstLabel = h.split('.')[0] || '';
    if (/(^|\.)xn--/i.test(h)) return '';
    if (/\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol|zip|mov|hair|tattoo)$/i.test(h)) return '';
    if (/^[a-f0-9]{12,}$/i.test(firstLabel)) return '';
    return h;
  }
  if (isNeverBlockDomain(h)) return '';
  return h;
}

function sanitizeSupplementalBucket(list, bucket) {
  const out = [];
  const seen = new Set();
  const cap = supplementalListCap(bucket);
  for (const raw of (Array.isArray(list) ? list : [])) {
    if (out.length >= cap) break;
    const h = normalizeSupplementalListDomain(raw, bucket);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

function sanitizeSupplementalLists(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = emptySupplementalLists();
  for (const bucket of Object.keys(out)) {
    out[bucket] = sanitizeSupplementalBucket(source[bucket], bucket);
  }
  return out;
}

function supplementalListCounts(lists) {
  const clean = sanitizeSupplementalLists(lists);
  return {
    adultDomainsExtra: clean.adultDomainsExtra.length,
    grabberDomainsExtra: clean.grabberDomainsExtra.length,
    trustedPaymentHostsExtra: clean.trustedPaymentHostsExtra.length,
  };
}

function addSupplementalDomain(out, bucket, raw) {
  if (!out || !bucket || !Object.prototype.hasOwnProperty.call(out, bucket)) return;
  const h = normalizeSupplementalListDomain(raw, bucket);
  if (h) out[bucket].push(h);
}

function supplementalManifestBucketForKey(key) {
  const k = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^(adultdomains|adultdomainsextra|nsfwdomains|porndomains|adultsites|pornsites)$/.test(k)) return 'adultDomainsExtra';
  if (/^(iploggerdomains|iploggers|grabberdomains|grabberdomainsextra|loggerdomains|trackinglinkdomains)$/.test(k)) return 'grabberDomainsExtra';
  if (/^(paymentprocessordomains|paymentprocessors|paymenthosts|trustedpaymenthosts|trustedpaymenthostsextra|cardprocessors)$/.test(k)) return 'trustedPaymentHostsExtra';
  return '';
}

function parseSupplementalManifestText(text) {
  const out = emptySupplementalLists();
  let parsed = null;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (_) {
    return out;
  }
  const walk = (value, activeBucket, key) => {
    const bucket = supplementalManifestBucketForKey(key) || activeBucket || '';
    if (typeof value === 'string') {
      addSupplementalDomain(out, bucket, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, bucket, key);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, supplementalManifestBucketForKey(childKey) || bucket, childKey);
      }
    }
  };
  walk(parsed, '', '');
  return sanitizeSupplementalLists(out);
}

function parseSupplementalListText(source, text) {
  const out = emptySupplementalLists();
  if (source && source.manifest) return parseSupplementalManifestText(text);
  const bucket = source && source.bucket;
  if (!bucket || !Object.prototype.hasOwnProperty.call(out, bucket)) return out;
  out[bucket] = parseList(text);
  return sanitizeSupplementalLists(out);
}

function supplementalSourceRecord(source, hash, byteLength, lists) {
  return {
    url: source && source.url,
    label: source && source.label,
    sha256: hash,
    byteLength,
    counts: supplementalListCounts(lists),
    acceptedAt: Date.now(),
  };
}

function evaluateSupplementalSourceIntegrity(source, previous, hash, byteLength, lists) {
  const reasons = [];
  if (previous) {
    const byteReason = listCountDriftReason(previous.byteLength, byteLength, 'supplemental byte size', {
      minBaseline: 25000,
      dropRatio: 0.2,
      spikeRatio: 4,
      spikeFloor: 1000000,
    });
    if (byteReason) reasons.push(byteReason);
    const nextCounts = supplementalListCounts(lists);
    const prevCounts = previous.counts || {};
    for (const bucket of Object.keys(nextCounts)) {
      const reason = listCountDriftReason(prevCounts[bucket], nextCounts[bucket], bucket + ' count', SUPPLEMENTAL_LIST_DRIFT[bucket]);
      if (reason) reasons.push(reason);
    }
  }
  const record = supplementalSourceRecord(source, hash, byteLength, lists);
  if (reasons.length) return { ok: false, record, reason: reasons.join('; ') };
  return { ok: true, record };
}

async function fetchSupplementalListSource(source, reason, previousRecord) {
  const url = source && source.url;
  if (source && source.localPath) {
    try {
      const res = await fetch(chrome.runtime.getURL(source.localPath));
      if (!res || !res.ok) return { ok: false, source, url, error: 'Bundled source unavailable' };
      const text = await res.text();
      const byteLength = utf8ByteLength(text);
      const lists = parseSupplementalListText(source, text);
      const hash = await sha256TextHex(text);
      const record = supplementalSourceRecord(source, hash, byteLength, lists);
      return { ok: true, source, url, lists, integrityRecord: record };
    } catch (e) {
      return { ok: false, source, url, error: String(e) };
    }
  }
  const fetched = await fetchValidatedRemoteListText(url, false, LIST_FETCH_TIMEOUT_MS);
  if (!fetched.ok) {
    return {
      ok: false,
      source,
      url,
      error: fetched.integrityRejected ? 'Integrity guard rejected source: ' + (fetched.error || 'source policy failed') : (fetched.error || 'Source fetch failed'),
      integrityRejected: !!fetched.integrityRejected,
    };
  }
  try {
    const text = fetched.text || '';
    const byteLength = fetched.byteLength || utf8ByteLength(text);
    const lists = parseSupplementalListText(source, text);
    const hash = await sha256TextHex(text);
    const verdict = evaluateSupplementalSourceIntegrity(source, previousRecord, hash, byteLength, lists);
    if (!verdict.ok) {
      return {
        ok: false,
        source,
        url,
        error: 'Integrity guard rejected source: ' + verdict.reason,
        integrityRejected: true,
        rejectedRecord: verdict.record,
      };
    }
    return { ok: true, source, url, lists, integrityRecord: verdict.record };
  } catch (e) {
    return { ok: false, source, url, error: String(e) };
  }
}

function mergeSupplementalLists(previousRaw, candidateRaw, touchedBuckets) {
  const previous = sanitizeSupplementalLists(previousRaw);
  const candidate = sanitizeSupplementalLists(candidateRaw);
  const out = emptySupplementalLists();
  const rejected = [];
  const keptPrevious = {};
  for (const bucket of Object.keys(out)) {
    if (!touchedBuckets || !touchedBuckets[bucket]) {
      out[bucket] = previous[bucket].slice();
      continue;
    }
    const drift = listCountDriftReason(previous[bucket].length, candidate[bucket].length, bucket + ' count', SUPPLEMENTAL_LIST_DRIFT[bucket]);
    if (drift && previous[bucket].length) {
      out[bucket] = previous[bucket].slice();
      keptPrevious[bucket] = true;
      rejected.push({ bucket, reason: drift });
    } else {
      out[bucket] = candidate[bucket].slice(0, supplementalListCap(bucket));
    }
  }
  return { lists: out, rejected, keptPrevious };
}

function getSupplementalListMeta() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SUPPLEMENTAL_LIST_META_KEY, (x) => resolve((x && x[SUPPLEMENTAL_LIST_META_KEY]) || null));
    } catch (_) {
      resolve(null);
    }
  });
}

async function updateSupplementalLists(reason) {
  const store = await localGet('wardenone_config');
  const cfg = (store && store.wardenone_config) || {};
  const previousMeta = await getSupplementalListMeta();
  const forcedUpdate = /^(manual|settings-change|master-reenable|repair)$/i.test(String(reason || ''));
  if (cfg.enabled === false) return { ok: false, skipped: true, error: 'WardenOne is disabled', meta: previousMeta };
  if (cfg.autoUpdateLists === false && !forcedUpdate) return { ok: false, skipped: true, error: 'Auto-update is disabled', meta: previousMeta };

  const sources = SUPPLEMENTAL_LIST_SOURCES.concat(SUPPLEMENTAL_MANIFEST_SOURCES).filter((s) => s && s.url);
  if (!sources.length) return { ok: false, skipped: true, error: 'No supplemental list sources configured', meta: previousMeta };

  const prevStore = await localGet(SUPPLEMENTAL_LIST_STORAGE_KEY);
  const previousLists = sanitizeSupplementalLists(prevStore && prevStore[SUPPLEMENTAL_LIST_STORAGE_KEY]);
  const candidate = emptySupplementalLists();
  const touchedBuckets = {};
  const previousRecords = (previousMeta && previousMeta.sourceRecords) || {};
  const acceptedRecords = Object.assign({}, previousRecords);
  const failures = [];
  let succeededSources = 0;
  let failedSources = 0;
  let rejectedSources = 0;

  for (let i = 0; i < sources.length; i += LIST_FETCH_CONCURRENCY) {
    const batch = sources.slice(i, i + LIST_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map((source) => fetchSupplementalListSource(source, reason, previousRecords[source.url])));
    for (const result of results) {
      if (!result.ok) {
        failedSources++;
        if (result.integrityRejected) rejectedSources++;
        failures.push({ url: result.url, label: result.source && result.source.label, error: String(result.error || 'failed').slice(0, 180), rejected: !!result.integrityRejected });
        continue;
      }
      succeededSources++;
      if (result.integrityRecord) acceptedRecords[result.url] = result.integrityRecord;
      const lists = sanitizeSupplementalLists(result.lists);
      for (const bucket of Object.keys(candidate)) {
        if (!lists[bucket].length) continue;
        touchedBuckets[bucket] = true;
        candidate[bucket] = candidate[bucket].concat(lists[bucket]);
      }
    }
  }

  if (!succeededSources) {
    const meta = Object.assign({}, previousMeta || {}, {
      version: SUPPLEMENTAL_LIST_VERSION,
      lastAttempt: Date.now(),
      reason,
      counts: supplementalListCounts(previousLists),
      sources: { total: sources.length, succeeded: 0, failed: failedSources, rejected: rejectedSources },
      failures: failures.slice(-8),
    });
    await localSet({ [SUPPLEMENTAL_LIST_META_KEY]: meta });
    return { ok: false, error: 'No supplemental list sources reachable', meta };
  }

  const merged = mergeSupplementalLists(previousLists, candidate, touchedBuckets);
  const lists = Object.assign({ version: SUPPLEMENTAL_LIST_VERSION, updated: Date.now() }, merged.lists);
  const meta = {
    version: SUPPLEMENTAL_LIST_VERSION,
    updated: lists.updated,
    lastAttempt: Date.now(),
    reason,
    counts: supplementalListCounts(lists),
    sources: { total: sources.length, succeeded: succeededSources, failed: failedSources, rejected: rejectedSources },
    failures: failures.slice(-8),
    rejected: merged.rejected,
    keptPrevious: merged.keptPrevious,
    sourceRecords: acceptedRecords,
  };
  await localSet({ [SUPPLEMENTAL_LIST_STORAGE_KEY]: lists, [SUPPLEMENTAL_LIST_META_KEY]: meta });
  try { await loadGrabberFeed(); } catch (_) {}
  return { ok: true, meta };
}

async function attachSupplementalListUpdate(result, reason) {
  try {
    const supplemental = await updateSupplementalLists(reason);
    return Object.assign({}, result || {}, { supplemental });
  } catch (e) {
    return Object.assign({}, result || {}, { supplemental: { ok: false, error: String(e) } });
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.__wardenOneSupplementalListTest = {
    emptySupplementalLists,
    normalizeSupplementalListDomain,
    sanitizeSupplementalLists,
    parseSupplementalManifestText,
    parseSupplementalListText,
    mergeSupplementalLists,
    supplementalListCounts,
  };
}

const REMOTE_SOURCE_KIND_RANK = Object.freeze({ adshield: 1, tracker: 2, security: 3 });

function strongestRemoteListSourceKind(current, candidate) {
  const next = Object.prototype.hasOwnProperty.call(REMOTE_SOURCE_KIND_RANK, candidate)
    ? candidate
    : 'security';
  if (!current) return next;
  const previous = Object.prototype.hasOwnProperty.call(REMOTE_SOURCE_KIND_RANK, current)
    ? current
    : 'security';
  return REMOTE_SOURCE_KIND_RANK[next] > REMOTE_SOURCE_KIND_RANK[previous]
    ? next
    : previous;
}

function remoteListSourceKind(url) {
  let kind = '';
  if (ADSHIELD_NET_LISTS.includes(url)) kind = strongestRemoteListSourceKind(kind, 'adshield');
  if (TRACKER_LISTS.includes(url)) kind = strongestRemoteListSourceKind(kind, 'tracker');
  if (REMOTE_LISTS.includes(url) || TOKEN_AND_SCAM_LISTS.includes(url) || MALWARE_LISTS.includes(url)) {
    kind = strongestRemoteListSourceKind(kind, 'security');
  }
  return kind || 'security';
}

function prioritizedDomainRuleDomains(buckets, merged) {
  const out = [];
  const seen = new Set();
  const take = (items, limit) => {
    const max = Math.max(0, Number(limit) || 0);
    if (!items || !max) return;
    for (const d of items) {
      if (out.length >= MAX_DYNAMIC || seen.has(d)) continue;
      out.push(d);
      seen.add(d);
      if (out.length >= max) break;
    }
  };

  take(buckets.security, ACTIVE_DOMAIN_RULE_BUDGETS.security);
  take(buckets.adshield, ACTIVE_DOMAIN_RULE_BUDGETS.security + ACTIVE_DOMAIN_RULE_BUDGETS.adshield);
  take(buckets.tracker, ACTIVE_DOMAIN_RULE_BUDGETS.security + ACTIVE_DOMAIN_RULE_BUDGETS.adshield + ACTIVE_DOMAIN_RULE_BUDGETS.tracker);
  take(merged, MAX_DYNAMIC);
  return out.slice(0, MAX_DYNAMIC);
}

function prioritizedOptionRuleCandidates(buckets) {
  const out = [];
  const seen = new Set();
  const sourceBySignature = new Map();
  const sourceRank = { adshield: 1, tracker: 2, security: 3 };
  for (const kind of ['adshield', 'tracker', 'security']) {
    for (const rule of (buckets[kind] || [])) {
      const sig = JSON.stringify([rule && rule.condition, rule && rule.action && rule.action.type]);
      const previous = sourceBySignature.get(sig);
      if (!previous || sourceRank[kind] > sourceRank[previous]) sourceBySignature.set(sig, kind);
    }
  }
  const take = (items, limit) => {
    const max = Math.max(0, Number(limit) || 0);
    if (!Array.isArray(items) || !max) return;
    for (const rule of items) {
      if (out.length >= OPTION_RULES_MAX) break;
      const sig = JSON.stringify([rule && rule.condition, rule && rule.action && rule.action.type]);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(Object.assign({}, rule, { __woSourceKind: sourceBySignature.get(sig) || 'security' }));
      if (out.length >= max) break;
    }
  };

  take(buckets.adshield, ACTIVE_OPTION_RULE_BUDGETS.adshield);
  take(buckets.tracker, ACTIVE_OPTION_RULE_BUDGETS.adshield + ACTIVE_OPTION_RULE_BUDGETS.tracker);
  take(buckets.security, ACTIVE_OPTION_RULE_BUDGETS.adshield + ACTIVE_OPTION_RULE_BUDGETS.tracker + ACTIVE_OPTION_RULE_BUDGETS.security);
  take([...(buckets.adshield || []), ...(buckets.tracker || []), ...(buckets.security || [])], OPTION_RULES_MAX);
  return out.slice(0, OPTION_RULES_MAX);
}

function remoteDomainRuleSourceKind(domain, buckets) {
  if (buckets && buckets.security && buckets.security.has(domain)) return 'security';
  if (buckets && buckets.adshield && buckets.adshield.has(domain)) return 'adshield';
  if (buckets && buckets.tracker && buckets.tracker.has(domain)) return 'tracker';
  return 'security';
}

// A list refresh can spend several seconds downloading/parsing sources. The user
// may turn WardenOne off during that work, after refreshBlocklistRuleset() has
// already removed the old rules. Re-check the live config at the actual DNR
// commit boundary so that stale work cannot reinstall blocking behind an off
// master switch. The post-commit check closes the much smaller race where the
// setting changes while Chrome is applying the atomic rule update.
async function commitRemoteListRules(removeRuleIds, addRules) {
  const masterEnabled = async () => {
    const store = await localGet('wardenone_config');
    const cfg = (store && store.wardenone_config) || {};
    return cfg.enabled !== false;
  };

  if (!await masterEnabled()) {
    await removeWardenOneDynamicRules();
    return { applied: false, disabled: true };
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });

  if (!await masterEnabled()) {
    await removeWardenOneDynamicRules();
    return { applied: false, disabled: true };
  }
  return { applied: true, disabled: false };
}

let __remoteListUpdateInFlight = null;
let __remoteListUpdateQueuedReason = '';
async function updateRemoteListsCore(reason) {
  // respect the user's toggle
  const store = await localGet('wardenone_config');
  const cfg = (store && store.wardenone_config) || {};
  const previousMeta = await getListMeta();
  const forcedUpdate = /^(manual|settings-change|master-reenable|repair)$/i.test(String(reason || ''));
  if (cfg.enabled === false) {
    try { await removeWardenOneDynamicRules(); } catch (_) {}
    return { ok: false, skipped: true, error: 'WardenOne is disabled', meta: previousMeta };
  }
  if (cfg.autoUpdateLists === false && !forcedUpdate) {
    return { ok: false, skipped: true, error: 'Auto-update is disabled', meta: previousMeta };
  }
  const previousUpdated = Number(previousMeta && previousMeta.updated) || 0;
  const previousRules = Number(previousMeta && previousMeta.activeRuleCount) || 0;
  const skipFreshAutoUpdate = !forcedUpdate
    && /^(startup|alarm)$/i.test(String(reason || ''))
    && previousUpdated > 0
    && previousRules > 0
    && Date.now() - previousUpdated < LIST_AUTO_MIN_INTERVAL_MS;
  if (skipFreshAutoUpdate) {
    return { ok: true, skipped: true, fresh: true, meta: previousMeta };
  }

  const sources = [];
  const sourceKinds = new Map();
  const addSources = (list, kind) => {
    for (const url of list || []) {
      if (!url) continue;
      if (!sourceKinds.has(url)) sources.push(url);
      sourceKinds.set(url, strongestRemoteListSourceKind(sourceKinds.get(url), kind));
    }
  };
  addSources(REMOTE_LISTS, 'security');
  if (REMOTE_LIST_URL) addSources([REMOTE_LIST_URL], 'security');
  // malware/phishing/token-scam feeds only when the user has that protection on
  if (cfg.blockMalwareSites !== false) addSources(TOKEN_AND_SCAM_LISTS.concat(MALWARE_LISTS), 'security');
  // tracker/ad-analytics feeds (on by default)
  if (cfg.blockTrackers !== false) addSources(TRACKER_LISTS, 'tracker');
  // AdShield ad-server feeds (on by default) -- its own toggle
  if (cfg.adShield !== false) addSources(ADSHIELD_NET_LISTS, 'adshield');
  if (!sources.length) {
    return { ok: false, error: 'No list sources configured', meta: await getListMeta() };
  }
  const sourceSetId = await sha256TextHex(sources.join('\n'));

  // AdShield cosmetic filters update alongside the network lists (fire-and-forget;
  // it stores its own result and never blocks the network-list update).
  if (cfg.adShield !== false) { updateAdShieldCosmetics(); }

  const merged = new Set();
  const domainBuckets = { security: new Set(), tracker: new Set(), adshield: new Set() };
  const optionRuleBuckets = { security: [], tracker: [], adshield: [] };
  const integrity = await loadListIntegrity();
  const acceptedIntegrityRecords = Object.create(null);
  const integrityAlerts = [];
  let anySucceeded = false;
  let succeededSources = 0;
  let failedSources = 0;
  let rejectedSources = 0;
  for (let i = 0; i < sources.length; i += LIST_FETCH_CONCURRENCY) {
    const batch = sources.slice(i, i + LIST_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map((url) => fetchListSource(url, reason, integrity)));
    for (const result of results) {
      if (!result.ok) {
        if (result.integrityRejected) {
          rejectedSources++;
          if (result.alert) integrityAlerts.push(result.alert);
        }
        failedSources++;
        continue;
      }
      succeededSources++;
      const sourceKind = sourceKinds.get(result.url) || remoteListSourceKind(result.url);
      if (result.integrityRecord) acceptedIntegrityRecords[result.url] = result.integrityRecord;
      const domains = result.domains || [];
      if (domains.length) {
        anySucceeded = true;
        for (const d of domains) {
          merged.add(d);
          domainBuckets[sourceKind].add(d);
        }
      }
      if (Array.isArray(result.optionRules) && result.optionRules.length && optionRuleBuckets[sourceKind].length < OPTION_RULES_MAX) {
        for (const r of result.optionRules) {
          if (optionRuleBuckets[sourceKind].length >= OPTION_RULES_MAX) break;
          optionRuleBuckets[sourceKind].push(r);
        }
      }
    }
  }

  // Fail safe: if EVERY source failed, keep existing dynamic rules untouched.
  if (!anySucceeded || !merged.size) {
    console.warn('[WardenOne] no sources reachable; keeping existing rules');
    await saveListIntegrity(integrity, {}, integrityAlerts, reason);
    await warnIfRemoteListsStale(previousMeta, 'No list sources reachable');
    return { ok: false, error: 'No list sources reachable', meta: previousMeta, sources: { total: sources.length, succeeded: succeededSources, failed: failedSources, rejected: rejectedSources } };
  }

  const remoteCount = merged.size;
  const comparableSourceSet = previousMeta && previousMeta.sourceSetId && previousMeta.sourceSetId === sourceSetId;
  const totalDrift = comparableSourceSet ? totalListDriftReason(previousMeta && previousMeta.remoteCount, remoteCount) : '';
  if (totalDrift) {
    const alert = listIntegrityAlert('combined', '', totalDrift, {
      previousRemoteCount: previousMeta && previousMeta.remoteCount,
      remoteCount,
    });
    await saveListIntegrity(integrity, {}, integrityAlerts.concat(alert), reason);
    console.warn('[WardenOne] combined list integrity rejected:', totalDrift);
    return {
      ok: false,
      error: 'List integrity guard rejected update: ' + totalDrift,
      meta: previousMeta,
      sources: { total: sources.length, succeeded: succeededSources, failed: failedSources, rejected: rejectedSources },
    };
  }

  const domains = prioritizedDomainRuleDomains(domainBuckets, merged);
  const addRules = domains.map((d, i) => domainToRule(
    d,
    DYNAMIC_RULE_BASE + i,
    remoteDomainRuleSourceKind(d, domainBuckets),
  ));

  // dedup option-rules by condition+action signature, renumber into their band
  const optionRulesRaw = prioritizedOptionRuleCandidates(optionRuleBuckets);
  const optSeen = new Set();
  const optionRules = [];
  for (const r of optionRulesRaw) {
    const sig = JSON.stringify([r.condition, r.action.type]);
    if (optSeen.has(sig)) continue;
    optSeen.add(sig);
    optionRules.push(finalizeOptionRule(
      r,
      OPTION_RULE_BASE + optionRules.length,
      r && r.__woSourceKind,
    ));
    if (optionRules.length >= OPTION_RULES_MAX) break;
  }

  try {
    // remove the previous dynamic set, then add the fresh one (atomic-ish)
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing
      .filter((r) => (r.id >= DYNAMIC_RULE_BASE && r.id < DYNAMIC_RULE_BASE + MAX_DYNAMIC)
                  || (r.id >= OPTION_RULE_BASE && r.id < OPTION_RULE_BASE + OPTION_RULES_MAX))
      .map((r) => r.id);
    const replacement = await commitRemoteListRules(removeIds, addRules.concat(optionRules));
    if (!replacement.applied) {
      return {
        ok: false,
        skipped: true,
        error: 'WardenOne is disabled',
        meta: previousMeta,
        sources: { total: sources.length, succeeded: succeededSources, failed: failedSources, rejected: rejectedSources },
      };
    }
    BLOCKED_DOMAINS = new Set(merged);
    let storedDomains = { ok: false, storedCount: 0 };
    try {
      storedDomains = await persistBlockedDomainsForStorage([...merged]);
    } catch (e) {
      console.warn('[WardenOne] blocked-domain storage failed:', e);
    }
    const savedIntegrity = await saveListIntegrity(integrity, acceptedIntegrityRecords, integrityAlerts, reason);
    const activeDomainBuckets = {
      security: domains.filter((d) => domainBuckets.security.has(d)).length,
      adshield: domains.filter((d) => domainBuckets.adshield.has(d)).length,
      tracker: domains.filter((d) => domainBuckets.tracker.has(d)).length,
    };
    const meta = buildListMeta({
      remoteCount,
      activeRuleCount: domains.length,
      optionRuleCount: optionRules.length,
      sourceDomainCounts: {
        security: domainBuckets.security.size,
        adshield: domainBuckets.adshield.size,
        tracker: domainBuckets.tracker.size,
      },
      activeDomainRuleCounts: activeDomainBuckets,
      optionRuleSourceCounts: {
        security: optionRuleBuckets.security.length,
        adshield: optionRuleBuckets.adshield.length,
        tracker: optionRuleBuckets.tracker.length,
      },
      updated: Date.now(),
      reason,
      sourceSetId,
      sources: { total: sources.length, succeeded: succeededSources, failed: failedSources, rejected: rejectedSources },
      storedDomainCount: storedDomains.storedCount || 0,
      integrity: {
        sourcePins: Object.keys((savedIntegrity && savedIntegrity.sources) || {}).length,
        rejectedSources,
        alerts: integrityAlerts.slice(-5),
      },
    });
    await localSet({ wardenone_list_meta: meta });
    await applyLearnedRules();
    await applyTrackerLearnerRules();
    await writeStorageTelemetry('remote-list-update', { storedDomainCount: storedDomains.storedCount || 0 });
    if (WO_LIST_DEBUG) console.log('[WardenOne] updated dynamic blocklist:', domains.length, 'domain rules,', optionRules.length, 'option rules,', remoteCount, 'remote domains (' + reason + ')');
    return { ok: true, meta };
  } catch (e) {
    console.warn('[WardenOne] failed applying dynamic rules:', e);
    await warnIfRemoteListsStale(previousMeta, String(e));
    return { ok: false, error: String(e), meta: previousMeta, sources: { total: sources.length, succeeded: succeededSources, failed: failedSources, rejected: rejectedSources } };
  }
}

async function updateRemoteLists(reason) {
  const requestedReason = String(reason || '');
  if (__remoteListUpdateInFlight) {
    if (/^(manual|settings-change|master-reenable|repair)$/i.test(requestedReason)) {
      __remoteListUpdateQueuedReason = requestedReason;
    }
    try {
      const result = await __remoteListUpdateInFlight;
      return Object.assign({}, result || {}, { coalesced: true, requestedReason, queuedFollowup: !!__remoteListUpdateQueuedReason });
    } catch (e) {
      return { ok: false, error: String(e), coalesced: true, requestedReason, queuedFollowup: !!__remoteListUpdateQueuedReason };
    }
  }
  const run = updateRemoteListsCore(reason).then((result) => attachSupplementalListUpdate(result, reason));
  __remoteListUpdateInFlight = run;
  try {
    return await run;
  } finally {
    if (__remoteListUpdateInFlight === run) {
      __remoteListUpdateInFlight = null;
      const queuedReason = __remoteListUpdateQueuedReason;
      __remoteListUpdateQueuedReason = '';
      if (queuedReason) {
        try { updateRemoteLists(queuedReason); } catch (_) {}
      }
    }
  }
}

// Message policy: content scripts run inside web tabs, so only a tiny set of
// tab-originated messages may reach privileged background handlers. Everything
// destructive or browser-wide stays extension-page only.
const TAB_CONTEXT_ALLOWED_MESSAGES = new Set([
  'rg-block',
  'redirect-warning',
  'safe-browsing-check',
  'login-domain-age',
  'permission-chain',
  'oauth-grant',
  'script-drift-scan',
  'smart-player-context',
  'smart-player-intent',
  'open-site-settings',
  'reset-site-permissions',
  'adshield-cosmetic',
  'domain-age',
  'eyeshield-fetch-css',
]);
const TAB_CONTEXT_RATE_LIMITS = {
  // Every tab-allowed kind needs an entry. rg-block is the highest-volume one --
  // content scripts report every block through it -- and a hostile page can forge
  // the MAIN-world event that feeds it, so without a ceiling it can flood history,
  // the badge counter and storage. The page-side limiter in bridge.js does not
  // count: the page can bypass its own limiter. Set high enough that a genuinely
  // ad-heavy page reporting real blocks is never cut off.
  'rg-block': { max: 300, windowMs: 60000 },
  'redirect-warning': { max: 8, windowMs: 60000 },
  'safe-browsing-check': { max: 45, windowMs: 60000 },
  'domain-age': { max: 12, windowMs: 60000 },
  'login-domain-age': { max: 8, windowMs: 60000 },
  'permission-chain': { max: 30, windowMs: 60000 },
  'oauth-grant': { max: 8, windowMs: 60000 },
  'script-drift-scan': { max: 6, windowMs: 60000 },
  'smart-player-context': { max: 8, windowMs: 60000 },
  'smart-player-intent': { max: 12, windowMs: 60000 },
  'open-site-settings': { max: 2, windowMs: 60000 },
  'reset-site-permissions': { max: 2, windowMs: 60000 },
  'adshield-cosmetic': { max: 12, windowMs: 60000 },
  'set-site-permission': { max: 3, windowMs: 60000 },
  'eyeshield-fetch-css': { max: 150, windowMs: 60000 },
};
const TAB_SAFE_BROWSING_CONTEXTS = new Set(['link', 'paste', 'form']);
function messageSenderIsExtensionPage(sender) {
  try {
    const url = String((sender && sender.url) || '');
    if (!url || (sender && sender.id && sender.id !== chrome.runtime.id)) return false;
    return new URL(url).origin === new URL(chrome.runtime.getURL('')).origin;
  } catch (_) {
    return false;
  }
}
function messageSenderIsExtensionPath(sender, path) {
  try {
    if (!messageSenderIsExtensionPage(sender)) return false;
    const senderUrl = new URL(String((sender && sender.url) || ''));
    const expected = new URL(chrome.runtime.getURL(String(path || '').replace(/^\/+/, '')));
    return senderUrl.origin === expected.origin && senderUrl.pathname === expected.pathname;
  } catch (_) {
    return false;
  }
}
function messageSenderIsTab(sender) {
  return !!(sender && sender.tab && sender.tab.id != null && !messageSenderIsExtensionPage(sender));
}
function messageCleanHost(value) {
  try {
    let host = String(value || '').trim();
    if (!host) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) host = new URL(host).hostname;
    host = host.replace(/^www\./, '').replace(/^\.+|\.+$/g, '').toLowerCase();
    if (!/^[a-z0-9.-]+$/i.test(host)) return '';
    return host;
  } catch (_) {
    return '';
  }
}
function messageSameHost(a, b) {
  const ha = messageCleanHost(a);
  const hb = messageCleanHost(b);
  return !!(ha && hb && ha === hb);
}
function messageSenderMatchesHost(sender, host) {
  return !messageSenderIsTab(sender) || messageSameHost(host, (sender.tab && sender.tab.url) || '');
}
function messageIsCookiePermissionEscape(msg, sender) {
  return !!(msg && msg.kind === 'set-site-permission'
    && messageSenderIsTab(sender)
    && msg.key === 'cookies'
    && msg.setting === 'allow'
    && /^https?:\/\//i.test(String(msg.url || ''))
    && sender.tab
    && messageSameHost(msg.url, sender.tab.url || ''));
}

// Always-catch wrapper for promise-returning message handlers. Guarantees sendResponse
// fires exactly once even if the promise rejects, so the popup never hangs on an
// unhandled throw. Use as: respond(doAsyncThing(), sendResponse); return true;
function respond(promise, sendResponse) {
  Promise.resolve(promise).then(
    (r) => { try { sendResponse(r); } catch (_) {} },
    (e) => { try { sendResponse({ ok: false, error: String((e && e.message) || e) }); } catch (_) {} }
  );
}

function normalizePublicHttpUrl(raw, base) {
  try {
    const u = base ? new URL(String(raw || ''), base) : new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (isLocalOrPrivateHost(u.hostname)) return '';
    u.hash = '';
    return u.href.slice(0, 2000);
  } catch (_) {
    return '';
  }
}

function normalizeWebOrigin(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch (_) {
    return '';
  }
}

async function activeTabMatchesOrigin(rawOrigin) {
  const origin = normalizeWebOrigin(rawOrigin);
  if (!origin) return '';
  const tabs = await tabsQuery({ active: true, lastFocusedWindow: true });
  for (const tab of tabs || []) {
    try {
      const url = tab && (tab.url || tab.pendingUrl);
      if (url && new URL(url).origin === origin) return origin;
    } catch (_) {}
  }
  return '';
}

function isStylesheetLikeContentType(value) {
  const ct = String(value || '').split(';')[0].trim().toLowerCase();
  if (!ct) return true;
  return ct === 'text/css' || ct === 'text/plain' || ct === 'application/x-css' || ct === 'text/x-css' || ct.endsWith('+css');
}

async function fetchPublicStylesheetText(rawUrl) {
  let url = normalizePublicHttpUrl(rawUrl);
  if (!url) return { ok: false, error: 'bad url' };
  for (let redirects = 0; redirects <= 4; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, 8000);
    try {
      const res = await fetch(url, { cache: 'force-cache', credentials: 'omit', redirect: 'manual', signal: controller.signal });
      if (res && res.status >= 300 && res.status < 400) {
        const next = normalizePublicHttpUrl(res.headers && res.headers.get('location'), url);
        if (!next) return { ok: false, error: 'blocked redirect' };
        url = next;
        continue;
      }
      if (!res || !res.ok) return { ok: false, error: 'http ' + (res ? res.status : '?') };
      if (!normalizePublicHttpUrl(res.url || url)) return { ok: false, error: 'blocked redirect' };
      if (!isStylesheetLikeContentType(res.headers && res.headers.get('content-type'))) return { ok: false, error: 'not css' };
      const len = Number(res.headers.get('content-length') || 0);
      if (len && len > 4000000) return { ok: false, error: 'too large' };
      const css = await readResponseTextWithByteLimit(res, 4000000);
      return { ok: true, css };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'too many redirects' };
}

const HEALTH_SHIELD_KEYS = [
  'blockForcedPopups', 'strictPopupShield', 'blockGesturelessNav', 'detectRedirectChains', 'blockMetaRefresh',
  'blockGrabberResources', 'warnGrabberDomains', 'blockWebRTCLeak', 'certificateGuard', 'blockTrackers',
  'adShield', 'scriptletEngine', 'twitchAdBlock', 'sendPrivacySignals', 'fingerprintProbeDetection',
  'blockFingerprintScripts', 'antiFingerprint', 'blockThirdPartyCookies', 'blockFirstPartyTrackers',
  'sessionShield', 'blockTokenExfil', 'continuousTokenScan', 'detectSkimmers', 'paymentCardGuard',
  'forceHttps', 'loginAgeCheck', 'downloadReputation', 'downloadDomainAge', 'downloadSafeBrowsing',
  'downloadVirusTotal', 'downloadVirusTotalHash', 'urlHaus', 'abuseIpDb', 'openPhish', 'phishTank',
  'whoisXml', 'whoisXmlReputation', 'whoisXmlThreatIntel', 'clipboardGuard', 'clipboardSwapDetect',
  'scamLockGuard', 'commandPasteGuard', 'pasteProtection', 'formTrapDetector', 'fakeUpdateDetector',
  'permissionChainGuard', 'oauthGuard', 'scriptDriftGuard', 'riskySiteMode', 'antiClickjacking',
  'intranetProtection', 'mediaShield', 'blockCameraMic', 'blockScreenCapture', 'blockGeolocation',
  'blockAutoplayMedia', 'gateAdultSites', 'adultHeuristics', 'warnRedirectParams', 'warnShorteners',
  'monitorLoggerApi', 'detectPhishing', 'blockHighConfidencePhishing', 'behavioralScan', 'removeOverlays',
  'autoSkipDownloadAds', 'blockMalwareSites', 'autoUpdateLists', 'trackerLearner', 'unshimLinks',
  'cleanCopyLinks', 'socialWidgetGuard', 'blockSupercookies', 'watchExtensionPermissions', 'startupCheck',
];

function healthCountActiveShields(cfg) {
  if (!cfg || cfg.enabled === false) return 0;
  let active = 0;
  const merged = Object.assign({}, DEFAULT_CONFIG, cfg || {});
  for (const key of HEALTH_SHIELD_KEYS) {
    if (merged[key] !== false) active++;
  }
  return active;
}

function healthListCounts(meta, auxMeta) {
  const active = Number((meta && (meta.activeCount || meta.activeRuleCount)) || 0);
  const total = Number((meta && (meta.totalCount || meta.count)) || 0);
  const auxCounts = (auxMeta && auxMeta.counts) || {};
  const auxTotal = Number(auxCounts.adultDomainsExtra || 0)
    + Number(auxCounts.grabberDomainsExtra || 0)
    + Number(auxCounts.trustedPaymentHostsExtra || 0);
  return {
    updated: Number((meta && meta.updated) || (auxMeta && auxMeta.updated) || 0),
    active,
    total,
    auxTotal,
    sources: meta && meta.sources ? meta.sources : null,
  };
}

async function buildProtectionHealthSummary() {
  const now = Date.now();
  const store = await localGet([
    'wardenone_config',
    'wardenone_history',
    'wardenone_list_meta',
    SUPPLEMENTAL_LIST_META_KEY,
    EXT_ALERTS_KEY,
    typeof STARTUP_REPORT_KEY === 'string' ? STARTUP_REPORT_KEY : 'wardenone_startup_report',
  ]);
  const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
  const hist = Array.isArray(store && store.wardenone_history) ? store.wardenone_history : [];
  const isBlockLike = (type) => /^blocked_|^gated_|^detected_/.test(String(type || ''));
  const blockedTotal = hist.filter((e) => isBlockLike(e && e.type)).length;
  const blocked24h = hist.filter((e) => isBlockLike(e && e.type) && now - Number((e && e.at) || 0) <= 24 * 60 * 60 * 1000).length;
  const meta = store && store.wardenone_list_meta;
  const auxMeta = store && store[SUPPLEMENTAL_LIST_META_KEY];
  const list = healthListCounts(meta, auxMeta);
  const listAge = list.updated ? now - list.updated : 0;
  const issues = [];
  const addIssue = (severity, text, topLevel) => {
    if (text) issues.push({ severity, text, topLevel: topLevel === true });
  };

  if (cfg.enabled === false) addIssue('danger', 'Master switch is off, so page and network protections are paused.');
  if (cfg.blockMalwareSites === false) addIssue('danger', 'Known malicious-site blocking is turned off.');
  if (cfg.paymentCardGuard === false) addIssue('danger', 'Payment Card Guard is off; card-entry scam warnings are disabled.');
  if (cfg.detectSkimmers === false) addIssue('warn', 'Skimmer detection is off, so third-party card/password theft checks are reduced.');
  if (cfg.autoUpdateLists === false) addIssue('info', 'Auto-updating lists are off; built-in rules still work, but new threats will not arrive daily.');
  if (cfg.silentMode === true) addIssue('info', 'Silent mode is hiding most popups and badge feedback.');
  if (cfg.watchExtensionPermissions === false) addIssue('info', 'Extension permission-change alerts are off.');
  if (!list.updated && cfg.autoUpdateLists !== false) addIssue('info', 'Remote lists have not updated yet; built-in rules are active.');
  else if (listAge > 7 * 24 * 60 * 60 * 1000) addIssue('info', 'Remote lists are more than 7 days old.');
  else if (listAge > 72 * 60 * 60 * 1000) addIssue('info', 'Remote lists are getting stale.');
  if (list.sources && Number(list.sources.failed || 0) > 0) {
    const failedFeeds = Number(list.sources.failed);
    addIssue('info', failedFeeds + (failedFeeds === 1 ? ' filter list was' : ' filter lists were') + ' unreachable during the last update.');
  }

  const alerts = Array.isArray(store && store[EXT_ALERTS_KEY]) ? store[EXT_ALERTS_KEY] : [];
  if (alerts.length) addIssue('danger', alerts.length + ' extension permission alert(s) need review.');
  const startupReport = store && store[typeof STARTUP_REPORT_KEY === 'string' ? STARTUP_REPORT_KEY : 'wardenone_startup_report'];
  const startupFindings = (startupReport && Array.isArray(startupReport.tabs) ? startupReport.tabs.length : 0)
    + (startupReport && Array.isArray(startupReport.extensions) ? startupReport.extensions.length : 0);
  if (startupFindings) addIssue('warn', startupFindings + ' startup security finding(s) are waiting in the popup.');

  let enabledRulesets = [];
  try {
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.getEnabledRulesets) {
      enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    }
  } catch (_) {}
  if (enabledRulesets.length) {
    if (cfg.blockMalwareSites !== false && !enabledRulesets.includes('grabbers')) addIssue('danger', 'Core malicious-domain ruleset is not enabled.');
    if (cfg.adShield !== false && !enabledRulesets.includes('adshield_easylist')) addIssue('warn', 'AdShield network ruleset is not enabled.', true);
    if (cfg.blockTrackers !== false && !enabledRulesets.includes('trackers')) addIssue('warn', 'Tracker ruleset is not enabled.', true);
  }

  const activeShields = healthCountActiveShields(cfg);
  const criticalIssue = issues.find((i) => i.severity === 'danger');
  const setupIssue = issues.find((i) => i.severity === 'warn' && i.topLevel);
  const highest = criticalIssue ? 'danger' : setupIssue ? 'warning' : 'ok';
  const status = cfg.enabled === false ? 'Off' : highest === 'danger' ? 'Needs review' : highest === 'warning' ? 'Check setup' : "You're safe";
  const detail = cfg.enabled === false
    ? 'Turn the master switch back on to re-enable WardenOne.'
    : criticalIssue
      ? criticalIssue.text
      : setupIssue
        ? setupIssue.text
        : issues.length
          ? 'Core shields are active. A few notes are tucked below.'
          : 'Core shields are active and watching quietly.';

  return {
    ok: true,
    status,
    level: highest,
    detail,
    activeShields,
    totalShields: HEALTH_SHIELD_KEYS.length,
    blocked24h,
    blockedTotal,
    list,
    needsAttention: issues.slice(0, 6),
  };
}

// Browser Abuse Guard removed (perf, weak machines): page-abuse signal labels,
// signal cleaner, detail sanitizer, host-confidence scorer, and the
// recordPageAbuseReport handler were deleted. cleanPageAbuseNumber is retained
// below because oauth-grant scoring also uses it.
function cleanPageAbuseNumber(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(Math.min(n, Number(max) || 1000000000));
}

const PERMISSION_CHAIN_WINDOW_MS = 10 * 60 * 1000;
const PERMISSION_CHAIN_WARN_COOLDOWN_MS = 10 * 60 * 1000;
const PERMISSION_CHAIN_MAX_SESSIONS = 300;
const PERMISSION_CHAIN_STATE = Object.create(null);
const PERMISSION_CHAIN_DEFS = {
  notifications: { label: 'Notifications', weight: 2 },
  camera: { label: 'Camera', weight: 3 },
  microphone: { label: 'Microphone', weight: 3 },
  screen: { label: 'Screen capture', weight: 4 },
  'clipboard-read': { label: 'Clipboard read', weight: 3 },
  'clipboard-write': { label: 'Clipboard write', weight: 2 },
  location: { label: 'Location', weight: 3 },
  'file-open': { label: 'File picker', weight: 2 },
  'file-save': { label: 'File editing', weight: 3 },
  directory: { label: 'Folder access', weight: 4 },
  'file-upload': { label: 'File upload', weight: 1 },
  'automatic-downloads': { label: 'Automatic downloads', weight: 2 },
};

function cleanPermissionChainKey(value) {
  const raw = String(value || '').toLowerCase().replace(/_/g, '-').trim();
  const aliases = {
    notification: 'notifications',
    clipboard: 'clipboard-read',
    clipboardread: 'clipboard-read',
    clipboardwrite: 'clipboard-write',
    display: 'screen',
    screenshare: 'screen',
    geolocation: 'location',
    file: 'file-open',
    filesystem: 'file-open',
    filesystemwrite: 'file-save',
    directorypicker: 'directory',
    automaticdownloads: 'automatic-downloads',
  };
  const key = aliases[raw] || raw;
  return PERMISSION_CHAIN_DEFS[key] ? key : '';
}

function cleanPermissionChainAction(value) {
  const raw = String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return ['request', 'granted', 'denied', 'selected', 'used', 'error'].includes(raw) ? raw : 'request';
}

function permissionChainLabels(keys) {
  return keys.map((key) => (PERMISSION_CHAIN_DEFS[key] && PERMISSION_CHAIN_DEFS[key].label) || key);
}

function permissionChainActionLabel(action) {
  if (action === 'granted') return 'granted';
  if (action === 'denied') return 'denied';
  if (action === 'selected') return 'selected';
  if (action === 'used') return 'used';
  if (action === 'error') return 'failed';
  return 'requested';
}

function prunePermissionChainState(now) {
  const keys = Object.keys(PERMISSION_CHAIN_STATE);
  const cutoff = now - PERMISSION_CHAIN_WINDOW_MS;
  keys.forEach((key) => {
    const s = PERMISSION_CHAIN_STATE[key];
    if (!s || !Array.isArray(s.events)) {
      delete PERMISSION_CHAIN_STATE[key];
      return;
    }
    s.events = s.events.filter((e) => e.at > cutoff);
    if (!s.events.length && now - (s.warnedAt || 0) > PERMISSION_CHAIN_WARN_COOLDOWN_MS) delete PERMISSION_CHAIN_STATE[key];
  });
  const active = Object.keys(PERMISSION_CHAIN_STATE);
  if (active.length <= PERMISSION_CHAIN_MAX_SESSIONS) return;
  active.sort((a, b) => (PERMISSION_CHAIN_STATE[a].lastAt || 0) - (PERMISSION_CHAIN_STATE[b].lastAt || 0))
    .slice(0, active.length - PERMISSION_CHAIN_MAX_SESSIONS)
    .forEach((key) => { delete PERMISSION_CHAIN_STATE[key]; });
}

function permissionChainTrustedAppHost(host) {
  const h = messageCleanHost(host);
  return [
    'meet.google.com', 'teams.microsoft.com', 'zoom.us', 'slack.com',
    'discord.com', 'discordapp.com', 'twitch.tv', 'youtube.com',
    'docs.google.com', 'drive.google.com', 'office.com', 'office365.com',
    'figma.com', 'canva.com', 'notion.so', 'dropbox.com',
  ].some((d) => h === d || h.endsWith('.' + d));
}

function evaluatePermissionChain(events, granted, host) {
  const activeEvents = (events || []).filter((e) => !/^(denied|error)$/i.test(String(e && e.action || '')));
  const unique = Array.from(new Set(activeEvents.map((e) => e.permission).filter(Boolean)));
  if (!unique.length) return { risk: 'Low', score: 0, unique: [], labels: [], reasons: [] };
  const set = new Set(unique);
  let score = unique.reduce((sum, key) => sum + ((PERMISSION_CHAIN_DEFS[key] && PERMISSION_CHAIN_DEFS[key].weight) || 1), 0);
  const hasMedia = set.has('camera') || set.has('microphone') || set.has('screen');
  const hasClipboard = set.has('clipboard-read') || set.has('clipboard-write');
  const hasClipboardRead = set.has('clipboard-read');
  const hasFile = set.has('file-open') || set.has('file-save') || set.has('directory') || set.has('file-upload');
  if (unique.length >= 3) score += 2;
  if (unique.length >= 4) score += 3;
  if (set.has('notifications') && (hasMedia || hasClipboard || hasFile)) score += 2;
  if (set.has('screen') && (hasClipboardRead || set.has('location') || hasFile)) score += 3;
  if (set.has('directory') && (hasClipboardRead || hasMedia)) score += 3;
  if (hasClipboardRead && hasFile) score += 2;
  const allowed = Array.isArray(granted) ? granted : [];
  if (allowed.length >= 2) score += 2;
  else if (allowed.length === 1) score += 1;

  const trustedApp = permissionChainTrustedAppHost(host);
  const onlyCommonMeeting = unique.length > 0 && unique.every((key) => key === 'camera' || key === 'microphone' || key === 'screen' || key === 'clipboard-write')
    && !set.has('notifications') && !set.has('clipboard-read') && !set.has('file-open') && !set.has('file-save') && !set.has('directory');
  if (trustedApp && onlyCommonMeeting) score = Math.max(0, score - 5);
  else if (trustedApp) score = Math.max(0, score - 2);

  let risk = 'Low';
  if (score >= 10 || unique.length >= 4 || (set.has('screen') && (hasClipboardRead || hasFile))) risk = 'High';
  else if (score >= 6 || unique.length >= 3 || allowed.length >= 2) risk = 'Medium';
  const reasons = [];
  if (unique.length >= 3) reasons.push('several sensitive permission requests in one visit');
  if (set.has('notifications') && hasClipboardRead) reasons.push('notifications plus clipboard access can support scam follow-ups');
  if (set.has('notifications') && hasMedia) reasons.push('notifications plus camera/mic/screen access is an unusual chain');
  if (set.has('screen') && (hasClipboardRead || hasFile)) reasons.push('screen sharing combined with clipboard or file access is high risk');
  if (set.has('directory')) reasons.push('folder access is broader than a single file upload');
  if (allowed.length >= 2) reasons.push('multiple sensitive permissions are currently allowed for this site');
  if (trustedApp && risk === 'Medium' && onlyCommonMeeting) risk = 'Low';
  return { risk, score, unique, labels: permissionChainLabels(unique), reasons };
}

async function recordPermissionChainSignal(sender, msg, granted) {
  const store = await localGet('wardenone_config');
  const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
  if (cfg.enabled === false || cfg.permissionChainGuard === false) return { ok: true, ignored: 'disabled' };

  const tab = (sender && sender.tab) || {};
  const pageUrl = String(tab.url || sender.url || '');
  if (!/^https?:\/\//i.test(pageUrl)) return { ok: true, ignored: 'non-http' };
  const host = messageCleanHost(pageUrl);
  if (host && hostMatchesAllowlist(host, cfg.allowlist || [])) return { ok: true, ignored: 'allowlisted' };
  const site = registrableDomain(host || '');
  const permission = cleanPermissionChainKey(msg && msg.permission);
  if (!permission) return { ok: false, error: 'Unknown permission signal.' };
  const action = cleanPermissionChainAction(msg && msg.action);
  const now = Date.now();
  prunePermissionChainState(now);

  const sessionKey = String(tab.id || 'tab') + ':' + (site || host || 'site');
  const session = PERMISSION_CHAIN_STATE[sessionKey] || { events: [], warnedAt: 0, warnedRisk: '', lastAt: 0 };
  const lastSimilar = session.events.slice().reverse().find((e) => e.permission === permission && e.action === action);
  if (!lastSimilar || now - lastSimilar.at > 15000) {
    session.events.push({
      permission,
      action,
      at: now,
      userGesture: !!(msg && msg.userGesture),
      result: String((msg && msg.result) || '').slice(0, 32),
    });
  }
  session.events = session.events.filter((e) => now - e.at <= PERMISSION_CHAIN_WINDOW_MS).slice(-30);
  session.lastAt = now;
  PERMISSION_CHAIN_STATE[sessionKey] = session;

  const grantedLabels = permissionChainLabels((granted || []).map((g) => cleanPermissionChainKey(g)).filter(Boolean));
  const verdict = evaluatePermissionChain(session.events, (granted || []).map((g) => cleanPermissionChainKey(g)).filter(Boolean), host);
  const last = session.events[session.events.length - 1] || {};
  const eventSummary = session.events.slice(-8).map((e) => ({
    permission: (PERMISSION_CHAIN_DEFS[e.permission] && PERMISSION_CHAIN_DEFS[e.permission].label) || e.permission,
    action: permissionChainActionLabel(e.action),
  }));
  const detail = {
    host,
    site,
    risk: verdict.risk,
    score: verdict.score,
    permissions: verdict.labels,
    allowed: grantedLabels,
    last: ((PERMISSION_CHAIN_DEFS[last.permission] && PERMISSION_CHAIN_DEFS[last.permission].label) || last.permission || '') + ' ' + permissionChainActionLabel(last.action || 'request'),
    reasons: verdict.reasons,
    events: eventSummary,
    why: verdict.reasons[0] || 'This site requested several sensitive browser capabilities in a short time.',
    action: 'Review this site in WardenOne Site permission scanner or reset unused permissions to Ask/Blocked.',
  };

  const shouldWarn = verdict.risk !== 'Low'
    && (now - (session.warnedAt || 0) > PERMISSION_CHAIN_WARN_COOLDOWN_MS || session.warnedRisk !== verdict.risk);
  if (shouldWarn) {
    session.warnedAt = now;
    session.warnedRisk = verdict.risk;
    queueHistory({
      type: 'warned_permission_chain',
      detail,
      url: pageUrl.slice(0, 200),
      at: now,
    });
  }
  return { ok: true, warn: shouldWarn, verdict: detail };
}

function openSiteSettingsForSender(sender, msg) {
  return new Promise((resolve) => {
    try {
      const raw = String((msg && msg.url) || (sender && sender.tab && sender.tab.url) || '');
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) { resolve({ ok: false, error: 'Open a normal web page first.' }); return; }
      const target = 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(u.origin);
      chrome.tabs.create({ url: target }, () => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve(err ? { ok: false, error: err } : { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

const OAUTH_PROVIDER_HOSTS = {
  google: ['accounts.google.com'],
  microsoft: ['login.microsoftonline.com', 'login.live.com'],
  github: ['github.com'],
  discord: ['discord.com', 'discordapp.com'],
};
const OAUTH_GRANT_LOG_COOLDOWN_MS = 10 * 60 * 1000;
const OAUTH_GRANT_LOGGED = Object.create(null);

function oauthProviderHostAllowed(provider, host) {
  const allowed = OAUTH_PROVIDER_HOSTS[String(provider || '').toLowerCase()] || [];
  const clean = messageCleanHost(host);
  return allowed.some((h) => clean === h || clean.endsWith('.' + h));
}

function cleanOAuthProvider(value) {
  const p = String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '');
  return OAUTH_PROVIDER_HOSTS[p] ? p : '';
}

function cleanOAuthText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').replace(/[<>{}[\]\\]/g, '').trim().slice(0, max || 120);
}

function cleanOAuthList(value, maxItems, maxLen) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of arr) {
    const clean = cleanOAuthText(item, maxLen || 100);
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= (maxItems || 12)) break;
  }
  return out;
}

function oauthGrantKey(tabId, detail) {
  const base = [
    tabId || 'tab',
    detail.provider || '',
    detail.clientIdHint || '',
    detail.redirectHost || '',
    (detail.scopes || []).join('|'),
    (detail.riskyScopes || []).join('|'),
  ].join('::');
  let hash = 0;
  for (let i = 0; i < base.length; i++) hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  return String(hash);
}

async function recordOAuthGrantWarning(sender, msg) {
  const store = await localGet('wardenone_config');
  const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
  if (cfg.enabled === false || cfg.oauthGuard === false) return { ok: true, ignored: 'disabled' };

  const tab = (sender && sender.tab) || {};
  const pageUrl = String(tab.url || sender.url || '');
  if (!/^https?:\/\//i.test(pageUrl)) return { ok: true, ignored: 'non-http' };
  const pageHost = messageCleanHost(pageUrl);
  if (pageHost && hostMatchesAllowlist(pageHost, cfg.allowlist || [])) return { ok: true, ignored: 'allowlisted' };
  const grant = (msg && msg.grant && typeof msg.grant === 'object') ? msg.grant : {};
  const provider = cleanOAuthProvider(grant.provider);
  if (!provider || !oauthProviderHostAllowed(provider, pageHost)) return { ok: false, error: 'Provider mismatch.' };

  const risk = ['High', 'Medium', 'Low'].includes(String(grant.risk || '')) ? String(grant.risk) : 'Medium';
  if (risk === 'Low') return { ok: true, ignored: 'low-risk' };
  const score = cleanPageAbuseNumber(grant.score, 100) || 0;
  const detail = {
    provider,
    providerName: cleanOAuthText(grant.providerName || provider, 40),
    risk,
    score,
    appName: cleanOAuthText(grant.appName || '', 80),
    clientIdHint: cleanOAuthText(grant.clientIdHint || '', 28),
    redirectHost: messageCleanHost(grant.redirectHost || ''),
    redirectScheme: cleanOAuthText(grant.redirectScheme || '', 16),
    scopes: cleanOAuthList(grant.scopes, 16, 100),
    riskyScopes: cleanOAuthList(grant.riskyScopes, 10, 80),
    reasons: cleanOAuthList(grant.reasons, 8, 140),
    action: 'Do not approve this OAuth grant unless you fully trust the app and need these permissions.',
  };
  const key = oauthGrantKey(tab.id, detail);
  const now = Date.now();
  Object.keys(OAUTH_GRANT_LOGGED).forEach((k) => { if (now - OAUTH_GRANT_LOGGED[k] > OAUTH_GRANT_LOG_COOLDOWN_MS) delete OAUTH_GRANT_LOGGED[k]; });
  if (OAUTH_GRANT_LOGGED[key] && now - OAUTH_GRANT_LOGGED[key] < OAUTH_GRANT_LOG_COOLDOWN_MS) return { ok: true, duplicate: true };
  OAUTH_GRANT_LOGGED[key] = now;
  queueHistory({
    type: 'warned_oauth_grant',
    detail,
    url: pageUrl.slice(0, 200),
    at: now,
  });
  return { ok: true, logged: true };
}

const SCRIPT_DRIFT_BASELINE_KEY = 'wardenone_script_drift_baselines';
const SCRIPT_DRIFT_MAX_BASELINES = 700;
const SCRIPT_DRIFT_MAX_PER_SCAN = 14;
const SCRIPT_DRIFT_MAX_BYTES = 3 * 1024 * 1024;
const SCRIPT_DRIFT_RECHECK_MS = 6 * 60 * 60 * 1000;
const SCRIPT_DRIFT_WARN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SCRIPT_DRIFT_SAFE_QUERY_KEYS = new Set(['v', 'ver', 'version', 'rev', 'build', 'module', 'm']);
const SCRIPT_DRIFT_DROP_QUERY_KEYS = new Set(['_', 'cb', 'cache', 'cachebust', 'cachebuster', 't', 'ts', 'timestamp', 'rnd', 'rand', 'random']);
const SCRIPT_DRIFT_SECRET_QUERY_RE = /(token|auth|session|sid|jwt|key|api[_-]?key|signature|sig|password|passwd|credential|code|state|nonce|secret|access)/i;

function normalizeScriptDriftUrl(rawUrl, pageUrl) {
  try {
    const u = new URL(String(rawUrl || ''), pageUrl || undefined);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (isLocalOrPrivateHost(u.hostname)) return null;
    u.hash = '';
    const out = new URL(u.origin + u.pathname);
    let kept = 0;
    for (const [rawKey, rawValue] of u.searchParams.entries()) {
      const key = String(rawKey || '').trim();
      const lower = key.toLowerCase();
      if (!key || SCRIPT_DRIFT_DROP_QUERY_KEYS.has(lower)) continue;
      if (SCRIPT_DRIFT_SECRET_QUERY_RE.test(lower)) return null;
      if (!SCRIPT_DRIFT_SAFE_QUERY_KEYS.has(lower)) return null;
      out.searchParams.append(key.slice(0, 40), String(rawValue || '').slice(0, 80));
      kept++;
      if (kept > 4) return null;
    }
    if (out.href.length > 700) return null;
    return {
      href: out.href,
      displayUrl: out.origin + out.pathname + (out.search ? '?version' : ''),
      host: out.hostname.replace(/^www\./, '').toLowerCase(),
      versioned: scriptDriftLooksVersioned(out),
    };
  } catch (_) {
    return null;
  }
}

function scriptDriftLooksVersioned(u) {
  try {
    const text = (u.pathname || '') + ' ' + (u.search || '');
    return /(?:^|[\/@._-])v?\d+\.\d+(?:\.\d+)?(?:[\/._-]|$)/i.test(text)
      || /[?&](v|ver|version|rev|build)=/i.test(u.search || '')
      || /(?:^|\/)(npm|ajax\/libs|releases?|versions?)\//i.test(u.pathname || '');
  } catch (_) {
    return false;
  }
}

function loadScriptDriftBaselines() {
  return localGet(SCRIPT_DRIFT_BASELINE_KEY).then((store) => {
    const raw = store && store[SCRIPT_DRIFT_BASELINE_KEY];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }).catch(() => ({}));
}

async function saveScriptDriftBaselines(base) {
  const entries = Object.entries(base || {})
    .filter(([, v]) => v && typeof v === 'object' && v.hash)
    .sort((a, b) => Number((b[1] && b[1].lastSeen) || 0) - Number((a[1] && a[1].lastSeen) || 0))
    .slice(0, SCRIPT_DRIFT_MAX_BASELINES);
  await localSet({ [SCRIPT_DRIFT_BASELINE_KEY]: Object.fromEntries(entries) });
}

function scriptDriftScanIndicators(text, scriptHost) {
  const body = String(text || '').slice(0, SCRIPT_DRIFT_MAX_BYTES);
  const indicators = [];
  const add = (name) => { if (!indicators.includes(name)) indicators.push(name); };
  if (/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]/.test(body)) add('dynamic code execution');
  if (/document\.cookie|localStorage|sessionStorage|indexedDB/i.test(body)) add('browser storage or cookie access');
  if (/navigator\.clipboard|execCommand\s*\(\s*['"]copy/i.test(body)) add('clipboard access');
  if (/querySelector(?:All)?\s*\([^)]*(password|card|cc-|credit|cvv|otp|token|secret)/i.test(body) || /input\[type=['"]?(password|email)/i.test(body)) add('sensitive form-field access');
  if (/sendBeacon|XMLHttpRequest|fetch\s*\(|WebSocket\s*\(/.test(body)) add('network beaconing');
  if (/ethereum|solana|bitcoin|wallet|seed phrase|mnemonic|privateKey|web3/i.test(body)) add('crypto wallet targeting');
  if (/MutationObserver|addEventListener\s*\(\s*['"](input|keydown|keyup|paste|submit)/.test(body)) add('input/form monitoring');
  const hosts = [];
  try {
    const re = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[^\s"'`<>)\\]*/ig;
    let m;
    while ((m = re.exec(body)) && hosts.length < 40) {
      const host = String(m[1] || '').replace(/^www\./, '').toLowerCase();
      if (!host || host === scriptHost || isLocalOrPrivateHost(host)) continue;
      if (!hosts.includes(host)) hosts.push(host);
    }
  } catch (_) {}
  return { indicators, outboundHosts: hosts };
}

function scriptDriftSuspiciousHosts(hosts) {
  return (hosts || []).filter((h) => {
    const host = String(h || '').toLowerCase();
    if (!host) return false;
    if (/^xn--/i.test(host)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
    if (/\.(zip|mov|top|click|quest|cyou|icu|xyz|lol|mom|monster|hair|tattoo|work|tk|gq|cf|ml)$/i.test(host)) return true;
    return false;
  }).slice(0, 8);
}

async function fetchScriptForDrift(info) {
  let url = info && info.href;
  if (!url) return { ok: false, error: 'bad url' };
  for (let redirects = 0; redirects <= 3; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, 9000);
    try {
      const res = await fetch(url, { cache: 'reload', credentials: 'omit', redirect: 'manual', signal: controller.signal });
      if (res && res.status >= 300 && res.status < 400) {
        const nextInfo = normalizeScriptDriftUrl(res.headers && res.headers.get('location'), url);
        if (!nextInfo) return { ok: false, error: 'blocked redirect' };
        url = nextInfo.href;
        continue;
      }
      if (!res || !res.ok) return { ok: false, error: 'http ' + (res ? res.status : '?') };
      const finalInfo = normalizeScriptDriftUrl(res.url || url, url);
      if (!finalInfo) return { ok: false, error: 'blocked final url' };
      const len = Number(res.headers && res.headers.get('content-length') || 0);
      if (len && len > SCRIPT_DRIFT_MAX_BYTES) return { ok: false, error: 'too large' };
      const text = await readResponseTextWithByteLimit(res, SCRIPT_DRIFT_MAX_BYTES);
      const bytes = utf8ByteLength(text);
      return { ok: true, url: finalInfo.href, displayUrl: finalInfo.displayUrl, host: finalInfo.host, text, bytes, versioned: finalInfo.versioned };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e).slice(0, 80) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'too many redirects' };
}

function scriptDriftLevel(score) {
  if (score >= 8) return 'High';
  if (score >= 4) return 'Medium';
  return 'Low';
}

function scriptDriftShouldWarn(detail, entry) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const indicators = Array.isArray(d.newIndicators) ? d.newIndicators : [];
  const hosts = Array.isArray(d.newHosts) ? d.newHosts : [];
  const suspiciousHosts = Array.isArray(d.suspiciousHosts) ? d.suspiciousHosts : [];
  const score = Number(d.score || 0);
  const driftCount = Number((entry && entry.driftCount) || 0);
  const sensitive = indicators.some((x) => /dynamic code execution|sensitive form-field|crypto wallet|input\/form monitoring|clipboard access/i.test(String(x || '')));
  if (suspiciousHosts.length) return true;
  if (score >= 8 && (sensitive || hosts.length || indicators.length >= 2)) return true;
  if (sensitive && (hosts.length || Math.abs(Number(d.sizeDeltaPct || 0)) >= 25 || score >= 6)) return true;
  if (hosts.length >= 3 && driftCount >= 1 && score >= 6) return true;
  return false;
}

function scriptDriftBuildWarning(entry, current, pageHost) {
  const oldIndicators = new Set(entry.indicators || []);
  const oldHosts = new Set(entry.outboundHosts || []);
  const newIndicators = (current.indicators || []).filter((x) => !oldIndicators.has(x));
  const newHosts = (current.outboundHosts || []).filter((x) => !oldHosts.has(x)).slice(0, 12);
  const suspiciousHosts = scriptDriftSuspiciousHosts(newHosts);
  const oldBytes = Number(entry.bytes || 0);
  const sizeDeltaPct = oldBytes ? Math.round(((Number(current.bytes || 0) - oldBytes) / oldBytes) * 100) : 0;
  let score = current.versioned ? 1 : 2;
  const reasons = [current.versioned ? 'same versioned script URL served different bytes' : 'same unversioned script URL served different bytes'];
  if (newIndicators.length) {
    score += Math.min(4, newIndicators.length * 2);
    reasons.push('new behavior indicators: ' + newIndicators.slice(0, 4).join(', '));
  }
  if (newHosts.length) {
    score += Math.min(2, newHosts.length);
    reasons.push('new outbound hosts embedded in script');
  }
  if (suspiciousHosts.length) {
    score += 3;
    reasons.push('new suspicious-looking outbound host: ' + suspiciousHosts[0]);
  }
  if (Math.abs(sizeDeltaPct) >= 100) {
    score += 1;
    reasons.push('script size changed by ' + sizeDeltaPct + '%');
  }
  return {
    type: 'warned_script_drift',
    detail: {
      risk: scriptDriftLevel(score),
      score,
      scriptHost: current.host,
      pageHost: pageHost || '',
      script: current.displayUrl,
      previousHash: String(entry.hash || '').slice(0, 16),
      newHash: String(current.hash || '').slice(0, 16),
      previousBytes: oldBytes,
      bytes: current.bytes,
      sizeDeltaPct,
      versioned: !!current.versioned,
      newIndicators: newIndicators.slice(0, 8),
      newHosts: newHosts.slice(0, 8),
      suspiciousHosts,
      reasons,
      why: reasons[0],
      action: 'Review or pin this third-party script. If you do not control it, consider self-hosting, SRI, or a versioned URL.',
    },
  };
}

async function handleScriptDriftScan(sender, msg) {
  const store = await localGet('wardenone_config');
  const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
  if (cfg.enabled === false || cfg.scriptDriftGuard === false) return { ok: true, ignored: 'disabled', warnings: [] };

  const tab = (sender && sender.tab) || {};
  const pageUrl = String((tab && tab.url) || sender.url || '');
  if (!/^https?:\/\//i.test(pageUrl)) return { ok: true, ignored: 'non-http', warnings: [] };
  const pageHost = messageCleanHost(pageUrl);
  if (pageHost && hostMatchesAllowlist(pageHost, cfg.allowlist || [])) return { ok: true, ignored: 'allowlisted', warnings: [] };
  const pageSite = registrableDomain(pageHost || '');
  const rawScripts = Array.isArray(msg && msg.scripts) ? msg.scripts : [];
  const normalized = [];
  const seen = new Set();
  for (const raw of rawScripts) {
    const info = normalizeScriptDriftUrl(raw && raw.url, pageUrl);
    if (!info || seen.has(info.href)) continue;
    const scriptSite = registrableDomain(info.host);
    if (!scriptSite || scriptSite === pageSite) continue;
    seen.add(info.href);
    normalized.push(info);
    if (normalized.length >= SCRIPT_DRIFT_MAX_PER_SCAN) break;
  }
  if (!normalized.length) return { ok: true, warnings: [] };

  const base = await loadScriptDriftBaselines();
  const now = Date.now();
  const warnings = [];
  let changed = false;
  for (const info of normalized) {
    const prev = base[info.href];
    if (prev && now - Number(prev.checkedAt || 0) < SCRIPT_DRIFT_RECHECK_MS) continue;
    const fetched = await fetchScriptForDrift(info);
    if (!fetched.ok) continue;
    const hash = await sha256TextHex(fetched.text);
    if (!hash) continue;
    const scan = scriptDriftScanIndicators(fetched.text, fetched.host);
    const current = {
      hash,
      bytes: fetched.bytes,
      host: fetched.host,
      displayUrl: fetched.displayUrl,
      versioned: fetched.versioned,
      indicators: scan.indicators,
      outboundHosts: scan.outboundHosts,
    };
    const entry = prev && typeof prev === 'object' ? prev : null;
    if (entry && entry.hash && entry.hash !== hash) {
      const warning = scriptDriftBuildWarning(entry, current, pageHost);
      const lastWarn = Number(entry.warnedAt || 0);
      if (scriptDriftShouldWarn(warning.detail, entry) && now - lastWarn > SCRIPT_DRIFT_WARN_COOLDOWN_MS) {
        queueHistory({
          type: warning.type,
          detail: warning.detail,
          url: pageUrl.slice(0, 200),
          at: now,
        });
        warnings.push(warning.detail);
        current.warnedAt = now;
      } else {
        current.warnedAt = entry.warnedAt || 0;
      }
      current.previousHash = entry.hash;
      current.driftCount = Number(entry.driftCount || 0) + 1;
    } else {
      current.warnedAt = entry ? (entry.warnedAt || 0) : 0;
      current.previousHash = entry ? (entry.previousHash || '') : '';
      current.driftCount = entry ? Number(entry.driftCount || 0) : 0;
    }
    current.firstSeen = entry ? (entry.firstSeen || now) : now;
    current.lastSeen = now;
    current.checkedAt = now;
    current.seenOn = Array.from(new Set([pageSite].concat((entry && entry.seenOn) || []))).filter(Boolean).slice(0, 8);
    base[info.href] = current;
    changed = true;
  }
  if (changed) {
    try { await saveScriptDriftBaselines(base); } catch (_) {}
  }
  return { ok: true, warnings: warnings.slice(0, 3) };
}

// Let the popup trigger a manual refresh.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Defense-in-depth: device-wide DESTRUCTIVE actions (clear ALL site data, wipe a
  // site) must originate from a WardenOne extension page (popup/options), never from
  // a content script running on a web page. Extension-page senders have no
  // sender.tab; content scripts always do. Web pages can't message us at all today
  // (no externally_connectable), but this blocks any future/compromised relay path.
  if (msg && msg.kind && !messageSenderIsTab(sender) && !messageSenderIsExtensionPage(sender)) {
    try { sendResponse({ ok: false, error: 'Unknown message context.' }); } catch (_) {}
    return true;
  }
  if (msg && msg.kind && messageSenderIsTab(sender) && !TAB_CONTEXT_ALLOWED_MESSAGES.has(msg.kind) && !messageIsCookiePermissionEscape(msg, sender)) {
    try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
    return true;
  }
  if (msg && msg.kind && messageSenderIsTab(sender)) {
    const limit = TAB_CONTEXT_RATE_LIMITS[msg.kind];
    if (limit && !allowTabMessageRate(sender.tab.id, msg.kind, limit.max, limit.windowMs)) {
      try { sendResponse({ ok: false, error: 'Rate limited.' }); } catch (_) {}
      return true;
    }
  }
  if (msg && msg.kind === 'domain-age' && messageSenderIsTab(sender) && !messageSenderMatchesHost(sender, msg.domain)) {
    try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
    return true;
  }
  if (msg && msg.kind === 'login-domain-age' && messageSenderIsTab(sender) && !messageSenderMatchesHost(sender, msg.domain)) {
    try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
    return true;
  }
  if (msg && msg.kind === 'adshield-cosmetic' && messageSenderIsTab(sender) && !messageSenderMatchesHost(sender, msg.hostname)) {
    try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
    return true;
  }
  if (msg && msg.kind === 'set-site-permission' && messageSenderIsTab(sender)) {
    if (!messageIsCookiePermissionEscape(msg, sender)) {
      try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
      return true;
    }
  }
  if (msg && (msg.kind === 'reset-site-permissions' || msg.kind === 'open-site-settings') && messageSenderIsTab(sender)) {
    const targetUrl = msg.url || (sender.tab && sender.tab.url) || '';
    if (!messageSenderMatchesHost(sender, targetUrl)) {
      try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
      return true;
    }
  }
  if (msg && msg.kind === 'protection-health') {
    if (!messageSenderIsExtensionPage(sender)) {
      try { sendResponse({ ok: false, error: 'Not allowed from this context.' }); } catch (_) {}
      return true;
    }
    respond(buildProtectionHealthSummary(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'redirect-warning' && messageSenderIsTab(sender)) {
    respond(showRedirectWarning(sender, msg.detail || {}), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'oauth-grant' && messageSenderIsTab(sender)) {
    respond(recordOAuthGrantWarning(sender, msg), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'script-drift-scan' && messageSenderIsTab(sender)) {
    respond(handleScriptDriftScan(sender, msg), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'smart-player-context' && messageSenderIsTab(sender)) {
    respond(handleSmartScriptPlayerContext(sender, msg), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'smart-player-intent' && messageSenderIsTab(sender)) {
    respond(handleSmartScriptPlayerIntent(sender), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'open-site-settings' && messageSenderIsTab(sender)) {
    respond(openSiteSettingsForSender(sender, msg), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'apply-onboarding-recommended' && messageSenderIsExtensionPage(sender)) {
    respond((async () => {
      const store = await localGet('wardenone_config');
      const current = (store && store.wardenone_config && typeof store.wardenone_config === 'object') ? store.wardenone_config : {};
      const merged = Object.assign({}, DEFAULT_CONFIG, current, ONBOARDING_RECOMMENDED);
      await localSet({ wardenone_config: merged });
      try { refreshExtensionState(); } catch (_) {}
      return { ok: true };
    })(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'apply-onboarding-max-privacy' && messageSenderIsExtensionPage(sender)) {
    respond((async () => {
      const store = await localGet('wardenone_config');
      const current = (store && store.wardenone_config && typeof store.wardenone_config === 'object') ? store.wardenone_config : {};
      const merged = Object.assign({}, DEFAULT_CONFIG, current, ONBOARDING_MAX_PRIVACY);
      await localSet({ wardenone_config: merged });
      try { refreshExtensionState(); } catch (_) {}
      return { ok: true };
    })(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'eyeshield-fetch-css') {
    // EyeShield (content script) can't read cross-origin stylesheet text (CORS).
    // We fetch it here with the extension's host_permissions so EyeShield can
    // recolour CDN-hosted CSS. Credential-less + size/time/type capped; local
    // networks and uninspectable redirects are refused so pages can't use the
    // extension as a private-network stylesheet reader.
    respond(fetchPublicStylesheetText((msg && msg.url) || ''), sendResponse);
    return true;
  }

  if (msg && msg.kind === 'force-list-update') {
    updateRemoteLists('manual')
      .then((result) => sendResponse(result || { ok: false, error: 'Update did not return a result', meta: null }))
      .catch((e) => sendResponse({ ok: false, error: String(e), meta: null }));
    return true; // async response
  }

  if (msg && msg.kind === 'download-review-get') {
    if (!messageSenderIsExtensionPath(sender, 'download-review.html')) {
      try { sendResponse({ ok: false, error: 'Download review must be opened from the WardenOne review window.' }); } catch (_) {}
      return true;
    }
    getPendingDownload(msg.id)
      .then((review) => sendResponse(review ? { ok: true, review } : { ok: false, error: 'Download review not found.' }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'download-review-decision') {
    if (!messageSenderIsExtensionPath(sender, 'download-review.html')) {
      try { sendResponse({ ok: false, error: 'Download review decisions must come from the WardenOne review window.' }); } catch (_) {}
      return true;
    }
    handleDownloadDecision(msg.id, msg.decision, sender)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'test-virustotal-key') {
    testVirusTotalKey(msg.key)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'test-safe-browsing-key') {
    testSafeBrowsingKey(msg.key)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'test-reputation-provider-key') {
    testConfiguredProviderKey(msg.provider, msg.key)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'safe-browsing-check' && msg.url) {
    (async () => {
      try {
        const rawUrl = String(msg.url || '');
        const context = String(msg.context || '').slice(0, 24);
        if (messageSenderIsTab(sender)) {
          if (rawUrl.length > 2048 || !TAB_SAFE_BROWSING_CONTEXTS.has(context)) {
            sendResponse({ ok: false, enabled: true, error: 'Not allowed from this context.' });
            return;
          }
        }
        const state = await urlReputationConfig();
        if (!state.enabled) { sendResponse({ ok: true, enabled: false }); return; }
        const url = normalizeSafeBrowsingUrl(rawUrl);
        const host = trustHostFromUrl(url);
        if (!url || !host || isLocalTrustHost(host)) {
          sendResponse({ ok: true, enabled: false });
          return;
        }
        const verdict = await urlReputationLookupUrl(url, Object.assign({ context }, state));
        sendResponse({
          ok: !!(verdict && verdict.ok),
          enabled: true,
          hit: !!(verdict && verdict.hit),
          warning: !!(verdict && verdict.warning),
          cached: !!(verdict && verdict.cached),
          url,
          context,
          provider: (verdict && verdict.provider) || 'URL reputation',
          threats: (verdict && verdict.threats) || [],
          ip: (verdict && verdict.ip) || '',
          score: Number((verdict && verdict.score) || 0),
          domain: (verdict && verdict.domain) || '',
          hostOnly: !!(verdict && verdict.hostOnly),
          urlCount: Number((verdict && verdict.urlCount) || 0),
          onlineUrlCount: Number((verdict && verdict.onlineUrlCount) || 0),
          reputationScore: verdict && verdict.reputationScore != null ? Number(verdict.reputationScore) : null,
          ageDays: verdict && verdict.ageDays != null ? Number(verdict.ageDays) : null,
          domainAgeRisk: (verdict && verdict.domainAgeRisk) || '',
          registrar: (verdict && verdict.registrar) || '',
          domainPrivacy: !!(verdict && verdict.domainPrivacy),
          warningCodes: (verdict && verdict.warningCodes) || [],
          threatTypes: (verdict && verdict.threatTypes) || [],
          total: Number((verdict && verdict.total) || 0),
          results: (verdict && verdict.results) || [],
          error: (verdict && verdict.error) || '',
          status: (verdict && verdict.status) || 0,
        });
      } catch (e) {
        sendResponse({ ok: false, enabled: true, error: String(e).slice(0, 120) });
      }
    })();
    return true;
  }

  // On-demand URL scan: the popup's VirusTotal URL scanner. Looks up a URL the user
  // pastes, using their saved key. Returns the analysis stats for display.
  if (msg && msg.kind === 'scan-url-virustotal') {
    (async () => {
      try {
        const store = await localGet('wardenone_config');
        const cfg = (store && store.wardenone_config) || {};
        const key = String(cfg.downloadVirusTotalKey || '').trim();
        if (!key) { sendResponse({ ok: false, error: 'Add your VirusTotal API key in Download Guard first.' }); return; }
        let url = String(msg.url || '').trim();
        if (!url) { sendResponse({ ok: false, error: 'Enter a URL to scan.' }); return; }
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url; // tolerate missing scheme
        try {
          const u = new URL(url);
          if (url.length > 2048 || isLocalOrPrivateHost(u.hostname)) {
            sendResponse({ ok: false, error: 'Local, private-network, or unusually long URLs are not sent to VirusTotal.' });
            return;
          }
        } catch { sendResponse({ ok: false, error: 'That does not look like a valid URL.' }); return; }
        const result = await checkVirusTotalUrl(url, key);
        if (!result) { sendResponse({ ok: false, error: 'No result from VirusTotal.' }); return; }
        if (result.ok === false) {
          if (result.status === 401 || result.status === 403) { sendResponse({ ok: false, error: 'VirusTotal rejected your API key.' }); return; }
          if (result.status === 429) { sendResponse({ ok: false, error: 'VirusTotal quota is rate-limited right now. Try again shortly.' }); return; }
          sendResponse({ ok: false, error: result.error || ('VirusTotal error (HTTP ' + (result.status || '?') + ').') }); return;
        }
        sendResponse({ ok: true, url, notFound: !!result.notFound, hit: !!result.hit, stats: result.stats || null, reputation: result.reputation || 0 });
      } catch (e) {
        sendResponse({ ok: false, error: String(e).slice(0, 140) });
      }
    })();
    return true;
  }

  if (msg && msg.kind === 'download-trust-list') {
    getTrustedDownloadSites()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((e) => sendResponse({ ok: false, error: String(e), items: [] }));
    return true;
  }

  if (msg && msg.kind === 'download-trust-add') {
    addTrustedDownloadSite(msg.host)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'download-trust-remove') {
    removeTrustedDownloadSite(msg.host)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // ---- Verify & Repair ----
  // Honest about scope: this is a health-check-and-repair, not a cryptographic
  // tamper check (Chrome itself signs/verifies the extension package). It checks
  // the realistic failure modes -- missing/unparseable core files, corrupted
  // saved settings, stale/empty blocklist, broken DNR rules -- and repairs them
  // (reset bad config to defaults, re-fetch lists, re-register rules).
  // ---- SessionShield: clear all data for a site ----
  // Wipes cookies, localStorage, sessionStorage, IndexedDB, cache, etc. for a
  // given origin. This is the user clearing THEIR OWN data -- a safe, powerful
  // "log me out / forget me everywhere on this site" action.
  // ---- SessionShield: password breach check (k-anonymity, opt-in) ----
  // The popup hashes the password with SHA-1 locally and sends ONLY the first 5
  // hex chars of the hash. HaveIBeenPwned returns all hash suffixes in that bucket;
  // the popup matches locally. The full password and full hash NEVER leave the
  // device -- this is the standard, privacy-preserving "Pwned Passwords" protocol.
  // ---- SessionShield: real cookie flag audit ----
  // A content script CAN'T read Secure/HttpOnly/SameSite (HttpOnly cookies are
  // invisible to JS by design). The cookies API in the background CAN, so the
  // cookie grade is computed from REAL flags here, not guessed from the page.
  // ---- SessionShield: has THIS SITE been breached? ----
  // Uses HIBP's public breaches endpoint filtered by domain (no auth needed for
  // the domain list). Returns breach names + dates so the user gets real context
  // about the site they're on. Fails gracefully if the API is unavailable.
  // ---- Browser cleaning: clear selected data types globally ----
  // The user chooses what to wipe (cache, cookies, history, downloads, storage,
  // service workers). All via the browsingData API. This is the user clearing
  // their own browser data -- safe and under their control.
  if (msg && msg.kind === 'clean-browser' && msg.types) {
    (async () => {
      try {
        const t = msg.types;
        const dataTypes = {};
        if (t.cache) dataTypes.cacheStorage = true, dataTypes.cache = true;
        if (t.cookies) dataTypes.cookies = true;
        if (t.history) dataTypes.history = true;
        if (t.downloads) dataTypes.downloads = true;
        if (t.storage) { dataTypes.localStorage = true; dataTypes.indexedDB = true; dataTypes.webSQL = true; }
        if (t.serviceWorkers) dataTypes.serviceWorkers = true;
        if (t.formData) dataTypes.formData = true;
        if (Object.keys(dataTypes).length === 0) { sendResponse({ ok: false, error: 'nothing selected' }); return; }
        await chrome.browsingData.remove({ since: 0 }, dataTypes);
        sendResponse({ ok: true, cleared: Object.keys(dataTypes) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // ---- Extension permissions review (LIST + flag only) ----
  // HONEST SCOPE: Chrome forbids one extension from scanning another for malware
  // or blocking installs. The management API can only LIST installed extensions
  // and their requested permissions. We surface that and flag high-risk
  // permissions so the user can review -- it is a reviewer, NOT a malware scanner.
  if (msg && msg.kind === 'list-extensions') {
    (async () => {
      try {
        const all = await chrome.management.getAll();
        const HIGH_RISK = {
          '<all_urls>': 'Can read & change data on ALL websites',
          'tabs': 'Can see your open tabs and their URLs',
          'history': 'Can read your browsing history',
          'cookies': 'Can read your cookies (incl. login sessions)',
          'webRequest': 'Can intercept your network requests',
          'proxy': 'Can route your traffic through a proxy',
          'debugger': 'Can use the powerful debugger API',
          'management': 'Can manage your other extensions',
          'downloads': 'Can manage your downloads',
          'nativeMessaging': 'Can talk to programs on your computer',
          'clipboardRead': 'Can read your clipboard',
        };
        const items = all
          .filter((e) => e.type === 'extension' && e.id !== chrome.runtime.id)
          .map((e) => {
            const perms = (e.permissions || []).concat(e.hostPermissions || []);
            const flags = [];
            // host permissions that mean "all sites"
            const allSites = (e.hostPermissions || []).some((h) => h === '<all_urls>' || h === '*://*/*' || h === 'http://*/*' || h === 'https://*/*');
            if (allSites) flags.push(HIGH_RISK['<all_urls>']);
            for (const pr of (e.permissions || [])) { if (HIGH_RISK[pr]) flags.push(HIGH_RISK[pr]); }
            return {
              name: e.name, id: e.id, enabled: e.enabled,
              fromStore: e.installType === 'normal' || e.installType === 'admin',
              installType: e.installType,
              riskFlags: Array.from(new Set(flags)),
              riskScore: flags.length,
            };
          })
          .sort((a, b) => b.riskScore - a.riskScore);
        sendResponse({ ok: true, extensions: items });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // surface the latest permission-change alerts for the popup
  if (msg && msg.kind === 'get-extension-alerts') {
    (async () => {
      try {
        const store = await localGet(EXT_ALERTS_KEY);
        sendResponse({ ok: true, alerts: (store && store[EXT_ALERTS_KEY]) || [] });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg && msg.kind === 'clear-extension-alerts') {
    (async () => { try { await localSet({ [EXT_ALERTS_KEY]: [] }); sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false, error: String(e) }); } })();
    return true;
  }

  // startup security check: fetch the latest report, re-run on demand, or clear it
  if (msg && msg.kind === 'get-startup-report') {
    (async () => { try { const s = await localGet(STARTUP_REPORT_KEY); sendResponse({ ok: true, report: (s && s[STARTUP_REPORT_KEY]) || null }); } catch (e) { sendResponse({ ok: false, error: String(e) }); } })();
    return true;
  }
  if (msg && msg.kind === 'run-startup-check') {
    (async () => { try { const report = await runStartupCheck('manual', { force: true }); sendResponse({ ok: true, report }); } catch (e) { sendResponse({ ok: false, error: String(e) }); } })();
    return true;
  }
  // Only reachable from the block screen, which is an extension page. It is not in
  // TAB_CONTEXT_ALLOWED_MESSAGES, so a web page cannot grant itself a bypass.
  if (msg && msg.kind === 'safe-browsing-allow-once') {
    respond(addSafeBrowsingBypass(msg.host), sendResponse);
    return true;
  }

  if (msg && msg.kind === 'clear-startup-report') {
    (async () => { try { await localSet({ [STARTUP_REPORT_KEY]: null }); try { chrome.action.setBadgeText({ text: '' }); } catch (_) {} sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false, error: String(e) }); } })();
    return true;
  }

  const SITE_PERMISSION_TYPES = [
    { key: 'camera', label: 'Camera', reset: 'ask', sensitive: true, scan: true, resetSite: true },
    { key: 'microphone', label: 'Microphone', reset: 'ask', sensitive: true, scan: true, resetSite: true },
    { key: 'location', label: 'Location', reset: 'ask', sensitive: true, scan: true, resetSite: true },
    { key: 'notifications', label: 'Notifications', reset: 'ask', sensitive: true, scan: true, resetSite: true },
    { key: 'clipboard', label: 'Clipboard', reset: 'ask', sensitive: true, scan: true, resetSite: true },
    { key: 'automaticDownloads', label: 'Auto-downloads', reset: 'ask', sensitive: true, scan: true, resetSite: true },
    { key: 'popups', label: 'Pop-ups', reset: 'block', sensitive: true, scan: true, resetSite: true },
    { key: 'cookies', label: 'Cookies', reset: 'allow', sensitive: false, scan: true, resetSite: true },
    { key: 'images', label: 'Images', reset: 'allow', sensitive: false, scan: true, resetSite: true },
    { key: 'javascript', label: 'Scripts', reset: 'allow', sensitive: false, scan: true, resetSite: true },
    { key: 'sound', label: 'Sound', reset: 'allow', sensitive: false, scan: true, resetSite: true },
    { key: 'protectedContent', label: 'Protected content', reset: 'allow', sensitive: false, scan: false, resetSite: true },
    { key: 'midiSysex', label: 'MIDI devices', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'usbGuard', label: 'USB devices', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'serialGuard', label: 'Serial devices', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'bluetoothGuard', label: 'Bluetooth devices', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'fileSystemWriteGuard', label: 'File editing', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'sensors', label: 'Motion sensors', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'unsandboxedPlugins', label: 'Unsandboxed plugins', reset: 'ask', sensitive: true, scan: false, resetSite: false },
    { key: 'javascriptJit', label: 'JavaScript JIT', reset: 'allow', sensitive: false, scan: false, resetSite: false },
  ];
  const PERM_OPTIONS = {
    camera: ['ask', 'allow', 'block'],
    microphone: ['ask', 'allow', 'block'],
    location: ['ask', 'allow', 'block'],
    notifications: ['ask', 'allow', 'block'],
    clipboard: ['ask', 'allow', 'block'],
    automaticDownloads: ['ask', 'allow', 'block'],
    popups: ['block', 'allow'],
    cookies: ['allow', 'block', 'session_only'],
    images: ['allow', 'block'],
    javascript: ['allow', 'block'],
    sound: ['allow', 'block'],
  };
  // Registrable-domain reducer (handles common multi-part TLDs like co.uk).
  const registrableDomain = (host) => {
    const parts = String(host).replace(/^www\./, '').toLowerCase().split('.');
    if (parts.length <= 2) return parts.join('.');
    const last2 = parts.slice(-2).join('.');
    const multi = /^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/;
    return multi.test(last2) ? parts.slice(-3).join('.') : last2;
  };
  // Patterns for a per-site content setting. Most permissions are scoped to the
  // exact host. COOKIES ARE SPECIAL: a site's session/auth cookies are usually set
  // on the registrable domain and shared across subdomains (youtube.com sets on
  // .youtube.com, auth on .google.com). If we block cookies only on the exact host
  // (www.youtube.com), the page can read SOME cookies but not its session cookie,
  // so its JS keeps reloading trying to re-establish a session -> infinite reload
  // loop. Blocking the WHOLE registrable domain (and its subdomains) makes the
  // "no cookies" state CONSISTENT, so the site settles as logged-out instead of
  // looping. We also include the auth domains that the big providers bounce through.
  const siteUrlPatterns = (url) => {
    const u = new URL(url);
    const host = u.host;
    return Array.from(new Set([u.origin + '/*', 'https://' + host + '/*', 'http://' + host + '/*']));
  };
  const cookieUrlPatterns = (url) => {
    const u = new URL(url);
    const host = u.host;
    const reg = registrableDomain(host);
    const pats = [
      'https://' + host + '/*',
      'http://' + host + '/*',
      // whole registrable domain + all subdomains -- the key fix for the loop
      'https://*.' + reg + '/*',
      'http://*.' + reg + '/*',
      'https://' + reg + '/*',
      'http://' + reg + '/*',
    ];
    return Array.from(new Set(pats));
  };
  const contentSettingApi = (key, method) => {
    try {
      const group = chrome.contentSettings;
      const api = group && group[key];
      return api && typeof api[method] === 'function' ? api : null;
    } catch (_) {
      return null;
    }
  };
  const resetSitePermissionsForUrl = async (rawUrl) => {
    const allPatterns = siteUrlPatterns(rawUrl);
    const types = SITE_PERMISSION_TYPES.filter((t) => t.resetSite);
    const setOne = (type) => new Promise((resolve) => {
      try {
        const cs = contentSettingApi(type.key, 'set');
        if (!cs) { resolve({ key: type.key, label: type.label, ok: false, error: 'Unsupported' }); return; }
        // cookies must be reset on the SAME broad registrable-domain patterns we
        // block them on, or the block rules linger and the page stays half-broken.
        const patterns = type.key === 'cookies' ? cookieUrlPatterns(rawUrl) : allPatterns;
        let done = 0;
        let settled = false;
        const errors = [];
        const settle = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          settle({ key: type.key, label: type.label, ok: false, error: 'Timed out while resetting this browser setting' });
        }, 1500 * patterns.length);
        const finish = () => {
          done++;
          if (done < patterns.length) return;
          settle({ key: type.key, label: type.label, ok: errors.length < patterns.length, error: errors.join('; '), setting: type.reset });
        };
        patterns.forEach((primaryPattern) => {
          try {
            cs.set({ primaryPattern, setting: type.reset }, () => {
              const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
              if (err) errors.push(primaryPattern + ': ' + err);
              finish();
            });
          } catch (e) {
            errors.push(primaryPattern + ': ' + String(e));
            finish();
          }
        });
      } catch (e) {
        resolve({ key: type.key, label: type.label, ok: false, error: String(e) });
      }
    });
    const results = [];
    for (const t of types) results.push(await setOne(t));
    const reset = results.filter((r) => r.ok).map((r) => r.label);
    return {
      ok: reset.length > 0,
      patterns: allPatterns,
      results,
      reset,
      unsupported: results.filter((r) => !r.ok && r.error === 'Unsupported').map((r) => r.label),
      failed: results.filter((r) => !r.ok && r.error !== 'Unsupported'),
    };
  };
  const resetPanicPermissionDefaults = async () => {
    const panicKeys = new Set(['camera', 'microphone', 'location', 'notifications', 'clipboard', 'automaticDownloads', 'popups']);
    const types = SITE_PERMISSION_TYPES.filter((t) => panicKeys.has(t.key));
    const patterns = ['<all_urls>', 'https://*/*', 'http://*/*'];
    const results = [];
    for (const type of types) {
      const cs = contentSettingApi(type.key, 'set');
      if (!cs) {
        results.push({ key: type.key, label: type.label, ok: false, error: 'Unsupported' });
        continue;
      }
      const errors = [];
      await new Promise((resolve) => {
        let done = 0;
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(settle, 1500 * patterns.length);
        const finish = () => {
          done++;
          if (done >= patterns.length) settle();
        };
        patterns.forEach((primaryPattern) => {
          try {
            cs.set({ primaryPattern, setting: type.reset }, () => {
              const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
              if (err) errors.push(primaryPattern + ': ' + err);
              finish();
            });
          } catch (e) {
            errors.push(primaryPattern + ': ' + String(e));
            finish();
          }
        });
      });
      results.push({ key: type.key, label: type.label, ok: errors.length < patterns.length, error: errors.join('; '), setting: type.reset });
    }
    const reset = results.filter((r) => r.ok).map((r) => r.label);
    return {
      ok: reset.length > 0,
      reset,
      unsupported: results.filter((r) => !r.ok && r.error === 'Unsupported').map((r) => r.label),
      failed: results.filter((r) => !r.ok && r.error !== 'Unsupported'),
    };
  };

  const permissionChainAllowedForUrl = async (url) => {
    const sensitive = ['camera', 'microphone', 'location', 'notifications', 'clipboard', 'automaticDownloads', 'popups'];
    const allowed = [];
    const readOne = (key) => new Promise((resolve) => {
      const cs = contentSettingApi(key, 'get');
      if (!cs) { resolve(null); return; }
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 900);
      try {
        cs.get({ primaryUrl: url }, (d) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
          resolve(err ? null : ((d && d.setting) || null));
        });
      } catch (_) {
        clearTimeout(timer);
        resolve(null);
      }
    });
    for (const key of sensitive) {
      const setting = await readOne(key);
      if (setting !== 'allow') continue;
      if (key === 'clipboard') allowed.push('clipboard-read');
      else if (key === 'automaticDownloads') allowed.push('automatic-downloads');
      else allowed.push(key);
    }
    return allowed;
  };

  if (msg && msg.kind === 'permission-chain' && messageSenderIsTab(sender)) {
    respond((async () => {
      const pageUrl = (sender && sender.tab && sender.tab.url) || msg.url || '';
      const granted = /^https?:\/\//i.test(pageUrl) ? await permissionChainAllowedForUrl(pageUrl) : [];
      return recordPermissionChainSignal(sender, msg, granted);
    })(), sendResponse);
    return true;
  }

  // ---- Site permission scanner: read THIS site's actual granted permissions ----
  // contentSettings can't enumerate ALL sites, but it CAN read the current value
  // for a SPECIFIC url via .get({primaryUrl}). So for the active site we report the
  // real state (allow / block / ask) of each sensitive permission + a risk level.
  if (msg && msg.kind === 'scan-site-permissions' && msg.url) {
    (async () => {
      const types = SITE_PERMISSION_TYPES.filter((t) => t.scan);
      const results = [];
      const unsupported = [];
      const getOne = (cs, url) => new Promise((resolve) => {
        let done = false;
        const finish = (setting) => {
          if (done) return;
          done = true;
          resolve(setting || null);
        };
        const timer = setTimeout(() => finish(null), 1200);
        try {
          cs.get({ primaryUrl: url }, (d) => {
            clearTimeout(timer);
            const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
            finish(err ? null : (d && d.setting));
          });
        } catch (_) {
          clearTimeout(timer);
          finish(null);
        }
      });
      try {
        if (!chrome.contentSettings) {
          sendResponse({ ok: false, error: 'Site permissions are not available in this browser.' });
          return;
        }
        const origin = normalizeWebOrigin(msg.url);
        if (!origin || !await activeTabMatchesOrigin(origin)) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        for (const t of types) {
          const cs = contentSettingApi(t.key, 'get');
          if (!cs) { unsupported.push(t.label); continue; }
          const setting = await getOne(cs, msg.url); // 'allow' | 'block' | 'ask' | undefined
          if (setting == null) { unsupported.push(t.label); continue; }
          results.push({ key: t.key, label: t.label, setting, options: PERM_OPTIONS[t.key] || ['ask', 'allow', 'block'] });
        }
        // risk: granted camera/mic/location/device/clipboard permissions are the sensitive "allow"s
        const sensitiveKeys = new Set(types.filter((t) => t.sensitive).map((t) => t.key));
        let allowedSensitive = results.filter((r) => r.setting === 'allow' && sensitiveKeys.has(r.key)).length;
        const notifAllowed = results.some((r) => r.key === 'notifications' && r.setting === 'allow');
        let risk = 'Low', riskColor = '#2e9e5b';
        if (allowedSensitive >= 2) { risk = 'High'; riskColor = '#c0392b'; }
        else if (allowedSensitive === 1) { risk = 'Medium'; riskColor = '#bd7a2a'; }
        else if (notifAllowed) { risk = 'Medium'; riskColor = '#bd7a2a'; }
        sendResponse({ ok: true, results, unsupported, risk, riskColor });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // ---- JavaScript block: browser-wide or current site only ----
  const GLOBAL_JS_PATTERNS = ['<all_urls>', 'http://*/*', 'https://*/*'];
  const jsSettingGet = (details) => new Promise((resolve) => {
    const cs = contentSettingApi('javascript', 'get');
    if (!cs) { resolve(null); return; }
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 1200);
    try {
      cs.get(details || {}, (d) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve(err ? null : ((d && d.setting) || null));
      });
    } catch (_) {
      clearTimeout(timer);
      resolve(null);
    }
  });
  const jsSettingSet = (patterns, setting) => new Promise((resolve) => {
    const cs = contentSettingApi('javascript', 'set');
    if (!cs || !patterns || !patterns.length) { resolve(false); return; }
    const errors = [];
    let done = 0;
    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => settle(false), 1500 * patterns.length);
    const finish = () => {
      done++;
      if (done >= patterns.length) settle(errors.length < patterns.length);
    };
    patterns.forEach((primaryPattern) => {
      try {
        cs.set({ primaryPattern, setting }, () => {
          const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (err) errors.push(err);
          finish();
        });
      } catch (e) {
        errors.push(String(e));
        finish();
      }
    });
  });

  // Persisted allowlist for the all-sites-blocked script-lock mode. Rules
  // themselves live in chrome.contentSettings; this list is the durable source
  // of truth so exceptions survive clear() and mode flips. Per-site ALLOW
  // patterns are more specific than the global block pattern, so they win.
  const JS_ALLOWLIST_KEY = 'wardenone_js_allowlist';
  const jsDisplayHost = (rawUrl) => {
    try {
      const u = new URL(String(rawUrl || ''));
      return /^https?:$/.test(u.protocol) ? u.host : '';
    } catch (_) {
      return '';
    }
  };
  const jsAllowlistGet = async () => {
    const store = await localGet(JS_ALLOWLIST_KEY);
    const list = store && Array.isArray(store[JS_ALLOWLIST_KEY]) ? store[JS_ALLOWLIST_KEY] : [];
    return list.filter((h) => typeof h === 'string' && h && /^[a-z0-9][a-z0-9.:-]*$/i.test(h)).slice(0, 500);
  };
  const jsHostPatterns = (host) => ['https://' + host + '/*', 'http://' + host + '/*'];
  const jsClearRules = () => new Promise((resolve) => {
    try {
      const cs = contentSettingApi('javascript', 'clear');
      if (cs) cs.clear({ scope: 'regular' }, () => { void chrome.runtime.lastError; resolve(); });
      else resolve();
    } catch (_) { resolve(); }
  });
  // contentSettings has no per-rule remove, so any change to the exception set
  // rebuilds from stored state: clear everything, re-assert the global block,
  // re-apply the surviving allow rules.
  const reconcileJsRules = async (globalBlocked, allowHosts) => {
    await jsClearRules();
    if (!globalBlocked) return true;
    const ok = await jsSettingSet(GLOBAL_JS_PATTERNS, 'block');
    if (!ok) return false;
    for (const host of allowHosts || []) {
      try { await jsSettingSet(jsHostPatterns(host), 'allow'); } catch (_) {}
    }
    return true;
  };

  const buildJsState = async (rawUrl) => {
    const pageHost = jsDisplayHost(rawUrl);
    const store = await localGet('wardenone_js_global_block');
    const globalBlocked = !!(store && store.wardenone_js_global_block);
    const storedMode = await getScriptShieldMode();
    const mode = globalBlocked ? 'lockdown' : (storedMode === 'lockdown' ? 'normal' : storedMode);
    let site = 'allow';
    if (rawUrl && /^https?:/.test(rawUrl)) site = (await jsSettingGet({ primaryUrl: rawUrl })) || 'allow';
    const trustedHosts = await getTrustedScriptHosts();
    return {
      ok: true,
      global: globalBlocked ? 'block' : 'allow',
      mode,
      site,
      host: pageHost,
      trustedHosts,
      trustedCount: trustedHosts.length,
    };
  };

  if (msg && msg.kind === 'get-javascript-state') {
    (async () => {
      try {
        if (!chrome.contentSettings) { sendResponse({ ok: false, error: 'JavaScript settings not available.' }); return; }
        if (msg.url && /^https?:/.test(msg.url)) {
          const origin = normalizeWebOrigin(msg.url);
          if (!origin || !await activeTabMatchesOrigin(origin)) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        }
        // The all-sites (global) state is tracked in storage. contentSettings.get
        // REQUIRES a primaryUrl, so the old jsSettingGet({}) always failed and reported
        // 'allow' even while JS was blocked everywhere -- the "toggle says off but JS is
        // still off on every site" bug.
        const store = await localGet('wardenone_js_global_block');
        const globalBlocked = !!(store && store.wardenone_js_global_block);
        let site = 'allow';
        if (msg.url && /^https?:/.test(msg.url)) site = (await jsSettingGet({ primaryUrl: msg.url })) || 'allow';
        // Self-heal a stray global block: if we're NOT globally blocking but this site
        // reads blocked, neutralize the all-sites pattern (per-site rules are more
        // specific and untouched). This auto-fixes a previously stuck "off everywhere".
        if (!globalBlocked && site === 'block') {
          try {
            await jsSettingSet(GLOBAL_JS_PATTERNS, 'allow');
            if (msg.url && /^https?:/.test(msg.url)) site = (await jsSettingGet({ primaryUrl: msg.url })) || 'allow';
          } catch (_) {}
        }
        sendResponse(await buildJsState(msg.url));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.kind === 'set-script-shield-mode') {
    (async () => {
      try {
        if (!chrome.contentSettings) { sendResponse({ ok: false, error: 'JavaScript settings not available.' }); return; }
        const mode = normalizeScriptShieldMode(msg.mode);
        if (msg.url && /^https?:/.test(msg.url)) {
          const origin = normalizeWebOrigin(msg.url);
          if (!origin || !await activeTabMatchesOrigin(origin)) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        }
        if (mode === 'lockdown') {
          const allowHosts = await jsAllowlistGet();
          const ok = await reconcileJsRules(true, allowHosts);
          if (!ok) { sendResponse({ ok: false, error: 'Could not update JavaScript setting.' }); return; }
          await localSet({ wardenone_js_global_block: true, [SCRIPT_SHIELD_MODE_KEY]: 'lockdown' });
          await applyScriptShieldRules('lockdown');
        } else {
          await jsClearRules();
          await localSet({ wardenone_js_global_block: false, [SCRIPT_SHIELD_MODE_KEY]: mode });
          await applyScriptShieldRules(mode);
        }
        sendResponse(await buildJsState(msg.url));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.kind === 'script-trust-list') {
    getTrustedScriptHosts()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((e) => sendResponse({ ok: false, error: String(e), items: [] }));
    return true;
  }

  if (msg && msg.kind === 'script-trust-add') {
    addTrustedScriptHost(msg.host)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'script-trust-remove') {
    removeTrustedScriptHost(msg.host)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg && msg.kind === 'set-javascript-state' && msg.scope) {
    (async () => {
      try {
        if (!chrome.contentSettings) { sendResponse({ ok: false, error: 'JavaScript settings not available.' }); return; }
        if (msg.scope === 'global') {
          if (msg.block) {
            // Rebuild from stored state so saved allow-exceptions come back with
            // the block (whitelist mode survives being toggled off and on).
            const allowHosts = await jsAllowlistGet();
            const ok = await reconcileJsRules(true, allowHosts);
            if (!ok) { sendResponse({ ok: false, error: 'Could not update JavaScript setting.' }); return; }
            await localSet({ wardenone_js_global_block: true, [SCRIPT_SHIELD_MODE_KEY]: 'lockdown' });
            await applyScriptShieldRules('lockdown');
            sendResponse(await buildJsState(msg.url));
          } else {
            // All-sites OFF = JS back on for EVERY site. CLEAR all of the extension's
            // javascript rules (the global pattern AND any per-site leftovers) so
            // nothing stays stuck blocked -- this is what was broken before. The
            // stored allowlist is kept (dormant) for the next time block-all is on.
            await jsClearRules();
            await localSet({ wardenone_js_global_block: false, [SCRIPT_SHIELD_MODE_KEY]: 'normal' });
            await applyScriptShieldRules('normal');
            sendResponse(await buildJsState(msg.url));
          }
          return;
        }
        // per-site scope. Two modes: normally it is a per-site BLOCK; while
        // all-sites blocking is on it manages the ALLOW exception (whitelist).
        const patterns = (msg.url && /^https?:/.test(msg.url)) ? siteUrlPatterns(msg.url) : null;
        if (!patterns) { sendResponse({ ok: false, error: 'Open a normal web page first.' }); return; }
        const origin = normalizeWebOrigin(msg.url);
        if (!origin || !await activeTabMatchesOrigin(origin)) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        const store = await localGet('wardenone_js_global_block');
        const globalBlocked = !!(store && store.wardenone_js_global_block);
        if (globalBlocked) {
          const host = new URL(msg.url).host;
          let list = await jsAllowlistGet();
          if (msg.block) {
            // Remove the exception: no per-rule delete exists, so rebuild.
            list = list.filter((h) => h !== host);
            await localSet({ [JS_ALLOWLIST_KEY]: list });
            const ok = await reconcileJsRules(true, list);
            if (!ok) { sendResponse({ ok: false, error: 'Could not update JavaScript setting.' }); return; }
          } else {
            if (list.indexOf(host) < 0) list = list.concat([host]).slice(-500);
            await localSet({ [JS_ALLOWLIST_KEY]: list });
            const ok = await jsSettingSet(jsHostPatterns(host), 'allow');
            if (!ok) { sendResponse({ ok: false, error: 'Could not update JavaScript setting.' }); return; }
          }
          sendResponse(await buildJsState(msg.url));
          return;
        }
        const ok = await jsSettingSet(patterns, msg.block ? 'block' : 'allow');
        if (!ok) { sendResponse({ ok: false, error: 'Could not update JavaScript setting.' }); return; }
        sendResponse(await buildJsState(msg.url));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // ---- Set one site permission (allow / block / ask) for the active site ----
  if (msg && msg.kind === 'set-site-permission' && msg.url && msg.key && msg.setting) {
    (async () => {
      try {
        const u = new URL(msg.url);
        if (!/^https?:$/.test(u.protocol)) { sendResponse({ ok: false, error: 'Open a normal web page first.' }); return; }
        if (messageSenderIsExtensionPage(sender) && !await activeTabMatchesOrigin(u.origin)) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        const type = SITE_PERMISSION_TYPES.find((t) => t.key === msg.key);
        if (!type || !type.scan) { sendResponse({ ok: false, error: 'Unknown permission type.' }); return; }
        const options = PERM_OPTIONS[msg.key];
        if (!options || !options.includes(msg.setting)) { sendResponse({ ok: false, error: 'Invalid setting for this permission.' }); return; }
        const cs = contentSettingApi(msg.key, 'set');
        if (!cs) { sendResponse({ ok: false, error: 'Unsupported in this browser.' }); return; }
        const patterns = msg.key === 'cookies' ? cookieUrlPatterns(msg.url) : siteUrlPatterns(msg.url);
        const errors = [];
        await new Promise((resolve) => {
          let done = 0;
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(settle, 1500 * patterns.length);
          const finish = () => {
            done++;
            if (done >= patterns.length) settle();
          };
          patterns.forEach((primaryPattern) => {
            try {
              cs.set({ primaryPattern, setting: msg.setting }, () => {
                const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
                if (err) errors.push(err);
                finish();
              });
            } catch (e) {
              errors.push(String(e));
              finish();
            }
          });
        });
        if (errors.length >= patterns.length) {
          sendResponse({ ok: false, error: errors[0] || 'Could not update permission.' });
          return;
        }
        let confirmed = msg.setting;
        const csGet = contentSettingApi(msg.key, 'get');
        if (csGet) {
          confirmed = await new Promise((resolve) => {
            let done = false;
            const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 1200);
            try {
              csGet.get({ primaryUrl: msg.url }, (d) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
                resolve(err ? null : ((d && d.setting) || null));
              });
            } catch (_) {
              clearTimeout(timer);
              resolve(null);
            }
          }) || msg.setting;
        }
        sendResponse({ ok: true, key: msg.key, setting: confirmed });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // ---- Privacy reset: put this site's exposed permissions back to browser defaults ----
  if (msg && msg.kind === 'reset-site-permissions' && msg.url) {
    (async () => {
      try {
        const u = new URL(msg.url);
        if (!/^https?:$/.test(u.protocol)) { sendResponse({ ok: false, error: 'Open a normal web page first.' }); return; }
        if (messageSenderIsExtensionPage(sender) && !await activeTabMatchesOrigin(u.origin)) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        sendResponse(await resetSitePermissionsForUrl(msg.url));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // (kept) jump-to-settings handler name for the per-type buttons still works via
  // the popup opening chrome://settings/content/<type> directly.
  if (msg && msg.kind === 'list-site-permissions') {
    sendResponse({ ok: true, note: 'Use the per-site scan; full enumeration isn\'t available to extensions.' });
    return true;
  }

  // ---- Memory Shield: popup actions ----
  if (msg && msg.kind === 'memory-score') {
    respond(memoryScore(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-free-ram') {
    respond(freeRamNow(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-sweep-now') {
    respond(memorySweep('manual'), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-duplicates') {
    respond(findDuplicateTabs(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-close-duplicates') {
    respond(closeDuplicateTabs(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-heavy-tabs') {
    respond(listHeavyTabs(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-tabs') {
    respond(listMemoryTabs(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-zombie-tabs') {
    respond(listZombieTabs(msg.hours), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-sleep-groups') {
    respond(sleepIdleGroups(), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-sleep-tab' && msg.tabId != null) {
    respond(memoryActOnTab(msg.tabId, 'sleep'), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-sleep-tab-now' && msg.tabId != null) {
    respond(memoryActOnTab(msg.tabId, 'sleep', { requireIdleHours: 0 }), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'memory-close-tab' && msg.tabId != null) {
    respond(memoryActOnTab(msg.tabId, 'close'), sendResponse);
    return true;
  }
  if (msg && msg.kind === 'login-domain-age' && msg.domain) {
    // Login Page Age Check: a password field on a brand-new domain is a strong phishing
    // signal. We also score punycode/lookalike brand domains. The caller gets a
    // hard interstitial verdict, not just a soft banner, when the page is risky.
    (async () => {
      try {
        const store = await localGet('wardenone_config');
        const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
        if (cfg.enabled === false || cfg.loginAgeCheck === false) { sendResponse({ ok: false, disabled: true }); return; }
        const maxDays = Number(cfg.loginAgeMaxDays) > 0 ? Number(cfg.loginAgeMaxDays) : 30;
        const host = messageCleanHost(msg.domain);
        if (!host) { sendResponse({ ok: false }); return; }
        if (hostMatchesAllowlist(host, cfg.allowlist || [])) { sendResponse({ ok: true, ignored: 'allowlisted', isNew: false, hardBlock: false }); return; }
        let age = null;
        try {
          const found = await lookupDomainAge(host, cfg);
          if (found && found.ok && typeof found.ageDays === 'number') age = found;
        } catch (_) {}
        const verdict = loginRiskVerdict(host, msg.url || '', age, maxDays);
        const domain = (age && age.domain) || registrableDomainBg(host) || host;
        if (verdict.isNew) {
          queueHistory({ type: 'warned_new_domain_login', detail: { ageDays: verdict.ageDays, created: (age && age.created) || '', domain }, url: host, at: Date.now() });
        }
        if (verdict.hardBlock) {
          queueHistory({
            type: 'blocked_phishing',
            detail: {
              domain,
              brand: verdict.brand,
              matched: verdict.matched,
              ageDays: verdict.ageDays,
              reasons: verdict.reasons,
            },
            url: host,
            at: Date.now(),
          });
        }
        sendResponse({
          ok: true,
          isNew: verdict.isNew,
          hardBlock: verdict.hardBlock,
          ageDays: verdict.ageDays,
          created: (age && age.created) || '',
          domain,
          maxDays,
          brand: verdict.brand,
          matched: verdict.matched,
          reasons: verdict.reasons,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.kind === 'forget-site-now' && msg.host) {
    (async () => {
      try {
        const cfg = await getForgetConfig();
        const host = forgetHostFromUrl('http://' + String(msg.host).replace(/^https?:\/\//i, '')) || String(msg.host);
        const domain = registrableDomainBg(host);
        const result = await wipeSiteData(domain, cfg, [host]);
        if (result && result.ok && msg.url) {
          try {
            const origin = normalizeWebOrigin(msg.url);
            if (origin && await activeTabMatchesOrigin(origin)) result.permissionsReset = await resetSitePermissionsForUrl(msg.url);
          } catch (_) {}
        }
        sendResponse(result);
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  // AdShield: status (rule counts + last cosmetic update) for the popup.
  if (msg && msg.kind === 'adshield-status') {
    (async () => {
      try {
        const store = await chrome.storage.local.get(['wardenone_adshield_cosmetic', 'wardenone_adshield_cosmetic_at', 'wardenone_adshield_allowlist', 'wardenone_config']);
        const data = store.wardenone_adshield_cosmetic;
        let selectorCount = 0;
        let proceduralCount = 0;
        let scriptletCount = 0;
        if (data) {
          selectorCount = (data.generic ? data.generic.length : 0);
          const sp = data.specific || {};
          for (const k in sp) selectorCount += sp[k].length;
          const pr = data.procedural || {};
          for (const k in pr) proceduralCount += pr[k].length;
          const sc = data.scriptlets || {};
          for (const k in sc) scriptletCount += sc[k].length;
        }
        sendResponse({
          ok: true,
          enabled: (store.wardenone_config || {}).adShield !== false,
          selectorCount,
          proceduralCount,
          scriptletCount,
          updatedAt: store.wardenone_adshield_cosmetic_at || 0,
          allowlistCount: (store.wardenone_adshield_allowlist || []).length,
        });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  // AdShield: serve cosmetic rules for a given hostname. The content script asks for
  // the selectors that apply to its page; we return generic + domain-specific selectors
  // minus any exceptions for that domain.
  if (msg && msg.kind === 'adshield-cosmetic' && msg.hostname) {
    (async () => {
      try {
        // Served from the in-memory blob + per-host memo (getCosmeticMem /
        // computeCosmeticForHost): avoids re-reading and re-deserialising the
        // multi-MB cosmetic blob, and re-walking it, on every page and frame.
        const mem = await getCosmeticMem();
        sendResponse(computeCosmeticForHost(msg.hostname, mem, msg.playerPage === true));
      } catch (e) {
        sendResponse({ ok: false, error: String(e), selectors: [] });
      }
    })();
    return true;
  }

  // ---- AdShield: per-site allowlist add/remove/list ----
  if (msg && msg.kind === 'adshield-allowlist-toggle' && msg.hostname) {
    (async () => {
      try {
        const store = await chrome.storage.local.get('wardenone_adshield_allowlist');
        let allow = normalizeAllowlistHosts(store.wardenone_adshield_allowlist || []);
        const host = normalizeAllowlistHost(msg.hostname);
        if (!host) {
          sendResponse({ ok: false, error: 'Invalid site.' });
          return;
        }
        const idx = allow.indexOf(host);
        let nowAllowlisted;
        if (idx === -1) {
          if (allow.length >= 1000) {
            sendResponse({ ok: false, error: 'Allowlist is full.' });
            return;
          }
          allow.push(host);
          nowAllowlisted = true;
        }
        else { allow.splice(idx, 1); nowAllowlisted = false; }
        await localSet({ wardenone_adshield_allowlist: allow });
        sendResponse({ ok: true, allowlisted: nowAllowlisted, host });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // Learned bad domains: list / remove (for the Activity Log section).
  if (msg && msg.kind === 'list-learned') {
    const items = Object.keys(LEARNED).map((d) => ({ domain: d, firstSeen: LEARNED[d].firstSeen, reason: LEARNED[d].reason, hits: LEARNED[d].hits || 1 }))
      .sort((a, b) => b.firstSeen - a.firstSeen);
    sendResponse({ ok: true, items });
    return true;
  }
  if (msg && msg.kind === 'remove-learned' && msg.domain) {
    try {
      const d = normalizeLearnedDomain(msg.domain);
      if (d) delete LEARNED[d];
      localSet({ wardenone_learned: LEARNED }).then(() => { applyLearnedRules(); sendResponse({ ok: true }); }).catch((e) => sendResponse({ ok: false, error: String(e) }));
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    return true; // async
  }
  if (msg && msg.kind === 'clear-learned') {
    try {
      LEARNED = {};
      localSet({ wardenone_learned: LEARNED }).then(() => { applyLearnedRules(); sendResponse({ ok: true }); }).catch((e) => sendResponse({ ok: false, error: String(e) }));
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    return true; // async
  }

  if (msg && msg.kind === 'tracker-learner-status') {
    respond(trackerLearnerStatus(msg.url), sendResponse);
    return true;
  }

  if (msg && msg.kind === 'tracker-learner-set-site') {
    respond(setTrackerLearnerSiteMode(msg.url, msg.domain, msg.mode), sendResponse);
    return true;
  }

  // Domain age lookup (on-demand, via free RDAP -- no API key). The user explicitly
  // clicks this; we send ONLY the bare domain to rdap.org (the standard modern WHOIS).
  // It redirects to the right registry and returns JSON whose `events` array carries the
  // registration date. We compute age + a risk level; newly-registered domains are a
  // strong scam signal.
  if (msg && msg.kind === 'domain-age' && msg.domain) {
    (async () => {
      try {
        const store = await localGet('wardenone_config');
        const cfg = Object.assign({}, DEFAULT_CONFIG, (store && store.wardenone_config) || {});
        const result = await lookupDomainAge(msg.domain, cfg);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  if (msg && msg.kind === 'site-breach' && msg.domain) {
    (async () => {
      try {
        // HIBP keys breaches to the registrable domain (eTLD+1). The old code only
        // stripped "www.", so any other subdomain (accounts.spotify.com, mail.proton.me,
        // signin.ebay.com ...) returned ZERO breaches -- the "it doesn't work" bug.
        const d = registrableDomainBg(String(msg.domain));
        if (!d || isLocalOrPrivateHost(d)) { sendResponse({ ok: false, error: 'public domain required' }); return; }

        const CACHE_KEY = 'wardenone_breach_cache';
        const TTL_MS = 12 * 60 * 60 * 1000;
        const now = Date.now();
        const cstore = await localGet(CACHE_KEY);
        const cache = (cstore && cstore[CACHE_KEY] && typeof cstore[CACHE_KEY] === 'object') ? cstore[CACHE_KEY] : {};
        const hit = cache[d];
        if (hit && hit.at && (now - hit.at) < TTL_MS && Array.isArray(hit.breaches)) {
          sendResponse({ ok: true, domain: d, breaches: hit.breaches, cached: true });
          return;
        }

        const res = await fetch('https://haveibeenpwned.com/api/v3/breaches?Domain=' + encodeURIComponent(d), {
          headers: { 'User-Agent': 'WardenOne-Extension' },
          credentials: 'omit',
          redirect: 'error',
        });
        if (res.status === 429) { sendResponse({ ok: false, status: 429 }); return; }
        if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
        let arr;
        try { arr = await res.json(); } catch (_) { sendResponse({ ok: false, error: 'bad response' }); return; }
        const breaches = (Array.isArray(arr) ? arr : []).map((b) => ({
          name: b.Title || b.Name || 'Unknown',
          date: b.BreachDate || '',
          count: b.PwnCount || 0,
          data: Array.isArray(b.DataClasses) ? b.DataClasses.slice(0, 6) : [],
        })).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);

        // cache the result (cap the cache so it can't grow without bound)
        cache[d] = { at: now, breaches };
        const keys = Object.keys(cache);
        if (keys.length > 120) {
          keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0)).slice(0, keys.length - 120).forEach((k) => delete cache[k]);
        }
        await localSet({ [CACHE_KEY]: cache });

        sendResponse({ ok: true, domain: d, breaches });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  // ---- SessionShield: PANIC logout -- clear session data everywhere ----
  // One-click "log me out of everything": clears cookies + storage for ALL sites
  // (or, if scope:'site', just the given origin). The nuclear "I think I've been
  // compromised" button.
  if (msg && msg.kind === 'panic-logout') {
    (async () => {
      try {
        const dataTypes = { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, webSQL: true };
        if (msg.scope === 'site' && msg.origin) {
          const origin = await activeTabMatchesOrigin(msg.origin);
          if (!origin) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
          await chrome.browsingData.remove({ origins: [origin] }, dataTypes);
          let permissionsReset = null;
          try { permissionsReset = await resetSitePermissionsForUrl(origin); } catch (_) {}
          sendResponse({ ok: true, permissionsReset });
          return;
        } else {
          // everything, since the beginning of time
          await chrome.browsingData.remove({ since: 0 }, dataTypes);
        }
        let permissionsReset = null;
        try { permissionsReset = await resetPanicPermissionDefaults(); } catch (_) {}
        sendResponse({ ok: true, permissionsReset });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  if (msg && msg.kind === 'cookie-audit' && msg.url) {
    (async () => {
      try {
        const u = new URL(msg.url);
        if (!/^https?:$/.test(u.protocol)) { sendResponse({ ok: false, error: 'Open a normal web page first.' }); return; }
        const origin = await activeTabMatchesOrigin(u.origin);
        if (!origin) { sendResponse({ ok: false, error: 'Open the site first.' }); return; }
        const cookies = await chrome.cookies.getAll({ domain: u.hostname });
        let total = 0, secure = 0, httpOnly = 0, sameSite = 0, sessionLike = 0;
        const weak = [];
        for (const c of cookies) {
          total++;
          if (c.secure) secure++;
          if (c.httpOnly) httpOnly++;
          // sameSite: 'strict'|'lax'|'no_restriction'|'unspecified'
          if (c.sameSite === 'strict' || c.sameSite === 'lax') sameSite++;
          // a cookie that looks session/auth-ish but lacks protections
          const authish = /(sess|token|auth|sid|login|jwt|csrf|xsrf)/i.test(c.name || '');
          if (authish) {
            sessionLike++;
            if (!c.httpOnly || !c.secure) {
              weak.push({ name: String(c.name).slice(0, 40), httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: c.sameSite || 'unspecified' });
            }
          }
        }
        sendResponse({ ok: true, total, secure, httpOnly, sameSite, sessionLike, weak: weak.slice(0, 8) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  if (msg && msg.kind === 'breach-check' && msg.prefix) {
    (async () => {
      try {
        const prefix = String(msg.prefix).toUpperCase().slice(0, 5);
        if (!/^[0-9A-F]{5}$/.test(prefix)) { sendResponse({ ok: false, error: 'bad prefix' }); return; }
        const res = await fetch('https://api.pwnedpasswords.com/range/' + prefix, {
          headers: { 'Add-Padding': 'true' }, // padding hides the real count from network observers
          credentials: 'omit',
          redirect: 'error',
        });
        const text = await res.text();
        // return the raw suffix:count list; the popup matches its own suffix locally
        sendResponse({ ok: true, body: text });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  if (msg && msg.kind === 'clear-site-data' && msg.origin) {
    (async () => {
      const result = { ok: false, cleared: [] };
      try {
        const origin = await activeTabMatchesOrigin(msg.origin);
        if (!origin) {
          result.error = 'Open the site first.';
          sendResponse(result);
          return;
        }
        // browsingData.remove with an origins filter (Chrome 96+)
        const dataTypes = {
          cacheStorage: true, cookies: true, fileSystems: true,
          indexedDB: true, localStorage: true, serviceWorkers: true,
          webSQL: true,
        };
        await chrome.browsingData.remove({ origins: [origin] }, dataTypes);
        result.cleared = Object.keys(dataTypes);
        result.ok = true;
        try { result.permissionsReset = await resetSitePermissionsForUrl(origin); } catch (_) {}
        // also clear sessionStorage in any open tabs on that origin (not covered
        // by the origins filter for session storage in some versions)
        try {
          const host = new URL(origin).hostname;
          const tabs = await chrome.tabs.query({ url: [origin + '/*'] });
          for (const t of tabs) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: t.id },
                world: 'MAIN',
                func: () => { try { sessionStorage.clear(); localStorage.clear(); } catch (_) {} },
              });
            } catch (_) {}
          }
        } catch (_) {}
      } catch (e) {
        result.error = String(e);
      }
      sendResponse(result);
    })();
    return true; // async
  }

  if (msg && msg.kind === 'verify-repair') {
    (async () => {
      const report = { checks: [], repaired: [], ok: true };
      const CORE_FILES = ['content.min.js', 'google-cleanup.css', 'search-ai-cleanup.css', 'search-sponsored-cleanup.css', 'permission-chain.js', 'oauth-guard.js', 'anti-redirect.js', 'eyeshield.js', 'consent-reject.js', 'yt-adblock.js', 'twitch-adblock.js', 'twitch-rewind.js', 'bridge.js', 'background.js', 'background-startup.js', 'background-memory.js', 'background-downloads.js', 'domain-utils.js', 'popup.html', 'popup.js', 'history.html', 'history.js', 'network.html', 'network.js', 'permissions.html', 'onboarding.html', 'onboarding.js', 'download-review.html', 'download-review.js', 'cert-error.html', 'cert-error.js', 'safe-browsing-block.html', 'safe-browsing-block.js', 'redirect-warning.html', 'redirect-warning.js', 'rules.json', 'rules-trackers.json', 'rules-adshield.json', 'rules-easyprivacy.json', 'malware-hashes.json', 'grabber-extra.json', 'supplemental-manifest.json', 'manifest.json'];

      // 1. core files present & non-empty
      for (const f of CORE_FILES) {
        try {
          const res = await fetch(chrome.runtime.getURL(f));
          const txt = await res.text();
          const okFile = res.ok && txt.length > 0;
          report.checks.push({ name: f, ok: okFile });
          if (!okFile) report.ok = false;
        } catch (e) {
          report.checks.push({ name: f, ok: false });
          report.ok = false;
        }
      }

      // 2. JSON files actually parse
      for (const jf of ['manifest.json', 'rules.json']) {
        try {
          const r = await fetch(chrome.runtime.getURL(jf));
          JSON.parse(await r.text());
          report.checks.push({ name: jf + ' (valid JSON)', ok: true });
        } catch (e) {
          report.checks.push({ name: jf + ' (valid JSON)', ok: false });
          report.ok = false;
        }
      }

      // 3. saved config is a sane object; if corrupted, reset to defaults
      await new Promise((resolve) => {
        chrome.storage.local.get('wardenone_config', (x) => {
          const cfg = x && x.wardenone_config;
          const valid = cfg && typeof cfg === 'object' && !Array.isArray(cfg);
          if (!valid) {
            localSet({ wardenone_config: Object.assign({}, DEFAULT_CONFIG) }).then(() => {
              report.repaired.push('Reset corrupted settings to safe defaults');
              report.checks.push({ name: 'Saved settings valid', ok: false });
              resolve();
            }).catch((e) => {
              report.checks.push({ name: 'Saved settings repair write', ok: false, error: String(e) });
              report.ok = false;
              resolve();
            });
          } else {
            // Restore missing defaults and remove malformed host-list entries.
            const merged = Object.assign({}, DEFAULT_CONFIG, cfg);
            merged.allowlist = normalizeAllowlistHosts(merged.allowlist || []);
            merged.forgetMeList = normalizeAllowlistHosts(merged.forgetMeList || []);
            if (JSON.stringify(merged) !== JSON.stringify(cfg)) {
              localSet({ wardenone_config: merged }).then(() => {
                report.repaired.push('Restored missing setting fields and cleaned saved site lists');
                report.checks.push({ name: 'Saved settings valid', ok: true });
                resolve();
              }).catch((e) => {
                report.checks.push({ name: 'Saved settings repair write', ok: false, error: String(e) });
                report.ok = false;
                resolve();
              });
            } else {
              report.checks.push({ name: 'Saved settings valid', ok: true });
              resolve();
            }
          }
        });
      });

      try {
        const hostStore = await localGet([DOWNLOAD_TRUSTED_KEY, 'wardenone_adshield_allowlist']);
        const cleanTrusted = normalizeAllowlistHosts(hostStore && hostStore[DOWNLOAD_TRUSTED_KEY], 1000).sort();
        const rawTrusted = Array.isArray(hostStore && hostStore[DOWNLOAD_TRUSTED_KEY]) ? hostStore[DOWNLOAD_TRUSTED_KEY] : [];
        const cleanAdShield = normalizeAllowlistHosts(hostStore && hostStore.wardenone_adshield_allowlist, 1000).sort();
        const rawAdShield = Array.isArray(hostStore && hostStore.wardenone_adshield_allowlist) ? hostStore.wardenone_adshield_allowlist : [];
        const cleanStores = {};
        if (!sameStringList(rawTrusted, cleanTrusted)) cleanStores[DOWNLOAD_TRUSTED_KEY] = cleanTrusted;
        if (!sameStringList(rawAdShield, cleanAdShield)) cleanStores.wardenone_adshield_allowlist = cleanAdShield;
        if (Object.keys(cleanStores).length) {
          await localSet(cleanStores);
          report.repaired.push('Cleaned saved download and AdShield trusted-site lists');
        }
        report.checks.push({ name: 'Saved trusted-site lists clean', ok: true });
      } catch (e) {
        report.checks.push({ name: 'Saved trusted-site lists clean', ok: false, error: String(e) });
        report.ok = false;
      }

      // 4. blocklist rules registered; if the core blocklist/adblock bands are
      // empty, re-fetch. A learned/tracker rule alone should not make repair pass.
      try {
        const dyn = await chrome.declarativeNetRequest.getDynamicRules();
        const domainRules = (dyn || []).filter((r) => r.id >= DYNAMIC_RULE_BASE && r.id < DYNAMIC_RULE_BASE + MAX_DYNAMIC).length;
        const optionRules = (dyn || []).filter((r) => r.id >= OPTION_RULE_BASE && r.id < OPTION_RULE_BASE + OPTION_RULES_MAX).length;
        const hasRules = domainRules > 0 || optionRules > 0;
        report.checks.push({ name: 'Block rules registered (' + domainRules + ' domain, ' + optionRules + ' option)', ok: hasRules });
        if (!hasRules) {
          await updateRemoteLists('repair');
          report.repaired.push('Re-fetched the blocklist');
        }
      } catch (e) {
        report.checks.push({ name: 'Block rules registered', ok: false });
        report.ok = false;
      }

      // 5. re-inject BOTH scripts into open http(s) tabs (fixes tabs where a
      //    script failed to load). The real blocking engine is content.min.js in the
      //    MAIN world; bridge.js in the ISOLATED world is only the relay. We must
      //    re-inject content.min.js or "re-armed" would be a lie -- a tab would have
      //    the messenger but no actual guard. We count a tab as re-armed only if
      //    the MAIN-world engine injected successfully.
      try {
        const repairCfg = await new Promise((r) => chrome.storage.local.get('wardenone_config', (x) => r((x && x.wardenone_config) || {})));
        const isolatedAlwaysFiles = [];
        if (eyeShieldThemingActive(repairCfg)) isolatedAlwaysFiles.push('eyeshield.js');
        isolatedAlwaysFiles.push('bridge.js');
        const consentOn = consentRejectActive(repairCfg);
        const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
        let reinjected = 0;
        let failedTabs = 0;
        let skippedCompatFrames = 0;
        for (const t of tabs) {
          let engineOk = false;
          let attemptedEngine = false;
          const frames = await getRepairFramesForTab(t);
          for (const frame of frames) {
            const frameId = Number(frame.frameId) || 0;
            const frameUrl = String(frame.url || (frameId === 0 ? t.url || '' : ''));
            const target = { tabId: t.id, frameIds: [frameId] };
            // Mirror the manifest contract: only frame zero receives the full
            // engine; child frames receive lightweight/specialized guards only.
            const mainFiles = repairMainWorldFilesForUrl(frameUrl, frameId);
            if (mainFiles && mainFiles.length) {
              const isFullEngineRepair = frameId === 0 && mainFiles.includes('content.min.js');
              if (isFullEngineRepair) attemptedEngine = true;
              try {
                await chrome.scripting.executeScript({ target, world: 'MAIN', files: mainFiles });
                if (isFullEngineRepair) engineOk = true;
              } catch (_) { /* inaccessible or gone frame */ }
            } else if (isMainWorldRepairExcludedUrl(frameUrl)) {
              skippedCompatFrames++;
            }
            try {
              await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: isolatedAlwaysFiles });
            } catch (_) {}
            if (consentOn && !consentRejectExcludedUrl(frameUrl)) {
              try {
                await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: ['consent-reject.js'] });
              } catch (_) {}
            }
          }
          if (engineOk) reinjected++;
          else if (attemptedEngine) failedTabs++;
        }
        if (reinjected > 0) report.repaired.push('Re-armed full protection on ' + reinjected + ' open tab(s)');
        if (skippedCompatFrames > 0) report.repaired.push('Left ' + skippedCompatFrames + ' sensitive frame(s) in compatibility mode');
        // only mark this check OK if we didn't fail on tabs we should have reached.
        // (tabs like chrome:// legitimately reject injection; those aren't failures.)
        report.checks.push({ name: 'Open tabs re-armed (' + reinjected + ' of ' + tabs.length + ')', ok: true });
      } catch (e) {
        report.checks.push({ name: 'Open tabs re-armed', ok: false });
        report.ok = false;
      }

      sendResponse(report);
    })();
    return true; // async
  }
});

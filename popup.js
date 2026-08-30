/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* WardenOne popup logic */

// Every toggle is an <input type="checkbox"> inside a <label class="tg"> holding only the
// track and knob spans -- no text. A label takes its accessible name from its own text
// content, so all 115 of them had none: a screen reader announced "checkbox, not checked"
// with nothing to say what it controlled, across the whole settings surface. The visible
// name sits in a sibling .name (or .lbl for the master switch) which is never inside the
// label, so there is nothing for the label to pick up.
//
// Done structurally rather than as 115 hand edits. The rows are regular but not
// identical -- some nest the name two levels up, the master switch uses .lbl, and two
// toggles carry a description long enough that the name sits far from the input -- so
// walking the real DOM covers every variant, cannot introduce a duplicate id, and labels
// any toggle added later automatically instead of silently missing it.
//
// It runs FIRST, before anything else in this file. The script tag sits at the end of
// <body> so the DOM is already parsed, and putting the call here means a throw anywhere
// later in start-up cannot cost the whole settings surface its labels.
try { labelToggleControls(); } catch (_) {}

// Cached element lookup. Replaces ~135 raw getElementById calls: shorter,
// one obvious place to typo-check an id, and it caches the node so repeated lookups of
// the same id don't re-walk the DOM. The isConnected guard re-queries if a cached node
// was detached (e.g. a list section was rebuilt), so it stays correct for dynamic UI.
const __getById = document.getElementById.bind(document);
const __elCache = new Map();
function $(id) {
  const hit = __elCache.get(id);
  if (hit && hit.isConnected) return hit;
  const el = __getById(id);
  if (el) __elCache.set(id, el); else __elCache.delete(id);
  return el;
}

function syncConfigCheckboxes(key, checked) {
  document.querySelectorAll(`input[data-key="${key}"]`).forEach((el) => {
    el.checked = checked;
  });
}

const KEYS = [
  'blockForcedPopups', 'strictPopupShield', 'blockGesturelessNav', 'blockPopupTricks', 'backTrapGuard', 'clearCookiesOnLeave', 'clearServiceWorkersOnLeave', 'detectRedirectChains', 'blockMetaRefresh',
  'blockGrabberResources', 'warnGrabberDomains', 'blockWebRTCLeak', 'certificateGuard', 'blockTrackers', 'adShield', 'googleSearchResultCleanup', 'blockSearchAiAnswers', 'blockSponsoredSearchResults', 'googleWebResultsOnly', 'flagSearchJunk', 'scriptletEngine', 'twitchAdBlock', 'twitchRewind', 'twitchVodRewind', 'sendPrivacySignals', 'antiFingerprintNoise', 'fingerprintProbeDetection', 'blockFingerprintScripts', 'blockThirdPartyCookies', 'blockAllCookies', 'blockFirstPartyTrackers', 'sessionShield', 'blockTokenExfil', 'continuousTokenScan', 'detectSkimmers', 'paymentCardGuard', 'breachCheck', 'forceHttps', 'insecureLoginGuard', 'loginAgeCheck', 'downloadReputation', 'downloadDomainAge', 'downloadSafeBrowsing', 'downloadVirusTotal', 'downloadVirusTotalHash', 'urlHaus', 'abuseIpDb', 'openPhish', 'phishTank', 'whoisXml', 'whoisXmlReputation', 'whoisXmlThreatIntel', 'clipboardGuard', 'clipboardSwapDetect', 'keystrokePressure', 'honeytokenMode', 'scamLockGuard', 'commandPasteGuard', 'pasteProtection', 'formTrapDetector', 'fakeUpdateDetector', 'permissionChainGuard', 'oauthGuard', 'scriptDriftGuard', 'riskySiteMode', 'antiClickjacking', 'intranetProtection', 'intranetNetworkRules', 'dnsRebindGuard', 'storageAccessGuard', 'blockAllStorageAccess', 'loginCompatibility', 'watchExtensionPermissions', 'startupCheck',
  'mediaShield', 'fullscreenGuard', 'fakeWindowGuard', 'notificationAbuseGuard', 'blockCameraMic', 'blockScreenCapture', 'blockGeolocation', 'blockAutoplayMedia',
  'gateAdultSites', 'adultHeuristics', 'safeSearch',
  'warnRedirectParams', 'warnShorteners', 'monitorLoggerApi', 'detectPhishing', 'blockHighConfidencePhishing', 'behavioralScan', 'xssBehaviorGuard', 'removeOverlays', 'autoSkipDownloadAds', 'blockMalwareSites', 'blockCryptominers', 'cryptominerCpuWatch', 'autoUpdateLists',
  'showToasts', 'showBadge', 'silentMode',
  'memoryShield', 'memoryNeverPinned', 'memoryNeverAudio', 'memoryNeverForms', 'memoryNeverPayment',
  'blockAutoplay', 'throttleBackgroundTabs', 'killPrefetch', 'lazyLoadMedia',
  'deAmp', 'clientHintProtection', 'capReferrer', 'trackerCacheProtection', 'autoRejectConsent', 'removeConsentWalls',
  'trackerLearner', 'unshimLinks', 'cleanCopyLinks', 'socialWidgetGuard', 'blockSupercookies'
];

const DEFAULTS = {
  enabled: true,
  blockGesturelessNav: true, blockForcedPopups: true, strictPopupShield: true, blockPopupTricks: true, backTrapGuard: true, clearCookiesOnLeave: false, clearServiceWorkersOnLeave: false, blockMetaRefresh: true,
  detectRedirectChains: true, warnGrabberDomains: true, blockGrabberResources: true,
  blockWebRTCLeak: true, certificateGuard: true, blockTrackers: true, adShield: true, googleSearchResultCleanup: false, blockSearchAiAnswers: false, blockSponsoredSearchResults: false, googleWebResultsOnly: false, flagSearchJunk: false, scriptletEngine: true, twitchAdBlock: true, twitchRewind: false, twitchRewindMinutes: 5, twitchVodRewind: true, sendPrivacySignals: true, antiFingerprintNoise: false, fingerprintProbeDetection: true, blockFingerprintScripts: true, antiFingerprint: false, blockThirdPartyCookies: true, blockAllCookies: false, blockFirstPartyTrackers: false, sessionShield: true, blockTokenExfil: true, continuousTokenScan: true, detectSkimmers: true, paymentCardGuard: true, breachCheck: false, forceHttps: true, insecureLoginGuard: true, loginAgeCheck: false, loginAgeMaxDays: 14, downloadReputation: true, downloadDomainAge: false, downloadSafeBrowsing: false, downloadSafeBrowsingKey: '', downloadVirusTotal: false, downloadVirusTotalHash: false, downloadVirusTotalKey: '', urlHaus: false, urlHausKey: '', abuseIpDb: false, abuseIpDbKey: '', openPhish: false, openPhishKey: '', phishTank: false, phishTankKey: '', whoisXml: false, whoisXmlKey: '', whoisXmlReputation: false, whoisXmlThreatIntel: false, clipboardGuard: false, clipboardSwapDetect: true, keystrokePressure: false, honeytokenMode: false, scamLockGuard: true, commandPasteGuard: true, pasteProtection: true, formTrapDetector: true, fakeUpdateDetector: true, permissionChainGuard: true, oauthGuard: true, scriptDriftGuard: true, riskySiteMode: true, antiClickjacking: true, intranetProtection: true, intranetNetworkRules: true, dnsRebindGuard: true, storageAccessGuard: true, blockAllStorageAccess: false, loginCompatibility: true, watchExtensionPermissions: true, startupCheck: true, gateAdultSites: true, adultHeuristics: true, safeSearch: false,
  mediaShield: true, fullscreenGuard: true, fakeWindowGuard: true, notificationAbuseGuard: true, blockCameraMic: true, blockScreenCapture: true, blockGeolocation: true, blockAutoplayMedia: true, blockSuspiciousWebRTC: false,
  eyeShield: false, eyeShieldMode: 'off', eyeShieldBrightness: 100, eyeShieldBrightnessByHost: {},
  eyeShieldContrast: 100, eyeShieldContrastByHost: {}, eyeShieldSaturation: 100, eyeShieldSaturationByHost: {},
  eyeShieldWarmth: 0, eyeShieldWarmthByHost: {}, eyeShieldGrayscale: 0, eyeShieldGrayscaleByHost: {},
  warnRedirectParams: true, warnShorteners: true, monitorLoggerApi: true,
  detectPhishing: true, blockHighConfidencePhishing: false, behavioralScan: true, xssBehaviorGuard: true, removeOverlays: true, autoSkipDownloadAds: true, blockMalwareSites: true, blockCryptominers: true, cryptominerCpuWatch: false, autoUpdateLists: true,
  showToasts: true, showBadge: true, showDownloadBar: true, silentMode: false,
  memoryShield: true, memoryMode: 'balanced', memoryMinutesOverride: 0,
  memoryNeverPinned: true, memoryNeverAudio: true, memoryNeverForms: true, memoryNeverPayment: true,
  tabLimitGuard: false, tabLimitMax: 20, tabLimitClose: false, tabLimitMinIdleMinutes: 30, tabLimitWarn: true,
  blockAutoplay: false, throttleBackgroundTabs: false, killPrefetch: false, lazyLoadMedia: false, deAmp: false, clientHintProtection: true, capReferrer: false, trackerCacheProtection: false, autoRejectConsent: true, removeConsentWalls: false,
  trackerLearner: true, unshimLinks: true, cleanCopyLinks: true, socialWidgetGuard: true, blockSupercookies: true,
  forgetMeMode: 'off', forgetMeList: [], forgetMeHistory: false, forgetMeAllConfirmedAt: 0,
  oneOpenPerGesture: true, stripTrackingParams: true, gestureWindowMs: 2400, allowlist: [],
  // host -> epoch ms at which its allowlisting lapses. Lets "allow this site" be
  // temporary without becoming a permanent hole someone forgets about.
  allowlistUntil: {},
  // host -> { featureKey: false }. Turns one protection off on one site instead of
  // everywhere, or the whole engine off there.
  siteOverrides: {},
};

// cryptominerCpuWatch is here because "Turn everything on" should not quietly
// start benchmarking the CPU on every page you visit. It is opt-in on purpose.
const MANUAL_ONLY_TOGGLES = new Set(['blockAllCookies', 'silentMode', 'cryptominerCpuWatch', 'trackerCacheProtection', 'blockAllStorageAccess']);
const ACTIVE_TAB_RELOAD_TOGGLES = new Set(['adShield', 'scriptletEngine', 'antiFingerprintNoise', 'fingerprintProbeDetection', 'blockFingerprintScripts', 'xssBehaviorGuard', 'commandPasteGuard', 'riskySiteMode', 'antiClickjacking', 'intranetProtection', 'googleSearchResultCleanup', 'blockSearchAiAnswers', 'blockSponsoredSearchResults', 'googleWebResultsOnly', 'flagSearchJunk', 'paymentCardGuard', 'blockGeolocation']);

const REPUTATION_PROVIDERS = [
  { key: 'urlHaus', keyField: 'urlHausKey', statusId: 'urlhaus-key-status', label: 'URLhaus', use: 'malware URL and download intelligence', emptyText: 'Paste a URLhaus Auth-Key to enable malware URL/download checks.', activeText: 'URLhaus malware URL checks are on. Known malware delivery URLs will be blocked.' },
  { key: 'abuseIpDb', keyField: 'abuseIpDbKey', statusId: 'abuseipdb-key-status', label: 'AbuseIPDB', use: 'malicious IP reports and suspicious server warnings', emptyText: 'Paste an AbuseIPDB API key to enable raw-IP server reputation.', activeText: 'AbuseIPDB raw-IP reputation is on. 75%+ abuse confidence blocks; 25-74 warns.' },
  { key: 'openPhish', keyField: 'openPhishKey', statusId: 'openphish-key-status', label: 'OpenPhish', use: 'phishing intelligence feed and fake login detection', optionalKey: true, emptyText: 'No key required for the OpenPhish Community feed. Test the feed to enable it.', activeText: 'OpenPhish Community feed is on. Known phishing URLs will be blocked from the cached feed.' },
  { key: 'phishTank', keyField: 'phishTankKey', statusId: 'phishtank-key-status', label: 'PhishTank', use: 'community phishing database checks', emptyText: 'Paste a PhishTank API key to enable phishing URL reputation.', activeText: 'PhishTank URL reputation is on. Verified current phishing URLs will be blocked.' },
  { key: 'whoisXml', keyField: 'whoisXmlKey', statusId: 'whoisxml-key-status', label: 'WhoisXML API', use: 'domain registration age and ownership clues', emptyText: 'Paste a WhoisXML API key to enable domain age and ownership clues.', activeText: 'WhoisXML API is on. Download Guard will use richer domain age, registrar, and ownership clues.' },
  { key: 'whoisXmlReputation', keyField: 'whoisXmlKey', statusId: 'whoisxml-reputation-status', label: 'WhoisXML Domain Reputation', use: 'domain reputation scoring and blocklist warnings', autoEnableOnKeyChange: false, emptyText: 'Uses the WhoisXML API key above. Test it to enable domain reputation scoring.', activeText: 'WhoisXML Domain Reputation is on. Low reputation and malware/phishing warnings raise risk.' },
  { key: 'whoisXmlThreatIntel', keyField: 'whoisXmlKey', statusId: 'whoisxml-threat-status', label: 'WhoisXML Threat Intelligence', use: 'IoC matches for malicious domains, URLs, and IPs', autoEnableOnKeyChange: false, emptyText: 'Uses the WhoisXML API key above. Test it to enable IoC threat intelligence.', activeText: 'WhoisXML Threat Intelligence is on. Malware/phishing IoC matches will be blocked.' },
];

let config = Object.assign({}, DEFAULTS);
// What storage held the last time this popup and storage agreed. The popup keeps
// `config` for as long as it is open, so writing it back wholesale reverts anything
// another surface changed meanwhile -- the onboarding page applying a bundle, the
// options page toggling a setting, or Repair writing a cleaned config back. Diffing
// against this snapshot says which keys the popup actually means to change; every
// other key is taken from the freshest stored value at write time.
let savedConfigSnapshot = configClone(DEFAULTS);
let eyeShieldHost = '';
let eyeShieldSaveTimer = 0;

function configClone(value) {
  try {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  } catch (_) {
    return (value && typeof value === 'object' && !Array.isArray(value)) ? Object.assign({}, value) : value;
  }
}

function configValuesDiffer(a, b) {
  if (a === b) return false;
  try { return JSON.stringify(a) !== JSON.stringify(b); } catch (_) { return true; }
}

// Keys this popup has changed since it last agreed with storage. Deliberately biased
// toward reporting a key as changed: writing our own value back for a key we own is
// harmless, while missing one loses the user's edit.
function popupChangedKeys() {
  const keys = new Set(Object.keys(config));
  Object.keys(savedConfigSnapshot).forEach((k) => keys.add(k));
  const changed = [];
  keys.forEach((k) => { if (configValuesDiffer(config[k], savedConfigSnapshot[k])) changed.push(k); });
  return changed;
}

const POPUP_SCROLL_KEY = 'wardenone_popup_scroll_memory';
const ADVANCED_PROVIDERS_OPEN_KEY = 'wardenone_advanced_providers_open';
const POPUP_SEARCH_KEY = 'wardenone_popup_search_memory';
// Reassigned by the settings-search block once it's wired; restores the last query
// on popup open so reopening jumps straight back to what you were looking at.
let restorePopupSearch = (done) => { if (typeof done === 'function') done(); };
let popupScrollSaveTimer = 0;
let popupScrollRestoring = false;
let advancedProvidersRestoring = false;

function popupScrollStore() {
  return (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
}

function popupScrollElement() {
  return document.scrollingElement || document.documentElement || document.body;
}

function getPopupScrollY() {
  const el = popupScrollElement();
  return Math.max(0, Math.round(el.scrollTop || window.scrollY || 0));
}

function setPopupScrollY(y) {
  const el = popupScrollElement();
  const maxY = Math.max(0, el.scrollHeight - (window.innerHeight || document.documentElement.clientHeight || 0));
  const top = Math.min(Math.max(0, Number(y) || 0), maxY);
  window.scrollTo(0, top);
  el.scrollTop = top;
}

function savePopupScrollPosition() {
  if (popupScrollRestoring) return;
  const store = popupScrollStore();
  const y = getPopupScrollY();
  store.set({ [POPUP_SCROLL_KEY]: { y, at: Date.now() } });
}

function schedulePopupScrollSave() {
  if (popupScrollRestoring) return;
  clearTimeout(popupScrollSaveTimer);
  popupScrollSaveTimer = setTimeout(savePopupScrollPosition, 120);
}

function restorePopupScrollPosition() {
  const store = popupScrollStore();
  store.get(POPUP_SCROLL_KEY, (res) => {
    const entry = res && res[POPUP_SCROLL_KEY];
    const y = Number(entry && typeof entry === 'object' ? entry.y : entry);
    if (!Number.isFinite(y) || y <= 0) return;
    popupScrollRestoring = true;
    let tries = 0;
    const apply = () => {
      setPopupScrollY(y);
      tries += 1;
      if (tries < 6) {
        setTimeout(apply, tries < 2 ? 0 : 80);
        return;
      }
      setTimeout(() => { popupScrollRestoring = false; }, 80);
    };
    requestAnimationFrame(apply);
  });
}

function initPopupScrollMemory() {
  window.addEventListener('scroll', schedulePopupScrollSave, { passive: true });
  window.addEventListener('pagehide', savePopupScrollPosition);
  window.addEventListener('beforeunload', savePopupScrollPosition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePopupScrollPosition();
  });
}

function advancedProvidersPanel() {
  return document.querySelector('.advanced-providers');
}

function saveAdvancedProvidersState() {
  if (advancedProvidersRestoring) return;
  const panel = advancedProvidersPanel();
  if (!panel) return;
  popupScrollStore().set({ [ADVANCED_PROVIDERS_OPEN_KEY]: { open: !!panel.open, at: Date.now() } });
}

function restoreAdvancedProvidersState(done) {
  const panel = advancedProvidersPanel();
  if (!panel) {
    if (typeof done === 'function') done();
    return;
  }
  popupScrollStore().get(ADVANCED_PROVIDERS_OPEN_KEY, (res) => {
    const entry = res && res[ADVANCED_PROVIDERS_OPEN_KEY];
    if (entry === undefined || entry === null) {
      if (typeof done === 'function') done();
      return;
    }
    const open = typeof entry === 'object' ? entry.open === true : entry === true;
    advancedProvidersRestoring = true;
    panel.open = open;
    setTimeout(() => {
      advancedProvidersRestoring = false;
      if (typeof done === 'function') done();
    }, 0);
  });
}

function initAdvancedProvidersMemory() {
  const panel = advancedProvidersPanel();
  if (!panel) return;
  panel.addEventListener('toggle', () => {
    saveAdvancedProvidersState();
    schedulePopupScrollSave();
  });
}

function applyToUI() {
  const enabledEl = $('enabled');
  enabledEl.checked = config.enabled !== false;
  updateMasterState();

  KEYS.forEach((k) => {
    document.querySelectorAll(`input[data-key="${k}"]`).forEach((el) => {
      el.checked = config[k] !== false;
    });
  });
  document.querySelectorAll('[data-config-text]').forEach((el) => {
    const key = el.getAttribute('data-config-text');
    el.value = config[key] || '';
  });
  renderMutedToasts(config);
  syncBreachVisibility();
  syncProviderStatus();
  reflectMasterDisable();
  reflectSilentMode();
  paintEyeShield();
  loadJsShieldState();
  paintTabLimitUI();
  paintForgetMe();
  paintMemoryModes();
  paintTwitchRewindUI();
}

// Reflect the Twitch rewind buffer length into its number input. Not a data-key
// control, so "Turn everything on" never changes the buffer size.
function paintTwitchRewindUI() {
  const mins = $('tr-minutes');
  if (mins) mins.value = Number(config.twitchRewindMinutes) > 0 ? Number(config.twitchRewindMinutes) : 5;
}

// Reflect the saved Memory Shield mode (gentle/balanced/aggressive/emergency) into the
// mode buttons. Hoisted so applyToUI() can repaint it after the config loads -- the
// painter used to be local to initMemoryShield, so on reopen the highlight reverted to
// the default and the picked mode looked like it hadn't saved (it had).
function paintMemoryModes() {
  const wrap = $('mem-modes');
  if (!wrap) return;
  const cur = config.memoryMode || 'balanced';
  document.querySelectorAll('.mem-mode').forEach((b) => {
    const on = b.getAttribute('data-mode') === cur;
    b.style.background = on ? 'var(--wo-popup-mode-gradient)' : '';
    b.style.color = on ? 'var(--wo-on-brand)' : '';
    b.style.border = on ? 'none' : '';
  });
}

// registrableDomain() / regDomain() come from domain-utils.js, loaded before this script
// in popup.html. That is the SAME implementation the background service worker uses, so
// the chosen-sites list stores the exact eTLD+1 (mail.google.com -> google.com) that
// gets wiped -- no risk of the two drifting.

function paintForgetMe() {
  const toggle = $('forget-enable');
  if (!toggle) return;
  // The old "Chosen sites" mode was retired in favour of one global toggle.
  // Normalise any leftover 'list' config to off so the UI and behaviour agree.
  if (config.forgetMeMode === 'list') {
    config.forgetMeMode = 'off';
    config.forgetMeList = [];
    save();
    return;
  }
  // "Never let sites remember me" == wipe-on-leave for all sites (allowlist exempt).
  toggle.checked = config.forgetMeMode === 'all' && Number(config.forgetMeAllConfirmedAt || 0) > 0;
  const hist = $('forget-history');
  if (hist) hist.checked = config.forgetMeHistory === true;
}

// Reflect saved Tab Limit config into its (non-data-key) controls. Kept out
// of the KEYS auto-bind so "Turn everything on" never enables auto-closing tabs.
function paintTabLimitUI() {
  const guard = $('tl-guard');
  if (!guard) return;
  guard.checked = config.tabLimitGuard === true;
  const max = $('tl-max');
  if (max) max.value = Number(config.tabLimitMax) > 0 ? Number(config.tabLimitMax) : 20;
  const idle = $('tl-idle');
  if (idle) idle.value = Number(config.tabLimitMinIdleMinutes) >= 0 ? Number(config.tabLimitMinIdleMinutes) : 30;
  const close = $('tl-close');
  if (close) close.checked = config.tabLimitClose === true;
  const warn = $('tl-warn');
  if (warn) warn.checked = config.tabLimitWarn !== false;
}

// The site-breach lookup only works when its toggle is on (it contacts an
// external service, so it's opt-in). Disable the button + note when off.
/* Everything the reader has silenced, and the way back.
 *
 * A "never show this again" with no way to find it afterwards is a trap, so this
 * is the other half of the button on the notification card. The row hides itself
 * when nothing is muted rather than sitting there empty -- an always-present
 * panel reading "nothing here" is furniture.
 *
 * Expired entries are swept on render as well as on write, so what is listed is
 * what is actually in force. A card that says "silenced until 14:05" when 14:05
 * was an hour ago is worse than no card. */
/* The words on the card, not the name of the code that drew it.

   This panel exists to be recognised: someone silenced a notice a minute ago
   and wants the same notice back. De-prefixing the internal key gets close
   enough to read as correct -- and then hands them "Abuseipdb server" for
   what the card called a suspicious server, or "Honeytoken read" for
   suspicious script behaviour. Recognisable only if you wrote the code.

   Kept in step with the engine's TOAST_INFO by the toast-mutes gate, which
   fails if a type gains a title here that the card does not use, or gains a
   card without a title here. The fallback stays for a type mid-rename. */
const TOAST_TITLES = {
  blocked_popup: 'Popup blocked',
  blocked_gestureless_nav: 'Forced redirect blocked',
  blocked_meta_refresh: 'Auto-redirect blocked',
  blocked_redirect_chain: 'Redirect chain stopped',
  detected_grabber_domain: 'IP-logger detected',
  blocked_grabber_fetch: 'IP-grabber blocked',
  blocked_grabber_xhr: 'IP-grabber blocked',
  blocked_grabber_beacon: 'IP-grabber blocked',
  blocked_grabber_pixel: 'Tracking pixel blocked',
  blocked_ip_lookup: 'IP lookup blocked',
  blocked_grabber_element: 'Grabber element removed',
  blocked_safe_browsing_link: 'Dangerous link blocked',
  blocked_safe_browsing_form: 'Form submission blocked',
  blocked_safe_browsing_paste: 'Secret paste blocked',
  blocked_token_exfil: 'Sensitive request protected',
  blocked_skimmer_exfil: 'Card/password theft blocked',
  blocked_payment_card_submit: 'Card submission blocked',
  blocked_confirm_bait: 'Fake confirm box removed',
  detected_beacon: 'Data sent in the background',
  warned_confirm_bait: 'Fake confirm box',
  warned_back_trap: 'Back button trapped',
  warned_payment_sheet: 'Payment sheet opened',
  warned_idle_watch: 'Presence tracking started',
  warned_app_install_prompt: 'Asked to install itself',
  warned_notification_bait: 'Notification bait',
  warned_notification_scam: 'Scam-shaped notification',
  warned_device_request: 'Hardware access requested',
  warned_device_silent: 'Hardware read without a prompt',
  warned_service_worker: 'Installed a service worker',
  blocked_speech_capture: 'Speech recognition blocked',
  warned_speech_capture: 'Speech recognition started',
  warned_file_request: 'File or folder access requested',
  warned_file_silent: 'File access from an earlier visit',
  warned_fake_window: 'Fake sign-in window',
  warned_fullscreen_spoof: 'Fake address bar',
  blocked_media_capture: 'Camera or mic blocked',
  blocked_screen_capture: 'Screen capture blocked',
  blocked_geolocation: 'Location blocked',
  blocked_autoplay_media: 'Autoplay media blocked',
  blocked_hidden_media: 'Hidden media blocked',
  blocked_suspicious_webrtc: 'Suspicious WebRTC blocked',
  warned_media_capture: 'Camera or mic requested',
  warned_hidden_media_capture: 'Hidden media request',
  warned_screen_capture: 'Screen capture requested',
  warned_hidden_screen_capture: 'Unexpected screen-share request',
  warned_shortener: 'Shortened link',
  warned_redirect_param: 'Redirecting link',
  warned_logger_api: 'Possible tracker',
  warned_abuseipdb_server: 'Suspicious server',
  warned_url_reputation: 'Suspicious URL reputation',
  warned_phishing: 'Possible fake site',
  warned_payment_card_entry: 'Check this checkout',
  warned_fake_update: 'Fake update scam',
  warned_keystroke_pressure: 'Heavy text-input monitoring',
  warned_honeytoken_read: 'Suspicious script behaviour detected',
  behavioral_risk: 'Suspicious site behavior',
};

function humanToastType(type) {
  const known = Object.prototype.hasOwnProperty.call(TOAST_TITLES, type) && TOAST_TITLES[type];
  if (known) return known;
  const label = String(type || '').replace(/^(blocked|warned|detected|gated|cleaned)_/, '').replace(/_/g, ' ');
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : type;
}


function muteRemaining(until) {
  if (until === 0) return 'Always hidden';
  const left = Number(until) - Date.now();
  if (left <= 0) return '';
  const mins = Math.round(left / 60000);
  if (mins < 60) return 'Hidden for ' + mins + ' more minute' + (mins === 1 ? '' : 's');
  const hours = Math.round(mins / 60);
  return 'Hidden for ' + hours + ' more hour' + (hours === 1 ? '' : 's');
}

function renderMutedToasts(cfg) {
  const row = document.getElementById('muted-toasts-row');
  const list = document.getElementById('muted-toasts-list');
  if (!row || !list) return;
  const mutes = (cfg && cfg.toastMutes) || {};
  const now = Date.now();
  const live = Object.keys(mutes)
    .filter((type) => mutes[type] === 0 || Number(mutes[type]) > now)
    .sort();
  list.textContent = '';
  /* Always shown, empty or not. It used to hide itself when nothing was muted,
     which is tidier and meant that someone looking for the place to undo a
     "never show this again" found nothing -- indistinguishable from the feature
     not existing. An empty state that says so is worth the row. */
  if (!live.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11.5px;color:var(--wo-text-soft);padding:2px 0;';
    empty.textContent = 'Nothing silenced right now.';
    list.appendChild(empty);
    return;
  }

  live.forEach((type) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--wo-line);';
    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:12px;font-weight:600;color:var(--wo-text);';
    name.textContent = humanToastType(type);
    const when = document.createElement('div');
    when.style.cssText = 'font-size:10.5px;color:var(--wo-text-soft);';
    when.textContent = muteRemaining(mutes[type]);
    text.appendChild(name);
    text.appendChild(when);
    item.appendChild(text);

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn';
    undo.style.cssText = 'flex:none;font-size:11px;padding:3px 9px;';
    undo.textContent = 'Show again';
    undo.addEventListener('click', () => {
      undo.disabled = true;
      /* Through persistConfig, which is the one place allowed to write
         wardenone_config -- a second writer is how two panels start racing each
         other and a setting silently reverts. popupChangedKeys diffs config
         against the saved snapshot, so mutating it here is enough to have this
         key written and nothing else touched. */
      const updated = Object.assign({}, config.toastMutes || {});
      delete updated[type];
      config.toastMutes = updated;
      persistConfig(() => renderMutedToasts(config), () => { undo.disabled = false; });
    });
    item.appendChild(undo);
    list.appendChild(item);
  });
}

function syncBreachVisibility() {
  const btn = $('ss-sitebreach');
  if (btn) {
    const on = config.breachCheck === true;
    btn.disabled = !on;
    btn.style.opacity = on ? '1' : '0.5';
    btn.title = on ? '' : 'Enable "Breach & site-history checks" above to use this';
  }
}

function updateMasterState() {
  const on = $('enabled').checked;
  const s = $('master-state');
  s.textContent = on ? 'Enabled' : 'Disabled';
  s.className = 'state ' + (on ? 'on' : 'off');
}

function reflectMasterDisable() {
  const on = $('enabled').checked;
  document.querySelectorAll('.group .tg').forEach((tg) => {
    tg.classList.toggle('disabled', !on);
  });
  ['js-global-wrap', 'js-smart-wrap', 'js-site-wrap', 'js-privacy-wrap'].forEach((id) => {
    const tg = $(id);
    if (tg) tg.classList.toggle('disabled', !on);
  });
  const privacyLimits = $('js-privacy-limits');
  if (privacyLimits) privacyLimits.disabled = !on;
  const scriptTrust = $('script-trust-add-current');
  if (scriptTrust) scriptTrust.disabled = !on;
  const eyePanel = $('eyeshield-panel');
  if (eyePanel) eyePanel.classList.toggle('is-disabled', !on);
  document.querySelectorAll('.eyeshield-mode').forEach((btn) => { btn.disabled = !on; });
  document.querySelectorAll('.eyeshield-range').forEach((r) => { r.disabled = !on; });
}

function reflectSilentMode() {
  const silentOn = config.silentMode === true;
  ['showToasts', 'showBadge'].forEach((key) => {
    const el = document.querySelector(`input[data-key="${key}"]`);
    if (el) {
      if (silentOn) el.checked = false;
      const tg = el.closest('.tg');
      if (tg) tg.classList.toggle('disabled', silentOn);
    }
  });
}

function syncJsShieldUI(res) {
  const g = $('js-global');
  const smart = $('js-smart');
  const s = $('js-site');
  const siteName = $('js-site-name');
  const siteDesc = $('js-site-desc');
  const globalWrap = $('js-global-wrap');
  const smartWrap = $('js-smart-wrap');
  const siteWrap = $('js-site-wrap');
  const masterOn = !($('enabled') && $('enabled').checked === false);
  if (!s) return;
  if (!res || !res.ok) {
    if (g) {
      g.checked = false;
      g.disabled = true;
    }
    if (smart) {
      smart.checked = false;
      smart.disabled = true;
    }
    s.checked = false;
    s.disabled = true;
    if (siteWrap) siteWrap.classList.add('disabled');
    if (globalWrap) globalWrap.classList.add('disabled');
    if (smartWrap) smartWrap.classList.add('disabled');
    const scriptTrust = $('script-trust-add-current');
    if (scriptTrust) scriptTrust.disabled = true;
    if (siteName) siteName.textContent = 'Block scripts on this site';
    if (siteDesc) siteDesc.textContent = 'Open a normal web page to control this site.';
    return;
  }
  const mode = res.mode === 'smart' || res.mode === 'lockdown' ? res.mode : 'normal';
  const globalOn = mode === 'lockdown' || res.global === 'block';
  const host = String(res.host || '').trim();
  if (g) {
    g.checked = globalOn;
    g.disabled = !masterOn;
  }
  if (smart) {
    smart.checked = mode === 'smart';
    smart.disabled = !masterOn || globalOn;
  }
  s.disabled = !masterOn;
  if (globalWrap) globalWrap.classList.toggle('disabled', !masterOn);
  if (smartWrap) smartWrap.classList.toggle('disabled', !masterOn || globalOn);
  if (siteWrap) siteWrap.classList.toggle('disabled', !masterOn);
  const scriptTrust = $('script-trust-add-current');
  if (scriptTrust) scriptTrust.disabled = !masterOn;
  const shield = $('js-shield');
  if (shield) shield.setAttribute('data-mode', mode);
  // One feature, two modes: with all sites blocked, the site row becomes the
  // allowlist; otherwise it is a per-site block.
  if (globalOn) {
    s.checked = res.site !== 'block';
    if (siteName) siteName.textContent = 'Allow JavaScript on this site';
    if (siteDesc) siteDesc.textContent = host ? ('Allow scripts on ' + host + ' while Lockdown blocks the rest.') : 'Allow scripts on the active site while Lockdown blocks the rest.';
  } else if (mode === 'smart') {
    s.checked = res.site === 'block';
    if (siteName) siteName.textContent = 'Block all scripts on this site';
    if (siteDesc) siteDesc.textContent = host ? ('Hard-block ' + host + '. Smart level still controls third-party script hosts elsewhere.') : 'Hard-block this site. Smart level still controls third-party script hosts elsewhere.';
  } else {
    s.checked = res.site === 'block';
    if (siteName) siteName.textContent = 'Block scripts on this site';
    if (siteDesc) siteDesc.textContent = host ? ('Only ' + host + ' is blocked; other sites keep normal JavaScript.') : 'Only this site is blocked; other sites keep normal JavaScript.';
  }
}

function loadJsShieldState() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = (tabs[0] && tabs[0].url) || '';
    chrome.runtime.sendMessage({ kind: 'get-javascript-state', url }, (res) => { void chrome.runtime.lastError;
      syncJsShieldUI(res);
      if (res && res.ok && Array.isArray(res.trustedHosts)) renderScriptTrustList(res.trustedHosts);
      else renderScriptTrustList();
    });
  });
}

function setScriptShieldMode(mode) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = (tabs[0] && tabs[0].url) || '';
    chrome.runtime.sendMessage({ kind: 'set-script-shield-mode', mode, url }, (res) => {
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      if (err || !res || !res.ok) {
        setSavedTick((res && res.error) || err || 'Script Shield level failed', true);
        loadJsShieldState();
        return;
      }
      syncJsShieldUI(res);
      renderScriptTrustList(res.trustedHosts);
      setSavedTick('Script Shield level saved', false);
    });
  });
}

function setJsShield(scope, block) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = (tabs[0] && tabs[0].url) || '';
    chrome.runtime.sendMessage({ kind: 'set-javascript-state', scope, block, url }, (res) => {
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      if (err || !res || !res.ok) {
        loadJsShieldState();
        return;
      }
      syncJsShieldUI(res);
      if (res && res.ok && Array.isArray(res.trustedHosts)) renderScriptTrustList(res.trustedHosts);
    });
  });
}

function readFromUI() {
  const previousProviderKeys = {
    downloadSafeBrowsingKey: config.downloadSafeBrowsingKey || '',
    downloadVirusTotalKey: config.downloadVirusTotalKey || '',
    urlHausKey: config.urlHausKey || '',
    abuseIpDbKey: config.abuseIpDbKey || '',
    openPhishKey: config.openPhishKey || '',
    phishTankKey: config.phishTankKey || '',
    whoisXmlKey: config.whoisXmlKey || '',
  };
  config.enabled = $('enabled').checked;
  KEYS.forEach((k) => {
    const els = document.querySelectorAll(`input[data-key="${k}"]`);
    if (els.length) config[k] = els[0].checked;
  });
  config.googleSearchResultCleanup = false;
  config.showDownloadBar = true;
  // When silent mode is on, force notifications and badge off regardless of their checkbox state
  if (config.silentMode) {
    config.showToasts = false;
    config.showBadge = false;
  }
  document.querySelectorAll('[data-config-text]').forEach((el) => {
    const key = el.getAttribute('data-config-text');
    config[key] = el.value.trim();
  });
  normalizeProviderSettings(previousProviderKeys);
}

function normalizeProviderSettings(previousProviderKeys) {
  const previous = previousProviderKeys || {};
  const vtKey = String(config.downloadVirusTotalKey || '').trim();
  if (vtKey) {
    const oldKey = String(previous.downloadVirusTotalKey || '').trim();
    if (!oldKey || oldKey !== vtKey) config.downloadVirusTotal = true;
  } else {
    config.downloadVirusTotal = false;
    config.downloadVirusTotalHash = false;
  }
  const sbKey = String(config.downloadSafeBrowsingKey || '').trim();
  if (sbKey) {
    const oldKey = String(previous.downloadSafeBrowsingKey || '').trim();
    if (!oldKey || oldKey !== sbKey) config.downloadSafeBrowsing = true;
  } else {
    config.downloadSafeBrowsing = false;
  }
  REPUTATION_PROVIDERS.forEach((p) => {
    const nextKey = String(config[p.keyField] || '').trim();
    if (p.optionalKey) {
      if (nextKey) {
        const oldKey = String(previous[p.keyField] || '').trim();
        if (!oldKey || oldKey !== nextKey) config[p.key] = true;
      }
      return;
    }
    if (nextKey) {
      const oldKey = String(previous[p.keyField] || '').trim();
      if ((!oldKey || oldKey !== nextKey) && p.autoEnableOnKeyChange !== false) config[p.key] = true;
    } else {
      config[p.key] = false;
    }
  });
}

function syncVirusTotalStatus(text, color) {
  const vt = $('vt-key-status');
  if (!vt) return;
  if (text) {
    vt.textContent = text;
    vt.style.color = color || 'var(--ink-faint)';
    return;
  }
  const hasKey = !!String(config.downloadVirusTotalKey || '').trim();
  if (!hasKey) {
    vt.textContent = 'Paste a VirusTotal API key to enable URL reputation. Hash lookup stays optional.';
    vt.style.color = 'var(--ink-faint)';
    return;
  }
  if (config.downloadVirusTotal !== true) {
    vt.textContent = 'VirusTotal key is saved, but URL reputation is off.';
    vt.style.color = 'var(--ink-faint)';
    return;
  }
  vt.textContent = config.downloadVirusTotalHash
    ? 'VirusTotal URL reputation is on. URL-content hash lookup is also on.'
    : 'VirusTotal URL reputation is on. URL-content hash lookup is optional below.';
  vt.style.color = 'var(--plum)';
}

function syncSafeBrowsingStatus(text, color) {
  const sb = $('sb-key-status');
  if (!sb) return;
  if (text) {
    sb.textContent = text;
    sb.style.color = color || 'var(--ink-faint)';
    return;
  }
  const hasKey = !!String(config.downloadSafeBrowsingKey || '').trim();
  if (!hasKey) {
    sb.textContent = 'Paste a Google Safe Browsing API key to enable URL reputation.';
    sb.style.color = 'var(--ink-faint)';
    return;
  }
  if (config.downloadSafeBrowsing !== true) {
    sb.textContent = 'Safe Browsing key is saved, but URL reputation is off.';
    sb.style.color = 'var(--ink-faint)';
    return;
  }
  sb.textContent = 'Google Safe Browsing URL reputation is on.';
  sb.style.color = 'var(--plum)';
}

function syncReputationProviderStatus(provider, text, color) {
  const meta = typeof provider === 'string' ? REPUTATION_PROVIDERS.find((p) => p.key === provider) : provider;
  if (!meta) return;
  const el = $(meta.statusId);
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.style.color = color || 'var(--ink-faint)';
    return;
  }
  const hasKey = !!String(config[meta.keyField] || '').trim();
  if (meta.optionalKey && config[meta.key] === true) {
    el.textContent = meta.activeText || (meta.label + ' is on.');
    el.style.color = 'var(--plum)';
    return;
  }
  if (!hasKey) {
    el.textContent = meta.emptyText || ('Paste an API key to enable ' + meta.label + ' URL reputation.');
    el.style.color = 'var(--ink-faint)';
    return;
  }
  if (config[meta.key] !== true) {
    el.textContent = meta.label + ' key is saved, but the provider is off.';
    el.style.color = 'var(--ink-faint)';
    return;
  }
  el.textContent = meta.activeText || (meta.label + ' URL reputation is on.');
  el.style.color = 'var(--plum)';
}

function syncReputationProviderStatuses() {
  REPUTATION_PROVIDERS.forEach((provider) => syncReputationProviderStatus(provider));
}

function syncProviderStatus() {
  syncVirusTotalStatus();
  syncSafeBrowsingStatus();
  syncReputationProviderStatuses();
}

function publicConfig(cfg) {
  const out = Object.assign({}, cfg || {});
  delete out.downloadSafeBrowsingKey;
  delete out.downloadVirusTotalKey;
  delete out.forgetMeAllConfirmedAt;
  REPUTATION_PROVIDERS.forEach((p) => { delete out[p.keyField]; });
  return out;
}

function load() {
  chrome.storage.local.get('wardenone_config', (res) => {
    const saved = (res && res.wardenone_config) || null;
    if (saved) config = Object.assign({}, DEFAULTS, saved);
    // Snapshot what storage actually holds BEFORE the migration below, so the
    // migration reads as a change this popup intends to write rather than as state
    // it already agreed with.
    savedConfigSnapshot = configClone(config);
    if (saved && saved.googleSearchResultCleanup === true) {
      if (typeof saved.blockSearchAiAnswers === 'undefined') config.blockSearchAiAnswers = true;
      if (typeof saved.blockSponsoredSearchResults === 'undefined') config.blockSponsoredSearchResults = true;
      config.googleSearchResultCleanup = false;
    }
    config.showDownloadBar = true;
    applyToUI();
    updateAllowlistBtn();
    // Painted after applyToUI so the per-site list can read each protection's
    // label out of its own row rather than keeping a second copy of the wording.
    wireSiteControls();
    paintSiteControls();
    renderDownloadTrustList();
    renderTrackerLearner();
    loadExtensionAlerts();
    loadStartupReport();
    renderProtectionHealth();
    restorePopupSearch(() => restoreAdvancedProvidersState(restorePopupScrollPosition));
  });
}

function save(afterSave) {
  readFromUI();
  applyToUI();
  saveConfig('Saved', afterSave);
}

let savedTickTimer = 0;
function setSavedTick(text, isError) {
  const tick = $('saved-tick');
  if (!tick) return;
  tick.textContent = text || '';
  tick.className = isError ? '' : 'saved';
  tick.style.color = isError ? 'var(--wo-danger)' : '';
  // An error has something to read; a success tick is one word. Clearing both
  // after the same 2.2s meant the message that mattered was the one that got
  // taken away before it could be read.
  if (text) {
    const dwell = isError ? Math.min(12000, Math.max(6000, 2000 + 60 * String(text).length)) : 2600;
    clearTimeout(savedTickTimer);
    savedTickTimer = setTimeout(() => { tick.textContent = ''; tick.style.color = ''; }, dwell);
  }
}

// A provider's API key has no purpose once that provider is switched off, and
// leaving it behind means a secret sits in storage for a feature the user has
// already decided against. Dropping it on save keeps stored secrets to the ones
// actually in use, and re-enabling simply asks for the key again.
const PROVIDER_KEY_FIELDS = {
  downloadSafeBrowsing: 'downloadSafeBrowsingKey',
  downloadVirusTotal: 'downloadVirusTotalKey',
  urlHaus: 'urlHausKey',
  abuseIpDb: 'abuseIpDbKey',
  openPhish: 'openPhishKey',
  phishTank: 'phishTankKey',
  whoisXml: 'whoisXmlKey',
};
function dropKeysForDisabledProviders(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  for (const provider of Object.keys(PROVIDER_KEY_FIELDS)) {
    const field = PROVIDER_KEY_FIELDS[provider];
    if (cfg[provider] !== true && cfg[field]) cfg[field] = '';
  }
}

// ===== Settings backup =====
// Nothing syncs to a server and there is no account, so without this a reinstall
// means rebuilding 140-odd settings by hand.
//
// The config holds user-supplied third-party API keys, which are the only real
// secrets here. They are stripped by PATTERN rather than by a hand-written list,
// for the same reason bridge.js strips them that way: a list silently starts
// leaking the day an eighth provider is added. The same rule blocks them on the
// way IN, so a hand-edited file cannot inject a key either.
const SECRET_FIELD_RE = /Key$/;
const SETTINGS_FILE_MARKER = 'wardenone-settings';
const SETTINGS_FILE_MAX_BYTES = 2 * 1024 * 1024;

function settingsIoStatus(text, isError) {
  const el = $('settings-io-result');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = isError ? 'var(--wo-danger)' : 'var(--ink-faint)';
}

function exportableSettings(cfg) {
  const out = {};
  Object.keys(cfg || {}).forEach((key) => {
    if (SECRET_FIELD_RE.test(key)) return;
    out[key] = cfg[key];
  });
  return out;
}

function exportSettings() {
  readFromUI();
  const settings = exportableSettings(config);
  const payload = { format: SETTINGS_FILE_MARKER, version: 1, settings };
  let url = '';
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wardenone-settings.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (_) {
    settingsIoStatus('Could not create the file.', true);
    return;
  }
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 15000);
  settingsIoStatus('Exported ' + Object.keys(settings).length + ' settings. API keys were not included.', false);
}

// An imported file is untrusted input. Every value is matched against the shape
// of the shipped default for that key -- unknown keys, wrong types, and oversized
// lists are dropped rather than trusted.
function sanitizeImportedSettings(raw) {
  const settings = {};
  let ignored = 0;
  Object.keys(raw || {}).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) { ignored++; return; }
    if (SECRET_FIELD_RE.test(key)) { ignored++; return; }
    const def = DEFAULTS[key];
    const val = raw[key];
    if (typeof def === 'boolean') {
      if (typeof val === 'boolean') settings[key] = val; else ignored++;
    } else if (typeof def === 'number') {
      if (typeof val === 'number' && Number.isFinite(val)) settings[key] = val; else ignored++;
    } else if (typeof def === 'string') {
      if (typeof val === 'string' && val.length <= 200) settings[key] = val; else ignored++;
    } else if (Array.isArray(def)) {
      if (!Array.isArray(val)) { ignored++; return; }
      settings[key] = val.filter((h) => typeof h === 'string' && h.length <= 260).slice(0, 1000);
    } else if (def && typeof def === 'object') {
      if (!val || typeof val !== 'object' || Array.isArray(val)) { ignored++; return; }
      const map = {};
      Object.keys(val).slice(0, 500).forEach((host) => {
        const v = val[host];
        if (host.length <= 260 && (typeof v === 'number' || typeof v === 'string')) map[host] = v;
      });
      settings[key] = map;
    } else {
      ignored++;
    }
  });
  return { settings, ignored };
}

function importSettingsFromFile(file) {
  if (!file) return;
  if (file.size > SETTINGS_FILE_MAX_BYTES) {
    settingsIoStatus('That file is too large to be a settings export.', true);
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => settingsIoStatus('Could not read that file.', true);
  reader.onload = () => {
    let parsed = null;
    try { parsed = JSON.parse(String(reader.result || '')); } catch (_) {
      settingsIoStatus('That file is not valid JSON.', true);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.format !== SETTINGS_FILE_MARKER
      || !parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
      settingsIoStatus('That does not look like a WardenOne settings file.', true);
      return;
    }
    const result = sanitizeImportedSettings(parsed.settings);
    const applied = Object.keys(result.settings);
    if (!applied.length) {
      settingsIoStatus('Nothing in that file could be applied.', true);
      return;
    }
    applied.forEach((key) => { config[key] = result.settings[key]; });
    applyToUI();
    saveConfig('Settings imported', reloadActiveHttpTab);
    settingsIoStatus('Applied ' + applied.length + ' settings'
      + (result.ignored ? ', ignored ' + result.ignored + ' unrecognised' : '')
      + '. Your API keys were left as they are.', false);
  };
  reader.readAsText(file);
}

// Read-modify-write. Re-reads storage at the write boundary and lays only the keys
// this popup changed on top, so a concurrent writer's changes survive instead of
// being reverted by our snapshot. On success `config` becomes exactly what was
// stored, so the next diff starts from the truth rather than from a stale copy.
//
// onSaved receives the keys that arrived from the other writer, so the caller can
// repaint just those controls.
function persistConfig(onSaved, onError) {
  const changedKeys = popupChangedKeys();
  chrome.storage.local.get('wardenone_config', (store) => {
    void chrome.runtime.lastError;
    const raw = store && store.wardenone_config;
    const stored = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const next = Object.assign({}, DEFAULTS, stored);
    changedKeys.forEach((k) => { next[k] = config[k]; });
    // Applied to the merged result, not just to `config`: this decides what is
    // actually written, and a provider switched off in either copy must not leave
    // its key behind in storage.
    dropKeysForDisabledProviders(next);
    const adopted = Object.keys(next).filter((k) => changedKeys.indexOf(k) < 0
      && configValuesDiffer(next[k], savedConfigSnapshot[k]));
    chrome.storage.local.set({ wardenone_config: next }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (typeof onError === 'function') onError(err);
        return;
      }
      config = next;
      savedConfigSnapshot = configClone(next);
      if (typeof onSaved === 'function') onSaved(adopted);
    });
  });
}

// An external change landed while the popup was open. Repaint only the controls for
// the keys we took from it, and never a text field -- an API key the user is halfway
// through typing must not be overwritten under the cursor. KEYS gates the selector so
// a tampered storage key can never reach querySelectorAll.
function repaintExternalConfigKeys(keys) {
  let masterChanged = false;
  (keys || []).forEach((key) => {
    if (key === 'enabled') { masterChanged = true; return; }
    if (KEYS.indexOf(key) < 0) return;
    document.querySelectorAll(`input[data-key="${key}"]`).forEach((el) => {
      el.checked = config[key] !== false;
    });
  });
  if (masterChanged) {
    const enabledEl = $('enabled');
    if (enabledEl) enabledEl.checked = config.enabled !== false;
    updateMasterState();
    reflectMasterDisable();
  }
  reflectSilentMode();
  syncBreachVisibility();
}

// Keep `config` in step with a change another surface just made, so the popup stops
// showing a value that is no longer true and the next diff is measured against the
// real stored state. Keys the user has already edited here win, and text fields are
// left alone entirely because an in-progress edit is not yet reflected in `config`.
function adoptExternalConfigChange(newValue) {
  const incoming = (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) ? newValue : null;
  if (!incoming) return;
  const mine = popupChangedKeys();
  const textFieldKeys = new Set();
  document.querySelectorAll('[data-config-text]').forEach((el) => {
    textFieldKeys.add(el.getAttribute('data-config-text'));
  });
  const adopted = [];
  Object.keys(incoming).forEach((key) => {
    if (mine.indexOf(key) >= 0 || textFieldKeys.has(key)) return;
    if (!configValuesDiffer(incoming[key], config[key])) return;
    config[key] = configClone(incoming[key]);
    savedConfigSnapshot[key] = configClone(incoming[key]);
    adopted.push(key);
  });
  if (adopted.length) repaintExternalConfigKeys(adopted);
}

function saveConfig(label, afterSave) {
  dropKeysForDisabledProviders(config);
  persistConfig((adopted) => {
    // notify any open tabs so the change relays into their page (next load applies fully)
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((t) => {
        // the callback reads lastError so tabs without our content script
        // (chrome:// pages, tabs from before install) don't reject a promise
        // and spam the console -- a bare try/catch can't catch that async error
        try { chrome.tabs.sendMessage(t.id, { kind: 'config-update', overrides: publicConfig(config) }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      });
    });
    if (adopted.length) repaintExternalConfigKeys(adopted);
    setSavedTick(label || 'Saved', false);
    syncProviderStatus();
    renderProtectionHealth();
    if (typeof afterSave === 'function') afterSave();
  }, () => setSavedTick('Save failed', true));
}

function reloadActiveHttpTab() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (t && t.id != null && /^https?:/i.test(t.url || '')) {
        try { chrome.tabs.reload(t.id); } catch (_) {}
      }
    });
  } catch (_) {}
}

function reloadAllHttpTabs() {
  try {
    chrome.tabs.query({}, (tabs) => {
      (tabs || []).forEach((t) => {
        if (t && t.id != null && /^https?:/i.test(t.url || '')) {
          try { chrome.tabs.reload(t.id); } catch (_) {}
        }
      });
    });
  } catch (_) {}
}

function injectEyeShieldActiveTab() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null || !/^https?:/i.test(tab.url || '') || !chrome.scripting) return;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['eyeshield.js'] }, () => {
        void chrome.runtime.lastError;
      });
    });
  } catch (_) {}
}

function turnEverythingOn() {
  const enabled = $('enabled');
  if (enabled) enabled.checked = true;
  const silent = document.querySelector('input[data-key="silentMode"]');
  if (silent) silent.checked = false;
  document.querySelectorAll('input[data-key]').forEach((el) => {
    const key = el.getAttribute('data-key');
    if (!key || MANUAL_ONLY_TOGGLES.has(key)) return;
    el.checked = true;
  });
  readFromUI();
  applyToUI();
  saveConfig('Everything on', reloadActiveHttpTab);
}

function testVirusTotalKey() {
  readFromUI();
  const key = String(config.downloadVirusTotalKey || '').trim();
  if (!key) {
    syncVirusTotalStatus('Paste your VirusTotal API key first.', 'var(--wo-danger)');
    applyToUI();
    return;
  }
  config.downloadVirusTotal = true;
  applyToUI();
  saveConfig('Saved', () => syncVirusTotalStatus('Testing VirusTotal key...', 'var(--ink-faint)'));
  chrome.runtime.sendMessage({ kind: 'test-virustotal-key', key }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      const msg = (res && res.error) || err || 'VirusTotal key test failed.';
      syncVirusTotalStatus(msg, 'var(--wo-danger)');
      return;
    }
    syncVirusTotalStatus(res.message || 'VirusTotal key works. URL reputation is enabled.', 'var(--wo-success)');
  });
}

function testSafeBrowsingKey() {
  readFromUI();
  const key = String(config.downloadSafeBrowsingKey || '').trim();
  if (!key) {
    syncSafeBrowsingStatus('Paste your Google Safe Browsing API key first.', 'var(--wo-danger)');
    applyToUI();
    return;
  }
  syncSafeBrowsingStatus('Testing Safe Browsing key...', 'var(--ink-faint)');
  chrome.runtime.sendMessage({ kind: 'test-safe-browsing-key', key }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      config.downloadSafeBrowsing = false;
      applyToUI();
      saveConfig('Saved', () => syncSafeBrowsingStatus((res && res.error) || err || 'Safe Browsing key test failed.', 'var(--wo-danger)'));
      return;
    }
    config.downloadSafeBrowsing = true;
    applyToUI();
    saveConfig('Saved', () => syncSafeBrowsingStatus(res.message || 'Google Safe Browsing key works. URL reputation is enabled.', 'var(--wo-success)'));
  });
}

function setupReputationProvider(providerKey) {
  const provider = REPUTATION_PROVIDERS.find((p) => p.key === providerKey);
  if (!provider) return;
  readFromUI();
  const key = String(config[provider.keyField] || '').trim();
  if (!key && !provider.optionalKey) {
    syncReputationProviderStatus(provider, 'Paste your ' + provider.label + ' API key first.', 'var(--wo-danger)');
    applyToUI();
    return;
  }
  config[provider.key] = false;
  applyToUI();
  syncReputationProviderStatus(provider, 'Testing ' + provider.label + ' key...', 'var(--ink-faint)');
  chrome.runtime.sendMessage({ kind: 'test-reputation-provider-key', provider: provider.key, key }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      config[provider.key] = false;
      applyToUI();
      saveConfig('Saved', () => syncReputationProviderStatus(provider, (res && res.error) || err || (provider.label + ' key test failed.'), 'var(--wo-danger)'));
      return;
    }
    config[provider.key] = true;
    if (provider.key === 'whoisXml') config.downloadDomainAge = true;
    applyToUI();
    saveConfig('Saved', () => syncReputationProviderStatus(provider, res.message || (provider.label + ' responded. Reputation checks are enabled.'), 'var(--wo-success)'));
  });
}

function scanUrlWithVirusTotal() {
  const input = $('vt-scan-url');
  const out = $('vt-scan-result');
  if (!input || !out) return;
  const url = String(input.value || '').trim();
  if (!url) { out.textContent = 'Enter a URL to scan.'; out.style.color = 'var(--wo-danger)'; return; }
  out.textContent = 'Scanning with VirusTotal...';
  out.style.color = 'var(--ink-faint)';
  chrome.runtime.sendMessage({ kind: 'scan-url-virustotal', url }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      out.textContent = (res && res.error) || err || 'Scan failed.';
      out.style.color = 'var(--wo-danger)';
      return;
    }
    if (res.notFound) {
      out.textContent = 'VirusTotal has no report for this URL yet (not necessarily safe - just unseen).';
      out.style.color = 'var(--ink-soft)';
      return;
    }
    const s = res.stats || {};
    const mal = Number(s.malicious || 0);
    const sus = Number(s.suspicious || 0);
    if (mal > 0 || sus > 0) {
      out.textContent = 'Flagged: ' + mal + ' malicious, ' + sus + ' suspicious (of ' + (mal + sus + Number(s.harmless || 0) + Number(s.undetected || 0)) + ' engines). Avoid this link.';
      out.style.color = 'var(--wo-danger)';
    } else {
      out.textContent = 'Clean: 0 malicious, 0 suspicious across ' + (Number(s.harmless || 0) + Number(s.undetected || 0)) + ' engines.';
      out.style.color = 'var(--wo-success)';
    }
  });
}

function allowlistCurrent() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;
    let host;
    try { host = new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return; }
    if (!host) return;
    config.allowlist = config.allowlist || [];
    const idx = config.allowlist.indexOf(host);
    const note = $('note');
    if (idx >= 0) {
      // already allowlisted -> remove (re-enable protection here)
      config.allowlist.splice(idx, 1);
      persistConfig((adopted) => {
        if (adopted.length) repaintExternalConfigKeys(adopted);
        setNote(note, [
          { t: 'Protection ' },
          { t: 're-enabled', cls: 'saved' },
          { t: ' on ' + host + ' (reload to apply).' },
        ]);
        updateAllowlistBtn();
      }, (err) => {
        setNote(note, [{ t: 'Could not save allowlist change: ' + (err.message || String(err)) }]);
        config.allowlist.push(host);
        updateAllowlistBtn();
      });
    } else {
      config.allowlist.push(host);
      persistConfig((adopted) => {
        if (adopted.length) repaintExternalConfigKeys(adopted);
        setNote(note, [
          { t: host, cls: 'saved' },
          { t: ' allowlisted — WardenOne stays passive there after reload.' },
        ]);
        updateAllowlistBtn();
      }, (err) => {
        setNote(note, [{ t: 'Could not save allowlist change: ' + (err.message || String(err)) }]);
        config.allowlist = config.allowlist.filter((h) => h !== host);
        updateAllowlistBtn();
      });
    }
  });
}

// Build a note's contents from plain parts using textContent (never innerHTML),
// so a hostname can never inject markup. Each part is {t: text, cls?: className}.
function setNote(el, parts) {
  el.textContent = '';
  for (const part of parts) {
    if (part.cls) {
      const span = document.createElement('span');
      span.className = part.cls;
      span.textContent = part.t;
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(part.t));
    }
  }
}

function updateAllowlistBtn() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const btn = $('allowlist');
    if (!tab || !tab.url) { btn.textContent = 'Allowlist this site'; return; }
    let host;
    try { host = new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { btn.textContent = 'Allowlist this site'; return; }
    const on = (config.allowlist || []).includes(host);
    btn.textContent = on ? 'Trusted — click to protect' : 'Allowlist this site';
    btn.style.borderColor = on ? 'var(--green)' : 'var(--line-2)';
  });
}

// ---------------------------------------------------------------------------
// Per-site control.
//
// Until now the only site-level lever was the allowlist, which turns the whole
// engine off, permanently, until someone remembers to undo it. So a single guard
// misreading a single site cost either that guard everywhere or every guard
// there. Two narrower levers:
//
//   Pause     allowlistUntil[host] = when it lapses. Same effect as the
//             allowlist, but it expires on its own.
//   Turn off  siteOverrides[host][key] = false. One protection, one site,
//             everything else still running.
//
// Both are resolved in bridge.js before the config reaches any content script,
// so nothing downstream has to know they exist.
// ---------------------------------------------------------------------------

// Expired passes are dropped whenever we write, which is the only moment we are
// already touching storage. Reading is left alone -- a decision path should not
// be issuing writes.
function prunePausedSites() {
  const until = config.allowlistUntil;
  if (!until || typeof until !== 'object') { config.allowlistUntil = {}; return; }
  const now = Date.now();
  for (const host of Object.keys(until)) {
    const at = Number(until[host]);
    if (!Number.isFinite(at) || at <= now) delete until[host];
  }
}

function pausedUntilFor(host) {
  const at = Number((config.allowlistUntil || {})[host]);
  return Number.isFinite(at) && at > Date.now() ? at : 0;
}

function siteOverridesFor(host) {
  const entry = (config.siteOverrides || {})[host];
  return entry && typeof entry === 'object' ? entry : null;
}

function describeRemaining(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return mins + (mins === 1 ? ' minute' : ' minutes');
  const hours = Math.round(mins / 60);
  return hours + (hours === 1 ? ' hour' : ' hours');
}

// The label a protection shows in its own row, so the per-site list never drifts
// from the wording everywhere else. Falls back to the config key if a row has no
// visible name -- better a key than a blank option.
function protectionLabel(key) {
  const input = document.querySelector('input[data-key="' + key + '"]');
  const row = input && input.closest ? input.closest('.row') : null;
  const name = row && row.querySelector ? row.querySelector('.name') : null;
  const text = name ? String(name.textContent || '').trim() : '';
  return text || key;
}

function paintSiteControls() {
  activeTabHost((host) => {
    const panel = $('site-controls');
    if (!panel) return;
    const section = $('site-controls-group') || panel;
    const pick = $('site-off-pick');
    const list = $('site-off-list');
    const activeRow = $('site-pause-active-row');
    const activeText = $('site-pause-active');
    if (!host) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    panel.hidden = false;

    const until = pausedUntilFor(host);
    if (activeRow) activeRow.hidden = !until;
    if (until && activeText) {
      activeText.textContent = 'Paused on ' + host + ' for another ' + describeRemaining(until - Date.now());
    }

    if (pick && !pick.dataset.filled) {
      const options = KEYS
        .filter((key) => typeof DEFAULTS[key] === 'boolean')
        .map((key) => ({ key, label: protectionLabel(key) }))
        .sort((a, b) => a.label.localeCompare(b.label));
      pick.textContent = '';
      for (const option of options) {
        const el = document.createElement('option');
        el.value = option.key;
        el.textContent = option.label;
        pick.appendChild(el);
      }
      pick.dataset.filled = '1';
    }

    if (list) {
      list.textContent = '';
      const entry = siteOverridesFor(host);
      const off = entry ? Object.keys(entry).filter((key) => entry[key] === false) : [];
      if (!off.length) {
        const empty = document.createElement('div');
        empty.className = 'desc';
        empty.textContent = 'Nothing turned off on ' + host + '.';
        list.appendChild(empty);
        return;
      }
      for (const key of off) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;';
        const name = document.createElement('div');
        name.className = 'desc';
        name.style.cssText = 'flex:1;min-width:0;';
        name.textContent = protectionLabel(key) + ' — off here';
        const undo = document.createElement('button');
        undo.className = 'btn';
        undo.style.cssText = 'flex:none;padding:5px 10px;font-size:11px;';
        undo.textContent = 'Undo';
        undo.addEventListener('click', () => setSiteOverride(host, key, true));
        row.appendChild(name);
        row.appendChild(undo);
        list.appendChild(row);
      }
    }
  });
}

function pauseSite(minutes) {
  activeTabHost((host) => {
    if (!host) return;
    prunePausedSites();
    config.allowlistUntil = config.allowlistUntil || {};
    config.allowlistUntil[host] = Date.now() + Math.max(1, Number(minutes) || 0) * 60000;
    const note = $('note');
    persistConfig((adopted) => {
      if (adopted.length) repaintExternalConfigKeys(adopted);
      setNote(note, [
        { t: host, cls: 'saved' },
        { t: ' paused for ' + describeRemaining(minutes * 60000) + ' — protection returns by itself (reload to apply).' },
      ]);
      paintSiteControls();
    }, (err) => {
      delete config.allowlistUntil[host];
      setNote(note, [{ t: 'Could not pause this site: ' + (err.message || String(err)) }]);
      paintSiteControls();
    });
  });
}

function resumeSite() {
  activeTabHost((host) => {
    if (!host || !config.allowlistUntil) return;
    const previous = config.allowlistUntil[host];
    delete config.allowlistUntil[host];
    const note = $('note');
    persistConfig((adopted) => {
      if (adopted.length) repaintExternalConfigKeys(adopted);
      setNote(note, [{ t: 'Protection ' }, { t: 'resumed', cls: 'saved' }, { t: ' on ' + host + ' (reload to apply).' }]);
      paintSiteControls();
    }, (err) => {
      if (previous) config.allowlistUntil[host] = previous;
      setNote(note, [{ t: 'Could not resume: ' + (err.message || String(err)) }]);
      paintSiteControls();
    });
  });
}

// on === true removes the override rather than storing a true: a site may only
// ever turn a protection OFF, never switch one on that is off globally.
function setSiteOverride(host, key, on) {
  if (!host || !key) return;
  config.siteOverrides = config.siteOverrides || {};
  const before = JSON.stringify(config.siteOverrides[host] || null);
  const entry = config.siteOverrides[host] || {};
  if (on) delete entry[key];
  else entry[key] = false;
  if (Object.keys(entry).length) config.siteOverrides[host] = entry;
  else delete config.siteOverrides[host];
  const note = $('note');
  persistConfig((adopted) => {
    if (adopted.length) repaintExternalConfigKeys(adopted);
    setNote(note, [
      { t: protectionLabel(key), cls: 'saved' },
      { t: (on ? ' turned back on for ' : ' turned off for ') + host + ' (reload to apply).' },
    ]);
    paintSiteControls();
  }, (err) => {
    const restored = before === 'null' ? null : JSON.parse(before);
    if (restored) config.siteOverrides[host] = restored;
    else delete config.siteOverrides[host];
    setNote(note, [{ t: 'Could not save that: ' + (err.message || String(err)) }]);
    paintSiteControls();
  });
}

function wireSiteControls() {
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  on('site-pause-15', () => pauseSite(15));
  on('site-pause-60', () => pauseSite(60));
  on('site-pause-480', () => pauseSite(480));
  on('site-pause-cancel', resumeSite);
  on('site-off-add', () => {
    const pick = $('site-off-pick');
    const key = pick && pick.value;
    if (!key) return;
    activeTabHost((host) => setSiteOverride(host, key, false));
  });
}

function activeTabHost(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) { callback(''); return; }
    try { callback(new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase()); }
    catch { callback(''); }
  });
}

function clampEyeShieldBrightness(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(200, n));
}

function normalizeEyeShieldMode(mode) {
  return mode === 'light' || mode === 'dark' || mode === 'ultra' ? mode : 'off';
}

function getEyeShieldBrightness() {
  // Global (all sites) — per-host map no longer consulted.
  return clampEyeShieldBrightness(config.eyeShieldBrightness == null ? 100 : config.eyeShieldBrightness);
}

function paintEyeShieldValue(valueId, pct, lo, hi, enabled, label) {
  const value = $(valueId);
  if (!value) return;
  value.setAttribute('role', 'spinbutton');
  value.setAttribute('aria-label', label || 'EyeShield value');
  value.setAttribute('aria-valuemin', String(lo));
  value.setAttribute('aria-valuemax', String(hi));
  value.setAttribute('aria-valuenow', String(pct));
  value.setAttribute('aria-valuetext', pct + '%');
  value.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  value.setAttribute('tabindex', enabled ? '0' : '-1');
  value.setAttribute('inputmode', 'numeric');
  value.setAttribute('spellcheck', 'false');
  value.setAttribute('contenteditable', enabled ? 'true' : 'false');
  value.title = enabled ? 'Click to type ' + lo + '-' + hi + '%' : '';
  value.classList.toggle('is-disabled', !enabled);
  value.classList.toggle('is-editing', value.dataset.editing === '1');
  if (value.dataset.editing !== '1') value.textContent = pct + '%';
}

function paintEyeShield() {
  const panel = $('eyeshield-panel');
  if (!panel) return;
  const masterOn = config.enabled !== false;
  const mode = normalizeEyeShieldMode(config.eyeShieldMode);
  const effectsOn = masterOn;
  document.querySelectorAll('.eyeshield-mode').forEach((btn) => {
    const on = btn.getAttribute('data-eyeshield-mode') === mode;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.disabled = !masterOn;
  });
  const brightness = getEyeShieldBrightness();
  const range = $('eyeshield-brightness');
  if (range) {
    range.value = String(brightness);
    range.disabled = !effectsOn;
  }
  paintEyeShieldValue('eyeshield-value', brightness, 0, 200, effectsOn, 'EyeShield brightness');
  const host = $('eyeshield-host');
  if (host) host.textContent = 'All sites brightness';
  paintEyeShieldPct('eyeShieldContrast', 'eyeShieldContrastByHost', 0, 300, 100, 'eyeshield-contrast', 'eyeshield-contrast-value', 'eyeshield-contrast-host', 'contrast', effectsOn);
  paintEyeShieldPct('eyeShieldSaturation', 'eyeShieldSaturationByHost', 0, 300, 100, 'eyeshield-saturation', 'eyeshield-saturation-value', 'eyeshield-saturation-host', 'saturation', effectsOn);
  paintEyeShieldPct('eyeShieldWarmth', 'eyeShieldWarmthByHost', 0, 100, 0, 'eyeshield-warmth', 'eyeshield-warmth-value', 'eyeshield-warmth-host', 'warmth', effectsOn);
  paintEyeShieldPct('eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 0, 100, 0, 'eyeshield-grayscale', 'eyeshield-grayscale-value', 'eyeshield-grayscale-host', 'grayscale', effectsOn);
  panel.classList.toggle('is-disabled', !masterOn);
}

function paintEyeShieldPct(globalKey, mapKey, lo, hi, dflt, rangeId, valueId, hostId, label, masterOn) {
  const pct = getEyeShieldPct(globalKey, mapKey, lo, hi, dflt);
  const range = $(rangeId);
  if (range) { range.value = String(pct); range.disabled = !masterOn; }
  paintEyeShieldValue(valueId, pct, lo, hi, masterOn, 'EyeShield ' + label);
  const host = $(hostId);
  if (host) host.textContent = 'All sites ' + label;
}

function saveEyeShieldSoon(label) {
  clearTimeout(eyeShieldSaveTimer);
  eyeShieldSaveTimer = setTimeout(() => {
    eyeShieldSaveTimer = 0;
    saveConfig(label || 'EyeShield', injectEyeShieldActiveTab);
  }, 140);
}

function clearEyeShieldAdjustments() {
  config.eyeShieldBrightness = 100;
  config.eyeShieldContrast = 100;
  config.eyeShieldSaturation = 100;
  config.eyeShieldWarmth = 0;
  config.eyeShieldGrayscale = 0;
  config.eyeShieldBrightnessByHost = {};
  config.eyeShieldContrastByHost = {};
  config.eyeShieldSaturationByHost = {};
  config.eyeShieldWarmthByHost = {};
  config.eyeShieldGrayscaleByHost = {};
}

function setEyeShieldMode(mode) {
  if (config.enabled === false) {
    paintEyeShield();
    return;
  }
  const normalized = normalizeEyeShieldMode(mode);
  config.eyeShieldMode = normalized;
  if (normalized === 'off') clearEyeShieldAdjustments();
  config.eyeShield = eyeShieldIsActive();
  paintEyeShield();
  clearTimeout(eyeShieldSaveTimer);
  eyeShieldSaveTimer = 0;
  saveConfig('EyeShield', injectEyeShieldActiveTab);
}

function setEyeShieldBrightness(value) {
  const brightness = clampEyeShieldBrightness(value);
  config.eyeShieldBrightness = brightness; // global (all sites)
  config.eyeShield = eyeShieldIsActive();
  paintEyeShield();
  saveEyeShieldSoon('EyeShield');
}

// Generic per-site percentage controls (contrast, saturation) — same shape as the
// brightness control above: a global default plus a per-host override map.
function eyeShieldIsActive() {
  const mode = normalizeEyeShieldMode(config.eyeShieldMode);
  return mode !== 'off'
    || getEyeShieldBrightness() !== 100
    || getEyeShieldPct('eyeShieldContrast', 'eyeShieldContrastByHost', 0, 300, 100) !== 100
    || getEyeShieldPct('eyeShieldSaturation', 'eyeShieldSaturationByHost', 0, 300, 100) !== 100
    || getEyeShieldPct('eyeShieldWarmth', 'eyeShieldWarmthByHost', 0, 100, 0) !== 0
    || getEyeShieldPct('eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 0, 100, 0) !== 0;
}
function clampEyeShieldPct(value, lo, hi, dflt) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function getEyeShieldPct(globalKey, mapKey, lo, hi, dflt) {
  // Global (all sites) — per-host map no longer consulted.
  return clampEyeShieldPct(config[globalKey] == null ? dflt : config[globalKey], lo, hi, dflt);
}
function setEyeShieldPct(globalKey, mapKey, lo, hi, dflt, value) {
  const pct = clampEyeShieldPct(value, lo, hi, dflt);
  config[globalKey] = pct; // global (all sites)
  config.eyeShield = eyeShieldIsActive();
  paintEyeShield();
  saveEyeShieldSoon('EyeShield');
}

function selectEyeShieldValueText(el) {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {}
}

function placeEyeShieldValueCaretEnd(el) {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {}
}

function sanitizeEyeShieldTypedValue(el) {
  const clean = String(el.textContent || '').replace(/[^\d]/g, '').slice(0, 4);
  if (el.textContent !== clean) {
    el.textContent = clean;
    placeEyeShieldValueCaretEnd(el);
  }
  return clean;
}

function saveEyeShieldNow() {
  clearTimeout(eyeShieldSaveTimer);
  eyeShieldSaveTimer = 0;
  saveConfig('EyeShield', injectEyeShieldActiveTab);
}

function wireEyeShieldValueEditor(valueId, lo, hi, dflt, readValue, applyValue) {
  const el = $(valueId);
  if (!el) return;
  const canEdit = () => config.enabled !== false && el.getAttribute('aria-disabled') !== 'true';
  const begin = () => {
    if (!canEdit()) return;
    if (el.dataset.editing !== '1') {
      el.dataset.editing = '1';
      el.classList.add('is-editing');
      el.textContent = String(readValue());
    }
    setTimeout(() => selectEyeShieldValueText(el), 0);
  };
  const cancel = () => {
    if (el.dataset.editing !== '1') return;
    delete el.dataset.editing;
    el.classList.remove('is-editing');
    paintEyeShield();
  };
  const commit = () => {
    if (el.dataset.editing !== '1') return;
    const raw = sanitizeEyeShieldTypedValue(el);
    const next = raw ? clampEyeShieldPct(raw, lo, hi, dflt) : readValue();
    delete el.dataset.editing;
    el.classList.remove('is-editing');
    applyValue(next);
    saveEyeShieldNow();
  };
  const step = (direction, big) => {
    const raw = sanitizeEyeShieldTypedValue(el);
    const current = raw ? clampEyeShieldPct(raw, lo, hi, dflt) : readValue();
    const next = clampEyeShieldPct(current + (direction * (big ? 10 : 1)), lo, hi, dflt);
    el.textContent = String(next);
    el.setAttribute('aria-valuenow', String(next));
    placeEyeShieldValueCaretEnd(el);
  };
  el.addEventListener('mousedown', (e) => {
    if (!canEdit()) return;
    e.preventDefault();
    e.stopPropagation();
    el.focus();
    begin();
  });
  el.addEventListener('click', (e) => {
    if (!canEdit()) return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('focus', begin);
  el.addEventListener('input', () => sanitizeEyeShieldTypedValue(el));
  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      el.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      el.blur();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      return;
    }
    if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
  });
  el.addEventListener('blur', commit);
}

function initEyeShield() {
  activeTabHost((host) => {
    eyeShieldHost = host || '';
    paintEyeShield();
  });
  document.querySelectorAll('.eyeshield-mode').forEach((btn) => {
    btn.addEventListener('click', () => setEyeShieldMode(btn.getAttribute('data-eyeshield-mode')));
  });
  const range = $('eyeshield-brightness');
  if (range) {
    range.addEventListener('input', () => setEyeShieldBrightness(range.value));
    range.addEventListener('change', () => {
      setEyeShieldBrightness(range.value);
      clearTimeout(eyeShieldSaveTimer);
      eyeShieldSaveTimer = 0;
      saveConfig('EyeShield', injectEyeShieldActiveTab);
    });
  }
  wireEyeShieldValueEditor('eyeshield-value', 0, 200, 100, getEyeShieldBrightness, setEyeShieldBrightness);
  wireEyeShieldPctRange('eyeshield-contrast', 'eyeShieldContrast', 'eyeShieldContrastByHost', 0, 300, 100);
  wireEyeShieldPctRange('eyeshield-saturation', 'eyeShieldSaturation', 'eyeShieldSaturationByHost', 0, 300, 100);
  wireEyeShieldPctRange('eyeshield-warmth', 'eyeShieldWarmth', 'eyeShieldWarmthByHost', 0, 100, 0);
  wireEyeShieldPctRange('eyeshield-grayscale', 'eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 0, 100, 0);
  wireEyeShieldValueEditor('eyeshield-contrast-value', 0, 300, 100, () => getEyeShieldPct('eyeShieldContrast', 'eyeShieldContrastByHost', 0, 300, 100), (v) => setEyeShieldPct('eyeShieldContrast', 'eyeShieldContrastByHost', 0, 300, 100, v));
  wireEyeShieldValueEditor('eyeshield-saturation-value', 0, 300, 100, () => getEyeShieldPct('eyeShieldSaturation', 'eyeShieldSaturationByHost', 0, 300, 100), (v) => setEyeShieldPct('eyeShieldSaturation', 'eyeShieldSaturationByHost', 0, 300, 100, v));
  wireEyeShieldValueEditor('eyeshield-warmth-value', 0, 100, 0, () => getEyeShieldPct('eyeShieldWarmth', 'eyeShieldWarmthByHost', 0, 100, 0), (v) => setEyeShieldPct('eyeShieldWarmth', 'eyeShieldWarmthByHost', 0, 100, 0, v));
  wireEyeShieldValueEditor('eyeshield-grayscale-value', 0, 100, 0, () => getEyeShieldPct('eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 0, 100, 0), (v) => setEyeShieldPct('eyeShieldGrayscale', 'eyeShieldGrayscaleByHost', 0, 100, 0, v));
  const resetBtn = $('eyeshield-reset');
  if (resetBtn) resetBtn.addEventListener('click', resetEyeShieldDefaults);
}

// One-click reset of all EyeShield adjustments back to neutral (mode is left as-is).
function resetEyeShieldDefaults() {
  clearEyeShieldAdjustments();
  config.eyeShield = eyeShieldIsActive();
  paintEyeShield();
  clearTimeout(eyeShieldSaveTimer);
  eyeShieldSaveTimer = 0;
  saveConfig('EyeShield reset', injectEyeShieldActiveTab);
}

function wireEyeShieldPctRange(rangeId, globalKey, mapKey, lo, hi, dflt) {
  const range = $(rangeId);
  if (!range) return;
  range.addEventListener('input', () => setEyeShieldPct(globalKey, mapKey, lo, hi, dflt, range.value));
  range.addEventListener('change', () => {
    setEyeShieldPct(globalKey, mapKey, lo, hi, dflt, range.value);
    clearTimeout(eyeShieldSaveTimer);
    eyeShieldSaveTimer = 0;
    saveConfig('EyeShield', injectEyeShieldActiveTab);
  });
}

function setScriptTrustResult(text, color) {
  const out = $('script-trust-result');
  if (!out) return;
  out.style.display = text ? 'block' : 'none';
  out.style.color = color || 'var(--ink-faint)';
  out.textContent = text || '';
}

function renderScriptTrustList(items) {
  const box = $('script-trust-list');
  if (!box) return;
  const paint = (list) => {
    box.textContent = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'perm-row';
      const label = document.createElement('div');
      label.className = 'perm-row-label';
      label.textContent = 'No trusted script hosts yet.';
      empty.appendChild(label);
      box.appendChild(empty);
      return;
    }
    list.forEach((host) => {
      const row = document.createElement('div');
      row.className = 'perm-row';
      const label = document.createElement('div');
      label.className = 'perm-row-label';
      label.textContent = host;
      const remove = document.createElement('button');
      remove.className = 'btn';
      remove.style.cssText = 'flex:none;padding:5px 9px;font-size:10px;border:1px solid var(--wo-popup-soft-danger-line);color:var(--wo-popup-soft-danger);';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        remove.disabled = true;
        chrome.runtime.sendMessage({ kind: 'script-trust-remove', host }, (r) => { void chrome.runtime.lastError;
          if (!r || !r.ok) setScriptTrustResult((r && r.error) || 'Could not remove trusted script host.', 'var(--wo-danger)');
          else setScriptTrustResult('Removed ' + host + '.', 'var(--ink-faint)');
          renderScriptTrustList(r && r.items);
          loadJsShieldState();
        });
      });
      row.appendChild(label);
      row.appendChild(remove);
      box.appendChild(row);
    });
  };
  if (Array.isArray(items)) { paint(items); return; }
  box.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'perm-row';
  const label = document.createElement('div');
  label.className = 'perm-row-label';
  label.textContent = 'Loading trusted script hosts...';
  loading.appendChild(label);
  box.appendChild(loading);
  chrome.runtime.sendMessage({ kind: 'script-trust-list' }, (res) => { void chrome.runtime.lastError;
    paint((res && res.ok && Array.isArray(res.items)) ? res.items : []);
  });
}

function trustCurrentScriptSite() {
  activeTabHost((host) => {
    if (!host) { setScriptTrustResult('Open a normal web page first.', 'var(--ink-faint)'); return; }
    chrome.runtime.sendMessage({ kind: 'script-trust-add', host }, (res) => { void chrome.runtime.lastError;
      if (!res || !res.ok) {
        setScriptTrustResult((res && res.error) || 'Could not trust this script host.', 'var(--wo-danger)');
        return;
      }
      setScriptTrustResult('Trusted ' + res.host + ' for Smart script loading.', 'var(--wo-success)');
      renderScriptTrustList(res.items);
      loadJsShieldState();
    });
  });
}

function setDownloadTrustResult(text, color) {
  const out = $('download-trust-result');
  if (!out) return;
  out.style.display = text ? 'block' : 'none';
  out.style.color = color || 'var(--ink-faint)';
  out.textContent = text || '';
}

function renderDownloadTrustList() {
  const box = $('download-trust-list');
  if (!box) return;
  box.textContent = '';
  chrome.runtime.sendMessage({ kind: 'download-trust-list' }, (res) => {
    const items = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
    box.textContent = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'perm-row';
      const label = document.createElement('div');
      label.className = 'perm-row-label';
      label.textContent = 'No trusted download sites yet.';
      empty.appendChild(label);
      box.appendChild(empty);
      return;
    }
    items.forEach((host) => {
      const row = document.createElement('div');
      row.className = 'perm-row';
      const label = document.createElement('div');
      label.className = 'perm-row-label';
      label.textContent = host;
      const remove = document.createElement('button');
      remove.className = 'btn';
      remove.style.cssText = 'flex:none;padding:5px 9px;font-size:10px;border:1px solid var(--wo-popup-soft-danger-line);color:var(--wo-popup-soft-danger);';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        remove.disabled = true;
        chrome.runtime.sendMessage({ kind: 'download-trust-remove', host }, (r) => { void chrome.runtime.lastError;
          if (!r || !r.ok) setDownloadTrustResult((r && r.error) || 'Could not remove trusted site.', 'var(--wo-danger)');
          else setDownloadTrustResult('Removed ' + host + '.', 'var(--ink-faint)');
          renderDownloadTrustList();
        });
      });
      row.appendChild(label);
      row.appendChild(remove);
      box.appendChild(row);
    });
  });
}

function activeTabUrl(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    callback((tab && tab.url) || '');
  });
}

function trackerModeLabel(item) {
  if (!item) return 'Auto';
  if (item.mode === 'allow') return 'Allowed here';
  if (item.mode === 'block') return 'Blocked here';
  return item.state === 'learned' ? 'Auto block' : 'Learning';
}

function renderTrackerLearner() {
  const box = $('tracker-learner-list');
  const status = $('tracker-learner-status');
  if (!box || !status) return;
  box.textContent = '';
  const placeholder = document.createElement('div');
  placeholder.className = 'perm-row';
  const label = document.createElement('div');
  label.className = 'perm-row-label';
  label.textContent = 'Loading learned trackers...';
  placeholder.appendChild(label);
  box.appendChild(placeholder);

  activeTabUrl((url) => {
    chrome.runtime.sendMessage({ kind: 'tracker-learner-status', url }, (res) => {
      const err = chrome.runtime.lastError;
      const items = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
      box.textContent = '';
      if (err || !res || !res.ok) {
        status.textContent = 'Tracker learner is available on normal web pages.';
        const row = document.createElement('div');
        row.className = 'perm-row';
        const msg = document.createElement('div');
        msg.className = 'perm-row-label';
        msg.textContent = 'Open a website to manage local tracker decisions.';
        row.appendChild(msg);
        box.appendChild(row);
        return;
      }
      const learnedCount = Number(res.learnedCount || 0);
      const site = res.site ? ' for ' + res.site : '';
      status.textContent = (res.enabled === false ? 'Paused' : 'Active') + site + '. ' + learnedCount + ' tracker domain' + (learnedCount === 1 ? '' : 's') + ' learned locally.';
      if (!items.length) {
        const row = document.createElement('div');
        row.className = 'perm-row';
        const empty = document.createElement('div');
        empty.className = 'perm-row-label';
        empty.textContent = 'No tracker-like third-party requests seen for this site yet.';
        row.appendChild(empty);
        box.appendChild(row);
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'perm-row';
        const title = document.createElement('div');
        title.className = 'perm-row-label';
        const siteHits = Number(item.siteHits || 0);
        const siteText = siteHits ? siteHits + ' hit' + (siteHits === 1 ? '' : 's') + ' here' : 'manual rule';
        title.textContent = item.domain + ' - ' + trackerModeLabel(item) + ' - ' + siteText;
        const actions = document.createElement('div');
        actions.className = 'tracker-mode-buttons';
        [
          ['auto', item.state === 'learned' ? 'Auto block' : 'Auto learn', 'Auto'],
          ['allow', 'Allow this tracker on this site', 'Allow'],
          ['block', 'Block this tracker on this site', 'Block'],
        ].forEach(([value, titleText, text]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn tracker-mode-btn';
          const on = (item.mode || 'auto') === value;
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          btn.title = titleText;
          btn.textContent = text;
          btn.addEventListener('click', () => {
            if (on) return;
            row.classList.add('perm-row-saving');
            chrome.runtime.sendMessage({ kind: 'tracker-learner-set-site', url, domain: item.domain, mode: value }, (r) => {
              const msg = chrome.runtime.lastError;
              if (msg || !r || !r.ok) setSavedTick((r && r.error) || 'Tracker rule failed', true);
              else setSavedTick('Tracker rule saved', false);
              renderTrackerLearner();
            });
          });
          actions.appendChild(btn);
        });
        row.appendChild(title);
        row.appendChild(actions);
        box.appendChild(row);
      });
    });
  });
}

function trustCurrentDownloadSite() {
  activeTabHost((host) => {
    if (!host) { setDownloadTrustResult('Open a normal web page first.', 'var(--ink-faint)'); return; }
    chrome.runtime.sendMessage({ kind: 'download-trust-add', host }, (res) => { void chrome.runtime.lastError;
      if (!res || !res.ok) {
        setDownloadTrustResult((res && res.error) || 'Could not trust this site.', 'var(--wo-danger)');
        return;
      }
      setDownloadTrustResult('Trusted ' + res.host + ' for future downloads.', 'var(--wo-success)');
      renderDownloadTrustList();
    });
  });
}

$('enabled').addEventListener('change', () => {
  updateMasterState();
  reflectMasterDisable();
  const masterOn = $('enabled').checked;
  // The master switch disables the network blocker + new-page protection + new
  // notifications after the config is saved. Already-open pages can have MAIN-world
  // hooks installed, so turning the master switch off reloads all normal pages to
  // remove popup/overlay/ad/content hooks everywhere, not just the active tab.
  save(() => {
    if (masterOn) reloadActiveHttpTab();
    else reloadAllHttpTabs();
  });
});
$('all-on')?.addEventListener('click', turnEverythingOn);
$('settings-export')?.addEventListener('click', exportSettings);
$('settings-import')?.addEventListener('click', () => $('settings-import-file')?.click());
$('settings-import-file')?.addEventListener('change', (e) => {
  const file = e.target && e.target.files && e.target.files[0];
  importSettingsFromFile(file);
  try { e.target.value = ''; } catch (_) {}
});
$('js-global')?.addEventListener('change', (e) => {
  if (!$('enabled').checked) { e.target.checked = false; return; }
  setScriptShieldMode(e.target.checked ? 'lockdown' : ($('js-smart') && $('js-smart').checked ? 'smart' : 'normal'));
});
$('js-smart')?.addEventListener('change', (e) => {
  if (!$('enabled').checked || ($('js-global') && $('js-global').checked)) { e.target.checked = false; return; }
  setScriptShieldMode(e.target.checked ? 'smart' : 'normal');
});
$('js-site').addEventListener('change', (e) => {
  if (!$('enabled').checked) { e.target.checked = false; return; }
  // In Lockdown the site toggle means "allow here" (checked = allow -> block:false);
  // otherwise it means "block scripts on this site" (checked = block).
  const mode = ($('js-shield') && $('js-shield').getAttribute('data-mode')) || 'normal';
  setJsShield('site', mode === 'lockdown' ? !e.target.checked : e.target.checked);
});
$('script-trust-add-current')?.addEventListener('click', trustCurrentScriptSite);
$('save').addEventListener('click', save);
$('allowlist').addEventListener('click', allowlistCurrent);
$('sb-test-key')?.addEventListener('click', testSafeBrowsingKey);
$('vt-test-key')?.addEventListener('click', testVirusTotalKey);
$('urlhaus-test-key')?.addEventListener('click', () => setupReputationProvider('urlHaus'));
$('abuseipdb-test-key')?.addEventListener('click', () => setupReputationProvider('abuseIpDb'));
$('openphish-test-key')?.addEventListener('click', () => setupReputationProvider('openPhish'));
$('phishtank-test-key')?.addEventListener('click', () => setupReputationProvider('phishTank'));
$('whoisxml-test-key')?.addEventListener('click', () => setupReputationProvider('whoisXml'));
$('whoisxml-reputation-test-key')?.addEventListener('click', () => setupReputationProvider('whoisXmlReputation'));
$('whoisxml-threat-test-key')?.addEventListener('click', () => setupReputationProvider('whoisXmlThreatIntel'));
$('vt-scan-go')?.addEventListener('click', scanUrlWithVirusTotal);
$('vt-scan-url')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') scanUrlWithVirusTotal(); });
$('download-trust-add-current')?.addEventListener('click', trustCurrentDownloadSite);

// Auto-save the moment ANY toggle flips, so settings persist without needing a
// separate "Save" click (the #1 source of "my toggle didn't stay on"). The Save
// button remains as an explicit confirmation but is no longer required.
document.querySelectorAll('input[data-key]').forEach((el) => {
  el.addEventListener('change', () => {
    const key = el.getAttribute('data-key');
    syncConfigCheckboxes(key, el.checked);
    save(ACTIVE_TAB_RELOAD_TOGGLES.has(key) ? reloadActiveHttpTab : undefined);
    syncBreachVisibility();
    if (key === 'trackerLearner') renderTrackerLearner();
  });
});
document.querySelectorAll('[data-config-text]').forEach((el) => {
  el.addEventListener('change', save);
});

// ----- Blocklist status + manual update -----
function fmtAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
// The same instant, worded for a stat tile rather than a sentence. The health panel puts three
// tiles across a popup barely 310px wide, which leaves each value about 84px; "11 min ago" at
// 15px/800 does not fit and was being clipped to "11 min a...". Everywhere the value sits in
// prose ("Updated 11 min ago") keeps fmtAgo, where the longer wording reads better and has room.
function fmtAgoShort(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtCount(n) {
  return Number(n || 0).toLocaleString();
}
function healthNote(text, severity) {
  const row = document.createElement('div');
  row.className = 'health-note' + (severity === 'danger' ? ' is-danger' : severity === 'warn' ? ' is-warn' : '');
  const dot = document.createElement('span');
  dot.className = 'health-note-dot';
  dot.setAttribute('aria-hidden', 'true');
  const body = document.createElement('span');
  body.textContent = text;
  row.appendChild(dot);
  row.appendChild(body);
  return row;
}
function renderProtectionHealth() {
  const panel = $('protection-health-panel');
  if (!panel) return;
  const title = $('health-status-title');
  const detail = $('health-status-detail');
  const chip = $('health-status-chip');
  const active = $('health-active-count');
  const blocked = $('health-blocked-count');
  const lists = $('health-list-updated');
  const issues = $('health-issues');
  const setLevel = (level) => {
    panel.classList.toggle('is-warning', level === 'warning');
    panel.classList.toggle('is-danger', level === 'danger');
  };
  chrome.runtime.sendMessage({ kind: 'protection-health' }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      setLevel('warning');
      if (title) title.textContent = 'Protection status unavailable';
      if (detail) detail.textContent = 'Chrome has not answered yet. Open the popup again or use Verify & Repair below.';
      if (chip) chip.textContent = 'Retry';
      if (active) active.textContent = '-';
      if (blocked) blocked.textContent = '-';
      if (lists) lists.textContent = '-';
      if (issues) { issues.textContent = ''; issues.classList.add('is-visible'); issues.appendChild(healthNote('Could not read local protection health: ' + (err || 'unknown error'), 'danger')); }
      return;
    }
    const level = res.level === 'danger' ? 'danger' : res.level === 'warning' ? 'warning' : 'ok';
    const items = Array.isArray(res.needsAttention) ? res.needsAttention : [];
    setLevel(level);
    if (title) title.textContent = res.status || 'Protected';
    if (detail) detail.textContent = res.detail || 'Core shields are active.';
    if (chip) chip.textContent = level === 'danger' ? 'Review' : level === 'warning' ? 'Check' : (items.length ? 'Notes' : 'Open');
    if (active) active.textContent = fmtCount(res.activeShields || 0) + '/' + fmtCount(res.totalShields || 0);
    if (blocked) blocked.textContent = fmtCount(res.blocked24h || 0);
    if (lists) {
      const list = res.list || {};
      lists.textContent = list.updated ? fmtAgoShort(list.updated) : 'Built-in';
      const enforced = Number(list.active || 0) || Number(list.total || 0);
      lists.title = enforced ? ('Blocking ' + fmtCount(enforced) + ' domains' + (list.auxTotal ? ' plus ' + fmtCount(list.auxTotal) + ' page-list entries' : '')) : 'Built-in rules active';
    }
    if (issues) {
      issues.textContent = '';
      issues.classList.toggle('is-visible', items.length > 0);
      items.forEach((item) => {
        const severity = item && item.severity ? String(item.severity) : 'info';
        const text = item && item.text ? item.text : String(item || '');
        issues.appendChild(healthNote(text, severity));
      });
    }
  });
}
function listMetaCount(meta) {
  return Number((meta && (meta.totalCount || meta.count)) || 0);
}
function listMetaActiveCount(meta) {
  return Number((meta && (meta.activeCount || meta.activeRuleCount)) || 0);
}
function renderListMeta() {
  chrome.storage.local.get(['wardenone_list_meta', 'wardenone_aux_list_meta'], (x) => {
    const meta = x && x.wardenone_list_meta;
    const auxMeta = x && x.wardenone_aux_list_meta;
    const statusEl = $('list-status');
    const updEl = $('list-updated');
    const count = listMetaCount(meta);
    const activeCount = listMetaActiveCount(meta);
    if (count) {
      // Lead with the ACTIVELY-BLOCKED count -- that's the number that actually
      // matters (how many domains are being enforced right now). Show the larger
      // "known" total as context when the cap means not all are active.
      if (activeCount && activeCount < count) {
        statusEl.textContent = 'Blocking ' + fmtCount(activeCount) + ' domains';
      } else {
        statusEl.textContent = 'Blocking ' + fmtCount(count) + ' domains';
      }
      let line = 'Updated ' + fmtAgo(meta.updated);
      if (activeCount && activeCount < count) line += ' - ' + fmtCount(count) + ' known in feeds';
      // surface feed health: if some sources failed, the user should know coverage
      // is partial rather than seeing a silently-smaller number.
      const s = meta.sources;
      if (s && typeof s.total === 'number') {
        line += ' - ' + s.succeeded + '/' + s.total + ' feeds';
        if (s.failed > 0) line += ' (' + s.failed + ' unreachable)';
      }
      const age = meta.updated ? Date.now() - Number(meta.updated) : 0;
      if (age > 7 * 24 * 60 * 60 * 1000) {
        line += ' - stale';
        updEl.style.color = 'var(--wo-danger)';
      } else if (age > 72 * 60 * 60 * 1000) {
        line += ' - getting stale';
        updEl.style.color = 'var(--wo-warning)';
      } else {
        updEl.style.color = '';
      }
      const activeAdShield = Number(meta.activeDomainRuleCounts && meta.activeDomainRuleCounts.adshield);
      if (activeAdShield) line += ' - AdShield ' + fmtCount(activeAdShield);
      const auxCounts = (auxMeta && auxMeta.counts) || {};
      const auxTotal = Number(auxCounts.adultDomainsExtra || 0) + Number(auxCounts.grabberDomainsExtra || 0) + Number(auxCounts.trustedPaymentHostsExtra || 0);
      if (auxTotal) line += ' - page lists +' + fmtCount(auxTotal);
      updEl.textContent = line;
    } else {
      statusEl.textContent = 'Blocking ' + fmtCount(162) + ' domains (built-in)';
      updEl.textContent = 'Auto-update runs daily - tap to fetch more';
      updEl.style.color = '';
    }
  });
}
$('update-now').addEventListener('click', () => {
  const btn = $('update-now');
  const updEl = $('list-updated');
  let settled = false;
  const resetButton = () => {
    btn.textContent = 'Update now';
    btn.disabled = false;
  };
  btn.textContent = 'Updating...';
  btn.disabled = true;

  const slowTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    resetButton();
    updEl.textContent = 'Update is taking longer than expected. Try again in a moment.';
  }, 70000);

  chrome.runtime.sendMessage({ kind: 'force-list-update' }, (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(slowTimer);
    resetButton();
    if (chrome.runtime.lastError) {
      updEl.textContent = 'Update failed: ' + chrome.runtime.lastError.message;
      return;
    }

    const meta = result && (result.meta || (result.count ? result : null));
    const count = listMetaCount(meta);
    const activeCount = listMetaActiveCount(meta);
    const blocking = (activeCount && activeCount < count) ? activeCount : count;
    if (count) $('list-status').textContent = 'Blocking ' + fmtCount(blocking) + ' domains';
    if (result && result.ok && count) {
      updEl.textContent = '';
      const span = document.createElement('span');
      span.className = 'saved';
      span.textContent = 'Updated - blocking ' + fmtCount(blocking) + ' domains';
      updEl.appendChild(span);
      if (activeCount && activeCount < count) updEl.appendChild(document.createTextNode(' - ' + fmtCount(count) + ' known in feeds'));
      const activeAdShield = Number(meta.activeDomainRuleCounts && meta.activeDomainRuleCounts.adshield);
      if (activeAdShield) updEl.appendChild(document.createTextNode(' - AdShield ' + fmtCount(activeAdShield)));
      const auxMeta = result && result.supplemental && result.supplemental.meta;
      const auxCounts = (auxMeta && auxMeta.counts) || {};
      const auxTotal = Number(auxCounts.adultDomainsExtra || 0) + Number(auxCounts.grabberDomainsExtra || 0) + Number(auxCounts.trustedPaymentHostsExtra || 0);
      if (auxTotal) updEl.appendChild(document.createTextNode(' - page lists +' + fmtCount(auxTotal)));
    } else if (result && result.skipped) {
      updEl.textContent = 'Auto-update is off. Turn it on to fetch remote lists.';
    } else if (count) {
      updEl.textContent = 'Kept existing blocklist (blocking ' + fmtCount(blocking) + ' domains).';
    } else {
      updEl.textContent = (result && result.error) ? result.error + ' (built-in rules still active)' : 'No new list reachable (built-in rules still active)';
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  // Take on anything another surface changed while we were open, so the controls stop
  // showing a value that is no longer true. Fires for our own writes too, but those
  // already match `config` by then, so nothing is adopted and there is no loop.
  if (area === 'local' && changes.wardenone_config) adoptExternalConfigChange(changes.wardenone_config.newValue);
  if (area === 'local' && (changes.wardenone_list_meta || changes.wardenone_aux_list_meta)) renderListMeta();
  if (area === 'local' && (changes.wardenone_config || changes.wardenone_history || changes.wardenone_list_meta || changes.wardenone_aux_list_meta || changes.wardenone_ext_alerts || changes.wardenone_startup_report)) renderProtectionHealth();
  if (area === 'local' && (changes.wardenone_ext_alerts || changes.wardenone_ext_reviews
      || changes.wardenone_ext_reputation_custom)) loadExtensionAlerts();
  if (area === 'local' && changes.wardenone_startup_report) loadStartupReport();
  if (area === 'local' && changes.wardenone_tracker_learner) renderTrackerLearner();
});

function labelToggleControls() {
  let named = 0;
  const unnamed = [];

  // The visible name for a row's control sits in a .name (or .lbl) that is a preceding
  // SIBLING of the control, or nested inside one. Searching only backwards means a name
  // can never be pulled out of the next row down.
  const findNameFor = (anchor) => {
    let nameEl = null;
    let descEl = null;
    for (let sib = anchor.previousElementSibling; sib && !nameEl; sib = sib.previousElementSibling) {
      if (sib.classList && (sib.classList.contains('name') || sib.classList.contains('lbl'))) {
        nameEl = sib;
        break;
      }
      if (!sib.querySelector) continue;
      nameEl = sib.querySelector('.name, .lbl');
      if (nameEl) descEl = sib.querySelector('.desc');
    }
    return { nameEl, descEl };
  };

  const apply = (control, anchor, fallbackKey) => {
    if (!control || control.getAttribute('aria-labelledby') || control.getAttribute('aria-label')) return false;
    const found = findNameFor(anchor);
    if (!found.nameEl || !found.nameEl.textContent.trim()) {
      unnamed.push(control.getAttribute('data-key') || control.id || fallbackKey);
      return false;
    }
    // Prefixed so a generated id can never collide with one already in the markup.
    const base = control.id || control.getAttribute('data-key') || fallbackKey;
    if (!found.nameEl.id) found.nameEl.id = 'wo-lbl-' + base;
    control.setAttribute('aria-labelledby', found.nameEl.id);
    if (found.descEl && found.descEl.textContent.trim()) {
      if (!found.descEl.id) found.descEl.id = 'wo-desc-' + base;
      control.setAttribute('aria-describedby', found.descEl.id);
    }
    named++;
    return true;
  };

  // The 115 toggles: the checkbox is inside a text-free <label class="tg">, so the label
  // is the anchor and the name lives outside it.
  document.querySelectorAll('label.tg').forEach((label, index) => {
    apply(label.querySelector('input[type="checkbox"]'), label, 'tg-' + index);
  });

  // Everything else in a row that carries no name of its own -- the number fields for
  // buffer length, tab cap and idle minutes had neither a label nor even a placeholder,
  // so they announced as a bare spin button. They sit in the same row shape, so the same
  // backwards walk finds their name. Controls labelled directly in the markup are skipped
  // by the aria-label check in apply().
  document.querySelectorAll('.row input, .row select').forEach((control, index) => {
    if (control.type === 'checkbox' || control.type === 'radio' || control.type === 'hidden') return;
    if (control.closest('label')) return;
    apply(control, control, 'row-' + index);
  });

  return { named, unnamed };
}

initPopupScrollMemory();
initAdvancedProvidersMemory();
initEyeShield();
load();
renderUpdateGuardian();
renderListMeta();
renderProtectionHealth();

$('open-activity').addEventListener('click', (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('history.html'));
});
$('open-network').addEventListener('click', (e) => {
  e.preventDefault();
  window.open(chrome.runtime.getURL('network.html'));
});

// ----- Verify & Repair -----
// ----- SessionShield -----
let ssCurrentOrigin = null;
function runSessionScan(isAuto) {
  const btn = $('ss-scan');
  const out = $('ss-result');
  btn.disabled = true; btn.textContent = isAuto ? 'Scanning…' : 'Scanning…';
  out.style.display = 'block';
  if (!isAuto) out.textContent = '';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) {
      btn.disabled = false; btn.textContent = 'Scan this site';
      out.textContent = 'Open a normal web page (http/https) to scan it.';
      return;
    }
    try { ssCurrentOrigin = new URL(tab.url).origin; } catch { ssCurrentOrigin = null; }
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, world: 'MAIN', func: () => window.__WO_SESSION__ || null },
      (res) => {
        btn.disabled = false; btn.textContent = 'Re-scan';
        const data = res && res[0] && res[0].result;
        // also pull the REAL cookie flags from the background (cookies API), then
        // render the report card + grade once we have both.
        chrome.runtime.sendMessage({ kind: 'cookie-audit', url: tab.url }, (cookieAudit) => { void chrome.runtime.lastError;
          renderSession(out, data, (cookieAudit && cookieAudit.ok) ? cookieAudit : null);
        });
      }
    );
  });
}

// Compute an overall Session Security grade + risk from real signals.
//
// The previous version got two things wrong, and both made it dishonest:
//
//  1. Every finding counted the same. A JWT sitting in localStorage and a
//     40-character analytics blob in a URL cost identical points, even though
//     one is a credential and the other is how half the web passes page state.
//     Google Search scored D on the strength of ved= and gs_lp=.
//  2. It could only ever subtract. A site doing everything right -- HttpOnly,
//     Secure and SameSite on every session cookie -- landed on exactly the same
//     100 as a site with no session at all. There was no way to be good, only
//     ways to be unpunished, and the cookie counts we already collect went
//     completely unused.
//
// So findings now carry a confidence from the scanner, penalties scale with that
// confidence AND with where the token lives, pages that actually take credentials
// weigh heavier, and real cookie hygiene earns points back.
function computeScore(data, cookies) {
  const reasons = [];
  const credits = [];
  const findings = (data && Array.isArray(data.findings)) ? data.findings : [];
  // Findings from before this scanner shipped have no confidence; a JWT is still
  // unmistakable, everything else is treated as the weak signal it is.
  const confOf = (f) => f.confidence || (f.jwt && !f.jwt.malformed ? 'high' : 'low');
  const isUrl = (f) => /^URL/.test(f.where || '');

  const ck = cookies || null;
  const sessionCookies = ck ? (ck.sessionLike || 0) : 0;
  const weakCookies = (ck && Array.isArray(ck.weak)) ? ck.weak.length : 0;
  const solidFindings = findings.filter((f) => confOf(f) !== 'low');

  // Grading "session security" on a page with no session is how a logged-out
  // news site ends up wearing a scary letter. Say so instead.
  const hasSession = sessionCookies > 0 || solidFindings.length > 0;
  const sensitive = !!(data && data.isSensitivePage);

  let score = 100;

  if (!data || !data.onHttps) { score -= 45; reasons.push('Connection is not HTTPS'); }

  // A token in the URL is the worst case: it lands in browser history, in the
  // Referer header, and in every link the user ever pastes to someone. In storage
  // it is at least confined to script on that origin.
  const WEIGHT = {
    high: { url: 30, store: 12 },
    medium: { url: 16, store: 6 },
    low: { url: 0, store: 2 },
  };
  let urlPenalty = 0, storePenalty = 0, urlHits = 0, storeHits = 0;
  findings.forEach((f) => {
    const w = WEIGHT[confOf(f)] || WEIGHT.low;
    if (isUrl(f)) { if (w.url) { urlPenalty += w.url; urlHits++; } }
    else if (w.store) { storePenalty += w.store; storeHits++; }
  });
  urlPenalty = Math.min(40, urlPenalty);
  // A session in script-readable storage is a real weakness and also how almost
  // every modern app is built. At 24 it alone dropped an otherwise-clean site two
  // whole grades, which said "you are riskier than you are" about most of the web
  // and left the letter unable to distinguish an ordinary SPA from a careless one.
  // The URL cap stays 40: putting a credential in the URL really is worse, because
  // it leaves the origin entirely -- into history, the Referer header, and every
  // link anyone pastes. Keeping the gap between the two is the point.
  storePenalty = Math.min(16, storePenalty);
  // Mishandling a credential on the page that asks for one is worse than doing it
  // on a blog, so the same evidence costs more there.
  if (sensitive) {
    urlPenalty = Math.round(urlPenalty * 1.4);
    storePenalty = Math.round(storePenalty * 1.3);
  }
  if (urlHits) {
    score -= urlPenalty;
    reasons.push(urlHits + ' credential-shaped value(s) in the URL' + (sensitive ? ' on a sign-in page' : ''));
  }
  if (storeHits) {
    score -= storePenalty;
    reasons.push(storeHits + ' token(s) readable by scripts');
  }

  const jwts = findings.filter((f) => f.jwt && !f.jwt.malformed);
  if (jwts.some((f) => f.jwt.longLived)) { score -= 8; reasons.push('Token stays valid for more than 7 days'); }
  if (jwts.some((f) => f.jwt.exp == null)) { score -= 6; reasons.push('Token has no expiry'); }
  if (jwts.some((f) => f.jwt.expired)) { score -= 3; reasons.push('An expired token is still stored'); }

  // Cookie hygiene is the one place a site can EARN points, because these flags
  // are unambiguous: either the browser is told to protect the cookie or it is not.
  if (ck && ck.total > 0 && sessionCookies > 0) {
    if (weakCookies) {
      // Judge WHICH flag is missing rather than counting cookies. Missing
      // HttpOnly means any injected script can read the session outright;
      // missing Secure means it can travel in clear text. They are different
      // failures and a flat per-cookie number priced both too cheaply -- two
      // cookies with neither flag used to still earn a B.
      let httpOnlyPenalty = 0;
      let securePenalty = 0;
      const missing = { httpOnly: 0, secure: 0 };
      ck.weak.forEach((c) => {
        if (!c.httpOnly) { httpOnlyPenalty += 9; missing.httpOnly++; }
        if (!c.secure) { securePenalty += 7; missing.secure++; }
      });
      // "A script on this origin can read the session" is ONE failure however many
      // places the evidence turns up. A session sitting in localStorage AND in a
      // non-HttpOnly cookie is usually the same token, so it was being charged
      // twice for one design decision. Charge it once, at the higher of the two.
      // Missing Secure is a genuinely different failure -- the cookie travels in
      // clear text -- so that still adds on top.
      const alreadyCharged = Math.min(Math.min(34, httpOnlyPenalty), storePenalty);
      score -= Math.min(34, Math.min(34, httpOnlyPenalty) - alreadyCharged + securePenalty);
      if (missing.httpOnly) reasons.push(missing.httpOnly + ' session cookie(s) readable by scripts (no HttpOnly)');
      if (missing.secure) reasons.push(missing.secure + ' session cookie(s) can be sent unencrypted (no Secure)');
    } else {
      score += 6;
      credits.push('Session cookies are HttpOnly and Secure');
    }
    const sameSiteRatio = (ck.sameSite || 0) / ck.total;
    if (sameSiteRatio < 0.5) { score -= 6; reasons.push('Most cookies carry no SameSite restriction'); }
    else if (sameSiteRatio >= 0.9) { score += 3; credits.push('Cookies set SameSite'); }
  }

  const tps = (data && Array.isArray(data.thirdPartyScripts)) ? data.thirdPartyScripts.length : 0;
  if (sensitive && tps > 2) {
    score -= Math.min(12, (tps - 2) * 3);
    reasons.push(tps + ' third-party scripts on a sign-in page');
  }

  score = Math.max(0, Math.min(100, score));

  // A letter on its own reads as an accusation. Every grade leaves here with at
  // least one line explaining itself, so the view never has to invent one.
  if (!reasons.length && !credits.length) {
    credits.push(hasSession ? 'Nothing exposed that we can see' : 'No sign-in detected on this page');
  }

  // Whatever else it does right, a page carrying a live session over plain HTTP
  // is readable by anyone on the network, so it cannot be called low risk.
  let capped = false;
  if (hasSession && data && !data.onHttps && score > 45) { score = 45; capped = true; }

  let grade, risk, riskColor;
  if (score >= 90) { grade = 'A'; risk = 'Low Risk'; riskColor = 'var(--wo-success)'; }
  else if (score >= 78) { grade = 'B'; risk = 'Low Risk'; riskColor = 'var(--wo-success)'; }
  else if (score >= 65) { grade = 'C'; risk = 'Medium Risk'; riskColor = 'var(--wo-warning)'; }
  else if (score >= 50) { grade = 'D'; risk = 'Medium Risk'; riskColor = 'var(--wo-warning)'; }
  else { grade = 'F'; risk = 'High Risk'; riskColor = 'var(--wo-danger)'; }
  if (!hasSession && score >= 78) { risk = 'No sign-in detected'; riskColor = 'var(--wo-popup-neutral-risk)'; }

  return { score, grade, risk, riskColor, reasons, credits, hasSession, capped };
}

function gradeColor(g) {
  return { A: 'var(--wo-popup-grade-a)', B: 'var(--wo-popup-grade-b)', C: 'var(--wo-popup-grade-c)', D: 'var(--wo-popup-grade-d)', F: 'var(--wo-popup-grade-f)' }[g] || 'var(--wo-violet)';
}

function riskFill(risk) {
  if (/high|danger/i.test(String(risk || ''))) return 'var(--wo-popup-risk-high)';
  if (/medium|moderate|elevated/i.test(String(risk || ''))) return 'var(--wo-popup-risk-medium)';
  return 'var(--wo-popup-risk-low)';
}

// ----- Update Guardian: detect browser + estimate if it looks outdated -----
// HONEST LIMITS: an extension can't fetch the true "current" version, and can't
// update the browser. So we (1) detect name + major version, (2) ESTIMATE the
// expected current Chromium major from today's date using Chrome's steady ~4-week
// release cadence, and (3) only warn when clearly behind (big margin, so normal
// lag never cries wolf). The update button always works regardless.
function detectBrowser() {
  const uaData = navigator.userAgentData;
  let name = 'Browser', major = 0, isChromium = false;
  // Prefer userAgentData.brands (modern, structured, not spoofed by UA string)
  if (uaData && Array.isArray(uaData.brands)) {
    isChromium = uaData.brands.some((b) => /Chromium/i.test(b.brand));
    // pick the most specific brand (skip "Not.A/Brand" placeholders)
    const order = ['Microsoft Edge', 'Brave', 'Opera', 'Vivaldi', 'Google Chrome', 'Chromium'];
    for (const want of order) {
      const hit = uaData.brands.find((b) => b.brand === want);
      if (hit) { name = want; major = parseInt(hit.version, 10) || 0; break; }
    }
    if (major === 0) {
      const chrom = uaData.brands.find((b) => /Chromium/i.test(b.brand));
      if (chrom) { major = parseInt(chrom.version, 10) || 0; name = 'Chromium'; }
    }
  }
  // Fallback / refinement via UA string (also catches Firefox, Safari)
  const ua = navigator.userAgent || '';
  if (name === 'Browser' || major === 0) {
    let m;
    if ((m = ua.match(/Edg\/(\d+)/))) { name = 'Microsoft Edge'; major = +m[1]; isChromium = true; }
    else if ((m = ua.match(/OPR\/(\d+)/))) { name = 'Opera'; major = +m[1]; isChromium = true; }
    else if (/Brave/i.test(ua) && (m = ua.match(/Chrome\/(\d+)/))) { name = 'Brave'; major = +m[1]; isChromium = true; }
    else if ((m = ua.match(/Vivaldi\/(\d+)/))) { name = 'Vivaldi'; major = +m[1]; isChromium = true; }
    else if ((m = ua.match(/Firefox\/(\d+)/))) { name = 'Firefox'; major = +m[1]; }
    else if ((m = ua.match(/Version\/(\d+).*Safari/))) { name = 'Safari'; major = +m[1]; }
    else if ((m = ua.match(/Chrome\/(\d+)/))) { name = 'Google Chrome'; major = +m[1]; isChromium = true; }
  }
  return { name, major, isChromium };
}

// Estimate the expected current Chromium major version from today's date.
// Anchor: Chrome 126 reached stable ~2024-06-11. Cadence: ~4 weeks per major.
function expectedChromiumMajor() {
  const anchorVersion = 126;
  const anchorDate = Date.UTC(2024, 5, 11); // 2024-06-11
  const weeks = (Date.now() - anchorDate) / (7 * 24 * 3600 * 1000);
  return anchorVersion + Math.floor(weeks / 4);
}

// The update page differs per browser.
function updatePageFor(name) {
  switch (name) {
    case 'Microsoft Edge': return 'edge://settings/help';
    case 'Brave': return 'brave://settings/help';
    case 'Opera': return 'opera://settings/help';
    case 'Vivaldi': return 'vivaldi://settings/help';
    case 'Firefox': return null; // about:preferences can't be opened by extensions reliably
    case 'Safari': return null;
    default: return 'chrome://settings/help';
  }
}

function renderUpdateGuardian() {
  const nameEl = $('ug-name');
  const noteEl = $('ug-note');
  const btn = $('ug-btn');
  if (!nameEl) return;
  const b = detectBrowser();
  nameEl.textContent = b.name + (b.major ? ' ' + b.major : '');
  let outdated = false;
  if (b.isChromium && b.major > 0) {
    const expected = expectedChromiumMajor();
    // only warn when clearly behind (>= 4 majors ~ roughly 4 months) so normal
    // staged-rollout lag doesn't trigger a false alarm.
    if (expected - b.major >= 4) outdated = true;
  }
  if (outdated) {
    noteEl.textContent = 'Your browser version looks older than expected for today. Keeping it updated protects you from known security bugs.';
    noteEl.style.color = 'var(--wo-danger)';
    nameEl.style.color = 'var(--wo-danger)';
  } else if (b.major > 0) {
    noteEl.textContent = 'Looks current. It\'s still worth checking now and then — updates patch security bugs.';
    noteEl.style.color = 'var(--ink-faint)';
  } else {
    noteEl.textContent = 'Keeping your browser updated protects you from known security bugs.';
    noteEl.style.color = 'var(--ink-faint)';
  }
  // wire the button to the right update page
  const page = updatePageFor(b.name);
  if (page) {
    btn.style.display = '';
    btn.onclick = () => chrome.tabs.create({ url: page });
  } else {
    // Firefox/Safari: can't open their settings page from here; guide instead
    btn.style.display = '';
    btn.textContent = 'How to update ' + b.name;
    btn.onclick = () => {
      noteEl.textContent = b.name === 'Firefox'
        ? 'Open the menu → Help → About Firefox to check for updates.'
        : 'Update ' + b.name + ' from your system settings or app store.';
      noteEl.style.color = 'var(--ink-soft)';
    };
  }
}

// Remove a single exposed token from the page's storage. Works for
// localStorage / sessionStorage (by key) and window.name. Cookies and URL
// tokens can't be safely removed key-by-key from here (cookies may be HttpOnly;
// URL tokens require a navigation) -- those route to sign-out / Emergency logout.
function clearFinding(f, rowEl, btnEl) {
  if (btnEl) { btnEl.disabled = true; }
  const markCleared = (ok) => finishClear(ok, rowEl, btnEl, f);

  // A readable cookie is not reachable from page script the way storage is --
  // deleting it has to go through the cookies API in the background.
  if (/^cookie/i.test(f.where)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) { markCleared(false); return; }
      chrome.runtime.sendMessage({ kind: 'clear-exposed-tokens', url, items: [{ where: f.where, key: f.key }] }, (r) => {
        void chrome.runtime.lastError;
        markCleared(!!(r && r.ok && r.cleared));
      });
    });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (where, key) => {
        try {
          if (where === 'localStorage') localStorage.removeItem(key);
          else if (where === 'sessionStorage') sessionStorage.removeItem(key);
          else if (where === 'window.name') { try { window.name = ''; } catch (_) {} }
          else if (/^URL/.test(where)) {
            // The value is already in history and in any referrer already sent --
            // that cannot be recalled. What this does is stop it being handed to
            // every future request and every link the user copies from here.
            const u = new URL(location.href);
            if (/hash/i.test(where)) {
              const h = new URLSearchParams(u.hash.replace(/^#/, ''));
              h.delete(key);
              u.hash = h.toString() ? '#' + h.toString() : '';
            } else {
              u.searchParams.delete(key);
            }
            history.replaceState(null, '', u.toString());
          }
          return true;
        } catch (_) { return false; }
      },
      args: [f.where, f.key],
    }, (res) => {
      markCleared(!!(res && res[0] && res[0].result));
    });
  });
}

function finishClear(ok, rowEl, btnEl, f) {
  if (ok && rowEl) {
    // collapse the row to show it's gone
    rowEl.style.transition = 'opacity .2s';
    rowEl.style.opacity = '0.45';
    const done = document.createElement('div');
    done.style.cssText = 'font-size:9.5px;color:var(--wo-success);font-weight:700;margin-top:4px;';
    // A URL value is not deleted, it is stopped from travelling any further --
    // history and any referrer already sent are gone for good.
    done.textContent = (f && /^URL/.test(f.where)) ? 'Removed from the address bar' : 'Removed';
    rowEl.appendChild(done);
    if (btnEl) btnEl.style.display = 'none';
  } else if (btnEl) {
    btnEl.disabled = false;
    btnEl.title = 'Could not remove (page may block it)';
  }
}

// The only real way to hide a credential from page script. HttpOnly is enforced
// by the browser: document.cookie stops returning the value, but the cookie is
// still attached to requests, so the site keeps working and injected script has
// nothing to steal.
//
// It cannot be done for localStorage, and no amount of cleverness changes that:
// the site's own auth code and an injected script run in the same origin with
// the same APIs, so anything that hides the token from one hides it from both.
// For storage the honest defence is the one already shipped -- watch where the
// token is being SENT, not who read it.
function hardenSiteCookies(btnEl, statusEl) {
  if (!confirm('Hide this site\'s session cookies from page scripts?\n\n'
    + 'They keep working — the browser still sends them — but scripts on the page can no longer read them.\n\n'
    + 'CSRF tokens are skipped, because sites are meant to read those.\n'
    + 'The site can undo this the next time it sets the cookie.')) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Hiding…'; }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs && tabs[0] && tabs[0].url;
    chrome.runtime.sendMessage({ kind: 'harden-site-cookies', url }, (r) => {
      void chrome.runtime.lastError;
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Hide session cookies from scripts'; }
      if (!statusEl) return;
      statusEl.style.display = 'block';
      if (!r || !r.ok) {
        statusEl.style.color = 'var(--wo-danger)';
        statusEl.textContent = (r && r.error) || 'Could not change the cookies.';
        return;
      }
      const bits = [];
      if (r.hardened) bits.push(r.hardened + ' cookie' + (r.hardened > 1 ? 's' : '') + ' now hidden from scripts');
      if (r.skippedCsrf) bits.push(r.skippedCsrf + ' CSRF cookie' + (r.skippedCsrf > 1 ? 's' : '') + ' left alone on purpose');
      if (!r.hardened && !r.skippedCsrf) bits.push('Nothing to change — no readable session cookies here.');
      statusEl.style.color = r.hardened ? 'var(--wo-success)' : 'var(--ink-faint)';
      statusEl.textContent = bits.join(' · ');
      if (r.hardened) setTimeout(() => runSessionScan(true), 500);
    });
  });
}

function clearAllStorageTokens(btnEl) {
  if (!confirm('Remove all tokens stored in this site\'s local and session storage?\n\nThis may sign you out of the site. Reload the page afterward.')) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Clearing…'; }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    // re-read the current findings from the page and remove the storage ones by key
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        try {
          const s = (window.__WO_SESSION__ && window.__WO_SESSION__.findings) || [];
          let n = 0;
          for (const f of s) {
            if (f.where === 'localStorage' && f.key) { localStorage.removeItem(f.key); n++; }
            else if (f.where === 'sessionStorage' && f.key) { sessionStorage.removeItem(f.key); n++; }
            else if (f.where === 'window.name') { try { window.name = ''; n++; } catch (_) {} }
          }
          return n;
        } catch (_) { return 0; }
      },
    }, (res) => {
      const n = (res && res[0] && res[0].result) || 0;
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = n > 0 ? ('Removed ' + n + ' token' + (n > 1 ? 's' : '') + ' — reload page') : 'Nothing to remove';
        btnEl.style.color = 'var(--wo-success)';
        btnEl.style.borderColor = 'rgba(46,158,91,.4)';
      }
      // re-run the scan to refresh the list
      setTimeout(() => runSessionScan(true), 400);
    });
  });
}
$('ss-scan').addEventListener('click', () => runSessionScan(false));
// Auto-scan the active tab when the popup opens, so the JWT / token / cookie
// findings are visible immediately instead of hidden behind a button press.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const t = tabs[0];
  if (t && /^https?:/.test(t.url || '')) runSessionScan(true);
});

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((key) => el.setAttribute(key, attrs[key]));
  return el;
}
function svgIcon(size) {
  return svgEl('svg', { width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none' });
}
function makeChevronIcon(size) {
  const svg = svgIcon(size || 14);
  svg.appendChild(svgEl('path', { d: 'M9 6l6 6-6 6', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
function makeCheckCircleIcon(size) {
  const svg = svgIcon(size || 18);
  svg.setAttribute('style', 'flex:none;');
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9', stroke: 'var(--wo-success)', 'stroke-width': '2' }));
  svg.appendChild(svgEl('path', { d: 'M8.5 12.2l2.4 2.4 4.6-5', stroke: 'var(--wo-success)', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
function makeTrashIcon(size) {
  const svg = svgIcon(size || 12);
  svg.appendChild(svgEl('path', { d: 'M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
function makeWarnIcon(size) {
  const svg = svgIcon(size || 11);
  svg.setAttribute('style', 'flex:none;');
  svg.appendChild(svgEl('path', { d: 'M12 4l9 16H3l9-16z', stroke: 'var(--wo-danger)', 'stroke-width': '2', 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl('path', { d: 'M12 10v4M12 17v.4', stroke: 'var(--wo-danger)', 'stroke-width': '2', 'stroke-linecap': 'round' }));
  return svg;
}
function makeFindingIcon(where) {
  const svg = svgIcon(14);
  if (/URL/.test(where)) {
    svg.appendChild(svgEl('path', { d: 'M9 15l6-6M10.5 7.5l1-1a3.5 3.5 0 015 5l-1 1M13.5 16.5l-1 1a3.5 3.5 0 01-5-5l1-1', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
  } else if (/cookie/i.test(where)) {
    svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '8.5', stroke: 'currentColor', 'stroke-width': '1.8' }));
    svg.appendChild(svgEl('circle', { cx: '10', cy: '9.5', r: '1', fill: 'currentColor' }));
    svg.appendChild(svgEl('circle', { cx: '14.5', cy: '12', r: '1', fill: 'currentColor' }));
    svg.appendChild(svgEl('circle', { cx: '10.5', cy: '14.5', r: '1', fill: 'currentColor' }));
  } else if (/storage/i.test(where)) {
    svg.appendChild(svgEl('ellipse', { cx: '12', cy: '6.5', rx: '7', ry: '2.8', stroke: 'currentColor', 'stroke-width': '1.8' }));
    svg.appendChild(svgEl('path', { d: 'M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11', stroke: 'currentColor', 'stroke-width': '1.8' }));
    svg.appendChild(svgEl('path', { d: 'M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8', stroke: 'currentColor', 'stroke-width': '1.8' }));
  } else {
    svg.appendChild(svgEl('rect', { x: '5', y: '10.5', width: '14', height: '9', rx: '2', stroke: 'currentColor', 'stroke-width': '1.8' }));
    svg.appendChild(svgEl('path', { d: 'M8 10.5V8a4 4 0 018 0v2.5', stroke: 'currentColor', 'stroke-width': '1.8' }));
  }
  return svg;
}

function renderSession(out, data, cookies) {
  out.textContent = '';
  if (!data) {
    out.appendChild(makeLine('SessionShield is off, or this page hasn\'t finished loading. Turn it on above and reload the page.', 'var(--ink-faint)'));
    return;
  }

  // ---- report card: overall grade + risk level (top of the results) ----
  const sc = computeScore(data, cookies);
  const card = document.createElement('div');
  card.style.cssText = 'display:flex;align-items:center;gap:13px;padding:12px 13px;border-radius:13px;margin-bottom:10px;background:var(--wo-card-gradient);border:1px solid var(--line-2);';
  const badge = document.createElement('div');
  badge.style.cssText = 'flex:none;width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-family:var(--display,"Quicksand");font-weight:700;font-size:26px;color:var(--wo-on-brand);background:' + gradeColor(sc.grade) + ';box-shadow:var(--wo-shadow-soft);';
  badge.textContent = sc.grade;
  card.appendChild(badge);
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';
  const t1 = document.createElement('div');
  t1.style.cssText = 'font-family:var(--display,"Quicksand");font-weight:700;font-size:13px;color:var(--ink);';
  t1.textContent = 'Session Security: ' + sc.grade;
  info.appendChild(t1);
  const t2 = document.createElement('div');
  t2.style.cssText = 'font-weight:700;font-size:11.5px;margin-top:2px;color:' + sc.riskColor + ';';
  t2.textContent = sc.risk;
  info.appendChild(t2);
  // Say what the site did WELL, not only what it got wrong. A grade with no
  // explanation reads as an accusation; this is the difference between "D" and
  // "D, because your session token is in the address bar".
  const why = (sc.reasons && sc.reasons.length) ? sc.reasons[0] : (sc.credits[0] || '');
  const t3 = document.createElement('div');
  t3.style.cssText = 'font-size:10.5px;margin-top:3px;color:var(--ink-faint);line-height:1.4;';
  t3.textContent = sc.capped ? 'Signed in over plain HTTP — anyone on this network can read it' : why;
  info.appendChild(t3);
  card.appendChild(info);
  out.appendChild(card);

  // a compact "report card" list of the key facts
  const facts = document.createElement('div');
  facts.style.cssText = 'background:var(--wo-surface-wash);border-radius:10px;padding:9px 11px;margin-bottom:10px;font-size:11px;line-height:1.7;';
  const jwtFound = data.findings && data.findings.some((f) => f.jwt);
  const storedIn = data.findings && data.findings.length ? Array.from(new Set(data.findings.map((f) => f.where))).slice(0, 3).join(', ') : '—';
  const cookieVerdict = !cookies ? 'not checked'
    : (cookies.sessionLike === 0 ? 'no session cookies'
      : (cookies.weak && cookies.weak.length ? cookies.weak.length + ' weak' : 'good (HttpOnly + Secure)'));
  const addFact = (label, value, color) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;justify-content:space-between;gap:12px;';
    const l = document.createElement('span'); l.style.cssText = 'color:var(--ink-faint);'; l.textContent = label;
    const v = document.createElement('span'); v.style.cssText = 'font-weight:700;color:' + (color || 'var(--ink)') + ';text-align:right;'; v.textContent = value;
    r.appendChild(l); r.appendChild(v); facts.appendChild(r);
  };
  addFact('Connection', data.onHttps ? 'HTTPS' : 'HTTP (insecure)', data.onHttps ? 'var(--wo-success)' : 'var(--wo-danger)');
  addFact('JWT found', jwtFound ? 'Yes' : 'No');
  addFact('Tokens stored in', storedIn);
  addFact('Cookie security', cookieVerdict, (cookies && cookies.weak && cookies.weak.length) ? 'var(--wo-danger)' : (cookies && cookies.sessionLike ? 'var(--wo-success)' : null));
  if (data.isSensitivePage) addFact('3rd-party scripts', String((data.thirdPartyScripts || []).length));
  addFact('Risk', sc.risk, sc.riskColor);
  out.appendChild(facts);

  // ---- detail section below the card ----
  out.appendChild(makeLine(data.readableCookieCount + ' cookie(s) readable by scripts. (HttpOnly cookies are correctly invisible to scripts — that\'s the safe state.)', 'var(--ink-soft)'));
  if (cookies && cookies.weak && cookies.weak.length) {
    out.appendChild(makeLine('Session cookies missing protection:', 'var(--wo-danger)', true));
    cookies.weak.forEach((w) => {
      const miss = [];
      if (!w.httpOnly) miss.push('not HttpOnly');
      if (!w.secure) miss.push('not Secure');
      out.appendChild(makeLine('• ' + w.name + ' — ' + miss.join(', '), 'var(--ink-soft)'));
    });
  }

  // token findings
  if (!data.tokenCount) {
    const ok = document.createElement('div');
    ok.style.cssText = 'display:flex;align-items:center;gap:9px;margin-top:4px;padding:11px 12px;border-radius:11px;background:var(--wo-success-bg);border:1px solid var(--wo-success-line);';
    ok.appendChild(makeCheckCircleIcon(18));
    const okt = document.createElement('span');
    okt.style.cssText = 'font-weight:700;font-size:12px;color:var(--wo-success);';
    okt.textContent = 'No exposed login tokens found';
    ok.appendChild(okt);
    out.appendChild(ok);
  } else {
    // collapsible token list
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:4px;';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'btn';
    head.setAttribute('aria-expanded', 'false');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;';
    const arrow = document.createElement('span');
    arrow.style.cssText = 'flex:none;color:var(--ink-soft);display:flex;transition:transform .2s ease;';
    arrow.appendChild(makeChevronIcon(14));
    head.appendChild(arrow);
    const htxt = document.createElement('span');
    htxt.style.cssText = 'flex:1;';
    htxt.textContent = 'Tokens exposed to scripts';
    head.appendChild(htxt);
    const chip = document.createElement('span');
    chip.style.cssText = 'flex:none;font-size:10.5px;font-weight:700;color:var(--wo-on-brand);background:var(--wo-popup-soft-danger-solid);border-radius:10px;padding:1px 8px;';
    chip.textContent = String(data.tokenCount);
    head.appendChild(chip);

    const body = document.createElement('div');
    body.hidden = true;
    body.style.cssText = 'padding-top:2px;';

    head.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      arrow.style.transform = open ? 'rotate(90deg)' : '';
    });

    section.appendChild(head);
    section.appendChild(body);
    out.appendChild(section);

    // location -> short label
    const LOC = {
      localStorage:   { label: 'Local Storage',   color: 'var(--wo-text-soft)' },
      sessionStorage: { label: 'Session Storage', color: 'var(--wo-text-soft)' },
      'window.name':  { label: 'window.name',     color: 'var(--wo-warning)' },
    };

    data.findings.forEach((f, idx) => {
      const inUrl = /URL/.test(f.where);
      const j = f.jwt;
      // risk accent: URL = red, expired/long-lived JWT = amber, else neutral lilac
      let accent = 'var(--wo-line-strong)';
      if (inUrl) accent = 'var(--wo-danger)';
      else if (j && (j.expired || j.longLived)) accent = 'var(--wo-warning)';
      // Everything the scan can find, it can now act on. Cookies go through the
      // cookies API, URL values are stripped from the address bar. Previously
      // only storage had a button, which meant the two most exposed places -- a
      // readable cookie and the URL itself -- were the two you could not clear.
      const canClear = /storage/i.test(f.where) || /window\.name/.test(f.where)
        || /^cookie/i.test(f.where) || /^URL/.test(f.where);

      const row = document.createElement('div');
      row.style.cssText = 'position:relative;margin:7px 0 0;padding:10px 12px 10px 15px;background:var(--wo-surface-raised);border-radius:12px;box-shadow:0 1px 6px rgba(140,70,175,.07);';

      // left accent bar (rounded)
      const stripe = document.createElement('div');
      stripe.style.cssText = 'position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;background:' + accent + ';';
      row.appendChild(stripe);

      // header row: icon + location label, with a clear (x) button on the right
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;align-items:center;gap:7px;';
      const ic = document.createElement('span');
      ic.style.cssText = 'flex:none;color:' + accent + ';display:flex;';
      ic.appendChild(makeFindingIcon(f.where));
      top.appendChild(ic);
      const loc = document.createElement('span');
      loc.style.cssText = 'font-weight:700;font-size:11.5px;color:var(--ink);flex:none;';
      loc.textContent = (LOC[f.where] && LOC[f.where].label) || f.where;
      top.appendChild(loc);
      if (f.key && f.key !== 'window.name') {
        const key = document.createElement('span');
        key.style.cssText = 'font-size:10px;color:var(--ink-faint);font-family:ui-monospace,monospace;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        key.textContent = f.key;
        top.appendChild(key);
      } else {
        const sp = document.createElement('span'); sp.style.flex = '1'; top.appendChild(sp);
      }
      // clear button (only where we can actually remove it: storage / window.name)
      if (canClear) {
        const clr = document.createElement('button');
        clr.title = 'Remove this token from the site';
        clr.style.cssText = 'flex:none;border:none;background:var(--wo-popup-soft-danger-bg);color:var(--wo-popup-soft-danger);width:22px;height:22px;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;';
        clr.appendChild(makeTrashIcon(12));
        clr.addEventListener('click', () => clearFinding(f, row, clr));
        top.appendChild(clr);
      }
      row.appendChild(top);

      // masked token (smaller, lighter)
      const prev = document.createElement('div');
      prev.style.cssText = 'font-family:ui-monospace,monospace;font-size:10px;color:var(--ink-faint);margin-top:4px;';
      prev.textContent = f.preview;
      row.appendChild(prev);

      // JWT metadata as small tags
      if (j) {
        const tagWrap = document.createElement('div');
        tagWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;';
        const mkTag = (text, bg, fg) => {
          const t = document.createElement('span');
          t.style.cssText = 'font-size:9px;font-weight:700;border-radius:5px;padding:2px 6px;background:' + bg + ';color:' + fg + ';letter-spacing:.02em;';
          t.textContent = text;
          return t;
        };
        tagWrap.appendChild(mkTag('JWT', 'rgba(139,63,176,.12)', 'var(--wo-brand-text)'));
        if (j.malformed) tagWrap.appendChild(mkTag('unreadable', 'var(--wo-surface-muted)', 'var(--wo-text-soft)'));
        else {
          if (j.expired === true) tagWrap.appendChild(mkTag('EXPIRED', 'rgba(214,90,122,.14)', 'var(--wo-danger)'));
          else if (j.exp) tagWrap.appendChild(mkTag('expires ' + new Date(j.exp * 1000).toLocaleDateString(), 'var(--wo-surface-muted)', 'var(--wo-text-soft)'));
          if (j.longLived) tagWrap.appendChild(mkTag('LONG-LIVED', 'rgba(207,155,74,.16)', 'var(--wo-warning)'));
          if (j.iss) tagWrap.appendChild(mkTag(j.iss, 'var(--wo-surface-muted)', 'var(--wo-text-soft)'));
        }
        row.appendChild(tagWrap);
      }

      // URL exposure warning
      if (inUrl) {
        const warn = document.createElement('div');
        warn.style.cssText = 'display:flex;align-items:center;gap:5px;color:var(--wo-danger);font-size:9.5px;font-weight:600;margin-top:6px;';
        warn.appendChild(makeWarnIcon(11));
        const wt = document.createElement('span');
        wt.textContent = 'Exposed in the URL — can leak via history or sharing';
        warn.appendChild(wt);
        row.appendChild(warn);
      }
      body.appendChild(row);
    });

    // "clear all removable tokens" action
    const removable = data.findings.filter((f) => /storage/i.test(f.where) || /window\.name/.test(f.where));
    if (removable.length) {
      const clrAll = document.createElement('button');
      clrAll.className = 'btn';
      clrAll.style.cssText = 'width:100%;margin-top:9px;font-size:11.5px;border:1px solid var(--wo-popup-soft-danger-line);color:var(--wo-popup-soft-danger);';
      clrAll.textContent = 'Clear ' + removable.length + ' removable token' + (removable.length > 1 ? 's' : '') + ' from storage';
      clrAll.addEventListener('click', () => clearAllStorageTokens(clrAll));
      body.appendChild(clrAll);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:9.5px;color:var(--ink-faint);margin-top:5px;line-height:1.5;';
      note.textContent = 'Removes tokens stored in local/session storage, which may sign you out. Cookies and URL values have their own button on each row.';
      body.appendChild(note);
    }

    // Hiding beats clearing: clearing a session signs you out, hiding it leaves
    // you signed in. Only offered when there is actually a readable cookie to
    // hide, because it is the one place where hiding is possible at all.
    const readableCookies = data.findings.filter((f) => /^cookie/i.test(f.where));
    if (readableCookies.length && data.onHttps) {
      const harden = document.createElement('button');
      harden.className = 'btn';
      harden.style.cssText = 'width:100%;margin-top:9px;font-size:11.5px;border:1px solid var(--wo-line-strong);color:var(--wo-brand-text);';
      harden.textContent = 'Hide session cookies from scripts';
      const hstatus = document.createElement('div');
      hstatus.style.cssText = 'display:none;font-size:10px;margin-top:5px;line-height:1.5;';
      harden.addEventListener('click', () => hardenSiteCookies(harden, hstatus));
      body.appendChild(harden);
      body.appendChild(hstatus);
      const hnote = document.createElement('div');
      hnote.style.cssText = 'font-size:9.5px;color:var(--ink-faint);margin-top:5px;line-height:1.5;';
      hnote.textContent = 'Marks them HttpOnly, so the browser still sends them but page scripts can no longer read them — you stay signed in. CSRF cookies are skipped. The site can undo it next time it sets the cookie.';
      body.appendChild(hnote);
    }
  }

  // login-page third-party scripts
  if (data.isSensitivePage && data.thirdPartyScripts && data.thirdPartyScripts.length) {
    out.appendChild(makeLine('This looks like a login/checkout page loading ' + data.thirdPartyScripts.length + ' third-party script source(s). Make sure you recognize them:', 'var(--wo-warning)', true));
    const list = document.createElement('div');
    list.style.cssText = 'font-size:10.5px;color:var(--ink-soft);margin-top:2px;';
    list.textContent = data.thirdPartyScripts.join(', ');
    out.appendChild(list);
  }
}

function makeLine(text, color, bold) {
  const d = document.createElement('div');
  d.style.cssText = 'margin-top:6px;line-height:1.5;' + (color ? 'color:' + color + ';' : '') + (bold ? 'font-weight:700;' : '');
  d.textContent = text;
  return d;
}

$('ss-clear').addEventListener('click', () => {
  if (!ssCurrentOrigin) { alert('Open a normal web page first.'); return; }
  if (!confirm('Clear ALL cookies, localStorage, and site data for ' + ssCurrentOrigin + '?\n\nThis logs you out of this site and forgets all its stored data on this device. It cannot be undone.')) return;
  const btn = $('ss-clear');
  btn.disabled = true; btn.textContent = 'Clearing…';
  chrome.runtime.sendMessage({ kind: 'clear-site-data', origin: ssCurrentOrigin }, (res) => { void chrome.runtime.lastError;
    btn.disabled = false;
    if (res && res.ok) {
      btn.textContent = 'Cleared — reload the page';
      btn.style.color = 'var(--plum)';
      const out = $('ss-panic-result');
      if (out) {
        out.style.display = 'block';
        out.style.color = 'var(--wo-success)';
        out.textContent = 'Cleared this site\'s cookies, storage, cache, and service workers.' + permissionResetSummary(res.permissionsReset);
      }
    } else {
      btn.textContent = 'Clear failed — try again';
    }
  });
});

// ----- SessionShield: "has this site been breached?" (domain lookup) -----
$('ss-sitebreach').addEventListener('click', () => {
  const out = $('ss-sitebreach-result');
  const btn = $('ss-sitebreach');
  out.style.display = 'block'; out.style.color = 'var(--ink-faint)';
  out.textContent = 'Checking breach records…';
  btn.disabled = true; btn.textContent = 'Checking…';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    if (!domain) { btn.disabled = false; btn.textContent = 'Check breach history'; out.textContent = 'Open a normal web page first.'; return; }
    chrome.runtime.sendMessage({ kind: 'site-breach', domain }, (res) => { void chrome.runtime.lastError;
      btn.disabled = false; btn.textContent = 'Check breach history';
      out.textContent = '';
      if (!res || !res.ok) {
        out.style.color = 'var(--ink-faint)';
        // A timeout is worth saying out loud rather than folding into "could not reach": it means
        // the database answered too slowly, not that anything is wrong with your connection.
        out.textContent = res && res.status === 429
          ? 'The breach database is busy right now. Wait a minute and try again.'
          : res && res.error === 'timeout'
            ? 'The breach database took too long to answer. Try again shortly.'
            : 'Could not reach the breach database right now. Try again shortly.';
        return;
      }
      // background checks the registrable domain; show it, and note when it differs
      // from the current host (e.g. you're on accounts.spotify.com -> spotify.com)
      const checked = (res.domain || domain).replace(/^www\./, '');
      const stripped = domain.replace(/^www\./, '');
      const noteDiff = (checked && checked !== stripped)
        ? makeLine('Checked the site’s main domain: ' + checked + '.', 'var(--ink-faint)')
        : null;
      if (!res.breaches || !res.breaches.length) {
        out.style.color = 'var(--wo-success)';
        out.appendChild(makeLine('Good news — ' + checked + ' has no known data breaches.', 'var(--wo-success)', true));
        if (noteDiff) out.appendChild(noteDiff);
        out.appendChild(makeLine('It has never appeared in the HaveIBeenPwned breach database. This checks the site itself, not your personal account.', 'var(--ink-soft)'));
        return;
      }
      out.appendChild(makeLine(res.breaches.length + ' known breach(es) for ' + checked + ':', 'var(--wo-danger)', true));
      if (noteDiff) out.appendChild(noteDiff);
      res.breaches.forEach((b) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin:5px 0 0;padding:7px 9px;background:var(--wo-surface-wash);border-radius:8px;';
        const t = document.createElement('div');
        t.style.cssText = 'font-weight:700;color:var(--ink);font-size:11.5px;';
        t.textContent = b.name + (b.date ? ' (' + b.date.slice(0, 4) + ')' : '');
        row.appendChild(t);
        if (b.count) {
          const c = document.createElement('div');
          c.style.cssText = 'color:var(--ink-soft);font-size:10.5px;';
          c.textContent = b.count.toLocaleString() + ' accounts affected';
          row.appendChild(c);
        }
        if (b.data && b.data.length) {
          const d = document.createElement('div');
          d.style.cssText = 'color:var(--ink-faint);font-size:10px;margin-top:1px;';
          d.textContent = 'Exposed: ' + b.data.join(', ');
          row.appendChild(d);
        }
        out.appendChild(row);
      });
      out.appendChild(makeLine('If you have an account here, make sure your password is unique and consider changing it.', 'var(--ink-soft)'));
    });
  });
});

// ----- SessionShield: emergency "log out of everything" -----
$('ss-panic').addEventListener('click', () => {
  if (!confirm('Log out of EVERYTHING?\n\nThis clears cookies and session data for ALL sites on this device — you will be signed out everywhere. Use this if you think your browser may be compromised.\n\nThis cannot be undone.')) return;
  const btn = $('ss-panic');
  const out = $('ss-panic-result');
  btn.disabled = true; btn.textContent = 'Logging out everywhere…';
  out.style.display = 'block'; out.style.color = 'var(--ink-faint)'; out.textContent = '';
  chrome.runtime.sendMessage({ kind: 'panic-logout' }, (res) => { void chrome.runtime.lastError;
    btn.disabled = false;
    if (res && res.ok) {
      btn.textContent = 'Done — signed out everywhere';
      btn.style.background = 'linear-gradient(135deg,var(--wo-success-solid),#277a49)';
      out.style.color = 'var(--wo-success)';
      out.textContent = 'Cleared. Reload your tabs — you\'ll need to sign back in.' + permissionResetSummary(res.permissionsReset);
    } else {
      btn.textContent = 'Failed — try again';
    }
  });
});

// ----- Privacy cleaner -----
$('cl-run').addEventListener('click', () => {
  const types = {
    cache: $('cl-cache').checked,
    cookies: $('cl-cookies').checked,
    history: $('cl-history').checked,
    downloads: $('cl-downloads').checked,
    storage: $('cl-storage').checked,
    serviceWorkers: $('cl-sw').checked,
    formData: $('cl-form').checked,
    sitePermissions: $('cl-perms').checked,
  };
  const out = $('cl-result');
  const anyChecked = Object.values(types).some(Boolean);
  if (!anyChecked) { out.style.display = 'block'; out.style.color = 'var(--ink-faint)'; out.textContent = 'Pick at least one thing to clean.'; return; }
  // Only the all-cookies option signs anyone out. The consent sweep deliberately does not, so it
  // must not inherit the scary confirmation -- not being frightening is the whole point of it.
  const willSignOut = types.cookies ? '\n\nClearing ALL cookies will sign you out of websites.' : '';
  if (!confirm('Clean the selected browser data for all sites?' + willSignOut + '\n\nThis cannot be undone.')) return;
  const btn = $('cl-run');
  btn.disabled = true; btn.textContent = 'Cleaning…';
  out.style.display = 'block'; out.style.color = 'var(--ink-faint)'; out.textContent = '';
  const sinceSel = $('cl-since');
  const sinceMs = sinceSel ? Number(sinceSel.value) || 0 : 0;
  chrome.runtime.sendMessage({ kind: 'clean-browser', types, sinceMs }, (res) => { void chrome.runtime.lastError;
    btn.disabled = false; btn.textContent = 'Clean selected';
    if (res && res.ok) {
      out.style.color = 'var(--wo-success)';
      // Report the consent sweep by count. "Removed 143 across 62 sites, kept the rest" is the
      // sentence that tells someone it worked AND that it did not touch their logins.
      const parts = res.cleared.map(prettyDataType).filter((v, i, a) => a.indexOf(v) === i);
      let text = parts.length ? 'Cleaned: ' + parts.join(', ') + '.' : '';
      if (res.consent) {
        const c = res.consent;
        text += (text ? ' ' : '')
          + (c.removed
            ? 'Removed ' + c.removed + ' consent and tracking cookie' + (c.removed === 1 ? '' : 's')
              + ' across ' + c.sites + ' site' + (c.sites === 1 ? '' : 's')
              + '; kept the other ' + c.kept + ', so you are still signed in.'
            : 'No consent or tracking cookies left to remove.');
      }
      if (res.perms) {
        const p = res.perms;
        text += (text ? ' ' : '')
          + (p.reset && p.reset.length
            ? 'Reset ' + p.reset.join(', ').toLowerCase() + ' back to asking.'
            : (p.unsupported && p.unsupported.length
              ? 'This Chrome does not let extensions reset those site permissions.'
              : 'Site permissions could not be reset.'));
      }
      out.textContent = text;
    } else {
      out.style.color = 'var(--wo-popup-soft-danger)';
      // Show what actually went wrong. A bare "try again" sent me hunting for a while when the
      // real answer -- a ReferenceError naming the exact binding -- was sitting in the response.
      out.textContent = 'Cleaning failed: ' + ((res && res.error) || 'no response from WardenOne');
    }
  });
});
function prettyDataType(k) {
  return ({ cache: 'cache', cacheStorage: 'cache', cookies: 'cookies', history: 'history', downloads: 'downloads', localStorage: 'local storage', indexedDB: 'local storage', webSQL: 'local storage', serviceWorkers: 'service workers', formData: 'form data' })[k] || k;
}
function permissionResetSummary(result) {
  if (!result) return '';
  const reset = Array.isArray(result.reset) ? result.reset : [];
  const failed = Array.isArray(result.failed) ? result.failed : [];
  if (reset.length) {
    const shown = reset.slice(0, 5).join(', ');
    return ' Reset permissions: ' + shown + (reset.length > 5 ? ', +' + (reset.length - 5) + ' more' : '') + '.';
  }
  if (failed.length) return ' Permission reset was partly blocked by the browser.';
  return '';
}

// ----- Review installed extensions (list + flag, honest about limits) -----
function fmtAlertAge(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function loadExtensionAlerts() {
  const listEl = $('ext-alerts-list');
  const emptyEl = $('ext-alerts-empty');
  const clearBtn = $('ext-alerts-clear');
  const ackBtn = $('ext-alerts-ack');
  const summaryEl = $('ext-security-summary');
  const databaseEl = $('ext-security-db');
  if (!listEl || !emptyEl || !clearBtn || !ackBtn) return;
  chrome.runtime.sendMessage({ kind: 'extension-security-report', trigger: 'popup' }, (res) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError || !res || !res.ok) {
      listEl.style.display = 'none';
      clearBtn.style.display = 'none';
      ackBtn.style.display = 'none';
      if (summaryEl) summaryEl.textContent = '';
      if (databaseEl) databaseEl.textContent = '';
      emptyEl.style.display = '';
      emptyEl.style.color = 'var(--wo-popup-soft-danger)';
      emptyEl.textContent = 'Extension Security Centre could not build the local report. ' +
        String((runtimeError && runtimeError.message) || (res && res.error) || 'Reload WardenOne and try again.');
      return;
    }
    const alerts = Array.isArray(res.recentChanges) ? res.recentChanges : [];
    const status = res.watcher || {};
    const summary = res.summary || {};
    const database = res.database || {};
    const extensions = Array.isArray(res.extensions) ? res.extensions : [];
    const allUrgent = extensions.filter((item) => item && item.verdict && item.verdict.needsAttention);
    const urgent = allUrgent.slice(0, 3);
    const urgentIds = new Set(allUrgent.map((item) => item.id));
    const unread = alerts.filter((a) => a && !a.reviewedAt
      && ['medium', 'high', 'critical'].includes(a.severity));
    /* A verdict already explains the same underlying event better than the raw
       watcher record. Show it once, and keep routine/reviewed version events in
       the full Centre timeline instead of making this popup noisy forever. */
    const visibleChanges = unread.filter((a) => !urgentIds.has(a.id));
    if (summaryEl) {
      const decisions = Number(summary.attention) || 0;
      summaryEl.textContent = (Number(summary.installed) || 0) + ' monitored · '
        + decisions + ' decision' + (decisions === 1 ? '' : 's')
        + (status.lastChecked ? ' · checked ' + fmtAlertAge(status.lastChecked) : '');
    }
    if (databaseEl) {
      databaseEl.style.color = database.available ? '' : 'var(--wo-popup-soft-danger)';
      databaseEl.textContent = database.available
        ? (Number(database.verifiedIdentityRecordCount) || 0) + ' publisher-verified identities · '
          + (Number(database.cataloguedListingRecordCount) || 0) + ' catalogue references · local only'
        : 'The local database is unavailable; access and change analysis still works, but no reassuring match result is shown.';
    }
    emptyEl.style.color = '';
    if (!visibleChanges.length && !urgent.length) {
      listEl.style.display = 'none';
      clearBtn.style.display = 'none';
      ackBtn.style.display = 'none';
      emptyEl.style.display = '';
      if (status.state === 'error') {
        emptyEl.style.color = 'var(--wo-popup-soft-danger)';
        emptyEl.textContent = 'The last inventory check failed: ' + (status.lastError || 'Chrome did not return the extension list.') + ' Try reloading WardenOne.';
      } else if (status.state === 'disabled' || status.enabled === false) {
        emptyEl.textContent = 'Extension Watch is turned off. Existing timeline entries are kept locally.';
      } else {
        /* The state this should usually be in, so it is worth saying properly.
           "0 need attention" next to a wall of cards was the old shape; now the
           list is genuinely empty most of the time, and the panel should read as
           a result rather than an absence. Recognised extensions are counted
           because that is the reassuring part: WardenOne knows what they are,
           and what they can do is what that kind of extension does. */
        const watched = Number(status.watchedCount) || 0;
        const known = Number(summary.recognized) || 0;
        emptyEl.textContent = 'Watching ' + watched + ' installed extension' + (watched === 1 ? '' : 's')
          + (known ? ' · ' + known + ' verified with expected access' : '')
          + (status.lastChecked ? ' · checked ' + fmtAlertAge(status.lastChecked) : '')
          + '. Nothing needs you.';
      }
      return;
    }
    emptyEl.style.display = 'none';
    listEl.style.display = '';
    clearBtn.style.display = visibleChanges.length ? '' : 'none';
    listEl.textContent = '';
    const watchState = document.createElement('div');
    watchState.style.cssText = 'font-size:10.5px;color:var(--wo-text-soft);margin:0 1px 7px;line-height:1.35;';
    if (status.state === 'error') {
      watchState.style.color = 'var(--wo-popup-soft-danger)';
      watchState.textContent = 'Latest inventory check failed: ' + (status.lastError || 'Chrome did not return the extension list.') + ' Earlier changes are shown below.';
    } else {
      const watched = Number(status.watchedCount) || 0;
      watchState.textContent = 'Watching ' + watched + ' extension' + (watched === 1 ? '' : 's') +
        (status.lastChecked ? ' · checked ' + fmtAlertAge(status.lastChecked) : '');
    }
    listEl.appendChild(watchState);
    ackBtn.style.display = unread.length ? '' : 'none';
    if (urgent.length) {
      const heading = document.createElement('div');
      heading.style.cssText = 'font-weight:700;font-size:11px;color:var(--wo-text);margin:6px 1px 5px;';
      heading.textContent = 'Needs attention';
      listEl.appendChild(heading);
      urgent.forEach((item) => {
        /* Neutral card, coloured edge. Filling the whole card with the warning
           wash made every entry look like an emergency and made the panel look
           like a hazard sign -- and the tan is doing that job for a row that
           often just means "have a look at this". The severity now lives in a
           3px accent and the badge, on the ordinary surface every other row in
           this popup uses, so the list reads as a list. */
        const card = document.createElement('div');
        const dangerous = item.verdict.tone === 'danger';
        const accent = dangerous ? 'var(--wo-danger)' : 'var(--wo-warning)';
        card.style.cssText = 'border:1px solid var(--wo-line);border-left:3px solid ' + accent
          + ';background:var(--wo-surface);border-radius:8px;padding:8px 10px;margin-bottom:5px;';
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:2px;';
        const name = document.createElement('div');
        name.style.cssText = 'font-weight:650;font-size:12px;color:var(--wo-text);min-width:0;'
          + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        name.textContent = item.name + (item.enabled ? '' : ' (disabled)');
        name.title = item.name;
        top.appendChild(name);
        const badge = document.createElement('span');
        /* Sentence case, not shouting. "UNEXPECTED ACCESS" in caps beside a tan
           background reads as an alarm even when the finding is mild. */
        badge.style.cssText = 'flex:none;font-size:9.5px;font-weight:700;letter-spacing:.02em;color:' + accent + ';';
        badge.textContent = String(item.verdict.label || '').toLowerCase()
          .replace(/^./, (c) => c.toUpperCase());
        top.appendChild(badge);
        card.appendChild(top);
        /* One sentence saying what is actually going on, instead of three
           colon-prefixed fields. "Reputation: Recognized identity — exact ID
           match / Access: HIGH / Change: ..." is a debug dump: it makes the
           reader do the reasoning the engine already did, and it looks alarming
           whatever it says. recommendedAction is now specific enough to stand on
           its own -- it names the capability, or the kind of extension and what
           that kind needs. */
        card.appendChild(makeLine(item.recommendedAction || item.reputation.label, 'var(--wo-text)'));
        /* The evidence, quieter and underneath, for anyone who wants it. A
           documented compromise leads with its evidence; anything else leads
           with what it can reach. */
        const evidence = item.verdict.tone === 'danger' && item.reputation && item.reputation.reason
          ? String(item.reputation.reason).split('. ')[0]
          : (item.capabilities && item.capabilities.unexpected && item.capabilities.unexpected.length
            ? item.capabilities.unexpected.map((s) => s.label).join(' · ')
            : ((item.access.reasons && item.access.reasons[0]) || ''));
        /* The advice already names the capability when there is an unexpected
           one, so printing the evidence underneath repeated the same sentence in
           two colours -- which reads as two findings and makes the card twice as
           tall for nothing. Show it only when it says something the line above
           did not. */
        const advice = String(item.recommendedAction || '').toLowerCase();
        const alreadySaid = evidence && advice.indexOf(String(evidence).toLowerCase().slice(0, 40)) >= 0;
        if (evidence && !alreadySaid) card.appendChild(makeLine(evidence, 'var(--wo-text-soft)'));
        if (item.latestChange) card.appendChild(makeLine('Changed: ' + item.latestChange.summary, 'var(--wo-text-soft)'));
        listEl.appendChild(card);
      });
    }
    if (visibleChanges.length) {
      const heading = document.createElement('div');
      heading.style.cssText = 'font-weight:700;font-size:11px;color:var(--wo-text);margin:8px 1px 5px;';
      heading.textContent = 'Changes needing a decision';
      listEl.appendChild(heading);
    }
    visibleChanges.slice(0, 4).forEach((a) => {
      const card = document.createElement('div');
      const level = ['low', 'medium', 'high', 'critical'].includes(a.severity) ? a.severity : 'high';
      const palette = level === 'critical' || level === 'high'
        ? ['var(--wo-danger)', 'var(--wo-danger)']
        : (level === 'medium'
          ? ['var(--wo-warning)', 'var(--wo-warning)']
          : ['var(--wo-line)', 'var(--wo-text-soft)']);
      card.style.cssText = 'border:1px solid var(--wo-line);border-left:3px solid ' + palette[0]
        + ';background:var(--wo-surface);border-radius:8px;padding:8px 10px;margin-bottom:5px;';
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start;';
      const name = document.createElement('div');
      name.style.cssText = 'font-weight:700;font-size:12px;color:var(--wo-text);min-width:0;';
      name.textContent = (a.name || '(unknown extension)') + ' · ' + fmtAlertAge(a.when);
      top.appendChild(name);
      const badge = document.createElement('span');
      badge.style.cssText = 'flex:none;font-size:9px;font-weight:750;letter-spacing:.02em;color:' + palette[1] + ';';
      badge.textContent = level.replace(/^./, (c) => c.toUpperCase()) + ' · new';
      top.appendChild(badge);
      card.appendChild(top);
      const summary = document.createElement('div');
      summary.style.cssText = 'font-size:11px;color:var(--wo-text);margin-top:4px;font-weight:600;';
      summary.textContent = a.summary || 'Extension permissions changed';
      card.appendChild(summary);
      if (a.fromVersion && a.toVersion && a.fromVersion !== a.toVersion) {
        const version = document.createElement('div');
        version.style.cssText = 'font-size:10.5px;color:var(--wo-text-soft);margin-top:2px;';
        version.textContent = 'Version ' + a.fromVersion + ' → ' + a.toVersion;
        card.appendChild(version);
      }
      const reasons = Array.isArray(a.reasons) && a.reasons.length ? a.reasons : (a.gained || []);
      reasons.slice(0, 2).forEach((reason) => {
        const li = document.createElement('div');
        li.style.cssText = 'font-size:10.5px;color:var(--wo-text-soft);margin-top:3px;line-height:1.35;';
        li.textContent = '• ' + reason;
        card.appendChild(li);
      });
      listEl.appendChild(card);
    });
  });
}
$('ext-alerts-ack')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ kind: 'ack-extension-alerts' }, () => { void chrome.runtime.lastError; loadExtensionAlerts(); });
});
$('ext-alerts-clear')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ kind: 'clear-extension-alerts' }, () => { void chrome.runtime.lastError; loadExtensionAlerts(); });
});

function renderStartupReport(report) {
  const listEl = $('startup-list');
  const emptyEl = $('startup-empty');
  const clearBtn = $('startup-clear');
  if (!listEl || !emptyEl || !clearBtn) return;
  const tabs = Array.isArray(report && report.tabs) ? report.tabs : [];
  const extensions = Array.isArray(report && report.extensions) ? report.extensions : [];
  const total = tabs.length + extensions.length;
  if (!report || !total) {
    listEl.style.display = 'none';
    clearBtn.style.display = 'none';
    emptyEl.style.display = '';
    emptyEl.textContent = report ? 'No issues found in the last check. You can run a check now.' : 'No security check has run yet. You can run one now.';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.style.display = '';
  clearBtn.style.display = '';
  listEl.textContent = '';
  const section = (title, items, fmt) => {
    if (!items || !items.length) return;
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:700;font-size:11.5px;color:var(--wo-text);margin:6px 0 3px;';
    head.textContent = title + ' (' + items.length + ')';
    listEl.appendChild(head);
    items.slice(0, 8).forEach((it) => {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--wo-danger-line);background:var(--wo-danger-bg);border-radius:9px;padding:7px 9px;margin-bottom:5px;font-size:11px;color:var(--wo-text-soft);line-height:1.45;';
      card.textContent = fmt(it);
      listEl.appendChild(card);
    });
  };
  section('Risky open tabs', tabs, (t) => (t.title || t.host || 'Tab') + ' — ' + t.host + ' (' + t.why + ')');
  section('Extension changes', extensions, (e) => e.name + (e.change ? ' — ' + e.change : (e.risky ? ' — important access change' : '')) + (e.enabled ? '' : ' (disabled)'));
}
function loadStartupReport() {
  chrome.runtime.sendMessage({ kind: 'get-startup-report' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    renderStartupReport(res.report);
  });
}
function showStartupCheckError(message) {
  const listEl = $('startup-list');
  const emptyEl = $('startup-empty');
  const clearBtn = $('startup-clear');
  if (listEl) listEl.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
  if (emptyEl) {
    emptyEl.style.display = '';
    emptyEl.textContent = message || 'Could not run the security check. Try reloading the extension and running it again.';
  }
}
$('startup-run')?.addEventListener('click', () => {
  const btn = $('startup-run');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
  chrome.runtime.sendMessage({ kind: 'run-startup-check' }, (res) => {
    if (btn) { btn.disabled = false; btn.textContent = 'Run security check now'; }
    if (chrome.runtime.lastError || !res || !res.ok) {
      showStartupCheckError((res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message));
      return;
    }
    renderStartupReport(res.report);
  });
});
$('startup-clear')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ kind: 'clear-startup-report' }, () => { void chrome.runtime.lastError; loadStartupReport(); });
});

function openExtensionSecurityCentre() {
  chrome.tabs.create({ url: chrome.runtime.getURL('extensions.html') });
}
$('ext-review-open')?.addEventListener('click', openExtensionSecurityCentre);
$('ext-review')?.addEventListener('click', () => {
  const out = $('ext-result');
  const btn = $('ext-review');
  if (!out || !btn) return;
  if (out.dataset.open === '1') {
    out.dataset.open = '';
    out.style.display = 'none';
    out.textContent = '';
    btn.textContent = 'Review my extensions';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Reviewing locally…';
  out.style.display = 'block';
  out.textContent = 'Reading Chrome\'s extension inventory and bundled local database…';
  chrome.runtime.sendMessage({ kind: 'extension-security-report', trigger: 'manual' }, (res) => {
    const runtimeError = chrome.runtime.lastError;
    btn.disabled = false;
    btn.textContent = 'Hide extension review';
    out.textContent = '';
    out.dataset.open = '1';
    if (runtimeError || !res || !res.ok) {
      out.style.color = 'var(--wo-popup-soft-danger)';
      out.textContent = 'Could not build the local extension review. ' + String((runtimeError && runtimeError.message) || (res && res.error) || 'Reload WardenOne and try again.');
      return;
    }
    out.style.color = '';
    const extensions = Array.isArray(res.extensions) ? res.extensions : [];
    const summary = res.summary || {};
    const database = res.database || {};
    const attention = extensions.filter((item) => item && item.verdict && item.verdict.needsAttention);
    const incidents = (Number(summary.knownHarmful) || 0) + (Number(summary.reportedOrHistorical) || 0);
    out.appendChild(makeLine(attention.length
      ? attention.length + ' decision' + (attention.length === 1 ? '' : 's') + ' need you'
      : 'No action needed', attention.length ? 'var(--wo-warning)' : 'var(--wo-success)', true));
    out.appendChild(makeLine(extensions.length + ' monitored · '
      + (Number(summary.verifiedIdentities) || 0) + ' publisher-verified · '
      + (Number(summary.catalogued) || 0) + ' catalogue-only · '
      + incidents + ' incident match' + (incidents === 1 ? '' : 'es'), 'var(--wo-text-soft)'));
    if (!database.available) {
      out.appendChild(makeLine('The local database is unavailable. Access and change analysis still works, but no identity result is assumed.',
        'var(--wo-popup-soft-danger)'));
    }
    if (!extensions.length) {
      out.appendChild(makeLine('Chrome reported no other installed extensions.', 'var(--ink-faint)'));
      return;
    }
    if (!attention.length) {
      out.appendChild(makeLine((Number(summary.recognized) || 0)
        ? (Number(summary.recognized) || 0) + ' verified extension' + ((Number(summary.recognized) || 0) === 1 ? '' : 's')
          + ' currently match their evidence-backed access contract.'
        : 'No documented incident, unexpected powerful capability, or unreviewed risky change was found.', 'var(--wo-text)'));
    }
    attention.slice(0, 5).forEach((item) => {
      const card = document.createElement('div');
      const tone = item.verdict && item.verdict.tone;
      const accent = tone === 'danger' ? 'var(--wo-danger)' : 'var(--wo-warning)';
      card.style.cssText = 'margin:7px 0 0;padding:8px 10px;border:1px solid var(--wo-line);border-left:3px solid '
        + accent + ';background:var(--wo-surface);border-radius:8px;';
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;gap:7px;align-items:flex-start;';
      const name = document.createElement('span');
      name.style.cssText = 'font-weight:700;color:var(--wo-text);font-size:11.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = item.name + ' · v' + (item.version || '?') + (item.enabled ? '' : ' (disabled)');
      name.title = item.name;
      top.appendChild(name);
      const badge = document.createElement('span');
      badge.style.cssText = 'flex:none;font-size:9px;font-weight:750;letter-spacing:.02em;color:' + accent + ';';
      badge.textContent = String((item.verdict && item.verdict.label) || 'Needs review').toLowerCase()
        .replace(/^./, (c) => c.toUpperCase());
      top.appendChild(badge);
      card.appendChild(top);
      card.appendChild(makeLine(item.recommendedAction || 'Review this extension in the full Centre.', 'var(--wo-text)'));
      if (item.pendingChange) card.appendChild(makeLine(item.pendingChange.summary, 'var(--wo-text-soft)'));
      out.appendChild(card);
    });
    if (attention.length > 5) {
      out.appendChild(makeLine('+' + (attention.length - 5) + ' more decision' + (attention.length - 5 === 1 ? '' : 's')
        + ' in the full Security Centre.', 'var(--wo-text-soft)'));
    }
    out.appendChild(makeLine('Open the full Security Centre for evidence, the complete change timeline, and access decisions.', 'var(--ink-faint)'));
  });
});

// ----- Site permission scanner -----
let permScanUrl = '';

const permStateLabel = (s) => {
  if (s === 'allow') return 'Allowed';
  if (s === 'block') return 'Blocked';
  if (s === 'session_only') return 'Session only';
  return 'Ask';
};

function stylePermPick(sel, setting) {
  sel.className = 'perm-pick perm-pick-' + (setting || 'ask');
}

function setSitePermission(key, setting, sel, row) {
  const prev = row.dataset.current || sel.value;
  if (prev === setting) return;
  row.classList.add('perm-row-saving');
  sel.disabled = true;
  chrome.runtime.sendMessage({ kind: 'set-site-permission', url: permScanUrl, key, setting }, (res) => {
    sel.disabled = false;
    row.classList.remove('perm-row-saving');
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      sel.value = prev;
      stylePermPick(sel, prev);
      return;
    }
    const applied = (res && res.setting) ? res.setting : setting;
    sel.value = applied;
    row.dataset.current = applied;
    stylePermPick(sel, applied);
  });
}

function buildPermRow(r) {
  const row = document.createElement('div');
  row.className = 'perm-row';
  const lbl = document.createElement('span');
  lbl.className = 'perm-row-label';
  lbl.textContent = r.label;
  row.appendChild(lbl);
  const sel = document.createElement('select');
  sel.className = 'perm-pick';
  sel.title = 'Change ' + r.label + ' for this site';
  const options = r.options || ['ask', 'allow', 'block'];
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = permStateLabel(opt);
    sel.appendChild(o);
  });
  const current = options.includes(r.setting) ? r.setting : options[0];
  sel.value = current;
  row.dataset.current = current;
  stylePermPick(sel, current);
  sel.addEventListener('change', () => setSitePermission(r.key, sel.value, sel, row));
  row.appendChild(sel);
  return row;
}

function renderPermResults(out, hostname, res) {
  const section = document.createElement('div');
  section.style.marginTop = '4px';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'btn';
  head.setAttribute('aria-expanded', 'false');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;';
  const arrow = document.createElement('span');
  arrow.style.cssText = 'flex:none;color:var(--ink-soft);display:flex;transition:transform .2s ease;';
  arrow.appendChild(makeChevronIcon(14));
  head.appendChild(arrow);
  const htxt = document.createElement('span');
  htxt.style.cssText = 'flex:1;font-size:12px;';
  htxt.textContent = 'Permissions for ' + hostname;
  head.appendChild(htxt);
  const chip = document.createElement('span');
  chip.style.cssText = 'flex:none;font-size:10.5px;font-weight:700;color:var(--wo-on-brand);border-radius:10px;padding:1px 8px;background:' + riskFill(res.risk) + ';';
  chip.textContent = res.risk;
  head.appendChild(chip);

  const body = document.createElement('div');
  body.style.paddingTop = '2px';

  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    arrow.style.transform = open ? 'rotate(90deg)' : '';
  });

  const list = document.createElement('div');
  list.className = 'perm-list';
  res.results.forEach((r) => list.appendChild(buildPermRow(r)));
  body.appendChild(list);
  if (res.unsupported && res.unsupported.length) {
    body.appendChild(makeLine('Not available: ' + res.unsupported.join(', ') + '.', 'var(--ink-faint)'));
  }

  head.setAttribute('aria-expanded', 'true');
  arrow.style.transform = 'rotate(90deg)';

  section.appendChild(head);
  section.appendChild(body);
  out.appendChild(section);
}

// ----- Tab Limit UI -----
(function initTabLimitGuard() {
  const guard = $('tl-guard');
  if (!guard) return;
  const max = $('tl-max');
  const idle = $('tl-idle');
  const close = $('tl-close');
  const warn = $('tl-warn');

  const clampInt = (v, lo, hi, dflt) => {
    let n = parseInt(v, 10);
    if (!Number.isFinite(n)) n = dflt;
    return Math.min(hi, Math.max(lo, n));
  };

  guard.addEventListener('change', () => { config.tabLimitGuard = guard.checked; save(); });
  if (close) close.addEventListener('change', () => { config.tabLimitClose = close.checked; save(); });
  if (warn) warn.addEventListener('change', () => { config.tabLimitWarn = warn.checked; save(); });
  if (max) max.addEventListener('change', () => { const v = clampInt(max.value, 2, 200, 20); max.value = v; config.tabLimitMax = v; save(); });
  if (idle) idle.addEventListener('change', () => { const v = clampInt(idle.value, 0, 1440, 30); idle.value = v; config.tabLimitMinIdleMinutes = v; save(); });

  paintTabLimitUI();
})();

// ----- Twitch local rewind: buffer length -----
(function initTwitchRewind() {
  const mins = $('tr-minutes');
  if (!mins) return;
  mins.addEventListener('change', () => {
    let n = parseInt(mins.value, 10);
    if (!Number.isFinite(n)) n = 5;
    n = Math.min(30, Math.max(1, n));
    mins.value = n;
    config.twitchRewindMinutes = n;
    save();
  });
  paintTwitchRewindUI();
})();

// ----- Forget Me UI -----
(function initForgetMe() {
  const toggle = $('forget-enable');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      const ok = window.confirm('Turn on "Never let sites remember me"?\n\nWhen you close a site, WardenOne will clear its cookies and stored data — so you\'ll be logged out and it can\'t recognise you next time. Sites on your allowlist are left alone.');
      if (!ok) { toggle.checked = false; return; }
      config.forgetMeMode = 'all';
      config.forgetMeAllConfirmedAt = Date.now();
    } else {
      config.forgetMeMode = 'off';
      config.forgetMeAllConfirmedAt = 0;
    }
    save();
  });

  const hist = $('forget-history');
  if (hist) hist.addEventListener('change', () => { config.forgetMeHistory = hist.checked; save(); });

  const currentHost = (cb) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        let host = '';
        let url = '';
        try {
          url = (tabs && tabs[0] && tabs[0].url) || '';
          host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        } catch (_) {}
        cb(host, url);
      });
    } catch (_) { cb('', ''); }
  };

  const nowBtn = $('forget-now');
  const nowRes = $('forget-now-result');
  if (nowBtn) nowBtn.addEventListener('click', () => {
    currentHost((host, url) => {
      if (!host) { if (nowRes) { nowRes.style.display = 'block'; nowRes.textContent = 'No site open to forget.'; } return; }
      nowBtn.disabled = true; nowBtn.textContent = 'Forgetting…';
      chrome.runtime.sendMessage({ kind: 'forget-site-now', host, url }, (r) => { void chrome.runtime.lastError;
        nowBtn.disabled = false; nowBtn.textContent = 'Forget this site now';
        if (nowRes) {
          nowRes.style.display = 'block';
          nowRes.textContent = (r && r.ok)
            ? ('Cleared ' + (r.domain || host) + ' — reload the tab to see it logged out.' + permissionResetSummary(r.permissionsReset))
            : ('Could not clear: ' + ((r && r.error) || 'unknown error'));
        }
      });
    });
  });

  paintForgetMe();
})();

// ----- Memory Shield UI -----
(function initMemoryShield() {
  const modeWrap = $('mem-modes');
  if (!modeWrap) return;
  const paintModes = paintMemoryModes; // hoisted; also called by applyToUI on load
  document.querySelectorAll('.mem-mode').forEach((b) => {
    b.addEventListener('click', () => {
      config.memoryMode = b.getAttribute('data-mode');
      paintModes();
      save();
      setTimeout(loadScore, 300);
    });
  });
  paintModes();

  const loadScore = () => {
    const el = $('mem-score');
    if (!el) return;
    chrome.runtime.sendMessage({ kind: 'memory-score' }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok) { el.textContent = 'Memory status unavailable.'; return; }
      el.textContent = '';
      el.append('Browser memory: ');
      const level = document.createElement('strong');
      level.style.color = r.level === 'High' ? 'var(--wo-danger)' : r.level === 'Medium' ? 'var(--wo-warning)' : 'var(--wo-success)';
      level.textContent = r.level;
      el.appendChild(level);
      el.appendChild(document.createElement('br'));
      el.append(r.total + ' tabs open \u00b7 ' + r.sleeping + ' sleeping \u00b7 ' + r.heavy + ' heavy');
      el.appendChild(document.createElement('br'));
      el.append(r.sleepable > 0 ? ('Can sleep ' + r.sleepable + ' now \u00b7 estimated saving: ' + r.saved) : 'Nothing to sleep right now');
    });
  };
  loadScore();

  // heavy-tab detector: auto-list currently-open heavy tabs
  const loadHeavy = () => {
    const box = $('mem-heavy');
    if (!box) return;
    chrome.runtime.sendMessage({ kind: 'memory-heavy-tabs' }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok || !r.heavy || !r.heavy.length) { box.textContent = ''; return; }
      box.textContent = '';
      const head = document.createElement('div');
      head.style.cssText = 'font-weight:700;color:var(--ink);margin-bottom:4px;';
      head.textContent = r.heavy.length + ' heavy tab' + (r.heavy.length === 1 ? '' : 's') + ' open:';
      box.appendChild(head);
      r.heavy.slice(0, 8).forEach((t) => {
        const row = document.createElement('div');
        row.style.cssText = 'color:var(--ink-soft);padding:2px 0;';
        row.textContent = '• ' + t.host + (t.audible ? ' (audio)' : t.active ? ' (active)' : '');
        box.appendChild(row);
      });
      const note = document.createElement('div');
      note.style.cssText = 'color:var(--ink-faint);margin-top:3px;font-size:10.5px;';
      note.textContent = 'These use more RAM/CPU. They sleep when inactive (unless active/audio).';
      box.appendChild(note);
    });
  };
  loadHeavy();

  const tabUsageBtn = $('mem-tab-usage');
  if (tabUsageBtn) tabUsageBtn.addEventListener('click', () => {
    const out = $('mem-tab-usage-result');
    tabUsageBtn.disabled = true;
    tabUsageBtn.textContent = 'Checking tabs...';
    chrome.runtime.sendMessage({ kind: 'memory-tabs' }, (r) => {
      tabUsageBtn.disabled = false;
      tabUsageBtn.textContent = 'Show all tabs';
      if (!out) return;
      out.style.display = 'block';
      out.textContent = '';
      if (chrome.runtime.lastError || !r || !r.ok) { out.textContent = 'Could not inspect tabs right now.'; return; }
      const summary = document.createElement('div');
      summary.style.cssText = 'font-weight:700;color:var(--ink);margin-bottom:5px;';
      const s = r.summary || {};
      summary.textContent = (s.high || 0) + ' high-pressure tab(s) | ' + (s.sleepable || 0) + ' can sleep | ' + (s.sleeping || 0) + ' already sleeping';
      out.appendChild(summary);
      const tabs = Array.isArray(r.tabs) ? r.tabs : [];
      if (!tabs.length) { out.append('No normal web tabs to show.'); return; }
      tabs.slice(0, 12).forEach((t) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:7px;padding:6px 0;border-bottom:1px solid var(--wo-line);';
        const info = document.createElement('div');
        info.style.cssText = 'min-width:0;flex:1;';
        const title = document.createElement('div');
        title.style.cssText = 'color:var(--ink-soft);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        title.textContent = (t.impact || 'Low') + ' - ' + (t.host || t.title || 'tab');
        const meta = document.createElement('div');
        meta.style.cssText = 'color:var(--ink-faint);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const why = Array.isArray(t.reasons) && t.reasons.length ? t.reasons.join(', ') : (t.keepReason || 'normal page');
        meta.textContent = (t.discarded ? 'sleeping' : 'idle ' + (t.idle || '0m')) + ' | ' + why;
        info.appendChild(title);
        info.appendChild(meta);
        row.appendChild(info);
        if (t.sleepable) {
          const sleep = document.createElement('button');
          sleep.className = 'btn';
          sleep.style.cssText = 'flex:none;padding:4px 8px;font-size:10px;';
          sleep.textContent = 'Sleep';
          sleep.addEventListener('click', () => {
            sleep.disabled = true;
            sleep.textContent = 'Sleeping...';
            chrome.runtime.sendMessage({ kind: 'memory-sleep-tab-now', tabId: t.id }, (rr) => { void chrome.runtime.lastError;
              if (rr && rr.ok) {
                row.style.opacity = '0.45';
                sleep.textContent = 'Slept';
                setTimeout(loadScore, 400);
              } else {
                sleep.disabled = false;
                sleep.textContent = 'Protected';
                meta.textContent = (rr && rr.error) || 'Could not sleep this tab.';
              }
            });
          });
          row.appendChild(sleep);
        } else {
          const tag = document.createElement('span');
          tag.style.cssText = 'flex:none;font-size:10px;color:var(--ink-faint);';
          tag.textContent = t.discarded ? 'Asleep' : 'Protected';
          row.appendChild(tag);
        }
        out.appendChild(row);
      });
    });
  });

  // zombie-tab detector
  const zBtn = $('mem-zombies');
  if (zBtn) zBtn.addEventListener('click', () => {
    const out = $('mem-zombies-result');
    zBtn.disabled = true; zBtn.textContent = 'Scanning…';
    chrome.runtime.sendMessage({ kind: 'memory-zombie-tabs', hours: 6 }, (r) => {
      zBtn.disabled = false; zBtn.textContent = 'Find zombie tabs (idle 6h+)';
      if (!out) return;
      out.style.display = 'block'; out.textContent = '';
      if (!r || !r.ok) { out.textContent = 'Could not scan.'; return; }
      if (!Array.isArray(r.zombies) || !r.zombies.length) { out.textContent = 'No zombie tabs — nothing idle for 6+ hours.'; return; }
      const head = document.createElement('div');
      head.textContent = r.zombies.length + ' tab(s) idle for 6+ hours:';
      head.style.marginBottom = '5px';
      out.appendChild(head);
      r.zombies.slice(0, 10).forEach((z) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--wo-line);';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:11px;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        lbl.textContent = z.host + ' · ' + z.idleHours + 'h' + (z.protected ? ' (' + z.keepReason + ')' : '');
        row.appendChild(lbl);
        if (!z.protected) {
          const btns = document.createElement('span');
          btns.style.cssText = 'flex:none;display:flex;gap:4px;';
          const sleep = document.createElement('button');
          sleep.className = 'btn'; sleep.style.cssText = 'padding:4px 8px;font-size:10px;';
          sleep.textContent = 'Sleep';
          sleep.addEventListener('click', () => { sleep.disabled = true; chrome.runtime.sendMessage({ kind: 'memory-sleep-tab', tabId: z.id }, () => { void chrome.runtime.lastError; row.style.opacity = '0.4'; sleep.textContent = 'Slept'; }); });
          const close = document.createElement('button');
          close.className = 'btn'; close.style.cssText = 'padding:4px 8px;font-size:10px;border:1px solid var(--wo-popup-soft-danger-line);color:var(--wo-popup-soft-danger);';
          close.textContent = 'Close';
          close.addEventListener('click', () => { close.disabled = true; chrome.runtime.sendMessage({ kind: 'memory-close-tab', tabId: z.id }, () => { void chrome.runtime.lastError; row.style.opacity = '0.4'; close.textContent = 'Closed'; }); });
          btns.appendChild(sleep); btns.appendChild(close);
          row.appendChild(btns);
        }
        out.appendChild(row);
      });
    });
  });

  const freeBtn = $('mem-free');
  if (freeBtn) freeBtn.addEventListener('click', () => {
    freeBtn.disabled = true; freeBtn.textContent = 'Freeing…';
    const out = $('mem-free-result');
    chrome.runtime.sendMessage({ kind: 'memory-free-ram' }, (r) => { void chrome.runtime.lastError;
      freeBtn.disabled = false; freeBtn.textContent = 'Free RAM now';
      if (out) {
        out.style.display = 'block';
        if (r && r.ok) {
          out.textContent = 'Slept ' + r.slept + ' tab' + (r.slept === 1 ? '' : 's') + '. Kept ' + r.kept + ' (active, pinned, audio, forms, etc.).';
        } else { out.textContent = 'Could not free RAM right now.'; }
      }
      setTimeout(loadScore, 400);
    });
  });

  const dupBtn = $('mem-dupes');
  if (dupBtn) dupBtn.addEventListener('click', () => {
    const out = $('mem-dupes-result');
    dupBtn.disabled = true; dupBtn.textContent = 'Checking…';
    chrome.runtime.sendMessage({ kind: 'memory-duplicates' }, (r) => {
      dupBtn.disabled = false; dupBtn.textContent = 'Check for duplicate tabs';
      if (!out) return;
      out.style.display = 'block';
      if (!r || !r.ok) { out.textContent = 'Could not check duplicates.'; return; }
      if (!r.extraCount) { out.textContent = 'No duplicate tabs found.'; return; }
      out.textContent = '';
      const line = document.createElement('div');
      line.textContent = 'You have ' + r.extraCount + ' duplicate tab' + (r.extraCount === 1 ? '' : 's') + ' across ' + (Array.isArray(r.groups) ? r.groups.length : 0) + ' page(s).';
      line.style.marginBottom = '6px';
      out.appendChild(line);
      const close = document.createElement('button');
      close.className = 'btn';
      close.style.cssText = 'width:100%;font-size:11px;border:1px solid var(--wo-popup-soft-danger-line);color:var(--wo-popup-soft-danger);';
      close.textContent = 'Close ' + r.extraCount + ' duplicate' + (r.extraCount === 1 ? '' : 's') + ' (keep one of each)';
      close.addEventListener('click', () => {
        if (!confirm('Close ' + r.extraCount + ' duplicate tab(s)? One copy of each page is kept.')) return;
        close.disabled = true; close.textContent = 'Closing…';
        chrome.runtime.sendMessage({ kind: 'memory-close-duplicates' }, (rr) => { void chrome.runtime.lastError;
          out.textContent = (rr && rr.ok) ? ('Closed ' + rr.closed + ' duplicate tab(s).') : 'Could not close duplicates.';
          setTimeout(loadScore, 400);
        });
      });
      out.appendChild(close);
    });
  });
})();

$('perm-scan').addEventListener('click', () => runPermScan(false));
$('perm-reset').addEventListener('click', () => resetSitePermissions());
function runPermScan(isAuto) {
  const btn = $('perm-scan');
  const host = $('perm-host');
  const out = $('perm-result');
  btn.disabled = true; btn.textContent = 'Scanning…';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !/^https?:/.test(tab.url || '')) {
      btn.disabled = false; btn.textContent = 'Scan';
      out.style.display = 'block'; out.textContent = '';
      out.appendChild(makeLine('Open a normal web page (http/https) to scan its permissions.', 'var(--ink-faint)'));
      return;
    }
    let hostname = '';
    try { hostname = new URL(tab.url).hostname; } catch {}
    permScanUrl = tab.url;
    host.textContent = 'Permissions for ' + hostname + ' — open the list below to change each one.';
    let done = false;
    const finishScan = (res, err) => {
      if (done) return;
      done = true;
      clearTimeout(scanTimer);
      btn.disabled = false; btn.textContent = 'Re-scan';
      out.style.display = 'block'; out.textContent = '';
      if (err) {
        out.appendChild(makeLine('Permission scan could not finish: ' + err, 'var(--ink-faint)'));
        return;
      }
      if (!res || !res.ok || !res.results || !res.results.length) {
        out.appendChild(makeLine((res && res.error) ? res.error : 'Could not read this site\'s permissions.', 'var(--ink-faint)'));
        return;
      }
      renderPermResults(out, hostname, res);
    };
    const scanTimer = setTimeout(() => finishScan(null, 'the browser did not answer in time'), 6000);
    try {
      chrome.runtime.sendMessage({ kind: 'scan-site-permissions', url: tab.url }, (res) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        finishScan(res, err);
      });
    } catch (e) {
      finishScan(null, String(e));
    }
  });
}

function resetSitePermissions() {
  const btn = $('perm-reset');
  const out = $('perm-result');
  const ok = confirm('Reset all readable site permissions for this site?\n\nThis returns camera, microphone, location, notifications, clipboard, pop-ups, downloads, and other browser-exposed site settings back to defaults for this site.\n\nThe site may ask again next time it needs access.');
  if (!ok) return;
  btn.disabled = true;
  btn.textContent = 'Resetting…';
  out.style.display = 'block';
  out.textContent = '';
  out.appendChild(makeLine('Resetting all supported site permissions for this site...', 'var(--ink-faint)'));
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !/^https?:/.test(tab.url || '')) {
      btn.disabled = false;
      btn.textContent = 'Reset all';
      out.textContent = '';
      out.appendChild(makeLine('Open a normal web page (http/https) first.', 'var(--ink-faint)'));
      return;
    }
    permScanUrl = tab.url;
    let done = false;
    const finishReset = (res, err) => {
      if (done) return;
      done = true;
      clearTimeout(resetTimer);
      btn.disabled = false;
      btn.textContent = 'Reset all';
      out.textContent = '';
      if (err) {
        out.appendChild(makeLine('Permission reset could not finish: ' + err, 'var(--ink-faint)'));
        return;
      }
      if (!res || !res.ok) {
        out.appendChild(makeLine((res && res.error) ? res.error : 'Could not reset this site\'s permissions.', 'var(--ink-faint)'));
        return;
      }
      const reset = res.reset && res.reset.length ? res.reset.join(', ') : 'supported permissions';
      out.appendChild(makeLine('Reset to browser defaults: ' + reset + '.', 'var(--wo-success)', true));
      if (res.unsupported && res.unsupported.length) {
        out.appendChild(makeLine('Chrome did not expose: ' + res.unsupported.join(', ') + '.', 'var(--ink-faint)'));
      }
      if (res.failed && res.failed.length) {
        out.appendChild(makeLine('Some permission categories could not be reset by Chrome.', 'var(--ink-faint)'));
      }
      setTimeout(() => runPermScan(true), 300);
    };
    const resetTimer = setTimeout(() => finishReset(null, 'the browser did not answer in time'), 8000);
    try {
      chrome.runtime.sendMessage({ kind: 'reset-site-permissions', url: tab.url }, (res) => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        finishReset(res, err);
      });
    } catch (e) {
      finishReset(null, String(e));
    }
  });
}

document.querySelectorAll('.perm-link').forEach((b) => {
  b.addEventListener('click', () => {
    const map = {
      camera: 'chrome://settings/content/camera',
      microphone: 'chrome://settings/content/microphone',
      notifications: 'chrome://settings/content/notifications',
      location: 'chrome://settings/content/location',
    };
    const url = map[b.getAttribute('data-perm')];
    if (url) chrome.tabs.create({ url });
  });
});

// ----- SessionShield: how old is this domain? (RDAP, on-demand) -----
$('ss-domage').addEventListener('click', () => {
  const out = $('ss-domage-result');
  const btn = $('ss-domage');
  out.style.display = 'block'; out.style.color = 'var(--ink-faint)';
  out.textContent = 'Looking up registration date…';
  btn.disabled = true; btn.textContent = 'Checking…';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    if (!domain) { btn.disabled = false; btn.textContent = 'Check domain age'; out.textContent = 'Open a normal web page first.'; return; }
    chrome.runtime.sendMessage({ kind: 'domain-age', domain }, (res) => { void chrome.runtime.lastError;
      btn.disabled = false; btn.textContent = 'Check domain age';
      out.textContent = '';
      if (!res || !res.ok) {
        out.style.color = 'var(--ink-faint)';
        out.textContent = (res && res.noDate) ? 'The registry didn\'t publish a registration date for this domain.'
          : (res && res.status === 404) ? 'No registration record found (it may be a subdomain or an unusual TLD).'
          : 'Could not reach the domain-age service right now. Try again shortly.';
        return;
      }
      // age + risk badge
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
      const ageNum = document.createElement('span');
      ageNum.style.cssText = 'font-weight:700;font-size:12px;color:var(--ink);';
      const yrs = res.ageDays >= 365 ? (Math.floor(res.ageDays / 365) + 'y ' + (res.ageDays % 365) + 'd') : (res.ageDays + ' day' + (res.ageDays === 1 ? '' : 's'));
      ageNum.textContent = 'Domain age: ' + yrs;
      head.appendChild(ageNum);
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:11px;font-weight:700;color:var(--wo-on-brand);background:' + riskFill(res.risk) + ';padding:2px 9px;border-radius:8px;';
      badge.textContent = res.risk;
      head.appendChild(badge);
      out.appendChild(head);
      const reg = document.createElement('div');
      reg.style.cssText = 'font-size:10.5px;color:var(--ink-soft);';
      try { reg.textContent = 'Registered ' + new Date(res.created).toLocaleDateString() + ' · ' + res.domain; }
      catch { reg.textContent = res.domain; }
      out.appendChild(reg);
      if (res.ageDays < 30) {
        out.appendChild(makeLine('This domain is very new. Brand-new domains are common in scams and phishing — be cautious about entering personal or payment details.', 'var(--wo-danger)'));
      }
    });
  });
});

$('verify-repair').addEventListener('click', () => {
  const btn = $('verify-repair');
  const out = $('repair-result');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  out.style.display = 'block';
  out.style.color = 'var(--ink-faint)';
  out.textContent = 'Verifying core files, settings, blocklist, and active tabs…';
  chrome.runtime.sendMessage({ kind: 'verify-repair' }, (report) => { void chrome.runtime.lastError;
    btn.disabled = false;
    btn.textContent = 'Verify & repair';
    if (!report) { out.style.color = 'var(--rose)'; out.textContent = 'Could not run the check — try reloading the extension.'; return; }
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const repaired = Array.isArray(report.repaired) ? report.repaired : [];
    const failed = checks.filter((c) => !c.ok);
    const addText = (text) => out.appendChild(document.createTextNode(text));
    const addBreak = () => out.appendChild(document.createElement('br'));
    const addStrong = (text) => {
      const b = document.createElement('b');
      b.textContent = text;
      out.appendChild(b);
    };
    const addSection = (title, color, items) => {
      addBreak();
      const span = document.createElement('span');
      span.style.color = color;
      span.style.fontWeight = '600';
      span.textContent = title;
      out.appendChild(span);
      items.forEach((item) => {
        addBreak();
        addText('- ' + String(item || ''));
      });
    };
    out.textContent = '';
    if (report.ok && !failed.length && !repaired.length) {
      out.style.color = 'var(--violet)';
      addStrong('All healthy.');
      addText(' Every component checked out - nothing needed fixing.');
    } else {
      out.style.color = 'var(--ink-soft)';
      addStrong('Check complete.');
      addBreak();
      addText(checks.length + ' components checked, ' + (checks.length - failed.length) + ' OK');
      if (repaired.length) addSection('Repaired:', 'var(--violet)', repaired);
      if (failed.length) {
        addSection('Still needs attention:', 'var(--rose)', failed.map((c) => c && c.name));
        addBreak();
        addBreak();
        addText('If issues persist, remove and reinstall the extension at chrome://extensions.');
      } else {
        addBreak();
        addBreak();
        addText('You may want to reload any open tabs for repairs to fully take effect.');
      }
    }
  });
});

;(function(){
  var inp=document.getElementById('wo-settings-search');
  if(inp){
    var nores=document.getElementById('wo-noresult');
    var clearBtn=document.getElementById('wo-search-clear');
    var countEl=document.getElementById('wo-search-count');

    // Related-term groups. Matching any word in a group also surfaces settings
    // described with any other word in the same group, so "adblock" finds the
    // AdShield pack, "tracker" finds analytics, "yt" finds YouTube, etc.
    var SYN=[
      ['ad','ads','adblock','adblocker','adblocking','adshield','advert','adverts','advertise','advertising','advertisement','advertisements','commercial','commercials','sponsor','sponsored','preroll','midroll','banner','banners','easylist','ublock','cosmetic'],
      ['track','tracker','trackers','tracking','analytics','telemetry','beacon','beacons','pixel','pixels','spy','spyware','snoop','snooping'],
      ['cookie','cookies','consent','gdpr','ccpa','supercookie','supercookies'],
      ['popup','popups','popunder','popunders','overlay','overlays','nag','nags','tidy','remover','interstitial','interstitials','modal','modals','dismiss','cleaner'],
      ['youtube','yt','video','playback','player'],
      ['twitch','ttv','stream','streamer','streaming'],
      ['fingerprint','fingerprinting','canvas','webgl'],
      ['ip','webrtc','grabber','grabbers','logger','iplogger','grabify','geolocation'],
      ['malware','virus','viruses','malicious','trojan','infected'],
      ['phish','phishing','scam','scams','fake','spoof','spoofing','lookalike','impersonate','homograph'],
      ['download','downloads','file','files','installer','installers'],
      ['video','media','autoplay','audio','sound','playback'],
      ['redirect','redirects','redirection','bounce','bounces','hop','hops'],
      ['js','javascript','script','scripts','scriptlet','noscript','webassembly','wasm'],
      ['cert','certs','certificate','certificates','ssl','tls','https','secure'],
      ['token','tokens','session','sessions','exfil','exfiltration','hijack','hijacking','credential','credentials','password','passwords'],
      ['camera','webcam','mic','microphone','capture','screenshare','screencapture'],
      ['social','embed','embeds','facebook','instagram','tiktok','twitter','widget'],
      ['storage','localstorage'],
      ['prefetch','preload','preconnect'],
      ['clipboard','paste','copy','clickfix'],
      ['memory','ram','tab','tabs','sleep','throttle','battery','cpu','performance'],
      ['notification','notifications','toast','toasts','badge','alert','alerts'],
      ['breach','breached','pwned','leak','leaked','haveibeenpwned'],
      ['skimmer','skimmers','magecart','card','cards','payment','payments','checkout'],
      ['referrer','referer'],
      ['adult','nsfw','porn','xxx'],
      ['techsupport','support','locker','scareware'],
      ['update','updates','outdated','version'],
      ['form','forms','login','signin'],
      ['keylogger','keystroke','keylogging'],
      ['silent','silence','quiet','noiseless','notification-free','stealth','stealthy','distraction','distraction-free'],
      ['eye','eyeshield','vision','brightness','contrast','saturation','warmth','grayscale','dim','readability','tint','comfort'],
      ['master','switch','toggle','all','everything'],
      ['media','camera','mic','microphone','screen','capture','audio','video','webcam'],
      ['review','extension','extensions','permission','permissions','manage','management','reviewer'],
      ['scan','scanner','scanning','check','audit','inspect'],
      ['panic','emergency','logout','clear','clean','cleanup','wipe','reset'],
      ['forget','forgetme','leave','wipe','clean','clear','history','login','logins','remember','remembered','stay','logged','signin','session'],
      ['badge','indicator','icon','toolbar','action'],
      ['search','query','filter','find','explore']
    ];
    function toks(s){return (String(s).toLowerCase().match(/[a-z0-9]+/g))||[];}

    // Build keyword set from an element's text + all relevant attributes.
    function buildKeywords(el){
      var base=el.textContent||'';
      var attrs='';
      // Extract data-key as words (camelCase -> space-separated)
      var dk=el.getAttribute('data-key');
      if(dk)attrs+=' '+dk.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
      // Extract data-eyeshield-mode
      var em=el.getAttribute('data-eyeshield-mode');
      if(em)attrs+=' '+em;
      // Extract data-mode
      var dm=el.getAttribute('data-mode');
      if(dm)attrs+=' '+dm;
      // Extract data-search-preset
      var sp=el.getAttribute('data-search-preset');
      if(sp)attrs+=' '+sp;
      // Extract data-perm
      var dp=el.getAttribute('data-perm');
      if(dp)attrs+=' '+dp;
      // Include the element's id and any parent section id
      var id=el.id;
      var parentIds='';
      if(id)parentIds+=' '+id.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
      // Walk up to find a section / group id
      var p=el.parentElement;
      for(var pi=0;pi<3&&p;p=p.parentElement,pi++){
        if(p.id)parentIds+=' '+p.id.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
      }
      var full=base+attrs+parentIds;
      // raw text for relevance scoring
      var rawLower=full.toLowerCase();
      var set=Object.create(null);
      toks(full).forEach(function(t){set[t]=1;});
      for(var i=0;i<SYN.length;i++){
        var g=SYN[i],hit=false;
        for(var j=0;j<g.length;j++){if(set[g[j]]){hit=true;break;}}
        if(hit){for(var k=0;k<g.length;k++)set[g[k]]=1;}
      }
      var words=Object.keys(set);
      return {el:el,words:words,text:' '+words.join(' ')+' ',raw:rawLower,attrs:attrs,parentIds:parentIds};
    }

    // Index ALL interactive/searchable elements in the popup.
    var rows=[];
    // Standard .row elements (all toggle rows inside card-groups)
    document.querySelectorAll('.row').forEach(function(row){rows.push(buildKeywords(row));});
    // EyeShield is one compound control. Indexing its descendants separately made a
    // search for "dark" hide Normal, Light, Ultra, brightness and Extras inside the
    // still-visible panel, leaving a broken one-button mode selector.
    var eyePanel=$('eyeshield-panel');
    if(eyePanel)rows.push(buildKeywords(eyePanel));
    // Master switch area
    var masterEl=$('master-state');
    if(masterEl)rows.push(buildKeywords(masterEl));
    // "Turn everything on" button
    var allOn=$('all-on');
    if(allOn)rows.push(buildKeywords(allOn));
    // Script Shield section rows and actions.
    ['js-global','js-smart','js-site','js-privacy-limits','js-shield-desc','script-trust-list','script-trust-add-current'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });
    // Search preset chips
    document.querySelectorAll('.wo-search-chip').forEach(function(el){rows.push(buildKeywords(el));});
    // The no-result area is status UI, not a searchable setting.
    // Scan site / breach / domain age buttons
    ['ss-scan','ss-sitebreach','ss-domage','ss-clear','ss-panic','cl-run','ext-review','ext-review-open','verify-repair','startup-run','mem-free','mem-dupes','mem-tab-usage','mem-zombies','perm-scan','perm-reset','ug-btn'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });
    // Additional action buttons in Memory Shield (mode buttons)
    document.querySelectorAll('.mem-mode').forEach(function(el){rows.push(buildKeywords(el));});
    // Tab limit controls
    ['tl-guard','tl-max','tl-idle','tl-close','tl-warn'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });
    // Download trust button
    var dtBtn=$('download-trust-add-current');
    if(dtBtn)rows.push(buildKeywords(dtBtn));
    // "Allowlist this site" button
    var alBtn=$('allowlist');
    if(alBtn)rows.push(buildKeywords(alBtn));
    // Add the section headings too so sections are findable by their heading text
    document.querySelectorAll('.group>h2, .eyeshield-panel+h2, #js-shield+h2').forEach(function(h3){
      if(h3.id==='eyeshield-title'||h3.id==='site-controls-title')return;
      rows.push(buildKeywords(h3));
    });
    // Activity log / Network buttons
    ['open-activity','open-network'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });

    // Damerau-Levenshtein, capped — tolerates typos like "adsheild"->"adshield".
    var seenSearchEls=[];
    rows=rows.filter(function(row){
      if(!row||!row.el)return false;
      if(seenSearchEls.indexOf(row.el)>=0)return false;
      seenSearchEls.push(row.el);
      return true;
    });

    function dist(a,b){
      var al=a.length,bl=b.length;
      if(!al)return bl;if(!bl)return al;
      if(al-bl>2||bl-al>2)return 3;
      var d=[],i,j;
      for(i=0;i<=al;i++){d[i]=[];d[i][0]=i;}
      for(j=0;j<=bl;j++)d[0][j]=j;
      for(i=1;i<=al;i++)for(j=1;j<=bl;j++){
        var cost=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;
        d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);
        if(i>1&&j>1&&a.charCodeAt(i-1)===b.charCodeAt(j-2)&&a.charCodeAt(i-2)===b.charCodeAt(j-1))
          d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
      }
      return d[al][bl];
    }

    // Returns a relevance score for a query token against a search row.
    // Higher = more relevant. Returns 0 if no match.
    function scoreMatch(qt,r){
      // Direct text match in the element's visible content — best
      var baseLower=(r.el.textContent||'').toLowerCase();
      if(baseLower.indexOf(qt)>=0)return 100;
      // Match in the combined raw text (base + attrs + parentIds)
      if(r.raw.indexOf(qt)>=0)return 80;
      // Match in attributes (data-key, data-eyeshield-mode, etc.)
      if(r.attrs.indexOf(qt)>=0)return 70;
      // Match in parent element ids (section names)
      if(r.parentIds.indexOf(qt)>=0)return 50;
      // Synonym match via expanded text
      if(r.text.indexOf(qt)>=0)return 40;
      // Fuzzy/typo match.
      // Two edits used to be allowed from six characters up, which is a third of a
      // six-letter word -- so searching "speech" matched "speed", and "speech rec"
      // returned Twitch local rewind, whose description happens to carry both "speed"
      // and "records". Two edits now need a word long enough for two edits to still
      // leave it recognisable. Every real typo this is for -- microphon, fingerprnt,
      // notifcation, clipboad, downlaod, certifcate -- is one edit, or long enough to
      // keep its allowance.
      if(qt.length>=4){
        var th=qt.length<=7?1:2,c0=qt.charCodeAt(0);
        for(var i=0;i<r.words.length;i++){
          var w=r.words[i];
          if(w.charCodeAt(0)!==c0)continue;
          if(w.length-qt.length>th||qt.length-w.length>th)continue;
          if(dist(qt,w)<=th)return 20;
        }
      }
      return 0;
    }

    function run(){
      var raw=(inp.value||'').trim();
      var q=raw.toLowerCase();
      var qts=toks(q);
      var shown=0;
      for(var i=0;i<rows.length;i++){
        var row=rows[i];
        var ok=true;
        for(var t=0;t<qts.length;t++){
          var sc=scoreMatch(qts[t],row);
          if(sc===0){ok=false;break;}
        }
        row.el.classList.toggle('wo-hidden',!ok);
        if(ok)shown++;
      }
      // Hide/show card-groups based on whether they have any visible .row
      document.querySelectorAll('.card-group').forEach(function(g){
        var hide=!!q&&!g.querySelector('.row:not(.wo-hidden)');
        g.classList.toggle('wo-hidden',hide);
        var hh=g.previousElementSibling;
        if(hh&&/^H[1-6]$/.test(hh.tagName))hh.classList.toggle('wo-hidden',hide);
        var rewind=g.parentElement;
        if(rewind&&rewind.classList.contains('rewind-drop')){
          var rewindOpenAttr='data-wo-search-was-open';
          if(q){
            if(!rewind.hasAttribute(rewindOpenAttr))rewind.setAttribute(rewindOpenAttr,rewind.open?'true':'false');
            rewind.classList.toggle('wo-hidden',hide);
            if(!hide)rewind.open=true;
          }else{
            rewind.classList.remove('wo-hidden');
            if(rewind.hasAttribute(rewindOpenAttr)){
              rewind.open=rewind.getAttribute(rewindOpenAttr)==='true';
              rewind.removeAttribute(rewindOpenAttr);
            }
          }
        }
      });
      // The panel itself is the indexed result, so its heading follows that one
      // semantic match while every control inside keeps its normal layout.
      if(eyePanel){
        var eyeVisible=!eyePanel.classList.contains('wo-hidden');
        var eyeH3=eyePanel.previousElementSibling;
        if(eyeH3&&/^H[1-6]$/.test(eyeH3.tagName))eyeH3.classList.toggle('wo-hidden',!eyeVisible);
      }
      // Hide/show master switch + Turn everything on when searching
      var masterArea=document.querySelector('.master');
      if(masterArea){
        var masterVisible=!q||!masterArea.querySelector('.wo-hidden');
        masterArea.classList.toggle('wo-hidden',!masterVisible);
      }
      var topQuick=document.querySelector('.top-quick');
      if(topQuick){
        var tqVisible=!q||!topQuick.querySelector('.wo-hidden');
        topQuick.classList.toggle('wo-hidden',!tqVisible);
      }
      // Hide/show the JavaScript shield section
      var jsShield=$('js-shield');
      if(jsShield){
        var jsVisible=!q||!jsShield.querySelector('.wo-hidden');
        jsShield.classList.toggle('wo-hidden',!jsVisible);
        var jsH3=jsShield.previousElementSibling;
        if(jsH3&&/^H[1-6]$/.test(jsH3.tagName))jsH3.classList.toggle('wo-hidden',!jsVisible);
      }
      // Hide/show the search panel itself when there's a query that matches nothing?
      // (Leave it visible always so user can clear the search)
      if(nores)nores.style.display=(q&&shown===0)?'block':'none';
      if(clearBtn)clearBtn.style.display=raw?'flex':'none';
      if(countEl){
        countEl.textContent=q?(shown+' result'+(shown===1?'':'s')):'';
        countEl.classList.toggle('has-results',!!q);
      }
      saveSearchSoon();
    }

    inp.addEventListener('input',run);
    inp.addEventListener('search',run);
    if(clearBtn)clearBtn.addEventListener('click',function(){inp.value='';run();inp.focus();});
    document.querySelectorAll('[data-search-preset]').forEach(function(btn){
      btn.addEventListener('click',function(){
        inp.value=btn.getAttribute('data-search-preset')||btn.textContent||'';
        run();
        inp.focus();
      });
    });

    // ---- remember the query across popup opens (convenience) ----
    var searchSaveTimer=0, restoringSearch=false;
    function persistSearch(){
      var raw=(inp.value||'').trim();
      var store=popupScrollStore();
      if(raw)store.set({[POPUP_SEARCH_KEY]:{q:raw,at:Date.now()}});
      else store.remove(POPUP_SEARCH_KEY);
    }
    function saveSearchSoon(){
      if(restoringSearch)return;
      clearTimeout(searchSaveTimer);
      searchSaveTimer=setTimeout(persistSearch,120);
    }
    function flushSearch(){ if(restoringSearch)return; clearTimeout(searchSaveTimer); persistSearch(); }
    restorePopupSearch=function(done){
      popupScrollStore().get(POPUP_SEARCH_KEY,function(res){
        var e=res&&res[POPUP_SEARCH_KEY];
        var saved=String((e&&typeof e==='object'?e.q:e)||'');
        if(saved){ restoringSearch=true; inp.value=saved; run(); restoringSearch=false; }
        if(typeof done==='function')done();
      });
    };
    window.addEventListener('pagehide',flushSearch);
    document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='hidden')flushSearch(); });
  }
  var pl=document.getElementById('wo-perms-link');
  if(pl)pl.addEventListener('click',function(e){try{e.preventDefault();chrome.tabs.create({url:chrome.runtime.getURL('permissions.html')});}catch(_){}});
})();

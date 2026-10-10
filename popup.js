/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* WardenOne popup logic */

// Label switches before other startup work so a later error cannot leave them unnamed.
try { labelToggleControls(); } catch (_) {}

/* An action popup sizes itself from its content, so its body needs an intrinsic width.
   An extension page opened in a browser tab can instead reflow with the viewport. */
try {
  chrome.tabs.getCurrent((tab) => {
    if (tab) document.documentElement.classList.add('wo-popup-tab');
  });
} catch (_) {}

// Re-query cached ids when a dynamic section replaces its node.
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
  'blockGrabberResources', 'warnGrabberDomains', 'blockWebRTCLeak', 'blockSuspiciousWebRTC', 'certificateGuard', 'blockTrackers', 'adShield', 'googleSearchResultCleanup', 'blockSearchAiAnswers', 'blockSponsoredSearchResults', 'googleWebResultsOnly', 'flagSearchJunk', 'warnSearchResults', 'scriptletEngine', 'twitchAdBlock', 'twitchSteadyPlayback', 'twitchRewind', 'twitchVodRewind', 'sendPrivacySignals', 'antiFingerprintNoise', 'fingerprintProbeDetection', 'blockFingerprintScripts', 'blockFraudVendorScripts', 'blockThirdPartyCookies', 'blockAllCookies', 'blockFirstPartyTrackers', 'sessionShield', 'blockTokenExfil', 'continuousTokenScan', 'detectSkimmers', 'paymentCardGuard', 'breachCheck', 'forceHttps', 'insecureLoginGuard', 'loginAgeCheck', 'downloadReputation', 'downloadDomainAge', 'downloadSafeBrowsing', 'downloadVirusTotal', 'downloadVirusTotalHash', 'urlHaus', 'abuseIpDb', 'openPhish', 'phishTank', 'whoisXml', 'whoisXmlReputation', 'whoisXmlThreatIntel', 'clipboardGuard', 'clipboardSwapDetect', 'keystrokePressure', 'honeytokenMode', 'scamLockGuard', 'commandPasteGuard', 'pasteProtection', 'formTrapDetector', 'fakeUpdateDetector', 'permissionChainGuard', 'oauthGuard', 'scriptDriftGuard', 'riskySiteMode', 'antiClickjacking', 'intranetProtection', 'intranetNetworkRules', 'dnsRebindGuard', 'storageAccessGuard', 'blockAllStorageAccess', 'loginCompatibility', 'watchExtensionPermissions', 'startupCheck',
  'mediaShield', 'fullscreenGuard', 'fakeWindowGuard', 'notificationAbuseGuard', 'blockCameraMic', 'blockScreenCapture', 'blockGeolocation', 'blockAutoplayMedia',
  'gateAdultSites', 'adultHeuristics', 'safeSearch',
  'warnRedirectParams', 'warnShorteners', 'monitorLoggerApi', 'detectPhishing', 'blockHighConfidencePhishing', 'behavioralScan', 'xssBehaviorGuard', 'removeOverlays', 'autoSkipDownloadAds', 'blockMalwareSites', 'blockCryptominers', 'cryptominerCpuWatch', 'autoUpdateLists',
  'showToasts', 'showBadge', 'silentMode', 'elementZapper',
  'memoryShield', 'memoryNeverPinned', 'memoryNeverAudio', 'memoryNeverForms', 'memoryNeverPayment',
  'blockAutoplay', 'throttleBackgroundTabs', 'killPrefetch', 'lazyLoadMedia', 'disableYouTubeAmbientMode', 'stopAnimatedVideoPreviews', 'pauseAnimatedImages',
  'deAmp', 'clientHintProtection', 'capReferrer', 'trackerCacheProtection', 'autoRejectConsent', 'removeConsentWalls', 'mailTrackingShield',
  'trackerLearner', 'unshimLinks', 'stripTrackingParams', 'cleanCopyLinks', 'socialWidgetGuard', 'blockSupercookies'
];

const DEFAULTS = {
  enabled: true,
  blockGesturelessNav: true, blockForcedPopups: true, strictPopupShield: true, blockPopupTricks: true, backTrapGuard: true, clearCookiesOnLeave: false, clearServiceWorkersOnLeave: false, blockMetaRefresh: true,
  detectRedirectChains: true, warnGrabberDomains: true, blockGrabberResources: true,
  blockWebRTCLeak: true, certificateGuard: true, blockTrackers: true, adShield: true, googleSearchResultCleanup: false, blockSearchAiAnswers: false, blockSponsoredSearchResults: false, googleWebResultsOnly: false, flagSearchJunk: false, warnSearchResults: true, scriptletEngine: true, twitchAdBlock: true, twitchSteadyPlayback: true, twitchRewind: false, twitchRewindMinutes: 5, twitchVodRewind: true, sendPrivacySignals: true, antiFingerprintNoise: false, fingerprintProbeDetection: true, blockFingerprintScripts: true, blockFraudVendorScripts: false, antiFingerprint: false, blockThirdPartyCookies: true, blockAllCookies: false, blockFirstPartyTrackers: false, sessionShield: true, blockTokenExfil: true, continuousTokenScan: true, detectSkimmers: true, paymentCardGuard: true, breachCheck: false, forceHttps: false, insecureLoginGuard: true, loginAgeCheck: false, loginAgeMaxDays: 14, downloadReputation: true, downloadDomainAge: false, downloadSafeBrowsing: false, downloadSafeBrowsingKey: '', downloadVirusTotal: false, downloadVirusTotalHash: false, downloadVirusTotalKey: '', urlHaus: false, urlHausKey: '', abuseIpDb: false, abuseIpDbKey: '', openPhish: false, phishTank: false, phishTankKey: '', whoisXml: false, whoisXmlKey: '', whoisXmlReputation: false, whoisXmlThreatIntel: false, clipboardGuard: false, clipboardSwapDetect: true, keystrokePressure: false, honeytokenMode: false, scamLockGuard: true, commandPasteGuard: true, pasteProtection: true, formTrapDetector: true, fakeUpdateDetector: true, permissionChainGuard: true, oauthGuard: true, scriptDriftGuard: true, riskySiteMode: true, antiClickjacking: true, intranetProtection: true, intranetNetworkRules: true, dnsRebindGuard: true, storageAccessGuard: true, blockAllStorageAccess: false, loginCompatibility: true, watchExtensionPermissions: true, startupCheck: true, gateAdultSites: true, adultHeuristics: true, safeSearch: false,
  mediaShield: true, fullscreenGuard: true, fakeWindowGuard: true, notificationAbuseGuard: true, blockCameraMic: true, blockScreenCapture: true, blockGeolocation: true, blockAutoplayMedia: true, blockSuspiciousWebRTC: false,
  eyeShield: false, eyeShieldMode: 'off', eyeShieldBrightness: 100, eyeShieldBrightnessByHost: {},
  eyeShieldContrast: 100, eyeShieldContrastByHost: {}, eyeShieldSaturation: 100, eyeShieldSaturationByHost: {},
  eyeShieldWarmth: 0, eyeShieldWarmthByHost: {}, eyeShieldGrayscale: 0, eyeShieldGrayscaleByHost: {},
  eyeShieldSites: {},
  warnRedirectParams: true, warnShorteners: true, monitorLoggerApi: true,
  detectPhishing: true, blockHighConfidencePhishing: true, behavioralScan: true, xssBehaviorGuard: true, removeOverlays: true, autoSkipDownloadAds: true, blockMalwareSites: true, blockCryptominers: true, cryptominerCpuWatch: false, autoUpdateLists: true,
  showToasts: true, showBadge: true, showDownloadBar: true, silentMode: false, elementZapper: true,
  notificationSettings: typeof wardenNotificationDefaultSettings === 'function' ? wardenNotificationDefaultSettings() : { version: 4, defaultDuration: 'reading', position: 'top-right', retentionDays: 30, groupSimilar: true, badgeEnabled: false, soundEnabled: false, soundMode: 'important', volume: 0.55, rules: {} },
  memoryShield: true, memoryMode: 'balanced', memoryMinutesOverride: 0,
  memoryNeverPinned: true, memoryNeverAudio: true, memoryNeverForms: true, memoryNeverPayment: true,
  tabLimitGuard: false, tabLimitMax: 20, tabLimitClose: false, tabLimitMinIdleMinutes: 30, tabLimitWarn: true,
  blockAutoplay: false, throttleBackgroundTabs: false, killPrefetch: false, lazyLoadMedia: false, disableYouTubeAmbientMode: false, stopAnimatedVideoPreviews: false, pauseAnimatedImages: false,
  webglSaverMode: 'off', webglSaverBlockHosts: [], webglSaverAllowHosts: [],
  deAmp: false, clientHintProtection: true, capReferrer: false, trackerCacheProtection: false, autoRejectConsent: true, removeConsentWalls: false, mailTrackingShield: true,
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

// Include worker-only settings so exported backups round-trip through the popup importer.
const IMPORT_ONLY_DEFAULTS = {
  logThirdPartyBeacons: true,
  downloadHardBlockCritical: true,
  downloadHashCheck: true,
  deviceAccessGuard: true,
  capabilityGuard: true,
  memoryNeverSleepHosts: [],
};
const IMPORT_SCHEMA = Object.assign({}, IMPORT_ONLY_DEFAULTS, DEFAULTS);

/* Only page-side protections can be turned off per site. "mixed" leaves the network or worker
   half running; "coordinated" also stops the worker backstop. Unlisted keys are rejected. */
const SITE_OVERRIDE_SCOPE = {
  page: [
    'blockGesturelessNav', 'backTrapGuard', 'blockMetaRefresh',
    'blockSuspiciousWebRTC', 'twitchAdBlock', 'twitchSteadyPlayback', 'twitchRewind', 'twitchVodRewind', 'blockFirstPartyTrackers',
    'sessionShield', 'blockTokenExfil', 'continuousTokenScan', 'breachCheck', 'insecureLoginGuard',
    'clipboardGuard', 'clipboardSwapDetect', 'keystrokePressure', 'honeytokenMode', 'scamLockGuard',
    'commandPasteGuard', 'pasteProtection', 'formTrapDetector', 'fakeUpdateDetector', 'riskySiteMode',
    'antiClickjacking', 'storageAccessGuard', 'blockAllStorageAccess', 'mediaShield', 'fullscreenGuard',
    'fakeWindowGuard', 'notificationAbuseGuard', 'blockCameraMic', 'blockScreenCapture', 'blockAutoplayMedia',
    'gateAdultSites', 'adultHeuristics', 'warnRedirectParams', 'warnShorteners', 'monitorLoggerApi',
    'detectPhishing', 'blockHighConfidencePhishing', 'behavioralScan', 'xssBehaviorGuard', 'removeOverlays',
    'autoSkipDownloadAds', 'showToasts', 'showBadge', 'blockAutoplay', 'throttleBackgroundTabs', 'killPrefetch',
    'lazyLoadMedia', 'deAmp', 'cleanCopyLinks', 'socialWidgetGuard', 'blockSupercookies',
  ],
  mixed: [
    'blockPopupTricks', 'clearCookiesOnLeave', 'detectRedirectChains', 'blockGrabberResources', 'warnGrabberDomains',
    'blockWebRTCLeak', 'blockTrackers', 'adShield', 'googleSearchResultCleanup', 'blockSearchAiAnswers',
    'blockSponsoredSearchResults', 'flagSearchJunk', 'warnSearchResults', 'scriptletEngine', 'sendPrivacySignals',
    'antiFingerprintNoise', 'fingerprintProbeDetection', 'blockFingerprintScripts', 'blockThirdPartyCookies',
    'blockAllCookies', 'detectSkimmers', 'paymentCardGuard', 'forceHttps', 'loginAgeCheck', 'downloadReputation',
    'downloadSafeBrowsing', 'urlHaus', 'abuseIpDb', 'openPhish', 'phishTank', 'whoisXml', 'whoisXmlReputation',
    'whoisXmlThreatIntel', 'permissionChainGuard', 'oauthGuard', 'scriptDriftGuard', 'intranetProtection',
    'blockGeolocation', 'silentMode', 'capReferrer', 'autoRejectConsent', 'removeConsentWalls', 'mailTrackingShield',
    'trackerLearner', 'unshimLinks', 'stripTrackingParams',
  ],
  coordinated: ['blockForcedPopups', 'strictPopupShield'],
};
const SITE_OVERRIDE_KEYS = new Set([].concat(SITE_OVERRIDE_SCOPE.page, SITE_OVERRIDE_SCOPE.mixed, SITE_OVERRIDE_SCOPE.coordinated));
const SITE_OVERRIDE_MIXED = new Set(SITE_OVERRIDE_SCOPE.mixed);

// Keep costly or compatibility-sensitive switches out of "Turn everything on".
const MANUAL_ONLY_TOGGLES = new Set(['blockAllCookies', 'silentMode', 'cryptominerCpuWatch', 'trackerCacheProtection', 'blockAllStorageAccess', 'blockSuspiciousWebRTC']);
const ACTIVE_TAB_RELOAD_TOGGLES = new Set(['adShield', 'scriptletEngine', 'antiFingerprintNoise', 'fingerprintProbeDetection', 'blockFingerprintScripts', 'blockFraudVendorScripts', 'xssBehaviorGuard', 'commandPasteGuard', 'riskySiteMode', 'antiClickjacking', 'intranetProtection', 'googleSearchResultCleanup', 'blockSearchAiAnswers', 'blockSponsoredSearchResults', 'googleWebResultsOnly', 'flagSearchJunk', 'warnSearchResults', 'paymentCardGuard', 'blockGeolocation']);

const REPUTATION_PROVIDERS = [
  { key: 'urlHaus', keyField: 'urlHausKey', statusId: 'urlhaus-key-status', label: 'URLhaus', use: 'malware URL and download intelligence', emptyText: 'Paste a URLhaus Auth-Key to enable malware URL/download checks.', activeText: 'URLhaus malware URL checks are on. Known malware delivery URLs will be blocked.' },
  { key: 'abuseIpDb', keyField: 'abuseIpDbKey', statusId: 'abuseipdb-key-status', label: 'AbuseIPDB', use: 'malicious IP reports and suspicious server warnings', emptyText: 'Paste an AbuseIPDB API key to enable raw-IP server reputation.', activeText: 'AbuseIPDB raw-IP reputation is on. 75%+ abuse confidence blocks; 25-74 warns.' },
  // OpenPhish is keyless: the community feed is fetched whole, so there is no field and no
  // stored token. There used to be an "Optional OpenPhish token" here that nothing read (BUG-09).
  { key: 'openPhish', noKey: true, statusId: 'openphish-key-status', label: 'OpenPhish', use: 'phishing intelligence feed and fake login detection', emptyText: 'No key required for the OpenPhish Community feed. Test the feed to enable it.', activeText: 'OpenPhish Community feed is on. Known phishing URLs will be blocked from the cached feed.' },
  { key: 'phishTank', keyField: 'phishTankKey', statusId: 'phishtank-key-status', label: 'PhishTank', use: 'community phishing database checks', emptyText: 'Paste a PhishTank API key to enable phishing URL reputation.', activeText: 'PhishTank URL reputation is on. Verified current phishing URLs will be blocked.' },
  { key: 'whoisXml', keyField: 'whoisXmlKey', statusId: 'whoisxml-key-status', label: 'WhoisXML API', use: 'domain registration age and ownership clues', emptyText: 'Paste a WhoisXML API key to enable domain age and ownership clues.', activeText: 'WhoisXML API is on. Download Guard will use richer domain age, registrar, and ownership clues.' },
  { key: 'whoisXmlReputation', keyField: 'whoisXmlKey', statusId: 'whoisxml-reputation-status', label: 'WhoisXML Domain Reputation', use: 'domain reputation scoring and blocklist warnings', autoEnableOnKeyChange: false, emptyText: 'Uses the WhoisXML API key above. Test it to enable domain reputation scoring.', activeText: 'WhoisXML Domain Reputation is on. Low reputation and malware/phishing warnings raise risk.' },
  { key: 'whoisXmlThreatIntel', keyField: 'whoisXmlKey', statusId: 'whoisxml-threat-status', label: 'WhoisXML Threat Intelligence', use: 'IoC matches for malicious domains, URLs, and IPs', autoEnableOnKeyChange: false, emptyText: 'Uses the WhoisXML API key above. Test it to enable IoC threat intelligence.', activeText: 'WhoisXML Threat Intelligence is on. Malware/phishing IoC matches will be blocked.' },
];

let config = Object.assign({}, DEFAULTS);
// Diff against this snapshot so popup saves do not overwrite another surface's changes.
let savedConfigSnapshot = configClone(DEFAULTS);
let eyeShieldHost = '';
let eyeShieldSaveTimer = 0;
let eyeShieldEditGeneration = 0;
let eyeShieldStatusTimer = 0;

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

// Prefer reporting an owned key as changed over losing a popup edit.
function popupChangedKeys() {
  const keys = new Set(Object.keys(config));
  Object.keys(savedConfigSnapshot).forEach((k) => keys.add(k));
  const changed = [];
  keys.forEach((k) => { if (configValuesDiffer(config[k], savedConfigSnapshot[k])) changed.push(k); });
  return changed;
}

const POPUP_SEARCH_KEY = 'wardenone_popup_search_memory';
// Reassigned by the settings-search block once it's wired; restores the last query
// on popup open so reopening jumps straight back to what you were looking at.
let restorePopupSearch = (done) => { if (typeof done === 'function') done(); };

function applyToUI() {
  const enabledEl = $('enabled');
  enabledEl.checked = config.enabled !== false;
  updateMasterState();

  KEYS.forEach((k) => {
    document.querySelectorAll(`input[data-key="${k}"]`).forEach((el) => {
      el.checked = config[k] !== false;
    });
  });
  /* The engine runs fingerprint noise when the switch OR its legacy alias is on, and the
     Maximum privacy bundle used to set the alias too -- so after choosing it, this switch read
     off-able but turning it off changed nothing. It shows the truth here, and saving folds the
     alias into it (readFromUI). */
  if (config.antiFingerprint === true) {
    document.querySelectorAll('input[data-key="antiFingerprintNoise"]').forEach((el) => { el.checked = true; });
  }
  document.querySelectorAll('[data-config-text]').forEach((el) => {
    const key = el.getAttribute('data-config-text');
    el.value = config[key] || '';
  });
  renderMutedToasts(config);
  if ($('ss-pick')) $('ss-pick').disabled = config.elementZapper === false;
  try { renderHiddenList(); } catch (_) {}
  syncBreachVisibility();
  syncProviderStatus();
  reflectMasterDisable();
  reflectSilentMode();
  paintEyeShield();
  loadJsShieldState();
  paintTabLimitUI();
  paintForgetMe();
  paintMemoryModes();
  paintWebGLSaver();
  paintTwitchRewindUI();
}

/* STORE-OMIT-TWITCH-PAINT-BEGIN */
// Reflect the Twitch rewind buffer length into its number input. Not a data-key
// control, so "Turn everything on" never changes the buffer size.
function paintTwitchRewindUI() {
  const mins = $('tr-minutes');
  if (mins) mins.value = Number(config.twitchRewindMinutes) > 0 ? Number(config.twitchRewindMinutes) : 5;
}
/* STORE-OMIT-TWITCH-PAINT-END */

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
  blocked_grabber_pixel: 'IP-logging image blocked',
  warned_grabber_image: 'Possible IP logger detected',
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
  detected_manual_check: 'WardenOne check',
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
  const eyeScope = $('eyeshield-scope-button');
  if (eyeScope) eyeScope.disabled = !on || !eyeShieldHost;
  document.querySelectorAll('.eyeshield-mode').forEach((btn) => { btn.disabled = !on; });
  document.querySelectorAll('.eyeshield-range').forEach((r) => { r.disabled = !on; });
}

// Silent is painted over the toast and badge switches, never into them. The two controls are
// greyed while it is on and keep showing the preference underneath, which is what the page
// gets back the moment Silent is off; the bridge gates the page's copy (gateSilentPresentation
// in bridge.js), so nothing here needs to write them false. It used to: the switches were unchecked as well
// as greyed, the generic change handler read them back through readFromUI on the very next
// save, and turning Silent off left both stored off.
function reflectSilentMode() {
  const disabled = config.silentMode === true || !$('enabled').checked;
  ['showToasts', 'showBadge'].forEach((key) => {
    const el = document.querySelector(`input[data-key="${key}"]`);
    if (el) {
      const tg = el.closest('.tg');
      if (tg) tg.classList.toggle('disabled', disabled);
    }
  });
}

// The one-time repair for a profile the old popup already damaged. Every save it made while
// Silent was on wrote both switches false, so a profile arriving here with Silent on and both
// off is carrying Silent's writes, not a choice: the switches were disabled the whole time,
// so nobody could have made one. When such a profile turns Silent off, Normal is put back
// to what Normal means -- both on -- instead of a silence nobody asked for. It runs only on
// that transition and only for that exact signature; a profile with Silent off is never
// touched, and a reader who had turned off just one of the two keeps it off.
function repairSilentModeRewrite(wasSilent) {
  if (!wasSilent || config.silentMode === true) return false;
  if (config.showToasts !== false || config.showBadge !== false) return false;
  config.showToasts = true;
  config.showBadge = true;
  return true;
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
      if (res.persisted === false) setSavedTick('Private-window JavaScript change lasts only for this session', false);
    });
  });
}

function readFromUI() {
  const previousProviderKeys = {
    downloadSafeBrowsingKey: config.downloadSafeBrowsingKey || '',
    downloadVirusTotalKey: config.downloadVirusTotalKey || '',
    urlHausKey: config.urlHausKey || '',
    abuseIpDbKey: config.abuseIpDbKey || '',
    phishTankKey: config.phishTankKey || '',
    whoisXmlKey: config.whoisXmlKey || '',
  };
  const wasSilent = config.silentMode === true;
  config.enabled = $('enabled').checked;
  KEYS.forEach((k) => {
    const els = document.querySelectorAll(`input[data-key="${k}"]`);
    if (els.length) config[k] = els[0].checked;
  });
  /* One switch, one meaning: the fingerprint-noise switch is the whole truth once saved. */
  if (document.querySelector('input[data-key="antiFingerprintNoise"]')) config.antiFingerprint = false;
  config.googleSearchResultCleanup = false;
  config.showDownloadBar = true;
  // Silent mode does not write showToasts/showBadge: the bridge gates what the page gets
  // (gateSilentPresentation), and the switches here keep the preference for when Silent is off.
  repairSilentModeRewrite(wasSilent);
  document.querySelectorAll('[data-config-text]').forEach((el) => {
    const key = el.getAttribute('data-config-text');
    config[key] = el.value.trim();
  });
  normalizeProviderSettings(previousProviderKeys);
}

function normalizeProviderSettings(previousProviderKeys) {
  void previousProviderKeys;
  const vtKey = String(config.downloadVirusTotalKey || '').trim();
  if (!vtKey) {
    config.downloadVirusTotal = false;
    config.downloadVirusTotalHash = false;
  }
  const sbKey = String(config.downloadSafeBrowsingKey || '').trim();
  if (!sbKey) config.downloadSafeBrowsing = false;
  REPUTATION_PROVIDERS.forEach((p) => {
    // A saved key is for manual checks; only the separate switch consents to automatic lookups.
    if (p.noKey || !p.keyField) return;
    const nextKey = String(config[p.keyField] || '').trim();
    if (!nextKey) config[p.key] = false;
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
  if (meta.noKey || !meta.keyField) {
    const on = config[meta.key] === true;
    el.textContent = on ? (meta.activeText || (meta.label + ' is on.')) : (meta.emptyText || (meta.label + ' is off.'));
    el.style.color = on ? 'var(--plum)' : 'var(--ink-faint)';
    return;
  }
  const hasKey = !!String(config[meta.keyField] || '').trim();
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

function publicConfig(cfg, tabUrl) {
  const out = Object.assign({}, cfg || {});
  delete out.downloadSafeBrowsingKey;
  delete out.downloadVirusTotalKey;
  delete out.forgetMeAllConfirmedAt;
  REPUTATION_PROVIDERS.forEach((p) => { if (p.keyField) delete out[p.keyField]; });
  let host = '';
  try { host = new URL(tabUrl).hostname; } catch (_) {}
  out.eyeShieldSites = WOEyeShieldProfiles.forHost(out.eyeShieldSites, host);
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
    reconcileForgetHistoryPermission();
    updateAllowlistBtn();
    // Painted after applyToUI so the per-site list can read each protection's
    // label out of its own row rather than keeping a second copy of the wording.
    wireSiteControls();
    paintSiteControls();
    wireMyFilters();
    renderDownloadTrustList();
    renderTrackerLearner();
    renderTrackerProposals();
    loadExtensionAlerts();
    loadStartupReport();
    renderProtectionHealth();
    refreshSiteDashboard();
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
    savedTickTimer = setTimeout(() => { tick.textContent = 'Changes save automatically'; tick.style.color = ''; }, dwell);
  }
}

// A disabled provider can still be used for a right-click check. Keep its key
// until the reader erases the field, while the switch alone authorizes automatic checks.
const PROVIDER_KEY_FIELDS = {
  downloadSafeBrowsing: 'downloadSafeBrowsingKey',
  downloadVirusTotal: 'downloadVirusTotalKey',
  urlHaus: 'urlHausKey',
  abuseIpDb: 'abuseIpDbKey',
  phishTank: 'phishTankKey',
  whoisXml: 'whoisXmlKey',
};
function normalizeStoredProviderKeys(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  for (const provider of Object.keys(PROVIDER_KEY_FIELDS)) {
    const field = PROVIDER_KEY_FIELDS[provider];
    cfg[field] = String(cfg[field] || '').trim();
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

// A per-site override map, in the only shape the popup ever writes: host -> { featureKey: false }.
// Shared by export and import so what is written is exactly what can be read back (PI-03).
function sanitizeSiteOverrides(raw) {
  const out = {};
  let dropped = 0;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { map: out, dropped: 1 };
  Object.keys(raw).slice(0, 500).forEach((host) => {
    const entry = raw[host];
    if (typeof host !== 'string' || !host || host.length > 260 || !entry || typeof entry !== 'object' || Array.isArray(entry)) { dropped++; return; }
    const kept = {};
    Object.keys(entry).forEach((key) => {
      if (entry[key] === false && Object.prototype.hasOwnProperty.call(DEFAULTS, key) && typeof DEFAULTS[key] === 'boolean') kept[key] = false;
      else dropped++;
    });
    if (Object.keys(kept).length) out[host] = kept;
  });
  return { map: out, dropped };
}

function exportableSettings(cfg) {
  const out = {};
  Object.keys(cfg || {}).forEach((key) => {
    if (SECRET_FIELD_RE.test(key)) return;
    out[key] = key === 'siteOverrides' ? sanitizeSiteOverrides(cfg[key]).map
      : key === 'eyeShieldSites' ? WOEyeShieldProfiles.cleanSites(cfg[key]) : cfg[key];
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
    if (!Object.prototype.hasOwnProperty.call(IMPORT_SCHEMA, key)) { ignored++; return; }
    if (SECRET_FIELD_RE.test(key)) { ignored++; return; }
    const def = IMPORT_SCHEMA[key];
    const val = raw[key];
    // The one host -> object key. The generic map branch below keeps only scalar values, so this
    // used to come back as {} and be applied over the reader's stored overrides (PI-03). An entry
    // that holds nothing usable is ignored, never applied as an empty map.
    if (key === 'siteOverrides') {
      if (!val || typeof val !== 'object' || Array.isArray(val)) { ignored++; return; }
      const result = sanitizeSiteOverrides(val);
      if (Object.keys(val).length && !Object.keys(result.map).length) { ignored++; return; }
      settings[key] = result.map;
      return;
    }
    if (key === 'eyeShieldSites') {
      if (!val || typeof val !== 'object' || Array.isArray(val)) { ignored++; return; }
      const sites = WOEyeShieldProfiles.cleanSites(val);
      if (Object.keys(val).length && !Object.keys(sites).length) { ignored++; return; }
      settings[key] = sites;
      return;
    }
    if (key === 'notificationSettings') {
      if (!val || typeof val !== 'object' || Array.isArray(val)) { ignored++; return; }
      settings[key] = typeof sanitizeWardenNotificationSettings === 'function'
        ? sanitizeWardenNotificationSettings(val)
        : JSON.parse(JSON.stringify(DEFAULTS.notificationSettings));
      return;
    }
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
//
// The read and the write hold the config lock (config-lock.js), so Settings, another page or the
// worker writing at the same moment waits for this one and then reads its result. The lock is let
// go before either callback runs, since a callback may save again.
//
// A private window has its own lock, so a save there can still land over this one without having
// read it. A moment after saving, confirmConfigWrite (config-lock.js) checks; if this save was
// written over, the same keys and values are saved again -- `retry` carries them, and the popup's
// own copy is left alone, since it already counts them as saved.
function persistConfig(onSaved, onError, retry) {
  const changedKeys = retry ? Object.keys(retry.changes) : popupChangedKeys();
  const changes = {};
  changedKeys.forEach((k) => { changes[k] = retry ? retry.changes[k] : configClone({ v: config[k] }).v; });
  let writeId = '';
  let writeOrder = retry && retry.order;
  withConfigLock(() => new Promise((release) => {
    // Whatever goes wrong lets the lock go and is reported. A read that failed is not an empty
    // config: writing defaults plus this change over it would reset every other setting.
    const fail = (err) => { release(); if (typeof onError === 'function') onError(err); };
    try {
      chrome.storage.local.get(['wardenone_config', WO_CONFIG_WRITES_KEY], (store) => {
        try {
          const readError = chrome.runtime.lastError;
          if (readError) { fail(readError); return; }
          const raw = store && store.wardenone_config;
          const stored = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
          const next = Object.assign({}, DEFAULTS, stored);
          changedKeys.forEach((k) => { next[k] = changes[k]; });
          // Applied to the merged result, not just to `config`: this decides what is
          // actually written, and a provider switched off in either copy must not leave
          // its key behind in storage.
          normalizeStoredProviderKeys(next);
          const adopted = Object.keys(next).filter((k) => changedKeys.indexOf(k) < 0
            && configValuesDiffer(next[k], savedConfigSnapshot[k]));
          const stamp = stampConfigWrite(store && store[WO_CONFIG_WRITES_KEY], changedKeys, writeOrder);
          writeId = stamp.id;
          writeOrder = stamp.order;
          chrome.storage.local.set({ wardenone_config: next, [WO_CONFIG_WRITES_KEY]: stamp.record }, () => {
            const err = chrome.runtime.lastError;
            if (err) { fail(err); return; }
            try {
              if (!retry) {
                config = next;
                savedConfigSnapshot = configClone(next);
              }
            } finally {
              release();
            }
            if (typeof onSaved === 'function') onSaved(adopted);
            confirmConfigWrite(writeId, (left) => persistConfig(null, null, { changes, left, order: writeOrder }),
              retry ? retry.left : undefined, changedKeys, writeOrder);
          });
        } catch (e) { fail(e); }
      });
    } catch (e) { fail(e); }
  }));
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
  if ((keys || []).some((key) => key === 'eyeShieldSites' || key === 'eyeShieldMode' || key.startsWith('eyeShield'))) paintEyeShield();
  if ((keys || []).some((key) => key.startsWith('webglSaver'))) paintWebGLSaver();
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

function saveConfig(label, afterSave, onError) {
  normalizeStoredProviderKeys(config);
  persistConfig((adopted) => {
    // notify any open tabs so the change relays into their page (next load applies fully)
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((t) => {
        // the callback reads lastError so tabs without our content script
        // (chrome:// pages, tabs from before install) don't reject a promise
        // and spam the console -- a bare try/catch can't catch that async error
        try { chrome.tabs.sendMessage(t.id, { kind: 'config-update', overrides: publicConfig(config, t.url) }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      });
    });
    if (adopted.length) repaintExternalConfigKeys(adopted);
    setSavedTick(label || 'Saved', false);
    syncProviderStatus();
    renderProtectionHealth();
    if (typeof afterSave === 'function') afterSave();
  }, (error) => {
    setSavedTick('Save failed', true);
    if (typeof onError === 'function') onError(error);
  });
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
  if (featureOmitted('eyeShield')) return;
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null || !/^https?:/i.test(tab.url || '') || !chrome.scripting) return;
      const profile = WOEyeShieldProfiles.profileFor(config.eyeShieldSites, new URL(tab.url).hostname);
      if (profile?.mode === 'off' || (!eyeShieldIsActive() && profile?.mode !== 'custom')) return;
      // The per-site themes first, into the top frame where they are registered: a tab opened
      // before theming was on (or before an update) has the core but not them, and refreshing
      // it with the core alone left GitHub, YouTube Music and the other profiled sites generic.
      chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['eyeshield-sites.js'] }, () => {
        void chrome.runtime.lastError;
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['eyeshield-profiles.js', 'eyeshield.js'] }, () => {
          void chrome.runtime.lastError;
        });
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
  saveConfig('Recommended protections on', reloadActiveHttpTab);
  showLeftOffNote();
}

/* The button used to say "Turn everything on" while deliberately leaving five visible
   protections off (FEAT-05). It now says what it does, and afterwards names what it left alone
   and why, by the labels the reader sees on those switches. */
function showLeftOffNote() {
  const note = $('all-on-note');
  if (!note) return;
  const names = [];
  MANUAL_ONLY_TOGGLES.forEach((key) => {
    if (key === 'silentMode') return;
    const input = document.querySelector('input[data-key="' + key + '"]');
    if (!input || input.checked) return;
    const row = input.closest('.row');
    const label = row && row.querySelector('.name');
    const text = String((label && label.textContent) || '').trim();
    if (text) names.push(text);
  });
  if (!names.length) { note.hidden = true; note.textContent = ''; return; }
  note.textContent = 'Left off on purpose, because each can break sites or costs more than it saves for most people: '
    + names.join('; ') + '. Turn any of them on by name if you want it.';
  note.hidden = false;
}

function testVirusTotalKey() {
  readFromUI();
  const key = String(config.downloadVirusTotalKey || '').trim();
  if (!key) {
    syncVirusTotalStatus('Paste your VirusTotal API key first.', 'var(--wo-danger)');
    applyToUI();
    return;
  }
  syncVirusTotalStatus('Testing VirusTotal key...', 'var(--ink-faint)');
  chrome.runtime.sendMessage({ kind: 'test-virustotal-key', key }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      const msg = (res && res.error) || err || 'VirusTotal key test failed.';
      config.downloadVirusTotal = false;
      applyToUI();
      saveConfig('Saved', () => syncVirusTotalStatus(msg, 'var(--wo-danger)'));
      return;
    }
    saveConfig('Saved', () => syncVirusTotalStatus('VirusTotal key works. Turn on URL reputation separately for automatic checks.', 'var(--wo-success)'));
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
    saveConfig('Saved', () => syncSafeBrowsingStatus('Google Safe Browsing key works. Turn on URL reputation separately for automatic checks.', 'var(--wo-success)'));
  });
}

function setupReputationProvider(providerKey) {
  const provider = REPUTATION_PROVIDERS.find((p) => p.key === providerKey);
  if (!provider) return;
  readFromUI();
  const key = provider.keyField ? String(config[provider.keyField] || '').trim() : '';
  if (!key && !provider.noKey) {
    syncReputationProviderStatus(provider, 'Paste your ' + provider.label + ' API key first.', 'var(--wo-danger)');
    applyToUI();
    return;
  }
  syncReputationProviderStatus(provider, 'Testing ' + provider.label + ' key...', 'var(--ink-faint)');
  chrome.runtime.sendMessage({ kind: 'test-reputation-provider-key', provider: provider.key, key }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      config[provider.key] = false;
      applyToUI();
      saveConfig('Saved', () => syncReputationProviderStatus(provider, (res && res.error) || err || (provider.label + ' key test failed.'), 'var(--wo-danger)'));
      return;
    }
    saveConfig('Saved', () => syncReputationProviderStatus(provider,
      provider.label + ' key works. Turn on this provider separately for automatic checks.', 'var(--wo-success)'));
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
    if (tab.incognito) {
      setNote($('note'), [{ t: 'Private-window site exceptions cannot be saved. Use the main window to change this list.' }]);
      return;
    }
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

// Drop stored overrides for keys the registry does not carry, for one host, and persist if any
// went. Returns the keys removed so the panel can say so once.
function pruneUnsupportedSiteOverrides(host) {
  const entry = host && config.siteOverrides ? config.siteOverrides[host] : null;
  if (!entry || typeof entry !== 'object') return [];
  const stale = Object.keys(entry).filter((key) => !SITE_OVERRIDE_KEYS.has(key));
  if (!stale.length) return [];
  stale.forEach((key) => { delete entry[key]; });
  if (!Object.keys(entry).length) delete config.siteOverrides[host];
  persistConfig(() => {}, () => {});
  return stale;
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

/* ---- My rules & custom lists (Advanced) ---------------------------------
   User-authored content, not protections, so neither has a shield toggle: a
   rule is on because it was written, and each list carries its own switch.
   Everything here reports what was actually understood -- a rule that is stored
   but not usable is worse than one that was refused, because the writer
   believes it is working. */
function fmtListWhen(ms) {
  const n = Number(ms);
  if (!n) return 'never';
  const mins = Math.round((Date.now() - n) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hrs / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

/* Two kinds of line that are not in use, listed together: the ones WardenOne could not read,
   and the ones it read but had no room for. A rule past the limit is named by its line like a
   refused one, because to the person who wrote it the effect is the same -- it does nothing --
   and a rule that silently does nothing is the thing this box exists to prevent. */
function renderUserRuleErrors(errors, overflowLines, limit) {
  const box = $('user-rules-errors');
  if (!box) return;
  box.textContent = '';
  (errors || []).slice(0, 20).forEach((e) => {
    const row = document.createElement('div');
    row.textContent = 'Line ' + e.line + ': ' + e.why + ' — ' + e.text;
    box.appendChild(row);
  });
  if ((errors || []).length > 20) {
    const more = document.createElement('div');
    more.textContent = 'and ' + (errors.length - 20) + ' more.';
    box.appendChild(more);
  }
  const over = Array.isArray(overflowLines) ? overflowLines : [];
  over.slice(0, 20).forEach((e) => {
    const row = document.createElement('div');
    row.textContent = 'Line ' + e.line + ': past the ' + fmtCount(limit || 0) + '-rule limit, not in use — ' + e.text;
    box.appendChild(row);
  });
  if (over.length > 20) {
    const more = document.createElement('div');
    more.textContent = 'and ' + (over.length - 20) + ' more past the limit.';
    box.appendChild(more);
  }
}

/* The numbers are the worker's own: blocking rules in use, hiding rules, and blocking rules
   past the limit. Nothing here is derived by subtraction -- that is how 50 rules that did
   nothing were once reported as 50 hiding rules. */
function describeRuleCounts(res) {
  const net = Number(res.network || 0);
  const cos = Number(res.cosmetic || 0);
  const over = Number(res.overflow || 0);
  if (!net && !cos && !over) return 'No rules yet.';
  const bits = [];
  if (net) bits.push(net + (net === 1 ? ' blocking rule' : ' blocking rules'));
  if (cos) bits.push(cos + (cos === 1 ? ' hiding rule' : ' hiding rules'));
  let text = bits.length ? bits.join(' and ') + ' in use.' : 'No rules in use.';
  if (over) {
    text += ' ' + over + ' more blocking rule' + (over === 1 ? ' is' : 's are') + ' past the '
      + fmtCount(res.limit || 0) + '-rule limit and not in use; the limit is shared with your subscribed lists.';
  }
  return text;
}

function loadUserRules() {
  const area = $('user-rules-text');
  if (!area) return;
  chrome.runtime.sendMessage({ kind: 'user-rules-get' }, (res) => {
    void chrome.runtime.lastError;
    if (!res || !res.ok) return;
    area.value = res.text || '';
    const sum = $('user-rules-summary');
    if (sum) sum.textContent = describeRuleCounts(res);
    const st = $('user-rules-status');
    if (st) st.textContent = '';
    renderUserRuleErrors(res.errors, res.overflowLines, res.limit);
  });
}

function saveUserRules() {
  const area = $('user-rules-text');
  const st = $('user-rules-status');
  if (!area) return;
  if (st) st.textContent = 'Saving...';
  chrome.runtime.sendMessage({ kind: 'user-rules-set', text: area.value }, (res) => {
    const err = chrome.runtime.lastError;
    if (err || !res || !res.ok) {
      if (st) st.textContent = 'Could not save: ' + ((res && res.error) || (err && err.message) || 'unknown error');
      return;
    }
    const skipped = (res.errors || []).length;
    /* "Saved" is never said on its own over rules that are not in use. */
    let msg = (Number(res.overflow || 0) ? 'Saved, but not all of it is in use. ' : 'Saved. ') + describeRuleCounts(res);
    if (skipped) msg += ' ' + skipped + (skipped === 1 ? ' line was' : ' lines were') + ' skipped.';
    if ((res.rejected || []).length) msg += ' ' + res.rejected.length + ' refused by the browser.';
    if (st) st.textContent = msg;
    const sum = $('user-rules-summary');
    if (sum) sum.textContent = describeRuleCounts(res);
    renderUserRuleErrors(res.errors, res.overflowLines, res.limit);
  });
}

function renderCustomLists(lists) {
  const box = $('custom-lists-rows');
  if (!box) return;
  box.textContent = '';
  const sum = $('custom-lists-summary');
  const arr = Array.isArray(lists) ? lists : [];
  if (sum) {
    const on = arr.filter((l) => l && l.enabled !== false).length;
    sum.textContent = !arr.length ? 'Subscribe to a filter list'
      : arr.length + (arr.length === 1 ? ' list' : ' lists') + ', ' + on + ' on';
  }
  arr.forEach((l) => {
    const row = document.createElement('div');
    row.className = 'adv-list-row';
    const left = document.createElement('div');
    left.style.flex = '1';
    left.style.minWidth = '0';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = l.title || l.url;
    const meta = document.createElement('div');
    meta.className = 'desc';
    /* The worker attaches each list's share of the one blocking-rule band, allotted after
       the reader's own rules and the lists ahead of it; a list that parses to 700 blocking
       rules and gets 120 of them says so, rather than "700 rules". */
    const bits = [];
    if (typeof l.applied === 'number' && typeof l.network === 'number') {
      const net = Number(l.network || 0);
      const applied = Number(l.applied || 0);
      const cos = Number(l.cosmetic || 0);
      if (l.enabled !== false && l.off !== true && applied < net) bits.push(applied + ' of ' + net + ' blocking rules in use');
      else if (net) bits.push(net + ' blocking rule' + (net === 1 ? '' : 's'));
      if (cos) bits.push(cos + ' hiding rule' + (cos === 1 ? '' : 's'));
      if (!net && !cos) bits.push('no rules');
    } else {
      bits.push(Number(l.ruleCount || 0) + ' rules');
    }
    bits.push('fetched ' + fmtListWhen(l.updatedAt));
    const publisherDate = Number(l.publisherUpdatedAt) || 0;
    bits.push(publisherDate ? 'publisher ' + fmtListWhen(publisherDate) : 'publisher date unknown');
    if (Number(l.skipped || 0)) bits.push(l.skipped + ' skipped');
    if (l.enabled === false) bits.push('off');
    meta.textContent = bits.join(' · ');
    left.appendChild(name);
    left.appendChild(meta);
    if (publisherDate && Date.now() - publisherDate > 30 * 24 * 60 * 60 * 1000) {
      const old = document.createElement('div');
      old.className = 'desc';
      old.style.color = 'var(--wo-warning)';
      old.textContent = 'Publisher date is over 30 days old. Fetching this list again will not make its source newer.';
      left.appendChild(old);
    }
    if (l.enabled !== false && l.off !== true && Number(l.overflow || 0)) {
      const over = document.createElement('div');
      over.className = 'desc';
      over.style.color = 'var(--warn)';
      over.textContent = l.overflow + ' of this list\'s blocking rules are past the shared limit and not in use. Your own rules and the lists above it are served first.';
      left.appendChild(over);
    }
    if (l.error) {
      const bad = document.createElement('div');
      bad.className = 'desc';
      bad.style.color = 'var(--warn)';
      /* An http:// subscription is not stale, it is off: the note says why and what to do. */
      bad.textContent = l.insecure ? l.error : ('Last check failed: ' + l.error + ' Still using the copy already downloaded.');
      left.appendChild(bad);
    }
    const actions = document.createElement('div');
    actions.className = 'adv-row-actions';
    const mk = (text, handler) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = text;
      b.addEventListener('click', () => { b.disabled = true; handler(b); });
      actions.appendChild(b);
      return b;
    };
    const toggle = mk(l.enabled === false ? 'Turn on' : 'Turn off', (b) => {
      chrome.runtime.sendMessage({ kind: 'custom-list-toggle', id: l.id, enabled: l.enabled === false }, (res) => {
        void chrome.runtime.lastError;
        if (res && !res.ok) { b.disabled = false; b.textContent = l.enabled === false ? 'Turn on' : 'Turn off'; }
        renderCustomLists(res && res.lists);
      });
    });
    if (l.insecure) { toggle.disabled = true; toggle.title = 'Move this list to an https:// address first.'; }
    mk('Update', (b) => {
      b.textContent = 'Updating...';
      chrome.runtime.sendMessage({ kind: 'custom-list-update', id: l.id }, (res) => {
        void chrome.runtime.lastError;
        renderCustomLists(res && res.lists);
      });
    });
    mk('Remove', () => {
      chrome.runtime.sendMessage({ kind: 'custom-list-remove', id: l.id }, (res) => {
        void chrome.runtime.lastError;
        renderCustomLists(res && res.lists);
      });
    });
    row.appendChild(left);
    row.appendChild(actions);
    box.appendChild(row);
  });
}

function loadCustomLists() {
  if (!$('custom-lists-rows')) return;
  chrome.runtime.sendMessage({ kind: 'custom-lists-get' }, (res) => {
    void chrome.runtime.lastError;
    renderCustomLists(res && res.lists);
  });
}

function renderPaletteShortcutState(commands) {
  const note = $('palette-shortcut-note');
  if (!note || !Array.isArray(commands)) return;
  const palette = commands.find((cmd) => cmd && cmd.name === 'command-palette');
  note.hidden = !palette || !!palette.shortcut;
}

function wireMyFilters() {
  const save = $('user-rules-save');
  if (save) save.addEventListener('click', saveUserRules);

  const exportBtn = $('user-rules-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const area = $('user-rules-text');
      const blob = new Blob([(area && area.value) || ''], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wardenone-my-rules.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }
  const importBtn = $('user-rules-import');
  const file = $('user-rules-file');
  if (importBtn && file) {
    importBtn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const area = $('user-rules-text');
        if (!area) return;
        /* Append rather than replace: an import that silently wiped rules
           someone had written by hand would be unrecoverable. */
        const incoming = String(reader.result || '');
        area.value = area.value.trim() ? area.value.replace(/\s*$/, '') + '\n' + incoming : incoming;
        const st = $('user-rules-status');
        if (st) st.textContent = 'Added from ' + f.name + '. Review it, then Save rules.';
      };
      reader.readAsText(f);
      file.value = '';
    });
  }

  const firewall = $('open-firewall');
  if (firewall) {
    firewall.addEventListener('click', () => {
      /* The matrix is about one site, so it needs to know which tab it was opened
         for -- once it is itself the active tab, that answer is gone. */
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = (tabs && tabs[0]) || null;
        let host = '';
        try { host = tab && tab.url ? new URL(tab.url).hostname : ''; } catch (_) { host = ''; }
        const url = chrome.runtime.getURL('firewall.html')
          + '?tab=' + encodeURIComponent(tab && tab.id != null ? tab.id : '')
          + '&site=' + encodeURIComponent(host);
        chrome.tabs.create({ url });
      });
    });
  }
  const fileShield = $('open-file-shield');
  if (fileShield) {
    fileShield.addEventListener('click', () => {
      /* A tab, so the file picker and a long scan are not cut off by the popup
         closing the moment focus moves to the OS file dialog. */
      chrome.tabs.create({ url: chrome.runtime.getURL('file-shield.html') });
    });
  }
  const logger = $('open-logger');
  if (logger) {
    logger.addEventListener('click', () => {
      /* A tab, not a popup window: capture runs for as long as this page is open,
         so it needs to survive the popup closing the moment you click away. */
      chrome.tabs.create({ url: chrome.runtime.getURL('logger.html') });
    });
  }

  const openPaletteFromPopup = () => {
    /* Both popup buttons use the same guarded worker path as the keyboard command. */
    chrome.runtime.sendMessage({ kind: 'palette-open' }, () => {
      try { void chrome.runtime.lastError; } catch (_) {}
      window.close();
    });
  };
  for (const id of ['open-palette', 'open-palette-quick']) {
    const button = $(id);
    if (button) button.addEventListener('click', openPaletteFromPopup);
  }

  const privacyTest = $('open-privacy-test');
  if (privacyTest) {
    privacyTest.addEventListener('click', () => {
      /* The tab id travels with it, for the same reason the firewall page takes one: the
         test measures a real web page, and once this page IS the active tab that answer
         is gone. Extension pages get no content scripts, so a test that measured itself
         would report every shield missing -- truthfully, and uselessly. */
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = (tabs && tabs[0]) || null;
        const url = chrome.runtime.getURL('privacy-test.html')
          + '?tab=' + encodeURIComponent(tab && tab.id != null ? tab.id : '');
        chrome.tabs.create({ url });
      });
    });
  }

  /* Straight from chrome.commands.getAll(), never from a table written here. The reader
     can rebind or clear any of these in Chrome, and a hard-coded list would start lying
     the moment they did -- which is worse than no list, because it would be a shortcut
     printed next to an action it no longer runs. */
  const shortcutList = $('shortcut-list');
  if (shortcutList && chrome.commands && chrome.commands.getAll) {
    chrome.commands.getAll((commands) => {
      try { void chrome.runtime.lastError; } catch (_) {}
      shortcutList.textContent = '';
      const items = Array.isArray(commands) ? commands.filter((c) => c && c.name !== '_execute_action') : [];
      renderPaletteShortcutState(items);
      if (!items.length) {
        shortcutList.textContent = 'Chrome did not report any shortcuts.';
        return;
      }
      for (const cmd of items) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const label = document.createElement('span');
        label.textContent = String(cmd.description || cmd.name);
        const key = document.createElement('span');
        /* "Not set" rather than an empty cell: an unassigned command is a deliberate
           state here, not a missing value. */
        key.className = 'k' + (cmd.shortcut ? '' : ' unset');
        key.textContent = cmd.shortcut || 'Not set';
        row.appendChild(label);
        row.appendChild(key);
        shortcutList.appendChild(row);
      }
    });
  }
  for (const id of ['open-shortcuts', 'set-palette-shortcut']) {
    const button = $(id);
    if (button) button.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  const add = $('custom-list-add');
  const url = $('custom-list-url');
  if (add && url) {
    const subscribe = () => {
      const st = $('custom-lists-status');
      if (!url.value.trim()) { if (st) st.textContent = 'Paste the address of a filter list first.'; return; }
      add.disabled = true;
      if (st) st.textContent = 'Fetching...';
      chrome.runtime.sendMessage({ kind: 'custom-list-add', url: url.value.trim() }, (res) => {
        void chrome.runtime.lastError;
        add.disabled = false;
        if (!res || !res.ok) { if (st) st.textContent = 'Could not subscribe: ' + ((res && res.error) || 'unknown error'); return; }
        if (st) st.textContent = 'Subscribed.';
        url.value = '';
        renderCustomLists(res.lists);
      });
    };
    add.addEventListener('click', subscribe);
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); subscribe(); } });
  }

  /* Loaded when the section is first opened rather than on popup open: nobody
     should pay for a feature they never expand. */
  const drop = $('my-filters-drop');
  if (drop) {
    drop.addEventListener('toggle', () => {
      if (!drop.open) return;
      loadUserRules();
      loadCustomLists();
    });
  }
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
        .filter((key) => typeof DEFAULTS[key] === 'boolean' && SITE_OVERRIDE_KEYS.has(key))
        .map((key) => ({ key, label: protectionLabel(key) + (SITE_OVERRIDE_MIXED.has(key) ? ' (page part only)' : '') }))
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
    // Overrides stored by an earlier build for protections that never applied here (FEAT-01):
    // dropped, and said once, rather than shown as an exception that is not one.
    const stale = pruneUnsupportedSiteOverrides(host);
    const staleNote = $('site-off-stale');
    if (staleNote) {
      staleNote.hidden = !stale.length;
      if (stale.length) {
        staleNote.textContent = 'Removed ' + stale.length + ' earlier setting' + (stale.length === 1 ? '' : 's') + ' here ('
          + stale.map(protectionLabel).join(', ') + '): ' + (stale.length === 1 ? 'it runs' : 'they run')
          + ' outside the page and could never be turned off for one site.';
      }
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
        name.textContent = protectionLabel(key) + (SITE_OVERRIDE_MIXED.has(key) ? ' — page part off here (network part still on)' : ' — off here');
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
  if (!on && !SITE_OVERRIDE_KEYS.has(key)) {
    setNote($('note'), [{ t: protectionLabel(key) + ' runs outside the page and cannot be turned off for one site.' }]);
    return;
  }
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
    try {
      const url = new URL(tab.url);
      callback(/^https?:$/.test(url.protocol) ? WOEyeShieldProfiles.hostOf(url.hostname) : '');
    }
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
  return clampEyeShieldBrightness(config.eyeShieldBrightness == null ? 100 : config.eyeShieldBrightness);
}

function currentEyeShieldProfile() {
  return WOEyeShieldProfiles.profileFor(config.eyeShieldSites, eyeShieldHost);
}

function eyeShieldSiteValue(key) {
  const profile = currentEyeShieldProfile();
  const limits = WOEyeShieldProfiles.ADJUSTMENTS[key];
  const value = profile?.mode === 'custom' ? profile[key] : config[key];
  return clampEyeShieldPct(value == null ? limits[2] : value, limits[0], limits[1], limits[2]);
}

function eyeShieldScopeName() {
  return currentEyeShieldProfile()?.mode === 'custom' ? eyeShieldHost : 'All sites';
}

function setEyeShieldScopeMenu(open) {
  const button = $('eyeshield-scope-button');
  const menu = $('eyeshield-scope-menu');
  if (!button || !menu) return;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) menu.querySelector('[aria-checked="true"]')?.focus();
}

function setEyeShieldSiteStatus(message, error = false, transient = false) {
  const status = $('eyeshield-site-status');
  if (!status) return;
  clearTimeout(eyeShieldStatusTimer);
  status.textContent = message;
  status.classList.toggle('is-error', error);
  if (transient) eyeShieldStatusTimer = setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 2400);
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
  const profile = currentEyeShieldProfile();
  const siteMode = profile ? profile.mode : 'inherit';
  const scopeLabel = siteMode === 'custom' ? eyeShieldHost : siteMode === 'off' ? 'Off on ' + eyeShieldHost : 'All sites';
  $('eyeshield-scope-label').textContent = scopeLabel;
  $('eyeshield-scope-button').setAttribute('aria-label', 'EyeShield scope: ' + scopeLabel);
  $('eyeshield-scope-button').disabled = !masterOn || !eyeShieldHost;
  document.querySelectorAll('.eyeshield-scope-host').forEach((el) => { el.textContent = eyeShieldHost || 'this site'; });
  document.querySelectorAll('[data-eyeshield-site]').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.eyeshieldSite === siteMode ? 'true' : 'false');
    btn.disabled = !eyeShieldHost && btn.dataset.eyeshieldSite !== 'inherit';
  });
  $('eyeshield-controls').hidden = siteMode === 'off';
  $('eyeshield-off-summary').hidden = siteMode !== 'off';
  $('eyeshield-off-summary').textContent = 'EyeShield is off on ' + eyeShieldHost + '.';
  const mode = normalizeEyeShieldMode(siteMode === 'custom' ? profile.theme : config.eyeShieldMode);
  const effectsOn = masterOn && siteMode !== 'off';
  document.querySelectorAll('.eyeshield-mode').forEach((btn) => {
    const on = btn.getAttribute('data-eyeshield-mode') === mode;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.disabled = !effectsOn;
  });
  const brightness = eyeShieldSiteValue('eyeShieldBrightness');
  const range = $('eyeshield-brightness');
  if (range) {
    range.value = String(brightness);
    range.disabled = !effectsOn;
    range.setAttribute('aria-valuetext', brightness + '%');
  }
  const scope = eyeShieldScopeName();
  $('eyeshield-host').textContent = scope + ' brightness';
  paintEyeShieldValue('eyeshield-value', brightness, 0, 200, effectsOn, scope + ' brightness');
  paintEyeShieldPct('eyeShieldContrast', 0, 300, 'eyeshield-contrast', 'eyeshield-contrast-value', 'contrast', effectsOn);
  paintEyeShieldPct('eyeShieldSaturation', 0, 300, 'eyeshield-saturation', 'eyeshield-saturation-value', 'saturation', effectsOn);
  paintEyeShieldPct('eyeShieldWarmth', 0, 100, 'eyeshield-warmth', 'eyeshield-warmth-value', 'warmth', effectsOn);
  paintEyeShieldPct('eyeShieldGrayscale', 0, 100, 'eyeshield-grayscale', 'eyeshield-grayscale-value', 'grayscale', effectsOn);
  $('eyeshield-reset').textContent = siteMode === 'custom' ? 'Reset site adjustments' : 'Reset global adjustments';
  panel.classList.toggle('is-disabled', !masterOn);
}

function paintEyeShieldPct(key, lo, hi, rangeId, valueId, label, enabled) {
  const pct = eyeShieldSiteValue(key);
  const range = $(rangeId);
  if (range) { range.value = String(pct); range.disabled = !enabled; range.setAttribute('aria-valuetext', pct + '%'); }
  const scope = eyeShieldScopeName();
  $(rangeId + '-host').textContent = scope + ' ' + label;
  paintEyeShieldValue(valueId, pct, lo, hi, enabled, scope + ' ' + label);
}

function saveEyeShieldSoon() {
  clearTimeout(eyeShieldSaveTimer);
  eyeShieldEditGeneration++;
  setEyeShieldSiteStatus(currentEyeShieldProfile()?.mode === 'custom' ? 'Saving for ' + eyeShieldHost + '…' : 'Saving globally…');
  $('eyeshield-site-status').dataset.pending = '1';
  eyeShieldSaveTimer = setTimeout(() => {
    eyeShieldSaveTimer = 0;
    saveEyeShieldNow();
  }, 140);
}

function updateEyeShieldSetting(change) {
  const profile = currentEyeShieldProfile();
  if (config.enabled === false || profile?.mode === 'off') return false;
  if (profile?.mode === 'custom') {
    const sites = WOEyeShieldProfiles.cleanSites(config.eyeShieldSites);
    sites[eyeShieldHost] = Object.assign({}, profile, change);
    config.eyeShieldSites = sites;
  } else {
    Object.assign(config, change);
    config.eyeShield = eyeShieldIsActive();
  }
  paintEyeShield();
  previewEyeShieldActiveTab();
  return true;
}

function setEyeShieldMode(mode) {
  const key = currentEyeShieldProfile()?.mode === 'custom' ? 'theme' : 'eyeShieldMode';
  if (updateEyeShieldSetting({ [key]: normalizeEyeShieldMode(mode) })) saveEyeShieldNow();
}

function setEyeShieldBrightness(value) {
  if (updateEyeShieldSetting({ eyeShieldBrightness: clampEyeShieldBrightness(value) })) saveEyeShieldSoon();
}

function eyeShieldIsActive() {
  const mode = normalizeEyeShieldMode(config.eyeShieldMode);
  return mode !== 'off'
    || getEyeShieldBrightness() !== 100
    || getEyeShieldPct('eyeShieldContrast', 0, 300, 100) !== 100
    || getEyeShieldPct('eyeShieldSaturation', 0, 300, 100) !== 100
    || getEyeShieldPct('eyeShieldWarmth', 0, 100, 0) !== 0
    || getEyeShieldPct('eyeShieldGrayscale', 0, 100, 0) !== 0;
}
function clampEyeShieldPct(value, lo, hi, dflt) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
function getEyeShieldPct(globalKey, lo, hi, dflt) {
  return clampEyeShieldPct(config[globalKey] == null ? dflt : config[globalKey], lo, hi, dflt);
}
function setEyeShieldPct(key, lo, hi, dflt, value) {
  if (updateEyeShieldSetting({ [key]: clampEyeShieldPct(value, lo, hi, dflt) })) saveEyeShieldSoon();
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
  const generation = ++eyeShieldEditGeneration;
  const host = eyeShieldHost;
  const scope = currentEyeShieldProfile()?.mode;
  const status = $('eyeshield-site-status');
  if (status) status.dataset.pending = '1';
  setEyeShieldSiteStatus(scope === 'off' ? 'Turning off on ' + host + '…'
    : scope === 'custom' ? 'Saving for ' + host + '…' : 'Saving globally…');
  saveConfig('EyeShield', () => {
    if (generation !== eyeShieldEditGeneration) return;
    if (status) delete status.dataset.pending;
    paintEyeShield();
    injectEyeShieldActiveTab();
    setEyeShieldSiteStatus(scope === 'off' ? 'EyeShield off on ' + host + ' ✓'
      : scope === 'custom' ? 'Saved for ' + host + ' ✓' : 'Saved globally ✓', false, true);
  }, (error) => {
    if (generation !== eyeShieldEditGeneration) return;
    if (status) delete status.dataset.pending;
    setEyeShieldSiteStatus('Could not save EyeShield: ' + (error?.message || 'try again.'), true);
  });
}

function previewEyeShieldActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null || !/^https?:/i.test(tab.url || '')) return;
    try {
      if (WOEyeShieldProfiles.hostOf(new URL(tab.url).hostname) !== eyeShieldHost) return;
      chrome.tabs.sendMessage(tab.id, { kind: 'config-update', overrides: publicConfig(config, tab.url) }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  });
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
  $('eyeshield-scope-button')?.addEventListener('click', () => {
    const button = $('eyeshield-scope-button');
    if (!button.disabled) setEyeShieldScopeMenu(button.getAttribute('aria-expanded') !== 'true');
  });
  $('eyeshield-scope-menu')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setEyeShieldScopeMenu(false);
      $('eyeshield-scope-button').focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const options = [...document.querySelectorAll('#eyeshield-scope-menu [data-eyeshield-site]:not(:disabled)')];
      const index = options.indexOf(document.activeElement);
      options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
    } else return;
    event.preventDefault();
  });
  document.addEventListener('click', (event) => {
    if (!$('eyeshield-scope')?.contains(event.target)) setEyeShieldScopeMenu(false);
  });
  document.querySelectorAll('[data-eyeshield-site]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setEyeShieldScopeMenu(false);
      if (!eyeShieldHost || config.enabled === false) return;
      const mode = btn.dataset.eyeshieldSite;
      const current = currentEyeShieldProfile();
      if ((current ? current.mode : 'inherit') === mode) return;
      const sites = WOEyeShieldProfiles.cleanSites(config.eyeShieldSites);
      if (mode === 'custom') sites[eyeShieldHost] = WOEyeShieldProfiles.customFromGlobal(config);
      else if (mode === 'off') sites[eyeShieldHost] = { mode: 'off' };
      else delete sites[eyeShieldHost];
      config.eyeShieldSites = sites;
      paintEyeShield();
      previewEyeShieldActiveTab();
      saveEyeShieldNow();
      $('eyeshield-scope-button').focus();
    });
  });
  document.querySelectorAll('.eyeshield-mode').forEach((btn) => {
    btn.addEventListener('click', () => setEyeShieldMode(btn.getAttribute('data-eyeshield-mode')));
  });
  const range = $('eyeshield-brightness');
  if (range) {
    range.addEventListener('input', () => setEyeShieldBrightness(range.value));
    range.addEventListener('change', saveEyeShieldNow);
  }
  wireEyeShieldValueEditor('eyeshield-value', 0, 200, 100, () => eyeShieldSiteValue('eyeShieldBrightness'), setEyeShieldBrightness);
  wireEyeShieldPctRange('eyeshield-contrast', 'eyeShieldContrast', 0, 300, 100);
  wireEyeShieldPctRange('eyeshield-saturation', 'eyeShieldSaturation', 0, 300, 100);
  wireEyeShieldPctRange('eyeshield-warmth', 'eyeShieldWarmth', 0, 100, 0);
  wireEyeShieldPctRange('eyeshield-grayscale', 'eyeShieldGrayscale', 0, 100, 0);
  wireEyeShieldValueEditor('eyeshield-contrast-value', 0, 300, 100, () => eyeShieldSiteValue('eyeShieldContrast'), (v) => setEyeShieldPct('eyeShieldContrast', 0, 300, 100, v));
  wireEyeShieldValueEditor('eyeshield-saturation-value', 0, 300, 100, () => eyeShieldSiteValue('eyeShieldSaturation'), (v) => setEyeShieldPct('eyeShieldSaturation', 0, 300, 100, v));
  wireEyeShieldValueEditor('eyeshield-warmth-value', 0, 100, 0, () => eyeShieldSiteValue('eyeShieldWarmth'), (v) => setEyeShieldPct('eyeShieldWarmth', 0, 100, 0, v));
  wireEyeShieldValueEditor('eyeshield-grayscale-value', 0, 100, 0, () => eyeShieldSiteValue('eyeShieldGrayscale'), (v) => setEyeShieldPct('eyeShieldGrayscale', 0, 100, 0, v));
  const resetBtn = $('eyeshield-reset');
  if (resetBtn) resetBtn.addEventListener('click', resetEyeShieldDefaults);
}

function resetEyeShieldDefaults() {
  const neutral = {};
  Object.entries(WOEyeShieldProfiles.ADJUSTMENTS).forEach(([key, limits]) => { neutral[key] = limits[2]; });
  if (updateEyeShieldSetting(neutral)) saveEyeShieldNow();
}

function wireEyeShieldPctRange(rangeId, key, lo, hi, dflt) {
  const range = $(rangeId);
  if (!range) return;
  range.addEventListener('input', () => setEyeShieldPct(key, lo, hi, dflt, range.value));
  range.addEventListener('change', saveEyeShieldNow);
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
      // Size and age, in one line: what the learner holds, and that it is counts with an expiry,
      // not a list of sites (PRIV-01).
      const watchingCount = Number(res.watchingCount || 0);
      const ttlDays = Number(res.ttlDays || 0);
      const oldestDays = Number(res.oldestDays || 0);
      const held = watchingCount
        ? ' Watching ' + watchingCount + ' more as counts only' + (oldestDays ? ', oldest ' + oldestDays + ' day' + (oldestDays === 1 ? '' : 's') : '') + (ttlDays ? ', kept ' + ttlDays + ' days' : '') + '.'
        : '';
      status.textContent = (res.enabled === false ? 'Paused' : 'Active') + site + '. ' + learnedCount + ' tracker domain' + (learnedCount === 1 ? '' : 's') + ' learned locally.' + held;
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
        // This browser session's count: the worker keeps no per-site record past it (PRIV-01).
        const siteText = siteHits ? siteHits + ' hit' + (siteHits === 1 ? '' : 's') + ' here this session' : 'manual rule';
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

/* The learner's proposals (SEC-04). Each is a domain seen behaving like a tracker on several
   of the reader's sites across more than one browser session. That is enough to ASK; it is
   not enough to block, because every input the learner sees arrives from a page. So the
   decision is made here, by the reader, and only "Block" writes a rule. */
function renderTrackerProposals() {
  const row = $('tracker-proposals-row');
  const box = $('tracker-learner-proposals');
  const all = $('tracker-proposals-all');
  if (!row || !box || !all) return;
  chrome.runtime.sendMessage({ kind: 'tracker-learner-proposals' }, (res) => {
    void chrome.runtime.lastError;
    const items = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
    box.textContent = '';
    if (!items.length) { row.style.display = 'none'; return; }
    row.style.display = 'flex';
    all.style.display = items.length > 1 ? 'flex' : 'none';
    const decide = (domain, decision, el) => {
      if (el) el.classList.add('perm-row-saving');
      chrome.runtime.sendMessage({ kind: 'tracker-learner-decide', domain, decision }, (r) => {
        const err = chrome.runtime.lastError;
        if (err || !r || !r.ok) setSavedTick((r && r.error) || 'Could not save that decision', true);
        else setSavedTick(decision === 'block' ? 'Blocked ' + domain + ' everywhere' : 'Ignored ' + domain, false);
        renderTrackerProposals();
      });
    };
    items.forEach((item) => {
      const line = document.createElement('div');
      line.className = 'perm-row';
      const label = document.createElement('div');
      label.className = 'perm-row-label';
      const sites = Number(item.sites || 0);
      const sessions = Number(item.sessions || 0);
      label.textContent = item.domain + ' \u2014 seen on ' + sites + ' site' + (sites === 1 ? '' : 's')
        + (sessions > 1 ? ' across ' + sessions + ' sessions' : '')
        + (item.legacy ? '. Learned automatically by an earlier version; approve it to keep blocking it.' : '');
      label.title = String(item.reason || '');
      const actions = document.createElement('div');
      actions.className = 'tracker-mode-buttons';
      [['block', 'Block', 'Block this domain\u2019s tracking requests on every site'], ['ignore', 'Ignore', 'Forget this suggestion']].forEach(([value, text, titleText]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn tracker-mode-btn';
        btn.textContent = text;
        btn.title = titleText;
        btn.addEventListener('click', () => decide(item.domain, value, line));
        actions.appendChild(btn);
      });
      line.appendChild(label);
      line.appendChild(actions);
      box.appendChild(line);
    });
  });
}
['block', 'ignore'].forEach((decision) => {
  const btn = $('tracker-proposals-' + decision + '-all');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    chrome.runtime.sendMessage({ kind: 'tracker-learner-decide-all', decision }, (r) => {
      const err = chrome.runtime.lastError;
      btn.disabled = false;
      if (err || !r || !r.ok) setSavedTick('Could not save those decisions', true);
      else setSavedTick((decision === 'block' ? 'Blocked ' : 'Ignored ') + Number(r.decided || 0) + ' domain' + (Number(r.decided || 0) === 1 ? '' : 's'), false);
      renderTrackerProposals();
    });
  });
});

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

async function writePopupClipboard(value) {
  const text = String(value || '');
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {}
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return !!ok;
  } catch (_) {
    return false;
  }
}

function copyCleanCurrentAddressFromPopup() {
  const button = $('copy-clean-current-address');
  const status = $('copy-clean-current-address-result');
  if (!button || !status) return;
  button.disabled = true;
  status.style.display = 'block';
  status.style.color = 'var(--ink-faint)';
  status.textContent = 'Cleaning the current address...';
  chrome.runtime.sendMessage({ kind: 'clean-current-address' }, async (result) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError || !result || !result.ok) {
      status.style.color = 'var(--wo-danger)';
      status.textContent = (result && result.error) || 'Could not read the current page address.';
      button.disabled = false;
      return;
    }
    const wrote = await writePopupClipboard(result.cleaned);
    if (!wrote) {
      status.style.color = 'var(--wo-danger)';
      status.textContent = 'Browser refused clipboard access. Try the clean-address shortcut shown under Keyboard shortcuts, if set.';
      button.disabled = false;
      return;
    }
    status.style.color = 'var(--wo-success)';
    if (!result.changed) status.textContent = 'Copied. This address had no known tracking junk.';
    else if (result.removed === 1) status.textContent = 'Copied clean. Removed one tracking parameter.';
    else if (result.removed > 1) status.textContent = 'Copied clean. Removed ' + result.removed + ' tracking parameters.';
    else status.textContent = 'Copied clean. Removed the tracking wrapper.';
    button.disabled = false;
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
$('copy-clean-current-address')?.addEventListener('click', copyCleanCurrentAddressFromPopup);

// Auto-save toggles as they change, so the popup never needs a separate Save action.
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
      span.textContent = 'Fetched - blocking ' + fmtCount(blocking) + ' domains';
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
  // Adopt changes from other surfaces while this popup remains open.
  if (area === 'local' && changes.wardenone_config) adoptExternalConfigChange(changes.wardenone_config.newValue);
  if (area === 'local' && (changes.wardenone_list_meta || changes.wardenone_aux_list_meta || changes.wardenone_adshield_cosmetic_publishers)) renderListMeta();
  if (area === 'local' && (changes.wardenone_config || changes.wardenone_history || changes.wardenone_list_meta || changes.wardenone_aux_list_meta || changes.wardenone_adshield_cosmetic_publishers || changes.wardenone_ext_alerts || changes.wardenone_startup_report)) renderProtectionHealth();
  if (area === 'local' && (changes.wardenone_ext_alerts || changes.wardenone_ext_reviews
      || changes.wardenone_ext_reputation_custom)) loadExtensionAlerts();
  if (area === 'local' && changes.wardenone_startup_report) loadStartupReport();
  if (area === 'local' && changes.wardenone_tracker_learner) { renderTrackerLearner(); renderTrackerProposals(); }
  if (area === 'local' && changes.wardenone_notifications) renderNotificationUnread(changes.wardenone_notifications.newValue);
});

function renderNotificationUnread(value) {
  const button = $('open-notifications');
  if (!button) return;
  if (value === undefined) {
    chrome.storage.local.get('wardenone_notifications', (stored) => {
      const notifications = stored && stored.wardenone_notifications;
      renderNotificationUnread(Array.isArray(notifications) ? notifications : []);
    });
    return;
  }
  const unread = (Array.isArray(value) ? value : []).filter((item) => item && !item.read).length;
  /* Keep unread count in the accessible name without adding a second visual badge. */
  button.setAttribute('aria-label', 'Notification centre' + (unread ? ', ' + unread + ' unread' : ''));
}

function labelToggleControls() {
  let named = 0;
  const unnamed = [];

  // Search preceding siblings so a switch never inherits the next row's name.
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
document.addEventListener('DOMContentLoaded', load, { once: true });
renderUpdateGuardian();
renderListMeta();
renderProtectionHealth();
renderNotificationUnread();

/* Its own page, not the options page: "Extension options" is Settings now. */
$('open-activity').addEventListener('click', (e) => {
  e.preventDefault();
  window.open(chrome.runtime.getURL('history.html'));
});
$('open-network').addEventListener('click', (e) => {
  e.preventDefault();
  window.open(chrome.runtime.getURL('network.html'));
});
$('open-notifications').addEventListener('click', (e) => {
  e.preventDefault();
  window.open(chrome.runtime.getURL('notifications.html'));
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

// Grade findings by scanner confidence and context: URL noise weighs less
// than exposed credentials, and secure cookie attributes earn credit.
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
      // Charge once per missing HttpOnly or Secure flag, not per cookie:
      // the grade reflects distinct hygiene failures rather than cookie count.
      const missing = { httpOnly: 0, secure: 0 };
      ck.weak.forEach((c) => {
        if (!c.httpOnly) missing.httpOnly++;
        if (!c.secure) missing.secure++;
      });
      const httpOnlyPenalty = missing.httpOnly ? 16 : 0;
      const securePenalty = missing.secure ? 12 : 0;
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

// ----- Update Guardian -----
const UPDATE_GUARDIAN_CACHE_MS = 6 * 60 * 60 * 1000;
const UPDATE_GUARDIAN_TIMEOUT_MS = 7000;

function guardianVersion(value) {
  return typeof value === 'string' && /^\d{1,4}(?:\.\d{1,5}){1,3}$/.test(value) ? value : '';
}

function compareGuardianVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
  }
  return 0;
}

async function detectBrowser() {
  const uaData = navigator.userAgentData;
  const brands = uaData && Array.isArray(uaData.brands) ? uaData.brands : [];
  const ua = navigator.userAgent || '';
  let high = {};
  try {
    if (uaData && uaData.getHighEntropyValues) {
      high = await uaData.getHighEntropyValues(['fullVersionList', 'architecture']);
    }
  } catch (_) {}
  let brave = false;
  try { brave = !!(navigator.brave && await navigator.brave.isBrave()); } catch (_) {}
  const edge = brands.some((brand) => brand.brand === 'Microsoft Edge') || /\bEdg\//.test(ua);
  const namedBrand = ['Microsoft Edge', 'Brave', 'Opera', 'Vivaldi', 'Google Chrome']
    .find((name) => brands.some((brand) => brand.brand === name));
  const name = edge ? 'Microsoft Edge' : brave ? 'Brave' : namedBrand
    || (/Edg\/\d+/.test(ua) ? 'Microsoft Edge' : /OPR\/\d+/.test(ua) ? 'Opera'
      : /Brave/i.test(ua) ? 'Brave' : /Vivaldi\/\d+/.test(ua) ? 'Vivaldi'
        : /Firefox\/\d+/.test(ua) ? 'Firefox' : /Version\/\d+.*Safari/.test(ua) ? 'Safari'
          : /Chrome\/\d+/.test(ua) ? 'Google Chrome'
            : brands.some((brand) => brand.brand === 'Chromium') ? 'Chromium' : 'Browser');
  const chromium = brands.find((brand) => brand.brand === 'Chromium');
  const engineMajor = parseInt(chromium && chromium.version, 10)
    || parseInt((/\b(?:Chrome|Chromium)\/(\d+)/.exec(ua) || [])[1], 10) || 0;
  const ownVersion = /\b(?:Edg|OPR|Vivaldi|Firefox|Version)\/(\d+)/.exec(ua);
  const major = /^(?:Firefox|Safari)$/.test(name) ? parseInt(ownVersion && ownVersion[1], 10) || 0
    : engineMajor || parseInt(ownVersion && ownVersion[1], 10) || 0;
  const fullBrands = Array.isArray(high.fullVersionList) ? high.fullVersionList : [];
  const brandVersion = (brand) => guardianVersion((fullBrands.find((item) => item.brand === brand) || {}).version);
  const reportedVersion = name === 'Brave' ? brandVersion('Brave')
    : name === 'Microsoft Edge' ? brandVersion('Microsoft Edge') || brandVersion('Microsoft Edge WebView2')
      : name === 'Google Chrome' ? brandVersion('Google Chrome') : '';
  const fullVersion = reportedVersion && !/\.0\.0\.0$/.test(reportedVersion)
    && (name !== 'Brave' || (reportedVersion.split('.').length >= 3
      && Number(reportedVersion.split('.')[0]) !== engineMajor)) ? reportedVersion : '';
  const os = /Win/i.test(uaData?.platform || navigator.platform || ua) ? 'win'
    : /Mac/i.test(uaData?.platform || navigator.platform || ua) ? 'mac'
      : /Linux/i.test(uaData?.platform || navigator.platform || ua) ? 'linux' : '';
  const arch = /arm/i.test(high.architecture || '') ? 'arm64' : 'x64';
  return { name, major, fullVersion, os, arch };
}

// The update page differs per browser.
function updatePageFor(name) {
  switch (name) {
    case 'Microsoft Edge': return 'edge://settings/help';
    case 'Brave': return 'brave://settings/help';
    case 'Opera': return 'opera://settings/help';
    case 'Vivaldi': return 'vivaldi://settings/help';
    case 'Firefox': return null;
    case 'Safari': return null;
    default: return 'chrome://settings/help';
  }
}

function guardianSource(browser) {
  if (!browser.os) return null;
  if (browser.name === 'Brave') {
    const platform = browser.os === 'win' ? 'windows' : browser.os === 'mac' ? 'macos' : 'linux';
    return ['https://versions.brave.com/latest/release-' + platform + '-' + browser.arch + '.version',
      'https://brave.com/latest/'];
  }
  if (browser.name === 'Google Chrome') {
    return ['https://versionhistory.googleapis.com/v1/chrome/platforms/' + browser.os
      + '/channels/stable/versions/all/releases?filter=fraction%3D1%2Cendtime%3Dnone&order_by=version%20desc&page_size=1'];
  }
  if (browser.name === 'Microsoft Edge') return ['https://edgeupdates.microsoft.com/api/products/stable'];
  return null;
}

async function guardianFetchText(url, limit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_GUARDIAN_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok || new URL(response.url).origin !== new URL(url).origin
      || Number(response.headers.get('content-length') || 0) > limit) throw new Error('release source unavailable');
    const text = await response.text();
    if (text.length > limit) throw new Error('release response too large');
    return text;
  } finally { clearTimeout(timeout); }
}

function parseBraveRelease(versionText, notes) {
  const product = guardianVersion(versionText.trim());
  const desktop = notes.indexOf('<h2 id="desktop">');
  const next = desktop < 0 ? -1 : notes.indexOf('<h3 id="desktop-release-notes-', desktop);
  const following = next < 0 ? -1 : notes.indexOf('<h3 id="desktop-release-notes-', next + 4);
  const section = next < 0 ? '' : notes.slice(next, following < 0 ? next + 12000 : following);
  const notesVersion = /Release Notes\s*<strong>v([\d.]+)<\/strong>/.exec(section);
  const chromium = /Upgraded Chromium to (\d+\.\d+\.\d+\.\d+)/.exec(section);
  if (!product || !notesVersion || notesVersion[1] !== product) throw new Error('Brave sources disagree');
  return { version: product, engine: guardianVersion(chromium && chromium[1]) };
}

function parseChromeRelease(text) {
  const releases = JSON.parse(text).releases;
  const release = Array.isArray(releases) && releases[0];
  const version = guardianVersion(release && release.version);
  if (!version || release.fraction !== 1 || !release.serving || release.serving.endTime) {
    throw new Error('Chrome release not broadly available');
  }
  return { version };
}

function parseEdgeRelease(text, os) {
  const products = JSON.parse(text);
  const stable = Array.isArray(products) && products.find((item) => item.Product === 'Stable');
  const platform = { win: 'Windows', mac: 'MacOS', linux: 'Linux' }[os];
  const versions = (stable && Array.isArray(stable.Releases) ? stable.Releases : [])
    .filter((item) => item.Platform === platform).map((item) => guardianVersion(item.ProductVersion)).filter(Boolean);
  if (!versions.length) throw new Error('Edge release unavailable');
  versions.sort(compareGuardianVersions);
  return { version: versions[versions.length - 1] };
}

async function guardianLatest(browser, force = false) {
  const urls = guardianSource(browser);
  if (!urls) return null;
  const key = 'updateGuardian:' + browser.name + ':' + browser.os + ':' + browser.arch;
  if (!force && chrome.storage?.session) {
    try {
      const cached = (await chrome.storage.session.get(key))[key];
      if (cached && Date.now() - cached.at < UPDATE_GUARDIAN_CACHE_MS
        && cached.at <= Date.now() && guardianVersion(cached.release?.version)) return cached.release;
    } catch (_) {}
  }
  const release = browser.name === 'Brave'
    ? parseBraveRelease(...await Promise.all([guardianFetchText(urls[0], 100), guardianFetchText(urls[1], 150000)]))
    : browser.name === 'Google Chrome' ? parseChromeRelease(await guardianFetchText(urls[0], 20000))
      : parseEdgeRelease(await guardianFetchText(urls[0], 100000), browser.os);
  try { await chrome.storage?.session?.set({ [key]: { at: Date.now(), release } }); } catch (_) {}
  return release;
}

function guardianAssessment(browser, latest) {
  if (!latest) return { state: 'unknown', title: 'Could not check right now', detail: 'Try again or check updates in your browser.' };
  const installed = browser.fullVersion;
  if (browser.name === 'Brave') {
    if ((installed && compareGuardianVersions(installed, latest.version) < 0)
      || (latest.engine && browser.major && browser.major < Number(latest.engine.split('.')[0]))) {
      return { state: 'update', title: 'Brave update available', detail: 'Your browser is behind the latest Brave release.' };
    }
    if (installed && compareGuardianVersions(installed, latest.version) >= 0) {
      return { state: 'current', title: 'Brave is up to date', detail: 'Your version matches the latest public release.' };
    }
    if (latest.engine && browser.major) {
      return { state: 'major', title: 'Brave looks current', detail: 'Check Brave for smaller security updates.' };
    }
    return { state: 'unknown', title: 'Check Brave updates', detail: 'WardenOne cannot compare your installed version with the latest release.' };
  }
  if (!browser.major) return { state: 'unknown', title: 'Check browser updates', detail: 'WardenOne cannot read your installed version.' };
  if (browser.major < Number(latest.version.split('.')[0])
    || (installed && compareGuardianVersions(installed, latest.version) < 0)) {
    return browser.name === 'Microsoft Edge'
      ? { state: 'update', title: 'Edge update available', detail: 'Your browser may follow a managed update schedule. Check Edge updates.' }
      : { state: 'update', title: 'Chrome update available', detail: 'Your browser is behind the latest Stable release.' };
  }
  if (installed && compareGuardianVersions(installed, latest.version) >= 0) {
    return { state: 'current', title: (browser.name === 'Microsoft Edge' ? 'Edge' : 'Chrome') + ' is up to date',
      detail: 'Your version matches the latest widely available Stable release.' };
  }
  return { state: 'major', title: (browser.name === 'Microsoft Edge' ? 'Edge' : 'Chrome') + ' looks current',
    detail: 'Check your browser for smaller security updates.' };
}

async function renderUpdateGuardian(force = false) {
  const nameEl = $('ug-name');
  const statusEl = $('ug-status');
  const noteEl = $('ug-note');
  const btn = $('ug-btn');
  const latestEl = $('ug-latest');
  const refresh = $('ug-refresh');
  if (!nameEl || !statusEl || !noteEl || !btn || !latestEl || !refresh) return;
  const b = await detectBrowser();
  const displayName = b.name === 'Google Chrome' ? 'Chrome' : b.name === 'Microsoft Edge' ? 'Edge' : b.name;
  nameEl.textContent = displayName;
  const source = guardianSource(b);
  latestEl.textContent = '';
  statusEl.textContent = source ? 'Checking for updates…' : 'Check updates in your browser';
  statusEl.dataset.state = source ? 'checking' : 'unknown';
  noteEl.textContent = source ? '' : 'Live release checks are not available for this browser.';
  refresh.style.display = source ? '' : 'none';
  refresh.disabled = !!source;
  refresh.onclick = () => { void renderUpdateGuardian(true); };
  const page = updatePageFor(b.name);
  if (page) {
    btn.style.display = '';
    btn.textContent = source ? 'Check ' + displayName + ' updates' : 'Open browser updates';
    btn.onclick = () => chrome.tabs.create({ url: page });
  } else {
    btn.style.display = '';
    btn.textContent = 'How to update ' + b.name;
    btn.onclick = () => {
      noteEl.textContent = b.name === 'Firefox'
        ? 'Open the menu → Help → About Firefox to check for updates.'
        : 'Update ' + b.name + ' from your system settings or app store.';
    };
  }
  if (!source) return;
  try {
    const latest = await guardianLatest(b, force);
    latestEl.textContent = 'Latest ' + displayName + ' release: ' + latest.version;
    const assessment = guardianAssessment(b, latest);
    statusEl.textContent = assessment.title;
    statusEl.dataset.state = assessment.state;
    noteEl.textContent = assessment.detail;
  } catch (_) {
    const assessment = guardianAssessment(b, null);
    statusEl.textContent = assessment.title;
    statusEl.dataset.state = assessment.state;
    noteEl.textContent = assessment.detail;
  } finally { refresh.disabled = false; }
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
  /* What the letter is ABOUT. Without this it reads as a verdict on the site --
     "Medium Risk" on YouTube sounds like a warning to leave, when the grade is
     about how the site stores your sign-in and nothing else. Saying so costs one
     line and removes the fright without removing a single fact. */
  const t2b = document.createElement('div');
  t2b.style.cssText = 'font-size:10.5px;margin-top:3px;color:var(--ink-faint);line-height:1.45;';
  t2b.textContent = 'How this site stores your sign-in — not whether the site is safe to use.';
  info.appendChild(t2b);
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
  /* Coloured by the VERDICT, not by whether any finding exists at all. Painting
     every weak cookie danger-red made a C look like an emergency: on YouTube the
     panel showed a red row and a red seven-item list, which is a frightening way
     to describe a site whose own scripts read its own session. Red is for the
     grades that have earned it. */
  const severeColor = /^[DF]$/.test(sc.grade) ? 'var(--wo-danger)' : 'var(--wo-warning)';
  addFact('Cookie security', cookieVerdict, (cookies && cookies.weak && cookies.weak.length) ? severeColor : (cookies && cookies.sessionLike ? 'var(--wo-success)' : null));
  if (data.isSensitivePage) addFact('3rd-party scripts', String((data.thirdPartyScripts || []).length));
  addFact('Risk', sc.risk, sc.riskColor);
  out.appendChild(facts);

  // ---- detail section below the card ----
  out.appendChild(makeLine(data.readableCookieCount + ' cookie(s) readable by scripts. (HttpOnly cookies are correctly invisible to scripts — that\'s the safe state.)', 'var(--ink-soft)'));
  if (cookies && cookies.weak && cookies.weak.length) {
    out.appendChild(makeLine('Flags these session cookies do not set:', severeColor, true));
    cookies.weak.forEach((w) => {
      const miss = [];
      if (!w.httpOnly) miss.push('not HttpOnly');
      if (!w.secure) miss.push('not Secure');
      out.appendChild(makeLine('• ' + w.name + ' — ' + miss.join(', '), 'var(--ink-soft)'));
    });
    /* Proportion, on the grades that deserve it. A list of missing flags with no
       context reads as "this site is unsafe", when for most of the web it means
       "this site's own scripts read its own session" -- weaker than hiding them,
       and not a sign that anything is wrong here. Withheld at D and F, where the
       reader should stay worried. */
    if (!/^[DF]$/.test(sc.grade)) {
      out.appendChild(makeLine('A site\'s own scripts often need to read its session cookies. '
        + 'That is a weaker design than hiding them from scripts entirely — it is not a sign that '
        + 'anything is wrong with this site, or that your account is in danger.', 'var(--ink-faint)'));
    }
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
    // This line was missing, and with it the whole feature. The checkbox is cl-consent, the
    // field the worker reads is consentCookies, and neither name appeared in the other's file,
    // so nothing looked wrong in either place: the control was read by nobody and the sweep was
    // gated on a field nobody sent. Ticking only this box produced "Pick at least one thing to
    // clean", which reads as a UI quirk rather than as the feature being absent (PI-01).
    consentCookies: $('cl-consent').checked,
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
        /* Show severity at the edge; a full warning wash made routine reviews look urgent. */
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
        badge.style.cssText = 'flex:none;font-size:9.5px;font-weight:700;letter-spacing:.02em;color:' + accent + ';';
        badge.textContent = String(item.verdict.label || '').toLowerCase()
          .replace(/^./, (c) => c.toUpperCase());
        top.appendChild(badge);
        card.appendChild(top);
        /* Lead with the engine's advice rather than raw signal labels. */
        card.appendChild(makeLine(item.recommendedAction || item.reputation.label, 'var(--wo-text)'));
        /* Show supporting evidence beneath the advice when it adds information. */
        const evidence = item.verdict.tone === 'danger' && item.reputation && item.reputation.reason
          ? String(item.reputation.reason).split('. ')[0]
          : (item.capabilities && item.capabilities.unexpected && item.capabilities.unexpected.length
            ? item.capabilities.unexpected.map((s) => s.label).join(' · ')
            : ((item.access.reasons && item.access.reasons[0]) || ''));
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
  section('Risky open tabs', tabs, (t) => (t.host || 'Tab') + ' (' + t.why + ')');
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

/* STORE-OMIT-TWITCH-INIT-BEGIN */
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
/* STORE-OMIT-TWITCH-INIT-END */

// ----- Forget Me UI -----
function reconcileForgetHistoryPermission() {
  if (config.forgetMeHistory !== true) return;
  const hist = $('forget-history');
  const status = $('forget-history-status');
  if (hist) hist.disabled = true;
  chrome.permissions.contains({ permissions: ['history'] }).then((granted) => {
    if (hist) hist.disabled = false;
    if (granted || config.forgetMeHistory !== true) return;
    config.forgetMeHistory = false;
    if (hist) hist.checked = false;
    if (status) status.textContent = 'History access is off. Turn this on again to ask Chrome for access.';
    save();
  }).catch(() => {
    if (hist) hist.disabled = false;
    if (status) status.textContent = 'Could not check history access. Browser history will not be cleared until access is confirmed.';
  });
}
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
  const histStatus = $('forget-history-status');
  if (hist) hist.addEventListener('change', () => {
    if (!hist.checked) {
      config.forgetMeHistory = false;
      if (histStatus) histStatus.textContent = 'Browser history will be kept.';
      save();
      return;
    }
    hist.disabled = true;
    try {
      chrome.permissions.request({ permissions: ['history'] }).then((granted) => {
        hist.disabled = false;
        if (!granted) {
          hist.checked = false;
          if (histStatus) histStatus.textContent = 'History access was not granted. Browser history will be kept.';
          return;
        }
        config.forgetMeHistory = true;
        if (histStatus) histStatus.textContent = 'History access granted. Forget Me can clear this site from browser history.';
        save();
      }).catch(() => {
        hist.disabled = false;
        hist.checked = false;
        if (histStatus) histStatus.textContent = 'Could not request history access. Browser history will be kept.';
      });
    } catch (_) {
      hist.disabled = false;
      hist.checked = false;
      if (histStatus) histStatus.textContent = 'Could not request history access. Browser history will be kept.';
    }
  });

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

// WardenOne-owned storage is separate from the browser/site-data cleaner above.
// Inspect first, then ask for a destructive choice using the current inventory.
(function wirePrivacyDataErase() {
  const inspect = $('privacy-data-inspect');
  const erase = $('privacy-data-erase');
  const eraseSite = $('privacy-data-erase-site');
  const mode = $('privacy-data-mode');
  const preview = $('privacy-data-preview');
  const result = $('privacy-data-result');
  if (!inspect || !erase || !mode || !preview || !result) return;
  const ask = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, error: error.message } : (reply || { ok: false, error: 'No response.' }));
      });
    } catch (error) { resolve({ ok: false, error: String(error) }); }
  });
  const paint = (data) => {
    preview.textContent = '';
    if (!data.ok) { preview.textContent = 'Could not inspect: ' + (data.error || 'unknown error'); return; }
    const summary = document.createElement('div');
    summary.textContent = data.records.length + ' saved items · ' + Math.round(data.totalBytes / 1024) + ' KiB';
    preview.appendChild(summary);
    const details = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = 'View storage details';
    details.appendChild(heading);
    const list = document.createElement('ul');
    list.style.cssText = 'max-height:180px;overflow:auto;padding-left:18px;margin:6px 0;';
    for (const item of data.records) {
      const li = document.createElement('li');
      const date = item.oldestKnownAt ? new Date(item.oldestKnownAt).toLocaleDateString() : 'age unknown';
      li.textContent = item.area + ' · ' + item.key + ' · ' + Math.round(item.bytes / 1024)
        + ' KiB · ' + date + ' · ' + item.owner + ' · ' + item.retention;
      list.appendChild(li);
    }
    details.appendChild(list);
    preview.appendChild(details);
  };
  inspect.addEventListener('click', async () => {
    inspect.disabled = true;
    preview.textContent = 'Inspecting…';
    paint(await ask({ kind: 'privacy-data-inspect' }));
    inspect.disabled = false;
  });
  const eraseLabels = {
    all: 'Reset WardenOne',
    settings: 'Clear records and API keys',
    'settings-and-keys': 'Clear saved records',
  };
  const updateEraseLabel = () => { erase.textContent = eraseLabels[mode.value] || eraseLabels.all; };
  mode.addEventListener('change', updateEraseLabel);
  updateEraseLabel();
  erase.addEventListener('click', async () => {
    erase.disabled = true;
    result.textContent = '';
    const data = await ask({ kind: 'privacy-data-inspect' });
    paint(data);
    if (!data.ok) { erase.disabled = false; return; }
    const confirmations = {
      all: 'Reset WardenOne completely? This removes its settings, API keys and saved records.',
      settings: 'Clear saved records and API keys? Basic settings will stay.',
      'settings-and-keys': 'Clear saved records? Basic settings and API keys will stay.',
    };
    const choice = mode.value;
    if (!confirmations[choice] || !confirm(confirmations[choice] + '\n\n'
      + data.records.length + ' datasets (' + Math.round(data.totalBytes / 1024) + ' KiB) are currently saved. '
      + 'This resets learned protections and site exceptions. Active Download Shield reviews must be finished first.')) {
      erase.disabled = false;
      return;
    }
    const answer = await ask({ kind: 'privacy-data-erase', mode: choice });
    if (answer.ok) {
      try { localStorage.removeItem('wardenone_theme'); } catch (_) {}
    }
    result.textContent = answer.ok ? (choice === 'all' ? 'WardenOne was reset and is restarting.'
      : 'Saved records cleared. WardenOne is restarting with '
        + (choice === 'settings' ? 'basic settings' : 'basic settings and API keys') + ' kept.')
      : 'Could not complete erasure: ' + (answer.error || 'unknown error');
    if (!answer.ok) erase.disabled = false;
  });
  if (eraseSite) eraseSite.addEventListener('click', () => {
    currentHost(async (host) => {
      if (!host) { result.textContent = 'Open a website to erase its WardenOne records.'; return; }
      eraseSite.disabled = true;
      result.textContent = 'Inspecting this site’s records…';
      const plan = await ask({ kind: 'privacy-data-erase-site', host, dryRun: true });
      if (!plan.ok) {
        result.textContent = 'Could not inspect: ' + (plan.error || 'unknown error');
        eraseSite.disabled = false;
        return;
      }
      if (!plan.affected.length) {
        result.textContent = 'No saved WardenOne records found for this site.';
        eraseSite.disabled = false;
        return;
      }
      if (!confirm('Clear saved WardenOne records for ' + plan.site + '?\n\n'
        + plan.affected.length + ' datasets will change. Shared reputation caches, tracker learning and Script Drift baselines may be cleared for other sites too. Restarting WardenOne also clears temporary session records. Website cookies and browser history are untouched.')) {
        eraseSite.disabled = false;
        result.textContent = 'Site erasure cancelled.';
        return;
      }
      const answer = await ask({ kind: 'privacy-data-erase-site', host });
      result.textContent = answer.ok ? 'Cleared WardenOne records for ' + answer.site + '. WardenOne is restarting.'
        : 'Could not complete site erasure: ' + (answer.error || 'unknown error');
      if (!answer.ok) eraseSite.disabled = false;
    });
  });
})();

// ----- Advanced WebGL Resource Saver -----
let webglSaverCurrentHost = '';

function webglSaverMode() {
  return /^(?:selected|everywhere)$/.test(String(config.webglSaverMode || '')) ? config.webglSaverMode : 'off';
}

function webglSaverHost(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return '';
    return WOEyeShieldProfiles.hostOf(url.hostname);
  } catch (_) { return ''; }
}

function webglSaverListKey() {
  return webglSaverMode() === 'everywhere' ? 'webglSaverAllowHosts' : 'webglSaverBlockHosts';
}

function webglSaverHosts(key) {
  const seen = new Set();
  return (Array.isArray(config[key]) ? config[key] : []).map(webglSaverHost).filter((host) => {
    if (!host || seen.has(host) || seen.size >= 300) return false;
    seen.add(host);
    return true;
  });
}

function setWebglSaverStatus(text, error) {
  const status = $('webgl-saver-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = error ? 'var(--wo-danger)' : '';
}

function paintWebGLSaver() {
  const select = $('webgl-saver-mode');
  const explain = $('webgl-saver-explain');
  const current = $('webgl-saver-current');
  const input = $('webgl-saver-input');
  const add = $('webgl-saver-add');
  const list = $('webgl-saver-list');
  if (!select || !explain || !current || !input || !add || !list) return;
  const mode = webglSaverMode();
  const key = webglSaverListKey();
  const hosts = webglSaverHosts(key);
  config[key] = hosts;
  select.value = mode;
  input.disabled = mode === 'off';
  add.disabled = mode === 'off';
  list.replaceChildren();
  if (mode === 'off') {
    explain.textContent = 'WebGL works normally on every site.';
    current.textContent = 'Choose a mode to use a current-site action';
    current.disabled = true;
  } else if (mode === 'selected') {
    explain.textContent = 'WebGL is disabled only on the sites listed below. Other sites keep normal 3D graphics.';
    const listed = hosts.includes(webglSaverCurrentHost);
    current.textContent = webglSaverCurrentHost ? (listed ? 'Use WebGL on ' : 'Disable WebGL on ') + webglSaverCurrentHost : 'Open a website to change it';
    current.disabled = !webglSaverCurrentHost;
  } else {
    explain.textContent = 'WebGL is disabled on every site except the allowed sites listed below.';
    const listed = hosts.includes(webglSaverCurrentHost);
    current.textContent = webglSaverCurrentHost ? (listed ? 'Disable WebGL on ' : 'Allow WebGL on ') + webglSaverCurrentHost : 'Open a website to change it';
    current.disabled = !webglSaverCurrentHost;
  }
  if (mode === 'off') {
    const empty = document.createElement('div');
    empty.className = 'desc';
    empty.textContent = 'Your saved site lists are kept while this is off.';
    list.appendChild(empty);
    return;
  }
  if (!hosts.length) {
    const empty = document.createElement('div');
    empty.className = 'desc';
    empty.textContent = mode === 'selected' ? 'No sites have WebGL disabled.' : 'No sites are allowed as exceptions.';
    list.appendChild(empty);
  }
  hosts.forEach((host) => {
    const row = document.createElement('div');
    row.className = 'memory-sites-list-item';
    const name = document.createElement('span');
    name.textContent = host;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + host + ' from this WebGL list');
    remove.addEventListener('click', () => changeWebglSaverHost(host, false));
    row.append(name, remove);
    list.appendChild(row);
  });
}

function changeWebglSaverHost(raw, addHost) {
  const mode = webglSaverMode();
  if (mode === 'off') return;
  const host = webglSaverHost(raw);
  if (!host) { setWebglSaverStatus('Enter a website such as example.com.', true); return; }
  const key = webglSaverListKey();
  const hosts = webglSaverHosts(key).filter((item) => item !== host);
  if (addHost) hosts.push(host);
  config[key] = hosts.slice(0, 300);
  const input = $('webgl-saver-input');
  if (input && addHost) input.value = '';
  paintWebGLSaver();
  save(() => setWebglSaverStatus((mode === 'selected' ? 'WebGL is ' + (addHost ? 'disabled on ' : 'available again on ') : 'WebGL is ' + (addHost ? 'allowed on ' : 'disabled again on ')) + host + '. Reload that site to apply fully.', false));
}

(function initWebGLSaver() {
  const select = $('webgl-saver-mode');
  const input = $('webgl-saver-input');
  const add = $('webgl-saver-add');
  const current = $('webgl-saver-current');
  if (!select || !input || !add || !current) return;
  select.addEventListener('change', () => {
    config.webglSaverMode = /^(?:selected|everywhere)$/.test(select.value) ? select.value : 'off';
    paintWebGLSaver();
    save(() => setWebglSaverStatus('WebGL mode saved. Reload affected pages to apply fully.', false));
  });
  add.addEventListener('click', () => changeWebglSaverHost(input.value, true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); add.click(); }
  });
  current.addEventListener('click', () => {
    if (!webglSaverCurrentHost) return;
    const listed = webglSaverHosts(webglSaverListKey()).includes(webglSaverCurrentHost);
    changeWebglSaverHost(webglSaverCurrentHost, !listed);
  });
  const refreshCurrent = () => activeTabHost((host) => { webglSaverCurrentHost = webglSaverHost(host); paintWebGLSaver(); });
  chrome.tabs.onActivated.addListener(refreshCurrent);
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => { if (change.url && tab.active) refreshCurrent(); });
  refreshCurrent();
  paintWebGLSaver();
}());

// ----- Memory Shield UI -----
/* The build profile (CWS-03). The Store package includes EyeShield, Memory Shield and Tab Limit;
   every element marked data-feature for an omitted utility is
   removed before the popup paints, a heading with a fallback label is relabelled, and nothing
   below asks the worker for a feature this package does not carry. In the full build the omitted
   list is empty and this does nothing. */
function applyBuildProfile() {
  let omitted = [];
  try { omitted = (typeof WARDENONE_BUILD === 'object' && WARDENONE_BUILD && Array.isArray(WARDENONE_BUILD.omitted)) ? WARDENONE_BUILD.omitted : []; } catch (_) { omitted = []; }
  if (!omitted.length) return omitted;
  document.querySelectorAll('[data-feature]').forEach((el) => {
    const id = el.getAttribute('data-feature');
    if (omitted.indexOf(id) === -1) return;
    const fallback = el.getAttribute('data-feature-fallback');
    if (fallback) { el.textContent = fallback; el.removeAttribute('data-feature'); return; }
    el.remove();
  });
  return omitted;
}
const OMITTED_FEATURES = applyBuildProfile();
function featureOmitted(id) { return OMITTED_FEATURES.indexOf(id) !== -1; }

(function initMemoryShield() {
  if (featureOmitted('memoryShield')) return;
  const modeWrap = $('mem-modes');
  if (!modeWrap) return;
  const siteInput = $('mem-site-input');
  const siteAdd = $('mem-site-add');
  const siteList = $('mem-site-list');
  const siteCurrent = $('mem-site-add-current');
  const siteStatus = $('mem-site-status');
  let currentHost = '';
  let savedHosts = [];
  let siteRequest = 0;
  let siteBusy = false;
  const showSiteStatus = (message) => { siteStatus.textContent = message; siteStatus.hidden = false; };
  const paintCurrent = () => {
    siteCurrent.disabled = siteBusy || !currentHost || savedHosts.includes(currentHost);
    siteCurrent.title = currentHost ? currentHost : 'Open a website first';
  };
  const paintSites = () => {
    siteList.replaceChildren();
    if (!savedHosts.length) {
      const empty = document.createElement('div');
      empty.className = 'desc';
      empty.textContent = 'No saved sites yet.';
      siteList.appendChild(empty);
    }
    savedHosts.forEach((host) => {
      const row = document.createElement('div');
      row.className = 'memory-sites-list-item';
      const name = document.createElement('span');
      name.textContent = host;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + host + ' from never-sleep sites');
      remove.disabled = siteBusy;
      remove.addEventListener('click', () => changeSite(host, false));
      row.append(name, remove);
      siteList.appendChild(row);
    });
    paintCurrent();
  };
  const refreshSites = () => {
    const request = ++siteRequest;
    chrome.runtime.sendMessage({ kind: 'memory-never-sleep-list' }, (result) => {
      if (request !== siteRequest) return;
      if (chrome.runtime.lastError || !result || !result.ok || !Array.isArray(result.hosts)) {
        showSiteStatus('Could not load never-sleep sites.');
        return;
      }
      savedHosts = result.hosts;
      paintSites();
    });
  };
  const changeSite = (host, on) => {
    if (siteBusy) return;
    siteBusy = true;
    siteAdd.disabled = true;
    paintSites();
    chrome.runtime.sendMessage({ kind: 'memory-never-sleep-set', host, on }, (result) => {
      siteBusy = false;
      siteAdd.disabled = false;
      const error = chrome.runtime.lastError;
      if (error || !result || !result.ok) showSiteStatus((result && result.error) || (error && error.message) || 'Could not save this site.');
      else {
        if (on) siteInput.value = '';
        showSiteStatus(result.host + (on ? ' is kept awake.' : ' can sleep again.'));
      }
      refreshSites();
    });
  };
  siteAdd.addEventListener('click', () => changeSite(siteInput.value.trim(), true));
  siteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); siteAdd.click(); }
  });
  siteCurrent.addEventListener('click', () => { if (currentHost) changeSite(currentHost, true); });
  const refreshCurrent = () => activeTabHost((host) => {
    chrome.runtime.sendMessage({ kind: 'memory-never-sleep-state', host }, (result) => {
      currentHost = chrome.runtime.lastError || !result || !result.ok ? '' : result.host;
      paintCurrent();
    });
  });
  chrome.tabs.onActivated.addListener(refreshCurrent);
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.url && tab.active) refreshCurrent();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wardenone_config) refreshSites();
  });
  refreshCurrent();
  refreshSites();
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
          const refused = r.keptReasons && r.keptReasons['Chrome refused to sleep'] || 0;
          out.textContent = 'Slept ' + r.slept + ' tab' + (r.slept === 1 ? '' : 's') + '. Kept ' + r.kept
            + ' (active, pinned, audio, forms, etc.).'
            + (refused ? ' Chrome refused to sleep ' + refused + ' of the kept tabs.' : '');
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
      dupBtn.disabled = false; dupBtn.textContent = 'Find matching tabs';
      if (!out) return;
      out.style.display = 'block';
      if (!r || !r.ok) { out.textContent = 'Could not check matching tabs.'; return; }
      if (!r.extraCount) { out.textContent = 'No matching web addresses found.'; return; }
      out.textContent = '';
      const line = document.createElement('div');
      const groupCount = Array.isArray(r.groups) ? r.groups.length : 0;
      line.textContent = 'Found ' + r.extraCount + ' extra tab' + (r.extraCount === 1 ? '' : 's')
        + ' sharing ' + groupCount + ' exact web address' + (groupCount === 1 ? '' : 'es') + '.';
      line.style.marginBottom = '6px';
      out.appendChild(line);
      const close = document.createElement('button');
      close.className = 'btn';
      close.style.cssText = 'width:100%;font-size:11px;border:1px solid var(--wo-popup-soft-danger-line);color:var(--wo-popup-soft-danger);';
      close.textContent = 'Close eligible matching tabs';
      close.addEventListener('click', () => {
        if (!confirm('Matching addresses can still hold different in-page work. WardenOne keeps active, protected, busy or unverified tabs, but cannot detect every app’s unsaved state. Close eligible matches?')) return;
        close.disabled = true; close.textContent = 'Closing…';
        chrome.runtime.sendMessage({ kind: 'memory-close-duplicates' }, (rr) => { void chrome.runtime.lastError;
          out.textContent = (rr && rr.ok)
            ? (rr.closed ? 'Closed ' + rr.closed + ' eligible matching tab' + (rr.closed === 1 ? '' : 's') + '. Other matches stayed open.'
              : 'No matching tabs were eligible to close.')
            : 'Could not close matching tabs.';
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
/* Password exposure, by k-anonymity range query.
 *
 * The whole point is that the service never learns which password was asked
 * about. The password is hashed here; only the first five characters of the
 * hash are sent; the reply contains every suffix sharing that prefix -- hundreds
 * of unrelated passwords -- and the match is made in this function.
 *
 * It runs in the popup rather than the worker on purpose. An earlier version of
 * this feature lived in background.js behind a 'breach-check' message, which
 * meant a channel existed that a page could post hash prefixes into; nothing in
 * the interface could reach it, so what shipped was a documented feature that
 * did not exist and an open channel that did. The extension page already holds
 * the host permission, so doing it here needs no message kind at all.
 */
/* The element picker: starting it, and the way back from it.
 *
 * The picker itself is injected on demand rather than declared in the manifest,
 * so it costs nothing on pages nobody asked about and no page script can start
 * it -- there is no content script sitting there listening for a signal.
 *
 * The list below is not decoration. Something hidden with no way to bring it
 * back is worse than whatever it was hiding, and the reader will not remember
 * the selector, the page or the day. Same lesson as the silenced notifications:
 * the undo has to be somewhere findable, and it has to be visible whether or
 * not anything is in it.
 */
function pickerHostFromTab(tab) {
  try { return new URL(tab.url).hostname; } catch (_) { return ''; }
}

function renderHiddenList() {
  const wrap = $('hidden-list-wrap');
  const list = $('hidden-list');
  const summary = $('hidden-list-summary');
  if (!wrap || !list) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const host = pickerHostFromTab(tabs[0] || {});
    wrap.style.display = 'block';
    list.textContent = '';
    if (!host) {
      if (summary) summary.textContent = 'Saved on this site';
      const empty = document.createElement('div');
      empty.className = 'desc';
      empty.textContent = 'Open a normal web page to see saved hidden elements.';
      list.appendChild(empty);
      return;
    }
    chrome.runtime.sendMessage({ kind: 'hidden-list', hostname: host }, (res) => {
      void chrome.runtime.lastError;
      list.textContent = '';
      const entries = Array.isArray(res && res.entries)
        ? res.entries
        : ((res && res.selectors) || []).map((selector) => ({ hostname: (res && res.host) || host, selector }));
      if (summary) summary.textContent = 'Saved on this site (' + entries.length + ')';
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'desc';
        empty.textContent = 'Nothing is saved for this site yet.';
        list.appendChild(empty);
        return;
      }
      entries.forEach((entry) => {
        const sel = String((entry && entry.selector) || '');
        const savedHost = String((entry && entry.hostname) || host);
        if (!sel) return;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--wo-border);';
        const label = document.createElement('div');
        label.style.cssText = 'flex:1 1 auto;min-width:0;font:11px ui-monospace,monospace;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        label.textContent = sel;
        label.title = sel + (savedHost && savedHost !== host ? ' (saved on ' + savedHost + ')' : '');
        const undo = document.createElement('button');
        undo.className = 'btn';
        undo.style.cssText = 'flex:0 0 auto;padding:3px 9px;font-size:11px;';
        undo.textContent = 'Show again';
        undo.addEventListener('click', () => {
          undo.disabled = true;
          chrome.runtime.sendMessage({ kind: 'hidden-remove', hostname: savedHost, selector: sel }, () => {
            void chrome.runtime.lastError;
            /* No reload. The worker tells every matching tab to rebuild its
               hidden-element stylesheet and to drop the Zapper's mark from
               anything the list no longer covers, so the element comes back in
               place. Reloading once per undo -- which is what this did -- looked
               like a reload loop to WardenOne's own detector the moment somebody
               undid more than one thing. */
            renderHiddenList();
          });
        });
        row.appendChild(label);
        row.appendChild(undo);
        list.appendChild(row);
      });
    });
  });
}

if ($('manage-hidden-elements')) {
  $('manage-hidden-elements').addEventListener('click', (event) => {
    event.preventDefault();
    window.open(chrome.runtime.getURL('hidden-elements.html'));
  });
}

if ($('ss-pick')) {
  $('ss-pick').addEventListener('click', () => {
    const out = $('ss-pick-result');
    out.style.display = 'block';
    out.style.color = 'var(--ink-faint)';
    if (config.elementZapper === false) {
      out.textContent = 'Turn on Element Zapper first.';
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !/^https?:/i.test(tab.url || '')) {
        out.textContent = 'Open a normal web page first.';
        return;
      }
      const target = { tabId: tab.id };
      /* One injection. The mode flag this used to set first is gone with the
         second tool it selected between. */
      chrome.scripting.executeScript({ target, files: ['element-picker.js'] }, () => {
        if (chrome.runtime.lastError) {
          out.textContent = 'This page does not allow WardenOne to run here.';
          return;
        }
        out.textContent = 'Zapper started — click the thing you want gone.';
        /* The popup closes the moment focus moves to the page, which is the
           point: the reader is choosing over there now, not in here. */
        setTimeout(() => window.close(), 250);
      });
    });
  });
}

const PWNED_PREFIX_LEN = 5;
const PWNED_TIMEOUT_MS = 8000;

async function sha1Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

$('ss-pwned').addEventListener('click', async () => {
  const input = $('ss-pwned-input');
  const out = $('ss-pwned-result');
  const btn = $('ss-pwned');
  const password = input ? input.value : '';

  out.style.display = 'block';
  out.textContent = '';
  if (!password) {
    out.style.color = 'var(--ink-faint)';
    out.textContent = 'Type a password into the box first.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Checking…';
  out.style.color = 'var(--ink-faint)';
  out.textContent = 'Hashing on this device…';

  /* Cleared whichever way this ends, including the throw. The value has no
     reason to outlive the click, and the box is the only place it exists. */
  const finish = () => {
    btn.disabled = false;
    btn.textContent = 'Check this password';
    if (input) input.value = '';
  };

  let hash = '';
  try {
    hash = await sha1Hex(password);
    const prefix = hash.slice(0, PWNED_PREFIX_LEN);
    const suffix = hash.slice(PWNED_PREFIX_LEN);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PWNED_TIMEOUT_MS);
    let res;
    try {
      res = await fetch('https://api.pwnedpasswords.com/range/' + prefix, {
        method: 'GET',
        /* Padding makes every bucket answer at a similar size. Without it the
           length of the reply narrows down which prefix was asked for, which is
           visible to anything on the path even though the body is encrypted. */
        headers: { 'Add-Padding': 'true' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res || !res.ok) {
      /* Never render a failure as good news. "Not found" and "could not ask"
         look the same on screen unless this says which one happened. */
      out.style.color = 'var(--ink-faint)';
      out.textContent = res && res.status === 429
        ? 'The service is busy right now. Wait a minute and try again.'
        : 'Could not check right now — this is not an all-clear. Try again shortly.';
      finish();
      return;
    }

    const body = await res.text();
    let count = 0;
    for (const line of body.split('\n')) {
      const sep = line.indexOf(':');
      if (sep < 0) continue;
      if (line.slice(0, sep).trim().toUpperCase() !== suffix) continue;
      count = parseInt(line.slice(sep + 1).trim(), 10) || 0;
      break;
    }

    out.textContent = '';
    if (!count) {
      out.style.color = 'var(--wo-success)';
      out.appendChild(makeLine('Not found in any known breach.', 'var(--wo-success)', true));
      out.appendChild(makeLine('This password does not appear in Have I Been Pwned’s collection of breached passwords. That is not the same as it being a strong password.', 'var(--ink-soft)'));
    } else {
      out.style.color = 'var(--wo-danger)';
      out.appendChild(makeLine('Found in known breaches ' + count.toLocaleString() + (count === 1 ? ' time.' : ' times.'), 'var(--wo-danger)', true));
      out.appendChild(makeLine('This exact password is in public breach data, so it is on the lists attackers try first. Change it anywhere you use it, and do not reuse it.', 'var(--ink-soft)'));
    }
    out.appendChild(makeLine('Only the first ' + PWNED_PREFIX_LEN + ' characters of the hash were sent. The password never left this device, and this answer has not been saved.', 'var(--ink-faint)'));
  } catch (err) {
    out.style.color = 'var(--ink-faint)';
    out.textContent = (err && err.name === 'AbortError')
      ? 'The service took too long to answer — this is not an all-clear. Try again shortly.'
      : 'Could not check right now — this is not an all-clear. Try again shortly.';
  } finally {
    hash = '';
    finish();
  }
});
/* Typing a new one clears the last answer. Leaving a red "found in breaches"
   result sitting above a different password is a way to misread it. */
if ($('ss-pwned-input')) {
  $('ss-pwned-input').addEventListener('input', () => {
    const out = $('ss-pwned-result');
    if (out && out.style.display !== 'none') { out.style.display = 'none'; out.textContent = ''; }
  });
}

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
      /* Says what was checked (FEAT-06). "Every component" claimed the helpers that start with a
         page -- mail, sign-in, search and Twitch -- which this tool does not look at. */
      addText(' WardenOne’s files, saved settings and lists checked out, and the page engine answered in every open tab it runs on. Helpers that start with a page — mail, sign-in, search and Twitch — are not checked here; they start fresh when a page reloads.');
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

const permissionsLink = $('wo-perms-link');
if (permissionsLink) permissionsLink.addEventListener('click', (event) => {
  try {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('permissions.html') });
  } catch (_) {}
});

/* ---- Site Dashboard ----------------------------------------------------------------------------
   The current site as the popup's centre: a card under the master switch with what WardenOne
   stopped on this page, and a view behind it with the detail. The numbers come from the worker
   (site-dashboard: the network rules Chrome matched in this tab, and the Activity Centre's own log
   cut to this site and this page load); the switch states come from this popup's config. Nothing
   here changes a setting. */
/* label: the dashboard's row. a / many: how the one-line card names one of them, or several. */
const SITE_DASH_CATEGORIES = [
  { id: 'trackers', label: 'Trackers', a: 'a tracker', many: 'trackers' },
  { id: 'ads', label: 'Ads', a: 'an ad', many: 'ads' },
  { id: 'popups', label: 'Pop-ups & redirects', a: 'a pop-up or redirect', many: 'pop-ups and redirects' },
  { id: 'cleaned', label: 'Tracking cleaned from links', a: 'a tracking link', many: 'tracking links' },
  { id: 'annoyances', label: 'Overlays & clutter removed', a: 'an overlay', many: 'overlays' },
  { id: 'consent', label: 'Cookie banners rejected', a: 'a cookie banner', many: 'cookie banners' },
  { id: 'security', label: 'Threats & risky requests', a: 'a threat', many: 'threats' },
  /* A token-shaped value kept from leaving the page. On big sites that is often an ordinary
     embedded-service call (the worker says so on the event), so it is never counted as a threat. */
  { id: 'sensitive', label: 'Sensitive requests protected', a: 'a sensitive request', many: 'sensitive requests' },
  { id: 'privacy', label: 'Camera, mic & device requests', a: 'a device request', many: 'device requests' },
  { id: 'yours', label: 'Your own rules', a: 'a request your rules block', many: 'requests your rules block' },
  { id: 'other', label: 'Other protection rules', a: 'one other request', many: 'other requests' },
];
/* The card's layout, chosen under Interface: 'A' one row like Protection Health, 'B' trackers, ads
   and other as three counts. A display preference, so it is kept on its own key rather than in
   the protection config. */
const SITE_CARD_LAYOUT_KEY = 'wardenone_site_card_layout';
const SITE_CARD_FOLD_KEY = 'wardenone_site_card_folded';
let siteCardLayout = 'A';
/* The protections the engine pauses on YouTube so videos play (YT_COMPAT_PAUSED in
   src/content.js). Only used to say "paused here" instead of "on". */
const SITE_DASH_YT_PAUSED = new Set([
  'removeOverlays', 'autoRejectConsent', 'blockAutoplay', 'blockAutoplayMedia', 'mediaShield', 'fullscreenGuard',
  'lazyLoadMedia', 'throttleBackgroundTabs', 'blockGesturelessNav', 'blockForcedPopups', 'strictPopupShield',
  'blockMetaRefresh', 'detectRedirectChains', 'backTrapGuard', 'oneOpenPerGesture', 'gateAdultSites',
  'adultHeuristics', 'blockSupercookies', 'notificationAbuseGuard', 'antiClickjacking',
]);
/* The protections the engine pauses on university and school sites so sign-in and classes work
   (EDU_COMPAT_PAUSED in src/content.js; tools/test-education-compat.js keeps the two in step).
   blockTokenExfil is only partly paused there: anti-redirect.js keeps its own half. */
const SITE_DASH_EDU_PAUSED = new Set([
  'removeOverlays', 'autoRejectConsent', 'blockMetaRefresh', 'detectRedirectChains', 'backTrapGuard', 'fakeWindowGuard',
  'sessionShield', 'blockTokenExfil', 'continuousTokenScan', 'blockCameraMic', 'blockScreenCapture',
  'blockGeolocation', 'deviceAccessGuard', 'capabilityGuard', 'notificationAbuseGuard', 'blockAutoplayMedia', 'mediaShield',
  'fullscreenGuard', 'gateAdultSites', 'adultHeuristics', 'antiClickjacking',
]);
const SITE_DASH_EDU_PARTLY = new Set(['blockTokenExfil']);
const SITE_DASH_PROTECTIONS = [
  { key: 'adShield', label: 'AdShield' },
  { key: 'blockTrackers', label: 'Tracker blocking' },
  { key: 'blockFingerprintScripts', label: 'Fingerprinting-script blocking' },
  { key: 'blockMalwareSites', label: 'Malware & scam site blocking' },
  { key: 'detectPhishing', label: 'Phishing detection' },
  { key: 'blockForcedPopups', label: 'Pop-up & redirect guard' },
  { key: 'blockThirdPartyCookies', label: 'Third-party cookie blocking' },
  { key: 'stripTrackingParams', label: 'Link cleaning' },
  { key: 'blockTokenExfil', label: 'Sign-in & token protection' },
];
const SITE_DASH_EVENT_LABELS = {
  blocked_popup: 'Blocked a pop-up',
  blocked_gestureless_nav: 'Stopped a redirect you didn’t click',
  blocked_meta_refresh: 'Stopped an automatic redirect',
  blocked_form_submit: 'Stopped a forced form submit',
  blocked_redirect_chain: 'Stopped a redirect chain',
  blocked_forced_redirect: 'Stopped the page sending you elsewhere',
  blocked_frame_top_redirect: 'Stopped a frame redirecting the tab',
  blocked_ad_auction_redirect: 'Stopped a forced ad click',
  cleaned_history_url: 'Removed tracking from the address',
  stripped_link_ping: 'Removed click-tracking from links',
  cleaned_copied_link: 'Cleaned a link you copied',
  consent_rejected: 'Rejected a cookie banner for you',
  google_search_cleanup: 'Hid search clutter',
  scriptlet_mutator_blocked: 'Stopped a script setting a cookie',
  youtube_ads_removed: 'Removed ad breaks from YouTube’s player',
  purged_bounce_storage: 'Cleared a redirect tracker’s leftovers',
  cleaned_site_cookies: 'Cleared cookies after you left',
  cleaned_site_storage: 'Cleared tracking IDs as you left',
  blocked_overlay: 'Hid an overlay or nag',
  blocked_confirm_bait: 'Removed a fake confirm box',
  blocked_overlay_ad_frame: 'Removed a floating ad frame',
  blocked_autoplay_media: 'Stopped autoplaying media',
  blocked_hidden_media: 'Stopped hidden media',
  blocked_tracker_request: 'Blocked a first-party tracker',
  blocked_thirdparty_cookie: 'Blocked a third-party cookie',
  blocked_token_exfil: 'Protected a sensitive request',
  blocked_skimmer_exfil: 'Blocked card or password theft',
  blocked_phishing: 'Blocked a phishing look-alike',
  blocked_clipboard_hijack: 'Blocked a clipboard hijack',
  blocked_cryptominer: 'Stopped a cryptominer',
  blocked_grabber_fetch: 'Blocked an IP-grabber request',
  blocked_grabber_xhr: 'Blocked an IP-grabber request',
  blocked_grabber_beacon: 'Blocked an IP-grabber beacon',
  blocked_grabber_pixel: 'Blocked an IP-logging image',
  blocked_grabber_network: 'Blocked an IP-logging image request',
  blocked_grabber_navigation: 'Blocked an IP-logger visit',
  warned_grabber_image: 'Warned about a possible IP-logging image',
  blocked_safe_browsing_link: 'Blocked a dangerous link',
  blocked_safe_browsing_form: 'Blocked a dangerous form',
  blocked_media_capture: 'Blocked camera or mic access',
  blocked_screen_capture: 'Blocked screen capture',
  detected_thirdparty_tracker: 'Noticed a third-party tracker',
  detected_beacon: 'Noticed data sent in the background',
  detected_download_gate: 'Noticed a download-gate ad',
  warned_back_trap: 'Noticed a back-button trap',
  warned_logger_api: 'Noticed a possible tracker request',
  warned_shortener: 'Noticed a shortened link',
  warned_redirect_param: 'Noticed a redirecting link',
  warned_service_worker: 'Noticed a service worker being installed',
  warned_idle_watch: 'Noticed presence tracking',
  warned_media_capture: 'Noticed a camera or mic request',
  warned_phishing: 'Warned: possibly a fake or phishing site',
  warned_insecure_login: 'Warned about an insecure sign-in',
  warned_notification_bait: 'Warned about notification bait',
  behavioral_risk: 'Site reputation warning',
};
let siteDashLast = null;
/* Brave Shields runs before any extension's network rules: measured in Brave 154, it served its
   own stand-ins for Google Analytics, Tag Manager, DoubleClick and AdSense and blocked the Facebook
   pixel outright, so WardenOne's rules never saw a request to count. A low number there is true,
   and the dashboard says why rather than leaving a bare zero. */
let siteDashIsBrave = false;
let siteDashScrollY = 0;
let siteDashTimelineOpen = false;
let siteDashRefreshTimer = 0;

function siteDashIsYouTube(host) {
  return /(^|\.)youtube(-nocookie)?\.com$|(^|\.)youtu\.be$/i.test(String(host || ''));
}
/* The engine's own test (EDU_COMPAT_HOST in src/content.js). */
function siteDashIsEducation(host) {
  return /(^|\.)(edu|edu\.au|edu\.sg|edu\.hk|ac\.uk|ac\.nz|ac\.za|ac\.in|ucas\.com)$/i.test(String(host || '').replace(/^www\./, ''));
}

function siteDashSummarize(res) {
  const counted = wardenSiteDashSummarize(res);
  const net = (res && res.network) || {};
  const typeCounts = (res.page && res.page.typeCounts) || {};
  const events = ((res.page && res.page.events) || [])
    .map((e) => Object.assign({}, e, { kind: wardenSiteDashEventKind(e.type) }))
    .filter((e) => e.kind);
  return {
    host: res.host || '',
    web: !!res.web,
    since: Number(res.since) || 0,
    net,
    cats: counted.cats,
    events,
    typeCounts,
    tallies: (res.page && res.page.tallies) || [],
    recent: res.recent || { day: {}, week: {} },
    noticed: counted.noticed,
    total: counted.total,
    retained: res.retained || null,
  };
}

function siteDashState(host) {
  if (config.enabled === false) return { cls: 'is-off', text: 'Off', line: 'WardenOne is switched off everywhere.' };
  if ((config.allowlist || []).includes(host)) return { cls: 'is-paused', text: 'Allowlisted', line: 'You allowlisted this site, so WardenOne steps back here.' };
  const until = pausedUntilFor(host);
  if (until) return { cls: 'is-paused', text: 'Paused', line: 'Paused here for another ' + describeRemaining(until - Date.now()) + '.' };
  return { cls: '', text: 'Protected', line: '' };
}

/* What a protection is doing on this site, in the same order the engine decides it. */
function siteDashProtectionState(key, host, state) {
  if (state.cls === 'is-off') return { cls: 'is-off', text: 'WardenOne is off' };
  if (state.cls === 'is-paused') return { cls: 'is-paused', text: state.text + ' here' };
  if (config[key] === false) return { cls: 'is-off', text: 'Off in settings' };
  const overrides = siteOverridesFor(host);
  if (overrides && overrides[key] === false) {
    return { cls: 'is-off', text: SITE_OVERRIDE_MIXED.has(key) ? 'Page part off on this site' : 'Off on this site' };
  }
  if (SITE_DASH_YT_PAUSED.has(key) && siteDashIsYouTube(host)) return { cls: 'is-paused', text: 'Paused here so videos play' };
  if (SITE_DASH_EDU_PAUSED.has(key) && siteDashIsEducation(host)) {
    return { cls: 'is-paused', text: (SITE_DASH_EDU_PARTLY.has(key) ? 'Partly paused' : 'Paused') + ' here so sign-in and classes work' };
  }
  return { cls: '', text: 'On' };
}

/* Why a page's count is lower than what was actually kept off it, when that is known. */
function siteDashCountNotes(summary) {
  const notes = [];
  if (siteDashIsBrave) {
    notes.push('Brave Shields may stop ads or trackers before WardenOne sees them. Its own counts are in the Shields panel.');
  }
  return notes;
}

// A no-break space keeps a number on the same line as the thing it counts.
function siteDashCount(n, cat) {
  return n === 1 ? cat.a : fmtCount(n) + ' ' + cat.many;
}

/* Layout A's detail line: the total, then the three biggest kinds -- or, for one kind, just that. */
function siteDashDetailLine(summary, state) {
  if (state.cls) return state.line;
  if (!summary.total) {
    if (siteDashIsBrave) return 'No WardenOne actions recorded · Brave Shields may block first';
    return 'No WardenOne actions recorded';
  }
  const kinds = SITE_DASH_CATEGORIES.filter((c) => summary.cats[c.id] > 0)
    .sort((a, b) => summary.cats[b.id] - summary.cats[a.id]);
  if (kinds.length === 1) return 'Stopped ' + siteDashCount(summary.cats[kinds[0].id], kinds[0]);
  // In a list, digits scan better than words: "5 trackers, 1 ad", not "5 trackers, an ad".
  const named = kinds.slice(0, 3).map((c) => {
    const n = summary.cats[c.id];
    return fmtCount(n) + ' ' + (n === 1 ? c.a.replace(/^(?:an?|one) /, '') : c.many);
  });
  const rest = kinds.slice(3).reduce((sum, c) => sum + summary.cats[c.id], 0);
  if (rest) named.push(fmtCount(rest) + ' more');
  return fmtCount(summary.total) + ' actions · ' + named.join(', ');
}

function siteDashTime(at) {
  try { return new Date(Number(at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return ''; }
}

function siteDashEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function paintSiteCard(summary) {
  const section = $('site-card');
  if (!section) return;
  /* A layout chosen while the card is on screen is applied with the card hidden for a moment,
     as on first paint. Edge 153 could keep the fold toggle styled for the old layout, 7px out
     of place, when the attribute changed on a card that was already visible. */
  if (section.dataset.layout !== siteCardLayout) {
    if (!section.hidden) { section.hidden = true; void section.offsetHeight; }
    section.dataset.layout = siteCardLayout;
  }
  section.hidden = false;
  const button = $('site-card-open');
  const host = $('site-card-host');
  const status = $('site-card-state');
  const stats = $('site-card-stats');
  const caption = $('site-card-caption');
  const icon = $('site-card-ico');
  const detail = $('site-card-detail');
  const layoutA = siteCardLayout === 'A';
  /* A's one detail line takes what B puts in its caption. */
  const say = (text) => {
    if (layoutA) {
      detail.textContent = text || '';
      caption.hidden = true;
      return;
    }
    caption.hidden = !text;
    caption.textContent = text || '';
  };
  const setStat = (id, n) => {
    const el = $(id);
    el.textContent = fmtCount(n);
    el.parentElement.classList.toggle('is-zero', !n);
  };
  if (!summary || summary.error || !summary.web) {
    const failed = !summary || summary.error;
    host.textContent = failed ? 'This site' : (summary.host ? 'Browser page' : 'No website open');
    host.title = '';
    status.className = 'site-card-status is-idle';
    status.textContent = failed ? 'Unknown' : 'Not a website';
    icon.className = 'site-card-ico is-idle';
    stats.hidden = true;
    say(failed ? 'Couldn’t read this page’s activity.' : 'WardenOne works on websites, not browser pages.');
    button.disabled = true;
    return;
  }
  const state = siteDashState(summary.host);
  host.textContent = summary.host;
  host.title = summary.host;
  status.className = 'site-card-status' + (state.cls ? ' ' + state.cls : '');
  status.textContent = state.text;
  icon.className = 'site-card-ico' + (state.cls ? ' ' + state.cls : '');
  button.disabled = false;
  if (layoutA) {
    stats.hidden = true;
    say(siteDashDetailLine(summary, state));
    button.setAttribute('aria-label', summary.host + ', ' + state.text + '. ' + detail.textContent + '. View site activity');
    return;
  }
  stats.hidden = false;
  /* Trackers and ads are the two everyone looks for; everything else WardenOne stopped here --
     pop-ups, cleaned links, overlays, threats, sensitive requests -- is Other, and the dashboard
     breaks it down. */
  const trackers = summary.cats.trackers || 0;
  const ads = summary.cats.ads || 0;
  const other = Math.max(0, summary.total - trackers - ads);
  setStat('site-stat-trackers', trackers);
  setStat('site-stat-ads', ads);
  setStat('site-stat-other', other);
  let note = '';
  if (state.cls) note = state.line;
  else if (siteDashIsBrave && !summary.total) note = 'Brave Shields may have blocked things before WardenOne saw them.';
  say(note);
  button.disabled = false;
  button.setAttribute('aria-label', summary.host + ', ' + state.text + ': ' + trackers + ' trackers, ' + ads + ' ads, '
    + other + ' other stopped on this page. View site activity');
}

function renderSiteDashboard(summary) {
  if (!summary || summary.error || !summary.web) return;
  const host = summary.host;
  const state = siteDashState(host);
  $('site-dash-host').textContent = host;
  $('site-dash-host').title = host;
  const stateEl = $('site-dash-state');
  stateEl.className = 'site-state' + (state.cls ? ' ' + state.cls : '');
  stateEl.textContent = state.text;
  $('site-dash-since').textContent = state.line
    || (summary.since ? 'Counting since this tab loaded the site at ' + siteDashTime(summary.since) : 'The last ten minutes on this site');
  $('site-dash-total').textContent = fmtCount(summary.total);
  $('site-dash-label').textContent = summary.total ? 'WardenOne actions on this page' : 'no WardenOne actions recorded';

  const note = $('site-dash-note');
  const net = summary.net || {};
  const notes = [];
  if (!net.available) {
    notes.push(net.reason === 'busy'
      ? 'Chrome limits how often extensions can read network blocks, so request counts are missing for a minute. Page actions are still counted.'
      : 'This browser doesn’t report network blocks to extensions, so only page actions are counted.');
  }
  if (!summary.total) notes.push('A zero means WardenOne recorded no block or page action on this load; it does not say the page had nothing to block.');
  notes.push(...siteDashCountNotes(summary));
  note.hidden = !notes.length;
  note.textContent = notes.join(' ');

  const cats = $('site-dash-cats');
  cats.textContent = '';
  SITE_DASH_CATEGORIES.forEach((c) => {
    const n = summary.cats[c.id] || 0;
    if (!n) return;
    const line = siteDashEl('div', 'site-dash-line');
    line.appendChild(siteDashEl('span', '', c.label));
    line.appendChild(siteDashEl('b', '', fmtCount(n)));
    cats.appendChild(line);
  });
  if (summary.noticed) {
    const line = siteDashEl('div', 'site-dash-line');
    line.appendChild(siteDashEl('span', '', 'Warnings and things noticed'));
    line.appendChild(siteDashEl('b', '', fmtCount(summary.noticed)));
    cats.appendChild(line);
  }
  $('site-dash-cats-title').hidden = !cats.children.length;
  cats.hidden = !cats.children.length;

  renderSiteDashSources(summary);
  renderSiteDashTimeline(summary);
  renderSiteDashRecent(summary);
  renderSiteDashChecks(summary, state);

  const listed = (config.allowlist || []).includes(host);
  const allow = $('site-dash-allowlist');
  if (allow) allow.textContent = listed ? 'Take off' : 'Allowlist';
  const allowDesc = $('site-dash-allowlist-desc');
  if (allowDesc) {
    allowDesc.textContent = listed
      ? 'WardenOne is passive on ' + host + '. Take it off the list to protect this site again.'
      : 'WardenOne stays passive here until you take it off the list. For a site you trust completely.';
  }

  const prot = $('site-dash-protections');
  prot.textContent = '';
  SITE_DASH_PROTECTIONS.forEach((p) => {
    const s = siteDashProtectionState(p.key, host, state);
    const row = siteDashEl('div', 'site-dash-check' + (s.cls ? ' ' + s.cls : ''));
    row.appendChild(siteDashEl('i', '', s.cls ? '–' : '✓'));
    const text = siteDashEl('span', '', p.label);
    text.appendChild(siteDashEl('small', '', s.text));
    row.appendChild(text);
    prot.appendChild(row);
  });

  const foot = $('site-dash-foot');
  const retained = summary.retained;
  foot.textContent = 'Counts WardenOne’s matched blocking rules and logged page actions. Exact request addresses are not available from the browser’s matched-rule count. '
    + 'Hidden page elements and Twitch’s in-player ad handling aren’t counted.'
    + (retained && retained.total ? ' ' + fmtCount(retained.total) + ' event' + (retained.total === 1 ? '' : 's') + ' logged on ' + host + ' in the last 30 days.' : '');
}

function renderSiteDashSources(summary) {
  const box = $('site-dash-sources');
  const title = $('site-dash-sources-title');
  box.textContent = '';
  const sources = summary.net && summary.net.available && Array.isArray(summary.net.sources) ? summary.net.sources : [];
  title.hidden = !sources.length;
  box.hidden = !sources.length;
  if (!sources.length) return;
  sources.forEach((source) => {
    const row = siteDashEl('div', 'site-dash-line');
    row.appendChild(siteDashEl('span', '', source.name));
    row.appendChild(siteDashEl('b', '', fmtCount(source.count)));
    box.appendChild(row);
  });
  box.appendChild(siteDashEl('div', 'site-dash-source-note', 'Shows which WardenOne lists or rules matched, not the request addresses.'));
}

function renderSiteDashTimeline(summary) {
  const box = $('site-dash-timeline');
  box.textContent = '';
  const items = summary.events.map((e) => {
    const d = e.detail || {};
    let base = SITE_DASH_EVENT_LABELS[e.type];
    /* A warning or an observation is never given a category name like "Tracker or beacon
       blocked": that would claim a block that did not happen. */
    if (!base && e.kind === 'noticed') {
      base = 'Noticed: ' + String(e.type || '').replace(/^(warned|detected|proposed|learned|gated)_/, '').replace(/_/g, ' ');
    }
    if (!base && typeof wardenNotificationRuleForType === 'function' && typeof wardenNotificationDefinition === 'function') {
      base = wardenNotificationDefinition(wardenNotificationRuleForType(e.type)).label;
    }
    let sub = '';
    if (Array.isArray(d.params) && d.params.length) sub = d.params.join(', ');
    else if (d.host && d.host !== summary.host) sub = d.host;
    return { at: e.at, text: base || e.type, sub };
  });
  /* Routine actions from the site tally: one line each, with how many times, at the latest. */
  (summary.tallies || []).forEach((t) => {
    if (!wardenSiteDashEventKind(t.type)) return;
    const sub = t.type === 'youtube_ads_removed' ? fmtCount(t.n) + (t.n === 1 ? ' ad break' : ' ad breaks')
      : t.n > 1 ? fmtCount(t.n) + ' times on this page' : '';
    items.push({ at: t.last, text: SITE_DASH_EVENT_LABELS[t.type] || t.type, sub });
  });
  items.sort((a, b) => Number(b.at) - Number(a.at));
  if (!items.length) {
    box.appendChild(siteDashEl('div', 'site-dash-empty', 'No page actions or notices recorded on this load.'));
    return;
  }
  const shown = siteDashTimelineOpen ? items : items.slice(0, 8);
  shown.forEach((item) => {
    const row = siteDashEl('div', 'site-dash-event');
    const time = siteDashEl('time', '', siteDashTime(item.at));
    try { time.dateTime = new Date(Number(item.at)).toISOString(); } catch (_) {}
    row.appendChild(time);
    const text = siteDashEl('span', '', item.text);
    if (item.sub) text.appendChild(siteDashEl('small', '', item.sub));
    row.appendChild(text);
    box.appendChild(row);
  });
  if (items.length > 8) {
    const toggle = siteDashEl('button', 'site-dash-more', siteDashTimelineOpen ? 'Show less' : 'Show all ' + items.length);
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      siteDashTimelineOpen = !siteDashTimelineOpen;
      renderSiteDashTimeline(summary);
    });
    box.appendChild(toggle);
  }
}

/* A zero is only shown as "checked" when the protection behind it ran on this page; a check that
   did not run says so instead of passing quietly. And nothing here ever says "safe". */
/* The site over the past 24 hours and 7 days, by kind. Network blocks arrive as "net:<kind>"
   from the site tally; everything else is an event type, sorted the same way the page is. */
function renderSiteDashRecent(summary) {
  const box = $('site-dash-recent');
  if (!box) return;
  box.textContent = '';
  const bucket = (counts) => {
    const out = {};
    for (const key of Object.keys(counts || {})) {
      const kind = key.indexOf('net:') === 0 ? key.slice(4) : wardenSiteDashEventKind(key);
      if (!kind) continue;
      out[kind] = (out[kind] || 0) + (Number(counts[key]) || 0);
    }
    return out;
  };
  const day = bucket(summary.recent && summary.recent.day);
  const week = bucket(summary.recent && summary.recent.week);
  const kinds = SITE_DASH_CATEGORIES.filter((c) => week[c.id] > 0);
  if (week.noticed > 0) kinds.push({ id: 'noticed', label: 'Warnings and things noticed' });
  if (!kinds.length) {
    box.appendChild(siteDashEl('div', 'site-dash-empty', 'Nothing recorded on this site in the past week.'));
  } else {
    const head = siteDashEl('div', 'site-dash-recent-row is-head');
    head.appendChild(siteDashEl('span', '', 'Activity'));
    head.appendChild(siteDashEl('span', '', '24 hours'));
    head.appendChild(siteDashEl('span', '', '7 days'));
    box.appendChild(head);
    kinds.forEach((c) => {
      const row = siteDashEl('div', 'site-dash-recent-row');
      row.appendChild(siteDashEl('span', '', c.label));
      const d = day[c.id] || 0;
      row.appendChild(siteDashEl('b', d ? '' : 'is-zero', fmtCount(d)));
      row.appendChild(siteDashEl('b', '', fmtCount(week[c.id] || 0)));
      box.appendChild(row);
    });
  }
  box.appendChild(siteDashEl('div', 'site-dash-note', 'Counted while WardenOne was running. Chrome keeps a closed page’s network blocks for only a few minutes, so one left behind while the browser sat idle can be missed.'));
}

function renderSiteDashChecks(summary, state) {
  const box = $('site-dash-clear');
  box.textContent = '';
  const host = summary.host;
  const seen = (re) => Object.keys(summary.typeCounts || {}).some((t) => re.test(t));
  const netOk = !!(summary.net && summary.net.available);
  const checks = [
    { key: 'blockMalwareSites', needsNet: true, hit: summary.cats.security > 0, text: 'Threat blocklists recorded no match' },
    { key: 'detectPhishing', hit: seen(/phish|techsupport|clickfix|command_paste|fake_update|fake_window|fullscreen_spoof|form_trap/), text: 'No phishing or scam warning recorded' },
    { key: 'blockTokenExfil', hit: seen(/token_exfil|skimmer|honeytoken|paste_protection/), text: 'No sensitive-request alert recorded' },
    { key: 'blockForcedPopups', hit: summary.cats.popups > 0, text: 'No pop-up or redirect block recorded' },
    { key: 'blockTrackers', needsNet: true, hit: summary.cats.trackers > 0, text: 'Tracker blocker recorded no match' },
  ];
  let shown = 0;
  checks.forEach((c) => {
    if (c.hit) return;
    const s = siteDashProtectionState(c.key, host, state);
    if (!s.cls && c.needsNet && !netOk) return;
    const row = siteDashEl('div', 'site-dash-check' + (s.cls ? ' ' + s.cls : ''));
    if (s.cls) {
      row.appendChild(siteDashEl('i', '', '–'));
      const text = siteDashEl('span', '', 'Not checked here');
      text.appendChild(siteDashEl('small', '', siteDashProtectionName(c.key) + ': ' + s.text.toLowerCase()));
      row.appendChild(text);
    } else {
      row.appendChild(siteDashEl('i', 'is-neutral', '–'));
      const text = siteDashEl('span', '', c.text);
      if (c.sub) text.appendChild(siteDashEl('small', '', c.sub));
      row.appendChild(text);
    }
    box.appendChild(row);
    shown++;
  });
  if (!shown) box.appendChild(siteDashEl('div', 'site-dash-empty', 'Every check here had something to act on. It’s all listed above.'));
  box.appendChild(siteDashEl('div', 'site-dash-note', 'Nothing found means these checks didn’t trigger on this page. It doesn’t mean the site is safe.'));
}

function siteDashProtectionName(key) {
  const p = SITE_DASH_PROTECTIONS.find((item) => item.key === key);
  return p ? p.label : protectionLabel(key);
}

function refreshSiteDashboard() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    void chrome.runtime.lastError;
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') { siteDashLast = { error: true }; paintSiteCard(siteDashLast); return; }
    chrome.runtime.sendMessage({ kind: 'site-dashboard', tabId: tab.id }, (res) => {
      void chrome.runtime.lastError;
      siteDashLast = res && res.ok ? siteDashSummarize(res) : { error: true };
      paintSiteCard(siteDashLast);
      const view = $('site-dash');
      if (view && !view.hidden) renderSiteDashboard(siteDashLast);
    });
  });
}

/* New log entries and settings changes repaint, at most once a second: a busy page can log many
   events in a burst, and the worker caches Chrome's network count for fifteen seconds anyway. */
function scheduleSiteDashRefresh() {
  if (siteDashRefreshTimer) return;
  siteDashRefreshTimer = setTimeout(() => { siteDashRefreshTimer = 0; refreshSiteDashboard(); }, 1000);
}

function openSiteDashboard() {
  if (!siteDashLast || siteDashLast.error || !siteDashLast.web) return;
  siteDashScrollY = window.scrollY || 0;
  siteDashTimelineOpen = false;
  renderSiteDashboard(siteDashLast);
  $('site-dash').hidden = false;
  document.body.classList.add('wo-site-view');
  window.scrollTo(0, 0);
  const back = $('site-dash-back');
  if (back) back.focus();
  refreshSiteDashboard();
}

function closeSiteDashboard() {
  const view = $('site-dash');
  if (!view || view.hidden) return;
  document.body.classList.remove('wo-site-view');
  view.hidden = true;
  window.scrollTo(0, siteDashScrollY);
  const card = $('site-card-open');
  if (card) card.focus();
}

function wireSiteDashboard() {
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      navigator.brave.isBrave().then((isBrave) => {
        siteDashIsBrave = isBrave === true;
        if (siteDashLast) {
          paintSiteCard(siteDashLast);
          const view = $('site-dash');
          if (view && !view.hidden) renderSiteDashboard(siteDashLast);
        }
      }, () => {});
    }
  } catch (_) {}
  const card = $('site-card-open');
  if (card) card.addEventListener('click', openSiteDashboard);
  const back = $('site-dash-back');
  if (back) back.addEventListener('click', closeSiteDashboard);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('wo-site-view')) {
      e.preventDefault();
      closeSiteDashboard();
    }
  });
  const activity = $('site-dash-activity');
  if (activity) activity.addEventListener('click', () => {
    const host = siteDashLast && siteDashLast.host;
    try { chrome.tabs.create({ url: chrome.runtime.getURL('history.html') + (host ? '#site=' + encodeURIComponent(host) : '') }); } catch (_) {}
  });
  const logger = $('site-dash-logger');
  if (logger) logger.addEventListener('click', () => {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('logger.html') }); } catch (_) {}
  });
  const allow = $('site-dash-allowlist');
  if (allow) allow.addEventListener('click', allowlistCurrent);
  /* Interface > Site card: two buttons choose the card's layout, kept on its own key. The card
     stays hidden until the first summary arrives, which is after this read in practice, so it
     does not flash the other layout first. */
  const layoutButtons = Array.from(document.querySelectorAll('[data-site-card-layout]'));
  const useLayout = (layout) => {
    siteCardLayout = layout === 'B' ? 'B' : 'A';
    layoutButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.siteCardLayout === siteCardLayout)));
    if (siteDashLast) paintSiteCard(siteDashLast);
  };
  layoutButtons.forEach((b) => b.addEventListener('click', () => {
    useLayout(b.dataset.siteCardLayout);
    try { chrome.storage.local.set({ [SITE_CARD_LAYOUT_KEY]: siteCardLayout }); } catch (_) {}
  }));
  const fold = $('site-card-fold');
  const useFold = (folded) => {
    const on = folded === true;
    const section = $('site-card');
    if (section) section.classList.toggle('is-folded', on);
    if (!fold) return;
    fold.setAttribute('aria-expanded', String(!on));
    fold.setAttribute('aria-label', on ? 'Show the whole site card' : 'Minimise the site card');
    fold.title = on ? 'Show more' : 'Minimise';
  };
  if (fold) fold.addEventListener('click', () => {
    const next = !$('site-card').classList.contains('is-folded');
    useFold(next);
    try { chrome.storage.local.set({ [SITE_CARD_FOLD_KEY]: next }); } catch (_) {}
  });
  try {
    chrome.storage.local.get([SITE_CARD_LAYOUT_KEY, SITE_CARD_FOLD_KEY], (stored) => {
      void chrome.runtime.lastError;
      useLayout(stored && stored[SITE_CARD_LAYOUT_KEY]);
      useFold(stored && stored[SITE_CARD_FOLD_KEY]);
    });
  } catch (_) {}
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.wardenone_config || changes.wardenone_history)) scheduleSiteDashRefresh();
    if (area === 'local' && changes[SITE_CARD_LAYOUT_KEY]) useLayout(changes[SITE_CARD_LAYOUT_KEY].newValue);
    if (area === 'local' && changes[SITE_CARD_FOLD_KEY]) useFold(changes[SITE_CARD_FOLD_KEY].newValue);
  });
}

// The first read happens in load(), once the config it describes has arrived.
document.addEventListener('DOMContentLoaded', wireSiteDashboard, { once: true });

// ----- Section order -----
/* The reader decides the order of the popup's sections. A section is a run of #groups'
   children: its heading and everything up to the next heading.
   Runs move whole and stay flat, never wrapped, because the search hides a heading by
   looking at the sibling right before each card group. Only placement is stored; no
   switch changes when a section moves. */
const POPUP_SECTION_ORDER_KEY = 'wardenone_popup_section_order';
/* A saved order names sections by these ids, not by what the heading says, so a heading the
   Store build relabels (Memory Shield shows as Resource Saver there) keeps its place. A heading
   that is not listed still works under an id made from its text; renaming one only sends that
   section back to its default place. */
const POPUP_SECTION_IDS = {
  'script shield': 'script-shield', 'redirects & popups': 'redirects', 'ip protection': 'ip-protection',
  'download shield': 'downloads', 'privacy': 'privacy', 'adshield': 'adshield', 'memory shield': 'memory',
  'resource saver': 'memory', 'forget me & logins': 'forget-me', 'media shield': 'media', 'adult-site safety': 'adult',
  'advanced detection (catches rotating/custom domains)': 'advanced-detection',
  'sessionshield \u2014 login & session protection': 'sessionshield', 'blocklist (auto-updating)': 'blocklist',
  'eyeshield': 'eyeshield', 'what wardenone watches': 'watches', 'interface': 'interface',
  'settings backup': 'backup', 'privacy cleaner': 'cleaner'
};
function popupSectionId(heading) {
  const text = (heading.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return POPUP_SECTION_IDS[text] || text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function popupSectionRuns() {
  const box = $('groups');
  if (!box) return [];
  const runs = [];
  let run = null;
  Array.from(box.childNodes).forEach((node) => {
    if (node.nodeType === 1 && node.tagName === 'H2' && popupSectionId(node)) {
      run = { id: popupSectionId(node), heading: node, nodes: [node] };
      runs.push(run);
    } else if (run) {
      run.nodes.push(node);
    }
  });
  return runs;
}

const POPUP_SECTION_DEFAULT = popupSectionRuns().map((run) => run.id);

/* A saved order may predate a section (an update added one) or name one this build
   leaves out. Unknown ids are dropped, and a section the order does not mention goes
   back beside the section it follows by default. */
function resolvePopupSectionOrder(saved, present, defaults) {
  const known = new Set(present);
  const order = [];
  (Array.isArray(saved) ? saved : []).forEach((id) => {
    if (typeof id === 'string' && known.has(id) && order.indexOf(id) === -1) order.push(id);
  });
  const base = defaults.filter((id) => known.has(id)).concat(present.filter((id) => defaults.indexOf(id) === -1));
  base.forEach((id, i) => {
    if (order.indexOf(id) !== -1) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(base[j]);
      if (k !== -1) { at = k + 1; break; }
    }
    order.splice(at, 0, id);
  });
  return order;
}

function applyPopupSectionOrder(saved) {
  const box = $('groups');
  const runs = popupSectionRuns();
  if (!box || !runs.length) return [];
  const byId = new Map(runs.map((run) => [run.id, run]));
  const order = resolvePopupSectionOrder(saved, runs.map((run) => run.id), POPUP_SECTION_DEFAULT);
  const current = runs.map((run) => run.id);
  if (order.every((id, i) => id === current[i])) return order;
  const frag = document.createDocumentFragment();
  order.forEach((id) => byId.get(id).nodes.forEach((node) => frag.appendChild(node)));
  box.appendChild(frag);
  return order;
}

function savePopupSectionOrder(order) {
  const isDefault = order.length === POPUP_SECTION_DEFAULT.length && order.every((id, i) => id === POPUP_SECTION_DEFAULT[i]);
  try {
    if (isDefault) chrome.storage.local.remove(POPUP_SECTION_ORDER_KEY);
    else chrome.storage.local.set({ [POPUP_SECTION_ORDER_KEY]: order });
  } catch (_) {}
}

const ARRANGE_SVG = {
  grip: [['circle', { cx: 9, cy: 6.5, r: 1.5 }], ['circle', { cx: 15, cy: 6.5, r: 1.5 }], ['circle', { cx: 9, cy: 12, r: 1.5 }],
    ['circle', { cx: 15, cy: 12, r: 1.5 }], ['circle', { cx: 9, cy: 17.5, r: 1.5 }], ['circle', { cx: 15, cy: 17.5, r: 1.5 }]],
  up: [['path', { d: 'm6 14.5 6-6 6 6' }]],
  down: [['path', { d: 'm6 9.5 6 6 6-6' }]]
};
function arrangeIcon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const filled = name === 'grip';
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  if (!filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  ARRANGE_SVG[name].forEach(([tag, attrs]) => {
    const el = document.createElementNS(ns, tag);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, String(attrs[k])));
    svg.appendChild(el);
  });
  return svg;
}

function popupSectionTitle(run) {
  return (run.heading.textContent || run.id).replace(/\s+/g, ' ').trim();
}

let arrangeScrollY = 0;
function renderArrangeList(focus) {
  const list = $('arrange-list');
  if (!list) return;
  const runs = popupSectionRuns();
  list.textContent = '';
  runs.forEach((run, i) => {
    const title = popupSectionTitle(run);
    const li = document.createElement('li');
    li.className = 'arrange-item';
    li.dataset.id = run.id;
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'arrange-grip';
    grip.setAttribute('aria-label', 'Move ' + title + '. Drag, or press the up and down arrow keys.');
    grip.appendChild(arrangeIcon('grip'));
    const num = document.createElement('span');
    num.className = 'arrange-num';
    num.textContent = String(i + 1);
    num.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'arrange-name';
    name.textContent = title;
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'arrange-move';
    up.dataset.dir = '-1';
    up.disabled = i === 0;
    up.setAttribute('aria-label', 'Move ' + title + ' up');
    up.appendChild(arrangeIcon('up'));
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'arrange-move';
    down.dataset.dir = '1';
    down.disabled = i === runs.length - 1;
    down.setAttribute('aria-label', 'Move ' + title + ' down');
    down.appendChild(arrangeIcon('down'));
    li.append(grip, num, name, up, down);
    list.appendChild(li);
  });
  if (focus && focus.id) {
    const item = list.querySelector('.arrange-item[data-id="' + focus.id + '"]');
    if (item) {
      let target = item.querySelector(focus.what === 'grip' ? '.arrange-grip' : '.arrange-move[data-dir="' + focus.what + '"]');
      if (target && target.disabled) target = item.querySelector('.arrange-move:not(:disabled)') || item.querySelector('.arrange-grip');
      if (target) target.focus();
      if (focus.flash) {
        item.classList.add('is-dropped');
        setTimeout(() => item.classList.remove('is-dropped'), 650);
      }
    }
  }
}

function arrangeStatus(text) {
  const el = $('arrange-status');
  if (el) el.textContent = text;
}

function commitArrangeOrder(order, movedId, focusWhat) {
  const applied = applyPopupSectionOrder(order);
  savePopupSectionOrder(applied);
  renderArrangeList({ id: movedId, what: focusWhat, flash: true });
  const run = popupSectionRuns().find((r) => r.id === movedId);
  if (run) arrangeStatus(popupSectionTitle(run) + ' is now ' + (applied.indexOf(movedId) + 1) + ' of ' + applied.length + '.');
}

function moveArrangeSection(id, delta, focusWhat) {
  const order = popupSectionRuns().map((run) => run.id);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= order.length) return;
  order.splice(to, 0, order.splice(from, 1)[0]);
  commitArrangeOrder(order, id, focusWhat);
}

function openArrangeView() {
  const view = $('arrange-view');
  if (!view) return;
  if (document.body.classList.contains('wo-site-view') && typeof closeSiteDashboard === 'function') closeSiteDashboard();
  arrangeScrollY = window.scrollY || 0;
  arrangeStatus('');
  renderArrangeList();
  view.hidden = false;
  document.body.classList.add('wo-arrange-view');
  window.scrollTo(0, 0);
  const back = $('arrange-back');
  if (back) back.focus();
}

function closeArrangeView() {
  const view = $('arrange-view');
  if (!view || view.hidden) return;
  document.body.classList.remove('wo-arrange-view');
  view.hidden = true;
  window.scrollTo(0, arrangeScrollY);
  const entry = $('arrange-open');
  if (entry) entry.focus({ preventScroll: true });
}

/* Touch rows keep native scrolling until the hold completes; the dots still drag immediately. */
let arrangeDrag = null;
function wireArrangeDrag(list) {
  const holdMs = 120;
  const start = (item, source, options) => {
    const d = { item, source, ...options, active: false, moved: false, timer: null };
    arrangeDrag = d;
    if (source === 'touch') d.timer = setTimeout(() => activate(d), holdMs);
    return d;
  };
  const activate = (d) => {
    if (arrangeDrag !== d || d.active) return;
    d.active = true;
    d.timer = null;
    d.item.classList.add('is-dragging');
    document.body.classList.add('wo-arranging');
  };
  const clear = (d) => {
    clearTimeout(d.timer);
    arrangeDrag = null;
    document.body.classList.remove('wo-arranging');
    d.item.classList.remove('is-dragging');
    if (d.source === 'pointer') {
      try { (d.grip || d.item).releasePointerCapture(d.pointer); } catch (_) {}
    }
  };
  const move = (d, x, y) => {
    d.moved = true;
    /* The popup is shorter than the list, so dragging near its top or bottom edge scrolls it. */
    if (y < 48) window.scrollBy(0, -14);
    else if (y > window.innerHeight - 48) window.scrollBy(0, 14);
    const hit = document.elementFromPoint(x, y);
    const over = hit && hit.closest('.arrange-item');
    if (!over || over.parentElement !== list) {
      /* Past either end of the list (a quick flick overshoots it): first or last place. */
      const items = list.querySelectorAll('.arrange-item');
      const first = items[0], last = items[items.length - 1];
      if (first && first !== d.item && y < first.getBoundingClientRect().top) list.insertBefore(d.item, first);
      else if (last && last !== d.item && y > last.getBoundingClientRect().bottom) list.appendChild(d.item);
      return;
    }
    if (over === d.item) return;
    const box = over.getBoundingClientRect();
    list.insertBefore(d.item, y > box.top + box.height / 2 ? over.nextSibling : over);
  };
  const finish = (d, cancelled) => {
    clear(d);
    if (cancelled) { if (d.moved) renderArrangeList(); return; }
    if (!d.moved) return;
    const order = Array.from(list.querySelectorAll('.arrange-item')).map((li) => li.dataset.id);
    if (order.every((id, i) => id === popupSectionRuns()[i].id)) return;
    commitArrangeOrder(order, d.item.dataset.id, 'grip');
  };
  list.addEventListener('pointerdown', (e) => {
    if (arrangeDrag || e.button !== 0) return;
    const grip = e.target.closest('.arrange-grip');
    const item = e.target.closest('.arrange-item');
    if (!item || item.parentElement !== list || e.target.closest('.arrange-move')) return;
    if (e.pointerType === 'touch' && !grip) return;
    if (grip) e.preventDefault();
    start(item, 'pointer', { grip, pointer: e.pointerId, x: e.clientX, y: e.clientY });
    try { (grip || item).setPointerCapture(e.pointerId); } catch (_) {}
  });
  /* Moving the dragged row out and back into the list drops its pointer capture, so the rest of
     the drag is heard on the document: the pointer may be over the header when it lets go. */
  document.addEventListener('pointermove', (e) => {
    const d = arrangeDrag;
    if (!d || d.source !== 'pointer' || e.pointerId !== d.pointer) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      activate(d);
    }
    move(d, e.clientX, e.clientY);
  });
  const end = (e) => {
    const d = arrangeDrag;
    if (!d || d.source !== 'pointer' || e.pointerId !== d.pointer) return;
    finish(d, e.type === 'pointercancel');
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  list.addEventListener('touchstart', (e) => {
    if (arrangeDrag || e.touches.length !== 1) return;
    const item = e.target.closest('.arrange-item');
    if (!item || item.parentElement !== list || e.target.closest('.arrange-move, .arrange-grip')) return;
    const touch = e.changedTouches[0];
    start(item, 'touch', { touch: touch.identifier, x: touch.clientX, y: touch.clientY });
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const d = arrangeDrag;
    if (!d || d.source !== 'touch') return;
    if (e.touches.length !== 1) { finish(d, true); return; }
    const touch = Array.from(e.changedTouches).find((t) => t.identifier === d.touch);
    if (!touch) return;
    if (!d.active) {
      if (Math.hypot(touch.clientX - d.x, touch.clientY - d.y) > 12) clear(d);
      return;
    }
    e.preventDefault();
    move(d, touch.clientX, touch.clientY);
  }, { passive: false });
  const touchEnd = (e) => {
    const d = arrangeDrag;
    if (!d || d.source !== 'touch' || !Array.from(e.changedTouches).some((t) => t.identifier === d.touch)) return;
    if (d.active) e.preventDefault();
    finish(d, e.type === 'touchcancel');
  };
  document.addEventListener('touchend', touchEnd, { passive: false });
  document.addEventListener('touchcancel', touchEnd, { passive: false });
  list.addEventListener('contextmenu', (e) => {
    if (arrangeDrag && arrangeDrag.active && e.target.closest('.arrange-item') === arrangeDrag.item) e.preventDefault();
  });
}

(function initPopupSectionOrder() {
  const box = $('groups');
  if (!box || !POPUP_SECTION_DEFAULT.length) return;
  /* Storage can answer after the popup is already being measured. Keep the controls usable while
     the saved order arrives; a brief default-order paint is safer than an invisible popup. */
  try {
    chrome.storage.local.get(POPUP_SECTION_ORDER_KEY, (res) => {
      try {
        const saved = res && res[POPUP_SECTION_ORDER_KEY];
        if (Array.isArray(saved) && saved.length) applyPopupSectionOrder(saved);
      } catch (_) {}
    });
  } catch (_) {}

  /* Settings opens the Settings page, which is also the browser's "Extension options" page, so the
     browser reuses a Settings tab that is already open rather than opening a second. */
  const settingsBtn = $('open-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', () => {
    try {
      chrome.runtime.openOptionsPage(() => { void chrome.runtime.lastError; window.close(); });
    } catch (_) {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      window.close();
    }
  });
  ['arrange-open', 'arrange-open-interface'].forEach((id) => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', openArrangeView);
  });
  const back = $('arrange-back');
  if (back) back.addEventListener('click', closeArrangeView);
  const done = $('arrange-done');
  if (done) done.addEventListener('click', closeArrangeView);
  const reset = $('arrange-reset');
  if (reset) reset.addEventListener('click', () => {
    applyPopupSectionOrder(POPUP_SECTION_DEFAULT);
    savePopupSectionOrder(POPUP_SECTION_DEFAULT);
    renderArrangeList();
    arrangeStatus('Back to the original order.');
  });
  const list = $('arrange-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.arrange-move');
      if (!btn || btn.disabled) return;
      const item = btn.closest('.arrange-item');
      moveArrangeSection(item.dataset.id, Number(btn.dataset.dir), btn.dataset.dir);
    });
    list.addEventListener('keydown', (e) => {
      const grip = e.target.closest('.arrange-grip');
      if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      moveArrangeSection(grip.closest('.arrange-item').dataset.id, e.key === 'ArrowUp' ? -1 : 1, 'grip');
    });
    wireArrangeDrag(list);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('wo-arrange-view')) {
      e.preventDefault();
      closeArrangeView();
    }
  });
})();

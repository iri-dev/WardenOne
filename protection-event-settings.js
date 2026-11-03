/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

var WardenProtectionEvents;
var wardenEventProtectionKeys;
var wardenProtectionEventIds;

(function () {
  if (typeof window === 'object' && window !== window.top && typeof location === 'object'
      && !/-extension:$/.test(location.protocol)) return;
  const entries = Object.create(null);
  const empty = Object.freeze([]);
  const keyEvents = Object.create(null);
  const validId = /^[a-z][a-z0-9_]{0,95}$/;
  const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty);

  function add(ids, keys, pauseKey) {
    const controls = Object.freeze(keys.split(' ').filter(Boolean));
    const pause = pauseKey ? Object.freeze([pauseKey]) : empty;
    for (const id of ids.split(' ')) {
      if (!id || own(entries, id)) throw new Error('Duplicate protection event: ' + id);
      entries[id] = Object.freeze({ keys: controls, pauseKeys: pause });
      for (const key of controls) (keyEvents[key] || (keyEvents[key] = [])).push(id);
    }
  }

  /* Shared event IDs can have several owners. Only reviewed single controls receive a pause action. */
  add('blocked_popup', 'blockForcedPopups strictPopupShield blockPopupTricks detectRedirectChains adShield');
  add('blocked_gestureless_nav', 'blockGesturelessNav blockPopupTricks');
  add('blocked_form_submit', 'blockGesturelessNav');
  add('blocked_forced_redirect blocked_frame_top_redirect blocked_ad_auction_redirect blocked_overlay_ad_frame blocked_confirm_bait warned_confirm_bait', 'blockPopupTricks', 'blockPopupTricks');
  add('blocked_meta_refresh', 'blockMetaRefresh', 'blockMetaRefresh');
  add('blocked_redirect_chain', 'detectRedirectChains', 'detectRedirectChains');
  add('warned_back_trap', 'backTrapGuard', 'backTrapGuard');
  add('blocked_grabber_fetch blocked_grabber_xhr blocked_grabber_beacon blocked_grabber_pixel blocked_grabber_element blocked_grabber_network', 'blockGrabberResources', 'blockGrabberResources');
  add('detected_grabber_domain detected_grabber_image_candidate warned_grabber_image', 'warnGrabberDomains', 'warnGrabberDomains');
  add('blocked_grabber_navigation warned_grabber_protection_unavailable', 'warnGrabberDomains blockMalwareSites');
  add('blocked_ip_lookup', 'blockWebRTCLeak', 'blockWebRTCLeak');
  add('blocked_webrtc_candidate_listener', 'blockSuspiciousWebRTC blockWebRTCLeak', 'blockSuspiciousWebRTC');
  add('blocked_suspicious_webrtc', 'blockSuspiciousWebRTC mediaShield', 'blockSuspiciousWebRTC');
  add('blocked_thirdparty_cookie', 'blockThirdPartyCookies', 'blockThirdPartyCookies');
  add('cookie_blocked', 'blockAllCookies blockThirdPartyCookies');
  add('blocked_storage_access warned_storage_access detected_storage_access', 'storageAccessGuard blockAllStorageAccess', 'storageAccessGuard');
  add('blocked_tracker_request', 'blockFirstPartyTrackers', 'blockFirstPartyTrackers');
  add('detected_thirdparty_tracker detected_beacon', 'logThirdPartyBeacons');
  add('blocked_intranet_probe', 'intranetProtection', 'intranetProtection');
  add('blocked_risky_site_resource', 'riskySiteMode', 'riskySiteMode');
  add('blocked_token_exfil', 'blockTokenExfil', 'blockTokenExfil');
  add('blocked_skimmer_exfil', 'detectSkimmers', 'detectSkimmers');
  add('blocked_payment_card_submit warned_payment_card_entry', 'paymentCardGuard', 'paymentCardGuard');
  add('blocked_safe_browsing_link blocked_safe_browsing_form blocked_safe_browsing_paste warned_url_reputation', 'urlHaus openPhish phishTank whoisXmlReputation whoisXmlThreatIntel');
  add('blocked_safe_browsing_page', 'blockMalwareSites urlHaus openPhish phishTank whoisXmlReputation whoisXmlThreatIntel');
  add('warned_abuseipdb_server', 'abuseIpDb', 'abuseIpDb');
  add('blocked_phishing', 'detectPhishing blockHighConfidencePhishing blockMalwareSites');
  add('warned_phishing', 'detectPhishing', 'detectPhishing');
  add('warned_new_domain_login', 'loginAgeCheck', 'loginAgeCheck');
  add('warned_insecure_login', 'insecureLoginGuard', 'insecureLoginGuard');
  add('warned_shortener', 'warnShorteners', 'warnShorteners');
  add('warned_redirect_param', 'warnRedirectParams', 'warnRedirectParams');
  add('warned_logger_api', 'monitorLoggerApi', 'monitorLoggerApi');
  add('blocked_clipboard_hijack', 'clipboardGuard', 'clipboardGuard');
  add('warned_clipboard_swap', 'clipboardSwapDetect', 'clipboardSwapDetect');
  add('warned_clickfix_clipboard warned_clickfix_correlated warned_clickfix_fake_captcha warned_clickfix_instruction', 'commandPasteGuard pasteProtection');
  add('blocked_command_paste_frame warned_command_paste', 'commandPasteGuard', 'commandPasteGuard');
  add('warned_paste_protection', 'pasteProtection', 'pasteProtection');
  add('warned_techsupport_scam', 'scamLockGuard', 'scamLockGuard');
  add('warned_fake_update', 'fakeUpdateDetector', 'fakeUpdateDetector');
  add('warned_clickjacking', 'antiClickjacking', 'antiClickjacking');
  add('warned_form_trap', 'formTrapDetector', 'formTrapDetector');
  add('warned_honeytoken_read', 'honeytokenMode', 'honeytokenMode');
  add('warned_keystroke_pressure', 'keystrokePressure', 'keystrokePressure');
  add('warned_xss_behavior warned_potential_dom_xss warned_potential_xss_code_execution warned_potential_xss_navigation warned_potential_xss_privileged_action warned_potential_xss_script_injection', 'xssBehaviorGuard', 'xssBehaviorGuard');
  add('blocked_media_capture blocked_speech_capture', 'blockCameraMic mediaShield', 'blockCameraMic');
  add('blocked_screen_capture', 'blockScreenCapture mediaShield', 'blockScreenCapture');
  add('blocked_geolocation', 'blockGeolocation', 'blockGeolocation');
  add('blocked_autoplay_media blocked_hidden_media', 'blockAutoplayMedia mediaShield', 'blockAutoplayMedia');
  add('warned_media_capture warned_speech_capture warned_screen_capture warned_hidden_media_capture warned_hidden_screen_capture', 'mediaShield', 'mediaShield');
  add('warned_fake_window', 'fakeWindowGuard', 'fakeWindowGuard');
  add('warned_fullscreen_spoof blocked_keyboard_lock detected_keyboard_lock blocked_pointer_lock', 'fullscreenGuard', 'fullscreenGuard');
  add('warned_notification_bait warned_notification_scam', 'notificationAbuseGuard', 'notificationAbuseGuard');
  add('warned_device_request warned_device_silent warned_file_request warned_file_silent', 'deviceAccessGuard');
  add('warned_app_install_prompt warned_payment_sheet warned_idle_watch warned_service_worker', 'capabilityGuard');
  add('detected_canvas_fingerprint', 'trackerLearner');
  add('blocked_social_widget', 'socialWidgetGuard', 'socialWidgetGuard');
  add('blocked_sponsored_search_click', 'blockSponsoredSearchResults', 'blockSponsoredSearchResults');
  add('blocked_overlay', 'removeOverlays removeConsentWalls');
  add('detected_download_gate', 'removeOverlays', 'removeOverlays');
  add('blocked_beacon', 'mailTrackingShield', 'mailTrackingShield');
  add('gated_adult_site', 'gateAdultSites adultHeuristics', 'gateAdultSites');
  add('gated_cookies_hardened gated_tokens_cleared', '');
  add('warned_permission_chain', 'permissionChainGuard', 'permissionChainGuard');
  add('warned_oauth_grant', 'oauthGuard', 'oauthGuard');
  add('warned_script_drift', 'scriptDriftGuard', 'scriptDriftGuard');
  add('blocked_certificate', 'certificateGuard');
  add('blocked_http_only', 'forceHttps', 'forceHttps');
  add('blocked_ad_resource', 'adShield');
  add('youtube_ads_removed', 'scriptletEngine', 'scriptletEngine');
  add('scriptlet_mutator_blocked', 'adShield scriptletEngine');
  add('consent_rejected', 'autoRejectConsent', 'autoRejectConsent');
  add('cleaned_history_url', 'stripTrackingParams', 'stripTrackingParams');
  add('stripped_link_ping', 'unshimLinks', 'unshimLinks');
  add('cleaned_copied_link', 'cleanCopyLinks', 'cleanCopyLinks');
  add('google_search_cleanup', 'googleSearchResultCleanup blockSearchAiAnswers blockSponsoredSearchResults');
  add('blocked_config_spoof detected_manual_check', '');

  for (const key of Object.keys(keyEvents)) Object.freeze(keyEvents[key]);
  Object.freeze(keyEvents);
  Object.freeze(entries);
  const ids = Object.freeze(Object.keys(entries).sort());
  const pagePartKeys = Object.freeze(Object.fromEntries([
    'abuseIpDb', 'autoRejectConsent', 'blockGeolocation', 'blockGrabberResources', 'blockPopupTricks',
    'blockSponsoredSearchResults', 'blockWebRTCLeak', 'detectRedirectChains', 'detectSkimmers',
    'forceHttps', 'intranetProtection', 'loginAgeCheck', 'mailTrackingShield', 'oauthGuard',
    'paymentCardGuard', 'permissionChainGuard', 'scriptDriftGuard', 'scriptletEngine',
    'stripTrackingParams', 'unshimLinks', 'warnGrabberDomains',
  ].map(key => [key, true])));
  const labels = Object.freeze({
    "abuseIpDb": "AbuseIPDB",
    "adShield": "AdShield: General sites",
    "adultHeuristics": "Catch unlisted adult sites",
    "antiClickjacking": "Anti-clickjacking checks",
    "autoRejectConsent": "Auto-reject cookie banners",
    "backTrapGuard": "Stop back-button traps",
    "blockAllCookies": "No persistent cookies",
    "blockAllStorageAccess": "Refuse every cross-site cookie request",
    "blockAutoplayMedia": "Block hidden media abuse",
    "blockCameraMic": "Block camera & microphone",
    "blockFirstPartyTrackers": "Block first-party trackers",
    "blockForcedPopups": "Block forced popups",
    "blockGeolocation": "Block location requests",
    "blockGesturelessNav": "Block gestureless redirects",
    "blockGrabberResources": "Block IP-grabber beacons",
    "blockHighConfidencePhishing": "Block high-confidence look-alikes",
    "blockMalwareSites": "Block known malicious sites",
    "blockMetaRefresh": "Block meta-refresh bounces",
    "blockPopupTricks": "Block popup and redirect tricks",
    "blockScreenCapture": "Block screen capture",
    "blockSearchAiAnswers": "Hide search AI answers",
    "blockSponsoredSearchResults": "Hide sponsored search results",
    "blockSuspiciousWebRTC": "Harden WebRTC (may break calls)",
    "blockThirdPartyCookies": "Block third-party cookies",
    "blockTokenExfil": "Protect session tokens",
    "blockWebRTCLeak": "IP lookup blocking",
    "capabilityGuard": "Capability monitoring",
    "certificateGuard": "Block bad certificates",
    "clipboardGuard": "Clipboard hijack protection",
    "clipboardSwapDetect": "Clipboard swap detection",
    "cleanCopyLinks": "Clean links copied inside pages",
    "commandPasteGuard": "Command paste guard",
    "detectPhishing": "Detect fake / phishing sites",
    "detectRedirectChains": "Detect redirect chains",
    "detectSkimmers": "Detect & block form skimmers",
    "deviceAccessGuard": "Device access monitoring",
    "fakeUpdateDetector": "Fake update detector",
    "fakeWindowGuard": "Fake sign-in windows",
    "forceHttps": "Force HTTPS",
    "formTrapDetector": "Form trap detector",
    "fullscreenGuard": "Full-screen address bar",
    "gateAdultSites": "Warn before adult sites",
    "googleSearchResultCleanup": "Search result cleanup",
    "honeytokenMode": "Honeytoken mode",
    "insecureLoginGuard": "Warn before an insecure sign-in",
    "intranetProtection": "Intranet/router protection",
    "keystrokePressure": "Keystroke pressure detector",
    "logThirdPartyBeacons": "Third-party beacon logging",
    "loginAgeCheck": "Login page age check",
    "mailTrackingShield": "Stop email tracking pixels",
    "mediaShield": "Media Shield",
    "monitorLoggerApi": "Monitor for tracker requests",
    "notificationAbuseGuard": "Notification bait",
    "oauthGuard": "OAuth grant guard",
    "openPhish": "OpenPhish",
    "pasteProtection": "Paste protection",
    "paymentCardGuard": "Payment card guard",
    "permissionChainGuard": "Permission chain guard",
    "phishTank": "PhishTank",
    "removeConsentWalls": "Lift full-screen cookie walls",
    "removeOverlays": "Block in-page popups & overlays",
    "riskySiteMode": "Risky-site mode",
    "scamLockGuard": "Tech-support scam guard",
    "scriptDriftGuard": "Script drift guard",
    "scriptletEngine": "AdShield: YouTube",
    "socialWidgetGuard": "Click to load social embeds",
    "storageAccessGuard": "Watch cross-site cookie requests",
    "strictPopupShield": "Strict ad-popup shield",
    "stripTrackingParams": "Remove tracking parameters from page addresses",
    "trackerLearner": "Local tracker learner",
    "urlHaus": "URLhaus",
    "unshimLinks": "Skip tracking redirects",
    "warnGrabberDomains": "Warn on IP-logger pages",
    "warnRedirectParams": "Warn on redirecting links",
    "warnShorteners": "Warn on shortened links",
    "whoisXmlReputation": "WhoisXML Domain Reputation",
    "whoisXmlThreatIntel": "WhoisXML Threat Intelligence",
    "xssBehaviorGuard": "XSS Behavior Guard"
  });

  function has(id) {
    return typeof id === 'string' && validId.test(id) && own(entries, id);
  }

  function keysFor(id) { return has(id) ? entries[id].keys : empty; }
  function pauseKeysFor(id) { return has(id) ? entries[id].pauseKeys : empty; }
  function canReview(id) { return keysFor(id).some(key => !['logThirdPartyBeacons', 'deviceAccessGuard', 'capabilityGuard'].includes(key)); }
  function pauseScopeFor(id) {
    const pause = pauseKeysFor(id);
    return pause.length ? own(pagePartKeys, pause[0]) ? 'page-part' : 'site' : '';
  }
  function eventsFor(key) { return typeof key === 'string' && own(keyEvents, key) ? keyEvents[key] : empty; }
  function settingLabel(key) { return typeof key === 'string' && own(labels, key) ? labels[key] : ''; }

  WardenProtectionEvents = Object.freeze({ has, keysFor, pauseKeysFor, pauseScopeFor, canReview, eventsFor, settingLabel, eventIds: () => ids });
  wardenEventProtectionKeys = keysFor;
  wardenProtectionEventIds = eventsFor;
})();

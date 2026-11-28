/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Stands in for Google's IMA video ad SDK (ima3.js). Every ad request is answered the way an empty ad server answers
   it, an ad load error with VAST code 1009, which every IMA player already handles by starting the video itself.
   Nothing is fetched and no ad is shown. */
(() => {
  const g = window.google = window.google || {};
  if (g.ima && typeof g.ima.AdsLoader === 'function') return;

  const noop = () => {};
  const later = (fn) => setTimeout(() => { try { fn(); } catch (_) {} }, 0);

  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(types, listener) {
      for (const type of [].concat(types)) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        if (typeof listener === 'function' || (listener && typeof listener.handleEvent === 'function')) this.listeners.get(type).add(listener);
      }
    }
    removeEventListener(types, listener) { for (const type of [].concat(types)) this.listeners.get(type)?.delete(listener); }
    dispatch(event) {
      for (const listener of [...(this.listeners.get(event.type) || [])]) {
        try { typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event); } catch (_) {}
      }
    }
  }

  const ErrorCode = { VAST_EMPTY_RESPONSE: 1009, UNKNOWN_ERROR: 900, VAST_LOAD_TIMEOUT: 301, FAILED_TO_REQUEST_ADS: 1005 };
  class AdError {
    constructor(code, message, type) { this.code = code; this.message = message; this.type = type; }
    getErrorCode() { return this.code; }
    getVastErrorCode() { return this.code; }
    getMessage() { return this.message; }
    getType() { return this.type; }
    getInnerError() { return null; }
    toString() { return 'AdError ' + this.code + ': ' + this.message; }
  }
  AdError.ErrorCode = ErrorCode;
  AdError.Type = { AD_LOAD: 'adLoadError', AD_PLAY: 'adPlayError' };

  class AdErrorEvent {
    constructor(error, context) { this.type = AdErrorEvent.Type.AD_ERROR; this.error = error; this.context = context; }
    getError() { return this.error; }
    getUserRequestContext() { return this.context; }
  }
  AdErrorEvent.Type = { AD_ERROR: 'adError' };

  const AdEventType = {};
  for (const name of ['AD_BREAK_READY', 'AD_BUFFERING', 'AD_CAN_PLAY', 'AD_METADATA', 'AD_PROGRESS', 'ALL_ADS_COMPLETED',
    'CLICK', 'COMPLETE', 'CONTENT_PAUSE_REQUESTED', 'CONTENT_RESUME_REQUESTED', 'DURATION_CHANGE', 'FIRST_QUARTILE',
    'IMPRESSION', 'INTERACTION', 'LINEAR_CHANGED', 'LOADED', 'LOG', 'MIDPOINT', 'PAUSED', 'RESUMED', 'SKIPPABLE_STATE_CHANGED',
    'SKIPPED', 'STARTED', 'THIRD_QUARTILE', 'USER_CLOSE', 'VIDEO_CLICKED', 'VIDEO_ICON_CLICKED', 'VOLUME_CHANGED', 'VOLUME_MUTED']) {
    AdEventType[name] = name.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  class AdEvent { constructor(type) { this.type = type; } getAd() { return null; } getAdData() { return null; } }
  AdEvent.Type = AdEventType;

  /* A manager with no ads, for players that build one before any request: starting it hands the video back at once. */
  class AdsManager extends Events {
    init() {} destroy() {} stop() {} pause() {} resume() {} resize() {} skip() {} collapse() {} expand() {}
    start() { later(() => { this.dispatch(new AdEvent(AdEventType.CONTENT_RESUME_REQUESTED)); this.dispatch(new AdEvent(AdEventType.ALL_ADS_COMPLETED)); }); }
    getCuePoints() { return []; } getRemainingTime() { return 0; } getVolume() { return 1; } setVolume() {}
    getAdSkippableState() { return false; } isCustomClickTrackingUsed() { return false; } isCustomPlaybackUsed() { return false; }
    discardAdBreak() {} updateAdsRenderingSettings() {} configureAdsManager() {} clicked() {} focus() {}
  }
  class AdsManagerLoadedEvent {
    constructor(context) { this.type = AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED; this.context = context; }
    getAdsManager() { return new AdsManager(); }
    getUserRequestContext() { return this.context; }
  }
  AdsManagerLoadedEvent.Type = { ADS_MANAGER_LOADED: 'adsManagerLoaded' };

  class ImaSdkSettings {
    constructor() { this.values = {}; }
  }
  for (const name of ['AutoPlayAdBreaks', 'CompanionBackfill', 'DisableCustomPlaybackForIOS10Plus', 'FeatureFlags', 'Locale',
    'NumRedirects', 'PlayerType', 'PlayerVersion', 'Ppid', 'SessionId', 'VpaidAllowed', 'VpaidMode', 'CookiesEnabled', 'DisableFlashAds']) {
    ImaSdkSettings.prototype['set' + name] = function (value) { this.values[name] = value; };
    ImaSdkSettings.prototype['get' + name] = function () { return this.values[name]; };
  }
  ImaSdkSettings.prototype.isCookiesEnabled = function () { return false; };
  ImaSdkSettings.prototype.isVpaidAdapter = function () { return false; };
  ImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };
  ImaSdkSettings.CompanionBackfillMode = { ALWAYS: 'always', ON_MASTER_AD: 'on_master_ad' };
  const settings = new ImaSdkSettings();

  class AdsLoader extends Events {
    constructor(container) { super(); this.container = container; }
    getSettings() { return settings; }
    requestAds(_request, context) {
      later(() => this.dispatch(new AdErrorEvent(
        new AdError(ErrorCode.VAST_EMPTY_RESPONSE, 'No ads VAST response after one or more wrappers.', AdError.Type.AD_LOAD), context)));
    }
    contentComplete() {} destroy() { this.listeners.clear(); } getVersion() { return ima.VERSION; }
  }
  class AdDisplayContainer { constructor(container, video) { this.container = container; this.video = video; } initialize() {} destroy() {} }
  class AdsRequest {
    constructor() { this.adTagUrl = ''; this.adsResponse = ''; this.linearAdSlotWidth = 0; this.linearAdSlotHeight = 0; }
    setAdWillAutoPlay() {} setAdWillPlayMuted() {} setContinuousPlayback() {}
  }
  class AdsRenderingSettings { constructor() { this.restoreCustomPlaybackStateOnAdBreakComplete = false; this.uiElements = null; } }
  class CompanionAdSelectionSettings {}
  CompanionAdSelectionSettings.CreativeType = { ALL: 'All', FLASH: 'Flash', IMAGE: 'Image' };
  CompanionAdSelectionSettings.ResourceType = { ALL: 'All', HTML: 'Html', IFRAME: 'IFrame', STATIC: 'Static' };
  CompanionAdSelectionSettings.SizeCriteria = { IGNORE: 'IgnoreSize', SELECT_EXACT_MATCH: 'SelectExactMatch', SELECT_NEAR_MATCH: 'SelectNearMatch' };

  const ima = {
    VERSION: '3.0.0',
    AdDisplayContainer, AdError, AdErrorEvent, AdEvent, AdsLoader, AdsManager, AdsManagerLoadedEvent, AdsRenderingSettings,
    AdsRequest, CompanionAdSelectionSettings, ImaSdkSettings, settings,
    UiElements: { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' },
    ViewMode: { FULLSCREEN: 'fullscreen', NORMAL: 'normal' },
    OmidAccessMode: { DOMAIN: 'domain', FULL: 'full', LIMITED: 'limited' },
    OmidVerificationVendor: {}, AdCuePoints: function () {}, CustomContentLoadedEvent: noop,
  };
  g.ima = ima;
})();

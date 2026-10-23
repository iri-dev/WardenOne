# README control and feature cross-audit

Audited 16 October 2026 against the local extension at `5e822baa08710d6a2f73cb84e59d73237aa8edc6`, with the documentation and VirusTotal URL-sanitizing edits made during this audit. The GitHub `main` README matched the pre-edit local file (blob `1444adca81471cad79a87b4faba0ced562f1890e`). This is a documentation audit, not a live-browser effectiveness test.

## Scope and result

The source registry has **105 independently counted protection switches** and **3 watch-only protections**. The popup also has **24 non-protection checkbox controls** and **1 second-level WebRTC control**. Eight further popup controls use custom widgets. These make **141 registry, watch-only and popup entries** in the first inventory. The Settings page declares **21 more mode, value and presentation controls**, inventoried separately below. `antiFingerprint` is a legacy alias of `antiFingerprintNoise`, not another control.

The Settings navigation has 23 pages and subviews, cross-checked below. Standalone pages, modes and actions are listed separately from switches so they cannot silently disappear from the audit.

Each row links to the README section that explains the behavior, sometimes as part of a shared feature family. Provider data disclosure belongs in the privacy policy. A link is not a claim that the feature was verified on a live website.

## Gaps found and corrected

- Added descriptions for high-confidence phishing blocks, behavioural detection, risky-site mode, script drift, warnings for redirecting and shortened links, third-party logging warnings, click-to-load social embeds, tracker supercookie cleanup, De-AMP, and opt-in fraud-script blocking.
- Clarified the distinct VirusTotal URL-content hash check and WhoisXML choices, Twitch buffering and the two rewind modes, Tab Limit, Forget Me history cleanup, notification sound controls, diagnostics, and WardenOne data erasure. Updated the OAuth provider examples.
- Documented the popup's manual VirusTotal URL scanner separately from automatic download checks. Corrected the privacy policy's VirusTotal disclosure and removed URL credentials from automatic VirusTotal requests.
- The 108 count remains correct. The popup and Health images were recaptured directly from the extension, and new Settings, arrangement, privacy, fingerprinting and Resource Saver images accompany their descriptions. Other feature screenshots may still show earlier builds.

## Switch and control inventory

### Protection switches (105)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `blockForcedPopups` | Block forced popups | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `strictPopupShield` | Strict ad-popup shield | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `blockGesturelessNav` | Block gestureless redirects | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `detectRedirectChains` | Detect redirect chains | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `blockMetaRefresh` | Block meta-refresh bounces | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `blockGrabberResources` | Block IP-grabber beacons | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) | Explained |
| `warnGrabberDomains` | Warn on IP-logger pages | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) | Explained |
| `blockWebRTCLeak` | IP lookup blocking | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) | Explained |
| `certificateGuard` | Block bad certificates | [HTTPS & Certificate Protection](../README.md#https--certificate-protection) | Explained |
| `blockTrackers` | Block trackers & ad analytics | [Tracker protection](../README.md#tracker-protection) | Explained |
| `adShield` | AdShield: General sites | [AdShield](../README.md#adshield) | Explained |
| `scriptletEngine` | AdShield: YouTube | [YouTube AdShield](../README.md#youtube-adshield) | Explained |
| `twitchAdBlock` | AdShield: Twitch | [Twitch AdShield](../README.md#twitch-adshield) | Explained |
| `sendPrivacySignals` | Do Not Track & privacy signals | [Tracker protection](../README.md#tracker-protection) | Explained |
| `clientHintProtection` | Reduce third-party Client Hints | [Header Shield](../README.md#header-shield) | Explained |
| `capReferrer` | Strict cross-site referrer protection | [Header Shield](../README.md#header-shield) | Explained |
| `trackerCacheProtection` | Block tracker cache validators | [Header Shield](../README.md#header-shield) | Explained |
| `fingerprintProbeDetection` | Fingerprint probe detection | [Anti-fingerprinting](../README.md#anti-fingerprinting) | Explained |
| `blockFingerprintScripts` | Limit fingerprinting JavaScript | [Script Shield](../README.md#script-shield) | Explained |
| `blockFraudVendorScripts` | Block fraud and bot-check scripts | [Anti-fingerprinting](../README.md#anti-fingerprinting) | Explained |
| `blockThirdPartyCookies` | Block third-party cookies | [Cookie and storage controls](../README.md#cookie-and-storage-controls) | Explained |
| `blockFirstPartyTrackers` | Block first-party trackers | [First-party Tracker Protection](../README.md#first-party-tracker-protection) | Explained |
| `sessionShield` | SessionShield | [SessionShield](../README.md#sessionshield) | Explained |
| `blockTokenExfil` | Protect session tokens | [Session Token Guard](../README.md#session-token-guard) | Explained |
| `continuousTokenScan` | Continuous token watch | [Session Token Guard](../README.md#session-token-guard) | Explained |
| `detectSkimmers` | Detect & block form skimmers | [Form Skimmer & Magecart Guard](../README.md#form-skimmer--magecart-guard) | Explained |
| `paymentCardGuard` | Payment card guard | [Payment Card Guard](../README.md#payment-card-guard) | Explained |
| `forceHttps` | Force HTTPS | [HTTPS & Certificate Protection](../README.md#https--certificate-protection) | Explained |
| `insecureLoginGuard` | Warn before an insecure sign-in | [Insecure Sign-in Guard](../README.md#insecure-sign-in-guard) | Explained |
| `loginAgeCheck` | Login page age check | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) | Explained |
| `downloadReputation` | Download Shield | [Download Shield](../README.md#download-shield) | Explained |
| `downloadDomainAge` | Check download domain age | [Download Shield](../README.md#download-shield) | Explained |
| `downloadSafeBrowsing` | Google Safe Browsing URL checks | [Download Shield](../README.md#download-shield) | Explained |
| `downloadVirusTotal` | VirusTotal reputation | [Download Shield](../README.md#download-shield) | Explained |
| `downloadVirusTotalHash` | VirusTotal URL-content hash lookup | [Download Shield](../README.md#download-shield) | Explained |
| `urlHaus` | URLhaus | [Download Shield](../README.md#download-shield) | Explained |
| `abuseIpDb` | AbuseIPDB | [Download Shield](../README.md#download-shield) | Explained |
| `openPhish` | OpenPhish | [Download Shield](../README.md#download-shield) | Explained |
| `phishTank` | PhishTank | [Download Shield](../README.md#download-shield) | Explained |
| `whoisXml` | WhoisXML API | [Download Shield](../README.md#download-shield) | Explained |
| `whoisXmlReputation` | WhoisXML Domain Reputation | [Download Shield](../README.md#download-shield) | Explained |
| `whoisXmlThreatIntel` | WhoisXML Threat Intelligence | [Download Shield](../README.md#download-shield) | Explained |
| `clipboardGuard` | Clipboard hijack protection | [Clipboard Hijack Protection](../README.md#clipboard-hijack-protection) | Explained |
| `clipboardSwapDetect` | Clipboard swap detection | [Clipboard Swap Detection](../README.md#clipboard-swap-detection) | Explained |
| `scamLockGuard` | Tech-support scam guard | [Fake Update & Tech-support Scam Protection](../README.md#fake-update--tech-support-scam-protection) | Explained |
| `commandPasteGuard` | Command paste guard | [ClickFix & Command Paste Guard](../README.md#clickfix--command-paste-guard) | Explained |
| `pasteProtection` | Paste protection | [Paste Protection](../README.md#paste-protection) | Explained |
| `formTrapDetector` | Form trap detector | [Autofill Trap Guard](../README.md#autofill-trap-guard) | Explained |
| `fakeUpdateDetector` | Fake update detector | [Fake Update & Tech-support Scam Protection](../README.md#fake-update--tech-support-scam-protection) | Explained |
| `permissionChainGuard` | Permission chain guard | [Permission Chain Guard](../README.md#permission-chain-guard) | Explained |
| `oauthGuard` | OAuth grant guard | [OAuth Grant Guard](../README.md#oauth-grant-guard) | Explained |
| `scriptDriftGuard` | Script drift guard | [Script Shield](../README.md#script-shield) | Explained |
| `riskySiteMode` | Risky-site mode | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) | Explained |
| `antiClickjacking` | Anti-clickjacking checks | [Anti-clickjacking](../README.md#anti-clickjacking) | Explained |
| `intranetProtection` | Intranet/router protection | [Intranet Guard](../README.md#intranet-guard) | Explained |
| `intranetNetworkRules` | Enforce it at the network layer too | [Intranet Guard](../README.md#intranet-guard) | Explained |
| `dnsRebindGuard` | DNS rebinding detection | [DNS Rebinding Protection](../README.md#dns-rebinding-protection) | Explained |
| `storageAccessGuard` | Watch cross-site cookie requests | [Cookie and storage controls](../README.md#cookie-and-storage-controls) | Explained |
| `blockAllStorageAccess` | Refuse every cross-site cookie request | [Cookie and storage controls](../README.md#cookie-and-storage-controls) | Explained |
| `mediaShield` | Media Shield | [Media Shield](../README.md#media-shield) | Explained |
| `fullscreenGuard` | Full-screen address bar | [Full-screen Address Guard](../README.md#full-screen-address-guard) | Explained |
| `fakeWindowGuard` | Fake sign-in windows | [Browser-in-the-Browser Protection](../README.md#browser-in-the-browser-protection) | Explained |
| `notificationAbuseGuard` | Notification bait | [Notification Scam Protection](../README.md#notification-scam-protection) | Explained |
| `blockCameraMic` | Block camera & microphone | [Media Shield](../README.md#media-shield) | Explained |
| `blockScreenCapture` | Block screen capture | [Media Shield](../README.md#media-shield) | Explained |
| `blockGeolocation` | Block location requests | [Location Guard](../README.md#location-guard) | Explained |
| `blockAutoplayMedia` | Block hidden media abuse | [Media Shield](../README.md#media-shield) | Explained |
| `gateAdultSites` | Warn on adult-site redirects | [Adult-site Arrival Screen](../README.md#adult-site-arrival-screen) | Explained |
| `adultHeuristics` | Catch unlisted adult sites | [Adult-site Arrival Screen](../README.md#adult-site-arrival-screen) | Explained |
| `warnRedirectParams` | Warn on redirecting links | [Link hygiene](../README.md#link-hygiene) | Explained |
| `warnShorteners` | Warn on shortened links | [Link hygiene](../README.md#link-hygiene) | Explained |
| `warnSearchResults` | Warn about dangerous search results | [Search-result protection](../README.md#search-result-protection) | Explained |
| `monitorLoggerApi` | Monitor for tracker requests | [Tracker protection](../README.md#tracker-protection) | Explained |
| `detectPhishing` | Detect fake / phishing sites | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) | Explained |
| `blockHighConfidencePhishing` | Block high-confidence look-alikes | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) | Explained |
| `behavioralScan` | Behavioral risk detection | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) | Explained |
| `xssBehaviorGuard` | XSS Behavior Guard | [XSS Behaviour Guard](../README.md#xss-behaviour-guard) | Explained |
| `removeOverlays` | Block in-page popups & overlays | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `autoSkipDownloadAds` | Auto-skip download ads | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `blockMalwareSites` | Block known malicious sites | [Threat Blocklist](../README.md#threat-blocklist) | Explained |
| `blockCryptominers` | Block cryptominers | [Cryptojacking protection](../README.md#cryptojacking-protection) | Explained |
| `autoUpdateLists` | Auto-update blocklist | [Threat Blocklist](../README.md#threat-blocklist) | Explained |
| `trackerLearner` | Local tracker learner | [First-party Tracker Protection](../README.md#first-party-tracker-protection) | Explained |
| `unshimLinks` | Remove link click pings | [Link hygiene](../README.md#link-hygiene) | Explained |
| `stripTrackingParams` | Remove tracking parameters from page addresses | [Link hygiene](../README.md#link-hygiene) | Explained |
| `cleanCopyLinks` | Clean links copied inside pages | [Link hygiene](../README.md#link-hygiene) | Explained |
| `socialWidgetGuard` | Click to load social embeds | [Tracker protection](../README.md#tracker-protection) | Explained |
| `blockSupercookies` | Clear tracker supercookies | [Cookie and storage controls](../README.md#cookie-and-storage-controls) | Explained |
| `watchExtensionPermissions` | Watch installed-extension changes | [Extension Change Monitoring](../README.md#extension-change-monitoring) | Explained |
| `startupCheck` | Startup security check | [Startup Security Check](../README.md#startup-security-check) | Explained |
| `blockPopupTricks` | Block popup and redirect tricks | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |
| `antiFingerprintNoise` | Anti-fingerprinting noise | [Anti-fingerprinting](../README.md#anti-fingerprinting) | Explained |
| `autoRejectConsent` | Auto-reject cookie banners | [Consent protection](../README.md#consent-protection) | Explained |
| `removeConsentWalls` | Lift full-screen cookie walls | [Consent protection](../README.md#consent-protection) | Explained |
| `mailTrackingShield` | Stop email tracking pixels | [Mail Shield](../README.md#mail-shield) | Explained |
| `clearCookiesOnLeave` | Clear a site's cookies after accepting | [Consent protection](../README.md#consent-protection) | Explained |
| `clearServiceWorkersOnLeave` | Remove a site's service worker when you leave | [Service-worker Cleanup](../README.md#service-worker-cleanup) | Explained |
| `blockAllCookies` | No persistent cookies | [Cookie and storage controls](../README.md#cookie-and-storage-controls) | Explained |
| `deAmp` | De-AMP pages | [Link hygiene](../README.md#link-hygiene) | Explained |
| `breachCheck` | Breach & site-history checks | [Breach & Password Checks](../README.md#breach--password-checks) | Explained |
| `keystrokePressure` | Keystroke pressure detector | [Keystroke Pressure Detection](../README.md#keystroke-pressure-detection) | Explained |
| `honeytokenMode` | Honeytoken mode | [Honeytoken Mode](../README.md#honeytoken-mode) | Explained |
| `cryptominerCpuWatch` | Deep cryptominer detection | [Cryptojacking protection](../README.md#cryptojacking-protection) | Explained |
| `safeSearch` | Force SafeSearch | [SafeSearch & Restricted Mode](../README.md#safesearch--restricted-mode) | Explained |
| `backTrapGuard` | Stop back-button traps | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) | Explained |

### Watch-only protections (3)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `logThirdPartyBeacons` | Background reports | [Watch-only Protections](../README.md#watch-only-protections) | Explained |
| `deviceAccessGuard` | Hardware and file access | [Watch-only Protections](../README.md#watch-only-protections) | Explained |
| `capabilityGuard` | Browser capabilities | [Watch-only Protections](../README.md#watch-only-protections) | Explained |

### Presentation controls (3)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `showBadge` | Show on-page badge | [First run](../README.md#first-run) | Explained |
| `showToasts` | Show block notifications | [Notification Centre](../README.md#notification-centre) | Explained |
| `silentMode` | Silent mode | [Notification Centre](../README.md#notification-centre) | Explained |

### Tools (3)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `elementZapper` | Element Zapper | [Element Zapper](../README.md#element-zapper) | Explained |
| `twitchRewind` | Twitch local rewind (DVR) | [Twitch Local Rewind](../README.md#twitch-local-rewind) | Explained |
| `twitchVodRewind` | Watch from earlier (stream rewind) | [Twitch Local Rewind](../README.md#twitch-local-rewind) | Explained |

### Comfort controls (17)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `blockAutoplay` | Block autoplay video & audio | [Resource Saver](../README.md#resource-saver) | Explained |
| `killPrefetch` | Block prefetch & preload | [Resource Saver](../README.md#resource-saver) | Explained |
| `lazyLoadMedia` | Lazy-load offscreen images | [Resource Saver](../README.md#resource-saver) | Explained |
| `twitchSteadyPlayback` | Steadier Twitch playback | [Twitch AdShield](../README.md#twitch-adshield) | Explained |
| `disableYouTubeAmbientMode` | Disable YouTube Ambient Mode | [Resource Saver](../README.md#resource-saver) | Explained |
| `stopAnimatedVideoPreviews` | Stop animated video previews | [Resource Saver](../README.md#resource-saver) | Explained |
| `pauseAnimatedImages` | Pause animated GIF images | [Resource Saver](../README.md#resource-saver) | Explained |
| `blockSearchAiAnswers` | Hide search AI answers | [Search cleanup](../README.md#search-cleanup) | Explained |
| `blockSponsoredSearchResults` | Hide sponsored search results | [Search cleanup](../README.md#search-cleanup) | Explained |
| `googleWebResultsOnly` | Google: plain web results only | [Search cleanup](../README.md#search-cleanup) | Explained |
| `flagSearchJunk` | Mark answer-scraper results | [Search cleanup](../README.md#search-cleanup) | Explained |
| `memoryShield` | Sleep inactive tabs | [Memory Shield](../README.md#memory-shield) | Explained |
| `memoryNeverAudio` | Never sleep tabs playing audio | [Memory Shield](../README.md#memory-shield) | Explained |
| `memoryNeverForms` | Never sleep tabs with unsaved forms | [Memory Shield](../README.md#memory-shield) | Explained |
| `memoryNeverPayment` | Never sleep login / payment pages | [Memory Shield](../README.md#memory-shield) | Explained |
| `memoryNeverPinned` | Never sleep pinned tabs | [Memory Shield](../README.md#memory-shield) | Explained |
| `throttleBackgroundTabs` | Throttle background tabs | [Resource Saver](../README.md#resource-saver) | Explained |

### Compatibility control (1)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `loginCompatibility` | Login compatibility | [Consent protection](../README.md#consent-protection) | Explained |

### Second-level control (1)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `blockSuspiciousWebRTC` | Harden WebRTC (may break calls) | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) | Explained |

### Other popup controls (8)

| Source key | Reader-facing control | README coverage | Status |
| --- | --- | --- | --- |
| `js-global` | Block scripts everywhere | [Script Shield](../README.md#script-shield) | Explained |
| `js-site` | Block scripts on this site | [Script Shield](../README.md#script-shield) | Explained |
| `js-smart` | Smart trusted-script shield | [Script Shield](../README.md#script-shield) | Explained |
| `tl-guard` | Tab Limit | [Memory Shield](../README.md#memory-shield) | Explained |
| `tl-close` | Close instead of sleeping (aggressive) | [Memory Shield](../README.md#memory-shield) | Explained |
| `tl-warn` | Notify me when a tab is closed | [Memory Shield](../README.md#memory-shield) | Explained |
| `forget-enable` | Never let sites remember me | [Forget Me & Logins](../README.md#forget-me--logins) | Explained |
| `forget-history` | Also clear the site's browser history | [Forget Me & Logins](../README.md#forget-me--logins) | Explained |

## Settings mode and value controls

These are the 21 `choice`, `pick`, `flag`, `slider` and `num` controls declared in the Settings navigation in `settings.js`. The three `notice*` flags are Settings-only switches. Other rows are modes or values rather than extra protections.

| Source key | Reader-facing control | README coverage |
| --- | --- | --- |
| `memoryMode` | Memory Shield sleep profile | [Memory Shield](../README.md#memory-shield) |
| `tabLimitMax` | Maximum tabs | [Memory Shield](../README.md#memory-shield) |
| `tabLimitMinIdleMinutes` | Minimum inactive time | [Memory Shield](../README.md#memory-shield) |
| `webglSaverMode` | Disable WebGL mode | [Resource Saver](../README.md#resource-saver) |
| `theme` | Light, Dark or System theme | [WardenOne Themes](../README.md#wardenone-themes) |
| `density` | Compact or Comfortable Settings layout | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `siteCard` | One-line or counts site card | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `noticeDuration` | Notice time on screen | [Notification Centre](../README.md#notification-centre) |
| `noticePosition` | Notice position | [Notification Centre](../README.md#notification-centre) |
| `noticeGroup` | Group repeated notices | [Notification Centre](../README.md#notification-centre) |
| `noticeBadge` | Toolbar unread count | [Notification Centre](../README.md#notification-centre) |
| `noticeRetention` | Notice history retention | [Notification Centre](../README.md#notification-centre) |
| `noticeSound` | Play sounds | [Notification Centre](../README.md#notification-centre) |
| `noticeSoundMode` | Which notices make sound | [Notification Centre](../README.md#notification-centre) |
| `noticeVolume` | Sound volume | [Notification Centre](../README.md#notification-centre) |
| `eyeshield` | EyeShield mode | [EyeShield](../README.md#eyeshield) |
| `eyeShieldBrightness` | Brightness | [EyeShield](../README.md#eyeshield) |
| `eyeShieldContrast` | Contrast | [EyeShield](../README.md#eyeshield) |
| `eyeShieldSaturation` | Saturation | [EyeShield](../README.md#eyeshield) |
| `eyeShieldWarmth` | Warmth | [EyeShield](../README.md#eyeshield) |
| `eyeShieldGrayscale` | Greyscale | [EyeShield](../README.md#eyeshield) |

## Other user-facing features and surfaces

| Feature or surface | Implementation evidence | README coverage |
| --- | --- | --- |
| Master switch and first-run presets | `popup.html`, `onboarding.html` | [First run](../README.md#first-run) |
| Site Dashboard and per-site pauses | `popup.js`, `site-dashboard-shared.js` | [Per-site control](../README.md#per-site-control) |
| Popup search and section arrangement | `popup-settings-search.js`, `popup.js` | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| Full Settings page, search, favorites and recent changes | `settings.html`, `settings.js` | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| Activity Centre | `history.html` | [Activity Centre](../README.md#activity-centre) |
| Notification Centre, muting and sounds | `notifications.html`, `notification-manager.js` | [Notification Centre](../README.md#notification-centre) |
| Protection Health and diagnostics | `popup-health.js`, `popup-diagnostics.js` | [Protection Health](../README.md#protection-health) |
| Privacy Self-Test | `privacy-test.html`, `privacy-probe.js` | [Privacy Self-Test](../README.md#privacy-self-test) |
| Verify and Repair | `background.js`, `popup.js` | [Verify and Repair](../README.md#verify-and-repair) |
| Network Logger | `logger.html`, `logger.js` | [Network Logger](../README.md#network-logger) |
| Site Firewall | `firewall.html`, `firewall.js` | [Site Firewall](../README.md#site-firewall) |
| My Rules and Custom Lists | `popup.html`, `settings.js` | [My Rules](../README.md#my-rules), [Custom Lists](../README.md#custom-lists) |
| Spotify AdShield | `spotify-adblock.js`, `rules-spotify-media.json` | [Spotify AdShield](../README.md#spotify-adshield) |
| Download Review and File Shield | `download-review.html`, `file-shield.html` | [Download Shield](../README.md#download-shield) |
| Extension Security Centre and pre-install check | `extensions.html`, `extensions.js` | [Extension Security Centre](../README.md#extension-security-centre) |
| Browser Update Guardian and build update notice | `background.js`, `build-update.js` | [Update Guardian](../README.md#update-guardian), [Quick install](../README.md#quick-install) |
| Site Permission Scanner | `popup.html`, `background.js` | [Site Permission Scanner](../README.md#site-permission-scanner) |
| Optional provider keys and checks | `api-keys.html`, `settings.js` | [Download Shield](../README.md#download-shield), [Privacy, permissions & transparency](../README.md#privacy-permissions--transparency) |
| Manual VirusTotal URL scanner | `popup.html`, `popup.js` | [Download Shield](../README.md#download-shield) |
| Privacy Cleaner and WardenOne data erasure | `popup.html`, `settings.js` | [Privacy Cleaner](../README.md#privacy-cleaner) |
| Settings backup and import | `popup.js`, `settings.js` | [Settings Backup](../README.md#settings-backup) |
| Saved hidden-element manager | `hidden-elements.html`, `hidden-elements.js` | [Element Zapper](../README.md#element-zapper), [Settings and popup layout](../README.md#settings-and-popup-layout) |
| Memory profiles and never-sleep sites | `background-memory.js`, `popup.js` | [Memory Shield](../README.md#memory-shield) |
| WebGL Saver mode and host lists | `resource-saver.js`, `settings.js` | [Resource Saver](../README.md#resource-saver) |
| EyeShield and per-site profiles | `eyeshield.js`, `eyeshield-sites.js` | [EyeShield](../README.md#eyeshield) |
| Themes and notification display preferences | `theme.js`, `settings.js` | [WardenOne Themes](../README.md#wardenone-themes), [Notification Centre](../README.md#notification-centre) |
| Command Palette and keyboard shortcuts | `popup.js`, `manifest.json` | [Command Palette](../README.md#command-palette), [Keyboard Shortcuts](../README.md#keyboard-shortcuts) |
| Right-click tools | `background.js`, `manifest.json` | [Right-click tools](../README.md#right-click-tools) |
| Official download and manual update route | `build-update.js`, `.github/workflows/gate.yml` | [Quick install](../README.md#quick-install) |
| About page build ID and project information | `settings.js`, `build-profile.js` | [Quick install](../README.md#quick-install), [Official source & authenticity](../README.md#official-source--authenticity) |
| Permissions and network guide | `permissions.html`, `network.html` | [Privacy, permissions & transparency](../README.md#privacy-permissions--transparency), [Network and device defence](../README.md#network-and-device-defence) |
| Warning and blocking pages | `safe-browsing-block.html`, `ip-logger-warning.html`, `redirect-warning.html`, `cert-error.html` | [Threat Blocklist](../README.md#threat-blocklist), [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection), [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection), [HTTPS & Certificate Protection](../README.md#https--certificate-protection) |

## Settings navigation cross-check

These are the page IDs in `settings.js`, including the two overview subviews that do not appear in the normal sidebar.

| Page ID | Reader-facing page | README coverage |
| --- | --- | --- |
| `overview` | Overview | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `recent` | Recently changed | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `favorites` | Favorites | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `changed` | Changed from Recommended | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `compat` | May affect compatibility | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `security` | Security | [Security](../README.md#security) |
| `privacy` | Privacy | [Privacy & anti-tracking](../README.md#privacy--anti-tracking) |
| `ads` | Ads & clutter | [Content blocking](../README.md#content-blocking) |
| `popups` | Pop-ups & redirects | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `downloads` | Downloads | [Download Shield](../README.md#download-shield) |
| `signin` | Sign-in & sessions | [SessionShield](../README.md#sessionshield) |
| `network` | Network & IP | [Network and device defence](../README.md#network-and-device-defence) |
| `media` | Camera, mic & media | [Media Shield](../README.md#media-shield) |
| `speed` | Speed & memory | [Memory Shield](../README.md#memory-shield), [Resource Saver](../README.md#resource-saver) |
| `sites` | Sites & exceptions | [Per-site control](../README.md#per-site-control) |
| `look` | Look & reading | [WardenOne Themes](../README.md#wardenone-themes), [EyeShield](../README.md#eyeshield) |
| `arrange` | Arrange sections | [Settings and popup layout](../README.md#settings-and-popup-layout) |
| `cleanup` | Clean-up & backup | [Privacy Cleaner](../README.md#privacy-cleaner), [Settings Backup](../README.md#settings-backup) |
| `access` | Permissions & keys | [Privacy, permissions & transparency](../README.md#privacy-permissions--transparency) |
| `shortcuts` | Keyboard shortcuts | [Keyboard Shortcuts](../README.md#keyboard-shortcuts) |
| `lists` | Blocklists & filters | [Threat Blocklist](../README.md#threat-blocklist), [Custom Lists](../README.md#custom-lists) |
| `help` | Help & feedback | [Feedback & security reporting](../README.md#feedback--security-reporting) |
| `about` | About WardenOne | [Quick install](../README.md#quick-install), [Licence & credits](../README.md#licence--credits) |

## Verification

The protection count test checks the registry against popup switches and all published totals. The new README audit test checks the 141-entry inventory, 21 Settings controls, 23 Settings pages, UI labels, and README links. Download and privacy tests cover the VirusTotal paths. The full maintainability gate passed with 279 suites. These checks do not prove all protections work against live sites.

## Screenshot refresh

Seven images were captured from the actual extension at `b1b60308fa72fd8a8aee46fd746c42a3373df445` in a disposable Edge 150.0.4078.48 profile on 16 October 2026. The popup used `example.com`; Settings used the default Recommended configuration. The fresh profile had built-in rules active and no downloaded-list timestamp, which the Health images show. No protection counts or events were fabricated.

The popup captures were retaken at `a9e2425ded5d9ab4ca185d04d665178ee590d6a9` using a 348 CSS-pixel width at 4× resolution: 1392×1884 for the overview and 1392×2472 for expanded Health. They use new dated filenames because the previous image URLs continued showing an earlier capture after the push. Settings captures use a 1280 CSS-pixel viewport at 1.5× resolution; Resource Saver and fingerprinting focus on complete main panels. Browser chrome and scrollbars are excluded. The lossless WebP copies preserve the source pixels. Earlier feature images remain available, with the two poor popup images replaced and five new feature images added.

A local Markdown preview loaded every image. The default view has 23 visible feature images, compared with 18 in the original README. The popup, expanded Health, Settings overview, section arrangement and Resource Saver captures were inspected at their README display sizes.

### Element Zapper comparison

The selection and removal images were captured with the extension at `fbf7231ba4c2d60336346e8af7c87ca1598d9386` in a disposable Edge 150.0.4078.48 profile on 16 October 2026. The browser loaded `https://github.com/features/actions` directly from GitHub, using a 1280×900 CSS-pixel viewport at 2× resolution to produce 2560×1800 images. The actual `element-picker.js` was started through `chrome.scripting.executeScript`; browser mouse input outlined and hid the developer newsletter section. The first image shows the active selection, and the second shows the section missing with the tool's “One thing hidden” confirmation still open. The website content was not recreated or edited for the capture.

The saved rule was `section.newsletter__5-VDgZ.newsletter__vt4udc` under `github.com`. The newsletter remained hidden after reloading the live page. Both images use the same viewport and lossless WebP encoding; both appear directly in the README. They replace the three local demonstration images from the previous revision.

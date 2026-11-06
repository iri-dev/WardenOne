# Controls and Settings reference

This reference maps the controls in WardenOne to their descriptions in the README.

## Switch and control inventory

### Protection switches (107)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `blockForcedPopups` | Block forced popups | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `strictPopupShield` | Strict ad-popup shield | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `blockGesturelessNav` | Block gestureless redirects | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `detectRedirectChains` | Detect redirect chains | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `blockMetaRefresh` | Block meta-refresh bounces | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `blockGrabberResources` | Block IP-grabber beacons | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) |
| `warnGrabberDomains` | Warn on IP-logger pages | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) |
| `blockWebRTCLeak` | IP lookup blocking | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) |
| `certificateGuard` | Block bad certificates | [HTTPS & Certificate Protection](../README.md#https--certificate-protection) |
| `blockTrackers` | Block trackers & ad analytics | [Tracker protection](../README.md#tracker-protection) |
| `adShield` | AdShield: General sites | [AdShield](../README.md#adshield) |
| `scriptletEngine` | AdShield: YouTube | [YouTube AdShield](../README.md#youtube-adshield) |
| `twitchAdBlock` | AdShield: Twitch | [Twitch AdShield](../README.md#twitch-adshield) |
| `sendPrivacySignals` | Do Not Track & privacy signals | [Tracker protection](../README.md#tracker-protection) |
| `clientHintProtection` | Reduce third-party Client Hints | [Header Shield](../README.md#header-shield) |
| `capReferrer` | Strict cross-site referrer protection | [Header Shield](../README.md#header-shield) |
| `trackerCacheProtection` | Block tracker cache validators | [Header Shield](../README.md#header-shield) |
| `fingerprintProbeDetection` | Fingerprint probe detection | [Anti-fingerprinting](../README.md#anti-fingerprinting) |
| `blockFingerprintScripts` | Limit fingerprinting JavaScript | [Script Shield](../README.md#script-shield) |
| `blockFraudVendorScripts` | Block fraud and bot-check scripts | [Anti-fingerprinting](../README.md#anti-fingerprinting) |
| `blockThirdPartyCookies` | Block third-party cookies | [Cookie and storage controls](../README.md#cookie-and-storage-controls) |
| `blockFirstPartyTrackers` | Block first-party trackers | [First-party Tracker Protection](../README.md#first-party-tracker-protection) |
| `blockCnameTrackers` | Block CNAME-cloaked trackers | [CNAME Tracker Protection](../README.md#cname-tracker-protection) |
| `sessionShield` | SessionShield | [SessionShield](../README.md#sessionshield) |
| `blockTokenExfil` | Protect session tokens | [Session Token Guard](../README.md#session-token-guard) |
| `continuousTokenScan` | Continuous token watch | [Session Token Guard](../README.md#session-token-guard) |
| `detectSkimmers` | Detect & block form skimmers | [Form Skimmer & Magecart Guard](../README.md#form-skimmer--magecart-guard) |
| `paymentCardGuard` | Payment card guard | [Payment Card Guard](../README.md#payment-card-guard) |
| `forceHttps` | Force HTTPS | [HTTPS & Certificate Protection](../README.md#https--certificate-protection) |
| `insecureLoginGuard` | Warn before an insecure sign-in | [Insecure Sign-in Guard](../README.md#insecure-sign-in-guard) |
| `loginAgeCheck` | Login page age check | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) |
| `forcedDownloadProtection` | Forced Download Protection | [Forced Download Protection](../README.md#forced-download-protection) |
| `downloadReputation` | Download Shield | [Download Shield](../README.md#download-shield) |
| `downloadDomainAge` | Check download domain age | [Download Shield](../README.md#download-shield) |
| `downloadSafeBrowsing` | Google Safe Browsing URL checks | [Download Shield](../README.md#download-shield) |
| `downloadVirusTotal` | VirusTotal reputation | [Download Shield](../README.md#download-shield) |
| `downloadVirusTotalHash` | VirusTotal URL-content hash lookup | [Download Shield](../README.md#download-shield) |
| `urlHaus` | URLhaus | [Download Shield](../README.md#download-shield) |
| `abuseIpDb` | AbuseIPDB | [Download Shield](../README.md#download-shield) |
| `openPhish` | OpenPhish | [Download Shield](../README.md#download-shield) |
| `phishTank` | PhishTank | [Download Shield](../README.md#download-shield) |
| `whoisXml` | WhoisXML API | [Download Shield](../README.md#download-shield) |
| `whoisXmlReputation` | WhoisXML Domain Reputation | [Download Shield](../README.md#download-shield) |
| `whoisXmlThreatIntel` | WhoisXML Threat Intelligence | [Download Shield](../README.md#download-shield) |
| `clipboardGuard` | Clipboard hijack protection | [Clipboard Hijack Protection](../README.md#clipboard-hijack-protection) |
| `clipboardSwapDetect` | Clipboard swap detection | [Clipboard Swap Detection](../README.md#clipboard-swap-detection) |
| `scamLockGuard` | Tech-support scam guard | [Fake Update & Tech-support Scam Protection](../README.md#fake-update--tech-support-scam-protection) |
| `commandPasteGuard` | Command paste guard | [ClickFix & Command Paste Guard](../README.md#clickfix--command-paste-guard) |
| `pasteProtection` | Paste protection | [Paste Protection](../README.md#paste-protection) |
| `formTrapDetector` | Form trap detector | [Autofill Trap Guard](../README.md#autofill-trap-guard) |
| `fakeUpdateDetector` | Fake update detector | [Fake Update & Tech-support Scam Protection](../README.md#fake-update--tech-support-scam-protection) |
| `permissionChainGuard` | Permission chain guard | [Permission Chain Guard](../README.md#permission-chain-guard) |
| `oauthGuard` | OAuth grant guard | [OAuth Grant Guard](../README.md#oauth-grant-guard) |
| `scriptDriftGuard` | Script drift guard | [Script Shield](../README.md#script-shield) |
| `riskySiteMode` | Risky-site mode | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) |
| `antiClickjacking` | Anti-clickjacking checks | [Anti-clickjacking](../README.md#anti-clickjacking) |
| `intranetProtection` | Intranet/router protection | [Intranet Guard](../README.md#intranet-guard) |
| `intranetNetworkRules` | Enforce it at the network layer too | [Intranet Guard](../README.md#intranet-guard) |
| `dnsRebindGuard` | DNS rebinding detection | [DNS Rebinding Protection](../README.md#dns-rebinding-protection) |
| `storageAccessGuard` | Watch cross-site cookie requests | [Cookie and storage controls](../README.md#cookie-and-storage-controls) |
| `blockAllStorageAccess` | Refuse every cross-site cookie request | [Cookie and storage controls](../README.md#cookie-and-storage-controls) |
| `mediaShield` | Media Shield | [Media Shield](../README.md#media-shield) |
| `fullscreenGuard` | Full-screen address bar | [Full-screen Address Guard](../README.md#full-screen-address-guard) |
| `fakeWindowGuard` | Fake sign-in windows | [Browser-in-the-Browser Protection](../README.md#browser-in-the-browser-protection) |
| `notificationAbuseGuard` | Notification bait | [Notification Scam Protection](../README.md#notification-scam-protection) |
| `blockCameraMic` | Block camera & microphone | [Media Shield](../README.md#media-shield) |
| `blockScreenCapture` | Block screen capture | [Media Shield](../README.md#media-shield) |
| `blockGeolocation` | Block location requests | [Location Guard](../README.md#location-guard) |
| `blockAutoplayMedia` | Block hidden media abuse | [Media Shield](../README.md#media-shield) |
| `gateAdultSites` | Warn before adult sites | [Adult-site Arrival Screen](../README.md#adult-site-arrival-screen) |
| `adultHeuristics` | Catch unlisted adult sites | [Adult-site Arrival Screen](../README.md#adult-site-arrival-screen) |
| `warnRedirectParams` | Warn on redirecting links | [Link hygiene](../README.md#link-hygiene) |
| `warnShorteners` | Warn on shortened links | [Link hygiene](../README.md#link-hygiene) |
| `warnSearchResults` | Warn about dangerous search results | [Search-result protection](../README.md#search-result-protection) |
| `monitorLoggerApi` | Monitor for tracker requests | [Tracker protection](../README.md#tracker-protection) |
| `detectPhishing` | Detect fake / phishing sites | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) |
| `blockHighConfidencePhishing` | Block high-confidence look-alikes | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) |
| `behavioralScan` | Behavioral risk detection | [Phishing & Look-Alike Protection](../README.md#phishing--look-alike-protection) |
| `xssBehaviorGuard` | XSS Behavior Guard | [XSS Behaviour Guard](../README.md#xss-behaviour-guard) |
| `removeOverlays` | Block in-page popups & overlays | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `autoSkipDownloadAds` | Auto-skip download ads | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `blockMalwareSites` | Block known malicious sites | [Threat Blocklist](../README.md#threat-blocklist) |
| `blockCryptominers` | Block cryptominers | [Cryptojacking protection](../README.md#cryptojacking-protection) |
| `autoUpdateLists` | Auto-update blocklist | [Threat Blocklist](../README.md#threat-blocklist) |
| `trackerLearner` | Local tracker learner | [First-party Tracker Protection](../README.md#first-party-tracker-protection) |
| `unshimLinks` | Skip tracking redirects | [Link hygiene](../README.md#link-hygiene) |
| `stripTrackingParams` | Remove tracking parameters from page addresses | [Link hygiene](../README.md#link-hygiene) |
| `cleanCopyLinks` | Clean links copied inside pages | [Link hygiene](../README.md#link-hygiene) |
| `socialWidgetGuard` | Click to load social embeds | [Tracker protection](../README.md#tracker-protection) |
| `blockSupercookies` | Clear tracker supercookies | [Cookie and storage controls](../README.md#cookie-and-storage-controls) |
| `watchExtensionPermissions` | Watch installed-extension changes | [Extension Change Monitoring](../README.md#extension-change-monitoring) |
| `startupCheck` | Startup security check | [Startup Security Check](../README.md#startup-security-check) |
| `blockPopupTricks` | Block popup and redirect tricks | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |
| `antiFingerprintNoise` | Anti-fingerprinting noise | [Anti-fingerprinting](../README.md#anti-fingerprinting) |
| `autoRejectConsent` | Auto-reject cookie banners | [Consent protection](../README.md#consent-protection) |
| `removeConsentWalls` | Lift full-screen cookie walls | [Consent protection](../README.md#consent-protection) |
| `mailTrackingShield` | Stop email tracking pixels | [Mail Shield](../README.md#mail-shield) |
| `clearCookiesOnLeave` | Clear a site's cookies after accepting | [Consent protection](../README.md#consent-protection) |
| `clearServiceWorkersOnLeave` | Remove a site's service worker when you leave | [Service-worker Cleanup](../README.md#service-worker-cleanup) |
| `blockAllCookies` | No persistent cookies | [Cookie and storage controls](../README.md#cookie-and-storage-controls) |
| `deAmp` | De-AMP pages | [Link hygiene](../README.md#link-hygiene) |
| `breachCheck` | Breach & site-history checks | [Breach & Password Checks](../README.md#breach--password-checks) |
| `keystrokePressure` | Keystroke pressure detector | [Keystroke Pressure Detection](../README.md#keystroke-pressure-detection) |
| `honeytokenMode` | Honeytoken mode | [Honeytoken Mode](../README.md#honeytoken-mode) |
| `cryptominerCpuWatch` | Deep cryptominer detection | [Cryptojacking protection](../README.md#cryptojacking-protection) |
| `safeSearch` | Force SafeSearch | [SafeSearch & Restricted Mode](../README.md#safesearch--restricted-mode) |
| `backTrapGuard` | Stop back-button traps | [Redirect, Pop-up & Back-trap Protection](../README.md#redirect-pop-up--back-trap-protection) |

### Watch-only protections (3)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `logThirdPartyBeacons` | Background reports | [Watch-only Protections](../README.md#watch-only-protections) |
| `deviceAccessGuard` | Hardware and file access | [Watch-only Protections](../README.md#watch-only-protections) |
| `capabilityGuard` | Browser capabilities | [Watch-only Protections](../README.md#watch-only-protections) |

### Presentation controls (3)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `showBadge` | Show on-page badge | [First run](../README.md#first-run) |
| `showToasts` | Show block notifications | [Notification Centre](../README.md#notification-centre) |
| `silentMode` | Silent mode | [Notification Centre](../README.md#notification-centre) |

### Tools (3)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `elementZapper` | Element Zapper | [Element Zapper](../README.md#element-zapper) |
| `twitchRewind` | Twitch local rewind (DVR) | [Twitch Local Rewind](../README.md#twitch-local-rewind) |
| `twitchVodRewind` | Watch from earlier (stream rewind) | [Twitch Local Rewind](../README.md#twitch-local-rewind) |

### Comfort controls (17)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `blockAutoplay` | Block autoplay video & audio | [Resource Saver](../README.md#resource-saver) |
| `killPrefetch` | Block prefetch & preload | [Resource Saver](../README.md#resource-saver) |
| `lazyLoadMedia` | Lazy-load offscreen images | [Resource Saver](../README.md#resource-saver) |
| `twitchSteadyPlayback` | Steadier Twitch playback | [Twitch AdShield](../README.md#twitch-adshield) |
| `disableYouTubeAmbientMode` | Disable YouTube Ambient Mode | [Resource Saver](../README.md#resource-saver) |
| `stopAnimatedVideoPreviews` | Stop animated video previews | [Resource Saver](../README.md#resource-saver) |
| `pauseAnimatedImages` | Pause animated GIF images | [Resource Saver](../README.md#resource-saver) |
| `blockSearchAiAnswers` | Hide search AI answers | [Search cleanup](../README.md#search-cleanup) |
| `blockSponsoredSearchResults` | Hide sponsored search results | [Search cleanup](../README.md#search-cleanup) |
| `googleWebResultsOnly` | Google: plain web results only | [Search cleanup](../README.md#search-cleanup) |
| `flagSearchJunk` | Mark answer-scraper results | [Search cleanup](../README.md#search-cleanup) |
| `memoryShield` | Sleep inactive tabs | [Memory Shield](../README.md#memory-shield) |
| `memoryNeverAudio` | Never sleep tabs playing audio | [Memory Shield](../README.md#memory-shield) |
| `memoryNeverForms` | Never sleep tabs with unsaved forms | [Memory Shield](../README.md#memory-shield) |
| `memoryNeverPayment` | Never sleep login / payment pages | [Memory Shield](../README.md#memory-shield) |
| `memoryNeverPinned` | Never sleep pinned tabs | [Memory Shield](../README.md#memory-shield) |
| `throttleBackgroundTabs` | Throttle background tabs | [Resource Saver](../README.md#resource-saver) |

### Compatibility control (1)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `loginCompatibility` | Login compatibility | [Consent protection](../README.md#consent-protection) |

### Second-level controls (2)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `blockSuspiciousWebRTC` | Harden WebRTC (may break calls) | [WebRTC & IP-logger Protection](../README.md#webrtc--ip-logger-protection) |
| `trackerLearnerAuto` | Learning mode | [First-party Tracker Protection](../README.md#first-party-tracker-protection) |

### Other popup controls (8)

| Source key | Reader-facing control | README coverage |
| --- | --- | --- | --- |
| `js-global` | Block scripts everywhere | [Script Shield](../README.md#script-shield) |
| `js-site` | Block scripts on this site | [Script Shield](../README.md#script-shield) |
| `js-smart` | Smart trusted-script shield | [Script Shield](../README.md#script-shield) |
| `tl-guard` | Tab Limit | [Memory Shield](../README.md#memory-shield) |
| `tl-close` | Close instead of sleeping (aggressive) | [Memory Shield](../README.md#memory-shield) |
| `tl-warn` | Notify me when a tab is closed | [Memory Shield](../README.md#memory-shield) |
| `forget-enable` | Never let sites remember me | [Forget Me & Logins](../README.md#forget-me--logins) |
| `forget-history` | Also clear the site's browser history | [Forget Me & Logins](../README.md#forget-me--logins) |

## Settings mode and value controls

These are the 22 `choice`, `pick`, `flag`, `slider` and `num` controls declared in the Settings navigation in `settings.js`. The three `notice*` flags are Settings-only switches. Other rows are modes or values rather than extra protections.

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
| `historyMode` | Activity and notification history storage | [Activity Centre](../README.md#activity-centre) |
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

## Settings pages

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
| `learned-trackers` | Learned trackers | [First-party Tracker Protection](../README.md#first-party-tracker-protection) |
| `lists` | Blocklists & filters | [Threat Blocklist](../README.md#threat-blocklist), [Custom Lists](../README.md#custom-lists) |
| `help` | Help & feedback | [Feedback & security reporting](../README.md#feedback--security-reporting) |
| `about` | About WardenOne | [Quick install](../README.md#quick-install), [Licence & credits](../README.md#licence--credits) |

## References

Control names follow `settings-data.js` and the Settings page registry.

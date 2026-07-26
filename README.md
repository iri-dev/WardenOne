# WebWarden

**An all-in-one privacy and security extension for Chromium browsers.** One master
switch turns on a whole stack of protections that would normally take five separate
extensions: ad and tracker blocking, anti-fingerprinting, download and phishing
defence, popup and redirect shielding, IP-leak protection, and memory / performance
tools — plus quality-of-life engines for YouTube and Twitch. Manifest V3, no remote
proxy, everything runs locally.

<p align="center">
  <img src="docs/popup.png" alt="WebWarden control panel" width="340">
</p>

## Why WebWarden

Most people stack uBlock Origin + a fingerprint blocker + a popup blocker + a
download scanner + a tab suspender and hope they get along. WebWarden is a single
extension that does all of it, with one master switch and fine-grained per-feature
control.

## Everything it does

### AdShield — ad blocking
- **General sites** — EasyList / uBlock-style filtering (network + cosmetic + anti-adblock scriptlets).
- **YouTube** — removes pre-roll and mid-roll video ads by pruning the ad schedule out of the player data — no black screen, no skip button, stable across YouTube updates.
- **Twitch** — removes the pre-roll and mid-roll ads Twitch stitches into the stream, with a silent-segment fallback so playback never breaks.
- **Sponsored search results** — strips sponsored Google / Brave results and their ad-click wrappers.
- **Search AI answers** — optionally hides Google AI Overview and Brave AI answers before they paint.

### Privacy & anti-tracking
- **Tracker & analytics blocking** — hard-blocks Google Analytics, DoubleClick, Facebook Pixel, and friends.
- **Do Not Track & Global Privacy Control** — sends legally-recognised opt-out signals (GPC has weight under CCPA).
- **Anti-fingerprinting** — per-session randomised noise on canvas, WebGL, audio, and hardware hints; detection of canvas/audio/WebGL/font/device probing; and blocking of known fingerprinting scripts.
- **Cookie control** — block third-party cookies, optional wipe-on-close, and automatic "reject non-essential" on consent banners (it never clicks Accept).
- **Login compatibility** — keeps anti-tracking on while exempting Google / Microsoft / Apple / Okta / Auth0 / PayPal / Stripe sign-in, CAPTCHA, and payment flows, so logins still finish.
- **Link hygiene** — strips tracking params (`utm_`, `fbclid`, …) on copy, unwraps tracking redirects (Facebook `l.php`, Google `/url`, Reddit `out`), trims referrers to origin, and de-AMPs Google links.
- **Local tracker learner** — learns trackers on-device across sites; no browsing profile ever leaves your machine.
- Plus **click-to-load social embeds** (Facebook / X / Instagram / TikTok) and **tracker supercookie clearing** for the sneakier stuff.

### Script Shield
- Block scripts everywhere (lockdown) or per-site, NoScript-style.
- Limit fingerprinting JavaScript while normal JS keeps working.
- Smart third-party script blocking with a trusted-site allowlist.

### Redirects & popups
- Block forced popups and popunders (timer-based `window.open`, hidden ad tabs).
- Strict ad-popup shield for "download + ad tab" installer tricks.
- Remove in-page overlays — fake notification bells, subscribe walls, adblock nags, cookie / continue walls, download gates — with an Undo chip.
- Auto-skip fake "Download Now" ad gates, block gestureless redirects, detect CPA redirect chains, and stop `<meta refresh>` bounces.

### IP protection
- Block IP-grabber beacons and warn on known logger domains (Grabify, IPLogger).
- WebRTC IP-leak guard plus third-party IP-lookup blocking.
- Force HTTPS, and warn on expired / revoked / self-signed / mismatched certificates.

### Download Shield
- No-account **A–F download grading** from the URL, source, filename, file type, Chrome signals, and blocklists — known-bad blocked outright, risky ones held for a review you can cancel.
- Optional **domain-age checks** (RDAP, or WhoisXML enrichment) and a **VirusTotal URL scanner** to vet links before you open them.

### Memory & performance
- **Memory Shield** — sleep inactive tabs (Gentle → Balanced → Aggressive → Emergency), with never-sleep rules for pinned / audio / unsaved-form / login-payment tabs, plus one-click "free RAM", duplicate-tab finder, and zombie-tab detection.
- **Resource Saver** — block autoplay media, throttle background tabs, and stop prefetch / preload to save CPU, battery, and mobile data.

### Extras
- **Twitch Local Rewind** — scrub back through a live stream, or jump straight to the moment you joined.
- **EyeShield** — an eye-comfort colour / contrast filter with per-site handling.
- **Search Protections** — search across your own protections (phishing, trackers, cookies) right from the popup.

## Install (from source)

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.

Works in Chrome, Brave, Edge, and other Chromium browsers.

## Privacy

Everything runs locally in your browser. There's no remote proxy, and your browsing
is never sent to a server we run. The optional lookups you switch on yourself
(download domain age, VirusTotal) send only the minimum — a source domain, or a link
you paste — never your full history.

## License

**GNU General Public License v3** — see [LICENSE](LICENSE).

WebWarden builds on the open-source blocking community. Sources are credited in
[CREDITS.md](CREDITS.md): AdGuard (YouTube rules), EasyList / EasyPrivacy (tracker
rules), and TwitchAdSolutions (Twitch strategy).

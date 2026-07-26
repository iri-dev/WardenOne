# WebWarden

**The all-in-one privacy, security, and anti-scam extension for Chromium browsers.**

WebWarden folds a whole stack of security tools into one extension: ad and tracker
blocking, anti-fingerprinting, phishing and scam defence, credential- and
payment-theft protection, download scanning, IP-leak protection, media/device
permission control, and memory management — **80+ individual protections** behind a
single master switch, each one toggleable. Manifest V3. No remote proxy. No account.
No telemetry. Everything runs on your device.

<p align="center">
  <img src="docs/popup.png" alt="WebWarden control panel" width="330">
</p>

## Why WebWarden

Staying safe online usually means bolting together half a dozen extensions —
uBlock Origin, a fingerprint blocker, a popup blocker, a download scanner, a
password-field guard, a tab suspender — and hoping they cooperate. WebWarden is a
single extension that does all of that, plus phishing/scam defence and
credential-theft protection most blockers don't touch. One toggle turns it all on;
every feature underneath is individually controllable.

## What's inside

### Ad & content blocking — AdShield
- **General** — EasyList / uBlock-style filtering (network + cosmetic + anti-adblock scriptlets).
- **YouTube** — removes pre-roll and mid-roll video ads by pruning the ad schedule out of the player data; no black screen, no skip button.
- **Twitch** — removes stitched-in pre-roll and mid-roll stream ads, with a silent-segment fallback so playback never breaks.
- **Sponsored results & AI answers** — strips sponsored Google / Brave results and their ad-click wrappers, and can hide Google/Brave AI answer panels.

### Anti-tracking & privacy
- Hard-block trackers and analytics (Google Analytics, DoubleClick, Facebook Pixel…).
- **Do Not Track & Global Privacy Control** opt-out signals.
- **Third-party cookie blocking**, plus optional **wipe-on-close** and **no persistent cookies**.
- **First-party tracker catching** (analytics proxied through a site's own domain), a **local, on-device tracker learner**, referrer trimming, and **De-AMP**.
- **Link hygiene** — strip `utm_` / `fbclid` on copy, unwrap tracking redirects (`l.php`, `/url`, Reddit `out`).
- **Click-to-load social embeds**, **supercookie clearing**, and **auto-reject cookie banners** (never clicks Accept).

### Anti-fingerprinting
- Per-session randomised canvas / WebGL / audio / hardware-hint noise.
- Detection of canvas / audio / WebGL / font / device probing, plus blocking of known fingerprinting scripts.

### Script control — Script Shield
- Block scripts everywhere (lockdown) or per-site, NoScript-style, with a trusted-site allowlist and a fingerprinting-script filter.

### Popups, redirects & overlays
- Block forced popups / popunders, "download + ad tab" installer tricks, and in-page overlays (fake notification bells, subscribe walls, adblock nags, cookie / continue walls, download gates) — with an Undo chip.
- Auto-skip fake download-ad gates, block gestureless redirects, detect CPA redirect chains, and stop `<meta refresh>` bounces.

### Phishing & scam protection
- **Look-alike / homograph blocking** — full-screen block on `g00gle`-style typos, wrong-TLD, and homographs.
- **Login-page age check** — warns when a password form sits on a brand-new domain (RDAP, no API key).
- **Behavioral risk detection** for brand-new sites that act like scams even off every blocklist.
- **ClickFix command-paste guard**, a **tech-support-scam / browser-locker** neutraliser, **fake-update lure** detection, adult-site redirect warnings, a script-drift guard, risky-site mode, anti-clickjacking, and shortened / redirecting-link warnings.

### Credential, payment & clipboard protection
- **Form-skimmer / Magecart detection** — blocks scripts reading password / card fields and exfiltrating them off-site.
- **Payment-card guard** on scammy, brand-new, or look-alike checkouts.
- **Session-token protection**, **continuous token watch**, **keylogger detection**, and **honeytoken decoys**.
- **Clipboard-hijack protection** (crypto-address swap), **paste protection** (password / API key / seed phrase), an **OAuth-grant guard**, and **Have I Been Pwned** breach checks.

### Download protection — Download Shield
- No-account **A–F download grading** from the URL, source, filename, file type, Chrome signals, and blocklists — known-bad blocked outright, risky ones held for a review you can cancel.
- Optional **domain-age checks** (RDAP / WhoisXML) and a **VirusTotal URL scanner**.

### Network & IP protection
- **WebRTC IP-leak guard**, IP-grabber beacon blocking, logger-domain warnings (Grabify, IPLogger), **Force HTTPS**, and **bad-certificate** blocking.

### Media & device control
- **Media Shield** — block camera, microphone, screen-capture, and hidden background media.
- **Location-request blocking**, a **permission-chain guard**, and a **per-site permission scanner** (allow / block / ask for camera, mic, notifications, location).

### Site data, session & extension control
- **Forget Me** — auto-wipe a site's cookies and storage on leave (off / chosen / all sites).
- **Emergency Logout**, a **Privacy Cleaner** (selective wipe), a **live per-site Session Security grade** (A–F: connection, JWT exposure, token storage, cookie security), and an **extension watchdog** that flags installed extensions gaining risky permissions.

### Threat blocklist
- Hard-block known malicious sites from vetted threat feeds, **auto-updated daily** (tens of thousands of domains, millions across the feeds).

### Performance
- **Memory Shield** — sleep inactive tabs (Gentle → Balanced → Aggressive → Emergency) with never-sleep rules for pinned / audio / form / login tabs; free RAM on demand, find duplicate and zombie tabs.
- **Resource Saver** — block autoplay media, throttle background tabs, lazy-load images, and stop prefetch / preload.

### Extras
- **Twitch Local Rewind** (scrub back through a live stream, or jump to where you joined), an **EyeShield** eye-comfort filter, and an **Update Guardian** that nudges you when your browser is behind on security patches.

## Not just a settings page

WebWarden ships real interfaces, not only toggles.

**Local Activity Center** — a private, on-device log of everything blocked, learned, and allowed. Nothing leaves your machine.

![Activity dashboard](docs/activity.png)

**On-page block & warning screens** — clear interstitials for dangerous sites, unexpected cross-site redirects, and invalid certificates, each explaining *why* — with no quiet bypass.

![Dangerous site blocked](docs/site-blocked.png)

**Permissions, explained** — a plain-English ledger of every permission WebWarden uses, why it exists, and where its reach stops (16 browser permissions, 13 host scopes).

![Permissions explained](docs/permissions.png)

There's also a **Network / DNS protection guide** for router-level filtering and a one-minute **onboarding** flow.

## Install (from source)

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.

Works in Chrome, Brave, Edge, and other Chromium browsers.

## Privacy

Everything runs locally. There's no remote proxy, no account, and no telemetry —
your browsing is never sent to a server we run. The optional lookups you switch on
yourself (download domain age, VirusTotal, breach checks) send only the minimum: a
source domain, a link you paste, or a hashed query. Login tokens and passwords are
never stored or transmitted.

## License

**GNU General Public License v3** — see [LICENSE](LICENSE).

WebWarden builds on the open-source blocking community. Sources are credited in
[CREDITS.md](CREDITS.md): AdGuard (YouTube rules), EasyList / EasyPrivacy (tracker
rules), and TwitchAdSolutions (Twitch strategy).

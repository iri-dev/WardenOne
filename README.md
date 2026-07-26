# WebWarden

**The all-in-one privacy, security, and anti-scam extension for Chromium browsers.**
One master switch replaces a whole stack of tools — ad and tracker blocking,
anti-fingerprinting, phishing and scam defence, credential- and payment-theft
protection, download scanning, IP-leak protection, and memory / performance
management — with fine-grained control over **80+ individual protections**.
Manifest V3, no remote proxy, everything runs on your device.

<p align="center">
  <img src="docs/popup.png" alt="WebWarden control panel" width="340">
</p>

## Why WebWarden

Most people bolt together uBlock Origin + a fingerprint blocker + a popup blocker +
a download scanner + a password-field guard + a tab suspender, and hope they get
along. WebWarden is a single extension that does all of that — and a lot more —
behind one master switch, with every feature individually toggleable.

## Features

### Ad & content blocking — AdShield
- **General sites** — EasyList / uBlock-style filtering (network + cosmetic + anti-adblock scriptlets).
- **YouTube** — removes pre-roll and mid-roll video ads by pruning the ad schedule out of the player data; no black screen, no skip button.
- **Twitch** — removes the stitched-in pre-roll and mid-roll stream ads, with a silent-segment fallback so playback never breaks.
- **Sponsored search results** — strips sponsored Google / Brave results and their ad-click wrappers.
- **Search AI answers** — optionally hides Google AI Overview and Brave AI answers.

### Anti-tracking & privacy
- **Tracker & analytics blocking** — hard-blocks Google Analytics, DoubleClick, Facebook Pixel, and similar.
- **Do Not Track & Global Privacy Control** — sends legally-recognised opt-out signals.
- **Third-party cookie blocking**, plus optional **wipe-on-close** / **no persistent cookies**.
- **First-party tracker catching** — analytics proxied through a site's own domain to dodge blocklists.
- **Local tracker learner** — learns trackers on-device across sites; nothing leaves your machine.
- **Link hygiene** — strips `utm_` / `fbclid` params on copy, unwraps tracking redirects (`l.php`, `/url`, Reddit `out`), trims referrers, and de-AMPs Google links.
- **Click-to-load social embeds** (Facebook / X / Instagram / TikTok) and **tracker supercookie clearing**.
- **Auto-reject cookie banners** — never clicks Accept.

### Anti-fingerprinting
- **Per-session randomised noise** on canvas, WebGL, audio, and hardware hints.
- **Fingerprint probe detection** — spots canvas / audio / WebGL / font / device probing.
- **Block known fingerprinting scripts** from a maintained vendor list.

### Script control — Script Shield
- Block scripts **everywhere** (lockdown) or **per-site**, NoScript-style.
- **Limit fingerprinting JavaScript** while normal JS keeps working.
- **Smart third-party script blocking** with a trusted-site allowlist.

### Popups, redirects & overlays
- Block **forced popups / popunders** (timer-based `window.open`, hidden ad tabs).
- **Strict ad-popup shield** for "download + ad tab" installer tricks.
- Remove **in-page overlays** — fake notification bells, subscribe walls, adblock nags, cookie / continue walls, download gates — with an Undo chip.
- **Auto-skip download-ad gates**, block **gestureless redirects**, detect **CPA redirect chains**, and stop **`<meta refresh>` bounces**.

### Phishing & scam protection
- **Look-alike / homograph blocking** — full-screen block on `g00gle`-style typos, wrong-TLD, and homograph domains.
- **Login-page age check** — warns when a password form sits on a brand-new domain (RDAP, no API key needed).
- **Behavioral risk detection** — flags brand-new sites that phone home or act like scams even when they're on no blocklist.
- **Fake-update lure detection**, a **tech-support-scam / browser-locker** neutraliser, and the **"ClickFix" command-paste** scam guard.
- **Adult-site safety** — an "are you sure?" screen on unwanted 18+ redirects, plus a heuristic for unlisted sites.
- **Script-drift guard**, **risky-site mode**, **anti-clickjacking**, and warnings on **redirecting** and **shortened** links.

### Credential, payment & clipboard protection
- **Form-skimmer / Magecart detection** — blocks third-party scripts reading password / card fields and exfiltrating them off-site.
- **Payment-card guard** — warns before card details reach scammy, brand-new, or look-alike checkouts.
- **Session-token protection** and **continuous token watch** — block token-shaped values leaving a site, caught the moment they're written.
- **Clipboard-hijack protection** — stops the copied-crypto-address swap trick.
- **Paste protection** — warns before you paste a password, API key, or seed phrase into a risky page.
- **Keylogger detection**, **honeytoken decoys**, and an **OAuth-grant guard** (risky Google / GitHub / Discord consent scopes).
- **Breach checks** via Have I Been Pwned.

### Download protection — Download Shield
- No-account **A–F download grading** from the URL, source, filename, file type, Chrome signals, and blocklists — known-bad blocked outright, risky ones held for a review you can cancel.
- Optional **domain-age checks** (RDAP / WhoisXML) and a **VirusTotal URL scanner** for links before you open them.

### Network & IP protection
- **WebRTC IP-leak guard** plus third-party IP-lookup blocking.
- **IP-grabber beacon blocking** and warnings on logger domains (Grabify, IPLogger).
- **Force HTTPS** and **bad-certificate warnings** (expired / revoked / self-signed / mismatched).

### Media & device permissions
- **Media Shield** — block camera, microphone, screen-capture, and hidden background media.
- **Location-request blocking** — deny prompts, kill location watches, mask timezone / language hints.
- **Per-site permission scanner** — allow / block / ask for camera, mic, notifications, and location.

### Site data & session control
- **Forget Me** — auto-wipe a site's cookies and storage when you leave (off / chosen / all sites).
- **Emergency Logout** — clear session data and sign out everywhere in one click.
- **Privacy Cleaner** — selectively wipe cache, cookies, history, storage, service workers, and form data.
- **Live site scan** — a per-site Session Security grade (A–F): connection, JWT exposure, token storage, and cookie security.
- **Extension watchdog** — alerts you when an installed extension gains high-risk permissions in an update, plus a permissions reviewer.

### Threat blocklist
- **Hard-block known malicious sites** from vetted threat feeds.
- **Auto-updating** — pulls fresh phishing, scam, IP-logger, and adult-warning lists daily (tens of thousands of domains, millions across the feeds).

### Performance
- **Memory Shield** — sleep inactive tabs (Gentle → Balanced → Aggressive → Emergency) with never-sleep rules for pinned / audio / unsaved-form / login tabs; free RAM on demand, and find duplicate or zombie tabs.
- **Resource Saver** — block autoplay media, throttle background tabs, lazy-load images, and stop prefetch / preload to save CPU, battery, and mobile data.

### Extras
- **Twitch Local Rewind** — scrub back through a live stream, or jump straight to the moment you joined.
- **EyeShield** — an eye-comfort colour / contrast filter with per-site handling.
- **Update Guardian** — nudges you when your browser is behind on security patches.
- **Activity log** and a **Network (DNS) inspector**, plus a **Verify & repair** self-check.

## Install (from source)

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.

Works in Chrome, Brave, Edge, and other Chromium browsers.

## Privacy

Everything runs locally in your browser. There's no remote proxy, and your browsing
is never sent to a server we run. The optional lookups you switch on yourself
(download domain age, VirusTotal, breach checks) send only the minimum — a source
domain, a link you paste, or a hashed query — never your full history. Login tokens
and passwords are never stored or transmitted.

## License

**GNU General Public License v3** — see [LICENSE](LICENSE).

WebWarden builds on the open-source blocking community. Sources are credited in
[CREDITS.md](CREDITS.md): AdGuard (YouTube rules), EasyList / EasyPrivacy (tracker
rules), and TwitchAdSolutions (Twitch strategy).

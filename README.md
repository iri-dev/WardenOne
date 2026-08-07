<div align="center">

# WardenOne

### One extension. Every defence.

The all-in-one privacy, security &amp; anti-scam extension for Chromium browsers

[![License: GPLv3](https://img.shields.io/badge/license-GPLv3-6f42c1.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2ea44f.svg)](manifest.json)
[![Latest release](https://img.shields.io/github/v/release/iri-dev/WardenOne?color=e84393&label=release)](https://github.com/iri-dev/WardenOne/releases)
![Protections](https://img.shields.io/badge/protections-80%2B-8e44ad.svg)
![No telemetry](https://img.shields.io/badge/telemetry-none-2ea44f.svg)
[![Report a bug](https://img.shields.io/badge/report_a-bug-e74c3c.svg)](https://github.com/iri-dev/WardenOne/issues/new/choose)

</div>

<p align="center">
  <img src="docs/onboarding.png" alt="Welcome to WardenOne" width="840">
</p>

> **One master switch. 80+ protections. No account, no telemetry — everything runs on your device.**

WardenOne folds a whole stack of security tools into a single extension: ad and
tracker blocking, anti-fingerprinting, phishing and scam defence, credential- and
payment-theft protection, download scanning, IP-leak protection, media / device
permission control, and memory management. Every feature is individually toggleable,
and none of it phones home.

> [!TIP]
> **Found a bug or have an idea?** [**Open an issue »**](https://github.com/iri-dev/WardenOne/issues/new/choose) — a guided form walks you through it in about 30 seconds. Bug reports and feature requests are always welcome.

---

## The name

The **One** says it: one extension, one unified defence system, one guardian standing between you and every online threat. Instead of a dozen tools that half-cooperate, WardenOne brings every layer of protection together behind a single switch — one system, not a bag of features.

## Why WardenOne

Staying safe online usually means bolting together half a dozen extensions — uBlock
Origin, a fingerprint blocker, a popup blocker, a download scanner, a password-field
guard, a tab suspender — and hoping they cooperate. WardenOne does all of that, plus
the phishing, scam, and credential-theft protection most blockers leave out — behind
one switch, with fine-grained control over every piece.

<p align="center">
  <img src="docs/popup.png" alt="WardenOne control panel" width="300">
</p>
<p align="center"><em>The control panel — every protection in one place, with a live per-site security scan.</em></p>

## Features

### Ad &amp; content blocking — AdShield
- **General** — EasyList / uBlock-style filtering (network + cosmetic + anti-adblock scriptlets).
- **YouTube** — removes pre-roll and mid-roll video ads by pruning the ad schedule out of the player data; no black screen, no skip button.
- **Twitch** — removes stitched-in pre-roll and mid-roll stream ads, with a silent-segment fallback so playback never breaks.
- **Sponsored results &amp; AI answers** — strips sponsored Google / Brave results and their ad-click wrappers, and can hide Google / Brave AI answer panels.
- **Mark answer-scraper results** (optional) — dims and labels results from sites that rank by republishing other people's answers, with a one-click **Show anyway**. It never removes them: ad blocking fails visibly, but a search filter that silently drops the one result you needed fails invisibly, and you'd never know it happened. The list auto-updates and can be extended without a new release.
- **Google: plain web results only** (optional) — switches Google into its own "Web" mode: ten blue links, no AI overview, no enriched panels. It removes the clutter at the source rather than hiding it after paint, so nothing flashes in first and no selector can go stale when Google reshuffles its markup. Your Images, Videos and News tabs still work.

### Anti-tracking &amp; privacy
- Hard-block trackers and analytics (Google Analytics, DoubleClick, Facebook Pixel…).
- **Do Not Track &amp; Global Privacy Control** opt-out signals.
- **Third-party cookie blocking**, plus optional **wipe-on-close** and **no persistent cookies**.
- **First-party tracker catching** (analytics proxied through a site's own domain), a **local, on-device tracker learner**, referrer trimming, and **De-AMP**.
- **Link hygiene** — strip `utm_` / `fbclid` params on copy, unwrap tracking redirects (`l.php`, `/url`, Reddit `out`).
- **Click-to-load social embeds**, **supercookie clearing**, and **auto-reject cookie banners** (never clicks Accept).

### Anti-fingerprinting
- Per-session randomised canvas / WebGL / audio / hardware-hint noise.
- Detection of canvas / audio / WebGL / font / device probing, plus blocking of known fingerprinting scripts.

### Script control — Script Shield
- Block scripts **everywhere** (lockdown) or **per-site**, NoScript-style, with a trusted-site allowlist and a fingerprinting-script filter.

### Popups, redirects &amp; overlays
- Block **forced popups / popunders** (timer-based `window.open`, hidden ad tabs).
- **Strict ad-popup shield**, on by default, for "download + ad tab" installer tricks without hijacking player controls or sign-ins.
- Remove **in-page overlays** — fake notification bells, subscribe walls, adblock nags, cookie / continue walls, download gates — with an Undo chip.
- **Auto-skip download-ad gates**, block **gestureless redirects**, detect **CPA redirect chains**, and stop **`<meta refresh>` bounces**.

### Phishing &amp; scam protection
- **Look-alike / homograph blocking** — full-screen block on `g00gle`-style typos, wrong-TLD, and homographs.
- **Login-page age check** — warns when a password form sits on a brand-new domain (RDAP, no API key).
- **Behavioral risk detection** — flags brand-new sites that phone home or act like scams even when they're on no blocklist.
- **ClickFix command-paste guard**, a **tech-support-scam / browser-locker** neutraliser, **fake-update lure** detection, a script-drift guard, risky-site mode, anti-clickjacking, and warnings on redirecting &amp; shortened links.

### Family &amp; content safety
- **Adult-site guard** — an optional "18+ — are you sure?" screen on unwanted adult-site arrivals, so a mistyped address or a sneaky redirect never drops you (or a kid on the family computer) straight onto explicit content.
- **Catches the unlisted ones** — a heuristic flags adult sites that aren't on any blocklist yet, not just the known names.
- **Adult redirect blocking** — stops gestureless hops that fling you to an 18+ page with no click, backed by an adult-warning list that **auto-updates daily**.
- **Force SafeSearch** (optional, off by default) — locks the Google, Bing, DuckDuckGo, Brave Search and Yahoo search engines into SafeSearch, and YouTube into Restricted Mode. The adult gate only fires when you *arrive* somewhere, and explicit images and video render inside the results page itself, where there's no arrival to catch — this closes that gap. Off by default because it changes what search will show you.

### Credential, payment &amp; clipboard protection
- **Form-skimmer / Magecart detection** — blocks scripts reading password / card fields and exfiltrating them off-site.
- **Payment-card guard** on scammy, brand-new, or look-alike checkouts.
- **Session-token protection**, **continuous token watch**, **keylogger detection**, and **honeytoken decoys**.
- **Clipboard-hijack protection** (crypto-address swap), **paste protection** (password / API key / seed phrase), an **OAuth-grant guard**, and **Have I Been Pwned** breach checks.

### Download protection — Download Shield
- No-account **A–F download grading** from the URL, source, filename, file type, Chrome signals, and blocklists — known-bad blocked outright, risky ones held for a review you can cancel.
- Optional **domain-age checks** (RDAP / WhoisXML) and a **VirusTotal URL scanner**.

### Network &amp; IP protection
- **WebRTC IP-leak guard**, IP-grabber beacon blocking, logger-domain warnings (Grabify, IPLogger), **Force HTTPS**, and **bad-certificate** blocking.
- **Intranet / router protection** — public web pages can't silently reach your local admin panels (router, NAS, dev servers), shutting down DNS-rebinding-style local-network attacks.

### Media &amp; device control
- **Media Shield** — block camera, microphone, screen-capture, and hidden background media.
- **Location-request blocking**, a **permission-chain guard**, and a **per-site permission scanner** (allow / block / ask for camera, mic, notifications, location).

### Site data, session &amp; extension control
- **Forget Me &amp; Logins** — one toggle for "never let sites remember me": wipe a site's cookies and storage when you leave, so nothing keeps you logged in or recognises you next visit (allowlisted sites are kept), plus a one-click "forget this site now".
- **Emergency Logout**, a **Privacy Cleaner** (selective wipe), a **live per-site Session Security grade** (A–F: connection, JWT exposure, token storage, cookie security), and an **extension watchdog** that flags installed extensions gaining risky permissions in an update.
- **Startup security check** — on browser launch, scans restored tabs and recently-installed extensions for risky signs.
- **Settings backup** — export every toggle to a file and import it back on a reinstall or a new machine. Nothing syncs to a server and there's no account, so this is the only way you don't rebuild 140-odd settings by hand. API keys are never written to the file, and an imported file can't inject one.
- **On-demand site tools** — check a domain's age (RDAP), look it up against Have I Been Pwned, scan where a site stores login tokens, or review every installed extension's permissions.

### Cryptojacking
- **Block drive-by mining** — mining-as-a-service scripts (the ones that quietly spend your CPU and battery on someone else's coins) are blocked outright, and pages are stopped from opening a stratum WebSocket to a mining pool.
- Mining pools themselves stay reachable if *you* go there — they're only blocked as a third-party connection, so a site can't mine through one behind your back while your own pool dashboard keeps working.
- **Deep detection** (optional, off by default) — for the case blocking can't see: a miner a site hosts on its own origin. Reads the code of the background workers a page starts and **stops the ones running mining routines**, including the replacements a miner spawns when you kill it. Only the mining worker is stopped, so the rest of the site keeps working, and an allowlisted site is reported but never touched. It won't spot a miner with its code obfuscated away.
- Honest scope: heavy CPU use on its own is *not* treated as mining. A video export, a WASM build, and a miner all peg your cores identically, so WardenOne only says "cryptominer" when it can actually see mining code.

### Threat blocklist
- Hard-block known malicious sites from vetted threat feeds, **auto-updated daily** (tens of thousands of domains, millions across the feeds).

### Performance
- **Memory Shield** — sleep inactive tabs (Gentle → Balanced → Aggressive → Emergency) with never-sleep rules for pinned / audio / form / login tabs; free RAM on demand, find duplicate or zombie tabs.
- **Resource Saver** — block autoplay media, throttle background tabs, lazy-load images, and stop prefetch / preload.

### Comfort &amp; extras
- **EyeShield** — a per-site display tuner with Normal / Light / Dark / **Ultra (OLED-black)** modes, plus brightness, contrast, saturation, warmth, and grayscale sliders, remembered per site.
- **Twitch Local Rewind** — scrub back through a live stream, or jump straight to the moment you joined.
- **Update Guardian** — nudges you when your browser is behind on security patches.

## More than a settings page

WardenOne ships real interfaces, not just toggles.

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/activity.png" alt="Local Activity Center" width="100%"><br>
<strong>Local Activity Center</strong><br>
A private, on-device log of everything blocked, learned, and allowed. Nothing leaves your machine.
</td>
<td width="50%" valign="top">
<img src="docs/site-blocked.png" alt="Dangerous Site Blocked" width="100%"><br>
<strong>On-page block screens</strong><br>
Clear interstitials for dangerous sites, unexpected redirects, and bad certificates — each explaining why, with no quiet bypass.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/network.png" alt="Network / DNS guide" width="100%"><br>
<strong>Network / DNS guide</strong><br>
Extend protection past the browser to every device on your network.
</td>
<td width="50%" valign="top">
<img src="docs/permissions.png" alt="Permissions, explained" width="100%"><br>
<strong>Permissions, explained</strong><br>
A plain-English ledger of every permission WardenOne uses and where its reach stops.
</td>
</tr>
</table>

## Set it up your way

On first run, pick **Recommended** (the safe default) or **Maximum privacy** — which
also turns on the hardened set: active anti-fingerprinting, first-party tracker
blocking, breach &amp; password checks, clipboard guard, and referrer / AMP trimming.
Choose **Normal** notifications or **Silent mode**, where protection stays fully on
but popups and badges stay hidden. Every one of the 80+ features is individually
toggleable, and any site can be allowlisted from the popup in one click.

## Install

**From a release (no clone needed):**
1. Download the latest `WardenOne-vX.Y.Z.zip` from the [Releases](https://github.com/iri-dev/WardenOne/releases) page and unzip it.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the unzipped `WardenOne` folder.

**From source:** clone this repository and load the project folder the same way.

Works in Chrome, Brave, Edge, and other Chromium browsers.

## Privacy

Everything runs locally in your browser. There's no remote proxy, no account, and no
telemetry — your browsing is never sent to a server we run. The optional lookups you
switch on yourself (download domain age, VirusTotal, breach checks) send only the
minimum: a source domain, a link you paste, or a hashed query — never your full
history. Login tokens and passwords are never stored or transmitted.

## How I work

My local copy is usually a good way ahead of what's pushed here.

That doesn't mean the released version is behind — it's the opposite. What's published
is the part I'm confident enough to put in front of people, and what's ahead of it is
betas, experiments, and things I'm still trying to break. This gets worked on
constantly, and it isn't going anywhere.

I build in VS Code with the extension loaded, and I'll happily sit with one thing for
hours — edit, reload, hard-refresh, watch what the page actually does, go again. Almost
none of that is worth a commit on its own, so I push once something is finished and I'm
actually sure about it. The history goes quiet and then several commits land at once,
which is usually just one long session finally ending. Probably more of those at 2am
than is strictly sensible.

Everything goes through `node tools/check-maintainability.js` first. And when something
turns out to be wrong on a real site, I'd rather leave the revert sitting in the history
than tidy it away.

## Feedback &amp; bug reports

Found a site WardenOne breaks, or have an idea? **[Open an issue](https://github.com/iri-dev/WardenOne/issues/new/choose)** — there are quick templates for bug reports and feature requests. For bugs, the **site URL** and **which toggle is involved** are the most useful details.

## License

**GNU General Public License v3** — see [LICENSE](LICENSE).

WardenOne builds on the open-source blocking community. Sources are credited in
[CREDITS.md](CREDITS.md): AdGuard (YouTube rules), EasyList / EasyPrivacy (tracker
rules), and TwitchAdSolutions (Twitch strategy).

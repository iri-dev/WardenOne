<div align="center">

# WardenOne

### One extension. Every defence.

The all-in-one privacy, security &amp; anti-scam extension for Chromium browsers

[![License: GPLv3](https://img.shields.io/badge/license-GPLv3-6f42c1.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2ea44f.svg)](manifest.json)
[![Download latest build](https://img.shields.io/badge/download-latest_build-e84393.svg)](https://github.com/iri-dev/WardenOne/releases/download/latest-build/WardenOne-latest.zip)
![Protections](https://img.shields.io/badge/protections-104-8e44ad.svg)
![No telemetry](https://img.shields.io/badge/telemetry-none-2ea44f.svg)
[![Report a bug](https://img.shields.io/badge/report_a-bug-e74c3c.svg)](https://github.com/iri-dev/WardenOne/issues/new/choose)

</div>

> ### ⚠️ WardenOne is a browser extension. It is never an `.exe`.
>
> It is published **only** from [github.com/iri-dev/WardenOne](https://github.com/iri-dev/WardenOne).
> It has never been offered as an installer or a setup program, and it never will be. If
> something using this name asks you to run a program, it isn't mine.
>
> In August 2026 someone republished this project under their own account with the download
> links pointed at malware — a credential stealer, not an extension. That account and its site
> have since been removed by GitHub. **If you downloaded WardenOne from anywhere other than the
> link above, please read [what happened and what to do](https://iri-dev.github.io/WardenOne/stolen)** —
> it has the file details, the antivirus verdicts, and the steps to take if you ran it.

<p align="center">
  <img src="docs/onboarding.png" alt="Welcome to WardenOne" width="840">
</p>

> **One master switch. 104 protections. No account, no telemetry — everything runs on your device.**

WardenOne folds a whole stack of security tools into a single extension: ad and
tracker blocking, anti-fingerprinting, phishing and scam defence, credential- and
payment-theft protection, download scanning, IP-leak protection, media / device
permission control, and memory management. Almost every one is individually toggleable
- the handful that are not only ever watch and never block - and none of it phones home.

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
- **Twitch** — replaces stitched pre-roll and mid-roll ads with another local, Twitch-signed clean stream, keeps its HLS sequence continuous across the swap, and declines display/PiP ads before their creatives load. No third-party proxy is used; if Twitch offers no clean session, playback fails open instead of freezing or looping behind a cover.
- **Sponsored results &amp; AI answers** — strips sponsored Google / Brave results and their ad-click wrappers, and can hide Google / Brave AI answer panels.
- **Mark answer-scraper results** (optional) — dims and labels results from sites that rank by republishing other people's answers, with a one-click **Show anyway**. It never removes them: ad blocking fails visibly, but a search filter that silently drops the one result you needed fails invisibly, and you'd never know it happened. The list auto-updates and can be extended without a new release.
- **Google: plain web results only** (optional) — switches Google into its own "Web" mode: ten blue links, no AI overview, no enriched panels. It removes the clutter at the source rather than hiding it after paint, so nothing flashes in first and no selector can go stale when Google reshuffles its markup. Your Images, Videos and News tabs still work.

### Anti-tracking &amp; privacy
- Hard-block trackers and analytics (Google Analytics, DoubleClick, Facebook Pixel…).
- **Do Not Track &amp; Global Privacy Control** opt-out signals.
- **Third-party cookie blocking**, plus optional **wipe-on-close** and **no persistent cookies**. Across the web generally this is kept to tracking pixels and beacons on purpose &mdash; signing in sets cookies on frames and scripts, and stripping those signs you out &mdash; but on domains that exist only to measure you, it covers every kind of request, which is where those cookies actually are.
- **First-party tracker catching** (analytics proxied through a site's own domain), a **local, on-device tracker learner**, referrer trimming, and **De-AMP**.
- **Link hygiene** — strip `utm_` / `fbclid` params on copy, unwrap tracking redirects (`l.php`, `/url`, Reddit `out`).
- **Click-to-load social embeds** and **supercookie clearing**.
- **Remove a site's service worker when you leave** (opt-in) — a service worker is the one thing a site leaves running after you close the tab: it sits in front of every later request to that site and can wake up on its own. WardenOne records which sites install one, names them in the warning, and can remove it once you have closed every tab for that site. Off by default, because sites that legitimately use one for offline reading or notifications lose that until you visit again.
- **Cross-site cookie requests, made visible.** Anything embedded in a page — a comment box, a video player, an ad frame — can ask for its cookies back across sites through the one route browsers still allow, and until now nobody could see who asked. Every request is recorded with the name of whoever made it, requests from known trackers are refused outright, and anything asking while invisible or without you having clicked is flagged. Ordinary embedded sign-ins keep working, because this is the same mechanism they run on. A separate opt-in refuses every request instead — deliberately left out of both "Turn everything on" and Maximum Privacy, since turning it on is a choice to break embedded logins.
- **Header Shield** — third-party Client Hint reduction, optional strict cross-site referrer removal, and opt-in ETag protection limited to known tracker infrastructure. First-party, sign-in, CAPTCHA and payment paths stay excluded.
- **Login compatibility** — the reason the rest of this list doesn't lock you out. Hardened anti-tracking and overlay removal are exactly the things that break a sign-in: an SSO handoff looks like a cross-site redirect, an identity provider's POST looks like exfiltration, and a login modal looks like an overlay. Official sign-in, CAPTCHA and payment endpoints are exempted structurally rather than patched site by site, so Google, Microsoft, Apple, Okta, Auth0, PayPal and Stripe flows finish. On by default.
- **Cookie banners, three ways.** A banner can offer you a way to refuse, offer none at all, or get accepted by you — so there's one setting for each:
  - **It offers a refuse** → WardenOne takes it. Opens the choices if it has to, turns off optional tracking, never clicks Accept. On by default.
  - **It offers none** → the consent-or-pay sheet that covers the page and freezes scrolling gets lifted off. Nothing is clicked, so nothing is consented to and no consent cookie is written. Opt-in, because it can't always work: on a few sites the article was never sent to your browser at all, so WardenOne measures what's behind the wall and puts the wall back rather than leave you a blank page. Publishers who keep the wall on a separate domain are out of reach entirely. Built from a 101-site live test.
  - **You accepted it yourself** → the site's consent and tracking cookies, and the tracking IDs it stored, are cleared once you leave. Sign-ins are left alone.

### Anti-fingerprinting
- Per-session randomised canvas / WebGL / WebGPU / audio / hardware-hint noise.
- **One GPU identity across every surface.** WebGL and WebGPU are asked the same question by different APIs, and answering them differently is worse than answering neither: the contradiction is rarer than the truth, and it announces that something is rewriting one of them. Both come from a single per-session pick, and WebGPU adapter limits are reported as the spec-required minimums so every user of the shield looks alike rather than uniquely noisy.
- Detection of canvas / audio / WebGL / WebGPU / font / device probing, plus blocking of known fingerprinting scripts.
- **The newer measuring surfaces are answered too** &mdash; the list of fonts installed on your machine, the layout of every monitor attached to it, whether you have more than one at all, your keyboard layout, and the text-to-speech voices your operating system shipped with. Each is answered consistently with what WardenOne already reports elsewhere, because two different answers to one question identify you better than either answer alone.

### Script control — Script Shield
- Block scripts **everywhere** (lockdown) or **per-site**, NoScript-style, with a trusted-site allowlist and a fingerprinting-script filter.

### Popups, redirects &amp; overlays
- Block **forced popups / popunders** (timer-based `window.open`, hidden ad tabs).
- **Strict ad-popup shield**, on by default, for "download + ad tab" installer tricks without hijacking player controls or sign-ins.
- Remove **in-page overlays** — fake notification bells, subscribe walls, adblock nags, cookie / continue walls, download gates — with an Undo chip.
- **Auto-skip download-ad gates**, block **gestureless redirects**, detect **CPA redirect chains**, and stop **`<meta refresh>` bounces**.
- **Block popup and redirect tricks** — one switch over the three ways a page tries to take a click it can spend: fake "Please confirm to continue" prompts, script-built frames with no address of their own holding a bare INSTALL badge, and embedded players that move your whole tab when you click them. Real confirmations, payment forms, captchas and ordinary players are left alone.
- **Back-button traps, stopped rather than reported.** Scam and fake-alert pages fight the Back button three different ways, and all three are refused:
  - **Re-adding the page you're on** the instant you press Back, so Back never leaves. The first is allowed — a single re-add right after Back can be an app restoring a modal — and every one after it is declined.
  - **Stacking entries while you read**, so that by the time you press Back it has to be pressed once for every entry the page quietly buried the real one under. Beyond a small allowance, those are declined.
  - **Shoving you forward again** the moment you press Back, undoing it. Declined only inside the moment after Back, so a gallery's Next button still works.

  What separates a trap from an app you're using is whether anything you did asked for it: every ordinary interaction — click, key, scroll — vouches for the pushes that follow, so normal browsing is untouched. Nothing already in your history is changed or removed. Declining to *add* an entry is not the same as taking one away, and WardenOne never navigates you itself.

### Phishing &amp; scam protection
- **Look-alike / homograph blocking** — full-screen block on `g00gle`-style typos, wrong-TLD, and homographs.
- **Login-page age check** — warns when a password form sits on a brand-new domain (RDAP, no API key).
- **Insecure sign-in warning** — stops you the moment you click into a password box on an unencrypted page, *before* you've typed anything, and offers the secure version of the site. It also catches the sneakier case: a page showing a padlock whose form still posts over plain `http`. Router and other local-network logins are left alone.
- **Form-trap detector** — inspects login forms and warns when one looks fake or credential-stealing: it posts your password to a different site or a raw IP, claims to be a brand the site isn't, or is an injected overlay. Known sign-in providers are trusted, so real logins stay silent.
- **Behavioral risk detection** — flags brand-new sites that phone home or act like scams even when they're on no blocklist.
- **ClickFix command-paste guard**, a **tech-support-scam / browser-locker** neutraliser, **fake-update lure** detection, a script-drift guard, risky-site mode, anti-clickjacking, and warnings on redirecting &amp; shortened links.
- **Browser-in-the-Browser detection** — a page can draw a window inside itself, title bar and address bar included, and put its own sign-in form in it. No real window opens, so a popup blocker has nothing to block. WardenOne warns when a window-shaped box shows a domain the page doesn't own *and* offers somewhere to type a password. Online IDEs, design tools, ordinary login modals and the usual media hosts are left alone.
- **Full-screen address-bar protection** — in full screen the real address bar is gone, so a page can paint one of its own and ask for a password with nothing left to check it against. WardenOne warns when a page draws a domain it doesn't own at the top of the screen, and offers to leave full screen. Video, games, slideshows and maps are untouched.
- **Notification bait &amp; scam alerts** — the page talking you into clicking Allow, and the fake alerts those farmed permissions exist to deliver. The bait warning only fires while the answer is still open. Nothing is suppressed, and the wording is never stored — only which shape it matched. One honest limit: a notification raised from a service worker's push event is created outside the page, where a content script cannot reach it.
- **XSS Behavior Guard** — watches values arriving from the URL, `window.name`, `postMessage` and the referrer for ones that end up somewhere code actually runs, and records what it saw with a confidence and a severity. Local, never stores the matched value, and it does not claim to block XSS: page-originated findings are warning-only and can never create a blocking rule.

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
- Clean downloads from publisher-controlled sites and exact official installer hosts stay quiet. Shared cloud/CDN families are not trusted wholesale, and disguise tricks or known-malware signals always override publisher trust.
- Optional **domain-age checks** (RDAP / WhoisXML) and a **VirusTotal URL scanner**.

### Network &amp; IP protection
- **WebRTC IP-leak guard**, IP-grabber beacon blocking, logger-domain warnings (Grabify, IPLogger), **Force HTTPS**, and **bad-certificate** blocking.
- **Intranet / router protection** — public web pages can't silently reach your local admin panels (router, NAS, dev servers). Fetch, XHR, forms, beacons, sockets, scripts, frames and media are all covered, whether the page aims at your network by IP or by a name like `router.local`.
- **It holds inside background workers too.** The page-level guard rewrites what a page can call, and a worker gets its own private copy of those functions that no rewrite ever reaches — so a few lines in one could walk straight past it. Rewriting workers to fix that would break real sites (a strict CSP stops them loading, module workers lose the paths their imports resolve against, and a service worker cannot be rewritten at all). Instead the same refusal is enforced at the network layer, where a request looks the same whichever part of a page made it. Pages you opened from your own network keep full access to it.
- **DNS rebinding detection** — the case a hostname can't reveal: a perfectly normal-looking name that quietly resolves to *your* network. WardenOne watches the address each site actually resolves to, and when a public name comes back pointing at a private address — or answers publicly once and privately the next time, which is the signature of a rebinding attack — that name is blocked for the rest of the browsing session.
  Worth being straight about the limit: Chromium gives extensions no way to check an address *before* a request goes out, so the request that reveals the trick has already happened. This catches everything after it, not the first one. Direct local-network access is prevented; rebinding is detected. Pages you open yourself that live on your own network, like a local dev server, are left alone.

### Media &amp; device control
- **Media Shield** — block camera, microphone, screen-capture, and hidden background media. The microphone half covers **speech recognition** too, which reaches the mic without going through `getUserMedia` — so a page could listen while a guard that only hooks `getUserMedia` reported silence. Chrome also sends that audio away to be transcribed rather than doing it on your machine. Refusal takes the same path the browser takes when you click Block, so a page that handles a denied permission handles this.
- **Location-request blocking**, a **permission-chain guard**, and a **per-site permission scanner** (allow / block / ask for camera, mic, notifications, location).

### What WardenOne watches

Not everything worth knowing about is worth blocking. These three block nothing and change nothing on the page — Chrome already puts its own confirmation in front of each — so they aren't settings and there's nothing here to switch off. They write a line to your local Activity Center and that's all. They're listed because software that watches quietly without telling you is the thing this extension exists to oppose.

- **Background reports** — measurement moved from tracking pixels to background beacons, which go past on no blocklist and leave no trace. The destination is noted, once per page. What was sent is never read or stored.
- **Hardware and file access** — when a site asks to reach a USB, serial, HID, Bluetooth or MIDI device, or asks for a file or folder on your computer, and separately when it *comes back* to one you granted on an earlier visit. That second case needs no prompt, so it's the part that can happen while you're not looking. Folder access reaches furthest of any of them: `showDirectoryPicker()` can cover a whole tree, read or write, and the grant survives the visit — which is why *"pick your Downloads folder so we can scan it"* is a shape worth recognising. Chrome's own picker still decides. The device, the file and the folder are never recorded — only which kind of access it was, and whether it was read or write.
- **Browser capabilities** — four things that leave no other trace. Registering a **service worker** is the one that outlasts the visit: it stays after the tab closes and sits in front of every later request to that site. That is how offline and push notifications work, so it is ordinary — and it is also the one thing a page can leave behind, which is worth a line. A site asking to **install itself as an app** matters most: an installed site opens in its own window with no address bar, the same blind spot the fake-window and full-screen guards exist for. **Idle detection** tells a site when you're at your desk and when your screen is locked. **Chrome's payment sheet** is a route to card details the form-field guard can't see. Only which payment methods were offered is noted, never the amount or the item.

The master switch and the site allowlist still turn all three off along with everything else.

### Site data, session &amp; extension control
- **Forget Me &amp; Logins** — one toggle for "never let sites remember me": wipe a site's cookies and storage when you leave, so nothing keeps you logged in or recognises you next visit (allowlisted sites are kept), plus a one-click "forget this site now".
- **Emergency Logout**, a **Privacy Cleaner** (selective wipe), a **live per-site Session Security grade** (A–F: connection, JWT exposure, token storage, cookie security), and a local **Extension Security Centre**. It keeps a change timeline, checks exact extension IDs against a bundled on-device incident database, explains capability combinations, and binds “reviewed” to the exact current version and permission snapshot. Unknown is never called safe and broad access is never automatically called malware. Explicit controls can disable an extension or ask Chrome to confirm its removal.
- **Startup security check** — on browser launch, scans restored tabs and reconciles the installed-extension inventory without overwriting missed changes.
- **Settings backup** — export every toggle to a file and import it back on a reinstall or a new machine. Nothing syncs to a server and there's no account, so this is the only way you don't rebuild 140-odd settings by hand. API keys are never written to the file, and an imported file can't inject one.
- **On-demand site tools** — check a domain's age (RDAP), look it up against Have I Been Pwned, scan where a site stores login tokens, or open the full local extension reputation/access/change report.

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

### Right-click tools
Everything here sits under one **WardenOne** entry in the right-click menu, so nothing is buried in a settings page you have to go looking for.
- **Zap this element** — point at anything on a page and remove it. Sticky bars, cookie leftovers, a video that follows you down the page. Ctrl+Z takes back as many zaps as you like.
- **Copy clean link** — copies a link with the tracking stripped off. Links copied inside a page are cleaned automatically; this entry exists for Chrome's own *Copy link address*, which no extension can intercept. **Alt+Shift+C** does the same for the page you are on.
- **Block this site** — a hard block for a site you would rather not land on again, applied at the network layer so the page never loads. The same entry unblocks it, and it works from the error page too.
- **Check this link**, **Check the selected text**, **Where is this image from?** and **What is this frame?** — ask WardenOne what it knows about something before you click it: reputation, domain age, where a frame really comes from.

### Comfort &amp; extras
- **EyeShield** — a per-site display tuner with Normal / Light / Dark / **Ultra (OLED-black)** modes, plus brightness, contrast, saturation, warmth, and grayscale sliders, remembered per site.
- **Twitch Local Rewind** — scrub back through a live stream, or jump straight to the moment you joined.
- **Notification Centre** — every notice WardenOne can show you, in one place: what each one means, how long it stays on screen, and which ones you would rather never see again.
- **Update Guardian** — nudges you when your browser is behind on security patches.
- **Light and dark themes** across every extension page, switchable from the popup header, the Interface section, or during onboarding. Light mode keeps the original WardenOne look; dark mode is a flat purple-plum that keeps warning, status and disabled-control contrast readable rather than dimming everything equally.

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
but popups and badges stay hidden. **101 of the 104 protections have their own toggle**, and
any site can be allowlisted from the popup in one click. The other three have no toggle
because they only ever observe and never block — those are the ones under **What WardenOne
watches** above. The popup's own  panel counts the same 96, so the number here
and the number there are the same number.

**Per-site control, so one misread page doesn't cost you everything.** The allowlist
turns the whole engine off permanently, which meant a single guard misreading a single
site cost you either that guard everywhere or every guard there. Two narrower levers now
sit beside it in a **This site** panel: pause everything here for 15 minutes, an hour or
8 hours, and turn off *one* protection here. A site can only ever switch a protection
off, never on.

## Install

**From a release (no clone needed):**
1. Download [WardenOne-latest.zip](https://github.com/iri-dev/WardenOne/releases/download/latest-build/WardenOne-latest.zip) and unzip it. This rolling package is rebuilt after every passing update to `main`; it does not require a version bump for each commit.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the folder you just unzipped — the one with `manifest.json` directly inside it.

**From source:** clone this repository and load the project folder the same way.

Works in Chrome, Brave, Edge, and other Chromium browsers.

## Privacy

Everything runs locally in your browser. There's no remote proxy, no account, and no
telemetry — your browsing is never sent to a server we run. The optional lookups you
switch on yourself (download domain age, VirusTotal, breach checks) send only the
minimum: a source domain, a link you paste, or a hashed query — never your full
history. Login tokens and passwords are never stored or transmitted.

## How I work

What's here is the version I'm confident enough to put in front of people — finished,
checked, and running on real sites.

My local copy is where the mess lives: new ideas, half-built features, betas, and
things I'm still trying to break. It's often further along in raw code, but that doesn't
make it the better version. It's a workshop, not a release. This gets worked on
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

## Official source

**Website:** [iri-dev.github.io/WardenOne](https://iri-dev.github.io/WardenOne/) — the official site
for the project.

**Author:** [iri](https://github.com/iri-dev) (`iri-dev` on GitHub) —
[iri-dev.github.io](https://iri-dev.github.io/). WardenOne is written and maintained by one
person; those three links are the only places it comes from.

WardenOne is published **only** from [github.com/iri-dev/WardenOne](https://github.com/iri-dev/WardenOne).
Releases come from that repository and nowhere else. **It is a browser extension &mdash; it is never
an `.exe`, an installer or a setup program.** A copy of this project was once republished under
someone else's name with the downloads pointed at malware -- [what happened
](https://iri-dev.github.io/WardenOne/stolen).
Releases come from that repository's [Releases](https://github.com/iri-dev/WardenOne/releases) page and nowhere
else.

If you were sent here from another site, or offered a WardenOne download hosted somewhere
other than the link above, that build was not produced by this project. WardenOne holds
broad permissions by design — every one of them explained in `permissions.html` — and a
copy from an unverified source has all of them and none of the accountability. Check where
your download came from before installing it.

Copyright (C) 2026 iri. Licensed under the GNU GPL v3 or later; see
[LICENSE](LICENSE), [NOTICE](NOTICE) and [CREDITS.md](CREDITS.md). Redistributing a
modified copy is welcome — GPLv3 section 5(a) asks that you mark it as changed and keep the
notices intact.

## License

**GNU General Public License v3** — see [LICENSE](LICENSE).

WardenOne builds on the open-source blocking community. Sources are credited in
[CREDITS.md](CREDITS.md): AdGuard (YouTube rules), EasyList / EasyPrivacy (tracker
rules), and TwitchAdSolutions, scamorza/TwitchAdBlock, GosuDRM/TTV-AB, and uBlock
Origin uAssets (Twitch blocking).

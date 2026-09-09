<div align="center">

# WardenOne

### One extension. Every defense.

**A local-first browser security suite for scams, credentials, downloads, privacy, extensions, and the network beneath them.**

[![License: GPLv3](https://img.shields.io/badge/license-GPLv3-6f42c1.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2ea44f.svg)](manifest.json)
[![Download latest build](https://img.shields.io/badge/download-latest_build-e84393.svg)](https://github.com/iri-dev/WardenOne/releases/download/latest-build/WardenOne-latest.zip)
![Protections](https://img.shields.io/badge/protections-106-8e44ad.svg)
![No telemetry](https://img.shields.io/badge/telemetry-none-2ea44f.svg)
[![Report a bug](https://img.shields.io/badge/report_a-bug-e74c3c.svg)](https://github.com/iri-dev/WardenOne/issues/new/choose)

</div>

> [!WARNING]
> **Official builds only.** WardenOne is a browser extension, never an `.exe`, installer, or setup program. Download it only from [github.com/iri-dev/WardenOne](https://github.com/iri-dev/WardenOne). If you received another copy, read the [impersonation incident notice](https://iri-dev.github.io/WardenOne/stolen).

<p align="center">
  <img src="docs/onboarding.png" alt="Welcome to WardenOne" width="840">
</p>

> **One master switch. 106 protections. No account. No telemetry. Core protection runs locally on your device.**

WardenOne protects more than ads. It works across the browser's network, page, session,
download, storage, and extension layers: blocking known threats, spotting deceptive behavior,
protecting credentials and files, reducing tracking, and showing you the evidence behind its
decisions. Almost every protection can be controlled separately, and a problem on one site can
be handled without turning off protection everywhere.

Its guiding rule is simple: **do not claim more than the evidence proves**. An unknown extension
is not called safe. A clean-looking file is not called harmless. An unlisted search result does
not get a reassuring green tick. A privacy check WardenOne cannot honestly perform is marked
untestable, not passed.

**Built to be inspected:** [Privacy policy](PRIVACY.md) · [Permissions explained](permissions.html) · [Source](https://github.com/iri-dev/WardenOne) · [License](LICENSE)

## Quick install

1. Download [WardenOne-latest.zip](https://github.com/iri-dev/WardenOne/releases/download/latest-build/WardenOne-latest.zip) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode** in the top-right.
3. Select **Load unpacked**, then choose the unzipped folder containing `manifest.json`.

The rolling build is rebuilt after every passing update to `main`. You can also clone this
repository and load the project folder directly. WardenOne works in Chrome, Brave, Edge, and
other Chromium browsers.

## Find what you need

| I want to… | Go to |
| --- | --- |
| Understand the product quickly | [Protection at a glance](#protection-at-a-glance) |
| Check a suspicious download or file | [Downloads and files](#downloads-and-files) |
| Protect accounts, passwords, or payments | [Accounts, sessions, and credentials](#accounts-sessions-and-credentials) |
| Check another browser extension | [Browser and extension security](#browser-and-extension-security) |
| See whether privacy defenses really work | [Trust, but verify](#trust-but-verify) |
| Diagnose a broken site or blocked request | [Advanced filtering and network control](#advanced-filtering-and-network-control) |
| Understand the broad permissions | [Privacy and permissions](#privacy-and-permissions) |
| Install WardenOne | [Quick install](#quick-install) |

## Protection at a glance

| | Protection layer | What WardenOne covers |
| --- | --- | --- |
| 🛡️ | **Threats and scams** | Phishing, malicious sites, fake updates, ClickFix, deceptive browser UI, redirect traps |
| 🔐 | **Accounts and credentials** | Session tokens, form skimmers, payment cards, clipboard swaps, risky pastes, OAuth grants |
| 📦 | **Downloads and files** | Live download grading plus opt-in inspection of the actual bytes of local files |
| 👁️ | **Privacy and tracking** | Trackers, cookies, fingerprinting, email pixels, link decoration, first-party tracking |
| 🌐 | **Network and devices** | WebRTC leaks, IP loggers, intranet access, DNS rebinding, camera, mic, screen, location |
| 🧩 | **Browser extensions** | Installed-extension changes, capability review, incident records, pre-install ID checks |
| 🔎 | **Observe and verify** | Activity Centre, Protection Health, Privacy Self-Test, Verify & Repair, Network Logger |
| ⚙️ | **Precise control** | Site Firewall, My Rules, custom lists, Script Shield, temporary and per-protection site overrides |

## Why WardenOne

Staying safer online usually means stacking an ad blocker, anti-tracker, fingerprinting tool,
popup blocker, download scanner, script controller, and tab manager—then hoping their rules do
not fight each other. WardenOne brings those layers into one system and adds the phishing,
credential-theft, extension, and verification tools that ordinary content blockers leave out.

The result is not just a very long settings page. It includes dedicated interfaces for file
inspection, installed-extension review, privacy testing, activity history, network logging,
per-site firewall decisions, download review, and permission control.

Three ideas shape the whole product:

- **Evidence before reassurance.** “Nothing found” is never rewritten as “safe.”
- **Visible failure.** Unsupported custom rules, missing protection components, and uncertain verdicts are shown rather than silently ignored.
- **Narrow recovery.** Pause one site, disable one protection there, undo one firewall decision, or trace one blocking rule before resorting to a global switch.

---

## Security

### Threats, phishing, and browser scams

**Find it:** WardenOne → Advanced detection, Redirects & popups, and SessionShield.

- Hard-blocks known malware, phishing, scam, and IP-logger destinations before the page loads.
- Detects look-alike domains, digit substitutions, homographs, suspicious raw-IP pages, and password forms on newly registered domains.
- Warns before insecure sign-ins, including HTTPS pages whose form still sends a password over plain HTTP.
- Detects Browser-in-the-Browser login windows and fake address bars drawn after the real browser chrome disappears in full screen.
- Stops forced popups, popunders, gestureless redirects, ad-tab tricks, redirect chains, meta-refresh bounces, and repeated back-button traps.
- Detects fake update lures, tech-support browser lockers, fake notification prompts, clickjacking around sensitive actions, and ClickFix/self-XSS instructions that ask you to paste commands into Run, PowerShell, or DevTools.
- Watches suspicious source-to-code flows as **XSS behavior** without pretending that a browser extension can prove or universally block an XSS vulnerability.

<details>
<summary><strong>How WardenOne avoids breaking ordinary sign-ins, players, and navigation</strong></summary>

Login compatibility is structural rather than a growing list of one-off fixes. Official sign-in,
CAPTCHA, and payment routes are exempted so Google, Microsoft, Apple, Okta, Auth0, PayPal, and
Stripe-style handoffs can finish. Real confirmations and ordinary media players remain usable.

Back-button protection refuses repeated history manipulation; it does not delete existing history
or navigate for you. Redirect cleanup excludes requested destinations, landing pages, and anything
that resembles login or payment plumbing. On ambiguous cases, compatibility wins.

</details>

### Accounts, sessions, and credentials

**Find it:** WardenOne → SessionShield — login & session protection.

SessionShield is one of WardenOne's main security systems, not a footnote to ad blocking.

- **Session-token protection** detects tokens exposed in risky storage or URLs, watches for new tokens after login, and blocks token-shaped values from leaving for another domain. Full tokens are never shown or stored.
- **Form-skimmer protection** spots third-party scripts reading password or card fields and blocks Magecart-style off-site exfiltration, including request paths inside embedded frames.
- **Payment Card Guard** warns on suspicious, very new, reputation-flagged, or look-alike checkouts and blocks card submission on insecure, raw-IP, or known-dangerous forms.
- **Form Trap Detector** flags off-site form targets, raw-IP destinations, injected overlays, and pages impersonating a brand they do not own. It also catches hidden credential fields filled by browser autofill when no visible login explains them.
- **Clipboard protection** can stop a site replacing copied content, while paste-time swap detection compares recently copied and pasted cryptocurrency addresses—even when software outside the browser performed the swap.
- **Paste Protection** warns before a password, API token, private key, or seed phrase is pasted into an insecure or suspicious page.
- **OAuth Grant Guard** warns about risky Google, Microsoft, GitHub, and Discord consent combinations such as repository, contact, admin, or long-lived offline access.
- Optional tools include a noisy-but-explicit keystroke-pressure heuristic, honeytoken decoys, site breach history, and a Have I Been Pwned password check using k-anonymity: only the first five characters of the local password hash are sent.

The popup also gives the current site an A–F session-security grade and includes **Emergency
Logout**: clear this site's session data or sign out everywhere when compromise is suspected.

### Downloads and files

WardenOne uses two deliberately different tools because Chrome exposes two different kinds of
evidence.

#### Download Shield — while a file arrives

**Find it:** WardenOne → Download Shield.

Download Shield assigns an A–F grade from the source page, URL, filename, claimed type, Chrome
signals, publisher trust, and local threat lists. Known-bad downloads are blocked; risky ones are
held behind a review where you can cancel or continue. Official publisher-controlled hosts can
stay quiet, but shared cloud/CDN families are never trusted wholesale, and disguise or malware
signals always win.

Optional lookups can add domain age, Google Safe Browsing, VirusTotal, URLhaus, AbuseIPDB,
OpenPhish, PhishTank, or WhoisXML evidence. Each provider is separate, documented, and off until
you configure or enable it.

#### File Shield — inspect the actual bytes

**Find it:** WardenOne → Download Shield → Open File Shield.

Download Shield can only reason about downloads it watched. Chrome does not give extensions
arbitrary access to saved file contents, and re-fetching a download URL may return different bytes
for signed, personalized, or one-time links. File Shield fills that gap only when **you explicitly
hand it a local file**.

It reads without opening or running the file and reports:

- The real format from its bytes, exposing disguised extensions, double extensions, right-to-left name tricks, and padded filenames.
- Windows executable signatures, signer names, imported capabilities, packing, service installation, process launch, network reach, and process-injection indicators.
- Suspicious lines in batch, PowerShell, VBScript, JavaScript, and HTA files.
- The actual command behind a Windows shortcut.
- Archive indexes without extraction, including executables, path traversal, encryption, nesting, macros, and extreme expansion ratios.
- Office macros and PDF actions that can launch code, run scripts, or carry embedded files.
- A SHA-256 checked locally against WardenOne's bundled known-malware hashes.
- An optional VirusTotal check that sends only the hash using your own key—never the file or its name.

Multiple files and folders can be dropped together, and the report can be copied out. **File
Shield is not antivirus.** It does not monitor the filesystem, quarantine files, emulate behavior,
or declare a file safe. A clean result means its structural checks found nothing—not that nothing
bad exists.

### Network and device boundaries

- **WebRTC leak protection** reduces local-address exposure; IP-grabber hosts and beacons are blocked or warned about.
- **Force HTTPS** upgrades eligible connections, while certificate failures receive a clear interstitial.
- **Intranet protection** stops public pages reaching routers, NAS devices, local development servers, and other private-network targets through fetches, forms, frames, media, sockets, workers, or deceptively local-looking hostnames.
- **DNS rebinding detection** blocks a public hostname for the session after it resolves to a private address or changes from public to private. Chromium cannot expose the answer before the first revealing request, so WardenOne states the limit: direct intranet access is prevented; rebinding is detected after its first resolution.
- **Media Shield** covers camera, microphone, speech recognition, screen capture, and hidden background media. Location can be blocked separately.
- **Permission Chain Guard** warns when one site builds a risky combination—such as notifications followed by camera, clipboard, location, screen, or file access—instead of judging each prompt in isolation.
- The per-site permission scanner can set camera, microphone, notifications, and location to allow, block, or ask.

<details>
<summary><strong>Watch-only signals: important enough to record, not important enough to block</strong></summary>

Not everything worth knowing about deserves an automatic refusal. Three watch-only systems write
to the local Activity Centre and do not change the page:

- Background beacons that otherwise leave no visible trace. The destination is noted; the payload is not read or stored.
- Hardware and file access involving USB, serial, HID, Bluetooth, MIDI, XR, NFC, game controllers, files, or folders—including reuse of a grant from an earlier visit. WardenOne records the kind of access, never the selected device, file, folder, or controller model.
- Browser capabilities such as service-worker registration, app installation, idle detection, and Chrome's payment sheet. Payment methods may be named; the amount and item are not.

Chrome still owns the confirmation UI. These systems exist to leave an honest local record of
capabilities that can otherwise disappear without a trace.

</details>

### Browser and extension security

**Find it:** WardenOne → Privacy Cleaner → Review installed extensions.

#### Extensions already installed

The local **Extension Security Centre** inventories exact IDs, versions, enabled state, install
type, permission warnings, capability combinations, and access changes. Reviews bind to the exact
version and permission snapshot, so a later update cannot inherit an old reassurance. Known
incidents remain attached to the ID even after a rename. Controls to disable an extension or ask
Chrome to confirm removal run only after you press them.

Startup checks reconcile restored tabs and extension changes without erasing missed history.
Update Guardian separately warns when the browser itself is behind on security patches.

#### Before installation

Paste a Chrome Web Store link or 32-character extension ID into the pre-install checker. WardenOne
compares it with the same bundled incident and identity catalog without installing anything. An
optional button asks the Web Store for the listing name, sending only that ID and no browser
session.

**No record means unexamined, not cleared.** WardenOne cannot read an uninstalled extension's code
or permissions because Chrome does not expose them. If a listing is absent, it says “removed or
never existed” rather than guessing which.

---

## Privacy

### Tracking, cookies, and links

- Blocks known analytics and tracker infrastructure using bundled and automatically updated lists.
- Sends Do Not Track and Global Privacy Control signals.
- Supports third-party-cookie blocking, wipe-on-close, and no-persistent-cookie modes, with stricter coverage on domains that exist only to measure users.
- Detects first-party analytics proxies, can learn trackers locally, trims referrers, removes AMP wrappers, and uses click-to-load social embeds.
- Cleans known tracking parameters from copied links, search-engine redirect wrappers, hyperlink-auditing `ping` attributes, and address-bar changes made by single-page apps.
- Makes cross-site storage-access requests visible, refuses known trackers, and offers an explicit opt-in to block every request—with a warning that embedded logins and checkouts may break.
- Header Shield reduces third-party Client Hints and offers strict referrer and tracker-scoped ETag protection while excluding first-party, sign-in, CAPTCHA, and payment routes.
- Cookie tools can take a real Reject path, lift consent-or-pay overlays without fabricating consent, or clear consent/tracking state after you leave while preserving sign-ins.
- Optional cleanup removes tracker storage left by verified redirect hops and service workers left by sites after their last tab closes.

WardenOne removes only parameters it recognizes. Unknown values, paths, fragments, and application
state are left alone; an overconfident cleaner that destroys a search, checkout, or login is not a
privacy win.

### Mail Shield

Ordinary network filtering can miss email tracking pixels because providers such as Gmail proxy
remote images through their own trusted domains. Mail Shield works in the page instead: it recovers
the original image source when the webmail markup retains it and replaces a likely tracking pixel
with a transparent image of the same declared size.

It is registered only on Gmail, Outlook, Proton, Yahoo, Fastmail, Zoho, AOL, and Gandi—not on every
page you visit. It uses markup rather than waiting for rendered dimensions, because by then the
request may already have fired, and it also covers deferred `data-src` images.

**Honest limit:** a request already in flight may have sent some bytes; a provider that removes all
trace of the original source leaves less evidence; and server-side fetching is outside any browser
extension's view. Mail Shield reduces visible pixel tracking. It does not claim to stop every kind
of email tracking.

### Anti-fingerprinting

The opt-in anti-fingerprinting shield applies per-session noise or fixed shared answers across
canvas, audio, WebGL, WebGPU, hardware hints, installed fonts, screen layout, keyboard layout,
voices, and related measuring surfaces. WebGL and WebGPU draw from one consistent GPU identity;
contradictory answers across APIs would be a fingerprint of their own.

Media capability checks flatten whether supported codecs are smooth or power-efficient, but never
fake whether a codec is supported—claiming support could simply break playback. WebCodecs support
is observed, not altered. Bursts of capability enumeration are recorded separately from the
protection itself.

### Search protection and cleanup

WardenOne treats search as both a privacy surface and the last safe moment before a risky click.

**Cleaner search:** remove sponsored Google and Brave results and ad-click wrappers, hide optional
AI answer panels, switch Google to its own plain Web mode, or dim answer-scraper results with a
visible **Show anyway**. Scraper results are never silently deleted.

**Safety before the click:** Google, Bing, DuckDuckGo, Brave Search, and Yahoo results can be marked
when a destination is already known locally as malware, a scam, an IP logger, a look-alike, a raw
IP address, a site WardenOne previously blocked, or a recently registered domain whose age is
already cached.

- ⛔ means a direct malware/scam or IP-logger list match.
- ⚠️ means a suspicious signal that deserves inspection, not a guilty verdict.
- There is deliberately no green “safe” mark.

Nothing is hidden or reordered, and no search result is sent to a reputation service just to paint
a badge. When you want a network-backed check for one destination, use **Check this link** yourself.

---

## Control and transparency

### Trust, but verify

Most security tools ask you to trust a green switch. WardenOne gives you several ways to challenge
what the switch says.

| Tool | The question it answers |
| --- | --- |
| **Activity Centre** | What did WardenOne block, warn about, learn, or allow? |
| **Protection Health** | Are the expected protection components present and responding? |
| **Privacy Self-Test** | What can this particular page actually observe with the shields running? |
| **Verify & Repair** | If a component is missing on this tab, can WardenOne inspect and restore it? |
| **Network Logger** | Which request was blocked or allowed, and which rule or list decided? |

The Activity Centre keeps a compact, on-device history and the Notification Centre explains every
notice, how long it remains visible, and whether you want to see it again.

#### Privacy Self-Test

Each probe runs twice against the page in your active tab: once through WardenOne's protected view
and once through untouched browser APIs in the same document. “Protected” means the page received
a measurably different answer—not that a setting was merely enabled. A browser update that breaks
a patch makes the readings agree, and the test says so.

It measures canvas, audio, WebGL/WebGPU identity, hardware hints, displays, Client Hints, voices,
keyboard layout, media capabilities, local addresses through WebRTC, battery and connection data,
font access, game controllers, hyperlink auditing, and tracking parameters in links and the address
bar.

Verdicts are contextual: ✅ Protected · 🟢 Minimal exposure · 🟡 Partly protected · ℹ️ Allowed by
design · 🔴 Exposed. A protection you turned off is a choice, not a failed test. Checks requiring an
outside server are labeled **not testable here** rather than awarded an imaginary pass. Nothing
leaves the device, no STUN server is contacted, and temporary probe changes are restored.

If a switch says on but a page still receives the native value, **Verify & Repair** checks from the
inside and re-injects what is missing. Then the self-test can measure the result again.

### Per-site control

**103 of the 106 protections have their own toggle**. The other three are the watch-only systems
described above: they record an event but never block or alter a page, so there is no individual
blocking decision to switch.

For compatibility problems, the **This site** panel offers three levels of response:

1. Pause WardenOne here for 15 minutes, one hour, or eight hours.
2. Turn off one protection on this site only.
3. Permanently allowlist the site when that broader decision is genuinely intended.

A site override can only turn protection off, never silently enable something globally. Temporary
pauses do not discard a form by forcing an immediate reload.

### Advanced filtering and network control

**Find it:** WardenOne → Advanced → My filters, Network logger, or Site firewall.

| Tool | Role |
| --- | --- |
| **Network Logger** | Observe each request and the rule behind its outcome |
| **Site Firewall** | Decide what each loaded domain may do on this site |
| **My Rules** | Keep precise personal block, allow, and cosmetic rules |
| **Custom Lists** | Subscribe to maintained filter lists without waiting for a release |

The **Network Logger** records only while its page is open. It shows request type, first/third-party
status, initiator, outcome, and matching source, then can turn a row into a host, domain, path, or
allow rule. The in-memory buffer is capped at 1,000 entries and dropped when the last logger closes.
Tokens, keys, passwords, and address-like secrets are replaced with `[removed]` before capture; only
Export writes a log to disk.

The **Site Firewall** is a per-site matrix over every domain the current page loads. It can allow or
block scripts, requests, frames, media, or cookie-carrying traffic for that domain **on this site
only**. Your decision beats the shipped lists in that context, and undo is always available for the
current site or everywhere. It is powerful enough to break a page, which is why it is explicit and
reversible.

**My Rules** accepts familiar Adblock-style syntax such as `||ads.example.com^`,
`@@||example.com^`, and `example.com##.promo`. Unsupported lines come back with their line number
and reason. **Custom Lists** are HTTPS-only, reject private-address and strange-port redirects, keep
the last working copy after an update failure, and can be toggled or refreshed independently.

### Script Shield

Script Shield can block JavaScript everywhere, block it on one site, allow only trusted third-party
script hosts, or filter known fingerprinting scripts. Lockdown and smart modes are separate because
a security control should make clear whether it will stop the page outright or selectively limit
it.

---

## Content blocking and safety

### AdShield

- EasyList/uBlock-style network and cosmetic filtering with anti-adblock scriptlets.
- YouTube pre-roll and mid-roll removal by pruning the ad schedule from player data.
- Twitch ad handling with alternate local, Twitch-signed stream sessions—no third-party proxy. If Twitch provides no clean session, playback fails open instead of freezing behind a cover.
- Google and Brave sponsored-result cleanup, optional AI-panel hiding, answer-scraper markers, and Google's native plain-Web results mode.
- Element Zapper rules share the same cosmetic channel, so allowing a site's ads does not silently restore an element you personally chose to hide.

### Threat lists and cryptojacking

WardenOne ships vetted malicious-site, phishing, scam, tracker, ad, IP-logger, adult-warning, and
cosmetic data and can refresh supported feeds daily. A failed refresh keeps the previous copy rather
than opening a gap.

Drive-by mining scripts and third-party mining-pool connections are blocked while pool sites remain
reachable when you visit them directly. Optional deep detection inspects worker code for mining
routines and stops the worker, not the whole page. High CPU use alone is never called cryptomining:
video exports, WebAssembly builds, and miners can look identical from a utilization graph.

### Family and content safety

An optional adult-site arrival screen catches listed and heuristic matches, while gestureless adult
redirects can be blocked. SafeSearch enforcement for Google, Bing, DuckDuckGo, Brave Search, Yahoo,
and YouTube Restricted Mode is separate and off by default because it changes what results are
shown.

---

## Tools and extras

### Right-click and command tools

The **WardenOne** context menu can zap a page element, copy a cleaned link, block/unblock a site,
check a link or selected text, reverse-search an image, or identify the true source of a frame.

Press **Alt+Shift+W** to open the command palette and search for site checks, the privacy test,
element tool, clean-copy action, site pause, Network Logger, Site Firewall, File Shield, extension
checker, Activity Centre, or settings. Common actions use Chrome's native extension shortcuts and
can be rebound at `chrome://extensions/shortcuts`; pages cannot see or swallow them.

<details>
<summary><strong>Why the in-page command palette cannot grant itself authority</strong></summary>

The palette is display only. The background owns the action list and rejects unknown command IDs.
Sensitive actions require a palette-opening gesture on that exact tab, and the authorization is
consumed after one action. The UI is injected only when invoked and lives in a closed shadow root,
so the page cannot read what you typed or restyle the real control surface into something else.

</details>

### Data and recovery tools

- **Forget Me & Logins** clears a site's cookies and storage after its last tab closes, with allowlisted sites preserved.
- **Privacy Cleaner** selectively clears cache, consent/tracking cookies, all sign-ins, history, downloads, local storage, service workers, form data, or camera/mic/location permissions over a chosen time range.
- **Settings backup** exports every toggle without API keys and safely ignores unknown fields on import.

### Performance and comfort

- **Memory Shield** sleeps inactive tabs using Gentle, Balanced, Aggressive, or Emergency profiles, while protecting pinned, audio, form, login, and payment tabs. It can also find duplicate and zombie tabs.
- **Resource Saver** controls autoplay, background throttling, lazy images, prefetch, and preload.
- **EyeShield** remembers per-site Normal, Light, Dark, or OLED-black Ultra display modes plus brightness, contrast, saturation, warmth, and grayscale.
- **Twitch Local Rewind** lets you scrub backward through a live stream or return to the moment you joined.
- Light and dark themes apply across extension pages with status and warning contrast preserved.

---

## Interfaces

WardenOne is a suite of focused tools, not a single wall of switches.

<table>
<tr>
<td width="32%" valign="top">
<img src="docs/popup.png" alt="WardenOne control panel" width="100%"><br>
<strong>Main controls</strong><br>
Searchable protections, live site status, narrow overrides, and routes into the dedicated tools.
</td>
<td width="68%" valign="top">
<img src="docs/activity.png" alt="Local Activity Centre" width="100%"><br>
<strong>Local Activity Centre</strong><br>
What WardenOne blocked, learned, warned about, and allowed—kept on this device.
</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/site-blocked.png" alt="Dangerous site blocked" width="100%"><br>
<strong>Explain the intervention</strong><br>
Threat and certificate interstitials say why navigation stopped instead of leaving a mystery failure.
</td>
<td width="50%" valign="top">
<img src="docs/permissions.png" alt="Permissions explained" width="100%"><br>
<strong>Explain the reach</strong><br>
A plain-English map of each browser permission, why it exists, and where its use stops.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<img src="docs/network.png" alt="Network and DNS protection guide" width="100%"><br>
<strong>Know the boundary</strong><br>
WardenOne protects this browser; the built-in guide explains how DNS filtering can extend the safety floor to other apps and devices.
</td>
</tr>
</table>

## Privacy and permissions

WardenOne needs broad browser access because it protects broad browser surfaces: requests, pages,
downloads, cookies, sessions, site permissions, and installed-extension changes. That reach deserves
an explanation, not a slogan. The bundled [permissions guide](permissions.html) maps every requested
permission to its job and boundary, and [PRIVACY.md](PRIVACY.md) documents what is stored, what can
leave the device, and when.

The short version:

- There is no WardenOne account, telemetry, advertising identifier, developer-operated tracking backend, or remote browsing proxy.
- Core protection, activity history, learned tracker evidence, settings, file analysis, and extension reputation matching run locally.
- Login tokens and passwords are never stored or transmitted by WardenOne.
- Optional external lookups are individually controlled and send the minimum needed for the question: for example, a domain, a URL you explicitly check, an extension ID, or a hash/k-anonymous prefix—not your browsing history.
- File Shield never uploads a file. VirusTotal receives only a SHA-256 when you press the button and provide your own API key.
- Blocklist updates necessarily contact their documented list hosts; a failed update keeps the existing local copy.

## How WardenOne works

| Layer | Responsibility |
| --- | --- |
| **Browser network layer** | Declarative filtering, threat lists, request guards, redirects, downloads, and private-network boundaries |
| **Page layer** | Scam UI detection, credential and session guards, privacy API protection, link cleanup, and device-use signals |
| **Extension worker** | State, reputation evidence, list updates, activity history, browser APIs, and cross-tab decisions |
| **Local interfaces** | File Shield, Security Centre, Self-Test, Activity, Logger, Firewall, downloads, permissions, and recovery |

This layered design is also why some controls overlap without duplicating each other. Download
Shield sees browser context; File Shield sees file bytes. Activity records the event; Logger names
the request and rule. Self-Test measures from outside; Verify & Repair inspects from inside.

## How I build WardenOne

WardenOne is written and maintained by one person. The public branch is the version I am confident
enough to put in front of people; unfinished experiments stay local until they survive real-site
testing. Development is repetitive by design: edit, reload, hard-refresh, watch what the browser
actually does, and try to break the assumption again.

Every change passes `node tools/check-maintainability.js`, which checks syntax, generated-file
parity, and the project's test suites. When a real site proves an idea wrong, I would rather leave
the revert visible in history than rewrite the record into a cleaner story.

### The name

The **One** means one coordinated defense system across the browser's major security and privacy
layers—not one guardian that can stop every threat. No browser extension can promise that.

## Official source and authenticity

**Website:** [iri-dev.github.io/WardenOne](https://iri-dev.github.io/WardenOne/)

**Author:** [iri](https://github.com/iri-dev) (`iri-dev` on GitHub) · [iri-dev.github.io](https://iri-dev.github.io/)

WardenOne releases come only from [github.com/iri-dev/WardenOne](https://github.com/iri-dev/WardenOne).
It is never distributed as an executable installer. In August 2026, somebody republished the
project under another account and redirected its downloads to a credential stealer. GitHub removed
the account and site. The [incident page](https://iri-dev.github.io/WardenOne/stolen) records the
file details, antivirus verdicts, and recovery steps for anyone who ran the fake copy.

Because a browser-security extension holds meaningful permissions, source authenticity matters.
If a build came from another repository, file host, or website, it was not produced by this project.

## Feedback and bug reports

Found a site WardenOne breaks, or have an idea? [Open an issue](https://github.com/iri-dev/WardenOne/issues/new/choose).
For compatibility bugs, the site URL and the protection involved are the most useful starting
details. Security-sensitive reports should avoid posting live secrets, credentials, or harmful
payloads in a public issue.

## License and credits

Copyright (C) 2026 iri. WardenOne is licensed under the **GNU General Public License v3 or later**;
see [LICENSE](LICENSE), [NOTICE](NOTICE), and [CREDITS.md](CREDITS.md). Modified redistribution is
welcome under the license, with changes marked and notices kept intact.

WardenOne builds on the open-source blocking community, including AdGuard, EasyList, EasyPrivacy,
TwitchAdSolutions, scamorza/TwitchAdBlock, GosuDRM/TTV-AB, and uBlock Origin uAssets. The complete
source and attribution list is in [CREDITS.md](CREDITS.md).

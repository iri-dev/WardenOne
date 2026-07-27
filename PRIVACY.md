# WardenOne — Privacy Policy

**Last updated: July 21, 2026**

WardenOne is a browser security extension that protects you against phishing, malware
downloads, redirect chains, IP grabbers, trackers, token theft, bad certificates, and
risky sites. This policy explains exactly what data WardenOne touches, where it stays,
and the few cases where information leaves your device.

We wrote this to be honest about scope rather than reassuring. If anything here is
unclear, contact us (see **Contact** below).

---

## The short version

- **WardenOne has no servers of its own and no analytics.** It does not track you, does
  not send us your browsing history, and does not have user accounts.
- **By default, all protection runs on your own device.** Nothing about the pages you
  visit is transmitted anywhere.
- **We never sell, rent, or share your data**, and we do not use it for advertising.
- The only times data leaves your device are: (1) downloading public block-lists to keep
  protection current, (2) an **opt-in** password-breach check that uses privacy-preserving
  k-anonymity, and (3) **opt-in** reputation look-ups that you must switch on and supply
  your own API key for. Each is described in detail below.

---

## Data stored on your device

WardenOne saves the following in your browser's local extension storage
(`chrome.storage.local`). This stays on your computer, is **not** synced to a cloud
account by WardenOne, and is **not** uploaded to us:

- Your settings and which protections are enabled.
- A local activity log of what WardenOne blocked or flagged (for the popup and the
  Activity/History page).
- Download-review records for the Download Guard.
- A short-lived reputation cache and "learned" risky-domain list, so repeat checks are
  faster and work offline.
- Any API keys you choose to enter for optional reputation providers (stored locally so
  the extension can authenticate to the provider you enabled).

The opt-in Twitch local rewind feature makes short, high-bitrate clips of video and audio
already playing in the current tab and keeps up to five minutes in volatile browser
memory. The clips are used only for the in-player replay, are never uploaded or saved to
disk by WardenOne, and are discarded when the channel, page, or tab closes. To control
memory use, the oldest clips may be discarded before five minutes on unusually high-
bitrate streams.

**Deleting this data:** Removing WardenOne from your browser deletes its local storage.
You can also reset settings from the options page, and the "Forget this site" and
"Clean browsing data" tools remove data on demand.

---

## When information leaves your device

### 1. Block-list updates (on when a blocking feature is on)

To keep ad/tracker/malware/phishing blocking current, WardenOne periodically downloads
**public filter lists** from their maintainers, for example EasyList, AdGuard filter
lists, Phishing.Army, the urlhaus/malware-filter list, and the OpenPhish public feed
(fetched from `raw.githubusercontent.com`). These are ordinary downloads of rule files —
**your browsing history is not sent**; the list host only sees the normal network request
(including your IP address, as with any website you load). No personal data is attached.

### 2. Password breach check — "SessionShield" (opt-in, off by default)

If you turn this on and check a password, WardenOne hashes the password **locally** with
SHA-1 and sends only the **first 5 characters of that hash** to Have I Been Pwned's
`api.pwnedpasswords.com` range API. This is the industry-standard *k-anonymity* method:
the service returns a list of matching hash suffixes and the comparison finishes on your
device. **Your password and its full hash never leave your device.** This feature is
disabled unless you enable it.

### 3. Reputation providers (opt-in, off by default, your own API key required)

WardenOne can optionally check a URL, domain, or file hash against third-party threat
services **only if you enable that provider and supply your own API key**. All of these
are **off by default**: Google Safe Browsing, VirusTotal, urlhaus (abuse.ch), AbuseIPDB,
OpenPhish, PhishTank, WhoisXML, and RDAP (domain age). When you enable one, the specific
URL/domain/hash being evaluated is sent to that provider so it can return a verdict.
Those providers are independent data controllers with their own privacy policies; review
theirs before enabling. WardenOne sends nothing to them until you do.

**That is the complete list.** WardenOne contacts no other external endpoints, and there
is no background telemetry, crash reporting, or usage analytics.

---

## Permissions, in plain terms

WardenOne requests broad browser permissions because on-device security requires them.
None are used to collect data about you. A per-permission justification is published with
the store listing; in summary:

- **Read/observe pages and network requests** (`declarativeNetRequest`, `webRequest`,
  `webNavigation`, `scripting`, `activeTab`, `<all_urls>`) — to block malicious requests
  and detect redirect chains, grabbers, and unsafe navigations, on any site. Network
  request observation is read-only.
- **Downloads** — to inspect and, when risky, pause/cancel a download (Download Guard).
- **Cookies / content settings / browsing data** — to power cookie handling, per-site
  JavaScript/location controls, and the user-initiated "Clean browsing data" and
  "Forget this site" tools.
- **History** — used only by "Forget this site" to remove entries for a domain you choose;
  WardenOne does not continuously read or transmit your history.
- **Management** — to **list** your installed extensions and flag newly added or
  high-risk ones for your review. WardenOne cannot and does not disable, install, or scan
  other extensions; it only shows you what is there.
- **Tabs / tab groups / alarms / notifications / storage** — for the toolbar badge, the
  startup safety check, the Memory Shield (sleeping idle tabs), scheduled list updates,
  security alerts, and saving your settings locally.

---

## Data we do **not** collect

WardenOne does not collect or transmit: your browsing history, page contents, form data,
keystrokes, credentials, cookies, location, or any personally identifiable information.
There is no advertising, no data brokerage, and no third-party tracking introduced by
WardenOne.

---

## Children

WardenOne is a general-audience security tool and is not directed at children under 13.
It does not knowingly collect any personal information from anyone.

## Changes to this policy

If this policy changes materially, we will update the date above and the version
published with the store listing. Continued use after an update constitutes acceptance.

## Contact

Questions or privacy requests: **[insert your public contact email or support URL]**

---

*WardenOne is provided as a protective tool and does not guarantee detection of every
threat. It supplements, and does not replace, safe browsing habits.*

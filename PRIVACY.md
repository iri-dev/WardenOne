# WardenOne — Privacy Policy

**Last updated: August 30, 2026**

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
- **By default, no protection sends any outside party information about the pages you
  visit.** Every default-on feature either runs entirely on your device or talks only to
  hosts the page you are viewing has already contacted itself.
- **We never sell, rent, or share your data**, and we do not use it for advertising.
- The only times data leaves your device are: (1) downloading public block-lists to keep
  protection current, (2) re-requesting third-party scripts a page has already loaded, so
  they can be checked for tampering — on by default, and it reaches no host the page has
  not already used, (3) an **opt-in** password-breach check that uses privacy-preserving
  k-anonymity, (4) an **opt-in** login-page age check that sends a site's domain to a
  public registration-data service, and (5) **opt-in** reputation look-ups that you must
  switch on and supply your own API key for. Each is described in detail below.

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
- The installed-extension inventory, change timeline, exact-version review snapshots,
  and any exact-ID reputation records you deliberately import. The bundled extension
  reputation database is read from WardenOne's own package; installed extension IDs
  are not sent to a reputation server.
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

### 2. Script tamper check — "Script Drift Guard" (on by default)

Pages routinely load scripts from other companies, and one of the commonest ways a
trusted site starts attacking its visitors is that one of those scripts is quietly
swapped. To notice that, WardenOne re-requests **third-party scripts the page has
already loaded**, hashes them, and compares the hash with what it saw before.

The important detail for your privacy: every one of those requests goes to a host **the
page itself just used**, so no company learns anything it did not already know from you
loading the page. Scripts served by the site you are visiting are skipped entirely,
nothing about the request is sent anywhere else, the hashing and comparison happen on
your device, and only the hash is kept. Re-checks are rate-limited and capped per page,
and allowlisted sites are skipped. Turn it off with **Script drift guard** in the popup.

### 3. Site breach history check (opt-in, off by default, no API key needed)

This checks **a website's own public breach record** — not your account, and not any password
of yours. It tells you whether the site you are on has been breached in the past, so you can
decide how much to trust it with.

Nothing is sent until you click. With **Breach & site-history checks** enabled, pressing
**Check breach history** in the popup sends the site's **registrable domain only** — `example.com`,
never the full address, never the page path or query, never anything from the page itself — to
`haveibeenpwned.com`. Have I Been Pwned will also see your IP address, as it would for any
request your browser makes.

The reply is cached **on your device** for **12 hours**, so revisiting a site does not re-send
anything. That cache holds at most **120 domains**; the oldest entries are dropped past that.
Clearing WardenOne's data removes it.

### 3b. Password exposure check (manual, you press the button, no account involved)

Session Shield has a **Check password exposure** box. Nothing watches what you type into web
pages; this only ever sees what you type into that one box, when you press that one button.

An earlier version of this policy described a password lookup that **no part of the interface
could reach**. That dead code was removed rather than wired up, and this section replaces it —
documented before the feature ships, as the previous version of this policy promised.

What leaves your device is **five hexadecimal characters**, and nothing else:

1. The password is hashed with SHA-1 **on your device**.
2. The **first five characters** of that hash are sent to `api.pwnedpasswords.com`.
3. That service returns **every** hash suffix in that bucket — hundreds of them, for hundreds
   of thousands of unrelated passwords.
4. Your browser compares them **locally** and finds out whether one is yours.

This is Have I Been Pwned's *k-anonymity* range protocol. The service cannot tell which of the
returned hashes you were asking about, and cannot reconstruct the password from a five-character
prefix. The full password and the full hash never leave the machine.

The request is sent **without cookies and without a referrer**, and asks for a **padded**
response, so the size of the reply does not narrow down which prefix was requested.

The result is shown on screen and **written nowhere** — not to history, not to storage, not to
the badge. Close the popup and there is no record of it. WardenOne never learns your password,
and never learns whether you have one that was breached beyond the moment it tells you.

Your **email address is never sent anywhere.** The account-search side of Have I Been Pwned
needs an authenticated key and transmits the address itself; WardenOne does not use it.

### 4. Login page age check (opt-in, off by default, no API key needed)

A login form on a domain registered days ago is one of the strongest phishing signals
there is. If you switch this on, then **when a page shows a password field** WardenOne
sends that site's registrable domain — `example.com`, never the full URL, never the page
contents, never what you type — to the public RDAP service at **`rdap.org`**, and uses
the registration date it returns to warn you before you sign in.

This is the one feature that tells an outside party something about where you browse,
which is why it is **off by default** even though it needs no API key and costs nothing.
rdap.org sees the domain and your IP address, as any site you load would. Answers are
cached on your device (most recent 100 domains) so the same site is not looked up twice;
requests for IP addresses and private or local hostnames are never sent at all. Turn it
on or off with **Login page age check** in the popup.

### 5. Reputation providers (opt-in, off by default, most need your own API key)

WardenOne can optionally check a URL, domain, or file hash against third-party threat
services **only if you enable that provider**. All of these are **off by default**: Google
Safe Browsing (`safebrowsing.googleapis.com`), VirusTotal (`www.virustotal.com`), urlhaus
(`urlhaus-api.abuse.ch`), AbuseIPDB (`api.abuseipdb.com`), PhishTank
(`checkurl.phishtank.com`), and WhoisXML (`www.whoisxmlapi.com`,
`domain-reputation.whoisxmlapi.com`, `threat-intelligence.whoisxmlapi.com`).

Most of those require you to supply your own API key. **OpenPhish is the exception**: it is
used through its free public community feed, which needs no key, and it is fetched as a
whole list from `raw.githubusercontent.com` rather than by asking about your URL — so no
address of yours is sent to it. An earlier version of this policy said every provider
required a key, which was not true of OpenPhish. When you enable one, the specific URL/domain/hash
being evaluated is sent to that provider so it can return a verdict. Those providers are
independent data controllers with their own privacy policies; review theirs before
enabling. WardenOne sends nothing to them until you do.

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
- **Management** — to **list** installed extension IDs, versions, permissions, install
  type and enabled state for the local Extension Security Centre. WardenOne compares
  exact IDs with its bundled on-device incident database and watches meaningful access
  changes. It cannot read or scan another extension's source package. It disables or
  requests Chrome-confirmed removal only when you press that extension's explicit
  button; it never installs, disables, or removes another extension automatically.
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

## Chrome Web Store Limited Use

WardenOne's use and transfer of information received from Google APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the **Limited Use** requirements.

Concretely, and in the same terms that policy uses:

- User data is used **only** to provide or improve the single purpose stated in the listing —
  protecting the person using the browser.
- User data is **not** transferred to third parties except where a person has explicitly
  enabled an optional reputation or breach provider, at which point the request goes to the
  provider they chose. Those providers are independent data controllers.
- User data is **never** transferred or used for advertising, ad targeting, personalisation,
  credit assessment, or lending.
- No human reads user data. There is no server to read it on; nothing is transmitted to the
  developer at all.

WardenOne uses no Google account sign-in and requests no OAuth scopes. Google Safe Browsing
is an optional, off-by-default lookup that a person enables with their own API key.

---

## Children

WardenOne is a general-audience security tool and is not directed at children under 13.
It does not knowingly collect any personal information from anyone.

## Changes to this policy

If this policy changes materially, we will update the date above and the version
published with the store listing. Continued use after an update constitutes acceptance.

## Contact

Questions or privacy requests: open an issue on the project's issue tracker —
**<https://github.com/iri-dev/WardenOne/issues/new/choose>**

The issue tracker is the support channel for WardenOne. It is public, so please do not
post anything you would not want visible; if a privacy request needs private details,
say so in the issue and we will arrange another route.

---

*WardenOne is provided as a protective tool and does not guarantee detection of every
threat. It supplements, and does not replace, safe browsing habits.*

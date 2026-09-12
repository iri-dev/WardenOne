# WardenOne — Privacy Policy

**Last updated: September 11, 2026**

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
  public registration-data service, (5) **opt-in** reputation look-ups that you must switch
  on yourself — and which, once on, **send the addresses of pages you open** to the
  provider automatically, which is why they are off by default and described in full
  below — (6) three things you start by pressing a
  button — the site breach check, the extension checker, and the network filtering
  self-test, **which deliberately requests a favicon from named adult and malware-test
  domains and can therefore show up in DNS or filter logs** — and (7) Twitch's own API,
  while you are on Twitch, for the ad-blocking and rewind features. Each is described in
  detail below, and the full list of hosts is there rather than here.

---

## Data stored on your device

WardenOne saves the following in your browser's local extension storage
(`chrome.storage.local`). This stays on your computer, is **not** synced to a cloud
account by WardenOne, and is **not** uploaded to us:

- Your settings and which protections are enabled.
- A local activity log of what WardenOne blocked or flagged (for the popup and the
  Activity/History page). Addresses in it are kept as site and path only — never the query
  string, and with anything in the path that looks like a token blanked out — because the
  query is where sign-in codes and reset links carry their secrets.
- **Warning-page hand-off records, held in memory for as long as they are needed.** When
  WardenOne stops a navigation — a forced redirect, a blocked page, a certificate failure —
  the warning page has to know the exact address so it can show you where you were going
  and take you there if you choose to continue. That address is kept in the browser's
  *session* storage (memory only, gone when the browser closes), filed under a random
  handle that is the only thing the warning page's own address carries. It is deleted the
  moment you continue, dropped when the tab closes, and expires after six hours regardless.
  An earlier version put the full address into the warning page's URL instead, which meant
  it went into browser history and session restore for as long as the tab lived. It no
  longer does. The related redirect-chain memory, used to explain a download that arrived
  through a chain, keeps only counts, the sites crossed and a fingerprint of the final
  address — not the address — for ten minutes.
- Download-review records for the Download Guard: the file name, the grade and its reasons,
  and the source address in the same form the activity log keeps — scheme, host and a path
  with token-shaped parts starred, never the query string — for up to two hours, at most 25
  at a time. The exact address is not kept by WardenOne; it stays in Chrome's own download
  list. An earlier build kept the full address, signed download links included.
- The startup safety check's report: for each open tab it flagged, the host and the reason —
  never the page title — for 24 hours. In a private window the report is kept in memory only
  and is gone when the window closes; it never reaches the normal profile.
- A short-lived reputation cache and "learned" risky-domain list, so repeat checks are
  faster and work offline.
- **Two records that describe where you have been, and it is fairer to call them that.**
  The tracker learner notices a third-party domain following you around, and to decide
  whether to *suggest* blocking it — it never blocks one on its own; you approve each
  suggestion in the popup — it has to remember which of your sites it appeared on — up to
  80 sites per tracker, with a count and a last-seen time. The Script Drift check keeps a record per third-party
  script it has examined, filed under a hash of the script's address rather than the
  address itself. Neither is sent anywhere and neither is readable by a website. But a
  list of "this tracker was seen on these sites of yours" is browsing history in
  everything but name, so it is listed here as one. You can clear both with **Clean
  browsing data**, and Script Drift records expire on their own after 30 days.
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
**public filter lists** from their maintainers. These are ordinary downloads of rule
files — **your browsing history is not sent**; the list host only sees the normal network
request (including your IP address, as with any website you load). No personal data is
attached.

Those downloads reach eight hosts, and this is all of them:
`raw.githubusercontent.com`, `filters.adtidy.org`, `easylist.to`,
`easylist-downloads.adblockplus.org`, `phishing.army`, `malware-filter.gitlab.io`,
`pgl.yoyo.org` and `ublockorigin.github.io`. An earlier version of this policy named four
of them behind a "for example", which is not a disclosure. Every individual list, its
maintainer and its exact URL are published in
[`docs/source-inventory.json`](docs/source-inventory.json), which is **generated from the
list constants in the code** rather than written by hand, so it cannot quietly fall behind
what WardenOne actually fetches.

### 2. Script tamper check — "Script Drift Guard" (on by default)

Pages routinely load scripts from other companies, and one of the commonest ways a
trusted site starts attacking its visitors is that one of those scripts is quietly
swapped. To notice that, WardenOne re-requests **third-party scripts the page has
already loaded**, hashes them, and compares the hash with what it saw before.

The important detail for your privacy: every one of those requests goes to a host **the
page itself just used**, so no company learns anything it did not already know from you
loading the page. Scripts served by the site you are visiting are skipped entirely,
nothing about the request is sent anywhere else, and the hashing and comparison happen on
your device. Re-checks are rate-limited and capped per page, and allowlisted sites are
skipped. Turn it off with **Script drift guard** in the popup.

**EyeShield** (off by default) makes the same kind of request for a different reason: to
recolour a page it needs the text of stylesheets the page loaded from other hosts, which a
content script cannot read across origins, so the worker re-requests them without
credentials — again only from a host the page itself just used, never from a private
network address, and the stylesheet text goes nowhere but that tab. Earlier versions of
this policy did not mention it.

**What it keeps, exactly.** For each third-party script it has checked, WardenOne stores a
record describing *the script* — its content hash, its size in bytes, the behaviour
indicators found in it, the outbound hosts written inside it, how many times it has
changed, and when it was last seen and last checked. The record is filed under a hash of
the script's address rather than the address itself, so the stored file is not a readable
list of what your browser has fetched. Records are dropped after 30 days without being
seen, and at most 700 are kept.

**What it does not keep:** which of *your* sites a script appeared on. An earlier version
recorded up to eight first-party sites per script. Nothing ever read them, but together
they amounted to a map of where you had been, so they are gone — and any that an older
version already saved are deleted the first time the check runs after updating.

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
required a key, which was not true of OpenPhish.

**Be clear about what switching one on means.** These are not buttons you press per site.
Once a provider is enabled, WardenOne asks it about pages **as you navigate to them**, on
its own, for the whole time it stays enabled. Earlier wording here said "the specific
URL/domain/hash being evaluated is sent", which was true and still left the wrong
impression. Precisely:

- **Google Safe Browsing** and **urlhaus** receive the address of every page you open, as
  **scheme, host and path** — `https://example.com/some/page`. The query string (everything
  from `?` on), the `#fragment` and any user name in the address are removed before the
  request is made, and the address is cut at 1,500 characters. The path is kept on purpose:
  a phishing page on a shared host is identified by its path, and a blocklist entry for it
  is useless without one. That means a secret carried *in the path* — the token in a
  password-reset link — does still travel; one carried in the query does not. Over a
  browsing session, the list of pages you open is still a substantial part of your
  history, held by someone else. An earlier version of this policy said the query was sent
  too, and it was.
- **PhishTank** and **WhoisXML** are held back during ordinary browsing and only fire when
  the address itself looks like a sign-in, payment or redirect page (words like *login*,
  *verify*, *billing*, a `@` in the host, a cheap risky suffix, a `?redirect=` parameter —
  the query is read on your device to make that decision, then removed), or when you
  explicitly ask about a link. PhishTank and WhoisXML Threat Intelligence then receive the
  same scheme, host and path; WhoisXML's domain age and domain reputation checks receive
  the registrable domain only. An earlier version of this policy said WhoisXML received the
  domain only, and its threat-intelligence check did not.
- The right-click **Check with WardenOne** sends the same form — the address you selected,
  without its query string — and the notice says so when something was cut.
- **AbuseIPDB** is only consulted when a site is reached by bare IP address, and receives
  that IP.
- **VirusTotal** is only used by File Shield's button, and receives a SHA-256 file hash,
  never the file.
- **OpenPhish** receives nothing, as described above.

Answers are cached on your device so the same address is not sent twice — under a
fingerprint of the address rather than the address itself, for between five minutes and
twelve hours depending on the provider and the answer, so the cache is a lookup table and
not a list of where you have been. `legal.twitch.tv` is the one address excluded
outright. Those providers are independent
data controllers with their own privacy policies; review theirs before enabling. WardenOne
sends nothing to any of them until you do — and every one of them is off until you do.

### 6. Check an extension before you install it (you press the button)

When you paste an extension's ID or Web Store link into the extension checker, WardenOne
asks the Chrome Web Store (`chromewebstore.google.com`) for that listing's public page —
with no cookies attached — to learn whether the listing still exists and what name it
carries. Everything else about that check is answered from a list bundled inside
WardenOne. Nothing is sent unless you ask for the check, and what is sent is the
extension's ID, never anything about you.

### 7. Network filtering self-test (you press the button)

The **network test** page answers "is something on this network already filtering my
browsing?" by trying to load a favicon from a handful of sites and seeing which fail. You
have to open that page and start the test; nothing here runs on its own.

**Please read this one before using it.** To tell *what kind* of filtering is in place, the
test requests a favicon from two well-known adult sites
(`www.pornhub.com`, `xvideos.com`) and one malware test host
(`testsafebrowsing.appspot.com`), plus two controls to prove the network is up at all
(`www.google.com`, `www.cloudflare.com`). Nothing is rendered and no page is opened. But
these are real network requests: they can appear in DNS logs, in your router or your
employer's or school's monitoring, and in a family filter's report — the very systems the
test exists to detect. On a network where that matters to you, do not run it.

### 8. Twitch requests, on Twitch only

Two Twitch features talk to Twitch's own API at `gql.twitch.tv`, and only while you are on
a Twitch page:

- **Twitch ad blocking** asks for the stream's playback token the way the player does, so
  it can request an ad-free variant of the stream. To be accepted, that request carries
  the same `Authorization` header the Twitch page itself is already using — read from the
  page, sent only back to Twitch, and never stored or sent anywhere else. Cookies are not
  attached (`credentials: 'omit'`).
- **Twitch rewind** asks whether the channel you are watching has an in-progress recording
  of the live broadcast, so it can open it at the point you joined. That request sends the
  channel name and no credentials at all.

Twitch already knows you are watching Twitch, which is why this is listed as a request
rather than a disclosure of anything new. Both features are described in the popup and
both can be turned off there.

**That is the complete list of external endpoints WardenOne contacts.** Everything above
is either a public filter list, a check you switched on, or a button you pressed. There is
no background telemetry, no crash reporting, no usage analytics, and nothing whatsoever is
sent to WardenOne's developer — there is no WardenOne server to send it to.

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
- **Tabs / alarms / notifications / storage** — for the toolbar badge, the
  startup safety check, the Memory Shield (sleeping idle tabs), scheduled list updates,
  security alerts, and saving your settings locally.

---

## Data we do **not** collect

WardenOne sends nothing to us. We do not collect your browsing history, page contents, form
data, keystrokes, credentials, cookies, location, or any personally identifiable
information, and there is no server of ours that could receive them. There is no
advertising, no data brokerage, and no third-party tracking introduced by WardenOne.

That is a different statement from "nothing leaves your device", and the two are kept
apart on purpose. By default, nothing about the pages you visit leaves your device. The
exceptions are the ones you switch on yourself — an enabled reputation provider is sent
the address of every page you open, as scheme, host and path, for as long as it stays on
(section 5) — and the checks you start by pressing a button (sections 6 to 8).

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

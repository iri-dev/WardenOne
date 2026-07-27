# WardenOne — Chrome Web Store submission notes

Copy the text below into the matching fields of the Web Store developer dashboard
(**Privacy practices** tab). Everything here is grounded in the actual v1.0.0 code.

> **Do not ship this file (or PRIVACY.md) inside the packaged .zip** — they are for the
> listing/hosting, not the runtime. Also exclude the Chrome-generated `_metadata/` folder
> from the package.

---

## Single purpose (one sentence)

> WardenOne is a browser security tool that protects the user from web-based threats —
> phishing and look-alike sites, malicious or unwanted network requests and trackers,
> dangerous downloads, redirect and tab-under abuse, IP-grabber links, session/token
> theft, and unsafe certificates — by inspecting pages, requests, and downloads locally
> and warning or blocking when something is dangerous.

---

## Permission justifications

Paste each into that permission's justification box.

**declarativeNetRequest** — Core blocking engine. Static and dynamic rules block known
malicious, tracking, ad, and IP-grabber requests without reading request contents. This
is the primary protection mechanism and runs entirely on-device.

**scripting** — Injects WardenOne's on-page protections (phishing/grabber detection,
redirect and clickjacking guards, payment-field protection) and registers some features
dynamically only when the user enables them, to minimize overhead.

**activeTab** — Lets popup actions (e.g., "check this site", per-site controls) act on the
page the user is currently viewing, without standing access to other tabs.

**webRequest** — Used in **observe-only** mode (no blocking) to detect server-side
redirect chains and certificate/network errors so the extension can warn about redirect
abuse and bad certificates. The extension does not request `webRequestBlocking`.

**webNavigation** — Detects navigations, redirects, and tab-under behavior so redirect
chains and forced navigations can be recognized and, where risky, interrupted with a
warning.

**downloads** — Powers Download Guard: inspects a download's filename, type, and source to
score risk, and can pause, cancel, or remove a download the user confirms is dangerous.

**cookies** — Supports third-party-cookie handling, the cookie "reload-loop" escape (only
after a user click), and per-site cookie cleanup. Cookie values are not transmitted
off-device.

**contentSettings** — Applies per-site controls the user sets, such as blocking JavaScript,
geolocation, or cookies for a specific site.

**browsingData** — Backs the user-initiated "Clean browsing data" tool; only runs when the
user chooses what to clear and confirms.

**history** — Used solely by the "Forget this site" tool to remove history entries for a
domain the user selects. WardenOne does not continuously read or transmit browsing history.

**management** — Lists the user's installed extensions and flags newly installed or
high-risk ones for the user to review. WardenOne **cannot and does not** disable, install,
modify, or scan other extensions — it is read-only surfacing for the user's own review.

**tabs** — Reads tab URLs/titles for the per-tab safety badge, the startup safety check
(restored tabs on risky domains), and the Memory Shield.

**tabGroups** — Lets the Memory Shield group and sleep idle tabs to reduce memory use.

**alarms** — Schedules background maintenance: daily block-list refresh, the Memory Shield
sweep, and the startup safety check.

**notifications** — Shows security alerts (e.g., startup findings, blocked dangerous
downloads) so the user is informed when action was taken.

**storage** — Saves the user's settings, local activity log, and caches on-device. Nothing
in storage is uploaded by the extension.

---

## Host permission justification

**`<all_urls>`** — Web threats (phishing, look-alike login pages, IP-grabber links,
malicious redirects, trackers) can appear on any website, so the on-page protections and
request-blocking rules must be able to run on every site the user visits. Access is used
only for local threat detection and blocking; page contents are not collected or
transmitted.

**Specific API hosts** (`safebrowsing.googleapis.com`, `virustotal.com`,
`api.pwnedpasswords.com`, `haveibeenpwned.com`, `rdap.org`, `api.abuseipdb.com`,
`checkurl.phishtank.com`, `urlhaus-api.abuse.ch`, the `*.whoisxmlapi.com` hosts, and the
OpenPhish feed on `raw.githubusercontent.com`) — Allow the background worker to reach
**optional, off-by-default** reputation/breach services and to download the OpenPhish
public feed. These are only contacted when the user enables the relevant feature (and, for
the reputation providers, supplies their own API key).

---

## Data usage disclosures (verify before certifying)

These are attestations **you** are legally making — confirm them yourself; when in doubt,
disclose rather than under-report. Based on the code:

- **Data collected by the developer:** none. WardenOne has no servers and no analytics;
  nothing is transmitted to us. Processing is on-device.
- **The three required certifications** appear to hold and can be checked:
  - *Not selling/transferring data to third parties outside approved use cases* — yes.
  - *Not using/transferring data for purposes unrelated to the single purpose* — yes.
  - *Not using/transferring data for creditworthiness/lending* — yes.
- **Judgment call — "Website content" / "Web history" categories:** WardenOne reads page
  content and URLs **locally** for protection and does not send them to the developer. The
  opt-in reputation features transmit a specific URL/hash to a **third-party service the
  user chose and keyed**, and the opt-in breach check sends a 5-char password-hash prefix
  (k-anonymity) to Have I Been Pwned. If the review requires disclosing these opt-in,
  user-initiated, third-party transmissions, describe them exactly as the privacy policy
  does. Leaning toward disclosure here is the safer path.

**Privacy policy URL:** host `PRIVACY.md` (e.g., GitHub Pages, a gist, or your site) and
paste the public URL into the dashboard's Privacy policy field.

---

## Also do before submitting

- Exclude `_metadata/` (Chrome-generated) and this file + `PRIVACY.md`/dev docs/`tools/`
  from the packaged `.zip`.
- Consider softening "Elite defense…" in the manifest description — the Web Store
  discourages unverifiable superlatives; a factual phrasing (e.g., "Strong, on-device
  defense against…") reviews more cleanly.

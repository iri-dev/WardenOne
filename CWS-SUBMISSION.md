# WardenOne — Chrome Web Store submission notes

Copy the text below into the matching fields of the Web Store developer dashboard
(**Privacy practices** tab). It was written against v1.0.0 and `main` has moved on
since, so re-read the permission list in `manifest.json` before pasting any of it.

> **A Web Store package is not the GitHub release zip.** The release zip is built with
> `git archive` and deliberately keeps `PRIVACY.md`, `LICENSE`, and `CREDITS.md` for
> people loading it unpacked. A store submission wants neither this file nor
> `PRIVACY.md` inside the package — the policy is hosted at a URL instead — and must
> also exclude the Chrome-generated `_metadata/` folder.

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
`haveibeenpwned.com`, `rdap.org`, `api.abuseipdb.com`,
`checkurl.phishtank.com`, `urlhaus-api.abuse.ch`, the `*.whoisxmlapi.com` hosts, and the
OpenPhish feed on `raw.githubusercontent.com`) — Allow the background worker to reach
**optional, off-by-default** reputation/breach services and to download the OpenPhish
public feed. `haveibeenpwned.com` receives a site's registrable domain only, and only on an
explicit click, to look up that site's public breach record. WardenOne has no password
checker and contacts no password-hash service. These are only contacted when the user enables the relevant feature (and, for
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
- **"Website content" and "Web history" — tick both.** An earlier draft of this checklist
  treated these as optional because most processing is local. That reasoning does not match
  current guidance: the store defines *handling* as collection, transmission, **use** or
  sharing, and its User Data FAQ is explicit that local-only handling still has to be
  declared on the Privacy practices form. Declaring is not an admission that anything is
  sent anywhere; the form asks what the extension handles, and the policy explains where it
  stays. Under-declaring here is the one mistake that is hard to undo.

### Field-by-field inventory

Handled **on the device only** — never transmitted anywhere:

| Data | Why it is handled | Where it goes |
|---|---|---|
| Page URLs | Phishing, redirect-chain and scam checks | Stays on device |
| Page content / DOM | Overlay cleaning, cosmetic filtering, form-field guards | Stays on device |
| Form field values | Token-exfiltration and credential-theft checks | Stays on device; never stored |
| Request metadata | Tracker, ad and fingerprint-script blocking | Stays on device |
| Activity history | The Activity Log the user can read and clear | `storage.local`, capped at 200 entries, query strings stripped |
| Downloaded-file metadata | Download safety grading | Stays on device |

Transmitted **only after an explicit opt-in**, and only to the provider chosen:

| Data | Trigger | Recipient |
|---|---|---|
| A site's registrable domain | Clicking **Check breach history** | `haveibeenpwned.com` |
| A URL, domain or file hash | Enabling that reputation provider | Only the enabled provider |
| A domain | Enabling the login-page age check | `rdap.org` |

Nothing in either table reaches the developer, because there is no server to reach.

- **Limited Use affirmation:** required on the extension's privacy page, and now present —
  see the *Chrome Web Store Limited Use* section of `PRIVACY.md`. It must stay there; the
  dashboard checks the hosted page.

**Privacy policy URL — paste this into the dashboard's Privacy policy field:**

> <https://iri-dev.github.io/WardenOne/PRIVACY>

GitHub Pages serves it from `main`, so the hosted page IS `PRIVACY.md` — there is no
second copy to drift out of date. Edit the file, push, and the URL updates itself.

---

## Screenshots

`docs/store/` holds all seven at exactly **1280×800**, which is one of the two sizes the
Web Store accepts (the other is 640×400). The originals in `docs/` are various shapes and
none of them are a valid size, so upload from `docs/store/`, not `docs/`.

Each was scaled to fit and centred, never upscaled, and the padding is filled with that
screenshot's own corner colour so it blends instead of showing a border. The listing takes
up to five; `popup.png`, `site-blocked.png`, `onboarding.png`, `redirect.png` and
`permissions.png` cover the most ground.

`docs/` is `export-ignore`d, so none of this reaches the packaged `.zip`.

---

## Small promotional tile

`docs/store/promo-440x280.png`, at exactly **440×280** — the size the Web Store asks for. It uses
the product's own gradient (`#b06fd6` → `#e07aae`, the same 135° sweep as the popup's primary
button) and the shipped `icons/icon128.png`, so the tile reads as the same thing a user sees after
installing rather than as separate marketing art.

Regenerate it with the script in the scratchpad if the branding changes; the title size is fitted by
measuring the text, not hard-coded, because a hard-coded 52px clipped "WardenOne" to "WardenO".

The white-on-gradient wordmark is the same WCAG AA shortfall recorded as **L16** and accepted for
the UI. It is defensible here for a different reason: the tile is decorative store furniture, and
the name appears as real text in the listing beside it, so nothing depends on reading it off the
image.

---

## Also do before submitting

- Exclude `_metadata/` (Chrome-generated), this file, `PRIVACY.md`, and the dev
  docs/`tools/` from the packaged `.zip`. The `export-ignore` rules in
  `.gitattributes` already drop the dev docs and tooling; `_metadata/` and
  `PRIVACY.md` are the two you still have to remove by hand for a store package.
- Re-read the `description` field in `manifest.json` before submitting. The Web Store
  discourages unverifiable superlatives, so it reviews more cleanly when every claim
  is something the extension demonstrably does.

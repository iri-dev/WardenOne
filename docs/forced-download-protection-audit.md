# Forced Download Protection

27 October 2026. Independent, default-on `forcedDownloadProtection` control; protection 110.
The manifest version remains unchanged.

## Decisions and boundaries

- `bridge.js` observes genuine click, keyboard and context-menu events in the isolated world.
  Synthetic events and page messages cannot create a trusted gesture. A hidden `download`
  attribute is not a visible download request.
- Recognisable attached file links without a download request, hidden controls, and active files
  behind unrelated controls are intercepted before their default navigation. A closed-shadow
  review offers Download once or Cancel. Product-name mismatch is a review heuristic restricted
  to cross-origin active-file links on download detail pages with meaningful product and filename words.
- The worker associates downloads with bounded recent browser-observed requests, then queries
  the source frame directly. It checks the source URL, document timing and effective settings.
  Concurrent ambiguous sources and replaced documents do not authorize an intervention.
- Without a request association, an exact referrer matching one open tab can identify the source.
  Missing or ambiguous context fails open. Extension-initiated and address-bar downloads are
  excluded from intent enforcement. Other Download Shield checks retain their existing policy.
- The source document retains the last gesture. The worker keeps at most 128 request and download
  contexts in memory. Intent checks send no data to reputation services. A held review uses the
  existing review store, including its separate private-window session store and retention.
- Filename changes are checked after creation, including after the first scan. Intent-only reviews
  remain actionable with Download Shield off; their evidence and source host survive worker memory
  loss. Confirmed malware findings retain precedence. User continuation prevents later re-pauses.
- Global pauses, allowlist pauses and feature-specific site exceptions are checked by both owners.
  A late configuration change is re-read before an early pause. Filename suggestions are released
  exactly once with a one-second deadline; a review never holds the suggestion callback indefinitely.

## Verification

`tools/test-forced-downloads.js` covers trusted and synthetic events, hidden attributes, misleading
controls, mismatch review and explicit allowance, exports, independent switches, site exceptions,
replaced documents, extension downloads, late filenames, worker-memory loss and bounded associations.
It runs in the maintainability gate alongside the existing download safety and compatibility suites.

`tools/browser-forced-downloads.js` uses harmless dummy files and a temporary Edge profile. Verified
on Edge 150.0.4078.48: attached synthetic file links and unrelated installer links stop before a network
request; automatic navigation, detached download links and installers behind Play are held for review;
direct downloads, redirected CDN downloads and CSV blob exports complete; disabling the new switch
disables both layers independently of Download Shield.

A live YouTube watch page loaded with the extension enabled. Its native player remained unpaused
with readyState 4 and advanced from 1.67 to 12.08 seconds during a 10.33-second sample.

## Gizmodo entry regression

The reported page exposed a separate defect in Auto-skip download ads. On a fresh visit to
`https://gizmodo.com/download/gta-vi`, the partner script inserted a hidden `#box-c2l-modal`.
Its nested `#download-modal[data-campaign-id]` contained Avast installer links before the
original-download continuation. The engine selected a sponsor link using the broad
`a[href*="download"]` fallback and navigated without a user click. The network initiator stack
identified `content.min.js`; the isolated intent check detected the file only after it started.

Auto-skip now records an actual visible download-link click, checks a visible gate for the exact
requested URL, and rechecks that intent before the scheduled navigation. It does not guess a
destination from sponsor links or automatically click an unverified continuation control.
This repairs existing functionality and does not add another counted protection.

`tools/test-download-auto-skip-intent.js` checks hidden and visible unrequested offers, synthetic
and modified clicks, sponsor links, mismatching destinations, the intended continuation and a
disabled scheduled action. The browser regression includes the hidden sponsor structure and
verifies both inert page entry and successful continuation of the explicitly requested link.

Live checks of the reported URL in fresh Edge 150.0.4078.48 and Brave (Chromium 156.0.8078.48)
profiles loaded the partner offer and recorded zero installer requests and zero downloads after
the fix. The Brave check used normal native download behavior with save prompts enabled.
Windows dialog inspection was stopped because Computer Use could not verify the browser URL;
these results establish the absence of a download attempt, not a visually verified picker result.

## Limits

The isolated listener cannot intercept a click on an unattached element or every script-driven
navigation. The browser backstop runs after download creation: bytes may arrive first, a tiny file
can finish before the pause, and a native Save As dialog may still appear. Existing reviews report
failed pauses and completed files without claiming they were stopped.

Headless Edge fixtures do not verify native Windows picker suppression. Chrome and Brave picker
behaviour has not been verified. Unobserved navigation, stripped source information, delays and
arbitrary deceptive product names remain gaps. Expired gesture context fails open. A recent real
action alone permits ordinary documents; active files require a recognisable download action.
This is local intent correlation, not a proof of user intent or a malware verdict.

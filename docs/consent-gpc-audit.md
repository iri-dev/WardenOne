# Ghostery G-03: consent outcomes and GPC

## Consent actions and evidence

`consent-reject.js` retains the isolated-world heuristic fallback, compatibility
exclusions, safe-link checks, explicit accept/reject decision-pair checks and
bounded mutation scanning. The disabled MAIN-world consent click paths remain
disabled. The new `consent-state.js` dependency supplies reviewed CMP profiles and
bounded cookie parsers; it loads before the isolated consent script in both
registered and catch-up injection paths.

An action progresses from attempt to dispatch, then a terminal outcome:

- A thrown `.click()` is **failed**, returns false and cannot establish rejection.
- A successful `.click()` establishes only dispatch. Terminal actions stop scans
  immediately; bounded timers check saved state at 0, 100, 400, 1,200 and 2,500 ms.
- **Rejected** means the recognized manager's saved cookie changed after the
  action and describes required-only/optional-off state in a supported format.
- A dispatch without that evidence is **unverified**, even if the banner vanished.
- Opening settings is **dispatched**, without claiming an opt-out.

Activity records `consent_outcome` with a fixed action, status, CMP name and evidence
type. It neither retains the clicked label nor raw consent values. The event never
increments the blocked badge. A saved manager state does not establish that every
third-party script honors it; this evidence is limited to the recorded choice.

Only OneTrust `OptanonConsent`, Cookiebot `CookieConsent`, and TrustArc
`notice_gdpr_prefs` are examined for the matching known flow. Cookie input is capped
at 32 KiB, the selected value at 4 KiB, with single decoding and duplicate rejection.
OneTrust requires an enabled C0001 group, at least one optional group, and zero for
every represented optional group. Cookiebot requires all four explicit Boolean
categories with only `necessary` true; its flat object parser does not evaluate code,
accept duplicate keys, or interpret flag text embedded in strings. TrustArc accepts
only the documented required-only zero state, with the supported region suffix.
Unknown/custom/missing categories or unchanged pre-existing state stay unverified.

Primary format references:

- [OneTrust saved state and update events](https://developer.onetrust.com/onetrust/docs/single-page-applications)
- [Cookiebot category definitions](https://support.cookiebot.com/hc/en-us/articles/360003783574-Customizing-the-cookie-categories)
- [TrustArc technical specification and saved preferences](https://trustarchelp.zendesk.com/hc/en-us/articles/53492086194963-Cookie-Consent-Manager-Technical-Specifications-Guide)

## Procedures and compatibility

Profiles use explicit known containers, reject controls, settings controls and save
controls. Every control still passes the existing visibility, strong-consent,
safe-link and protected-context gates. Generic matching remains available for
customized banners. Optional toggles count as changed only after they visibly turn
off; saved-choice flows wait until remaining non-required toggles are off. Pending
changed choices survive a late save button. Cookiebot's selection-save control is
allowed only after disabling optional choices, never as an accept-all action.

Password, one-time-code and card-input containers are hard vetoes, alongside the
existing sign-in/payment/account/security origin and wording guards. Necessary
categories remain enabled. No CMP global API or arbitrary page function is invoked.
Normal page handlers may process the dispatched choice, as with a manual action.

Added open-shadow hosts can wake scanning. Discovered roots receive the same
bounded-lifetime observer as the document. Two bounded discovery passes (800 and
4,500 ms) cover roots attached without document mutations; the existing startup,
late-surface and scan-lifetime limits remain. Closed roots and unrecognized custom
flows can remain unverified or untouched. No claim covers every vendor version.

Turning the feature off revokes verification timers by generation; disposal cancels
them. History and privacy erasure broadcast an extension-internal reset while the
history writer is revoked, so a pending page check cannot republish an erased action.
This introduces no new settings, stores, permissions or remote service.
Missing, failed or malformed effective-config replies stand down instead of
activating default consent actions. Existing explicit legacy Boolean values remain
accepted; a valid subsequent settings message can resume scanning.

The opt-in consent-wall remover now requires readable content as well as height
for short pages. Tall empty layouts and unreadable content restore the original
wall and scrolling state, then stand down. Existing short headline-heavy pages
with real text remain supported. Wall removal still does not create consent.

## GPC surfaces and scope

`privacy-signals.js` supplies a small page-world preference installer. The worker
registers it in MAIN at `document_start`, including frames, only while privacy
signals are on. The registered site's exclusion list includes active user pauses,
allowlisting and `sendPrivacySignals:false` overrides. Open documents are updated
through document-ID-targeted MAIN injection after a setting change.

Disabling signals restores original descriptors only where WardenOne still owns
them. A native browser preference or later page-owned descriptor is preserved.
The public JavaScript preference is a site-facing signal, not a security attestation
or authority for extension actions. The worker installer has no privileged page API.

The old fixed-true engine getters are removed. A pair of atomically replaced DNR
rules covers every resource type: navigation uses destination exclusions, while
subrequests use initiating-document exclusions. This avoids suppressing an active
page's signal merely because it requests an exempt host. Each embedded document
uses its own hostname policy, matching registration and initiator scope. Global
pause disables both surfaces. Existing browser-provided signals can remain when
the extension feature is off.

Rule IDs are 900000 for subrequests and 900008 for document navigation; the existing
900007 tracker-cookie owner is preserved. The budget suite now requires distinct
reserved IDs. Site-scope changes rebuild even when the global Boolean is unchanged;
the component cache uses the resolved active allowlist so expiring pauses are honored.
Rejected DNR writes remain retryable and do not commit a successful cache key.

Signal-header priority is 100001, above generated request allowances. Allowing a
request does not disable the separately configured privacy preference. The GPC
toggle and compiled document exclusions still control both surfaces. Native login
and YouTube navigation probes cover compatibility allows; a temporary explicit
request allowance is also tested without changing shipped request-allow rules.
The firewall precedence assertion still covers every other rule owner; the signal
suite additionally requires this high-priority owner to contain only the two
fixed preference-header operations, with no block, redirect or allowance action.

The background synchronizes registered scripts and headers; new navigation after
that reconciliation is the document-start contract. A signal a page read before a
setting change cannot be retracted. Native tests inspect the first inline script,
not just the settled value. Supported MAIN registration requires the existing
Chromium scripting API; registration failure reports a degraded component.

## Verification

`tools/test-consent-outcomes.js` exercises state parsing, click failure, dispatch
without saved state, changed saved opt-outs, and pending-work revocation.
`tools/test-privacy-signals.js` exercises descriptors, native restoration, document
scope, registration, atomic replacement and failure retries. Existing consent,
wall, pause, state-serialization, site-scope and layout coverage stays in the gate.
The hot-path suite now checks the shared terminal action instead of counting four
duplicated finish calls; it still verifies observer/timer shutdown and one shared
root collection across all searches.

`tools/browser-consent-gpc.js` uses frozen runtimes and fresh disposable profiles.
Controlled fixtures reproduce known controls and documented cookie formats; they
do not load a vendor SDK or establish universal live-site compatibility. They check
saved cookies while banners remain, late loading, open roots, settings/save,
unverified disappearance, sensitive-dialog exclusion and history erasure. GPC
checks compare the first inline script with the actual HTTPS receiver across on,
off, pause, allowlist, site override and resume, plus iframe scope and real MP4
playback. Reports and hashes are indexed in `docs/consent-gpc-evidence.json`.

No version bump, commit or push is included in this phase. Protection count stays 110.

## Completed verification

Finalized on October 28, 2026. The final implementation passes all **338 suites**,
including source/build parity, consent, privacy erasure, rule allocation, firewall
precedence, compatibility, licensing and package checks. All 143 current runtime
files match the frozen browser-tested input.

**Edge 150.0.4078.48** and **Chrome 121.0.6167.184** each pass seven native check
groups. These include four saved-state consent flows and nine GPC navigation
states: enabled, disabled, paused, allowlisted, site override, resumed, login
compatibility, media compatibility and an explicit request allowance. The receiver
and first inline script agree. Pending verification is revoked on history erase,
and the controlled MP4 loads and plays through the established trusted-media host.

The accepted input is `tmp/ghostery-phase03/snapshot-08/wardenone`, with runtime
fingerprint `7a3067a311aef1597cc32a2a10f68c7e99c6d6dc0f0047a85a4a75a32bcc4731`.
Accepted native reports are `verified08-edge.json` and `verified08-chrome.json`;
the full gate is `gate-final-verified.log`, all under `tmp/ghostery-phase03/`.
Final source/runtime archives are recorded under `tmp/ghostery-phase03/final-review/`.
Their runtime fingerprint must equal the accepted input. The evidence index records
the current sources, harness, reports and gate hashes.

The runtime is 11,331,611 bytes with the original 28,369 static rules; its staged
ZIP is 2,440,083 bytes and remains inside the unchanged reviewed limits. Configuration
still has 147 fields and the storage inventory still has 101 keys. No new toggle,
permission, external feed or persistent dataset was added. The real Git index is
unchanged; nothing was committed or pushed.

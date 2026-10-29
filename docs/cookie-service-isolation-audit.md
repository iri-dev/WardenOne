# Service-cookie isolation — 29 October 2026

The path exemptions and header-only finding below are superseded by the
[stateful cookie comparison](cookie-stateful-parity-audit.md). This document
retains the earlier measurements.

The previous login/payment destination exemption exposed cookies on resources
whose operation did not require them. The current implementation removes both
`Cookie` and `Set-Cookie` on reviewed service resources. It closes all four
original fixture gaps against Privacy Badger in five runs on each of Chromium
121 and Edge 156. This is measured header-cookie parity on this corpus, not an
overall cookie-privacy win.

The [evidence summary](cookie-service-isolation-evidence.json) records package
identities, raw-report hashes, outcomes and validation. The WardenOne 1.0.2 runtime
fingerprint is
`2886d939a80b155e5acfc25abd690a61de503db60172b25d289005725d9f4504`.
Privacy Badger is the pinned official MV3 package, version 2026.9.15.2, fingerprint
`ffab75b34ed8976740d1e0b983dd584404ba2af233191cb586ea2a2755521a06`.
The source/runtime archives were reviewed before testing. Browser-generated
`_metadata` is excluded from runtime identity. Work remains local.

## Scope and exceptions

The existing default-on **Block third-party cookies** setting owns these rules.
No permission, toggle, version or protection-count change is introduced.

| Reviewed hosts | Stateful exceptions for frames, XHR and other requests |
| --- | --- |
| accounts.google.com, accounts.google.co.uk | /gsi/, /o/oauth2/, /signin/, /ServiceLogin, /ListAccounts, /CheckCookie |
| js.stripe.com | /v3/ |
| checkout.stripe.com | /c/pay/ |
| accounts.spotify.com | /authorize, /login |
| m.stripe.com, q.stripe.com, m.stripe.network, connect.facebook.net, gstatic.com | None |

Paths ending in `/` permit descendants. Other paths match only that endpoint or
its query/fragment boundary. Case changes, encoded names and lookalike suffixes
do not gain exceptions. Public scripts, styles, images and other non-state
resource types lose cookies even on these paths. These host and route choices
are local reviewed policy, not a claim that every request on them is tracking.
Unknown providers retain existing compatibility policy.

Google documents loading its public client from `/gsi/client` and the `/gsi/`
frame/connect family in its [integration setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
The client script is stripped while stateful frame/connect routes remain
available. Stripe's [privacy and security explanation](https://support.stripe.com/questions/privacy-and-security-of-stripe-js?locale=en-GB)
describes fraud-related device signals; removing telemetry cookies can reduce
those signals even when the payment UI loads. Cookie preservation is not proof
that those identifiers are necessary for a transaction.

Own service-family contexts, top-level navigations, established media
workarounds, site pauses and per-site cookie exceptions retain cookie flow.
On browsers exposing `RuleConditionKeys.EXCLUDED_TOP_DOMAINS`, service-family
and site exclusions follow the actual top frame. Older browsers use initiator
domains, which can preserve cookies on a service's own nested requests. The
[DNR reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
documents the native condition capability. Edge exercised the top-frame path;
Chromium 121 exercised the fallback. A site exception affects subsequent native
requests immediately, without a page reload.

## Repeated browser results

The loopback HTTPS server records whether the seeded cookie arrived. Native
cookie storage is inspected after each response. Extension-off profiles allow
third-party cookies and must send/store every test cookie, preventing browser
defaults from receiving credit. Missing requests require native block or verified
local replacement evidence; they are not counted as cookie stripping.

Each browser ran five repetitions of off, WardenOne and Privacy Badger against
14 cases: 420 resource observations across both browsers.

Eight resource cases have no cookie dependency. Two additional original frame
cases deliberately require a cookie at unreviewed `/resource` paths; both
extensions strip them and their synthetic contract fails. Calling all ten cases
nonessential would overstate what this fixture establishes.

| Case group | WardenOne | Privacy Badger |
| --- | --- | --- |
| Four original identity/payment resource and frame cases | Both cookie directions removed in every run | Both removed in every run |
| Six added public-client, telemetry, SDK and static cases | Both removed in every run | Five stripped; Facebook SDK blocked |
| Three explicitly cookie-dependent reviewed state-path frames | Cookies preserved; fixture contract succeeds | Cookies stripped; fixture contract fails |
| Unknown resource control | Cookies preserved | Cookies preserved |
| Direct Google/Stripe session visits | Session fixtures succeed | Session fixtures succeed |

The state-path frames are deliberately cookie-dependent synthetic contracts.
Their result demonstrates the policy tradeoff; it is not evidence that Privacy
Badger breaks real login or payment. It also means Privacy Badger remains more
aggressive on these paths. No raw stripping-count advantage is claimed.

A further five-run Edge comparison included the same warmed Ghostery default
profile used in the earlier rematch, version 10.6.7, fingerprint
`8b312cdc7e2c06b7ec021c5350c223bb3ef414d543d3336c5d841a1eb78bcd1d`.
WardenOne and Privacy Badger reproduced the results above. Ghostery blocked the
Stripe telemetry fixture and sent/stored cookies in the other seven
cookie-independent resource cases. WardenOne removed header cookies in all
eight. Blocking the telemetry request also prevents its other payload from
leaving; this result is a cookie-header comparison, not an overall tracker
blocking win over Ghostery. The four-arm report contains 280 observations and
records native blocks separately. All three extensions retained direct-session
functionality in these fixtures.

`browser-tracker-cookies.js` separately passed 46 candidate scenarios in each of
five runs on each browser: 460 candidate checks. They cover real popup/Settings
toggle handlers, service cookies, known trackers, confirmed aliases, redirects,
own-service sessions, media exclusions, firewall precedence, immediate site
exceptions, master-off, rejected native updates and browser restart. Its earlier
runtime reference passed ten applicable scenarios per run.

## Native cost and recovery

The complete cookie owner installs 105 rules, including 97 small regex rules,
within the existing 301-rule reservation. Dynamic/session quota reservations do
not increase. No page request triggers a JavaScript classifier or external DNS
lookup. Regex support is checked before an atomic native replacement; failed
classification, unsupported expressions or rejected writes retain the previous
validated policy and permit a retry.

The rejected first implementation used large alternations. Chromium 121 reported
`memoryLimitExceeded`; that preflight remains under
`tmp/cookie-gap-2026-10-29/preflight-chrome.json`. The final implementation emits
small trie-path mismatch expressions and passed both native engines. Tests also
check exact path boundaries and 2,000 deterministic generated path cases.

Five-run startup medians were 1,112 ms current versus 1,192 ms previous in
Chromium, and 1,176 ms versus 1,184 ms in Edge. The common tracker-request median
was 6 versus 6 ms in Chromium and 8 versus 8 ms in Edge. These small loopback
samples show no observed startup/request regression; they are not a general
browser-performance claim or an attribution of a speed improvement to this
change. Heap snapshots follow different scenario counts and are not compared
as evidence of memory improvement.

## Validation and public-page smoke

The complete maintainability gate passed all 347 suites. Its Store-profile
assertion now checks the actual dependency order: profile before health/state,
and memory helpers before early search restoration. The previous assertion
still assumed search loaded after popup state. No runtime popup order was
changed for this cookie work. The corrected Store suite passed all 75 checks
against the isolated candidate index; the real Git index remains untouched.

Live Edge checks loaded the official Google Identity Services and Stripe.js
libraries and rendered Google's initial sign-in form with extension off, the
previous runtime and the current runtime. Google's identifier field is
`type=text`; the first smoke attempt incorrectly required `type=email`.
The Stripe demo check remains inconclusive: its landing page has no matching
anchor, and the previous/current builds both reported an empty visible body.
This is not credited as a working checkout or a regression caused by this
change. The failed and corrected probe reports are retained in the evidence.

The first media smoke loaded both players; Twitch advanced but YouTube paused
after a scripted `video.play()` call. A second test used trusted browser mouse
events on the player controls. YouTube and Twitch both advanced for ten seconds
on the previous and current runtimes. The original scripted-play failure is
retained and the production playback guards were not changed.

## Limits

Header removal does not establish `document.cookie` or all-storage isolation.
Privacy Badger has a separate cookie-clobbering content script; this comparison
does not establish parity with that behavior. The reviewed service list also
does not establish coverage parity with every domain in its bundled decisions.
Unreviewed authentication/payment providers still have compatibility exceptions.
No production account sign-in, transaction, saved-card flow or fraud decision
is validated by synthetic fixtures or a public-page smoke test.

The earlier Ghostery renderer-task-time gap is unchanged by this cookie result.
The [dual-opponent audit](dual-opponent-rematch-audit.md) retains that finding.

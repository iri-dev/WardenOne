# Stateful cookie comparison — 29 October 2026

The later [first-script audit](early-cookie-isolation-audit.md) supersedes this
runtime's initial-read finding for supported protected network frames. The
results below remain evidence for the frozen package identified here.

WardenOne now matches Privacy Badger on cookie-header exposure across all 13
targeted resource cases, including the three previously exempt sign-in/checkout
paths. It also closes the tested prototype-getter and Cookie Store bypasses
that remain exposed in the pinned Privacy Badger build after policy activation.
This is a bounded cookie comparison; it does not establish all-domain or
all-storage superiority.

The [evidence summary](cookie-stateful-parity-evidence.json) records immutable
package identities, report hashes, controls and per-surface results. The tested
WardenOne 1.0.2 runtime contains 148 files with fingerprint
`f9df5fc67c4519fc9c2738cfb873dc6bcb26d1bfc362cd06a75511073b91f5a4`.
Privacy Badger remains the official MV3 2026.9.15.2 package and Ghostery remains
the verified v10.6.7 default profile from the earlier rematch. No version bump,
permission, setting or protection-count increase was introduced. Work is local.

## Comparison

Five repetitions ran on each of Edge 156 and Chromium 121. Every profile was
disposable. Extension-off controls sent and stored all test cookies, so browser
cookie defaults cannot receive credit. Native blocks are recorded separately
from stripped headers. The minimum-version Ghostery trial failed to initialize;
it remains an incomplete report and receives no score. Ghostery's five Edge
runs completed.

| Measured outcome | WardenOne | Privacy Badger | Ghostery, Edge |
| --- | --- | --- | --- |
| 13 targeted header cases per run | 13 stripped | 12 stripped, Facebook SDK blocked | Stripe telemetry blocked; 12 sent/stored |
| Unknown resource control | Sent/stored | Sent/stored | Sent/stored |
| Five embedded documents: ordinary cookie read/write after 350 ms | Blocked | Blocked | Available |
| Extracted prototype cookie getter | Blocked | Available | Available |
| Cookie Store read/write | Blocked | Available | Available |
| Initial inline cookie read | Available before policy reply | Available before policy reply | Available |
| Direct first-party session fixtures | Work | Work | Work |

The two-browser runs contain 130 WardenOne targeted header observations and 50
WardenOne frame probes. Every targeted header observation removed both outgoing
and incoming cookies. Every frame probe blocked the delayed ordinary getter,
prototype getter and Cookie Store reads/writes. The equivalent Privacy Badger
frame probes blocked ordinary access but exposed the other two APIs. This is
not a claim that a blocked request and a delivered cookie-free request prevent
the same non-cookie payloads from leaving.

Five frame fixtures deliberately require a cookie as their synthetic contract.
They fail that contract under both WardenOne and Privacy Badger. That construction
cannot establish real-service breakage or a compatibility advantage. The prior
path exemptions were not justified by those artificial dependencies.

## Authentication and payment checks

Google describes [FedCM sign-in without third-party cookies](https://developers.google.com/identity/gsi/web/guides/fedcm-migration).
Stripe explains that [its third-party-cookie warnings do not negatively affect
Stripe.js integrations](https://support.stripe.com/questions/chrome-third-party-cookie-warnings-for-websites-using-stripe-js).
These sources motivated testing removal of the path exemptions; neither is
treated as proof that every integration will work.

`tools/browser-cookie-fedcm.js` exercises the actual browser FedCM API with a
loopback RP and IdP, a synthetic HttpOnly session and the native account chooser.
It follows the [IdP protocol](https://developer.chrome.com/docs/identity/fedcm/implement/identity-provider)
and selects the local fixture account through the
[DevTools FedCM domain](https://chromedevtools.github.io/devtools-protocol/tot/FedCm/).
All nine trials passed: three each for off, WardenOne and Privacy Badger. The
accounts and assertion endpoints received their session cookie with
`Sec-Fetch-Dest: webidentity`; ordinary page-resource cookies stayed stripped
in the separate corpus. No external account or real credential was used.

The live Stripe.js Card Element reached its ready event and rendered real
card-number, expiry and CVC inputs with the final default WardenOne runtime and
with the extension off. It used the public Stripe demo's publishable test key.
No card data was entered and no payment was submitted. Google's initial sign-in
form rendered too. These checks do not establish production sign-in, saved-card,
3DS or transaction success.

The public Stripe demo initially triggered WardenOne's brand warning because
the brand table omitted its official developer domain, `stripe.dev`. That
specific false positive was corrected in the source and rebuilt bundle, with
official-domain and existing phishing-confidence regression tests retained.

Real YouTube and Twitch playback advanced for ten seconds on the previous and
final runtimes after trusted browser clicks. Their established exemptions were
retained.

## Authority, exceptions and failure

The existing default-on cookie switch controls both native headers and the frame
APIs. Reviewed service hosts no longer have third-party path exceptions. Own
service-family contexts, top-level visits, media compatibility and explicit site
choices retain their established scope. Unreviewed providers retain existing
compatibility behavior.

The worker derives frame decisions from installed cookie rules and explicit
allowances. It verifies the sender, current document ID and parent frame through
browser metadata. Dynamic reads request only the 1,750 IDs in the three explicit
decision bands. A shared snapshot is invalidated by native writes; changing a
cookie or allowance owner schedules a frame refresh after the native write.
Unknown hosts need no frame-tree walk. Unsupported conditions and failed reads
leave frame APIs available while existing native protections continue.

`cookie-access.js` installs early wrappers and accepts policy only through the
existing authenticated bridge. Page-forged messages and replayed older decisions
cannot change its state. Wrappers cover the document, its prototype, Cookie Store
operations and change events. An exception delegates operations back to the
captured native implementation; wrappers remain installed for later re-enabling.
The module adds no page-visible marker or external lookup.

Ten changes in each of five runs on each browser checked already-loaded frames:
cookie off/on, site exception/removal, pause/resume, master off/on and firewall
allow/revoke. All 500 frame observations restored and re-applied API isolation
without a reload. A further five native Chromium profiles passed 230 candidate
request scenarios, including real popup/Settings handlers, aliases, redirects,
native rejection recovery and browser restart.

An explicit URL/method-specific allowance whose DOM scope cannot be determined
conservatively preserves API access. Native header matching remains independent.
Ancestor document allowances are honored too. No guessed classification is
turned into a cookie restriction.

## Performance and validation

The cookie owner uses 28 native rules, including 20 confirmed-alias regex rules,
versus the prior 105 rules and 97 regexes. Removing the path exemptions removes
77 service-path regexes. The existing reserved quota stays unchanged.

Five samples per build on the 30-frame fixture measured a cold task
median increase of 5.78 ms (1.31%), a warm increase of 8.87 ms (2.07%), and
0.21 MB more heap after collection. The added 90 listeners are three per child
frame. The requested 75 ms cold-overhead ceiling passes. The CLI previously
skipped that assertion for explicit baseline comparisons; it now checks that
comparison and fails on missing measurements. The saved report was reassessed
with the corrected check. No timing collection overlapped other browser tests
or the full gate. The baseline group ran before the candidate group; the order
was not randomized, which limits attribution of small changes.

Native startup medians were 1,113 ms previous and 1,114 ms current across five
Chromium profiles. These small controlled samples support acceptable measured
cost here, not a general speed claim. The static script-entry ceiling increased
from 18 to 19 for the frame module; byte, unique-file and rule-count ceilings
were retained.

The full gate passed all 348 suites. Focused coverage checks authenticated frame
policy, current-document validation, shared native reads, first-party scope,
unknown hosts, explicit and inherited allowances, cookie events, API restoration,
path-exemption removal and performance-check failure cases. The source build,
packaging, privacy boundaries and existing security/compatibility assertions
remain checked.

## Remaining boundaries

Both tested extensions still expose an initial inline read before asynchronous
policy activation. Default-blocking every unanswered frame would conflict with
the required fail-open and exception behavior. This change does not claim that
timing gap, clean-frame/native-worker bypasses, all storage mechanisms, or every
domain's coverage are closed. The earlier Ghostery renderer-task-time result
also remains a separate finding. Failed preflights and incomplete runs are kept
with the accepted evidence rather than overwritten or scored as wins.

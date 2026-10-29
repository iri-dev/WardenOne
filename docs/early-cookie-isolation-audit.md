# Cookie isolation before the first page script — 29 October 2026

WardenOne applies the installed cookie restriction before the first inline
script in supported network frames. This closes the initial-read gap measured
in the [previous comparison](cookie-stateful-parity-audit.md). That earlier
report describes its frozen runtime, not the current implementation.

The tested WardenOne 1.0.2 runtime has 148 files and fingerprint
`ae58c60d38bb50e039b8e184132e6c7cb4804056803305706e370398ab77fd03`.
The [evidence summary](early-cookie-isolation-evidence.json) identifies the
packages, raw reports, controls and measured scope. No permission, toggle,
protection count or version was added. Changes remain local.

## How the restriction reaches a new document

The native cookie rules now have separate frame and non-frame variants. A
protected subframe response loses `Set-Cookie` and receives exactly one
`Server-Timing` metric: `cookie-policy;desc="restricted";dur=0`. Outgoing cookies
remain removed as before. The MAIN-world `document_start` module reads the
document's navigation timing synchronously and starts restricted when that
metric is present. The page cannot run between that decision and installation
of the document/prototype and Cookie Store wrappers.

The worker remains the authority for subsequent policy changes. Its existing
authenticated configuration can release the restriction for an exception or
disabled protection and reapply it when protection resumes. Page-forged replies
and replayed configurations cannot release it. The marker follows the installed
native policy, including first-party exclusions and higher-priority allowances.
Unknown or unsupported documents retain the existing asynchronous fallback.

The response signal is restrictive metadata, not an authenticated grant of
authority. A server can imitate it and temporarily restrict its own embedded
document. It cannot use it to grant cookie access, change settings or control
another origin. Late injection ignores the signal. Top-level documents return
before installing the hooks.

The frame rule replaces existing `Server-Timing`, so malformed or conflicting
server metrics cannot hide the restriction. This removes server performance
metrics on those protected subframe navigations. Other responses retain their
metrics. No visited hostname is sent to a lookup service.

The cookie owner now installs 56 rules, including 40 confirmed-alias regex
rules, within its existing 301-rule reservation. Combined frame/non-frame
budget validation happens before the atomic native write. A rejected or
oversized plan retains the last installed policy rather than partially writing
it. The existing classification and compatibility boundaries are unchanged.

## Repeated comparison

Five repetitions completed on Edge 156 and five on Chromium 121. Privacy Badger
is the pinned official MV3 2026.9.15.2 package. Ghostery 10.6.7 used its verified
default warmed profile in five Edge repetitions; its unsupported Chromium 121
startup from the previous audit receives no score.

The five protected frames cover Google sign-in/state paths and Stripe
checkout/Elements paths on `accounts.google.com`, `checkout.stripe.com` and
`js.stripe.com`. These are fixture responses, not live service account data.

| Protected embedded documents | WardenOne, 50 | Privacy Badger, 50 | Ghostery, 25 on Edge |
| --- | ---: | ---: | ---: |
| First inline ordinary cookie read exposed | 0 | 50 | 25 |
| First inline extracted prototype read exposed | 0 | 50 | 25 |
| First inline ordinary write stored | 0 | 50 | 25 |
| Cookie Store read initiated inline exposed | 0 | 50 | 25 |
| Cookie Store write initiated inline stored | 0 | 50 | 25 |
| Ordinary cookie read exposed after 350 ms | 0 | 0 | 25 |
| Prototype/Cookie Store read exposed after 350 ms | 0 | 50 | 25 |

All 130 targeted WardenOne header observations removed outgoing and incoming
cookies. Privacy Badger stripped 120 and blocked the Facebook SDK in ten.
Ghostery allowed cookies in 60 observations and blocked Stripe telemetry in
five. A block and a delivered cookie-free response remain different outcomes.

All extension-off controls exposed the seeded cookies. WardenOne's 20 unknown
resource/frame controls retained cookie flow, and all 40 direct/same-party
session controls retained access. The other products' equivalent controls
passed too. Every WardenOne delayed API write also left the native jar unchanged.

Ten policy transitions in already-loaded frames produced 500 successful
restoration/restriction observations without reloads. Ten fresh-document cases
per WardenOne profile produced 100 passes: site exception, cookie off, master
off, protection on, hostile server timing, three cache attempts, an unknown
redirect target and a terminated worker. All ten terminated-worker cases
verified a fresh replacement realm and blocked the initial reads.

## Test boundaries

The comparison uses loopback responses on service hostnames, with browser
third-party cookies explicitly available in the extension-off control. Initial
reads and writes run in the first inline script. The fixture records ordinary
and extracted-prototype getters, Cookie Store calls initiated by that script,
delayed API access, and the native cookie jar after writes. Header stripping,
native blocking and local replacements are separate outcomes.

Cookie-dependent synthetic frame contracts intentionally fail when cookies
are removed. They do not establish real authentication or payment breakage.
Real browser FedCM and Stripe input rendering are separate compatibility checks.

The stopped-worker case verifies termination and a fresh replacement realm.
After losing the worker's local top-frame IP context, the service hostname
mapped to loopback can trigger the existing DNS-rebinding quarantine. The test
records that state, permits resetting only its mapped fixture hosts, then
reloads the local parent before separate first-party checks. It does not disable
the DNS defense or claim to test public DNS rebinding compatibility.

The loopback TLS cache attempts did not demonstrate a cache hit. A separate
trusted HTTPS Stripe resource test records actual disk-cache hits while
disabling and restoring the cookie protection. Redirects to an unknown host
and fresh exception/off documents are checked separately.

## Compatibility and recovery

The final runtime passed 230 candidate request scenarios in five Chromium
profiles, including native rejection/retry, browser restart, aliases, redirects,
exceptions and the actual popup/Settings handlers. Median startup was 1,177 ms
for the candidate and 1,213 ms for the previous runtime in these small samples.
That difference does not establish a general speed improvement.

All nine browser-native FedCM trials passed, three each for extension-off,
WardenOne and Privacy Badger. The local IdP/RP fixture uses the browser's
account-selection protocol and a synthetic HttpOnly session, not a real Google
account. Native identity traffic retained the required cookie.

The live Stripe.js Card Element emitted its ready event and rendered card
number, expiry and CVC fields with the candidate and the extension off. It used
the public demo's publishable test key. No card data was entered and no payment
was submitted. Production login, saved-card, 3DS and transaction completion
remain outside this smoke test.

The trusted HTTPS Stripe controller loaded from the network with the
restriction, then from disk cache without it after disabling the cookie switch,
then from disk cache with the restriction restored. Both cache hits were
confirmed by the native network events, rather than inferred from response
cache headers.

Real YouTube and Twitch playback advanced for ten seconds after trusted browser
clicks on both the previous and candidate runtimes. The established media
exemptions were retained.

## Validation and measurement

The full maintainability gate passed all 348 suites. It retains source/bundle
parity, packaging, native rule quotas, classification failures, atomic-write
recovery, authenticated authority and existing compatibility coverage. New tests
cover synchronous restriction, forged replies, late injection, malformed timing,
first-party scope and the combined rule budget before any native write.

The performance comparison uses five samples per build on 30 same-origin child
frames, against the previous `f9df5fc67c4519fc9c2738cfb873dc6bcb26d1bfc362cd06a75511073b91f5a4`
runtime. It measures the common frame-hook cost, not a page with 30 different
tracking providers. Browser tests and the gate finish before timing collection.
The baseline group runs before the candidate group, without randomized order;
small differences should not be attributed precisely to this change.

Cold renderer task time had a median difference of -16.97 ms (-3.46%); warm
task time differed by -5.32 ms (-1.11%). Collected heap increased by 0.13 MB,
with no additional listeners. The 75 ms cold-overhead assertion passed. These
samples support acceptable measured cost here, rather than a general speed
claim.

## Remaining scope

This is a measured advantage for these APIs in protected network documents
after native rules are installed. It is not a universal cookie-privacy result.
Startup before native policy installation, service-worker-generated responses,
`srcdoc`, borrowed clean realms, native workers, other storage APIs and every
provider/integration are outside this result. An absent or unsupported signal
falls back to the existing verified asynchronous policy. Explicit exceptions
remain available immediately for subsequent requests and loaded frame APIs.

The earlier Ghostery renderer-task-time finding remains separate. Failed
preflights are retained as incomplete evidence and receive no score.

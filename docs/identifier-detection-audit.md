# Ghostery G-02: unfamiliar URL identifier evidence

## Scope and existing cleanup

G-02 adds detection of repeated high-entropy query values under unfamiliar names.
The existing Tracker learner control enables it; per-site tracker-learner exclusions,
site allowlisting, pause and history-off are respected. No setting, permission,
protection count, feed or automatic blocking decision is added.

Existing cleanup lives in `src/content.js`:

- `stripTracking` removes the named `TRACKING_PARAMS` set from clicked links when
  `stripTrackingParams` is on, and unwraps supported redirects when `unshimLinks` is on.
- `cleanHistoryUrl` removes that set and `COPY_CLEAN_GLOBAL` names from pushState
  and replaceState updates. This changes a displayed history URL after the initial
  page request; it does not erase information already sent on that request.
- `cleanCopyUrl` applies the broader global list and reviewed site-specific names
  to copied links, with redirect unwrapping and compatibility guards. Background
  context-menu/keyboard copy commands delegate to this cleaner.

The core set covers `utm_*`, `fbclid`, `gclid`, `dclid`, `msclkid`, `mc_eid`,
`mc_cid`, `igshid`, `_hsenc`, `_hsmi`, `yclid`, `_openstat`, `twclid`, and `spm`.
The broader global list and site-specific copy rules remain the source of truth
at `COPY_CLEAN_GLOBAL` and `COPY_CLEAN_SITES`, including YouTube, Spotify, Amazon,
X, Instagram, TikTok, Reddit, eBay, AliExpress, LinkedIn, Facebook and Google.
G-02 changes none of those lists or cleaners. Selected network requests still
follow existing DNR and content protections; there is no blanket unknown-value
query-removal rule.

## Evidence and minimization

`identifier-detector.js` is a pure bounded engine; `background-identifiers.js`
is its browser-only adapter. Only browser `onBeforeRequest` records are accepted.
There is no page-message endpoint. The existing `trackerRequestTopFrame` helper
checks active document IDs, initiating origin and ancestor/top-frame relationships.
The adapter checks the current top document again before publishing a finding.

Eligible requests are HTTPS GET images, pings and XHR/fetch subrequests, with at
most 8 KiB URLs, 20 parameters and four candidate values. The source page must be
HTTPS. Requests to the same site, IP/local/suffix-only hosts, protected login/payment
providers and established media compatibility hosts are excluded. Private workers
skip all observation. Suspiciously encoded or duplicate query keys fail open.

Values must have 24–128 characters, letters and digits, at least eight distinct
characters, at least 3.3 estimated Shannon bits per character and 96 total bits.
This is a shape filter, not a proof of randomness or tracking. Known core cleanup
names do not create unfamiliar-value evidence.

A nonextractable HMAC-SHA-256 key is generated from 32 cryptographically random
bytes in worker memory. Destination-site plus value, and each top-level site,
are hashed separately with domain separation; only 128-bit digests enter sketches.
Parameter names, raw values, page URLs and raw first-party names are never retained
in sketches. The destination-site namespace prevents unrelated destinations from
merging the same public value. Private PSL tenants are distinct contexts; ordinary
subdomains of a single site are one context.

A finding requires two observations at least one second apart on **each of three
independent top-level sites**. A single occurrence, a burst on one site, or three
one-off occurrences cannot qualify. The same value can be recognized under different
parameter names. A sketch reports once and never authorizes a domain proposal or rule.

At most 256 value sketches and three site counters per sketch are held in worker
memory. Entries expire 30 minutes after their first observation, without extending
that deadline on reuse. The key rotates after 30 minutes, on backwards clock movement,
or on explicit clear. Suspension/restart discards all evidence. This deliberately
reduces recall rather than creating durable token or browsing histories.

Eight asynchronous observations and 120 qualifying requests per minute bound crypto
work; each request uses at most five HMAC operations. The adapter deduplicates up to
512 browser request IDs, including redirect hops. API/RNG/crypto failure returns no
finding. Capacity pressure evicts the oldest sketch. No storage/session mirror or
network operation is available to the pure engine.

Activity stores only destination hostname, fixed source/confidence text, aggregate
context count and the explicit `detection-only` outcome. It stores no value, value
digest, parameter name, first-party URL or per-site list. These rows follow normal
history retention and history-mode controls. Clearing history, observations, site
data or all WardenOne data revokes pending work and clears sketches. A config change
also clears them, so an exception cannot reuse earlier evidence.

## Compatibility exclusions and limits

Any sensitive key excludes the entire URL: authorization/session/CSRF tokens,
OAuth/SAML state/codes, signatures and signed-URL policies, password or account
flows, payment/order/cart/invoice parameters, downloads, application/client/project
IDs, asset/build/cache hashes, search queries, addresses and user/device identifiers.
Known credential prefixes for AWS/Google signed URLs are excluded. Sensitive routes,
API/GraphQL/RPC routes, static assets, common download/media extensions, embedded
URLs, credential-bearing URLs and JWT-shaped values are also excluded. The same
route/query checks apply to the source page. Exclusions favor missed detections.

An unfamiliar public configuration value can still resemble a tracking identifier.
Repeated cross-site reuse is evidence of reuse, not proof of personal identity,
malice, receipt by the server or ownership of a tracker. Activity therefore says
**Suspected identifier · detection only**. It does not add known-tracker attribution
to this event or increment a blocked-protection badge.

## MV3 boundary and network evidence

Chromium's [webRequest documentation](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
limits blocking callbacks to policy-installed MV3 extensions. This observer cannot
return a cancellation or rewritten URL in an ordinary installation.
[DNR QueryTransform](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-QueryTransform)
supports explicit query-key removal/addition/replacement. Declarative URL matching
and RE2 substitutions cannot compute Shannon entropy, inspect this HMAC sketch,
or wait for asynchronous classification of the current request. A rule installed
after observation cannot retroactively protect a request already sent.

This implementation creates no identifier-enforcement rules. Native evidence must
show the unfamiliar value reaching the controlled receiver intact. A separate,
temporary test-only DNR rule checks an explicit `fixture_marker` removal before
receiver receipt, then is removed and the full policy snapshot compared. That
isolated API capability check is not a shipped adaptive-removal feature. Any future
removal needs opt-in or narrow allowlisting and fresh pre-egress/false-positive evidence.

## Verification

`tools/test-identifier-detector.js` covers thresholds, renamed parameters, site/tenant
boundaries, sensitive and malformed input, bounded capacity/rate/concurrency,
expiry/clock rollback, crypto failure, clearing pending work, browser policy gates,
duplicate/forged requests and Activity data minimization. Existing copy/history
cleanup and security/compatibility suites remain in the complete gate.

`tools/browser-identifier-detector.js` uses frozen runtime copies, disposable profiles,
loopback HTTPS fixtures and native browser events. It verifies actual receiver data,
Activity labeling, sensitive-flow compatibility and unchanged shipped rules/settings/
permissions. `tools/bench-identifier-detector.js` records local preprocessing/HMAC
costs. Results and hashes are recorded in `docs/identifier-detection-evidence.json`.

No version bump, commit or push is included.

## Completed results

All **336 test suites** pass, including the existing cleanup, licensing, package,
privacy and compatibility gates. The additional pending-frame erase regression
passes in the focused suite as well. Native **Edge 150.0.4078.48** and **Chrome
121.0.6167.184** each pass all five browser checks. The installed newer Chrome
did not load the unpacked extension in its fresh profile; no success is claimed
for that binary. The Chrome compatibility build is recorded explicitly.

Each native run received six original unfamiliar values and recorded one
detection-only finding. OAuth, signed-URL, download, API and redirect probes
retained their values. The isolated DNR marker was absent at the receiver,
and removing that temporary rule restored the complete original rule snapshot.
Settings and permissions were unchanged. Protection count remains **110**.

On Node 24.18.0 on this machine, 20,000 candidate preprocessing iterations took
117.97 ms (about 0.006 ms each), 20,000 excluded static-asset iterations took
32.15 ms, and 120 sequential HMAC observations took 19.66 ms (about 0.16 ms each).
The bounded engine held 120 sketches and zero pending work; expiration removed
all of them. These are local development timings, not page-load measurements.

The packaged runtime is 11,316,403 bytes with the original 28,369 static rules
and unchanged 1,762,490 manifest-script bytes. Its archive remains inside the
unchanged reviewed size limits. The new worker-only scripts add no page-world
code. Accepted native input is `tmp/ghostery-phase02/snapshot-01/wardenone`;
final development-source/runtime archives are under `tmp/ghostery-phase02/final-review/`.
Their runtime fingerprint must match the accepted native input. Evidence records
report/harness/source/gate hashes. The real Git index remains untouched.

# Dual-opponent rematch — 29 October 2026

The cookie gap below has a subsequent implementation and repeated comparison in
[the service-cookie isolation audit](cookie-service-isolation-audit.md). This
document retains the earlier measurements and their limitations.

WardenOne ties both opponents on preventing egress in the fixed four-tracker
corpus. Privacy Badger exposes fewer cookies on the two compatibility-host
resource fixtures. The earlier timed WardenOne build uses more renderer task
time than Ghostery. An overall win in every area has not been established.

The final local WardenOne 1.0.2 runtime contains 147 files and has fingerprint
`e6013bc0bd6e821e4d85a09261ce22297730fbae0680a030c1925728a541297f`.
Source/runtime review passed. Later independent popup edits changed
`popup.html`, `popup.js`, `popup-scroll-memory.js` and `popup-settings-search.js`;
they are preserved and are outside this frozen browser result. The tested
privacy policy files still match the workspace. No version bump, commit or push
was performed. Other local extension-security edits were preserved in the snapshot.

[The evidence summary](dual-opponent-rematch-evidence.json) records identities,
raw-report hashes, per-run outcomes and validation. Raw local artifacts are under
`tmp/dual-rematch-2026-10-29/`. Privacy Badger is the official MV3 2026.9.15.2
package; Ghostery is the verified v10.6.7 package. Results refer to these packages.

## Cookie finding and change

The original OAuth/SAML fixtures check redirects, HTTP methods and callback
parameters. They never require a session cookie. Their success cannot establish
whether stripping cookies preserves real authentication or payment.

The new corpus separates resources with no cookie dependency from frames whose
synthetic session contract deliberately requires a cookie. Every result below
reproduced in all three runs. Extension-off controls confirmed the browser itself
allowed both cookie directions.

| Case | WardenOne | Privacy Badger | Ghostery |
| --- | --- | --- | --- |
| Identity fetch, no cookie dependency | Cookies sent/stored; usable | Cookies removed; usable | Cookies sent/stored; usable |
| Payment script, no cookie dependency | Cookies sent/stored; usable | Cookies removed; usable | Cookies sent/stored; usable |
| Cookie-dependent identity frame | Session works | Cookie dependency fails | Session works |
| Cookie-dependent payment frame | Session works | Cookie dependency fails | Session works |
| Direct identity/payment session visits | Both work | Both work | Both work |

Privacy Badger wins cookie minimization on the first two cases. Preserving those
cookies is exposure in this corpus; it is not evidence of necessary functionality.
The frames show the effect of a cookie requirement built into the fixture, not
a demonstrated Google or Stripe failure. All bodies are synthetic loopback
responses. Real sign-in and checkout remain outside this result.

Google documents [FedCM sign-in without third-party cookies](https://developers.google.com/identity/gsi/web/guides/fedcm-migration).
Stripe documents [fraud-prevention cookies and signals](https://stripe.com/in/legal/privacy-center).
Neither source justifies assuming every service request needs cookies or proves
that removing every cookie is compatible with every integration.

One narrower gap was fixed: login and payment **initiators** previously exempted
unrelated curated tracker and confirmed-alias destinations from cookie isolation.
Those initiator exemptions are removed. Requests **to** compatibility services
remain exempt. Established media initiator/destination exceptions, top-level
navigations, explicit site exceptions and firewall precedence remain intact.
The existing cookie switch controls the policy; there is no new toggle.

Five native Chrome 121 repetitions per build verified the change. Each final
candidate passed 39 scenarios, including both cookie directions on curated
trackers and aliases, auth/payment-initiated tracker isolation, own-service cookie
preservation, media exceptions, both real UI controls, immediate exceptions,
native-write rejection, redirects and browser-restart restoration. The focused
regression fails against the preceding immutable source and passes now.

The original compatibility-destination exposure remains: cookies on the simple
identity fetch and payment script still flow. Narrowing those exceptions requires
endpoint-specific compatibility evidence. This change does not close that gap.
Settings now describes known-tracker isolation instead of claiming all
third-party cookies are refused, and identifies the remaining exceptions.

## Shared request rematch

Five alternating repetitions per product ran serially in disposable Edge
profiles. WardenOne and Privacy Badger use packaged default data. Ghostery uses
its warmed default profile because its engines require initial downloads; its
protection settings and filter payload hashes are verified. Remote DNS is
refused during measurement. These data states are explicit, not identical.

| Outcome in every repetition | WardenOne | Privacy Badger | Ghostery |
| --- | --- | --- | --- |
| Tracker requests reaching the fixture server | 0/4 | 0/4 | 0/4 |
| Native blocks | 4 | 4 | 3 |
| Verified packaged local replacements | 0 | 0 | 1 |
| Benign-control delivery failures | 0/6 | 0/6 | 0/6 |
| Editor, OAuth callback, SAML callback, playback | All pass | All pass | All pass |
| Forced worker restart, native rules, repeated policy | Pass | Pass | Pass |

Ghostery replaces the DoubleClick request with its packaged empty resource.
The browser's complete native redirect chain, selected extension identity,
successful local response and packaged-resource hash establish replacement.
The original request never reached the server. Earlier diagnostics marked this
as an error because redirect events overwrote the original URL; those reports
are superseded by `dual-network-accepted.json`. A missing request or arbitrary
HTTP 200 alone cannot earn replacement credit.

## Performance and other remaining losses

The five-block timing run used earlier frozen runtime
`53a7524aa9c4bcda922cd29e312c64c23320b62365bc0267757895e05871d5cb`,
before the final cookie/Script Drift changes and other local extension-security
edits. Updated filter payloads and protection settings stayed frozen per arm.
These are costs of the respective product presets, whose protection scopes
differ. They are not post-change measurements.

| Earlier timed arm | Cold renderer-task total, ms | Warm total, ms | Peak native private memory, MiB |
| --- | ---: | ---: | ---: |
| WardenOne Recommended | 1,783 | 1,784 | 734 |
| Ghostery default | 1,132 | 1,074 | 831 |
| WardenOne Maximum | 1,895 | 1,907 | 746 |
| Ghostery maximum practical | 1,233 | 1,156 | 824 |

Task totals sum six workload medians. Peak memory is the median of each block's
largest observation. WardenOne's lower peak native memory coexists with higher
renderer time and larger article JS heaps. Article worker heaps were about
22.49/16.68 MiB for WardenOne Recommended/Ghostery default: warmed,
debugger-attached heaps rather than fresh startup or total process memory.

All 24 WardenOne/Ghostery workload/cache/preset comparisons have five valid
pairs. One extension-off warm-auth sample failed on a reset cumulative renderer
counter, so the full 300-visit report remains incomplete. The failure is retained.
Future resets produce unavailable deltas, not zero or negative timing credit.

Script Drift now reuses ancestor checks and deduplicates added roots per batch.
Its regression reduces an 80-level, 200-entry repeated-root case from 16,000
ancestor reads to 80, preserving inline, nested external, mixed-case and
later-sibling script detection. A five-block post-change speed improvement has
not been measured.

The separate earlier Chrome 121 Privacy Badger comparison also has mixed costs:
WardenOne reached readiness sooner and used less worker heap, while Privacy
Badger used less browser CPU and renderer heap. WardenOne's startup budget passed
by only 2.5 ms. Raw samples and the fixed budget remain in the evidence; this is
not a broad performance win.

The pinned Privacy Badger package contains 75,955 CNAME aliases; WardenOne has
1,663 enforceable reviewed aliases. Mapping breadth is not identical to blocking
coverage, but WardenOne has not demonstrated broader coverage. Expanding to
unknown/shared targets would violate its default classification policy.
Independent unknown-tracker learning remains a capability gap: WardenOne's
suggestions retain approval because its corpus still has false positives.
Established release maturity and years of field reliability cannot be obtained
by changing a local score or by one release-gate pass.

## Validation and reproduction

The full local maintainability gate passed all 347 suites, syntax, generated-file
parity and package checks for the final runtime. Storage/message/protection
inventories were regenerated after source changes. Final harness changes for
redirect attribution passed their focused regression and the repeated browser
corpus. `git diff --check` passed and the real index remains empty.
The full gate also passed again after the later popup edits and a fresh
inventory refresh; the browser tables retain their frozen runtime identity.

Failed performance launches, preset mismatches, the counter failure, profile
identity mismatch and superseded redirect diagnostics remain in the artifact
directory. Only named accepted reports support the tables. No benchmark browser
ran concurrently with another benchmark browser. The gate ran outside scored
performance collection; later functional checks carry no performance claims.

Runners: `tools/browser-release-rematch.js`,
`tools/browser-cookie-compatibility.js`, `tools/browser-tracker-cookies.js`, and
`tools/browser-ghostery-performance.js`. They refuse to overwrite reports.
Recorded snapshots, warmed seeds, browser executable hashes and report hashes
identify the tested inputs.

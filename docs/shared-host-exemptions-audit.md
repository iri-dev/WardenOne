# Shared-host exemption boundaries

Checked 2026-10-21 against the bundled PSL snapshot.

The current worker already returned `false` for
`hostMatchesSite('alice.webflow.io', 'webflow.io')`. The reproducible gap was in
page worlds without the raw private PSL: they returned `true`, while GitHub's
curated entry returned `false`. Page-side per-site protection switches could
therefore inherit a platform-apex exception before or after worker configuration.

The PSL generator now emits complete, lazy private TLD groups alongside the
compact ICANN groups in both canonical domain helpers. `hostMatchesSite` makes
every descendant exemption conditional on the same `siteIdentity` boundary;
`sameSiteDomain`, shared-tenant detection and engine verification comparisons use
that authority too. The worker's signed site hint may narrow a comparison, but
cannot grant trust that the shared matcher refuses. Registry and list lookup
keys retain their existing `registrableDomain` behavior.

Download Trust records the actual tenant site instead of its hosting platform,
and user download exceptions use the shared matcher. Opaque infrastructure keeps
its established exact-host scope. Normal site subdomains and a tenant's own
subdomains remain eligible; tenants named `www` retain that label.

`tools/test-shared-host-exemptions.js` compares worker, MAIN and ISOLATED helper
copies over all 10,324 PSL rules (61,944 comparisons). It exercises page overrides,
allowlist relays, verification comparisons, download trust and unrelated tenants.
The native WebRTC audit suite additionally checks that a Webflow apex exception
does not disable a tenant's protection, that an Alice-only exception does disable
Alice's selected protection, and that Bob remains protected. Both actual injected
worlds are queried on those local browser fixtures.

The complete data adds about 58 KB per shared helper. The explicit package-size
review is recorded in [the performance notes](perf/README.md).

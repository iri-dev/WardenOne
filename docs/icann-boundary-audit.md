# ICANN site-boundary correction — 2026-10-20

The old country-code regex merged separate registrants under `or.jp`, `web.id`,
`me.uk`, `ltd.uk`, `nhs.uk`, `or.kr`, `pe.kr`, `id.au` and `k12.ca.us`.
It also missed the wildcard in `*.sch.uk`.

The shared helper now uses all 6,950 ICANN rules from the existing PSL snapshot
`2026-09-17_19-09-53_UTC`. The 3,374 private rules are unchanged. The compact ICANN
representation groups multi-label rules by TLD; omitted single-label entries are
equivalent to the PSL default `*`. Wildcards and exceptions retain their semantics.
Only a queried TLD group is split into a Set, cached within that execution world.
The compact data adds about 53 KB of source to each world’s shared helper.

The ICANN data is embedded in `domain-utils.js` and its generated isolated copy, so
it is available before redirect checks without a worker response or new resource
registration. Full private data remains worker-only. Curated private tenants,
opaque cloud-host handling and worker-supplied frame identities remain in place.

Script Drift, search markers and copied page helpers now delegate to the shared
implementation. A dynamically registered search marker that runs before the helper
uses the full host until the helper arrives. Host-list matching also refuses to
cross a registry or private-tenant boundary, including wildcard parents.

Regression coverage compares the compact matcher with an independent evaluator of
the full ICANN list for three hosts per rule (20,850 comparisons). It separately
checks the reported suffixes, IDNs, IPs, unknown TLDs, `*.sch.uk`, Japanese wildcard
exceptions and `!www.ck`, plus the redirect, Script Drift and search consumers.

`tools/build-psl.js --check` verifies the compact data against the shipped source
representation. `--from-shipped` regenerates it offline without changing the PSL
snapshot; normal updates regenerate both representations. Run
`tools/build-content.js --build` afterwards to refresh the isolated copy.

Validation passed: the full maintainability gate (291 suites) and native browser
smoke checks in Edge 150.0.4078.48 and Chrome 121.0.6167.184. Browser checks execute
the boundary probes in the worker and both content-script worlds of a top page
and cross-site iframe, alongside the existing engine, bridge and DNR checks.

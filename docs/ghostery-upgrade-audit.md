# Ghostery G-09: saved-profile upgrades

Review date: 28 October 2026. The candidate remains local and uncommitted at
version 1.0.2. [The evidence](ghostery-upgrade-evidence.json) records the exact
candidate tree, archive checksums, browser binary, source inventories, permissions,
data revisions, startup samples and native report checksums. The synthetic test
hosts and history entries are not personal browsing data.

## Supported direct-upgrade lanes

| Starting build | Provenance | Tested upgrade |
| --- | --- | --- |
| 1.0.1 full | Historical `latest-build` source tag at `42448d1823c0de7c35884c772af9a68012b3ba71`; no published ZIP was verified | 1.0.2 full, same profile and extension path |
| 1.0.2 full | Verified published `WardenOne-latest.zip`, SHA-256 `d34d4722777b08fad4bfad61a6d562172e762f64d68699ce5424065bfd227843` | 1.0.2 candidate full, same profile and extension path |
| 1.0.2 Store profile | Source-built from the published 1.0.2 commit, not a verified Web Store artifact | 1.0.2 candidate Store profile, same profile and extension path |

The published ZIP's extracted runtime fingerprint equals a fresh archive of its
source commit, so the repeatable CI lane can use that pinned commit without
depending on a mutable release URL. The archived local 1.0.1 Store ZIP did not
start a worker in Edge and has unverified publication provenance. It is not a
supported direct-upgrade claim. No 1.0.0 archive is claimed: the available local
one is explicitly marked stale. These runs exercise unpacked extensions with
preserved browser profiles, including an explicit extension reload after a file
swap. They do not simulate a signed Store CRX transaction or every Chromium build.

`tools/run-saved-profile-upgrades.js` runs all three lanes in headless Edge from
pinned source refs. `.github/workflows/gate.yml` requires that job before the
rolling release can publish. A local rehearsal and the final candidate run both
passed. Each lane keeps its extension ID, settings, synthetic bounded history,
tracker site approval, consent and GPC choices, and scheduled cleaner alarm after
a browser restart. The published and Store lanes also retain custom rules, site
overrides, firewall decisions and owned DNR rules. The older build lacks those
later data shapes, so its lane checks the decisions it actually supported.

The 1.0.1 lane upgrades its learner data to schema 4 while retaining the site
approval. Its required `history` permission becomes optional in 1.0.2; Chromium
carried the grant forward, then the test revoked it through the native API and
confirmed the rest of the state survived. The other two lanes began without
that optional grant. The existing optional-history unit suite also covers denied
and revoked calls.

## Migration and recovery

The first same-profile run preserved old settings but missed the renamed video
preview setting. `onInstalled` is not a sufficient migration trigger for an
unpacked file replacement. The config migration now lives in the small
`upgrade-config.js` module and runs idempotently when the worker starts as well
as on an update event. It uses the existing serialized config write path. The
unit test preserves an explicit location choice, splits legacy search settings,
renames video previews, removes retired secret-shaped fields, leaves active API
keys intact, and performs no second write. It simulates failure before the one
storage commit; the next startup retries against the unchanged stored state.
Interruption before that atomic write has the same recovery path, while a worker
restart after a completed write is idempotent. The native lanes restart the worker
after the upgrade and confirm decisions, owned rules and cleaner scheduling.

## Package and dependency review

The candidate full archive has 147 reviewed runtime files; all 147 match the
candidate Git tree byte for byte. The Store archive has 146 files; all 146 match
its derived Store source tree, and a second build produced the same ZIP checksum.
The full and Store ZIP SHA-256 values are in the evidence file. The package
allowlist, Store omissions, generated-content check, source inventories and
permission checks remain in the maintainability gate. The latest published and
candidate manifests declare identical required and optional permissions. From
historical 1.0.1, `declarativeNetRequestFeedback`, `contextMenus` and `offscreen`
are new required permissions; `tabGroups` is removed and `history` is optional.

This repository has no npm, Python or other package-manager dependency manifest.
Its GitHub Actions are pinned by commit. Comparing published 1.0.2 runtime data
with the candidate, the static DNR packs, malware hashes and search-domain data
are unchanged. The added CNAME map and tracker catalog are the external data
revisions; their pinned source snapshots, licenses and attribution are in
`docs/cname-protection-audit.md`, `docs/tracker-attribution-audit.md`,
`CREDITS.md` and `THIRD_PARTY_NOTICES.html`. The changed notices and attribution
files were reviewed with those additions. No visited host is sent to a DNS
service for the CNAME map.

The worker extraction was benchmarked with alternating disposable Edge profiles:
three cold launches each, median 1,022 ms before and 1,008 ms after, a 1.4% lower
observed median. The small sample does not establish a universal speed gain; it
does rule out a large regression in this environment. This phase adds no new
protection count or user-facing setting.

The local maintainability gate passed with all 345 test suites. The new GitHub
upgrade job passed a local headless rehearsal; remote GitHub checks have not run
because this work has not been pushed.

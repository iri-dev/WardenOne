# Ghostery G-01: local tracker attribution

Reviewed 2026-10-27. Activity and Network Logger can identify a recognized
hostname's product, organization and category. No new protection, setting,
permission, runtime feed, persisted record or blocking rule is introduced.
The protection registry remains 110. Work remains local and version 1.0.2.

## Source and scope

The source is [AdGuard Companies DB](https://github.com/AdguardTeam/companiesdb/tree/8d845040224a0e3ea9cbba5df68ceb6a988235d2),
pinned to `8d845040224a0e3ea9cbba5df68ceb6a988235d2`, updated upstream on
2026-10-26. The pinned
[README](https://github.com/AdguardTeam/companiesdb/blob/8d845040224a0e3ea9cbba5df68ceb6a988235d2/README.md)
documents the product/company/category/domain schema and acknowledges
WhoTracks.Me contributions. Its current data is maintained independently.
The repository's [license](https://github.com/AdguardTeam/companiesdb/blob/8d845040224a0e3ea9cbba5df68ceb6a988235d2/LICENSE)
is CC BY-SA 4.0. The adapted metadata retains that license; original WardenOne
code remains GPL-3.0-or-later. Full license text, attribution, source links and
modifications are in the packaged notices, credits and licensing inventory.
Ghostery TrackerDB and Disconnect's noncommercially licensed datasets are not
used for the catalog.

`docs/tracker-catalog-source.json.gz` preserves exact pinned tracker/company
inputs and license text. The builder checks their SHA-256 against reviewed
constants, checks the packaged license, and deterministically selects metadata
for existing WardenOne observation families plus a few explicit service roots.
The compact result is **41 products, 30 organizations and 60 domain boundaries**,
7,148 bytes. This is deliberately partial coverage. An absent product is not
guessed from a similar name.

The schema records stable product and company IDs, display names, category,
domains, source revision/date, input hashes and data license. Google Analytics
and Google Tag Manager remain distinct products under Google. Essential,
hosting and other service categories are labelled as services rather than being
turned into evidence of malicious tracking. Matching is hostname-only because
the selected upstream source provides domain associations, not request-path
classification. No path or query-based identity claim is made.

## Boundaries and behavior

`tracker-attribution.js` is loaded only by the two private inspection pages. It
uses the established site-boundary helpers and never runs in the background
worker or website frames. It has no storage, DNR, settings or privileged-message
interface. Looking up an identity cannot authorize enforcement or approval.
The existing request outcome, rule evidence and learner decisions remain
separate from a catalog hostname match.

The matcher uses the most specific hostname boundary, with PSL/private-tenant
checks. Lookalikes, public suffixes, credentials, malformed hosts and unrelated
shared-host tenants do not inherit identities. Broad source entries that are
public suffixes are omitted. Unknown blocked requests show their hostname and
unknown identity; local tracker proposals keep their existing suspected status.
Activity enrichment is limited to relevant tracker/observation event fields and
does not attribute unrelated security incidents from the visited page URL.

Metadata is fetched only from packaged `tracker-catalog.json`, when an inspection
page first opens or the user selects **Refresh names**. Visited hostnames never
enter a metadata request. Source links are explicit user clicks on a pinned
dataset page; they contain no browsing hostname. No automatic updater or new
provider endpoint is added.

Each validated snapshot is published atomically. Concurrent readers share one
load. Replacement invalidates the old lookup map without a browser restart.
Malformed data, missing references, duplicate/unsafe domains, older-dated snapshots, future
dates or data older than one year cannot replace a valid snapshot. Failed
refreshes keep the last valid names and show a quiet status. With no valid data,
the pages continue showing original outcomes and unknown identities.
The loader caps decoded bytes at 128 KiB, records at 512 products/256 companies,
domains at 2,048 and a load at three seconds. Late timed-out reads cannot publish
a new snapshot. Activity also ignores obsolete history responses, preventing a
late enrichment from restoring older rows after another load or erasure.

Names and categories render through text nodes. Dataset markup does not become
HTML. Source links are constructed from the validated revision at the fixed
repository origin, with a separate tab and no opener. No attribution data is
added to stored history or log exports; exports retain their existing schemas.

## Regression and native evidence

`tools/test-tracker-attribution.js` covers correct product/company/category,
two products under one company, lookalikes, unknowns, private tenants, malformed
schemas, licensing/provenance fields, stale/oversized data, concurrent refresh,
last-good retention, input immutability, timeout and obsolete history responses.
A throwing browser-authority proxy verifies catalog processing uses no browser
capability. The build parity check is wired into the maintainability gate.

The native harness runs the exact packaged candidate in a disposable profile
and modifies only an additional disposable runtime copy. It checks Activity and
Network Logger, an actual blocked tracker request, source/evidence details,
same-page database replacement, literal markup rendering and corrupt/old-data
fallback. Installed dynamic/session/static policy, settings and permissions are
compared strictly before and after. The loopback fixture's normal local-tab
Intranet Guard exemption is established before taking that baseline. No
protection is disabled to make the assertion pass. Test-only metadata edits are
restored and checked against the original runtime fingerprint.

Desktop and narrow-screen screenshots verify the Activity layout. Package size,
licensing, source/build provenance and existing security/compatibility tests
remain part of the full gate. This phase makes no new comparative Ghostery
performance or detection claim.

## Updates, maintenance and rollback

Updating the catalog is a reviewed development operation: pin a new source
commit and raw-input hashes, preserve its snapshot and license evidence, rebuild
the compact JSON and notices, then run parity, boundary, native and package
checks. Review changed identities and tenant scopes. The two upstream files are
about 1.6 MiB in total, kept in development evidence; they are not runtime feeds.
An unchanged worker incurs no catalog startup parse or data fetch. UI memory
and work are bounded by the metadata cap and existing 200/400 displayed-row caps.

Rollback removes the inspection-page enrichment and packaged catalog/helper,
updates the package/source inventories and reruns the gate. No user settings,
permissions, learned decisions, security rules or retention state need migration.
No version bump, commit or push is included in this work.

Final candidate hashes, gate output and native reports are recorded in
`docs/tracker-attribution-evidence.json` after verification.

## Completed verification

All **335 suites** pass. The packaged footprint remains inside the unchanged
reviewed limits, with all licensing/provenance checks intact. Both native browser
reports confirm rule #2 from the existing Tracker list settles the controlled
request as blocked, while name lookup and valid/invalid catalog refresh preserve
the complete installed policy, settings and permissions. The actual request host
is used for attribution even where Logger display normalization shortens `www`.

The accepted native input is `tmp/ghostery-phase01/snapshot-05/wardenone`.
The finalized development-source/runtime archives are in
`tmp/ghostery-phase01/final-review/`; their runtime fingerprint must match that
accepted input. The evidence index stores the report, harness, source and gate
hashes. The real index remains unchanged; no commit or push was made.
